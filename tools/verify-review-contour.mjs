#!/usr/bin/env node
// tools/verify-review-contour.mjs — the owner-review contour's own QA run.
//
// WHY THIS EXISTS. The contour was verified by COUNTING (3 cards, 12 options, 0 leaked markers) and
// counting is blind to omission: nine adversarial reviewers then found 23 defects the happy path
// never touches (`bugs/01_owner_review_contour_adversarial_findings.md`). This file is the answer to
// both halves of that bug — it RE-VERIFIES each major finding mechanically, and it stays behind as
// the guard for the whole class so no fix is a fix on loan (`BUG_FIXING_FRAMEWORK.md` → Guards).
//
// EVERY CHECK ASSERTS THE CORRECT BEHAVIOUR, never the current one. Run before the fixes it goes
// RED on exactly the reproducible findings — that red IS the re-verification the bug's fix plan
// demands, and a check that is GREEN before any fix has refuted its finding. Run after the fixes it
// must be green. A guard that has never failed proves nothing.
//
// Nothing here touches the project's real interviews: every fixture is built in a fresh temp
// directory and removed at the end (--keep leaves it for inspection).
//
// Usage:
//   node tools/verify-review-contour.mjs            # all blocks
//   node tools/verify-review-contour.mjs --only A1  # one block (id or comma list)
//   node tools/verify-review-contour.mjs --keep     # keep the temp fixtures
// Exit: 0 = every block passed · 1 = at least one block failed.
//
// Output is English: the reader is the agent, not the owner (AGENT_GUIDE.md → Languages).

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';

import * as core from './lib/review-core.mjs';
import { repoFromTarget, sendUpstream } from './send-upstream.mjs';
import { scanDocumentForOwnerQuestions, checkUnreachableChoices } from './questions-guard.mjs';
// bugs/66: the ask block and the spoken phrase must come from ONE function; the blocks
// below compare the two OUTPUTS against each other, never against a written constant.
import { askFor, callPhrase, loadDoc } from './review.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LF = String.fromCharCode(10);
const REVIEW = join(HERE, 'review.mjs');

// A contour run must never outlive the check that started it (C9 in spirit).
const RUN_DEADLINE_MS = 30_000;

// ---------------------------------------------------------------------------------------------
// 1. The tiny harness. No dependency, no framework — a block is a name plus an async function that
//    throws on failure. The report is a table because a table is read, and a stack trace is not.
// ---------------------------------------------------------------------------------------------

const blocks = [];
const block = (id, what, fn) => blocks.push({ id, what, fn });

/** Assert helper. `detail` is the OBSERVATION — what was actually seen — never a restatement. */
function must(cond, detail) {
  if (!cond) throw new Error(detail);
}

function tail(s, n = 400) {
  const t = String(s == null ? '' : s);
  return t.length <= n ? t : `…${t.slice(-n)}`;
}

// ---------------------------------------------------------------------------------------------
// 2. Fixtures. Written as FILES (never as command-line arguments): every one of them is Russian,
//    and argv is the wrong pipe for non-ASCII text (AGENT_GUIDE.md → text hygiene).
// ---------------------------------------------------------------------------------------------

let ROOT = null;                       // the temp root for this run

function freshDir(name) {
  const d = join(ROOT, name);
  mkdirSync(join(d, 'decisions'), { recursive: true });
  return d;
}

/** The marker strings are unique and long on purpose: a short pattern matches someone else's line. */
const M = {
  preamble: 'МАРКЕР_ПРЕАМБУЛЫ_9001',
  between: 'МАРКЕР_МЕЖДУ_ВОПРОСАМИ_9002',
  epilogue: 'МАРКЕР_ЭПИЛОГА_БЕЗ_ЗАГОЛОВКА_9003',
  fenced: 'МАРКЕР_ВНУТРИ_КОДА_9004',
};

/**
 * A document shaped like the project's REAL interviews: `---` rules between blocks, a status line,
 * options as `- **A** — …`. The three markers sit exactly where the findings say text is lost.
 */
function docWithProseAroundQuestions() {
  return [
    '# Интервью 900 — проверочный документ контура',
    '',
    '**Topic:** проверка того, что страница показывает документ целиком',
    '**Status:** 🔴 ждёт владельца',
    '',
    '---',
    '',
    `Преамбула. ${M.preamble} — этот абзац стоит до первого вопроса.`,
    '',
    '## Вопрос 1. Первый вопрос',
    '',
    'Тело первого вопроса.',
    '',
    '- **A** — первый вариант',
    '- **B** — второй вариант',
    '',
    '**Ответ:**',
    '',
    '---',
    '',
    `${M.between} — этот абзац стоит МЕЖДУ двумя вопросами, после горизонтальной линейки.`,
    '',
    '## Вопрос 2. Второй вопрос',
    '',
    'Тело второго вопроса.',
    '',
    '- **A** — первый вариант',
    '- **B** — второй вариант',
    '',
    '**Ответ:**',
    '',
    '---',
    '',
    `${M.epilogue} — этот абзац стоит после последнего вопроса, и заголовка после него нет.`,
    '',
  ].join('\n');
}

/** A fenced block indented inside a list item — the shape A3 says the renderer mishandles. */
function docWithIndentedFence() {
  return [
    '# Интервью 901 — фрагмент кода внутри списка',
    '',
    '**Status:** 🔴 ждёт владельца',
    '',
    '## Вопрос 1. Годится ли такая команда',
    '',
    'Проверьте команду:',
    '',
    '- Шаг первый, а под ним блок кода:',
    '',
    '  ```',
    `  npm run check # ${M.fenced}`,
    '  ```',
    '',
    '- **A** — годится',
    '- **B** — не годится',
    '',
    '**Ответ:**',
    '',
  ].join('\n');
}

