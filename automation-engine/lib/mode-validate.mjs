// =================================================================================================
// THE MODE CHECK — its journal, its verdict, its visit map and its ratchet (epic 101 Ф1, plans/102)
// =================================================================================================
//
// WHY. The turnaround (ЗАКАЗ.md §6, the owner's 10.08 design): the unit of work is a check of the WHOLE
// mode under a mix of loads, not a burn of one frequency — «весь профиль кривой… тестировался… Если он
// будет "сбоить", то ищем точку, которая даёт сбои и у неё повышаем напряжение на один минимальный шаг
// вверх, и вновь тестируем всю кривую». This module holds the parts of that loop that are pure logic:
//
//   Ш3  the check's write-ahead journal — `runs/validate/journal.jsonl`, the SAME `appendLine` (fsync) as
//       the sweep's journal; an intent nobody closed is a death, attributed to the band of the last
//       durable telemetry sample (ЗАКАЗ.md §4).
//   Ш5  `verdictOf` (driver voice · loads alive · telemetry without gaps), `hitMap` (time per band),
//       `nextMargins` (a pass lowers VISITED bands one step; a failure raises ITS band by the ratchet
//       and floors it there — a band that failed is never lowered again, ЗАКАЗ.md §3).
//
// The instrument that drives the card (Ш4, `npm run validate`) composes these; it is not in this file.
// Nothing here touches the card, a profile or the sweep's journal.
//
// SELFTEST MUTATION ADDRESSEES, named before the run (EXP-0016):
//   MV1 a pass lowers EVERY band, not only the visited ones   → «ПРОЙДЕННАЯ ПРОВЕРКА ОПУСКАЕТ ТОЛЬКО ПОСЕЩЁННЫЕ…»
//   MV2 the ratchet raises but sets no floor                  → «СБОЙ ПОДНИМАЕТ ПОЛОСУ СБОЯ… И СТАВИТ ЕЙ ПОЛ»
//   MV3 a death is attributed to the FIRST sample, not the last → «СМЕРТЬ — СБОЙ В ПОЛОСЕ ПОСЛЕДНЕЙ ДОЛГОВЕЧНОЙ ПРОБЫ»
//   MV4 a pass of ANOTHER curve counts for the mode          → «МЕТРИКА: СЧИТАЕТСЯ ПРОЙДЕННАЯ ПРОВЕРКА ТОЙ КРИВОЙ…»
//   MV5 the scaled mix loses its per-stage floor             → «ДЫМ НА МИНУТУ СОХРАНЯЕТ ПРОСТОЙ НА ОБОИХ КОНЦАХ…»
//   MV6 the intent is written AFTER the sampler starts        → «ИСПОЛНИТЕЛЬ: НАМЕРЕНИЕ В ЖУРНАЛЕ И СЭМПЛЕР ИДУТ ДО ПРИМЕНЕНИЯ»
//   MV7 the rollback leaves `finally`                        → the four executor blocks that demand «откат сделан»
//   MV8 the candidate is born qualified                      → «КАНДИДАТ — ЧЕРНОВИК, ПРИНЯТЫЙ ФОРМАТОМ ПРОФИЛЯ…»
//   MV9 the real apply seam drops the draft consent           → «НАСТОЯЩИЕ ШВЫ (НА ПОДДЕЛКЕ БИБЛИОТЕКИ)…»
//   MV10 the real rollback forgets the applied clock lock     → the same block
//   MV11 the card is touched although the sampler never came up → «ИСПОЛНИТЕЛЬ: СЭМПЛЕР НЕ ПОДНЯЛСЯ…»
//   plans/105 Ш2–Ш3 (2026-10-17):
//   MV12 failureSpan collapses to the lowest frequency (the first edition)  → «…ПРОСТОЙ В ОКНЕ НЕ ПРЯЧЕТ…» + «…ПОЛ НА ВЕСЬ РАЗБРОС…»
//   MV13 curve-proposal.withCheckFailures returns `credible` alone  → «УРОВЕНЬ ЧАСТОТЫ: ПОСТРОИТЕЛЬ ПОДНИМАЕТ ОКРЕСТНОСТЬ СБОЯ…»
//   MV14 nextMargins ratchets the band of a failure with points        → «УРОВЕНЬ ЧАСТОТЫ: СБОЙ С ТОЧКАМИ НЕ ДВИГАЕТ…»
//   MV15 prepareStep saves the document before the dry-run return → «ШАГ: СУХОЙ ПРОГОН НИЧЕГО НЕ ПИШЕТ…»
//   MV16 runCheck drops failureAt from the verdict record          → «ИСПОЛНИТЕЛЬ: СБОЙ ПИШЕТ В ЖУРНАЛ РАЗБРОС И ТОЧКИ СНИМКА…»
//   MV17 attributeFailure attributes a LOAD failure too             → «УРОВЕНЬ ЧАСТОТЫ: СБОЙ НАГРУЗКИ ЧАСТОТЕ НЕ ПРИПИСЫВАЕТСЯ…»
//   bugs/146 (2026-10-17, session 109):
//   MV18 attributeFailure ignores `baseRows` (the window alone, as before) → «УРОВЕНЬ ЧАСТОТЫ: СТРОКИ, ОПУЩЕННЫЕ ШАГОМ…»
//   MV19 lastPassedSnapshot takes the last check of the mode, passed or not → the same block
//
// [NOT-TESTED] on the card — hygiene (38 blocks, MV1–MV11 each red on target, 2026-09-25) and functional runs on
// RECORDED data only (`--hits`, `--compare`, `--replay`, the 08.09 death); the card itself is Ш8's smoke. Functional runs:
// the metric line read live from `npm run curve -- --progress` and `--plan` read live; the journal, the
// verdict and the ratchet have never met a real check — that is the smoke of Ш8 and the evening of Ф2.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openJournal, appendLine, readJournal, orphanIntents, LINE } from './sweep-journal.mjs';
import { parseSampleTime } from './hardware-mon.mjs';
import { driverEventsInWindow, momentOf } from './driver-voice.mjs';
import { queryFaults } from './event-logger.mjs';
import { MODE_BANDS, NEGATIVE_MARGIN_FROM_MHZ, MARGIN_DESCENT_STEP_MV, RATCHET_GRID_STEPS, MIN_BAND_DWELL_S, PULSE_STALL_MS, FAILURE_ATTRIBUTION_WINDOW_MS } from '../config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
export const VALIDATE_DIR = join(ROOT, 'runs', 'validate');
export const CHECK_KIND = 'mode-check';
/** A margin as printed: «+10», «0», «−10» — a negative margin (plans/105) must not print as «+-10». */
export const signedMv = (m) => (m > 0 ? `+${m}` : m < 0 ? `−${-m}` : '0');

export const CHECK_VERDICT = Object.freeze({ PASSED: 'passed', FAILED: 'failed', UNKNOWN: 'unknown' });
export const FAILURE_CLASS = Object.freeze({
  DEATH: 'death',                  // an intent nobody closed — the machine stopped existing mid-check
  DRIVER: 'driver-voice',          // the display driver's own error channel spoke inside the window
  LOAD: 'load-died',               // a stage of the mix did not end normally
  TELEMETRY_GAP: 'telemetry-gap',  // the separate sampler lost its beat — the system stalled (R4a-pulse)
});

// -------------------------------------------------------------------------------------------------
// Bands — the ONE mapping the curve, the visit map and the ratchet share
// -------------------------------------------------------------------------------------------------

/** Index of the band a frequency belongs to ([loMhz, hiMhz)); −1 when the bands leave a hole. */
export function bandOf(mhz, bands = MODE_BANDS) {
  return bands.findIndex((b) => mhz >= b.loMhz && mhz < b.hiMhz);
}

// -------------------------------------------------------------------------------------------------
// Telemetry — the sampler's JSONL (`hardware-mon`): { i, t, sample: { 'clocks.gr', … } }
// -------------------------------------------------------------------------------------------------

/** Parse a sampler file's text into [{ ms, mhz }] in time order; a torn tail line is normal and skipped. */
export function parseSamples(text) {
  const out = [];
  let periodMs = null;
  for (const line of String(text).split('\n')) {
    const s = line.trim(); if (!s) continue;
    let rec; try { rec = JSON.parse(s); } catch { continue; }
    if (rec?.meta?.period_ms) periodMs = rec.meta.period_ms;
    if (!rec?.t || !rec?.sample) continue;
    const ms = parseSampleTime(rec.t);
    const mhz = Number(rec.sample['clocks.gr']);
    if (ms !== null && Number.isFinite(mhz)) out.push({ ms, mhz });
  }
  out.sort((a, b) => a.ms - b.ms);
  return { samples: out, periodMs };
}

/** Time the card spent in each band. Each sample stands for one sampler period. */
export function hitMap(samples, { periodMs, bands = MODE_BANDS } = {}) {
  const per = bands.map((b) => ({ id: b.id, label: b.label, samples: 0, seconds: 0, share: 0 }));
  for (const s of samples) { const i = bandOf(s.mhz, bands); if (i >= 0) per[i].samples++; }
  const total = samples.length || 1;
  for (const p of per) { p.seconds = (p.samples * (periodMs ?? 1000)) / 1000; p.share = p.samples / total; }
  return per;
}

/** Bands the check actually PROVED: at least `minDwellS` seconds spent in them. */
export function visitedBands(map, minDwellS = MIN_BAND_DWELL_S) {
  return map.map((p, i) => (p.seconds >= minDwellS ? i : -1)).filter((i) => i >= 0);
}

/** The band the card was living in at `atMs` — the last sample at or before it (null when none). */
export function bandAt(samples, atMs, bands = MODE_BANDS) {
  let last = null;
  for (const s of samples) { if (s.ms <= atMs) last = s; else break; }
  return last ? bandOf(last.mhz, bands) : null;
}

// -------------------------------------------------------------------------------------------------
// plans/105 Ш2 — LEVEL 3, the frequency: a failure is attributed to the frequencies the card delivered
// -------------------------------------------------------------------------------------------------
//
// The owner, 25.09: «А если будет зависать? но из-за одно точки? как ты её будешь искать? Чтобы другие ещё поднять,
// а эту наоборот снизить?» · «Вся кривая -> полоса -> точка». A failed check becomes KNOWN FAILURES under the curve:
// the sampler writes every 500 ms, so WHICH frequency failed is not known — only the SPAN the card delivered within
// `FAILURE_ATTRIBUTION_WINDOW_MS` before the failing moment. Every frequency of that span (its ends and every curve
// row between) becomes a failure point at the voltage the check's own snapshot served it with; the builder floors each
// at «+ two grid steps» for f' ≥ f (`curve-proposal.raiseToFailures`). The union is the envelope «V(f) + 2 steps for
// every f the window could hold» — never less than the guilty frequency needs, whichever it was.
// ✏️ 2026-10-17, the judge of session 108 (F2): the first edition took the LOWEST frequency and ITS voltage, calling it
// «the side that cannot miss downward». It was the opposite: the lowest frequency is the lowest voltage, so its floor
// barely bit — a load failure with an idle sample in the window raised a few idle rows and none of the load rows.
// A LOAD failure is NOT attributed at all: its moment is the stage's END, after the load already died, so the window
// sees the idle that followed; it keeps the band ratchet (`nextMargins`).
// [NOT-TESTED] on the card — hygiene: the blocks «УРОВЕНЬ ЧАСТОТЫ…» of the selftest, mutations MV12–MV16.

/** The span of delivered frequencies in [atMs − window, atMs] — { loMhz, hiMhz }; the last sample before `atMs` when the window is empty; null without one. */
export function failureSpan(samples, atMs, windowMs = FAILURE_ATTRIBUTION_WINDOW_MS) {
  if (!Number.isFinite(atMs)) return null;
  const inWindow = samples.filter((s) => s.ms <= atMs && s.ms >= atMs - windowMs).map((s) => s.mhz);
  if (inWindow.length) return { loMhz: Math.min(...inWindow), hiMhz: Math.max(...inWindow) };
  let last = null;
  for (const s of samples) { if (s.ms <= atMs) last = s; else break; }
  return last ? { loMhz: last.mhz, hiMhz: last.mhz } : null;
}

/**
 * The voltage a curve serves `mhz` with: the card serves a frequency with the lowest entry that reaches it, so
 * the row of the smallest ladder frequency ≥ `mhz` (the top row above the ladder). `rows` = [{ mhz, voltageMv }]
 * in any order — a snapshot's `frequencies`. Null when there are no rows.
 */
export function curveVoltageAt(rows, mhz) {
  if (!Array.isArray(rows) || rows.length === 0 || !Number.isFinite(mhz)) return null;
  const sorted = [...rows].filter((r) => Number.isFinite(r?.mhz) && Number.isFinite(r?.voltageMv)).sort((a, b) => a.mhz - b.mhz);
  return (sorted.find((r) => r.mhz >= mhz) ?? sorted.at(-1) ?? null)?.voltageMv ?? null;
}

/** Every frequency a span could have failed at — its two ends and every curve row between — with the curve's voltage there. */
export function failurePoints(rows, span) {
  if (!span || !Array.isArray(rows) || rows.length === 0) return [];
  const fs = new Set([span.loMhz, span.hiMhz]);
  for (const r of rows) if (Number.isFinite(r?.mhz) && r.mhz > span.loMhz && r.mhz < span.hiMhz) fs.add(r.mhz);
  return [...fs].sort((a, b) => a - b).map((mhz) => ({ mhz, voltageMv: curveVoltageAt(rows, mhz) })).filter((p) => Number.isFinite(p.voltageMv));
}

// bugs/146 (2026-10-17, session 109) — THE STEP'S OWN DIFF IS A SUSPECT TOO. Live 17.10 14:17 and 14:19: a step that
// lowered ONLY 2800–2900 MHz failed twice in the first Q2RTX pass, and the 2-s window held only top samples (Q2RTX's
// light frames run 3000+ MHz, the clock swings faster than the 500-ms sampler resolves) — so the floors landed on the top
// and the band the step changed stayed down. The window says where the card WAS, not what FAILED.
// FORK: options <window only (as was) | window ∪ rows the step lowered against the last PASSED check of the mode | the
//   step's rows only> · price of error <a floor on the wrong rows: the guilty band is descended again (driver resets, a
//   possible hang) or an innocent band is blocked> · consulted <delta debugging — the change between the last good and the
//   first bad run is the prime suspect (Zeller, «Yesterday, my program worked», ESEC/FSE 1999; the method `git bisect`
//   mechanizes); the overclocking rule «one change at a time — instability after a change indicts that change»; EXP-0305:
//   under uncertainty take the envelope over every candidate, never one end>. Chosen: the union — the window keeps what
//   it honestly saw, the diff adds what the step changed; each row at its own voltage of THIS check's snapshot.
// [NOT-TESTED] on the card — hygiene: block «УРОВЕНЬ ЧАСТОТЫ: СТРОКИ, ОПУЩЕННЫЕ ШАГОМ…», mutation MV18; the 17.10 failures
// re-attributed on their recorded telemetry and snapshots (`bugs/146`).

/** Rows the check's curve serves LOWER than the base curve does — each at the check's own voltage. Empty without a base. */
export function stepDiffPoints(rows, baseRows) {
  if (!Array.isArray(rows) || !Array.isArray(baseRows) || baseRows.length === 0) return [];
  return rows.filter((r) => Number.isFinite(r?.mhz) && Number.isFinite(r?.voltageMv))
    .filter((r) => { const b = curveVoltageAt(baseRows, r.mhz); return Number.isFinite(b) && b > r.voltageMv; })
    .map((r) => ({ mhz: r.mhz, voltageMv: r.voltageMv })).sort((a, b) => a.mhz - b.mhz);
}

/**
 * The base of a step: the snapshot of the LAST PASSED check of `mode` before `beforeSeq` (a smoke counts — it is a
 * check of the same journal). Null when the mode has none, or it passed with no curve (stock).
 */
export function lastPassedSnapshot(records, mode, beforeSeq = Infinity) {
  const checks = checkRecords(records);
  const passed = new Set(checks.filter((r) => r.state === LINE.VERDICT && r.verdict === CHECK_VERDICT.PASSED).map((r) => r.seq));
  const hit = checks.filter((r) => r.state === LINE.INTENT && r.mode === mode && r.seq < beforeSeq && passed.has(r.seq)).at(-1);
  return hit?.snapshot ?? null;
}

/**
 * The journal's `failureAt` of one failure: { loMhz, hiMhz, points, stepPoints } — `points` null when the curve is
 * unknown (no snapshot: a stock check); the whole field null for a LOAD failure (its moment is not the failing one) or
 * without a durable sample. `baseRows` = the last passed check's curve: the rows this check lowered against it join the
 * points (bugs/146); `stepPoints` counts them. Only `points` reach the builder.
 */
export function attributeFailure({ samples, failure, rows = null, baseRows = null }) {
  if (!failure || failure.cls === FAILURE_CLASS.LOAD) return null;
  const span = failureSpan(samples, failure.atMs);
  if (!span) return null;
  const diff = stepDiffPoints(rows, baseRows);
  const byMhz = new Map([...failurePoints(rows, span), ...diff].map((p) => [p.mhz, p]));
  const points = [...byMhz.values()].sort((a, b) => a.mhz - b.mhz);
  return { ...span, points: points.length ? points : null, stepPoints: diff.length };
}

