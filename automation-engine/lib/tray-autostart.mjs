// automation-engine/lib/tray-autostart.mjs — THE TRAY'S AUTOSTART CONTRACT, and the only module that
// owns it. Disk and Task Scheduler only; no GPU, ever (plans/10 §4.4).
//
// WHAT THE OWNER ASKED FOR (GOAL.md → «Импрувменты оболочки (2026-08-14)», his words):
//   «есть пункт, закрыть KAGO нотификацию в трее. Если режим по ярлыку не переключают — в трее KAGO
//    больше не будет показываться, пока опять режим не переключат по ярлыку — опять ставится в трее
//    в автозагрузку.»
// So the tray's presence has TWO gates and they belong to different processes:
//   · TAKE IT AWAY — the tray itself, on the owner's Exit click (unelevated, `tray.ps1`);
//   · PUT IT BACK  — the applier's CLI, on any `--apply` / `--reset` (elevated, through the task).
// This module is the second gate, plus the shared vocabulary the first one needs.
//
// WHY POWERSHELL CMDLETS AND NOT `schtasks` (a departure from the plan's letter, and it is measured):
// `schtasks /Query` prints LOCALIZED text — on this machine «Состояние: Готово» — and the dossier
// already records the class (`AGENT_GUIDE.md`: a guard matching a localized message works in one
// language only). `Get-ScheduledTask` returns an OBJECT whose `State` is a locale-independent enum,
// and `setup-desktop.mjs` already reads tasks exactly this way — one method, not two.
//
// THE SENTINEL, AND WHY IT IS A FALLBACK RATHER THAN THE MECHANISM. The tray runs UNELEVATED
// (`researches/07` §2), so «disable your own scheduled task» is a privilege question. Measured
// 2026-08-23 by reading the ACL of `C:\Windows\System32\Tasks\KAGO\tray`: the owner's own account
// holds **FullControl**, so a filtered token should be allowed — but «should» is an inference, and
// the observation only arrives when the owner clicks Exit on his machine. Therefore the tray
// DISABLES and then READS BACK; only a read-back that fails to say `Disabled` writes the sentinel
// file, and `tray-launcher.js` treats it as «do not raise the tray». One mechanism in the normal
// case, a named fallback in the case nobody has observed yet.
//
// [NOT-TESTED] on the live shell — `--selftest` covers the decisions offline through the injected
// runner seam; the live proof is the owner's Exit click and the next mode apply after it.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SHELL_RUNS_DIR, localIso } from './remembered-state.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The task, split exactly the way `Get-ScheduledTask` wants it (and `setup-desktop.mjs` writes it). */
export const TRAY_TASK_PATH = '\\KAGO\\';
export const TRAY_TASK_NAME = 'tray';
export const TRAY_TASK_FULL = `${TRAY_TASK_PATH}${TRAY_TASK_NAME}`;

/**
 * The fallback marker. THREE files name this path — this module, `tray.ps1` (writes it) and
 * `tray-launcher.js` (reads it) — because they are three languages that cannot import one another.
 * That is a truth↔mirror triple, so it gets what the registry demands: a block that greps the other
 * two files for this exact relative path (`--selftest`, block «путь метки назван одинаково»).
 */
export const TRAY_SUPPRESSED_RELATIVE = 'runs/shell/tray.disabled';
export const TRAY_SUPPRESSED_PATH = path.join(SHELL_RUNS_DIR, 'tray.disabled');

/** Run one PowerShell line and hand back its three facts. The seam every function takes, so the
 *  suite can drive the decisions without a Task Scheduler (EXP-0108: a suite that reaches only the
 *  judge guards the question, not the answer). */
export function psRun(script) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

const q = (s) => `'${String(s).replace(/'/gu, "''")}'`;

/** The task's state as the scheduler reports it: `Ready` · `Disabled` · `Running`, or null when the
 *  task is not registered at all. A missing task is an ANSWER here, never an exception. */
export function readTrayTaskState({ run = psRun } = {}) {
  const r = run(`(Get-ScheduledTask -TaskPath ${q(TRAY_TASK_PATH)} -TaskName ${q(TRAY_TASK_NAME)} -ErrorAction Stop).State`);
  if (!r.ok) return null;
  const s = r.stdout.split(/\r?\n/u).map((l) => l.trim()).filter(Boolean).pop() ?? '';
  return s || null;
}

/** Is the tray currently suppressed by the fallback marker? */
export function traySuppressed(sentinelPath = TRAY_SUPPRESSED_PATH) {
  return existsSync(sentinelPath);
}