/** A question with NO `**Ответ:**` field: the contour has nowhere to write, so it must not claim it did. */
function docWithoutAnswerField() {
  return [
    '# Интервью 902 — вопрос без поля ответа',
    '',
    '**Status:** 🔴 ждёт владельца',
    '',
    '## Вопрос 1. Вопрос, у которого поле ответа не проставлено',
    '',
    'Тело вопроса. Поля «Ответ:» ниже нет — записывать ответ некуда.',
    '',
    '- **A** — первый вариант',
    '- **B** — второй вариант',
    '',
  ].join('\n');
}

/** A single-question document with a real answer field — used for the queue-clearing check. */
function docWithOneAnswerableQuestion() {
  return [
    '# Интервью 903 — один вопрос, на который можно ответить',
    '',
    '**Status:** 🔴 ждёт владельца',
    '',
    '## Вопрос 1. Единственный вопрос',
    '',
    'Тело вопроса.',
    '',
    '- **A** — первый вариант',
    '- **B** — второй вариант',
    '',
    '**Ответ:**',
    '',
  ].join('\n');
}

/**
 * A document declaring an outbound artifact. `target` and `format` are parameters because the two
 * sender findings are precisely about what the guards do with unusual values of them.
 */
function docWithArtifact({ target, format }) {
  const lines = [
    '# Отправляемый документ 904',
    '',
    '```yaml',
    'title: Отправляемый документ 904',
    'artifacts:',
    '  - id: art1',
    `    target: ${target}`,
  ];
  if (format) lines.push(`    format: ${format}`);
  lines.push('    body_file: art1_body.md', '```', '', 'Тело документа.', '');
  return lines.join('\n');
}

/** Build the document + body + an APPROVED decision record bound to the body's hash (I3). */
function buildSendFixture(dirName, { target, format }) {
  const dir = freshDir(dirName);
  const docPath = join(dir, 'send_904.md');
  const bodyPath = join(dir, 'art1_body.md');
  const body = ['# Заголовок тела задачи', '', 'Текст тела.', ''].join('\n');

  writeFileSync(docPath, docWithArtifact({ target, format }), 'utf8');
  writeFileSync(bodyPath, body, 'utf8');

  const p = core.decisionPaths(docPath);
  mkdirSync(p.archiveDir, { recursive: true });
  writeFileSync(p.decision, `${JSON.stringify({
    kind: 'interview',
    document: 'send_904.md',
    by: 'Mikalai Kryvusha',
    at: core.isoLocal(new Date()),
    status: 'approved',
    artifacts: { art1: { status: 'approved', sha256: core.hashBody(body) } },
  }, null, 2)}\n`, 'utf8');

  return { dir, docPath, bodyPath };
}

// ---------------------------------------------------------------------------------------------
// 3. Driving the contour for real. The page is a browser's job; the SERVER is not, so the checks
//    that need the whole cycle speak HTTP to it exactly as the page does.
// ---------------------------------------------------------------------------------------------

/** Spawn `review.mjs`, resolve with the live URL, and keep the whole log for the failure message. */
function startContour(args) {
  const child = spawn(process.execPath, [REVIEW, ...args], { windowsHide: true });
  const log = { out: '', err: '' };
  const exit = new Promise((res) => child.on('close', (code) => res(code)));

  const url = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error(`the contour printed no address in ${RUN_DEADLINE_MS} ms; log: ${tail(log.out)}`)), RUN_DEADLINE_MS);
    child.stdout.on('data', (c) => {
      log.out += c.toString('utf8');
      const m = log.out.match(/СТРАНИЦА:\s*(http:\/\/\S+)/u);
      if (m) { clearTimeout(timer); res(m[1]); }
    });
    child.stderr.on('data', (c) => { log.err += c.toString('utf8'); });
    child.on('close', () => { clearTimeout(timer); rej(new Error(`the contour exited before serving; log: ${tail(log.out + log.err)}`)); });
  });

  return { child, log, url, exit, kill: () => { try { child.kill(); } catch { /* already gone */ } } };
}

/** POST the page's own payload shape to /save and return the server's JSON answer. */
function postSave(url, payload) {
  return new Promise((res, rej) => {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const u = new URL(`${url}/save`);
    const req = httpRequest({
      hostname: u.hostname, port: u.port, path: '/save', method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=utf-8', 'Content-Length': body.length },
    }, (r) => {
      let text = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { text += c; });
      r.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { json = null; }
        res({ status: r.statusCode, json, text });
      });
    });
    req.setTimeout(RUN_DEADLINE_MS, () => { req.destroy(new Error('/save did not answer')); });
    req.on('error', rej);
    req.end(body);
  });
}

/** Render a document to HTML without a server — the cheap path for the page-content checks. */
async function renderOnly(docPath, extraArgs) {
  const out = join(dirname(docPath), 'preview.html');
  const args = [REVIEW, docPath, '--no-serve', '--no-signal', '--out', out].concat(extraArgs || []);
  const child = spawn(process.execPath, args, { windowsHide: true });
  let log = '';
  child.stdout.on('data', (c) => { log += c.toString('utf8'); });
  child.stderr.on('data', (c) => { log += c.toString('utf8'); });
  const code = await new Promise((res) => child.on('close', res));
  must(code === 0, `render exited ${code}: ${tail(log)}`);
  must(existsSync(out), `render wrote no file: ${tail(log)}`);
  return readFileSync(out, 'utf8');
}

// ---------------------------------------------------------------------------------------------
// 4. The blocks — one per major finding of bugs/01
// ---------------------------------------------------------------------------------------------

block('A1', 'the page shows text that sits BETWEEN two question blocks', async () => {
  const dir = freshDir('a1');
  const docPath = join(dir, 'interview_900_prose.md');
  writeFileSync(docPath, docWithProseAroundQuestions(), 'utf8');
  const html = await renderOnly(docPath);

  must(html.includes(M.preamble), 'the preamble itself is missing from the page — the split is broken further up than the finding claims');
  must(html.includes(M.between),
    'the paragraph between question 1 and question 2 is NOT on the page: the owner decides without the framing he was never shown');
});

