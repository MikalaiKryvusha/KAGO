#!/usr/bin/env node
// tools/prayer.mjs — ОДНА МОЛИТВА, РАЗЛОЖЕННАЯ ПО ВСЕМУ КАНОНУ, И ОНА НЕ МОЖЕТ РАЗОЙТИСЬ.
//
// ─── ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ, СЛОВАМИ ВЛАДЕЛЬЦА ───────────────────────────────────────────────
//
// Он сказал это 2026-08-24 23:0x, сразу после того, как поймал агента на строительстве лесов:
//
//   > *«давай поднимем принципы из ФИЛОСОФИИ на уровень молитвы перед началом любой работы.
//   > Перечислим их молитвой вверху всех канон документов KAIF с просьбой тебя политву озвучить
//   > перед каждой работой»*
//
// ─── ПОЧЕМУ ЭТО ИНСТРУМЕНТ, А НЕ ШЕСТНАДЦАТЬ КОПИЙ, ПОСТАВЛЕННЫХ РУКАМИ ─────────────────────────
//
// Требование владельца — молитва ВВЕРХУ КАЖДОГО канон-документа. Требование проекта (DRY) — один
// факт живёт в одном месте. Они мирятся ровно так: текст живёт ОДИН РАЗ, в `PHILOSOPHY.md` между
// метками, а сюда он РАСКЛАДЫВАЕТСЯ. Копии, поставленные руками, разошлись бы на первой же правке —
// это тот класс, за который проект уже платил (`AGENT_GUIDE.md` → реестр пар «истина↔зеркало»).
// Здесь пару не сторожат, а УБИРАЮТ: источник один, а `--check` в воротах сборки не даёт копии
// разъехаться молча.
//
// GPU WRITES: none. Пишет только markdown-файлы канона в корне репозитория.
//
// Usage:
//   node tools/prayer.mjs            сверить копии с источником (это делает `npm run check`)
//   node tools/prayer.mjs --apply    разложить источник по всем канон-документам
//   node tools/prayer.mjs --say      напечатать молитву (её агент произносит перед работой)
//
// [NOT-TESTED] при рождении — блоки в `--selftest` это переворачивают.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

export const BEGIN = '<!-- KAIF:PRAYER:BEGIN — ОДИН ИСТОЧНИК: PHILOSOPHY.md. Правится там, раскладывается `node tools/prayer.mjs --apply` -->';
export const END = '<!-- KAIF:PRAYER:END -->';

/** ИСТОЧНИК — `PHILOSOPHY.md`. Единственный файл, где молитву правят руками. */
export const SOURCE = 'PHILOSOPHY.md';

/**
 * КУДА МОЛИТВА КЛАДЁТСЯ.
 *
 * Ярусы 1 и 2 таксономии документов (`AGENT_GUIDE.md` → Document taxonomy) — то, ИЗ ЧЕГО агент
 * работает. `PROJECT_HISTORY.md` намеренно НЕ здесь, и это не исключение, а то же самое правило,
 * которым он исключён из `/resume`: хроника — прошлое проекта, а не его сейчас, и работы из неё не
 * начинают.
 */
export const CANON = Object.freeze([
  'PHILOSOPHY.md',
  'AGENT_GUIDE.md',
  'STATUS.md',
  'GOAL.md',
  'MASTER_PLAN.md',
  'REQUIREMENTS_FRAMEWORK.md',
  'TESTING_FRAMEWORK.md',
  'BUG_FIXING_FRAMEWORK.md',
  'PROJECT_STRUCTURE_EXTERNAL_MAP.md',
  'PROJECT_ARCHITECTURE_INTERNAL_MAP.md',
  'KAIF_FRAMEWORK.md',
  'EXPERIENCE.md',
]);

/** Вырезать блок молитвы из текста файла. `null` — блока нет. */
export function extract(text) {
  const a = text.indexOf(BEGIN);
  if (a < 0) return null;
  const b = text.indexOf(END, a);
  if (b < 0) return null;
  return text.slice(a, b + END.length);
}

/**
 * Вставить блок в начало документа: сразу ПОСЛЕ заголовка H1, если он есть, иначе в самое начало.
 * После H1 — потому что первая строка markdown-документа это его имя, и молитва не должна его
 * заслонять в списках и предпросмотрах.
 */
export function place(text, block) {
  const had = extract(text);
  if (had !== null) return text.replace(had, block);
  const lines = text.split('\n');
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  const at = h1 < 0 ? 0 : h1 + 1;
  lines.splice(at, 0, '', block);
  return lines.join('\n');
}

/** Сверить все копии с источником. @returns {{ok:boolean, source:string|null, drifted:string[], missing:string[]}} */
export function check({ root = ROOT, read = (p) => readFileSync(p, 'utf8'), exists = existsSync } = {}) {
  const srcPath = join(root, SOURCE);
  if (!exists(srcPath)) return { ok: false, source: null, drifted: [], missing: [SOURCE] };
  const source = extract(read(srcPath));
  if (source === null) return { ok: false, source: null, drifted: [], missing: [SOURCE] };
  const drifted = [];
  const missing = [];
  for (const name of CANON) {
    const p = join(root, name);
    if (!exists(p)) { missing.push(name); continue; }
    const got = extract(read(p));
    if (got === null) missing.push(name);
    else if (got !== source) drifted.push(name);
  }
  return { ok: drifted.length === 0 && missing.length === 0, source, drifted, missing };
}

