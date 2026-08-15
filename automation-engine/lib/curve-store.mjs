#!/usr/bin/env node
// automation-engine/lib/curve-store.mjs — THE TUNING CURVE AS A DOCUMENT: one object per point,
// carrying what it is, how it got there, and when.
//
// Plan anchor (plans/14 §4.2, executing the owner's `ideas/03` steps 1–2 and 5): *«В JSON VF-кривой
// тюнинга видеокарты загружаются стоковые точки «напряжение — частота» в виде объектов. У точки есть
// частота, напряжение, статус и дата, когда точка в последний раз редактировалась.»*
//
// ─── WHY THIS FILE EXISTS AT ALL, IN ONE PARAGRAPH ──────────────────────────────────────────────
//
// Until today the raise lived INSIDE the profile as a bare integer array (`deltaByPointMhz`). That
// array can say «+592» and nothing else: not how the number was found, not when, not whether a burn
// ever proved it, not whether the descent stopped at the card's edge or at our own lever. The owner's
// convergence loop keeps one value PER POINT with a history — and a loop whose state has nowhere to
// live either does not get written or gets flattened back into one number. EXP-0056 is the week that
// cost. This document is the place the loop writes to.
//
// ─── THE STATUS VOCABULARY IS CLOSED, AND ITS PROOF STATUSES ARE THE OWNER'S OWN WORDS ──────────
//
// An open string field lets a future session invent a status no consumer handles. Three of the eight
// are quoted from `ideas/03` verbatim (see CURVE_STATUS below); `lever-limited` in particular exists
// to be IMPOSSIBLE to confuse with an edge — in 1700…2400 MHz the descent runs out of our ±1000 MHz
// lever before the silicon runs out, and reporting that as «край найден» would be a false [TESTED].
//
// ─── THE R13 RULE, AND WHY THE OBVIOUS VERSION OF IT IS WRONG ───────────────────────────────────
//
// «Never above the card's own maximum» cannot be checked as `mhz <= max`: the FACTORY table's top
// entry is 3172 MHz while this card's maximum applicable clock is 3090, so that check would refuse a
// document of all zeroes — a guard causing the regression it exists to prevent. What is judged is
// what WE RAISED: `offsetMhz` may not carry a point above the card's maximum, and a point the factory
// already put above it may not be raised at all. Same distinction `nvapi.buildRaiseAndCapVector`
// draws with `highestRaisedOfferMhz`; it was learned on the live card, not by reading.
//
// GPU WRITES: none. This module reads the card to SEED a document and to VERIFY one; it never writes.
//
// Usage:
//   npm run curve -- --grids     probe and store both card dictionaries (ideas/03 steps 3–4)
//   npm run curve -- --init      seed the tuning curve from the live stock curve (step 5)
//   npm run curve -- --show      print the document as a table
//   npm run curve -- --verify    hold the document against the live card (the pair check)
//   npm run curve -- --selftest  hostile fixtures, no GPU
//
// [NOT-TESTED] — born 2026-08-15 with plan 14; flips per block on the observations in its §7.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CLOCK_OFFSET_MIN_MHZ, CLOCK_OFFSET_MAX_MHZ, CURVE_GRAPHICS_POINT_COUNT } from '../config.mjs';
import { CURVES_DIR, writeJsonAtomic, loadGrid, localIso, buildGrids, writeGrids, validateGrid, probeGpuInfo } from './card-grids.mjs';

export { CURVES_DIR };

/**
 * The eight statuses a point may carry. CLOSED — an unknown status is refused, never ignored.
 *
 * The three PROOF statuses are the owner's own words from `ideas/03`, quoted rather than paraphrased,
 * because a vocabulary that drifts from the document it implements is the first thing a weak session
 * gets wrong:
 *
 *   step  9 — «точка проверена, работает, доказано коротким прожигом»  → short-burn-proved
 *   step 12 — «протестирована, край найден!»                           → edge-found
 *   step 15 — «доказаны длительным прожигом»                           → long-burn-proved
 */
export const CURVE_STATUS = Object.freeze({
  /** Untouched factory value. */
  STOCK: 'stock',
  /** A rung is IN FLIGHT — written before the card is touched, so a hang leaves this behind and the
   *  next launch knows exactly which rung killed the machine (`ideas/03` step 12, phase 2). */
  PROBING: 'probing',
  /** Held the owner's 10 s burn. */
  SHORT_BURN_PROVED: 'short-burn-proved',
  /** Failed one rung lower; parked at V_fail + 10 mV (his margin, two grid steps). */
  EDGE_FOUND: 'edge-found',
  /** Held the long burn — one minute since his amendment of 2026-08-15. */
  LONG_BURN_PROVED: 'long-burn-proved',
  /** The ±1000 MHz lever ran out BEFORE the card did. **Not an edge**, and it must never be reported
   *  as one: measured, 45 mV available at 1700 MHz against 245 at 2842 (`researches/09` §3.3). */
  LEVER_LIMITED: 'lever-limited',
  /** Sits on the card's frequency floor — no stock frequency to search. These 44 points are still the
   *  LEVERS that serve low clocks cheaply when raised; «nothing to search» is not «nothing to do». */
  CLOCK_FLOOR: 'clock-floor',
  /** The factory table puts it above the card's own maximum, so the card can never run it. Never
   *  raised. These 9 points are the 82 MHz gap `bugs/11` escaped through. */
  ABOVE_CARD_MAX: 'above-card-max',
});

