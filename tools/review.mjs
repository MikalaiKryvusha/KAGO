#!/usr/bin/env node
// tools/review.mjs — the owner-review contour: render + server + decision record + signal + queue.
//
// This is the heart of the contour described by `.claude/skills/owner-reviews/SKILL.md`. It turns an
// interview document (md, the SOURCE — I1) into a local page, opens that page in a separate app
// window, calls the owner out loud, waits with infinite patience, records the decision in three
// places and then DIES so the waiting agent wakes up (I8).
//
// Zero external dependencies by design: Node stdlib + the browser that is already installed.
// Every document read goes through tools/lib/review-core.mjs — a duplicated parser is a second
// truth (contract C1). Nothing here re-implements the core.
//
// ---------------------------------------------------------------------------------------------
// !! T7 WARNING — READ BEFORE EDITING THE PAGE SOURCE BELOW !!
// This file BUILDS HTML/CSS/JS as strings. A backtick inside a template literal drops the whole
// module with a syntax error reported in an unrelated place, and the document text we render is
// FULL of backticks (`nvidia-smi`, `researches/03`, ...). Therefore: the page source uses ordinary
// single-quoted strings joined with Array.join ONLY — no template literals anywhere in PAGE_CSS,
// PAGE_JS or buildPage(). Keep it that way.
// ---------------------------------------------------------------------------------------------
//
// Usage:
//   node tools/review.mjs <document.md> [--no-serve] [--out <file.html>] [--no-signal] [--batch]
//   --no-serve     build the HTML and EXIT (C9: a synchronous caller must never hang)
//   --out <file>   where the built HTML goes (default: beside the decisions dir)
//   --no-signal    build/serve without calling the owner
//   --batch        one "N accumulated" page over every waiting document in the directory (I7)
//   --timeout N    automation only (DEF5): N seconds of tolerated SILENCE, never a thinking deadline
//   --by <name>    who is answering (P4: the page never ASKS, the server always STAMPS)
//   --no-open      do not raise a browser window (for a QA run that drives its own browser)
//
// Exit codes — the agent learns of the outcome by this process TERMINATING (I31):
//   0   decision recorded (or a notice marked read — I37)
//   3   page closed without an answer
//   130 interrupted by the human
//
// [NOT-TESTED] at birth — no automated suite covers this module yet; the QA run (C10/QA1-QA7)
// belongs to tools/verify-review-contour.mjs.

import { createServer, get as httpGet } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import * as core from './lib/review-core.mjs';

// ---------------------------------------------------------------------------------------------
// 0. Constants. The DEF* values are the owner-approved canonical envelope (SKILL.md → DEF1-DEF8);
//    a project departs from them only on the OWNER's word, so they live here by name, not inline.
// ---------------------------------------------------------------------------------------------

const PROJECT = 'KAGO';                        // P9 — the owner runs several projects
const OWNER = 'Mikalai Kryvusha';              // P4 — stamped, never asked

const DEF1_BEEPS = [[880, 160], [660, 160], [990, 260]];
const DEF2_CLOSE_ATTEMPT = 2000;               // window.close() attempt after the record
const DEF2_CLOSE_RESERVE = 2000;               // ...then the honest "please close me" notice
const DEF3_DEATH_AFTER_RECORD = 2500;          // technical pause so the window can leave
const DEF4_PULSE_MS = 15000;                   // page -> server pulse (/alive)
const DEF5_TIMEOUT_S = 0;                      // infinite patience (I9) — 0, not "a big number"
const DEF5_TICK_MS = 15000;                    // the silence check ticks every 15 s
const DEF6_SILENCE_MS = 180000;                // 3 min margin against background throttling (T4)
const DEF6_BEACON_GRACE_MS = 3000;             // a reload is not a close (T3)
const DEF6_STRIKES = 2;                        // two strikes against machine sleep (T5)
const DEF7_BEEP_DEADLINE_MS = 8000;
const DEF7_VOICE_TIMEOUT_MS = 60000;
const DEF8_WINDOW_SIZE = '--window-size=1100,900';
// No quiet hours on this project — the owner's word (interview 002, 2026-08-14): «окна тихих часов
// в этом проекте не делаем. Можно звать меня 24 часа в сутки». A zero-width window is no window
// (inQuietHours: a === b → false); --quiet-from/--quiet-to still take a per-run window if ever needed.
const QUIET_FROM = '00:00';
const QUIET_TO = '00:00';

// ---------------------------------------------------------------------------------------------
// 1. Small local helpers. NOTE: none of these duplicate the core — escaping an ATTRIBUTE value is
//    not parsing a document, and every path that shows DOCUMENT TEXT goes through
//    core.renderMarkdown (P8/I24) via inlineMd()/blockMd() below.
// ---------------------------------------------------------------------------------------------

/** Escape a value we put into an HTML attribute or a <title>. Never used for document body text. */
function attr(s) {
  return String(s == null ? '' : s)
    .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}

/** Document text rendered as a block. I24 — this is the ONE node that strips service comments. */
function blockMd(s) {
  return core.renderMarkdown(String(s == null ? '' : s));
}

/**
 * Document text rendered INLINE (a heading, an option label). Still goes through the core renderer
 * — bypassing it to "just escape" a heading is exactly how the service markers re-leaked in the
 * field pilot (I24) — and the paragraph wrapping is peeled off.
 *
 * PEELS EVERY PARAGRAPH, not just a single one (`bugs/01` → P8/P1). `core.renderMarkdown` emits one
 * `<p>` per SOURCE line, so an option label that wraps in the document — which is every option of
 * the live interview 001 — came back as a STACK of paragraphs, the single-paragraph peel was
 * skipped, and block markup landed inside a `<span>` and inside an `<h3>`.
 *
 * [TESTED: 2026-08-09 · tools/verify-review-contour.mjs block P8]
 */
function inlineMd(s) {
  const html = blockMd(s).trim();
  if (/^(?:<p>[\s\S]*?<\/p>\s*)+$/u.test(html)) {
    return html.split(/<\/p>\s*<p>/u).join(' ').replace(/^<p>/u, '').replace(/<\/p>$/u, '');
  }
  return html;
}

