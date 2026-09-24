// =================================================================================================
// THE AGENT'S CURVE PROPOSAL — built from the edges the card really showed, filled between and beyond
// =================================================================================================
//
// WHY. The owner, 2026-09-14: *«можешь сделать твой вариант кривой — на основе тех краёв, которые мы
// реально нашли, и чуть-чуть опускаясь по напряжению вниз по частотам, и наоборот — чуть-чуть повышая
// вверх по частотам, интерполяция и экстраполяция — и открыть мне на отсмотр?»*
//
// EVERY RULE BELOW HAS AN OWNER-SIDE SOURCE — the agent chose none of the numbers:
//   R1 frequency = what the card DELIVERED, not what was ordered — GOAL.md «ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ».
//   R2 a PASS counts only from the new oracle on — interviews/026 Q1 = B («перемерить то, что было
//      намерено по старому оракулу»), boundary `ORACLE_DATE` and the 04.09 off-post rows taken from
//      tools/mark-unwatched-rows.mjs (one source of both facts).
//   R3 a failure contradicted by physics is not an edge: a PASS at an equal-or-higher frequency on a
//      LOWER voltage refutes it — bugs/124 (tools/hang-floor-physics-lint.mjs, strict form), and
//      interviews/022 = B for the same frequency.
//   R4 working point = the last stable voltage + one step of the card's grid — GOAL.md «КРИТЕРИЙ
//      ПРИЁМКИ ТЮНИНГА» §2.
//   R5 the curve is stock minus a least-squares TREND of the edges' depths, shifted to touch the most
//      demanding edge — the owner's «ну так проведи тренд» (experiment №2, 2026-09-14), after he saw the
//      through-the-edges edition bend. An edge whose last stable is inherited from a higher frequency is
//      floored at its hang + two grid steps (his «где можно срезать ещё немножко милливольт»). Below the
//      lowest edge not deeper than that edge; above the highest not deeper than it and not below «top edge +
//      25 mV» (plans/25 «решено владельцем» п. 2). Earlier editions (hull 22:40 = experiment №1 in Optimised,
//      through-edges 23:25) live in git history and in `curves/proposals/`.
//   R6 the curve never decreases with frequency (Vmin does not decrease — the project's physics) and
//      never exceeds stock or 3090 MHz (R13).
//
// OUTPUT. `curves/proposals/<moment>.json` — the same shape the editor reads (corners + 389 rows),
// plus the anchors with their evidence. Writes nothing else: not the card, not a profile, not
// `measured.json`. The journal is read only through its pure readers.
//
// Usage: node tools/curve-proposal.mjs [--margin <mV> | --band-margins a,b,c,d,e,f,g] [--write] · --selftest
//   (the margin keys — epic 101 Ф1 Ш1, section 3a below)
//
// [NOT-TESTED] at birth — the blocks in `selfTest()` flip it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJournal, harvestFromJournal, orphanIntents, corrections, LINE, RUNG_OUTCOME } from '../automation-engine/lib/sweep-journal.mjs';
import { loadFacts, effectiveCurve, CURVE_PATH, JOURNAL_PATH } from '../automation-engine/lib/curve-map.mjs';
import { ORACLE_DATE, FUSE_OFF_POST_MHZ } from './mark-unwatched-rows.mjs';
import { cornersOf } from './curve-editor.mjs';
import { MODE_BANDS } from '../automation-engine/config.mjs';
import { bandOf } from '../automation-engine/lib/mode-validate.mjs';
import { CURVE_TAGS, validateCurveDoc, saveCurveDoc, curvePath } from '../automation-engine/lib/curve-store.mjs';
import { loadGrid } from '../automation-engine/lib/card-grids.mjs';

export const PROPOSALS_DIR = join('curves', 'proposals');
const EXTRAPOLATION_FLOOR_MV = 25; // plans/25 «решено владельцем» item 2 — not the agent's number
// What a written proposal says about its own method — ONE place, next to the code it describes. The closing judge of
// 2026-09-14 found the 23:34 file carrying the hull's R5 and the through-edges method: strings that lived far from the code drifted.
export const PROPOSAL_R5 = 'R5 сток минус ТРЕНД глубины краёв (прямая МНК, сдвиг до касания самого требовательного края; «ну так проведи тренд», эксперимент №2): у края с чужой «последней стабильной» граница = отказ + 2 шага сетки; ниже нижнего края — не глубже его; выше верхнего — не глубже его и не ниже «верхний край + 25 мВ» (plans/25 п.2)';
export const PROPOSAL_METHOD = 'тренд: глубина под стоком = a + b·f по методу наименьших квадратов через границы краёв, сдвинутая до касания самого требовательного края; разброс краёв вокруг тренда (RMS) — мера надёжности модели';
const OFF_POST_DAY = '2026-09-04';  // the day FUSE_OFF_POST_MHZ refers to (mark-unwatched-rows.mjs header)
const dayOf = (at) => String(at ?? '').slice(0, 10);

// -------------------------------------------------------------------------------------------------
// 1. Evidence — passes (trusted only) and failures, both at the DELIVERED frequency where known
// -------------------------------------------------------------------------------------------------

/** R2: a PASS verdict is evidence only from the new oracle on, and not from the off-post rows. */
export function trustedPassRecords(records) {
  const intents = new Map(records.filter((r) => r?.state === LINE.INTENT).map((r) => [r.seq, r]));
  return records.filter((r) => {
    if (r?.state !== LINE.VERDICT) return r?.state === LINE.INTENT; // intents stay: harvest joins on them
    if (r.outcome !== RUNG_OUTCOME.PASSED) return false;
    const day = dayOf(r.at ?? intents.get(r.seq)?.at);
    if (!(day >= ORACLE_DATE)) return false;
    if (day === OFF_POST_DAY && FUSE_OFF_POST_MHZ.includes(r.deliveredMhz)) return false;
    return true;
  });
}

/** Deepest trusted pass per delivered frequency — through the project's one harvest author. */
export function trustedPasses(records) {
  const h = harvestFromJournal(trustedPassRecords(records));
  return [...h.pairs.values()].map((p) => ({ mhz: p.deliveredMhz, mv: p.deepestMv, seq: p.seq, at: p.at })).sort((a, b) => a.mhz - b.mhz);
}

/**
 * Failures: `hung`/`failed` verdicts not corrected, plus orphan intents (a death at rest). Frequency:
 * delivered when the verdict carries it; else the delivered frequency of the PASS one step above on the
 * same ordered frequency in the same descent (the card's clock at the neighbouring rung — named in the
 * record as such); else the ordered frequency. Voltage: serving-after when recorded, else ordered.
 */
