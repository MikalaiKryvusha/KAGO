#!/usr/bin/env node
// thermal-ladder.mjs — the owner's own construction of the temperature measurement: hard clock
// ceilings as rungs, the RT game on every rung, and a PLATEAU detected rather than waited for.
//
// Plan anchor (plans/05_epic01_phase5_vmin_engine.md §4.5a): «нужно сделать лестницу с жёсткими
// максимальными частотами, и гонять на них игру с лучами - максимально грузить карту на заданном
// потолке частоты» — and the plan's requirement on top of it: «Hold each rung to a PLATEAU, defined
// and detected, not timed by hope: temperature AND fan both stable for ≥ 60 s. A rung that never
// plateaus is reported as such rather than averaged.»
//
// WHAT IT IS FOR, in one number. `Silent Cold` is defined as the maximum performance obtainable at a
// temperature no higher than the one at which the fans hold 40 % (GOAL.md). So the whole mode hangs
// off T(40 %) — and every fan↔temperature pair this project owns came off a TRANSIENT: on the way
// down the fan crossed 40 % at 47 °C, on the way up the same 40 % sat at 62-63 °C (STATUS fact 33).
// Sixteen degrees of disagreement for one fan level is not a measurement, and no amount of care in
// reading a transient repairs it. Equilibrium has to be reached and then RECOGNIZED.
//
// WHY A PINNED CLOCK RATHER THAN A SWEPT POWER LIMIT — the owner's reasoning, and it is correct: a
// held clock fixes the WORK, so the dissipated power is constant and the temperature converges to a
// true equilibrium. `-pl` caps a ceiling the card may or may not reach, so it fixes a limit rather
// than a load. The ladder therefore yields the table directly:
//
//     clock ceiling  →  equilibrium temperature  →  equilibrium fan  →  the FPS it cost
//
// and `Silent Cold` reads off it as the HIGHEST rung whose equilibrium fan is ≤ 40 %
// (`readSilentCold`, below). That is «maximum performance under a temperature ceiling» with no
// guesswork left in it.
//
// THE `-lgc` BOUNDARY, restated so nobody widens it: pinning is legal for a MEASUREMENT — a held clock
// is what makes a watt comparison legal (EXP-0018) — and stays OUT of every shipped profile, where
// `min = max` would forbid the card from clocking down at idle (the owner's requirement: «карта сама
// могла и разгоняться и снижать частоты»). This module measures; it ships nothing.
//
// GPU WRITES: one kind only — the clock pin, through `profile-manager.mjs` (rule R1). No curve write,
// no voltage, no power limit, no fan level. The safety shape is NOT re-implemented here: the rung loop
// is `ladder-descent.descend()`, which already owns «apply → measure → prove the lock under load →
// release in a `finally`, and abort the whole ladder if a release ever fails» and is mutation-proved
// over 39 blocks. This module supplies that loop with a different LOAD and a different STOPPING RULE,
// which is the only thing that is new here.
//
// Usage:
//   node automation-engine/lib/thermal-ladder.mjs --selftest              the logic, no GPU, no game
//   node automation-engine/lib/thermal-ladder.mjs --analyze               the detector over runs/graphics/*
//   node automation-engine/lib/thermal-ladder.mjs --points 2400 --dry-run the plan, no writes
//   node automation-engine/lib/thermal-ladder.mjs --points 2400,2100,1800 --runs 20
//
// [NOT-TESTED]

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import config from '../config.mjs';
import { median, readSamples, summarizeSamples } from './power-baseline.mjs';
import { GRAPHICS_DIR, capture as graphicsCapture, locateGame } from './graphics-load.mjs';
import { descend, snapToLadder } from './ladder-descent.mjs';
import { nvidiaSmiBackend, readState } from './profile-manager.mjs';
import { probeCard } from './profile-store.mjs';
import * as wd from './watchdog.mjs';

export const THERMAL_DIR = join(GRAPHICS_DIR, '..', 'thermal');

/** How often the watchdog lease is renewed while a rung is in flight. */
const WATCHDOG_BEAT_MS = 30_000;
/** The lease itself — long enough to survive a blocking probe, short enough to be a real guard. */
const WATCHDOG_TTL_MS = 180_000;

/** A machine receipt carries the owner's local time with its offset (AGENT_GUIDE.md → stamps). */
function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

// =================================================================================================
// 1. Time — taken from the sampler's own stamps, never from the sample count
// =================================================================================================

/**
 * Parse one `hardware-mon` timestamp (`2026/08/10 20:21:48.415`) into milliseconds.
 *
 * Built with `Date.UTC` on purpose although the stamp is LOCAL: this value is only ever used as a
 * DIFFERENCE between two samples of the same run, and constructing both the same way makes that
 * difference exact wall-clock seconds without dragging a timezone into it.
 *
 * [NOT-TESTED]
 */
export function parseSampleTime(t) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms ?? 0));
}

/**
 * Turn sampler rows into the three things the plateau test needs — elapsed seconds, the temperature,
 * the fan — plus whether the card was under LOAD at that moment.
 *
 * THE LOAD FLAG IS NOT BOOKKEEPING, IT IS THE GATE THAT PREVENTS A FALSE PLATEAU. Every capture opens
 * with the card idle while the game starts: perfectly flat, perfectly quiet, perfectly stable — and
 * utterly meaningless as an equilibrium. A detector that only looked for stability would announce
 * «плато: 42 °C, вентилятор 0 %» before the game had drawn a single frame, and it would be the most
 * confident wrong answer this project could produce.
 *
 * The mapping is 1:1 with the rows it is given, so a window's indices address the rows too, and the
 * caller can slice the same samples to compute medians over exactly the plateau (which is the whole
 * point: the table's watts and clock must be equilibrium values, not whole-run averages).
 *
 * TIME SOURCE, decided once for the whole series rather than per row — mixing two clocks inside one
 * series is how a drift figure becomes fiction. Stamps if they all parse; the sampler's own period
 * otherwise; and if neither is available, the index, which at least preserves order.
 *
 * [NOT-TESTED]
 */
