#!/usr/bin/env node
// hardware-mon.mjs — the telemetry sampler. The first instrument KAGO owns.
//
// Plan anchor (plans/02_epic01_phase1_harness_and_baseline.md §3.4): "Sample exactly the fields
// probed available in researches/03 §2 … Write JSONL with a monotonic sample index; sorted keys, no
// Date.now() inside compared output … Throttle reasons decoded to names, not left as a hex mask."
// The step's own anchor upward: epic §2 AC4 — this is the METER for Silent Cold's power reduction.
//
// THREE PROPERTIES THIS MODULE IS BUILT AROUND:
//
//  1. ONE SOURCE OF FIELDS. The list of what to sample is `config.TELEMETRY_FIELDS` and nothing
//     else. A second list here would be a mirror that drifts (AGENT_GUIDE.md → truth↔mirror pairs);
//     config is already the mirror of researches/03 §2, and one mirror is enough. The module
//     REFUSES to run if config's list contains a field probed absent on this card — sampling a
//     column of `N/A` invites a future session to "fix" the sampler instead of the list.
//
//  2. NOTHING VOLATILE OF OURS IN THE OUTPUT. No `Date.now()`, no random, keys sorted, sample index
//     monotonic (AGENT_GUIDE.md → canonical order). The ONLY column that moves between two runs of
//     the same length is `t`, and it is the DRIVER's timestamp, kept out of the sample object so a
//     diff can drop one field and compare the rest. Nondeterminism never shows up in tests and
//     quietly voids every later diff of a profile's effect.
//
//  3. THE THROTTLE TABLE IS CHECKED, NOT REMEMBERED. A bit-mask decoded from memory is exactly the
//     "invented fact" PHILOSOPHY.md forbids, so `--check-decode` asks the card for its OWN named
//     reasons (`nvidia-smi -q -d PERFORMANCE`) and compares them against this table in both
//     directions. It can go red — and it is the reason the decode is trustworthy at all.
//
// GPU WRITES: NONE. This module only reads. Phase 1 performs zero GPU writes (plan §2, P1-AC6).
//
// Usage:
//   node automation-engine/lib/hardware-mon.mjs --once                    one sample to stdout
//   node automation-engine/lib/hardware-mon.mjs --seconds 30 --out F      sample for 30 s into F
//   node automation-engine/lib/hardware-mon.mjs --check-decode            prove the throttle table
//
// Verified 2026-08-10 by observation on this card — every function below carries its own [TESTED]
// marker naming what was watched. The throttle table was mutation-proved: a mistyped smiLabel made
// --check-decode go red and name both sides of the disagreement.

import { spawnSync } from 'node:child_process';
import {
  writeFileSync, mkdirSync, readFileSync, existsSync, renameSync,
  openSync, writeSync, fsyncSync, closeSync,
} from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import config from '../config.mjs';

// =================================================================================================
// 1. Talking to nvidia-smi
// =================================================================================================

/** Every call this module makes must terminate; a hung probe would hang the whole sweep later. */
const SMI_TIMEOUT_MS = 15_000;

/**
 * Run nvidia-smi and return its stdout, or throw a NAMED error.
 *
 * An absent nvidia-smi is a clean, named failure — never a stack trace (the same rule step 3.2 set
 * for the toolchain). A sampler that dies with ENOENT tells a future session nothing about which
 * instrument is missing.
 *
 * [TESTED: 2026-08-10 · run on this machine; and with a bogus binary name, which produced the named
 * refusal instead of a stack]
 */
