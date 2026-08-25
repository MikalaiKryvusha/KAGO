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
//  UPDATE 2026-08-11 07:0x — THE MODULE NOW HAS AN OFFLINE SELFTEST, and the line below is corrected
//  rather than deleted, because the debt it named is what the incident collected on. `--selftest`:
//  16 blocks over the UNDO SHAPE (a throwing step must not cancel the ones behind it) and the voltage
//  ladder, mutation-proved with three mutations, each reddening the block named for it before the
//  run — including one that restores the abort-on-throw the `finally` used to have. What is still
//  untested offline: the write path itself, which needs an injected NVAPI seam.
//
//  WHAT WAS *NOT* TESTED, named so nobody reads the marker as more than it says: this module had NO
//  OFFLINE SELFTEST — its logic had never been driven through an injected backend, unlike every other
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

/**
 * RUN EVERY UNDO ACTION, INDEPENDENTLY — the primitive `bugs/03` proved this module needed.
 *
 * A `finally` that owns a rollback usually owns several things: a read that must happen while the
 * state still exists, the release of one resource, the release of another. Written as straight-line
 * code they share one fate — **the first thing that throws cancels everything after it.** That is not
 * a hypothetical: on 2026-08-11 a ReferenceError on the FIRST line of this module's `finally` jumped
 * over the clock release and the curve zeroing entirely. Nothing was left applied that time, by luck
 * of where the run had reached, and luck is not a rollback.
 *
 * So the shape is inverted: the undo is a LIST, each entry runs in its own `try`, a throw becomes a
 * red block rather than an exit, and no entry can prevent the ones behind it. The order is still
 * meaningful — reads that need the state come before the releases that destroy it — but order is now
 * a preference, not a dependency.
 *
 * Nothing is swallowed: a thrown error becomes `ok: false` with its message in the detail, so a
 * failed undo is LOUD. Silence would be the worse defect (EXP-0029: a tool whose refusals are mute
 * trains its reader to treat silence as success).
 *
 * EVERY BLOCK CARRIES `undo: true`, and that field is not decoration — it is what lets a CALLER ask
 * «did the card come back?» without matching on block NAMES. Added 2026-08-15 with `plans/15` §4.3:
 * the sweep must never call a rung PASSED while the rollback of that same rung failed, and the only
 * other way to recognise these blocks from outside would be a string prefix — i.e. a truth↔mirror
 * pair invented on purpose, drifting the first time a name is reworded (`AGENT_GUIDE.md` → the pairs
 * registry: a pair that can be REMOVED beats a pair that must be watched).
 *
 * @param {Array<{name:string, run:function}>} actions
 * @returns {Promise<Array<{name:string, ok:boolean, detail:string, undo:true}>>}
 *
 * [NOT-TESTED]
 */
export async function runUndo(actions) {
  const blocks = [];
  for (const a of actions) {
    // 🔴 ЧТЕНИЕ — НЕ ОТКАТ, И ПУТАТЬ ИХ ДОРОГО (`plans/28`). Список ниже содержит один блок, который
    // ничего не откатывает: доказательство потолка. Оно живёт здесь ради ПОРЯДКА — читать надо, пока
    // закрепление ещё держит, — но `undo: true` на нём означал для вызывающего «карта не вернулась»,
    // а на деле карта возвращалась исправно. Живой прогон 2026-08-23 показал цену: владелец увидел
    // «ОТКАТ НЕ ЧИСТ … состояние карты назвать нельзя» на прогоне, где карта была чиста, а сам агент
    // пошёл проверять кривую вместо того, чтобы прочитать настоящую находку.
    const isProof = a?.kind === 'proof';
    const mark = isProof ? { undo: false, proof: true } : { undo: true, proof: false };
    if (!a || typeof a.run !== 'function') {
      blocks.push({ name: a?.name ?? 'без имени', ok: false, ...mark, detail: 'шаг без исполняемой части — это дефект списка, а не карты' });
      continue;
    }
    try {
      const detail = await a.run();
      blocks.push({ name: a.name, ok: true, ...mark, detail: typeof detail === 'string' ? detail : (detail?.detail ?? '') });
    } catch (e) {
      // ПРИЧИНА, А НЕ ТОЛЬКО ИМЯ. `e.message` здесь — это точный текст, который составил судья
      // (например «карта ушла ВЫШЕ потолка: максимум 2805 МГц при потолке 2790»), и до `plans/28`
      // он доезжал только сюда: вызывающий печатал `b.name` и выбрасывал самое ценное.
      blocks.push({ name: a.name, ok: false, ...mark, detail: `${isProof ? 'проверка не прошла' : 'шаг отката упал'}: ${e.message}`, why: e.message });
    }
  }
  return blocks;
}

/**
 * THE ASCENT LADDER IN VOLTS — the owner's step sizes, finally expressed in the unit he stated them in.
 *
 * He specified the search in millivolts: *«грубый меняет напряжение на 25 мВ… точный — на 5 мВ»*. Our
 * lever is a FREQUENCY offset, and the conversion was hard-coded once, at the top of the curve, where
 * one voltage grid step happens to cost ~15 MHz. Measured on this card's own curve, that exchange rate
 * varies **by a factor of seven across the band**:
 *
 *   2842 MHz →  4.1 MHz per mV      1700 MHz → 22.2 MHz per mV      500 MHz → 3.4 MHz per mV
 *
 * So a fixed 75 MHz coarse step is 18 mV at the top, **3.4 mV in the middle** and 22 mV at the bottom.
 * The same three numbers say it the other way round: a sweep stepping in MHz walks the middle of the
 * band seven times more finely than asked and the bottom three times more coarsely. That is EXP-0034's
 * lesson — the unit you search in is not the unit the conclusion is about — applied to the STEP rather
 * than to the result.
 *
 * The fix needs no new physics: the curve IS the conversion table. Walking the serving point DOWN by
 * N curve points is walking it down N voltage grid steps, whatever the frequencies happen to be. So
 * this returns the offsets that put the serving point of `clockMhz` on successively lower points —
 * the ladder in volts, computed per rung from the card in front of us.
 *
 * @returns {Array<{offsetMhz:number, mv:number, pointIndex:number, savedMv:number}>}
 *
 * [NOT-TESTED]
 */
export function ascentLadderByVoltage(points, clockMhz, { stepMv = 25, maxOffsetMhz = config.CLOCK_OFFSET_MAX_MHZ } = {}) {
  const stock = voltageForClock(points, clockMhz);
  if (!stock) return [];

  // EVERY rung's voltage is read off the RESULTING curve, never predicted from the point we aimed at.
  // The naive version — "the offset that makes point P reach the clock, therefore the voltage is P's"
  // — is wrong wherever several points share a frequency, and this card's bottom is exactly that: the
  // lowest ~20 points all sit on the 180 MHz floor, so ONE offset drops the serving voltage all the
  // way to the cheapest of them. Predicting it would have reported six rungs of 30 mV each where the
  // card actually takes one step of 295 mV. That is tonight's own lesson (`bugs/02`): convert through
  // the state, not through a model of it.
  const candidates = [...new Set(points
    .filter((p) => p.freqKhz > 0 && p.microVolts > 0 && p.mv < stock.mv)
    .map((p) => Math.ceil(clockMhz - p.mhz))
    .filter((o) => o > 0 && o <= maxOffsetMhz))]
    .sort((a, b) => a - b);

  const reached = [];
  for (const offsetMhz of candidates) {
    const raised = points.map((p) => (p.freqKhz > 0
      ? { ...p, mhz: p.mhz + offsetMhz, freqKhz: p.freqKhz + offsetMhz * 1000 }
      : p));
    const v = voltageForClock(raised, clockMhz);
    if (!v || v.mv >= stock.mv) continue;
    // Keep the CHEAPEST offset that reaches each distinct voltage: a bigger offset that lands on the
    // same voltage buys nothing and costs the card a bigger frequency excursion.
    if (!reached.length || v.mv < reached[reached.length - 1].mv) {
      reached.push({ offsetMhz, mv: v.mv, pointIndex: v.pointIndex, savedMv: Number((stock.mv - v.mv).toFixed(3)) });
    }
  }

  // Thin the reachable list down to the requested voltage step — the owner's «grubo 25 mV / tochno
  // 5 mV», expressed in the unit he said it in. A curve region too coarse to offer a 25 mV rung
  // yields whatever it has, and a region that offers many yields every 25th millivolt.
  const ladder = [];
  let lastTaken = 0;
  for (const r of reached) {
    if (r.savedMv - lastTaken >= stepMv || !ladder.length) { ladder.push(r); lastTaken = r.savedMv; }
  }
  return ladder;
}

export function voltageForClock(points, clockMhz) {
  const usable = points
    .filter((p) => p.freqKhz > 0 && p.microVolts > 0 && p.mhz >= clockMhz)
    .sort((a, b) => a.microVolts - b.microVolts);
  return usable.length ? { pointIndex: usable[0].i, mv: usable[0].mv, mhz: usable[0].mhz } : null;
}

/**
 * WHICH CLOCK THE RE-READ ASKS ABOUT — the ordered one, or the one the card actually offers.
 * [NOT-TESTED] at birth; the offline blocks in `--selftest` are what flip this.
 *
 * `bugs/22`. In the shipped shape the ceiling sits ON the frequency under test, so the raise lands
 * the curve's top EXACTLY on it — margin 0.0 MHz, measured offline against the live factory curve at
 * four different raises. `voltageForClock` needs a point at `mhz >= clock`; the moment the actual top
 * comes out one grid step low, NOTHING serves the ordered clock, and a rung that PASSED is thrown
 * away with «the card did not say which voltage served the frequency». One grid step is ≈ 4 °C of
 * table drift (R14b), and the live log shows the table moving 23 MHz between two reads seconds apart.
 * So the zero margin is not a tolerance that is usually enough — it is one that is never enough for
 * long, which is why the run died at 2 frequencies of 266.
 *
 * The rule is the owner's, reaching its third place rather than being invented here: *«хотим заказать
 * N, она нам выдала M — примиряемся с её выдачей и тюним то, что она нам даёт»* (`GOAL.md` → «🎚 ТЮНИМ
 * ТО, ЧТО КАРТА ВЫДАЁТ»), already governing the document's row and the voltage axis.
 *
 * **It only ever asks LOWER, never higher**, and that direction is the whole safety argument: asking
 * about a clock ABOVE the ceiling would be a verdict about a frequency the card was never allowed to
 * reach — the `bugs/02` class. Buying the margin by raising the ceiling instead was rejected for
 * exactly that reason. On a cold card the two numbers are equal, so no already-measured value moves.
 */
export function askAtClockMhz(orderedMhz, offeredAfterMhz) {
  if (!Number.isFinite(orderedMhz) || orderedMhz <= 0) return null;
  if (!Number.isFinite(offeredAfterMhz) || offeredAfterMhz <= 0) return orderedMhz;
  return Math.min(orderedMhz, offeredAfterMhz);
}

/**
 * THE THREE WRITE SHAPES, NAMED — and which one a run is allowed to use.
 *
 * `bugs/02` step 1: *«The search must write the PROFILE'S OWN SHAPE… searching in the same shape the
 * profile ships makes the searched quantity and the shipped quantity the same thing.»* The shipped
 * shape is `buildRaiseAndCapVector` — the whole curve raised, with a CEILING. What the search wrote
 * instead was a UNIFORM raise of all 127 points, held down by a clock pin.
 *
 * The two differ in one thing that matters and one that does not, and both were computed on the curve
 * before a single watt was spent (2026-08-14):
 *
 *   • **They do NOT differ in the measured voltage.** A point serves clock C iff `F_i + Δ ≥ C`, and
 *     the ceiling does not touch that condition, so the serving point and its millivolts are identical
 *     under both shapes for every clock ≤ cap (checked at 2842 / 2400 / 2172 against Δ = 45 / 180 /
 *     300 — same point index, same voltage, nine of nine). Switching shapes therefore moves no number
 *     this project has already measured.
 *   • **They differ in what the card may do ABOVE the tested clock.** A uniform raise leaves the tail
 *     offering `F_top + Δ` — a state the shipped profile never has, and the very mechanism that made
 *     `bugs/02`'s run fail at ~3400 MHz while reporting a number about 2842. The shipped shape pushes
 *     that tail down onto the ceiling, so a failure belongs to the clock under test.
 *
 * **THE RULE THIS FUNCTION ENFORCES: a ceiling must be HELD BY SOMETHING, and the run says by what.**
 * The curve holds it when it can; below `topMhz − 1000` it cannot (the hardware's offset range runs
 * out — `nvapi.buildRaiseAndCapVector`, floor 2172 MHz on this card), and there the measurement's
 * clock pin is the holder. If neither holds it, this refuses — a run whose ceiling nothing enforces
 * measures a state nobody can name.
 *
 * Pure, and it takes the already-built vector rather than the curve, so the arithmetic has ONE author
 * (`buildRaiseAndCapVector`) and this function only decides.
 *
 * @param {object} vector  the result of `nvapi.buildRaiseAndCapVector`
 * @param {{pinned:boolean}} opts
 * @returns {{ok:boolean, shape:string|null, heldBy:string|null, why:string}}
 *
 * [NOT-TESTED] at birth — the offline blocks in `--selftest` are what flip this.
 */
/**
 * DID THE BURN HAPPEN AT THE FREQUENCY WE ARE TUNING? — one judgement, both directions.
 *
 * The owner, 2026-08-22: *«прожигать карту нужно на той частоте, которую тюним»* ·
 * *«инструмент должен видеть, прожигает ли он именно ту частоту, которую тюнит»*.
 *
 * Until this function existed only ONE direction was judged — the card going ABOVE the ceiling,
 * i.e. «the ceiling did not hold». Going BELOW passed in silence, and that is the more dangerous
 * half: the PASS is filed against the frequency we ORDERED while the burn ran LOWER, where the
 * silicon has an easier job. The voltage recorded is then too low for the frequency whose name is
 * on the row. That is `bugs/28`, measured as 13 rungs out of 14 burned at 2865–2872 MHz and filed
 * as 2880.
 *
 * WHICH STATISTIC FOR WHICH DIRECTION, and the asymmetry is deliberate:
 *   · UP   — judged by the MAXIMUM. A ceiling is a promise about every instant; one sample above it
 *            means it was breached, however briefly.
 *   · DOWN — judged by the MEDIAN. «Which frequency did the burn run at» is about where the card
 *            SAT; a single low sample is a transient (a boost transition, a sampling artefact) and
 *            treating it as the answer would refuse healthy rungs.
 *
 * Tolerance is ONE ladder step in both directions, for the same reason: the card's clock grid is
 * 7–8 MHz and `clocks.gr` is reported on it, so one step is rounding, not a finding.
 *
 * [NOT-TESTED] at birth — flipped by the blocks in `--selftest` and their mutations.
 */
