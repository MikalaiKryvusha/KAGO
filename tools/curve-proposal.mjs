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
//   R5 between edges: interpolation; above the top edge: extrapolation on the slope DERIVED from the
//      edges; derived depth (stock − V) never deeper than the shallowest proven neighbour; extrapolated
//      rows never below «nearest lower tuned + 25 mV» — plans/25 «Что решено владельцем» item 2.
//      ⚠️ The +25 floor is applied to EXTRAPOLATED rows only: the rule's wording is ambiguous for
//      interpolated rows, and that reading is named to the owner, not hidden.
//   R6 the curve never decreases with frequency (Vmin does not decrease — the project's physics) and
//      never exceeds stock or 3090 MHz (R13).
//
// OUTPUT. `curves/proposals/<moment>.json` — the same shape the editor reads (corners + 389 rows),
// plus the anchors with their evidence. Writes nothing else: not the card, not a profile, not
// `measured.json`. The journal is read only through its pure readers.
//
// Usage: node tools/curve-proposal.mjs [--write] · --selftest
//
// [NOT-TESTED] at birth — the blocks in `selfTest()` flip it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJournal, harvestFromJournal, orphanIntents, corrections, LINE, RUNG_OUTCOME } from '../automation-engine/lib/sweep-journal.mjs';
import { loadFacts, effectiveCurve, CURVE_PATH, JOURNAL_PATH } from '../automation-engine/lib/curve-map.mjs';
import { ORACLE_DATE, FUSE_OFF_POST_MHZ } from './mark-unwatched-rows.mjs';
import { cornersOf } from './curve-editor.mjs';

export const PROPOSALS_DIR = join('curves', 'proposals');
const EXTRAPOLATION_FLOOR_MV = 25; // plans/25 «решено владельцем» item 2 — not the agent's number
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
// 3. The curve — every frequency of the ladder
// -------------------------------------------------------------------------------------------------

/**
 * ⚠️ TWO BOUNDS ON A DERIVED ROW, AND THE FIRST EDITION HAD ONLY ONE. The owner's depth rule is a
 * FLOOR (never deeper than the proven neighbour). Physics adds a CEILING: the working point proven at a
 * HIGHER frequency is sufficient for every frequency below it, and so is a trusted pass one grid step
 * up. Without the ceiling, a shallow anchor far below (2137 MHz, 60 mV under stock) lifted the
 * interpolated middle to 935 mV at 2700 MHz, and the monotone pass then dragged the found edges of
 * 2745…3030 MHz (840…940 mV) up with it — found on the first real run, 2026-09-14.
 */
