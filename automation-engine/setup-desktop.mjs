#!/usr/bin/env node
// automation-engine/setup-desktop.mjs — THE OWNER-FACING SURFACE: four Desktop shortcuts, the
// elevated apply tasks, and the receipt that makes every created artifact deletable.
// Phase 3 step 4.3 (plans/06_epic01_phase3_shell.md §4.3).
//
// THE SHAPE (researches/03 §3.6): a shortcut never elevates and never carries a free-form command.
// Each mode has a PRE-REGISTERED Task Scheduler task running THE ONE WRITER (profile-manager.mjs,
// rule R1) elevated, with the profile name FIXED at registration; the `.lnk` merely says
// `schtasks /run /tn "KAGO\apply-<mode>"`. The elevation decision is made once, here, with the
// owner's-machine rule walked out loud — not on every double-click, and never with parameters
// flowing from the shortcut into the command.
//
// EVERYTHING CREATED OUTSIDE THE REPO IS LISTED IN THE RECEIPT **BEFORE IT IS CREATED**
// (runs/shell/created-artifacts.json): each artifact with the exact command that deletes it.
// `--uninstall` executes that receipt; a receipt nobody can execute is a hope, not a rollback.
//
// [TESTED: 2026-08-14 09:2x · live install after the owner granted `npm run setup*`. `--install`
//  created 5 tasks + 4 shortcuts, receipt written BEFORE creation, everything re-read. The §4.3
//  proofs ran through the TASK PATH (the same path the owner's clicks take): apply-test-pl250 →
//  card read back 250.00 W twice · apply-factory FROM that non-factory state → 300.00 W twice
//  (P3-AC5) · apply-optimised (draft) → task exit 1, gpu-info --json diff shows zero settable
//  changes (only volatile clock/pstate moved). Card left factory.]
//
// [TESTED: 2026-08-14 09:4x · §4.4 live: \KAGO\boot-apply registered with the logon trigger and
//  read back as MSFT_TaskLogonTrigger · manual `schtasks /run` proved the boot path end-to-end
//  (remembered test-pl250 re-applied → 250.00 W; remembered factory → zero writes). The real logon
//  series (P3-AC2, 5 natural logons) collects itself from the owner's reboots via the journal.]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { PROFILES_DIR, loadProfileFile, requiresQualification } from './lib/profile-store.mjs';
import { createShortcut, readShortcut, removeShortcut, desktopDir } from './lib/desktop-shortcuts.mjs';
import { localIso } from './lib/remembered-state.mjs';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const PROFILE_MANAGER = fileURLToPath(new URL('./lib/profile-manager.mjs', import.meta.url));
const RECEIPT_PATH = path.join(REPO_ROOT, 'runs', 'shell', 'created-artifacts.json');
const TASK_FOLDER = '\\KAGO\\';
const SCHTASKS = 'C:\\Windows\\System32\\schtasks.exe';

/**
 * The surface contract: which profiles get an elevated task, and which of those get a shortcut.
 * The test profile has a TASK (the plan's «apply the TEST profile via its path» goes through the
 * same schtasks route as a real click) but NO shortcut — it is not a mode, and the owner's Desktop
 * carries exactly the four modes he named.
 */
const SURFACE = Object.freeze([
  { profile: 'max-performance', shortcut: true },
  { profile: 'optimised', shortcut: true },
  { profile: 'silent-cold', shortcut: true },
  { profile: 'factory', shortcut: true },
  { profile: 'test-pl250', shortcut: false },
]);

const taskName = (profileName) => `apply-${profileName}`;
const fullTaskName = (profileName) => `${TASK_FOLDER}${taskName(profileName)}`;

/** §4.4: the logon task — re-applies the remembered state through the SAME applier and its gates.
 *  A stale or draft remembered state degrades to factory plus a journal line, never a blind write. */
const BOOT_TASK = 'boot-apply';
const BOOT_TASK_ARGS = `"${PROFILE_MANAGER}" --boot-apply`;

/** §4.5: the tray task — UNELEVATED on purpose (researches/07 §2: the tray reads one JSON file and
 *  must never hold elevation; an elevated parent cannot cleanly spawn a de-elevated child, so the
 *  tray gets its OWN logon task with RunLevel Limited instead of riding boot-apply). wscript runs
 *  the launcher, the launcher starts powershell HIDDEN (PowerShell#3028 — the console flash cure). */
