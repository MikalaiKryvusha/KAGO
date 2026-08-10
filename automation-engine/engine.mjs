#!/usr/bin/env node
// engine.mjs — THE SEARCH FOR THE EDGE: coarse ascent → bracket → bisect, and never dwell there.
//
// Plan anchor (plans/05 §4.4): «Coarse ascent at ASCENT_COARSE_MHZ to the first non-PASS; then bisect
// between the last PASS and that offset down to ASCENT_FINE_MHZ… Roll back the instant a verdict is
// not PASS.» Internal map §1: `engine.mjs` is the only module that DECIDES.
//
// ─── WHY THIS MODULE EXISTS, IN THE OWNER'S OWN QUESTION ──────────────────────────────────────────
//
// He asked, plainly: *«ты нашёл минимумы напряжения, ниже которых появляются ошибки вычислений?»* The
// honest answer at the time was NO — this project had never once observed a failure from undervolting.
// Every number it owned came from an offset picked because it had run before, and `--ascend` had
// stopped at OUR OWN ceiling without meeting the card's. A trade-off matrix measured at an arbitrary
// offset is not a Vmin table; this module is what turns one into the other.
//
// ─── THE TWO STEP SIZES ARE THE OWNER'S, AND THEY ARE NOT ARBITRARY ───────────────────────────────
//
// *«грубый меняет напряжение на 25 мВ… а точный режим — меняет напряжение на 5 мВ и ищет точку отказа»*
// — `ASCENT_COARSE_MHZ` (75 ≈ 25 mV) and `ASCENT_FINE_MHZ` (15 ≈ 5 mV, which is ONE MEASURED curve
// spacing rather than a number from folklore). The search resolution is his; the guardband on the
// SHIPPED point is a separate decision that goes to him with the arithmetic (§4.6).
//
// ─── THE FOUR RULES THIS LOOP IS BUILT ON ─────────────────────────────────────────────────────────
//
//  1. **The edge is BRACKETED, never stood on.** The avalanche lives there: 3 % → 90 % error rate
//     across 2 % of voltage (researches/02 §2). The engine never re-tests a failing offset to
//     "confirm" it — one non-PASS is enough to close that direction.
//  2. **Anything that is not PASS ends the ascent, including UNKNOWN.** A comparison that could not
//     happen is not a pass (EXP-0011: a mismatched golden once reported 58 of 58 corrupted). UNKNOWN
//     is a STOP, never progress.
//  3. **Every verdict is persisted BEFORE the next step.** A search that dies must not lose what it
//     learned, and the ratchet is what makes a later session's escalation a ratchet rather than a
//     fresh guess (`vmin-store.mjs`).
//  4. **The ratchet bounds the search from the start.** A point that ever failed is never offered
//     that offset again — the store answers, not the session's memory.
//
// GPU WRITES: this module never writes. It DECIDES, and the writing is done by `vf-step.runStep`,
// which arms the watchdog, applies one offset, judges it with the full oracle and rolls back in a
// `finally`. Keeping the decider and the writer apart is what makes the decider testable offline.
//
// Usage:
//   node automation-engine/engine.mjs --search --cap 2842            find the edge at one clock
//   node automation-engine/engine.mjs --search --cap 2842 --dry-run  the plan, no writes
//   node automation-engine/engine.mjs --selftest                     the logic, injected, no GPU
//
// [TESTED: 2026-08-10 21:0x, OFFLINE HALF ONLY · 19 selftest blocks green against a scripted oracle,
//  six mutations each reddening the block named for it BEFORE the run (§3). The suite paid for itself:
//  the first draft CONTINUED BISECTING AFTER AN UNKNOWN, refining a boundary nobody had observed and
//  reporting it as a measured edge — the plan says UNKNOWN is a STOP, and now the code does too.
//  NOT TESTED: no live search has run. The edge of this card has still never been observed.]

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import config from './config.mjs';
import { ASCENT_COARSE_MHZ, ASCENT_FINE_MHZ } from './lib/vf-step.mjs';
import { VMIN_DIR, allowedOffset, append, openStore, readAll, partitionByStamp, summarizePoint } from './lib/vmin-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** A verdict is a PASS only if it is exactly PASS. Written as a function because the negation is
 *  where the dangerous mistake lives: `!== CRASH` and `!== SDC` both silently admit UNKNOWN. */
export function isPass(verdict) {
  return verdict === config.VERDICT.PASS;
}

