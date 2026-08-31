#!/usr/bin/env node
// =================================================================================================
// ДЕРЖАЛАСЬ ЛИ ЧАСТОТА — и как это связано с РАЗМЕРОМ ПОДЪЁМА кривой
// =================================================================================================
//
// ЗАЧЕМ. Прямой заказ владельца после срыва 2026-08-31 (`bugs/86`, эстафета сессии 70, шаг 1):
// *«посчитать, как связаны РАЗМЕР ПОДЪЁМА кривой и разброс выданной частоты внутри прожига»*.
// Замер архивный, карта не нужна: пробы сэмплера каждого прожига лежат в `runs/vmin/`.
//
// 🔴 ПОЧЕМУ ЭТОТ ИНСТРУМЕНТ ЧИТАЕТ ПРОБЫ, А НЕ ЖУРНАЛ. Журнал развёртки на этот вопрос ответить
// НЕ МОЖЕТ, и это отдельный дефект (`bugs/87`): на ветке закрепления частоты поле максимума
// заполняется МЕДИАНОЙ (`vf-step.mjs`), поэтому у всех семи ступеней с держателем «закрепление
// частоты» разброс в журнале равен нулю — включая сорвавшуюся, у которой прибор в ту же секунду
// напечатал размах 158 МГц. Минимум журнал не хранит вовсе. Пробы сэмплера — единственный
// сохранившийся источник правды об этом, и они `fsync`-нуты (`bugs/37`).
//
// 🪜 ЧТО ИМЕННО МЕРИТСЯ, И ПОЧЕМУ НЕ «РАЗМАХ». Первая редакция этого замера считала размах
// max − min по нагруженным пробам — ту же величину, что считает сторож (`ladder-descent.mjs` →
// `verifyLockUnderLoad`). Она НЕПРИГОДНА для сравнения прожигов между собой: первая нагруженная
// проба часто ловит карту НА РАЗГОНЕ (замерено: `cap-3067-225` — util 52 % при 442 МГц, следующая
// проба уже 3052 и дальше намертво). Размах тогда меряет разгон, а не гуляние, и растёт вместе с
// целевой частотой — то есть с тем, с чем его собирались сравнивать.
//
// ПОЭТОМУ ВЕДУЩАЯ ВЕЛИЧИНА — ПРЕВЫШЕНИЕ: `max под нагрузкой − ЗАКАЗАННАЯ частота`. Разгон снизу
// максимум испортить не может, и это ровно симптом `bugs/86`: заказали 2145, карта работала на 2835.
// Размах печатается рядом ВТОРЫМ числом, с явной пометкой про разгон, — потому что именно по нему
// судит сторож, и его завышение разгоном это отдельный названный риск.
//
// GPU WRITES: НЕТ. Инструмент только читает файлы проб. Карта может быть занята.
//
// Запуск:
//   node tools/hold-vs-raise.mjs              полный отчёт по архиву
//   node tools/hold-vs-raise.mjs --selftest   собственный сторож на фикстурах + контроль по архиву
// Выход: 0 — отчёт построен (или все блоки самопроверки зелёные) · 1 — отказ / есть красные блоки
//
// [TESTED: 2026-08-31 · `--selftest`, 12 блоков, красных 0. Ключевой из них — КОНТРОЛЬ ПО АРХИВУ:
//  инструмент обязан выдать на `pin-2145-555` ровно те три числа, что прибор напечатал в
//  `runs/sweep-session70.log:51` (мин 2677, макс 2835, размах 158). Голден взят из ЧУЖОГО вывода,
//  не из моего, поэтому совпадение — это проверка, а не тавтология. Доказан мутациями A/B/C:
//  сдвиг порога нагрузки, отбрасывание первой нагруженной пробы и подмена максимума медианой —
//  каждая красит контроль и только его]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import config from '../automation-engine/config.mjs';

// Порог нагрузки и допуск — НЕ свои числа. Это те же константы, которыми судит движок; вторая их
// копия здесь была бы парой «истина ↔ зеркало» на ровном месте (R16c, DRY).
const LOAD_PCT = config.LOAD_PHASE_UTILIZATION_PCT;   // 50 — «проба снята под нагрузкой»
const TOLERANCE = config.LOCK_DELIVERY_TOLERANCE_MHZ; // 8  — собственный шаг сетки карты

const VMIN_DIR = join('runs', 'vmin');

// =================================================================================================
// 1. Чистые функции — вся арифметика здесь, чтобы её можно было проверить без файлов
// =================================================================================================

/**
 * Разобрать имя файла проб: `pin-2145-555.jsonl` → держатель, заказанная частота, подъём.
 *
 * Имя строит сам движок (`vf-step.mjs` → `startSampler`): `pin-<pinMhz>-<offsetMhz>` когда частоту
 * держит ЗАКРЕПЛЕНИЕ, `cap-<capMhz>-<offsetMhz>` когда её держит ПОТОЛОК КРИВОЙ. Третий компонент
 * — подъём кривой, то самое, чью связь с гулянием заказал владелец.
 */