const STATUS_VALUES = Object.freeze(Object.values(CURVE_STATUS));
/** The statuses that mean «a burn proved this», i.e. the ones a report may count as evidence. */
export const PROVEN_STATUSES = Object.freeze([
  CURVE_STATUS.SHORT_BURN_PROVED, CURVE_STATUS.EDGE_FOUND, CURVE_STATUS.LONG_BURN_PROVED,
]);

export const CURVE_FILE = 'measured.json';
const POINT_KEYS = Object.freeze(['i', 'voltageMv', 'stockMhz', 'mhz', 'offsetMhz', 'status', 'provenBy', 'editedAt']);
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u;
const refuse = (field, why) => ({ field, why });

export function curvePath(name = 'measured', dir = CURVES_DIR) {
  return path.join(dir, name === 'measured' ? CURVE_FILE : `${name}.json`);
}

// =================================================================================================
// 1. Seeding a document from the live card (`ideas/03` step 5)
// =================================================================================================

/**
 * Build a fresh tuning-curve document from the card's stock curve.
 *
 * Every point starts at `stock` except the two classes the card itself decides:
 *   · frequency at or below the ladder's floor → `clock-floor`
 *   · frequency above the card's own maximum   → `above-card-max`
 *
 * Those two are CLASSIFICATIONS, not verdicts — nothing has been burned. They exist so the sweep's
 * coverage count (74 of 74) is a real number rather than «74 of whatever we felt like visiting».
 */
export function initFromCard({ curvePoints, frequencyGrid, card, stamp, tempC = null, nowIso = null }) {
  const at = nowIso ?? localIso();
  const points = curvePoints.slice(0, CURVE_GRAPHICS_POINT_COUNT).map((p, i) => ({
    i,
    voltageMv: p.mv,
    stockMhz: p.mhz,
    mhz: p.mhz,
    offsetMhz: 0,
    status: classify(p.mhz, frequencyGrid),
    provenBy: null,
    editedAt: at,
  }));

  return {
    kind: 'tuning-curve',
    name: 'measured',
    card: { ...card, graphicsPointCount: points.length },
    stamp: { ...stamp, takenAt: stamp.takenAt ?? at, tempC },
    points,
  };
}

/**
 * Which class a point falls in, given the card's ladder. Pure.
 *
 * ─── THE SNAPSHOT WARNING, PAID FOR BY OBSERVATION ON THE DAY THIS WAS WRITTEN ──────────────────
 *
 * **`stockMhz` is a SNAPSHOT of a moving quantity, and so is this classification.** The curve slides
 * along the FREQUENCY axis with temperature (≈ −1.7 MHz per °C, `bugs/10`, EXP-0053) while the
 * VOLTAGE axis stands still. Measured 2026-08-15 within one hour on this card: point 120 read
 * **3112 MHz cold and 3105 MHz at 57 °C**, point 123 read **3142 → 3127**. That moved ONE point
 * across the 3090 MHz boundary, and the seeded document counted **9 points above the card's maximum
 * cold and 8 warm** — the same card, the same code, an hour apart.
 *
 * So the class stored in the file is «as of `stamp.tempC`», never a permanent property. Consumers
 * that are about to TOUCH THE CARD re-derive it from the live curve (`reclassify`), exactly as
 * `offsetMhz` is recomputed on load. The authority at write time is always the live reading; the
 * document is the memory, not the oracle.
 */
export function classify(mhz, frequencyGrid) {
  if (mhz > frequencyGrid.maxGraphicsMhz) return CURVE_STATUS.ABOVE_CARD_MAX;
  if (mhz <= frequencyGrid.minGraphicsMhz) return CURVE_STATUS.CLOCK_FLOOR;
  return CURVE_STATUS.STOCK;
}

/**
 * Re-derive `stockMhz` and the two CLASSIFICATIONS from a live curve reading, leaving every point
 * that carries a MEASUREMENT untouched.
 *
 * A point already proved by a burn keeps its status and its tuned frequency: the burn happened, and a
 * warmer card does not un-happen it. Only points whose status is still a classification (`stock`,
 * `clock-floor`, `above-card-max`) are re-derived — those were never verdicts.
 */
export function reclassify(doc, curvePoints, frequencyGrid, { nowIso = null, tempC = null } = {}) {
  const at = nowIso ?? localIso();
  const live = curvePoints.slice(0, CURVE_GRAPHICS_POINT_COUNT);
  const CLASSES = [CURVE_STATUS.STOCK, CURVE_STATUS.CLOCK_FLOOR, CURVE_STATUS.ABOVE_CARD_MAX];
  const moved = [];
  for (let i = 0; i < doc.points.length && i < live.length; i++) {
    const p = doc.points[i];
    if (!CLASSES.includes(p.status)) continue;
    const was = { stockMhz: p.stockMhz, status: p.status };
    p.stockMhz = live[i].mhz;
    p.mhz = live[i].mhz;
    p.offsetMhz = 0;
    p.status = classify(live[i].mhz, frequencyGrid);
    if (was.status !== p.status || was.stockMhz !== p.stockMhz) {
      p.editedAt = at;
      if (was.status !== p.status) moved.push({ i, from: was.status, to: p.status, wasMhz: was.stockMhz, nowMhz: p.stockMhz });
    }
  }
  doc.stamp = { ...doc.stamp, tempC };
  return { moved, reclassified: Math.min(doc.points.length, live.length) };
}