export function toPlateauPoints(rows, { loadPct = config.PLATEAU_LOAD_UTILIZATION_PCT, periodMs = null } = {}) {
  const list = (rows ?? []).filter((r) => r && r.i >= 0 && r.sample);
  const times = list.map((r) => parseSampleTime(r.t));
  const stampsUsable = list.length > 0 && times.every((t) => t !== null);
  const t0 = stampsUsable ? times[0] : null;
  return list.map((r, k) => {
    const seconds = stampsUsable
      ? (times[k] - t0) / 1000
      : (Number.isFinite(periodMs) ? (r.i * periodMs) / 1000 : k);
    const util = Number(r.sample['utilization.gpu']);
    return {
      seconds,
      temperature: Number(r.sample['temperature.gpu']),
      fan: Number(r.sample['fan.speed']),
      loaded: Number.isFinite(util) && util >= loadPct,
      timeSource: stampsUsable ? 'stamp' : (Number.isFinite(periodMs) ? 'period' : 'index'),
    };
  });
}

// =================================================================================================
// 2. THE PLATEAU — two gates per quantity, because one is the mistake this project already paid for
// =================================================================================================

/** min/max/median/range over a numeric column, or nulls when the column is unusable. */
function bandOf(values) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length !== values.length || !v.length) return null;
  return { median: median(v), min: Math.min(...v), max: Math.max(...v), range: Math.max(...v) - Math.min(...v) };
}

/**
 * Judge ONE window: the range gate (noise) and the drift gate (trend), for both quantities.
 *
 * WHY BOTH GATES, and it is EXP-0028 one level up. That lesson says «"read until two consecutive
 * samples agree" proves a settled DIGITAL state and does not transfer to a MECHANICAL one — a ramping
 * quantity has plateaus, and a plateau agrees with itself». A range gate at window scale is exactly
 * the same error wearing a longer sleeve: a card climbing 2 °C per minute sits inside a 3 °C band for
 * ninety seconds at a stretch and would be declared settled. The drift gate is what refuses it.
 *
 * DRIFT IS A RATE — °C per MINUTE — and the first version of this function got that wrong in a way the
 * selftest caught: as a bare «difference of half medians ≤ 1 °C» it reads as "moves less than a degree"
 * and means "less than a degree per HALF-WINDOW", so a fixture climbing 1.5 °C/min passed. Dividing by
 * the time between the two halves' CENTROIDS fixes both halves of that problem at once: the number
 * means what it says, and it stops depending on the window's length or on how densely it was sampled.
 *
 * THE HALVES ARE SPLIT BY TIME, NOT BY SAMPLE COUNT. The sampler's period is nominal, not guaranteed:
 * a stalled probe makes one half hold more samples than the other, and an index split would then
 * compare unequal stretches of the run.
 *
 * MEDIANS RATHER THAN MEANS on both halves: the temperature is quantized to whole degrees and the fan
 * to whole percent, so a single outlying sample moves a mean and does not move a median.
 *
 * [NOT-TESTED]
 */
export function judgeWindow(points, from, to, {
  tempRangeC = config.PLATEAU_TEMP_RANGE_C,
  tempDriftC = config.PLATEAU_TEMP_DRIFT_C_PER_MIN,
  fanRangePct = config.PLATEAU_FAN_RANGE_PCT,
  fanDriftPct = config.PLATEAU_FAN_DRIFT_PCT_PER_MIN,
} = {}) {
  const slice = points.slice(from, to + 1);
  const spanSeconds = slice.length ? slice[slice.length - 1].seconds - slice[0].seconds : 0;
  const temperature = bandOf(slice.map((p) => p.temperature));
  const fan = bandOf(slice.map((p) => p.fan));
  const window = { fromIndex: from, toIndex: to, fromSeconds: slice[0]?.seconds ?? null, toSeconds: slice[slice.length - 1]?.seconds ?? null, seconds: spanSeconds, n: slice.length };

  if (!temperature || !fan) {
    return { ok: false, window, temperature, fan, failures: ['в окне есть пробы без температуры или оборотов'], why: 'в окне есть пробы без температуры или оборотов' };
  }

  // The midpoint of the window's TIME, so the two halves cover equal stretches of the run.
  const mid = slice[0].seconds + spanSeconds / 2;
  const first = slice.filter((p) => p.seconds < mid);
  const second = slice.filter((p) => p.seconds >= mid);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  // The centroids of the two halves in TIME — the baseline the difference is a rate over. Using the
  // window's nominal half-length instead would misreport the rate the moment sampling is uneven, which
  // is exactly when a drift figure is most likely to be trusted and most likely to be wrong.
  const baselineMinutes = (first.length && second.length)
    ? (mean(second.map((p) => p.seconds)) - mean(first.map((p) => p.seconds))) / 60
    : null;
  const driftOf = (get) => {
    if (!first.length || !second.length || !baselineMinutes) return null;
    return (median(second.map(get)) - median(first.map(get))) / baselineMinutes;
  };
  temperature.driftPerMin = driftOf((p) => p.temperature);
  fan.driftPerMin = driftOf((p) => p.fan);

  const signed = (x) => `${x > 0 ? '+' : ''}${x.toFixed(1)}`;
  const failures = [];
  if (temperature.range > tempRangeC) failures.push(`температура гуляет на ${temperature.range} °C (допуск ${tempRangeC})`);
  if (temperature.driftPerMin === null) failures.push('окно не делится на половины — дрейф температуры не посчитать');
  else if (Math.abs(temperature.driftPerMin) > tempDriftC) {
    failures.push(`температура ещё ${temperature.driftPerMin > 0 ? 'РАСТЁТ' : 'ПАДАЕТ'}: ${signed(temperature.driftPerMin)} °C/мин (допуск ±${tempDriftC})`);
  }
  if (fan.range > fanRangePct) failures.push(`обороты гуляют на ${fan.range} % (допуск ${fanRangePct})`);
  if (fan.driftPerMin === null) failures.push('окно не делится на половины — дрейф оборотов не посчитать');
  else if (Math.abs(fan.driftPerMin) > fanDriftPct) {
    failures.push(`вентилятор ещё ${fan.driftPerMin > 0 ? 'РАСКРУЧИВАЕТСЯ' : 'ЗАМЕДЛЯЕТСЯ'}: ${signed(fan.driftPerMin)} %/мин (допуск ±${fanDriftPct})`);
  }

  return {
    ok: failures.length === 0,
    window,
    temperature,
    fan,
    failures,
    why: failures.length === 0
      ? `равновесие: ${temperature.median} °C (размах ${temperature.range}, дрейф ${signed(temperature.driftPerMin)} °C/мин) · `
        + `вентилятор ${fan.median} % (размах ${fan.range}, дрейф ${signed(fan.driftPerMin)} %/мин) за ${spanSeconds.toFixed(0)} с`
      : failures.join(' · '),
  };
}

