#!/usr/bin/env node
// tools/build-comparison-card.mjs — сравнение стока и наших режимов в формате 9:16 (PNG) для
// социальных сетей и витрины GitHub.
//
// ЗАЧЕМ. Просьба владельца 2026-09-01: «нарисуешь таблицу сравнений со стоком и наших профилей -
// красивый 9:16 рисунок, который в социальные сети пойдёт и в README GH» · «нужно, чтобы текста
// были большими, различимыми, но что-то не было некрасивых разрывов-переносов».
//
// МЕТОД ВЗЯТ У СОСЕДНЕГО ПРОЕКТА KAIF (`tools/build-story-card.mjs`) по его прямому указанию
// («такой рисунок уже учился рисовать проект KAIF - подсмотришь у него навыки»). Заимствованы
// РЕШЕНИЯ, а не код: у KAIF рендер идёт через `puppeteer`, которого в зависимостях KAGO нет и
// который здесь не нужен — Edge на этой машине уже поднимается контуром согласований и умеет
// `--headless --screenshot`. Ноль новых зависимостей (правило `GOAL.md`: сторонних GUI в
// зависимостях не держим; правило стиля: зависимость — это решение, а не удобство).
//
// ЧЕТЫРЕ РЕШЕНИЯ, ЗАЩИЩЁННЫЕ КОДОМ (первые три — наследство KAIF, четвёртое — наше):
//
// 1. ЧИСЛА НЕ ДУБЛИРУЮТСЯ И НЕ ПЕРЕПЕЧАТЫВАЮТСЯ. Каждая цифра читается из записи прибора
//    (`runs/graphics/<метка>.json`), а разницы СЧИТАЮТСЯ здесь. Таблица, набранная руками,
//    разъезжается с истиной на первом же пересчёте. Нет записи — прогон ПАДАЕТ и говорит, какой
//    метки не хватает, вместо того чтобы нарисовать красивое неизвестно что.
//
// 2. КЕГЛЬ ЗАДАН, А НЕ ПОДОГНАН. Читаемость с телефона — нижняя граница, а не пожелание: KAIF
//    заплатил за версию, которая ужимала шрифт под число строк и получила от владельца «это
//    нечитаемо». Здесь размеры фиксированы, а строк ровно столько, сколько влезает.
//
// 3. ВИД — ТАБЛИЦА GitHub, ТЁМНАЯ ТЕМА. Та среда, в которой владелец читает витрину.
//
// 4. ПАРА ЗАМЕРОВ НА КАЖДЫЙ РЕЖИМ, И РАЗБРОС ПЕЧАТАЕТСЯ РЯДОМ. Одиночный замер в этом проекте не
//    является утверждением о разнице (правило: «потери нет» произносится только после замера
//    разброса прибора). Поэтому карточка берёт ПО ДВЕ записи на режим, показывает медиану пары и
//    несёт разброс в подвале — иначе она рекламировала бы точность, которой у прибора нет.
//
// ПЕРЕНОСЫ. `typo()` ставит неразрывный пробел между числом и единицей, в разрядах чисел и после
// коротких слов; числовые ячейки не переносятся вовсе (`white-space: nowrap`).
//
// GPU WRITES: NONE. Читает JSON, пишет HTML и PNG в `assets/`.
//
// Использование:
//   node tools/build-comparison-card.mjs            # собрать assets/comparison-9x16.png
//   node tools/build-comparison-card.mjs --open     # собрать и ОТКРЫТЬ (показ — действие, не ссылка)
//
// [NOT-TESTED] на момент рождения; маркер переворачивается прогоном с осмотром картинки глазами.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = join(ROOT, 'runs', 'graphics');
const OUT_DIR = join(ROOT, 'assets');
const HTML = join(OUT_DIR, 'comparison-9x16.html');
const PNG = join(OUT_DIR, 'comparison-9x16.png');