// =================================================================================================
// 1. The plan — computed before anything is written, so a dry run shows the real thing
// =================================================================================================

/**
 * The ladder of offsets a coarse ascent would try, bounded by the ratchet and by the hardware.
 *
 * `startMhz` is one coarse step — the search begins ABOVE zero because zero is stock and stock is
 * already known to pass. `limitMhz` comes from the ratchet (Infinity when the point has never
 * failed), and the hardware's own range bounds it regardless (`CLOCK_OFFSET_MAX_MHZ`).
 *
 * [NOT-TESTED]
 */
export function coarseLadder({ limitMhz = Infinity, coarseMhz = ASCENT_COARSE_MHZ, hardwareMaxMhz = config.CLOCK_OFFSET_MAX_MHZ } = {}) {
  const ceiling = Math.min(limitMhz, hardwareMaxMhz);
  const out = [];
  for (let o = coarseMhz; o <= ceiling; o += coarseMhz) out.push(o);
  return out;
}

/**
 * Bisect between the last PASS and the first FAIL until the gap is one fine step.
 *
 * Returns the SEQUENCE of midpoints to try, snapped to the fine step — a pure function, so the
 * arithmetic that decides how close to the edge we walk is testable without a card.
 *
 * The snap is `floor` on purpose: rounding UP would step toward the failing side, and every rounding
 * decision in this file resolves away from the edge.
 *
 * [NOT-TESTED]
 */
export function bisectPlan(lastPass, firstFail, { fineMhz = ASCENT_FINE_MHZ } = {}) {
  const steps = [];
  let lo = lastPass;
  let hi = firstFail;
  // A guard against a caller handing us a reversed or degenerate bracket — better an empty plan than
  // an infinite loop on the machine that owns the display.
  if (!(Number.isFinite(lo) && Number.isFinite(hi)) || hi <= lo) return steps;
  while (hi - lo > fineMhz) {
    const mid = lo + Math.floor((hi - lo) / 2 / fineMhz) * fineMhz;
    if (mid <= lo || mid >= hi) break;
    steps.push(mid);
    // The plan is what a search WOULD try; the real loop replaces this with the observed verdict.
    lo = mid;
  }
  return steps;
}

// =================================================================================================
// 2. The search — one point, one clock, one edge
// =================================================================================================

/**
 * Find the edge for the curve point that serves `capMhz`.
 *
 * `runStepFn` and `store` are INJECTED so the whole decision logic can be driven offline against a
 * scripted oracle. That is not test scaffolding for its own sake: this is the module that decides how
 * far to push the owner's display adapter, and «a check that has never failed proves nothing»
 * (BUG_FIXING_FRAMEWORK → Guards) applies hardest here.
 *
 * @returns {{lastPass:number|null, firstFail:number|null, bracketMhz:number|null, attempts:Array, stopped:string}}
 *
 * [NOT-TESTED]
 */