export function judgeDeliveredClock({ capMhz, median, max, samples = null, offeredAfterMhz = null,
                                      toleranceMhz = config.CLOCK_LADDER_STEP_TOLERANCE_MHZ } = {}) {
  const base = { capMhz, median, max, samples, offeredAfterMhz, shortfall: null,
                 breached: false, short: false, breachHolder: null };
  if (!Number.isFinite(capMhz) || !Number.isFinite(median)) {
    return { ...base, ok: false, why: 'нечего судить: не названы ни потолок, ни выданная частота' };
  }
  const top = Number.isFinite(max) ? max : median;
  const shortfall = capMhz - median;
  const breached = top > capMhz + toleranceMhz;
  const short = shortfall > toleranceMhz;
  if (breached) {
    // ─── ПРОБИТЫЙ ПОТОЛОК — ЭТО ДВА РАЗНЫХ ОТКАЗА, И ДО 2026-08-25 ОНИ ПЕЧАТАЛИСЬ ОДНОЙ СТРОКОЙ ───
    //
    // `bugs/50`, замер по журналу: у шести ступеней последней полосы `writeSettled: true`,
    // поточечная сверка зелёная, а `offeredAfterMhz` РАВЕН потолку — форма записи встала. И при
    // этом три из шести карта под нагрузкой отработала выше него (+15, +23, +23 МГц). Ровно один
    // случай за всю историю журнала (`seq 702`) устроен наоборот: кривая ПОСЛЕ записи сама
    // предлагала на 15 МГц выше потолка, чего вектор не может дать по арифметике
    // (`offset_i = min(Δ, потолок − F_i)`), и он назван классом записи C3.
    //
    // Различитель — ОДНО сравнение над числом, которое на месте вызова уже лежит. Без него оператор
    // видит одну строку там, где в одном случае чинят КОД пути записи, а в другом МЕРЯЮТ КАРТУ:
    // это тот же дефект «остановка называет симптом», который фаза 4 эпика 36 закрывала ярусом ниже
    // (`plans/39`, пункт 2).
    //
    // Третье значение существует по правилу трёх дверей (`PHILOSOPHY.md`): если кривую после записи
    // не перечитали, назвать держателя НЕЧЕМ, и выдумывать его нельзя. Это тот же ход, что
    // `unclassified` у классификатора записи, и по той же причине.
    const holder = !Number.isFinite(offeredAfterMhz) ? 'НЕИЗВЕСТНО'
      : (offeredAfterMhz > capMhz ? 'ЗАПИСЬ' : 'КАРТА');
    const over = Number((top - capMhz).toFixed(1));
    const why = holder === 'ЗАПИСЬ'
      ? `ФОРМА НЕ ВСТАЛА: кривая после записи сама предлагает ${offeredAfterMhz} МГц при потолке `
        + `${capMhz}, и карта ушла ВЫШЕ потолка — максимум ${top} МГц. Отказ на пути ЗАПИСИ, `
        + 'его класс называет отдельное поле'
      : holder === 'КАРТА'
        ? `ФОРМА УСТОЯЛА, КАРТА ЕЁ НЕ СОБЛЮЛА: кривая после записи не предлагает выше `
          + `${offeredAfterMhz} МГц, а карта ушла ВЫШЕ потолка — максимум ${top} МГц при потолке `
          + `${capMhz} (+${over}). Путь записи здесь ни при чём: это наблюдение О КАРТЕ`
        : `карта ушла ВЫШЕ потолка: максимум ${top} МГц при потолке ${capMhz} — кривая после записи `
          + 'не перечитана, и назвать, устояла ли форма, нечем';
    return { ...base, shortfall, breached: true, breachHolder: holder, ok: false, why };
  }
  if (short) {
    return { ...base, shortfall, short: true, ok: false,
      why: `прожиг шёл НЕ НА ТОЙ ЧАСТОТЕ: медиана ${median} МГц против настраиваемых ${capMhz} `
        + `(недобор ${shortfall} МГц). Вердикт об этом напряжении был бы вердиктом о другой частоте` };
  }
  return { ...base, shortfall, ok: true,
    why: `прожиг шёл на настраиваемой частоте: медиана ${median} МГц при потолке ${capMhz}` };
}

/**
 * ЧТО СТУПЕНЬ ДЕЛАЕТ С ВЕРДИКТОМ ПОТОЛКА — недобор ЗАПИСЫВАЕТСЯ, превышение ОСТАНАВЛИВАЕТ.
 *
 * Извлечено из тела блока «ПОТОЛОК» 2026-08-23 ради одной вещи: решение стало ПРОВЕРЯЕМЫМ без
 * карты. До извлечения оно жило внутри замыкания `runStep`, которое тянет `nvapi`, сторожа и
 * оракула, — то есть офлайн не вызывалось вовсе, и мутация «вернуть `throw` на недобор» оставляла
 * все 952 блока батареи зелёными (замерено 2026-08-23 09:39, `plans/25` шаг 1.2).
 *
 * ⚠️ ЭТО НЕ КОПИЯ РЕШЕНИЯ, А САМО РЕШЕНИЕ. Блок `runStep` вызывает эту функцию и больше ничего о
 * потолке не решает — иначе получилась бы пара «истина↔зеркало» внутри одного модуля, ровно тот
 * класс, который проект уже ловил (EXP-0077: два места назвали частоту ступени, и мутация не
 * покраснила ничего).
 *
 * Два исхода означают ПРОТИВОПОЛОЖНЫЕ вещи (канон 2026-08-22, `GOAL.md` → «УПРАВЛЯЕМАЯ ВЕЛИЧИНА
 * СТУПЕНИ — НАПРЯЖЕНИЕ, А НЕ ЧАСТОТА»):
 *   `breached` — карта ушла ВЫШЕ потолка: отгружаемая форма не удержалась. Вердикт снимается,
 *                функция БРОСАЕТ, ступень краснеет.
 *   `short`    — карта не добрала до потолка: это то, что она делает всегда при сниженном
 *                напряжении, и это и есть измеряемая величина. Вердикт не трогается, ничего не
 *                бросается, факт остаётся в `out.clockShortfall` для отчёта.
 *
 * @param {object} out    запись ступени (мутируется — это её собственный отчёт)
 * @param {object} j      вердикт `judgeDeliveredClock`
 * @param {{capMhz:number, median:number, max:number, loadedSamples:number}} obs
 * @returns {string} строка-подробность для зелёного блока
 * @throws {Error} только когда потолок ПРОБИТ
 *
 * [NOT-TESTED] at birth — flipped by the blocks in `--selftest` and their mutations BX–BZ.
 */
export function applyCeilingJudgement(out, j, { capMhz, median, max, loadedSamples = null } = {}) {
  out.ceilingProof = { ok: !j.breached, capMhz, median, max };
  out.clockHeldProof = j;
  out.deliveredShortfallMhz = j.shortfall;
  if (j.short) out.clockShortfall = true;
  if (j.breached) {
    // ДЕРЖАТЕЛЬ ПРОБИТОГО ПОТОЛОКА ЕДЕТ ПОЛЕМ, А НЕ ТОЛЬКО ВНУТРИ РАССКАЗА (`bugs/50`). Сводка
    // прогона группирует пропущенные частоты ПО КЛАССУ — слово владельца 2026-08-24: «три частоты
    // с одной причиной — это один дефект, а не три случая», — а группировать по строке нельзя:
    // в неё входят числа самой ступени.
    out.ceilingBreachHolder = j.breachHolder ?? null;
    if (out.verdict === config.VERDICT.PASS) { out.verdict = null; out.pinRefused = true; }
    out.reason = j.why;
    throw new Error(j.why);
  }
  const tail = j.short
    ? ` — НЕДОБОР ${j.shortfall} МГц до потолка, это замер: строка уйдёт в выданную частоту`
    : ' — карта под потолком и свободна вниз';
  return `выдано ${median} МГц (максимум ${max}) при потолке ${capMhz}${tail}, ${loadedSamples} проб под нагрузкой`;
}

export function chooseWriteShape(vector, { pinned = false, demandPin = false } = {}) {
  if (!vector || vector.ok !== true) {
    return { ok: false, shape: null, heldBy: null, pinRequired: false, why: `вектор не построен: ${vector?.why ?? 'нет данных кривой'}` };
  }

  // ─── THE OWNER'S ALGORITHM, STEP 7 — AND IT OVERRIDES EVERYTHING BELOW ──────────────────────────
  //
  // `ideas/03` step 7, in his own capitals: *«Ставится частота. ОНА ФИКСИРУЕТСЯ В ВИДЕОКАРТЕ.
  // ВИДЕОКАРТА БЛОКИРУЕТСЯ РАБОТАТЬ ИМЕННО НА ЭТОЙ ЧАСТОТЕ И НИ НА КАКОЙ ДРУГОЙ НИ ПРИ КАКИХ
  // УСЛОВИЯХ.»* The search measures «what voltage serves frequency F», and that sentence is only true
  // if the card actually RAN at F. A ceiling does not deliver that: a capped card is free below the
  // ceiling and measurably sits 20–30 MHz under it (cap 2887 → 2857, 2917 → 2887, 2842 → 2812), so a
  // voltage proved that way belongs to a clock 20–30 MHz LOWER than the one it would be recorded
  // against. That is a number nobody measured, written into the owner's curve document.
  //
  // ⚠️ **WHY THIS IS NOT A RE-RUN OF THE 2026-08-14 CONFLICT, which is the obvious fear.** That day
  // the run held ONE frequency with TWO mechanisms — a curve cap at 2842 AND a pin at 2842 — and they
  // fought: the cap sat the card at 2812 while the pin demanded exactly 2842, and the lock proof
  // correctly refused three PASSing shapes. The fix taken then removed the PIN. It removed the wrong
  // half. What this branch writes is the owner's shape and it has NO ceiling at all: a uniform raise
  // plus the lock, one holder, nothing to fight. The caller must therefore write NO cap when this
  // shape is chosen — `runRung` passes `capMhz: null`, and that is the half of the contract that
  // lives outside this function.
  //
  // The cost is named rather than hidden: a uniform raise is NOT the shipped profile's shape, because
  // its tail keeps offering `F_top + Δ` (`bugs/02`). Under a lock the card cannot reach that tail, so
  // the measurement is sound — but the shape is a MEASUREMENT INSTRUMENT and every rung says so.
  if (demandPin) {
    if (!pinned) {
      return {
        ok: false, shape: null, heldBy: null, pinRequired: false,
        why: 'АЛГОРИТМ ВЛАДЕЛЬЦА (ideas/03 шаг 7) требует ЗАКРЕПИТЬ карту ровно на испытуемой частоте, '
          + 'а закрепление здесь недоступно (нет лестницы частот карты). Прожигать нечего: без закрепления '
          + 'карта под нагрузкой уйдёт со ступени, и напряжение было бы записано против частоты, на которой она не стояла',
      };
    }
    // WHICH RAISE THE LOCKED SHAPE WRITES depends on whether this vector carries an ENFORCEABLE
    // ceiling — and under `demandPin` that ceiling is the CARD'S ENVELOPE, not the clock under test
    // (`runRung.capForVector`). Above the curve's floor the envelope is enforceable, so the write is
    // a capped raise whose tail cannot exceed the card's maximum — R13 satisfied without weakening it.
    // Below the floor nothing can be capped at all and the raise is uniform, which is the case this
    // engine already ran live in phase 5.
    return {
      ok: true,
      shape: vector.capEnforced ? 'raise-and-cap' : 'uniform',
      heldBy: 'закрепление частоты',
      pinRequired: true,
      why: 'ЧАСТОТА ЗАКРЕПЛЕНА (алгоритм владельца, шаг 7): карта обязана выдать ровно испытуемую частоту, '
        + 'и это проверяется чтением ПОД НАГРУЗКОЙ. '
        + (vector.capEnforced
          ? `Потолок кривой стоит на КОНВЕРТЕ карты (${vector.capMhz} МГц), а не на испытуемой частоте — держатели `
            + 'не спорят: конверт не пускает хвост кривой за максимум экземпляра (R13, bugs/11), частоту держит замок'
          : `потолка нет вовсе — ниже пола кривой (${vector.lowestEnforceableCapMhz} МГц) его не удержать, `
            + 'и держатель остаётся ОДИН')
        + '. Подъём кривой — ИНСТРУМЕНТ ЗАМЕРА, а не отгружаемая форма профиля',
    };
  }

  if (vector.capEnforced) {
    return {
      ok: true,
      shape: 'raise-and-cap',
      heldBy: 'кривая',
      // ONE HOLDER, NEVER TWO — and this field is what stops a caller from adding a second one.
      //
      // Paid for live on 2026-08-14, first band run in the shipped shape: the sweep capped the curve
      // at 2842 AND pinned the clock at 2842. A capped card sits a little BELOW its ceiling (measured
      // three times now: cap 2887 → 2857, cap 2917 → 2887, cap 2842 → 2812 median), so the pin
      // demanded a frequency the curve had just forbidden. The card delivered 2775…2827, the lock
      // proof correctly refused, and a rung whose three load shapes had all PASSED was reported as
      // НЕИЗВЕСТНО. Nothing was wrong with the card — the run had asked two mechanisms to hold one
      // ceiling at one frequency, and they fought.
      pinRequired: false,
      why: `потолок ${vector.capMhz} МГц держит САМА КРИВАЯ (выше пола железа ${vector.lowestEnforceableCapMhz} МГц) — `
        + 'это ровно та форма, которая отгружается в профиле. ЗАКРЕПЛЕНИЕ ЗДЕСЬ ЛИШНЕЕ И ВРЕДНОЕ: '
        + 'карта под потолком садится чуть ниже него, а замок требует ровно потолок — они дерутся',
    };
  }
  if (pinned) {
    return {
      ok: true,
      shape: 'uniform',
      heldBy: 'закрепление частоты',
      pinRequired: true,
      why: `потолок ${vector.capMhz} МГц кривой НЕ удержать (пол железа ${vector.lowestEnforceableCapMhz} МГц, утечка `
        + `${vector.capLeakMhz} МГц), поэтому его держит ЗАКРЕПЛЕНИЕ, а кривая поднимается равномерно. `
        + 'Замер законен, но это НЕ отгружаемая форма — на этой ступени они расходятся, и расхождение названо',
    };
  }
  return {
    ok: false,
    shape: null,
    heldBy: null,
    pinRequired: false,
    why: `ОТКАЗ: потолок ${vector.capMhz} МГц не держит НИЧТО — кривой его не удержать (пол железа `
      + `${vector.lowestEnforceableCapMhz} МГц, утечка ${vector.capLeakMhz} МГц), а частота не закреплена. `
      + 'Карта ушла бы выше испытуемой частоты, и вердикт был бы о состоянии, которое никто не назвал',
  };
}

