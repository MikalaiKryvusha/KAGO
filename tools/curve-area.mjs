#!/usr/bin/env node
/**
 * curve-area.mjs — HOW MUCH AREA UNDER THE STOCK V/F CURVE OUR TUNING HAS WON. Read-only: a snapshot file in, numbers out.
 *
 * The owner, 2026-10-17 17:1x: «возьми интеграл от стоковой кривой, и он нашей. Сколько вы уже под ним площади выиграли нашими
 * тюнингами» · «запиши расчеты в документы проекта на будущее». The integral of «frequency → voltage» over the card's ladder
 * (trapezoids over the 389 rows of a battle snapshot, stock = each row's `stockVoltageMv`), for the whole curve and per band of
 * `MODE_BANDS`: stock area, ours, the difference in V·MHz and in %, and the mean undervolt (area ÷ width, mV).
 * Recorded results: MASTER_PLAN.md «Четыре режима» → Optimised.
 *
 *   node tools/curve-area.mjs curves/battle/<снимок>.json      площадь под кривой снимка против стока
 *   node tools/curve-area.mjs --help                            эта справка
 *
 * [TESTED: 2026-10-17 · run on curves/battle/2026-10-17T16-46-32.json — the whole curve and the sum of the seven bands printed
 *  and compared by the run itself (the line «сумма полос»); a read of a recorded file, no card]
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BANDS = [['ниже 2157', 180, 2157], ['2157–2500', 2157, 2500], ['2500–2700', 2500, 2700], ['2700–2800', 2700, 2800],
  ['2800–2900', 2800, 2900], ['2900–2950', 2900, 2950], ['выше 2950', 2950, 3090]];

/**
 * Trapezoid integral of `f(row)` (mV) over the rows sorted by frequency, in V·MHz. A trapezoid belongs to the band of its
 * MIDPOINT, [lo, hi) — so the bands partition the whole and their sum equals it exactly (the first edition dropped the
 * trapezoids straddling a band boundary: 120.6 of 125.9 V·MHz).
 */
export function areaOf(rows, f, lo = -Infinity, hi = Infinity) {
  let s = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]; const b = rows[i];
    const mid = (a.mhz + b.mhz) / 2;
    if (mid < lo || mid >= hi) continue;
    s += ((f(a) + f(b)) / 2) * (b.mhz - a.mhz);
  }
  return s / 1000;
}

/** The table: whole curve and per band — stock, ours, won (V·MHz and %), mean undervolt (mV). */
export function curveArea(rows) {
  const sorted = rows.filter((r) => Number.isFinite(r?.mhz) && Number.isFinite(r?.voltageMv) && Number.isFinite(r?.stockVoltageMv))
    .sort((a, b) => a.mhz - b.mhz);
  const line = (name, lo, hi) => {
    const stock = areaOf(sorted, (r) => r.stockVoltageMv, lo, hi); const ours = areaOf(sorted, (r) => r.voltageMv, lo, hi);
    // the width the band's trapezoids cover — the same partition as the area, so «mean mV» is area ÷ its own width
    const width = sorted.slice(1).reduce((s, b, i) => { const mid = (sorted[i].mhz + b.mhz) / 2; return mid >= lo && mid < hi ? s + (b.mhz - sorted[i].mhz) : s; }, 0);
    return { name, stock, ours, won: stock - ours, wonPct: stock ? ((stock - ours) / stock) * 100 : 0, meanMv: width ? ((stock - ours) * 1000) / width : 0 };
  };
  return { rows: sorted.length, whole: line('вся кривая', -Infinity, Infinity), bands: BANDS.map(([n, lo, hi]) => line(n, lo, hi)),
    maxDropMv: sorted.reduce((m, r) => Math.max(m, r.stockVoltageMv - r.voltageMv), 0) };
}

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log('node tools/curve-area.mjs curves/battle/<снимок>.json   площадь под кривой против стока (только чтение)');
    return argv.length === 0 ? 2 : 0;
  }
  const snap = JSON.parse(readFileSync(argv[0], 'utf8'));
  const r = curveArea(snap.frequencies ?? snap.rows ?? []);
  if (r.rows < 2) { console.error('ОШИБКА: в снимке нет строк с напряжением и стоком'); return 1; }
  const f = (x, d = 1) => x.toFixed(d).replace('.', ',');
  console.log(`ПЛОЩАДЬ ПОД КРИВОЙ ПРОТИВ СТОКА — ${argv[0]} · строк ${r.rows}`);
  for (const x of [r.whole, ...r.bands]) {
    console.log(`${x.name.padEnd(12)} сток ${f(x.stock, 0)} В·МГц · наша ${f(x.ours, 0)} · выиграно ${f(x.won)} В·МГц = ${f(x.wonPct, 2)} % · в среднем ${f(x.meanMv)} мВ`);
  }
  const sum = r.bands.reduce((s, x) => s + x.won, 0);
  console.log(`сумма полос ${f(sum, 2)} В·МГц против целого ${f(r.whole.won, 2)} — ${Math.abs(sum - r.whole.won) < 1e-6 ? 'сходится' : 'НЕ СХОДИТСЯ'}`);
  console.log(`наибольшее понижение ${r.maxDropMv} мВ`);
  return 0;
}

// СТОРОЖ ВХОДА — исполняется только как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
