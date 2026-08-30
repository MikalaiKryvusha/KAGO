/**
 * GUARD-LINT — сторож обязан объявить, ПРОТИВ ЧЕГО он доказан. Механизм М1 эпика `plans/76`.
 *
 * ─── ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ ──────────────────────────────────────────────────────────────────
 *
 * 2026-08-30 машина владельца зависла на живом прогоне. Предохранитель, писанный два дня и
 * доказанный мутациями, записал НОЛЬ трипов, а его чёрный ящик — ноль байт. Разбор (`bugs/76`)
 * нашёл за один вечер ЧЕТЫРЕ сторожа одного класса:
 *
 *   предохранитель  доказан против смерти ПРОЦЕССА   — угроза была зависание МАШИНЫ
 *   чёрный ящик     доказан чтением после ЗАКРЫТИЯ   — угроза была смерть БЕЗ закрытия
 *   оракул          доказан на ОДНОМ предупреждении  — угроза была НАКОПЛЕНИЕ
 *   сторож шага     доказан на ПЕРВОМ шаге           — угроза была ЛЮБОЙ шаг
 *
 * У всех четырёх были зелёные наборы и красневшие мутации. Ворота 5 канона
 * (`TESTING_FRAMEWORK.md`: «проверка, которая ни разу не падала, ничего не доказывает») были
 * ИСПОЛНЕНЫ во всех четырёх случаях — и бесполезны, потому что мутации краснели против НАШЕЙ
 * фикстуры, а фикстура моделировала не ту угрозу. Зелёная мутация в такой конструкции не отнимает
 * уверенность, а выдаёт её ложно.
 *
 * Слово владельца, называющее класс точнее любого определения: «двигатель прошёл прожиг, все тесты
 * зелёные — только его забыли установить на ракету, которая уже на столе».
 *
 * ─── ЧТО ДЕЛАЕТ ЭТОТ ЛИНТЕР ──────────────────────────────────────────────────────────────────────
 *
 * Заставляет автора сторожа написать рядом с ним четыре строки и валит сборку, если хоть одной нет:
 *
 *   @guard <имя>
 *   THREAT:         ради какого РЕАЛЬНОГО события он существует
 *   PROVED-AGAINST: что тест ДЕЙСТВИТЕЛЬНО делал
 *   GAP:            чего доказательство НЕ покрывает (или слово `none`)
 *   ON-REAL-PATH:   видели ли его работающим там, где ходит владелец (или `NOT YET`)
 *
 * И отдельно — для самописцев, чья плёнка обязана пережить событие (механизм М3):
 *
 *   @forensic <имя>
 *   EXPLAINS:    какое событие эта улика объясняет
 *   DURABLE-AT:  когда она становится долговечной. `close` · `exit` · `trip-only` ЗАПРЕЩЕНЫ:
 *                улика, долговечная только при штатном конце, не переживает событие.
 *
 * ─── ГРАНИЦЫ, ЧТОБЫ ЛИНТЕР НЕ СТАЛ БЮРОКРАТИЕЙ (риск «в» плана 75) ──────────────────────────────
 *
 * · Срабатывает ТОЛЬКО на явном маркере `@guard`/`@forensic`. Он не угадывает, что такое сторож, и
 *   не ходит по коду с эвристиками — угадывающий линтер краснеет на здоровом коде, а за это уже
 *   заплачено (`bugs/75`, тревога «ЗАМЕРЛО» на здоровом прогоне, третий заход).
 * · Известные нарушения живут в ЗАМОРОЖЕННОМ ДОЛГЕ и сборку не валят; новое нарушение — валит.
 *   Тот же приём, что у осей G1 и G12 сторожа вопросов: область и долг, а не список подавления.
 *
 * @guard guard-lint
 * THREAT:         сторож заводится или закрывается без названной угрозы, зазора доказательства и
 *                 наблюдения на реальном пути — класс `bugs/76`, четыре экземпляра за один вечер
 * PROVED-AGAINST: 100 фикстур в `--selftest` (50 позитивных · 50 негативных) по осям: отсутствие
 *                 поля · пустота · самообман · форма блока · кодировка · запрещённые DURABLE-AT ·
 *                 ЧЕТЫРЕ ИСТОРИЧЕСКИХ экземпляра класса в их реальной форме
 * GAP:            не ловит `GAP: none`, написанный не думая, — это суждение, машине недоступное
 *                 (риск «г» эпика 76, записан как непокрытый). Не ищет сторожей без маркера.
 * ON-REAL-PATH:   NOT YET — врезка в `npm run check` идёт шагом 4.4 плана 75
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
/**
 * ⚠️ ДОЛГ ЛЕЖИТ В ОТСЛЕЖИВАЕМОМ КАТАЛОГЕ, И ЭТО НЕ МЕЛОЧЬ.
 *
 * Первая редакция клала его в `runs/`, а `runs/` под `.gitignore`. Долг, которого нет в git, —
 * не долг, а локальный секрет: у любого клона и у любой свежей сессии замороженное нарушение
 * стало бы НОВЫМ, сборка покраснела бы на здоровом дереве, и сторожа научились бы игнорировать
 * (`bugs/75`, третий заход того же класса). Поймано попыткой закоммитить: `git check-ignore`
 * ответил раньше, чем это дошло бы до чужой машины.
 *
 * Место выбрано по образцу уже работающего долга сторожа вопросов
 * (`interviews/decisions/guard-baseline.json`): рядом с решениями, а не рядом с прогонами —
 * заморозка долга это РЕШЕНИЕ, а не артефакт прогона.
 */