/**
 * Run one step and judge it.
 *
 * Returns a report rather than printing, so the engine that will loop over this can decide without
 * parsing text.
 */
/**
 * КАКОЙ СДВИГ ПИСАТЬ НА САМОМ ДЕЛЕ — чистая функция, потому что путь записи `runStep` офлайн-шва не
 * имеет (долг, названный в шапке модуля), а решение обязано быть допрашиваемым блоком.
 *
 * ─── ЧТО ОНА ЛЕЧИТ (`bugs/47`) ────────────────────────────────────────────────────────────────────
 *
 * Вызывающий считает сдвиг по СВОЕЙ таблице; вектор строится по таблице, которую атом читает заново,
 * секундами позже. Ось частот едет с нагревом (≈ −1,7 МГц/°C, R14b), ось напряжений стоит. Поэтому
 * точка садится не на цель, а на `цель + (таблица_атома − таблица_вызывающего)`.
 *
 * Замер на карте владельца 2026-08-23 23:52: разошлись на 7 МГц, точка 63 не дотянулась до 2355 МГц,
 * и частоту стала обслуживать точка выше — заказ 845 мВ при стоке 895 обслужило **910**. Дважды
 * подряд, обе ступени на те же 7 МГц (`runs/sweep/journal.jsonl`, seq 692–693).
 *
 * ⚠️ ЦЕЛЬ НЕ НАЗВАНА — НИЧЕГО НЕ ТРОГАЕМ. Опыты, `--drill` и ручные прогоны задают сдвиг НАПРЯМУЮ:
 * у них нет цели, и подменять им число было бы захватом чужого решения.
 *
 * @param {{targetClockMhz:number|null, pointFreqMhz:number|null, askedOffsetMhz:number}} a
 * @returns {{offsetMhz:number, askedOffsetMhz:number, driftMhz:number, recomputed:boolean}}
 *
 * [NOT-TESTED] at birth — блоки в `--selftest` это переворачивают.
 */
export function offsetForTarget({ targetClockMhz = null, pointFreqMhz = null, askedOffsetMhz = null } = {}) {
  const none = { offsetMhz: askedOffsetMhz, askedOffsetMhz, driftMhz: 0, recomputed: false };
  if (!Number.isFinite(targetClockMhz) || !Number.isFinite(pointFreqMhz)) return none;
  const offsetMhz = targetClockMhz - pointFreqMhz;
  return {
    offsetMhz,
    askedOffsetMhz,
    driftMhz: Number.isFinite(askedOffsetMhz) ? askedOffsetMhz - offsetMhz : 0,
    recomputed: true,
  };
}

