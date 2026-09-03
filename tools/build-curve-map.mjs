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
//   ГДЕ КРАЙ        — полы зависания, которые ДЕРЖИТ ДВИЖОК, красным. Ниже них спуск не ходит (R18).
//
// И ЧЕТВЁРТЫЙ СЛОЙ, КОТОРОГО ОН НЕ ПРОСИЛ, НО КОТОРЫЙ ОТВЕЧАЕТ НА ЕГО ВОПРОС «А МОЖНО ЛИ ГЛУБЖЕ»:
//   ЧТО РЕАЛЬНО ДЕРЖАЛО ПРОЖИГ — самое глубокое ПРОШЕДШЕЕ напряжение каждой частоты, синим.
//   И пятый, выросший из четвёртого: зависание, которое движок полом БОЛЬШЕ НЕ СЧИТАЕТ (опровергнуто
//   более глубоким прожигом — решение владельца `interviews/022` = B), — полым красным кругом. Факт
//   на месте, глагол правдив: «снято», а не «ниже него спуск не ходит».
//
// 🔴 РИСУЕТ НЕ ЭТОТ ФАЙЛ, А ОБЩИЙ РЕНДЕРЕР `automation-engine/lib/curve-map.mjs` (`plans/85`).
// До 2026-09-04 факты и геометрия жили здесь; окну наблюдения понадобилась та же картинка живьём,
// и второй рисунок тех же слоёв был бы парой «правда ↔ зеркало» (R16c, EXP-0077). Здесь остались
// СТРАНИЦА и её ТАБЛИЦЫ; полы зависания при переезде взяты у одного автора — `sweep-journal.hangFloors`
// — потому что прежняя местная копия правила показывала пол там, где движок его уже снял.
//
// ПОЧЕМУ ГЕНЕРАТОР, А НЕ НАРИСОВАННЫЙ ФАЙЛ: вторая копия правды — пара «правда ↔ зеркало», за
// которую этот проект уже платил (R16c, EXP-0077). Картинка строится из документа кривой и журнала
// при каждом запуске; руками её не правят.
//
// GPU WRITES: НЕТ. Читает два файла, пишет один HTML.
//
// Запуск: node tools/build-curve-map.mjs  →  assets/curve-map.html
//
// [TESTED: 2026-09-04 · слои и геометрия — набором `npm run curvemap -- --selftest`; страница —
//  пересборкой и сверкой чисел с прямой пробой журнала (plans/85, P85-AC7)]

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { resolve as entryResolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath as entryPath, pathToFileURL } from 'node:url';
import { CURVE_PATH, JOURNAL_PATH, loadFacts, renderCurveSvg } from '../automation-engine/lib/curve-map.mjs';

/**
 * ВСЯ РАБОТА ПРИБОРА — здесь, и зовётся она ТОЛЬКО при прямом запуске (`bugs/95`, сессия 78).
 * До починки тело стояло на верхнем уровне модуля и исполнялось при ИМПОРТЕ с argv вызывающего.
 * Тело намеренно НЕ сдвинуто по отступу: в приборах этого класса есть многострочные шаблоны,
 * и сдвиг изменил бы порождаемые артефакты; голден байт-в-байт дороже отступа.
 * @param {string[]} argv аргументы БЕЗ `node` и пути к файлу
 */
