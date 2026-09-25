# Bug 141 — `npm run validate -- --mode …` hangs inside `runCheck` before the first write when started as the entry module; the same functions imported by a script run clean

**Status:** 🔧 FIX PENDING LIVE WITNESS — cause found and fixed in code 2026-09-25 ≤ 20:07 (session 104, offline; commit
`5bc3904` at 20:07:15 — ✏️ the first edition wrote «20:2x», ahead of the clock, EXP-0292 again, caught by the judge): an ESM
import cycle under top-level await (details «Root cause»); guard block + mutation MV141; the live CLI run is the next card evening
**Severity:** S2 — three live runs lost at the owner's machine (~6 min of his time, and his patience: «ну что бля, что чинишь? где прогон?»)
**Version/build:** HEAD `e2e4441` … `40e2c86` · **When/context:** card evening 2026-09-25 19:04–19:15, epic 101 Ф2, session 104

## Symptom

`node automation-engine/lib/mode-validate.mjs --mode optimised --candidate profiles/candidate-optimised.local.json --minutes 5`
(also via `npm run -s validate -- …`) prints the plan, writes the intent (`runs/validate/journal.jsonl`, seq 2/3/4),
starts the sampler — and then nothing: no apply, no stage, no verdict, forever. The card is not touched (offsets 0 of
128 by `probe-offer` at 19:09:04; power limit stays 300 W in the check's own telemetry while the candidate asks 250).
The stock smoke at 19:01 (`--mode stock-default --candidate profiles/factory.json --minutes 1`) through the SAME CLI ran
clean — the hang appeared on every `optimised` run (candidate with `curveSnapshot`).

## Forensics (observed, 2026-09-25)

- Process state during the hang (seq 4, pid 39600, 154 s up): CPU 0.000 s over 2 s; child processes — only the sampler
  (`hardware-mon.mjs --seconds 424`); `process.getActiveResourcesInfo()` = `["ProcessWrap"]` (read over the inspector:
  `process._debugProcess(pid)` + CDP `Runtime.evaluate`); `Debugger.pause` never fired (no JS runs) — the main thread is
  FREE and the event loop idles on a promise that nothing backs.
- The SAME seam called from a script that imports the module (`makeCardSeams(...).apply()`), with and without the
  sampler, from factory state and from applied state: **2.7 s · 3.0 s · 3.3 s — clean, 3/3**.
- The SAME check through the module's own exports (`planMix` · `openValidateJournal` · `makeCardSeams` · `runCheck` ·
  `writeCheckReport`) from an importing script: **no hang in 9 runs** (journal seq 5–13: 19:15 · 19:22 · 19:23 · 19:25 ·
  19:25 · 19:49 · 19:51 · 19:53 · 19:55), each reached its verdict within seconds of start; three of them (seq 6, 8, 9)
  ended `unknown` at apply by the R12 refusal (before `40e2c86`), not by a hang. ✏️ *Corrected after the judge: the first
  edition said «clean, 8 runs».*
- The candidate stayed on the card 19:11:54 → ~19:21 while `remembered-state.json` said `factory` (19:11:50): probe 3 of the
  diagnosis applied it through the seam (seams do not write the remembered state — only the CLI does), and the next
  check's rollback reset the card. Not a defect of the contract; named because the judge asked.
- Scripts (session scratchpad, reproduced here as the recipe): `run-check.mjs <mode> <candidate> <minutes>` = the CLI
  branch at `mode-validate.mjs:884–924` with `import` instead of entry-module execution, plus a timestamp per seam call.

## Hypotheses (ranked; none tested)

1. **Top-level `await` in the entry module + a dynamic `import()` inside `loadCardLib()`** (`profile-manager`,
   `profile-store`, `graphics-load`, `stress-tester`) — a module-graph cycle in which an imported module (transitively)
   imports `mode-validate.mjs` itself while it is still evaluating its top-level await: that import's promise never
   settles, and nothing backs it (exactly `ProcessWrap` only). In the importing-script path the entry module is not
   `mode-validate.mjs`, so the cycle does not deadlock. Check: `grep -n "mode-validate" automation-engine/lib/*.mjs`.
2. The CLI branch passes something different from the script (the parsed profile object is the same `JSON.parse`) — low.
3. Timing race with the sampler — refuted by probe 2/3 (sampler running, clean).

## Root cause (confirmed offline, 2026-09-25 ≈20:0x, before the 20:07:15 commit)

Hypothesis 1, exactly: `curve-store.mjs:53` imports `mode-validate.mjs` statically; the CLI of `mode-validate.mjs`
ran as TOP-LEVEL AWAIT of the entry module (`if (entry) { … await … }` at `:853`); applying a snapshot reaches
`await import('./curve-store.mjs')` (`profile-manager.mjs:712/777`) → curve-store must link `mode-validate.mjs`, whose
evaluation is still pending on that very await → deadlock. Node reports it as «Detected unsettled top-level await»,
exit 13 — but only when nothing else holds the loop; in the live check the sampler child (`ProcessWrap`) held it, so
the process HUNG instead of exiting. The stock smoke passed because `factory.json` has a null curve and never imports
curve-store. Reproduced as a 3-file control in scratch (TLA + cycle → exit 13; the same in an async IIFE → ok).

## Fix (2026-09-25, session 104)

1. The CLI body runs inside `(async () => { … })().catch(…)` — the module finishes evaluating before any seam runs.
2. Guard: `validate --selftest` block «ЦИКЛ ИМПОРТА НЕ ВЕШАЕТ КОМАНДУ…» spawns this module AS THE ENTRY with
   `--probe-import-cycle`, which makes the card path's `await import('./curve-store.mjs')` from inside the CLI.
   Mutation MV141 (CLI back to top-level await) → exactly this block red (exit 13); restored → 43/43.
3. THREAT: the live check hangs before the first write · PROVED-AGAINST: MV141 (the actual pre-fix form) ·
   GAP: the probe imports curve-store directly, not through profile-manager's apply · ON-REAL-PATH: NOT YET —
   the next card evening: `npm run validate -- --mode optimised --candidate profiles/candidate-optimised.local.json --minutes 5`
   through the CLI, apply within seconds.
4. TWINS: searched `grep -ln "^if (process.argv\[1\]" automation-engine/lib/*.mjs` for other entry CLIs with top-level
   await that sit in an import cycle — not done tonight (named debt).

## Decisions made without the owner

- `[AI]` Ran the evening through the importing script (same exported functions, same journal, same reports) instead
  of stopping to fix the CLI — the owner was at the machine; the verdicts are the instrument's, the glue is not.
- `[AI]` Closed the orphan intents seq 2, 3, 4 as `unknown` with the reason in `why` (not as deaths — no machine died;
  the next launch would otherwise ratchet a band on a non-event).

## Links

`plans/103` (Ф2) · `automation-engine/lib/mode-validate.mjs` · EXP-0294