const BASELINE = join(ROOT, 'decisions', 'guard-lint-baseline.json');

/** Поля, обязательные для каждого маркера. Порядок значения не имеет — важно наличие. */
export const REQUIRED = {
  guard: ['THREAT', 'PROVED-AGAINST', 'GAP', 'ON-REAL-PATH'],
  forensic: ['EXPLAINS', 'DURABLE-AT'],
};

/**
 * Значения `DURABLE-AT`, означающие «улика становится долговечной только при штатном конце».
 * Ровно это убило разбор 30 августа: кольцо судьи сбрасывалось на трипе и при закрытии, а зависание
 * не даёт ни того, ни другого.
 */
export const FORBIDDEN_DURABLE = new Set([
  'close', 'on-close', 'at-close', 'exit', 'on-exit', 'at-exit',
  'trip-only', 'on-trip', 'end', 'at-end', 'shutdown', 'teardown', 'finally',
]);

/**
 * Слова, которыми поле заполняют, чтобы линтер отстал. Взяты из стоп-словаря
 * `REQUIREMENTS_FRAMEWORK.md` (плейсхолдеры и отговорки) — там они уже оплачены.
 * ⚠️ `none` СЮДА НЕ ВХОДИТ намеренно: «зазора нет» — законный ответ, но его надо НАПИСАТЬ.
 */
export const EVASIONS = new Set([
  '-', '--', '—', '.', '..', '...', '?', '??', 'n/a', 'na', 'tbd', 'tbs', 'tbr', 'todo', 'fixme',
  'см. выше', 'см выше', 'see above', 'as above', 'выше', 'later', 'потом', 'позже', 'xxx',
]);

