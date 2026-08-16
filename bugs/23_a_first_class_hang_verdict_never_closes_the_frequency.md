# Bug 23 — a first-class `ЗАВИС` verdict does not close the frequency, so a resumed run walks back onto the rung that killed the machine

**Status:** 🔴 OPEN
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

## What to do about the knowledge already on disk, before the fix exists

The journal holds it and the journal is git-ignored, so it is one `runs/` wipe from being lost. Until
step 1 lands, the safe way to bank the proven half is a capped re-run — `--max-depth 195` stops the
descent at 850 mV and **cannot reach 845** — which writes a real measurement into the document
without repeating the crash. That is a workaround, not the fix: it records «850 held», not «the edge
is at 845».

## Decisions made without the owner

<filled at closing>

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
