#!/usr/bin/env node
// stress-tester.mjs — the three-way verdict: PASS / SDC / CRASH.
//
// Plan anchor (plans/02_epic01_phase1_harness_and_baseline.md §3.6): "Run a workload, capture its
// checksum, compare against the golden reference; ask event-logger.mjs for faults in the same
// window; return PASS / SDC / CRASH." Upward: epic §2 AC3 — "no crash and no silent corruption".
//
// WHY THE MIDDLE VERDICT EXISTS AND IS THE WHOLE POINT. researches/02 §3 Step 1, from Leng et al.
// (MICRO 2015): 37 of 57 programs corrupt their output BEFORE they crash. A two-way pass/crash
// oracle therefore walks an unknown distance INSIDE the corruption region and reports success the
// whole way. "It did not crash" is not a passing run, and this module refuses to say otherwise.
//
// FOUR RULES IT ENFORCES, each of which can turn a green run red:
//
//  1. **SDC IS LOUD.** A checksum mismatch is never rounded to "probably fine", never averaged, never
//     retried until it agrees. One mismatch in a hundred bursts is the verdict for the whole run.
//  2. **A GOLDEN REFERENCE IS BOUND TO ITS DRIVER AND VBIOS (R6).** Comparing against a reference
//     captured on another driver is comparing against a different card. A stamp mismatch does not
//     downgrade to a warning — it makes the verdict UNKNOWN, because the comparison never happened.
//  3. **"COULD NOT LOOK" IS NOT "NOTHING HAPPENED"** — inherited from event-logger.mjs. If the fault
//     providers could not be read, there is no PASS to give.
//  4. **A DEAD PROCESS IS A CRASH,** whatever the event log says. The log is the second witness, not
//     the first: a workload that exits non-zero or prints no checksum has already failed.
//
// GPU WRITES: NONE. This module loads the card by RUNNING compute on it; it never sets a clock, a
// voltage or a power limit. Phase 1 stays at zero writes (plan §2, P1-AC6).
//
// Usage:
//   node automation-engine/lib/stress-tester.mjs --workload sdc_fma --seconds 30
//   node automation-engine/lib/stress-tester.mjs --workload branchy --transient --seconds 60
//   node automation-engine/lib/stress-tester.mjs --capture-baseline          golden + card dump (3.7)
//   node automation-engine/lib/stress-tester.mjs --verify-baseline           P1-AC5, executable
//   node automation-engine/lib/stress-tester.mjs --selftest                  the guard, proven red
//
// Verified 2026-08-10 by observation — see the [TESTED] markers per function.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import config from '../config.mjs';
import { queryFaults, verdictFor } from './event-logger.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const WORKLOADS_DIR = join(ROOT, 'workloads');
const BASELINE_DIR = join(ROOT, 'runs', 'baseline');

/** One burst must terminate. A hung kernel is itself a failure mode, not a reason to wait forever. */
const BURST_TIMEOUT_MS = 60_000;

// =================================================================================================
// 1. Running one burst of a workload
// =================================================================================================

/**
 * Run the workload binary once and read its machine line.
 *
 * The contract is the `KAGO-WORKLOAD name=… checksum=…` line the `.cu` sources print on stdout. A
 * run with exit 0 but NO such line is a failure, not an empty success: the binary would have had to
 * print it, and its absence means the run did not complete the work it claims.
 *
 * `run` is injectable so the self-test can prove the CRASH path without breaking a real GPU run —
 * the same seam the send gate uses to prove a refusal never reaches `gh`.
 *
 * [TESTED: 2026-08-10 · both real binaries on this card; and via the injected runner for exit≠0,
 * for a missing checksum line, and for ENOENT]
 */
