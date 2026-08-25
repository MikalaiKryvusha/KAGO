# Plan 45 — epic 43, phase 2: the shape with the LOCK

> **Created:** 2026-08-25 10:3x (agent) · **Parent:** `plans/43_EPIC_the_ceiling_that_holds.md` → phase 2
> **Status:** 🔵 planned, not started · **Predecessor:** `plans/44` (phase 1 closed with one named gap)
> **Outbound:** unblocks phase 3 (live acceptance with the owner); closes `bugs/50`'s write-shape half

---

## Meta-plan anchor

> *«Фаза 2 — ФОРМА С ЗАМКОМ. `chooseWriteShape` учится третьей форме: поднятая кривая + замок
> верхней границей. Писатель взводит и откатывает замок в том же `finally`, что и кривую. Сухой
> прогон называет держателя.»*

## Goal vector

**Pain.** The ceiling the sweep writes is not a ceiling: measured nine times, the card runs 2–3 grid
steps above it while the write itself is provably intact. Five of eleven rungs across two live bands
lost their verdict to this, and the second band's coverage fell to 38.5 % against the first's 94.7 %.

**Where we want to be.** Above the ceiling floor the shipped shape carries a clock lock as its UPPER
BOUND alongside the raised curve, on every rung of a band; the lock is armed and rolled back on the
same path as the curve; and a rung whose ceiling is breached becomes impossible rather than merely
named. Owner's decision: `interviews/015` Q1 = A · Q2 = A (*«A, на всей полосе частот»*).

**Type:** Achieve (the third shape) + Maintain (no existing bench or engine assertion weakened).

---

## ⚠️ STEP 0 IS NOT THE LOCK, AND SKIPPING IT MAKES EVERY LATER GREEN A LIE

Phase 1 measured this and it is the reason this plan opens here rather than at `chooseWriteShape`:

| | live card (9 cases) | bench T8 today |
|---|---|---|
| where the engine stops | the ceiling proof → `ФОРМА УСТОЯЛА, КАРТА ЕЁ НЕ СОБЛЮЛА` | `runRung#delivery-above-stock` |
| `ceilingBreachHolder` | `КАРТА` | `—` (never reached) |

**Cause, established by a reverted experiment rather than by reasoning** (`plans/44` → the amended
hypothesis): the bench's stand-in atom (`trap-suite.makeSweepStepFn`) **never calls
`judgeDeliveredClock` at all.** It has no sampler, while the live ceiling proof judges sampled
`clocks.gr` under load. Its own ceiling block judges the TABLE (`offeredAfterMhz` vs cap) — and the
table is exactly what is NOT broken here.

Proven by removing the incidental stop: the trap then caught **nothing** (0 skipped, no holder). An
incidental catch and a direct check look identical while both are red.

**So until the bench judges the delivered clock, a green `npm run traps` after the lock lands would
prove a branch the live card does not walk.** That is step 1 below, and phase 2's gate depends on it.

---

## Acceptance criteria — scale · meter · target

| # | Criterion | Meter | Target |
|---|---|---|---|
| F2-AC1 | The bench judges the DELIVERED clock, like the live path | source inventory + `npm run traps` | `judgeDeliveredClock` called on the bench path; T8's holder is **`КАРТА`**, not `—` |
| F2-AC2 | T8's two pending assertions RUN and are GREEN, and `openPhase` is deleted | `npm run traps` | waiting **0**, failures **0** |
| F2-AC3 | …and they are green FROM THE LOCK, not from weakening | mutation: remove the lock from the shape | T8's assertions go **red** again |
| F2-AC4 | The lock is armed and rolled back on the curve's own path | `vfstep --selftest` + `watchdog --status` after a bench sweep | rollback steps asserted BY NAME; nothing held at rest |
| F2-AC5 | The dry run NAMES the holder before any write | `engine --sweep --dry-run` | every frequency above the floor prints «кривая + замок» |
| F2-AC6 | The lock does not drag the delivered clock DOWN | median delivered vs cap, on the bench and then live | shortfall ≤ **one grid step** |
| F2-AC7 | Nothing weakened | `npm run selftest:all` | red 0, block count does not decrease |
| F2-AC8 | Zero GPU writes during development | burn log | **0** — the live card is phase 3 |

