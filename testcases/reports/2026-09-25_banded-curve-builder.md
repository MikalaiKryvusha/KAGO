# Test run report — the curve builder with a margin per band (epic 101 Ф1 Ш1)

**Created:** 2026-09-25 01:10 +03:00 · **Run by:** the agent (Claude Opus 5.5), session 102 ·
**Version/build:** `tools/curve-proposal.mjs` at the Ш1 commit of 2026-09-25

## 1. Work

`bandedCurve` / `BANDS` / `bandOf` / `bandsRefusal` / `marginRefusal` and the keys `--margin` ·
`--band-margins` of `tools/curve-proposal.mjs`, against the acceptance criterion P102-AC1 of
`plans/102` (monotone · ≤ stock · ≤ 3090 MHz · voltages on the card's grid rounded up; three named
mutations redden their own blocks) and the refactor rule «byte-exact golden» (the trend proposal
without the new keys must print exactly what it printed before).

## 2. Contour

Offline, the owner's machine, no GPU access of any kind (the owner's word 2026-09-25: no live card
today). Data: the committed tuning-curve document and the sweep journal, read through
`loadFacts` / `readJournal` (read-only). `REAL WORLD:` not applicable — nothing reaches the card or a
profile; the curve built here has never been applied.

## 3. Runs

| # | Moment | Command | Exit / outcome |
|---|---|---|---|
| 1 | 2026-09-25 01:03 +03:00 | `node tools/curve-proposal.mjs > golden_before.txt` | 0 · 28 lines, before the edit |
| 2 | 2026-09-25 01:06 +03:00 | `node tools/curve-proposal.mjs --selftest` | 0 · 28/28 |
| 3 | 2026-09-25 01:06 +03:00 | `node mutate.mjs <scratchpad>` (MB1 · MB2 · MB3 · MB3gap) | 26/28 · 25/28 · 27/28 · 0/1 |
| 4 | 2026-09-25 01:06 +03:00 | `node tools/curve-proposal.mjs > golden_after.txt` + `cmp` | identical |
| 5 | 2026-09-25 01:06 +03:00 | `node tools/curve-proposal.mjs --margin 30` | 0 · the banded curve printed |
| 6 | 2026-09-25 01:06 +03:00 | `node tools/curve-proposal.mjs --band-margins 30,30,30` · `--margin -5` | 2 · both refused by name |
| 7 | 2026-09-25 01:07 +03:00 | `npm run check` | 0 |

## 4. Checks

Hygiene: selftest 28/28 · mutation MB1 → 2 red on target · MB2 → 3 red on target · MB3 → 1 red on target · MB3gap → named refusal, suite red · build gate 0
Functional run: the builder walked on the REAL journal and curve document with `--margin 30`, as its operator runs it; READ: the per-band table (seven bands, depth under stock 130…145 mV in 2800–2900 MHz), 0 raises to known failures, 18 monotone raises — each one located (a one-grid-step tooth of «stepped stock minus a straight line», raised upward); 2842 MHz → 910 mV against the edge's working point 875 and failure 845

| Case | Status | Observation |
|---|---|---|
| P102-AC1 invariants on the fixture | pass | 11 new blocks green |
| MB3 first shape (boundary block derived from BANDS) | fail → fixed | the mutant passed GREEN: the block compared the constant with itself; expected boundaries are now literal from `researches/39` §4 п. 2; re-run → red on target |
| MB3gap (a hole in the axis) | pass | first run: `TypeError` — no named refusal; `bandsRefusal` added, the CLI turns a throwing suite into one red block |
| golden of the trend proposal | pass | `cmp` identical |
| real-data banded curve | pass | numbers above; no row above stock or 3090 MHz |

## 5. Found

- a builder with a band hole crashed with `TypeError` instead of a named refusal — fixed in the same step (`bandsRefusal`); no bug document (found and closed before the commit, S3 by the ladder)
- the boundary block was blind to a boundary moved in the constant — fixed in the same step (literal expectations)

## 6. Traces

The scratchpad of session 102: `golden_before.txt`, `golden_after.txt`, `mutate.mjs`, `mut_MB*.mjs`
(session-local); the commit of Ш1; `plans/102` Ш1 status line.

## 7. Verdict

**pass** for P102-AC1 on the builder. What this run does NOT cover: the card has never seen this curve —
whether «trend + 30 mV» holds is the whole-mode check of Ф2.
