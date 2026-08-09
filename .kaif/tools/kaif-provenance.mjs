#!/usr/bin/env node
// kaif-provenance.mjs — the OPTIONAL provenance module for the owner's canon artifacts
// (plan 20 phase 5; owner decision #19: a separate optional module, not core).
// Deployed to .kaif/tools/kaif-provenance.mjs by the installer; does nothing until the project
// declares its canon artifacts.
//
// The convention it mechanizes (AGENT_GUIDE, shipped since 1.6): everything an AI writes into
// the OWNER'S canon artifacts (rulebooks, lore, brand texts — where the owner's word IS the
// content) carries visible paired marks [AI]…[/AI] (AI-written) / [AI-ed]…[/AI-ed] (owner text
// edited by AI). A mark is the acceptance queue: ONLY the owner's word removes it. The field
// asked for this exact cheap gate first: "without tooling the convention rots first, and agents
// start marking everything" (QA field report, 1.6).
//
// Tags quoted in inline code spans (`…`) or fenced code blocks (``` / ~~~) are DOCUMENTATION
// of the convention, not marks — the parser skips them. The deployed KAIF docs themselves quote
// the convention (AGENT_GUIDE, PHILOSOPHY, fable-judge), so the gate must stay green on a fresh
// deployment out of the box.
//
// Declare the canon in .kaif/kaif.json:   "canonArtifacts": ["rules/", "lore/canon.md"]
//   (a path ending in "/" declares a directory subtree; otherwise an exact file path;
//    deployments seed "canonArtifacts": [] — the conscious "no canon yet" state)
// Localized mark pairs (translated wrappers) — also in .kaif/kaif.json:
//   "aiMarks": ["[ИИ]", "[ИИ-ред]"]   — the [AI]- and [AI-ed]-analog open tags; closers are
//   derived ([ИИ] → [/ИИ]); the English pair is always recognized too (bug 34, project B Г8).
// Exit codes: 0 = gate ran green · 1 = violations · 3 = SKIPPED (no canonArtifacts KEY —
//   nothing was proven; check and report agree on this, bug 34 / field report KCam Г7).
//
// Commands:
//   node .kaif/tools/kaif-provenance.mjs report            # where AI text awaits acceptance
//   node .kaif/tools/kaif-provenance.mjs check             # the GATE (wire into your checks/CI):
//                                                          #   · every mark is correctly paired
//                                                          #   · with canonArtifacts declared:
//                                                          #     marks live ONLY in the canon
//                                                          # exit 1 on violations
//   node .kaif/tools/kaif-provenance.mjs accept <file>     # THE OWNER ACCEPTED this file's blocks:
//                                                          # move them to the acceptance registry
//                                                          # (.kaif/provenance-accepted.json) and
//                                                          # strip the marks. An agent must NEVER
//                                                          # run this without the owner's word.
//
// Roadmap (plan 17 §2.1): a git-baseline token-F1 pass (--mark: find and mark unmarked AI text
// mechanically) ships as the second stage; this grep stage is complete and useful on its own.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const CMD = process.argv[2] || 'report';
const ARG = process.argv[3];
const KAIF_JSON = '.kaif/kaif.json';
const REGISTRY = '.kaif/provenance-accepted.json';

const log = (s) => console.log(s);
const die = (s) => { console.error('✖ ' + s); process.exit(1); };
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const slashes = (p) => p.replaceAll('\\', '/'); // registry keys and decl entries use forward slashes
// SKIPPED ≠ passed (bug 34): without a canonArtifacts KEY the gate has nothing to guard —
// exit 3 says "nothing was proven", and check/report AGREE on it (they used to diverge:
// report said "nothing to report" exit 0 while check scanned and failed — field report KCam Г7).
const EXIT_SKIPPED = 3;