block('A2', 'the page shows an epilogue that is plain prose with no heading after it', async () => {
  const dir = freshDir('a2');
  const docPath = join(dir, 'interview_900_prose.md');
  writeFileSync(docPath, docWithProseAroundQuestions(), 'utf8');
  const html = await renderOnly(docPath);

  must(html.includes(M.epilogue),
    'the closing paragraph after the last question is NOT on the page: with no further heading the epilogue is dropped');
});

block('A3', 'a fenced block indented inside a list item renders as code, and no placeholder leaks', async () => {
  const dir = freshDir('a3');
  const docPath = join(dir, 'interview_901_fence.md');
  writeFileSync(docPath, docWithIndentedFence(), 'utf8');
  const html = await renderOnly(docPath);

  must(!/FENCE\d/u.test(html),
    'the renderer\'s internal placeholder (FENCE<n>) leaked onto the page as visible text');
  must(html.includes(M.fenced), 'the fenced block\'s content never reached the page at all');
  const idx = html.indexOf(M.fenced);
  const around = html.slice(Math.max(0, idx - 200), idx);
  must(/<pre><code>/u.test(around),
    `the fenced block was not rendered as code; what precedes it: ${tail(around, 160)}`);
});

block('B4', 'the writer reports what LANDED in the document, not what was posted', async () => {
  // 🔴 THIS BLOCK WAS DRIVEN THROUGH THE SERVER UNTIL 2026-08-23 18:3x, AND THE `bugs/41` GATE MADE
  // THAT PATH UNREACHABLE — deliberately: the contour now REFUSES to raise a page over a document
  // whose questions have no `**Ответ:**` field, which is precisely this fixture. The property B4
  // guards did not become less true, it moved one floor down, so the block moved with it: it now
  // drives `applyAnswersToDocument` directly, which is where the report is actually built.
  //
  // Why the block is kept at all when the front door is closed: the gate stops a HUMAN being called
  // to an unanswerable page; it does not stop a caller using the library (`--no-serve` renders,
  // future tooling, a document that loses its field between the raise and the answer). A truthful
  // report of one's own writing is the last line, and `bugs/01` → B4 is what it costs when it lies.
  const dir = freshDir('b4');
  const docPath = join(dir, 'interview_902_noanswerfield.md');
  writeFileSync(docPath, docWithoutAnswerField(), 'utf8');
  const before = readFileSync(docPath, 'utf8');

  const report = core.applyAnswersToDocument(docPath, { Q1: { choice: 'A', text: '', comment: '' } },
    { by: 'Mikalai Kryvusha', at: core.isoLocal(new Date()) });
  const after = readFileSync(docPath, 'utf8');

  must(report.written.length === 0,
    `the writer claims it wrote ${JSON.stringify(report.written)} while the question has no answer field`);
  must(after === before,
    'the document changed even though there was nowhere to write — the answer landed on a line that is not an answer field');
  must(report.skipped.length === 1 && report.skipped[0].id === 'Q1' && /Ответ/u.test(report.skipped[0].reason),
    `the skip is not reported by name and reason: ${JSON.stringify(report.skipped)}`);
});

block('B5', 'a document whose questions are all answered stops being "waiting" by itself', async () => {
  const dir = freshDir('b5');
  const docPath = join(dir, 'interview_903_single.md');
  writeFileSync(docPath, docWithOneAnswerableQuestion(), 'utf8');

  const run = startContour([docPath, '--no-signal', '--no-open']);
  try {
    const url = await run.url;
    const res = await postSave(url, { documents: { interview_903_single: { comment: '', noticeRead: false, answers: { Q1: { choice: 'A', text: '', comment: '' } } } } });
    must(res.json && res.json.ok, `the answer was refused: ${res.text}`);
    await run.exit;

    const m = /осталось ждать владельца:\s*(\d+)/u.exec(run.log.out);
    must(m, `the contour never reported the remaining count; log: ${tail(run.log.out)}`);
    must(readFileSync(docPath, 'utf8').includes('**Ответ:** A'), 'the answer did not reach the document at all');
    must(Number(m[1]) === 0,
      `the only question was answered and written, yet the queue still reports ${m[1]} document(s) waiting — isWaiting reads a status line the contour never writes`);
  } finally {
    run.kill();
  }
});

block('B6', 'a batch window and a single-document window on the SAME document collide', async () => {
  const dir = freshDir('b6');
  const docPath = join(dir, 'interview_903_single.md');
  writeFileSync(docPath, docWithOneAnswerableQuestion(), 'utf8');

  const first = startContour([dir, '--batch', '--no-signal', '--no-open']);
  let second = null;
  try {
    await first.url;
    second = startContour([docPath, '--no-signal', '--no-open']);
    const outcome = await Promise.race([
      second.url.then((u) => ({ kind: 'served', u })).catch(() => ({ kind: 'refused' })),
      second.exit.then(() => ({ kind: 'refused' })),
    ]);
    must(outcome.kind === 'refused',
      `a second window opened on a document already shown by the batch run (${outcome.u}) — two windows are two drafts on two ports`);
  } finally {
    first.kill();
    if (second) second.kill();
    await first.exit;
    if (second) await second.exit;
  }
});

block('C7', 'the addressee guard refuses a target it cannot honestly read as a GitHub repository', async () => {
  const fabricated = [];
  const cases = [
    ['https://gitlab.com/acme/widgets', 'a GitLab URL'],
    ['https://bitbucket.org/acme/widgets', 'a Bitbucket URL'],
    ['Slack · #general/подрядчики', 'a Slack channel'],
    ['Google Docs · docs.google.com/document/d/abc123', 'a Google Docs link'],
    ['https://github.com/MikalaiKryvusha/KAIF/issues/7', 'a link to an ISSUE, not to a repository root'],
  ];
  for (const [target, what] of cases) {
    const got = repoFromTarget(target);
    if (got) fabricated.push(`${what}: ${target} -> ${got}`);
  }
  must(fabricated.length === 0,
    `the guard invented a repository for ${fabricated.length} target(s) it must refuse:\n      ${fabricated.join('\n      ')}`);
});

