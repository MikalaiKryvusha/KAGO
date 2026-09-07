#!/usr/bin/env node
/**
 * СТОРОЖ СПРАВКИ: КАЖДЫЙ ПРИБОР-СЕРВЕР ОБЯЗАН ОТВЕТИТЬ НА `--help` И ВЫЙТИ САМ.
 *
 * @guard help-guard
 * THREAT:         прибор, который поднимает сервер, на `--help` МОЛЧА НАЧИНАЕТ РАБОТУ: занимает порт,
 *                 открывает окно владельца и держит вызывающего навсегда. Спрашивающий «что ты
 *                 умеешь» получает не ответ, а зависание — и, что хуже, зависание, неотличимое от
 *                 поломки. Оплачено 2026-09-08: `run-dashboard.mjs --help` поднял дашборд на 7311 и
 *                 не вернул управление (код 124 под таймаутом), `review.mjs --help` ушёл кодом 2
 *                 («неизвестный флаг»). Слово владельца в тот же день: *«Моя ошибка — чини. Завтра ты
 *                 опять её допустишь. Она не на тебя должна опираться, а на код»*.
 * PROVED-AGAINST: (а) фикстура-сервер, вешающаяся на `--help`, вне базы → КРАСНО «повис»;
 *                 (б) фикстура, отвечающая кодом 2 → КРАСНО «отказ вместо справки»;
 *                 (в) фикстура, печатающая пустоту кодом 0 → КРАСНО «молчит»;
 *                 (г) та же вешающаяся фикстура В базе → долг, не красно;
 *                 (д) починенная фикстура, оставшаяся в базе → КРАСНО «снять из базы»;
 *                 (е) имя в базе без файла → КРАСНО;
 *                 (ж) фикстура БЕЗ признака сервера не судится вовсе.
 * GAP:            судятся только приборы с ПРИЗНАКОМ СЕРВЕРА (`createServer` или `.listen(` в тексте).
 *                 Это осознанный порез по Парето: именно у сервера цена отсутствия справки —
 *                 ЗАВИСАНИЕ, а не сообщение об ошибке. Прибор, который блокирует иначе (ждёт ввода,
 *                 спит), сюда не попадёт. Второй зазор: «без побочных действий» проверяется тем, что
 *                 процесс ВЫШЕЛ САМ до таймаута и кодом 0 — занятый и сразу отпущенный ресурс сторож
 *                 не увидит.
 * ON-REAL-PATH:   2026-09-08 — в воротах `npm run check`, прогоном по настоящему дереву.
 *
 * Форма — по образцу `tools/entry-guard-lint.mjs`: замороженный долг это РЕШЕНИЕ, новые нарушения
 * валят сборку, старые не растут, починенный прибор ОБЯЗАН быть снят из базы (иначе база врёт).
 * Отличие одно и оно существенное: этот сторож судит ПРОГОНОМ, а не чтением текста. Признак справки,
 * вычитанный из исходника, был бы ровно той же ложью, что и «ветка написана, но стоит не первой».
 *
 *   node tools/help-guard.mjs             # судить дерево прогоном (код 1 на новом нарушении)
 *   node tools/help-guard.mjs --freeze    # заморозить ТЕКУЩИЙ долг в базу
 *   node tools/help-guard.mjs --selftest  # доказать сторож на фикстурах в песочнице
 *
 * GPU WRITES: NONE. Запускает приборы с `--help` и читает их вывод.
 *
 * [TESTED: 2026-09-08 · --selftest на mkdtemp-фикстурах, все семь классов выше; живой прогон по
 *  дереву: 2 сервера, оба отвечают кодом 0 и выходят сами]
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'decisions', 'help-guard-baseline.json');

/** Где живут приборы. Оба каталога, потому что один из двух серверов лежит НЕ в `tools/`. */
export const SCANNED_DIRS = Object.freeze(['tools', join('automation-engine', 'lib')]);

/** Сколько ждать ответа. Щедро: медленная машина не должна давать ложное «повис». */
export const HELP_TIMEOUT_MS = 15_000;

