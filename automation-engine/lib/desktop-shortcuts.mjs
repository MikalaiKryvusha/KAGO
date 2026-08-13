#!/usr/bin/env node
// automation-engine/lib/desktop-shortcuts.mjs — `.lnk` GENERATION AND READ-BACK, nothing else.
// Phase 3 step 4.3 (plans/06_epic01_phase3_shell.md §4.3).
//
// BOUNDARIES. This module writes SHORTCUT FILES — it never touches GPU state (R1 stays with
// profile-manager), never registers scheduler tasks (that is setup-desktop's job), and never
// decides WHAT a shortcut points at. It is the platform-idiomatic `.lnk` writer the external map
// promised («desktop-shortcuts.mjs — .lnk generation via WScript.Shell») plus the read-back that
// makes every write provable (the owner's-machine rule, step 4: confirm by re-reading).
//
// HOW: PowerShell one-shots over the COM object `WScript.Shell` — the OS's own shortcut author,
// zero dependencies. Arguments travel to the child through spawnSync's argv (CreateProcessW is
// UTF-16, so emoji in shortcut names survive); the child prints JSON, and the parent demands it
// parse. EXP-0035's trap (prose mangled by a SHELL) does not apply: there is no shell between
// Node and powershell.exe — but the selftest still round-trips an emoji name to PROVE it rather
// than assume it.
//
// [TESTED: 2026-08-14 · `--selftest` → sandbox dir under os.tmpdir(), no Desktop touched
//  (EXP-0025 discipline): create → read back → field-by-field match, emoji filename survives,
//  remove removes, reading a missing .lnk refuses with a named reason.]

import { existsSync, rmSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

// MEASURED VENDOR QUIRK (this machine, 2026-08-14): WScript.Shell is an ANSI wrapper — CreateShortcut
// on a path with characters OUTSIDE the ANSI codepage (here cp1251: Cyrillic fits, emoji does not)
// fails with FileNotFoundException, the path echoed back as «??». The owner's shortcut names carry
// emoji by canon, so this module NEVER hands the final path to COM: it authors under a safe
// ASCII temp name and renames with Node (CreateProcessW/NTFS are UTF-16 — proven by the selftest's
// emoji round-trip), and reads through a temp ASCII copy the same way.
const SAFE_STEM = () => `kago-lnk-${process.pid}-${Math.random().toString(36).slice(2, 8)}.lnk`;

/** PowerShell single-quoted string: the only escape is doubling the quote itself. */
function psq(s) {
  return `'${String(s).replace(/'/gu, "''")}'`;
}

/** Run a PowerShell one-shot and return { ok, stdout, stderr }. No shell in between. */
function ps(script) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  return {
    ok: !r.error && r.status === 0,
    status: r.status,
    stdout: (r.stdout ?? '').trim(),
    stderr: (r.stderr ?? '').trim(),
  };
}

/**
 * Create (or overwrite) a `.lnk`. Returns the read-back — creation is not the evidence, the
 * re-read is. Throws with the child's stderr when the COM call fails.
 */
export function createShortcut({ lnkPath, target, args = '', workingDir = '', description = '', iconLocation = '' }) {
  // Author under an ASCII temp name IN THE SAME DIRECTORY (a same-dir rename is atomic on NTFS and
  // never degrades to a copy), then rename to the real — possibly emoji — name with Node.
  const tempPath = path.join(path.dirname(lnkPath), SAFE_STEM());
  const script = [
    '$ErrorActionPreference = "Stop"',
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut(${psq(tempPath)})`,
    `$s.TargetPath = ${psq(target)}`,
    args ? `$s.Arguments = ${psq(args)}` : null,
    workingDir ? `$s.WorkingDirectory = ${psq(workingDir)}` : null,
    description ? `$s.Description = ${psq(description)}` : null,
    iconLocation ? `$s.IconLocation = ${psq(iconLocation)}` : null,
    `$s.Save()`,
  ].filter(Boolean).join('; ');
  const r = ps(script);
  if (!r.ok) {
    rmSync(tempPath, { force: true });
    throw new Error(`ярлык не создан (${path.basename(lnkPath)}): код ${r.status}: ${r.stderr || r.stdout}`);
  }
  if (!existsSync(tempPath)) throw new Error(`COM отчитался успехом, а файла нет: ${tempPath} — состояние перечитывается, не предполагается`);
  rmSync(lnkPath, { force: true });
  renameSync(tempPath, lnkPath);
  return readShortcut(lnkPath);
}

/** Read a `.lnk` back through the same COM author — via an ASCII temp copy (the quirk above).
 *  Refuses a missing file with a named reason. */
export function readShortcut(lnkPath) {
  if (!existsSync(lnkPath)) throw new Error(`ярлыка нет на диске: ${lnkPath}`);
  const tempPath = path.join(tmpdir(), SAFE_STEM());
  copyFileSync(lnkPath, tempPath);
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$ws = New-Object -ComObject WScript.Shell`,
    `$s = $ws.CreateShortcut(${psq(tempPath)})`,
    `@{ target = $s.TargetPath; args = $s.Arguments; workingDir = $s.WorkingDirectory; description = $s.Description; icon = $s.IconLocation } | ConvertTo-Json -Compress`,
  ].join('; ');
  const r = ps(script);
  rmSync(tempPath, { force: true });
  if (!r.ok) throw new Error(`ярлык не прочитан (${path.basename(lnkPath)}): код ${r.status}: ${r.stderr || r.stdout}`);
  try {
    return JSON.parse(r.stdout.replace(/^\uFEFF/u, ''));
  } catch {
    throw new Error(`ответ COM не разобрался как JSON: ${r.stdout}`);
  }
}

