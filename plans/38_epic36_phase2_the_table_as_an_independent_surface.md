# Plan 38 — epic 36, phase 2: the card's table as an INDEPENDENT surface

> **Created:** 2026-08-24 (agent)
> **Parent:** `plans/36_EPIC_the_bench_that_can_fail.md` → phase 2 · evidence `researches/18` §6 · phase 1 closed by `plans/37`
> **Status:** 🟢 in work 2026-08-24 10:1x
> **Outbound:** unblocks phase 3 (failure simulation), which unblocks phase 4 (the fix)

---

## Goal vector

**Pain, and it is wider than the meta-plan first stated.** The bench cannot fail the way the card
fails, for **two** independent reasons found by reading the code rather than recalling it:

1. **The virtual card answers a write with our own arithmetic.** `virtual-gpu.mjs:1154` calls
   `buildRaiseAndCapVector` — the function that computed the write — and stores its output as the
   card's state. The read-back agrees with the vector because it *is* the vector.
2. **The bench does not use the real atom at all.** `trap-suite.makeSweepStepFn` is a substitute
   that returns `verdict · deliveredMhz · undervolt.after.mv` and **one** undo block. It has **no**
   `highestOfferedMhz`, **no** point-by-point verification of the write, **no** ceiling block. The
   three quantities that caught the 2026-08-24 defect do not exist on the bench.

So a green bench means «the engine composed a vector consistent with itself, and a stub agreed».

**Where we want to be.** The virtual card holds a table it owns; a write mutates that table; every
read is derived from the table. The substitute atom performs the same checks the live atom performs
and returns the same evidence fields. After this phase the bench is *capable* of disagreeing with
the engine — which is the precondition for phase 3 having anything to inject.

**Type:** Achieve. **Meta-plan anchor:** *«2 — таблица как независимая поверхность … Без этого пункт 3
неисполним: на стенде, который отвечает нашей же арифметикой, нечему отказывать»*.

## Acceptance criteria

| # | Criterion | Meter | Target |
|---|---|---|---|
| F2-AC1 | The card's read-back does not call our write arithmetic | grep over `virtual-gpu.mjs` read path | **0** calls of `buildRaiseAndCapVector` on any READ path |
| F2-AC2 | A write mutates the card's own table | `vgpu --selftest` | after a write, `readCurve()` returns base+offset per entry, computed by the CARD |
| F2-AC3 | The substitute atom reports what the live atom reports | `traps` / `bench` | `highestOfferedMhz` · `offsetMhz` · a point-by-point block · a ceiling block, all present |
| F2-AC4 | The bench's ceiling block can go RED | `vgpu --selftest` | a fixture where the table disagrees with the vector reddens it |
| F2-AC5 | Parity with the live refusals is not lost | existing parity block | still green, untouched |
| F2-AC6 | No existing block weakened or deleted | `git diff` on the suites | deletions **0** |
| F2-AC7 | Zero GPU writes | burn log | **0** |

⚠️ **F2-AC4 is the phase's real gate.** A bench that gains an independent table and is still green
everywhere has modelled our expectations a second time. The phase closes only when a deliberately
disagreeing table turns a block red.

## Steps

- [ ] **1. The card owns its table.** `state.vfTableMhz` — the card's own frequency per entry,
      seeded from the fixture's stock table. `writeRaiseAndCap` applies the vector's offsets **to
      that table** and stores both; `readCurve()` derives `{i, mhz, mv, freqKhz, microVolts}` from
      it. `points()` keeps returning the STOCK table (that is what a caller reads *before* a write),
      and the new `readCurve()` is what a caller reads *after* — two different questions, two
      methods, as on the real card (`readVfCurve` vs our stored expectation).
- [ ] **2. The seam that lets the table DISAGREE.** One injectable hook on the card —
      `applyWrite(table, offsets)` — defaulting to faithful application. Phase 3 replaces it to
      simulate a failure class. **Declared in phase 2, exercised in phase 3**, so the seam's shape is
      proven by a fixture before anything depends on it.
- [ ] **3. The substitute atom grows the live atom's evidence.** In `trap-suite.makeSweepStepFn`:
      `highestOfferedMhz` from `readCurve()`; the point-by-point block comparing requested offsets
      against what the card reports; the ceiling block asserting the post-write table offers nothing
      above the cap. Names and `proof`/`undo` flags matching the live atom's, because `engine.runRung`
      routes on those FIELDS.
- [ ] **4. Blocks + mutations** (F2-AC4, F2-AC6): a faithful card → all green; a card whose
      `applyWrite` adds a constant to one entry → the ceiling block red and `offeredAfterMhz` above
      the cap; a card that drops one entry's offset → the point-by-point block red.
      Mutations: read the curve through the vector again · drop the ceiling block · compare against
      the vector rather than the table.
- [ ] **5. The whole battery** (`npm run selftest:all`) plus `npm run bench` — the rehearsal must
      still run end to end and still not touch `curves/measured.json` or the production journal.
- [ ] **6. Judge pass on the phase's own gate**, then write `plans/39` for phase 3.

## Verification by observation

- F2-AC1: `grep -n "buildRaiseAndCapVector" automation-engine/lib/virtual-gpu.mjs` — every hit must
  be on a WRITE path or in a comment; a hit inside `readCurve` fails the criterion.
- F2-AC2–AC4: `node automation-engine/lib/virtual-gpu.mjs --selftest` ends with its summary and zero
  red; each mutation run ends with «есть расхождения» naming ONE block.
- F2-AC5: the existing «ПАРИТЕТ: оба бэкенда зовут одно решение» block still green.
- F2-AC6: `git diff` over the suites shows no removed assertion lines.
- F2-AC7: no command in this phase touches `nvapi`, `vfstep --set`, or a sweep without `--dry-run`.

## Risks

| Risk | Tier | Mitigation |
|---|---|---|
| The independent table becomes a second copy of our expectations | **(a)** | F2-AC4 demands a RED on a disagreeing table; a bench that cannot redden has not gained a surface |
| The substitute atom drifts from the live atom's field names | **(a)** | `engine.runRung` routes on `undo`/`proof` FIELDS, not names; the block asserts the fields, and phase 3's classes exercise both routes |
| The parity block silently stops meaning anything | (b) | F2-AC5 keeps it green and untouched; it guards the REFUSALS, which are not what this phase changes |
| `bench` slows down enough to stop being run | (b) | The table is an array of 128 numbers; the derivation is O(n) per read. Measure the run's wall clock before/after |
| Phase 3's seam turns out to be the wrong shape | (c) | It is declared here and exercised there; if it is wrong, phase 3 reshapes it while phase 2's blocks hold the surface |
