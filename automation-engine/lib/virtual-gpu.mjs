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
// [TESTED: 2026-08-15 18:5x · `npm run vgpu -- --selftest` → 37 blocks, 0 failures, no GPU touched:
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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
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
  if (!c.fiction || typeof c.fiction !== 'object') return bad('fiction', 'нет блока fiction (в фазе 1 он пуст, но он есть)');
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
    fiction: {},   // фаза 2 кладёт сюда края отказа; форма существует с фазы 1, чтобы её не менять
  };
  const v = validateCard(card);
  if (!v.ok) return { ok: false, why: `выведенный профиль негоден (поле ${v.field}): ${v.why}` };
  return { ok: true, card };
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
export function virtualCard(cardProfile, { settleSamples = 1, rampSamples = 0, wanderMhz = null } = {}) {
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

  return {
    profile: P,
    backend,
    curveBackend,
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

  // ---- 12. nothing was written outside the sandbox (EXP-0025)
  check('ПЕСОЧНИЦА: самопроверка ничего не пишет на диск',
    !existsSync(join('runs', 'virtual-gpu')), 'самопроверка создала каталог в runs/');

  return report(results);
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
  const f = Object.keys(card.fiction ?? {});
  console.log(`  вымысел (края)        ${f.length ? f.join(', ') : '(пусто — края отказа приходят в фазе 2)'}`);
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
