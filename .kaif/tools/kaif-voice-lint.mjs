#!/usr/bin/env node
// kaif-voice-lint.mjs — the OPTIONAL owner-voice tool (2.7, epic VC; AGENT_GUIDE.md → the fable loop's
// fourth KAIF obligation and "Showing is an action"; origin issue #61 — the owner's word: "that you write
// texts and do not use the stylometry is a GLARING methodology bug"). Deployed to .kaif/tools/.
//
// The owner's contract it serves (his statement, rendered from Russian): the agent WRITES the text by the
// voice and the rules the owner's stylometry prescribes — WITH THE STYLOMETRY IN ITS WORKING CACHE — then,
// by that same stylometry, runs an INDEPENDENT check of what it wrote, fixes it, and only then counts the
// text as written and brings it to the owner. Two commands, one for each half:
//   load  — prints the portrait (AUTHOR_STYLOMETRY.md) into the agent's working context BEFORE the first
//           word and leaves the witness .kaif/voice-marker.json (the moments are taken by the tool from the
//           system clock; the marker is session state, ignored by git like the refresh marker);
//   check — the MACHINE HALF of the independent check: the stop-patterns and required positives the
//           portrait keeps as a TABLE in §8, run over the written text; plus the witness — a text with no
//           load witness, last written BEFORE the portrait was first loaded, or written MORE THAN AN HOUR
//           after the last load (the hour rule of context refresh: the portrait had left the working
//           context), is "written past the portrait" and a finding. The semantic half is the
//           clean-instance pass §7B (not this module).
// The portrait is the single source of the patterns (the owner edits them where he reads them); this
// module carries no pattern of its own, and `check` is not the writing step.
//
// What it does NOT do, said aloud: it does not judge likeness — "sounds like the owner" is the taste
// class and the owner's verdict (AGENT_GUIDE.md → the taste class); it catches only the EXPLICIT patterns
// of the portrait's §8 table. It never lints the portrait itself (every pattern would hit its own row).
// A portrait whose §8 is prose is honestly SKIPPED — a silent green over an unread §8 would be a false
// check, which is the very class this module exists to close. And the witness is a MARKER, with the
// marker class's boundary: it proves that `load` ran and when, not that the agent read what it printed —
// a copied marker or a re-saved file can forge it; the judge's re-run (open the named modules, compare
// the lexicon's turns with the text) is what judges the reading, exactly as with the refresh marker.
//
// The table (portrait §8; the skeleton .kaif/_owner-voice-template.md carries the form):
//   | pattern | class | hint | legal exception |      (RU header: паттерн · класс · подсказка · исключение)
//   pattern   — a regular expression in a code span, word forms spelled out for inflected languages;
//               `\|` inside the cell is alternation (GFM escapes the pipe); a bare pattern is case-sensitive
//               like ripgrep, `/…/i` opts into case-folding; `\b`, `\B` and `\w`/`\W` are Unicode-aware
//               here — JavaScript's own are blind to non-ASCII letters, a paid-for lesson (EXP-0082);
//               the one gap: `\W` INSIDE a character class stays ASCII (u-mode cannot nest a class) —
//               write `[^\p{L}\p{N}_]` there explicitly
//   class     — `stop` (a hit is a finding) or `positive` (its ABSENCE in the whole file is a warning)
//   hint      — what to write instead, in the owner's own words (printed with every hit)
//   exception — `/regex/` silences a hit whose LINE matches; prose is printed beside the hit for the reader
//   a row whose pattern cell is a placeholder `<…>` or empty is not a rule (the skeleton's example rows)
//
// The witness (.kaif/voice-marker.json): { at, firstAt, loads[], portrait, sha256, sections, lines } —
// `load` appends the moment to `loads` (a history, kept for one portrait path; a different portrait
// starts a new witness); `check` judges every file against it: no witness, or a witness for another
// portrait → finding; no load before the file's last write → finding; the last load before the write
// older than STALE_MINUTES → finding (the hour rule); the portrait changed since the last load (sha) →
// warning. `--warn` never mutes the witness — calibration is for patterns, not for the contract.
//
// Exit codes — ADVISORY, like the sibling modules: 1 = findings, 0 = judged and clean, 3 = SKIPPED (no
// portrait · no §8 section · no pattern table in §8 · a table with no rule — "not judged" must never read
// as "clean"), 2 = usage (no files, a named file missing, `--sections` without a value or matching no
// section — then nothing is loaded and no witness is written).
//
// Commands:
//   node .kaif/tools/kaif-voice-lint.mjs load [--sections <regex>]      # print the portrait into your context
//                                                                        # (or only the H2 sections matching) +
//                                                                        # write the witness — BEFORE the first word
//   node .kaif/tools/kaif-voice-lint.mjs check <files…> [--warn]         # portrait: AUTHOR_STYLOMETRY.md at the
//                                                                        # project root, or .kaif/kaif.json → voicePortrait
//   node .kaif/tools/kaif-voice-lint.mjs selftest                        # PROVE every answer on in-memory fixtures (EN + RU)
// [TESTED: 2026-09-12 · selftest 48 cases green in 2 languages (a hit named 7:«Remember that» / 7:«Помни, что» with the row's
//  hint and its prose exception; the clean text silent; fence, inline code and HTML comment invisible; a /regex/ exception
//  silences; a bare pattern is case-sensitive and /…/i folds; \b is Unicode-aware — «ты» inside «открыты» is not a hit, \B
//  fires inside «открытый» and not on a standalone «ты»; an absent positive is a warning; a prose §8 → no-table, no §8 →
//  no-section, foreign columns → no-table naming the header, a third language found by its number, the shipped skeleton
//  unfilled → no-rules; the witness — no marker → finding, another portrait → finding, written before the first load →
//  finding with both moments in the local zone, written 90 min after the last load → finding, a re-load 10 min before the
//  write → clean, a changed portrait → warning, a pre-history marker still read; --sections keeps the head and the matching
//  sections and reports zero matches); live on the origin — `load --sections "^8"` printed 381 lines of the generated
//  portrait and left .kaif/voice-marker.json (ignored by git), `check` — SKIPPED exit 3 naming the two measurement tables of
//  its §8; sandbox suite s26 observed: EN and RU projects — check without a witness → "no load witness" (exit 1, also under
//  --warn), load prints the portrait and the witness, a hit named on `sheet/steps.md:7` with the hint, clean green with the
//  load moment, a file written before the load → "written past the portrait", --warn exit 0 on patterns, fence invisible,
//  --sections "^8" with the load history, --sections without a match or a value → usage with the witness untouched, prose
//  §8 and no portrait SKIPPED for check and load, the marker path honoured, a witness for another portrait → finding, usage
//  exit 2, deployed copy — module and skeleton (both commands + the table) arrive, deployed load, an unfilled skeleton copy
//  SKIPPED, one filled row fires with the "changed since it was last loaded" warning; polygon `all 25 suites green`; red
//  proven on the 2.6 dist via KAIF_DIST (7 of 47 addressed to the absent module and skeleton form); the first suite run
//  caught a line-count defect of this module (the file's trailing newline counted as a line), the epic's judge caught the
//  witness that refused only once per tree, the mute --warn, the empty --sections load, the mixed time zones and the
//  untranslated \B — all fixed before commit; the origin's run report: testcases/reports/2026-09-12_polygon-2.7-VC.md]
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const WARN = argv.includes('--warn');
const SECTIONS_AT = argv.indexOf('--sections');
const SECTIONS_ARG = SECTIONS_AT >= 0 ? argv[SECTIONS_AT + 1] : null;
const FILES = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--sections');
const EXIT_FINDINGS = 1;
const EXIT_USAGE = 2;
const EXIT_SKIPPED = 3;
const MARKER = '.kaif/kaif.json';
const VOICE_MARKER = '.kaif/voice-marker.json';
const DEFAULT_PORTRAIT = 'AUTHOR_STYLOMETRY.md';
const FRAGMENT_MAX = 80;
const LOADS_KEPT = 100;               // the load history a witness keeps (the oldest fall off)
export const STALE_MINUTES = 60;      // the hour rule of context refresh: an older load is no longer "in the cache"
export const BOUNDARY = 'likeness is not judged — that verdict is the owner\'s (the taste class); the linter catches only the explicit patterns of the portrait\'s §8 table';
const USAGE = 'usage: node .kaif/tools/kaif-voice-lint.mjs load [--sections <regex>] | check <files…> [--warn] | selftest';

