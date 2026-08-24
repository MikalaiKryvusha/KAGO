#!/usr/bin/env node
// tools/harvest-acceptance.mjs — ПРИЁМКА ЭПИКА 41 ОДНОЙ КОМАНДОЙ: что живой прогон изменил в документе.
//
// `plans/41` фаза 5 требует замер «до/после по числу строк». Замер, который надо собирать руками из
// трёх команд, — замер, которого не будет: он и существует ровно потому, что «сравнить два числа»
// это единственная проверка, которую сессия выполняет безупречно (`TESTING_FRAMEWORK.md`, ворота 3).
//
// GPU WRITES: none. Читает два JSON и печатает разницу.
//
// Usage:
//   node tools/harvest-acceptance.mjs <снимок-до.json> [документ-после.json]

import { readFileSync } from 'node:fs';
import { claimsBurnProof, validateCurveDoc } from '../automation-engine/lib/curve-store.mjs';

const [beforePath, afterPath = 'curves/measured.json'] = process.argv.slice(2);
if (!beforePath) {
  console.error('нужен путь к снимку ДО: node tools/harvest-acceptance.mjs runs/measured.before-X.json');
  process.exit(2);
}
const before = JSON.parse(readFileSync(beforePath, 'utf8'));
const after = JSON.parse(readFileSync(afterPath, 'utf8'));

const byMhz = (doc) => new Map(doc.frequencies.map((r) => [r.mhz, r]));
const B = byMhz(before);
const A = byMhz(after);
const tuned = (r) => Array.isArray(r?.tags) && !r.tags.includes('stop:untouched');
const count = (doc, f) => doc.frequencies.filter(f).length;

const deeper = [];
const raised = [];
const fresh = [];
for (const [mhz, a] of A) {
  const b = B.get(mhz);
  if (!b) continue;
  if (!tuned(b) && tuned(a)) fresh.push(mhz);
  if (!Number.isFinite(a.voltageMv) || !Number.isFinite(b.voltageMv)) continue;
  if (a.voltageMv < b.voltageMv) deeper.push({ mhz, from: b.voltageMv, to: a.voltageMv });
  if (a.voltageMv > b.voltageMv) raised.push({ mhz, from: b.voltageMv, to: a.voltageMv });
}
const harvestRows = after.frequencies.filter((r) => typeof r.provenBy === 'string' && r.provenBy.startsWith('УРОЖАЙ:'));

const row = (k, b, a) => `  ${k.padEnd(34)} ${String(b).padStart(6)} → ${String(a).padStart(6)}`
  + (a !== b ? `   (${a > b ? '+' : ''}${a - b})` : '');

console.log('ПРИЁМКА УРОЖАЯ — документ ДО против ПОСЛЕ');
console.log(`  снимок ДО: ${beforePath}`);
console.log(`  документ : ${afterPath}`);
console.log('');
console.log(row('частот всего', before.frequencies.length, after.frequencies.length));
console.log(row('оттюнено (не сток)', count(before, tuned), count(after, tuned)));
console.log(row('СО СВОЕЙ УЛИКОЙ (прожиг)', count(before, claimsBurnProof), count(after, claimsBurnProof)));
console.log(row('инверсий в документе', validateCurveDoc(before).length, validateCurveDoc(after).length));
console.log('');
console.log(`  строк УГЛУБИЛОСЬ : ${deeper.length}${deeper.length ? ' — ' + deeper.slice(0, 8).map((d) => `${d.mhz}:${d.from}→${d.to}`).join(', ') + (deeper.length > 8 ? ' …' : '') : ''}`);
console.log(`  строк ПОДНЯТО    : ${raised.length}${raised.length ? ' — ' + raised.slice(0, 8).map((d) => `${d.mhz}:${d.from}→${d.to}`).join(', ') + (raised.length > 8 ? ' …' : '') : ''}`);
console.log(`  впервые тронуто  : ${fresh.length}${fresh.length ? ' — ' + fresh.slice(0, 10).join(', ') + (fresh.length > 10 ? ' …' : '') : ''}`);
console.log(`  строк УРОЖАЯ     : ${harvestRows.length}${harvestRows.length ? ' — ' + harvestRows.slice(0, 8).map((r) => `${r.mhz}:${r.voltageMv}мВ`).join(', ') : ''}`);
console.log('');
console.log(validateCurveDoc(after).length === 0
  ? '  ВАЛИДАТОР ПОСЛЕ ПРОГОНА: ЧИСТО'
  : `  🔴 ВАЛИДАТОР ПОСЛЕ ПРОГОНА: ${validateCurveDoc(after).length} отказ(ов)`);