export async function runStep({
  point = DEFAULT_POINT,
  offsetMhz = DEFAULT_STEP_MHZ,
  /**
   * ЧАСТОТА, НА КОТОРУЮ ЦЕЛИТСЯ ЭТА СТУПЕНЬ — `bugs/47`, и это НЕ дубликат `capMhz`.
   *
   * Когда она названа, атом ПЕРЕСЧИТЫВАЕТ `offsetMhz` по СВОЕЙ таблице вместо того, чтобы применять
   * число, посчитанное вызывающим по ЕГО таблице. Пара «правда ↔ зеркало», разнесённая во времени,
   * СХЛОПЫВАЕТСЯ, а не ставится под наблюдение — реестр пар в `AGENT_GUIDE.md` предпочитает именно это.
   *
   * 🔴 ЦЕНА, ЗАМЕРЕННАЯ НА КАРТЕ ВЛАДЕЛЬЦА 2026-08-23 23:52. Движок посчитал сдвиг 203 МГц по своей
   * таблице; между его чтением и чтением атома (запись намерения с `fsync`, преднастройка, взвод
   * сторожа) карта нагрелась, ось частот просела ≈7 МГц (R14b), и точка 63 до 2355 МГц НЕ дотянулась.
   * Частоту стала обслуживать точка выше: заказали 845 мВ при стоке 895 — получили **910**. Прогон
   * встал, покрытие 0 из 7. В журнале это видно дважды подряд, обе ступени промахнулись на те же 7 МГц.
   *
   * ⚠️ ИНДЕКС ТОЧКИ ПРИ ЭТОМ УСТОЙЧИВ, и на этом стоит вся починка: едет ось ЧАСТОТ, ось НАПРЯЖЕНИЙ
   * стоит намертво (R14b). Поэтому `point` от вызывающего остаётся верным, а пересчитать нужно ровно
   * одну величину — насколько поднять, чтобы ЭТА точка добралась до цели.
   *
   * `capMhz` для этого НЕ годится: под замком он несёт КОНВЕРТ, а не испытуемую частоту
   * (`engine.capForVector`), и совпадение двух чисел в обычном случае — совпадение, а не правило.
   */
  targetClockMhz = null,
  workload = 'sdc_fma',
  seconds = 30,
  sustain = 10,
  dryRun = false,
  allPoints = false,
  // WHICH SHAPE GOES INTO THE CURVE — `bugs/02` step 1, and the reason this parameter exists at all.
  //
  //   'point'         one point moves. The historical atom. It CANNOT cheapen the clock it claims to
  //                   test (the clock is served by a neighbour we did not touch) — this is the defect
  //                   `bugs/02` is named for, kept only because an operator sometimes wants one point.
  //   'uniform'       every point up by the same Δ. Legal for a MEASUREMENT under a clock pin, and not
  //                   a shape any profile ships: the tail then offers `F_top + Δ`.
  //   'raise-and-cap' THE SHIPPED SHAPE — `offset_i = min(Δ, cap − F_i)`. The whole curve up, the tail
  //                   pushed down onto the ceiling, maximum boost provably unchanged.
  //
  // `null` keeps the legacy mapping from `allPoints`, so every existing caller behaves exactly as it
  // did — a silent behaviour change in a module that writes to the owner's card would be its own
  // defect. `chooseWriteShape` is what a caller uses to pick honestly.
  writeShape = null,
  capMhz = null,
  // THE DIVERSE SET (plans/05 §4.3). `null` keeps the historical single-shape atom, which is what an
  // operator asks for by hand; an ARRAY judges this one offset by the whole set — one write, one
  // armed watchdog, one rollback, several loads inside. Applying and rolling back per shape would
  // measure three different thermal states of three different writes and call it one point.
  shapes = null,
  // PIN THE CLOCK WHILE THE SET RUNS — the owner's question, made executable: *«а для всех 128 точек
  // кривой когда будешь тюнить? на частоте 500 МГц, на 1500?»*
  //
  // A curve point is exercised ONLY when the card actually runs a clock that point serves. Left free,
  // the card boosts to the top under every load, so a run "at 500 MHz" tests the same handful of top
  // points as a run at 2842 and the low half of the curve is never loaded at all. Pinning is what
  // makes «tune the whole curve» a measurement instead of a phrase.
  //
  // `-lgc` is legal HERE and illegal in a shipped profile — `min = max` forbids the card from clocking
  // down at idle (plans/05 §4.5a, and the owner's own requirement that the card stay free to move).
  pinMhz = null,
  // The card WITH ITS LADDER, probed once by the caller. Re-probing per rung spawns `nvidia-smi`
  // queries inside every step of a long sweep, and on the sixth rung of the first live sweep one of
  // them came back without a ladder and turned a healthy rung into НЕИЗВЕСТНО. `ladder-descent` had
  // already written the rule this violates: «probeCard() already resolved the ladder — take it, do
  // not re-derive it» (EXP-0013).
  pinCard = null,
} = {}) {
  const nvapi = await import('./nvapi.mjs');
  const wd = await import('./watchdog.mjs');
  const stress = await import('./stress-tester.mjs');

  // THE SHAPE IS RESOLVED ONCE, HERE, and it rides in the report — a record that does not say which
  // shape produced it cannot be compared with one that does (EXP-0011: a value is true only under the
  // conditions it was taken, and the write shape is one of them).
  const shape = writeShape ?? (allPoints ? 'uniform' : 'point');
  if (!['point', 'uniform', 'raise-and-cap'].includes(shape)) {
    throw new RangeError(`неизвестная форма записи «${shape}» — только point | uniform | raise-and-cap`);
  }

  const out = { point, offsetMhz, workload, seconds, sustain, dryRun, allPoints, writeShape: shape, capMhz, pinMhz, blocks: [], verdict: null };
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
  // The clock pin and its release live outside the try so the `finally` can undo whatever was applied,
  // including the case where the pin succeeded and the load then died.
  let pinned = false;
  let pmBackend = null;
  // DECLARED OUT HERE, not inside the try, and the reason is a defect that happened: with these two
  // living in the try's scope, the `finally` threw a ReferenceError on its FIRST line and jumped over
  // the rollback entirely. Nothing was left applied that time, by luck of where the run had got to —
  // and luck is not a rollback.
  let sampler = null;
  let samplerFile = null;

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
    // ─── `bugs/47`: СДВИГ ПЕРЕСЧИТЫВАЕТСЯ ПО ТОЙ ТАБЛИЦЕ, ПО КОТОРОЙ БУДЕТ ПОСТРОЕН ВЕКТОР ─────────
    //
    // Здесь и был стык. Вызывающий считает сдвиг по СВОЕМУ чтению таблицы, а вектор строится по
    // `curveBefore` — чтению АТОМА, секундами позже. Обе половины честны по отдельности; дефект жил
    // ровно в том, что таблицы две. Полностью параметр НЕ выбрасывается: старые вызывающие (опыты,
    // `--drill`, ручные прогоны) задают сдвиг НАПРЯМУЮ, и для них цель не определена.
    //
    // Присваивание в параметр — намеренно. Ниже `offsetMhz` читают полтора десятка мест (сообщения,
    // формы записи, `out`), и завести рядом второе имя значило бы создать ровно ту пару, которую эта
    // починка убирает: одно место забыли бы обновить, и оно врало бы тише прежнего.
    const aim = offsetForTarget({ targetClockMhz, pointFreqMhz: freqBefore, askedOffsetMhz: offsetMhz });
    if (aim.recomputed) {
      offsetMhz = aim.offsetMhz;
      out.offsetMhz = aim.offsetMhz;
      out.offsetAskedMhz = aim.askedOffsetMhz;
      out.tableDriftMhz = aim.driftMhz;
      // РАСХОЖДЕНИЕ НАЗЫВАЕТСЯ ЧИСЛОМ, А НЕ ПРОГЛАТЫВАЕТСЯ. Это ЗАМЕР дрейфа между двумя чтениями —
      // единственное место, где его вообще видно, и он стоит того, чтобы попасть в улики.
      block(`СДВИГ ПЕРЕСЧИТАН ПО СВЕЖЕЙ ТАБЛИЦЕ: ${aim.offsetMhz} МГц (вызывающий просил ${aim.askedOffsetMhz})`,
        true,
        aim.driftMhz === 0
          ? 'таблицы совпали — дрейфа между чтениями не было'
          : `таблица уехала на ${aim.driftMhz} МГц между чтением вызывающего и чтением атома `
            + `(точка ${point}: ${mvAtPoint} мВ обслуживает ${freqBefore} МГц при ${tempBefore} °C). `
            + `Применяем СВОЙ сдвиг: иначе ${targetClockMhz} МГц обслужила бы точка выше, и заказанное `
            + 'напряжение не было бы измерено вовсе (bugs/47)');
    }
    block(`точка ${point} — та, где карта работает под нагрузкой`, true,
      `${mvAtPoint} мВ / ${freqBefore} МГц при ${tempBefore} °C; после шага ожидаем ${freqBefore + offsetMhz} МГц при том же напряжении. ` +
      `ВНИМАНИЕ: кривая проседает с температурой (замер: −15…−22 МГц за 12 °C), поэтому сравнение честно только при совпавшей температуре`);

    // ---- 1b. THE VECTOR AND ITS CEILING — computed BEFORE the watchdog is armed, so a refusal costs
    // the card no time at all. The vector is built from the curve read moments ago, at THIS
    // temperature: a vector built from an older reading would be capped against a curve the card no
    // longer has (fact 18 — the curve derates 15–22 MHz over 12 °C).
    let vector = null;
    if (shape === 'raise-and-cap') {
      if (!Number.isFinite(capMhz)) {
        block('ФОРМА ЗАПИСИ: отгружаемая (подъём с потолком)', false,
          'этой форме нужен ПОТОЛОК (--cap): без него нечего держать, и она перестаёт быть отгружаемой формой');
        return out;
      }
      if (!curveBefore.ok) {
        block('ФОРМА ЗАПИСИ: отгружаемая (подъём с потолком)', false, `кривая не прочитана — ${curveBefore.why}`);
        return out;
      }
      vector = nvapi.buildRaiseAndCapVector(curveBefore.points, offsetMhz, { capMhz });
      const held = chooseWriteShape(vector, { pinned: Boolean(pinMhz) });
      out.capHeldBy = held.heldBy;
      out.vector = vector.ok
        ? { capMhz: vector.capMhz, topMhz: vector.topMhz, highestOfferedMhz: vector.highestOfferedMhz,
          capEnforced: vector.capEnforced, capLeakMhz: vector.capLeakMhz,
          atFullDelta: vector.atFullDelta, raisedButCapped: vector.raisedButCapped,
          pushedDown: vector.pushedDown, zero: vector.zero,
          minOffset: vector.minOffset, maxOffset: vector.maxOffset }
        : null;
      // THE CEILING MUST BE HELD BY SOMETHING, and this block names by what. A ceiling nothing enforces
      // lets the card leave the clock under test, and then the verdict is about an unnamed state.
      block(`ПОТОЛОК ${capMhz} МГц ДЕРЖИТ: ${held.heldBy ?? 'НИЧТО'}`, held.ok, held.why);
      if (!held.ok) return out;
      if (held.shape !== 'raise-and-cap') {
        // The caller asked for the shipped shape and this rung cannot have it. Refusing here rather
        // than silently downgrading: which shape was written is exactly what `bugs/02` proved a run
        // must not leave to inference. The caller picks again with `chooseWriteShape` in hand.
        block('ФОРМА ЗАПИСИ: заказана отгружаемая, а на этой ступени она невозможна', false,
          `${held.why}. Вызывающему следует запросить форму «${held.shape}» ЯВНО — подмена формы молча ` +
          'это ровно тот класс, из-за которого поиск докладывал о напряжении, которого карта не видела (bugs/02)');
        return out;
      }
      block(`ВЕКТОР: подъём +${offsetMhz} МГц, потолок ${vector.capMhz} МГц (верх кривой ${vector.topMhz})`, true,
        `полный шаг у ${vector.atFullDelta} точек, придавлено ${vector.raisedButCapped}, толкнуто вниз ${vector.pushedDown}, `
        + `нулевых ${vector.zero}; сдвиги ${vector.minOffset}…${vector.maxOffset} МГц; после записи кривая предложит `
        + `максимум ${vector.highestOfferedMhz} МГц`);
    }

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
    // The lease NAMES THE WRITE SHAPE, because the record is what a stranger reads after a crash: «one
    // point» and «the whole curve with a ceiling» are different amounts of card to be holding.
    const armWhat = {
      'raise-and-cap': `АНДЕРВОЛЬТ, ОТГРУЖАЕМАЯ ФОРМА: вся кривая +${offsetMhz} МГц с потолком ${capMhz} МГц`,
      uniform: `АНДЕРВОЛЬТ: вся кривая равномерно +${offsetMhz} МГц`,
      point: `АНДЕРВОЛЬТ: точка ${point} (+${offsetMhz} МГц)`,
    }[shape];
    watchdog = wd.arm({ what: `${armWhat}, нагрузка ${Array.isArray(shapes) ? `набор из ${shapeCount} форм` : workload}`, ttlMs });
    block('сторож взведён ДО записи', Boolean(watchdog.guardPid),
      `pid ${watchdog.guardPid}, аренда ${ttlMs / 1000} с, откат — полный возврат к заводскому`);

    // ---- 3. THE WRITE
    // Point 127 is excluded by measurement, not by caution: the NVML lever never moves it, it carries
    // the structure's only non-zero service dword, and on the curve it reads 515 mV / 405 MHz against
    // its neighbour's 1240 mV / 3157 MHz — it is not part of the monotone graphics curve.
    const curvePoints = nvapi.CLK_VF_POINT_COUNT - 1;
    // WHAT WE ASKED FOR, POINT BY POINT — one array for all three shapes, so the read-back has exactly
    // one thing to compare against instead of a rule per shape. `null` means "this point was not
    // addressed by this run" and is therefore expected to stay at zero.
    const requested = Array.from({ length: curvePoints }, (_, i) => {
      if (shape === 'raise-and-cap') return vector.offsets[i];
      if (shape === 'uniform') return offsetMhz;
      return i === point ? offsetMhz : null;
    });
    const targets = requested.map((o, i) => (o === null ? null : i)).filter((i) => i !== null);

    // ONE WRITER, and for the whole curve it is `nvapi.writeCurve` rather than a sixth open-coded
    // copy of the same loop (plans/05 §4.1 item a). The single-point path stays a single call.
    let failed = 0;
    // ---- THE WRITE NOW VERIFIES ITSELF, AND IT NAMES THE CLASS WHEN IT FAILS (`plans/40`, epic 36
    // phase 4). `writeCurve` reads the control structure back THROUGH THE SETTLE CONTRACT and hands
    // us the table the card actually holds, so the block below compares against a table that has
    // stopped moving instead of against the first probe after 127 writes — the shape `researches/18`
    // §5 H1 names as the leading hypothesis for the live failure of 2026-08-24 09:36.
    let heldKhz = null;
    if (shape === 'raise-and-cap') {
      const w = nvapi.writeCurve(nv, handle, vector.offsets);
      failed = w.failed; heldKhz = w.heldKhz ?? null; out.writeFailureClass = w.failureClass ?? null;
      out.writeFailureWhy = w.why ?? null; out.writeSettled = w.settled === true;
    } else if (shape === 'uniform') {
      const w = nvapi.writeCurve(nv, handle, offsetMhz);
      failed = w.failed; heldKhz = w.heldKhz ?? null; out.writeFailureClass = w.failureClass ?? null;
      out.writeFailureWhy = w.why ?? null; out.writeSettled = w.settled === true;
    } else {
      const r = nvapi.writeVfOffset(nv, handle, point, offsetMhz * 1000);
      if (!r.ok) failed++;
    }
    written = failed < targets.length;
    const shapeName = {
      'raise-and-cap': `ОТГРУЖАЕМАЯ ФОРМА — вся кривая с потолком ${capMhz} МГц (${targets.length} точек)`,
      uniform: `ВСЯ КРИВАЯ равномерно (${targets.length} точек)`,
      point: `точка ${point}`,
    }[shape];
    block(`ЗАПИСЬ: ${shapeName}, подъём +${offsetMhz} МГц`,
      failed === 0, failed === 0 ? 'все вызовы приняты' : `отказов ${failed} из ${targets.length}`);
    if (failed === targets.length) return out;
    watchdog.beat();

    // ---- READ BACK POINT BY POINT, against the vector we asked for.
    //
    // The old check counted how many points carried ONE scalar offset, which is the only question a
    // uniform raise can be asked. The shipped shape asks a different one — every point carries ITS OWN
    // number, several of them zero and several negative — and a count would have passed while the
    // curve held something else entirely. Status 0 is not verification; the read-back is (EXP-0024).
    //
    // ⚠️ THE SECOND READER WAS REMOVED, NOT THE CHECK (2026-08-24, `plans/40` step 4). This block used
    // to take its OWN `readVfOffsets` — a single shot, right after the write, i.e. exactly the shape
    // the owner's-machine rule step 4 forbids. It now reads the SETTLED table the write already
    // brought back: one reader of one fact instead of two kept in agreement (the registry's own
    // preference — a pair that can be REMOVED beats a pair that must be watched).
    const after = heldKhz === null
      ? { ok: false, why: out.writeFailureWhy ?? 'таблица карты не прочиталась после записи' }
      : { ok: true, offsets: heldKhz };
    let matched = 0;
    let strayNonZero = 0;
    const mismatches = [];
    if (after.ok) {
      for (let i = 0; i < curvePoints; i++) {
        const want = requested[i] === null ? 0 : Math.round(requested[i] * 1000);
        const got = after.offsets[i];
        if (got === want) { matched++; continue; }
        if (requested[i] === null && got !== 0) strayNonZero++;
        if (mismatches.length < 5) mismatches.push({ point: i, want, got });
      }
    }
    // THE CLASS IS NAMED IN THE BLOCK'S OWN TEXT, so it survives every path the block's detail takes —
    // the console, the journal's `redBlocks`, the operator's screen (`plans/39`, standard item 2).
    block('перечитано ПОТОЧЕЧНО: каждая точка несёт РОВНО свой сдвиг, а не «сколько-то штук»',
      after.ok && matched === curvePoints,
      after.ok
        ? `${out.writeFailureClass ? `КЛАСС ОТКАЗА ${out.writeFailureWhy} · ` : ''}`
          + `сошлось ${matched} из ${curvePoints}${strayNonZero ? `, чужих ненулевых ${strayNonZero}` : ''}`
          + `${mismatches.length ? ` — расхождения ${JSON.stringify(mismatches)}` : ''}`
        : `${out.writeFailureClass ? `КЛАСС ОТКАЗА ${out.writeFailureWhy}` : after.why}`);

    // THE EFFECTIVE CURVE THROUGH THE SAME CONTRACT. `researches/18` §5 H1 is about THIS read, not
    // about the offsets one: `curveAfter` was a single probe taken after 127 writes, and it is what
    // reported a table topping 15 MHz ABOVE a ceiling the vector provably could not exceed.
    const curveAfter = nvapi.readVfCurveStable(nv, handle);
    // An effective table that never stood still IS class C1, and it is named here rather than left as
    // «кривая не перечитана» — a symptom the operator cannot act on (`plans/39`, standard item 2).
    if (curveAfter.settled === false && !out.writeFailureClass) {
      out.writeFailureClass = 'C1';
      out.writeFailureWhy = `C1 — чтение после записи не устоялось: ${curveAfter.why}. `
        + 'Таблица, которая ещё движется, не измерение';
    }
    const freqAfter = curveAfter.ok ? curveAfter.points[point].mhz : null;
    out.freqAfter = freqAfter;
    if (shape === 'raise-and-cap') {
      // THE POINT UNDER TEST MOVES WHERE THE VECTOR SAID, WHICH IS NOT ALWAYS UP.
      //
      // The point serving the cap at stock is by definition at or above the cap, so the shipped vector
      // pushes it DOWN onto the ceiling. Demanding "it went up" here would redden a correct write —
      // and the undervolt is not this point rising anyway, it is a CHEAPER point rising to serve the
      // cap, which the `АНДЕРВОЛЬТ` block below measures. So this block asserts what the shape
      // actually promises: the point ended where its own offset put it.
      const wantMhz = freqBefore === null ? null : freqBefore + vector.offsets[point];
      block('кривая подтверждает: испытуемая точка встала ТУДА, КУДА ЕЁ ПОСЛАЛ ВЕКТОР',
        freqAfter !== null && wantMhz !== null && Math.abs(freqAfter - wantMhz) <= 1,
        `${freqBefore} → ${freqAfter} МГц при ${mvAtPoint} мВ (её сдвиг по вектору ${vector.offsets[point]} МГц, ждали ${wantMhz})`);
      const offeredNow = curveAfter.ok
        ? Math.max(...curveAfter.points.slice(0, curvePoints).filter((p) => p.freqKhz > 0).map((p) => p.mhz))
        : null;
      out.highestOfferedMhz = offeredNow;
      // ---- THE CEILING EVIDENCE REACHES THE CLASSIFIER (`plans/40`, epic 36 phase 4).
      //
      // `researches/18` §5 names the combination the offsets alone cannot express: a GREEN
      // point-by-point re-read TOGETHER WITH an offered clock above the cap is class C3 — the driver
      // placed something we did not send — because the vector's own arithmetic
      // (`offset_i = min(Δ, cap − F_i)`) cannot exceed the cap, checked offline on six historical
      // rungs with a leak of 0. This is the ONE caller able to measure it; `writeCurve` has no ceiling
      // and passes nothing, which is why its answer there is the honest C2.
      if (offeredNow !== null && capMhz !== null && offeredNow > capMhz
          && !out.writeFailureClass && Array.isArray(heldKhz)) {
        const k = nvapi.classifyWriteFailure({
          requested: requested.map((o) => (o === null ? 0 : Math.round(o * 1000))),
          held: heldKhz,
          failedCalls: 0,
          settled: out.writeSettled !== false,
          offeredAboveCapMhz: Number((offeredNow - capMhz).toFixed(1)),
        });
        if (k) { out.writeFailureClass = k.class; out.writeFailureWhy = `${k.class} — ${k.name}: ${k.why}`; }
      }
      // THE CEILING, VERIFIED ON THE CARD rather than trusted from the arithmetic that planned it.
      block(`ПОТОЛОК СТОИТ: кривая больше не предлагает ничего выше ${capMhz} МГц`,
        offeredNow !== null && offeredNow <= capMhz,
        offeredNow === null ? 'кривая не перечитана'
          : `${out.writeFailureClass ? `КЛАСС ОТКАЗА ${out.writeFailureWhy} · ` : ''}`
            + `максимум кривой ${offeredNow} МГц при потолке ${capMhz} (план обещал ${vector.highestOfferedMhz})`);
    } else {
      block('кривая подтверждает: точка поехала ВВЕРХ при том же напряжении',
        freqAfter !== null && freqAfter > freqBefore,
        `${freqBefore} → ${freqAfter} МГц при ${mvAtPoint} мВ (Δ ${(freqAfter - freqBefore).toFixed(1)})`);
    }

    // ---- 3b. THE PROOF THAT AN UNDERVOLT ACTUALLY HAPPENED
    // Raising the curve only buys watts if the card is then HELD at a clock (researches/02 §6.2).
    // The clock we hold is the one the undervolt is measured at, and the observable is which voltage
    // point now serves it.
    // THE CLOCK UNDER TEST, and it is NOT the same field as «the ceiling». In the shipped shape the
    // ceiling IS the clock under test; in the owner's locked shape (`ideas/03` step 7) there is no
    // ceiling at all and the clock under test is the PIN. Keying this measurement on `capMhz` alone
    // silently produced NO undervolt record for every locked rung — and `servingMvAfter` is what the
    // sweep writes into the curve document, so the omission would have travelled all the way in.
    // The pin is read before its snap-to-ladder, which is a no-op here: the sweep's frequencies come
    // from that same ladder.
    // THE PIN WINS when both are present, and that order is the whole point: under the owner's shape
    // the ceiling is the card's ENVELOPE (3090) while the clock under test is the LOCK (e.g. 3045).
    // Measuring at the envelope would record the voltage of a frequency nobody tested.
    const measuredAtMhz = pinMhz ?? capMhz;
    // ---- WE ASK ABOUT THE CLOCK THE CARD OFFERS, NOT THE ONE WE ORDERED — `askAtClockMhz` above
    // carries the reasoning and `bugs/22` the measurements. BOTH SIDES MOVE TOGETHER, deliberately:
    // measuring `before` at the order and `after` at the delivered clock would compare two different
    // frequencies and overstate the saving, because a lower clock is cheaper at stock. One clock,
    // two readings.
    const offeredAfterMhz = Number.isFinite(out.highestOfferedMhz) ? out.highestOfferedMhz : null;
    const askAtMhz = askAtClockMhz(measuredAtMhz, offeredAfterMhz);
    if (askAtMhz && curveBefore.ok && curveAfter.ok) {
      const vBefore = voltageForClock(curveBefore.points, askAtMhz);
      const vAfter = voltageForClock(curveAfter.points, askAtMhz);
      const shortfallMhz = measuredAtMhz && askAtMhz < measuredAtMhz
        ? Number((measuredAtMhz - askAtMhz).toFixed(1)) : 0;
      out.undervolt = { capMhz: askAtMhz, orderedMhz: measuredAtMhz, askedAtMhz: askAtMhz,
        offeredAfterMhz, shortfallMhz, before: vBefore, after: vAfter,
        savedMv: vBefore && vAfter ? Number((vBefore.mv - vAfter.mv).toFixed(3)) : null };
      const where = shortfallMhz
        ? `${askAtMhz} МГц (заказано ${measuredAtMhz}, кривая предлагает на ${shortfallMhz} МГц меньше — спрашиваем о ВЫДАННОМ)`
        : `${askAtMhz} МГц`;
      block(`АНДЕРВОЛЬТ на ${where}: напряжение для этой частоты УПАЛО`,
        Boolean(vBefore && vAfter) && vAfter.mv < vBefore.mv,
        vBefore && vAfter
          ? `обслуживала точка ${vBefore.pointIndex} (${vBefore.mv} мВ) → теперь точка ${vAfter.pointIndex} (${vAfter.mv} мВ), экономия ${out.undervolt.savedMv} мВ`
          : 'не вычислено — частота вне кривой');
    }

    // ---- 3c. THE CLOCK PIN — what makes "tune the whole curve" a measurement
    //
    // Without it the card boosts to the top under every load, so the low half of the curve is never
    // exercised and a run "at 500 MHz" tests exactly the same points as a run at 2842. The pin is
    // applied through `profile-manager` (rule R1: it is the only module that writes clocks), it is
    // verified UNDER LOAD rather than at idle (EXP-0020 — at idle a high lock is invisible), and it is
    // released in the `finally` below on every path.
    if (pinMhz) {
      const pm = await import('./profile-manager.mjs');
      const ld = await import('./ladder-descent.mjs');
      // THE CARD WITH ITS LADDER, and it is a DIFFERENT probe from the one the oracle uses. This
      // project has two functions named `probeCard`: `stress-tester`'s answers driver/VBIOS for a
      // golden's stamp, `profile-store`'s additionally resolves the measured clock ladder and the
      // power envelope. The validator needs the second, and passing the first cost a live rung —
      // it threw inside `validateProfile` AFTER the curve had been written (the `finally` cleaned up,
      // which is the only reason that was a stumble rather than an incident).
      const ps = await import('./profile-store.mjs');
      const card = pinCard ?? ps.probeCard();
      if (!card.ladder?.ok) {
        block('ЧАСТОТА ЗАКРЕПЛЕНА', false, `лестница частот недоступна — ${card.ladder?.why ?? 'не прочитана'}`);
        return out;
      }
      // A clock is taken from the card's OWN ladder, never from a round number a human liked
      // (`ladder-descent` rule 3). 1500 is not on this card's ladder; 1492 is.
      const snap = ld.snapToLadder(pinMhz, card.ladder.mhz);
      out.pinRequestedMhz = pinMhz;
      pinMhz = snap.mhz;
      out.pinMhz = pinMhz;
      pmBackend = pm.nvidiaSmiBackend();
      const applied = await pm.apply(pmBackend, ld.candidateProfile(pinMhz, card), { card, verifyLock: 'deferred' });
      pinned = true;                                   // set BEFORE judging success: a partial apply still needs undoing
      block(`ЧАСТОТА ЗАКРЕПЛЕНА на ${pinMhz} МГц${snap.snapped ? ` (просили ${snap.from}, притянуто к лестнице карты)` : ''} — иначе низ кривой под нагрузкой не тестируется вовсе`,
        applied.ok !== false, applied.why ?? 'проверка закрепления — под нагрузкой, не на простое');
      if (applied.ok === false) return out;
      watchdog.beat();
    }

    // ---- 3d. THE SAMPLER — and it no longer rides on the PIN.
    //
    // It used to be spawned inside the pin branch, so removing the pin (which the shipped shape makes
    // both unnecessary and harmful — `chooseWriteShape.pinRequired`) would have removed the run's
    // ONLY telemetry with it, and with it every proof that the load exercised the region under test.
    // What a capped run needs proving is not «the lock held» but «the CEILING held», and that needs
    // the same samples. So the sampler now runs whenever there is a ceiling to watch at all.
    //
    // It runs in a SEPARATE process: an in-process one records nothing, because `spawnSync` inside the
    // load blocks this event loop (measured, `power-baseline.mjs` header).
    if (pinMhz || capMhz) {
      const { spawn } = require('node:child_process');
      const { join, dirname } = require('node:path');
      const { fileURLToPath } = require('node:url');
      const here = dirname(fileURLToPath(import.meta.url));
      const { mkdirSync } = require('node:fs');
      const runsDir = join(here, '..', '..', 'runs', 'vmin');
      mkdirSync(runsDir, { recursive: true });
      // The name says which mechanism was holding the ceiling, so two runs at one clock cannot be
      // mistaken for each other after the fact.
      samplerFile = join(runsDir, `${pinMhz ? `pin-${pinMhz}` : `cap-${capMhz}`}-${offsetMhz}.jsonl`);
      const samplerSeconds = seconds * ((Array.isArray(shapes) && shapes.length) || 1) + 30;
      sampler = spawn(process.execPath, [join(here, 'hardware-mon.mjs'), '--seconds', String(samplerSeconds), '--out', samplerFile],
        { windowsHide: true, stdio: 'ignore' });
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
    // ---- 5. THE UNDO — a LIST, not a chain (bugs/03, EXP-0040).
    //
    // Written straight-line, these five shared one fate: the first throw cancelled everything after
    // it, and on 2026-08-11 a ReferenceError on the first line jumped over the clock release, the
    // curve zeroing, the watchdog disarm AND the driver unload. `runUndo` gives each its own `try`,
    // so a failure becomes a red block instead of an exit.
    //
    // The ORDER still says something — the pin's proof is a READ and must happen while the pin still
    // holds — but order is now a preference, not a dependency.
    out.blocks.push(...await runUndo([
      {
        // THE CEILING'S PROOF, and WHICH mechanism is being proved depends on who holds it.
        //
        // Pinned (the low band, where the curve cannot cap at all): the old proof stands — the clock
        // must be CONSTANT at the pinned value, because that is what a pin promises.
        //
        // Capped by the curve (the shipped shape): the promise is different and so is the proof. A
        // capped card is FREE below the ceiling and deliberately sits a little under it — demanding a
        // constant clock here is demanding the thing the cap was chosen to avoid, and on 2026-08-14 it
        // reported a rung whose three load shapes had all PASSED as НЕИЗВЕСТНО. What must be proved is
        // the property the shipped profile actually has: **the card never went ABOVE the ceiling**.
        // ЭТО ЧТЕНИЕ, А НЕ ОТКАТ — см. `runUndo`. Стоит в этом списке только ради ПОРЯДКА (читать
        // надо, пока закрепление ещё держит), и `kind: 'proof'` не даёт вызывающему принять его
        // отказ за «карта не вернулась» (`plans/28`, находка A).
        kind: 'proof',
        name: pinMhz ? `ЗАКРЕПЛЕНИЕ ДЕРЖАЛОСЬ под нагрузкой на ${pinMhz} МГц` : `ПОТОЛОК ${capMhz} МГц УСТОЯЛ ПОД НАГРУЗКОЙ`,
        run: async () => {
          if (!sampler) return 'телеметрии не снималось — проверять нечего';
          const { readSamples, summarizeSamples } = await import('./power-baseline.mjs');
          sampler.kill();
          const records = samplerFile ? readSamples(samplerFile) : [];
          if (!records.length) {
            out.ceilingProof = { ok: false, why: 'сэмплер не оставил проб' };
            if (out.verdict === config.VERDICT.PASS) { out.verdict = null; out.pinRefused = true; out.reason = 'сэмплер не оставил проб'; }
            throw new Error('сэмплер не оставил проб');
          }

          if (pinned) {
            const ld = await import('./ladder-descent.mjs');
            const stats = summarizeSamples(records);
            const proof = stats ? ld.verifyLockUnderLoad({ medians: stats }, pinMhz) : { ok: false, why: 'сводка по пробам не собралась' };
            out.pinProof = proof;
            // THE DELIVERED CLOCK IS CARRIED ON THIS PATH TOO — it was not, and that was a hole.
            // The owner's rule (`GOAL.md` → «🎚 ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ») records a voltage against
            // the frequency the card ACTUALLY ran, so a path that measures the clock and then drops
            // it leaves the sweep with nothing to key the row by. The capped branch below already
            // sets these two fields; the locked branch simply never did.
            if (Number.isFinite(proof.delivered)) {
              out.deliveredMhz = proof.delivered;
              out.deliveredMaxMhz = proof.delivered;
            }
            if (!proof.ok && out.verdict === config.VERDICT.PASS) { out.verdict = null; out.pinRefused = true; out.reason = proof.why; }
            if (!proof.ok) throw new Error(proof.why);
            return `${proof.why}${proof.delivered ? ` · выдано ${proof.delivered} МГц` : ''}`;
          }

          // THE CEILING CHECK. Only the loaded samples count: at idle the card drops to 180 MHz, which
          // says nothing about a ceiling, and including those samples would flatter every median.
          const loaded = records
            .map((r) => r.sample ?? r)
            .filter((s) => Number(s['utilization.gpu']) > config.PLATEAU_LOAD_UTILIZATION_PCT);
          if (!loaded.length) {
            out.ceilingProof = { ok: false, why: 'ни одной пробы ПОД НАГРУЗКОЙ — нагрузка карту не заняла' };
            if (out.verdict === config.VERDICT.PASS) { out.verdict = null; out.pinRefused = true; out.reason = out.ceilingProof.why; }
            throw new Error(out.ceilingProof.why);
          }
          const clocks = loaded.map((s) => Number(s['clocks.gr'])).filter(Number.isFinite);
          const sorted = [...clocks].sort((a, b) => a - b);
          const median = sorted[Math.floor(sorted.length / 2)];
          const max = Math.max(...clocks);
          out.deliveredMhz = median;
          out.deliveredMaxMhz = max;
          // ONE LADDER STEP of tolerance and not a millihertz more: the card's own grid is 7–8 MHz,
          // and `clocks.gr` is reported on that grid, so a reading one step above the cap is rounding
          // rather than a breach. Anything beyond it means the ceiling did not hold.
          // `offeredAfterMhz` — максимум кривой, ПЕРЕЧИТАННОЙ С КАРТЫ после записи (выставлен выше,
          // блоком «ПОТОЛОК СТОИТ»). Он и отвечает на вопрос, встала ли форма: без него превышение
          // под нагрузкой неотличимо от невставшей записи (`bugs/50`, замер 2026-08-25).
          const j = judgeDeliveredClock({ capMhz, median, max, samples: loaded.length,
            offeredAfterMhz: Number.isFinite(out.highestOfferedMhz) ? out.highestOfferedMhz : null });
          // 🪜 НЕДОБОР ЧАСТОТЫ — ЭТО ЗАМЕР, А НЕ ОТКАЗ (канон 2026-08-22, `GOAL.md` →
          // «УПРАВЛЯЕМАЯ ВЕЛИЧИНА СТУПЕНИ — НАПРЯЖЕНИЕ, А НЕ ЧАСТОТА»).
          //
          // Два исхода этой проверки означают ПРОТИВОПОЛОЖНЫЕ вещи, и раньше они ехали по одному
          // проводу — через `throw` внутри списка отката:
          //   `breached` — карта ушла ВЫШЕ потолка: отгружаемая форма не удержалась, это отказ;
          //   `short`    — карта не добрала до потолка: это то, что она делает всегда, когда
          //                напряжение снижено, и это и есть измеряемая величина.
          // Красный блок ОТКАТА по правилу R10a означает «состояние карты назвать нельзя», то есть
          // СТОП всей развёртки. Поэтому недобор ронял прогон: 2026-08-22 два живых захода встали,
          // не закрыв ни одной частоты из 24, и вдобавок объявили «монотонность НАРУШЕНА» там, где
          // вердикта о напряжении не было вовсе (`bugs/29`).
          //
          // Теперь недобор НЕ трогает вердикт и не бросает. Выданная частота уже лежит в
          // `out.deliveredMhz`, а развёртка кладёт замер в строку выданной частоты
          // (`resolveDeliveredRow`, притяжение ВНИЗ). `clockShortfall` остаётся как ФАКТ ступени —
          // его читает отчёт, а не тормоз.
          //
          // Само решение живёт в `applyCeilingJudgement` — она вызывается ЗДЕСЬ и проверяется
          // офлайн блоками набора. Здесь не остаётся ни одной ветки о потолке, иначе появилась бы
          // вторая правда о том же (EXP-0077).
          return applyCeilingJudgement(out, j, { capMhz, median, max, loadedSamples: loaded.length });
        },
      },
      {
        name: 'ОТКАТ: частота ОТПУЩЕНА, карта снова свободна вверх и вниз',
        run: async () => {
          if (!pinned) return 'частота не закреплялась';
          // `resetToFactory` is TOTAL rather than differential — rule R9's reasoning: after something
          // goes wrong nobody knows what was applied, so the only honest undo is factory.
          const pm = await import('./profile-manager.mjs');
          const released = await pm.resetToFactory(pmBackend, { knownLockMhz: pinMhz });
          if (released.ok === false) throw new Error(released.why ?? 'сброс отказал');
          return released.why ?? 'сброс к заводскому применён и перечитан';
        },
      },
      {
        name: 'ОТКАТ: вся кривая обнулена, ненулевых сдвигов не осталось',
        run: async () => {
          if (!written) return 'в кривую не писали';
          // Zero EVERY point, not only the ones this run wrote: "undo exactly what I did" needs a
          // record a crash may have taken with it. Zeroing a zero costs nothing.
          const z = nvapi.zeroCurve(nv, handle);
          if (!z.ok) throw new Error(`отказов записи ${z.failed} · ненулевых осталось ${z.remainingNonZero}`);
          return `отказов записи 0 · ненулевых ${z.remainingNonZero} из 128`;
        },
      },
      {
        name: 'ОТКАТ: сторож разоружён',
        run: async () => {
          // Previously this sat OUTSIDE every try, so a throw in the curve zeroing left the watchdog
          // ARMED — a guard that would then fire on a card nobody was holding.
          if (!watchdog) return 'сторож не взводился';
          watchdog.disarm();
          return 'аренда снята';
        },
      },
      {
        name: 'ОТКАТ: библиотека NVAPI выгружена',
        run: async () => { nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload); return 'Unload вызван'; },
      },
    ]));
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
/**
 * ЗАМЕР: ЧТО ДРАЙВЕР ДЕЛАЕТ С НАШИМ ВЕКТОРОМ — одна запись, БЕЗ ЕДИНОГО ПРОЖИГА.
 *
 * ─── ЗАЧЕМ ЭТОТ ПРИБОР СУЩЕСТВУЕТ ───────────────────────────────────────────────────────────────
 *
 * Живой прогон 2026-08-24 19:1x назвал класс отказа — **C3, драйвер правит результат** — и назвал
 * его правильно: поточечная сверка управляющей структуры ЗЕЛЁНАЯ (0 расхождений из 127), а
 * эффективная кривая после записи предлагает 2370 при потолке 2355. Что именно драйвер делает, при
 * этом НЕ ИЗМЕРЕНО, и лечить неизмеренное значило бы выдумывать (`PHILOSOPHY.md`, третья дверь).
 *
 * Офлайн-разбор на живой таблице уже снял подозрение с нашей арифметики: `buildRaiseAndCapVector`
 * при обоих сдвигах (173 и 203) топится ровно на 2355, утечка 0. Значит расхождение вносит сторона
 * карты, и увидеть его можно только одним способом — записать вектор и прочитать, ЧТО ПОЛУЧИЛОСЬ,
 * по каждой записи.
 *
 * ─── ПОЧЕМУ ЭТО ДЕШЁВЫЙ ЗАМЕР ───────────────────────────────────────────────────────────────────
 *
 * Прожига нет вовсе, поэтому нет и риска нестабильности: карта получает вектор на секунды и
 * возвращается к заводскому. Стоимость — одна запись и один откат; это тот случай, когда наблюдение
 * дешевле рассуждения.
 *
 * ─── ЧТО ОН ПЕЧАТАЕТ, И ПОЧЕМУ ИМЕННО ЭТО ──────────────────────────────────────────────────────
 *
 * Главная величина — ПЛАТО. Отгружаемая форма придавливает всё, что выше потолка, НА потолок, и на
 * этом векторе 64 записи из 127 просят одну и ту же частоту 2355. Ведущая гипотеза замера: такую
 * кривую драйвер не хранит буквально — он разводит совпадающие записи по своей сетке, отчего часть
 * уезжает вниз, а часть вверх. Прибор печатает, сколько РАЗЛИЧНЫХ частот карта поставила там, где мы
 * просили одну, — и это число либо подтверждает гипотезу, либо убивает её.
 *
 * ⚠️ ГИПОТЕЗУ ОН НЕ ДОКАЗЫВАЕТ САМ. Он даёт таблицу «просили → получили»; вывод делает читающий.
 *
 * [NOT-TESTED] at birth — это измерительный прибор, и его доказательство есть его собственный вывод
 * на живой карте, приложенный к `bugs/50`.
 */
export async function probeCurveSnap({ deltaMhz = 203, capMhz = 2355, ttlSeconds = 90 } = {}) {
  const nvapi = await import('./nvapi.mjs');
  const wd = await import('./watchdog.mjs');
  const pm = await import('./profile-manager.mjs');
  const out = { deltaMhz, capMhz, blocks: [], rows: [], ok: false };
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
  const N = nvapi.CLK_VF_POINT_COUNT - 1;

  let watchdog = null;
  let touched = false;
  try {
    // ЧИТАЕМ «ДО» ЧЕРЕЗ ТОТ ЖЕ ДОГОВОР, что и «после»: таблица едет с температурой, и сравнивать
    // устоявшееся с неустоявшимся значило бы мерить прибор, а не карту.
    const before = nvapi.readVfCurveStable(nv, handle);
    if (!before.ok) { block('таблица «до» прочитана', false, before.why); return out; }
    const baseMhz = before.points.slice(0, N).map((p) => p.mhz);
    const topBefore = Math.max(...before.points.slice(0, N).filter((p) => p.freqKhz > 0).map((p) => p.mhz));

    const vec = nvapi.buildRaiseAndCapVector(before.points, deltaMhz, { capMhz });
    if (!vec.ok) { block('вектор построен', false, vec.why); return out; }
    // ТЕ ЖЕ ЧЕТЫРЕ ОТКАЗА, что у боевого пути (R11 · R13 · R12) — прибор не имеет права записать то,
    // что отгружаемый путь записать отказался бы.
    const refusal = pm.curveWriteRefusal(vec, { capMhz, cardMaxClockMhz: 3090 });
    if (refusal) { block('вектор прошёл штатные отказы', false, `${refusal.rule}: ${refusal.why}`); return out; }

    const asked = baseMhz.map((b, i) => (before.points[i].freqKhz > 0 ? Number((b + vec.offsets[i]).toFixed(1)) : null));
    const plateauIdx = asked.map((v, i) => (v !== null && Math.abs(v - capMhz) < 0.5 ? i : -1)).filter((i) => i >= 0);
    block(`ЗАКАЗ: вектор +${deltaMhz} МГц, потолок ${capMhz} МГц`, true,
      `верх таблицы «до» ${topBefore} МГц · наш верх по арифметике ${Math.max(...asked.filter((v) => v !== null))} `
      + `· ПЛАТО: ${plateauIdx.length} записей просят ровно ${capMhz} МГц`);

    watchdog = wd.arm({
      what: `ЗАМЕР СНАПА ДРАЙВЕРА: вектор +${deltaMhz}, потолок ${capMhz}, БЕЗ ПРОЖИГА`,
      ttlMs: ttlSeconds * 1000,
    });
    const w = nvapi.writeCurve(nv, handle, vec.offsets);
    touched = true;
    block('ЗАПИСЬ принята и управляющая структура держит РОВНО вектор', w.ok,
      `записано ${w.written}, отказов ${w.failed}, расхождений ${w.mismatches ?? 0}, проб устаивания ${w.probes}`
      + `${w.why ? ` · ${w.why}` : ''}`);
    watchdog.beat();

    const after = nvapi.readVfCurveStable(nv, handle);
    if (!after.ok) { block('таблица «после» прочитана и устоялась', false, after.why); return out; }
    const gotMhz = after.points.slice(0, N).map((p) => p.mhz);
    const topAfter = Math.max(...after.points.slice(0, N).filter((p) => p.freqKhz > 0).map((p) => p.mhz));

    for (let i = 0; i < N; i++) {
      if (before.points[i].freqKhz <= 0) continue;
      out.rows.push({
        i, mv: before.points[i].mv, base: baseMhz[i], off: vec.offsets[i],
        asked: asked[i], got: Number(gotMhz[i].toFixed(1)),
        delta: Number((gotMhz[i] - asked[i]).toFixed(1)),
      });
    }
    const moved = out.rows.filter((r) => Math.abs(r.delta) > 0.5);
    const distinctOnPlateau = new Set(plateauIdx.map((i) => Number(gotMhz[i].toFixed(1))));
    out.summary = {
      topBefore, topAfter, capMhz,
      overCapMhz: Number((topAfter - capMhz).toFixed(1)),
      plateauAsked: plateauIdx.length,
      plateauDistinctGot: distinctOnPlateau.size,
      plateauGotValues: [...distinctOnPlateau].sort((a, b) => a - b),
      movedEntries: moved.length,
    };
    block(`ПОТОЛОК: карта предлагает максимум ${topAfter} МГц при потолке ${capMhz}`,
      topAfter <= capMhz, `превышение ${out.summary.overCapMhz} МГц`);
    block(`ПЛАТО: просили ${plateauIdx.length} записей на одной частоте — карта поставила ${distinctOnPlateau.size} РАЗЛИЧНЫХ`,
      distinctOnPlateau.size === 1,
      `значения: ${out.summary.plateauGotValues.join(', ')}`);
    block(`СМЕЩЕНО ЗАПИСЕЙ: ${moved.length} из ${out.rows.length} легли не туда, куда послал вектор`,
      moved.length === 0,
      moved.slice(0, 8).map((r) => `#${r.i} ${r.base}+${r.off}=${r.asked} → ${r.got} (${r.delta > 0 ? '+' : ''}${r.delta})`).join(' · '));
    out.ok = true;
  } finally {
    // ОТКАТ БЕЗУСЛОВНЫЙ И ПЕРВЫЙ. `zeroCurve` сам перечитывает через договор устаивания.
    if (touched) {
      try {
        const z = nvapi.zeroCurve(nv, handle);
        block('ОТКАТ: вся кривая обнулена, ненулевых не осталось', z.ok,
          `ненулевых ${z.remainingNonZero}, не записалось ${z.failed}${z.why ? ` · ${z.why}` : ''}`);
      } catch (e) { block('ОТКАТ: вся кривая обнулена', false, String(e?.message ?? e)); }
    }
    try { watchdog?.disarm(); } catch { /* разоружение не должно ронять отчёт */ }
    try { nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload); } catch { /* закрытие не роняет */ }
  }
  return out;
}

