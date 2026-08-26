# Plan 50 — the burn becomes ONE form of ten seconds

> **Created:** 2026-08-26 10:3x +03:00 · **Parent:** `bugs/59` · `interviews/016` (closed by the
> owner 2026-08-26) · `GOAL.md` → «🎯 ЗАЧЕМ ПРОЖИГ СУЩЕСТВУЕТ»
> **Status:** ✅ CLOSED 2026-08-26 11:0x — requirements 1–3 delivered offline; requirement 4 handed to `plans/51`.
> **[NOT-TESTED] on live hardware by design** — the change is offline-provable and a live run costs
> the owner's card; it rides along with the next sweep he authorises.
> **Outbound:** the owner's requirement 4 («predict the approach to the edge») is NOT in this plan —
> it is `plans/51` (the epic). This plan closes requirements 1–3 only, and says so out loud.

---

## Goal vector

**Pain:** a sweep rung burns for 37 s where the owner ordered 10 — three shapes run sequentially,
each 10 s. Measured 2026-08-25: six rungs, 37/37/37/37/37/38 s. On a 25-frequency band that is tens
of minutes of the owner's card per run, and the pause between shapes is the window in which the V/F
table moves (`bugs/53`, the mechanism behind `bugs/58`).

**Where we want to be:** one burn, ten seconds, loading every block reachable on the die and drawing
the card's full power envelope — the owner's own definition, and nothing beyond it.

**Goal type:** Achieve (reach a new state) + Maintain (the ten-second budget must not drift back).

## What the owner decided, and what he left to me

Quoted from `interviews/016` and the chat of 2026-08-26:

| his word | binds |
|---|---|
| *«10 секунд макс нагрузка всей видеокарты»* | Q1 = A — ten seconds is the WHOLE burn |
| *«SDC несостоятелен, пользы от него я не видел»* | Q2 = C — the SDC-confidence price is not a price |
| *«мне плевать на тип нагрузки… по технической реализации — мне, как заказчику, не важно»* | the load's IMPLEMENTATION is the agent's call (method question, EXP-0026) |
| *«не зависает»* | the stability criterion is the HANG, not calculation correctness |

**What this plan may NOT do, stated so a later session does not "improve" it:** it may not drop the
golden comparison. The owner demoted SDC from leading criterion; he did not ask to remove a free
observation, and «never fired» is a property of this silicon at today's depth, not a proof of
impossibility (`GOAL.md`, the ⚠️ clause under the new canon section).

## Acceptance criteria

Each carries Scale · Meter · Target (`REQUIREMENTS_FRAMEWORK.md`).

- **P50-AC1 — the burn is one form.** Scale: verdict-bearing shapes per rung · Meter:
  `sweepBurnLadder()` return, asserted in `engine --selftest` · Target: **1** (was 3).
- **P50-AC2 — the burn fits the owner's budget.** Scale: seconds of load per rung · Meter: a NEW
  assertion computing load seconds from the shape list × their seconds · Target: **≤ 10 s**.
- **P50-AC3 — the guard goes red on the old shape.** Scale: block colour under a mutation restoring
  the three-shape set · Meter: the mutation run · Target: **RED**, and reddening its own block alone.
- **P50-AC4 — the rung's cost drops as predicted.** Scale: seconds of LOAD per rung · Meter:
  `burnLoadSeconds(sweepBurnShape(0), 10)` against the same call on the old set · Target:
  **25 s → 10 s** of load, i.e. ~37 s → ~17 s of wall-clock at 7 s overhead.
  ⚠️ **Corrected 2026-08-26:** the first wording measured this on `npm run bench`, which is WRONG —
  the rehearsal simulates the burn rather than spending it, so its wall-clock (92.3 s) is blind to
  this change by construction. The bench's job here is the INVARIANT (AC7), not the duration.
- **P50-AC7 — the sweep still finds exactly what it found.** Scale: coverage · edges · wasted burns ·
  rows harvested · skipped frequencies · Meter: `npm run bench -- --from 2857 --to 2790`, run before
  AND after on the same band · Target: **identical on every one of the five**.
- **P50-AC5 — nothing else moved.** Scale: red sets in the battery · Meter: `npm run selftest:all`
  and `npm run traps` · Target: **0 red**, and the green-block count named after the run, not before.
- **P50-AC6 — the shipped load still satisfies requirements 1–2.** Scale: watts, median under load ·
  Meter: `runs/power/grid59-furnace-sustained-L0.json`, already captured 2026-08-26 · Target:
  **≥ 300 W** (measured 307.8). Units loaded: named from `furnace.cu`'s own header, not re-derived.

