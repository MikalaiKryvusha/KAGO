// review-core.mjs — the single source of truth for the owner-review contour.
//
// Everything that reads an interview document goes through THIS module: the page, the send gate
// and the questions guard. A duplicated parser is a second truth — in the field a guard's private
// copy diverged from the core on "a comment is not an answer" inside a single day
// (`/owner-reviews` → C1).
//
// Zero external dependencies by design: Node stdlib only.
//
// Contract anchors cited by name so a future session can find the rule that shaped each function:
//   C3  — normalization and hash, written before either side of the gate
//   C4  — the five parsing rules, written against live text
//   C6  — decision writes: three places, derived names, never clobber the owner's words
//   I2  — an answer is recorded in three places
//   I3  — approval binds to the sha-256 of the normalized BODY
//   I6  — quiet hours override everything, and the window crosses midnight
//   I24 — the renderer strips HTML comments; every path showing document text goes through it
//
// [NOT-TESTED] at birth — the self-test in verify-review-contour.mjs flips this marker.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, basename, resolve, join } from 'node:path';

// ---------------------------------------------------------------------------------------------
// 1. Normalization and hash (C3, I3)
// ---------------------------------------------------------------------------------------------

/**
 * The ONE normalization both sides of the gate must agree on. The field's costliest defect was a
 * page hashing raw file bytes while the sender hashed normalized text: both self-tests green, and
 * the gate would have refused every artifact forever.
 *
 * Order matters: BOM first (it would otherwise survive as content), then line endings, then the
 * trailing whitespace tail, then exactly one final newline.
 */
export function normalize(s) {
  let t = String(s);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);   // strip BOM
  t = t.replace(/\r\n?/g, '\n');                     // CRLF and lone CR to LF
  t = t.replace(/[ \t\n]+$/, '');                    // drop the trailing whitespace tail
  return t + '\n';                                   // exactly one final newline
}