// ---------------------------------------------------------------------------
// Words the parser recognises, per shipped language: the §8 heading and the four column headers. A project
// whose owner writes in another language adds a row; the engine does not change. The heading is also found
// by its NUMBER (`## 8. …`) so a portrait in a third language is not lost.
export const KEYWORDS = {
  en: { section: /machine heuristics/i,
        columns: { pattern: /^pattern/i, class: /^class/i, hint: /^hint/i, exception: /^(?:legal\s+)?exception/i } },
  ru: { section: /машинн\S*\s+эвристик/i,
        columns: { pattern: /^паттерн/i, class: /^класс/i, hint: /^подсказк/i, exception: /^(?:законн\S*\s+)?исключен/i } },
};
const SECTION_NUMBER = /^8[.)]\s/;
const H2 = /^##\s+(.+?)\s*$/;
const ANY_H2 = /^##\s/;
const TABLE_ROW = /^\s*\|/;
const SEPARATOR_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const PLACEHOLDER_CELL = /^<[\s\S]*>$/;
const DASH_CELL = /^[—–-]+$/;
const POSITIVE_CLASS = /^(?:positive|обязательн|позитив)/i;   // anything else is `stop`
const REGEX_CELL = /^\/(.+)\/([a-z]*)$/;

// Split a GFM table row into cells: an unescaped `|` separates, `\|` is a literal pipe — alternation in a
// regex is written `\|` in the portrait and read back as `|` here. A cell wrapped in a code span is unwrapped.
const cellsOf = (row) => {
  const cells = row.trim().split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
  if (cells.length && cells[0] === '') cells.shift();
  if (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
};
const unspan = (cell) => { const m = /^`([\s\S]*)`$/.exec(cell); return m ? m[1].trim() : cell; };

// Translate the ripgrep/PCRE habits of a portrait into JavaScript `u`-mode: `\b`, `\B` and `\w`/`\W` are
// ASCII-only in JavaScript and would either miss a Cyrillic word or split it at every letter. Outside a
// character class `\b` → a Unicode word boundary, `\B` → its negation, `\w` → [\p{L}\p{N}_], `\W` → the
// negated class; inside a class `\w` → \p{L}\p{N}_ (a negated set cannot be nested there — the named gap).
const W = '[\\p{L}\\p{N}_]';
const UNI_B = `(?:(?<!${W})(?=${W})|(?<=${W})(?!${W}))`;
const UNI_NB = `(?:(?<=${W})(?=${W})|(?<!${W})(?!${W}))`;
export function unicodeBody(src) {
  let out = '', inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      const n = src[i + 1];
      if (!inClass && n === 'b') { out += UNI_B; i++; continue; }
      if (!inClass && n === 'B') { out += UNI_NB; i++; continue; }
      if (n === 'w') { out += inClass ? '\\p{L}\\p{N}_' : W; i++; continue; }
      if (!inClass && n === 'W') { out += '[^\\p{L}\\p{N}_]'; i++; continue; }
      out += c + n; i++; continue;
    }
    if (c === '[' && !inClass) inClass = true;
    else if (c === ']' && inClass) inClass = false;
    out += c;
  }
  return out;
}
// A pattern cell → RegExp (throws on a pattern that does not compile — the caller reports the row and skips it).
export function compilePattern(cell, extraFlags = 'g') {
  const raw = unspan(cell);
  const m = REGEX_CELL.exec(raw);
  const body = m ? m[1] : raw;
  const flags = extraFlags + 'u' + ((m && m[2].includes('i')) ? 'i' : '');
  return new RegExp(unicodeBody(body), flags);
}