block('C8', 'omitting `format` does not skip the sender\'s format guard', async () => {
  const { docPath } = buildSendFixture('c8', { target: 'https://gitlab.com/acme/widgets', format: null });
  const res = sendUpstream(docPath, 'art1', { apply: false, run: () => { throw new Error('gh must not be reached in a dry run'); } });
  must(res.ok === false,
    'a dry run with an unreachable addressee and NO declared format passed the sender\'s preconditions — both halves of the addressee defence are skippable by omission');
});

block('C9', 'the double-send guard holds when the delivery recorded no URL', async () => {
  const { docPath } = buildSendFixture('c9', { target: 'github.com/MikalaiKryvusha/KAIF', format: 'issue' });
  // gh exits 0 but prints no URL — the shape the sender itself records as `url: null`.
  const runNoUrl = () => ({ status: 0, stdout: 'created the issue, no address in this output', stderr: '' });

  const first = sendUpstream(docPath, 'art1', { apply: true, run: runNoUrl });
  must(first.called === true, `the first send never reached the runner: ${first.verdict && first.verdict.reason}`);

  const second = sendUpstream(docPath, 'art1', { apply: true, run: runNoUrl });
  must(second.called === false,
    'the SAME artifact was sent a second time: the guard is bound to delivered.url, which the sender itself is allowed to write as null');
});

block('P8', 'an option label that wraps carries no block markup inside its inline label', async () => {
  const dir = freshDir('p8');
  const docPath = join(dir, 'interview_905_wrap.md');
  writeFileSync(docPath, [
    '# Интервью 905 — вариант в несколько строк',
    '',
    '**Status:** 🔴 ждёт владельца',
    '',
    '## Вопрос 1. Вариант, текст которого переносится',
    '',
    'Тело вопроса.',
    '',
    '- **A. (Рекомендовано)** Первая строка варианта, достаточно длинная, чтобы автор перенёс её',
    '  на вторую строку прямо в документе — ровно как в живом интервью 001.',
    '- **B** — короткий вариант',
    '',
    '**Ответ:**',
    '',
  ].join('\n'), 'utf8');

  const html = await renderOnly(docPath);
  // The WHOLE option element, not "up to the first </span>" — the label opens with a nested
  // <span class="oletter">, so a lazy cut stops on ITS closing tag and the assertion below can
  // never fail. That mistake is the very class this file exists to hunt (C11), made once here.
  const labels = [...html.matchAll(/<label class="opt"[\s\S]*?<\/label>/gu)].map((m) => m[0]);
  must(labels.length >= 2, `expected the two options on the page, found ${labels.length}`);
  const withBlocks = labels.filter((l) => /<\/?p>/u.test(l));
  must(withBlocks.length === 0,
    `${withBlocks.length} option label(s) carry paragraph markup inside an inline label: ${tail(withBlocks[0], 200)}`);
});

block('I15', 'a pure render (--no-serve) does not stamp the queue as SHOWN', async () => {
  const dir = freshDir('i15');
  const docPath = join(dir, 'interview_903_single.md');
  writeFileSync(docPath, docWithOneAnswerableQuestion(), 'utf8');
  const queuePath = join(dir, 'decisions', 'queue.json');

  await renderOnly(docPath);
  must(!existsSync(queuePath),
    `a build-and-exit render wrote ${queuePath} — the queue asserts a show for a page nobody was shown`);
});

block('I29b', 'the contour\'s lock file is excluded from git', async () => {
  const probe = 'interviews/decisions/.review-lock-interview_001_harness_boundaries.json';
  const r = spawn(process.platform === 'win32' ? 'git.exe' : 'git',
    ['check-ignore', '-q', probe], { cwd: resolve(HERE, '..'), windowsHide: true });
  const code = await new Promise((res) => { r.on('close', res); r.on('error', () => res(-1)); });
  must(code === 0, `git does not ignore ${probe} (check-ignore exited ${code}) — a pid and a loopback port would ride into a public repository`);
});

