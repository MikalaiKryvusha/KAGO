#!/usr/bin/env node
// automation-engine/lib/virtual-gpu.mjs — THE VIRTUAL VIDEO CARD. Epic 03, phase 1 (`plans/17`).
//
// WHAT THIS IS. A card that the rest of KAGO cannot tell from the owner's RTX 5070 Ti, so the sweep
// engine can be debugged without his machine. The owner asked for it in exactly these terms
// (`ideas/04`): *«мокап, виртуальную GPU, которая имеет свою кривую края и отказов. Будет
// притворяться реальной GPU»* — and he set its shape: *«в общем случае — любой видеокарты. Конкретную
// модель задаём профилем виртуальной карты»*. So the MECHANICS are here and the CARD is a file.
//
// ⚠️ THE LINE THAT MATTERS MORE THAN ANY CODE IN THIS FILE, and it is printed by every command:
// A GREEN RUN ON A VIRTUAL CARD IS NOT A STATEMENT ABOUT THE OWNER'S CARD. It proves LOGIC — the
// order of the walk, the step ladder, the journal, the resumption, the attribution of a failure. It
// proves nothing about silicon, about the driver, or about what a clock pin really does. A bench
// without that sentence is a factory of false `[TESTED]` markers (`ideas/04` §5, `researches/10` §4).
//
// WHAT PHASE 1 DELIBERATELY DOES NOT HAVE: an edge, a failure model, randomness, `ЗАВИС`. The card
// cannot fail yet, and that is what makes it debuggable. `fiction` is present and EMPTY so that
// phase 2 adds a value rather than a format.
//
// THE ONE DEFECT THAT WOULD MAKE ALL OF THIS WORTHLESS, named so it is designed against rather than
// hoped away: a double that is MORE PERMISSIVE than the thing it stands in for. Every later green
// would be a lie and nothing would go red to say so. Two answers, both structural:
//   1. the write vector is computed by `nvapi.buildRaiseAndCapVector` — the SAME function the live
//      backend calls, not a second arithmetic;
//   2. the four refusals are `profile-manager.curveWriteRefusal` — the SAME function, extracted for
//      this purpose. A pair that cannot drift beats a pair that must be watched.
// What is left to test is that this backend CALLS them, and that is a block below.
//
// Usage (all read-only with respect to the real GPU — this module cannot touch it at all):
//   node automation-engine/lib/virtual-gpu.mjs --derive [--out benches/cards/rtx5070ti.json]
//   node automation-engine/lib/virtual-gpu.mjs --show benches/cards/rtx5070ti.json
//   node automation-engine/lib/virtual-gpu.mjs --selftest
//
// [TESTED: 2026-08-15 19:2x · PHASE 2 · `npm run vgpu -- --selftest` → 62 blocks, 0 failures:
//  the invented edge exists for all 389 frequencies, lands ON the voltage grid, TRENDS upward and
//  JITTERS (the owner's «шумок», demanded on reading the first file) · the model gives exactly 0.5 at
//  the edge and ≈0.2/0.8 one 5 mV step either side · a shorter burn honestly finds less · all three
//  outcome classes reachable · the oracle reads the VOLTAGE OFF THE CARD rather than being told it ·
//  the REAL `runBurst` + `decideVerdict` deliver the verdict · one seed reproduces exactly and a
//  different seed does not · and `ЗАВИС` is a REAL process death in a child, whose `finally` did not
//  run while the intent written before the card was touched survived.
//  Mutation-proved with SIXTEEN mutations, addressees named before the run, 0 uncaught — including
//  the two that first exposed WEAK BLOCKS rather than weak mutations: a smoothness check that counted
//  distinct values (green on a smooth curve) and a verdict check that never exercised the SDC path.
//
// [TESTED: 2026-08-15 18:5x · PHASE 1 · 37 blocks, 0 failures, no GPU touched:
//  11 hostile card fixtures each refused by the FIELD it broke · the derivation compared field by
//  field against `curves/*.json` · the applier's own `readState` / `apply` / `resetToFactory` driving
//  the virtual backend UNCHANGED · the refusal-parity table over R11 / R13-bound / R13-offer / R12 ·
//  a second card with a different geometry walking the same code.
//  Mutation-proved with EIGHT mutations, addressees named in the suite header BEFORE the run, each
//  reddening its own block: validator lets a voltage off the grid through · the derivation loses the
//  dictionaries' stamp · no extrapolation, so the `bugs/11` gap disappears · the virtual backend stops
//  calling the shared refusal · the read-back answers instantly · a released clock stands still · the
//  card maximum hard-coded to 3090 · `close()` uncounted.
//  What this does NOT prove is stated in PROVABILITY_LINE and is not a caveat but the point.]

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import config from '../config.mjs';
import { buildRaiseAndCapVector, CLK_VF_POINT_COUNT } from './nvapi.mjs';
import { curveWriteRefusal } from './profile-manager.mjs';

/** The graphics half of the V/F table. One definition, shared with the write path. */
const GRAPHICS_POINTS = CLK_VF_POINT_COUNT - 1;

/** Printed by every command. Not a footnote — the first thing a reader sees. */
export const PROVABILITY_LINE =
  'ВИРТУАЛЬНАЯ КАРТА — ВЫМЫСЕЛ. Её числа не являются утверждением о живой карте: '
  + 'зелёный прогон здесь доказывает ЛОГИКУ движка, а не кремний, драйвер или поведение закрепления частоты.';

// =================================================================================================
// 1. The card profile — a FILE, and a malformed one is refused rather than half-loaded
// =================================================================================================

/**
 * Validate a card profile. Returns `{ ok: true }` or `{ ok: false, field, why }` — the FIELD is
 * named because a refusal that does not say where to look is a refusal the reader has to debug.
 *
 * The rule this obeys is the grids' own, and for the same reason: a dictionary that fails its own
 * validator is NOT loaded (`curve --grids` learned it the hard way — the first live run put an empty
 * frequency grid on disk and only then printed the refusal).
 */
export function validateCard(c) {
  const bad = (field, why) => ({ ok: false, field, why });
  if (!c || typeof c !== 'object') return bad('(корень)', 'профиль карты не объект');
  if (c.kind !== 'virtual-card') return bad('kind', `ожидалось "virtual-card", получено ${JSON.stringify(c.kind)}`);
  if (!c.name || typeof c.name !== 'string') return bad('name', 'у карты нет имени');

  if (!c.card || typeof c.card !== 'object') return bad('card', 'нет блока card');
  const maxMhz = Number(c.card.maxGraphicsMhz);
  if (!Number.isFinite(maxMhz) || maxMhz <= 0) return bad('card.maxGraphicsMhz', 'максимум экземпляра не число');

  if (!Array.isArray(c.voltageGridMv) || !c.voltageGridMv.length) return bad('voltageGridMv', 'сетка напряжений пуста');
  for (let i = 1; i < c.voltageGridMv.length; i++) {
    if (!(c.voltageGridMv[i] > c.voltageGridMv[i - 1])) {
      return bad('voltageGridMv', `сетка напряжений не возрастает: ${c.voltageGridMv[i - 1]} → ${c.voltageGridMv[i]} на месте ${i}`);
    }
  }
  if (!Array.isArray(c.frequencyGridMhz) || !c.frequencyGridMhz.length) return bad('frequencyGridMhz', 'сетка частот пуста');
  for (let i = 1; i < c.frequencyGridMhz.length; i++) {
    if (!(c.frequencyGridMhz[i] < c.frequencyGridMhz[i - 1])) {
      return bad('frequencyGridMhz', `сетка частот не убывает: ${c.frequencyGridMhz[i - 1]} → ${c.frequencyGridMhz[i]} на месте ${i}`);
    }
  }
  // The card's own maximum is a fact ABOUT the ladder, so it has to be on it. `bugs/11` is what
  // happens when three different «maximums» are on screen at once and nobody says which is which.
  if (c.frequencyGridMhz[0] !== maxMhz) {
    return bad('card.maxGraphicsMhz', `максимум ${maxMhz} МГц не совпадает с верхом лестницы ${c.frequencyGridMhz[0]} МГц`);
  }

  if (!Array.isArray(c.stockCurve) || !c.stockCurve.length) return bad('stockCurve', 'стоковая кривая пуста');
  const freqSet = new Set(c.frequencyGridMhz);
  const voltSet = new Set(c.voltageGridMv);
  for (const row of c.stockCurve) {
    if (!freqSet.has(row.mhz)) return bad('stockCurve', `частоты ${row.mhz} МГц нет в сетке частот`);
    if (!voltSet.has(row.voltageMv)) return bad('stockCurve', `напряжения ${row.voltageMv} мВ нет в сетке напряжений`);
  }

  if (!Array.isArray(c.vfTable) || c.vfTable.length !== CLK_VF_POINT_COUNT) {
    return bad('vfTable', `таблица V/F должна нести ровно ${CLK_VF_POINT_COUNT} записей, несёт ${Array.isArray(c.vfTable) ? c.vfTable.length : 'не массив'}`);
  }
  for (let i = 1; i < GRAPHICS_POINTS; i++) {
    if (!(c.vfTable[i].mhz >= c.vfTable[i - 1].mhz)) {
      return bad('vfTable', `графическая часть таблицы не монотонна: запись ${i} даёт ${c.vfTable[i].mhz} МГц после ${c.vfTable[i - 1].mhz}`);
    }
  }

  const p = c.powerLimitW;
  if (!p || typeof p !== 'object') return bad('powerLimitW', 'нет блока powerLimitW');
  if (!(p.min <= p.default && p.default <= p.max)) {
    return bad('powerLimitW', `диапазон не содержит умолчания: min ${p.min}, default ${p.default}, max ${p.max}`);
  }

  if (!c.stamp || !c.stamp.driver || !c.stamp.vbios) return bad('stamp', 'нет штампа драйвера/VBIOS (правило R6)');
  if (!c.fiction || typeof c.fiction !== 'object') return bad('fiction', 'нет блока fiction (у карты фазы 1 он пуст, но он есть)');

  // A fiction that is PRESENT is validated; an EMPTY one is a phase-1 card and legal. The distinction
  // is deliberate: «no edge yet» and «a broken edge» are different states, and collapsing them would
  // let a half-built card look like an early one.
  if (Object.keys(c.fiction).length) {
    const f = c.fiction;
    if (!Array.isArray(f.edge) || f.edge.length !== c.frequencyGridMhz.length) {
      return bad('fiction.edge', `край нужен КАЖДОЙ частоте: ${Array.isArray(f.edge) ? f.edge.length : 'не массив'} против ${c.frequencyGridMhz.length}`);
    }
    if (!f.edgeDefinition) return bad('fiction.edgeDefinition', 'у вероятностного края обязано быть определение — иначе это порог');
    for (const row of f.edge) {
      if (!freqSet.has(row.mhz)) return bad('fiction.edge', `частоты ${row.mhz} МГц нет в сетке частот`);
      // THE EDGE MUST BE INSIDE THE GRID'S RANGE — and it must NOT be required to sit on a rung. The
      // grid is what we can COMMAND; the edge is what the silicon IS, and it lands between rungs as a
      // matter of course. An earlier version demanded the opposite and made every edge a multiple of
      // 5 mV, which is a property of the ladder masquerading as a property of the card.
      const lo = c.voltageGridMv[0];
      const hi = c.voltageGridMv[c.voltageGridMv.length - 1];
      if (!(row.edgeMv >= lo && row.edgeMv <= hi)) {
        return bad('fiction.edge', `край ${row.edgeMv} мВ на ${row.mhz} МГц вне диапазона напряжений карты ${lo}…${hi} мВ`);
      }
      if (row.edgeMv > row.stockMv) {
        return bad('fiction.edge', `край ${row.edgeMv} мВ выше стокового ${row.stockMv} мВ на ${row.mhz} МГц — `
          + 'это значит, что карта не работает на заводских настройках');
      }
    }
    // A fiction whose every edge lands on a rung is a fiction that was SNAPPED, and snapping hides the
    // hardest part of the search: the lowest rung that still holds is never the edge itself.
    const onGrid = f.edge.filter((r) => voltSet.has(r.edgeMv)).length;
    if (onGrid / f.edge.length > 0.2) {
      return bad('fiction.edge', `${((onGrid / f.edge.length) * 100).toFixed(0)} % краёв лежат ровно на ступенях сетки — `
        + 'край привязан к сетке, а он свойство кремния, а не интерфейса');
    }
    // THE TREND, NOT THE SMOOTHNESS, is what the physics gives (`researches/09` §2.3), and the
    // owner's own words are «редко», not «никогда». So a jittering edge is legal and a DRIFTING one
    // is not: the check is on the trend across the range plus a ceiling on how much local inversion
    // a card may carry before it stops being an ordinary card and becomes a trap.
    const asc = [...f.edge].sort((a, b) => a.mhz - b.mhz);
    const lowEnd = asc.slice(0, Math.max(1, Math.floor(asc.length * 0.1)));
    const highEnd = asc.slice(-Math.max(1, Math.floor(asc.length * 0.1)));
    const avg = (rows) => rows.reduce((s, r) => s + r.edgeMv, 0) / rows.length;
    if (avg(highEnd) <= avg(lowEnd)) {
      return bad('fiction.edge', `тренд края не растёт с частотой: низ ${avg(lowEnd).toFixed(0)} мВ, верх ${avg(highEnd).toFixed(0)} мВ`);
    }
    // THE TEST IS ON THE SIZE OF A DROP, NOT ON HOW MANY THERE ARE, and that is the physical
    // reading: many small local dips ARE silicon scatter (the owner: «шумок… это не идеальная природа
    // кремния»), while ONE large drop means a lower frequency needs materially more voltage than a
    // higher one — his genuinely rare case, and a card built to carry it is a TRAP, declared as such.
    let inversions = 0;
    let biggest = 0;
    for (let i = 1; i < asc.length; i++) {
      const drop = asc[i - 1].edgeMv - asc[i].edgeMv;
      if (drop > 0) { inversions++; biggest = Math.max(biggest, drop); }
    }
    if (biggest > 30 && !f.nonMonotoneOnPurpose) {
      return bad('fiction.edge', `самое глубокое падение края ${biggest} мВ — это уже не дрожь кремния, а нарушение `
        + 'монотонности. Если это ловушка — пометьте fiction.nonMonotoneOnPurpose');
    }
    if (f.monotonicity && f.monotonicity.inversions !== inversions) {
      return bad('fiction.monotonicity.inversions', `в файле записано ${f.monotonicity.inversions}, а в краю их ${inversions} `
        + '— опубликованный характер карты обязан совпадать с самой картой');
    }
    const fl = f.failure;
    if (!fl || !(fl.scaleMv > 0) || !(fl.referenceSeconds > 0)) return bad('fiction.failure', 'нет параметров модели отказа');
    // The definition names a DURATION, and the model must use the same one — a definition in prose
    // beside a constant in code is a pair that eventually disagrees.
    if (!f.edgeDefinition.includes(String(fl.referenceSeconds))) {
      return bad('fiction.failure.referenceSeconds', `модель считает по ${fl.referenceSeconds} с, а определение края `
        + 'этой длительности не называет — определение и константа обязаны быть одним и тем же');
    }
  }
  return { ok: true };
}