const TRAY_TASK = 'tray';
const WSCRIPT = 'C:\\Windows\\System32\\wscript.exe';
const TRAY_LAUNCHER = fileURLToPath(new URL('./tray-launcher.js', import.meta.url));
// //E:JScript pins the engine so the machine's .js association (which a dev tool can rewrite)
// never decides what wscript does with our file; //B suppresses script-error dialogs.
const TRAY_TASK_ARGS = `//B //E:JScript "${TRAY_LAUNCHER}"`;
const TRAY_PID_PATH = path.join(REPO_ROOT, 'runs', 'shell', 'tray.pid');

function psq(s) { return `'${String(s).replace(/'/gu, "''")}'`; }

function ps(script) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  return { ok: !r.error && r.status === 0, status: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

/** Load a surface profile and refuse a FORMAT-invalid file. A draft is format-valid on purpose:
 *  its shortcut must exist and its click must refuse in the APPLIER, not fail to be created. */
function loadSurfaceProfiles() {
  const out = [];
  for (const s of SURFACE) {
    const file = path.join(PROFILES_DIR, `${s.profile}.json`);
    const { profile, refusals } = loadProfileFile(file);
    if (refusals.length) {
      throw new Error(`профиль «${s.profile}» не в форме — оболочка не ставится поверх кривого файла:\n`
        + refusals.map((r) => `    ${r.field}: ${r.why}`).join('\n'));
    }
    out.push({ ...s, title: profile.title, draft: requiresQualification(profile) && profile.qualified !== true });
  }
  return out;
}

// ===============================================================================================
// Receipt — written BEFORE creation, executed by --uninstall
// ===============================================================================================

function buildReceipt(surface, desktop) {
  return {
    what: 'Всё, что setup-desktop создаёт ВНЕ репозитория, и команда удаления каждого артефакта.',
    writtenAt: localIso(),
    rollbackAll: 'npm run setup -- --uninstall',
    artifacts: [
      ...surface.map((s) => ({
        kind: 'scheduled-task',
        name: fullTaskName(s.profile),
        delete: `schtasks /Delete /TN "${fullTaskName(s.profile)}" /F`,
      })),
      {
        kind: 'scheduled-task',
        name: `${TASK_FOLDER}${BOOT_TASK}`,
        delete: `schtasks /Delete /TN "${TASK_FOLDER}${BOOT_TASK}" /F`,
      },
      {
        kind: 'scheduled-task',
        name: `${TASK_FOLDER}${TRAY_TASK}`,
        delete: `schtasks /Delete /TN "${TASK_FOLDER}${TRAY_TASK}" /F`,
      },
      ...surface.filter((s) => s.shortcut).map((s) => ({
        kind: 'desktop-shortcut',
        path: path.join(desktop, `${s.title}.lnk`),
        delete: `Remove-Item -LiteralPath "${path.join(desktop, `${s.title}.lnk`)}"`,
      })),
    ],
  };
}

function writeReceipt(receipt) {
  mkdirSync(path.dirname(RECEIPT_PATH), { recursive: true });
  writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2) + '\n');
}

// ===============================================================================================
// Tasks
// ===============================================================================================

/**
 * Register (or overwrite) one task by its RAW name. Interactive-only, current user, fixed args,
 * never stores credentials. The apply/boot tasks run `RunLevel Highest` — that elevation is the
 * whole point (researches/03 §3.6); the tray runs `Limited` (researches/07 §2). With `logonTrigger`
 * the task additionally fires at THIS user's logon. `timeLimitMinutes: 0` = no execution time
 * limit — the tray lives the whole session, and the default 5-minute cap would kill it.
 */
