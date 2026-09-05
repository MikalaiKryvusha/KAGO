#!/usr/bin/env node
// tools/check.mjs — KAGO's build gate.
//
// KAGO is plain Node.js ES modules: there is nothing to compile, bundle or transpile. What a build
// step would have caught — a file that is not valid JavaScript — is caught here instead, by parsing
// every .mjs in the tree without executing it. Cheap, deterministic, and it grows with the project.
//
// Usage:  npm run check        (this is <BUILD_COMMAND> for the framework's purposes)
// Exit:   0 = every file parses · 1 = at least one file failed to parse
// [TESTED: 2026-08-09 · `npm run check` → "checked 2 .mjs file(s), 0 failed", exit 0. The count was 3
//  before verify-final removed the installer's KAIF-LOADER.mjs from the root — the file count tracks
//  the tree, so re-read it rather than expecting this number.]

// ─── ПОЧЕМУ У ЭТИХ ВОРОТ ЕСТЬ СТОРОЖ ВХОДА (`bugs/95`) ────────────────────────────────────────────
//
// Модуль ES исполняется ПРИ ИМПОРТЕ целиком. До 2026-09-01 весь код ниже стоял на верхнем уровне,
// поэтому `import('tools/check.mjs')` откуда угодно означал: прогнать ворота сборки, спаунить три
// подпроцесса, прочитать полторы тысячи файлов — и вызвать `process.exit`, убив импортирующего.
// Хуже: `process.argv` принадлежит ВЫЗЫВАЮЩЕМУ, так что чужой `--selftest-encoding` уводил ворота
// в ветку самопроверки.
//
// Дефект наказывал ровно за то поведение, которого требует канон: сессия, попробовавшая
// ПЕРЕИСПОЛЬЗОВАТЬ разбор вместо копии (DRY), получала непонятный обвал и делала естественный, но
// неверный вывод «импортировать нельзя» — то есть писала копию. Класс закрывается формой: работа
// живёт в `main()`, а `main()` зовётся только когда файл запущен КАК ПРОГРАММА.
//
// Образец взят из проекта, а не изобретён: `fuse.mjs` → `isMainThread && resolve(argv[1]) === здесь`.
// Здесь хватает половины — воркеров у ворот нет.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();

// Directories that hold no KAGO source: the framework's own machinery, deps, and VCS metadata.
const SKIP = new Set(['node_modules', '.git', '.kaif', '.claude', '.agents', '.grok', '.cline', '.roo']);

/** Walk the tree and collect every .mjs file that belongs to the project itself. */
function collect(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, found);
    else if (entry.endsWith('.mjs')) found.push(full);
  }
  return found;
}

/** Parse every collected .mjs without executing it. Returns how many failed. */
function parseGate(files) {
  let failed = 0;
  for (const file of files) {
    // `node --check` parses the file and reports syntax errors without running a line of it.
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) {
      failed++;
      console.error('FAIL ' + relative(ROOT, file));
      if (r.stderr) console.error(r.stderr.trim());
    }
  }
  return failed;
}

// ─── THE ENCODING-CORRUPTION GATE — a lesson that repeated, so it stopped being a lesson ─────────
//
// THE TERM IS «ПОРЧА КОДИРОВКИ», AND IT WAS SETTLED BY THE OWNER (chat, 2026-08-15). The agent had
// printed «мохибейк» — a transliteration of the Japanese term used in English documentation — in this
// tool's output, in `STATUS.md` and in a commit message, and the owner had to ask what it meant. He
// offered the colloquial Russian «абракадабра» and then ruled it out himself: *«мы тут не прозу
// пишем, а серьёзный инструмент, и пользуемся академическим и научным языком»*. So the diagnostic
// says exactly what happened, in the register of an instrument: ПОРЧА КОДИРОВКИ.
//
// Two rules met here, and both were already written down: the storefront rule that an internal word
// expands into a human name (`AGENT_GUIDE.md` → the storefront, item 6), and the owner's register
// (`AGENT_GUIDE.md` → Notes from the human). Identifiers stay English — code is read by the agent;
// the OUTPUT is the owner's language, in his register.
//
// EXP-0067 (text through the shell instead of through the file tools) was written on 2026-08-15 and
// VIOLATED THE SAME DAY, by the session that wrote it: a `Get-Content | Set-Content` pass over
// `seam-contract.mjs` read UTF-8 as the machine's ANSI codepage and wrote every Cyrillic character
// back as mojibake. The file still parsed, `node --check` stayed green, and only reading the result
// showed it. The canon's rule for a second strike is explicit (`EXPERIENCE.md` header): two strikes →
// a mechanism, never a third reminder. This is the mechanism.
//
// WHY THESE MARKERS. Reading UTF-8 Cyrillic as cp1251 produces a small, fixed vocabulary of
// two-character sequences that CANNOT occur in correct Russian, English or code — `Рµ`, `С‚`, `вЂ`,
// `в†’`. Matching those is precise: a false positive would need a file to contain a Cyrillic capital
// followed by another Cyrillic letter with no vowel pattern, which real words do not do. The guard is
// proved red by `--selftest-encoding`, per EXP-0008: a check that has never failed proves nothing.
const MOJIBAKE = ['Рµ', 'Р°', 'Рѕ', 'С‚', 'вЂ', 'в†', 'РЅ', 'Рё'];
const TEXT_EXT = ['.mjs', '.json', '.md', '.ps1', '.cu'];