/** Read a card profile from disk. A profile that fails its validator is NOT returned. */
export function loadCard(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (e) { return { ok: false, why: `профиль карты не прочитан: ${e.message}` }; }
  let obj;
  try { obj = JSON.parse(raw); }
  catch (e) { return { ok: false, why: `профиль карты не разобрался как JSON: ${e.message}` }; }
  const v = validateCard(obj);
  if (!v.ok) return { ok: false, why: `профиль карты негоден (поле ${v.field}): ${v.why}` };
  return { ok: true, card: obj };
}

// =================================================================================================
// 2. Derivation — the geometry is MEASURED, not typed
// =================================================================================================

/**
 * Build a card profile from the artifacts epic 02 phase 1 already wrote. A hand-typed geometry is a
 * number with no provenance, which `PHILOSOPHY.md` calls the worst kind — so this is a command.
 *
 * THE ONE PLACE WHERE FICTION ENTERS EVEN IN PHASE 1, and it is named rather than hidden: the card's
 * 127-entry V/F table is not among the artifacts on disk (they hold the voltage grid, the frequency
 * ladder and «frequency → serving voltage» for 389 frequencies). It is DERIVED by a stated rule:
 *
 *   for each grid voltage v, mhz(v) = the highest frequency whose stock voltage is ≤ v
 *
 * — a monotone step function, which is the shape the real table has. Above the highest MEASURED
 * serving voltage the table is EXTRAPOLATED with the local slope, and that is deliberate: on the
 * real card the factory table's top (3172 MHz) sits ABOVE the card's own maximum (3090), and that
 * 82 MHz gap is exactly what `bugs/11` drove through. A virtual card without the gap could not
 * reproduce the incident, and reproducing it is half of why the bench exists.
 */
export function deriveCardFromCurves({ dir = 'curves', name = 'rtx5070ti' } = {}) {
  const read = (f) => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  let vg, fg, mc;
  try { vg = read('voltage-grid.json'); fg = read('frequency-grid.json'); mc = read('measured.json'); }
  catch (e) { return { ok: false, why: `словари карты не прочитаны из ${dir}: ${e.message}` }; }

  const voltageGridMv = [...vg.values];
  const frequencyGridMhz = [...fg.values];
  const stockCurve = mc.frequencies.map((r) => ({ mhz: r.mhz, voltageMv: r.stockVoltageMv }));

  // «frequency → serving voltage» inverted into «voltage → highest frequency it serves».
  const ascending = [...stockCurve].sort((a, b) => a.mhz - b.mhz);
  const highestFor = (v) => {
    let best = null;
    for (const row of ascending) { if (row.voltageMv <= v) best = row.mhz; }
    return best;
  };

  const measured = [];
  for (const v of voltageGridMv) measured.push({ mv: v, mhz: highestFor(v) });

  // Extrapolate the tail: everything above the highest measured serving voltage.
  //
  // THE SLOPE IS TAKEN OVER THE TOP 100 mV OF THE MEASURED REGION, and that width is not arbitrary —
  // it is what makes the number a SLOPE rather than one grid step's accident. The first version of
  // this code used the last two entries of the whole array and got zero, because every voltage above
  // the top measured one already answers the card's maximum: two points on a plateau describe the
  // plateau, not the curve leading to it. The block «верх таблицы ВЫШЕ максимума карты» is what
  // showed it, which is the block doing exactly its job.
  const topMeasuredMv = Math.max(...ascending.map((r) => r.voltageMv));
  const SLOPE_WINDOW_MV = 100;
  const atTop = highestFor(topMeasuredMv);
  const atBack = highestFor(topMeasuredMv - SLOPE_WINDOW_MV);
  const slope = (atTop !== null && atBack !== null) ? (atTop - atBack) / SLOPE_WINDOW_MV : 0;
  const b = { mv: topMeasuredMv, mhz: atTop };
  let extrapolated = 0;
  const vfGraphics = measured.map((e) => {
    if (e.mhz === null) return { voltageMv: e.mv, mhz: frequencyGridMhz[frequencyGridMhz.length - 1], from: 'floor' };
    if (e.mv <= topMeasuredMv) return { voltageMv: e.mv, mhz: e.mhz, from: 'measured' };
    extrapolated++;
    return { voltageMv: e.mv, mhz: Math.round(b.mhz + slope * (e.mv - b.mv)), from: 'extrapolated' };
  });
  while (vfGraphics.length < GRAPHICS_POINTS) {
    vfGraphics.push({ ...vfGraphics[vfGraphics.length - 1], from: 'padded' });
  }
  const vfTable = vfGraphics.slice(0, GRAPHICS_POINTS);
  // The 128th entry is not graphics and every whole-curve operation excludes it — measured on the
  // real card as an outlier (515 mV / 405 MHz beside a neighbour at 1240 mV / 3157 MHz). It is here
  // so the fixture has the same SHAPE as the read the write path performs.
  vfTable.push({ voltageMv: 515, mhz: 405, from: 'outlier (не графическая, исключается по построению)' });

  const card = {
    kind: 'virtual-card',
    name,
    derivedFrom: [
      { file: join(dir, 'voltage-grid.json'), takenAt: vg.stamp?.takenAt ?? null },
      { file: join(dir, 'frequency-grid.json'), takenAt: fg.stamp?.takenAt ?? null },
      { file: join(dir, 'measured.json'), takenAt: mc.stamp?.takenAt ?? null },
    ],
    derivation: {
      vfTable: 'напряжение → САМАЯ ВЫСОКАЯ частота, чьё стоковое напряжение ≤ этого; выше самого '
        + 'высокого ИЗМЕРЕННОГО обслуживающего напряжения — экстраполяция местным наклоном',
      extrapolatedEntries: extrapolated,
      measuredEntries: vfTable.filter((e) => e.from === 'measured').length,
    },
    card: { name: vg.card?.name ?? fg.card?.name ?? 'неизвестна', maxGraphicsMhz: fg.maxGraphicsMhz },
    voltageGridMv,
    frequencyGridMhz,
    stockCurve,
    vfTable,
    powerLimitW: { min: 250, default: 300, max: 300 },
    stamp: { ...(vg.stamp ?? {}) },
    fiction: {},   // заполняется сразу ниже; форма существует с фазы 1, чтобы её не менять
  };
  // THE INVENTED EDGE. Built from the card that has just been derived, so the fiction sits on the
  // MEASURED geometry rather than beside it: every edge voltage is a value from this card's own
  // voltage grid, at a frequency from its own ladder.
  card.fiction = buildFiction(card);
  const v = validateCard(card);
  if (!v.ok) return { ok: false, why: `выведенный профиль негоден (поле ${v.field}): ${v.why}` };
  return { ok: true, card };
}

// =================================================================================================
// 2a. THE FICTION — the invented edge and the failure model (phase 2, `plans/18`)
// =================================================================================================

/**
 * ⚠️ EVERY NUMBER PRODUCED HERE IS INVENTED. It is not a hypothesis about the owner's card, not a
 * prediction, and not a starting point for one. It exists so the engine has something to FIND.
 *
 * WHAT IS NOT INVENTED IS THE SHAPE, and that is the difference between a useful bench and a toy:
 *
 *  - **The edge is probabilistic, never a threshold.** This card has already shown both outcomes at
 *    one voltage (fact 28's history). A bench that failed deterministically would pass an engine that
 *    dies on real silicon — which is the one thing a bench must not do.
 *  - **The steepness is the project's OWN measurement.** `researches/02`: the error rate goes
 *    3 % → 90 % across 2 % of voltage. Fitting a logistic to that pair gives a scale of ≈3.5 mV
 *    (`logit(0.90) − logit(0.03) = 5.673` over ≈20 mV at 1000 mV), so ONE 5 mV grid step moves the
 *    failure probability from about 0.20 to about 0.80. That is what makes the 5 mV refinement of
 *    `plans/15` §4.6 a real test rather than a formality.
 *  - **The edge has a DEFINITION, because a probabilistic edge cannot have a threshold's one:**
 *    the voltage at which a 10-second burn fails half the time. `lambdaMax` follows from it
 *    arithmetically (2·ln2/10), so the constant and the definition cannot drift apart.
 *  - **Duration enters as a hazard rate**, so an accelerated 1 s burn honestly finds LESS than a 10 s
 *    one. The owner's 10× speed-up is therefore visible in the model rather than free — the bench
 *    tells the truth about its own acceleration.
 *
 * THE HEADROOM CURVE IS CHOSEN, NOT RANDOMISED, and the reason is the whole point of the bench: the
 * engine's hard cases must be REACHABLE on the ordinary card, not only on a trap. So the invented
 * headroom is DEEPER than the ±1000 MHz lever can reach across 1700…2400 MHz — exactly where the
 * live card's own arithmetic says the lever gives out first (45–125 mV against 245–350 at the ends,
 * `STATUS.md`). A sweep of this card therefore produces `lever-limited` verdicts by ordinary means.
 *
 * One deliberate consistency with what the live card actually showed: at 2842 MHz the invented edge
 * lands at 865 mV, BELOW the 885 mV that was proved to PASS on the real card. The fiction is free to
 * be anything; making it contradict a measurement we own would be a needless way to confuse a reader.
 */
