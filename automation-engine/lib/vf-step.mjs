#!/usr/bin/env node
// vf-step.mjs — ONE POINT, ONE STEP UP, ONE VERDICT, ONE ROLLBACK.
//
// This is the ATOM of phase 5's search engine, built and proved on its own before anything loops over
// it. `researches/02` §3 Step 1 describes exactly this operation and nothing more:
//
//   «For each voltage point on the curve, walk the frequency up (or the voltage down) in single grid
//    steps, and at each step run a short express test whose output is compared to the golden reference.»
//
// ─── WHY A POSITIVE OFFSET IS THE UNDERVOLT, SAID ONCE SO NOBODY RE-DERIVES IT ────────────────────
//
// The API applies a FREQUENCY offset to a VOLTAGE POINT. Raising point P by +15 MHz says "at this
// voltage the card may now run 15 MHz faster", which is the same statement as "that frequency now
// needs less voltage". That is the undervolt, expressed in the units this API accepts — and it is why
// everything before this file moved only DOWNWARD: down is the direction that cannot destabilize.
// This is the first operation in the project that can take the display down.
//
// ─── WHICH POINT, AND WHY IT IS NOT A QUESTION FOR THE OWNER ──────────────────────────────────────
//
// Measured, not chosen by taste: under sustained load this card sits around 2842 MHz (phase 2 §4.5),
// and point 95 (1045 mV) is the curve point serving that region. A step applied anywhere else would
// not be exercised by the load, and a test that does not touch what it changes proves nothing.
//
// ONE CLAIM HERE WAS OVERSTATED AND IS CORRECTED, because the correction matters more than the point:
// an earlier version of this header said point 95 reads "2842.0 MHz — the operating point EXACTLY".
// It read that at ONE moment. THE CURVE DERATES WITH TEMPERATURE — measured the same day, the same
// point reads 2835 at 53 °C and 2820 at 65 °C. So "exactly" was an artefact of the thermal state the
// reading was taken in, and every curve number in this project inherits that condition (EXP-0011).
// The point choice survives the correction; the false precision does not.
//
// ─── THE SAFETY SHAPE ─────────────────────────────────────────────────────────────────────────────
//
//  1. PREFLIGHT — a stale watchdog record means a previous run died holding the card: reset first.
//     The card must start clean, and this refuses to run if it does not.
//  2. THE WATCHDOG IS ARMED BEFORE THE WRITE, and its lease is renewed from inside the load loop, so a
//     hang during the test is answered by a separate process (rule R9).
//  3. THE STEP IS SMALL BY MEASUREMENT, not by feel: +15 MHz on 2842 is 0.5 % of frequency, about one
//     5 mV grid step of voltage out of ~1045 mV. The vendor guardband being reclaimed is 9–23 %
//     (`researches/02` §2), so a single step sits deep inside it. The avalanche `researches/02` warns
//     about lives at the EDGE; this is nowhere near it, and the search that walks toward it is a later
//     job that this atom is the unit of.
//  4. THE ORACLE IS THE FULL ONE — checksum against the golden AND the Windows fault log AND
//     throughput. "It didn't crash" is not a result (`researches/02` §2.1: more than half of failures
//     are silent).
//  5. ROLLBACK IN A `finally`, verified byte-for-byte against the pre-write snapshot.
//
// Usage:
//   npm run vfstep -- --point 95 --mhz 15 --workload sdc_fma --seconds 30
//   npm run vfstep -- --dry-run          the whole plan, the snapshot, and NO write
//
// [TESTED: 2026-08-10, PARTIALLY, and the boundary is the point of this marker · `runStep` ran live on
//  point 95 at +15 MHz: the curve confirmed 2842 -> 2857 MHz at the same voltage, the oracle returned
//  PASS with the checksum matching the golden and zero faults logged, and the rollback left 0 non-zero
//  offsets of 128. `runAscent` and `measureUndervolt` also ran (+180 MHz, −14.67 W at a held clock).
//  WHAT IS *NOT* TESTED, named so nobody reads the marker as more than it says: this module has NO
//  OFFLINE SELFTEST — its logic has never been driven through an injected backend, unlike every other
//  writer here (`watchdog` 21 blocks, `descend` 39, `profile-manager` 15). The watt figure is
//  single-sourced against EXP-0018's two-series rule, one workload has been run out of the three the
//  method requires, and no guardband was applied. `plans/05` treats all of that as work, not as done:
//  the selftest is §4.4's last checkbox and the two series are P5-AC8]

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import config from '../config.mjs';

const require = createRequire(import.meta.url);

/**
 * The operating point, measured rather than assumed — see the header. Overridable, because the engine
 * that will loop over this atom must be able to name any point.
 */
export const DEFAULT_POINT = 95;

/**
 * One curve-point spacing at the top of this card's curve (2842 -> 2857 MHz), and also the step size
 * the owner's own PDF walks (`researches/02` §4). Two independent reasons for the same number is why
 * it is the default.
 */
export const DEFAULT_STEP_MHZ = 15;

/**
 * WHICH VOLTAGE POINT SERVES A GIVEN CLOCK — the computable proof that an undervolt happened.
 *
 * The card runs a requested clock at the LOWEST voltage whose curve point still reaches it. So after
 * raising the curve, the same clock is served by a cheaper point, and the drop in that point's voltage
 * IS the undervolt — readable straight off the curve, before any wattmeter is involved.
 *
 * This is why a single point is not enough (`researches/02` §6.2): 2842 MHz sits between point 94
 * (2835 @ 1040 mV) and point 95 (2857 @ 1045 mV), so raising ONLY point 95 leaves the neighbours
 * defining the curve and the voltage for 2842 unchanged. The whole curve has to move.
 */
/**
 * The card's temperature, right now. Cheap, read-only, and load-bearing — see below.
 *
 * THE CURVE IS NOT A STATIC TABLE. Measured 2026-08-10: at 53 °C point 95 reads 2835 MHz and point 126
 * reads 3157; at 65 °C under load the SAME points read 2820 and 3135 — the whole curve derates with
 * temperature, by 15–22 MHz over 12 degrees. Consequences that must never be forgotten by a session
 * comparing two curve reads:
 *
 *   • a before/after difference taken ACROSS a load run measures TEMPERATURE, not our offset;
 *   • a comparison is only honest at matched temperature, so every curve reading is stamped with one;
 *   • this is EXP-0011 again — a value is true only under the conditions it was taken.
 */
function cardTemperatureC() {
  try {
    const { execFileSync } = require('node:child_process');
    const out = execFileSync('nvidia-smi', ['--query-gpu=temperature.gpu', '--format=csv,noheader'], { encoding: 'utf8' });
    return Number(out.trim());
  } catch { return null; }
}

export function voltageForClock(points, clockMhz) {
  const usable = points
    .filter((p) => p.freqKhz > 0 && p.microVolts > 0 && p.mhz >= clockMhz)
    .sort((a, b) => a.microVolts - b.microVolts);
  return usable.length ? { pointIndex: usable[0].i, mv: usable[0].mv, mhz: usable[0].mhz } : null;
}

/**
 * Run one step and judge it.
 *
 * Returns a report rather than printing, so the engine that will loop over this can decide without
 * parsing text.
 */
