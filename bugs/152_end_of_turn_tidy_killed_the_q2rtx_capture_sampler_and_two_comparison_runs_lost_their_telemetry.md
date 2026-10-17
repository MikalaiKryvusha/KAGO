# Bug 152 — the end-of-turn tidy killed the Q2RTX capture's sampler, and two comparison runs lost their telemetry

**Status:** 🔧 fix pending verification · **Severity:** S2 (two runs lost: ~14 min of the owner's machine, the stock leg twice)
**Version/build:** `tools/tidy.mjs` before this fix, driver 617.42 · **When/context:** 2026-10-17 21:43 and 21:59, session 112, the
honest stock comparison (attics open), chain `cmp2-chain.mjs` launched detached (`Start-Process -WindowStyle Hidden`)
**Fixing:** this session

## Symptom

`gfx --capture --label cmp2-stock --runs 60` ran the full timedemo (678 s, FPS median 56.56, spread 0.48 %) and exited 0, but the
record carries **7 samples, 0 under load**: the sampler file ends at 21:43:32. The rerun's file ended at 21:59:49 after 13 rows, no
error row, and the `hardware-mon` process was GONE while the capture and the game lived on. Watts, temperature, fan and clock — the
four columns the comparison exists for — empty; the capture itself said nothing.

## Root cause

Both deaths fell seconds after the agent ENDED A TURN (messages at ~21:43:3x and ~21:59:4x). The `Stop` hook runs
`tools/tidy.mjs --apply`, which kills every `hardware-mon` it sees UNLESS `runInFlight` names a live run — and its `MARKERS` list knew
the engine, vf-step, the ladders, the bench and (since `bugs/150`) the mode check, but **not `graphics-load --capture` nor
`power-baseline --capture`**, the two other parents of a child sampler. Same class as `bugs/21` (tidy killed a run) and `bugs/150`
(tidy killed the mode check's sampler). Session 111's captures survived because the agent stayed in turn through them.

⚠️ **Correction of this document's first draft (21:58, never committed):** it named «one failed nvidia-smi probe killed the sampler».
That was a mechanism read from the code, not observed: the second death left no error row while the hardened loop was already in
place, which refuted it. The first draft's file name carried the false cause; renamed.

## Third death — a race inside tidy (22:25:12, the 🚀 leg, after fix 1)

With the marker in place the stock leg (22:08–22:20) kept 1388 rows across several turn ends — and the 🚀 capture still lost its
sampler one second in. `tidy.main` decides «run in flight?» on its FIRST process snapshot and picks samplers to kill from a SECOND
one; the hook fired between the chain's «CAPTURE begin» line and the capture's spawn, so snapshot 1 had no capture and snapshot 2
already had its sampler. Fix 3: `orphanSamplers(nodes, armed, isAlive)` re-asks `runInFlight` on the snapshot the samplers come
from — a sampler cannot exist before its parent, so that snapshot holds its owner. Guard: block «bugs/152 гонка», MTD3 (drop the
re-check) → red (22:28).

## Fix

1. `tools/tidy.mjs` → `MARKERS` += `/graphics-load\.mjs.*--capture\b/u`, `/power-baseline\.mjs.*--capture\b/u` — the inventory of
   `hardware-mon` spawners is in the comment (graphics-load · power-baseline · mode-validate · vf-step · fuse via engine).
2. Defence kept from the first draft (a real fragility, not this incident's cause): `hardware-mon.sampleFor` writes a failed probe as
   `{ i: -2, error, wall }` and keeps its schedule instead of dying with its reason thrown into `stdio: 'ignore'`.

**Guards:**
- `node tools/tidy.mjs --selftest` → block «bugs/152: идущий ЗАХВАТ Q2RTX…». THREAT: tidy kills a live capture's sampler.
  PROVED-AGAINST: MTD2 — the graphics-load marker line removed → that block alone red (2026-10-17 22:02). GAP: a NEW sampler parent
  must be added by hand (the inventory comment is the list). ON-REAL-PATH: NOT YET — the cmp2 run from 22:02 across the agent's turn ends.
- `node automation-engine/lib/hardware-mon.mjs --selftest` (3 blocks, `selftest:all` id `sampler`). PROVED-AGAINST: the try/catch
  removed → block «ОДНА ПЛОХАЯ ПРОБА» red (21:58). ON-REAL-PATH: NOT YET.

TWINS: searched `spawn(process.execPath, [MON` and `hardware-mon` across `automation-engine/lib` and `tools` — spawners: graphics-load,
power-baseline (both fixed here), mode-validate and vf-step (already markers), fuse (child of engine, a marker); curve-store only
imports `sampleOnce` (in-process, nothing to kill).

## Decisions made without the owner

- `[AI]` Markers rather than «a sampler with a live parent is not a leftover» (structural, but the process list carries no parent
  pid today — a larger change to a guard that has hurt twice).
- `[AI]` Rerun the whole chain from stock with 5 min airing first, so all four legs start alike.

## Links

`bugs/21` · `bugs/150` · `bugs/17` (why tidy runs at every turn end) · STATUS «Эстафета» п. 1