export function buildRows({ ladder, stockAt, grid, anchors, credible, passes = [], maxMhz }) {
  if (anchors.length === 0) return { rows: ladder.map((mhz) => ({ mhz, voltageMv: stockAt(mhz), stockVoltageMv: stockAt(mhz), origin: 'stock' })), monotoneRaises: 0 };
  const lo = anchors[0];
  const hi = anchors.at(-1);
  const slope = (a, b) => (b && a && b.mhz !== a.mhz ? Math.max(0, (b.workingMv - a.workingMv) / (b.mhz - a.mhz)) : 0);
  const sLow = slope(anchors[0], anchors[1]);
  const sHigh = slope(anchors.at(-2), anchors.at(-1));
  const provenStep = (mhz) => { const e = envelopeAt(passes, mhz); return e ? nextStep(grid, e.mv) : Infinity; };
  const rows = ladder.map((mhz) => {
    const stock = stockAt(mhz);
    let v; let origin;
    const at = anchors.find((a) => a.mhz === mhz);
    if (at) { v = at.workingMv; origin = 'edge'; }
    else if (mhz < lo.mhz) {
      v = Math.min(Math.max(lo.workingMv - sLow * (lo.mhz - mhz), stock - lo.depthMv), lo.workingMv, provenStep(mhz));
      origin = 'extrapolated-down';
    } else if (mhz > hi.mhz) {
      const proven = provenStep(mhz);
      if (Number.isFinite(proven)) { v = Math.max(proven, hi.workingMv); origin = 'inherited'; }
      else { v = Math.max(hi.workingMv + sHigh * (mhz - hi.mhz), hi.workingMv + EXTRAPOLATION_FLOOR_MV, stock - hi.depthMv); origin = 'extrapolated-up'; }
    } else {
      const k = anchors.findIndex((a) => a.mhz > mhz);
      const a = anchors[k - 1]; const b = anchors[k];
      const t = (mhz - a.mhz) / (b.mhz - a.mhz);
      const wanted = Math.max(a.workingMv + t * (b.workingMv - a.workingMv), stock - Math.min(a.depthMv, b.depthMv));
      v = Math.max(Math.min(wanted, b.workingMv, provenStep(mhz)), a.workingMv);
      origin = 'interpolated';
    }
    // a credible failure at or below this frequency bounds it from below (two grid steps over the failure)
    for (const f of credible) if (f.mhz <= mhz) v = Math.max(v, nextStep(grid, nextStep(grid, f.mv)));
    v = Math.min(gridUp(grid, v), stock);
    return { mhz, voltageMv: v, stockVoltageMv: stock, origin };
  });
  // The construction is monotone; this pass only COUNTS what it would have to fix, so a regression is visible.
  let run = -Infinity; let monotoneRaises = 0;
  for (const r of rows) { if (r.voltageMv < run && run <= r.stockVoltageMv) { r.voltageMv = run; monotoneRaises++; } run = Math.max(run, r.voltageMv); }
  return { rows: rows.filter((r) => r.mhz <= maxMhz), monotoneRaises };
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
  const { rows, monotoneRaises } = buildRows({ ladder, stockAt, grid: facts.grid, anchors, credible, passes, maxMhz });
  return { facts, records, passes, fails, anchors, credible, refuted, rows, monotoneRaises, corners: cornersFromRows(rows, facts.grid), current: cornersOf(effectiveCurve(facts)) };
}

// -------------------------------------------------------------------------------------------------
// 4. Selftest — fixtures in memory, no files, no card
// -------------------------------------------------------------------------------------------------