export function runBurst({ name, exe = null, args = [], run = null } = {}) {
  const binary = exe || join(WORKLOADS_DIR, `${name}.exe`);
  const launcher = run || ((cmd, a) => spawnSync(cmd, a, {
    encoding: 'utf8', timeout: BURST_TIMEOUT_MS, windowsHide: true,
  }));

  const r = launcher(binary, args.map(String));

  if (r && r.error && r.error.code === 'ENOENT') {
    return { ok: false, died: true, checksum: null, reason: `бинарника нет: ${binary}`, status: null };
  }
  if (r && r.error && r.error.code === 'ETIMEDOUT') {
    return { ok: false, died: true, checksum: null, reason: `нагрузка не завершилась за ${BURST_TIMEOUT_MS} мс — зависшее ядро`, status: null };
  }
  const status = r ? r.status : null;
  const stdout = String((r && r.stdout) || '');
  const line = stdout.split(/\r?\n/).find((l) => l.startsWith('KAGO-WORKLOAD')) || '';

  const fields = {};
  for (const part of line.split(/\s+/).slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }

  if (status !== 0) {
    return {
      ok: false, died: true, checksum: null, status, fields,
      reason: `нагрузка вышла с кодом ${status}${(r && r.stderr) ? `: ${String(r.stderr).trim().split('\n').slice(-2).join(' ')}` : ''}`,
    };
  }
  if (!fields.checksum) {
    return {
      ok: false, died: true, checksum: null, status, fields,
      reason: 'нагрузка вышла нулём, но не напечатала строку KAGO-WORKLOAD с контрольной суммой — работа не доведена',
    };
  }
  return { ok: true, died: false, checksum: fields.checksum, status, fields, reason: null };
}

// =================================================================================================
// 2. The golden reference and its stamp (R6)
// =================================================================================================

/** What the card reports right now — the thing a golden reference's stamp is held against. */
export function probeCard(runner = null) {
  const launcher = runner || ((cmd, a) => spawnSync(cmd, a, { encoding: 'utf8', timeout: 15_000, windowsHide: true }));
  const r = launcher('nvidia-smi', ['--query-gpu=name,driver_version,vbios_version', '--format=csv,noheader']);
  if (!r || r.status !== 0) return { name: null, driver: null, vbios: null, probed: false };
  const [name, driver, vbios] = String(r.stdout || '').split('\n')[0].split(',').map((c) => c.trim());
  return { name: name || null, driver: driver || null, vbios: vbios || null, probed: true };
}

