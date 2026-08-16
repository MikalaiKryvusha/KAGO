# Bug 16 — rungs planned against a COLD table while the card warms under its own burns

**Status:** 🔧 fix applied, live verification in progress (2026-08-16 14:1x +03:00)
**Version/build:** `main` @ `6f1ec41` · **When/context:** revealed by the FIRST full live sweep of the
project — the owner's minimal smoke run, band 2887…2820 MHz, session 29.

## Symptom

The live sweep closed **5 frequencies of 10 (50 %)** and then stopped itself:

```
КАРТА ПОДСТАВИЛА НЕ БЛИЖАЙШЕЕ ВЕРХНЕЕ: заказано 965 мВ на 2835 МГц,
ближайшее верхнее на сетке карты 970 мВ, а частоту обслуживало 975 мВ.
```

Earlier in the same run, at minute ~5, the softer form of the same thing appeared and was absorbed:

```
ПОПАЛИ ВЫШЕ: заказано 990 мВ, карта подставила ближайшее верхнее 995 мВ
```

And in the run before it — the very first rung of the very first band — the same defect appeared as an
outright halt at 2887 MHz (ordered 1045 mV, the card served 1050).

**The tell is the TIMING, and it is what identifies the cause:** the discrepancy is ZERO on the first
rung of a cold card, ONE grid step after ~5 minutes, TWO steps after ~12 minutes. It tracks time under
load, not voltage, not frequency, not step size.

## Repro (deterministic)

```
npm run engine -- --sweep --from 2887 --to 2820 --max-depth 150 --dashboard
```
Before the fix: runs ~12 minutes, closes 5 of 10, halts with «НЕ БЛИЖАЙШЕЕ ВЕРХНЕЕ».
On a cold card the first rungs match exactly — which is why this was invisible until a sweep ran long
enough to heat the card.

## Root cause

**The plan reads the card's V/F table ONCE, cold, at the start of the sweep; the card then heats itself
for twelve minutes running our own burns.**

The factory table slides along the **frequency** axis with temperature (≈ −1.7 MHz/°C — the project's
own measurement, R14b; the **voltage** axis stands still). Our lever is a per-entry FREQUENCY offset,
so «which entry ends up serving clock X» is computed as `delta = X − entry.mhz`. When `entry.mhz` moves
and `delta` does not, the clock lands on the NEXT entry up — and the rung burns a voltage nobody
ordered.

`engine.mjs:4672` read the table once:

```js
const points = nvapi.readVfCurve(nv, handle).points;   // ← once, for the whole sweep
```

and every rung of every frequency planned against that snapshot.

**Why the guard that caught it is not the bug.** The re-assertion against the card's own re-read table
(step 8 of `runRung`) did exactly its job: it noticed that the verdict belonged to a voltage nobody
asked for and refused to write it into the curve document. Without it the document would have received
five to ten rows of `frequency → voltage` claims that no burn supports — a `[TESTED]` fraud of the
exact class `TESTING_FRAMEWORK.md` exists to prevent. **The guard is the reason this defect is a
stopped run instead of a poisoned artifact.**

## The fix

`sweepRange` gains an injected seam `readPointsFn`, called **before every rung**; the CLI supplies
`() => nvapi.readVfCurve(nv, handle).points`.

**What is re-read and what deliberately is NOT — this split is the safety of the change:**

| | re-read? | why |
|---|---|---|
| the TABLE (which offset lands this clock on this voltage) | **yes, per rung** | this is the quantity that drifts |
| the LADDER of target voltages and their depths from stock | **no** — once per frequency | the `bugs/03` governors (first step ≤ 25 mV, gap ≤ 35 mV) must judge a STABLE sequence. A ladder moving with the table could deepen a step nobody ordered, and a deepened step is how this project hung the machine **twice** (`bugs/03`, `bugs/07`) |
| `pinCard` (the clock ladder) | **no** | it spawns `nvidia-smi`; doing that per rung is what turned a healthy sixth rung into НЕИЗВЕСТНО on the first live band sweep. Reading the V/F table is an in-process NVAPI call — a different mechanism with a different failure mode |

**An unreadable or short read is a STOP, never the old table.** Falling back to the snapshot would
restore the very drift the seam removes, and it would do it silently, at the moment the evidence is
missing. «НЕИЗВЕСТНО — это СТОП» is the project's standing rule and it applies here unchanged.

## Verification

- `node automation-engine/engine.mjs --selftest` → **232 blocks, 0 red** (was 229).
- **Mutations, addressees named BEFORE the run (EXP-0016):**

  | # | mutation | what went red |
  |---|---|---|
  | **AR** | plan the rung against the START table again — *the defect itself* | «ПЕРЕД СТУПЕНЬЮ ТАБЛИЦА ПЕРЕЧИТАНА, и решает ИМЕННО ОНА» |
  | **AS** | fall back to the OLD table when the fresh read fails | «НЕПРОЧИТАННАЯ ТАБЛИЦА — СТОП» + «ОБРЕЗАННАЯ ТАБЛИЦА» |
  | **AT** | accept a short read as a good one | «ОБРЕЗАННАЯ ТАБЛИЦА — ТОЖЕ НЕ ПРОЧИТАНА» |

  Intact code reddens none.
- **Live:** re-run of the same band, in progress at the time of writing.

## Two defects found in the CHECKS while proving this one

1. **EXP-0075 for the SIXTH time.** The first versions of mutations AS and AT **dropped the suite** with
   a `TypeError` instead of reddening a block — the code dereferenced `fresh.find(...)`, i.e. exactly
   what those mutations take away. Fixed with `fresh?.` so a mutated build reaches the assertion.
2. **A block that asserted «it stopped» was hollow.** Without the seam the sweep ALSO stops — downstream,
   on an empty table — so the block stayed green with the fix removed. Strengthened to assert the halt
   NAMES the unread table. This is the reason mutation AS reddens anything at all.

## Decisions made without the owner

- **Re-read per RUNG, not per frequency.** The observed failure happened on the third rung *within* one
  frequency's descent, so per-frequency would not have covered it.
- **The ladder stays frozen per frequency.** Recomputing depths from a moving table would let a step
  deepen without anyone asking; that is the one direction this project has already paid for twice.
- **Stop rather than retry on an unreadable table.** A retry loop around a card whose state we cannot
  describe is exactly what `watchdog --recover` refuses to build on.

## Links

- `GOAL.md` → «🎚 ТО ЖЕ ПРАВИЛО НА ОСИ НАПРЯЖЕНИЯ» — the owner's rule that turned the first form of
  this defect (one step of drift) from a halt into a recorded measurement.
- `bugs/03`, `bugs/07` — the two machine hangs whose governors this fix deliberately leaves untouched.
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` → **R14b** — the frequency axis moves with temperature, the
  voltage axis does not. This defect is that rule meeting a run long enough to feel it.
- EXP-0053 / EXP-0068 — the same physics, found earlier on the evidence-keying question.
