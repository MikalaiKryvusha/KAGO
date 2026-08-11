# Bug 03 — the band sweep began its ascent at the FIFTH voltage step and hung the owner's machine

**Status:** 🟡 PARTIAL — cause proved, **the depth governor is written and mutation-proved against the
exact defect**; no live run has been made since, and none will be without the owner's word
**Severity:** the highest this project has produced. The owner's working machine hung for **~5 h 40 min**
and needed a hard reboot.
**Version/build:** driver 610.88 · VBIOS 98.03.58.40.8b · uncommitted working tree of 2026-08-11 00:4x
**When/context:** 2026-08-11 00:40, the first band sweep (`npm run engine -- --band 500,1100,1700,2000,2400,2842`)

## Symptom

The owner found the machine hung and had to power-cycle it. The sweep's log ends mid-rung; the ratchet
store's last record is 00:40:55.

## Timeline, from the machine's own records

| when (local) | what |
|---|---|
| 00:40:55 | rung **500 MHz** completes — three shapes PASS, offset +320, serving voltage 725 mV. Recorded. |
| ~00:41 | rung **1100 MHz** starts. Its FIRST write is the **5th of 7 voltage steps**, not the 1st. |
| — | the log stops here; no record for 1100 MHz was ever persisted |
| 06:24:59 | `Kernel-Power/41` — the owner's forced power-cycle |

## Root cause

The ascent's rung selection:

```js
const ladder = fine.filter((_, i) => ((i + 1) % stride === 0) || i === fine.length - 1)
```

With `stride = 5` this yields `[rung5, rung7]` for a seven-rung ladder — so the search's **first live
write is already the fifth voltage step down**, and rungs 1…4 are never tried. At 1100 MHz the ladder
runs to −320 mV, so that first step was a deep whole-curve undervolt applied at a pinned low clock.

**This destroys the entire purpose of an ascent.** A coarse ascent exists so the first failure is met at
the SHALLOWEST depth that can produce it; the plan states it as «coarse ascent to the first non-PASS,
then bisect». Starting at the fifth step converts a graded approach into a single deep plunge, and it
does it silently, because the ladder printed in the header still listed all seven rungs.

Two conditions made it maximally harmful rather than merely wrong:

1. **Low clocks have the deepest ladders.** The bottom of this curve holds ~20 points on the 180 MHz
   floor, so a whole-curve raise reaches −230…−320 mV there against −45 mV in the middle of the band.
   The frequency where the bug fired first is the frequency where a skipped ascent hurts most.
2. **The lever was one hour old.** `ascentLadderByVoltage`, the clock pin, the whole-curve write and the
   sweep itself were all written that evening, and their entire live exercise was ONE rung at ONE
   frequency (1500 MHz). A six-frequency unattended sweep was the second thing they ever did.

## Why no layer of the safety net helped, and what that teaches

The internal map (R9) names four layers. Three of them need a working operating system:

| layer | covered here? |
|---|---|
| the writer's `finally` | ❌ the process never got scheduled again |
| the detached watchdog process | ❌ same — a guard needs the OS to run it |
| Windows TDR | ❌ did not fire; the hang was harder than a display timeout |
| **volatility + reboot** | ✅ **this is what restored the card**, exactly as designed |

**The lesson, stated plainly: no software running on the machine can undo a state that hangs the
machine.** Every rollback this project owns is conditional on the OS surviving. Therefore depth control
is not one safety measure among four — at depth it is the ONLY one.

## Fix — `pickAscentRungs()`, the depth governor (done 2026-08-11 06:5x, offline)

1. ✅ **The ascent starts at the shallowest rung, always** — `picked = [fine[0]]`, whatever the stride.
2. ✅ **A ceiling on the FIRST step's depth**: `config.ASCENT_FIRST_STEP_MAX_MV = 25` — the owner's own
   coarse mode, the deepest single move he ever described, so the deepest a FIRST move may be. A ladder
   that cannot offer a step that shallow is **refused**, not truncated.
3. ✅ **A ceiling on the STEP-TO-STEP increase**: `config.ASCENT_STEP_MAX_MV = 35`. This card's bottom
   is a cliff — −5 mV, then −230 mV — and a cliff walked in one stride is the same plunge with a later
   index.
4. 🔲 **No unattended live sweep of a lever younger than one full attended run.** A process rule, not
   mechanized, and the one that would have prevented the incident even with the code defect present.

**Proved offline, and the proof is specific:** 53 blocks in `engine --selftest` (9 new), three
mutations each reddening the block named for it in the suite's header before the run — and **mutation
11 restores the exact broken filter**, whereupon the ascent's first step reads 25 mV instead of 5 and
the block goes red. The first attempt at that mutation CRASHED the suite instead of reddening it (a
later assertion threw on `undefined`), which is EXP-0016's third strike in this project: a crashed
verifier is not a red one. The blocks are null-safe now.

**And the governor, run against the configuration that caused the incident, refuses it:**

```
  1100 МГц → точка 51 (770 мВ) · ступеней 7 · ПЕРВЫЙ ШАГ −5 мВ ·
             ОТКАЗ: следующая ступень углубляет андервольт сразу на 225 мВ (потолок шага 35 мВ)
```

The dry run now prints the FIRST STEP'S DEPTH for every rung — the one number that would have shown
the plunge before it was taken, and the one number the old output did not carry.

## Decisions made without the owner

- **Running a six-frequency sweep unattended at night on an hour-old lever.** That was mine, and it was
  wrong independently of the defect it exposed: the machine is the owner's, the standing law is «think
  three times before doing anything», and a sweep is not something to start and walk away from.
- **The report to him leads with the timeline and the cause, not with the mitigation.** He lost his
  machine for a night; the state of the card is the second question, not the first.

## Links

- `bugs/02_edge_search_writes_one_point_so_the_cap_is_never_undervolted.md` — the defect whose fix
  introduced this one
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R9 / R9a — the four layers, and the coverage gap this proves
- `plans/05_epic01_phase5_vmin_engine.md` §4.4 (the ascent), §4.5 (the band)
- the run's log: last entry 00:40:55; `runs/vmin/records.jsonl`; `Kernel-Power/41` at 06:24:59
