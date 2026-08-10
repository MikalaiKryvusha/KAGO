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
    const ttlMs = (seconds + 60) * 1000;
    watchdog = wd.arm({ what: `АНДЕРВОЛЬТ: точка ${point} (+${offsetMhz} МГц), нагрузка ${workload}`, ttlMs });
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
    const result = await stress.stressTest({
      name: workload,
      seconds,
      sustain,
      onBurst: () => { watchdog.beat(); },     // the lease is renewed by the load itself
    });
    out.verdict = result.verdict;
    out.stress = {
      verdict: result.verdict,
      reason: result.reason ?? null,
      bursts: result.bursts?.length ?? null,
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

async function main() {
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

  console.log('ПЕРВЫЙ ПОЛОЖИТЕЛЬНЫЙ СДВИГ — ЭТО И ЕСТЬ АНДЕРВОЛЬТ');
  console.log('');
  console.log(`  ЧТО ДЕЛАЕМ: ${allPoints ? `ВСЯ КРИВАЯ вверх на +${offsetMhz} МГц` : `точка ${point}, сдвиг +${offsetMhz} МГц`}`);
  console.log('              — «эта частота теперь берётся при МЕНЬШЕМ напряжении».');
  if (allPoints) {
    console.log('              Вся кривая, а не одна точка: закреплённую частоту обслуживает БЛИЖАЙШАЯ');
    console.log('              подходящая точка, поэтому подъём одной ничего не удешевляет (researches/02 §6.2).');
  }
  if (capMhz) console.log(`  ПОТОЛОК:    ${capMhz} МГц — на этой частоте и меряется удешевление (пока ВЫЧИСЛЯЕТСЯ по кривой, замок не ставится).`);
  console.log(`  НАГРУЗКА:   ${workload}, ${seconds} с, устойчивыми пачками по ${sustain} с.`);
  console.log('  ОРАКУЛ:     сумма против эталона И журнал Windows И работа в секунду — «не упало» вердиктом не является.');
  console.log('  ОТКАТ:      тот же вызов со сдвигом 0, в finally, на любом пути.');
  console.log('  СТОРОЖ:     взводится ДО записи и продлевается самой нагрузкой; при зависании');
  console.log('              отдельный процесс вернёт карту к заводскому состоянию сам.');
  if (dryRun) console.log('  РЕЖИМ:      СУХОЙ ПРОГОН — записи не будет.');
  console.log('');

  const r = await runStep({ point, offsetMhz, workload, seconds, sustain, dryRun, allPoints, capMhz });
  for (const b of r.blocks) console.log(`  ${b.ok ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}  ${b.name}${b.detail ? `\n            ${b.detail}` : ''}`);

  const failed = r.blocks.filter((b) => !b.ok).length;
  console.log('');
  console.log(`ИТОГ: блоков ${r.blocks.length}, провалов ${failed}.`);
  if (r.verdict) console.log(`ВЕРДИКТ ТОЧКИ ${r.point} НА ШАГЕ +${r.offsetMhz} МГц: ${r.verdict}`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((c) => process.exit(c)).catch((e) => { console.error(`ОШИБКА: ${e.message}`); process.exit(1); });
}