// ---------------------------------------------------------------------------
// parsePortrait(text) → { status: ok | no-section | no-table | no-rules, rules, notes, tables }
// rule = { line, source, re, cls: stop | positive, hint, exception (prose or regex text), excRe }
export function parsePortrait(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = H2.exec(lines[i]);
    if (!m) continue;
    if (Object.values(KEYWORDS).some((k) => k.section.test(m[1])) || SECTION_NUMBER.test(m[1])) { start = i; break; }
  }
  if (start < 0) return { status: 'no-section', rules: [], notes: [], tables: 0 };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (ANY_H2.test(lines[i])) { end = i; break; }
  const rules = [], notes = [];
  let tables = 0, recognised = 0, i = start + 1;
  while (i < end) {
    if (!TABLE_ROW.test(lines[i])) { i++; continue; }
    const block = [];
    while (i < end && TABLE_ROW.test(lines[i])) block.push({ n: i + 1, s: lines[i++] });
    if (block.length < 2 || !SEPARATOR_ROW.test(block[1].s)) continue;     // a lone `|` line is not a table
    tables++;
    const header = cellsOf(block[0].s);
    const col = {};
    header.forEach((h, idx) => {
      for (const k of Object.values(KEYWORDS))
        for (const [role, re] of Object.entries(k.columns)) if (re.test(h) && !(role in col)) col[role] = idx;
    });
    if (!('pattern' in col) || !('hint' in col)) {
      notes.push(`a table in §8 (line ${block[0].n}) lacks the pattern/hint columns — its header: ${header.join(' · ')}`);
      continue;
    }
    recognised++;
    for (const row of block.slice(2)) {
      const c = cellsOf(row.s);
      const source = unspan(c[col.pattern] || '');
      if (!source || PLACEHOLDER_CELL.test(source)) continue;                // an example row is not a rule
      const hint = c[col.hint] || '';
      const cls = POSITIVE_CLASS.test(unspan(c[col.class] ?? '')) ? 'positive' : 'stop';
      const excRaw = 'exception' in col ? unspan(c[col.exception] || '') : '';
      const exception = excRaw && !PLACEHOLDER_CELL.test(excRaw) && !DASH_CELL.test(excRaw) ? excRaw : '';
      let re;
      try { re = compilePattern(c[col.pattern]); }
      catch (e) { notes.push(`row at line ${row.n}: the pattern «${source}» does not compile — ${e.message}`); continue; }
      let excRe = null;
      const em = REGEX_CELL.exec(exception);
      if (em) {
        try { excRe = new RegExp(unicodeBody(em[1]), 'u' + (em[2].includes('i') ? 'i' : '')); }
        catch (e) { notes.push(`row at line ${row.n}: the exception regex does not compile — ${e.message}`); }
      }
      rules.push({ line: row.n, source, re, cls, hint, exception, excRe });
    }
  }
  if (!recognised) return { status: 'no-table', rules: [], notes, tables };
  if (!rules.length) return { status: 'no-rules', rules: [], notes, tables };
  return { status: 'ok', rules, notes, tables };
}

