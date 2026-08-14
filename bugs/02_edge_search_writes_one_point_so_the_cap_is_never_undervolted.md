# Bug 02 — the edge search writes ONE curve point, so the clock it claims to undervolt is never undervolted

**Status:** 🟡 PARTIAL — cause proved · the GUARD is applied and has fired on the live card ·
**step 1 (the write shape) LANDED 2026-08-14, offline, zero GPU writes** · what remains is step 3:
re-measure the edge on the card, which needs the owner present (`GPU_TUNING_RAILS.md` S1)
**Version/build:** driver 610.88 · VBIOS 98.03.58.40.8b · `engine.mjs` as of commit `90b07dc`
**When/context:** 2026-08-11 00:0x, during `plans/05` §4.5 — the first edge search judged by the
diverse load set (§4.3, closed the same evening)

## Symptom

`npm run engine -- --search --cap 2842` ascended seven rungs, +75 … +525 MHz, every rung PASS by all
three shapes — while **the voltage serving 2842 MHz barely moved: 1045 → 1040 mV.** One grid step,
and even that step came from the card cooling between rungs rather than from anything we wrote.

That contradicts the number this project has been quoting since 2026-08-10 (STATUS fact 28,
EXP-0034): *«Vmin на 2842 МГц ≈ 885 мВ против стоковых 1040, запас ~155 мВ»*.

The same instrument had already said it once that evening, in a single-candidate run
(`npm run vfstep -- --set --point 96 --mhz 15 --cap 2842`), where the guard block went RED:

```
КРАСНЫЙ  АНДЕРВОЛЬТ на закреплённых 2842 МГц: напряжение для этой частоты УПАЛО
         обслуживала точка 96 (1050 мВ) → теперь точка 96 (1050 мВ), экономия 0 мВ
```

It was read as "a single point buys nothing, of course — the whole curve is what buys the
undervolt." That reading was correct and its consequence was missed: **the search writes single
points too.**

## Repro (deterministic, and it needs no writes at all)

Read the live curve once and do the arithmetic both ways — `voltageForClock(points, 2842)` with the
offset applied to point 95 alone, and with it applied to every point:

| what is raised | offset | point serving 2842 MHz | voltage |
|---|---|---|---|
| stock | — | 94 | **1040 mV** |
| **point 95 only** | +75 | 94 | 1040 mV |
| **point 95 only** | +300 | 94 | 1040 mV |
| **point 95 only** | +525 | 94 | 1040 mV |
| **point 95 only** | +540 | 94 | 1040 mV |
| **point 95 only** | +600 | 94 | 1040 mV |
| whole curve | +75 | 89 | 1010 mV |
| whole curve | +300 | 79 | 945 mV |
| whole curve | +525 | 70 | 890 mV |
| **whole curve** | **+540** | **69** | **885 mV** |
| whole curve | +600 | 67 | 870 mV |

Raising point 95 by ANY amount leaves the cap served by point 94 at 1040 mV — **exactly, always,
by construction.** The 885 mV figure is the whole-curve column, and the whole-curve column is not
what the atom writes.

## Forensics

`runs/vmin/records.jsonl`, the search of 2026-08-11 00:0x — every record measured, none inferred:

```
pt95 | +75  | serve95 | 1045mV | PASS   (x3 shapes)
pt95 | +375 | serve95 | 1045mV | PASS   (x3 shapes)
pt95 | +450 | serve94 | 1040mV | PASS   (x3 shapes)
pt95 | +525 | serve94 | 1040mV | PASS   (x3 shapes)
```

The ten records of the FIRST search (2026-08-10 20:5x) carry `servingMv: null` — that search ran
before the engine learned to read the serving voltage at all (the field defect named in EXP-0034).
So **no run has ever observed the cap's voltage falling during a search.** The 885 mV was computed
off-card, on a curve raised by arithmetic that the atom does not perform.

Why the offsets nonetheless produced a real CRASH at +600: raising point 95 alone makes the curve
non-monotone — point 95 offers 2857 + 540 = 3397 MHz at 1045 mV while its neighbour 96 offers
2872 MHz at 1050 mV. The card is then free to boost toward the raised point, so the failure is a
genuine voltage failure — **at ~3400 MHz, not at 2842.** Real physics, wrong frequency, and the
report named the wrong one.

## Root cause

`vf-step.runStep()` writes `targets = allPoints ? every point : [point]`, and
`engine.searchEdge()` never passes `allPoints`. So the search's control variable is *"how far can
ONE curve point be pushed"*, while every conclusion drawn from it is phrased about *"the voltage
serving the capped clock"*. Those are different quantities, and on this curve they are not even
correlated: one of them does not move.

This is EXP-0034's own lesson biting a second time from the other side. That entry says *«the unit
you SEARCH in is rarely the unit your CONCLUSION is about — convert before believing»*, and the
conversion was duly performed — but it was performed **on a hypothetical curve** rather than on the
one the card was actually carrying. A conversion is only honest when its input is observed.