block('I4b', 'a decision that rejects an artifact is refused even with no document-level status', async () => {
  const { docPath } = buildSendFixture('i4b', { target: 'github.com/MikalaiKryvusha/KAIF', format: 'issue' });
  const p = core.decisionPaths(docPath);
  const record = JSON.parse(readFileSync(p.decision, 'utf8'));
  delete record.status;                              // no document-level verdict at all
  record.artifacts.art1.status = 'rejected';         // the artifact-level verdict says NO
  writeFileSync(p.decision, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const res = sendUpstream(docPath, 'art1', { apply: true, run: () => { throw new Error('gh must not be reached'); } });
  must(res.ok === false && res.called === false,
    'a rejected artifact passed the gate when the record carried no document-level status');
});

// ---------------------------------------------------------------------------------------------
// 4b. The questions guard — the blockers are patterns that cannot match the owner's language
//
// `\w` and `\b` are ASCII-only in Node even under `/u`, so a Russian stem followed by `\w*` matches
// the empty string and the pattern dies on the very suffix that makes the phrase grammatical. The
// guard then reports ЧИСТО because it is blind, which is the worst state a guard can be in: a false
// green nobody audits. The file's own header warns about this rake three lines above the code that
// commits it (`bugs/01` → rake 7 / G1).
// ---------------------------------------------------------------------------------------------

/** Feed one line to the guard as a whole document and say whether it was caught. */
function guardCatches(line) {
  const text = ['# Проверочный документ', '', line, ''].join('\n');
  return scanDocumentForOwnerQuestions('plans/probe.md', text).length > 0;
}

block('G1a', 'the guard catches an owner-question heading in every Russian form, not only the bare stem', async () => {
  const mustCatch = [
    '## Вопросы владельцу',
    '## Вопросов владельцу накопилось',
    '## Вопрос владельцу',
    '## Развилки для владельца',
    '## Развилка для владельца',
    '## Развилку владельцу',
  ];
  const missed = mustCatch.filter((l) => !guardCatches(l));
  must(missed.length === 0, `${missed.length} heading(s) the guard cannot see: ${missed.join(' | ')}`);
});

block('G1b', 'the guard catches a request for the owner\'s decision in every Russian form', async () => {
  const mustCatch = [
    'Нужно ваше решение по частоте.',
    'Нужна ваша оценка риска.',
    'Требуется подтверждение владельца.',
    'Не хватает вашего слова по этому пункту.',
    'Жду вашего ответа по варианту B.',
  ];
  const missed = mustCatch.filter((l) => !guardCatches(l));
  must(missed.length === 0, `${missed.length} request(s) the guard cannot see: ${missed.join(' | ')}`);
});

block('G1c', 'the guard catches an address to the owner in the NOMINATIVE — the case an address uses', async () => {
  const mustCatch = [
    'Владелец, подтвердите частоту.',
    'Владелец: подтвердите частоту.',
    'Владелец — подтвердите частоту.',
    'Владельцу, подтвердите частоту.',
  ];
  const missed = mustCatch.filter((l) => !guardCatches(l));
  must(missed.length === 0, `${missed.length} address(es) the guard cannot see: ${missed.join(' | ')}`);
});

block('G1d', 'the guard still stays quiet on the forms that are NOT a question to the owner (G9)', async () => {
  // A false alarm is worse than a miss: widening the patterns must not swallow ordinary prose.
  // The genitive is a question BY the owner — the case carries the direction (the file's own note).
  const mustStaySilent = [
    'Вопрос владельца был закрыт ещё в прошлой сессии.',
    'Вопросы владельца из чата перенесены в интервью.',
    'Развилка владельца уже описана в мастер-плане.',
    'owner-vs-owner сравнение двух прогонов',
    'В отчёте есть раздел про решения владельца, принятые ранее.',
  ];
  const fired = mustStaySilent.filter((l) => guardCatches(l));
  must(fired.length === 0, `${fired.length} ordinary line(s) raised a false alarm: ${fired.join(' | ')}`);
});

block('ANSWERABLE', 'the page is refused over a document the owner could not answer on (bugs/41)', async () => {
  // THE FIXTURES ARE THE INCIDENT, not an invention. On 2026-08-23 the owner answered two real
  // interviews and NEITHER answer reached its document: one had numbered questions with no
  // `**Ответ:**` field, the other a heading without a NUMBER — so the parser saw no question and
  // the page offered no input at all («поле для ответа было не доступно для ввода»). Both shapes
  // are reproduced below.
  const numberless = [
    '# Интервью 904 — заголовок вопроса без номера',
    '', '**Status:** 🔴 ждёт владельца', '',
    '## Вопрос: какой объём берём?', '',
    'Тело вопроса.', '',
    '- **A** — первый вариант',
    '- **B** — второй вариант', '',
    '**Ответ:**', '',
  ].join('\n');
  const fieldless = [
    '# Интервью 905 — вопрос есть, поля ответа нет',
    '', '**Status:** 🔴 ждёт владельца', '',
    '## Вопрос 1. Первый', '', 'Тело.', '', '- **A** — раз', '- **B** — два', '',
    '## Вопрос 2. Второй', '', 'Тело.', '', '- **A** — раз', '- **B** — два', '',
  ].join('\n');

  // 1 — the good shape passes: a guard that reddens on the normal case is the trap R17 names.
  must(core.answerabilityRefusals(core.parseInterview(docWithOneAnswerableQuestion(), { file: 'ok.md' })).length === 0,
    'the answerable fixture was refused — the guard fires on the state the machinery works in');

  // 2 — no NUMBER in the heading = no question at all, and the refusal says exactly that
  const r1 = core.answerabilityRefusals(core.parseInterview(numberless, { file: 'numberless.md' }));
  must(r1.length === 1 && /ни одного распознанного вопроса/u.test(r1[0].what),
    `a heading without a number was accepted: ${JSON.stringify(r1)}`);
  must(/НОМЕР/u.test(r1[0].fix), 'the refusal does not tell the agent what to repair');

  // 3 — one refusal PER question, addressed by id: «fix the document» is not an address
  const r2 = core.answerabilityRefusals(core.parseInterview(fieldless, { file: 'fieldless.md' }));
  must(r2.length === 2 && r2.every((r) => /Ответ/u.test(r.what)), `expected 2 field refusals, got ${r2.length}`);
  must(r2[0].where.endsWith('Q1') && r2[1].where.endsWith('Q2'), `refusals are not addressed by question id: ${r2.map((r) => r.where).join(' | ')}`);

  // 4 — THE NARROWING, and it is here because the FIRST version of the gate lacked it: a document
  // that is CLOSED is raised to be SHOWN, not answered, so «нечем ответить» is not a defect there.
  // Six closed interviews in this project carry no answer field and the first gate refused them all.
  const closedNoField = fieldless.replace('**Status:** 🔴 ждёт владельца', '**Status:** ✅ закрыто владельцем 2026-08-01');
  const dirC = freshDir('answerable-closed');
  const closedPath = join(dirC, 'interview_906_closed.md');
  writeFileSync(closedPath, closedNoField, 'utf8');
  const shown = spawn(process.execPath, [join(HERE, 'review.mjs'), closedPath, '--no-serve', '--no-signal', '--no-open']);
  let outC = '';
  shown.stdout.on('data', (d) => { outC += d; });
  shown.stderr.on('data', (d) => { outC += d; });
  const codeC = await new Promise((res) => shown.on('exit', res));
  must(codeC === 0, `a CLOSED document was refused — the gate fires on a legitimate state (R17): exit ${codeC} · ${tail(outC)}`);

  // 5 — END TO END, and this is the half that matters: the RAISE refuses, before any beep.
  // The contour is started exactly as a caller starts it; a page must not appear, and the exit
  // code must say so to a machine (the incident's own miss was a truthful message nobody could act on).
  const dir = freshDir('answerable');
  const badPath = join(dir, 'interview_904_numberless.md');
  writeFileSync(badPath, numberless, 'utf8');
  const proc = spawn(process.execPath, [join(HERE, 'review.mjs'), badPath, '--no-signal', '--no-open'], { encoding: 'utf8' });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; });
  proc.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((res) => proc.on('exit', res));
  must(code === 2, `the raise did not refuse: exit ${code} · ${tail(out)}`);
  must(/СТРАНИЦА НЕ ПОДНЯТА/u.test(out), `the refusal is not the one we mean: ${tail(out)}`);
  must(!/СТРАНИЦА: http/u.test(out), `a page was raised anyway: ${tail(out)}`);
});

