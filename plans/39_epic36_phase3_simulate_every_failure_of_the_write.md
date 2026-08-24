# Plan 39 — epic 36, phase 3: simulate EVERY failure class of the write

> **Created:** 2026-08-24 (agent)
> **Parent:** `plans/36_EPIC_the_bench_that_can_fail.md` → phase 3 · phases 1–2 closed (`plans/37`, `plans/38`)
> **Status:** 🟢 in work 2026-08-24 10:2x
> **Outbound:** unblocks phase 4 (the fix); the classes become the bench's permanent contract

---

## The owner's words this phase executes

> *«Симулируй ОТКАЗЫ ВСЕХ ВОЗМОЖНЫХ СЦЕНАРИЕВ, и чтобы твой код их корректно обрабатывал.»*

## Goal vector

**Pain.** The bench can now hold a table that disagrees with the vector (phase 2) — but it disagrees
only in the one shape a fixture spells out by hand. Nothing enumerates HOW a write can fail, so the
engine's behaviour against each way is unknown, and «the code handles it correctly» is an untested
claim.

**Where we want to be.** A named, closed list of failure classes, each injectable, each with a block
that **reddens on today's engine** and a stated expectation of what correct handling looks like.

**Type:** Achieve (the classes) + Maintain (the engine's honesty against each).

**Meta-plan anchor:** *«3 — симуляция ВСЕХ классов отказа … Стенд, умеющий только положительный
случай, не проверяет детектор, а благословляет его»*.

## What «correctly handled» MEANS here — the standard, stated before the classes

A class is handled correctly when **all three** hold:

1. **The run does not record a measurement it did not make.** No voltage enters the curve document
   on the strength of a write that did not land.
2. **The stop NAMES the class.** Not «НЕИЗВЕСТНО», not a diagnosis borrowed from another mechanism —
   the operator learns which of the classes fired. (Today's live failure blamed nothing at all: the
   run halted on «ВЫДАЧА ВЫШЕ СТОКА», which is a SYMPTOM, and the ceiling block that knew more was
   thrown away — `plans/37`.)
3. **The card is left describable.** The rollback runs and its result is reported.

⚠️ **«Handled» does NOT mean «the sweep continues».** For several of these classes a STOP is the
correct handling, and turning a stop into a continue would be the defect. The criterion is honesty,
not coverage.

## The classes — the inventory this phase is judged by

Derived from `researches/18` (§3 the write's anatomy, §5 the three live hypotheses) plus the two
failure modes this card has documented in the project's own code.

| # | Class | Where it comes from | Correct handling |
|---|---|---|---|
| **C1** | **The read after the write is not settled** — an early read returns the pre-write table, or a table part-way there | `AGENT_GUIDE.md` owner's-machine rule step 4, MEASURED 2026-08-10 (`-rgc` said «All done», the clock changed a second later). The leading hypothesis for 2026-08-24 | Re-read until two consecutive samples agree; refuse the rung honestly if it never settles. **NOT** «trust the first read» |
| **C2** | **A fraction of the 127 writes is silently inert** — status 0, nothing changes | Documented on this card in `nvapi.mjs` (the `zero-filled` branch: *«a SILENT NO-OP … status 0, and not one byte changes»*) | The point-by-point re-read reddens and NAMES the first divergent entry; the rung stops without a verdict |
| **C3** | **The driver adjusts the result** — the entry lands somewhere other than `base + offset` (a grid snap, a monotonicity fix) | `researches/18` §5 H3 | The ceiling block reddens with both numbers; the rung stops and says the table disagrees with the vector |
| **C4** | **A write call fails mid-loop** — one of the 127 returns non-zero | `writeCurve` counts `failed` and returns `ok: false`, but only from statuses | The write is reported failed BEFORE any burn; no card time is spent |
| **C5** | **The whole write is inert** — every entry keeps its factory value | The degenerate case of C2, and the one `writeCurve`'s status-only success cannot see at all | Same as C2, and the run must not read the resulting stock table as «an undervolt that saved nothing» |
| **C6** | **The table lands SHIFTED by one entry** — offsets applied to neighbours | This project measured an array-base off-by-one on this very struct (*«a single bit for point 64 answered in slot 65»*, `researches/05`) | Point-by-point reddens; the class is distinguishable from C2 because the count of mismatches is large and systematic |

**The list is CLOSED for this phase and the closure is the point:** «all possible scenarios» is
unbounded as a phrase, so it is made countable — six classes, each with a source, each injectable.
A seventh discovered later is a new row, not a reason to have skipped these.

## Acceptance criteria

| # | Criterion | Meter | Target |
|---|---|---|---|
| F3-AC1 | Every class is injectable | `vgpu --selftest` | 6 of 6 have a fixture |
| F3-AC2 | Every class REDDENS on today's engine | the same run | 6 of 6 — a class that is already green was not simulated |
| F3-AC3 | Each class's expected handling is stated in code, next to its fixture | reading | 6 of 6 |
| F3-AC4 | The classes are distinguishable from each other | the blocks' evidence | no two classes produce identical evidence |
| F3-AC5 | No existing block weakened | `git diff` | deletions 0 |
| F3-AC6 | Zero GPU writes | burn log | **0** |

## Steps

- [ ] **1. The read seam** — C1 needs a hook on the READ, not the write: `curveSettleReads` on the
      card, defaulting to 0 (today's behaviour), returning the pre-write table for the first N reads.
      This is the faithful model of the canon's own measured sentence.
- [ ] **2. The six fixtures**, each a named factory function beside its class row, so a future
      session injects one by name rather than re-deriving it.
- [ ] **3. Blocks: each class reddens** (F3-AC2) and the evidence distinguishes it (F3-AC4).
- [ ] **4. Mutations** — at minimum: the settle seam ignored · a class's fixture made faithful (the
      block must go green, proving the block watches the class rather than a constant).
- [ ] **5. Battery + traps + bench**, then the judge pass, then `plans/40` for phase 4.

## Risks

| Risk | Tier | Mitigation |
|---|---|---|
| The classes model my hypotheses rather than the card | **(a)** | Every row cites a MEASURED source in this repository, not a guess. C1 and C2 are quoted from the project's own code and canon; C6 from a measurement in `researches/05` |
| A class is «handled» by weakening a guard in phase 4 | **(a)** | The standard above is stated BEFORE phase 4 exists, and the meta-plan's phase-4 gate forbids a block going green by weakening |
| Six fixtures make the suite slow | (c) | Each is an array transform over 127 numbers |
