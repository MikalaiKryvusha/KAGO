// =================================================================================================
// THE CURVE EDITOR — the owner drags the corners of the effective V/F line and saves what he dialled
// =================================================================================================
//
// WHY. The owner, 2026-09-14: *«открой картинку VS кривой, которая у нас получается. Сделай её
// интерактивной, чтобы я мог покрутить точки, и внизу кнопка [Сохранить] — чтобы я мог записать
// значения, которые накрутил — ты их подставишь в профиль»*.
//
// WHAT IS DRAGGED. Not the 389 rows of the document — the CORNERS of the effective curve, i.e. the
// line that actually lands on the card (`curve-map.effectiveCurve`: for every voltage rung, the highest
// frequency that voltage serves). The facts come from `curve-map.loadFacts` — the one reader the map
// and the watch window already use (EXP lesson: a picture of an engine decision CALLS the engine's
// function, it never re-derives the rule). The journal is read only through its pure readers inside
// `loadFacts`; `resumeState` is never called.
//
// WHAT SAVE WRITES. `curves/edits/<moment>.json` — the corners the owner set and the frequency →
// voltage rows DERIVED from them (`rowsFromCorners`, the inverse of `effectiveCurve`), each row flagged
// against the engine's hang floor and the deepest proven pass. It writes NOTHING else: not
// `measured.json`, not a profile, not the card. Putting an edit into a profile is a separate act.
//
// GPU WRITES: NONE.
//
// Usage: node tools/curve-editor.mjs [--port 17387] [--open]   ·   node tools/curve-editor.mjs --selftest
//
// [NOT-TESTED] the page in the owner's browser · [TESTED: 2026-09-14 · `--selftest`, blocks below]

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { loadFacts, effectiveCurve, curveFacts, CURVE_PATH } from '../automation-engine/lib/curve-map.mjs';
import { contradictions } from './hang-floor-physics-lint.mjs';

const EDITS_DIR = join('curves', 'edits');
const IDLE_EXIT_MS = 3 * 60 * 60 * 1000; // a forgotten server leaves by itself after three quiet hours

// -------------------------------------------------------------------------------------------------
// 1. The arithmetic — pure, shared by /preview and /save, checked by the selftest
// -------------------------------------------------------------------------------------------------

/** Corners of an effective curve: the rungs where the served frequency changes. */
export function cornersOf(effective) {
  const out = [];
  for (let i = 0; i < effective.length; i++) if (i === 0 || effective[i].mhz !== effective[i - 1].mhz) out.push({ ...effective[i] });
  return out;
}

/**
 * Refusals by name: every corner on the card's voltage grid and frequency ladder, both axes strictly
 * rising, nothing above the card's own maximum (R13).
 */
export function cornerRefusal(corners, { grid, ladder, maxMhz }) {
  if (!Array.isArray(corners) || corners.length === 0) return 'нет ни одной точки';
  const g = new Set(grid);
  const l = new Set(ladder);
  for (const c of corners) {
    if (!g.has(c?.mv)) return `${c?.mv} мВ — не ступень сетки напряжений карты`;
    if (!l.has(c?.mhz)) return `${c?.mhz} МГц — не частота лестницы карты`;
    if (Number.isFinite(maxMhz) && c.mhz > maxMhz) return `${c.mhz} МГц выше максимума карты ${maxMhz} МГц`;
  }
  for (let i = 1; i < corners.length; i++) {
    if (corners[i].mv <= corners[i - 1].mv) return `напряжения не растут: ${corners[i - 1].mv} → ${corners[i].mv} мВ`;
    if (corners[i].mhz <= corners[i - 1].mhz) return `частоты не растут: ${corners[i - 1].mhz} → ${corners[i].mhz} МГц`;
  }
  return null;
}

/**
 * THE INVERSE OF `effectiveCurve`. For each frequency: the lowest corner voltage whose frequency
 * reaches it; never above the row's stock voltage (the card keeps stock there, and a line drawn to
 * the right of stock buys nothing). Each row is flagged against the engine's facts.
 */
