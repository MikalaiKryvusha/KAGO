#!/usr/bin/env node
/**
 * tools/assert-dialect-lint.mjs — ЛИНТЕР КЛАССА `bugs/106`: БЛОК, КОТОРЫЙ НЕ УМЕЕТ КРАСНЕТЬ.
 *
 * ═══ ЧЕМ ЭТО ОПЛАЧЕНО ═══
 *
 * В проекте ДВА законных диалекта помощника `ok`, и оба широко живут:
 *
 *   УСЛОВИЕ   `ok(имя, cond, подробность)`  — второй аргумент ЕСТЬ утверждение;
 *   СРАВНЕНИЕ `ok(имя, got, want)`          — утверждение это РАВЕНСТВО второго и третьего.
 *
 * Строка, написанная диалектом СРАВНЕНИЯ внутри батареи диалекта УСЛОВИЯ, горит зелёным
 * СТРУКТУРНО: непустой массив истинен, число 2 истинно, `true` истинно — чем бы ни кончился
 * прогон. 2026-09-05 такими оказались две строки шага Ш5 в `fuse.mjs`, включая ту, что сама себя
 * называла ГЛАВНОЙ строкой шага; приписанная им мутация М4 покрасить их не могла, и они простояли
 * украшением пять дней. Нашлись не батареей, а тем, кто собрался НА НИХ ОПЕРЕТЬСЯ.
 *
 * ═══ ПОЧЕМУ ПРАВИЛО ИМЕННО ТАКОЕ, А НЕ «ВТОРОЙ АРГУМЕНТ ОБЯЗАН БЫТЬ УСЛОВИЕМ» ═══
 *
 * Второй вариант опробован первым и ОТВЕРГНУТ ЗАМЕРОМ: он даёт 528 срабатываний на 1373 вызова,
 * и почти все ложные — `eq(a, b)`, `.ok`, `.tripped`, `verifyAgainstCard(...).ok` возвращают булево,
 * но «выглядят как факт». Сторож, тонущий в шуме, не читают; это и есть способ завести зелёный,
 * которому никто не верит.
 *
 * Правило ТРЕТЬЕГО аргумента точное: у диалекта УСЛОВИЯ третье место — ПОДРОБНОСТЬ, печатаемая
 * только у красной строки, то есть строка или шаблон. Литерал массива, объекта, числа или
 * `true`/`false` на этом месте — форма ОЖИДАНИЯ, чужая подпись, и она ловит ровно тот класс.
 * Проверено на дереве ДО починки: правило краснит обе настоящие строки и ни одной законной.
 *
 * ОБРАТНОЕ НАПРАВЛЕНИЕ СТОРОЖИТЬ НЕ НАДО, И ЭТО НАЗВАНО: строка диалекта УСЛОВИЯ внутри батареи
 * СРАВНЕНИЯ (`ok('имя', a === b)`) сравнивает `true` с `undefined` и КРАСНЕЕТ ГРОМКО на первом же
 * прогоне. Опасность несимметрична, и сторож ставится там, где отказ молчит.
 *
 * [TESTED: `--selftest` — четыре фикстуры красных и пять зелёных, включая обе настоящие строки
 *  `fuse.mjs` в том виде, в каком они прожили пять дней]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

/** Каталоги батарей. `tools` входит: приборы держат свои наборы там же. */
const SCAN_DIRS = ['automation-engine', path.join('automation-engine', 'lib'), 'tools'];

/**
 * ФОРМА ОЖИДАНИЯ — литерал, а не выражение. Именно литерал делает строку неспособной покраснеть:
 * выражение на третьем месте (например `seen`) — обычная подробность.
 */
const EXPECTED_SHAPE = /^(\[[\s\S]*\]|\{[\s\S]*\}|-?\d+(?:\.\d+)?|true|false)$/u;