export function parseBurnName(fileName) {
  const m = /^(pin|cap)-(\d+)-(-?\d+)\.jsonl$/.exec(fileName);
  if (!m) return null;
  return { holder: m[1], orderedMhz: Number(m[2]), raiseMhz: Number(m[3]) };
}

/**
 * Свести пробы одного прожига к трём числам о частоте ПОД НАГРУЗКОЙ.
 *
 * `null` вместо чисел, когда нагруженных проб нет вовсе — это ОТКАЗ, а не ноль. Прожиг, который не
 * занял карту, ничего не говорит о держателе, и молчаливый ноль в сводке сделал бы его похожим на
 * идеально удержанный (та же семья, что `bugs/84`: поле есть, наполнения нет).
 */
export function summarizeBurn(samples, orderedMhz) {
  const clocks = [];
  let firstLoaded = null;
  for (const s of samples) {
    const util = Number(s?.['utilization.gpu']);
    const clk = Number(s?.['clocks.gr']);
    if (!Number.isFinite(util) || !Number.isFinite(clk)) continue;
    if (util < LOAD_PCT) continue;
    if (firstLoaded === null) firstLoaded = clk;
    clocks.push(clk);
  }
  if (!clocks.length) return { loaded: 0, min: null, median: null, max: null, overshootMhz: null, spreadMhz: null, rampSuspect: false };
  const sorted = [...clocks].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  return {
    loaded: clocks.length,
    min, median, max,
    // ВЕДУЩАЯ ВЕЛИЧИНА: насколько карта ушла ВЫШЕ заказа. Разгон снизу её не подделывает.
    overshootMhz: max - orderedMhz,
    // ВТОРАЯ величина: то, что считает сторож. Печатается ради него и ради флага ниже.
    spreadMhz: max - min,
    // Признак того, что размах ВЫЗВАН РАЗГОНОМ, а не гулянием: первая нагруженная проба лежит
    // ниже медианы больше чем на допуск, то есть сторож судит окно, куда попал подъём частоты.
    rampSuspect: firstLoaded !== null && median - firstLoaded > TOLERANCE,
  };
}

/** Прочитать файл проб сэмплера: строки JSONL, шапка `i < 0` отбрасывается. */
export function readBurnSamples(path) {
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let d;
    try { d = JSON.parse(t); } catch { continue; }
    if (!Number.isFinite(d?.i) || d.i < 0) continue; // шапка с метаданными
    out.push(d.sample ?? d);
  }
  return out;
}

/** Собрать весь архив прожигов: каждый файл проб + разобранное имя + сводка. */
export function collectArchive(dir = VMIN_DIR) {
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const fn of readdirSync(dir).sort()) {
    const name = parseBurnName(fn);
    if (!name) continue; // не файл прожига (в каталоге лежит и `records.jsonl`)
    const sum = summarizeBurn(readBurnSamples(join(dir, fn)), name.orderedMhz);
    rows.push({ file: fn, ...name, ...sum });
  }
  return rows;
}

// Корзины по размеру подъёма. Границы круглые НАМЕРЕННО: это разрезка для ГЛАЗА, а не порог,
// на котором что-то решается. Порога по подъёму никто не мерил, и выдумывать его здесь запрещено
// (`PHILOSOPHY.md` → три двери).
const BUCKETS = [[0, 100], [100, 200], [200, 300], [300, 400], [400, 500], [500, 600], [600, 700], [700, 800], [800, Infinity]];

// =================================================================================================
// 2. Отчёт
// =================================================================================================

