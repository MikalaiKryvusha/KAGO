# Plan 15 — Epic 02 / Phase 2: the sweep engine — pin, descend, judge, survive the reboot

> **Created:** 2026-08-15 17:0x +03:00 (agent, on the owner's question *«планы написаны реализации?»* —
> phase 2 is written ahead of its gate because his five refinements of the same day determine it
> completely; the waiver is §0)
> **Parent:** `plans/13_EPIC_edge_finder_full_range.md` — phase 2. Evidence base: `researches/09`
> (search space, the step arithmetic, the industry's crash-resume shape) · `ideas/03` steps 6–14 ·
> `GOAL.md` (five owner decisions of 2026-08-15) · `plans/14` (the document this engine writes into)
> **Status:** 🔲 open · **entry gate is phase 1's closure and is NOT waived for execution** (§0) ·
> **ZERO GPU WRITES for the whole phase** — every line here is proved on injected backends
> **Outbound:** the generalized first-step governor → `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` and
> `GPU_TUNING_RAILS.md` §0 (rail S2 gains its evidence clause) · the journal → the phase-3 operational
> plan, whose number is assigned when it is written (16 and 17 went to epic 03, the virtual bench) ·
> closure → `plans/13` §4
>
> **Debugging surface, added 2026-08-15 after this plan was written:** the owner ordered a virtual GPU
> bench BEFORE this phase is implemented (`plans/16_EPIC_virtual_gpu_bench.md`). Six of the eleven
> criteria below cannot be exercised without it (`researches/10` §3.3) — F2-AC3, AC4, AC5, AC6, AC7,
> AC8. This plan does not change; what changes is that its criteria stop needing the owner's machine.

---

## 0. Why this plan exists ahead of its gate, and the waiver it carries

`plans/13` §3 says operational plans are written one phase ahead — *«план фазы N+1 рождается на
закрытии фазы N»* — and phase 1 is not closed. The owner asked for the implementation plans directly,
and phase 2 is the one phase where writing early costs nothing: its entire design was fixed by his own
decisions of 2026-08-15 (the step ladder, the seeding, the burn duration, the presence model, the
accepted hang). Nothing in it waits on a measurement.

| Condition | State | Disposition |
|---|---|---|
| Phase 1 closed (`plans/14_DONE`) | ✅ **closed 2026-08-15 21:2x** | The waiver has EXPIRED because the condition came true, which is the only honest way for a waiver to end. The curve document and both grids exist and validate against the live card |
| `/fable-judge` over phase 1 | ✅ **passed 2026-08-15 21:2x** — VERIFIED WITH CAVEATS | Recorded in `plans/14_DONE` §9. Execution of the steps below is now unblocked |

**Phases 3–5 stay skeletons on purpose.** They are live runs, and what they should do next depends on
what the sweep MEASURES — the count of seeding fallbacks, where the lever wall actually lands, how many
reboots the card costs. A plan written for them today would be fiction by the time it is read.

> 🔤 **TERMINOLOGY, SETTLED BY THE OWNER 2026-08-15** (`GOAL.md` → «🔤 ТОЧЕК С НОМЕРАМИ НЕ
> СУЩЕСТВУЕТ»): *«Нет никаких "точка 120". Есть только частоты по сетке частот»*. This plan speaks of
> FREQUENCIES and the voltages that serve them. The V/F table's 127 entries are an implementation
> detail of the WRITE path (`curve-store.offsetsFor`), never a unit of search or of reporting.

## 1. Goal vector

**The pain.** The owner's algorithm exists as eighteen steps and a set of refinements; the code that
executes them does not. Today's `searchEdge` searches ONE clock held by a curve cap, which cannot go
below 2157 MHz — more than half the range is unreachable — persists its verdict AFTER the step, so a
hang erases the very rung that caused it, and has no notion of a sweep at all.

**Where we want to be.** One command walks the card's own frequency ladder from the top down; at each
frequency it PINS the card, descends the voltage grid on the owner's step ladder, judges every rung
with the full oracle, refines a coarse failure to 5 mV, parks the point at V_fail + 10 mV, and writes
its verdict into the curve document — **and if the machine dies mid-rung, the next launch knows exactly
which rung killed it and carries on.**

**Goal types.** *Achieve* — `sweepRange()` and its journal. *Maintain* — R1 (one writer), S2 (the
shallowest step first, now generalized rather than weakened), R9/R10a (armed watchdog, rollback as a
list), R13 (nothing above the card's own maximum), and the rule that the plan prints the ladder the run
will walk (`bugs/09`). *Avoid* — a rung reported without a burn, and a `LEVER-LIMITED` result dressed
up as an edge.

## 2. Entry gate

> ✅ **THE GATE IS OPEN — checked 2026-08-15 21:2x, and it was NOT open before that.** Phase 1 was
> built on 17:28 and left unclosed; sessions 22 and 23 went on to epic 03 over it. Session 24 ran the
> judge, fixed its three findings and closed `plans/14_DONE` — the row-by-row evidence is that plan's
> §9, and it is the artifact this table points at rather than a claim repeated here.

| Gate | Required state | Evidence |
|---|---|---|
| Phase 1 closed | curve document + both grids exist and validate | ✅ `--show`: 389 rows · `--verify` against the LIVE card: **127 voltage rungs, 0 disagreements** |
| `/fable-judge` over phase 1 | passed | ✅ **VERIFIED WITH CAVEATS**, recorded in `plans/14_DONE` §9. Three caveats, all documentation, all repaired |
| `npm run check` green | 33+ files, 0 failures | ✅ **39 files, 0 failed**, plus 233 text files scanned for encoding corruption, 0 corrupt |
| Watchdog unarmed | no record held at rest | ✅ «СТОРОЖ НЕ ВЗВЕДЁН» |
| Goldens valid | every stamp matches the live card | 🔲 **checked at the moment it first matters** — this phase writes nothing and loads nothing, so a stale golden cannot poison it; the check belongs to the first step that runs a burn (phase 3). Stated rather than silently skipped |

## 3. Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **F2-AC1** | The step ladder is the owner's, computed rather than remembered, and it never steps deeper than his policy allows. | Scale: rungs whose depth exceeds the policy for their zone · Meter: `engine --selftest` over the ladder function · **Target: 0. Zones 25 / 10 / 5 mV by depth from stock; the mapping to the NON-UNIFORM grid always rounds toward the SHALLOWER point** |
| **F2-AC2** | The first-step governor is GENERALIZED, not weakened — with no evidence it behaves exactly as today. | Scale: refusals produced on a no-evidence descent, before vs. after the change · Meter: a selftest block replaying today's fixtures against the new function · **Target: identical refusals, and a mutation that re-bases the depth on stock-only must redden its own block** |
| **F2-AC3** | Seeding is PROVED at every frequency it is used, and its failure is a finding rather than a stumble. | Scale: seeded frequencies whose first burn was not PASS and which still continued seeded · Meter: the sweep journal · **Target: 0 — every such case cancels the seed, restarts the descent from stock, and prints the frequency and both voltages** |
| **F2-AC4** | A hang loses nothing and is attributed to the exact rung. | Scale: rungs whose intent is on disk before the card is touched · Meter: kill the process mid-rung, re-launch, read the report · **Target: 100 %; the re-launch names the killed rung, marks it `ЗАВИС`, and resumes at the next one** |
| **F2-AC5** | Two reboots on the SAME rung stop the sweep instead of looping it. | Scale: consecutive crash attributions at one (point, voltage) · Meter: a journal fixture carrying two · **Target: the sweep refuses to start that rung a third time, names it, and exits non-zero** |
| **F2-AC6** | A coarse-rung failure is refined at 5 mV before the margin is applied. | Scale: closed edges whose failure voltage was found on a rung coarser than 5 mV · Meter: the curve document's `provenBy` · **Target: 0 — the shipped value is always `V_fail(5 mV) + 10 mV`, and the refinement burns are in the journal** |
| **F2-AC7** | The three point verdicts are distinguishable and none can masquerade as another. | Scale: points closed as `edge-found` while the descent actually ended on the ±1000 MHz lever · Meter: a fixture where the lever runs out before any failure · **Target: 0 — that fixture must close as `lever-limited`, and the refusal names both the lever and the last passing voltage** |
| **F2-AC8** | The dry run prints the ladder the real run will walk. | Scale: difference between the planned rung list and the rungs a scripted run actually visits · Meter: a selftest block comparing the two, computed by ONE function (`bugs/09`, EXP-0052) · **Target: 0 differing rungs, and the first-step depth printed** |
| **F2-AC9** | Under a pin, whoever holds the ceiling is NAMED, and R13 judges what the card can actually reach. | Scale: sweep configurations where the curve offers a clock above 3090 with no named holder · Meter: the pre-write check · **Target: 0 — every rung states «потолок держит: закрепление» or «кривая», and refuses if neither can** |
| **F2-AC10** | Zero GPU writes in this phase. | Scale: device writes performed · Meter: every command in §7 is offline; `watchdog --status` unarmed before and after · **Target: 0** |
| **F2-AC11** | Every new guard has been proved able to fail. | Scale: mutations reddening their OWN named block · Meter: the suites · **Target: 100 %, addressees named BEFORE the run (EXP-0016)** |

## 4. Steps

### 4.1 — The owner's step ladder as a pure function ✅ **DONE 2026-08-15 21:4x**

*Anchor: `GOAL.md` → «📐 ЛЕСТНИЦА ШАГОВ СПУСКА» — 25 mV over the first 100 below stock, 10 mV from 100
to 150, 5 mV deeper.*

- [x] `descentLadder({ voltageGridMv, stockVoltageMv, availableDepthMv, zones })` → the ordered list of
      rungs the descent will visit, each carrying `{mv, depthMv, stepMv, zoneStepMv, forcedByGrid}`.
      **The signature is keyed by VOLTAGE, not by a point index** — this plan was written before the
      owner retired numbered points, and `servingIndexAtStock` was that vocabulary.
- [x] **The grid is non-uniform (5 mV ×94, 10 mV ×32), so the policy is mapped onto real rungs:** the
      next rung is **the deepest grid point whose voltage is still ≥ (current − policyStep)**. Rounding
      always lands on the shallower point.
- [x] `config.mjs` gains `DESCENT_ZONES` with the owner's quote above it.
      `FAST_DESCENT_FLOOR_MV` is **retired BY SCOPE, not deleted** — see §8, the deletion would have
      broken the only search this project has ever run on the live card, which §5 keeps standing.
- [x] Blocks: the zone boundaries (and the boundary read STRICTLY at depth exactly 100) · a grid that
      cannot express the policy step · a depth shallower than one grid step · the lever wall ·
      degenerate inputs · both card-level rung counts. **14 blocks; `engine --selftest` 76 → 90.**
- [x] Mutation-proved with four mutations (addressees 24–27 in the suite header), and the header
      records what they actually reddened rather than the tidy version.

**Verification — RUN, and it CORRECTS this plan's own number.** The ladder for **2400 MHz is 7 rungs**
as predicted, landing exactly on the lever wall. The ladder for **2842 MHz is 24, not the 28** this
line inherited from `researches/09` §4.1: that table computes the idealized
`min(d,100)/25 + clamp(d−100,0,50)/10 + max(0,d−150)/5` on a grid fine enough to express every step,
while the real grid has a 10 mV gap every 25 mV, and in the 5 mV zone one such gap swallows a rung.
Same cause at 3090 MHz: **42 rungs, not 49.** The plan's own rule applies — «a disagreement means the
function or the table is wrong» — and here it is the **table**: the grid is measured, the formula is
an idealization. **The direction matters and is good news: the sweep is CHEAPER than estimated.**
`researches/09` §4.1 is corrected in place.

### 4.2 — Seeding, and the governor that had to grow up ✅ **DONE 2026-08-15 22:4x** *(two items carried to their own steps, named below)*

*Anchor: `GOAL.md` → «🪜 СПУСК НАЧИНАЕТСЯ С УЖЕ ОТТЮНЕННОЙ СОСЕДКИ»; the owner: «очень редко — выше,
почти не бывает такого».*

- [x] `seedFor({ frequencyMhz, curveDoc })` → the PASSING voltage of the **nearest already-tuned HIGHER**
      frequency, or `null` (the first frequency, or every neighbour above closed as `lever-limited` /
      still `stock`). Two directions are enforced, not assumed: **only from above** (Vmin does not
      decrease with frequency, so a lower frequency seeding a higher one is the unsafe direction) and
      **only from PASSED evidence** — `lever-limited` is deliberately absent from the proven set,
      because there OUR lever ran out and its voltage says nothing about silicon.
- [x] **`pickAscentRungs` gained its evidence base** as `provenSavedMv` (undervolt depth already proven,
      0 = stock = no evidence). Rule 2 now measures the first step from proven ground.
      **The identity is proved, not claimed:** mutation 28 re-bases the governor on stock only and
      **reddens the generalization block while leaving «БЕЗ УЛИК сторож ведёт себя ровно как сегодня»
      GREEN** — which is exactly what F2-AC2 asks for. Rule 3 (the rung-to-rung cliff of `bugs/03`) is
      untouched by the generalization, and a block asserts that too.
- [ ] ~~The seed's first burn runs the full rung machinery of 4.3~~ → **carried onward: §4.3 built the
      machinery (`runRung`, 2026-08-15 23:0x), §4.5 is what WIRES it to the seed**, because the wiring
      is the descent loop and that loop does not exist yet. What exists now is the DECISION the burn
      feeds (`seedOutcome`) and the burn it will feed from; joining them here would be a fixture
      pretending to be a sweep.
- [x] **Not-PASS on the seed → the seed is CANCELLED** (`seedOutcome`): the descent restarts from stock
      on §4.1's ladder, proven ground drops back to zero, and the event prints both frequencies, both
      voltages and the verdict — **as a finding about the silicon, not a stumble in the run**.
      `НЕИЗВЕСТНО` cancels it too: the rule is «not PASS», not «failed».
- [ ] ~~The report ends with the seeding scoreboard~~ → **carried to §4.5**, which is what builds the
      report. The per-frequency records it counts are produced here.

**Verification — RUN.** 14 blocks (`engine --selftest` 92 → 106), and four mutations with their
addressees named in the suite header beforehand: a `lever-limited` neighbour seeding · a seed taken
from BELOW · the governor re-based on stock only · the sweep continuing seeded after a rejected seed.
Each reddened its named block; the intact code reddened none; **and mutation 28's second expectation —
that the identity block STAYS green — is the one that proves the guard was generalized rather than
loosened.**

### 4.3 — One rung: pin the clock, make the target point serve it, judge, roll back ✅ **DONE 2026-08-15 23:0x**

*Anchor: `ideas/03` steps 7–9; internal map R1 (only `profile-manager` touches the card), R9 (armed
watchdog), R10a (the rollback is a list).*

The arithmetic, and it is why a pin makes the whole range reachable:

```
to make point j serve the pinned clock C:  Δ = C − F_j   (a UNIFORM raise)
```

Every point below j has a lower stock frequency, so after a uniform Δ none of them reaches C — **point
j becomes the serving point by construction**, with no cap needed to arrange it.

> **STEP 4.3 IS COMPLETE — the paper half 2026-08-15 23:0x, the live half the same evening. The live
> half is a COMPOSER (`runRung`) and not a second writer: it decides, and everything dangerous happens
> inside `vf-step.runStep`, which phase 5 already built and proved.**

- [x] **`planRung({ points, clockMhz, voltageMv })` — the rung's arithmetic, pure.** Δ = C − F_V, the
      lever's ±1000 MHz bound, and the choice of which entry ends up serving. **`servingAfterRaise`
      evaluates the card's OWN rule (lowest voltage among those reaching C) on the raised curve**, so
      "serving" has one definition shared with `vf-step.voltageForClock` rather than two.
- [x] **«By construction» is COMPUTED, not asserted.** The plan's own argument — every lower-voltage
      entry has a lower stock frequency, so the chosen one becomes the serving one automatically — is
      true of a MONOTONE table and this project has already paid for treating such an argument as a
      proof (R12, EXP-0057). A non-monotone table would hand the load to a different voltage while
      every read-back agreed. `planRung` therefore refuses and names BOTH entries. **Checked on paper
      first because a refusal that costs nothing beats one that costs a watchdog lease.**
- [x] **The lever wall is its own outcome (`leverLimited`), never an ordinary refusal** — the seed of
      the `lever-limited` verdict (`plans/13` E2-AC2). Mutation 33 proves it cannot be flattened.
- [x] **The LIVE orchestration** — `runRung`, and it COMPOSES rather than re-implements. The atom
      (`vf-step.runStep`, injected as `runStepFn`) owns the whole dangerous half: the watchdog armed
      BEFORE the write, the write through `profile-manager`/`nvapi` (R1 — the engine never writes), the
      point-by-point read-back, the pin, the separate-process sampler, the oracle, and `runUndo` as a
      LIST (R10a). What `runRung` adds is the DECISION: plan on paper against the live table, refuse
      before touching the card, and then judge what came back.
- [x] **The re-assertion, and it is the one thing nothing else did.** `planRung` proves the ordered
      voltage WOULD serve the clock; only the card says it DID. `runRung` compares the ordered voltage
      against `undervolt.after` — `voltageForClock` on the table read back FROM THE CARD — and a
      mismatch makes the rung **`void`: not a PASS, not an edge, not a data point**, naming both
      voltages. A missing observation is void too: absence of observation is not observation of
      agreement (the same rule as mutation 10 of this suite).
- [x] **And a rung whose ROLLBACK failed is never reported as passed**, whatever the oracle said — the
      next rung would begin on a card nobody can describe, which is the state `watchdog --recover`
      exists to forbid building on. `runUndo` now marks its blocks `undo: true`, so this is a FIELD
      test rather than a match on block names (a name match would be a truth↔mirror pair created on
      purpose, and a block reworded once would silence it).
- [x] **F2-AC9, the ceiling's holder, named per rung.** `chooseWriteShape` is CALLED with the real
      vector and its answer is OBEYED in both directions — including «the curve holds it, and pinning
      here would be harmful», which is the live lesson «ONE HOLDER, NEVER TWO» (2026-08-14: a capped
      curve and a pin fought over one frequency and three PASSing shapes came back НЕИЗВЕСТНО). Above
      the curve's cap floor the holder is `кривая` and **no pin reaches the atom**; below it the holder
      is `закрепление частоты` and the raise is uniform.
- [x] The short probe judges with ONE shape — `sdc_fma --transient`, the shape voltage noise lives in
      (`researches/02` §2) — for the owner's 10 s (`config.SWEEP_PROBE_SECONDS`, his number from
      `ideas/03` step 9). The probe is TAKEN FROM `DIVERSE_SET` rather than re-declared, so the probe
      and the set cannot describe one shape two ways. **The EDGE, once bracketed, is re-judged by the
      full three-shape set before it is written to the document** (fact 37): 10 s is the owner's search
      price, the set is what makes the number trustworthy.
- [x] `UNKNOWN` is a STOP, never progress — the rule the ascent already obeys (EXP-0011). So is a void,
      and so is a dirty rollback: three different reasons, three different words, one behaviour.

**Verification — RUN, 2026-08-15 23:0x.** 22 blocks on an injected atom and an injected vector builder
(`engine --selftest` **115 → 137**), zero GPU writes. Six mutations, addressees named in the suite
header BEFORE the run (EXP-0016), each reddening its own named block while the intact code reddened
none — the baseline printed 0 red and its completion line, which is the second half EXP-0071 paid for:

| # | Mutation | Red | Block it reddened |
|---|---|---|---|
| 34 | call the atom even when the paper plan refused | 1 | «бумажный отказ означает, что КАРТА НЕ ТРОНУТА» (got `["void", 1, true]` — the atom ran) |
| 35 | flatten the lever wall into an ordinary refusal | 1 | «предел рычага доезжает до исхода ступени» |
| 36 | drop the re-assertion (trust the plan, not the card) | 2 | «ступень, измерившая ЧУЖОЕ напряжение, — НЕ PASS» (got `["passed", 995]`) + its naming block |
| 37 | map `НЕИЗВЕСТНО` to a failure instead of a stop | 1 | «НЕИЗВЕСТНО — это СТОП, а не отказ и не край» |
| 38 | pin even when the CURVE holds the ceiling | 1 | «ОДИН ДЕРЖАТЕЛЬ, НИКОГДА ДВА» (got `pinMhz = 2842`) |
| 39 | let a dirty rollback still report PASS | 2 | «грязный откат отменяет PASS» + «называет, какой шаг не отработал» |

### 4.4 — The write-ahead journal: a hang becomes a verdict 🔲

*Anchor: `GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»; `researches/09` §2.4 (the industry's
crash-then-read-back shape).*

- [ ] `runs/sweep/journal.jsonl` — **append-only, one line per rung, flushed and `fsync`ed BEFORE the
      card is touched**: `{seq, at, frequencyMhz, targetPoint, voltageMv, depthMv, zone, seeded,
      holder, state: 'intent'}`. A second line with `state: 'verdict'` closes it.
- [ ] **On launch, an `intent` with no `verdict` IS the answer:** that rung is marked `ЗАВИС` — a
      first-class verdict beside `SDC` and `CRASH` — attributed to its exact (point, voltage), and the
      sweep continues from the next rung. This is the owner's step 12, executed.
- [ ] **Resume is a COMMAND, not a scheduled task** (`GOAL.md` → «🧑‍💻 ЧЕЛОВЕК ЗА МАШИНОЙ»): the same
      `--sweep` invocation sees an unfinished journal and continues instead of restarting. Nothing is
      installed into the boot path — the phase that would have needed it is deleted.
- [ ] **F2-AC5, the only emergency stop left:** two consecutive `ЗАВИС` at the SAME (point, voltage) →
      refuse to start it a third time, name it, exit non-zero. That is a fault, not an edge.
- [ ] `watchdog --recover` runs first when a record is found at rest — never begin on a state nobody
      can describe.

**Verification:** the drill of F2-AC4 — kill the process between the intent write and the verdict write
(injected), re-launch, assert the killed rung is named and marked; plus a two-crash fixture for F2-AC5.

### 4.5 — The sweep: the loop, and the three verdicts 🔲

*Anchor: `ideas/03` steps 6, 13, 14; `plans/13` E2-AC2.*

- [ ] `sweepRange({ fromMhz, toMhz, bandLabel })` — walks the card's frequency ladder TOP-DOWN,
      searching for the BOUNDARIES where the serving voltage changes rather than burning every
      frequency separately (`plans/13` §8.1: 389 frequencies over 127 voltage rungs, so neighbours
      share a voltage — same table, one fifth the cost, and every one of the 389 still carries a
      verdict in the document).
- [ ] Per frequency: seed (4.2) → descend (4.1 + 4.3) → on first non-PASS refine (4.6) → close the
      point with one of **three verdicts**, each with its own reason string:
      `edge-found` · `lever-limited` (the ±1000 MHz lever ran out before the card did) ·
      `clock-floor` (nothing to search).
- [ ] Every closed point is written to the curve document **before the next frequency starts**, through
      `curve-store`'s atomic save (`plans/14` §4.2).
- [ ] `--band <from>,<to>` runs one band; bands are independent and each is a self-contained sitting —
      this is what makes ≈1.7 h fit the owner's evening in pieces.
- [ ] The final report: coverage (closed / total), verdict histogram, the seeding scoreboard, reboots,
      and **the wall time actually spent** against the estimate — an estimate never checked is a number
      that drifts.

### 4.6 — The refinement: a coarse failure is not an edge 🔲

*Anchor: the owner — «Если нашли шагами по 5 мВ точку отказа, то от неё вверх поднимаемся на два шага».*

> 🔴 **THE RULE IS BINDING AND IT IS NOT A DESIGN QUESTION — the owner said so again, 2026-08-15
> 21:5x, after this plan's §8 recorded it as an open one:**
>
> > *«ТАМ, ГДЕ ОТКАЗ — ЗНАЧИТ МЫ УЖЕ У КРАЯ!!!! А У КРАЯ ХОДИМ ВСЕГДА ПО 5 мВ. … Найти отказ нужно с
> > шагом 5 мВ — это строгое правило! Если падало, когда ходили шагами отличающимися от 5 мВ — это
> > значит мы у края. Переходим на шаг 5 мВ. Точно находим край этим шагом. И от него на 10 мВ
> > поднимаемся вверх.»*
>
> **Two objects, never to be confused.** A failure on a coarse rung is a SIGNAL THAT THE EDGE IS NEAR —
> it is not an edge, it is never written to the curve document as one, and the margin is never applied
> to it. The descent drops to 5 mV, finds the failure again with that step, and **that** failure is the
> edge. `V_ship = V_fail(5 mV) + 10 mV`. There is nothing to decide here and nothing to ask.
>
> **The coarse ladder of §4.1 therefore has exactly one job: to reach the neighbourhood of the edge
> cheaply.** It never produces a number that ships. That is what makes the 25 mV zone safe to want.
>
> **The one hardware limit, reported and not negotiated:** in 32 of this card's 126 grid intervals the
> two neighbouring voltages differ by 10 mV, so no 5 mV step exists there to take — the card offers
> nothing between them. The refinement then walks the card's minimum available step, and the run SAYS
> that the edge at that frequency is located only to the card's own resolution. The margin added is
> still 10 mV: `config.marginAboveFailureMv()` now THROWS if a caller hands it a local gap instead of
> the card's minimum step, so the «+20 mV» misreading cannot be written by accident.

- [ ] On a non-PASS at a rung coarser than 5 mV: **return to the last PASSING point and walk down in
      5 mV grid steps** until the failure reproduces. Each of those rungs is one shallow step from a
      proven-safe voltage, so S2 holds throughout.
- [ ] The refined failure is the one the margin applies to: `V_ship = V_fail + 2 grid steps`
      (`config.marginAboveFailureMv()`), and the record names the policy (`plans/13` E2-AC4).
- [ ] **If the failure does NOT reproduce during refinement**, that is recorded as such — a
      probabilistic edge, which this card has shown before (fact 28's history). The point closes at the
      coarse failure's last PASS + margin, and the report says the edge was not reproducible.

### 4.7 — `--dry-run` prints the ladder the run will walk 🔲

*Anchor: `bugs/09`, EXP-0052 — «граница, добавленная в ПРОГОН, не добавлена, пока её не печатает ПЛАН».*

- [ ] One computation feeds both the plan and the run (`descentLadder`), so they cannot disagree.
- [ ] The dry run prints, per frequency: the seed and where it came from · the rung count · **the depth
      of the FIRST step** · the zones crossed · the ceiling's holder · the lever wall if it binds.
- [ ] A selftest block drives a scripted run and asserts its visited rungs equal the printed plan
      (F2-AC8).

### 4.8 — Selftests and mutations 🔲

- [ ] `engine --selftest` grows the blocks of §4.1–§4.7 on injected backends: an injected card, an
      injected oracle, an injected clock, an injected journal directory (sandboxed; a block asserts
      `runs/sweep/` did not grow — EXP-0025).
- [ ] **Mutations, addressees named in the suite header BEFORE the run:** re-base the governor on stock
      only · drop the seed proof · continue seeded after a rejected seed · write the intent AFTER the
      card write · skip the 5 mV refinement · report `lever-limited` as `edge-found` · let the plan and
      the run compute the ladder separately · drop the two-crash stop · round the grid mapping toward
      the DEEPER point.

### 4.9 — The canon records what changed 🔲

- [ ] `GPU_TUNING_RAILS.md` §0 — rail **S2 gains its evidence clause**: the first step's depth is
      measured from what evidence proves, not from stock; with no evidence the two are the same.
- [ ] `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` — the journal as the sweep's memory; the rule that a
      ceiling under a pin has a NAMED holder (extends R11).
- [ ] `AGENT_GUIDE.md` — the harness table gains `npm run engine -- --sweep`; the truth↔mirror registry
      gains the row **planned ladder ↔ walked ladder**, checked by the F2-AC8 block.
- [ ] `STATUS.md` and `plans/13` §4 ticked.

## 5. What phase 2 does NOT do

- **It does not touch the card.** Not one write. The live sweep is phase 3 and needs the owner present.
- **It does not qualify anything long.** The 60 s pass is phase 4.
- **It does not assemble profiles.** Phase 5.
- **It does not remove today's `--search` / `--band`.** They stay until the sweep has run live once;
  removing the only proven path before its replacement is proven is how a project loses both.
- **It does not install anything into the boot path** — deleted by the owner's decision, and staying
  deleted.

## 6. Risks

**(a) Highest.**

| # | Risk | Defence |
|---|---|---|
| R1 | The generalized governor quietly weakens the `bugs/03` protection | F2-AC2: with no evidence the behaviour must be BYTE-identical to today, proved by replaying today's fixtures plus a mutation that re-bases on stock |
| R2 | A uniform raise under a pin leaves the curve offering clocks above the card's maximum, and the pin is the only thing holding it | F2-AC9: the holder is named per rung; where neither curve nor pin can hold it, the rung is refused. The undo zeroes the WHOLE curve regardless (R9's «total, not differential») |
| R3 | The journal's intent is written but not durable, so the hang still erases it | `fsync` before the card write, asserted by an injected-fs block; the drill (F2-AC4) is what makes it believable |
| R4 | Seeding walks past a real edge on a non-monotone point | F2-AC3 — the seed is PROVED at every frequency, and its rejection is loud |

**(b) Plausible.**

| # | Risk | Contingency |
|---|---|---|
| R5 | The card refuses a pin at some ladder rungs | The pin is verified under load before the burn counts (`ladder-descent.verifyLockUnderLoad`, already built); a rung whose pin does not hold is reported, not averaged |
| R6 | The curve slides with temperature and the serving point changes mid-descent | Every record carries its temperature; the serving-point assertion (4.3) fires rather than silently testing the wrong point |
| R7 | 74 points × the journal makes the report unreadable | The report is a summary; the journal is the evidence. `--show` renders the curve document, not the journal |

## 7. Verification map — every command offline (F2-AC10)

| Step | The observation that closes it |
|---|---|
| 4.1 | `engine --selftest` — the 2842 MHz ladder is 28 rungs, the 2400 MHz ladder is 7, mapping rounds shallow |
| 4.2 | the no-evidence identity block green; the `seedRejected` fixture prints its line; both mutation-proved |
| 4.3 | ✅ **22 blocks, `engine --selftest` 115 → 137, zero writes.** The paper refusal keeps the atom uncalled; the re-assertion voids a PASS taken on a foreign voltage; a dirty rollback voids a PASS; the holder is named on every rung and no pin reaches the atom under a curve-held ceiling. Mutations 34–39, each reddening its own block |
| 4.4 | the kill drill — re-launch names the killed rung and marks it `ЗАВИС`; the two-crash fixture stops the sweep |
| 4.5 | a scripted full-band run on injected everything closes every point with one of three verdicts |
| 4.6 | a coarse failure fixture closes at `V_fail(5 mV) + 10 mV`, with the refinement burns in the journal |
| 4.7 | planned rungs == walked rungs, computed once |
| phase | `npm run watchdog -- --status` unarmed before and after · `npm run check` green |

## 8. Decisions made without the owner

- **The sweep enumerates serving points, not all 389 ladder frequencies** — same table, one fifth the
  cost (`plans/13` §8.1, arithmetic in `researches/09` §3.2).
- **The short probe uses ONE shape, the edge uses THREE.** His 10 s is the search price and the
  transient shape is the one most likely to catch a bad rung; but a number that goes into the shipped
  document is judged by the set, because a single shape's verdict is not a point's verdict (fact 37).
- **The pin, not a cap, holds the region under test** — a cap cannot go below 2157 MHz, a pin holds any
  ladder rung. The pin is an INSTRUMENT and never ships.
- **The grid mapping rounds toward the shallower point.** The owner's policy is a ceiling on step
  depth; where the grid cannot express it exactly, undershooting is obedience and overshooting is not.
- **`FAST_DESCENT_FLOOR_MV` is retired in the same change that adds `DESCENT_ZONES`**, with the reason
  in the comment. Two policies for one decision is how a session picks the wrong one.

**Added while EXECUTING §4.1 (2026-08-15 21:4x):**

- **The retirement of `FAST_DESCENT_FLOOR_MV` is BY SCOPE, not by deletion — this reverses the letter
  of §4.1 above, and the reason is §5 of this same plan.** The constant is wired into
  `composeAscentLadder` and the `--band` / `--search` path, which §5 explicitly keeps standing until
  the sweep has run live once. Deleting it would have changed the behaviour of the ONLY search ever
  run on the owner's card, in the same commit that added its untested replacement. So its comment now
  says «superseded, no new caller reads this», the sweep reads `DESCENT_ZONES` exclusively, and the
  two go out together when the sweep replaces the band path on the card. **Two policies do coexist for
  now, and the boundary between them is written down rather than left to be guessed.**
- **A grid that cannot express the policy step forces a deeper rung, and the rung SAYS SO
  (`forcedByGrid`).** The plan's rule — «rounding always toward the shallower point» — has no answer
  where the local gap (10 mV) already exceeds the policy step (5 mV): the only shallower option is
  standing still, which abandons the search. Taking the next grid point is forced by the hardware, it
  stays far inside the `bugs/03` governor (10 ≪ 35 mV), and the count is reported instead of averaged
  away. **On this card it is not rare — 4 of 24 rungs at 2842 MHz and 8 of 42 at 3090.**
- **The two card-level rung counts are asserted as LITERALS (24 and 7), not computed from the zones.**
  A block that derives its expectation from the same constants as the code has no independent opinion
  and passes every mutation by construction (EXP-0055). The literals are what a re-idealization has to
  break in order to land.
- ~~**The margin question this raises is NOT settled here**~~ — **RETRACTED 2026-08-15 21:5x: it was
  never open, and filing it as a `PENDING` was the mistake.** The owner had already stated the rule
  twice, and restated it a third time when he saw this line: **a failure is found at 5 mV, always; a
  failure on a coarser step means the edge is NEAR, not found, and the descent switches to 5 mV and
  re-finds it; from that failure, up 10 mV.** §4.6 now carries it as a binding rule with his words, and
  `marginAboveFailureMv()` THROWS on a local gap so the «+20 mV» reading cannot be written at all.
  **What was genuinely mine to report — and it stays a report, not a question:** 32 of the card's 126
  grid intervals have no 5 mV step in them, so at those frequencies the edge is located only to the
  card's own resolution. That is a limit of the hardware, it goes in the run's output, and it changes
  neither his rule nor the 10 mV.
  **The process lesson, kept because it is the reusable half:** a precondition inside a quoted owner
  rule («если нашли шагами по 5 мВ…») is part of the rule. Reading it as decoration and re-opening the
  decision cost him a third explanation of something he had already settled.

**Added while EXECUTING §4.3's LIVE half (2026-08-15 23:0x):**

- **`chooseWriteShape`'s answer is OBEYED, and this plan carried two readings of that.** §4.3's
  orchestration line says «write the uniform raise» under a pin; the F2-AC9 bullet says the holder is
  `кривая` where a cap at C is expressible. Those prescribe different shapes above 2157 MHz. **The
  resolution is that the plan already named the arbiter — «CALL it, never write a second copy of the
  rule» — so the rung asks and complies:** above the curve's cap floor the shipped `raise-and-cap`
  shape is written and NO pin is applied; below it the raise is uniform and the pin is the holder.
  **The price is named rather than discovered later:** a capped card deliberately sits a little BELOW
  its ceiling (measured three times — cap 2842 → 2812 median), so on a capped rung the load runs a
  clock slightly under C, and the voltage exercised may be a cheaper neighbour than the one ordered.
  The re-assertion catches the case where that changes the SERVING entry for C; it does not turn a
  capped rung into a pinned one. **If the live sweep shows that gap mattering, it is a defect of the
  rule and belongs in a bug document against `chooseWriteShape` — not in a quiet divergence inside a
  new function.**
- **`canPin` was added because F2-AC9's refusal branch was otherwise UNREACHABLE.** With `pinned: true`
  hard-coded, `chooseWriteShape` can never answer «neither holds it»: the cap holds it, or the pin
  does. The criterion «refuses if neither can» would then be satisfied by a branch no run can enter —
  a guard that has never gone red proves nothing. The sweep sets `canPin` from the card's own clock
  ladder, and a rung below the cap floor on a card that cannot pin is refused BEFORE any write instead
  of discovered mid-burn.
- **A rung whose ROLLBACK failed is never reported as passed — a rule this plan did not carry.** It
  follows from the machinery that already exists rather than from taste: the next rung would arm a
  watchdog and write to a card whose state nobody can describe, which is precisely the situation
  `watchdog --recover` exists to refuse. Reported as `unknown` (a STOP), with the failed undo steps
  named.
- **The undo is recognised by a FIELD, not by a block name.** `runUndo` now stamps `undo: true` on
  every block it emits. The alternative — matching «ОТКАТ:» in the name — is a truth↔mirror pair
  created deliberately, and it would go silent the first time a block is reworded.
- **Δ ≤ 0 is refused BY NAME, not left to the atom.** `runStep` throws a `RangeError` on a
  non-positive offset, which would hand the sweep an exception where it needs an outcome. A rung of a
  descent has Δ > 0 by the same argument that makes the serving entry unique; a caller that supplies a
  voltage already serving the clock at stock gets told exactly that.
- **The short probe is a ONE-ELEMENT SET, not the legacy single-shape path.** Going through
  `judgeCandidate` costs nothing and buys the field `worstShape` — the shape that decided — which the
  single-shape path does not produce. A rung record that cannot name the load that judged it is a
  record fact 37 forbids relying on. The element is TAKEN FROM `DIVERSE_SET` rather than re-declared,
  so the probe and the set cannot drift into two descriptions of one shape.