function registerTask(rawName, args, {
  logonTrigger = false, execute = process.execPath, runLevel = 'Highest', timeLimitMinutes = 5,
} = {}) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$action = New-ScheduledTaskAction -Execute ${psq(execute)} -Argument ${psq(args)} -WorkingDirectory ${psq(REPO_ROOT)}`,
    `$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel ${runLevel}`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes ${Number(timeLimitMinutes)})`,
    ...(logonTrigger
      ? [`$trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)`]
      : []),
    `Register-ScheduledTask -TaskName ${psq(rawName)} -TaskPath ${psq(TASK_FOLDER)} -Action $action -Principal $principal -Settings $settings${logonTrigger ? ' -Trigger $trigger' : ''} -Force | Out-Null`,
  ].join('; ');
  const r = ps(script);
  if (!r.ok) throw new Error(`задача ${TASK_FOLDER}${rawName} не зарегистрирована: ${r.stderr || r.stdout}`);
}

/** The tray process, if it is actually alive: pid file + a live powershell process behind it.
 *  A stale pid file (hard kill never removes it) is reported as absent, not as a ghost. */
function trayProcess() {
  if (!existsSync(TRAY_PID_PATH)) return null;
  const pid = Number(readFileSync(TRAY_PID_PATH, 'utf8').trim());
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const r = ps(`(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).ProcessName`);
  return r.ok && r.stdout === 'powershell' ? pid : null;
}

/** Stop the tray for uninstall: by pid, verified gone. Best-effort — a tray that is not running
 *  is already the goal state. */
function stopTray() {
  const pid = trayProcess();
  if (!pid) return { stopped: false, why: 'трей не запущен (pid-файла нет или процесс мёртв)' };
  const r = ps(`Stop-Process -Id ${pid} -Force -ErrorAction Stop`);
  if (!r.ok) return { stopped: false, why: `Stop-Process: ${r.stderr || r.stdout}` };
  return { stopped: true, pid };
}

/** Read a task back by its RAW name: exists, what it runs, and its trigger class (if any). The
 *  registration is not the evidence. */
