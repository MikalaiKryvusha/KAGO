#!/usr/bin/env node
// tools/questions-guard.mjs — the place-of-questions guard for the KAGO owner-review contour.
//
// The canon rule it enforces (AGENT_GUIDE.md → "The place of questions"): everything the agent
// wants FROM the owner — a fork, a review, an approval, an answer — lives ONLY in `interviews/`.
// The field fact behind the tool: agents that KNOW the rule still break it, because chat and the
// tail of a plan are cheaper in the moment; a guard surfaced two questions nobody saw, hanging 5
// and 13 days (`/owner-reviews` → rake 2).
//
// FIVE AXES, one run, one exit code:
//   1. G1  — a question addressed to the owner living OUTSIDE interviews/
//   2. G3  — a document whose status still reads "waiting" while every question is answered
//   3. I20 — the RETURN leg: an answered question whose declared target does not cite the interview
//   4. G11 — the option-count cross-check across every live interview document
//   5. G12 — the owner has nothing to click: options that did not parse, or a question that did not (bugs/71)
//
// Design constraints paid for in the field and obeyed here:
//   G1  — TWO strong signs, never ten weak ones; exceptions explicit, with the reason on the line
//   G2  — a debt baseline (ratchet): inherited debt never turns the run red, only NEW items do
//   G9  — "a false alarm is worse than a miss": a guard that cries wolf teaches the owner to ignore it
//   C1  — every document is parsed through tools/lib/review-core.mjs; a private parser is a second truth
//   T9  — this module is imported by others, so it must NOT execute on import
//   T10 — document paths are resolved with resolve(), never join()
//   rake 7 — every letter class is \p{L} with the `u` flag; \w and \b stay ASCII-only in Node and a
//            guard written with them silently misses its own language
//
// Console strings are RUSSIAN: the owner reads this output and works in Russian (field pilot
// 2026-08-07 — English chips over a Russian interview were rejected). Code and comments are English.
//
// [NOT-TESTED] — the three G10 mutations were run by hand at birth (see the session report); no
// automated self-test asserts these functions yet. verify-review-contour.mjs flips this marker.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, relative, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalize, listInterviews, humanTime, isoLocal } from './lib/review-core.mjs';

// =================================================================================================
// 0. Layout
// =================================================================================================

// T10: resolve, never join — the first document outside the repository would otherwise greet the
// owner with a raw stack.
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const INTERVIEWS_DIR = resolve(ROOT, 'interviews');
const BASELINE_PATH = resolve(INTERVIEWS_DIR, 'decisions', 'guard-baseline.json');

// Scan scope for axis 1. `interviews/` is the PLACE of questions, so it is not scanned for them;
// `.claude/`, `.agents/`, `.cline/`, `.grok/`, `.roo/` are vendored skill mirrors — pure prose that
// DESCRIBES the rule (their text contains every marker this guard looks for, which would drown the
// signal, T8); `.kaif/` is the framework's own machinery; `.git/` and `node_modules/` are not ours.
const EXCLUDED_DIRS = new Set([
  'interviews', '.kaif', '.claude', '.agents', '.cline', '.grok', '.roo', 'node_modules', '.git',
]);

// THE CHRONICLE IS THE CLOSED PAST, AND A QUESTION RECORDED THERE IS A FACT, NOT A QUEUE.
// Added 2026-08-23 with `bugs/40` class B. `AGENT_GUIDE.md` defines `PROJECT_HISTORY.md` as
// «the closed past — the append-only chronicle: closed sessions/phases/releases MOVE there
// verbatim», and the same guide forbids editing an original to match today's rules. So a heading
// like «ждёт владельца» inside it describes a queue that WAS, and the one action this guard could
// provoke there — move it to `interviews/` — is the one action the chronicle forbids. A finding
// nobody may act on is a false alarm by construction (G9, the guard's own first principle).
//
// THIS IS THE SHAPE THE PROJECT ALREADY USES FOR THE SAME PROBLEM: the stamp guard «scopes itself by
// the stamp's OWN date — stamps dated before the adoption stay silent without any baseline file to
// maintain» (`AGENT_GUIDE.md`). Scope, not a suppression list: nothing has to be kept up to date.
//
// Measured before/after on 2026-08-23 17:2x: axis G1 went 8 findings → 6, and the two that left were
// exactly `PROJECT_HISTORY.md:1682` and `:2292`. Re-prove by deleting this set's use in
// `collectMarkdown` — the two must come back.
const EXCLUDED_FILES = new Set(['project_history.md']);

// =================================================================================================
// 1. Sign (a) — a queue HEADING
// =================================================================================================

