# Bug 147 — a game hung by a driver reset held the mode check (and its rollback) for ~6 minutes

**Status:** 🔧 FIX PENDING LIVE WITNESS — fixed in code 2026-10-17 16:00 +03:00 (session 109, offline): the check's game stage
gets its own timeout sized by its demo passes; the live witness is the next check whose game stage hangs.
**Severity:** S2 — ~6 minutes of a hung display on the owner's machine under the candidate curve, 37 driver resets; the
machine survived, the rollback ran only after the agent killed the game.
**Version/build:** HEAD `e5e2990` · driver 617.42 · **When/context:** session 109, the smoke `validate --step … 0,0,0,-10,-20,-10,-10
--minutes 0.5`, the owner at the machine («подвисло надолго», «но комп жив», «квейк краш репорт сгенерил»).
**Fixing:** this session (done in code); live witness — whenever a game stage next hangs.

## Symptom

The smoke's first Q2RTX pass (one demo pass, ~11 s planned) hit a driver reset at 15:52:07 (`nvlddmkm` 153). Q2RTX did not
exit: it stayed in the driver, the screen hung for minutes, and the driver logged 37 resets (15:52:07…15:55:53). The
check's stage waited for the game, so its `finally` rollback did not run; the card read 250 W (the candidate's limit) at
15:55:55. The agent killed the game at ~15:56 (`Stop-Process -Force`; the process lingered in the task list for minutes
more); the stage ended «игра: код 1», the rollback ran and could not be confirmed («nvidia-smi не ответил … 3221225794»);
the agent's reads at 15:57 and 15:59 showed the factory state (0 offsets of 128, 300 W). Q2RTX left a crash report on screen.

Expected: a stage planned for ~16 s ends within about a minute whatever the game does, and the rollback follows.

## Steps to reproduce

1. `npm run validate -- --step --mode optimised --band-margins 0,0,0,-10,-20,-10,-10 --minutes 0.5` on driver 617.42 (the
   curve that resets the driver in the first game pass, 17.10 twice on 616.92, once on 617.42).
2. Observe: telemetry stops at the reset second, the game stays alive, the check prints no verdict for minutes.

## Root cause

`makeCardSeams.runStage` called `runTimedemo({ runs })` without `timeoutMs`, so the stage inherited
`config.Q2RTX_LAUNCH_TIMEOUT_MS` = 900 000 ms — a launch budget for the long graphics captures, not for a 1-pass smoke stage.
The driver voice is read only AFTER the mix (`runCheck` → `seams.driverEvents`), so nothing in the check saw the resets
while they were happening.

## Fix

`mode-validate.mjs`: `gameStageTimeoutMs(runs) = (runs × DEMO_PASS_S × 3 + 30) s` — from the measured game stages of the
17.10 checks (15.7 s for 1 pass, 81.5…88.8 s for 7 → ≈ 12 s a pass with the launch): 63 s for a smoke, 261 s for 7 passes.
`runTimedemo` resolves on its timeout even when the process cannot be killed, so the stage fails («таймаут») and the
rollback runs. Block «НАСТОЯЩИЕ ШВЫ: СТУПЕНЬ ИГРЫ ОГРАНИЧЕНА…»; MV20 (the timeout dropped) reddens it alone; control 59/59.

Not done (named, not hidden): a real-time stop of the mix on the driver voice (tier 2 of `driver-voice.mjs` exists for the
sweep) — that is a new contour under the moratorium (ЗАКАЗ §9); the timeout bounds the damage without it.

## Decisions made without the owner

- `[AI]` factor 3 and slack 30 s — ≥ 3× the slowest observed stage, the same multiplier the fuse took from drm/i915
  («timeout not closer than three heartbeats», R4c-progress); revisable.
- `[AI]` killed the hung Q2RTX by hand mid-run (the stage was ours, the card was under the candidate).

TWINS: searched `runTimedemo(` — callers: `mode-validate.mjs` (fixed), `graphics-load.mjs` `captureRun` (passes its own
`timeoutMs`; the long graphics capture, a 900-s budget is its design), the `gfx` CLI — no other check stage.

## Links

`runs/validate/2026-10-17T15-51-50/report.md` · `bugs/146` (the same run is its live witness) · `testcases/reports/2026-10-17_driver-617-revalidation-and-bug146.md`
