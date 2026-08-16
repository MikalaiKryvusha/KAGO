#!/usr/bin/env node
// automation-engine/lib/curve-store.mjs — THE TUNING CURVE: for every FREQUENCY on the card's grid,
// the voltage that serves it.
//
// Plan anchor (plans/14 §4.2, the owner's `ideas/03` steps 1–2 and 5), and the terminology is HIS,
// settled 2026-08-15: *«МЫ ПРЕКРАЩАЕМ НАЗЫВАТЬ ТОЧКИ НОМЕРАМИ. МЫ НАЗЫВАЕМ ТОЧКИ ЧАСТОТОЙ… Карта
// хочет сменить частоту — она устанавливает новую частоту, мы обслуживаем её соответствующим
// напряжением. Всё. Нет никаких "точка 120". Есть только частоты по сетке частот.»*
//
// ─── WHY HIS FRAMING IS THE CORRECT ONE, not merely the one we were told to use ─────────────────
//
// The first version of this file keyed by table INDEX and stored a frequency per index. That made an
// index look like an object that MOVES: «point 120 read 3112 MHz cold and 3105 at 57 °C», with a
// reclassification pass to chase it. In the owner's framing that observation does not exist. What
// exists is simpler and true: **1200 mV served 3112 MHz cold and 3105 MHz warm** — a statement about
// what a frequency COSTS, not about a point travelling.
//
// And it makes the artifact STABLE. «Frequency → voltage» is what we search for and what we keep, and
// it does not depend on the temperature of the measurement. The per-entry offsets the hardware wants
// DO depend on it — so they are COMPUTED at apply time from the live table and never stored. The old
// shape stored exactly the thing that moves.
//
// ─── THE ONE HARDWARE LIMIT, STATED UP FRONT ────────────────────────────────────────────────────
//
// The card's write interface is 127 table entries, each at a FIXED voltage; only the entry's
// frequency is writable. So the 389 grid frequencies CANNOT each get an independent voltage —
// **neighbouring frequencies share one**, because there are only 127 voltage rungs (450…1240 mV,
// 5 mV in 94 places and 10 mV in 32). «Serve the frequency with its voltage» is therefore executed
// with the nearest rung AT OR ABOVE the measured minimum. There is no other quantity the card takes.
//
// GPU WRITES: none. This module reads the card to seed a document and to verify one; it never writes.
//
// Usage:
//   npm run curve -- --grids     probe and store both card dictionaries (ideas/03 steps 3–4)
//   npm run curve -- --init      seed frequency → voltage from the live card (step 5)
//   npm run curve -- --show      print the table
//   npm run curve -- --verify    hold the document against the live card
//   npm run curve -- --selftest  hostile fixtures, no GPU
//
// [NOT-TESTED] — born 2026-08-15 with plan 14; re-keyed to frequency the same day on the owner's word.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CLOCK_OFFSET_MIN_MHZ, CLOCK_OFFSET_MAX_MHZ, CURVE_GRAPHICS_POINT_COUNT } from '../config.mjs';
import { CURVES_DIR, writeJsonAtomic, loadGrid, localIso, buildGrids, writeGrids, validateGrid, probeGpuInfo } from './card-grids.mjs';

export { CURVES_DIR };

/**
 * The statuses a frequency may carry. CLOSED — an unknown status is refused, never ignored.
 *
 * The three PROOF statuses are the owner's own words from `ideas/03`, quoted rather than paraphrased:
 *   step  9 — «точка проверена, работает, доказано коротким прожигом»  → short-burn-proved
 *   step 12 — «протестирована, край найден!»                           → edge-found
 *   step 15 — «доказаны длительным прожигом»                           → long-burn-proved
 *
 * TWO STATUSES WERE REMOVED when the document was re-keyed to frequency: `clock-floor` and
 * `above-card-max` were artifacts of numbering table entries. The frequency grid IS 180…3090 MHz —
 * there is nothing above the card's maximum by construction, and the bottom of the grid is just its
 * bottom.
 */
export const CURVE_STATUS = Object.freeze({
  /** The factory voltage for this frequency, as read. Nothing tuned yet. */
  STOCK: 'stock',
  /** A rung is IN FLIGHT — written before the card is touched, so a hang leaves a trace and the next
   *  launch knows which rung killed the machine (`ideas/03` step 12, phase 2). */
  PROBING: 'probing',
  /** This frequency held the owner's 10 s burn at this voltage. */
  SHORT_BURN_PROVED: 'short-burn-proved',
  /** One rung lower failed; parked at V_fail + 10 mV (his margin, two grid steps). */
  EDGE_FOUND: 'edge-found',
  /** Held the long burn — one minute since his amendment of 2026-08-15. */
  LONG_BURN_PROVED: 'long-burn-proved',
  /** The ±1000 MHz lever ran out BEFORE the silicon did: no LOWER voltage can be made to serve this
   *  frequency at all. **Not an edge**, and it must never be reported as one — measured, 45 mV of
   *  headroom at 1700 MHz against 245 at 2842 (`researches/09` §3.3). */
  LEVER_LIMITED: 'lever-limited',
});

const STATUS_VALUES = Object.freeze(Object.values(CURVE_STATUS));
/** Statuses that mean «a burn proved this» — the ones a report may count as evidence. */
export const PROVEN_STATUSES = Object.freeze([
  CURVE_STATUS.SHORT_BURN_PROVED, CURVE_STATUS.EDGE_FOUND, CURVE_STATUS.LONG_BURN_PROVED,
]);

export const CURVE_FILE = 'measured.json';
const ROW_KEYS = Object.freeze(['mhz', 'voltageMv', 'stockVoltageMv', 'status', 'provenBy', 'editedAt']);
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u;
const refuse = (field, why) => ({ field, why });

export function curvePath(name = 'measured', dir = CURVES_DIR) {
  return path.join(dir, name === 'measured' ? CURVE_FILE : `${name}.json`);
}

// =================================================================================================
// 1. Reading the card in the owner's coordinates: frequency → voltage
// =================================================================================================

/**
 * The voltage the card's factory table currently uses to serve `mhz`.
 *
 * The table is ascending in both axes, so the serving voltage is the LOWEST rung whose frequency
 * reaches `mhz`. Returns `null` when no rung reaches it (which, for a frequency taken off the card's
 * own grid, means the reading is wrong rather than the frequency is impossible).
 */
export function stockVoltageFor(mhz, tablePoints) {
  for (const p of tablePoints) {
    if (p.freqKhz > 0 && p.mhz >= mhz) return p.mv;
  }
  return null;
}

/**
 * The LOWEST voltage that could be made to serve `mhz` at all, given the hardware's ±1000 MHz lever.
 *
 * To serve `mhz` from a rung whose factory frequency is F, that rung must be raised by (mhz − F), and
 * the raise is capped. So the reachable floor is the lowest rung within reach — and THAT is what
 * `lever-limited` means when a descent stops there: our lever ran out, not the silicon.
 */
export function leverFloorFor(mhz, tablePoints, maxRaiseMhz = CLOCK_OFFSET_MAX_MHZ ?? 1000) {
  for (const p of tablePoints) {
    if (p.freqKhz > 0 && mhz - p.mhz <= maxRaiseMhz) return p.mv;
  }
  return null;
}

/**
 * Seed a document: every frequency on the card's grid, with the voltage the factory currently uses.
 *
 * `ideas/03` step 5. Descending by frequency because the sweep walks top-down (step 6) and a table
 * stored in the order it is consumed is one fewer place to get a direction wrong.
 */
export function initFromCard({ frequencyGrid, tablePoints, card, stamp, tempC = null, nowIso = null }) {
  const at = nowIso ?? localIso();
  const frequencies = [...frequencyGrid.values].sort((a, b) => b - a).map((mhz) => {
    const v = stockVoltageFor(mhz, tablePoints);
    return {
      mhz,
      voltageMv: v,
      stockVoltageMv: v,
      status: CURVE_STATUS.STOCK,
      provenBy: null,
      editedAt: at,
    };
  });

  return {
    kind: 'tuning-curve',
    name: 'measured',
    card: { ...card, frequencyCount: frequencies.length },
    // The voltage rungs the card offers. Stored WITH the document because a voltage that is not on
    // this list is not a voltage the card can be asked for, and the validator says so by name.
    voltageGridMv: [...new Set(tablePoints.slice(0, CURVE_GRAPHICS_POINT_COUNT).map((p) => p.mv))].sort((a, b) => a - b),
    stamp: { ...stamp, takenAt: stamp.takenAt ?? at, tempC },
    frequencies,
  };
}