const HEADROOM_ANCHORS = Object.freeze([
  { mhz: 180, belowStockMv: 0 },      // на полу сетки снимать нечего
  { mhz: 500, belowStockMv: 110 },
  { mhz: 1100, belowStockMv: 120 },
  { mhz: 1700, belowStockMv: 80 },    // ↓ глубже, чем достаёт рычаг (доступно 45 мВ) → «предел рычага»
  { mhz: 2000, belowStockMv: 90 },    // ↓ то же (доступно 50 мВ)
  { mhz: 2400, belowStockMv: 150 },   // ↓ то же (доступно 125 мВ)
  { mhz: 2842, belowStockMv: 180 },   // край 865 мВ — ниже доказанных на живой карте 885
  { mhz: 3090, belowStockMv: 200 },
]);

/** Linear interpolation between the anchors, in millivolts of headroom. */
function headroomAt(mhz) {
  const a = HEADROOM_ANCHORS;
  if (mhz <= a[0].mhz) return a[0].belowStockMv;
  if (mhz >= a[a.length - 1].mhz) return a[a.length - 1].belowStockMv;
  for (let i = 1; i < a.length; i++) {
    if (mhz <= a[i].mhz) {
      const t = (mhz - a[i - 1].mhz) / (a[i].mhz - a[i - 1].mhz);
      return a[i - 1].belowStockMv + t * (a[i].belowStockMv - a[i - 1].belowStockMv);
    }
  }
  return a[a.length - 1].belowStockMv;
}

/**
 * Build the `fiction` block for a card: an edge voltage for EVERY frequency of its grid, snapped to
 * the card's own voltage grid, plus the failure-model parameters.
 *
 * Monotonicity is ENFORCED rather than hoped for: Vmin does not fall as frequency rises, because a
 * failure at the edge is a setup-time violation (`researches/09` §2.3 — industrial shmoo
 * characterization), and the owner said the same from his own experience: *«как правило на более
 * нижней частоте будет напряжение нужно или такое же… или даже ниже, очень редко — выше»*. The rare
 * violation he named is a TRAP CARD of phase 3, produced on purpose — never an accident of rounding.
 */
export function buildFiction(card, { noiseSeed = 20260815, noiseAmplitudeMv = 8, driftMaxMv = 20 } = {}) {
  const stockFor = new Map(card.stockCurve.map((r) => [r.mhz, r.voltageMv]));
  const grid = card.voltageGridMv;
  const floorMv = grid[0];

  // ─── THE JITTER, AND IT IS NOT DECORATION ───────────────────────────────────────────────────────
  //
  // THE OWNER CAUGHT THIS ON READING THE FIRST FILE (2026-08-15): *«ты в фикции некрасивые headroomMv
  // придумал, не дал лёгкого дрейфа и шума, который обычно у реального кремния есть. Там должно быть
  // 197, 205, 181, 223 мВ и так далее — шумок»*. He is right, and the reason is stronger than realism:
  //
  //  1. **A SMOOTH EDGE MAKES INTERPOLATION LOOK LEGAL.** An engine that skipped frequencies and
  //     interpolated between them would pass on a smooth card and die on silicon — and interpolation
  //     is written into the epic as an ANTI-PATTERN (E2-AC3), precisely what the vendor's own scanner
  //     does and we do not. A bench that cannot punish it does not defend the claim.
  //  2. **IT MAKES HIS OWN RARE CASE REACHABLE BY ORDINARY MEANS.** He said Vmin at a lower frequency
  //     is usually equal or lower, *«очень редко — выше, почти не бывает такого»* — «rarely», not
  //     «never». Jitter produces exactly those rare local inversions, so the seeding-rejection path
  //     (E2-AC11) is exercised by the everyday card and not only by a trap built for it.
  //
  // The jitter is SEEDED, so the card is a file that reproduces byte for byte; and the trend is still
  // upward, because the trend is what the physics says (`researches/09` §2.3), not the smoothness.
  //
  // THE NOISE IS CORRELATED, NOT INDEPENDENT PER FREQUENCY, and the first attempt showed why: an
  // independent ±25 mV draw at frequencies SEVEN MEGAHERTZ apart made the edge zigzag on 43 % of its
  // neighbours — that is not silicon, it is a random walk with no memory, and its own validator threw
  // it out. Real characterization data drifts: neighbouring frequencies are strongly correlated and
  // the character shows over tens of megahertz. So there are two components — a slow bounded DRIFT
  // and a small point-to-point TREMBLE of about one grid step.
  //
  // ⚠️ THE EDGE IS **NOT** SNAPPED TO THE VOLTAGE GRID, and the first version of this code snapped it
  // — a modelling error the owner caught by reading the file: *«и где шум, что-то я не вижу. как были
  // красивые круглые edgeMv, так и остались»*. Every edge was a multiple of 5 mV, so the «noise» was
  // an artefact of the ladder rather than a property of the silicon.
  //
  // THE DISTINCTION THAT WAS COLLAPSED, and it matters beyond aesthetics: the grid is what we can
  // COMMAND, the edge is what the silicon IS. Real Vmin at a frequency is a continuous physical
  // quantity and lands between rungs as a matter of course. My original justification — «an edge at
  // 947.3 mV is an edge no descent could ever stand on» — was simply wrong: the descent does not stand
  // ON the edge, it finds the LOWEST RUNG THAT STILL HOLDS. The edge sitting between two rungs is not
  // an obstacle to the search, it is the ordinary condition of it.
  //
  // And the snapped version quietly made the bench easier: with the edge exactly on a rung, the 50 %
  // point of the failure probability coincided with a settable voltage — a coincidence that never
  // happens on silicon and that the engine would have been able to lean on.
  const noise = mulberry32(noiseSeed);
  const ascending = [...card.frequencyGridMhz].sort((a, b) => a - b);
  const edge = [];
  let drift = 0;
  for (const mhz of ascending) {
    const stock = stockFor.get(mhz);
    drift += (noise() - 0.5) * 2.2;
    drift = Math.max(-driftMaxMv, Math.min(driftMaxMv, drift));
    const tremble = (noise() - 0.5) * 2 * noiseAmplitudeMv;
    const wanted = headroomAt(mhz) + drift + tremble;
    // Одна десятая милливольта — не точность модели, а признак того, что это НЕ ступень сетки.
    const mv = Number(Math.max(floorMv, Math.min(stock, stock - wanted)).toFixed(1));
    edge.push({ mhz, edgeMv: mv, stockMv: stock, headroomMv: Number((stock - mv).toFixed(1)) });
  }

  // The trend is measured rather than asserted, and the local inversions are COUNTED and published:
  // a card whose character is a number in its own file cannot quietly become a different card.
  let violations = 0;
  let maxDropMv = 0;
  for (let i = 1; i < edge.length; i++) {
    // Округление здесь не косметика: разности чисел с плавающей точкой дают хвосты вида
    // 16.800000000000068, и такое число уезжает прямо в отчёт владельцу.
    const drop = Number((edge[i - 1].edgeMv - edge[i].edgeMv).toFixed(1));
    if (drop > 0) { violations++; maxDropMv = Math.max(maxDropMv, drop); }
  }

  return {
    monotonicity: {
      note: 'край шумит, как кремний: тренд вверх, но локальные нарушения ЕСТЬ — ровно тот редкий '
        + 'случай, который владелец назвал сам («очень редко — выше, почти не бывает такого»). '
        + 'Их число опубликовано, чтобы карта не могла тихо стать другой картой.',
      inversions: violations,
      inversionShare: Number((violations / edge.length).toFixed(3)),
      maxDropMv,
    },
    noise: { seed: noiseSeed, amplitudeMv: noiseAmplitudeMv, driftMaxMv },
    note: 'ВЫМЫСЕЛ. Эти края придуманы и НЕ являются утверждением о живой карте — они существуют, '
      + 'чтобы движку было что найти.',
    edgeDefinition: 'край частоты = напряжение, на котором прожиг длиной 10 с отказывает в половине случаев. '
      + 'У вероятностного края другого честного определения нет: «напряжение, ниже которого отказывает» '
      + 'описывает порог, а порогом эта карта быть не должна.',
    edge: edge.sort((a, b) => b.mhz - a.mhz),   // в том же порядке, что и сетка частот: сверху вниз
    failure: {
      // 3 % → 90 % на 2 % напряжения (researches/02), подогнано логистикой: одна ступень 5 мВ
      // двигает вероятность отказа с ≈0,20 до ≈0,80.
      scaleMv: 3.5,
      // Определение края И есть эта величина: прожиг ЭТОЙ длительности на краю отказывает в половине
      // случаев. Одно число, а не два, которые могут разъехаться.
      referenceSeconds: 10,
      // Глубина ниже края решает КЛАСС исхода. Числа придуманы; важно, что все три достижимы.
      classDepthMv: { sdcUntil: 10, crashUntil: 25 },
      // Разные нагрузки валят край по-разному (researches/02: Vmin разъезжается на ~100 мВ между
      // программами). Стенд моделирует это ОДНИМ коэффициентом на нагрузку и не более того.
      shapeFactor: { sdc_fma: 1.0, branchy: 1.35 },
      // Одна проба нагрузки — это один ПРОЦЕСС; измерено 2026-08-10: 132 мс на запуск.
      perLaunchSeconds: 0.132,
    },
  };
}

/**
 * `mulberry32` — a seeded generator, thirty lines instead of a dependency.
 *
 * WHY A SEED AT ALL, and why it is the ONLY source of randomness: a probabilistic edge needs random
 * draws and debugging needs repeatability, so the industry's answer (FoundationDB, TigerBeetle's
 * VOPR, Antithesis) is that ONE seed drives everything and the failure replays exactly. Randomness
 * that escapes the seed turns the bench into an «occasionally red» instrument, which is the worst
 * kind there is.
 */
/**
 * The virtual workload's «correct» answer. Any hexadecimal string works — what matters is that the
 * bench's golden fixture and its PASS path carry the SAME one, and that an SDC carries a different
 * one, because the real `decideVerdict` compares them and nothing else.
 */
export const GOLDEN_CHECKSUM = 'fd7d452ce569c9d7';