/** Write the marker. Its CONTENT is for the human who finds the file — the machinery only asks
 *  whether it exists. */
export function writeTraySentinel(sentinelPath = TRAY_SUPPRESSED_PATH, why = 'значок KAGO закрыт владельцем через Exit') {
  mkdirSync(path.dirname(sentinelPath), { recursive: true });
  writeFileSync(sentinelPath, `${why}\nПоставлено: ${localIso()}\nСнимается автоматически при любом применении режима (ярлык или меню трея).\n`, 'utf8');
}

/**
 * PUT THE TRAY BACK — the owner's «опять переключат режим по ярлыку → опять ставится в автозагрузку».
 *
 * Three actions, and every one of them is idempotent on purpose: the applier calls this on EVERY
 * apply, and the overwhelmingly common case is «nothing was disabled, nothing to do».
 *   1. remove the fallback marker if it is there;
 *   2. enable the task (a no-op when it is already enabled);
 *   3. start it — the tray's own mutex makes a second instance exit silently, so «already running»
 *      costs one short process and nothing else.
 *
 * Never throws: a shell whose scheduled tasks are not installed must not take the applier down
 * AFTER a successful write to the card.
 */
export function ensureTrayAutostart({ run = psRun, sentinelPath = TRAY_SUPPRESSED_PATH, start = true } = {}) {
  let sentinelRemoved = false;
  try {
    if (existsSync(sentinelPath)) { unlinkSync(sentinelPath); sentinelRemoved = true; }
  } catch (e) {
    return { ok: false, state: null, sentinelRemoved: false, detail: `метка ${sentinelPath} не удаляется: ${e.message}` };
  }

  const before = readTrayTaskState({ run });
  if (before === null) {
    return { ok: false, state: null, sentinelRemoved, detail: `задача ${TRAY_TASK_FULL} не зарегистрирована — npm run setup -- --install` };
  }

  const en = run(`Enable-ScheduledTask -TaskPath ${q(TRAY_TASK_PATH)} -TaskName ${q(TRAY_TASK_NAME)} -ErrorAction Stop | Out-Null`);
  if (!en.ok) {
    return { ok: false, state: before, sentinelRemoved, detail: `задача ${TRAY_TASK_FULL} не включается: ${en.stderr || en.stdout}` };
  }
  if (start) run(`Start-ScheduledTask -TaskPath ${q(TRAY_TASK_PATH)} -TaskName ${q(TRAY_TASK_NAME)} -ErrorAction SilentlyContinue`);

  const after = readTrayTaskState({ run });
  const ok = after !== null && after !== 'Disabled';
  return {
    ok,
    state: after,
    sentinelRemoved,
    detail: ok
      ? `задача ${TRAY_TASK_FULL} включена (состояние ${after})${sentinelRemoved ? ', метка снята' : ''}`
      : `задача ${TRAY_TASK_FULL} перечитана как ${after ?? 'отсутствует'} — трей на входе не поднимется`,
  };
}

/** One line for the applier's console. The owner reads this, so it is Russian and says what IS,
 *  never what was attempted. */
export function describeEnsure(result) {
  return result.ok ? `OK   ${result.detail}` : `⚠️  ${result.detail}`;
}

// ================================================================================================
// Self-test — the decisions on an injected runner and a sandbox marker. No Task Scheduler, no GPU.
// ================================================================================================