// ---------------------------------------------------------------------------------------------
// bugs/66 — ПОСТАНОВКА: страница обязана сказать владельцу, ЧТО от него нужно.
//
// АДРЕСНОСТЬ МУТАЦИЙ ОБЪЯВЛЕНА ДО ПРОГОНА (канон судьи, KAIF 2.1):
//   мутант «снять блок .ask из buildPage»          → краснеет РОВНО N1 (и N3 как следствие чтения
//                                                     страницы), никакой другой блок набора;
//   мутант «вернуть голосу собственную формулировку» → краснеет РОВНО N3;
//   мутант «игнорировать --ask»                     → краснеет РОВНО N2;
//   целый код                                       → 0 красных.
// ---------------------------------------------------------------------------------------------

/** A document with prose and NOT ONE question — the route bugs/66 was found on. */
function docWithNoQuestions() {
  return [
    '# Тихий документ без вопросов',
    '',
    'Это текст, который агент показывает владельцу на вычитку.',
    'Вопросов в нём нет ни одного.',
    '',
  ].join('\n');
}

block('N1', 'a page with NO questions says what is wanted of the owner (bugs/66)', async () => {
  const dir = freshDir('n1');
  const docPath = join(dir, 'notice_910_silent.md');
  writeFileSync(docPath, docWithNoQuestions(), 'utf8');
  const html = await renderOnly(docPath);

  must(/<div class="ask">/u.test(html),
    'the page carries no ПОСТАНОВКА block at all — this is exactly bugs/66: the owner asked ' +
    '«Что от меня нужно?» and the page had no answer');

  const askBlock = (html.match(/<div class="ask">[\s\S]*?<\/div>/u) || [''])[0];
  must(/class="what"/u.test(askBlock), 'ПОСТАНОВКА does not say WHAT this document is');
  must(/class="why"/u.test(askBlock), 'ПОСТАНОВКА does not say WHY it is in front of the owner');
  must(/class="todo"/u.test(askBlock), 'ПОСТАНОВКА does not say WHAT CLOSES it');

  // The three zero counters are what stood there instead of an ask — they must give way, because
  // «всего вопросов 0» reports the absence of a request to a man who came to be asked something.
  must(!/class="pill/u.test(html),
    'the zero counters are still on a page that has no questions (bugs/66 symptom)');
});

block('N2', 'the caller can put its own line into the ask, and without it a formula stands', async () => {
  const dir = freshDir('n2');
  const docPath = join(dir, 'notice_911_ask.md');
  writeFileSync(docPath, docWithNoQuestions(), 'utf8');

  const mine = 'Это оперативный слой определений, без вашего утверждения он не действует.';
  const withAsk = await renderOnly(docPath, ['--ask', mine]);
  must(withAsk.includes(mine), '--ask did not reach the page — the caller cannot say why it asks');

  const without = await renderOnly(docPath);
  must(!without.includes(mine), 'the page carries the caller line that was never passed');
  const block2 = (without.match(/<div class="ask">[\s\S]*?<\/div>/u) || [''])[0];
  must(/\S/u.test(block2.replace(/<[^>]+>/gu, '').trim()),
    'with no --ask the ПОСТАНОВКА is empty — a general formula must stand there, not a hole');
});

block('N3', 'the page and the VOICE say the same thing, because one function feeds both', async () => {
  const dir = freshDir('n3');
  const docPath = join(dir, 'notice_912_pair.md');
  writeFileSync(docPath, docWithNoQuestions(), 'utf8');
  const html = await renderOnly(docPath);

  const queue = core.readQueue(dir);
  const d = loadDoc(docPath, queue);
  const a = askFor(d, '');
  const phrase = callPhrase({ batch: false, docs: [d], ask: '' });

  // Compared against EACH OTHER, never against a literal: a block that asserted a written string
  // would go green on any text and prove nothing about the pair (risk 2 of the plan).
  must(phrase.includes(a.what),
    'the spoken phrase no longer carries what askFor() says the document is — the voice has ' +
    'started writing its own wording, and the pair bugs/66 removed is back');
  must(phrase.includes(a.todo),
    'the spoken phrase no longer carries what askFor() says closes the document');

  const plain = html.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ');
  must(plain.includes(a.what), 'the PAGE no longer carries what askFor() says the document is');
  must(plain.includes(a.todo), 'the PAGE no longer carries what askFor() says closes the document');
});

/** A draft whose answer slot still holds the template's own instruction (`bugs/04`). */
function docWithPlaceholderAnswer() {
  return [
    '# Интервью 913 — заглушка в слоте ответа',
    '',
    '## Q1. Первый вопрос владельцу?',
    '',
    '- **A.** Первый вариант (Рекомендовано)',
    '- **B.** Второй вариант',
    '',
    '**Ответ:** _(впишите A, B, C или свой вариант в D)_',
    '',
  ].join(LF);
}

block('N4', 'a template placeholder in the answer slot is refused, never shown as answered (bugs/04)', async () => {
  const dir = freshDir('n4');
  const docPath = join(dir, 'interview_913_placeholder.md');
  writeFileSync(docPath, docWithPlaceholderAnswer(), 'utf8');

  // The refusal must reach the AGENT before the owner is ever called — that is the whole point of
  // this family of guards, so the block reads the EXIT CODE, not the rendered page.
  const out = join(dir, 'preview.html');
  const child = spawn(process.execPath, [REVIEW, docPath, '--no-serve', '--no-signal', '--out', out], { windowsHide: true });
  let log = '';
  child.stdout.on('data', (c) => { log += c.toString('utf8'); });
  child.stderr.on('data', (c) => { log += c.toString('utf8'); });
  const code = await new Promise((res) => child.on('close', res));

  must(code !== 0, 'the page was raised over a slot holding the template instruction — bugs/04 verbatim: ' + tail(log));
  must(/ЗАГЛУШКА ШАБЛОНА/u.test(log), 'the refusal does not say WHAT is wrong: ' + tail(log));
  must(/Q1/u.test(log), 'the refusal does not say WHICH question: ' + tail(log));

  // The narrowness of the rule is half of it: emphasis INSIDE a real answer must stay an answer.
  must(!core.isPlaceholderAnswer('A, и именно _его_ я выбираю'), 'emphasis inside a real answer read as a placeholder');
  must(!core.isPlaceholderAnswer('A'), 'a bare variant letter read as a placeholder');
  must(core.isPlaceholderAnswer('_…_'), 'the bare template slot is not recognised as one');
});