/** sha-256 over the NORMALIZED text. Never over raw bytes — see normalize(). */
export function hashBody(s) {
  return createHash('sha256').update(normalize(s), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------------------------
// 2. Quiet hours (I6)
// ---------------------------------------------------------------------------------------------

/**
 * Quiet hours override everything, including an explicitly requested voice level.
 *
 * The window CROSSES MIDNIGHT (23:00–09:00 by default). A naive `from <= now <= to` is silent all
 * day and loud all night — the exact inversion of the intent — so the crossing case is handled
 * explicitly and carries its own self-test.
 *
 * @param {Date} now
 * @param {string} from "HH:MM"
 * @param {string} to   "HH:MM"
 */
export function inQuietHours(now, from = '23:00', to = '09:00') {
  const mins = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + m;
  };
  const n = now.getHours() * 60 + now.getMinutes();
  const a = mins(from);
  const b = mins(to);
  if (a === b) return false;              // a zero-width window is no window
  if (a < b) return n >= a && n < b;      // an ordinary same-day window
  return n >= a || n < b;                 // the window crosses midnight
}

// ---------------------------------------------------------------------------------------------
// 3. Parsing an interview document (C4)
// ---------------------------------------------------------------------------------------------

// Rule 5: `\w` and `\b` stay ASCII-only in Node even under the `u` flag, so a guard written with
// them silently misses its own language. Every letter class below is `\p{L}` with `u`.
const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_HRULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

// Rule 3 + G6: recognition is built NEGATIVELY. "A letter NOT followed by another letter" instead
// of enumerating the allowed separators — to enumerate the allowed is to one day not enumerate,
// and in the field two options out of three silently did not show under a green counting check.
const RE_OPTION_START = /^\s*[-*]?\s*\*\*\s*([A-Za-zА-Яа-я])(?!\p{L})/u;

// The answer field, in either working language. Rule 2: a field labelled as a COUNTER-question is
// not an answer — those labels are listed separately and excluded.
const RE_ANSWER_FIELD = /^\s*\*\*\s*(Ответ|Answer)\s*:?\s*\*\*\s*:?\s*(.*)$/iu;
const RE_COUNTER_FIELD = /^\s*\*\*\s*(Встречный вопрос|Counter-question|Уточнение|Clarification)\s*:?\s*\*\*/iu;

// A comment is a thought, not a decision (C6) — parsed, but never closes a question.
const RE_COMMENT_FIELD = /^\s*\*\*\s*(Комментарий|Comment)\s*:?\s*\*\*\s*:?\s*(.*)$/iu;

// The document status line. Rule 4: the truth about whether an interview is closed is the DOCUMENT
// STATUS, never the fullness of its fields.
const RE_STATUS_LINE = /^\s*\*\*\s*(Status|Статус)\s*:?\s*\*\*\s*:?\s*(.*)$/iu;

// A question heading: "## Вопрос 1." / "## Question 2 —" / "## Q3:"
const RE_QUESTION_HEADING = /^#{2,4}\s*(Вопрос|Question|Q)\s*(\d+)/iu;

/**
 * The line ranges of the question blocks, over NORMALIZED text. `[{start, end}]`, `end` exclusive.
 *
 * Rule 1 is the subtle one and it lives HERE, alone: a question block is closed not only by the
 * next heading but ALSO by a horizontal rule. Without it the rule lands inside the answer text and
 * an empty question reads as "answered" — the single worst outcome for a contour whose whole job is
 * knowing what is unanswered.
 *
 * Exported because the PAGE needs the same boundaries: everything outside these ranges is document
 * prose the owner must see, and a second copy of "where does a block end" in the renderer is a
 * second truth (C1). That second copy is exactly what silently dropped the text between two
 * questions (`bugs/01` → A1).
 *
 * [TESTED: 2026-08-09 · tools/verify-review-contour.mjs blocks A1/A2 — red on the old split, green
 * on this one]
 */
export function questionBlockRanges(text) {
  const lines = normalize(text).split('\n');
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    if (!RE_QUESTION_HEADING.test(lines[i])) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (RE_HEADING.test(lines[j]) || RE_HRULE.test(lines[j])) { end = j; break; }
    }
    ranges.push({ start: i, end });
  }
  return ranges;
}

/**
 * Parse an interview document into a structure both the page and the guard agree on.
 */
export function parseInterview(text, { file = '<memory>' } = {}) {
  const src = normalize(text);
  const lines = src.split('\n');

  const doc = {
    file,
    title: null,
    status: null,
    statusIsWaiting: null,
    questions: [],
    documentComments: [],
  };

  // --- document-level fields -----------------------------------------------------------------
  for (const line of lines) {
    const h = line.match(RE_HEADING);
    if (h && h[1].length === 1 && doc.title === null) doc.title = h[2].trim();
    const s = line.match(RE_STATUS_LINE);
    if (s && doc.status === null) doc.status = s[2].trim();
  }
  if (doc.status !== null) {
    // "waiting" is decided by the status TEXT, not by field fullness (rule 4).
    doc.statusIsWaiting = /🔴|ждёт|ожида|waiting|awaits|open/iu.test(doc.status);
  }

  // --- question blocks -----------------------------------------------------------------------
  // Collect block boundaries first, then parse each block. Two passes are cheaper to reason about
  // than one pass with state, and this parser is read by every consumer of the contour.
  const ranges = questionBlockRanges(src);
  for (let qi = 0; qi < ranges.length; qi++) {
    doc.questions.push(parseQuestionBlock(lines.slice(ranges[qi].start, ranges[qi].end), qi + 1));
  }

  // --- document-wide comments (P7) ------------------------------------------------------------
  // Appended by the contour as dated blocks at the END of the file; they accumulate, never
  // overwrite. Recognised so a re-render shows them back to the owner.
  const dated = src.match(/<!--\s*owner-review:comment\s+at="([^"]+)"\s+by="([^"]+)"\s*-->\n([\s\S]*?)(?=\n<!--\s*owner-review:|$)/gu);
  if (dated) {
    for (const blockText of dated) {
      const m = blockText.match(/at="([^"]+)"\s+by="([^"]+)"\s*-->\n([\s\S]*)/u);
      if (m) doc.documentComments.push({ at: m[1], by: m[2], text: m[3].trim() });
    }
  }

  return doc;
}