function readTask(rawName) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$t = Get-ScheduledTask -TaskName ${psq(rawName)} -TaskPath ${psq(TASK_FOLDER)}`,
    `@{ execute = $t.Actions[0].Execute; args = $t.Actions[0].Arguments; runLevel = [string]$t.Principal.RunLevel; trigger = if ($t.Triggers) { $t.Triggers[0].CimClass.CimClassName } else { $null } } | ConvertTo-Json -Compress`,
  ].join('; ');
  const r = ps(script);
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

function deleteTask(rawName) {
  const r = spawnSync(SCHTASKS, ['/Delete', '/TN', `${TASK_FOLDER}${rawName}`, '/F'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

// ===============================================================================================
// Commands
// ===============================================================================================

async function cmdInstall() {
  const surface = loadSurfaceProfiles();
  const desktop = desktopDir();

  // The receipt is on disk BEFORE the first artifact exists (owner's-machine rule, step 2).
  const receipt = buildReceipt(surface, desktop);
  writeReceipt(receipt);
  console.log(`РАСПИСКА записана ДО создания: ${RECEIPT_PATH}`);
  console.log(`ОТКАТ ВСЕГО: ${receipt.rollbackAll}\n`);

  let bad = 0;
  for (const s of surface) {
    registerTask(taskName(s.profile), `"${PROFILE_MANAGER}" --apply ${s.profile}`);
    const t = readTask(taskName(s.profile));
    if (!t || t.runLevel !== 'Highest') {
      bad++;
      console.log(`ПРОВАЛ задача ${fullTaskName(s.profile)} — перечитана как ${JSON.stringify(t)}`);
      continue;
    }
    console.log(`OK   задача ${fullTaskName(s.profile)} → ${path.basename(t.execute)} ${t.args.includes(`--apply ${s.profile}`) ? `--apply ${s.profile}` : '⚠ ЧУЖИЕ АРГУМЕНТЫ'} · RunLevel ${t.runLevel}${s.draft ? ' · профиль-ЧЕРНОВИК: клик будет честно отказывать' : ''}`);
  }

  // §4.4 — the logon re-apply. Registered like the rest, plus the trigger; read back including it.
  registerTask(BOOT_TASK, BOOT_TASK_ARGS, { logonTrigger: true });
  const bt = readTask(BOOT_TASK);
  if (!bt || bt.runLevel !== 'Highest' || bt.trigger !== 'MSFT_TaskLogonTrigger') {
    bad++;
    console.log(`ПРОВАЛ задача ${TASK_FOLDER}${BOOT_TASK} — перечитана как ${JSON.stringify(bt)}`);
  } else {
    console.log(`OK   задача ${TASK_FOLDER}${BOOT_TASK} → ${path.basename(bt.execute)} ${bt.args.includes('--boot-apply') ? '--boot-apply' : '⚠ ЧУЖИЕ АРГУМЕНТЫ'} · RunLevel ${bt.runLevel} · триггер: ВХОД ЭТОГО ПОЛЬЗОВАТЕЛЯ`);
  }

  // §4.5 — the tray. Its own logon task, UNELEVATED (Limited), no execution time limit: the tray
  // lives the whole session. Read back including all three of those facts — the registration is
  // not the evidence.
  registerTask(TRAY_TASK, TRAY_TASK_ARGS, {
    logonTrigger: true, execute: WSCRIPT, runLevel: 'Limited', timeLimitMinutes: 0,
  });
  const tt = readTask(TRAY_TASK);
  const ttOk = tt && tt.runLevel === 'Limited' && tt.trigger === 'MSFT_TaskLogonTrigger'
    && tt.execute.toLowerCase().includes('wscript') && tt.args.includes('tray-launcher.js');
  if (!ttOk) {
    bad++;
    console.log(`ПРОВАЛ задача ${TASK_FOLDER}${TRAY_TASK} — перечитана как ${JSON.stringify(tt)}`);
  } else {
    console.log(`OK   задача ${TASK_FOLDER}${TRAY_TASK} → wscript //B tray-launcher.js · RunLevel ${tt.runLevel} (БЕЗ элевации — так задумано) · триггер: ВХОД ЭТОГО ПОЛЬЗОВАТЕЛЯ`);
  }

  console.log('');
  for (const s of surface.filter((x) => x.shortcut)) {
    const lnkPath = path.join(desktop, `${s.title}.lnk`);
    const got = createShortcut({
      lnkPath,
      target: SCHTASKS,
      args: `/run /tn "${fullTaskName(s.profile)}"`,
      workingDir: REPO_ROOT,
      description: `KAGO: применить профиль ${s.profile} через повышенную задачу (${fullTaskName(s.profile)})`,
    });
    const okTarget = got.target.toLowerCase() === SCHTASKS.toLowerCase() && got.args.includes(fullTaskName(s.profile));
    if (!okTarget) bad++;
    console.log(`${okTarget ? 'OK  ' : 'ПРОВАЛ'} ярлык «${path.basename(lnkPath)}» → ${got.target} ${got.args}`);
  }

  // Start the tray NOW — the logon trigger only covers future sessions, and the owner should not
  // have to re-logon to see the icon. The mutex in tray.ps1 makes a double start a silent no-op.
  console.log('');
  spawnSync(SCHTASKS, ['/Run', '/TN', `${TASK_FOLDER}${TRAY_TASK}`], { encoding: 'utf8' });
  let trayPid = null;
  for (let i = 0; i < 20 && !trayPid; i++) {
    await new Promise((res) => setTimeout(res, 500));
    trayPid = trayProcess();
  }
  if (trayPid) console.log(`OK   трей запущен: pid ${trayPid}, журнал runs/shell/tray.log`);
  else { bad++; console.log('ПРОВАЛ трей не поднялся за 10 с — pid-файла нет или процесс не powershell'); }

  console.log('');
  console.log(bad === 0
    ? `ИТОГ: задач ${surface.length + 2} (логон-задача + трей), ярлыков ${surface.filter((x) => x.shortcut).length}, всё перечитано. Расписка: ${RECEIPT_PATH}`
    : `ИТОГ: ПРОВАЛОВ ${bad} — см. выше.`);
  return bad === 0 ? 0 : 1;
}

