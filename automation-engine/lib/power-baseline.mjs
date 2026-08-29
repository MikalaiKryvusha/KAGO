#!/usr/bin/env node
// power-baseline.mjs — the METER for phase 2's power reduction, and the meter's own honesty check.
//
// Plan anchor (plans/03_epic01_phase2_silent_cold.md §4.4): "Median power, temperature, fan speed and
// clock at stock under the sustained transient shape, into `runs/`, stamped like every other
// baseline … The background is part of the record … Verify: capture twice at stock and compare the
// medians — a spread wider than the effect we are hunting means the meter is not sharp enough yet."
//
// WHY THIS MODULE EXISTS AT ALL, stated where a future session will read it before touching the
// numbers: P2-AC7 does not ask for a power delta. It asks for a power delta REPORTED BESIDE THE
// METER'S OWN RUN-TO-RUN SPREAD. That is the owner's rule made executable (MASTER_PLAN.md → ведущие
// принципы, point 5): «потери нет» is a claim about a DIFFERENCE, and it is illegal to make while the
// instrument's own scatter is wider than the effect being denied. Zero percent measured by an
// instrument that scatters three percent is not a finding — it is a blunt instrument. So the capture
// and the spread live in ONE module: a project cannot ship the delta and forget the scatter if the
// same command produces both.
//
// THREE PROPERTIES IT IS BUILT AROUND:
//
//  1. THE SAMPLER RUNS IN ITS OWN PROCESS, and that is not a style choice. `runBurst` uses
//     `spawnSync`, which blocks Node's event loop for the whole burst — an in-process sampler records
//     ZERO samples during exactly the window we care about (observed 2026-08-10, plans/03 §4.3). So
//     `hardware-mon.mjs` is spawned as a CHILD, and this module waits for its header line to appear
//     on disk before starting the load: a started process is a guess, a written header is an
//     observation.
//
//  2. THE RUN IS SPLIT INTO ITS LOADED AND IDLE HALVES. Under the transient shape the card alternates
//     ~97 % and ~5 % utilization, so a whole-run median lands between two lobes and moves with sample
//     alignment rather than with the card. Both halves are reported with their SAMPLE COUNTS and their
//     own utilization medians, so a split that failed to split is visible in the output instead of
//     hiding inside one number (EXP-0012: the output shows what you built).
//
//  3. A SPREAD IS NEVER COMPUTED ACROSS DIFFERING CONDITIONS. Driver, VBIOS, workload, arguments and
//     shape must match across the compared records, or there is no comparison to make — the same rule
//     EXP-0011 paid for with a false SDC verdict on 58 of 58 runs. Backgrounds are handled one step
//     softer: named as a caveat rather than refused, because the client list drifts by a browser tab
//     and refusing on it would make the meter unusable (§2 row 4 asks for COMPARABLE backgrounds, not
//     identical ones).
//
// GPU WRITES: NONE. This module reads the card and runs compute on it; it sets nothing. The profile
// under which a capture was taken is a LABEL supplied by the caller — this module never applies one.
//
// Usage:
//   node automation-engine/lib/power-baseline.mjs --capture --workload branchy --seconds 30 --sustain 30 --label stock
//   node automation-engine/lib/power-baseline.mjs --capture --workload branchy --seconds 30 --sustain 5 --transient --repeat 5 --label stock_tr
//   node automation-engine/lib/power-baseline.mjs --spread stock            spread across runs/power/stock*.json
//   node automation-engine/lib/power-baseline.mjs --selftest                the logic, on injected data, no GPU
//
// [TESTED: 2026-08-10 · 28 selftest blocks green, seven mutations each reddening its own block, and
// eleven real captures on this card (two independent series of five plus a probe) whose numbers are
// quoted in plans/03 §4.4. Every function below carries its own marker.]

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import config from '../config.mjs';
import { runSmi } from './hardware-mon.mjs';
import { stressTest } from './stress-tester.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const MON = join(HERE, 'hardware-mon.mjs');
export const POWER_DIR = join(ROOT, 'runs', 'power');