---

## Steps

- [ ] **0. Re-read** `plans/44` → «ЧТО ФАЗА 2 ОБЯЗАНА СДЕЛАТЬ ПЕРВЫМ ШАГОМ» and `researches/11` §8.
- [ ] **1. The bench judges the delivered clock.** The stand-in atom gains what the live atom has:
      a delivered median and max, fed to the SAME `judgeDeliveredClock` (never a second copy —
      EXP-0077), with `offeredAfterMhz` passed so the holder can be named. ⚠️ **T7 is sensitive to
      this path** — it went red on the first attempt at a neighbouring change; run `npm run traps`
      after every edit, not at the end.
- [ ] **2. T8 turns from pending to running** — and must be RED at this point, for the RIGHT reason
      («держатель КАРТА»). A red here is the phase's real gate: it proves step 1 wired the judgement
      through. Only then proceed.
- [ ] **3. `chooseWriteShape` learns the third shape** — raised curve + clock lock as the upper
      bound, chosen on every rung above the ceiling floor (owner's Q2 = A: one shape per band).
      The 2026-08-14 conflict does NOT repeat: both mechanisms name the SAME frequency, the curve
      from below and the lock from above. The assertion for this shape is «never ABOVE», never
      «the clock is CONSTANT» — a capped card is legitimately free below its ceiling.
- [ ] **4. The writer arms and releases the lock** in the same `finally` as the curve; the total undo
      (R9a) already covers clocks, so this EXTENDS an existing step rather than adding a fourth kind
      of state. Assert the undo's steps BY NAME, never by a count.
- [ ] **5. The dry run names the holder** — «кривая + замок» per frequency (F2-AC5), computed by the
      same `planFrequency` the run walks, so plan and run cannot drift (`bugs/09`).
- [ ] **6. Blocks and mutations.** Addressees named before the run:
      **NA.** drop the lock from the shape → T8's assertions red (F2-AC3) ·
      **NB.** arm the lock but never release it → the undo block red (F2-AC4) ·
      **NC.** assert «constant clock» instead of «never above» → the healthy capped rung goes red,
      which is the 2026-08-14 regression and must be caught ·
      **ND.** name the holder only in prose, not in the field → F2-AC1 red.
- [ ] **7.** `npm run check` · `traps` · `selftest:all` · a bench rehearsal (`npm run bench`), then
      the judge pass, then `plans/46` for phase 3 (live acceptance).

---

## Risks

| Risk | Tier | Mitigation |
|---|---|---|
| The lock drags the delivered clock DOWN and we measure a lower frequency than we think | **(a)** | F2-AC6 measures it — bench first, then live. `researches/11` §1 says a lock BOUNDS rather than commands, but that is a vendor claim, not a measurement on this card |
| The 2026-08-14 conflict repeats (two mechanisms fighting) | **(a)** | They named DIFFERENT frequencies then; here they name the same one. Mutation NC exists to catch the wrong assertion being restored |
| A lock left on the card after a writer's death | **(a)** | R9a's total undo already covers clocks; step 4 extends it BEFORE the first write, and the drill is the proof (`watchdog --drill`) |
| The bench goes green while the live card still breaches | **(b)** | Named in `plans/44`'s honesty boundary: the bench proves the ENGINE. Phase 3 is the only thing that measures the silicon, and E43-AC5 is its number |
| T7 or another trap breaks on the shared atom path | (b) | Observed once already; step 1 says run `traps` after every edit |

---

## Decisions made without the owner

- *(filled at closing)*