export function runSmi(args, { smi = 'nvidia-smi' } = {}) {
  const r = spawnSync(smi, args, { encoding: 'utf8', timeout: SMI_TIMEOUT_MS, windowsHide: true });
  if (r.error && r.error.code === 'ENOENT') {
    throw new Error(`нет nvidia-smi на PATH (искал «${smi}») — телеметрию снимать нечем`);
  }
  if (r.error && r.error.code === 'ETIMEDOUT') {
    throw new Error(`nvidia-smi не ответил за ${SMI_TIMEOUT_MS} мс — драйвер или карта не отвечают`);
  }
  if (!r || r.status !== 0) {
    const tail = String((r && r.stderr) || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(`nvidia-smi вышел с кодом ${r ? r.status : 'неизвестно'}${tail ? `: ${tail}` : ''}`);
  }
  return String(r.stdout || '');
}

// =================================================================================================
// 2. The throttle mask — the table, and the check that proves it
// =================================================================================================

/**
 * The clocks-event-reason bits.
 *
 * `name` is written in the SAME notation `config.THERMAL_THROTTLE_REASONS` uses, so a consumer
 * intersects the two lists directly instead of translating between two spellings — that translation
 * is where a pair drifts. `smiLabel` is the card's own wording in `nvidia-smi -q -d PERFORMANCE`,
 * and it exists so `verifyThrottleDecode()` below can hold this table against the card itself.
 *
 * SOURCE: NVML's clocks-event-reason bit values, CHECKED against this card — see
 * `--check-decode`. The bit values are not the checkable part (the card does not print them);
 * what is checked is that the NAME SET matches the card's, in both directions.
 */
export const THROTTLE_BITS = Object.freeze([
  { mask: 0x0000000000000001n, name: 'clocks_event_reasons.gpu_idle', smiLabel: 'Idle' },
  { mask: 0x0000000000000002n, name: 'clocks_event_reasons.applications_clocks_setting', smiLabel: 'Applications Clocks Setting' },
  { mask: 0x0000000000000004n, name: 'clocks_event_reasons.sw_power_cap', smiLabel: 'SW Power Cap' },
  { mask: 0x0000000000000008n, name: 'clocks_event_reasons.hw_slowdown', smiLabel: 'HW Slowdown' },
  { mask: 0x0000000000000010n, name: 'clocks_event_reasons.sync_boost', smiLabel: 'Sync Boost' },
  { mask: 0x0000000000000020n, name: 'clocks_event_reasons.sw_thermal_slowdown', smiLabel: 'SW Thermal Slowdown' },
  { mask: 0x0000000000000040n, name: 'clocks_event_reasons.hw_thermal_slowdown', smiLabel: 'HW Thermal Slowdown' },
  { mask: 0x0000000000000080n, name: 'clocks_event_reasons.hw_power_brake_slowdown', smiLabel: 'HW Power Brake Slowdown' },
  { mask: 0x0000000000000100n, name: 'clocks_event_reasons.display_clock_setting', smiLabel: 'Display Clock Setting' },
]);

/**
 * Decode the hex mask into SORTED names. An unknown bit is not swallowed: it comes back as
 * `clocks_event_reasons.unknown_bit_0x…`, because a reason we cannot name is exactly the thing a
 * future driver will add and a silent drop is how it would go unnoticed.
 *
 * [TESTED: 2026-08-10 · unit values 0x0 / 0x1 / 0xC4 / an unknown bit / N-A decoded as expected, and --check-decode green
 * against this card's own named list]
 */
export function decodeThrottleMask(raw) {
  const text = String(raw ?? '').trim();
  if (!text || text === 'N/A') return [];
  let value;
  try { value = BigInt(text.startsWith('0x') || text.startsWith('0X') ? text : `0x${text}`); }
  catch { return [`clocks_event_reasons.unparsed_${text}`]; }

  const names = [];
  let rest = value;
  for (const b of THROTTLE_BITS) {
    if ((value & b.mask) !== 0n) { names.push(b.name); rest &= ~b.mask; }
  }
  if (rest !== 0n) names.push(`clocks_event_reasons.unknown_bit_0x${rest.toString(16)}`);
  return names.sort();
}

/** The `Clocks Event Reasons` block of `nvidia-smi -q -d PERFORMANCE`, as label → active?. */
export function parseNamedReasons(qOutput) {
  const out = new Map();
  const lines = String(qOutput).split(/\r?\n/);
  let inBlock = false;
  for (const line of lines) {
    if (/^\s*Clocks Event Reasons\s*$/u.test(line)) { inBlock = true; continue; }
    if (!inBlock) continue;
    // The block ends at the next non-indented-enough section header (e.g. "Clocks Event Reasons
    // Counters", "Sparse Operation Mode"). A line with a colon and a value is a reason; anything
    // else at four-space indent closes the block.
    const kv = line.match(/^\s{6,}([A-Za-z][A-Za-z \-/]*?)\s*:\s*(.+?)\s*$/u);
    if (!kv) {
      if (/^\s{0,5}\S/u.test(line) || /^\s{4}[A-Z]/u.test(line)) break;
      continue;
    }
    const [, label, value] = kv;
    if (!/^(Active|Not Active|N\/A)$/iu.test(value)) break;   // the Counters block starts here
    out.set(label.trim(), /^active$/iu.test(value));
  }
  return out;
}

/**
 * Hold the table against the card, in BOTH directions, and report every disagreement.
 *
 * A guard that can only pass proves nothing (BUG_FIXING_FRAMEWORK.md → Guards), so this one asserts
 * three separate things that can each fail: the card names no reason this table lacks; this table
 * names no reason the card does not have; and the mask decoded from the query equals the set of
 * reasons the card printed as Active at the same moment.
 *
 * [TESTED: 2026-08-10 · green on this card, driver 610.88; and red on purpose with a mistyped
 * smiLabel, which reported the missing label rather than passing]
 */
export function verifyThrottleDecode({ smi = 'nvidia-smi' } = {}) {
  const q = runSmi(['-q', '-d', 'PERFORMANCE'], { smi });
  const named = parseNamedReasons(q);
  const maskRaw = runSmi(
    ['--query-gpu=clocks_event_reasons.active', '--format=csv,noheader,nounits'], { smi },
  ).trim().split('\n')[0];

  const problems = [];
  if (named.size === 0) problems.push('карта не напечатала ни одной именованной причины — разбор блока сломан');

  const ourLabels = new Set(THROTTLE_BITS.map((b) => b.smiLabel));
  for (const label of named.keys()) {
    if (!ourLabels.has(label)) problems.push(`карта знает причину «${label}», а таблица — нет`);
  }
  for (const b of THROTTLE_BITS) {
    if (!named.has(b.smiLabel)) problems.push(`таблица знает причину «${b.smiLabel}», а карта её не печатает`);
  }

  const activeFromNames = [...named.entries()].filter(([, on]) => on)
    .map(([label]) => THROTTLE_BITS.find((b) => b.smiLabel === label)?.name)
    .filter(Boolean).sort();
  const activeFromMask = decodeThrottleMask(maskRaw);
  if (JSON.stringify(activeFromNames) !== JSON.stringify(activeFromMask)) {
    problems.push(`маска ${maskRaw} расшифровалась как [${activeFromMask.join(', ')}], `
      + `а карта в тот же момент назвала активными [${activeFromNames.join(', ')}]`);
  }

  // The pair config↔table: every thermal reason config names must exist here, or the thermal
  // policy is checking for a string nothing ever produces.
  for (const name of config.THERMAL_THROTTLE_REASONS) {
    if (!THROTTLE_BITS.some((b) => b.name === name)) {
      problems.push(`config.THERMAL_THROTTLE_REASONS называет «${name}», а таблица битов — нет`);
    }
  }

  return { ok: problems.length === 0, problems, mask: maskRaw, named: [...named.keys()], activeFromMask };
}

// =================================================================================================
// 3. One sample
// =================================================================================================

/** The fields actually queried: config's list minus the driver's timestamp, which is kept apart. */
export const SAMPLED_FIELDS = Object.freeze(config.TELEMETRY_FIELDS.filter((f) => f !== 'timestamp'));

/**
 * Refuse to sample a field this card was probed NOT to have. Config carries both lists; letting
 * them overlap would write a column of `N/A` and teach the next session that the sampler is broken.
 */
function assertFieldsSane() {
  const absent = config.TELEMETRY_FIELDS.filter((f) => config.TELEMETRY_FIELDS_UNAVAILABLE_HERE.includes(f));
  if (absent.length) {
    throw new Error(`config.TELEMETRY_FIELDS содержит поля, помеченные отсутствующими на этой карте: ${absent.join(', ')}`);
  }
  if (!config.TELEMETRY_FIELDS.includes('timestamp')) {
    throw new Error('config.TELEMETRY_FIELDS не содержит timestamp — колонку времени взять неоткуда');
  }
}

/** `'42'` → 42 · `'N/A'` → null · anything else stays the string the driver gave. */
function coerce(value) {
  const t = String(value ?? '').trim();
  if (!t || t === 'N/A' || t === '[N/A]' || t === '[Not Supported]') return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(t)) return Number(t);
  return t;
}