function runSelfTest() {
  const blocks = [];
  const add = (name, ok, note = '') => blocks.push({ name, ok, note });
  const sandbox = mkdtempSync(path.join(process.env.TEMP || '/tmp', 'kago-tray-autostart-'));
  const sentinel = path.join(sandbox, 'tray.disabled');

  // A scripted scheduler: every call is recorded, and the answers are whatever the case needs.
  const fakeRun = (answers) => {
    const calls = [];
    const fn = (script) => {
      calls.push(script);
      for (const [needle, reply] of answers) if (script.includes(needle)) return reply;
      return { ok: true, stdout: '', stderr: '' };
    };
    fn.calls = calls;
    return fn;
  };
  const READY = { ok: true, stdout: 'Ready', stderr: '' };
  const DISABLED = { ok: true, stdout: 'Disabled', stderr: '' };
  const MISSING = { ok: false, stdout: '', stderr: 'ScheduledTask not found' };

  try {
    // 1 — the state read is the scheduler's own word, not parsed prose
    const run1 = fakeRun([['Get-ScheduledTask', READY]]);
    add('состояние задачи читается объектом: Ready', readTrayTaskState({ run: run1 }) === 'Ready');

    // 2 — a task that is not registered is an ANSWER (null), never an exception
    const run2 = fakeRun([['Get-ScheduledTask', MISSING]]);
    add('незарегистрированная задача — это ответ null, а не исключение', readTrayTaskState({ run: run2 }) === null);

    // 3 — the ensure path enables and starts, in that order, and reports the read-back state
    const run3 = fakeRun([['Get-ScheduledTask', READY]]);
    const r3 = ensureTrayAutostart({ run: run3, sentinelPath: sentinel });
    const order = run3.calls.findIndex((c) => c.includes('Enable-ScheduledTask')) < run3.calls.findIndex((c) => c.includes('Start-ScheduledTask'));
    add('возврат в автозагрузку: сперва Enable, потом Start, состояние перечитано', r3.ok && r3.state === 'Ready' && order, `состояние ${r3.state}`);

    // 4 — the marker is REMOVED by the ensure path: this is the owner's «переключил режим — трей вернулся»
    writeTraySentinel(sentinel, 'проверочная метка');
    const run4 = fakeRun([['Get-ScheduledTask', READY]]);
    const r4 = ensureTrayAutostart({ run: run4, sentinelPath: sentinel });
    add('метка подавления снимается применением режима', r4.ok && r4.sentinelRemoved && !existsSync(sentinel));

    // 5 — a missing task never throws and never claims success (the shell may not be installed)
    const run5 = fakeRun([['Get-ScheduledTask', MISSING]]);
    const r5 = ensureTrayAutostart({ run: run5, sentinelPath: sentinel });
    add('задачи нет — ok:false и внятная причина, без исключения', r5.ok === false && /не зарегистрирована/u.test(r5.detail));

    // 6 — a task that reads back DISABLED after Enable is NOT reported as success
    const run6 = fakeRun([['Get-ScheduledTask', DISABLED], ['Enable-ScheduledTask', { ok: true, stdout: '', stderr: '' }]]);
    const r6 = ensureTrayAutostart({ run: run6, sentinelPath: sentinel });
    add('перечитанное Disabled не выдаётся за успех', r6.ok === false && /Disabled/u.test(r6.detail));

    // 7 — Enable that fails is reported, and the run does not go on to claim a state
    const run7 = fakeRun([['Get-ScheduledTask', READY], ['Enable-ScheduledTask', { ok: false, stdout: '', stderr: 'Access is denied' }]]);
    const r7 = ensureTrayAutostart({ run: run7, sentinelPath: sentinel });
    add('отказ Enable назван вслух, успех не заявляется', r7.ok === false && /не включается/u.test(r7.detail));

    // 8 — the sentinel's content is for a human and carries a stamp; existence is what the code asks
    writeTraySentinel(sentinel);
    const body = readFileSync(sentinel, 'utf8');
    add('метка написана для человека и со штампом', traySuppressed(sentinel) && /Exit/u.test(body) && /Поставлено: \d{4}-\d{2}-\d{2}T/u.test(body));

    // THE BLOCK THAT IS DELIBERATELY ABSENT, AND WHY IT IS NAMED HERE INSTEAD OF WRITTEN.
    // The marker's path will be named by THREE languages that cannot import one another — this
    // module, `tray.ps1` (the writer) and `tray-launcher.js` (the reader) — i.e. a truth↔mirror
    // triple that the registry says must be WATCHED by a block. That block belongs WITH its
    // writer: today nothing writes the marker (the Exit item of `plans/10` §4.5 is not built yet),
    // so a guard here would be watching a pair that does not exist and would sit red for a reason
    // that is not a defect. It is born with the first writer — `plans/10` §4.4 carries the
    // obligation by name, and the pairs registry gets its row the same hour.
  } finally {
    try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* a sandbox that will not go is not a verdict */ }
  }

  let fails = 0;
  for (const b of blocks) {
    if (b.ok) console.log(`OK     блок — ${b.name}${b.note ? ` · ${b.note}` : ''}`);
    else { fails++; console.log(`ПРОВАЛ блок — ${b.name}${b.note ? ` · ${b.note}` : ''}`); }
  }
  console.log(`САМОПРОВЕРКА АВТОЗАГРУЗКИ ТРЕЯ: ${blocks.length - fails} из ${blocks.length} блоков зелёные.`);
  return fails === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) process.exit(runSelfTest());
  if (process.argv.includes('--ensure')) {
    const r = ensureTrayAutostart();
    console.log(describeEnsure(r));
    process.exit(r.ok ? 0 : 1);
  }
  console.error('Команды: --selftest · --ensure');
  process.exit(2);
}
