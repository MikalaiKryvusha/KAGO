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
// [NOT-TESTED] at birth.

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
// CLI
// =================================================================================================

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function main() {
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