function cmdUninstall() {
  if (!existsSync(RECEIPT_PATH)) {
    console.log(`Расписки нет (${RECEIPT_PATH}) — удаляю по контракту SURFACE, а не по памяти.`);
  }
  const receipt = existsSync(RECEIPT_PATH) ? JSON.parse(readFileSync(RECEIPT_PATH, 'utf8')) : null;
  let bad = 0;

  // The tray process outlives its task's deletion — stop it first, by pid, verified.
  const st = stopTray();
  console.log(st.stopped ? `OK   трей остановлен (pid ${st.pid})` : `—    трей: ${st.why}`);

  const tasks = receipt
    ? receipt.artifacts.filter((a) => a.kind === 'scheduled-task').map((a) => a.name.replace(TASK_FOLDER, ''))
    : [...SURFACE.map((s) => taskName(s.profile)), BOOT_TASK, TRAY_TASK];
  for (const t of tasks) {
    const ok = deleteTask(t);
    const still = readTask(t);
    if (still) { bad++; console.log(`ПРОВАЛ задача ${TASK_FOLDER}${t} всё ещё существует`); }
    else console.log(`OK   задача ${TASK_FOLDER}${t} удалена${ok ? '' : ' (или её и не было)'}`);
  }

  const desktop = desktopDir();
  const lnks = receipt
    ? receipt.artifacts.filter((a) => a.kind === 'desktop-shortcut').map((a) => a.path)
    : [];
  if (!receipt) {
    for (const s of SURFACE.filter((x) => x.shortcut)) {
      const file = path.join(PROFILES_DIR, `${s.profile}.json`);
      const { profile } = loadProfileFile(file);
      if (profile?.title) lnks.push(path.join(desktop, `${profile.title}.lnk`));
    }
  }
  for (const l of lnks) {
    if (removeShortcut(l)) console.log(`OK   ярлык удалён: ${l}`);
    else { bad++; console.log(`ПРОВАЛ ярлык остался: ${l}`); }
  }

  console.log(bad === 0 ? 'ИТОГ: всё созданное вне репозитория удалено.' : `ИТОГ: ПРОВАЛОВ ${bad}.`);
  return bad === 0 ? 0 : 1;
}

function cmdStatus() {
  const desktop = desktopDir();
  let n = 0;
  for (const s of SURFACE) {
    const t = readTask(taskName(s.profile));
    console.log(t
      ? `OK   задача ${fullTaskName(s.profile)} · RunLevel ${t.runLevel}`
      : `—    задачи ${fullTaskName(s.profile)} нет`);
    if (t) n++;
    if (s.shortcut) {
      const file = path.join(PROFILES_DIR, `${s.profile}.json`);
      const { profile } = loadProfileFile(file);
      const lnkPath = profile?.title ? path.join(desktop, `${profile.title}.lnk`) : null;
      if (lnkPath && existsSync(lnkPath)) {
        const got = readShortcut(lnkPath);
        console.log(`     ярлык «${path.basename(lnkPath)}» → ${path.basename(got.target)} ${got.args}`);
      } else {
        console.log(`     ярлыка нет${lnkPath ? `: ${lnkPath}` : ''}`);
      }
    }
  }
  const bt = readTask(BOOT_TASK);
  console.log(bt
    ? `OK   задача ${TASK_FOLDER}${BOOT_TASK} · RunLevel ${bt.runLevel} · триггер ${bt.trigger === 'MSFT_TaskLogonTrigger' ? 'вход пользователя' : `⚠ ${bt.trigger}`}`
    : `—    задачи ${TASK_FOLDER}${BOOT_TASK} нет`);
  if (bt) n++;
  const tt = readTask(TRAY_TASK);
  console.log(tt
    ? `OK   задача ${TASK_FOLDER}${TRAY_TASK} · RunLevel ${tt.runLevel} · триггер ${tt.trigger === 'MSFT_TaskLogonTrigger' ? 'вход пользователя' : `⚠ ${tt.trigger}`}`
    : `—    задачи ${TASK_FOLDER}${TRAY_TASK} нет`);
  if (tt) n++;
  const tp = trayProcess();
  console.log(tp ? `     трей ЖИВ: pid ${tp}` : '     трей не запущен');
  console.log(`ИТОГ: задач на месте ${n} из ${SURFACE.length + 2}. Расписка: ${existsSync(RECEIPT_PATH) ? RECEIPT_PATH : 'нет'}`);
  return 0;
}

async function main(argv) {
  if (argv.includes('--install')) return cmdInstall();
  if (argv.includes('--uninstall')) return cmdUninstall();
  if (argv.includes('--status') || argv.length === 0) return cmdStatus();
  console.error('Команды: --install · --uninstall · --status');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c)).catch((e) => { console.error(e.message); process.exit(1); });
}
