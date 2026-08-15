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
// The margin helper is a NAMED export only — `config.mjs`'s default object carries constants, not
// functions, and reaching for `config.marginAboveFailureMv` crashes the suite instead of reddening a
// block (paid for on 2026-08-15 21:5x, EXP-0040's rule about assertions that kill the reporter).
import { marginAboveFailureMv } from './config.mjs';
// `chooseWriteShape` is imported STATICALLY and that is safe offline: `vf-step` imports `nvapi`
// lazily, inside the functions that write, so nothing here reaches for koffi or the driver.
import { ASCENT_COARSE_MHZ, ASCENT_FINE_MHZ, chooseWriteShape } from './lib/vf-step.mjs';
import { DIVERSE_SET } from './lib/stress-tester.mjs';
import { localIso } from './lib/card-grids.mjs';
import {
  writeIntent, writeVerdict,
  openJournal, readJournal, orphanIntents, resumeState,
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
 * @param {object}   a
 * @param {number[]} a.voltageGridMv     every voltage the card offers (any order; sorted here)
 * @param {number}   a.stockVoltageMv    the voltage serving this frequency at stock — depth is measured from it
 * @param {number}   a.availableDepthMv  how deep the ±1000 MHz lever can reach here; the wall, not a preference
 * @param {Array}    [a.zones]           the policy; defaults to `config.DESCENT_ZONES`
 * @returns {{rungs:Array<{mv:number,depthMv:number,stepMv:number,zoneStepMv:number,forcedByGrid:boolean}>,
 *            refused:boolean, why:string, forcedByGridCount:number, floorMv:number}}
 *
 * [NOT-TESTED]
 */
export function descentLadder({
  voltageGridMv = [],
  stockVoltageMv = null,
  availableDepthMv = 0,
  zones = config.DESCENT_ZONES,
} = {}) {
  const empty = (why) => ({ rungs: [], refused: true, why, forcedByGridCount: 0, floorMv: null });
  if (!Array.isArray(voltageGridMv) || voltageGridMv.length === 0) return empty('сетка напряжений пуста — спускаться не по чему');
  if (!Number.isFinite(stockVoltageMv)) return empty('стоковое напряжение не названо — глубина отсчитывается от него');
  if (!Array.isArray(zones) || zones.length === 0) return empty('политика шагов пуста');
  if (!Number.isFinite(availableDepthMv) || availableDepthMv <= 0) {
    return { rungs: [], refused: false, why: 'рычаг не даёт снять ни милливольта — спуск не начинается', forcedByGridCount: 0, floorMv: stockVoltageMv };
  }

  // High → low, deduplicated: the grid is the card's dictionary and the descent reads it downward.
  const grid = [...new Set(voltageGridMv.filter(Number.isFinite))].sort((a, b) => b - a);
  const floorMv = stockVoltageMv - availableDepthMv;
  // The policy step for a given depth: the first zone whose boundary the depth has not yet reached.
  const stepForDepth = (d) => (zones.find((z) => d < z.untilDepthMv) ?? zones[zones.length - 1]).stepMv;

  const rungs = [];
  let current = stockVoltageMv;
  // The grid is finite and every iteration moves strictly downward, so this terminates; the bound is a
  // backstop against a malformed grid, not part of the algorithm.
  for (let guard = 0; guard <= grid.length; guard++) {
    const zoneStepMv = stepForDepth(stockVoltageMv - current);
    const want = current - zoneStepMv;
    // Candidates: strictly below where we stand, and no deeper than the policy allows.
    let next = null;
    let forcedByGrid = false;
    for (const v of grid) {
      if (v < current && v >= want) { next = v; }   // grid is descending, so the last match is the deepest
      else if (v < want) break;
    }
    if (next === null) {
      // The grid cannot express this step — the nearest point down is already deeper than the policy.
      next = grid.find((v) => v < current) ?? null;
      forcedByGrid = true;
    }
    if (next === null) break;                  // the bottom of the card's grid
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
  if (rungs.length === 0) {
    return {
      rungs: [], refused: false, forcedByGridCount: 0, floorMv,
      why: `рычаг даёт ${availableDepthMv} мВ, а ближайшая ступень сетки ниже ${stockVoltageMv} мВ глубже этого — `
        + 'спускаться некуда, и это не отказ, а свойство участка',
    };
  }
  return {
    rungs, refused: false, forcedByGridCount, floorMv,
    why: `ступеней ${rungs.length}, первый шаг −${rungs[0].stepMv} мВ, глубже всего −${rungs[rungs.length - 1].depthMv} мВ`
      + (forcedByGridCount ? ` · сетка вынудила ${forcedByGridCount} шаг(ов) глубже политики (10 мВ там, где просили 5)` : ''),
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
 * [NOT-TESTED]
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
 * [NOT-TESTED]
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
  pinCard = null,
  // Carried into the journal, not used by the decision: after a hang these three are what a post-mortem
  // has to reconstruct the descent from — how deep this rung sat, which policy zone produced it, and
  // whether the descent had been seeded at this frequency (§4.2).
  depthMv = null,
  zoneStepMv = null,
  seeded = false,
  // WHETHER A CLOCK PIN IS AVAILABLE AT ALL — and this parameter exists because without it F2-AC9's
  // refusal branch is UNREACHABLE. `chooseWriteShape` refuses only when the curve cannot hold the
  // ceiling AND nothing is pinned; a caller that hard-codes «pinned: true» can never see that answer,
  // so the criterion «refuses if neither can» would be satisfied by a branch no run can enter — a
  // guard that has never gone red proves nothing (`BUG_FIXING_FRAMEWORK.md` → Guards). The sweep sets
  // it from the card's own clock ladder: no ladder, no pin, and a rung below the curve's cap floor
  // then has no holder and is refused BEFORE any write instead of discovered mid-burn.
  canPin = true,
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
  const vector = build(points, plan.deltaMhz, { capMhz: clockMhz });
  if (!vector || vector.ok !== true) {
    return stop('refused', `вектор записи не построен: ${vector?.why ?? 'нет ответа строителя'}`);
  }
  // `pinned` is the CAPABILITY, not the preference — «a pin is available here», which is the question
  // `chooseWriteShape` answers with «then who should hold the ceiling». Its answer is obeyed in both
  // directions, including «the curve holds it, and pinning here would be harmful».
  const held = chooseShape(vector, { pinned: canPin });
  record.holder = held.heldBy;
  record.writeShape = held.shape;
  if (!held.ok) return stop('refused', held.why);

  // ONE HOLDER, NEVER TWO. When the curve carries the ceiling itself, the pin is not merely redundant
  // — it fought the cap for one frequency on 2026-08-14 and turned three PASSing shapes into
  // НЕИЗВЕСТНО. `pinRequired` is the field that decides it, and it belongs to `chooseWriteShape`.
  const pinMhz = held.pinRequired ? clockMhz : null;

  // ---- 3. THE ONE EMERGENCY STOP THE OWNER LEFT (F2-AC5). Two hangs in a row on this rung is a
  // fault, not an edge, and a third attempt buys nothing but another reboot.
  const key = `${clockMhz}/${voltageMv}`;
  if (blockedKeys && blockedKeys.has(key)) {
    return stop('refused', `СТУПЕНЬ ЗАБЛОКИРОВАНА ЖУРНАЛОМ: ${clockMhz} МГц / ${voltageMv} мВ повесила машину `
      + 'ДВА РАЗА ПОДРЯД. Это не край, а поломка — край даёт вердикт оракула, поломка повторяется. Третий раз не начинаем');
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

  // ---- 5. THE ATOM. Everything dangerous happens inside it, and all of it is already proved.
  record.cardTouched = true;
  const atom = await runStepFn({
    point: plan.entry.i,
    offsetMhz: plan.deltaMhz,
    writeShape: held.shape,
    capMhz: clockMhz,
    pinMhz,
    pinCard,
    shapes,
    seconds,
    sustain,
  });
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
    return close(stop('unknown', `ОТКАТ НЕ ЧИСТ на ${clockMhz} МГц / ${voltageMv} мВ — ${dirty.length} шаг(ов) не отработали: `
      + `${dirty.map((b) => b.name).join(' · ')}. Следующая ступень стартовала бы на карте, состояние которой `
      + 'никто не может назвать, и это СТОП, а не вердикт о напряжении'));
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
    return close(stop('void', `ступень ${clockMhz} МГц / ${voltageMv} мВ прошла с вердиктом ${record.verdict}, но карта НЕ сказала, `
      + 'какое напряжение обслуживало частоту после записи — отсутствие наблюдения не является наблюдением совпадения'));
  }
  if (record.servingMvAfter !== voltageMv) {
    return close(stop('void', `СТУПЕНЬ ИЗМЕРИЛА ЧУЖОЕ НАПРЯЖЕНИЕ: заказано ${voltageMv} мВ на ${clockMhz} МГц, а после записи `
      + `частоту обслуживало ${record.servingMvAfter} мВ по ПЕРЕЧИТАННОЙ таблице карты. Вердикт ${record.verdict} `
      + 'относится не к заказанному напряжению и в документ кривой не идёт'));
  }

  // ---- 9. THE VERDICT, AT LAST — and a failure is a SIGNAL, never the edge (§4.6).
  if (isPass(record.verdict)) {
    return close({
      ...record,
      outcome: 'passed',
      why: `${voltageMv} мВ обслуживает ${clockMhz} МГц и ПРОШЛО (сдвиг +${plan.deltaMhz} МГц, потолок держит ${held.heldBy}`
        + `${record.decidedBy ? `, решала форма ${record.decidedBy}` : ''})`,
    });
  }
  return close({
    ...record,
    outcome: 'failed',
    why: `ОТКАЗ ${record.verdict} на ${clockMhz} МГц / ${voltageMv} мВ${record.decidedBy ? ` (форма ${record.decidedBy})` : ''}. `
      + 'Это СИГНАЛ, что край рядом, а НЕ край: край ищется шагом 5 мВ, и только к нему применяется запас +10 мВ',
  });
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
 * [NOT-TESTED]
 */
export function seedFor({ frequencyMhz, curveDoc } = {}) {
  const rows = curveDoc?.frequencies;
  if (!Array.isArray(rows) || !Number.isFinite(frequencyMhz)) return null;
  // Statuses that mean «a burn proved this voltage here». `lever-limited` is deliberately absent.
  const PROVEN = new Set(['short-burn-proved', 'edge-found', 'long-burn-proved']);
  let best = null;
  for (const r of rows) {
    if (!r || !Number.isFinite(r.mhz) || !Number.isFinite(r.voltageMv)) continue;
    if (r.mhz <= frequencyMhz) continue;              // only from ABOVE
    if (!PROVEN.has(r.status)) continue;              // only PASSED evidence
    // The NEAREST higher frequency: the closest neighbour is the least extrapolation.
    if (best === null || r.mhz < best.mhz) best = r;
  }
  if (best === null) return null;
  return { seedMv: best.voltageMv, neighbourMhz: best.mhz, neighbourStatus: best.status };
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
 * [NOT-TESTED]
 */
export function seedOutcome({ verdict, seedMv, stockVoltageMv, neighbourMhz, frequencyMhz } = {}) {
  const depth = Number.isFinite(stockVoltageMv) && Number.isFinite(seedMv) ? stockVoltageMv - seedMv : 0;
  if (isPass(verdict)) {
    return {
      seeded: true,
      restartFromStock: false,
      provenSavedMv: depth > 0 ? depth : 0,
      note: `затравка ${seedMv} мВ от соседки ${neighbourMhz} МГц прошла — монотонность здесь держится, `
        + `спуск продолжается от неё (доказанная глубина −${depth} мВ)`,
    };
  }
  return {
    seeded: false,
    restartFromStock: true,
    provenSavedMv: 0,
    note: `ЗАТРАВКА ОТВЕРГНУТА на ${frequencyMhz} МГц: ${seedMv} мВ от соседки ${neighbourMhz} МГц дало `
      + `вердикт ${verdict ?? 'НЕИЗВЕСТНО'}, а не PASS. Монотонность на этом кремнии здесь НАРУШЕНА — `
      + `это находка о карте, а не сбой прогона. Спуск начинается заново от стока ${stockVoltageMv} мВ `
      + 'по лестнице шагов владельца.',
  };
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

  // — THE OWNER'S EDGE RULE, guarded where it can be violated (his words, 2026-08-15 21:5x:
  //   «Найти отказ нужно с шагом 5 мВ — это строгое правило… И от него на 10 мВ поднимаемся вверх»).
  //   The coarse ladder above exists only to approach the edge; the number that SHIPS comes from a
  //   5 mV walk plus 10 mV, and nothing else may reach `marginAboveFailureMv`.
  ok('запас владельца на этой карте = 10 мВ (два измеренных шага сетки по 5)',
    (() => { try { return marginAboveFailureMv().millivolts; } catch (e) { return `упало: ${e.message.slice(0, 40)}`; } })(), 10);
  ok('ЛОКАЛЬНЫЙ РАЗРЫВ сетки в 10 мВ, поданный как шаг, ПАДАЕТ — иначе запас молча стал бы 20 мВ',
    (() => { try { marginAboveFailureMv(10); return 'не упало'; } catch (e) { return /20 мВ/.test(e.message) ? 'упало и назвало причину' : 'упало без причины'; } })(),
    'упало и назвало причину');

  // =============================================================================================
  // `plans/15` §4.2 — SEEDING, AND THE GOVERNOR THAT HAD TO GROW UP
  // =============================================================================================

  const seedDoc = {
    frequencies: [
      { mhz: 3090, voltageMv: 1100, status: 'edge-found' },
      { mhz: 2900, voltageMv: 1050, status: 'lever-limited' },   // our lever ran out — NOT evidence
      { mhz: 2842, voltageMv: 1000, status: 'short-burn-proved' },
      { mhz: 2400, voltageMv: 900, status: 'stock' },            // untouched — nothing proven
      { mhz: 2000, voltageMv: 850, status: 'long-burn-proved' },
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

    const rungOK = async (over = {}) => {
      atomLog.length = 0;
      return runRung({
        points: tablePoints, clockMhz: 2842, voltageMv: 1000,
        buildVector: vectorCapped, runStepFn: atom(atomPass(1000)), ...over,
      });
    };

    // — the happy path: the atom is called ONCE, with the plan's own arithmetic
    const good = await rungOK();
    ok('исправная ступень зовёт атом РОВНО ОДИН РАЗ', atomLog.length, 1);
    ok('и передаёт ему сдвиг и запись ИЗ ПЛАНА, а не из заказа',
      [atomLog[0].offsetMhz, atomLog[0].point, atomLog[0].capMhz], [142, 90, 2842]);
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
    ok('ДЕРЖАТЕЛЬ ПОТОЛКА НАЗВАН, и над полом кривой это КРИВАЯ',
      [good.holder, good.writeShape], ['кривая', 'raise-and-cap']);
    // ONE HOLDER, NEVER TWO — the 2026-08-14 lesson, asserted where it can be violated: when the curve
    // carries the ceiling, no pin may reach the atom.
    await rungOK();
    ok('ОДИН ДЕРЖАТЕЛЬ, НИКОГДА ДВА: под кривой закрепление НЕ запрашивается', atomLog[0].pinMhz, null);

    const low = await rungOK({ points: lowPoints, clockMhz: 1700, voltageMv: 760, buildVector: vectorLeaky });
    ok('ниже пола кривой потолок держит ЗАКРЕПЛЕНИЕ, и оно доезжает до атома',
      [low.holder, low.writeShape, atomLog[0].pinMhz, atomLog[0].offsetMhz],
      ['закрепление частоты', 'uniform', 1700, 300]);

    const noHolder = await rungOK({ points: lowPoints, clockMhz: 1700, voltageMv: 760, buildVector: vectorLeaky, canPin: false });
    ok('потолок не держит НИЧТО → отказ ДО записи, а не открытие посреди прожига',
      [noHolder.outcome, atomLog.length, /не держит НИЧТО/.test(noHolder.why)], ['refused', 0, true]);

    // — THE RE-ASSERTION against the card's own re-read table. This is what the paper proof may not
    //   replace (R12, EXP-0057): the plan says the voltage WOULD serve; only the card says it DID.
    const wrongVolt = await rungOK({ runStepFn: atom(atomPass(995)) });
    ok('ступень, измерившая ЧУЖОЕ напряжение, — НЕ PASS',
      [wrongVolt.outcome, wrongVolt.servingMvAfter], ['void', 995]);
    ok('и отказ называет ОБА напряжения — заказанное и то, что обслуживало на самом деле',
      /1000 мВ/.test(wrongVolt.why) && /995 мВ/.test(wrongVolt.why), true);
    const noVolt = await rungOK({ runStepFn: atom({ verdict: P, blocks: cleanUndo }) });
    ok('отсутствие наблюдения — не наблюдение совпадения', noVolt.outcome, 'void');

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
      [atomLog[0].seconds, atomLog[0].shapes[0].id], [config.SWEEP_PROBE_SECONDS, 'sdc_fma/transient']);

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
        (() => { const i = readJournal(jrn).records[0]; return [i.depthMv, i.zoneStepMv, i.seeded, i.holder, i.writeShape, i.pointIndex]; })(),
        [45, 25, true, 'кривая', 'raise-and-cap', 90]);
      ok('вердикт ЗАКРЫВАЕТ намерение — иначе следующий запуск обвинил бы законченную ступень в зависании',
        [wired.outcome, orphanIntents(readJournal(jrn).records).length], ['passed', 0]);

      // A rung refused ON PAPER never reaches the journal: an intent for a rung nobody ran is a rung
      // the next launch would mark ЗАВИС for a hang that never happened.
      const jrn2 = openJournal({ dir: join(journalBox, 'paper-refusal') });
      await runRung({
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
        points: tablePoints, clockMhz: 2842, voltageMv: 1000,
        buildVector: vectorCapped, runStepFn: atom(atomPass(1000)),
        blockedKeys: new Set(['2842/1000']),
      });
      ok('ступень, повесившая машину ДВАЖДЫ ПОДРЯД, третий раз не начинается, и атом не зван',
        [blocked.outcome, atomLog.length, /не край, а поломка/.test(blocked.why)], ['refused', 0, true]);
    } finally {
      rmSync(assertJournalSandbox({ dir: journalBox }), { recursive: true, force: true });
    }

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
    const prodAfter = existsSync(VMIN_DIR) ? readdirSync(VMIN_DIR).length : 0;
    ok('ПРОДАКШЕН НЕ ВЫРОС: самопроверка движка не подбросила улик', prodAfter, prodBefore);

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

  if (argv.includes('--band')) return mainBand(argv, arg);

  if (!argv.includes('--search')) {
    console.error('ОШИБКА: нужен один из режимов — --band <частоты> · --search --cap <МГц> · --selftest');
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