/** Read `runs/baseline/<name>.json`, or null when this workload has no reference yet. */
export function loadGolden(name, { dir = BASELINE_DIR } = {}) {
  const p = join(dir, `${name}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

/**
 * R6, enforced rather than remembered: "Profiles carry the driver and VBIOS they were proved on. A
 * driver update can silently change voltage behaviour — it did in 595.71."
 *
 * A mismatch is NOT a warning. The comparison the verdict rests on did not happen, so the honest
 * answer is UNKNOWN — see decideVerdict below.
 *
 * [TESTED: 2026-08-10 · self-test block "stale stamp" — a golden stamped with driver 000.00 makes
 * the verdict UNKNOWN even though the checksum matches perfectly]
 */
export function checkGoldenStamp(golden, card, args = []) {
  if (!golden) return { ok: false, why: 'эталона для этой нагрузки нет — сравнивать не с чем' };
  const g = golden.gpu || {};
  if (!g.driver || !g.vbios) return { ok: false, why: 'в эталоне нет штампа драйвера/VBIOS — правило R6 не выполнено' };
  if (!card.probed) return { ok: false, why: 'не смог прочитать драйвер/VBIOS у карты — штамп сверить нечем' };
  if (g.driver !== card.driver || g.vbios !== card.vbios) {
    return {
      ok: false,
      why: `эталон снят на драйвере ${g.driver} / VBIOS ${g.vbios}, а карта сейчас ${card.driver} / ${card.vbios} — `
        + 'эталон недействителен до перепроверки (R6)',
    };
  }

  // THE ARGUMENTS ARE PART OF THE STAMP, and leaving them out produced a FALSE SDC on the first
  // real run: `--arg 4000000` against a golden captured at the default 100000 iterations reported
  // «ТИХОЕ ИСКАЖЕНИЕ ДАННЫХ: 58 из 58 прогонов разошлись с эталоном». Nothing was corrupted — the
  // checksum is a function of the parameters, so the comparison never happened. A false SDC is worse
  // than a missed one: it would make a future voltage sweep declare a healthy card unstable at every
  // point. Same class as the driver stamp above — an invalid comparison is UNKNOWN, never a verdict.
  const want = (golden.args || []).map(String);
  const got = (args || []).map(String);
  if (JSON.stringify(want) !== JSON.stringify(got)) {
    return {
      ok: false,
      why: `эталон снят с аргументами [${want.join(' ') || 'по умолчанию'}], а прогон идёт с `
        + `[${got.join(' ') || 'по умолчанию'}] — контрольная сумма зависит от них, сравнивать нельзя`,
    };
  }

  return { ok: true, why: `штамп сходится: драйвер ${g.driver}, VBIOS ${g.vbios}, аргументы [${want.join(' ') || 'по умолчанию'}]` };
}

// =================================================================================================
// 3. The verdict
// =================================================================================================

/**
 * Combine the three witnesses into one of PASS / SDC / CRASH — or UNKNOWN, which is a fourth honest
 * outcome and not a failure of nerve.
 *
 * ORDER IS THE DESIGN. A dead process or a logged fault is CRASH and outranks everything: a run that
 * fell over tells you nothing about its checksum. A mismatch observed directly is SDC even when the
 * event log could not be read — the corruption was seen, and seeing beats not-looking. Only when
 * nothing died, nothing mismatched AND every witness actually answered is there a PASS.
 *
 * [TESTED: 2026-08-10 · self-test covers all five outcomes, each proven by making it happen rather
 * than by reading this comment]
 */
export function decideVerdict({ bursts, golden, stamp, faults }) {
  const V = config.VERDICT;
  const dead = bursts.filter((b) => b.died);
  const loggedFaults = (faults && faults.faults) || [];

  if (dead.length || loggedFaults.length) {
    const why = [
      dead.length ? `процесс не дожил ${dead.length} раз(а): ${dead[0].reason}` : null,
      loggedFaults.length ? `журнал Windows: ${loggedFaults.map((f) => `${f.provider}/${f.eventId} (${f.what})`).join('; ')}` : null,
    ].filter(Boolean).join(' · ');
    return { verdict: V.CRASH, reason: why };
  }

  const got = [...new Set(bursts.map((b) => b.checksum))];
  if (!bursts.length) return { verdict: null, reason: 'ни одного прогона нагрузки — судить не о чем' };

  // SDC is decided on what was OBSERVED, so it does not wait for the stamp or the log to be readable.
  if (stamp.ok && golden && got.some((c) => c !== golden.checksum)) {
    const bad = bursts.filter((b) => b.checksum !== golden.checksum);
    return {
      verdict: V.SDC,
      reason: `ТИХОЕ ИСКАЖЕНИЕ ДАННЫХ: ${bad.length} из ${bursts.length} прогонов разошлись с эталоном. `
        + `Эталон ${golden.checksum}, получено ${got.join(', ')}. Ничего не упало — и это худший случай, а не лучший.`,
    };
  }
  // A run whose OWN bursts disagree with each other is corruption too, even with no golden at hand.
  if (got.length > 1) {
    return {
      verdict: V.SDC,
      reason: `ТИХОЕ ИСКАЖЕНИЕ ДАННЫХ: прогоны разошлись между собой — ${got.join(', ')}. `
        + 'Нагрузка детерминирована по построению, значит разошлась не она.',
    };
  }

  if (!stamp.ok) return { verdict: null, reason: `сравнение не состоялось: ${stamp.why}` };

  const logVerdict = verdictFor(faults);
  if (logVerdict.verdict === null && !logVerdict.clean) {
    return { verdict: null, reason: `сумма сошлась, но журнал не опрошен: ${logVerdict.reason}` };
  }

  return {
    verdict: V.PASS,
    reason: `${bursts.length} прогон(ов), сумма ${got[0]} совпала с эталоном, сбоев в журнале нет`,
  };
}

// =================================================================================================
// 4. The run — steady and transient
// =================================================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Load the card for `seconds` and judge the result.
 *
 * TWO SHAPES, and the second is the one that matters (researches/02): steady load is the WRONG load.
 * Voltage noise dominates Vmin, so the transitions — not sustained 100 % — are what expose an unsafe
 * profile. `--transient` steps the load between full and idle on config's duty cycle
 * (TRANSIENT_ON_SECONDS / TRANSIENT_OFF_SECONDS), which is the shape a real workload has and a
 * benchmark's flat plateau does not.
 *
 * The fault window deliberately starts BEFORE the first burst and ends AFTER the last, so an event
 * logged microseconds outside the load still belongs to it.
 *
 * [TESTED: 2026-08-10 · both shapes on this card with both real workloads; PASS on an intact golden,
 * and the transient shape observed alternating load and idle in the sampler's own telemetry]
 */
export async function stressTest({
  name,
  seconds = config.EXPRESS_TEST_SECONDS,
  transient = false,
  baselineDir = BASELINE_DIR,
  args = [],
  run = null,
  queryLog = true,
  onBurst = null,
} = {}) {
  const card = probeCard();
  const golden = loadGolden(name, { dir: baselineDir });
  const stamp = checkGoldenStamp(golden, card, args);

  const from = new Date(Date.now() - 2000);   // scheduling and windowing only — never a compared value
  const bursts = [];
  const started = Date.now();
  let cycleStart = started;
  let loading = true;

  while ((Date.now() - started) < seconds * 1000) {
    if (transient) {
      const elapsed = (Date.now() - cycleStart) / 1000;
      const limit = loading ? config.TRANSIENT_ON_SECONDS : config.TRANSIENT_OFF_SECONDS;
      if (elapsed >= limit) { loading = !loading; cycleStart = Date.now(); continue; }
      if (!loading) { await sleep(100); continue; }     // the OFF half of the duty cycle
    }
    const b = runBurst({ name, args, run });
    bursts.push(b);
    if (onBurst) onBurst(b);
    if (b.died) break;                                   // a dead process ends the run; it IS the result
  }
  const to = new Date(Date.now() + 2000);

  let faults = { providers: [], faults: [], events: [], window: null };
  if (queryLog) {
    try { faults = queryFaults({ from, to }); }
    catch (e) { faults = { providers: [{ provider: 'все', status: 'error', count: 0, detail: e.message }], faults: [], events: [] }; }
  }

  const decision = decideVerdict({ bursts, golden, stamp, faults });
  return {
    name, seconds, transient,
    card, golden, stamp,
    bursts: bursts.length,
    checksums: [...new Set(bursts.map((b) => b.checksum))],
    faults,
    ...decision,
  };
}

/**
 * Capture a golden reference at stock. Used by step 3.7, which adds the full `gpu:info` dump
 * alongside; the RUN logic lives here so there is one runner, not two that drift.
 */
export function captureBaseline({ name, args = [], dir = BASELINE_DIR, repeats = config.DETERMINISM_REPEATS } = {}) {
  const card = probeCard();
  const bursts = [];
  for (let i = 0; i < repeats; i++) bursts.push(runBurst({ name, args }));
  const dead = bursts.filter((b) => b.died);
  const distinct = [...new Set(bursts.filter((b) => !b.died).map((b) => b.checksum))];

  if (dead.length) throw new Error(`эталон не снят: ${dead.length} прогон(ов) не дожили — ${dead[0].reason}`);
  if (distinct.length !== 1) {
    throw new Error(`эталон не снят: ${repeats} прогонов дали ${distinct.length} разных сумм (${distinct.join(', ')}) — `
      + 'нагрузка недетерминирована, и эталон из неё был бы ложью');
  }

  mkdirSync(dir, { recursive: true });
  const record = {
    name,
    checksum: distinct[0],
    args: args.map(String),
    repeats,
    gpu: { name: card.name, driver: card.driver, vbios: card.vbios },
    captured_at: stampNow(),
  };
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

/**
 * The full card dump that travels WITH the baseline (plan §3.7).
 *
 * It is taken by running `tools/gpu-info.mjs --json` rather than by re-probing here: that tool is
 * the one owner of the card probe, and a second copy of the query would be a mirror that drifts.
 * The dump is what makes a baseline re-checkable months later — a checksum with no record of the
 * envelope it was measured in is a number without a source, and PHILOSOPHY.md is blunt about those.
 *
 * [TESTED: 2026-08-10 · written and read back; the driver/VBIOS inside it match both the per-workload
 * stamps and what the card reports live]
 */
export function captureCardDump({ dir = BASELINE_DIR } = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, 'tools', 'gpu-info.mjs'), '--json'], {
    encoding: 'utf8', timeout: 30_000, windowsHide: true,
  });
  if (!r || r.status !== 0) {
    throw new Error(`не смог снять дамп карты: gpu-info вышел с кодом ${r ? r.status : 'неизвестно'}`);
  }
  let info;
  try { info = JSON.parse(r.stdout); } catch (e) { throw new Error(`дамп карты не разобрался как JSON: ${e.message}`); }

  mkdirSync(dir, { recursive: true });
  const record = { captured_at: stampNow(), source: 'tools/gpu-info.mjs --json', gpu_info: info };
  writeFileSync(join(dir, '_card.json'), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

/**
 * P1-AC5 made executable: "The golden reference shall carry the driver and VBIOS it was captured on.
 * Scale: baseline files missing the stamp · Meter: read `runs/baseline/*.json` · **Target: 0**."
 *
 * An acceptance criterion that only a human can check is a criterion nobody checks after the day it
 * was written. This one runs. It also holds every stamp against the card RIGHT NOW, so the moment a
 * driver update lands, the baselines announce themselves as invalid instead of waiting to be
 * believed (R6).
 *
 * [TESTED: 2026-08-10 · green on the captured set; mutation-proved red by deleting `gpu.vbios` from
 * one baseline and by rewriting a driver stamp to 000.00]
 */
export function verifyBaseline({ dir = BASELINE_DIR } = {}) {
  const problems = [];
  if (!existsSync(dir)) return { ok: false, files: [], problems: [`каталога эталонов нет: ${dir} — снимите: npm run stress -- --capture-baseline`] };

  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== '_card.json').sort();
  if (!files.length) problems.push(`в ${dir} нет ни одного эталона — судить будет не с чем`);

  const card = probeCard();
  const dumpPath = join(dir, '_card.json');
  if (!existsSync(dumpPath)) problems.push('нет _card.json — дамп карты рядом с эталоном обязателен (план §3.7)');

  const rows = [];
  for (const f of files) {
    const name = f.replace(/\.json$/u, '');
    let g;
    try { g = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch (e) { problems.push(`${f}: не читается как JSON (${e.message})`); continue; }

    const missing = [];
    if (!g.checksum) missing.push('checksum');
    if (!g.gpu || !g.gpu.driver) missing.push('gpu.driver');
    if (!g.gpu || !g.gpu.vbios) missing.push('gpu.vbios');
    if (!g.captured_at) missing.push('captured_at');
    if (!Array.isArray(g.args)) missing.push('args');
    if (missing.length) problems.push(`${f}: нет полей ${missing.join(', ')} — правило R6 не выполнено`);

    const stamp = checkGoldenStamp(g, card, g.args || []);
    if (!stamp.ok) problems.push(`${f}: ${stamp.why}`);
    rows.push({ name, checksum: g.checksum, driver: g.gpu && g.gpu.driver, vbios: g.gpu && g.gpu.vbios, ok: stamp.ok && !missing.length });
  }
  return { ok: problems.length === 0, files: rows, problems, card };
}

/**
 * A machine receipt carries the moment in the OWNER'S local time with its offset, never UTC
 * (`AGENT_GUIDE.md` → "A stamp carries the DATE AND THE TIME"). Caught by reading a captured file:
 * `captured_at` said `2026-08-09T21:52Z` while the owner's clock said `2026-08-10 00:52` — a receipt
 * dated the PREVIOUS DAY, which is exactly the collision the convention exists to prevent.
 *
 * Deliberately NOT imported from the review contour's `review-core.isoLocal`: that module is the
 * owner-review subsystem's core, and coupling the GPU engine to it to save five lines would tie two
 * unrelated stacks together. Same convention, two subsystems, stated here so nobody "fixes" it into
 * a dependency.
 */
function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

/** The workloads present on disk, by the binaries that actually exist. */
export function availableWorkloads() {
  if (!existsSync(WORKLOADS_DIR)) return [];
  return readdirSync(WORKLOADS_DIR).filter((f) => f.endsWith('.exe')).map((f) => f.replace(/\.exe$/u, '')).sort();
}

// =================================================================================================
// 5. The self-test — the guard the plan demands, and it goes red before it goes green
// =================================================================================================

/**
 * "Feed it a deliberately corrupted golden file and watch it return SDC — the guard must go red
 * before its green is trusted" (plan §3.6, verification).
 *
 * Every case here is produced by MAKING IT HAPPEN — an injected runner, a hand-built golden — never
 * by asserting what the code would do. No GPU is touched: the whole suite runs on injected data, so
 * it is honest to run on a machine with no card at all.
 *
 * [TESTED: 2026-08-10 · 10 blocks green, AND the suite mutation-proved red: rounding SDC to PASS
 * inside decideVerdict turned two blocks red («испорченный эталон» and «прогоны разошлись между
 * собой»), exit 1. Not every block was individually inverted — that is not claimed]
 */
export function selfTest() {
  const V = config.VERDICT;
  const results = [];
  const check = (what, got, want) => results.push({ what, ok: got === want, got, want });

  const card = { name: 'X', driver: '610.88', vbios: '98.03.58.40.8b', probed: true };
  const goldenOf = (checksum, gpu = card) => ({ name: 'probe', checksum, gpu: { driver: gpu.driver, vbios: gpu.vbios } });
  const burst = (checksum) => ({ ok: true, died: false, checksum, reason: null });
  const noFaults = { providers: [{ provider: 'p', status: 'no-events', count: 0, detail: '' }], faults: [] };

  // 1. the happy path
  check('чистый прогон -> PASS',
    decideVerdict({ bursts: [burst('aaaa'), burst('aaaa')], golden: goldenOf('aaaa'), stamp: { ok: true, why: '' }, faults: noFaults }).verdict, V.PASS);

  // 2. THE ONE THE PLAN ASKS FOR: a corrupted golden
  check('испорченный эталон -> SDC',
    decideVerdict({ bursts: [burst('aaaa')], golden: goldenOf('deadbeef'), stamp: { ok: true, why: '' }, faults: noFaults }).verdict, V.SDC);

  // 3. bursts disagreeing with each OTHER — corruption with no golden needed
  check('прогоны разошлись между собой -> SDC',
    decideVerdict({ bursts: [burst('aaaa'), burst('bbbb')], golden: goldenOf('aaaa'), stamp: { ok: true, why: '' }, faults: noFaults }).verdict, V.SDC);

  // 4. a dead process outranks everything
  check('процесс умер -> CRASH',
    decideVerdict({ bursts: [{ ok: false, died: true, checksum: null, reason: 'код 1' }], golden: goldenOf('aaaa'), stamp: { ok: true, why: '' }, faults: noFaults }).verdict, V.CRASH);

  // 5. a logged fault with a perfect checksum is still CRASH
  check('сумма сошлась, но в журнале сбой -> CRASH',
    decideVerdict({
      bursts: [burst('aaaa')], golden: goldenOf('aaaa'), stamp: { ok: true, why: '' },
      faults: { providers: [{ provider: 'p', status: 'ok', count: 1, detail: '' }], faults: [{ provider: 'Display', eventId: 4101, what: 'TDR' }] },
    }).verdict, V.CRASH);

  // 6. R6: a golden from another driver makes the comparison meaningless, not lenient
  check('эталон с чужого драйвера -> НЕИЗВЕСТНО (не PASS)',
    decideVerdict({
      bursts: [burst('aaaa')],
      golden: goldenOf('aaaa', { driver: '000.00', vbios: 'x' }),
      stamp: checkGoldenStamp(goldenOf('aaaa', { driver: '000.00', vbios: 'x' }), card),
      faults: noFaults,
    }).verdict, null);

  // 6b. The args are part of the stamp — this one was found by a REAL run reporting a false SDC.
  const goldWithArgs = { ...goldenOf('aaaa'), args: ['100000'] };
  check('прогон с другими аргументами -> НЕИЗВЕСТНО, а НЕ ложный SDC',
    decideVerdict({
      bursts: [burst('bbbb')],
      golden: goldWithArgs,
      stamp: checkGoldenStamp(goldWithArgs, card, ['4000000']),
      faults: noFaults,
    }).verdict, null);
  check('те же аргументы -> сравнение состоялось',
    checkGoldenStamp(goldWithArgs, card, ['100000']).ok, true);

  // 7. the runner seam: a non-zero exit is a death, not an empty success
  const died = runBurst({ name: 'probe', run: () => ({ status: 1, stdout: '', stderr: 'boom' }) });
  check('exit≠0 -> died', died.died, true);
  const noLine = runBurst({ name: 'probe', run: () => ({ status: 0, stdout: 'ничего полезного\n', stderr: '' }) });
  check('exit 0 без строки KAGO-WORKLOAD -> died', noLine.died, true);

  return { ok: results.every((r) => r.ok), results };
}

// =================================================================================================
// 6. CLI
// =================================================================================================

function parseArgs(argv) {
  const o = { workload: null, seconds: 30, transient: false, selftest: false, capture: false, verifyBaseline: false, args: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') o.selftest = true;
    else if (a === '--capture-baseline') o.capture = true;
    else if (a === '--verify-baseline') o.verifyBaseline = true;
    else if (a === '--transient') o.transient = true;
    else if (a === '--json') o.json = true;
    else if (a === '--workload') o.workload = argv[++i];
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--arg') o.args.push(argv[++i]);
    else throw new Error(`неизвестный флаг: ${a}`);
  }
  if (!o.selftest && !Number.isFinite(o.seconds)) throw new Error('--seconds должен быть числом');
  return o;
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

  if (o.verifyBaseline) {
    const r = verifyBaseline();
    for (const f of r.files) {
      console.log(`${f.ok ? 'OK  ' : 'ПЛОХО'} ${f.name}: ${f.checksum} · драйвер ${f.driver}, VBIOS ${f.vbios}`);
    }
    for (const p of r.problems) console.log(`ПЛОХО ${p}`);
    console.log('');
    console.log(r.ok
      ? `P1-AC5: эталонов ${r.files.length}, без штампа — 0. Штампы сходятся с картой (драйвер ${r.card.driver}, VBIOS ${r.card.vbios}).`
      : `P1-AC5 НЕ ВЫПОЛНЕН: расхождений ${r.problems.length}.`);
    return r.ok ? 0 : 1;
  }

  const names = o.workload ? [o.workload] : availableWorkloads();
  if (!names.length) { console.error('ОШИБКА: нагрузок на диске нет — соберите их через npm run workloads:build'); return 1; }

  if (o.capture) {
    try {
      const dump = captureCardDump();
      console.log(`ДАМП КАРТЫ: ${dump.gpu_info.name} · драйвер ${dump.gpu_info.driver_version}, VBIOS ${dump.gpu_info.vbios_version}`);
    } catch (e) { console.error(`ДАМП КАРТЫ: ${e.message}`); return 1; }
    for (const name of names) {
      try {
        const rec = captureBaseline({ name, args: o.args });
        console.log(`ЭТАЛОН ${name}: ${rec.checksum} (${rec.repeats} прогонов) · драйвер ${rec.gpu.driver}, VBIOS ${rec.gpu.vbios}`);
      } catch (e) { console.error(`ЭТАЛОН ${name}: ${e.message}`); return 1; }
    }
    console.log(`ФАЙЛЫ: ${BASELINE_DIR}`);
    return 0;
  }

  let worst = 0;
  for (const name of names) {
    const r = await stressTest({ name, seconds: o.seconds, transient: o.transient, args: o.args });
    console.log('');
    console.log(`НАГРУЗКА: ${name} · ${o.transient ? `переходная ${config.TRANSIENT_ON_SECONDS}/${config.TRANSIENT_OFF_SECONDS} с` : 'ровная'} · ${o.seconds} с`);
    console.log(`  прогонов: ${r.bursts} · суммы: ${r.checksums.join(', ') || '—'}`);
    console.log(`  эталон:   ${r.golden ? r.golden.checksum : 'нет'} · ${r.stamp.why}`);
    for (const p of r.faults.providers || []) console.log(`  журнал:   ${p.provider} — ${p.status}${p.detail ? `, ${p.detail}` : ''}`);
    console.log('');
    if (r.verdict === config.VERDICT.SDC) {
      console.log('  ============================================================');
      console.log(`  ВЕРДИКТ: ${r.verdict}`);
      console.log('  ============================================================');
    } else {
      console.log(`  ВЕРДИКТ: ${r.verdict ?? 'НЕИЗВЕСТНО'}`);
    }
    console.log(`           ${r.reason}`);
    if (o.json) console.log(JSON.stringify(r, null, 2));
    if (r.verdict !== config.VERDICT.PASS) worst = 1;
  }
  return worst;
}

// T9 — a module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}

export { BASELINE_DIR, WORKLOADS_DIR };
