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
//
// [NOT-TESTED] at birth — the blocks of `selfTest()` flip it.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openJournal, appendLine, readJournal, orphanIntents, LINE } from './sweep-journal.mjs';
import { parseSampleTime } from './hardware-mon.mjs';
import { MODE_BANDS, MARGIN_DESCENT_STEP_MV, RATCHET_GRID_STEPS, MIN_BAND_DWELL_S, PULSE_STALL_MS } from '../config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
export const VALIDATE_DIR = join(ROOT, 'runs', 'validate');
export const CHECK_KIND = 'mode-check';

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
export function verdictOf({ samples = [], driverEvents = [], stages = [], stallMs = PULSE_STALL_MS, bands = MODE_BANDS } = {}) {
  if (samples.length === 0) return { verdict: CHECK_VERDICT.UNKNOWN, why: 'телеметрии нет — проверка не наблюдалась', failures: [], failure: null };
  const failures = [];
  for (const e of driverEvents) failures.push({ cls: FAILURE_CLASS.DRIVER, atMs: e.atMs, why: `событие драйвера ${e.id ?? ''}`.trim() });
  for (const st of stages) if (!st.ok) failures.push({ cls: FAILURE_CLASS.LOAD, atMs: st.endedAtMs, why: `${st.name}: ${st.why ?? 'нагрузка кончилась ненормально'}` });
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].ms - samples[i - 1].ms;
    if (gap > stallMs) failures.push({ cls: FAILURE_CLASS.TELEMETRY_GAP, atMs: samples[i - 1].ms, why: `сэмплер молчал ${gap} мс (порог ${stallMs})` });
  }
  failures.sort((a, b) => a.atMs - b.atMs);
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
 *   FAILED  → the failure's band rises by its ratchet and is FLOORED there; an unknown band (a death with
 *             no durable sample) raises EVERY band — the conservative direction, named in `changes`.
 *   UNKNOWN → nothing moves.
 */
