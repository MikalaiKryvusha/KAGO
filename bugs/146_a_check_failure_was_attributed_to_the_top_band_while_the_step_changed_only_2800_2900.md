# Bug 146 — two check failures were attributed to the top band (2985…3082 MHz) while the step had changed only 2800–2900 MHz

**Status:** 🟡 PARTIAL — items 1 and 3 done in code 2026-10-17 15:48 +03:00 (session 109) and **witnessed live 15:52**: the
smoke 0,0,0,−10,−20,−10,−10 failed again (driver reset, window 3082 MHz only) and the verdict floored the 5 rows the step
lowered, 2850…2895 MHz at 865…875 mV, besides 3082 @ 1000 (journal seq 23, `runs/validate/2026-10-17T15-51-50/report.md`).
Item 2 (correction lines for the two wrong top floors of 17.10) is NOT built. Found
live 2026-10-17 14:17–14:21 (session 108, the owner at the machine); no harm to the curve's safety (the wrong floors raise
voltage), harm to the method: level 3 raised the wrong rows twice and the third smoke failed again.
**Severity:** S2 — two driver resets (`nvlddmkm` 153, the machine recovered by itself) spent on a misread.
**Fixing:** item 2 — after the live witness of item 1 (the next descent of 2800–2900 below −10, the owner at the machine).

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

## Fix log — session 109, 2026-10-17 15:4x (offline)

INTENT: code attributes a failure to the 2-s window only (`attributeFailure` → `failureSpan`); the failing case expects the
band the step lowered to be floored; the spec (this document's fix plan item 1, `plans/105` level 3, EXP-0305 «envelope over
every candidate») says the same — no disagreement.

- **Done (items 1 and 3):** `mode-validate.mjs` — `stepDiffPoints(rows, baseRows)` (rows this check's curve serves LOWER than
  the base, each at this check's voltage) · `lastPassedSnapshot(records, mode, beforeSeq)` (the base = the snapshot of the last
  PASSED check of the same mode before this one — a smoke counts; a failed check and another mode do not) ·
  `attributeFailure({ …, baseRows })` returns window ∪ diff and `stepPoints`; wired into `runCheck` (seam `baseRows`), the real
  seams and `deathVerdicts` (base from the same journal); the report names «N строк, опущенных шагом». `FORK:` line at the site.
- **Hygiene:** `npm run validate -- --selftest` 58/58; new block «УРОВЕНЬ ЧАСТОТЫ: СТРОКИ, ОПУЩЕННЫЕ ШАГОМ…»; control copy 58/58,
  MV18 (base ignored) and MV19 (base = last check even if failed) each red on that block alone; `npm run check` green.
- **Functional run on recorded data** (the real journal, telemetry and snapshots of 17.10; scratch replay script): seq 18
  (14-17-44) and seq 19 (14-19-03) — besides the top window, now floor the 5 rows the step lowered, 2850…2895 MHz at
  865…875 mV — the band that actually changed; seq 16 (the −10 step over every band from 2700) — 46 lowered rows join, i.e. a
  failed broad step reverts everything it moved («one change at a time»). Floors already in the journal are NOT rewritten
  (the rule applies to new failures); the Optimised curve is unchanged (dry run → the same document `…-2dc644`).
- **Not done:** item 2 — a correction line in the check journal that withdraws the two wrong top floors (+5…+20 mV at
  2940…3090); until then they stay conservative. A LOAD failure still gets no attribution (band ratchet) and a death with no
  durable sample still gets none — the diff could serve both; left as is to keep the change to one rule.
- **Live witness:** the next descent of 2800–2900 below −10 with the owner at the machine — a failure there must floor
  2800–2900 whatever the window saw.

TWINS: searched `attributeFailure(` / `failureSpan(` across the tree — callers are `runCheck` and `deathVerdicts` only
(`mode-validate.mjs`), both wired; no other attribution site.

## Links

`plans/105` · `testcases/reports/2026-10-17_approximation-step-offline.md` · `runs/validate/2026-10-17T14-17-44/` ·
`runs/validate/2026-10-17T14-19-03/` · `runs/validate/2026-10-17T14-22-08/`

## Independent judge — session 109, 2026-10-17 16:4x

Six claims of the session CONFIRMED (base selection, check-voltage points, live = death path, no floor lower than before; the
recorded seq 23 holds the 5 diff points + 3082@1000, `stepPoints: 5`). Design limits it named — inputs for item 2:
- **(a)** a re-check of the SAME curve that passed once gets an empty diff (base = itself) → window only, the original bias; `--step`
  makes a new snapshot each time, so today only a `--mode --candidate` re-check hits it.
- **(b)** a failed WIDE step floors every row it lowered (seq 16-like: ~46 rows) on one failure, permanently; and the base is not
  tied to a driver. Item 2 (a correction line) is the remedy for both — withdrawing a floor needs an act, not a timeout.
- **(c)** `queryFaults` still leaves its directory when `writeFileSync`/`readNoBom` throws before cleanup (rare).