/**
 * Find the EARLIEST window in which the card had settled — or report how far it got.
 *
 * EARLIEST, not last, and the choice is not cosmetic: the question this measurement answers is «at
 * what temperature does this rung settle», and the first window that satisfies the gates is the moment
 * it did. Taking the last window would silently report the tail of the run, which is the same value
 * when the card really settled and a WRONG value when it drifted afterwards — the failure would be
 * invisible precisely when it matters.
 *
 * NO WINDOW MAY STRADDLE A GAP IN THE LOAD. A dip below the load threshold (the game between demo
 * loops, a loading screen) is a different thermal regime, and a window that spans one averages two.
 *
 * ON FAILURE THE NUMBERS STILL COME BACK. «Не вышла на плато» alone would send the next session to
 * re-run blind; «температура ещё РАСТЁТ: +3.0 °C за окно» says what to change (hold the rung longer).
 * A refusal that carries its own evidence is the difference between a report and a shrug.
 *
 * [NOT-TESTED]
 */
export function findPlateau(points, {
  windowSeconds = config.PLATEAU_WINDOW_SECONDS,
  ...gates
} = {}) {
  const list = Array.isArray(points) ? points : [];
  const empty = { ok: false, window: null, temperature: null, fan: null, failures: [], candidates: 0 };
  if (list.length < 2) return { ...empty, why: `проб всего ${list.length} — окна не построить` };

  let last = null;
  let candidates = 0;

  for (let i = 0; i < list.length; i++) {
    if (!list[i].loaded) continue;
    let j = i;
    let broken = false;
    while (j + 1 < list.length && list[j].seconds - list[i].seconds < windowSeconds) {
      j++;
      if (!list[j].loaded) { broken = true; break; }
    }
    if (broken) { i = j; continue; }                      // resume AFTER the gap, never across it
    if (list[j].seconds - list[i].seconds < windowSeconds) break;  // the tail is shorter than a window
    candidates++;
    const verdict = judgeWindow(list, i, j, gates);
    last = verdict;
    if (verdict.ok) return { ...verdict, candidates };
  }

  if (last) return { ...last, ok: false, candidates, why: `плато не найдено. Ближайшее окно: ${last.why}` };
  const spanned = list.length ? list[list.length - 1].seconds - list[0].seconds : 0;
  const stretch = longestLoadedStretch(list);
  return {
    ...empty,
    longestLoadedSeconds: stretch.seconds,
    why: stretch.samples === 0
      ? 'под нагрузкой нет ни одной пробы — карта не грузилась'
      // The SHORTFALL, not just the refusal: this is the number that says what to change, and saying
      // «проб под нагрузкой N» instead would answer a question nobody asked (the first version of this
      // message counted window ATTEMPTS and read as a sample count — caught by running the detector
      // over the captures already on disk).
      // One decimal, not zero: at the boundary «60 с, а окну нужно 60 с» reads as a contradiction, and
      // a report a reader has to argue with is a defect of its own.
      : `самый длинный НАГРУЖЕННЫЙ отрезок — ${stretch.seconds.toFixed(1)} с, а окну нужно ${windowSeconds} с `
        + `(весь прогон ${spanned.toFixed(0)} с, проб под нагрузкой ${stretch.samples} из ${list.length}). Держать ступень дольше`,
  };
}

/**
 * The longest unbroken stretch of load in the series, in seconds — the number that says how much
 * longer a rung must be held. [NOT-TESTED]
 */
export function longestLoadedStretch(points) {
  const list = Array.isArray(points) ? points : [];
  let best = { seconds: 0, samples: 0 };
  let startIdx = null;
  let loadedTotal = 0;
  for (let i = 0; i <= list.length; i++) {
    const loaded = i < list.length && list[i].loaded;
    if (loaded) { loadedTotal++; if (startIdx === null) startIdx = i; continue; }
    if (startIdx !== null) {
      const seconds = list[i - 1].seconds - list[startIdx].seconds;
      if (seconds > best.seconds) best = { seconds, samples: i - startIdx };
      startIdx = null;
    }
  }
  return { seconds: best.seconds, samples: loadedTotal, longestSamples: best.samples };
}

// =================================================================================================
// 3. Reading the mode off the table — the deliverable of §4.5a, as a function
// =================================================================================================

/**
 * `Silent Cold` = the HIGHEST rung whose EQUILIBRIUM fan is ≤ the owner's ceiling.
 *
 * His definition, verbatim: «целится на то, чтобы Silent Cold давал максимально возможную
 * производительность при температуре не выше, при которой вертушки вращаются на 40%». Written as an
 * optimization it is: maximize the clock ceiling SUBJECT TO fan(equilibrium) ≤ 40 %. On a monotone
 * ladder the answer is simply the highest qualifying rung, and this function is that sentence.
 *
 * ONLY RUNGS THAT REACHED A PLATEAU ARE ELIGIBLE. A rung that never settled has no equilibrium fan, so
 * it cannot satisfy a constraint stated about one — it is reported as unusable rather than compared on
 * a transient (which is the exact error this whole module exists to end).
 *
 * [NOT-TESTED]
 */