async function mainProbeSnap() {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
  };
  const r = await probeCurveSnap({
    deltaMhz: Number(arg('mhz', 203)),
    capMhz: Number(arg('cap', 2355)),
  });
  for (const b of r.blocks) console.log(`  ${b.ok ? 'OK  ' : 'ПЛОХО'} ${b.name}${b.detail ? ` — ${b.detail}` : ''}`);
  if (r.summary) {
    console.log('');
    console.log(`СВОДКА: верх ${r.summary.topBefore} → ${r.summary.topAfter} при потолке ${r.summary.capMhz} `
      + `(превышение ${r.summary.overCapMhz}) · плато: просили ${r.summary.plateauAsked} записей на одной частоте, `
      + `карта дала ${r.summary.plateauDistinctGot} различных · смещено ${r.summary.movedEntries} записей`);
  }
  console.log('ПРОЖИГОВ НЕ БЫЛО — это замер формы записи, а не проверка стабильности.');
  return r.ok && r.blocks.every((b) => b.ok) ? 0 : 1;
}

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
          `записано ${w.written}, отказов ${w.failed}${w.failures.length ? ` — ${JSON.stringify(w.failures)}` : ''}`
          + `${w.why ? ` · ${w.why}` : ''}`);
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

// =================================================================================================
// THE OFFLINE SELFTEST — this module had NONE until 2026-08-11, and its header said so
// =================================================================================================