/** Разложить источник по канону. @returns {string[]} файлы, которые изменились */
export function apply({ root = ROOT } = {}) {
  const source = extract(readFileSync(join(root, SOURCE), 'utf8'));
  if (source === null) throw new Error(`в ${SOURCE} нет блока молитвы между метками — источника не существует`);
  const changed = [];
  for (const name of CANON) {
    const p = join(root, name);
    if (!existsSync(p)) continue;
    const before = readFileSync(p, 'utf8');
    const after = place(before, source);
    if (after !== before) { writeFileSync(p, after, 'utf8'); changed.push(name); }
  }
  return changed;
}

/** Самопроверка: логика на подставном чтении, без единого файла проекта. */
export function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  const block = `${BEGIN}\nмолитва\n${END}`;
  // — вставка идёт ПОСЛЕ H1, а не перед ним: имя документа остаётся первой строкой
  ok('блок встаёт ПОСЛЕ заголовка, а не поверх него',
    place('# Документ\n\nтело\n', block).split('\n').slice(0, 4), ['# Документ', '', block.split('\n')[0], 'молитва']);
  // — повторное наложение ЗАМЕНЯЕТ блок, а не плодит второй: иначе `--apply` рос бы с каждым вызовом
  const once = place('# Д\n\nтело\n', block);
  ok('повторное наложение заменяет блок, а не добавляет второй',
    (place(once, block).match(new RegExp(BEGIN.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length, 1);
  // — и правка ИСТОЧНИКА доезжает до копии: ради этого инструмент и существует
  ok('правка источника доезжает до копии',
    extract(place(once, `${BEGIN}\nдругая молитва\n${END}`)), `${BEGIN}\nдругая молитва\n${END}`);
  // — РАСХОЖДЕНИЕ НАЗЫВАЕТСЯ. Сторож, который молчит о разъехавшейся копии, хуже снятого.
  const files = { 'PHILOSOPHY.md': `# Ф\n${block}\n`, 'AGENT_GUIDE.md': `# А\n${BEGIN}\nстарая\n${END}\n`, 'STATUS.md': '# С\nбез блока\n' };
  const fake = {
    root: '', exists: (p) => p.replace(/^[\\/]/, '') in files,
    read: (p) => files[p.replace(/^[\\/]/, '')],
  };
  const r = check(fake);
  ok('РАСХОЖДЕНИЕ И ПРОПАЖА НАЗЫВАЮТСЯ ПОИМЁННО, а не сводятся к «что-то не так»',
    [r.ok, r.drifted, r.missing.includes('STATUS.md')], [false, ['AGENT_GUIDE.md'], true]);
  // — и совпадение действительно ЗЕЛЕНОЕ, иначе сторож краснел бы всегда и был бы снят
  files['AGENT_GUIDE.md'] = `# А\n${block}\n`;
  files['STATUS.md'] = `# С\n${block}\n`;
  const only3 = { ...fake, exists: (p) => p.replace(/^[\\/]/, '') in files };
  const saved = CANON.slice();
  ok('совпавшие копии дают ЗЕЛЁНЫЙ — сторож различает, а не краснеет всегда',
    check({ ...only3 }).drifted, []);
  ok('и список канона не пуст — пустой скан зеленел бы по построению', saved.length > 0, true);

  return { ok: results.every((x) => x.ok), results };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    const r = selfTest();
    for (const x of r.results) {
      console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok ? '' : `  -> получено ${JSON.stringify(x.got)}, ждали ${JSON.stringify(x.want)}`}`);
    }
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА: есть расхождения.');
    process.exit(r.ok ? 0 : 1);
  } else if (args.includes('--say')) {
    const src = extract(readFileSync(join(ROOT, SOURCE), 'utf8'));
    console.log(src === null ? `в ${SOURCE} нет блока молитвы` : src.replace(BEGIN, '').replace(END, '').trim());
  } else if (args.includes('--apply')) {
    const changed = apply();
    console.log(changed.length
      ? `молитва разложена: изменено файлов ${changed.length} — ${changed.join(', ')}`
      : 'молитва уже стоит везде и совпадает с источником — менять нечего');
  } else {
    const r = check();
    if (r.ok) {
      console.log(`молитва: ${CANON.length} канон-документов, все копии совпадают с ${SOURCE}`);
      process.exit(0);
    }
    if (r.drifted.length) console.error(`МОЛИТВА РАЗОШЛАСЬ с ${SOURCE} в ${r.drifted.length} файл(ах): ${r.drifted.join(', ')}`);
    if (r.missing.length) console.error(`МОЛИТВЫ НЕТ ВОВСЕ в ${r.missing.length} файл(ах): ${r.missing.join(', ')}`);
    console.error('лечение: node tools/prayer.mjs --apply (правится ТОЛЬКО в PHILOSOPHY.md)');
    process.exit(1);
  }
}

export default { BEGIN, END, SOURCE, CANON, extract, place, check, apply, selfTest };
