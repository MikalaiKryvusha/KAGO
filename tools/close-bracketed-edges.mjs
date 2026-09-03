// =================================================================================================
// ОДНОРАЗОВЫЙ: закрыть частоты, чей край УЖЕ зажат с обеих сторон журналом — без единого прожига
// =================================================================================================
//
// ЗАЧЕМ. Журнал хранит обе скобки края: сверху — зависание (`hangFloors`), снизу — самая глубокая
// прошедшая ступень (`provenRungs`, `bugs/31`). Когда они стоят на СОСЕДНИХ ступенях сетки, край
// найден с разрешением минимального шага, и по правилу владельца точке остаётся только запас.
// Жечь при этом нечего: оба факта уже оплачены — один прожигом, другой перезагрузкой машины.
//
// Развёртка этого не умеет, потому что читала только половину журнала. Пока она не сшита с новой
// половиной, знание довозится этим скриптом — иначе оно лежит в улике и не доезжает до карты.
//
// ЧЕГО СКРИПТ НЕ ДЕЛАЕТ: не трогает карту (документ — файл), не выдумывает напряжений (берёт их из
// журнала), не закрывает частоту с ГРУБОЙ скобкой. Грубая скобка требует уточнения минимальным
// шагом — правило владельца, `GOAL.md` → «ЛЕСТНИЦА ШАГОВ СПУСКА» п. 3.
//
// Запуск: `node tools/close-bracketed-edges.mjs [--apply]`. Без `--apply` — только показать.

import { openJournal, readJournal, provenRungs, hangFloors } from '../automation-engine/lib/sweep-journal.mjs';
import { loadCurveDoc, saveCurveDoc, closePoint } from '../automation-engine/lib/curve-store.mjs';
import { marginAboveLastStableMv } from '../automation-engine/config.mjs';
import { resolve as entryResolve } from 'node:path';
import { fileURLToPath as entryPath } from 'node:url';

/**
 * ВСЯ РАБОТА ПРИБОРА — здесь, и зовётся она ТОЛЬКО при прямом запуске (`bugs/95`, сессия 78).
 * До починки тело стояло на верхнем уровне модуля и исполнялось при ИМПОРТЕ с argv вызывающего.
 * Тело намеренно НЕ сдвинуто по отступу: в приборах этого класса есть многострочные шаблоны,
 * и сдвиг изменил бы порождаемые артефакты; голден байт-в-байт дороже отступа.
 * @param {string[]} argv аргументы БЕЗ `node` и пути к файлу
 */
