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
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
 * Sample for `seconds`, one record per `periodMs`, appending JSONL to `out` (or returning the
 * records when no file is given).
 *
 * The clock is used for SCHEDULING only and never reaches the output. The loop is synchronous by
 * design: `nvidia-smi` costs a process spawn per sample and overlapping spawns would make the
 * sampler part of the load it is measuring.
 *
 * [TESTED: 2026-08-10 · 30 s at idle, 60 records, every field populated; two runs differ only in
 * the `t` column and in card-reported values — never in our bookkeeping]
 */
export async function sampleFor({ seconds, periodMs = config.TELEMETRY_SAMPLE_MS, out = null, smi = 'nvidia-smi', onSample = null } = {}) {
  assertFieldsSane();
  const records = [];
  const write = (obj) => {
    const line = `${JSON.stringify(obj)}\n`;
    if (out) appendFileSync(out, line, 'utf8'); else records.push(obj);
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
// 5. CLI
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