block('N5', 'a heading that CITES an answered question is not a new question (bugs/70)', async () => {
  // The shape that cost the owner a phantom obligation: an agent's write-up of what the answers
  // changed heads its sections with the question it is talking about.
  const doc = [
    '# Интервью 914 — две развилки',
    '',
    '## Q1. Первый вопрос?',
    '',
    '- **A.** Вариант A (Рекомендовано)',
    '',
    '**Ответ:** A',
    '',
    '## Q2. Второй вопрос?',
    '',
    '- **A.** Вариант A (Рекомендовано)',
    '',
    '**Ответ:** A',
    '',
    '## Что ответы меняют — разбор агента, написан ПОСЛЕ ответов',
    '',
    '### Q1 = A, и вот что из этого следует',
    '',
    'Разбор первого ответа.',
    '',
    '### Q2 = A — движемся сразу',
    '',
    'Разбор второго ответа.',
  ].join(LF);

  const parsed = core.parseInterview(doc, { file: 'interview_914.md' });
  must(parsed.questions.length === 2,
    'the write-up headings were counted as questions: ' + parsed.questions.length + ' instead of 2 — ' +
    'this is bugs/70, the phantom that put «Q6-Q7 ждут владельца» into the baton');
  must(parsed.questions.every((q) => q.answered),
    'a document whose every question is answered still reads as waiting');

  // The narrow half: a genuinely NEW number still opens a question.
  const three = core.parseInterview(doc.replace('### Q2 = A — движемся сразу', '## Q3. Третий вопрос?'), { file: 'i.md' });
  must(three.questions.length === 3, 'a real third question was swallowed by the de-duplication');
});

block('GATE', 'an artifact approval survives the owner\'s next answer, and the refusal names the truth', async () => {
  const dir = freshDir('gate');
  const docPath = join(dir, 'interview_903_single.md');
  writeFileSync(docPath, docWithOneAnswerableQuestion(), 'utf8');

  // Before any approval exists the gate must REFUSE — and say why, not just that.
  const { checkApproval } = await import('./review-gate.mjs');
  const blind = checkApproval(docPath, 'art1');
  must(blind.ok === false, 'the gate approved a document with no decision at all');

  // A hand-authored approval, exactly as the refusal instructs.
  const p = core.decisionPaths(docPath);
  const body = '# Тело\n\nтекст\n';
  writeFileSync(join(dir, 'art1_body.md'), body, 'utf8');
  core.writeDecision(docPath, {
    kind: 'interview', document: 'interview_903_single.md', by: 'Mikalai Kryvusha',
    at: core.isoLocal(new Date()), answers: {},
    artifacts: { art1: { status: 'approved', sha256: core.hashBody(body) } },
  });

  // The owner then answers a question on the page — the write that used to erase the approval.
  const run = startContour([docPath, '--no-signal', '--no-open']);
  try {
    const url = await run.url;
    const res = await postSave(url, { documents: { interview_903_single: { comment: '', noticeRead: false, answers: { Q1: { choice: 'A', text: '', comment: '' } } } } });
    must(res.json && res.json.ok, `the answer was refused: ${res.text}`);
    await run.exit;
  } finally {
    run.kill();
  }

  const after = JSON.parse(readFileSync(p.decision, 'utf8'));
  must(after.artifacts && after.artifacts.art1 && after.artifacts.art1.status === 'approved',
    `the owner's answer destroyed the artifact approval — the send gate can never pass again. Record now: ${tail(JSON.stringify(after), 240)}`);
  must(after.answers && after.answers.Q1, 'the answer itself did not survive the merge');
});

// ---------------------------------------------------------------------------------------------
// bugs/71 — ВЛАДЕЛЬЦУ НЕЧЕГО НАЖАТЬ: ось G12 сторожа вопросов, обе ветки и обратная сторона.
//
// Оплачено ДВАЖДЫ за один день, 2026-08-30: интервью 018 ушло владельцу с вариантами-таблицей, и он
// увидел поле для текста вместо кнопок (`choice: null`); в тот же день агент, ЗНАЯ про тикет, написал
// интервью 020 с заголовком «## Вопрос Q1 — …», и разбор не увидел вопроса ВООБЩЕ.
//
// АДРЕСНОСТЬ МУТАЦИЙ ОБЪЯВЛЕНА ДО ПРОГОНА:
//   мутант «снять ветку таблицы (RE_OPTION_IN_CELL)»        → краснеет РОВНО G12a;
//   мутант «снять ветку слота ответа»                       → краснеет РОВНО G12b;
//   мутант «убрать порог в две буквы (letters.size < 1)»    → краснеет РОВНО G12c;
//   мутант «снять область statusIsWaiting»                  → краснеет РОВНО G12d;
//   целый код                                               → 0 красных.
// ---------------------------------------------------------------------------------------------

/** Waiting document whose variants are TABLE ROWS — the shipped shape of interview 018. */
function docWithTableVariants({ waiting = true } = {}) {
  return [
    '# Интервью 902 — варианты таблицей',
    '',
    '**Topic:** проверочный документ',
    waiting ? '**Status:** 🔴 ждёт владельца' : '**Status:** ✅ ЗАКРЫТО 2026-08-01 — вариант A',
    '',
    '---',
    '',
    '## Вопрос 1. Чем закрыть развилку?',
    '',
    'Тело вопроса.',
    '',
    '| вариант | что получаем |',
    '|---|---|',
    '| **A** первый | что-то |',
    '| **B** второй | что-то ещё |',
    '',
    '**Ответ:**',
    '',
  ].join(LF);
}