// ВЕРСИЯ ЧИТАЕТСЯ ИЗ МАНИФЕСТА, А НЕ ВПИСЫВАЕТСЯ. Номер, набранный руками внутри картинки, — ровно
// тот дефект, за который заплатил соседний KAIF: релиз 2.3 уехал на GitHub с логотипом, на котором
// стояло 2.2, потому что подпись перерисовать было нечем. Здесь номер берётся из `package.json`,
// значит после бампа версии карточка сама несёт новый.
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

// ЛОГОТИП ВСТРАИВАЕТСЯ ДАННЫМИ, А НЕ ССЫЛКОЙ НА ФАЙЛ. Edge в headless-режиме читает `file://` из
// каталога страницы по-разному в зависимости от политик; base64 снимает вопрос совсем и делает HTML
// самодостаточным (его можно открыть откуда угодно). Мастер логотипа — один на проект, здесь он
// только читается.
const LOGO_FILE = join(ROOT, 'assets', 'logo', 'kago-logo.png');
if (!existsSync(LOGO_FILE)) throw new Error(`логотипа нет: ${LOGO_FILE}`);
const LOGO_SRC = `data:image/png;base64,${readFileSync(LOGO_FILE).toString('base64')}`;

const NB = '\u00A0';                   // неразрывный пробел
const WIDTH = 1080;
const HEIGHT = 1920;
const SCALE = 2;                       // итог — 2160×3840

// ─── КАКИЕ ЗАПИСИ СОСТАВЛЯЮТ КАРТОЧКУ ─────────────────────────────────────────────────────────
//
// По ДВЕ на режим, и это не украшение: пара даёт медиану и разброс. Метки — те, что写 прибор в
// `runs/graphics/`; сток снят 31.08 чередованием с профилем того дня, режимы — 01.09 чередованием
// между собой. Прибор сам отказывается сравнивать записи с разной геометрией, демо, драйвером и
// VBIOS (`gfx --spread`), и он их принял — иначе карточку рисовать было бы нельзя.
// ⚠️ ИМЕНА РЕЖИМОВ ПИШУТСЯ КАК ИХ НАЗВАЛ ВЛАДЕЛЕЦ, БЕЗ СОКРАЩЕНИЙ. «Max Perf.» — обрубок, а имя
// режима это бренд: канон отгружает «Max Perfomance» именно так, вместе с его орфографией.
const COLUMNS = [
  { key: 'stock', title: 'Stock Default', sub: 'как с завода', labels: ['stock_c', 'stock_d'] },
  { key: 'opt', title: 'Optimised', sub: 'ежедневный', labels: ['opt83_a', 'opt83_b'] },
  // «полная мощность» — слово владельца 2026-09-01 вместо прежнего «весь запас»: он попросил текст
  // агрессивнее, и это его витрина.
  { key: 'mp', title: 'Max Perfomance', sub: 'полная мощность', labels: ['mp83_a', 'mp83_b'] },
];

// Строки таблицы: что берём из записи и как показываем.
// ─── ПОЛ ПРИБОРА ПО КАЖДОЙ ВЕЛИЧИНЕ — ИЗМЕРЕННЫЙ, А НЕ ВЫВЕДЕННЫЙ ИЗ ДВУХ ЗАМЕРОВ ─────────────
//
// Разброс ПАРЫ занижает шум прибора: два прогона могут случайно совпасть. Где проект измерял пол
// отдельно и многими прогонами — берётся его число, и оно старше пары:
//
//   ватты  — 0,65 % (1,28 Вт), десять прогонов на стоке, `npm run power -- --spread`;
//   кадры  — 0,90 %, пол графического стенда между запусками (`gfx --spread`, факт 3 STATUS).
//
// Где своего замера пола нет (градусы, обороты, частота) — работает разброс пары, и это честнее
// молчания: занижённый порог показывает разницу, завышенный её скрыл бы.
const ROWS = [
  { what: 'Кадры', unit: 'FPS', pick: (r) => r.fps?.median, digits: 1, better: 'up', floorPct: 0.90 },
  { what: 'Мощность', unit: 'Вт', pick: (r) => r.medians?.loaded?.['power.draw.instant']?.median, digits: 0, better: 'down', floorPct: 0.65 },
  { what: 'Температура', unit: '°C', pick: (r) => r.medians?.loaded?.['temperature.gpu']?.median, digits: 0, better: 'down' },
  { what: 'Вентилятор', unit: '%', pick: (r) => r.medians?.loaded?.['fan.speed']?.median, digits: 0, better: 'down' },
  { what: 'Частота ядра', unit: 'МГц', pick: (r) => r.medians?.loaded?.['clocks.gr']?.median, digits: 0, better: 'up' },
];