/** Подпись помощника в файле. `null` — своего `ok` нет, файл нас не касается. */
export function dialectOf(src) {
  const m = src.match(/const ok = \(([^)]*)\)/u);
  if (!m) return null;
  const params = m[1].replace(/\s+/gu, ' ').trim();
  // Диалект определяется ИМЕНЕМ второго параметра, а не их числом: `(name, cond, detail = '')` и
  // `(name, got, want)` различаются только им, и автор называл его осознанно.
  const second = params.split(',')[1]?.trim().split(/[\s=]/u)[0] ?? '';
  return { params, kind: second === 'cond' ? 'condition' : 'comparison' };
}

/**
 * Аргументы вызова верхнего уровня. Свой разбор, а не регулярное выражение: аргументы содержат
 * вложенные скобки, стрелочные функции и строки со скобками внутри — регулярным выражением это
 * режется неверно и молча.
 */
export function splitArgs(src, openIdx) {
  let depth = 0; const args = []; let cur = ''; let inS = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]; const p = src[i - 1];
    if (inS) { cur += c; if (c === inS && p !== '\\') inS = null; continue; }
    if (c === "'" || c === '"' || c === '`') { inS = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; if (depth === 1 && c === '(') continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { args.push(cur); return args; } }
    if (c === ',' && depth === 1) { args.push(cur); cur = ''; continue; }
    cur += c;
  }
  return null;   // незакрытый вызов — не наше дело, это поймает `node --check`
}

/** Нарушения в ОДНОМ исходнике. Чистая функция — её и накрывают фикстуры. */
export function violationsIn(src) {
  const d = dialectOf(src);
  if (!d || d.kind !== 'condition') return [];
  const out = [];
  const re = /\bok\(/gu; let m;
  while ((m = re.exec(src)) !== null) {
    const args = splitArgs(src, m.index + 2);
    if (!args || args.length < 3) continue;
    const third = args[2].trim();
    if (!EXPECTED_SHAPE.test(third)) continue;
    out.push({
      line: src.slice(0, m.index).split('\n').length,
      third: third.replace(/\s+/gu, ' ').slice(0, 90),
      second: args[1].trim().replace(/\s+/gu, ' ').slice(0, 90),
    });
  }
  return out;
}

function scanFiles() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = path.join(ROOT, d);
    let names = [];
    try { names = readdirSync(abs); } catch { continue; }
    for (const n of names) {
      const f = path.join(abs, n);
      if (!n.endsWith('.mjs')) continue;
      // СЕБЯ ЛИНТЕР НЕ СКАНИРУЕТ, и это не поблажка. Его фикстуры — ТЕ САМЫЕ запрещённые формы,
      // выписанные дословно (иначе они ничего не доказывали бы), поэтому сканирование собственного
      // исходника обвиняло бы его в семи нарушениях за то, что он умеет их называть. Ту же
      // оговорку несёт сторож кодировки (`GUARD_MARK`) и по той же причине. Фикстуры доказаны
      // `--selftest`, а не молчанием: тринадцать блоков, пять из них КРАСНЫЕ по построению.
      if (path.resolve(f) === path.resolve(fileURLToPath(import.meta.url))) continue;
      try { if (!statSync(f).isFile()) continue; } catch { continue; }
      files.push(f);
    }
  }
  return files;
}

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const files = scanFiles();
  let condition = 0; let comparison = 0; let bad = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const d = dialectOf(src);
    if (!d) continue;
    if (d.kind === 'condition') condition += 1; else comparison += 1;
    for (const v of violationsIn(src)) {
      bad += 1;
      console.error(`ЧУЖОЙ ДИАЛЕКТ ok: ${path.relative(ROOT, f)}:${v.line}`);
      console.error(`       подпись файла — ok(${d.params}): второе место это УСЛОВИЕ, третье — ПОДРОБНОСТЬ.`);
      console.error(`       на третьем месте стоит форма ОЖИДАНИЯ: ${v.third}`);
      console.error(`       значит утверждением работает второй аргумент: ${v.second}`);
      console.error('       — а он истинен структурно, и блок не покраснеет НИКОГДА (bugs/106).');
      console.error('       Лечение: сделать второй аргумент УСЛОВИЕМ, измеренное печатать подробностью.');
    }
  }
  console.log(`ДИАЛЕКТ ok (bugs/106): батарей с помощником ${condition + comparison} `
    + `(условие ${condition} · сравнение ${comparison}) · чужих строк ${bad}`);
  return bad === 0 ? 0 : 1;
}