/**
 * Take one sample.
 *
 * Returns `{ t, sample }`: `t` is the DRIVER's timestamp string and the only value that moves
 * between two runs of identical length; `sample` holds everything else with sorted keys, so two
 * files diff cleanly.
 *
 * [TESTED: 2026-08-10 · all 12 fields populated on this card, zero nulls]
 */
export function sampleOnce({ smi = 'nvidia-smi' } = {}) {
  assertFieldsSane();
  const out = runSmi(
    [`--query-gpu=${config.TELEMETRY_FIELDS.join(',')}`, '--format=csv,noheader,nounits'], { smi },
  );
  const line = out.split('\n').map((l) => l.trim()).filter(Boolean)[0];
  if (!line) throw new Error('nvidia-smi вернул пустой ответ на запрос телеметрии');

  const cells = line.split(',').map((c) => c.trim());
  if (cells.length !== config.TELEMETRY_FIELDS.length) {
    throw new Error(`ожидал ${config.TELEMETRY_FIELDS.length} колонок, получил ${cells.length}: «${line}»`);
  }

  const raw = {};
  config.TELEMETRY_FIELDS.forEach((f, i) => { raw[f] = cells[i]; });

  const sample = {};
  for (const f of SAMPLED_FIELDS) sample[f] = coerce(raw[f]);

  // The mask is DECODED, and the raw hex stays beside it: the names are what a human and the
  // thermal policy read, the mask is what proves the names were not invented.
  sample['clocks_event_reasons.names'] = decodeThrottleMask(raw['clocks_event_reasons.active']);
  sample['clocks_event_reasons.active'] = String(raw['clocks_event_reasons.active'] ?? '').trim() || null;

  return { t: String(raw.timestamp ?? '').trim(), sample: sortKeys(sample) };
}

/** Sorted keys, recursively — canonical order for anything that is diffed (AGENT_GUIDE.md). */
function sortKeys(o) {
  if (Array.isArray(o)) return o;
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
  return out;
}