export function selfTest() {
  const results = [];
  const check = (n, ok, why = '') => results.push({ n, ok: !!ok, why });
  const grid = [800, 805, 810, 815, 820, 825, 830, 835, 840, 845, 850, 860, 870, 880, 890, 900, 910, 920, 930, 940, 950, 960, 980, 1000];
  const ladder = [2000, 2100, 2200, 2300, 2400, 2500, 2600, 2700, 2800, 2900, 3000];
  const stockAt = (m) => 900 + Math.round((m - 2000) / 10); // 900 … 1000, rising
  const passes = [{ mhz: 2300, mv: 830 }, { mhz: 2700, mv: 860 }, { mhz: 2900, mv: 900 }];
  const fails = [
    { mhz: 2300, mv: 825, kind: 'hung' },  // real edge: pass 830 just above
    { mhz: 2700, mv: 850, kind: 'hung' },  // real edge
    { mhz: 2500, mv: 950, kind: 'hung' },  // refuted: 2700 passed at 860 (higher f, lower v)
  ];
  const { anchors, credible, refuted } = anchorsFrom({ passes, fails, grid, stockAt });
  check('ФИЗИКА СНИМАЕТ ОТКАЗ, ОПРОВЕРГНУТЫЙ ПРОЖИГОМ ВЫШЕ', refuted.length === 1 && refuted[0].mhz === 2500 && credible.length === 2);
  check('ПРОЖИГ НИЖЕ ПО ЧАСТОТЕ ОТКАЗ НЕ ОПРОВЕРГАЕТ', refutedBy({ mhz: 2800, mv: 900 }, [{ mhz: 2700, mv: 860 }]) === null);
  const a23 = anchors.find((a) => a.mhz === 2300);
  check('РАБОЧАЯ ТОЧКА = ПОСЛЕДНЯЯ СТАБИЛЬНАЯ + ШАГ СЕТКИ', a23?.workingMv === 835, `2300: ${a23?.workingMv}`);
  const { rows } = buildRows({ ladder, stockAt, grid, anchors, credible, passes, maxMhz: 3000 });
  check('КРИВАЯ НЕ УБЫВАЕТ С ЧАСТОТОЙ', rows.every((r, i) => i === 0 || r.voltageMv >= rows[i - 1].voltageMv));
  check('НИ ОДНА СТРОКА НЕ ВЫШЕ СТОКА', rows.every((r) => r.voltageMv <= stockAt(r.mhz)));
  // A fixture where the +25 floor is the DECIDING bound: flat top (slope 0), depth cap gives 880, the floor 895 → grid 900.
  const flat = [{ mhz: 2700, workingMv: 870, depthMv: 100 }, { mhz: 2800, workingMv: 870, depthMv: 110 }];
  const r29 = buildRows({ ladder, stockAt, grid, anchors: flat, credible: [], passes: [], maxMhz: 3000 }).rows.find((r) => r.mhz === 2900);
  check('ЭКСТРАПОЛЯЦИЯ ВВЕРХ НЕ НИЖЕ «ВЕРХНИЙ КРАЙ + 25 мВ»', r29.origin === 'extrapolated-up' && r29.voltageMv === 900, `2900: ${r29.voltageMv} (без пола было бы 880)`);
  const mid = rows.find((r) => r.mhz === 2500);
  const depthCap = Math.min(...anchors.map((a) => a.depthMv));
  check('ВЫВЕДЕННАЯ ГЛУБИНА НЕ ГЛУБЖЕ ДОКАЗАННОЙ СОСЕДКИ', mid.origin === 'interpolated' && stockAt(2500) - mid.voltageMv <= depthCap, `2500: ${mid.voltageMv} при стоке ${stockAt(2500)}`);
  check('ПРОИСХОЖДЕНИЕ НАЗВАНО В КАЖДОЙ СТРОКЕ', rows.every((r) => ['edge', 'interpolated', 'inherited', 'extrapolated-down', 'extrapolated-up'].includes(r.origin)));
  // The defect of the first real run: a shallow anchor far below must not lift the middle over the next anchor.
  const far = [{ mhz: 2000, workingMv: 850, depthMv: 50 }, { mhz: 2800, workingMv: 870, depthMv: 110 }];
  const farRows = buildRows({ ladder, stockAt, grid, anchors: far, credible: [], passes: [], maxMhz: 3000 }).rows;
  const r27 = farRows.find((r) => r.mhz === 2700); const r28 = farRows.find((r) => r.mhz === 2800);
  check('НАЙДЕННЫЙ КРАЙ НЕ ЗАДИРАЕТСЯ ИНТЕРПОЛЯЦИЕЙ СНИЗУ', r28.voltageMv === 870 && r27.voltageMv <= 870, `2700: ${r27.voltageMv} · 2800: ${r28.voltageMv}`);
  // 840 + one grid step = 845, deliberately BELOW the next anchor's 870 — so this block cannot pass on the anchor cap alone.
  const provenCap = buildRows({ ladder, stockAt, grid, anchors: far, credible: [], passes: [{ mhz: 2500, mv: 840 }], maxMhz: 3000 }).rows.find((r) => r.mhz === 2400);
  check('ВЫВЕДЕННАЯ СТРОКА НЕ ВЫШЕ ДОКАЗАННОГО ПРОЖИГОМ + ШАГ', provenCap.voltageMv === 850, `2400: ${provenCap.voltageMv} (ждём 850: доказано 845, но не ниже нижней опоры 850)`);
  // R2 on real record shapes: a pass before the oracle date is not evidence
  const recs = [
    { state: 'intent', seq: 1, frequencyMhz: 2800, voltageMv: 850, at: '2026-08-20T10:00:00+03:00' },
    { state: 'verdict', seq: 1, outcome: 'passed', deliveredMhz: 2792, servingMvAfter: 850, at: '2026-08-20T10:00:10+03:00' },
    { state: 'intent', seq: 2, frequencyMhz: 2800, voltageMv: 860, at: '2026-09-01T10:00:00+03:00' },
    { state: 'verdict', seq: 2, outcome: 'passed', deliveredMhz: 2792, servingMvAfter: 860, at: '2026-09-01T10:00:10+03:00' },
  ];
  const tp = trustedPasses(recs);
  check('ПРОЖИГ СТАРОГО ОРАКУЛА НЕ СЧИТАЕТСЯ ДОКАЗАТЕЛЬСТВОМ', tp.length === 1 && tp[0].mv === 860, JSON.stringify(tp));
  return results;
}