export async function runStep({
  point = DEFAULT_POINT,
  offsetMhz = DEFAULT_STEP_MHZ,
  workload = 'sdc_fma',
  seconds = 30,
  sustain = 10,
  dryRun = false,
  allPoints = false,
  capMhz = null,
  // THE DIVERSE SET (plans/05 §4.3). `null` keeps the historical single-shape atom, which is what an
  // operator asks for by hand; an ARRAY judges this one offset by the whole set — one write, one
  // armed watchdog, one rollback, several loads inside. Applying and rolling back per shape would
  // measure three different thermal states of three different writes and call it one point.
  shapes = null,
} = {}) {
  const nvapi = await import('./nvapi.mjs');
  const wd = await import('./watchdog.mjs');
  const stress = await import('./stress-tester.mjs');

  const out = { point, offsetMhz, workload, seconds, sustain, dryRun, allPoints, capMhz, blocks: [], verdict: null };
  const block = (name, ok, detail = '') => out.blocks.push({ name, ok, detail });

  if (offsetMhz <= 0) throw new RangeError(`шаг обязан быть ПОЛОЖИТЕЛЬНЫМ (это и есть андервольт): ${offsetMhz}`);

  // ---- 1. PREFLIGHT
  const stale = await wd.recover({});
  if (stale.found && stale.ownerAlive) {
    block('преполётная проверка: сторож свободен', false,
      `карту держит живой процесс pid ${stale.record.ownerPid} («${stale.record.what}»)`);
    return out;
  }
  if (stale.found) {
    block('преполётная проверка: подобрана забытая запись', true,
      `прошлый прогон умер, держа карту; сброшено — ${stale.reset.steps.filter((s) => s.ok).length} из ${stale.reset.steps.length} шагов`);
  }

  const nv = nvapi.openNvapi();
  nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
  const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
  nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
  const handle = handles.readBigUInt64LE(0);

  let watchdog = null;
  let written = false;

  try {
    const before = nvapi.readVfOffsets(nv, handle);
    const curveBefore = nvapi.readVfCurve(nv, handle);
    block('старт: карта на стоке, все сдвиги нулевые',
      before.ok && before.nonZero === 0, before.ok ? `ненулевых ${before.nonZero} из 128` : before.why);
    if (!before.ok || before.nonZero !== 0) return out;

    const tempBefore = cardTemperatureC();
    out.tempBefore = tempBefore;
    const freqBefore = curveBefore.ok ? curveBefore.points[point].mhz : null;
    const mvAtPoint = curveBefore.ok ? curveBefore.points[point].mv : null;
    out.point_mV = mvAtPoint;
    out.freqBefore = freqBefore;
    block(`точка ${point} — та, где карта работает под нагрузкой`, true,
      `${mvAtPoint} мВ / ${freqBefore} МГц при ${tempBefore} °C; после шага ожидаем ${freqBefore + offsetMhz} МГц при том же напряжении. ` +
      `ВНИМАНИЕ: кривая проседает с температурой (замер: −15…−22 МГц за 12 °C), поэтому сравнение честно только при совпавшей температуре`);

    if (dryRun) {
      block('СУХОЙ ПРОГОН: запись НЕ делалась', true, 'план показан, карта не тронута');
      return out;
    }

    // ---- 2. THE WATCHDOG, ARMED BEFORE THE WRITE
    // The lease covers the whole load run plus a wide margin, and it is RENEWED from inside the burst
    // loop — a long test must not be kept alive by one long lease, or a hang mid-test waits it out.
    // THE LEASE COVERS THE WHOLE SET, not one load. The set runs three shapes back to back under one
    // write, and between them `stressTest` re-probes the card and queries the Windows log — seconds
    // during which no burst renews the lease. A lease sized for ONE shape would let the guard fire
    // mid-set and reset a card nothing was wrong with.
    const shapeCount = Array.isArray(shapes) && shapes.length ? shapes.length : 1;
    const ttlMs = (seconds * shapeCount + 60) * 1000;
    watchdog = wd.arm({ what: `АНДЕРВОЛЬТ: точка ${point} (+${offsetMhz} МГц), нагрузка ${Array.isArray(shapes) ? `набор из ${shapeCount} форм` : workload}`, ttlMs });
    block('сторож взведён ДО записи', Boolean(watchdog.guardPid),
      `pid ${watchdog.guardPid}, аренда ${ttlMs / 1000} с, откат — полный возврат к заводскому`);

    // ---- 3. THE WRITE
    // Point 127 is excluded by measurement, not by caution: the NVML lever never moves it, it carries
    // the structure's only non-zero service dword, and on the curve it reads 515 mV / 405 MHz against
    // its neighbour's 1240 mV / 3157 MHz — it is not part of the monotone graphics curve.
    const targets = allPoints
      ? Array.from({ length: nvapi.CLK_VF_POINT_COUNT - 1 }, (_, i) => i)
      : [point];

    let failed = 0;
    for (const p of targets) {
      const r = nvapi.writeVfOffset(nv, handle, p, offsetMhz * 1000);
      if (!r.ok) failed++;
    }
    written = failed < targets.length;
    block(`ЗАПИСЬ: ${allPoints ? `ВСЯ КРИВАЯ (${targets.length} точек)` : `точка ${point}`}, сдвиг +${offsetMhz} МГц`,
      failed === 0, failed === 0 ? 'все вызовы приняты' : `отказов ${failed} из ${targets.length}`);
    if (failed === targets.length) return out;
    watchdog.beat();

    const after = nvapi.readVfOffsets(nv, handle);
    const carrying = after.ok ? after.offsets.filter((o) => o === offsetMhz * 1000).length : 0;
    block('перечитано: сдвиг лёг ровно туда, куда просили',
      after.ok && carrying === targets.length && after.nonZero === targets.length,
      after.ok ? `несут сдвиг ${carrying} из ${targets.length} запрошенных, ненулевых всего ${after.nonZero}` : after.why);

    const curveAfter = nvapi.readVfCurve(nv, handle);
    const freqAfter = curveAfter.ok ? curveAfter.points[point].mhz : null;
    out.freqAfter = freqAfter;
    block('кривая подтверждает: точка поехала ВВЕРХ при том же напряжении',
      freqAfter !== null && freqAfter > freqBefore,
      `${freqBefore} → ${freqAfter} МГц при ${mvAtPoint} мВ (Δ ${(freqAfter - freqBefore).toFixed(1)})`);

    // ---- 3b. THE PROOF THAT AN UNDERVOLT ACTUALLY HAPPENED
    // Raising the curve only buys watts if the card is then HELD at a clock (researches/02 §6.2).
    // The clock we hold is the one the undervolt is measured at, and the observable is which voltage
    // point now serves it.
    if (capMhz && curveBefore.ok && curveAfter.ok) {
      const vBefore = voltageForClock(curveBefore.points, capMhz);
      const vAfter = voltageForClock(curveAfter.points, capMhz);
      out.undervolt = { capMhz, before: vBefore, after: vAfter,
        savedMv: vBefore && vAfter ? Number((vBefore.mv - vAfter.mv).toFixed(3)) : null };
      block(`АНДЕРВОЛЬТ на закреплённых ${capMhz} МГц: напряжение для этой частоты УПАЛО`,
        Boolean(vBefore && vAfter) && vAfter.mv < vBefore.mv,
        vBefore && vAfter
          ? `обслуживала точка ${vBefore.pointIndex} (${vBefore.mv} мВ) → теперь точка ${vAfter.pointIndex} (${vAfter.mv} мВ), экономия ${out.undervolt.savedMv} мВ`
          : 'не вычислено — частота вне кривой');
    }

    // ---- 4. THE ORACLE — the full three-way verdict under real load
    //
    // With a SET, the point's verdict is the WORST over the set and the deciding shape is named
    // (plans/05 §4.3). Without one, this stays the single-shape atom it has always been.
    if (Array.isArray(shapes) && shapes.length) {
      const judged = await stress.judgeCandidate({
        shapes,
        // The mapping «shape -> how to run it» lives in stress-tester as a pure function with its
        // own blocks: a run labelled one shape and executed as another is invisible from here.
        runShapeFn: (s) => stress.stressTest({
          ...stress.runOptionsForShape(s, { seconds, sustain }),
          onBurst: () => { watchdog.beat(); },
        }),
        onShape: () => { watchdog.beat(); },
      });
      out.verdict = judged.verdict;
      out.worstShape = judged.worstShape;
      // ONE ENTRY PER SHAPE, because the store keeps one record per (point, offset, shape) and
      // AC3's meter is «distinct load shapes each closed point was judged by». A single collapsed
      // row could never answer that question.
      out.shapes = judged.ran;
      out.judged = judged;
      // The graded numbers of the DECIDING shape ride in the usual place, so every existing consumer
      // keeps working; per-shape meters live in `out.shapes`.
      const decided = judged.ran.find((e) => e.id === judged.worstShape) ?? judged.ran.at(-1) ?? null;
      out.meters = decided?.meters ?? null;
      out.stress = {
        verdict: judged.verdict,
        reason: judged.reason,
        shapes: judged.ran.map((e) => e.id),
        skipped: judged.skipped,
        meters: out.meters,
      };
      for (const e of judged.ran) {
        block(`форма ${e.id}: ${e.verdict ?? 'НЕИЗВЕСТНО'}${e.witnessOnly ? ' (свидетель, PASS не выдаёт)' : ''}`,
          e.bearsVerdict ? e.verdict === config.VERDICT.PASS : e.verdict === null,
          e.reason ?? '');
      }
      block(`ВЕРДИКТ НАБОРА под нагрузкой: ${judged.verdict ?? 'НЕИЗВЕСТНО'}`,
        judged.verdict === config.VERDICT.PASS, judged.reason);
      return out;
    }

    const result = await stress.stressTest({
      name: workload,
      seconds,
      sustain,
      onBurst: () => { watchdog.beat(); },     // the lease is renewed by the load itself
    });
    out.verdict = result.verdict;
    // THE GRADED NUMBERS ARE CARRIED, not dropped. The oracle counts how many elements went bad and
    // how deep the corruption is; an earlier version of this function kept only the verdict, so the
    // edge search could see a CRASH and could not see the errors that led to it. `prove:gradient`
    // exists precisely because these counters catch a single flipped bit at a MATCHING checksum.
    out.meters = result.meters ?? null;
    out.stress = {
      verdict: result.verdict,
      reason: result.reason ?? null,
      bursts: result.bursts?.length ?? null,
      meters: result.meters ?? null,
    };
    block(`ВЕРДИКТ ОРАКУЛА под нагрузкой: ${result.verdict}`,
      result.verdict === config.VERDICT.PASS,
      result.reason ?? 'сумма против эталона + журнал Windows + работа в секунду');
  } finally {
    // ---- 5. ROLLBACK, always
    if (written) {
      // Zero EVERY point, not only the ones this run wrote. The rollback runs when things may have
      // gone wrong, and "undo exactly what I did" needs a record that a crash may have taken with it —
      // the watchdog's total-undo reasoning applies here too (rule R9). Zeroing a zero costs nothing.
      let backFailed = 0;
      for (let p = 0; p < nvapi.CLK_VF_POINT_COUNT - 1; p++) {
        if (!nvapi.writeVfOffset(nv, handle, p, 0).ok) backFailed++;
      }
      const check = nvapi.readVfOffsets(nv, handle);
      const clean = check.ok && check.nonZero === 0;
      block('ОТКАТ: вся кривая обнулена, ненулевых сдвигов не осталось', backFailed === 0 && clean,
        `отказов записи ${backFailed} · ненулевых ${check.ok ? check.nonZero : '—'} из 128`);
    }
    watchdog?.disarm();
    nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload);
  }

  return out;
}