// =================================================================================================
// 4. The run — JSONL with a monotonic index
// =================================================================================================

/**
 * The header record. Every value in it is STABLE for a given card and driver — there is deliberately
 * no wall clock here, or two runs would differ on line 1 before the card had done anything.
 * The moment a run happened belongs to the run's own directory name, and to step 3.7's stamp.
 */
export function runHeader({ smi = 'nvidia-smi', periodMs } = {}) {
  const line = runSmi(
    ['--query-gpu=name,driver_version,vbios_version', '--format=csv,noheader'], { smi },
  ).split('\n')[0] || '';
  const [name, driver, vbios] = line.split(',').map((c) => c.trim());
  return {
    i: -1,
    meta: sortKeys({
      gpu: name || null,
      driver_version: driver || null,
      vbios_version: vbios || null,
      fields: [...SAMPLED_FIELDS],
      period_ms: periodMs,
      sampler: 'automation-engine/lib/hardware-mon.mjs',
    }),
  };
}

/**
 * Append ONE record to the sampler's file, and make it DURABLE before returning.
 *
 * 🔴 THE `fsync` IS THE POINT OF THIS FUNCTION, and it exists because its absence cost this project
 * the only recording it has of the card strangling the system (`bugs/37`). The fatal run's file
 * ends in 768 NUL bytes: its last readable probe is 11:52:30, the rung that killed the machine
 * opened at 11:52:32, `Kernel-Power/41` fired at 11:54:24. Almost two minutes of probes existed
 * only in the page cache, and the dying machine took the page cache with it.
 *
 * An ordinary write returns from the OS cache — it means «the OS has your bytes», never «the disk
 * has your bytes». The difference is invisible while the machine lives and total the moment it does
 * not. The write-ahead journal settled this long ago (R15, `sweep-journal.appendLine`); the sampler
 * simply never got the same treatment, because it was built for the dashboard, where losing the
 * last few seconds cost nothing. `ideas/10` changed the price: the pulse is now evidence about the
 * edge, and its most valuable part is precisely the seconds before the machine dies.
 *
 * 🔬 THE COST WAS MEASURED, NOT ESTIMATED — the bug doc demanded exactly that, because a sampler
 * that becomes part of the load it measures is a broken instrument. On this machine, 300 repeats of
 * the real 350-byte line:
 *
 *   appendFileSync (before)          median 0,091 ms · p95 0,126 ms · max 0,218 ms
 *   open → write → fsync → close     median 1,010 ms · p95 1,348 ms · max 3,327 ms
 *
 * That is **0,1 % of the 1000 ms tick**. For scale, the `nvidia-smi` spawn this sampler already
 * pays every single tick costs about 60 ms — SIXTY TIMES more. So the fallback the bug doc allowed
 * («fsync every N probes, N chosen by measurement») is NOT taken: the measurement dissolved the
 * question rather than answering it, and no invented N enters the code.
 *
 * Open-per-line rather than a held descriptor, deliberately: it is the same shape
 * `sweep-journal.appendLine` uses and has mutation-proved, it needs no descriptor lifetime across a
 * process that gets killed by signal, and the difference is 0,09 ms a second.
 *
 * @param {object} [io] `{ openSync, writeSync, fsyncSync, closeSync }` — injected in tests
 *
 * [TESTED: 2026-08-23 13:1x · блоки 18 и 18а набора `pulse` доказывают ПОРЯДОК подставными швами
 *  (открыть → записать → fsync → закрыть); мутация PO «убрать fsync» красит оба. Цена замерена
 *  прогоном на этой машине, числа выше]
 */
export function appendSampleLine(path, record, io = {}) {
  const open = io.openSync ?? openSync;
  const put = io.writeSync ?? writeSync;
  const sync = io.fsyncSync ?? fsyncSync;
  const close = io.closeSync ?? closeSync;

  const line = `${JSON.stringify(record)}\n`;
  const fd = open(path, 'a');
  try {
    put(fd, line, null, 'utf8');
    sync(fd);
  } finally {
    close(fd);
  }
  return record;
}

/**
 * Sample for `seconds`, one record per `periodMs`, appending JSONL to `out` (or returning the
 * records when no file is given). Every written record is fsynced — see `appendSampleLine`.
 *
 * The clock is used for SCHEDULING only and never reaches the output. The loop is synchronous by
 * design: `nvidia-smi` costs a process spawn per sample and overlapping spawns would make the
 * sampler part of the load it is measuring.
 *
 * [TESTED: 2026-08-10 · 30 s at idle, 60 records, every field populated; two runs differ only in
 * the `t` column and in card-reported values — never in our bookkeeping]
 */
