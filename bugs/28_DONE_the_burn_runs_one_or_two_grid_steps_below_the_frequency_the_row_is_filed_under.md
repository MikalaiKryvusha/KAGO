# Bug 28 — the burn runs one or two grid steps BELOW the frequency the evidence is filed under

**Status:** 🔴 OPEN — found 2026-08-22 17:2x by correlating the sweep journal against the telemetry
sampler, on the owner's question: *«верная ли частота под прожигом, прожигается ли карта на той
частоте, которую мы и настраиваем»*
**Version/build:** `main` @ `062ac0a` · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** the live sweep of 2026-08-22 17:20→17:24 (`--sweep --from 2887 --to 900`), the run
that ended in the machine hang at 2880 МГц / 865 мВ. Everything below is READ from artefacts the run
left behind — no card was touched to produce this report.

## Symptom

The journal records a rung as belonging to **2880 МГц**. The card, sampled once per second by the
separate telemetry process during that same rung's burn window, was running at **2865 or 2872 МГц**.

Correlation over the 14 most recent rungs that fall inside the telemetry window (samples taken
between the rung's `intent` and its `verdict`, filtered to `utilization.gpu >= 40` so only loaded
samples count):

| Filed as | Actually delivered during the burn | Rungs |
|---|---|---|
| 2880 МГц | **2865 МГц** (−15, two grid steps) | 4 |
| 2880 МГц | **2872 МГц** (−8, one grid step) | 9 |
| 2880 МГц | 2880 МГц ✓ | 1 |

**13 of 14 rungs burned at a frequency the row does not name.** The grid step here is 7–8 MHz, so the
miss is one to two full rungs of the clock ladder.

## Why this matters

The curve document's entire contract is «частота → обслуживающее напряжение». A row that says
*995 mV serves 2880 MHz* while the proof was obtained at 2865 MHz is **evidence filed against the
wrong frequency** — and the direction is DANGEROUS, not conservative: a lower frequency is easier to
serve, so the voltage recorded is too low for the frequency named. Applying such a document promises
the card a voltage that was never proven at the clock it will actually be asked to run.

This is the same defect class the project already paid for in `bugs/10` / EXP-0053 («ключуй по оси,
которая не движется, и докажи, какая это ось, прежде чем выбирать»). There the evidence was keyed by
point index while the point moved; here it is keyed by an *ordered* frequency while the *delivered*
one sits one or two steps lower.

⚠️ **This does NOT contradict the engine's «запись идёт против ВЫДАННОЙ частоты» rule** — the engine
does re-read a delivered clock and files under it (the journal's `frequencyMhz` is 2880 while the
band was ordered from 2887). The defect is that **the delivered clock it files under is not the clock
the card sustains during the burn.** Whatever the engine reads, it reads at a moment that does not
represent the loaded window.

## Root cause — HYPOTHESIS, not yet proven

Not established. The measurement above proves the SYMPTOM only. Two candidates, and they are not
exclusive:

1. **The burn is too weak to hold the boost.** Measured on the same run: `utilization.gpu` during the
   burn is **52…58 %**, power draw **96…113 W against a 300 W limit**, and the only clock-limiting
   reason the driver reported all run was `gpu_idle` (121 samples). A card that is idle ~45 % of the
   burn does not sustain the top of its V/F curve. This is `plans/21` (the burn that reaches the
   power limit) arriving from a second direction, and it makes plan 21 a correctness item, not only
   a fidelity one.
2. **The delivered clock is read at the wrong instant** — before the load ramps, or from a sample
   that is not inside the sustained window.

**Both must be checked before anything is changed.** If (1) dominates, fixing the burn fixes this bug
as a side effect; if (2) dominates, the read must move inside the loaded window regardless.

## How to reproduce (offline, from artefacts — no card needed)

Any run that leaves both files behind:

```
node -e "<correlate runs/sweep/journal.jsonl intents/verdicts against runs/dashboard/telemetry.jsonl
          samples with utilization.gpu >= 40 inside each rung's window>"
```

The script used for this report is one-off by convention; the inputs are the two artefacts named.

## Acceptance criteria for the fix

| # | Criterion | Meter · Target |
|---|---|---|
| **A1** | The frequency a row is filed under IS the frequency the card sustained during the burn | Meter: the same journal↔telemetry correlation · Target: median delivered clock equals the filed frequency in **≥ 95 %** of rungs, and any miss is reported by the run itself, not discovered afterwards |
| **A2** | A rung whose delivered clock does not match its filed frequency is REFUSED or re-filed, never silently recorded | Meter: a selftest block with a fixture where the sampler reports a clock two steps low · Target: the block is red before the fix and green after, and the refusal names both numbers |
| **A3** | The correlation itself becomes a standing check, not a one-off script | Meter: a block in the `dashboard` or `engine` set that reads the two artefacts of a finished run · Target: proved red by a fixture |

## Related

- `plans/21_burn_that_reaches_the_power_limit.md` — the burn's weakness, measured independently
- `bugs/10` (DONE) · EXP-0053 — the «key by the axis that does not move» lesson
- `bugs/16` — rungs planned against a cold table while the card warms (the table's frequency-axis drift)
- STATUS fact 16 — the whole stability base taken at half the card's envelope

## STATUS: DONE (2026-08-29 10:0x, session 61 backlog revision, EXP-0170 class)

Superseded-and-closed by the owner's canon of 2026-08-22 («УПРАВЛЯЕМАЯ ВЕЛИЧИНА СТУПЕНИ —
НАПРЯЖЕНИЕ, А НЕ ЧАСТОТА»): the row is now FILED UNDER THE DELIVERED frequency, so evidence can
no longer land under a frequency the card did not run. In code: the delivered clock rides every
verdict line of the journal (bugs/54 DONE), the harvest keys pairs by delivered (plans/41 phase
1-2, proven in the twin smoke — «притяжение к ВЫДАННОЙ частоте»), and the intensity ladder this
ticket spawned was retired for exactly this reason (engine, «РАЗВЁРТКА ЖЖЁТ ОДНИМ НАБОРОМ»).
Ticket lagged the canon it had already won.
