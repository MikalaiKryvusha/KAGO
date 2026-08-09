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

const HERE = dirname(fileURLToPath(import.meta.url));
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
async function renderOnly(docPath) {
  const out = join(dirname(docPath), 'preview.html');
  const child = spawn(process.execPath, [REVIEW, docPath, '--no-serve', '--no-signal', '--out', out], { windowsHide: true });
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

block('B4', 'the success summary counts what LANDED in the document, not what was posted', async () => {
  const dir = freshDir('b4');
  const docPath = join(dir, 'interview_902_noanswerfield.md');
  writeFileSync(docPath, docWithoutAnswerField(), 'utf8');
  const before = readFileSync(docPath, 'utf8');

  const run = startContour([docPath, '--no-signal', '--no-open']);
  try {
    const url = await run.url;
    const res = await postSave(url, { documents: { interview_902_noanswerfield: { comment: '', noticeRead: false, answers: { Q1: { choice: 'A', text: '', comment: '' } } } } });
    const after = readFileSync(docPath, 'utf8');
    const wrote = after !== before;
    const claimed = /ответов:\s*(\d+)/u.exec(res.json && res.json.summary ? res.json.summary : '');

    must(!(claimed && Number(claimed[1]) > 0 && !wrote),
      `the contour reported "${res.json && res.json.summary}" while the document is byte-for-byte unchanged — a report of a write that did not happen`);
    must(wrote || !(res.json && res.json.ok),
      `nothing was written and the contour still answered ok:true (${res.text})`);
  } finally {
    run.kill();
    await run.exit;
  }
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