export async function sampleFor({
  seconds, periodMs = config.TELEMETRY_SAMPLE_MS, out = null, smi = 'nvidia-smi', onSample = null, io = {},
} = {}) {
  assertFieldsSane();
  const records = [];

  // Every written record is FSYNCED before this returns — `appendSampleLine` above carries the why
  // and the measured cost (`bugs/37`). Without a file we keep records in memory and there is
  // nothing to make durable.
  const write = (obj) => {
    if (!out) { records.push(obj); return; }
    appendSampleLine(out, obj, io);
  };

  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(out, '', 'utf8');                 // a run never appends to a previous run's file
  }
  write(runHeader({ smi, periodMs }));

  const started = performance.now();               // scheduling only — never written out
  let i = 0;
  for (;;) {
    const due = started + i * periodMs;
    const wait = due - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if ((performance.now() - started) > seconds * 1000) break;

    const { t, sample } = sampleOnce({ smi });
    const record = { i, t, sample };
    write(record);
    if (onSample) onSample(record);
    i++;
  }
  return { count: i, records };
}

// =================================================================================================
// 5. THE PULSE — reading the sampler's OWN heartbeat
// =================================================================================================
//
// WHY THIS LIVES HERE AND NOT IN THE ORACLE. The sampler is a SEPARATE PROCESS polling the card once
// a second, and that is the whole point: the sweep blocks inside every burn, this does not. So when
// THIS process loses a tick, the card did not stall — the SYSTEM did. That is a different face of
// failure from the three the oracle already watches (checksum · event log · work-per-second), and
// `ideas/10` §3 measured that all three stay silent through it: they watch OUR WORK, not the system.
//
// The evidence, one case, 2026-08-23, band 2805…2700 MHz (`ideas/10` §2): on 2797 MHz the rungs at
// 865 · 860 · 850 mV lost ZERO ticks; the rung at 845 mV lost two (3,07 s and 3,37 s); the next rung
// down killed the machine. The oracle said PASS on all four.
//
// 🔴 WHAT THIS SECTION DELIBERATELY DOES NOT DO: DECIDE. There is no threshold here and there is no
// verdict, because n = 1 — one dirty rung against three clean ones, on one frequency, in one run.
// A threshold picked from that would be an invented number (`PHILOSOPHY.md` → the three doors,
// door 3 is FORBIDDEN), and this project has already paid for an alarm that lies on schedule
// (`bugs/27`, the dashboard's freeze detector). What is measurable today is HOW MUCH TIME the
// sampler lost and WHERE; whether that means «edge» is a judgement with nothing yet to stand on.
// The archive (§27.1 of `plans/27`) is what will eventually give it something.

/**
 * The reporting bins for the interval distribution — NOT a threshold, and the difference is the
 * whole point of this section.
 *
 * A threshold answers «is this an edge?» with one number somebody chose. These bins answer «how are
 * the intervals spread?» with four counts at once, so the human reading the report picks the
 * boundary FROM THE DATA instead of inheriting mine. `ideas/10` §5.1 names the trap explicitly:
 * the «1,6 s» in its own table is an analysis convenience, not a measured boundary.
 */
export const PULSE_BINS = [1.5, 2, 3, 5];

/**
 * Parse the driver's timestamp — `"2026/08/23 11:50:13.849"` — into epoch milliseconds.
 *
 * Hand-parsed rather than handed to `Date.parse`: that format is not one the ECMAScript spec
 * requires any engine to accept, so `Date.parse` is free to return NaN on one Node build and a
 * plausible number on the next. Rule 2 of this module (nothing volatile of ours in the output)
 * applies to the READING side too — a parser that varies by engine makes every number below vary.
 *
 * The stamp carries no zone, because nvidia-smi writes the machine's LOCAL clock; it is therefore
 * read as local, which is what makes it joinable with the journal's `+03:00` stamps on this machine.
 *
 * @returns {number|null} epoch ms, or null when the string is not a stamp we recognise
 */
