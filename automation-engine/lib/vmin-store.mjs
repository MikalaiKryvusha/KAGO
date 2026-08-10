#!/usr/bin/env node
// vmin-store.mjs — A POINT'S HISTORY IS THE STATE OF THE SEARCH.
//
// Plan anchor (plans/05 §4.2): «A point carries the history of every verdict it ever produced, so
// escalation is a ratchet rather than a fresh guess» (researches/02 §6.5 point 3).
//
// ─── WHY A STORE AND NOT A VARIABLE ───────────────────────────────────────────────────────────────
//
// The owner did not ask for a static margin. He asked for a CONVERGENCE LOOP, verbatim: «готовый
// профиль в точке вставал на минимальный шаг выше, а затем весь профиль кривой из таких „хрупких
// около сбоя“ точках напряжения тестировался… Если он будет „сбоить“, то ищем точку, которая даёт
// сбои и у неё повышаем напряжение на один минимальный шаг вверх». A loop like that is only sound if
// the machine REMEMBERS: a point that failed on Tuesday must never be offered that offset again on
// Friday, and a session with empty context cannot remember anything. So the ratchet is CODE reading
// a FILE — never a convention a future session is asked to honour (EXP-0021 cost five restatements
// by the owner because a criterion lived in prose instead of in a function).
//
// ─── THE ONE CONDITION THAT MAKES THE LOOP SOUND ──────────────────────────────────────────────────
//
// «The escalation trigger must be the SDC ORACLE, never "it didn't crash"» (AGENT_GUIDE, and it is
// not optional). More than half of undervolting failures are silent. So a record's verdict is the
// oracle's three-way answer, and this module treats **anything that is not PASS as evidence against
// the offset** — including `UNKNOWN`, because a comparison that could not happen is not a pass.
//
// ─── WHAT IT IS NOT ───────────────────────────────────────────────────────────────────────────────
//
// Not a profile store (`profile-store.mjs` owns that), not a writer (it never touches the GPU), and
// not a judge — it records what the oracle said and computes what the ratchet therefore allows.
//
// Usage:
//   node automation-engine/lib/vmin-store.mjs --show            what the store knows, per point
//   node automation-engine/lib/vmin-store.mjs --selftest        the logic, sandboxed, no GPU
//
// [TESTED: 2026-08-10 20:5x · 23 selftest blocks green, seven mutations each reddening the block named
//  for it BEFORE the run (the addressee list is in §5). The suite paid for itself immediately: the
//  first draft could NOT RECORD AN UNKNOWN VERDICT at all, because UNKNOWN is null here and the
//  completeness check rejected nullish values — see REQUIRED_PRESENT_MAY_BE_NULL. That is the most
//  dangerous outcome the oracle has, and the store would have refused it.
//  NOT tested: nothing has been written to the PRODUCTION store yet — no search has run.]

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import config from '../config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

/** The production directory. Every function takes `dir` as a PARAMETER — see `openStore`. */
export const VMIN_DIR = join(ROOT, 'runs', 'vmin');

/** The file inside a store directory. One file, appended as JSON lines: a search that dies mid-way
 *  must not lose what it learned, and an append survives a kill that a rewrite would not. */
const RECORDS_FILE = 'records.jsonl';

/** A machine receipt carries the owner's local time with its offset (AGENT_GUIDE → stamps). */
function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

// =================================================================================================
// 1. The record — every field is a CONDITION the verdict is only true under
// =================================================================================================

/**
 * The fields a record must carry, and why each one is not optional:
 *
 *   point · offsetMhz            — WHAT was tried. The ratchet is computed over exactly these two.
 *   workload · shape · seconds   — under WHICH load. Vmin spreads ~100 mV between programs
 *                                  (researches/02), so a verdict without its load is not a verdict.
 *   verdict · reason             — what the ORACLE said, not whether the machine survived.
 *   driver · vbios               — rule R6. A driver update invalidates every measurement, and the
 *                                  store QUARANTINES rather than deletes: history is what explains
 *                                  how a profile got where it is.
 *   tempStartC · tempReachedC    — the curve derates with temperature (STATUS fact 18) and power
 *                                  follows the temperature a run REACHED (fact 9). A number without
 *                                  its thermal state is not comparable to any other number.
 *   servingPoint · servingMv     — WHICH curve point served the tested clock, and at what voltage.
 *                                  This is the undervolt expressed in volts rather than in MHz.
 *   at                           — the local ISO stamp.
 *
 * [NOT-TESTED]
 */
