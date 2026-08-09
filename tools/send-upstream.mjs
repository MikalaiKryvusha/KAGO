#!/usr/bin/env node
// tools/send-upstream.mjs — the send gate's one REAL consumer.
//
// WHY THIS EXISTS. KAGO's real outbound artifact is a KAIF ticket filed upstream to
// github.com/MikalaiKryvusha/KAIF under the OWNER's account with the gh CLI. One was filed
// tonight on the owner's spoken word in chat. This tool is what makes that word MECHANICAL
// instead of remembered: without a real addressee the gate is decoration (C7), and a gate that
// nothing calls protects nothing.
//
// THE ONE RULE THAT SHAPES THE WHOLE FILE (I4): --apply is not an override. It is the answer to
// "am I allowed to press the button", never to "may these bytes leave". checkApproval() runs
// FIRST and its refusal is final — missing decision, rejected decision, drifted text, anything
// unexpected — and in every one of those cases `gh` is never reached at all. The gate is not
// consulted after the send is prepared; it is what decides whether preparation happens.
//
// Usage:  node tools/send-upstream.mjs <document.md> <artifactId> [--apply]
//   without --apply : DRY RUN — prints what would be sent, where, and the gate's verdict
//   with    --apply : gate → gh issue create → the issue URL is written back into the decision
// Exit:   0 = done (or a clean approved dry run) · 1 = refused / failed. Output is Russian: the
//         owner reads this console.
//
// TEXT HYGIENE. The body travels as a FILE (`--body-file`) and never as an argument — the bodies
// are Russian and a command line is the wrong pipe for non-ASCII text. The title has no file
// channel in `gh` (there is no `--title-file`), so it does go as an argument; the mitigation is
// that the call is spawned with an argv ARRAY and `shell: false`, so the string reaches
// CreateProcessW as UTF-16 without a console-codepage round trip. No shell is ever involved.
//
// [NOT-TESTED] — no committed verification run covers this module yet. Observed in a throwaway
// scratch check: under --apply with no decision it printed the refusal, exited 1, and the
// injected process runner was never called (also confirmed black-box with gh removed from PATH —
// the refusal, not an ENOENT, is what printed).

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { decisionPaths, isoLocal, normalize } from './lib/review-core.mjs';
import { checkApproval, parseMetaBlock } from './review-gate.mjs';

// A hard deadline on the child (C9 in spirit): every call this tool makes must terminate, so a
// hung network call can never turn a send into a process that waits forever.
const GH_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------------------------
// 1. Reading the addressee out of the metadata block
// ---------------------------------------------------------------------------------------------

/**
 * Extract `owner/repo` from an artifact's `target`. The name contract keeps `target` human
 * ("Slack · #channel", "github.com/Owner/Repo"), so the sender must recognise its OWN addressee
 * and refuse everything else: a target this sender cannot read is a target it must not guess at.
 *
 * ASCII-only classes are correct here — GitHub slugs are ASCII by definition. (Rake 7 governs
 * regexes that match the owner's language; this one matches a repository slug.)
 */