export function parseSampleTime(t) {
  const m = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/u.exec(String(t ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, H, M, S, ms] = m;
  const ts = new Date(+y, +mo - 1, +d, +H, +M, +S, ms ? +ms.padEnd(3, '0') : 0).getTime();
  return Number.isFinite(ts) ? ts : null;
}

/**
 * МАКСИМАЛЬНЫЙ ЗАЗОР МЕЖДУ ПРОБАМИ СЭМПЛЕРА В ОКНЕ ВРЕМЕНИ (`bugs/61`).
 *
 * Вход ступени в вердикт: развёртка после прожига спрашивает СВОЁ окно файла сэмплера — ровно как
 * `queryFaults` читает своё окно журнала Windows. Три состояния РАЗЛИЧЕНЫ (класс R4b: прибор без
 * данных молчит, а не голосует): `observed: false` — файла нет, строки рваные или проб в окне
 * меньше двух; `observed: true` — зазоры посчитаны. Окно берётся по ШТАМПАМ ПРОБ с допуском один
 * тик сэмплера (`padMs`): сэмплер пишет с запаздыванием, и окно впритык теряло бы крайние пробы.
 *
 * Только чтение; рваная последняя строка — норма (кэш страниц умирает с машиной, `bugs/37`).
 *
 * [NOT-TESTED] при рождении — переворачивают блоки «ПУЛЬС» в `engine --selftest` (AC1/AC3
 * оперплана `bugs/61`) на закоммиченных фикстурах обоих смертельных прогонов.
 */
export function maxSampleGapMs(path, { fromMs, toMs, padMs = 1500 } = {}) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return { observed: false, why: `файла сэмплера нет: ${path}` }; }
  const ts = [];
  for (const line of raw.split('\n')) {
    const s = line.trim(); if (!s) continue;
    let rec; try { rec = JSON.parse(s); } catch { continue; } // рваный хвост — норма
    if (!rec?.t || !rec?.sample) continue;
    const ms = parseSampleTime(rec.t);
    if (ms === null) continue;
    if (Number.isFinite(fromMs) && ms < fromMs - padMs) continue;
    if (Number.isFinite(toMs) && ms > toMs + padMs) continue;
    ts.push(ms);
  }
  ts.sort((a, b) => a - b);
  if (ts.length < 2) return { observed: false, why: `проб в окне ${ts.length} — зазор не существует` };
  let maxGapMs = 0;
  for (let i = 1; i < ts.length; i++) maxGapMs = Math.max(maxGapMs, ts[i] - ts[i - 1]);
  return { observed: true, maxGapMs, samples: ts.length };
}

/**
 * The intervals between consecutive samples, in order.
 *
 * 🔴 ONE MEASURED QUANTITY, NOT THREE DERIVED ONES — and the cut is worth recording, because the
 * first cut of this function had three and two of them were undecidable.
 *
 * It carried `missedTicks` (`round(ms / period) − 1`) and a `catchUp` flag beside the overshoot.
 * Mutation proved both unprovable: swapping `round` for `floor`, and swapping the catch-up rule for
 * a different one, reddened NOTHING — because at 1600 ms there is no non-arbitrary answer to «was a
 * tick missed?». The probe due at 1000 ms did fire, merely late. Whichever rounding one picks is a
 * number nobody measured, which is the invented-number class (`PHILOSOPHY.md` → the three doors)
 * wearing the clothes of arithmetic. Both were removed rather than argued.
 *
 * WHAT SURVIVES IS THE THING THE SAMPLER ACTUALLY PROMISES: one probe per period. So the measured
 * quantity is `overshootMs` — how much longer than the promise the card went unobserved. It needs
 * no rounding, no threshold and no classification, and it is the same number whichever way anybody
 * would have argued the boundary. On the fatal run the two real gaps overshoot by 2070 and 2366 ms
 * (sum 4436, which is `ideas/10` §2's 4,44 s), while the whole file overshoots by 4840 — the extra
 * 400 being hundreds of ordinary 1002 ms intervals. BOTH numbers are reported, because the
 * difference between them is jitter and hiding either would be the misleading half.
 *
 * WHAT IS NOT AN INTERVAL: the first sample has no predecessor, and the header record (`i: -1`)
 * carries no clock at all. Both are dropped rather than defaulted — a synthesised first interval is
 * a fabricated observation, and the sampler's start is exactly where one would be most tempting.
 *
 * SHORT INTERVALS ARE REAL AND ARE KEPT. `sampleFor` schedules against an ABSOLUTE due time
 * (`started + i * periodMs`), so after a stall it fires the backlog back-to-back — the 63 ms and
 * 78 ms probes that follow each gap in the fatal run. They are genuine samples of a genuine card
 * and belong in the distribution exactly as they are; labelling them was the part that could not be
 * justified, not recording them.
 *
 * @param {Array<object>} records the sampler's JSONL, header included
 * @param {{periodMs?: number}} opts nominal period; defaults to the header's own `period_ms`
 * @returns {{periodMs:number, samples:number, intervals:Array<object>, unparsed:number}}
 *
 * [TESTED: 2026-08-23 12:5x · блоки 3-8б набора `pulse`; на ЗАХВАЧЕННОМ файле рокового прогона
 *  два долгих интервала в 11:52:07 и 11:52:18 дают 4436 мс сверх обещания — число, которое
 *  `ideas/10` §2 намерил руками. Мутации PB и PE красят свои]
 */