/**
 * The safety shape, driven on injected functions. No GPU, no card, no writes.
 *
 * What it guards is the class that cost the owner a night: **an undo written as a chain, where the
 * first thing that throws cancels the rest.** Every block below is one arrangement of that failure.
 *
 * MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
 *   1. let a throwing step abort the list          → «падение ПЕРВОГО шага не отменяет остальные»
 *   2. swallow a throw and report it green         → «упавший шаг отката КРАСНЫЙ, а не тихий»
 *   3. skip a step with no runnable part           → «шаг без исполняемой части — красный блок, а не пропуск»
 *
 * AND FOR `chooseWriteShape`, added 2026-08-14 with the shape itself (`bugs/02` step 1):
 *   4. never recognise an enforceable cap          → «потолок держит КРИВАЯ → форма ОТГРУЖАЕМАЯ»
 *   5. drop the pinned branch                      → «потолок держит ЗАКРЕПЛЕНИЕ → форма равномерная, и расхождение названо»
 *   6. let the last case agree instead of refusing → «потолок не держит НИЧТО → ОТКАЗ»
 *   7. accept a vector that failed to build        → «вектора нет → отказ, а не молчаливое согласие»
 *
 * AND FOR `pinRequired`, added 2026-08-14 after the conflict it exists to prevent BIT LIVE:
 *   8. demand a pin even when the curve holds     → «кривая держит → ЗАКРЕПЛЕНИЕ НЕ ТРЕБУЕТСЯ»
 *   9. never demand a pin                         → «кривой не удержать → закрепление ОБЯЗАТЕЛЬНО»
 */