## Why `furnace/sustained@0` and not a new load

The owner left implementation to me, so the choice is mine and it is stated with its evidence:

- **Requirement 1 (all blocks):** `furnace.cu` already loads FP32 ALU, the VRAM READ path (8 GiB
  thread-owned table, warp-coalesced), the VRAM WRITE path, SFU (`__sinf`), and INT/addressing — and
  every one folds into the same checksum, so a fault in any loaded unit is visible. RT cores are out
  of scope by the owner's own boundary (`interviews/008`, variant A); CUDA cannot address them.
- **Requirement 2 (many watts):** measured 2026-08-26 — **307.8 W median of a 300 W limit**, i.e. the
  card sits ON its power ceiling for the whole window.
- **Requirement 3 (ten seconds):** one form, one window.
- **Why not `transient`:** `TRANSIENT_ON_SECONDS = 5` / `OFF = 5`, so its ten seconds contain five of
  load. It cannot satisfy «ten seconds of max load» by construction.
- **Why not `branchy`:** 198.4 W = 66 % of the limit, and its 98.5 % duty proves that is the
  computation's shape rather than idleness.

**Written so nobody re-opens it:** `furnace` was authored 2026-08-22 to the owner's earlier order
(«нужно придумать нагрузку, чтобы она предсказуемо грузила как можно больше блоков и модулей GPU,
включая VRAM»). This plan does not write a new load; it stops running two extra ones.

## What is LOST, named rather than buried

Dropping the two shapes drops **provoking shapes, not detectors** — verified in code, and it
corrects an overstatement in my own interview question:

- `queryFaults({from, to})` is a WINDOW over the Windows event log, so CRASH detection is
  independent of which workload ran. Intact.
- ЗАВИС is derived from an unclosed intent in the write-ahead journal (R15). Never involved the load.
  Intact — and it is the verdict that actually fires (13 of 750).
- The throughput half of R4 is measured on whatever runs. Intact.
- **Genuinely lost:** the di/dt TRANSITION shape (`researches/02` calls transitions the dominant Vmin
  factor) and the divergent-branching shape. Both are provocations, and both leave by the owner's
  decision with the price shown to him.

🔴 **This loss is a debt with an address, not a closed question:** if the sweep's hang rate per burn
CHANGES materially after this plan, the transition shape is the first suspect. Recorded here so the
suspicion exists before the evidence does.

## Steps

- [x] **1. `sweepBurnLadder()` returns one shape.** DONE 2026-08-26 — `engine.mjs:3891` — the attempt ladder becomes
      the single sustained form at level 0. The function already exists to be the ONE source for
      plan and run (`bugs/33`), so no second site learns the new set.
- [x] **2. ~~The dry run's header stops promising three shapes~~ — PREMISE REFUTED BY CHECKING,
      2026-08-26.** This step claimed `engine.mjs:8375` was the sweep's header reading a set the
      sweep does not run. **It is not:** that line lives in `mainBand`, i.e. the `--band` path, which
      genuinely runs `DIVERSE_SET` (`engine.mjs:8470`) — so it was correct where it stands and
      editing it would have introduced the defect, not removed one. The sweep's own line is built by
      `sweepDryRunLines()` from `sweepBurnLadder()`; the pair was already COLLAPSED by `bugs/33`, so
      step 1 moved it with no second edit. **Recorded rather than deleted** — a plan step killed by
      observation is the plan working (`PHILOSOPHY.md`: observation over conjecture).
      What was done instead: the burn line now also prints LOAD SECONDS against the owner's budget,
      because rail S2's document is where that number has to be readable BEFORE a write is authorised.
- [x] **3. Born with its guard — DONE 2026-08-26, 5 blocks. — the ten-second budget becomes an ASSERTION.** A new block computing
      load seconds per rung and demanding ≤ 10. EXP-0157's lesson executable: a per-unit budget in
      the canon that lives only in prose is invisible to every reader who sees the aggregate.
- [x] **4. Prove the guard on the broken version** — DONE 2026-08-26. — mutation restoring the three-shape ladder must
      redden step 3's block ALONE, and the intact code must redden none.
- [x] **5. Offline rehearsal before/after** — `npm run bench -- --from 2857 --to 2790`, the "before"
      taken by `git stash` and a real run rather than quoted from STATUS. **Identical on all five
      invariants:** coverage 40 %, edges 3, waste 1 of 88, 22 rows harvested, 0 frequencies skipped
      (92.3 s vs 92.4 s wall — noise). The burn got shorter; what the sweep FINDS did not move.