/** How long we wait for the child sampler to write its header before calling the capture failed. */
const SAMPLER_START_TIMEOUT_MS = 10_000;
/** How long we wait for the child sampler to exit after the load has finished. */
const SAMPLER_EXIT_TIMEOUT_MS = 30_000;

// =================================================================================================
// 1. Statistics — the smallest set that answers "what did the card do, and how much does it wobble"
// =================================================================================================

/** Median of the finite numbers in `values`; null on an empty set — never 0, which would read as a
 *  measurement (PHILOSOPHY.md → an invented number is worse than a missing one).
 *  [TESTED: 2026-08-10 · selftest blocks 1-4; mutation-proved by returning 0 for an empty set, which
 *  reddened the block that owns that rule] */
export function median(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** Median · min · max · n for one column. Same shape for every field, so the record needs no
 *  per-field special cases and a new telemetry field is summarized without touching this code. */
function columnStats(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!xs.length) return { n: 0, median: null, min: null, max: null };
  return { n: xs.length, median: median(xs), min: Math.min(...xs), max: Math.max(...xs) };
}

/**
 * Summarize a run's samples into whole / loaded / idle thirds.
 *
 * The field list is DERIVED from the samples themselves rather than held here: a second list of
 * telemetry fields would be a mirror of `config.TELEMETRY_FIELDS` and would drift the day a field is
 * added (EXP-0013 — a pair you can delete beats a pair you must watch).
 *
 * [TESTED: 2026-08-10 · selftest blocks 5-10; mutation-proved twice - the split accepting every sample
 * as loaded, and an empty half reporting zeros instead of nulls]
 */
export function summarizeSamples(records, { loadPct = config.LOAD_PHASE_UTILIZATION_PCT } = {}) {
  const samples = records.filter((r) => r && r.i >= 0 && r.sample).map((r) => r.sample);
  const fields = [...new Set(samples.flatMap((s) => Object.keys(s)))]
    .filter((k) => samples.some((s) => Number.isFinite(s[k])))
    .sort();

  const loaded = samples.filter((s) => Number(s['utilization.gpu']) >= loadPct);
  const idle = samples.filter((s) => Number(s['utilization.gpu']) < loadPct);

  const statsOf = (set) => {
    const out = {};
    for (const f of fields) out[f] = columnStats(set.map((s) => s[f]));
    return out;
  };

  return {
    loadPct,
    counts: { total: samples.length, loaded: loaded.length, idle: idle.length },
    // THE STATE THE RUN STARTED FROM, and it is not bookkeeping — it is a CONDITION of the
    // measurement. Measured 2026-08-10 over eleven stock runs on this card: POWER TRACKS THE
    // TEMPERATURE THE RUN REACHES. Ten runs that settled at 62–63 °C drew 196.0…197.3 W; the one run
    // that reached 68 °C drew 201.2 W. Five degrees is worth ~4 W — THREE TIMES the 1.28 W scatter of
    // those same ten runs, so a comparison across thermal levels manufactures a delta bigger than most
    // effects this phase is hunting.
    //
    // WHAT THESE TWO FIELDS DO NOT CLAIM, stated because the first draft of this comment claimed it
    // and the data refuted it within the hour: the starting FAN speed does not predict the outcome on
    // its own. One run started with the fan at 0 and still settled in the 63 °C group. Both numbers are
    // recorded because they are conditions worth seeing, not because either is the cause; the
    // temperature actually REACHED is what the medians must be compared at.
    startTemperature: samples.length ? (Number(samples[0]['temperature.gpu']) || null) : null,
    startFanSpeed: samples.length && Number.isFinite(Number(samples[0]['fan.speed']))
      ? Number(samples[0]['fan.speed']) : null,
    all: statsOf(samples),
    loaded: statsOf(loaded),
    idle: statsOf(idle),
  };
}

// =================================================================================================
// 2. The background — who else is holding the card
// =================================================================================================