export function repoFromTarget(target) {
  const t = String(target ?? '').trim();
  if (!t) return null;

  // A target that carries a HOST must carry github.com. Without this line the pattern below, being
  // unanchored, happily produced `gitlab.com/acme` from a GitLab URL and `docs.google.com/document`
  // from a Google Docs link — a guard that cannot fail, handing the sender a fabricated addressee
  // (`bugs/01` → C7). An unknown host is refused, never re-hosted.
  const host = t.match(/^(?:https?:\/\/)?(?:www\.)?([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})[/:]/);
  if (host && !/^github\.com$/i.test(host[1])) return null;

  // ANCHORED AT BOTH ENDS. "github.com/Owner/Repo" and "Owner/Repo" land here; anything with more
  // path segments (an issue link, a file link) is not a repository root and is refused rather than
  // trimmed into one — which is what the previous wording promised and the previous regex did not do.
  const m = t.match(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com[/:])?([A-Za-z0-9][A-Za-z0-9._-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*?)(?:\.git)?\/?$/);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

/**
 * The issue title. Precedence, most explicit first:
 *   1. the artifact's own `title` in the metadata block — the owner wrote it deliberately;
 *   2. the body's first `# ` heading — what the reader of the body will see anyway;
 *   3. the document title.
 * A title is REQUIRED by `gh issue create`, so having none is a refusal, not a placeholder.
 */
export function titleFor(artifact, meta, bodyText) {
  if (artifact && artifact.title) return String(artifact.title).trim();
  const h1 = normalize(bodyText).split('\n').find((l) => /^#\s+\S/.test(l));
  if (h1) return h1.replace(/^#\s+/, '').trim();
  if (meta && meta.title) return String(meta.title).trim();
  return null;
}

// ---------------------------------------------------------------------------------------------
// 2. The process runner
// ---------------------------------------------------------------------------------------------

/**
 * The real launcher. `shell: false` (the default) is load-bearing twice: it keeps the Russian
 * title out of a console codepage, and it means no part of any argument is ever interpreted by a
 * shell. On Windows CreateProcessW resolves the bare name `gh` to `gh.exe` through PATH.
 */
function defaultRun(command, args) {
  return spawnSync(command, args, { encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true });
}

// Display-only quoting for the echoed command. It never builds the real call — the real call is
// an argv array — so this cannot become an injection path.
const q = (s) => (/[\s"'`$&|<>()]/.test(String(s)) ? `"${String(s).replace(/"/gu, '\\"')}"` : String(s));

// ---------------------------------------------------------------------------------------------
// 3. The send
// ---------------------------------------------------------------------------------------------

/**
 * @param {string} documentPath
 * @param {string} artifactId
 * @param {{apply?:boolean, run?:Function, now?:Date}} opts
 *   `run` is injectable ONLY so a self-check can prove that a refusal never reaches `gh`. The
 *   GATE is not injectable: checkApproval() below is called unconditionally, by name, every time.
 * @returns {{code:number, ok:boolean, called:boolean, url:string|null, verdict:object}}
 */
export function sendUpstream(documentPath, artifactId, { apply = false, run = defaultRun, now = new Date() } = {}) {
  const docPath = resolve(String(documentPath ?? ''));     // T10 — resolve, never join
  const id = String(artifactId ?? '');
  let called = false;

  // The verdict comes first and is the same function the standalone gate CLI runs (C7).
  const verdict = checkApproval(docPath, id);

  // Display data is read separately from the verdict so a REFUSED dry run still shows the owner
  // what he is refusing to send. Reading twice is not a second truth — parseMetaBlock is the
  // same reader the gate used.
  const meta = existsSync(docPath) ? parseMetaBlock(readFileSync(docPath, 'utf8')) : { artifacts: [], title: null };
  const artifact = meta.artifacts.find((a) => a.id === id) || null;
  const bodyPath = artifact && artifact.body_file ? resolve(dirname(docPath), artifact.body_file) : null;
  const bodyExists = Boolean(bodyPath && existsSync(bodyPath) && statSync(bodyPath).isFile());
  const bodyText = bodyExists ? readFileSync(bodyPath, 'utf8') : '';
  const repo = artifact ? repoFromTarget(artifact.target) : null;
  const title = artifact ? titleFor(artifact, meta, bodyText) : null;

  console.log(apply ? 'ОТПРАВКА НАВЕРХ' : 'СУХОЙ ПРОГОН — ничего не отправляется (нет --apply)');
  console.log(`  документ:   ${docPath}`);
  console.log(`  артефакт:   ${id}${artifact ? '' : '  (в документе не объявлен)'}`);
  console.log(`  куда:       ${artifact ? (artifact.target || 'не указано') : '—'}${repo ? `  ->  репозиторий ${repo}` : ''}`);
  console.log(`  формат:     ${artifact ? (artifact.format || 'не указан') : '—'}`);
  console.log(`  заголовок:  ${title || 'нет заголовка'}`);
  if (bodyExists) {
    const bytes = readFileSync(bodyPath).length;
    const lines = normalize(bodyText).split('\n').length - 1;
    console.log(`  тело:       ${bodyPath}  (${bytes} байт, ${lines} строк)`);
  } else {
    console.log(`  тело:       ${bodyPath ? `${bodyPath}  (файла нет)` : 'файл тела не указан'}`);
  }

  if (!verdict.ok) {
    // I4 — the refusal is the end of the road in BOTH modes. Nothing below this line runs, and
    // `gh` is not reached even with --apply on the command line.
    console.error(`  вердикт гейта: ОТКАЗ — ${verdict.reason}`);
    console.error(apply
      ? '  ОТПРАВКА ОТМЕНЕНА. Явный --apply не отменяет гейт: одобрение владельца — единственный пропуск.'
      : '  В таком состоянии --apply тоже откажет.');
    return { code: 1, ok: false, called, url: null, verdict };
  }

  console.log(`  вердикт гейта: ОДОБРЕНО — ${verdict.reason}`);
  console.log(`  sha-256:    ${verdict.actual}`);

  // Below here the OWNER has approved these exact bytes. What remains are the sender's own
  // preconditions — its addressee must be one it can actually reach, and it must not file twice.
  const entry = verdict.decision.artifacts[id];
  // The guard binds to the PRESENCE of a delivery, not to its url — this same file writes
  // `url: null` whenever gh's stdout carries no address, and the old guard then did not see its own
  // record and filed the ticket a second time (`bugs/01` → C9).
  if (entry.delivered) {
    console.error(`  ОТКАЗ: артефакт уже отправлен — ${entry.delivered.url || `отметка от ${entry.delivered.at || 'без времени'}, адрес gh не вернул`}`);
    console.error('  Повторный запуск создал бы вторую задачу. Если отправка нужна снова — уберите поле delivered из решения.');
    return { code: 1, ok: false, called, url: null, verdict };
  }
  if (!repo) {
    console.error(`  ОТКАЗ: адресат «${artifact.target ?? ''}» не читается как репозиторий GitHub (нужно owner/repo).`);
    return { code: 1, ok: false, called, url: null, verdict };
  }
  // An UNDECLARED format is not a licence. The check used to be skipped entirely when `format` was
  // absent — and `format` is optional, so half the addressee defence was disabled by omission
  // (`bugs/01` → C8). Fail-closed (I4): say what to write instead of guessing what was meant.
  if (!artifact.format) {
    console.error(`  ОТКАЗ: у артефакта «${id}» не объявлен format. Этот отправитель умеет только задачи GitHub — впишите «format: issue».`);
    return { code: 1, ok: false, called, url: null, verdict };
  }
  if (!/issue|markdown|(^|[^a-z])md([^a-z]|$)/i.test(artifact.format)) {
    console.error(`  ОТКАЗ: этот отправитель умеет только задачи GitHub, а формат артефакта — «${artifact.format}».`);
    return { code: 1, ok: false, called, url: null, verdict };
  }
  if (!title) {
    console.error('  ОТКАЗ: у артефакта нет заголовка — ни в метаданных, ни первым заголовком тела.');
    return { code: 1, ok: false, called, url: null, verdict };
  }

  const args = ['issue', 'create', '--repo', repo, '--title', title, '--body-file', verdict.bodyPath];
  console.log('');
  console.log(apply ? '  Выполняется команда:' : '  Была бы выполнена команда:');
  console.log(`    gh ${args.map(q).join(' ')}`);

  if (!apply) {
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7F]/.test(title)) {
      console.log('  Примечание: в заголовке есть не-ASCII. Он уходит аргументом (у gh нет --title-file),');
      console.log('  но вызов идёт массивом argv без shell, поэтому кодировка консоли на него не влияет.');
    }
    console.log('');
    console.log('  Первые строки тела (ровно те байты, что уйдут):');
    for (const line of normalize(bodyText).split('\n').slice(0, 12)) console.log(`    | ${line}`);
    console.log('');
    console.log('  Ничего не отправлено. Для настоящей отправки добавьте --apply.');
    return { code: 0, ok: true, called, url: null, verdict };
  }

  called = true;
  const r = run('gh', args);
  if (r && r.error && r.error.code === 'ENOENT') {
    console.error('  ОТКАЗ: не найден gh CLI. Установите GitHub CLI и выполните gh auth login.');
    return { code: 1, ok: false, called, url: null, verdict };
  }
  if (!r || r.status !== 0) {
    console.error(`  ОШИБКА: gh завершился с кодом ${r ? r.status : 'неизвестно'}.`);
    if (r && r.stderr) console.error(`  ${String(r.stderr).trim()}`);
    console.error('  Решение не тронуто: доставки не было.');
    return { code: 1, ok: false, called, url: null, verdict };
  }

  const url = (String(r.stdout || '').match(/https?:\/\/\S+/u) || [null])[0];
  console.log(`  ГОТОВО: задача создана — ${url || String(r.stdout || '').trim()}`);

  const at = isoLocal(now);
  const written = recordDelivery(docPath, verdict.decision, id, {
    url: url || null, at, repo, title, by: 'tools/send-upstream.mjs',
  });
  console.log(`  Отметка о доставке записана: ${written.decision}`);
  console.log(`  Копия в архиве:              ${written.archive}`);
  return { code: 0, ok: true, called, url, verdict };
}

/**
 * Write the delivery back into the decision record.
 *
 * `status` stays the OWNER's verdict ("approved") — delivery is a fact about US, not a decision
 * he made, and overwriting his word with our bookkeeping would make the archive unreadable.
 *
 * The core's writeDecision() is deliberately NOT used here: it archives under `record.at`, which
 * is the owner's decision time, so calling it would rewrite the archive copy taken at approval —
 * and archive copies are never overwritten (I2, C6). The delivery gets its own stamp instead.
 * Only the two writeFileSync calls are local; every NAME still comes from the core's
 * decisionPaths(), so the naming rule keeps living in exactly one place (C1).
 */
function recordDelivery(docPath, record, artifactId, delivered) {
  const p = decisionPaths(docPath);
  record.artifacts[artifactId].delivered = delivered;
  const body = JSON.stringify(record, null, 2) + '\n';
  mkdirSync(p.archiveDir, { recursive: true });
  writeFileSync(p.decision, body, 'utf8');
  const archive = p.archiveFor(delivered.at);
  writeFileSync(archive, body, 'utf8');
  return { decision: p.decision, archive };
}

// ---------------------------------------------------------------------------------------------
// 4. CLI
// ---------------------------------------------------------------------------------------------

function main(argv) {
  // --no-serve is accepted and ignored: this tool holds no server, and a caller that passes the
  // flag uniformly to every tool of the contour must not be punished for it (C9).
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.filter((a) => !a.startsWith('--'));

  if (positional.length < 2 || flags.has('--help')) {
    console.log('Использование: node tools/send-upstream.mjs <документ.md> <идентификатор артефакта> [--apply]');
    console.log('  без --apply — сухой прогон: что и куда ушло бы, плюс вердикт гейта;');
    console.log('  с  --apply — настоящая отправка, но только если гейт одобрил.');
    return 1;
  }
  return sendUpstream(positional[0], positional[1], { apply: flags.has('--apply') }).code;
}

// T9 — importing this module must not run the CLI.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