function report() {
  const all = collectArchive();
  if (!all.length) { console.error(`ОСТАНОВ: в ${VMIN_DIR} нет ни одного файла проб прожига`); return 1; }
  const ok = all.filter((r) => r.loaded > 0);
  const mute = all.filter((r) => r.loaded === 0);

  console.log('ДЕРЖАЛАСЬ ЛИ ЧАСТОТА — архив прожигов, замер без карты');
  console.log(`  прожигов на диске: ${all.length}  ·  с нагруженными пробами: ${ok.length}  ·  БЕЗ них (не судимы): ${mute.length}`);
  console.log(`  держатель: закрепление ${ok.filter((r) => r.holder === 'pin').length}  ·  потолок кривой ${ok.filter((r) => r.holder === 'cap').length}`);
  console.log(`  пороги взяты у движка: нагрузка ≥ ${LOAD_PCT} %, допуск ${TOLERANCE} МГц (собственный шаг сетки карты)`);
  console.log();

  console.log('ПРЕВЫШЕНИЕ НАД ЗАКАЗАННОЙ ЧАСТОТОЙ по размеру подъёма (разгон максимум не подделывает)');
  console.log(`  ${'подъём МГц'.padEnd(12)}${'прожигов'.padStart(9)}${'в допуске'.padStart(11)}${'ВЫШЕ'.padStart(6)}${'макс.превыш'.padStart(13)}`);
  for (const [lo, hi] of BUCKETS) {
    const b = ok.filter((r) => r.raiseMhz >= lo && r.raiseMhz < hi);
    if (!b.length) continue;
    const over = b.filter((r) => r.overshootMhz > TOLERANCE);
    const label = hi === Infinity ? `${lo}+` : `${lo}-${hi - 1}`;
    console.log(`  ${label.padEnd(12)}${String(b.length).padStart(9)}${String(b.length - over.length).padStart(11)}${String(over.length).padStart(6)}${String(Math.max(...b.map((r) => r.overshootMhz))).padStart(13)}`);
  }
  console.log();

  const over = ok.filter((r) => r.overshootMhz > TOLERANCE).sort((a, b) => b.overshootMhz - a.overshootMhz);
  console.log(`ПРОЖИГИ, ГДЕ КАРТА РАБОТАЛА ВЫШЕ ЗАКАЗА БОЛЬШЕ ЧЕМ НА ШАГ СЕТКИ — ${over.length} из ${ok.length}`);
  console.log(`  ${'файл'.padEnd(22)}${'заказ'.padStart(7)}${'подъём'.padStart(8)}${'макс'.padStart(7)}${'превыш'.padStart(8)}${'превыш−подъём'.padStart(15)}`);
  for (const r of over) {
    console.log(`  ${r.file.padEnd(22)}${String(r.orderedMhz).padStart(7)}${String(r.raiseMhz).padStart(8)}${String(r.max).padStart(7)}${String(r.overshootMhz).padStart(8)}${String(r.overshootMhz - r.raiseMhz).padStart(15)}`);
  }
  console.log();

  // РАЗМАХ И РАЗГОН — вторым разделом, потому что по размаху судит сторож, а разгон его завышает.
  const ramp = ok.filter((r) => r.rampSuspect);
  console.log('РАЗМАХ (по нему судит сторож закрепления) И СКОЛЬКО В НЁМ РАЗГОНА');
  console.log(`  прожигов, где первая нагруженная проба ниже медианы больше чем на допуск: ${ramp.length} из ${ok.length}`);
  console.log(`  из них с держателем «закрепление» (только там размах и решает): ${ramp.filter((r) => r.holder === 'pin').length}`);
  console.log('  → на ветке потолка размах не судит, поэтому разгон там безвреден; на ветке закрепления');
  console.log('    он способен объявить здоровую ступень «не фиксацией». Наблюдения такого пока НЕТ.');
  console.log();

  console.log('ВСЕ ПРОЖИГИ С ДЕРЖАТЕЛЕМ «ЗАКРЕПЛЕНИЕ ЧАСТОТЫ» — весь опыт проекта по этому держателю');
  console.log(`  ${'файл'.padEnd(22)}${'заказ'.padStart(7)}${'подъём'.padStart(8)}${'проб'.padStart(6)}${'мин'.padStart(7)}${'макс'.padStart(7)}${'превыш'.padStart(8)}`);
  for (const r of ok.filter((x) => x.holder === 'pin').sort((a, b) => a.raiseMhz - b.raiseMhz)) {
    console.log(`  ${r.file.padEnd(22)}${String(r.orderedMhz).padStart(7)}${String(r.raiseMhz).padStart(8)}${String(r.loaded).padStart(6)}${String(r.min).padStart(7)}${String(r.max).padStart(7)}${String(r.overshootMhz).padStart(8)}`);
  }
  console.log();
  console.log('⚠️  ГРАНИЦА ЭТОГО ЗАМЕРА, названная заранее: файл проб перезаписывается при повторе той же');
  console.log('    тройки «держатель · частота · подъём», поэтому архив хранит ПОСЛЕДНИЙ такой прожиг,');
  console.log('    а не все. Для вопроса «бывало ли превышение» это неважно, для счёта частот — важно.');
  return 0;
}

// =================================================================================================
// 3. Собственный сторож
// =================================================================================================

