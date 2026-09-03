// =================================================================================================
// КАРТА КРИВОЙ — одна картинка, отвечающая на три вопроса владельца сразу
// =================================================================================================
//
// Слово владельца 2026-08-31, дословно: *«у нас пока не хватает в визуализаторе графика - поэтому
// мне нераглядно, что мы уже протюнили, где сток, где край. Я не могу тебе подсказать, что
// тюнить.»*
//
// Три вопроса — три слоя на одном поле «частота × напряжение»:
//   ГДЕ СТОК        — заводская кривая, серым. Точка отсчёта всего остального;
//   ЧТО ПРОТЮНИЛИ   — рабочая кривая из документа, зелёным. Где её нет — там не тронуто;
//   ГДЕ КРАЙ        — записанные зависания из журнала, красным. Ниже них спуск не ходит (R18).
//
// И ЧЕТВЁРТЫЙ СЛОЙ, КОТОРОГО ОН НЕ ПРОСИЛ, НО КОТОРЫЙ ОТВЕЧАЕТ НА ЕГО ВОПРОС «А МОЖНО ЛИ ГЛУБЖЕ»:
//   ЧТО РЕАЛЬНО ДЕРЖАЛО ПРОЖИГ — самое глубокое ПРОШЕДШЕЕ напряжение каждой частоты, синим.
//   Там, где синяя точка НИЖЕ красной, пол зависания стоит выше доказанного — видно глазом, а не
//   вычитается из двух таблиц (`bugs/85`, `ideas/16`).
//
// ПОЧЕМУ ГЕНЕРАТОР, А НЕ НАРИСОВАННЫЙ ФАЙЛ: вторая копия правды — пара «правда ↔ зеркало», за
// которую этот проект уже платил (R16c, EXP-0077). Картинка строится из документа кривой и журнала
// при каждом запуске; руками её не правят.
//
// GPU WRITES: НЕТ. Читает два файла, пишет один HTML.
//
// Запуск: node tools/build-curve-map.mjs  →  assets/curve-map.html
//
// [NOT-TESTED]

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
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

const CURVE = join('curves', 'measured.json');
const JOURNAL = join('runs', 'sweep', 'journal.jsonl');
const OUT = join('assets', 'curve-map.html');

const must = (cond, why) => { if (!cond) { console.error(`ОСТАНОВ: ${why}`); process.exit(1); } };

// =================================================================================================
// 1. Данные — из документа и журнала, без единого числа из головы
// =================================================================================================

must(existsSync(CURVE), `нет документа кривой ${CURVE}`);
const doc = JSON.parse(readFileSync(CURVE, 'utf8'));
const rows = (doc.frequencies ?? []).slice().sort((a, b) => a.mhz - b.mhz);
must(rows.length > 0, 'документ кривой пуст');