/** Parse one question block. Exported so the guard's counting cross-check (G11) can call it. */
export function parseQuestionBlock(blockLines, index) {
  const heading = blockLines[0].replace(/^#{2,4}\s*/u, '').trim();
  const q = {
    index,
    heading,
    id: `Q${index}`,
    body: [],
    options: [],
    answer: null,
    answerLine: null,
    comment: null,
    answerTarget: null,      // I18 — where the answer must propagate
    optionCandidateLines: 0, // G11 — the independent count for the cross-check
  };

  let i = 1;
  let current = null; // the option being accumulated (rule 3: options are MULTILINE)

  const flush = () => {
    if (!current) return;
    // Rule 3: collect the item with its indented continuations FIRST, only then look for the
    // closing `**`. A single-line parse silently eats every option whose text wraps.
    const joined = current.raw.join('\n');
    const m = joined.match(/^\s*[-*]?\s*\*\*\s*([A-Za-zА-Яа-я])(?!\p{L})([^*]*)\*\*(?:\s*[—:.\-–]\s*)?([\s\S]*)$/u);
    if (m) {
      q.options.push({
        letter: m[1].toUpperCase(),
        label: (m[2] || '').replace(/^[\s.):—-]+/u, '').trim(),
        text: (m[3] || '').trim(),
        recommended: /рекомендую|рекомендовано|recommended/iu.test(joined),
      });
    }
    current = null;
  };

  for (; i < blockLines.length; i++) {
    const line = blockLines[i];

    // The answer-target declaration (I18), written together with the question.
    const at = line.match(/<!--\s*owner-review:target\s+(.*?)\s*-->/u);
    if (at) { q.answerTarget = at[1]; continue; }

    if (RE_COUNTER_FIELD.test(line)) { flush(); continue; }   // rule 2: not an answer

    const ans = line.match(RE_ANSWER_FIELD);
    if (ans) {
      flush();
      // Everything from here to the end of the block, minus later labelled fields, is the answer.
      const tail = [ans[2] ?? ''];
      for (let j = i + 1; j < blockLines.length; j++) {
        if (RE_COMMENT_FIELD.test(blockLines[j]) || RE_COUNTER_FIELD.test(blockLines[j])) break;
        tail.push(blockLines[j]);
      }
      const text = tail.join('\n').trim();
      q.answer = text.length ? text : null;
      q.answerLine = i;
      continue;
    }

    const cm = line.match(RE_COMMENT_FIELD);
    if (cm) {
      flush();
      q.comment = (cm[2] || '').trim() || null;
      continue;
    }

    if (RE_OPTION_START.test(line)) {
      flush();
      q.optionCandidateLines++;
      current = { raw: [line] };
      continue;
    }

    if (current) {
      // An indented continuation, or a blank line inside the item.
      if (/^\s{2,}\S/u.test(line) || line.trim() === '') { current.raw.push(line); continue; }
      flush();
    }

    q.body.push(line);
  }
  flush();

  q.bodyText = q.body.join('\n').trim();
  // A comment WITHOUT an answer never closes a question (C6): answered-ness is the answer alone —
  // and a TEMPLATE PLACEHOLDER is not an answer either (`bugs/04`). Closing the question here, at
  // the parser, is what makes the page unable to show it as answered in the first place; the
  // refusal in answerabilityRefusals is the second strike, aimed at the agent.
  q.answered = q.answer !== null && !isPlaceholderAnswer(q.answer);
  return q;
}