// The H2 sections of a portrait whose title matches `re` (for `load --sections`) → { text, matched }; the
// head before the first H2 always rides along so the portrait's binding note and corpus registry are never
// dropped. `matched` = 0 means nothing of the body was selected — the caller refuses to write a witness.
export function sectionsMatching(text, re) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  let keep = true, matched = 0;                    // the head before the first H2
  for (const l of lines) {
    const m = H2.exec(l);
    if (m) { keep = re.test(m[1]); if (keep) matched++; }
    if (keep) out.push(l);
  }
  return { text: out.join('\n'), matched };
}

// ---------------------------------------------------------------------------
// The invisible regions of a judged file: fenced code blocks, inline code spans and HTML comments are not the
// owner's prose. They are blanked with spaces so line numbers stay true.
export function visibleLines(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();   // the newline that ends a file is not a line
  let fence = null;
  return lines.map((l) => {
    const f = /^\s*(```|~~~)/.exec(l);
    if (f) { if (!fence) fence = f[1]; else if (f[1] === fence) fence = null; return ''; }
    if (fence) return '';
    return l.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length)).replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
  });
}

// lintText(name, text, rules) → { findings, warnings, silenced, judged }
export function lintText(name, text, rules) {
  const lines = visibleLines(text);
  const findings = [], warnings = [];
  let silenced = 0;
  for (const r of rules) {
    if (r.cls === 'positive') {
      const present = lines.some((l) => { r.re.lastIndex = 0; return r.re.test(l); });
      if (!present) warnings.push({ file: name, rule: r, msg: `required positive «${r.source}» not found in the file → ${r.hint}` });
      continue;
    }
    lines.forEach((l, i) => {
      for (const m of l.matchAll(r.re)) {
        if (r.excRe && r.excRe.test(l)) { silenced++; continue; }
        findings.push({ file: name, line: i + 1, fragment: m[0].slice(0, FRAGMENT_MAX), rule: r });
      }
    });
  }
  return { findings, warnings, silenced, judged: lines.length };
}
export const fmt = (f) => `${f.file}:${f.line} — «${f.fragment}» → ${f.rule.hint}` +
  (f.rule.exception && !f.rule.excRe ? ` (exception: ${f.rule.exception})` : '');

// ---------------------------------------------------------------------------
// The witness — was the portrait in the working context WHILE the text was written?
// witness(marker, portrait, portraitSha, fileMtimeMs) → { findings: [msg…], warnings: [msg…] }
const pad = (n, w = 2) => String(n).padStart(w, '0');
export const localIso = (d) => {
  const off = -d.getTimezoneOffset(), s = off >= 0 ? '+' : '-', a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
};
export const NO_WITNESS = (portrait) => `written past the portrait — no load witness for ${portrait} (${VOICE_MARKER}): run \`node .kaif/tools/kaif-voice-lint.mjs load\` BEFORE the first word, write with the portrait in your working context, then check`;
export function loadsOf(marker) {
  if (!marker) return [];
  const raw = Array.isArray(marker.loads) ? marker.loads : [marker.firstAt, marker.at].filter(Boolean);
  return raw.map((s) => Date.parse(s)).filter(Number.isFinite).sort((a, b) => a - b);
}
export function witness(marker, portrait, portraitSha, fileMtimeMs) {
  const findings = [], warnings = [];
  const loads = loadsOf(marker);
  if (!marker || !loads.length) return { findings: [NO_WITNESS(portrait)], warnings };
  if (marker.portrait && marker.portrait !== portrait)
    return { findings: [`written past the portrait — the load witness is for another portrait (${marker.portrait}), not ${portrait}: load it first`], warnings };
  const before = loads.filter((t) => t <= fileMtimeMs);
  const at = localIso(new Date(fileMtimeMs));
  if (!before.length)
    findings.push(`written past the portrait — the file was last written at ${at}, the portrait was first loaded at ${localIso(new Date(loads[0]))}: the text was written without the portrait in the working context — rewrite it BY the portrait (load first)`);
  else {
    const last = before[before.length - 1], gap = fileMtimeMs - last;
    if (gap > STALE_MINUTES * 60 * 1000)
      findings.push(`written past the portrait — the last load before this text was ${Math.round(gap / 60000)} min earlier (${localIso(new Date(last))}; the file was last written at ${at}): the portrait had left the working context (the hour rule) — reload it and rewrite the text BY it`);
  }
  if (portraitSha && marker.sha256 && marker.sha256 !== portraitSha)
    warnings.push('the portrait changed since it was last loaded (sha differs) — reload it before the next unit');
  return { findings, warnings };
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
function readMarker() {
  try { return JSON.parse(readFileSync(VOICE_MARKER, 'utf8')); } catch { return null; }
}

// ---------------------------------------------------------------------------
function portraitPath() {
  try {
    const j = JSON.parse(readFileSync(MARKER, 'utf8'));
    if (typeof j.voicePortrait === 'string' && j.voicePortrait.trim()) return j.voicePortrait.trim();
  } catch { /* no marker or unreadable — the default name stands */ }
  return DEFAULT_PORTRAIT;
}
function skipped(reason) {
  console.log(`⚠ voice-lint SKIPPED — ${reason}; nothing was judged — ${BOUNDARY} (exit ${EXIT_SKIPPED})`);
  process.exit(EXIT_SKIPPED);
}
function usage(msg) { console.error(`✖ voice-lint: ${msg}\n${USAGE}`); process.exit(EXIT_USAGE); }
function load() {
  const portrait = portraitPath();
  if (!existsSync(portrait)) skipped(`no portrait at ${portrait} (${DEFAULT_PORTRAIT} at the project root, or ${MARKER} → voicePortrait) — nothing to load`);
  const text = readFileSync(portrait, 'utf8');
  let filter = null;
  if (SECTIONS_AT >= 0) {
    if (!SECTIONS_ARG || SECTIONS_ARG.startsWith('--')) usage('--sections needs a regex — nothing loaded, no witness written');
    try { filter = new RegExp(SECTIONS_ARG, 'iu'); } catch (e) { usage(`--sections is not a regex (${e.message}) — nothing loaded, no witness written`); }
  }
  let printed = text;
  if (filter) {
    const sel = sectionsMatching(text, filter);
    if (!sel.matched) usage(`no H2 section of ${portrait} matches --sections ${SECTIONS_ARG} — nothing loaded, no witness written`);
    printed = sel.text;
  }
  process.stdout.write(printed.replace(/\s*$/, '') + '\n');
  const now = new Date(), prev = readMarker();
  const same = prev && prev.portrait === portrait;                     // another portrait starts a new witness
  const loads = (same ? (Array.isArray(prev.loads) ? prev.loads : [prev.firstAt].filter(Boolean)) : []).concat(localIso(now)).slice(-LOADS_KEPT);
  const marker = {
    at: localIso(now), firstAt: loads[0], loads,
    portrait, sha256: sha256(text), sections: filter ? filter.source : 'all',
    lines: printed.split(/\r?\n/).length,
    note: 'the moments are taken by the tool from the system clock; session state, ignored by git; a witness proves the load ran, not that the print was read',
  };
  mkdirSync(dirname(VOICE_MARKER), { recursive: true });
  writeFileSync(VOICE_MARKER, JSON.stringify(marker, null, 2) + '\n');
  console.log(`\n✅ voice-lint load — ${portrait} (${marker.lines} line(s), sections: ${marker.sections}) is now in your working context; witness ${VOICE_MARKER} at ${marker.at} (${loads.length} load(s) on record) — write BY it, then \`check\``);
}
function check() {
  if (!FILES.length) usage('check needs at least one file');
  const missing = FILES.filter((f) => !existsSync(f));
  if (missing.length) usage(`no such file — ${missing.join(', ')}`);
  const portrait = portraitPath();
  if (!existsSync(portrait)) skipped(`no portrait at ${portrait} (${DEFAULT_PORTRAIT} at the project root, or ${MARKER} → voicePortrait)`);
  const portraitText = readFileSync(portrait, 'utf8');
  const p = parsePortrait(portraitText);
  for (const n of p.notes) console.log(`⚠ ${portrait}: ${n}`);
  if (p.status === 'no-section') skipped(`${portrait} has no §8 "Machine heuristics" section`);
  if (p.status === 'no-table') skipped(`§8 of ${portrait} carries no pattern table (${p.tables ? 'its table lacks the pattern/hint columns' : 'prose only'}) — nothing for the linter to read; put the greps into the table pattern · class · hint · exception (the shipped skeleton .kaif/_owner-voice-template.md shows the form)`);
  if (p.status === 'no-rules') skipped(`the §8 table of ${portrait} holds no rule — placeholders are not rules`);
  const stops = p.rules.filter((r) => r.cls === 'stop').length;
  const positives = p.rules.length - stops;
  const marker = readMarker(), pSha = sha256(portraitText);
  const names = FILES.map((f) => f.replace(/\\/g, '/'));
  let nHits = 0, nWitness = 0, nW = 0, judged = 0, silenced = 0;
  // The witness of the whole run first: no witness at all (or one for another portrait) is said ONCE,
  // naming every file, not once per file.
  const runWitness = witness(marker, portrait, pSha, Infinity);
  const perFile = !(runWitness.findings.length && (!loadsOf(marker).length || (marker && marker.portrait && marker.portrait !== portrait)));
  if (!perFile) { nWitness += FILES.length; console.log(`✖ ${runWitness.findings[0]} — ${FILES.length} file(s): ${names.join(', ')}`); }
  FILES.forEach((f, i) => {
    const r = lintText(names[i], readFileSync(f, 'utf8'), p.rules);
    for (const x of r.findings) { nHits++; console.log(`${WARN ? '⚠' : '✖'} ${fmt(x)}`); }
    for (const w of r.warnings) { nW++; console.log(`⚠ ${w.file} — ${w.msg}`); }
    if (perFile) {
      const wv = witness(marker, portrait, pSha, statSync(f).mtimeMs);
      for (const x of wv.findings) { nWitness++; console.log(`✖ ${names[i]} — ${x}`); }
      if (i === 0) for (const x of wv.warnings) { nW++; console.log(`⚠ ${x}`); }
    }
    judged += r.judged; silenced += r.silenced;
  });
  const scope = `${FILES.length} file(s), ${judged} line(s) against ${portrait} §8 (${stops} stop rule(s) · ${positives} positive(s)` +
    (silenced ? ` · ${silenced} hit(s) silenced by a row's exception` : '') + ')';
  const nF = nHits + nWitness;
  if (nF && !(WARN && !nWitness)) {
    console.log(`✖ voice-lint: ${nF} finding(s) in ${scope}${nWitness ? ` — ${nWitness} of them the witness (never muted by --warn)` : ''} — rewrite by the hint, or answer the hit in the portrait's exception column; ${BOUNDARY}`);
    process.exit(EXIT_FINDINGS);
  }
  if (nF) { console.log(`⚠ voice-lint (warn mode): ${nF} hit(s) in ${scope} — calibration, exit 0`); return; }
  console.log(`✅ voice-lint OK — 0 findings${nW ? `, ${nW} warning(s)` : ''} in ${scope}; loaded ${marker.at}; ${BOUNDARY}`);
}

// ---------------------------------------------------------------------------
// selftest — every answer proven on in-memory fixtures, in both shipped languages: the table parses (a
// placeholder row and a broken row are skipped, said aloud), a hit is named with line, fragment and hint, the
// clean text is silent, fenced/inline code is invisible, a `/regex/` exception silences and prose is printed,
// a bare pattern is case-sensitive and `/…/i` folds, `\b` and `\B` are Unicode-aware, `\|` is alternation, a
// positive is warned when absent; a prose §8, a missing §8, a placeholder-only table and a table with foreign
// columns are SKIPPED statuses; the shipped skeleton, unfilled, parses to `no-rules`; the witness: no marker
// → finding, another portrait → finding, a file written before the first load → finding, more than an hour
// after the last load → finding, within the hour of a later load → clean, a changed portrait → warning; the
// `--sections` filter keeps the head and the matching sections and reports zero matches.
const FIX = {
  en: {
    portrait: `# The Owner's Voice Portrait — fixture\n\n## 7. The self-check checklist (layered)\n\n7A — the machine minute.\n\n## 8. Machine heuristics\n\nProse above the table is invisible to the linter.\n\n| pattern | class | hint | legal exception |\n|---|---|---|---|\n| \`<regular expression>\` | \`<stop / positive>\` | \`<what to write instead>\` | \`<…>\` |\n| \`\\b(Remember that\\|Note that)\\b\` | stop | state the rule; the reader is not reminded | a quoted line — |\n| \`/\\bjust\\b/i\` | stop | drop the softener | \`/^>/\` |\n| \`[unbalanced\` | stop | never reached | — |\n| \`/\\bthe rule\\b/i\` | positive | name the rule at least once | — |\n\n### E9 — prose after the table, invisible\n\n## 9. Portrait journal\n`,
    hit: 'One.\nTwo.\nThree.\nFour.\nFive.\nSix.\nRemember that the rule is stated once.\n',
    hitLine: 7, hitFragment: 'Remember that', hitHint: 'state the rule; the reader is not reminded', hitException: 'a quoted line —',
    alternation: 'Note that the rule stands.\n',
    clean: 'The rule is stated once. Nothing else.\n',
    fenced: '```\nRemember that\n```\nThe rule stands.\n',
    inline: 'Run `Remember that` here. The rule stands.\n',
    comment: '<!-- Remember that -->\nThe rule stands.\n',
    silenced: '> just a quote\nThe rule stands.\n',
    folded: 'Just say it. The rule stands.\n',
    caseSensitive: 'note that x. The rule stands.\n',
    positiveMissing: 'Nothing named here.\n',
  },
  ru: {
    portrait: `# Портрет голоса владельца — фикстура\n\n## 7. Чек-лист самопроверки\n\n7A — машинная минута.\n\n## 8. Машинные эвристики\n\nПроза над таблицей линтеру невидима.\n\n| паттерн | класс | подсказка | законное исключение |\n|---|---|---|---|\n| \`<регулярное выражение>\` | \`<стоп / обязательный позитив>\` | \`<что писать вместо>\` | \`<…>\` |\n| \`\\b(Помни, что\\|Не забывай)\\b\` | стоп | правило называется, читателю не напоминают | строка-цитата — |\n| \`\\bты\\b\` | стоп | второе лицо в кодексе не звучит — безличная процедура | \`/^>/\` |\n| \`[незакрытый\` | стоп | не дойдёт | — |\n| \`/\\bправило\\b/i\` | обязательный позитив | назови правило хотя бы раз | — |\n\n## 9. Журнал портрета\n`,
    hit: 'Раз.\nДва.\nТри.\nЧетыре.\nПять.\nШесть.\nПомни, что правило одно.\n',
    hitLine: 7, hitFragment: 'Помни, что', hitHint: 'правило называется, читателю не напоминают', hitException: 'строка-цитата —',
    alternation: 'Не забывай: правило одно.\n',
    clean: 'Правило названо один раз. Больше ничего.\n',
    fenced: '```\nПомни, что\n```\nПравило названо.\n',
    inline: 'Запусти `Помни, что` здесь. Правило названо.\n',
    comment: '<!-- Помни, что -->\nПравило названо.\n',
    silenced: '> ты здесь\nПравило названо.\n',
    folded: 'Здесь ты один. Правило названо.\n',
    caseSensitive: 'Двери открыты. Правило названо.\n',   // `\bты\b` must not fire inside «открыты» — a Unicode boundary
    positiveMissing: 'Ничего не названо.\n',
  },
};
const PROSE_S8 = '# P\n\n## 8. Machine heuristics\n\n≥10 grep patterns … graduate into a project guard.\n\n```\nrg -n "Remember that" rules/\n```\n';
const NO_S8 = '# P\n\n## 7. Checklist\n\nnothing\n';
const FOREIGN_COLUMNS = '# P\n\n## 8. Машинные эвристики\n\n| Правило линтера | Паттерн (ripgrep) | Комментарий |\n|---|---|---|\n| Обращение на «ты» | `\\b(ты\\|тебя)\\b` | 0 в кодексе |\n';
const NUMBERED_ONLY = '# P\n\n## 8. Heuristiques machine\n\n| pattern | class | hint | exception |\n|---|---|---|---|\n| `\\bdonc\\b` | stop | drop it | — |\n';
const NB_PORTRAIT = '# P\n\n## 8. Machine heuristics\n\n| pattern | class | hint | exception |\n|---|---|---|---|\n| `\\Bты\\B` | stop | inside a word only | — |\n';

function selftest() {
  let failed = 0, cases = 0;
  const say = (ok, name) => { cases++; if (!ok) { failed++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); };
  for (const lang of Object.keys(FIX)) {
    const F = FIX[lang];
    const p = parsePortrait(F.portrait);
    say(p.status === 'ok' && p.rules.length === 3, `${lang}: the §8 table parses to 3 rules — the placeholder row and the broken row are not rules (got ${p.status}, ${p.rules.length})`);
    say(p.notes.length === 1 && /does not compile/.test(p.notes[0]), `${lang}: the broken row is named aloud, not swallowed (notes: ${p.notes.length})`);
    say(p.rules.filter((r) => r.cls === 'positive').length === 1, `${lang}: the positive class is recognised`);
    const hit = lintText('sheet/steps.md', F.hit, p.rules);
    say(hit.findings.length === 1 && hit.findings[0].line === F.hitLine && hit.findings[0].fragment === F.hitFragment,
      `${lang}: a hit is named with its line and fragment (got ${hit.findings.map((f) => f.line + ':' + f.fragment).join(',')})`);
    say(hit.findings.length === 1 && fmt(hit.findings[0]) === `sheet/steps.md:${F.hitLine} — «${F.hitFragment}» → ${F.hitHint} (exception: ${F.hitException})`,
      `${lang}: the printed line carries file:line — «fragment» → hint (exception: prose)`);
    say(hit.judged === 7, `${lang}: the trailing newline of a file is not a line (judged ${hit.judged})`);
    say(lintText('a.md', F.alternation, p.rules).findings.length === 1, `${lang}: \\| inside the cell is alternation`);
    say(lintText('a.md', F.clean, p.rules).findings.length === 0, `${lang}: the clean text is silent`);
    say(lintText('a.md', F.fenced, p.rules).findings.length === 0, `${lang}: a fenced code block is invisible`);
    say(lintText('a.md', F.inline, p.rules).findings.length === 0, `${lang}: an inline code span is invisible`);
    say(lintText('a.md', F.comment, p.rules).findings.length === 0, `${lang}: an HTML comment is invisible`);
    const sil = lintText('a.md', F.silenced, p.rules);
    say(sil.findings.length === 0 && sil.silenced === 1, `${lang}: a /regex/ exception silences the hit on its line (silenced ${sil.silenced})`);
    say(lintText('a.md', F.folded, p.rules).findings.length === 1, `${lang}: ${lang === 'en' ? '/…/i folds case' : 'the bare second-person pattern fires on a whole word'}`);
    say(lintText('a.md', F.caseSensitive, p.rules).findings.length === 0, `${lang}: ${lang === 'en' ? 'a bare pattern is case-sensitive' : '\\b is Unicode-aware — «ты» inside «открыты» is not a hit'}`);
    const pm = lintText('a.md', F.positiveMissing, p.rules);
    say(pm.findings.length === 0 && pm.warnings.length === 1 && /required positive/.test(pm.warnings[0].msg), `${lang}: an absent positive is a warning, never a finding`);
    say(lintText('a.md', F.clean, p.rules).warnings.length === 0, `${lang}: a present positive is silent`);
  }
  say(parsePortrait(PROSE_S8).status === 'no-table', 'a prose §8 (greps in a fence, no table) → no-table');
  say(parsePortrait(NO_S8).status === 'no-section', 'a portrait without §8 → no-section');
  const fc = parsePortrait(FOREIGN_COLUMNS);
  say(fc.status === 'no-table' && fc.tables === 1 && fc.notes.length === 1 && /lacks the pattern\/hint columns/.test(fc.notes[0]), 'a §8 table without the hint column → no-table, and the header is named');
  say(parsePortrait(NUMBERED_ONLY).status === 'ok', 'a §8 in a third language is found by its number');
  const nb = parsePortrait(NB_PORTRAIT).rules;
  say(lintText('a.md', 'открытый\n', nb).findings.length === 1 && lintText('a.md', 'а ты б\n', nb).findings.length === 0, '\\B is Unicode-aware — «ты» inside «открытый» is a hit, a standalone «ты» is not');
  // the witness — pure verdicts on synthetic moments
  const T = Date.parse('2026-09-12T14:00:00.000+03:00'), MIN = 60000, P = 'AUTHOR_STYLOMETRY.md';
  const mk = (loads, sha = 'abc', portrait = P) => ({ portrait, loads: loads.map((t) => new Date(t).toISOString()), firstAt: new Date(loads[0]).toISOString(), at: new Date(loads[loads.length - 1]).toISOString(), sha256: sha });
  say(witness(null, P, 'abc', T + MIN).findings.length === 1 && /no load witness/.test(witness(null, P, 'abc', T + MIN).findings[0]), 'witness: no marker → finding "no load witness"');
  say(/another portrait/.test((witness(mk([T], 'abc', 'voice/OTHER.md'), P, 'abc', T + MIN).findings[0] || '')), 'witness: a marker for another portrait → finding');
  say(witness(mk([T]), P, 'abc', T + MIN).findings.length === 0 && witness(mk([T]), P, 'abc', T + MIN).warnings.length === 0, 'witness: loaded, then written within the hour → clean');
  say(/the file was last written at 2026-09-12T13:59/.test(witness(mk([T]), P, 'abc', T - MIN).findings[0] || ''), 'witness: written BEFORE the first load → finding, both moments in the local zone');
  say(/(\d+) min earlier/.test(witness(mk([T]), P, 'abc', T + 90 * MIN).findings[0] || ''), 'witness: written 90 min after the last load → finding (the hour rule)');
  say(witness(mk([T, T + 80 * MIN]), P, 'abc', T + 90 * MIN).findings.length === 0, 'witness: a re-load 10 min before the write → clean (the load history counts)');
  say(witness(mk([T]), P, 'other', T + MIN).warnings.some((w) => /changed since it was last loaded/.test(w)), 'witness: the portrait changed since the load → warning "reload"');
  say(loadsOf({ firstAt: new Date(T).toISOString(), at: new Date(T + MIN).toISOString() }).length === 2, 'witness: a pre-history marker (firstAt/at only) is still read');
  const sec = sectionsMatching(FIX.en.portrait, /^8\./);
  say(sec.matched === 1 && /^# The Owner's Voice Portrait/.test(sec.text) && /## 8\. Machine heuristics/.test(sec.text) && !/## 7\./.test(sec.text) && !/## 9\./.test(sec.text), '--sections keeps the head and the matching sections only');
  say(sectionsMatching(FIX.en.portrait, /^zzz/).matched === 0, '--sections that matches nothing reports zero (the caller refuses to load)');
  const here = dirname(fileURLToPath(import.meta.url));
  const tmpl = [join(here, '..', '_owner-voice-template.md'), join(here, '..', 'templates', '_owner-voice-template.md')].find((p) => existsSync(p));
  if (tmpl) {
    const p = parsePortrait(readFileSync(tmpl, 'utf8'));
    say(p.status === 'no-rules' && p.tables === 1, `the shipped skeleton, unfilled → no-rules (its example rows are placeholders; got ${p.status})`);
  } else console.log('  · the shipped skeleton is not beside the module — its unfilled proof skipped (not a failure)');
  if (failed) { console.error(`✖ voice-lint selftest: ${failed} of ${cases} case(s) FAILED`); process.exit(1); }
  console.log(`✅ voice-lint selftest OK — ${cases} cases, ${Object.keys(FIX).length} languages: a hit is named with line, fragment and hint; code and comments are invisible; exceptions silence or print; a prose §8 is SKIPPED, never green; a text written before the first load or more than an hour after the last one is written past the portrait`);
}

if (CMD === 'check') check();
else if (CMD === 'load') load();
else if (CMD === 'selftest') selftest();
else usage(`unknown command "${CMD}"`);