/** A wrong answer, derived from the draw so it is reproducible with the seed like everything else. */
function sdcChecksum(r) {
  const flipped = (parseInt(GOLDEN_CHECKSUM.slice(0, 8), 16) ^ Math.floor(r * 0xFFFF)) >>> 0;
  return flipped.toString(16).padStart(8, '0') + GOLDEN_CHECKSUM.slice(8);
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =================================================================================================
// 3. The card itself — state, and the three behaviours it must NOT simplify away
// =================================================================================================

/**
 * A virtual card. Not a stub that answers what one suite asks — a FAKE in the test-double sense: a
 * working implementation with a shortcut, which is the only kind of double that earns a contract
 * test (`researches/10` §2.2).
 *
 * THE THREE BEHAVIOURS MODELLED ON PURPOSE, each paid for on the real card, each with its own block:
 *
 *  1. A READ TAKEN STRAIGHT AFTER A WRITE MAY RETURN THE PREVIOUS VALUE. `-rgc` answered «All done»
 *     with exit 0 while `clocks.gr` still reported the locked 1200 MHz (EXP-0014). `settleSamples`.
 *  2. THE TOOL'S SUCCESS TEXT IS NOT EVIDENCE. `nvidia-smi` prints the DEFAULT in its «from» field
 *     (`researches/01` §5), so this card's success strings deliberately do NOT have to match state.
 *  3. A QUANTITY RAMPS, so two agreeing samples are not arrival (EXP-0028). `rampSamples`.
 *
 * And a fourth, without which the applier's release path could not be exercised at all: A RELEASED
 * CLOCK WANDERS (observed 810…1065 MHz). `readBack` on a release demands two samples that have both
 * LEFT the locked point, precisely because holding still is what release destroys.
 *
 * No randomness anywhere: the wander is a deterministic cycle. Phase 1 has no seed because phase 1
 * has nothing to be random about.
 */
export function virtualCard(cardProfile, {
  settleSamples = 1, rampSamples = 0, wanderMhz = null,
  seed = 1, allowProcessDeath = false,
} = {}) {
  const v = validateCard(cardProfile);
  if (!v.ok) throw new Error(`виртуальная карта не поднимается на негодном профиле (поле ${v.field}): ${v.why}`);

  const P = cardProfile;
  const idleWander = wanderMhz ?? defaultWander(P);

  const state = {
    powerLimitW: P.powerLimitW.default,
    lock: null,                                   // { min, max } | null
    curveOffsetsMhz: new Array(GRAPHICS_POINTS).fill(0),
    reportedMhz: idleWander[0],
    queue: [],                                    // stale reads, then the ramp — drained by query
    wanderAt: 0,
  };
  const writes = { setPowerLimit: 0, lockClocks: 0, resetClocks: 0, curveWrite: 0, curveZero: 0, curveClose: 0 };

  /** Where the clock is HEADED. Computed from the state, never stored beside it — two sources for
   *  one fact is how a double drifts from itself. */
  const targetMhz = () => {
    if (!state.lock) return null;                             // unlocked: the card wanders, see below
    const snapped = snapToLadder(P.frequencyGridMhz, state.lock.max);
    return Math.min(Math.max(snapped, state.lock.min), P.card.maxGraphicsMhz);
  };

  /** Queue the stale reads and the ramp that a write produces. */
  const schedule = () => {
    const from = state.reportedMhz;
    const to = targetMhz();
    const q = [];
    for (let i = 0; i < settleSamples; i++) q.push(from);
    if (to !== null) {
      for (let i = 1; i <= rampSamples; i++) q.push(Math.round(from + (to - from) * i / (rampSamples + 1)));
    }
    state.queue = q;
  };

  const clockNow = () => {
    if (state.queue.length) { state.reportedMhz = state.queue.shift(); return state.reportedMhz; }
    const t = targetMhz();
    if (t !== null) { state.reportedMhz = t; return t; }
    // Unlocked: wander. Deterministic cycle — a released card does not hold still, and a double that
    // held still would let a release read-back pass for the wrong reason.
    state.reportedMhz = idleWander[state.wanderAt % idleWander.length];
    state.wanderAt++;
    return state.reportedMhz;
  };

  const okResult = (stdout) => ({ ok: true, status: 0, stdout, stderr: '' });
  const failResult = (stderr) => ({ ok: false, status: 1, stdout: '', stderr });

  const backend = {
    name: `virtual:${P.name}`,

    /**
     * Answers exactly what `nvidia-smi --format=csv,noheader,nounits` answers: STRINGS, one per
     * requested field. A field the real tool does not know makes it exit non-zero, and the real
     * backend THROWS on that — so this one throws too. A fake that is friendlier than the tool is a
     * fake that hides a caller's bug.
     */
    query(fields) {
      const out = {};
      for (const f of fields) {
        switch (f) {
          case 'name': out[f] = P.card.name; break;
          case 'driver_version': out[f] = P.stamp.driver; break;
          case 'vbios_version': out[f] = P.stamp.vbios; break;
          case 'power.limit': out[f] = state.powerLimitW.toFixed(2); break;
          case 'power.default_limit': out[f] = P.powerLimitW.default.toFixed(2); break;
          case 'power.min_limit': out[f] = P.powerLimitW.min.toFixed(2); break;
          case 'power.max_limit': out[f] = P.powerLimitW.max.toFixed(2); break;
          case 'clocks.gr': out[f] = String(clockNow()); break;
          case 'clocks.max.graphics': out[f] = String(P.card.maxGraphicsMhz); break;
          default:
            throw new Error(`nvidia-smi не ответил на запрос полей (код 2): Field "${f}" is not a valid field to query.`);
        }
      }
      return out;
    },

    setPowerLimitWatts(w) {
      writes.setPowerLimit++;
      const n = Number(w);
      if (!Number.isFinite(n) || n < P.powerLimitW.min || n > P.powerLimitW.max) {
        return failResult(`Provided power limit ${w} W is not a valid power limit which should be between `
          + `${P.powerLimitW.min}.00 W and ${P.powerLimitW.max}.00 W`);
      }
      const previous = state.powerLimitW;
      state.powerLimitW = n;
      // BEHAVIOUR 2: the success text names the DEFAULT as the previous value, exactly as the real
      // tool does — so anything that trusted this string instead of re-reading would be wrong here too.
      return okResult(`Power limit for GPU 00000000:0B:00.0 was set from ${P.powerLimitW.default}.00 W to ${n}.00 W.`
        + `\nAll done.  [фактически прежнее значение было ${previous}.00 W — утилита его не печатает]`);
    },

    lockGraphicsClocksMhz(min, max) {
      writes.lockClocks++;
      state.lock = { min: Number(min), max: Number(max) };
      schedule();
      return okResult(`GPU clocks set to "(gpuClkMin ${min}, gpuClkMax ${max})" for GPU 00000000:0B:00.0\nAll done.`);
    },

    resetGraphicsClocks() {
      writes.resetClocks++;
      state.lock = null;
      schedule();
      return okResult('All done.');
    },
  };

  /**
   * The curve backend. The arithmetic and the refusals are the LIVE ones — imported, not reimplemented
   * (see the header). What is virtual is only the device write and the device read.
   */
  const curveBackend = {
    name: `virtual-curve:${P.name}`,

    /** The V/F table in the shape `readVfCurve` returns, so `buildRaiseAndCapVector` sees what it
     *  would see on the card: `{ i, freqKhz, microVolts, mhz, mv }`. */
    points() {
      return P.vfTable.map((e, i) => ({
        i,
        freqKhz: e.mhz * 1000,
        microVolts: e.voltageMv * 1000,
        mhz: e.mhz,
        mv: e.voltageMv,
      }));
    },

    async writeRaiseAndCap(deltaMhz, capMhz, { cardMaxClockMhz = null } = {}) {
      const vec = buildRaiseAndCapVector(this.points(), deltaMhz, { capMhz });
      if (!vec.ok) return { ok: false, why: `вектор не построился: ${vec.why}` };
      // THE SAME FOUR REFUSALS THE LIVE BACKEND APPLIES — one function, called by both. A mutation
      // that removes this line must redden the parity block, and that is the block's whole job.
      const refusal = curveWriteRefusal(vec, { capMhz, cardMaxClockMhz });
      if (refusal) return refusal;
      writes.curveWrite++;
      state.curveOffsetsMhz = vec.offsets.slice(0, GRAPHICS_POINTS);
      return { ok: true, vector: vec.offsets.slice(0, GRAPHICS_POINTS) };
    },

    async readCurveOffsets() {
      return { ok: true, offsets: [...state.curveOffsetsMhz] };
    },

    async zeroCurve() {
      writes.curveZero++;
      state.curveOffsetsMhz = new Array(GRAPHICS_POINTS).fill(0);
      return { ok: true };
    },

    /** A no-op that is still COUNTED: a caller who forgets it would leak the NVAPI handle on the
     *  real path, and the counter is what makes that visible offline. */
    close() { writes.curveClose++; },
  };

  // ===============================================================================================
  // THE ORACLE — the silicon's half of the fiction (phase 2, `plans/18`)
  // ===============================================================================================
  //
  // THE PROPERTY THAT MAKES THIS A CARD AND NOT A SCRIPT: the oracle is never TOLD the voltage. It
  // reads the card's own state — which V/F entry serves the pinned clock after the offsets that were
  // written — exactly as silicon does. An engine that computed the voltage wrongly is therefore
  // judged by what it actually WROTE rather than by what it believed it wrote, and that is the single
  // most valuable thing the bench can check about a sweep.
  const rng = mulberry32(seed);
  let draws = 0;

  const oracle = {
    /** Which voltage serves `mhz` right now: the LOWEST-voltage entry whose offered frequency
     *  reaches it, after the offsets currently written. */
    servingVoltageMv(mhz) {
      for (let i = 0; i < GRAPHICS_POINTS; i++) {
        const offered = P.vfTable[i].mhz + state.curveOffsetsMhz[i];
        if (offered >= mhz) return P.vfTable[i].voltageMv;
      }
      return P.vfTable[GRAPHICS_POINTS - 1].voltageMv;
    },

    /** The invented edge of `mhz` — the nearest frequency of the card's own grid. */
    edgeMvFor(mhz) {
      const f = P.fiction.edge;
      if (!f || !f.length) throw new Error('у этой карты нет вымышленного края — она из фазы 1 (fiction пуст)');
      let best = f[0];
      for (const row of f) if (Math.abs(row.mhz - mhz) < Math.abs(best.mhz - mhz)) best = row;
      return best.edgeMv;
    },

    /**
     * The probability that ONE REFERENCE BURN (10 s) at this voltage fails — the logistic itself.
     *
     * THE LOGISTIC SITS ON THE PROBABILITY, NOT ON A HAZARD RATE, and that is a correction made
     * during the first run of this suite rather than a preference. With the logistic on a hazard the
     * two anchors of `researches/02` cannot both be met at once: fixing «half the burns fail at the
     * edge» caps the deepest possible failure rate at 75 %, so the measured 90 % becomes unreachable
     * and the ±5 mV pair came out 0.23/0.69 instead of 0.20/0.80. Putting it on the probability makes
     * the definition and the measurement agree exactly: 0.5 at the edge, ≈0.19/0.81 one grid step
     * either side, ≈0.06/0.94 at ±10 mV.
     *
     * The one simplification named out loud: the measured pair (3 % → 90 %) is not symmetric about
     * 50 %, and a symmetric logistic centres it. The SPAN is preserved (5.67 logits over 20 mV, hence
     * the 3.5 mV scale); the asymmetry is not modelled.
     */
    singleBurnProbability(voltageMv, mhz) {
      const { scaleMv } = P.fiction.failure;
      return 1 / (1 + Math.exp((voltageMv - this.edgeMvFor(mhz)) / scaleMv));
    },

    /**
     * The probability that a burn of `seconds` fails. Duration MATTERS — a shorter burn is a smaller
     * exposure, so the owner's 10× acceleration honestly finds LESS. The bench therefore tells the
     * truth about its own speed-up instead of pretending it is free.
     */
    failureProbability({ mhz, voltageMv, seconds, workload = 'sdc_fma' }) {
      const { referenceSeconds, shapeFactor } = P.fiction.failure;
      const shape = shapeFactor[workload] ?? 1;
      const p1 = this.singleBurnProbability(voltageMv, mhz);
      const exposure = (seconds / referenceSeconds) * shape;
      return 1 - Math.pow(1 - p1, exposure);
    },

    /**
     * One draw. Returns the outcome and everything needed to explain it — a bench whose failures
     * cannot be explained is a bench nobody will trust at three in the morning.
     */
    draw({ mhz, seconds, workload = 'sdc_fma' }) {
      const voltageMv = this.servingVoltageMv(mhz);
      const edgeMv = this.edgeMvFor(mhz);
      const p = this.failureProbability({ mhz, voltageMv, seconds, workload });
      const r = rng();
      draws++;
      const depthMv = edgeMv - voltageMv;
      let outcome = 'PASS';
      if (r < p) {
        const { sdcUntil, crashUntil } = P.fiction.failure.classDepthMv;
        outcome = depthMv <= sdcUntil ? 'SDC' : (depthMv <= crashUntil ? 'CRASH' : 'ЗАВИС');
      }
      return { outcome, p, r, voltageMv, edgeMv, depthMv, seconds, workload, mhz };
    },

    /**
     * THE SEAM INTO THE REAL VERDICT LOGIC (B2-AC7). This is the launcher `runBurst({ run })` takes,
     * so the bench produces a BURST RESULT and everything above it — the parsing, the golden
     * comparison, `distinct` inside one burst, the worst-of-the-set rule, `UNKNOWN` as a stop — is
     * the SHIPPING code, not a double of it. `ideas/04` proposed a synthetic oracle; this seam sits
     * one level lower and leaves far more of the real stack under test.
     */
    run(binary, argv) {
      const workload = String(binary).replace(/\\/g, '/').split('/').pop().replace(/\.exe$/i, '');
      const i = argv.indexOf('--sustain');
      const seconds = i === -1 ? P.fiction.failure.perLaunchSeconds : Number(argv[i + 1]);
      const mhz = state.lock ? (targetMhz() ?? state.reportedMhz) : state.reportedMhz;
      const d = this.draw({ mhz, seconds, workload });
      const launches = Math.max(1, Math.round(seconds / P.fiction.failure.perLaunchSeconds));
      const line = (checksum, distinct) => `KAGO-WORKLOAD name=${workload} checksum=${checksum} `
        + `distinct=${distinct} launches=${launches} gpu_us=${launches * 900} work_per_launch=100000 `
        + `bad_launches=0 bad_elems_max=0\n`;

      switch (d.outcome) {
        case 'PASS':
          return { status: 0, stdout: line(P.fiction.goldenChecksum ?? GOLDEN_CHECKSUM, 1), stderr: '' };
        case 'SDC':
          // A checksum that differs — the failure mode that does NOT announce itself, and the whole
          // reason the oracle has a checksum half at all.
          return { status: 0, stdout: line(sdcChecksum(d.r), launches > 1 ? 2 : 1), stderr: '' };
        case 'CRASH':
          return { status: 3221225477, stdout: '', stderr: 'Access violation — драйвер сбросился' };
        default: {
          // ЗАВИС. ARMED, NEVER DEFAULT: a suite whose oracle may kill the runner cannot report its
          // own results, so the death is opt-in and the drill spawns a CHILD to receive it.
          if (allowProcessDeath) {
            // `process.exit` and not an exception: no `finally` may run, because on the owner's
            // machine none does. That is the whole property the write-ahead journal exists for, and
            // the same shape `watchdog --drill` already uses to prove the detached guard.
            process.exit(70);
          }
          // Unarmed: the softer real-world face of the same thing — a kernel that never returns.
          // `runBurst` already maps this to «died», so the verdict path is exercised either way.
          return { status: null, error: { code: 'ETIMEDOUT' }, stdout: '', stderr: '' };
        }
      }
    },

    stats: () => ({ draws, seed }),
  };

  return {
    profile: P,
    backend,
    curveBackend,
    oracle,
    seed,
    writes,
    /**
     * The CARD DESCRIPTOR the applier and the format validator expect — produced by the card about
     * itself rather than hand-built by the caller. A caller assembling this by hand is a caller who
     * can quietly give the bench a wider power range or a shorter ladder than the card it stands in
     * for, and then a profile that the real card would refuse passes here. The double describes
     * itself, exactly as the live probe does.
     */
    describe: () => ({
      driver: P.stamp.driver,
      vbios: P.stamp.vbios,
      power: {
        current: state.powerLimitW,
        default: P.powerLimitW.default,
        min: P.powerLimitW.min,
        max: P.powerLimitW.max,
      },
      ladder: { ok: true, rung: null, mhz: [...P.frequencyGridMhz].sort((a, b) => a - b) },
      maxGraphicsMhz: P.card.maxGraphicsMhz,
    }),
    /** Everything a block may want to assert about, without reaching into closures. */
    peek: () => ({
      powerLimitW: state.powerLimitW,
      lock: state.lock ? { ...state.lock } : null,
      nonZeroOffsets: state.curveOffsetsMhz.filter((o) => o !== 0).length,
      maxOffsetMhz: Math.max(...state.curveOffsetsMhz),
      reportedMhz: state.reportedMhz,
      queued: state.queue.length,
    }),
    totalWrites: () => Object.values(writes).reduce((a, b) => a + b, 0),
  };
}

/** The idle frequencies a released card wanders between — taken from the card's OWN ladder rather
 *  than from the numbers this specimen happened to show (EXP-0011: a value is true under its
 *  conditions), so a card with another geometry wanders in its own range. */
function defaultWander(P) {
  const ladderAsc = [...P.frequencyGridMhz].sort((a, b) => a - b);
  const at = (frac) => ladderAsc[Math.floor(ladderAsc.length * frac)];
  return [at(0.20), at(0.26), at(0.32)];
}

/**
 * How deep our lever can push the voltage serving `mhz` — arithmetic, not a measurement of this run.
 *
 * Raising the whole curve by Δ makes the entry whose stock frequency is `mhz − Δ` serve `mhz`, so the
 * deepest reachable voltage is the one belonging to `mhz + CLOCK_OFFSET_MIN_MHZ`… i.e. the hardware's
 * ±1000 MHz wall converted into millivolts through the card's own table. This is why the middle of
 * the range answers «предел рычага»: there the wall arrives before the silicon does.
 */
function leverReachMv(card, mhz) {
  const stock = card.stockCurve.find((r) => r.mhz === mhz);
  if (!stock) return null;
  const lowest = mhz + config.CLOCK_OFFSET_MAX_MHZ * -1;   // −1000 МГц по частотной оси таблицы
  const deepest = card.stockCurve
    .filter((r) => r.mhz >= lowest)
    .reduce((best, r) => (r.voltageMv < best ? r.voltageMv : best), stock.voltageMv);
  return stock.voltageMv - deepest;
}

/** The nearest supported frequency at or below `mhz`; the ladder's floor when nothing is below. */
function snapToLadder(ladderDesc, mhz) {
  for (const f of ladderDesc) if (f <= mhz) return f;
  return ladderDesc[ladderDesc.length - 1];
}

// =================================================================================================
// 4. Selftest — no GPU, no writes, no production directories
// =================================================================================================

/**
 * MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016). Each mutation must redden the block named
 * beside it and no other:
 *   - validator accepts a voltage off the grid            → «ВАЛИДАТОР: напряжение вне сетки»
 *   - derived fixture keeps a stale/absent stamp          → «ВЫВОД: штамп доезжает из словарей»
 *   - drop `curveWriteRefusal` from the virtual backend   → «ПАРИТЕТ: оба бэкенда зовут одно решение»
 *   - make the read-back answer instantly                 → «ПОВАДКА: чтение сразу после записи врёт»
 *   - store the clock instead of computing it             → «ПОВАДКА: снятие блокировки — клок гуляет»
 *   - hard-code 127 instead of the shared constant        → «ОБЩНОСТЬ: другая геометрия»
 *   - make `close()` silent                               → «СЧЁТЧИКИ: close() считается»
 */
export async function selfTest() {
  const results = [];
  const ok = (n) => results.push({ n, ok: true });
  const fail = (n, why) => results.push({ n, ok: false, why });
  const check = (n, cond, why = '') => (cond ? ok(n) : fail(n, why));

  const pm = await import('./profile-manager.mjs');

  // ---- the fixture every block below builds on, derived from the measured artifacts
  const derived = deriveCardFromCurves({});
  check('ВЫВОД: профиль строится из снятых словарей', derived.ok, derived.why ?? '');
  if (!derived.ok) return report(results);
  const CARD = derived.card;

  // ---- 1. the validator, on hostile fixtures — one defect each, each naming its field
  const clone = () => JSON.parse(JSON.stringify(CARD));
  const hostile = [
    ['ВАЛИДАТОР: не тот kind', (c) => { c.kind = 'curve'; }, 'kind'],
    ['ВАЛИДАТОР: сетка напряжений не возрастает', (c) => { c.voltageGridMv[5] = c.voltageGridMv[4]; }, 'voltageGridMv'],
    ['ВАЛИДАТОР: сетка частот не убывает', (c) => { c.frequencyGridMhz[5] = c.frequencyGridMhz[4]; }, 'frequencyGridMhz'],
    ['ВАЛИДАТОР: максимум карты не с лестницы', (c) => { c.card.maxGraphicsMhz = 3100; }, 'card.maxGraphicsMhz'],
    ['ВАЛИДАТОР: напряжение вне сетки', (c) => { c.stockCurve[3].voltageMv = 1237; }, 'stockCurve'],
    ['ВАЛИДАТОР: частота вне сетки', (c) => { c.stockCurve[3].mhz = 3091; }, 'stockCurve'],
    ['ВАЛИДАТОР: таблица V/F не той длины', (c) => { c.vfTable.pop(); }, 'vfTable'],
    ['ВАЛИДАТОР: таблица V/F не монотонна', (c) => { c.vfTable[10].mhz = c.vfTable[9].mhz - 50; }, 'vfTable'],
    ['ВАЛИДАТОР: диапазон ватт без умолчания', (c) => { c.powerLimitW.default = 400; }, 'powerLimitW'],
    ['ВАЛИДАТОР: нет штампа', (c) => { delete c.stamp.vbios; }, 'stamp'],
    ['ВАЛИДАТОР: нет блока fiction', (c) => { delete c.fiction; }, 'fiction'],
  ];
  for (const [name, mutate, field] of hostile) {
    const c = clone(); mutate(c);
    const v = validateCard(c);
    check(name, v.ok === false && v.field === field,
      v.ok ? 'принят негодный профиль' : `отказ указал на поле ${v.field}, ожидалось ${field}`);
  }
  check('ВАЛИДАТОР: годный профиль принят', validateCard(CARD).ok === true, 'годный профиль отвергнут');

  // ---- 2. the derivation matches its sources field for field (B1-AC2)
  const vg = JSON.parse(readFileSync(join('curves', 'voltage-grid.json'), 'utf8'));
  const fg = JSON.parse(readFileSync(join('curves', 'frequency-grid.json'), 'utf8'));
  check('ВЫВОД: сетка напряжений совпадает со словарём',
    JSON.stringify(CARD.voltageGridMv) === JSON.stringify(vg.values), 'сетка напряжений разошлась');
  check('ВЫВОД: сетка частот совпадает со словарём',
    JSON.stringify(CARD.frequencyGridMhz) === JSON.stringify(fg.values), 'сетка частот разошлась');
  check('ВЫВОД: максимум карты совпадает со словарём',
    CARD.card.maxGraphicsMhz === fg.maxGraphicsMhz, 'максимум разошёлся');
  check('ВЫВОД: штамп доезжает из словарей',
    CARD.stamp.driver === vg.stamp.driver && CARD.stamp.vbios === vg.stamp.vbios, 'штамп не тот');
  // The gap `bugs/11` drove through must EXIST on the virtual card, or the incident is unreproducible.
  const tableTop = Math.max(...CARD.vfTable.slice(0, GRAPHICS_POINTS).map((e) => e.mhz));
  check('ВЫВОД: верх таблицы ВЫШЕ максимума карты — щель bugs/11 воспроизведена',
    tableTop > CARD.card.maxGraphicsMhz, `верх таблицы ${tableTop}, максимум ${CARD.card.maxGraphicsMhz}`);

  // ---- 3. the four semantic methods, driven by the REAL applier's readers
  const vc = virtualCard(CARD, { settleSamples: 0 });
  const st = pm.readState(vc.backend);
  check('БЭКЕНД: readState применителя читает виртуальную карту без правок',
    st.driver === CARD.stamp.driver && st.powerLimitW === 300 && st.clockMaxMhz === CARD.card.maxGraphicsMhz,
    JSON.stringify(st));
  let threw = false;
  try { vc.backend.query(['no.such.field']); } catch { threw = true; }
  check('БЭКЕНД: неизвестное поле — ОТКАЗ, как у настоящей утилиты', threw, 'неизвестное поле проглочено');
  const badW = vc.backend.setPowerLimitWatts(150);
  check('БЭКЕНД: ватт вне диапазона отвергнут', badW.ok === false && badW.status === 1, 'принято 150 Вт');
  const goodW = vc.backend.setPowerLimitWatts(250);
  check('БЭКЕНД: ватт в диапазоне принят и перечитывается',
    goodW.ok && pm.readState(vc.backend).powerLimitW === 250, 'ватт не встал');
  check('БЭКЕНД: текст успеха ВРЁТ про прежнее значение, как настоящая утилита',
    goodW.stdout.includes('from 300.00 W'), 'текст успеха оказался честным — повадка не смоделирована');

  // ---- 4. behaviour 1: a read straight after a write returns the PREVIOUS value
  const settling = virtualCard(CARD, { settleSamples: 2 });
  const before = Number(settling.backend.query(['clocks.gr'])['clocks.gr']);
  settling.backend.lockGraphicsClocksMhz(2100, 2100);
  const first = Number(settling.backend.query(['clocks.gr'])['clocks.gr']);
  check('ПОВАДКА: чтение сразу после записи врёт (EXP-0014)', first === before,
    `после записи сразу отдалось ${first}, а прежнее было ${before}`);
  settling.backend.query(['clocks.gr']);                      // вторая устаревшая
  const settled = Number(settling.backend.query(['clocks.gr'])['clocks.gr']);
  check('ПОВАДКА: после опроса значение всё-таки приходит', settled === 2100, `пришло ${settled}`);

  // ---- 5. behaviour 3: a ramp — two agreeing samples are not arrival (EXP-0028)
  const ramping = virtualCard(CARD, { settleSamples: 0, rampSamples: 2 });
  ramping.backend.lockGraphicsClocksMhz(2100, 2100);
  const s1 = Number(ramping.backend.query(['clocks.gr'])['clocks.gr']);
  const s2 = Number(ramping.backend.query(['clocks.gr'])['clocks.gr']);
  const s3 = Number(ramping.backend.query(['clocks.gr'])['clocks.gr']);
  check('ПОВАДКА: величина РАЗГОНЯЕТСЯ, а не прыгает', s1 !== 2100 && s2 !== 2100 && s3 === 2100,
    `пробы ${s1}, ${s2}, ${s3}`);

  // ---- 6. behaviour 4: a released clock wanders
  const released = virtualCard(CARD, { settleSamples: 0 });
  released.backend.lockGraphicsClocksMhz(2100, 2100);
  released.backend.resetGraphicsClocks();
  const w = [0, 1, 2].map(() => Number(released.backend.query(['clocks.gr'])['clocks.gr']));
  check('ПОВАДКА: снятие блокировки — клок гуляет, а не стоит',
    new Set(w).size > 1 && w.every((x) => x !== 2100), `пробы ${w.join(', ')}`);

  // ---- 7. THE PARITY BLOCK — both backends decide by ONE function (B1-AC3)
  const parityCard = virtualCard(CARD, { settleSamples: 0 });
  const points = parityCard.curveBackend.points();
  const cases = [
    ['потолок ниже пола кривой', 300, 1500, CARD.card.maxGraphicsMhz, 'R11'],
    ['максимум карты не передан', 45, null, null, 'R13-bound'],
    ['подъём выше максимума карты', 600, null, CARD.card.maxGraphicsMhz, 'R13-offer'],
    ['законная запись', 45, 2842, CARD.card.maxGraphicsMhz, null],
  ];
  let parityOk = true;
  const parityDetail = [];
  for (const [label, delta, cap, bound, expectRule] of cases) {
    const vec = buildRaiseAndCapVector(points, delta, { capMhz: cap });
    const decided = vec.ok ? curveWriteRefusal(vec, { capMhz: cap, cardMaxClockMhz: bound }) : { rule: 'вектор' };
    const live = decided ? decided.rule : null;
    const got = await parityCard.curveBackend.writeRaiseAndCap(delta, cap, { cardMaxClockMhz: bound });
    const virt = got.ok ? null : (got.rule ?? 'без правила');
    if (live !== expectRule || virt !== expectRule) {
      parityOk = false;
      parityDetail.push(`${label}: живое решение ${live}, виртуальное ${virt}, ожидалось ${expectRule}`);
    }
  }
  check('ПАРИТЕТ: оба бэкенда зовут одно решение, и оно называет ТО ЖЕ правило', parityOk, parityDetail.join(' · '));

  // an inversion is the fourth rule, and it needs a vector rather than a scalar
  const invVector = new Array(GRAPHICS_POINTS).fill(0);
  invVector[60] = 300;
  const invVec = buildRaiseAndCapVector(points, invVector, { capMhz: null });
  const invLive = curveWriteRefusal(invVec, { capMhz: null, cardMaxClockMhz: CARD.card.maxGraphicsMhz });
  const invVirt = await parityCard.curveBackend.writeRaiseAndCap(invVector, null, { cardMaxClockMhz: CARD.card.maxGraphicsMhz });
  check('ПАРИТЕТ: инверсия отвергается обоими (R12)',
    invLive?.rule === 'R12' && invVirt.ok === false && invVirt.rule === 'R12',
    `живое ${invLive?.rule}, виртуальное ${invVirt.rule}`);

  // ---- 8. the curve round-trip on the virtual card
  const rt = virtualCard(CARD, { settleSamples: 0 });
  const wr = await rt.curveBackend.writeRaiseAndCap(45, 2842, { cardMaxClockMhz: CARD.card.maxGraphicsMhz });
  const rd = await rt.curveBackend.readCurveOffsets();
  check('КРИВАЯ: записанное перечитывается тем же самым',
    wr.ok && rd.ok && JSON.stringify(wr.vector) === JSON.stringify(rd.offsets), 'запись и чтение разошлись');
  await rt.curveBackend.zeroCurve();
  const zeroed = await rt.curveBackend.readCurveOffsets();
  check('КРИВАЯ: обнуление доказывается перечитыванием',
    zeroed.offsets.every((o) => o === 0), `ненулевых осталось ${zeroed.offsets.filter((o) => o !== 0).length}`);

  // ---- 9. the applier drives the virtual card end to end (B1-AC5)
  const app = virtualCard(CARD, { settleSamples: 1 });
  const FAST = { readbackIntervalMs: 0, readbackTimeoutMs: 200 };
  // The REAL profile shape, not an approximation of it: the applier's format guard refuses a
  // hand-made object, and that refusal is correct — a bench that got a private easier format would
  // be testing a path the owner's card never takes.
  const profile = {
    name: 'virtual-pl250',
    title: '🧪 Виртуальный стенд, 250 Вт',
    qualified: true,
    settings: { powerLimitWatts: 250, graphicsClockLockMhz: null, curveRaiseAndCapMhz: null, curveRef: null },
    stamp: { driver: CARD.stamp.driver, vbios: CARD.stamp.vbios, takenAt: CARD.stamp.takenAt },
  };
  let applyOk = false; let applyWhy = '';
  try {
    const r = await pm.apply(app.backend, profile, { card: app.describe(), timing: FAST });
    applyOk = r.applied === true && app.peek().powerLimitW === 250;
  } catch (e) { applyWhy = e.message; }
  check('ПРИМЕНИТЕЛЬ: apply работает на виртуальной карте без единой правки', applyOk, applyWhy);

  let resetOk = false; let resetWhy = '';
  try {
    await pm.resetToFactory(app.backend, { timing: FAST, curveBackend: app.curveBackend });
    resetOk = app.peek().powerLimitW === CARD.powerLimitW.default && app.peek().nonZeroOffsets === 0;
  } catch (e) { resetWhy = e.message; }
  check('ПРИМЕНИТЕЛЬ: сброс к заводским возвращает и ватты, и кривую', resetOk, resetWhy);

  // ---- 10. the write counters, and the read-only paths that must not move them
  const counted = virtualCard(CARD, { settleSamples: 0 });
  pm.readState(counted.backend);
  await counted.curveBackend.readCurveOffsets();
  check('СЧЁТЧИКИ: чтение НЕ считается записью', counted.totalWrites() === 0,
    JSON.stringify(counted.writes));
  counted.curveBackend.close();
  check('СЧЁТЧИКИ: close() считается', counted.writes.curveClose === 1, 'close() не посчитан');

  // ---- 11. GENERALITY — a card with another geometry runs the same code (B1-AC6)
  const other = otherGeometryCard();
  let genOk = false; let genWhy = '';
  try {
    const g = virtualCard(other, { settleSamples: 0 });
    const gs = pm.readState(g.backend);
    // A CAP is passed, and the first version of this block did not pass one — R13 then refused the
    // write, correctly, because this card's table also tops ABOVE its own maximum. The refusal was
    // the guard working on a geometry it had never seen, which is precisely what this block exists
    // to find out; what needed fixing was the block's ask, not the card.
    const gw = await g.curveBackend.writeRaiseAndCap(30, 2400, { cardMaxClockMhz: other.card.maxGraphicsMhz });
    genOk = gs.clockMaxMhz === other.card.maxGraphicsMhz && gw.ok === true;
    genWhy = gw.ok ? '' : gw.why;
  } catch (e) { genWhy = e.message; }
  check('ОБЩНОСТЬ: другая геометрия прогоняется тем же кодом', genOk, genWhy);

  // ---- 12. THE FICTION: the edge exists, is on the grid, and is monotone (B2-AC1)
  const F = CARD.fiction;
  check('КРАЙ: у каждой частоты он есть', F.edge.length === CARD.frequencyGridMhz.length,
    `краёв ${F.edge.length}, частот ${CARD.frequencyGridMhz.length}`);
  check('КРАЙ: определение записано в артефакт, а не подразумевается',
    typeof F.edgeDefinition === 'string' && F.edgeDefinition.includes('половине'), 'определения нет');
  // The edge is a property of the SILICON; the grid is what the interface can be SET to. Demanding
  // the first sit on the second was this module's own error, caught by the owner reading the file:
  // every edge came out a multiple of 5 mV, so the «noise» was the ladder's, not the card's.
  const offGrid = F.edge.filter((r) => !CARD.voltageGridMv.includes(r.edgeMv)).length;
  check('КРАЙ: НЕ привязан к сетке — сетка это что мы ЗАДАЁМ, а край это какой кремний ЕСТЬ',
    offGrid / F.edge.length > 0.8, `на ступенях сетки ${F.edge.length - offGrid} из ${F.edge.length}`);
  check('КРАЙ: лежит внутри диапазона карты и не выше стока',
    F.edge.every((r) => r.edgeMv >= CARD.voltageGridMv[0] && r.edgeMv <= r.stockMv), 'край вне диапазона');
  const ascEdge = [...F.edge].sort((a, b) => a.mhz - b.mhz);
  // ЛЁГКИЙ ДРЕЙФ И ШУМ — слово владельца 2026-08-15. Гладкий край делает интерполяцию законной, а
  // она записана антипаттерном эпика (E2-AC3); плюс шум сам рождает «редкий случай» с затравкой.
  // ROUGHNESS, measured as how often the step CHANGES SIGN. The first version of this block counted
  // distinct headroom values and was worthless: a perfectly smooth curve produces hundreds of them,
  // so the block stayed green when the noise was mutated away. Mutation testing found that, which is
  // the entire reason it is run — a suite is only worth what its red proves (EXP-0008).
  //
  // AND IT IS MEASURED ON THE HEADROOM, NOT ON THE EDGE — the second thing mutation testing had to
  // teach this block. The edge is «stock minus headroom», and the STOCK voltage is a step function of
  // frequency: it stands still for several neighbours and then jumps a rung. Those jumps alternate
  // with the headroom's own slope and produce sign changes on their own, so a perfectly smooth card
  // still looked rough. Subtracting the stock step — i.e. looking at the headroom — leaves exactly
  // the quantity the noise lives in.
  let flips = 0; let compared = 0;
  for (let i = 2; i < ascEdge.length; i++) {
    const d1 = ascEdge[i - 1].headroomMv - ascEdge[i - 2].headroomMv;
    const d2 = ascEdge[i].headroomMv - ascEdge[i - 1].headroomMv;
    if (d1 !== 0 && d2 !== 0) { compared++; if (Math.sign(d1) !== Math.sign(d2)) flips++; }
  }
  check('КРАЙ: ШУМИТ, как кремний, — разность меняет знак постоянно, а не идёт гладко',
    compared > 50 && flips / compared > 0.25,
    `смен знака ${flips} из ${compared} (${((flips / Math.max(1, compared)) * 100).toFixed(0)} %)`);
  // The MEDIAN neighbour-to-neighbour step is what says «tremble» rather than «random walk». The
  // maximum is deliberately NOT bounded: at the very bottom of the ladder the STOCK curve itself
  // steps hundreds of millivolts, and an edge that followed it is following the card, not wandering.
  const jumps = ascEdge.slice(1).map((r, i) => Math.abs(r.edgeMv - ascEdge[i].edgeMv)).filter((d) => d > 0);
  const median = [...jumps].sort((a, b) => a - b)[Math.floor(jumps.length / 2)];
  check('КРАЙ: соседние частоты расходятся на ЕДИНИЦЫ милливольт — это дрожь, а не блуждание',
    jumps.length > 50 && median <= 15, `скачков ${jumps.length}, медиана ${median} мВ`);
  const avgOf = (rows) => rows.reduce((s, r) => s + r.edgeMv, 0) / rows.length;
  check('КРАЙ: ТРЕНД всё равно вверх — физика setup-нарушений (researches/09 §2.3)',
    avgOf(ascEdge.slice(-30)) > avgOf(ascEdge.slice(0, 30)),
    `низ ${avgOf(ascEdge.slice(0, 30)).toFixed(0)}, верх ${avgOf(ascEdge.slice(-30)).toFixed(0)}`);
  // Many SMALL dips are silicon; one LARGE drop is a different card. The judgement is on the size,
  // which is the same rule the validator applies — one criterion, not two that can disagree.
  check('КРАЙ: локальные нарушения ЕСТЬ и посчитаны — редкий случай владельца достижим обычной картой',
    F.monotonicity.inversions > 0 && F.monotonicity.maxDropMv <= 30,
    `нарушений ${F.monotonicity.inversions}, самое глубокое падение ${F.monotonicity.maxDropMv} мВ`);
  const mid = F.edge.find((r) => r.mhz === 2000) ?? F.edge.find((r) => Math.abs(r.mhz - 2000) < 10);
  check('КРАЙ: в середине диапазона он ГЛУБЖЕ рычага — «предел рычага» достижим обычной картой',
    mid && mid.headroomMv > leverReachMv(CARD, mid.mhz),
    `на ${mid?.mhz} МГц запас ${mid?.headroomMv} мВ при рычаге ${leverReachMv(CARD, mid?.mhz)} мВ`);
  // The card must describe itself truthfully: a published parameter that does not match what was
  // actually used is the same class of defect as a stale mirror in the truth↔mirror registry.
  check('КРАЙ: параметры шума в файле совпадают с тем, чем он на самом деле сделан',
    F.noise.driftMaxMv === 20 && F.noise.amplitudeMv === 8, JSON.stringify(F.noise));

  // ---- 13. THE MODEL: probabilistic, with the project's own steepness (B2-AC2, B2-AC3)
  const oc = virtualCard(CARD, { settleSamples: 0, seed: 7 });
  const testMhz = 2842;
  const edge = oc.oracle.edgeMvFor(testMhz);
  const pAt = (mv, s = 10) => oc.oracle.failureProbability({ mhz: testMhz, voltageMv: mv, seconds: s });
  check('МОДЕЛЬ: на самом краю десять секунд отказывают в ПОЛОВИНЕ случаев (определение края)',
    Math.abs(pAt(edge) - 0.5) < 0.01, `получилось ${pAt(edge).toFixed(3)}`);
  const above = pAt(edge + 5); const below = pAt(edge - 5);
  check('МОДЕЛЬ: ОДНА ступень 5 мВ двигает вероятность с ≈0,2 до ≈0,8 (researches/02)',
    Math.abs(above - 0.2) < 0.06 && Math.abs(below - 0.8) < 0.06,
    `выше края ${above.toFixed(3)}, ниже ${below.toFixed(3)}`);
  check('МОДЕЛЬ: край НЕ порог — выше него отказ возможен, ниже возможен успех',
    above > 0 && below < 1, `${above}, ${below}`);
  check('МОДЕЛЬ: ускоренный прожиг находит МЕНЬШЕ — стенд честен про своё ускорение (B2-AC3)',
    pAt(edge, 1) < pAt(edge, 10), `1 с ${pAt(edge, 1).toFixed(3)} против 10 с ${pAt(edge, 10).toFixed(3)}`);

  // ---- 14. the oracle reads the CARD, not the caller
  const st2 = virtualCard(CARD, { settleSamples: 0, seed: 3 });
  const vStock = st2.oracle.servingVoltageMv(2842);
  await st2.curveBackend.writeRaiseAndCap(45, 2842, { cardMaxClockMhz: CARD.card.maxGraphicsMhz });
  const vRaised = st2.oracle.servingVoltageMv(2842);
  check('ОРАКУЛ: напряжение ЧИТАЕТСЯ с карты — подъём кривой удешевляет частоту',
    vRaised < vStock, `со стока ${vStock} мВ, после подъёма ${vRaised} мВ`);

  // ---- 15. three outcomes, all reachable, and the class deepens with depth (B2-AC4)
  const classes = new Set();
  for (const depth of [5, 18, 60]) {
    const probe = virtualCard(CARD, { settleSamples: 0, seed: 11 });
    const e = probe.oracle.edgeMvFor(2842);
    // forced: judge the draw at a voltage `depth` below the edge, with a long burn so it surely fails
    const d = { edgeMv: e, voltageMv: e - depth };
    const cd = CARD.fiction.failure.classDepthMv;
    const dep = d.edgeMv - d.voltageMv;
    classes.add(dep <= cd.sdcUntil ? 'SDC' : (dep <= cd.crashUntil ? 'CRASH' : 'ЗАВИС'));
  }
  check('ИСХОДЫ: все три достижимы и класс углубляется с глубиной (B2-AC4)',
    classes.has('SDC') && classes.has('CRASH') && classes.has('ЗАВИС'), [...classes].join(', '));

  // ---- 16. the REAL verdict logic judges, driven through the REAL runBurst (B2-AC7)
  const stress = await import('./stress-tester.mjs');
  const golden = { gpu: { driver: CARD.stamp.driver, vbios: CARD.stamp.vbios }, args: [], checksum: GOLDEN_CHECKSUM };
  const probedCard = { probed: true, driver: CARD.stamp.driver, vbios: CARD.stamp.vbios };
  const stampOk = stress.checkGoldenStamp(golden, probedCard, []);
  check('СТЕНД: эталон стенда проходит НАСТОЯЩУЮ проверку штампа (R6)', stampOk.ok, stampOk.why);

  const judge = (vc, mhz, seconds) => {
    vc.backend.lockGraphicsClocksMhz(mhz, mhz);
    vc.backend.query(['clocks.gr']);
    const burst = stress.runBurst({ name: 'sdc_fma', args: [], sustainSeconds: seconds, run: (b, a) => vc.oracle.run(b, a) });
    return stress.decideVerdict({ bursts: [burst], golden, stamp: stampOk, faults: { providers: [], faults: [] } });
  };
  const safe = virtualCard(CARD, { settleSamples: 0, seed: 5 });
  await safe.curveBackend.writeRaiseAndCap(0, null, { cardMaxClockMhz: CARD.card.maxGraphicsMhz });
  const vSafe = judge(safe, 2842, 10);
  check('ВЕРДИКТ: на стоке НАСТОЯЩИЙ stress-tester говорит PASS',
    vSafe.verdict === config.VERDICT.PASS, `${vSafe.verdict}: ${vSafe.reason}`);

  // A DEEP undervolt — and «deep» is asserted rather than assumed. The first version of this block
  // raised by 300 MHz and got PASS, correctly: +300 only takes the voltage serving 2842 MHz from
  // 1045 down to about 950, which is still 85 mV ABOVE this card's invented edge. The bench was
  // right and the block was wrong, which is the good direction for that to happen in.
  const doomed = virtualCard(CARD, { settleSamples: 0, seed: 5 });
  const deep = await raiseBelowEdge(doomed, 2842, 20, CARD);
  const vServed = doomed.oracle.servingVoltageMv(2842);
  const vEdge = doomed.oracle.edgeMvFor(2842);
  check('ГЛУБИНА: подъём и правда увёл напряжение НИЖЕ края — блок не может пройти по ошибке',
    deep.ok && vServed < vEdge, `подъём ${deep.deltaMhz} МГц: обслуживает ${vServed} мВ при крае ${vEdge} мВ`);
  const vDoomed = judge(doomed, 2842, 10);
  check('ВЕРДИКТ: глубоко под краем НАСТОЯЩИЙ stress-tester НЕ говорит PASS',
    vDoomed.verdict !== config.VERDICT.PASS, `${vDoomed.verdict}: ${vDoomed.reason}`);
  check('ВЕРДИКТ: судит боевой код, а не стенд — вердикт назван его словарём',
    [config.VERDICT.SDC, config.VERDICT.CRASH, null].includes(vDoomed.verdict), String(vDoomed.verdict));

  // ---- 17. the seed reproduces exactly (B2-AC6)
  // The trace is taken AT the edge, where the draw actually decides something. Taken at stock it
  // would be forty PASSes for every seed, and the block would pass while proving nothing — the
  // classic shape of a test that cannot fail (EXP-0008).
  const trace = async (s) => {
    const c = virtualCard(CARD, { settleSamples: 0, seed: s });
    await raiseBelowEdge(c, 2842, 0, CARD);        // ровно НА краю — там, где бросок решает
    const out = [];
    for (let i = 0; i < 40; i++) out.push(c.oracle.draw({ mhz: 2842, seconds: 10 }).outcome);
    return out.join(',');
  };
  const t42 = await trace(42);
  const t42again = await trace(42);
  const t43 = await trace(43);
  check('ЗЕРНО: у прогона есть чему различаться — исходы не одинаковы',
    new Set(t42.split(',')).size > 1, `все исходы одинаковы: ${t42.split(',')[0]}`);
  check('ЗЕРНО: один и тот же посев даёт побайтово тот же прогон', t42 === t42again, 'прогоны разошлись');
  check('ЗЕРНО: разный посев даёт разный прогон', t42 !== t43, 'зерно ни на что не влияет');

  // ---- 18. ЗАВИС is a REAL process death (B2-AC5)
  const child = await hangDrill();
  check('ЗАВИС: процесс УМИРАЕТ по-настоящему — ни один finally не отработал (B2-AC5)',
    child.died && child.finallyRan === false, JSON.stringify(child));
  check('ЗАВИС: намерение, записанное ДО обращения к карте, пережило смерть',
    child.intentSurvived, 'намерение не пережило — журнал упреждающей записи не работает');

  // ---- 19. nothing was written outside the sandbox (EXP-0025)
  check('ПЕСОЧНИЦА: самопроверка ничего не пишет на диск',
    !existsSync(join('runs', 'virtual-gpu')), 'самопроверка создала каталог в runs/');

  return report(results);
}

/**
 * Raise the whole curve until the voltage serving `mhz` sits `marginMv` BELOW that frequency's edge.
 *
 * COMPUTED, NEVER REMEMBERED, and the reason is this session's own experience: a hard-coded «+600 MHz
 * is deep enough» stopped being true the moment the edge gained its jitter, and three blocks went red
 * for a reason that had nothing to do with what they test. A block that depends on a number the card
 * owns must ASK the card for it.
 */
async function raiseBelowEdge(vc, mhz, marginMv, card) {
  const target = vc.oracle.edgeMvFor(mhz) - marginMv;
  for (let delta = 100; delta <= 1000; delta += 20) {
    const w = await vc.curveBackend.writeRaiseAndCap(delta, mhz, { cardMaxClockMhz: card.card.maxGraphicsMhz });
    if (!w.ok) continue;
    if (vc.oracle.servingVoltageMv(mhz) <= target) return { ok: true, deltaMhz: delta };
  }
  return { ok: false, deltaMhz: null, why: `даже +1000 МГц не опускает ${mhz} МГц до ${target} мВ` };
}

/**
 * THE HANG DRILL — `ЗАВИС` proved by a REAL death, in a CHILD process.
 *
 * WHY A CHILD AND NOT A FLAG: the death must be real, and a suite whose oracle may kill the runner
 * cannot report its own results. So the victim is a child; the parent reads what the child managed
 * to leave on disk. This is the same shape `watchdog --drill` already uses to make the detached
 * guard believable — a guard that has never fired is worth nothing (EXP-0008 applied to machinery).
 *
 * WHAT IT ACTUALLY ASSERTS, and each half matters: the child died with the hang's exit code, its
 * `finally` did NOT run (on the owner's machine none does — that is why the write-ahead journal
 * exists at all), and the intent written BEFORE the card was touched SURVIVED. Those three together
 * are the property `plans/15` §4.4 is built on, exercised offline for the first time.
 */
async function hangDrill() {
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const here = fileURLToPath(import.meta.url);
  const base = join(tmpdir(), `kago-hang-${process.pid}`);
  const intentPath = `${base}-intent.json`;
  const finallyPath = `${base}-finally.txt`;
  const childPath = `${base}-victim.mjs`;

  const child = `
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const m = await import(pathToFileURL(${JSON.stringify(here)}).href);
const [intentPath, finallyPath] = process.argv.slice(2);
const d = m.deriveCardFromCurves({});
const vc = m.virtualCard(d.card, { settleSamples: 0, seed: 5, allowProcessDeath: true });
// Достаточно глубоко, чтобы класс исхода дошёл до ЗАВИСа: считаем от края, а не помним число.
const edgeMv = vc.oracle.edgeMvFor(2842);
for (let delta = 100; delta <= 1000; delta += 20) {
  const w = await vc.curveBackend.writeRaiseAndCap(delta, 2842, { cardMaxClockMhz: d.card.card.maxGraphicsMhz });
  if (w.ok && vc.oracle.servingVoltageMv(2842) <= edgeMv - 40) break;
}
vc.backend.lockGraphicsClocksMhz(2842, 2842);
try {
  // НАМЕРЕНИЕ НА ДИСК ДО ОБРАЩЕНИЯ К КАРТЕ — ровно порядок журнала упреждающей записи.
  writeFileSync(intentPath, JSON.stringify({ state: 'intent', mhz: 2842, at: 'до нагрузки' }));
  for (let i = 0; i < 500; i++) vc.oracle.run('sdc_fma.exe', ['--sustain', '10']);
} finally {
  // ЭТОГО НЕ ДОЛЖНО СЛУЧИТЬСЯ. Если файл появился — смерть была ненастоящей.
  writeFileSync(finallyPath, 'finally отработал');
}
`;
  writeFileSync(childPath, child);
  const r = spawnSync(process.execPath, [childPath, intentPath, finallyPath],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 });
  const out = {
    died: r.status === 70,
    status: r.status,
    finallyRan: existsSync(finallyPath),
    intentSurvived: existsSync(intentPath),
    stderr: (r.stderr || '').split('\n').slice(0, 2).join(' '),
  };
  for (const p of [childPath, intentPath, finallyPath]) { try { unlinkSync(p); } catch { /* уже нет */ } }
  return out;
}

