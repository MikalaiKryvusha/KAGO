#!/usr/bin/env node
// tools/build-workloads.mjs — build KAGO's own GPU workloads, prove them, and manifest them.
//
// WHY A MANIFEST EXISTS AT ALL: the owner decided (interview 001, Q3 = B, 2026-08-09) that the
// compiled `.exe` SHIPS in the repository, so KAGO works on a machine with no CUDA Toolkit. That
// decision has exactly one weak side — a committed binary is the one artefact nobody can review by
// eye. The manifest closes it: every binary travels with its own sha-256, the sha-256 of the source
// it was built from, the toolchain that built it, and the checksum its run produces on this card.
// Anyone rebuilds and compares instead of trusting bytes.
//
// The determinism proof is not decoration either — it is phase-1 acceptance criterion P1-AC1
// (plans/02_epic01_phase1 §2): each workload must return ONE distinct checksum across
// DETERMINISM_REPEATS runs. A workload that is not deterministic at stock cannot detect silent
// corruption later, because every run would look like corruption.
//
// Usage:
//   npm run workloads:build            build, prove, write MANIFEST.json
//   npm run workloads:verify           recompute every hash in MANIFEST.json, build nothing
//   node tools/build-workloads.mjs --repeats 5
//
// Exit: 0 all good · 1 a hash mismatch, a non-deterministic workload, or a failed build
//       2 no toolchain AND no shipped binary to fall back on
//
// [NOT-TESTED] — flipped by its own first run, which is the observation P1-AC1 asks for.

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { findToolchain, buildCuda, describeToolchain, ToolchainMissingError } from '../automation-engine/lib/toolchain.mjs';
import config from '../automation-engine/config.mjs';

const ROOT = resolve(process.cwd());
const WORKLOADS = join(ROOT, 'workloads');
const MANIFEST = join(WORKLOADS, 'MANIFEST.json');

const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

/**
 * Local ISO 8601 with the machine's REAL offset.
 *
 * The first version of this function did `toISOString().replace('Z','') + '+03:00'` — a UTC clock
 * reading with someone else's offset glued on, which stamped 23:28 local as "20:28+03:00". A stamp
 * that lies is worse than no stamp (AGENT_GUIDE.md → a stamp carries the date AND the time), and it
 * would have been wrong on every machine that is not this one.
 */