// TWO MARKERS WERE DROPPED BY THIS GUARD'S OWN FIRST RUN, which is exactly what a first run is for:
//   · Cyrillic ER followed by a closing guillemet — that is the LETTER Р quoted, «Р», and it fired on
//     the owner's stylometry portrait, a document that discusses letters. A guard that reddens on
//     correct text is a guard someone switches off.
//   · a bare Cyrillic ES — a common letter that had no business on a list of two-character sequences.
// What remains cannot occur in Russian, English or code: a Cyrillic capital followed by a symbol no
// word puts there.
//
// AND THIS FILE EXEMPTS ITSELF, because it necessarily contains every marker it hunts. The exemption
// is a mark INSIDE the file rather than its path — the same reason the bench's guard uses one: a copy
// or a rename keeps it.
// KAGO-MOJIBAKE-GUARD — the mark itself, spelled out. Building it from pieces would have been clever
// and wrong: the exemption works by the file CONTAINING the literal, so a split constant exempts
// nothing. Caught by the first run after adding it.
const GUARD_MARK = 'KAGO-MOJIBAKE-GUARD';

function collectText(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectText(full, found);
    else if (TEXT_EXT.some((e) => entry.endsWith(e))) found.push(full);
  }
  return found;
}

/** Returns the markers found in `text`, or an empty array. Exported shape so the selftest can drive it. */
function mojibakeIn(text) {
  return MOJIBAKE.filter((m) => text.includes(m));
}

/** The guard proved RED before its green is trusted (EXP-0008). Returns the exit code. */
function selftestEncoding() {
  // The sample is built here rather than stored as a fixture, because a mojibake fixture on disk is a
  // file every future tool must be told to ignore.
  const broken = 'РљРћРќРўР РђРљРў: Р¶РёРІР°СЏ РєРѕР»РѕРЅРєР°';
  const clean = 'КОНТРАКТ: живая колонка — обычный русский текст с тире и «кавычками»';
  const redOk = mojibakeIn(broken).length > 0;
  const greenOk = mojibakeIn(clean).length === 0;
  console.log(`${redOk ? 'OK  ' : 'FAIL'} сторож КРАСНЕЕТ на испорченном тексте (${mojibakeIn(broken).join(' ')})`);
  console.log(`${greenOk ? 'OK  ' : 'FAIL'} сторож МОЛЧИТ на правильном русском`);
  return redOk && greenOk ? 0 : 1;
}

/** The encoding gate over every text file. Returns `{ scanned, corrupted }`. */
function encodingGate() {
  const textFiles = collectText(ROOT);
  let mojibake = 0;
  let guardExempt = 0;
  for (const file of textFiles) {
    const text = readFileSync(file, 'utf8');
    if (text.includes(GUARD_MARK)) { guardExempt++; continue; }
    const found = mojibakeIn(text);
    if (found.length) {
      mojibake++;
      console.error(`ПОРЧА КОДИРОВКИ: ${relative(ROOT, file)}`);
      console.error(`       Русский текст в этом файле нечитаем — найдено: ${found.join(' ')}`);
      console.error('       Так выглядит UTF-8, прочитанный как windows-1251: одна буква стала двумя.');
      console.error('       Причина всегда одна — файл прогнали через оболочку, а не через файловые');
      console.error('       инструменты (EXP-0067). Восстанови из git и переделай правку Edit/Write.');
    }
  }
  return { scanned: textFiles.length - guardExempt, corrupted: mojibake };
}

/**
 * ВСЯ РАБОТА ВОРОТ — здесь, и зовётся она только при ПРЯМОМ ЗАПУСКЕ (`bugs/95`, разбор вверху файла).
 *
 * `process.argv` читается ТОЛЬКО отсюда: до починки его читал верхний уровень модуля, то есть чужие
 * флаги импортирующего процесса становились флагами ворот.
 */