/**
 * The failures the CHECK journal knows, in the builder's shape ({ mhz, mv, … } — `curve-proposal.failures`'s
 * form): every point of every failed check's `failureAt`. A failure the instrument could not attribute (a LOAD
 * failure, no durable sample, no snapshot) is NOT here — it is the band ratchet's business (`nextMargins`).
 * Known limit (judge F3, 2026-10-17): a floor is permanent and carries no driver stamp — by design of the ratchet
 * (ЗАКАЗ.md §3: a failure is never descended through again); a floor recorded in error is withdrawn by a correction
 * line in the journal, the way the sweep journal's are (`sweep-journal.corrections`) — not yet built for the check.
 */
export function checkFailureFloors(records) {
  return checkRecords(records)
    .filter((r) => r.state === LINE.VERDICT && r.verdict === CHECK_VERDICT.FAILED && Array.isArray(r.failureAt?.points))
    .flatMap((r) => r.failureAt.points.filter((p) => Number.isFinite(p?.mhz) && Number.isFinite(p?.voltageMv))
      .map((p) => ({ mhz: p.mhz, mv: p.voltageMv, seq: r.seq, at: r.at ?? null, kind: `проверка режима: ${r.failure?.cls ?? 'сбой'}`, decidedBy: 'mode-check', from: 'выданная (проверка режима)', orderedMhz: null })))
    .sort((a, b) => a.mhz - b.mhz || a.mv - b.mv);
}

/** «2865 МГц» or «2700…2900 МГц». */
const spanText = (a) => (a.loMhz === a.hiMhz ? `${a.loMhz} МГц` : `${a.loMhz}…${a.hiMhz} МГц`);

// -------------------------------------------------------------------------------------------------
// Ш5 — the verdict
// -------------------------------------------------------------------------------------------------

/**
 * PASSED only when the driver stayed silent, every stage of the mix ended normally and the sampler
 * never lost its beat. A check with NO telemetry is UNKNOWN — the instrument did not observe, which
 * is neither a pass nor a failure of the silicon. The failure is attributed to the band the card
 * lived in at the EARLIEST failing moment.
 *
 * @param {{ms:number, mhz:number}[]} samples   parsed sampler records, time order
 * @param {{atMs:number}[]} driverEvents        `nvlddmkm` events inside the window
 * @param {{name:string, ok:boolean, endedAtMs:number, why?:string}[]} stages
 */
//
// FORK: options <any driver event fails the check | the series rule of researches/30 (≥ 2 in 120 s) | any event
//   fails only after a stock baseline showed none> · price of error <a false FAILED costs one ratchet step
//   (+2 grid steps in one band); a false PASSED accepts an unstable mode onto the owner's shortcut> ·
//   consulted <researches/39 §2.2 — stability tests (OCCT class) fail on ANY driver reset; researches/30
//   answers a DIFFERENT question — «is a death imminent, stop the rung» — where a single event is benign>.
//   Chosen: ANY event fails; `null` (the channel could not be read, driver-voice's contract) is UNKNOWN,
//   never PASSED. The owner's machine shows 1–3 events on quiet days, so Ф2's first act — the 20-minute
//   STOCK check — measures that background under the same mix: a stock check with events means this rule
//   is revisited BEFORE any descent. `[AI]`, revisable.
export function verdictOf({ samples = [], driverEvents = [], stages = [], stallMs = PULSE_STALL_MS, bands = MODE_BANDS } = {}) {
  if (samples.length === 0) return { verdict: CHECK_VERDICT.UNKNOWN, why: 'телеметрии нет — проверка не наблюдалась', failures: [], failure: null };
  const failures = [];
  for (const e of driverEvents ?? []) failures.push({ cls: FAILURE_CLASS.DRIVER, atMs: e.atMs, why: `событие драйвера ${e.id ?? ''}`.trim() });
  for (const st of stages) if (!st.ok) failures.push({ cls: FAILURE_CLASS.LOAD, atMs: st.endedAtMs, why: `${st.name}: ${st.why ?? 'нагрузка кончилась ненормально'}` });
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].ms - samples[i - 1].ms;
    if (gap > stallMs) failures.push({ cls: FAILURE_CLASS.TELEMETRY_GAP, atMs: samples[i - 1].ms, why: `сэмплер молчал ${gap} мс (порог ${stallMs})` });
  }
  failures.sort((a, b) => a.atMs - b.atMs);
  if (failures.length === 0 && driverEvents === null) return { verdict: CHECK_VERDICT.UNKNOWN, why: 'голос драйвера не прочитан — пройденной проверку назвать нельзя', failures, failure: null };
  if (failures.length === 0) return { verdict: CHECK_VERDICT.PASSED, why: 'драйвер молчал, нагрузки живы, телеметрия без разрывов', failures, failure: null };
  const first = failures[0];
  return { verdict: CHECK_VERDICT.FAILED, why: first.why, failures, failure: { ...first, band: bandAt(samples, first.atMs, bands) } };
}

// -------------------------------------------------------------------------------------------------
// Ш5 — the ratchet and the descent
// -------------------------------------------------------------------------------------------------

/**
 * The ratchet in millivolts per band: `steps` grid steps at the band's own voltages — the card's grid is
 * NOT uniform (5 mV ×94, 10 mV ×32), so a step is measured where the band lives, and the widest wins.
 * @param {{band:string, voltageMv:number}[]} rows  the curve's rows (bandedCurve output)
 */
export function ratchetMvByBand(rows, grid, { steps = RATCHET_GRID_STEPS, bands = MODE_BANDS } = {}) {
  const stepAt = (v) => { const up = grid.find((g) => g > v); const down = [...grid].reverse().find((g) => g <= v); return up !== undefined ? up - (down ?? v) : v - grid.at(-2); };
  return bands.map((b) => {
    const vs = rows.filter((r) => r.band === b.id).map((r) => stepAt(r.voltageMv));
    return steps * (vs.length ? Math.max(...vs) : Math.max(...grid.slice(1).map((g, i) => g - grid[i])));
  });
}

/**
 * The next margin vector.
 *   PASSED  → every VISITED band descends one step, never below its floor or 0.
 *   FAILED with failure POINTS (`failureAt.points`, plans/105 level 3) → NO band moves: the failure is a known failure now
 *             (`checkFailureFloors`), and the builder's floor raises its neighbourhood alone — «эту наоборот снизить,
 *             другие ещё поднять»; the band's other frequencies keep their margin and keep descending.
 *   FAILED without a frequency → the failure's band rises by its ratchet and is FLOORED there; an unknown band (a
 *             death with no durable sample) raises EVERY band — the conservative direction, named in `changes`.
 *   UNKNOWN → nothing moves.
 */
export function nextMargins({ margins, floors = null, verdict, visited = [], failureBand = null, failureAt = null, ratchetMv, stepMv = MARGIN_DESCENT_STEP_MV, bands = MODE_BANDS }) {
  const m = [...margins];
  // The floor of a band's descent: its ratchet floor; below the trend (margin < 0) only a LOAD band may go
  // (`config.NEGATIVE_MARGIN_FROM_MHZ`, plans/105) — the builder's failure floors end its descent there.
  const f = floors ? [...floors] : bands.map((b) => (b.loMhz >= NEGATIVE_MARGIN_FROM_MHZ ? -Infinity : 0));
  const changes = [];
  if (verdict === CHECK_VERDICT.PASSED) {
    for (const i of visited) {
      const to = Math.max(f[i], bands[i].loMhz >= NEGATIVE_MARGIN_FROM_MHZ ? -Infinity : 0, m[i] - stepMv);
      if (to !== m[i]) changes.push({ band: i, from: m[i], to, why: 'проверка пройдена, полоса посещена — спуск на шаг' });
      m[i] = to;
    }
  } else if (verdict === CHECK_VERDICT.FAILED && Array.isArray(failureAt?.points) && failureAt.points.length > 0) {
    // Without points the builder cannot see the failure (`checkFailureFloors`) — then the band ratchet below holds.
    const i = bandOf(failureAt.hiMhz, bands);
    changes.push({ band: i, from: m[i], to: m[i], why: `сбой приписан частотам ${spanText(failureAt)} (точек пола ${failureAt.points.length}) — запас полосы не меняется, пол построителя поднимет их окрестность` });
  } else if (verdict === CHECK_VERDICT.FAILED) {
    const targets = Number.isInteger(failureBand) && failureBand >= 0 ? [failureBand] : m.map((_, i) => i);
    for (const i of targets) {
      const to = m[i] + ratchetMv[i];
      changes.push({ band: i, from: m[i], to, why: targets.length > 1 ? 'сбой без полосы (нет долговечной пробы) — храповик во всех полосах' : 'сбой в этой полосе — храповик и пол' });
      m[i] = to;
      f[i] = Math.max(f[i], to);
    }
  }
  return { margins: m, floors: f, changes };
}

// -------------------------------------------------------------------------------------------------
// Ш3 — the check's journal (the sweep journal's fsync, not a second definition of it)
// -------------------------------------------------------------------------------------------------

/** Open the check's journal. The argument is an OBJECT — the sweep journal's own guard (bugs/08). */
export function openValidateJournal({ dir = VALIDATE_DIR } = {}) { return openJournal({ dir }); }

const checkRecords = (records) => records.filter((r) => r?.kind === CHECK_KIND);
const nextSeq = (records) => records.reduce((mx, r) => Math.max(mx, Number(r?.seq) || 0), 0) + 1;

/** The intent — written and fsync'ed BEFORE the card is touched; carries where its telemetry goes. */
export function writeCheckIntent(journal, { mode, candidate = null, snapshot = null, margins = null, telemetryPath = null, at }, io = {}) {
  const { records } = readJournal(journal);
  const rec = { state: LINE.INTENT, kind: CHECK_KIND, seq: nextSeq(records), mode, candidate, snapshot, margins, telemetryPath, at };
  appendLine(journal, rec, io);
  return rec;
}

/** The verdict that closes an intent. */
export function writeCheckVerdict(journal, { seq, verdict, failure = null, failureAt = null, hits = null, at, why = '' }, io = {}) {
  // `failureAt` = { loMhz, hiMhz, points: [{ mhz, voltageMv }] | null } — plans/105 level 3; `checkFailureFloors` hands the points to the builder.
  const rec = { state: LINE.VERDICT, kind: CHECK_KIND, seq, verdict, failure, failureAt, hits, why, at };
  appendLine(journal, rec, io);
  return rec;
}

/**
 * An intent nobody closed IS the answer: the check was in flight when the machine died. The verdict is
 * FAILED/death, and the band is the one the LAST durable sample of that check's telemetry names
 * (ЗАКАЗ.md §4). `readSamples(path)` is injected so the rule is provable without a card.
 */
export function deathVerdicts(records, { readSamples = (p) => parseSamples(readFileSync(p, 'utf8')).samples, rowsOf = null, bands = MODE_BANDS } = {}) {
  // `rowsOf(snapshotId)` — the check's snapshot rows, for the failure points of the death's span (plans/105 Ш2);
  // injected so the rule is provable without files; null → the death keeps its band ratchet only.
  return orphanIntents(checkRecords(records)).map((intent) => {
    let samples = [];
    try { samples = intent.telemetryPath ? readSamples(intent.telemetryPath) : []; } catch { samples = []; }
    const last = samples.at(-1) ?? null;
    let rows = null;
    try { rows = rowsOf && intent.snapshot ? rowsOf(intent.snapshot) : null; } catch { rows = null; }
    // bugs/146: the base of the step — the last passed check of this mode before the dead one, from the same journal.
    let baseRows = null;
    try { const b = lastPassedSnapshot(records, intent.mode, intent.seq); baseRows = rowsOf && b ? rowsOf(b) : null; } catch { baseRows = null; }
    const failureAt = last ? attributeFailure({ samples, failure: { cls: FAILURE_CLASS.DEATH, atMs: last.ms }, rows, baseRows }) : null;
    return {
      seq: intent.seq, mode: intent.mode, verdict: CHECK_VERDICT.FAILED,
      failureAt,
      failure: { cls: FAILURE_CLASS.DEATH, atMs: last?.ms ?? null, band: last ? bandOf(last.mhz, bands) : null, lastMhz: last?.mhz ?? null, why: last ? `незакрытое намерение; последняя долговечная проба ${last.mhz} МГц` : 'незакрытое намерение; долговечных проб нет — полоса неизвестна' },
    };
  });
}

// -------------------------------------------------------------------------------------------------
// Ш4 (offline half) — the mix of loads as DATA, and its scaling to `--minutes`
// -------------------------------------------------------------------------------------------------
//
// plans/102 «Схема прибора»: idle 60 s → Q2RTX 6 min → transitions 10×(5 s load / 5 s idle) → burn
// levels 3→0, 4 min → Q2RTX 6 min → idle 60 s. The type of load is the agent's freedom (the owner,
// 26.08: «мне плевать на тип нагрузки»); IDLE AND TRANSITIONS ARE NOT — the one proven death of 08.09
// came at rest after a deep write (researches/36), and the industry catches instability exactly there
// (researches/39 §2.2). So every scaled mix keeps both ends idle and at least two transition cycles.
// The executor that maps a stage onto the card (graphics-load · stress-tester · hardware-mon) is the
// other half of Ш4 and is not in this file yet.

export const MIX_STAGE = Object.freeze({ IDLE: 'idle', GAME: 'game', TRANSITIONS: 'transitions', BURN: 'burn' });
const MIN_STAGE_S = 5;           // [AI] a stage shorter than one sampler window beat pair says nothing
const MIN_TRANSITION_CYCLES = 2; // [AI] one cycle is a step, two are a transition pattern

export const CANONICAL_MIX = Object.freeze([
  { kind: MIX_STAGE.IDLE, seconds: 60, label: 'простой после записи' },
  { kind: MIX_STAGE.GAME, seconds: 360, label: 'Q2RTX, демо в цикле' },
  { kind: MIX_STAGE.TRANSITIONS, cycles: 10, onS: 5, offS: 5, label: 'переходы нагрузка ↔ простой' },
  { kind: MIX_STAGE.BURN, seconds: 60, level: 3, label: 'прожиг, уровень 3' },
  { kind: MIX_STAGE.BURN, seconds: 60, level: 2, label: 'прожиг, уровень 2' },
  { kind: MIX_STAGE.BURN, seconds: 60, level: 1, label: 'прожиг, уровень 1' },
  { kind: MIX_STAGE.BURN, seconds: 60, level: 0, label: 'прожиг, уровень 0' },
  { kind: MIX_STAGE.GAME, seconds: 360, label: 'Q2RTX, демо в цикле' },
  { kind: MIX_STAGE.IDLE, seconds: 60, label: 'простой в конце' },
].map(Object.freeze));

export const stageSeconds = (s) => (s.kind === MIX_STAGE.TRANSITIONS ? s.cycles * (s.onS + s.offS) : s.seconds);

/** The mix for a check of `minutes`: the canonical mix (~20 min) as is when no length is asked, else scaled,
 *  every stage kind kept. */
export function planMix({ minutes = null } = {}) {
  const canon = CANONICAL_MIX.reduce((s, x) => s + stageSeconds(x), 0);
  if (minutes === null) return { stages: CANONICAL_MIX.map((s) => ({ ...s })), totalS: canon, requestedS: canon };
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error(`длительность проверки «${minutes}» — нужно число минут > 0`);
  const k = (minutes * 60) / canon;
  const stages = CANONICAL_MIX.map((s) => (s.kind === MIX_STAGE.TRANSITIONS
    ? { ...s, cycles: Math.max(MIN_TRANSITION_CYCLES, Math.round(s.cycles * k)) }
    : { ...s, seconds: Math.max(MIN_STAGE_S, Math.round(s.seconds * k)) }));
  return { stages, totalS: stages.reduce((s, x) => s + stageSeconds(x), 0), requestedS: Math.round(minutes * 60) };
}

// -------------------------------------------------------------------------------------------------
// Ш4 (the executor's SHAPE) — one check, driven through injected seams
// -------------------------------------------------------------------------------------------------
//
// The ORDER is the whole safety of the check, and it is fixed here, where it can be proved without a card:
//   1. the intent is fsync'ed BEFORE the card is touched (ЗАКАЗ.md §3: «журнал намерений с fsync до
//      записи в карту») — a death after the write must find it;
//   2. the sampler starts BEFORE the apply — the one proven death of 08.09 came 10 s after a write, at
//      rest (researches/36): a sampler started later would have nothing to attribute it to;
//   3. the mix stops at the first failing stage — a failed mode is not driven further;
//   4. the rollback runs in `finally`, whatever threw (ЗАКАЗ.md §3: «откат в finally»);
//   5. the verdict closes the intent — a clean return leaves no orphan.
// A refused apply is UNKNOWN (the check did not happen), never PASSED and never a failure of the silicon.
//
// seams = { startSampler(path) → { stop() }, apply() → { ok, why }, runStage(stage) → { ok, why, endedAtMs },
//           rollback() → { ok, why }, readSamples(path) → { samples, periodMs }, driverEvents(fromMs, toMs) → [...] }
// The real seams (the shortcut's apply path, graphics-load, stress-tester, hardware-mon, driver-voice) are
// wired on the first card day; until then this is [NOT-TESTED] on the card and proved on fakes only.

