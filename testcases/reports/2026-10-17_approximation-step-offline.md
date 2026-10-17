# Test run report — level 3 «the frequency» and the one-command step (plans/105 Ш2–Ш4), offline

**Created:** 2026-10-17 13:14 +03:00 · **Run by:** the agent (Claude Opus 5.5), session 108 ·
**Version/build:** working tree on top of `9ff72f2` (the Ш2–Ш4 commit of 2026-10-17)

## 1. Work

`automation-engine/lib/mode-validate.mjs` (`failureFrequency` · `curveVoltageAt` · `checkFailureFloors` · the
`failureAt` field of the check journal · `nextMargins` level 3 · `deathVerdicts` with the snapshot's voltage ·
`prepareStep` / `renderStepPlan` / `--step`), `tools/curve-proposal.mjs` (`withCheckFailures`, the check journal read
by `propose`), `config.FAILURE_ATTRIBUTION_WINDOW_MS`, against `plans/105` P105-AC3 · P105-AC4 · P105-AC5 and the
refactor rule «byte-exact golden» for the builder's output.

## 2. Contour

Offline, the owner's machine; the card was READ only (`gpu-info --json` through `profile-store.probeCard`, the
driver stamp of the dry step) — no write of any kind. Data: the committed curve document, the sweep journal and the
check journal (`runs/validate/journal.jsonl`, no failures in it). `REAL WORLD:` not applicable to «done» — nothing
reached the card, a profile or the shortcut; the step's live half is the next card evening with the owner.

## 3. Runs

| # | Moment | Command | Exit / outcome |
|---|---|---|---|
| 1 | 2026-10-17 13:07 +03:00 | `node automation-engine/lib/mode-validate.mjs --selftest` · `node tools/curve-proposal.mjs --selftest` (before the edit) | 0 · 44/44 · 35/35 |
| 2 | 2026-10-17 13:09 +03:00 | `npm run validate -- --step --mode optimised --band-margins 0,0,0,-10,-10,-10,-10 --minutes 0.5 --dry-run` | 0 · the step plan printed, nothing written |
| 3 | 2026-10-17 13:11 +03:00 | `node automation-engine/lib/mode-validate.mjs --selftest` | 0 · 54/54 |
| 4 | 2026-10-17 13:11 +03:00 | `node mutate.cjs` (scratchpad; MV12 … MV16, each applied, run, restored; `cmp` of both files against backups) | each mutation red on its own block; files restored byte-exact |
| 5 | 2026-10-17 13:12 +03:00 | `npm run check` | 0 · 101 files |
| 6 | 2026-10-17 13:12 +03:00 | `npm run selftest:all` | 0 · 55 suites, 0 red, 2852 green blocks |
| 7 | 2026-10-17 13:14 +03:00 | `git stash` → `node tools/curve-proposal.mjs --band-margins 0,0,0,-10,-10,-10,-10` → `git stash pop` → the same → `diff` | one added line, nothing else |
| 8 | 2026-10-17 13:13 +03:00 | `node --experimental-vm-modules twins141b.cjs` (scratchpad) + control on `git show 5bc3904^:…mode-validate.mjs` | 17 modules with top-level await, 2 in an import cycle; control: pre-fix form detected, current form not |

## 4. Checks

Hygiene: validate selftest 54/54 (10 new blocks) · MV12 → 2 red (own + the death block, which calls the same function) · MV13 → 1 red on target · MV14 → 1 red on target · MV15 → 2 red (own + the next step block, whose write count the leaked document shifts) · MV16 → 1 red on target · build gate 0 · battery 55/0/2852
Functional run: the step command walked on the REAL builder data and the REAL card stamp, as its operator runs it (`--dry-run`); READ: driver 616.92 · check failures under the curve 0 · raises to known failures 4 · monotone raises 67 · 2700–2800 exhausted already at −10, 2800–2900 / 2900–2950 / above 2950 «can go lower» · document name `model-bands-0-0-0-n10-n10-n10-n10-d616-92-2a11bf` (new) · the mix of `--minutes 0.5` printed as **1.1 min** · files in `curves/`, `profiles/`, `runs/validate/` untouched (git status clean there)

| Case | Status | Observation |
|---|---|---|
| P105-AC3 (negative margin only in load bands, exhaustion printed) | pass | real-data table above; `[0,0,-10,…]` refused by name in the step block |
| P105-AC4 (a failure at 2865 / 880 raises rows ≥ 2865 to ≥ 890, rows below unchanged) | pass | fixture: raised 2870 · 2885 · 2900 · 2915 · 2930, nothing below 2865; MV13 red |
| P105-AC5 (one step = one command, dry run writes nothing) | pass on fakes + real dry run | order document → snapshot → candidate on injected deps; MV15 red; the real dry run wrote nothing |
| journal carries `failureAt` | pass | `{ mhz: 2850, voltageMv: 880 }` in the sandbox journal; MV16 red |
| builder golden | pass | `diff`: one added line «отказов проверок режима … 0» |

## 5. Found

- **the 30-second smoke is not 30 seconds**: `planMix({ minutes: 0.5 })` gives 66 s by plan (nine stages, each ≥ 5 s, transitions ≥ 2 cycles; a Q2RTX pass ~11 s on top) against the owner's «смоук на 30 секунд» (25.09). Not changed here — the mix's floors (idle at both ends, transitions) are its reason to exist; named in `plans/105` as an open fork before the evening.
- `'+' + m` printed a negative margin as «+-10» in three places (the candidate's draft line, the check report, the metric line) — fixed in the same step (`signedMv`); S3, no bug document.
- standing falsehood in `STATUS.md`: «`bugs/141` — live witness obtained 27.09 (stock via CLI, code 0)». The bug's own text says the stock check passed BEFORE the fix too (a curve-less profile never imports `curve-store`), so that run is not a witness of the fix — corrected where it stood.

## 6. Traces

Session scratchpad: `mutate.cjs`, `twins141b.cjs`, `mv-prefix.mjs`, `golden_before.txt`, `golden_after.txt`, `selftest-all.log`, `check.log`; the commit of Ш2–Ш4; `plans/105` status line; `bugs/141` TWINS line.

## 7. Verdict

**pass** for P105-AC3 · AC4 · AC5 offline. Not covered: the card has never been given a step's curve; the live half of
the step (snapshot applied, check run, failure attributed on a real failure) is the card evening — `[NOT-TESTED]` there.