function main(argv) {
  // Ветка самопроверки уходит первой и ничего не сканирует: она доказывает сторожа, а не дерево.
  if (argv.includes('--selftest-encoding')) return selftestEncoding();

  const files = collect(ROOT);
  const failed = parseGate(files);
  const enc = encodingGate();

// -------------------------------------------------------------------------------------------------
// ТРЕТЬИ ВОРОТА: СТРАНИЦА ОКНА НАБЛЮДЕНИЯ СОБРАНА ИЗ ТЕКУЩИХ ИСТОЧНИКОВ
//
// Пара «правда↔зеркало», за которую заплачено дважды одной и той же жалобой владельца
// (2026-08-22 21:2x): умолчание темы звука починили в `_sound.js` и `_wiring.js`, но
// `assets/dashboard/sweep.html` — единственное, что окно отдаёт браузеру, — собирается из них
// СБОРЩИКОМ, и его никто не запустил. Правка легла в правду, играло зеркало, и не покраснело ничто.
// Правило канона про генерируемые поверхности существовало и было нарушено, потому что за ним не
// следила машина. Теперь следит. Проверка сама доказана красным: правка источника без пересборки
// роняет её в код 1.
// -------------------------------------------------------------------------------------------------
  const pageCheck = spawnSync(process.execPath, [join(ROOT, 'tools', 'build-dashboard-page.mjs'), '--check'],
    { cwd: ROOT, encoding: 'utf8' });
  const pageStale = pageCheck.status !== 0;
  if (pageStale) process.stderr.write(pageCheck.stderr || pageCheck.stdout || '');

// -------------------------------------------------------------------------------------------------
// ЧЕТВЁРТЫЕ ВОРОТА: МОЛИТВА ВВЕРХУ КАНОНА НЕ РАЗОШЛАСЬ С ИСТОЧНИКОМ
//
// Владелец 2026-08-24 велел поднять принципы `PHILOSOPHY.md` до молитвы вверху КАЖДОГО канон-
// документа. Двенадцать копий одного текста, поставленные руками, разъехались бы на первой же
// правке — это тот самый класс, за который проект платил дважды (пара «правда↔зеркало»). Поэтому
// текст живёт ОДИН РАЗ, в `PHILOSOPHY.md`, раскладывается командой, а эти ворота не дают копии
// разъехаться молча. Лечение печатается вместе с отказом.
// -------------------------------------------------------------------------------------------------
  const prayerCheck = spawnSync(process.execPath, [join(ROOT, 'tools', 'prayer.mjs')], { cwd: ROOT, encoding: 'utf8' });
  const prayerDrifted = prayerCheck.status !== 0;
  if (prayerDrifted) process.stderr.write(prayerCheck.stderr || prayerCheck.stdout || '');

// -------------------------------------------------------------------------------------------------
// ПЯТЫЕ ВОРОТА: СТОРОЖ ОБЯЗАН ОБЪЯВИТЬ, ПРОТИВ ЧЕГО ОН ДОКАЗАН (механизм М1, `plans/76`)
//
// 2026-08-30 машина владельца зависла. Предохранитель, писанный два дня и доказанный мутациями,
// записал ноль трипов; его чёрный ящик — ноль байт. Разбор нашёл за вечер ЧЕТЫРЕ сторожа одного
// класса: каждый доказан против МОДЕЛИ угрозы, а не против угрозы (предохранитель — против смерти
// процесса вместо зависания машины; кольцо — против чтения после штатного закрытия вместо смерти
// без него; оракул — против одного предупреждения вместо накопления; сторож шага — против первого
// шага вместо любого).
//
// Ворота 5 канона («проверка, которая ни разу не падала, ничего не доказывает») были ИСПОЛНЕНЫ во
// всех четырёх случаях и бесполезны: мутации краснели против нашей же фикстуры, а фикстура
// моделировала не ту угрозу. Зелёная мутация в такой конструкции не отнимает уверенность, а выдаёт
// её ложно.
//
// Эти ворота требуют написать рядом со сторожем четыре строки — THREAT · PROVED-AGAINST · GAP ·
// ON-REAL-PATH — и валят сборку, если хоть одной нет. Строка `GAP`, написанная 28 августа, сняла бы
// инцидент 30-го. Слово владельца: «мы не можем продолжать развивать проект, пока допускаются
// ошибки этого класса в принципе».
//
// Сам линтер доказан 108 фикстурами (58 негативных · 50 позитивных · 24 оси) и мутациями по каждому
// правилу; одна из мутаций в первый же прогон нашла в нём недостижимое правило, и оно снято.
// -------------------------------------------------------------------------------------------------
  const guardCheck = spawnSync(process.execPath, [join(ROOT, 'tools', 'guard-lint.mjs')], { cwd: ROOT, encoding: 'utf8' });
  const guardsUndeclared = guardCheck.status !== 0;
  if (guardsUndeclared) process.stderr.write(guardCheck.stdout || guardCheck.stderr || '');

// -------------------------------------------------------------------------------------------------
// ШЕСТЫЕ ВОРОТА: КАЖДЫЙ ПРИБОР `tools/*.mjs` НЕСЁТ СТОРОЖ ВХОДА (`bugs/95`, решение владельца 04.09)
//
// Импорт модуля в этом языке — запуск. Прибор без сторожа входа исполняет свою работу с argv
// ВЫЗЫВАЮЩЕГО: так `tidy.mjs` снимал окна владельца, `grant-agent-*` писали его файл прав, а цикл
// импорта ради описи пересобрал бинарники прожига (EXP-0218). Сами эти ворота были первым починенным
// прибором класса (сессия 77). Долг заморожен в `decisions/entry-guard-baseline.json` и может только
// убывать: починенный прибор, оставшийся в базе, тоже красный — база не имеет права врать.
// -------------------------------------------------------------------------------------------------
  const entryCheck = spawnSync(process.execPath, [join(ROOT, 'tools', 'entry-guard-lint.mjs')], { cwd: ROOT, encoding: 'utf8' });
  const entryUnguarded = entryCheck.status !== 0;
  if (entryUnguarded) process.stderr.write(entryCheck.stdout || entryCheck.stderr || '');

// -------------------------------------------------------------------------------------------------
// СЕДЬМЫЕ ВОРОТА: НИ ОДИН БЛОК НЕ НАПИСАН ЧУЖИМ ДИАЛЕКТОМ `ok` (`bugs/106`, 2026-09-05)
//
// В проекте два законных диалекта помощника: `ok(имя, cond, подробность)` и `ok(имя, got, want)`.
// Строка, написанная вторым диалектом внутри батареи первого, горит зелёным СТРУКТУРНО — непустой
// массив истинен, число истинно, — чем бы ни кончился прогон. Так две строки шага Ш5 в `fuse.mjs`,
// включая ту, что сама называла себя ГЛАВНОЙ строкой шага, простояли украшением пять дней, и
// приписанная им мутация покрасить их не могла.
//
// Нашлись они не батареей: батарея на них и смотрела зелёным глазом. Нашёл тот, кто собрался НА НИХ
// ОПЕРЕТЬСЯ при приёмке `plans/88` Ш3. Ворота ставятся ровно затем, чтобы третьего раза не было —
// это второй ложный зелёный за одни сутки (`bugs/109` — первый).
//
// Линтер доказан КРАСНЫМ на настоящем дереве, а не на выдумке: на снимке `fuse.mjs` до починки он
// находит ровно те две строки (1702 и 1709) и ни одной законной; тринадцать фикстур, пять красных.
// Правило «второй аргумент обязан быть условием» опробовано первым и отвергнуто замером — 528
// срабатываний на 1373 вызова, почти все ложные.
// -------------------------------------------------------------------------------------------------
  const dialectCheck = spawnSync(process.execPath, [join(ROOT, 'tools', 'assert-dialect-lint.mjs')], { cwd: ROOT, encoding: 'utf8' });
  const dialectMixed = dialectCheck.status !== 0;
  if (dialectMixed) process.stderr.write(dialectCheck.stderr || dialectCheck.stdout || '');

  console.log(`checked ${files.length} .mjs file(s), ${failed} failed`);
  console.log(`проверено на порчу кодировки ${enc.scanned} текстовых файлов, `
    + `испорченных ${enc.corrupted} (сам сторож освобождён меткой)`);
  console.log(`страница окна наблюдения: ${pageStale ? 'УСТАРЕЛА — пересобрать' : 'собрана из текущих источников'}`);
  console.log(`молитва вверху канона: ${prayerDrifted ? 'РАЗОШЛАСЬ — node tools/prayer.mjs --apply' : (prayerCheck.stdout || '').trim() || 'совпадает с источником'}`);
  console.log(`декларация угроз сторожей: ${guardsUndeclared ? 'КРАСНО — node tools/guard-lint.mjs' : (guardCheck.stdout || '').split('\n').filter(Boolean).slice(0, 2).join(' · ') || 'чисто'}`);
  console.log(`сторож входа приборов: ${entryUnguarded ? 'КРАСНО — node tools/entry-guard-lint.mjs' : (entryCheck.stdout || '').split('\n')[0] || 'чисто'}`);
  console.log(`диалект ok в батареях: ${dialectMixed ? 'КРАСНО — node tools/assert-dialect-lint.mjs' : (dialectCheck.stdout || '').split('\n')[0] || 'чисто'}`);
  return failed === 0 && enc.corrupted === 0 && !pageStale && !prayerDrifted && !guardsUndeclared
    && !entryUnguarded && !dialectMixed ? 0 : 1;
}

// СТОРОЖ ВХОДА — ворота исполняются ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