/** Waiting document with an answer slot whose question heading the parser cannot see. */
function docWithUnparsableHeading() {
  return [
    '# Интервью 903 — заголовок, которого разбор не видит',
    '',
    '**Topic:** проверочный документ',
    '**Status:** 🔴 ждёт владельца',
    '',
    '---',
    '',
    '## Вопрос Q1 — считать ли это вопросом?',
    '',
    'Тело вопроса.',
    '',
    '- **A. Первый вариант** — что-то',
    '- **B. Второй вариант** — что-то ещё',
    '',
    '**Ответ:**',
    '',
  ].join(LF);
}

/** Run axis G12 over a directory of fixtures, the same way `npm run questions` does. */
function g12(dir) {
  return checkUnreachableChoices(core.listInterviews(dir), dir).findings;
}

block('G12a', 'варианты ТАБЛИЦЕЙ дают ноль кнопок — и сторож это НАЗЫВАЕТ (bugs/71)', async () => {
  const dir = freshDir('g12a');
  writeFileSync(join(dir, 'interview_902_table.md'), docWithTableVariants(), 'utf8');
  const found = g12(dir);
  must(found.length === 1,
    `ожидалась ровно одна находка, получено ${found.length}: ${tail(JSON.stringify(found), 240)}`);
  must(/разобрано вариантов 0/u.test(found[0].why),
    `находка не про потерянные варианты: ${found[0].why}`);
  must(/A, B/u.test(found[0].why),
    `находка не называет БУКВЫ, которые владелец должен был увидеть: ${found[0].why}`);
});

block('G12b', 'слот ответа есть, а разобранных вопросов НОЛЬ — вопрос исчез бы молча (bugs/71)', async () => {
  const dir = freshDir('g12b');
  writeFileSync(join(dir, 'interview_903_heading.md'), docWithUnparsableHeading(), 'utf8');
  // Сначала — САМ МЕХАНИЗМ: разбор действительно не видит этого заголовка, иначе блок ниже
  // зеленел бы по чужой причине (EXP-0016).
  const parsed = core.listInterviews(dir);
  must(parsed.length === 1 && parsed[0].questions.length === 0,
    `фикстура не воспроизводит дефект: разобрано вопросов ${parsed[0] ? parsed[0].questions.length : '—'}`);
  const found = g12(dir);
  must(found.length === 1, `ожидалась ровно одна находка, получено ${found.length}`);
  must(/разобранных вопросов НОЛЬ/u.test(found[0].why), `находка не та: ${found[0].why}`);
});

block('G12c', 'ОДНА буква в прозе сторожа не поднимает — ложная тревога хуже пропуска (G9)', async () => {
  const dir = freshDir('g12c');
  const doc = [
    '# Интервью 904 — одна буква в прозе',
    '', '**Topic:** проверочный документ', '**Status:** 🔴 ждёт владельца', '', '---', '',
    '## Вопрос 1. Свободный вопрос без вариантов?',
    '', 'Владелец прежде выбрал вариант A, и это ссылка на прошлый ответ, а не список.', '',
    '| поле | значение |', '|---|---|', '| **A** прежний ответ | принят |', '',
    '**Ответ:**', '',
  ].join(LF);
  writeFileSync(join(dir, 'interview_904_prose.md'), doc, 'utf8');
  must(g12(dir).length === 0,
    'сторож поднялся на ОДНОЙ букве в прозе — это ровно тот ложный сигнал, что приучает не смотреть');
});

block('G12d', 'ЗАКРЫТОЕ интервью сторож не трогает — по нему всё равно нельзя действовать', async () => {
  const dir = freshDir('g12d');
  writeFileSync(join(dir, 'interview_905_closed.md'), docWithTableVariants({ waiting: false }), 'utf8');
  must(g12(dir).length === 0,
    'сторож нашёл дефект в ЗАКРЫТОМ интервью: закрытый оригинал не переписывают, значит находка '
    + 'ложная по построению — и в первом прогоне она дала 23 таких на 19 документах');
});

// ---------------------------------------------------------------------------------------------
// 5. Runner
// ---------------------------------------------------------------------------------------------

async function main(argv) {
  // `--only` compares case-insensitively on BOTH sides, and an id that matches nothing is a loud
  // failure. The first version uppercased only the argument, so `--only I4b` silently selected no
  // block and the run exited 0 — a runner that reports success for work it never did is the same
  // class of defect this file was written to hunt.
  const only = (() => {
    const i = argv.indexOf('--only');
    if (i < 0 || !argv[i + 1]) return null;
    return new Set(argv[i + 1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  })();
  if (only) {
    const known = new Set(blocks.map((b) => b.id.toLowerCase()));
    const unknown = [...only].filter((id) => !known.has(id));
    if (unknown.length) {
      console.log(`unknown block id(s): ${unknown.join(', ')}`);
      console.log(`known: ${blocks.map((b) => b.id).join(', ')}`);
      return 1;
    }
  }
  const keep = argv.includes('--keep');

  ROOT = mkdtempSync(join(tmpdir(), 'kago-verify-contour-'));
  const results = [];

  try {
    for (const b of blocks) {
      if (only && !only.has(b.id.toLowerCase())) continue;
      const started = Date.now();
      try {
        await b.fn();
        results.push({ ...b, ok: true, ms: Date.now() - started });
      } catch (e) {
        results.push({ ...b, ok: false, ms: Date.now() - started, why: e && e.message ? e.message : String(e) });
      }
    }
  } finally {
    if (keep) console.log(`fixtures kept in ${ROOT}`);
    else { try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* best effort */ } }
  }

  console.log('');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.what}  (${r.ms} ms)`);
    if (!r.ok) console.log(`      ${r.why}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  console.log(`${results.length} block(s), ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

main(process.argv.slice(2)).then((code) => process.exit(code));