export const REQUIRED_FIELDS = Object.freeze([
  'point', 'offsetMhz', 'workload', 'shape', 'driver', 'vbios',
]);

/**
 * `at` IS NOT REQUIRED — and the first live search is what proved the earlier version wrong. It sat in
 * the required list while ALSO carrying a default, so the default was dead code and the engine crashed
 * on its very first record for want of a field the store was perfectly able to supply. The stamp of
 * the MOMENT OF RECORDING is an observation this module makes, not a value it invents, so defaulting
 * it is legitimate; demanding it from every caller was pure ceremony that cost a live run.
 */

/**
 * `verdict` IS REQUIRED BUT MAY BE `null`, and the distinction is not pedantry — it is the whole
 * reason the fourth verdict exists. In this codebase `UNKNOWN` IS `null` (event-logger and
 * stress-tester both return it that way), because a comparison that could not happen has no verdict
 * and must not be coerced into `PASS` or `SDC` (plans/02 §3.6). A completeness check written as
 * "field is not nullish" therefore REFUSES TO RECORD THE MOST DANGEROUS OUTCOME THERE IS — which is
 * exactly what the first draft of this module did, caught by its own selftest. Presence is tested by
 * the KEY, not by the value.
 *
 * [NOT-TESTED]
 */
export const REQUIRED_PRESENT_MAY_BE_NULL = Object.freeze(['verdict']);

/** Build a record, refusing to invent anything that was not supplied. [NOT-TESTED] */
export function makeRecord(fields = {}) {
  const missing = REQUIRED_FIELDS.filter((f) => fields[f] === undefined || fields[f] === null);
  const absent = REQUIRED_PRESENT_MAY_BE_NULL.filter((f) => !(f in fields));
  if (missing.length || absent.length) {
    throw new Error(`запись неполна, нет полей: ${[...missing, ...absent].join(', ')}`);
  }
  if (!Number.isInteger(fields.point) || fields.point < 0) throw new Error(`точка кривой — целое ≥ 0, дано ${fields.point}`);
  if (!Number.isFinite(fields.offsetMhz)) throw new Error(`сдвиг — число МГц, дано ${fields.offsetMhz}`);
  return {
    point: fields.point,
    offsetMhz: fields.offsetMhz,
    workload: String(fields.workload),
    shape: String(fields.shape),
    seconds: fields.seconds ?? null,
    verdict: fields.verdict,
    reason: fields.reason ?? null,
    driver: String(fields.driver),
    vbios: String(fields.vbios),
    tempStartC: fields.tempStartC ?? null,
    tempReachedC: fields.tempReachedC ?? null,
    servingPoint: fields.servingPoint ?? null,
    servingMv: fields.servingMv ?? null,
    // THE GRADED HALF OF THE ORACLE — how many computations came out wrong, not merely whether the
    // run survived. A verdict answers "did it fail"; these answer "how close is it to failing",
    // which is the question the owner asked and the one a 5 mV margin actually needs.
    launches: fields.launches ?? null,
    badElemsMax: fields.badElemsMax ?? null,
    faultRate: fields.faultRate ?? null,
    bitDistMin: fields.bitDistMin ?? null,
    opsPerSecond: fields.opsPerSecond ?? null,
    capMhz: fields.capMhz ?? null,
    at: fields.at ?? stampNow(),
  };
}

// =================================================================================================
// 2. The store — a directory, given as a parameter, never a module constant
// =================================================================================================

/**
 * Open (and create) a store.
 *
 * `dir` IS A PARAMETER on purpose, and the selftest is what forced it: a fixture written into the
 * production directory fabricates forensics, and a future session reading `runs/vmin/` cannot tell an
 * invented failure from a measured one (EXP-0025). The selftest therefore runs in a temp directory
 * and ASSERTS the production one did not grow.
 *
 * [NOT-TESTED]
 */
export function openStore({ dir = VMIN_DIR } = {}) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, RECORDS_FILE);
  return { dir, path };
}

/** Append one record. Appends, never rewrites — a killed search keeps everything it had learned.
 *  [NOT-TESTED] */
export function append(store, record) {
  const rec = makeRecord(record);
  writeFileSync(store.path, `${JSON.stringify(rec)}\n`, { encoding: 'utf8', flag: 'a' });
  return rec;
}

