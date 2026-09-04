// =================================================================================================
// THE CURVE MAP — one renderer for the two surfaces that draw the tuning curve (`plans/85`)
// =================================================================================================
//
// WHY ONE MODULE. Until 2026-09-04 the picture existed once, inside `tools/build-curve-map.mjs` (the
// static page). The watch window needed the same picture LIVE — and a second drawing of the same
// layers would have been the truth↔mirror pair this project pays for every time it lets one form
// (R16c, EXP-0077): the day someone fixes the axis in one file, the other quietly keeps the old one.
// So the FACTS (what to draw) and the GEOMETRY (where) live here, once; the static page and the
// window's `/curve.svg` route both call `renderCurveSvg` and decide only the skin (CSS) and the size.
//
// WHAT THE LAYERS ARE, AND WHO IS THE AUTHOR OF EACH FACT:
//   stock line   — `stockVoltageMv` of every row of the document: the point of departure;
//   our line     — the EFFECTIVE curve: for each rung of the voltage grid, the highest frequency that
//                  voltage may serve by the DOCUMENT (the question `curve-store.offsetsFor` asks of
//                  every table point; monotone by construction). Over ALL rows, because that is what
//                  lands on the card: our measurement where it beats stock, stock where it does not —
//                  so the line never runs to the RIGHT of the stock line (a line built from touched
//                  rows only did, on 2026-09-04, and read as «our tuning is worse than stock» where
//                  the card simply keeps stock). A document where NOTHING was touched draws no line
//                  at all — emptiness is drawn as emptiness (E26-AC2);
//   proven dots  — `sweep-journal.provenRungs`: the deepest voltage that PASSED at each frequency;
//   floors       — `sweep-journal.hangFloors`: the hang floors THE ENGINE HONOURS. Not re-derived
//                  here on purpose: `hangFloors` applies the owner's decision `interviews/022` = B
//                  (a hang the same frequency has refuted by a deeper PASS is removed) and the
//                  journal's corrections; a map computing its own floors disagreed with the run for
//                  four days after 2026-08-31, and the owner read «ниже него спуск не ходит» over a
//                  floor the engine had already dropped;
//   remeasure    — a RECORDED hang the engine does not honour as a floor (refuted by a deeper pass,
//                  or standing above a lower floor) and NOT yet re-attributed by a correction: the frequency's
//                  evidence contradicts itself. Drawn hollow and named «ПЕРЕМЕРИТЬ» — the one thing it asks for.
//                  The owner 2026-09-04 (plans/86): a point named «снято движком» carried no value, only the
//                  inheritance of an error; a false hang is CORRECTED in the journal, and a genuine contradiction
//                  is remeasured, after which its correction makes the point vanish. Empty layer = no caption;
//   marker       — the rung under test RIGHT NOW (the pulse's frequency · voltage · stock), a ring
//                  with a trace back to the stock voltage: the descent, seen. Only the live surface
//                  passes one.
//
// ⚠️ THE RUNG IN FLIGHT IS NOT A HANG — and `hangFloors` cannot know that. It counts an ORPHAN intent
// (no verdict yet) as a hang, which is right for a journal read at rest (the orphan IS the rung that
// killed the machine) and wrong under a LIVE sweep, where the last intent is simply the rung burning
// at this second. The live surface therefore names the rung in flight (`inFlight`), and an orphan-born
// floor at exactly that rung is dropped from the picture. The static page passes nothing and keeps
// the orphan — at rest, that is the honest reading.
//
// The journal is read ONLY through the pure readers of `sweep-journal.mjs` (`readJournal` ·
// `provenRungs` · `hangFloors` · `corrections` · `orphanIntents`) — never `resumeState`, which WRITES
// and forges a `ЗАВИС` on the rung in flight if called during a live sweep.
//
// GPU WRITES: NONE. Reads two files, returns strings.
//
// [TESTED: 2026-09-04 · `node automation-engine/lib/curve-map.mjs --selftest` — the blocks below,
//  mutation addressees named in `selfTest()` before the run]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  readJournal, provenRungs, hangFloors, corrections, orphanIntents, LINE, RUNG_OUTCOME,
} from './sweep-journal.mjs';

export const CURVE_PATH = join('curves', 'measured.json');
export const JOURNAL_PATH = join('runs', 'sweep', 'journal.jsonl');
export const UNTOUCHED_TAG = 'stop:untouched';

/** ⚡ THE LEFT EDGE OF THE AXIS — the owner's order 2026-09-04, looking at the live widget:
 *  *«и начинать график можно с 700 мВ»* (it supersedes his 2026-08-31 *«рисуй график начиная с
 *  600 мВ»*, given on the static map). The card's grid starts at 450 mV, but the lower rungs are the
 *  resting state: no tuning happens there and none will. Stretching the axis left gave a third of the
 *  sheet to a region where both lines lie on each other and squeezed the region where the work is
 *  (800…1200 mV). A cut about RESOLUTION, not about hiding data — which is why the axis caption says
 *  so on the canvas. On the battle document the cut drops exactly one row: 180 MHz at 450 mV, rest. */
export const X_FLOOR_MV = 700;

/** The static page's geometry — `assets/curve-map.html` is drawn with exactly these numbers. */
export const STATIC_SIZE = Object.freeze({
  W: 1360, H: 620, PAD: Object.freeze({ l: 74, r: 26, t: 28, b: 54 }),
  xTickMv: 50, yTickMhz: 250, r: Object.freeze({ proven: 3, floor: 3.5, remeasure: 5, marker: 7 }),
});

