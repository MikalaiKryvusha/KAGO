#!/usr/bin/env node
// kaif-requirements-lint.mjs — the OPTIONAL stop-word linter for requirements (2.2, epic N;
// REQUIREMENTS_FRAMEWORK.md § "The stop-word dictionary"). Deployed to .kaif/tools/.
//
// What it mechanizes: the dictionary of unverifiable words (NASA Appendix C black list +
// requirements smells) as a grep step over REQUIREMENT LINES. A hit means "rewrite measurably
// or justify explicitly in place" — the linter CONSULTS, it is never a Definition-of-Ready
// turnstile: it lints what was written, it does not forbid starting work (the anti-pattern
// boundary in REQUIREMENTS_FRAMEWORK.md).
//
// Scope discipline (precision over reach — a noisy advisor trains everyone to ignore it):
//   by default only lines inside REQUIREMENT SECTIONS are scanned — a section whose heading
//   matches /готово, когда|критери\w+ приёмки|вектор цели|acceptance criteria|goal vector|
//   done when|requirements/i — from that heading to the next heading of the same-or-higher
//   level. `--all` widens the scan to whole files.
// Legal by construction (never flagged):
//   quotation lines (`>`), ❌-example lines, fenced code blocks, inline code spans, and lines
//   carrying a named justification — `(justified: …)` or `(оправдано: …)`.
//
// Commands:
//   node .kaif/tools/kaif-requirements-lint.mjs check [paths…]   # default paths: plans/ bugs/ ideas/
//   node .kaif/tools/kaif-requirements-lint.mjs check --all [paths…]
//   node .kaif/tools/kaif-requirements-lint.mjs selftest         # PROVE the dictionary: every class
//                                                                # matches its own ❌ example and
//                                                                # stays silent on a clean ✅ line
// Exit codes: 0 = scanned and clean · 1 = findings (or selftest failure) ·
//             3 = SKIPPED, nothing to scan — "not scanned" must never read as "clean" (bug 34).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const ALL = argv.includes('--all');
const PATHS = argv.slice(1).filter((a) => a !== '--all');
const EXIT_SKIPPED = 3;
const die = (s) => { console.error('✖ ' + s); process.exit(1); };

// ---------------------------------------------------------------------------
// The dictionary. Six classes, EN+RU (the shipped canon; REQUIREMENTS_FRAMEWORK.md carries the
// EN table — this file is the executable RU+EN form). A project in another working language
// extends WORDS with its own mirrors: the class, not the wording, is the dictionary.
// EN patterns ride \b word boundaries; RU stems ride Unicode-letter lookarounds (\b is
// ASCII-only in JS and silently never fires inside Cyrillic — a guard that cannot fire).
const ru = (stem) => `(?<!\\p{L})(?:${stem})`;
const WORDS = [
  { cls: 'perception', re: /\b(user-friendly|easy|convenient|intuitive|seamless|flexible|robust|beautiful)\b/iu,
    ruRe: new RegExp(ru('удобн|интуитивн|бесшовн|гибк|надёжн|надежн|красив|прост(?:ой|ая|ое|ые|ых|ым|ого|ому|ую|ыми?)'), 'iu'),
    example: 'Интерфейс должен быть удобным и интуитивно понятным.', exampleEn: 'The interface shall be easy and intuitive.' },
  { cls: 'unbounded', re: /\b(fast|quickly|efficient(?:ly)?|optimal|adequate|sufficient|significant|minimal|best)\b/iu,
    ruRe: new RegExp(ru('быстр|эффективн|оптимальн|достаточн|значительн|минимальн|лучш'), 'iu'),
    example: 'Система должна работать быстро.', exampleEn: 'The system shall be fast.' },
  { cls: 'escape', re: /\b(as appropriate|as applicable|if possible|as needed|where practicable)\b/iu,
    ruRe: new RegExp(ru('по возможности|при необходимости|по мере необходимости|где применимо'), 'iu'),
    example: 'Логи ротируются при необходимости.', exampleEn: 'Logs are rotated as appropriate.' },
  { cls: 'open-ended', re: /(\betc\.|\band so on\b|\bincluding but not limited to\b|\band\/or\b)/iu,
    ruRe: new RegExp(ru('и т\\.\\s?д\\.|и так далее|и т\\.\\s?п\\.|и/или'), 'iu'),
    example: 'Форма содержит имя, email и т.д.', exampleEn: 'The form contains name, email, etc.' },
  { cls: 'vague-verb', re: /\b(support|handle|process|manage|improve|maximize|minimize)\b/iu,
    ruRe: new RegExp(ru('поддержива|обрабатыва|управля|улучш|максимизир|минимизир'), 'iu'),
    example: 'Система должна поддерживать большие файлы.', exampleEn: 'The system shall support large files.' },
  { cls: 'placeholder', re: /\b(TBD|TBS|TBR)\b/u,
    ruRe: new RegExp(ru('уточняется|будет определено'), 'iu'),
    example: 'Формат экспорта уточняется.', exampleEn: 'The export format is TBD.' },
];
// Clean fit-criterion lines every class must stay SILENT on (the ✅ side of the selftest).
const CLEAN = [
  'Время отклика поиска по каталогу — не более 200 мс при нагрузке до 500 RPS.',
  'A purchase completes in at most 3 clicks from the cart page.',
];

