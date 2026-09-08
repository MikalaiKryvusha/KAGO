// help-static-lint.mjs — У ПРИБОРА С КОМАНДНОЙ СТРОКОЙ ОБЯЗАНА БЫТЬ ВЕТКА `--help`.
//
// `bugs/118` AC3. Оплачено 2026-09-08: `polygon.mjs --help` не печатал справку, а ЗАПУСКАЛ пакет из
// пяти виртуальных карт — в блоке входа ветки справки не было вовсе, и любой неизвестный флаг
// проваливался в работу с умолчаниями.
//
// 🔴 ПОЧЕМУ СТАТИКА, А НЕ ПРОГОН. Соседний сторож (`help-guard.mjs`) судит ПРОГОНОМ под таймаутом —
// и для серверов это единственный честный способ: только прогон докажет, что сервер отпустил порт.
// Но в описи класса есть приборы, у которых запуск вместо справки означает ЗАПИСЬ В КАРТУ
// (`vf-step`, `profile-manager`, `nvapi`, `ladder-descent`, `watchdog`, `fuse-rescue-hand`).
// Проверка «отвечает ли на --help» не смеет оказаться записью в GPU. Поэтому здесь — чтение.
//
// @guard help-static
// THREAT:         прибор, у которого `--help` запускает работу вместо описания. Оплачено
//                 2026-09-08 полигоном: пакет из пяти карт, шесть процессов, снято `taskkill /T`
//                 (`bugs/118`)
// PROVED-AGAINST: фикстуры в песочнице — прибор с веткой справки, прибор без неё, прибор без
//                 командной строки вовсе; плюс красный на боевом дереве при подрезанной базе долга
// GAP:            🔴 СТАТИКА ДОКАЗЫВАЕТ, ЧТО ВЕТКА ЕСТЬ, А НЕ ЧТО ОНА СТОИТ ДО РАБОТЫ. Прибор,
//                 у которого `--help` разбирается ПОСЛЕ первой записи, этот сторож пропустит;
//                 доказать порядок чтением, не исполняя, нельзя. Прогонная половина остаётся у
//                 `help-guard.mjs` и покрывает только серверы — по доводу выше. Работа по сужению
//                 зазора: `bugs/118` AC3
// ON-REAL-PATH:   2026-09-08 — боевое дерево прочитано, приборов с командной строкой 82, без ветки
//                 справки 70, все заморожены в базу долга
//
// [TESTED: 2026-09-08 · боевое дерево: 82 прибора с CLI, 70 без справки, заморожены; --selftest
//  6/6 на фикстурах в песочнице, настоящее дерево батареей не читается]
//
// ⚠️ ПЕРВАЯ РЕДАКЦИЯ ЭТИХ ДВУХ ПОЛЕЙ НЕСЛА «77 / 68» — числа прикидочного скрипта, написанные ДО
// прогона прибора. Третий раз за сессию: метка впереди наблюдения. Исправлено по факту.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCANNED_DIRS = Object.freeze(['tools', join('automation-engine', 'lib'), 'automation-engine']);
export const BASELINE = join(ROOT, 'decisions', 'help-static-baseline.json');

/** Есть ли у файла блок входа, то есть является ли он ПРИБОРОМ, а не только библиотекой. */
export function hasEntryBlock(text) {
  return /process\.argv\[1\]/u.test(text) || /isMainThread/u.test(text);
}

/** Есть ли ветка справки. Считается любое упоминание флага в коде — статика строже не докажет. */
export function hasHelpBranch(text) {
  return /'--help'|"--help"|'-h'|"-h"/u.test(text);
}

/** Приборы дерева: файлы с блоком входа. Библиотеки без командной строки не судятся. */
export function listInstruments(dirs = SCANNED_DIRS, root = ROOT) {
  const out = [];
  for (const d of dirs) {
    let files;
    try { files = readdirSync(join(root, d)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.mjs')) continue;
      const rel = join(d, f);
      const text = readFileSync(join(root, rel), 'utf8');
      if (hasEntryBlock(text)) out.push(rel.split('\\').join('/'));
    }
  }
  return out.sort();
}

export function readBaseline(path = BASELINE) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { frozenAt: null, files: [] }; }
}