/**
 * The GPU client list at capture time, as sorted `{name, count}` pairs.
 *
 * `--query-compute-apps` is the vendor's own instrument and on this Windows machine it lists the
 * GRAPHICS clients too (probed 2026-08-10: 21 clients including `dwm.exe`, Chrome, Parsec, VS Code).
 * Full paths are reduced to base names because the path is noise for a comparison and the name is the
 * thing a human recognizes; the COUNT is kept because "two Chrome processes" and "seven" are
 * different backgrounds.
 *
 * [TESTED: 2026-08-10 · parsing by selftest, mutation-proved by dropping the count; and by observation
 * on this machine - 25 clients listed at capture, dwm.exe among them]
 */
export function gpuClients({ smi = 'nvidia-smi' } = {}) {
  let out;
  try {
    out = runSmi(['--query-compute-apps=process_name', '--format=csv,noheader'], { smi });
  } catch (e) {
    return { error: e.message, clients: [], count: 0 };
  }
  return parseClients(out);
}

/** Split out so the parsing is provable without a GPU. */
export function parseClients(text) {
  const names = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/[\\/]/).pop().trim())
    .filter((n) => n && n !== 'process_name');
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  const clients = [...counts.entries()].map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { clients, count: names.length };
}

/** The symmetric difference of two client lists, by name — the caveat line of a comparison. */
export function backgroundDiff(a, b) {
  const na = new Set((a && a.clients ? a.clients : []).map((c) => c.name));
  const nb = new Set((b && b.clients ? b.clients : []).map((c) => c.name));
  return {
    onlyInA: [...na].filter((n) => !nb.has(n)).sort(),
    onlyInB: [...nb].filter((n) => !na.has(n)).sort(),
  };
}

// =================================================================================================
// 3. The capture — sampler in its own process, load in ours
// =================================================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A machine receipt carries the owner's local time with its offset, never UTC (AGENT_GUIDE.md →
 *  "A stamp carries the DATE AND THE TIME"; the defect EXP-0012 caught was a receipt dated the
 *  previous day). Same convention as stress-tester's `stampNow`, deliberately not imported across
 *  modules for five lines. */
function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

/** Wait until the child sampler has actually written its header line. A spawned process is a guess;
 *  a line on disk is an observation, and a load started before the sampler is a run measured half. */
async function waitForSampler(jsonlPath, timeoutMs = SAMPLER_START_TIMEOUT_MS) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (existsSync(jsonlPath)) {
      const text = readFileSync(jsonlPath, 'utf8');
      if (text.includes('\n')) return true;
    }
    await sleep(100);
  }
  return false;
}