/** Plain text for the <title> tag and the voice phrase: markdown symbols stripped, not escaped. */
function plainText(s) {
  return String(s == null ? '' : s)
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/[*_`#~>|]/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Russian plural: 1 вопрос / 2 вопроса / 5 вопросов. The voice phrase reads this out loud. */
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** True when every character is ASCII — the gate on anything that may ride a command line. */
function isAscii(s) {
  return /^[\x20-\x7E]*$/u.test(String(s));
}

// ---------------------------------------------------------------------------------------------
// 2. Document metadata and shaping
// ---------------------------------------------------------------------------------------------

/**
 * The metadata block from the document head (the name contract in SKILL.md): a fenced YAML-ish
 * front matter with `title` / `kind`. The core deliberately knows nothing about it — the core
 * parses QUESTIONS — so this tiny reader lives here. `kind: notice` is what makes I37/I38 possible.
 */
function readMeta(text) {
  const meta = {};
  const src = core.normalize(text);
  const m = src.match(/^---\n([\s\S]*?)\n---\n/u);
  if (m) {
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/u);
      if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/gu, '');
    }
  }
  // A marker anywhere in the body is the second, cheaper way to declare the class — a notice does
  // not always deserve a front matter block.
  const marker = src.match(/<!--\s*owner-review:kind\s+([a-z-]+)\s*-->/u);
  if (marker && !meta.kind) meta.kind = marker[1];
  return meta;
}

/** The front matter is machinery, not the owner's text — it never reaches the page. */
function stripFrontMatter(text) {
  return core.normalize(text).replace(/^---\n[\s\S]*?\n---\n/u, '');
}

/**
 * Cut a document into the ORDERED parts the page shows: prose segments and question cards, in the
 * order they stand in the source.
 *
 * WHY: an owner facing bare options answers "I don't know what we are deciding here" (SKILL.md,
 * field pilot). Prose carries "what has already been checked on your machine" and "what I decided
 * myself" — dropping any of it turns an interview into a quiz.
 *
 * WHY THE SHAPE CHANGED (`bugs/01` → A1, A2). The previous version reconstructed only a HEAD and a
 * TAIL: prose sitting between two questions never reached the page at all, and an epilogue with no
 * heading after it was dropped, because the tail was found by scanning for a heading. Both are the
 * same defect — the page rebuilt the document instead of walking it. It now walks it, and the block
 * boundaries come from the CORE (C1) rather than from a second copy of the rule here; that second
 * copy is what diverged.
 *
 * [TESTED: 2026-08-09 · tools/verify-review-contour.mjs blocks A1/A2 — both red before this change]
 */
function splitDocument(text) {
  const lines = core.normalize(text).split('\n');
  const ranges = core.questionBlockRanges(text);

  // The front matter is machinery, not the owner's text, and the page header already carries the
  // H1 (P9) — so the walk starts after both.
  let start = 0;
  if (lines[0] !== undefined && lines[0].trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (/^(-{3,}|\.{3})\s*$/u.test(lines[i])) { start = i + 1; break; }
    }
  }
  for (let i = start; i < lines.length; i++) {
    if (/^#\s+/u.test(lines[i])) { start = i + 1; break; }
    if (ranges.length && i >= ranges[0].start) break;   // a question came first: there is no H1
  }

  const parts = [];
  const prose = (from, to) => {
    const t = lines.slice(Math.max(from, start), Math.max(to, start)).join('\n').trim();
    if (t) parts.push({ kind: 'prose', text: t });
  };

  let cursor = start;
  for (let i = 0; i < ranges.length; i++) {
    prose(cursor, ranges[i].start);
    parts.push({ kind: 'question', index: i });
    cursor = ranges[i].end;
  }
  prose(cursor, lines.length);
  return parts;
}

/** Load one document into the shape the page and the server both use. */
function loadDoc(file, queue) {
  const full = resolve(file);                 // T10: resolve, never join — a document outside the
  const text = readFileSync(full, 'utf8');    // repository must not greet the owner with a stack
  const doc = core.parseInterview(text, { file: full });
  const meta = readMeta(text);
  const base = basename(full).replace(/\.md$/iu, '');

  // I37: a notice is a NAMED class, declared by metadata (or, as a convenience, by the file name).
  const isNotice = meta.kind === 'notice' || /^notice[_-]/iu.test(base);

  const parts = splitDocument(text);
  const answered = doc.questions.filter((q) => q.answered).length;
  const awaiting = doc.questions.length - answered;

  const noticeState = (queue.notices || []).find((n) => n.file === basename(full)) || null;

  return {
    key: base,
    file: full,
    name: basename(full),
    text,
    doc,
    meta,
    isNotice,
    title: meta.title || doc.title || base,
    parts,
    answered,
    awaiting,
    noticeRead: !!(noticeState && noticeState.read),
  };
}

/**
 * Is this document still waiting for the OWNER — that is, does the contour have anything left to
 * raise a window for?
 *
 * TWO QUESTIONS THAT WERE ONE, AND HAD TO BE SPLIT (`bugs/01` → B5). "Is this interview CLOSED?" is
 * the agent's question and its truth is the document's `**Status:**` line — closing an interview
 * means propagating the answers to their declared targets and only then changing the status
 * (`AGENT_GUIDE.md`). "Has the owner anything left to click?" is the CONTOUR's question, and the
 * contour answers it by counting. Binding the second to the first meant the queue never cleared
 * itself: nothing in the contour writes that status line, so an interview whose every question was
 * answered stayed "waiting" forever, and `refreshQueue`'s promise that a woken agent can read how
 * many are left was hollow. In session 2 the status was flipped by hand at closure, which MASKED it.
 *
 * The protective direction of rule 4 is kept intact: a status that says CLOSED still closes the
 * document, whatever the fields say. Only the stuck-open direction is fixed.
 *
 * [TESTED: 2026-08-09 · tools/verify-review-contour.mjs block B5 — red before this change]
 */
function isWaiting(d) {
  if (d.isNotice) return !d.noticeRead;
  if (d.doc.statusIsWaiting === false) return false;      // the agent declared it closed — believe it
  if (d.doc.questions.length) return d.awaiting > 0;      // countable: has the owner clicks left?
  return d.doc.statusIsWaiting === true;                  // nothing to count — the status is all there is
}

// ---------------------------------------------------------------------------------------------
// 3. The page — CSS
//    P5: both OS themes through prefers-color-scheme, every color a variable. Rake 6: dark-on-dark
//    code blocks were caught by the OWNER, not by a self-check — hence explicit --codebg/--codefg.
// ---------------------------------------------------------------------------------------------

const PAGE_CSS = [
  '*{box-sizing:border-box}',
  ':root{',
  '--bg:#f6f6f4;--fg:#1a1c1a;--muted:#5b615e;--card:#ffffff;--line:#e2e2de;',
  '--acc:#0b62c4;--acc-soft:#e6f0fb;--ok:#166534;--err:#b42318;',
  '--st-answered:#166534;--st-await:#c07000;--st-none:#8b9299;',
  '--codebg:#eeeeea;--codefg:#1a1c1a;--chip:#ececea;--field:#ffffff;',
  '}',
  '@media (prefers-color-scheme: dark){:root{',
  '--bg:#131619;--fg:#e7eaec;--muted:#9aa3ac;--card:#1b1f24;--line:#2b3138;',
  '--acc:#61a6f2;--acc-soft:#1d2a38;--ok:#43b95a;--err:#ff8a80;',
  '--st-answered:#43b95a;--st-await:#e8b13a;--st-none:#6b737b;',
  '--codebg:#232830;--codefg:#e7eaec;--chip:#262c33;--field:#12151a;',
  '}}',
  'html,body{margin:0;padding:0}',
  'body{background:var(--bg);color:var(--fg);',
  'font:16px/1.55 "Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif;',
  '-webkit-text-size-adjust:100%}',
  '.wrap{max-width:920px;margin:0 auto;padding:20px 18px 96px}',
  '.hdr{position:sticky;top:0;z-index:5;background:var(--bg);',
  'border-bottom:1px solid var(--line);padding:14px 0 12px;margin-bottom:20px}',
  '.proj{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--acc);font-weight:700}',
  '.hdr h1{font-size:23px;line-height:1.25;margin:6px 0 8px;font-weight:650}',
  '.sum{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;color:var(--muted)}',
  '.sum b{color:var(--fg)}',
  '.pill{display:inline-block;padding:2px 9px;border-radius:999px;background:var(--chip);',
  'border:1px solid var(--line);font-size:12px}',
  '.pill.ok{color:var(--st-answered)}.pill.await{color:var(--st-await)}.pill.none{color:var(--st-none)}',
  '.bar{margin-top:9px;display:flex;flex-wrap:wrap;gap:10px;font-size:13px}',
  '.note{padding:6px 10px;border-radius:8px;border:1px solid var(--line);background:var(--card)}',
  '.note.warn{border-color:var(--err);color:var(--err)}',
  '.note.good{border-color:var(--st-answered);color:var(--st-answered)}',
  '.docsec{margin:0 0 34px}',
  '.docsec h2.dt{font-size:17px;margin:0 0 4px;font-weight:650}',
  '.docsec .dmeta{font-size:12.5px;color:var(--muted);margin:0 0 14px}',
  '.md{overflow-wrap:anywhere}',
  '.md h2,.md h3,.md h4{font-size:16px;margin:16px 0 6px;font-weight:650}',
  '.md p{margin:8px 0}.md ul{margin:8px 0 8px 20px;padding:0}.md li{margin:4px 0}',
  '.md blockquote{margin:10px 0;padding:6px 12px;border-left:3px solid var(--line);color:var(--muted)}',
  '.md hr{border:0;border-top:1px solid var(--line);margin:16px 0}',
  '.md code{background:var(--codebg);color:var(--codefg);padding:1px 5px;border-radius:4px;',
  'font-family:Consolas,"Cascadia Mono",monospace;font-size:.92em}',
  '.md pre{background:var(--codebg);color:var(--codefg);padding:12px;border-radius:8px;overflow-x:auto}',
  '.md pre code{background:none;padding:0}',
  '.tw{overflow-x:auto}.md table{border-collapse:collapse;width:100%;font-size:14px}',
  '.md th,.md td{border:1px solid var(--line);padding:6px 9px;text-align:left}',
  '.intro{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;',
  'margin:0 0 20px}',
  '.card{background:var(--card);border:1px solid var(--line);border-left:5px solid var(--st-none);',
  'border-radius:12px;padding:15px 17px;margin:0 0 18px}',
  '.card[data-state="answered"]{border-left-color:var(--st-answered)}',
  '.card[data-state="await"]{border-left-color:var(--st-await)}',
  '.card[data-state="none"]{border-left-color:var(--st-none)}',
  '.chead{display:flex;flex-wrap:wrap;gap:9px;align-items:baseline;margin-bottom:4px}',
  '.tag{font-size:11.5px;font-weight:700;letter-spacing:.04em;padding:2px 9px;border-radius:999px;',
  'border:1px solid currentColor;white-space:nowrap}',
  '.tag.answered{color:var(--st-answered)}.tag.await{color:var(--st-await)}.tag.none{color:var(--st-none)}',
  '.card h3{font-size:16.5px;margin:0;font-weight:650;flex:1 1 260px}',
  '.target{font-size:12.5px;color:var(--muted);margin:2px 0 10px}',
  '.prev{margin:10px 0;padding:9px 12px;border-radius:8px;background:var(--acc-soft);font-size:14px}',
  '.opts{margin:14px 0 4px;display:flex;flex-direction:column;gap:8px}',
  '.opt{display:flex;gap:11px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);',
  'border-radius:10px;cursor:pointer;background:var(--bg);touch-action:manipulation}',
  '.opt:hover{border-color:var(--acc)}',
  '.opt.sel{border-color:var(--acc);background:var(--acc-soft);box-shadow:inset 0 0 0 1px var(--acc)}',
  '.opt input{position:absolute;width:1px;height:1px;opacity:0;margin:0;pointer-events:none}',
  '.dot{flex:0 0 auto;width:20px;height:20px;margin-top:1px;border-radius:50%;',
  'border:2px solid var(--muted);display:inline-block;position:relative;cursor:pointer}',
  '.opt.sel .dot{border-color:var(--acc)}',
  '.opt.sel .dot::after{content:"";position:absolute;left:3px;top:3px;width:10px;height:10px;',
  'border-radius:50%;background:var(--acc)}',
  '.otext{flex:1 1 auto}',
  '.oletter{font-weight:700;margin-right:4px}',
  '.orec{display:inline-block;margin-left:6px;font-size:11.5px;font-weight:700;color:var(--acc);',
  'border:1px solid var(--acc);border-radius:999px;padding:1px 7px;white-space:nowrap}',
  '.fl{display:block;margin:12px 0 0}',
  '.fl>span{display:block;font-size:12.5px;color:var(--muted);margin-bottom:4px}',
  'textarea{width:100%;min-height:64px;resize:vertical;background:var(--field);color:var(--fg);',
  'border:1px solid var(--line);border-radius:9px;padding:9px 11px;font:inherit;font-size:14.5px}',
  'textarea:focus{outline:2px solid var(--acc);outline-offset:1px;border-color:var(--acc)}',
  '.notices{margin-top:10px;border-top:1px dashed var(--line);padding-top:20px}',
  '.notices>h2{font-size:15px;color:var(--muted);margin:0 0 14px;font-weight:650}',
  '.btn{font:inherit;font-size:15px;font-weight:600;padding:10px 20px;border-radius:10px;',
  'border:1px solid var(--acc);background:var(--acc);color:#fff;cursor:pointer}',
  '.btn:hover{filter:brightness(1.08)}',
  '.btn:disabled{opacity:.55;cursor:default}',
  '.btn.sec{background:var(--card);color:var(--fg);border-color:var(--line)}',
  '.foot{position:sticky;bottom:0;background:var(--bg);border-top:1px solid var(--line);',
  'padding:12px 0 14px;margin-top:26px;display:flex;flex-wrap:wrap;gap:12px;align-items:center}',
  '#status{font-size:14px}',
  '#status.err{color:var(--err);font-weight:600}',
  '#status.ok{color:var(--st-answered);font-weight:600}',
  '#rescue{margin-top:16px;border:2px solid var(--err);border-radius:12px;padding:14px 16px;',
  'background:var(--card)}',
  '#rescue h3{margin:0 0 6px;font-size:15px;color:var(--err)}',
  '#rescue p{margin:0 0 10px;font-size:14px}',
  '#rescue textarea{min-height:190px;font-family:Consolas,"Cascadia Mono",monospace;font-size:13px}',
  '#rescue .row{display:flex;gap:10px;margin-top:10px;flex-wrap:wrap}',
  '.legal{margin-top:22px;font-size:12px;color:var(--muted)}',
  '@media (max-width:620px){.wrap{padding:14px 12px 90px}.hdr h1{font-size:20px}}',
].join('\n');

// ---------------------------------------------------------------------------------------------
// 4. The page — client JS
//    Same T7 discipline: single-quoted Node strings, double-quoted JS strings, zero backticks.
// ---------------------------------------------------------------------------------------------

const PAGE_JS = [
  '(function(){',
  '"use strict";',
  'var C = window.KAGO_REVIEW;',
  'var D = document, W = window;',
  'var state = {};',
  'var saved = false, closeTimer = null, leaving = false;',
  '',
  '// --- state shape mirrors the decision record: answers[Qn] = {choice,text,comment} (I2/C6).',
  'function ensureDoc(k){ if(!state[k]) state[k] = {comment:"", noticeRead:false, answers:{}}; return state[k]; }',
  'function ensureQ(k,q){ var d = ensureDoc(k); if(!d.answers[q]) d.answers[q] = {choice:null,text:"",comment:""}; return d.answers[q]; }',
  'for (var di=0; di<C.docs.length; di++){ var dd=C.docs[di]; var st=ensureDoc(dd.key); st.noticeRead = !!dd.noticeRead;',
  '  for (var qi=0; qi<dd.questions.length; qi++) ensureQ(dd.key, dd.questions[qi]); }',
  '',
  '// --- I12: the draft lives in localStorage. Insurance never lives inside the thing it insures',
  '// against — the server is exactly the part that dies. T6: the port is part of the origin, so a',
  '// SECOND window on a new port cannot see this draft; that is why the tool holds a lock (I29).',
  'function plu(n,a,b,c){ var x=Math.abs(n)%100, y=x%10; if(x>10&&x<20) return c; if(y>1&&y<5) return b; if(y===1) return a; return c; }',
  'function dkey(){ return "kago-review:" + C.storageKey; }',
  'function saveDraft(){ try { W.localStorage.setItem(dkey(), JSON.stringify(state)); } catch(e){} }',
  'function loadDraft(){',
  '  var n = 0;',
  '  try {',
  '    var raw = W.localStorage.getItem(dkey());',
  '    if(!raw) return 0;',
  '    var old = JSON.parse(raw);',
  '    for (var k in old){ if(!state[k]) continue;',
  '      if (old[k].comment){ state[k].comment = old[k].comment; n++; }',
  '      if (old[k].noticeRead && !state[k].noticeRead){ state[k].noticeRead = true; n++; }',
  '      var a = old[k].answers || {};',
  '      for (var q in a){ if(!state[k].answers[q]) continue;',
  '        if (a[q].choice){ state[k].answers[q].choice = a[q].choice; n++; }',
  '        if (a[q].text){ state[k].answers[q].text = a[q].text; n++; }',
  '        if (a[q].comment){ state[k].answers[q].comment = a[q].comment; n++; }',
  '      }',
  '    }',
  '  } catch(e){ return 0; }',
  '  return n;',
  '}',
  '',
  '// --- P3 SELECTION MECHANICS, field-corrected twice. The activation is taken over on',
  '// pointerdown with preventDefault, so the native label duplicate cannot exist by construction;',
  '// a click on the FIELD (the radio dot) toggles — a second click CLEARS — while a click on the',
  '// LABEL TEXT selects but never clears. Disabled inputs are skipped.',
  'function act(lab, mode){',
  '  var k = lab.getAttribute("data-doc"), q = lab.getAttribute("data-q"), L = lab.getAttribute("data-letter");',
  '  var a = ensureQ(k,q);',
  '  if (mode === "toggle") a.choice = (a.choice === L) ? null : L;',
  '  else a.choice = L;',
  '  paint(); saveDraft();',
  '}',
  'function bindOptions(){',
  '  var list = D.querySelectorAll(".opt");',
  '  for (var i=0;i<list.length;i++){',
  '    (function(lab){',
  '      var inp = lab.querySelector("input");',
  '      lab.addEventListener("pointerdown", function(ev){',
  '        if (inp && inp.disabled) return;',
  '        ev.preventDefault();',
  '        var t = ev.target, onField = false;',
  '        if (t && t.closest) onField = !!t.closest(".dot") || !!t.closest("input");',
  '        act(lab, onField ? "toggle" : "select");',
  '        if (inp){ try { inp.focus(); } catch(e){} }',
  '      });',
  '      lab.addEventListener("click", function(ev){ ev.preventDefault(); });',
  '      if (inp) inp.addEventListener("keydown", function(ev){',
  '        if (ev.key === " " || ev.key === "Enter"){ ev.preventDefault(); act(lab, "toggle"); }',
  '      });',
  '    })(list[i]);',
  '  }',
  '}',
  '',
  'function bindFields(){',
  '  var list = D.querySelectorAll("textarea[data-doc]");',
  '  for (var i=0;i<list.length;i++){',
  '    (function(ta){',
  '      ta.addEventListener("input", function(){',
  '        var k = ta.getAttribute("data-doc"), q = ta.getAttribute("data-q"), f = ta.getAttribute("data-field");',
  '        if (f === "doccomment") ensureDoc(k).comment = ta.value;',
  '        else ensureQ(k,q)[f] = ta.value;',
  '        saveDraft(); paintSummary();',
  '      });',
  '    })(list[i]);',
  '  }',
  '  var reads = D.querySelectorAll(".readbtn");',
  '  for (var j=0;j<reads.length;j++){',
  '    (function(b){',
  '      b.addEventListener("click", function(){',
  '        var k = b.getAttribute("data-doc");',
  '        ensureDoc(k).noticeRead = !ensureDoc(k).noticeRead;',
  '        paint(); saveDraft();',
  // I38: a pure-notice page has nothing else to save, so the explicit mark IS the record.
  '        if (C.onlyNotices && ensureDoc(k).noticeRead) doSave();',
  '      });',
  '    })(reads[j]);',
  '  }',
  '}',
  '',
  'function paintFields(){',
  '  var list = D.querySelectorAll("textarea[data-doc]");',
  '  for (var i=0;i<list.length;i++){',
  '    var ta = list[i], k = ta.getAttribute("data-doc"), q = ta.getAttribute("data-q"), f = ta.getAttribute("data-field");',
  '    var v = (f === "doccomment") ? ensureDoc(k).comment : ensureQ(k,q)[f];',
  '    if (ta.value !== v) ta.value = v || "";',
  '  }',
  '}',
  'function paintOptions(){',
  '  var list = D.querySelectorAll(".opt");',
  '  for (var i=0;i<list.length;i++){',
  '    var lab = list[i];',
  '    var k = lab.getAttribute("data-doc"), q = lab.getAttribute("data-q"), L = lab.getAttribute("data-letter");',
  '    var on = ensureQ(k,q).choice === L;',
  '    if (on) lab.classList.add("sel"); else lab.classList.remove("sel");',
  '    lab.setAttribute("aria-checked", on ? "true" : "false");',
  '    var inp = lab.querySelector("input"); if (inp) inp.checked = on;',
  '  }',
  '}',
  'function paintNotices(){',
  '  var list = D.querySelectorAll(".readbtn");',
  '  for (var i=0;i<list.length;i++){',
  '    var b = list[i], k = b.getAttribute("data-doc");',
  '    var on = ensureDoc(k).noticeRead;',
  '    b.textContent = on ? (C.onlyNotices ? "Отмечено как прочитанное" : "Отмечено — нажмите «Сохранить»") : "Прочитано";',
  '    if (on) b.classList.remove("sec"); else b.classList.add("sec");',
  '  }',
  '}',
  '// The header summary (P2) counts what is DRAFTED right now, not only what is on disk — the',
  '// owner must see their own work reflected before it is saved.',
  'function paintSummary(){',
  '  var chosen = 0;',
  '  for (var k in state){ var a = state[k].answers; for (var q in a){ if (a[q].choice || (a[q].text||"").trim()) chosen++; } }',
  '  var el = D.getElementById("drafted");',
  '  if (el) el.textContent = chosen ? ("в работе: " + chosen) : "";',
  '  var btn = D.getElementById("save");',
  '  if (btn && !saved) btn.textContent = chosen ? ("Сохранить ответы (" + chosen + ")") : "Сохранить";',
  '}',
  'function paint(){ paintFields(); paintOptions(); paintNotices(); paintSummary(); }',
  '',
  'function setStatus(text, cls){',
  '  var el = D.getElementById("status");',
  '  if (!el) return;',
  '  el.textContent = text;',
  '  el.className = cls || "";',
  '}',
  '',
  '// --- I13: the pulse. The page says OUT LOUD the moment the server goes silent — the human',
  '// learns of the trouble immediately, not an hour later at the click.',
  'var pulseMiss = 0, pulseTimer = null;',
  'function setPulse(ok, why){',
  '  var el = D.getElementById("pulse");',
  '  if (!el) return;',
  '  if (ok){ el.className = "note good"; el.textContent = "Связь с агентом есть."; }',
  '  else { el.className = "note warn"; el.textContent = "Сервер молчит (" + why + "). Не закрывайте страницу: ваш текст сохранён в браузере, кнопка «Сохранить» покажет его целиком."; }',
  '}',
  'function pulse(){',
  // `bugs/01` (I13, found by three lenses): the server DIES on purpose ~2.5 s after a successful
  // save, and an uncleared pulse then painted the red "Сервер молчит" warning right beside the green
  // "Записано" — the contour frightening the owner about a save that had just worked.
  '  if (!C.serve || saved) return;',
  '  try {',
  '    var xhr = new XMLHttpRequest();',
  '    xhr.open("GET", "/alive?t=" + Date.now(), true);',
  '    xhr.timeout = 8000;',
  '    xhr.onload = function(){ if (xhr.status === 200){ pulseMiss = 0; setPulse(true, ""); } else { pulseMiss++; setPulse(false, "ответ " + xhr.status); } };',
  '    xhr.onerror = function(){ pulseMiss++; setPulse(false, "нет ответа"); };',
  '    xhr.ontimeout = function(){ pulseMiss++; setPulse(false, "таймаут"); };',
  '    xhr.send();',
  '  } catch(e){ pulseMiss++; setPulse(false, "ошибка запроса"); }',
  '}',
  '',
  '// --- I10/I11 THE HUMAN WORK IS SACRED. Every call that carries it sits in try/catch, and there',
  '// is no path where the save button ends up disabled with no error shown: the button state is',
  '// decided by the single flag "saved" in finally.',
  'function payload(){',
  '  var out = {documents:{}};',
  '  for (var k in state){',
  '    var s = state[k], any = false, doc = {comment:(s.comment||"").trim(), noticeRead:!!s.noticeRead, answers:{}};',
  '    if (doc.comment || doc.noticeRead) any = true;',
  '    for (var q in s.answers){',
  '      var a = s.answers[q];',
  '      var c = a.choice || null, t = (a.text||"").trim(), m = (a.comment||"").trim();',
  '      if (!c && !t && !m) continue;',
  '      doc.answers[q] = {choice:c, text:t, comment:m};',
  '      any = true;',
  '    }',
  '    if (any) out.documents[k] = doc;',
  '  }',
  '  return out;',
  '}',
  'function dump(){',
  '  var L = [];',
  '  L.push("Проект " + C.project + " — ответы владельца, " + new Date().toLocaleString());',
  '  for (var i=0;i<C.docs.length;i++){',
  '    var d = C.docs[i], s = state[d.key];',
  '    if (!s) continue;',
  '    L.push(""); L.push("=== " + d.name + " ===");',
  '    if (s.noticeRead) L.push("[отмечено как прочитанное]");',
  '    for (var qi=0; qi<d.questions.length; qi++){',
  '      var q = d.questions[qi], a = s.answers[q] || {};',
  '      if (!a.choice && !(a.text||"").trim() && !(a.comment||"").trim()) continue;',
  '      L.push("");',
  '      L.push(q + ": " + (a.choice || "(без варианта)"));',
  '      if ((a.text||"").trim()) L.push("  ответ словами: " + a.text);',
  '      if ((a.comment||"").trim()) L.push("  комментарий: " + a.comment);',
  '    }',
  '    if ((s.comment||"").trim()){ L.push(""); L.push("Комментарий ко всему документу:"); L.push(s.comment); }',
  '  }',
  '  return L.join("\\n");',
  '}',
  'function showRescue(msg){',
  '  setStatus("НЕ СОХРАНИЛОСЬ: " + msg + ". Ваш текст цел — он ниже, скопируйте его.", "err");',
  '  var box = D.getElementById("rescue");',
  '  if (!box) return;',
  '  box.hidden = false;',
  '  var ta = D.getElementById("rescuetext");',
  '  if (ta) ta.value = dump();',
  '  box.scrollIntoView({block:"nearest"});',
  '}',
  'function doSave(){',
  '  var btn = D.getElementById("save");',
  '  if (btn) btn.disabled = true;',
  '  setStatus("Сохраняю…", "");',
  '  var done = function(err, json){',
  '    try {',
  '      if (err) showRescue(err);',
  '      else { saved = true; onSaved(json); }',
  '    } finally {',
  '      if (btn) btn.disabled = saved;',
  '    }',
  '  };',
  '  if (!C.serve){ done("страница собрана без сервера (--no-serve), принимать ответы некому", null); return; }',
  '  try {',
  '    var body = JSON.stringify(payload());',
  '    var xhr = new XMLHttpRequest();',
  '    xhr.open("POST", "/save", true);',
  '    xhr.setRequestHeader("Content-Type", "application/json;charset=utf-8");',
  '    xhr.timeout = 20000;',
  '    xhr.onload = function(){',
  '      var j = null;',
  '      try { j = JSON.parse(xhr.responseText); } catch(e){ j = null; }',
  '      if (xhr.status === 200 && j && j.ok) done(null, j);',
  '      else done((j && j.error) ? j.error : ("сервер ответил " + xhr.status), null);',
  '    };',
  '    xhr.onerror = function(){ done("сервер недоступен", null); };',
  '    xhr.ontimeout = function(){ done("сервер не ответил за 20 секунд", null); };',
  '    xhr.send(body);',
  '  } catch(e){ done("сбой в браузере: " + (e && e.message ? e.message : e), null); }',
  '}',
  '',
  '// --- I27/DEF2: auto-close is an ATTEMPT, never a promise. If the browser refuses, the page says',
  '// so honestly instead of hanging as if nothing happened.',
  'function onSaved(j){',
  '  if (pulseTimer){ W.clearInterval(pulseTimer); pulseTimer = null; }',
  '  setPulse(true, "");',
  '  setStatus("Записано: " + (j && j.summary ? j.summary : "решение сохранено") + ". Окно попробует закрыться само.", "ok");',
  '  try { W.localStorage.removeItem(dkey()); } catch(e){}',
  '  W.setTimeout(function(){ try { W.close(); } catch(e){} }, C.closeAttempt);',
  '  closeTimer = W.setTimeout(function(){',
  '    setStatus("Записано. Браузер не дал закрыть окно — закройте меня, пожалуйста.", "ok");',
  '  }, C.closeAttempt + C.closeReserve);',
  '}',
  '',
  '// --- I14/DEF6/T3: closing the page is an EVENT for the server. pagehide also fires on reload,',
  '// so the SERVER waits ~3 s for the page to come back before deciding anything.',
  'W.addEventListener("pagehide", function(){',
  '  leaving = true;',
  '  if (closeTimer) { W.clearTimeout(closeTimer); closeTimer = null; }',
  '  try { if (C.serve && navigator.sendBeacon) navigator.sendBeacon("/closed", "bye"); } catch(e){}',
  '});',
  '',
  'function boot(){',
  '  var restored = loadDraft();',
  '  paint();',
  '  bindOptions();',
  '  bindFields();',
  '  var r = D.getElementById("restored");',
  '  if (r && restored > 0){ r.hidden = false; r.textContent = "Восстановлено " + restored + " " + plu(restored, "поле", "поля", "полей") + " из черновика в браузере."; }',
  '  var btn = D.getElementById("save");',
  '  if (btn) btn.addEventListener("click", doSave);',
  '  var rc = D.getElementById("rescuecopy");',
  '  if (rc) rc.addEventListener("click", function(){',
  '    var ta = D.getElementById("rescuetext");',
  '    if (!ta) return;',
  '    var ok = false;',
  '    try { ta.focus(); ta.select(); ok = D.execCommand("copy"); } catch(e){ ok = false; }',
  '    if (!ok && navigator.clipboard){ try { navigator.clipboard.writeText(ta.value); ok = true; } catch(e){} }',
  '    rc.textContent = ok ? "Скопировано" : "Скопируйте вручную (Ctrl+A, Ctrl+C)";',
  '  });',
  '  var rr = D.getElementById("rescueretry");',
  '  if (rr) rr.addEventListener("click", function(){ doSave(); });',
  '  if (C.serve){ pulse(); pulseTimer = W.setInterval(pulse, C.pulseMs); }',
  '  else { setPulse(false, "страница собрана без сервера"); }',
  '}',
  'if (D.readyState === "loading") D.addEventListener("DOMContentLoaded", boot); else boot();',
  '})();',
].join('\n');

// ---------------------------------------------------------------------------------------------
// 5. The page — HTML assembly
// ---------------------------------------------------------------------------------------------

/** One question card: stripe (P1), state tag (P2), FULL body, options (P3), comment (P7). */
function renderQuestion(d, q) {
  const state = q.answered ? 'answered' : (d.doc.statusIsWaiting === false ? 'none' : 'await');
  const tagText = q.answered ? 'отвечено' : (state === 'await' ? 'ждёт вас' : 'без ответа');
  const out = [];

  out.push('<article class="card" data-state="' + state + '" data-q="' + attr(q.id) + '">');
  out.push('<div class="chead">');
  out.push('<span class="tag ' + state + '">' + tagText + '</span>');
  out.push('<h3>' + inlineMd(q.heading) + '</h3>');
  out.push('</div>');

  // I18: the declared answer target, when the question carries one — the owner sees what unblocks.
  if (q.answerTarget) {
    out.push('<p class="target">Ответ уходит в: ' + inlineMd(q.answerTarget) + '</p>');
  }

  // The FULL body. An owner facing bare options answers "I don't know what we are deciding here".
  if (q.bodyText) out.push('<div class="md">' + blockMd(q.bodyText) + '</div>');

  // An already-given answer stays visible — and it goes through the renderer too (I24), otherwise
  // the service markers written by a previous save leak straight back onto the page.
  if (q.answered) {
    out.push('<div class="prev"><b>Уже отвечено:</b> ' + blockMd(q.answer) + '</div>');
  }
  if (q.comment) {
    out.push('<div class="prev"><b>Комментарий в документе:</b> ' + blockMd(q.comment) + '</div>');
  }

  if (q.options.length) {
    out.push('<div class="opts" role="radiogroup">');
    for (const o of q.options) {
      const label = [o.label, o.text].filter(Boolean).join(' ');
      out.push('<label class="opt" role="radio" aria-checked="false" data-doc="' + attr(d.key) +
        '" data-q="' + attr(q.id) + '" data-letter="' + attr(o.letter) + '">');
      out.push('<input type="radio" name="' + attr(d.key + '-' + q.id) + '" value="' + attr(o.letter) + '">');
      out.push('<span class="dot"></span>');
      out.push('<span class="otext"><span class="oletter">' + attr(o.letter) + '.</span> ' + inlineMd(label) +
        (o.recommended ? '<span class="orec">рекомендую</span>' : '') + '</span>');
      out.push('</label>');
    }
    out.push('</div>');
  }

  out.push('<label class="fl"><span>Ответ своими словами (если ни один вариант не подходит)</span>' +
    '<textarea data-doc="' + attr(d.key) + '" data-q="' + attr(q.id) + '" data-field="text" rows="2"></textarea></label>');
  // P7: a comment field per question. C6: a comment is a thought, not a decision — it never closes
  // the question, so an ANSWERED question still gets one.
  out.push('<label class="fl"><span>Комментарий к вопросу (не считается ответом)</span>' +
    '<textarea data-doc="' + attr(d.key) + '" data-q="' + attr(q.id) + '" data-field="comment" rows="2"></textarea></label>');
  out.push('</article>');
  return out.join('\n');
}

/** One notice card (I37): body plus an EXPLICIT mark. No options — a notice asks nothing. */
function renderNotice(d) {
  const out = [];
  out.push('<article class="card" data-state="' + (d.noticeRead ? 'answered' : 'await') + '" data-notice="' + attr(d.key) + '">');
  out.push('<div class="chead">');
  out.push('<span class="tag ' + (d.noticeRead ? 'answered' : 'await') + '">' + (d.noticeRead ? 'прочитано' : 'к сведению') + '</span>');
  out.push('<h3>' + inlineMd(d.title) + '</h3>');
  out.push('</div>');
  out.push('<p class="target">Ответ не требуется — это уведомление. Отметьте, что прочитали.</p>');
  out.push('<div class="md">' + blockMd(stripFrontMatter(d.text)) + '</div>');
  out.push('<label class="fl"><span>Комментарий (по желанию)</span>' +
    '<textarea data-doc="' + attr(d.key) + '" data-q="" data-field="doccomment" rows="2"></textarea></label>');
  out.push('<p class="fl"><button type="button" class="btn sec readbtn" data-doc="' + attr(d.key) + '">Прочитано</button></p>');
  out.push('</article>');
  return out.join('\n');
}

/** The whole page. P9: the project name AND the document title — a title alone hides who asks. */
function buildPage(model) {
  const questionDocs = model.docs.filter((d) => !d.isNotice);
  const noticeDocs = model.docs.filter((d) => d.isNotice);

  const totalQ = questionDocs.reduce((n, d) => n + d.doc.questions.length, 0);
  const totalAnswered = questionDocs.reduce((n, d) => n + d.answered, 0);
  const totalAwaiting = totalQ - totalAnswered;

  const headline = model.batch
    ? ('Накопилось для вас: ' + model.docs.length + ' ' +
       plural(model.docs.length, 'документ', 'документа', 'документов'))
    : model.docs[0].title;

  const out = [];
  out.push('<!doctype html>');
  out.push('<html lang="ru">');
  out.push('<head>');
  out.push('<meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width,initial-scale=1">');
  out.push('<title>' + attr(PROJECT + ' — ' + plainText(headline)) + '</title>');
  out.push('<style>');
  out.push(PAGE_CSS);
  out.push('</style>');
  out.push('</head>');
  out.push('<body>');
  out.push('<div class="wrap">');

  // --- header (P9 + the visible answered/awaiting summary) -------------------------------------
  out.push('<header class="hdr">');
  out.push('<div class="proj">Проект ' + attr(PROJECT) + ' · вопросы к владельцу</div>');
  out.push('<h1>' + inlineMd(headline) + '</h1>');
  out.push('<div class="sum">');
  out.push('<span class="pill ok">отвечено ' + totalAnswered + '</span>');
  out.push('<span class="pill await">ждёт вас ' + totalAwaiting + '</span>');
  out.push('<span class="pill none">всего вопросов ' + totalQ + '</span>');
  if (noticeDocs.length) {
    out.push('<span class="pill none">уведомлений ' + noticeDocs.length + '</span>');
  }
  out.push('<span id="drafted"></span>');
  out.push('</div>');
  out.push('<div class="bar">');
  out.push('<span id="pulse" class="note">Проверяю связь с агентом…</span>');
  out.push('<span id="restored" class="note" hidden></span>');
  out.push('</div>');
  out.push('</header>');

  // --- question documents ----------------------------------------------------------------------
  for (const d of questionDocs) {
    out.push('<section class="docsec">');
    if (model.batch) {
      out.push('<h2 class="dt">' + inlineMd(d.title) + '</h2>');
      out.push('<p class="dmeta">' + attr(d.name) + ' · отвечено ' + d.answered + ' из ' +
        d.doc.questions.length + '</p>');
    }
    // The WHOLE document, in source order: prose where the document has prose, a card where it has
    // a question. Nothing between the cards is dropped (`bugs/01` → A1, A2).
    for (const part of d.parts) {
      if (part.kind === 'prose') { out.push('<div class="intro md">' + blockMd(part.text) + '</div>'); continue; }
      const q = d.doc.questions[part.index];
      if (q) out.push(renderQuestion(d, q));
    }

    // Previously recorded document-wide comments come back to the owner (they accumulate, C6).
    for (const c of d.doc.documentComments) {
      out.push('<div class="intro md"><p><b>Ваш комментарий от ' + attr(c.at) + ':</b></p>' +
        blockMd(c.text) + '</div>');
    }

    // P7: the document-wide comment. A comment with no answers is a legitimate outcome.
    out.push('<label class="fl"><span>Комментарий ко всему документу (можно оставить только его)</span>' +
      '<textarea data-doc="' + attr(d.key) + '" data-q="" data-field="doccomment" rows="3"></textarea></label>');
    out.push('</section>');
  }

  // --- notices, strictly BELOW the questions (I38: questions block work, notices do not) --------
  if (noticeDocs.length) {
    out.push('<section class="notices">');
    out.push('<h2>Уведомления — ответа не требуют</h2>');
    for (const d of noticeDocs) out.push(renderNotice(d));
    out.push('</section>');
  }

  // --- footer: save, status, rescue ring (I11) ---------------------------------------------------
  out.push('<div class="foot">');
  out.push('<button type="button" class="btn" id="save">Сохранить</button>');
  out.push('<span id="status"></span>');
  out.push('</div>');

  out.push('<div id="rescue" hidden>');
  out.push('<h3>Запись не удалась — но ваш текст здесь</h3>');
  out.push('<p>Сервер не принял ответы. Ничего не потеряно: полный текст ниже, скопируйте его и ' +
    'отправьте агенту, либо нажмите «Повторить» — черновик также лежит в браузере.</p>');
  out.push('<textarea id="rescuetext" spellcheck="false"></textarea>');
  out.push('<div class="row">');
  out.push('<button type="button" class="btn" id="rescuecopy">Скопировать</button>');
  out.push('<button type="button" class="btn sec" id="rescueretry">Повторить</button>');
  out.push('</div>');
  out.push('</div>');

  out.push('<p class="legal">Страница собрана из документа ' + attr(model.docs.map((d) => d.name).join(', ')) +
    ' · ' + attr(core.humanTime(new Date())) + ' · отвечает ' + attr(model.by) +
    '. Источник правды — сам md-документ, страница лишь его показывает.</p>');
  out.push('</div>');

  // --- configuration for the client. JSON with "<" escaped so nothing can close the script tag. --
  const cfg = {
    project: PROJECT,
    serve: !!model.serve,
    pulseMs: DEF4_PULSE_MS,
    closeAttempt: DEF2_CLOSE_ATTEMPT,
    closeReserve: DEF2_CLOSE_RESERVE,
    storageKey: model.storageKey,
    onlyNotices: questionDocs.length === 0 && noticeDocs.length > 0,
    docs: model.docs.map((d) => ({
      key: d.key,
      name: d.name,
      isNotice: d.isNotice,
      noticeRead: d.noticeRead,
      questions: d.doc.questions.map((q) => q.id),
    })),
  };
  out.push('<script>window.KAGO_REVIEW=' + JSON.stringify(cfg).replace(/</gu, '\\u003c') + ';</script>');
  out.push('<script>');
  out.push(PAGE_JS);
  out.push('</script>');
  out.push('</body>');
  out.push('</html>');
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------
// 6. The queue — a STATE FILE (I7). Live documents are NEVER moved: moving them breaks every link
//    to them from status and plans.
// ---------------------------------------------------------------------------------------------

function syncQueue(dir, docs) {
  const q = core.readQueue(dir);
  q.items = Array.isArray(q.items) ? q.items : [];
  q.notices = Array.isArray(q.notices) ? q.notices : [];
  const at = core.isoLocal(new Date());

  for (const d of docs) {
    const list = d.isNotice ? q.notices : q.items;
    let row = list.find((r) => r.file === d.name);
    if (!row) {
      row = d.isNotice
        ? { file: d.name, title: plainText(d.title), read: false, at: null, by: null }
        : { file: d.name, title: plainText(d.title), awaiting: d.awaiting };
      list.push(row);
    }
    row.title = plainText(d.title);
    if (!d.isNotice) row.awaiting = d.awaiting;
    row.lastShownAt = at;
  }
  core.writeQueue(dir, q);
  return q;
}

/**
 * Re-read the documents from disk after a save and rewrite the queue from what is actually there.
 *
 * WHY: the queue is the contour's memory of what still waits, and I8 makes RE-RAISING the page the
 * AGENT's duty. An agent that woke on our termination must be able to read "how many are left"
 * from the state file rather than guessing. Returns that count.
 */
function refreshQueue(model) {
  const queue = core.readQueue(model.dir);
  const fresh = [];
  for (const d of model.docs) {
    try { fresh.push(loadDoc(d.file, queue)); } catch { /* the document may have been moved away */ }
  }
  syncQueue(model.dir, fresh);
  return fresh.filter(isWaiting).length;
}

/**
 * I38: "delivered" is an EXPLICIT mark and nothing else, and the mark is contour STATE — it lives
 * HERE, never inside the owner's document. A notice marked read with no comment must leave that
 * document byte-for-byte untouched, which is exactly what this function guarantees by only
 * touching queue.json.
 */
function markNoticeRead(dir, d, { by, at, comment }) {
  const q = core.readQueue(dir);
  q.items = Array.isArray(q.items) ? q.items : [];
  q.notices = Array.isArray(q.notices) ? q.notices : [];
  let row = q.notices.find((r) => r.file === d.name);
  if (!row) { row = { file: d.name, title: plainText(d.title) }; q.notices.push(row); }
  row.read = true;
  row.at = at;
  row.by = by;
  if (comment) row.comment = comment;
  core.writeQueue(dir, q);
}

// ---------------------------------------------------------------------------------------------
// 7. The lock — I29/T6: one document, one window. Two windows are two calls AND two different
//    drafts, because the port is part of the web origin.
// ---------------------------------------------------------------------------------------------

/**
 * The lock is keyed by the DOCUMENT, never by the run (`bugs/01` → B6). A batch run used to lock a
 * single key `_batch`, so it could never collide with a single-document window on a document it was
 * itself showing — "one document, one window" simply did not hold, and two windows are two drafts on
 * two ports (T6). A run now takes one lock per document it shows.
 *
 * [TESTED: 2026-08-09 · tools/verify-review-contour.mjs block B6 — red before this change]
 */
function lockPath(decisionsDir, key) {
  return join(decisionsDir, '.review-lock-' + key + '.json');
}

/** Read a lock file, or null when there is none / it is unreadable. */
function readLock(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

/**
 * Is a recorded lock actually alive?
 *
 * T11 (Windows): a process search by COMMAND-LINE substring finds the search itself. We never
 * search — we ask the OS about a specific pid (signal 0 kills nothing) and then knock on the
 * recorded address. Both must answer.
 */
function lockIsLive(lock, cb) {
  if (!lock || !lock.pid || !lock.address) return cb(false);
  if (lock.pid === process.pid) return cb(false);
  try {
    process.kill(lock.pid, 0);
  } catch (e) {
    // EPERM means the pid exists but belongs to someone else — that still counts as alive.
    if (!e || e.code !== 'EPERM') return cb(false);
  }
  let settled = false;
  const done = (v) => { if (!settled) { settled = true; cb(v); } };
  try {
    const req = httpGet(lock.address + '/alive', (res) => {
      res.resume();
      done(res.statusCode === 200);
    });
    req.setTimeout(1500, () => { req.destroy(); done(false); });
    req.on('error', () => done(false));
  } catch {
    done(false);
  }
}

// ---------------------------------------------------------------------------------------------
// 8. The signal (I5, I28, I32-I34, C8, DEF1, DEF7)
// ---------------------------------------------------------------------------------------------

/**
 * Route choice is a PURE function (I35): both branches are decidable without a sound card, so a
 * check can cover them on any machine.
 */
function chooseSignalRoute({ platform, quiet, enabled }) {
  if (!enabled) return { beeps: false, voice: false, reason: 'сигнал выключен флагом --no-signal' };
  if (quiet) return { beeps: false, voice: false, reason: 'тихие часы ' + QUIET_FROM + '–' + QUIET_TO };
  if (platform === 'win32') return { beeps: true, voice: true, reason: 'Windows: [console]::beep + SAPI' };
  return { beeps: false, voice: false, reason: 'платформа ' + platform + ': системного голоса нет' };
}

/**
 * The call phrase: document type + name + the COUNT of unanswered questions. The owner decides
 * "now or after the current task" BEFORE opening the page. Markdown symbols are stripped — in the
 * field markdown leaked into the voice (C8).
 *
 * "KAGO" is spelled in Cyrillic for the synthesizer: a Russian voice reads a Latin word as letters
 * or skips it entirely.
 */
function callPhrase(model) {
  const say = (s) => plainText(s).replace(/\bKAGO\b/gu, 'КАГО').replace(/\bKAIF\b/gu, 'КАЙФ');
  const head = 'Проект КАГО. ';

  if (model.batch) {
    const n = model.docs.length;
    const q = model.docs.reduce((a, d) => a + (d.isNotice ? 0 : d.awaiting), 0);
    let s = head + 'Накопилось ' + n + ' ' + plural(n, 'документ', 'документа', 'документов') + ' для вас. ';
    s += q > 0
      ? ('Без ответа ' + q + ' ' + plural(q, 'вопрос', 'вопроса', 'вопросов') + '.')
      : 'Вопросов нет, только уведомления.';
    return say(s);
  }

  const d = model.docs[0];
  if (d.isNotice) {
    return say(head + 'Уведомление: ' + d.title + '. Ответ не требуется, нужно только прочитать.');
  }
  const q = d.awaiting;
  return say(head + 'Интервью: ' + d.title + '. ' +
    (q > 0
      ? ('Без ответа ' + q + ' ' + plural(q, 'вопрос', 'вопроса', 'вопросов') + '.')
      : 'Вопросов без ответа нет, нужна ваша вычитка.'));
}

/** Spawn a detached child with a hard deadline. Never awaited by the caller (I32). */
function spawnWithDeadline(cmd, args, opts, deadlineMs, onDone) {
  let child;
  try {
    child = spawn(cmd, args, Object.assign({ stdio: 'ignore', windowsHide: true }, opts || {}));
  } catch (e) {
    if (onDone) onDone(e);
    return null;
  }
  const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, deadlineMs);
  child.on('error', (e) => { clearTimeout(timer); if (onDone) onDone(e); });
  child.on('close', () => { clearTimeout(timer); if (onDone) onDone(null); });
  return child;
}

/**
 * Fire the call. STRICTLY AFTER the page is up (I5) and never blocking the server (I32): speech
 * synthesis takes seconds and the owner would stare at an empty window.
 *
 * Chain order (I33): instant sound first, voice second — a parallel launch lays the beep over the
 * speech. Rake 3: exit 0 does not prove the owner heard, so the phrase is also PRINTED.
 */
function fireSignal(model, opts) {
  const route = chooseSignalRoute({
    platform: process.platform,
    quiet: core.inQuietHours(new Date(), opts.quietFrom, opts.quietTo),
    enabled: opts.signal,
  });
  const phrase = callPhrase(model);

  console.log('');
  if (!route.beeps && !route.voice) {
    // Rake 3 in reverse: never print a line that LOOKS like a delivered call when nothing sounded.
    console.log('БЕЗ ЗОВА: ' + route.reason + '. Позовите владельца сами, страница уже открыта.');
    console.log('          фраза была бы такой: ' + phrase);
    return;
  }
  // Rake 3: an exit code does not prove the owner heard, so the phrase is PRINTED as plain text.
  console.log('ЗОВ: ' + phrase);
  console.log('     маршрут — ' + route.reason);

  const speak = () => {
    if (!route.voice) return;
    // The phrase travels through a FILE and its path through an ENV VAR, so the powershell command
    // line stays pure ASCII no matter what the text or the user profile name contains.
    let phraseFile;
    try {
      phraseFile = join(tmpdir(), 'kago-review-phrase-' + process.pid + '.txt');
      writeFileSync(phraseFile, phrase, 'utf8');
    } catch {
      console.log('     голос: не смог записать файл с фразой — озвучки не будет');
      return;
    }
    const ps = [
      '$p=$env:KAGO_REVIEW_PHRASE;',
      '$t=[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8);',
      'Add-Type -AssemblyName System.Speech;',
      '$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;',
      '$s.Speak($t);',
      '$s.Dispose()',
    ].join(' ');
    if (!isAscii(ps)) { console.log('     голос: команда не ASCII — отменяю'); return; }
    spawnWithDeadline(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { env: Object.assign({}, process.env, { KAGO_REVIEW_PHRASE: phraseFile }) },
      DEF7_VOICE_TIMEOUT_MS,
      () => { try { unlinkSync(phraseFile); } catch { /* best effort */ } },
    );
  };

  if (route.beeps) {
    // DEF1: 880/160 → 660/160 → 990/260. The beep goes through the SOUND CARD, not through a
    // native notification — those get muted silently with a success exit code (I34, rake 3).
    const beepCmd = DEF1_BEEPS.map((b) => '[console]::beep(' + b[0] + ',' + b[1] + ')').join(';');
    if (isAscii(beepCmd)) {
      spawnWithDeadline(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', beepCmd],
        {},
        DEF7_BEEP_DEADLINE_MS,
        speak,                       // I33: the voice starts only after the beeps are done
      );
      return;
    }
  }
  speak();
}

// ---------------------------------------------------------------------------------------------
// 9. The window (I26, DEF8) — a separate app window, never a tab in the owner's working browser.
//    Auto-close (I27) is only possible in a window the script itself opened.
// ---------------------------------------------------------------------------------------------

function findBrowser() {
  if (process.platform !== 'win32') return null;
  const env = process.env;
  const candidates = [
    ['Edge', join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
    ['Edge', join(env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
    ['Chrome', join(env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['Chrome', join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['Chrome', join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')],
  ];
  for (const [name, path] of candidates) {
    if (path && existsSync(path)) return { name, path };
  }
  return null;
}

function openWindow(url) {
  const browser = findBrowser();
  if (browser) {
    try {
      spawn(browser.path, ['--app=' + url, DEF8_WINDOW_SIZE], { detached: true, stdio: 'ignore' }).unref();
      // I27 in miniature: report the ACTION, never the outcome. Spawning the browser we found on
      // disk does not prove the window that appears belongs to it — observed 2026-08-09, when Edge
      // was found and launched, and the page came up in Chrome because the system handed the URL
      // on. A line claiming "a separate Edge window" would have been a small, confident lie.
      console.log('ОКНО: запросил отдельное окно ' + browser.name + ' (' + DEF8_WINDOW_SIZE + ')');
      console.log('      Если система открыла другим браузером — так решила она, не контур.');
      return true;
    } catch { /* fall through to the honest fallback */ }
  }
  // The honest fallback (DEF8): a plain tab — and the page cannot close itself from a tab, so we
  // say so instead of promising an auto-close that will never happen (I27).
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
    console.log('ОКНО: не нашёл Edge или Chrome — открыл ОБЫЧНОЙ ВКЛАДКОЙ.');
    console.log('      Такую вкладку страница закрыть не сможет — закройте её, пожалуйста, сами.');
    return true;
  } catch (e) {
    console.log('ОКНО: не смог открыть браузер (' + (e && e.message) + '). Адрес выше — откройте вручную.');
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// 10. The server, the waiting loop and the three outcomes (I8, I9, I13, I14, I25, DEF3-DEF6)
// ---------------------------------------------------------------------------------------------

function readBody(req, limit, cb) {
  const chunks = [];
  let size = 0;
  let done = false;
  req.on('data', (c) => {
    if (done) return;
    size += c.length;
    if (size > limit) { done = true; cb(new Error('тело запроса слишком велико')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => { if (!done) { done = true; cb(null, Buffer.concat(chunks).toString('utf8')); } });
  req.on('error', (e) => { if (!done) { done = true; cb(e); } });
}

/**
 * Record the decision. THREE places per I2/C6: back into the source md (the next session reads the
 * document), <doc>.decision.json beside it, and a never-overwritten archive copy — the last two by
 * core.writeDecision. Returns a short Russian summary for the page.
 */
function recordDecision(model, payload, opts) {
  const at = core.isoLocal(new Date());
  const human = core.humanTime(new Date());
  const by = opts.by;
  const touched = [];

  for (const d of model.docs) {
    const given = (payload && payload.documents && payload.documents[d.key]) || null;
    if (!given) continue;

    const answers = {};
    const commentOnly = [];
    for (const [qid, a] of Object.entries(given.answers || {})) {
      if (!a) continue;
      const choice = a.choice || null;
      const text = (a.text || '').trim();
      const comment = (a.comment || '').trim();
      if (!choice && !text && !comment) continue;
      answers[qid] = { choice, text, comment };
      // C6: a comment WITHOUT an answer never closes a question — the core rightly ignores it when
      // writing the md, so we carry it into the document-wide comment block instead of losing it.
      if (!choice && !text && comment) commentOnly.push(qid + ': ' + comment);
    }

    const docComment = (given.comment || '').trim();
    const noticeRead = !!given.noticeRead;
    if (!Object.keys(answers).length && !docComment && !noticeRead) continue;

    const record = {
      kind: d.isNotice ? 'notice' : 'interview',
      document: d.name,
      by,
      at,
      at_human: human,
      comment: docComment,
      answers,
    };
    if (d.isNotice) record.read = noticeRead;

    if (d.isNotice) {
      // I38: the mark is contour STATE. With no comment the owner's document is not touched at all.
      if (docComment) core.appendDocumentComment(d.file, docComment, { by, at });
      markNoticeRead(model.dir, d, { by, at, comment: docComment });
      touched.push(d.name + ' — прочитано');
    } else {
      // I2 + `bugs/01` → B4: the summary is built from the writer's REPORT of what landed in the
      // document, never from the payload the page posted. A question with no `**Ответ:**` field has
      // nowhere to receive an answer, and the contour used to report "ответов: 1" over a document it
      // had not touched — a report of its own writing that nothing had verified.
      const report = Object.keys(answers).length
        ? core.applyAnswersToDocument(d.file, answers, { by, at })
        : { written: [], skipped: [] };

      // Whatever had no field to land in is carried into the document-wide comment: the owner's work
      // is never dropped, and never silently counted either (I10).
      const carried = [...commentOnly];
      for (const s of report.skipped) {
        const a = answers[s.id] || {};
        carried.push(s.id + ': ' + [a.choice, a.text].filter(Boolean).join(' — ') + '  (' + s.reason + ')');
      }
      const tail = [docComment, carried.join('\n')].filter(Boolean).join('\n\n');
      if (tail) core.appendDocumentComment(d.file, tail, { by, at });

      record.written = report.written;
      record.not_written = report.skipped;
      const n = report.written.length;
      touched.push(d.name + ' — ' + (n ? ('ответов: ' + n) : 'только комментарий') +
        (report.skipped.length
          ? (', в поля не легло: ' + report.skipped.length + ' — перенесено в комментарий')
          : ''));
    }

    core.writeDecision(d.file, record);
  }

  if (!touched.length) return null;
  return touched.join('; ');
}

function serve(model, opts) {
  const decisionsDir = model.decisionsDir;
  mkdirSync(decisionsDir, { recursive: true });

  let html = buildPage(model);
  let finished = false;
  let lastPing = Date.now();
  let strikes = 0;
  let beaconTimer = null;
  let tick = null;
  // One lock per DOCUMENT shown by this run, not one per run (see lockPath).
  const locks = model.docs.map((d) => lockPath(decisionsDir, d.key));

  const releaseLock = () => {
    for (const l of locks) { try { unlinkSync(l); } catch { /* already gone */ } }
  };

  /**
   * I25: exactly THREE outcomes, all visible in the process log. "He is probably still thinking"
   * is not an outcome. The exit code is the agent's channel (I31) — the agent learns of the event
   * by this process TERMINATING.
   */
  const finish = (kind, detail) => {
    if (finished) return;
    finished = true;
    if (tick) clearInterval(tick);
    if (beaconTimer) clearTimeout(beaconTimer);

    let line = '';
    let code = 0;
    let delay = 0;
    if (kind === 'recorded') { line = 'ИТОГ: решение записано'; code = 0; delay = DEF3_DEATH_AFTER_RECORD; }
    else if (kind === 'closed') { line = 'ИТОГ: страница закрыта без ответа'; code = 3; }
    else { line = 'ИТОГ: прервано человеком'; code = 130; }

    console.log('');
    console.log(line);
    if (detail) console.log('      ' + detail);
    console.log('      код выхода ' + code);

    // DEF3: a technical pause so the window can leave, then the process dies and WAKES THE AGENT.
    setTimeout(() => {
      releaseLock();
      try { server.close(); } catch { /* ignore */ }
      process.exit(code);
    }, delay);
  };

  const server = createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    // I13: the pulse. Any answer here also proves the page is alive, so it resets the silence watch.
    if (req.method === 'GET' && url === '/alive') {
      lastPing = Date.now();
      strikes = 0;
      if (beaconTimer) { clearTimeout(beaconTimer); beaconTimer = null; }   // T3: a reload came back
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, at: core.isoLocal(new Date()) }));
      return;
    }

    if (req.method === 'POST' && url === '/save') {
      readBody(req, 4 * 1024 * 1024, (err, body) => {
        if (err) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: err.message }));
          return;
        }
        let payload = null;
        try { payload = JSON.parse(body || '{}'); } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'не смог разобрать JSON: ' + e.message }));
          return;
        }
        let summary = null;
        try {
          summary = recordDecision(model, payload, opts);
        } catch (e) {
          // I10: refusing the human's work must be LOUD — on BOTH sides. The page gets a real
          // reason so its rescue ring can say what happened.
          console.log('ОШИБКА ЗАПИСИ: ' + (e && e.stack ? e.stack : e));
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'запись не прошла: ' + (e && e.message ? e.message : e) }));
          return;
        }
        if (!summary) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'пустой ответ — выберите вариант или напишите комментарий' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, summary }));

        let remaining = null;
        try { remaining = refreshQueue(model); } catch { remaining = null; }

        // I8: SAVING WAKES THE WAITER. Any recorded decision terminates the contour; if the queue
        // still holds unanswered items, re-raising the page is the AGENT's duty, never the human's.
        finish('recorded', summary + (remaining === null ? ''
          : (' · осталось ждать владельца: ' + remaining + ' ' +
             plural(remaining, 'документ', 'документа', 'документов'))));
      });
      return;
    }

    // I14/T3: the beacon is the FAST path. pagehide fires on reload too, so we wait ~3 s — if a
    // pulse arrives in that window the page simply came back and nothing happened.
    if (req.method === 'POST' && url === '/closed') {
      readBody(req, 1024, () => {
        res.writeHead(204);
        res.end();
        if (finished) return;
        if (beaconTimer) clearTimeout(beaconTimer);
        beaconTimer = setTimeout(() => {
          if (Date.now() - lastPing >= DEF6_BEACON_GRACE_MS) {
            finish('closed', 'страница сообщила о закрытии и не вернулась за ' +
              (DEF6_BEACON_GRACE_MS / 1000) + ' с');
          }
        }, DEF6_BEACON_GRACE_MS);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('нет такого адреса');
  });

  // I30: listen(0) — a FREE port, never a fixed one. On a fixed port a live old server silently
  // wins the race, curl returns 200 and the owner reads a STALE page.
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    const url = 'http://127.0.0.1:' + port;

    for (let i = 0; i < locks.length; i++) {
      writeFileSync(locks[i], JSON.stringify({
        pid: process.pid, address: url, doc: model.docs[i].key, run: model.key,
        at: core.isoLocal(new Date()),
      }, null, 2) + '\n', 'utf8');
    }

    console.log('СТРАНИЦА: ' + url);
    console.log('ДОКУМЕНТЫ: ' + model.docs.map((d) => d.name).join(', '));
    console.log('ЖДУ: ' + (opts.timeoutS > 0
      ? ('терпимое молчание ' + opts.timeoutS + ' с (флаг --timeout, только для автоматики)')
      : 'без таймаута — терпение машины бесконечно'));

    if (opts.open) openWindow(url);

    // I5/C8: the signal fires strictly AFTER the page is up — otherwise you get the class
    // "summoned, nothing to show". setImmediate keeps it off the listen callback (I32).
    setImmediate(() => {
      try { fireSignal(model, opts); } catch (e) {
        console.log('ЗОВ: не удался (' + (e && e.message) + ') — зовите меня глазами, страница уже открыта.');
      }
    });

    // I14/DEF6/T4/T5: the silence watch. Two strikes — machine sleep stops the timers on BOTH
    // sides, so the first check only marks a suspicion and the second, a tick later, decides.
    const silenceMs = opts.timeoutS > 0 ? opts.timeoutS * 1000 : DEF6_SILENCE_MS;
    tick = setInterval(() => {
      if (finished) return;
      if (Date.now() - lastPing < silenceMs) { strikes = 0; return; }
      strikes++;
      if (strikes === 1) {
        console.log('ТИШИНА: страница молчит дольше ' + Math.round(silenceMs / 1000) +
          ' с — это первое подозрение, решаю на следующем такте.');
        return;
      }
      if (strikes >= DEF6_STRIKES) {
        finish('closed', 'страница молчала два такта подряд');
      }
    }, DEF5_TICK_MS);
  });

  server.on('error', (e) => {
    console.log('СЕРВЕР: не поднялся — ' + (e && e.message));
    releaseLock();
    process.exit(1);
  });

  process.on('SIGINT', () => finish('interrupted', 'Ctrl+C'));
  process.on('SIGTERM', () => finish('interrupted', 'SIGTERM'));
  process.on('exit', releaseLock);

  return { server, rebuild: () => { html = buildPage(model); } };
}

// ---------------------------------------------------------------------------------------------
// 11. CLI
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {
    target: null, serve: true, out: null, signal: true, batch: false,
    timeoutS: DEF5_TIMEOUT_S, by: OWNER, open: true,
    quietFrom: QUIET_FROM, quietTo: QUIET_TO,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-serve') o.serve = false;
    else if (a === '--no-signal') o.signal = false;
    else if (a === '--no-open') o.open = false;
    else if (a === '--batch') o.batch = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--by') o.by = argv[++i];
    else if (a === '--timeout') o.timeoutS = Number(argv[++i]) || 0;
    else if (a === '--quiet-from') o.quietFrom = argv[++i];
    else if (a === '--quiet-to') o.quietTo = argv[++i];
    else if (a.startsWith('--')) throw new Error('неизвестный флаг: ' + a);
    else if (!o.target) o.target = a;
  }
  return o;
}

/** Collect the documents this run renders. --batch = every WAITING document in the directory (I7). */
function collectDocs(opts) {
  const targetPath = opts.target ? resolve(opts.target) : resolve('interviews');
  const isDir = existsSync(targetPath) && !/\.md$/iu.test(targetPath);
  const dir = isDir ? targetPath : dirname(targetPath);

  if (!opts.batch) {
    if (isDir) throw new Error('без --batch нужен путь к .md-документу, а не к папке: ' + targetPath);
    if (!existsSync(targetPath)) throw new Error('документа нет: ' + targetPath);
    const queue = core.readQueue(dir);
    return { dir, docs: [loadDoc(targetPath, queue)] };
  }

  const queue = core.readQueue(dir);
  // The core lists interviews; notices are a separate class of file and are picked up here so the
  // batch page can carry them (I37). Both go through core.parseInterview — one parser (C1).
  const files = readdirSync(dir)
    .filter((f) => /^(interview|notice)[_-].*\.md$/iu.test(f))
    .sort()
    .map((f) => join(dir, f));

  const all = files.map((f) => loadDoc(f, queue));
  const waiting = all.filter(isWaiting);
  if (!waiting.length) throw new Error('в ' + dir + ' нет документов, которые ждут владельца');
  return { dir, docs: waiting };
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.log('ОШИБКА: ' + e.message);
    process.exit(2);
    return;
  }

  if (!opts.target && !opts.batch) {
    console.log('Как пользоваться:');
    console.log('  node tools/review.mjs <документ.md> [--no-serve] [--out файл.html] [--no-signal] [--batch]');
    process.exit(2);
    return;
  }

  let collected;
  try {
    collected = collectDocs(opts);
  } catch (e) {
    console.log('ОШИБКА: ' + e.message);
    process.exit(2);
    return;
  }

  const { dir, docs } = collected;
  const key = opts.batch ? '_batch' : docs[0].key;
  const decisionsDir = join(resolve(dir), 'decisions');

  const model = {
    docs,
    dir,
    decisionsDir,
    key,
    batch: opts.batch,
    serve: opts.serve,
    by: opts.by,
    // The draft key must NOT contain the port: the port changes on every launch (I30) and a
    // port-keyed draft would be lost every time (T6/I12).
    storageKey: key + ':' + docs.map((d) => d.name).join('|'),
  };

  const totalQ = docs.reduce((n, d) => n + d.doc.questions.length, 0);
  const totalAwait = docs.reduce((n, d) => n + (d.isNotice ? 0 : d.awaiting), 0);
  console.log('ПРОЕКТ: ' + PROJECT);
  console.log('СОБРАНО: ' + docs.length + ' ' + plural(docs.length, 'документ', 'документа', 'документов') +
    ', вопросов ' + totalQ + ', без ответа ' + totalAwait);

  // --- build-and-exit (C9): a synchronous caller must never hang ------------------------------
  if (!opts.serve) {
    const html = buildPage(model);
    const outPath = resolve(opts.out || join(decisionsDir, key + '.preview.html'));
    writeFileSync(outPath, html, 'utf8');
    console.log('ФАЙЛ: ' + outPath + ' (' + html.length + ' символов)');

    // I15: showing is an ACTION, not a link — and the reminder stands exactly where the temptation
    // to hand over a path is born. T8: the marker is printed, never repeated in prose above.
    const rerun = ['node', 'tools/review.mjs'];
    if (opts.target) rerun.push(/\s/u.test(opts.target) ? ('"' + opts.target + '"') : opts.target);
    if (opts.batch) rerun.push('--batch');
    console.log('');
    console.log('RENDER IS NOT YET A SHOW');
    console.log(rerun.join(' '));
    return;
  }

  // The queue is a state file: it records that these documents were SHOWN, and it NEVER moves them
  // (I7 — moving breaks every link to them from status and plans). It is stamped only on a run that
  // actually shows something: `syncQueue` used to run before the `--no-serve` branch above, so the
  // very command that ends by printing RENDER IS NOT YET A SHOW wrote `lastShownAt` for a page
  // nobody was ever shown (`bugs/01` → I15).
  try {
    mkdirSync(decisionsDir, { recursive: true });
    syncQueue(dir, docs);
  } catch (e) {
    console.log('ОЧЕРЕДЬ: не смог обновить queue.json (' + (e && e.message) + ') — продолжаю без неё.');
  }

  // --- serve, call, wait ------------------------------------------------------------------------
  // I29/T6: one DOCUMENT, one window. Every document this run would show is checked, so a batch page
  // and a single-document page can see each other (`bugs/01` → B6). A second launch prints the LIVE
  // address and exits — never restarts under a live window, because the port is part of the origin
  // and a new server orphans the draft the owner is in the middle of writing.
  const held = docs.map((d) => ({ name: d.name, path: lockPath(decisionsDir, d.key) }))
    .map((l) => ({ ...l, record: readLock(l.path) }));

  const checkFrom = (i) => {
    if (i >= held.length) {
      for (const l of held) {
        if (l.record) { try { unlinkSync(l.path); } catch { /* already gone */ } }
      }
      serve(model, opts);
      return;
    }
    const l = held[i];
    if (!l.record) { checkFrom(i + 1); return; }
    lockIsLive(l.record, (live) => {
      if (!live) { checkFrom(i + 1); return; }
      console.log('');
      console.log('УЖЕ ОТКРЫТО: документ ' + l.name + ' уже показывается в другом окне.');
      console.log('АДРЕС: ' + l.record.address + ' (процесс ' + l.record.pid + ')');
      console.log('Второе окно — это второй черновик и второй зов, поэтому я не поднимаю его.');
      process.exit(0);
    });
  };
  checkFrom(0);
}

// T9: a module others may import must not execute on import — otherwise a consumer inherits our
// process.exit. Only a direct run starts anything.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2));
}

export { buildPage, callPhrase, chooseSignalRoute, collectDocs, loadDoc, readMeta, isWaiting, splitDocument };