/** Признак сервера — чистая функция над текстом. Ровно тот класс, где цена молчания это зависание. */
export function raisesServer(src) {
  return src.includes('createServer') || src.includes('.listen(');
}

/** Все приборы каталогов — `.mjs`, без временных копий голденов (`_g_*`). Пути от корня проекта. */
export function listInstruments(dirs = SCANNED_DIRS, root = ROOT) {
  const out = [];
  for (const d of dirs) {
    const abs = join(root, d);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs).filter((x) => x.endsWith('.mjs') && !x.startsWith('_g_')).sort()) {
      out.push(join(d, f).replace(/\\/g, '/'));
    }
  }
  return out;
}

/**
 * САМ СТОРОЖ ОСВОБОЖДЁН — И ЭТО НЕ ПОБЛАЖКА, А ПОЧИНКА ВРУЩЕГО СЧЁТА.
 *
 * Признак сервера текстовый, а фикстуры этого файла ОБЯЗАНЫ содержать `createServer` и `.listen(` —
 * иначе им нечего изображать. Без освобождения сторож считал себя третьим сервером проекта и печатал
 * «серверов 3» там, где их два. Он бы прошёл (справку он даёт), но счёт, который врёт, здесь чинят:
 * читатель верит именно счёту. Тот же приём, что у сторожа кодировки в `check.mjs` («сам сторож
 * освобождён меткой»). Освобождение — ПО ИМЕНИ, ровно одно: дырой на будущее оно не станет.
 */
export const SELF = 'tools/help-guard.mjs';

/** Приборы-СЕРВЕРЫ — только они судятся. */
export function listServers(dirs = SCANNED_DIRS, root = ROOT) {
  return listInstruments(dirs, root)
    .filter((rel) => rel !== SELF)
    .filter((rel) => raisesServer(readFileSync(join(root, rel), 'utf8')));
}

/**
 * ПРОГОН ОДНОГО ПРИБОРА С `--help`. Единственный источник вердикта — что процесс СДЕЛАЛ.
 *
 * Возвращает `{ ok, code, timedOut, printed, why }`. Хорошо ровно одно: вышел сам, кодом 0, и
 * что-то напечатал. Всё остальное — названная причина, а не «не прошло».
 */
export function probeHelp(relPath, { root = ROOT, timeoutMs = HELP_TIMEOUT_MS } = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [relPath, '--help'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    child.on('error', () => {
      clearTimeout(timer);
      done({ ok: false, code: null, timedOut: false, printed: 0, why: 'прибор не запустился' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const printed = out.trim().length;
      if (timedOut) {
        done({ ok: false, code: null, timedOut: true, printed, why: `ПОВИС: не вышел за ${timeoutMs / 1000} с — на --help начал работу` });
        return;
      }
      if (code !== 0) { done({ ok: false, code, timedOut: false, printed, why: `отказ вместо справки: код ${code}` }); return; }
      if (printed === 0) { done({ ok: false, code, timedOut: false, printed, why: 'вышел кодом 0, но не напечатал ничего' }); return; }
      done({ ok: true, code, timedOut: false, printed, why: '' });
    });
  });
}

export function readBaseline(path = BASELINE) {
  if (!existsSync(path)) return { frozenAt: null, files: [] };
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { frozenAt: null, files: [] }; }
}