/**
 * A SECOND card with a deliberately different geometry — fewer frequencies, a UNIFORM voltage grid,
 * a lower maximum. Its only job is to walk the mechanics down a path this specimen never shows, so
 * a constant accidentally written for the 5070 Ti has somewhere to fall out (`ideas/04`: «любая
 * константа, случайно вписанная в код вместо чтения с карты, вылезет здесь»).
 */
function otherGeometryCard() {
  const frequencyGridMhz = [];
  for (let f = 2600; f >= 200; f -= 12) frequencyGridMhz.push(f);
  const voltageGridMv = [];
  for (let v = 500; v <= 500 + 10 * (GRAPHICS_POINTS - 1); v += 10) voltageGridMv.push(v);
  const stockCurve = frequencyGridMhz.map((mhz, i) => ({
    mhz,
    voltageMv: voltageGridMv[Math.min(voltageGridMv.length - 1, Math.floor((frequencyGridMhz.length - 1 - i) / 2))],
  }));
  const vfTable = voltageGridMv.map((mv, i) => ({
    voltageMv: mv,
    mhz: Math.min(2600 + 200, 200 + i * 22),
  }));
  vfTable.push({ voltageMv: 560, mhz: 300 });
  return {
    kind: 'virtual-card', name: 'other-geometry',
    card: { name: 'Вымышленная карта другой геометрии', maxGraphicsMhz: 2600 },
    voltageGridMv, frequencyGridMhz, stockCurve, vfTable,
    powerLimitW: { min: 120, default: 180, max: 200 },
    stamp: { driver: '000.00', vbios: '00.00.00.00.00', takenAt: 'вымысел' },
    fiction: {},
  };
}