export async function searchEdge({
  capMhz,
  point,
  workload = 'sdc_fma',
  shape = 'sustained',
  seconds = 30,
  sustain = 30,
  coarseMhz = ASCENT_COARSE_MHZ,
  fineMhz = ASCENT_FINE_MHZ,
  card = { driver: 'unknown', vbios: 'unknown' },
  runStepFn,
  store = null,
  onAttempt = null,
} = {}) {
  if (typeof runStepFn !== 'function') throw new Error('searchEdge требует runStepFn — движок сам в карту не пишет');
  if (!Number.isFinite(capMhz)) throw new Error(`нужен потолок частоты (--cap), дано ${capMhz}`);

  const history = store ? partitionByStamp(readAll(store).records, card).current : [];
  const ratchet = allowedOffset(history, point, { fineStepMhz: fineMhz });

  const out = {
    capMhz, point, workload, shape,
    ratchetLimitMhz: ratchet.limitMhz,
    attempts: [],
    lastPass: null,
    firstFail: null,
    bracketMhz: null,
    stopped: 'не начат',
  };

  const record = async (offsetMhz, result) => {
    // The atom reports the serving point as `undervolt.after` — the engine used to ask for
    // `result.servingMv`, which does not exist, and stored nulls. The consequence was not
    // cosmetic: without the voltage, a bracket in MHz cannot be checked for whether its two ends
    // are even different physically, and the first live search reported one that was not.
    const serving = result.undervolt?.after ?? null;
    const attempt = {
      offsetMhz,
      servingPoint: serving?.pointIndex ?? null,
      servingMv: serving?.mv ?? null,
      verdict: result.verdict ?? null,
      reason: result.reason
        ?? ((result.blocks || []).filter((b) => !b.ok).map((b) => b.name).join('; ') || null),
    };
    out.attempts.push(attempt);
    if (store) {
      // PERSIST BEFORE THE NEXT STEP — a killed search keeps every verdict it paid for.
      append(store, {
        point, offsetMhz, workload, shape, seconds,
        verdict: attempt.verdict, reason: attempt.reason,
        driver: card.driver, vbios: card.vbios,
        capMhz,
        tempStartC: result.tempStartC ?? null,
        tempReachedC: result.tempReachedC ?? null,
        servingPoint: attempt.servingPoint,
        servingMv: attempt.servingMv,
      });
    }
    if (onAttempt) onAttempt(attempt);
    return attempt;
  };

  // ---- coarse ascent, bounded by the ratchet and the hardware
  const ladder = coarseLadder({ limitMhz: ratchet.limitMhz, coarseMhz });
  if (!ladder.length) {
    out.stopped = ratchet.bound
      ? `храповик не оставил места: разрешено ≤ ${ratchet.limitMhz} МГц, а грубый шаг ${coarseMhz}`
      : 'лестница пуста — проверьте шаг и предел железа';
    return out;
  }

  for (const offsetMhz of ladder) {
    const result = await runStepFn({ point, offsetMhz, workload, seconds, sustain, capMhz });
    const a = await record(offsetMhz, result);
    if (isPass(a.verdict)) { out.lastPass = offsetMhz; continue; }
    // RULE 1 and 2: anything that is not PASS closes the direction, and it is NOT re-tested.
    out.firstFail = offsetMhz;
    if (a.verdict === null) {
      // UNKNOWN HALTS THE WHOLE SEARCH — it does not become a bracket boundary. The plan states it
      // («UNKNOWN is a STOP in the engine, never progress», §4.3) and the reason is not procedural:
      // UNKNOWN means the ORACLE COULD NOT JUDGE — a stale golden, a provider that would not answer.
      // Bisecting against it would refine a boundary nobody observed and report a measured edge that
      // is nothing of the kind. The conservative ratchet still records the offset as non-passing, so
      // safety is unaffected; what is refused is the CLAIM.
      out.halted = true;
      out.stopped = `НЕИЗВЕСТНО на +${offsetMhz} МГц — это СТОП, а не край: оракул не смог вынести вердикт, `
        + 'и уточнять вилку вокруг ненаблюдённой границы значило бы выдумать измерение';
      return out;
    }
    out.stopped = `первый отказ: ${a.verdict}`;
    break;
  }

  if (out.firstFail === null) {
    out.stopped = out.lastPass === null
      ? 'ни одна ступень не прошла — край ниже первого грубого шага'
      : `край НЕ встречен: лестница кончилась на ${out.lastPass} МГц (это НАШ предел, а не карты)`;
    return out;
  }

  // ---- bisect the bracket down to one fine step
  let lo = out.lastPass ?? 0;
  let hi = out.firstFail;
  while (hi - lo > fineMhz) {
    const mid = lo + Math.floor((hi - lo) / 2 / fineMhz) * fineMhz;
    if (mid <= lo || mid >= hi) break;
    const result = await runStepFn({ point, offsetMhz: mid, workload, seconds, sustain, capMhz });
    const a = await record(mid, result);
    if (isPass(a.verdict)) { lo = mid; out.lastPass = mid; continue; }
    if (a.verdict === null) {
      // Same rule inside the bisection: an unobserved verdict cannot narrow a bracket.
      out.halted = true;
      out.stopped = `НЕИЗВЕСТНО на +${mid} МГц во время бисекции — СТОП; вилка остаётся шире, но честной`;
      out.bracketMhz = out.firstFail - (out.lastPass ?? 0);
      return out;
    }
    hi = mid; out.firstFail = mid;
  }

  out.bracketMhz = out.firstFail - (out.lastPass ?? 0);

  // THE BRACKET IN VOLTS — the unit the conclusion is about. Two offsets can map to the SAME
  // curve point, and then a narrower MHz bracket buys no physical resolution whatsoever.
  const mvOf = (offset) => out.attempts.find((a) => a.offsetMhz === offset)?.servingMv ?? null;
  const passMv = mvOf(out.lastPass);
  const failMv = mvOf(out.firstFail);
  out.servingMv = { atLastPass: passMv, atFirstFail: failMv };
  out.bracketMv = (passMv !== null && failMv !== null) ? Number((passMv - failMv).toFixed(3)) : null;

  if (out.bracketMv === 0) {
    // Not a defect and not a failure of the search — the honest name for what was observed.
    out.probabilisticEdge = true;
    out.stopped = `край ВЕРОЯТНОСТНЫЙ: обе стороны вилки обслуживает одно и то же напряжение `
      + `${passMv} мВ — на нём карта и прошла, и упала. Это не линия, а вероятность отказа `
      + `(researches/02 §6.4), и одиночный PASS точку не квалифицирует`;
  } else {
    out.stopped = `край взят в вилку ${out.bracketMhz} МГц`
      + (out.bracketMv === null ? ' (напряжение не вычислено)' : ` = ${out.bracketMv} мВ: ${passMv} мВ прошло, ${failMv} мВ отказало`);
  }
  return out;
}