// -------------------------------------------------------------------------------------------------
// 5. CLI
// -------------------------------------------------------------------------------------------------

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('node tools/curve-proposal.mjs [--write]  — кривая агента из найденных краёв; --write пишет curves/proposals/<момент>.json\nnode tools/curve-proposal.mjs --selftest — проверки без файлов и карты');
    process.exit(0);
  }
  if (argv.includes('--selftest')) {
    const r = selfTest();
    for (const b of r) console.log(`${b.ok ? '🟢' : '🔴'} ${b.n}${b.why ? ' — ' + b.why : ''}`);
    const red = r.filter((b) => !b.ok).length;
    console.log(`\n${r.length - red}/${r.length} зелёных`);
    process.exit(red ? 1 : 0);
  }
  const p = propose();
  console.log(`доверенных прожигов (выданная частота, с ${ORACLE_DATE}): ${p.passes.length} · отказов: ${p.fails.length} · опровергнуто физикой: ${p.refuted.length} · краёв-опор: ${p.anchors.length}`);
  console.log('\nОПОРЫ (частота · отказ · последняя стабильная · рабочая точка · сток · глубина)');
  for (const a of p.anchors) console.log(`${a.mhz} · отказ ${a.failMv} (${a.failKind}, ${a.failFrom}) · стабильно ${a.lastStableMv}${a.lastStableAt !== a.mhz ? ' на ' + a.lastStableAt : ''} · РАБОЧАЯ ${a.workingMv}${a.raisedFromMv ? ' (поднята с ' + a.raisedFromMv + ')' : ''} · сток ${a.stockMv} · −${a.depthMv}`);
  console.log('\nОПРОВЕРГНУТЫЕ ОТКАЗЫ (частота/напряжение → чем)');
  console.log(p.refuted.map((f) => `${f.mhz}/${f.mv} ← ${f.refutedBy.mhz}/${f.refutedBy.mv}`).join(' · '));
  console.log(`\nподнято проходом монотонности: ${p.monotoneRaises}`);
  console.log('\nУГЛЫ КРИВОЙ АГЕНТА:', p.corners.map((c) => `${c.mhz}@${c.mv}`).join(' '));
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
        'R4 GOAL «КРИТЕРИЙ ПРИЁМКИ» §2: рабочая точка = последняя стабильная + шаг сетки', 'R5 plans/25 «решено владельцем» п.2: интерполяция, экстраполяция по выведенному наклону, глубина ≤ доказанной соседки, экстраполяция ≥ верхний край + 25 мВ',
        'R6 кривая не убывает с частотой, не выше стока и 3090 МГц'],
      anchors: p.anchors, refuted: p.refuted.map((f) => ({ mhz: f.mhz, mv: f.mv, kind: f.kind, seq: f.seq, refutedBy: f.refutedBy })),
      corners: p.corners, frequencies: p.rows,
    }, null, 1) + '\n');
    console.log(`\nзаписано: ${file.replace(/\\/g, '/')}`);
  }
}