/**
 * THE CANDIDATE AS A PROFILE (plans/102 Ш2): the mode's own profile with ONE difference that matters —
 * the curve is the candidate's battle snapshot — marked a draft (`qualified: false` + `draft`), stamped
 * with the driver the check runs on. Written as `profiles/candidate-<mode>.local.json` (git-ignored); the
 * mode's battle profile and its shortcut are not touched until the candidate is ACCEPTED. The applier
 * refuses a draft without an explicit consent (profile-manager, «согласие черновика»), which the check
 * gives — the owner's click is never simulated.
 */
export function candidateProfile(modeProfile, { snapshotId, stamp, takenAt, margins = null }) {
  return {
    name: `candidate-${modeProfile.mode}.local`, // = the file stem: profile-store refuses a name that differs from its file
    title: `${modeProfile.title} — кандидат проверки`,
    mode: modeProfile.mode,
    qualified: false,
    draft: { candidate: `снимок ${snapshotId}${margins ? ` · запас по полосам ${margins.map(signedMv).join('/')}` : ''}`, source: 'эпик 101 Ф1 Ш2 (plans/102); проверка целого режима' },
    settings: { ...modeProfile.settings, curveRef: null, curveSnapshot: snapshotId },
    stamp: { driver: stamp.driver, vbios: stamp.vbios, takenAt },
    evidence: { 'КАНДИДАТ': `построен из профиля «${modeProfile.name}» заменой кривой на снимок ${snapshotId}; прожига нет — доказательство только проверка режима` },
  };
}

// -------------------------------------------------------------------------------------------------
// plans/105 Ш3 — ONE STEP OF THE APPROXIMATION IS ONE COMMAND (E101-AC5: «один шаг — одна команда, откат — одно действие»)
// -------------------------------------------------------------------------------------------------
//
// `npm run validate -- --step --mode <режим> --band-margins a,…,g [--minutes N] [--dry-run]`:
//   the builder's banded curve (the sweep's edges + the check journal's failures) → a tuning-curve DOCUMENT
//   (named by its margins, the card's driver and a hash of its rows — the same rows reuse the same file, a changed
//   floor gets a new one; documents are never overwritten) → a battle SNAPSHOT of it → the CANDIDATE profile
//   (`profiles/candidate-<mode>.local.json`, git-ignored, a draft) → the whole-mode check.
// A composition of existing functions: `curve-proposal` (bandedCurve, exhaustedBands, curveDocFromRows), `curve-store`
// (validateCurveDoc, saveCurveDoc, takeSnapshot), `profile-store` (probeCard — READ-ONLY, validateProfile) and this
// module (candidateProfile, the check). No new rule lives here. `--dry-run` reads the card's stamp and the files and
// writes NOTHING — not the card, not a document, not a snapshot, not the candidate, not the journal.
// The rollback of an accepted step is one action: the mode's profile points at the previous snapshot (ЗАКАЗ.md §10).
// [NOT-TESTED] on the card — hygiene: «ШАГ…» blocks of the selftest on injected deps (the dry run writes nothing).

export const STEP_MODES = Object.freeze(['optimised', 'max-performance', 'silent-cold']);

/** The step document's name: margins (negative → `n`), the card's driver, the rows' hash — `[a-z0-9-]` only. */
export function stepDocName(margins, driver, rowsSha) {
  return `model-bands-${margins.map((m) => (m < 0 ? `n${-m}` : String(m))).join('-')}-d${String(driver).replace(/\./g, '-')}-${String(rowsSha).slice(0, 6)}`;
}

async function loadStepDeps() {
  const cp = await import('../../tools/curve-proposal.mjs');
  const cs = await import('./curve-store.mjs');
  const ps = await import('./profile-store.mjs');
  const cg = await import('./card-grids.mjs');
  const { existsSync } = await import('node:fs');
  return {
    propose: cp.propose, marginRefusal: cp.marginRefusal, bandedCurve: cp.bandedCurve, exhaustedBands: cp.exhaustedBands, curveDocFromRows: cp.curveDocFromRows,
    validateCurveDoc: cs.validateCurveDoc, saveCurveDoc: cs.saveCurveDoc, takeSnapshot: cs.takeSnapshot, snapshotIdFor: cs.snapshotIdFor,
    docExists: (name) => existsSync(cs.curvePath(name)), frequencyGrid: () => cg.loadGrid('frequency'),
    probeCard: ps.probeCard, validateProfile: ps.validateProfile,
    readModeProfile: (mode) => JSON.parse(readFileSync(join(ps.PROFILES_DIR, `${mode}.json`), 'utf8')),
    candidateFile: (mode) => join(ps.PROFILES_DIR, `candidate-${mode}.local.json`),
    writeCandidate: (file, obj) => writeFileSync(file, JSON.stringify(obj, null, 2) + '\n'),
    nowIso: () => cg.localIso(),
  };
}

/**
 * Prepare one approximation step (everything before the card). Returns what the step IS — margins, the curve per
 * band, which bands are exhausted, the document, and (not dry) the snapshot and the candidate. Throws by name on a
 * refused margin vector, a document the validator refuses, or a candidate the profile format refuses.
 */
export async function prepareStep({ mode, margins, dry = false, deps = null }) {
  if (!STEP_MODES.includes(mode)) throw new Error(`шаг не строится: режим «${mode}» — шаг приближения есть только у ${STEP_MODES.join(' · ')}`);
  const D = deps ?? await loadStepDeps();
  const why = D.marginRefusal(margins);
  if (why) throw new Error(`шаг не строится: ${why}`);
  const card = D.probeCard();                                   // read-only: the driver the check will run on
  const p = D.propose();
  const stock = new Map(p.facts.rows.map((r) => [r.mhz, r.stockVoltageMv]));
  const ladder = p.facts.rows.map((r) => r.mhz);
  const args = { ladder, stockAt: (m) => stock.get(m), grid: p.facts.grid, anchors: p.anchors, credible: p.credible, maxMhz: p.facts.card?.maxGraphicsMhz ?? Math.max(...ladder), margins };
  const banded = D.bandedCurve(args);
  const exhausted = D.exhaustedBands(args);
  const { createHash } = await import('node:crypto');
  const rowsSha = createHash('sha256').update(banded.rows.map((r) => `${r.mhz}:${r.voltageMv}`).join(',')).digest('hex');
  const docName = stepDocName(margins, card.driver, rowsSha);
  const takenAt = D.nowIso();
  const dataDriver = p.facts.stamp?.driver;
  const stamp = { ...p.facts.stamp, driver: card.driver, vbios: card.vbios ?? p.facts.stamp?.vbios, ...(dataDriver && dataDriver !== card.driver ? { dataDriver } : {}) };
  const doc = D.curveDocFromRows({ rows: banded.rows, name: docName, card: p.facts.card, grid: p.facts.grid, stamp, takenAt });
  const refusals = D.validateCurveDoc(doc, { card: doc.card, frequencyGrid: D.frequencyGrid() });
  if (refusals.length) throw new Error(`шаг не строится: документ кривой не прошёл валидатор — ${refusals.slice(0, 5).map((r) => `${r.field}: ${r.why}`).join(' · ')}`);
  const modeProfile = D.readModeProfile(mode);
  const candidateFile = D.candidateFile(mode);
  const step = { mode, margins, card: { driver: card.driver, vbios: card.vbios }, docName, docExists: D.docExists(docName), perBand: banded.perBand, exhausted,
    failRaises: banded.failRaises, monotoneRaises: banded.monotoneRaises, checkFloors: (p.checkFloors ?? []).length, candidateFile, dry, snapshotId: null };
  if (dry) return step;
  if (!step.docExists) D.saveCurveDoc(doc, { name: docName });
  const { snapshot } = D.takeSnapshot({ name: docName, nowIso: takenAt });
  step.snapshotId = D.snapshotIdFor(snapshot.takenAt);
  const cand = candidateProfile(modeProfile, { snapshotId: step.snapshotId, stamp: card, takenAt, margins });
  const bad = D.validateProfile(cand, { fileName: candidateFile });
  if (bad.length) throw new Error(`кандидат не записан: ${bad.slice(0, 5).map((r) => `${r.field}: ${r.why}`).join(' · ')}`);
  D.writeCandidate(candidateFile, cand);
  step.candidate = cand;
  return step;
}

/** What a step prints before the card — pure, so the dry run's promise is a block, not a console.log. */
export function renderStepPlan(step) {
  const L = [`ШАГ ПРИБЛИЖЕНИЯ · режим ${step.mode} · запас по полосам ${step.margins.map(signedMv).join('/')} · карта: драйвер ${step.card.driver}`];
  L.push(`  отказов проверок режима под кривой (уровень частоты): ${step.checkFloors} · подъёмов к известным отказам ${step.failRaises} · монотонность ${step.monotoneRaises}`);
  for (const [i, b] of step.perBand.entries()) L.push(`  ${b.label}: запас ${signedMv(b.marginMv)} · глубина под стоком ${b.depthMinMv ?? '—'}…${b.depthMaxMv ?? '—'} мВ · ${step.exhausted[i] ? 'исчерпана (ещё шаг ничего не сдвинет)' : 'можно ниже'}`);
  L.push(`  документ: curves/${step.docName}.json ${step.docExists ? '(уже есть — те же строки, переиспользуется)' : '(новый)'}`);
  L.push(step.dry ? '  СУХОЙ ПРОГОН: документ, снимок, кандидат, журнал и карта не тронуты.'
    : `  снимок: ${step.snapshotId} · кандидат: ${String(step.candidateFile).replace(/\\/g, '/')}`);
  return L.join('\n');
}

/**
 * The REAL driver-voice seam: `nvlddmkm` events in [fromMs, toMs] from the Windows event log (read-only,
 * the OS — not the card), through the project's one reader (`driver-voice.driverEventsInWindow` over
 * `event-logger.queryFaults`, the same pair `engine.mjs` uses). `null` = the channel could not be read.
 */
export function realDriverEvents(fromMs, toMs, queryFn = queryFaults) {
  const events = driverEventsInWindow({ fromMs, toMs }, queryFn);
  return events === null ? null : events.map((e) => ({ atMs: momentOf(e), id: e.id ?? e.eventId ?? null }));
}

export async function runCheck({ journal, mode, candidate = null, snapshot = null, margins = null, plan, telemetryPath, seams, nowMs = () => Date.now(), atIso = () => new Date().toISOString() }) {
  const intent = writeCheckIntent(journal, { mode, candidate, snapshot, margins, telemetryPath, at: atIso() });
  const startedMs = nowMs();
  const sampler = await seams.startSampler(telemetryPath);
  const stages = [];
  let applied = null;
  let rollback = null;
  let attempted = false;
  try {
    // The sampler is the death's only witness: no header within its window → the card is NOT touched.
    const ready = seams.waitSampler ? await seams.waitSampler(telemetryPath) : true;
    if (!ready) applied = { ok: false, why: 'сэмплер не поднялся — карта не тронута' };
    else { attempted = true; applied = await seams.apply(); }
    if (applied?.ok) {
      for (const stage of plan.stages) {
        let r;
        try { r = await seams.runStage(stage); } catch (e) { r = { ok: false, why: `исключение: ${e?.message ?? e}`, endedAtMs: nowMs() }; }
        stages.push({ name: stage.label, kind: stage.kind, ...r });
        if (!r.ok) break;
      }
    }
  } finally {
    if (attempted) { try { rollback = await seams.rollback(); } catch (e) { rollback = { ok: false, why: `откат бросил: ${e?.message ?? e}` }; } }
    try { sampler?.stop?.(); } catch { /* the sampler's file is already durable line by line */ }
  }
  const endedMs = nowMs();
  if (!applied?.ok) {
    const why = `режим не применён: ${applied?.why ?? 'нет ответа применителя'} — проверки не было`;
    writeCheckVerdict(journal, { seq: intent.seq, verdict: CHECK_VERDICT.UNKNOWN, at: atIso(), why });
    return { seq: intent.seq, mode, candidate, snapshot, margins, fromMs: startedMs, toMs: endedMs, verdict: { verdict: CHECK_VERDICT.UNKNOWN, why, failure: null, failures: [] }, stages, rollback, hits: null, samples: null, driverEvents: null };
  }
  const { samples, periodMs } = seams.readSamples(telemetryPath);
  const events = seams.driverEvents(startedMs, endedMs);
  const v = verdictOf({ samples, driverEvents: events, stages: stages.map((s) => ({ ...s, name: s.name })) });
  const hits = hitMap(samples, { periodMs });
  // plans/105 level 3: the failure's span and its points on THIS check's curve (the snapshot seam).
  let failureAt = null;
  if (v.failure) {
    let rows = null;
    try { rows = seams.snapshotRows ? await seams.snapshotRows() : null; } catch { rows = null; }
    // bugs/146: the curve of the last PASSED check of this mode before this one — the step's diff joins the points.
    let baseRows = null;
    try { baseRows = seams.baseRows ? await seams.baseRows(readJournal(journal).records, mode, intent.seq) : null; } catch { baseRows = null; }
    failureAt = attributeFailure({ samples, failure: v.failure, rows, baseRows });
  }
  const why = rollback?.ok === false ? `${v.why} · ⚠️ ОТКАТ НЕ ПОДТВЕРЖДЁН: ${rollback.why}` : v.why;
  writeCheckVerdict(journal, { seq: intent.seq, verdict: v.verdict, failure: v.failure, failureAt, hits: hits.map((h) => ({ id: h.id, seconds: h.seconds })), at: atIso(), why });
  return { seq: intent.seq, mode, candidate, snapshot, margins, fromMs: startedMs, toMs: endedMs, verdict: v, failureAt, stages, rollback, hits,
    samples: { count: samples.length, periodMs, maxGapMs: maxGapMs(samples) }, driverEvents: events };
}

// -------------------------------------------------------------------------------------------------
// The REAL seams — the card, wired through the project's own library (recon 2026-09-25, file:line in plans/102 Ш4)
// -------------------------------------------------------------------------------------------------
//
// [NOT-TESTED] on the card. The WIRING is proved on fakes (`lib` is injected); the hardware behaviour is the
// smoke of Ш8 with the owner present. Facts this wiring rests on (read, not run):
//   apply()     THROWS (never returns {ok}); a snapshot curve must be resolved first (resolveProfileCurve →
//               nvapiCurveBackend → apply(..., { card, curveBackend, curve, consent }) → close in finally);
//               a draft needs `consent` — the check names itself, the owner's click is never simulated.
//   rollback    resetToFactory(backend, { knownLockMhz: applied.lockedTo, curveBackend: FRESH nvapi backend }).
//               The library does NOT touch the remembered boot state — a check never changes what boots.
//   sampler     a SEPARATE process (`hardware-mon --seconds S --out F`, fsync per line): the burn's spawnSync
//               freezes this process's event loop, an in-process sampler would record nothing.
//   game        runTimedemo({ runs }) has no duration: one demo pass ≈ 11 s, so runs = ceil(seconds / 11).
//   burn L      stressTest(runOptionsForShape(sweepBurnShape(L)[0], { seconds, sustain })); verdict null =
//               the comparison did not happen (golden missing/stale) — NOT a failure of the mode.
//   transitions stressTest({ transient: true }) runs the config duty 5 s / 5 s bounded by TIME.
// Loaded lazily: nothing of this reaches `curve --progress` or the selftest's import graph.

export const DEMO_PASS_S = 11;        // one Q2RTX demo pass, measured 10.6–14.2 s in runs/graphics/exp0914_*.json
export const TRANSITIONS_LEVEL = 1;   // [AI] a mid furnace level for the load/idle steps (0 = strongest, 3 = weakest)
const SAMPLER_PAD_S = 120;            // the sampler outlives the mix: a death after the last stage must still be sampled

async function loadCardLib() {
  const pm = await import('./profile-manager.mjs');
  const ps = await import('./profile-store.mjs');
  const gl = await import('./graphics-load.mjs');
  const st = await import('./stress-tester.mjs');
  const cs = await import('./curve-store.mjs'); // safe here: the CLI runs in a function (bugs/141), this module has finished evaluating
  const { spawn } = await import('node:child_process');
  const { existsSync: exists } = await import('node:fs');
  const MON = join(HERE, 'hardware-mon.mjs');
  return {
    spawnSampler: (path, seconds) => spawn(process.execPath, [MON, '--seconds', String(seconds), '--out', path], { windowsHide: true, stdio: 'ignore' }),
    samplerReady: (path) => exists(path) && readFileSync(path, 'utf8').includes('\n'),
    probeCard: ps.probeCard, resolveProfileCurve: pm.resolveProfileCurve, nvapiCurveBackend: pm.nvapiCurveBackend,
    nvidiaSmiBackend: pm.nvidiaSmiBackend, apply: pm.apply, resetToFactory: pm.resetToFactory,
    runTimedemo: gl.runTimedemo, stressTest: st.stressTest, runOptionsForShape: st.runOptionsForShape,
    sweepBurnShape: st.sweepBurnShape, FURNACE_LADDER: st.FURNACE_LADDER, loadSnapshot: cs.loadSnapshot,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)), nowMs: () => Date.now(),
  };
}