/** Coverage arithmetic — what E2-AC2 is counted with. Pure. */
export function summarize(doc) {
  const rows = doc.frequencies ?? [];
  const by = Object.fromEntries(STATUS_VALUES.map((s) => [s, 0]));
  for (const r of rows) by[r.status] = (by[r.status] ?? 0) + 1;
  const closed = rows.filter((r) => r.status === CURVE_STATUS.EDGE_FOUND
    || r.status === CURVE_STATUS.LEVER_LIMITED || r.status === CURVE_STATUS.LONG_BURN_PROVED).length;
  const savedMv = rows.reduce((n, r) => n + Math.max(0, (r.stockVoltageMv ?? 0) - (r.voltageMv ?? 0)), 0);
  const tuned = rows.filter((r) => Number.isFinite(r.stockVoltageMv) && r.voltageMv < r.stockVoltageMv);
  return {
    total: rows.length,
    byStatus: by,
    closed,
    tuned: tuned.length,
    deepestCutMv: tuned.length ? Math.max(...tuned.map((r) => r.stockVoltageMv - r.voltageMv)) : 0,
    averageCutMv: tuned.length ? Math.round((savedMv / tuned.length) * 10) / 10 : 0,
  };
}

// =================================================================================================
// 2. Validation — pure, provable on fixtures alone
// =================================================================================================