// =================================================================================================
// THE ASCENT — researches/02 §3 steps 1–2, with the owner's two modes mapped onto our lever
// =================================================================================================

/**
 * THE OWNER'S TWO SEARCH MODES, TRANSLATED — and the translation is the whole reason this constant
 * exists rather than a round number.
 *
 * He specified them in VOLTS (chat, 2026-08-10): *«грубый меняет напряжение на 25 мВ… точный режим —
 * меняет напряжение на 5 мВ»*. Our lever is a FREQUENCY offset, so the modes have to be converted,
 * and the conversion is measured on this card's own curve: the points at the top are spaced ~15 MHz
 * apart per 5 mV of voltage. So moving the serving point down one voltage step costs ~15 MHz of
 * curve offset, and:
 *
 *   fine   = 5 mV  ->  ~15 MHz   (one curve point)
 *   coarse = 25 mV ->  ~75 MHz   (five curve points)
 *
 * His rule that the fine step IS the hardware's own minimum step is honoured: 5 mV is the MEASURED
 * voltage grid (fact 6), so the fine mode moves exactly one grid step.
 */
export const ASCENT_COARSE_MHZ = 75;
export const ASCENT_FINE_MHZ = 15;

/**
 * Walk the whole curve upward until the oracle stops saying PASS.
 *
 * `researches/02` §3 step 2: coarse ascent to the first failure, then refine. And its §6.4 warning is
 * built into the shape rather than left in prose — the edge is a PROBABILITY, not a line, so:
 *
 *   • the ascent NEVER dwells at a failing offset — it rolls back the moment a verdict is not PASS;
 *   • the result is reported as "the highest offset that PASSED in this run", never as "the limit";
 *   • a guardband is subtracted before anything could be called a profile, and this function does not
 *     produce a profile at all.
 *
 * ONE ARM FOR THE WHOLE ASCENT: the watchdog is armed once and its lease renewed at every step, so
 * the card is covered continuously rather than in gaps between steps.
 */
export async function runAscent({
  capMhz = 2842,
  stepMhz = ASCENT_COARSE_MHZ,
  maxMhz = 150,
  workload = 'sdc_fma',
  seconds = 30,
  sustain = 10,
} = {}) {
  const nvapi = await import('./nvapi.mjs');
  const wd = await import('./watchdog.mjs');
  const stress = await import('./stress-tester.mjs');

  const out = { capMhz, stepMhz, maxMhz, workload, steps: [], bestPassMhz: 0, stoppedBy: null };

  const stale = await wd.recover({});
  if (stale.found && stale.ownerAlive) {
    out.stoppedBy = `карту держит живой процесс pid ${stale.record.ownerPid}`;
    return out;
  }

  const nv = nvapi.openNvapi();
  nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
  const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
  nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
  const handle = handles.readBigUInt64LE(0);

  const POINTS = nvapi.CLK_VF_POINT_COUNT - 1;                 // point 127 is not a graphics point
  const writeAll = (mhz) => {
    let failed = 0;
    for (let p = 0; p < POINTS; p++) if (!nvapi.writeVfOffset(nv, handle, p, mhz * 1000).ok) failed++;
    return failed;
  };

  const watchdog = wd.arm({ what: `ВОСХОЖДЕНИЕ: вся кривая, шаг +${stepMhz} МГц до +${maxMhz}`, ttlMs: (seconds + 90) * 1000 });
  let touched = false;

  try {
    const curve0 = nvapi.readVfCurve(nv, handle);
    const v0 = curve0.ok ? voltageForClock(curve0.points, capMhz) : null;
    out.stockVolt = v0;

    for (let offset = stepMhz; offset <= maxMhz; offset += stepMhz) {
      watchdog.beat();
      const failedWrites = writeAll(offset);
      touched = true;
      if (failedWrites) { out.stoppedBy = `отказов записи ${failedWrites} на +${offset} МГц`; break; }

      const curve = nvapi.readVfCurve(nv, handle);
      const v = curve.ok ? voltageForClock(curve.points, capMhz) : null;
      const tempC = cardTemperatureC();

      const res = await stress.stressTest({ name: workload, seconds, sustain, onBurst: () => watchdog.beat() });
      const step = {
        offsetMhz: offset,
        servingPoint: v ? v.pointIndex : null,
        mv: v ? v.mv : null,
        savedMv: v0 && v ? Number((v0.mv - v.mv).toFixed(3)) : null,
        tempC,
        verdict: res.verdict,
        reason: res.reason ?? null,
      };
      out.steps.push(step);

      if (res.verdict !== config.VERDICT.PASS) { out.stoppedBy = `вердикт ${res.verdict} на +${offset} МГц`; break; }
      out.bestPassMhz = offset;
    }
    if (!out.stoppedBy) out.stoppedBy = `дошли до потолка +${maxMhz} МГц, отказа не встретили`;
  } finally {
    watchdog.beat();
    if (touched) {
      let backFailed = 0;
      for (let p = 0; p < POINTS; p++) if (!nvapi.writeVfOffset(nv, handle, p, 0).ok) backFailed++;
      const check = nvapi.readVfOffsets(nv, handle);
      out.rolledBack = backFailed === 0 && check.ok && check.nonZero === 0;
      out.rollbackDetail = `отказов ${backFailed} · ненулевых ${check.ok ? check.nonZero : '—'} из 128`;
    } else {
      out.rolledBack = true;
      out.rollbackDetail = 'записи не было';
    }
    watchdog.disarm();
    nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload);
  }

  return out;
}

// =================================================================================================
// THE PAYOFF — turn the millivolts into WATTS, at a HELD clock
// =================================================================================================

/**
 * Measure the card at ONE clock, once at stock and once with the curve raised.
 *
 * ─── WHY THE CLOCK MUST BE HELD, AND WHY THAT IS THE WHOLE POINT ──────────────────────────────────
 *
 * `researches/02` §6.2: raising the curve without a ceiling buys SPEED, not watts — the card simply
 * boosts to a higher point. Holding the clock is the industry's "flatten the tail", and it converts
 * the same raise into the thing the owner's formula is written about: the SAME work for less power.
 * It is also what makes the comparison legitimate — two power figures at different clocks are not a
 * delta, they are two different experiments.
 *
 * ─── EVERY GUARD THIS PROJECT HAS PAID FOR APPLIES HERE AT ONCE ───────────────────────────────────
 *
 *  • the lock goes through `profile-manager` (rule R1) and is verified UNDER LOAD, never at idle
 *    (EXP-0020 — a high lock is simply not observable on an idle card);
 *  • power is sampled from a SEPARATE process by `power-baseline.capture` (an in-process sampler
 *    records zero — `spawnSync` blocks the event loop);
 *  • the meter's own scatter is 1.28 W / 0.65 % (EXP-0018), so a thinner delta is NOT an effect and
 *    this function refuses to call it one;
 *  • both sides carry their START TEMPERATURE, because power tracks the temperature a run REACHES
 *    (~4 W per 5 °C, fact 10) — and now also because the CURVE itself derates with temperature
 *    (fact 18), so a hot side is undervolted differently from a cold one.
 */