/** The coverage arithmetic the epic's E2-AC2 is counted with. Pure. */
export function summarize(doc) {
  const by = Object.fromEntries(STATUS_VALUES.map((s) => [s, 0]));
  for (const p of doc.points ?? []) by[p.status] = (by[p.status] ?? 0) + 1;
  const searchable = (doc.points ?? []).filter(
    (p) => p.status !== CURVE_STATUS.CLOCK_FLOOR && p.status !== CURVE_STATUS.ABOVE_CARD_MAX,
  ).length;
  const closed = (doc.points ?? []).filter(
    (p) => p.status === CURVE_STATUS.EDGE_FOUND || p.status === CURVE_STATUS.LEVER_LIMITED
      || p.status === CURVE_STATUS.LONG_BURN_PROVED,
  ).length;
  return { total: (doc.points ?? []).length, byStatus: by, searchable, closed };
}

// =================================================================================================
// 2. Validation — pure, provable on fixtures alone
// =================================================================================================

/**
 * @param {object} doc
 * @param {{card?: {maxGraphicsMhz:number}|null}} opts — the CARD tier runs only when a maximum is given
 * @returns {Array<{field:string,why:string}>} empty means accepted
 */
export function validateCurveDoc(doc, { card = null } = {}) {
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

  if (!Array.isArray(doc.points)) {
    return [...out, refuse('points', 'обязательный массив точек отсутствует')];
  }
  if (doc.points.length !== CURVE_GRAPHICS_POINT_COUNT) {
    out.push(refuse('points', `точек ${doc.points.length}, а графических точек у кривой ${CURVE_GRAPHICS_POINT_COUNT} `
      + '(128 записей структуры драйвера минус последняя — она не графическая). Кривая другой длины относится к другой карте'));
    return out;
  }

  const lo = CLOCK_OFFSET_MIN_MHZ ?? -1000;
  const hi = CLOCK_OFFSET_MAX_MHZ ?? 1000;
  const bound = card?.maxGraphicsMhz ?? null;

  for (let i = 0; i < doc.points.length; i++) {
    const p = doc.points[i];
    const at = `points[${i}]`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      out.push(refuse(at, 'ожидался объект точки'));
      continue;
    }
    for (const k of Object.keys(p)) {
      if (!POINT_KEYS.includes(k)) out.push(refuse(`${at}.${k}`, `неизвестное поле; известны: ${POINT_KEYS.join(', ')}`));
    }
    if (p.i !== i) out.push(refuse(`${at}.i`, `индекс внутри точки (${p.i}) не совпадает с её местом в массиве (${i}) — точка не может врать о том, кто она`));
    for (const k of ['voltageMv', 'stockMhz', 'mhz']) {
      if (!Number.isFinite(p[k])) out.push(refuse(`${at}.${k}`, `ожидалось число, получено ${JSON.stringify(p[k])}`));
    }
    if (!STATUS_VALUES.includes(p.status)) {
      out.push(refuse(`${at}.status`, `неизвестный статус ${JSON.stringify(p.status)}; словарь закрыт: ${STATUS_VALUES.join(', ')}`));
    }
    if (!LOCAL_ISO.test(String(p.editedAt))) {
      out.push(refuse(`${at}.editedAt`, `дата последней правки обязательна, локальный ISO со смещением; получено ${JSON.stringify(p.editedAt)}`));
    }

    // offsetMhz is stored for human eyes and RECOMPUTED on load (`loadCurveDoc`). Here we still check
    // it, because a file whose two numbers disagree is a file somebody hand-edited half way.
    if (Number.isFinite(p.mhz) && Number.isFinite(p.stockMhz)) {
      const derived = p.mhz - p.stockMhz;
      if (Number.isFinite(p.offsetMhz) && p.offsetMhz !== derived) {
        out.push(refuse(`${at}.offsetMhz`, `${p.offsetMhz} МГц не равен mhz − stockMhz = ${derived}; один и тот же факт записан дважды и разошёлся`));
      }
      if (!Number.isInteger(derived)) {
        out.push(refuse(`${at}.mhz`, `сдвиг ${derived} МГц не целое число — железо принимает целые мегагерцы`));
      } else if (derived < 0) {
        // The search only ever RAISES: a raise is what makes a lower-voltage point serve the same
        // clock. Pushing points down is the CAP, and the cap is computed at apply time against the
        // live curve — never frozen into the measurement (`plans/12` §8).
        out.push(refuse(`${at}.mhz`, `отрицательный сдвиг ${derived} МГц: тюнинг только ПОДНИМАЕТ точки, а придавливание — это потолок, и он считается при применении, а не хранится в замере`));
      } else if (derived < lo || derived > hi) {
        out.push(refuse(`${at}.mhz`, `сдвиг ${derived} МГц вне аппаратного диапазона ${lo}…${hi} МГц`));
      } else if (bound !== null && derived > 0) {
        // ─── R13, judged on WHAT WE RAISED ────────────────────────────────────────────────────────
        // A point the factory already put above the card's maximum may not be raised at all; a point
        // below it may not be raised past the maximum. Written as one comparison so there is no second
        // branch to forget.
        if (p.mhz > bound) {
          out.push(refuse(`${at}.mhz`, `мы подняли точку до ${p.mhz} МГц при максимуме карты ${bound} МГц`
            + (p.stockMhz > bound ? ' — эта точка и в заводской таблице выше максимума, её нельзя поднимать вовсе' : '')
            + '. Слово владельца: «НИКОГДА НЕ ГНАТЬ КАРТУ ВЫШЕ ЭТОЙ ЧАСТОТЫ» (R13, bugs/11)'));
        }
      }
    }

    // A classification must match what it claims about the card.
    if (bound !== null && p.status === CURVE_STATUS.ABOVE_CARD_MAX && Number.isFinite(p.stockMhz) && p.stockMhz <= bound) {
      out.push(refuse(`${at}.status`, `помечена above-card-max, но её заводская частота ${p.stockMhz} МГц не выше максимума карты ${bound} МГц`));
    }
    if (PROVEN_STATUSES.includes(p.status) && (typeof p.provenBy !== 'string' || p.provenBy.trim() === '')) {
      out.push(refuse(`${at}.provenBy`, `статус «${p.status}» утверждает, что точку доказал прожиг — тогда назови форму нагрузки и вердикт; статус без свидетеля это заявление, а не улика`));
    }
  }

  // ─── MONOTONICITY: measured, never inherited (`plans/12` P6-AC9/AC10) ─────────────────────────
  // Under a uniform raise monotonicity was a PROOF about the formula. A per-point vector removes the
  // proof: raising point i more than point i+1 puts a lower-voltage point above a higher-voltage one,
  // and this project has never written such a curve nor observed what the card does with it. The
  // refusal is conservative and says so — it can be lifted by a measurement.
  const inv = firstInversion(doc.points);
  if (inv) {
    out.push(refuse(`points[${inv.at}].mhz`, `кривая перестала быть монотонной: точка ${inv.at} (${doc.points[inv.at].voltageMv} мВ) `
      + `даёт ${doc.points[inv.at].mhz} МГц, а следующая ${inv.at + 1} (${doc.points[inv.at + 1].voltageMv} мВ) — только ${doc.points[inv.at + 1].mhz}. `
      + 'Такую форму эта карта никогда не получала и что она с ней делает — не измерено; отказ снимается замером, а не правкой'));
  }

  return out;
}