export function failures(records) {
  const intents = new Map(records.filter((r) => r?.state === LINE.INTENT).map((r) => [r.seq, r]));
  const verdicts = new Map(records.filter((r) => r?.state === LINE.VERDICT).map((r) => [r.seq, r]));
  const fixed = corrections(records);
  const neighbourPass = (i) => {
    for (let s = i.seq - 1; s >= i.seq - 3; s--) {
      const pi = intents.get(s); const pv = verdicts.get(s);
      if (pi?.frequencyMhz === i.frequencyMhz && pv?.outcome === RUNG_OUTCOME.PASSED && Number.isFinite(pv.deliveredMhz)) return pv.deliveredMhz;
    }
    return null;
  };
  const one = (i, v, kind) => {
    const viaNeighbour = Number.isFinite(v?.deliveredMhz) ? null : neighbourPass(i);
    const mhz = Number.isFinite(v?.deliveredMhz) ? v.deliveredMhz : (viaNeighbour ?? i.frequencyMhz);
    const from = Number.isFinite(v?.deliveredMhz) ? 'выданная' : (viaNeighbour !== null ? 'выданная на ступени выше' : 'заказанная');
    const mv = Number.isFinite(v?.servingMvAfter) ? v.servingMvAfter : i.voltageMv;
    return { mhz, mv, seq: i.seq, at: v?.at ?? i.at ?? null, kind, decidedBy: v?.decidedBy ?? null, from, orderedMhz: i.frequencyMhz };
  };
  const out = [];
  for (const v of verdicts.values()) {
    if (![RUNG_OUTCOME.HUNG, RUNG_OUTCOME.FAILED].includes(v.outcome) || fixed.has(v.seq)) continue;
    const i = intents.get(v.seq);
    if (i && Number.isFinite(i.frequencyMhz) && Number.isFinite(i.voltageMv)) out.push(one(i, v, v.outcome));
  }
  for (const i of orphanIntents(records)) if (Number.isFinite(i.frequencyMhz) && Number.isFinite(i.voltageMv)) out.push(one(i, null, 'смерть'));
  return out.sort((a, b) => a.mhz - b.mhz || a.mv - b.mv);
}

/** R3: refuted by a trusted PASS at an equal-or-higher frequency on a strictly lower voltage. */
export function refutedBy(fail, passes) {
  return passes.find((p) => p.mhz >= fail.mhz && p.mv < fail.mv) ?? null;
}

// -------------------------------------------------------------------------------------------------
// 2. Anchors — the real edges and their working points
// -------------------------------------------------------------------------------------------------

const gridUp = (grid, mv) => grid.find((g) => g >= mv) ?? grid.at(-1);
const nextStep = (grid, mv) => grid.find((g) => g > mv) ?? grid.at(-1);

/** The proven envelope at f: the lowest trusted pass at f or above (proof is inherited downward). */
export function envelopeAt(passes, mhz) {
  let best = null;
  for (const p of passes) if (p.mhz >= mhz && (best === null || p.mv < best.mv)) best = p;
  return best;
}

export function anchorsFrom({ passes, fails, grid, stockAt }) {
  const credible = [];
  const refuted = [];
  for (const f of fails) {
    const by = refutedBy(f, passes);
    if (by) refuted.push({ ...f, refutedBy: by }); else credible.push(f);
  }
  const anchors = [];
  for (const f of credible) {
    const env = envelopeAt(passes, f.mhz);
    if (!env) continue;                                   // no stable point above it — a bound, not an edge
    const workingMv = Math.max(nextStep(grid, env.mv), nextStep(grid, nextStep(grid, f.mv)));
    const prev = anchors.find((a) => a.mhz === f.mhz);
    const row = { mhz: f.mhz, failMv: f.mv, failKind: f.kind, failSeq: f.seq, failFrom: f.from, lastStableMv: env.mv, lastStableAt: env.mhz, lastStableSeq: env.seq, workingMv, stockMv: stockAt(f.mhz) };
    if (!prev) anchors.push(row); else if (row.workingMv > prev.workingMv) Object.assign(prev, row);
  }
  anchors.sort((a, b) => a.mhz - b.mhz);
  // R6: the edge never decreases with frequency — a higher anchor below a lower one is RAISED (the ratchet's direction)
  let run = -Infinity;
  for (const a of anchors) { if (a.workingMv < run) { a.raisedFromMv = a.workingMv; a.workingMv = run; } run = a.workingMv; a.depthMv = a.stockMv - a.workingMv; }
  return { anchors, credible, refuted };
}

// -------------------------------------------------------------------------------------------------
// 3. The curve — stock minus a TREND of depth (the owner's «ну так проведи тренд», experiment №2)
// -------------------------------------------------------------------------------------------------
//
// THE OWNER'S WORDS, 2026-09-14 ~23:4x: *«я вижу, что есть лесенка, и что кривая "плавает" — изгибается.
// Стоковая кривая красивее, ровнее. Почему наша изогнута?»* → *«ну так проведи тренд»* → *«и сделай это
// ЭКСПРИМЕНТОМ №2»* · *«И когда делаешь тренд подумай, где можно срезать ещё немножко милливольт вниз»*.
//
// WHY THE 23:25 EDITION BENT. It went through every edge exactly, and the edges are noisy single burns
// (depth under stock 170 → 140 → 185 → 165 → 200 within 200 MHz); stock is the factory's model and has no
// noise. The textbook remedy for noisy points is a TREND, not a polyline — and the canon asks for exactly
// that: «опора — не соседняя точка, а МОДЕЛЬ» with «мера собственной надёжности» (GOAL.md → КРИТЕРИЙ ПРИЁМКИ §3а).
//
// THE MODEL. depth(f) = a + b·f by least squares through the edges' depths, then shifted DOWN (shallower)
// by the largest amount the fit would stand deeper than any edge allows — so the curve TOUCHES the most
// demanding edge and passes above the rest. The RMS of the edges around the line is the model's own
// reliability figure, written into the proposal. V(f) = stock(f) − depth(f): the shape is stock's.
//
// WHERE THE EXTRA MILLIVOLTS COME FROM (the owner's second ask). An edge whose «last stable» is its OWN
// trusted burn keeps its working point (last stable + one step). An edge whose last stable is INHERITED
// from a burn at a higher frequency says nothing about how close its own edge is — the hang does. For
// those the floor is the hang + two grid steps: the best case of the owner's rule, «the next step above
// the failure held». That removes the staircase at its root (eight edges were sitting on two inherited
// numbers) and lets the trend stand deeper. ⚠️ The price is named: at those edges the margin over a
// RECORDED hang is two grid steps.
//
//   · below the lowest edge:  the trend, never deeper than that edge (plans/25 п. 2)
//   · above the highest edge: the trend, never deeper than that edge and not below «top edge + 25 mV» (plans/25 п. 2)
//   · everywhere: never above stock; never decreasing with frequency (counted, not silently fixed)

/** Least-squares line y = a + b·x through {x, y}; `rms` is the scatter of the points around it. */
export function fitLine(points) {
  const n = points.length;
  if (n === 0) return { a: 0, b: 0, rms: 0 };
  if (n === 1) return { a: points[0].y, b: 0, rms: 0 };
  let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const den = n * sxx - sx * sx;
  const b = den === 0 ? 0 : (n * sxy - sx * sy) / den;
  const a = (sy - b * sx) / n;
  const rms = Math.sqrt(points.reduce((s, p) => s + (p.y - (a + b * p.x)) ** 2, 0) / n);
  return { a, b, rms };
}

