# Bug 146 — two check failures were attributed to the top band (2985…3082 MHz) while the step had changed only 2800–2900 MHz

**Status:** 🔴 OPEN — found live 2026-10-17 14:17–14:21 (session 108, the owner at the machine); no harm to the curve's safety
(the wrong floors raise voltage), harm to the method: level 3 raised the wrong rows twice and the third smoke failed again.
**Severity:** S2 — two driver resets (`nvlddmkm` 153, the machine recovered by itself) spent on a misread.
**Fixing:** next session, offline, before the next descent below −10 in 2800–2900.

## Symptom

`npm run validate -- --step --mode optimised --band-margins 0,0,0,-10,-20,-10,-10 --minutes 0.5`, twice:
- 14:17:43 — СБОЙ: telemetry gap 10 893 ms at 11:18:02Z, 153 ×7 + 14; attributed to **2985…3082 MHz at 925…975 mV**;
- 14:19:02 (after level 3 raised the top by those floors) — СБОЙ: gap 6 608 ms, 153 ×6; attributed to **3082 MHz at 990 mV** —
  a voltage ABOVE the «trend + 0» curve (970 mV) that passed 4-minute checks today and on 25.09.
Both in the FIRST Q2RTX pass (~20 s in). The only difference against the passed smoke of 14:15:58 was 2800–2900 MHz: −10 → −20 mV
(rows on the 610.88 failure floors, «exhausted»). Control: stock smoke 14:19:47 PASSED (driver healthy). Decisive run: the same
curve with 2800–2900 back at −10 (and the wrong top floors kept) — 4-minute check PASSED 14:22:08 (0 events, gap 530 ms).

## Root cause (hypothesis, strong; not yet proven by a dedicated run)

The 2-second window before the failing moment saw where the card WAS (the top — Q2RTX's light frames run 3000+ MHz), not where
it FAILED. Under a game the clock swings between 2800–2900 and 3000+ faster than the 500-ms sampler resolves; a failure caused
by 2800–2900 lands in a window that holds only top samples. `failureSpan` is honest about the window and blind to that.

## Fix plan

1. Attribution must include what the STEP CHANGED: a failure right after a step that lowered band B is attributed to B's rows
   too (the step's own diff), not only to the window — the cheapest strong signal we have.
2. The two wrong floors (the verdicts of runs 14-17-44 and 14-19-03 in `runs/validate/journal.jsonl`) need a correction line the builder
   honours — the check journal has none yet (judge F3); until then they stay as conservative floors (+5…+20 mV at the top).
3. Block + mutation: a step that lowered 2800–2900 and failed with a top-only window floors 2800–2900.

## Links

`plans/105` · `testcases/reports/2026-10-17_approximation-step-offline.md` · `runs/validate/2026-10-17T14-17-44/` ·
`runs/validate/2026-10-17T14-19-03/` · `runs/validate/2026-10-17T14-22-08/`