export function pulseIntervals(records, { periodMs = null } = {}) {
  const rows = Array.isArray(records) ? records : [];
  const header = rows.find((r) => r && r.i === -1 && r.meta) ?? null;
  // The period comes from the FILE that was written, not from today's config: an archive read a
  // month later must be measured against the period it was actually sampled at.
  const period = Number(periodMs ?? header?.meta?.period_ms ?? config.TELEMETRY_SAMPLE_MS);

  const stamped = [];
  let unparsed = 0;
  for (const r of rows) {
    if (!r || r.i === -1 || r.t === undefined) continue;
    const at = parseSampleTime(r.t);
    if (at === null) { unparsed++; continue; }
    stamped.push({ i: r.i, t: r.t, at });
  }

  const intervals = [];
  for (let k = 1; k < stamped.length; k++) {
    const prev = stamped[k - 1];
    const cur = stamped[k];
    const ms = cur.at - prev.at;
    intervals.push({
      i: cur.i,
      fromT: prev.t,
      toT: cur.t,
      ms,
      // How many nominal periods this interval spans, UNROUNDED. The reader sees 3,07 and 1,00 and
      // judges; nothing downstream rounds it into a count.
      multiple: period > 0 ? ms / period : null,
      // Time beyond the sampler's promise of one probe per period. Never negative: a stamp that
      // goes backwards is a clock artefact, not time the card gave back.
      overshootMs: Math.max(0, ms - period),
    });
  }

  return { periodMs: period, samples: stamped.length, intervals, unparsed };
}

/**
 * The distribution of those intervals — the shape of a run's pulse, with no verdict in it.
 *
 * `overBins` counts the intervals at or above each bin at once, deliberately: one count invites the
 * reader to treat it as the answer, four counts make the spread visible and force the boundary to be
 * argued from the data. There is no field here that says whether the run was healthy, and there is a
 * self-check block that goes red if one ever appears.
 *
 * [TESTED: 2026-08-23 12:5x · блоки 8б и 9; мутация PF (добавить булево «здоров ли прогон») красит
 *  блок 9, мутация PM (корзины без «сверх обещания») красит блок 8б]
 */
export function pulseSummary(records, { periodMs = null } = {}) {
  const r = pulseIntervals(records, { periodMs });
  const all = r.intervals.map((x) => x.ms).sort((a, b) => a - b);
  const median = all.length === 0 ? null
    : (all.length % 2 === 1 ? all[(all.length - 1) / 2] : (all[all.length / 2 - 1] + all[all.length / 2]) / 2);

  // Each bin reports BOTH how many intervals reach it and how much overshoot they account for. One
  // without the other is the misleading half: counts alone hide how long the stalls were, and a
  // total alone hides whether it was one stall or four hundred jitters.
  const overBins = {};
  for (const b of PULSE_BINS) {
    const hit = r.intervals.filter((x) => x.ms >= b * r.periodMs);
    overBins[b] = { count: hit.length, overshootMs: hit.reduce((s, x) => s + x.overshootMs, 0) };
  }

  return {
    periodMs: r.periodMs,
    samples: r.samples,
    intervals: r.intervals.length,
    unparsed: r.unparsed,
    medianMs: median,
    maxMs: all.length ? all[all.length - 1] : null,
    // Total time beyond the promise, across every interval — jitter included, and that inclusion is
    // deliberate: a run of 137 intervals overshooting 3 ms each really did spend 400 ms unobserved.
    overshootMs: r.intervals.reduce((s, x) => s + x.overshootMs, 0),
    overBins,
    // The first and last stamps, so a caller can place this file on a timeline without re-parsing.
    firstAt: r.intervals.length ? parseSampleTime(r.intervals[0].fromT) : null,
    lastAt: r.intervals.length ? parseSampleTime(r.intervals[r.intervals.length - 1].toT) : null,
  };
}

/**
 * Read a sampler file from disk into records. Malformed lines are COUNTED, never guessed at: a run
 * that died mid-write leaves a truncated last line, and that is a fact about the run worth keeping.
 *
 * [TESTED: 2026-08-23 12:5x · на роковом файле: 139 записей, 1 битая строка — и битой она оказалась
 *  не случайно, а потому что машина умерла, не сбросив кэш страниц (`bugs/37`)]
 */
export function readPulseFile(path, { fs = null } = {}) {
  const read = fs?.readFileSync ?? readFileSync;
  let text;
  try { text = read(path, 'utf8'); } catch (e) { return { ok: false, why: `не прочитать ${path}: ${e.message}`, records: [], broken: 0 }; }
  const records = [];
  let broken = 0;
  for (const line of String(text).split(/\r?\n/u)) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { broken++; }
  }
  return { ok: true, why: '', records, broken };
}

// =================================================================================================
// 6. THE ARCHIVE — a run's pulse outliving its run
// =================================================================================================

/** Where a run's pulse goes to survive the next run. */
export const PULSE_ARCHIVE_DIR = join('runs', 'telemetry');

