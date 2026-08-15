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
> `GPU_TUNING_RAILS.md` §0 (rail S2 gains its evidence clause) · the journal → `plans/16` (phase 3's
> live sweep) · closure → `plans/13` §4

---

## 0. Why this plan exists ahead of its gate, and the waiver it carries

`plans/13` §3 says operational plans are written one phase ahead — *«план фазы N+1 рождается на
закрытии фазы N»* — and phase 1 is not closed. The owner asked for the implementation plans directly,
and phase 2 is the one phase where writing early costs nothing: its entire design was fixed by his own
decisions of 2026-08-15 (the step ladder, the seeding, the burn duration, the presence model, the
accepted hang). Nothing in it waits on a measurement.

| Condition | State | Disposition |
|---|---|---|
| Phase 1 closed (`plans/14`) | 🔲 not started | **Waived for WRITING this plan; NOT waived for EXECUTING it.** No step below may run until the curve document and the grids exist |
| `/fable-judge` over phase 1 | 🔲 not run | Same — it is this plan's entry gate (§2) |

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

| Gate | Required state | Evidence |
|---|---|---|
| Phase 1 closed | curve document + both grids exist and validate | `npm run curve -- --show` · `--verify` green |
| `/fable-judge` over phase 1 | passed | its verdict recorded in `plans/14` |
| `npm run check` green | 33+ files, 0 failures | — |
| Watchdog unarmed | no record held at rest | `npm run watchdog -- --status` |
| Goldens valid | every stamp matches the live card | `npm run stress -- --verify-baseline` |

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

### 4.1 — The owner's step ladder as a pure function 🔲

*Anchor: `GOAL.md` → «📐 ЛЕСТНИЦА ШАГОВ СПУСКА» — 25 mV over the first 100 below stock, 10 mV from 100
to 150, 5 mV deeper.*

- [ ] `descentLadder({ points, servingIndexAtStock, availableDepthMv })` → the ordered list of curve
      POINTS the descent will visit, each carrying its voltage, its depth from stock, and the policy
      zone that chose it.
- [ ] **The grid is non-uniform (5 mV ×94, 10 mV ×32), so the policy is mapped onto POINTS:** the next
      rung is **the deepest point whose voltage is still ≥ (current − policyStep)**. Rounding is always
      toward the shallower point — asking the card for a voltage it does not have is not an option, and
      overshooting the owner's policy is worse than undershooting it.
- [ ] `config.mjs` gains `DESCENT_ZONES = [{ untilDepthMv: 100, stepMv: 25 }, { untilDepthMv: 150,
      stepMv: 10 }, { untilDepthMv: Infinity, stepMv: 5 }]` with the owner's quote above it. **One
      truth**; `FAST_DESCENT_FLOOR_MV` is retired in the same change, with a comment saying it was
      superseded rather than deleted silently (they agree at 2842 MHz: 1045 − 150 = 895 ≈ 900).
- [ ] Blocks: the zone boundaries · a 10 mV grid gap inside a 25 mV zone · a depth shallower than one
      grid step (the ladder is then a single rung or empty) · the ladder truncated by the lever wall.

**Verification:** the ladder for 2842 MHz must be 28 rungs and for 2400 MHz 7 (`researches/09` §4.1) —
numbers computed from the live curve, so a disagreement means the function or the table is wrong.

### 4.2 — Seeding, and the governor that had to grow up 🔲

*Anchor: `GOAL.md` → «🪜 СПУСК НАЧИНАЕТСЯ С УЖЕ ОТТЮНЕННОЙ СОСЕДКИ»; the owner: «очень редко — выше,
почти не бывает такого».*

- [ ] `seedFor(frequency, curveDoc)` → the PASSING voltage of the nearest already-tuned HIGHER
      frequency (its edge + 10 mV), or `null` when there is none (the first frequency, or the
      neighbour closed as `lever-limited` with no proven value).
- [ ] **`pickAscentRungs` gains an evidence base.** Today it refuses a first step deeper than
      `ASCENT_FIRST_STEP_MAX_MV` **below stock**. It becomes: deeper than that below
      **`deepestProvenMv`** — the deepest voltage evidence already proves safe. `deepestProvenMv`
      defaults to the stock voltage, so **a call with no evidence behaves exactly as today** (F2-AC2),
      and that identity is a selftest block with its own mutation.
- [ ] The seed's first burn is a PROOF, not a formality: it runs the full rung machinery of 4.3.
- [ ] **Not-PASS on the seed → `seedRejected`:** cancel seeding for this frequency, restart the descent
      from stock on the ladder of 4.1, and record `{frequency, seedMv, neighbourFrequency, verdict}` in
      the journal and the report. This is the owner's rare case and it is printed, never absorbed.
- [ ] The report ends with **the seeding scoreboard** — seeded / fallen back / never seeded. That count
      IS the measurement of monotonicity on this silicon (`researches/09` §4.2).

**Verification:** a fixture where the neighbour's value fails must produce a from-stock descent and a
named `seedRejected` line; the no-evidence identity block must be mutation-proved.

### 4.3 — One rung: pin the clock, make the target point serve it, judge, roll back 🔲

*Anchor: `ideas/03` steps 7–9; internal map R1 (only `profile-manager` touches the card), R9 (armed
watchdog), R10a (the rollback is a list).*

The arithmetic, and it is why a pin makes the whole range reachable:

```
to make point j serve the pinned clock C:  Δ = C − F_j   (a UNIFORM raise)
```

Every point below j has a lower stock frequency, so after a uniform Δ none of them reaches C — **point
j becomes the serving point by construction**, with no cap needed to arrange it.

- [ ] `runRung({ clockMhz, targetPointIndex, seconds, shapes })`:
      arm the watchdog → **pin** through `profile-manager` (`-lgc C,C`) → write the uniform raise →
      read back until two samples agree (EXP-0014) → assert the serving point IS `targetPointIndex` →
      load → judge → **release and zero in a `finally`, as a LIST** (R10a: a throwing undo must not
      cancel the ones behind it).
- [ ] **F2-AC9, the ceiling's holder, named per rung.** A uniform raise for a deep undervolt pushes the
      curve's top above the card's maximum; under a pin the card cannot go there, but the CURVE still
      offers it. So each rung states its holder: `кривая` when a cap at C is expressible
      (C ≥ top − 1000 = 2157 MHz), otherwise `закрепление`. **When neither can hold it, the rung is
      refused** — that is R13 applied to what the card can actually reach rather than to the table.
- [ ] The short probe judges with ONE shape — `sdc_fma --transient`, the shape voltage noise lives in
      (`researches/02` §2) — for the owner's 10 s. **The EDGE, once bracketed, is re-judged by the full
      three-shape set before it is written to the document** (fact 37): 10 s is the owner's search
      price, the set is what makes the number trustworthy.
- [ ] `UNKNOWN` is a STOP, never progress — the rule the ascent already obeys (EXP-0011).

**Verification:** on an injected backend — the serving-point assertion fires on a wrong Δ; the undo
runs as a list with an injected throw in the middle; the holder line is present on every rung.

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
| 4.3 | injected backend: serving-point assertion fires; undo runs as a list through a thrown step; holder named per rung |
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