// The deployment's marker carries the whole convention: the canon declaration AND the
// LOCALIZED mark pairs. A wholesale-translated wrapper marks its text [ИИ]…[/ИИ], and a
// scanner that knows only the English pair reports "✅ no AI text awaits acceptance" over 91
// waiting blocks — the worst failure direction (bug 34, project B Г8). Declare in kaif.json:
//   "aiMarks": ["[ИИ]", "[ИИ-ред]"]   — the [AI]- and [AI-ed]-analog OPEN tags; closers are
//                                       derived ([ИИ] → [/ИИ]); the English pair always works.
function readMarker() {
  if (!existsSync(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  return JSON.parse(readFileSync(KAIF_JSON, 'utf8').replace(/^﻿/, ''));
}
const MARKER = readMarker();
const DECLARED = Array.isArray(MARKER.canonArtifacts);
const DECL = DECLARED ? MARKER.canonArtifacts.map(slashes) : [];
const PAIRS = [['[AI]', '[/AI]'], ['[AI-ed]', '[/AI-ed]']];
// A DECLARED convention must never be silently ignored (bug 34; judge finding, L3): a
// malformed aiMarks (a string instead of an array, tags without brackets) would quietly
// blind the scanner over waiting blocks — refuse loudly instead.
if ('aiMarks' in MARKER) {
  const okMarks = Array.isArray(MARKER.aiMarks) && MARKER.aiMarks.length
    && MARKER.aiMarks.every((o) => typeof o === 'string' && /^\[.+\]$/.test(o));
  if (!okMarks) die(`malformed "aiMarks" in ${KAIF_JSON} — expected an array of open tags like ["[XX]", "[XX-ed]"] (closers are derived); fix the marker, the convention must not be silently dropped`);
  for (const o of MARKER.aiMarks) PAIRS.push([o, '[/' + o.slice(1)]);
}
const OPEN = PAIRS.map((p) => p[0]);
const CLOSE = Object.fromEntries(PAIRS);
const TAGS = PAIRS.flat().sort((a, b) => b.length - a.length); // longest first — see the guard in lineTags

const inCanon = (p, decl) => decl.some((d) => (d.endsWith('/') ? p.startsWith(d) : p === d));
function requireDeclaredOrSkip() {
  if (DECLARED) return;
  console.log(`⊘ SKIPPED — .kaif/kaif.json declares no canonArtifacts key: the provenance gate has nothing to guard, nothing was proven (declare "canonArtifacts": [] for "no canon yet", or list your canon; deployments seed [] since 2.2). Exit code 3 keeps an unconfigured guard from reading as a passed one (bug 34).`);
  process.exit(EXIT_SKIPPED);
}

// Mark tags on one line, ordered by COLUMN (several pairs may share a line — processing them
// by tag type instead of position produced false nesting errors on correct text). Occurrences
// inside inline code spans (`…`) are quoted documentation, not marks — skipped.
function lineTags(line) {
  const spans = [];
  const spanRe = /`[^`]*`/g;
  let m;
  while ((m = spanRe.exec(line))) spans.push([m.index, m.index + m[0].length]);
  const inSpan = (i) => spans.some(([a, b]) => i >= a && i < b);
  const hits = [];
  for (const tag of TAGS) {
    let idx = -1;
    while ((idx = line.indexOf(tag, idx + 1)) !== -1) {
      // longest-match guard, generic over localized pairs (bug 34): a shorter tag must not
      // claim the head of a longer one starting at the same column ("[AI]" vs "[AI-ed]",
      // "[ИИ]" vs "[ИИ-ред]") — TAGS is sorted longest-first, so the longer tag already hit.
      if (TAGS.some((t2) => t2.length > tag.length && line.startsWith(t2, idx))) continue;
      if (inSpan(idx)) continue;
      hits.push({ tag, idx });
    }
  }
  return hits.sort((a, b) => a.idx - b.idx);
}

// Parse one file into mark blocks; returns { blocks, errors, tagSites }.
// A block: { kind, line, text } — text is EXACTLY what sits between the tags (EOL-normalized,
// so sha/excerpt are stable across CRLF and LF checkouts). tagSites — every recognized tag's
// { line, idx, len }, reused by accept's mark stripping (only real tags are stripped).
// Two legal mark forms:
//   · the PAIRED form — [AI]…[/AI] anywhere, including inline inside a heading;
//   · the HEADING form (the owner's decision, 2.2) — a LONE open tag on a heading line marks
//     the whole section, until the next heading of the same-or-higher level, with NO paired
//     close (a close tag inside such a section is a notation error named precisely).
function parseMarks(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  const blocks = [];
  const errors = [];
  const tagSites = [];
  let open = null; // { kind, line, si, ci } — si/ci: 0-based line / column right after the open tag
  let fence = false;
  let lastHeading = null; // { kind, line, endLine } — the last heading-form block's span (exclusive end)
  const clean = (l) => l.replace(/\r$/, '');
  const headingOf = (l) => { const m = l.match(/^(#{1,6})\s/); return m ? m[1].length : 0; };
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]);
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    const hLevel = headingOf(line);
    const tags = lineTags(line);
    // Heading form: exactly one tag on a heading line, it is an OPEN tag, and no pair is open —
    // the section is the block. An open+close pair on the same heading stays the paired form.
    if (hLevel && !open && tags.length === 1 && OPEN.includes(tags[0].tag)) {
      const { tag, idx } = tags[0];
      tagSites.push({ line: i, idx, len: tag.length });
      let j = i + 1, f2 = false;
      for (; j < lines.length; j++) {
        const l2 = clean(lines[j]);
        if (/^\s*(```|~~~)/.test(l2)) { f2 = !f2; continue; }
        if (f2) continue;
        const h2 = headingOf(l2);
        if (h2 && h2 <= hLevel) break;   // the boundary: same-or-higher heading (or EOF)
      }
      const headText = (line.slice(0, idx) + line.slice(idx + tag.length)).replace(/\s+$/, '');
      blocks.push({ kind: tag, line: i + 1, text: [headText, ...lines.slice(i + 1, j).map(clean)].join('\n') });
      lastHeading = { kind: tag, line: i + 1, endLine: j };
      continue;   // the section's INNER lines are still scanned normally (a stray close must be caught)
    }
    for (const { tag, idx } of tags) {
      tagSites.push({ line: i, idx, len: tag.length });
      if (OPEN.includes(tag)) {
        if (open) { errors.push(`${path}:${i + 1} — ${tag} opened while ${open.kind} from line ${open.line} is still open (nesting is not allowed)`); }
        else open = { kind: tag, line: i + 1, si: i, ci: idx + tag.length };
      } else {
        const wanted = open ? CLOSE[open.kind] : null;
        if (!open) {
          if (lastHeading && i < lastHeading.endLine && tag === CLOSE[lastHeading.kind])
            errors.push(`${path}:${i + 1} — ${tag} closes the HEADING-form ${lastHeading.kind} from line ${lastHeading.line}, but the heading form spans its section and takes NO close — remove ${tag} (or make the mark an inline pair)`);
          else errors.push(`${path}:${i + 1} — stray ${tag} with no open mark`);
        }
        else if (tag !== wanted) errors.push(`${path}:${i + 1} — ${tag} closes ${open.kind} from line ${open.line} (expected ${wanted})`);
        else {
          const text = open.si === i
            ? line.slice(open.ci, idx)
            : [clean(lines[open.si]).slice(open.ci), ...lines.slice(open.si + 1, i).map(clean), line.slice(0, idx)].join('\n');
          blocks.push({ kind: open.kind, line: open.line, text });
          open = null;
        }
      }
    }
  }
  if (open) errors.push(`${path}:${open.line} — ${open.kind} never closed`);
  return { blocks, errors, tagSites };
}