/** The voltage an edge may not go below: its working point when the last stable is its own burn, else hang + two steps. */
export function edgeFloorMv(anchor, grid) {
  const own = anchor.lastStableAt === anchor.mhz;
  return own ? anchor.workingMv : nextStep(grid, nextStep(grid, anchor.failMv));
}

/**
 * The trend model alone — the ONE place the fit, the touching shift and the extrapolation rules live.
 * `rawAt(mhz)` is the model's voltage BEFORE the card's grid (`v`) and where it came from (`origin`);
 * `buildRows` (the trend proposal, margin 0) and `bandedCurve` (trend + a margin per band) both read it.
 */
export function trendModel({ stockAt, grid, anchors }) {
  const lo = anchors[0];
  const hi = anchors.at(-1);
  const pts = anchors.map((x) => ({ x: x.mhz, y: x.stockMv - edgeFloorMv(x, grid), floorMv: edgeFloorMv(x, grid), own: x.lastStableAt === x.mhz }));
  const fit = fitLine(pts);
  const shift = Math.max(0, ...pts.map((p) => (fit.a + fit.b * p.x) - p.y));
  const depthAt = (f) => fit.a + fit.b * f - shift;
  const edge = new Set(anchors.map((x) => x.mhz));
  const rawAt = (mhz) => {
    const stock = stockAt(mhz);
    let d = depthAt(mhz);
    let origin = edge.has(mhz) ? 'edge' : 'interpolated';
    let v;
    if (mhz < lo.mhz) { d = Math.min(d, lo.stockMv - edgeFloorMv(lo, grid)); origin = 'extrapolated-down'; v = stock - d; }
    else if (mhz > hi.mhz) {
      d = Math.min(d, hi.stockMv - edgeFloorMv(hi, grid)); origin = 'extrapolated-up';
      v = Math.max(stock - d, edgeFloorMv(hi, grid) + EXTRAPOLATION_FLOOR_MV);
    } else v = stock - d;
    return { v, origin };
  };
  return { fit, shift, rawAt };
}

/** Known failures stay failures: a row is never below «credible failure + two grid steps» at or below its frequency. */
function raiseToFailures(rows, credible, grid) {
  let failRaises = 0;
  for (const r of rows) {
    for (const f of credible) {
      const need = nextStep(grid, nextStep(grid, f.mv));
      if (f.mhz <= r.mhz && r.voltageMv < need && need <= r.stockVoltageMv) { r.voltageMv = need; failRaises++; }
    }
  }
  return failRaises;
}

/** Vmin does not decrease with frequency: a row below the one before it is raised to it (never above stock). */
function raiseToMonotone(rows) {
  let run = -Infinity; let monotoneRaises = 0;
  for (const r of rows) { if (r.voltageMv < run && run <= r.stockVoltageMv) { r.voltageMv = run; monotoneRaises++; } run = Math.max(run, r.voltageMv); }
  return monotoneRaises;
}

// Rounded before the grid: the touching edge lands on its floor exactly, not one step up by 1e-12.
const onGridUp = (grid, v) => gridUp(grid, Math.round(v * 1e6) / 1e6);

export function buildRows({ ladder, stockAt, grid, anchors, credible, maxMhz }) {
  if (anchors.length === 0) return { rows: ladder.map((mhz) => ({ mhz, voltageMv: stockAt(mhz), stockVoltageMv: stockAt(mhz), origin: 'stock' })), monotoneRaises: 0, failRaises: 0, trend: null };
  const { fit, shift, rawAt } = trendModel({ stockAt, grid, anchors });
  const rows = ladder.filter((m) => m <= maxMhz).map((mhz) => {
    const stock = stockAt(mhz);
    const { v, origin } = rawAt(mhz);
    return { mhz, voltageMv: Math.min(onGridUp(grid, v), stock), stockVoltageMv: stock, origin };
  });
  const failRaises = raiseToFailures(rows, credible, grid);
  const monotoneRaises = raiseToMonotone(rows);
  const margins = anchors.map((x) => ({ mhz: x.mhz, floorMv: edgeFloorMv(x, grid), own: x.lastStableAt === x.mhz, marginMv: rows.find((r) => r.mhz === x.mhz).voltageMv - edgeFloorMv(x, grid) }));
  return { rows, monotoneRaises, failRaises, trend: { a: fit.a, b: fit.b, rmsMv: fit.rms, shiftMv: shift, margins } };
}

// -------------------------------------------------------------------------------------------------
// 3a. The curve with a MARGIN PER BAND — epic 101 Ф1 Ш1 (`plans/102`)
// -------------------------------------------------------------------------------------------------
//
// ANCHOR (plans/101 Ф1): «построитель кривой получает вектор запаса по полосам». The turnaround's curve is
// «stock − trend + M[band]» (researches/39 §4 п. 2; ЗАКАЗ.md §2): the silicon model plus a margin that the
// whole-mode check lowers band by band (descent, Ф2) and the ratchet raises in the band of a failure.
//
// WHAT «ТРЕНД» MEANS HERE — `[AI]`, revisable: the TOUCHING trend of `trendModel` (the least-squares line
// shifted to touch the most demanding edge, with the extrapolation rules of R5). So margin 0 IS experiment
// №2's curve, every known edge floor honoured and the worst one touched; +30 (Ф2's start) stands 30 mV
// above that. Negative margins are refused: going under the model's most demanding edge is the Ф5 probe's
// business (a new anchor), not a margin's.
//
// SEVEN BANDS — researches/39 §4 п. 2, `[AI]` boundaries to be refined by the visit map. Half-open
// [loMhz, hiMhz): a boundary frequency belongs to the band ABOVE it. The first and the last are the bands
// heavy load does not visit (below the lowest reachable cap 2157; above 2950) — their «увеличенный запас»
// is the extrapolation rules of `trendModel` (not deeper than the extreme edge; top ≥ top edge + 25 mV)
// plus whatever margin the vector gives them.
//
// INVARIANTS (P102-AC1), each a selftest block: never decreasing with frequency · never above stock ·
// no frequency above the card's maximum (R13) · every voltage ON the card's grid and rounded UP (never
// below «trend + margin») · never below a credible failure + two grid steps. The raises are COUNTED and
// returned, never silent.
//
// [TESTED: 2026-09-25 · functional run on the real journal and curve document (`--margin 30`, read per band) +
// 28 selftest blocks + mutations MB1–MB3 each red on target · report testcases/reports/2026-09-25_banded-curve-builder.md]
// Not covered: the card has never been given this curve — that is Ф2's whole-mode check.

// The bands live in config.mjs (R3: every safety number in one place) — this is the SAME constant, not a copy.
export const BANDS = MODE_BANDS;

