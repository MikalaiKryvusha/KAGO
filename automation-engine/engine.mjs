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

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import config from './config.mjs';
// The margin helper is a NAMED export only — `config.mjs`'s default object carries constants, not
// functions, and reaching for `config.marginAboveLastStableMv` crashes the suite instead of reddening
// a block (paid for on 2026-08-15 21:5x, EXP-0040's rule about assertions that kill the reporter).
import { marginAboveLastStableMv } from './config.mjs';
// `chooseWriteShape` is imported STATICALLY and that is safe offline: `vf-step` imports `nvapi`
// lazily, inside the functions that write, so nothing here reaches for koffi or the driver.
import { ASCENT_COARSE_MHZ, ASCENT_FINE_MHZ, chooseWriteShape } from './lib/vf-step.mjs';
import { DIVERSE_SET, furnaceSetAtLevel, FURNACE_LADDER } from './lib/stress-tester.mjs';
import { localIso } from './lib/card-grids.mjs';
// The tuning-curve document, and ONLY through its own author (R14a). The sweep decides WHAT was
// measured; `curve-store` decides what the artifact may hold, and there is no second writer.
import {
  CURVE_STATUS, CURVE_TAGS, tagsForStatus, claimsBurnProof, statusFromTags, closePoint, leverFloorFor,
  validateCurveDoc,
  saveCurveDoc,
  loadCurveDoc,
} from './lib/curve-store.mjs';
import {
  writeIntent, writeVerdict,
  openJournal, readJournal, orphanIntents, resumeState, hangFloors, provenRungs, SWEEP_DIR,
  closeAsOperatorStop, closeAsWriterDeath, RUNG_OUTCOME,
  assertSandbox as assertJournalSandbox,
} from './lib/sweep-journal.mjs';
import { VMIN_DIR, allowedOffset, allowedVoltageMv, append, assertSandbox, bestPassing, bestPassingMv, openStore, readAll, partitionByStamp, partitionByWriteShape, resolveAttempts, summarizePoint } from './lib/vmin-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** A verdict is a PASS only if it is exactly PASS. Written as a function because the negation is
 *  where the dangerous mistake lives: `!== CRASH` and `!== SDC` both silently admit UNKNOWN. */
export function isPass(verdict) {
  return verdict === config.VERDICT.PASS;
}

/**
 * REFUSE TO SEARCH WHEN THE WRITE DOES NOT UNDERVOLT THE CAP — the guard `bugs/02` was born from.
 *
 * The atom already computes this: `undervolt.savedMv` is the voltage serving `capMhz` BEFORE the
 * write minus the voltage serving it AFTER, both read from the card's own curve seconds apart. A
 * value of zero means the vector we applied cannot cheapen the clock we are testing, so every
 * conclusion the search would draw — a bracket, a Vmin, a margin — would be about a quantity that
 * never moved.
 *
 * **This is a STOP, not a warning, and the reason is a defect that actually happened.** The block
 * existed, it went RED on 2026-08-10 23:5x saying «экономия 0 мВ», and it was read as a curiosity
 * of a single-point write rather than as a verdict on the search — which then ran seven rungs and
 * reported an edge in millivolts the card had never been at. A guard that fires and is explained
 * away is a guard that did not fire; the cure is to remove the option of explaining it away.
 *
 * Silence is not a stop: a `runStepFn` that reports no `undervolt` block at all (every offline
 * fixture, and the atom in `--dry-run`) is left alone. The guard judges an OBSERVATION, never its
 * absence — the same rule the oracle itself obeys.
 *
 * [TESTED: 2026-08-11 00:2x · eight blocks — zero saving, negative saving, a real saving passing
 *  through, and the absence of the block passing through — mutation-proved with two mutations
 *  (drop the refusal · treat absence as zero), each reddening the block named for it in the header
 *  above BEFORE the run. AND FIRED FOR REAL on the live card against the very search that produced
 *  bugs/02: the run now stops on the first rung instead of reporting seven]
 */
export function refuseWithoutUndervolt(out, result, offsetMhz) {
  const saved = result?.undervolt?.savedMv;
  if (saved === null || saved === undefined) return false;
  if (saved > 0) return false;
  out.halted = true;
  out.noUndervoltAtCap = true;
  out.bracketMhz = null;
  out.stopped = `СТОП на +${offsetMhz} МГц: эта запись НЕ удешевляет потолок — напряжение, обслуживающее `
    + `${result?.undervolt?.capMhz ?? out.capMhz} МГц, осталось прежним (экономия ${saved} мВ). `
    + 'Искать край дальше значило бы измерять сдвиг, а докладывать о напряжении, которого карта не видела '
    + '(bugs/02). Ни вилки, ни милливольтов этот прогон не даёт.';
  return true;
}

/**
 * THE OWNER'S DESCENT LADDER, MAPPED ONTO THE CARD'S OWN NON-UNIFORM VOLTAGE GRID.
 * `plans/15` §4.1 · policy in `config.DESCENT_ZONES` · his words in `GOAL.md` → «📐 ЛЕСТНИЦА ШАГОВ
 * СПУСКА».
 *
 * The policy is stated in MILLIVOLTS (25 / 10 / 5 by depth from stock); the card accepts only voltages
 * that exist ON ITS GRID, and that grid is **not uniform** — 5 mV in 94 places and 10 mV in 32,
 * measured (`curves/voltage-grid.json`). So the policy is a CEILING ON STEP DEPTH that must be mapped
 * onto real rungs, and the mapping direction is the whole safety content of this function:
 *
 *   **the next rung is the DEEPEST grid point whose voltage is still ≥ (current − policyStep)** —
 *   i.e. rounding always lands on the SHALLOWER point. Undershooting his policy is obedience;
 *   overshooting it is not, and asking the card for a voltage it does not have is not an option.
 *
 * ONE CASE BREAKS THAT RULE, AND IT IS FORCED BY THE HARDWARE, SO IT IS NAMED RATHER THAN HIDDEN.
 * In the deep zone the policy asks for 5 mV, and where the grid's local gap is 10 mV there is NO point
 * within the step — the shallowest legal move is already twice the policy. The descent then takes the
 * next grid point and marks the rung `forcedByGrid`, because the alternative is standing still, which
 * abandons the search. Two things make this safe rather than a loophole: 10 mV is far inside the
 * `bugs/03` governor (first step ≤ 25, gap ≤ 35), and the rung SAYS SO — a run that overshot the
 * owner's policy reports the count instead of averaging it away.
 *
 * ⚠️ **THE IDEALIZED RUNG COUNTS IN `researches/09` §4.1 ARE NOT WHAT THIS FUNCTION RETURNS, and the
 * research is the side that is wrong.** That table computes
 * `min(d,100)/25 + clamp(d−100,0,50)/10 + max(0,d−150)/5` on a grid fine enough to express every step,
 * predicting 28 rungs at 2842 MHz and 49 at 3090. **Measured against the real grid: 24 and 42** — the
 * deep zone loses one rung to each 10 mV gap, because one grid step there covers what the formula
 * counted as two. `plans/15` §4.1 inherited «28» from the research and it is corrected there.
 * The direction of the error is worth stating: the sweep is CHEAPER than estimated, not dearer.
 * At 2400 MHz the two agree at **7** (the formula's 6.5, rounded up by a grid that lands exactly on the
 * lever wall) — which is why that number was the one that looked verified.
 *
 * ─── THE OPERATOR'S OWN CEILING ON DEPTH, AND WHY IT IS NOT THE SAME THING AS THE LEVER ───────────
 *
 * ─── AND A THIRD WALL, WHICH IS NEITHER: A VOLTAGE THAT HAS ALREADY HUNG THIS MACHINE (`bugs/23`) ──
 *
 * `hangFloorMv` is the highest voltage a recorded `ЗАВИС` names for this frequency
 * (`sweep-journal.hangFloors`). **No rung may ever land on it or below it again.** The owner made a
 * hang a NORMAL path of the search (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК») — what he accepted
 * is walking into an UNKNOWN edge, not choosing to walk back into a known one. Until this parameter
 * existed nothing stopped that: `blockedRungs` engages only after TWO CONSECUTIVE hangs on one rung,
 * so a resumed run rebuilt the identical ladder and ordered 845 mV at 2842 MHz a second time — the
 * very rung that bugchecked the machine on 2026-08-16.
 *
 * It is kept SEPARATE from the two walls above for the same reason they are kept separate from each
 * other: they carry different meanings and only one of them may be reported as a property of the
 * silicon. The lever wall is OUR reach, the depth cap is OUR decision — and this one is the CARD's
 * answer, paid for with a reboot. A run that blurred them would name the wrong thing as the edge.
 *
 * `depthCapMv` is a bound the OPERATOR sets for one sitting — «не спускаемся ниже 150 мВ от стока»
 * (the owner's condition for the first live sweep, 2026-08-16). It is not the lever wall and it is not
 * the silicon: it is a decision, and it is kept SEPARATE from `availableDepthMv` for one reason that
 * is the whole safety content of this parameter. Clamping the lever's reach silently would make every
 * downstream sentence lie — the descent would stop at 1035 mV and report «ПРЕДЕЛ РЫЧАГА», while the
 * lever on this card reaches 245 mV deeper. A run that misnames what stopped it is exactly the false
 * `[TESTED]` class this project hunts, so the binding constraint is RECORDED (`cappedByOperator`) and
 * SAID (`why`), and the two walls never blur into one number.
 *
 * @param {object}   a
 * @param {number[]} a.voltageGridMv     every voltage the card offers (any order; sorted here)
 * @param {number}   a.stockVoltageMv    the voltage serving this frequency at stock — depth is measured from it
 * @param {number}   a.availableDepthMv  how deep the ±1000 MHz lever can reach here; the wall, not a preference
 * @param {number}   [a.depthCapMv]      the operator's ceiling on depth from stock; `null` = no ceiling
 * @param {number}   [a.hangFloorMv]     a voltage that already hung this frequency; no rung reaches it
 * @param {Array}    [a.zones]           the policy; defaults to `config.DESCENT_ZONES`
 * @returns {{rungs:Array<{mv:number,depthMv:number,stepMv:number,zoneStepMv:number,forcedByGrid:boolean}>,
 *            refused:boolean, why:string, forcedByGridCount:number, floorMv:number,
 *            boundDepthMv:number, cappedByOperator:boolean, hangFloorMv:number|null,
 *            stoppedByHang:boolean}}
 *
 * [TESTED: 2026-08-15 21:4x, OFFLINE · 14 blocks in `engine --selftest`; the 2842 MHz and 2400 MHz
 *  rung counts are LITERALS measured on the card's real grid (24 and 7, not the idealized 28 — EXP-0072),
 *  mutation-proved with addressees 24–27. **NOT TESTED on a live card.**
 *  The hang floor (`bugs/23`) added 2026-08-17 with its own blocks and addressees 68–70.]
 */

/**
 * ONE STEP OF THE OWNER'S LADDER — «standing at `currentMv`, which grid rung is next?»
 * `GOAL.md` → «📐 ЛЕСТНИЦА ШАГОВ СПУСКА» · `bugs/42`.
 *
 * ─── WHY THIS IS A FUNCTION AND NOT TWO PLACES ───────────────────────────────────────────────────
 *
 * The decision existed TWICE in this module, and the second copy did not implement the policy at all.
 * `descentLadder` walked the zones (25 / 10 / 5 mV by depth from stock); the sweep's REBASE — the code
 * that re-aims a rung when the proven ground has drifted up — took `the deepest grid rung still inside
 * the bugs/03 wall`, i.e. it MAXIMIZED the step to 35 mV regardless of depth. On the owner's card,
 * 2026-08-23, that produced a 30 mV step at a depth of 110 mV, where his ladder says 10 — and he read
 * it off the screen himself: *«шаг пишет −110 мВ — какой-то бред! Такого шага не может быть!»*
 *
 * **The wall is a CEILING on the step, never the step itself.** Those are different quantities: the
 * wall (`bugs/03`) says how far we may leap into the dark, the zone says how far we INTEND to. Taking
 * the wall as the intent is how a governor turns into a target.
 *
 * So the two are collapsed into one function rather than kept in agreement — the outcome the pairs
 * registry prefers (`AGENT_GUIDE.md`: «a pair that can be REMOVED beats a pair that must be watched»).
 * `descentLadder` calls it with no ceiling; the rebase calls it with the wall as the ceiling.
 *
 * ─── THE GRID MAY REFUSE THE POLICY, AND THEN THE STEP GETS LONGER — SAID OUT LOUD ───────────────
 *
 * In 32 of this card's 126 intervals the neighbours differ by 10 mV, so a 5 mV zone step does not
 * exist there to take. The card's own nearest rung is taken instead and `forcedByGrid` says so — that
 * is the pre-existing behaviour of the ladder and it is unchanged. **What is new is that a forced step
 * is still bounded by the ceiling when one is given:** the rebase may not walk past the `bugs/03` wall
 * merely because the grid is coarse there; it reports «nowhere to go» instead, and the caller closes
 * the frequency with what is already proven.
 *
 * @param {object}   a
 * @param {number[]} a.gridDesc        the card's voltages, DESCENDING and deduplicated
 * @param {number}   a.currentMv       where the descent stands right now (stock, a rung, or proven ground)
 * @param {number}   a.stockVoltageMv  depth — and therefore the zone — is measured from this
 * @param {Array}    [a.zones]         the policy; defaults to `config.DESCENT_ZONES`
 * @param {number}   [a.maxStepMv]     a hard ceiling on the step (the `bugs/03` wall); `Infinity` = none
 * @returns {{mv:number, zoneStepMv:number, forcedByGrid:boolean}|null} `null` = nowhere legal to step
 *
 * [TESTED: 2026-08-23 20:1x, OFFLINE · `engine --selftest`; the refactor out of `descentLadder` is
 *  proved by a BYTE-EXACT golden over 1152 ladder configurations (empty diff), and the ceiling half by
 *  its own blocks with addressees DN–DP.]
 */
export function nextRungFrom({
  gridDesc = [],
  currentMv = null,
  stockVoltageMv = null,
  zones = config.DESCENT_ZONES,
  maxStepMv = Infinity,
} = {}) {
  if (!Array.isArray(gridDesc) || gridDesc.length === 0) return null;
  if (!Number.isFinite(currentMv) || !Number.isFinite(stockVoltageMv)) return null;
  if (!Array.isArray(zones) || zones.length === 0) return null;
  // The policy step for a given depth: the first zone whose boundary the depth has not yet reached.
  // The depth is that of where we STAND, which is how the ladder has always read it — the target's own
  // depth cannot be the key, because the target is what this function is computing.
  const zoneStepMv = (zones.find((z) => stockVoltageMv - currentMv < z.untilDepthMv) ?? zones[zones.length - 1]).stepMv;
  const allowedMv = Math.min(zoneStepMv, maxStepMv);
  const want = currentMv - allowedMv;
  // Candidates: strictly below where we stand, and no deeper than the policy allows.
  let next = null;
  for (const v of gridDesc) {
    if (v < currentMv && v >= want) { next = v; }   // grid is descending, so the last match is the deepest
    else if (v < want) break;
  }
  if (next !== null) return { mv: next, zoneStepMv, forcedByGrid: false };
  // The grid cannot express this step — the nearest point down is already deeper than the policy.
  next = gridDesc.find((v) => v < currentMv) ?? null;
  if (next === null) return null;                                  // the bottom of the card's grid
  if (currentMv - next > maxStepMv) return null;                   // …and the ceiling still binds
  return { mv: next, zoneStepMv, forcedByGrid: true };
}

export function descentLadder({
  voltageGridMv = [],
  stockVoltageMv = null,
  availableDepthMv = 0,
  depthCapMv = null,
  hangFloorMv = null,
  zones = config.DESCENT_ZONES,
} = {}) {
  const hangBound = Number.isFinite(hangFloorMv);
  const empty = (why) => ({
    rungs: [], refused: true, why, forcedByGridCount: 0, floorMv: null,
    boundDepthMv: null, cappedByOperator: false,
    hangFloorMv: hangBound ? hangFloorMv : null, stoppedByHang: false,
  });
  if (!Array.isArray(voltageGridMv) || voltageGridMv.length === 0) return empty('сетка напряжений пуста — спускаться не по чему');
  if (!Number.isFinite(stockVoltageMv)) return empty('стоковое напряжение не названо — глубина отсчитывается от него');
  if (!Array.isArray(zones) || zones.length === 0) return empty('политика шагов пуста');

  // THE TWO WALLS, RESOLVED HERE AND ONLY HERE. Whichever binds is the floor; WHICH one binds is a
  // fact the caller is owed, because the two carry opposite meanings — the lever wall is the card's,
  // the cap is ours, and only the first of them may ever be reported as a property of the silicon.
  const capped = Number.isFinite(depthCapMv) && depthCapMv > 0;
  const leverDepthMv = Number.isFinite(availableDepthMv) ? availableDepthMv : 0;
  const boundDepthMv = capped ? Math.min(leverDepthMv, depthCapMv) : leverDepthMv;
  const cappedByOperator = capped && depthCapMv < leverDepthMv;

  if (boundDepthMv <= 0) {
    return {
      rungs: [], refused: false, forcedByGridCount: 0, floorMv: stockVoltageMv,
      boundDepthMv, cappedByOperator, hangFloorMv: hangBound ? hangFloorMv : null, stoppedByHang: false,
      why: cappedByOperator
        ? `потолок глубины ${depthCapMv} мВ не оставляет ни одной ступени — спуск не начинается`
        : 'рычаг не даёт снять ни милливольта — спуск не начинается',
    };
  }

  // High → low, deduplicated: the grid is the card's dictionary and the descent reads it downward.
  const grid = [...new Set(voltageGridMv.filter(Number.isFinite))].sort((a, b) => b - a);
  const floorMv = stockVoltageMv - boundDepthMv;

  const rungs = [];
  let current = stockVoltageMv;
  let stoppedByHang = false;
  // The grid is finite and every iteration moves strictly downward, so this terminates; the bound is a
  // backstop against a malformed grid, not part of the algorithm.
  for (let guard = 0; guard <= grid.length; guard++) {
    const pick = nextRungFrom({ gridDesc: grid, currentMv: current, stockVoltageMv, zones });
    if (pick === null) break;                  // the bottom of the card's grid
    const { mv: next, zoneStepMv, forcedByGrid } = pick;
    // ─── THE THREE WALLS, IN THE ORDER THEY ARE ASKED, AND THE ORDER IS THE CONTENT ────────────────
    //
    // The rungs descend monotonically, so the SHALLOWEST wall always fires first and the order below
    // decides only the case where two land on the SAME rung. There the hang is named, because it is
    // the one fact among the three that belongs to the CARD: our lever and our depth cap are both
    // statements about us, and where they coincide with a measured hang the measurement is what a
    // future reader needs. Naming ours would hide the card's answer behind our preference.
    if (hangBound && next <= hangFloorMv) { stoppedByHang = true; break; }
    if (next < floorMv) break;                 // the lever wall — not a refusal, just where the rungs stop
    rungs.push({
      mv: next,
      depthMv: stockVoltageMv - next,
      stepMv: current - next,
      zoneStepMv,
      forcedByGrid,
    });
    current = next;
  }

  const forcedByGridCount = rungs.filter((r) => r.forcedByGrid).length;
  // WHAT STOPPED THE DESCENT, NAMED RATHER THAN LEFT TO BE INFERRED. The caller turns this into the
  // `lever-limited` verdict's prose, and «предел рычага» over a stop that was OUR decision would be a
  // claim about the card nobody measured.
  const stoppedBy = stoppedByHang
    ? `остановлено ЗАПИСАННЫМ ЗАВИСАНИЕМ: ${hangFloorMv} мВ уже вешало эту частоту, и на него спуск не возвращается (bugs/23)`
    : cappedByOperator
      ? `остановлено НАШИМ потолком глубины ${depthCapMv} мВ (рычаг достаёт до −${leverDepthMv} мВ, глубже мы не идём по условию прогона)`
      : `остановлено пределом рычага ±1000 МГц: глубже −${leverDepthMv} мВ он не достаёт`;
  if (rungs.length === 0) {
    return {
      rungs: [], refused: false, forcedByGridCount: 0, floorMv,
      boundDepthMv, cappedByOperator, hangFloorMv: hangBound ? hangFloorMv : null, stoppedByHang,
      why: stoppedByHang
        ? `спускаться некуда: первая же ступень сетки ниже ${stockVoltageMv} мВ упирается в ${stoppedBy}`
        : `спускаться некуда: ближайшая ступень сетки ниже ${stockVoltageMv} мВ уже глубже разрешённых `
          + `${boundDepthMv} мВ — ${stoppedBy}. Это не отказ, а свойство участка`,
    };
  }
  return {
    rungs, refused: false, forcedByGridCount, floorMv,
    boundDepthMv, cappedByOperator, hangFloorMv: hangBound ? hangFloorMv : null, stoppedByHang,
    why: `ступеней ${rungs.length}, первый шаг −${rungs[0].stepMv} мВ, глубже всего −${rungs[rungs.length - 1].depthMv} мВ`
      + (forcedByGridCount ? ` · сетка вынудила ${forcedByGridCount} шаг(ов) глубже политики (10 мВ там, где просили 5)` : '')
      + ` · ${stoppedBy}`,
  };
}

/**
 * WHICH TABLE ENTRY WOULD SERVE A CLOCK AFTER A UNIFORM RAISE — the same rule the card applies, run
 * on paper. `plans/15` §4.3.
 *
 * A point serves clock C iff its raised frequency reaches C; of those that do, the card uses the one
 * with the LOWEST voltage. That is exactly `vf-step.voltageForClock`'s rule, evaluated on the raised
 * curve instead of the stock one — same rule, one author, no second opinion about what "serving" means.
 *
 * [TESTED: 2026-08-15 23:0x, OFFLINE · exercised by `planRung`'s blocks and by mutation 36, which drops
 *  the re-assertion built on it and reddens two blocks. **NOT TESTED on a live card.**]
 */
export function servingAfterRaise(points, deltaMhz, clockMhz) {
  if (!Array.isArray(points) || !Number.isFinite(deltaMhz) || !Number.isFinite(clockMhz)) return null;
  const reaching = points
    .filter((p) => Number.isFinite(p?.mhz) && Number.isFinite(p?.mv) && p.mv > 0 && (p.mhz + deltaMhz) >= clockMhz)
    .sort((a, b) => a.mv - b.mv);
  return reaching.length ? reaching[0] : null;
}

/**
 * THE RUNG'S PLAN — the uniform raise that makes ONE chosen voltage serve the pinned clock.
 * `plans/15` §4.3.
 *
 * The arithmetic is one line, and it is why a PIN makes the whole range reachable where a curve cap
 * could not (a cap dies below `topMhz − 1000` = 2157 MHz on this card — fact 38):
 *
 *   to make the entry sitting at voltage V serve the pinned clock C:   Δ = C − F_V   (a UNIFORM raise)
 *
 * Every entry with a LOWER voltage has a lower stock frequency, so after the same Δ none of them
 * reaches C — **the chosen entry becomes the serving one by construction, with no ceiling needed to
 * arrange it.**
 *
 * ⚠️ **«BY CONSTRUCTION» IS AN ARGUMENT ABOUT A MONOTONE TABLE, AND THIS PROJECT HAS ALREADY PAID FOR
 * TREATING SUCH AN ARGUMENT AS A PROOF (R12, EXP-0057).** The factory curve is monotone in the working
 * band today; nothing guarantees it everywhere, and a table that is not monotone would hand the load to
 * a DIFFERENT voltage than the one being measured — silently, with every read-back agreeing. So the
 * conclusion is COMPUTED here rather than asserted: `servingAfterRaise` is run on the plan, and a
 * disagreement is a refusal that names both entries. The live path checks the same thing again after
 * the write, against the card's own re-read table (`plans/15` §4.3) — paper first, because a refusal
 * that costs nothing beats a refusal that costs a watchdog lease.
 *
 * WHAT THIS FUNCTION DOES NOT DECIDE: who holds the ceiling. That is `vf-step.chooseWriteShape`'s
 * single job (F2-AC9 — `кривая` / `закрепление частоты` / refuse), it is already built and
 * mutation-proved, and it takes the REAL vector from `buildRaiseAndCapVector`. A second implementation
 * here would be a truth↔mirror pair invented on purpose.
 *
 * @param {object}   a
 * @param {Array}    a.points      the card's V/F entries, `{i, mv, mhz}` as `nvapi.readVfCurve` returns
 * @param {number}   a.clockMhz    the frequency under test — the clock the run will PIN
 * @param {number}   a.voltageMv   the voltage whose ability to serve that clock is being measured
 * @param {number}   [a.offsetMinMhz] / [a.offsetMaxMhz]  the hardware's own ±1000 MHz lever
 * @returns {{ok:boolean, deltaMhz:number|null, entry:object|null, serving:object|null, why:string}}
 *
 * [TESTED: 2026-08-15 23:0x, OFFLINE · blocks in `engine --selftest` for the uniform raise, the lever
 *  wall as its own outcome, and the non-monotone refusal that names BOTH entries; mutations 34–35.
 *  **NOT TESTED on a live card.**]
 */
export function planRung({
  points = [],
  clockMhz = null,
  voltageMv = null,
  offsetMinMhz = config.CLOCK_OFFSET_MIN_MHZ ?? -1000,
  offsetMaxMhz = config.CLOCK_OFFSET_MAX_MHZ ?? 1000,
} = {}) {
  const no = (why) => ({ ok: false, deltaMhz: null, entry: null, serving: null, why });
  if (!Array.isArray(points) || points.length === 0) return no('таблица кривой пуста — ступень не спланировать');
  if (!Number.isFinite(clockMhz)) return no('частота ступени не названа');
  if (!Number.isFinite(voltageMv)) return no('напряжение ступени не названо');

  const entry = points.find((p) => p?.mv === voltageMv && Number.isFinite(p?.mhz));
  if (!entry) {
    return no(`напряжения ${voltageMv} мВ нет в таблице карты — такого напряжения у неё попросить нельзя`);
  }

  const deltaMhz = clockMhz - entry.mhz;
  if (deltaMhz < offsetMinMhz || deltaMhz > offsetMaxMhz) {
    // NOT a silicon edge — our lever ran out. The distinction is the whole reason `lever-limited`
    // exists as a verdict (`plans/13` E2-AC2), and it must never be reported as an edge.
    return {
      ok: false, deltaMhz, entry, serving: null,
      leverLimited: true,
      why: `ПРЕДЕЛ РЫЧАГА, а не край: чтобы ${voltageMv} мВ обслуживало ${clockMhz} МГц, нужен равномерный `
        + `сдвиг ${deltaMhz} МГц, а железо принимает только ${offsetMinMhz}…${offsetMaxMhz}. `
        + 'Спуск здесь останавливает НАШ рычаг, и называть это краем значило бы выдать ложный вердикт',
    };
  }

  const serving = servingAfterRaise(points, deltaMhz, clockMhz);
  if (!serving) {
    return no(`при сдвиге ${deltaMhz} МГц частоту ${clockMhz} МГц не обслуживает НИ ОДНА запись таблицы`);
  }
  if (serving.mv !== voltageMv) {
    return {
      ok: false, deltaMhz, entry, serving,
      why: `СТУПЕНЬ НЕ ИЗМЕРЯЛА БЫ ТО, ЧТО ЗАКАЗАНО: при сдвиге ${deltaMhz} МГц частоту ${clockMhz} МГц `
        + `обслуживало бы ${serving.mv} мВ (запись ${serving.i}), а мерить заказано ${voltageMv} мВ `
        + `(запись ${entry.i}). Такое возможно на НЕМОНОТОННОЙ таблице, и вердикт был бы о чужом напряжении`,
    };
  }

  return {
    ok: true, deltaMhz, entry, serving,
    why: `равномерный сдвиг ${deltaMhz >= 0 ? '+' : ''}${deltaMhz} МГц делает ${voltageMv} мВ обслуживающим `
      + `${clockMhz} МГц (запись ${entry.i}, сток ${entry.mhz} МГц)`,
  };
}

/**
 * THE SHORT PROBE — the ONE load shape a descent rung is judged by, and the owner's ten seconds.
 * `plans/15` §4.3 · `ideas/03` step 9 (*«Прожиг длится 10 секунд»*).
 *
 * Why one shape and not the set: the set is what makes a NUMBER trustworthy (fact 37 — a point's
 * verdict is the WORST over three shapes), and the ladder does not produce numbers. It produces the
 * neighbourhood of the edge, cheaply, so that §4.6 can re-find the failure at 5 mV and the set can
 * judge THAT. Spending three burns on every one of 24 rungs would triple the sweep to buy confidence
 * about rungs the sweep is going to walk past anyway.
 *
 * Why THIS shape: voltage noise — IR drop and di/dt droop — dominates Vmin variability, and it lives
 * in the TRANSITIONS rather than in a steady 100 % (`researches/02` §2). A sustained burn is the
 * cheapest way to walk past an unsafe rung without noticing it.
 *
 * It is TAKEN FROM `DIVERSE_SET` rather than re-declared, so the probe and the set cannot describe
 * the same shape two different ways; a selftest block asserts the id resolves.
 */
export const SHORT_PROBE = Object.freeze([
  DIVERSE_SET.find((s) => s.id === 'sdc_fma/transient'),
].filter(Boolean));

/**
 * ONE RUNG, LIVE — the orchestration `plans/15` §4.3 asks for, and it is a COMPOSER rather than a
 * second writer.
 *
 * The paper half (`planRung` above) turned «measure voltage V at frequency C» into a uniform raise Δ
 * and PROVED, on the card's own table, that V is the entry that would serve C afterwards. This is what
 * happens next, and every load-bearing part of it already exists and is already mutation-proved:
 *
 *   `chooseWriteShape`  decides WHO holds the ceiling — the curve or the clock pin — and refuses when
 *                       neither can (F2-AC9). It carries the live lesson «ONE HOLDER, NEVER TWO»:
 *                       on 2026-08-14 a capped curve and a pin fought over one frequency and three
 *                       PASSing load shapes came back НЕИЗВЕСТНО. **This function OBEYS its answer
 *                       instead of forming a second opinion** — a second copy of that rule would be a
 *                       truth↔mirror pair created on purpose.
 *   `vf-step.runStep`   arms the watchdog BEFORE the write, writes through `profile-manager`/`nvapi`
 *                       (R1 — this module never writes), reads back POINT BY POINT, pins the clock,
 *                       samples telemetry from a separate process, judges with the oracle, and undoes
 *                       as a LIST (`runUndo`, R10a). It is injected as `runStepFn`, which is what
 *                       keeps this whole decision testable with zero GPU writes (F2-AC10).
 *
 * WHAT THIS FUNCTION ADDS THAT NOTHING ELSE DOES — the re-assertion. The paper proof says V will be
 * the serving entry; that is a statement about the table we READ. After the write, the card's own
 * re-read table is the only authority on what the load actually exercised, and `runStep` already
 * computes it (`undervolt.after` = `voltageForClock` on the curve read back). **If that voltage is
 * not the ordered one, the rung measured somebody else's voltage and its verdict is VOID — not a
 * PASS, not an edge, not a data point.** Silently keeping such a verdict is exactly the class R12 and
 * EXP-0057 are about: a property that was a proof under the old shape, inherited instead of measured.
 *
 * AND ONE MORE THING IT REFUSES TO OVERLOOK: a rung whose ROLLBACK failed is never reported as
 * passed, whatever the oracle said. The next rung would then start on a card nobody can describe,
 * which is the state `watchdog --recover` exists to forbid ever being built on. `runUndo` marks its
 * blocks `undo: true`, so this is a field test rather than a match on block names.
 *
 * THE FIVE OUTCOMES, and none of them may masquerade as another (F2-AC7):
 *
 *   `passed`        the oracle said PASS and the card confirms the ordered voltage was the one loaded
 *   `failed`        SDC or CRASH — **a SIGNAL that the edge is near, NEVER the edge itself.** On a
 *                   coarse rung §4.6 must re-find it at 5 mV before any margin is applied; that is the
 *                   owner's rule, stated three times (`plans/15` §4.6)
 *   `lever-limited` our ±1000 MHz lever ran out before the silicon did. Not an edge, and the card is
 *                   never touched — the refusal is arithmetic
 *   `refused`       the rung cannot be run honestly (non-monotone table, no ceiling holder, nothing to
 *                   write). The card is never touched
 *   `unknown`       the oracle could not judge, or the rollback was not clean. **A STOP, never
 *                   progress** — the rule the ascent already obeys (EXP-0011)
 *   `void`          the rung ran, but on a different voltage than ordered. A STOP, and a loud one
 *
 * @param {object}   a
 * @param {Array}    a.points        the card's V/F table, freshly read (`nvapi.readVfCurve().points`)
 * @param {number}   a.clockMhz      the frequency under test
 * @param {number}   a.voltageMv     the voltage whose ability to serve it is being measured
 * @param {function} a.runStepFn     the atom. REQUIRED — this module does not write to the card
 * @param {function} [a.buildVector] `nvapi.buildRaiseAndCapVector`; injected offline, imported live
 * @param {function} [a.chooseShape] `vf-step.chooseWriteShape`; injectable for the same reason
 * @returns {Promise<object>} the rung record the journal (§4.4) and the sweep (§4.5) both read
 *
 * [TESTED: 2026-08-15 23:0x, OFFLINE HALF ONLY · 22 blocks in `engine --selftest` against an injected
 *  atom and an injected vector builder, six mutations (addressees 34–39, named before the run) each
 *  reddening its own named block while the intact code reddened none. **NOT TESTED: no rung has ever
 *  run on the card.** Everything downstream of `runStepFn` — the watchdog lease, the write, the pin,
 *  the sampler, the rollback — is proved only to the extent phase 5 proved it; what these blocks
 *  prove is the DECISION, which is this module's whole job.]
 */
export async function runRung({
  points = [],
  clockMhz = null,
  voltageMv = null,
  seconds = config.SWEEP_PROBE_SECONDS ?? 10,
  sustain = config.SWEEP_PROBE_SECONDS ?? 10,
  shapes = SHORT_PROBE,
  // ЛЕСТНИЦА НАБОРОВ, СИЛЬНЕЙШИЙ ПЕРВЫМ. Необязательна: не передали — прежнее поведение, одна
  // попытка тем набором, что в `shapes`. Передали — ступень переигрывается со всё более слабым
  // прожигом, пока карта не сядет на настраиваемую частоту (см. шаг 5 ниже).
  shapeLadder = null,
  // Тот же объектный вид, что у развёртки: `onEvent({kind, frequencyMhz, text, ...})`. Нужен, чтобы
  // ослабление нагрузки было ВИДНО оператору в окне, а не только в записи после прогона.
  onEvent = null,
  pinCard = null,
  // Carried into the journal, not used by the decision: after a hang these three are what a post-mortem
  // has to reconstruct the descent from — how deep this rung sat, which policy zone produced it, and
  // whether the descent had been seeded at this frequency (§4.2).
  depthMv = null,
  zoneStepMv = null,
  seeded = false,
  // ДОКАЗАННАЯ ЗЕМЛЯ И СТЕНА ОТ НЕЁ — `interviews/009`, слово владельца 2026-08-16:
  // *«Ты знаешь сетку напряжений видеокарты? Если знаешь, то ты знаешь, какого размера ты шаг можешь
  // сделать. В чём проблема?»*
  //
  // `provenMv` — самое глубокое напряжение, на котором эта частота УЖЕ ПРОШЛА (сток или затравка на
  // первой ступени, прошлый PASS дальше). `maxStepFromProvenMv` — та же стена `bugs/03`, которую план
  // применяет к заказанному шагу (`plan.cliffMv`). Судится ими ВЫДАННОЕ напряжение, а не заказанное:
  // заказ это намерение, он ничего не доказывает, и совпадает с приземлением ровно тогда, когда
  // сторож и не нужен. Оба необязательны — вызывающий, который их не передал, получает прежнее
  // поведение без проверки глубины (её тогда делает только «выше стока»).
  provenMv = null,
  maxStepFromProvenMv = null,
  // WHETHER A CLOCK PIN IS AVAILABLE AT ALL — and this parameter exists because without it F2-AC9's
  // refusal branch is UNREACHABLE. `chooseWriteShape` refuses only when the curve cannot hold the
  // ceiling AND nothing is pinned; a caller that hard-codes «pinned: true» can never see that answer,
  // so the criterion «refuses if neither can» would be satisfied by a branch no run can enter — a
  // guard that has never gone red proves nothing (`BUG_FIXING_FRAMEWORK.md` → Guards). The sweep sets
  // it from the card's own clock ladder: no ladder, no pin, and a rung below the curve's cap floor
  // then has no holder and is refused BEFORE any write instead of discovered mid-burn.
  canPin = true,
  // THE CLOCK LOCK — available, and NOT the default. `researches/11`, measured on the owner's card
  // the same day this option was written:
  //
  //   `-lgc 3082,3082` → the card delivered 2887 and never moved. `-lgc 2700,2700` → 2692, likewise.
  //
  // **A clock lock is a CEILING, not a command: it holds a card down and cannot lift it up.** So it
  // cannot deliver `ideas/03` step 7 («ВИДЕОКАРТА БЛОКИРУЕТСЯ РАБОТАТЬ ИМЕННО НА ЭТОЙ ЧАСТОТЕ») at
  // any frequency above where the boost arbitration already lands, and defaulting it ON made every
  // sweep stop on its first rung — which is exactly what the first live run did.
  //
  // What DOES bound the card at a frequency is a FLATTENED CURVE — every point that would offer more
  // pushed down onto the tested clock. `buildRaiseAndCapVector` has always built that shape, and it
  // is what `demandPin: false` selects. The lock stays reachable because below the curve's cap floor
  // (2157 MHz) it is the only holder there is.
  demandPin = false,
  // THE CARD'S OWN MAXIMUM GRAPHICS CLOCK — `frequency-grid.maxGraphicsMhz`, the SAME number R13
  // reads. It is the ceiling the locked shape writes, and it is required whenever `demandPin` is on:
  // a uniform raise with no ceiling at all pushes the curve's tail (3172 MHz here) above the card's
  // maximum (3090), which is the gap `bugs/11` escaped through and cost the owner a BSOD. Refused
  // rather than guessed — an envelope invented from the V/F table would read 3172 and prove nothing.
  envelopeMhz = null,
  // THE WRITE-AHEAD JOURNAL (§4.4), and it is wired HERE rather than in the sweep loop for one
  // reason: the intent must be durable in the instruction before the card is touched, and this is the
  // function that touches it. Anywhere else leaves a gap, and the gap is exactly where a hang lands.
  // `null` keeps the rung journal-less, which is what every offline fixture wants.
  journal = null,
  seq = null,
  // Rungs already closed as «two hangs in a row» (F2-AC5). Computed ONCE by the caller from
  // `sweep-journal.resumeState`, because within a single process a rung can hang at most once — the
  // hang ends the process — so re-reading the journal per rung would buy nothing.
  blockedKeys = null,
  now = null,
  runStepFn,
  buildVector = null,
  chooseShape = chooseWriteShape,
  offsetMinMhz = config.CLOCK_OFFSET_MIN_MHZ ?? -1000,
  offsetMaxMhz = config.CLOCK_OFFSET_MAX_MHZ ?? 1000,
} = {}) {
  if (typeof runStepFn !== 'function') {
    throw new Error('runRung требует runStepFn — движок сам в карту не пишет (правило R1)');
  }

  const record = {
    frequencyMhz: clockMhz,
    voltageMv,
    deltaMhz: null,
    pointIndex: null,
    outcome: null,
    verdict: null,
    writeShape: null,
    holder: null,
    decidedBy: null,
    servingMvAfter: null,
    deliveredMhz: null,
    deliveredMaxMhz: null,
    undoClean: null,
    cardTouched: false,
    why: '',
    atom: null,
  };
  const stop = (outcome, why) => ({ ...record, outcome, why });

  // ---- 1. THE PAPER PLAN, ON THE LIVE TABLE. A refusal here costs the card nothing at all — no
  // watchdog lease, no write, no reboot. That is the whole reason it runs first.
  const plan = planRung({ points, clockMhz, voltageMv, offsetMinMhz, offsetMaxMhz });
  record.deltaMhz = plan.deltaMhz;
  record.pointIndex = plan.entry?.i ?? null;
  if (plan.leverLimited) return stop('lever-limited', plan.why);
  if (!plan.ok) return stop('refused', plan.why);

  // A rung of the descent is by construction a voltage BELOW the one serving this clock at stock, so
  // its own stock frequency is below the clock and Δ is strictly positive. Δ ≤ 0 therefore means the
  // caller handed over a voltage that ALREADY serves this clock — there is nothing to write and
  // nothing to measure. Named here rather than left to the atom, whose `RangeError` on a
  // non-positive offset would leave the sweep with an exception instead of an outcome.
  if (!(plan.deltaMhz > 0)) {
    return stop('refused', `${voltageMv} мВ обслуживает ${clockMhz} МГц уже на стоке (сдвиг ${plan.deltaMhz} МГц) — `
      + 'писать нечего и мерить нечего: это не ступень спуска');
  }

  // ---- 2. WHO HOLDS THE CEILING. The vector is the REAL one the write would carry, so the decision
  // is taken on what the card would actually get rather than on an idea of it.
  const build = buildVector ?? (await import('./lib/nvapi.mjs')).buildRaiseAndCapVector;

  // ─── WHERE THE CEILING GOES, AND IT IS A DIFFERENT PLACE IN THE TWO SHAPES ──────────────────────
  //
  // Shipped shape: the ceiling IS the clock under test — that is what makes the search measure the
  // thing the profile ships (`bugs/02` step 1).
  //
  // The owner's locked shape (`ideas/03` step 7): the ceiling is the CARD'S ENVELOPE and the clock
  // under test is held by the LOCK. Two ceilings on one frequency is what fought on 2026-08-14, and
  // NO ceiling at all is what R13 refuses (`bugs/11`). Putting the ceiling on the envelope satisfies
  // both: nothing raised offers above the card's maximum, and the lock is the only thing binding the
  // frequency. This costs no measured number — the point serving any clock BELOW the cap, and its
  // voltage, are identical under a uniform raise and a capped one (9 of 9 on this card, fact 38).
  const capForVector = demandPin ? envelopeMhz : clockMhz;
  if (demandPin && !Number.isFinite(capForVector)) {
    return stop('refused', 'АЛГОРИТМ ВЛАДЕЛЬЦА (шаг 7) требует закрепления, а максимум частоты этого экземпляра '
      + 'не назван (frequency-grid.maxGraphicsMhz). Без него подъём кривой вынес бы её хвост за конверт карты — '
      + 'ровно та форма, что уронила машину 2026-08-15 (bugs/11, сторож R13). Конверт не выдумывается');
  }
  if (demandPin && clockMhz >= capForVector) {
    return stop('refused', `${clockMhz} МГц — это САМ конверт карты (${capForVector} МГц): потолок и закрепление `
      + 'встали бы на одну частоту, а это ровно конфликт 2026-08-14 (карта под потолком садится ниже него, '
      + 'а замок требует ровно его). Полосу начинают на ступень ниже максимума');
  }
  const vector = build(points, plan.deltaMhz, { capMhz: capForVector });
  if (!vector || vector.ok !== true) {
    return stop('refused', `вектор записи не построен: ${vector?.why ?? 'нет ответа строителя'}`);
  }
  // `pinned` is the CAPABILITY, not the preference — «a pin is available here», which is the question
  // `chooseWriteShape` answers with «then who should hold the ceiling». Its answer is obeyed in both
  // directions, including «the curve holds it, and pinning here would be harmful».
  const held = chooseShape(vector, { pinned: canPin, demandPin });
  record.holder = held.heldBy;
  record.writeShape = held.shape;
  if (!held.ok) return stop('refused', held.why);

  // ONE HOLDER, NEVER TWO. When the curve carries the ceiling itself, the pin is not merely redundant
  // — it fought the cap for one frequency on 2026-08-14 and turned three PASSing shapes into
  // НЕИЗВЕСТНО. `pinRequired` is the field that decides it, and it belongs to `chooseWriteShape`.
  const pinMhz = held.pinRequired ? clockMhz : null;

  // AND THE SAME RULE READ FROM THE OTHER END, which is the half that lives here: the ceiling handed
  // to the atom is the one the vector was built with. Under the lock that is the ENVELOPE, never the
  // clock under test — the clock under test travels as `pinMhz`, and the two must not name the same
  // frequency (that is the 2026-08-14 conflict, refused above).
  const capForAtom = capForVector;

  // ---- 3. THE ONE EMERGENCY STOP THE OWNER LEFT (F2-AC5). Two hangs in a row on this rung is a
  // fault, not an edge, and a third attempt buys nothing but another reboot.
  const key = `${clockMhz}/${voltageMv}`;
  if (blockedKeys && blockedKeys.has(key)) {
    // The FIELD, not the wording, is what the sweep tests (§4.5): a caller matching this message as a
    // substring would be a truth↔mirror pair created on purpose, and it would go silent the first time
    // the sentence is reworded. Same rule the dirty-rollback check already obeys (`undo: true`).
    return { ...stop('refused', `СТУПЕНЬ ЗАБЛОКИРОВАНА ЖУРНАЛОМ: ${clockMhz} МГц / ${voltageMv} мВ повесила машину `
      + 'ДВА РАЗА ПОДРЯД. Это не край, а поломка — край даёт вердикт оракула, поломка повторяется. Третий раз не начинаем'),
    blocked: true };
  }

  // ---- 4. THE INTENT, DURABLE BEFORE THE FIRST BYTE REACHES THE CARD.
  //
  // A rung that hangs the machine kills the process with it, so nothing survives to write a verdict:
  // the only record that CAN exist is this one, written and fsynced in advance. That is what turns the
  // owner's accepted risk into a measurement instead of a lost evening (`GOAL.md` → «⚠️ ЗАВИСАНИЕ —
  // ОСОЗНАННЫЙ РИСК»). Nothing above this line touched the card, so nothing above it is journalled —
  // an intent for a rung that was refused on paper would be a rung nobody ran.
  const stamp = now ? now() : localIso();
  if (journal) {
    writeIntent(journal, {
      seq, at: stamp,
      frequencyMhz: clockMhz, voltageMv, pointIndex: plan.entry.i,
      deltaMhz: plan.deltaMhz, depthMv, zoneStepMv, seeded,
      holder: held.heldBy, writeShape: held.shape,
    });
  }

  // ---- 5. THE ATOM, RE-RUN UNTIL THE BURN ACTUALLY HAPPENS AT THE TUNED FREQUENCY.
  //
  // Слово владельца 2026-08-22: *«инструмент должен видеть, прожигает ли он именно ту частоту,
  // которую тюнит. Если видит, что не ту частоту прожигает — он должен менять настройки и тип
  // нагрузки и ещё раз прожигать, пока не убедится, что именно нужная частота была прожжена для
  // данного шага, тогда можно шагать дальше по напряжению или частотам»*.
  //
  // ПОЧЕМУ ЭТО ЦИКЛ, А НЕ ОДНА ПОПРАВКА: прожиг, дошедший до предела мощности, ЗАЖИМАЕТ ЧАСТОТУ —
  // замерено 2026-08-22, верхняя ступень шла на 2820 МГц, когда настраивались 2887. Насколько
  // именно надо ослабить нагрузку, заранее не знает никто: это зависит от частоты, напряжения и
  // нагрева, то есть от состояния карты в эту секунду. Поэтому лестница проходится СВЕРХУ ВНИЗ и
  // останавливается на первой ступени, которая частоту удержала, — самый сильный прожиг из тех,
  // что честны о своей частоте.
  //
  // КАЖДАЯ ПОПЫТКА — ПОЛНЫЙ АТОМ: своя запись, свой сторож, свой откат. Дороже, чем подкрутить
  // нагрузку на лету, и это осознанно: половинчатая попытка оставила бы карту в состоянии, которое
  // никто не откатывал.
  //
  // ЛЕСТНИЦА ОГРАНИЧЕНА СПИСКОМ, а не поиском: каждая лишняя попытка — это лишний прожиг на карте
  // владельца. Кончились ступени — это НАХОДКА («на этой частоте прожиг не держится ни на одной
  // интенсивности»), а не повод записать вердикт о другой частоте.
  record.cardTouched = true;
  const ladder = (Array.isArray(shapeLadder) && shapeLadder.length) ? shapeLadder : [shapes];
  let atom = null;
  const attempts = [];
  for (let li = 0; li < ladder.length; li++) {
    atom = await runStepFn({
      point: plan.entry.i,
      offsetMhz: plan.deltaMhz,
      writeShape: held.shape,
      capMhz: capForAtom,
      pinMhz,
      pinCard,
      shapes: ladder[li],
      seconds,
      sustain,
    });
    attempts.push({
      level: li,
      deliveredMhz: atom?.deliveredMhz ?? null,
      shortfallMhz: atom?.deliveredShortfallMhz ?? null,
      heldTheFrequency: !atom?.clockShortfall,
    });
    if (!atom?.clockShortfall) break;
    if (onEvent && li + 1 < ladder.length) {
      onEvent({
        kind: 'load-eased',
        frequencyMhz: clockMhz,
        text: `прожиг шёл на ${atom.deliveredMhz} МГц вместо ${clockMhz} — ослабляю нагрузку `
          + `(ступень ${li + 1} из ${ladder.length - 1}) и жгу заново`,
        deliveredMhz: atom.deliveredMhz,
        level: li + 1,
      });
    }
  }
  record.loadAttempts = attempts;
  record.loadLevelUsed = attempts.length ? attempts[attempts.length - 1].level : null;
  record.burnedAtTunedFrequency = attempts.length ? attempts[attempts.length - 1].heldTheFrequency : null;
  record.atom = atom ?? null;
  record.verdict = atom?.verdict ?? null;
  record.decidedBy = atom?.worstShape ?? null;
  record.deliveredMhz = atom?.deliveredMhz ?? null;
  record.deliveredMaxMhz = atom?.deliveredMaxMhz ?? null;
  record.servingMvAfter = atom?.undervolt?.after?.mv ?? null;

  // FROM HERE ON, EVERY EXIT CLOSES THE JOURNAL LINE — an intent left open by a rung that finished is
  // a rung the next launch would blame for a hang that never happened. Twice in a row it would even
  // BLOCK that rung. So the closure runs through one function rather than being repeated at six
  // returns, which is the only way it cannot be forgotten at the seventh.
  const close = (result) => {
    if (journal) {
      writeVerdict(journal, {
        seq, at: now ? now() : localIso(),
        outcome: result.outcome, verdict: result.verdict,
        decidedBy: result.decidedBy, servingMvAfter: result.servingMvAfter,
        why: result.why,
      });
    }
    return result;
  };

  // ---- 6. DID THE CARD COME BACK? Asked before anything else, because every later question is about
  // a card whose state we can describe.
  const dirty = (atom?.blocks ?? []).filter((b) => b && b.undo === true && b.ok === false);
  record.undoClean = dirty.length === 0;
  if (dirty.length) {
    // ИМЯ **И** ПРИЧИНА (`plans/28`). Имя отвечает на «что делалось», причина — на «что оказалось»,
    // и оператору нужны обе: по одному имени он не знает, что случилось, по одной причине — где.
    // До этой правки ехало только имя, и настоящий текст отказа умирал в `detail`.
    return close(stop('unknown', `ОТКАТ НЕ ЧИСТ на ${clockMhz} МГц / ${voltageMv} мВ — ${dirty.length} шаг(ов) не отработали: `
      + `${dirty.map((b) => (b.detail ? `${b.name} — ${b.detail}` : b.name)).join(' · ')}. `
      + 'Следующая ступень стартовала бы на карте, состояние которой '
      + 'никто не может назвать, и это СТОП, а не вердикт о напряжении'));
  }

  // ---- 6a. ПРОВЕРКА НЕ ДАЛА ОТВЕТА — ТОЖЕ СТОП, НО ЭТО ДРУГОЕ УТВЕРЖДЕНИЕ (`plans/28`, находка A).
  //
  // Здесь стоит ровно один блок — доказательство потолка, — и он ЧИТАЕТ, а не откатывает. До
  // 2026-08-23 он ехал в общем списке с `undo: true`, и его отказ печатался владельцу как «ОТКАТ НЕ
  // ЧИСТ … состояние карты назвать нельзя» на прогоне, где карта была ЧИСТА (кривая заводская,
  // сторож не взведён, сирот в журнале нет — проверено наблюдением).
  //
  // Два утверждения разведены, потому что требуют разного от читателя:
  //   «карта не вернулась»       — тревога о МАШИНЕ, дальше нельзя ничего;
  //   «проверка не дала ответа»  — повод остановиться, но о карте это НЕ говорит ничего плохого.
  //
  // Остановка при этом сохранена и не ослаблена: пробитый потолок означает, что отгружаемая форма
  // записи перестала держать карту, и следующая ступень пошла бы на непокрытой карте — ровно класс
  // `bugs/11` (поднятие без потолка за пределами доказанного конверта → BSOD). Замерено живьём:
  // на 2790 МГц / 845 мВ карта ушла на 2805 при потолке 2790.
  const failedProofs = (atom?.blocks ?? []).filter((b) => b && b.proof === true && b.ok === false);
  record.proofsClean = failedProofs.length === 0;
  if (failedProofs.length) {
    // ПРИЧИНА ВПЕРЕДИ, ИМЯ ПОЗАДИ И В КАВЫЧКАХ — порядок здесь и есть лечение находки A. Имена этих
    // блоков УТВЕРДИТЕЛЬНЫ («ПОТОЛОК … УСТОЯЛ»), и в начале фразы такое имя читается как вывод. За
    // причиной, в кавычках, оно читается как то, чем и является: названием проверки.
    return close(stop('unknown', `ПРОВЕРКА НЕ ДАЛА ОТВЕТА на ${clockMhz} МГц / ${voltageMv} мВ: `
      + `${failedProofs.map((b) => `${b.why || b.detail} (проверка «${b.name}»)`).join(' · ')}. `
      + 'ОТКАТ ПРИ ЭТОМ ОТРАБОТАЛ — карта вернулась, состояние её известно. Остановка в том, что о '
      + 'НАПРЯЖЕНИИ вердикта нет: судить ступень не по чему'));
  }

  // ---- 7. THE ORACLE COULD NOT JUDGE — a STOP, never progress (EXP-0011).
  if (record.verdict === null) {
    const failed = (atom?.blocks ?? []).filter((b) => b && b.ok === false).map((b) => b.name);
    return close(stop('unknown', `НЕИЗВЕСТНО на ${clockMhz} МГц / ${voltageMv} мВ — оракул не вынес вердикта`
      + (atom?.reason ? `: ${atom.reason}` : '')
      + (failed.length ? ` · красные блоки: ${failed.join(' · ')}` : '')
      + '. Это СТОП: уточнять край вокруг ненаблюдённой границы значило бы выдумать измерение'));
  }

  // ---- 8. THE RE-ASSERTION, AGAINST THE CARD'S OWN RE-READ TABLE.
  //
  // The plan proved this voltage WOULD serve the clock; only the card can say it DID. A mismatch is
  // not a failure of the silicon — it is the instrument having measured something nobody ordered, and
  // a verdict about an unordered voltage is worse than no verdict at all.
  if (record.servingMvAfter === null) {
    // THE EVIDENCE TRAVELS WITH THE REFUSAL (`bugs/22`). The atom MEASURED the ceiling the card
    // actually stands at (`highestOfferedMhz`) and this message used to drop it, so the halt said
    // what was missing and not what was there — and nothing else persists the atom's blocks, so the
    // next session had to re-derive the whole diagnosis. A guard that cannot say WHY costs one
    // investigation every time it fires.
    const offered = record.atom?.undervolt?.offeredAfterMhz ?? record.atom?.highestOfferedMhz ?? null;
    const asked = record.atom?.undervolt?.askedAtMhz ?? null;
    return close(stop('void', `ступень ${clockMhz} МГц / ${voltageMv} мВ прошла с вердиктом ${record.verdict}, но карта НЕ сказала, `
      + 'какое напряжение обслуживало частоту после записи — отсутствие наблюдения не является наблюдением совпадения'
      + (offered === null ? ' · верх кривой после записи не измерен вовсе' : ` · кривая после записи предлагает не выше ${offered} МГц`)
      + (asked === null ? '' : `, спрашивали о ${asked} МГц`)));
  }
  // ⚠️ WE TUNE WHAT THE CARD DELIVERS — NOW ON THE VOLTAGE AXIS TOO. The owner, 2026-08-16:
  // *«мы должны попасть в ближайшее верхнее напряжение»* · *«ближайшее верхнее из тех, которые
  // карточка предоставляет»* — extending his own frequency rule (`GOAL.md` → «🎚 ТЮНИМ ТО, ЧТО КАРТА
  // ВЫДАЁТ») one axis over, and matching what the shipped value already does («напряжением с сетки
  // карты, ближайшим сверху к найденному минимуму»).
  //
  // WHY THE TWO NUMBERS DISAGREE AT ALL, because it is not a step-size quirk: the plan resolves the
  // serving entry on the table read BEFORE the burn, and this check re-reads it AFTER. The factory
  // table slides along the FREQUENCY axis with temperature (≈ −1.7 MHz/°C, R14b), so a card that
  // warmed up during its own burn hands the clock to the next entry UP. Measured live 2026-08-16:
  // ordered 1045 mV for 2887 MHz, the warmed card served it at 1050.
  //
  // ABOVE is the safe direction and it is the ANSWER: the burn happened at the delivered voltage,
  // the verdict is true about THAT voltage, and recording it is both honest and conservative.
  // BELOW is a different thing entirely — the card ran a DEEPER undervolt than anyone ordered, past
  // the depth the step governors were sized for — and it stays a stop.
  // ГДЕ ПРОХОДИТ ГРАНИЦА ДОПУСТИМОЙ ВЫДАЧИ — и почему она НЕ в ступенях сетки.
  //
  // Первая редакция этой проверки требовала ровно ОДНУ ступень сетки вверх, и живой прогон её
  // опроверг: ступень, посчитанная по СВЕЖЕПЕРЕЧИТАННОЙ таблице, всё равно промахнулась на две
  // (2835 МГц, заказано 965, обслуживало 975). Улика в том же логе: таблица уехала МЕЖДУ планом и
  // перечитыванием, то есть ВНУТРИ прожига — десять секунд нагрузки греют карту на несколько
  // градусов, а таблица едет по оси частот с температурой. **Опора движется в момент пользования
  // ею, и планированием из этого не выйти.** Считать ступени — значит подбирать допуск под сегодняшний
  // нагрев: завтра понадобится три, послезавтра четыре.
  //
  // ОСМЫСЛЕННАЯ ГРАНИЦА ДРУГАЯ, И ОНА ОДНА: результат андервольта обязан быть НИЖЕ СТОКА этой
  // частоты. Выдача на уровне стока или выше означает, что запись не добилась ничего — вот это
  // настоящий дефект, и его стоит ловить. Всё, что между заказом и стоком, — честный замер: прожиг
  // шёл при этом напряжении, вердикт истинен о нём, а направление консервативное (карта получила
  // БОЛЬШЕ напряжения, чем просили).
  const measuredMv = record.servingMvAfter;
  record.measuredMv = measuredMv;
  record.orderedMv = voltageMv;
  // СТОК БЕРЁТСЯ ИЗ САМОЙ ТАБЛИЦЫ, А НЕ ИЗ АРГУМЕНТА ВЫЗЫВАЮЩЕГО. Первая редакция считала его как
  // `voltageMv + depthMv` — и набор тут же показал дыру: вызов без `depthMv` молча ОТКЛЮЧАЛ проверку,
  // то есть сторож зависел от того, что ему передадут. Сток частоты — это то напряжение, которое
  // обслуживает её при НУЛЕВОМ сдвиге, и оно всегда есть в таблице, которая для ступени обязательна.
  const stockMv = servingAfterRaise(points, 0, clockMhz)?.mv ?? null;
  // ГЛУБИНА ОТ ДОКАЗАННОГО, А НЕ РАССТОЯНИЕ ДО ЗАКАЗА (`interviews/009`, живой прогон 2026-08-16).
  //
  // Прежняя редакция сравнивала выданное с ЗАКАЗАННЫМ и останавливала прогон на любом промахе вниз.
  // Она встала на 2857 МГц: заказано 1025, карта подставила 1020 — соседняя ступень сетки. Разбор
  // показал, что остановка была лишней **по собственным числам развёртки**: сток 2857 это 1050, то
  // есть приземление на 1020 — шаг в 30 мВ при стене `plan.cliffMv` = 35. Ни один сторож нарушен не
  // был; сработала проверка, меряющая не ту величину.
  //
  // ПОЧЕМУ ПРОМАХ НЕИЗБЕЖЕН И ЗНАНИЕМ СЕТКИ НЕ ЛЕЧИТСЯ. Напряжение нельзя заказать: у каждой из 127
  // записей оно ЗАКРЕПЛЕНО, двигается только частота записи, и какая запись дотянется до испытуемой
  // частоты — решает карта. А дотягивается она по оси, которая ЕДЕТ: ось напряжений стоит намертво,
  // ось частот сползает с нагревом ≈1,7 МГц на градус (R14b), и десять секунд прожига этот сдвиг
  // производят. Улика того же прогона: «985 мВ обслуживало 2662 МГц, теперь 2677 МГц». Значит заказ у
  // нас точный, а приземление — плюс-минус соседняя ступень, и так будет всегда.
  //
  // ЧТО ПРИ ЭТОМ НЕ ОСЛАБЛЕНО, и это главное. Стена та же самая (`plan.cliffMv`, `bugs/03`), земля —
  // самое глубокое ДОКАЗАННОЕ напряжение. Побочно проверка стала СТРОЖЕ там, где прежняя была слепа:
  // выдачу ВЫШЕ заказа, но на 40 мВ ниже доказанного, старый код пропускал молча — теперь она
  // остановит. Слово владельца «ближайшее ВЕРХНЕЕ» остаётся правилом ЗАКАЗА (его исполняет план); тут
  // судится ФАКТ приземления, и судится он тем же числом, которым план судил намерение.
  // ⚠️ И ОБЕ ВЕЛИЧИНЫ ОБЯЗАНЫ БЫТЬ ОБ ОДНОЙ ЧАСТОТЕ (`bugs/34`). `provenMv` доказано на ЗАКАЗАННОЙ
  // частоте, а `measuredMv` — это напряжение, обслуживающее ту, на которой карта РЕАЛЬНО работала.
  // Пока карту закрепляли, это была одна и та же частота, и разницы не существовало. Канон
  // 2026-08-22 сделал просадку нормой, и сравнение развалилось: более низкую частоту обслуживает
  // более НИЗКАЯ запись кривой, поэтому разность растёт САМА, без всякого глубокого шага с нашей
  // стороны. Сторож `bugs/03` написан против глубокого ПРЫЖКА В ЗАПИСИ — здесь прыжка нет, и он
  // краснел на штатном поведении карты (ловушка T6: остановка на первой же ступени законного заказа).
  //
  // Когда карта ушла на другую частоту, вопрос о глубине принадлежит ВЫДАННОЙ частоте и её
  // СОБСТВЕННОЙ земле, которой у нас здесь нет. Сторож молчит, а не выдумывает опору, и говорит об
  // этом вслух. Стена над ЗАКАЗОМ при этом не ослаблена ни на милливольт: её считает план
  // (`plan.cliffMv`, отказ ДО первой записи), и она осталась на месте.
  const sagged = Number.isFinite(record.deliveredMhz) && Number.isFinite(clockMhz)
    && clockMhz - record.deliveredMhz > (config.CLOCK_LADDER_STEP_TOLERANCE_MHZ ?? 8);
  if (sagged) {
    record.depthGuardSkipped = 'карта ушла на другую частоту — глубина судится по её собственной земле';
  }
  if (!sagged && Number.isFinite(provenMv) && Number.isFinite(maxStepFromProvenMv) && Number.isFinite(measuredMv)) {
    const stepFromProven = provenMv - measuredMv;
    if (stepFromProven > maxStepFromProvenMv) {
      return close(stop('void', `ШАГ ОТ ДОКАЗАННОГО СЛИШКОМ ГЛУБОК: на ${clockMhz} МГц доказано ${provenMv} мВ, `
        + `заказано ${voltageMv} мВ, а после записи частоту обслуживало ${measuredMv} мВ — это ${stepFromProven} мВ `
        + `от доказанного при разрешённых ${maxStepFromProvenMv} (bugs/03). Размер шага — единственная защита, `
        + 'которая действует ДО того, как состояние возникнет: все остальные откаты требуют живой ОС'));
    }
  }
  // ⚠️ СТРОГО ВЫШЕ СТОКА, А НЕ «НА СТОКЕ». Живой прогон 2026-08-16 отверг первую редакцию этой
  // строки (`>=`): на 2880 МГц дрейф за время прожига съел весь первый шаг −25 мВ, карта вернулась
  // ровно на сток, и сторож объявил поломкой обычное «шаг ничего не дал». Покрытие упало с 5 частот
  // из 10 до одной. **Выдача НА стоке — честный замер** («при этом напряжении частота работает», что
  // и так известно), спуск после неё просто идёт дальше и глубже. Поломка — только выдача ВЫШЕ
  // стока: такого напряжения карта частоте не давала, и утверждать о нём нечего.
  if (Number.isFinite(stockMv) && measuredMv > stockMv) {
    return close(stop('void', `ВЫДАЧА ВЫШЕ СТОКА: заказано ${voltageMv} мВ на ${clockMhz} МГц, а частоту `
      + `обслуживало ${measuredMv} мВ при стоке ${stockMv} мВ. Выше заводского напряжения мы частоту не `
      + 'поднимали и утверждать о таком напряжении нечего — это не измерение, а несработавшая запись'));
  }
  // ⚠️ «БЛИЖАЙШЕЕ ВЕРХНЕЕ» ТЕПЕРЬ ПРОВЕРЯЕТСЯ, А НЕ ОБЪЯВЛЯЕТСЯ — `bugs/42`, слово владельца
  // 2026-08-16 (`GOAL.md` → «ТО ЖЕ ПРАВИЛО НА ОСИ НАПРЯЖЕНИЯ»): «ближайшее верхнее с сетки (одна
  // ступень) — ПОПАДАНИЕ · выше, но НЕ ближайшее — СТОП: это уже другая запись таблицы, а не
  // округление вверх».
  //
  // До 2026-08-23 здесь стоял ОДИН `console.log`, который печатал «взято ближайшее верхнее с сетки
  // карты», ничего при этом не измерив. Вечером того дня на карте владельца прогон заказал 885 мВ,
  // прогретая карта подставила 915 — четыре ступени сетки, — движок принял это за измерение,
  // записал 915 доказанной землёй, и спуск замкнулся в петлю на одной частоте.
  //
  // Мерка — САМЫЙ ШИРОКИЙ зазор сетки (10 мВ), а не типовой (5): сетка неравномерна, и порог по
  // типовому зазору краснел бы на том, в какую её половину попала ступень.
  if (measuredMv > voltageMv) {
    const overshootMv = measuredMv - voltageMv;
    const nearest = overshootMv <= config.VOLTAGE_GRID_MAX_GAP_MV;
    console.log(`  ПОПАЛИ ВЫШЕ: заказано ${voltageMv} мВ, карта подставила ${measuredMv} мВ — `
      + `${nearest ? `ОДНА ступень сетки вверх (${overshootMv} мВ при самом широком зазоре ${config.VOLTAGE_GRID_MAX_GAP_MV})`
        : `НЕ ближайшая ступень: ${overshootMv} мВ при самом широком зазоре сетки ${config.VOLTAGE_GRID_MAX_GAP_MV} мВ, `
          + 'то есть ДРУГАЯ запись таблицы'}`
      + `. Таблица едет с нагревом ПРЯМО ВО ВРЕМЯ прожига. Меряем и пишем ВЫДАННОЕ — ${measuredMv} мВ на ${clockMhz} МГц`);
  }

  // ---- 9. THE VERDICT, AT LAST — and a failure is a SIGNAL, never the edge (§4.6).
  if (isPass(record.verdict)) {
    return close({
      ...record,
      outcome: 'passed',
      why: `${measuredMv} мВ обслуживает ${clockMhz} МГц и ПРОШЛО (сдвиг +${plan.deltaMhz} МГц, потолок держит ${held.heldBy}`
        + `${measuredMv !== voltageMv ? `, заказано было ${voltageMv} мВ — взято ближайшее верхнее с сетки карты` : ''}`
        + `${record.decidedBy ? `, решала форма ${record.decidedBy}` : ''})`,
    });
  }
  return close({
    ...record,
    outcome: 'failed',
    why: `ОТКАЗ ${record.verdict} на ${clockMhz} МГц / ${measuredMv} мВ${record.decidedBy ? ` (форма ${record.decidedBy})` : ''}. `
      + 'Это СИГНАЛ, что край рядом, а НЕ край: край ищется шагом 5 мВ, и только к нему применяется запас +10 мВ',
  });
}

/**
 * THE REFINEMENT — a coarse failure is NOT an edge, and this is what turns one into the other.
 * `plans/15` §4.6.
 *
 * ─── THE OWNER'S RULE, AND IT IS BINDING ──────────────────────────────────────────────────────────
 *
 * He said it three times, the last time after this project filed it as an open question (2026-08-15
 * 21:5x):
 *
 *   > *«ТАМ, ГДЕ ОТКАЗ — ЗНАЧИТ МЫ УЖЕ У КРАЯ!!!! А У КРАЯ ХОДИМ ВСЕГДА ПО 5 мВ. … Найти отказ нужно
 *   > с шагом 5 мВ — это строгое правило! Если падало, когда ходили шагами отличающимися от 5 мВ —
 *   > это значит мы у края. Переходим на шаг 5 мВ. Точно находим край этим шагом. И от него на 10 мВ
 *   > поднимаемся вверх.»*
 *
 * **TWO OBJECTS, NEVER TO BE CONFUSED.** A failure on a 25 or 10 mV rung is a SIGNAL that the edge is
 * near. It is not the edge; it is never written to the curve document as one; the margin is never
 * applied to it. The descent returns to the last PASSING voltage, walks down in the card's own minimum
 * steps, and the failure found THAT way is the edge. **That is what makes the 25 mV zone safe to
 * want** — the coarse ladder's only job is to reach the neighbourhood cheaply, and it never produces a
 * number that ships.
 *
 * ─── WHY EVERY REFINEMENT RUNG IS STILL A SHALLOW STEP ────────────────────────────────────────────
 *
 * The walk starts at the last PROVEN-SAFE voltage and moves one grid point at a time, so rail S2 (the
 * `bugs/03` governor — never plunge) holds throughout. The refinement is the OPPOSITE of a plunge: it
 * is the finest approach this card can make.
 *
 * ─── THE ONE HARDWARE LIMIT, REPORTED AND NOT NEGOTIATED ─────────────────────────────────────────
 *
 * In 32 of this card's 126 grid intervals the neighbouring voltages differ by 10 mV — the card offers
 * NOTHING between them, so no 5 mV step exists there to take. The refinement then walks the card's
 * minimum AVAILABLE step and the result SAYS that at this frequency the edge is located only to the
 * card's own resolution (`resolutionMv`).
 *
 * ─── 🔴 AND THIS IS EXACTLY WHERE THE OWNER RE-ANCHORED THE MARGIN, 2026-08-17 ───────────────────
 *
 *   > *«Переделываем на: последняя стабильная до отказа точка (соседка отказа сверху) + 5 мВ. Это
 *   > исправляет случае, где шаг был не 5 мВ, а, например, сетка позволяла только 10 мВ»*
 *
 * The cushion is added to the **last voltage that PASSED**, not to the failure. On a 10 mV interval
 * the old form («failure + two minimum steps») produced the last passing rung ITSELF — a margin of
 * exactly zero over proven ground, in 32 places on this card, invisible because the arithmetic looked
 * the same from the failure's side. Where the interval is 5 mV both forms give the identical voltage,
 * so nothing already measured moves; the new form is never lower and sometimes higher.
 * `marginAboveLastStableMv` is still asked with the card's MINIMUM step and still THROWS if handed a
 * local gap, so a doubled cushion cannot be written by accident either.
 *
 * ─── AND THE SHIPPED VOLTAGE IS SNAPPED UP, NEVER DOWN ───────────────────────────────────────────
 *
 * `V_pass + 5 mV` may not exist on a non-uniform grid. The shipped value is the lowest grid voltage
 * that is at least that — rounding toward MORE margin, because the alternative is shipping a voltage
 * closer to a measured failure than the owner's policy allows.
 *
 * @param {object}   a
 * @param {number[]} a.voltageGridMv  the card's own voltage dictionary
 * @param {number}   a.lastPassMv     the deepest voltage that PASSED on the coarse ladder
 * @param {number}   a.coarseFailMv   the voltage that failed on a coarse rung — the SIGNAL, not the edge
 * @param {function} a.runRungFn      `(voltageMv) => rung record` — injected; this module never writes
 * @returns {Promise<object>} `{ok, refined, failMv, lastPassMv, shipMv, reproduced, resolutionMv,
 *                              rungs, halted, why}`
 *
 * [TESTED: 2026-08-15 23:4x, OFFLINE ONLY · 12 blocks on the card-shaped grid (5 mV with a 10 mV gap
 *  every 25), five mutations (49–53) each reddening its own block. Four of the twelve were RED on the
 *  first run because the FIXTURES were wrong — two picked 1030 mV, a voltage this card does not have —
 *  and the fix was to move the fixtures onto the measured grid, not to widen the code.
 *  **NOT TESTED: no refinement has ever walked a real card.**]
 */
export async function refineEdge({
  voltageGridMv = [],
  lastPassMv = null,
  coarseFailMv = null,
  minStepMv = config.VOLTAGE_GRID_STEP_MV ?? 5,
  runRungFn,
} = {}) {
  if (typeof runRungFn !== 'function') {
    throw new Error('refineEdge требует runRungFn — движок сам в карту не пишет (правило R1)');
  }
  const bad = (why) => ({ ok: false, refined: false, failMv: null, lastPassMv, shipMv: null,
    reproduced: false, resolutionMv: null, rungs: [], halted: false, why });
  if (!Array.isArray(voltageGridMv) || voltageGridMv.length === 0) return bad('сетка напряжений пуста — уточнять не по чему');
  if (!Number.isFinite(coarseFailMv)) return bad('напряжение отказа не названо — уточнять нечего');
  if (!Number.isFinite(lastPassMv)) return bad('последнее прошедшее напряжение не названо — от чего спускаться заново, неизвестно');
  if (!(lastPassMv > coarseFailMv)) {
    return bad(`последнее прошедшее ${lastPassMv} мВ не ВЫШЕ отказа ${coarseFailMv} мВ — это не вилка, а перевёрнутый интервал`);
  }

  const grid = [...new Set(voltageGridMv.filter(Number.isFinite))].sort((a, b) => b - a);
  // The rungs the card actually offers strictly INSIDE the bracket, deepest-last.
  const between = grid.filter((v) => v < lastPassMv && v > coarseFailMv);

  const rungs = [];
  let pass = lastPassMv;
  let failMv = null;

  for (const mv of between) {
    const r = await runRungFn(mv);
    rungs.push({ voltageMv: mv, outcome: r?.outcome ?? null, verdict: r?.verdict ?? null });
    if (r?.outcome === 'passed') { pass = mv; continue; }
    if (r?.outcome === 'failed') { failMv = mv; break; }
    // ANYTHING ELSE IS A STOP, NEVER PROGRESS — `unknown` (the oracle could not judge, or the
    // rollback was dirty), `void` (the rung measured a foreign voltage), `refused`, `lever-limited`.
    // Narrowing an edge around an unobserved boundary would be inventing a measurement (EXP-0011).
    return {
      ok: false, refined: false, failMv: null, lastPassMv: pass, shipMv: null,
      reproduced: false, resolutionMv: null, rungs, halted: true,
      why: `УТОЧНЕНИЕ ОСТАНОВЛЕНО на ${mv} мВ: исход «${r?.outcome ?? 'нет ответа'}» — не PASS и не отказ. `
        + `${r?.why ?? ''} Край здесь НЕ найден, и записывать вместо него грубый отказ было бы враньём`,
    };
  }

  // Nothing between the two failed → the coarse failure is now bracketed by a PASS one grid point
  // above it, which is a 5 mV-resolved edge by construction. Both formulations of the owner's rule
  // agree here and give the same number, because the two rungs are adjacent.
  const reproduced = failMv !== null;
  if (failMv === null) failMv = coarseFailMv;

  // THE LOCAL RESOLUTION — the gap between the failure and the nearest grid point above it. On this
  // card it is 5 mV in 94 intervals and 10 mV in 32, and where it is 10 the run must SAY that the edge
  // is located only to the card's own resolution.
  const above = grid.filter((v) => v > failMv);
  const nearestAbove = above.length ? Math.min(...above) : null;
  const resolutionMv = nearestAbove === null ? null : nearestAbove - failMv;

  // THE MARGIN IS ALWAYS ASKED WITH THE CARD'S MINIMUM STEP, never with the local gap — the helper
  // THROWS on a coarser step precisely so a doubled cushion cannot be written by accident.
  //
  // ⚠️ AND IT IS ADDED TO `pass`, NOT TO `failMv` — the owner's re-anchoring of 2026-08-17. `pass` is
  // the deepest voltage that actually SURVIVED a burn at this frequency: after the walk above it is
  // the failure's upper neighbour on the card's own grid, whatever the local interval happens to be.
  const margin = marginAboveLastStableMv(minStepMv);
  const wanted = pass + margin.millivolts;
  // Snap UP to a voltage the card can actually be asked for. Rounding toward MORE margin, because the
  // alternative is shipping closer to a measured failure than the owner's policy allows.
  const shipMv = grid.filter((v) => v >= wanted).sort((a, b) => a - b)[0] ?? null;
  if (shipMv === null) {
    return {
      ok: false, refined: reproduced, failMv, lastPassMv: pass, shipMv: null,
      reproduced, resolutionMv, rungs, halted: true,
      why: `последняя стабильная ${pass} мВ + запас ${margin.millivolts} мВ = ${wanted} мВ, а такого напряжения `
        + '(или выше) в сетке карты нет — просить его не у кого',
    };
  }

  return {
    ok: true,
    refined: between.length > 0,
    failMv,
    lastPassMv: pass,
    shipMv,
    reproduced,
    resolutionMv,
    rungs,
    halted: false,
    why: (between.length === 0
      ? `грубая ступень БЫЛА одним шагом сетки: отказ ${failMv} мВ уже локализован разрешением карты`
      : reproduced
        ? `отказ воспроизведён шагом сетки: ${pass} мВ прошло, ${failMv} мВ отказало`
        : `ОТКАЗ НЕ ВОСПРОИЗВЁЛСЯ ни на одной мелкой ступени (${between.length} шт., все PASS) — краем остаётся `
          + `грубый отказ ${failMv} мВ, теперь взятый в вилку одним шагом сетки от ${pass} мВ`)
      + `. Отгружается ${shipMv} мВ = ПОСЛЕДНЯЯ СТАБИЛЬНАЯ ${pass} мВ + запас ${margin.millivolts} мВ `
      + `(${margin.steps} шаг сетки по ${margin.gridStepMv}), подтянуто вверх к напряжению, которое у карты есть`
      + (resolutionMv !== null && resolutionMv > minStepMv
        ? `. ⚠️ На этой частоте у карты НЕТ шага ${minStepMv} мВ: ближайшее напряжение выше отказа отстоит на `
          + `${resolutionMv} мВ, значит край локализован лишь разрешением карты`
        : ''),
  };
}

/**
 * THE SEED — where a frequency's descent STARTS, taken from its already-tuned higher neighbour.
 * `plans/15` §4.2 · the owner's words in `GOAL.md` → «🪜 СПУСК НАЧИНАЕТСЯ С УЖЕ ОТТЮНЕННОЙ СОСЕДКИ».
 *
 *   > *«можно начинать спуск не со стокового напряжения, а с верхней по частоте отюненной точки»*
 *
 * This is what turns a 5–7 hour sweep into ≈1.7 h, and the AGENT WAS AGAINST IT — a seed is a jump
 * onto a deep voltage rather than a walk down to it, i.e. the shape of `bugs/03`. The owner read that
 * reasoning and decided otherwise; the decision is his and it is taken. What makes it executable is
 * three mechanisms, and this function owns the first two:
 *
 *   1. **The seed is the neighbour's PASSING voltage, never its failure.** He said «край + 10 мВ» is
 *      what a tuned frequency carries, so a frequency closed as `edge-found` / `short-burn-proved` /
 *      `long-burn-proved` offers its `voltageMv`. A frequency closed as `lever-limited` offers
 *      NOTHING: our lever ran out there, so its voltage is not evidence about silicon.
 *   2. **Only a HIGHER frequency may seed a lower one**, because that is the direction the physics
 *      runs: Vmin does not decrease with frequency (setup-time violation at the edge —
 *      `researches/09` §2.3), so a voltage proven at a HIGHER frequency is not optimistic at a lower
 *      one. Seeding upward would be exactly the unsafe direction.
 *
 * The third mechanism is not here: the seed's first burn is a PROOF, and a non-PASS on it cancels the
 * seed (`seedOutcome` below). His own caveat is why that exists — *«очень редко — выше, почти не
 * бывает такого»* is not «никогда».
 *
 * @param {object}  a
 * @param {number}  a.frequencyMhz  the frequency about to be tuned
 * @param {object}  a.curveDoc      the tuning-curve document (`curves/measured.json` shape)
 * @returns {{seedMv:number, neighbourMhz:number, neighbourStatus:string}|null} — null means «descend
 *          from stock», which is the honest answer for the first frequency and after a lever wall.
 *
 * [TESTED: 2026-08-15 22:4x, OFFLINE · blocks for «only from ABOVE», «only from PROVEN evidence» and the
 *  nearest-neighbour rule; mutations 29–30 (a `lever-limited` neighbour seeding, a seed taken from below)
 *  each redden their own block. Additionally driven end to end by the sweep (§4.5) and by trap T3.
 *  **NOT TESTED on a live card.**]
 */
export function seedFor({ frequencyMhz, curveDoc } = {}) {
  const rows = curveDoc?.frequencies;
  if (!Array.isArray(rows) || !Number.isFinite(frequencyMhz)) return null;
  // ⚠️ THE HAND-COPIED SUBSET IS GONE (epic 04 phase 1, `plans/24` §4.5). This used to be
  // `new Set(['short-burn-proved', 'edge-found', 'long-burn-proved'])` — the vocabulary written out a
  // second time, in a second file, with nothing enforcing agreement. That is the truth↔mirror shape
  // the registry says to COLLAPSE rather than watch, and it is the shape `bugs/24` cost five days: a
  // status added to the vocabulary would never have reached this list, and the sweep would have
  // silently refused to seed from perfectly good evidence.
  //
  // Now the row is ASKED whether a burn proved it (`curve-store.claimsBurnProof`), so the vocabulary
  // lives in exactly one place. `lever-limited` stays out for the same reason as before — our lever
  // ran out, the silicon never spoke — and that reason is now written where the tag is defined.
  let best = null;
  for (const r of rows) {
    if (!r || !Number.isFinite(r.mhz) || !Number.isFinite(r.voltageMv)) continue;
    if (r.mhz <= frequencyMhz) continue;              // only from ABOVE
    if (!claimsBurnProof(r)) continue;                // only PASSED evidence
    // The NEAREST higher frequency: the closest neighbour is the least extrapolation.
    if (best === null || r.mhz < best.mhz) best = r;
  }
  if (best === null) return null;
  // The neighbour is described by the STORED tags, derived here — a fixture row has no attached view.
  return { seedMv: best.voltageMv, neighbourMhz: best.mhz, neighbourStatus: statusFromTags(best.tags) };
}

/**
 * WHAT THE SEED'S FIRST BURN MEANS — the third mechanism, and the one that keeps the owner's rule
 * honest instead of assumed. `plans/15` §4.2, criterion F2-AC3.
 *
 * He stated the physics as a TENDENCY and said so himself: *«как правило… или даже ниже, очень редко —
 * выше, почти не бывает такого»*. «Почти не бывает» is not «never», so the engine must be able to meet
 * the rare case and must not read it as a normal failure of the run:
 *
 *   • **PASS** — monotonicity holds on this silicon here; the descent continues FROM the seed, and the
 *     seed depth becomes the governor's proven ground (`provenSavedMv`).
 *   • **anything else** — the seed is CANCELLED for this frequency, the descent restarts from stock on
 *     the owner's step ladder, and the event is PRINTED with both voltages and the neighbour that
 *     supplied it. That is a finding about the silicon, not a stumble in the sweep, and the count of
 *     these events IS the measurement of monotonicity on this card (`researches/09` §4.2).
 *
 * A cancelled seed is never retried at the same frequency: the whole point is that the jump was not
 * safe there, and repeating it is the `bugs/03` shape with extra steps.
 *
 * @returns {{seeded:boolean, restartFromStock:boolean, provenSavedMv:number, note:string}}
 *
 * [TESTED: 2026-08-15 22:4x, OFFLINE · the PASS branch and the cancel branch, including НЕИЗВЕСТНО;
 *  mutation 31 (continue seeded after a rejected seed) reddens its block, and trap T3 now drives the
 *  whole path over a card whose Vmin really is non-monotone. **NOT TESTED on a live card.**]
 */
export function seedOutcome({ verdict, seedMv, stockVoltageMv, neighbourMhz, frequencyMhz,
                              fromOwnEvidence = false } = {}) {
  const depth = Number.isFinite(stockVoltageMv) && Number.isFinite(seedMv) ? stockVoltageMv - seedMv : 0;
  // ОТКУДА ЗАТРАВКА — ЧАСТЬ УТВЕРЖДЕНИЯ, А НЕ УКРАШЕНИЕ (`bugs/32`). Собственная улика доказана
  // РОВНО на этой частоте, соседкина — на более высокой; читатель свидетеля обязан их различать,
  // а «от соседки undefined МГц» это ещё и просто ложь в документе.
  const source = fromOwnEvidence || !Number.isFinite(neighbourMhz)
    ? 'из СОБСТВЕННОЙ улики этой частоты (журнал упреждающей записи)'
    : `от соседки ${neighbourMhz} МГц`;
  if (isPass(verdict)) {
    return {
      seeded: true,
      restartFromStock: false,
      provenSavedMv: depth > 0 ? depth : 0,
      note: `затравка ${seedMv} мВ ${source} прошла — монотонность здесь держится, `
        + `спуск продолжается от неё (доказанная глубина −${depth} мВ)`,
    };
  }
  return {
    seeded: false,
    restartFromStock: true,
    provenSavedMv: 0,
    note: `ЗАТРАВКА ОТВЕРГНУТА на ${frequencyMhz} МГц: ${seedMv} мВ ${source} дало `
      + `вердикт ${verdict ?? 'НЕИЗВЕСТНО'}, а не PASS. Монотонность на этом кремнии здесь НАРУШЕНА — `
      + `это находка о карте, а не сбой прогона. Спуск начинается заново от стока ${stockVoltageMv} мВ `
      + 'по лестнице шагов владельца.',
  };
}

/**
 * THE RUNGS OF THE SWEEP — the frequencies that are actually BURNED, and the ones that inherit.
 * `plans/13` §8.1 · criterion E2-AC3.
 *
 * The card offers 127 voltage rungs for 389 frequencies, so neighbouring frequencies SHARE a serving
 * voltage — measured on the live card: 5.19 frequencies per rung (`researches/09` §3.2). Burning every
 * frequency separately would measure one fact five times and turn 13 hours into 67.
 *
 * So the frequencies that share a stock serving voltage form ONE rung, and the rung is burned at its
 * HIGHEST frequency — the hardest member, because Vmin does not decrease with frequency. The rest
 * inherit that result DOWNWARD, which is the safe direction and is why E2-AC3 calls it «the same
 * measured fact» rather than interpolation.
 *
 * ⚠️ **THE GROUPING KEY IS THE STOCK VOLTAGE, NOT THE TUNED ONE**, and the difference matters: the
 * tuned voltage is what this sweep is trying to find, so grouping by it would be grouping by the
 * answer. The stock serving voltage is a property of the card read before the search starts.
 *
 * @returns {Array<{topMhz:number, bottomMhz:number, stockVoltageMv:number, count:number}>} top-down
 *
 * [TESTED: 2026-08-16 00:3x, OFFLINE · 2 blocks in `engine --selftest`; mutation 54 (group by the
 *  TUNED voltage) reddens 6 blocks including «ступень группируется по СТОКОВОМУ напряжению», and
 *  mutation 55 (burn the rung's LOWEST frequency) reddens «СТУПЕНЬ ПРОЖИГАЕТСЯ НА САМОЙ ВЫСОКОЙ
 *  СВОЕЙ ЧАСТОТЕ». **NOT TESTED: no rung has ever been grouped against a live card's document.**]
 */
export function rungGroups({ rows = [], fromMhz = null, toMhz = null } = {}) {
  const lo = Number.isFinite(toMhz) ? toMhz : -Infinity;
  const hi = Number.isFinite(fromMhz) ? fromMhz : Infinity;
  const inBand = rows.filter((r) => Number.isFinite(r?.mhz) && r.mhz >= lo && r.mhz <= hi
    && Number.isFinite(r?.stockVoltageMv));
  // The document is stored high → low, but a caller may hand over anything; sorting here means the
  // direction of the sweep is a property of this function rather than of its input.
  const sorted = [...inBand].sort((a, b) => b.mhz - a.mhz);

  const groups = [];
  for (const r of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.stockVoltageMv === r.stockVoltageMv) {
      last.bottomMhz = r.mhz;
      last.count += 1;
      continue;
    }
    groups.push({ topMhz: r.mhz, bottomMhz: r.mhz, stockVoltageMv: r.stockVoltageMv, count: 1 });
  }
  return groups;
}

/**
 * WHAT THE DESCENT WILL WALK AT ONE FREQUENCY — pure, no burns, and it is the SAME computation the
 * run uses. `plans/15` §4.7, criterion F2-AC8.
 *
 * ─── WHY THIS FUNCTION EXISTS AT ALL, AND IT IS NOT «TIDINESS» ────────────────────────────────────
 *
 * `bugs/09`: the dry run advertised a ladder reaching −250 mV while the run stopped at −30. Nothing
 * was broken in the run — the PLAN was a second implementation of it, and the two had drifted. That
 * dry run is the artifact rail S2 makes the operator read BEFORE anything is written to the owner's
 * card, so a plan that lies is worse than no plan: it launders a guess into an authorization.
 * EXP-0052 states the rule the fix produced — **«a bound added to the RUN is not added until the PLAN
 * prints it»** — and the mechanical form of that rule is this: ONE function, called by both. Not two
 * functions kept in agreement, and not a pair in the truth↔mirror registry. A pair that can be
 * REMOVED beats a pair that must be watched (`AGENT_GUIDE.md`).
 *
 * ─── TWO LADDERS, BOTH NAMED ─────────────────────────────────────────────────────────────────────
 *
 * `rungs` is the expected path — starting at the seed when a proven higher neighbour offers one.
 * `rungsFromStock` is what the descent falls back to when the seed's first burn is not a PASS, which
 * is the rare case the owner named himself. A dry run printing only the first would be honest exactly
 * until that case happens, so both travel.
 *
 * @returns {object} `{frequencyMhz, seed, seedMv, startMv, rungs, rungsFromStock, firstStepMv,
 *                     zonesCrossed, forcedByGridCount, floorMv, refused, cliffRefused, why}`
 *
 * [TESTED: 2026-08-16 01:0x, OFFLINE · exercised by every §4.5 and §4.7 block, because the run itself
 *  walks what this returns. The load-bearing one is «ПЛАН ОБЕЩАЕТ РОВНО ТЕ СТУПЕНИ, ЧТО ПРОЙДЁТ
 *  ПРОГОН» (F2-AC8), and mutation 64 — make the plan and the run compute separately, i.e. restore
 *  `bugs/09` — reddens it. **NOT TESTED on a live card.**]
 */
export function planFrequency({
  frequencyMhz = null,
  stockVoltageMv = null,
  voltageGridMv = [],
  availableDepthMv = null,
  depthCapMv = null,
  // A VOLTAGE THAT ALREADY HUNG THIS FREQUENCY (`sweep-journal.hangFloors`, `bugs/23`). Travels with
  // the PLAN and not only with the run, because a wall the dry run does not print is a wall the
  // operator meets mid-run — EXP-0052's rule, applied to the third wall exactly as to the second.
  hangFloorMv = null,
  // САМАЯ ГЛУБОКАЯ СТУПЕНЬ, НА КОТОРОЙ ЭТА ЧАСТОТА УЖЕ ВЫСТОЯЛА (`sweep-journal.provenRungs`,
  // `bugs/31`). Едет вместе с ПЛАНОМ по той же причине, что и пол зависания: улика, которой не
  // печатает сухой прогон, — улика, о которой оператор узнаёт посреди прогона (EXP-0052).
  provenPassMv = null,
  curveDoc = null,
  zones = config.DESCENT_ZONES,
  cliffMv = config.ASCENT_STEP_MAX_MV ?? 35,
} = {}) {
  const hangBound = Number.isFinite(hangFloorMv);
  const seed = seedFor({ frequencyMhz, curveDoc });
  // ─── A SEED IS A JUMP, SO IT IS THE FIRST THING THE HANG FLOOR MUST BE ABLE TO CANCEL ────────────
  //
  // The seed lands on the neighbour's proven voltage in ONE step (the owner's optimization, `GOAL.md`
  // → «🪜 СПУСК НАЧИНАЕТСЯ С УЖЕ ОТТЮНЕННОЙ СОСЕДКИ»). If that voltage sits at or below a rung this
  // frequency has already hung the machine on, the seed would deliver us onto the fatal rung on the
  // FIRST burn — before any ladder had a chance to stop anything. The ladder's floor cannot save us
  // there, because the seed is not a ladder rung. So the cancellation lives here, next to the jump.
  //
  // Cancelled means «descend from stock on the owner's ladder», which the ladder then floors — the
  // same fallback a rejected seed already uses, not a new path.
  // ─── СОБСТВЕННАЯ УЛИКА ЧАСТОТЫ СИЛЬНЕЕ СОСЕДСКОЙ (`bugs/31`) ─────────────────────────────────────
  //
  // `provenPassMv` — самая глубокая ступень, на которой ЭТА частота уже выстояла, прочитанная из
  // журнала (`sweep-journal.provenRungs`). До неё возобновление знало только полы зависания, то есть
  // помнило смерти и не помнило успехов: частота с найденным краем начинала спуск от затравки соседки
  // и заново жгла всё, что уже доказала. Владелец: «край найден у точки, какого хуя вновь с неё
  // начинать не понимаю и злюсь». Живая цена: 2820 МГц шла 995 → 870 тринадцатью ступенями, каждая из
  // которых уже проходила.
  //
  // Берётся ГЛУБОЧАЙШАЯ из двух улик. Соседская затравка доказана на БОЛЕЕ ВЫСОКОЙ частоте и потому
  // безопасна здесь (Vmin не убывает с частотой); собственная доказана ровно здесь. Обе законны, и
  // ниже начинает та, что глубже.
  //
  // ⚠️ Затравка по-прежнему ПРОЖИГАЕТСЯ первой — это проверка, а не формальность: спуск обязан
  // убедиться, что вчерашний PASS воспроизводится сегодня, прежде чем идти глубже. Экономятся
  // ступени между стоком и уликой, а не проверка самой улики.
  const ownProvenMv = Number.isFinite(provenPassMv) && provenPassMv < stockVoltageMv ? provenPassMv : null;
  const neighbourSeedMv = Number.isFinite(seed?.seedMv) ? seed.seedMv : null;
  const candidateSeedMv = ownProvenMv === null ? neighbourSeedMv
    : (neighbourSeedMv === null ? ownProvenMv : Math.min(ownProvenMv, neighbourSeedMv));
  // ИСТОЧНИК ЗАТРАВКИ НАЗЫВАЕТСЯ ЧЕСТНО. Сухой прогон — документ, который оператор читает ПЕРЕД
  // разрешением на запись (рельс S2), и «затравка 870 мВ от соседки 2835 МГц» там, где 870 пришли из
  // собственного журнала этой частоты, а у соседки стоит 995, — это ложь в самом ответственном месте.
  const seedFromOwnEvidence = ownProvenMv !== null && candidateSeedMv === ownProvenMv;

  // Пол зависания отменяет ЛЮБУЮ затравку одинаково — и соседскую, и собственную: прыжок есть прыжок.
  const seedBlockedByHang = Number.isFinite(candidateSeedMv) && hangBound && candidateSeedMv <= hangFloorMv;
  const seedMv = !seedBlockedByHang && Number.isFinite(candidateSeedMv) && candidateSeedMv < stockVoltageMv
    ? candidateSeedMv : null;
  const ladder = descentLadder({ voltageGridMv, stockVoltageMv, availableDepthMv, depthCapMv, hangFloorMv, zones });

  // TWO ladders, and both are named because the run may walk either: the expected path starts at the
  // seed, and a REJECTED seed drops the descent back to stock (§4.2, E2-AC11). A dry run that printed
  // only one of them would be honest exactly until the rare case the owner said happens.
  const fromStock = ladder.rungs;
  const rungs = seedMv === null ? fromStock : fromStock.filter((r) => r.mv < seedMv);
  const startMv = seedMv ?? stockVoltageMv;
  const firstStepMv = rungs.length ? startMv - rungs[0].mv : null;
  const zonesCrossed = [...new Set(rungs.map((r) => r.zoneStepMv))];

  return {
    frequencyMhz,
    stockVoltageMv,
    seed,
    seedMv,
    // Откуда взялась затравка — собственная улика частоты или значение соседки (`bugs/31`). Едет в
    // плане, потому что печатается в сухом прогоне, а он и есть документ разрешения на запись.
    seedFromOwnEvidence,
    startMv,
    rungs,
    rungsFromStock: fromStock,
    firstStepMv,
    zonesCrossed,
    forcedByGridCount: ladder.forcedByGridCount,
    floorMv: ladder.floorMv,
    availableDepthMv,
    // The operator's ceiling travels WITH the plan, so the dry run can print the bound the run will
    // obey. A bound added to the run and not to the plan is not added at all — `bugs/09`, EXP-0052.
    depthCapMv,
    boundDepthMv: ladder.boundDepthMv,
    cappedByOperator: ladder.cappedByOperator,
    // The third wall, carried outward by the same rule as the second: what stopped the descent is
    // RECORDED rather than left to be inferred from the numbers (`bugs/23`).
    hangFloorMv: ladder.hangFloorMv,
    stoppedByHang: ladder.stoppedByHang,
    seedBlockedByHang,
    refused: ladder.refused,
    // The `bugs/03` cliff on the FIRST step — checked here so the dry run can print the refusal too,
    // rather than the run discovering it after the operator has already said «go».
    cliffRefused: firstStepMv !== null && firstStepMv > cliffMv,
    cliffMv,
    // ⚠️ ОТМЕНЁННАЯ ЗАТРАВКА НАЗЫВАЕТСЯ СВОИМ ЧИСЛОМ И СВОИМ ИСТОЧНИКОМ (`bugs/32`). Прежняя
    // редакция брала их у `seed`, то есть у соседки, — а отменить пол зависания мог и прыжок из
    // СОБСТВЕННОЙ улики частоты, и тогда соседки могло не быть вовсе (`seed === null` → падение).
    cancelledSeedMv: seedBlockedByHang ? candidateSeedMv : null,
    why: ladder.why
      + (seedBlockedByHang
        ? ` · ЗАТРАВКА ОТМЕНЕНА ПОЛОМ ЗАВИСАНИЯ: ${seedFromOwnEvidence || !seed
          ? 'собственная улика этой частоты предлагает'
          : `соседка ${seed.neighbourMhz} МГц предлагает`} ${candidateSeedMv} мВ, `
          + `а ${hangFloorMv} мВ уже вешало эту частоту — спуск идёт от стока`
        : ''),
  };
}

/**
 * ONE FREQUENCY, END TO END — seed, descend, refine, and close with ONE of TWO verdicts.
 * `plans/15` §4.5.
 *
 * ─── TWO VERDICTS, NOT THREE, AND THE PLAN'S THIRD IS A LEFTOVER ──────────────────────────────────
 *
 * `plans/15` §4.5 lists `edge-found` · `lever-limited` · `clock-floor`. The epic settles it the other
 * way and it is the LATER word: *«Вердиктов у частоты два: „край найден“ и „предел рычага“. Третий
 * („пол частоты“) отменён вместе с нумерацией точек»* (`plans/13` §8.7). `clock-floor` was an artifact
 * of numbering table entries — in the owner's coordinates the frequency grid IS 180…3090 MHz and its
 * bottom is just its bottom (`GOAL.md` → «🔤 ТОЧЕК С НОМЕРАМИ НЕ СУЩЕСТВУЕТ»). `curve-store`'s status
 * vocabulary agrees and is CLOSED, so the third verdict could not be written even if it were wanted.
 *
 * ─── AND EVERYTHING THAT IS NOT A VERDICT IS A STOP ───────────────────────────────────────────────
 *
 * `unknown`, `void` and a journal-blocked rung do not close a frequency at all: they HALT it with no
 * shipped voltage, because closing a point around a boundary nobody observed would be a `[TESTED]`
 * marker with no observation behind it (EXP-0011, and the same rule `refineEdge` already obeys).
 *
 * @returns {Promise<object>} `{frequencyMhz, verdict, voltageMv, provenBy, seeded, seedRejected,
 *                              rungs, refinement, halted, why}`
 *
 * [TESTED: 2026-08-16 00:3x, OFFLINE · 6 blocks on scripted rungs — all-PASS closes `lever-limited`,
 *  a failure is refined before it ships, a rung-reported lever wall does not become an edge, НЕИЗВЕСТНО
 *  halts with no shipped voltage, a seed is taken and continued BELOW, a rejected seed falls back to
 *  stock and is spoken. Mutations 56, 61, 62 each redden their own block. **NOT TESTED: no descent
 *  has ever walked a real card — that is phase 3, with the owner present.**]
 */
export async function sweepFrequency({
  frequencyMhz = null,
  stockVoltageMv = null,
  voltageGridMv = [],
  availableDepthMv = null,
  depthCapMv = null,
  // WHAT ALREADY HUNG THIS FREQUENCY — the sweep reads it once from the journal and hands it down
  // (`bugs/23`). `null` is the normal case: no reboot has ever been paid for here.
  hangFloorMv = null,
  // Собственная улика этой частоты из журнала (`bugs/31`) — едет насквозь до плана.
  provenPassMv = null,
  curveDoc = null,
  runRungFn,
  // Лестница едет НАСКВОЗЬ, не разбираясь: `sweepFrequency` про интенсивность ничего не решает,
  // её дело — лестница НАПРЯЖЕНИЙ. Решение об интенсивности живёт в ступени, где видно, на какой
  // частоте прожиг реально шёл.
  shapeLadder = null,
  minStepMv = config.VOLTAGE_GRID_STEP_MV ?? 5,
  zones = config.DESCENT_ZONES,
  onEvent = null,
} = {}) {
  if (typeof runRungFn !== 'function') {
    throw new Error('sweepFrequency требует runRungFn — движок сам в карту не пишет (правило R1)');
  }
  const say = (kind, text, extra = {}) => { if (onEvent) onEvent({ kind, frequencyMhz, text, ...extra }); };
  const out = {
    frequencyMhz,
    verdict: null,
    voltageMv: null,
    provenBy: null,
    seeded: false,
    seedRejected: false,
    seedFrom: null,
    // ОТКУДА ПРИШЛА ЗАТРАВКА — поле, а не проза (`bugs/32`): свидетель строки и события окна читают
    // его, вместо того чтобы по умолчанию приписывать число соседке, которой могло и не быть.
    seedFromOwnEvidence: false,
    rungs: [],
    refinement: null,
    halted: false,
    blocked: false,
    // STOPPED BY A RECORDED HANG rather than by anything of ours (`bugs/23`) — a field, so the report
    // can name the reason without reading its own prose.
    hangFloorHalt: false,
    // THE FREQUENCY THE CARD ACTUALLY RAN — the owner's rule, `GOAL.md` → «🎚 ТЮНИМ ТО, ЧТО КАРТА
    // ВЫДАЁТ»: *«хотим заказать N, она нам выдала M — примиряемся с её выдачей и тюним то, что она
    // нам даёт»*. `frequencyMhz` above is the ORDER; this is the OBSERVATION, and it is the one the
    // curve document is keyed by.
    deliveredMhz: null,
    deliveredSpread: null,
    why: '',
  };

  // ─── ONE PLACE OBSERVES THE DELIVERED CLOCK, AND IT IS THIS WRAPPER ─────────────────────────────
  //
  // Every rung in this function — the seed, the coarse descent, and each of `refineEdge`'s fine
  // steps — goes through here, so no path can forget to record what the card delivered. Recording it
  // at the three call sites instead would be three chances to miss one, and the refinement's sites
  // live inside ANOTHER function. That is the truth↔mirror shape this project keeps paying for
  // (EXP-0074), avoided by having a single author.
  //
  // The value kept is the delivered clock of the LAST PASSING rung, because the voltage that ships is
  // the one a PASS proved. Every observed value is also collected, so the report can say how much the
  // delivered clock moved across the descent — it moves with the raise, and a spread nobody printed
  // is a spread nobody would notice.
  let lastPassDeliveredMhz = null;
  const seenDelivered = [];
  const runRung = async (a) => {
    const r = await runRungFn(a);
    if (Number.isFinite(r?.deliveredMhz)) {
      seenDelivered.push(r.deliveredMhz);
      if (r?.outcome === 'passed') lastPassDeliveredMhz = r.deliveredMhz;
    }
    return r;
  };
  // Stamped onto `out` by every exit that carries a verdict — collected here so the exits stay short.
  const withDelivered = () => {
    out.deliveredMhz = lastPassDeliveredMhz;
    if (seenDelivered.length) {
      out.deliveredSpread = { min: Math.min(...seenDelivered), max: Math.max(...seenDelivered), samples: seenDelivered.length };
    }
    return out;
  };

  // ---- 0. THE PLAN — and the run walks THIS, not a second computation of it (F2-AC8, `bugs/09`,
  // EXP-0052). Everything the dry run prints comes from the very object the loop below consumes.
  const plan = planFrequency({
    frequencyMhz, stockVoltageMv, voltageGridMv, availableDepthMv, depthCapMv, hangFloorMv,
    provenPassMv, curveDoc, zones,
  });
  out.plan = plan;
  const hangBound = Number.isFinite(plan.hangFloorMv);
  if (plan.seedBlockedByHang) {
    say('seed-blocked-by-hang', `${frequencyMhz} МГц: затравка ${plan.seed?.seedMv} мВ от соседки `
      + `${plan.seed?.neighbourMhz} МГц ОТМЕНЕНА — ${plan.hangFloorMv} мВ уже вешало эту частоту, а затравка `
      + 'попала бы на неё ОДНИМ прыжком, до всякой лестницы. Спуск идёт от стока',
      { seedMv: plan.seed?.seedMv ?? null, hangFloorMv: plan.hangFloorMv });
  }

  // ─── A RECORDED HANG IS THIS FREQUENCY'S EDGE, AND IT CLOSES THE FREQUENCY (`bugs/23`) ────────────
  //
  // The owner's word, obligation 1 of three (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»):
  //
  //   > *«Вердикт `ЗАВИС` — первого класса, наравне с `SDC` и `CRASH`. Он записывается в документ
  //   > кривой как причина, по которой точка встала на своё значение, а не как сбой прогона.»*
  //
  // Until this existed the verdict reached the journal and stopped there: the document's row for
  // 2842 MHz still read 1000 mV while twenty proven rungs and one located edge lived in a git-ignored
  // file. The closure runs through the SAME `refineEdge` an oracle failure uses, and that is the whole
  // design rather than a convenience:
  //
  //   · the hang is the failure's OUTER bracket, the deepest PASS is its inner one — exactly the
  //     shape refinement was written for, so the owner's «+10 mV over the failure» is applied by the
  //     one function that owns it (`marginAboveLastStableMv`), never by a second copy of the rule;
  //   · his other rule — *«найденный грубым шагом отказ ОБЯЗАН быть уточнён минимальным шагом,
  //     прежде чем к нему применят +10 мВ»* — is then obeyed for free: where the descent stopped one
  //     grid step above the hang there is nothing to refine and the margin is honest; where it
  //     stopped a coarse step above, refinement walks the grid points BETWEEN them, and the shipping
  //     voltage never lands on a rung nobody burned;
  //   · refinement CANNOT re-walk the hang: its bracket is strictly ABOVE `coarseFailMv`.
  //
  // And the witness distinguishes the two origins, because they are not the same evidence: an oracle
  // verdict is a measurement of numbers, a hang is a machine that stopped existing.
  const closeByHang = async () => {
    const hangMv = plan.hangFloorMv;
    if (lastPass === null) {
      out.halted = true;
      // The reason travels as a FIELD, never as a substring of the prose — the same rule the blocked
      // rung obeys: a report that reads its own sentence to decide goes silent the first time the
      // sentence is reworded. And the status line MUST NOT say «предел рычага» here (that lie about
      // what stopped a run is what the owner caught on 2026-08-17).
      out.hangFloorHalt = true;
      out.why = `ЗАВИСАНИЕ НА ${hangMv} мВ ЗАКРЫВАЕТ ПУТЬ ВНИЗ на ${frequencyMhz} МГц, а прошедшего напряжения `
        + 'выше него в этом прогоне НЕТ — уточнять не от чего, и отгрузку выдумывать нельзя. '
        + 'Это находка о кремнии, а не вердикт: край здесь мельче одной ступени политики от стока';
      return withDelivered();
    }
    const refined = await refineEdge({
      voltageGridMv, lastPassMv: lastPass, coarseFailMv: hangMv, minStepMv,
      runRungFn: (mv) => runRung({
        frequencyMhz, voltageMv: mv, depthMv: stockVoltageMv - mv, zoneStepMv: minStepMv, seeded: out.seeded,
        // The proven ground is the same one the descent carried — `lastPass` is non-null here by the
        // guard above, so there is nothing to fall back to and nothing to re-derive (one number, one
        // place, the rule `refineEdge`'s other call site already obeys).
        provenMv: lastPass, maxStepFromProvenMv: plan.cliffMv,
      }),
    });
    out.refinement = refined;
    for (const rr of refined.rungs ?? []) out.rungs.push({ ...rr, refine: true });
    if (!refined.ok) {
      out.halted = true;
      out.why = refined.why;
      return withDelivered();
    }
    out.verdict = 'edge-found';
    out.voltageMv = refined.shipMv;
    out.provenBy = (refined.reproduced
      ? `край ${refined.failMv} мВ — ВЕРДИКТ ОРАКУЛА, найденный между доказанным и ЗАВИСШИМ ${hangMv} мВ`
      : `край ${hangMv} мВ УСТАНОВЛЕН ЗАВИСАНИЕМ МАШИНЫ (перезагрузка; ступень названа журналом упреждающей `
        + 'записи, R15), а НЕ вердиктом оракула — на этой частоте край роняет драйвер, а чисел не портит')
      + ` · отгружается ${refined.shipMv} мВ = отказ + запас владельца`
      + (refined.resolutionMv !== null && refined.resolutionMv > minStepMv
        ? ` · разрешение карты здесь ${refined.resolutionMv} мВ`
        : '');
    out.why = `КРАЙ НАЙДЕН на ${frequencyMhz} МГц ПО ЗАПИСАННОМУ ЗАВИСАНИЮ (${hangMv} мВ): ${refined.why}`;
    say('hang-closed-edge', out.why, { frequencyMhz, hangFloorMv: hangMv, shipMv: refined.shipMv });
    return withDelivered();
  };

  // ---- 1. THE SEED — the owner's optimization, and its first burn is a PROOF rather than a formality.
  let lastPass = null;
  // Последняя ЗАКАЗАННАЯ ступень — то место, где спуск стоит (в отличие от `lastPass`, доказанной
  // земли). Пересчёт от неё отмеряет шаг зоны; разбор двух якорей — у самого пересчёта ниже.
  let lastOrderedMv = null;
  // ВСЕ напряжения, заказанные на этой частоте. Нужны ровно для одного — увидеть отсутствие
  // продвижения, дефект, живущий в ПОСЛЕДОВАТЕЛЬНОСТИ, а не в ступени (`bugs/42`).
  const orderedMvHere = new Set();
  // ⚠️ ПОЧЕМУ РАННИЙ ВЫХОД ОБЯЗАН НАЗЫВАТЬ СЕБЯ — `bugs/42`, найдено 2026-08-23 20:3x.
  //
  // Хвост §4 ниже открывается словами «ЛЕСТНИЦА КОНЧИЛАСЬ И НИЧЕГО НЕ ОТКАЗАЛО», и на этой посылке
  // он делает ОДНУ дорогую вещь: если план упирался в пол зависания, зовёт `closeByHang()`, то есть
  // УТОЧНЕНИЕ — ещё десяток заказов напряжения на карте владельца.
  //
  // Посылка неверна для каждого `break` из спуска: там лестница НЕ кончилась, мы ушли раньше. И для
  // выхода по «спуск не продвигается» это не мелочь, а прямое противоречие самому сторожу: он
  // объявил, что карта не отдаёт заказанное напряжение — а уточнение только и делает, что заказывает
  // напряжения и читает ответ. Замерено на фикстуре дрейфа: после срабатывания сторожа уточнение
  // прошло ЧЕТЫРНАДЦАТЬ ступеней и всё равно встало, потеряв частоту (`closed: 0`).
  //
  // Ранний выход поэтому оставляет своё имя, а §4 спрашивает его прежде, чем поверить своей посылке.
  let stoppedEarly = null;
  let seedTaken = false;
  const seed = plan.seed;
  if (plan.seedMv !== null) {
    // ⚠️ НАПРЯЖЕНИЕ ЗАТРАВКИ БЕРЁТСЯ ИЗ `plan.seedMv`, А НЕ ИЗ `plan.seed` (`bugs/32`).
    //
    // `plan.seed` — это СЫРОЙ ответ соседки. Решение о том, откуда начать спуск, план принимает сам:
    // глубочайшая из двух улик — собственной (журнал этой частоты) и соседкиной (`bugs/31`). Читая
    // `plan.seed.seedMv`, прогон переспрашивал уже решённое, и это была пара «истина↔зеркало» внутри
    // одной функции (EXP-0077). Цена, замеренная пробой 2026-08-23: план печатал 870 мВ, а прогон
    // заказывал соседкины 990 — то есть починка `bugs/31` не доезжала до карты ВОВСЕ, а сухой прогон
    // (документ разрешения на запись, рельс S2) обещал не то, что произойдёт — это `bugs/09`.
    // И второе лицо того же: без оттюненной соседки `plan.seed` равен `null`, а собственная улика
    // есть — развёртка падала `TypeError`-ом на первой же частоте полосы.
    const seedMv = plan.seedMv;
    out.seedFrom = seed;
    out.seedFromOwnEvidence = plan.seedFromOwnEvidence === true;
    // `frequencyMhz` is handed DOWN rather than known by the caller: naming the rung's frequency in
    // two places would be a truth↔mirror pair inside one function, and it hid a mutation — burning
    // the rung's lowest frequency instead of its highest reddened nothing, because the caller's
    // hard-coded clock kept the burn where it belonged while the decision moved.
    const sr = await runRung({
      frequencyMhz, voltageMv: seedMv, depthMv: stockVoltageMv - seedMv, zoneStepMv: null, seeded: true,
    });
    out.rungs.push({ voltageMv: seedMv, seed: true, outcome: sr?.outcome ?? null, verdict: sr?.verdict ?? null });
    const decision = seedOutcome({
      verdict: sr?.outcome === 'passed' ? sr?.verdict : null,
      seedMv, stockVoltageMv, neighbourMhz: seed?.neighbourMhz ?? null, frequencyMhz,
      fromOwnEvidence: plan.seedFromOwnEvidence === true,
    });
    if (decision.seeded) {
      out.seeded = true;
      seedTaken = true;
      lastPass = seedMv;
      say('seed-accepted', decision.note);
    } else {
      // E2-AC11: the rejection is a FINDING about the silicon, and it is counted as one. The seed is
      // never retried at this frequency — repeating a jump that was not safe is `bugs/03` with extra
      // steps.
      out.seedRejected = true;
      say('seed-rejected', decision.note, { seedMv, neighbourMhz: seed?.neighbourMhz ?? null });
    }
  }

  // ---- 2. THE LADDER — taken from the plan, in one of its two named forms. The zone a rung belongs
  // to is a property of how deep it is FROM STOCK, not of where the descent joined; that is why the
  // plan computes the ladder from stock and then cuts it at the seed rather than re-deriving it.
  if (plan.refused) {
    out.halted = true;
    out.why = `лестница спуска не построена: ${plan.why}`;
    return withDelivered();
  }
  const rungs = seedTaken ? plan.rungs : plan.rungsFromStock;
  const startMv = seedTaken ? plan.seedMv : stockVoltageMv;

  if (rungs.length === 0) {
    // A HANG got here first: the ladder has no rung because everything below us is at or under a
    // voltage that already killed this machine. That is the CARD's wall, not ours, so it must not
    // wear the lever's name (`bugs/23`).
    if (plan.stoppedByHang) return closeByHang();
    // Nothing below where we stand that the lever can still reach — OUR wall, never the silicon's.
    out.verdict = 'lever-limited';
    out.voltageMv = lastPass ?? stockVoltageMv;
    // Свидетель называет ИСТОЧНИК улики, а не «соседку» по умолчанию (`bugs/32`): затравка могла
    // прийти из собственного журнала этой частоты, и приписать её соседке значит завести в документ
    // ложную родословную числа.
    out.provenBy = lastPass === null
      ? null
      : `затравка ${lastPass} мВ ${out.seedFromOwnEvidence || !Number.isFinite(out.seedFrom?.neighbourMhz)
        ? 'из СОБСТВЕННОЙ улики этой частоты'
        : `от соседки ${out.seedFrom.neighbourMhz} МГц`} прошла, а глубже рычаг не достаёт`;
    out.why = `ПРЕДЕЛ РЫЧАГА на ${frequencyMhz} МГц: ${plan.why}`;
    return withDelivered();
  }

  // A seeded descent joins the ladder part-way down, so its first step is measured from the seed and
  // not from the ladder's own previous rung. It stays far inside the `bugs/03` governor by
  // arithmetic — the ladder's spacing is the policy step and the grid's local gap is at most 10 mV —
  // but «by arithmetic» is exactly the kind of argument R12 says to COMPUTE, so it is computed.
  const firstStep = startMv - rungs[0].mv;
  const cliff = plan.cliffMv;
  if (firstStep > cliff) {
    out.halted = true;
    out.why = `первый шаг спуска от ${startMv} мВ до ${rungs[0].mv} мВ это ${firstStep} мВ, а сторож обрыва `
      + `разрешает ${cliff} мВ (bugs/03). Спуск не начинается: обрыв, пройденный одним шагом, — тот же прыжок`;
    return withDelivered();
  }

  // ---- 3. THE DESCENT.
  // СЕТКА НАПРЯЖЕНИЙ КАРТЫ, ПО УБЫВАНИЮ — по ней пересчитывается цель, когда земля уехала.
  const gridDesc = [...new Set((voltageGridMv ?? []).filter(Number.isFinite))].sort((a, b) => b - a);

  for (const rung of rungs) {
    // ─── ЦЕЛЬ БЕРЁТСЯ ОТ ДОКАЗАННОГО, А НЕ ОТ ПЛАНА, КОГДА ЭТИ ДВА РАЗОШЛИСЬ ──────────────────────
    //
    // Лестница считается ОДИН РАЗ от стока — и это правильно, потому что иначе шаг мог бы углубиться
    // без спроса. Но доказанная земля ездит: карта регулярно отдаёт напряжение на ступень ВЫШЕ
    // заказанного (её таблица сползает по оси частот от нагрева), и тогда следующая плановая
    // ступень оказывается дальше от земли, чем разрешает `bugs/03`.
    //
    // Живой прогон 2026-08-16: на 2565 МГц заказали 900 мВ, карта дала 915 (промах вверх, принят —
    // доказано 915). Следующая плановая ступень 875 — это 40 мВ от 915 при стене 35, и прогон встал.
    // Плана никто не нарушал: 900 → 875 это ровно 25. Разошлись план и реальность.
    //
    // Слово владельца, которым это и лечится: *«Ты знаешь сетку напряжений видеокарты? Если знаешь,
    // то ты знаешь, какого размера ты шаг можешь сделать»*. Знаем — значит шагаем от земли ЕГО ЖЕ
    // лестницей (25 / 10 / 5 мВ по глубине от стока), а стена `bugs/03` стоит над этим шагом
    // ПОТОЛКОМ. Это НЕ ослабление: пересчёт может сделать шаг только КОРОЧЕ планового, никогда
    // длиннее.
    //
    // 🔴 ЗДЕСЬ СТОЯЛО «САМАЯ ГЛУБОКАЯ СТУПЕНЬ СЕТКИ В ПРЕДЕЛАХ СТЕНЫ», И ЭТО БЫЛ ВТОРОЙ ДЕФЕКТ
    // ВЕЧЕРА 2026-08-23 (`bugs/42`). Пересчёт МАКСИМИЗИРОВАЛ шаг до стены вместо того, чтобы
    // слушаться зоны: на карте владельца он выдал 30 мВ на глубине 110, где лестница говорит 10, и
    // владелец прочёл это с экрана сам. Стена отвечает на вопрос «насколько далеко ПОЗВОЛЕНО
    // прыгнуть в темноту», зона — на вопрос «насколько далеко мы СОБИРАЛИСЬ»; взять первое за второе
    // значит превратить сторожа в цель. Решение теперь ОДНО на оба места — `nextRungFrom`.
    const ground = lastPass ?? startMv;
    let targetMv = rung.mv;
    let rebased = false;
    if (ground - targetMv > cliff) {
      // ⚠️ THE REBASE PICKS A VOLTAGE THE LADDER NEVER PROPOSED — it reads the card's grid directly —
      // so it is the second place that could walk onto a recorded hang (`bugs/23`). It CANNOT, and the
      // reason is arithmetic rather than a guard: this branch runs only when `ground − rung.mv > cliff`,
      // i.e. the plan's rung lies BELOW the window, so the deepest point inside `[ground − cliff, ground)`
      // is strictly ABOVE `rung.mv` — and every ladder rung is already above the hang floor. The rebase
      // therefore only ever moves the target UP.
      //
      // A filter was written here first and then removed: it could not be made to go red by any
      // fixture, which is EXP-0073's class (a guard whose triggering condition no caller can supply).
      // What replaced it is the property itself, asserted end to end — «спуск НЕ ВОЗВРАЩАЕТСЯ на
      // убившую ступень» drives a descent whose ground DRIFTS UP, so the rebase fires twice under a
      // live floor, and mutation 68 reddens it.
      // ─── ДВА ЯКОРЯ, И ИХ НЕЛЬЗЯ ПУТАТЬ — ЭТО И ЕСТЬ СОДЕРЖАНИЕ ПОЧИНКИ ───────────────────────────
      //
      // ШАГ ЗОНЫ отмеряется от того места, где спуск СТОИТ, — от последней ЗАКАЗАННОЙ ступени. Он
      // отвечает на вопрос «насколько далеко шагаем В ТЕМНОТУ», а уже прожжённая ступень темнотой
      // не является: про неё всё известно.
      // СТЕНА `bugs/03` отмеряется от ДОКАЗАННОЙ земли и остаётся потолком суммарного шага. Она
      // отвечает на другой вопрос — «насколько далеко ПОЗВОЛЕНО уйти от того, что выдержало прожиг».
      //
      // 🔴 ПЕРВАЯ РЕДАКЦИЯ ЭТОЙ ПОЧИНКИ БРАЛА ОБА ОТ ЗЕМЛИ, и суд набора это поймал: на фикстуре
      // `bugs/23` земля стоит на стоке 1045 (карта отдала сток в ответ на заказ 1020), шаг зоны 25 от
      // земли снова указывал на 1020 — то есть пересчёт ПРЕДЛАГАЛ УЖЕ ПРОЖЖЁННУЮ СТУПЕНЬ, спуск
      // объявлял себя непродвигающимся и терял край, который прежде находил (970 мВ). Ошибка была не
      // в лестнице владельца, а в том, откуда её отмеряли.
      const standMv = Math.min(ground, lastOrderedMv ?? ground);
      const wallLeftMv = cliff - (ground - standMv);          // сколько стены ещё не израсходовано
      const pick = wallLeftMv <= 0 ? null
        : nextRungFrom({ gridDesc, currentMv: standMv, stockVoltageMv, zones, maxStepMv: wallLeftMv });
      if (pick === null) {
        // Сетка не предлагает НИ ОДНОЙ ступени между землёй и стеной — идти некуда, и это не отказ
        // карты, а конец пути на этой частоте. Закрывается тем, что уже доказано.
        say('rebase-exhausted', `${frequencyMhz} МГц: от доказанных ${ground} мВ сетка не даёт ни одной ступени `
          + `в пределах ${cliff} мВ — спуск здесь закончен`);
        stoppedEarly = 'rebase-exhausted';
        break;
      }
      targetMv = pick.mv;
      rebased = true;
      say('rebase', `${frequencyMhz} МГц: план звал на ${rung.mv} мВ, но доказано ${ground} мВ — это ${ground - rung.mv} мВ `
        + `при стене ${cliff}. Пересчитываю от доказанного по лестнице: ${targetMv} мВ `
        + `(шаг ${ground - targetMv} мВ при шаге зоны ${pick.zoneStepMv} мВ и стене ${cliff} мВ`
        + `${pick.forcedByGrid ? ', сетка вынудила глубже политики' : ''})`,
      { voltageMv: targetMv, stepMv: ground - targetMv, zoneStepMv: pick.zoneStepMv, forcedByGrid: pick.forcedByGrid });
    }
    // Ступень, которая не глубже уже доказанного, ничего не покупает — плановая цель осталась позади,
    // пока карта промахивалась вверх. Пропускаем молча: это не находка и не отказ.
    if (targetMv >= ground) continue;

    // ⚠️ СПУСК НИКОГДА НЕ ЗАКАЗЫВАЕТ ОДНО НАПРЯЖЕНИЕ ДВАЖДЫ — `bugs/42`.
    //
    // Вечером 2026-08-23 на карте владельца прогон повторял ОДНУ И ТУ ЖЕ ступень: заказ 885 мВ,
    // прогретая карта обслуживала 915, земля (самая глубокая ПРОШЕДШАЯ, `bugs/36`) застывала на 915,
    // стена 35 мВ от неё снова разрешала только 885 — и круг замыкался. Каждый оборот стоил ПОЛНОГО
    // ПРОЖИГА: карта грелась, документ не прирастал ни строкой, владелец в соседней комнате считал,
    // что идёт работа. Остановил её человек, а не машина.
    //
    // Ни один существующий сторож этого не ловил, и не мог: каждая отдельная ступень была ЗАКОННОЙ —
    // законный заказ, законная подстановка вверх, законный PASS, законная земля. Дефект жил не в
    // ступени, а в ПОСЛЕДОВАТЕЛЬНОСТИ.
    //
    // 🔴 ПРОВЕРКА СТОИТ ДО ПРОЖИГА, А НЕ ПОСЛЕ, И ЭТО НЕ ПЕРЕСТАНОВКА РАДИ КРАСОТЫ. Первая редакция
    // (коммит `70bf1a0`) сравнивала пару «заказ → выдача» ПОСЛЕ прожига, то есть констатировала уже
    // потраченную минуту на карте владельца. Повторный заказ не покупает знания ни при каком ответе
    // карты — значит его незачем прожигать, чтобы это выяснить. Сторож подешевел на один прожиг.
    //
    // ЗАКРЫВАЕТСЯ ЧАСТОТА, А НЕ ПОЛОСА — тем, что уже доказано. Карта, не отдающая заказанное
    // напряжение, это находка о кремнии (то же семейство, что «не отдаёт заказанную частоту», T6):
    // ронять из-за неё весь прогон значило бы терять работу, за которую уже заплачено прожигами.
    if (orderedMvHere.has(targetMv)) {
      // Поля рядом с текстом — по образцу соседних событий (`seed-rejected`): сторож обязан быть
      // проверяем МАШИНОЙ, а не разбором прозы. Именно на них стоит красный блок набора.
      say('no-progress', `${frequencyMhz} МГц: ступень ${targetMv} мВ заказывается ВТОРОЙ РАЗ — спуск не `
        + 'продвигается. Прожиг не запускается: повторный заказ не покупает знания ни при каком ответе карты. '
        + 'Частота закрывается тем, что доказано (bugs/42)',
      { voltageMv: targetMv });
      stoppedEarly = 'no-progress';
      break;
    }
    orderedMvHere.add(targetMv);
    lastOrderedMv = targetMv;

    const r = await runRung({
      frequencyMhz, voltageMv: targetMv, depthMv: stockVoltageMv - targetMv,
      zoneStepMv: rung.zoneStepMv, seeded: out.seeded, rebased,
      // THE PROVEN GROUND, HANDED DOWN (`interviews/009`). `lastPass` is the deepest voltage this
      // frequency has actually SURVIVED; before the first PASS it is the descent's start — stock, or
      // the seed, which the neighbour above already proved. The wall is the same `bugs/03` cliff the
      // plan applied to the ordered step, so the ordered and the delivered step are judged by ONE
      // number and cannot drift apart.
      provenMv: lastPass ?? startMv,
      maxStepFromProvenMv: cliff,
    });
    // THE DELIVERED VOLTAGE IS THE MEASUREMENT — the owner's rule on this axis too. `rung.mv` is what
    // we ASKED for; `r.measuredMv` is what the card actually served and therefore what was burned.
    // Carrying the asked-for value forward would put a voltage nobody proved into the document, and
    // would seed the neighbour below from a number that never existed.
    const provedMv = Number.isFinite(r?.measuredMv) ? r.measuredMv : targetMv;

    out.rungs.push({
      // `orderedMv` — то, что ЗАКАЗАЛИ на самом деле (после пересчёта от земли), а не то, что стояло
      // в плане: улика обязана описывать прогон, а не намерение, от которого он отступил.
      voltageMv: provedMv, orderedMv: targetMv, plannedMv: rung.mv, rebased, seed: false,
      outcome: r?.outcome ?? null, verdict: r?.verdict ?? null,
    });

    // ⚠️ ЗЕМЛЯ — САМАЯ ГЛУБОКАЯ ПРОШЕДШАЯ СТУПЕНЬ, А НЕ ПОСЛЕДНЯЯ (`bugs/36`).
    //
    // Здесь стояло `lastPass = provedMv`, то есть ПОСЛЕДНЯЯ, — хотя комментарий выше, у передачи
    // земли в ступень, всё это время утверждал «самое глубокое напряжение, которое частота
    // пережила». Пока карта холодная, они совпадают и разницы не существует. Прогретая разводит:
    // ось частот сползает с нагревом (≈1,7 МГц на градус, R14b), заказ 860 мВ обслуживается уже
    // 915 мВ, замер честен — но земля ПОДНИМАЕТСЯ на 915 и забывает, что 865 уже прошли.
    //
    // Цена, замеренная на живом прогоне 2026-08-23: 2820 МГц прошла 865 мВ первой же ступенью, затем
    // из-за дрейфа земля уехала на 915, и попадание точно в цель (875 → 875) было объявлено прыжком
    // в 40 мВ при стене 35. Прогон встал, покрытие 0 из 17.
    //
    // ПОЧЕМУ ЭТО НЕ ПОСЛАБЛЕНИЕ СТЕНЫ. `bugs/03` бьёт по размеру шага В НЕИЗВЕСТНОЕ. Самая глубокая
    // прошедшая ступень и есть граница известного: ниже неё темно, выше — доказано прожигом сегодня.
    // Анкер на завышенной опоре делает стену формально уже, но ценой ложных остановок на территории,
    // за которую уже заплачено. Формулировка `interviews/009` — «глубина от ДОКАЗАННОГО» — про это.
    if (r?.outcome === 'passed') { lastPass = Math.min(lastPass ?? Infinity, provedMv); continue; }

    if (r?.outcome === 'failed') {
      // A COARSE failure is a SIGNAL, never the edge — the owner's rule, said three times. §4.6 walks
      // back to the last PASS and re-finds it at the card's own step; only THAT failure gets the margin.
      if (lastPass === null) {
        out.halted = true;
        out.why = `ОТКАЗ НА ПЕРВОЙ ЖЕ СТУПЕНИ ${targetMv} мВ на ${frequencyMhz} МГц, а прошедшего напряжения `
          + 'ещё нет — уточнять не от чего. Край здесь ниже стока меньше, чем на один шаг политики, и это находка, а не вердикт';
        return withDelivered();
      }
      const refined = await refineEdge({
        voltageGridMv, lastPassMv: lastPass, coarseFailMv: targetMv, minStepMv, runRungFn: (mv) => runRung({
          frequencyMhz, voltageMv: mv, depthMv: stockVoltageMv - mv, zoneStepMv: minStepMv, seeded: out.seeded,
          // Refinement walks back UP from the coarse failure toward `lastPass`, so the proven ground is
          // the same one the descent had — and it must not be re-derived here (one number, one place).
          provenMv: lastPass ?? startMv,
          maxStepFromProvenMv: cliff,
        }),
      });
      out.refinement = refined;
      for (const rr of refined.rungs ?? []) out.rungs.push({ ...rr, refine: true });
      if (!refined.ok) {
        out.halted = true;
        out.why = refined.why;
        return withDelivered();
      }
      out.verdict = 'edge-found';
      out.voltageMv = refined.shipMv;
      out.provenBy = `край ${refined.failMv} мВ${refined.reproduced ? '' : ' (грубый, на мелких ступенях не воспроизведён)'}`
        + ` · отгружается ${refined.shipMv} мВ = отказ + запас владельца`
        + (refined.resolutionMv !== null && refined.resolutionMv > minStepMv
          ? ` · разрешение карты здесь ${refined.resolutionMv} мВ, шага ${minStepMv} мВ у неё нет`
          : '')
        // ФОРМА ПРОЖИГА БЕРЁТСЯ ИЗ ТОГО, ЧТО РЕАЛЬНО РЕШИЛО ИСХОД, а не из умолчания модуля. Строка
        // `provenBy` — это подпись под измерением, и подпись, называющая форму, которой прогон не
        // пользовался, есть пара «правда ↔ зеркало» в самом документе кривой. Она бы и разошлась:
        // 2026-08-22 развёртка переехала на `furnace` с лестницей интенсивности, а этот литерал
        // остался бы обещать `sdc_fma/transient` (EXP-0077).
        + ` · прожиг ${config.SWEEP_PROBE_SECONDS ?? 10} с формой `
        + `${(refined.rungs ?? []).map((rr) => rr.decidedBy).filter(Boolean).at(-1)
             ?? SHORT_PROBE[0]?.id ?? 'форма не названа'}`;
      out.why = `КРАЙ НАЙДЕН на ${frequencyMhz} МГц: ${refined.why}`;
      return withDelivered();
    }

    if (r?.outcome === 'lever-limited') {
      out.verdict = 'lever-limited';
      out.voltageMv = lastPass ?? stockVoltageMv;
      out.provenBy = lastPass === null ? null : `глубже ${lastPass} мВ рычаг ±1000 МГц не достаёт`;
      out.why = `ПРЕДЕЛ РЫЧАГА на ${frequencyMhz} МГц: ${r.why}`;
      return withDelivered();
    }

    // `unknown`, `void`, `refused` — a STOP, and each keeps its own word.
    out.halted = true;
    // The journal's two-hangs stop travels as a FIELD (`blocked`), never as a substring of the
    // message: F2-AC5 demands the sweep exit non-zero and NAME the rung, and a report that reads its
    // own prose to decide would go silent the first time the sentence is reworded.
    if (r?.blocked === true) out.blocked = true;
    out.why = `РАЗВЁРТКА ОСТАНОВЛЕНА на ${frequencyMhz} МГц / ${rung.mv} мВ, исход «${r?.outcome ?? 'нет ответа'}»: ${r?.why ?? ''}`;
    return withDelivered();
  }

  // ---- 4. THE LADDER RAN OUT AND NOTHING FAILED **IN THIS RUN** — but a previous run's REBOOT may be
  // exactly what the ladder stopped against, and that is a measurement, not our wall (`bugs/23`).
  //
  // ⚠️ ОДИН РАННИЙ ВЫХОД ОТМЕНЯЕТ УТОЧНЕНИЕ, И ТОЛЬКО ОДИН (`bugs/42`). Уточнение — это ещё десяток
  // ЗАКАЗОВ напряжения на карте владельца. После «спуск не продвигается» звать его нельзя по
  // существу: сторож только что установил, что карта заказы НЕ ИСПОЛНЯЕТ, а уточнение ровно тем и
  // занято, что заказывает и читает ответ. Замер на фикстуре дрейфа: без этого вопроса уточнение
  // проходило 14 ступеней и всё равно теряло частоту (`closed: 0`); с ним — 3 ступени и частота
  // закрыта.
  //
  // 🔴 И ГРАНИЦА СУЖЕНА ПОСЛЕ КРАСНОГО, А НЕ УГАДАНА. Первая редакция отменяла уточнение при ЛЮБОМ
  // раннем выходе — и покрасила блок R18 «ЗАВИСАНИЕ ЗАКРЫВАЕТ ЧАСТОТУ КРАЕМ»: при `rebase-exhausted`
  // спуск встаёт нашей стеной, записанное зависание под ним остаётся ВНЕШНЕЙ скобкой края, и
  // закрывать частоту краем там правильно (R18). То есть сторож краснел на законном состоянии
  // машинерии, которую защищает, — ловушка, которую канон называет трижды (R12 · R13 · R17).
  if (plan.stoppedByHang && stoppedEarly !== 'no-progress') return closeByHang();

  // Our lever or the card's grid stopped the descent, not the silicon — and calling that an edge is
  // the false `[TESTED]` E2-AC2 exists to forbid.
  out.verdict = 'lever-limited';
  out.voltageMv = lastPass ?? stockVoltageMv;
  out.stoppedEarly = stoppedEarly;
  // 🟡 ЧЕСТНАЯ ГРАНИЦА, НАЗВАННАЯ ВСЛУХ, А НЕ ЗАМАЗАННАЯ. Ранний выход по «карта не отдаёт
  // заказанное напряжение» — это НЕ предел нашего рычага, а находка о кремнии, и словаря для неё в
  // документе кривой пока нет: `stop:*` закрыт пятью значениями (R14d), и расширять его — правка
  // канона владельца, а не решение агента (`PHILOSOPHY.md` → три двери). Пока причина называется в
  // `why` и в `provenBy`, а вопрос о своём теге вынесен владельцу (`bugs/42`).
  const earlyWhy = stoppedEarly === 'no-progress'
    ? `КАРТА НЕ ОТДАЁТ ЗАКАЗАННОЕ НАПРЯЖЕНИЕ на ${frequencyMhz} МГц: спуск повторил ступень и получил тот же `
      + 'ответ, поэтому закрыт тем, что доказано. Это находка о кремнии, а НЕ предел рычага'
    : `СЕТКА КОНЧИЛАСЬ на ${frequencyMhz} МГц: от доказанного не осталось ни одной ступени в пределах стены`;
  out.provenBy = lastPass === null ? null
    : `${lastPass} мВ прошло на ${frequencyMhz} МГц, а глубже спускаться нечем: `
      + `${stoppedEarly === null ? plan.why : earlyWhy}`;
  out.why = stoppedEarly === null
    ? `ПРЕДЕЛ РЫЧАГА на ${frequencyMhz} МГц: все ${rungs.length} ступен(и) прошли, отказа нет. ${plan.why}`
    : earlyWhy;
  return withDelivered();
}

/**
 * WHICH ROW OF THE CURVE DOCUMENT A DELIVERED CLOCK BELONGS TO.
 *
 * The owner's rule (`GOAL.md` → «🎚 ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ») keys a measurement by the frequency
 * the card actually ran. That number comes off `clocks.gr`, which reports on the card's own ladder —
 * the same ladder the document's 389 rows are built from — so in the normal case it lands exactly on
 * a row. This function exists for the two cases that are not normal, and it refuses to invent in both:
 *
 *   • **No delivered clock at all** (no sampler, no loaded samples, a lock proof that never ran).
 *     REFUSED. There is no honest row for a measurement whose frequency nobody observed, and falling
 *     back to the ordered clock would restore the exact claim the owner's rule removes.
 *   • **A clock between two rows.** Snapped DOWNWARD, and the snap is SAID. Downward is the safe
 *     direction and it is the project's existing one: Vmin does not decrease with frequency, so a
 *     voltage proved at the higher clock is not optimistic at the lower one — the same argument
 *     `rungGroups` inheritance already rests on (E2-AC3). Upward would be a claim about silicon that
 *     was never loaded.
 *
 * @returns {{ok:boolean, mhz:number|null, snapped:boolean, why:string}}
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export function resolveDeliveredRow(doc, deliveredMhz) {
  if (!Number.isFinite(deliveredMhz) || deliveredMhz <= 0) {
    return {
      ok: false,
      mhz: null,
      snapped: false,
      why: 'выданная частота не прочитана (сэмплер не дал проб под нагрузкой, либо доказательство '
        + 'потолка не отработало) — строку выбрать не по чему',
    };
  }
  const rows = (doc?.frequencies ?? []).map((r) => r?.mhz).filter(Number.isFinite);
  if (!rows.length) return { ok: false, mhz: null, snapped: false, why: 'в документе кривой нет ни одной частоты' };
  if (rows.includes(deliveredMhz)) return { ok: true, mhz: deliveredMhz, snapped: false, why: 'выданная частота есть в документе' };
  const below = rows.filter((m) => m < deliveredMhz);
  if (!below.length) {
    return {
      ok: false,
      mhz: null,
      snapped: false,
      why: `выданные ${deliveredMhz} МГц ниже самой нижней частоты документа ${Math.min(...rows)} МГц — притягивать некуда`,
    };
  }
  const snappedMhz = Math.max(...below);
  return {
    ok: true,
    mhz: snappedMhz,
    snapped: true,
    why: `выданных ${deliveredMhz} МГц в документе нет; притянуто ВНИЗ к ${snappedMhz} МГц — безопасная сторона`,
  };
}

/**
 * THE SWEEP — the loop `plans/15` §4.5 asks for, and the first thing in this project that writes the
 * owner's tuning-curve document.
 *
 * ─── WHAT IT COMPOSES, AND WHY NONE OF IT IS RE-IMPLEMENTED HERE ──────────────────────────────────
 *
 *   `rungGroups`     which frequencies are BURNED and which INHERIT (E2-AC3)
 *   `seedFor` /      where a descent starts, and what a rejected seed means (§4.2, E2-AC11)
 *   `seedOutcome`
 *   `descentLadder`  the owner's 25 / 10 / 5 mV policy on the card's real grid (§4.1)
 *   `runRung`        one rung, live, with the journal and the watchdog inside it (§4.3, §4.4)
 *   `refineEdge`     a coarse failure re-found at the card's own step (§4.6)
 *   `closePoint`     the document's ONLY author (R14a), inheritance and the ratchet included
 *
 * ─── THE THREE THINGS THIS FUNCTION ITSELF OWNS ───────────────────────────────────────────────────
 *
 * **(1) `watchdog --recover`, ONCE.** It is an action on the whole sweep rather than on a rung — the
 * atom already runs its own preflight recovery every time (`vf-step.runStep` step 1), and a second
 * per-rung copy would be two recoveries that could disagree. A record found at rest means a previous
 * run died holding the card, and no new work begins on a state nobody can describe.
 *
 * **(2) The blocked-rung set, computed ONCE** from `sweep-journal.resumeState`. Within one process a
 * rung can hang at most once — the hang ends the process — so re-reading the journal per rung would
 * cost a file read and buy nothing (§4.4).
 *
 * **(3) The document is saved BEFORE the next frequency starts**, atomically, and it is VALIDATED
 * first. A document that fails its own validator never reaches the disk: the next session would trust
 * it, and «the machine died mid-save» is a case this project handles rather than hopes to avoid
 * (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»).
 *
 * @param {object}   a
 * @param {object}   a.curveDoc     the tuning-curve document — read AND written
 * @param {Array}    a.points       the card's live V/F table
 * @param {function} a.runStepFn    the atom. REQUIRED — this module never writes to the card (R1)
 * @param {object}   [a.journal]    the write-ahead journal; `null` runs journal-less (fixtures only)
 * @param {function} [a.recover]    `watchdog --recover`; called once, before any rung
 * @param {function} [a.saveFn]     how the document is persisted; injected offline
 * @returns {Promise<object>} the report E2-AC2 is counted from
 *
 * [TESTED: 2026-08-16 00:3x, OFFLINE · 9 blocks on an injected atom and an injected save, plus the
 *  trap suite driving it over five bench cards (`npm run traps`, 28 assertions, 0 pending). Proved:
 *  the whole band closes and the coverage is COUNTED; the document is saved before the next rung
 *  starts; a document failing its own validator never reaches the disk; `recover` runs once and
 *  before any rung; two consecutive hangs stop the sweep and the card is not touched a third time.
 *  Mutations 54, 55, 58, 59, 63 each redden their own blocks. **NOT TESTED: the LIVE wiring in
 *  `mainSweep` — real NVAPI, a real watchdog, a real card — has never run.**]
 */
export async function sweepRange({
  curveDoc = null,
  points = [],
  fromMhz = null,
  toMhz = null,
  bandLabel = null,
  runStepFn,
  journal = null,
  recover = null,
  saveFn = null,
  canPin = true,
  pinCard = null,
  seconds = config.SWEEP_PROBE_SECONDS ?? 10,
  sustain = config.SWEEP_PROBE_SECONDS ?? 10,
  minStepMv = config.VOLTAGE_GRID_STEP_MV ?? 5,
  // THE OPERATOR'S CEILING ON DEPTH FOR THIS SITTING — `null` means «only the lever stops us».
  depthCapMv = null,
  // THE WRITE SHAPE — flattened curve by default, clock lock on request. `researches/11`.
  //
  // ⚠️ THIS DEFAULT IS THE ONE THAT DECIDES, and it must equal `sweepDryRun`'s. It did not for one
  // commit: `runRung` and `sweepDryRun` moved to `false` while THIS line stayed `true` and passed its
  // value down, overriding the atom's. The live run of 2026-08-16 11:56 therefore locked the clock
  // while the dry run the operator had read a minute earlier promised the curve — `bugs/14` defect 3.
  demandPin = false,
  // The card's own maximum graphics clock (`frequency-grid.maxGraphicsMhz`) — the ceiling the locked
  // shape writes, so no raised point can offer above the envelope (R13, `bugs/11`).
  envelopeMhz = null,
  buildVector = null,
  chooseShape = chooseWriteShape,
  // RE-READ THE CARD'S TABLE BEFORE EACH RUNG — injected, because this module never calls the card
  // itself (R16a: the sweep composes, it does not touch hardware). `null` keeps the old behaviour of
  // planning every rung against the table read once at the start.
  readPointsFn = null,
  now = null,
  clockMs = () => Date.now(),
  onEvent = null,
  // ЛЕСТНИЦА ИНТЕНСИВНОСТИ, СИЛЬНЕЙШИЙ НАБОР ПЕРВЫМ (слово владельца 2026-08-22: прожиг обязан
  // идти на настраиваемой частоте). `null` — прежнее поведение: одна попытка формой по умолчанию.
  shapeLadder = null,
  estimateHours = 1.7,
} = {}) {
  if (typeof runStepFn !== 'function') {
    throw new Error('sweepRange требует runStepFn — движок сам в карту не пишет (правило R1)');
  }
  if (!curveDoc || !Array.isArray(curveDoc.frequencies) || curveDoc.frequencies.length === 0) {
    throw new Error('sweepRange требует документ кривой: развёртка пишет в него, а не в память процесса');
  }
  const say = (kind, text, extra = {}) => { if (onEvent) onEvent({ kind, text, ...extra }); };
  const startedMs = clockMs();

  // ---- (1) THE CARD IS DESCRIBABLE BEFORE ANY WORK BEGINS.
  let recovered = null;
  if (typeof recover === 'function') {
    recovered = await recover();
    if (recovered && recovered.ok === false) {
      return {
        ok: false, stoppedBy: 'recover',
        why: `ПОДБОР ЗАБЫТОЙ ЗАПИСИ НЕ УДАЛСЯ: ${recovered.why ?? 'без причины'}. Развёртка не начинается на карте, `
          + 'состояние которой никто не может назвать',
        groups: [], closed: 0, doc: curveDoc, hung: [], blocked: [], seedRejections: 0, verdicts: {}, elapsedMs: 0,
      };
    }
    if (recovered?.recovered) say('recovered', `подобрана забытая запись предыдущего прогона: ${recovered.why ?? ''}`);
  }

  // ---- (2) WHAT THE LAST LAUNCH LEFT BEHIND. A hang that killed the previous process left an intent
  // nobody closed, and closing it here is what turns the owner's accepted risk into a measurement.
  let resume = { hung: [], blocked: [], nextSeq: 1, truncated: 0 };
  if (journal) {
    resume = resumeState(journal, { at: now ? now() : null });
    for (const h of resume.hung) say('hang-attributed', h.why ?? `ЗАВИС: ${h.frequencyMhz} МГц / ${h.voltageMv} мВ`, h);
  }
  const blockedKeys = new Set((resume.blocked ?? []).map((b) => b.key));
  // ─── WHAT ALREADY HUNG THIS MACHINE, READ ONCE AND SAID OUT LOUD (`bugs/23`) ─────────────────────
  //
  // `blockedKeys` above and these floors answer DIFFERENT questions, and keeping both is the point:
  // the blocked set stops a rung that hangs UNPREDICTABLY (two in a row = a fault, the owner's single
  // emergency brake, untouched here). The floor stops us from CHOOSING to revisit a rung already
  // proven fatal — which the brake by construction cannot do, because it must reach the second hang
  // first. He accepted walking into an unknown edge; he never accepted walking into a known one.
  const hangFloorsByMhz = resume.floors instanceof Map ? resume.floors : new Map();
  for (const [mhz, f] of hangFloorsByMhz) {
    say('hang-floor', `ПОЛ ЗАВИСАНИЯ: ${mhz} МГц уже вешала машину на ${f.voltageMv} мВ — спуск туда больше `
      + 'не идёт, и это напряжение становится КРАЕМ частоты, а не пропущенной ступенью',
      { frequencyMhz: mhz, voltageMv: f.voltageMv, at: f.at ?? null });
  }
  let seq = resume.nextSeq ?? 1;

  const groups = rungGroups({ rows: curveDoc.frequencies, fromMhz, toMhz });
  const voltageGridMv = curveDoc.voltageGridMv ?? [];
  const report = {
    ok: true,
    stoppedBy: null,
    why: '',
    bandLabel,
    groups: [],
    groupCount: groups.length,
    frequenciesInBand: groups.reduce((n, g) => n + g.count, 0),
    closed: 0,
    verdicts: { 'edge-found': 0, 'lever-limited': 0 },
    seedRejections: 0,
    // WHERE THE ORDER AND THE OBSERVATION PARTED — one entry per frequency whose measurement landed in
    // a DIFFERENT row from the one asked for. Counted rather than smoothed over: under the owner's
    // rule the card decides the coverage, and a run that hid that would look like it swept the band
    // it named (`GOAL.md` → «🎚 ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ», consequence 2).
    delivered: [],
    raised: [],
    // ЧАСТОТЫ, ПРОПУЩЕННЫЕ ПОТОМУ ЧТО ИХ КРАЙ УЖЕ ЗАЖАТ ЖУРНАЛОМ (`bugs/31`). Считаются, а не
    // умалчиваются: пропуск это не покрытие, и следующая сессия обязана видеть, какие строки ждут
    // закрытия скриптом.
    preBracketed: [],
    hung: resume.hung ?? [],
    blocked: resume.blocked ?? [],
    // Every floor this journal knows, in the report so it lands in the run's own summary rather than
    // only in the event stream a watcher may not have been open for.
    hangFloors: [...hangFloorsByMhz].map(([mhz, f]) => ({ frequencyMhz: mhz, voltageMv: f.voltageMv })),
    doc: curveDoc,
    elapsedMs: 0,
    estimateHours,
  };

  let doc = curveDoc;

  // WHAT THE BAND IS, SAID ONCE AND UP FRONT (`plans/20` §4.2). A watcher cannot show «настроено 7 из
  // 43» without the 43, and deriving it a second time outside this function would be a truth↔mirror
  // pair over the very number the sweep's own coverage is counted from (R16c's lesson, cheaply).
  say('band', `полоса ${fromMhz ?? '—'}…${toMhz ?? '—'} МГц: частот ${report.frequenciesInBand}, прожигов ${groups.length}`
    + (Number.isFinite(depthCapMv) ? ` · ПОТОЛОК ГЛУБИНЫ ${depthCapMv} мВ от стока — условие этого прогона` : ''),
    {
      fromMhz, toMhz, groupCount: groups.length, frequenciesInBand: report.frequenciesInBand,
      depthCapMv: Number.isFinite(depthCapMv) ? depthCapMv : null,
    });

  // ─── ЧТО ЧАСТОТА УЖЕ ДОКАЗАЛА (`bugs/31`) ───────────────────────────────────────────────────────
  //
  // Зеркало полов зависания. Журнал знает не только чем частота убилась, но и на чём выстояла; до
  // `provenRungs` вторую половину не читал никто, и возобновлённая частота жгла заново всё, что уже
  // прошла. Владелец, глядя на это: «край найден у точки, какого хуя вновь с неё начинать».
  //
  // Здесь используется САМАЯ ОСТОРОЖНАЯ половина лечения: если обе скобки края уже стоят и между
  // ними на сетке карты не осталось непроверенных ступеней — жечь нечего, и частота ПРОПУСКАЕТСЯ.
  // Запись такой строки в документ делает `tools/close-bracketed-edges.mjs`: у неё другой вопрос о
  // том, какой частоте принадлежит улика (журнал ключуется ЗАКАЗАННОЙ частотой), и решать его внутри
  // прогона, который пишет в карту, — отдельная работа с отдельными сторожами (`plans/25` шаг 1.4a).
  const provenByMhz = resume.proven instanceof Map ? resume.proven : new Map();
  const gridMv = Array.isArray(curveDoc.voltageGridMv) ? [...curveDoc.voltageGridMv].sort((a, b) => a - b) : [];
  const bracketedEdge = (mhz) => {
    const pass = provenByMhz.get(mhz);
    const floor = hangFloorsByMhz.get(mhz);
    if (!pass || !floor) return null;
    if (!(floor.voltageMv < pass.voltageMv)) return null;
    // Грубая скобка — НЕ край: между стеной и прошедшей ступенью остались ступени, которых никто не
    // жёг, и правило владельца требует уточнить отказ минимальным шагом до применения запаса
    // (`GOAL.md` → «ЛЕСТНИЦА ШАГОВ СПУСКА» п. 3). Такую частоту прогон обязан пройти.
    const between = gridMv.filter((v) => v > floor.voltageMv && v < pass.voltageMv);
    return between.length ? null : { pass, floor };
  };

  for (const g of groups) {
    const already = bracketedEdge(g.topMhz);
    if (already) {
      report.preBracketed.push({
        frequencyMhz: g.topMhz,
        passedMv: already.pass.voltageMv,
        hungMv: already.floor.voltageMv,
      });
      say('pre-bracketed',
        `${g.topMhz} МГц ПРОПУЩЕНА: край уже зажат журналом — прошло ${already.pass.voltageMv} мВ, `
        + `повесило ${already.floor.voltageMv} мВ, непроверенных ступеней между ними нет. Жечь нечего; `
        + 'строку закрывает `node tools/close-bracketed-edges.mjs --apply`',
        { frequencyMhz: g.topMhz, passedMv: already.pass.voltageMv, hungMv: already.floor.voltageMv });
      continue;
    }
    // The lever's reach at THIS frequency — the wall that produces `lever-limited`, read off the
    // card's own table rather than assumed. 45 mV at 1700 MHz against 245 at 2842 is a measurement.
    const floorMv = leverFloorFor(g.topMhz, points);
    const availableDepthMv = Number.isFinite(floorMv) ? g.stockVoltageMv - floorMv : 0;

    const outcome = await sweepFrequency({
      frequencyMhz: g.topMhz,
      stockVoltageMv: g.stockVoltageMv,
      voltageGridMv,
      availableDepthMv,
      depthCapMv,
      // The floor is keyed by the ORDERED frequency, which is what the journal's intent records —
      // the same coordinate the descent orders in. Where the measurement finally LANDS is a different
      // question, answered downstream by the delivered clock (`resolveDeliveredRow`).
      hangFloorMv: hangFloorsByMhz.get(g.topMhz)?.voltageMv ?? null,
      // Собственная улика этой частоты — по тому же ключу и по той же причине (`bugs/31`).
      provenPassMv: provenByMhz.get(g.topMhz)?.voltageMv ?? null,
      curveDoc: doc,
      minStepMv,
      onEvent,
      shapeLadder,
      // ⚠️ АРГУМЕНТЫ ПРОБРАСЫВАЮТСЯ ЦЕЛИКОМ (`rungArgs`), А НЕ ПЕРЕПИСЫВАЮТСЯ ПО ИМЕНАМ.
      // Первая редакция этой обёртки разбирала пять полей и звала `runRung` со СВОИМ списком — то
      // есть была парой «правда ↔ зеркало» между тем, что `sweepFrequency` отдаёт, и тем, что
      // ступень получает. Пара немедленно разошлась: добавленные `provenMv` / `maxStepFromProvenMv`
      // (`interviews/009`) до ступени НЕ доезжали, и сторож глубины в живой развёртке был бы мёртв,
      // оставаясь зелёным во всех наборах. Нашла это мутация «развёртка перестала передавать
      // доказанную землю», которая не покраснила НИЧЕГО — EXP-0073.
      // Пара, которую можно УБРАТЬ, лучше пары, за которой надо следить: теперь новое поле у
      // источника доезжает само, а не ждёт, пока кто-то вспомнит про второй список.
      runRungFn: async (rungArgs) => {
        const { frequencyMhz, voltageMv, depthMv, zoneStepMv, seeded } = rungArgs;
        // THE RUNG IS ANNOUNCED BEFORE THE CARD IS TOUCHED (`ideas/06` §3, `plans/20` §4.2). A frozen
        // screen shows the LAST thing drawn, so a rung published after its own burn would make the
        // frozen frame accuse the PREVIOUS rung — the exact misattribution the write-ahead journal
        // exists to prevent (§4.4). The screen is the fast signal, the journal is still the record.
        // ⚠️ «ГЛУБИНА ОТ СТОКА», А НЕ «ШАГ» — И ЭТО НАЗВАНО ЦЕЛИКОМ ПО СЛОВУ ВЛАДЕЛЬЦА
        // 2026-08-23: строка `2700 МГц ← 885 мВ (глубина −110 мВ)` прочиталась им как ШАГ в 110 мВ
        // («какой-то бред! Такого шага не может быть!»), и он прав — на этом месте глаз ищет размер
        // шага, потому что именно шаг решает, поймаем мы вердикт или повесим машину (`bugs/03`).
        // Подпись была формально верной и всё равно ввела в заблуждение, поэтому теперь строка несёт
        // ОБЕ величины и говорит, от чего каждая отсчитана.
        say('rung-start', `${frequencyMhz} МГц ← ${voltageMv} мВ (глубина ОТ СТОКА −${depthMv} мВ`
          + `${Number.isFinite(zoneStepMv) ? `, шаг зоны ${zoneStepMv} мВ` : ''})`,
          { frequencyMhz, voltageMv, depthMv, zoneStepMv, seeded });

        // ─── THE TABLE IS RE-READ BEFORE THIS RUNG, AND THAT IS THE FIX FOR THE 2026-08-16 STALL ────
        //
        // The factory table slides along the FREQUENCY axis as the card warms (≈ −1.7 MHz/°C, R14b);
        // the VOLTAGE axis stands still. Planning every rung against the table read once, cold, at
        // the start of a run that then heats the card for twelve minutes means the offset we compute
        // stops producing the voltage we intended: measured live, the drift reached ONE grid step
        // after five minutes and TWO after twelve, at which point the run stopped itself.
        //
        // ⚠️ WHAT IS RE-READ AND WHAT IS NOT, because the difference is the safety of this change:
        //   · RE-READ — the table, i.e. only «which offset makes this clock land on this voltage».
        //   · NOT re-read — the LADDER of target voltages and their depths from stock. Those are
        //     computed once per frequency, so the `bugs/03` governors (first step ≤ 25 mV, gap ≤ 35)
        //     keep judging a stable sequence. A ladder that moved with the table could deepen a step
        //     without anyone asking, and a deepened step is how this project hung the machine twice.
        //   · NOT re-read — `pinCard` (the clock ladder). That one spawns `nvidia-smi`, and doing it
        //     per rung is what turned a healthy sixth rung into НЕИЗВЕСТНО on the first live sweep.
        //     Reading the V/F table is an in-process NVAPI call: a different mechanism entirely.
        let livePoints = points;
        if (readPointsFn) {
          let fresh = null;
          try { fresh = await readPointsFn(); } catch { fresh = null; }
          // A rung planned on a table nobody could read is a rung nobody can describe. The old table
          // is NOT a fallback — using it is the very defect this seam exists to remove — so an
          // unreadable table is НЕИЗВЕСТНО, which in this project is a STOP and never progress.
          if (!Array.isArray(fresh) || fresh.length !== points.length) {
            const why = 'ТАБЛИЦА КАРТЫ НЕ ПЕРЕЧИТАНА перед ступенью '
              + `${frequencyMhz} МГц / ${voltageMv} мВ (получено ${Array.isArray(fresh) ? `${fresh.length} записей вместо ${points.length}` : 'ничего'}). `
              + 'Планировать по старой таблице значило бы вернуть ровно тот дрейф, ради которого она перечитывается. Это СТОП';
            say('rung', why, { frequencyMhz, voltageMv, outcome: 'unknown' });
            return { outcome: 'unknown', why, cardTouched: false, verdict: null };
          }
          // `fresh?.` and not `fresh.` — EXP-0075, now for the sixth time: a mutation that removes
          // the guard above must REDDEN the block that watches it, not kill the whole suite by
          // dereferencing exactly what the mutation takes away.
          const wasMhz = points.find((p) => p?.mv === voltageMv)?.mhz ?? null;
          const nowMhz = fresh?.find((p) => p?.mv === voltageMv)?.mhz ?? null;
          if (Number.isFinite(wasMhz) && Number.isFinite(nowMhz) && wasMhz !== nowMhz) {
            say('rung-note', `таблица уехала: ${voltageMv} мВ обслуживало ${wasMhz} МГц, теперь ${nowMhz} МГц `
              + '— ступень считается по СВЕЖЕЙ таблице', { frequencyMhz, voltageMv, wasMhz, nowMhz });
          }
          livePoints = fresh;
        }

        const r = await runRung({
          ...rungArgs,                       // всё, что решил `sweepFrequency`, включая доказанную землю
          points: livePoints, clockMhz: frequencyMhz, voltageMv,
          seconds, sustain, pinCard, canPin,
          journal, seq: seq++, blockedKeys, now,
          runStepFn, buildVector, chooseShape, demandPin, envelopeMhz,
          // ЛЕСТНИЦА И СОБЫТИЯ — сюда, потому что решение об интенсивности принимается ЗДЕСЬ, где
          // видно выданную частоту. `onEvent` нужен, чтобы ослабление нагрузки было видно оператору
          // в окне, а не только в записи после прогона.
          shapeLadder, onEvent,
        });
        say('rung', r.why, { frequencyMhz, voltageMv, outcome: r.outcome });
        return r;
      },
    });

    if (outcome.seedRejected) report.seedRejections += 1;

    if (outcome.halted || outcome.verdict === null) {
      report.ok = false;
      report.stoppedBy = outcome.blocked === true
        ? 'blocked-rung'
        : (outcome.hangFloorHalt === true ? 'hang-floor' : 'halt');
      report.why = outcome.why;
      report.groups.push({ ...g, ...outcome });
      break;
    }

    // ---- (3) WHICH ROW THIS MEASUREMENT BELONGS TO — the owner's rule, `GOAL.md` → «🎚 ТЮНИМ ТО,
    // ЧТО КАРТА ВЫДАЁТ»: *«хотим заказать N, она нам выдала M — примиряемся с её выдачей и тюним то,
    // что она нам даёт»*.
    //
    // The descent ORDERED `g.topMhz` by capping the curve there. The card, measured on this machine
    // 2026-08-16, sits 20–30 MHz BELOW its ceiling and cannot be pushed up by anything
    // (`researches/11`). So the voltage that was just proved belongs to the clock the card RAN, and
    // writing it against the clock we asked for would be a `[TESTED]` marker over an observation
    // nobody made.
    const orderedMhz = g.topMhz;
    const rowMhz = resolveDeliveredRow(doc, outcome.deliveredMhz);
    if (!rowMhz.ok) {
      // NOT CLOSED AT THE ORDERED FREQUENCY AS A FALLBACK. A fallback here would silently restore the
      // exact claim this rule exists to remove, and it would do it precisely when the evidence is
      // missing — the worst moment to start guessing (PHILOSOPHY → the three doors).
      report.ok = false;
      report.stoppedBy = 'delivered';
      report.why = `НЕ ЗНАЕМ, НА КАКОЙ ЧАСТОТЕ КАРТА РАБОТАЛА на заказе ${orderedMhz} МГц: ${rowMhz.why}. `
        + 'Записывать напряжение против заказанной частоты запрещено словом владельца — карта садится ниже '
        + 'заказа, и это была бы строка, которой никто не мерил';
      report.groups.push({ ...g, ...outcome });
      break;
    }
    if (rowMhz.mhz !== orderedMhz) {
      report.delivered.push({ orderedMhz, deliveredMhz: outcome.deliveredMhz, rowMhz: rowMhz.mhz });
      say('delivered-elsewhere',
        `заказали ${orderedMhz} МГц — карта выдала ${outcome.deliveredMhz} МГц, замер ложится в строку ${rowMhz.mhz} МГц`,
        { orderedMhz, deliveredMhz: outcome.deliveredMhz, rowMhz: rowMhz.mhz });
    }
    // INHERITANCE ONLY DOWNWARD FROM THE ROW WE ACTUALLY PROVED. The group's members ABOVE the
    // delivered clock were not exercised at all — the card never went there — so they inherit
    // nothing. `Math.min` is what stops the range from inverting when the card lands below its group.
    const inheritFloorMhz = Math.min(g.bottomMhz, rowMhz.mhz);

    // ---- THE DOCUMENT, BEFORE THE NEXT FREQUENCY. Validated first, saved atomically second.
    // WHAT STOPPED THE DESCENT IS RECORDED AS WHAT IT WAS. The run already knows
    // (`plan.cappedByOperator`); until 2026-08-17 it dropped that knowledge on the way to the
    // document and wrote «предел рычага» over a stop that was OUR condition. The owner read a
    // finished run and asked what that meant — 54 rows of 54 carried it, none had touched the offset
    // range. See `CURVE_STATUS.DEPTH_CAPPED` for the full account.
    const status = outcome.verdict === 'edge-found'
      ? CURVE_STATUS.EDGE_FOUND
      : (outcome.plan?.cappedByOperator ? CURVE_STATUS.DEPTH_CAPPED : CURVE_STATUS.LEVER_LIMITED);
    const closed = closePoint(doc, {
      mhz: rowMhz.mhz,
      voltageMv: outcome.voltageMv,
      status,
      provenBy: `${outcome.provenBy ?? 'без свидетеля'} · ЗАКАЗАНО ${orderedMhz} МГц, ВЫДАНО `
        + `${outcome.deliveredMhz} МГц${rowMhz.snapped ? ` (притянуто к строке ${rowMhz.mhz})` : ''}`,
      inheritDownToMhz: inheritFloorMhz,
      at: now ? now() : null,
    });
    if (!closed.ok) {
      report.ok = false;
      report.stoppedBy = 'document';
      report.why = `ДОКУМЕНТ КРИВОЙ ОТВЕРГ ЗАПИСЬ ${g.topMhz} МГц: ${closed.why}`;
      report.groups.push({ ...g, ...outcome });
      break;
    }
    const refusals = validateCurveDoc(closed.doc);
    if (refusals.length) {
      report.ok = false;
      report.stoppedBy = 'document';
      report.why = `ДОКУМЕНТ ПОСЛЕ ЗАПИСИ ${g.topMhz} МГц НЕ ПРОШЁЛ СВОЙ ЖЕ СТОРОЖ (${refusals.length}): `
        + refusals.slice(0, 3).map((r) => `${r.field} — ${r.why}`).join(' · ')
        + '. На диск он не поехал: следующая сессия поверила бы ему';
      report.groups.push({ ...g, ...outcome });
      break;
    }
    doc = closed.doc;
    if (closed.raised.length) {
      report.raised.push(...closed.raised);
      say('ratchet', closed.why, { frequencyMhz: g.topMhz });
    }
    if (saveFn) {
      const saved = await saveFn(doc);
      if (saved && saved.ok === false) {
        report.ok = false;
        report.stoppedBy = 'save';
        report.why = `ДОКУМЕНТ НЕ СОХРАНЁН после ${g.topMhz} МГц: ${saved.why ?? 'без причины'}. Развёртка останавливается — `
          + 'знание, которого нет на диске, теряется первой же перезагрузкой';
        report.groups.push({ ...g, ...outcome });
        break;
      }
    }

    report.closed += closed.closed;
    report.verdicts[outcome.verdict] += 1;
    report.groups.push({ ...g, ...outcome, inherited: closed.inherited.length, raised: closed.raised });
    say('closed', closed.why, {
      frequencyMhz: g.topMhz,
      verdict: outcome.verdict,
      voltageMv: outcome.voltageMv,
      // The coverage a watcher shows is the report's own running total, never a second count.
      closedTotal: report.closed,
      frequenciesInBand: report.frequenciesInBand,
    });
  }

  report.doc = doc;
  report.elapsedMs = clockMs() - startedMs;
  return report;
}

/**
 * THE DRY RUN — what the sweep WILL do, computed by the functions that will do it. `plans/15` §4.7.
 *
 * This is the artifact rail S2 makes the operator read BEFORE the first byte reaches the owner's card,
 * so everything in it is taken from the same call the run makes (`planFrequency`) or from the same
 * decision the rung takes (`chooseWriteShape` on the REAL vector). Nothing here is a second opinion.
 *
 * **The ceiling's holder is computed for the FIRST rung of each frequency and SAID to be that** — the
 * uniform raise differs from rung to rung, so a single holder for the whole descent would be a claim
 * about rungs nobody has computed. What does not vary with the rung is the question itself (can the
 * curve carry a cap at this clock, or must the pin), and that is what the operator needs before
 * saying «go».
 *
 * @returns {Promise<object>} `{groups, frequenciesInBand, rungTotal, refusals}`
 *
 * [TESTED: 2026-08-16 01:0x, OFFLINE · 4 blocks — the planned rungs equal the walked ones and the
 *  count is not vacuously zero; the printed plan carries the first step's depth, the ceiling's holder
 *  and the lever wall; a seeded plan names BOTH ladders. Mutations 64, 65, 66 each redden their own
 *  block. **NOT TESTED: the `--dry-run` CLI exit itself (mutation 67 reddens nothing) — it is the
 *  live wiring, and it has no offline block. Said here rather than counted as covered.**]
 */
export async function sweepDryRun({
  curveDoc = null,
  points = [],
  fromMhz = null,
  toMhz = null,
  canPin = true,
  depthCapMv = null,
  // MUST MATCH `sweepRange`'S DEFAULT, and it did not for one commit — the plan printed «потолок
  // держит закрепление» while the run had already moved to the flattened curve. A plan that
  // describes a different shape from the run is `bugs/09` exactly, and the operator reads the plan
  // BEFORE authorising the write (rail S2), so the disagreement lands where it does the most harm.
  demandPin = false,
  buildVector = null,
  chooseShape = chooseWriteShape,
  // WHAT ALREADY HUNG EACH FREQUENCY — a `Map` from `sweep-journal.hangFloors`, read WITHOUT writing.
  // The plan must carry the third wall for the same reason it carries the operator's depth cap: a
  // bound the run obeys and the plan does not print is a bound the operator meets mid-run (EXP-0052,
  // `bugs/09`). `null` means «this caller has no journal», not «there are no hangs».
  hangFloors = null,
  // Что каждая частота УЖЕ ДОКАЗАЛА (`sweep-journal.provenRungs`, `bugs/31`) — вторая половина
  // памяти журнала. Без неё сухой прогон печатал бы лестницу от стока, а прогон шёл бы от улики —
  // то есть ровно тот расход плана и дела, за который проект заплатил `bugs/09`.
  proven = null,
  zones = config.DESCENT_ZONES,
} = {}) {
  if (!curveDoc || !Array.isArray(curveDoc.frequencies)) {
    throw new Error('sweepDryRun требует документ кривой — план строится по нему, а не по памяти процесса');
  }
  const floors = hangFloors instanceof Map ? hangFloors : new Map();
  const provenMap = proven instanceof Map ? proven : new Map();
  const build = buildVector ?? (await import('./lib/nvapi.mjs')).buildRaiseAndCapVector;
  const groups = rungGroups({ rows: curveDoc.frequencies, fromMhz, toMhz });
  const voltageGridMv = curveDoc.voltageGridMv ?? [];

  const out = [];
  for (const g of groups) {
    const floorMv = leverFloorFor(g.topMhz, points);
    const availableDepthMv = Number.isFinite(floorMv) ? g.stockVoltageMv - floorMv : 0;
    const plan = planFrequency({
      frequencyMhz: g.topMhz, stockVoltageMv: g.stockVoltageMv,
      voltageGridMv, availableDepthMv, depthCapMv, curveDoc, zones,
      hangFloorMv: floors.get(g.topMhz)?.voltageMv ?? null,
      provenPassMv: provenMap.get(g.topMhz)?.voltageMv ?? null,
    });

    // WHO WOULD HOLD THE CEILING at the first rung — asked of `chooseWriteShape` rather than decided
    // here, for the same reason `runRung` asks it: a second copy of that rule is a truth↔mirror pair
    // invented on purpose (EXP-0074).
    let holder = null;
    let holderWhy = '';
    if (plan.rungs.length) {
      const rp = planRung({ points, clockMhz: g.topMhz, voltageMv: plan.rungs[0].mv });
      if (rp.leverLimited) { holder = 'предел рычага уже на первой ступени'; holderWhy = rp.why; }
      else if (!rp.ok) { holder = null; holderWhy = rp.why; }
      else {
        const vector = build(points, rp.deltaMhz, { capMhz: g.topMhz });
        const held = vector && vector.ok === true ? chooseShape(vector, { pinned: canPin, demandPin }) : null;
        holder = held?.ok ? held.heldBy : null;
        holderWhy = held?.why ?? (vector?.why ?? 'вектор записи не построен');
      }
    }
    out.push({ ...g, plan, holder, holderWhy });
  }

  return {
    groups: out,
    groupCount: out.length,
    frequenciesInBand: out.reduce((n, g) => n + g.count, 0),
    rungTotal: out.reduce((n, g) => n + g.plan.rungs.length, 0),
    refusals: out.filter((g) => g.plan.refused || g.plan.cliffRefused || g.holder === null).length,
    depthCapMv: Number.isFinite(depthCapMv) ? depthCapMv : null,
    cappedFrequencies: out.filter((g) => g.plan.cappedByOperator).length,
    hangFloorFrequencies: out.filter((g) => g.plan.stoppedByHang).length,
  };
}

/**
 * THE DRY RUN, PRINTED. Every line the owner's rail S2 asks for, and the FIRST STEP'S DEPTH is on it —
 * that is the number whose absence cost him a night (`bugs/09`).
 *
 * [TESTED: 2026-08-16 01:0x, OFFLINE · 2 blocks; mutations 65 (drop the first step's depth) and 66
 *  (print only the seeded ladder) each redden their own block.]
 */
/**
 * ЧЕМ РАЗВЁРТКА ЖЖЁТ — ОДИН ИСТОЧНИК ДЛЯ ПЛАНА И ДЛЯ ПРОГОНА (`bugs/33`).
 *
 * Пара «истина↔зеркало», которую реестр велит СХЛОПЫВАТЬ, а не сторожить: команда передавала в
 * прогон один набор форм, а печать плана строила себе лестницу из четырёх уровней заново и обещала
 * оператору переигрывание, которого не будет. Сухой прогон — документ рельса S2, который читают
 * ПЕРЕД разрешением записи в карту владельца, поэтому расхождение здесь дороже всего.
 *
 * ЛЕСТНИЦА ИНТЕНСИВНОСТИ — ОДИН УРОВЕНЬ, и это следствие канона, а не экономия. Лестница (`bugs/28`)
 * существовала ровно для того, чтобы принудить карту сесть на ЗАКАЗАННУЮ частоту; канон 2026-08-22
 * (`GOAL.md` → «УПРАВЛЯЕМАЯ ВЕЛИЧИНА СТУПЕНИ — НАПРЯЖЕНИЕ, А НЕ ЧАСТОТА») отменил саму цель —
 * строка пишется по ВЫДАННОЙ частоте, принуждать стало нечего. Побочно это чинит и измерение:
 * ослабленный прожиг доказывал напряжение под НЕ ТОЙ нагрузкой, под которой владелец играет.
 *
 * @returns {Array<Array<object>>} лестница наборов форм; её длина И ЕСТЬ число попыток на ступень
 *
 * [NOT-TESTED] at birth — flipped by the block «ПЛАН И ПРОГОН ЖГУТ ОДНИМ И ТЕМ ЖЕ» in `--selftest`.
 */
export function sweepBurnLadder() {
  return [furnaceSetAtLevel(0)];
}

export function sweepDryRunLines(dry) {
  const lines = [];
  lines.push(`СУХОЙ ПРОГОН: частот в полосе ${dry.frequenciesInBand}, из них прожигается ${dry.groupCount} `
    + `(остальные обслуживаются тем же напряжением и наследуют тот же ЗАМЕР), `
    + `прожигов запланировано ${dry.rungTotal}${dry.refusals ? ` · ОТКАЗОВ ${dry.refusals}` : ''}`);
  // ЧЕМ БУДЕТ ЖЕЧЬ — ПЕЧАТАЕТСЯ ПЛАНОМ, потому что граница, добавленная в ПРОГОН и не названная
  // ПЛАНОМ, не добавлена (EXP-0052, `bugs/09`): оператор читает сухой прогон, а не исходники.
  // Развёртка переехала на `furnace` 2026-08-22, и эта строка — то, по чему это видно ДО записи.
  {
    // ЛЕСТНИЦА БЕРЁТСЯ ИЗ ОДНОГО ИСТОЧНИКА С ПРОГОНОМ (`sweepBurnLadder`, `bugs/33`) — иначе план
    // описывает работу, которой не будет, а читает его оператор перед разрешением записи в карту.
    const ladder = sweepBurnLadder();
    const strongest = ladder[0].filter((s) => s.bearsVerdict).map((s) => s.id).join(' + ');
    lines.push(`ПРОЖИГ: ${strongest} по ${config.SWEEP_PROBE_SECONDS ?? 10} с, `
      + `ОДНИМ полным набором — попытка на ступень ${ladder.length}. `
      + (ladder.length > 1
        ? `Если карта под ним не сядет на настраиваемую частоту — ступень ПЕРЕИГРЫВАЕТСЯ ослабленной `
          + `нагрузкой (${FURNACE_LADDER.map((l) => `${l.wattsSeen} Вт→${l.heldMhzSeen} МГц`).join(' · ')}). `
          + `Кончились ступени — это НАХОДКА, а не вердикт о другой частоте (bugs/28).`
        : 'ПЕРЕИГРЫВАНИЯ НЕТ: недобор частоты — это ЗАМЕР, а не отказ, и строка уйдёт в ВЫДАННУЮ '
          + 'частоту (канон 2026-08-22, «УПРАВЛЯЕМАЯ ВЕЛИЧИНА СТУПЕНИ — НАПРЯЖЕНИЕ, А НЕ ЧАСТОТА»). '
          + 'Все строки полосы сняты в ОДНОМ режиме прожига и потому сопоставимы между собой.'));
  }
  if (Number.isFinite(dry.depthCapMv)) {
    lines.push(`ПОТОЛОК ГЛУБИНЫ ${dry.depthCapMv} мВ от стока — УСЛОВИЕ ЭТОГО ПРОГОНА, не свойство карты. `
      + `Он связывает спуск на ${dry.cappedFrequencies} частоте(ах) из ${dry.groupCount}: там рычаг достаёт глубже, `
      + 'а мы не идём. Ни одна такая частота НЕ несёт края — её вердикт «предел» это НАША остановка.');
  }
  if (dry.hangFloorFrequencies) {
    lines.push(`ПОЛ ЗАВИСАНИЯ связывает ${dry.hangFloorFrequencies} частоту(ы) из ${dry.groupCount}: там спуск `
      + 'останавливает НЕ рычаг и не наш потолок, а напряжение, которое уже вешало эту машину. '
      + 'Такая частота закрывается КРАЕМ по слову владельца, а не «пределом» (bugs/23).');
  }
  lines.push('В КАРТУ НЕ ЗАПИСАНО НИЧЕГО — это план, а не прогон.');
  for (const g of dry.groups) {
    const p = g.plan;
    // Числа отменённой затравки берутся из ПЛАНА (`cancelledSeedMv`), а не у соседки: отменить могли
    // и собственную улику частоты, и соседки при этом может не быть вовсе (`bugs/32`).
    const seed = p.seedMv === null
      ? `затравки нет (спуск от стока ${p.stockVoltageMv} мВ)`
        + (p.seedBlockedByHang ? ` — затравку ${p.cancelledSeedMv} мВ ОТМЕНИЛ ПОЛ ЗАВИСАНИЯ ${p.hangFloorMv} мВ` : '')
      : (p.seedFromOwnEvidence
        ? `затравка ${p.seedMv} мВ — СОБСТВЕННАЯ улика этой частоты из журнала (bugs/31), а не значение соседки`
        : `затравка ${p.seedMv} мВ от соседки ${p.seed?.neighbourMhz} МГц (статус «${p.seed?.neighbourStatus}»)`);
    lines.push(`${g.topMhz} МГц — ступень из ${g.count} частот(ы) до ${g.bottomMhz} МГц, сток ${g.stockVoltageMv} мВ`);
    lines.push(`   ${seed}`);
    if (p.refused) { lines.push(`   ❌ ЛЕСТНИЦА НЕ ПОСТРОЕНА: ${p.why}`); continue; }
    if (p.rungs.length === 0) { lines.push(`   ⚠️ ступеней нет: ${p.why}`); continue; }
    lines.push(`   ступеней ${p.rungs.length}, ПЕРВЫЙ ШАГ −${p.firstStepMv} мВ, глубже всего `
      + `${p.rungs[p.rungs.length - 1].mv} мВ (−${p.rungs[p.rungs.length - 1].depthMv} мВ от стока)`);
    lines.push(`   зоны политики: ${p.zonesCrossed.map((z) => `${z} мВ`).join(' · ')}`
      + (p.forcedByGridCount ? ` · сетка вынудила ${p.forcedByGridCount} шаг(ов) глубже политики` : ''));
    if (p.stoppedByHang) {
      lines.push(`   🔴 спуск останавливает ЗАПИСАННОЕ ЗАВИСАНИЕ на ${p.hangFloorMv} мВ: последняя ступень плана `
        + `${p.rungs[p.rungs.length - 1].mv} мВ, ниже него прогон не идёт. Эта частота закроется КРАЕМ`);
    } else if (p.cappedByOperator) {
      lines.push(`   спуск останавливает НАШ потолок ${p.depthCapMv} мВ: пол ${p.floorMv} мВ. `
        + `Рычаг достал бы до ${p.stockVoltageMv - p.availableDepthMv} мВ (−${p.availableDepthMv} мВ) — туда мы не идём`);
    } else {
      lines.push(`   рычаг достаёт до ${p.floorMv} мВ (−${p.availableDepthMv} мВ) — ниже него это НАШ предел, а не кремний`);
    }
    lines.push(`   потолок на первой ступени держит: ${g.holder ?? 'НИКТО — ступень будет отвергнута ДО записи'}`);
    if (p.cliffRefused) {
      lines.push(`   ❌ СТОРОЖ ОБРЫВА: первый шаг ${p.firstStepMv} мВ больше разрешённых ${p.cliffMv} (bugs/03)`);
    }
    if (p.seedMv !== null) {
      lines.push(`   если затравка НЕ пройдёт — спуск падает на сток и идёт ${p.rungsFromStock.length} ступеней `
        + `с первого шага −${p.stockVoltageMv - p.rungsFromStock[0].mv} мВ`);
    }
  }
  return lines;
}

/**
 * THE SWEEP'S REPORT, in the owner's language — coverage COUNTED rather than claimed (E2-AC2).
 *
 * The wall time is printed against the estimate on purpose: **an estimate nobody ever checks is a
 * number that drifts**, and this project has already caught one such number by measuring it
 * (`researches/09`'s rung counts, EXP-0072).
 *
 * [TESTED: 2026-08-16 00:3x, OFFLINE · 1 block asserting coverage, the verdict histogram, the seeding
 *  scoreboard and the wall time against the estimate are all PRESENT in the printed lines.]
 */
export function sweepReportLines(report) {
  const lines = [];
  const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 1000) / 10} %` : '—');
  lines.push(`РАЗВЁРТКА${report.bandLabel ? ` «${report.bandLabel}»` : ''}: ступеней ${report.groupCount}, `
    + `частот в полосе ${report.frequenciesInBand}`);
  lines.push(`ПОКРЫТИЕ: закрыто ${report.closed} из ${report.frequenciesInBand} (${pct(report.closed, report.frequenciesInBand)})`);
  // «ПРЕДЕЛ РЫЧАГА» РАЗДЕЛЁН НА ДВЕ РАЗНЫЕ ПРИЧИНЫ В ПЕЧАТИ (`CURVE_STATUS.DEPTH_CAPPED`). Одно
  // число над двумя несовместимыми фактами — «карте ниже нельзя» и «мы решили не смотреть» — это
  // ровно то, на чём владелец споткнулся 2026-08-17. Слово «рычаг» тоже убрано: это метафора агента,
  // а не термин, и владелец сказал прямо, что она ему ничего не объясняет.
  const cappedCount = report.cappedFrequencies ?? 0;
  const leverCount = Math.max(0, (report.verdicts['lever-limited'] ?? 0) - cappedCount);
  lines.push(`ВЕРДИКТЫ: край найден ${report.verdicts['edge-found']}`
    + ` · остановлено НАШИМ потолком глубины ${cappedCount}`
    + ` · упёрлось в предел сдвига ±1000 МГц ${leverCount}`);
  lines.push(`ЗАТРАВКА: отвергнута ${report.seedRejections} раз(а) — это ЗАМЕР монотонности на этом кремнии, а не сбой прогона`);
  // THE ORDER-vs-OBSERVATION LINE. Printed even when it is zero, because «нисколько не разошлось» is
  // itself a finding about the card — and a line that appears only on divergence teaches the reader
  // nothing about the runs where it did not.
  if (report.delivered?.length) {
    const uniqueRows = new Set(report.delivered.map((d) => d.rowMhz));
    lines.push(`ЗАКАЗ ↔ ВЫДАЧА: разошлись на ${report.delivered.length} частоте(ах) — замер лёг НЕ в заказанную строку `
      + `(строк-адресатов ${uniqueRows.size}): `
      + report.delivered.slice(0, 6).map((d) => `${d.orderedMhz}→${d.rowMhz}`).join(', ')
      + (report.delivered.length > 6 ? ` и ещё ${report.delivered.length - 6}` : ''));
    lines.push('   Это НЕ сбой: карту нельзя поднять до заказа, и напряжение записано против той частоты, '
      + 'на которой она работала (GOAL.md → «🎚 ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ»).');
  } else {
    lines.push('ЗАКАЗ ↔ ВЫДАЧА: не разошлись ни разу — карта отдала каждую заказанную частоту');
  }
  if (report.raised.length) {
    lines.push(`ХРАПОВИК ПОДНЯЛ ${report.raised.length} частот(у): `
      + report.raised.map((r) => `${r.mhz} МГц ${r.fromMv}→${r.toMv} мВ`).join(', '));
  }
  if (report.hung.length) {
    lines.push(`ЗАВИСАНИЙ ПРИПИСАНО: ${report.hung.length} — `
      + report.hung.map((h) => `${h.frequencyMhz} МГц / ${h.voltageMv} мВ`).join(', '));
  }
  if (report.blocked.length) {
    lines.push(`ЗАБЛОКИРОВАНО ДВУМЯ ЗАВИСАНИЯМИ ПОДРЯД: ${report.blocked.map((b) => `${b.frequencyMhz} МГц / ${b.voltageMv} мВ`).join(', ')}`);
  }
  if (report.hangFloors?.length) {
    lines.push(`ПОЛ ЗАВИСАНИЯ (спуск туда не возвращается): `
      + report.hangFloors.map((f) => `${f.frequencyMhz} МГц ниже ${f.voltageMv} мВ`).join(', '));
  }
  const hours = report.elapsedMs / 3_600_000;
  lines.push(`ВРЕМЯ: ${(report.elapsedMs / 1000).toFixed(1)} с (${hours.toFixed(2)} ч) против оценки ${report.estimateHours} ч на весь диапазон`);
  if (!report.ok) lines.push(`ОСТАНОВЛЕНО (${report.stoppedBy}): ${report.why}`);
  return lines;
}

/**
 * THE DEPTH GOVERNOR — written after `bugs/03`, which hung the owner's machine for five hours.
 *
 * An ascent exists so the FIRST FAILURE is met at the shallowest depth that can produce it. The
 * previous rung selection — «every fifth rung, plus the last» — put the FIFTH voltage step first and
 * skipped four shallower ones, converting a graded approach into a single deep plunge. At 1100 MHz,
 * where a whole-curve raise reaches −320 mV, that first plunge hung the machine hard enough that no
 * rollback on it could ever run: the writer's `finally`, the detached watchdog and Windows TDR all
 * need a scheduling OS. **At depth, step size IS the safety mechanism — there is no other.**
 *
 * Three rules, and each one alone would have prevented the incident:
 *
 *   1. **The first rung is the SHALLOWEST rung, always** — whatever the stride is.
 *   2. **The first step may not exceed `firstStepMaxMv`** of undervolt (the owner's own coarse mode,
 *      25 mV). A ladder that cannot offer a first step that shallow is REFUSED, not truncated: a
 *      region where the smallest available move is a plunge is a region this lever must not enter
 *      unattended.
 *   3. **No step-to-step increase beyond `stepMaxMv`.** This card's bottom has a cliff in it (−5 mV,
 *      then −230 mV), and a cliff walked in one stride is the same plunge wearing a later index.
 *
 * ── GENERALIZED 2026-08-15 FOR SEEDING (`plans/15` §4.2), AND GENERALIZED IS NOT WEAKENED ──────────
 *
 * The owner switched on seeding: a frequency's descent may START at the voltage its already-tuned
 * HIGHER neighbour proved, instead of at stock (`GOAL.md` → «🪜 СПУСК НАЧИНАЕТСЯ С УЖЕ ОТТЮНЕННОЙ
 * СОСЕДКИ»). Under rule 2 as originally written that is illegal by construction — a seed 150 mV below
 * stock IS a first step of 150 mV — so the governor had to learn what «first step» means when the
 * ground under it is already proven. His own instruction names the generalization exactly:
 *
 *   > *«Сторож первого шага обобщается, а не отключается… глубже 25 мВ ОТ САМОГО ГЛУБОКОГО
 *   > НАПРЯЖЕНИЯ, УЖЕ ДОКАЗАННОГО УЛИКОЙ. Улик нет → доказанное = сток → сторож ведёт себя ровно как
 *   > сегодня.»*
 *
 * So rule 2 now measures the first step from `provenSavedMv` — the undervolt depth some evidence has
 * already carried — instead of from zero. **`provenSavedMv` defaults to 0, which IS stock, so every
 * existing caller gets byte-identical behaviour** (F2-AC2), and that identity is asserted by its own
 * selftest block with its own mutation rather than left as a claim.
 *
 * WHAT THE GENERALIZATION DELIBERATELY DOES NOT TOUCH: rule 3. A gap between two rungs is a plunge
 * wherever it sits, proven ground or not — evidence about a VOLTAGE says nothing about the size of the
 * jump that follows it. `bugs/03`'s cliff (−5 mV then −230 mV) is caught by rule 3, and it stays.
 *
 * @param {number} [o.provenSavedMv]  undervolt depth already PROVEN safe here, in mV (0 = stock = no
 *                                    evidence). Only evidence that PASSED may raise it — never a
 *                                    voltage that merely failed one rung lower.
 * @returns {{rungs:Array, refused:boolean, why:string}}
 *
 * [NOT-TESTED]
 */
export function pickAscentRungs(fine, {
  stride = 5,
  firstStepMaxMv = config.ASCENT_FIRST_STEP_MAX_MV ?? 25,
  stepMaxMv = config.ASCENT_STEP_MAX_MV ?? 35,
  provenSavedMv = 0,
} = {}) {
  if (!Array.isArray(fine) || !fine.length) return { rungs: [], refused: false, why: 'лестница пуста' };
  const graded = fine.every((r) => Number.isFinite(r.savedMv));
  if (!graded) {
    // A ladder with no voltage grading (the fixed-MHz path and every offline fixture) is walked as it
    // was handed over; the governor judges DEPTH, and depth it cannot see it does not pretend to bound.
    return { rungs: fine.slice(), refused: false, why: 'лестница без градуировки по напряжению — идём как есть' };
  }

  // RULE 1 — the shallowest rung is always first.
  const picked = [fine[0]];
  // RULE 3 — walk forward, taking the coarse stride but never letting the DEPTH jump too far.
  for (let i = 1; i < fine.length; i++) {
    const last = picked[picked.length - 1];
    const byStride = (i - fine.indexOf(last)) >= stride;
    const wouldJump = fine[i].savedMv - last.savedMv;
    const nextJumpsTooFar = (i + 1 < fine.length) && (fine[i + 1].savedMv - last.savedMv > stepMaxMv);
    if (byStride || nextJumpsTooFar || i === fine.length - 1) {
      if (wouldJump > stepMaxMv && picked.length) {
        return {
          rungs: picked,
          refused: true,
          why: `ОТКАЗ: следующая ступень углубляет андервольт сразу на ${wouldJump} мВ (потолок шага ${stepMaxMv} мВ). `
            + 'Это обрыв в лестнице, а не шаг; такой участок кривой этим рычагом без присмотра не проходят (bugs/03).',
        };
      }
      picked.push(fine[i]);
    }
  }

  // RULE 2 — the first step's own depth, measured from PROVEN GROUND rather than from stock.
  // With no evidence `provenSavedMv` is 0 and this is the original comparison, unchanged.
  const proven = Number.isFinite(provenSavedMv) && provenSavedMv > 0 ? provenSavedMv : 0;
  const firstStepFromProven = picked[0].savedMv - proven;
  if (firstStepFromProven > firstStepMaxMv) {
    return {
      rungs: [],
      refused: true,
      why: `ОТКАЗ: самая мелкая доступная ступень здесь снимает сразу ${firstStepFromProven} мВ `
        + (proven
          ? `от уже ДОКАЗАННОЙ глубины −${proven} мВ (сама ступень −${picked[0].savedMv} мВ), `
          : '')
        + `а потолок первого шага ${firstStepMaxMv} мВ. Участок, где мельче нельзя, этим рычагом не тестируется (bugs/03).`,
    };
  }
  return {
    rungs: picked,
    refused: false,
    why: `первая ступень −${picked[0].savedMv} мВ`
      + (proven ? ` (это −${firstStepFromProven} мВ от доказанного −${proven} мВ)` : '')
      + `, всего ступеней ${picked.length}`,
  };
}

/**
 * THE SESSION'S DEPTH BOUND, COMPOSED ONCE AND READ BY BOTH THE PLAN AND THE RUN.
 *
 * This function exists because the two of them had DRIFTED, and the drift was invisible in exactly the
 * place it mattered. `bugs/07` bought the bound «a session goes at most
 * `SESSION_MAX_DEPTH_BEYOND_KNOWN_MV` past the deepest PASS it inherited» with a hung machine — and it
 * lived inside `searchEdge`, where only the LIVE run could see it. `--dry-run` printed the ungoverned
 * ladder («ступеней 40, глубже всего −250 мВ»), so the pre-flight read that S1/S2 make the operator
 * perform showed a sweep four times deeper than the one that would actually happen. The bound worked;
 * the ONLY artifact anyone reads before writing to the owner's card did not know about it.
 *
 * That is the same defect class as `bugs/02`: a number whose shape the reader has to infer. The cure is
 * not a second copy of the arithmetic in the CLI — it is ONE computation with two readers (DRY,
 * `PHILOSOPHY.md`), so a future edit to the bound cannot silently leave the plan behind.
 *
 * ORDER IS THE SAFETY PROPERTY, and it is preserved verbatim from the code this replaces: the depth
 * governor (`pickAscentRungs`) runs FIRST on the WHOLE ladder; the session bounds may only ever REMOVE
 * rungs it blessed, never add one it never saw (`bugs/03`'s block «ОТКАЗ СТОРОЖА СЛУЧАЕТСЯ ДО ПЕРВОЙ
 * ЗАПИСИ» caught that inversion once already).
 *
 * @param {object}  a
 * @param {Array}   a.fine     the graded ladder, already filtered by the ratchet's limit
 * @param {Array}   a.history  the ratchet's usable records (post-quarantine); `[]` = no history at all
 * @param {number}  a.point    the curve point this ladder serves — the ratchet's key (`bugs/06`)
 * @returns {{chosen:object, ladderRungs:Array, sessionDepth:object}}
 *
 * [NOT-TESTED]
 */
export function composeAscentLadder({
  fine = [],
  history = [],
  point,
  // THE CAP AND THE CURRENT STOCK VOLTAGE — the evidence key (`bugs/10`). `capMhz` is what the
  // records are filed under; `stockMv` only renders the answer as a depth for the reader.
  capMhz = null,
  stockMv = null,
  // EVERY POLICY NUMBER IS A PARAMETER WITH A CONFIG DEFAULT, never a literal in the body.
  //
  // The owner, 2026-08-15: *«у нас хардкод шагов? Какого хуя мы не можем передавать их как аргумент,
  // как переменную?»* — and he was right: `--seconds` was an argument while the step, the floor and
  // the session depth were baked in, which are exactly the knobs an operator turns between runs.
  // `config.mjs` keeps its job as the place the DEFAULTS live (rule R3); these let a run override
  // them without editing code. **The guards do not move with them:** `pickAscentRungs` still refuses
  // a first step deeper than `firstStepMaxMv` and a rung gap beyond `stepMaxMv` (`bugs/03`), and the
  // ratchet still forbids every voltage that ever failed (`bugs/10`) — so a reckless argument is
  // REFUSED before the first write rather than obeyed.
  stride = 5,
  sessionMaxDepthMv = config.SESSION_MAX_DEPTH_BEYOND_KNOWN_MV ?? 30,
  fastFloorMv = config.FAST_DESCENT_FLOOR_MV ?? 900,
  firstStepMaxMv = config.ASCENT_FIRST_STEP_MAX_MV ?? 25,
  stepMaxMv = config.ASCENT_STEP_MAX_MV ?? 35,
} = {}) {
  const graded = fine.every((r) => Number.isFinite(r.savedMv) && Number.isFinite(r.mv));

  // THE DEEPEST GROUND ANYONE HAS ACTUALLY PROVEN — read in ABSOLUTE millivolts (`bugs/10`).
  //
  // Keyed by (capMhz, servingMv), never by point index: measured 2026-08-14, the curve slides
  // ≈1.7 MHz/°C along the FREQUENCY axis while the voltage axis stands still, so four different point
  // indices served 2842 MHz inside 22 °C. Evidence filed under a point index is evidence a differently
  // warmed session cannot find — which is literally what happened: a sweep proved −30 mV and the next
  // dry run one minute later printed «истории НЕТ».
  //
  // `stockMv` is only used to express the ANSWER as a depth for the reader. Every decision below is
  // made on absolute volts, so a warmer or colder session inherits the same ground.
  const provenMv = graded && Number.isFinite(capMhz) ? bestPassingMv(history, capMhz) : null;
  const ratchetFloor = graded && Number.isFinite(capMhz)
    ? allowedVoltageMv(history, capMhz)
    : { floorMv: -Infinity, bound: false, lowestFailureMv: null, failures: 0 };
  const referenceMv = Number.isFinite(stockMv) ? stockMv : (fine.length ? fine[0].mv + fine[0].savedMv : null);
  const knownDepthMv = provenMv === null || !Number.isFinite(referenceMv)
    ? 0
    : Math.max(0, referenceMv - provenMv);
  const depthCeilingMv = knownDepthMv + sessionMaxDepthMv;
  // The session's floor as an ABSOLUTE voltage: one bounded excursion below proven ground — or below
  // stock when there is no proven ground at all.
  const sessionFloorMv = (provenMv !== null ? provenMv : referenceMv) - sessionMaxDepthMv;

  const chosen = pickAscentRungs(fine, { stride, firstStepMaxMv, stepMaxMv });

  // Then the two session bounds, applied to what the governor already blessed (`bugs/07`):
  //   1. never deeper than `sessionMaxDepthMv` past the deepest inherited PASS;
  //   2. beyond that inherited depth the step becomes FINE — the owner's own proposal, so the graded
  //      oracle can land INSIDE the avalanche (~20 mV wide) instead of striding over it.
  // THE OWNER'S DESCENT POLICY, and it is the outer bound (`config.FAST_DESCENT_FLOOR_MV`). His word:
  // *«до 900 можем опускаться быстрыми шагами. ниже 900 - опускаемся по 5 мВ»*. Above the floor the
  // session bound does not truncate; at and below it, `bugs/07`'s 30 mV per session applies again and
  // every grid step is taken.
  const withinCeiling = (r) => !graded
    || (r.mv >= ratchetFloor.floorMv
        && (r.mv >= fastFloorMv || r.mv >= sessionFloorMv));
  const coarseAllowed = chosen.rungs.filter(withinCeiling);
  // FINE ONLY BELOW HIS FLOOR — above it he asked for speed, and the physics agrees: the avalanche
  // (~20 mV, `researches/02` §2) sits near the edge at ~845…860 mV, i.e. under the floor. Fine steps
  // are what lets the graded oracle land INSIDE it instead of striding over it.
  const frontierFine = graded
    ? fine.filter((r) => r.mv < fastFloorMv
        && withinCeiling(r)
        && !coarseAllowed.some((c) => c.offsetMhz === r.offsetMhz))
    : [];
  const ladderRungs = [...coarseAllowed, ...frontierFine].sort((a, b) => a.offsetMhz - b.offsetMhz);

  return {
    chosen,
    ladderRungs,
    sessionDepth: {
      knownDepthMv,
      // THE SAME FACTS IN THE UNIT THAT DOES NOT SLIDE — what a later session actually inherits.
      provenMv,
      sessionFloorMv,
      fastFloorMv,
      ratchetFloorMv: ratchetFloor.bound ? ratchetFloor.floorMv : null,
      stockMv: referenceMv,
      ceilingMv: depthCeilingMv,
      droppedByCeiling: chosen.rungs.length - coarseAllowed.length,
      fineRungsAtFrontier: frontierFine.length,
      // WHAT THIS SESSION WILL ACTUALLY REACH — the number the dry run has to print, because it is the
      // one an operator compares against «глубже всего» before deciding to start.
      deepestPlannedMv: ladderRungs.length ? ladderRungs[ladderRungs.length - 1].savedMv : null,
      deepestPlannedAbsMv: ladderRungs.length ? ladderRungs[ladderRungs.length - 1].mv : null,
      rungsPlanned: ladderRungs.length,
    },
  };
}

/**
 * THE SESSION-DEPTH LINE, worded once so the plan and the run cannot describe the same bound
 * differently. Read by `--band --dry-run` and `--search --dry-run` alike.
 *
 * [NOT-TESTED]
 */
export function sessionDepthLine(sd) {
  if (!sd) return 'ГЛУБИНА СЕССИИ: не вычислена';
  // EVERY NUMBER IS PRINTED IN ABSOLUTE MILLIVOLTS ALONGSIDE ITS DEPTH (`bugs/10`). The depth is
  // relative to a stock voltage that SLIDES with temperature; the absolute volt is what the next
  // session inherits, so it is the one that must be readable without doing arithmetic.
  const known = sd.provenMv !== null && sd.provenMv !== undefined
    ? `доказано до ${sd.provenMv} мВ (−${sd.knownDepthMv} от стока ${sd.stockMv})`
    : `истории НЕТ, отсчёт от стока ${sd.stockMv ?? '—'} мВ`;
  const reach = sd.deepestPlannedMv === null
    ? 'ни одной ступени не остаётся'
    : `эта сессия дойдёт до ${sd.deepestPlannedAbsMv ?? '?'} мВ (−${sd.deepestPlannedMv} от стока) и остановится САМА`;
  const ratchet = sd.ratchetFloorMv === null || sd.ratchetFloorMv === undefined
    ? ''
    : ` · ХРАПОВИК не пускает ниже ${sd.ratchetFloorMv} мВ`;
  // WHICH RULE IS BINDING RIGHT NOW, said out loud — above the owner's floor it is his «быстрые шаги»,
  // below it the session bound. A reader deciding go/no-go should not have to infer which.
  const mode = sd.deepestPlannedAbsMv !== null && sd.deepestPlannedAbsMv !== undefined
      && sd.deepestPlannedAbsMv >= (sd.fastFloorMv ?? 900)
    ? `БЫСТРЫЙ СПУСК до пола владельца ${sd.fastFloorMv} мВ (грубый шаг)`
    : `ТОЧНЫЙ СПУСК под полом владельца ${sd.fastFloorMv} мВ (шаг 5 мВ, сессия ≤ 30 мВ от доказанного)`;
  return `ГЛУБИНА СЕССИИ: ${known} · ${mode} · пол сессии ${sd.sessionFloorMv} мВ${ratchet} · ${reach}`
    + ` · ступеней в прогоне ${sd.rungsPlanned} (отброшено потолком ${sd.droppedByCeiling}, точных на фронтире ${sd.fineRungsAtFrontier})`;
}

/**
 * THE RATCHET'S USABLE EVIDENCE — the same two quarantine axes the search applies, exported so the
 * PLAN sees the ratchet the RUN will see. Split out with `composeAscentLadder` and for the same
 * reason: a plan computing its own history is a second truth that drifts.
 *
 * [NOT-TESTED]
 */
export function ratchetView({ store = null, card = {}, writeShape = 'raise-and-cap' } = {}) {
  const byStamp = store ? partitionByStamp(resolveAttempts(readAll(store).records), card) : { current: [], quarantined: [] };
  const byShape = partitionByWriteShape(byStamp.current, writeShape);
  return { history: byShape.current, byStamp, byShape };
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
  // THE SET a candidate is judged by. `null` is the single-shape atom — legal, and honestly narrower:
  // a threshold found that way is the edge of ONE PROGRAM, and researches/02 §4 measured Vmin
  // spreading up to 100 mV between programs on the same card.
  shapes = null,
  // RAISE THE WHOLE CURVE, not one point — the correction `bugs/02` demands. A single point cannot
  // cheapen the clock being tested, because the clock is served by whichever point reaches it at the
  // LOWEST voltage, and that is a neighbour we did not touch (`vf-step`'s own header said so while the
  // search did the opposite).
  wholeCurve = false,
  // THE WRITE SHAPE, chosen by the CALLER and carried through every rung of this search unchanged.
  //
  // `bugs/02` step 1 asks the search to write the shape the profile ships (`raise-and-cap`), so that
  // the searched quantity and the shipped quantity are the same thing. It is the caller's choice and
  // not this function's, for one measured reason: below `topMhz − 1000` the curve CANNOT hold a
  // ceiling at all (`nvapi.buildRaiseAndCapVector` — 2172 MHz on this card), so on a low rung the
  // shipped shape does not exist and the clock pin is what holds the ceiling instead. A search that
  // silently picked for itself would hide exactly which of the two produced its number, and that is
  // the class `bugs/02` is named for. `vf-step.chooseWriteShape` is what the caller decides with, and
  // the choice is PRINTED per rung.
  //
  // `null` keeps the legacy mapping from `wholeCurve`, so every offline fixture behaves as it did.
  writeShape = null,
  // PIN THE CLOCK so the curve region under test is the region actually loaded.
  pinMhz = null,
  pinCard = null,
  // THE LADDER IN VOLTS, computed from the card's own curve (`vf-step.ascentLadderByVoltage`). Each
  // entry is one voltage grid step; `coarseStride` is how many of them the coarse mode skips — the
  // owner's «грубый 25 мВ / точный 5 мВ» as five steps against one.
  rungs = null,
  coarseStride = 5,
  // THE POLICY KNOBS, passed through to `composeAscentLadder` rather than read from config there —
  // so a CLI flag reaches the decision instead of stopping at the edge of this function.
  sessionMaxDepthMv = config.SESSION_MAX_DEPTH_BEYOND_KNOWN_MV ?? 30,
  fastFloorMv = config.FAST_DESCENT_FLOOR_MV ?? 900,
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

  // THE RATCHET'S EVIDENCE, FILTERED BY BOTH QUARANTINE AXES (`bugs/06`).
  //
  // R6 first — a driver or VBIOS change invalidates every measurement. Then the WRITE SHAPE: a record
  // only bounds this search if it came from a run that wrote the same thing. Measured live: a crash
  // recorded under the single-point shape (which died at ~3400 MHz, a state the shipped shape cannot
  // reach) was stopping the shipped-shape search six rungs in, at OUR limit rather than the card's.
  const shapeNow = writeShape ?? (wholeCurve ? 'uniform' : 'point');
  const { history, byStamp, byShape } = ratchetView({ store, card, writeShape: shapeNow });
  const ratchet = allowedOffset(history, point, { fineStepMhz: fineMhz });

  const out = {
    capMhz, point, workload, shape,
    ratchetLimitMhz: ratchet.limitMhz,
    // WHAT WAS SET ASIDE AND WHY — a quarantine nobody can see is a deletion with extra steps.
    ratchetEvidence: {
      writeShape: shapeNow,
      usable: history.filter((r) => r.point === point).length,
      quarantinedByStamp: byStamp.quarantined.filter((r) => r.point === point).length,
      quarantinedByShape: byShape.quarantined.filter((r) => r.point === point).length,
    },
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
    const m = result.meters ?? null;
    const attempt = {
      offsetMhz,
      servingPoint: serving?.pointIndex ?? null,
      servingMv: serving?.mv ?? null,
      // The GRADED numbers ride with every attempt, so the search can watch corruption RISE rather
      // than only meet the crash it ends at.
      badElemsMax: m?.badElemsMax ?? null,
      faultRate: m?.faultRate ?? null,
      bitDistMin: m?.bitDistMin ?? null,
      launches: m?.launches ?? null,
      verdict: result.verdict ?? null,
      // WHICH SHAPE DECIDED IT. A threshold without the load that produced it is not a threshold —
      // Vmin spreads ~100 mV between programs (researches/02 §4).
      worstShape: result.worstShape ?? null,
      // WHAT THE CARD ACTUALLY DELIVERED under load, and it is the observation that replaced the
      // clock-lock proof on a capped run: the ceiling is proved by what the card DID, not by what the
      // curve was asked to offer.
      deliveredMhz: result.deliveredMhz ?? null,
      deliveredMaxMhz: result.deliveredMaxMhz ?? null,
      shapesRun: Array.isArray(result.shapes) ? result.shapes.map((e) => e.id) : null,
      reason: result.reason
        ?? result.stress?.reason
        ?? ((result.blocks || []).filter((b) => !b.ok).map((b) => b.name).join('; ') || null),
    };
    out.attempts.push(attempt);
    if (store) {
      // PERSIST BEFORE THE NEXT STEP — a killed search keeps every verdict it paid for.
      //
      // ONE RECORD PER SHAPE, not one per attempt. The store's own contract is «one record per
      // (point, offset, shape)» (§4.2) and AC3 is measured off it — «distinct load shapes each
      // closed point was judged by, target ≥ 3». Collapsing a set into one row would leave that
      // criterion unanswerable from the evidence it names as its meter.
      const rows = Array.isArray(result.shapes) && result.shapes.length
        ? result.shapes.map((e) => ({
          workload: e.workload, shape: e.shape,
          verdict: e.verdict ?? null,
          reason: e.reason ?? null,
          meters: e.meters ?? null,
        }))
        : [{ workload, shape, verdict: attempt.verdict, reason: attempt.reason, meters: m }];

      for (const row of rows) {
        const rm = row.meters ?? null;
        append(store, {
          point, offsetMhz, workload: row.workload, shape: row.shape, seconds,
          verdict: row.verdict, reason: row.reason,
          driver: card.driver, vbios: card.vbios,
          capMhz,
          // THE SHAPE THE ATOM ACTUALLY RESOLVED, not the one this engine asked for — an intention is
          // not an observation, and the whole point of recording it is to be able to tell later what
          // the card was carrying (bugs/02). `null` when the runner does not report one at all.
          writeShape: result.writeShape ?? null,
          capHeldBy: result.capHeldBy ?? null,
          tempStartC: result.tempStartC ?? null,
          tempReachedC: result.tempReachedC ?? null,
          servingPoint: attempt.servingPoint,
          servingMv: attempt.servingMv,
          launches: rm?.launches ?? null,
          badElemsMax: rm?.badElemsMax ?? null,
          faultRate: rm?.faultRate ?? null,
          bitDistMin: rm?.bitDistMin ?? null,
          opsPerSecond: rm?.opsPerSecond ?? null,
        });
      }
    }
    if (onAttempt) onAttempt(attempt);
    return attempt;
  };

  // ---- THE ASCENT LADDER.
  //
  // With `rungs` (computed from the card's own curve by `ascentLadderByVoltage`) the search walks in
  // VOLTS — the unit the owner specified his two modes in — and the coarse mode is «every fifth grid
  // step» rather than a fixed number of megahertz. The fixed-MHz ladder stays for the callers that
  // have no curve in hand, and for every offline fixture.
  //
  // Why this is not cosmetic: measured on this card, one voltage grid step costs 4.1 MHz of offset at
  // 2842 MHz and 22.2 MHz at 1700 MHz. A fixed 75 MHz coarse step is therefore 18 mV at the top and
  // 3.4 mV in the middle — the same «coarse» mode walking the band seven times more finely in one
  // place than in another.
  const fine = (Array.isArray(rungs) && rungs.length)
    ? rungs.filter((r) => r.offsetMhz <= ratchet.limitMhz)
    : coarseLadder({ limitMhz: ratchet.limitMhz, coarseMhz }).map((o) => ({ offsetMhz: o, mv: null, savedMv: null }));
  const stride = (Array.isArray(rungs) && rungs.length) ? coarseStride : 1;

  // ---- THE DEPTH THIS SESSION MAY EXPLORE, and it is the bound bought on 2026-08-14 21:14.
  //
  // That night this loop walked SEVEN rungs — 0 → −185 mV — on a shape whose history was empty, and
  // hung the owner's machine on the eighth. Every individual step was small and legal; what was
  // unbounded was the TOTAL distance travelled beyond anything ever proven. So two rules now bound it,
  // and they are the owner's own proposal made executable:
  //
  //   1. **Beyond the deepest PROVEN depth, the step becomes FINE.** His words: search the edge by
  //      corruption rising, not by the machine dying. The graded oracle can only see the avalanche if
  //      we land INSIDE it — `researches/02` measures it 3 % → 90 % across ~20 mV, and a 30 mV coarse
  //      stride steps clean over the whole thing. Measured that night: zero corruption counted at
  //      every one of seven rungs, then a hang. The detector was not silent; we never landed on it.
  //   2. **A session may go only `SESSION_MAX_DEPTH_BEYOND_KNOWN_MV` deeper than the deepest PASS it
  //      inherited.** A hang costs a reboot; this makes it cost at most one bounded excursion, and it
  //      makes the search converge over sessions instead of gambling in one.
  // THE GOVERNOR AND THE SESSION BOUNDS, composed by the ONE function the dry run also calls
  // (`composeAscentLadder`). Inlined here until 2026-08-14 22:xx, which is how `--dry-run` came to
  // print a ladder four times deeper than the one this loop would walk — the plan could not see the
  // bound that the incident of `bugs/07` bought. One computation, two readers.
  const composed = composeAscentLadder({
    fine, history, point, stride,
    capMhz,
    stockMv: fine.length ? fine[0].mv + fine[0].savedMv : null,
    sessionMaxDepthMv,
    fastFloorMv,
  });
  const chosen = composed.chosen;
  const ladderRungs = composed.ladderRungs;
  const ladder = ladderRungs.map((r) => r.offsetMhz);
  out.sessionDepth = composed.sessionDepth;
  out.rungs = fine.map((r) => ({ offsetMhz: r.offsetMhz, mv: r.mv, savedMv: r.savedMv }));
  out.ascentRungs = chosen.rungs.map((r) => ({ offsetMhz: r.offsetMhz, savedMv: r.savedMv }));
  if (chosen.refused) {
    out.halted = true;
    out.stopped = chosen.why;
    return out;
  }
  if (!ladder.length) {
    out.stopped = ratchet.bound
      ? `храповик не оставил места: разрешено ≤ ${ratchet.limitMhz} МГц, а грубый шаг ${coarseMhz}`
      : 'лестница пуста — проверьте шаг и предел железа';
    return out;
  }

  // THE WRITE-AHEAD MARK — `bugs/07`, and it is the difference between a catastrophe that teaches and
  // one that repeats. A rung that hangs the machine kills the process with it, so nothing survives to
  // write a verdict: on 2026-08-14 the store's last word was the PASS of the rung BEFORE the fatal
  // one, and the next session would have walked right back onto it. Recording the rung BEFORE trying
  // it turns silence into evidence — an unresolved mark carries `verdict: null`, which the ratchet
  // already treats as «not a pass».
  const markAhead = (offsetMhz) => {
    if (!store) return;
    // THE VOLTAGE THIS RUNG IS AIMED AT, written into the mark (`bugs/10`). The run may die before it
    // can OBSERVE a voltage, and the ratchet is now keyed by volts — so a mark with no voltage would
    // forbid nothing, which is exactly the hole the mark exists to close. `plannedMv` is the ladder's
    // own number, and it is named `planned`, not `serving`, because it is an intention: the observed
    // one lands in `servingMv` when the attempt comes back (EXP-0025 — never file a plan as a fact).
    const plannedMv = fine.find((r) => r.offsetMhz === offsetMhz)?.mv ?? null;
    append(store, {
      point, offsetMhz, workload: 'НАБОР', shape: 'попытка', seconds,
      plannedMv,
      verdict: null,
      reason: 'ступень НАЧАТА, вердикт ещё не дописан. Если запись осталась такой — прогон НЕ ПЕРЕЖИЛ эту ступень '
        + '(машина повисла или процесс убит), и храповик обязан считать её отказом',
      driver: card.driver, vbios: card.vbios, capMhz,
      writeShape: writeShape ?? null, capHeldBy: null,
      pending: true,
      tempStartC: null, tempReachedC: null, servingPoint: null, servingMv: null,
      launches: null, badElemsMax: null, faultRate: null, bitDistMin: null, opsPerSecond: null,
    });
  };

  for (const offsetMhz of ladder) {
    markAhead(offsetMhz);
    const result = await runStepFn({ point, offsetMhz, workload, seconds, sustain, capMhz, shapes, allPoints: wholeCurve, writeShape, pinMhz, pinCard });
    const a = await record(offsetMhz, result);
    const noUndervolt = refuseWithoutUndervolt(out, result, offsetMhz);
    if (noUndervolt) return out;
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

  // ---- bisect the bracket down to ONE GRID STEP
  //
  // With a voltage ladder the bracket is bisected over the RUNGS, so "one step" means one voltage
  // grid step wherever on the band we are, instead of a fixed 15 MHz that is 3.6 mV at the top and
  // 0.7 mV in the middle.
  if (Array.isArray(rungs) && rungs.length) {
    const inside = () => fine.filter((r) => r.offsetMhz > (out.lastPass ?? 0) && r.offsetMhz < out.firstFail);
    for (let guard = 0; guard < fine.length; guard++) {
      const between = inside();
      if (!between.length) break;
      const mid = between[Math.floor((between.length - 1) / 2)].offsetMhz;
      markAhead(mid);
      const result = await runStepFn({ point, offsetMhz: mid, workload, seconds, sustain, capMhz, shapes, allPoints: wholeCurve, writeShape, pinMhz, pinCard });
      const a = await record(mid, result);
      if (refuseWithoutUndervolt(out, result, mid)) return out;
      if (isPass(a.verdict)) { out.lastPass = mid; continue; }
      if (a.verdict === null) {
        out.halted = true;
        out.stopped = `НЕИЗВЕСТНО на +${mid} МГц во время бисекции — СТОП; вилка остаётся шире, но честной`;
        out.bracketMhz = out.firstFail - (out.lastPass ?? 0);
        return out;
      }
      out.firstFail = mid;
    }
    out.bracketMhz = out.firstFail - (out.lastPass ?? 0);
    const mvOfRung = (offset) => fine.find((r) => r.offsetMhz === offset)?.mv ?? null;
    const passMv = out.attempts.find((a) => a.offsetMhz === out.lastPass)?.servingMv ?? mvOfRung(out.lastPass);
    const failMv = out.attempts.find((a) => a.offsetMhz === out.firstFail)?.servingMv ?? mvOfRung(out.firstFail);
    out.servingMv = { atLastPass: passMv, atFirstFail: failMv };
    out.bracketMv = (passMv !== null && failMv !== null) ? Number((passMv - failMv).toFixed(3)) : null;
    out.stopped = out.bracketMv === 0
      ? `край ВЕРОЯТНОСТНЫЙ: обе стороны вилки обслуживает одно напряжение ${passMv} мВ`
      : `край взят в вилку ${out.bracketMv ?? '—'} мВ: ${passMv} мВ прошло, ${failMv} мВ отказало`;
    if (out.bracketMv === 0) out.probabilisticEdge = true;
    return out;
  }

  let lo = out.lastPass ?? 0;
  let hi = out.firstFail;
  while (hi - lo > fineMhz) {
    const mid = lo + Math.floor((hi - lo) / 2 / fineMhz) * fineMhz;
    if (mid <= lo || mid >= hi) break;
    markAhead(mid);
    const result = await runStepFn({ point, offsetMhz: mid, workload, seconds, sustain, capMhz, shapes, allPoints: wholeCurve, writeShape, pinMhz, pinCard });
    const a = await record(mid, result);
    if (refuseWithoutUndervolt(out, result, mid)) return out;
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
 *   7. collapse the set into ONE store record        → «в хранилище ложится запись НА КАЖДУЮ ФОРМУ»
 *   8. drop `shapes` on the way to the atom          → «набор доезжает до атома, а не теряется в движке»
 *   9. keep searching when the cap was not cheapened → «поиск ОСТАНАВЛИВАЕТСЯ, если запись не удешевила потолок»
 *  10. treat a MISSING undervolt block as zero       → «отсутствие наблюдения — не наблюдение нуля»
 *  11. start the ascent at the stride'th rung        → «ВОСХОЖДЕНИЕ НАЧИНАЕТСЯ С САМОЙ МЕЛКОЙ СТУПЕНИ»
 *  12. allow a first step deeper than the ceiling    → «слишком глубокий первый шаг — ОТКАЗ, а не усечение»
 *  13. leap a cliff in the ladder                    → «обрыв в лестнице не перешагивается»
 *  14. refuse only AFTER the first write             → «ОТКАЗ СТОРОЖА СЛУЧАЕТСЯ ДО ПЕРВОЙ ЗАПИСИ»
 *  15. drop `writeShape` on the way to the atom      → «форма записи доезжает до атома НА КАЖДОЙ ступени»
 *  16. record the shape the engine ASKED for         → «в хранилище ложится форма, которую вернул АТОМ, а не заказ движка»
 *  17. walk past the session depth ceiling            → «ГЛУБИНА СЕССИИ ограничена: дальше известного PASS не более чем на потолок»
 *  18. keep striding coarsely past proven ground      → «ЗА известным PASS шаг становится ТОЧНЫМ»
 *  19. stop writing the mark before the attempt       → «каждая попытка записана НАПЕРЁД»
 *  20. let the PLAN compose a ladder of its own       → «ПЛАН ВИДИТ ТУ ЖЕ ГЛУБИНУ, ЧТО ПРОЙДЁТ ПРОГОН»
 *  21. key the inherited evidence by POINT INDEX again → «УЛИКА ПЕРЕЖИВАЕТ СПОЛЗАНИЕ КРИВОЙ»
 *  22. drop the owner's floor for the fast descent      → «БЕЗ ИСТОРИИ спуск быстрый, но НЕ НИЖЕ пола владельца»
 *  23. keep stepping coarsely BELOW that floor          → «НИЖЕ ПОЛА ВЛАДЕЛЬЦА шаг ровно 5 мВ, а не грубый»
 *
 * ADDED WITH `plans/15` §4.1 — the owner's descent ladder (`descentLadder`). Addressees named BEFORE
 * the run (EXP-0016), and the RESULT is recorded honestly rather than as the tidy claim this header
 * first carried. **These four do NOT each redden exactly one block, and saying so would have been the
 * false half of a true statement**: `descentLadder` is a single walk, so breaking its core reddens
 * every block downstream of the walk — including the two card-level rung counts, which are downstream
 * of everything by construction. What each mutation owes is a block that goes red FOR ITS OWN REASON,
 * and the `got` value printed next to it names which reason. Measured 2026-08-15 21:4x:
 *
 *  24. round the grid mapping toward the DEEPER point   → 7 red · **discriminating block:**
 *      «округление всегда в сторону МЕЛКОЙ ступени» (got `stepMv: 30` where the policy allowed 25) —
 *      the only block no other mutation here reddens
 *  25. drop the zone boundaries (one step everywhere)   → 5 red · «зоны политики владельца: 25 → 10 → 5»
 *      prints `[25,null,null]`, which is the signature of THIS break (24 prints `[null,null,null]`).
 *      **Its red set is a subset of 24's, so it owns no exclusive block** — stated because a future
 *      session comparing counts would otherwise read that as an accident
 *  26. ignore the lever wall                            → 5 red · «ни одна ступень не уходит ЗА стену
 *      рычага», plus the 3 mV budget walking the entire grid (98 rungs) instead of stopping
 *  27. silence the forced-by-grid mark                  → **1 red, exactly its own**:
 *      «10 мВ там, где политика просила 5, ПОСЧИТАНЫ и названы»
 *
 * ADDED WITH `plans/15` §4.2 — seeding and the GENERALIZED first-step governor. Addressees named
 * BEFORE the run:
 *  28. re-base the governor on stock only (drop `provenSavedMv`) → «СТОРОЖ ОБОБЩЁН: от ДОКАЗАННОГО, а
 *      не от стока» — and CRUCIALLY not «БЕЗ УЛИК сторож ведёт себя ровно как сегодня», which must
 *      stay green under this mutation: the identity is what proves the change did not weaken anything
 *  29. let a `lever-limited` neighbour seed                     → «затравку даёт только ДОКАЗАННАЯ соседка»
 *  30. seed from a LOWER frequency                              → «затравка приходит только СВЕРХУ по частоте»
 *  31. continue seeded after a rejected seed                    → «не-PASS на затравке ОТМЕНЯЕТ её»
 *
 * ADDED WITH `plans/15` §4.3 — the rung's plan. Addressees named BEFORE the run:
 *  32. skip the serving check (trust «by construction»)         → «НЕМОНОТОННАЯ таблица ловится ДО записи»
 *  33. report a lever wall as an ordinary refusal               → «предел рычага НАЗВАН пределом рычага, а не краем»
 *
 * ADDED WITH `plans/15` §4.3, THE LIVE HALF — the rung's orchestration (`runRung`). Addressees named
 * BEFORE the run:
 *  34. call the atom even when the paper plan refused           → «бумажный отказ означает, что КАРТА НЕ ТРОНУТА»
 *  35. flatten the lever wall into an ordinary refusal here     → «предел рычага доезжает до исхода ступени, а не сплющивается в отказ»
 *  36. drop the re-assertion (trust the plan, not the card)     → «ступень, измерившая ЧУЖОЕ напряжение, не PASS»
 *  37. map НЕИЗВЕСТНО to a failure instead of a stop            → «НЕИЗВЕСТНО — это СТОП, а не отказ и не край»
 *  38. pin even when the CURVE holds the ceiling                → «ОДИН ДЕРЖАТЕЛЬ, НИКОГДА ДВА: под кривой закрепления нет»
 *  39. let a dirty rollback still report PASS                   → «грязный откат отменяет PASS»
 *
 * ADDED WITH `plans/15` §4.4 — the write-ahead journal, WIRED where the card is touched. (The
 * journal's own logic carries addressees 40–45 in `lib/sweep-journal.mjs`; these three are the
 * wiring's.) Named BEFORE the run:
 *  46. write the intent AFTER the atom instead of before   → «НАМЕРЕНИЕ УЖЕ НА ДИСКЕ В МОМЕНТ, КОГДА ТРОГАЮТ КАРТУ»
 *  47. skip the verdict line that closes the intent        → «вердикт ЗАКРЫВАЕТ намерение»
 *  48. ignore the blocked-rung set                         → «повесившая машину ДВАЖДЫ ПОДРЯД третий раз не начинается»
 *
 * ADDED WITH `plans/15` §4.6 — the refinement (`refineEdge`). The owner's rule, stated three times.
 * Addressees named BEFORE the run:
 *  49. ship the COARSE failure + margin, skipping the walk  → «край ищется шагом сетки, а не грубой ступенью»
 *  50. apply the margin to the LOCAL gap instead of the card's minimum step → «запас — ровно 10 мВ»
 *  51. snap the shipped voltage DOWN to the grid            → «отгружаемое напряжение округляется В СТОРОНУ ЗАПАСА»
 *  52. treat a non-PASS non-fail as progress                → «НЕИЗВЕСТНО в уточнении — СТОП, а не край»
 *  53. call a non-reproducing failure «reproduced»          → «невоспроизведённый отказ НАЗВАН невоспроизведённым»
 *
 * ⚠️ AND THE HARNESS ITSELF FAILED FIRST, which is the reusable part: its first version filtered the
 * output for «FAIL» while this suite prints «ПЛОХО», so it reported **0 red for all four mutations** —
 * a blind verifier reading exactly like a clean bill of health (EXP-0016's third face). It now also
 * asserts the suite's completion line, so a mutant that fails to LOAD cannot pass as «nothing red».
 */
export function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  // =============================================================================================
  // `plans/15` §4.1 — THE OWNER'S DESCENT LADDER ON THE CARD'S OWN NON-UNIFORM GRID
  //
  // The fixtures are the REAL grid where the claim is about this card, and a hand-built grid where the
  // claim is about the mapping RULE — a rule proved only on the real grid is a rule proved on one
  // sample. Both kinds are here on purpose.
  // =============================================================================================

  // A grid shaped like this card's: 5 mV steps with a 10 mV gap every 25 mV (measured, 94 × 5 and
  // 32 × 10 — `curves/voltage-grid.json`).
  const gridLikeCard = (() => {
    const v = [];
    for (let mv = 1240; mv >= 450; mv -= 5) {
      // the 10 mV gaps sit at 1235, 1210, 1185 … i.e. every 25 mV; skip the point below each
      if ((1235 - mv) % 25 === 5 && mv < 1235) continue;
      v.push(mv);
    }
    return v;
  })();
  const uniform5 = Array.from({ length: 159 }, (_, i) => 1240 - i * 5);

  // — the zones themselves: his 25 / 10 / 5 by DEPTH FROM STOCK, on a grid that can express all three
  const zoneWalk = descentLadder({ voltageGridMv: uniform5, stockVoltageMv: 1045, availableDepthMv: 200 });
  ok('зоны политики владельца: 25 → 10 → 5 мВ по глубине от стока',
    [zoneWalk.rungs.find((r) => r.depthMv === 25)?.stepMv,
      zoneWalk.rungs.find((r) => r.depthMv === 110)?.stepMv,
      zoneWalk.rungs.find((r) => r.depthMv === 155)?.stepMv],
    [25, 10, 5]);
  ok('граница зоны читается СТРОГО: на глубине ровно 100 шаг уже НЕ 25',
    zoneWalk.rungs.find((r) => r.depthMv === 100)?.stepMv === 25
      && zoneWalk.rungs.find((r) => r.depthMv > 100)?.stepMv === 10, true);

  // — the mapping direction, which is the whole safety content of the function
  //   A grid whose only point inside a 25 mV step is 20 mV down must yield 20, never the 30 below it.
  ok('округление всегда в сторону МЕЛКОЙ ступени, а не глубокой',
    descentLadder({ voltageGridMv: [1045, 1025, 1015, 990], stockVoltageMv: 1045, availableDepthMv: 100 }).rungs[0],
    { mv: 1025, depthMv: 20, stepMv: 20, zoneStepMv: 25, forcedByGrid: false });

  // — the forced case: the grid cannot express the policy step, and the run must SAY so
  const forced = descentLadder({ voltageGridMv: gridLikeCard, stockVoltageMv: 1045, availableDepthMv: 245 });
  ok('10 мВ там, где политика просила 5, ПОСЧИТАНЫ и названы',
    forced.forcedByGridCount > 0 && /сетка вынудила/.test(forced.why), true);
  ok('и ни один вынужденный шаг не пробивает сторож bugs/03 (потолок шага 35 мВ)',
    forced.rungs.every((r) => r.stepMv <= (config.ASCENT_STEP_MAX_MV ?? 35)), true);
  ok('первый шаг не глубже потолка первого шага владельца (25 мВ)',
    forced.rungs[0].stepMv <= (config.ASCENT_FIRST_STEP_MAX_MV ?? 25), true);

  // — the lever wall truncates; the policy does not
  const walled = descentLadder({ voltageGridMv: uniform5, stockVoltageMv: 1045, availableDepthMv: 60 });
  ok('стена рычага обрезает лестницу, а не глубина политики',
    [walled.rungs.at(-1).depthMv <= 60, walled.rungs.at(-1).mv >= walled.floorMv], [true, true]);
  ok('ни одна ступень не уходит ЗА стену рычага',
    walled.rungs.every((r) => r.mv >= 1045 - 60), true);

  // — THE OPERATOR'S CEILING ON DEPTH (the owner's condition for the first live sweep, 2026-08-16:
  //   «не спускаемся ниже 150 мВ в каждой частоте»). Five blocks, and the load-bearing one is the
  //   FOURTH: a run stopped by OUR decision must not report it as a property of the card.
  //   MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
  //     A. ignore `depthCapMv` outright                     → reddens «потолок обрезает», «пол ровно», «план несёт»
  //     B. `cappedByOperator` hard-wired to false           → reddens «прогон НАЗЫВАЕТ, что его остановило»
  //     C. `Math.max` instead of `Math.min` over the walls  → reddens «потолок обрезает», «пол ровно»
  //     D. cap applied even when the lever is shallower     → reddens «рычаг мельче потолка»
  //     E. drop `depthCapMv` from `planFrequency`'s return  → reddens «план несёт потолок»
  const uncapped = descentLadder({ voltageGridMv: gridLikeCard, stockVoltageMv: 1185, availableDepthMv: 300 });
  const capped150 = descentLadder({ voltageGridMv: gridLikeCard, stockVoltageMv: 1185, availableDepthMv: 300, depthCapMv: 150 });
  ok('потолок глубины обрезает лестницу РОВНО по 150 мВ от стока и не глубже',
    [capped150.rungs.at(-1).depthMv <= 150, capped150.rungs.every((r) => r.depthMv <= 150), capped150.cappedByOperator],
    [true, true, true]);
  ok('пол считается от СТОКА, а не от рычага: 1185 − 150 = 1035 мВ',
    capped150.floorMv, 1035);
  // The cap TRUNCATES the descent, it never re-routes it — otherwise the owner's 25/10/5 policy would
  // silently become a different policy whenever a ceiling is set.
  ok('потолок только УКОРАЧИВАЕТ путь: обрезанная лестница — точный префикс необрезанной',
    capped150.rungs.every((r, i) => uncapped.rungs[i]
      && uncapped.rungs[i].mv === r.mv && uncapped.rungs[i].stepMv === r.stepMv), true);
  // THE HONESTY BLOCK. `lever-limited` is built from this prose, and «предел рычага» over a stop that
  // was our own decision is the false-`[TESTED]` class this project hunts.
  ok('прогон НАЗЫВАЕТ, что его остановило: наш потолок — не «предел рычага»',
    [/потолком глубины 150/.test(capped150.why), /предел(ом)? рычага/.test(capped150.why)],
    [true, false]);
  // And the converse: a lever shallower than the ceiling still wins, and is still called by its name.
  const leverBeatsCap = descentLadder({ voltageGridMv: gridLikeCard, stockVoltageMv: 1185, availableDepthMv: 60, depthCapMv: 150 });
  ok('рычаг мельче потолка → останавливает рычаг, и это сказано его именем',
    [leverBeatsCap.cappedByOperator, /предел(ом)? рычага/.test(leverBeatsCap.why),
      leverBeatsCap.rungs.at(-1).depthMv <= 60],
    [false, true, true]);
  // THE BOUND MUST TRAVEL WITH THE PLAN — a bound the dry run cannot print is a bound the operator
  // never agreed to (`bugs/09`, EXP-0052: added to the run is not added until the PLAN says it).
  ok('план несёт потолок наружу, чтобы сухой прогон мог его напечатать',
    (() => {
      const p = planFrequency({
        frequencyMhz: 3090, stockVoltageMv: 1185, voltageGridMv: gridLikeCard,
        availableDepthMv: 300, depthCapMv: 150, curveDoc: null,
      });
      return [p.depthCapMv, p.cappedByOperator, p.floorMv];
    })(), [150, true, 1035]);

  // ─── THE THIRD WALL: A VOLTAGE THAT ALREADY HUNG THIS MACHINE (`bugs/23`) ───────────────────────
  //     MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
  //     68. drop the `next <= hangFloorMv` break        → reddens «ПОЛ ЗАВИСАНИЯ ОБРЕЗАЕТ ЛЕСТНИЦУ»
  //     69. make the break `<` instead of `<=`          → reddens «на САМ зависший рунг тоже не встаём»
  //     70. hard-wire `stoppedByHang` to false          → reddens «названо ЗАВИСАНИЕМ, а не рычагом»
  const hangFloored = descentLadder({
    voltageGridMv: uniform5, stockVoltageMv: 1045, availableDepthMv: 200, hangFloorMv: 970,
  });
  ok('ПОЛ ЗАВИСАНИЯ ОБРЕЗАЕТ ЛЕСТНИЦУ: ни одна ступень не уходит на зависшее напряжение или ниже',
    [hangFloored.rungs.every((r) => r.mv > 970), hangFloored.rungs.at(-1).mv, hangFloored.stoppedByHang],
    [true, 995, true]);
  // `<=` and not `<`: the hung rung ITSELF is the one we must never order again, and an off-by-one
  // here would order exactly it. This is the whole defect `bugs/23` was filed for.
  ok('на САМ зависший рунг тоже не встаём — 970 мВ в лестнице отсутствует',
    hangFloored.rungs.some((r) => r.mv === 970), false);
  ok('и остановка названа ЗАВИСАНИЕМ, а не рычагом и не нашим потолком',
    [/ЗАПИСАННЫМ ЗАВИСАНИЕМ/.test(hangFloored.why), /предел(ом)? рычага/.test(hangFloored.why)],
    [true, false]);
  // The lever is still allowed to be the shallower wall — the floor does not seize the report.
  ok('рычаг мельче пола зависания → останавливает рычаг, и пол молчит',
    (() => {
      const l = descentLadder({ voltageGridMv: uniform5, stockVoltageMv: 1045, availableDepthMv: 30, hangFloorMv: 970 });
      return [l.stoppedByHang, /предел(ом)? рычага/.test(l.why)];
    })(), [false, true]);
  // And the plan carries it outward, for the same reason it carries the depth cap (EXP-0052).
  ok('план несёт пол зависания наружу — сухой прогон обязан печатать эту стену',
    (() => {
      const p = planFrequency({
        frequencyMhz: 2842, stockVoltageMv: 1045, voltageGridMv: uniform5,
        availableDepthMv: 200, hangFloorMv: 970, curveDoc: null,
      });
      return [p.hangFloorMv, p.stoppedByHang, p.rungs.at(-1)?.mv ?? 'ступеней нет вовсе'];
    })(), [970, true, 995]);

  // ─── СОБСТВЕННАЯ УЛИКА ЧАСТОТЫ СИЛЬНЕЕ СОСЕДСКОЙ ЗАТРАВКИ (`bugs/31`, `plans/25` шаг 1.2) ───────
  //
  // Зеркало стены выше: пол зависания помнит, чем частота убилась, доказанная земля — на чём она
  // выстояла. Вторая половина вышла в бой без единого блока, и это замерено, а не предположено:
  // 2026-08-23 мутация «не читать собственную улику» оставила батарею зелёной, 959 блоков из 959.
  // Цена дефекта названа живым прогоном — 2820 МГц шла 995 → 870 тринадцатью ступенями, каждая из
  // которых уже проходила; владелец: «край найден у точки, какого хуя вновь с неё начинать».
  //
  // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
  //   CI. не читать `provenPassMv`                        → «СПУСК СТАРТУЕТ ОТ СОБСТВЕННОЙ УЛИКИ»
  //   CJ. брать соседскую затравку вместо глубочайшей     → «БЕРЁТСЯ ГЛУБОЧАЙШАЯ ИЗ ДВУХ УЛИК»
  //   CK. врать об источнике (`seedFromOwnEvidence`)      → «ИСТОЧНИК ЗАТРАВКИ НАЗВАН ЧЕСТНО»
  //   CL. пропустить улику мимо пола зависания            → «ПОЛ ОТМЕНЯЕТ И СОБСТВЕННУЮ УЛИКУ»
  {
    // Соседка 2850 МГц оттюнена до 990 мВ — это и есть затравка, которую даёт `seedFor`.
    const docWithNeighbour = {
      kind: 'tuning-curve', voltageGridMv: uniform5,
      frequencies: [
        { mhz: 2850, voltageMv: 990, stockVoltageMv: 1045, tags: [CURVE_TAGS.STOP_EDGE_FOUND, CURVE_TAGS.BURN_SHORT], provenBy: 'прожиг' },
        { mhz: 2842, voltageMv: 1045, stockVoltageMv: 1045, tags: [CURVE_TAGS.STOP_UNTOUCHED], provenBy: null },
      ],
    };
    const plan = (over = {}) => planFrequency({
      frequencyMhz: 2842, stockVoltageMv: 1045, voltageGridMv: uniform5,
      availableDepthMv: 200, curveDoc: docWithNeighbour, ...over,
    });
    const neighbourOnly = plan();
    ok('без собственной улики затравка приходит от соседки — прежнее поведение цело',
      [neighbourOnly.seedMv, neighbourOnly.seedFromOwnEvidence], [990, false]);
    // Улика ГЛУБЖЕ соседкиной — и решает она: 870 доказаны РОВНО на этой частоте.
    const own = plan({ provenPassMv: 870 });
    ok('СПУСК СТАРТУЕТ ОТ СОБСТВЕННОЙ УЛИКИ: доказанные 870 мВ, а не соседкины 990',
      [own.seedMv, own.startMv], [870, 870]);
    // ⚠️ ЧИСЛО СЭКОНОМЛЕННЫХ СТУПЕНЕЙ БЛОК СЧИТАЕТ САМ, а не сверяется с числом из головы: первая
    // редакция этой строки ждала 24 (прикидка на равномерной сетке), прогон дал 12 — лестница идёт
    // по зонам 25/10/5 от ГЛУБИНЫ, а не по сетке. Утверждение, сравнивающее «получено» с «ждали»,
    // обязано делать сравнение само (EXP-0016 и урок блоков облака тегов).
    ok('и ступеней остаётся ровно столько, сколько НЕ пройдено — сэкономленные не жгутся заново',
      [own.rungs.every((r) => r.mv < 870),
        neighbourOnly.rungs.length - own.rungs.length === neighbourOnly.rungs.filter((r) => r.mv >= 870).length,
        own.rungs.length < neighbourOnly.rungs.length],
      [true, true, true]);
    ok('ИСТОЧНИК ЗАТРАВКИ НАЗВАН ЧЕСТНО: сухой прогон не выдаёт свою улику за соседкину',
      [own.seedFromOwnEvidence, neighbourOnly.seedFromOwnEvidence], [true, false]);
    // БЕРЁТСЯ ГЛУБОЧАЙШАЯ ИЗ ДВУХ. Обе улики законны: соседкина доказана ВЫШЕ по частоте (Vmin не
    // убывает с частотой), собственная — ровно здесь. Мельче — значит лишние прожиги.
    ok('БЕРЁТСЯ ГЛУБОЧАЙШАЯ ИЗ ДВУХ УЛИК: соседка глубже собственной — стартуем от соседки',
      plan({ provenPassMv: 1010 }).seedMv, 990);
    ok('и мельче стока улика не считается вовсе — «доказано на стоке» это не доказательство спуска',
      [plan({ provenPassMv: 1045 }).seedMv, plan({ provenPassMv: 1200 }).seedFromOwnEvidence], [990, false]);
    // ПОЛ ОТМЕНЯЕТ И СОБСТВЕННУЮ УЛИКУ. Прыжок есть прыжок: затравка не ступень лестницы, и пол
    // лестницы её не спасёт — она доставила бы нас на убившее напряжение ПЕРВЫМ же прожигом.
    const blocked = plan({ provenPassMv: 870, hangFloorMv: 880 });
    ok('ПОЛ ОТМЕНЯЕТ И СОБСТВЕННУЮ УЛИКУ: 870 мВ ниже стены 880 — спуск идёт от стока',
      [blocked.seedMv, blocked.seedBlockedByHang, blocked.startMv], [null, true, 1045]);
  }

  // — depth shallower than one grid step: an honest empty ladder, and NOT a refusal
  const tooShallow = descentLadder({ voltageGridMv: uniform5, stockVoltageMv: 1045, availableDepthMv: 3 });
  ok('глубина мельче одной ступени сетки → пустая лестница, но не отказ',
    [tooShallow.rungs.length, tooShallow.refused], [0, false]);
  ok('и причина названа словами, а не пустой строкой', tooShallow.why.length > 20, true);

  // — the numbers this card actually produces. `researches/09` §4.1 predicted 28 at 2842 MHz from an
  //   IDEALIZED grid; the real grid gives 24 because each 10 mV gap in the deep zone swallows a rung.
  //   The block asserts the MEASURED number and states the research's, so a future edit that "fixes"
  //   the count back to 28 reddens here instead of quietly re-introducing the idealization.
  ok('2842 МГц на РЕАЛЬНОЙ сетке: 24 ступени, а не идеализированные 28 из researches/09 §4.1',
    descentLadder({ voltageGridMv: gridLikeCard, stockVoltageMv: 1045, availableDepthMv: 245 }).rungs.length, 24);
  ok('2400 МГц: 7 ступеней — здесь формула и сетка сходятся, и последняя ступень встаёт РОВНО на стену',
    (() => {
      const l = descentLadder({ voltageGridMv: gridLikeCard, stockVoltageMv: 910, availableDepthMv: 125 });
      return [l.rungs.length, l.rungs.at(-1).depthMv];
    })(), [7, 125]);

  // — THE OWNER'S EDGE RULE, guarded where it can be violated. The coarse ladder above exists only to
  //   approach the edge; the number that SHIPS comes from the finest walk the card allows plus ONE
  //   grid step over the LAST STABLE rung (his re-anchoring, 2026-08-17), and nothing else may reach
  //   `marginAboveLastStableMv`.
  ok('запас владельца на этой карте = 5 мВ (ОДИН измеренный шаг сетки) над последней стабильной',
    (() => { try { return marginAboveLastStableMv().millivolts; } catch (e) { return `упало: ${e.message.slice(0, 40)}`; } })(), 5);
  ok('ЛОКАЛЬНЫЙ РАЗРЫВ сетки в 10 мВ, поданный как шаг, ПАДАЕТ — иначе запас молча удвоился бы',
    (() => { try { marginAboveLastStableMv(10); return 'не упало'; } catch (e) { return /до 10 мВ над последней стабильной/.test(e.message) ? 'упало и назвало причину' : 'упало без причины'; } })(),
    'упало и назвало причину');

  // =============================================================================================
  // `plans/15` §4.2 — SEEDING, AND THE GOVERNOR THAT HAD TO GROW UP
  // =============================================================================================

  const seedDoc = {
    frequencies: [
      { mhz: 3090, voltageMv: 1100, tags: ['stop:edge-found'] },
      { mhz: 2900, voltageMv: 1050, tags: ['stop:lever-limited'] },   // our lever ran out — NOT evidence
      { mhz: 2842, voltageMv: 1000, tags: ['burn:short'] },
      { mhz: 2400, voltageMv: 900, tags: ['stop:untouched'] },            // untouched — nothing proven
      { mhz: 2000, voltageMv: 850, tags: ['burn:long'] },
    ],
  };

  ok('затравка приходит только СВЕРХУ по частоте, и от БЛИЖАЙШЕЙ доказанной соседки',
    seedFor({ frequencyMhz: 2500, curveDoc: seedDoc }),
    { seedMv: 1000, neighbourMhz: 2842, neighbourStatus: 'short-burn-proved' });
  ok('затравку даёт только ДОКАЗАННАЯ соседка: lever-limited пропускается, берётся следующая выше',
    seedFor({ frequencyMhz: 2850, curveDoc: seedDoc })?.neighbourMhz, 3090);
  ok('стоковая соседка не затравка — прожига там не было',
    seedFor({ frequencyMhz: 2300, curveDoc: seedDoc })?.neighbourMhz, 2842);
  ok('выше всех частот затравки нет — спуск от стока, и это НЕ ошибка',
    seedFor({ frequencyMhz: 3090, curveDoc: seedDoc }), null);
  ok('пустой документ кривой → затравки нет, а не выдуманное напряжение',
    seedFor({ frequencyMhz: 2500, curveDoc: { frequencies: [] } }), null);

  // — the governor's generalization, and the IDENTITY that proves it did not weaken anything
  const deepLadder = [{ savedMv: 150 }, { savedMv: 160 }, { savedMv: 170 }, { savedMv: 180 }];
  ok('БЕЗ УЛИК сторож ведёт себя ровно как сегодня: первый шаг −150 мВ ОТКАЗ (потолок 25)',
    pickAscentRungs(deepLadder).refused, true);
  ok('СТОРОЖ ОБОБЩЁН: от ДОКАЗАННОГО, а не от стока — та же лестница при доказанных −140 мВ ПРОХОДИТ',
    pickAscentRungs(deepLadder, { provenSavedMv: 140 }).refused, false);
  ok('и обобщение НЕ безгранично: доказанных −100 мВ мало для шага в −150 (это −50 от доказанного)',
    pickAscentRungs(deepLadder, { provenSavedMv: 100 }).refused, true);
  ok('отказ НАЗЫВАЕТ обе величины — и шаг от доказанного, и саму ступень',
    (() => { const w = pickAscentRungs(deepLadder, { provenSavedMv: 100 }).why; return /50 мВ/.test(w) && /150 мВ/.test(w); })(), true);
  ok('правило 3 обобщением НЕ тронуто: обрыв между ступенями остаётся обрывом и на доказанной земле',
    pickAscentRungs([{ savedMv: 145 }, { savedMv: 150 }, { savedMv: 400 }], { provenSavedMv: 140 }).refused, true);

  // — the seed's first burn is a PROOF, and its rejection is a finding
  ok('PASS на затравке: спуск идёт ОТ неё, и её глубина становится доказанной землёй',
    (() => { const o = seedOutcome({ verdict: config.VERDICT.PASS, seedMv: 900, stockVoltageMv: 1045, neighbourMhz: 2842, frequencyMhz: 2400 }); return [o.seeded, o.restartFromStock, o.provenSavedMv]; })(),
    [true, false, 145]);
  ok('не-PASS на затравке ОТМЕНЯЕТ её: спуск заново от стока, доказанной земли НЕТ',
    (() => { const o = seedOutcome({ verdict: config.VERDICT.SDC, seedMv: 900, stockVoltageMv: 1045, neighbourMhz: 2842, frequencyMhz: 2400 }); return [o.seeded, o.restartFromStock, o.provenSavedMv]; })(),
    [false, true, 0]);
  ok('и это печатается как НАХОДКА О КРЕМНИИ с обеими частотами и обоими напряжениями',
    (() => { const n = seedOutcome({ verdict: config.VERDICT.SDC, seedMv: 900, stockVoltageMv: 1045, neighbourMhz: 2842, frequencyMhz: 2400 }).note; return /2400/.test(n) && /2842/.test(n) && /900/.test(n) && /1045/.test(n) && /находка/.test(n); })(), true);
  ok('НЕИЗВЕСТНО на затравке тоже отменяет её — не-PASS это не только отказ',
    seedOutcome({ verdict: null, seedMv: 900, stockVoltageMv: 1045, neighbourMhz: 2842, frequencyMhz: 2400 }).seeded, false);

  // =============================================================================================
  // `plans/15` §4.3 — THE RUNG'S PLAN: the uniform raise that puts ONE voltage under the pinned clock
  // =============================================================================================

  // A monotone slice of a card-like table: lower voltage → lower stock frequency.
  const tablePoints = [
    { i: 90, mv: 1000, mhz: 2700 },
    { i: 94, mv: 1040, mhz: 2842 },
    { i: 97, mv: 1060, mhz: 2900 },
    { i: 61, mv: 835, mhz: 2100 },
    { i: 47, mv: 745, mhz: 500 },
  ];

  ok('сдвиг считается так, чтобы ЗАКАЗАННОЕ напряжение обслуживало закреплённую частоту',
    (() => { const p = planRung({ points: tablePoints, clockMhz: 2842, voltageMv: 1000 }); return [p.ok, p.deltaMhz, p.serving.mv]; })(),
    [true, 142, 1000]);
  ok('и на самой стоковой паре сдвиг ноль, а обслуживающая запись — она сама',
    (() => { const p = planRung({ points: tablePoints, clockMhz: 2842, voltageMv: 1040 }); return [p.ok, p.deltaMhz]; })(),
    [true, 0]);
  ok('напряжения нет в таблице карты → отказ, а не ближайшее похожее',
    planRung({ points: tablePoints, clockMhz: 2842, voltageMv: 999 }).ok, false);

  // — the lever wall is its own verdict, never an edge (`plans/13` E2-AC2)
  ok('предел рычага НАЗВАН пределом рычага, а не краем',
    (() => { const p = planRung({ points: tablePoints, clockMhz: 2842, voltageMv: 745 }); return [p.ok, p.leverLimited === true, /ПРЕДЕЛ РЫЧАГА/.test(p.why)]; })(),
    [false, true, true]);
  ok('и он печатает сам нужный сдвиг рядом с тем, что принимает железо',
    (() => { const w = planRung({ points: tablePoints, clockMhz: 2842, voltageMv: 745 }).why; return /2342/.test(w) && /1000/.test(w); })(), true);

  // — the check that «by construction» is not allowed to replace (R12, EXP-0057)
  const nonMonotone = [
    { i: 10, mv: 800, mhz: 2600 },   // LOWER voltage, HIGHER frequency than its neighbour below
    { i: 11, mv: 900, mhz: 2000 },
  ];
  ok('НЕМОНОТОННАЯ таблица ловится ДО записи: ступень мерила бы ЧУЖОЕ напряжение',
    (() => { const p = planRung({ points: nonMonotone, clockMhz: 2400, voltageMv: 900 }); return [p.ok, p.serving?.mv]; })(),
    [false, 800]);
  ok('и отказ называет ОБЕ записи — заказанную и ту, что обслуживала бы на самом деле',
    (() => { const w = planRung({ points: nonMonotone, clockMhz: 2400, voltageMv: 900 }).why; return /900 мВ/.test(w) && /800 мВ/.test(w); })(), true);

  ok('обслуживающую запись выбирает то же правило, что у карты: самое НИЗКОЕ напряжение из дотянувшихся',
    servingAfterRaise(tablePoints, 142, 2842)?.mv, 1000);
  ok('никто не дотянулся → null, а не выдуманная запись',
    servingAfterRaise(tablePoints, 0, 3500), null);

  // — degenerate inputs refuse rather than invent
  ok('пустая сетка → отказ, а не молчаливая пустая лестница',
    descentLadder({ voltageGridMv: [], stockVoltageMv: 1045, availableDepthMv: 100 }).refused, true);
  ok('сток не назван → отказ (глубина отсчитывается от него)',
    descentLadder({ voltageGridMv: uniform5, stockVoltageMv: null, availableDepthMv: 100 }).refused, true);

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
    // =============================================================================================
    // `plans/15` §4.3, THE LIVE HALF — ONE RUNG ORCHESTRATED (`runRung`)
    //
    // Everything here runs on an INJECTED atom, an INJECTED vector builder and the REAL
    // `chooseWriteShape`: the decision under test is this module's, the write shape's decision belongs
    // to the function that already owns it, and no line of this reaches a GPU (F2-AC10).
    // =============================================================================================

    // The atom, as a recorder: it remembers what it was handed, and answers what the block needs.
    const atomLog = [];
    const atom = (reply) => async (args) => {
      atomLog.push(args);
      return typeof reply === 'function' ? reply(args) : reply;
    };
    const cleanUndo = [{ name: 'ОТКАТ: вся кривая обнулена', ok: true, undo: true, detail: '' }];
    // A PASS as the atom reports one: the verdict, the deciding shape, and — the load-bearing part —
    // the voltage the CARD says served the clock after the write.
    const atomPass = (servingMv) => ({
      verdict: P, worstShape: 'sdc_fma/transient', deliveredMhz: 2842, deliveredMaxMhz: 2845,
      undervolt: { capMhz: 2842, after: { pointIndex: 90, mv: servingMv } },
      blocks: cleanUndo,
    });

    // Vectors as `buildRaiseAndCapVector` returns them. Above the curve's cap floor (2172 MHz here)
    // the CURVE can carry the ceiling; below it, only a pin can.
    const vectorCapped = () => ({ ok: true, capEnforced: true, capMhz: 2842, topMhz: 3172, lowestEnforceableCapMhz: 2172, capLeakMhz: 0 });
    const vectorLeaky = () => ({ ok: true, capEnforced: false, capMhz: 1700, topMhz: 3172, lowestEnforceableCapMhz: 2172, capLeakMhz: 472 });

    // A low-band table: below 2172 MHz, where epic 02 exists because the curve cannot cap at all.
    const lowPoints = [
      { i: 40, mv: 760, mhz: 1400 },
      { i: 45, mv: 790, mhz: 1700 },
      { i: 50, mv: 820, mhz: 1900 },
    ];

    // WHAT THE ATOM WAS ACTUALLY HANDED — read through a stub rather than by dereferencing, because a
    // mutation that makes the rung REFUSE leaves `atomLog` empty and `atomLog[0].capMhz` then KILLS
    // the whole suite instead of reddening one block. That is EXP-0075, and this is the FIFTH time
    // this project has paid for it: mutation G («ceiling = the clock under test») crashed the reporter
    // on 2026-08-16 exactly here. A block must be able to go red about the case it is guarding.
    const atomArg = (k) => (atomLog.length ? atomLog[0][k] : `АТОМ НЕ ВЫЗЫВАЛСЯ (ступень отказала до записи)`);

    // `envelopeMhz` is the card's maximum graphics clock (3090 on this instance, against a V/F table
    // whose top reads 3172). Every locked rung needs it — see the refusal block right below.
    const rungOK = async (over = {}) => {
      atomLog.length = 0;
      return runRung({
        points: tablePoints, clockMhz: 2842, voltageMv: 1000, envelopeMhz: 3090,
        buildVector: vectorCapped, runStepFn: atom(atomPass(1000)), ...over,
      });
    };

    // — the happy path: the atom is called ONCE, with the plan's own arithmetic
    const good = await rungOK();
    ok('исправная ступень зовёт атом РОВНО ОДИН РАЗ', atomLog.length, 1);
    ok('и передаёт ему сдвиг и запись ИЗ ПЛАНА, а не из заказа',
      [atomArg('offsetMhz'), atomArg('point'), atomLog.length ? (atomLog[0].pinMhz ?? atomLog[0].capMhz) : 'АТОМ НЕ ВЫЗЫВАЛСЯ'], [142, 90, 2842]);
    ok('исход исправной ступени — PASS', [good.outcome, good.verdict, good.undoClean], ['passed', P, true]);

    // — a paper refusal means the card is NEVER touched. `bugs/03`'s whole lesson is that the cheapest
    //   refusal is the one that happens before the first write.
    const nonMono = await rungOK({ points: nonMonotone, clockMhz: 2400, voltageMv: 900 });
    ok('бумажный отказ означает, что КАРТА НЕ ТРОНУТА',
      [nonMono.outcome, atomLog.length, nonMono.cardTouched], ['refused', 0, false]);

    const lever = await rungOK({ voltageMv: 745 });
    ok('предел рычага доезжает до исхода ступени, а не сплющивается в отказ',
      [lever.outcome, atomLog.length, /ПРЕДЕЛ РЫЧАГА/.test(lever.why)], ['lever-limited', 0, true]);

    const atStock = await rungOK({ voltageMv: 1040 });
    ok('напряжение, которое обслуживает частоту уже на стоке, — не ступень спуска',
      [atStock.outcome, atomLog.length], ['refused', 0]);

    // — F2-AC9: who holds the ceiling, named on every rung, and never two at once
    // — THE DEFAULT IS THE FLATTENED CURVE, NOT A CLOCK LOCK (`researches/11`, measured 2026-08-16:
    //   `-lgc 3082,3082` delivered 2887, `-lgc 2700,2700` delivered 2692 — a lock is a CEILING and
    //   cannot lift a card). `bugs/12`'s diagnosis stands, its remedy did not: the lock as a default
    //   made the first live sweep stop on its first rung. The lock stays REACHABLE because below the
    //   curve's cap floor it is the only holder there is.
    //   MUTATION ADDRESSEES, NAMED BEFORE THE RUN:
    //     F. default `demandPin` back to true          → «ПО УМОЛЧАНИЮ ЗАМКА НЕТ»
    //     G. pass the cap alongside the pin            → «потолок и замок НИКОГДА не на одной частоте»
    //     H. ignore `demandPin` in `chooseWriteShape`  → «ЗАКРЕПЛЕНИЕ ПО ЗАПРОСУ»
    //     I. delete the explicit locked shape          → «ЗАКРЕПЛЕНИЕ ПО ЗАПРОСУ»
    // Re-run first: three refusing rungs stand between `good` and here, and `atomLog` holds only the
    // LAST call. Reading it stale would assert about a rung that is not the one named.
    const byDefault = await rungOK();
    ok('ПО УМОЛЧАНИЮ ЗАМКА НЕТ: потолок стоит на ИСПЫТУЕМОЙ частоте и держит его КРИВАЯ',
      [byDefault.holder, byDefault.writeShape, atomArg('capMhz'), atomArg('pinMhz')],
      ['кривая', 'raise-and-cap', 2842, null]);

    // THE LOCKED SHAPE, ON REQUEST. Its ceiling is the card's ENVELOPE, never the clock under test —
    // two holders on ONE frequency is what fought on 2026-08-14.
    const locked = await rungOK({ demandPin: true });
    ok('ЗАКРЕПЛЕНИЕ ПО ЗАПРОСУ: держит замок, а потолок уезжает на конверт карты',
      [locked.holder, locked.writeShape, atomArg('capMhz'), atomArg('pinMhz')],
      ['закрепление частоты', 'raise-and-cap', 3090, 2842]);
    ok('потолок и замок НИКОГДА не встают на одну частоту — именно это дралось 2026-08-14',
      atomLog.length ? atomLog[0].capMhz === atomLog[0].pinMhz : 'АТОМ НЕ ВЫЗЫВАЛСЯ', false);

    const low = await rungOK({ points: lowPoints, clockMhz: 1700, voltageMv: 760, buildVector: vectorLeaky });
    ok('ниже пола кривой потолок держит ЗАКРЕПЛЕНИЕ, и оно доезжает до атома',
      [low.holder, low.writeShape, atomArg('pinMhz'), atomArg('offsetMhz')],
      ['закрепление частоты', 'uniform', 1700, 300]);

    // NOTHING CAN HOLD THE CEILING — the refusal keeps its own wording on each path.
    const noHolder = await rungOK({ points: lowPoints, clockMhz: 1700, voltageMv: 760, buildVector: vectorLeaky, canPin: false });
    ok('потолок не держит НИЧТО → отказ ДО записи, а не открытие посреди прожига',
      [noHolder.outcome, atomLog.length, /не держит НИЧТО/.test(noHolder.why)], ['refused', 0, true]);
    const noHolderLocked = await rungOK({
      points: lowPoints, clockMhz: 1700, voltageMv: 760, buildVector: vectorLeaky, canPin: false, demandPin: true,
    });
    ok('и по запросу закрепления тот же отказ звучит про НЕВОЗМОЖНОСТЬ ЗАПЕРЕТЬ частоту',
      [noHolderLocked.outcome, /ЗАКРЕПИТЬ/.test(noHolderLocked.why)], ['refused', true]);

    // — THE ENVELOPE IS REQUIRED, NEVER GUESSED (R13, `bugs/11`). A locked raise with no ceiling lifts
    //   the curve's tail (3172 here) above the card's maximum (3090) — the 82 MHz gap the BSOD escaped
    //   through. Without the envelope the rung REFUSES; it does not fall back to «cap at the top of
    //   the V/F table», which would read 3172 and prove nothing.
    //   ADDRESSEES: J. default the envelope to the curve's top → this block · K. drop the same-clock
    //   refusal → «конверт и испытуемая частота не совпадают».
    const noEnvelope = await rungOK({ envelopeMhz: null, demandPin: true });
    ok('БЕЗ КОНВЕРТА КАРТЫ закреплённая ступень ОТКАЗЫВАЕТ — конверт не выдумывается (R13, bugs/11)',
      [noEnvelope.outcome, atomLog.length, /bugs\/11|R13/.test(noEnvelope.why)], ['refused', 0, true]);
    // AND THE DEGENERATE CASE: testing the envelope itself would put the ceiling and the lock on ONE
    // frequency — exactly the 2026-08-14 conflict. Refused before any write, and the refusal says why.
    const atEnvelope = await rungOK({ clockMhz: 3090, voltageMv: 1000, envelopeMhz: 3090, demandPin: true });
    ok('конверт и испытуемая частота не совпадают: прогон на самом максимуме ОТКАЗЫВАЕТ до записи',
      [atEnvelope.outcome, atomLog.length, /2026-08-14/.test(atEnvelope.why)], ['refused', 0, true]);
    // The ceiling that actually reaches the atom under the lock is the ENVELOPE, and the clock under
    // test reaches it as the PIN. Two different numbers, and swapping them would record the voltage
    // of a frequency nobody burned.
    await rungOK({ demandPin: true });
    ok('под замком в атом едут ДВА РАЗНЫХ числа: потолок = конверт, испытуемая частота = замок',
      [atomArg('capMhz'), atomArg('pinMhz')], [3090, 2842]);

    // — THE RE-ASSERTION against the card's own re-read table. This is what the paper proof may not
    //   replace (R12, EXP-0057): the plan says the voltage WOULD serve; only the card says it DID.
    //   ⚠️ ЧТО ЗДЕСЬ СУДИТСЯ — ГЛУБИНА ОТ ДОКАЗАННОГО, А НЕ РАССТОЯНИЕ ДО ЗАКАЗА (`interviews/009`).
    //
    //   ПРЕЖНЯЯ ПАРА БЛОКОВ СТОРОЖИЛА ДРУГОЕ ПОВЕДЕНИЕ и заменена целиком, а не подправлена. Она
    //   требовала «выдача ниже заказа -> void» и на живом прогоне 2026-08-16 остановила здоровую
    //   развёртку: на 2857 МГц заказали 1025, карта подставила 1020 — соседнюю ступень своей сетки.
    //   По собственным числам развёртки останавливать было НЕ ЗА ЧТО: сток той частоты 1050, то есть
    //   приземление на 1020 это шаг 30 мВ при стене `cliffMv` = 35.
    //
    //   Промах неизбежен и знанием сетки не лечится: напряжение нельзя заказать (у записи оно
    //   закреплено, двигается частота), а какая запись дотянется до испытуемой частоты — решает карта
    //   по оси, которая ЕДЕТ с нагревом (R14b). Поэтому судить надо факт приземления, и тем же числом,
    //   которым план судил намерение.
    //
    //   ⚠️ И ОБРАТИТЬ ВНИМАНИЕ НА ВТОРОЙ БЛОК: замена НЕ ослабила проверку, она её РАСШИРИЛА. Прежняя
    //   редакция пропускала молча выдачу ВЫШЕ заказа, но глубоко ниже доказанного; новая её ловит,
    //   и `atomPass(940)` — фикстура ровно этого случая, которую старый код прошёл бы как PASS.
    const nearMiss = await rungOK({ runStepFn: atom(atomPass(995)), provenMv: 1020, maxStepFromProvenMv: 35 });
    ok('промах на соседнюю ступень ВНИЗ — ПОПАДАНИЕ, пока шаг от доказанного в стене (25 из 35)',
      [nearMiss.outcome, nearMiss.measuredMv, nearMiss.orderedMv], ['passed', 995, 1000]);
    const tooDeep = await rungOK({ runStepFn: atom(atomPass(940)), provenMv: 1020, maxStepFromProvenMv: 35 });
    ok('шаг от ДОКАЗАННОГО глубже стены — void, даже если выдача ВЫШЕ заказа (старый код это пропускал)',
      [tooDeep.outcome, tooDeep.measuredMv], ['void', 940]);
    ok('и отказ называет доказанное, заказанное, выданное и стену — все четыре числа',
      /1020 мВ/.test(tooDeep.why) && /1000 мВ/.test(tooDeep.why) && /940 мВ/.test(tooDeep.why) && /35/.test(tooDeep.why), true);
    ok('без доказанной земли проверка глубины НЕ выдумывается — прежнее поведение сохранено',
      (await rungOK({ runStepFn: atom(atomPass(995)) })).outcome, 'passed');
    // ─── ОБЕ ВЕЛИЧИНЫ ОБЯЗАНЫ БЫТЬ ОБ ОДНОЙ ЧАСТОТЕ (`bugs/34`) ─────────────────────────────────
    //
    // Найдено стендом 2026-08-23, как только виртуальная карта научилась проседать: `provenMv`
    // доказано на ЗАКАЗАННОЙ частоте, а `measuredMv` — напряжение, обслуживающее ту, на которой
    // карта РЕАЛЬНО работала. Пока карту закрепляли, это была одна частота. Канон 2026-08-22 сделал
    // просадку нормой, и разность стала расти САМА: более низкую частоту обслуживает более низкая
    // запись кривой. Сторож останавливал развёртку на первой же ступени законного заказа.
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   DB. судить глубину и при просадке              → «ПРОСАДКА НЕ РОНЯЕТ СТУПЕНЬ»
    //   DC. считать просадкой любое расхождение        → «ПРОСАДКА — ЭТО НЕ ОКРУГЛЕНИЕ СЕТКИ»
    //   DD. отключить сторож глубины совсем            → «НА СВОЕЙ ЧАСТОТЕ СТОРОЖ ПО-ПРЕЖНЕМУ ДЕРЖИТ»
    {
      const sagPass = (deliveredMhz, servingMv) => ({
        verdict: P, worstShape: 'sdc_fma/transient', deliveredMhz, deliveredMaxMhz: deliveredMhz,
        undervolt: { capMhz: 2842, after: { pointIndex: 90, mv: servingMv } },
        blocks: cleanUndo,
      });
      // Карта ушла на 2782 МГц (60 МГц вниз), и обслуживает ту частоту 940 мВ. По старой арифметике
      // это «шаг 80 мВ от доказанных 1020 при стене 35» — остановка на ровном месте.
      const sag = await rungOK({ runStepFn: atom(sagPass(2782, 940)), provenMv: 1020, maxStepFromProvenMv: 35 });
      ok('ПРОСАДКА НЕ РОНЯЕТ СТУПЕНЬ: карта ушла на другую частоту — глубина судится не здесь',
        [sag.outcome, sag.measuredMv, sag.deliveredMhz], ['passed', 940, 2782]);
      ok('и пропуск сторожа НАЗВАН, а не сделан молча',
        typeof sag.depthGuardSkipped === 'string' && /другую частоту/.test(sag.depthGuardSkipped), true);
      // ПРОСАДКА — ЭТО НЕ ОКРУГЛЕНИЕ СЕТКИ. Одна ступень лестницы частот (7–8 МГц) это то, как
      // `clocks.gr` вообще докладывает число; принять её за просадку значило бы отключить сторож
      // почти всегда — и мутация «считать просадкой любое расхождение» краснит именно этот блок.
      const rounded = await rungOK({ runStepFn: atom(sagPass(2835, 940)), provenMv: 1020, maxStepFromProvenMv: 35 });
      ok('ПРОСАДКА — ЭТО НЕ ОКРУГЛЕНИЕ СЕТКИ: 7 МГц вниз это та же частота, и сторож работает',
        rounded.outcome, 'void');
      // И ГЛАВНОЕ, ЧТО НЕ ОСЛАБЛЕНО: на СВОЕЙ частоте глубокое приземление по-прежнему останавливает.
      const own = await rungOK({ runStepFn: atom(atomPass(940)), provenMv: 1020, maxStepFromProvenMv: 35 });
      ok('НА СВОЕЙ ЧАСТОТЕ СТОРОЖ ПО-ПРЕЖНЕМУ ДЕРЖИТ: глубокое приземление без просадки — void',
        [own.outcome, own.measuredMv], ['void', 940]);
    }
    //   ВЫШЕ ЗАКАЗА, НО НИЖЕ СТОКА — честный замер. Ступень заказана на глубине 40 мВ (сток 1040),
    //   выдача 1005 лежит между заказом и стоком.
    const above = await rungOK({ runStepFn: atom(atomPass(1005)), depthMv: 40 });
    ok('ПОПАЛИ ВЫШЕ — ЭТО ПОПАДАНИЕ: выдача между заказом и стоком, ступень ПРОШЛА',
      [above.outcome, above.measuredMv, above.orderedMv], ['passed', 1005, 1000]);
    ok('и мерой становится ВЫДАННОЕ напряжение, а заказанное названо рядом',
      /1005 мВ обслуживает/.test(above.why) && /заказано было 1000 мВ/.test(above.why), true);
    //   ГРАНИЦА НЕ В СТУПЕНЯХ СЕТКИ, А В СТОКЕ — так решил живой прогон 2026-08-16: ступень,
    //   посчитанная по СВЕЖЕЙ таблице, промахнулась на две ступени, потому что таблица едет ВНУТРИ
    //   прожига. Допуск в ступенях подбирался бы под сегодняшний нагрев. Осмысленный предел один:
    //   выдача на стоке или выше означает, что запись не добилась ничего.
    //   ВЫДАЧА РОВНО НА СТОКЕ — ЧЕСТНЫЙ ЗАМЕР, а не поломка. Живой прогон отверг первую редакцию
    //   границы (`>=`): дрейф за время прожига съел весь первый шаг −25 мВ, карта вернулась на сток,
    //   и сторож объявил поломкой обычное «шаг ничего не дал» — покрытие упало с 5 частот из 10 до
    //   одной. Спуск после такой ступени просто идёт дальше.
    const servedAtStock = await rungOK({ runStepFn: atom(atomPass(1040)), depthMv: 40 });
    ok('ВЫДАЧА РОВНО НА СТОКЕ — ЗАМЕР, а не поломка: шаг ничего не дал, спуск идёт дальше',
      [servedAtStock.outcome, servedAtStock.measuredMv], ['passed', 1040]);
    //   ПОЛОМКА — ТОЛЬКО ВЫШЕ СТОКА: такого напряжения карта частоте не давала.
    const aboveStock = await rungOK({ runStepFn: atom(atomPass(1060)), depthMv: 40 });
    ok('ВЫДАЧА ВЫШЕ СТОКА — НЕ ЗАМЕР: выше заводского мы частоту не поднимали',
      [aboveStock.outcome, /ВЫШЕ СТОКА/.test(aboveStock.why)], ['void', true]);
    //   И СТОРОЖ НЕ ЗАВИСИТ ОТ ТОГО, ЧТО ЕМУ ПЕРЕДАЛИ. Дыру нашла мутация AX: пока сток считался как
    //   `voltageMv + depthMv`, вызов БЕЗ глубины молча отключал проверку — сторож, который выключается
    //   отсутствием аргумента, это не сторож. Сток читается из таблицы, которая для ступени обязательна.
    const aboveStockNoDepth = await rungOK({ runStepFn: atom(atomPass(1060)) });
    ok('и он работает БЕЗ переданной глубины: сток берётся из таблицы, а не из аргумента',
      [aboveStockNoDepth.outcome, /ВЫШЕ СТОКА/.test(aboveStockNoDepth.why)], ['void', true]);
    const noVolt = await rungOK({ runStepFn: atom({ verdict: P, blocks: cleanUndo }) });
    ok('отсутствие наблюдения — не наблюдение совпадения', noVolt.outcome, 'void');
    //   И ОТКАЗ НЕСЁТ УЛИКУ, А НЕ ТОЛЬКО ЖАЛОБУ (`bugs/22`). Атом ИЗМЕРИЛ верх кривой после записи, а
    //   сообщение его выбрасывало — и поскольку блоки атома нигде не сохраняются (ни журнал, ни
    //   live.json их не несут), каждое срабатывание стоило отдельного расследования. Утверждается
    //   ПРИЧИНА, а не факт остановки: «встало» зелено от любого другого отказа (EXP-0075, триггер 2).
    const noVoltWithProof = await rungOK({
      runStepFn: atom({ verdict: P, blocks: cleanUndo,
        undervolt: { capMhz: 2865, orderedMhz: 2872, askedAtMhz: 2865, offeredAfterMhz: 2865, after: null } }),
    });
    ok('ОТКАЗ НАЗЫВАЕТ ИЗМЕРЕННЫЙ ВЕРХ КРИВОЙ, а не только то, чего не хватает',
      [noVoltWithProof.outcome,
        /не выше 2865 МГц/.test(noVoltWithProof.why ?? 'строки отказа нет вовсе'),
        /спрашивали о 2865 МГц/.test(noVoltWithProof.why ?? 'строки отказа нет вовсе')],
      ['void', true, true]);
    ok('а когда верх НЕ измерен — отказ говорит и это, вместо молчания',
      /верх кривой после записи не измерен вовсе/.test(noVolt.why ?? 'строки отказа нет вовсе'), true);

    // — UNKNOWN is a STOP, and a failure is a SIGNAL rather than the edge (the owner's rule, §4.6)
    const unknown = await rungOK({ runStepFn: atom({ verdict: null, blocks: cleanUndo, reason: 'эталон просрочен' }) });
    ok('НЕИЗВЕСТНО — это СТОП, а не отказ и не край',
      [unknown.outcome, /СТОП/.test(unknown.why)], ['unknown', true]);
    const failed = await rungOK({ runStepFn: atom({ verdict: config.VERDICT.SDC, worstShape: 'sdc_fma/transient', undervolt: { after: { mv: 1000 } }, blocks: cleanUndo }) });
    ok('отказ оракула — это СИГНАЛ близкого края, и ступень говорит это словами',
      [failed.outcome, /СИГНАЛ/.test(failed.why) && /5 мВ/.test(failed.why)], ['failed', true]);

    // — the rollback. A rung whose undo failed is never a PASS: the next rung would start on a card
    //   nobody can describe.
    const dirty = await rungOK({
      runStepFn: atom({ ...atomPass(1000), blocks: [{ name: 'ОТКАТ: частота ОТПУЩЕНА', ok: false, undo: true, detail: 'сброс отказал' }] }),
    });
    ok('грязный откат отменяет PASS', [dirty.outcome, dirty.undoClean], ['unknown', false]);
    ok('и ступень называет, какой именно шаг отката не отработал', /ОТКАТ: частота ОТПУЩЕНА/.test(dirty.why), true);
    ok('и вместе с именем — ПРИЧИНУ, а не только «что делалось»', /сброс отказал/.test(dirty.why), true);

    // ─── ПРОВЕРКА — НЕ ОТКАТ, И ГОВОРИТ ОНА ДРУГОЕ (`plans/28`, находка A) ────────────────────────
    //
    // Оплачено живым прогоном 2026-08-23: владелец увидел «ОТКАТ НЕ ЧИСТ … состояние карты назвать
    // нельзя» на прогоне, где карта была ЧИСТА (кривая заводская, сторож не взведён, сирот нет).
    // Виновата была одна строка: доказательство потолка ЧИТАЕТ, но ехало с `undo: true`, и его имя
    // — утвердительное, «ПОТОЛОК … УСТОЯЛ» — подставлялось в шаблон «шаг не отработал».
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   DM. вернуть проверке `undo: true`            → «отказ ПРОВЕРКИ не объявляется грязным откатом»
    //   DN. печатать имя блока вместо причины        → «остановка называет ПРИЧИНУ»
    //   DP. пропускать ступень при отказе проверки   → «отказ проверки всё равно ОСТАНАВЛИВАЕТ»
    const proofFailed = await rungOK({
      runStepFn: atom({
        ...atomPass(1000),
        blocks: [
          { name: 'ОТКАТ: вся кривая обнулена', ok: true, undo: true, detail: '' },
          {
            name: 'ПОТОЛОК 2790 МГц УСТОЯЛ ПОД НАГРУЗКОЙ',
            ok: false, undo: false, proof: true,
            why: 'карта ушла ВЫШЕ потолка: максимум 2805 МГц при потолке 2790',
            detail: 'проверка не прошла: карта ушла ВЫШЕ потолка: максимум 2805 МГц при потолке 2790',
          },
        ],
      }),
    });
    ok('отказ ПРОВЕРКИ не объявляется грязным откатом — карта вернулась, и так и сказано',
      [proofFailed.undoClean, /ОТКАТ НЕ ЧИСТ/.test(proofFailed.why), /ОТКАТ ПРИ ЭТОМ ОТРАБОТАЛ/.test(proofFailed.why)],
      [true, false, true]);
    ok('остановка называет ПРИЧИНУ отказа проверки, а не одно её имя',
      /максимум 2805 МГц при потолке 2790/.test(proofFailed.why), true);
    ok('утвердительное имя проверки стоит ПОЗАДИ причины и в кавычках — иначе читается как вывод',
      proofFailed.why.indexOf('карта ушла ВЫШЕ') < proofFailed.why.indexOf('«ПОТОЛОК 2790 МГц УСТОЯЛ'), true);
    ok('отказ проверки всё равно ОСТАНАВЛИВАЕТ — вердикта о напряжении нет, судить не по чему',
      [proofFailed.outcome, proofFailed.proofsClean], ['unknown', false]);
    // The undo is recognised by its FIELD, not by its name — otherwise the check is a truth↔mirror
    // pair against block wording and drifts the first time a name is reworded.
    const redButNotUndo = await rungOK({
      runStepFn: atom({ ...atomPass(1000), blocks: [{ name: 'ОТКАТ: похоже на откат, но это не он', ok: false }] }),
    });
    ok('грязный откат опознаётся ПОЛЕМ блока, а не подстрокой в его имени',
      [redButNotUndo.outcome, redButNotUndo.undoClean], ['passed', true]);

    // — the probe itself: the owner's ten seconds, in the one shape voltage noise lives in
    ok('короткий прожиг — ОДНА форма, и это транзиент',
      [SHORT_PROBE.length, SHORT_PROBE[0]?.id], [1, 'sdc_fma/transient']);
    ok('десять секунд владельца (ideas/03 шаг 9) доезжают до атома вместе с формой',
      [atomArg('seconds'), atomLog.length ? atomLog[0].shapes?.[0]?.id : 'АТОМ НЕ ВЫЗЫВАЛСЯ'],
      [config.SWEEP_PROBE_SECONDS, 'sdc_fma/transient']);

    // — R1: this module decides, it does not write
    let rungThrew = false;
    try { await runRung({ points: tablePoints, clockMhz: 2842, voltageMv: 1000 }); } catch { rungThrew = true; }
    ok('без атома ступень БРОСАЕТ, а не пишет в карту сама', rungThrew, true);

    // — the record the journal (§4.4) and the sweep (§4.5) will key on
    ok('запись ступени несёт всё, на чём будет ключеваться журнал',
      ['frequencyMhz', 'voltageMv', 'deltaMhz', 'pointIndex', 'outcome', 'verdict', 'writeShape', 'holder', 'undoClean']
        .filter((k) => good[k] === undefined), []);

    // =============================================================================================
    // `plans/15` §4.4 — THE WRITE-AHEAD JOURNAL, WIRED WHERE THE CARD IS TOUCHED
    //
    // The journal's own logic is proved in `sweep-journal --selftest` (17 blocks). What is proved
    // HERE is the WIRING, and specifically its ORDER — the property that cannot be checked inside the
    // journal module because only the rung knows when the card is touched.
    // =============================================================================================

    const journalBox = mkdtempSync(join(tmpdir(), 'kago-engine-journal-'));
    try {
      const jrn = openJournal({ dir: join(journalBox, 'wired') });
      const clock = () => '2026-08-15T23:15:00+03:00';

      // THE DRILL, and it is the whole criterion F2-AC4: the atom looks at the journal AT THE MOMENT
      // it is called — i.e. at the instant the card would be touched — and reports what it finds
      // there. A rung whose intent lands after the write would find nothing.
      let seenAtCardTime = null;
      const wired = await runRung({
        envelopeMhz: 3090,
        points: tablePoints, clockMhz: 2842, voltageMv: 1000,
        buildVector: vectorCapped, journal: jrn, seq: 1, now: clock,
        depthMv: 45, zoneStepMv: 25, seeded: true,
        runStepFn: async () => {
          seenAtCardTime = readJournal(jrn).records.map((r) => [r.state, r.frequencyMhz ?? null, r.voltageMv ?? null]);
          return atomPass(1000);
        },
      });
      ok('НАМЕРЕНИЕ УЖЕ НА ДИСКЕ В МОМЕНТ, КОГДА ТРОГАЮТ КАРТУ (и это F2-AC4 целиком)',
        seenAtCardTime, [['intent', 2842, 1000]]);
      ok('и оно несёт всё, чем восстанавливают спуск после перезагрузки',
        // The stub is the EXP-0075 rule again: a mutation that makes the rung refuse on paper writes
        // no intent at all, and dereferencing `records[0]` would kill the reporter instead of
        // reddening this one block.
        (() => {
          const i = readJournal(jrn).records[0];
          if (!i) return 'НАМЕРЕНИЯ В ЖУРНАЛЕ НЕТ (ступень отказала до записи)';
          return [i.depthMv, i.zoneStepMv, i.seeded, i.holder, i.writeShape, i.pointIndex];
        })(),
        [45, 25, true, 'кривая', 'raise-and-cap', 90]);
      ok('вердикт ЗАКРЫВАЕТ намерение — иначе следующий запуск обвинил бы законченную ступень в зависании',
        [wired.outcome, orphanIntents(readJournal(jrn).records).length], ['passed', 0]);

      // A rung refused ON PAPER never reaches the journal: an intent for a rung nobody ran is a rung
      // the next launch would mark ЗАВИС for a hang that never happened.
      const jrn2 = openJournal({ dir: join(journalBox, 'paper-refusal') });
      await runRung({
        envelopeMhz: 3090,
        points: tablePoints, clockMhz: 2842, voltageMv: 745,
        buildVector: vectorCapped, journal: jrn2, seq: 1, now: clock,
        runStepFn: atom(atomPass(1000)),
      });
      ok('бумажный отказ в журнал НЕ попадает — это ступень, которую никто не прогонял',
        readJournal(jrn2).records.length, 0);

      // THE KILL DRILL. A throwing atom leaves the rung exactly as a dead machine would: an intent
      // with no verdict. The next launch must name that rung and close it as ЗАВИС.
      const jrn3 = openJournal({ dir: join(journalBox, 'killed') });
      let died = false;
      try {
        await runRung({
          envelopeMhz: 3090,
          points: tablePoints, clockMhz: 2842, voltageMv: 1000,
          buildVector: vectorCapped, journal: jrn3, seq: 7, now: clock,
          runStepFn: async () => { throw new Error('машина перестала существовать'); },
        });
      } catch { died = true; }
      const after = resumeState(jrn3, { at: clock() });
      ok('убитый посреди ступени прогон оставляет НАМЕРЕНИЕ, и следующий запуск называет ту самую ступень',
        [died, after.hung.map((h) => [h.frequencyMhz, h.voltageMv, h.seq])], [true, [[2842, 1000, 7]]]);
      // `?.` with a spoken fallback, not a bare `.verdict` — a block that throws takes the report with
      // it, and the mutation that should have reddened it reads as «suite did not complete» instead
      // (EXP-0040). Measured: mutation 46 crashed this line before the fallback existed.
      ok('и закрывает её вердиктом ЗАВИС — первого класса, словом владельца',
        readJournal(jrn3).records.find((r) => r.state === 'verdict')?.verdict ?? 'строки вердикта нет вовсе',
        config.VERDICT.HUNG);

      // F2-AC5 at the point where the card is touched: a rung blocked by two hangs is not started.
      atomLog.length = 0;
      const blocked = await runRung({
        envelopeMhz: 3090,
        points: tablePoints, clockMhz: 2842, voltageMv: 1000,
        buildVector: vectorCapped, runStepFn: atom(atomPass(1000)),
        blockedKeys: new Set(['2842/1000']),
      });
      ok('ступень, повесившая машину ДВАЖДЫ ПОДРЯД, третий раз не начинается, и атом не зван',
        [blocked.outcome, atomLog.length, /не край, а поломка/.test(blocked.why)], ['refused', 0, true]);

      // ─── ПРОЖИГ ПЕРЕИГРЫВАЕТСЯ, ПОКА НЕ СЯДЕТ НА НАСТРАИВАЕМУЮ ЧАСТОТУ (слово владельца) ─────
      //   АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
      //     CC. не переигрывать вовсе (брать первый ответ)      → «НЕДОБОР ПЕРЕИГРЫВАЕТСЯ»
      //     CD. продолжать спуск по лестнице после успеха       → «ОСТАНАВЛИВАЕМСЯ НА ПЕРВОЙ УДЕРЖАВШЕЙ»
      //     CE. молча брать последнюю попытку, если все не смогли → «НИ ОДНА НЕ УДЕРЖАЛА — ЭТО ВИДНО»
      //     CF. не записывать попытки                            → «КАЖДАЯ ПОПЫТКА ЗАПИСАНА»
      {
        // Атом, который «зажимает» частоту, пока нагрузка сильнее порога: ровно поведение карты,
        // упирающейся в предел мощности. `shapes[0].id` несёт ступень, как и в боевом наборе.
        const atomThrottling = (holdsFromLevel) => async (args) => {
          atomLog.push(args);
          const lvl = Number(String(args.shapes?.[0]?.id ?? '@0').split('@')[1] ?? 0);
          const held = lvl >= holdsFromLevel;
          return {
            verdict: held ? P : null,
            worstShape: 'furnace/transient',
            deliveredMhz: held ? 2842 : 2820,
            deliveredMaxMhz: held ? 2845 : 2825,
            deliveredShortfallMhz: held ? 0 : 22,
            clockShortfall: !held,
            undervolt: { capMhz: 2842, after: { pointIndex: 90, mv: 1000 } },
            blocks: cleanUndo,
          };
        };
        const ladder4 = [0, 1, 2, 3].map((l) => [{ id: `furnace/transient@${l}`, workload: 'furnace', bearsVerdict: true }]);

        atomLog.length = 0;
        const eased = await runRung({
          envelopeMhz: 3090, points: tablePoints, clockMhz: 2842, voltageMv: 1000,
          buildVector: vectorCapped, runStepFn: atomThrottling(2), shapeLadder: ladder4,
        });
        ok('НЕДОБОР ПЕРЕИГРЫВАЕТСЯ ОСЛАБЛЕННОЙ НАГРУЗКОЙ, а не записывается как вердикт',
          [atomLog.length, eased.verdict, eased.burnedAtTunedFrequency], [3, P, true]);
        ok('ОСТАНАВЛИВАЕМСЯ НА ПЕРВОЙ УДЕРЖАВШЕЙ СТУПЕНИ — самый сильный честный прожиг',
          eased.loadLevelUsed, 2);
        ok('КАЖДАЯ ПОПЫТКА ЗАПИСАНА — и видно, на какой частоте шла каждая',
          eased.loadAttempts.map((a) => [a.level, a.deliveredMhz, a.heldTheFrequency]),
          [[0, 2820, false], [1, 2820, false], [2, 2842, true]]);

        atomLog.length = 0;
        const neverHeld = await runRung({
          envelopeMhz: 3090, points: tablePoints, clockMhz: 2842, voltageMv: 1000,
          buildVector: vectorCapped, runStepFn: atomThrottling(99), shapeLadder: ladder4,
        });
        ok('НИ ОДНА СТУПЕНЬ НЕ УДЕРЖАЛА — ЭТО ВИДНО, а не выдано за вердикт о частоте',
          [atomLog.length, neverHeld.burnedAtTunedFrequency, neverHeld.verdict],
          [4, false, null]);

        atomLog.length = 0;
        const noLadder = await runRung({
          envelopeMhz: 3090, points: tablePoints, clockMhz: 2842, voltageMv: 1000,
          buildVector: vectorCapped, runStepFn: atom(atomPass(1000)),
        });
        ok('БЕЗ ЛЕСТНИЦЫ — ПРЕЖНЕЕ ПОВЕДЕНИЕ: одна попытка, ничего не переигрывается',
          [atomLog.length, noLadder.verdict], [1, P]);
      }
    } finally {
      rmSync(assertJournalSandbox({ dir: journalBox }), { recursive: true, force: true });
    }

    // =============================================================================================
    // `plans/15` §4.6 — THE REFINEMENT: a coarse failure is a SIGNAL, the edge is found at 5 mV
    //
    // The owner's rule, stated three times. The coarse ladder only reaches the neighbourhood; the
    // number that SHIPS is always `V_fail(grid step) + 10 mV`.
    // =============================================================================================

    // This card's shape: 5 mV mostly, with a 10 mV gap every 25 mV.
    const refineGrid = gridLikeCard;
    const scriptRung = (failsAtOrBelow) => async (mv) => ({
      outcome: mv <= failsAtOrBelow ? 'failed' : 'passed',
      verdict: mv <= failsAtOrBelow ? config.VERDICT.SDC : P,
    });

    // — the walk finds the failure the coarse rung only signalled
    // The threshold is a voltage that EXISTS on this grid — 1030 does not: it is one of the 32 places
    // where the card's own gap is 10 mV, and picking it as a fixture would have been testing a rung
    // the card cannot be asked for (EXP-0072's lesson, met again in a fixture).
    const walked = [];
    const fine = await refineEdge({
      voltageGridMv: refineGrid, lastPassMv: 1045, coarseFailMv: 1015,
      runRungFn: async (mv) => { walked.push(mv); return (await scriptRung(1025)(mv)); },
    });
    ok('край ищется ШАГОМ СЕТКИ от последнего прошедшего, а не грубой ступенью',
      [walked[0], fine.failMv, fine.reproduced, fine.refined], [1040, 1025, true, true]);
    // 🔴 THIS IS THE OWNER'S 2026-08-17 CASE, AND THE FIXTURE LANDS ON IT BY ACCIDENT OF THE REAL GRID.
    // 1035 → 1025 is one of this card's 10 mV intervals. Under the old anchor («failure + two minimum
    // steps») the shipped voltage was 1025 + 10 = **1035 — the last stable rung itself**, i.e. a
    // cushion of exactly zero over proven ground. The block was green and the margin was not there.
    // Under his anchor the cushion is added to the PASS: 1035 + 5 → 1040 on the card's own grid.
    ok('запас кладётся на ПОСЛЕДНЮЮ СТАБИЛЬНУЮ, а не на отказ — на разрыве 10 мВ старая форма давала НОЛЬ',
      [fine.lastPassMv, fine.failMv, fine.shipMv], [1035, 1025, 1040]);
    ok('спуск уточнения идёт СВЕРХУ ВНИЗ, ступенями сетки — ни одного прыжка',
      walked.slice(0, 3), [1040, 1035, 1025]);

    // — the margin snaps UP where the grid cannot express «last stable + 5» exactly
    const gapGrid = [1045, 1035, 1025, 1015];        // a pure 10 mV grid — the owner's hard case
    const snapped = await refineEdge({
      voltageGridMv: gapGrid, lastPassMv: 1045, coarseFailMv: 1015,
      runRungFn: scriptRung(1025),
    });
    ok('отгружаемое напряжение округляется В СТОРОНУ ЗАПАСА, к напряжению, которое у карты ЕСТЬ',
      [snapped.lastPassMv, snapped.failMv, snapped.shipMv], [1035, 1025, 1045]);
    ok('и там, где у карты нет шага 5 мВ, прогон ГОВОРИТ, что край локализован её разрешением',
      [snapped.resolutionMv, /разрешением карты/.test(snapped.why)], [10, true]);

    // — the coarse rung was already one grid step: nothing to walk, and that is not a defect
    const already = await refineEdge({
      voltageGridMv: [1055, 1050, 1045, 1040, 1035], lastPassMv: 1045, coarseFailMv: 1040,
      runRungFn: async () => { throw new Error('уточнению здесь нечего прогонять'); },
    });
    ok('грубая ступень БЫЛА одним шагом сетки → уточнять нечего, и это не дефект',
      [already.ok, already.refined, already.failMv, already.shipMv], [true, false, 1040, 1050]);

    // — the failure that does not come back is NAMED, not dressed up
    const notBack = await refineEdge({
      voltageGridMv: refineGrid, lastPassMv: 1045, coarseFailMv: 1020,
      runRungFn: scriptRung(1000),                    // nothing between 1045 and 1020 fails
    });
    ok('невоспроизведённый отказ НАЗВАН невоспроизведённым, а не выдан за найденный край',
      [notBack.ok, notBack.reproduced, notBack.failMv, /НЕ ВОСПРОИЗВЁЛСЯ/.test(notBack.why)],
      [true, false, 1020, true]);
    // The three fine rungs all passed, so the last stable is 1025; 1025 + 5 = 1030, and 1030 is one of
    // this card's 10 mV gaps — the value does not exist. So the shipped voltage snaps UP to 1035:
    // toward MORE margin, never toward the failure.
    ok('и отгружается ПОСЛЕДНЯЯ СТАБИЛЬНАЯ + 5 мВ, подтянутое ВВЕРХ к существующему (1030 у карты нет)',
      [notBack.lastPassMv, notBack.shipMv], [1025, 1035]);

    // — anything that is not PASS and not a failure STOPS the refinement
    const stopped = await refineEdge({
      voltageGridMv: refineGrid, lastPassMv: 1045, coarseFailMv: 1020,
      runRungFn: async () => ({ outcome: 'unknown', why: 'оракул не смог' }),
    });
    ok('НЕИЗВЕСТНО в уточнении — СТОП, а не край',
      [stopped.ok, stopped.halted, stopped.failMv, stopped.shipMv], [false, true, null, null]);

    // — the margin helper is asked with the CARD'S minimum step, never with a local gap
    let marginThrew = false;
    try { marginAboveLastStableMv(10); } catch { marginThrew = true; }
    ok('запас — ровно ОДИН шаг сетки (5 мВ), и подсунуть ему локальный разрыв НЕЛЬЗЯ',
      [marginAboveLastStableMv().millivolts, marginThrew], [5, true]);

    // — R1 again: the refinement decides, it does not write
    let refineThrew = false;
    try { await refineEdge({ voltageGridMv: refineGrid, lastPassMv: 1045, coarseFailMv: 1020 }); } catch { refineThrew = true; }
    ok('без прогонщика ступеней уточнение БРОСАЕТ, а не пишет в карту само', refineThrew, true);

    // — an inverted bracket is a refusal, not a silent empty walk
    ok('перевёрнутая вилка — отказ с именем, а не пустая прогулка',
      (await refineEdge({ voltageGridMv: refineGrid, lastPassMv: 1000, coarseFailMv: 1020, runRungFn: scriptRung(0) })).ok,
      false);

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

    // --- THE DEPTH GOVERNOR, and it is here because the previous rung selection HUNG THE OWNER'S
    // MACHINE FOR FIVE HOURS (bugs/03). Every block below is one of the three rules that would each,
    // alone, have prevented it.
    {
      const rung = (savedMv, offsetMhz) => ({ offsetMhz, mv: 1000 - savedMv, savedMv });
      // seven graded rungs, 5 mV apart — the shape the 1100 MHz sweep actually had
      const seven = [5, 10, 15, 20, 25, 30, 35].map((mv, i) => rung(mv, 100 + i * 100));

      const p = pickAscentRungs(seven, { stride: 5 });
      // NULL-SAFE ON PURPOSE: a block that THROWS when its expectation is unmet reports nothing at
      // all, and the suite dies instead of naming the broken guarantee — mutation 11 did exactly that
      // on the first attempt (EXP-0016, third strike of this class in this project).
      ok('ВОСХОЖДЕНИЕ НАЧИНАЕТСЯ С САМОЙ МЕЛКОЙ СТУПЕНИ', p.rungs[0]?.savedMv ?? null, 5);
      ok('и она — именно первая строка лестницы, а не пятая', p.rungs[0]?.offsetMhz ?? null, seven[0].offsetMhz);
      ok('самая глубокая ступень всё равно достижима', p.rungs[p.rungs.length - 1]?.savedMv ?? null, 35);

      // A ladder whose SHALLOWEST rung is already deeper than the first-step ceiling must be refused
      // outright: a region where nothing shallower exists is a region this lever does not enter.
      const cliffFirst = [rung(295, 320), rung(300, 400)];
      const r2 = pickAscentRungs(cliffFirst, { stride: 5 });
      ok('слишком глубокий первый шаг — ОТКАЗ, а не усечение', r2.refused, true);
      ok('и ни одной ступени при этом не предлагается', r2.rungs.length, 0);
      ok('и отказ назван так, что его нельзя принять за пустую лестницу', /первого шага/.test(r2.why), true);

      // A cliff LATER in the ladder is the same plunge with a later index — this card's bottom is
      // exactly this shape: −5 mV, then −230 mV.
      const cliffLater = [rung(5, 20), rung(230, 95), rung(295, 320)];
      const r3 = pickAscentRungs(cliffLater, { stride: 5 });
      ok('обрыв в лестнице не перешагивается', r3.refused, true);
      ok('но мелкая ступень до обрыва остаётся доступной', r3.rungs[0]?.savedMv ?? null, 5);

      // The un-graded path (the fixed-MHz ladder, every offline fixture) is left exactly as handed in:
      // the governor bounds DEPTH, and a depth it cannot see it must not pretend to bound.
      const plain = [{ offsetMhz: 75 }, { offsetMhz: 150 }, { offsetMhz: 225 }];
      ok('лестница без градуировки по напряжению проходит нетронутой', pickAscentRungs(plain).rungs.length, 3);

      // AND THE GUARANTEE THAT ACTUALLY PROTECTS THE MACHINE: a refused ladder must cost ZERO WRITES.
      // A governor that refuses AFTER the first rung has already been applied protects nothing — the
      // plunge has happened by then. This block is the difference between a rule and a rule that acts.
      let writes = 0;
      const counting = async () => { writes++; return { verdict: P }; };
      const refused = await searchEdge({
        capMhz: 1100, point: 51, runStepFn: counting,
        rungs: [rung(5, 20), rung(230, 95), rung(295, 320)],
      });
      ok('ОТКАЗ СТОРОЖА СЛУЧАЕТСЯ ДО ПЕРВОЙ ЗАПИСИ, а не после неё', writes, 0);
      ok('и поиск честно говорит, что он остановлен', refused.halted, true);
      ok('и не выдаёт ни вилки, ни последнего PASS', [refused.bracketMhz, refused.lastPass], [null, null]);

      // …while a ladder the governor accepts is walked normally, so the refusal is not a blanket stop.
      let writes2 = 0;
      const ok2 = await searchEdge({
        capMhz: 2842, point: 95, runStepFn: async () => { writes2++; return { verdict: P }; },
        rungs: [5, 10, 15, 20, 25, 30].map((mv, i) => rung(mv, 10 + i * 10)),
      });
      ok('принятая лестница проходится как обычно', writes2 > 0, true);
      ok('и остановкой её не объявляют', Boolean(ok2.halted), false);
    }

    // --- THE GUARD bugs/02 WAS BORN FROM. The search's whole premise is that the offset it walks
    // makes the CAPPED CLOCK cheaper. When the applied write cannot do that, a bracket in
    // millivolts is a claim about a voltage the card was never at — which is exactly what happened
    // on 2026-08-11, for seven rungs, while the block saying so sat red among twelve green ones.
    {
      const withSaving = (savedMv) => async ({ offsetMhz }) => ({
        verdict: offsetMhz < 200 ? P : config.VERDICT.SDC,
        undervolt: { capMhz: 2842, savedMv, after: { pointIndex: 94, mv: 1040 } },
      });
      const inert = await searchEdge({ capMhz: 2842, point: 95, runStepFn: withSaving(0) });
      ok('поиск ОСТАНАВЛИВАЕТСЯ, если запись не удешевила потолок', inert.noUndervoltAtCap, true);
      ok('и делает это на ПЕРВОЙ же ступени, а не после всей лестницы', inert.attempts.length, 1);
      ok('и вилки при этом не выдаёт вовсе', inert.bracketMhz, null);
      ok('и причина названа так, что её не прочесть как курьёз', /НЕ удешевляет потолок/.test(inert.stopped), true);

      // a NEGATIVE saving is the same refusal — the cap got MORE expensive
      const worse = await searchEdge({ capMhz: 2842, point: 95, runStepFn: withSaving(-5) });
      ok('подорожавший потолок — тот же отказ, а не «почти ноль»', worse.noUndervoltAtCap, true);

      // and a real saving must NOT be stopped
      const real = await searchEdge({ capMhz: 2842, point: 95, runStepFn: withSaving(155) });
      ok('настоящая экономия поиск не останавливает', Boolean(real.noUndervoltAtCap), false);
      ok('и вилка у него есть', real.bracketMhz, ASCENT_FINE_MHZ);

      // ABSENCE OF THE OBSERVATION IS NOT AN OBSERVATION OF ZERO — every offline fixture and the
      // atom's own dry run report no undervolt block at all, and they must pass through untouched.
      const silent = await run((o) => (o < 200 ? P : config.VERDICT.SDC));
      ok('отсутствие наблюдения — не наблюдение нуля', Boolean(silent.noUndervoltAtCap), false);
    }

    // --- THE STORE PATH, and it is here because its ABSENCE cost a live run.
    // Every block above ran with `store: null`, so the persistence branch was never executed once —
    // and the first real search died on its first record, on a field the store could have defaulted.
    // A selftest that exercises only the paths without side effects is a selftest with a hole exactly
    // where the side effects are.
    const prodBefore = existsSync(VMIN_DIR) ? readdirSync(VMIN_DIR).length : 0;
    // The sweep journal has a production directory too, and this suite drives the journal through
    // `runRung` and `sweepRange`. `bugs/08` is what a suite that writes into production costs.
    const sweepBefore = existsSync(SWEEP_DIR) ? readdirSync(SWEEP_DIR).length : 0;
    const sandbox = mkdtempSync(join(tmpdir(), 'kago-engine-'));
    try {
      const store = openStore({ dir: sandbox });
      const r4 = await searchEdge({
        capMhz: 2842, point: 95, store,
        card: { driver: '610.88', vbios: 'v1' },
        runStepFn: scripted((o) => (o < 200 ? P : config.VERDICT.SDC)),
      });
      // VERDICT ROWS, not the write-ahead marks — the marks record INTENT before the attempt and are
      // resolved by these rows the moment it comes back (`bugs/07`). Counting both would assert that
      // the store holds twice what the search learned, which is not what this block is about.
      const saved = readAll(store).records.filter((r) => !r.pending);
      ok('каждая попытка ЛЕГЛА в хранилище, а не только в отчёт', saved.length, r4.attempts.length);
      // AND THE MARKS THEMSELVES ARE THERE AND ANSWERED — the half that makes a hang recoverable.
      const marks = readAll(store).records.filter((r) => r.pending);
      ok('каждая попытка записана НАПЕРЁД, ещё до самой попытки (bugs/07)', marks.length, r4.attempts.length);
      ok('и все метки РАЗРЕШЕНЫ вердиктами — прогон пережил каждую ступень',
        resolveAttempts(readAll(store).records).filter((r) => r.pending).length, 0);
      // THE GRADED HALF must survive the trip oracle -> atom -> engine -> store. It did NOT in the
      // first live search: the atom kept the verdict and dropped result.meters, so the question
      // «видно ли, как растёт число неверных расчётов» had no data behind it.
      const graded = await searchEdge({
        capMhz: 2842, point: 96, store,
        card: { driver: '610.88', vbios: 'v1' },
        runStepFn: async ({ offsetMhz }) => ({
          verdict: offsetMhz < 200 ? P : config.VERDICT.SDC,
          meters: { badElemsMax: offsetMhz / 75, faultRate: offsetMhz / 7.5e6, bitDistMin: 1, launches: 6000, opsPerSecond: 5e10 },
        }),
      });
      const gradedSaved = readAll(store).records.filter((s) => s.point === 96 && !s.pending);
      ok('ГРАДИЕНТ ПОРЧИ доезжает до хранилища, а не теряется в атоме',
        gradedSaved.every((s) => s.faultRate !== null && s.badElemsMax !== null), true);
      ok('и по нему видно РОСТ, а не только финальный крах',
        gradedSaved[gradedSaved.length - 1].badElemsMax > gradedSaved[0].badElemsMax, true);
      ok('бит-дистанция тоже сохраняется — насколько ГЛУБОКО искажение', gradedSaved[0].bitDistMin, 1);
      ok('и записи несут вердикт, а не только сдвиг', saved.every((s) => 'verdict' in s), true);
      ok('храповик после поиска запрещает сбойнувший сдвиг',
        allowedOffset(saved, 95, { fineStepMhz: ASCENT_FINE_MHZ }).limitMhz, r4.firstFail - ASCENT_FINE_MHZ);

      // --- THE DIVERSE SET, end to end through the engine (plans/05 §4.3). The decision logic of
      // the set itself is proved in `stress-tester --selftest`; what is proved HERE is the wiring:
      // that the set reaches the atom, and that the store can answer AC3's question afterwards
      // («distinct load shapes each closed point was judged by, target ≥ 3»).
      const handed = [];
      const setRunner = async ({ offsetMhz, shapes: given }) => {
        handed.push(given);
        // what a real `runStep` returns when it judged by a set: the reduced verdict plus one entry
        // per shape, the deciding one named
        const fails = offsetMhz >= 200;
        const ran = DIVERSE_SET.map((s, i) => ({
          id: s.id, workload: s.workload, shape: s.shape, bearsVerdict: true,
          verdict: (fails && i === 2) ? config.VERDICT.SDC : P,
          reason: (fails && i === 2) ? 'подставная порча на третьей форме' : null,
          meters: { badElemsMax: i, faultRate: i / 1e6, bitDistMin: 1, launches: 100, opsPerSecond: 5e10 },
        }));
        return {
          verdict: fails ? config.VERDICT.SDC : P,
          // the last shape decides in both cases here: it fails when the offset is too high, and it
          // is the last one to pass when it is not
          worstShape: 'branchy/sustained',
          shapes: ran,
          stress: { reason: 'подставной набор' },
        };
      };
      const r5 = await searchEdge({
        capMhz: 2842, point: 97, store, shapes: DIVERSE_SET,
        card: { driver: '610.88', vbios: 'v1' },
        runStepFn: setRunner,
      });
      ok('набор доезжает до атома, а не теряется в движке',
        handed.every((g) => Array.isArray(g) && g.length === 3), true);
      const setRows = readAll(store).records.filter((s) => s.point === 97 && !s.pending);
      ok('в хранилище ложится запись НА КАЖДУЮ ФОРМУ, а не одна на попытку',
        setRows.length, r5.attempts.length * 3);
      ok('и по хранилищу видно, СКОЛЬКИМИ формами судилась точка (это и есть мера P5-AC3)',
        new Set(setRows.map((s) => `${s.workload}/${s.shape}`)).size, 3);
      ok('и форма, решившая исход, названа в попытке', r5.attempts.at(-1).worstShape, 'branchy/sustained');
      ok('вердикт набора ведёт поиск так же, как вердикт одиночной формы',
        r5.lastPass < 200 && r5.firstFail >= 200, true);

      // --- THE WRITE SHAPE REACHES THE ATOM, AND THE STORE RECORDS WHAT THE ATOM ANSWERED.
      //
      // `bugs/02` step 1. Two different facts, and the second is the one that would have caught the
      // bug: the engine's REQUEST is an intention, the atom's report is an observation, and only the
      // observation belongs in the evidence.
      const shapesSeen = [];
      const shapeRunner = async ({ offsetMhz, writeShape: got }) => {
        shapesSeen.push(got ?? null);
        return {
          verdict: offsetMhz < 200 ? P : config.VERDICT.SDC,
          undervolt: { capMhz: 2842, after: { pointIndex: 90, mv: 1000 }, savedMv: 40 },
          // The atom answers with the shape it RESOLVED — here deliberately different from the one
          // asked for, which is exactly the low-rung case where the curve cannot hold the ceiling.
          writeShape: 'uniform',
          capHeldBy: 'закрепление частоты',
        };
      };
      const r6 = await searchEdge({
        capMhz: 2842, point: 98, store, writeShape: 'raise-and-cap',
        card: { driver: '610.88', vbios: 'v1' },
        runStepFn: shapeRunner,
      });
      ok('форма записи доезжает до атома НА КАЖДОЙ ступени, а не только на первой',
        shapesSeen.length > 1 && shapesSeen.every((s) => s === 'raise-and-cap'), true);
      const shapeRows = readAll(store).records.filter((s) => s.point === 98 && !s.pending);
      ok('в хранилище ложится форма, которую вернул АТОМ, а не заказ движка',
        [...new Set(shapeRows.map((s) => s.writeShape))], ['uniform']);
      ok('и держатель потолка записан рядом с ней — иначе вердикт не с чем сравнивать',
        [...new Set(shapeRows.map((s) => s.capHeldBy))], ['закрепление частоты']);
      ok('поиск при этом отработал как обычно', r6.attempts.length > 1, true);

      // --- ГЛУБИНА СЕССИИ (bugs/07). Куплено зависанием машины 2026-08-14 21:14: поиск прошёл СЕМЬ
      // ступеней, 0 → −185 мВ, на форме без истории — и повесил машину на восьмой. Каждый отдельный
      // шаг был мелким и законным; неограниченным было ОБЩЕЕ расстояние, пройденное за пределы
      // доказанного. Мутация показала, что этот предел не сторожил никто, и вот блоки.
      const gradedRungs = [5, 35, 65, 100, 130, 160, 190, 225].map((mv, i) => ({
        offsetMhz: 7 + i * 100, mv: 1045 - mv, savedMv: mv,
      }));
      const walked = [];
      const deepRunner = async ({ offsetMhz }) => {
        walked.push(offsetMhz);
        return { verdict: P, undervolt: { capMhz: 2842, after: { pointIndex: 90, mv: 900 }, savedMv: 40 } };
      };
      walked.length = 0;
      await searchEdge({
        capMhz: 2842, point: 99, rungs: gradedRungs, writeShape: 'raise-and-cap',
        card: { driver: '610.88', vbios: 'v1' }, runStepFn: deepRunner,
      });
      const deepestWalkedMv = Math.max(...walked.map((o) => gradedRungs.find((r) => r.offsetMhz === o).savedMv));
      const deepestWalkedAbsMv = Math.min(...walked.map((o) => gradedRungs.find((r) => r.offsetMhz === o).mv));
      // THE OWNER'S FLOOR IS THE BOUND ABOVE IT, not the 30 mV session step (his word, 2026-08-15:
      // «до 900 можем опускаться быстрыми шагами»). So a run with NO history descends FAST — and the
      // thing that must hold is that it stops AT his floor and never steps under it.
      // ⚠️ 900 IS WRITTEN OUT, NOT READ FROM `config`, AND THAT IS THE POINT. The first draft of these
      // two blocks asserted against `config.FAST_DESCENT_FLOOR_MV` — the very constant they guard — so
      // the mutation «set the floor to 0» moved the expectation along with the behaviour and the
      // blocks stayed GREEN on a card walking 120 mV past the owner's limit. A check that reads the
      // thing it checks is a tautology (`BUG_FIXING_FRAMEWORK.md` → Guards: a guard that has never
      // gone red proves nothing). The literal here is the OWNER'S QUOTED NUMBER — «ниже 900» — which
      // is a contract, not a tunable: changing the constant must redden these, and now it does.
      ok('БЕЗ ИСТОРИИ спуск быстрый, но НЕ НИЖЕ пола владельца (900 мВ, его слово)',
        deepestWalkedAbsMv >= 900, true);
      ok('и под пол владельца без доказанной земли не заходит ни одна ступень',
        walked.map((o) => gradedRungs.find((r) => r.offsetMhz === o).mv)
          .filter((mv) => mv < 900).length, 0);
      ok('и это НЕ отказ, а честная остановка — то, что влезло, пройдено',
        walked.length > 0, true);

      // --- ПЛАН И ПРОГОН СЧИТАЮТ ОДНУ ГЛУБИНУ (`bugs/09`). Граница выше работала, а `--dry-run`
      // печатал лестницу БЕЗ неё: «ступеней 40, глубже всего −250 мВ» при потолке сессии в 30 мВ.
      // Сухой прогон — единственный артефакт, который читают ПЕРЕД записью в карту владельца (S1, S2),
      // и он показывал прогон вчетверо глубже настоящего. Пара «план ↔ прогон» проверяется здесь
      // ЧИСЛОМ, а не чтением двух мест: сравнивается то, что план обещает, с тем, что прогон прошёл.
      const planned = composeAscentLadder({
        fine: gradedRungs, history: [], point: 99, capMhz: 2842, stockMv: 1045,
      });
      ok('ПЛАН ВИДИТ ТУ ЖЕ ГЛУБИНУ, ЧТО ПРОЙДЁТ ПРОГОН — иначе сухой прогон врёт перед записью в карту',
        planned.sessionDepth.deepestPlannedMv, deepestWalkedMv);
      ok('и план обещает столько же ступеней, сколько прогон сделал',
        planned.sessionDepth.rungsPlanned, walked.length);
      // The line must name the ABSOLUTE voltage, not only the depth — the depth is relative to a stock
      // that slides with temperature (`bugs/10`), so it is the volt that the next session inherits.
      ok('строка плана НАЗЫВАЕТ АБСОЛЮТНОЕ напряжение, а не только глубину от стока',
        sessionDepthLine(planned.sessionDepth).includes(`${planned.sessionDepth.deepestPlannedAbsMv} мВ`)
        && sessionDepthLine(planned.sessionDepth).includes('истории НЕТ'), true);

      // --- УЛИКА ПЕРЕЖИВАЕТ СПОЛЗАНИЕ КРИВОЙ (`bugs/10`) — и это тот самый блок, ради которого ключ
      // храповика переехал с индекса точки на абсолютное напряжение.
      //
      // Фикстура — ровно вечер 2026-08-14: доказано на ГОРЯЧЕЙ карте, где 2842 МГц обслуживала точка
      // 96; читает это сессия на ХОЛОДНОЙ, где ту же частоту обслуживает точка 94. Индексы разные,
      // напряжение одно. Старый ключ здесь находил НОЛЬ, и прогон начинал от стока заново — то есть
      // план «по сессии за раз» не сходился в принципе.
      const hotEvidence = [{
        point: 96, offsetMhz: 45, capMhz: 2842, servingMv: 1020,
        verdict: P, writeShape: 'raise-and-cap', driver: '610.88', vbios: 'v1',
      }];
      const coldRungs = [5, 10, 15, 20, 25, 30, 35, 40].map((mv, i) => ({
        offsetMhz: 7 + i * 15, mv: 1040 - mv, savedMv: mv,
      }));
      const inherited = composeAscentLadder({
        fine: coldRungs, history: hotEvidence, point: 94, capMhz: 2842, stockMv: 1040,
      });
      ok('УЛИКА ПЕРЕЖИВАЕТ СПОЛЗАНИЕ КРИВОЙ: доказанное под точкой 96 видит сессия, резолвящая точку 94',
        inherited.sessionDepth.provenMv, 1020);
      ok('и сессия наследует ЗЕМЛЮ, а не начинает от стока заново',
        inherited.sessionDepth.sessionFloorMv, 990);
      ok('СТАРЫЙ ключ этой улики не нашёл бы — вот цена индекса точки',
        bestPassing(hotEvidence, 94), null);

      // Рядом — вторая половина правила: ЗА доказанной глубиной шаг обязан стать точным, иначе
      // градуированный оракул перешагивает лавину (~20 мВ) вместо того, чтобы в неё попасть.
      const storeDeep = openStore({ dir: mkdtempSync(join(tmpdir(), 'kago-vmin-deep-')) });
      try {
        // THE INHERITED EVIDENCE, WRITTEN THE WAY REAL RECORDS ARE WRITTEN (`bugs/10`): with the cap
        // it was taken at and the ABSOLUTE voltage the point served. Until 2026-08-15 this fixture
        // carried neither, because the ratchet keyed on the point index — and that key is exactly what
        // made a proven −30 mV invisible to the next session once the curve slid by one step.
        for (const savedMv of [5, 35]) {
          append(storeDeep, {
            point: 99, offsetMhz: 7 + [5, 35].indexOf(savedMv) * 100, workload: 'sdc_fma', shape: 'sustained',
            capMhz: 2842, servingMv: 1045 - savedMv,
            verdict: P, driver: '610.88', vbios: 'v1', writeShape: 'raise-and-cap',
          });
        }
        walked.length = 0;
        await searchEdge({
          capMhz: 2842, point: 99, rungs: gradedRungs, writeShape: 'raise-and-cap', store: storeDeep,
          card: { driver: '610.88', vbios: 'v1' }, runStepFn: deepRunner,
        });
        // Proven 1010 mV, the owner's floor 900: everything down to the floor is fast territory, so
        // the run takes the coarse rungs above it and stops there. Before his policy this expected a
        // single 30 mV excursion — the change is HIS, and it is quoted in `config`.
        const walkedAbs = walked.map((o) => gradedRungs.find((r) => r.offsetMhz === o).mv);
        ok('ДО ПОЛА ВЛАДЕЛЬЦА сессионная граница в 30 мВ НЕ режет — идём быстро',
          [Math.min(...walkedAbs) >= 900, Math.min(...walkedAbs) < 1010 - 30], [true, true]);

        // --- НИЖЕ ПОЛА ВЛАДЕЛЬЦА ШАГ СТАНОВИТСЯ ТОЧНЫМ (5 мВ), и вот фикстура, которой раньше не
        // было: лестница с настоящим шагом сетки, и доказанная земля РОВНО на полу.
        const fineRungs = Array.from({ length: 40 }, (_, i) => ({
          offsetMhz: 7 + i * 15, mv: 1040 - i * 5, savedMv: 5 + i * 5,
        }));
        const atFloor = [{
          point: 99, offsetMhz: 0, capMhz: 2842, servingMv: 900,
          verdict: P, writeShape: 'raise-and-cap', driver: '610.88', vbios: 'v1',
        }];
        const below = composeAscentLadder({
          fine: fineRungs, history: atFloor, point: 99, capMhz: 2842, stockMv: 1045,
        });
        const belowFloor = below.ladderRungs.map((r) => r.mv).filter((mv) => mv < 900);
        const gaps = belowFloor.slice(1).map((mv, i) => belowFloor[i] - mv);
        ok('НИЖЕ ПОЛА ВЛАДЕЛЬЦА шаг ровно 5 мВ, а не грубый',
          [...new Set(gaps)], [5]);
        // Literals for the same reason as above: the contract is «30 mV past proven ground, below the
        // owner's 900 mV floor», and a block that reads both constants could not fail when either moves.
        ok('и глубже 30 мВ от доказанного под полом не уходит',
          Math.min(...belowFloor), 870);
      } finally {
        // assertSandbox FIRST — this exact teardown deleted the production store on 2026-08-14.
        rmSync(assertSandbox(storeDeep), { recursive: true, force: true });
      }
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
    // =============================================================================================
    // `plans/15` §4.5 — THE SWEEP: the loop, the document, and the two verdicts
    //
    // Everything runs on an INJECTED atom and an INJECTED save. Not one line reaches a GPU or the
    // real `curves/` directory (F2-AC10), and the document under test is built here rather than read
    // from disk — a suite that edits the production artifact is `bugs/08` waiting to happen.
    // =============================================================================================

    // A uniform 5 mV window: SHORT ladders make the assertions about the LOOP crisp. The card's real
    // 10 mV gaps are exercised where they belong — §4.6's refinement, on `gridLikeCard`.
    const sweepGrid = Array.from({ length: 24 }, (_, i) => 930 + i * 5);          // 930…1045, ascending
    const sweepPoints = sweepGrid.map((mv, k) => {
      const mhz = 2000 + (mv - 930) * 6;                                          // 2000…2690, monotone
      return { i: k, mv, mhz, freqKhz: mhz * 1000 };
    });
    const sweepRow = (mhz, stock, over = {}) => ({
      mhz, voltageMv: stock, stockVoltageMv: stock, tags: [CURVE_TAGS.STOP_UNTOUCHED],
      provenBy: null, editedAt: '2026-08-16T00:00:00+03:00', ...over,
    });
    const sweepDoc = (rows) => ({
      kind: 'tuning-curve', name: 'measured',
      card: { maxGraphicsMhz: 3090 },
      voltageGridMv: sweepGrid,
      stamp: { driver: '610.88', vbios: 'v1', takenAt: '2026-08-16T00:00:00+03:00', tempC: 42 },
      frequencies: rows,
    });
    // Two rungs of the card: three frequencies served by 1045 mV at stock, two by 1040.
    const bandRows = [
      sweepRow(2842, 1045), sweepRow(2835, 1045), sweepRow(2828, 1045),
      sweepRow(2820, 1040), sweepRow(2813, 1040),
    ];

    // — the grouping, and the two things about it that are decisions rather than mechanics
    const groups = rungGroups({ rows: bandRows });
    ok('РАЗВЁРТКА ИДЁТ ПО СТУПЕНЯМ: пять частот дают две ступени, а не пять прожигов',
      groups.map((g) => [g.topMhz, g.bottomMhz, g.stockVoltageMv, g.count]),
      [[2842, 2828, 1045, 3], [2820, 2813, 1040, 2]]);
    // The key is the STOCK voltage — grouping by the tuned one would be grouping by the answer the
    // sweep is looking for. Here the tuned column is deliberately scrambled, and the grouping ignores it.
    ok('ступень группируется по СТОКОВОМУ напряжению, а не по уже найденному',
      rungGroups({ rows: [sweepRow(2842, 1045, { voltageMv: 990 }), sweepRow(2835, 1045, { voltageMv: 1010 })] })
        .map((g) => [g.topMhz, g.count]),
      [[2842, 2]]);

    // A scripted rung: passes above the threshold, fails at or below it.
    const scriptSweepRung = (failsAtOrBelow, extra = () => null) => async ({ voltageMv }) => (
      extra(voltageMv) ?? {
        outcome: voltageMv <= failsAtOrBelow ? 'failed' : 'passed',
        verdict: voltageMv <= failsAtOrBelow ? config.VERDICT.SDC : P,
        why: '',
      });
    const freqOK = (over = {}) => sweepFrequency({
      frequencyMhz: 2842, stockVoltageMv: 1045, voltageGridMv: sweepGrid,
      availableDepthMv: 115, curveDoc: sweepDoc(bandRows),
      runRungFn: scriptSweepRung(-1), ...over,
    });

    // — F2-AC7: a descent that never failed is the LEVER's wall, never an edge. Calling it `edge-found`
    // is the false `[TESTED]` this verdict exists to forbid.
    const allPass = await freqOK();
    // The rung count and the floor are LITERALS taken from a run, not derived from `DESCENT_ZONES` —
    // a block that recomputes its expectation from the same constants as the code has no independent
    // opinion (EXP-0055). 1020/995/970/945 in the 25 mV zone, then 935 and 930 where the 10 mV zone
    // starts and the lever floor (1045 − 115) stops it.
    ok('СПУСК БЕЗ ОТКАЗА — ПРЕДЕЛ РЫЧАГА, а не край',
      [allPass.verdict, allPass.voltageMv, allPass.rungs.length],
      ['lever-limited', 930, 6]);

    // — ДОКАЗАННАЯ ЗЕМЛЯ ДОЕЗЖАЕТ ДО СТУПЕНИ (`interviews/009`). Без этого блока сторож глубины
    //   зелёный и мёртвый: мутация «развёртка перестала передавать доказанную землю» не покраснила
    //   НИЧЕГО, и та же мутация вскрыла, что обёртка `sweepRange` разбирала аргументы по именам и
    //   молча теряла оба новых поля (EXP-0073 плюс пара «правда ↔ зеркало» внутри одной функции).
    //   Проверяется ИМЕННО передача: земля обязана быть стоком на первой ступени и подниматься до
    //   каждого прошедшего напряжения дальше — иначе сторож мерил бы от точки, которую никто не брал.
    const handed = [];
    await freqOK({
      runRungFn: async (a) => {
        handed.push([a.voltageMv, a.provenMv, a.maxStepFromProvenMv]);
        return { outcome: 'passed', verdict: P, why: '' };
      },
    });
    ok('ДОКАЗАННАЯ ЗЕМЛЯ ДОЕЗЖАЕТ ДО СТУПЕНИ: на первой это сток, дальше — каждое прошедшее напряжение',
      handed.slice(0, 3), [[1020, 1045, 35], [995, 1020, 35], [970, 995, 35]]);
    ok('и стена, которой судят приземление, — ТА ЖЕ, которой план судил заказ (одно число, не два)',
      [...new Set(handed.map((h) => h[2]))], [config.ASCENT_STEP_MAX_MV ?? 35]);

    // — ЗЕМЛЯ УЕХАЛА ВВЕРХ -> ЦЕЛЬ ПЕРЕСЧИТЫВАЕТСЯ, А ПРОГОН НЕ ВСТАЁТ. Живой прогон 2026-08-16 на
    //   2565 МГц: заказали 900, карта дала 915 (промах вверх, принят), следующая ПЛАНОВАЯ ступень 875
    //   оказалась в 40 мВ от доказанного при стене 35 — и развёртка остановилась. Плана никто не
    //   нарушал (900 → 875 это ровно 25); разошлись план и реальность.
    //   Здесь карта СИСТЕМАТИЧЕСКИ отдаёт на 15 мВ выше заказа — то есть каждая плановая ступень
    //   слишком глубока, — и проверяется ровно два свойства: прогон НЕ встаёт, и НИ ОДИН шаг от
    //   доказанного не превышает стену. Второе важнее первого: пересчёт, который «просто едет
    //   дальше», был бы снятием сторожа, а не его соблюдением.
    //   ⚠️ ФИКСТУРА ПРОМАХИВАЕТСЯ ВВЕРХ РОВНО ОДИН РАЗ, и это не мелочь: первая её редакция
    //   промахивалась на КАЖДОЙ ступени, и обе мутации («убрать пересчёт», «пересчёт берёт плановую
    //   ступень») не покрасили НИЧЕГО. Причина в арифметике: если карта всегда отдаёт на 15 мВ выше
    //   заказа, то и следующее приземление уезжает вверх на те же 15, и шаг от земли остаётся 25.
    //   Живой отказ выглядел иначе — промах ОДИН, а следующая ступень легла точно, и вот тогда шаг
    //   стал 40. Блок обязан воспроизводить тот случай, который он сторожит (EXP-0073).
    //
    //   И проверяется ЗАКАЗ, а не приземление: сторож глубины живёт в `runRung`, которую этот блок
    //   подменяет, — значит наблюдаемое здесь свойство ровно одно, «какую цель выбрал спуск».
    const orders = [];
    let missed = false;
    const drifted = await freqOK({
      runRungFn: async (a) => {
        orders.push({ ordered: a.voltageMv, proven: a.provenMv, step: a.provenMv - a.voltageMv });
        // Один промах вверх на первой же ступени — дальше карта отдаёт ровно заказанное.
        const delivered = missed ? a.voltageMv : a.voltageMv + 15;
        missed = true;
        return { outcome: 'passed', verdict: P, why: '', measuredMv: delivered };
      },
    });
    ok('ЗЕМЛЯ УЕХАЛА ВВЕРХ: спуск не встал и закрылся пределом рычага',
      [drifted.halted === true, drifted.verdict], [false, 'lever-limited']);
    ok('и НИ ОДИН ЗАКАЗ не встал дальше стены от доказанного — пересчёт соблюдает сторожа, а не снимает его',
      orders.filter((s) => s.step > (config.ASCENT_STEP_MAX_MV ?? 35)).map((s) => `${s.proven}→${s.ordered}`), []);
    ok('и пересчёт РЕАЛЬНО случился: после промаха заказ отличается от плановой ступени лестницы',
      orders.some((s, i) => i > 0 && s.step < 25), true);

    // — a failure is refined and only THEN shipped: the coarse rung 970 signals, the walk re-finds the
    // failure at 980, and the shipped value is 980 + 10.
    const edge = await freqOK({ runRungFn: scriptSweepRung(980) });
    ok('ОТКАЗ УТОЧНЯЕТСЯ ШАГОМ СЕТКИ, и отгружается уточнённый край + запас',
      [edge.verdict, edge.refinement?.failMv, edge.refinement?.reproduced, edge.voltageMv],
      ['edge-found', 980, true, 990]);
    ok('и свидетель записи НАЗЫВАЕТ прожиг, а не остаётся пустым',
      typeof edge.provenBy === 'string' && edge.provenBy.includes('990'), true);

    // — the lever wall reported BY THE RUNG ITSELF (`planRung` refuses the offset before any write).
    // This block exists because a mutation that renamed that outcome `edge-found` reddened NOTHING:
    // no fixture reached the branch, so the verdict was satisfied by a path no run could enter —
    // EXP-0073's class, and the second time this project has met it in one plan.
    const leverWall = await freqOK({
      runRungFn: async ({ voltageMv }) => (voltageMv <= 995
        ? { outcome: 'lever-limited', verdict: null, why: 'ПРЕДЕЛ РЫЧАГА: нужен сдвиг больше ±1000 МГц' }
        : { outcome: 'passed', verdict: P }),
    });
    ok('ПРЕДЕЛ РЫЧАГА, названный САМОЙ СТУПЕНЬЮ, доезжает до вердикта частоты и не становится краем',
      [leverWall.verdict, leverWall.voltageMv, leverWall.halted], ['lever-limited', 1020, false]);

    // — anything that is not a PASS and not a failure is a STOP, with no shipped voltage at all
    const murky = await freqOK({
      runRungFn: async ({ voltageMv }) => (voltageMv === 995
        ? { outcome: 'unknown', verdict: null, why: 'оракул не смог' }
        : { outcome: 'passed', verdict: P }),
    });
    ok('НЕИЗВЕСТНО в спуске — СТОП: частота не закрывается и напряжение не отгружается',
      [murky.halted, murky.verdict, murky.voltageMv], [true, null, null]);

    // — §4.2 wired at last: the seed is taken, PROVED, and the descent continues BELOW it
    const seededDoc = sweepDoc([
      sweepRow(2850, 1045, { voltageMv: 1000, tags: [CURVE_TAGS.STOP_EDGE_FOUND], provenBy: 'прожиг' }),
      ...bandRows,
    ]);
    const seenRungs = [];
    const seeded = await freqOK({
      curveDoc: seededDoc,
      runRungFn: async ({ voltageMv }) => { seenRungs.push(voltageMv); return { outcome: 'passed', verdict: P }; },
    });
    ok('ЗАТРАВКА СОСЕДКОЙ: спуск НАЧИНАЕТСЯ с её напряжения и продолжается НИЖЕ него',
      [seeded.seeded, seenRungs[0], seenRungs[1], seenRungs.every((mv) => mv <= 1000)],
      [true, 1000, 995, true]);

    // — E2-AC11 and trap T3: a non-PASS on the seed CANCELS it, drops the descent back to stock, and
    // the event is SPOKEN. Silence here is the whole defect: the owner's rare case absorbed unnoticed.
    const said = [];
    const rejectedRungs = [];
    const rejected = await freqOK({
      curveDoc: seededDoc,
      onEvent: (e) => said.push(e.kind),
      runRungFn: async ({ voltageMv }) => {
        rejectedRungs.push(voltageMv);
        return voltageMv === 1000
          ? { outcome: 'failed', verdict: config.VERDICT.SDC }
          : { outcome: 'passed', verdict: P };
      },
    });
    ok('ОТВЕРГНУТАЯ ЗАТРАВКА роняет спуск НА СТОК и говорит об этом вслух',
      [rejected.seedRejected, rejected.seeded, rejectedRungs[1], said.includes('seed-rejected')],
      [true, false, 1020, true]);

    // =============================================================================================
    // `bugs/23` — ЗАВИСАНИЕ ЗАКРЫВАЕТ ЧАСТОТУ КРАЕМ, А СПУСК НА НЕГО НЕ ВОЗВРАЩАЕТСЯ
    //
    // Слово владельца (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК», обязательство 1 из трёх):
    //   *«Вердикт ЗАВИС — первого класса… Он записывается в документ кривой как причина, по которой
    //   точка встала на своё значение, а не как сбой прогона.»*
    //
    // Живой прогон 2026-08-16: 2842 МГц прошло 850 мВ и повесило машину на 845. Знание осталось в
    // журнале и НЕ доехало до документа, а возобновлённый прогон построил бы ту же лестницу и снова
    // заказал 845.
    //
    // MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016) — они же пункты фикс-плана бага:
    //  71. `sweepFrequency` перестаёт звать `closeByHang`      → «ЗАВИСАНИЕ ЗАКРЫВАЕТ ЧАСТОТУ КРАЕМ»
    //  72. запас кладётся на зависшее, а не на стабильную      → та же строка, по напряжению отгрузки
    //  73. снять фильтр пола в пересчёте цели от земли         → «спуск НЕ ВОЗВРАЩАЕТСЯ на убившую ступень»
    //  74. свидетель зависания и оракула сделан одинаковым     → «улика РАЗЛИЧАЕТ зависание и оракула»
    //  75. `seedBlockedByHang` захардкожен в false             → «затравку на зависшее напряжение ОТМЕНЯЕТ пол»
    // ⚠️ ЗЕМЛЯ В ЭТОЙ ФИКСТУРЕ ЕЗДИТ ВВЕРХ, И ЭТО НЕ УКРАШЕНИЕ. Карта регулярно отдаёт напряжение на
    // ступень выше заказанной, спуск пересчитывает цель от ДОКАЗАННОГО, и пересчёт выбирает напряжение
    // по сетке в обход лестницы — то есть это ВТОРОЕ место, которое могло бы шагнуть на убившую
    // ступень. Здесь оно срабатывает дважды (1045 → 1010 → 975), и утверждение ниже накрывает ВЕСЬ
    // путь, а не одну функцию.
    const hangWalk = [];
    const hangSaid = [];
    const hangClosed = await freqOK({
      hangFloorMv: 960,
      onEvent: (e) => hangSaid.push(e.kind),
      runRungFn: async ({ voltageMv }) => {
        hangWalk.push(voltageMv);
        return { outcome: 'passed', verdict: P, measuredMv: voltageMv === 1020 ? 1045 : voltageMv };
      },
    });
    // Лестница от стока 1045: 1020 · 995 · 970 — и стоп, потому что следующая плановая 945 ниже пола.
    // С уехавшей землёй прогон идёт 1020 → 1010 → 975, а дальше уточнение подходит к 960 мВ шагом
    // сетки: 970 и 965 проходят, ниже не идём. Отгрузка = последняя стабильная 965 + шаг = 970.
    ok('ЗАВИСАНИЕ ЗАКРЫВАЕТ ЧАСТОТУ КРАЕМ, а не «пределом рычага», и отгружает стабильную + шаг',
      [hangClosed.verdict, hangClosed.voltageMv, hangClosed.halted], ['edge-found', 970, false]);
    ok('спуск НЕ ВОЗВРАЩАЕТСЯ на убившую ступень — даже когда цель пересчитывается от уехавшей земли',
      [Math.min(...hangWalk) > 960, hangWalk.includes(960), hangSaid.filter((k) => k === 'rebase').length >= 1],
      [true, false, true]);
    // `?.` и проговорённый запасной ответ — EXP-0075: мутация 74 убирает ровно это поле, и блок обязан
    // ПОКРАСНЕТЬ, а не унести с собой весь отчёт.
    ok('улика РАЗЛИЧАЕТ зависание и вердикт оракула — это не одно и то же доказательство',
      (hangClosed.provenBy ?? 'свидетеля нет вовсе').includes('ЗАВИСАНИЕМ МАШИНЫ'), true);

    // — и обратная сторона той же улики: если между стабильной и зависшей оракул НАЙДЁТ отказ, край
    //   принадлежит ему, а зависание остаётся внешней скобкой. Иначе улика врала бы об источнике.
    const oracleInside = await freqOK({
      hangFloorMv: 960,
      runRungFn: async ({ voltageMv }) => (voltageMv <= 965
        ? { outcome: 'failed', verdict: config.VERDICT.SDC }
        : { outcome: 'passed', verdict: P }),
    });
    ok('отказ ОРАКУЛА между стабильной и зависшей забирает край себе — и улика говорит именно это',
      [oracleInside.verdict, oracleInside.voltageMv,
        (oracleInside.provenBy ?? 'свидетеля нет вовсе').includes('ВЕРДИКТ ОРАКУЛА')],
      ['edge-found', 975, true]);

    // — прошедшего напряжения выше пола НЕТ: это СТОП, а не выдуманная отгрузка (три двери PHILOSOPHY)
    //
    // ⚠️ ФИКСТУРА НЕ БРОСАЕТ, А СЧИТАЕТ. Первая редакция кидала исключение «сюда звать не должны» — и
    // мутация 68, снявшая пол из лестницы, УРОНИЛА весь набор вместо покраснения одного блока. Это
    // EXP-0075 ровно в том месте, где урок написан: утверждение (или фикстура), разыменовывающее то,
    // что убирает мутация, уносит с собой весь отчёт, а это хуже ложного зелёного — тот хоть доходит.
    const nothingAboveTouched = [];
    const nothingAbove = await freqOK({
      hangFloorMv: 1040,
      runRungFn: async ({ voltageMv }) => { nothingAboveTouched.push(voltageMv); return { outcome: 'passed', verdict: P }; },
    });
    ok('пол сразу под стоком: прогон ВСТАЁТ, карту не трогает и ничего не отгружает',
      [nothingAbove.halted, nothingAbove.verdict, nothingAbove.voltageMv,
        nothingAbove.hangFloorHalt, nothingAboveTouched.length],
      [true, null, null, true, 0]);

    // — затравка это ПРЫЖОК, и пол обязан уметь его отменить ДО всякой лестницы
    const seedSaid = [];
    const seedWalk = [];
    const seedBlocked = await freqOK({
      curveDoc: seededDoc, hangFloorMv: 1000,
      onEvent: (e) => seedSaid.push(e.kind),
      runRungFn: async ({ voltageMv }) => { seedWalk.push(voltageMv); return { outcome: 'passed', verdict: P }; },
    });
    ok('затравку на зависшее напряжение ОТМЕНЯЕТ пол: первый прожиг идёт от стока, а не на 1000 мВ',
      [seedBlocked.seeded, seedWalk[0], seedWalk.includes(1000), seedSaid.includes('seed-blocked-by-hang')],
      [false, 1020, false, true]);

    // =============================================================================================
    // `plans/15` §4.5 — THE DOCUMENT'S ONLY AUTHOR (`curve-store.closePoint`, rule R14a)
    // =============================================================================================

    // — E2-AC3: the rung's other frequencies inherit DOWNWARD, and the witness names whose burn it was
    const closedOne = closePoint(sweepDoc(bandRows), {
      mhz: 2842, voltageMv: 990, status: CURVE_STATUS.EDGE_FOUND,
      provenBy: 'край 980 мВ', inheritDownToMhz: 2828, at: '2026-08-16T01:00:00+03:00',
    });
    ok('СТУПЕНЬ НАСЛЕДУЕТ ВНИЗ: прожгли одну частоту — закрылись все три',
      [closedOne.ok, closedOne.closed, closedOne.inherited],
      [true, 3, [2835, 2828]]);
    // `?.` AND A SPOKEN FALLBACK — EXP-0075's prescribed form, and this block is why the lesson is a
    // repeat offender: written the day AFTER the lesson, it still dereferenced the very field a
    // mutation removes, so a judge's mutation that nulled the witness CRASHED the suite instead of
    // reddening this block. A thrown assertion takes the whole report with it, which is worse than a
    // false green because a false green at least completes.
    ok('и унаследованная строка НАЗЫВАЕТ, чей это был прожиг',
      closedOne.doc.frequencies.find((r) => r.mhz === 2835)?.provenBy?.includes('от 2842 МГц')
        ?? 'свидетеля у унаследованной строки нет вовсе', true);
    // The refusal that had NO block until a judge's mutation found it silent: `closePoint` forbids a
    // voltage above stock, and `validateCurveDoc` forbids it again downstream — two guards, one of
    // them unproven, which is EXP-0008's class («a check that has never failed proves nothing»).
    // 2820 MHz sits at 1040 mV at stock, and 1045 is a real grid rung one step ABOVE it. The first
    // draft of this block used 2842 / 1045 — which is EXACTLY that frequency's stock, not above it —
    // and went red on intact code. The fixture was wrong, not the mutator; moving it onto a frequency
    // where «above stock» can actually be expressed is the honest fix (the same class as §4.6's
    // fixtures, EXP-0072 one level down).
    ok('мутатор отвергает напряжение ВЫШЕ стокового — тюнинг снижает, а не поднимает',
      closePoint(sweepDoc(bandRows), {
        mhz: 2820, voltageMv: 1045, status: CURVE_STATUS.EDGE_FOUND, provenBy: 'x',
      }).ok, false);
    ok('а РОВНО стоковое — не отвергает: это не подъём, а точка, которую не удалось удешевить',
      closePoint(sweepDoc(bandRows), {
        mhz: 2842, voltageMv: 1045, status: CURVE_STATUS.LEVER_LIMITED, provenBy: null,
      }).ok, true);
    // Upward inheritance is the UNSAFE direction — a higher frequency needs at least as much voltage.
    ok('НАСЛЕДОВАНИЕ ТОЛЬКО ВНИЗ: вверх по частоте оно отвергается по имени',
      closePoint(sweepDoc(bandRows), {
        mhz: 2828, voltageMv: 990, status: CURVE_STATUS.EDGE_FOUND, provenBy: 'x', inheritDownToMhz: 2842,
      }).ok, false);

    // — the ratchet: the rare case the owner named himself. A lower frequency measuring MORE than an
    // already-closed higher one cannot be written as an inversion, and it is not silently clamped
    // either — the higher rows come UP and every one of them is NAMED (`plans/13` §4).
    const invertedDoc = sweepDoc([
      sweepRow(2850, 1045, { voltageMv: 990, tags: [CURVE_TAGS.STOP_EDGE_FOUND], provenBy: 'прожиг' }),
      ...bandRows,
    ]);
    const ratcheted = closePoint(invertedDoc, {
      mhz: 2842, voltageMv: 1010, status: CURVE_STATUS.EDGE_FOUND, provenBy: 'прожиг',
      at: '2026-08-16T01:00:00+03:00',
    });
    ok('ХРАПОВИК ПОДНИМАЕТ СОСЕДОК СВЕРХУ и называет каждую',
      [ratcheted.ok, ratcheted.raised, ratcheted.doc.frequencies[0].voltageMv],
      [true, [{ mhz: 2850, fromMv: 990, toMv: 1010 }], 1010]);
    ok('и документ после храповика проходит СВОЙ ЖЕ сторож (инверсии не осталось)',
      validateCurveDoc(ratcheted.doc).length, 0);

    // — the closed vocabulary and the card's grid are refusals, not warnings
    ok('мутатор отвергает статус вне закрытого словаря',
      closePoint(sweepDoc(bandRows), { mhz: 2842, voltageMv: 990, status: 'почти-край', provenBy: 'x' }).ok, false);
    ok('мутатор отвергает напряжение, которого у карты нет',
      closePoint(sweepDoc(bandRows), { mhz: 2842, voltageMv: 993, status: CURVE_STATUS.EDGE_FOUND, provenBy: 'x' }).ok, false);
    ok('и статус-улику без свидетеля — тоже',
      closePoint(sweepDoc(bandRows), { mhz: 2842, voltageMv: 990, status: CURVE_STATUS.EDGE_FOUND, provenBy: '  ' }).ok, false);

    // =============================================================================================
    // `plans/15` §4.5 — THE LOOP END TO END, on an injected atom and an injected save
    // =============================================================================================

    const cleanUndoS = [{ name: 'ОТКАТ: кривая обнулена', ok: true, undo: true }];
    // THE CLOCK UNDER TEST reaches the atom as the CAP in the shipped shape and as the PIN in the
    // owner's locked shape — the fixture reads whichever one carries it, exactly as the atom does.
    // Keying it on `capMhz` alone is what made eleven blocks red when step 7 became the default, and
    // the redness was the fixture's, not the engine's.
    const sweepAtom = (failsAtOrBelow) => async ({ offsetMhz, capMhz, pinMhz }) => {
      const clockMhz = pinMhz ?? capMhz;
      // What voltage did this offset put under the clock? The same rule the card uses, run on the
      // fixture table — so the atom answers about the voltage actually ordered rather than echoing it.
      const serving = sweepPoints.filter((p) => p.mhz + offsetMhz >= clockMhz).sort((a, b) => a.mv - b.mv)[0];
      const mv = serving?.mv ?? null;
      return {
        verdict: mv !== null && mv <= failsAtOrBelow ? config.VERDICT.SDC : P,
        worstShape: 'sdc_fma/transient', deliveredMhz: clockMhz, deliveredMaxMhz: clockMhz,
        undervolt: { capMhz: clockMhz, after: { mv } },
        blocks: cleanUndoS,
      };
    };
    const vectorPinned = () => ({ ok: true, capEnforced: false, capMhz: 2842, topMhz: 3172, lowestEnforceableCapMhz: 2172, capLeakMhz: 670 });

    const saves = [];
    const order = [];
    const burned = [];
    const full = await sweepRange({
      envelopeMhz: 3090,
      curveDoc: sweepDoc(bandRows), points: sweepPoints,
      runStepFn: async (args) => {
        const clock = args.pinMhz ?? args.capMhz;
        order.push(`ступень ${clock}`); burned.push(clock); return sweepAtom(980)(args);
      },
      buildVector: vectorPinned,
      saveFn: async (d) => { saves.push(d.frequencies.filter((r) => r.status !== CURVE_STATUS.STOCK).length); order.push('сохранение'); return { ok: true }; },
      now: () => '2026-08-16T02:00:00+03:00',
      clockMs: (() => { let t = 0; return () => (t += 1000); })(),
    });
    ok('РАЗВЁРТКА ЗАКРЫВАЕТ ВСЮ ПОЛОСУ: пять частот из пяти, обе ступени (E2-AC2)',
      [full.ok, full.closed, full.frequenciesInBand, full.verdicts['edge-found']],
      [true, 5, 5, 2]);
    // WHICH frequencies were actually BURNED — and this block exists because a mutation that burned
    // the rung's LOWEST frequency instead of its highest reddened NOTHING: the document came out
    // identical, since `closePoint` is called with the rung's top either way. Only the burn moved,
    // and the burn is the whole safety argument — Vmin does not decrease with frequency, so the
    // HARDEST member of the rung is the one that must be proved before the others inherit (E2-AC3).
    ok('СТУПЕНЬ ПРОЖИГАЕТСЯ НА САМОЙ ВЫСОКОЙ СВОЕЙ ЧАСТОТЕ — она самая трудная, остальные наследуют от неё',
      [...new Set(burned)].sort((a, b) => b - a), [2842, 2820]);
    // The order proof, and it is the point of «before the next frequency»: the document is on disk
    // before a single rung of the next rung is written.
    ok('ДОКУМЕНТ СОХРАНЯЕТСЯ ДО СЛЕДУЮЩЕЙ ЧАСТОТЫ, а не в конце прогона',
      [saves, order[order.length - 1], order.filter((x) => x === 'сохранение').length],
      [[3, 5], 'сохранение', 2]);

    // — F2-AC5, the only emergency stop the owner left, driven through a REAL journal: two machines
    // died on one rung, so the sweep does not start it a third time. The fixture is built the way a
    // hang actually builds it — an intent nobody closed, twice — rather than by handing the sweep a
    // pre-cooked blocked set, which would test the seam instead of the mechanism.
    const stopBox = mkdtempSync(join(tmpdir(), 'kago-sweep-blocked-'));
    try {
      const jstop = openJournal({ dir: join(stopBox, 'twice') });
      const at = '2026-08-16T02:00:00+03:00';
      for (const seq of [1, 2]) {
        // an intent with no verdict IS a hang, and `resumeState` is what turns it into one
        writeIntent(jstop, { seq, at, frequencyMhz: 2842, voltageMv: 1020, pointIndex: 4, deltaMhz: 100 });
        resumeState(jstop, { at });
      }
      const cardsUntouched = [];
      const stopped = await sweepRange({
        envelopeMhz: 3090,
        curveDoc: sweepDoc(bandRows), points: sweepPoints,
        runStepFn: async (a) => { cardsUntouched.push(a.capMhz); return sweepAtom(-1)(a); },
        buildVector: vectorPinned, journal: jstop,
        now: () => at,
        clockMs: (() => { let t = 0; return () => (t += 1000); })(),
      });
      // 🔴 THE ANSWER CHANGED WITH `bugs/23`, AND IT CHANGED IN THE SAFE DIRECTION — recorded here
      // rather than papered over, because a block quietly re-fitted to new behaviour is how a
      // regression ships. The card is still untouched and the sweep still refuses; what stops it is
      // now the HANG FLOOR, which fires after ONE hang instead of two. The floor SUBSUMES the brake
      // on this path: a rung the ladder may never order again cannot be started a third time.
      //
      // The brake is NOT deleted and NOT unproven — it keeps its own direct block one section above
      // («ступень, повесившая машину ДВАЖДЫ ПОДРЯД, третий раз не начинается, и атом не зван»), which
      // drives `runRung` itself. That is the honest split: the emergency stop the owner left guards
      // the place where the card is touched; the floor guards the place where the rung is chosen.
      ok('ДВА ЗАВИСАНИЯ: карту третий раз не трогают — и теперь останавливает ПОЛ, то есть РАНЬШЕ (bugs/23)',
        [stopped.ok, stopped.stoppedBy, stopped.closed, cardsUntouched.length],
        [false, 'hang-floor', 0, 0]);
      ok('и остановка НАЗЫВАЕТ зависание, а не «предел рычага» — статус не врёт про причину',
        /ЗАВИСАНИЕ НА 1020 мВ/.test(stopped.why ?? ''), true);
      ok('и заблокированная ступень НАЗВАНА в отчёте — 2842 МГц / 1020 мВ',
        (stopped.blocked ?? []).map((b) => [b.frequencyMhz, b.voltageMv]), [[2842, 1020]]);
      ok('одно зависание — НЕ блокировка: вероятностный край стирать нельзя',
        (() => {
          const jone = openJournal({ dir: join(stopBox, 'once') });
          writeIntent(jone, { seq: 1, at, frequencyMhz: 2842, voltageMv: 1020, pointIndex: 4, deltaMhz: 100 });
          return resumeState(jone, { at }).blocked.length;
        })(), 0);
    } finally {
      // The same teardown discipline as §4.4's: a temp directory this block created, and nothing else.
      // `bugs/08` is what a careless teardown costs — it deleted the production evidence store.
      rmSync(stopBox, { recursive: true, force: true });
    }

    // — a document that fails its own validator NEVER reaches the disk. Here the stamp is missing, so
    // the validator refuses the whole document after the first close.
    const badSaves = [];
    const noStamp = sweepDoc(bandRows);
    delete noStamp.stamp;
    const refusedDoc = await sweepRange({
      envelopeMhz: 3090,
      curveDoc: noStamp, points: sweepPoints,
      runStepFn: sweepAtom(980), buildVector: vectorPinned,
      saveFn: async () => { badSaves.push(1); return { ok: true }; },
      now: () => '2026-08-16T02:00:00+03:00',
      clockMs: (() => { let t = 0; return () => (t += 1000); })(),
    });
    ok('ДОКУМЕНТ, НЕ ПРОШЕДШИЙ СВОЙ СТОРОЖ, НА ДИСК НЕ ЕДЕТ',
      [refusedDoc.ok, refusedDoc.stoppedBy, badSaves.length], [false, 'document', 0]);

    // — `watchdog --recover` is a once-per-SWEEP action, and a failed recovery means no work begins
    let recoverCalls = 0;
    const recoverOrder = [];
    await sweepRange({
      envelopeMhz: 3090,
      curveDoc: sweepDoc(bandRows), points: sweepPoints,
      runStepFn: async (a) => { recoverOrder.push('ступень'); return sweepAtom(-1)(a); },
      buildVector: vectorPinned,
      recover: async () => { recoverCalls += 1; recoverOrder.push('подбор'); return { ok: true, recovered: false }; },
      now: () => '2026-08-16T02:00:00+03:00',
      clockMs: (() => { let t = 0; return () => (t += 1000); })(),
    });
    ok('ПОДБОР ЗАБЫТОЙ ЗАПИСИ — ОДИН РАЗ НА РАЗВЁРТКУ и ДО первой ступени',
      [recoverCalls, recoverOrder[0]], [1, 'подбор']);
    const deadRecover = await sweepRange({
      envelopeMhz: 3090,
      curveDoc: sweepDoc(bandRows), points: sweepPoints,
      runStepFn: async () => { throw new Error('атом не должен был запуститься'); },
      buildVector: vectorPinned,
      recover: async () => ({ ok: false, why: 'сторож держит карту' }),
      now: () => '2026-08-16T02:00:00+03:00',
    });
    ok('и провалившийся подбор ОСТАНАВЛИВАЕТ развёртку до первой записи в карту',
      [deadRecover.ok, deadRecover.stoppedBy, deadRecover.closed], [false, 'recover', 0]);

    // =============================================================================================
    // `plans/15` §4.7 — THE DRY RUN PRINTS THE LADDER THE RUN WILL WALK (F2-AC8)
    //
    // `bugs/09` is the whole reason: the plan once advertised −250 mV while the run stopped at −30.
    // The fix is not «keep them in agreement» — it is ONE computation, and these blocks are what
    // keeps it collapsed.
    // =============================================================================================

    const dryWalked = [];
    const dryDoc = sweepDoc(bandRows);
    const dry = await sweepDryRun({
      curveDoc: dryDoc, points: sweepPoints, buildVector: vectorPinned,
    });
    await sweepRange({
      envelopeMhz: 3090,
      curveDoc: dryDoc, points: sweepPoints,
      runStepFn: sweepAtom(-1), buildVector: vectorPinned,
      onEvent: (e) => { if (e.kind === 'rung') dryWalked.push([e.frequencyMhz, e.voltageMv]); },
      now: () => '2026-08-16T02:00:00+03:00',
      clockMs: (() => { let t = 0; return () => (t += 1000); })(),
    });
    // The comparison is the criterion itself: every rung the scripted run visited, against every rung
    // the plan promised — same order, same voltages, same frequencies.
    const dryPlanned = dry.groups.flatMap((g) => g.plan.rungs.map((r) => [g.topMhz, r.mv]));
    ok('ПЛАН ОБЕЩАЕТ РОВНО ТЕ СТУПЕНИ, ЧТО ПРОЙДЁТ ПРОГОН (F2-AC8)', dryWalked, dryPlanned);
    ok('и это НЕ пустое совпадение — ступеней в плане столько же, сколько прожигов насчитано',
      [dryPlanned.length > 0, dry.rungTotal], [true, dryPlanned.length]);

    // THE NUMBER WHOSE ABSENCE COST THE OWNER A NIGHT — the depth of the FIRST step, printed.
    const dryLines = sweepDryRunLines(dry);
    ok('СУХОЙ ПРОГОН ПЕЧАТАЕТ ГЛУБИНУ ПЕРВОГО ШАГА, держателя потолка и стену рычага',
      [dryLines.some((l) => l.includes('ПЕРВЫЙ ШАГ −25 мВ')),
        dryLines.some((l) => l.includes('потолок на первой ступени держит: закрепление частоты')),
        dryLines.some((l) => l.includes('рычаг достаёт до 930 мВ')),
        dryLines.some((l) => l.includes('В КАРТУ НЕ ЗАПИСАНО НИЧЕГО'))],
      [true, true, true, true]);

    // A SEEDED plan names BOTH ladders, because a rejected seed drops the descent to stock and the
    // operator would otherwise be reading a plan that stops being true exactly in the rare case the
    // owner said happens.
    const drySeeded = await sweepDryRun({
      curveDoc: sweepDoc([
        sweepRow(2850, 1045, { voltageMv: 1000, tags: [CURVE_TAGS.STOP_EDGE_FOUND], provenBy: 'прожиг' }),
        ...bandRows,
      ]),
      points: sweepPoints, buildVector: vectorPinned, fromMhz: 2842, toMhz: 2828,
    });
    ok('СУХОЙ ПРОГОН НАЗЫВАЕТ ОБЕ ЛЕСТНИЦЫ: по затравке и запасную от стока',
      (() => {
        const l = sweepDryRunLines(drySeeded);
        return [l.some((x) => x.includes('затравка 1000 мВ от соседки 2850 МГц')),
          l.some((x) => x.includes('если затравка НЕ пройдёт'))];
      })(), [true, true]);

    // — the report is COUNTED, not claimed (E2-AC2), and the wall time stands against the estimate
    const lines = sweepReportLines(full);
    ok('ОТЧЁТ СЧИТАЕТ покрытие, вердикты, откаты затравки и время против оценки',
      [lines.some((l) => l.includes('ПОКРЫТИЕ: закрыто 5 из 5')),
        lines.some((l) => l.includes('край найден 2')),
        lines.some((l) => l.includes('ЗАТРАВКА: отвергнута')),
        lines.some((l) => l.includes('против оценки 1.7 ч'))],
      [true, true, true, true]);

    // — `bugs/13`: THE LIVE SWEEP'S JOURNAL IS THE PRODUCTION ONE, and the teardown guard must never
    //   sit on that path. The check is on the SOURCE because the live path cannot be exercised
    //   offline (it opens NVAPI) — and that unexercisability is exactly why the defect survived: the
    //   sweep opened the production journal, then demanded it be a sandbox, and refused itself
    //   before touching the card. Caught only by the first real launch, 2026-08-16.
    //   ADDRESSEE: put `assertJournalSandbox(journal)` back into `mainSweep` → this block.
    ok('ЖИВАЯ РАЗВЁРТКА НЕ ТРЕБУЕТ ОТ СВОЕГО ЖУРНАЛА БЫТЬ ПЕСОЧНИЦЕЙ (bugs/13)',
      (() => {
        const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
        // THE ANCHOR IS THE DECLARATION, newline included. Anchoring on the bare name matched THIS
        // BLOCK'S OWN LITERAL — which sits earlier in the file — so the slice began inside the
        // selftest and swept up every later use of the guard, including legitimate ones in fixtures.
        // A source-reading check has to point at syntax, not at a word that also appears in itself.
        const start = src.indexOf('\nasync function mainSweep(');
        if (start < 0) return 'объявления mainSweep в модуле НЕТ — блок потерял свой адресат';
        const rest = src.slice(start);
        const end = rest.indexOf('\nasync function main(');
        // COMMENTS ARE STRIPPED FIRST. The paragraph above the journal line NAMES the removed call so
        // a future reader knows why it is absent — and a guard that reddens at its own explanation is
        // a guard nobody can document around. It must read CODE, not prose.
        const code = rest.slice(0, end > 0 ? end : rest.length)
          .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        return /assertJournalSandbox\s*\(/.test(code);
      })(), false);

    // =============================================================================================
    // THE OWNER'S RULE — «ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ» (`GOAL.md`, 2026-08-16)
    //
    // The card sits 20–30 MHz below any ceiling and cannot be lifted (`researches/11`, measured), so
    // the voltage a rung proves belongs to the clock the card RAN, not the one we asked for.
    //
    // MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
    //   M. close at `g.topMhz` again (ignore the delivered clock)  → «ЗАМЕР ЛОЖИТСЯ В СТРОКУ ВЫДАННОЙ»
    //   N. fall back to the ordered clock when delivered is null   → «БЕЗ ВЫДАННОЙ ЧАСТОТЫ РАЗВЁРТКА ВСТАЁТ»
    //   O. drop the `Math.min` on the inheritance floor            → «НАСЛЕДОВАНИЕ НЕ ЛЕЗЕТ ВВЕРХ»
    //   P. snap the off-grid clock UPWARD instead of down          → «ВНЕ СЕТКИ ПРИТЯГИВАЕТСЯ ВНИЗ»
    //   Q. stop counting divergences into `report.delivered`       → «ОТЧЁТ НАЗЫВАЕТ КАЖДОЕ РАСХОЖДЕНИЕ»
    //   R. keep the delivered clock only from the LAST rung        → «СТРОКУ РЕШАЕТ ПОСЛЕДНИЙ ПРОШЕДШИЙ»
    // =============================================================================================

    // — THE PLAN AND THE RUN NAME THE SAME HOLDER. Caught live 2026-08-16, one commit after the
    //   default moved: `sweepRange` had switched to the flattened curve while `sweepDryRun` still
    //   defaulted to the lock, so the artifact rail S2 makes the operator read BEFORE authorising a
    //   write described a shape the run would not use. `bugs/09` is exactly this, and the existing
    //   «план обещает ровно те ступени» block did not catch it because it compares RUNGS, not the
    //   holder. ADDRESSEE: give `sweepDryRun` a different `demandPin` default → this block.
    // ⚠️ THE HOLDER ON THE RUN'S SIDE IS TAKEN FROM `sweepRange`, NOT FROM `runRung` — and that
    // distinction is the whole reason this block exists in this form. Its first edition compared the
    // plan against `runRung`, and it stayed GREEN through the live defect it was written to catch:
    // the two AGREED, while `sweepRange` — the function the live command actually calls — carried a
    // third default of its own and overrode both (`bugs/14` defect 3). A guard must interrogate the
    // path that executes, never a neighbour that resembles it.
    //
    // The value is read out of the JOURNAL, because that is where the live path records what it did:
    // same field, same writer, no second opinion.
    const holderBox = mkdtempSync(join(tmpdir(), 'kago-holder-'));
    let holderInRun = null;
    try {
      const hj = openJournal({ dir: holderBox });
      await sweepRange({
        curveDoc: sweepDoc([sweepRow(2842, 1045)]), points: sweepPoints, envelopeMhz: 3090,
        journal: hj, buildVector: vectorCapped, runStepFn: sweepAtom(0),
        saveFn: async () => ({ ok: true }),
        now: () => '2026-08-16T02:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
      });
      holderInRun = readJournal(hj).records.find((r) => r.state === 'intent')?.holder ?? 'намерений в журнале нет';
    } finally {
      rmSync(assertJournalSandbox({ dir: holderBox }), { recursive: true, force: true });
    }
    const holderInPlan = (await sweepDryRun({
      curveDoc: sweepDoc([sweepRow(2842, 1045)]), points: sweepPoints, buildVector: vectorCapped,
    })).groups[0]?.holder;
    ok('ПЛАН И ПРОГОН НАЗЫВАЮТ ОДНОГО ДЕРЖАТЕЛЯ — иначе оператор санкционирует не тот прогон (bugs/09, bugs/14)',
      [holderInPlan, holderInRun], ['кривая', 'кривая']);

    // ─── ЗАЖАТЫЙ КРАЙ ПРОПУСКАЕТСЯ, ГРУБАЯ СКОБКА — НЕТ (`bugs/31`, `plans/25` шаг 1.2) ────────────
    //
    // Ещё один шов, вышедший в бой без сторожа: замерено 2026-08-23, мутация «убрать пропуск»
    // оставила батарею зелёной, 959 блоков из 959. Оба исхода стоят денег в разные стороны —
    // пропустить незажатую частоту значит не измерить её вовсе, а жечь зажатую значит платить
    // прожигами за то, что журнал уже знает.
    //
    // Блок судит ЧТО СДЕЛАЛА РАЗВЁРТКА (список прожжённых частот и `report.preBracketed`), а не что
    // она сказала: сообщение можно напечатать и всё равно пойти жечь.
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   CM. убрать пропуск (`already = null`)              → «ЗАЖАТЫЙ КРАЙ НЕ ЖГЁТСЯ ЗАНОВО»
    //   CN. считать краем ЛЮБУЮ пару стены и прошедшей     → «ГРУБАЯ СКОБКА ПРОХОДИТСЯ ПРОГОНОМ»
    //   CO. не заполнять `report.preBracketed`             → «ПРОПУСК НАЗВАН В ОТЧЁТЕ ЧИСЛАМИ»
    //   CP. принять скобку, где стена ВЫШЕ прошедшей       → «СКОБКА ОБЯЗАНА БЫТЬ СКОБКОЙ»
    {
      // Сетка развёртки — 930…1045 с шагом 5 мВ, поэтому «соседние ступени» это ровно 5 мВ.
      // Падение развёртки превращается в ответ, а не в мёртвый отчёт (EXP-0040) — здесь это не
      // предосторожность впрок: мутация «разыменовать `plan.seed` без проверки» роняла набор именно
      // на этих прогонах, и «набор не дошёл до конца» читается как «ничего не нашли».
      const bracketRun = async (label, { passedMv, hungMv }) => {
        const box = mkdtempSync(join(tmpdir(), `kago-bracket-${label}-`));
        try {
          const bj = openJournal({ dir: box });
          writeIntent(bj, { seq: 1, at: '2026-08-22T23:00:00+03:00', frequencyMhz: 2842, voltageMv: passedMv });
          writeVerdict(bj, { seq: 1, at: '2026-08-22T23:00:10+03:00', outcome: RUNG_OUTCOME.PASSED, verdict: P, servingMvAfter: passedMv });
          writeIntent(bj, { seq: 2, at: '2026-08-22T23:05:00+03:00', frequencyMhz: 2842, voltageMv: hungMv });
          writeVerdict(bj, { seq: 2, at: '2026-08-22T23:20:00+03:00', outcome: RUNG_OUTCOME.HUNG, verdict: config.VERDICT.HUNG, why: 'фикстура: машина ушла в перезагрузку' });
          const burned = [];
          const r = await sweepRange({
            curveDoc: sweepDoc([sweepRow(2842, 1045)]), points: sweepPoints, envelopeMhz: 3090,
            journal: bj, buildVector: vectorPinned,
            runStepFn: async (a) => { burned.push(a.pinMhz ?? a.capMhz); return sweepAtom(0)(a); },
            saveFn: async () => ({ ok: true }),
            now: () => '2026-08-23T09:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
          });
          return { r, burned };
        } catch (e) {
          return { r: { ok: false, preBracketed: [`развёртка УПАЛА: ${e?.message ?? e}`] }, burned: [] };
        } finally {
          rmSync(assertJournalSandbox({ dir: box }), { recursive: true, force: true });
        }
      };
      // ТОНКАЯ СКОБКА: прошло 1000, повесило 995 — соседние ступени сетки, жечь между ними нечего.
      const tight = await bracketRun('tight', { passedMv: 1000, hungMv: 995 });
      ok('ЗАЖАТЫЙ КРАЙ НЕ ЖГЁТСЯ ЗАНОВО: между стеной и прошедшей ступенью пусто — ни одного прожига',
        [tight.burned.length, tight.r.preBracketed.length], [0, 1]);
      ok('ПРОПУСК НАЗВАН В ОТЧЁТЕ ЧИСЛАМИ: частота, что прошло и что повесило',
        tight.r.preBracketed[0] ?? 'пропуска в отчёте нет вовсе',
        { frequencyMhz: 2842, passedMv: 1000, hungMv: 995 });
      // ГРУБАЯ СКОБКА: прошло 1000, повесило 985 — ступени 990 и 995 не жёг никто. Правило владельца
      // об уточнении грубого отказа минимальным шагом сильнее экономии прожигов.
      const coarse = await bracketRun('coarse', { passedMv: 1000, hungMv: 985 });
      ok('ГРУБАЯ СКОБКА ПРОХОДИТСЯ ПРОГОНОМ: между 985 и 1000 остались неиспытанные ступени',
        [coarse.burned.length > 0, coarse.r.preBracketed.length], [true, 0]);
      // СКОБКА ОБЯЗАНА БЫТЬ СКОБКОЙ: стена ВЫШЕ прошедшей ступени ничего не зажимает — там ещё
      // весь спуск ниже прошедшей, и пропуск был бы отказом от измерения.
      const inverted = await bracketRun('inverted', { passedMv: 990, hungMv: 1000 });
      ok('СКОБКА ОБЯЗАНА БЫТЬ СКОБКОЙ: стена выше прошедшей — это не край, частота идёт в прогон',
        [inverted.r.preBracketed.length, inverted.burned.length > 0], [0, true]);
    }

    // ─── ЗЕМЛЯ — САМАЯ ГЛУБОКАЯ ПРОШЕДШАЯ, А НЕ ПОСЛЕДНЯЯ (`bugs/36`) ───────────────────────────
    //
    // Второй живой прогон подряд встал на 2820 МГц, покрытие 0 из 17. Сверено по журналу: 865 мВ
    // прошли ПЕРВОЙ ступенью, затем карта прогрелась, заказы 860/910/900 стали обслуживаться 915 мВ
    // (ось частот сползает с нагревом, R14b), земля поднялась на 915 — и попадание точно в цель
    // 875 → 875 было объявлено прыжком в 40 мВ при стене 35.
    //
    // Блоки судят САМ СПУСК через `sweepFrequency`, а не арифметику в отрыве: дефект был в том,
    // ЧТО спуск запоминает между ступенями, и на отдельной функции его не видно.
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   DK. вернуть `lastPass = provedMv` (последняя)   → «ПРОМАХ ВВЕРХ НЕ ПОДНИМАЕТ ЗЕМЛЮ»
    //   DL. брать МАКСИМУМ вместо минимума              → «ПРОМАХ ВВЕРХ НЕ ПОДНИМАЕТ ЗЕМЛЮ»
    {
      // Карта, которая на КАЖДОЙ ступени отдаёт напряжение на две ступени сетки ВЫШЕ заказанного —
      // ровно поведение прогретой карты 2026-08-23. Первая ступень попадает точно (это затравка).
      // ⚠️ ВЕЛИЧИНА ПРОМАХА ВЗЯТА С ЖИВОЙ КАРТЫ, А НЕ ПРИДУМАНА. Первая редакция промахивалась на
      // +10 мВ, и мутация «вернуть последнюю прошедшую» НЕ ПОКРАСНЕЛА: шаг 25 плюс промах 10 — это
      // ровно стена 35, а не сверх неё. Настоящая карта 2026-08-23 промахнулась на +50 (заказ 860 →
      // обслужило 915). Фикстура берёт +30: достаточно, чтобы перешагнуть стену, и заведомо ниже
      // стока, чтобы не покраснеть по чужой причине («выдача выше стока»).
      //
      // ПЕРВАЯ ступень попадает ТОЧНО — так и было на карте: затравка легла в цель, и именно она
      // остаётся самой глубокой доказанной, пока прогрев уводит все последующие вверх.
      const driftAtom = () => {
        let n = 0;
        return async ({ offsetMhz, capMhz, pinMhz }) => {
          const clock = pinMhz ?? capMhz;
          const serving = sweepPoints.filter((p) => p.mhz + offsetMhz >= clock).sort((a, b) => a.mv - b.mv)[0];
          const mv = serving?.mv ?? null;
          const top = sweepGrid[sweepGrid.length - 1];
          const drifted = (n++ === 0 || mv === null) ? mv : Math.min(mv + 30, top - 5);
          return {
            verdict: P, worstShape: 'sdc_fma/transient', deliveredMhz: clock, deliveredMaxMhz: clock,
            undervolt: { capMhz: clock, after: { mv: drifted } }, blocks: cleanUndoS,
          };
        };
      };
      // ⚠️ ПОЛ ЗАВИСАНИЯ ОБЯЗАТЕЛЕН В ЭТОЙ ФИКСТУРЕ, И ЭТО НЕ УКРАШЕНИЕ. Первая редакция гоняла
      // спуск без него — и мутация «вернуть последнюю прошедшую» НЕ ПОКРАСНЕЛА. Причина оказалась
      // в коде, а не в мутации (EXP-0077): у спуска есть ПЕРЕСЧЁТ цели от земли, и он поглощает
      // завышение — прогон не встаёт, а переходит ступени заново (ровно те девять лишних прожигов,
      // что видел владелец). Остановка случается в УТОЧНЕНИИ, где пересчёта нет: `refineEdge` ведёт
      // свой счёт вглубь, а земля, выдаваемая каждой его ступени, берётся из ВНЕШНЕЙ `lastPass` и
      // остаётся замороженной. Значит фикстура обязана довести спуск до уточнения — то есть до пола.
      const driftBox = mkdtempSync(join(tmpdir(), 'kago-drift-'));
      let drifted;
      try {
        const dj = openJournal({ dir: driftBox });
        writeIntent(dj, { seq: 1, at: '2026-08-22T23:00:00+03:00', frequencyMhz: 2842, voltageMv: 940 });
        writeVerdict(dj, { seq: 1, at: '2026-08-22T23:20:00+03:00', outcome: RUNG_OUTCOME.HUNG, verdict: config.VERDICT.HUNG, why: 'фикстура: пол зависания' });
        drifted = await sweepRange({
          curveDoc: sweepDoc([sweepRow(2842, 1045)]), points: sweepPoints, envelopeMhz: 3090,
          fromMhz: 2842, toMhz: 2842, journal: dj, runStepFn: driftAtom(), buildVector: vectorPinned,
          saveFn: async () => ({ ok: true }),
          now: () => '2026-08-23T11:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
        });
      } finally {
        rmSync(assertJournalSandbox({ dir: driftBox }), { recursive: true, force: true });
      }
      ok('ПРОМАХ ВВЕРХ НЕ ПОДНИМАЕТ ЗЕМЛЮ: прогретая карта не роняет уточнение на стене обрыва',
        [drifted.ok, drifted.stoppedBy], [true, null]);
      ok('и остановки по глубине не случилось ни на одной ступени',
        /ШАГ ОТ ДОКАЗАННОГО/.test(String(drifted.why ?? '')), false);
      ok('частота при этом ЗАКРЫТА, а не брошена — работа прогона не потеряна',
        drifted.closed, 1);
    }

    // ─── СПУСК, КОТОРЫЙ НЕ ПРОДВИГАЕТСЯ, ОСТАНАВЛИВАЕТСЯ САМ (`bugs/42`) ─────────────────────────
    //
    // 🔴 ЖИВОЙ ВЕЧЕР 2026-08-23. Карта владельца на КАЖДЫЙ заказ отдавала одно и то же напряжение:
    // заказ 885 мВ → обслужило 915, земля застыла на 915, стена 35 мВ снова разрешила 885 — и прогон
    // крутился, тратя по полному прожигу на оборот. Ни один сторож не сработал, и не мог: каждая
    // ступень по отдельности законна, дефект живёт в ПОСЛЕДОВАТЕЛЬНОСТИ. Остановил человек.
    //
    // ФИКСТУРА — ровно та карта: что бы ни заказали, обслуживает 915 мВ. Раньше этот прогон не
    // закончился бы НИКОГДА, поэтому у блока есть бюджет ступеней: без него красный блок выглядел бы
    // как повисший набор, а «не напечатал провалов» и «умер» — разные вещи (правило батареи).
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА — И ОБЕ ВЗЯТЫ ИЗ ОТВЕРГНУТЫХ РЕДАКЦИЙ ЭТОЙ ЖЕ ПОЧИНКИ,
    // а не придуманы. Мутация, повторяющая настоящую промежуточную ошибку, судит сторожа честнее
    // выдуманной: она уже случалась.
    //   DM. отмерять шаг зоны от ДОКАЗАННОЙ ЗЕМЛИ, а не от места, где спуск стоит
    //       (`currentMv: ground` вместо `currentMv: standMv`) → пересчёт предлагает уже прожжённую
    //       ступень, порядок заказов ломается (…970, потом ВВЕРХ на 975), сторож повторного заказа
    //       срабатывает → краснеют ОБА блока ниже.
    //   DN. снять сам сторож повторного заказа (`orderedMvHere.has`) → на этой фикстуре порядок
    //       остаётся честным, поэтому блок НЕ покраснеет; красным его делает только связка DM+DN,
    //       и это записано, а не умолчано: сторож здесь СТРАХОВКА над структурным свойством, а
    //       свойство доказывается мутацией DM.
    {
      // ─── ЗАКРЕПЛЁННОЕ НАПРЯЖЕНИЕ ЛЕЖИТ ВНУТРИ СЕТКИ, И ЭТО ВСЯ РАЗНИЦА ─────────────────────────
      //
      // 🔴 ПРЕЖНЯЯ РЕДАКЦИЯ ЭТОЙ ФИКСТУРЫ БЫЛА ОБЫЧНОЙ КАРТОЙ, а не залипшей, и мутация DM не
      // красила её именно поэтому. Закрепление стояло на `915 мВ`, а сетка этого набора идёт
      // 930…1045 — то есть `max(заказ, 915)` возвращал ЗАКАЗАННОЕ на каждой из шести ступеней.
      // Замерено пробой 2026-08-23 20:0x: `1020→1020 995→995 970→970 945→945 935→935 930→930`,
      // повторов ноль. Долг `bugs/42` был не в мутации и не в сторожe, а в числе, которое не
      // попадало в диапазон, где механизм вообще существует (тот же класс, что EXP-0077: мутация,
      // не покрасившая ничего, — находка о КОДЕ, а здесь о фикстуре).
      //
      // ЗАКРЕПЛЕНИЕ 1000 мВ ВОСПРОИЗВОДИТ ЖИВОЙ ВЕЧЕР: пока заказ выше 1000 — попадание, ниже —
      // карта всё равно обслуживает 1000. Земля (самая глубокая ПРОШЕДШАЯ, `bugs/36`) застывает на
      // 1000, стена 35 мВ от неё разрешает одну и ту же ступень, и пересчёт возвращает её второй
      // раз подряд. Ровно то, что владелец видел на 2700 МГц (заказ 885 → 915, дважды).
      const PIN_MV = 1000;
      const BUDGET = 30;
      let calls = 0;
      const stuckSeq = [];
      const stuckSaid = [];
      const stuckAtom = async ({ offsetMhz, capMhz, pinMhz }) => {
        if (++calls > BUDGET) throw new Error(`БЮДЖЕТ СТУПЕНЕЙ ИСЧЕРПАН (${BUDGET}): спуск не продвигается`);
        const clock = pinMhz ?? capMhz;
        const serving = sweepPoints.filter((p) => p.mhz + offsetMhz >= clock).sort((a, b) => a.mv - b.mv)[0];
        const ordered = serving?.mv ?? PIN_MV;
        const delivered = Math.max(ordered, PIN_MV);
        stuckSeq.push(`${ordered}→${delivered}`);
        return {
          verdict: P, worstShape: 'sdc_fma/transient', deliveredMhz: clock, deliveredMaxMhz: clock,
          undervolt: { capMhz: clock, after: { mv: delivered } }, blocks: cleanUndoS,
        };
      };
      let stuck = null;
      let stuckThrew = null;
      try {
        stuck = await sweepRange({
          curveDoc: sweepDoc([sweepRow(2842, 1045)]), points: sweepPoints, envelopeMhz: 3090,
          fromMhz: 2842, toMhz: 2842, journal: null, runStepFn: stuckAtom, buildVector: vectorPinned,
          saveFn: async () => ({ ok: true }), onEvent: (e) => stuckSaid.push(e),
          now: () => '2026-08-23T20:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
        });
      } catch (e) { stuckThrew = e.message; }
      const ordered = stuckSeq.map((s) => Number(s.split('→')[0]));
      const strictlyDown = ordered.every((v, i) => i === 0 || v < ordered[i - 1]);
      // ⚠️ БЛОК СУДИТ ИНВАРИАНТ, А НЕ СРАБАТЫВАНИЕ СТОРОЖА — И ЭТО СОЗНАТЕЛЬНО.
      //
      // На залипшей карте целый прогон обязан пройти БЕЗ ЕДИНОГО повторного заказа: пересчёт
      // отмеряет шаг зоны от места, где спуск стоит, поэтому каждая следующая цель строго ниже
      // предыдущей, пока не кончится стена `bugs/03` от доказанной земли. Тогда спуск закрывает
      // частоту сам, `rebase-exhausted`. Сторож повторного заказа — страховка НАД этим свойством, и
      // блок, требующий его срабатывания, требовал бы, чтобы свойство было нарушено.
      //
      // 🔴 ИМЕННО ЗДЕСЬ БЫЛА ОШИБКА ПЕРВОЙ РЕДАКЦИИ ПОЧИНКИ, и она стоила бы прогона: пересчёт брал
      // шаг зоны от ДОКАЗАННОЙ ЗЕМЛИ (1000 мВ), а не от последней заказанной (970), и предлагал
      // 975 — ступень ВЫШЕ той, что уже прожгли. Порядок заказов ломался, сторож срабатывал, и
      // частота закрывалась там, где спуску оставалось ещё две ступени. Мутация DM возвращает ровно
      // эту ошибку.
      ok('НА ЗАЛИПШЕЙ КАРТЕ СПУСК НЕ ЗАКАЗЫВАЕТ ОДНО НАПРЯЖЕНИЕ ДВАЖДЫ И НЕ ХОДИТ ВВЕРХ',
        [strictlyDown, new Set(ordered).size === ordered.length, stuckSaid.some((e) => e.kind === 'no-progress')],
        [true, true, false]);
      // Вторая половина — сама последовательность. Она показывает МЕХАНИЗМ числами: три честные
      // ступени, затем пересчёт от 970 идёт вниз до 965 и упирается в стену от земли 1000 мВ.
      // ⚠️ ШАГ 970 → 965 — ЭТО И ЕСТЬ ВТОРАЯ ПОЧИНКА `bugs/42`, ВИДНАЯ ЧИСЛОМ: шаг отмеряется
      // лестницей владельца от места стояния и подрезается остатком стены (35 − 30 = 5 мВ), а не
      // берётся максимальным до стены, как раньше.
      ok('и последовательность заказов кончается стеной от доказанного, а не повтором',
        stuckSeq.join(' '), '1020→1020 995→1000 970→1000 965→1000');
      ok('прогон при этом жив: бюджет ступеней не исчерпан', [stuckThrew, calls <= BUDGET], [null, true]);
      ok('частота ЗАКРЫТА тем, что доказано, а полоса НЕ уронена',
        [stuck?.closed, stuck?.stoppedBy], [1, null]);
    }

    // ─── ПРОГОН ЗАКАЗЫВАЕТ РОВНО ТУ ЗАТРАВКУ, ЧТО НАПЕЧАТАЛ ПЛАН (`bugs/32`) ──────────────────────
    //
    // Дефект, найденный блоками выше в момент их написания, 2026-08-23: план выбирал глубочайшую из
    // двух улик и клал решение в `plan.seedMv`, а `sweepFrequency` брал `plan.seed.seedMv` — сырой
    // ответ соседки. Замерено пробой: план 870 мВ, прогон заказал бы 990. То есть починка `bugs/31`
    // не доезжала до карты, а сухой прогон — документ разрешения на запись (рельс S2) — обещал не то,
    // что произойдёт. Второе лицо: без оттюненной соседки `plan.seed` равен `null`, и развёртка
    // падала `TypeError`-ом на первой же частоте полосы.
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   CQ. вернуть заказ по `plan.seed.seedMv`           → «ПРОГОН ЗАКАЗЫВАЕТ ЗАТРАВКУ ПЛАНА»
    //   CR. разыменовать `plan.seed` без проверки         → «БЕЗ СОСЕДКИ РАЗВЁРТКА НЕ ПАДАЕТ»
    //   CS. приписать собственную улику соседке в свидетеле → «СВИДЕТЕЛЬ НАЗЫВАЕТ ИСТОЧНИК УЛИКИ»
    {
      // ⚠️ ПАДЕНИЕ ЗДЕСЬ ОБЯЗАНО СТАТЬ КРАСНЫМ БЛОКОМ, А НЕ МЁРТВЫМ ОТЧЁТОМ (EXP-0040). Именно этот
      // прогон и падал `TypeError`-ом до починки `bugs/32`, унося весь набор — а «набор не дошёл до
      // конца» читается как «ничего не нашли». Исключение ловится и превращается в ответ, который
      // блок сравнит и покраснит с названной причиной.
      const seedRun = async (label, { rows, provenMv }) => {
        const box = mkdtempSync(join(tmpdir(), `kago-seed-${label}-`));
        try {
          const sj = openJournal({ dir: box });
          writeIntent(sj, { seq: 1, at: '2026-08-22T23:00:00+03:00', frequencyMhz: 2842, voltageMv: provenMv });
          writeVerdict(sj, { seq: 1, at: '2026-08-22T23:00:10+03:00', outcome: RUNG_OUTCOME.PASSED, verdict: P, servingMvAfter: provenMv });
          const ordered = [];
          const events = [];
          const r = await sweepRange({
            curveDoc: sweepDoc(rows), points: sweepPoints, envelopeMhz: 3090, fromMhz: 2842, toMhz: 2842,
            journal: sj, buildVector: vectorPinned,
            runStepFn: async (a) => { ordered.push(a.offsetMhz); return sweepAtom(0)(a); },
            saveFn: async () => ({ ok: true }), onEvent: (e) => events.push(e),
            now: () => '2026-08-23T09:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
          });
          // Прогон заказывает СДВИГ, а не милливольты. Обратный перевод — та же таблица, тем же
          // правилом, что и у атома: какое напряжение этот сдвиг подставляет под частоту.
          const mvOf = (offsetMhz) => sweepPoints.filter((p) => p.mhz + offsetMhz >= 2842).sort((a, b) => a.mv - b.mv)[0]?.mv ?? null;
          return { r, firstOrderedMv: ordered.length ? mvOf(ordered[0]) : null, events };
        } catch (e) {
          return { r: { ok: `развёртка УПАЛА: ${e?.message ?? e}` }, firstOrderedMv: null, events: [] };
        } finally {
          rmSync(assertJournalSandbox({ dir: box }), { recursive: true, force: true });
        }
      };
      // Соседка 2850 МГц оттюнена до 1000 мВ, а СВОЯ улика частоты глубже — 970 мВ.
      const withNeighbour = [
        sweepRow(2850, 1045, { voltageMv: 1000, tags: [CURVE_TAGS.STOP_EDGE_FOUND, CURVE_TAGS.BURN_SHORT], provenBy: 'прожиг' }),
        sweepRow(2842, 1045),
      ];
      const planned = planFrequency({
        frequencyMhz: 2842, stockVoltageMv: 1045, voltageGridMv: sweepGrid,
        availableDepthMv: 200, curveDoc: sweepDoc(withNeighbour), provenPassMv: 970,
      });
      const ran = await seedRun('deeper-own', { rows: withNeighbour, provenMv: 970 });
      ok('ПРОГОН ЗАКАЗЫВАЕТ ЗАТРАВКУ ПЛАНА, а не сырой ответ соседки (bugs/32)',
        [planned.seedMv, ran.firstOrderedMv, planned.seedMv === ran.firstOrderedMv], [970, 970, true]);
      // БЕЗ СОСЕДКИ — документ из одной строки. Здесь `plan.seed` равен `null`, и до починки этот
      // прогон падал `TypeError`-ом, унося весь набор (блок ловит ПРИЧИНУ: он дошёл до конца).
      const alone = await seedRun('no-neighbour', { rows: [sweepRow(2842, 1045)], provenMv: 970 });
      ok('БЕЗ СОСЕДКИ РАЗВЁРТКА НЕ ПАДАЕТ: собственная улика стартует спуск сама',
        [alone.r.ok, alone.firstOrderedMv], [true, 970]);
      // СВИДЕТЕЛЬ НАЗЫВАЕТ ИСТОЧНИК. «от соседки undefined МГц» — это ложь в документе, который
      // читает следующая сессия, и она хуже отсутствующей строки.
      const note = (alone.events.find((e) => e.kind === 'seed-accepted')?.text ?? '');
      ok('СВИДЕТЕЛЬ НАЗЫВАЕТ ИСТОЧНИК УЛИКИ: собственная улика не приписывается соседке',
        [/СОБСТВЕННОЙ улики/.test(note), /соседки undefined/.test(note), /соседки null/.test(note)],
        [true, false, false]);
    }

    // ─── ПЛАН И ПРОГОН ЖГУТ ОДНИМ И ТЕМ ЖЕ (`bugs/33`) ───────────────────────────────────────────
    //
    // Найдено живым сухим прогоном 2026-08-23: команда передавала в развёртку ОДИН набор форм, а
    // печать плана строила себе лестницу из четырёх уровней заново и обещала оператору
    // переигрывание ослабленной нагрузкой, которого не будет. Сухой прогон — документ рельса S2,
    // который читают ПЕРЕД разрешением записи в карту владельца; ложь именно там дороже всего
    // (`bugs/09`, EXP-0052).
    //
    // Пара СХЛОПНУТА (`sweepBurnLadder`), а не поставлена под наблюдение — реестр пар предпочитает
    // именно это. Блок — то, что держит её схлопнутой.
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   CT. вернуть плану собственный расчёт из 4 уровней  → «ПЛАН И ПРОГОН ЖГУТ ОДНИМ И ТЕМ ЖЕ»
    //   CU. пообещать переигрывание при одной попытке      → «ПЛАН НЕ ОБЕЩАЕТ ПЕРЕИГРЫВАНИЯ»
    {
      const ladder = sweepBurnLadder();
      const dryForBurn = await sweepDryRun({
        curveDoc: sweepDoc([sweepRow(2842, 1045)]), points: sweepPoints, buildVector: vectorPinned,
      });
      const burnLine = sweepDryRunLines(dryForBurn).find((l) => l.startsWith('ПРОЖИГ:')) ?? 'строки ПРОЖИГ нет вовсе';
      // Число попыток на ступень в плане обязано совпасть с длиной лестницы, которую получит прогон.
      ok('ПЛАН И ПРОГОН ЖГУТ ОДНИМ И ТЕМ ЖЕ: план называет ровно столько попыток, сколько их будет',
        [/попытка на ступень 1\b/.test(burnLine), ladder.length], [true, 1]);
      // И не обещает того, чего при одной попытке произойти не может.
      ok('ПЛАН НЕ ОБЕЩАЕТ ПЕРЕИГРЫВАНИЯ, которого при одной попытке не будет — и говорит ПОЧЕМУ',
        [/ПЕРЕИГРЫВАНИЯ НЕТ/.test(burnLine), /ПЕРЕИГРЫВАЕТСЯ/.test(burnLine),
          /ВЫДАННУЮ\s+частоту/.test(burnLine)],
        [true, false, true]);
    }

    // — the resolver alone, on hostile inputs. It is the one place allowed to pick a row.
    const docForRows = sweepDoc(bandRows);
    ok('ВНЕ СЕТКИ ПРИТЯГИВАЕТСЯ ВНИЗ: 2831 МГц → строка 2828, и притяжка НАЗВАНА',
      (() => { const r = resolveDeliveredRow(docForRows, 2831); return [r.ok, r.mhz, r.snapped]; })(),
      [true, 2828, true]);
    ok('точное попадание строкой — не притяжка',
      (() => { const r = resolveDeliveredRow(docForRows, 2835); return [r.ok, r.mhz, r.snapped]; })(),
      [true, 2835, false]);
    ok('нет выданной частоты → ОТКАЗ, а не подстановка заказанной',
      (() => { const r = resolveDeliveredRow(docForRows, null); return [r.ok, r.mhz]; })(), [false, null]);
    ok('выданное НИЖЕ всего документа → отказ: притягивать некуда',
      resolveDeliveredRow(docForRows, 1000).ok, false);

    // — the loop, end to end, on a card that delivers 14 MHz BELOW every order. Two ladder steps, so
    //   each measurement lands two rows down and the divergence is unmistakable.
    const sagAtom = (sagMhz) => async (a) => {
      const r = await sweepAtom(0)(a);                       // 0 = nothing fails; we are testing the row, not the edge
      const clock = (a.pinMhz ?? a.capMhz) - sagMhz;
      return { ...r, deliveredMhz: clock, deliveredMaxMhz: clock };
    };
    // ONE LADDER STEP OF SAG, so every landing is an EXACT row and the assertions are about the rule
    // rather than about snapping. Orders 2842 and 2820 → landings 2835 and 2813.
    const sagged = await sweepRange({
      curveDoc: sweepDoc(bandRows), points: sweepPoints, envelopeMhz: 3090,
      runStepFn: sagAtom(7), buildVector: vectorPinned,
      saveFn: async () => ({ ok: true }),
      now: () => '2026-08-16T02:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
    });
    // The whole band is walked, and the rows that carry evidence are the DELIVERED ones plus what
    // legitimately inherits DOWN from them (2835 → 2828). Written as a literal list because a
    // computed expectation here would be the vacuous-assertion trap: an expectation derived from the
    // result agrees with anything.
    ok('ЗАМЕР ЛОЖИТСЯ В СТРОКУ ВЫДАННОЙ ЧАСТОТЫ, а не заказанной (слово владельца 2026-08-16)',
      [sagged.ok, sagged.doc.frequencies.filter((r) => r.status !== CURVE_STATUS.STOCK).map((r) => r.mhz)],
      [true, [2835, 2828, 2813]]);
    ok('и ЗАКАЗАННЫЕ частоты остались СТОКОВЫМИ — на них карта не работала, мерить их было нечем',
      [sagged.doc.frequencies.find((r) => r.mhz === 2842)?.status,
        sagged.doc.frequencies.find((r) => r.mhz === 2820)?.status],
      [CURVE_STATUS.STOCK, CURVE_STATUS.STOCK]);
    ok('ОТЧЁТ НАЗЫВАЕТ КАЖДОЕ РАСХОЖДЕНИЕ заказа и выдачи, а не сглаживает его',
      sagged.delivered.map((d) => [d.orderedMhz, d.deliveredMhz, d.rowMhz]),
      [[2842, 2835, 2835], [2820, 2813, 2813]]);
    ok('и печать отчёта говорит это ВСЛУХ, вместе с причиной',
      (() => {
        const l = sweepReportLines(sagged);
        return [l.some((x) => x.includes('ЗАКАЗ ↔ ВЫДАЧА: разошлись на 2')), l.some((x) => x.includes('2842→2835'))];
      })(), [true, true]);
    // ДВЕ ПРИЧИНЫ ОСТАНОВКИ РАЗДЕЛЕНЫ В ПЕЧАТИ, И МЕТАФОРА УБРАНА (`CURVE_STATUS.DEPTH_CAPPED`).
    // Одно число над двумя несовместимыми фактами — «карте ниже нельзя» и «мы решили не смотреть» —
    // ввело владельца в заблуждение 2026-08-17 на готовом прогоне, где ВСЕ 54 строки несли первое,
    // а на деле были вторым. Блок утверждает ОБА присутствия и ОТСУТСТВИЕ слова «рычаг»: проверять
    // только появление нового текста мало — старый мог остаться рядом.
    ok('ПЕЧАТЬ РАЗДЕЛЯЕТ ДВЕ ПРИЧИНЫ ОСТАНОВКИ и не называет ни одну «рычагом»',
      (() => {
        const l = sweepReportLines(sagged).join('\n');
        return [/остановлено НАШИМ потолком глубины/.test(l), /предел сдвига ±1000 МГц/.test(l), /предел рычага/.test(l)];
      })(), [true, true, false]);
    // THE WITNESS CARRIES BOTH NUMBERS — a row that says only its own frequency cannot be audited
    // later against what was actually asked for.
    ok('свидетель строки несёт И ЗАКАЗ, И ВЫДАЧУ',
      /ЗАКАЗАНО 2842 МГц, ВЫДАНО 2835 МГц/.test(sagged.doc.frequencies.find((r) => r.mhz === 2835)?.provenBy ?? ''), true);
    // INHERITANCE MUST NOT CLIMB. The group 2842…2828 was ordered; the card ran 2835, so 2842 was
    // never exercised and inherits nothing — while 2828, which IS below the delivered clock, does.
    ok('НАСЛЕДОВАНИЕ НЕ ЛЕЗЕТ ВВЕРХ: выше выданной сток, ниже — унаследованный замер',
      [sagged.doc.frequencies.find((r) => r.mhz === 2842)?.status,
        sagged.doc.frequencies.find((r) => r.mhz === 2828)?.status !== CURVE_STATUS.STOCK],
      [CURVE_STATUS.STOCK, true]);

    // THE CASE THE BLOCK ABOVE DOES NOT REACH, and the mutation proof is what said so: when the card
    // lands BELOW its whole group, `g.bottomMhz` is ABOVE the delivered clock and an inheritance range
    // built from it would run BACKWARDS — writing the measurement into frequencies the card never
    // touched. `Math.min` is the only thing stopping that, so it needs a fixture that inverts without it.
    // Group 2842…2828 ordered; card delivers 2820, a real row below the whole group.
    const undershot = await sweepRange({
      curveDoc: sweepDoc(bandRows), points: sweepPoints, envelopeMhz: 3090, fromMhz: 2842, toMhz: 2828,
      runStepFn: sagAtom(22), buildVector: vectorPinned,
      saveFn: async () => ({ ok: true }),
      now: () => '2026-08-16T02:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
    });
    ok('КАРТА УПАЛА НИЖЕ ВСЕЙ СТУПЕНИ: закрыта ОДНА строка 2820, и ни одна частота ступени не тронута',
      [undershot.ok, undershot.doc.frequencies.filter((r) => r.status !== CURVE_STATUS.STOCK).map((r) => r.mhz)],
      [true, [2820]]);

    // — no delivered clock at all: the sweep STOPS. A fallback here would restore the very claim the
    //   owner's rule removes, and it would do it exactly when the evidence is missing.
    const blindAtom = async (a) => {
      const r = await sweepAtom(0)(a);
      return { ...r, deliveredMhz: null, deliveredMaxMhz: null };
    };
    const blind = await sweepRange({
      curveDoc: sweepDoc(bandRows), points: sweepPoints, envelopeMhz: 3090,
      runStepFn: blindAtom, buildVector: vectorPinned,
      saveFn: async () => ({ ok: true }),
      now: () => '2026-08-16T02:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
    });
    ok('БЕЗ ВЫДАННОЙ ЧАСТОТЫ РАЗВЁРТКА ВСТАЁТ и НЕ подставляет заказанную',
      [blind.ok, blind.stoppedBy, blind.closed,
        blind.doc.frequencies.every((r) => r.tags?.includes(CURVE_TAGS.STOP_UNTOUCHED))],
      [false, 'delivered', 0, true]);

    // — ТАБЛИЦА ПЕРЕЧИТЫВАЕТСЯ ПЕРЕД КАЖДОЙ СТУПЕНЬЮ. Живой прогон 2026-08-16 встал ровно на этом:
    //   карта грелась 12 минут, заводская таблица уехала по оси частот, и сдвиг, посчитанный по
    //   холодной таблице, перестал давать заказанное напряжение.
    //   АДРЕСАТЫ, названные ДО прогона: AR. вернуть планирование по стартовой таблице →
    //   «ПЕРЕД СТУПЕНЬЮ ТАБЛИЦА ПЕРЕЧИТАНА» · AS. подставить старую таблицу вместо непрочитанной →
    //   «НЕПРОЧИТАННАЯ ТАБЛИЦА — СТОП, А НЕ СТАРАЯ».
    {
      // THE BLOCK MUST OBSERVE THAT THE FRESH TABLE *DECIDED THE WRITE*, not merely that it was read.
      // Counting reads would stay green if the value were read and then thrown away — which is
      // exactly the mutation this block exists to catch. So the fresh table is SHIFTED, and the
      // offset that reaches the atom must move with it.
      const SHIFT = 20;
      const runWith = async (table) => {
        const offsets = [];
        const r = await sweepRange({
          curveDoc: sweepDoc(bandRows), points: sweepPoints, envelopeMhz: 3090, fromMhz: 2842, toMhz: 2842,
          runStepFn: async (a) => { offsets.push(a.offsetMhz); return sweepAtom(0)(a); },
          buildVector: vectorPinned, readPointsFn: () => table,
          saveFn: async () => ({ ok: true }),
          now: () => '2026-08-16T02:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
        });
        return { r, first: offsets[0] ?? null };
      };
      const cold = await runWith(sweepPoints);
      // A table that slid DOWN the frequency axis (the card warmed) needs a BIGGER raise to put the
      // same clock on the same voltage — that is the whole physics of the 2026-08-16 stall.
      const warm = await runWith(sweepPoints.map((p) => ({ ...p, mhz: p.mhz - SHIFT })));
      ok('ПЕРЕД СТУПЕНЬЮ ТАБЛИЦА ПЕРЕЧИТАНА, и решает ИМЕННО ОНА: уехавшая таблица двигает сдвиг',
        [cold.r.ok, warm.r.ok, Number.isFinite(cold.first), warm.first - cold.first],
        [true, true, true, SHIFT]);

      // The card cannot be described → STOP. The OLD table is deliberately not a fallback: using it
      // is the defect this seam removes, and a stale plan writes voltages nobody asked for.
      const unreadable = await sweepRange({
        curveDoc: sweepDoc(bandRows), points: sweepPoints, envelopeMhz: 3090, fromMhz: 2842, toMhz: 2842,
        runStepFn: sweepAtom(0), buildVector: vectorPinned, readPointsFn: () => null,
        saveFn: async () => ({ ok: true }),
        now: () => '2026-08-16T02:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
      });
      // THE REASON IS PART OF THE ASSERTION. «It stopped» is not enough: with the fresh table thrown
      // away the sweep also stops — downstream, on an empty table — and a block that only checks
      // «stopped» would stay green while the seam was gone. So the halt must NAME the unread table.
      ok('НЕПРОЧИТАННАЯ ТАБЛИЦА — СТОП, А НЕ СТАРАЯ: и остановка НАЗЫВАЕТ именно её',
        [unreadable.ok, unreadable.closed,
          unreadable.doc.frequencies.every((r) => r.tags?.includes(CURVE_TAGS.STOP_UNTOUCHED)),
          /НЕ ПЕРЕЧИТАНА/.test(unreadable.why ?? '')],
        [false, 0, true, true]);

      // A table of the WRONG SHAPE is «не прочитана» too — a short read is not a small read.
      const truncated = await sweepRange({
        curveDoc: sweepDoc(bandRows), points: sweepPoints, envelopeMhz: 3090, fromMhz: 2842, toMhz: 2842,
        runStepFn: sweepAtom(0), buildVector: vectorPinned, readPointsFn: () => sweepPoints.slice(0, 2),
        saveFn: async () => ({ ok: true }),
        now: () => '2026-08-16T02:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
      });
      ok('ОБРЕЗАННАЯ ТАБЛИЦА — ТОЖЕ НЕ ПРОЧИТАНА: короткое чтение не является маленьким чтением',
        [truncated.ok, truncated.closed, /НЕ ПЕРЕЧИТАНА/.test(truncated.why ?? '')], [false, 0, true]);
    }

    // — WHICH rung's delivered clock decides the row: the LAST PASSING one, because the voltage that
    //   ships is the one a PASS proved. A descent whose clock climbs as the raise deepens must key on
    //   the end of the walk, not on its first step.
    // The clock CLIMBS as the descent deepens — which is what the card really does, since a deeper
    // rung is a bigger raise. The row must come from the END of the walk, and the earlier, lower
    // readings must not decide it. The sequence is explicit and clamps on a real row, so the block
    // asserts LITERALS rather than something recomputed from the run.
    let climbCalls = 0;
    const climbSeq = [2813, 2820, 2828];
    const climbAtom = async (a) => {
      const r = await sweepAtom(0)(a);
      const clock = climbSeq[Math.min(climbCalls, climbSeq.length - 1)];
      climbCalls += 1;
      return { ...r, deliveredMhz: clock, deliveredMaxMhz: clock };
    };
    const climbed = await sweepRange({
      curveDoc: sweepDoc(bandRows), points: sweepPoints, envelopeMhz: 3090, fromMhz: 2842, toMhz: 2828,
      runStepFn: climbAtom, buildVector: vectorPinned,
      saveFn: async () => ({ ok: true }),
      now: () => '2026-08-16T02:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
    });
    ok('СТРОКУ РЕШАЕТ ПОСЛЕДНИЙ ПРОШЕДШИЙ прожиг, а не первый',
      [climbCalls >= 3, climbed.delivered.map((d) => [d.orderedMhz, d.deliveredMhz])],
      [true, [[2842, 2828]]]);
    ok('и разброс выданной частоты по спуску ЗАПИСАН, а не потерян',
      (() => {
        const sp = climbed.groups[0]?.deliveredSpread;
        return [sp?.min, sp?.max];
      })(), [2813, 2828]);

    // AND THE OTHER HALF OF THAT RULE, which the climbing fixture cannot reach because everything in
    // it PASSES: a rung that did NOT pass must not decide the row. Its clock was measured while the
    // card was failing, and a failing card's frequency is not evidence about a shipped voltage.
    // Here the coarse rung passes at 2828, the failure and the refinement's failing steps report 2813,
    // and the shipped voltage comes out of the refinement — so only «last PASS» gives 2828.
    const failClockAtom = async (a) => {
      const r = await sweepAtom(1000)(a);
      const passed = r.verdict === P;
      const clock = passed ? 2828 : 2813;
      return { ...r, deliveredMhz: clock, deliveredMaxMhz: clock };
    };
    const mixed = await sweepRange({
      curveDoc: sweepDoc(bandRows), points: sweepPoints, envelopeMhz: 3090, fromMhz: 2842, toMhz: 2828,
      runStepFn: failClockAtom, buildVector: vectorPinned,
      saveFn: async () => ({ ok: true }),
      now: () => '2026-08-16T02:00:00+03:00', clockMs: (() => { let t = 0; return () => (t += 1000); })(),
    });
    ok('ЧАСТОТУ СБОЙНУВШЕЙ СТУПЕНИ В СТРОКУ НЕ БЕРЁМ — решает последний ПРОШЕДШИЙ прожиг',
      [mixed.verdict === undefined ? mixed.verdicts['edge-found'] : null,
        mixed.delivered.map((d) => [d.orderedMhz, d.rowMhz])],
      [1, [[2842, 2828]]]);

    // =============================================================================================
    // `bugs/14` — ОСТАНОВ ОПЕРАТОРА ≠ ЗАВИСАНИЕ · ОКНО НАБЛЮДЕНИЯ ЕСТЬ УСЛОВИЕ ПРОГОНА
    //
    // MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
    //   W. закрывать останов исходом HUNG           → «ОСТАНОВ ОПЕРАТОРА — ОТДЕЛЬНЫЙ ИСХОД»
    //   X. считать останов в «два подряд»           → «ДВА ОСТАНОВА ПОДРЯД НЕ БЛОКИРУЮТ СТУПЕНЬ»
    //   Y. закрывать останов только на последней    → «ЗАКРЫВАЮТСЯ ВСЕ незакрытые намерения»
    //   Z. пропускать прогон при нуле смотрящих     → «НОЛЬ ОТКРЫТЫХ ОКОН — ЭТО ОТКАЗ»
    //   AA. считать живой сервер за открытое окно   → «ЖИВОЙ СЕРВЕР БЕЗ ОКНА — ТОЖЕ ОТКАЗ»
    // =============================================================================================
    const operatorStopBox = mkdtempSync(join(tmpdir(), 'kago-stop-'));
    try {
      const sj = openJournal({ dir: operatorStopBox });
      writeIntent(sj, { seq: 1, at: '2026-08-16T12:00:00+03:00', frequencyMhz: 2887, voltageMv: 960, pointIndex: 81 });
      writeIntent(sj, { seq: 2, at: '2026-08-16T12:00:01+03:00', frequencyMhz: 2880, voltageMv: 950, pointIndex: 80 });
      const stopped = closeAsOperatorStop(sj, { at: '2026-08-16T12:00:02+03:00', signal: 'SIGINT' });
      const after = readJournal(sj).records.filter((r) => r.state === 'verdict');
      ok('ОСТАНОВ ОПЕРАТОРА — ОТДЕЛЬНЫЙ ИСХОД, а не ЗАВИС (слово владельца: «и что это ЗАВИС напечатает!»)',
        [after.map((r) => r.outcome), after.every((r) => /ОСТАНОВЛЕНО ОПЕРАТОРОМ/.test(r.why ?? ''))],
        [[RUNG_OUTCOME.STOPPED, RUNG_OUTCOME.STOPPED], true]);
      ok('ЗАКРЫВАЮТСЯ ВСЕ незакрытые намерения, а не только последнее',
        stopped.map((o) => o.frequencyMhz), [2887, 2880]);
      ok('и после останова НЕЗАКРЫТЫХ намерений не остаётся — следующий запуск ЗАВИС не припишет',
        resumeState(sj).hung.length, 0);
      // TWO STOPS ON ONE RUNG must not trip the emergency brake: that brake is for a rung that BROKE
      // the machine twice, and a rung nobody tested has broken nothing.
      writeIntent(sj, { seq: 3, at: '2026-08-16T12:01:00+03:00', frequencyMhz: 2887, voltageMv: 960, pointIndex: 81 });
      closeAsOperatorStop(sj, { at: '2026-08-16T12:01:01+03:00', signal: 'SIGINT' });
      ok('ДВА ОСТАНОВА ПОДРЯД НЕ БЛОКИРУЮТ СТУПЕНЬ — блокировка только за настоящие зависания',
        resumeState(sj).blocked.length, 0);
    } finally {
      rmSync(assertJournalSandbox({ dir: operatorStopBox }), { recursive: true, force: true });
    }

    // — THE WINDOW GATE. Injected `fetch`, so the block proves the DECISION rather than the network.
    {
      const dash = await import('./lib/run-dashboard.mjs');
      const reply = (body, ok2 = true, status = 200) => async () => ({ ok: ok2, status, json: async () => body });
      const watching = await dash.viewersWatching({ fetchFn: reply({ viewers: 2 }) });
      ok('ОКНО ОТКРЫТО → ворота пропускают, и число смотрящих названо',
        [watching.ok, watching.viewers], [true, 2]);
      // THE CASE THAT COST TWO LIVE RUNS: the server answers 200 and NOBODY is watching.
      const noWindow = await dash.viewersWatching({ fetchFn: reply({ viewers: 0 }) });
      ok('ЖИВОЙ СЕРВЕР БЕЗ ОКНА — ТОЖЕ ОТКАЗ: считаются открытые окна, а не здоровье сервера',
        [noWindow.ok, noWindow.viewers, /открытых окон НОЛЬ/.test(noWindow.why)], [true, 0, true]);
      const dead = await dash.viewersWatching({ fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
      ok('сервер не отвечает → отказ С ПРИЧИНОЙ, а не исключение наружу',
        [dead.ok, dead.viewers, dead.why.includes('ECONNREFUSED')], [false, 0, true]);
      ok('НОЛЬ ОТКРЫТЫХ ОКОН — ЭТО ОТКАЗ: развёртка не имеет права стартовать (слово владельца)',
        [noWindow.viewers < 1, dead.viewers < 1], [true, true]);
    }

    const prodAfter = existsSync(VMIN_DIR) ? readdirSync(VMIN_DIR).length : 0;
    ok('ПРОДАКШЕН НЕ ВЫРОС: самопроверка движка не подбросила улик', prodAfter, prodBefore);
    ok('ПРОДАКШЕН-ЖУРНАЛ НЕ ВЫРОС: ни одна ступень набора не писала в runs/sweep/ (EXP-0025, bugs/08)',
      existsSync(SWEEP_DIR) ? readdirSync(SWEEP_DIR).length : 0, sweepBefore);

    return { ok: results.every((r) => r.ok), results };
  })();
}

// =================================================================================================
// 4. CLI
// =================================================================================================

/**
 * THE BAND SWEEP — the owner's question made executable.
 *
 * *«а для всех 128 точек кривой когда будешь тюнить? на частоте 500 МГц, на 1500?»* and
 * *«нужно протестировать карту, прожечь НА ВСЕХ ЧАСТОТАХ»*.
 *
 * Two things have to be true at once for that to be a measurement rather than a phrase, and neither
 * was true before `bugs/02`:
 *
 *   1. **The WHOLE curve is raised**, because a clock is served by whichever point reaches it at the
 *      lowest voltage — raising one point leaves that neighbour, and the voltage, untouched.
 *   2. **The clock is PINNED at the rung**, because a card left free boosts to the top under every
 *      load. Without the pin, "testing 500 MHz" loads exactly the same handful of top points as
 *      "testing 2842", and the low half of the curve is never exercised at all.
 *
 * What the sweep answers is the question §4.5 exists for: **is the safe offset the same at the bottom
 * of the band as at the top?** A uniform answer means the profile is one number; a falling one means
 * it is a VECTOR, and the shape of the fall says where. The prediction worth writing down before the
 * run: the same +Δ MHz is a far deeper undervolt low down (500 → 800 MHz is +60 %, 2842 → 3142 is
 * +10 %), so the bottom should break first.
 *
 * [NOT-TESTED]
 */
async function mainBand(argv, arg) {
  const pins = String(arg('band', '')).split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
  if (!pins.length) { console.error('ОШИБКА: --band требует список частот, например 500,1000,1500,2000,2400,2842'); return 2; }
  // 10 s per shape, measured rather than chosen by feel: a rung costs 94 s at 30 s per shape and the
  // overhead in it is 4 s, so the whole cost IS the load. At 10 s the transient shape still gets three
  // 5/5 duty cycles and the load still gets ~400 launches — enough to bracket an edge. The LONG burn
  // is a separate acceptance step (§4.7), which is exactly the split researches/02 §6 prescribes.
  const seconds = Number(arg('seconds', 10));
  const dryRun = argv.includes('--dry-run');

  // THE DESCENT POLICY AS ARGUMENTS (the owner, 2026-08-15). Defaults come from `config.mjs`, which
  // stays the one place the numbers LIVE; these let a run change them without an edit. They are read
  // once here and passed to BOTH the plan and the run, so the dry run cannot describe a different
  // policy from the one that executes (`bugs/09`).
  const gridStepMv = Number(arg('grid-step', config.VOLTAGE_GRID_STEP_MV ?? 5));
  const stride = Number(arg('stride', 5));
  const sessionMaxDepthMv = Number(arg('session-depth', config.SESSION_MAX_DEPTH_BEYOND_KNOWN_MV ?? 30));
  const fastFloorMv = Number(arg('fast-floor', config.FAST_DESCENT_FLOOR_MV ?? 900));
  for (const [name, v] of [['--grid-step', gridStepMv], ['--stride', stride],
    ['--session-depth', sessionMaxDepthMv], ['--fast-floor', fastFloorMv]]) {
    if (!Number.isFinite(v) || v <= 0) { console.error(`ОШИБКА: ${name} должен быть положительным числом, дано ${v}`); return 2; }
  }

  const vf = await import('./lib/vf-step.mjs');
  const nvapi = await import('./lib/nvapi.mjs');
  const stress = await import('./lib/stress-tester.mjs');
  const card = stress.probeCard();
  const store = openStore();

  const nv = nvapi.openNvapi();
  nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
  const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
  nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
  const handle = handles.readBigUInt64LE(0);
  let curve = null;
  try {
    const c = nvapi.readVfCurve(nv, handle);
    if (!c.ok) { console.error(`ОШИБКА: кривая не прочиталась — ${c.why}`); return 1; }
    curve = c.points;
  } finally {
    nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload);
  }

  console.log('РАЗВЁРТКА ПО ДИАПАЗОНУ — вся кривая вверх, частота закреплена на каждой ступени');
  console.log('');
  console.log(`  СТУПЕНИ:   ${pins.join(', ')} МГц`);
  console.log(`  НАБОР:     ${DIVERSE_SET.length} формы по ${seconds} с — ступень ≈ ${DIVERSE_SET.length * seconds + 4} с`);
  console.log('  ПОДЪЁМ:    ВСЯ кривая (127 точек), а не одна — иначе напряжение потолка не падает вовсе (bugs/02)');
  console.log('  ФОРМА:     где кривая способна удержать потолок — пишем ОТГРУЖАЕМУЮ форму (подъём с потолком),');
  console.log('             то есть ровно то, что уедет в профиль. Ниже пола железа (верх кривой минус 1000 МГц)');
  console.log('             потолка кривой не удержать вовсе — там подъём равномерный, а потолок держит');
  console.log('             ЗАКРЕПЛЕНИЕ, и это печатается по каждой ступени отдельно.');
  // THE POLICY IN FORCE FOR THIS RUN, printed with the plan — an argument nobody can read before the
  // write is the defect `bugs/09` was about, and it applies to the knobs as much as to the bound.
  console.log(`  ПОЛИТИКА:  шаг сетки ${gridStepMv} мВ · грубый шаг = каждая ${stride}-я ступень`
    + ` · пол быстрого спуска ${fastFloorMv} мВ · за сессию не глубже ${sessionMaxDepthMv} мВ от доказанного`);
  console.log('             (умолчания из config.mjs; меняются флагами --grid-step --stride --fast-floor --session-depth,');
  console.log(`             и сторож всё равно откажет при первом шаге глубже ${config.ASCENT_FIRST_STEP_MAX_MV ?? 25} мВ или разрыве больше ${config.ASCENT_STEP_MAX_MV ?? 35} мВ)`);
  console.log('  ЗАКРЕПЛЕНИЕ: -lgc на ступени, законно для ЗАМЕРА и запрещено в отгружаемом профиле');
  console.log('  ОТКАТ:     частота отпущена и кривая обнулена в finally, под сторожем, на каждой ступени');
  console.log('');

  // THE CARD WITH ITS LADDER, probed ONCE. Re-probing inside every rung is what turned a healthy
  // sixth rung into НЕИЗВЕСТНО on the first live sweep.
  const ps = await import('./lib/profile-store.mjs');
  const pinCard = ps.probeCard();
  if (!pinCard.ladder?.ok) { console.error(`ОШИБКА: лестница частот недоступна — ${pinCard.ladder?.why}`); return 1; }

  const plan = [];
  for (const pin of pins) {
    const serving = vf.voltageForClock(curve, pin);
    // THE RUNGS IN VOLTS, per frequency, from the card's own curve. This is where the band's
    // inhomogeneity becomes visible before a single watt is spent: the top offers ten grid steps of
    // headroom, the middle offers two.
    const rungs = serving ? vf.ascentLadderByVoltage(curve, pin, { stepMv: gridStepMv }) : [];
    // WHICH SHAPE THIS RUNG MAY BE SEARCHED IN, decided BEFORE the sweep starts and printed with the
    // plan (`bugs/02` step 1). The question is asked at Δ = 0 on purpose: whether the curve can hold a
    // ceiling depends only on how far the TAIL can be pushed down, and that is independent of the
    // raise — computed across Δ = 0…540, the leak is identical at every one of them.
    const vec = nvapi.buildRaiseAndCapVector(curve, 0, { capMhz: pin });
    // `pinned: true` because this sweep always pins: on a rung the curve cannot cap, the pin is the
    // holder, and the run says so instead of pretending it searched the shipped shape.
    const shapeChoice = vf.chooseWriteShape(vec, { pinned: true });
    plan.push({ pin, serving, rungs, shapeChoice });
    // THE FIRST STEP'S DEPTH IS PRINTED FIRST, because it is the number that decides whether this
    // rung is safe to start at all — and it is the number nobody could see on 2026-08-11 (bugs/03).
    //
    // AND THE SESSION'S DEPTH BOUND ON THE SAME PLAN, through the same function the run uses. The
    // ratchet is read with the SHAPE this rung will be written in and the POINT that serves it — both
    // are quarantine keys (`bugs/06`), so a plan that guessed either would show a bound the run does
    // not have.
    const planHistory = serving ? ratchetView({ store, card, writeShape: shapeChoice.shape }).history : [];
    const planRatchet = serving ? allowedOffset(planHistory, serving.pointIndex, { fineStepMhz: ASCENT_FINE_MHZ }) : null;
    const composed = rungs.length
      ? composeAscentLadder({
        fine: rungs.filter((r) => r.offsetMhz <= planRatchet.limitMhz),
        history: planHistory,
        point: serving.pointIndex,
        capMhz: pin,
        stockMv: serving.mv,
        stride,
        sessionMaxDepthMv,
        fastFloorMv,
      })
      : { chosen: { rungs: [], refused: false, why: 'нет ступеней' }, ladderRungs: [], sessionDepth: null };
    const chosen = composed.chosen;
    console.log(`  ${String(pin).padStart(5)} МГц → точка ${serving ? serving.pointIndex : '—'}`
      + `${serving ? ` (${serving.mv} мВ)` : ' — вне кривой, ступень пропускается'}`
      + `${serving ? ` · ступеней ${rungs.length}, глубже всего −${rungs.length ? rungs[rungs.length - 1].savedMv : 0} мВ` : ''}`
      + `${serving ? ` · ПЕРВЫЙ ШАГ −${chosen.rungs[0]?.savedMv ?? '—'} мВ${chosen.refused ? ` · ${chosen.why.slice(0, 96)}` : ''}` : ''}`);
    // THE SHAPE AND ITS HOLDER, on their own line — a number whose shape a reader has to infer is the
    // ambiguity `bugs/02` was made of.
    if (serving) {
      console.log(`          ${sessionDepthLine(composed.sessionDepth)}`);
      console.log(`          ФОРМА: ${shapeChoice.shape === 'raise-and-cap' ? 'ОТГРУЖАЕМАЯ (подъём с потолком)' : 'равномерный подъём'}`
        + ` · потолок держит ${shapeChoice.heldBy}`
        + `${shapeChoice.shape === 'raise-and-cap' ? '' : ` · утечка потолка ${vec.capLeakMhz} МГц, пол железа ${vec.lowestEnforceableCapMhz} МГц`}`);
    }
  }
  console.log('');
  if (dryRun) { console.log('СУХОЙ ПРОГОН: ни одной записи в карту не сделано.'); return 0; }

  const rows = [];
  for (const { pin, serving, rungs, shapeChoice } of plan) {
    if (!serving) { rows.push({ pin, skipped: 'вне кривой' }); continue; }
    if (!rungs.length) { rows.push({ pin, point: serving.pointIndex, stockMv: serving.mv, skipped: 'рычаг исчерпан: ни одной ступени по напряжению' }); continue; }
    if (!shapeChoice.ok) { rows.push({ pin, point: serving.pointIndex, stockMv: serving.mv, skipped: shapeChoice.why }); continue; }
    console.log(`── СТУПЕНЬ ${pin} МГц (точка ${serving.pointIndex}, ${serving.mv} мВ, ступеней ${rungs.length}, форма ${shapeChoice.shape}) ──────`);
    const r = await searchEdge({
      capMhz: pin,
      point: serving.pointIndex,
      shapes: DIVERSE_SET,
      wholeCurve: true,
      writeShape: shapeChoice.shape,
      // ONE HOLDER, NEVER TWO. Paid for live 2026-08-14: this sweep capped the curve at 2842 AND
      // pinned the clock at 2842, the card sat at 2775…2827 as a capped card does, the lock proof
      // correctly refused, and a rung whose three load shapes had all PASSED came out НЕИЗВЕСТНО.
      // `chooseWriteShape` already decides who holds the ceiling; this is that decision obeyed.
      pinMhz: shapeChoice.pinRequired ? pin : null,
      pinCard,
      rungs,
      coarseStride: stride,
      sessionMaxDepthMv,
      fastFloorMv,
      seconds,
      card,
      store,
      runStepFn: (a) => vf.runStep(a),
      onAttempt: (a) => {
        const by = a.worstShape ? ` · решила ${a.worstShape}` : '';
        const saved = a.servingMv !== null && a.servingMv !== undefined ? ` (−${(serving.mv - a.servingMv).toFixed(0)} мВ от стока)` : '';
        console.log(`   +${a.offsetMhz} МГц → ${a.servingMv ?? '?'} мВ${saved} → ${a.verdict ?? 'НЕИЗВЕСТНО'}${by}`);
        // THE REASON, ALWAYS, WHEN IT IS NOT A PASS — the owner's instruction after this very sweep:
        // «запускать движок и ЧИТАТЬ ЕГО ЛОГИ И ОТЧЁТЫ». On 2026-08-14 the sweep printed НЕИЗВЕСТНО
        // and nothing else, so reading its report was NOT enough: the cause (a refused lock proof)
        // had to be reconstructed from the store and a sampler file. A verdict without its reason
        // sends its reader digging, which is the same defect as a question that sends the owner
        // digging through documents.
        if (a.verdict !== config.VERDICT.PASS && a.reason) console.log(`      ПРИЧИНА: ${a.reason}`);
        if (a.deliveredMhz) console.log(`      выдано под нагрузкой: ${a.deliveredMhz} МГц (максимум ${a.deliveredMaxMhz})`);
      },
    });
    rows.push({ pin, point: serving.pointIndex, stockMv: serving.mv, ...r });
    console.log(`   ИТОГ ступени: ${r.stopped}`);
    console.log('');
    // A rung that refused for a reason that will repeat on every rung is a reason to stop the sweep
    // rather than to spend the owner's card proving it nine more times.
    if (r.noUndervoltAtCap) {
      console.log('РАЗВЁРТКА ОСТАНОВЛЕНА: подъём не удешевляет частоту — это повторится на каждой ступени.');
      break;
    }
  }

  console.log('');
  console.log('  частота | точка | сток мВ | БЕЗОПАСНОЕ мВ | снято мВ | отказ мВ | вилка мВ');
  for (const r of rows) {
    if (r.skipped) { console.log(`  ${String(r.pin).padStart(7)} | ${r.skipped}`); continue; }
    const safeMv = r.servingMv?.atLastPass ?? null;
    const failMv = r.servingMv?.atFirstFail ?? null;
    console.log(`  ${String(r.pin).padStart(7)} | ${String(r.point).padStart(5)} | ${String(r.stockMv).padStart(7)} | `
      + `${String(safeMv ?? '—').padStart(13)} | ${String(safeMv === null ? '—' : r.stockMv - safeMv).padStart(8)} | `
      + `${String(failMv ?? '—').padStart(8)} | ${r.bracketMv ?? '—'}`);
  }
  console.log('');
  console.log('ЧТО ЭТА ТАБЛИЦА РЕШАЕТ: одинаков ли безопасный сдвиг внизу и наверху диапазона.');
  console.log('  одинаков в пределах точного шага → профиль это ОДНО число плюс плоский хвост;');
  console.log('  падает вниз по диапазону        → профиль это ВЕКТОР, и низ надо резать слабее.');
  return 0;
}

/**
 * THE SWEEP AS A COMMAND — `npm run engine -- --sweep --from <МГц> --to <МГц>` (`plans/15` §4.5).
 *
 * A COMMAND and not a scheduled task, by the owner's decision: he is at the machine and reboots it
 * himself (`GOAL.md` → «🧑‍💻 ЧЕЛОВЕК ЗА МАШИНОЙ»), so nothing is ever installed into the boot path —
 * and the same run that starts a sweep is the one that RESUMES an interrupted one, because the
 * journal is what tells them apart. Re-running after a hang is the whole recovery procedure.
 *
 * ⚠️ **THIS PATH WRITES TO THE CARD.** Everything it composes is proved offline (183 blocks), but no
 * rung of it has ever run on the owner's hardware — that is phase 3, with him present. The command
 * therefore behaves the way the owner's-machine rule demands: it names the band, the rung count and
 * the journal BEFORE the first write, and it exits non-zero on any stop.
 *
 * [NOT-TESTED] — the LIVE path. Its decisions are `sweepRange`'s and those are proved; what has never
 * been exercised is this wiring against real NVAPI, a real watchdog and a real card.
 */
async function mainSweep(argv, arg) {
  const fromMhz = Number(arg('from'));
  const toMhz = Number(arg('to'));
  if (!Number.isFinite(fromMhz) || !Number.isFinite(toMhz) || toMhz > fromMhz) {
    console.error('ОШИБКА: --sweep требует --from <МГц> и --to <МГц>, причём --to не выше --from');
    return 2;
  }

  // THE OPERATOR'S CEILING ON DEPTH — an ARGUMENT, because it is a decision about ONE sitting and not
  // a property of the card. Absent, only the lever stops the descent. It is validated here rather than
  // trusted: a typo that turns 150 into 1500 must not reach the card as «no ceiling at all».
  const rawCap = arg('max-depth');
  const depthCapMv = rawCap === null ? null : Number(rawCap);
  if (rawCap !== null && (!Number.isFinite(depthCapMv) || depthCapMv <= 0)) {
    console.error(`ОШИБКА: --max-depth должен быть положительным числом милливольт, получено «${rawCap}»`);
    return 2;
  }

  const nvapi = await import('./lib/nvapi.mjs');
  const vf = await import('./lib/vf-step.mjs');
  const watchdog = await import('./lib/watchdog.mjs');

  const doc = loadCurveDoc({});
  if (!doc) {
    console.error('ОШИБКА: документа кривой нет — сначала `npm run curve -- --init`. Развёртке некуда писать,');
    console.error('        а знание, которому некуда лечь, теряется первой же перезагрузкой.');
    return 2;
  }

  const nv = nvapi.openNvapi();
  nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
  const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
  nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
  const handle = handles.readBigUInt64LE(0);
  const points = nvapi.readVfCurve(nv, handle).points;

  // ---- THE CARD'S OWN ENVELOPE AND ITS CLOCK LADDER, PROBED ONCE FOR THE WHOLE SWEEP.
  //
  // Both are required by the owner's locked shape (`ideas/03` step 7): the ladder because a clock is
  // locked to a rung the card actually offers (never to a round number a human liked), the envelope
  // because the raise is capped there so nothing is offered above the card's maximum (R13, `bugs/11`).
  //
  // ONCE, not per rung — re-probing inside every rung is what turned a healthy sixth rung of the
  // first live band sweep into НЕИЗВЕСТНО (EXP-0013).
  const ps = await import('./lib/profile-store.mjs');
  const pinCard = ps.probeCard();
  if (!pinCard.ladder?.ok) {
    console.error(`ОШИБКА: лестница частот карты недоступна — ${pinCard.ladder?.why ?? 'не прочитана'}.`);
    console.error('        Закрепить частоту не на чем, а без закрепления прожиг попал бы не на ту частоту.');
    return 1;
  }
  // ONE SOURCE FOR THE ENVELOPE — the curve document's own `card.maxGraphicsMhz`, which is the very
  // field `curve-store`'s R13 check reads. Deriving it a second time from the clock ladder here would
  // be a truth↔mirror pair over the number that cost the owner a BSOD.
  const envelopeMhz = doc.card?.maxGraphicsMhz ?? null;
  if (!Number.isFinite(envelopeMhz)) {
    console.error('ОШИБКА: максимум частоты этого экземпляра не записан в документе кривой (card.maxGraphicsMhz) —');
    console.error('        потолок конверта поставить не на что (R13). Пересоберите словари: npm run curve -- --grids');
    return 1;
  }
  console.log(`КОНВЕРТ КАРТЫ: ${envelopeMhz} МГц — выше него ни одна поднятая точка кривой ничего не предлагает`);
  console.log('               (R13, bugs/11). Частоту в прогоне держит ВЫПРЯМЛЕННАЯ КРИВАЯ: всё, что торчало бы');
  console.log('               выше испытуемой частоты, придавлено на неё. Замок частоты НЕ ставится — замерено');
  console.log('               2026-08-16, что он держит только вниз и карту вверх не поднимает (researches/11).');
  console.log('               ЗАПИСЬ ИДЁТ ПРОТИВ ВЫДАННОЙ частоты, а не заказанной (GOAL.md, слово владельца).');

  // THE DRY RUN IS A SEPARATE EXIT AND IT HAPPENS BEFORE ANYTHING ELSE — no journal is opened, no
  // recovery is attempted, no watchdog is armed. Rail S2's artifact must cost the card nothing.
  if (argv.includes('--dry-run')) {
    // THE JOURNAL IS READ HERE, AND ONLY READ (`bugs/23`). The paragraph above says the dry run opens
    // no journal, and the reason it gave was «rail S2's artifact must cost the card nothing» — which
    // is about WRITING, not about knowing. A hang floor absent from the plan is a wall the operator
    // discovers mid-run, i.e. exactly the `bugs/09` shape this whole artifact exists to prevent.
    // `hangFloors` counts an unclosed intent too, so no closure needs to be written to see it.
    const jrnRecords = readJournal(openJournal({})).records;
    const floors = hangFloors(jrnRecords);
    // Обе половины памяти журнала, а не одна: план обязан показывать ту же лестницу, что пройдёт
    // прогон (`bugs/09`, R16c), а прогон теперь стартует от собственной улики частоты (`bugs/31`).
    const proven = provenRungs(jrnRecords);
    const dry = await sweepDryRun({ curveDoc: doc, points, fromMhz, toMhz, depthCapMv, hangFloors: floors, proven });
    for (const line of sweepDryRunLines(dry)) console.log(line);
    return dry.refusals ? 1 : 0;
  }

  // THE PRODUCTION JOURNAL, AND IT IS SUPPOSED TO BE THE PRODUCTION ONE (`bugs/13`).
  //
  // This line used to be followed by `assertJournalSandbox(journal)` — a TEARDOWN guard whose whole
  // job is to refuse the production directory so a test cleanup cannot delete it (`bugs/08`). Called
  // here it refused the live sweep itself, on its normal path, before a single byte reached the card.
  // The live sweep could therefore never start, and nothing caught it because this wiring had never
  // been run: the function's own header says `[NOT-TESTED] — the LIVE path`.
  //
  // The production journal is not an accident of this path, it is the POINT of it: the intent is
  // fsynced here so a hang that kills the process still leaves a record, and the NEXT launch reads
  // this same file to attribute the hang and resume. A sandbox journal would forget the hang — which
  // is the one thing the owner's accepted risk depends on remembering.
  const journal = openJournal({});

  // ─── A DELIBERATE STOP IS NOT A HANG, AND THE JOURNAL MUST SAY WHICH IT WAS (`bugs/14`) ─────────
  //
  // The owner asked the question the code could not answer: *«ты ни разу не протестировал твою
  // остановку? И что это ЗАВИС напечатает!»* — and it would have. The journal's rule is «an intent
  // with no verdict means the card hung», which is right for the case it exists for; the consequence
  // nobody had covered is that an operator's Ctrl+C looked identical. Two of those on one rung would
  // have tripped the single emergency brake the owner allows, blocking a rung never even tested.
  //
  // The handler is SYNCHRONOUS and short: read the journal, close whatever is in flight as a STOP,
  // say what the card is about to do, leave. Anything awaited here may never finish.
  //
  // ⚠️ THE CARD IS RELEASED BY THE WATCHDOG, NOT BY THIS HANDLER, and that is deliberate. `runStep`'s
  // rollback lives in a `finally` that a signal does not run, so the honest thing is to lean on the
  // guard that was armed BEFORE the write and is designed for exactly this — the writer dying while
  // holding the card (R9, drilled at 2.5 s). Pretending to undo here would be a second, racing undo.
  // Set once the side-car exists; the handler is installed BEFORE it, so it asks through a ref.
  let sideCarRef = null;
  let stopping = false;
  const onOperatorStop = (signal) => {
    if (stopping) return;
    stopping = true;
    let closed = [];
    try {
      closed = closeAsOperatorStop(journal, { at: localIso(), signal });
    } catch (e) {
      console.error(`ВНИМАНИЕ: намерение закрыть не удалось (${e?.message ?? e}) — следующий запуск припишет ЗАВИС`);
    }
    console.error('');
    try { sideCarRef?.(); } catch { /* уже мёртв */ }
    console.error(`ОСТАНОВЛЕНО ОПЕРАТОРОМ (${signal}). Закрыто незавершённых намерений: ${closed.length}.`);
    for (const o of closed) console.error(`   ${o.frequencyMhz} МГц / ${o.voltageMv} мВ — НЕ испытана, края не несёт`);
    console.error('КАРТА: её отпускает СТОРОЖ (он взведён с начала записи). Проверьте:');
    console.error('   npm run watchdog -- --status   ·   npm run nvapi -- --curve');
    console.error('ПРОДОЛЖИТЬ: та же команда — журнал знает, где остановились.');
    process.exit(130);
  };
  process.once('SIGINT', () => onOperatorStop('SIGINT'));
  process.once('SIGTERM', () => onOperatorStop('SIGTERM'));
  process.once('SIGBREAK', () => onOperatorStop('SIGBREAK'));

  // THE PATHS THAT DO NOT PASS THROUGH THE `catch` BELOW (`bugs/20`). A throw inside a callback the
  // sweep did not await — a timer, a stream's 'error', a detached promise — never reaches the
  // try/catch around `sweepRange`, and Node ends the process. The intent stays orphaned and the next
  // launch blames the card. `bugs/19` died on exactly such a path.
  //
  // ⚠️ THE HANDLER MUST NOT TURN A CRASH INTO A SILENT CONTINUE, which is what installing an
  // `uncaughtException` listener does by default: it REPLACES Node's own «print the stack and exit
  // non-zero». So this one does that job itself, out loud, and exits — the record is closed honestly,
  // the failure is still a failure. Swallowing it would be a worse defect than the one being fixed.
  const onWriterDeath = (err, kind) => {
    if (stopping) return;
    stopping = true;
    let closed = [];
    try { closed = closeAsWriterDeath(journal, { at: localIso(), error: err }); } catch (e2) {
      console.error(`ВНИМАНИЕ: намерение закрыть не удалось (${e2?.message ?? e2}) — следующий запуск припишет ЗАВИС`);
    }
    try { sideCarRef?.(); } catch { /* уже мёртв */ }
    console.error('');
    console.error(`ПРОГОН УПАЛ СВОЕЙ ОШИБКОЙ (${kind}), А НЕ ПО ВИНЕ КАРТЫ. Закрыто намерений: ${closed.length}.`);
    for (const o of closed) console.error(`   ${o.frequencyMhz} МГц / ${o.voltageMv} мВ — НЕ испытана, края не несёт`);
    console.error(err?.stack ?? String(err));
    console.error('КАРТА: её отпускает СТОРОЖ (взведён с начала записи). Проверьте:');
    console.error('   npm run watchdog -- --status   ·   npm run nvapi -- --curve');
    process.exit(1);
  };
  process.once('uncaughtException', (e) => onWriterDeath(e, 'uncaughtException'));
  process.once('unhandledRejection', (e) => onWriterDeath(e, 'unhandledRejection'));

  // THE WATCH WINDOW, OPT-IN (`plans/20`, `ideas/06`). Off by default on purpose: the sweep must stay
  // useful with no window at all — it runs for hours and survives reboots, and an observation
  // instrument is never a condition of the work. What this flag wires is ONE direction — events out,
  // to a file. It opens no port, and it gives nothing a path back to the card (R1 stands).
  //
  // ⚠️ WHAT IT DOES NOT DO ON THE LIVE PATH, SAID RATHER THAN LEFT TO BE DISCOVERED: it carries NO
  // card telemetry. On the bench the card ticks its own; here the readings must come from the
  // separate sampler process, because this one is blocked inside the burn (`ideas/06` §A). Until
  // that is wired, the four readouts on the card stay dark and the run tiles work.
  // ─── THE WINDOW IS A CONDITION OF THE RUN, NOT AN OPTION (`bugs/14`, the owner's word) ──────────
  //
  // *«прогоны без визуализатора ПОД СТРОГИМ ЗАПРЕТОМ!!! ЭТО БАГ!!!!!»* — 2026-08-16, after a live
  // sweep started with no window on screen for the second time that day.
  //
  // The reason is not comfort. When the machine hangs, the screen freezes on its last frame and the
  // run's own output stops with it; the FROZEN PICTURE is the operator's fastest signal, and the rung
  // it names is the point of failure (`ideas/06`). A run nobody can see removes that signal exactly
  // when it is needed.
  //
  // ⚠️ THE CHECK IS «КТО-ТО СМОТРИТ», NOT «СЕРВЕР ЖИВ», and that distinction is paid for: twice this
  // day the server answered 200 on 127.0.0.1:7311 while no window had opened at all. `/health`
  // reports OPEN EVENT STREAMS — a browser holding one is a browser with the page on screen.
  // ─── THE RUN RAISES ITS OWN WINDOW — the owner's word, 2026-08-16 ────────────────────────────────
  //
  // *«было бы супер, чтобы бекенд движка сам поднимал страницу и конфигурировал. Тогда бекенд
  // становится менеджером»* · *«и не будет ситуации, что руки не знают о том, что делают ноги, и
  // наоборот»*.
  //
  // That second sentence is the engineering reason, and it was paid for the same day: the operator
  // had a window on his monitor while this gate refused the run for not having one. Two commands in
  // two terminals owned two halves of one state, and neither could see the other's. One owner
  // removes the disagreement by construction — there is no second party left to disagree with.
  //
  // The gate itself does NOT weaken: a run still may not touch the card unless somebody is watching.
  // What changes is who is asked to fix it. Refusal is now the LAST resort, not the first answer.
  const dash = await import('./lib/run-dashboard.mjs');
  let watch = await dash.viewersWatching({ port: dash.DEFAULT_PORT });
  if (!watch.ok || watch.viewers < 1) {
    console.log('ОКНО НАБЛЮДЕНИЯ: не открыто — поднимаю сам, ОТДЕЛЬНЫМ ПРОЦЕССОМ.');
    // 🔴 ОТДЕЛЬНЫМ ПРОЦЕССОМ, А НЕ ВНУТРИ СЕБЯ — `bugs/27`. Прежде сервер поднимался здесь же
    // (`raiseDashboard` возвращал живой `raised.s`), и это ломало сам прибор: развёртка синхронно
    // блокирует цикл событий на все десять секунд прожига, а заблокированный процесс не отдаёт ни
    // HTTP, ни SSE. Замерено на живом прогоне 2026-08-22: отдельный сэмплер сделал 260 замеров, а
    // страница получила 42 пульса за те же 259 с — картинка стояла три четверти прогона, и владелец
    // увидел ровно тот застывший экран, которым прибор ОБЯЗАН докладывать о зависании машины.
    //
    // Лекарство от «прогон занят» уже было построено — `pulseNow` подмешивает показания карты с
    // отдельного сэмплера, — но жило внутри занятого. Теперь оно живёт снаружи: тот же приём и та же
    // причина, что у сэмплера телеметрии ниже. Модуль умеет служить сам (`main()`): он поднимает
    // сервер, открывает окно и закрывает его на ЛЮБОМ своём выходе.
    const { spawn: spawnDash } = await import('node:child_process');
    const { fileURLToPath: toPathDash } = await import('node:url');
    const dashScript = join(dirname(toPathDash(import.meta.url)), 'lib', 'run-dashboard.mjs');
    const dashProc = spawnDash(process.execPath, [dashScript, '--port', String(dash.DEFAULT_PORT)],
      { windowsHide: true, stdio: 'ignore' });
    dashProc.unref?.();
    // Окно поднимает ДОЧЕРНИЙ процесс, поэтому ждать надо его, а не себя.
    await dash.waitForViewer(dash.DEFAULT_PORT);
    watch = await dash.viewersWatching({ port: dash.DEFAULT_PORT });
    // Сервер принадлежит ЭТОМУ прогону: кончился прогон — ушло и окно. Окно, пережившее свой прогон,
    // это форма `bugs/04` — застывшая картинка того, чего уже не происходит. На Windows дочерний
    // процесс НЕ умирает вместе с родителем, поэтому гасим явно и на ЛЮБОМ выходе, как сэмплер ниже.
    const shutWindow = () => {
      try { dashProc.kill(); } catch { /* уже мёртв */ }
      try { dash.closeWindow(); } catch { /* уже закрыто */ }
    };
    process.on('exit', shutWindow);
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { shutWindow(); process.exit(130); });
  }
  if (!watch.ok || watch.viewers < 1) {
    console.error('ОТКАЗ: ОКНО НАБЛЮДЕНИЯ НЕ ОТКРЫТО, а развёртка пишет в карту.');
    console.error(`       ${watch.why}`);
    console.error('       Прогон пытался поднять его сам и не смог — значит смотреть действительно нечем.');
    console.error('');
    console.error('       Слово владельца 2026-08-16: «прогоны без визуализатора ПОД СТРОГИМ ЗАПРЕТОМ».');
    console.error('       Когда машина зависает, картинка застывает — и это самый быстрый сигнал оператору,');
    console.error('       а застывшая ступень и есть точка отказа. Без окна этого сигнала нет.');
    console.error('');
    console.error('       ЧТО СДЕЛАТЬ: `npm run dashboard` руками и посмотреть, на чём он встанет.');
    console.error('       Проверка считает ОТКРЫТЫЕ ОКНА, а не живой сервер: сервер может отвечать,');
    console.error('       когда окна нет (так было дважды 2026-08-16).');
    console.error('');
    console.error('       План прогона читается без окна и карту не трогает: добавьте --dry-run.');
    return 2;
  }
  console.log(`ОКНО НАБЛЮДЕНИЯ: открыто, смотрящих ${watch.viewers} — условие прогона выполнено`);

  // THE PREVIOUS RUN'S GAUGE IS REMOVED BEFORE THIS ONE WRITES ITS FIRST. The bench has always done
  // this; the live path had not, so a window opened now would first paint the LAST run's ending —
  // «прогон оставлен» — and only later switch. The owner saw exactly that and named the rule:
  // *«визуализатор должен запускаться в АДЕКВАТНОМ СОСТОЯНИИ ОТРАЖАЮЩИМ СОСТОЯНИЕ ТЕКУЩЕГО ПРОГОНА»*.
  dash.clearPulse();

  // ─── THE SIDE-CAR SAMPLER — the only thing that CAN read the card while the sweep is burning ────
  //
  // The owner, watching the live window: «лсд дисплеи мертвые, ничего не показывают - баг». They
  // were, and by construction: this process blocks inside every burn (the load runs synchronously),
  // so it cannot sample its own card for ten seconds at a stretch — the exact window in which the
  // operator most wants to see watts and degrees. `ideas/06` §A named the remedy before the screen
  // existed: give the readings to a process that is NOT blocked.
  //
  // One sampler for the WHOLE sweep, not one per rung: a per-rung sampler goes dark between rungs and
  // leaves the readouts blinking, and it already exists for a different job (the atom's ceiling proof
  // owns that one and keys it by rung — two consumers of one file would fight over its lifetime).
  const { spawn } = await import('node:child_process');
  const { fileURLToPath: toPath } = await import('node:url');
  const samplerScript = join(dirname(toPath(import.meta.url)), 'lib', 'hardware-mon.mjs');
  // ─── THE PREVIOUS RUN'S PULSE IS MOVED ASIDE, NOT DELETED (`plans/27` §27.1, `ideas/10` §5.6) ───
  //
  // This line used to be `rmSync`, and that deletion is why the project has exactly ONE recording of
  // the sampler losing its tick before the machine died: every run destroyed its predecessor's.
  // The pulse stopped being decoration the moment `ideas/10` was approved — it is now the candidate
  // FOURTH observation, and §5.1 cannot pick a threshold from one case, so cases must accumulate.
  //
  // ARCHIVING HAPPENS HERE, AT THE START OF THE NEXT RUN, and that placement is the whole trick: the
  // runs worth keeping are the ones that end with a dead machine, and a dead machine runs no
  // cleanup. The file simply waits on disk across the reboot until somebody launches again.
  const archived = await (async () => {
    const mon = await import('./lib/hardware-mon.mjs');
    return mon.archivePulseFile(dash.TELEMETRY_PATH);
  })();
  console.log(archived.archived
    ? `ПУЛЬС ПРОШЛОГО ПРОГОНА: убран в ${archived.to} — не затёрт`
    : `ПУЛЬС ПРОШЛОГО ПРОГОНА: ${archived.why}`);
  // Whatever was not worth archiving is still in the sampler's way, and the sampler truncates on
  // start anyway — the removal stays, it just no longer runs on evidence.
  try { rmSync(dash.TELEMETRY_PATH, { force: true }); } catch { /* a stale file the server will age out anyway */ }
  const sideCar = spawn(process.execPath, [
    samplerScript, '--seconds', '36000', '--period', '1000', '--out', dash.TELEMETRY_PATH,
  ], { windowsHide: true, stdio: 'ignore' });
  sideCar.unref?.();
  const stopSideCar = () => { try { sideCar.kill(); } catch { /* already gone */ } };
  sideCarRef = stopSideCar;
  // ВТОРОЙ СЛОЙ: гасим на ЛЮБОМ выходе процесса, а не только на предусмотренных. `finally` покрывает
  // возврат и исключение, обработчик сигналов — Ctrl+C; `exit` ловит всё остальное, включая
  // `process.exit()` из чужого кода и необработанное отклонение промиса. На Windows дочерний процесс
  // НЕ умирает вместе с родителем, поэтому «мы же вышли» здесь ничего не гарантирует. Тот же приём,
  // что у окна наблюдения выше, и по той же причине.
  process.on('exit', stopSideCar);
  console.log(`ТЕЛЕМЕТРИЯ: отдельный сэмплер pid ${sideCar.pid} пишет в ${dash.TELEMETRY_PATH} раз в секунду`);

  // ЛЕСТНИЦА ИНТЕНСИВНОСТИ СЧИТАЕТСЯ ОДИН РАЗ И КОРМИТ ВСЕХ ТРОИХ — прогон, прибор и ПЛАН. Пара
  // «правда↔зеркало», которую лучше СХЛОПНУТЬ, чем сторожить: окну надо знать, сколько форм жжётся
  // в ступени, иначе его бюджет молчания описывает работу, которой больше нет (см. `openPulse`), а
  // сухому прогону — сколько будет ПОПЫТОК, иначе он обещает оператору переигрывание, которого не
  // произойдёт (`bugs/33`). Источник один — `sweepBurnLadder()`.
  const sweepShapeLadder = sweepBurnLadder();

  const pulse = dash.openPulse({
    source: 'ЖИВАЯ КАРТА',
    synthetic: false,
    band: `${fromMhz}…${toMhz} МГц`,
    probeSeconds: config.SWEEP_PROBE_SECONDS ?? 10,
    shapesPerRung: sweepShapeLadder[0].length,
  });
  console.log(`ДАШБОРД: прибор пишется в ${pulse.path}`);

  let report;
  try {
    report = await sweepRange({
    curveDoc: doc,
    points,
    fromMhz,
    toMhz,
    bandLabel: arg('label', `${fromMhz}…${toMhz} МГц`),
    depthCapMv,
    envelopeMhz,
    pinCard,
    journal,
    // ONE recovery for the whole sweep: the atom does its own preflight on every rung, and two
    // recoveries that could disagree are worse than one that cannot.
    recover: async () => watchdog.recover(),
    // THE FRESH TABLE, READ THROUGH THE HANDLE THIS COMMAND ALREADY HOLDS. In-process NVAPI, no
    // subprocess — the reason this is safe per rung while `probeCard()` is not (see the seam's own
    // comment). The card is at factory at this moment: every rung's rollback zeroes the curve in a
    // `finally`, and `runRung` refuses to continue when that rollback was not clean.
    readPointsFn: () => nvapi.readVfCurve(nv, handle).points,
    runStepFn: (a) => vf.runStep(a),
    saveFn: async (d) => saveCurveDoc(d),
    onEvent: (e) => { pulse?.event(e); console.log(`  ${e.text}`); },
    // ─── ПРОЖИГ: `furnace` С ЛЕСТНИЦЕЙ ИНТЕНСИВНОСТИ (слово владельца 2026-08-22) ──────────────
    //
    // Раньше здесь молчаливо действовало умолчание `runRung` — ОДНА форма `sdc_fma/transient`,
    // которая берёт 233 Вт и НЕ ЧИТАЕТ ПАМЯТЬ ВОВСЕ. Теперь ступень судится набором из трёх форм
    // на `furnace` (305 Вт, трафик VRAM 4,9 ТБ за десять секунд) плюс `branchy` как форма падения,
    // и если карта под этим прожигом не сядет на настраиваемую частоту — ступень переигрывается
    // всё более слабой интенсивностью, пока не сядет (`bugs/28`).
    //
    // Лестница строится ЗДЕСЬ, а не внутри развёртки: движок про интенсивность ничего не знает и
    // знать не должен (R16a — он композитор, а не писатель), а набор форм — это решение о том,
    // ЧЕМ мерить, и оно принадлежит команде.
    // ⚠️ РАЗВЁРТКА ЖЖЁТ ОДНИМ НАБОРОМ — ЛЕСТНИЦА ИНТЕНСИВНОСТИ ЕЙ БОЛЬШЕ НЕ НУЖНА.
    //
    // Лестница (`bugs/28`) существовала ровно для одного: принудить карту сесть на ЗАКАЗАННУЮ
    // частоту, ослабляя нагрузку. Канон 2026-08-22 (`GOAL.md` → «УПРАВЛЯЕМАЯ ВЕЛИЧИНА СТУПЕНИ —
    // НАПРЯЖЕНИЕ, А НЕ ЧАСТОТА») отменил саму цель: заказ частоты больше не является требованием,
    // строка пишется по ВЫДАННОЙ частоте. Принуждать стало нечего.
    //
    // И это ещё и чинит измерение: ослабленный прожиг доказывал напряжение под НЕ ТОЙ нагрузкой,
    // под которой владелец играет. Одна ступень — один полный прожиг — один замер, все строки
    // сняты в одном режиме и потому сопоставимы между собой.
    shapeLadder: sweepShapeLadder,
    });
  } catch (e) {
    // OUR OWN DEATH IS NOT THE CARD'S (`bugs/20`). The process is ALIVE here — that is the entire
    // difference from a hang, and it is what makes this closure possible at all. Leaving the intent
    // orphaned would have the next launch print «ЗАВИС: <частота> / <напряжение>», a measurement of
    // silicon nobody performed, against a rung that was never judged. Two such phantoms are already
    // on disk from `bugs/19`'s crash.
    //
    // Rethrown, never swallowed: closing the record honestly is not the same as recovering, and a
    // caller that stops seeing the failure is a worse defect than the one being fixed.
    try { closeAsWriterDeath(journal, { at: localIso(), error: e }); } catch (e2) {
      console.error(`ВНИМАНИЕ: намерение закрыть не удалось (${e2?.message ?? e2}) — следующий запуск припишет ЗАВИС`);
    }
    throw e;
  } finally {
    // ⚠️ В `finally`, А НЕ ПОСЛЕ ВЫЗОВА. Раньше сэмплер гасился строкой ниже `sweepRange`, то есть
    // ТОЛЬКО на удачном пути: любое исключение из развёртки оставляло его жить — а он опрашивает
    // карту раз в секунду и запущен на ДЕСЯТЬ ЧАСОВ (`--seconds 36000`). Владелец увидел следы
    // такого мусора в системе («какие-то терминалы открытыми в ОС остаются после тебя»), и это
    // ровно тот класс: процесс, переживший то, ради чего его завели.
    stopSideCar();
  }

  pulse?.finish({ ok: report.ok, why: report.ok ? '' : report.why });
  for (const line of sweepReportLines(report)) console.log(line);
  return report.ok ? 0 : 1;
}

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

  if (argv.includes('--sweep')) return mainSweep(argv, arg);
  if (argv.includes('--band')) return mainBand(argv, arg);

  if (!argv.includes('--search')) {
    console.error('ОШИБКА: нужен один из режимов — --sweep --from <МГц> --to <МГц> · --band <частоты> · '
      + '--search --cap <МГц> · --selftest');
    return 2;
  }

  const capMhz = Number(arg('cap'));
  if (!Number.isFinite(capMhz)) { console.error('ОШИБКА: --search требует --cap <МГц>'); return 2; }
  const seconds = Number(arg('seconds', 30));
  const dryRun = argv.includes('--dry-run');

  // THE SET IS THE DEFAULT, and the narrow mode has to be asked for by name. A threshold found with
  // one program is that program's threshold: researches/02 §4 measured Vmin spreading up to 100 mV
  // between programs on the same card, so the single-shape run is a legitimate probe and is NOT a
  // measurement that closes a point (P5-AC3).
  const singleShape = argv.includes('--single-shape');
  const workload = arg('workload', 'sdc_fma');
  if (argv.includes('--workload') && !singleShape) {
    console.error('ОШИБКА: --workload задаёт ОДНУ нагрузку, а по умолчанию точка судится НАБОРОМ форм.');
    console.error('        Нужен узкий прогон — скажите это вслух: --single-shape --workload <имя>.');
    return 2;
  }
  const shapes = singleShape ? null : DIVERSE_SET;

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
  let rungs = [];
  let shapeChoice = null;
  try {
    const curve = nvapi.readVfCurve(nv, handle);
    if (!curve.ok) { console.error(`ОШИБКА: кривая не прочиталась — ${curve.why}`); return 1; }
    serving = vf.voltageForClock(curve.points, capMhz);
    // THE LADDER IN VOLTS, and it is not a refinement — it is what makes the depth governor able to
    // SEE. `pickAscentRungs` bounds the first step in MILLIVOLTS, and on an ungraded (fixed-MHz)
    // ladder it says so and walks the ladder as handed over. That was harmless while this path wrote
    // ONE point (a single point buys no undervolt at all — `bugs/02`); the moment it writes the whole
    // curve, an ungraded ladder means a real undervolt taken under a blind governor, which is the
    // exact arrangement that hung the owner's machine for 5 h 40 min (`bugs/03`, R10).
    if (serving) rungs = vf.ascentLadderByVoltage(curve.points, capMhz, { stepMv: config.VOLTAGE_GRID_STEP_MV ?? 5 });
    // THE SHIPPED SHAPE, or a refusal. No clock is pinned on this path, so the ONLY thing that can
    // hold the ceiling here is the curve itself — and below `top − 1000 MHz` it cannot.
    const vec = nvapi.buildRaiseAndCapVector(curve.points, 0, { capMhz });
    shapeChoice = vf.chooseWriteShape(vec, { pinned: false });
  } finally {
    nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload);
  }
  if (!serving) { console.error(`ОШИБКА: ни одна точка кривой не обслуживает ${capMhz} МГц`); return 1; }
  if (!shapeChoice.ok) {
    // The reason already opens with «ОТКАЗ» where it is one — printing our own prefix on top stutters.
    console.error(shapeChoice.why.startsWith('ОТКАЗ') ? shapeChoice.why : `ОТКАЗ: ${shapeChoice.why}`);
    console.error('       На этой частоте потолок способно удержать только ЗАКРЕПЛЕНИЕ, а закрепления');
    console.error('       у этого режима нет. Развёртка с закреплением — `npm run engine -- --band <МГц>`.');
    return 1;
  }

  // THE RATCHET AS THE RUN WILL SEE IT — through `ratchetView`, i.e. attempts RESOLVED and both
  // quarantine axes applied (`bugs/06`). Until 2026-08-14 22:xx this line partitioned by stamp only,
  // so the plan could print a limit the search does not use.
  const history = ratchetView({ store, card, writeShape: shapeChoice.shape }).history;
  const summary = summarizePoint(history, serving.pointIndex, { fineStepMhz: ASCENT_FINE_MHZ });

  console.log('ПОИСК КРАЯ — то, чего этот проект ещё ни разу не делал');
  console.log('');
  console.log(`  ПОТОЛОК:   ${capMhz} МГц · обслуживает точка ${serving.pointIndex} (${serving.mv} мВ, ${serving.mhz} МГц)`);
  if (shapes) {
    console.log(`  НАБОР:     ${shapes.length} формы, порог точки = ХУДШАЯ из них, по ${seconds} с каждая:`);
    for (const s of shapes) console.log(`             · ${s.id}`);
    console.log('             самая чувствительная идёт первой, и после первого не-PASS остальные НЕ прогоняются');
  } else {
    console.log(`  НАГРУЗКА:  ${workload}, устойчивая, ${seconds} с — ОДНА форма (--single-shape).`);
    console.log('             Это НЕ закрывает точку по P5-AC3: край одной программы — не край карты');
  }
  console.log('             оракул трёхзначный, «не упало» вердиктом не является');
  console.log(`  ШАГИ:      грубый ${ASCENT_COARSE_MHZ} МГц (≈25 мВ) · точный ${ASCENT_FINE_MHZ} МГц (≈5 мВ, один ИЗМЕРЕННЫЙ шаг сетки)`);
  console.log('  ФОРМА:     ОТГРУЖАЕМАЯ — вся кривая вверх с потолком, то есть ровно то, что уедет в профиль');
  console.log(`             (${shapeChoice.heldBy} держит потолок; одиночная точка потолок не удешевляет вовсе — bugs/02)`);
  console.log(`  ХРАПОВИК:  ${summary.ratchet.limitMhz === Infinity ? 'ограничений нет — точка ни разу не сбоила' : `≤ ${summary.ratchet.limitMhz} МГц (самый низкий отказ ${summary.ratchet.lowestFailure})`}`);
  // THE LADDER IN VOLTS, WITH THE FIRST STEP'S DEPTH PRINTED FIRST — the number whose absence cost the
  // owner a night (`bugs/03`). A refusal by the depth governor is printed here, before anything runs.
  const composed = rungs.length
    ? composeAscentLadder({
      fine: rungs.filter((r) => r.offsetMhz <= summary.ratchet.limitMhz),
      history,
      point: serving.pointIndex,
      capMhz,
      stockMv: serving.mv,
      stride: 5,
    })
    : { chosen: { rungs: [], refused: false, why: 'лестница по напряжению не построена' }, ladderRungs: [], sessionDepth: null };
  const governed = composed.chosen;
  console.log(`  ЛЕСТНИЦА:  ступеней по напряжению ${rungs.length}, глубже всего −${rungs.length ? rungs[rungs.length - 1].savedMv : 0} мВ`);
  console.log(`             ПЕРВЫЙ ШАГ −${governed.rungs[0]?.savedMv ?? '—'} мВ · ступеней в восхождении ${governed.rungs.length}`);
  if (governed.refused) console.log(`             ${governed.why}`);
  console.log(`  ${sessionDepthLine(composed.sessionDepth)}`);
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
    shapes,
    // THE SHIPPED SHAPE AND THE VOLTAGE LADDER, together — neither is optional now. The shape is what
    // `bugs/02` step 1 asks for; the ladder is what lets the depth governor bound a step it can
    // finally see in millivolts (`bugs/03`).
    writeShape: shapeChoice.shape,
    rungs,
    seconds,
    card,
    store,
    runStepFn: (a) => vf.runStep(a),
    onAttempt: (a) => {
      // THE GRADED LINE — how many computations came out wrong, printed BESIDE the verdict so the
      // approach to the edge is visible as a slope rather than only as the crash that ends it.
      const grad = a.badElemsMax === null || a.badElemsMax === undefined
        ? 'градиент не снят'
        : `испорчено элементов ${a.badElemsMax} (доля ${a.faultRate === null ? '—' : a.faultRate.toExponential(2)}), бит-дистанция ${a.bitDistMin}, запусков ${a.launches}`;
      const by = a.worstShape ? ` · решила форма ${a.worstShape}` : '';
      console.log(`  ПОПЫТКА +${a.offsetMhz} МГц (${a.servingMv ?? '?'} мВ) → ${a.verdict ?? 'НЕИЗВЕСТНО'}${by} · ${grad}`);
    },
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
