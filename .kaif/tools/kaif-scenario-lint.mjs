#!/usr/bin/env node
// kaif-scenario-lint.mjs — the OPTIONAL scenario-form linter (2.5, epic SF; REQUIREMENTS_FRAMEWORK.md
// → "The scenario form"; origin issue #39). Deployed to .kaif/tools/.
//
// What it mechanizes: an acceptance criterion written as the four-line scenario —
//   - Situation. <the state of the world, with concrete values — not an action>
//   - Action.    <exactly one action of the user / the system / the agent>
//   - Result.    <what is SEEN from outside — never "works correctly">
//   - Check.     <a runnable command or query of the repository + its expected output>
// — keeps its FORM. The stop-word dictionary (`kaif-requirements-lint`) judges WORDS; this linter
// judges the SHAPE of a scenario and duplicates nothing from the dictionary (one boundary, one
// guard). A field deployment proved the seven rules on a live backlog for one night before this
// module was distilled from it: "Result. Works correctly" passes every word linter and fails here.
//
// What counts as a scenario: a list item that starts with the first keyword of a language
// (`- Situation.` / `- Ситуация.`, bold allowed) and the sibling items that follow it; continuation
// lines (indented, no bullet) glue to the current item. Everything else is invisible — the linter
// never demands a scenario (not a Definition-of-Ready gate), it guards the form where one was
// STARTED. Invisible by construction: fenced code, `>` quotes, lines carrying ❌ (the canon's own
// counter-examples).
//
// Boundaries, so the linter never becomes bureaucracy:
//   · keywords are a per-language table (like the stop-word dictionary) — a project adds a row;
//   · rules are DATA (one engine + rules-as-data): a new rule is a table row, not a new script;
//   · ADVISORY: exit 1 = findings, exit 0 = scanned and clean, exit 3 = SKIPPED (no scenario found —
//     "not scanned" must never read as "clean");
//   · an EMPTY Check line is a warning, not a finding: the owner may leave it for the agent to fill;
//     an agent-written empty Check is a defect the judge hunts, not this linter.
//   · Cyrillic word boundaries are lookarounds on the Cyrillic range — JavaScript `\b` is blind to
//     non-ASCII letters, a paid-for lesson.
//
// Commands:
//   node .kaif/tools/kaif-scenario-lint.mjs check [paths…]   # default: plans/ bugs/ ideas/
//   node .kaif/tools/kaif-scenario-lint.mjs selftest         # PROVE every rule on in-memory fixtures:
//                                                            # rule N reddens on scenario N and only N,
//                                                            # the clean set yields 0 — in both languages
// [TESTED: 2026-09-04 · selftest 33 cases green (7 rules × 2 languages, mutation N → rule N only; empty
//  Check = warning; fenced template / ❌ example / quoted line invisible); sandbox suite s19 observed:
//  broken fixture exit 1 with 14 findings in 14 scenarios (each rule named twice — EN + RU), clean
//  fixture exit 0 with 1 warning, template-only and empty trees SKIPPED (exit 3); the origin's own
//  plans/bugs/ideas (233 files) — SKIPPED: no scenario started there]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const PATHS = argv.slice(1);
const EXIT_SKIPPED = 3;
const DEFAULT_PATHS = ['plans', 'bugs', 'ideas'];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.kaif', 'dist', 'vendor']);

// ---------------------------------------------------------------------------
// Keywords per language — the four lines in their canonical order. A project whose owner writes in
// another language adds a row; the engine does not change.
export const KEYWORDS = {
  en: ['Situation', 'Action', 'Result', 'Check'],
  ru: ['Ситуация', 'Действие', 'Результат', 'Проверка'],
};
const CYR = '[А-Яа-яЁё]';
// Word-bounded alternative for a Cyrillic OR Latin list: lookarounds for Cyrillic, `\b` for Latin.
const cyr = (alts) => new RegExp(`(?<!${CYR})(?:${alts})(?!${CYR})`, 'i');
const lat = (alts) => new RegExp(`\\b(?:${alts})\\b`, 'i');