// `bandOf` — the ONE mapping the curve, the visit map and the ratchet share — lives in lib/mode-validate.mjs.
export { bandOf };

/** Bands must tile the whole frequency axis — no hole, no overlap: a frequency without a band has no margin. */
export function bandsRefusal(bands = BANDS) {
  if (!Array.isArray(bands) || bands.length === 0) return 'полос нет';
  if (bands[0].loMhz !== -Infinity || bands.at(-1).hiMhz !== Infinity) return 'полосы не покрывают ось от края до края';
  const bad = bands.findIndex((b, i) => !(b.loMhz < b.hiMhz) || (i > 0 && b.loMhz !== bands[i - 1].hiMhz));
  return bad === -1 ? null : `полоса ${bands[bad].label}: начало ${bands[bad].loMhz} не стыкуется с концом предыдущей ${bands[bad - 1]?.hiMhz ?? '—'}`;
}

/** A margin vector is one non-negative whole number of millivolts per band — anything else is refused by name. */
export function marginRefusal(margins, bands = BANDS) {
  if (!Array.isArray(margins)) return 'запас не задан вектором';
  if (margins.length !== bands.length) return `запасов ${margins.length}, полос ${bands.length}`;
  const bad = margins.findIndex((m) => !Number.isInteger(m) || m < 0);
  return bad === -1 ? null : `полоса ${bands[bad].label}: запас «${margins[bad]}» — нужно целое число мВ ≥ 0`;
}

export function bandedCurve({ ladder, stockAt, grid, anchors, credible = [], maxMhz, margins, bands = BANDS }) {
  const refusal = bandsRefusal(bands) ?? marginRefusal(margins, bands);
  if (refusal) throw new Error(`кривая с запасом по полосам не строится: ${refusal}`);
  if (anchors.length === 0) throw new Error('кривая с запасом по полосам не строится: нет ни одного края-опоры — модели не на чем стоять');
  const { fit, shift, rawAt } = trendModel({ stockAt, grid, anchors });
  const rows = ladder.filter((m) => m <= maxMhz).map((mhz) => {
    const stock = stockAt(mhz);
    const { v, origin } = rawAt(mhz);
    const band = bandOf(mhz, bands);
    const marginMv = margins[band];
    return { mhz, voltageMv: Math.min(onGridUp(grid, v + marginMv), stock), stockVoltageMv: stock, origin, band: bands[band].id, marginMv, trendMv: Math.round(v * 10) / 10 };
  });
  const failRaises = raiseToFailures(rows, credible, grid);
  const monotoneRaises = raiseToMonotone(rows);
  const perBand = bands.map((b, i) => {
    const in_ = rows.filter((r) => r.band === b.id);
    const depth = in_.map((r) => r.stockVoltageMv - r.voltageMv);
    return { id: b.id, label: b.label, marginMv: margins[i], rows: in_.length, atStock: in_.filter((r) => r.voltageMv === r.stockVoltageMv).length, depthMinMv: depth.length ? Math.min(...depth) : null, depthMaxMv: depth.length ? Math.max(...depth) : null };
  });
  return { rows, failRaises, monotoneRaises, perBand, trend: { a: fit.a, b: fit.b, rmsMv: fit.rms, shiftMv: shift } };
}

/** The longest run of consecutive frequencies on ONE voltage — the owner's «полка», as a number. */
export function longestShelf(rows, key = 'voltageMv', from = -Infinity, to = Infinity) {
  let best = 0; let cur = 0; let prev = null;
  for (const r of rows.filter((x) => x.mhz >= from && x.mhz <= to).sort((a, b) => a.mhz - b.mhz)) {
    cur = r[key] === prev ? cur + 1 : 1; prev = r[key]; best = Math.max(best, cur);
  }
  return best;
}

/** The effective corners of a frequency → voltage table, in the editor's language. */
export function cornersFromRows(rows, grid, xFloorMv = 700) {
  const eff = [];
  for (const v of grid) {
    if (v < xFloorMv) continue;
    let best = null;
    for (const r of rows) if (r.voltageMv <= v && (best === null || r.mhz > best)) best = r.mhz;
    if (best !== null) eff.push({ mv: v, mhz: best });
  }
  return cornersOf(eff);
}

export function propose() {
  const loaded = loadFacts();
  if (!loaded.ok) throw new Error(loaded.why);
  const facts = loaded.facts;
  const { records } = readJournal({ path: JOURNAL_PATH });
  const stock = new Map(facts.rows.map((r) => [r.mhz, r.stockVoltageMv]));
  const ladder = facts.rows.map((r) => r.mhz);
  const stockAt = (m) => stock.get(m);
  const passes = trustedPasses(records).filter((p) => stock.has(p.mhz));
  const fails = failures(records).filter((f) => stock.has(f.mhz));
  const { anchors, credible, refuted } = anchorsFrom({ passes, fails, grid: facts.grid, stockAt });
  const maxMhz = facts.card.maxGraphicsMhz ?? Math.max(...ladder);
  const { rows, monotoneRaises, failRaises, trend } = buildRows({ ladder, stockAt, grid: facts.grid, anchors, credible, maxMhz });
  return { facts, records, passes, fails, anchors, credible, refuted, rows, monotoneRaises, failRaises, trend, corners: cornersFromRows(rows, facts.grid), current: cornersOf(effectiveCurve(facts)) };
}

/**
 * The banded curve as a TUNING-CURVE DOCUMENT (plans/102 Ш2) — the input `npm run curve -- --snapshot
 * --from <name>` freezes into a battle snapshot, which a candidate profile then points at. On 2026-09-14
 * this step was done by hand; now it is one function. A row at its stock voltage claims nothing
 * (`stop:untouched`); every other row is `origin:model` — no burn, proof only by the whole-mode check.
 * Only the document's own row keys travel (curve-store's ROW_KEYS is an exact-match list).
 */
export function curveDocFromRows({ rows, name, card, grid, stamp, takenAt }) {
  return {
    kind: 'tuning-curve', name, card, voltageGridMv: [...grid],
    stamp: { driver: stamp.driver, vbios: stamp.vbios, takenAt },
    // The document's table runs TOP-DOWN in frequency (the validator refuses any other order); the builder's rows run up.
    frequencies: [...rows].sort((a, b) => b.mhz - a.mhz).map((r) => ({
      mhz: r.mhz, voltageMv: r.voltageMv, stockVoltageMv: r.stockVoltageMv,
      tags: [r.voltageMv === r.stockVoltageMv ? CURVE_TAGS.STOP_UNTOUCHED : CURVE_TAGS.ORIGIN_MODEL],
      provenBy: null, editedAt: takenAt,
    })),
  };
}

// -------------------------------------------------------------------------------------------------
// 4. Selftest — fixtures in memory, no files, no card
// -------------------------------------------------------------------------------------------------