async function main(argv) {

const APPLY = argv.includes('--apply');
// ⚠️ ШТАМП — ЛОКАЛЬНЫЙ ISO, а не UTC: формат строки документа требует смещения (`LOCAL_ISO`),
// и канон велит брать момент у системы, а не из головы (EXP-0019).
const stamp = argv.find((a) => a.startsWith('--at='))?.slice(5) ?? null;
if (!stamp) { console.error('ОСТАНОВ: передай момент локальным ISO: --at=YYYY-MM-DDTHH:MM:SS+03:00'); process.exit(1); }

const { records } = readJournal(openJournal());
const proven = provenRungs(records);
const floors = hangFloors(records);

let doc = loadCurveDoc();
if (!doc) { console.error('ОСТАНОВ: документ кривой не найден'); process.exit(1); }
const grid = Array.isArray(doc.voltageGridMv) ? [...doc.voltageGridMv].sort((a, b) => a - b) : [];
if (!grid.length) { console.error('ОСТАНОВ: в документе нет сетки напряжений'); process.exit(1); }

const margin = marginAboveLastStableMv();

console.log('ЧАСТОТЫ, ЧЕЙ КРАЙ ЗАЖАТ ЖУРНАЛОМ С ОБЕИХ СТОРОН');
console.log(`запас владельца: ${margin.millivolts} мВ (${margin.steps} шаг сетки) над ПОСЛЕДНЕЙ СТАБИЛЬНОЙ\n`);

const plan = [];
for (const [mhz, pass] of [...proven].sort((a, b) => b[0] - a[0])) {
  const floor = floors.get(mhz);
  if (!floor) continue;
  if (!(floor.voltageMv < pass.voltageMv)) continue;      // стена обязана быть НИЖЕ доказанного

  // РАЗРЕШЕНИЕ СКОБКИ. Край найден минимальным шагом только если между стеной и прошедшей ступенью
  // на сетке карты НЕТ непроверенных ступеней. Иначе это грубая скобка.
  const between = grid.filter((v) => v > floor.voltageMv && v < pass.voltageMv);
  const wanted = pass.voltageMv + margin.millivolts;
  const shipMv = grid.filter((v) => v >= wanted)[0] ?? null;
  const row = doc.frequencies.find((r) => r.mhz === mhz);
  const stockMv = row?.stockVoltageMv ?? row?.voltageMv ?? null;

  const verdict = between.length
    ? `ГРУБАЯ СКОБКА — не закрываю: между ${floor.voltageMv} и ${pass.voltageMv} мВ не испытаны ${between.join(', ')} мВ`
    : (shipMv === null ? 'ОТКАЗ: запас выходит за сетку карты' : `закрыть на ${shipMv} мВ`);

  console.log(`${String(mhz).padStart(4)} МГц | прошло ${pass.voltageMv} мВ (seq ${pass.seq}) | `
    + `повесило ${floor.voltageMv} мВ (seq ${floor.seq}) | сток ${stockMv ?? '?'} мВ → ${verdict}`);

  if (!between.length && shipMv !== null) {
    plan.push({ mhz, shipMv, pass, floor, stockMv, savedMv: stockMv !== null ? stockMv - shipMv : null });
  }
}

if (!plan.length) { console.log('\nЗакрывать нечего.'); process.exit(0); }

console.log(`\nК ЗАКРЫТИЮ: ${plan.length} частот(ы)`);
for (const p of plan) {
  console.log(`  ${p.mhz} МГц → ${p.shipMv} мВ${p.savedMv !== null ? ` (снято ${p.savedMv} мВ от стока)` : ''}`);
}

if (!APPLY) { console.log('\nПОКАЗ, а не запись. Записать: --apply'); process.exit(0); }

let closed = 0;
for (const p of plan) {
  const provenBy = `край зажат журналом: ПРОШЛО ${p.pass.voltageMv} мВ (seq ${p.pass.seq}), ЗАВИСАНИЕ `
    + `${p.floor.voltageMv} мВ (seq ${p.floor.seq}); ступеней между ними на сетке карты нет, то есть край найден `
    + `минимальным шагом. Отгрузка = последняя стабильная + ${margin.millivolts} мВ, округление вверх по сетке. `
    + 'Прожиг для этой строки не проводился: оба факта уже оплачены — один прожигом, другой перезагрузкой машины.';
  const res = closePoint(doc, { mhz: p.mhz, voltageMv: p.shipMv, status: 'edge-found', provenBy, at: stamp });
  if (!res.ok) { console.error(`ОТКАЗ на ${p.mhz} МГц: ${res.why}`); process.exit(1); }
  doc = res.doc;
  closed += res.closed;
  if (res.raised?.length) console.log(`  храповик поднял ради монотонности: ${res.raised.map((r) => `${r.mhz} МГц→${r.voltageMv} мВ`).join(', ')}`);
}

const saved = saveCurveDoc(doc);
if (saved && saved.ok === false) { console.error(`ОСТАНОВ: документ не сохранён — ${saved.why ?? ''}`); process.exit(1); }
console.log(`\nЗАПИСАНО: строк закрыто ${closed}. Документ сохранён атомарно.`);
return 0;
}

// СТОРОЖ ВХОДА — прибор исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && entryResolve(process.argv[1]) === entryResolve(entryPath(import.meta.url))) process.exit(await main(process.argv.slice(2)));