/** Delete a `.lnk`. Deleting what does not exist is a no-op, not an error (rollback idempotence). */
export function removeShortcut(lnkPath) {
  rmSync(lnkPath, { force: true });
  return !existsSync(lnkPath);
}

/** The owner's Desktop, asked of the OS rather than assembled from an env var by hand. */
export function desktopDir() {
  const r = ps('[Environment]::GetFolderPath("Desktop")');
  if (!r.ok || !r.stdout) throw new Error(`Desktop не определён: ${r.stderr || '(пусто)'}`);
  return r.stdout;
}

// ===============================================================================================
// Selftest — a sandbox under the OS temp dir; the real Desktop is never touched (EXP-0025).
// ===============================================================================================

function cmdSelftest() {
  const sandbox = path.join(tmpdir(), `kago-lnk-selftest-${process.pid}`);
  mkdirSync(sandbox, { recursive: true });
  const blocks = [];
  const block = (what, fn) => blocks.push({ what, fn });

  // Windows forbids " in filenames anyway; the emoji and the Cyrillic are the actual risk here.
  const emojiLnk = path.join(sandbox, '🚀 Проба (не трогать).lnk');
  const plainLnk = path.join(sandbox, 'plain.lnk');
  const TARGET = 'C:\\Windows\\System32\\schtasks.exe';
  const ARGS = '/run /tn "KAGO\\selftest-проба"';

  block('создание + перечитывание: все поля совпали с заказанными', () => {
    const got = createShortcut({
      lnkPath: plainLnk, target: TARGET, args: ARGS,
      workingDir: 'C:\\Windows', description: 'KAGO selftest',
    });
    if (got.target !== TARGET) return `target: ${got.target}`;
    if (got.args !== ARGS) return `args: ${got.args}`;
    if (got.workingDir !== 'C:\\Windows') return `workingDir: ${got.workingDir}`;
    if (got.description !== 'KAGO selftest') return `description: ${got.description}`;
    return null;
  });

  block('эмодзи и кириллица в ИМЕНИ ярлыка переживают дорогу туда и обратно', () => {
    const got = createShortcut({ lnkPath: emojiLnk, target: TARGET, args: ARGS });
    if (!existsSync(emojiLnk)) return 'файл с эмодзи-именем не появился';
    if (got.target !== TARGET) return `target через эмодзи-путь: ${got.target}`;
    return null;
  });

  block('удаление удаляет, повторное удаление — законный no-op (идемпотентный откат)', () => {
    if (!removeShortcut(plainLnk)) return 'файл остался после удаления';
    if (!removeShortcut(plainLnk)) return 'повторное удаление отчиталось провалом';
    return null;
  });

  block('чтение отсутствующего ярлыка — отказ с именем пути, а не пустой объект', () => {
    try {
      readShortcut(plainLnk);
      return 'прочитал то, чего нет';
    } catch (e) {
      return /ярлыка нет на диске/u.test(e.message) ? null : `не та причина: ${e.message}`;
    }
  });

  block('Desktop определяется и существует (только чтение)', () => {
    const d = desktopDir();
    return existsSync(d) ? null : `путь не существует: ${d}`;
  });

  let failed = 0;
  try {
    for (const b of blocks) {
      let problem;
      try {
        problem = b.fn();
      } catch (e) {
        problem = `блок сам упал: ${e.message}`;
      }
      if (problem === null || problem === undefined) {
        console.log(`OK   ${b.what}`);
      } else {
        failed++;
        console.log(`ПРОВАЛ ${b.what}`);
        console.log(`       ${problem}`);
      }
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
  console.log('');
  console.log(`САМОПРОВЕРКА ЯРЛЫКОВ: ${blocks.length} блоков, провалов ${failed}. Песочница удалена, Desktop не тронут.`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) process.exit(cmdSelftest());
  console.error('Команды: --selftest. Создание боевых ярлыков — setup-desktop.mjs, не этот модуль.');
  process.exit(2);
}