async function main(argv) {

const CURVE = CURVE_PATH;
const JOURNAL = JOURNAL_PATH;
const OUT = 'assets/curve-map.html';

const must = (cond, why) => { if (!cond) { console.error(`ОСТАНОВ: ${why}`); process.exit(1); } };

// =================================================================================================
// 1. Данные — из документа и журнала, без единого числа из головы (общий модуль карты кривой)
// =================================================================================================

const loaded = loadFacts({ curvePath: CURVE, journalPath: JOURNAL });
must(loaded.ok, loaded.why);
const { facts, journalLines } = loaded;
const { rows, touched, proven, floors, refuted, isUntouched } = facts;

// =================================================================================================
// 2. Картинка — тем же рендерером, что и виджет окна наблюдения; здесь только облик страницы
// =================================================================================================

const svg = renderCurveSvg(facts);

// =================================================================================================
// 3. Что осталось сделать — таблица по участкам, чтобы владельцу было ЧТО выбрать
// =================================================================================================

const BUCKET = 100;
const buckets = new Map();
for (const r of rows) {
  const k = Math.floor(r.mhz / BUCKET) * BUCKET;
  const b = buckets.get(k) ?? { from: k, n: 0, untouched: 0, edge: 0, walled: 0 };
  b.n += 1;
  if (isUntouched(r)) b.untouched += 1;
  if ((r.tags ?? []).some((t) => t.startsWith('stop:edge-found'))) b.edge += 1;
  if (floors.has(r.mhz)) b.walled += 1;
  buckets.set(k, b);
}
const bucketRows = [...buckets.values()].sort((a, b) => b.from - a.from).map((b) => {
  const state = b.untouched === b.n ? 'НЕ ТРОНУТО ЦЕЛИКОМ'
    : (b.untouched === 0 ? 'пройдено полностью' : `частично — не тронуто ${b.untouched} из ${b.n}`);
  return `<tr class="${b.untouched === b.n ? 'todo' : (b.untouched ? 'part' : 'done')}">`
    + `<td>${b.from}…${b.from + BUCKET - 1}</td><td>${b.n}</td><td>${state}</td>`
    + `<td>${b.edge || '—'}</td><td>${b.walled || '—'}</td></tr>`;
}).join('');

// Зависания, которые движок полом не считает, — списком: это прямой ответ на вопрос владельца
// «2872 закрыта на 1035 — уверен, что это неверно» (2026-08-31), и это те частоты, которые он
// велел перемерить (`interviews/022`: «И перемерить частоты»).
const refutedRows = [...refuted.entries()]
  .map(([m, x]) => ({ m, v: x.voltageMv, p: x.provenMv, f: x.floorMv, stock: rows.find((r) => r.mhz === m)?.stockVoltageMv ?? null }))
  .sort((a, b) => (Number.isFinite(b.p) ? b.v - b.p : 0) - (Number.isFinite(a.p) ? a.v - a.p : 0));

const refutedTable = refutedRows.map((x) =>
  `<tr><td>${x.m}</td><td>${x.stock ?? '—'}</td><td class="bad">${x.v}</td><td class="ok">${Number.isFinite(x.p) ? x.p : '—'}</td>`
  + `<td>${Number.isFinite(x.p) ? `${x.v - x.p} мВ` : '—'}</td><td>${Number.isFinite(x.f) ? `${x.f} мВ` : 'снят целиком'}</td></tr>`).join('');

// =================================================================================================
// 4. Страница
// =================================================================================================

const stamp = facts.stamp ?? {};
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
  .hung.refuted { fill: none; stroke: #d23b3b; stroke-width: 2; }
  .trace { stroke: #e07b39; stroke-width: 2; stroke-dasharray: 6 4; }
  .marker { fill: none; stroke: #e07b39; stroke-width: 2.5; }
  .marker-label { fill: #b45a1c; font-size: 13px; font-weight: 600; }
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
 Построено <code>node tools/build-curve-map.mjs</code>; руками не правится. Та же картинка живьём — виджет «КРИВАЯ» в окне наблюдения (<code>npm run dashboard</code>).</p>

<div class="card">
${svg}
<div class="legend">
  <span><i style="background:#9aa1ae"></i>сток — заводское напряжение</span>
  <span><i style="background:#1e9e5a"></i>наша — что ЛЯЖЕТ В КАРТУ; <b>чем ЛЕВЕЕ серой, тем глубже андервольт</b></span>
  <span><b class="dot" style="background:#2b6cb0"></b>самое глубокое, что ПРОХОДИЛО прожиг</span>
  <span><b class="dot" style="background:#d23b3b"></b>пол зависания, который держит движок — ниже него спуск не ходит</span>
  <span><b class="dot" style="border:2px solid #d23b3b"></b>зависание, СНЯТОЕ движком — опровергнуто более глубоким прожигом</span>
  <span><b class="dot" style="background:#eef1f6;border:1px solid #ccd"></b>бледная зона — не тронуто</span>
</div>
<p class="note">Полый красный круг — <b>зависание, которое движок полом больше не считает</b>: прожиг на этой
частоте проходил ГЛУБЖЕ записанного зависания (решение владельца <code>interviews/022</code> = B), и частота
спускается заново. Наведите — покажет оба числа.</p>
<p class="note"><b>Зелёная линия — то, что ляжет в карту</b>, а не колонка документа: для каждой ступени
напряжения берётся самая высокая частота, которую это напряжение вправе обслужить по нашим замерам.
Она монотонна по построению; там, где заводская строка выше измеренных, линия ложится НА серую —
карта остаётся на стоке. На документе без единого замера линии нет вовсе.
<b>Плоский участок означает «здесь ещё не мерили»</b> — лишние милливольты на нём ничем не оплачены.
Синие точки — сырые замеры, они ложатся не на линию и не обязаны: линия отвечает на вопрос «сколько
дать напряжения», точка — «что выдержал один прожиг».</p>
</div>

${refutedRows.length ? `<div class="card">
<h2>🔴 Зависания, снятые движком: эта же частота выдержала прожиг ГЛУБЖЕ записанного зависания</h2>
<table><thead><tr><th>МГц</th><th>сток, мВ</th><th>снятое зависание, мВ</th><th>проходило, мВ</th><th>разница</th><th>действующий пол</th></tr></thead>
<tbody>${refutedTable}</tbody></table>
<p class="note">Разбор — <code>bugs/85</code>, решение владельца — <code>interviews/022</code> (вариант B,
«и перемерить частоты»). Снятый пол частоту не держит: спуск идёт заново и ищет край прожигом.</p>
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
console.log(`  частот ${rows.length} · тронуто ${touched.length} · не тронуто ${rows.length - touched.length} · проходило прожиг ${proven.size}`);
console.log(`  полов зависания (держит движок) ${floors.size} · зависаний, снятых движком ${refuted.size}`);
for (const x of refutedRows) {
  console.log(Number.isFinite(x.p)
    ? `    ○ ${x.m} МГц: зависание ${x.v} мВ снято — прожиг проходил на ${x.p} мВ, на ${x.v - x.p} мВ глубже`
    : `    ○ ${x.m} МГц: зависание ${x.v} мВ полом не считается`);
}
console.log('  В КАРТУ НЕ ЗАПИСАНО НИЧЕГО: инструмент читает два файла и пишет один HTML.');

// =================================================================================================
// 5. `--png <файл>` — РЕНДЕР 4K ТОЙ ЖЕ РАЗМЕТКИ (эпик 26, фаза 3, E26-AC5)
// =================================================================================================
//
// Заказ владельца (`ideas/05` §1): *«чтобы можно было рендерить в png … Разрешение рендера 4K»*.
// Браузер — его собственный, внешний инструмент, как `nvidia-smi`: в зависимости не входит (разведка
// `ideas/05` §3 сняла этот риск прогоном). Окно 1920×1080 при масштабе 2 даёт ровно 3840×2160 И
// крупные буквы; растянуть страницу на 3840 логических пикселей значило бы получить мелкий столбик
// посреди пустого листа (у страницы ширина 1420). Размер проверяется чтением IHDR самого PNG — без
// ImageMagick, который на этой машине SVG не растрирует и здесь не нужен.
const pngAt = argv.indexOf('--png');
if (pngAt >= 0) {
  const out = argv[pngAt + 1];
  must(out, '--png требует путь к файлу');
  const { browserCandidates } = await import('../automation-engine/lib/run-dashboard.mjs');
  const browser = browserCandidates().find(([, p]) => p && existsSync(p));
  must(browser, 'браузер не найден (Edge/Chrome): рендер 4K делает браузер владельца как внешний инструмент');
  mkdirSync(dirname(resolve(out)), { recursive: true });
  const r = spawnSync(browser[1], [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1920,1080', '--force-device-scale-factor=2',
    '--virtual-time-budget=3000', '--no-first-run', `--user-data-dir=${resolve(tmpdir(), 'kago-curve-render')}`,
    `--screenshot=${resolve(out)}`, pathToFileURL(resolve(OUT)).href,
  ], { stdio: 'ignore', timeout: 90_000, windowsHide: true });
  must(existsSync(out), `рендер не появился: ${out} (браузер вышел с кодом ${r.status ?? 'нет'})`);
  const head = readFileSync(out).subarray(0, 24);
  must(head.length === 24 && head.readUInt32BE(12) === 0x49484452, `файл ${out} — не PNG (нет IHDR)`);
  const w = head.readUInt32BE(16);
  const h = head.readUInt32BE(20);
  console.log(`РЕНДЕР: ${out} — PNG ${w}×${h} (${browser[0]}, окно 1920×1080 при масштабе 2)`);
  if (w !== 3840 || h !== 2160) { console.error(`ОСТАНОВ: E26-AC5 требует 3840×2160, получено ${w}×${h}`); return 1; }
}
return 0;
}

// СТОРОЖ ВХОДА — прибор исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && entryResolve(process.argv[1]) === entryResolve(entryPath(import.meta.url))) process.exit(await main(process.argv.slice(2)));
