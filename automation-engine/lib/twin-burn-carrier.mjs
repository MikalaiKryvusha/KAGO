#!/usr/bin/env node
// twin-burn-carrier.mjs — the burn's PROCESS BODY on the twin (epic 59 phase 4, `plans/63` шаг 3).
//
// WHY THIS EXISTS. On the live path the burn is a real process (`furnace.exe` inside `spawnSync`),
// and the fuse's hand 1 kills exactly that. On the twin the oracle lives INSIDE the engine process —
// so a death rehearsal had nobody for hand 1 to kill. This carrier is the burn's body: it holds the
// burn's WALL TIME and is killable; the VERDICT stays with the in-process oracle, whose state
// (thermal model, RNG sequence, held offsets) must not be forked into a child (I2 — the twin is not
// softer, and a reseeded child would judge a different card).
//
// THE CONTRACT with the rehearsal launcher (`twin-assembly.mjs`):
//   exit 0        → the burn's time was served; the launcher then asks the in-process oracle.
//   exit ≠ 0      → this process was KILLED (hand 1); the launcher returns the spawnSync result
//                   verbatim, and `runBurst` fails it through its NORMAL status≠0 road — «нагрузка
//                   вышла с кодом …», exactly how a taskkill'ed furnace fails on the live path.
//
// The pidfile is the fuse's TARGET (`fuse --burn-pidfile`): written with fsync BEFORE the sleep so
// the judge can read it mid-burn, deleted on natural exit so a later trip never aims at a corpse
// (a stale pid would go to `process.kill`, which on Windows can hit a RECYCLED pid — deleting is
// cheaper than proving that never matters). It is also the profile player's cue («--after-pidfile»):
// the measured stranglings began while a burn was in flight, so the rehearsal's do too.
//
// [TESTED: 2026-08-28 · twin --selftest блок «НОСИТЕЛЬ …» — happy path served + killed path fails
//  the runBurst road; live rehearsal `--rehearse-death` kills it for real]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeSync, fsyncSync, mkdirSync, openSync, rmSync, writeSync } from 'node:fs';

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const num = (f, dflt) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt; };
  const str = (f, dflt) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
  const seconds = num('--seconds', 1);
  const pidfile = str('--pidfile', null);

  const run = async () => {
    if (pidfile) {
      mkdirSync(path.dirname(pidfile), { recursive: true });
      const fd = openSync(pidfile, 'w');
      try { writeSync(fd, `${process.pid}\n`); fsyncSync(fd); } finally { closeSync(fd); }
    }
    // Yielding sleep in one-second slices — the same pulse the twin oracle's own real-seconds burn
    // keeps (`virtual-gpu.mjs` → «SLICED INTO SECONDS»): a body that can say nothing for ten
    // seconds would be a worse model of the burn than one that breathes between slices.
    let left = seconds;
    while (left > 0) {
      const slice = Math.min(1, left);
      await new Promise((res) => setTimeout(res, Math.round(slice * 1000)));
      left -= slice;
    }
    if (pidfile) { try { rmSync(pidfile, { force: true }); } catch { /* the trip may already own it */ } }
    return 0;
  };
  run().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}
