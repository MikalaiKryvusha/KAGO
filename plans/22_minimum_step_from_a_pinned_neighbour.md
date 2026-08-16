# Plan 22 — from a pinned neighbour the descent steps at the MINIMUM step, not by the stock-depth zone

> **Created:** 2026-08-17 (the owner's word, chat 00:0x +03:00)
> **Parent:** `GOAL.md` → «🪜 СПУСК НАЧИНАЕТСЯ С УЖЕ ОТТЮНЕННОЙ СОСЕДКИ» → «Уточнение затравки»
> **Status:** 🔲 not started — the owner set it for the next session
> **Outbound:** the measured change in rungs-per-frequency belongs in `STATUS.md`

## The owner's word, verbatim

> *«можно улучшить алгоритм спуска. если у старшей частоты найден край, и от него шагнули на +10 мВ
> вверх и зафиксировали эту точку. То следующую вниз частоту можно сразу от этой точки напряжения
> прожигать минимальными шагами, а не шагать от стока. Шагать от зафиксированной соседки минимальным
> шагом вниз»*

And, sharpening it a minute later — this is the form to implement, and it is SIMPLER than the first:

> *«грубо шагать есть смысл в начале прогона на первой старшей частоте. Дальше всегда можно шагать
> минимальным шагом от соседки зафиксированной»*

**So the 25/10/5 ladder is a BOOTSTRAP, used exactly once per run.** The first, highest frequency
descends from stock by the zones — its edge really is far away and walking there at 5 mV would burn
dozens of rungs for nothing. Once its edge is found and the point pinned at «failure + 10 mV», every
frequency below starts from the pinned neighbour and steps at the minimum.

## Goal vector

**The pain.** Seeding from the tuned neighbour already exists (his word of 2026-08-15) — but the SIZE
of the step after the seed is taken from the policy zone, and the zone is keyed on **depth from
stock**. So a descent that joins the ladder at a shallow seed steps **25 mV** — the coarsest step
there is — while standing right next to a known edge. Two costs, and the first is the dangerous one:

1. **A coarse step beside a known cliff is how this project hangs machines.** `bugs/03` states the
   rule that governs here — step size is the only protection that acts BEFORE the state exists,
   because every other rollback needs a live OS. Tonight's BSOD at 2842 MHz is what that costs when
   the step lands on the wrong side.
2. **The edge is located coarsely**, so `refineEdge` has to walk back up and re-find it at 5 mV
   anyway — the coarse step buys nothing it does not then pay back.

**Where we want to be.** A descent that STARTS from a proven neighbour voltage steps at the card's
minimum grid step from the first rung. A descent that starts from stock keeps the owner's 25/10/5
ladder exactly as it is.

**Goal type:** Achieve (a new rule for one branch), with a Maintain rider: the from-stock path must
not move by a single millivolt.

**Why it is right on the physics and not only on caution.** `researches/09` §2.3: Vmin does not
decrease with frequency, which is the reason seeding is legal at all. The same fact says the next
frequency's edge sits **close** to the neighbour's — so the seed puts the descent near the end of its
road, not at the start. A 25 mV step is sized for «the edge is far»; here it is near by construction.

## Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **S1** | A seeded descent steps at the minimum | Scale: mV between consecutive rungs after a taken seed · Meter: `engine --sweep --dry-run` plan lines · Target: **every step = `config.VOLTAGE_GRID_STEP_MV`** (5 mV), grid gaps excepted and NAMED |
| **S2** | The from-stock path is untouched | Scale: the printed ladder for a frequency with no seed · Meter: byte-diff of `--dry-run` output before/after · Target: **empty diff** |
| **S3** | The first step after the seed still obeys `bugs/03` | Scale: mV from the seed to rung 1 · Meter: the existing first-step governor · Target: **≤ 25 mV**, unchanged — the new rule can only make it smaller |
| **S4** | The plan and the run remain ONE computation | Scale: rung-by-rung comparison · Meter: `engine --selftest` block «ПЛАН ОБЕЩАЕТ РОВНО ТЕ СТУПЕНИ, ЧТО ПРОЙДЁТ ПРОГОН» · Target: green, and mutation 64 still reddens it |
| **S5** | The cost is measured, not assumed | Scale: rungs per seeded frequency, before vs after · Meter: `--dry-run` over a real band · Target: **the number is reported**, whatever it is |

## Steps

- [ ] **1.** `planFrequency` gains the seed's presence as an input to the STEP rule, not only to where
      the ladder is cut. Today `rungs` (seeded) and `rungsFromStock` are two cuts of ONE ladder built
      from stock; the seeded cut must instead be BUILT at the minimum step from the seed.
- [ ] **2.** The zone table stays exactly as the owner wrote it for the from-stock path (`GOAL.md` →
      «📐 ЛЕСТНИЦА ШАГОВ СПУСКА»). No zone is edited; a branch is added.
- [ ] **3.** The dry run says which rule produced the ladder, per frequency («от затравки, минимальный
      шаг» / «от стока, зоны 25/10/5») — rail S2 makes the operator read that page before a write.
- [ ] **4.** Blocks + mutations, addressees named BEFORE the run:
      (a) make the seeded ladder use the zone step again → the S1 block reddens;
      (b) make the FROM-STOCK ladder use the minimum step → the S2 block reddens (this is the one that
          proves the change did not leak into the owner's ladder);
      (c) drop the seed's influence on the step while keeping it on the cut → S1 reddens and S3 does
          not, which is how the two rules are told apart.
      ⚠️ EXP-0075 at every site: `find(...)?.x ?? '<what was missing, in words>'`.
- [ ] **5.** Re-measure rungs-per-frequency over the real band and write the number into `STATUS.md`.

## Risks

- **(a) MEDIUM — more rungs per seeded frequency, i.e. more wall-clock.** Named honestly rather than
  hidden: the count is S5's deliverable. The offset is that the coarse step's edge had to be re-found
  at 5 mV anyway (`refineEdge`), so part of the «extra» rungs are ones we were already paying for.
- **(b) MEDIUM — the seeded and from-stock ladders stop being cuts of one array**, which is where a
  truth↔mirror pair could be born inside one function (EXP-0077, mutation 55's lesson). Both must keep
  coming out of `planFrequency` and nowhere else; S4 is the block that holds it.
- **(c) LOW — a seed rejected mid-descent** falls back to the from-stock ladder (E2-AC11). That path
  must keep the owner's zones, not inherit the minimum step.

## Links

- `GOAL.md` → «🪜 СПУСК НАЧИНАЕТСЯ С УЖЕ ОТТЮНЕННОЙ СОСЕДКИ» — the seed rule this refines, and the
  verbatim quote of this refinement.
- `GOAL.md` → «📐 ЛЕСТНИЦА ШАГОВ СПУСКА» — the 25/10/5 zones, untouched by this plan.
- `bugs/03` — step size is the only protection acting before the state exists.
- `bugs/23` — the neighbouring open defect: a hang must close the frequency and become a floor. The
  two meet in the same function and should be read together before either is coded.
- `researches/09` §2.3 — Vmin does not decrease with frequency, the physics both rules rest on.