// The machinery's own transients (tasks, the thin entry point) legally QUOTE the mark
// convention while describing release news — scanning them red-flagged the gate on the
// machinery's own output (bug 34, project B Г7).
const TRANSIENTS = ['KAIF.md', 'KAIF_UPDATE_TASK.md', 'KAIF_ADAPTATION_TASK.md', 'KAIF_UPDATE_TASK.superseded.md'];
function* walkMd(dir = '.') {
  for (const n of readdirSync(dir)) {
    const p = (dir === '.' ? '' : dir + '/') + n;
    if (['.git', 'node_modules', '.kaif'].includes(n)) continue;
    if (dir === '.' && TRANSIENTS.includes(n)) continue;
    if (statSync(p).isDirectory()) { yield* walkMd(p); continue; }
    if (/\.md$/i.test(n)) yield p;
  }
}

function cmdCheck() {
  requireDeclaredOrSkip();
  const decl = DECL;
  let issues = 0;
  for (const p of walkMd()) {
    const { blocks, errors } = parseMarks(p);
    for (const e of errors) { console.error('✖ ' + e); issues++; }
    // "marks live only in the canon" applies once a canon IS declared non-empty — with an
    // empty declaration (the conscious "no canon yet" state) only mark hygiene is checked.
    if (blocks.length && decl.length && !inCanon(p, decl)) {
      console.error(`✖ ${p} carries ${blocks.length} provenance mark block(s) but is NOT a declared canon artifact — marks live only in canonArtifacts (declare it in .kaif/kaif.json, or remove the marks: agents must not mark everything)`);
      issues++;
    }
  }
  if (issues) die(`provenance check FAILED: ${issues} issue(s)`);
  log(`✅ provenance check OK${decl.length ? '' : ' (canonArtifacts declared empty — no canon yet; only mark hygiene was checked)'}`);
}