// G1: a markdown heading that OPENS a queue of owner business. These are the headings under which
// questions accumulate outside their place. Each pattern is a whole idea, not a bare word — "owner"
// alone or "вопрос" alone would fire on every second line of a plan (G9).
const QUEUE_HEADING_PATTERNS = [
  { re: /жд[её]т\s+(?:\S+\s+){0,2}владельц[ауе]/iu, why: 'заголовок очереди «ждёт владельца»' },
  { re: /ожида(?:ет|ют|ется|ем)\s+(?:\S+\s+){0,2}владельц[ауе]/iu, why: 'заголовок очереди «ожидает владельца»' },
  { re: /открыт(?:ые|ых|ая|ые\s+)\s*вопрос/iu, why: 'заголовок «открытые вопросы»' },
  // The CASE carries the direction, and getting it wrong inverts the guard: «вопрос владельцу»
  // (dative) is a question TO the owner — a violation; «вопрос владельца» (genitive) is a question
  // BY the owner, which is ordinary prose about what the owner once asked. Both live in this repo,
  // and the genitive form produced 2 of the first 4 hits (measured, first run).
  { re: /вопрос\p{L}*\s+(?:к\s+владельцу|для\s+владельца|владельцу)(?!\p{L})/iu, why: 'заголовок «вопросы владельцу»' },
  { re: /развилк\p{L}*\s+(?:для\s+владельца|к\s+владельцу|владельцу)(?!\p{L})/iu, why: 'заголовок «развилки для владельца»' },
  { re: /awaiting\s+(?:the\s+)?owner/iu, why: 'заголовок «awaiting the owner»' },
  { re: /awaits?\s+(?:the\s+)?owner/iu, why: 'заголовок «awaits the owner»' },
  { re: /open\s+questions?/iu, why: 'заголовок «open questions»' },
  { re: /forks?\s+for\s+the\s+owner/iu, why: 'заголовок «forks for the owner»' },
  { re: /questions?\s+(?:to|for)\s+the\s+owner/iu, why: 'заголовок «questions for the owner»' },
];

// =================================================================================================
// 2. Sign (b) — an address to the owner at the START of a line
// =================================================================================================

// G1: the marker must sit within the first ~40 characters of the line's CONTENT (past list and
// quote markers) — that is what separates an address from prose mid-paragraph. `anchored` patterns
// are imperatives, which are an address only when the line BEGINS with them: "подтвердите" in the
// middle of a sentence is a retelling, at position 0 it is a request.
const ADDRESS_WINDOW = 40;