/** The watch window's geometry: fewer pixels, larger marks — the owner: *«шрифты крупные»*. The label
 *  sizes themselves are CSS (the skin's business), the radii and tick density are geometry. */
export const WIDGET_SIZE = Object.freeze({
  W: 760, H: 540, PAD: Object.freeze({ l: 84, r: 24, t: 48, b: 64 }),
  // Proven dots are TINY on purpose — the owner 2026-09-04, looking at the widget: *«то, что прошло тест,
  // и никак не будет использоваться — синие точки — можно очень маленькими точками рисовать, чтобы мало
  // место занимали на графике»* (their 50 % opacity is the skin's business, `build-dashboard-page.mjs`).
  xTickMv: 100, yTickMhz: 250, r: Object.freeze({ proven: 2, floor: 6, remeasure: 8, marker: 11 }),
  // The «МГц» label and the counts line sit ABOVE the plot, in the top padding: inside the plot they
  // collided with the first tick label and with the marker of a rung near the top (seen 2026-09-04).
  labelsAbove: true,
});
/** The x-axis caption — ONE string for both surfaces (a pair collapsed). NO justification in it: the
 *  owner 2026-09-04, on the widget — *«оправдание ОСЬ ОТ 700 МВ, НИЖЕ — это убрать»*. The axis's left
 *  edge is explained once, at `X_FLOOR_MV`, for the reader of the code; the reader of the picture
 *  gets the quantity and its unit — no arrow either, and the caption sits at the axis's RIGHT end
 *  (*«напряжение, мВ — убрать стрелку, переместить в правое крайнее положение»*, same day). */
export const WIDGET_X_CAPTION = 'напряжение, мВ';

// =================================================================================================
// 1. Facts — from the document and the journal, without a single number from the head
// =================================================================================================

/**
 * The highest RECORDED hang per ordered frequency, from `hung` verdicts only — never from orphans
 * (an orphan is either the rung in flight or the death `closeHangs` will record on the next launch)
 * and never from a corrected line (a corrected «hang» was an operator stop or a writer death, not a
 * card event — `writeCorrection`). This is the RECORD; which of these the engine still honours is
 * `hangFloors`' verdict, and the difference between the two maps is the `remeasure` layer.
 *
 * @returns {Map<number, {voltageMv:number, seq:number}>}
 */
export function rawHangs(records) {
  const intents = new Map(records.filter((r) => r?.state === LINE.INTENT).map((r) => [r.seq, r]));
  const fixed = corrections(records);
  const out = new Map();
  for (const v of records) {
    if (v?.state !== LINE.VERDICT || v.outcome !== RUNG_OUTCOME.HUNG || fixed.has(v.seq)) continue;
    const i = intents.get(v.seq);
    if (!i || !Number.isFinite(i.frequencyMhz) || !Number.isFinite(i.voltageMv)) continue;
    const seen = out.get(i.frequencyMhz);
    if (seen === undefined || i.voltageMv > seen.voltageMv) out.set(i.frequencyMhz, { voltageMv: i.voltageMv, seq: v.seq });
  }
  return out;
}

/**
 * Everything the picture may draw, computed once from a document and the journal's records.
 *
 * @param {object} a
 * @param {object} a.doc        the tuning-curve document (`curves/measured.json` shape)
 * @param {Array}  [a.records]  journal records as `readJournal` returns them; `[]` when there is none
 * @param {{mhz:number, mv:number}|null} [a.inFlight] the rung under test right now — the LIVE surface
 *        names it so an orphan-born floor at that rung is not drawn as a hang (see the header)
 */