const RE_MARKER = /@(guard|forensic)\s+([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/u;
const RE_FIELD = /^([A-Z][A-Z-]{1,30}):\s*(.*)$/u;

/** Снять префиксы комментариев, чтобы блок читался одинаково в `.mjs`, `.md` и `.ps1`. */
function strip(line) {
  return String(line)
    .replace(/^﻿/u, '')
    .replace(/^[\s]*(\/\/+|\/\*+|\*+\/?|#+|>+|--+)\s?/u, '')
    .replace(/\s*\*\/\s*$/u, '')
    .replace(/\r$/u, '')
    .trim();
}

/**
 * Разобрать текст в блоки. Блок начинается маркером и тянется, пока строки несут поля или их
 * продолжения; пустая строка или новый маркер его закрывают.
 *
 * Продолжение поля (строка без `ПОЛЕ:`, но непустая) приписывается ПРЕДЫДУЩЕМУ полю — иначе
 * длинное объяснение угрозы пришлось бы писать в одну строку, а этого никто делать не станет.
 */
export function parseBlocks(text) {
  const lines = String(text).split('\n');
  const blocks = [];
  let cur = null;
  const close = () => { if (cur) blocks.push(cur); cur = null; };

  for (let i = 0; i < lines.length; i++) {
    const raw = strip(lines[i]);
    const m = RE_MARKER.exec(raw);
    if (m) { close(); cur = { kind: m[1], name: m[2], line: i + 1, fields: [], }; continue; }
    if (!cur) continue;
    if (raw === '') { close(); continue; }
    const f = RE_FIELD.exec(raw);
    if (f) { cur.fields.push({ key: f[1], value: f[2].trim(), line: i + 1 }); continue; }
    // Продолжение предыдущего поля.
    if (cur.fields.length) {
      const last = cur.fields[cur.fields.length - 1];
      last.value = `${last.value} ${raw}`.trim();
      continue;
    }
    close();
  }
  close();
  return blocks;
}

/** Проверить один блок. Возвращает список нарушений — по одному на каждую отдельную причину. */
export function checkBlock(block, file = '<memory>') {
  const out = [];
  const add = (rule, why, line = block.line) => out.push({ rule, file, line, name: block.name, kind: block.kind, why });
  const required = REQUIRED[block.kind] || [];
  const seen = new Map();

  for (const f of block.fields) {
    if (seen.has(f.key)) add('R5-duplicate', `поле «${f.key}» объявлено дважды`, f.line);
    else seen.set(f.key, f);
  }

  for (const key of required) {
    const f = seen.get(key);
    if (!f) { add('R1-missing', `нет обязательного поля «${key}»`); continue; }
    const v = f.value.trim();
    if (v === '') { add('R2-empty', `поле «${key}» пустое — «нет зазора» пишется словом, а не пустотой`, f.line); continue; }
    if (EVASIONS.has(v.toLowerCase())) {
      add('R3-evasion', `поле «${key}» заполнено отговоркой «${v}» — это плейсхолдер, а не ответ`, f.line);
    }
  }

  if (block.kind === 'forensic') {
    const d = seen.get('DURABLE-AT');
    if (d && d.value && FORBIDDEN_DURABLE.has(d.value.trim().toLowerCase())) {
      add('R4-late-durable',
        `DURABLE-AT: «${d.value.trim()}» — улика становится долговечной только при штатном конце. `
        + 'Событие, ради которого она существует, штатного конца не даёт (bugs/78)', d.line);
    }
  }

  // 🔴 ПРАВИЛО R6 «голый маркер» СНЯТО 2026-08-30 — его нашла мутация СОБСТВЕННОГО набора, в первый
  // же прогон, и это лучшее доказательство работоспособности механизма, какое можно было получить.
  //
  // Мутация «снять контроль голого маркера» дала НОЛЬ провалов: правило не покрывалось ни одной из
  // 108 фикстур. Причина — оно недостижимо по построению: маркер без полей означает, что все
  // обязательные поля отсутствуют, то есть R1 краснеет четыре раза раньше. R6 был ВТОРОЙ ПРИЧИНОЙ
  // для одного и того же красного — ровно то, против чего написан `bugs/71` («две причины для
  // одного красного расходятся в формулировках и порогах»), и семья [[EXP-0176]] (проверка слепа,
  // когда другая проверка её накрывает).
  //
  // Оставить его означало бы отгрузить правило, которое числится доказанным и не доказано ничем —
  // то есть повторить чинимый класс внутри инструмента, который его чинит.
  return out;
}

/** Проверить целый текст. */
export function checkText(text, file = '<memory>') {
  return parseBlocks(text).flatMap((b) => checkBlock(b, file));
}

// =================================================================================================
// Долг — заморозка известных нарушений (E76-AC5)
// =================================================================================================

/** Ключ нарушения: файл + правило + имя сторожа. НЕ номер строки — правка выше не воскрешает долг. */
export function debtKey(v) {
  return createHash('sha1').update(`${v.file}::${v.rule}::${v.name}`).digest('hex').slice(0, 16);
}

export function readBaseline(path = BASELINE) {
  if (!existsSync(path)) return { frozenAt: null, keys: {} };
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { frozenAt: null, keys: {} }; }
}

export function writeBaseline(violations, { path = BASELINE, at = new Date().toISOString() } = {}) {
  const keys = {};
  for (const v of violations) keys[debtKey(v)] = { file: v.file, rule: v.rule, name: v.name, why: v.why };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ frozenAt: at, keys }, null, 2)}\n`, 'utf8');
  return keys;
}

/** Разложить нарушения на НОВЫЕ (валят сборку) и ДОЛГ (не валит, но и не растёт). */
export function splitByDebt(violations, baseline = readBaseline()) {
  const fresh = [];
  const debt = [];
  for (const v of violations) (baseline.keys && baseline.keys[debtKey(v)] ? debt : fresh).push(v);
  return { fresh, debt };
}

export { BASELINE, ROOT };

// =================================================================================================
// САМОПРОВЕРКА — 100 фикстур: 50 негативных, 50 позитивных (E76-AC1, слово владельца)
// =================================================================================================
//
// «Механизмы, стерегущие класс, должны быть покрыты тестами» — слово владельца 2026-08-30. Линтер
// сам является сторожем, поэтому несёт и свой `@guard`-блок (в шапке), и свой набор.
//
// 🔴 РАЗНООБРАЗИЕ — ТРЕБОВАНИЕ, А НЕ УКРАШЕНИЕ («100 тестов должны быть СИЛЬНО РАЗНООБРАЗНЫМИ,
// чтобы покрывать имплементацию фикса дефекта класса»). Поэтому набор разложен по ОСЯМ, число осей
// печатается в отчёте, и фикстура, не ложащаяся ни на одну ось, в набор не принимается. Пятьдесят
// вариантов одной ошибки — это один тест, повторённый пятьдесят раз.
//
// 🔴 ПОЗИТИВНЫЕ ВАЖНЕЕ НЕГАТИВНЫХ. Ложная тревога здесь = красная сборка на здоровом коде, а за
// это в проекте уже заплачено трижды (`bugs/75`): сторож, кричащий впустую, приучает не смотреть.

const G = (name, ...fields) => [`// @guard ${name}`, ...fields.map((f) => `// ${f}`)].join('\n');
const F = (name, ...fields) => [`// @forensic ${name}`, ...fields.map((f) => `// ${f}`)].join('\n');
const OK4 = [
  'THREAT: машина зависает на спуске',
  'PROVED-AGAINST: убийство процесса на двойнике',
  'GAP: двойник не морозит хост',
  'ON-REAL-PATH: 2026-08-30 живой прогон',
];
const OK2 = ['EXPLAINS: поведение судьи в момент смерти', 'DURABLE-AT: every-second'];

const without = (fields, key) => fields.filter((f) => !f.startsWith(`${key}:`));
const withVal = (fields, key, val) => fields.map((f) => (f.startsWith(`${key}:`) ? `${key}: ${val}` : f));

export function buildFixtures() {
  const neg = [];
  const pos = [];
  const n = (axis, why, text) => neg.push({ axis, why, text });
  const p = (axis, why, text) => pos.push({ axis, why, text });

  // ─ ОСЬ A · нет обязательного поля у @guard (4) ─────────────────────────────────────────────────
  for (const key of REQUIRED.guard) n('A-missing-guard', `нет поля ${key}`, G('g', ...without(OK4, key)));
  // ─ ОСЬ B · нет обязательного поля у @forensic (2) ──────────────────────────────────────────────
  for (const key of REQUIRED.forensic) n('B-missing-forensic', `нет поля ${key}`, F('f', ...without(OK2, key)));
  // ─ ОСЬ C · пустота (6) ─────────────────────────────────────────────────────────────────────────
  for (const key of REQUIRED.guard) n('C-empty', `${key} пусто`, G('g', ...withVal(OK4, key, '')));
  for (const key of REQUIRED.forensic) n('C-empty', `${key} пусто`, F('f', ...withVal(OK2, key, '')));
  // ─ ОСЬ D · самообман в GAP (10) ────────────────────────────────────────────────────────────────
  for (const e of ['-', 'n/a', 'tbd', 'см. выше', '?', '.', 'todo', 'xxx', 'later', 'потом']) {
    n('D-evasion-gap', `GAP = «${e}»`, G('g', ...withVal(OK4, 'GAP', e)));
  }
  // ─ ОСЬ E · дубль поля (2) ──────────────────────────────────────────────────────────────────────
  n('E-duplicate', 'THREAT дважды', G('g', ...OK4, 'THREAT: второй раз'));
  n('E-duplicate', 'GAP дважды', G('g', ...OK4, 'GAP: и ещё раз'));
  // ─ ОСЬ F · маркер без блока (2) — краснеет по R1, и это ПРАВИЛЬНО ─────────────────────────────
  // Фикстуры оставлены: поведение обязано быть красным, даже если правило, которое его ловит, —
  // R1, а не снятый R6. Проверяется ПОВЕДЕНИЕ, а не имя правила.
  n('F-bare-marker', '@guard без полей', '// @guard g\n\n// прочий текст');
  n('F-bare-marker', '@forensic без полей', '// @forensic f\n\n// прочий текст');
  // ─ ОСЬ G · DURABLE-AT из запрещённого набора (11) ──────────────────────────────────────────────
  for (const v of FORBIDDEN_DURABLE) {
    n('G-late-durable', `DURABLE-AT = «${v}»`, F('f', ...withVal(OK2, 'DURABLE-AT', v)));
  }
  // ─ ОСЬ H · регистр запрещённого значения (2) ───────────────────────────────────────────────────
  n('H-case', 'DURABLE-AT: CLOSE заглавными', F('f', ...withVal(OK2, 'DURABLE-AT', 'CLOSE')));
  n('H-case', 'DURABLE-AT: On-Close вперемешку', F('f', ...withVal(OK2, 'DURABLE-AT', 'On-Close')));
  // ─ ОСЬ I · форма блока и переносы строк (3) ────────────────────────────────────────────────────
  n('I-form', 'блок разорван пустой строкой — два поля потеряны',
    ['// @guard g', '// THREAT: есть', '// PROVED-AGAINST: есть', '//', '// GAP: есть', '// ON-REAL-PATH: есть'].join('\n'));
  n('I-form', 'CRLF и нет GAP', G('g', ...without(OK4, 'GAP')).replace(/\n/gu, '\r\n'));
  n('I-form', 'BOM и нет THREAT', `﻿${G('g', ...without(OK4, 'THREAT'))}`);
  // ─ ОСЬ J · самообман в ОСТАЛЬНЫХ полях, не только в GAP (6) ────────────────────────────────────
  n('J-evasion-other', 'THREAT = «tbd»', G('g', ...withVal(OK4, 'THREAT', 'tbd')));
  n('J-evasion-other', 'PROVED-AGAINST = «n/a»', G('g', ...withVal(OK4, 'PROVED-AGAINST', 'n/a')));
  n('J-evasion-other', 'ON-REAL-PATH = «потом»', G('g', ...withVal(OK4, 'ON-REAL-PATH', 'потом')));
  n('J-evasion-other', 'EXPLAINS = «-»', F('f', ...withVal(OK2, 'EXPLAINS', '-')));
  n('J-evasion-other', 'DURABLE-AT = «todo»', F('f', ...withVal(OK2, 'DURABLE-AT', 'todo')));
  n('J-evasion-other', 'THREAT = «...» многоточием', G('g', ...withVal(OK4, 'THREAT', '...')));
  // ─ ОСЬ K · ЧЕТЫРЕ ИСТОРИЧЕСКИХ ЭКЗЕМПЛЯРА (4) — E76-AC3, ГЛАВНЫЙ КРИТЕРИЙ ЭПИКА ────────────────
  // Механизм, не ловящий те случаи, ради которых написан, повторяет чинимый класс: доказан против
  // удобной модели, а не против угрозы. Формы взяты из инцидента `bugs/76`.
  n('K-historic', 'предохранитель: зазор доказательства НЕ НАЗВАН',
    G('fuse-deadman', 'THREAT: зависание машины при спуске',
      'PROVED-AGAINST: убийство процесса горна на двойнике', 'ON-REAL-PATH: NOT YET'));
  n('K-historic', 'кольцо судьи: плёнка долговечна только при трипе',
    F('fuse-ring', 'EXPLAINS: поведение судьи в момент смерти машины', 'DURABLE-AT: trip-only'));
  n('K-historic', 'оракул: угроза не названа, доказан на одном предупреждении',
    G('sampler-pulse', 'PROVED-AGAINST: одно предупреждение на фикстуре',
      'GAP: накопление не проверялось', 'ON-REAL-PATH: NOT YET'));
  n('K-historic', 'сторож шага S2: реального пути не видел',
    G('first-step-governor', 'THREAT: слишком глубокий шаг на спуске',
      'PROVED-AGAINST: первый шаг лестницы, мутация 28', 'GAP: последующие шаги не проверялись'));
  // ─ ОСЬ L · несколько нарушений в одном блоке (2) ───────────────────────────────────────────────
  n('L-multiple', 'нет двух полей сразу', G('g', ...without(without(OK4, 'GAP'), 'THREAT')));
  n('L-multiple', 'пусто И дубль', G('g', ...withVal(OK4, 'GAP', ''), 'GAP: снова'));
  // ─ ОСЬ M · блок среди живого кода (2) ──────────────────────────────────────────────────────────
  n('M-in-context', 'блок в середине файла, нет ON-REAL-PATH',
    `const a = 1;\n${G('g', ...without(OK4, 'ON-REAL-PATH'))}\nexport default a;`);
  n('M-in-context', 'два блока, второй сломан', `${G('a', ...OK4)}\n\n${G('b', ...without(OK4, 'GAP'))}`);

  // ═══ ПОЗИТИВНЫЕ — линтер обязан МОЛЧАТЬ ═══════════════════════════════════════════════════════
  // ─ ОСЬ P1 · стили комментариев (5) ─────────────────────────────────────────────────────────────
  p('P1-style', 'двойной слэш', G('g', ...OK4));
  p('P1-style', 'блочный комментарий', ['/**', ' * @guard g', ...OK4.map((f) => ` * ${f}`), ' */'].join('\n'));
  p('P1-style', 'markdown цитатой', ['> @guard g', ...OK4.map((f) => `> ${f}`)].join('\n'));
  p('P1-style', 'markdown без префикса', ['@guard g', ...OK4].join('\n'));
  p('P1-style', 'решётка (ps1/sh)', ['# @guard g', ...OK4.map((f) => `# ${f}`)].join('\n'));
  // ─ ОСЬ P2 · законные значения (8) ──────────────────────────────────────────────────────────────
  p('P2-value', 'GAP: none — законный ответ, написанный СЛОВОМ', G('g', ...withVal(OK4, 'GAP', 'none')));
  p('P2-value', 'GAP: none с точкой', G('g', ...withVal(OK4, 'GAP', 'none.')));
  p('P2-value', 'ON-REAL-PATH: NOT YET', G('g', ...withVal(OK4, 'ON-REAL-PATH', 'NOT YET')));
  p('P2-value', 'двоеточие внутри значения', G('g', ...withVal(OK4, 'THREAT', 'класс: зависание машины')));
  p('P2-value', '«n/a» ЧАСТЬЮ текста, а не всем значением',
    G('g', ...withVal(OK4, 'GAP', 'поле n/a в отчёте драйвера не заполняется — отдельный предмет')));
  p('P2-value', '«none» частью текста', G('g', ...withVal(OK4, 'GAP', 'none of the twin scenarios freeze the host')));
  p('P2-value', 'очень длинное значение', G('g', ...withVal(OK4, 'THREAT', 'x'.repeat(400))));
  p('P2-value', 'кириллица и эмодзи', G('g', ...withVal(OK4, 'THREAT', '🔴 зависание машины владельца')));
  // ─ ОСЬ P3 · законные DURABLE-AT (6) ────────────────────────────────────────────────────────────
  for (const v of ['every-second', 'immediate', 'per-tick', 'on-write', 'every-100ms', 'append-and-fsync']) {
    p('P3-durable', `DURABLE-AT: ${v}`, F('f', ...withVal(OK2, 'DURABLE-AT', v)));
  }
  // ─ ОСЬ P4 · многострочные поля (4) ─────────────────────────────────────────────────────────────
  p('P4-multiline', 'THREAT переносом', ['// @guard g', '// THREAT: зависание машины,',
    '//   и особенно при глубине более 150 мВ от стока',
    ...without(OK4, 'THREAT').map((f) => `// ${f}`)].join('\n'));
  p('P4-multiline', 'GAP переносом', ['// @guard g', ...without(OK4, 'GAP').map((f) => `// ${f}`),
    '// GAP: двойник не морозит хост,', '//   поэтому класс остаётся недоказанным'].join('\n'));
  p('P4-multiline', 'три строки подряд', ['// @guard g', '// THREAT: а,', '//   б,', '//   в',
    ...without(OK4, 'THREAT').map((f) => `// ${f}`)].join('\n'));
  p('P4-multiline', 'перенос в @forensic', ['// @forensic f', '// EXPLAINS: поведение судьи',
    '//   в момент смерти машины', '// DURABLE-AT: every-second'].join('\n'));
  // ─ ОСЬ P5 · порядок и лишние поля (4) ──────────────────────────────────────────────────────────
  p('P5-order', 'обратный порядок', G('g', ...[...OK4].reverse()));
  p('P5-order', 'перемешанный порядок', G('g', OK4[2], OK4[0], OK4[3], OK4[1]));
  p('P5-extra', 'лишнее необязательное поле', G('g', ...OK4, 'OWNER: агент'));
  p('P5-extra', 'два лишних поля', G('g', ...OK4, 'TICKET: bugs/76', 'SINCE: 2026-08-30'));
  // ─ ОСЬ P6 · имена маркеров (5) ─────────────────────────────────────────────────────────────────
  for (const nm of ['fuse-deadman', 'guard_lint', 'run.dashboard', 'G12a', 'x1']) {
    p('P6-name', `имя «${nm}»`, G(nm, ...OK4));
  }
  // ─ ОСЬ P7 · кодировка и пробелы (4) ────────────────────────────────────────────────────────────
  p('P7-encoding', 'CRLF', G('g', ...OK4).replace(/\n/gu, '\r\n'));
  p('P7-encoding', 'BOM в начале', `﻿${G('g', ...OK4)}`);
  p('P7-encoding', 'хвостовые пробелы', G('g', ...OK4).split('\n').map((l) => `${l}   `).join('\n'));
  p('P7-encoding', 'табуляция после двоеточия', G('g', ...OK4).replace(/: /gu, ':\t'));
  // ─ ОСЬ P8 · соседство блоков (4) ───────────────────────────────────────────────────────────────
  p('P8-neighbours', 'два @guard подряд', `${G('a', ...OK4)}\n\n${G('b', ...OK4)}`);
  p('P8-neighbours', '@guard и @forensic вместе', `${G('a', ...OK4)}\n\n${F('b', ...OK2)}`);
  p('P8-neighbours', 'блок среди кода',
    `const x = 1;\n\n${G('a', ...OK4)}\n\nexport function f() { return x; }`);
  p('P8-neighbours', 'блок в самом конце файла', G('a', ...OK4));
  // ─ ОСЬ P9 · НЕ-маркеры: линтер обязан молчать (7) ──────────────────────────────────────────────
  p('P9-nonmarker', 'файл без маркеров вовсе', 'export function f() { return 1; }');
  p('P9-nonmarker', '@guardian — не наш маркер', '// @guardian angel\n// THREAT: нет');
  p('P9-nonmarker', '@guards во множественном', '// @guards many\n// THREAT: нет');
  p('P9-nonmarker', 'слово guard в прозе', '// этот guard проверяет глубину\n// THREAT: не поле');
  p('P9-nonmarker', '@guard НЕ в конце строки — не маркер', '// @guard g и ещё текст после\n// THREAT: нет');
  p('P9-nonmarker', 'поля-сироты без маркера', '// THREAT: сирота\n// GAP: сирота');
  p('P9-nonmarker', 'почта с собакой', '// пишите на guard@example.com\n// THREAT: не поле');
  // ─ ОСЬ P10 · реальные исправленные формы (3) ───────────────────────────────────────────────────
  p('P10-repaired', 'предохранитель ПОСЛЕ починки — зазор назван',
    G('fuse-deadman', 'THREAT: зависание машины при спуске (bugs/03, bugs/76)',
      'PROVED-AGAINST: убийство процесса горна на двойнике',
      'GAP: двойник не может заморозить свой хост — класс НЕ доказан',
      'ON-REAL-PATH: 2026-08-30 — наблюдён на живом прогоне, трипов 0 (bugs/76)'));
  p('P10-repaired', 'кольцо ПОСЛЕ починки — секундный сброс',
    F('fuse-ring', 'EXPLAINS: поведение судьи в момент смерти машины', 'DURABLE-AT: every-second'));
  p('P10-repaired', 'сторож без зазора — честное none',
    G('encoding-guard', 'THREAT: UTF-8 прочитан как windows-1251, текст испорчен при зелёном коде',
      'PROVED-AGAINST: --selftest-encoding на испорченном файле', 'GAP: none',
      'ON-REAL-PATH: 2026-08-15 поймал третье срабатывание за день (EXP-0067)'));

  return { neg, pos };
}

/**
 * Прогнать все 100 фикстур. Возвращает отчёт; печатает CLI, не эта функция.
 *
 * Отчёт несёт ЧИСЛО ОСЕЙ, а не только число тестов: требование владельца — «сильно разнообразными»,
 * и разнообразие должно быть измеримым, а не заявленным.
 */
export function selftest() {
  const { neg, pos } = buildFixtures();
  const fails = [];
  for (const c of neg) {
    if (!checkText(c.text, `<neg:${c.axis}>`).length) {
      fails.push(`НЕГАТИВНЫЙ ПРОПУЩЕН [${c.axis}] ${c.why}`);
    }
  }
  for (const c of pos) {
    const v = checkText(c.text, `<pos:${c.axis}>`);
    if (v.length) fails.push(`ЛОЖНАЯ ТРЕВОГА [${c.axis}] ${c.why} → ${v.map((x) => x.rule).join(' · ')}`);
  }
  const negAxes = new Set(neg.map((c) => c.axis));
  const posAxes = new Set(pos.map((c) => c.axis));
  const rules = new Set();
  for (const c of neg) for (const v of checkText(c.text)) rules.add(v.rule);
  return {
    neg: neg.length, pos: pos.length, total: neg.length + pos.length,
    negAxes: negAxes.size, posAxes: posAxes.size, rulesCovered: [...rules].sort(), fails,
  };
}

// =================================================================================================
// Обход дерева и командная часть
// =================================================================================================

/** Что смотрим. Каталоги-исключения — не «подавление находок», а места, где кода проекта нет. */
const SCAN_EXT = new Set(['.mjs', '.js', '.md', '.ps1', '.json']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'runs', 'benches', 'logs', '.kaif']);