## What this invalidates, stated plainly

- **STATUS fact 28 / EXP-0034 — «Vmin на 2842 МГц ≈ 885 мВ, запас ~155 мВ» — is NOT supported.**
  The card never ran at 885 mV in that experiment. What was measured is that point 95 fails
  somewhere between +540 and +555 MHz of offset, and the probabilistic-edge observation (both ends
  of the bracket landing on one voltage) was itself computed on the hypothetical curve, so it is
  unsupported too.
- **The ratchet's stored history is still valid as history** — those offsets really were tried at
  that point and really did produce those verdicts. It is the VOLTAGE INTERPRETATION that goes.
- **Nothing measured with `vfstep --shape` is affected.** That path uses
  `buildRaiseAndCapVector()`, which raises the whole curve — facts 15, 24, 25, 27 stand.
- **§4.3 (the diverse set) is unaffected and worked correctly.** It judged what it was given; what
  it was given was the wrong write shape.

## Fix plan

**Not applied tonight, on purpose:** the correction is a design decision inside §4.4/§4.5, not a
one-line patch, and it is the kind of choice this project has already paid for making at speed.

1. ✅ **DONE 2026-08-14 18:0x — the search writes the PROFILE'S OWN SHAPE, and zero GPU writes were
   made to get there.** `vf-step.runStep` gained `writeShape: 'point' | 'uniform' | 'raise-and-cap'`;
   `engine.searchEdge` carries it to every rung; both CLI paths (`--search` and `--band`) now request
   it. `null` keeps the legacy mapping from `allPoints`, so no existing caller changed behaviour
   silently. Read-back became POINT-BY-POINT against the requested vector: the old check counted how
   many points carried ONE scalar, which is the only question a uniform raise can be asked, and it
   would have passed while the curve held something else entirely.

   **Three things the work found, each computed rather than assumed:**

   **(a) Switching shapes moves NO number this project has already measured.** A point serves clock C
   iff `F_i + Δ ≥ C`, and the ceiling does not touch that condition — so the serving point and its
   millivolts are IDENTICAL under a uniform raise and under the shipped vector, for every clock ≤ cap.
   Checked at caps 2842 / 2400 / 2172 against Δ = 45 / 180 / 300: same point index, same voltage, nine
   of nine. What the shape changes is what the card may do ABOVE the tested clock — the uniform raise
   leaves the tail offering `F_top + Δ`, which is a state no shipped profile has, and it is exactly
   the mechanism that made this bug's own run fail at ~3400 MHz while reporting a number about 2842.

   **(b) 🔴 THE CEILING HAS A FLOOR, AND `Silent Cold` IS BELOW IT.** A ceiling is enforced by pushing
   the points above it DOWN, and that push is an offset like any other — bounded by the hardware's
   published −1000…+1000 MHz. So no cap below `topMhz − 1000` can be held by the curve at all. On the
   live card, 2026-08-14: **top 3157 MHz → floor 2157 MHz.** `Silent Cold` was read off the thermal
   ladder at **2100 MHz** (STATUS fact 34+36), which is **57 MHz below that floor** — the shipped
   curve alone leaves the card able to reach 2157. The leak is independent of the raise (identical at
   Δ = 0 / 45 / 180 / 300 / 540): it is the push-DOWN that runs out of range, not the raise.
   `buildRaiseAndCapVector` now returns `capEnforced` / `capLeakMhz` / `lowestEnforceableCapMhz`, and
   `vf-step.chooseWriteShape` turns them into the rule **a ceiling must be HELD BY SOMETHING** — the
   curve where it can, the measurement's clock pin where it cannot, and a REFUSAL where neither does.
   Proved live read-only: `--search --cap 2842` plans the shipped shape; `--search --cap 2100`
   refuses, naming the floor and the leak.

   **(c) The remedy for (b) is documented but NOT YET OBSERVED on this card.** `nvidia-smi -h` states
   `-lgc  --lock-gpu-clocks=<minGpuClock,maxGpuClock>` — **a RANGE**, and `1500,1500` is its example
   of the degenerate case. This project retired `-lgc` as a profile mechanism because
   `ladder.candidateProfile()` uses `{min: mhz, max: mhz}`, which is a PIN — the card can move neither
   up nor down, so it would hold the locked clock at idle. A range with `min` at the idle floor and
   `max` at the cap is a CEILING, not a pin, and would satisfy the owner's requirement that the card
   stay free to clock down. **This is read from the vendor's help text, not measured here** — it is a
   candidate for phase 6, and it needs one live run with the owner present before anyone relies on it.

   **What this step does NOT deliver:** a number. No live write was made, so the edge of this card is
   still unmeasured — that is step 3.

