# Bug 20 — a writer that dies of its OWN software fault is recorded as the card hanging

**Status:** 🔴 OPEN
**Version/build:** `main` @ `dce8007` · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** 2026-08-16 ≈17:0x +03:00, observed on the very next launch after `bugs/19` killed
the live sweep. Found by reading the resumed run's first line.

## Symptom

`bugs/19` killed the sweep with an `EPERM` inside the watchdog's heartbeat. The machine did not
hang: Windows kept running, the shell kept its prompt, the card was read clean seconds later. Yet
the next launch printed:

```
ЗАВИС: 2542 МГц / 895 мВ
```

The write-ahead journal found an intent nobody closed and closed it as `config.VERDICT.HUNG` — a
**first-class failure verdict**, equal in standing to `SDC` and `CRASH` by the owner's own decision.
So the document now carries, or will carry, the claim *«2542 МГц отказала при 895 мВ»* — a
measurement of silicon that nobody performed.

## Why it matters even though the direction is safe

The consequence is CONSERVATIVE — a phantom failure raises that frequency's voltage by the ratchet
and the ratchet never lowers it, so the shipped profile would be too generous rather than unsafe.
That is the good news and it is the whole reason this is a 🔴 and not a 🚨.

It is still a defect of exactly the class `TESTING_FRAMEWORK.md` exists for: **a `[TESTED]` claim
with no observation behind it.** Three concrete costs:

1. **A frequency is silently capped.** 2542 MHz stops descending at a wall that is not there.
2. **The «two consecutive hangs on one rung» emergency stop counts it.** That is the ONE emergency
   brake the owner left in the system (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»). Feeding it
   phantom hangs makes it fire on a healthy card — a brake that stops the car for no reason.
3. **The evidence lies to the next session.** A future reader sees «this card hangs at 895 mV on
   2542 MHz» and plans around silicon that never misbehaved.

## Root cause

`R15b` derives the hang rather than reporting it — *«an intent with no verdict IS the answer»* — and
that inference is correct for the case it was built for: a hang hard enough to need the reset button
takes the process and the page cache with it, so no verdict CAN be written afterwards.

**The inference has a second preimage nobody enumerated.** «No verdict was written» is produced by
three different worlds, not one:

| What actually happened | Can a verdict be written? | Today's reading |
|---|---|---|
| The machine hung / was reset | No — the process is gone with the OS | `ЗАВИС` ✅ correct |
| The operator stopped the run | Yes | fixed in `bugs/14` — «остановлено оператором» |
| **The writer threw and died** | **Yes — the process is alive all the way to the top-level handler** | `ЗАВИС` ❌ wrong |

`bugs/14` already split one of the three off. The third was left, and `bugs/19` is the first time it
fired. Generalisation for `EXPERIENCE.md`: **an inference from ABSENCE has as many preimages as
there are ways to be absent — enumerate them before trusting the inference, and close each one at
its source.** A guard that can only say «something did not happen» must be paired with every actor
that can make it not happen.

## Fix plan

1. **Close the intent at the top-level handler.** The sweep's entry point already catches to set an
   exit code; there it must write the intent's verdict as a NON-CARD outcome (the vocabulary
   `bugs/14` introduced for the operator stop is the right neighbour — «прогон умер: <причина>»),
   naming the exception. The process is alive at that point; that is the entire difference from a
   hang, and it is what makes the fix possible at all.
2. **`process.on('uncaughtException')` / `unhandledRejection` do the same** for the paths that do
   not pass through the entry-point catch. Both must be idempotent with step 1.
3. **The verdict must NOT count toward «two consecutive hangs on one rung».** It is not a card
   event.
4. **Guard, proved red first** (EXP-0008). Mutation addressees, named before the run:
   (a) remove the top-level closure → the block «своя смерть НЕ приписывается карте» reddens;
   (b) let the new verdict count toward the consecutive-hang brake → its own block reddens;
   (c) make a REAL unclosed intent (no closure written at all) read as anything but `ЗАВИС` → the
   existing journal block reddens, proving the fix did not eat the real case.

## What to do about the one false record already on disk

2542 MHz / 895 mV carries a phantom hang from 2026-08-16. It must be re-measured rather than
hand-edited — `curve-store` is the document's only author (R14a), and an agent editing the evidence
by hand is `bugs/08`. The resumed sweep re-walks the band, so the honest fix is to let the run
measure that frequency again and to name this record in the run's report until it does.

## Decisions made without the owner

<filled at closing>

## Links

- `bugs/19` — the crash that produced this record. Same incident, different defect.
- `bugs/14` — the operator-stop half of the same misattribution, already fixed.
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R15 — the write-ahead journal and the derived hang.
- `GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК» — the owner's decision that makes `ЗАВИС` first-class
  and names the two-in-a-row brake this defect can trip falsely.