export function rowsFromCorners(corners, facts) {
  const sorted = corners.slice().sort((a, b) => a.mv - b.mv);
  // PROVEN IS INHERITED DOWNWARD — the project's accepted rule (`origin:inherited`, GOAL.md → «КРИТЕРИЙ
  // ПРИЁМКИ»: Vmin does not decrease with frequency): a voltage that passed at F is proven for every
  // frequency below F. So the proven depth of a row is the lowest pass at or above its frequency.
  const passes = [...facts.proven].map(([mhz, p]) => ({ mhz, mv: p.voltageMv })).sort((a, b) => b.mhz - a.mhz);
  const provenAtOrAbove = (mhz) => {
    let best = null;
    for (const p of passes) { if (p.mhz < mhz) break; if (best === null || p.mv < best) best = p.mv; }
    return best;
  };
  return facts.rows.map((r) => {
    const c = sorted.find((k) => k.mhz >= r.mhz);
    const drawn = c ? c.mv : r.stockVoltageMv;
    const voltageMv = Math.min(drawn, r.stockVoltageMv);
    const floor = facts.floors.get(r.mhz)?.voltageMv ?? null;
    const proven = provenAtOrAbove(r.mhz);
    return {
      mhz: r.mhz, voltageMv, stockVoltageMv: r.stockVoltageMv,
      atOrBelowHangFloor: floor !== null && voltageMv <= floor, hangFloorMv: floor,
      deeperThanProven: voltageMv < r.stockVoltageMv && (proven === null || voltageMv < proven), provenMv: proven,
      clampedToStock: drawn > r.stockVoltageMv,
    };
  });
}

/** Consecutive frequencies at one voltage → one range, so a list reads as «1320…2295 МГц · 775 мВ». */
export function asRanges(rows, ladder) {
  const pos = new Map(ladder.map((m, i) => [m, i]));
  const out = [];
  for (const r of rows.slice().sort((a, b) => a.mhz - b.mhz)) {
    const last = out.at(-1);
    if (last && last.mv === r.mv && pos.get(r.mhz) === pos.get(last.to) + 1) { last.to = r.mhz; last.n++; if (r.floor !== undefined) last.floor = Math.max(last.floor ?? -Infinity, r.floor ?? -Infinity); }
    else out.push({ from: r.mhz, to: r.mhz, mv: r.mv, n: 1, floor: r.floor ?? null, proven: r.proven ?? null });
  }
  return out;
}

/**
 * What the edit CHANGED against the curve that lands on the card today (`baseline`), and which risks
 * it ADDED. Risks already present in today's curve are counted apart: they are not the owner's doing,
 * and mixing them in made an untouched page report 183 changes (seen on the first render, 2026-09-14).
 */
export function summarize(rows, baseline, ladder) {
  const base = new Map(baseline.map((r) => [r.mhz, r]));
  const deeper = (r) => r.voltageMv < (base.get(r.mhz)?.voltageMv ?? Infinity);
  const risk = (list) => list.map((r) => ({ mhz: r.mhz, mv: r.voltageMv, floor: r.hangFloorMv, proven: r.provenMv }));
  const hangAll = rows.filter((r) => r.atOrBelowHangFloor);
  const unprovenAll = rows.filter((r) => r.deeperThanProven && !r.atOrBelowHangFloor);
  return {
    changed: rows.filter((r) => r.voltageMv !== base.get(r.mhz)?.voltageMv).length,
    deeper: rows.filter(deeper).length,
    shallower: rows.filter((r) => r.voltageMv > (base.get(r.mhz)?.voltageMv ?? -Infinity)).length,
    hang: asRanges(risk(hangAll.filter(deeper)), ladder),
    unproven: asRanges(risk(unprovenAll.filter(deeper)), ladder),
    already: {
      hang: asRanges(risk(hangAll.filter((r) => !deeper(r))), ladder),
      unproven: asRanges(risk(unprovenAll.filter((r) => !deeper(r))), ladder),
    },
  };
}

// -------------------------------------------------------------------------------------------------
// 2. The page
// -------------------------------------------------------------------------------------------------