export function writeBaseline(files, { path = BASELINE, at = new Date().toISOString() } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ frozenAt: at, files: [...files].sort() }, null, 2)}\n`, 'utf8');
}

/**
 * Суд над деревом. Четыре списка, ни один не выводится из другого:
 *   fresh   — не отвечает и НЕ в базе → валит сборку;
 *   debt    — не отвечает и в базе → терпится, но должен убывать;
 *   stale   — в базе, но отвечает → валит сборку: базу обязаны подрезать;
 *   missing — в базе, но прибора нет (или он перестал быть сервером) → валит сборку.
 */
export async function judge({ dirs = SCANNED_DIRS, root = ROOT, baseline = readBaseline(), timeoutMs = HELP_TIMEOUT_MS } = {}) {
  const servers = listServers(dirs, root);
  const base = new Set(baseline.files ?? []);
  const fresh = []; const debt = []; const stale = []; const probes = {};
  for (const rel of servers) {
    const r = await probeHelp(rel, { root, timeoutMs });
    probes[rel] = r;
    if (r.ok && base.has(rel)) stale.push(rel);
    else if (!r.ok) (base.has(rel) ? debt : fresh).push(rel);
  }
  const missing = [...base].filter((f) => !servers.includes(f));
  return { servers, fresh, debt, stale, missing, probes };
}

function report(r, baselinePath) {
  const lines = [];
  lines.push(`СТОРОЖ СПРАВКИ (долг сессии 88): серверов ${r.servers.length} · не отвечают на --help ${r.fresh.length + r.debt.length} · в долге ${r.debt.length}`);
  for (const f of r.fresh) lines.push(`  🔴 НОВОЕ: ${f} — ${r.probes[f]?.why}; форма починки: ветка --help ПЕРВОЙ в main(), печать и код 0`);
  for (const f of r.stale) lines.push(`  🔴 БАЗА ВРЁТ: ${f} уже отвечает — снимите его из ${relative(ROOT, baselinePath)}`);
  for (const f of r.missing) lines.push(`  🔴 БАЗА ВРЁТ: ${f} в базе, а сервера с таким именем нет — снимите его из ${relative(ROOT, baselinePath)}`);
  for (const f of r.debt) lines.push(`  🟡 долг: ${f} — ${r.probes[f]?.why}`);
  return lines.join('\n');
}

/** Код выхода: красно на новом нарушении и на лгущей базе; долг не краснит. */
export function verdict(r) {
  return r.fresh.length === 0 && r.stale.length === 0 && r.missing.length === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------------------------
// Самопроверка — на фикстурах в песочнице `mkdtemp`. Настоящее дерево не читается вовсе.
// ---------------------------------------------------------------------------------------------

const FIX = {
  // Отвечает как надо: справка первой веткой, код 0.
  good: "import { createServer } from 'node:http';\n"
    + "if (process.argv.includes('--help')) { console.log('справка'); process.exit(0); }\n"
    + "createServer(() => {}).listen(0);\n",
  // Вешается: на --help поднимает сервер и не выходит — тот самый оплаченный класс.
  hangs: "import { createServer } from 'node:http';\n"
    + "createServer(() => {}).listen(0);\nsetInterval(() => {}, 1000);\n",
  // Отказывает кодом 2 — «неизвестный флаг», форма `review.mjs` до починки.
  refuses: "import { createServer } from 'node:http';\n"
    + "console.log('ОШИБКА: неизвестный флаг: --help'); process.exit(2);\n",
  // Выходит кодом 0, но молчит: «ответ», из которого ничего не узнать.
  silent: "import { createServer } from 'node:http';\nprocess.exit(0);\n",
  // Не сервер вовсе — не должен судиться, даже будучи молчаливым.
  notServer: "process.exit(3);\n",
};

async function selfTest() {
  const blocks = [];
  const check = (name, ok, detail = '') => blocks.push({ name, ok, detail });
  const root = mkdtempSync(join(tmpdir(), 'kago-help-guard-'));
  try {
    const dir = 'box';
    mkdirSync(join(root, dir), { recursive: true });
    const put = (n, src) => writeFileSync(join(root, dir, n), src);
    put('a-good.mjs', FIX.good);
    put('b-hangs.mjs', FIX.hangs);
    put('c-refuses.mjs', FIX.refuses);
    put('d-silent.mjs', FIX.silent);
    put('e-debt.mjs', FIX.hangs);
    put('f-fixed.mjs', FIX.good);
    put('g-plain.mjs', FIX.notServer);
    put('_g_copy.mjs', FIX.hangs);
    const baseline = { frozenAt: 'x', files: ['box/e-debt.mjs', 'box/f-fixed.mjs', 'box/h-gone.mjs'] };
    // Короткий таймаут: фикстура «вешается» доказывается за секунду, а не за пятнадцать.
    const r = await judge({ dirs: [dir], root, baseline, timeoutMs: 1500 });

    check('(а) сервер вешается на --help и вне базы → НОВОЕ нарушение, причина названа «ПОВИС»',
      r.fresh.includes('box/b-hangs.mjs') && /ПОВИС/u.test(r.probes['box/b-hangs.mjs'].why),
      JSON.stringify(r.probes['box/b-hangs.mjs']));
    check('(б) отказ кодом 2 — тоже нарушение, и оно ОТЛИЧЕНО от зависания',
      r.fresh.includes('box/c-refuses.mjs') && r.probes['box/c-refuses.mjs'].code === 2
        && !r.probes['box/c-refuses.mjs'].timedOut,
      JSON.stringify(r.probes['box/c-refuses.mjs']));
    check('(в) код 0 без единой буквы — «ответ», из которого ничего не узнать: нарушение',
      r.fresh.includes('box/d-silent.mjs') && r.probes['box/d-silent.mjs'].printed === 0,
      JSON.stringify(r.probes['box/d-silent.mjs']));
    check('(г) то же зависание, но в базе → долг, не нарушение',
      r.debt.length === 1 && r.debt[0] === 'box/e-debt.mjs', JSON.stringify(r.debt));
    check('(д) починенный, но оставшийся в базе → база врёт',
      r.stale.length === 1 && r.stale[0] === 'box/f-fixed.mjs', JSON.stringify(r.stale));
    check('(е) имя в базе без сервера → база врёт',
      r.missing.length === 1 && r.missing[0] === 'box/h-gone.mjs', JSON.stringify(r.missing));
    check('(ж) НЕ сервер не судится вовсе — даже молча выходя кодом 3',
      !r.servers.includes('box/g-plain.mjs') && !('box/g-plain.mjs' in r.probes), JSON.stringify(r.servers));
    check('отвечающий сервер молчит во всех трёх списках',
      !r.fresh.includes('box/a-good.mjs') && !r.debt.includes('box/a-good.mjs') && !r.stale.includes('box/a-good.mjs'));
    check('копия голдена `_g_*` — не прибор', !r.servers.includes('box/_g_copy.mjs'), JSON.stringify(r.servers));
    check('вердикт: любое из (а)(д)(е) → код 1; один долг → код 0',
      verdict(r) === 1 && verdict({ fresh: [], stale: [], missing: [], debt: ['x'] }) === 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  for (const b of blocks) console.log(`  ${b.ok ? 'OK  ' : 'ПЛОХО'} ${b.name}${b.ok ? '' : ` — ${b.detail}`}`);
  const failed = blocks.filter((b) => !b.ok).length;
  console.log(`\nСАМОПРОВЕРКА СТОРОЖА СПРАВКИ: ${blocks.length} блоков, провалов ${failed}. Настоящее дерево не читалось.`);
  return failed === 0 ? 0 : 1;
}

async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Использование: node tools/help-guard.mjs [--selftest|--freeze]');
    console.log('  Судит ПРОГОНОМ: каждый прибор-сервер обязан ответить на --help и выйти сам, кодом 0.');
    console.log('  --selftest  доказать сторож на фикстурах в песочнице');
    console.log('  --freeze    заморозить текущий долг в decisions/help-guard-baseline.json');
    return 0;
  }
  if (argv.includes('--selftest')) return selfTest();
  if (argv.includes('--freeze')) {
    const r = await judge({ baseline: { files: [] } });
    writeBaseline(r.fresh);
    console.log(`ДОЛГ ЗАМОРОЖЕН: ${r.fresh.length} прибор(ов) → ${relative(ROOT, BASELINE)}. Он может только убывать.`);
    return 0;
  }
  const r = await judge();
  console.log(report(r, BASELINE));
  return verdict(r);
}

// СТОРОЖ ВХОДА — линтер исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