2. ✅ **DONE 2026-08-11 00:2x — the engine REFUSES.** `refuseWithoutUndervolt()` reads the atom's own
   `undervolt.savedMv` (the voltage serving the cap before the write minus after, both from the
   card's curve) and, when it is not positive, **halts the search on that rung**, reports no bracket
   and no millivolts. Eight offline blocks — zero saving, negative saving, a real saving passing
   through, and the ABSENCE of the observation passing through untouched (absence is not an
   observation of zero) — plus two mutations, each reddening the block named for it before the run.
   **Then fired for real** against the very search that produced this bug: it now stops at +75 MHz
   with «эта запись НЕ удешевляет потолок … экономия 0 мВ» instead of walking seven rungs.

   ~~**Consequence, stated plainly: `npm run engine -- --search` cannot produce a result until step 1
   lands.**~~ **LIFTED 2026-08-14 with step 1.** The guard stays exactly as it was — what changed is
   that the write it judges now cheapens the cap by construction, so the guard should pass instead of
   halting. It remains the thing that would catch the shape regressing.
3. **Re-run the edge search at 2842 MHz in the corrected shape**, and replace fact 28's number with
   what that run measures. **Owner-gated (S1): live curve writes happen only with him at the machine.**
   The first command is `npm run engine -- --search --cap 2842 --dry-run` (already run, read-only:
   shipped shape, first step −5 mV, 9 rungs), then the same without `--dry-run`.
4. **Correct the canon rather than delete it:** fact 28 and EXP-0034 get a correction block; the
   original text stays, because how the project came to believe a number is part of what protects
   the next session from believing it again.

## TWINS — every other place the curve is written (searched 2026-08-14)

`TWINS: searched writeCurve( · writeVfOffset( · zeroCurve( across automation-engine/ and tools/ —
found 4 other sites that raise the whole curve with NO ceiling:`

| Site | What it writes | Same defect? |
|---|---|---|
| `vf-step.mjs` → `runAscent`, its own `writeAll` (~line 851) | uniform raise, no cap, no pin | **NOT this bug** (it raises the whole curve, so the cap's voltage does fall) but it is the OTHER half of the family: with no ceiling the raise is taken as SPEED, not watts (`researches/02` §6.2, EXP-0031). `--ascend` is a legacy probe; **listed, not fixed** |
| `vf-step.mjs` → `measureUndervolt`, its own `writeAll` (~line 986) | uniform raise under a clock LOCK | legal as a measurement — the lock holds the ceiling and the run says so. **Listed** |
| `vf-step.mjs` → `runShapeExperiment` (~line 1231) | `buildRaiseAndCapVector` | already the shipped shape — this is where the shape was born |
| `watchdog.mjs` (~line 290) | zeroes every point | a rollback, and total by design (R9) |

Two of these are the duplication `plans/05` §4.1(a) named: **four open-coded 127-point loops still
exist** where one writer should be. That debt is unchanged by this fix and stays open in §4.1(a).

## Decisions made without the owner

- **`writeShape` is a NAMED parameter, not a silent upgrade of `allPoints`.** A boolean cannot carry
  three shapes, and quietly redefining what `allPoints: true` writes would change the behaviour of a
  module that writes to the owner's card without anyone asking for it. `null` keeps every existing
  caller exactly as it was.
- **The chooser DECIDES and the vector COMPUTES — deliberately two functions.** `chooseWriteShape`
  takes the already-built vector rather than the curve, so the arithmetic has one author and the two
  offline suites cannot end up testing each other's job.
- **The engine does not pick its own shape.** It carries what the caller chose, and the caller prints
  the choice per rung. A search that picked silently would hide which of the two holders produced its
  number — the very class this bug is named for.
- **`writeShape` became a REQUIRED-PRESENT field of the ratchet record** (`vmin-store`), nullable but
  not omittable. Every record of the search that produced this bug was well-formed and useless for
  catching it, because none said what had been written.
- **`--search` also gained the VOLTAGE ladder, which was not asked for and is not optional.**
  Switching that path to a whole-curve write while it still walked a fixed-MHz ladder would have put
  a real undervolt under a depth governor that cannot see millivolts — `pickAscentRungs` says so
  itself on an ungraded ladder — and that is precisely the arrangement of `bugs/03`.
- **Listed the four twin sites instead of rewriting them.** They are live-write paths; changing them
  today would ship edits no offline suite can judge, on the day the search itself changed shape.

- **Filed as research-only rather than fixed immediately.** The symptom is not a hazard: every run
  rolled back cleanly, the card is at factory state, and no profile was ever shipped from these
  numbers. What the defect damages is a CLAIM, and a claim is corrected by measuring again, in a
  shape decided with a clear head.
- **The verification was done with a read-only probe** rather than by writing the whole curve to see
  what happens. The arithmetic on the card's own curve answers the question completely and costs the
  owner's machine nothing.

## Links

- `plans/05_epic01_phase5_vmin_engine.md` §4.1 (the vector), §4.4 (the search), §4.5 (the three caps)
- `STATUS.md` fact 28 · EXP-0034 · `researches/02` §6.2 (the raise must be capped, and it must be a
  raise of the CURVE)
- `runs/vmin/records.jsonl` — the evidence, all of it