/**
 * CAN THE OWNER ACTUALLY ANSWER THIS DOCUMENT? — the guard of `bugs/41`, and it exists because the
 * REPORT was already honest and that was not enough.
 *
 * `applyAnswersToDocument` above has said, since `bugs/01` → B4, exactly what it could not write
 * («у вопроса нет поля „Ответ:“ — записывать некуда»). On 2026-08-23 the owner answered two
 * interviews and NEITHER answer reached its document: one had no answer fields, the other had no
 * recognised question at all — its heading read «## Вопрос: какой объём берём?», and
 * `RE_QUESTION_HEADING` requires a NUMBER, so the page offered him no input. His words: *«поле для
 * ответа было не доступно для ввода»*. The refusal was truthful and it arrived at the OWNER,
 * standing in front of a page he could not use.
 *
 * So the same two conditions are checked BEFORE the page is raised, and they are checked here —
 * one parser, one place (C1). Returns `[]` for an answerable document; otherwise one refusal per
 * reason, each naming the address and the exact repair.
 *
 * [TESTED: 2026-08-23 18:2x · red against `interviews/011` (three questions, no answer field) and
 *  `interviews/012` (zero recognised questions) as they stood at the moment of the incident; green
 *  after both were repaired. Block «отвечаемость» in tools/verify-review-contour.mjs.]
 */
/**
 * IS THIS ANSWER SLOT A TEMPLATE PLACEHOLDER RATHER THAN AN ANSWER? — `bugs/04`.
 *
 * On 2026-08-14 the contour was raised over a draft whose answer slot still held the template's own
 * instruction; the page rendered that question as ALREADY ANSWERED, and the owner — who had answered
 * nothing — saw it that way. The tool was honest about everything else and still showed him a lie.
 *
 * The rule is the one shape a real answer never has: the WHOLE slot wrapped in emphasis. An owner
 * choosing a variant types `A`; the template speaks in italics — `_(впишите A, B, C…)_`, `_…_`.
 * Deliberately narrow: emphasis INSIDE an answer is untouched, only a slot that is nothing but
 * emphasis counts. The refusal reaches the AGENT before the owner is ever called, and the fix is to
 * empty the slot.
 */
export function isPlaceholderAnswer(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return false;
  if (t.includes('\n')) return false;                       // a real answer may be long; a slot is one line
  const m = /^([_*]{1,2})([\s\S]+)\1$/u.exec(t);
  if (!m) return false;
  const inner = m[2];
  if (inner.includes(m[1])) return false;                   // emphasis inside emphasis — not a bare slot
  return true;
}