// -------------------------------------------------------------------------------------------------
// САМОПРОВЕРКА — сторож доказывается КРАСНЫМ, иначе он сам того же класса, что и ловит
// -------------------------------------------------------------------------------------------------
function selftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const cond = "const ok = (name, cond, detail = '') => {};\n";
  const comp = 'const ok = (name, got, want) => {};\n';

  console.log('САМОПРОВЕРКА assert-dialect-lint — сторож класса bugs/106; дерево не трогается');

  // ── КРАСНЫЕ: обе настоящие строки `fuse.mjs` в том виде, в каком они прожили пять дней ─────────
  ok('КРАСНО: массив ожидания третьим — та самая строка Ш5 про «пережила срабатывание»',
    violationsIn(`${cond}ok('Ш5 АПВ: защита ПЕРЕЖИЛА срабатывание',\n  [r.trips >= 1, r.rearms >= 1, r.tripped], [true, true, false]);`).length === 1);
  ok('КРАСНО: число ожидания третьим — строка Ш5 про «взведение настоящее»',
    violationsIn(`${cond}ok('Ш5 АПВ: снова срабатывает', r.trips, 2);`).length === 1);
  ok('КРАСНО: `true` третьим — след того же диалекта (найден в curve-store 05.09)',
    violationsIn(`${cond}ok('имя', (() => cond1 && cond2)(), true);`).length === 1);
  ok('КРАСНО: литерал объекта третьим',
    violationsIn(`${cond}ok('имя', state, { healthySeconds: 3 });`).length === 1);
  ok('КРАСНО: отчёт называет и третий аргумент, и второй — читатель видит, ЧТО стало утверждением',
    (() => {
      const v = violationsIn(`${cond}ok('имя', r.trips, 2);`)[0];
      return v.third === '2' && v.second === 'r.trips' && v.line === 2;
    })());

  // ── ЗЕЛЁНЫЕ: всё, что законно, обязано молчать — иначе сторож утонет в шуме ────────────────────
  ok('ЗЕЛЕНО: строка подробности третьим — законная форма диалекта условия',
    violationsIn(`${cond}ok('имя', a === b, 'получено ' + a);`).length === 0);
  ok('ЗЕЛЕНО: шаблон подробности третьим',
    violationsIn(`${cond}ok('имя', a === b, \`получено \${a}\`);`).length === 0);
  ok('ЗЕЛЕНО: переменная подробности третьим — выражение это не литерал ожидания',
    violationsIn(`${cond}ok('имя', a === b, seen);`).length === 0);
  ok('ЗЕЛЕНО: два аргумента — третьего нет вовсе',
    violationsIn(`${cond}ok('имя', a === b);`).length === 0);
  ok('ЗЕЛЕНО: та же строка в батарее диалекта СРАВНЕНИЯ — норма, а не дефект',
    violationsIn(`${comp}ok('имя', r.trips, 2);`).length === 0);
  ok('ЗЕЛЕНО: файл без своего помощника не разбирается вовсе',
    violationsIn("ok('имя', r.trips, 2);").length === 0);
  ok('ЗЕЛЕНО: скобки и запятые ВНУТРИ аргументов не сбивают разбор (стрелка и строка со скобкой)',
    violationsIn(`${cond}ok('имя (с скобкой)', xs.filter((x) => x > 1, 2).length === 0, 'деталь, с запятой');`).length === 0);
  ok('диалект различается по ИМЕНИ второго параметра, а не по их числу',
    dialectOf(cond).kind === 'condition' && dialectOf(comp).kind === 'comparison' && dialectOf('нет помощника') === null);

  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

// СТОРОЖ ВХОДА — линтер исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