/** Запись прибора по метке. Нет записи — ПАДАЕМ: карточка без замера не рисуется. */
function record(label) {
  const p = join(RUNS, `${label}.json`);
  if (!existsSync(p)) {
    throw new Error(`записи прибора «${label}» нет (${p}). Карточка рисуется ТОЛЬКО из замеров: `
      + 'сперва `npm run gfx -- --capture --label ' + label + '`');
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Медиана пары и её разброс в процентах — оба числа из записей, ни одно не назначено. */
function pairValue(labels, pick) {
  const vals = labels.map((l) => Number(pick(record(l)))).filter(Number.isFinite);
  if (vals.length === 0) return { value: null, spreadPct: null, n: 0 };
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const spread = sorted[sorted.length - 1] - sorted[0];
  return { value: median, spreadPct: median ? (spread / median) * 100 : null, n: vals.length };
}

const fmt = (v, digits) => (v === null || v === undefined ? '—'
  : Number(v).toFixed(digits).replace('.', ','));

/** Типографика против некрасивых переносов — просьба владельца, дословно. */
function typo(s) {
  return String(s)
    .replace(/(\d)\s+(?=\d{3}(?!\d))/g, `$1${NB}`)        // разряды числа
    .replace(/(\p{L})-(\p{L})/gu, '$1\u2011$2')            // дефис внутри слова не рвётся
    // ⚠️ ГРАНИЦА СЛОВА `\b` В JS — ASCII-ONLY, И НА КИРИЛЛИЦЕ НЕ СРАБАТЫВАЕТ ВОВСЕ. Здесь стояло
    // `\b(и|в|на|…)`, и правило не выполнилось НИ РАЗУ: союз «и» повис на конце строки прямо на
    // витрине, и это увидел глаз, а не прогон. Опора теперь на начало строки или пробел.
    .replace(/(^|\s)(и|в|на|за|до|от|по|у|с|о|не)\s+/gu, `$1$2${NB}`)
    .replace(/(\d)\s+(?=[А-Яа-яA-Za-z°%])/g, `$1${NB}`)    // число и его единица неразделимы
    .trim();
}

// ─── СБОР ЧИСЕЛ ───────────────────────────────────────────────────────────────────────────────
const data = ROWS.map((row) => {
  const cells = {};
  for (const c of COLUMNS) cells[c.key] = pairValue(c.labels, row.pick);
  // Разница считается ПРОТИВ СТОКА для КАЖДОГО режима (слово владельца 2026-09-01: «для режима Max
  // цифры тоже можно было покрасить и посчитать проценты выигрышей») и в ту сторону, которая для
  // этой строки лучше: у ватт и градусов «лучше» значит МЕНЬШЕ.
  const stock = cells.stock.value;
  const deltas = {};
  for (const c of COLUMNS) {
    if (c.key === 'stock') continue;
    const v = cells[c.key].value;
    if (!Number.isFinite(stock) || !Number.isFinite(v) || stock === 0) { deltas[c.key] = null; continue; }
    const pct = ((v - stock) / stock) * 100;
    // 🔴 РАЗНИЦА ТОНЬШЕ РАЗБРОСА — НЕ ВЫИГРЫШ, И КРАСИТЬ ЕЁ ЗЕЛЁНЫМ ЗНАЧИТ ОБЕЩАТЬ ТО, ЧЕГО НЕ
    // ИЗМЕРЕНО. Пойман на живом примере: у Max Perfomance ватты дали «−0,3 %» (299 против 300), и
    // это зелёное число простояло на витрине один прогон. Собственный разброс проекта по ваттам —
    // 0,65 % (замерен десятью прогонами на стоке), то есть −0,3 % лежит НИЖЕ пола прибора.
    // Планка берётся из САМИХ ЗАПИСЕЙ: у каждой пары замеров есть свой разброс по этой же величине,
    // и порог — худший из двух сравниваемых. Ни одного назначенного числа.
    const floor = Math.max(cells.stock.spreadPct ?? 0, cells[c.key].spreadPct ?? 0, row.floorPct ?? 0);
    const meaningful = Math.abs(pct) > floor;
    deltas[c.key] = {
      pct, abs: v - stock, floor, meaningful,
      good: meaningful && (row.better === 'up' ? pct >= 0 : pct <= 0),
    };
  }
  return { ...row, cells, deltas, delta: deltas.opt ?? null };
});

// Разброс прибора по кадрам — тот, который единственный годится для критерия просадки.
const fpsSpread = Object.fromEntries(COLUMNS.map((c) => [c.key, pairValue(c.labels, (r) => r.fps?.median).spreadPct]));
// САМЫЙ ШИРОКИЙ разброс пары — та планка, ниже которой разница НЕ является эффектом. Берётся
// максимум, а не средний и не «удобный»: утверждение о разнице проверяется худшим прибором из
// участвовавших, иначе карточка обещает точность, которой не было ни в одном из замеров.
const worstSpread = Math.max(...Object.values(fpsSpread).filter(Number.isFinite));
// Просадка Optimised ПРОТИВ MAX PERFOMANCE — та величина, о которой владелец задал критерий 5 %.
// СЧИТАЕТСЯ здесь, а не вписывается в подвал руками: вписанное число — это пара «правда↔зеркало»
// внутри одной карточки, и разъедется она на первом же новом замере (решение 1 метода).
const fpsOpt = pairValue(COLUMNS.find((c) => c.key === 'opt').labels, (r) => r.fps?.median).value;
const fpsMp = pairValue(COLUMNS.find((c) => c.key === 'mp').labels, (r) => r.fps?.median).value;
const dropVsMp = Number.isFinite(fpsOpt) && Number.isFinite(fpsMp) && fpsMp ? ((fpsOpt - fpsMp) / fpsMp) * 100 : null;
const dropSaid = dropVsMp === null ? '—'
  : `${dropVsMp > 0 ? '+' : '−'}${Math.abs(dropVsMp).toFixed(1).replace('.', ',')}${NB}%`;
const stamp = record(COLUMNS[1].labels[0]);
const demo = stamp.demo ?? 'timedemo';
// ─── ИМЯ ИГРЫ И ИМЯ ПРОГОНА — ПО-ЧЕЛОВЕЧЕСКИ (слово владельца 2026-09-01) ─────────────────────
//
// На витрине стояло «q2demo1.dm2» — имя ФАЙЛА демозаписи, внутренний идентификатор, который
// посторонний прочесть не может. Витринное правило проекта: внутреннее слово разворачивается в
// человеческое имя. Файл демозаписи остаётся в записях прибора (`runs/graphics/*.json` → `demo`),
// то есть не потерян, а убран оттуда, где он ничего не сообщает.
//
// ⚠️ СВЯЗЬ С ЗАПИСЬЮ ПРОВЕРЯЕТСЯ, А НЕ ПОДРАЗУМЕВАЕТСЯ: если прибор однажды начнёт гонять другую
// демозапись, красивое имя игры станет ложью. Поэтому сверка ниже краснеет на несовпадении.
const GAME = 'Quake II RTX';
const BENCH = 'встроенный таймдемо';
const DEMO_EXPECTED = 'q2demo1.dm2';
if (demo !== DEMO_EXPECTED) {
  throw new Error(`запись прибора гоняла демо «${demo}», а карточка подписана как «${GAME} · ${BENCH}» `
    + `в расчёте на «${DEMO_EXPECTED}». Обновите подпись или пересоберите замеры: имя игры на витрине `
    + 'не должно расходиться с тем, что реально прогнали');
}
const gpu = stamp.gpu?.name ?? 'NVIDIA GeForce RTX 5070 Ti';
const driver = stamp.gpu?.driver ?? '?';
// ⚠️ ГЕОМЕТРИЯ — ОБЪЕКТ, А НЕ СТРОКА, и первая проба напечатала «[object Object]» прямо на витрине.
// Поле собирается ПОЛЯМИ: подставить объект в шаблон — это молчаливая порча текста, которую видно
// только глазом, а на витрину смотрит посторонний.
const g = stamp.desktopGeometry ?? {};
const geometry = Number.isFinite(g.width) && Number.isFinite(g.height)
  ? `${g.width}×${g.height}${Number.isFinite(g.refreshHz) ? ` @ ${g.refreshHz} Гц` : ''}`
  : '—';

// ─── ВЁРСТКА ──────────────────────────────────────────────────────────────────────────────────
// ⚠️ РАЗНИЦА ЖИВЁТ В ЯЧЕЙКЕ РЕЖИМА, А НЕ В ПЯТОЙ КОЛОНКЕ. Первая проба держала её отдельной
// колонкой — и заголовок последней колонки уехал за рамку кадра, потому что на 1080 точек пять
// колонок с читаемым кеглем не встают. Кегль здесь старше числа колонок (решение 2).
// РАЗНИЦА ПОКАЗЫВАЕТСЯ ТОЛЬКО ТАМ, ГДЕ ОНА ИЗМЕРЕНА. Слово владельца 2026-09-01, после того как он
// увидел зелёное «−0,3 %» на ваттах Max Perfomance: «если выигрыш в ватах отсутствует - то не крась
// и не считай проценты». Значит разница тоньше разброса пары не печатается ВООБЩЕ — ни цветом, ни
// числом: процент, который меньше собственного шума прибора, сообщает не результат, а шум.
const deltaHtml = (d) => {
  if (!d || !d.meaningful) return '';
  return `<span class="d ${d.good ? 'good' : 'bad'}">${d.pct > 0 ? '+' : '−'}`
    + `${Math.abs(d.pct).toFixed(1).replace('.', ',')}${NB}%</span>`;
};

const rowsHtml = data.map((r) => `
      <tr>
        <td class="what">${typo(r.what)}</td>
        ${COLUMNS.map((c) => `<td class="num ${c.key}">${fmt(r.cells[c.key].value, r.digits)}<span class="u">${NB}${r.unit}</span>`
    + `${c.key === 'stock' ? '' : deltaHtml(r.deltas[c.key])}</td>`).join('')}
      </tr>`).join('');

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<style>
  @page { size: ${WIDTH}px ${HEIGHT}px; margin: 0 }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
    background: #0d1117; color: #e6edf3;
    font-family: "Segoe UI", "Inter", system-ui, sans-serif;
    display: flex; flex-direction: column; padding: 64px 56px;
  }
  /* Логотип слева от имени — слово владельца. Файл берётся из каталога assets/logo, а не рисуется здесь:
     логотип это бренд, и его мастер один на весь проект. */
  .brand { display: flex; align-items: center; gap: 26px }
  .brand img { width: 104px; height: 104px; display: block }
  .brand .name { font-size: 56px; letter-spacing: .16em; color: #ffffff; font-weight: 800; line-height: 1 }
  .brand .name span { color: #8b949e; font-weight: 700; letter-spacing: .1em }
  /* Синяя пилюля со ссылкой на репозиторий — слово владельца 2026-09-01. */
  .pill { display: inline-block; margin-top: 22px; background: #1f6feb; color: #ffffff;
          font-size: 27px; font-weight: 600; padding: 14px 30px; border-radius: 999px;
          letter-spacing: .01em; white-space: nowrap }
  /* Строка-описание проекта — слово владельца 2026-09-01. Кегль подобран так, чтобы она встала в
     ДВЕ строки и не рвалась посередине слова: капитель на 1080 точек шириной иначе не читается. */
  .tagline { margin-top: 22px; font-size: 36px; line-height: 1.28; letter-spacing: .03em;
             color: #56d364; font-weight: 700; text-transform: uppercase }
  /* Кегль подобран так, чтобы заголовок встал В ОДНУ строку (слово владельца) — на 1080 точек
     ширины это ~46px; запрет переноса делает нарушение видимым сразу, а не втихую переносит. */
  h1 { font-size: 46px; line-height: 1.15; margin-top: 30px; font-weight: 700; white-space: nowrap }
  h1 em { font-style: normal; color: #3fb950 }
  .status { font-size: 34px; color: #c9d1d9; font-weight: 600; margin-top: 12px }
  .card { font-size: 27px; color: #7d8590; margin-top: 20px; line-height: 1.4 }
  table { width: 100%; border-collapse: collapse; margin-top: 34px; table-layout: fixed }
  col.what { width: 28% } col.n { width: 24% }
  th, td { border: 2px solid #30363d; padding: 38px 16px; text-align: right; white-space: nowrap }
  /* ЗАГОЛОВОК КОЛОНКИ ПЕРЕНОСИТСЯ, А НЕ УПИРАЕТСЯ В РАМКУ: имя режима сокращать нельзя (это бренд),
     значит уступает вёрстка. В неразрывном виде Max Perfomance уезжал за границу кадра. */
  th { background: #161b22; font-size: 27px; color: #e6edf3; font-weight: 700; text-align: right; padding: 22px 16px; white-space: normal; line-height: 1.2 }
  th.what, td.what { text-align: left; font-size: 36px; color: #c9d1d9; white-space: normal }
  /* Подписи колонок — ярче и своим цветом у каждой (слово владельца: «эти текста ярче, красивее»).
     Цвет не украшение: он же стоит на числах этой колонки, поэтому подпись и число читаются парой. */
  th span { display: block; font-size: 24px; font-weight: 600; margin-top: 8px; white-space: normal; letter-spacing: .02em }
  th.col-stock span { color: #c9d1d9 }
  th.col-opt span { color: #58a6ff }
  th.col-mp span { color: #f0883e }
  td.num { font-size: 52px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.05 }
  /* Единицы измерения ярче: серый терялся рядом с крупным числом (слово владельца — «текущий серый
     теряется, незаметен»). Единица — часть числа, а не служебная подпись. */
  td.num .u { font-size: 28px; font-weight: 600; color: #b6c2cd }
  td.opt { color: #58a6ff }
  td.opt .u { color: #79b8f3 }
  /* Max Perfomance — свой цвет, как у его подписи: колонка и её число читаются парой. */
  td.mp { color: #f0883e }
  td.mp .u { color: #e8a672 }
  span.d { display: block; font-size: 30px; font-weight: 700; margin-top: 8px; font-variant-numeric: tabular-nums }
  span.d.good { color: #3fb950 } span.d.bad { color: #f85149 }
  span.d.noise { color: #6e7681; font-weight: 600 }
  /* Автоматический верхний отступ прижимает блок к низу кадра: после того как владелец убрал мелкий
     подвал, внизу оставалась пустая полоса, а 9:16 без подвала должен быть уравновешен. */
  .pending { margin-top: auto; font-size: 30px; color: #c9d1d9; border-left: 7px solid #388bfd;
             padding-left: 26px; line-height: 1.45 }
  .pending b { color: #58a6ff; font-weight: 700 }
  footer { margin-top: auto; font-size: 24px; color: #7d8590; line-height: 1.55; border-top: 2px solid #30363d; padding-top: 24px }
  footer b { color: #c9d1d9; font-weight: 600 }
  footer p + p { margin-top: 12px }
</style></head>
<body>
  <div class="brand">
    <img src="${LOGO_SRC}" alt="">
    <div class="name">KAGO <span>${VERSION}</span></div>
  </div>
  <div class="tagline">${typo('Автоматический фреймворк оптимизации и андервольтинга GPU')}</div>
  <div class="pill">github.com/MikalaiKryvusha/KAGO</div>
  <h1>Первые результаты движка KAGO 🚀</h1>
  <div class="status">${typo('Работы продолжаются 🛠')}</div>
  <div class="card">${typo(`${gpu} · драйвер ${driver}`)}<br>${typo(`${GAME} · ${BENCH} · вывод ${geometry}`)}</div>

  <table>
    <colgroup><col class="what">${COLUMNS.map(() => '<col class="n">').join('')}</colgroup>
    <tr>
      <th class="what">Что измерено</th>
      ${COLUMNS.map((c) => `<th class="col-${c.key}">${typo(c.title)}<span>${typo(c.sub)}</span></th>`).join('')}
    </tr>${rowsHtml}
  </table>

  <div class="pending"><b>❄️ Silent Cold — ${typo('профиль в разработке.')}</b><br>${typo('Профиль для максимальной тишины почти без потерь производительности GPU.')}</div>
</body></html>`;

// ─── ПОЧЕМУ У КАРТОЧКИ НЕТ ПОДВАЛА С МЕЛКИМ ТЕКСТОМ ───────────────────────────────────────────
//
// Он там был — прибор, разброс между запусками, оговорки — и владелец убрал его глазом: «нужно
// текста мелкие внизу убрать». Это совпадает с витринным правилом проекта («число на витрине стоит
// без оправданий; происхождение числа живёт в рабочем документе»), но совпадение проверено, а не
// предположено: НИ ОДНА разница, показанная на карточке, не тоньше разброса прибора, поэтому убирать
// было нечего кроме оправданий. Числа разброса печатаются в консоль этим же прогоном и живут в
// `profiles/optimised.json` — то есть не потеряны, а переехали туда, где их читает разбирающийся.
//
// ⚠️ СТОРОЖ ЭТОГО РЕШЕНИЯ: если однажды на карточку попадёт разница ТОНЬШЕ разброса, её нельзя
// показывать без оговорки — и тогда либо строка возвращается, либо такая строка таблицы не рисуется.
// Проверка ниже краснеет прогоном, а не памятью.
const thin = data.filter((r) => r.delta && Math.abs(r.delta.pct) < worstSpread);
if (thin.length) {
  console.log(`⚠️ ВНИМАНИЕ: ${thin.length} строк(и) несут разницу ТОНЬШЕ разброса прибора `
    + `(${worstSpread.toFixed(1)} %): ${thin.map((r) => `${r.what} ${r.delta.pct.toFixed(1)} %`).join(', ')}. `
    + 'Показывать такую разницу без оговорки нельзя — верните строку про разброс либо уберите эту строку таблицы.');
}
console.log(`РАЗБРОС ПРИБОРА (в карточку не печатается, живёт здесь и в приёмке профиля): `
  + `${COLUMNS.map((c) => `${c.title} ${fpsSpread[c.key]?.toFixed(1)} %`).join(' · ')}`
  + ` · просадка Optimised против Max Perfomance ${dropSaid}`);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(HTML, html, 'utf8');

// ─── РЕНДЕР ЧЕРЕЗ EDGE, БЕЗ НОВЫХ ЗАВИСИМОСТЕЙ ────────────────────────────────────────────────
const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => existsSync(p));
if (!EDGE) throw new Error('Edge не найден — рендер PNG нечем сделать. HTML собран: ' + HTML);

execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--force-device-scale-factor=${SCALE}`,
  `--window-size=${WIDTH},${HEIGHT}`,
  `--screenshot=${PNG}`,
  `file:///${HTML.replace(/\\/gu, '/')}`,
], { stdio: 'ignore', timeout: 120_000 });

if (!existsSync(PNG)) throw new Error('Edge не создал PNG — рендер не состоялся');
const size = statSync(PNG).size;
console.log(`КАРТОЧКА: ${PNG}`);
console.log(`РАЗМЕР:   ${WIDTH * SCALE}×${HEIGHT * SCALE} px · ${(size / 1024).toFixed(0)} КБ`);
console.log('ЧИСЛА:    прочитаны из записей прибора, ни одно не перепечатано:');
for (const r of data) {
  console.log(`  ${r.what.padEnd(14)} ${COLUMNS.map((c) => `${c.title} ${fmt(r.cells[c.key].value, r.digits)}`).join(' · ')}`
    + (r.delta ? ` · разница ${r.delta.pct.toFixed(1)} %` : ''));
}
if (process.argv.includes('--open')) spawn('explorer.exe', [PNG], { detached: true, stdio: 'ignore' }).unref();