export function answerabilityRefusals(doc) {
  const out = [];
  if (!doc.questions.length) {
    out.push({
      where: doc.file,
      what: 'ни одного распознанного вопроса',
      why: 'на странице не появится ни одного поля ввода — владельцу нечем ответить',
      fix: 'заголовок вопроса обязан нести НОМЕР: «## Вопрос 1.» · «## Q1.» · «## Question 2 —». '
        + 'Без номера заголовок не совпадает с RE_QUESTION_HEADING и вопроса для контура не существует',
    });
    return out;
  }
  for (const q of doc.questions) {
    if (q.answerLine === null || q.answerLine === undefined) {
      out.push({
        where: `${doc.file} → ${q.id}`,
        what: 'нет поля «Ответ:»',
        why: 'ответ владельца записывать некуда — он уедет в комментарий, а документ останется «ждёт владельца»',
        fix: 'добавить в блок вопроса строку «**Ответ:**» (пустую) — контур впишет ответ ровно в неё',
      });
      continue;
    }
    if (isPlaceholderAnswer(q.answer)) {
      out.push({
        where: `${doc.file} → ${q.id}`,
        what: 'в слоте ответа стоит ЗАГЛУШКА ШАБЛОНА, а не ответ',
        why: 'контур считает такой вопрос ОТВЕЧЕННЫМ и покажет его владельцу закрытым — ровно то, '
          + 'что случилось 14 августа (`bugs/04`): он увидел отвеченным то, чего не отвечал',
        fix: 'очистить слот до «**Ответ:**» — подсказку владельцу класть в текст вопроса, не в слот ответа',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 4. Decision records (I2, C6)
// ---------------------------------------------------------------------------------------------

/** Decision file names are DERIVED from the document — a shared name is overwritten by the next. */
export function decisionPaths(docPath) {
  const dir = dirname(resolve(docPath));
  const base = basename(docPath).replace(/\.md$/iu, '');
  const decisionsDir = join(dir, 'decisions');
  return {
    decisionsDir,
    archiveDir: join(decisionsDir, 'archive'),
    decision: join(decisionsDir, `${base}.decision.json`),
    queue: join(decisionsDir, 'queue.json'),
    archiveFor: (iso) => join(decisionsDir, 'archive', `${base}--${iso.replace(/[:.]/gu, '-')}.json`),
  };
}

export function readDecision(docPath) {
  const { decision } = decisionPaths(docPath);
  if (!existsSync(decision)) return null;
  try { return JSON.parse(readFileSync(decision, 'utf8')); } catch { return null; }
}

/**
 * Write the decision to two of its three places (the third — back into the source md — is
 * applyAnswersToDocument below, because it must run bottom-up over the live text).
 *
 * MERGES, NEVER CLOBBERS (`bugs/01` → the gate blocker and the sender's I2/C6 findings). Two writers
 * share this file and each owns different keys: the PAGE owns `answers`, `comment`, `by`, `at`; the
 * SEND side owns `artifacts` (the per-artifact approval the gate verifies) and `delivered`. The page
 * used to rewrite the file whole, so a hand-authored artifact approval was destroyed by the owner's
 * next answer — which made the send gate's only reachable verdict a refusal, forever. Keys absent
 * from the new record survive; keys present in it win.
 *
 * The archive copy never overwrites: `archiveFor` names the file from a SECOND-resolution stamp, so
 * two writes inside one second used to land on the same path.
 *
 * [TESTED: 2026-08-10 · tools/verify-review-contour.mjs block GATE]
 */
export function writeDecision(docPath, record, { archiveAt = null } = {}) {
  const p = decisionPaths(docPath);
  mkdirSync(p.archiveDir, { recursive: true });

  const previous = existsSync(p.decision)
    ? (() => { try { return JSON.parse(readFileSync(p.decision, 'utf8')); } catch { return {}; } })()
    : {};
  const merged = { ...previous, ...record };
  const body = JSON.stringify(merged, null, 2) + '\n';

  writeFileSync(p.decision, body, 'utf8');

  let archive = p.archiveFor(archiveAt || record.at);
  for (let n = 2; existsSync(archive); n++) archive = archive.replace(/\.json$/u, `-${n}.json`);
  writeFileSync(archive, body, 'utf8');

  return { ...p, archive, merged };
}

/**
 * Write answers back into the source markdown.
 *
 * Two rules paid for by a field pilot, both non-obvious:
 *  - questions are applied BOTTOM-UP: an inserted line shifts everything below it, and stale
 *    positions wrote one answer's tail onto a neighbouring OPTION line;
 *  - an answer the owner already wrote is NEVER overwritten — new text arrives as a dated
 *    follow-up field, and the original stays verbatim.
 *
 * RETURNS A REPORT — `{written:[qid], skipped:[{id, reason}]}` — and the caller's summary is built
 * from it, never from the payload it posted. A question with no `**Ответ:**` field has nowhere to
 * receive an answer, so this function silently wrote nothing while the contour reported "ответов:
 * 1": a contour whose report of its own writing is unverified is the fraud class the framework
 * hunts (`bugs/01` → B4).
 *
 * [TESTED: 2026-08-09 · tools/verify-review-contour.mjs block B4 — red before, green after]
 */
export function applyAnswersToDocument(docPath, answers, { by, at, atHuman }) {
  // I22/I23: two representations of one moment, and neither replaces the other. The ISO stamp goes
  // into the HTML comment (machine memory); the line a HUMAN reads carries LOCAL time in words.
  // Showing UTC or an ISO string to the owner is a lie about the owner's own action.
  const human = atHuman || humanTime(new Date(at));
  const original = readFileSync(docPath, 'utf8');
  const doc = parseInterview(original, { file: docPath });
  const lines = normalize(original).split('\n');

  // Map question ids to their absolute answer-field line numbers.
  const absolute = [];
  {
    let qi = 0;
    for (let i = 0; i < lines.length; i++) {
      if (RE_QUESTION_HEADING.test(lines[i])) {
        qi++;
        const q = doc.questions[qi - 1];
        if (!q) continue;
        if (q.answerLine !== null) absolute.push({ q, line: i + q.answerLine });
      }
    }
  }

  // BOTTOM-UP — the whole reason this function is not a simple forEach.
  absolute.sort((a, b) => b.line - a.line);

  const written = [];
  for (const { q, line } of absolute) {
    const given = answers[q.id];
    if (!given || (!given.choice && !given.text)) continue;
    const rendered = [given.choice, given.text].filter(Boolean).join(' — ');

    if (q.answered) {
      // Never clobber the owner's own words: append a dated follow-up instead.
      lines.splice(line + 1, 0,
        '',
        `<!-- owner-review:followup at="${at}" by="${by}" -->`,
        `**Дополнено ${human}:** ${rendered}`);
    } else {
      lines[line] = `**Ответ:** ${rendered}`;
      lines.splice(line + 1, 0, `<!-- owner-review:answer at="${at}" by="${by}" -->`);
    }
    if (given.comment) {
      lines.splice(line + 1, 0, `**Комментарий:** ${given.comment}`);
    }
    written.push(q.id);
  }

  // What the owner answered but this function had nowhere to put. The caller carries these into the
  // document-wide comment block — the human's work is never dropped, and never silently counted.
  const skipped = [];
  for (const [qid, given] of Object.entries(answers)) {
    if (!given || (!given.choice && !given.text)) continue;
    if (written.includes(qid)) continue;
    const known = doc.questions.some((q) => q.id === qid);
    skipped.push({
      id: qid,
      reason: known ? 'у вопроса нет поля «Ответ:» — записывать некуда' : 'такого вопроса в документе нет',
    });
  }

  writeFileSync(docPath, normalize(lines.join('\n')), 'utf8');
  return { written, skipped };
}

/** The document-wide comment (P7) appends as a dated block at the END — it never overwrites. */
export function appendDocumentComment(docPath, text, { by, at, atHuman }) {
  const human = atHuman || humanTime(new Date(at));   // I23 — local time in words for the reader
  const original = readFileSync(docPath, 'utf8');
  const block = [
    '',
    `<!-- owner-review:comment at="${at}" by="${by}" -->`,
    `> **Комментарий владельца, ${human}:**`,
    ...String(text).split('\n').map((l) => `> ${l}`),
    '',
  ].join('\n');
  writeFileSync(docPath, normalize(original + block), 'utf8');
}

// ---------------------------------------------------------------------------------------------
// 5. The markdown mini-renderer (P8, I24)
// ---------------------------------------------------------------------------------------------

/**
 * ~120 lines, zero dependencies, escaping as the FIRST action.
 *
 * I24: HTML comments are STRIPPED — but only outside fenced code, where they are content. Every
 * path that shows document text to the owner must go through this one node; an answer excerpt on
 * a card that bypasses it re-leaks the service markers (field pilot, same class as the original).
 */
export function renderMarkdown(md) {
  const src = normalize(md);

  // Pull fenced code out first so nothing else touches it.
  const fences = [];
  let text = src.replace(/```[\s\S]*?```/gu, (m) => {
    fences.push(m);
    return `\n FENCE${fences.length - 1} \n`;
  });
  const fenceBody = (i) => String(fences[i] ?? '').replace(/^```[^\n]*\n?/u, '').replace(/```$/u, '');

  // I24 — service comments never reach the owner's eyes.
  text = text.replace(/<!--[\s\S]*?-->/gu, '');

  const esc = (s) => s
    .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');

  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/gu, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/gu, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/gu, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gu, '<a href="$2" rel="noreferrer">$1</a>');

  const out = [];
  const lines = text.split('\n');
  let inList = false;
  let inQuote = false;
  let table = null;

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const closeQuote = () => { if (inQuote) { out.push('</blockquote>'); inQuote = false; } };
  const closeTable = () => {
    if (!table) return;
    const head = table.rows[0] || [];
    const body = table.rows.slice(table.hasHeader ? 2 : 1);
    out.push('<div class="tw"><table>');
    if (table.hasHeader) {
      out.push('<thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>');
    }
    out.push('<tbody>' + body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody>');
    out.push('</table></div>');
    table = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(/^\s* FENCE(\d+) \s*$/u);
    if (fence) {
      closeList(); closeQuote(); closeTable();
      out.push(`<pre><code>${esc(fenceBody(Number(fence[1])))}</code></pre>`);
      continue;
    }

    if (/^\s*\|/u.test(line)) {
      const cells = line.trim().replace(/^\||\|$/gu, '').split('|').map((c) => c.trim());
      if (!table) table = { rows: [], hasHeader: false };
      if (/^[\s|:-]+$/u.test(line) && table.rows.length === 1) { table.hasHeader = true; table.rows.push(cells); }
      else table.rows.push(cells);
      continue;
    }
    closeTable();

    if (RE_HRULE.test(line)) { closeList(); closeQuote(); out.push('<hr>'); continue; }

    const h = line.match(RE_HEADING);
    if (h) {
      closeList(); closeQuote();
      const level = Math.min(h[1].length + 1, 6);   // demote: the page owns <h1>
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      continue;
    }

    const q = line.match(/^\s*>\s?(.*)$/u);
    if (q) {
      closeList();
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      out.push(`<p>${inline(q[1])}</p>`);
      continue;
    }
    closeQuote();

    const li = line.match(/^\s*[-*]\s+(.*)$/u);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    closeList();

    if (line.trim() === '') continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList(); closeQuote(); closeTable();

  // The exact sweep. A NUL cannot occur in the source text, so any placeholder still standing
  // here came from a fenced span that was NOT alone on its line — it becomes inline code rather
  // than the literal word FENCE on the owner's page (`bugs/01` -> A3).
  return out.join('\n').replace(
    new RegExp(String.fromCharCode(0) + 'FENCE(\\d+)' + String.fromCharCode(0), 'gu'),
    (_, n) => `<code>${esc(fenceBody(Number(n)))}</code>`,
  );
}

// ---------------------------------------------------------------------------------------------
// 6. The queue (I7, C9)
// ---------------------------------------------------------------------------------------------

/**
 * The queue is a STATE FILE. Live documents are NEVER moved into a pending folder — moving them
 * breaks every link to them from status and plans (I7).
 */
export function readQueue(interviewsDir) {
  const p = join(resolve(interviewsDir), 'decisions', 'queue.json');
  if (!existsSync(p)) return { items: [], notices: [] };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { items: [], notices: [] }; }
}

export function writeQueue(interviewsDir, queue) {
  const dir = join(resolve(interviewsDir), 'decisions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'queue.json'), JSON.stringify(queue, null, 2) + '\n', 'utf8');
}

/** Every interview document on disk, parsed. The guard and the batch page share this listing. */
export function listInterviews(interviewsDir) {
  const dir = resolve(interviewsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^interview[_-].*\.md$/iu.test(f))
    .sort()
    .map((f) => {
      const full = join(dir, f);
      return parseInterview(readFileSync(full, 'utf8'), { file: full });
    });
}

/** Local time in words for the owner (I22, I23) — never UTC in an interface. */
export function humanTime(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO with the local offset — the machine representation of the same moment (I22). */
export function isoLocal(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}
