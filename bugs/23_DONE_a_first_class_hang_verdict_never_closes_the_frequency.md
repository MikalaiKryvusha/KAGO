# Bug 23 — a first-class `ЗАВИС` verdict does not close the frequency, so a resumed run walks back onto the rung that killed the machine

**Status:** ✅ **DONE — 2026-08-22 14:34, CLOSED BY THE LIVE RUN.** Every guard was mutation-proved red
first (8 addressees) and the trap suite drives it over a REAL process kill; the live half is now done
too. `engine --sweep --from 2842 --to 2842 --dashboard` on the owner's card: the run's FIRST act was
to close the orphaned intent of 2026-08-16 as a first-class `ЗАВИС` (seq 520, «НАМЕРЕНИЕ БЕЗ
ВЕРДИКТА»), the descent then stopped at 850 mV and **did not step onto the 845 mV rung that killed the
machine** — the hang floor held, exactly as the dry run had printed it. Row **2835 MHz** closed
`edge-found`. The knowledge of 2026-08-16 is in the curve document.
**⚠️ And the second run of the same frequency 26 minutes later disagreed with the first** — 850 mV
PASSED at 14:31 and CRASHED at 14:57, moving the shipped voltage 860 → 865 mV. Not a defect of this
fix and not thermal (the card runs COLDER at the deep rungs — 68 °C/139 W at the top of the descent
against 49 °C/93 W at the bottom); it is the silicon's spread at the edge. Recorded as fact 39 in
`STATUS.md`, and it is evidence for the phase-4 gate «every edge boundary burned ≥ 60 s».
**Version/build:** `main` @ `901a123` · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** 2026-08-17 ≈23:31 +03:00 (2026-08-16 local evening), the project's **first
deliberate edge hunt** — `engine --sweep --from 2842 --to 2842 --max-depth 245 --dashboard`, run at
the owner's request to watch the oracle work. The machine bugchecked
(`DRIVER_IRQL_NOT_LESS_OR_EQUAL 0xD1`, `nvlddmkm.sys`).

## What happened, from the evidence

The descent walked **20 rungs from 1045 mV down to 850 mV, every one PASS**, then died:

```
23:31:17  verdict seq 519 : 850 мВ обслуживает 2842 МГц и ПРОШЛО (сдвиг +675 МГц)
23:31:17  intent  seq 520 : 2842 МГц ← 845 мВ (глубина −200 мВ, шаг зоны 5 мВ)
          ← no verdict. The machine died on this rung.
23:32:51  Windows Kernel-Power/41 — unexpected shutdown
```

**The card is at factory after the reboot** (watchdog disarmed, curve top back to 3172 MHz, power
limit 300 W) — rollback layer four, exactly as R10 describes it.

## The finding this produced — recorded here because it is the reason the defect matters

**The edge of this card at 2842 MHz lies between 845 and 850 mV.** First edge ever found on this
specimen: 584 burns across the project's whole life had produced **zero** non-PASS oracle verdicts.

And the shape of the failure is itself new knowledge: **the step was 5 mV — the minimum the card's
grid offers — and the card went from a clean PASS straight to a driver bugcheck.** At this frequency
the edge does not announce itself through silent data corruption; it takes the driver down. The
oracle's checksum half cannot see that by construction — the process dies with the OS. What saved
the knowledge was the write-ahead journal (R15), which is the one mechanism designed for precisely
this and the first time it has earned its keep on a real hang.

## The defect

