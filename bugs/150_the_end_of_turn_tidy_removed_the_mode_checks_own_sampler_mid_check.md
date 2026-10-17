# Bug 150 — the end-of-turn tidy removed the mode check's own sampler mid-check: a PASS seen through 3 s of telemetry

**Status:** 🔧 fixed in code 2026-10-17 17:5x (session 110); witness = the next check that outlives an agent turn
**Severity:** S2 — the check's pulse witness (telemetry gap) and its visit map were blind for almost the whole run; a verdict wider
than its observation · **Version/build:** after `140d0b1` · **When/context:** `plans/106`, two live checks on 17.10.

## Symptom

`runs/validate/2026-10-17T17-48-32/report.md` (curve `4215c7`, PASSED): «Проб 7», window 14:48:32Z…14:53:02Z — the sampler wrote
17:48:32.189…17:48:35.197 and nothing after. The previous check (`…17-40-10`) — last sample 17:41:22.761. Both moments are the
ends of the agent's turns.

## Root cause

The `Stop` hook runs `tools/tidy.mjs --apply`, which removes every `hardware-mon` sampler unless `runInFlight` sees a live run.
Its `MARKERS` list (the engine's card-writing modes, vf-step, ladders, traps, bench) was written before the whole-mode check
(epic 101, 25.09) and never learned `mode-validate.mjs`. EXP-0307 saw the effect on a hand-started sampler and named the hook;
nobody asked whether the instrument's own sampler is covered.

## Fix

`tidy.runInFlight`: marker `/mode-validate\.mjs.*--(?:candidate|step)\b/` — a real check (the `--dry-run` exclusion already
stands; offline forms carry neither flag). Block «bugs/150: идущая ПРОВЕРКА РЕЖИМА…» in `tidy --selftest` (22/22); mutation MTD1
(the marker removed) → that block red alone.

## Consequences named

- Check seq 27 (`4215c7`, PASSED): driver voice silent for the whole window, loads alive, Q2RTX twice «норма» — observed; the
  pulse gap and the visit map — NOT observed (3 s). It is re-run before the curve goes on the shortcut.
- `bugs/149` «second face» had read the 17:41:22 silence as a stall signal — corrected in place.

## Decisions made without the owner

- `[AI]` the marker keys on `--candidate|--step`, not on the file name alone (offline instruments must stay tidy-able).

## Links

`bugs/149` · EXP-0307 · `bugs/21` · `bugs/64` (the same class one contour over)