/** The first index where the tuned curve stops being non-decreasing, or `null`. */
export function firstInversion(points) {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]?.mhz;
    const b = points[i + 1]?.mhz;
    if (Number.isFinite(a) && Number.isFinite(b) && b < a) return { at: i };
  }
  return null;
}

// =================================================================================================
// 3. Persistence — atomic, because a hang is a NORMAL event here
// =================================================================================================

export function saveCurveDoc(doc, { name = 'measured', dir = CURVES_DIR, fs = null } = {}) {
  return writeJsonAtomic(curvePath(name, dir), doc, { fs });
}

/**
 * Load a document. `offsetMhz` is RECOMPUTED, never trusted from the file: storing a frequency and its
 * offset is one fact written twice, and the only way to make that pair impossible to drift is to
 * derive one of them every time.
 */
export function loadCurveDoc({ name = 'measured', dir = CURVES_DIR } = {}) {
  const file = curvePath(name, dir);
  if (!existsSync(file)) return null;
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  if (Array.isArray(doc.points)) {
    for (const p of doc.points) {
      if (Number.isFinite(p.mhz) && Number.isFinite(p.stockMhz)) p.offsetMhz = p.mhz - p.stockMhz;
    }
  }
  return doc;
}

/** The per-point vector the applier consumes — the document's whole point of contact with the GPU. */
export function vectorFrom(doc) {
  return doc.points.map((p) => p.mhz - p.stockMhz);
}

// =================================================================================================
// 4. The pair check: the document against the live card
// =================================================================================================

/**
 * The truth↔mirror check of `plans/14` F1-AC4. The two sides have DIFFERENT AUTHORS — the driver's
 * table and our stored copy — which is what makes this a real pair by EXP-0013's test.
 *
 * The VOLTAGE axis is what is compared, and that choice is a measurement: the curve slides along the
 * FREQUENCY axis with temperature (≈ −1.7 MHz per °C, `bugs/10`), while voltages do not move. A
 * frequency comparison would go red every time the room warmed up.
 */
