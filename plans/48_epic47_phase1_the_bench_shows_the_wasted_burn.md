# Plan 48 — epic 47, phase 1: the bench can SHOW a burn that bought nothing

> **Created:** 2026-08-25 20:2x (agent) · **Parent:** `plans/47_EPIC_the_descent_follows_the_card.md` → phase 1
> **Status:** 🔵 planned, not started
> **Outbound:** unblocks phase 2 (the descent re-targets) — which cannot be proved without this

---

## Meta-plan anchor

> *«Фаза 1 — СТЕНД УМЕЕТ ПОКАЗАТЬ ПОТЕРЮ … Сегодня ни одна ловушка не краснеет на том, что прожиг
> куплен и не дал глубины … Ворота: ловушка КРАСНАЯ на сегодняшнем движке, и краснеет она за ПОТЕРЮ,
> а не за что-то соседнее.»*

## Goal vector

**Pain.** The defect costs 36 % of the card's time (4 wasted burns of 11, measured live 2026-08-25)
and **nothing on the bench goes red for it.** T6 already makes the card deliver a frequency other
than the ordered one, and its band still closes green — because "the burn bought no new depth" is
not asserted anywhere. A fix landing on top of that is a fix nothing can redden
(`BUG_FIXING_FRAMEWORK.md` → Guards).

**Where we want to be.** A trap band where two consecutive rungs return the SAME serving voltage on
the SAME delivered frequency, an assertion that says so, and that assertion is RED on today's engine
for exactly that reason — not for a neighbouring one.

**Type:** Achieve (the assertion) + Maintain (no existing bench assertion weakened).

---

## ⚠️ THE LESSON THIS PHASE EXISTS TO OBEY

EXP-0148, paid for one day ago on this same epic's neighbour: **an incidental catch and a direct
check look identical while both are red.** Phase 1 of epic 43 built a trap that went red for the
wrong reason, and it took a reverted experiment to notice.

So this phase's gate is not «the assertion is red». It is **«the assertion is red, and removing the
mechanism that should cause it turns it green»** — proved by mutation, before phase 2 touches the
descent.

---

## Acceptance criteria — scale · meter · target

| # | Criterion | Meter | Target |
|---|---|---|---|
| F1-AC1 | The bench PRODUCES a wasted burn | rungs whose `servingMvAfter` equals the previous rung's on the same `deliveredMhz` | `npm run traps` | **≥ 2** on the trap band |
| F1-AC2 | And it is a REAL waste, not a repeat order | the ORDERED voltages of those rungs differ | the same run | ordered values **distinct**, serving value **identical** |
| F1-AC3 | The assertion is RED on today's engine | `npm run traps` | the new assertion **fails**, and its reason names the wasted burns by number |
| F1-AC4 | It is red for THE RIGHT reason | mutation: make the card deliver exactly what was ordered | the assertion goes **green** — i.e. it tracks the divergence, not the band |
| F1-AC5 | The run's summary COUNTS the waste | `npm run bench` / live summary | a line naming «прожигов без новой глубины: N» |
| F1-AC6 | Nothing existing weakened | `npm run selftest:all` | red 0, block count does not decrease |
| F1-AC7 | Zero GPU writes | burn log | **0** |

---

## Steps

- [ ] **0.** Re-read `plans/47` findings F1–F6 and EXP-0148. The trap must fail for the waste, not
      for the divergence T6 already covers.
- [ ] **1. Decide the trap card.** Prefer REUSING T6 (it already delivers below the order) over a
      ninth card — a new fiction field is a new thing to keep true. Check first whether T6's band
      actually produces two same-serving rungs; if it does, the trap is an assertion, not a card.
- [ ] **2. The counter.** The waste is a property of a SEQUENCE, not of a rung (same class as
      `bugs/42`), so it is computed where the sequence lives — over the run's harvested rungs, which
      already carry `deliveredMhz` and `servingMvAfter` (finding F3). No new measurement is needed;
      this is arithmetic over what the journal already holds.
- [ ] **3. The assertion**, worded so it cannot pass vacuously: an EMPTY list of rungs must not read
      as «no waste» (the `bugs/40` class — a heading matched without reading what is under it).
- [ ] **4. The summary line** (F1-AC5) — the operator must see the number without opening the journal.
      One line, and it prints **0** honestly when there is no waste.
- [ ] **5. Blocks and mutations.** Addressees named before the run:
      **PA.** make the trap card deliver exactly the ordered clock → the assertion goes GREEN (F1-AC4) ·
      **PB.** count waste by ORDERED voltage instead of SERVING → the assertion goes green while the
      waste is still there, which is the defect this trap exists to catch ·
      **PC.** let the empty list read as «no waste» → the vacuous-pass block reddens.
- [ ] **6.** `npm run check` · `traps` · `selftest:all`, then `plans/49` for phase 2.

---

## Risks

| Risk | Tier | Mitigation |
|---|---|---|
| The trap goes red for T6's existing divergence rather than for the waste | **(a)** | F1-AC4's mutation is exactly this discriminator; EXP-0148 is why it is a gate and not a nicety |
| A ninth trap card is added where an assertion would do | **(b)** | Step 1 checks T6 first. Every card is a fiction that must stay true to the measurement |
| The counter double-counts inherited rows as burns | **(b)** | It counts RUNGS (burns), never document rows — the run's own summary already keeps those numbers apart («закрыто ≠ доказано») |

---

## Decisions made without the owner

- *(filled at closing)*