/**
 * Обойти дерево. Возвращает `{violations, files, markers}` — счётчики ОСМОТРЕННОГО, а не найденного.
 *
 * Первая редакция печатала «файлов с маркерами» по числу файлов В НАРУШЕНИЯХ — то есть на чистом
 * дереве докладывала «осмотрено 0», и по этой строке нельзя было отличить «всё чисто» от «линтер
 * ничего не смотрел». Ровно та же болезнь, что `bugs/56` (доклад «подключилось» без свидетеля):
 * прибор обязан говорить, СКОЛЬКО он проверил, иначе его зелёное ничего не стоит.
 */
export function scanTree(root = ROOT) {
  const out = [];
  const files = new Set();
  let markers = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { walk(full); continue; }
      const dot = name.lastIndexOf('.');
      if (dot < 0 || !SCAN_EXT.has(name.slice(dot))) continue;
      let text = '';
      try { text = readFileSync(full, 'utf8'); } catch { continue; }
      if (!text.includes('@guard') && !text.includes('@forensic')) continue;
      const rel = relative(root, full).split(sep).join('/');
      const blocks = parseBlocks(text);
      if (!blocks.length) continue;
      files.add(rel);
      markers += blocks.length;
      for (const b of blocks) out.push(...checkBlock(b, rel));
    }
  };
  walk(root);
  return { violations: out, files: files.size, markers };
}