export function readSilentCold(rows, { fanCeilingPct = config.SILENT_COLD_FAN_CEILING_PCT } = {}) {
  const settled = (rows ?? []).filter((r) => r && r.plateau && r.plateau.ok && Number.isFinite(r.fan));
  const skipped = (rows ?? []).filter((r) => r && !(r.plateau && r.plateau.ok));
  if (!settled.length) {
    return { ok: false, pick: null, fanCeilingPct, skipped: skipped.length, why: 'ни одна ступень не вышла на плато — читать режим не из чего' };
  }
  const qualifying = settled.filter((r) => r.fan <= fanCeilingPct).sort((a, b) => b.mhz - a.mhz);
  if (!qualifying.length) {
    const coldest = [...settled].sort((a, b) => a.fan - b.fan)[0];
    return {
      ok: false,
      pick: null,
      fanCeilingPct,
      skipped: skipped.length,
      why: `ни одна ступень не уложилась в ${fanCeilingPct} % — самая тихая дала ${coldest.fan} % на ${coldest.mhz} МГц. Лестницу надо продолжить ВНИЗ`,
    };
  }
  const pick = qualifying[0];
  const higher = settled.filter((r) => r.mhz > pick.mhz).sort((a, b) => a.mhz - b.mhz)[0] ?? null;
  return {
    ok: true,
    pick,
    higher,
    fanCeilingPct,
    skipped: skipped.length,
    // The bound is named: either the next rung up was measured and broke the ceiling (so the answer is
    // bracketed), or it was never measured (so the answer is a floor, not an optimum). Saying which is
    // the difference between «this is the point» and «this is the best point WE LOOKED AT».
    bounded: Boolean(higher),
    why: higher
      ? `выше неё ${higher.mhz} МГц уже даёт ${higher.fan} % — потолок ${fanCeilingPct} % пройден, ответ зажат между ступенями`
      : `ступени выше ${pick.mhz} МГц не мерены — это НИЖНЯЯ ОЦЕНКА режима, а не его оптимум`,
  };
}

// =================================================================================================
// 4. The rung — the game as the load, the plateau as the stopping rule
// =================================================================================================

/**
 * The capture seam handed to `descend()`.
 *
 * It returns a record shaped like a power-baseline one — same `medians.loaded` field set, because
 * `graphics-load.capture()` builds its medians with the very same `summarizeSamples` — but with the
 * medians recomputed OVER THE PLATEAU WINDOW ONLY. That single substitution buys three things at once
 * and is the reason this adapter exists rather than a second descent loop:
 *
 *   1. the table's temperature, fan, watts and clock become EQUILIBRIUM values instead of whole-run
 *      averages that include the climb;
 *   2. `descend`'s own lock proof (`verifyLockUnderLoad`) is then applied to the plateau, which is
 *      exactly where the pin has to hold for the measurement to mean anything;
 *   3. a rung that never settled THROWS, so `descend` records it as a failed row and — crucially —
 *      still releases the card in its `finally`.
 *
 * [NOT-TESTED]
 */
export function plateauCaptureFn({ runs, bounceRays, gates = {}, captureFn = graphicsCapture, onAnalysis = null }) {
  return async ({ label, profile }) => {
    const record = await captureFn({ label, profile, runs, bounceRays });
    const rows = readSamples(join(GRAPHICS_DIR, record.sampleFile)).filter((r) => r && r.i >= 0 && r.sample);
    const points = toPlateauPoints(rows);
    const plateau = findPlateau(points, gates);
    if (onAnalysis) onAnalysis({ label, record, plateau, points });
    if (!plateau.ok) throw new Error(`ступень не вышла на плато — ${plateau.why}`);

    const slice = rows.slice(plateau.window.fromIndex, plateau.window.toIndex + 1);
    const summary = summarizeSamples(slice);
    return {
      ...record,
      plateau,
      medians: { all: summary.all, loaded: summary.loaded, idle: summary.idle, loadPct: summary.loadPct },
      // The whole run's opening state stays the run's, not the window's: it is a CONDITION of the
      // measurement (what the card started from), and the window has no business rewriting it.
      startTemperature: record.startTemperature,
      samples: summary.counts,
    };
  };
}

/**
 * Walk the rungs. The loop, the writes and the rollback are `ladder-descent.descend()`'s — this
 * function supplies the load, the stopping rule and the table.
 *
 * [NOT-TESTED]
 */
export async function runLadder({
  points,
  card,
  runs = 20,
  bounceRays = config.Q2RTX_BOUNCE_RAYS,
  labelPrefix = 'thermal',
  gates = {},
  captureFn = graphicsCapture,
  backend = undefined,
  timing = {},
  onRow = null,
} = {}) {
  const analyses = new Map();
  const capture = plateauCaptureFn({
    runs, bounceRays, gates, captureFn,
    onAnalysis: ({ label, record, plateau }) => analyses.set(label, { record, plateau }),
  });

  const { rows, aborted } = await descend({
    points,
    labelPrefix,
    card,
    captureFn: capture,
    timing,
    ...(backend ? { backend } : {}),
    onRow: (row) => {
      const enriched = enrich(row, analyses, labelPrefix);
      if (onRow) onRow(enriched);
    },
  });

  return { rows: rows.map((r) => enrich(r, analyses, labelPrefix)), aborted };
}

/** Join a descent row back to the plateau analysis its label carries. [NOT-TESTED] */
function enrich(row, analyses, labelPrefix) {
  const a = analyses.get(`${labelPrefix}_${row.mhz}`);
  if (!a) return { ...row, plateau: null };
  return {
    ...row,
    plateau: a.plateau,
    fps: a.record.fps ? a.record.fps.median : null,
    fpsSpreadPct: a.record.fps ? a.record.fps.spreadPct : null,
    graphicsVerdict: a.record.verdict,
    faultFree: a.record.faultFree,
  };
}

// =================================================================================================
// 5. Selftest — the detector on injected series. No GPU, no game.
// =================================================================================================

/**
 * MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016). Break one guarantee at a time and exactly the
 * named block must redden:
 *   1. delete the temperature DRIFT gate            → «медленный подъём — НЕ плато, хотя размах в допуске»
 *   2. delete the fan DRIFT gate                    → «температура встала, а вентилятор ещё разгоняется — НЕ плато»
 *   3. delete the RANGE gates                       → «шумная полка — НЕ плато: размах шире допуска»
 *   4. start a window on an unloaded sample         → «окно начинается с первой НАГРУЖЕННОЙ пробы, а не с простоя перед ней»
 *   5. return the LAST window instead of the first  → «плато берётся с момента ВЫХОДА на равновесие, а не с конца прогона»
 *   6. accept a window shorter than the requirement → «окно короче требуемого — не плато»
 *   7. divide the drift by the window's NOMINAL half instead of the halves' centroid separation
 *                                                   → «скорость считается между ЦЕНТРОИДАМИ половин…»
 *   8. return a bare false with no numbers          → «отказ несёт числа: НАСКОЛЬКО не дошли»
 *   9. let a window straddle a gap in the load      → «окно не перешагивает провал нагрузки»
 *  10. pick the LOWEST qualifying rung              → «Silent Cold — САМАЯ ВЫСОКАЯ ступень под потолком»
 *  11. let an unsettled rung qualify                → «ступень без плато в выбор не попадает»
 */