export function selfTest() {
  const results = [];
  const check = (n, ok, why = '') => results.push({ n, ok: !!ok, why });
  const grid = []; for (let v = 800; v <= 1000; v += 5) grid.push(v);          // a fine grid: shelves cannot hide in coarse steps
  const ladder = [2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000];
  const stockAt = (m) => 900 + Math.round((m - 2000) / 10);                   // 900 … 1000, rising
  const passes = [{ mhz: 2300, mv: 830 }, { mhz: 2700, mv: 860 }, { mhz: 2900, mv: 900 }];
  const fails = [
    { mhz: 2300, mv: 825, kind: 'hung' },  // real edge: pass 830 just above
    { mhz: 2700, mv: 850, kind: 'hung' },  // real edge
    { mhz: 2500, mv: 950, kind: 'hung' },  // refuted: 2700 passed at 860 (higher f, lower v)
  ];
  const { anchors, credible, refuted } = anchorsFrom({ passes, fails, grid, stockAt });
  check('ФИЗИКА СНИМАЕТ ОТКАЗ, ОПРОВЕРГНУТЫЙ ПРОЖИГОМ ВЫШЕ', refuted.length === 1 && refuted[0].mhz === 2500 && credible.length === 2);
  check('ПРОЖИГ НИЖЕ ПО ЧАСТОТЕ ОТКАЗ НЕ ОПРОВЕРГАЕТ', refutedBy({ mhz: 2800, mv: 900 }, [{ mhz: 2700, mv: 860 }]) === null);
  const a23 = anchors.find((x) => x.mhz === 2300);
  check('РАБОЧАЯ ТОЧКА = ПОСЛЕДНЯЯ СТАБИЛЬНАЯ + ШАГ СЕТКИ', a23?.workingMv === 835, `2300: ${a23?.workingMv}`);

  const { rows, failRaises, monotoneRaises, trend } = buildRows({ ladder, stockAt, grid, anchors, credible, maxMhz: 3000 });
  // The verification passes must find nothing to fix: if they do, the construction is wrong and they are HIDING it.
  check('ПРОВЕРОЧНЫЕ ПРОХОДЫ НИЧЕГО НЕ ПОДНИМАЮТ', failRaises === 0 && monotoneRaises === 0, `отказы ${failRaises} · монотонность ${monotoneRaises}`);
  check('КРИВАЯ НЕ УБЫВАЕТ С ЧАСТОТОЙ', rows.every((r, i) => i === 0 || r.voltageMv >= rows[i - 1].voltageMv));
  check('НИ ОДНА СТРОКА НЕ ВЫШЕ СТОКА', rows.every((r) => r.voltageMv <= stockAt(r.mhz)));
  check('НИ ОДИН КРАЙ НЕ ГЛУБЖЕ СВОЕЙ ГРАНИЦЫ', trend.margins.every((m) => m.marginMv >= 0), trend.margins.map((m) => `${m.mhz}: +${m.marginMv}`).join(' · '));
  check('ТРЕНД КАСАЕТСЯ САМОГО ТРЕБОВАТЕЛЬНОГО КРАЯ', Math.min(...trend.margins.map((m) => m.marginMv)) === 0, `минимальный запас ${Math.min(...trend.margins.map((m) => m.marginMv))}`);
  // Three edges, the middle one MORE demanding than the line through them: without the shift it would be undercut.
  const three = [
    { mhz: 2000, workingMv: 850, stockMv: 900, lastStableAt: 2000 },
    { mhz: 2400, workingMv: 880, stockMv: 940, lastStableAt: 2400 },
    { mhz: 2800, workingMv: 870, stockMv: 980, lastStableAt: 2800 },
  ];
  const t3 = buildRows({ ladder, stockAt, grid, anchors: three, credible: [], maxMhz: 3000 }).trend;
  check('СДВИГ ТРЕНДА НЕ ПУСКАЕТ КРИВУЮ ГЛУБЖЕ ТРЕБОВАТЕЛЬНОГО КРАЯ', t3.shiftMv > 0 && t3.margins.every((m) => m.marginMv >= 0), `сдвиг ${t3.shiftMv.toFixed(1)} · ${t3.margins.map((m) => m.mhz + ': +' + m.marginMv).join(' · ')}`);
  const line = fitLine([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }]);
  check('ПРЯМАЯ МНК ВОСПРОИЗВОДИТСЯ НА ТОЧНЫХ ДАННЫХ', Math.abs(line.a - 1) < 1e-9 && Math.abs(line.b - 2) < 1e-9 && line.rms < 1e-9, JSON.stringify(line));
  const inherited = edgeFloorMv({ mhz: 2767, lastStableAt: 2865, failMv: 835, workingMv: 875 }, grid);
  const ownEdge = edgeFloorMv({ mhz: 2865, lastStableAt: 2865, failMv: 865, workingMv: 875 }, grid);
  check('ЧУЖАЯ «ПОСЛЕДНЯЯ СТАБИЛЬНАЯ» — ГРАНИЦА = ОТКАЗ + ДВА ШАГА, СВОЯ — РАБОЧАЯ ТОЧКА', inherited === 845 && ownEdge === 875, `унаследованная ${inherited} · своя ${ownEdge}`);
  check('ВНИЗ — НЕ ГЛУБЖЕ НИЖНЕГО КРАЯ', rows.filter((r) => r.origin === 'extrapolated-down').every((r) => r.stockVoltageMv - r.voltageMv <= anchors[0].stockMv - edgeFloorMv(anchors[0], grid)));
  check('ПРОИСХОЖДЕНИЕ НАЗВАНО В КАЖДОЙ СТРОКЕ', rows.every((r) => ['edge', 'interpolated', 'extrapolated-down', 'extrapolated-up'].includes(r.origin)));

  // THE OWNER'S COMPLAINT AS A BLOCK: a shallow edge far below and a deep one above used to leave a shelf.
  const far = [{ mhz: 2000, workingMv: 850, stockMv: 900, depthMv: 50, lastStableAt: 2000 }, { mhz: 2800, workingMv: 870, stockMv: 980, depthMv: 110, lastStableAt: 2800 }];
  const farRows = buildRows({ ladder, stockAt, grid, anchors: far, credible: [], maxMhz: 3000 }).rows;
  const shelf = longestShelf(farRows, 'voltageMv', 2000, 2800);
  check('НЕТ ПОЛОК: МЕЖДУ КРАЯМИ НИ ОДНО НАПРЯЖЕНИЕ НЕ СТОИТ ДОЛЬШЕ ДВУХ ЧАСТОТ', shelf <= 2, `самая длинная полка: ${shelf} · ${farRows.map((r) => r.mhz + '@' + r.voltageMv).join(' ')}`);

  // The +25 floor as the DECIDING bound: flat top, the floor gives 895 at 2900 (without it 880).
  const flat = [{ mhz: 2700, workingMv: 870, stockMv: 970, depthMv: 100, lastStableAt: 2700 }, { mhz: 2800, workingMv: 870, stockMv: 980, depthMv: 110, lastStableAt: 2800 }];
  const r29 = buildRows({ ladder, stockAt, grid, anchors: flat, credible: [], maxMhz: 3000 }).rows.find((r) => r.mhz === 2900);
  check('ЭКСТРАПОЛЯЦИЯ ВВЕРХ НЕ НИЖЕ «ВЕРХНИЙ КРАЙ + 25 мВ»', r29.origin === 'extrapolated-up' && r29.voltageMv === 895, `2900: ${r29.voltageMv} (без пола было бы 880)`);
  // R2 on real record shapes: a pass before the oracle date is not evidence
  const recs = [
    { state: 'intent', seq: 1, frequencyMhz: 2800, voltageMv: 850, at: '2026-08-20T10:00:00+03:00' },
    { state: 'verdict', seq: 1, outcome: 'passed', deliveredMhz: 2792, servingMvAfter: 850, at: '2026-08-20T10:00:10+03:00' },
    { state: 'intent', seq: 2, frequencyMhz: 2800, voltageMv: 860, at: '2026-09-01T10:00:00+03:00' },
    { state: 'verdict', seq: 2, outcome: 'passed', deliveredMhz: 2792, servingMvAfter: 860, at: '2026-09-01T10:00:10+03:00' },
  ];
  const tp = trustedPasses(recs);
  check('ПРОЖИГ СТАРОГО ОРАКУЛА НЕ СЧИТАЕТСЯ ДОКАЗАТЕЛЬСТВОМ', tp.length === 1 && tp[0].mv === 860, JSON.stringify(tp));

  // ---- P102-AC1: the curve with a margin per band (epic 101 Ф1 Ш1). Mutation addressees, named BEFORE the run:
  //   MB1 drop the monotone clamp in bandedCurve        → «ЗАПАС ПО ПОЛОСАМ: КРИВАЯ НЕ УБЫВАЕТ…»
  //   MB2 flip the margin's sign (v − marginMv)         → «ЗАПАС ПОДНИМАЕТ…»
  //   MB3 shift one band boundary by one ladder step    → «ГРАНИЦА ПОЛОСЫ ПРИНАДЛЕЖИТ ПОЛОСЕ ВЫШЕ»
  const bGrid = []; for (let v = 800; v <= 1100; v += 5) bGrid.push(v);
  const bLadder = [2000, 2150, 2157, 2300, 2490, 2500, 2600, 2695, 2700, 2795, 2800, 2895, 2900, 2945, 2950, 3000, 3090, 3100];
  const bArgs = { ladder: bLadder, stockAt, grid: bGrid, anchors, credible, maxMhz: 3090 };
  const model = trendModel({ stockAt, grid: bGrid, anchors });
  const boundaries = BANDS.slice(1).map((b) => b.loMhz);
  const holed = BANDS.map((b, i) => (i === 1 ? { ...b, loMhz: BANDS[0].hiMhz + 7 } : b));
  check('ПОЛОСЫ ПОКРЫВАЮТ ОСЬ БЕЗ ДЫР, ДЫРА ОТКЛОНЯЕТСЯ ПО ИМЕНИ', bandsRefusal(BANDS) === null && /не стыкуется/.test(bandsRefusal(holed) ?? ''), bandsRefusal(holed) ?? 'дыра не замечена');
  // The expected boundaries are written HERE, literally, from their source (researches/39 §4 п. 2) — deriving them
  // from BANDS would compare the constant with itself (mutation MB3 proved that shape blind on 2026-09-25).
  const EXPECTED_BOUNDARIES = [2157, 2500, 2700, 2800, 2900, 2950];
  check('ГРАНИЦА ПОЛОСЫ ПРИНАДЛЕЖИТ ПОЛОСЕ ВЫШЕ', BANDS.length === 7 && boundaries.join() === EXPECTED_BOUNDARIES.join()
    && EXPECTED_BOUNDARIES.every((f, i) => bandOf(f) === i + 1 && bandOf(f - 1) === i) && bandOf(180) === 0 && bandOf(3090) === 6,
    EXPECTED_BOUNDARIES.map((f) => `${f}→${BANDS[bandOf(f)]?.id} · ${f - 1}→${BANDS[bandOf(f - 1)]?.id}`).join(' | '));
  const steps = [5, 10, 15, 20, 25, 30, 35];
  const bc = bandedCurve({ ...bArgs, margins: steps });
  check('СТРОКА НЕСЁТ ЗАПАС СВОЕЙ ПОЛОСЫ', bc.rows.every((r) => r.band === BANDS[bandOf(r.mhz)].id && r.marginMv === steps[bandOf(r.mhz)]), bc.rows.map((r) => `${r.mhz}:${r.band}+${r.marginMv}`).join(' '));
  check('ЗАПАС ПОДНИМАЕТ: КАЖДАЯ СТРОКА ≥ ТРЕНД + ЗАПАС ПОЛОСЫ (ИЛИ СТОК)', bc.rows.every((r) => r.voltageMv >= Math.min(r.stockVoltageMv, model.rawAt(r.mhz).v + r.marginMv - 1e-9)),
    bc.rows.map((r) => `${r.mhz}: ${r.voltageMv} против ${(model.rawAt(r.mhz).v + r.marginMv).toFixed(1)}`).join(' · '));
  check('НАПРЯЖЕНИЯ — С СЕТКИ КАРТЫ', bc.rows.every((r) => bGrid.includes(r.voltageMv)));
  check('ЗАПАС ПО ПОЛОСАМ: НЕ ВЫШЕ СТОКА', bc.rows.every((r) => r.voltageMv <= r.stockVoltageMv)
    && bandedCurve({ ...bArgs, margins: [300, 300, 300, 300, 300, 300, 300] }).rows.every((r) => r.voltageMv === r.stockVoltageMv));
  check('ЗАПАС ПО ПОЛОСАМ: НИ ОДНОЙ ЧАСТОТЫ ВЫШЕ МАКСИМУМА КАРТЫ', bc.rows.length === bLadder.length - 1 && bc.rows.every((r) => r.mhz <= 3090), `строк ${bc.rows.length} из ${bLadder.length}`);
  // A falling margin vector makes the raw curve drop at 2157: the clamp must be EXERCISED here, not merely unneeded.
  const falling = bandedCurve({ ...bArgs, margins: [60, 0, 0, 0, 0, 0, 0] });
  check('ЗАПАС ПО ПОЛОСАМ: КРИВАЯ НЕ УБЫВАЕТ С ЧАСТОТОЙ', falling.monotoneRaises > 0 && [bc, falling].every((c) => c.rows.every((r, i) => i === 0 || r.voltageMv >= c.rows[i - 1].voltageMv || r.voltageMv === r.stockVoltageMv)),
    `подъёмов монотонности на падающем векторе ${falling.monotoneRaises} · ${falling.rows.map((r) => r.mhz + '@' + r.voltageMv).join(' ')}`);
  check('ЗАПАС ПО ПОЛОСАМ: НЕ НИЖЕ ИЗВЕСТНОГО ОТКАЗА + ДВА ШАГА', bandedCurve({ ...bArgs, margins: [0, 0, 0, 0, 0, 0, 0] }).rows.every((r) => credible.every((f) => f.mhz > r.mhz || r.voltageMv >= Math.min(r.stockVoltageMv, nextStep(bGrid, nextStep(bGrid, f.mv)))) ));
  const zero = bandedCurve({ ...bArgs, margins: [0, 0, 0, 0, 0, 0, 0] }).rows.map((r) => r.voltageMv).join();
  const trendOnly = buildRows(bArgs).rows.map((r) => r.voltageMv).join();
  check('ЗАПАС 0 — ЭТО КРИВАЯ ТРЕНДА (ЭКСПЕРИМЕНТ №2), ОДНА МОДЕЛЬ НА ДВА ПОСТРОЕНИЯ', zero === trendOnly, `запас 0: ${zero} · тренд: ${trendOnly}`);
  const up = bandedCurve({ ...bArgs, margins: [5, 10, 15, 30, 25, 30, 35] });
  check('ХРАПОВИК ОДНОЙ ПОЛОСЫ НЕ ОПУСКАЕТ НИ ОДНОЙ СТРОКИ И НЕ ТРОГАЕТ ПОЛОСЫ НИЖЕ', up.rows.every((r, i) => r.voltageMv >= bc.rows[i].voltageMv && (bandOf(r.mhz) >= 3 || r.voltageMv === bc.rows[i].voltageMv)));
  let threw = null; try { bandedCurve({ ...bArgs, margins: [30, 30, 30] }); } catch (e) { threw = e.message; }
  // Ш2: the banded curve as a document the snapshot command accepts
  const doc = curveDocFromRows({ rows: bc.rows, name: 'model-selftest', card: { name: 'fixture' }, grid: bGrid, stamp: { driver: '610.88', vbios: '98.03.58.40.8b' }, takenAt: '2026-09-25T01:30:00+03:00' });
  const refusals = validateCurveDoc(doc);
  check('ДОКУМЕНТ КРИВОЙ С ЗАПАСОМ ПРОХОДИТ ВАЛИДАТОР ДОКУМЕНТА', refusals.length === 0, refusals.map((r) => `${r.field}: ${r.why}`).join(' · ').slice(0, 300));
  check('СТРОКА НА СТОКЕ — «НЕ ТРОНУТА», ОСТАЛЬНЫЕ — «МОДЕЛЬ», ЛИШНИХ ПОЛЕЙ НЕТ', doc.frequencies.length === bc.rows.length && doc.frequencies.every((r) => r.tags.join() === (r.voltageMv === r.stockVoltageMv ? 'stop:untouched' : 'origin:model')
    && bc.rows.some((b) => b.mhz === r.mhz && b.voltageMv === r.voltageMv)
    && Object.keys(r).sort().join() === 'editedAt,mhz,provenBy,stockVoltageMv,tags,voltageMv'), doc.frequencies.map((r) => r.mhz + ':' + r.tags).join(' '));
  check('ПЛОХОЙ ВЕКТОР ЗАПАСА ОТКЛОНЯЕТСЯ ПО ИМЕНИ', marginRefusal([30, 30, 30, 30, 30, 30, -10]) !== null && marginRefusal([30, 30, 30, 30, 30, 30, 2.5]) !== null
    && marginRefusal([30, 30, 30, 30, 30, 30, 30]) === null && /запасов 3, полос 7/.test(threw ?? ''), threw ?? 'не отклонил');
  return results;
}