export function verifyAgainstCard(doc, curvePoints, { card = null } = {}) {
  const problems = [];
  const live = curvePoints.slice(0, CURVE_GRAPHICS_POINT_COUNT);
  if (live.length !== doc.points.length) {
    problems.push({ field: 'points', why: `у карты ${live.length} графических точек, в документе ${doc.points.length}` });
    return { ok: false, problems, compared: 0 };
  }
  for (let i = 0; i < live.length; i++) {
    if (live[i].mv !== doc.points[i].voltageMv) {
      problems.push({
        field: `points[${i}].voltageMv`,
        why: `в документе ${doc.points[i].voltageMv} мВ, у карты ${live[i].mv} мВ`
          + ` · штамп документа: драйвер ${doc.stamp?.driver}, VBIOS ${doc.stamp?.vbios}`
          + (card ? ` · карта сейчас: драйвер ${card.driver}, VBIOS ${card.vbios}` : ''),
      });
      break; // The first disagreement is the finding; a hundred more are the same finding.
    }
  }
  if (card && doc.stamp && (doc.stamp.driver !== card.driver || doc.stamp.vbios !== card.vbios)) {
    problems.push({
      field: 'stamp',
      why: `кривая снята на драйвере ${doc.stamp.driver} / VBIOS ${doc.stamp.vbios}, а карта сейчас `
        + `${card.driver} / ${card.vbios} — по правилу R6 каждая запись недействительна до перепроверки`,
    });
  }
  return { ok: problems.length === 0, problems, compared: live.length };
}

// =================================================================================================
// 5. The CLI
// =================================================================================================

const H = (t) => `\n${t}\n${'─'.repeat(Math.min(t.length, 96))}`;

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
  // The write REFUSES an invalid dictionary (card-grids.writeGrids). The first live run put an empty
  // frequency grid on disk and only then printed the refusal — an artifact its own validator rejects
  // must not reach the disk at all.
  const written = writeGrids(grids);
  console.log(`\nЗАПИСАНО: ${written.voltage}\n          ${written.frequency}`);
  return 0;
}

async function cmdInit({ force = false } = {}) {
  console.log(H('ДОКУМЕНТ КРИВОЙ — посев со стоковой кривой карты (ideas/03 шаг 5)'));
  const existing = loadCurveDoc();
  if (existing && !force) {
    console.log(`ОТКАЗ: ${curvePath()} уже существует и несёт замеры.`);
    const s = summarize(existing);
    console.log(`  ${s.total} точек · закрыто ${s.closed} · доказано прожигом ${PROVEN_STATUSES.reduce((n, k) => n + (s.byStatus[k] ?? 0), 0)}`);
    console.log('  Пересев СТЁР БЫ найденный край. Если это и требуется — `--init --force`.');
    return 1;
  }
  const freq = loadGrid('frequency');
  if (!freq) {
    console.log('ОТКАЗ: словаря частот нет. Сперва `npm run curve -- --grids` — классификация точек считается по лестнице карты.');
    return 1;
  }
  const info = probeGpuInfo();
  const points = await readLiveCurvePointsSafe();
  const doc = initFromCard({
    curvePoints: points,
    frequencyGrid: freq,
    card: { name: String(info.name), maxGraphicsMhz: Number(info['clocks.max.graphics']) },
    stamp: { driver: String(info.driver_version), vbios: String(info.vbios_version), takenAt: localIso() },
    // The temperature is part of the reading, not a decoration: the curve slides ≈1.7 MHz per °C and
    // the boundary classification moves with it (see `classify`). A number without its temperature is
    // not a number on this project (fact 18).
    tempC: Number(info['temperature.gpu']) || null,
  });
  const bad = validateCurveDoc(doc, { card: doc.card });
  if (bad.length) {
    console.log(`ОТКАЗ: свежепосеянный документ не проходит собственный валидатор — это дефект кода, а не данных:\n  ${bad.map((b) => `${b.field}: ${b.why}`).join('\n  ')}`);
    return 1;
  }
  const file = saveCurveDoc(doc);
  const s = summarize(doc);
  console.log(`ПОСЕЯНО: ${file}`);
  console.log(`  точек ${s.total} · на полу частоты ${s.byStatus[CURVE_STATUS.CLOCK_FLOOR]} · выше максимума карты ${s.byStatus[CURVE_STATUS.ABOVE_CARD_MAX]}`);
  console.log(`  В РАБОЧЕЙ ПОЛОСЕ (это и есть ширина задачи): ${s.searchable}`);
  return 0;
}

async function readLiveCurvePointsSafe() {
  const { readLiveCurvePoints } = await import('./card-grids.mjs');
  return readLiveCurvePoints();
}