- [x] **6. Full battery + traps** — DONE 2026-08-26: 28 sets, 0 red, 1399 green (was 1394, +5 = exactly the new blocks); traps 65 assertions, 0 failures., counts re-measured by the commands, never edited by hand.
- [x] **7. `bugs/59` closed** 2026-08-26 with its «Decisions made without the owner» section filled.

## Verification by observation

Nothing here is verified by reading a diff. The evidence set:

| claim | observation |
|---|---|
| the burn is one form | `engine --selftest` block asserting the ladder's shape count |
| ten seconds hold | the new budget block, proven RED under mutation first |
| the rung got shorter | `npm run bench` wall-clock, before and after, same band |
| the sweep still finds the same edges | coverage and edges from the same rehearsal, before/after |
| the load meets requirements 1–2 | the capture of 2026-08-26 (307.8 W) + `furnace.cu`'s unit list |

**[NOT-TESTED] until each row above has actually run.** Live-card confirmation is NOT part of this
plan: the change is offline-provable, and a live run costs the owner's card. It rides along with the
next sweep he authorises.

## Risks, tiered (Murphy)

- **(a) Highest — the sweep's hang rate changes.** Removing the transition shape removes a
  provocation `researches/02` calls dominant. Contingency: named above as a debt with an address;
  the pulse archive (`plans/51`) is what would measure it.
- **(b) Plausible — a second site knows the old set.** `DIVERSE_SET` is still used by `--band`,
  `--search` and `vfstep`, which this plan deliberately does NOT touch (they are not the sweep).
  Contingency: step 2 makes the sweep's own header read the sweep's own ladder; the twin search in
  step 1 records every other caller.
- **(c) Trivial — the golden for `furnace@2400-8192-256-64` must exist.** It does: the capture of
  2026-08-26 returned PASS against it.

## Links

`bugs/59` · `bugs/53` (34 % idle — the same node) · `interviews/016` · `plans/51` (requirement 4) ·
`GOAL.md` → «🎯 ЗАЧЕМ ПРОЖИГ СУЩЕСТВУЕТ» · EXP-0157 (per-unit budgets) · EXP-0158 (the grid)

---

## ✅ MUTATION EVIDENCE — the guard proven on the broken version first

| mutation | what it restores | blocks reddened | blocks left green |
|---|---|---|---|
| **DA** | `sweepBurnLadder()` returns the three-shape set again | «ПРОЖИГ — ОДНА ФОРМА» (got 3, `furnace/transient@0`) · «БЮДЖЕТ» (false) · «БЮДЖЕТ НАЗВАН В ДОКУМЕНТЕ РЕЛЬСА S2» | all others, incl. the two arithmetic blocks |
| **DB** | transient counted at wall-clock instead of duty | «ПЕРЕХОДНАЯ СЧИТАЕТСЯ ПО НАГРУЗКЕ» (10 vs 5) · «краснеет на прежнем наборе» (30 vs 25) | all others |
| intact code | — | **none** | 367 of 367 |

One more thing the mutations bought, and it was not planned: writing the new burn line I broke the
regex of an OLDER guard («ПЛАН И ПРОГОН ЖГУТ ОДНИМ И ТЕМ ЖЕ», anchored on lowercase «попытка на ступень N»)
by capitalising the word when I split the sentence. **The print was fixed, not the guard** — the
behaviour it watches had not changed, so editing the assertion would have been the textbook fitting
of a test to new output.

## Decisions made without the owner

- **`furnace/sustained@0` chosen as the surviving form** — he explicitly delegated this
  (*«мне плевать на тип нагрузки»*). Chosen on the measured grid, not preference: it is the only member
  meeting requirements 1–3 at once.
- **The golden comparison was KEPT** despite his «SDC несостоятелен». He demoted it as the leading
  criterion; removing a free observation is a different act, and it is reversible in one line if he
  wants it gone. Named here so the choice is his to overturn.
- **The intensity ladder (`FURNACE_LADDER`, levels 1–3) was left standing** although the sweep now
  uses level 0 only. It is still the source of the args and its blocks still guard them; retiring it
  is a larger blast radius than this plan's scope.
- **`DIVERSE_SET` left untouched** on the `--band` / `--search` / `vfstep` paths — the owner's order
  was about the SWEEP's burn, and widening it unasked would be scope drift.
