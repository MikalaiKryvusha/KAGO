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
// [NOT-TESTED live: the install itself. 2026-08-14 the agent's session was DENIED permission to
//  create scheduler tasks / Desktop shortcuts (correctly — machine state outside the repo), so
//  `--install` has never run. What IS proven offline: `--status` walks the surface read-only
//  against the live machine (run, 0 of 5 present), the `.lnk` author underneath is selftested
//  (desktop-shortcuts.mjs, 5 blocks), and `npm run check` parses everything. First live run —
//  with the owner: `npm run setup -- --install`, then the §4.3 proofs from plans/06.]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { PROFILES_DIR, loadProfileFile, requiresQualification } from './lib/profile-store.mjs';
import { createShortcut, readShortcut, removeShortcut, desktopDir } from './lib/desktop-shortcuts.mjs';

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

/** Local ISO 8601 with the machine's offset — a receipt stamped in UTC already lied once (EXP-0012). */
function localIso() {
  const d = new Date();
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

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

/** Register (or overwrite) one elevated apply task. Interactive-only, current user, fixed args. */
function registerTask(profileName) {
  const action = `New-ScheduledTaskAction -Execute ${psq(process.execPath)} -Argument ${psq(`"${PROFILE_MANAGER}" --apply ${profileName}`)} -WorkingDirectory ${psq(REPO_ROOT)}`;
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$action = ${action}`,
    // Interactive logon type: runs in the logged-on user's session (the apply's console is visible),
    // and NEVER stores credentials. RunLevel Highest is the whole point (researches/03 §3.6).
    `$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Highest`,
    `$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)`,
    `Register-ScheduledTask -TaskName ${psq(taskName(profileName))} -TaskPath ${psq(TASK_FOLDER)} -Action $action -Principal $principal -Settings $settings -Force | Out-Null`,
  ].join('; ');
  const r = ps(script);
  if (!r.ok) throw new Error(`задача ${fullTaskName(profileName)} не зарегистрирована: ${r.stderr || r.stdout}`);
}

/** Read a task back: does it exist, what does it run. The registration is not the evidence. */
function readTask(profileName) {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$t = Get-ScheduledTask -TaskName ${psq(taskName(profileName))} -TaskPath ${psq(TASK_FOLDER)}`,
    `@{ execute = $t.Actions[0].Execute; args = $t.Actions[0].Arguments; runLevel = [string]$t.Principal.RunLevel } | ConvertTo-Json -Compress`,
  ].join('; ');
  const r = ps(script);
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

function deleteTask(profileName) {
  const r = spawnSync(SCHTASKS, ['/Delete', '/TN', fullTaskName(profileName), '/F'], { encoding: 'utf8' });
  return !r.error && r.status === 0;
}

// ===============================================================================================
// Commands
// ===============================================================================================

function cmdInstall() {
  const surface = loadSurfaceProfiles();
  const desktop = desktopDir();

  // The receipt is on disk BEFORE the first artifact exists (owner's-machine rule, step 2).
  const receipt = buildReceipt(surface, desktop);
  writeReceipt(receipt);
  console.log(`РАСПИСКА записана ДО создания: ${RECEIPT_PATH}`);
  console.log(`ОТКАТ ВСЕГО: ${receipt.rollbackAll}\n`);

  let bad = 0;
  for (const s of surface) {
    registerTask(s.profile);
    const t = readTask(s.profile);
    if (!t || t.runLevel !== 'Highest') {
      bad++;
      console.log(`ПРОВАЛ задача ${fullTaskName(s.profile)} — перечитана как ${JSON.stringify(t)}`);
      continue;
    }
    console.log(`OK   задача ${fullTaskName(s.profile)} → ${path.basename(t.execute)} ${t.args.includes(`--apply ${s.profile}`) ? `--apply ${s.profile}` : '⚠ ЧУЖИЕ АРГУМЕНТЫ'} · RunLevel ${t.runLevel}${s.draft ? ' · профиль-ЧЕРНОВИК: клик будет честно отказывать' : ''}`);
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

  console.log('');
  console.log(bad === 0
    ? `ИТОГ: задач ${surface.length}, ярлыков ${surface.filter((x) => x.shortcut).length}, всё перечитано. Расписка: ${RECEIPT_PATH}`
    : `ИТОГ: ПРОВАЛОВ ${bad} — см. выше.`);
  return bad === 0 ? 0 : 1;
}

function cmdUninstall() {
  if (!existsSync(RECEIPT_PATH)) {
    console.log(`Расписки нет (${RECEIPT_PATH}) — удаляю по контракту SURFACE, а не по памяти.`);
  }
  const receipt = existsSync(RECEIPT_PATH) ? JSON.parse(readFileSync(RECEIPT_PATH, 'utf8')) : null;
  let bad = 0;

  const tasks = receipt
    ? receipt.artifacts.filter((a) => a.kind === 'scheduled-task').map((a) => a.name.replace(TASK_FOLDER, ''))
    : SURFACE.map((s) => taskName(s.profile));
  for (const t of tasks) {
    const name = t.replace(/^apply-/u, '');
    const ok = deleteTask(name);
    const still = readTask(name);
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
    const t = readTask(s.profile);
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
  console.log(`ИТОГ: задач на месте ${n} из ${SURFACE.length}. Расписка: ${existsSync(RECEIPT_PATH) ? RECEIPT_PATH : 'нет'}`);
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