function main(argv) {
  if (argv.includes('--selftest')) {
    // Батарея считает зелёные БЛОКИ по строкам `OK` (`tools/selftest-all.mjs` → GREEN_LINE).
    // Без них она напечатала бы «блоков 0», а ноль в сводке читается как «ничего не проверено» —
    // ровно та ложь о собственном покрытии, которую этот механизм и заведён устранять.
    const { neg, pos } = buildFixtures();
    for (const c of neg) {
      const hit = checkText(c.text, `<neg:${c.axis}>`).length > 0;
      console.log(`${hit ? 'OK  ' : 'ПЛОХО'} [-] ${c.axis} · ${c.why}`);
    }
    for (const c of pos) {
      const quiet = checkText(c.text, `<pos:${c.axis}>`).length === 0;
      console.log(`${quiet ? 'OK  ' : 'ПЛОХО'} [+] ${c.axis} · ${c.why}`);
    }
    const r = selftest();
    console.log(`САМОПРОВЕРКА GUARD-LINT: фикстур ${r.total} — негативных ${r.neg}, позитивных ${r.pos}`);
    console.log(`  осей: ${r.negAxes} негативных + ${r.posAxes} позитивных = ${r.negAxes + r.posAxes}`);
    console.log(`  правил покрыто: ${r.rulesCovered.join(' · ')}`);
    if (r.fails.length) {
      console.log(`ПРОВАЛ: ${r.fails.length}`);
      for (const f of r.fails) console.log(`   ✗ ${f}`);
      process.exit(1);
    }
    console.log('ЗЕЛЕНО: ни одного пропущенного нарушения, ни одной ложной тревоги.');
    return;
  }

  const { violations, files, markers } = scanTree();
  if (argv.includes('--freeze')) {
    const keys = writeBaseline(violations);
    console.log(`ДОЛГ ЗАМОРОЖЕН: ${Object.keys(keys).length} нарушени(й) → ${relative(ROOT, BASELINE)}`);
    console.log('Каждая строка долга обязана нести адрес тикета — иначе долг превращается в свалку.');
    return;
  }

  const { fresh, debt } = splitByDebt(violations);
  console.log(`СТОРОЖ УГРОЗ (М1, plans/76): осмотрено маркеров ${markers} в ${files} файл(ах)`);
  console.log(`  новых нарушений: ${fresh.length} · в долге: ${debt.length}`);
  for (const v of fresh) console.log(`  🔴 ${v.file}:${v.line} [${v.rule}] @${v.kind} ${v.name} — ${v.why}`);
  for (const v of debt) console.log(`  🟡 (долг) ${v.file}:${v.line} [${v.rule}] @${v.kind} ${v.name}`);
  if (fresh.length) {
    console.log('');
    console.log('ИТОГ: КРАСНО. Сторож обязан объявить, ПРОТИВ ЧЕГО он доказан (bugs/76, эпик plans/76).');
    process.exit(1);
  }
  console.log('ИТОГ: ЧИСТО.');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('guard-lint.mjs')) {
  main(process.argv.slice(2));
}