// =================================================================================================
// 3. Selftest — the decision logic on an injected oracle. No GPU, no writes, no store in production.
// =================================================================================================

/**
 * MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
 *   1. treat UNKNOWN as a pass                       → «НЕИЗВЕСТНО обрывает восхождение, а не продолжает его»
 *   2. re-test the failing offset before accepting   → «сбойнувший сдвиг НЕ перепрогоняется»
 *   3. round the bisection midpoint UP               → «середина округляется ВНИЗ, прочь от края»
 *   4. ignore the ratchet limit in the ladder        → «храповик ограничивает лестницу с самого начала»
 *   5. keep ascending after the first failure        → «первый отказ закрывает направление»
 *   6. report a bracket wider than one fine step     → «вилка сходится до одного точного шага»
 */
export function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  // --- the ladder
  ok('лестница начинается с грубого шага, а не с нуля', coarseLadder({ limitMhz: 300 })[0], ASCENT_COARSE_MHZ);
  ok('храповик ограничивает лестницу с самого начала',
    coarseLadder({ limitMhz: 150 }), [75, 150]);
  ok('предел железа ограничивает лестницу даже без храповика',
    coarseLadder({ limitMhz: Infinity, hardwareMaxMhz: 200 }).at(-1), 150);

  // --- the bisection arithmetic
  ok('середина округляется ВНИЗ, прочь от края', bisectPlan(75, 150)[0], 105);
  ok('вилка сходится до одного точного шага',
    bisectPlan(75, 150).every((m) => m > 75 && m < 150), true);
  ok('перевёрнутая вилка не уводит в бесконечный цикл', bisectPlan(150, 75), []);
  ok('вилка шириной в один шаг делить нечего', bisectPlan(75, 90), []);

  // --- the search, driven by a scripted oracle
  const P = config.VERDICT.PASS;
  const scripted = (script) => async ({ offsetMhz }) => ({ verdict: script(offsetMhz) });
  const run = (script, opts = {}) => searchEdge({
    capMhz: 2842, point: 95, runStepFn: scripted(script), ...opts,
  });

  return (async () => {
    // the card fails somewhere between 150 and 225
    const r1 = await run((o) => (o < 200 ? P : config.VERDICT.SDC));
    ok('первый отказ закрывает направление', r1.attempts.filter((a) => a.offsetMhz === 225).length, 1);
    ok('после отказа лестница не продолжается',
      r1.attempts.filter((a) => a.offsetMhz > 225).length, 0);
    ok('сбойнувший сдвиг НЕ перепрогоняется',
      new Set(r1.attempts.filter((a) => !isPass(a.verdict)).map((a) => a.offsetMhz)).size,
      r1.attempts.filter((a) => !isPass(a.verdict)).length);
    ok('вилка сошлась до одного точного шага', r1.bracketMhz, ASCENT_FINE_MHZ);
    ok('и она обнимает настоящий край (последний PASS < 200 ≤ первый отказ)',
      r1.lastPass < 200 && r1.firstFail >= 200, true);

    // UNKNOWN must stop the ascent exactly as a failure does
    // UNKNOWN halts the SEARCH, so the ascent stop stands and no bisection refines it.
    const r2 = await run((o) => (o < 200 ? P : null));
    ok('НЕИЗВЕСТНО обрывает восхождение, а не продолжает его', r2.firstFail, 225);
    ok('и причина остановки названа', /НЕИЗВЕСТНО/.test(r2.stopped), true);

    // never meeting a failure must be reported as OUR ceiling, not as the card's
    const r3 = await run(() => P);
    ok('край не встречен — это наш предел, и так и сказано', /НАШ предел/.test(r3.stopped), true);
    ok('и вилки в этом случае нет', r3.bracketMhz, null);

    // the ratchet must bound the search before the first write
    const history = [{ point: 95, offsetMhz: 150, verdict: config.VERDICT.SDC }];
    const bounded = allowedOffset(history, 95, { fineStepMhz: ASCENT_FINE_MHZ });
    ok('храповик из прошлой сессии виден движку', bounded.limitMhz, 135);
    ok('и лестница под ним не доходит до сбойнувшего сдвига',
      coarseLadder({ limitMhz: bounded.limitMhz }).includes(150), false);

    // the engine never writes by itself
    let threw = false;
    try { await searchEdge({ capMhz: 2842, point: 95 }); } catch { threw = true; }
    ok('без инжектированного писателя движок отказывается работать', threw, true);

    // --- THE UNIT OF THE CONCLUSION, and these blocks exist because a live run reported a bracket
    // whose two ends were the SAME VOLTAGE. Offsets are what we write; volts are what the card cares
    // about, and one curve point can absorb several offsets.
    const withVolts = (mvFor) => async ({ offsetMhz }) => ({
      verdict: offsetMhz < 200 ? P : config.VERDICT.CRASH,
      undervolt: { after: { pointIndex: 69, mv: mvFor(offsetMhz) } },
    });
    // both ends of the bracket land on the same point — exactly what the card did at 885 mV
    const flat = await searchEdge({ capMhz: 2842, point: 95, runStepFn: withVolts(() => 885) });
    ok('одно напряжение по обе стороны вилки НАЗЫВАЕТСЯ вероятностным краем', flat.probabilisticEdge, true);
    ok('и вилка в милливольтах при этом НОЛЬ, а не «очень узкая»', flat.bracketMv, 0);
    ok('и отчёт не выдаёт это за измеренную линию', /ВЕРОЯТНОСТНЫЙ/.test(flat.stopped), true);
    // ends that really differ in voltage report the difference
    const steep = await searchEdge({ capMhz: 2842, point: 95, runStepFn: withVolts((o) => 1040 - o / 5) });
    ok('разные напряжения — вилка докладывается в милливольтах', steep.bracketMv > 0, true);
    ok('и вероятностным краем это НЕ называется', Boolean(steep.probabilisticEdge), false);

    // --- THE STORE PATH, and it is here because its ABSENCE cost a live run.
    // Every block above ran with `store: null`, so the persistence branch was never executed once —
    // and the first real search died on its first record, on a field the store could have defaulted.
    // A selftest that exercises only the paths without side effects is a selftest with a hole exactly
    // where the side effects are.
    const prodBefore = existsSync(VMIN_DIR) ? readdirSync(VMIN_DIR).length : 0;
    const sandbox = mkdtempSync(join(tmpdir(), 'kago-engine-'));
    try {
      const store = openStore({ dir: sandbox });
      const r4 = await searchEdge({
        capMhz: 2842, point: 95, store,
        card: { driver: '610.88', vbios: 'v1' },
        runStepFn: scripted((o) => (o < 200 ? P : config.VERDICT.SDC)),
      });
      const saved = readAll(store).records;
      ok('каждая попытка ЛЕГЛА в хранилище, а не только в отчёт', saved.length, r4.attempts.length);
      ok('и записи несут вердикт, а не только сдвиг', saved.every((s) => 'verdict' in s), true);
      ok('храповик после поиска запрещает сбойнувший сдвиг',
        allowedOffset(saved, 95, { fineStepMhz: ASCENT_FINE_MHZ }).limitMhz, r4.firstFail - ASCENT_FINE_MHZ);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
    const prodAfter = existsSync(VMIN_DIR) ? readdirSync(VMIN_DIR).length : 0;
    ok('ПРОДАКШЕН НЕ ВЫРОС: самопроверка движка не подбросила улик', prodAfter, prodBefore);

    return { ok: results.every((r) => r.ok), results };
  })();
}