export async function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  const trail = [];
  const step = (name, fn) => ({ name, run: async () => { trail.push(name); return fn ? fn() : 'ок'; } });

  // 1. THE CORE GUARANTEE: the first step throws, and everything after it still runs.
  trail.length = 0;
  const b1 = await runUndo([
    step('проверка', () => { throw new Error('проверка сорвалась'); }),
    step('отпустить частоту'),
    step('обнулить кривую'),
    step('разоружить сторожа'),
  ]);
  ok('падение ПЕРВОГО шага не отменяет остальные', trail.length, 4);
  ok('и все они доложены блоками, а не проглочены', b1.length, 4);
  // NULL-SAFE, ALL OF THEM. A block that THROWS when its expectation is unmet reports nothing and
  // takes the whole suite with it — three mutations did exactly that before this line was written,
  // and a crashed verifier is not a red verifier (EXP-0016).
  ok('упавший шаг отката КРАСНЫЙ, а не тихий', b1[0]?.ok ?? null, false);
  ok('и его причина названа', /проверка сорвалась/.test(b1[0]?.detail ?? ''), true);
  ok('а уцелевшие шаги зелёные', b1.length === 4 && b1.slice(1).every((x) => x.ok), true);

  // 2. A throw in the MIDDLE must not take the tail with it — the arrangement where the curve is
  // already written and only the watchdog disarm remains.
  trail.length = 0;
  const b2 = await runUndo([
    step('отпустить частоту'),
    step('обнулить кривую', () => { throw new Error('запись отказала'); }),
    step('разоружить сторожа'),
  ]);
  ok('падение В СЕРЕДИНЕ не уносит хвост — сторож всё равно разоружается',
    trail.includes('разоружить сторожа'), true);
  ok('и провал именно на своём шаге', [b2[0]?.ok ?? null, b2[1]?.ok ?? null, b2[2]?.ok ?? null], [true, false, true]);

  // 3. EVERY step throws — the worst case must still report five blocks, not one exception.
  const b3 = await runUndo(['а', 'б', 'в'].map((n) => ({ name: n, run: async () => { throw new Error(`${n} упал`); } })));
  ok('когда падает ВСЁ — доклад полный, а не одно исключение', b3.length, 3);
  ok('и каждый блок красный со своей причиной',
    b3.length === 3 && b3.every((x, i) => !x.ok && String(x.detail).includes(['а', 'б', 'в'][i])), true);

  // 4. A malformed list entry is a defect of OUR list, and it is named as such rather than skipped.
  const b4 = await runUndo([{ name: 'кривой шаг' }, step('живой шаг')]);
  ok('шаг без исполняемой части — красный блок, а не пропуск', b4[0]?.ok ?? null, false);
  ok('и он не мешает следующему', b4[1]?.ok ?? null, true);

  // 5. Nothing to undo is a legal, GREEN outcome — the dry-run and refusal paths take it.
  ok('пустой список отката — не ошибка', (await runUndo([])).length, 0);

  // 6. ЧТЕНИЕ ПОМЕЧАЕТСЯ КАК ЧТЕНИЕ (`plans/28`, находка A). Шов между «кто ставит метку» и «кто её
  //    читает» до 2026-08-23 не проверял НИКТО: блоки движка строили фикстуру руками, поэтому
  //    мутация «вернуть проверке undo: true» не красила ничего (EXP-0108 — набор дотягивался до
  //    судьи, но не до того, кто судью кормит). Здесь проверяется именно пометка.
  const b5 = await runUndo([
    { kind: 'proof', name: 'ПОТОЛОК 2790 МГц УСТОЯЛ ПОД НАГРУЗКОЙ', run: async () => { throw new Error('карта ушла ВЫШЕ потолка: максимум 2805 МГц при потолке 2790'); } },
    step('обнулить кривую'),
  ]);
  ok('шаг с kind:proof помечен ЧТЕНИЕМ, а не откатом — иначе его отказ читается как «карта не вернулась»',
    [b5[0]?.proof ?? null, b5[0]?.undo ?? null], [true, false]);
  ok('а настоящий шаг отката рядом с ним по-прежнему помечен откатом',
    [b5[1]?.undo ?? null, b5[1]?.proof ?? null], [true, false]);
  ok('отказ проверки несёт ПРИЧИНУ отдельным полем, а не только внутри своего рассказа',
    b5[0]?.why, 'карта ушла ВЫШЕ потолка: максимум 2805 МГц при потолке 2790');
  ok('и рассказ проверки говорит «проверка не прошла», а не «шаг отката упал»',
    [String(b5[0]?.detail).startsWith('проверка не прошла'), String(b5[1 - 1]?.detail).includes('шаг отката упал')],
    [true, false]);

  // --- THE VOLTAGE LADDER, on a synthetic curve. Its job is to express the owner's step sizes in the
  // unit he stated them in, and its trap is a curve region where several points share a frequency.
  const pt = (i, mv, mhz) => ({ i, mv, mhz, microVolts: mv * 1000, freqKhz: mhz * 1000 });
  // a well-graded region: 5 mV per point, 20 MHz apart
  const graded = [0, 1, 2, 3, 4, 5, 6].map((k) => pt(k, 700 + k * 5, 1000 + k * 20));
  const lad = ascentLadderByVoltage(graded, 1120, { stepMv: 5 });
  ok('лестница по напряжению идёт ВНИЗ по напряжению, а не вверх',
    lad.every((r, i, arr) => i === 0 || r.mv < arr[i - 1].mv), true);
  ok('и каждая ступень несёт, сколько мВ она снимает', lad[0]?.savedMv > 0, true);
  // the floor trap: three points share one frequency, so ONE offset reaches the cheapest of them
  const floored = [pt(0, 450, 180), pt(1, 500, 180), pt(2, 550, 180), pt(3, 700, 1000)];
  const flat = ascentLadderByVoltage(floored, 1000, { stepMv: 5 });
  ok('на полу кривой одна ступень падает сразу к САМОМУ дешёвому напряжению, и это видно',
    flat[0]?.mv, 450);
  ok('и её глубина не выдумана, а посчитана по получившейся кривой', flat[0]?.savedMv, 250);

  // --- WHICH SHAPE MAY BE WRITTEN, and WHO holds the ceiling. `bugs/02` step 1.
  //
  // The vectors are handed in as fixtures rather than built from a curve: this function DECIDES, it
  // does not compute — the arithmetic has one author (`nvapi.buildRaiseAndCapVector`) and its own
  // blocks over there. Feeding fixtures is what keeps the two suites from testing each other's job.
  const vec = (over) => ({ ok: true, capMhz: 2400, lowestEnforceableCapMhz: 2172, capEnforced: true, capLeakMhz: 0, ...over });
  // NULL-SAFE BY CONSTRUCTION: a mutation's whole job is to produce the shape the assertion did not
  // expect, and an assertion that THROWS reports nothing — a crashed suite reads exactly like «no
  // findings» (EXP-0040). So the call itself is caught, and an exception becomes a red block.
  const choose = (v, o) => { try { return chooseWriteShape(v, o); } catch (e) { return { ok: `ИСКЛЮЧЕНИЕ: ${e.message}`, shape: null, heldBy: null, why: '' }; } };

  const byCurve = choose(vec({}), { pinned: false });
  ok('потолок держит КРИВАЯ → форма ОТГРУЖАЕМАЯ, и закрепление для этого не нужно',
    [byCurve.ok, byCurve.shape, byCurve.heldBy], [true, 'raise-and-cap', 'кривая']);
  ok('и когда кривая держит сама, закрепление НИЧЕГО не меняет в выборе формы',
    choose(vec({}), { pinned: true }).shape, 'raise-and-cap');

  const low = vec({ capMhz: 2100, capEnforced: false, capLeakMhz: 72 });
  const byPin = choose(low, { pinned: true });
  ok('потолок держит ЗАКРЕПЛЕНИЕ → форма равномерная, и расхождение с отгружаемой НАЗВАНО',
    [byPin.ok, byPin.shape, byPin.heldBy], [true, 'uniform', 'закрепление частоты']);
  ok('и причина несёт ЧИСЛО утечки, а не только признак', /72 МГц/.test(byPin.why ?? ''), true);

  const nobody = choose(low, { pinned: false });
  ok('потолок не держит НИЧТО → ОТКАЗ, и формы не назначается вовсе',
    [nobody.ok, nobody.shape], [false, null]);

  const broken = choose({ ok: false, why: 'ни одной точки с частотой' }, { pinned: true });
  ok('вектора нет → отказ, а не молчаливое согласие (даже при закреплении)',
    [broken.ok, broken.shape], [false, null]);
  ok('и отказ несёт причину, по которой вектор не построился',
    /ни одной точки с частотой/.test(broken.why ?? ''), true);
  ok('вектор вообще не передан → тоже отказ, а не исключение',
    choose(undefined, { pinned: true }).ok, false);

  // The boundary case decides which side the FLOOR belongs to — and this block guards that the
  // decision READS the vector's verdict instead of re-deriving it from the numbers on its own.
  ok('РОВНО на полу железа решение берётся из вердикта вектора, а не пересчитывается заново',
    choose(vec({ capMhz: 2172, capEnforced: true }), { pinned: false }).shape, 'raise-and-cap');

  // --- ОДИН ДЕРЖАТЕЛЬ, НИКОГДА ДВА. Куплено живым прогоном 2026-08-14: развёртка поставила потолок
  // кривой на 2842 И закрепила частоту на 2842; карта под потолком села на 2775…2827, доказательство
  // замка честно отказало, и ступень, где ВСЕ ТРИ формы дали PASS, вышла как НЕИЗВЕСТНО.
  ok('кривая держит → ЗАКРЕПЛЕНИЕ НЕ ТРЕБУЕТСЯ (иначе потолок и замок дерутся за одну частоту)',
    choose(vec({}), { pinned: true }).pinRequired, false);
  ok('кривой не удержать → закрепление ОБЯЗАТЕЛЬНО, оно там единственный держатель',
    choose(low, { pinned: true }).pinRequired, true);
  ok('и держатель ровно один: форма и требование замка никогда не утверждают оба сразу',
    [choose(vec({}), { pinned: true }), choose(low, { pinned: true })].map((r) => `${r.shape}/${r.pinRequired}`),
    ['raise-and-cap/false', 'uniform/true']);
  ok('отказ замка не требует — требовать нечего, когда прогона не будет',
    choose(low, { pinned: false }).pinRequired, false);

  // ─── О КАКОЙ ЧАСТОТЕ СПРАШИВАЕТ ПЕРЕЧИТЫВАНИЕ (`bugs/22`) ──────────────────────────────────────
  //
  // Живой прогон 2026-08-16 22:31 встал на 2872 МГц, закрыв 2 частоты из 266: подрезка ставит верх
  // кривой РОВНО на потолок (замерено офлайн на живой заводской кривой при четырёх подъёмах — зазор
  // 0,0 МГц), и одной ступени сетки хватает, чтобы обслуживающей записи не осталось вовсе.
  //
  // Блоки утверждают ПРИЧИНУ, а не факт остановки (EXP-0075, второй триггер): «спросили ниже» —
  // это другое утверждение, чем «что-то вернулось».
  ok('ХОЛОДНАЯ КАРТА: кривая отдала заказанное — спрашиваем РОВНО о заказанном, ничего не меняется',
    askAtClockMhz(2872, 2872), 2872);
  ok('КРИВАЯ ОТДАЛА МЕНЬШЕ ЗАКАЗАННОГО — спрашиваем о ВЫДАННОМ, иначе обслуживающей записи нет вовсе',
    askAtClockMhz(2872, 2865), 2865);
  ok('и ровно на одну ступень сетки — тот самый случай, что уронил прогон (7 МГц ≈ 4 °C дрейфа)',
    [askAtClockMhz(2880, 2873), askAtClockMhz(2872, 2865)], [2873, 2865]);
  //   НАПРАВЛЕНИЕ И ЕСТЬ ВЕСЬ ДОВОД БЕЗОПАСНОСТИ: спросить ВЫШЕ потолка значило бы вынести вердикт
  //   о частоте, до которой карте подниматься не разрешали, — это класс `bugs/02`. Поэтому запас
  //   куплен вопросом вниз, а НЕ поднятием потолка.
  ok('НИКОГДА НЕ СПРАШИВАЕТ ВЫШЕ ЗАКАЗА: кривая предлагает больше — вопрос остаётся о заказанном',
    [askAtClockMhz(2872, 2900), askAtClockMhz(2872, 3172)], [2872, 2872]);
  //   ИЗМЕРЕНИЯ НЕТ — И ЭТО НЕ ПОВОД ПОДСТАВИТЬ ЧИСЛО. Верх не измерен → спрашиваем о заказанном,
  //   и дальше по течению стоит штатный останов «карта не сказала». Мутация, заставляющая эту ветку
  //   вернуть null, краснит блок ниже: тогда вопрос не задаётся вовсе и ступень гибнет молча.
  ok('ВЕРХ НЕ ИЗМЕРЕН — вопрос о заказанном, а не выдуманное число',
    [askAtClockMhz(2872, null), askAtClockMhz(2872, NaN), askAtClockMhz(2872, 0)], [2872, 2872, 2872]);
  ok('ЗАКАЗА НЕТ — нет и вопроса: отсутствие частоты не подменяется верхом кривой',
    [askAtClockMhz(null, 2865), askAtClockMhz(0, 2865)], [null, null]);

  // ─── ПРОЖИГ ШЁЛ НА ТОЙ ЛИ ЧАСТОТЕ, КОТОРУЮ ТЮНИМ (слово владельца 2026-08-22) ────────────────
  //   До этой правки судилось только направление ВВЕРХ. Направление ВНИЗ — это `bugs/28`: вердикт
  //   пишется в строку заказанной частоты, а прожиг шёл ниже, где кремнию легче.
  //   АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
  //     BS. убрать проверку недобора (short = false)          → «НЕДОБОР ЛОВИТСЯ»
  //     BT. судить недобор по МИНИМУМУ вместо медианы         → «ОДНА ПРОСЕВШАЯ ПРОБА — НЕ НЕДОБОР»
  //     BU. судить превышение по медиане вместо максимума     → «ПРЕВЫШЕНИЕ СУДИТСЯ ПО МАКСИМУМУ»
  //     BV. расширить допуск недобора                         → «ДОПУСК — ОДНА СТУПЕНЬ СЕТКИ»
  //     BW. считать вердикт при неназванной частоте           → «НЕЧЕГО СУДИТЬ — ЭТО ОТКАЗ»
  {
    const J = (o) => judgeDeliveredClock(o);
    ok('ПРОЖИГ НА НУЖНОЙ ЧАСТОТЕ — вердикт принимается',
      J({ capMhz: 2880, median: 2880, max: 2880 }).ok, true);
    ok('НЕДОБОР ЛОВИТСЯ: прожиг шёл на 2865 под именем 2880 — ровно случай bugs/28',
      [J({ capMhz: 2880, median: 2865, max: 2865 }).ok, J({ capMhz: 2880, median: 2865, max: 2865 }).short,
       J({ capMhz: 2880, median: 2865, max: 2865 }).shortfall], [false, true, 15]);
    ok('и отказ НАЗЫВАЕТ обе частоты, а не сообщает «что-то не так»',
      /2865/.test(J({ capMhz: 2880, median: 2865, max: 2865 }).why)
      && /2880/.test(J({ capMhz: 2880, median: 2865, max: 2865 }).why), true);
    ok('ДОПУСК — ОДНА СТУПЕНЬ СЕТКИ: 8 МГц ниже это округление, 15 уже недобор',
      [J({ capMhz: 2880, median: 2872, max: 2872 }).ok, J({ capMhz: 2880, median: 2865, max: 2865 }).ok],
      [true, false]);
    // Первая редакция этого блока называлась «судим медиану, а не минимум» и НЕ ПРОВЕРЯЛА ЭТОГО:
    // функция получает уже посчитанную медиану и минимума не видит вовсе. Мутация «судить по
    // минимуму» покраснила четыре блока разом и вскрыла обман. Здесь остаётся то, что тут
    // действительно проверяемо: вниз судит ТОЛЬКО медиана, и высокий пик недобор не спасает.
    ok('ВНИЗ СУДИТ ТОЛЬКО МЕДИАНА: пик у самого потолка недобор не выкупает',
      [J({ capMhz: 2880, median: 2865, max: 2880 }).short, J({ capMhz: 2880, median: 2865, max: 2880 }).ok],
      [true, false]);
    ok('ПРЕВЫШЕНИЕ СУДИТСЯ ПО МАКСИМУМУ: медиана под потолком, но пик над ним — отказ',
      [J({ capMhz: 2880, median: 2880, max: 2910 }).ok, J({ capMhz: 2880, median: 2880, max: 2910 }).breached],
      [false, true]);
    ok('и ПРЕВЫШЕНИЕ СИЛЬНЕЕ НЕДОБОРА: когда верно и то и то, называется потолок',
      J({ capMhz: 2880, median: 2860, max: 2910 }).breached, true);
    ok('НЕЧЕГО СУДИТЬ — ЭТО ОТКАЗ, а не молчаливое «сойдёт»',
      [J({ capMhz: null, median: 2880, max: 2880 }).ok, J({ capMhz: 2880, median: null, max: null }).ok],
      [false, false]);

    // ─── ДЕРЖАТЕЛЬ ПРОБИТОГО ПОТОЛОКА (`bugs/50`, замер 2026-08-25) ────────────────────────────
    //
    // Фикстуры — НАСТОЯЩИЕ строки боевого журнала, а не придуманные: `seq 727` (потолок 2355,
    // кривая после записи 2355, карта 2370) и `seq 702` (потолок 2355, кривая после записи 2370).
    // Оба до этой правки печатали ОДНО сообщение, и по нему чинили бы одно и то же место.
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   CB. вернуть одно сообщение на оба случая     → «...и НЕВСТАВШАЯ форма зовётся ЗАПИСЬЮ»
    //   CC. звать ЗАПИСЬ при кривой, равной потолку  → «ВСТАВШАЯ ФОРМА — ЭТО КАРТА, А НЕ ЗАПИСЬ»
    //   CD. подставлять КАРТА без перечитанной кривой→ «НЕ ПЕРЕЧИТАНО = НЕИЗВЕСТНО, А НЕ ДОГАДКА»
    //
    // ✏️ АДРЕСАТ CB ИСПРАВЛЕН ПОСЛЕ ПРОГОНА, А НЕ ПОДОГНАН ЗАДНИМ ЧИСЛОМ. Заранее был назван блок
    // «ПРОБИТЫЙ ПОТОЛОК НАЗЫВАЕТ ДЕРЖАТЕЛЯ», и он остался ЗЕЛЁНЫМ: поле `breachHolder` считается
    // отдельно от текста, поэтому мутация текста его не трогает. Класс поймал соседний блок — тот,
    // что судит саму формулировку. Это разделение верное (поле для счёта, текст для глаз), и запись
    // здесь стоит ради него: два блока сторожат ДВЕ разные половины одного решения, а не одну дважды.
    const card = J({ capMhz: 2355, median: 2370, max: 2370, offeredAfterMhz: 2355 });
    const write = J({ capMhz: 2355, median: 2370, max: 2370, offeredAfterMhz: 2370 });
    const blind = J({ capMhz: 2355, median: 2370, max: 2370 });
    ok('ПРОБИТЫЙ ПОТОЛОК НАЗЫВАЕТ ДЕРЖАТЕЛЯ: три положения дел — три разных ответа, а не одно',
      [card.breachHolder, write.breachHolder, blind.breachHolder],
      ['КАРТА', 'ЗАПИСЬ', 'НЕИЗВЕСТНО']);
    ok('ВСТАВШАЯ ФОРМА — ЭТО КАРТА, А НЕ ЗАПИСЬ: кривая ровно на потолке (seq 727), виновата карта',
      [/КАРТА ЕЁ НЕ СОБЛЮЛА/.test(card.why), /ФОРМА НЕ ВСТАЛА/.test(card.why)], [true, false]);
    ok('...и НЕВСТАВШАЯ форма зовётся ЗАПИСЬЮ: кривая выше потолка (seq 702) — виноват путь записи',
      [/ФОРМА НЕ ВСТАЛА/.test(write.why), /наблюдение О КАРТЕ/.test(write.why)], [true, false]);
    ok('НЕ ПЕРЕЧИТАНО = НЕИЗВЕСТНО, А НЕ ДОГАДКА: без кривой после записи держатель не выдумывается',
      [/не перечитана/.test(blind.why), /КАРТА ЕЁ НЕ СОБЛЮЛА|ФОРМА НЕ ВСТАЛА/.test(blind.why)],
      [true, false]);
    ok('и все три ответа остаются ОТКАЗОМ — различитель называет виновного, а не отменяет остановку',
      [card.ok, write.ok, blind.ok, card.breached, write.breached, blind.breached],
      [false, false, false, true, true, true]);
    // Держатель — величина ТОЛЬКО пробитого потолка. У недобора и у прошедшей ступени его нет, и
    // `null` здесь значит «вопрос не стоял», а не «не смогли ответить».
    ok('держателя нет там, где потолок не пробит — ни у недобора, ни у чистой ступени',
      [J({ capMhz: 2880, median: 2865, max: 2865, offeredAfterMhz: 2880 }).breachHolder,
       J({ capMhz: 2880, median: 2880, max: 2880, offeredAfterMhz: 2880 }).breachHolder],
      [null, null]);
  }

  // ─── ЧТО СТУПЕНЬ ДЕЛАЕТ С ЭТИМ ВЕРДИКТОМ (`plans/25` шаг 1.2, долг сессии 38) ─────────────────
  //
  // Блоки выше судят ФУНКЦИЮ-СУДЬЮ. Они зеленели и тогда, когда недобор ронял ступень: судья и до
  // правки, и после неё возвращает `short: true` — менялось то, что ступень с этим делала.
  // Замерено 2026-08-23 09:39: мутация «вернуть `throw` на недобор» оставила ВСЮ батарею зелёной,
  // 952 блока из 952. То есть поведение, ради которого канон переписан, не сторожил никто.
  //
  // Здесь судится САМО ДЕЙСТВИЕ — `applyCeilingJudgement`, ровно та функция, которую зовёт блок
  // «ПОТОЛОК» в `runStep`, а не её пересказ.
  //
  // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
  //   BX. вернуть `throw` на недобор                        → «НЕДОБОР НЕ РОНЯЕТ СТУПЕНЬ»
  //   BY. снимать вердикт при недоборе (verdict = null)     → «НЕДОБОР НЕ ТРОГАЕТ ВЕРДИКТ»
  //   BZ. перестать бросать на пробитом потолке             → «ПРОБИТЫЙ ПОТОЛОК ОСТАНАВЛИВАЕТ»
  //   CA. не помечать факт недобора (`clockShortfall`)      → «НЕДОБОР ОСТАЁТСЯ ФАКТОМ СТУПЕНИ»
  console.log('\n— НЕДОБОР ЧАСТОТЫ: ЗАМЕР, А НЕ ОТКАЗ (канон 2026-08-22) —');
  {
    const J = (o) => judgeDeliveredClock(o);
    // Ступень, дошедшая до проверки потолка, уже несёт вердикт оракула — именно его нельзя терять.
    const stepWithPass = () => ({ verdict: config.VERDICT.PASS, deliveredMhz: 2865 });
    const run = (out, j, obs) => {
      try { return { threw: false, detail: applyCeilingJudgement(out, j, obs), out }; }
      catch (e) { return { threw: true, detail: e?.message ?? '', out }; }
    };

    // НЕДОБОР 15 МГц — ровно случай живого прогона: карта под сниженным напряжением села ниже заказа.
    const short = run(stepWithPass(), J({ capMhz: 2880, median: 2865, max: 2865 }),
      { capMhz: 2880, median: 2865, max: 2865, loadedSamples: 40 });
    ok('НЕДОБОР НЕ РОНЯЕТ СТУПЕНЬ: карта села ниже заказа — исключения нет, блок остаётся зелёным',
      short.threw, false);
    ok('НЕДОБОР НЕ ТРОГАЕТ ВЕРДИКТ: PASS оракула остаётся PASS, отказа замка не объявляется',
      [short.out.verdict, short.out.pinRefused ?? false], [config.VERDICT.PASS, false]);
    ok('НЕДОБОР ОСТАЁТСЯ ФАКТОМ СТУПЕНИ: отчёт получает и признак, и ЧИСЛО недобора',
      [short.out.clockShortfall, short.out.deliveredShortfallMhz], [true, 15]);
    ok('и подробность блока НАЗЫВАЕТ недобор числом, а не молчит о нём',
      /НЕДОБОР 15 МГц/.test(short.detail), true);

    // ПРОБИТЫЙ ПОТОЛОК — противоположный исход той же проверки, и он обязан остаться отказом.
    // Без этого блока мутация «перестать бросать» превратила бы правку в «потолок больше не держим».
    const over = run(stepWithPass(), J({ capMhz: 2880, median: 2880, max: 2910 }),
      { capMhz: 2880, median: 2880, max: 2910, loadedSamples: 40 });
    ok('ПРОБИТЫЙ ПОТОЛОК ОСТАНАВЛИВАЕТ: исключение брошено, вердикт снят, замок объявлен отказавшим',
      [over.threw, over.out.verdict, over.out.pinRefused], [true, null, true]);
    ok('и причина остановки НАЗЫВАЕТ потолок, а не сообщает «что-то не так»',
      /ВЫШЕ потолка/.test(over.out.reason ?? ''), true);

    // ─── ДЕРЖАТЕЛЬ ЕДЕТ ПОЛЕМ, А НЕ ТОЛЬКО В ПРОЗЕ (`bugs/50`) ─────────────────────────────────
    //   CE. не довозить `ceilingBreachHolder` до `out` → этот блок
    // Сводка прогона группирует пропущенные частоты ПО КЛАССУ (слово владельца 2026-08-24), а по
    // строке группировать нельзя: в неё входят числа самой ступени, и две одинаковые причины дадут
    // два разных ключа. Поэтому блок судит ПОЛЕ, а не текст.
    const byCard = run(stepWithPass(),
      J({ capMhz: 2355, median: 2370, max: 2370, offeredAfterMhz: 2355 }),
      { capMhz: 2355, median: 2370, max: 2370, loadedSamples: 40 });
    const byWrite = run(stepWithPass(),
      J({ capMhz: 2355, median: 2370, max: 2370, offeredAfterMhz: 2370 }),
      { capMhz: 2355, median: 2370, max: 2370, loadedSamples: 40 });
    ok('ДЕРЖАТЕЛЬ ЕДЕТ ПОЛЕМ: ступень несёт «КАРТА» или «ЗАПИСЬ» отдельным полем, годным для счёта',
      [byCard.out.ceilingBreachHolder, byWrite.out.ceilingBreachHolder], ['КАРТА', 'ЗАПИСЬ']);
    ok('...и обе по-прежнему ОСТАНАВЛИВАЮТ ступень — различитель не смягчает остановку',
      [byCard.threw, byWrite.threw, byCard.out.verdict, byWrite.out.verdict],
      [true, true, null, null]);
    ok('...а у ступени без пробитого потолка поля нет вовсе — «вопрос не стоял», а не «не смогли»',
      short.out.ceilingBreachHolder ?? null, null);

    // ЧИСТАЯ СТУПЕНЬ — контроль, что зелёный путь не задет ни одной из мутаций.
    const clean = run(stepWithPass(), J({ capMhz: 2880, median: 2880, max: 2880 }),
      { capMhz: 2880, median: 2880, max: 2880, loadedSamples: 40 });
    ok('КАРТА ДЕРЖИТ ЗАКАЗ: ни исключения, ни признака недобора, вердикт цел',
      [clean.threw, clean.out.clockShortfall ?? false, clean.out.verdict],
      [false, false, config.VERDICT.PASS]);
  }

  // ═══ `bugs/47` — СДВИГ СЧИТАЕТСЯ ПО ТОЙ ТАБЛИЦЕ, ПО КОТОРОЙ БУДЕТ ЗАПИСАН ═══════════════════════
  //
  // 🔴 ЦЕНА ЗАМЕРЕНА НА КАРТЕ ВЛАДЕЛЬЦА: заказ 845 мВ при стоке 895 обслужило 910, прогон встал,
  // покрытие 0 из 7. Числа ниже — из журнала того прогона (seq 693), а не выдуманы.
  //
  // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
  //   DQ. вернуть применение готового `askedOffsetMhz` → «ПРОМАХ ТАБЛИЦЫ ИСПРАВЛЕН»
  //   DR. пересчитывать и БЕЗ цели                     → «БЕЗ ЦЕЛИ НИЧЕГО НЕ ТРОГАЕТСЯ»
  {
    // Живой случай: движок видел точку 63 на 2152 МГц и просил +203. Атом читает её уже на 2145 —
    // карта нагрелась, ось просела на 7 МГц. Готовый сдвиг посадил бы точку на 2348, мимо 2355.
    const live = offsetForTarget({ targetClockMhz: 2355, pointFreqMhz: 2145, askedOffsetMhz: 203 });
    ok('bugs/47: ПРОМАХ ТАБЛИЦЫ ИСПРАВЛЕН — сдвиг считается по таблице АТОМА, и дрейф назван числом',
      [live.offsetMhz, live.driftMhz, live.recomputed], [210, -7, true]);
    ok('bugs/47: и пересчитанный сдвиг САДИТ точку РОВНО на цель, а готовый — мимо',
      [2145 + live.offsetMhz, 2145 + live.askedOffsetMhz], [2355, 2348]);
    // ⚠️ ВТОРАЯ ПОЛОВИНА, БЕЗ КОТОРОЙ ПОЧИНКА — ЗАХВАТ ЧУЖОГО РЕШЕНИЯ. Опыты и `--drill` задают
    // сдвиг напрямую, цели у них нет, и подменять им число нельзя.
    ok('bugs/47: БЕЗ ЦЕЛИ НИЧЕГО НЕ ТРОГАЕТСЯ — прямой сдвиг остаётся прямым',
      (() => { const r = offsetForTarget({ askedOffsetMhz: 45 }); return [r.offsetMhz, r.recomputed, r.driftMhz]; })(),
      [45, false, 0]);
    ok('bugs/47: цель есть, а частоты точки нет → тоже не трогаем (догадка хуже прямого числа)',
      offsetForTarget({ targetClockMhz: 2355, pointFreqMhz: null, askedOffsetMhz: 203 }).recomputed, false);
    ok('bugs/47: таблицы совпали → дрейф ноль, число не меняется',
      (() => { const r = offsetForTarget({ targetClockMhz: 2355, pointFreqMhz: 2152, askedOffsetMhz: 203 }); return [r.offsetMhz, r.driftMhz]; })(),
      [203, 0]);
  }

  return { ok: results.every((r) => r.ok), results };
}