/** Пары «намерение → вердикт» журнала: что заказывали и чем кончилось. Журнала может не быть. */
function journalFacts() {
  const proven = new Map();   // МГц → самое глубокое ПРОШЕДШЕЕ (выданное) напряжение
  // МГц → самое ВЫСОКОЕ зарегистрированное зависание. Это и есть ПОЛ ЗАВИСАНИЯ (R18): напряжение,
  // ниже которого спуск на этой частоте не возвращается.
  //
  // 🔤 ИМЯ ИСПРАВЛЕНО 2026-08-31 ПО СЛОВУ ВЛАДЕЛЬЦА: *«"Стены" — не понимаю этого термина, он не
  // академический»*. Здесь стояла «стена» — моя метафора, и хуже того ВТОРОЕ имя для вещи, у которой
  // уже есть своё: движок печатает «ПОЛ ЗАВИСАНИЯ» в каждой сводке прогона. Одно понятие — одно
  // слово (DRY применительно к языку); пара имён у одной вещи разъезжается так же, как пара чисел.
  const hung = new Map();
  if (!existsSync(JOURNAL)) return { proven, hung, lines: 0 };
  const lines = readFileSync(JOURNAL, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const intents = new Map();
  const recs = [];
  for (const l of lines) { try { recs.push(JSON.parse(l)); } catch { /* строка мусора — не улика */ } }
  for (const r of recs) if (r?.state === 'intent') intents.set(r.seq, r);
  for (const r of recs) {
    if (r?.state !== 'verdict') continue;
    const i = intents.get(r.seq);
    if (!i || !Number.isFinite(i.frequencyMhz)) continue;
    // ВЫДАННОЕ, а не заказанное: карта регулярно обслуживает заказ соседней ступенью, и в документ
    // идёт то, что она ОТДАЛА (слово владельца, `GOAL.md` → «ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ»).
    const served = Number.isFinite(r.servingMvAfter) ? r.servingMvAfter : i.voltageMv;
    if (r.outcome === 'passed' && Number.isFinite(served)) {
      const seen = proven.get(i.frequencyMhz);
      if (seen === undefined || served < seen) proven.set(i.frequencyMhz, served);
    }
    if (r.outcome === 'hung' && Number.isFinite(i.voltageMv)) {
      const seen = hung.get(i.frequencyMhz);
      if (seen === undefined || i.voltageMv > seen) hung.set(i.frequencyMhz, i.voltageMv);
    }
  }
  return { proven, hung, lines: lines.length };
}

const { proven, hung, lines: journalLines } = journalFacts();

const isUntouched = (r) => (r.tags ?? []).includes('stop:untouched');
const touched = rows.filter((r) => !isUntouched(r));

// =================================================================================================
// 2. Геометрия — чистая арифметика, чтобы её можно было проверить глазом
// =================================================================================================

const W = 1360, H = 620;
const PAD = { l: 74, r: 26, t: 28, b: 54 };
const plotW = W - PAD.l - PAD.r;
const plotH = H - PAD.t - PAD.b;

const mhzAll = rows.map((r) => r.mhz);
const mvAll = [
  ...rows.map((r) => r.stockVoltageMv), ...rows.map((r) => r.voltageMv),
  ...proven.values(), ...hung.values(),
].filter(Number.isFinite);

// ⚡ НАПРЯЖЕНИЕ ПО X, ЧАСТОТА ПО Y — ЗАКАЗ ВЛАДЕЛЬЦА 2026-08-31: *«перерисуй, напряжение по оси X»*.
//
// Это не вкус, а читаемость по существу: в такой раскладке андервольт виден как СДВИГ КРИВОЙ ВЛЕВО
// — «та же частота за меньшее напряжение», — и расстояние между серой и цветной линией по
// горизонтали ЕСТЬ выигрыш в милливольтах, который можно померить глазом. В прежней раскладке тот
// же выигрыш читался как провал линии вниз, и его приходилось пересчитывать в уме.
// Так же принято рисовать V/F-кривые в отрасли: напряжение — независимая величина.
// ⚡ ЛЕВЫЙ КРАЙ ОСИ — 600 мВ, ЗАКАЗ ВЛАДЕЛЬЦА 2026-08-31: *«рисуй график начиная с 600 мВ»*.
//
// У карты сетка начинается с 450 мВ, но нижние ступени — это состояние покоя, тюнинга там нет и не
// будет. Растягивая ось до 450, мы отдавали треть ширины листа участку, на котором обе линии лежат
// друг на друге, и сжимали ровно ту область, где работа: 800…1200 мВ. Отсечение — про РАЗРЕШЕНИЕ
// картинки, а не про сокрытие данных, и поэтому оно названо тут же на полотне.
const X_FLOOR_MV = 600;
const xMin = Math.max(X_FLOOR_MV, Math.floor((Math.min(...mvAll) - 20) / 50) * 50);
const xMax = Math.ceil((Math.max(...mvAll) + 20) / 50) * 50;
const yMin = Math.min(...mhzAll), yMax = Math.max(...mhzAll);

const X = (mv) => PAD.l + ((mv - xMin) / (xMax - xMin)) * plotW;
const Y = (mhz) => PAD.t + (1 - (mhz - yMin) / (yMax - yMin)) * plotH;
const n2 = (v) => Math.round(v * 10) / 10;

const polyline = (pts) => pts.map(([a, b]) => `${n2(a)},${n2(b)}`).join(' ');

// =================================================================================================
// 3. Слои
// =================================================================================================

const stockPts = rows.filter((r) => Number.isFinite(r.stockVoltageMv) && r.stockVoltageMv >= xMin)
  .map((r) => [X(r.stockVoltageMv), Y(r.mhz)]);

// ⚡ НАША ЛИНИЯ — ЭФФЕКТИВНАЯ КРИВАЯ, А НЕ СЫРАЯ КОЛОНКА ДОКУМЕНТА (правка 2026-08-31).
//
// Слово владельца, которым дефект найден: *«наша VF кривая ужасная, у неё не видно равномерности»*
// и *«я стоковую кривую понимаю, вижу равномерность, а нашу не понимаю»*. Он был прав, и причина
// оказалась не в данных, а В ЭТОМ РИСУНКЕ: линия соединяла строки документа подряд по частоте, а
// документ держит в одной колонке 92 ИЗМЕРЕННЫХ строки и 297 ЗАВОДСКИХ. На стыках получалась пила
// с провалами до 140 мВ — 23 нарушения монотонности, — и она не описывала НИЧЕГО: на карту такая
// колонка не едет.
//
// На карту едет ВОТ ЧТО: для каждой ступени сетки напряжения — САМАЯ ВЫСОКАЯ частота, которую это
// напряжение вправе обслужить по нашим замерам. Ровно этот вопрос задаёт `curve-store.offsetsFor`
// каждой точке таблицы, и ответ монотонен ПО ПОСТРОЕНИЮ: строки перебираются сверху вниз, и первая
// подошедшая — ответ. Замерено: 127 точек, нарушений 0.
//
// Считается из ОДНОГО ДОКУМЕНТА, без карты: «какую частоту вправе обслужить напряжение V» — свойство
// наших замеров, а не железа. Живая таблица нужна только чтобы превратить это в СДВИГ при записи, и
// инструмент остаётся тем, чем был: читает файлы, карту не трогает.
//
// ⚠️ ПЛОСКИЕ УЧАСТКИ ЛИНИИ — ЭТО НЕ ОШИБКА, А ЧЕСТНЫЙ ОТВЕТ «ЗДЕСЬ ЕЩЁ НЕ МЕРИЛИ». Там, где 900 и
// 975 мВ обслуживают одну и ту же частоту, лишние 75 мВ ничем не оплачены: глубже этой частоты мы
// не спускались. Ступенька вверх появляется ровно там, где есть замер.
const mvGrid = (doc.voltageGridMv ?? []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
// 🔴 ПРАВИЛО НАПИСАНО БЕЗ ОПОРЫ НА ПОРЯДОК СТРОК, И ЭТО ПОЧИНКА, А НЕ СТИЛЬ.
//
// Первая редакция копировала приём движка — «первая строка, чьё напряжение подходит» (`offsetsFor`
// перебирает документ сверху вниз, и первая подошедшая и есть самая высокая частота). Но ЗДЕСЬ
// `rows` пересортированы СНИЗУ ВВЕРХ для рисования (строка 44), и то же правило вернуло 180 МГц на
// каждом напряжении: вся наша линия легла плашмя по нижнему краю полотна и стала невидимой.
// Владелец увидел это первым — «не вижу нашего графика».
//
// Класс — пара «правда ↔ зеркало»: одно правило, написанное дважды под два разных порядка. Лечится
// не сверкой порядков, а формулировкой, которой порядок безразличен: берём МАКСИМУМ частоты среди
// подходящих строк. Это ровно то, что правило и означает словами — «самая высокая частота, которую
// это напряжение вправе обслужить», — и пересортировка его больше не сломает.
const effective = mvGrid.filter((v) => v >= xMin).map((v) => {
  let best = null;
  for (const r of rows) {
    if (!Number.isFinite(r.voltageMv) || r.voltageMv > v) continue;
    if (best === null || r.mhz > best) best = r.mhz;
  }
  return best === null ? null : { mv: v, mhz: best };
}).filter(Boolean);
const tunedPts = effective.map((e) => [X(e.mv), Y(e.mhz)]);

const provenDots = [...proven.entries()].filter(([m, v]) => m >= yMin && m <= yMax && v >= xMin)
  .map(([m, v]) => `<circle cx="${n2(X(v))}" cy="${n2(Y(m))}" r="3" class="proven"><title>${m} МГц: самое глубокое ПРОШЕДШЕЕ ${v} мВ</title></circle>`).join('');

const hungDots = [...hung.entries()].filter(([m, v]) => m >= yMin && m <= yMax && v >= xMin)
  .map(([m, v]) => {
    const p = proven.get(m);
    const contradicts = Number.isFinite(p) && p < v;
    return `<circle cx="${n2(X(v))}" cy="${n2(Y(m))}" r="${contradicts ? 5 : 3.5}" class="${contradicts ? 'hung wrong' : 'hung'}">`
      + `<title>${m} МГц: ЗАВИСАНИЕ на ${v} мВ${contradicts ? ` — но прожиг проходил на ${p} мВ, на ${v - p} мВ ГЛУБЖЕ` : ''}</title></circle>`;
  }).join('');

// Нетронутые участки — бледной заливкой, чтобы «где ещё не были» читалось без счёта точек.
const gaps = [];
{
  let cur = null;
  for (const r of rows) {
    if (isUntouched(r)) { if (!cur) { cur = { from: r.mhz, to: r.mhz }; gaps.push(cur); } cur.to = r.mhz; }
    else cur = null;
  }
}
// Полоса «не тронуто» задаётся диапазоном ЧАСТОТ, а частота теперь на Y — значит полоса легла
// горизонтально. Ось Y перевёрнута (высокая частота вверху), поэтому верх полосы даёт `g.to`.
const gapRects = gaps.filter((g) => g.to > g.from).map((g) =>
  `<rect x="${PAD.l}" y="${n2(Y(g.to))}" width="${plotW}" height="${n2(Y(g.from) - Y(g.to))}" class="gap">`
  + `<title>не тронуто: ${g.from}…${g.to} МГц</title></rect>`).join('');

// Сетки осей
const xTicks = [];
for (let v = xMin; v <= xMax; v += 50) xTicks.push(v);
const yTicks = [];
for (let m = Math.ceil(yMin / 250) * 250; m <= yMax; m += 250) yTicks.push(m);

const grid = [
  ...xTicks.map((m) => `<line x1="${n2(X(m))}" y1="${PAD.t}" x2="${n2(X(m))}" y2="${PAD.t + plotH}" class="grid"/>`
    + `<text x="${n2(X(m))}" y="${PAD.t + plotH + 20}" class="ax" text-anchor="middle">${m}</text>`),
  ...yTicks.map((v) => `<line x1="${PAD.l}" y1="${n2(Y(v))}" x2="${PAD.l + plotW}" y2="${n2(Y(v))}" class="grid"/>`
    + `<text x="${PAD.l - 10}" y="${n2(Y(v)) + 4}" class="ax" text-anchor="end">${v}</text>`),
].join('');

// =================================================================================================
// 4. Что осталось сделать — таблица по участкам, чтобы владельцу было ЧТО выбрать
// =================================================================================================

const BUCKET = 100;
const buckets = new Map();
for (const r of rows) {
  const k = Math.floor(r.mhz / BUCKET) * BUCKET;
  const b = buckets.get(k) ?? { from: k, n: 0, untouched: 0, edge: 0, walled: 0 };
  b.n += 1;
  if (isUntouched(r)) b.untouched += 1;
  if ((r.tags ?? []).some((t) => t.startsWith('stop:edge-found'))) b.edge += 1;
  if (hung.has(r.mhz)) b.walled += 1;
  buckets.set(k, b);
}
const bucketRows = [...buckets.values()].sort((a, b) => b.from - a.from).map((b) => {
  const state = b.untouched === b.n ? 'НЕ ТРОНУТО ЦЕЛИКОМ'
    : (b.untouched === 0 ? 'пройдено полностью' : `частично — не тронуто ${b.untouched} из ${b.n}`);
  return `<tr class="${b.untouched === b.n ? 'todo' : (b.untouched ? 'part' : 'done')}">`
    + `<td>${b.from}…${b.from + BUCKET - 1}</td><td>${b.n}</td><td>${state}</td>`
    + `<td>${b.edge || '—'}</td><td>${b.walled || '—'}</td></tr>`;
}).join('');

// Противоречия «пол зависания выше доказанного» — списком: это прямой ответ на вопрос владельца.
const contradictions = [...hung.entries()]
  .map(([m, v]) => ({ m, v, p: proven.get(m) }))
  .filter((x) => Number.isFinite(x.p) && x.p < x.v)
  .sort((a, b) => (b.v - b.p) - (a.v - a.p));

const contraRows = contradictions.map((x) => {
  const row = rows.find((r) => r.mhz === x.m);
  const stock = row?.stockVoltageMv ?? null;
  return `<tr><td>${x.m}</td><td>${stock ?? '—'}</td><td class="bad">${x.v}</td><td class="ok">${x.p}</td>`
    + `<td>${x.v - x.p} мВ</td><td>${stock ? `−${stock - x.v} мВ` : '—'}</td></tr>`;
}).join('');

// =================================================================================================
// 5. Страница
// =================================================================================================

const stamp = doc.stamp ?? {};
const html = `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>KAGO — карта кривой</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #f6f7f9; color: #16181d;
         font: 14px/1.5 "Segoe UI", system-ui, sans-serif; }
  .wrap { max-width: 1420px; margin: 0 auto; padding: 22px 28px 60px; }
  h1 { font-size: 21px; margin: 0 0 4px; letter-spacing: .2px; }
  .sub { color: #5c626e; margin: 0 0 18px; font-size: 13px; }
  .card { background: #fff; border: 1px solid #e3e6ec; border-radius: 10px; padding: 16px 18px; margin: 0 0 20px; }
  svg { display: block; width: 100%; height: auto; }
  .grid { stroke: #e9ecf1; stroke-width: 1; }
  .ax { fill: #7a8090; font-size: 11px; }
  .gap { fill: #eef1f6; }
  .stock { fill: none; stroke: #9aa1ae; stroke-width: 1.6; }
  .tuned { fill: none; stroke: #1e9e5a; stroke-width: 2.2; }
  .proven { fill: #2b6cb0; opacity: .85; }
  .hung { fill: #d23b3b; }
  .hung.wrong { fill: #d23b3b; stroke: #7a1414; stroke-width: 2; }
  .legend { display: flex; gap: 22px; flex-wrap: wrap; margin: 12px 2px 0; font-size: 13px; color: #3b414d; }
  .legend i { display: inline-block; width: 22px; height: 3px; vertical-align: middle; margin-right: 7px; border-radius: 2px; }
  .legend b.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; vertical-align: middle; margin-right: 7px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #edeff3; }
  th { color: #5c626e; font-weight: 600; }
  tr.todo td { background: #fffaf0; }
  tr.done td { color: #8b909b; }
  td.bad { color: #c22; font-weight: 600; }
  td.ok { color: #1e9e5a; font-weight: 600; }
  .note { font-size: 13px; color: #4a5060; margin: 10px 2px 0; }
  h2 { font-size: 15px; margin: 0 0 10px; }
</style></head><body><div class="wrap">

<h1>Карта кривой — что протюнено, где сток, где край</h1>
<p class="sub">Документ <code>${CURVE}</code> · снят ${stamp.takenAt ?? '—'} · драйвер ${stamp.driver ?? '—'} · VBIOS ${stamp.vbios ?? '—'}
 · частот ${rows.length}, из них тронуто <b>${touched.length}</b> · журнал прогонов: ${journalLines} строк.
 Построено <code>node tools/build-curve-map.mjs</code>; руками не правится.</p>

<div class="card">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Кривая напряжений по частотам">
  ${gapRects}
  ${grid}
  <polyline class="stock" points="${polyline(stockPts)}"/>
  <polyline class="tuned" points="${polyline(tunedPts)}"/>
  ${provenDots}
  ${hungDots}
  <text x="${PAD.l}" y="${H - 12}" class="ax">напряжение, мВ → (ось начинается с ${xMin} мВ: ниже сетка карты есть, тюнинга нет)</text>
  <text x="14" y="${PAD.t + 10}" class="ax">МГц</text>
</svg>
<div class="legend">
  <span><i style="background:#9aa1ae"></i>сток — заводское напряжение</span>
  <span><i style="background:#1e9e5a"></i>наша — что ЛЯЖЕТ В КАРТУ; <b>чем ЛЕВЕЕ серой, тем глубже андервольт</b></span>
  <span><b class="dot" style="background:#2b6cb0"></b>самое глубокое, что ПРОХОДИЛО прожиг</span>
  <span><b class="dot" style="background:#d23b3b"></b>записанное зависание — ниже него спуск не ходит</span>
  <span><b class="dot" style="background:#eef1f6;border:1px solid #ccd"></b>бледная зона — не тронуто</span>
</div>
<p class="note">Красная точка с тёмной обводкой — <b>пол зависания выше доказанного</b>: прожиг на этой
частоте проходил ГЛУБЖЕ, чем стоит пол. Наведите — покажет оба числа.</p>
<p class="note"><b>Зелёная линия — то, что ляжет в карту</b>, а не колонка документа: для каждой ступени
напряжения берётся самая высокая частота, которую это напряжение вправе обслужить по нашим замерам.
Она монотонна по построению. <b>Плоский участок означает «здесь ещё не мерили»</b> — лишние
милливольты на нём ничем не оплачены. Синие точки — сырые замеры, они ложатся не на линию и не
обязаны: линия отвечает на вопрос «сколько дать напряжения», точка — «что выдержал один прожиг».</p>
</div>

${contradictions.length ? `<div class="card">
<h2>🔴 Полы зависания, стоящие ВЫШЕ того, что эта же частота уже выдержала прожигом</h2>
<table><thead><tr><th>МГц</th><th>сток, мВ</th><th>пол зависания, мВ</th><th>проходило, мВ</th><th>разница</th><th>андервольт пола</th></tr></thead>
<tbody>${contraRows}</tbody></table>
<p class="note">Разбор — <code>bugs/85</code>, предложение — <code>ideas/16</code>. Пока пол стоит,
частота не спускается ни в одном прогоне (правило R18, <code>bugs/23</code>).</p>
</div>` : ''}

<div class="card">
<h2>Где ещё есть работа — по участкам в 100 МГц</h2>
<table><thead><tr><th>участок, МГц</th><th>частот</th><th>состояние</th><th>край найден</th><th>с полом зависания</th></tr></thead>
<tbody>${bucketRows}</tbody></table>
</div>

</div></body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');
console.log(`КАРТА КРИВОЙ: ${OUT}`);
console.log(`  частот ${rows.length} · тронуто ${touched.length} · не тронуто ${rows.length - touched.length}`);
console.log(`  полов зависания (зарегистрированных) ${hung.size} · из них ВЫШЕ доказанного ${contradictions.length}`);
if (contradictions.length) {
  for (const x of contradictions) console.log(`    🔴 ${x.m} МГц: пол зависания ${x.v} мВ, а прожиг проходил на ${x.p} мВ — на ${x.v - x.p} мВ глубже`);
}
console.log('  В КАРТУ НЕ ЗАПИСАНО НИЧЕГО: инструмент читает два файла и пишет один HTML.');
return 0;
}

// СТОРОЖ ВХОДА — прибор исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && entryResolve(process.argv[1]) === entryResolve(entryPath(import.meta.url))) process.exit(await main(process.argv.slice(2)));