/** One median out of a power record — the shape is {n, median, min, max}, never a bare number. */
function med(rec, field) {
  const m = rec?.medians?.loaded?.[field];
  return m && typeof m.median === 'number' ? m.median : null;
}

export async function measureUndervolt({
  capMhz = 2842,
  offsetMhz = 180,
  workload = 'sdc_fma',
  seconds = 30,
  sustain = 30,
} = {}) {
  const nvapi = await import('./nvapi.mjs');
  const wd = await import('./watchdog.mjs');
  const power = await import('./power-baseline.mjs');
  const pm = await import('./profile-manager.mjs');
  const ladder = await import('./ladder-descent.mjs');
  const store = await import('./profile-store.mjs');

  const out = { capMhz, offsetMhz, workload, sides: [], blocks: [] };
  const block = (name, ok, detail = '') => out.blocks.push({ name, ok, detail });

  const stale = await wd.recover({});
  if (stale.found && stale.ownerAlive) {
    block('преполётная проверка', false, `карту держит живой процесс pid ${stale.record.ownerPid}`);
    return out;
  }

  const nv = nvapi.openNvapi();
  nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
  const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
  nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
  const handle = handles.readBigUInt64LE(0);
  const POINTS = nvapi.CLK_VF_POINT_COUNT - 1;

  const backend = pm.nvidiaSmiBackend();
  const card = store.probeCard();
  // `card.ladder` is {ok, mhz, rung}, not an array — the list lives in `.mhz`. Shape read from the
  // caller that already works (`ladder-descent` main), not guessed (EXP-0012).
  if (!card.ladder?.ok) { block('лестница частот прочитана', false, card.ladder?.why ?? 'недоступна'); return out; }
  const snapped = ladder.snapToLadder(capMhz, card.ladder.mhz);
  const lockMhz = snapped?.mhz ?? capMhz;
  if (snapped?.snapped) block('запрошенная частота притянута к лестнице', true, `${capMhz} → ${lockMhz} МГц`);

  const watchdog = wd.arm({ what: `ЗАМЕР АНДЕРВОЛЬТА: ${lockMhz} МГц, кривая +${offsetMhz} МГц`, ttlMs: (seconds * 4 + 180) * 1000 });
  let touched = false;
  let locked = false;

  const writeAll = (mhz) => {
    let failed = 0;
    for (let p = 0; p < POINTS; p++) if (!nvapi.writeVfOffset(nv, handle, p, mhz * 1000).ok) failed++;
    return failed;
  };

  try {
    for (const side of [{ tag: 'сток', mhz: 0 }, { tag: `кривая +${offsetMhz}`, mhz: offsetMhz }]) {
      watchdog.beat();
      if (side.mhz) { touched = true; if (writeAll(side.mhz)) { block(`${side.tag}: запись кривой`, false, 'были отказы'); break; } }

      const curve = nvapi.readVfCurve(nv, handle);
      const serving = curve.ok ? voltageForClock(curve.points, lockMhz) : null;

      // The clock ceiling — the "flatten the tail" half, through the one sanctioned writer.
      const profile = ladder.candidateProfile(lockMhz, card);
      await pm.apply(backend, profile, { card, verifyLock: 'deferred' });
      locked = true;
      watchdog.beat();

      const rec = await power.capture({ workload, seconds, sustain, label: `uv_${side.mhz}` });
      out.sides.push({
        tag: side.tag,
        offsetMhz: side.mhz,
        servingPoint: serving ? serving.pointIndex : null,
        mv: serving ? serving.mv : null,
        // The record's shape was READ, not assumed (EXP-0012): medians are {n, median, min, max}
        // objects, the power field is 'power.draw.instant', and throughput lives in .
        watts: med(rec, 'power.draw.instant'),
        clockMhz: med(rec, 'clocks.gr'),
        tempStart: rec?.startTemperature ?? null,
        tempC: med(rec, 'temperature.gpu'),
        fan: med(rec, 'fan.speed'),
        opsPerSec: rec?.meters?.opsPerSecond ?? null,
        dutyFactor: rec?.meters?.dutyFactor ?? null,
        verdict: rec?.verdict ?? null,
      });
      block(`${side.tag}: замер снят на ${lockMhz} МГц`, Boolean(rec), serving ? `обслуживает точка ${serving.pointIndex} — ${serving.mv} мВ` : '');

      await pm.resetToFactory(backend, { knownLockMhz: lockMhz });
      locked = false;
    }

    // ---- the delta, judged against the meter's own floor
    const [a, b] = out.sides;
    if (a?.watts != null && b?.watts != null) {
      const deltaW = Number((a.watts - b.watts).toFixed(2));
      const floorW = config.POWER_METER_SPREAD_W ?? 1.28;
      out.delta = { watts: deltaW, percent: Number(((deltaW / a.watts) * 100).toFixed(2)), floorW };
      block(`ДЕЛЬТА ${deltaW} Вт толще собственного разброса прибора (${floorW} Вт)`,
        Math.abs(deltaW) > floorW,
        `${a.watts} → ${b.watts} Вт на ${lockMhz} МГц; тоньше пола — это НЕ эффект, а шум`);
      const dTemp = (a.tempC != null && b.tempC != null) ? Number((b.tempC - a.tempC).toFixed(1)) : null;
      block('температуры сторон сопоставимы (иначе сравнивается тепло, а не профиль)',
        dTemp === null || Math.abs(dTemp) <= 3, `Δ ${dTemp} °C (${a.tempC} → ${b.tempC})`);
    }
  } finally {
    watchdog.beat();
    if (locked) { try { await pm.resetToFactory(backend, { knownLockMhz: lockMhz }); } catch { /* the curve rollback below still must run */ } }
    if (touched) {
      let failed = 0;
      for (let p = 0; p < POINTS; p++) if (!nvapi.writeVfOffset(nv, handle, p, 0).ok) failed++;
      const check = nvapi.readVfOffsets(nv, handle);
      out.rolledBack = failed === 0 && check.ok && check.nonZero === 0;
      block('ОТКАТ: кривая обнулена и замок снят', out.rolledBack, `отказов ${failed} · ненулевых ${check.ok ? check.nonZero : '—'}`);
    } else { out.rolledBack = true; }
    watchdog.disarm();
    nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload);
  }

  return out;
}

// =================================================================================================
// THE PROFILE'S SHAPE — plan 05 §4.1, and it is the OWNER'S REQUIREMENT turned into three observations
// =================================================================================================

/**
 * Apply the shipped profile's shape — the whole curve raised, capped at the stock top, NO clock lock —
 * and check the three things the owner's sentence actually demands.
 *
 * His words (chat 2026-08-10): *«Я хочу, чтобы карта сама могла и разгоняться и снижать частоты, но
 * работала на пониженном напряжении согласно кривой VF профиля»*. Written as checks:
 *
 *   1. **it can still boost** — under load the delivered clock reaches the stock maximum, and NOT more
 *      (more would mean the savings went into speed — `researches/02` §6.2);
 *   2. **it can still clock down** — at idle the clock falls back into the idle range. This is the
 *      property `-lgc {min: X, max: X}` destroys, which is why no clock lock is written here at all;
 *   3. **at less voltage** — the point serving the top frequency is a LOWER-voltage point than at stock,
 *      read straight off the curve, before any wattmeter is involved.
 *
 * The watts are measured too, and both sides are cooled to the same setpoint first (`nvapi.coolTo`) —
 * because power follows the temperature a run REACHES (fact 10) and the curve itself derates with
 * temperature (fact 18), so an uncooled pair is two experiments rather than a delta.
 *
 * Safety: one watchdog arm for the whole run, renewed across every phase; the curve write goes through
 * the single `writeCurve` writer; the rollback is `zeroCurve` in a `finally` and it is VERIFIED.
 *
 * [NOT-TESTED] at birth — the offline half of this step is `nvapi --selftest-shape` (15 blocks,
 * mutation-proved with three mutations against named addressees); this function is its live half.
 */