async function main() {
  if (process.argv.includes('--selftest')) {
    const r = await selfTest();
    for (const x of r.results) {
      console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok ? '' : `  -> получено ${JSON.stringify(x.got)}, ждали ${JSON.stringify(x.want)}`}`);
    }
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА: есть расхождения.');
    return r.ok ? 0 : 1;
  }
  if (process.argv.includes('--shape')) return mainShape();
  if (process.argv.includes('--measure')) return mainMeasure();
  if (process.argv.includes('--ascend')) return mainAscend();
  if (process.argv.includes('--probe-snap')) return mainProbeSnap();
  const point = Number(arg('point', DEFAULT_POINT));
  const offsetMhz = Number(arg('mhz', DEFAULT_STEP_MHZ));
  const workload = String(arg('workload', 'sdc_fma'));
  const seconds = Number(arg('seconds', 30));
  const sustain = Number(arg('sustain', 10));
  const dryRun = process.argv.includes('--dry-run');
  const allPoints = process.argv.includes('--all-points');
  // THE SHIPPED SHAPE AS AN OPERATOR FLAG (`bugs/02` step 1): the whole curve up WITH the ceiling,
  // which is what a profile actually applies. `--all-points` stays the uniform raise it always was.
  const shippedShape = process.argv.includes('--shipped-shape');
  const capArg = arg('cap', null);
  const capMhz = capArg === null ? null : Number(capArg);
  if (shippedShape && capMhz === null) {
    console.error('ОШИБКА: --shipped-shape требует --cap <МГц> — без потолка это не отгружаемая форма, а равномерный подъём.');
    return 2;
  }
  // THE DIVERSE SET as an operator command (plans/05 §4.3). One write, one watchdog, three loads:
  // the shape that decides the point is named in the block list.
  const useSet = process.argv.includes('--set');
  const stress = await import('./stress-tester.mjs');
  const shapes = useSet ? stress.DIVERSE_SET : null;

  console.log('ПЕРВЫЙ ПОЛОЖИТЕЛЬНЫЙ СДВИГ — ЭТО И ЕСТЬ АНДЕРВОЛЬТ');
  console.log('');
  const whatWeDo = shippedShape
    ? `ОТГРУЖАЕМАЯ ФОРМА: вся кривая вверх на +${offsetMhz} МГц С ПОТОЛКОМ ${capMhz} МГц`
    : (allPoints ? `ВСЯ КРИВАЯ вверх на +${offsetMhz} МГц (равномерно)` : `точка ${point}, сдвиг +${offsetMhz} МГц`);
  console.log(`  ЧТО ДЕЛАЕМ: ${whatWeDo}`);
  console.log('              — «эта частота теперь берётся при МЕНЬШЕМ напряжении».');
  if (allPoints || shippedShape) {
    console.log('              Вся кривая, а не одна точка: закреплённую частоту обслуживает БЛИЖАЙШАЯ');
    console.log('              подходящая точка, поэтому подъём одной ничего не удешевляет (researches/02 §6.2).');
  }
  if (shippedShape) {
    console.log('              С ПОТОЛКОМ: точки выше него придавливаются вниз, поэтому максимум разгона');
    console.log('              не растёт и экономия не уходит в скорость. Это ровно та форма, что уедет');
    console.log('              в профиль — искать в ней и значит искать то, что отгружаем (bugs/02).');
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

  const r = await runStep({ point, offsetMhz, workload, seconds, sustain, dryRun, allPoints,
    writeShape: shippedShape ? 'raise-and-cap' : null, capMhz, shapes });
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