function pageHtml(data) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>KAGO — редактор кривой</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f6f7f9; color: #16181d; font: 16px/1.5 "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width: 1500px; margin: 0 auto; padding: 18px 24px 40px; }
  h1 { font-size: 24px; margin: 0 0 2px; }
  .sub { color: #5c626e; margin: 0 0 14px; font-size: 14px; }
  .card { background: #fff; border: 1px solid #e3e6ec; border-radius: 10px; padding: 12px 14px; margin: 0 0 14px; }
  svg { display: block; width: 100%; height: auto; user-select: none; touch-action: none; }
  .grid { stroke: #eceef2; } .ax { fill: #7a8090; font-size: 13px; }
  .stock { fill: none; stroke: #9aa1ae; stroke-width: 2; }
  .orig { fill: none; stroke: #1e9e5a; stroke-width: 2; stroke-dasharray: 6 5; opacity: .55; }
  .edit { fill: none; stroke: #6b3fd4; stroke-width: 3; }
  .proven { fill: #2b6cb0; opacity: .5; } .floor { fill: #d23b3b; }
  .cmp { fill: none; stroke: #e07b39; stroke-width: 2; opacity: .9; } .anchor { fill: #111; }
  .refuted { fill: none; stroke: #9aa1ae; stroke-width: 1.6; }
  .h { fill: #fff; stroke: #6b3fd4; stroke-width: 3; cursor: grab; }
  .h:hover, .h.drag { fill: #6b3fd4; } .h.bad { stroke: #d23b3b; } .h.warn { stroke: #d98a1c; }
  .tip { font-size: 15px; font-weight: 600; fill: #3a1f8a; paint-order: stroke; stroke: #fff; stroke-width: 4; }
  .legend { display: flex; gap: 20px; flex-wrap: wrap; font-size: 14px; color: #3b414d; margin: 8px 2px 0; }
  .legend i { display: inline-block; width: 24px; height: 3px; vertical-align: middle; margin-right: 6px; }
  .legend b { display: inline-block; width: 10px; height: 10px; border-radius: 50%; vertical-align: middle; margin-right: 6px; }
  .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  button { font: 600 17px "Segoe UI", system-ui, sans-serif; padding: 10px 26px; border-radius: 8px; border: 1px solid #c9ced8; background: #fff; cursor: pointer; }
  button.save { background: #6b3fd4; border-color: #6b3fd4; color: #fff; }
  button:disabled { opacity: .5; cursor: default; }
  .status { font-size: 15px; } .bad { color: #c22; } .warn { color: #b06a00; } .ok { color: #1e9e5a; }
  .warnbox { font-size: 14px; max-height: 190px; overflow: auto; }
  .hint { color: #5c626e; font-size: 13px; }
</style></head><body><div class="wrap">
<h1>Кривая V/F — редактор</h1>
<p class="sub">Источник: <code>${data.source}</code> · драйвер ${data.stamp.driver ?? '?'} · VBIOS ${data.stamp.vbios ?? '?'} · тронуто частот ${data.touched} из ${data.ladder.length}.
Тяните фиолетовые точки. Двойной клик по полю — добавить точку, правый клик по точке — убрать.</p>
${data.start ? `<p class="sub">Открыта: <b>${data.start.label}</b> <code>${data.start.path}</code>${data.start.refusal ? ` — <span class="bad">не открылась: ${data.start.refusal}</span>` : ''}</p>` : ''}
<div class="card"><svg id="plot" viewBox="0 0 1400 720"></svg>
<div class="legend">
 <span><i style="background:#9aa1ae"></i>сток</span>
 <span><i style="background:#1e9e5a;opacity:.6"></i>кривая сейчас (то, что ложится в карту)</span>
 <span><i style="background:#6b3fd4"></i>кривая на экране — её сохраняет кнопка</span>
 ${data.compare ? `<span><i style="background:#e07b39"></i>${data.compare.label}</span>` : ''}
 ${data.anchors.length ? '<span><b style="background:#111;border-radius:1px;transform:rotate(45deg)"></b>найденный край: рабочая точка по правилу «последняя стабильная + шаг»</span>' : ''}
 <span><b style="background:#2b6cb0;opacity:.6"></b>самое глубокое, что прошло прожиг</span>
 <span><b style="background:#d23b3b"></b>пол зависания — здесь карта уже вешала машину</span>
 ${data.refutedFloors.length ? `<span><b style="border:1.6px solid #9aa1ae"></b>стена, опровергнутая прожигом выше по частоте (${data.refutedFloors.length}, bugs/124) — не край</span>` : ''}
</div></div>
<div class="card"><div id="warn" class="warnbox"></div></div>
<div class="card bar">
 <button class="save" id="save">Сохранить</button>
 <button id="down">Вся кривая на шаг вниз</button>
 <button id="up">Вся кривая на шаг вверх</button>
 ${data.start && !data.start.refusal ? '<button id="back">Вернуть открытую</button>' : ''}
 <button id="reset">Сбросить к текущей</button>
 <span id="status" class="status"></span>
</div>
<p class="hint">Сохранение пишет только файл в <code>curves/edits/</code>. Ни карта, ни профиль, ни документ кривой при этом не меняются.</p>
</div>
<script>
const D = ${JSON.stringify(data)};
const W = 1400, H = 720, P = { l: 84, r: 30, t: 24, b: 60 };
const xMin = 700, xMax = Math.ceil((Math.max(...D.stock.map(s => s.mv)) + 20) / 50) * 50;
const yMin = 0, yMax = D.maxMhz;
const X = mv => P.l + (mv - xMin) / (xMax - xMin) * (W - P.l - P.r);
const Y = f => P.t + (1 - (f - yMin) / (yMax - yMin)) * (H - P.t - P.b);
const iX = px => xMin + (px - P.l) / (W - P.l - P.r) * (xMax - xMin);
const iY = py => yMin + (1 - (py - P.t) / (H - P.t - P.b)) * (yMax - yMin);
const snap = (arr, v) => arr.reduce((a, b) => Math.abs(b - v) < Math.abs(a - v) ? b : a);
const svg = document.getElementById('plot');
const NS = 'http://www.w3.org/2000/svg';
const el = (t, a, parent = svg) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); parent.appendChild(e); return e; };
const opened = () => (D.start && D.start.corners ? D.start.corners : D.corners).map(c => ({ ...c }));
let corners = opened();
let flags = new Map();

// Step line through corners exactly as the card reads it: a rung serves its corner's frequency until the next corner.
const stepPts = cs => { const p = []; cs.forEach((c, i) => { if (i) p.push([X(c.mv), Y(cs[i - 1].mhz)]); p.push([X(c.mv), Y(c.mhz)]); }); return p.map(q => q.join(',')).join(' '); };

function drawStatic() {
  for (let mv = xMin; mv <= xMax; mv += 50) { el('line', { x1: X(mv), y1: P.t, x2: X(mv), y2: H - P.b, class: 'grid' }); el('text', { x: X(mv), y: H - P.b + 22, class: 'ax', 'text-anchor': 'middle' }).textContent = mv; }
  for (let f = 0; f <= yMax; f += 250) { el('line', { x1: P.l, y1: Y(f), x2: W - P.r, y2: Y(f), class: 'grid' }); el('text', { x: P.l - 10, y: Y(f) + 4, class: 'ax', 'text-anchor': 'end' }).textContent = f; }
  el('text', { x: W - P.r, y: H - 12, class: 'ax', 'text-anchor': 'end' }).textContent = 'напряжение, мВ';
  el('text', { x: 10, y: P.t + 4, class: 'ax' }).textContent = 'МГц';
  el('polyline', { points: D.stock.filter(s => s.mv >= xMin).map(s => X(s.mv) + ',' + Y(s.mhz)).join(' '), class: 'stock' });
  el('polyline', { points: stepPts(D.corners), class: 'orig' });
  if (D.compare) el('polyline', { points: stepPts(D.compare.corners), class: 'cmp' });
  for (const a of D.anchors) {
    if (a.workingMv < xMin) continue;
    const cx = X(a.workingMv), cy = Y(a.mhz);
    el('rect', { x: cx - 6, y: cy - 6, width: 12, height: 12, class: 'anchor', transform: 'rotate(45 ' + cx + ' ' + cy + ')' })
      .appendChild(title(a.mhz + ' МГц: отказ ' + a.failMv + ' мВ (' + a.failKind + '), стабильно ' + a.lastStableMv + ' мВ' + (a.lastStableAt !== a.mhz ? ' на ' + a.lastStableAt + ' МГц' : '') + ' → рабочая точка ' + a.workingMv + ' мВ'));
  }
  for (const p of D.proven) if (p.mv >= xMin) el('circle', { cx: X(p.mv), cy: Y(p.mhz), r: 3, class: 'proven' }).appendChild(title(p.mhz + ' МГц: прошло ' + p.mv + ' мВ'));
  for (const p of D.floors) if (p.mv >= xMin) el('circle', { cx: X(p.mv), cy: Y(p.mhz), r: 5, class: 'floor' }).appendChild(title(p.mhz + ' МГц: пол зависания ' + p.mv + ' мВ'));
  for (const p of D.refutedFloors) if (p.mv >= xMin) el('circle', { cx: X(p.mv), cy: Y(p.mhz), r: 5, class: 'refuted' }).appendChild(title(p.mhz + ' МГц: стена ' + p.mv + ' мВ противоречит физике — ' + p.higherMhz + ' МГц прошла на ' + p.passedMv + ' мВ (bugs/124), краем не считается'));
}
function title(t) { const e = document.createElementNS(NS, 'title'); e.textContent = t; return e; }

const dyn = el('g', {});
let dragI = -1;
function draw() {
  dyn.innerHTML = '';
  el('polyline', { points: stepPts(corners), class: 'edit' }, dyn);
  corners.forEach((c, i) => {
    const f = flags.get(i);
    const h = el('circle', { cx: X(c.mv), cy: Y(c.mhz), r: 9, class: 'h' + (i === dragI ? ' drag' : '') + (f ? ' ' + f : '') }, dyn);
    h.addEventListener('pointerdown', ev => { dragI = i; svg.setPointerCapture(ev.pointerId); draw(); });
    h.addEventListener('contextmenu', ev => { ev.preventDefault(); if (corners.length > 2) { corners.splice(i, 1); changed(); } });
    if (i === dragI) el('text', { x: X(c.mv) + 14, y: Y(c.mhz) - 12, class: 'tip' }, dyn).textContent = c.mhz + ' МГц · ' + c.mv + ' мВ';
  });
}
const toSvg = ev => { const r = svg.getBoundingClientRect(); return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height]; };
svg.addEventListener('pointermove', ev => {
  if (dragI < 0) return;
  const [px, py] = toSvg(ev);
  const lo = corners[dragI - 1], hi = corners[dragI + 1];
  const grid = D.grid.filter(v => (!lo || v > lo.mv) && (!hi || v < hi.mv));
  const lad = D.ladder.filter(v => (!lo || v > lo.mhz) && (!hi || v < hi.mhz));
  if (!grid.length || !lad.length) return;
  corners[dragI] = { mv: snap(grid, iX(px)), mhz: snap(lad, iY(py)) };
  draw();
});
svg.addEventListener('pointerup', () => { if (dragI >= 0) { dragI = -1; changed(); } });
svg.addEventListener('dblclick', ev => {
  const [px, py] = toSvg(ev);
  const mv = snap(D.grid, iX(px)), mhz = snap(D.ladder, iY(py));
  if (corners.some(c => c.mv === mv || c.mhz === mhz)) return;
  corners.push({ mv, mhz }); corners.sort((a, b) => a.mv - b.mv);
  for (let i = 1; i < corners.length; i++) if (corners[i].mhz <= corners[i - 1].mhz) { corners.splice(corners.indexOf(corners.find(c => c.mv === mv)), 1); setStatus('Точка не встала: частоты должны расти вместе с напряжением', 'warn'); return; }
  changed();
});

async function post(path) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ corners, startedFrom: D.start && !D.start.refusal ? D.start.path : null }) });
  return r.json();
}
function setStatus(t, cls) { const s = document.getElementById('status'); s.textContent = t; s.className = 'status ' + (cls || ''); }
async function changed() {
  draw();
  const r = await post('/preview');
  if (r.refusal) { setStatus('Не так: ' + r.refusal, 'bad'); return; }
  const s = r.summary;
  setStatus(s.changed ? 'Изменено частот против текущей кривой: ' + s.changed + ' (глубже ' + s.deeper + ', выше ' + s.shallower + ')' : 'Кривая не менялась', '');
  flags = new Map();
  corners.forEach((c, i) => {
    if (s.hang.some(h => h.mv === c.mv)) flags.set(i, 'bad');
    else if (s.unproven.some(h => h.mv === c.mv)) flags.set(i, 'warn');
  });
  draw();
  const count = list => list.reduce((a, x) => a + x.n, 0);
  const rng = x => (x.from === x.to ? x.from : x.from + '…' + x.to) + ' МГц · ' + x.mv + ' мВ';
  const hangTxt = list => list.map(x => rng(x) + (x.floor ? ' (пол ' + x.floor + ')' : '')).join(' · ');
  const unTxt = list => list.map(x => rng(x) + (x.proven ? ' (доказано ' + x.proven + ')' : ' (прожигов выше нет)')).join(' · ');
  let html = '';
  if (s.hang.length) html += '<div class="bad"><b>🔴 Кривая на экране кладёт на пол зависания или ниже — ' + count(s.hang) + ' частот:</b> ' + hangTxt(s.hang) + '</div>';
  if (s.unproven.length) html += '<div class="warn"><b>🟡 Кривая на экране глубже доказанного прожигом — ' + count(s.unproven) + ' частот:</b> ' + unTxt(s.unproven) + '</div>';
  if (s.deeper && !s.hang.length && !s.unproven.length) html += '<div class="ok">Кривая на экране не уходит глубже доказанного прожигом.</div>';
  const a = s.already;
  if (a.hang.length || a.unproven.length) html += '<div class="hint" style="margin-top:6px">Уже в текущей кривой: '
    + (a.hang.length ? 'на полу зависания ' + count(a.hang) + ' частот — ' + hangTxt(a.hang) : '')
    + (a.hang.length && a.unproven.length ? '; ' : '')
    + (a.unproven.length ? 'глубже доказанного ' + count(a.unproven) + ' частот — ' + unTxt(a.unproven) : '') + '</div>';
  document.getElementById('warn').innerHTML = html || '<div class="hint">Правок нет.</div>';
}
document.getElementById('reset').onclick = () => { corners = D.corners.map(c => ({ ...c })); changed(); };
if (document.getElementById('back')) document.getElementById('back').onclick = () => { corners = opened(); changed(); };
// One step of the CARD'S grid for every corner at once — the grid is uneven (5 and 10 mV), so it is a step, not a number.
function shift(dir) {
  const g = D.grid;
  const moved = corners.map(c => { const i = g.indexOf(c.mv); const j = i + dir; return j >= 0 && j < g.length && g[j] >= xMin ? { mv: g[j], mhz: c.mhz } : null; });
  if (moved.some(m => m === null)) { setStatus('Дальше сдвигать некуда: крайняя точка упёрлась в край сетки', 'warn'); return; }
  corners = moved; changed();
}
document.getElementById('down').onclick = () => shift(-1);
document.getElementById('up').onclick = () => shift(1);
document.getElementById('save').onclick = async () => {
  const b = document.getElementById('save'); b.disabled = true;
  const r = await post('/save'); b.disabled = false;
  if (r.refusal) setStatus('Не сохранено: ' + r.refusal, 'bad');
  else setStatus('✅ Сохранено: ' + r.file, 'ok');
};
drawStatic(); svg.appendChild(dyn); changed();
</script></body></html>`;
}

// -------------------------------------------------------------------------------------------------
// 3. The server — 127.0.0.1 only
// -------------------------------------------------------------------------------------------------

/**
 * A saved curve to open or to compare with — ONLY from the two directories this tool and
 * `curve-proposal.mjs` write, never an arbitrary path from a URL.
 */
export function readSavedCurve(path, limits) {
  if (!path) return null;
  const p = String(path).replace(/\\/g, '/');
  if (!/^curves\/(edits|proposals)\/[\w.+-]+\.json$/.test(p)) return { path: p, label: p, refusal: 'открываются только файлы из curves/edits/ и curves/proposals/' };
  if (!existsSync(p)) return { path: p, label: p, refusal: 'файла нет' };
  let doc;
  try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return { path: p, label: p, refusal: `не разбирается: ${e.message}` }; }
  const time = String(doc.takenAt ?? '').slice(11, 16);
  const label = doc.kind === 'agent-curve-proposal' ? `предложение агента ${time}` : `ваша правка ${time}`;
  const refusal = cornerRefusal(doc.corners, limits);
  return { path: p, label, kind: doc.kind ?? null, refusal, corners: refusal ? null : doc.corners, anchors: Array.isArray(doc.anchors) ? doc.anchors : [] };
}

function snapshotData({ start = null, compare = null } = {}) {
  const r = loadFacts();
  if (!r.ok) throw new Error(r.why);
  // A WALL THAT CONTRADICTS PHYSICS IS NOT AN EDGE (`bugs/124`): a higher frequency passed on a lower voltage.
  // Asked of the project's own lint, not re-derived here; such walls are drawn hollow and never flagged red.
  const refutedFloors = new Map(contradictions(r.facts.floors, new Map([...r.facts.proven].map(([m, p]) => [m, p.voltageMv]))).map((c) => [c.mhz, c]));
  const f = { ...r.facts, floors: new Map([...r.facts.floors].filter(([m]) => !refutedFloors.has(m))) };
  const effective = effectiveCurve(f);
  const limits = { grid: f.grid, ladder: f.rows.map((x) => x.mhz), maxMhz: f.card.maxGraphicsMhz ?? Math.max(...f.rows.map((x) => x.mhz)) };
  const opened = readSavedCurve(start, limits);
  const cmp = readSavedCurve(compare, limits);
  return {
    facts: f,
    page: {
      source: CURVE_PATH.replace(/\\/g, '/'),
      stamp: f.stamp, touched: f.touched.length,
      maxMhz: limits.maxMhz,
      grid: f.grid, ladder: limits.ladder,
      stock: f.rows.map((x) => ({ mhz: x.mhz, mv: x.stockVoltageMv })),
      corners: cornersOf(effective),
      proven: [...f.proven].map(([mhz, p]) => ({ mhz, mv: p.voltageMv })),
      floors: [...f.floors].map(([mhz, p]) => ({ mhz, mv: p.voltageMv })),
      refutedFloors: [...refutedFloors.values()].map((c) => ({ mhz: c.mhz, mv: c.wallMv, higherMhz: c.higherMhz, passedMv: c.passedMv })),
      start: opened ? { path: opened.path, label: opened.label, refusal: opened.refusal, corners: opened.corners } : null,
      compare: cmp && !cmp.refusal ? { path: cmp.path, label: cmp.label, corners: cmp.corners } : null,
      anchors: opened && !opened.refusal ? opened.anchors : [],
    },
  };
}

function serve(port, open) {
  let idle = setTimeout(() => process.exit(0), IDLE_EXIT_MS);
  const server = createServer((req, res) => {
    clearTimeout(idle); idle = setTimeout(() => process.exit(0), IDLE_EXIT_MS);
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/') {
        send(200, 'text/html; charset=utf-8', pageHtml(snapshotData({ start: url.searchParams.get('start'), compare: url.searchParams.get('compare') }).page));
        return;
      }
      if (req.method === 'POST' && (req.url === '/preview' || req.url === '/save')) {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const { corners, startedFrom = null } = JSON.parse(body || '{}');
            const { facts, page } = snapshotData();
            const refusal = cornerRefusal(corners, { grid: page.grid, ladder: page.ladder, maxMhz: page.maxMhz });
            if (refusal) { send(200, 'application/json', JSON.stringify({ refusal })); return; }
            const rows = rowsFromCorners(corners, facts);
            const summary = summarize(rows, rowsFromCorners(page.corners, facts), page.ladder);
            if (req.url === '/preview') { send(200, 'application/json', JSON.stringify({ summary })); return; }
            const now = new Date();
            const off = -now.getTimezoneOffset();
            const local = new Date(now.getTime() + off * 60000).toISOString().slice(0, 19);
            const sign = off >= 0 ? '+' : '-';
            const takenAt = `${local}${sign}${String(Math.floor(Math.abs(off) / 60)).padStart(2, '0')}:${String(Math.abs(off) % 60).padStart(2, '0')}`;
            mkdirSync(EDITS_DIR, { recursive: true });
            const file = join(EDITS_DIR, `${local.replace(/:/g, '-')}.json`);
            const src = readFileSync(CURVE_PATH);
            writeFileSync(file, JSON.stringify({
              kind: 'owner-curve-edit', takenAt,
              startedFrom: typeof startedFrom === 'string' && /^curves\/(edits|proposals)\/[\w.+-]+\.json$/.test(startedFrom) ? startedFrom : null,
              basedOn: { path: CURVE_PATH.replace(/\\/g, '/'), sha256: createHash('sha256').update(src).digest('hex') },
              stamp: facts.stamp, corners, summary, frequencies: rows,
            }, null, 1) + '\n');
            console.log(`saved ${file} · changed ${summary.changed} · new at/below floor ${summary.hang.length} ranges · new unproven ${summary.unproven.length} ranges`);
            send(200, 'application/json', JSON.stringify({ file: file.replace(/\\/g, '/'), summary }));
          } catch (e) { send(200, 'application/json', JSON.stringify({ refusal: e.message })); }
        });
        return;
      }
      send(404, 'text/plain; charset=utf-8', 'нет такого');
    } catch (e) { send(500, 'text/plain; charset=utf-8', e.message); }
  });
  server.on('error', (e) => { console.error(`curve editor: порт ${port} не взят — ${e.code ?? e.message}`); process.exit(1); });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`curve editor: ${url}`);
    if (open) spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref();
  });
}

// -------------------------------------------------------------------------------------------------
// 4. Selftest — the real document, no card, nothing written
// -------------------------------------------------------------------------------------------------

export function selfTest() {
  const results = [];
  const check = (n, ok, why = '') => results.push({ n, ok: !!ok, why });
  const { facts, page } = snapshotData();
  const lim = { grid: page.grid, ladder: page.ladder, maxMhz: page.maxMhz };

  // A. Untouched corners round-trip: the derived rows draw the SAME effective line the document draws.
  const rows = rowsFromCorners(page.corners, facts);
  const redrawn = effectiveCurve(curveFacts({ doc: { ...facts, frequencies: rows.map((r) => ({ ...r, tags: ['origin:measured'] })), voltageGridMv: facts.grid } }));
  const same = JSON.stringify(redrawn) === JSON.stringify(effectiveCurve(facts));
  check('НЕТРОНУТЫЕ ТОЧКИ ДАЮТ ТУ ЖЕ ЛИНИЮ, ЧТО ЛОЖИТСЯ В КАРТУ', same, same ? '' : 'обратная функция расходится с effectiveCurve');
  check('НЕТРОНУТЫЕ ТОЧКИ ПРОХОДЯТ ПРОВЕРКУ', cornerRefusal(page.corners, lim) === null, cornerRefusal(page.corners, lim) ?? '');

  // A2. The defect of the first render: an untouched page reported 183 changes and 165 risks.
  const idle = summarize(rows, rows, page.ladder);
  check('НЕТРОНУТАЯ КРИВАЯ — НОЛЬ ПРАВОК И НОЛЬ НОВЫХ РИСКОВ', idle.changed === 0 && idle.hang.length === 0 && idle.unproven.length === 0,
    `изменено ${idle.changed} · пол ${idle.hang.length} · недоказано ${idle.unproven.length}`);
  // A3. Proof is inherited downward: a row below a pass at the same or lower voltage is not «unproven».
  // The row must have NO pass of its own — otherwise «exact frequency only» and «inherited» coincide on it.
  let pm, pp, below;
  for (const [m, p] of [...facts.proven].sort((x, y) => y[0] - x[0])) {
    below = facts.rows.find((r) => r.mhz < m && !facts.proven.has(r.mhz) && r.stockVoltageMv > p.voltageMv);
    if (below) { [pm, pp] = [m, p]; break; }
  }
  check('ФИКСТУРА НАСЛЕДОВАНИЯ НАЙДЕНА', Boolean(below));
  if (below) {
    const inh = rowsFromCorners([{ mv: pp.voltageMv, mhz: pm }], facts).find((r) => r.mhz === below.mhz);
    check('ДОКАЗАННОЕ НАСЛЕДУЕТСЯ ВНИЗ ПО ЧАСТОТЕ', inh && inh.deeperThanProven === false, `${below.mhz} МГц под прожигом ${pm} МГц / ${pp.voltageMv} мВ`);
  }
  // A4. A corner pulled left shows up as deeper.
  const k = page.corners.findIndex((x, i) => i > 0 && page.grid.some((v) => v > page.corners[i - 1].mv && v < x.mv));
  if (k > 0) {
    const pulled = page.corners.map((x) => ({ ...x }));
    pulled[k].mv = page.grid.filter((v) => v > page.corners[k - 1].mv && v < page.corners[k].mv)[0];
    const ps = summarize(rowsFromCorners(pulled, facts), rows, page.ladder);
    check('ТОЧКА, СДВИНУТАЯ ВЛЕВО, ДАЁТ «ГЛУБЖЕ»', ps.deeper > 0 && ps.shallower === 0, `глубже ${ps.deeper} · выше ${ps.shallower}`);
  }

  // A4b. A wall the physics lint refutes (bugs/124) is shown, but never flagged as a floor under the curve.
  const ref = page.refutedFloors[0];
  if (ref) {
    const deepRow = rowsFromCorners([{ mv: page.grid.find((v) => v >= 700), mhz: page.maxMhz }], facts).find((x) => x.mhz === ref.mhz);
    check('СТЕНА, ОПРОВЕРГНУТАЯ ФИЗИКОЙ, НЕ ПОМЕЧАЕТСЯ ПОЛОМ', deepRow && deepRow.voltageMv <= ref.mv && deepRow.atOrBelowHangFloor === false, `${ref.mhz} МГц / стена ${ref.mv} ← ${ref.higherMhz} прошла на ${ref.passedMv}`);
  }
  check('ОПРОВЕРГНУТЫЕ СТЕНЫ ВЫНУТЫ ИЗ ПОЛОВ', page.refutedFloors.length > 0 && page.refutedFloors.every((x) => !facts.floors.has(x.mhz)), `опровергнуто ${page.refutedFloors.length}`);

  // A5. A saved curve opens only from the two directories the tools write.
  const outside = ['curves/measured.json', 'curves/edits/../measured.json', 'profiles/optimised.json', 'C:/Windows/win.ini'].map((p) => readSavedCurve(p, lim));
  check('ОТКРЫВАЮТСЯ ТОЛЬКО curves/edits И curves/proposals', outside.every((o) => o && /только файлы/.test(o.refusal ?? '')), outside.map((o) => o?.refusal).join(' | '));

  // B. Refusals by name.
  const c = page.corners.map((x) => ({ ...x }));
  check('ОТКАЗ: НАПРЯЖЕНИЕ НЕ С СЕТКИ', /сетки/.test(cornerRefusal([{ ...c[0], mv: c[0].mv + 1 }, ...c.slice(1)], lim) ?? ''));
  check('ОТКАЗ: ВЫШЕ МАКСИМУМА КАРТЫ', /максимума|лестницы/.test(cornerRefusal([...c.slice(0, -1), { ...c.at(-1), mhz: page.maxMhz + 7 }], lim) ?? ''));
  const swapped = c.map((x) => ({ ...x })); [swapped[3].mhz, swapped[4].mhz] = [swapped[4].mhz, swapped[3].mhz];
  check('ОТКАЗ: ЧАСТОТЫ НЕ РАСТУТ', /частоты не растут/.test(cornerRefusal(swapped, lim) ?? ''));

  // C. Never above stock; a drawn voltage on a floor is flagged.
  check('НИ ОДНА СТРОКА НЕ ВЫШЕ СТОКА', rows.every((r) => r.voltageMv <= r.stockVoltageMv));
  const [fMhz, fl] = [...facts.floors][0] ?? [];
  if (fMhz !== undefined) {
    const deep = [{ mv: page.grid.find((v) => v >= 700), mhz: page.maxMhz }];
    const flagged = rowsFromCorners(deep, facts).find((r) => r.mhz === fMhz);
    check('ПОЛ ЗАВИСАНИЯ ПОМЕЧАЕТСЯ', flagged?.voltageMv <= fl.voltageMv && flagged?.atOrBelowHangFloor === true, `${fMhz} МГц`);
  }
  return results;
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log('node tools/curve-editor.mjs [--port 17387] [--open]  — редактор кривой V/F на 127.0.0.1; «Сохранить» пишет curves/edits/<момент>.json, карту не трогает\nnode tools/curve-editor.mjs --selftest                — проверки без карты');
    process.exit(0);
  }
  if (argv.includes('--selftest')) {
    const r = selfTest();
    for (const b of r) console.log(`${b.ok ? '🟢' : '🔴'} ${b.n}${b.why ? ' — ' + b.why : ''}`);
    const red = r.filter((b) => !b.ok).length;
    console.log(`\n${r.length - red}/${r.length} зелёных`);
    process.exit(red ? 1 : 0);
  } else {
    const i = argv.indexOf('--port');
    serve(i >= 0 ? Number(argv[i + 1]) : 17387, argv.includes('--open'));
  }
}