`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК», the owner's word, obligation 1 of 3:

> *«Вердикт `ЗАВИС` — первого класса, наравне с `SDC` и `CRASH`. Он записывается в документ кривой
> как причина, по которой точка встала на своё значение, а не как сбой прогона.»*

**The code does not do this.** `closeHangs` writes the verdict into the JOURNAL, and there it stops:

- `sweepRange` reads `resumeState` and builds `blockedKeys` — but a key enters that set only after
  **two CONSECUTIVE hangs on one rung** (`blockedRungs`). One hang blocks nothing.
- Nothing consumes a prior hang as the frequency's **failure point**, so `planFrequency` builds the
  same ladder as before and the descent walks back down to the rung that killed the machine.
- The frequency is therefore never closed by the hang: `closePoint` runs only when a descent
  finishes with a verdict, and this one was killed mid-way.

**Three consequences, and the second is the dangerous one:**

1. **The knowledge does not reach the artifact.** The document's row for 2842 MHz still reads
   **1000 mV** from an earlier, shallower run. Twenty proven rungs and one located edge live in
   `runs/sweep/journal.jsonl` and nowhere else — and `runs/` is git-ignored.
2. **A resumed run REPEATS the crash.** By design it must reach the second hang before the brake
   engages. The owner accepted hangs as a normal path; he did not accept walking into a KNOWN one on
   purpose, and «две подряд» was written as a stop for a rung that hangs *unpredictably*, not as a
   licence to re-run a rung already proven fatal.
3. **The ratchet has nothing to ratchet.** It guarantees a frequency's voltage never goes back down;
   with the failure never written, there is no raised floor for it to hold.

## Fix plan

1. **A hang closes the frequency at the owner's shipping margin.** `V_отгрузки = V_отказа + 10 мВ`
   (two grid steps, his rule, `GOAL.md`). Here: failed 845 → **855 mV**, and 850 is independently
   proven, so 855 sits above measured ground rather than above an inference.
   Status `edge-found`; `provenBy` must say the edge was established by a HANG rather than by an
   oracle verdict — the two are not the same evidence and a later reader must be able to tell them
   apart.
2. **The descent consumes prior hang evidence as a floor.** A rung at or below a frequency's recorded
   hang voltage is never re-attempted; the ladder stops one step above it. This is `bugs/03`'s rule
   («step size is the only protection that acts BEFORE the state exists») applied to knowledge the
   project already paid a reboot for.
3. **«Two consecutive hangs» is untouched.** It stops a rung that hangs unpredictably; this fix stops
   us from *choosing* to revisit one. Different questions, both kept.
4. **Guard, proved red first** (EXP-0008). Mutation addressees, named before the run:
   (a) drop the hang→`edge-found` closure → «ЗАВИС ЗАКРЫВАЕТ ЧАСТОТУ» reddens;
   (b) park at the failure voltage instead of failure + 10 mV → the margin block reddens;
   (c) let the ladder descend to or past a recorded hang → «спуск НЕ ВОЗВРАЩАЕТСЯ на убившую ступень»
       reddens;
   (d) make the hang-derived close indistinguishable from an oracle-derived one in `provenBy` → the
       provenance block reddens.
   ⚠️ EXP-0075 at every site: `find(...)?.x ?? '<what was missing, in words>'`.

## THE FIX AS BUILT — 2026-08-17

**Shape:** the hang becomes a THIRD WALL on the descent, and the closure runs through the machinery an
oracle failure already uses. Nothing about the edge is computed twice.

| # | Where | What |
|---|---|---|
| 1 | `sweep-journal.hangFloors` | now counts an **unclosed intent** as a floor too, through the same `orphanIntents` the closure uses. Needed because the one reader that must not WRITE is the dry run, and a wall the plan cannot print is a wall the operator meets mid-run. Both sources give the same answer before and after the closure. |
| 2 | `engine.descentLadder` | takes `hangFloorMv`; no rung lands **on or below** it. Returns `stoppedByHang`, and the `why` names the hang rather than the lever or our depth cap. Where two walls fall on the same rung the HANG is named — it is the one fact of the three that belongs to the card. |
| 3 | `engine.planFrequency` | passes it through AND **cancels the seed** when the neighbour's voltage sits at or below the floor. The seed is a JUMP: it would deliver us onto the fatal rung on the first burn, before any ladder could stop anything. |
| 4 | `engine.sweepFrequency` | when the ladder stopped against the floor, `closeByHang()` runs `refineEdge` with the hang as the failure's OUTER bracket and the deepest PASS as the inner one → status `edge-found`, witness naming the reboot. No PASS above the floor → **halt**, nothing shipped (`hangFloorHalt`). |
| 5 | `engine.sweepRange` | reads `resume.floors` once, announces each (`hang-floor`), hands the per-frequency floor down, carries them into the report; `stoppedBy: 'hang-floor'` is its own reason and never wears «предел рычага». |
| 6 | `sweepDryRun` / `mainSweep --dry-run` | the plan reads the journal **read-only** and prints the wall, the cancelled seed and the deepest planned rung. |

**The rebase door, found by the twin search and then CLOSED BY PROOF rather than by a guard.**
`sweepFrequency` re-bases a rung's target off the card's grid when the proven ground has drifted up —
a second site that picks a voltage without asking the ladder. A filter was written there first; no
fixture could make it go red, because the branch only runs when the plan's rung lies BELOW the window,
so the chosen point is always ABOVE that rung and therefore above the floor. Shipping an unreachable
guard is EXP-0073's class, so the filter was removed and the PROPERTY is asserted end to end instead:
the block «спуск НЕ ВОЗВРАЩАЕТСЯ на убившую ступень» drives a descent whose ground drifts (1045 →
1010 → 975), the rebase fires twice under a live floor, and mutation 68 reddens it.
`TWINS: searched every site that chooses a voltage — `descentLadder` rungs · the rebase · `refineEdge`'s
bracket (strictly above the failure, safe by construction) · `seedFor` — found 4, all closed. The old
phase-5 `searchEdge`/`mainBand` path does not consult the journal at all and is out of this fix's
scope; it is the cancelled method (`MASTER_PLAN.md` phase 5).`

### The interaction nobody predicted, and it is the fix's best news

**The floor SUBSUMES the owner's «two consecutive hangs» brake on the sweep path** — and in the safe
direction. The brake had to reach the SECOND hang before it engaged, i.e. one protected rung cost
**two reboots** on the owner's desk. The floor closes the rung after the FIRST. Measured by trap T5,
which kills a real process: attempt 1 dies (exit 70), **attempt 2 now survives (exit 0)** because it
never descends that far. T5's assertions were rewritten to state that, not re-fitted to the old
behaviour; the brake itself is neither deleted nor left unproven — it keeps its own direct block in
`engine --selftest` driving `runRung` with a blocked key.

### The margin was re-anchored by the owner in the middle of this work — 2026-08-17

> *«давай исправим формулировку напряжения на котором фиксируемся — сейчас точка отказа + 10 мВ.
> Переделываем на: последняя стабильная до отказа точка (соседка отказа сверху) + 5 мВ. Это исправляет
> случае, где шаг был не 5 мВ, а, например, сетка позволяла только 10 мВ»*

He is right arithmetically, not merely cautiously. This card's grid has **32 intervals of 10 mV**;
there `failure + 10` lands exactly ON the last passing rung — a cushion of zero over proven ground, in
a quarter of the grid, invisible because the arithmetic looked identical from the failure's side.
Where the interval is 5 mV both forms give the SAME voltage, so **no measured number in the project
moves** — the edge of 2026-08-16 still ships 855 mV. `config.MARGIN_STEPS_ABOVE_FAILURE` → 
`MARGIN_STEPS_ABOVE_LAST_STABLE = 1`, and `refineEdge` adds it to `pass`, never to `failMv`.

### Evidence

| Check | Result |
|---|---|
| `node automation-engine/engine.mjs --selftest` | **256 blocks**, 0 red (was 245) |
| `node automation-engine/lib/sweep-journal.mjs --selftest` | **31 blocks**, 0 red |
| `npm run traps` | 28 assertions, **0 failures**, 0 pending — T5 on a real process kill |
| `npm run contract` · `bench --selftest` · `curve --selftest` · `npm run check` | 8/0 · 4/4 · 46/0 · 44 files, 262 texts, 0 corrupt |
| Mutations, addressees named BEFORE the run | **68–72, 74–76 — each reddens its own block**; baseline clean and the completion line asserted (EXP-0071) |

Two defects in the new blocks were found by the mutation run itself and fixed: a fixture that THREW
where a mutation made it reachable (EXP-0075, again), and a mutation string that also matched the
assertion's own expectation — the harness mutating both sides of its own comparison.

### What is NOT done

- **The live run.** `npm run engine -- --sweep --from 2842 --to 2842 --dashboard` is what writes
  855 mV into the document and closes this bug. Not run: the owner's machine was occupied and he
  asked for the GPU to be left alone.
- **The 2842 MHz row still reads 1000 mV** until that run happens. The journal still holds the truth.

## What to do about the knowledge already on disk, before the fix exists

The journal holds it and the journal is git-ignored, so it is one `runs/` wipe from being lost. Until
step 1 lands, the safe way to bank the proven half is a capped re-run — `--max-depth 195` stops the
descent at 850 mV and **cannot reach 845** — which writes a real measurement into the document
without repeating the crash. That is a workaround, not the fix: it records «850 held», not «the edge
is at 845».

## Decisions made without the owner

1. **The shipping voltage is `max`-free: the closure goes through `refineEdge`, not through arithmetic.**
   The fix plan said «hang + margin». Applied to a hang found on a COARSE rung that would ship a
   voltage nobody burned — which his own rule forbids (*«найденный грубым шагом отказ ОБЯЗАН быть
   уточнён минимальным шагом, прежде чем к нему применят запас»*). Routing the closure through the
   refinement obeys both rules with one mechanism instead of two. Price: where the descent stopped a
   coarse step above the hang, the run burns the grid points between them — that IS the search, and
   refinement can never reach the hang itself.
2. **Where two walls fall on the same rung, the HANG is reported.** The lever and the depth cap are
   statements about us; the hang is the card's answer, paid for with a reboot. Naming ours would hide
   the measurement behind our preference. Consequence: under `--max-depth` the frequency can still
   close as `edge-found`, which is more than the workaround promised.
3. **The rebase filter was removed rather than kept as belt-and-braces** — it could not be made red by
   any fixture (EXP-0073). Replaced by the end-to-end property with a drifting ground.
4. **Trap T5's assertions were rewritten, not re-fitted.** The old ones demanded two real deaths; the
   fix makes the second impossible. Recording that as the trap's achievement is honest, silently
   relaxing it would not be.
5. **The dry run now READS the journal.** The paragraph forbidding it says «rail S2's artifact must
   cost the card nothing» — that is about writing. Reading costs nothing and removes a wall the plan
   would otherwise hide.

## Links

- `GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК» — the owner's three obligations; this bug is
  obligation 1 not being implemented.
- `GOAL.md` → «Запас над отказом» — the +10 mV margin the closure must use.
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R15 (the write-ahead journal, which worked perfectly),
  R10 (the four rollback layers — layer four is what returned the card).
- `bugs/20` — the neighbouring defect: a hang that was NOT the card. Closed at its source, which is
  why tonight's `ЗАВИС` can be trusted as a real one.
- `bugs/03`, `bugs/07`, `bugs/11` — the earlier machine-killing incidents. Unlike those, this one was
  approached at the minimum grid step and is therefore a MEASUREMENT rather than an overshoot.