export function readSamples(jsonlPath) {
  const lines = readFileSync(jsonlPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const records = [];
  for (const l of lines) {
    try { records.push(JSON.parse(l)); } catch { /* a truncated last line means the sampler was cut */ }
  }
  return records;
}

/**
 * One capture: start the sampler, run the load, summarize, write the record.
 *
 * The VERDICT rides along on purpose. A power number taken during a run that produced SDC is not a
 * baseline — it is a measurement of a broken card, and separating the two commands would let a future
 * session quote the watts without ever looking at the verdict.
 *
 * [TESTED: 2026-08-10 · eleven real captures on this card, every one PASS with the checksum matching
 * the golden; 64 samples per 30 s run, 60-61 of them loaded, which is the 2 s pad behaving as designed]
 */
export async function capture({
  workload,
  seconds = 30,
  sustain = 0,
  transient = false,
  lowload = false,
  args = [],
  label = 'run',
  profile = null,
  dir = POWER_DIR,
} = {}) {
  if (!workload) throw new Error('нужна нагрузка: --workload <имя>');
  mkdirSync(dir, { recursive: true });

  const jsonl = join(dir, `${label}.jsonl`);
  const shape = transient ? 'transient' : lowload ? 'lowload' : sustain > 0 ? 'sustained' : 'steady';

  const backgroundBefore = gpuClients();

  const samplerSeconds = seconds + config.BASELINE_SAMPLER_PAD_SECONDS;
  const child = spawn(process.execPath, [MON, '--seconds', String(samplerSeconds), '--out', jsonl],
    { windowsHide: true, stdio: 'ignore' });
  const childExit = new Promise((res) => child.on('close', (code) => res(code)));

  if (!await waitForSampler(jsonl)) {
    child.kill();
    throw new Error(`сэмплер не записал ни строки за ${SAMPLER_START_TIMEOUT_MS} мс — замер без телеметрии не замер`);
  }

  let run;
  try {
    run = await stressTest({ name: workload, seconds, transient, lowload, sustain, args });
  } finally {
    // The sampler outlives the load by design; give it its remaining seconds rather than cutting it.
    const exited = await Promise.race([childExit, sleep(SAMPLER_EXIT_TIMEOUT_MS).then(() => 'timeout')]);
    if (exited === 'timeout') child.kill();
  }

  const records = readSamples(jsonl);
  const stats = summarizeSamples(records);
  if (stats.counts.total === 0) throw new Error('сэмплер не оставил ни одной пробы — замер не состоялся');

  const backgroundAfter = gpuClients();

  const record = {
    label,
    captured_at: stampNow(),
    // The stamp: everything the medians depend on. A spread computed across two records whose stamps
    // differ is not a spread (EXP-0011), and `compareRecords` below refuses exactly on these fields.
    shape,
    workload,
    args: args.map(String),
    seconds,
    sustain,
    profile,                       // the profile the card was under; null = as the card was found
    gpu: { name: run.card.name, driver: run.card.driver, vbios: run.card.vbios },
    verdict: run.verdict ?? null,
    reason: run.reason,
    meters: run.meters,
    background: { before: backgroundBefore, after: backgroundAfter },
    samples: stats.counts,
    startTemperature: stats.startTemperature,
    startFanSpeed: stats.startFanSpeed,
    medians: {
      all: stats.all,
      loaded: stats.loaded,
      idle: stats.idle,
      loadPct: stats.loadPct,
    },
    sampleFile: `${label}.jsonl`,
  };
  writeFileSync(join(dir, `${label}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

// =================================================================================================
// 4. The spread — the number without which no delta may be called an effect
// =================================================================================================

/** The stamp fields that must agree before two records may be compared at all. */
export const COMPARABLE_FIELDS = Object.freeze(['workload', 'shape', 'seconds', 'sustain', 'profile']);

/**
 * Refuse to compare records taken under different conditions, and NAME the field that differs.
 *
 * This is EXP-0011's lesson applied to the second instrument: a comparison across differing
 * conditions has no verdict — not a negative one. `args` is compared as a joined string, and the
 * driver/VBIOS pair is checked because R6 invalidates every measurement across a driver update.
 *
 * [TESTED: 2026-08-10 · selftest blocks 12-19; mutation-proved twice - dropping the condition-field
 * comparison and dropping the R6 driver check each reddened their own block]
 */
export function comparability(records) {
  const problems = [];
  if (records.length < 2) problems.push(`разброс требует минимум двух замеров, дано ${records.length}`);
  const first = records[0];
  if (first) {
    for (const f of COMPARABLE_FIELDS) {
      const bad = records.filter((r) => String(r[f] ?? '') !== String(first[f] ?? ''));
      if (bad.length) problems.push(`поле «${f}» расходится: ${[...new Set(records.map((r) => String(r[f] ?? '—')))].join(' / ')}`);
    }
    const argsOf = (r) => (r.args || []).join(' ');
    if (records.some((r) => argsOf(r) !== argsOf(first))) problems.push('аргументы нагрузки расходятся между замерами');
    for (const key of ['driver', 'vbios']) {
      const vals = [...new Set(records.map((r) => (r.gpu || {})[key] ?? '—'))];
      if (vals.length > 1) problems.push(`${key} расходится между замерами (${vals.join(' / ')}) — правило R6: сравнивать нечего`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * The spread of one column across repeats: the median of the medians, the extremes, and the width —
 * absolute and as a fraction of the median. The width is the honest floor under any delta this meter
 * is later asked to report.
 *
 * TWO SOURCES, one function. `from: 'medians'` reads the telemetry the card reported; `from:
 * 'meters'` reads the workload's OWN counters — `opsPerSecond` above all, which is the owner's
 * «цена» in «снижаем потребление, пока цена ≤ N». The price needs its scatter measured exactly as
 * much as the watts do: a price budget compared against a number whose own wobble is wider than the
 * budget would decide nothing. Splitting this into two functions would have let one of them ship
 * without the other.
 *
 * [TESTED: 2026-08-10 · selftest blocks 20-27; mutation-proved by accepting a single measurement as a
 * spread. Exercised for real on two five-run series and on the pooled ten]
 */
export function spreadOf(records, field, { half = 'loaded', from = 'medians' } = {}) {
  const values = records
    .map((r) => (from === 'meters'
      ? ((r.meters || {})[field])
      : (((r.medians || {})[half] || {})[field] || {}).median))
    .filter((v) => Number.isFinite(v));
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mid = median(values);
  return {
    n: values.length,
    values,
    median: mid,
    min,
    max,
    spread: max - min,
    spreadFraction: mid ? (max - min) / mid : null,
  };
}

/** Load every record whose label starts with `prefix`. */
export function loadRecords(prefix, { dir = POWER_DIR } = {}) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f.startsWith(prefix))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

/** The fields a spread report leads with — the ones P2-AC7 and the owner's «цена» are written in. */
export const HEADLINE_FIELDS = Object.freeze([
  'power.draw.instant', 'temperature.gpu', 'fan.speed', 'clocks.gr', 'utilization.gpu',
]);

// =================================================================================================
// 5. Selftest — the logic on injected data, no GPU
// =================================================================================================

/** Build a fake sample record set: `n` samples at the given utilization/power. */
function fakeRun({ n = 10, util = 97, watts = 194, temp = 60, from = 0 } = {}) {
  const out = [{ i: -1, meta: {} }];
  for (let i = 0; i < n; i++) {
    out.push({
      i: from + i,
      t: 'x',
      sample: {
        'utilization.gpu': util,
        'power.draw.instant': watts + i,
        'temperature.gpu': temp,
        'clocks.gr': 2887,
        'clocks_event_reasons.names': [],
      },
    });
  }
  return out;
}

function fakeRecord({ label = 'a', workload = 'branchy', shape = 'sustained', seconds = 30, sustain = 30,
  profile = null, driver = '610.88', vbios = 'v1', args = [], watts = 190, ops = null } = {}) {
  return {
    label, workload, shape, seconds, sustain, profile, args,
    gpu: { driver, vbios },
    meters: ops === null ? null : { opsPerSecond: ops, dutyFactor: 0.985 },
    medians: { loaded: { 'power.draw.instant': { median: watts, n: 10, min: watts, max: watts } } },
  };
}

export function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  // --- the statistics
  ok('медиана нечётного набора', median([3, 1, 2]), 2);
  ok('медиана чётного набора — среднее двух средних', median([1, 2, 3, 4]), 2.5);
  ok('медиана пустого набора — null, а не ноль', median([]), null);
  ok('нечисловые значения не попадают в медиану', median([1, null, 'N/A', 3]), 2);

  // --- the loaded/idle split
  const mixed = [...fakeRun({ n: 6, util: 97, watts: 190 }), ...fakeRun({ n: 4, util: 5, watts: 30, from: 100 }).slice(1)];
  const s = summarizeSamples(mixed, { loadPct: 50 });
  ok('деление на половины: счётчики обеих половин', s.counts, { total: 10, loaded: 6, idle: 4 });
  ok('медиана нагруженной половины не смешана с простоем', s.loaded['power.draw.instant'].median, 192.5);
  ok('медиана простоя не смешана с нагрузкой', s.idle['power.draw.instant'].median, 31.5);
  const allIdle = summarizeSamples(fakeRun({ n: 5, util: 3, watts: 25 }), { loadPct: 50 });
  ok('прогон без нагрузки: медиана нагруженной половины — null, а не ноль', allIdle.loaded['power.draw.instant'].median, null);
  ok('температура первой пробы записана отдельно', allIdle.startTemperature, 60);
  const withFan = summarizeSamples([{ i: 0, sample: { 'utilization.gpu': 97, 'fan.speed': 0, 'temperature.gpu': 53 } }]);
  ok('вентилятор на старте записан, и ноль — это ноль, а не «нет данных»', withFan.startFanSpeed, 0);

  // --- the background
  const clients = parseClients('C:\\Windows\\System32\\dwm.exe\nC:\\x\\chrome.exe\nC:\\y\\chrome.exe\n');
  ok('клиенты GPU: имена без путей, с количеством, по алфавиту',
    clients, { clients: [{ name: 'chrome.exe', count: 2 }, { name: 'dwm.exe', count: 1 }], count: 3 });
  ok('разница фонов называет обе стороны',
    backgroundDiff({ clients: [{ name: 'a.exe' }, { name: 'b.exe' }] }, { clients: [{ name: 'b.exe' }, { name: 'c.exe' }] }),
    { onlyInA: ['a.exe'], onlyInB: ['c.exe'] });

  // --- comparability: the EXP-0011 rule on the second instrument
  ok('один замер — это ещё не разброс', comparability([fakeRecord({})]).ok, false);
  ok('одинаковые условия — сравнение состоялось', comparability([fakeRecord({ label: 'a' }), fakeRecord({ label: 'b' })]).ok, true);
  ok('разные нагрузки — отказ, а не число',
    comparability([fakeRecord({}), fakeRecord({ workload: 'sdc_fma' })]).ok, false);
  ok('разные формы — отказ', comparability([fakeRecord({}), fakeRecord({ shape: 'transient' })]).ok, false);
  ok('разные профили — отказ (сток и профиль не смешиваются в разбросе)',
    comparability([fakeRecord({}), fakeRecord({ profile: 'silent_cold' })]).ok, false);
  const drv = comparability([fakeRecord({}), fakeRecord({ driver: '611.00' })]);
  ok('другой драйвер — отказ по правилу R6', drv.ok, false);
  ok('отказ по драйверу называет правило', /R6/.test(drv.problems.join(' ')), true);
  ok('разные аргументы — отказ', comparability([fakeRecord({}), fakeRecord({ args: ['4000000'] })]).ok, false);

  // --- the spread itself
  const three = [fakeRecord({ label: 'a', watts: 190 }), fakeRecord({ label: 'b', watts: 194 }), fakeRecord({ label: 'c', watts: 192 })];
  const sp = spreadOf(three, 'power.draw.instant');
  ok('разброс: ширина — это max минус min', sp.spread, 4);
  ok('разброс: середина — медиана медиан', sp.median, 192);
  ok('разброс: доля от медианы', Number(sp.spreadFraction.toFixed(6)), Number((4 / 192).toFixed(6)));
  ok('разброс по одному замеру — null, а не ноль', spreadOf([three[0]], 'power.draw.instant'), null);
  ok('разброс по полю, которого нет — null', spreadOf(three, 'clocks.sm'), null);

  // The price has its own scatter, and it is read from the workload's counters, not from telemetry.
  const priced = [fakeRecord({ label: 'a', ops: 5.119e10 }), fakeRecord({ label: 'b', ops: 5.114e10 }),
    fakeRecord({ label: 'c', ops: 5.116e10 })];
  const sp2 = spreadOf(priced, 'opsPerSecond', { from: 'meters' });
  ok('разброс цены берётся из счётчиков нагрузки, а не из телеметрии', sp2.n, 3);
  ok('разброс цены: ширина', Number(sp2.spread.toExponential(3)), Number((5.0e7).toExponential(3)));
  ok('замер без счётчиков не даёт нулевую цену — он выпадает из разброса',
    spreadOf([...priced, fakeRecord({ label: 'd', ops: null })], 'opsPerSecond', { from: 'meters' }).n, 3);

  return { ok: results.every((r) => r.ok), results };
}

// =================================================================================================
// 6. CLI
// =================================================================================================

function parseArgs(argv) {
  const o = {
    capture: false, selftest: false, spread: null, workload: null, seconds: 30, sustain: 0,
    transient: false, lowload: false, args: [], label: null, repeat: 1, profile: null, half: 'loaded',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--capture') o.capture = true;
    else if (a === '--selftest') o.selftest = true;
    else if (a === '--spread') o.spread = argv[++i];
    else if (a === '--workload') o.workload = argv[++i];
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--sustain') o.sustain = Number(argv[++i]);
    else if (a === '--transient') o.transient = true;
    else if (a === '--lowload') o.lowload = true;
    else if (a === '--arg') o.args.push(argv[++i]);
    else if (a === '--label') o.label = argv[++i];
    else if (a === '--repeat') o.repeat = Number(argv[++i]);
    else if (a === '--profile') o.profile = argv[++i];
    else if (a === '--half') o.half = argv[++i];
    else throw new Error(`неизвестный флаг: ${a}`);
  }
  if (o.capture && !o.workload) throw new Error('--capture требует --workload <имя>');
  if (o.capture && !o.label) throw new Error('--capture требует --label <метка> — замер без имени нельзя сравнить');
  if (!['loaded', 'idle', 'all'].includes(o.half)) throw new Error('--half принимает loaded | idle | all');
  return o;
}

/** One line per field, in the units the field is named in — the table a human actually reads. */
function printMedians(stats, half) {
  const set = stats[half] || {};
  const row = (f, unit, digits = 1) => {
    const c = set[f];
    if (!c || c.median === null) return `  ${f}: —`;
    return `  ${f.padEnd(24)} ${c.median.toFixed(digits).padStart(8)} ${unit.padEnd(5)} (мин ${c.min} · макс ${c.max} · проб ${c.n})`;
  };
  console.log(row('power.draw.instant', 'Вт'));
  console.log(row('temperature.gpu', '°C', 0));
  console.log(row('fan.speed', '%', 0));
  console.log(row('clocks.gr', 'МГц', 0));
  console.log(row('utilization.gpu', '%', 0));
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

  if (o.capture) {
    for (let k = 1; k <= o.repeat; k++) {
      const label = o.repeat > 1 ? `${o.label}_${String(k).padStart(2, '0')}` : o.label;
      console.log('');
      console.log(`ЗАМЕР ${k}/${o.repeat}: ${label} · нагрузка ${o.workload} · ${o.seconds} с · `
        + `форма ${o.transient ? 'переходная' : o.lowload ? 'низкая' : o.sustain > 0 ? `устойчивая ${o.sustain} с` : 'ровная'}`
        + `${o.profile ? ` · профиль ${o.profile}` : ' · сток'}`);
      let rec;
      try {
        rec = await capture({
          workload: o.workload, seconds: o.seconds, sustain: o.sustain, transient: o.transient,
          lowload: o.lowload, args: o.args, label, profile: o.profile,
        });
      } catch (e) { console.error(`ОШИБКА: ${e.message}`); return 1; }

      console.log(`  ВЕРДИКТ: ${rec.verdict ?? 'НЕИЗВЕСТНО'} — ${rec.reason}`);
      console.log(`  ПРОБЫ:   всего ${rec.samples.total} · под нагрузкой ${rec.samples.loaded} · в простое ${rec.samples.idle}`
        + ` (граница ${rec.medians.loadPct} % загрузки)`);
      console.log(`  ФОН:     клиентов GPU ${rec.background.before.count}`);
      console.log('  МЕДИАНЫ ПОД НАГРУЗКОЙ:');
      printMedians(rec.medians, 'loaded');
      if (rec.samples.idle > 0) {
        console.log('  МЕДИАНЫ В ПРОСТОЕ:');
        printMedians(rec.medians, 'idle');
      }
      if (rec.meters) {
        console.log(`  ЦЕНА:    ${rec.meters.opsPerSecond.toExponential(3)} операций/с · доля времени на GPU ${(100 * rec.meters.dutyFactor).toFixed(1)} %`);
      }
      console.log(`  ФАЙЛ:    runs/power/${label}.json`);
    }
    return 0;
  }

  if (o.spread) {
    const records = loadRecords(o.spread);
    if (!records.length) { console.error(`ОШИБКА: в runs/power нет замеров с меткой «${o.spread}*»`); return 1; }
    console.log(`ЗАМЕРОВ: ${records.length} — ${records.map((r) => r.label).join(', ')}`);

    const c = comparability(records);
    if (!c.ok) {
      console.error('СРАВНИВАТЬ НЕЛЬЗЯ:');
      for (const p of c.problems) console.error(`  · ${p}`);
      return 1;
    }
    console.log(`УСЛОВИЯ:  нагрузка ${records[0].workload} · форма ${records[0].shape} · ${records[0].seconds} с · `
      + `${records[0].profile ? `профиль ${records[0].profile}` : 'сток'} · драйвер ${records[0].gpu.driver}`);

    const verdicts = [...new Set(records.map((r) => r.verdict ?? 'НЕИЗВЕСТНО'))];
    console.log(`ВЕРДИКТЫ: ${verdicts.join(', ')}`);
    // The start state, printed because it is a CONDITION and not bookkeeping: a run begun with the
    // fan stopped drew 4 W more than the same run begun with the fan spinning — six times this
    // meter's own spread (measured 2026-08-10, see summarizeSamples).
    console.log(`НА СТАРТЕ: температура ${records.map((r) => r.startTemperature ?? '—').join(' → ')} °C · `
      + `вентилятор ${records.map((r) => (r.startFanSpeed ?? '—')).join(' → ')} %`);

    // The background caveat: named, never silently averaged over (§2 row 4 asks for comparable
    // backgrounds, and "comparable" is a judgement a human makes from a named difference).
    const base = records[0].background.before;
    for (const r of records.slice(1)) {
      const d = backgroundDiff(base, r.background.before);
      if (d.onlyInA.length || d.onlyInB.length) {
        console.log(`ФОН РАЗЛИЧАЕТСЯ (${records[0].label} ↔ ${r.label}): `
          + `только в первом [${d.onlyInA.join(', ') || '—'}] · только во втором [${d.onlyInB.join(', ') || '—'}]`);
      }
    }

    console.log('');
    console.log(`РАЗБРОС ПРИБОРА (половина: ${o.half})`);
    let wattSpread = null;
    for (const f of HEADLINE_FIELDS) {
      const sp = spreadOf(records, f, { half: o.half });
      if (!sp) { console.log(`  ${f.padEnd(24)} —`); continue; }
      if (f === 'power.draw.instant') wattSpread = sp;
      console.log(`  ${f.padEnd(24)} медиана ${sp.median.toFixed(1).padStart(8)} · разброс ${sp.spread.toFixed(2).padStart(7)}`
        + ` = ${(100 * sp.spreadFraction).toFixed(2).padStart(5)} % · значения [${sp.values.map((v) => v.toFixed(1)).join(', ')}]`);
    }
    // THE PRICE'S OWN SCATTER. The owner's formula is «снижаем потребление, пока цена ≤ N», so the
    // price is a measured quantity with a wobble of its own — and a budget compared against a number
    // whose scatter is wider than the budget decides nothing.
    const priceSpread = spreadOf(records, 'opsPerSecond', { from: 'meters' });
    const dutySpread = spreadOf(records, 'dutyFactor', { from: 'meters' });
    if (priceSpread) {
      console.log('');
      console.log('РАЗБРОС ЦЕНЫ (счётчики самой нагрузки)');
      console.log(`  операций/с${' '.repeat(15)}медиана ${priceSpread.median.toExponential(4)} · `
        + `разброс ${priceSpread.spread.toExponential(2)} = ${(100 * priceSpread.spreadFraction).toFixed(2)} %`);
      if (dutySpread) {
        console.log(`  доля времени на GPU${' '.repeat(6)}медиана ${(100 * dutySpread.median).toFixed(1)} % · `
          + `разброс ${(100 * dutySpread.spread).toFixed(2)} п.п.`);
      }
    }

    if (wattSpread) {
      console.log('');
      console.log(`ПРАВИЛО: дельта тоньше ${wattSpread.spread.toFixed(2)} Вт (${(100 * wattSpread.spreadFraction).toFixed(2)} %) `
        + 'НЕ является эффектом — это разброс самого прибора.');
      if (priceSpread) {
        console.log(`         Цена тоньше ${(100 * priceSpread.spreadFraction).toFixed(2)} % — тоже не эффект.`);
      }
    }
    return 0;
  }

  console.error('ОШИБКА: нужен один из режимов — --capture, --spread <метка> или --selftest');
  return 2;
}

// T9 — a module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