export function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  // ---------------------------------------------------------------------------------------------
  // Time
  // ---------------------------------------------------------------------------------------------
  ok('штамп сэмплера разбирается в миллисекунды',
    parseSampleTime('2026/08/10 20:21:49.415') - parseSampleTime('2026/08/10 20:21:48.415'), 1000);
  ok('мусор вместо штампа — null, а не выдуманное время', parseSampleTime('вчера'), null);
  ok('штамп без долей секунды тоже разбирается', parseSampleTime('2026/08/10 20:21:48') !== null, true);

  const row = (i, t, temp, fan, util) => ({ i, t, sample: { 'temperature.gpu': temp, 'fan.speed': fan, 'utilization.gpu': util } });
  const pts = toPlateauPoints([
    row(0, '2026/08/10 20:00:00.000', 42, 0, 5),
    row(1, '2026/08/10 20:00:00.500', 43, 0, 99),
    row(2, '2026/08/10 20:00:01.000', 44, 30, 99),
  ]);
  ok('время считается от ПЕРВОЙ пробы прогона', pts.map((p) => p.seconds), [0, 0.5, 1]);
  ok('проба ниже порога загрузки помечена как простой', pts.map((p) => p.loaded), [false, true, true]);
  // The two measured clusters, as a check rather than as a comment: a frame boundary is the load, a
  // reload is not. The threshold sits between them and this block is what says so out loud.
  const clusters = toPlateauPoints([row(0, '2026/08/10 20:00:00.000', 61, 36, 47), row(1, '2026/08/10 20:00:00.500', 61, 36, 22)]);
  ok('граница кадра (47 % при 100-160 Вт) — это НАГРУЗКА, а перезагрузка демо (22 %) — нет',
    clusters.map((p) => p.loaded), [true, false]);
  ok('источник времени назван, а не подразумевается', pts[0].timeSource, 'stamp');
  const noStamps = toPlateauPoints([row(0, 'x', 42, 0, 99), row(1, 'x', 43, 0, 99)], { periodMs: 500 });
  ok('без штампов время берётся из периода сэмплера и это НАЗВАНО',
    [noStamps.map((p) => p.seconds), noStamps[0].timeSource], [[0, 0.5], 'period']);

  // ---------------------------------------------------------------------------------------------
  // The detector. Every series is 2 samples/s, the window requirement is 60 s.
  // ---------------------------------------------------------------------------------------------
  /** Build a series: `n` samples at 0.5 s spacing, temperature/fan from functions of the index. */
  const series = (n, temp, fan, { loaded = () => true, from = 0 } = {}) =>
    Array.from({ length: n }, (_, k) => ({
      seconds: from + k * 0.5,
      temperature: typeof temp === 'function' ? temp(k) : temp,
      fan: typeof fan === 'function' ? fan(k) : fan,
      loaded: loaded(k),
    }));
  const W = { windowSeconds: 60 };

  // A true plateau: both quantities flat, with the wobble the real card shows.
  const flat = series(200, (k) => 61 + (k % 3 === 0 ? 1 : 0), (k) => 36 + (k % 5 === 0 ? 1 : 0));
  const flatFound = findPlateau(flat, W);
  ok('ровная полка под нагрузкой — это плато', flatFound.ok, true);
  ok('плато сообщает равновесную температуру и обороты',
    [flatFound.temperature.median, flatFound.fan.median], [61, 36]);
  ok('плато берётся с момента ВЫХОДА на равновесие, а не с конца прогона', flatFound.window.fromIndex, 0);
  ok('окно плато не короче требуемого', flatFound.window.seconds >= 60, true);

  // A slow climb: 1.5 °C per minute. The RANGE gate passes it for ninety seconds at a time — this is
  // EXP-0028's trap at window scale, and only the drift gate refuses it.
  const climbing = series(400, (k) => 60 + (k * 0.5 * 1.5) / 60, 36);
  const climbFound = findPlateau(climbing, W);
  ok('медленный подъём — НЕ плато, хотя размах в допуске', climbFound.ok, false);
  ok('отказ по подъёму называет ДРЕЙФ, а не размах', /РАСТЁТ/.test(climbFound.why), true);
  // Null-safe on purpose: a block that THROWS reports nothing at all and takes the whole suite with it,
  // so the mutation it was written to catch reads as a crash instead of as a named red (EXP-0016).
  ok('отказ несёт числа: НАСКОЛЬКО не дошли', Number.isFinite(climbFound.temperature?.driftPerMin), true);
  ok('и число — это скорость, а не разница', Number((climbFound.temperature?.driftPerMin ?? 0).toFixed(1)), 1.5);
  ok('размах у этого же окна В ДОПУСКЕ — то есть один гейт бы пропустил',
    (climbFound.temperature?.range ?? 99) <= config.PLATEAU_TEMP_RANGE_C, true);

  // The temperature settles while the fan is still spinning up — the exact 15 °C-spread failure
  // (STATUS fact 33) in miniature. THE RAMP IS DELIBERATELY SLOW (3 %/min): at 6 %/min the fan's
  // RANGE alone exceeds its gate, and this block would then pass for the neighbouring reason while
  // claiming to guard the drift. The mutation run caught exactly that (EXP-0016).
  const fanStillRamping = series(200, 61, (k) => 30 + (k * 0.5 * 3) / 60);
  const fanFound = findPlateau(fanStillRamping, W);
  ok('температура встала, а вентилятор ещё разгоняется — НЕ плато', fanFound.ok, false);
  ok('отказ называет именно вентилятор', /РАСКРУЧИВАЕТСЯ/.test(fanFound.why), true);
  ok('и размах вентилятора при этом В ДОПУСКЕ — ловит именно дрейф',
    (fanFound.fan?.range ?? 99) <= config.PLATEAU_FAN_RANGE_PCT, true);

  // Noisy but TRENDLESS: a spike every fourth sample leaves the median at 61 in BOTH halves, so the
  // drift is exactly zero and only the range gate can refuse this. Written that way on purpose, and the
  // period is 4 rather than 2 for a reason the mutation run supplied: with alternating values the two
  // halves of a 121-sample window hold different parities, their medians land 3 °C apart, and the DRIFT
  // gate refuses the fixture — leaving this block green while guarding nothing of its own.
  const noisy = series(200, (k) => 61 + (k % 4 === 0 ? 6 : 0), 36);
  const noisyFound = findPlateau(noisy, W);
  ok('шумная полка — НЕ плато: размах шире допуска', noisyFound.ok, false);
  ok('отказ по шуму называет размах', /гуляет/.test(noisyFound.why), true);
  ok('и дрейф у этой же полки РОВНО НОЛЬ — то есть ловит именно размах', noisyFound.temperature?.driftPerMin, 0);

  // THE FALSE PLATEAU THE LOAD GATE EXISTS FOR: 90 s of a cold, silent, perfectly stable idle card
  // before the game starts, then the climb. Without the flag this is the most confident wrong answer
  // available — «плато: 42 °C, вентилятор 0 %».
  const idleThenLoad = [
    ...series(180, 42, 0, { loaded: () => false }),
    ...series(200, (k) => 55 + k * 0.1, (k) => 30 + k * 0.1, { from: 90 }),
  ];
  const idleFound = findPlateau(idleThenLoad, W);
  ok('простой перед запуском игры — НЕ плато, хотя он идеально ровный', idleFound.ok, false);
  ok('и равновесие простоя не выдаётся за равновесие под нагрузкой',
    idleFound.temperature === null || idleFound.temperature.median !== 42, true);

  // The same rule at its finest grain: ONE idle sample, thermally indistinguishable from the load that
  // follows it, must still stay outside the window. Here the verdict is unchanged either way and only
  // the window's START moves — which is exactly why this needs its own block: without one, the rule
  // «a window contains no unloaded sample» is only ever proved for gaps a thermometer could have seen.
  const idlePrefix = [
    { seconds: 0, temperature: 61, fan: 36, loaded: false },
    ...series(200, 61, 36, { from: 0.5 }),
  ];
  ok('окно начинается с первой НАГРУЖЕННОЙ пробы, а не с простоя перед ней',
    findPlateau(idlePrefix, W).window?.fromIndex ?? null, 1);

  // A GAP IN THE LOAD SPLITS THE RUN INTO TWO REGIMES, and no window may span one. The gap's samples
  // are deliberately IDENTICAL in temperature and fan to the load around them: a gap that also moved
  // the temperature would be caught by the range gate, and this block would then prove nothing about
  // the load rule it is named for (the mutation run found it green for exactly that borrowed reason).
  // Physically this is the game between demo loops — utilization drops for a second, the aluminium
  // does not notice.
  const gapped = [
    ...series(80, 61, 36),                                             // 40 s loaded
    ...series(4, 61, 36, { loaded: () => false, from: 40 }),           // utilization drops, heat does not
    ...series(80, 61, 36, { from: 42 }),                               // 40 s loaded again
  ];
  ok('окно не перешагивает провал нагрузки', findPlateau(gapped, W).ok, false);

  // A run that ends before a window can be formed at all.
  const tooShort = series(60, 61, 36);                                 // 30 s
  const shortFound = findPlateau(tooShort, W);
  ok('окно короче требуемого — не плато', shortFound.ok, false);
  ok('короткий прогон говорит, сколько он длился', /весь прогон 30/.test(shortFound.why), true);
  ok('пустой ряд не роняет детектор', findPlateau([], W).ok, false);
  ok('ряд без нагрузки назван именно так', /не грузилась/.test(findPlateau(series(200, 42, 0, { loaded: () => false }), W).why), true);

  // DRIFT IS A RATE, so the SAME physical climb must yield the SAME number however densely it was
  // sampled. A gate whose verdict depends on the sampler's period is not measuring the card.
  const ramp = (spacing, spanS) => Array.from({ length: Math.floor(spanS / spacing) + 1 }, (_, k) => ({
    seconds: k * spacing, temperature: 61 + (2 * (k * spacing)) / 60, fan: 36, loaded: true,
  }));
  const dense = findPlateau(ramp(0.25, 64), W);
  const sparse = findPlateau(ramp(2, 64), W);
  const rate = (p) => Number((p.temperature?.driftPerMin ?? 0).toFixed(1));
  ok('один и тот же подъём, снятый ГУСТО и РЕДКО, даёт одну и ту же скорость', [rate(dense), rate(sparse)], [2, 2]);

  // AND THE BASELINE OF THAT RATE IS THE CENTROIDS OF THE HALVES, not the window's nominal half-length.
  // Here the samples cluster at the two ENDS of the window, so the halves are really 55 s apart while
  // the window is 60 s wide. The card is drifting a calm 0.8 °C/min and must be accepted; measured
  // against a nominal 30 s baseline the same data reads 1.5 °C/min and would be refused — a real
  // plateau thrown away because the sampler stuttered.
  const clustered = [
    ...Array.from({ length: 21 }, (_, k) => ({ seconds: k * 0.25, temperature: 61, fan: 36, loaded: true })),
    ...Array.from({ length: 21 }, (_, k) => ({ seconds: 55 + k * 0.25, temperature: 61.733, fan: 36, loaded: true })),
  ];
  const clusteredFound = findPlateau(clustered, W);
  ok('скорость считается между ЦЕНТРОИДАМИ половин, а не по номинальной половине окна', clusteredFound.ok, true);
  ok('и она равна тому, что заложено в ряд', rate(clusteredFound), 0.8);

  // A single window judged directly, so the numbers themselves are pinned rather than only the verdict.
  const w = judgeWindow(series(121, (k) => (k < 60 ? 61 : 63), 36), 0, 120);
  ok('ступенька в 2 °C посреди окна — это 4 °C/мин, а не «2»', Number(w.temperature.driftPerMin.toFixed(1)), 4);
  ok('и это отказ', w.ok, false);

  // ---------------------------------------------------------------------------------------------
  // Reading the mode off the table
  // ---------------------------------------------------------------------------------------------
  const settled = (mhz, fan, celsius) => ({ mhz, fan, celsius, plateau: { ok: true } });
  const table = [settled(2400, 52, 68), settled(2100, 40, 62), settled(1800, 33, 57), settled(1500, 30, 53)];
  const sc = readSilentCold(table);
  ok('Silent Cold — САМАЯ ВЫСОКАЯ ступень под потолком', sc.pick.mhz, 2100);
  ok('потолок берётся из config, а не из головы', sc.fanCeilingPct, config.SILENT_COLD_FAN_CEILING_PCT);
  ok('ответ зажат сверху измеренной ступенью — это сказано', sc.bounded, true);
  const unbounded = readSilentCold([settled(2100, 40, 62), settled(1800, 33, 57)]);
  ok('без ступени выше выбранной ответ помечен НИЖНЕЙ ОЦЕНКОЙ', unbounded.bounded, false);
  ok('и это названо словами', /НИЖНЯЯ ОЦЕНКА/.test(unbounded.why), true);
  const withUnsettled = readSilentCold([{ mhz: 2700, fan: 20, plateau: { ok: false } }, settled(2100, 40, 62)]);
  ok('ступень без плато в выбор не попадает', withUnsettled.pick.mhz, 2100);
  ok('и пропущенные ступени сосчитаны', withUnsettled.skipped, 1);
  const tooHot = readSilentCold([settled(2400, 52, 68), settled(2100, 47, 65)]);
  ok('ни одна ступень не уложилась — режим не выдумывается', tooHot.ok, false);
  ok('и сказано, куда продолжать лестницу', /ВНИЗ/.test(tooHot.why), true);
  ok('таблица без плато вообще — читать нечего', readSilentCold([{ mhz: 2400, fan: 30, plateau: { ok: false } }]).ok, false);

  return { ok: results.every((r) => r.ok), results };
}