// ---------------------------------------------------------------------------
// The rules — data. Each: id · message · test(block) → true when the rule is violated.
// block = { lang, situation, action, result, check } (texts without the keyword).
export const RULES = [
  { id: 'one-action', msg: 'two actions in one Action line — split into two scenarios',
    test: (b) => lat('then|afterwards|after which|after that').test(b.action) ||
                 cyr('затем|потом|после чего').test(b.action) },
  { id: 'vague-result', msg: 'a vague Result — name what is seen from outside (a number, an output line, a file)',
    test: (b) => lat('correctly|properly|works|working|successfully|as expected|fine|ok').test(b.result) ||
                 /(корректн|правильн|работает|успешн|как ожидал|нормальн)/i.test(b.result) },
  { id: 'implementation-leak', msg: 'implementation words in Situation/Action — that is the language of the Check line',
    test: (b) => { const t = b.situation + ' ' + b.action;
      return lat('function|variable|array|selector|endpoint|callback').test(t) ||
             /(функци|переменн|массив|селектор)/i.test(t) || /\b(JSON|SQL)\b/.test(t); } },
  { id: 'first-person', msg: 'first person — a scenario is written in the third person (the user, the player, the agent)',
    test: (b) => [b.situation, b.action, b.result, b.check].some((t) =>
      /\b(I|me|my|mine)\b/.test(t) || cyr('я|мне|мой|моя|мои|меня').test(t)) },
  { id: 'no-command', msg: 'the Check line has no runnable command or query with its expected output',
    test: (b) => { const p = b.check; if (!p.trim()) return false;   // empty — a warning, not this rule
      return !/(`|npm run|node |grep|→|prints|печатает|exit|==|≥|>=|\$ )/.test(p); } },
  { id: 'no-concrete-value', msg: 'no concrete value in Situation/Action (a number, a "quoted" value, a `code` token)',
    test: (b) => !/[0-9]|«[^»]+»|`[^`]+`|"[^"]+"/.test(b.situation + ' ' + b.action) },
];
export const RULE_IDS = ['order', ...RULES.map((r) => r.id)];

// ---------------------------------------------------------------------------
// Parsing — blocks of a document.
const FIRST_KEYS = Object.entries(KEYWORDS).map(([lang, k]) => ({ lang, key: k[0] }));
const START = new RegExp(`^(\\s*)- \\*{0,2}(${FIRST_KEYS.map((f) => f.key).join('|')})\\*{0,2}\\.\\s*(.*)$`);
const langOf = (firstKey) => FIRST_KEYS.find((f) => f.key === firstKey).lang;

export function parseScenarios(src) {
  const lines = src.replace(/^﻿/, '').split(/\r?\n/);
  const out = [];
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { fence = !fence; continue; }
    if (fence || /^\s*>/.test(l) || l.includes('❌')) continue;
    const m = START.exec(l);
    if (!m) continue;
    const indent = m[1].length;
    const lang = langOf(m[2]);
    const keys = KEYWORDS[lang];
    const item = new RegExp(`^\\s{${indent}}- \\*{0,2}(${keys.join('|')}|[A-Z][a-z]+|[А-ЯЁ][а-яё]+)\\*{0,2}\\.\\s*(.*)$`);
    const block = { line: i + 1, lang, keys: [m[2]], text: { [m[2]]: m[3] } };
    let cur = m[2];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const t = lines[j];
      if (!t.trim()) break;                                            // blank line — end of block
      const it = item.exec(t);
      if (it) { cur = it[1]; block.keys.push(cur); block.text[cur] = it[2]; continue; }
      if (/^\s*- /.test(t) || /^\s*\*\*/.test(t) || /^#/.test(t)) break; // another list / a heading
      block.text[cur] = (block.text[cur] || '') + ' ' + t.trim();        // continuation line
    }
    out.push(block);
    i = j - 1;
  }
  return out;
}

export function lint(block) {
  const findings = [], warnings = [];
  const keys = KEYWORDS[block.lang];
  if (block.keys.join('|') !== keys.join('|')) {
    findings.push({ id: 'order', msg: `line order ${block.keys.join(' · ')} — expected ${keys.join(' · ')}` });
    return { findings, warnings };                                     // one rule for a broken order (addressivity)
  }
  const b = { lang: block.lang, situation: block.text[keys[0]] || '', action: block.text[keys[1]] || '',
              result: block.text[keys[2]] || '', check: block.text[keys[3]] || '' };
  for (const r of RULES) if (r.test(b)) findings.push({ id: r.id, msg: r.msg });
  if (!b.check.trim()) warnings.push({ id: 'empty-check', msg: 'empty Check — legal when the OWNER wrote it; the agent must fill it before "done"' });
  return { findings, warnings };
}

// ---------------------------------------------------------------------------
function collect(paths) {
  const files = [];
  const walk = (p) => {
    if (!existsSync(p)) return;
    const st = statSync(p);
    if (st.isDirectory()) {
      for (const n of readdirSync(p).sort()) { if (SKIP_DIRS.has(n)) continue; walk(join(p, n)); }
      return;
    }
    if (/\.md$/i.test(p)) files.push(p.replace(/\\/g, '/'));
  };
  for (const p of paths) walk(p);
  return files;
}

function check(paths) {
  for (const p of PATHS) if (!existsSync(p)) { console.error(`✖ path not found: ${p}`); process.exit(1); }
  const files = collect(paths);
  let scenarios = 0, nF = 0, nW = 0;
  for (const f of files) {
    for (const bl of parseScenarios(readFileSync(f, 'utf8'))) {
      scenarios++;
      const { findings, warnings } = lint(bl);
      for (const x of findings) { nF++; console.log(`✖ ${f}:${bl.line} — ${x.id}: ${x.msg}`); }
      for (const x of warnings) { nW++; console.log(`⚠ ${f}:${bl.line} — ${x.id}: ${x.msg}`); }
    }
  }
  if (!scenarios) {
    console.log(`⚠ scenario-lint SKIPPED — no scenario block in ${files.length} file(s) under ${paths.join(' ')}; nothing was linted (exit ${EXIT_SKIPPED})`);
    process.exit(EXIT_SKIPPED);
  }
  const w = nW ? `, ${nW} warning(s)` : '';
  if (nF) { console.log(`✖ scenario-lint: ${nF} finding(s) in ${scenarios} scenario(s)${w} — a criterion that is not in form is not a check`); process.exit(1); }
  console.log(`✅ scenario-lint OK — ${files.length} file(s), ${scenarios} scenario(s), 0 findings${w}`);
}

// ---------------------------------------------------------------------------
// selftest — every rule proves BOTH answers on in-memory fixtures, in both shipped languages:
// broken scenario N reddens rule N and only N; the clean set yields 0 findings.
const FIX = {
  en: {
    clean: [
      ['The hero has Wisdom 70; the dice fall 17, 31, 62.', 'The player rolls the chain link by link.',
       'Chain length L = 2; the game log shows three rolls: 17, 31, 62.', '`node tools/chain.mjs --rolls 17,31,62 --wisdom 70` prints `2`.'],
      ['Two players named "Ann" and "Bob" have joined room 7.', 'Ann presses "Start".',
       'The board shows round 1 and the turn belongs to Ann.', '`npm run sim -- --room 7` prints `round 1 · turn Ann`.'],
    ],
    broken: {
      'order': ['The hero has Wisdom 70.', 'The player rolls.', null, '`node x` prints `2`.'],     // Result missing → order
      'one-action': ['The hero has Wisdom 70.', 'The player rolls the chain and then equips the sword.', 'Chain length L = 2.', '`node x` prints `2`.'],
      'vague-result': ['The hero has Wisdom 70.', 'The player rolls the chain.', 'The chain is computed correctly.', '`node x` prints `2`.'],
      'implementation-leak': ['The `players` array holds 2 objects.', 'The player rolls the chain.', 'Chain length L = 2.', '`node x` prints `2`.'],
      'first-person': ['The hero has Wisdom 70.', 'I roll the chain.', 'Chain length L = 2.', '`node x` prints `2`.'],
      'no-command': ['The hero has Wisdom 70.', 'The player rolls the chain.', 'Chain length L = 2.', 'Verify by hand.'],
      'no-concrete-value': ['The hero has high Wisdom.', 'The player rolls the chain.', 'Chain length L = 2.', '`node x` prints `2`.'],
    },
  },
  ru: {
    clean: [
      ['У героя Мудрость 70; кости ложатся 17, 31, 62.', 'Игрок бросает цепочку звено за звеном.',
       'Длина цепочки L = 2; в логе партии три броска: 17, 31, 62.', '`node tools/chain.mjs --rolls 17,31,62 --wisdom 70` печатает `2`.'],
      ['В комнате 7 два игрока — «Аня» и «Боб».', 'Аня нажимает «Старт».',
       'На доске раунд 1, ход у Ани.', '`npm run sim -- --room 7` печатает `round 1 · turn Аня`.'],
    ],
    broken: {
      'order': ['У героя Мудрость 70.', 'Игрок бросает.', null, '`node x` печатает `2`.'],
      'one-action': ['У героя Мудрость 70.', 'Игрок бросает цепочку и затем надевает меч.', 'Длина цепочки L = 2.', '`node x` печатает `2`.'],
      'vague-result': ['У героя Мудрость 70.', 'Игрок бросает цепочку.', 'Цепочка считается правильно.', '`node x` печатает `2`.'],
      'implementation-leak': ['Массив игроков держит 2 объекта.', 'Игрок бросает цепочку.', 'Длина цепочки L = 2.', '`node x` печатает `2`.'],
      'first-person': ['У героя Мудрость 70.', 'Я бросаю цепочку.', 'Длина цепочки L = 2.', '`node x` печатает `2`.'],
      'no-command': ['У героя Мудрость 70.', 'Игрок бросает цепочку.', 'Длина цепочки L = 2.', 'Проверить вручную.'],
      'no-concrete-value': ['У героя высокая Мудрость.', 'Игрок бросает цепочку.', 'Длина цепочки L = 2.', '`node x` печатает `2`.'],
    },
  },
};
const render = (lang, lines) => KEYWORDS[lang].map((k, i) => lines[i] === null ? null : `- ${k}. ${lines[i]}`)
  .filter(Boolean).join('\n') + '\n';

function selftest() {
  let failed = 0, cases = 0;
  const say = (ok, name) => { cases++; if (!ok) { failed++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); };
  for (const lang of Object.keys(FIX)) {
    const clean = FIX[lang].clean.map((l) => render(lang, l)).join('\n');
    const blocks = parseScenarios(clean);
    const f = blocks.flatMap((b) => lint(b).findings);
    say(blocks.length === FIX[lang].clean.length && f.length === 0,
      `${lang}: clean set — ${blocks.length} scenario(s) parsed, 0 findings${f.length ? ' (got ' + f.map((x) => x.id).join(',') + ')' : ''}`);
    for (const id of RULE_IDS) {
      const mut = FIX[lang].broken[id];
      say(!!mut, `${lang}: rule ${id} has a mutation`);
      if (!mut) continue;
      const got = parseScenarios(render(lang, mut)).flatMap((b) => lint(b).findings).map((x) => x.id);
      say(got.length === 1 && got[0] === id, `${lang}: mutation ${id} → exactly [${id}] (got [${got.join(',')}])`);
    }
    // The warning path: an empty Check is a warning, never a finding.
    const w = parseScenarios(render(lang, [...FIX[lang].clean[0].slice(0, 3), ''])).flatMap((b) => lint(b));
    say(w.length === 1 && w[0].findings.length === 0 && w[0].warnings.length === 1, `${lang}: empty Check — a warning, not a finding`);
  }
  // Invisibility: a fenced template and a ❌ counter-example are not scenarios.
  const inv = parseScenarios('```\n' + render('en', FIX.en.clean[0]) + '```\n❌ Result. Works correctly.\n> - Situation. quoted\n');
  say(inv.length === 0, 'fenced template, ❌ example and quoted line are invisible');
  if (failed) { console.error(`✖ scenario-lint selftest: ${failed} of ${cases} case(s) FAILED`); process.exit(1); }
  console.log(`✅ scenario-lint selftest OK — ${cases} cases, ${RULE_IDS.length} rules × ${Object.keys(FIX).length} languages, every rule red on its mutation only and silent on the clean set`);
}

if (CMD === 'check') check(PATHS.length ? PATHS : DEFAULT_PATHS.filter((p) => existsSync(p)));
else if (CMD === 'selftest') selftest();
else { console.error(`usage: node .kaif/tools/kaif-scenario-lint.mjs check [paths…] | selftest`); process.exit(1); }
