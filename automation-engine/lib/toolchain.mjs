// automation-engine/lib/toolchain.mjs — find the CUDA build toolchain, never assume it.
//
// RULE R8 of PROJECT_ARCHITECTURE_INTERNAL_MAP.md: the workload build locates its own toolchain.
//
// WHY THIS MODULE EXISTS AT ALL, in one sentence: `nvcc` on Windows is a front-end that needs an
// MSVC host compiler, and it does NOT find one by itself — it fails with
// "nvcc fatal : Cannot find compiler 'cl.exe' in PATH" until the Visual Studio developer
// environment is loaded. A project that assumes the operator's shell already has it will work on
// exactly one machine on exactly one day.
//
// PAID FOR IN THE FIELD, 2026-08-09: an agent command started an unrequested Visual Studio upgrade
// and the toolset moved out from under a build mid-session (EXPERIENCE.md → EXP-0005). The
// x86-hosted cross compiler survived and produced a BYTE-IDENTICAL result, which is why the
// fallback below is a proven path rather than a hopeful one (researches/03 §2.1).
//
// The module answers three questions and refuses to guess at any of them:
//   where is nvcc · where is the MSVC environment script · can this machine build at all
//
// [TESTED: 2026-08-09 · three observations. (1) findToolchain() on this machine resolved
//  nvcc v13.3 (found by PATH) + vcvars64.bat, host x64 -> x64. (2) buildCuda() compiled the probe
//  kernel through it and the binary printed checksum fd7d452ce569c9d7 — the same value the three
//  earlier toolchain configurations produced, so the build path is not silently changing results.
//  (3) The refusal path was proved RED through the searchRoot seam: ToolchainMissingError
//  reason=no-nvcc, with its message and hint, and no stack trace. Note what the attempt to prove
//  it WITHOUT the seam taught, since it is the more useful half: stripping PATH and CUDA_PATH did
//  not disable the locator — the toolkit scan found the compiler anyway and honestly reported
//  foundBy='toolkit-scan'. That is the designed behaviour, not a leak.]

import { existsSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

/**
 * A missing toolchain is an ordinary, expected state — not an exception in the panic sense. It
 * carries a `reason` code so a caller can degrade honestly ("sweeping unavailable, profiles still
 * apply") instead of printing a stack trace at the owner.
 */
export class ToolchainMissingError extends Error {
  constructor(reason, message, hint) {
    super(message);
    this.name = 'ToolchainMissingError';
    this.reason = reason;   // 'no-nvcc' | 'no-vswhere' | 'no-vs' | 'no-vcvars' | 'not-windows'
    this.hint = hint;
  }
}

/** Run a command and return its trimmed stdout, or null. Never throws — probing is not asserting. */
function probe(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) return null;
    return (r.stdout || '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Locate `nvcc`.
 *
 * Order matters and each step is a different kind of evidence: PATH is what the operator's shell
 * says, CUDA_PATH is what the installer wrote, and the versioned directory scan is the filesystem
 * itself. The scan sorts DESCENDING so a machine with several toolkits gets the newest — and the
 * sort is numeric-aware, because a plain string sort puts v9.0 above v13.3.
 *
 * The `searchRoot` option exists for one reason, and it is worth stating so nobody removes it as
 * unused: the third strategy is DELIBERATELY independent of the operator's environment, so a
 * machine that has the toolkit cannot be talked out of finding it by editing PATH. That is the
 * right behaviour and it makes the refusal path untestable without a seam — proved by observation
 * on 2026-08-09, where stripping PATH and CUDA_PATH still resolved via `toolkit-scan` (and
 * `ProgramFiles` set in PowerShell does not even reach a child process on Windows, so there is no
 * environment trick available either). A guard that cannot be made to go red proves nothing
 * (BUG_FIXING_FRAMEWORK.md → Guards), so the seam is how the refusal is proved.
 */
export function findNvcc(opts = {}) {
  const onPath = probe('where', ['nvcc']);
  if (onPath && !opts.searchRoot) {
    const first = onPath.split(/\r?\n/)[0].trim();
    if (first && existsSync(first)) return { path: first, foundBy: 'PATH' };
  }

  if (process.env.CUDA_PATH && !opts.searchRoot) {
    const p = join(process.env.CUDA_PATH, 'bin', 'nvcc.exe');
    if (existsSync(p)) return { path: p, foundBy: 'CUDA_PATH' };
  }

  const root = opts.searchRoot
    ? resolve(opts.searchRoot)
    : join(process.env.ProgramFiles || 'C:\\Program Files', 'NVIDIA GPU Computing Toolkit', 'CUDA');
  if (existsSync(root)) {
    const versions = readdirSync(root)
      .filter((d) => /^v\d+(\.\d+)*$/u.test(d))
      .sort((a, b) => compareVersionDesc(a.slice(1), b.slice(1)));
    for (const v of versions) {
      const p = join(root, v, 'bin', 'nvcc.exe');
      if (existsSync(p)) return { path: p, foundBy: 'toolkit-scan' };
    }
  }
  return null;
}

/** Descending numeric version compare: 13.3 before 9.0, which a string sort gets backwards. */
function compareVersionDesc(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] || 0) - (pa[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Locate the Visual Studio developer environment script.
 *
 * `vswhere.exe` lives at a FIXED path that Microsoft keeps stable across versions — which is
 * exactly why we ask it instead of hard-coding an MSVC version directory. This machine held
 * 14.40 in the evening and 14.44 an hour later; a pinned path would have broken twice.
 *
 * Returns the vcvars script AND the host architecture it sets up, because those are two different
 * facts and the caller may want to report the second.
 */
export function findVcvars() {
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vswhere = join(pf86, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!existsSync(vswhere)) {
    throw new ToolchainMissingError(
      'no-vswhere',
      `vswhere.exe not found at ${vswhere} — Visual Studio's locator is missing`,
      'Install Visual Studio Build Tools with the "Desktop development with C++" workload.',
    );
  }

  const installPath = probe(vswhere, [
    '-latest', '-products', '*',
    '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath',
  ]);
  if (!installPath) {
    throw new ToolchainMissingError(
      'no-vs',
      'vswhere found no Visual Studio install carrying the C++ x86/x64 tools',
      'Add the "Desktop development with C++" workload to an existing Visual Studio install.',
    );
  }

  const buildDir = join(installPath.split(/\r?\n/)[0].trim(), 'VC', 'Auxiliary', 'Build');

  // Native x64 host first; the x86-hosted cross compiler is the PROVEN fallback (researches/03
  // §2.1: it produced checksum fd7d452ce569c9d7, identical to the native build's).
  const candidates = [
    { file: 'vcvars64.bat', host: 'x64', target: 'x64' },
    { file: 'vcvarsx86_amd64.bat', host: 'x86', target: 'x64' },
  ];
  for (const c of candidates) {
    const p = join(buildDir, c.file);
    if (existsSync(p)) return { path: p, host: c.host, target: c.target, vsInstall: dirname(dirname(dirname(buildDir))) };
  }

  throw new ToolchainMissingError(
    'no-vcvars',
    `neither vcvars64.bat nor vcvarsx86_amd64.bat exists in ${buildDir} — the C++ toolset is absent or half-installed`,
    'Repair the Visual Studio installation (Visual Studio Installer -> Repair). A half-installed toolset looks exactly like this.',
  );
}

/**
 * The whole toolchain, or a named refusal.
 *
 * @returns {{nvcc:string, nvccFoundBy:string, vcvars:string, host:string, vsInstall:string}}
 * @throws {ToolchainMissingError} with a `reason` a caller can branch on
 */
export function findToolchain(opts = {}) {
  if (process.platform !== 'win32') {
    throw new ToolchainMissingError('not-windows', `this toolchain locator is Windows-only; platform is ${process.platform}`, null);
  }
  const nvcc = findNvcc(opts);
  if (!nvcc) {
    throw new ToolchainMissingError(
      'no-nvcc',
      'nvcc not found on PATH, via CUDA_PATH, or under the NVIDIA GPU Computing Toolkit directory',
      'Install the CUDA Toolkit. KAGO still applies profiles without it; only the Vmin sweep needs a compiler.',
    );
  }
  const vc = findVcvars();
  return {
    nvcc: nvcc.path,
    nvccFoundBy: nvcc.foundBy,
    vcvars: vc.path,
    host: vc.host,
    target: vc.target,
    vsInstall: vc.vsInstall,
  };
}

/**
 * Compile a .cu source to an .exe.
 *
 * The command runs from a generated .bat file rather than a long quoted command line. That is not
 * fastidiousness: `call "<path with spaces>" && nvcc ...` through a shell argument is exactly the
 * quoting shape that AGENT_GUIDE.md's text-hygiene rules exist about, and a batch file makes the
 * executed text READABLE and re-runnable by hand when something goes wrong.
 *
 * @param {string} source  path to the .cu file
 * @param {string} out     path of the .exe to produce
 * @param {{flags?:string[], toolchain?:object}} [opts]
 * @returns {{ok:boolean, out:string, stdout:string, stderr:string, host:string, command:string}}
 */
export function buildCuda(source, out, opts = {}) {
  const tc = opts.toolchain || findToolchain();
  const src = resolve(source);
  const exe = resolve(out);
  if (!existsSync(src)) throw new Error(`buildCuda: source does not exist: ${src}`);

  const flags = opts.flags || ['-O2'];
  const dir = mkdtempSync(join(tmpdir(), 'kago-build-'));
  const bat = join(dir, 'build.bat');

  // ASCII only in this file — it is executed by cmd.exe, whose codepage is not ours to assume.
  const script = [
    '@echo off',
    `call "${tc.vcvars}" >nul 2>nul`,
    'if errorlevel 1 exit /b 91',
    `"${tc.nvcc}" ${flags.join(' ')} -o "${exe}" "${src}"`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n');

  writeFileSync(bat, script, 'ascii');
  const r = spawnSync('cmd.exe', ['/c', bat], { encoding: 'utf8', windowsHide: true });
  rmSync(dir, { recursive: true, force: true });

  return {
    ok: r.status === 0 && existsSync(exe),
    out: exe,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
    status: r.status,
    host: tc.host,
    command: script,
  };
}

/** A one-line human description for reports and the harness table. */
export function describeToolchain(tc) {
  return `nvcc ${tc.nvcc} (found by ${tc.nvccFoundBy}) + MSVC env ${tc.vcvars} [host ${tc.host} -> ${tc.target}]`;
}