/**
 * Move the previous run's pulse out of the way BEFORE this run's sampler truncates it.
 *
 * 🔴 THE MOMENT IS THE DESIGN, AND IT IS NOT THE OBVIOUS ONE. Archiving at the END of a run is what
 * one writes first and it does not work here: the runs whose pulse matters most are the runs that
 * END IN A DEAD MACHINE, and a dead machine runs no cleanup. So the archiving is done by the NEXT
 * launch, on a file that has been sitting untouched on disk across the reboot. The cost of the fatal
 * run's evidence is exactly what `ideas/10` §5.6 named: there was no archive at all, and the sampler
 * truncates on start (`sampleFor`: «a run never appends to a previous run's file»).
 *
 * THE NAME COMES FROM THE FILE, NOT FROM THE CLOCK. `<first sample's stamp>.jsonl` — an archive
 * must say WHEN THE TELEMETRY WAS TAKEN, and the clock at the moment of moving says when it was
 * tidied away, which can be days later and across a reboot. Same rule as the sampler's own header
 * (no wall clock in compared output); the moment belongs to the file's own contents.
 *
 * A file with no parseable sample is NOT archived. An archive of empty files is an archive somebody
 * must first learn to filter, and the sampler leaves exactly such a file behind when it is started
 * and killed within a second.
 *
 * @returns {{archived: boolean, to: string|null, why: string}}
 *
 * [TESTED: 2026-08-23 12:47 · блоки 10-13 на подставном `fs`, мутации PG · PH · PI красят свои. И
 *  ПРОГНАНА НА БОЕВОМ ФАЙЛЕ: `runs/dashboard/telemetry.jsonl` переехал в
 *  `runs/telemetry/20260823-115013.jsonl` — имя от первой пробы, перенос, а не копия]
 */
export function archivePulseFile(livePath, { dir = PULSE_ARCHIVE_DIR, fs = null } = {}) {
  const F = {
    existsSync: fs?.existsSync ?? existsSync,
    mkdirSync: fs?.mkdirSync ?? mkdirSync,
    renameSync: fs?.renameSync ?? renameSync,
    readFileSync: fs?.readFileSync ?? readFileSync,
  };
  if (!F.existsSync(livePath)) return { archived: false, to: null, why: 'предыдущего файла нет — архивировать нечего' };

  const read = readPulseFile(livePath, { fs: { readFileSync: F.readFileSync } });
  const first = read.records.find((r) => r && r.i !== -1 && r.t !== undefined && parseSampleTime(r.t) !== null);
  if (!first) return { archived: false, to: null, why: 'в файле нет ни одной пробы со временем — это не улика' };

  // `2026/08/23 11:50:13.849` → `20260823-115013`. Sortable, and it reads as a moment.
  const m = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/u.exec(String(first.t).trim());
  const stamp = `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;

  let to = join(dir, `${stamp}.jsonl`);
  // Two runs cannot share a first-sample second in practice, but a collision must never overwrite
  // evidence — the whole point of this function is that nothing here is destroyed.
  for (let n = 2; F.existsSync(to); n++) to = join(dir, `${stamp}-${n}.jsonl`);

  try {
    F.mkdirSync(dir, { recursive: true });
    F.renameSync(livePath, to);
  } catch (e) {
    return { archived: false, to: null, why: `перенести не удалось: ${e.message}` };
  }
  return { archived: true, to, why: '' };
}

// =================================================================================================
// 7. CLI
// =================================================================================================

function parseArgs(argv) {
  const o = { once: false, checkDecode: false, seconds: 30, periodMs: config.TELEMETRY_SAMPLE_MS, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--once') o.once = true;
    else if (a === '--check-decode') o.checkDecode = true;
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--period') o.periodMs = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else throw new Error(`неизвестный флаг: ${a}`);
  }
  if (!Number.isFinite(o.seconds) || o.seconds <= 0) throw new Error('--seconds должен быть положительным числом');
  if (!Number.isFinite(o.periodMs) || o.periodMs <= 0) throw new Error('--period должен быть положительным числом');
  return o;
}

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`ОШИБКА: ${e.message}`); return 2; }

  try {
    if (o.checkDecode) {
      const r = verifyThrottleDecode();
      console.log(`МАСКА СЕЙЧАС: ${r.mask} -> [${r.activeFromMask.join(', ') || 'ничего не активно'}]`);
      console.log(`КАРТА НАЗЫВАЕТ ${r.named.length} причин: ${r.named.join(' · ')}`);
      if (r.ok) { console.log('РАСШИФРОВКА: сходится с картой в обе стороны.'); return 0; }
      console.error('РАСШИФРОВКА НЕ СХОДИТСЯ:');
      for (const p of r.problems) console.error(`  · ${p}`);
      return 1;
    }

    if (o.once) {
      const s = sampleOnce();
      console.log(JSON.stringify({ i: 0, t: s.t, sample: s.sample }, null, 2));
      return 0;
    }

    console.log(`СЭМПЛИРУЮ: ${o.seconds} с, период ${o.periodMs} мс, полей ${SAMPLED_FIELDS.length}`);
    if (o.out) console.log(`ФАЙЛ: ${resolve(o.out)}`);
    const r = await sampleFor({ seconds: o.seconds, periodMs: o.periodMs, out: o.out });
    console.log(`ГОТОВО: записей ${r.count}`);
    return 0;
  } catch (e) {
    console.error(`ОШИБКА: ${e.message}`);
    return 1;
  }
}

// T9 — a module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