function isoLocal(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
         `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

/**
 * The card the binaries were proven on, PROBED rather than remembered. A run checksum is only
 * meaningful next to the hardware and driver that produced it (rule R6: a profile — and by the same
 * logic a golden checksum — is bound to the driver and VBIOS it was proved on).
 */
function probeGpu() {
  const r = spawnSync('nvidia-smi',
    ['--query-gpu=name,driver_version,vbios_version', '--format=csv,noheader'],
    { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !r.stdout) return null;   // honest null beats an invented string
  const [name, driver, vbios] = r.stdout.trim().split(/\s*,\s*/);
  return { name, driver, vbios };
}

/** Run a built workload once and pull its machine-readable line apart. */
function runWorkload(exePath, args = []) {
  const r = spawnSync(exePath, args.map(String), { encoding: 'utf8', windowsHide: true });
  const line = (r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('KAGO-WORKLOAD')) || '';
  const fields = {};
  for (const part of line.split(/\s+/).slice(1)) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return { ok: r.status === 0 && !!fields.checksum, status: r.status, fields, stdout: r.stdout, stderr: r.stderr };
}

/**
 * The determinism proof. Runs the workload N times and returns the set of distinct checksums.
 *
 * P1-AC1 wants exactly ONE. More than one at stock voltage means the workload itself is not
 * deterministic — fast-math reassociation, an order-dependent reduction, a timing dependence — and
 * such a workload must be fixed before it is ever used to judge a profile, because it would report
 * corruption that the card did not cause.
 */
function proveDeterminism(exePath, repeats) {
  const seen = new Map();
  for (let i = 0; i < repeats; i++) {
    const run = runWorkload(exePath);
    if (!run.ok) return { ok: false, reason: `прогон ${i + 1} не дал контрольной суммы (код ${run.status})`, seen };
    const c = run.fields.checksum;
    seen.set(c, (seen.get(c) || 0) + 1);
  }
  return { ok: seen.size === 1, seen };
}

function listSources() {
  if (!existsSync(WORKLOADS)) return [];
  return readdirSync(WORKLOADS).filter((f) => f.endsWith('.cu')).sort();
}

function verifyManifest() {
  if (!existsSync(MANIFEST)) {
    console.log('ПРОВЕРКА НЕВОЗМОЖНА: манифеста нет — ' + MANIFEST);
    return 1;
  }
  const man = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  let bad = 0;
  console.log('ПРОВЕРКА МАНИФЕСТА · собран ' + man.built_at);
  for (const entry of man.workloads) {
    const src = join(WORKLOADS, entry.source);
    const exe = join(WORKLOADS, entry.binary);
    const srcOk = existsSync(src) && sha256File(src) === entry.source_sha256;
    const exeOk = existsSync(exe) && sha256File(exe) === entry.binary_sha256;
    if (!srcOk || !exeOk) bad++;
    console.log(`  ${entry.name.padEnd(10)} исходник ${srcOk ? 'СОВПАЛ' : 'РАЗОШЁЛСЯ'} · бинарник ${exeOk ? 'СОВПАЛ' : 'РАЗОШЁЛСЯ'}`);
    if (!srcOk && existsSync(src)) console.log(`      исходник изменился после сборки — пересоберите: ожидали ${entry.source_sha256.slice(0, 12)}…, на диске ${sha256File(src).slice(0, 12)}…`);
  }
  console.log(bad === 0 ? 'ИТОГ: манифест сходится.' : `ИТОГ: расхождений ${bad}. Пересоберите: npm run workloads:build`);
  return bad === 0 ? 0 : 1;
}

function main(argv) {
  if (argv.includes('--verify')) return verifyManifest();

  const ri = argv.indexOf('--repeats');
  const repeats = ri >= 0 ? Number(argv[ri + 1]) : config.DETERMINISM_REPEATS;

  const sources = listSources();
  if (!sources.length) { console.log('В workloads/ нет ни одного .cu — собирать нечего.'); return 1; }

  let tc;
  try {
    tc = findToolchain();
  } catch (e) {
    if (e instanceof ToolchainMissingError) {
      // The owner's Q3 = B decision is what makes this survivable: shipped binaries mean an absent
      // toolchain costs the ability to REBUILD, not the ability to run.
      console.log('ТУЛЧЕЙНА НЕТ: ' + e.message);
      console.log('  ' + (e.hint || ''));
      const haveAll = sources.every((s) => existsSync(join(WORKLOADS, s.replace(/\.cu$/, '.exe'))));
      if (haveAll) {
        console.log('  Собранные бинарники на месте — пересборка не нужна, проверяю манифест.');
        return verifyManifest();
      }
      console.log('  И собранных бинарников тоже нет. Поиск Vmin недоступен, применение профилей — работает.');
      return 2;
    }
    throw e;
  }

  console.log('ТУЛЧЕЙН: ' + describeToolchain(tc));
  console.log('ПОВТОРОВ НА ДЕТЕРМИНИЗМ: ' + repeats + ' (config.DETERMINISM_REPEATS)');
  console.log('');

  const entries = [];
  let failed = 0;

  for (const src of sources) {
    const name = basename(src, '.cu');
    const exe = join(WORKLOADS, name + '.exe');
    process.stdout.write(`${name}: сборка… `);
    const built = buildCuda(join(WORKLOADS, src), exe, { toolchain: tc });
    if (!built.ok) {
      console.log('ПРОВАЛ');
      console.log(built.stderr.split(/\r?\n/).slice(0, 6).map((l) => '    ' + l).join('\n'));
      failed++;
      continue;
    }
    process.stdout.write('ок · прогон… ');
    const proof = proveDeterminism(exe, repeats);
    const checks = [...proof.seen.keys()];
    if (!proof.ok) {
      console.log('НЕ ДЕТЕРМИНИРОВАН');
      console.log(`    ${proof.reason || `разных сумм: ${proof.seen.size} — ${checks.join(', ')}`}`);
      console.log('    Это дефект нагрузки, а не карты: такой нагрузкой нельзя судить о профиле.');
      failed++;
      continue;
    }
    console.log(`детерминирован · checksum=${checks[0]}`);
    entries.push({
      name,
      source: src,
      binary: name + '.exe',
      source_sha256: sha256File(join(WORKLOADS, src)),
      binary_sha256: sha256File(exe),
      run_checksum: checks[0],
      repeats,
      size_bytes: statSync(exe).size,
    });
  }

  if (failed) {
    console.log(`\nИТОГ: провалов ${failed}. Манифест НЕ переписан — он описывает только доказанное.`);
    return 1;
  }

  const manifest = {
    note: 'Бинарники едут в репозиторий по решению владельца (интервью 001, Q3 = B). Манифест — способ проверить их, не веря байтам: пересоберите и сверьте.',
    built_at: isoLocal(),
    toolchain: describeToolchain(tc),
    gpu: probeGpu(),
    verify_command: 'npm run workloads:verify',
    rebuild_command: 'npm run workloads:build',
    workloads: entries,
  };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\nМАНИФЕСТ: ${MANIFEST} · нагрузок ${entries.length}`);
  console.log('ИТОГ: все нагрузки собраны и детерминированы.');
  return 0;
}

process.exit(main(process.argv.slice(2)));