function selftest() {
  let red = 0;
  let blocks = 0;
  const ok = (name, got, want) => {
    blocks += 1;
    const pass = JSON.stringify(got) === JSON.stringify(want);
    if (!pass) red += 1;
    console.log(`  ${pass ? '✅' : '❌'} ${name}${pass ? '' : `  — получено ${JSON.stringify(got)}, ожидалось ${JSON.stringify(want)}`}`);
  };
  console.log('САМОПРОВЕРКА hold-vs-raise');

  // ─── имя файла ────────────────────────────────────────────────────────────────────────────────
  ok('имя `pin-2145-555` разбирается в держатель + заказ + подъём',
    parseBurnName('pin-2145-555.jsonl'), { holder: 'pin', orderedMhz: 2145, raiseMhz: 555 });
  ok('имя `cap-2842-45` даёт держатель «потолок»',
    parseBurnName('cap-2842-45.jsonl'), { holder: 'cap', orderedMhz: 2842, raiseMhz: 45 });
  ok('посторонний файл каталога именем не притворяется', parseBurnName('records.jsonl'), null);

  // ─── арифметика сводки ────────────────────────────────────────────────────────────────────────
  const held = [
    { 'utilization.gpu': 0, 'clocks.gr': 500 },      // покой — не в счёт
    { 'utilization.gpu': 99, 'clocks.gr': 2137 },
    { 'utilization.gpu': 99, 'clocks.gr': 2137 },
    { 'utilization.gpu': 99, 'clocks.gr': 2137 },
  ];
  const h = summarizeBurn(held, 2145);
  ok('удержанная ступень: превышение отрицательное, размаха нет',
    [h.loaded, h.min, h.max, h.overshootMhz, h.spreadMhz, h.rampSuspect], [3, 2137, 2137, -8, 0, false]);

  // РАЗГОН: первая нагруженная проба низкая, остальные ровные. Размах ЛОЖНО велик, превышение — нет.
  const ramp = [
    { 'utilization.gpu': 52, 'clocks.gr': 442 },
    { 'utilization.gpu': 52, 'clocks.gr': 3052 },
    { 'utilization.gpu': 52, 'clocks.gr': 3052 },
  ];
  const rr = summarizeBurn(ramp, 3067);
  ok('разгон раздувает РАЗМАХ до 2610 …', rr.spreadMhz, 2610);
  ok('… но ПРЕВЫШЕНИЕ остаётся честным (карта заказ не превысила)', rr.overshootMhz, -15);
  ok('… и разгон помечен признаком, а не спрятан', rr.rampSuspect, true);

  // СРЫВ: карта ушла выше заказа — превышение обязано это показать.
  const slip = [
    { 'utilization.gpu': 100, 'clocks.gr': 2677 },
    { 'utilization.gpu': 99, 'clocks.gr': 2835 },
    { 'utilization.gpu': 99, 'clocks.gr': 2827 },
  ];
  ok('срыв: превышение над заказом положительное и крупное', summarizeBurn(slip, 2145).overshootMhz, 690);

  // ОТКАЗ, а не ноль: прожиг, не занявший карту, не судится.
  const idle = summarizeBurn([{ 'utilization.gpu': 3, 'clocks.gr': 2500 }], 2145);
  ok('прожиг без нагруженных проб ОТКАЗЫВАЕТСЯ судиться, а не выдаёт ноль',
    [idle.loaded, idle.max, idle.overshootMhz], [0, null, null]);
  ok('проба с нечитаемой частотой не попадает в счёт',
    summarizeBurn([{ 'utilization.gpu': 99, 'clocks.gr': 'н/д' }], 2145).loaded, 0);

  // ─── КОНТРОЛЬ ПО АРХИВУ, и он тут главный ─────────────────────────────────────────────────────
  //
  // Голден взят из ЧУЖОГО вывода: строка 51 `runs/sweep-session70.log`, напечатанная сторожем
  // движка в 08:12 — «частота под нагрузкой ГУЛЯЛА 2677…2835 МГц (размах 158 > 8)». Если этот
  // инструмент читает те же пробы правильно, он обязан выдать те же три числа. Совпадение с чужим
  // выводом — проверка; совпадение с собственным было бы тавтологией.
  const CONTROL = join(VMIN_DIR, 'pin-2145-555.jsonl');
  if (existsSync(CONTROL)) {
    const c = summarizeBurn(readBurnSamples(CONTROL), 2145);
    ok('КОНТРОЛЬ: на пробах сорвавшейся ступени выходят числа, напечатанные самим прибором',
      [c.min, c.max, c.spreadMhz], [2677, 2835, 158]);
    ok('КОНТРОЛЬ: и превышение над заказом — те же 690 МГц, что в `bugs/86`', c.overshootMhz, 690);
  } else {
    red += 1; blocks += 1;
    console.log(`  ❌ КОНТРОЛЬ НЕВОЗМОЖЕН: нет ${CONTROL} — голден проверять не на чем`);
  }

  console.log(`САМОПРОВЕРКА ЗАВЕРШЕНА: блоков ${blocks}, красных ${red}`);
  return red ? 1 : 0;
}

const argv = process.argv.slice(2);
process.exit(argv.includes('--selftest') ? selftest() : report());