/**
 * THE LOAD IS SWAPPABLE SINCE 2026-08-10 20:0x, and the seam is one line — the side measurement.
 *
 * WHY: every side this experiment ever measured was a COMPUTE load at ~137 W, i.e. half this card's
 * envelope, while the owner plays at 300 W and 77 °C (STATUS fact 16). The graphics bench now exists
 * and its record shape was written to MIRROR power-baseline's on purpose, so swapping the measurer
 * needs no adapter and no second copy of the safety machinery: the watchdog, the cool-down, the
 * vector, the read-back and the rollback are the same code for both loads. One writer, one undo.
 *
 * `load: 'compute'` — `sdc_fma`/`branchy` through power-baseline, price in ops/s.
 * `load: 'graphics'` — Q2RTX's timedemo through graphics-load, price in **FPS**, which is the
 * observable the owner's `Optimised` criterion is actually stated in.
 */
export async function runShapeExperiment({
  deltaMhz = 45,
  workload = 'sdc_fma',
  load = 'compute',
  seconds = 30,
  sustain = 30,
  gfxRuns = config.Q2RTX_TIMEDEMO_RUNS,
  gfxBounceRays = config.Q2RTX_BOUNCE_RAYS,
  // THE THIRD KNOB OF `Optimised`, named by the owner 2026-08-10: *«И pl 250 установить»*. Applied
  // through `profile-manager` and nowhere else — that module is the project's only power-limit writer
  // (rule R1), it re-reads until the value is stable, and it owns the undo. Combined with `--mhz 0`
  // this measures the power cap ALONE, which is the cell of the trade matrix that decides whether the
  // cap is worth its price at all.
  powerLimitW = null,
  coolToC = 42,
  capAtMhz = null,
  dryRun = false,
} = {}) {
  if (!['compute', 'graphics'].includes(load)) throw new Error(`--load принимает compute | graphics, дано ${load}`);
  const nvapi = await import('./nvapi.mjs');
  const wd = await import('./watchdog.mjs');
  const power = await import('./power-baseline.mjs');
  const gfx = load === 'graphics' ? await import('./graphics-load.mjs') : null;
  const pm = powerLimitW !== null ? await import('./profile-manager.mjs') : null;
  let pmBackend = null;
  let powerLimitApplied = false;

  const out = { deltaMhz, workload: load === 'graphics' ? 'q2rtx-timedemo' : workload, load, blocks: [], sides: [] };
  const block = (name, ok, detail = '') => out.blocks.push({ name, ok, detail });

  const stale = await wd.recover({});
  if (stale.found && stale.ownerAlive) {
    block('преполётная проверка: сторож свободен', false, `карту держит живой процесс pid ${stale.record.ownerPid}`);
    return out;
  }

  const nv = nvapi.openNvapi();
  nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
  const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
  nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
  const handle = handles.readBigUInt64LE(0);

  const idleClock = () => {
    try {
      const { execFileSync } = createRequire(import.meta.url)('node:child_process');
      return Number(execFileSync('nvidia-smi', ['--query-gpu=clocks.gr', '--format=csv,noheader'],
        { encoding: 'utf8' }).toString().replace('MHz', '').trim());
    } catch { return null; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let watchdog = null;
  let touched = false;

  try {
    const before = nvapi.readVfOffsets(nv, handle);
    block('старт: карта на стоке, все сдвиги нулевые', before.ok && before.nonZero === 0,
      before.ok ? `ненулевых ${before.nonZero} из 128` : before.why);
    if (!before.ok || before.nonZero !== 0) return out;

    const curvePeek = nvapi.readVfCurve(nv, handle);
    if (!curvePeek.ok) { block('стоковая кривая прочитана', false, curvePeek.why); return out; }
    const peekTop = Math.max(...curvePeek.points.slice(0, nvapi.CLK_VF_POINT_COUNT - 1)
      .filter((p) => p.freqKhz > 0).map((p) => p.mhz));
    block('стоковая кривая прочитана (предварительно, для плана)', true,
      `верх ${peekTop} МГц при ${cardTemperatureC()} °C. ВНИМАНИЕ: это чтение НЕ используется для сверки ` +
      'после записи — кривая проседает с температурой (факт 18), поэтому вектор строится по чтению, ' +
      'взятому за СЕКУНДЫ до записи, при той же температуре');

    if (dryRun) {
      const plan = nvapi.buildRaiseAndCapVector(curvePeek.points, deltaMhz, { capMhz: capAtMhz });
      block(`СУХОЙ ПРОГОН: план вектора (+${deltaMhz} МГц, потолок ${plan.capMhz} МГц)`, plan.ok,
        `полный шаг у ${plan.atFullDelta}, придавлено ${plan.raisedButCapped}, толкнуто вниз ${plan.pushedDown}, ` +
        `нулевых ${plan.zero}; сдвиги ${plan.minOffset}…${plan.maxOffset} МГц. Запись НЕ делалась`);
      return out;
    }

    watchdog = wd.arm({
      // The lease's description cannot name the cap yet: the cap is the stock operating clock, and that
      // is MEASURED on the first side, after this arm. Naming what we are about to do beats naming a
      // number we do not have (the three-doors rule — an invented number is worse than a missing one).
      what: `ФОРМА ПРОФИЛЯ: вся кривая +${deltaMhz} МГц с потолком на стоковой рабочей частоте, БЕЗ фиксации`,
      ttlMs: (seconds * 6 + 600) * 1000,
    });
    block('сторож взведён ДО записи', Boolean(watchdog.guardPid),
      `pid ${watchdog.guardPid}; откат — полный возврат к заводскому, включая вентиляторы`);

    // ---- both sides, each from the SAME thermal starting state
    for (const side of [{ tag: 'сток', applyVector: false }, { tag: `кривая +${deltaMhz}`, applyVector: true }]) {
      watchdog.beat();
      const cool = await nvapi.coolTo(nv, handle, { targetC: coolToC, beat: () => watchdog.beat() });
      block(`${side.tag}: холодный старт ${coolToC} °C`, cool.ok,
        `${cool.started} → ${cool.reached} °C за ${cool.seconds} с${cool.wrote ? '' : ' (вентиляторы не тронуты — уже было холоднее)'}`);

      // «No raise AND no cap asked for» means exactly that: do not touch the curve. Without this
      // the cap still defaulted to the stock operating clock and pushed 36 points DOWN by up to
      // 405 MHz — a pure clock cap masquerading as an untouched curve, which is a different
      // experiment from the one the caller asked for.
      const writesCurve = side.applyVector && !(deltaMhz === 0 && capAtMhz === null);
      if (side.applyVector && !writesCurve) {
        block('КРИВАЯ НЕ ТРОГАЕТСЯ: подъёма нет и потолок не запрошен', true,
          'меряется только другой рычаг — это и заказывали');
      }
      if (writesCurve) {
        // THE CAP IS THE STOCK OPERATING FREQUENCY, not the curve's top — measured on side A moments ago.
        // With the cap at the top the card never reaches it under load and the cap binds nothing: the
        // raise is taken as SPEED (measured: 2887 → 2932 MHz at the same 137 W). Anchoring at the clock
        // the card actually delivers is the industry's "flatten the tail" (`researches/02` §6.2).
        const stockClock = out.sides[0]?.clockMhz ?? null;
        const cap = capAtMhz ?? stockClock;
        if (cap === null) { block('потолок назначен', false, 'стоковая частота не измерена'); break; }

        // THE VECTOR IS BUILT FROM A READING TAKEN SECONDS BEFORE THE WRITE, at this temperature. The
        // first version built it from a curve read BEFORE the cool-down and then compared against a
        // curve read after it — which measured the 3 °C, not our offset, and reddened its own check by
        // 15 MHz (fact 18; the same trap this file's header warns about).
        const curveNow = nvapi.readVfCurve(nv, handle);
        if (!curveNow.ok) { block('кривая прочитана перед записью', false, curveNow.why); break; }
        const tempAtBuild = cardTemperatureC();
        const topNow = Math.max(...curveNow.points.slice(0, nvapi.CLK_VF_POINT_COUNT - 1)
          .filter((p) => p.freqKhz > 0).map((p) => p.mhz));
        const servingBefore = voltageForClock(curveNow.points, cap);
        out.topMhz = topNow;

        const vec = nvapi.buildRaiseAndCapVector(curveNow.points, deltaMhz, { capMhz: cap });
        if (!vec.ok) { block('вектор построен', false, vec.why); break; }
        block(`вектор: подъём +${deltaMhz} МГц, ПОТОЛОК ${cap} МГц (стоковая рабочая частота)`, true,
          `верх кривой сейчас ${topNow} МГц при ${tempAtBuild} °C · полный шаг у ${vec.atFullDelta} точек, ` +
          `придавлено ${vec.raisedButCapped}, ТОЛКНУТО ВНИЗ ${vec.pushedDown}, нулевых ${vec.zero}; ` +
          `сдвиги ${vec.minOffset}…${vec.maxOffset} МГц`);

        const w = nvapi.writeCurve(nv, handle, vec.offsets);
        touched = true;
        block(`${side.tag}: ЗАПИСЬ вектора одним писателем`, w.ok,
          `записано ${w.written}, отказов ${w.failed}${w.failures.length ? ` — ${JSON.stringify(w.failures)}` : ''}`);
        if (!w.ok) break;
        watchdog.beat();

        const curveAfter = nvapi.readVfCurve(nv, handle);
        const newTop = curveAfter.ok
          ? Math.max(...curveAfter.points.slice(0, nvapi.CLK_VF_POINT_COUNT - 1).filter((p) => p.freqKhz > 0).map((p) => p.mhz))
          : null;
        const servingNow = curveAfter.ok ? voltageForClock(curveAfter.points, cap) : null;
        out.serving = { before: servingBefore, after: servingNow, capMhz: cap };
        // Observation 3, and it needs no wattmeter: the SAME frequency, served by a cheaper point.
        block('НАПРЯЖЕНИЕ ДЛЯ ТОЙ ЖЕ ЧАСТОТЫ УПАЛО — это и есть андервольт',
          Boolean(servingBefore && servingNow) && servingNow.mv < servingBefore.mv,
          servingBefore && servingNow
            ? `${cap} МГц: точка ${servingBefore.pointIndex} (${servingBefore.mv} мВ) → точка ${servingNow.pointIndex} (${servingNow.mv} мВ), дешевле на ${(servingBefore.mv - servingNow.mv).toFixed(3)} мВ`
            : 'не вычислено');
        // Observation 1: the cap holds — and it is judged against the reading taken at the SAME
        // temperature, seconds earlier, which is what makes the comparison legal at all.
        block('ПОТОЛОК ДЕРЖИТ: выше него кривая ничего не предлагает',
          newTop !== null && newTop <= cap + config.LOCK_DELIVERY_TOLERANCE_MHZ,
          `верх кривой ${topNow} → ${newTop} МГц при потолке ${cap} (обе пробы при ${tempAtBuild}…${cardTemperatureC()} °C)`);
      }

      // The power cap goes on WITH the vector — same side, so one comparison answers what the
      // whole configuration costs rather than what one of its halves costs. profile-manager owns
      // the write, the read-back-until-stable and the undo (rule R1).
      if (side.applyVector && powerLimitW !== null) {
        pmBackend = pm.nvidiaSmiBackend();
        const stBefore = pm.readState(pmBackend);
        pmBackend.setPowerLimitWatts(powerLimitW);
        powerLimitApplied = true;
        // `readBack` THROWS when it cannot agree and RETURNS the reading when it can — it has no
        // `.ok` field, and asking for one turned a successful write into a red block and aborted
        // the measurement. Use the contract the function actually has.
        let plOk = false;
        let plDetail = '';
        try {
          const proof = await pm.readBack(pmBackend, (s) => Math.abs(s.powerLimitW - powerLimitW) < 0.5,
            { what: `потолок мощности должен стать ${powerLimitW} Вт` });
          plOk = true;
          plDetail = `перечитано до устойчивости за ${proof.agreedAfterMs} мс: ${proof.value.powerLimitW} Вт`;
        } catch (e) { plDetail = e.message; }
        block(`ПОТОЛОК МОЩНОСТИ ${stBefore.powerLimitW} → ${powerLimitW} Вт (через profile-manager, R1)`,
          plOk, plDetail);
        if (!plOk) break;
        watchdog.beat();
      }

      const label = `shape_${load}_${side.applyVector ? deltaMhz : 0}`
        + `${side.applyVector && powerLimitW !== null ? `_pl${powerLimitW}` : ''}`
        // The cap belongs in the label too: two runs differing ONLY by it wrote to the same file
        // and the first record was overwritten without a word.
        + `${side.applyVector && capAtMhz !== null ? `_cap${capAtMhz}` : ''}`;
      const rec = load === 'graphics'
        ? await gfx.capture({ label: `${label}_b${gfxBounceRays}`, runs: gfxRuns, bounceRays: gfxBounceRays, profile: side.applyVector ? `curve+${deltaMhz}` : null })
        : await power.capture({ workload, seconds, sustain, label });
      watchdog.beat();
      const m = (f) => { const x = rec?.medians?.loaded?.[f]; return x && typeof x.median === 'number' ? x.median : null; };
      out.sides.push({
        tag: side.tag,
        watts: m('power.draw.instant'),
        clockMhz: m('clocks.gr'),
        tempC: m('temperature.gpu'),
        fan: m('fan.speed'),
        opsPerSec: rec?.meters?.opsPerSecond ?? null,
        fps: rec?.meters?.fps ?? null,
        tempStart: rec?.startTemperature ?? null,
        // The graphics load NEVER returns PASS (no golden on that path), so `faultFree` is carried
        // beside the verdict rather than folded into it — collapsing them would manufacture the very
        // PASS that module refuses to invent.
        verdict: rec?.verdict ?? null,
        faultFree: rec?.faultFree ?? null,
      });
      block(`${side.tag}: замер снят БЕЗ фиксации частоты`, Boolean(rec),
        `${m('clocks.gr')} МГц · ${m('power.draw.instant')} Вт · ${m('temperature.gpu')} °C · вентилятор ${m('fan.speed')} %`
        + `${rec?.meters?.fps != null ? ` · ${rec.meters.fps.toFixed(3)} FPS` : ''}`
        + ` · вердикт ${rec?.verdict ?? (rec?.faultFree ? 'БЕЗ СБОЕВ (не PASS)' : 'НЕИЗВЕСТНО')}`);

      // Observation 2: the card must still fall. Checked on the undervolted side, where a pin would show.
      // Only meaningful when a curve WAS written: a pin is what this block hunts, and no write
      // means no pin to hunt. Running it anyway compared against an undefined cap and reddened.
      if (side.applyVector && writesCurve) {
        await sleep(4000);
        watchdog.beat();
        const idle = [idleClock(), await sleep(1500).then(idleClock), await sleep(1500).then(idleClock)];
        out.idleClocks = idle;
        block('КАРТА ПО-ПРЕЖНЕМУ СБРАСЫВАЕТ ЧАСТОТУ НА ПРОСТОЕ — фиксации нет',
          idle.every((c) => c !== null) && Math.min(...idle) < (out.serving?.capMhz ?? out.topMhz) * 0.6,
          `на простое ${idle.join(' / ')} МГц против потолка ${out.serving?.capMhz ?? out.topMhz} — ` +
          'приколоченная карта (-lgc min=max) стояла бы на потолке и здесь');
      }
    }

    // ---- the delta, judged against the meter's own floor
    const [a, b] = out.sides;
    if (a?.watts != null && b?.watts != null) {
      const deltaW = Number((a.watts - b.watts).toFixed(2));
      const floorW = config.POWER_METER_SPREAD_W ?? 1.28;
      out.delta = { watts: deltaW, floorW, percent: Number(((deltaW / a.watts) * 100).toFixed(2)) };
      block(`ВАТТЫ: дельта ${deltaW} Вт против собственного разброса прибора ${floorW} Вт`,
        Math.abs(deltaW) > floorW,
        `${a.watts} → ${b.watts} Вт; `
        + (Math.abs(deltaW) > floorW ? 'толще пола прибора — это эффект'
          : 'тоньше пола — это шум, а не эффект'));
      block('ЧАСТОТА НЕ ПОТЕРЯНА: выданный клок сопоставим',
        a.clockMhz != null && b.clockMhz != null && b.clockMhz >= a.clockMhz - config.LOCK_DELIVERY_TOLERANCE_MHZ,
        `${a.clockMhz} → ${b.clockMhz} МГц; цена `
        + (a.fps != null ? `${a.fps.toFixed(3)} → ${b.fps.toFixed(3)} FPS` : `${a.opsPerSec} → ${b.opsPerSec} оп/с`));

      // THE PRICE IN THE UNIT THE OWNER STATED IT IN. Under a game the card is power-capped, so an
      // undervolt shows up as FRAMES rather than as watts (STATUS fact 16) — and «просадка FPS не
      // более 5 %» is a claim about frames, judged against the bench's OWN across-launch floor
      // (0.90 %, measured over two stock series) and never against a within-launch figure.
      if (a.fps != null && b.fps != null) {
        const deltaFpsPct = Number((((b.fps - a.fps) / a.fps) * 100).toFixed(2));
        const floorPct = config.Q2RTX_FPS_SPREAD_PCT;
        out.deltaFps = { a: a.fps, b: b.fps, percent: deltaFpsPct, floorPct };
        block(`FPS: ${a.fps.toFixed(3)} → ${b.fps.toFixed(3)} = ${deltaFpsPct > 0 ? '+' : ''}${deltaFpsPct} % `
          + `против пола прибора ${floorPct} %`,
          Math.abs(deltaFpsPct) > floorPct,
          Math.abs(deltaFpsPct) > floorPct
            ? 'сдвиг толще собственного разброса прибора — это эффект'
            : 'тоньше пола прибора — это шум, а не эффект, и называть его выигрышем или потерей нельзя');
        // The owner's budget, as a check rather than as prose. Only meaningful as a LOSS.
        block('БЮДЖЕТ ВЛАДЕЛЬЦА: просадка FPS не более 5 %',
          deltaFpsPct >= -5,
          `просадка ${(-deltaFpsPct).toFixed(2)} % при потолке 5 % (бюджет шире пола прибора в `
          + `${(5 / floorPct).toFixed(1)} раза, поэтому приговор законен)`);
      }
      block('сравнение термически законно: старты сошлись',
        a.tempStart != null && b.tempStart != null && Math.abs(a.tempStart - b.tempStart) <= 3,
        `старт ${a.tempStart} → ${b.tempStart} °C, достигнуто ${a.tempC} → ${b.tempC} °C`);
    }
  } finally {
    watchdog?.beat();
    // The power cap is undone FIRST and re-read, because it is the write that outlives a crash least
    // visibly: a card left at 250 W looks perfectly healthy and is quietly slower forever after.
    if (powerLimitApplied && pmBackend) {
      const st = pm.readState(pmBackend);
      pmBackend.setPowerLimitWatts(st.powerDefaultW);
      let backOk = false;
      let backDetail = '';
      try {
        const proof = await pm.readBack(pmBackend, (s) => Math.abs(s.powerLimitW - st.powerDefaultW) < 0.5,
          { what: `потолок мощности должен вернуться на ${st.powerDefaultW} Вт` });
        backOk = true;
        backDetail = `${proof.value.powerLimitW} Вт, устойчиво за ${proof.agreedAfterMs} мс`;
      } catch (e) { backDetail = e.message; }
      block('ОТКАТ: потолок мощности возвращён к заводскому и перечитан', backOk, backDetail);
    }
    if (touched) {
      const back = nvapi.zeroCurve(nv, handle);
      block('ОТКАТ: кривая обнулена одним писателем, ненулевых не осталось', back.ok,
        `отказов ${back.failed} · ненулевых ${back.remainingNonZero} из 128`);
    }
    watchdog?.disarm();
    nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload);
  }

  return out;
}

// =================================================================================================
// CLI
// =================================================================================================

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function mainAscend() {
  const capMhz = Number(arg('cap', 2842));
  const stepMhz = process.argv.includes('--fine') ? ASCENT_FINE_MHZ : Number(arg('step', ASCENT_COARSE_MHZ));
  const maxMhz = Number(arg('max', 150));
  const seconds = Number(arg('seconds', 30));

  console.log('ВОСХОЖДЕНИЕ ПО КРИВОЙ — researches/02 §3, шаги 1–2');
  console.log('');
  console.log(`  ЧТО ДЕЛАЕМ: поднимаем ВСЮ кривую шагами +${stepMhz} МГц до +${maxMhz}, на каждом шаге судим оракулом.`);
  console.log(`  МЕРА:       насколько подешевела частота ${capMhz} МГц — какая точка её обслуживает.`);
  console.log(`  ПЕРЕВОД:    шаг +${ASCENT_FINE_MHZ} МГц ≈ 5 мВ (точный режим), +${ASCENT_COARSE_MHZ} ≈ 25 мВ (грубый) — по замеру этой кривой.`);
  console.log('  ОСТАНОВКА:  первый вердикт, отличный от PASS. У края НЕ задерживаемся — сразу откат.');
  console.log('  ОТКАТ:      вся кривая в ноль, в finally, под сторожем на весь прогон.');
  console.log('');

  const r = await runAscent({ capMhz, stepMhz, maxMhz, seconds });

  if (r.stockVolt) console.log(`СТОК: ${capMhz} МГц обслуживает точка ${r.stockVolt.pointIndex} — ${r.stockVolt.mv} мВ`);
  console.log('');
  console.log('  сдвиг | обслуж. точка |    мВ | экономия |  °C | вердикт');
  for (const s of r.steps) {
    console.log(`  ${String('+' + s.offsetMhz).padStart(6)} | ${String(s.servingPoint).padStart(13)} | ${String(s.mv).padStart(5)} | ${String('-' + s.savedMv + ' мВ').padStart(8)} | ${String(s.tempC).padStart(3)} | ${s.verdict}`);
  }
  console.log('');
  console.log(`ОСТАНОВЛЕНО: ${r.stoppedBy}`);
  console.log(`НАИБОЛЬШИЙ СДВИГ, ПРОШЕДШИЙ В ЭТОМ ПРОГОНЕ: +${r.bestPassMhz} МГц`);
  const best = r.steps.filter((s) => s.verdict === config.VERDICT.PASS).pop();
  if (best) console.log(`  ему соответствует ${best.mv} мВ на ${capMhz} МГц вместо ${r.stockVolt?.mv} — на ${best.savedMv} мВ дешевле`);
  console.log('');
  console.log('ЧТО ЭТО НЕ ЗНАЧИТ: это НЕ предел и НЕ профиль. Отказ вероятностный (researches/02 §6.4),');
  console.log('прогнана одна нагрузка, запас надёжности не применён.');
  console.log(`ОТКАТ: ${r.rolledBack ? 'выполнен' : 'НЕ ВЫПОЛНЕН — РАЗБИРАТЬСЯ'} — ${r.rollbackDetail}`);
  return r.rolledBack ? 0 : 1;
}

async function mainMeasure() {
  const capMhz = Number(arg('cap', 2842));
  const offsetMhz = Number(arg('mhz', 180));
  const seconds = Number(arg('seconds', 30));

  console.log('ЗАМЕР АНДЕРВОЛЬТА В ВАТТАХ — обе стороны на ОДНОЙ закреплённой частоте');
  console.log('');
  console.log(`  ЧТО СРАВНИВАЕМ: сток против кривой +${offsetMhz} МГц, обе на ${capMhz} МГц.`);
  console.log('  ЗАЧЕМ ЗАМОК:    без него подъём кривой покупает скорость, а не ватты, и два замера');
  console.log('                  на разных частотах — не дельта, а два разных опыта.');
  console.log('  ПОРОГ:          собственный разброс прибора 1,28 Вт. Тоньше — это НЕ эффект.');
  console.log('  ОТКАТ:          кривая в ноль и замок снят, в finally, под сторожем.');
  console.log('');

  const r = await measureUndervolt({ capMhz, offsetMhz, seconds });

  if (r.sides.length) {
    console.log('  сторона        | обслуж. точка |    мВ |     Вт |  МГц |  °C | вент | вердикт');
    for (const s of r.sides) {
      console.log(`  ${String(s.tag).padEnd(14)} | ${String(s.servingPoint).padStart(13)} | ${String(s.mv).padStart(5)} | ${String(s.watts).padStart(6)} | ${String(s.clockMhz).padStart(4)} | ${String(s.tempC).padStart(3)} | ${String(s.fan).padStart(4)} | ${s.verdict}`);
    }
    console.log('');
  }
  for (const b of r.blocks) console.log(`  ${b.ok ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}  ${b.name}${b.detail ? `\n            ${b.detail}` : ''}`);
  if (r.delta) {
    console.log('');
    console.log(`ИТОГ: ${r.delta.watts} Вт (${r.delta.percent} %) на ${capMhz} МГц, пол прибора ${r.delta.floorW} Вт.`);
  }
  const failed = r.blocks.filter((b) => !b.ok).length;
  return failed === 0 ? 0 : 1;
}

async function mainShape() {
  const deltaMhz = Number(arg('mhz', 45));
  const seconds = Number(arg('seconds', 30));
  const coolToC = Number(arg('cool-to', 42));
  const capArg = arg('cap-at', null);
  const capAtMhz = capArg === null ? null : Number(capArg);
  const dryRun = process.argv.includes('--dry-run');
  const load = arg('load', 'compute');
  const gfxRuns = Number(arg('gfx-runs', config.Q2RTX_TIMEDEMO_RUNS));
  const gfxBounceRays = Number(arg('gfx-bounce', config.Q2RTX_BOUNCE_RAYS));
  const plArg = arg('pl', null);
  const powerLimitW = plArg === null ? null : Number(plArg);

  console.log('ФОРМА ПРОФИЛЯ — ТО, ЧТО ПОПРОСИЛ ВЛАДЕЛЕЦ, ПРОВЕРЕННОЕ ТРЕМЯ НАБЛЮДЕНИЯМИ');
  console.log('');
  console.log('  ЕГО СЛОВА: «карта сама могла и разгоняться и снижать частоты, но работала на');
  console.log('             пониженном напряжении согласно кривой VF профиля».');
  console.log(`  ЧТО ПИШЕМ: вся кривая вверх на +${deltaMhz} МГц, а выше ПОТОЛКА не предлагается ничего.`);
  console.log(`  ПОТОЛОК:   ${capAtMhz === null ? 'стоковая РАБОЧАЯ частота, измеренная в этом же прогоне' : `${capAtMhz} МГц (задан)`}.`);
  console.log('             Замерено: потолок на ВЕРХУ кривой не связывает ничего — под нагрузкой карта');
  console.log('             туда не доходит, и подъём уходит в скорость (2887 → 2932 МГц при тех же 137 Вт).');
  console.log('             Фиксации частоты (-lgc) НЕТ вовсе — карта свободна и вверх, и вниз.');
  console.log('  ПРОВЕРЯЕМ: (1) под нагрузкой берётся стоковый максимум и НЕ выше — иначе экономия');
  console.log('             ушла в скорость; (2) на простое частота по-прежнему падает — иначе это');
  console.log('             прикол; (3) ту же частоту обслуживает точка с МЕНЬШИМ напряжением.');
  console.log(`  ЧЕСТНОСТЬ: обе стороны стартуют с ${coolToC} °C — иначе это два опыта, а не дельта.`);
  console.log('  ОТКАТ:     вся кривая в ноль одним писателем, в finally, под сторожем.');
  if (dryRun) console.log('  РЕЖИМ:     СУХОЙ ПРОГОН — записи не будет.');
  console.log('');

  const r = await runShapeExperiment({ deltaMhz, seconds, coolToC, capAtMhz, dryRun, load, gfxRuns, gfxBounceRays, powerLimitW });

  if (r.sides.length) {
    const isGfx = r.load === 'graphics';
    console.log(`  сторона        |  МГц |     Вт |  °C | старт °C | вент | ${isGfx ? '      FPS' : '     оп/с'} | вердикт`);
    for (const s of r.sides) {
      const price = isGfx ? (s.fps == null ? '—' : s.fps.toFixed(3)) : String(s.opsPerSec);
      const verdict = s.verdict ?? (s.faultFree ? 'БЕЗ СБОЕВ' : 'НЕИЗВЕСТНО');
      console.log(`  ${String(s.tag).padEnd(14)} | ${String(s.clockMhz).padStart(4)} | ${String(s.watts).padStart(6)} | ${String(s.tempC).padStart(3)} | ${String(s.tempStart).padStart(8)} | ${String(s.fan).padStart(4)} | ${price.padStart(9)} | ${verdict}`);
    }
    console.log('');
  }
  for (const b of r.blocks) console.log(`  ${b.ok ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}  ${b.name}${b.detail ? `\n            ${b.detail}` : ''}`);

  const failed = r.blocks.filter((b) => !b.ok).length;
  console.log('');
  if (r.delta) console.log(`ИТОГ ПО ВАТТАМ: ${r.delta.watts} Вт (${r.delta.percent} %), пол прибора ${r.delta.floorW} Вт.`);
  if (r.deltaFps) console.log(`ИТОГ ПО КАДРАМ: ${r.deltaFps.percent > 0 ? '+' : ''}${r.deltaFps.percent} % (${r.deltaFps.a.toFixed(3)} → ${r.deltaFps.b.toFixed(3)} FPS), пол прибора ${r.deltaFps.floorPct} %, бюджет владельца 5 %.`);
  console.log(`ИТОГ: блоков ${r.blocks.length}, провалов ${failed}.`);
  console.log('ЧТО ЭТО НЕ ЗНАЧИТ: форма профиля доказана, САМ ПРОФИЛЬ — нет. Ни запаса, ни разнородного');
  console.log('набора, ни длинного прожига (plans/05 §4.3, §4.6, §4.7).');
  return failed === 0 ? 0 : 1;
}

async function main() {
  if (process.argv.includes('--shape')) return mainShape();
  if (process.argv.includes('--measure')) return mainMeasure();
  if (process.argv.includes('--ascend')) return mainAscend();
  const point = Number(arg('point', DEFAULT_POINT));
  const offsetMhz = Number(arg('mhz', DEFAULT_STEP_MHZ));
  const workload = String(arg('workload', 'sdc_fma'));
  const seconds = Number(arg('seconds', 30));
  const sustain = Number(arg('sustain', 10));
  const dryRun = process.argv.includes('--dry-run');
  const allPoints = process.argv.includes('--all-points');
  const capArg = arg('cap', null);
  const capMhz = capArg === null ? null : Number(capArg);
  // THE DIVERSE SET as an operator command (plans/05 §4.3). One write, one watchdog, three loads:
  // the shape that decides the point is named in the block list.
  const useSet = process.argv.includes('--set');
  const stress = await import('./stress-tester.mjs');
  const shapes = useSet ? stress.DIVERSE_SET : null;

  console.log('ПЕРВЫЙ ПОЛОЖИТЕЛЬНЫЙ СДВИГ — ЭТО И ЕСТЬ АНДЕРВОЛЬТ');
  console.log('');
  console.log(`  ЧТО ДЕЛАЕМ: ${allPoints ? `ВСЯ КРИВАЯ вверх на +${offsetMhz} МГц` : `точка ${point}, сдвиг +${offsetMhz} МГц`}`);
  console.log('              — «эта частота теперь берётся при МЕНЬШЕМ напряжении».');
  if (allPoints) {
    console.log('              Вся кривая, а не одна точка: закреплённую частоту обслуживает БЛИЖАЙШАЯ');
    console.log('              подходящая точка, поэтому подъём одной ничего не удешевляет (researches/02 §6.2).');
  }
  if (capMhz) console.log(`  ПОТОЛОК:    ${capMhz} МГц — на этой частоте и меряется удешевление (пока ВЫЧИСЛЯЕТСЯ по кривой, замок не ставится).`);
  if (shapes) {
    console.log(`  НАБОР:      ${shapes.length} формы по ${seconds} с, порог точки = ХУДШАЯ из них:`);
    for (const s of shapes) console.log(`              · ${s.id}`);
    console.log('              Vmin расходится между ПРОГРАММАМИ до 100 мВ (researches/02 §4), поэтому');
    console.log('              край одной нагрузки — это край одной нагрузки, а не карты.');
    console.log('              Самая чувствительная идёт первой; после первого не-PASS остальные НЕ прогоняются.');
  } else {
    console.log(`  НАГРУЗКА:   ${workload}, ${seconds} с, устойчивыми пачками по ${sustain} с (ОДНА форма; набор — флаг --set).`);
  }
  console.log('  ОРАКУЛ:     сумма против эталона И журнал Windows И работа в секунду — «не упало» вердиктом не является.');
  console.log('  ОТКАТ:      тот же вызов со сдвигом 0, в finally, на любом пути.');
  console.log('  СТОРОЖ:     взводится ДО записи и продлевается самой нагрузкой; при зависании');
  console.log('              отдельный процесс вернёт карту к заводскому состоянию сам.');
  if (dryRun) console.log('  РЕЖИМ:      СУХОЙ ПРОГОН — записи не будет.');
  console.log('');

  const r = await runStep({ point, offsetMhz, workload, seconds, sustain, dryRun, allPoints, capMhz, shapes });
  for (const b of r.blocks) console.log(`  ${b.ok ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}  ${b.name}${b.detail ? `\n            ${b.detail}` : ''}`);

  const failed = r.blocks.filter((b) => !b.ok).length;
  console.log('');
  console.log(`ИТОГ: блоков ${r.blocks.length}, провалов ${failed}.`);
  if (r.verdict) console.log(`ВЕРДИКТ ТОЧКИ ${r.point} НА ШАГЕ +${r.offsetMhz} МГц: ${r.verdict}`);
  if (r.worstShape) console.log(`РЕШИЛА ФОРМА: ${r.worstShape}${r.judged?.skipped?.length ? ` · не прогонялись: ${r.judged.skipped.join(', ')}` : ''}`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((c) => process.exit(c)).catch((e) => { console.error(`ОШИБКА: ${e.message}`); process.exit(1); });
}