function cmdShow() {
  const doc = loadCurveDoc();
  if (!doc) { console.log(`Документа кривой нет: ${curvePath()}. Посеять — \`npm run curve -- --init\`.`); return 1; }
  console.log(H(`ДОКУМЕНТ КРИВОЙ — ${doc.name} · ${doc.card?.name ?? '—'} · драйвер ${doc.stamp?.driver}, VBIOS ${doc.stamp?.vbios}, снят ${doc.stamp?.takenAt}`));
  const s = summarize(doc);
  console.log(`\nВСЕГО ${s.total} · в рабочей полосе ${s.searchable} · закрыто ${s.closed}`);
  console.log(`ПО СТАТУСАМ: ${Object.entries(s.byStatus).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log('\n   #    мВ   сток МГц   стало   сдвиг  статус             правлена');
  for (const p of doc.points) {
    const moved = p.mhz !== p.stockMhz;
    if (!moved && p.status === CURVE_STATUS.STOCK && p.i % 10 !== 0) continue; // untouched stock: every tenth, the rest would be noise
    console.log(`  ${String(p.i).padStart(3)} ${String(p.voltageMv).padStart(6)} ${String(p.stockMhz).padStart(9)} ${String(p.mhz).padStart(7)} ${String(p.mhz - p.stockMhz).padStart(7)}  ${p.status.padEnd(18)} ${p.editedAt}`);
  }
  console.log('\n(нетронутые стоковые точки печатаются через десять — остальные были бы шумом)');
  const bad = validateCurveDoc(doc, { card: doc.card });
  console.log(`\nВАЛИДАТОР: ${bad.length === 0 ? 'ЧИСТО' : `ОТКАЗ (${bad.length})\n  ${bad.map((b) => `${b.field}: ${b.why}`).join('\n  ')}`}`);
  return bad.length === 0 ? 0 : 1;
}

async function cmdVerify() {
  const doc = loadCurveDoc();
  if (!doc) { console.log(`Документа кривой нет: ${curvePath()}.`); return 1; }
  console.log(H('СВЕРКА ДОКУМЕНТА С ЖИВОЙ КАРТОЙ (пара «правда ↔ зеркало»)'));
  const info = probeGpuInfo();
  const points = await readLiveCurvePointsSafe();
  const r = verifyAgainstCard(doc, points, {
    card: { driver: String(info.driver_version), vbios: String(info.vbios_version) },
  });
  console.log(`\nСверено точек: ${r.compared} по оси НАПРЯЖЕНИЯ (ось частот едет с температурой — bugs/10, поэтому сверять по ней нельзя)`);
  if (r.ok) { console.log('РАСХОЖДЕНИЙ НЕТ.'); return 0; }
  console.log(`РАСХОЖДЕНИЯ (${r.problems.length}):`);
  for (const p of r.problems) console.log(`  ${p.field}: ${p.why}`);
  return 1;
}

// =================================================================================================
// 6. Selftest — hostile fixtures, no GPU
// =================================================================================================

function healthyDoc({ n = CURVE_GRAPHICS_POINT_COUNT, maxMhz = 3090 } = {}) {
  const at = '2026-08-15T16:20:00+03:00';
  const points = [];
  for (let i = 0; i < n; i++) {
    // A plausible shape: a floor, a rising middle, and a tail the factory puts above the card's max.
    const mv = 450 + i * 5;
    const mhz = i < 20 ? 180 : Math.min(180 + (i - 19) * 28, 3172);
    points.push({
      i, voltageMv: mv, stockMhz: mhz, mhz, offsetMhz: 0,
      status: mhz > maxMhz ? CURVE_STATUS.ABOVE_CARD_MAX : (mhz <= 180 ? CURVE_STATUS.CLOCK_FLOOR : CURVE_STATUS.STOCK),
      provenBy: null, editedAt: at,
    });
  }
  return {
    kind: 'tuning-curve', name: 'measured',
    card: { name: 'NVIDIA GeForce RTX 5070 Ti', maxGraphicsMhz: maxMhz, graphicsPointCount: n },
    stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: at },
    points,
  };
}

function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const card = { maxGraphicsMhz: 3090 };
  const fieldsOf = (doc) => validateCurveDoc(doc, { card }).map((b) => b.field);

  console.log(H('САМОПРОВЕРКА curve-store — враждебные фикстуры, карта не нужна'));
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона (EXP-0016): словарь статусов · производный сдвиг · '
    + 'потолок R13 · монотонность · штамп · длина · свидетель прожига · атомарная запись · классификация · '
    + 'пересчёт классов при съезде кривой');

  console.log('\n— ЗДОРОВЫЙ ДОКУМЕНТ —');
  ok('чистый документ принимается', fieldsOf(healthyDoc()).length === 0, JSON.stringify(fieldsOf(healthyDoc()).slice(0, 3)));
  ok('сводка считает рабочую полосу', (() => { const s = summarize(healthyDoc()); return s.total === CURVE_GRAPHICS_POINT_COUNT && s.searchable > 0 && s.searchable < s.total; })());
  ok('вектор из нетронутого документа — все нули', vectorFrom(healthyDoc()).every((d) => d === 0));

  console.log('\n— ФОРМА И ОБЯЗАТЕЛЬНЫЕ ПОЛЯ —');
  const cases = [
    ['не объект', 'null', () => null, '<кривая>'],
    ['чужой kind', 'kind', () => ({ ...healthyDoc(), kind: 'profile' }), 'kind'],
    ['нет штампа', 'stamp', () => { const d = healthyDoc(); delete d.stamp; return d; }, 'stamp'],
    ['штамп без драйвера', 'stamp.driver', () => { const d = healthyDoc(); d.stamp.driver = ''; return d; }, 'stamp.driver'],
    ['takenAt в Z', 'stamp.takenAt', () => { const d = healthyDoc(); d.stamp.takenAt = '2026-08-15T13:20:00Z'; return d; }, 'stamp.takenAt'],
    ['неверная длина', 'points', () => { const d = healthyDoc(); d.points.pop(); return d; }, 'points'],
    ['индекс врёт о себе', 'points[5].i', () => { const d = healthyDoc(); d.points[5].i = 99; return d; }, 'points[5].i'],
    ['неизвестное поле точки', 'points[7].hz', () => { const d = healthyDoc(); d.points[7].hz = 1; return d; }, 'points[7].hz'],
    ['статуса нет в словаре', 'points[30].status', () => { const d = healthyDoc(); d.points[30].status = 'почти-хорошо'; return d; }, 'points[30].status'],
    ['нет даты правки', 'points[30].editedAt', () => { const d = healthyDoc(); d.points[30].editedAt = 'вчера'; return d; }, 'points[30].editedAt'],
  ];
  for (const [name, , make, expect] of cases) {
    const fields = fieldsOf(make());
    ok(`${name} → ${expect}`, fields.includes(expect), `получено ${JSON.stringify(fields.slice(0, 3))}`);
  }

  console.log('\n— СДВИГ: производный, неотрицательный, в диапазоне —');
  ok('offsetMhz разошёлся с mhz − stockMhz', fieldsOf((() => { const d = healthyDoc(); d.points[40].offsetMhz = 7; return d; })()).includes('points[40].offsetMhz'));
  ok('отрицательный сдвиг отвергается', fieldsOf((() => { const d = healthyDoc(); d.points[40].mhz -= 15; return d; })()).some((f) => f === 'points[40].mhz'));
  ok('сдвиг за ±1000 МГц отвергается', fieldsOf((() => { const d = healthyDoc(); d.points[25].mhz += 1500; return d; })()).includes('points[25].mhz'));
  ok('загрузка ПЕРЕСЧИТЫВАЕТ сдвиг, а не верит файлу', (() => {
    const d = healthyDoc(); d.points[10].mhz = d.points[10].stockMhz + 15; d.points[10].offsetMhz = 999;
    for (const p of d.points) if (Number.isFinite(p.mhz)) p.offsetMhz = p.mhz - p.stockMhz;
    return d.points[10].offsetMhz === 15;
  })());

  console.log('\n— R13: судится то, что подняли МЫ —');
  ok('НУЛЕВОЙ документ с заводским хвостом выше 3090 ПРИНИМАЕТСЯ (первая версия сторожа его отвергала)',
    fieldsOf(healthyDoc()).length === 0);
  ok('подъём точки выше максимума карты отвергается', (() => {
    const d = healthyDoc();
    const i = d.points.findIndex((p) => p.stockMhz > 2900 && p.stockMhz <= 3090);
    if (i < 0) return false;
    d.points[i].mhz = 3100; d.points[i].offsetMhz = 3100 - d.points[i].stockMhz;
    return fieldsOf(d).includes(`points[${i}].mhz`);
  })());
  ok('подъём точки, которая и в заводской таблице выше максимума, отвергается', (() => {
    const d = healthyDoc();
    const i = d.points.findIndex((p) => p.stockMhz > 3090);
    if (i < 0) return false;
    d.points[i].mhz = d.points[i].stockMhz + 8; d.points[i].offsetMhz = 8;
    const bad = validateCurveDoc(d, { card }).find((b) => b.field === `points[${i}].mhz`);
    return Boolean(bad) && bad.why.includes('нельзя поднимать вовсе');
  })());

  console.log('\n— МОНОТОННОСТЬ: измеряется, не наследуется —');
  ok('инверсия находится и называет обе точки', (() => {
    const d = healthyDoc();
    const i = d.points.findIndex((p) => p.stockMhz > 1000 && p.stockMhz < 2500);
    d.points[i].mhz = d.points[i].stockMhz + 400; d.points[i].offsetMhz = 400;
    const inv = firstInversion(d.points);
    return inv !== null && fieldsOf(d).some((f) => f.startsWith('points['));
  })());
  ok('равномерно поднятая кривая монотонна', (() => {
    const d = healthyDoc();
    for (const p of d.points) { if (p.stockMhz <= 3090 - 20) { p.mhz = p.stockMhz + 20; p.offsetMhz = 20; } }
    return firstInversion(d.points) === null;
  })());

  console.log('\n— СВИДЕТЕЛЬ ПРОЖИГА —');
  ok('статус «доказано прожигом» без свидетеля отвергается', (() => {
    const d = healthyDoc(); d.points[40].status = CURVE_STATUS.SHORT_BURN_PROVED;
    return fieldsOf(d).includes('points[40].provenBy');
  })());
  ok('тот же статус со свидетелем принимается', (() => {
    const d = healthyDoc(); d.points[40].status = CURVE_STATUS.EDGE_FOUND; d.points[40].provenBy = 'sdc_fma/transient 10 с → SDC на 5 мВ ниже';
    return fieldsOf(d).length === 0;
  })());
  ok('above-card-max на точке ниже максимума отвергается', (() => {
    const d = healthyDoc(); d.points[40].status = CURVE_STATUS.ABOVE_CARD_MAX;
    return fieldsOf(d).includes('points[40].status');
  })());

  console.log('\n— КРИВАЯ ЕЗДИТ С ТЕМПЕРАТУРОЙ: классификация это СНИМОК, а не свойство —');
  const grid = { minGraphicsMhz: 180, maxGraphicsMhz: 3090 };
  ok('classify: выше максимума карты → above-card-max', classify(3097, grid) === CURVE_STATUS.ABOVE_CARD_MAX);
  ok('classify: на полу частоты → clock-floor', classify(180, grid) === CURVE_STATUS.CLOCK_FLOOR);
  ok('classify: в полосе → stock', classify(2500, grid) === CURVE_STATUS.STOCK);
  ok('ПОГРАНИЧНАЯ ТОЧКА МЕНЯЕТ КЛАСС ПРИ СЪЕЗДЕ КРИВОЙ, и пересчёт это НАЗЫВАЕТ (наблюдено на карте 2026-08-15: 3112 → 3105 за час)', (() => {
    const d = healthyDoc();
    const i = d.points.findIndex((p) => p.stockMhz > 3090);
    if (i < 0) return false;
    const cold = d.points[i].stockMhz;                       // холодная кривая: выше максимума
    const live = d.points.map((p, k) => ({ mv: p.voltageMv, mhz: k === i ? 3085 : p.stockMhz })); // прогрелась
    const r = reclassify(d, live, grid);
    return d.points[i].status === CURVE_STATUS.STOCK
      && r.moved.some((m) => m.i === i && m.from === CURVE_STATUS.ABOVE_CARD_MAX && m.wasMhz === cold && m.nowMhz === 3085);
  })());
  ok('пересчёт НЕ трогает точку, доказанную прожигом — прогрев не отменяет случившийся прожиг', (() => {
    const d = healthyDoc();
    d.points[40].status = CURVE_STATUS.EDGE_FOUND;
    d.points[40].provenBy = 'branchy/sustained 10 с';
    d.points[40].mhz = d.points[40].stockMhz + 30;
    d.points[40].offsetMhz = 30;
    const live = d.points.map((p) => ({ mv: p.voltageMv, mhz: p.stockMhz - 7 }));
    reclassify(d, live, grid);
    return d.points[40].status === CURVE_STATUS.EDGE_FOUND && d.points[40].offsetMhz === 30;
  })());

  console.log('\n— АТОМАРНАЯ ЗАПИСЬ: машина умирает посреди сохранения —');
  ok('обрыв ДО переименования не трогает целевой файл', (() => {
    const seen = { wrote: null, renamed: false, removed: false, existing: new Set(['dir']) };
    const fs = {
      existsSync: (p) => seen.existing.has(p),
      mkdirSync: () => {},
      writeFileSync: (p, t) => { seen.wrote = p; seen.existing.add(p); },
      renameSync: () => { throw new Error('машина умерла между записью и переименованием'); },
      rmSync: (p) => { seen.removed = true; seen.existing.delete(p); },
    };
    let threw = false;
    try { saveCurveDoc(healthyDoc(), { dir: 'dir', fs }); } catch { threw = true; }
    // The target was never touched (only the temp was), the temp was cleaned, and the caller was told.
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

  console.log('\n— СВЕРКА С КАРТОЙ: пара «правда ↔ зеркало» —');
  const liveOf = (d) => d.points.map((p) => ({ mv: p.voltageMv, mhz: p.stockMhz }));
  ok('совпадающий документ проходит', verifyAgainstCard(healthyDoc(), liveOf(healthyDoc())).ok);
  ok('СДВИНУТОЕ НАПРЯЖЕНИЕ ловится и называет обе стороны', (() => {
    const d = healthyDoc();
    const live = liveOf(d);
    live[40].mv += 5;
    const r = verifyAgainstCard(d, live);
    return !r.ok && r.problems[0].field === 'points[40].voltageMv' && r.problems[0].why.includes('у карты');
  })());
  ok('СЪЕХАВШАЯ ЧАСТОТА при тех же напряжениях НЕ является расхождением (иначе прибор краснел бы от прогрева)', (() => {
    const d = healthyDoc();
    const live = liveOf(d).map((p) => ({ ...p, mhz: p.mhz - 15 }));
    return verifyAgainstCard(d, live).ok;
  })());
  ok('другой драйвер ловится штампом (R6)', (() => {
    const d = healthyDoc();
    const r = verifyAgainstCard(d, liveOf(d), { card: { driver: '620.10', vbios: '98.03.58.40.8b' } });
    return !r.ok && r.problems.some((p) => p.field === 'stamp');
  })());
  ok('другая длина кривой ловится до поточечной сверки', (() => {
    const d = healthyDoc();
    return !verifyAgainstCard(d, liveOf(d).slice(0, 100)).ok;
  })());

  console.log('\n— СЛОВАРИ СЕТОК —');
  const goodFreq = {
    kind: 'frequency-grid', probe: 'nvidia-smi -q -d SUPPORTED_CLOCKS', order: 'descending',
    count: 3, rangeMhz: [180, 3090], maxGraphicsMhz: 3090, values: [3090, 3082, 180],
    stamp: { driver: '610.88', vbios: 'v', takenAt: '2026-08-15T16:20:00+03:00' },
  };
  ok('здоровый словарь частот принимается', validateGrid(goodFreq, { kind: 'frequency' }).length === 0,
    JSON.stringify(validateGrid(goodFreq, { kind: 'frequency' })));
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
  verifyAgainstCard, summarize, vectorFrom, firstInversion, curvePath, classify, reclassify,
};