function cmdReport() {
  requireDeclaredOrSkip();
  const decl = DECL;
  if (!decl.length) { log('✅ canonArtifacts is declared EMPTY (no canon yet) — nothing awaits acceptance'); return; }
  let total = 0;
  for (const p of walkMd()) {
    if (!inCanon(p, decl)) continue;
    const { blocks, errors } = parseMarks(p);
    for (const e of errors) console.error('⚠ ' + e);
    if (!blocks.length) continue;
    log(`${p} — ${blocks.length} block(s) awaiting the owner's acceptance:`);
    for (const b of blocks) log(`  · line ${b.line} ${b.kind} ${b.text.trim().split('\n')[0].slice(0, 80)}`);
    total += blocks.length;
  }
  log(total ? `${total} block(s) total — acceptance is the OWNER'S word, then: kaif-provenance accept <file>` : '✅ no AI text awaits acceptance in the declared canon');
}

function cmdAccept() {
  if (!ARG) die('usage: kaif-provenance accept <file>   — run ONLY after the owner said the file is accepted');
  const file = slashes(ARG);
  if (!existsSync(file)) die(`no such file: ${file}`);
  if (DECL.length && !inCanon(file, DECL)) console.error(`⚠ ${file} is not a declared canon artifact — accepting on the owner's word anyway, but marks normally live only in canonArtifacts`);
  const { blocks, errors, tagSites } = parseMarks(file);
  if (errors.length) { for (const e of errors) console.error('✖ ' + e); die('fix mark pairing before accepting'); }
  if (!blocks.length) die(`${file} carries no provenance marks — nothing to accept`);
  const reg = existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8').replace(/^﻿/, '')) : { accepted: [] };
  const date = new Date().toISOString().slice(0, 10);
  for (const b of blocks) reg.accepted.push({ file, date, kind: b.kind, sha: sha(b.text), excerpt: b.text.trim().split('\n')[0].slice(0, 80) });
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2) + '\n');
  // Strip ONLY the tags the parser recognized (quoted documentation stays), right-to-left per
  // line; a line that was nothing but a tag disappears entirely — no blank-line scars.
  const lines = readFileSync(file, 'utf8').split('\n');
  const byLine = new Map();
  for (const s of tagSites) { if (!byLine.has(s.line)) byLine.set(s.line, []); byLine.get(s.line).push(s); }
  const drop = new Set();
  for (const [ln, sites] of byLine) {
    let l = lines[ln];
    for (const s of sites.sort((a, b) => b.idx - a.idx)) l = l.slice(0, s.idx) + l.slice(s.idx + s.len);
    if (l.replace(/\r$/, '').trim()) lines[ln] = l; else drop.add(ln);
  }
  writeFileSync(file, lines.filter((_, i) => !drop.has(i)).join('\n'));
  log(`✔ accepted ${blocks.length} block(s) in ${file} — marks stripped, registry updated (${REGISTRY}). This action carries the owner's word.`);
}

({ check: cmdCheck, report: cmdReport, accept: cmdAccept }[CMD] ||
  (() => die(`unknown command: ${CMD} (report | check | accept <file>)`)))();