export function nextMargins({ margins, floors = null, verdict, visited = [], failureBand = null, ratchetMv, stepMv = MARGIN_DESCENT_STEP_MV }) {
  const m = [...margins];
  const f = floors ? [...floors] : margins.map(() => 0);
  const changes = [];
  if (verdict === CHECK_VERDICT.PASSED) {
    for (const i of visited) {
      const to = Math.max(f[i], 0, m[i] - stepMv);
      if (to !== m[i]) changes.push({ band: i, from: m[i], to, why: 'проверка пройдена, полоса посещена — спуск на шаг' });
      m[i] = to;
    }
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
export function writeCheckVerdict(journal, { seq, verdict, failure = null, hits = null, at, why = '' }, io = {}) {
  const rec = { state: LINE.VERDICT, kind: CHECK_KIND, seq, verdict, failure, hits, why, at };
  appendLine(journal, rec, io);
  return rec;
}

/**
 * An intent nobody closed IS the answer: the check was in flight when the machine died. The verdict is
 * FAILED/death, and the band is the one the LAST durable sample of that check's telemetry names
 * (ЗАКАЗ.md §4). `readSamples(path)` is injected so the rule is provable without a card.
 */
export function deathVerdicts(records, { readSamples = (p) => parseSamples(readFileSync(p, 'utf8')).samples, bands = MODE_BANDS } = {}) {
  return orphanIntents(checkRecords(records)).map((intent) => {
    let samples = [];
    try { samples = intent.telemetryPath ? readSamples(intent.telemetryPath) : []; } catch { samples = []; }
    const last = samples.at(-1) ?? null;
    return {
      seq: intent.seq, mode: intent.mode, verdict: CHECK_VERDICT.FAILED,
      failure: { cls: FAILURE_CLASS.DEATH, atMs: last?.ms ?? null, band: last ? bandOf(last.mhz, bands) : null, lastMhz: last?.mhz ?? null, why: last ? `незакрытое намерение; последняя долговечная проба ${last.mhz} МГц` : 'незакрытое намерение; долговечных проб нет — полоса неизвестна' },
    };
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

/** The metric line — first line of `npm run curve -- --progress`. */
export function renderValidatedLine(v) {
  const margins = Object.entries(v.last).filter(([, x]) => Array.isArray(x.margins))
    .map(([m, x]) => `${m} ${x.margins.map((n) => '+' + n).join('/')}`);
  return `РЕЖИМОВ ПРОВЕРЕНО ${v.passed.length}/${v.total}${v.passed.length ? ' (' + v.passed.join(' · ') + ')' : ''}`
    + ` · запас по полосам: ${margins.length ? margins.join(' ; ') : 'проверок ещё не было'}`
    + ' · выгода против стока: таблиц ещё нет · неделя пользования: прибором не отслеживается'
    + (v.open ? ` · ⚠️ незакрытых намерений проверки ${v.open} — это смерть машины, разобрать до новой проверки` : '');
}

// -------------------------------------------------------------------------------------------------
// Selftest — fixtures in memory and in a temp sandbox; no card, no production journal
// -------------------------------------------------------------------------------------------------

export function selfTest() {
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

  // P102-AC6: the metric
  const MODES = ['max-performance', 'optimised', 'silent-cold', 'stock-default'];
  const I = (seq, mode, snapshot, margins = null) => ({ state: LINE.INTENT, kind: CHECK_KIND, seq, mode, snapshot, margins });
  const V = (seq, verdict) => ({ state: LINE.VERDICT, kind: CHECK_KIND, seq, verdict });
  const profs = [{ mode: 'optimised', settings: { curveSnapshot: 'snapB' } }, { mode: 'stock-default', settings: {} }];
  const mv = modesValidated([I(1, 'optimised', 'snapA'), V(1, 'passed'), I(2, 'stock-default', null), V(2, 'passed'), I(3, 'silent-cold', 'snapC'), V(3, 'failed'), I(4, 'max-performance', 'snapD')], { profiles: profs, modes: MODES });
  check('МЕТРИКА: СЧИТАЕТСЯ ПРОЙДЕННАЯ ПРОВЕРКА ТОЙ КРИВОЙ, НА КОТОРОЙ РЕЖИМ СТОИТ СЕЙЧАС', mv.passed.join() === 'stock-default' && mv.open === 1, `пройдены ${mv.passed.join()} · незакрытых ${mv.open}`);
  const mv2 = modesValidated([I(1, 'optimised', 'snapB', [30, 30, 30, 30, 20, 30, 30]), V(1, 'passed')], { profiles: profs, modes: MODES });
  const line = renderValidatedLine(mv2);
  check('СТРОКА МЕТРИКИ: ЧИСЛО, ЗАПАС ПО ПОЛОСАМ И ЧЕСТНОЕ «НЕ ОТСЛЕЖИВАЕТСЯ»', line.startsWith('РЕЖИМОВ ПРОВЕРЕНО 1/4 (optimised)') && line.includes('+30/+30/+30/+30/+20/+30/+30') && line.includes('прибором не отслеживается'), line);
  check('СТРОКА МЕТРИКИ НА ПУСТОМ ЖУРНАЛЕ — 0/4', renderValidatedLine(modesValidated([], { modes: MODES })).startsWith('РЕЖИМОВ ПРОВЕРЕНО 0/4 · запас по полосам: проверок ещё не было'));

  return { ok: results.every((r) => r.ok), results };
}

export function runSelfTest() {
  try { return selfTest(); } catch (e) {
    return { ok: false, results: [{ ok: false, what: 'НАБОР УПАЛ, НЕ ДОЙДЯ ДО КОНЦА — это красный блок', got: `${e.name}: ${e.message}` }] };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--help')) { console.log('node automation-engine/lib/mode-validate.mjs --selftest — журнал, вердикт, карта посещений и храповик проверки режима (эпик 101 Ф1); карту не трогает'); process.exit(0); }
  if (process.argv.includes('--selftest')) {
    const r = runSelfTest();
    for (const x of r.results) console.log(`${x.ok ? '✅' : '❌'} ${x.what}${x.got ? ' — ' + x.got : ''}`);
    console.log(`\n${r.results.filter((x) => x.ok).length}/${r.results.length} зелёных`);
    process.exit(r.ok ? 0 : 1);
  } else {
    console.log('node automation-engine/lib/mode-validate.mjs --selftest — журнал, вердикт, карта посещений и храповик проверки режима (эпик 101 Ф1); прибор, который гоняет карту, — Ш4');
  }
}