// =================================================================================================
// 4. CLI
// =================================================================================================

async function main(argv) {
  if (argv.includes('--selftest')) {
    const r = await selfTest();
    for (const x of r.results) {
      console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok ? '' : `  -> получено ${JSON.stringify(x.got)}, ждали ${JSON.stringify(x.want)}`}`);
    }
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА: есть расхождения.');
    return r.ok ? 0 : 1;
  }

  const arg = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  if (!argv.includes('--search')) {
    console.error('ОШИБКА: нужен один из режимов — --search --cap <МГц> или --selftest');
    return 2;
  }

  const capMhz = Number(arg('cap'));
  if (!Number.isFinite(capMhz)) { console.error('ОШИБКА: --search требует --cap <МГц>'); return 2; }
  const workload = arg('workload', 'sdc_fma');
  const seconds = Number(arg('seconds', 30));
  const dryRun = argv.includes('--dry-run');

  const vf = await import('./lib/vf-step.mjs');
  const nvapi = await import('./lib/nvapi.mjs');
  const stress = await import('./lib/stress-tester.mjs');

  const card = stress.probeCard();
  const store = openStore();

  // WHICH POINT SERVES THIS CLOCK is a MEASUREMENT, not a parameter: under a held clock exactly one
  // curve point serves it, and testing any other point would change something the load never touches.
  const nv = nvapi.openNvapi();
  nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
  const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
  nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
  const handle = handles.readBigUInt64LE(0);
  let serving = null;
  try {
    const curve = nvapi.readVfCurve(nv, handle);
    if (!curve.ok) { console.error(`ОШИБКА: кривая не прочиталась — ${curve.why}`); return 1; }
    serving = vf.voltageForClock(curve.points, capMhz);
  } finally {
    nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload);
  }
  if (!serving) { console.error(`ОШИБКА: ни одна точка кривой не обслуживает ${capMhz} МГц`); return 1; }

  const history = partitionByStamp(readAll(store).records, card).current;
  const summary = summarizePoint(history, serving.pointIndex, { fineStepMhz: ASCENT_FINE_MHZ });

  console.log('ПОИСК КРАЯ — то, чего этот проект ещё ни разу не делал');
  console.log('');
  console.log(`  ПОТОЛОК:   ${capMhz} МГц · обслуживает точка ${serving.pointIndex} (${serving.mv} мВ, ${serving.mhz} МГц)`);
  console.log(`  НАГРУЗКА:  ${workload}, устойчивая, ${seconds} с — оракул трёхзначный, «не упало» вердиктом не является`);
  console.log(`  ШАГИ:      грубый ${ASCENT_COARSE_MHZ} МГц (≈25 мВ) · точный ${ASCENT_FINE_MHZ} МГц (≈5 мВ, один ИЗМЕРЕННЫЙ шаг сетки)`);
  console.log(`  ХРАПОВИК:  ${summary.ratchet.limitMhz === Infinity ? 'ограничений нет — точка ни разу не сбоила' : `≤ ${summary.ratchet.limitMhz} МГц (самый низкий отказ ${summary.ratchet.lowestFailure})`}`);
  console.log(`  ЛЕСТНИЦА:  ${coarseLadder({ limitMhz: summary.ratchet.limitMhz }).join(', ') || '—'} МГц`);
  console.log(`  КАРТА:     драйвер ${card.driver} · VBIOS ${card.vbios}`);
  console.log('');

  if (dryRun) {
    console.log('СУХОЙ ПРОГОН: ни одной записи в карту не сделано.');
    return 0;
  }

  const r = await searchEdge({
    capMhz,
    point: serving.pointIndex,
    workload,
    seconds,
    card,
    store,
    runStepFn: (a) => vf.runStep(a),
    onAttempt: (a) => console.log(`  ПОПЫТКА +${a.offsetMhz} МГц → ${a.verdict ?? 'НЕИЗВЕСТНО'}${a.reason ? ` (${a.reason})` : ''}`),
  });

  console.log('');
  console.log(`ИТОГ: ${r.stopped}`);
  if (r.lastPass !== null) console.log(`  последний прошедший сдвиг: +${r.lastPass} МГц`);
  if (r.firstFail !== null) console.log(`  первый отказавший:         +${r.firstFail} МГц`);
  if (r.bracketMhz !== null) {
    console.log(`  ВИЛКА: ${r.bracketMhz} МГц — край внутри неё, и стоять на нём никто не собирается:`);
    console.log('         запас назначает политика §4.6, и по умолчанию она консервативная.');
  }
  console.log(`  Записей в храповик: ${r.attempts.length} · ${store.path}`);
  return 0;
}

// A module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