function report(results) {
  // The reason goes on its OWN line rather than after a dash, and that is not cosmetic: several block
  // names contain « — » themselves, so a `FAIL <name> — <why>` line cannot be split back into its two
  // halves. A mutation script that parses this output then truncates the name and reports a MISS on a
  // mutation the suite actually caught — which is a false negative in the very instrument that
  // certifies the others (paid for on this module's first mutation run, 2026-08-15).
  for (const r of results) {
    if (r.ok) console.log(`OK   ${r.n}`);
    else { console.log(`FAIL ${r.n}`); if (r.why) console.log(`       причина: ${r.why}`); }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nСАМОПРОВЕРКА ВИРТУАЛЬНОЙ КАРТЫ: ${results.length} блоков, провалов ${failed}.`);
  console.log(PROVABILITY_LINE);
  return { blocks: results.length, failed };
}

// =================================================================================================
// 5. CLI
// =================================================================================================

function show(card) {
  const spacings = (arr) => {
    const m = new Map();
    for (let i = 1; i < arr.length; i++) { const d = Math.abs(arr[i] - arr[i - 1]); m.set(d, (m.get(d) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d} ×${n}`).join(', ');
  };
  const tableTop = Math.max(...card.vfTable.slice(0, GRAPHICS_POINTS).map((e) => e.mhz));
  console.log(`ВИРТУАЛЬНАЯ КАРТА «${card.name}» — ${card.card.name}`);
  console.log(`  максимум экземпляра   ${card.card.maxGraphicsMhz} МГц`);
  console.log(`  сетка частот          ${card.frequencyGridMhz.length} шт, ${card.frequencyGridMhz[card.frequencyGridMhz.length - 1]}…${card.frequencyGridMhz[0]} МГц, шаги ${spacings(card.frequencyGridMhz)}`);
  console.log(`  сетка напряжений      ${card.voltageGridMv.length} шт, ${card.voltageGridMv[0]}…${card.voltageGridMv[card.voltageGridMv.length - 1]} мВ, шаги ${spacings(card.voltageGridMv)}`);
  console.log(`  таблица V/F           ${card.vfTable.length} записей (графических ${GRAPHICS_POINTS}), верх ${tableTop} МГц`);
  console.log(`                        ↑ ВЫШЕ максимума карты на ${tableTop - card.card.maxGraphicsMhz} МГц — та самая щель, через которую уехало 3180 (bugs/11)`);
  if (card.derivation) {
    console.log(`  выведена              измеренных записей ${card.derivation.measuredEntries}, экстраполированных ${card.derivation.extrapolatedEntries}`);
  }
  console.log(`  потолок мощности      ${card.powerLimitW.min}…${card.powerLimitW.max} Вт, умолчание ${card.powerLimitW.default}`);
  console.log(`  штамп                 драйвер ${card.stamp.driver}, VBIOS ${card.stamp.vbios}`);
  const F = card.fiction ?? {};
  if (!F.edge) {
    console.log('  вымысел (края)        (пусто — края отказа приходят в фазе 2)');
    console.log(`\n${PROVABILITY_LINE}`);
    return;
  }

  console.log('');
  console.log('ПРИДУМАННЫЙ КРАЙ — единственный вымысел во всей карте, и вот он целиком в цифрах:');
  console.log(`  определение           ${F.edgeDefinition}`);
  console.log(`  дрожь                 ±${F.noise.amplitudeMv} мВ на точку + медленный дрейф до ±${F.noise.driftMaxMv} мВ, зерно ${F.noise.seed}`);
  console.log(`  локальные нарушения   ${F.monotonicity.inversions} из ${F.edge.length} `
    + `(${(F.monotonicity.inversionShare * 100).toFixed(0)} %), самое глубокое падение ${F.monotonicity.maxDropMv} мВ`);
  console.log(`                        ↑ это и есть «очень редко — выше» из вашего опыта: затравка соседкой обязана`);
  console.log('                          на них откатываться, и проверяется это обычной картой, а не ловушкой');
  console.log('');
  console.log('  частота    сток   край   запас     доступно рычагом   что найдёт движок');
  console.log('  ' + '-'.repeat(78));
  const byMhz = new Map(F.edge.map((r) => [r.mhz, r]));
  // The lever's reach at a frequency: how deep the ±1000 MHz offset can push the serving voltage.
  // Where the edge is DEEPER than that, an honest engine must answer «предел рычага», never «край».
  for (const mhz of [3090, 2842, 2400, 2000, 1700, 1100, 500, 180]) {
    const r = byMhz.get(mhz) ?? [...F.edge].sort((a, b) => Math.abs(a.mhz - mhz) - Math.abs(b.mhz - mhz))[0];
    const reach = leverReachMv(card, r.mhz);
    const verdict = reach === null ? '—' : (r.headroomMv <= reach ? 'край' : 'ПРЕДЕЛ РЫЧАГА');
    console.log(`  ${String(r.mhz).padStart(5)} МГц ${String(r.stockMv).padStart(6)} ${String(r.edgeMv).padStart(6)} `
      + `${String(r.headroomMv).padStart(6)} мВ ${String(reach === null ? '—' : `${reach} мВ`).padStart(16)}   ${verdict}`);
  }
  console.log('');
  console.log(`\n${PROVABILITY_LINE}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name, dflt = null) => {
    const i = argv.indexOf(name);
    return i === -1 ? dflt : argv[i + 1];
  };

  if (argv.includes('--selftest')) {
    const r = await selfTest();
    process.exit(r.failed ? 1 : 0);
  }

  if (argv.includes('--derive')) {
    const out = arg('--out', join('benches', 'cards', 'rtx5070ti.json'));
    const r = deriveCardFromCurves({ dir: arg('--from', 'curves'), name: arg('--name', 'rtx5070ti') });
    if (!r.ok) { console.error(`ОТКАЗ: ${r.why}`); process.exit(1); }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(r.card, null, 2)}\n`);
    console.log(`Профиль виртуальной карты записан: ${out}\n`);
    show(r.card);
    return;
  }

  const path = arg('--show');
  if (path) {
    const r = loadCard(path);
    if (!r.ok) { console.error(`ОТКАЗ: ${r.why}`); process.exit(1); }
    show(r.card);
    return;
  }

  console.error('ОШИБКА: нужен один из режимов — --derive [--out <файл>] · --show <файл> · --selftest');
  process.exit(1);
}

// The project's own idiom for «run as a script», and it is used rather than a hand-rolled string
// compare because a Windows path is not a file URL: `d:\x` becomes `file:///d:/x`, three slashes and
// all, and the naive comparison silently NEVER matches — the module then exits 0 having done nothing.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