export function writeBaseline(files, { path = BASELINE, at = new Date().toISOString() } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ frozenAt: at, files: [...files].sort() }, null, 2)}\n`, 'utf8');
}

/** Четыре списка, ни один не выводится из другого — форма `help-guard.mjs`. */
export function judge({ dirs = SCANNED_DIRS, root = ROOT, baseline = readBaseline() } = {}) {
  const instruments = listInstruments(dirs, root);
  const base = new Set(baseline.files ?? []);
  const fresh = []; const debt = []; const stale = [];
  for (const rel of instruments) {
    const has = hasHelpBranch(readFileSync(join(root, rel), 'utf8'));
    if (has && base.has(rel)) stale.push(rel);
    else if (!has) (base.has(rel) ? debt : fresh).push(rel);
  }
  const missing = [...base].filter((f) => !instruments.includes(f));
  return { instruments, fresh, debt, stale, missing };
}

export function verdict(r) {
  return r.fresh.length === 0 && r.stale.length === 0 && r.missing.length === 0 ? 0 : 1;
}

function run(argv) {
  if (argv.includes('--freeze')) {
    const r = judge({ baseline: { files: [] } });
    writeBaseline(r.fresh);
    console.log(`База долга заморожена: ${r.fresh.length} прибор(ов) в ${relative(ROOT, BASELINE)}`);
    return 0;
  }
  const r = judge();
  console.log(`СТОРОЖ СПРАВКИ, СТАТИКА (bugs/118): приборов с командной строкой ${r.instruments.length}`
    + ` · без ветки --help ${r.fresh.length + r.debt.length} · новых ${r.fresh.length} · в долге ${r.debt.length}`);
  for (const f of r.fresh) {
    console.log(`  🔴 НОВОЕ: ${f} — блок входа без ветки справки; форма починки: `
      + "if (argv.includes('--help')) { console.log(…); process.exit(0); } ПЕРВОЙ строкой блока");
  }
  for (const f of r.stale) console.log(`  🔴 БАЗА ВРЁТ: ${f} уже отвечает — снимите его из ${relative(ROOT, BASELINE)}`);
  for (const f of r.missing) console.log(`  🔴 БАЗА ВРЁТ: ${f} в базе, а прибора с таким именем нет`);
  if (r.debt.length && argv.includes('--report')) {
    console.log(`  🟡 долг (${r.debt.length}): ${r.debt.join(' · ')}`);
  }
  return verdict(r);
}

async function selftest() {
  let pass = 0; let fail = 0;
  const ok = (n, c, e = '') => { if (c) { pass += 1; console.log(`  ✅ ${n}`); } else { fail += 1; console.log(`  ❌ ${n}${e ? ` — ${e}` : ''}`); } };
  const os = await import('node:os');

  ok('файл БЕЗ блока входа прибором не считается — библиотеку судить не за что',
    hasEntryBlock('export const x = 1;') === false);
  ok('блок входа узнаётся по argv[1]', hasEntryBlock('if (process.argv[1] && x) {}') === true);
  ok('блок входа узнаётся и по isMainThread', hasEntryBlock('if (isMainThread) {}') === true);
  ok('ветка справки узнаётся', hasHelpBranch("argv.includes('--help')") === true);
  ok('прибор без ветки справки — нарушение', hasHelpBranch("argv.includes('--selftest')") === false);

  // Дерево-фикстура в песочнице: настоящее НЕ читается вовсе (EXP-0025 — фикстура среди боевых
  // файлов это сфабрикованная улика).
  const { mkdtempSync, writeFileSync: wf, mkdirSync: md } = await import('node:fs');
  const sand = mkdtempSync(join(os.tmpdir(), 'help-static-'));
  md(join(sand, 'tools'), { recursive: true });
  wf(join(sand, 'tools', 'good.mjs'), "if (process.argv[1]) { if (argv.includes('--help')) {} }", 'utf8');
  wf(join(sand, 'tools', 'bad.mjs'), 'if (process.argv[1]) { work(); }', 'utf8');
  wf(join(sand, 'tools', 'lib.mjs'), 'export const y = 2;', 'utf8');
  const r = judge({ dirs: ['tools'], root: sand, baseline: { files: [] } });
  ok('на дереве-фикстуре: прибор без справки ловится, со справкой — нет, библиотека не судится',
    r.instruments.length === 2 && r.fresh.length === 1 && r.fresh[0].endsWith('bad.mjs'),
    JSON.stringify(r));

  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Использование: node tools/help-static-lint.mjs [--report] [--freeze] [--selftest]\n'
      + '  без флагов — прочитать дерево и сверить с базой долга\n'
      + '  --report   — вдобавок перечислить приборы, стоящие в долге\n'
      + '  --freeze   — заморозить текущих нарушителей как базу долга\n'
      + '  --selftest — батарея на фикстурах в песочнице; боевое дерево НЕ читается');
    process.exit(0);
  }
  process.exit(argv.includes('--selftest') ? await selftest() : run(argv));
}