const OWNER_ADDRESS_PATTERNS = [
  { re: /@(?:owner|владел[ье]ц)/iu, why: 'прямое обращение «@владелец»' },
  // A vocative ends in a comma or a colon, or in a dash that is SPACED. An unspaced dash belongs to
  // a compound word: «owner-vs-owner» opened a line in a report and was read as an address to the
  // owner on the first run — a false alarm of exactly the kind that teaches the owner to ignore the
  // tool (G9), so the separator is spelled out instead of hidden inside a character class.
  // The NOMINATIVE is the case an address actually uses, and the first version could not match it:
  // «владелец» has no soft sign, while the stem written here was «владельц», which occurs only in
  // oblique cases. So «Владелец, подтвердите…» — the exact string this pattern's own `why` names —
  // walked past the guard (`bugs/01` → G1 sign b). `[ье]` covers both stems; `[ую]?` keeps the
  // dative and stays away from the genitive «владельца», which is prose about the owner, not an
  // address to him.
  { re: /^владел[ье]ц[ую]?\s*[,:]|^владел[ье]ц[ую]?\s+[—–-]\s/iu, anchored: true, why: 'обращение «Владелец, …»' },
  { re: /^owner\s*[,:]|^owner\s+[—–-]\s/iu, anchored: true, why: 'обращение «Owner, …»' },
  // Dative only — see the case note above the heading patterns.
  { re: /вопрос\w*\s+(?:к\s+владельцу|для\s+владельца|владельцу)(?!\p{L})/iu, why: 'вопрос владельцу вне interviews/' },
  { re: /(?:нужн\p{L}+|требуетс\p{L}+|не\s+хватает)\s+(?:ваш\p{L}+|решени\p{L}+\s+владельца|ответ\p{L}*\s+владельца|подтвержден\p{L}+\s+владельца|слов\p{L}+\s+владельца)/iu, why: 'запрос решения владельца' },
  { re: /жду\s+(?:ваш\p{L}+|ответа|решения|подтверждения|слова)/iu, why: 'ожидание ответа владельца' },
  { re: /прошу\s+(?:подтвердить|решить|выбрать|ответить|утвердить|согласовать)/iu, why: 'просьба к владельцу решить' },
  { re: /^(?:подтвердите|выберите|решите|ответьте|утвердите|согласуйте)(?!\p{L})/iu, anchored: true, why: 'повелительное обращение к владельцу' },
  { re: /questions?\s+(?:for|to)\s+the\s+owner/iu, why: 'вопрос владельцу вне interviews/' },
  { re: /(?:awaiting|awaits)\s+(?:the\s+)?owner/iu, why: 'ожидание ответа владельца' },
  { re: /owner\s+(?:decision|approval|answer|input|sign-?off)\s+(?:is\s+)?(?:needed|required|pending)/iu, why: 'запрос решения владельца' },
  { re: /needs?\s+(?:an?\s+|the\s+)?owner(?:'s)?\s+(?:decision|approval|answer|input|word)/iu, why: 'запрос решения владельца' },
  { re: /^please\s+(?:confirm|decide|choose|answer|approve|advise)(?!\p{L})/iu, anchored: true, why: 'повелительное обращение к владельцу' },
  { re: /todo\s*[:(]\s*owner/iu, why: 'TODO, адресованный владельцу' },
];

// =================================================================================================
// 3. The exceptions — the whole difference between a guard and noise
// =================================================================================================

// A line whose SECTION already points at the place of questions is a POINTER, which is exactly what
// the canon asks for — not a violation. Written wider than the letter of the rule (a bare
// "интервью 001" without the "#" counts too) because every widening here removes a false alarm, and
// a false alarm is worse than a miss (G9).
const RE_POINTER = /interviews\/|(?:интервью|interview)\s*[#№_-]?\s*\d/iu;

// G10: search the SYNTAX with the colon, never the bare word — "allow" alone lives in ordinary prose.
const RE_ALLOW_MARKER = /<!--\s*owner-review:allow(?![\p{L}\d])([\s\S]*?)-->/iu;

/**
 * Read the allow-marker off a line. An EMPTY reason is itself a violation: without that rule the
 * marker becomes a way to silence the guard, which is the same sabotage one level up (G1).
 */
export function readAllowMarker(line) {
  const m = String(line).match(RE_ALLOW_MARKER);
  if (!m) return null;
  const attrs = m[1] || '';
  const because = attrs.match(/because\s*=\s*([\s\S]*)$/iu);
  const reason = because ? because[1].trim() : '';
  return { reason, valid: reason.length > 0 };
}

/**
 * The marker suppresses its OWN line, and — as a written convenience — the line right after it, so
 * a heading can be excused from the line above without mangling the heading text itself.
 */
function allowMarkerFor(lines, i) {
  const own = readAllowMarker(lines[i]);
  if (own) return { ...own, at: i };
  if (i > 0) {
    const prev = readAllowMarker(lines[i - 1]);
    if (prev) return { ...prev, at: i - 1 };
  }
  return null;
}

// =================================================================================================
// 4. Line and section mechanics
// =================================================================================================

const RE_HEADING_LINE = /^(#{1,6})\s+(.*)$/u;
const RE_FENCE = /^\s*(?:```|~~~)/u;

/**
 * Strip what markdown puts in front of the content — quote markers, list bullets, ordered markers,
 * task checkboxes — so "within the first 40 characters" measures the CONTENT, not the indentation.
 * Bold markers are deliberately left in place: they cost two characters and the window absorbs them.
 */
export function stripLineMarkers(line) {
  let s = String(line);
  for (;;) {
    const q = s.match(/^\s*>+\s?/u);
    if (q) { s = s.slice(q[0].length); continue; }
    const li = s.match(/^\s*(?:[-*+]|\d+[.)])\s+/u);
    if (li) { s = s.slice(li[0].length); continue; }
    const box = s.match(/^\[[ xX]\]\s+/u);
    if (box) { s = s.slice(box[0].length); continue; }
    break;
  }
  return s.replace(/^\s+/u, '');
}

/**
 * For every line, the block of the heading it belongs to.
 *
 * "The heading's block" is the section from that heading down to the next heading of the SAME or a
 * higher level. Walking further up the hierarchy would be wrong in a way that hollows the guard out:
 * the H1 block is the whole file, and one "interviews/" anywhere in a document would then excuse
 * every line in it.
 */
export function sectionBlocks(lines) {
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(RE_HEADING_LINE);
    if (h) heads.push({ line: i, level: h[1].length });
  }
  const blockOf = new Map();   // heading line -> block text
  for (let k = 0; k < heads.length; k++) {
    let end = lines.length;
    for (let j = k + 1; j < heads.length; j++) {
      if (heads[j].level <= heads[k].level) { end = heads[j].line; break; }
    }
    blockOf.set(heads[k].line, lines.slice(heads[k].line, end).join('\n'));
  }
  // The preamble before the first heading is a block of its own.
  const preamble = lines.slice(0, heads.length ? heads[0].line : lines.length).join('\n');

  return (lineIndex) => {
    let owner = -1;
    for (const h of heads) {
      if (h.line <= lineIndex) owner = h.line; else break;
    }
    return owner === -1 ? preamble : blockOf.get(owner);
  };
}

// =================================================================================================
// 5. AXIS 1 — a question to the owner outside interviews/ (G1)
// =================================================================================================

/**
 * Scan ONE document. Returns findings; the caller decides what is new and what is inherited debt.
 *
 * Fenced code is skipped: inside a fence the markers are content (the same reasoning that makes the
 * core renderer keep HTML comments there, I24).
 */
export function scanDocumentForOwnerQuestions(relPath, text) {
  const lines = normalize(text).split('\n');   // C1/C3: the core's normalization, never a private one
  const blockAt = sectionBlocks(lines);
  const findings = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (RE_FENCE.test(raw)) { inFence = !inFence; continue; }
    if (inFence) continue;

    // An allow-marker with an EMPTY reason is a violation on its own line, checked BEFORE the
    // suppression logic — otherwise the empty marker would suppress the report of itself.
    const marker = readAllowMarker(raw);
    if (marker && !marker.valid) {
      findings.push({
        axis: 'G1', file: relPath, line: i + 1, text: raw.trim(),
        why: 'маркер owner-review:allow без причины — сам по себе нарушение',
      });
      continue;
    }

    const heading = raw.match(RE_HEADING_LINE);
    const content = heading ? heading[2] : stripLineMarkers(raw);
    if (!content.trim()) continue;

    let hit = null;
    if (heading) {
      // Sign (a): a queue heading.
      for (const p of QUEUE_HEADING_PATTERNS) {
        if (p.re.test(content)) { hit = p.why; break; }
      }
    } else {
      // Sign (b): an address at the START of the line. Headings are excluded here so one line is
      // never reported twice under two signs.
      for (const p of OWNER_ADDRESS_PATTERNS) {
        const m = p.re.exec(content);
        if (!m) continue;
        if (p.anchored && m.index !== 0) continue;
        if (m.index > ADDRESS_WINDOW) continue;   // prose mid-paragraph is never caught
        hit = p.why;
        break;
      }
    }
    if (!hit) continue;

    // Exception 1 — the section already points at the place of questions.
    const block = blockAt(i) || '';
    if (RE_POINTER.test(block)) continue;

    // Exception 2 — an explicit marker with a reason on the line.
    const allow = allowMarkerFor(lines, i);
    if (allow && allow.valid) continue;

    findings.push({ axis: 'G1', file: relPath, line: i + 1, text: raw.trim(), why: hit });
  }
  return findings;
}

/** Every *.md in scope, read once and kept — axis 3 reads the same texts for its citation search. */
export function collectMarkdown(root = ROOT) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = resolve(dir, e.name);          // T10
      if (e.isDirectory()) {
        if (EXCLUDED_DIRS.has(e.name.toLowerCase())) continue;
        walk(full);
      } else if (e.isFile() && /\.md$/iu.test(e.name)) {
        if (EXCLUDED_FILES.has(e.name.toLowerCase())) continue;   // the chronicle — see the set
        files.push(full);
      }
    }
  };
  walk(resolve(root));
  files.sort();
  return files.map((full) => {
    let text = '';
    try { text = readFileSync(full, 'utf8'); } catch { text = ''; }
    return { full, rel: relPath(root, full), text };
  });
}

export function scanQuestionsOutsideInterviews(docs) {
  const findings = [];
  for (const d of docs) findings.push(...scanDocumentForOwnerQuestions(d.rel, d.text));
  return findings;
}

// =================================================================================================
// 6. AXIS 2 — a stale status (G3)
// =================================================================================================

/**
 * The guard's second half, answering the OPPOSITE question: a document that looks alive while every
 * question in it has been answered. The next session waits for what was long given.
 *
 * Rule 4 of the core's parsing contract holds here too: "waiting" is decided by the status TEXT, and
 * "answered" by the presence of an answer — a comment is a thought, never a decision (C6).
 */
export function checkStaleStatus(interviews, root = ROOT) {
  const findings = [];
  for (const doc of interviews) {
    if (doc.statusIsWaiting !== true) continue;
    if (doc.questions.length === 0) continue;          // nothing to be stale about
    if (!doc.questions.every((q) => q.answered)) continue;

    const rel = relPath(root, doc.file);
    const { line, text } = locateStatusLine(doc);
    findings.push({
      axis: 'G3', file: rel, line, text,
      why: `СТАТУС УСТАРЕЛ: статус «${doc.status}», а все ${doc.questions.length} вопрос(ов) отвечены`,
    });
  }
  return findings;
}

/**
 * Locate the status line for the report. Searching for a KNOWN string is not a second parser — the
 * status VALUE comes from the core; this only finds where it sits so the owner sees a line number.
 */
function locateStatusLine(doc) {
  let lines = [];
  try { lines = normalize(readFileSync(doc.file, 'utf8')).split('\n'); } catch { lines = []; }
  for (let i = 0; i < lines.length; i++) {
    if (/(Статус|Status)/iu.test(lines[i]) && doc.status && lines[i].includes(doc.status)) {
      return { line: i + 1, text: lines[i].trim() };
    }
  }
  return { line: 0, text: `Статус: ${doc.status ?? ''}`.trim() };
}

// =================================================================================================
// 7. AXIS 3 — the return leg (I20, I21)
// =================================================================================================

/** The citation forms of one interview: "интервью 001", "interview #1", and the file base name. */
function citationPatterns(interviewFile) {
  const base = basename(interviewFile).replace(/\.md$/iu, '');
  const pats = [new RegExp(escapeRe(base), 'iu')];
  const num = base.match(/(?:interview|интервью)[_\s-]*(\d+)/iu);
  if (num) {
    const n = Number(num[1]);
    pats.push(new RegExp(`(?:интервью|interview)\\s*[#№_-]?\\s*0*${n}(?!\\d)`, 'iu'));
  }
  return pats;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Extract target file paths out of the free-text answer-target declaration. Deliberately
 * language-neutral: the class is "anything that is not whitespace or a quote and ends in a known
 * extension", never `\w` (rake 7).
 */
export function targetPathsOf(answerTarget) {
  const out = [];
  const re = /[^\s"'<>|,;()\[\]]+\.(?:md|mjs|js|json|txt|ps1|psm1|yml|yaml|cu|c|h|ts)/giu;
  let m;
  while ((m = re.exec(String(answerTarget))) !== null) out.push(m[0].replace(/[\\]/gu, '/'));
  return out;
}

/**
 * I20 — for every ANSWERED question that declares a target, the target must cite the interview.
 * The unit is the QUESTION, never the interview file: a document with one answered and one open
 * question owes exactly one return leg.
 *
 * I21 — an answered question WITHOUT a declared target gets a HEURISTIC, not a refusal: at least one
 * citation anywhere outside interviews/. History is not rewritten, so its misses are hints, never red.
 */
export function checkReturnLeg(interviews, docs, root = ROOT) {
  const findings = [];
  const hints = [];
  let checked = 0;
  let answeredWithoutTarget = 0;

  for (const doc of interviews) {
    const rel = relPath(root, doc.file);
    const pats = citationPatterns(doc.file);
    for (const q of doc.questions) {
      if (!q.answered) continue;

      if (!q.answerTarget) {
        answeredWithoutTarget++;
        const cited = docs.some((d) => pats.some((p) => p.test(d.text)));
        if (!cited) {
          hints.push({
            axis: 'I21', file: rel, line: 0, text: `${q.id} ${q.heading}`,
            why: 'отвечен, цели не объявлено, и ссылок на интервью нигде вне interviews/ не нашлось (подсказка, не нарушение)',
          });
        }
        continue;
      }

      const targets = targetPathsOf(q.answerTarget);
      if (targets.length === 0) {
        findings.push({
          axis: 'I20', file: rel, line: 0, text: `${q.id} target=${q.answerTarget}`,
          why: 'объявленная цель ответа не содержит ни одного пути к файлу',
        });
        continue;
      }
      for (const t of targets) {
        checked++;
        const full = resolve(root, t);              // T10
        if (!existsSync(full) || !statSync(full).isFile()) {
          findings.push({
            axis: 'I20', file: rel, line: 0, text: `${q.id} -> ${t}`,
            why: `цель ответа «${t}» не найдена на диске`,
          });
          continue;
        }
        let body = '';
        try { body = readFileSync(full, 'utf8'); } catch { body = ''; }
        if (!pats.some((p) => p.test(body))) {
          findings.push({
            axis: 'I20', file: rel, line: 0, text: `${q.id} -> ${t}`,
            why: `цель ответа «${t}» не ссылается на интервью — возвратное плечо не пройдено`,
          });
        }
      }
    }
  }
  return { findings, hints, checked, answeredWithoutTarget };
}

// =================================================================================================
// 8. AXIS 4 — the option-count cross-check (G11)
// =================================================================================================

/**
 * The number of CANDIDATE option lines must equal the number of PARSED options, per question, over
 * every live interview. A silently lost option is this contour's worst defect class: the page looks
 * fine and the owner decides over a truncated list (in the field two options out of three did not
 * show, under a green counting check).
 *
 * G8 — the comparison is localized INSIDE the question block; a document-wide count drowns the signal.
 */
export function checkOptionCounts(interviews, root = ROOT) {
  const findings = [];
  let checkedQuestions = 0;
  for (const doc of interviews) {
    const rel = relPath(root, doc.file);
    let lines = [];
    try { lines = normalize(readFileSync(doc.file, 'utf8')).split('\n'); } catch { lines = []; }
    for (const q of doc.questions) {
      checkedQuestions++;
      if (q.optionCandidateLines === q.options.length) continue;
      findings.push({
        axis: 'G11', file: rel, line: locateHeadingLine(lines, q.heading), text: q.heading,
        why: `${q.id}: строк-кандидатов ${q.optionCandidateLines}, разобрано вариантов ${q.options.length} — вариант потерян`,
      });
    }
  }
  return { findings, checkedQuestions };
}

// =================================================================================================
// 8a. AXIS 5 — ВЛАДЕЛЬЦУ НЕЧЕГО НАЖАТЬ (G12), `bugs/71`
// =================================================================================================

/** Ячейка таблицы, начинающаяся с `**A**` — та же буква, что ищет разбор, но там, где он не смотрит. */
const RE_OPTION_IN_CELL = /^\s*\|\s*\*\*\s*([A-Za-zА-Яа-я])(?!\p{L})/u;
/** Слот ответа. Его ставят только там, где спрашивают, — значит вопрос ЗАДУМАН. */
const RE_ANSWER_SLOT = /^\s*\*\*\s*Ответ\s*:?\s*\*\*|owner-review:answer/u;

/**
 * ДВЕ ФОРМЫ ОДНОГО ОТКАЗА: документ выглядит как вопрос, а нажать владельцу нечего.
 *
 * ─── ПОЧЕМУ ЭТОГО НЕ ВИДИТ G11, И ЭТО НЕ ЕЁ ВИНА ─────────────────────────────────────────────────
 *
 * G11 сверяет ДВА СЧЁТЧИКА: строк-кандидатов в варианты и разобранных вариантов. Она отвечает на
 * вопрос «не потерялся ли вариант по дороге». Когда варианты свёрстаны ТАБЛИЦЕЙ, кандидатов ноль и
 * разобранных ноль — счётчики согласны, и G11 честно зелена. **Сторож, сверяющий два числа, слеп,
 * когда оба нуля по одной причине** (`bugs/71`, семья [[EXP-0176]]).
 *
 * ─── ДВЕ ВЕТКИ, И ВТОРАЯ ХУЖЕ ПЕРВОЙ ─────────────────────────────────────────────────────────────
 *
 * **G12a — вопрос есть, вариантов ноль, а улики вариантов в теле ЕСТЬ.** Ровно `interviews/018`
 * 30 августа: четыре варианта строками таблицы, на странице — поле для текста, ответ владельца
 * `choice: null`.
 *
 * **G12b — слот ответа есть, а вопросов НОЛЬ.** Оплачено в тот же день второй раз: заголовок
 * написан как «## Вопрос Q1 — …» вместо «## Q1. …», и разбор не увидел вопроса ВООБЩЕ. Это хуже
 * первой ветки: при нуле вариантов владелец хотя бы знает, что его спрашивают, а при нуле вопросов
 * контур докладывает «без ответа 0» и считает документ не ждущим владельца — вопрос исчезает молча.
 *
 * ─── ГРАНИЦЫ, ЧТОБЫ СТОРОЖ НЕ КРИЧАЛ ВПУСТУЮ (G9) ────────────────────────────────────────────────
 *
 * · В G12a нужно **ДВЕ РАЗНЫЕ буквы**: одиночное `**A**` законно живёт в прозе, ссылающейся на
 *   прежний ответ («владелец выбрал **A**»), и одна буква сторожа не поднимает.
 * · В G12b нужен слот ответа: документ БЕЗ вопросов и БЕЗ слота — это не сломанный вопрос, а
 *   заметка, и трогать её нечего.
 * · Лечение — переписать варианты строками, а НЕ учить разбор таблицам: вторая законная форма
 *   одного понятия это пара «истина ↔ зеркало» внутри формата (`bugs/71`, шаг 4 плана).
 *
 * [NOT-TESTED] at birth — блоки G12a/G12b/G12c в `verify:contour` — это то, что переворачивает метку.
 */
export function checkUnreachableChoices(interviews, root = ROOT) {
  const findings = [];
  let checkedDocs = 0;
  for (const doc of interviews) {
    // ⚠️ ОБЛАСТЬ: ТОЛЬКО ТО, ЧТО ЕЩЁ ЖДЁТ ВЛАДЕЛЬЦА — и это не послабление, а G9.
    //
    // Первый прогон оси нашёл 23 находки в 19 документах, и они НАСТОЯЩИЕ: старые интервью
    // (011 · 012 · 013 · 014 · 016 …) действительно вёрстаны таблицами, и владелец действительно
    // отвечал на них ТЕКСТОМ, потому что кнопок ему не показывали. Но все они ЗАКРЫТЫ, а закрытый
    // оригинал не переписывают (`AGENT_GUIDE.md`: «an original is not rewritten to match today's
    // vocabulary»). **Находка, по которой никто не вправе действовать, — ложная тревога по
    // построению**, и это первый принцип этого сторожа.
    //
    // Тот же приём, что у `EXCLUDED_FILES` выше, и по той же причине: ОБЛАСТЬ, а не список
    // подавления — поддерживать нечего, и новый сломанный вопрос загорится сам.
    if (!doc.statusIsWaiting) continue;
    checkedDocs++;
    const rel = relPath(root, doc.file);
    let lines = [];
    try { lines = normalize(readFileSync(doc.file, 'utf8')).split('\n'); } catch { lines = []; }

    // G12b — документ целиком: слот ответа есть, разобранных вопросов ноль.
    if (doc.questions.length === 0 && lines.some((l) => RE_ANSWER_SLOT.test(l))) {
      findings.push({
        axis: 'G12', file: rel, line: 1, text: `${rel}: слот ответа без вопроса`,
        why: 'в документе есть слот ответа, а разобранных вопросов НОЛЬ — контур покажет владельцу '
          + 'пустую страницу и посчитает документ не ждущим его. Заголовок вопроса пишется как «Q1. …»',
      });
      continue;                                  // тела вопросов нет — ветке G12a не с чем работать
    }

    // G12a — вопрос за вопросом: вариантов ноль, а улики вариантов в теле есть.
    for (const q of doc.questions) {
      if (q.options.length > 0) continue;
      const letters = new Set();
      for (const line of q.body ?? []) {
        const m = RE_OPTION_IN_CELL.exec(line);
        if (m) letters.add(m[1].toUpperCase());
      }
      if (letters.size < 2) continue;            // одна буква — это проза, а не список вариантов (G9)
      findings.push({
        axis: 'G12', file: rel, line: locateHeadingLine(lines, q.heading), text: q.heading,
        why: `${q.id}: разобрано вариантов 0, а в теле ${letters.size} ячейк(и) таблицы вида «**A**» `
          + `(${[...letters].sort().join(', ')}) — владелец увидит поле для текста вместо кнопок. `
          + 'Варианты пишутся строками списка: «- **A. …**»',
      });
    }
  }
  return { findings, checkedDocs };
}

/** Find where a known heading text sits, for the report only. */
function locateHeadingLine(lines, headingText) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].replace(/^#{1,6}\s*/u, '').trim() === headingText) return i + 1;
  }
  return 0;
}

// =================================================================================================
// 9. The ratchet (G2)
// =================================================================================================

/**
 * The debt key is `file + sha1(offending line text)` — deliberately NOT the line number: editing a
 * document above a debt line must not resurrect it as "new". sha1 here is an identity key for a
 * baseline, not a security or approval hash; approval binding is sha256 over normalized bodies and
 * lives in the core (I3), and this must never be confused with it.
 */
export function debtKey(file, text) {
  return `${file}#${createHash('sha1').update(String(text).trim(), 'utf8').digest('hex')}`;
}

export function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return { version: 1, frozen_at: null, items: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || !Array.isArray(parsed.items)) return { version: 1, frozen_at: null, items: [] };
    return parsed;
  } catch {
    // A corrupt baseline must not silently disable the guard, and must not crash it either: it
    // degrades to "no inherited debt", which is the LOUD direction.
    return { version: 1, frozen_at: null, items: [], corrupt: true };
  }
}

export function saveBaseline(findings, path = BASELINE_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const body = {
    version: 1,
    frozen_at: isoLocal(new Date()),
    note: 'Унаследованный долг сторожа мест вопросов. Ключ = файл + sha1(текст строки). Долг должен убывать.',
    items: findings.map((f) => ({
      key: debtKey(f.file, f.text),
      axis: f.axis,
      file: f.file,
      sample: f.text.slice(0, 200),
      why: f.why,
    })),
  };
  writeFileSync(path, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return path;
}

// =================================================================================================
// 10. The run
// =================================================================================================

function relPath(root, full) {
  return relative(resolve(root), resolve(full)).split(sep).join('/');
}

export function runGuard({ root = ROOT, baselinePath = BASELINE_PATH } = {}) {
  const docs = collectMarkdown(root);
  const interviews = listInterviews(resolve(root, 'interviews'));

  const g1 = scanQuestionsOutsideInterviews(docs);
  const g3 = checkStaleStatus(interviews, root);
  const leg = checkReturnLeg(interviews, docs, root);
  const opt = checkOptionCounts(interviews, root);
  const reach = checkUnreachableChoices(interviews, root);

  const all = [...g1, ...g3, ...leg.findings, ...opt.findings, ...reach.findings];
  const baseline = loadBaseline(baselinePath);
  const known = new Set(baseline.items.map((it) => it.key));

  const fresh = [];
  const inherited = [];
  for (const f of all) {
    const key = debtKey(f.file, f.text);
    (known.has(key) ? inherited : fresh).push({ ...f, key });
  }

  // The REPORT half (never a violation): an unanswered interview is the contour working as intended.
  const waiting = [];
  for (const doc of interviews) {
    const open = doc.questions.filter((q) => !q.answered);
    if (open.length) {
      waiting.push({
        file: relPath(root, doc.file),
        status: doc.status,
        open: open.length,
        total: doc.questions.length,
        ids: open.map((q) => q.id),
      });
    }
  }

  return {
    ok: fresh.length === 0,
    at: isoLocal(new Date()),
    counts: {
      filesScanned: docs.length,
      interviews: interviews.length,
      questions: interviews.reduce((n, d) => n + d.questions.length, 0),
      optionChecks: opt.checkedQuestions,
      reachChecks: reach.checkedDocs,
      returnLegChecks: leg.checked,
      answeredWithoutTarget: leg.answeredWithoutTarget,
      openQuestions: waiting.reduce((n, w) => n + w.open, 0),
      debt: inherited.length,
      fresh: fresh.length,
    },
    fresh,
    inherited,
    hints: leg.hints,
    waiting,
    baseline: { path: relPath(root, baselinePath), frozen_at: baseline.frozen_at, size: baseline.items.length, corrupt: !!baseline.corrupt },
  };
}

// =================================================================================================
// 11. The report the owner reads — Russian, always
// =================================================================================================

const AXIS_TITLE = {
  G1: 'вопрос владельцу вне interviews/',
  G3: 'устаревший статус',
  I20: 'возвратное плечо',
  I21: 'возвратное плечо (эвристика для старых интервью)',
  G11: 'сверка числа вариантов',
  G12: 'владельцу нечего нажать',
};

function formatFinding(f) {
  const where = f.line ? `${f.file}:${f.line}` : f.file;
  return [
    `    ${where}`,
    `      ${f.why}`,
    `      строка: ${f.text.length > 160 ? f.text.slice(0, 160) + '…' : f.text}`,
  ].join('\n');
}

export function formatReport(r) {
  const out = [];
  out.push('СТОРОЖ МЕСТА ВОПРОСОВ — KAGO');
  out.push(`Прогон ${humanTime(new Date())} · просмотрено ${r.counts.filesScanned} файлов .md вне interviews/ · интервью: ${r.counts.interviews}`);
  out.push('');

  if (r.baseline.corrupt) {
    out.push('ВНИМАНИЕ: файл долга не читается как JSON — считаю, что долга нет. Долг придётся заморозить заново.');
    out.push('');
  }

  const byAxis = (list, axis) => list.filter((f) => f.axis === axis);
  for (const axis of ['G1', 'G3', 'I20', 'G11', 'G12']) {
    const fresh = byAxis(r.fresh, axis);
    const old = byAxis(r.inherited, axis);
    out.push(`[${axis}] ${AXIS_TITLE[axis]} — новых: ${fresh.length} · в долге: ${old.length}`);
    for (const f of fresh) out.push(formatFinding(f));
    if (old.length) {
      for (const f of old) out.push(`    (долг) ${f.line ? `${f.file}:${f.line}` : f.file} — ${f.why}`);
    }
    out.push('');
  }

  // I20: the summary reports BOTH legs. A one-leg "0 ждут" is a false green, so the return leg is
  // printed even when it checked nothing — and says so in words.
  out.push('ОБА ПЛЕЧА:');
  if (r.waiting.length === 0) {
    out.push('  · туда: ни одного вопроса без ответа.');
  } else {
    for (const w of r.waiting) {
      out.push(`  · туда: ${w.file} — ${w.open} из ${w.total} без ответа (${w.ids.join(', ')}), статус: ${w.status ?? 'не указан'}`);
    }
  }
  if (r.counts.returnLegChecks === 0) {
    out.push(`  · обратно: проверок 0 — ни один отвеченный вопрос не объявил цели ответа (отвечено без цели: ${r.counts.answeredWithoutTarget}). Это НЕ зелёный свет, это отсутствие данных.`);
  } else {
    out.push(`  · обратно: проверок ${r.counts.returnLegChecks} · нарушений ${r.fresh.filter((f) => f.axis === 'I20').length + r.inherited.filter((f) => f.axis === 'I20').length}`);
  }
  for (const h of r.hints) {
    out.push(`  · подсказка (I21): ${h.file} — ${h.text}: ${h.why}`);
  }
  out.push('');

  out.push(`СВЕРКА ВАРИАНТОВ (G11): проверено вопросов ${r.counts.optionChecks} — расхождений новых ${r.fresh.filter((f) => f.axis === 'G11').length}.`);
  out.push(`НЕЧЕГО НАЖАТЬ (G12): проверено документов ${r.counts.reachChecks} — новых ${r.fresh.filter((f) => f.axis === 'G12').length}.`);
  out.push('');

  // G2: the debt number prints on EVERY run — and it must go down.
  out.push(`ДОЛГ: ${r.counts.debt}${r.baseline.frozen_at ? ` (заморожен ${r.baseline.frozen_at})` : ' (файл долга не заведён)'} · файл: ${r.baseline.path}`);
  out.push(r.ok
    ? `ИТОГ: ЧИСТО. Новых нарушений нет${r.counts.debt ? ', унаследованный долг не краснеет — но должен убывать.' : '.'}`
    : `ИТОГ: КРАСНО. Новых нарушений: ${r.counts.fresh}. Место вопросов — только interviews/.`);
  return out.join('\n');
}

// =================================================================================================
// 12. CLI
// =================================================================================================

const HELP = [
  'Использование: node tools/questions-guard.mjs [--freeze] [--json] [--no-serve]',
  '',
  '  --freeze     записать текущее состояние в файл долга interviews/decisions/guard-baseline.json',
  '  --json       машинный вывод (только JSON, без человеческого отчёта)',
  '  --no-serve   принимается и игнорируется: сторож никогда не держит сервер (C9)',
  '  --help       эта справка',
  '',
  'Код выхода: 0 — чисто или только унаследованный долг; 1 — появилось НОВОЕ нарушение.',
].join('\n');

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP + '\n');
    return 0;
  }
  const asJson = argv.includes('--json');
  const freeze = argv.includes('--freeze');

  const result = runGuard();

  if (freeze) {
    // The ratchet is armed from the CURRENT state: everything visible now becomes inherited debt.
    const all = [...result.fresh, ...result.inherited];
    const path = saveBaseline(all);
    if (asJson) {
      process.stdout.write(JSON.stringify({ frozen: all.length, baseline: relPath(ROOT, path) }, null, 2) + '\n');
    } else {
      process.stdout.write(formatReport(result) + '\n\n');
      process.stdout.write(`ЗАМОРОЖЕНО: ${all.length} пункт(ов) долга записано в ${relPath(ROOT, path)}\n`);
      process.stdout.write('С этого момента красным становится только НОВОЕ. Долг должен убывать.\n');
    }
    return 0;
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(formatReport(result) + '\n');
  }
  return result.ok ? 0 : 1;
}

// T9: this module is imported by the page and by the QA run, so it must NOT execute on import —
// otherwise the importer kills itself with the guard's process.exit. On Windows argv[1] is a plain
// path while import.meta.url is a file:// URL, and the drive letter's case differs between them, so
// both sides are resolved and folded before comparison.
function isDirectRun() {
  if (!process.argv[1]) return false;
  const fold = (p) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  try {
    return fold(fileURLToPath(import.meta.url)) === fold(process.argv[1]);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  let code = 1;
  try {
    code = main();
  } catch (err) {
    // The owner must never meet a raw stack (never a bare throw out of this tool).
    process.stdout.write('СТОРОЖ НЕ СМОГ ОТРАБОТАТЬ: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.stdout.write('Это дефект сторожа, а не нарушение канона. Прогон считаю красным.\n');
    code = 1;
  }
  process.exit(code);
}