// ---------------------------------------------------------------------------
// Line legality: quotations, ❌ examples, code, and named justifications are citations of the
// convention, not requirements — the guard hunts unverifiable REQUIREMENTS, not vocabulary.
const isLegal = (line) =>
  /^\s*>/.test(line) || line.includes('❌') ||
  /\(\s*(justified|оправдано)\s*:/iu.test(line);
// Inline code spans AND «…»/"…" quoted segments are citations — a line DISCUSSING a stop word
// (the dictionary quoting itself) is not a requirement using one. «…» quotations WRAP across
// lines in prose, so the two HALVES are citations too: a lone « opens a quote that closes on a
// later line (everything after it is quoted), a lone » closes one opened earlier (everything
// before it is quoted). The per-line pair strip cannot see across lines — handle halves
// explicitly, or every wrapped owner quote becomes a false finding.
function stripCodeSpans(line) {
  line = line.replace(/`[^`]*`/g, '`code`').replace(/«[^»]*»/g, '«quote»').replace(/"[^"]*"/g, '"quote"');
  const close = line.indexOf('»');
  if (close >= 0 && (line.indexOf('«') < 0 || close < line.indexOf('«'))) line = '«quote»' + line.slice(close + 1);
  const open = line.lastIndexOf('«');
  if (open >= 0 && line.lastIndexOf('»') < open) line = line.slice(0, open) + '«quote»';
  return line;
}

// Requirement-section detection (default scope): heading matches → lines until the next
// heading of the same-or-higher level are in scope.
const SECTION_RE = /готово,\s*когда|критери\p{L}*\s+приёмки|вектор\p{L}*\s+цел|acceptance criteria|goal vector|done when|requirements/iu;
function scopedLines(text) {
  const lines = text.split(/\r?\n/);
  const out = []; // [lineNo, line]
  let inFence = false, inScope = false, scopeLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = l.match(/^(#{1,6})\s/);
    if (h) {
      if (inScope && h[1].length <= scopeLevel) inScope = false;
      if (SECTION_RE.test(l)) { inScope = true; scopeLevel = h[1].length; continue; }
    }
    if (ALL || inScope) out.push([i + 1, l]);
  }
  return out;
}

function* walkMd(dir) {
  for (const n of readdirSync(dir)) {
    const p = dir + '/' + n;
    if (['.git', 'node_modules', '.kaif'].includes(n)) continue;
    if (statSync(p).isDirectory()) { yield* walkMd(p); continue; }
    if (/\.md$/i.test(n)) yield p;
  }
}

function cmdCheck() {
  const roots = PATHS.length ? PATHS : ['plans', 'bugs', 'ideas'];
  const files = [];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    if (statSync(r).isDirectory()) files.push(...walkMd(r));
    else files.push(r);
  }
  if (!files.length) {
    console.log(`⊘ SKIPPED — nothing to scan under: ${roots.join(', ')} (exit ${EXIT_SKIPPED}; "not scanned" must never read as "clean")`);
    process.exit(EXIT_SKIPPED);
  }
  let findings = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/^﻿/, '');
    for (const [no, raw] of scopedLines(text)) {
      if (isLegal(raw)) continue;
      const line = stripCodeSpans(raw);
      for (const w of WORDS) {
        const hit = line.match(w.re) || line.match(w.ruRe);
        if (hit) { console.error(`✖ ${f}:${no} — "${hit[0]}" (${w.cls}): rewrite measurably or add (justified: …)`); findings++; }
      }
    }
  }
  if (findings) die(`requirements lint: ${findings} unverifiable-word finding(s) — advisory: rewrite or justify in place`);
  console.log(`✅ requirements lint OK — ${files.length} file(s), ${WORDS.length} word classes, 0 findings`);
}

// The dictionary is proven, never assumed: every class must MATCH its own ❌ examples (RU and
// EN) and stay SILENT on the clean fit-criterion lines — a guard that never reddens proves
// nothing, and one that fires on a measurable criterion is noise by construction.
function cmdSelftest() {
  let issues = 0;
  for (const w of WORDS) {
    if (!(w.ruRe.test(w.example))) { console.error(`✖ class "${w.cls}" does NOT match its own RU example: ${w.example}`); issues++; }
    if (!(w.re.test(w.exampleEn))) { console.error(`✖ class "${w.cls}" does NOT match its own EN example: ${w.exampleEn}`); issues++; }
  }
  for (const clean of CLEAN)
    for (const w of WORDS)
      if (w.re.test(clean) || w.ruRe.test(clean)) { console.error(`✖ class "${w.cls}" FIRES on a clean fit-criterion line (noise by construction): ${clean}`); issues++; }
  if (issues) die(`requirements lint selftest FAILED: ${issues} issue(s)`);
  console.log(`✅ requirements lint selftest OK — ${WORDS.length} classes match their ❌ examples and stay silent on clean ✅ lines`);
}

({ check: cmdCheck, selftest: cmdSelftest }[CMD] || (() => die(`unknown command: ${CMD} (check | selftest)`)))();