/** Read every record. A truncated final line means the writer was killed mid-append: it is DROPPED
 *  and COUNTED, never silently treated as absent (a partial record could otherwise vanish without
 *  anyone knowing the store is short). [NOT-TESTED] */
export function readAll(store) {
  if (!existsSync(store.path)) return { records: [], truncated: 0 };
  const lines = readFileSync(store.path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const records = [];
  let truncated = 0;
  for (const l of lines) {
    try { records.push(JSON.parse(l)); } catch { truncated++; }
  }
  return { records, truncated };
}

// =================================================================================================
// 3. R6 — a quarantine, not a delete
// =================================================================================================

/**
 * Split the store by whether a record still counts as evidence for the card in front of us.
 *
 * A driver or VBIOS change invalidates every measurement (rule R6), and the honest response is
 * neither to trust the old records nor to erase them: they are QUARANTINED — kept, marked, and
 * reported. The history is what explains how a profile reached its current shape, and deleting it
 * would leave a future session with a number and no provenance.
 *
 * [NOT-TESTED]
 */
export function partitionByStamp(records, { driver, vbios }) {
  const current = [];
  const quarantined = [];
  for (const r of records) {
    if (String(r.driver) === String(driver) && String(r.vbios) === String(vbios)) current.push(r);
    else quarantined.push(r);
  }
  return { current, quarantined };
}

// =================================================================================================
// 4. THE RATCHET — the rule that cannot be forgotten because it is a function
// =================================================================================================

/**
 * What offset a point is still allowed to take, given everything it has ever done.
 *
 * THE RULE, and it is one sentence: **never at or above the lowest offset that ever failed there.**
 * The allowance is `min(failing offsets) − fineStep`, so the search may approach the edge but can
 * never re-enter it, and a point that failed is never lowered back into that region by a later
 * session that "did not know".
 *
 * WHAT COUNTS AS A FAILURE IS THE ORACLE'S ANSWER, NOT A CRASH. Anything that is not `PASS` counts —
 * `SDC` because it is the dangerous half, `CRASH` obviously, and **`UNKNOWN` too**, because a
 * comparison that could not happen is not a pass and treating it as one is exactly how a search walks
 * past the real edge (EXP-0011: a mismatched golden once reported 58 of 58 corrupted).
 *
 * Returns `Infinity` when the point has never failed — the ratchet imposes no ceiling of its own, and
 * saying so explicitly is better than returning a made-up bound the caller would mistake for evidence.
 *
 * [NOT-TESTED]
 */
export function allowedOffset(records, point, { fineStepMhz = FINE_STEP_MHZ } = {}) {
  const failures = records
    .filter((r) => r.point === point && r.verdict !== config.VERDICT.PASS)
    .map((r) => r.offsetMhz)
    .filter((v) => Number.isFinite(v));
  if (!failures.length) return { limitMhz: Infinity, bound: false, lowestFailure: null, failures: 0 };
  const lowestFailure = Math.min(...failures);
  return {
    limitMhz: lowestFailure - fineStepMhz,
    bound: true,
    lowestFailure,
    failures: failures.length,
  };
}

/** The fine step — one MEASURED curve spacing, and the owner's own fine mode. Imported through
 *  `vf-step`'s constant rather than re-typed, so the two cannot drift apart. */
export const FINE_STEP_MHZ = 15;

/** Is this offset allowed at this point right now? A thin wrapper, but it is the one every caller
 *  should use — the comparison direction is exactly where an off-by-one becomes a card at the edge.
 *  [NOT-TESTED] */
export function isAllowed(records, point, offsetMhz, opts = {}) {
  const a = allowedOffset(records, point, opts);
  return { ok: offsetMhz <= a.limitMhz, ...a };
}

/** The best offset a point ever PASSED at, which is what a profile is assembled from. [NOT-TESTED] */
export function bestPassing(records, point) {
  const passes = records
    .filter((r) => r.point === point && r.verdict === config.VERDICT.PASS)
    .map((r) => r.offsetMhz)
    .filter((v) => Number.isFinite(v));
  return passes.length ? Math.max(...passes) : null;
}

/**
 * A point's whole story in one object — what the search needs to decide its next move.
 *
 * `worstShape` answers the question §4.3 asks: a point's threshold is the WORST verdict across the
 * diverse set, never the first one found, so the store must be able to say WHICH load broke it.
 *
 * [NOT-TESTED]
 */
export function summarizePoint(records, point, opts = {}) {
  const mine = records.filter((r) => r.point === point);
  const ratchet = allowedOffset(records, point, opts);
  const failures = mine.filter((r) => r.verdict !== config.VERDICT.PASS);
  const worst = failures.length
    ? failures.reduce((lo, r) => (r.offsetMhz < lo.offsetMhz ? r : lo))
    : null;
  return {
    point,
    attempts: mine.length,
    bestPassingMhz: bestPassing(records, point),
    ratchet,
    worstShape: worst ? { shape: worst.shape, workload: worst.workload, offsetMhz: worst.offsetMhz, verdict: worst.verdict } : null,
    shapesTried: [...new Set(mine.map((r) => `${r.workload}/${r.shape}`))].sort(),
  };
}

// =================================================================================================
// 5. Selftest — sandboxed, and it PROVES it did not touch production
// =================================================================================================

/**
 * MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016). Break one guarantee at a time and exactly the
 * named block must redden:
 *   1. count only CRASH as a failure (ignore SDC)      → «SDC — это отказ, а не «не упало»»
 *   2. treat UNKNOWN as a pass                          → «НЕИЗВЕСТНО тоже запрещает сдвиг»
 *   3. allow the failing offset itself (`<=` → `<`)     → «сам сбойнувший сдвиг запрещён, а не только выше него»
 *   4. take max instead of min of the failures          → «храповик встаёт на САМЫЙ НИЗКИЙ отказ»
 *   5. drop the stamp partition (R6)                    → «чужой драйвер уходит в карантин, а не в доказательства»
 *   6. return 0 instead of Infinity when never failed   → «точка без отказов ничем не ограничена»
 *   7. silently skip a truncated line                   → «оборванная строка сосчитана, а не проглочена»
 */
export function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  const base = { workload: 'sdc_fma', shape: 'sustained', driver: '610.88', vbios: 'v1', at: '2026-08-10T20:00:00+03:00' };
  const rec = (point, offsetMhz, verdict, over = {}) => makeRecord({ ...base, point, offsetMhz, verdict, ...over });

  // --- the record refuses to invent
  let threw = false;
  try { makeRecord({ point: 95, offsetMhz: 15 }); } catch { threw = true; }
  ok('неполная запись — отказ, а не заполнение по умолчанию', threw, true);
  let threwPoint = false;
  try { makeRecord({ ...base, point: -1, offsetMhz: 15, verdict: 'PASS' }); } catch { threwPoint = true; }
  ok('отрицательная точка — отказ', threwPoint, true);
  ok('условия замера попадают в запись', Object.keys(rec(95, 15, 'PASS')).includes('tempStartC'), true);

  // --- the ratchet
  const hist = [
    rec(95, 15, config.VERDICT.PASS),
    rec(95, 75, config.VERDICT.PASS),
    rec(95, 150, config.VERDICT.SDC),
    rec(95, 180, config.VERDICT.CRASH),
  ];
  const r95 = allowedOffset(hist, 95);
  ok('храповик встаёт на САМЫЙ НИЗКИЙ отказ', r95.lowestFailure, 150);
  ok('разрешено строго ниже отказа на один точный шаг', r95.limitMhz, 135);
  ok('SDC — это отказ, а не «не упало»', allowedOffset([rec(95, 150, config.VERDICT.SDC)], 95).bound, true);
  ok('НЕИЗВЕСТНО тоже запрещает сдвиг', allowedOffset([rec(95, 150, null)], 95).lowestFailure, 150);
  ok('сам сбойнувший сдвиг запрещён, а не только выше него', isAllowed(hist, 95, 150).ok, false);
  ok('на один точный шаг ниже отказа — разрешено', isAllowed(hist, 95, 135).ok, true);
  ok('точка без отказов ничем не ограничена', allowedOffset(hist, 42).limitMhz, Infinity);
  ok('лучший пройденный сдвиг — максимум из PASS, а не последний', bestPassing(hist, 95), 75);
  ok('точка без PASS не выдаёт ноль', bestPassing(hist, 42), null);

  // --- the worst shape is what a point's threshold is made of (§4.3)
  const mixed = [
    rec(95, 150, config.VERDICT.PASS, { workload: 'branchy' }),
    rec(95, 120, config.VERDICT.SDC, { workload: 'sdc_fma', shape: 'transient' }),
  ];
  const s = summarizePoint(mixed, 95);
  ok('порог точки называет ХУДШУЮ нагрузку, а не первую найденную', s.worstShape.offsetMhz, 120);
  ok('и называет её форму', s.worstShape.shape, 'transient');
  ok('перечислены все опробованные формы', s.shapesTried, ['branchy/sustained', 'sdc_fma/transient']);

  // --- R6 quarantine
  const across = [rec(95, 15, config.VERDICT.PASS), rec(95, 150, config.VERDICT.SDC, { driver: '611.00' })];
  const part = partitionByStamp(across, { driver: '610.88', vbios: 'v1' });
  ok('чужой драйвер уходит в карантин, а не в доказательства', part.current.length, 1);
  ok('карантин НЕ удаляется — история остаётся', part.quarantined.length, 1);
  ok('храповик считается по текущим записям, а не по карантинным',
    allowedOffset(part.current, 95).bound, false);

  // --- persistence, in a SANDBOX, and production must not grow (EXP-0025)
  const prodBefore = existsSync(VMIN_DIR) ? readdirSync(VMIN_DIR).length : 0;
  const sandbox = mkdtempSync(join(tmpdir(), 'kago-vmin-'));
  try {
    const store = openStore({ dir: sandbox });
    append(store, { ...base, point: 95, offsetMhz: 15, verdict: config.VERDICT.PASS });
    append(store, { ...base, point: 95, offsetMhz: 150, verdict: config.VERDICT.SDC });
    const back = readAll(store);
    ok('записи переживают запись и чтение', back.records.length, 2);
    ok('храповик восстанавливается из файла, а не из памяти процесса',
      allowedOffset(back.records, 95).limitMhz, 135);

    // a killed writer leaves half a line
    writeFileSync(store.path, '{"point":95,"offsetM', { encoding: 'utf8', flag: 'a' });
    const cut = readAll(store);
    ok('оборванная строка сосчитана, а не проглочена', cut.truncated, 1);
    ok('и целые записи при этом уцелели', cut.records.length, 2);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  const prodAfter = existsSync(VMIN_DIR) ? readdirSync(VMIN_DIR).length : 0;
  ok('ПРОДАКШЕН НЕ ВЫРОС: самопроверка не подбросила улик в runs/vmin', prodAfter, prodBefore);

  return { ok: results.every((r) => r.ok), results };
}

// =================================================================================================
// 6. CLI
// =================================================================================================

function main(argv) {
  if (argv.includes('--selftest')) {
    const r = selfTest();
    for (const x of r.results) {
      console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok ? '' : `  -> получено ${JSON.stringify(x.got)}, ждали ${JSON.stringify(x.want)}`}`);
    }
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА: есть расхождения.');
    return r.ok ? 0 : 1;
  }

  if (argv.includes('--show')) {
    const store = openStore();
    const { records, truncated } = readAll(store);
    if (!records.length) {
      console.log('ХРАНИЛИЩЕ ПУСТО — ни одной попытки ещё не записано.');
      console.log(`Файл: ${store.path}`);
      return 0;
    }
    console.log(`ЗАПИСЕЙ: ${records.length}${truncated ? ` · оборванных строк: ${truncated}` : ''}`);
    const points = [...new Set(records.map((r) => r.point))].sort((a, b) => a - b);
    console.log('');
    console.log('  точка | попыток | лучший PASS | храповик разрешает | худшая форма');
    for (const p of points) {
      const s = summarizePoint(records, p);
      const limit = s.ratchet.limitMhz === Infinity ? 'без ограничения' : `≤ ${s.ratchet.limitMhz} МГц`;
      const worst = s.worstShape ? `${s.worstShape.workload}/${s.worstShape.shape} @ ${s.worstShape.offsetMhz} (${s.worstShape.verdict ?? 'НЕИЗВЕСТНО'})` : '—';
      console.log(`  ${String(p).padStart(5)} | ${String(s.attempts).padStart(7)} | ${String(s.bestPassingMhz ?? '—').padStart(11)} | ${limit.padStart(18)} | ${worst}`);
    }
    return 0;
  }

  console.error('ОШИБКА: нужен один из режимов — --show или --selftest');
  return 2;
}

// A module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
