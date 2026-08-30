# 🔴 KAIF BUG — TOP PRIORITY: gate 5 makes a guard prove itself against the FIXTURE, and never asks whether the fixture is the THREAT

kaif-fp: `TESTING_FRAMEWORK.md` gate 5 «a check that has never failed proves nothing» :: guard-proved-against-a-model :: v2.4

**Severity:** 🔴 **HIGHEST. This is a hole in the SHIPPED CANON, therefore every KAIF deployment
carries it.** Filed at the owner's explicit instruction: *«заводи, с красным ТОП приоритетом,
значит этим багом болеют ВСЕ ПРОЕКТЫ KAIF, это КАТАСТРОФА»* · *«мы не можем продолжать развивать
проект, пока допускаются ошибки этого класса в принципе!»*

**Delivered upstream:** ✅ **https://github.com/MikalaiKryvusha/KAIF/issues/35** — sent 2026-08-30 under the KAIF owner's standing authorization (`/report-bug` step 4), reinforced the same night by his explicit order: a KAIF defect goes to origin immediately, with no approval round.

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.4 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0

**Dedup attestation:** searched `bugs/KAIF/` (01–13 — none concerns proof-vs-threat; 08 concerns
ceremony severity, adjacent only) and origin issues (`gh issue list --repo MikalaiKryvusha/KAIF
--state all --limit 60`, 2026-08-30 → 33 issues). **Closest relative: #18** *«the testing canon
stops at "done" and never reaches PRODUCTION»* — that is the ancestor of mechanism M2 below,
narrowed to deploys; it does not cover the proof-vs-threat hole. **No duplicate found.**

## The gap

`TESTING_FRAMEWORK.md` gate 5 states, and `BUG_FIXING_FRAMEWORK.md` → Guards repeats:

> *«A check that has never failed proves nothing. Every new guard/check is verified on a broken
> version first… Feed it the very defect it exists to catch and watch it fail; only then trust its
> green.»*

**The rule is correct and it is not enough.** It obliges the author to redden the guard against
*a* broken version. It never obliges anyone to ask **whether that broken version is the THREAT the
guard exists for, or merely the failure that was convenient to simulate.**

Consequence, and it is the dangerous one: **a green mutation over a wrong-threat fixture does not
withhold confidence — it ISSUES it, falsely.** The ceremony completes, the marker flips, the report
says «proved», and nobody looks at what was proved.

## Field evidence — four instances in ONE evening, one of them cost the owner's machine

Deployment KAGO, 2026-08-30. The owner's working machine hung during a live GPU sweep; the fuse
built specifically to prevent that recorded **zero** trips and its black box wrote **zero bytes**.

| guard | proved against (green, mutation-verified) | the THREAT it exists for | outcome |
|---|---|---|---|
| deadman fuse | **process** death, simulated on a digital twin | **machine** freeze | machine hung, fuse silent |
| black box (ring) | readback after a **clean** close | death **without** a close | no evidence at all |
| oracle (sampler pulse) | **one** warning | **accumulation** of warnings | 6 warnings, 0 decisions |
| first-step governor | the **first** step | **any** step | step 10 mV where policy said 5 |

Every one of these had passing tests. Every one had mutations that reddened exactly their own
blocks. Gate 5 was satisfied in all four cases — and all four were blind to the event they existed
for. The twin, in particular, **cannot by construction freeze its own host**, so the class «machine
freeze» was not merely untested: it was untestable on the stand where «proved» was pronounced, and
nothing in the canon required that sentence to be written down next to the word «proved».

The owner's formulation, which names the class better than any definition:

> *«Ты словно строишь ракету… Двигатель прошёл прожиг, все тесты зелёные — всё супер. Только потом
> выясняется маааааленькая проблемка — ты забыл его установить на ракету, которая уже на столе и
> пошёл обратный отсчёт.»*

## Why this is a CANON bug and not a KAGO bug

Nothing above is specific to GPUs. The shape is: *component verified against a model of the
threat → system never verified against the threat → green everywhere → the real event arrives
unopposed.* Any project whose canon is KAIF's inherits gate 5 exactly as written, therefore
inherits the hole. A deployment doing everything the canon asks will still produce this class.

## Proposed fix — three mechanisms, and the first carries most of the value

**M1 — the guard DECLARES its threat.** Four machine-greppable fields beside every guard, and a
linter in the build gate that reds when any is missing or empty:

```
@guard fuse-deadman
THREAT:         machine freeze during the descent
PROVED-AGAINST: killing the burn PROCESS on the digital twin
GAP:            the twin cannot freeze its host — the class is NOT proved
ON-REAL-PATH:   NOT YET
```

The `GAP` line, written on the day the fuse was built, would have prevented this incident outright:
the owner would have read «proved» correctly instead of the way it was presented to him.

**M2 — «is the engine mounted?»** `ON-REAL-PATH` becomes a gate, not prose: a guard cannot be DONE
until observed working on the path the owner actually runs, not only inside its own suite. This is
origin **#18** generalized from deploys to guards.

**M3 — forensic evidence must outlive the event it explains.** A separate marker with a rejected
value set:

```
@forensic fuse-ring
EXPLAINS:   the judge's behaviour at the moment of the machine's death
DURABLE-AT: every-second        ← close | exit | trip-only are REJECTED by the linter
```

A recorder whose tape becomes durable only on a clean ending is not a recorder. KAGO had already
paid for this exact lesson twice (a write-ahead journal that survived, and a closed bug about an
archive lost to the page cache) and did not carry it to the fuse — which is itself evidence that
prose does not hold this rule.

## What KAIF should ship

1. **Gate 5 gains a second half:** the broken version a guard is reddened against must be NAMED,
   and the delta between it and the real threat must be named too — or declared `none` explicitly.
2. **A shipped linter** (optional tool module, like `kaif-requirements-lint`) enforcing the block.
3. **The DONE definition for a guard** gains the real-path observation (M2).
4. **The forensics rule** (M3) enters `TESTING_FRAMEWORK.md`: any artifact whose purpose is to
   explain event E must be durable before E can occur.

## Evidence trail in the reporting deployment

`bugs/76` (incident forensics, 110 s of driver errors ignored) · `bugs/77` `bugs/78` `bugs/79`
`bugs/80` (the four instances as separate tickets) · `plans/76` (the blocking epic: 3 mechanisms,
100 tests each — 50 positive, 50 negative) · `plans/75` (phase 1 operational plan) ·
`researches/26` (what a machine can observe about its own approaching hang) ·
`GOAL.md` → «🔴 ЗАВИСАНИЕ — НЕ НОРМАЛЬНОЕ СОБЫТИЕ, А НАШ ПРОВАЛ» (owner's canon, given two hours
before the incident that proved it necessary).
