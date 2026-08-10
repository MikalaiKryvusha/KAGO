# Bug 02 — the edge search writes ONE curve point, so the clock it claims to undervolt is never undervolted

**Status:** 🟡 PARTIAL — cause proved, **the GUARD is applied and has fired on the live card**; the
search's write shape is not corrected yet (step 1 of the fix plan)
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

1. **The search must write the PROFILE'S OWN SHAPE.** `buildRaiseAndCapVector(points, delta)`
   already exists, is proved offline, and is what the shipped profile applies. Searching in the same
   shape the profile ships makes the searched quantity and the shipped quantity the same thing —
   which is the whole reason the bracket may be converted to volts at all.
2. ✅ **DONE 2026-08-11 00:2x — the engine REFUSES.** `refuseWithoutUndervolt()` reads the atom's own
   `undervolt.savedMv` (the voltage serving the cap before the write minus after, both from the
   card's curve) and, when it is not positive, **halts the search on that rung**, reports no bracket
   and no millivolts. Eight offline blocks — zero saving, negative saving, a real saving passing
   through, and the ABSENCE of the observation passing through untouched (absence is not an
   observation of zero) — plus two mutations, each reddening the block named for it before the run.
   **Then fired for real** against the very search that produced this bug: it now stops at +75 MHz
   with «эта запись НЕ удешевляет потолок … экономия 0 мВ» instead of walking seven rungs.

   **Consequence, stated plainly: `npm run engine -- --search` cannot produce a result until step 1
   lands.** That is the intended state — a search that cannot support its own claim should refuse,
   not produce a number somebody will quote.
3. **Re-run the edge search at 2842 MHz in the corrected shape**, and replace fact 28's number with
   what that run measures.
4. **Correct the canon rather than delete it:** fact 28 and EXP-0034 get a correction block; the
   original text stays, because how the project came to believe a number is part of what protects
   the next session from believing it again.

## Decisions made without the owner

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