export function curveFacts({ doc, records = [], inFlight = null } = {}) {
  const rows = (doc?.frequencies ?? []).filter((r) => Number.isFinite(r?.mhz)).slice().sort((a, b) => a.mhz - b.mhz);
  const grid = (doc?.voltageGridMv ?? []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  const isUntouched = (r) => (r.tags ?? []).includes(UNTOUCHED_TAG);
  const touched = rows.filter((r) => !isUntouched(r));

  // Untouched stretches — as ranges of FREQUENCY, so «where we have not been» reads without counting dots.
  const gaps = [];
  {
    let cur = null;
    for (const r of rows) {
      if (isUntouched(r)) { if (!cur) { cur = { from: r.mhz, to: r.mhz }; gaps.push(cur); } cur.to = r.mhz; } else cur = null;
    }
  }

  const proven = provenRungs(records);
  const floors = hangFloors(records);
  if (inFlight && Number.isFinite(inFlight.mhz) && Number.isFinite(inFlight.mv)) {
    const orphans = new Set(orphanIntents(records).map((o) => o.seq));
    for (const [mhz, f] of [...floors]) {
      if (orphans.has(f.seq) && mhz === inFlight.mhz && f.voltageMv === inFlight.mv) floors.delete(mhz);
    }
  }
  const remeasure = new Map();
  for (const [mhz, h] of rawHangs(records)) {
    const f = floors.get(mhz);
    if (!f || f.voltageMv < h.voltageMv) {
      remeasure.set(mhz, { voltageMv: h.voltageMv, seq: h.seq, provenMv: proven.get(mhz)?.voltageMv ?? null, floorMv: f?.voltageMv ?? null });
    }
  }

  return {
    rows, grid, touched, untouched: rows.length - touched.length, gaps, proven, floors, remeasure, isUntouched,
    stamp: doc?.stamp ?? {}, card: doc?.card ?? {},
  };
}

/**
 * ⚡ OUR LINE IS THE EFFECTIVE CURVE, NOT THE RAW COLUMN OF THE DOCUMENT (the owner, 2026-08-31:
 * *«наша VF кривая ужасная, у неё не видно равномерности»* — the raw column joins 92 measured rows
 * with 297 factory ones and saws between them). For each voltage rung of the grid: the HIGHEST
 * frequency this voltage may serve by our measurements — a maximum over the matching rows, so the
 * order of the rows is irrelevant (the first edition copied the engine's «first row that fits» and
 * drew every voltage at 180 MHz once the rows were sorted the other way: «не вижу нашего графика»).
 *
 * ⚠️ FLAT STRETCHES ARE THE HONEST ANSWER «NOT MEASURED HERE YET»: where 900 and 975 mV serve the
 * same frequency, the extra 75 mV bought nothing — we never descended past that frequency.
 *
 * ⚠️ ALL ROWS, NOT ONLY THE TOUCHED ONES — and an EMPTY line when none is touched. The first edition
 * of this module took touched rows only, reading E26-AC2 literally; the rebuilt static page then ran
 * the green line to the RIGHT of the grey one wherever a factory row outranks the measured ones —
 * a picture saying «worse than stock» about a card that keeps stock there. The card's truth is the
 * whole document, and emptiness is honoured at the document level: nothing measured → no line.
 *
 * @returns {Array<{mv:number, mhz:number}>} one point per grid rung from `xMinMv` up, ascending;
 *          `[]` when the document has no touched row at all
 */
export function effectiveCurve(facts, xMinMv = X_FLOOR_MV) {
  if (facts.touched.length === 0) return [];
  const out = [];
  for (const v of facts.grid) {
    if (v < xMinMv) continue;
    let best = null;
    for (const r of facts.rows) {
      if (!Number.isFinite(r.voltageMv) || r.voltageMv > v) continue;
      if (best === null || r.mhz > best) best = r.mhz;
    }
    if (best !== null) out.push({ mv: v, mhz: best });
  }
  return out;
}

// =================================================================================================
// 2. Geometry — plain arithmetic, so it can be checked by eye. ONE axis mapping in the repository.
// =================================================================================================

/**
 * ⚡ VOLTAGE ON X, FREQUENCY ON Y — the owner's order 2026-08-31: *«перерисуй, напряжение по оси X»*.
 * Not taste but legibility in substance: this way an undervolt is a SHIFT OF THE LINE TO THE LEFT
 * («the same frequency for less voltage»), and the horizontal distance between the grey and the
 * coloured line IS the gain in millivolts, measurable by eye. That is also how the industry draws
 * V/F curves: voltage is the independent quantity.
 */
export function curveGeometry(facts, size = STATIC_SIZE, xFloorMv = X_FLOOR_MV) {
  const { W, H, PAD } = size;
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const mhzAll = facts.rows.map((r) => r.mhz);
  const mvAll = [
    ...facts.rows.map((r) => r.stockVoltageMv), ...facts.rows.map((r) => r.voltageMv),
    ...[...facts.proven.values()].map((x) => x.voltageMv),
    ...[...facts.floors.values()].map((x) => x.voltageMv),
    ...[...facts.remeasure.values()].map((x) => x.voltageMv),
  ].filter(Number.isFinite);
  if (mhzAll.length === 0 || mvAll.length === 0) return null;
  const xMin = Math.max(xFloorMv, Math.floor((Math.min(...mvAll) - 20) / 50) * 50);
  const xMax = Math.ceil((Math.max(...mvAll) + 20) / 50) * 50;
  const yMin = Math.min(...mhzAll);
  const yMax = Math.max(...mhzAll);
  const X = (mv) => PAD.l + ((mv - xMin) / (xMax - xMin)) * plotW;
  const Y = (mhz) => PAD.t + (1 - (mhz - yMin) / (yMax - yMin)) * plotH;
  return { W, H, PAD, plotW, plotH, xMin, xMax, yMin, yMax, X, Y };
}

// =================================================================================================
// 3. The picture — SVG markup with CLASS NAMES only; every colour and font size belongs to the skin
// =================================================================================================

const n2 = (v) => Math.round(v * 10) / 10;
const polyline = (pts) => pts.map(([a, b]) => `${n2(a)},${n2(b)}`).join(' ');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * @param {object} facts   from `curveFacts`
 * @param {object} [o]
 * @param {object} [o.size]       `STATIC_SIZE` or `WIDGET_SIZE`
 * @param {number} [o.xFloorMv]   left edge of the axis
 * @param {{mhz:number, mv:number, stock?:number}|null} [o.marker] the rung under test, or nothing
 * @param {string|null} [o.xCaption] the x-axis caption; `null` → the static page's long form
 * @param {boolean} [o.summary]   print the counts line inside the picture (top right)
 * @returns {string} an `<svg>` element, or an `<svg>` carrying one `<text class="empty">` line when
 *          the document has nothing to place on axes at all
 */
export function renderCurveSvg(facts, {
  size = STATIC_SIZE, xFloorMv = X_FLOOR_MV, marker = null, xCaption = null, summary = false,
} = {}) {
  const g = curveGeometry(facts, size, xFloorMv);
  if (!g) {
    return `<svg viewBox="0 0 ${size.W} ${size.H}" role="img" aria-label="Кривая напряжений по частотам" data-remeasure="0">`
      + `<text x="${size.PAD.l}" y="${size.PAD.t + 24}" class="ax empty">документ кривой не несёт ни одной частоты — рисовать нечего</text></svg>`;
  }
  const { PAD, plotW, plotH, xMin, xMax, yMin, yMax, X, Y } = g;
  const { rows, proven, floors, remeasure, gaps } = facts;
  const r = size.r ?? STATIC_SIZE.r;

  const stockPts = rows.filter((row) => Number.isFinite(row.stockVoltageMv) && row.stockVoltageMv >= xMin)
    .map((row) => [X(row.stockVoltageMv), Y(row.mhz)]);
  const tunedPts = effectiveCurve(facts, xMin).map((e) => [X(e.mv), Y(e.mhz)]);

  const inAxes = (m, v) => m >= yMin && m <= yMax && v >= xMin && v <= xMax;

  const provenDots = [...proven.entries()].filter(([m, x]) => inAxes(m, x.voltageMv))
    .map(([m, x]) => `<circle cx="${n2(X(x.voltageMv))}" cy="${n2(Y(m))}" r="${r.proven}" class="proven">`
      + `<title>${m} МГц: самое глубокое ПРОШЕДШЕЕ ${x.voltageMv} мВ</title></circle>`).join('');

  const floorDots = [...floors.entries()].filter(([m, x]) => inAxes(m, x.voltageMv))
    .map(([m, x]) => `<circle cx="${n2(X(x.voltageMv))}" cy="${n2(Y(m))}" r="${r.floor}" class="hung">`
      + `<title>${m} МГц: ПОЛ ЗАВИСАНИЯ ${x.voltageMv} мВ — ниже него спуск не ходит (правило движка)</title></circle>`).join('');

  const refutedDots = [...remeasure.entries()].filter(([m, x]) => inAxes(m, x.voltageMv))
    .map(([m, x]) => {
      const why = Number.isFinite(x.provenMv) && x.provenMv < x.voltageMv
        ? `ПЕРЕМЕРИТЬ — записи противоречат друг другу: стресс-тест проходил на ${x.provenMv} мВ, на ${x.voltageMv - x.provenMv} мВ ГЛУБЖЕ; стеной не стоит (interviews/022 = B), поправки в журнале нет`
        : (Number.isFinite(x.floorMv)
          ? `ПЕРЕМЕРИТЬ — полом не стоит: действующий пол этой частоты — ${x.floorMv} мВ, поправки в журнале нет`
          : 'ПЕРЕМЕРИТЬ — полом не стоит, поправки в журнале нет');
      return `<circle cx="${n2(X(x.voltageMv))}" cy="${n2(Y(m))}" r="${r.remeasure}" class="hung remeasure">`
        + `<title>${m} МГц: записано зависание на ${x.voltageMv} мВ — ${why}</title></circle>`;
    }).join('');

  // The «not touched» band is a range of FREQUENCY, and frequency is on Y — so the band lies flat.
  // Y is inverted (high frequency on top), hence the top of the band comes from `g.to`.
  const gapRects = gaps.filter((gp) => gp.to > gp.from).map((gp) =>
    `<rect x="${PAD.l}" y="${n2(Y(gp.to))}" width="${plotW}" height="${n2(Y(gp.from) - Y(gp.to))}" class="gap">`
    + `<title>не тронуто: ${gp.from}…${gp.to} МГц</title></rect>`).join('');

  const xTicks = [];
  for (let v = xMin; v <= xMax; v += size.xTickMv) xTicks.push(v);
  const yTicks = [];
  for (let m = Math.ceil(yMin / size.yTickMhz) * size.yTickMhz; m <= yMax; m += size.yTickMhz) yTicks.push(m);
  const grid = [
    ...xTicks.map((v) => `<line x1="${n2(X(v))}" y1="${PAD.t}" x2="${n2(X(v))}" y2="${PAD.t + plotH}" class="grid"/>`
      + `<text x="${n2(X(v))}" y="${PAD.t + plotH + 20}" class="ax" text-anchor="middle">${v}</text>`),
    ...yTicks.map((m) => `<line x1="${PAD.l}" y1="${n2(Y(m))}" x2="${PAD.l + plotW}" y2="${n2(Y(m))}" class="grid"/>`
      + `<text x="${PAD.l - 10}" y="${n2(Y(m)) + 4}" class="ax" text-anchor="end">${m}</text>`),
  ].join('');

  // THE RUNG UNDER TEST — a ring at (voltage, frequency) and a trace back to the stock voltage of
  // that frequency: the descent as a distance you can see. Drawn only inside the axes: a marker
  // outside the sheet would be a coordinate, not a mark.
  let markerSvg = '';
  if (marker && Number.isFinite(marker.mhz) && Number.isFinite(marker.mv) && inAxes(marker.mhz, marker.mv)) {
    const cx = X(marker.mv);
    const cy = Y(marker.mhz);
    const fromMv = Number.isFinite(marker.stock) ? Math.min(Math.max(marker.stock, xMin), xMax) : marker.mv;
    const rightSide = cx < PAD.l + plotW * 0.62;
    // A rung near the TOP of the sheet gets its label BELOW the ring — above it there is no room, and
    // the label collided with the counts line on the first render (2026-09-04).
    const below = cy - r.marker - 30 < PAD.t;
    const label = `${marker.mhz} МГц · ${marker.mv} мВ`;
    markerSvg = `<line x1="${n2(X(fromMv))}" y1="${n2(cy)}" x2="${n2(cx)}" y2="${n2(cy)}" class="trace"/>`
      + `<circle cx="${n2(cx)}" cy="${n2(cy)}" r="${r.marker}" class="marker"><title>частота под тестом: ${esc(label)}</title></circle>`
      + `<text x="${n2(rightSide ? cx + r.marker + 8 : cx - r.marker - 8)}" y="${n2(below ? cy + r.marker + 26 : cy - r.marker - 6)}" class="marker-label" `
      + `text-anchor="${rightSide ? 'start' : 'end'}">${esc(label)}</text>`;
  }

  const caption = xCaption ?? WIDGET_X_CAPTION;
  // Where the two top labels live: inside the plot for the static page (its golden), in the top padding
  // for sizes that ask for it (`labelsAbove`).
  const topY = size.labelsAbove ? PAD.t - 14 : PAD.t + 20;
  const summarySvg = summary
    ? `<text x="${PAD.l + plotW}" y="${topY}" class="cap" text-anchor="end">тронуто ${facts.touched.length} из ${rows.length} · `
      + `полов зависания ${floors.size} · перемерить ${remeasure.size} · проходило ${proven.size}</text>`
    : '';
  const mhzLabel = size.labelsAbove
    ? `<text x="${PAD.l - 10}" y="${topY}" class="ax" text-anchor="end">МГц</text>`
    : `<text x="14" y="${PAD.t + 10}" class="ax">МГц</text>`;

  return `<svg viewBox="0 0 ${size.W} ${size.H}" role="img" aria-label="Кривая напряжений по частотам" data-remeasure="${remeasure.size}">
  ${gapRects}
  ${grid}
  <polyline class="stock" points="${polyline(stockPts)}"/>
  <polyline class="tuned" points="${polyline(tunedPts)}"/>
  ${provenDots}
  ${floorDots}
  ${refutedDots}
  ${markerSvg}
  ${summarySvg}
  <text x="${PAD.l + plotW}" y="${size.H - 12}" class="ax" text-anchor="end">${esc(caption)}</text>
  ${mhzLabel}
</svg>`;
}

// =================================================================================================
// 4. Loading — a missing document is an ANSWER with a reason, never a stack trace
// =================================================================================================

/**
 * @returns {{ok:true, facts:object, journalLines:number, truncated:number, journalPresent:boolean}
 *          |{ok:false, why:string}}
 */
export function loadFacts({ curvePath = CURVE_PATH, journalPath = JOURNAL_PATH, inFlight = null } = {}) {
  if (!curvePath || !existsSync(curvePath)) return { ok: false, why: `нет документа кривой ${curvePath || '(путь не задан)'}` };
  let doc;
  try { doc = JSON.parse(readFileSync(curvePath, 'utf8')); } catch (e) { return { ok: false, why: `документ кривой ${curvePath} не разбирается: ${e.message}` }; }
  if (!Array.isArray(doc?.frequencies) || doc.frequencies.length === 0) return { ok: false, why: `документ кривой ${curvePath} пуст` };
  const journalPresent = Boolean(journalPath) && existsSync(journalPath);
  const { records, truncated } = journalPresent ? readJournal({ path: journalPath }) : { records: [], truncated: 0 };
  return { ok: true, facts: curveFacts({ doc, records, inFlight }), journalLines: records.length, truncated, journalPresent };
}

// =================================================================================================
// 5. Selftest — no card, no production files; fixtures in memory
// =================================================================================================
//
// MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
//   M1. draw the effective line on a document nobody touched           → «ПУСТОТА РИСУЕТСЯ ПУСТОТОЙ»
//   M1b. build the effective line from TOUCHED rows only               → «НАША ЛИНИЯ — ЭТО ВЕСЬ ДОКУМЕНТ» · «…НИКОГДА НЕ ПРАВЕЕ СТОКА»
//   M2. take floors from `rawHangs` instead of `hangFloors`             → «ПОЛЫ — ОТ ДВИЖКА»
//   M3. drop the `inFlight` rule                                        → «СТУПЕНЬ В ПОЛЁТЕ — НЕ ЗАВИСАНИЕ»
//   M4. count a corrected hang as recorded                              → «ПОПРАВЛЕННОЕ ЗАВИСАНИЕ — НЕ УЛИКА»
//   M5. drop the marker branch                                          → «МАРКЕР РИСУЕТСЯ ПО ЗАПРОСУ»
//   M6. change a number of `STATIC_SIZE`                                → «ГЕОМЕТРИЯ СТАТИЧЕСКОЙ СТРАНИЦЫ»
//   M7. `effectiveCurve` back to «first row that fits»                  → «ПОРЯДОК СТРОК БЕЗРАЗЛИЧЕН»
export function selfTest() {
  const results = [];
  const check = (n, cond, why = '') => results.push({ n, ok: !!cond, why });

  const row = (mhz, voltageMv, stockVoltageMv, tags) => ({ mhz, voltageMv, stockVoltageMv, tags, provenBy: null, editedAt: null });
  const grid = [700, 750, 800, 850, 900, 950, 1000, 1050, 1100];
  const untouchedDoc = {
    kind: 'tuning-curve', voltageGridMv: grid, stamp: { takenAt: 'x' },
    frequencies: [row(2000, 800, 800, [UNTOUCHED_TAG]), row(2400, 900, 900, [UNTOUCHED_TAG]), row(2800, 1050, 1050, [UNTOUCHED_TAG])],
  };
  const mixedDoc = {
    kind: 'tuning-curve', voltageGridMv: grid, stamp: { takenAt: 'x' },
    frequencies: [
      row(1800, 750, 750, [UNTOUCHED_TAG]),
      row(2000, 800, 800, [UNTOUCHED_TAG]),
      row(2400, 850, 900, ['stop:edge-found', 'origin:measured']),
      row(2600, 950, 1000, ['stop:lever-limited', 'origin:measured']),
      row(2800, 1050, 1050, [UNTOUCHED_TAG]),
    ],
  };
  const intent = (seq, frequencyMhz, voltageMv) => ({ state: LINE.INTENT, seq, frequencyMhz, voltageMv, at: '2026-09-04T10:00:00+03:00' });
  const verdict = (seq, outcome, servingMvAfter = null) => ({ state: LINE.VERDICT, seq, outcome, servingMvAfter, at: '2026-09-04T10:00:10+03:00' });

  // — E26-AC2. A document nobody touched draws NO line of ours, no dots, and keeps the stock line.
  {
    const facts = curveFacts({ doc: untouchedDoc, records: [] });
    const svg = renderCurveSvg(facts);
    const tuned = /<polyline class="tuned" points="([^"]*)"/.exec(svg)?.[1] ?? null;
    const stock = /<polyline class="stock" points="([^"]*)"/.exec(svg)?.[1] ?? null;
    check('ПУСТОТА РИСУЕТСЯ ПУСТОТОЙ: на нетронутом документе у нашей линии НОЛЬ точек, точек прожига и полов нет',
      tuned === '' && !svg.includes('class="proven"') && !svg.includes('class="hung"') && facts.touched.length === 0,
      `tuned="${tuned}" touched=${facts.touched.length}`);
    check('…а сток и полоса «не тронуто» на месте — пустота честная, а не пустая страница',
      stock && stock.split(' ').length === 3 && svg.includes('class="gap"') && facts.gaps.length === 1,
      `stock="${stock}" gaps=${facts.gaps.length}`);
  }

  // — The effective line is the WHOLE document — what lands on the card — once anything is measured.
  {
    const facts = curveFacts({ doc: mixedDoc, records: [] });
    const eff = effectiveCurve(facts, 700);
    check('НАША ЛИНИЯ — ЭТО ВЕСЬ ДОКУМЕНТ: заводская строка выше измеренных держит карту на стоке (1050 → 2800), а не на нашем 2600',
      eff.length > 0 && eff[0].mv === 750 && eff.find((e) => e.mv === 1050)?.mhz === 2800 && eff.find((e) => e.mv === 1100)?.mhz === 2800,
      JSON.stringify(eff));
    check('и она отвечает «самая высокая частота, которую напряжение вправе обслужить»: 850 → 2400, 950…1000 → 2600',
      eff.find((e) => e.mv === 850)?.mhz === 2400 && eff.find((e) => e.mv === 900)?.mhz === 2400
        && eff.find((e) => e.mv === 950)?.mhz === 2600 && eff.find((e) => e.mv === 1000)?.mhz === 2600,
      JSON.stringify(eff));
    // The property that caught the first edition: at every voltage our line serves AT LEAST the
    // frequency stock serves there — the card is never made worse than stock by the picture.
    const stockAt = (v) => Math.max(...facts.rows.filter((r) => Number.isFinite(r.stockVoltageMv) && r.stockVoltageMv <= v).map((r) => r.mhz), -Infinity);
    check('…И НИКОГДА НЕ ПРАВЕЕ СТОКА: на каждом напряжении наша частота не ниже заводской',
      eff.every((e) => e.mhz >= stockAt(e.mv)), JSON.stringify(eff.map((e) => [e.mv, e.mhz, stockAt(e.mv)])));
    check('и монотонна по построению — плоские участки есть, провалов нет',
      eff.every((e, i) => i === 0 || e.mhz >= eff[i - 1].mhz), JSON.stringify(eff));
    const shuffled = { ...mixedDoc, frequencies: mixedDoc.frequencies.slice().reverse() };
    const eff2 = effectiveCurve(curveFacts({ doc: shuffled, records: [] }), 700);
    check('ПОРЯДОК СТРОК БЕЗРАЗЛИЧЕН: перевёрнутый документ даёт ту же линию (максимум, а не «первая подошедшая»)',
      JSON.stringify(eff2) === JSON.stringify(eff), `${JSON.stringify(eff2)} против ${JSON.stringify(eff)}`);
  }

  // — Floors come from the ENGINE'S rule (`hangFloors`, interviews/022 = B), not from a local count.
  {
    const records = [
      intent(1, 2400, 1000), verdict(1, RUNG_OUTCOME.HUNG),          // a hang at 1000 …
      intent(2, 2400, 950), verdict(2, RUNG_OUTCOME.PASSED, 950),    // … refuted by a deeper PASS
      intent(3, 2600, 900), verdict(3, RUNG_OUTCOME.HUNG),           // a hang deeper than anything proven — stays
      intent(4, 2600, 950), verdict(4, RUNG_OUTCOME.PASSED, 960),    // served 960 for an ordered 950
      intent(5, 2000, 800), verdict(5, RUNG_OUTCOME.HUNG),           // a «hang» that was an operator stop …
      { state: LINE.CORRECTION, seq: 5, outcome: RUNG_OUTCOME.STOPPED, at: 'x' }, // … corrected
    ];
    const facts = curveFacts({ doc: mixedDoc, records });
    check('ПОЛЫ — ОТ ДВИЖКА: зависание на 1000 мВ, опровергнутое прожигом на 950, полом НЕ стоит; зависание на 900 глубже доказанного — стоит',
      !facts.floors.has(2400) && facts.floors.get(2600)?.voltageMv === 900,
      JSON.stringify([...facts.floors]));
    check('и опровергнутое зависание видно как СНЯТОЕ, с обоими числами — факт остаётся, глагол правдив',
      facts.remeasure.get(2400)?.voltageMv === 1000 && facts.remeasure.get(2400)?.provenMv === 950 && !facts.remeasure.has(2600),
      JSON.stringify([...facts.remeasure]));
    check('ПРОЖИГ ДОКАЗЫВАЕТ ВЫДАННОЕ НАПРЯЖЕНИЕ, а не заказанное: 2600 МГц проходило на 960, не на 950',
      facts.proven.get(2600)?.voltageMv === 960 && facts.proven.get(2400)?.voltageMv === 950,
      JSON.stringify([...facts.proven]));
    check('ПОПРАВЛЕННОЕ ЗАВИСАНИЕ — НЕ УЛИКА: остановка оператора не рисуется ни полом, ни снятым зависанием',
      !facts.floors.has(2000) && !facts.remeasure.has(2000), JSON.stringify({ floors: [...facts.floors], remeasure: [...facts.remeasure] }));
    const svg = renderCurveSvg(facts);
    check('и на картинке противоречие — полый круг, который просит ОДНОГО: перемерить (plans/86); корень SVG несёт счёт для легенды',
      /class="hung remeasure"><title>2400 МГц: записано зависание на 1000 мВ — ПЕРЕМЕРИТЬ — записи противоречат друг другу: стресс-тест проходил на 950 мВ, на 50 мВ ГЛУБЖЕ/.test(svg)
      && /^<svg [^>]*data-remeasure="1"/.test(svg)
        && /class="hung"><title>2600 МГц: ПОЛ ЗАВИСАНИЯ 900 мВ/.test(svg),
      svg.slice(0, 400));
  }

  // — The rung in flight is not a hang (the live surface names it; the static one does not).
  {
    const records = [intent(1, 2400, 950), verdict(1, RUNG_OUTCOME.PASSED, 950), intent(2, 2400, 925)];   // seq 2 has no verdict yet
    const atRest = curveFacts({ doc: mixedDoc, records });
    const live = curveFacts({ doc: mixedDoc, records, inFlight: { mhz: 2400, mv: 925 } });
    const other = curveFacts({ doc: mixedDoc, records, inFlight: { mhz: 2600, mv: 925 } });
    check('СТУПЕНЬ В ПОЛЁТЕ — НЕ ЗАВИСАНИЕ: названная живой поверхностью, она не рисуется полом',
      atRest.floors.get(2400)?.voltageMv === 925 && !live.floors.has(2400),
      JSON.stringify({ atRest: [...atRest.floors], live: [...live.floors] }));
    check('…а сирота на ДРУГОЙ ступени полом остаётся — снимается ровно та, что горит сейчас',
      other.floors.get(2400)?.voltageMv === 925, JSON.stringify([...other.floors]));
  }

  // — The marker: drawn on request, never invented, never outside the axes.
  {
    const facts = curveFacts({ doc: mixedDoc, records: [] });
    const plain = renderCurveSvg(facts);
    const marked = renderCurveSvg(facts, { marker: { mhz: 2400, mv: 900, stock: 1000 } });
    const g = curveGeometry(facts);
    check('МАРКЕР РИСУЕТСЯ ПО ЗАПРОСУ: без запроса на картинке нет ни кольца, ни следа',
      !plain.includes('class="marker"') && !plain.includes('class="trace"'), 'маркер нарисован без запроса');
    check('и с запросом стоит ровно на (напряжение, частота), а след ведёт от стока этой частоты',
      marked.includes(`<circle cx="${n2(g.X(900))}" cy="${n2(g.Y(2400))}" r="${STATIC_SIZE.r.marker}" class="marker">`)
        && marked.includes(`<line x1="${n2(g.X(1000))}" y1="${n2(g.Y(2400))}" x2="${n2(g.X(900))}" y2="${n2(g.Y(2400))}" class="trace"/>`)
        && marked.includes('2400 МГц · 900 мВ'),
      marked.slice(marked.indexOf('class="trace"') - 120, marked.indexOf('class="trace"') + 200));
    const outside = renderCurveSvg(facts, { marker: { mhz: 100, mv: 900, stock: 1000 } });
    check('маркер за пределами осей не рисуется — координата вне листа это не метка',
      !outside.includes('class="marker"'), 'маркер нарисован за пределами осей');
  }

  // — Geometry: the ends of the axes land on the padding, and the static page's numbers are what they were.
  {
    const facts = curveFacts({ doc: mixedDoc, records: [] });
    const g = curveGeometry(facts);
    check('ГЕОМЕТРИЯ: концы осей ложатся на поля листа',
      n2(g.X(g.xMin)) === STATIC_SIZE.PAD.l && n2(g.X(g.xMax)) === STATIC_SIZE.PAD.l + g.plotW
        && n2(g.Y(g.yMax)) === STATIC_SIZE.PAD.t && n2(g.Y(g.yMin)) === STATIC_SIZE.PAD.t + g.plotH,
      JSON.stringify({ x0: g.X(g.xMin), x1: g.X(g.xMax), y0: g.Y(g.yMax), y1: g.Y(g.yMin) }));
    check('ГЕОМЕТРИЯ СТАТИЧЕСКОЙ СТРАНИЦЫ — 1360×620, поля 74/26/28/54, шаг сетки 50 мВ / 250 МГц: на них стоит голден assets/curve-map.html',
      STATIC_SIZE.W === 1360 && STATIC_SIZE.H === 620 && STATIC_SIZE.PAD.l === 74 && STATIC_SIZE.PAD.r === 26
        && STATIC_SIZE.PAD.t === 28 && STATIC_SIZE.PAD.b === 54 && STATIC_SIZE.xTickMv === 50 && STATIC_SIZE.yTickMhz === 250,
      JSON.stringify(STATIC_SIZE));
    // Ось ПРИЖИМАЕТСЯ к данным, когда они выше пола (850 → 800), и ОТСЕКАЕТСЯ полом, когда данные
    // уходят ниже него (450 → 700): второе — слово владельца, первое — разрешение картинки.
    check('на минимуме 750 мВ край оси совпадает с полом 700 — ни отсечения, ни зазора',
      g.xMin === 700, `xMin=${g.xMin}`);
    const highDoc = { ...mixedDoc, frequencies: mixedDoc.frequencies.filter((r) => r.voltageMv >= 850) };
    const gHigh = curveGeometry(curveFacts({ doc: highDoc, records: [] }));
    check('ось прижимается к данным, когда они выше пола: минимум 850 мВ даёт край 800, а не 700',
      gHigh.xMin === 800, `xMin=${gHigh.xMin}`);
    const lowDoc = { ...mixedDoc, frequencies: [...mixedDoc.frequencies, row(180, 450, 450, [UNTOUCHED_TAG])] };
    const gLow = curveGeometry(curveFacts({ doc: lowDoc, records: [] }));
    check('ЛЕВЫЙ КРАЙ ОСИ — 700 мВ (слово владельца 2026-09-04), когда сетка карты начинается ниже: 450 мВ покоя отсечены',
      gLow.xMin === 700 && X_FLOOR_MV === 700, `xMin=${gLow.xMin}`);
    check('ПОДПИСЬ ОСИ — ВЕЛИЧИНА И ЕДИНИЦА, БЕЗ ОПРАВДАНИЯ И БЕЗ СТРЕЛКИ, У ПРАВОГО КРАЯ ОСИ (слово владельца 2026-09-04)',
      WIDGET_X_CAPTION === 'напряжение, мВ' && !/тюнинга нет|ось от|начинается с|→/.test(renderCurveSvg(facts))
        && new RegExp(`<text x="${STATIC_SIZE.PAD.l + g.plotW}" y="${STATIC_SIZE.H - 12}" class="ax" text-anchor="end">напряжение, мВ</text>`).test(renderCurveSvg(facts)),
      WIDGET_X_CAPTION);
    const widget = renderCurveSvg(facts, { size: WIDGET_SIZE, summary: true });
    check('ВИДЖЕТ РИСУЕТСЯ ТЕМ ЖЕ РЕНДЕРЕРОМ в своей геометрии, со строкой счёта внутри картинки',
      widget.startsWith(`<svg viewBox="0 0 ${WIDGET_SIZE.W} ${WIDGET_SIZE.H}"`) && /class="cap"[^>]*>тронуто 2 из 5 · полов зависания 0 · перемерить 0 · проходило 0</.test(widget),
      widget.slice(0, 120));
      check('БЕЗ ПРОТИВОРЕЧИЙ КОРЕНЬ SVG ГОВОРИТ 0 — легенда виджета прячет строку «перемерить» по этому числу, а не по своему счёту',
        /^<svg [^>]*data-remeasure="0"/.test(widget), widget.slice(0, 160));
  }

  // — Loading: honest answers, never a throw.
  {
    const missing = loadFacts({ curvePath: join('runs', 'нет-такого-документа.json'), journalPath: null });
    check('НЕТ ДОКУМЕНТА — ЭТО ОТВЕТ С ПРИЧИНОЙ, а не исключение', missing.ok === false && /нет документа кривой/.test(missing.why), JSON.stringify(missing));
    const noPath = loadFacts({ curvePath: null });
    check('и путь, которого не задали, назван так же', noPath.ok === false && /путь не задан/.test(noPath.why), JSON.stringify(noPath));
    const facts = curveFacts({ doc: { frequencies: [] }, records: [] });
    const svg = renderCurveSvg(facts);
    check('документ без единой частоты даёт картинку с одной честной строкой, а не деление на ноль',
      svg.includes('class="ax empty"') && !svg.includes('NaN'), svg.slice(0, 200));
  }

  const failed = results.filter((r) => !r.ok).length;
  return { ok: failed === 0, results, failed };
}

// =================================================================================================
// 6. CLI
// =================================================================================================

async function main(argv) {
  if (argv.includes('--selftest')) {
    const r = selfTest();
    for (const x of r.results) console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.n}${x.ok ? '' : `\n       причина: ${x.why}`}`);
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА КАРТЫ КРИВОЙ: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА КАРТЫ КРИВОЙ: есть расхождения.');
    return r.ok ? 0 : 1;
  }
  // Without a flag: the picture from the production files to stdout — a probe, not a surface.
  const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const loaded = loadFacts({ curvePath: arg('curve', CURVE_PATH), journalPath: arg('journal', JOURNAL_PATH) });
  if (!loaded.ok) { console.error(`ОСТАНОВ: ${loaded.why}`); return 1; }
  const f = loaded.facts;
  console.log(`КАРТА КРИВОЙ (факты): частот ${f.rows.length} · тронуто ${f.touched.length} · проходило ${f.proven.size} · `
    + `полов зависания ${f.floors.size} · перемерить ${f.remeasure.size} · журнал ${loaded.journalLines} строк`);
  console.log('В КАРТУ НЕ ЗАПИСАНО НИЧЕГО: модуль читает два файла.');
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
