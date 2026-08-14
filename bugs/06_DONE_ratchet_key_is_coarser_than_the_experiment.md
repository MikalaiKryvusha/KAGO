# Bug 06 — the ratchet's key is coarser than the experiment, so one run's crash bounds a different run's search

**Status:** ✅ **DONE 2026-08-14 21:01 — the write-shape quarantine landed** (`partitionByWriteShape`,
commit `a582052`), mutation-proved, and the search then reached −185 mV where it had been stopped at
−165 mV. **READ THE WARNING BELOW BEFORE REUSING THIS AS A PRECEDENT:** the fix was correct and it
still helped hang the owner's machine forty minutes later, because it removed a bound with nothing
put in its place (`bugs/07`).
**Version/build:** driver 610.88 · VBIOS 98.03.58.40.8b · found 2026-08-14 20:2x while pre-flighting
A2, twenty minutes before the owner sat down at the machine
**When/context:** `bugs/02` step 1 had just changed the search's WRITE SHAPE; the ratchet does not
know shapes exist

## ⚠️ WHAT THIS FIX TAUGHT, AND IT IS BIGGER THAN THE FIX

Removing this limit was RIGHT: a crash recorded under the single-point shape — which died at
~3400 MHz — says nothing about a capped shape that cannot reach that state. The measurement below
proves the limit was costing real depth.

**And the machine hung anyway** (`bugs/07`, 2026-08-14 21:14:42). The limit was wrong evidence, but
it was the only thing bounding how far ONE run could walk into unproven depth. Removing a wrong bound
without asking «what was this accidentally holding?» left nothing in its place, and the very next run
went 0 → −185 mV in a single pass and died on the rung after.

**The rule this leaves behind, and it generalises far past ratchets: before removing a constraint,
name what it was ACCIDENTALLY holding, and land the replacement in the SAME change.** The replacement
here is `SESSION_MAX_DEPTH_BEYOND_KNOWN_MV` plus the write-ahead mark — both in `bugs/07`, both
applied and mutation-proved. Lesson: EXP-0049.

## Symptom

`npm run vmin -- --show` on the live store:

```
  точка | попыток | лучший PASS | храповик разрешает | худшая форма
     95 |      34 |         540 |          ≤ 540 МГц | sdc_fma/sustained @ 555 (CRASH)
```

That limit was earned by the search `bugs/02` is named for — the one that raised **point 95 alone**.
Its own forensics say what actually failed there: *«raising point 95 alone makes the curve
non-monotone… the card is then free to boost toward the raised point, so the failure is a genuine
voltage failure — at ~3400 MHz, not at 2842»*.

**The new search cannot reach that state at all**: the shipped shape caps the curve at 2842 MHz, so
nothing boosts to 3400. The limit is not merely uninformative about the new experiment — it is about
a physical state the new experiment forbids by construction.

## What it costs, measured read-only on the live curve

| | rungs kept | ascent rungs | deepest reachable |
|---|---|---|---|
| no limit | 40 / 40 | 9 | **−250 mV** |
| ratchet ≤ 540 MHz | 27 / 40 | 7 | **−165 mV** |

So tonight's A2 either finds the edge above −165 mV, or ends with *«край НЕ встречен: лестница
кончилась … это НАШ предел, а не карты»* — an honest message that spends the owner's presence
without an answer.

## The second half, and it is the worse one: WHICH point is a function of TEMPERATURE

The ratchet is keyed by point INDEX (`STATUS.md` fact 37 already names this). Which point serves
2842 MHz is decided by the curve, and the curve derates with temperature (fact 18). Measured today,
same card, same command, one hour apart:

| card temperature | point serving 2842 | its voltage | ratchet applies? |
|---|---|---|---|
| 52 °C | **95** | 1045 mV | **yes — bounded to −165 mV** |
| 54 °C · and again at 20:2x | **96** | 1050 mV | **no — point 96 has no history, full −250 mV** |

**So the same command searches to two different depths depending on how warm the card happens to be
when it starts, and nothing in the output says that is what happened.** That is not a safety hole —
both branches are conservative or neutral — but it makes a measurement non-reproducible for a reason
no one would look for, which is the class EXP-0011 exists for.

## Root cause

A ratchet record answers *«this offset, at this point, produced this verdict»*. Three conditions
decide whether that answer transfers to a later run, and the key carries only one of them:

1. **the point index** — carried;
2. **the WRITE SHAPE** — not carried until 2026-08-14, and now recorded (`writeShape` became a
   required-present field with `bugs/02` step 1) but **not yet consulted** by `allowedOffset()`;
3. **the temperature the point index was resolved at** — not carried, and it is what makes the index
   itself unstable.

## Fix plan — ranked, NOT applied

1. **Partition the ratchet by write shape, exactly as `partitionByStamp` already partitions by driver
   and VBIOS.** The mechanism exists and is proven; this is one more axis on it, and the quarantined
   records stay visible as history rather than being deleted. **Recommended.**
2. **Key the search by the point's VOLTAGE rather than its index** — the physically meaningful
   identity, and immune to the temperature drift. Bigger change: the store's whole schema is keyed by
   index today, and every existing record would need a migration or a compatibility read.
3. Record the temperature beside the point index and refuse to transfer a record across more than N
   degrees. Cheapest, and the weakest — it names the symptom rather than the identity.

**Whichever lands, the guard obligation is the same shape as `bugs/05`'s:** a block proving that a
failure recorded under the SAME shape still bounds the search, beside every block that lets a
different-shape record through. A ratchet that stops bounding anything is not a fixed ratchet.

## Decisions made without the owner

- **Not fixed before A2, deliberately.** The conservative direction is the current behaviour: the
  ratchet only ever RESTRICTS, so leaving it costs depth, never safety. Loosening a safety mechanism
  fifteen minutes before a live GPU write is precisely the shape of decision `bugs/03` was born from.
- **A2 runs with the limit in force, and the report names which point and which limit applied.** If
  the run ends at our limit rather than the card's, that outcome IS the evidence this document needs.

## Links

- `automation-engine/lib/vmin-store.mjs` → `allowedOffset`, `partitionByStamp`
- `bugs/02` (the shape whose change made this visible) · `STATUS.md` facts 18 and 37
- `runs/vmin/records.jsonl` — the 34 attempts against point 95