export function validateCurveDoc(doc, { card = null, frequencyGrid = null } = {}) {
  const out = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return [refuse('<кривая>', 'ожидался JSON-объект')];
  }
  if (doc.kind !== 'tuning-curve') {
    out.push(refuse('kind', `ожидался tuning-curve, получено ${JSON.stringify(doc.kind)}`));
  }

  const stamp = doc.stamp;
  if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) {
    out.push(refuse('stamp', 'штамп обязателен: кривая действительна только для драйвера и VBIOS, на которых снята (R6)'));
  } else {
    for (const k of ['driver', 'vbios']) {
      if (typeof stamp[k] !== 'string' || stamp[k].trim() === '') out.push(refuse(`stamp.${k}`, 'обязательное поле штампа'));
    }
    if (!LOCAL_ISO.test(String(stamp.takenAt))) {
      out.push(refuse('stamp.takenAt', `ожидался локальный ISO 8601 со смещением, получено ${JSON.stringify(stamp.takenAt)}; «Z» отвергается намеренно — EXP-0012`));
    }
  }

  if (!Array.isArray(doc.voltageGridMv) || doc.voltageGridMv.length === 0) {
    out.push(refuse('voltageGridMv', 'сетка напряжений обязательна: напряжение, которого на ней нет, карта принять не может'));
  }
  if (!Array.isArray(doc.frequencies) || doc.frequencies.length === 0) {
    return [...out, refuse('frequencies', 'обязательная таблица частот отсутствует или пуста')];
  }

  const grid = Array.isArray(doc.voltageGridMv) ? doc.voltageGridMv : [];
  const bound = card?.maxGraphicsMhz ?? null;
  const ladder = frequencyGrid?.values ?? null;

  let prevMhz = Infinity;
  for (let k = 0; k < doc.frequencies.length; k++) {
    const r = doc.frequencies[k];
    const at = `frequencies[${k}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      out.push(refuse(at, 'ожидался объект строки'));
      continue;
    }
    for (const key of Object.keys(r)) {
      if (!ROW_KEYS.includes(key)) out.push(refuse(`${at}.${key}`, `неизвестное поле; известны: ${ROW_KEYS.join(', ')}`));
    }

    // --- the frequency itself
    if (!Number.isFinite(r.mhz)) {
      out.push(refuse(`${at}.mhz`, `ожидалась частота в МГц, получено ${JSON.stringify(r.mhz)}`));
    } else {
      if (r.mhz >= prevMhz) {
        out.push(refuse(`${at}.mhz`, `таблица идёт сверху вниз по частоте, а ${r.mhz} МГц стоит после ${prevMhz}`));
      }
      prevMhz = r.mhz;
      if (ladder && !ladder.includes(r.mhz)) {
        out.push(refuse(`${at}.mhz`, `${r.mhz} МГц нет на сетке частот карты — карта на этой частоте работать не станет`));
      }
      // R13 read in the owner's coordinates, and it is trivial here BY CONSTRUCTION: frequencies come
      // off the card's own grid, whose top IS the instance maximum. The check stays because «by
      // construction» is an argument about today's code, and this is the rule `bugs/11` cost a BSOD.
      if (bound !== null && r.mhz > bound) {
        out.push(refuse(`${at}.mhz`, `${r.mhz} МГц выше максимума этой карты (${bound} МГц). `
          + 'Слово владельца: «НИКОГДА НЕ ГНАТЬ КАРТУ ВЫШЕ ЭТОЙ ЧАСТОТЫ» (R13, bugs/11)'));
      }
    }

    // --- the voltage that serves it
    if (!Number.isFinite(r.voltageMv)) {
      out.push(refuse(`${at}.voltageMv`, `ожидалось напряжение в мВ, получено ${JSON.stringify(r.voltageMv)}`));
    } else if (grid.length && !grid.includes(r.voltageMv)) {
      out.push(refuse(`${at}.voltageMv`, `${r.voltageMv} мВ нет на сетке напряжений карты — такого напряжения у неё попросить нельзя. `
        + `Сетка: ${grid[0]}…${grid[grid.length - 1]} мВ, ${grid.length} ступеней`));
    }
    if (Number.isFinite(r.stockVoltageMv) && Number.isFinite(r.voltageMv) && r.voltageMv > r.stockVoltageMv) {
      // Tuning LOWERS the voltage a frequency needs. Raising it above stock is not undervolting, and
      // it is not something this project has ever measured a reason for.
      out.push(refuse(`${at}.voltageMv`, `${r.voltageMv} мВ ВЫШЕ стокового ${r.stockVoltageMv} мВ: тюнинг снижает напряжение частоты, `
        + 'а не поднимает; повышение — это не андервольт и оснований для него не измерено'));
    }

    if (!STATUS_VALUES.includes(r.status)) {
      out.push(refuse(`${at}.status`, `неизвестный статус ${JSON.stringify(r.status)}; словарь закрыт: ${STATUS_VALUES.join(', ')}`));
    }
    if (!LOCAL_ISO.test(String(r.editedAt))) {
      out.push(refuse(`${at}.editedAt`, `дата последней правки обязательна, локальный ISO со смещением; получено ${JSON.stringify(r.editedAt)}`));
    }
    if (PROVEN_STATUSES.includes(r.status) && (typeof r.provenBy !== 'string' || r.provenBy.trim() === '')) {
      out.push(refuse(`${at}.provenBy`, `статус «${r.status}» утверждает, что частоту доказал прожиг — тогда назови форму нагрузки и вердикт; `
        + 'статус без свидетеля это заявление, а не улика'));
    }
  }

  // ─── MONOTONICITY, in the owner's coordinates and physically meaningful ────────────────────────
  // A higher frequency cannot need LESS voltage than a lower one — that is the same setup-timing fact
  // the whole search rests on, and the owner stated it from his own practice: «на более нижней частоте
  // напряжение нужно такое же или ниже, очень редко выше, почти не бывает такого». A table that
  // violates it is either a measurement error or that rare case, and either way it is not written
  // silently. The refusal names BOTH frequencies.
  const inv = firstInversion(doc.frequencies);
  if (inv) {
    const a = doc.frequencies[inv.at]; const b = doc.frequencies[inv.loAt];
    out.push(refuse(`frequencies[${inv.loAt}].voltageMv`,
      `${b.mhz} МГц требует ${b.voltageMv} мВ, а более ВЫСОКАЯ ${a.mhz} МГц — только ${a.voltageMv} мВ. `
      + 'Более высокой частоте не может хватать меньшего напряжения: либо замер ошибочен, либо это тот редкий случай, '
      + 'который владелец назвал сам, — и тогда его записывают явно, а не проносят молча'));
  }

  return out;
}

/**
 * The first place where a LOWER frequency demands MORE voltage than the higher one above it in the
 * table (the table runs high → low). `null` when the table is consistent.
 *
 * ⚠️ **ONLY MEASURED ROWS ARE COMPARED, and that is a correction paid for by running the sweep**
 * (`plans/15` §4.5, 2026-08-16). An inversion is a contradiction between two MEASUREMENTS — «this
 * frequency costs more than a higher one» — and a row still carrying its FACTORY voltage is not a
 * measurement, it is the absence of one. A sweep walks top-down, so between the frequency it just
 * closed and the ones it has not reached yet there is ALWAYS an apparent inversion: the closed row
 * dropped to its measured voltage while its lower neighbours still hold the higher factory value.
 * Comparing those two reddened on every single point and stopped the sweep at its first write —
 * **a guard causing the very regression it exists to prevent**, which is the trap R12 and R13 both
 * name and which the first version of R13's check fell into as well.
 *
 * What this deliberately does NOT weaken: a FINISHED document has no unmeasured rows, so every
 * comparison it can make is still made. And the comparison walks CONSECUTIVE MEASURED rows rather
 * than adjacent ones — an unmeasured gap between two measurements does not excuse a contradiction
 * across it.
 *
 * The boundary, stated because it is the thing this correction moves rather than removes: a partially
 * swept document is CONSISTENT but not APPLICABLE — a frequency still at stock cannot be served the
 * factory voltage once a HIGHER frequency has been made cheaper, because the card serves a clock with
 * the lowest entry that reaches it. Applying is epic 02's phase 5 and that is where the applicability
 * check belongs; refusing to SAVE knowledge because it is incomplete would simply lose it.
 *
 * [TESTED: 2026-08-16 00:3x, OFFLINE · 4 blocks in `curve --selftest` — an inversion between two
 *  MEASURED rows is caught and names both frequencies; equal voltages are not an inversion; an
 *  UNMEASURED row is not one either; and a contradiction ACROSS an unmeasured gap still is.
 *  Mutation 63 (judge unmeasured rows too) reddens the last two and stops the sweep in `engine
 *  --selftest` as well — which is the regression this correction removed.]
 */
export function firstInversion(rows) {
  const measured = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Number.isFinite(r?.voltageMv)) continue;
    if (r.status === CURVE_STATUS.STOCK || r.status === CURVE_STATUS.PROBING) continue;
    measured.push({ at: i, mv: r.voltageMv });
  }
  for (let k = 0; k + 1 < measured.length; k++) {
    if (measured[k + 1].mv > measured[k].mv) return { at: measured[k].at, loAt: measured[k + 1].at };
  }
  return null;
}

// =================================================================================================
// 2a. THE ONE MUTATOR — how a measured frequency enters the document (`plans/15` §4.5)
// =================================================================================================

/**
 * CLOSE ONE FREQUENCY, AND KEEP THE DOCUMENT A DOCUMENT.
 *
 * This is the ONLY way a sweep's result reaches the artifact, and it lives here rather than in the
 * engine because R14a says this module is the document's single author: a second writer would be a
 * second truth about what the silicon proved, which is the shape R1 forbids for the card itself.
 *
 * ─── IT DOES THREE THINGS, AND THE SECOND AND THIRD ARE NOT DECORATION ────────────────────────────
 *
 * **(1) It writes the measured row.** Frequency, the voltage that now serves it, the status from the
 * CLOSED vocabulary, the witness, the date. Every refusal names the field, because a mutator that
 * silently drops a bad value is how a document becomes a rumour.
 *
 * **(2) It carries the value DOWN to the rest of the rung — and that is not interpolation** (E2-AC3,
 * the criterion this project measures itself against, and the exact thing the vendor's OC Scanner
 * does that we do not). The card has 127 voltage rungs for 389 frequencies, so neighbouring
 * frequencies SHARE a voltage by construction; a rung's frequencies are burned at the HIGHEST of
 * them, and the lower ones inherit that result. The direction is what makes it safe rather than
 * convenient: **Vmin does not decrease with frequency** (setup-time violation at the edge,
 * `researches/09` §2.3, and the owner's own practice — «на более нижней частоте напряжение нужно
 * такое же или ниже»), so a voltage PROVEN at a higher frequency is not optimistic at a lower one.
 * The inherited rows carry the rung's verdict, and `provenBy` says whose burn it was — which is why
 * `provenBy` is a REQUIRED field for a proven status in the first place: a status can never stand
 * without naming its witness.
 *
 * **(3) It ratchets the frequencies ABOVE, upward, and NAMES every one it moved.** A lower frequency
 * that measures a HIGHER requirement than an already-closed higher one is the rare case the owner
 * named himself (*«очень редко — выше, почти не бывает такого»*, `plans/13` risk R8). The document
 * cannot hold it — `validateCurveDoc` refuses an inversion, and rightly, because «a higher frequency
 * needs less voltage» is physically false. The resolution is forced rather than chosen: shipping the
 * higher frequency at a voltage a LOWER frequency demonstrably failed at would be shipping a known
 * failure, so the higher rows come UP to the measured value. Raising is the safe direction and it
 * invents no measurement — it refuses to keep one that a neighbour's measurement contradicts. The
 * epic already expects this vocabulary at its phase-4 gate: *«поднятые храповиком частоты названы»*
 * (`plans/13` §4), and `raised` is what names them.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────────
 *
 * It does not save. Persistence is `saveCurveDoc` and it is atomic; keeping them apart is what lets
 * the sweep validate the RESULT before it reaches the disk, so a document that would fail its own
 * validator never becomes the file the next session trusts.
 *
 * @param {object} doc  the tuning-curve document; NOT mutated — a new one is returned
 * @param {object} a
 * @param {number} a.mhz            the frequency that was burned
 * @param {number} a.voltageMv      the voltage that now serves it — must be on the card's grid
 * @param {string} a.status         from `CURVE_STATUS`; the vocabulary is closed
 * @param {string} [a.provenBy]     the witness — REQUIRED for a proven status
 * @param {number} [a.inheritDownToMhz]  the bottom of this rung; rows in [that, mhz) inherit
 * @param {string} [a.at]           the stamp; defaults to now, local ISO
 * @returns {{ok:boolean, doc:object, closed:number, inherited:Array, raised:Array, why:string}}
 *
 * [TESTED: 2026-08-16 00:3x, OFFLINE · 7 blocks in `engine --selftest` (inheritance down the rung and
 *  its witness, the refusal of upward inheritance, the ratchet naming every frequency it moved, the
 *  closed vocabulary, the card's grid, the missing witness). Mutations 57 (drop the ratchet) and 60
 *  (allow upward inheritance) each redden their own block. **NOT TESTED: never called against the
 *  production `curves/measured.json`.**]
 */
export function closePoint(doc, {
  mhz = null,
  voltageMv = null,
  status = null,
  provenBy = null,
  inheritDownToMhz = null,
  at = null,
} = {}) {
  const no = (why) => ({ ok: false, doc, closed: 0, inherited: [], raised: [], why });
  if (!doc || !Array.isArray(doc.frequencies) || doc.frequencies.length === 0) {
    return no('документ кривой пуст — закрывать частоту не в чем');
  }
  if (!Number.isFinite(mhz)) return no('частота не названа');
  if (!Number.isFinite(voltageMv)) return no(`напряжение для ${mhz} МГц не названо`);
  if (!STATUS_VALUES.includes(status)) {
    return no(`неизвестный статус ${JSON.stringify(status)}; словарь закрыт: ${STATUS_VALUES.join(', ')}`);
  }
  if (PROVEN_STATUSES.includes(status) && (typeof provenBy !== 'string' || provenBy.trim() === '')) {
    return no(`статус «${status}» утверждает, что частоту доказал прожиг — тогда назови форму нагрузки и вердикт; `
      + 'статус без свидетеля это заявление, а не улика');
  }
  const grid = Array.isArray(doc.voltageGridMv) ? doc.voltageGridMv : [];
  if (grid.length && !grid.includes(voltageMv)) {
    return no(`${voltageMv} мВ нет на сетке напряжений карты — такого напряжения у неё попросить нельзя`);
  }

  const rows = doc.frequencies.map((r) => ({ ...r }));
  const idx = rows.findIndex((r) => r.mhz === mhz);
  if (idx < 0) return no(`частоты ${mhz} МГц нет в документе — она не с сетки этой карты`);
  if (Number.isFinite(rows[idx].stockVoltageMv) && voltageMv > rows[idx].stockVoltageMv) {
    return no(`${voltageMv} мВ ВЫШЕ стокового ${rows[idx].stockVoltageMv} мВ для ${mhz} МГц: тюнинг снижает напряжение частоты, а не поднимает`);
  }

  const stamp = at ?? localIso();

  // ---- (1a) ХРАПОВИК ДЛЯ САМОЙ ЗАКРЫВАЕМОЙ СТРОКИ — та же R17, прочитанная с другой стороны.
  //
  // Пункт (3) ниже поднимает ЧУЖИЕ строки: те, что ВЫШЕ по частоте и оказались дешевле только что
  // измеренной. Но бывает зеркальный случай, и живой прогон его принёс (2026-08-16, полоса
  // 3082…3015): закрывается 3045 МГц на 1020 мВ, а уже измеренная БОЛЕЕ НИЗКАЯ 3037 требует 1025.
  // Поднимать здесь надо ЭТУ строку, а поднимать её было некому — и документ отвергался целиком,
  // останавливая прогон на честном замере.
  //
  // Направление то же, что у пункта (3), и по той же причине: Vmin не убывает с частотой (нарушение
  // setup-времени, `researches/09` §2.3), поэтому более высокой частоте не может хватать меньшего
  // напряжения. **Поднимать — безопасно и ничего не выдумывает**, опускать соседку было бы отгрузкой
  // напряжения, на котором она уже провалилась. Слово владельца об этом случае: «очень редко — выше,
  // почти не бывает такого», то есть он назван возможным, значит движок обязан уметь его встретить.
  let effectiveMv = voltageMv;
  let ratchetedBy = null;
  for (let k = idx + 1; k < rows.length; k++) {          // таблица идёт высокие → низкие
    const r = rows[k];
    if (r.status === CURVE_STATUS.STOCK || r.status === CURVE_STATUS.PROBING) continue;
    if (!Number.isFinite(r.voltageMv) || r.voltageMv <= effectiveMv) continue;
    effectiveMv = r.voltageMv;
    ratchetedBy = r.mhz;
  }
  if (ratchetedBy !== null) {
    if (Number.isFinite(rows[idx].stockVoltageMv) && effectiveMv > rows[idx].stockVoltageMv) {
      return no(`храповик хотел поднять ${mhz} МГц до ${effectiveMv} мВ (столько требует более низкая `
        + `${ratchetedBy} МГц), а её собственный сток всего ${rows[idx].stockVoltageMv} мВ. Выше стока не `
        + 'поднимаем, и молча оставить инверсию тоже нельзя — этот замер противоречит стоковой таблице');
    }
    if (grid.length && !grid.includes(effectiveMv)) {
      return no(`храповик хотел поднять ${mhz} МГц до ${effectiveMv} мВ, а такого напряжения нет на сетке карты`);
    }
  }

  // ---- the measured row itself
  rows[idx] = {
    ...rows[idx],
    voltageMv: effectiveMv,
    status,
    provenBy: ratchetedBy === null ? provenBy
      : `${provenBy} · ПОДНЯТО ХРАПОВИКОМ с ${voltageMv} до ${effectiveMv} мВ: более низкая ${ratchetedBy} МГц `
        + 'потребовала больше, а более высокой не может хватать меньшего',
    editedAt: stamp,
  };

  // ---- (2) the rest of the rung inherits, DOWNWARD ONLY. The table runs high → low, so the rows
  // that inherit are the ones AFTER this index.
  const inherited = [];
  if (Number.isFinite(inheritDownToMhz)) {
    if (inheritDownToMhz > mhz) {
      return no(`наследование идёт ВНИЗ по частоте: ${inheritDownToMhz} МГц не ниже ${mhz} МГц. `
        + 'Вверх наследовать нельзя — там напряжения требуется не меньше, а это и есть небезопасное направление');
    }
    for (let k = idx + 1; k < rows.length; k++) {
      if (!Number.isFinite(rows[k].mhz) || rows[k].mhz < inheritDownToMhz) break;
      // Inside one rung every stock voltage is the same by construction; a caller that hands over a
      // range straddling rungs would silently ship a frequency ABOVE its own stock, and that is a
      // refusal rather than a clamp — a clamp would hide the caller's bug in the artifact.
      if (Number.isFinite(rows[k].stockVoltageMv) && effectiveMv > rows[k].stockVoltageMv) {
        return no(`наследование ${effectiveMv} мВ от ${mhz} МГц не годится для ${rows[k].mhz} МГц: там сток `
          + `${rows[k].stockVoltageMv} мВ, то есть УЖЕ дешевле доказанного. Диапазон наследования пересёк ступень напряжения`);
      }
      rows[k] = {
        ...rows[k],
        voltageMv: effectiveMv,
        status,
        provenBy: `${provenBy ?? ''} · унаследовано ступенью от ${mhz} МГц (прожиг там): Vmin не убывает с частотой, `
          + 'значит доказанное выше по частоте не оптимистично ниже (E2-AC3 — не интерполяция, а тот же измеренный факт)',
        editedAt: stamp,
      };
      inherited.push(rows[k].mhz);
    }
  }

  // ---- (3) the ratchet, UPWARD, and every moved frequency is named
  const raised = [];
  for (let k = idx - 1; k >= 0; k--) {
    const r = rows[k];
    // A row still at its FACTORY value is not a measurement, and the ratchet exists to reconcile two
    // measurements that contradict each other. Raising an untouched row would be inventing one — and
    // it cannot be needed anyway: the factory table is monotone, so a stock row above already carries
    // at least as much as this frequency's stock, hence at least as much as anything we ship for it.
    if (r.status === CURVE_STATUS.STOCK || r.status === CURVE_STATUS.PROBING) continue;
    if (!Number.isFinite(r.voltageMv) || r.voltageMv >= effectiveMv) continue;
    if (Number.isFinite(r.stockVoltageMv) && effectiveMv > r.stockVoltageMv) {
      return no(`храповик хотел поднять ${r.mhz} МГц до ${effectiveMv} мВ, а её сток всего ${r.stockVoltageMv} мВ — `
        + 'выше стока не поднимаем, и молча оставить инверсию тоже нельзя. Замер противоречит стоковой таблице');
    }
    raised.push({ mhz: r.mhz, fromMv: r.voltageMv, toMv: effectiveMv });
    rows[k] = {
      ...r,
      voltageMv: effectiveMv,
      provenBy: `${r.provenBy ?? 'сток'} · ПОДНЯТО ХРАПОВИКОМ до ${effectiveMv} мВ измерением на ${mhz} МГц: `
        + 'более низкая частота потребовала больше, а более высокой не может хватать меньшего',
      editedAt: stamp,
    };
  }

  const closed = 1 + inherited.length;
  return {
    ok: true,
    doc: { ...doc, frequencies: rows },
    closed,
    inherited,
    raised,
    why: `${mhz} МГц закрыта: ${voltageMv} мВ, статус «${status}»`
      + (inherited.length ? ` · ступень унаследовали ${inherited.length} частот(ы) до ${inheritDownToMhz} МГц` : '')
      + (raised.length ? ` · ⚠️ ХРАПОВИК ПОДНЯЛ ${raised.length} частот(у) выше: ${raised.map((x) => `${x.mhz} МГц ${x.fromMv}→${x.toMv} мВ`).join(', ')}` : ''),
  };
}

// =================================================================================================
// 3. Persistence — atomic, because a hang is a NORMAL event here
// =================================================================================================

export function saveCurveDoc(doc, { name = 'measured', dir = CURVES_DIR, fs = null } = {}) {
  return writeJsonAtomic(curvePath(name, dir), doc, { fs });
}

export function loadCurveDoc({ name = 'measured', dir = CURVES_DIR } = {}) {
  const file = curvePath(name, dir);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

// =================================================================================================
// 4. The conversion to what the hardware takes — COMPUTED, never stored
// =================================================================================================

/**
 * Turn «frequency → voltage» into the per-entry frequency offsets the card's table accepts.
 *
 * ─── THIS FUNCTION IS WHERE THE OWNER'S FRAMING PAYS OFF ────────────────────────────────────────
 *
 * The document says what each frequency must cost. The hardware says «I have 127 entries, each at a
 * fixed voltage; tell me each entry's frequency». So for every entry at voltage V we ask the document
 * one question: **what is the highest frequency our table says V can serve?** — and that becomes the
 * entry's frequency. The offset is that frequency minus what the entry reads RIGHT NOW.
 *
 * Because the current reading is taken live, the same document produces different offsets at 40 °C
 * and at 57 °C — and the RESULT is identical: every frequency gets the voltage we measured for it.
 * Storing the offsets instead would have frozen one temperature into the artifact.
 */
export function offsetsFor(doc, tablePoints, { count = CURVE_GRAPHICS_POINT_COUNT } = {}) {
  const rows = doc.frequencies;
  const offsets = new Array(count).fill(0);
  const served = new Array(count).fill(null);
  const lo = CLOCK_OFFSET_MIN_MHZ ?? -1000;
  const hi = CLOCK_OFFSET_MAX_MHZ ?? 1000;
  let clamped = 0;

  for (let j = 0; j < count; j++) {
    const entry = tablePoints[j];
    if (!entry || entry.freqKhz <= 0) continue;
    // The highest frequency this voltage is allowed to serve, per the document. Rows run high → low,
    // so the FIRST row whose voltage fits is the answer.
    const row = rows.find((r) => r.voltageMv <= entry.mv);
    if (!row) continue;
    served[j] = row.mhz;
    const want = row.mhz - entry.mhz;
    // Never LOWER an entry: pushing entries down is what a mode's ceiling does, and a ceiling is a
    // mode's knob applied on top of this — not part of the measurement (`plans/14` §4.3).
    const off = Math.max(0, Math.min(want, hi));
    if (want > hi) clamped++;
    offsets[j] = Math.max(lo, off);
  }
  return { offsets, served, clamped };
}

// =================================================================================================
// 5. The pair check: the document against the live card
// =================================================================================================

/**
 * The truth↔mirror check of `plans/14` F1-AC4, re-expressed in the owner's coordinates.
 *
 * What is held against the card is **the voltage grid** — the set of rungs the card offers. Those do
 * not move. What deliberately is NOT compared is the stock voltage per frequency: a warmer card wants
 * more voltage for the same frequency, and an instrument that reddens because the room warmed up is
 * an instrument nobody will keep running.
 */
export function verifyAgainstCard(doc, tablePoints, { card = null } = {}) {
  const problems = [];
  const liveGrid = [...new Set(tablePoints.slice(0, CURVE_GRAPHICS_POINT_COUNT).map((p) => p.mv))].sort((a, b) => a - b);
  const stored = doc.voltageGridMv ?? [];

  if (liveGrid.length !== stored.length) {
    problems.push({ field: 'voltageGridMv', why: `у карты ${liveGrid.length} ступеней напряжения, в документе ${stored.length}` });
  } else {
    for (let i = 0; i < liveGrid.length; i++) {
      if (liveGrid[i] !== stored[i]) {
        problems.push({
          field: `voltageGridMv[${i}]`,
          why: `в документе ${stored[i]} мВ, у карты ${liveGrid[i]} мВ`
            + ` · штамп документа: драйвер ${doc.stamp?.driver}, VBIOS ${doc.stamp?.vbios}`
            + (card ? ` · карта сейчас: драйвер ${card.driver}, VBIOS ${card.vbios}` : ''),
        });
        break;
      }
    }
  }
  if (card && doc.stamp && (doc.stamp.driver !== card.driver || doc.stamp.vbios !== card.vbios)) {
    problems.push({
      field: 'stamp',
      why: `кривая снята на драйвере ${doc.stamp.driver} / VBIOS ${doc.stamp.vbios}, а карта сейчас `
        + `${card.driver} / ${card.vbios} — по правилу R6 каждая запись недействительна до перепроверки`,
    });
  }
  return { ok: problems.length === 0, problems, compared: stored.length };
}

// =================================================================================================
// 6. The CLI
// =================================================================================================

const H = (t) => `\n${t}\n${'─'.repeat(Math.min(t.length, 96))}`;

async function readLiveTable() {
  const { readLiveCurvePoints } = await import('./card-grids.mjs');
  return readLiveCurvePoints();
}

async function cmdGrids() {
  console.log(H('СЛОВАРИ КАРТЫ — только чтение (ideas/03 шаги 3–4)'));
  const grids = await buildGrids({});
  for (const [kind, g] of [['напряжений', grids.voltage], ['частот', grids.frequency]]) {
    const bad = validateGrid(g, { kind: g.kind.replace('-grid', '') });
    console.log(`\nСЛОВАРЬ ${kind.toUpperCase()}: ${g.count} значений · ${g.kind === 'voltage-grid'
      ? `${g.rangeMv[0]}…${g.rangeMv[1]} мВ · ступени ${g.spacingsMv.map((s) => `${s.mv} мВ ×${s.count}`).join(' · ')} · равномерна: ${g.uniform ? 'да' : 'НЕТ'}`
      : `${g.rangeMhz[0]}…${g.rangeMhz[1]} МГц · шаги ${g.stepsMhz.map((s) => `${s.mhz} ×${s.count}`).join(' · ')} · максимум экземпляра ${g.maxGraphicsMhz} МГц (потолок R13)`}`);
    console.log(`  переснимается: ${g.probe}`);
    console.log(`  проверка формата: ${bad.length === 0 ? 'ЧИСТО' : `ОТКАЗ — ${bad.map((b) => `${b.field}: ${b.why}`).join(' · ')}`}`);
  }
  const written = writeGrids(grids);
  console.log(`\nЗАПИСАНО: ${written.voltage}\n          ${written.frequency}`);
  return 0;
}

async function cmdInit({ force = false } = {}) {
  console.log(H('ТЮНИНГ-КРИВАЯ — посев: каждой частоте её стоковое напряжение (ideas/03 шаг 5)'));
  const existing = loadCurveDoc();
  if (existing && !force) {
    const s = summarize(existing);
    console.log(`ОТКАЗ: ${curvePath()} уже существует.`);
    console.log(`  частот ${s.total} · закрыто ${s.closed} · доказано прожигом ${PROVEN_STATUSES.reduce((n, k) => n + (s.byStatus[k] ?? 0), 0)}`);
    console.log('  Пересев СТЁР БЫ найденный край. Если это и требуется — `--init --force`.');
    return 1;
  }
  const freq = loadGrid('frequency');
  if (!freq) {
    console.log('ОТКАЗ: словаря частот нет. Сперва `npm run curve -- --grids`.');
    return 1;
  }
  const info = probeGpuInfo();
  const table = await readLiveTable();
  const doc = initFromCard({
    frequencyGrid: freq,
    tablePoints: table,
    card: { name: String(info.name), maxGraphicsMhz: Number(info['clocks.max.graphics']) },
    stamp: { driver: String(info.driver_version), vbios: String(info.vbios_version), takenAt: localIso() },
    // The temperature is part of the reading: at 57 °C the same frequency wants more voltage than
    // cold. It is recorded so the STOCK column can be read honestly, not so anything is chased.
    tempC: Number(info['temperature.gpu']) || null,
  });
  const bad = validateCurveDoc(doc, { card: doc.card, frequencyGrid: freq });
  if (bad.length) {
    console.log(`ОТКАЗ: свежепосеянный документ не проходит собственный валидатор — это дефект кода, а не данных:\n  ${bad.slice(0, 5).map((b) => `${b.field}: ${b.why}`).join('\n  ')}`);
    return 1;
  }
  const file = saveCurveDoc(doc);
  const s = summarize(doc);
  console.log(`ПОСЕЯНО: ${file}`);
  console.log(`  частот ${s.total} · ${doc.frequencies[doc.frequencies.length - 1].mhz}…${doc.frequencies[0].mhz} МГц`);
  console.log(`  ступеней напряжения у карты: ${doc.voltageGridMv.length} (${doc.voltageGridMv[0]}…${doc.voltageGridMv[doc.voltageGridMv.length - 1]} мВ)`);
  console.log(`  снято при ${doc.stamp.tempC ?? '—'} °C · всё пока стоковое, тюнинга ноль`);
  return 0;
}

function cmdShow() {
  const doc = loadCurveDoc();
  if (!doc) { console.log(`Документа кривой нет: ${curvePath()}. Посеять — \`npm run curve -- --init\`.`); return 1; }
  console.log(H(`ТЮНИНГ-КРИВАЯ «${doc.name}» · ${doc.card?.name ?? '—'} · драйвер ${doc.stamp?.driver}, VBIOS ${doc.stamp?.vbios}, снята ${doc.stamp?.takenAt} при ${doc.stamp?.tempC ?? '—'} °C`));
  const s = summarize(doc);
  console.log(`\nЧАСТОТ ${s.total} · закрыто ${s.closed} · оттюнено ${s.tuned}`
    + (s.tuned ? ` · глубже всего −${s.deepestCutMv} мВ, в среднем −${s.averageCutMv} мВ` : ''));
  console.log(`ПО СТАТУСАМ: ${Object.entries(s.byStatus).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log('\n   МГц    сток мВ   стало мВ   снято  статус             правлена');
  for (const r of doc.frequencies) {
    const cut = (r.stockVoltageMv ?? 0) - (r.voltageMv ?? 0);
    if (cut === 0 && r.status === CURVE_STATUS.STOCK && r.mhz % 100 > 8) continue;
    console.log(`  ${String(r.mhz).padStart(5)} ${String(r.stockVoltageMv).padStart(9)} ${String(r.voltageMv).padStart(10)} ${String(cut).padStart(7)}  ${r.status.padEnd(18)} ${r.editedAt}`);
  }
  console.log('\n(нетронутые стоковые частоты печатаются примерно через сотню МГц — остальные были бы шумом)');
  const bad = validateCurveDoc(doc, { card: doc.card, frequencyGrid: loadGrid('frequency') });
  console.log(`\nВАЛИДАТОР: ${bad.length === 0 ? 'ЧИСТО' : `ОТКАЗ (${bad.length})\n  ${bad.slice(0, 8).map((b) => `${b.field}: ${b.why}`).join('\n  ')}`}`);
  return bad.length === 0 ? 0 : 1;
}

async function cmdVerify() {
  const doc = loadCurveDoc();
  if (!doc) { console.log(`Документа кривой нет: ${curvePath()}.`); return 1; }
  console.log(H('СВЕРКА ДОКУМЕНТА С ЖИВОЙ КАРТОЙ (пара «правда ↔ зеркало»)'));
  const info = probeGpuInfo();
  const table = await readLiveTable();
  const r = verifyAgainstCard(doc, table, {
    card: { driver: String(info.driver_version), vbios: String(info.vbios_version) },
  });
  console.log(`\nСверено ступеней напряжения: ${r.compared}. Стоковые напряжения частот НЕ сверяются: `
    + `при нагреве та же частота требует больше, и прибор краснел бы от прогретой комнаты (карта сейчас ${info['temperature.gpu']} °C).`);
  if (r.ok) { console.log('РАСХОЖДЕНИЙ НЕТ.'); return 0; }
  console.log(`РАСХОЖДЕНИЯ (${r.problems.length}):`);
  for (const p of r.problems) console.log(`  ${p.field}: ${p.why}`);
  return 1;
}

// =================================================================================================
// 7. Selftest — hostile fixtures, no GPU
// =================================================================================================

const GRID_MV = [800, 850, 900, 950, 1000, 1050, 1100];

function healthyDoc({ maxMhz = 3090 } = {}) {
  const at = '2026-08-15T16:20:00+03:00';
  const mhzList = [3090, 3000, 2900, 2800, 2400, 2000, 1500, 1000, 500, 180];
  const volts = [1100, 1100, 1050, 1050, 1000, 950, 900, 850, 800, 800];
  return {
    kind: 'tuning-curve', name: 'measured',
    card: { name: 'NVIDIA GeForce RTX 5070 Ti', maxGraphicsMhz: maxMhz, frequencyCount: mhzList.length },
    voltageGridMv: [...GRID_MV],
    stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: at, tempC: 44 },
    frequencies: mhzList.map((mhz, i) => ({
      mhz, voltageMv: volts[i], stockVoltageMv: volts[i],
      status: CURVE_STATUS.STOCK, provenBy: null, editedAt: at,
    })),
  };
}
const FAKE_LADDER = { values: [3090, 3000, 2900, 2800, 2400, 2000, 1500, 1000, 500, 180] };

function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const card = { maxGraphicsMhz: 3090 };
  const fieldsOf = (doc) => validateCurveDoc(doc, { card, frequencyGrid: FAKE_LADDER }).map((b) => b.field);

  console.log(H('САМОПРОВЕРКА curve-store — враждебные фикстуры, карта не нужна'));
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона (EXP-0016): словарь статусов · напряжение с сетки · '
    + 'напряжение не выше стокового · монотонность по частоте · порядок таблицы · частота с сетки карты · '
    + 'потолок R13 · штамп · свидетель прожига · атомарная запись · перевод в смещения · сверка сетки');

  console.log('\n— ЗДОРОВЫЙ ДОКУМЕНТ —');
  ok('чистый документ принимается', fieldsOf(healthyDoc()).length === 0, JSON.stringify(fieldsOf(healthyDoc()).slice(0, 3)));
  ok('сводка: ничего не оттюнено на посеве', summarize(healthyDoc()).tuned === 0);
  ok('сводка считает глубину среза', (() => {
    const d = healthyDoc(); d.frequencies[0].voltageMv = 1000; d.frequencies[1].voltageMv = 1000;
    const s = summarize(d); return s.tuned === 2 && s.deepestCutMv === 100;
  })());

  console.log('\n— ФОРМА И ОБЯЗАТЕЛЬНЫЕ ПОЛЯ —');
  const cases = [
    ['не объект', () => null, '<кривая>'],
    ['чужой kind', () => ({ ...healthyDoc(), kind: 'profile' }), 'kind'],
    ['нет штампа', () => { const d = healthyDoc(); delete d.stamp; return d; }, 'stamp'],
    ['takenAt в Z', () => { const d = healthyDoc(); d.stamp.takenAt = '2026-08-15T13:20:00Z'; return d; }, 'stamp.takenAt'],
    ['нет сетки напряжений', () => { const d = healthyDoc(); d.voltageGridMv = []; return d; }, 'voltageGridMv'],
    ['пустая таблица частот', () => { const d = healthyDoc(); d.frequencies = []; return d; }, 'frequencies'],
    ['неизвестное поле строки', () => { const d = healthyDoc(); d.frequencies[3].hz = 1; return d; }, 'frequencies[3].hz'],
    ['статуса нет в словаре', () => { const d = healthyDoc(); d.frequencies[3].status = 'почти-хорошо'; return d; }, 'frequencies[3].status'],
    ['нет даты правки', () => { const d = healthyDoc(); d.frequencies[3].editedAt = 'вчера'; return d; }, 'frequencies[3].editedAt'],
  ];
  for (const [name, make, expect] of cases) {
    const fields = fieldsOf(make());
    ok(`${name} → ${expect}`, fields.includes(expect), `получено ${JSON.stringify(fields.slice(0, 3))}`);
  }

  console.log('\n— ЧАСТОТА: только с сетки карты, только сверху вниз, не выше максимума —');
  ok('частоты нет на сетке карты', fieldsOf((() => { const d = healthyDoc(); d.frequencies[4].mhz = 2401; return d; })()).includes('frequencies[4].mhz'));
  ok('порядок таблицы нарушен', (() => {
    const d = healthyDoc();
    [d.frequencies[2], d.frequencies[3]] = [d.frequencies[3], d.frequencies[2]];
    return fieldsOf(d).some((f) => f.startsWith('frequencies[') && f.endsWith('.mhz'));
  })());
  ok('R13: частота выше максимума карты отвергается', (() => {
    const d = healthyDoc();
    d.frequencies[0].mhz = 3200;
    const bad = validateCurveDoc(d, { card, frequencyGrid: null }).find((b) => b.field === 'frequencies[0].mhz');
    return Boolean(bad) && bad.why.includes('3090');
  })());

  console.log('\n— НАПРЯЖЕНИЕ: только ступень сетки, только вниз от стока —');
  ok('напряжения нет на сетке карты, и отказ печатает саму сетку', (() => {
    const d = healthyDoc(); d.frequencies[5].voltageMv = 947;
    const bad = validateCurveDoc(d, { card, frequencyGrid: FAKE_LADDER }).find((b) => b.field === 'frequencies[5].voltageMv');
    return Boolean(bad) && bad.why.includes('ступеней');
  })());
  ok('напряжение ВЫШЕ стокового отвергается (тюнинг снижает, а не поднимает)', (() => {
    const d = healthyDoc(); d.frequencies[5].voltageMv = 1000;   // сток 950
    return fieldsOf(d).includes('frequencies[5].voltageMv');
  })());
  ok('снижение напряжения принимается', (() => {
    const d = healthyDoc(); d.frequencies[5].voltageMv = 900; d.frequencies[6].voltageMv = 900;
    return fieldsOf(d).length === 0;
  })());

  console.log('\n— МОНОТОННОСТЬ: высокой частоте не может хватать МЕНЬШЕГО напряжения —');
  ok('инверсия ловится и называет ОБЕ частоты', (() => {
    // 2000 МГц опускаем до 850, а 1500 остаётся на 900 — более НИЗКОЙ частоте нужно БОЛЬШЕ. Снижение,
    // а не повышение: иначе сработал бы соседний отказ «выше стокового» и блок зеленел бы не своей
    // причиной (EXP-0016 — мутационный проход именно за этим и нужен).
    // ⚠️ ОБЕ СТРОКИ ОБЪЯВЛЕНЫ ИЗМЕРЕННЫМИ, и это не украшение фикстуры: инверсия — противоречие
    // между двумя ЗАМЕРАМИ, а строка на заводском значении замером не является. Прежняя редакция
    // фикстуры правила одно напряжение и оставляла статус `stock`, то есть моделировала не инверсию,
    // а недомеренный документ — ровно то состояние, в котором развёртка находится всё время работы.
    const d = healthyDoc();
    for (const i of [5, 6]) { d.frequencies[i].status = CURVE_STATUS.EDGE_FOUND; d.frequencies[i].provenBy = 'прожиг'; }
    d.frequencies[5].voltageMv = 850;
    const bad = validateCurveDoc(d, { card, frequencyGrid: FAKE_LADDER }).find((b) => b.field.endsWith('.voltageMv'));
    return Boolean(bad) && bad.why.includes('1500') && bad.why.includes('2000');
  })());
  ok('равные напряжения соседних частот инверсией НЕ считаются (127 ступеней на 389 частот — они делятся)',
    firstInversion(healthyDoc().frequencies) === null);
  // — THE CORRECTION `plans/15` §4.5 PAID FOR, and it has its own block because it is what a
  // mutation must be able to break: a top-down sweep leaves EVERY closed frequency standing above
  // lower ones that still carry the factory voltage. Judging that as an inversion stopped the sweep
  // at its first write — a guard causing the regression it exists to prevent.
  ok('НЕДОМЕРЕННАЯ строка инверсией НЕ считается — иначе развёртка встанет на первой же записи', (() => {
    const d = healthyDoc();
    d.frequencies[4].status = CURVE_STATUS.EDGE_FOUND;
    d.frequencies[4].provenBy = 'прожиг';
    d.frequencies[4].voltageMv = 850;                       // 2400 МГц закрыта, 2000 и ниже ещё на стоке
    return validateCurveDoc(d, { card, frequencyGrid: FAKE_LADDER }).length === 0;
  })());
  // The assertion names BOTH frequencies rather than merely counting a refusal: 845 vs 850 could also
  // trip «not on the card's grid», and a block that greens on a neighbour's reason is a false green.
  ok('но противоречие между двумя ЗАМЕРАМИ ловится и ЧЕРЕЗ недомеренный промежуток', (() => {
    const d = healthyDoc();
    d.frequencies[4].status = CURVE_STATUS.EDGE_FOUND; d.frequencies[4].provenBy = 'прожиг';
    d.frequencies[4].voltageMv = 800;                       // 2400 МГц измерена на 800
    d.frequencies[7].status = CURVE_STATUS.EDGE_FOUND; d.frequencies[7].provenBy = 'прожиг';
    d.frequencies[7].voltageMv = 850;                       // 1000 МГц измерена ВЫШЕ, через две стоковые строки
    const bad = validateCurveDoc(d, { card, frequencyGrid: FAKE_LADDER }).find((b) => b.field.endsWith('.voltageMv'));
    return Boolean(bad) && bad.why.includes('2400') && bad.why.includes('1000');
  })());

  // ХРАПОВИК ДЛЯ САМОЙ ЗАКРЫВАЕМОЙ СТРОКИ — зеркальная половина R17, и её принёс живой прогон
  // 2026-08-16: закрывалась 3045 МГц на 1020 мВ, а уже измеренная БОЛЕЕ НИЗКАЯ 3037 требовала 1025.
  // Поднимать надо было ЭТУ строку, а поднимать её было некому — документ отвергался целиком, и
  // прогон вставал на ЧЕСТНОМ замере, закрыв 2 частоты из 10.
  // АДРЕСАТЫ: BA. убрать подъём закрываемой строки → «ЗАКРЫВАЕМАЯ СТРОКА ПОДНИМАЕТСЯ ХРАПОВИКОМ» ·
  //           BB. поднять её молча → «и подъём НАЗВАН в свидетеле».
  console.log('\n— ХРАПОВИК ДЛЯ ЗАКРЫВАЕМОЙ СТРОКИ —');
  {
    const prep = () => {
      const d = healthyDoc();
      // 2000 МГц (индекс 5) измерена ДОРОЖЕ, чем мы сейчас закроем более высокую 2400 (индекс 4)
      d.frequencies[5].status = CURVE_STATUS.EDGE_FOUND;
      d.frequencies[5].provenBy = 'прожиг sdc_fma/transient';
      d.frequencies[5].voltageMv = 850;
      return d;
    };
    // Индекс 4 — 2400 МГц (сток 1000), индекс 5 — 2000 МГц: более НИЗКАЯ частота.
    // Оба напряжения берутся С СЕТКИ фикстуры (800 · 850 · 900 …) — иначе запись отвергнется раньше
    // храповика, и блок покраснеет по чужой причине.
    const r = closePoint(prep(), {
      mhz: 2400, voltageMv: 800, status: CURVE_STATUS.EDGE_FOUND,
      provenBy: 'прожиг sdc_fma/transient', at: '2026-08-16T15:30:00+03:00',
    });
    ok('ЗАКРЫВАЕМАЯ СТРОКА ПОДНИМАЕТСЯ ХРАПОВИКОМ до того, что требует более НИЗКАЯ частота',
      r.ok === true && r.doc.frequencies[4].voltageMv === 850, JSON.stringify({ ok: r.ok, why: r.why }));
    ok('и подъём НАЗВАН в свидетеле — молча документ не правится',
      r.ok === true && /ПОДНЯТО ХРАПОВИКОМ с 800 до 850/.test(r.doc.frequencies[4].provenBy ?? ''));
    ok('после подъёма документ проходит СВОЙ ЖЕ сторож противоречия — прогон не встаёт',
      r.ok === true && validateCurveDoc(r.doc, { card, frequencyGrid: FAKE_LADDER }).length === 0);
    // И граница: выше СОБСТВЕННОГО стока не поднимаем даже ради согласованности — это уже не
    // примирение двух замеров, а противоречие со стоковой таблицей, и оно называется вслух.
    const tooHigh = (() => {
      const d = prep();
      d.frequencies[5].voltageMv = 1050;   // с сетки, и ВЫШЕ стока 2400 МГц (1000)
      return closePoint(d, {
        mhz: 2400, voltageMv: 800, status: CURVE_STATUS.EDGE_FOUND,
        provenBy: 'прожиг', at: '2026-08-16T15:30:00+03:00',
      });
    })();
    ok('но ВЫШЕ СВОЕГО СТОКА храповик не поднимает — отказ с названной причиной',
      tooHigh.ok === false && /сток/.test(tooHigh.why ?? ''));
  }

  console.log('\n— СВИДЕТЕЛЬ ПРОЖИГА —');
  ok('статус «доказано прожигом» без свидетеля отвергается', (() => {
    const d = healthyDoc(); d.frequencies[4].status = CURVE_STATUS.SHORT_BURN_PROVED;
    return fieldsOf(d).includes('frequencies[4].provenBy');
  })());
  ok('тот же статус со свидетелем принимается', (() => {
    const d = healthyDoc(); d.frequencies[4].status = CURVE_STATUS.EDGE_FOUND;
    d.frequencies[4].provenBy = 'sdc_fma/transient 10 с → SDC на 5 мВ ниже';
    return fieldsOf(d).length === 0;
  })());

  console.log('\n— ПЕРЕВОД В СМЕЩЕНИЯ: считается от ЖИВОЙ таблицы, не хранится —');
  const table = (shiftMhz = 0) => [
    { mv: 800, mhz: 500 + shiftMhz, freqKhz: 1 },
    { mv: 900, mhz: 1500 + shiftMhz, freqKhz: 1 },
    { mv: 1000, mhz: 2400 + shiftMhz, freqKhz: 1 },
    { mv: 1100, mhz: 3000 + shiftMhz, freqKhz: 1 },
  ];
  // The document is SEEDED FROM the same fake table, so «untouched» genuinely means «what the card
  // already does». Hand-writing both sides independently is how the first draft of these blocks
  // measured its own fixture's disagreement instead of the function.
  const seeded = (shift = 0) => initFromCard({
    frequencyGrid: { values: [3000, 2400, 1500, 500] },
    tablePoints: table(shift),
    card: { maxGraphicsMhz: 3090 },
    stamp: { driver: 'd', vbios: 'v', takenAt: '2026-08-15T16:20:00+03:00' },
  });
  ok('нетронутый документ даёт нулевые смещения', (() => {
    const { offsets } = offsetsFor(seeded(), table(), { count: 4 });
    return offsets.every((o) => o === 0);
  })());
  ok('снижение напряжения частоты поднимает НУЖНУЮ запись таблицы', (() => {
    const d = seeded();
    d.frequencies[0].voltageMv = 1000;                       // 3000 МГц теперь просит 1000, а не 1100
    const { offsets, served } = offsetsFor(d, table(), { count: 4 });
    // Проверяется ВЕСЬ раскрой, а не одна запись. Первая редакция этого блока смотрела только на
    // запись 1000 мВ — и оставалась зелёной, когда выбор строки ломали целиком (мутация «берёт НЕ ту
    // запись» отдавала всем записям высшую частоту). Блок, зелёный по соседней причине, EXP-0016.
    return served[0] === 500 && served[1] === 1500        // низкие напряжения обслуживают СВОИ частоты
      && served[2] === 3000 && offsets[2] === 3000 - 2400 // 1000 мВ забрала 3000 МГц у 1100
      && offsets[3] === 0 && offsets[0] === 0 && offsets[1] === 0;
  })());
  ok('ТА ЖЕ таблица при другой температуре даёт ДРУГИЕ смещения и ТОТ ЖЕ результат', (() => {
    const d = seeded();
    d.frequencies[0].voltageMv = 1000;
    const cold = offsetsFor(d, table(0), { count: 4 });
    const warm = offsetsFor(d, table(-15), { count: 4 });
    return cold.offsets[2] !== warm.offsets[2] && cold.served[2] === warm.served[2];
  })());
  ok('смещение никогда не отрицательное — придавливание это потолок режима, а не замер', (() => {
    const { offsets } = offsetsFor(seeded(), table(500), { count: 4 });
    return offsets.every((o) => o >= 0);
  })());
  ok('упор в аппаратный предел ±1000 МГц СЧИТАЕТСЯ и называется', (() => {
    const d = seeded();
    for (const r of d.frequencies) r.voltageMv = 800;         // всё на самой нижней ступени
    const { clamped } = offsetsFor(d, table(), { count: 4 });
    return clamped > 0;
  })());

  console.log('\n— СВЕРКА С КАРТОЙ: сверяется то, что НЕ ездит —');
  const tp = GRID_MV.map((mv, i) => ({ mv, mhz: 500 + i * 300, freqKhz: 1 }));
  ok('совпадающая сетка проходит', verifyAgainstCard(healthyDoc(), tp).ok);
  ok('СДВИНУТАЯ СТУПЕНЬ НАПРЯЖЕНИЯ ловится', (() => {
    const t = tp.map((p, i) => (i === 3 ? { ...p, mv: p.mv + 5 } : p));
    const r = verifyAgainstCard(healthyDoc(), t);
    return !r.ok && r.problems[0].field.startsWith('voltageGridMv');
  })());
  ok('ПРОГРЕВ (частоты таблицы уехали, напряжения те же) расхождением НЕ считается', (() => {
    const t = tp.map((p) => ({ ...p, mhz: p.mhz - 15 }));
    return verifyAgainstCard(healthyDoc(), t).ok;
  })());
  ok('другой драйвер ловится штампом (R6)', (() => {
    const r = verifyAgainstCard(healthyDoc(), tp, { card: { driver: '620.10', vbios: '98.03.58.40.8b' } });
    return !r.ok && r.problems.some((p) => p.field === 'stamp');
  })());

  console.log('\n— АТОМАРНАЯ ЗАПИСЬ: машина умирает посреди сохранения —');
  ok('обрыв ДО переименования не трогает целевой файл', (() => {
    const seen = { wrote: null, removed: false, existing: new Set(['dir']) };
    const fs = {
      existsSync: (p) => seen.existing.has(p),
      mkdirSync: () => {},
      writeFileSync: (p) => { seen.wrote = p; seen.existing.add(p); },
      renameSync: () => { throw new Error('машина умерла между записью и переименованием'); },
      rmSync: (p) => { seen.removed = true; seen.existing.delete(p); },
    };
    let threw = false;
    try { saveCurveDoc(healthyDoc(), { dir: 'dir', fs }); } catch { threw = true; }
    return threw && seen.wrote.endsWith('.tmp') && seen.removed;
  })());
  ok('успешная запись идёт через временный файл и переименование', (() => {
    const order = [];
    const fs = {
      existsSync: () => true, mkdirSync: () => {},
      writeFileSync: (p) => order.push(`write:${path.basename(p)}`),
      renameSync: (a, b) => order.push(`rename:${path.basename(a)}→${path.basename(b)}`),
      rmSync: () => order.push('rm'),
    };
    saveCurveDoc(healthyDoc(), { dir: 'dir', fs });
    return order.length === 2 && order[0].endsWith('.tmp') && order[1].includes('→measured.json');
  })());

  console.log('\n— СЛОВАРИ СЕТОК —');
  const goodFreq = {
    kind: 'frequency-grid', probe: 'nvidia-smi -q -d SUPPORTED_CLOCKS', order: 'descending',
    count: 3, rangeMhz: [180, 3090], maxGraphicsMhz: 3090, values: [3090, 3082, 180],
    stamp: { driver: '610.88', vbios: 'v', takenAt: '2026-08-15T16:20:00+03:00' },
  };
  ok('здоровый словарь частот принимается', validateGrid(goodFreq, { kind: 'frequency' }).length === 0);
  ok('словарь без команды пересъёмки отвергается', validateGrid({ ...goodFreq, probe: '' }).some((b) => b.field === 'probe'));
  ok('count разошёлся с числом значений', validateGrid({ ...goodFreq, count: 4 }).some((b) => b.field === 'count'));
  ok('объявленный порядок не совпал с фактическим', validateGrid({ ...goodFreq, values: [180, 3082, 3090] }).some((b) => b.field === 'values'));
  ok('максимум не совпал с верхом лестницы', validateGrid({ ...goodFreq, maxGraphicsMhz: 3000 }).some((b) => b.field === 'maxGraphicsMhz'));
  ok('словарь без штампа отвергается', validateGrid({ ...goodFreq, stamp: undefined }).some((b) => b.field === 'stamp'));

  console.log('\n— ПЕСОЧНИЦА —');
  ok('самопроверка не выросла в рабочем каталоге curves/', (() => {
    if (!existsSync(CURVES_DIR)) return true;
    return !readdirSync(CURVES_DIR).some((f) => f.endsWith('.tmp'));
  })());

  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

// =================================================================================================

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  if (has('--selftest')) return cmdSelftest();
  if (has('--grids')) return cmdGrids();
  if (has('--init')) return cmdInit({ force: has('--force') });
  if (has('--verify')) return cmdVerify();
  if (has('--show') || argv.length === 0) return cmdShow();
  console.log('Использование: --grids | --init [--force] | --show | --verify | --selftest');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}

export default {
  CURVE_STATUS, CURVES_DIR, initFromCard, validateCurveDoc, saveCurveDoc, loadCurveDoc,
  verifyAgainstCard, summarize, offsetsFor, firstInversion, curvePath, stockVoltageFor, leverFloorFor,
};