/** The seams of `runCheck` over the real card. `lib` is injectable — the selftest drives it with fakes. */
export async function makeCardSeams({ profile, totalS, consent = 'проверка режима (эпик 101 Ф1)', lib = null }) {
  const L = lib ?? await loadCardLib();
  let applied = null;
  return {
    startSampler(path) {
      const child = L.spawnSampler(path, totalS + SAMPLER_PAD_S);
      return { child, stop: () => { try { child.kill(); } catch { /* already gone */ } } };
    },
    async waitSampler(path, timeoutMs = 10_000) {
      for (let t = 0; t < timeoutMs; t += 100) { if (L.samplerReady(path)) return true; await L.sleep(100); }
      return false;
    },
    async apply() {
      let cb = null;
      try {
        const card = await L.probeCard();
        const curve = await L.resolveProfileCurve(profile);
        // ALWAYS a curve backend: for the factory profile `apply()` zeroes the curve only when handed one (the CLI
        // hands one since bugs/140 — `applyNeedsCurveBackend`), and a stock check on a card still carrying offsets
        // would not be a stock check.
        cb = L.nvapiCurveBackend();
        applied = await L.apply(L.nvidiaSmiBackend(), profile, { card, curveBackend: cb, curve, consent });
        return { ok: true, why: (applied.steps ?? []).join(' · ') };
      } catch (e) {
        return { ok: false, why: e?.message ?? String(e) };
      } finally { try { cb?.close?.(); } catch { /* the rollback opens its own */ } }
    },
    async runStage(stage) {
      try {
        if (stage.kind === MIX_STAGE.IDLE) { await L.sleep(stage.seconds * 1000); return { ok: true, endedAtMs: L.nowMs() }; }
        if (stage.kind === MIX_STAGE.GAME) {
          const run = await L.runTimedemo({ runs: Math.max(1, Math.ceil(stage.seconds / DEMO_PASS_S)) });
          const ok = run.exitCode === 0 && !run.timedOut;
          return { ok, why: ok ? `FPS ${run.stats?.median ?? '—'}` : `игра: код ${run.exitCode}${run.timedOut ? ', таймаут' : ''}`, endedAtMs: L.nowMs(), fps: run.stats?.median ?? null };
        }
        const opts = stage.kind === MIX_STAGE.TRANSITIONS
          ? { name: 'furnace', args: L.FURNACE_LADDER[TRANSITIONS_LEVEL].args, seconds: stageSeconds(stage), transient: true, sustain: stage.onS }
          : L.runOptionsForShape(L.sweepBurnShape(stage.level)[0], { seconds: stage.seconds, sustain: stage.seconds });
        const r = await L.stressTest(opts);
        const ok = r.verdict !== 'CRASH' && r.verdict !== 'SDC';
        return { ok, why: `прожиг: ${r.verdict ?? 'сравнение не состоялось'}${r.reason ? ' — ' + r.reason : ''}`, endedAtMs: L.nowMs() };
      } catch (e) {
        return { ok: false, why: `исключение: ${e?.message ?? e}`, endedAtMs: L.nowMs() };
      }
    },
    async rollback() {
      let cb = null;
      try {
        cb = L.nvapiCurveBackend();
        const r = await L.resetToFactory(L.nvidiaSmiBackend(), { knownLockMhz: applied?.lockedTo ?? null, curveBackend: cb });
        return { ok: true, why: (r.steps ?? []).join(' · ') };
      } catch (e) {
        return { ok: false, why: e?.message ?? String(e) };
      } finally { try { cb?.close?.(); } catch { /* nothing left to close */ } }
    },
    readSamples: (path) => parseSamples(readFileSync(path, 'utf8')),
    driverEvents: (fromMs, toMs) => realDriverEvents(fromMs, toMs),
    // plans/105 Ш2: the candidate's own snapshot rows (failure points); null for a curve-less (stock) profile.
    snapshotRows() {
      const id = profile?.settings?.curveSnapshot;
      if (!id || !L.loadSnapshot) return null;
      return L.loadSnapshot({ id })?.frequencies ?? null;
    },
    // bugs/146: the rows of the last PASSED check of the mode before `seq` — the base the step's diff is taken against.
    baseRows(records, mode, seq) {
      const id = lastPassedSnapshot(records, mode, seq);
      if (!id || !L.loadSnapshot) return null;
      return L.loadSnapshot({ id })?.frequencies ?? null;
    },
  };
}

/** Write the check's report next to its evidence: `<dir>/report.md` + `<dir>/result.json`. */
export function writeCheckReport(dir, result) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.md'), renderCheckReport(result));
  writeFileSync(join(dir, 'result.json'), JSON.stringify(result, null, 1) + '\n');
  return { report: join(dir, 'report.md'), result: join(dir, 'result.json') };
}

// -------------------------------------------------------------------------------------------------
// The check's report — runs/validate/<moment>/report.md + result.json (P102-AC5: visit map · telemetry ·
// the driver-voice window · verdict, all four present on every verdict, UNKNOWN included)
// -------------------------------------------------------------------------------------------------

const VERDICT_WORD = { [CHECK_VERDICT.PASSED]: 'ПРОЙДЕНА', [CHECK_VERDICT.FAILED]: 'СБОЙ', [CHECK_VERDICT.UNKNOWN]: 'НЕИЗВЕСТНО' };

/** Render the report of one check. Pure: every number comes from `r`, nothing is looked up. */
export function renderCheckReport(r) {
  const band = (i) => (Number.isInteger(i) && i >= 0 ? MODE_BANDS[i].label : 'неизвестна');
  const hms = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 19) + 'Z' : '—');
  const L = [];
  L.push(`# Проверка режима ${r.mode} — ${VERDICT_WORD[r.verdict.verdict] ?? r.verdict.verdict}`, '');
  L.push(`Окно: ${hms(r.fromMs)} … ${hms(r.toMs)} · кандидат: ${r.candidate ?? '—'} · снимок: ${r.snapshot ?? '—'} · запас по полосам: ${r.margins ? r.margins.map(signedMv).join('/') : '—'}`, '');
  L.push('## Вердикт', '', `**${VERDICT_WORD[r.verdict.verdict] ?? r.verdict.verdict}** — ${r.verdict.why}`);
  if (r.verdict.failure) L.push('', `Первый сбой: ${r.verdict.failure.cls} · полоса ${band(r.verdict.failure.band)} · ${hms(r.verdict.failure.atMs)} · ${r.verdict.failure.why}`);
  if (r.verdict.failure) L.push('', r.failureAt?.points
    ? `Отказ приписан частотам **${spanText(r.failureAt)}** (выданные за ${FAILURE_ATTRIBUTION_WINDOW_MS / 1000} с до сбоя)${r.failureAt.stepPoints ? ` и **${r.failureAt.stepPoints} строкам, опущенным шагом** против последней пройденной проверки режима` : ''}: точек пола ${r.failureAt.points.length}, напряжения снимка ${r.failureAt.points[0].voltageMv}…${r.failureAt.points.at(-1).voltageMv} мВ — построитель поднимет их окрестность`
    : r.failureAt ? `Отказ частотам ${spanText(r.failureAt)} НЕ приписан — кривая снимка неизвестна; действует храповик полосы`
    : r.verdict.failure.cls === FAILURE_CLASS.LOAD ? 'Отказ частоте НЕ приписан — сбой нагрузки, его момент — конец ступени; действует храповик полосы'
    : 'Отказ частоте НЕ приписан — долговечной пробы нет; действует храповик полосы');
  if (r.rollback) L.push('', `Откат: ${r.rollback.ok ? 'подтверждён' : '⚠️ НЕ ПОДТВЕРЖДЁН — ' + (r.rollback.why ?? '')}`);
  L.push('', '## Карта посещений', '', '| полоса | секунд | доля | посещена |', '|---|---|---|---|');
  const visited = new Set(r.hits ? visitedBands(r.hits) : []);
  for (const [i, h] of (r.hits ?? []).entries()) L.push(`| ${h.label} | ${h.seconds} | ${Math.round(h.share * 100)} % | ${visited.has(i) ? 'да' : '—'} |`);
  if (!r.hits) L.push('| — | — | — | телеметрии нет |');
  L.push('', '## Телеметрия', '', `Проб ${r.samples?.count ?? 0} · период ${r.samples?.periodMs ?? '—'} мс · наибольший разрыв ${r.samples?.maxGapMs ?? '—'} мс (порог ${PULSE_STALL_MS})`);
  L.push('', '## Голос драйвера', '', r.driverEvents === null ? 'Канал НЕ ПРОЧИТАН — молчание не выдаётся за «чисто».'
    : `Событий \`nvlddmkm\` в окне: ${r.driverEvents.length}${r.driverEvents.length ? ' — ' + r.driverEvents.map((e) => `${e.id} в ${hms(e.atMs)}`).join(' · ') : ''}`);
  L.push('', '## Ступени смеси', '', '| ступень | итог |', '|---|---|');
  for (const s of r.stages ?? []) L.push(`| ${s.name} | ${s.ok ? 'норма' : '❌ ' + (s.why ?? '')} |`);
  if (r.benefit) {
    L.push('', '## Выгода против стока (медианы под нагрузкой)', '', '| величина | сток | режим | разница |', '|---|---|---|---|');
    const f1 = (x) => (x === null || x === undefined ? '—' : String(Math.round(x * 10) / 10).replace('.', ','));
    for (const b of r.benefit) L.push(`| ${b.label} | ${f1(b.stock)} | ${f1(b.mode)} | ${b.delta === null ? '—' : (b.delta > 0 ? '+' : '') + f1(b.delta)}${b.deltaPct === null ? '' : ` (${b.deltaPct > 0 ? '+' : ''}${f1(b.deltaPct)} %)`} |`);
  }
  return L.join('\n') + '\n';
}

/** Largest gap between consecutive samples, ms (null when fewer than two). */
export const maxGapMs = (samples) => (samples.length < 2 ? null : Math.max(...samples.slice(1).map((s, i) => s.ms - samples[i].ms)));

// -------------------------------------------------------------------------------------------------
// The benefit table against stock (E101-AC2): frames · watts · degrees · fan · clock, loaded medians
// -------------------------------------------------------------------------------------------------
//
// «Loaded» is the project's one threshold (`config.LOAD_PHASE_UTILIZATION_PCT`, via
// `power-baseline.summarizeSamples`, the same split the graphics capture prints) — no second number here.
// A difference thinner than the instrument's own spread is not an effect (the owner, 2026-08-10): the FPS
// row therefore carries the spread of both sides when the caller has it.

export const BENEFIT_ROWS = Object.freeze([
  { key: 'fps', label: 'кадры, FPS' },
  { key: 'power.draw.instant', label: 'мощность, Вт' },
  { key: 'temperature.gpu', label: 'температура, °C' },
  { key: 'fan.speed', label: 'обороты, %' },
  { key: 'clocks.gr', label: 'частота под нагрузкой, МГц' },
]);

const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null; };
const listAfter = (flag) => { const i = process.argv.indexOf(flag); return i === -1 ? [] : String(process.argv[i + 1] ?? '').split(',').filter(Boolean); };

/**
 * A group of graphics capture records (runs/graphics/*.json) as one side of the table: their sampler files
 * POOLED and split by the project's load threshold; FPS = the median of the records' own medians.
 * `power-baseline` is loaded lazily (CLI only — this module stays light for `curve --progress`).
 */
export async function captureGroup(files) {
  const { summarizeSamples } = await import('./power-baseline.mjs');
  const recs = []; const fps = [];
  for (const f of files) {
    const cap = JSON.parse(readFileSync(f, 'utf8'));
    if (Number.isFinite(cap?.fps?.median)) fps.push(cap.fps.median);
    for (const line of readFileSync(join(dirname(f), cap.sampleFile), 'utf8').split('\n')) { try { const r = JSON.parse(line); if (r) recs.push(r); } catch { /* torn tail */ } }
  }
  const s = summarizeSamples(recs);
  return { loaded: s.loaded, fps: median(fps), n: s.counts.loaded };
}

/** @param {{loaded: object, fps: number|null, fpsSpreadPct?: number|null}} stock  @param mode — the same shape */
export function benefitRows({ stock, mode }) {
  const val = (side, key) => (key === 'fps' ? side.fps ?? null : side.loaded?.[key]?.median ?? null);
  return BENEFIT_ROWS.map(({ key, label }) => {
    const s = val(stock, key); const m = val(mode, key);
    const delta = s !== null && m !== null ? m - s : null;
    return { key, label, stock: s, mode: m, delta, deltaPct: delta !== null && s ? (delta / s) * 100 : null };
  });
}

// -------------------------------------------------------------------------------------------------
// Ш6 — the acceptance metric «режимов проверено Y/4» (ЗАКАЗ.md §2, MASTER_PLAN «Метрика приёмки»)
// -------------------------------------------------------------------------------------------------

/**
 * A mode counts as CHECKED when the LAST closed check of that mode passed AND was made on the curve
 * the mode's profile stands on TODAY (its snapshot id; `null` = no curve, the stock mode). A check of
 * another curve proves nothing about this one. The week of ordinary use (the second half of «проверен
 * целиком») is not tracked by any instrument yet — the line says so instead of counting it.
 */
export function modesValidated(records, { profiles = [], modes }) {
  const checks = checkRecords(records);
  const verdicts = new Map(checks.filter((r) => r.state === LINE.VERDICT).map((r) => [r.seq, r]));
  const byMode = new Map(profiles.filter((p) => p && typeof p === 'object').map((p) => [p.mode, p]));
  const last = {};
  for (const i of checks.filter((r) => r.state === LINE.INTENT)) {
    const v = verdicts.get(i.seq);
    if (v) last[i.mode] = { verdict: v.verdict, snapshot: i.snapshot ?? null, margins: i.margins ?? null, at: v.at ?? null };
  }
  const passed = modes.filter((m) => last[m]?.verdict === CHECK_VERDICT.PASSED
    && (last[m].snapshot ?? null) === (byMode.get(m)?.settings?.curveSnapshot ?? null));
  return { passed, total: modes.length, last, open: orphanIntents(checks).length };
}

/**
 * WHAT THE CARD GOT AT THE LAST LOGON — from `runs/shell/boot-apply.jsonl` (a file; the card is not read). EXP-0290:
 * `Optimised` was refused at every logon for a week after a driver update and no line anywhere said so; this line
 * turns «tail the boot log at /resume» from a habit into something `--progress` prints.
 */
export function lastBootLine(text) {
  // Intents count too (second judge, session 102): a restore that died mid-way leaves an intent with no verdict after it,
  // and skipping intents would print the PREVIOUS logon's verdict over a death. Housekeeping lines stay out.
  const recs = String(text ?? '').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((r) => r && ((r.verdict && r.verdict !== 'disks-disarmed') || r.state === 'intent'));
  const last = recs.at(-1);
  if (!last) return 'ПРИ ВХОДЕ: записей восстановления нет';
  const when = String(last.at ?? '').replace('T', ' ').slice(0, 16);
  if (!last.verdict) return `⚠️ ПРИ ВХОДЕ ${when}: восстановление «${last.remembered ?? '?'}» НЕ ЗАКРЫЛОСЬ — намерение без итога (возможна смерть машины при восстановлении)`;
  // `owner-cleared` is written by ANY manual `profile --apply` (profile-manager.mjs, the boot-loop breaker's release) — by
  // the owner or by the agent; the record does not say who. The line said «владелец сбросил» and was false on 2026-09-25
  // (the agent's apply of a candidate at 19:10) — the judge of session 104 caught it.
  if (last.verdict === 'owner-cleared') return `ВРУЧНУЮ ${when}: режим «${last.remembered ?? '—'}» применён командой --apply (кем — запись не говорит); это не вход в систему`;
  if (last.verdict === 'applied') return `ПРИ ВХОДЕ ${when}: «${last.remembered}» применён`;
  if (last.verdict === 'degraded-to-factory') return `⚠️ ПРИ ВХОДЕ ${when}: «${last.remembered}» ОТВЕРГНУТ, стоит заводское — ${String(last.detail ?? '').replace(/^.*?заводское стоит:\s*/, '').slice(0, 140)}`;
  return `ПРИ ВХОДЕ ${when}: ${last.verdict}${last.remembered ? ` («${last.remembered}»)` : ''}`;
}

/** The metric line — first line of `npm run curve -- --progress`. */
export function renderValidatedLine(v) {
  const margins = Object.entries(v.last).filter(([, x]) => Array.isArray(x.margins))
    .map(([m, x]) => `${m} ${x.margins.map(signedMv).join('/')}`);
  return `РЕЖИМОВ ПРОВЕРЕНО ${v.passed.length}/${v.total}${v.passed.length ? ' (' + v.passed.join(' · ') + ')' : ''}`
    + ` · запас по полосам: ${margins.length ? margins.join(' ; ') : 'проверок ещё не было'}`
    + ' · выгода против стока: таблиц ещё нет · неделя пользования: прибором не отслеживается'
    + (v.open ? ` · ⚠️ незакрытых намерений проверки ${v.open} — это смерть машины, разобрать до новой проверки` : '');
}

// -------------------------------------------------------------------------------------------------
// Selftest — fixtures in memory and in a temp sandbox; no card, no production journal
// -------------------------------------------------------------------------------------------------

