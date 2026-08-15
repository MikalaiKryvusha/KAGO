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

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
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

const files = collect(ROOT);
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

if (process.argv.includes('--selftest-encoding')) {
  // Prove the guard RED before its green is trusted (EXP-0008). The sample is built here rather than
  // stored as a fixture, because a mojibake fixture on disk is a file every future tool must be told
  // to ignore.
  const broken = 'РљРћРќРўР РђРљРў: Р¶РёРІР°СЏ РєРѕР»РѕРЅРєР°';
  const clean = 'КОНТРАКТ: живая колонка — обычный русский текст с тире и «кавычками»';
  const redOk = mojibakeIn(broken).length > 0;
  const greenOk = mojibakeIn(clean).length === 0;
  console.log(`${redOk ? 'OK  ' : 'FAIL'} сторож КРАСНЕЕТ на испорченном тексте (${mojibakeIn(broken).join(' ')})`);
  console.log(`${greenOk ? 'OK  ' : 'FAIL'} сторож МОЛЧИТ на правильном русском`);
  process.exit(redOk && greenOk ? 0 : 1);
}

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

console.log(`checked ${files.length} .mjs file(s), ${failed} failed`);
console.log(`проверено на порчу кодировки ${textFiles.length - guardExempt} текстовых файлов, `
  + `испорченных ${mojibake} (сам сторож освобождён меткой)`);
process.exit(failed === 0 && mojibake === 0 ? 0 : 1);