// =================================================================================================
// 6. CLI
// =================================================================================================

function parseArgs(argv) {
  const o = { points: null, runs: 20, bounceRays: config.Q2RTX_BOUNCE_RAYS, prefix: 'thermal', selftest: false, dryRun: false, analyze: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') o.selftest = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--analyze') o.analyze = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : '';
    else if (a === '--points') o.points = String(argv[++i]).split(',').map((x) => Number(x.trim()));
    else if (a === '--runs') o.runs = Number(argv[++i]);
    else if (a === '--bounce-rays') o.bounceRays = Number(argv[++i]);
    else if (a === '--prefix') o.prefix = argv[++i];
    else throw new Error(`неизвестный флаг: ${a}`);
  }
  if (!o.selftest && o.analyze === null && (!o.points || !o.points.length || o.points.some((x) => !Number.isFinite(x)))) {
    throw new Error('нужен список ступеней: --points 2400,2100,1800');
  }
  return o;
}

const fmt = (n, d = 1) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(d));

/** Re-run the detector over captures already on disk — free, and the only honest way to calibrate it. */
function analyze(prefix) {
  if (!existsSync(GRAPHICS_DIR)) { console.error('ОШИБКА: runs/graphics пуст — анализировать нечего'); return 1; }
  const files = readdirSync(GRAPHICS_DIR).filter((f) => f.endsWith('.jsonl') && f.startsWith(prefix)).sort();
  if (!files.length) { console.error(`ОШИБКА: нет записей телеметрии с меткой «${prefix}*»`); return 1; }
  console.log(`ДЕТЕКТОР ПЛАТО ПО УЖЕ СНЯТЫМ ПРОГОНАМ: ${files.length} шт.`);
  console.log(`ТРЕБОВАНИЕ: ${config.PLATEAU_WINDOW_SECONDS} с, температура ±${config.PLATEAU_TEMP_DRIFT_C_PER_MIN} °C дрейфа `
    + `и ${config.PLATEAU_TEMP_RANGE_C} °C размаха · вентилятор ±${config.PLATEAU_FAN_DRIFT_PCT_PER_MIN} % и ${config.PLATEAU_FAN_RANGE_PCT} %`);
  console.log('');
  let settled = 0;
  for (const f of files) {
    const rows = readSamples(join(GRAPHICS_DIR, f)).filter((r) => r && r.i >= 0 && r.sample);
    const p = findPlateau(toPlateauPoints(rows));
    if (p.ok) settled++;
    console.log(`  ${f.replace(/\.jsonl$/, '').padEnd(30)} ${p.ok ? 'ПЛАТО ' : 'НЕТ   '} ${p.why}`);
  }
  console.log('');
  console.log(`ВЫШЛИ НА ПЛАТО: ${settled} из ${files.length}.`);
  return 0;
}

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`ОШИБКА: ${e.message}`); return 2; }

  if (o.selftest) {
    const r = selfTest();
    for (const x of r.results) {
      console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok ? '' : `  -> получено ${JSON.stringify(x.got)}, ждали ${JSON.stringify(x.want)}`}`);
    }
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА: есть расхождения.');
    return r.ok ? 0 : 1;
  }

  if (o.analyze !== null) return analyze(o.analyze);

  const game = locateGame();
  if (!game.ok) {
    console.error('ИГРЫ НЕТ НА МЕСТЕ — тепловая лестница грузится именно ею:');
    for (const p of game.problems) console.error(`  · ${p}`);
    return 1;
  }

  const card = probeCard();
  if (!card.ladder.ok) { console.error(`ОШИБКА: лестница частот недоступна — ${card.ladder.why}`); return 1; }
  const snapped = o.points.map((p) => snapToLadder(p, card.ladder.mhz));

  console.log(`КАРТА: драйвер ${card.driver} · VBIOS ${card.vbios} · потолок ${card.power.current} Вт`);
  console.log(`СТУПЕНИ: ${snapped.map((s) => (s.snapped ? `${s.from}→${s.mhz}` : `${s.mhz}`)).join(' · ')} МГц`);
  console.log(`НАГРУЗКА: Q2RTX, лучей ${o.bounceRays}, прогонов демо на ступень ${o.runs}`);
  console.log(`ПЛАТО: обе величины устойчивы ≥ ${config.PLATEAU_WINDOW_SECONDS} с `
    + `(температура ±${config.PLATEAU_TEMP_DRIFT_C_PER_MIN} °C дрейфа, ${config.PLATEAU_TEMP_RANGE_C} °C размаха · `
    + `вентилятор ±${config.PLATEAU_FAN_DRIFT_PCT_PER_MIN} %, ${config.PLATEAU_FAN_RANGE_PCT} %)`);
  console.log('ЗАПИСЬ В КАРТУ: только фиксация частоты (-lgc) на время замера. Ни кривой, ни напряжения, ни потолка мощности.');
  console.log('ОТКАТ, НАЗВАННЫЙ ДО ЗАПИСИ: resetToFactory() (-rgc + заводской потолок) в finally после КАЖДОЙ ступени,');
  console.log('       включая падение замера; провал отката обрывает всю лестницу. Сверху — внешний сторож.');
  console.log('       В любой момент вручную: npm run profile -- --reset');

  if (o.dryRun) { console.log(''); console.log('СУХОЙ ПРОГОН: в карту ничего не записано.'); return 0; }

  const stale = wd.readArmed();
  if (stale) {
    console.error('');
    console.error('СТОРОЖ УЖЕ ВЗВЕДЁН — предыдущий прогон мог умереть, держа карту. Сначала: npm run watchdog -- --recover');
    return 1;
  }

  mkdirSync(THERMAL_DIR, { recursive: true });
  const watchdog = wd.arm({ what: `ТЕПЛОВАЯ ЛЕСТНИЦА: ${snapped.map((s) => s.mhz).join(', ')} МГц под игрой`, ttlMs: WATCHDOG_TTL_MS });
  const beat = setInterval(() => watchdog.beat(), WATCHDOG_BEAT_MS);
  console.log(`СТОРОЖ ВЗВЕДЁН: срок ${WATCHDOG_TTL_MS / 1000} с, продление каждые ${WATCHDOG_BEAT_MS / 1000} с, страж pid ${watchdog.guardPid}`);
  console.log('');

  let out;
  try {
    out = await runLadder({
      points: snapped.map((s) => s.mhz),
      card,
      runs: o.runs,
      bounceRays: o.bounceRays,
      labelPrefix: o.prefix,
      onRow: (row) => {
        if (row.error) {
          console.log(`  ${String(row.mhz).padStart(4)} МГц — НЕ ЗАСЧИТАНА: ${row.error}`);
          return;
        }
        console.log(`  ${String(row.mhz).padStart(4)} МГц · выдано ${row.delivered} · РАВНОВЕСИЕ ${fmt(row.celsius, 0)} °C · `
          + `вентилятор ${fmt(row.fan, 0)} % · ${fmt(row.watts)} Вт · FPS ${fmt(row.fps, 2)} · `
          + `плато с ${fmt(row.plateau?.window?.fromSeconds, 0)} по ${fmt(row.plateau?.window?.toSeconds, 0)} с`);
      },
    });
  } finally {
    clearInterval(beat);
    watchdog.disarm();
  }

  const final = readState(nvidiaSmiBackend());
  console.log('');
  console.log(`КАРТА ПОСЛЕ ЛЕСТНИЦЫ: ${final.powerLimitW} Вт (заводской ${final.powerDefaultW}) · частота ${final.clockMhz} МГц`);

  if (out.aborted) {
    console.error(`ЛЕСТНИЦА ПРЕРВАНА на ${out.aborted.mhz} МГц — ${out.aborted.why}`);
    console.error('ВЕРНИТЕ КАРТУ ВРУЧНУЮ: npm run profile -- --reset');
    return 1;
  }

  const artifact = {
    stamp: stampNow(),
    gpu: { driver: card.driver, vbios: card.vbios },
    load: { game: 'q2rtx-timedemo', bounceRays: o.bounceRays, timedemoRuns: o.runs },
    gates: {
      windowSeconds: config.PLATEAU_WINDOW_SECONDS,
      tempRangeC: config.PLATEAU_TEMP_RANGE_C,
      tempDriftCPerMin: config.PLATEAU_TEMP_DRIFT_C_PER_MIN,
      fanRangePct: config.PLATEAU_FAN_RANGE_PCT,
      fanDriftPctPerMin: config.PLATEAU_FAN_DRIFT_PCT_PER_MIN,
    },
    rows: out.rows,
  };
  const file = join(THERMAL_DIR, `${o.prefix}_${snapped.map((s) => s.mhz).join('-')}.json`);
  writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  console.log('');
  console.log('ТАБЛИЦА «ПОТОЛОК ЧАСТОТЫ → РАВНОВЕСНАЯ ТЕМПЕРАТУРА → ОБОРОТЫ»');
  console.log('  МГц   выдано   °C   вент %    Вт      FPS');
  for (const r of out.rows) {
    if (r.error) { console.log(`  ${String(r.mhz).padStart(4)}   — ступень не засчитана`); continue; }
    console.log(`  ${String(r.mhz).padStart(4)}   ${String(r.delivered).padStart(4)}   ${String(fmt(r.celsius, 0)).padStart(3)}   `
      + `${String(fmt(r.fan, 0)).padStart(5)}   ${String(fmt(r.watts)).padStart(6)}   ${fmt(r.fps, 2)}`);
  }

  const sc = readSilentCold(out.rows);
  console.log('');
  if (sc.ok) {
    console.log(`❄️ SILENT COLD ЧИТАЕТСЯ ПРЯМО: ${sc.pick.mhz} МГц — вентилятор ${fmt(sc.pick.fan, 0)} % `
      + `при потолке ${sc.fanCeilingPct} %, температура ${fmt(sc.pick.celsius, 0)} °C, FPS ${fmt(sc.pick.fps, 2)}`);
    console.log(`   ${sc.why}`);
  } else {
    console.log(`❄️ SILENT COLD ПОКА НЕ ЧИТАЕТСЯ: ${sc.why}`);
  }
  console.log('');
  console.log(`ФАЙЛ: ${file}`);
  return out.rows.some((r) => r.error) ? 1 : 0;
}

// A module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