export async function selfTest() {
  const results = [];
  const check = (what, ok, got = '') => results.push({ what, ok: !!ok, got });
  const S = (ms, mhz) => ({ ms, mhz });

  // bands
  check('ГРАНИЦА ПОЛОСЫ ПРИНАДЛЕЖИТ ПОЛОСЕ ВЫШЕ', [2157, 2500, 2700, 2800, 2900, 2950].every((f, i) => bandOf(f) === i + 1 && bandOf(f - 1) === i), [2157, 2950].map((f) => `${f}→${bandOf(f)}`).join(' '));

  // hit map: 10 samples at 2850 (B5), 4 at 210 (B1), 1 at 2157 (B2); period 500 ms
  const hs = [...Array(10)].map((_, i) => S(i * 500, 2850)).concat([...Array(4)].map((_, i) => S(5000 + i * 500, 210)), [S(7000, 2157)]);
  const hm = hitMap(hs, { periodMs: 500 });
  check('КАРТА ПОСЕЩЕНИЙ СЧИТАЕТ ВРЕМЯ ПО ПОЛОСАМ', hm[4].samples === 10 && hm[4].seconds === 5 && hm[0].seconds === 2 && hm[1].samples === 1, hm.map((p) => `${p.id}:${p.seconds}`).join(' '));
  check('ПОСЕЩЁННОЙ СЧИТАЕТСЯ ПОЛОСА С ДОСТАТОЧНЫМ ПРЕБЫВАНИЕМ', visitedBands(hm, 5).join() === '4' && visitedBands(hm, 2).join() === '0,4', `${visitedBands(hm, 5)} · ${visitedBands(hm, 2)}`);

  // verdicts
  const clean = [...Array(20)].map((_, i) => S(i * 1000, i < 10 ? 2850 : 2730));
  const v0 = verdictOf({ samples: clean, stages: [{ name: 'Q2RTX', ok: true, endedAtMs: 19000 }] });
  check('ЧИСТАЯ ПРОВЕРКА — ПРОЙДЕНА', v0.verdict === CHECK_VERDICT.PASSED, v0.why);
  const v1 = verdictOf({ samples: clean, driverEvents: [{ atMs: 12500, id: 153 }] });
  check('ГОЛОС ДРАЙВЕРА — СБОЙ В ПОЛОСЕ, ГДЕ КАРТА ЖИЛА В ТОТ МОМЕНТ', v1.verdict === CHECK_VERDICT.FAILED && v1.failure.cls === FAILURE_CLASS.DRIVER && v1.failure.band === 3, JSON.stringify(v1.failure));
  const v2 = verdictOf({ samples: clean, stages: [{ name: 'прожиг', ok: false, endedAtMs: 4000, why: 'код 3' }] });
  check('УМЕРШАЯ НАГРУЗКА — СБОЙ', v2.verdict === CHECK_VERDICT.FAILED && v2.failure.cls === FAILURE_CLASS.LOAD && v2.failure.band === 4, JSON.stringify(v2.failure));
  const gapped = clean.filter((s) => s.ms !== 15000 && s.ms !== 16000 && s.ms !== 17000);
  const v3 = verdictOf({ samples: gapped });
  check('РАЗРЫВ ТЕЛЕМЕТРИИ — СБОЙ', v3.verdict === CHECK_VERDICT.FAILED && v3.failure.cls === FAILURE_CLASS.TELEMETRY_GAP && v3.failure.atMs === 14000, JSON.stringify(v3.failure));
  const v4 = verdictOf({ samples: [], driverEvents: [{ atMs: 1 }] });
  check('БЕЗ ТЕЛЕМЕТРИИ — НЕИЗВЕСТНО, НЕ ПРОЙДЕНА И НЕ СБОЙ', v4.verdict === CHECK_VERDICT.UNKNOWN, v4.why);
  const v5 = verdictOf({ samples: clean, driverEvents: [{ atMs: 12500, id: 14 }], stages: [{ name: 'Q2RTX', ok: false, endedAtMs: 3000 }] });
  const v6 = verdictOf({ samples: clean, driverEvents: null });
  const v7 = verdictOf({ samples: gapped, driverEvents: null });
  check('ГОЛОС ДРАЙВЕРА НЕ ПРОЧИТАН — НЕИЗВЕСТНО, НО НАСТОЯЩИЙ СБОЙ ВСЁ РАВНО СБОЙ', v6.verdict === CHECK_VERDICT.UNKNOWN && v7.verdict === CHECK_VERDICT.FAILED, `${v6.why} · ${v7.verdict}`);
  check('СБОЙ ПРИПИСАН САМОМУ РАННЕМУ МОМЕНТУ', v5.failure.cls === FAILURE_CLASS.LOAD && v5.failures.length === 2, JSON.stringify(v5.failure));

  // P102-AC2: descent and ratchet
  const margins = [30, 30, 30, 30, 30, 30, 30];
  const r10 = [10, 10, 10, 10, 10, 10, 20];
  const pass = nextMargins({ margins, verdict: CHECK_VERDICT.PASSED, visited: [0, 4], ratchetMv: r10 });
  check('ПРОЙДЕННАЯ ПРОВЕРКА ОПУСКАЕТ ТОЛЬКО ПОСЕЩЁННЫЕ ПОЛОСЫ НА ШАГ', pass.margins.join() === '20,30,30,30,20,30,30', pass.margins.join());
  const fail = nextMargins({ margins: pass.margins, floors: pass.floors, verdict: CHECK_VERDICT.FAILED, failureBand: 4, ratchetMv: r10 });
  const after = nextMargins({ margins: fail.margins, floors: fail.floors, verdict: CHECK_VERDICT.PASSED, visited: [4], ratchetMv: r10 });
  check('СБОЙ ПОДНИМАЕТ ПОЛОСУ СБОЯ НА ХРАПОВИК И СТАВИТ ЕЙ ПОЛ', fail.margins[4] === 30 && fail.floors[4] === 30 && after.margins[4] === 30 && fail.margins.join() === '20,30,30,30,30,30,30',
    `после сбоя ${fail.margins.join()} · пол ${fail.floors.join()} · после новой прошедшей ${after.margins.join()}`);
  const noBand = nextMargins({ margins, verdict: CHECK_VERDICT.FAILED, failureBand: null, ratchetMv: r10 });
  check('СБОЙ БЕЗ ПОЛОСЫ ПОДНИМАЕТ ВСЕ ПОЛОСЫ (ОСТОРОЖНАЯ СТОРОНА)', noBand.margins.join() === '40,40,40,40,40,40,50' && noBand.changes.length === 7, noBand.margins.join());
  check('НЕИЗВЕСТНЫЙ ВЕРДИКТ НИЧЕГО НЕ ДВИГАЕТ', nextMargins({ margins, verdict: CHECK_VERDICT.UNKNOWN, visited: [4], ratchetMv: r10 }).margins.join() === margins.join());
  check('СПУСК НЕ УХОДИТ НИЖЕ НУЛЯ', nextMargins({ margins: [5, 0, 0, 0, 0, 0, 0], verdict: CHECK_VERDICT.PASSED, visited: [0, 1], ratchetMv: r10 }).margins.slice(0, 2).join() === '0,0');
  // plans/105 level 2 · mutation MN5 (named before the run): a 0 floor for every band again → this block red.
  const below = nextMargins({ margins: [0, 0, 0, 0, 0, 0, 0], verdict: CHECK_VERDICT.PASSED, visited: [0, 4, 6], ratchetMv: r10 });
  const belowFail = nextMargins({ margins: below.margins, floors: below.floors, verdict: CHECK_VERDICT.FAILED, failureBand: 4, ratchetMv: r10 });
  check('НИЖЕ ТРЕНДА СПУСКАЕТСЯ ТОЛЬКО НАГРУЗОЧНАЯ ПОЛОСА, И ХРАПОВИК СТАВИТ ЕЙ ПОЛ', below.margins.join() === '0,0,0,0,-10,0,-10'
    && belowFail.margins[4] === 0 && belowFail.floors[4] === 0, `спуск ${below.margins.join()} · после сбоя в B5 ${belowFail.margins.join()} · пол ${belowFail.floors.join()}`);
  const grid = []; for (let v = 800; v < 1000; v += 5) grid.push(v); for (let v = 1000; v <= 1100; v += 10) grid.push(v);
  const rm = ratchetMvByBand([{ band: 'B5', voltageMv: 900 }, { band: 'B7', voltageMv: 1020 }], grid);
  check('ХРАПОВИК — ДВА ШАГА СЕТКИ ТАМ, ГДЕ ЖИВЁТ ПОЛОСА', rm[4] === 10 && rm[6] === 20, rm.join());

  // P102-AC3: a death in a sandbox journal → failed in the band of the LAST durable sample
  const dir = mkdtempSync(join(tmpdir(), 'kago-validate-'));
  try {
    const j = openValidateJournal({ dir });
    const tele = join(dir, 'mon.jsonl');
    writeFileSync(tele, [
      JSON.stringify({ i: -1, meta: { period_ms: 500 } }),
      JSON.stringify({ i: 1, t: '2026/09/25 01:00:00.000', sample: { 'clocks.gr': 2730 } }),
      JSON.stringify({ i: 2, t: '2026/09/25 01:00:00.500', sample: { 'clocks.gr': 2842 } }),
      '{"i":3,"t":"2026/09/25 01:00:01.0', // the torn tail a death leaves
    ].join('\n'));
    const i1 = writeCheckIntent(j, { mode: 'optimised', telemetryPath: tele, at: '2026-09-25T01:00:00+03:00' });
    const i2 = writeCheckIntent(j, { mode: 'optimised', telemetryPath: tele, at: '2026-09-25T01:30:00+03:00' });
    writeCheckVerdict(j, { seq: i1.seq, verdict: CHECK_VERDICT.PASSED, at: '2026-09-25T01:20:00+03:00' });
    const deaths = deathVerdicts(readJournal(j).records);
    check('СМЕРТЬ — СБОЙ В ПОЛОСЕ ПОСЛЕДНЕЙ ДОЛГОВЕЧНОЙ ПРОБЫ', deaths.length === 1 && deaths[0].seq === i2.seq && deaths[0].failure.cls === FAILURE_CLASS.DEATH && deaths[0].failure.band === 4 && deaths[0].failure.lastMhz === 2842, JSON.stringify(deaths));
    const lines = readFileSync(j.path, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    check('ЖУРНАЛ ПРОВЕРКИ: НАМЕРЕНИЯ И ВЕРДИКТ ПО ПОРЯДКУ, С НОМЕРАМИ', lines.map((l) => `${l.state}:${l.seq}`).join() === 'intent:1,intent:2,verdict:1' && lines.every((l) => l.kind === CHECK_KIND));
    const noTele = deathVerdicts([{ state: LINE.INTENT, kind: CHECK_KIND, seq: 7, telemetryPath: null }]);
    check('СМЕРТЬ БЕЗ ПРОБ — ПОЛОСА НЕИЗВЕСТНА, А НЕ ВЫДУМАНА', noTele[0].failure.band === null, JSON.stringify(noTele[0].failure));
    check('ЧУЖИЕ СТРОКИ (ЖУРНАЛ РАЗВЁРТКИ) НЕ СЧИТАЮТСЯ ПРОВЕРКОЙ', deathVerdicts([{ state: LINE.INTENT, seq: 1, frequencyMhz: 2842, voltageMv: 845 }]).length === 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // Ш4 offline half: the mix
  const canon = planMix();
  const kinds = (p) => p.stages.map((s) => s.kind);
  check('СМЕСЬ 20 МИНУТ: ПРОСТОЙ В НАЧАЛЕ И В КОНЦЕ, 10 ПЕРЕХОДОВ, ПРОЖИГ 3→0', canon.totalS === 1180 && kinds(canon)[0] === MIX_STAGE.IDLE && kinds(canon).at(-1) === MIX_STAGE.IDLE
    && canon.stages.find((s) => s.kind === MIX_STAGE.TRANSITIONS).cycles === 10 && canon.stages.filter((s) => s.kind === MIX_STAGE.BURN).map((s) => s.level).join() === '3,2,1,0', `${canon.totalS} с · ${kinds(canon).join(' → ')}`);
  const smoke = planMix({ minutes: 1 });
  check('ДЫМ НА МИНУТУ СОХРАНЯЕТ ПРОСТОЙ НА ОБОИХ КОНЦАХ И ПЕРЕХОДЫ', kinds(smoke).join() === kinds(canon).join() && kinds(smoke).at(-1) === MIX_STAGE.IDLE
    && smoke.stages.find((s) => s.kind === MIX_STAGE.TRANSITIONS).cycles >= 2 && smoke.stages.every((s) => stageSeconds(s) >= 5), `${smoke.totalS} с · ${smoke.stages.map((s) => s.kind + ':' + stageSeconds(s)).join(' ')}`);
  let mixRefused = null; try { planMix({ minutes: 0 }); } catch (e) { mixRefused = e.message; }
  check('НУЛЕВАЯ ДЛИТЕЛЬНОСТЬ ОТКЛОНЯЕТСЯ ПО ИМЕНИ', /нужно число минут > 0/.test(mixRefused ?? ''), mixRefused ?? 'не отклонил');

  // Ш4: the executor's shape, on fakes, in a sandbox journal
  const exDir = mkdtempSync(join(tmpdir(), 'kago-runcheck-'));
  try {
    const j = openValidateJournal({ dir: exDir });
    const linesNow = () => readJournal(j).records.length;
    const smokePlan = planMix({ minutes: 1 });
    const samples20 = [...Array(20)].map((_, i) => S(i * 1000, 2850));
    const run = async (opts) => {
      const calls = [];
      const seams = {
        startSampler: () => { calls.push(`sampler@${linesNow()}`); return { stop: () => calls.push('stop') }; },
        waitSampler: async () => opts.samplerDead !== true,
        apply: async () => { calls.push(`apply@${linesNow()}`); return opts.applyOk === false ? { ok: false, why: 'штамп профиля не совпал (R6)' } : { ok: true }; },
        runStage: async (s) => { calls.push(`stage:${s.kind}`); if (s.kind === opts.throwAt) throw new Error('нагрузка упала'); return { ok: s.kind !== opts.failAt, why: 'код 3', endedAtMs: 10000 }; },
        rollback: async () => { calls.push('rollback'); if (opts.rollbackThrows) throw new Error('нет ответа'); return { ok: true }; },
        readSamples: () => ({ samples: samples20, periodMs: 1000 }),
        driverEvents: () => (opts.driverAt ? [{ atMs: opts.driverAt, id: 153 }] : []),
        snapshotRows: async () => (opts.noRows ? null : [{ mhz: 2850, voltageMv: 880 }, { mhz: 2900, voltageMv: 900 }]),
      };
      const r = await runCheck({ journal: j, mode: 'optimised', plan: smokePlan, telemetryPath: join(exDir, 'mon.jsonl'), seams, atIso: () => '2026-09-25T01:40:00+03:00' });
      return { r, calls };
    };
    const a = await run({});
    check('ИСПОЛНИТЕЛЬ: НАМЕРЕНИЕ В ЖУРНАЛЕ И СЭМПЛЕР ИДУТ ДО ПРИМЕНЕНИЯ', a.calls[0] === 'sampler@1' && a.calls[1] === 'apply@1', a.calls.slice(0, 3).join(' → '));
    check('ИСПОЛНИТЕЛЬ: ЧИСТАЯ СМЕСЬ — ПРОЙДЕНА, ОТКАТ СДЕЛАН, НАМЕРЕНИЕ ЗАКРЫТО', a.r.verdict.verdict === CHECK_VERDICT.PASSED && a.calls.includes('rollback') && orphanIntents(readJournal(j).records).length === 0
      && a.calls.filter((c) => c.startsWith('stage:')).length === smokePlan.stages.length, `${a.r.verdict.verdict} · ${a.calls.join(' ')}`);
    const b = await run({ failAt: MIX_STAGE.TRANSITIONS });
    check('ИСПОЛНИТЕЛЬ: СМЕСЬ ВСТАЁТ НА ПЕРВОЙ ПАДАЮЩЕЙ СТУПЕНИ, ОТКАТ ВСЁ РАВНО', b.r.verdict.verdict === CHECK_VERDICT.FAILED && b.r.verdict.failure.cls === FAILURE_CLASS.LOAD
      && !b.calls.includes('stage:burn') && b.calls.at(-2) === 'rollback', b.calls.join(' '));
    const bRec = readJournal(j).records.filter((x) => x.state === LINE.VERDICT).at(-1);
    const g = await run({ driverAt: 10000 });
    const gRec = readJournal(j).records.filter((x) => x.state === LINE.VERDICT).at(-1);
    check('ИСПОЛНИТЕЛЬ: СБОЙ ПИШЕТ В ЖУРНАЛ РАЗБРОС И ТОЧКИ СНИМКА; СБОЙ НАГРУЗКИ — БЕЗ НИХ', gRec?.failureAt?.points?.map((p) => `${p.mhz}@${p.voltageMv}`).join() === '2850@880'
      && g.r.failureAt?.loMhz === 2850 && renderCheckReport(g.r).includes('Отказ приписан частотам **2850 МГц**') && bRec?.failureAt === null
      && renderCheckReport(b.r).includes('сбой нагрузки') && a.r.failureAt === null, `${JSON.stringify(gRec?.failureAt)} · нагрузка ${JSON.stringify(bRec?.failureAt)}`);
    const c = await run({ throwAt: MIX_STAGE.GAME });
    check('ИСПОЛНИТЕЛЬ: ИСКЛЮЧЕНИЕ В НАГРУЗКЕ — СБОЙ, А НЕ ПАДЕНИЕ ПРИБОРА; ОТКАТ СДЕЛАН', c.r.verdict.verdict === CHECK_VERDICT.FAILED && c.calls.includes('rollback'), c.r.verdict.why);
    const d = await run({ applyOk: false });
    check('ИСПОЛНИТЕЛЬ: ОТКАЗ ПРИМЕНЕНИЯ — НЕИЗВЕСТНО, НИ ОДНОЙ СТУПЕНИ, ОТКАТ СДЕЛАН', d.r.verdict.verdict === CHECK_VERDICT.UNKNOWN && !d.calls.some((x) => x.startsWith('stage:')) && d.calls.includes('rollback'), d.r.verdict.why);
    // P102-AC5: all four parts of the report on every verdict — passed, failed, unknown
    const parts = ['## Вердикт', '## Карта посещений', '## Телеметрия', '## Голос драйвера'];
    const reps = [a, b, d].map((x) => renderCheckReport(x.r));
    check('ОТЧЁТ ПРОВЕРКИ: ЧЕТЫРЕ ЧАСТИ НА КАЖДОМ ВЕРДИКТЕ, СБОЙ НАЗВАН С ПОЛОСОЙ', reps.every((t) => parts.every((p) => t.includes(p)))
      && reps[0].startsWith('# Проверка режима optimised — ПРОЙДЕНА') && reps[1].includes('полоса 2800–2900') && reps[2].includes('НЕИЗВЕСТНО') && reps[2].includes('НЕ ПРОЧИТАН'),
      reps.map((t) => t.split('\n')[0]).join(' | '));
    // The REAL seams' wiring, on a fake library — which call gets which argument; no card anywhere
    const log = [];
    const fakeLib = {
      spawnSampler: (p, s) => { log.push(`sampler ${s}s`); return { kill: () => log.push('sampler killed') }; },
      samplerReady: () => true, probeCard: async () => ({ name: 'fake' }),
      resolveProfileCurve: async (p) => ({ snapshot: p.settings.curveSnapshot }),
      nvapiCurveBackend: () => ({ close: () => log.push('curve backend closed') }), nvidiaSmiBackend: () => ({}),
      apply: async (be, p, o) => { log.push(`apply consent=${Boolean(o.consent)} curve=${o.curve?.snapshot}`); return { steps: ['кривая', 'лимит'], lockedTo: { min: 180, max: 3090 } }; },
      resetToFactory: async (be, o) => { log.push(`reset lock=${o.knownLockMhz?.max} backend=${Boolean(o.curveBackend)}`); return { steps: ['сток'] }; },
      runTimedemo: async ({ runs }) => { log.push(`timedemo runs=${runs}`); return { exitCode: 0, timedOut: false, stats: { median: 57 } }; },
      stressTest: async (o) => { log.push(`stress ${o.transient ? 'transient' : 'level'} ${o.args ?? o.shape} ${o.seconds}s`); return { verdict: 'PASS' }; },
      runOptionsForShape: (shape, o) => ({ name: 'furnace', args: shape, ...o }), sweepBurnShape: (l) => [`L${l}`],
      FURNACE_LADDER: [{ args: 'A0' }, { args: 'A1' }, { args: 'A2' }, { args: 'A3' }], sleep: async () => {}, nowMs: () => 5000,
    };
    const cs = await makeCardSeams({ profile: { settings: { curveSnapshot: 'snapX' } }, totalS: 86, lib: fakeLib });
    const smp = cs.startSampler('x.jsonl'); const ap = await cs.apply();
    const st = [];
    for (const s of planMix({ minutes: 1 }).stages) st.push(await cs.runStage(s));
    const rb = await cs.rollback(); smp.stop();
    check('НАСТОЯЩИЕ ШВЫ (НА ПОДДЕЛКЕ БИБЛИОТЕКИ): СОГЛАСИЕ, КРИВАЯ СНИМКА, ОТКАТ С ЗАМКОМ, ИГРА ПРОХОДАМИ, ПРОЖИГ ПО УРОВНЯМ',
      ap.ok && rb.ok && st.every((x) => x.ok) && log.includes('sampler 206s') && log.includes('apply consent=true curve=snapX') && log.includes('reset lock=3090 backend=true')
      && log.filter((x) => x === 'timedemo runs=2').length === 2 && log.includes('stress transient A1 20s') && ['L3', 'L2', 'L1', 'L0'].every((l) => log.includes(`stress level ${l} 5s`)) && log.at(-1) === 'sampler killed',
      log.join(' | '));
    const throwing = await makeCardSeams({ profile: { settings: {} }, totalS: 10, lib: { ...fakeLib, apply: async () => { throw new Error('отказ до записи: stamp.driver'); } } });
    const factorySeams = await makeCardSeams({ profile: { settings: { curveRaiseAndCapMhz: null, curveRef: null, curveSnapshot: null } }, totalS: 10,
      lib: { ...fakeLib, resolveProfileCurve: async () => null, apply: async (be, p, o) => { log.push(`factory apply backend=${Boolean(o.curveBackend)}`); return { steps: [] }; } } });
    await factorySeams.apply();
    check('ШОВ ПРИМЕНЕНИЯ ДАЁТ БЭКЕНД КРИВОЙ И ЗАВОДСКОМУ ПРОФИЛЮ — ИНАЧЕ apply() НЕ ОБНУЛИТ КРИВУЮ (bugs/140)', log.includes('factory apply backend=true'), log.filter((x) => x.startsWith('factory')).join(' | '));
    const ap2 = await throwing.apply();
    check('НАСТОЯЩИЙ ШОВ ПРИМЕНЕНИЯ: ИСКЛЮЧЕНИЕ ПРИМЕНИТЕЛЯ → {ok:false} С ПРИЧИНОЙ, А НЕ ПАДЕНИЕ', ap2.ok === false && /stamp\.driver/.test(ap2.why), ap2.why);
    const dead = await run({ samplerDead: true });
    check('ИСПОЛНИТЕЛЬ: СЭМПЛЕР НЕ ПОДНЯЛСЯ — КАРТУ НЕ ТРОГАЕМ: НИ ПРИМЕНЕНИЯ, НИ ОТКАТА, НЕИЗВЕСТНО', dead.r.verdict.verdict === CHECK_VERDICT.UNKNOWN
      && !dead.calls.some((x) => x.startsWith('apply') || x === 'rollback' || x.startsWith('stage:')), `${dead.r.verdict.why} · ${dead.calls.join(' ')}`);
    const e = await run({ rollbackThrows: true });
    check('ИСПОЛНИТЕЛЬ: УПАВШИЙ ОТКАТ НАЗВАН В ВЕРДИКТЕ', /ОТКАТ НЕ ПОДТВЕРЖДЁН/.test(readJournal(j).records.filter((x) => x.state === LINE.VERDICT).at(-1)?.why ?? ''), e.r.rollback?.why ?? '');
  } finally { rmSync(exDir, { recursive: true, force: true }); }

  // Ш2: the candidate profile passes the profile format's own validator (loaded lazily: profile-store →
  // curve-store → this module would be an import cycle at load time)
  const { validateProfile } = await import('./profile-store.mjs');
  const base = { name: 'optimised', title: '⚖️ Optimised', mode: 'optimised', qualified: true,
    settings: { powerLimitWatts: 250, graphicsClockLockMhz: { min: 180, max: 3090 }, curveRaiseAndCapMhz: null, curveRef: null, curveSnapshot: '2026-09-14T22-54-29', curveCapMhz: null },
    stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: '2026-08-15T00:45:00+03:00' }, evidence: { x: 'y' } };
  const cand = candidateProfile(base, { snapshotId: '2026-09-25T02-00-00', stamp: { driver: '616.92', vbios: '98.03.58.40.8b' }, takenAt: '2026-09-25T02:00:00+03:00', margins: [30, 30, 30, 30, 30, 30, 30] });
  const candRefusals = validateProfile(cand, { fileName: 'candidate-optimised.local.json' });
  check('КАНДИДАТ — ЧЕРНОВИК, ПРИНЯТЫЙ ФОРМАТОМ ПРОФИЛЯ; БОЕВОЙ ПРОФИЛЬ НЕ ТРОНУТ', candRefusals.length === 0 && cand.qualified === false && cand.settings.curveSnapshot === '2026-09-25T02-00-00'
    && cand.settings.powerLimitWatts === 250 && base.settings.curveSnapshot === '2026-09-14T22-54-29' && cand.stamp.driver === '616.92', candRefusals.map((r) => `${r.field}: ${r.why}`).join(' · ').slice(0, 300) || cand.draft.candidate);

  // The CLI's branch order, as a RUN: `--compare` carries its own `--mode` flag and must reach the table, not the
  // check (session-102 judge, defect A: the `--mode` branch swallowed it). Tiny capture fixtures in a sandbox.
  const cliDir = mkdtempSync(join(tmpdir(), 'kago-cli-'));
  try {
    const line = (i, w) => JSON.stringify({ i, t: `2026/09/25 02:00:${String(i).padStart(2, '0')}.000`, sample: { 'utilization.gpu': 99, 'power.draw.instant': w, 'temperature.gpu': 70, 'fan.speed': 60, 'clocks.gr': 2800 } });
    for (const [name, w] of [['s', 300], ['m', 250]]) {
      writeFileSync(join(cliDir, `${name}.jsonl`), [JSON.stringify({ i: -1, meta: { period_ms: 1000 } }), line(1, w), line(2, w), line(3, w)].join('\n'));
      writeFileSync(join(cliDir, `${name}.json`), JSON.stringify({ fps: { median: 55 }, sampleFile: `${name}.jsonl` }));
    }
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--compare', '--stock', join(cliDir, 's.json'), '--mode', join(cliDir, 'm.json')], { encoding: 'utf8' });
    check('КОМАНДА --compare ДОХОДИТ ДО ТАБЛИЦЫ, А НЕ УХОДИТ В ПРОВЕРКУ РЕЖИМА', r.status === 0 && /ВЫГОДА ПРОТИВ СТОКА/.test(r.stdout) && /мощность, Вт · 300 · 250 · -50/.test(r.stdout), (r.stdout || r.stderr).split('\n').slice(0, 4).join(' | '));
  } finally { rmSync(cliDir, { recursive: true, force: true }); }

  // bugs/141: THIS MODULE AS THE ENTRY, and from inside its CLI the very import the card path makes —
  // `await import('./curve-store.mjs')`, which imports this module back. With the CLI as top-level await the
  // child dies «unsettled top-level await» (exit 13) or, with a live child process, hangs; the function form
  // prints the marker. Mutation MV141: turn the CLI back into top-level await → this block red (exit 13).
  {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--probe-import-cycle'], { encoding: 'utf8', timeout: 30_000 });
    check('ЦИКЛ ИМПОРТА НЕ ВЕШАЕТ КОМАНДУ: главный модуль доходит до curve-store (bugs/141)',
      r.status === 0 && /ЦИКЛ ИМПОРТА: ПРОЙДЕН/.test(r.stdout ?? ''),
      `код ${r.status}${r.signal ? ` · сигнал ${r.signal}` : ''} · ${(r.stdout || r.stderr || '').trim().slice(0, 160)}`);
  }

  // E101-AC2: the benefit table's arithmetic
  const bt = benefitRows({ stock: { fps: 54.75, loaded: { 'power.draw.instant': { median: 300.1 }, 'temperature.gpu': { median: 81.5 }, 'fan.speed': { median: 86 }, 'clocks.gr': { median: 2729 } } },
    mode: { fps: 55.49, loaded: { 'power.draw.instant': { median: 250.2 }, 'temperature.gpu': { median: 73.5 }, 'fan.speed': { median: 67 } } } });
  const row = (k) => bt.find((r) => r.key === k);
  check('ТАБЛИЦА ВЫГОДЫ: РАЗНИЦА = РЕЖИМ − СТОК, ПРОПУСК — ПРОЧЕРК, А НЕ НОЛЬ', Math.abs(row('power.draw.instant').delta + 49.9) < 1e-9 && Math.abs(row('temperature.gpu').delta + 8) < 1e-9
    && row('fps').delta > 0 && row('clocks.gr').mode === null && row('clocks.gr').delta === null, bt.map((r) => `${r.key}: ${r.delta}`).join(' · '));

  // EXP-0290: the logon line
  const boot = [
    '{"at":"2026-09-15T08:49:21+03:00","verdict":"applied","remembered":"optimised"}',
    '{"at":"2026-09-19T22:39:22+03:00","verdict":"disks-disarmed","remembered":null}',
    '{"at":"2026-09-19T22:39:23+03:00","verdict":"degraded-to-factory","remembered":"optimised","detail":"запомненный профиль отвергнут теми же воротами, записей ноль, заводское стоит: stamp.driver — профиль доказан на 610.88, карта сейчас 616.92"}',
    '{"torn',
  ].join('\n');
  check('СТРОКА ВХОДА: ПОСЛЕДНИЙ ОТКАЗ ВИДЕН ПЕРВОЙ КОМАНДОЙ, СЛУЖЕБНЫЕ СТРОКИ И РВАНЫЙ ХВОСТ НЕ МЕШАЮТ', /^⚠️ ПРИ ВХОДЕ 2026-09-19 22:39: «optimised» ОТВЕРГНУТ/.test(lastBootLine(boot)) && /stamp\.driver/.test(lastBootLine(boot))
    && /применён$/.test(lastBootLine(boot.split('\n')[0])) && lastBootLine('') === 'ПРИ ВХОДЕ: записей восстановления нет', lastBootLine(boot));
  const dying = boot + '\n{"at":"2026-09-26T09:00:00+03:00","state":"intent","remembered":"optimised"}';
  const cleared = boot + '\n{"at":"2026-09-26T09:05:00+03:00","verdict":"owner-cleared","remembered":null}';
  check('СТРОКА ВХОДА: НЕЗАКРЫТОЕ НАМЕРЕНИЕ НЕ ПРЯЧЕТСЯ ЗА ПРЕЖНИЙ ИТОГ; РУЧНОЙ СБРОС НЕ НАЗЫВАЕТСЯ ВХОДОМ',
    /НЕ ЗАКРЫЛОСЬ/.test(lastBootLine(dying)) && /^ВРУЧНУЮ 2026-09-26 09:05/.test(lastBootLine(cleared)), `${lastBootLine(dying)} | ${lastBootLine(cleared)}`);

  // P102-AC6: the metric
  const MODES =['max-performance', 'optimised', 'silent-cold', 'stock-default'];
  const I = (seq, mode, snapshot, margins = null) => ({ state: LINE.INTENT, kind: CHECK_KIND, seq, mode, snapshot, margins });
  const V = (seq, verdict) => ({ state: LINE.VERDICT, kind: CHECK_KIND, seq, verdict });
  const profs = [{ mode: 'optimised', settings: { curveSnapshot: 'snapB' } }, { mode: 'stock-default', settings: {} }];
  const mv = modesValidated([I(1, 'optimised', 'snapA'), V(1, 'passed'), I(2, 'stock-default', null), V(2, 'passed'), I(3, 'silent-cold', 'snapC'), V(3, 'failed'), I(4, 'max-performance', 'snapD')], { profiles: profs, modes: MODES });
  check('МЕТРИКА: СЧИТАЕТСЯ ПРОЙДЕННАЯ ПРОВЕРКА ТОЙ КРИВОЙ, НА КОТОРОЙ РЕЖИМ СТОИТ СЕЙЧАС', mv.passed.join() === 'stock-default' && mv.open === 1, `пройдены ${mv.passed.join()} · незакрытых ${mv.open}`);
  const mv2 = modesValidated([I(1, 'optimised', 'snapB', [30, 30, 30, 30, 20, 30, 30]), V(1, 'passed')], { profiles: profs, modes: MODES });
  const line = renderValidatedLine(mv2);
  check('СТРОКА МЕТРИКИ: ЧИСЛО, ЗАПАС ПО ПОЛОСАМ И ЧЕСТНОЕ «НЕ ОТСЛЕЖИВАЕТСЯ»', line.startsWith('РЕЖИМОВ ПРОВЕРЕНО 1/4 (optimised)') && line.includes('+30/+30/+30/+30/+20/+30/+30') && line.includes('прибором не отслеживается'), line);
  check('СТРОКА МЕТРИКИ НА ПУСТОМ ЖУРНАЛЕ — 0/4', renderValidatedLine(modesValidated([], { modes: MODES })).startsWith('РЕЖИМОВ ПРОВЕРЕНО 0/4 · запас по полосам: проверок ещё не было'));


  // ---- plans/105 Ш2: LEVEL 3, the frequency. Mutation addressees MV12–MV16 are named in the header.
  {
    const fw = [S(-600, 2700), S(0, 2880), S(500, 2880), S(1000, 2865), S(1500, 2880), S(2000, 2895)];
    const sp = failureSpan(fw, 2000);
    const rowsV = [{ mhz: 2880, voltageMv: 890 }, { mhz: 2850, voltageMv: 870 }, { mhz: 2865, voltageMv: 880 }, { mhz: 2895, voltageMv: 895 }];
    check('УРОВЕНЬ ЧАСТОТЫ: РАЗБРОС ВЫДАННЫХ ЧАСТОТ ЗА 2 С, ПРОБА ДО ОКНА НЕ СЧИТАЕТСЯ', sp?.loMhz === 2865 && sp?.hiMhz === 2895
      && failureSpan([S(0, 2800), S(5000, 2900)], 4000)?.hiMhz === 2800 && failureSpan([], 100) === null, JSON.stringify(sp));
    check('УРОВЕНЬ ЧАСТОТЫ: НАПРЯЖЕНИЕ СНИМКА — СТРОКИ НАИМЕНЬШЕЙ ЧАСТОТЫ ≥ f', curveVoltageAt(rowsV, 2860) === 880 && curveVoltageAt(rowsV, 2865) === 880
      && curveVoltageAt(rowsV, 3000) === 895 && curveVoltageAt([], 2860) === null, `${curveVoltageAt(rowsV, 2860)} · ${curveVoltageAt(rowsV, 2865)} · ${curveVoltageAt(rowsV, 3000)}`);
    // The judge's case (F2): a failure under load with an idle sample in the window — the LOAD frequency must be under the floor.
    const idleIn = attributeFailure({ samples: [S(0, 2900), S(500, 2900), S(1000, 1500), S(1500, 2900)], failure: { cls: FAILURE_CLASS.DRIVER, atMs: 1500 },
      rows: [{ mhz: 1500, voltageMv: 750 }, { mhz: 2000, voltageMv: 800 }, { mhz: 2900, voltageMv: 890 }, { mhz: 3000, voltageMv: 950 }] });
    check('УРОВЕНЬ ЧАСТОТЫ: ПРОСТОЙ В ОКНЕ НЕ ПРЯЧЕТ ЧАСТОТУ НАГРУЗКИ — ТОЧКИ ПОКРЫВАЮТ ВЕСЬ РАЗБРОС', idleIn?.loMhz === 1500 && idleIn?.hiMhz === 2900
      && idleIn.points.map((p) => `${p.mhz}@${p.voltageMv}`).join() === '1500@750,2000@800,2900@890', JSON.stringify(idleIn));
    const loadF = attributeFailure({ samples: fw, failure: { cls: FAILURE_CLASS.LOAD, atMs: 2000 }, rows: rowsV });
    const noRows = attributeFailure({ samples: fw, failure: { cls: FAILURE_CLASS.TELEMETRY_GAP, atMs: 2000 }, rows: null });
    check('УРОВЕНЬ ЧАСТОТЫ: СБОЙ НАГРУЗКИ ЧАСТОТЕ НЕ ПРИПИСЫВАЕТСЯ (МОМЕНТ — КОНЕЦ СТУПЕНИ); БЕЗ СНИМКА — РАЗБРОС БЕЗ ТОЧЕК', loadF === null && noRows?.points === null && noRows?.hiMhz === 2895,
      `нагрузка ${JSON.stringify(loadF)} · без снимка ${JSON.stringify(noRows)}`);
    const m0 = [0, 0, 0, -10, -10, -10, -10];
    const pts = { loMhz: 2865, hiMhz: 2865, points: [{ mhz: 2865, voltageMv: 880 }] };
    const lvl3 = nextMargins({ margins: m0, verdict: CHECK_VERDICT.FAILED, failureBand: 4, failureAt: pts, ratchetMv: r10 });
    const noV = nextMargins({ margins: m0, verdict: CHECK_VERDICT.FAILED, failureBand: 4, failureAt: { loMhz: 2865, hiMhz: 2865, points: null }, ratchetMv: r10 });
    check('УРОВЕНЬ ЧАСТОТЫ: СБОЙ С ТОЧКАМИ НЕ ДВИГАЕТ ЗАПАС ПОЛОСЫ; БЕЗ ТОЧЕК — ХРАПОВИК ПОЛОСЫ', lvl3.margins.join() === m0.join() && lvl3.floors.join() === nextMargins({ margins: m0, verdict: CHECK_VERDICT.UNKNOWN, ratchetMv: r10 }).floors.join()
      && /2865 МГц/.test(lvl3.changes[0]?.why ?? '') && noV.margins[4] === 0 && noV.floors[4] === 0, `с точками ${lvl3.margins.join()} · без точек ${noV.margins.join()}`);
    const deathRecs = [{ state: LINE.INTENT, kind: CHECK_KIND, seq: 9, mode: 'optimised', snapshot: 'snapX', telemetryPath: 'x.jsonl' }];
    const dv = deathVerdicts(deathRecs, { readSamples: () => fw, rowsOf: (id) => (id === 'snapX' ? rowsV : null) });
    check('УРОВЕНЬ ЧАСТОТЫ: СМЕРТЬ С ДОЛГОВЕЧНОЙ ПРОБОЙ ПОЛУЧАЕТ РАЗБРОС И ТОЧКИ СВОЕГО СНИМКА', dv[0]?.failureAt?.loMhz === 2865 && dv[0]?.failureAt?.points?.map((p) => p.mhz).join() === '2865,2880,2895'
      && deathVerdicts(deathRecs, { readSamples: () => [] })[0].failureAt === null, JSON.stringify(dv[0]?.failureAt));
    // bugs/146 — the 17.10 case in miniature: the step lowered 2850/2900 against the last PASSED check (seq 1; the FAILED
    // seq 2 is not a base, nor is another mode's pass), and the 2-s window holds only top samples (3000).
    const recs146 = [I(1, 'optimised', 'snapPass'), V(1, CHECK_VERDICT.PASSED), I(2, 'optimised', 'snapBad'), V(2, CHECK_VERDICT.FAILED),
      I(4, 'silent-cold', 'snapCold'), V(4, CHECK_VERDICT.PASSED), { ...I(5, 'optimised', 'snapStep'), telemetryPath: 'step.jsonl' }];
    const snaps146 = { snapPass: [{ mhz: 2850, voltageMv: 880 }, { mhz: 2900, voltageMv: 895 }, { mhz: 3000, voltageMv: 970 }],
      snapBad: [{ mhz: 2850, voltageMv: 860 }, { mhz: 2900, voltageMv: 875 }, { mhz: 3000, voltageMv: 970 }],
      snapStep: [{ mhz: 2850, voltageMv: 870 }, { mhz: 2900, voltageMv: 885 }, { mhz: 3000, voltageMv: 970 }] };
    const top = [S(0, 3000), S(500, 3000), S(1000, 3000)];
    const base146 = lastPassedSnapshot(recs146, 'optimised', 5);
    const withBase = attributeFailure({ samples: top, failure: { cls: FAILURE_CLASS.DRIVER, atMs: 1000 }, rows: snaps146.snapStep, baseRows: snaps146[base146] });
    const noBase = attributeFailure({ samples: top, failure: { cls: FAILURE_CLASS.DRIVER, atMs: 1000 }, rows: snaps146.snapStep });
    const dead146 = deathVerdicts(recs146, { readSamples: () => top, rowsOf: (id) => snaps146[id] ?? null });
    check('УРОВЕНЬ ЧАСТОТЫ: СТРОКИ, ОПУЩЕННЫЕ ШАГОМ ПРОТИВ ПОСЛЕДНЕЙ ПРОЙДЕННОЙ ПРОВЕРКИ, — ТОЖЕ ПОД ПОЛОМ (bugs/146)',
      base146 === 'snapPass' && lastPassedSnapshot(recs146, 'optimised', 1) === null
      && withBase?.points?.map((p) => `${p.mhz}@${p.voltageMv}`).join() === '2850@870,2900@885,3000@970' && withBase.stepPoints === 2 && withBase.hiMhz === 3000
      && noBase?.points?.map((p) => p.mhz).join() === '3000' && noBase.stepPoints === 0
      && dead146[0]?.failureAt?.points?.map((p) => p.mhz).join() === '2850,2900,3000',
      `база ${base146} · с базой ${JSON.stringify(withBase?.points)} · без ${JSON.stringify(noBase?.points)} · смерть ${JSON.stringify(dead146[0]?.failureAt?.points)}`);
    const floors = checkFailureFloors([
      { state: LINE.VERDICT, kind: CHECK_KIND, seq: 1, verdict: CHECK_VERDICT.FAILED, failure: { cls: 'driver-voice' }, failureAt: pts },
      { state: LINE.VERDICT, kind: CHECK_KIND, seq: 2, verdict: CHECK_VERDICT.FAILED, failureAt: { loMhz: 2900, hiMhz: 2900, points: null } },
      { state: LINE.VERDICT, kind: CHECK_KIND, seq: 3, verdict: CHECK_VERDICT.PASSED, failureAt: { loMhz: 2800, hiMhz: 2800, points: [{ mhz: 2800, voltageMv: 860 }] } },
      { state: LINE.VERDICT, seq: 4, verdict: CHECK_VERDICT.FAILED, failureAt: { loMhz: 2700, hiMhz: 2700, points: [{ mhz: 2700, voltageMv: 850 }] } },
    ]);
    check('УРОВЕНЬ ЧАСТОТЫ: ПОСТРОИТЕЛЮ ИДУТ ТОЛЬКО ТОЧКИ СБОЕВ ПРОВЕРОК', floors.length === 1 && floors[0].mhz === 2865 && floors[0].mv === 880, JSON.stringify(floors));

    // P105-AC4 on the builder itself: a failure at 2865 MHz / 880 mV raises rows ≥ 2865 to 880 + two grid steps and nothing below.
    const cp = await import('../../tools/curve-proposal.mjs');
    const g5 = []; for (let v = 800; v <= 1100; v += 5) g5.push(v);
    const ladderA = []; for (let f = 2600; f <= 3000; f += 15) ladderA.push(f);
    const stockA = (f) => 900 + Math.round((f - 2000) / 10);
    const fx = cp.anchorsFrom({ passes: [{ mhz: 2750, mv: 860 }, { mhz: 2850, mv: 870 }, { mhz: 2945, mv: 900 }], fails: [{ mhz: 2750, mv: 850, kind: 'hung' }, { mhz: 2850, mv: 860, kind: 'hung' }, { mhz: 2945, mv: 890, kind: 'hung' }], grid: g5, stockAt: stockA });
    const argsA = { ladder: ladderA, stockAt: stockA, grid: g5, anchors: fx.anchors, maxMhz: 3000, margins: [0, 0, 0, -30, -30, -30, -30] };
    const baseC = cp.bandedCurve({ ...argsA, credible: fx.credible });
    const withC = cp.bandedCurve({ ...argsA, credible: cp.withCheckFailures(fx.credible, floors) });
    const need = 890; // 880 + two steps of a 5 mV grid
    const raised = withC.rows.filter((r, i) => r.voltageMv !== baseC.rows[i].voltageMv).map((r) => r.mhz);
    check('УРОВЕНЬ ЧАСТОТЫ: ПОСТРОИТЕЛЬ ПОДНИМАЕТ ОКРЕСТНОСТЬ СБОЯ (≥ 2865 — НЕ НИЖЕ 880 + 2 ШАГА), НИЖЕ — БЕЗ ИЗМЕНЕНИЙ (P105-AC4)',
      raised.length > 0 && raised.every((f) => f >= 2865) && withC.rows.every((r) => r.mhz < 2865 || r.voltageMv >= Math.min(r.stockVoltageMv, need))
      && withC.rows.every((r, i) => r.mhz >= 2865 || r.voltageMv === baseC.rows[i].voltageMv),
      `поднято: ${raised.join(' ')} · ${withC.rows.filter((r) => r.mhz >= 2850 && r.mhz <= 2950).map((r) => r.mhz + '@' + r.voltageMv).join(' ')}`);
    // The span on the builder: every row inside the span stands ≥ its own failed voltage + two steps (or stock) — the envelope.
    const span = { loMhz: 2615, hiMhz: 2900 };
    const spanFloors = checkFailureFloors([{ state: LINE.VERDICT, kind: CHECK_KIND, seq: 5, verdict: CHECK_VERDICT.FAILED, failure: { cls: 'telemetry-gap' },
      failureAt: { ...span, points: failurePoints(baseC.rows, span) } }]);
    const spanC = cp.bandedCurve({ ...argsA, credible: cp.withCheckFailures(fx.credible, spanFloors) });
    const up2 = (v) => g5.find((g) => g > (g5.find((x) => x > v) ?? v)) ?? v;
    const notCovered = spanC.rows.filter((r, i) => r.mhz >= span.loMhz && r.voltageMv < Math.min(r.stockVoltageMv, up2(baseC.rows[Math.min(i, baseC.rows.findIndex((b) => b.mhz >= Math.min(r.mhz, span.hiMhz)))].voltageMv)));
    check('УРОВЕНЬ ЧАСТОТЫ: ПОЛ НА ВЕСЬ РАЗБРОС — КАЖДАЯ ЧАСТОТА РАЗБРОСА И ВЫШЕ НЕ НИЖЕ СВОЕГО НАПРЯЖЕНИЯ СБОЯ + 2 ШАГА', spanFloors.length > 2 && notCovered.length === 0,
      `точек ${spanFloors.length} · не покрыто: ${notCovered.map((r) => r.mhz + '@' + r.voltageMv).join(' ') || 'ничего'}`);

    // P105-AC5 (Ш3): one step = one command; the dry run writes nothing; the real one writes document → snapshot → candidate, in that order.
    const cs = await import('./curve-store.mjs');
    const psm = await import('./profile-store.mjs');
    const writes = [];
    const deps = (over = {}) => ({
      propose: () => ({ facts: { rows: ladderA.map((mhz) => ({ mhz, stockVoltageMv: stockA(mhz) })), grid: g5, card: { name: 'fixture', maxGraphicsMhz: 3000 }, stamp: { driver: '610.88', vbios: '98.03.58.40.8b' } }, anchors: fx.anchors, credible: cp.withCheckFailures(fx.credible, floors), checkFloors: floors }),
      marginRefusal: cp.marginRefusal, bandedCurve: cp.bandedCurve, exhaustedBands: cp.exhaustedBands, curveDocFromRows: cp.curveDocFromRows,
      validateCurveDoc: cs.validateCurveDoc, saveCurveDoc: (doc, o) => writes.push(`doc:${o.name}:${doc.stamp.driver}/${doc.stamp.dataDriver}`),
      takeSnapshot: (o) => { writes.push(`snapshot:${o.name}`); return { snapshot: { takenAt: o.nowIso } }; }, snapshotIdFor: cs.snapshotIdFor,
      docExists: () => false, frequencyGrid: () => null, probeCard: () => ({ driver: '616.92', vbios: '98.03.58.40.8b' }), validateProfile: psm.validateProfile,
      readModeProfile: () => base, candidateFile: (m) => `candidate-${m}.local.json`, writeCandidate: (file, obj) => writes.push(`candidate:${file}:${obj.settings.curveSnapshot}`),
      nowIso: () => '2026-10-17T13:00:00+03:00', ...over,
    });
    const marginsA = [0, 0, 0, -30, -30, -30, -30];
    const dryStep = await prepareStep({ mode: 'optimised', margins: marginsA, dry: true, deps: deps() });
    check('ШАГ: СУХОЙ ПРОГОН НИЧЕГО НЕ ПИШЕТ И НАЗЫВАЕТ ДОКУМЕНТ ПО ЗАПАСУ, ДРАЙВЕРУ И СТРОКАМ', writes.length === 0 && /^model-bands-0-0-0-n30-n30-n30-n30-d616-92-[0-9a-f]{6}$/.test(dryStep.docName)
      && dryStep.checkFloors === 1 && dryStep.exhausted.length === 7 && /СУХОЙ ПРОГОН/.test(renderStepPlan(dryStep)) && /−30/.test(renderStepPlan(dryStep)), `${writes.join(' | ') || 'записей нет'} · ${dryStep.docName}`);
    const realStep = await prepareStep({ mode: 'optimised', margins: marginsA, deps: deps() });
    check('ШАГ: ДОКУМЕНТ → СНИМОК → КАНДИДАТ, КАНДИДАТ НА СНИМКЕ ШАГА СО ШТАМПОМ КАРТЫ, ДРАЙВЕР ДАННЫХ НЕ СПРЯТАН', writes.length === 3 && writes[0] === `doc:${realStep.docName}:616.92/610.88`
      && writes[1] === `snapshot:${realStep.docName}` && writes[2] === 'candidate:candidate-optimised.local.json:2026-10-17T13-00-00'
      && realStep.candidate.stamp.driver === '616.92' && realStep.candidate.qualified === false && /−30/.test(realStep.candidate.draft.candidate), `${writes.join(' | ')} · ${realStep.candidate?.draft?.candidate}`);
    writes.length = 0;
    await prepareStep({ mode: 'optimised', margins: marginsA, deps: deps({ docExists: () => true }) });
    let refusedB3 = null; try { await prepareStep({ mode: 'optimised', margins: [0, 0, -10, 0, 0, 0, 0], deps: deps() }); } catch (e) { refusedB3 = e.message; }
    let refusedStock = null; try { await prepareStep({ mode: 'stock-default', margins: marginsA, deps: deps() }); } catch (e) { refusedStock = e.message; }
    check('ШАГ: ТОТ ЖЕ ДОКУМЕНТ НЕ ПЕРЕПИСЫВАЕТСЯ; ЗАПАС НИЖЕ ТРЕНДА ВНЕ НАГРУЗОЧНЫХ ПОЛОС И ЗАВОДСКОЙ РЕЖИМ ОТКЛОНЯЮТСЯ ПО ИМЕНИ',
      !writes.some((w) => w.startsWith('doc:')) && writes.length === 2 && /только полосы от 2700/.test(refusedB3 ?? '') && /только у optimised/.test(refusedStock ?? ''), `${writes.join(' | ')} · ${refusedB3} · ${refusedStock}`);
  }

  return { ok: results.every((r) => r.ok), results };
}

export async function runSelfTest() {
  try { return await selfTest(); } catch (e) {
    return { ok: false, results: [{ ok: false, what: 'НАБОР УПАЛ, НЕ ДОЙДЯ ДО КОНЦА — это красный блок', got: `${e.name}: ${e.message}` }] };
  }
}

// The CLI's two halves of a check, shared by `--mode` and `--step` (plans/105 Ш3) — one path to the card, not two.

/**
 * Order (plans/102 «Схема прибора»): an unclosed intent in the check journal is closed FIRST as a death, and the
 * launch stops there. The death now carries its frequency and the snapshot's voltage at it (plans/105 Ш2), so the
 * builder sees it as a known failure. Returns the number of deaths found.
 */
async function closeDeathsFirst(journal, dry) {
  const cs = await import('./curve-store.mjs');
  const rowsOf = (id) => cs.loadSnapshot({ id })?.frequencies ?? null;
  const deaths = deathVerdicts(readJournal(journal).records, { rowsOf });
  for (const d of deaths) {
    const at = d.failureAt ? ` · частоты ${spanText(d.failureAt)}${d.failureAt.points ? ` (точек пола ${d.failureAt.points.length})` : ''}` : '';
    console.log(`🔴 НЕЗАКРЫТОЕ НАМЕРЕНИЕ seq ${d.seq} (${d.mode}) — это СМЕРТЬ машины во время проверки: ${d.failure.why}; полоса ${d.failure.band === null ? 'неизвестна' : MODE_BANDS[d.failure.band].label}${at}`);
    if (!dry) writeCheckVerdict(journal, { seq: d.seq, verdict: d.verdict, failure: d.failure, failureAt: d.failureAt, at: new Date().toISOString(), why: `закрыто при следующем запуске: ${d.failure.why}` });
  }
  if (deaths.length) console.log(dry ? '(сухой прогон: журнал не тронут)' : 'Намерения закрыты. Храповик — в отчёте запуска; новую проверку начинать ПОСЛЕ разбора.');
  return deaths.length;
}

/** Print the check's plan and (not dry) run it on the card; returns the exit code. `profile` is null only in a dry step. */
async function checkCommand({ mode, profile, plan, dry, margins, journal }) {
  // The owner's local clock, never UTC (EXP-0012) — the same form curve-proposal gives its files.
  const now = new Date(); const moment = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace(/:/g, '-');
  const dir = join(VALIDATE_DIR, moment);
  const telemetryPath = join(dir, 'mon.jsonl');
  console.log(`ПРОВЕРКА РЕЖИМА ${mode} · кандидат ${profile?.name ?? (dry ? `candidate-${mode}.local (будет записан шагом)` : '—')} · снимок ${profile?.settings?.curveSnapshot ?? (dry ? 'будет снят шагом' : '—')} · штамп ${profile?.stamp?.driver ?? '—'} · ${Math.round(plan.totalS / 6) / 10} мин`);
  for (const s of plan.stages) console.log(`  · ${s.label} — ${s.kind === MIX_STAGE.GAME ? `проходов демо: ${Math.max(1, Math.ceil(s.seconds / DEMO_PASS_S))}` : s.kind === MIX_STAGE.TRANSITIONS ? `${s.cycles} × (${s.onS}/${s.offS} с), уровень ${TRANSITIONS_LEVEL}` : `${s.seconds} с`}`);
  console.log(`  телеметрия → ${telemetryPath.replace(/\\/g, '/')} · журнал → ${journal.path.replace(/\\/g, '/')}`);
  if (profile?.stamp?.driver) console.log(`  ⚠️ штамп кандидата — драйвер ${profile.stamp.driver}: при применении сверится с живой картой (R6); не совпал — отказ до записи, вердикт НЕИЗВЕСТНО`);
  if (dry) { console.log('СУХОЙ ПРОГОН: карта, журнал и файлы не тронуты. (P102-AC4 на живой карте добавляет чтение сдвигов до и после — карточный день.)'); return 0; }
  mkdirSync(dir, { recursive: true });
  const seams = await makeCardSeams({ profile, totalS: plan.totalS });
  const result = await runCheck({ journal, mode, candidate: profile.name, snapshot: profile.settings?.curveSnapshot ?? null, margins, plan, telemetryPath, seams, atIso: () => new Date().toISOString() });
  const out = writeCheckReport(dir, result);
  console.log(renderCheckReport(result));
  console.log(`отчёт: ${out.report.replace(/\\/g, '/')}`);
  return result.verdict.verdict === CHECK_VERDICT.PASSED ? 0 : 1;
}

// 🔴 `bugs/141`: THE CLI RUNS INSIDE AN ASYNC FUNCTION, NEVER AS TOP-LEVEL `await`. `curve-store.mjs` imports this
// module statically, and applying a snapshot reaches `await import('./curve-store.mjs')` (profile-manager); with the
// CLI body as top-level await of the ENTRY module, that import waits for this module's evaluation, which waits for the
// import — an ESM cycle deadlock (Node: «unsettled top-level await»; here the live sampler kept the process alive, so
// it hung instead of exiting 13). Three live checks hung 2026-09-25; the stock smoke passed only because a null curve
// never imports curve-store. The function form lets this module finish evaluating before any card seam runs.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) (async () => {
  if (process.argv.includes('--help')) {
    console.log([
      'npm run validate -- …  (automation-engine/lib/mode-validate.mjs) — проверка целого режима, эпик 101 Ф1',
      '  --mode <режим> --candidate <профиль.json> [--minutes N]   ⚠️ ПИШЕТ В КАРТУ: применяет кандидата, гоняет смесь, откатывает к заводскому',
      '  --mode <режим> --candidate <профиль.json> --dry-run        план проверки; карта, журнал и файлы не трогаются',
      '  --step --mode <режим> --band-margins a,…,g [--minutes N]  ⚠️ ПИШЕТ В КАРТУ: шаг приближения — документ → снимок → кандидат → проверка (plans/105)',
      '  --step --mode <режим> --band-margins a,…,g --dry-run      план шага: запас и исчерпание по полосам, имя документа; ничего не пишет',
      '  --plan [--minutes N]                                      смесь нагрузок, без карты',
      '  --hits <сэмплер.jsonl> […]                                карта посещений по записанной телеметрии, без карты',
      '  --compare --stock <захваты.json,…> --mode <захваты.json,…>  таблица выгоды по записанным захватам, без карты',
      '  --replay <захват.json> [--stock …]                        послепроверочная половина над записью; журнал в песочнице',
      '  --selftest                                                самопроверка, без карты',
    ].join('\n'));
    process.exit(0);
  }
  if (process.argv.includes('--selftest')) {
    const r = await runSelfTest();
    for (const x of r.results) console.log(`${x.ok ? '✅' : '❌'} ${x.what}${x.got ? ' — ' + x.got : ''}`);
    console.log(`\n${r.results.filter((x) => x.ok).length}/${r.results.length} зелёных`);
    process.exit(r.ok ? 0 : 1);
  } else if (process.argv.includes('--hits')) {
    // The visit map of a RECORDED sampler file — offline; the band boundaries are `[AI]` and this is how
    // they get refined (researches/39 §4 п. 2): what a real load actually visited.
    const files = process.argv.slice(process.argv.indexOf('--hits') + 1).filter((a) => !a.startsWith('--'));
    if (files.length === 0) { console.error('ОШИБКА: --hits <файл сэмплера> [ещё файлы]'); process.exit(2); }
    for (const f of files) {
      let parsed; try { parsed = parseSamples(readFileSync(f, 'utf8')); } catch (e) { console.log(`${f}: не прочитан — ${e.message}`); continue; }
      const map = hitMap(parsed.samples, { periodMs: parsed.periodMs });
      const total = map.reduce((s, p) => s + p.seconds, 0);
      console.log(`${f.replace(/\\/g, '/')} — проб ${parsed.samples.length}, ${total} с; посещены (≥ ${MIN_BAND_DWELL_S} с): ${visitedBands(map).map((i) => map[i].label).join(' · ') || 'ни одна'}`);
      console.log('  ' + map.map((p) => `${p.label}: ${p.seconds} с (${Math.round(p.share * 100)} %)`).join(' · '));
    }
  } else if (process.argv.includes('--step')) {
    // plans/105 Ш3: npm run validate -- --step --mode <режим> --band-margins a,…,g [--minutes N] [--dry-run]
    const arg = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
    const mode = arg('--mode'); const raw = arg('--band-margins'); const dry = process.argv.includes('--dry-run');
    const minutesArg = arg('--minutes');
    if (!mode || !raw) { console.error('ОШИБКА: --step --mode <режим> --band-margins a,b,c,d,e,f,g [--minutes N] [--dry-run]'); process.exit(2); }
    const margins = raw.split(',').map((x) => Number(x.trim()));
    let plan; try { plan = planMix({ minutes: minutesArg === null ? null : Number(minutesArg) }); } catch (e) { console.error(`ОШИБКА: ${e.message}`); process.exit(2); }
    const journal = openValidateJournal();
    if (await closeDeathsFirst(journal, dry)) process.exit(dry ? 0 : 1);
    let step; try { step = await prepareStep({ mode, margins, dry }); } catch (e) { console.error(`ОТКАЗ: ${e.message}`); process.exit(2); }
    console.log(renderStepPlan(step));
    process.exit(await checkCommand({ mode, profile: dry ? null : step.candidate, plan, dry, margins, journal }));
  } else if (process.argv.includes('--mode') && !process.argv.includes('--compare')) {
    // `--compare` has its own `--mode` flag (the mode's captures) — found by the session-102 judge: this branch,
    // placed first, swallowed every `--compare` call (128f6bf). The check path is taken only without it.
    // THE CHECK. npm run validate -- --mode <mode> --candidate <profile.json> [--minutes N] [--dry-run]
    const arg = (f) => { const i = process.argv.indexOf(f); return i === -1 ? null : process.argv[i + 1]; };
    const mode = arg('--mode'); const candFile = arg('--candidate'); const dry = process.argv.includes('--dry-run');
    const minutesArg = arg('--minutes');
    if (!mode || !candFile) { console.error('ОШИБКА: --mode <режим> --candidate <profiles/…json> [--minutes N] [--dry-run]'); process.exit(2); }
    const profile = JSON.parse(readFileSync(candFile, 'utf8'));
    if (profile.mode !== mode) { console.error(`ОТКАЗ: кандидат «${profile.name}» — режима «${profile.mode}», а заказан «${mode}»`); process.exit(2); }
    let plan; try { plan = planMix({ minutes: minutesArg === null ? null : Number(minutesArg) }); } catch (e) { console.error(`ОШИБКА: ${e.message}`); process.exit(2); }
    const journal = openValidateJournal();
    if (await closeDeathsFirst(journal, dry)) process.exit(dry ? 0 : 1);
    process.exit(await checkCommand({ mode, profile, plan, dry, margins: null, journal }));
  } else if (process.argv.includes('--replay')) {
    // --replay <capture.json> [--stock <capture.json,…>] — the post-check half (verdict · the REAL driver voice
    // from the Windows log for the recording's window · visit map · report) over a RECORDED game capture.
    // Sandbox journal: a replay is not a check and never reaches runs/validate/journal.jsonl or the metric.
    const capFile = process.argv[process.argv.indexOf('--replay') + 1];
    if (!capFile || capFile.startsWith('--')) { console.error('ОШИБКА: --replay <захват.json>'); process.exit(2); }
    const cap = JSON.parse(readFileSync(capFile, 'utf8'));
    const tele = join(dirname(capFile), cap.sampleFile);
    const { samples } = parseSamples(readFileSync(tele, 'utf8'));
    if (samples.length === 0) { console.error(`ОШИБКА: в ${tele} нет проб`); process.exit(1); }
    const times = [samples[0].ms, samples.at(-1).ms + 1000];
    let call = 0;
    const box = mkdtempSync(join(tmpdir(), 'kago-replay-'));
    try { // the sandbox goes away whatever throws (second judge, session 102)
    const result = await runCheck({
      journal: openValidateJournal({ dir: box }), mode: `${cap.profile ?? 'запись'} (повтор ${cap.label})`, plan: { stages: [{ kind: MIX_STAGE.GAME, label: `Q2RTX, записанный захват ${cap.label}` }] },
      telemetryPath: tele, nowMs: () => times[Math.min(call++, 1)],
      seams: {
        startSampler: () => ({ stop() {} }),
        apply: async () => ({ ok: true, why: 'повтор записи — в карту ничего не применялось' }),
        runStage: async () => ({ ok: cap.exitCode === 0 && cap.faultFree !== false, why: cap.reason ?? `код ${cap.exitCode}`, endedAtMs: samples.at(-1).ms }),
        rollback: async () => ({ ok: true }),
        readSamples: (p) => parseSamples(readFileSync(p, 'utf8')),
        driverEvents: (fromMs, toMs) => realDriverEvents(fromMs, toMs),
      },
    });
    const sf = listAfter('--stock');
    if (sf.length) result.benefit = benefitRows({ stock: await captureGroup(sf), mode: await captureGroup([capFile]) });
    process.stdout.write(renderCheckReport(result));
    // The sandbox is removed (judge, session 102: replays left %TEMP%/kago-replay-*); `--out <dir>` keeps the report.
    const outDir = (() => { const i = process.argv.indexOf('--out'); return i === -1 ? null : process.argv[i + 1]; })();
    if (outDir) { const out = writeCheckReport(outDir, result); console.log(`\n(повтор; отчёт — ${out.report.replace(/\\/g, '/')}; боевой журнал проверок не тронут)`); }
    else console.log('\n(повтор; боевой журнал проверок не тронут; песочница удалена — `--out <папка>` сохранит отчёт)');
    } finally { rmSync(box, { recursive: true, force: true }); }
  } else if (process.argv.includes('--compare')) {
    // --compare --stock <capture.json,…> --mode <capture.json,…> — graphics capture records (runs/graphics/*.json).
    const sf = listAfter('--stock'); const mf = listAfter('--mode');
    if (!sf.length || !mf.length) { console.error('ОШИБКА: --compare --stock <захват.json,…> --mode <захват.json,…>'); process.exit(2); }
    const stock = await captureGroup(sf); const mode = await captureGroup(mf);
    console.log(`ВЫГОДА ПРОТИВ СТОКА — медианы под нагрузкой (проб: сток ${stock.n} · режим ${mode.n}); карта не трогается`);
    console.log('величина · сток · режим · разница');
    const f1 = (x) => (x === null ? '—' : (Math.round(x * 10) / 10).toString().replace('.', ','));
    for (const r of benefitRows({ stock, mode })) console.log(`${r.label} · ${f1(r.stock)} · ${f1(r.mode)} · ${r.delta === null ? '—' : (r.delta > 0 ? '+' : '') + f1(r.delta)}${r.deltaPct === null ? '' : ` (${r.deltaPct > 0 ? '+' : ''}${f1(r.deltaPct)} %)`}`);
  } else if (process.argv.includes('--probe-import-cycle')) {
    // bugs/141 — the selftest's probe: the card path's import of curve-store, made from inside this CLI.
    const cs = await import('./curve-store.mjs');
    console.log(typeof cs.loadReferenceTable === 'function' ? 'ЦИКЛ ИМПОРТА: ПРОЙДЕН' : 'ЦИКЛ ИМПОРТА: модуль без loadReferenceTable');
  } else if (process.argv.includes('--plan')) {
    const i = process.argv.indexOf('--minutes');
    const minutes = i === -1 ? null : Number(process.argv[i + 1]);
    let plan; try { plan = planMix({ minutes }); } catch (e) { console.error(`ОШИБКА: ${e.message}`); process.exit(2); }
    console.log(`СМЕСЬ ПРОВЕРКИ РЕЖИМА — ${minutes === null ? 'каноническая' : minutes + ' мин заказано'}, ${Math.round(plan.totalS / 6) / 10} мин по плану (${plan.totalS} с); карта не трогается`);
    let t = 0;
    for (const s of plan.stages) {
      const dur = stageSeconds(s);
      const what = s.kind === MIX_STAGE.TRANSITIONS ? `${s.cycles} × (${s.onS} с нагрузка / ${s.offS} с простой)` : `${dur} с`;
      console.log(`  ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}  ${s.label} — ${what}`);
      t += dur;
    }
    console.log('На карте эту смесь гоняет `--mode <режим> --candidate <профиль>` — ни разу ещё не запускался вживую (дым Ш8).');
  } else {
    console.log('npm run validate -- --help — все команды проверки режима; без ключей ничего не делает');
  }
})().catch((e) => { console.error(`ОШИБКА: ${e?.stack ?? e}`); process.exit(1); });