// -------------------------------------------------------------------------------------------------
// 5. CLI
// -------------------------------------------------------------------------------------------------

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('node tools/curve-proposal.mjs [--write]  — кривая агента из найденных краёв; --write пишет curves/proposals/<момент>.json\nnode tools/curve-proposal.mjs --margin <мВ> | --band-margins a,b,c,d,e,f,g [--write] — кривая «тренд + запас по семи полосам» (эпик 101 Ф1)\nnode tools/curve-proposal.mjs --selftest — проверки без файлов и карты');
    process.exit(0);
  }
  if (argv.includes('--selftest')) {
    let r;
    try { r = selfTest(); } catch (e) { r = [{ n: 'САМОПРОВЕРКА УПАЛА — исключение вместо красного блока', ok: false, why: e?.stack?.split('\n').slice(0, 2).join(' ') ?? String(e) }]; }
    for (const b of r) console.log(`${b.ok ? '✅' : '❌'} ${b.n}${b.why ? ' — ' + b.why : ''}`);
    const red = r.filter((b) => !b.ok).length;
    console.log(`\n${r.length - red}/${r.length} зелёных`);
    process.exit(red ? 1 : 0);
  }
  // --margin N (one margin for every band) · --band-margins a,b,c,d,e,f,g (one per band, BANDS order)
  const argAfter = (flag) => { const i = argv.indexOf(flag); return i === -1 ? null : (argv[i + 1] ?? ''); };
  const oneMargin = argAfter('--margin');
  const perBandArg = argAfter('--band-margins');
  if (oneMargin !== null && perBandArg !== null) { console.error('ОШИБКА: --margin и --band-margins вместе не задаются — выберите одно'); process.exit(2); }
  const margins = oneMargin !== null ? BANDS.map(() => Number(oneMargin))
    : perBandArg !== null ? perBandArg.split(',').map((s) => Number(s.trim())) : null;
  if (margins) { const why = marginRefusal(margins); if (why) { console.error(`ОШИБКА: ${why}`); process.exit(2); } }
  const p = propose();
  console.log(`доверенных прожигов (выданная частота, с ${ORACLE_DATE}): ${p.passes.length} · отказов: ${p.fails.length} · опровергнуто физикой: ${p.refuted.length} · краёв-опор: ${p.anchors.length}`);
  console.log('\nОПОРЫ (частота · отказ · последняя стабильная · рабочая точка · сток · глубина)');
  for (const a of p.anchors) console.log(`${a.mhz} · отказ ${a.failMv} (${a.failKind}, ${a.failFrom}) · стабильно ${a.lastStableMv}${a.lastStableAt !== a.mhz ? ' на ' + a.lastStableAt : ''} · РАБОЧАЯ ${a.workingMv}${a.raisedFromMv ? ' (поднята с ' + a.raisedFromMv + ')' : ''} · сток ${a.stockMv} · −${a.depthMv}`);
  console.log('\nОПРОВЕРГНУТЫЕ ОТКАЗЫ (частота/напряжение → чем)');
  console.log(p.refuted.map((f) => `${f.mhz}/${f.mv} ← ${f.refutedBy.mhz}/${f.refutedBy.mv}`).join(' · '));
  console.log(`\nГЛУБИНА ПОД СТОКОМ У КРАЁВ (частота:мВ): ${p.anchors.map((a) => `${a.mhz}:${a.depthMv}`).join(' → ')}`);
  console.log(`проверочные проходы подняли: к отказам ${p.failRaises} · монотонность ${p.monotoneRaises}`);
  const lo = p.anchors[0]?.mhz ?? 0; const hi = p.anchors.at(-1)?.mhz ?? 0;
  console.log(`самая длинная полка между краями ${lo}…${hi} МГц: агент ${longestShelf(p.rows, 'voltageMv', lo, hi)} частот · сток ${longestShelf(p.rows, 'stockVoltageMv', lo, hi)}`);
  // Judged against the edge FLOOR the trend actually honours (edgeFloorMv), signed honestly — the first print used the working
  // point and showed «+-15» for the nine edges whose floor is hang + two steps (caught by the closing judge, 2026-09-14).
  console.log('ЗАПАС НАД ГРАНИЦАМИ КРАЁВ (* — граница = отказ + 2 шага):', p.trend.margins.map((m) => `${m.mhz}${m.own ? '' : '*'}: ${m.marginMv >= 0 ? '+' : ''}${m.marginMv}`).join(' · '));
  console.log(`ТРЕНД: глубина = ${p.trend.a.toFixed(1)} + ${p.trend.b.toFixed(4)}·f · сдвиг ${p.trend.shiftMv.toFixed(1)} мВ · разброс краёв RMS ${p.trend.rmsMv.toFixed(1)} мВ`);
  console.log('\nУГЛЫ КРИВОЙ АГЕНТА:', p.corners.map((c) => `${c.mhz}@${c.mv}`).join(' '));
  let banded = null;
  if (margins) {
    const ladder = p.facts.rows.map((r) => r.mhz);
    const stock = new Map(p.facts.rows.map((r) => [r.mhz, r.stockVoltageMv]));
    banded = bandedCurve({ ladder, stockAt: (m) => stock.get(m), grid: p.facts.grid, anchors: p.anchors, credible: p.credible, maxMhz: p.facts.card.maxGraphicsMhz ?? Math.max(...ladder), margins });
    banded.corners = cornersFromRows(banded.rows, p.facts.grid);
    console.log('\nКРИВАЯ «ТРЕНД + ЗАПАС ПО ПОЛОСАМ» (запас — над касающимся трендом; 0 = эксперимент №2)');
    console.log('полоса · запас, мВ · частот · из них на стоке · глубина под стоком, мВ');
    for (const b of banded.perBand) console.log(`${b.label} · +${b.marginMv} · ${b.rows} · ${b.atStock} · ${b.depthMinMv ?? '—'}…${b.depthMaxMv ?? '—'}`);
    console.log(`подъёмы: к известным отказам ${banded.failRaises} · монотонность ${banded.monotoneRaises}`);
    console.log('УГЛЫ КРИВОЙ С ЗАПАСОМ:', banded.corners.map((c) => `${c.mhz}@${c.mv}`).join(' '));
  }
  // --write-doc <name>: the banded curve as curves/<name>.json — never over an existing file; the snapshot
  // (`npm run curve -- --snapshot --from <name>`) and the candidate profile are the NEXT, separate acts.
  const docName = argAfter('--write-doc');
  if (docName !== null) {
    if (!banded) { console.error('ОШИБКА: --write-doc пишет кривую с запасом — нужен --margin или --band-margins'); process.exit(2); }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(docName)) { console.error(`ОШИБКА: имя документа «${docName}» — только строчные латинские буквы, цифры и дефис`); process.exit(2); }
    const target = curvePath(docName);
    if (existsSync(target)) { console.error(`ОТКАЗ: ${target.replace(/\\/g, '/')} уже существует — документ не перезаписывается`); process.exit(1); }
    const now = new Date(); const off = -now.getTimezoneOffset();
    const local = new Date(now.getTime() + off * 60000).toISOString().slice(0, 19);
    const takenAt = `${local}${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
    const doc = curveDocFromRows({ rows: banded.rows, name: docName, card: p.facts.card, grid: p.facts.grid, stamp: p.facts.stamp, takenAt });
    const refusals = validateCurveDoc(doc, { card: doc.card, frequencyGrid: loadGrid('frequency') }); // curve-store's own form (cmdVerify)
    if (refusals.length) { console.error(`ОТКАЗ: документ не прошёл валидатор — ${refusals.slice(0, 5).map((r) => `${r.field}: ${r.why}`).join(' · ')}`); process.exit(1); }
    saveCurveDoc(doc, { name: docName });
    console.log(`\nзаписан документ кривой: ${target.replace(/\\/g, '/')} (${doc.frequencies.length} строк: модель ${doc.frequencies.filter((r) => r.tags[0] === CURVE_TAGS.ORIGIN_MODEL).length} · на стоке ${doc.frequencies.filter((r) => r.tags[0] === CURVE_TAGS.STOP_UNTOUCHED).length}) — следующий акт: npm run curve -- --snapshot --from ${docName}`);
  }
  if (argv.includes('--write')) {
    const now = new Date(); const off = -now.getTimezoneOffset();
    const local = new Date(now.getTime() + off * 60000).toISOString().slice(0, 19);
    const takenAt = `${local}${off >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
    mkdirSync(PROPOSALS_DIR, { recursive: true });
    const file = join(PROPOSALS_DIR, `${local.replace(/:/g, '-')}.json`);
    const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
    writeFileSync(file, JSON.stringify({
      kind: 'agent-curve-proposal', takenAt,
      basedOn: { curve: { path: CURVE_PATH.replace(/\\/g, '/'), sha256: sha(CURVE_PATH) }, journal: { path: JOURNAL_PATH.replace(/\\/g, '/'), sha256: sha(JOURNAL_PATH), lines: p.records.length } },
      rules: ['R1 GOAL «ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ»', `R2 interviews/026 Q1=B: прожиги с ${ORACLE_DATE}`, 'R3 bugs/124 + interviews/022=B: отказ, опровергнутый прожигом выше и ниже по напряжению, не край',
        'R4 GOAL «КРИТЕРИЙ ПРИЁМКИ» §2: рабочая точка = последняя стабильная + шаг сетки', PROPOSAL_R5,
        'R6 кривая не убывает с частотой, не выше стока и 3090 МГц'],
      anchors: p.anchors, refuted: p.refuted.map((f) => ({ mhz: f.mhz, mv: f.mv, kind: f.kind, seq: f.seq, refutedBy: f.refutedBy })),
      method: banded ? `${PROPOSAL_METHOD}; поверх — запас по полосам (эпик 101 Ф1): ${banded.perBand.map((b) => `${b.label} +${b.marginMv}`).join(' · ')}` : PROPOSAL_METHOD,
      trend: p.trend,
      ...(banded ? { bands: BANDS.map((b) => ({ id: b.id, label: b.label, loMhz: Number.isFinite(b.loMhz) ? b.loMhz : null, hiMhz: Number.isFinite(b.hiMhz) ? b.hiMhz : null })), margins, perBand: banded.perBand } : {}),
      corners: banded ? banded.corners : p.corners, frequencies: banded ? banded.rows : p.rows,
    }, null, 1) + '\n');
    console.log(`\nзаписано: ${file.replace(/\\/g, '/')}`);
  }
}
