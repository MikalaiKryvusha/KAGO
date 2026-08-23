# Research 16 — the probability profile of this card's edge, from twelve machine deaths

> **Created:** 2026-08-23 18:5x +03:00 · **Parent:** `interviews/012` (owner's answer: **C, then A**) ·
> `ideas/11` (his order: the virtual card must simulate the REAL failure classes)
> **Status:** 🟡 METHOD WRITTEN, DATA NOT YET COLLECTED — the method is deliberately written while the
> live sweep of 2026-08-23 evening is running, because that run becomes case №13 and the only one
> instrumented on all four channels at once. No probe was executed while the card was under load:
> the pulse measures, among other things, the system's ability to spawn a process, and this
> document's own probes would have been noise in it.
> **Outbound:** the measured probabilities → the bench's failure model (заход A, `ideas/11`); the
> «what the channel is worth» table → `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R4b-signal

---

## 1. What this document must answer, and why guessing is forbidden here

The owner ordered the virtual card to simulate the failure classes his card actually shows
(`ideas/11`), and then chose the ORDER himself: **recon first, bench second**. His reason, quoted
into `interviews/012` and accepted: a probability profile invented by the agent would be a made-up
number **in the foundation of the bench**, after which every green on that bench is a statement
about an imaginary card.

So this document exists to replace exactly four invented numbers with measured ones:

| # | The question the bench cannot invent | What the bench does with the answer |
|---|---|---|
| Q1 | **How often does the driver channel (`nvlddmkm`) warn before a death?** | the probability that a rung near the edge emits a driver event |
| Q2 | **How long before?** | the delay distribution between the signal and the death |
| Q3 | **How often does it stay silent through a real death?** | the FALSE-NEGATIVE rate the bench must be able to reproduce |
| Q4 | **How often does it fire on a day with no death at all?** | the FALSE-POSITIVE rate — the one that decides whether a threshold may exist at all |

**Q3 and Q4 are the whole point.** A bench that can only produce «a signal near the edge» blesses
any detector, including one that in real life stops the run on every driver hiccup and says nothing
on half the true edges. The bench must be able to LIE in both directions, and it may only lie at the
rates this card actually shows.

## 2. The evidence base — what exists, and what each source can and cannot say

| source | what it holds | boundary |
|---|---|---|
| `runs/sweep/journal.jsonl` | every INTENT and every verdict, `fsync`ed before the card is touched (R15) — an intent with no verdict IS a machine death, attributed to its exact frequency and voltage | starts when the journal did; deaths older than it are not in it |
| Windows `System` log, provider `nvlddmkm` | the display driver's own error channel — **129 events over 34 days**, measured 2026-08-23 | the log keeps ~34 days: older deaths have NO channel data at all, and that gap must be stated per case, never averaged over |
| Windows `System`, `Kernel-Power` id 41 | the machine stopped without a clean shutdown — the coarse, reliable marker of a death | says WHEN, never WHY |
| `runs/telemetry/*.jsonl` + `runs/dashboard/telemetry.jsonl` | the sampler's pulse: tick intervals, one per second (R4a-pulse) | exists only for runs that HAD a sampler — the older deaths have none |
| `PROJECT_HISTORY.md`, `bugs/*` | the prose record of each death, with what was being attempted | prose; used to ATTRIBUTE a death to a rung, never as a number |

⚠️ **The asymmetry that decides the method: the four sources cover different spans.** Twelve deaths
exist in the project's history; the driver channel reaches back 34 days; the pulse reaches back to
the run that first had a sampler. **A case where a channel did not yet exist is `— нет данных —`,
never a zero.** A zero would say «the channel was silent», which is a measurement nobody took, and
that is the invented-number class this whole document exists to avoid (`PHILOSOPHY.md` → three doors).

## 3. The method, step by step — each step is a command, not a judgement

1. **Enumerate the deaths.** `Kernel-Power` 41 over the whole history + the orphaned intents in the
   sweep journal. The two lists are built INDEPENDENTLY and then reconciled; a death present in one
   and absent in the other is itself a finding about our instrumentation.
2. **Attribute each death to a rung** — frequency and voltage — from the journal's last intent
   before it. Where the journal does not reach, the prose record names the attempt, and the row is
   marked as attributed BY PROSE.
3. **Window each death** and ask the driver channel what it said in the N minutes before it. The
   window is stated per row, not assumed globally.
4. **Ask the same channel about the QUIET days** — the days with no death — to get Q4. This is the
   half the first pass of `researches/15` did not take, and it is the half that decides whether a
   threshold can exist.
5. **Only then** compute the four rates, each with its denominator VISIBLE (`3 of 12`, never «25 %»).

## 4. What is already known and must not be re-derived

From `researches/15` §2, measured 2026-08-23 over all twelve deaths:

- the channel **hit three times**: 92 s · 9.8 min · 130 s before the death;
- it **said nothing at all** before the canonical BSOD of 2026-08-16 23:32 (the one that closed
  fact 39) — silent for two days;
- on quiet days it produced **single events** that would have been false stops;
- therefore: **specific, NOT sensitive** — and `config.FAULT_PROVIDERS` carries it as `SIGNAL`, a
  class that is structurally unable to vote (R4b-signal).

**This document does not re-open that verdict. It puts NUMBERS under it**, so the bench can
reproduce the channel's real behaviour instead of an idealised one.

## 5. Case №13 — the run of 2026-08-23 evening

The live sweep started 18:5x on the band 2700…2600 MHz is the first case with **all four channels
aligned on one clock**: the write-ahead journal, the driver channel, the sampler pulse, and the
dashboard's own record. Whatever it produces — a death or a clean finish — it is the highest-quality
row in this table, and the only one where a silence can be trusted as a silence.

## 6. Findings

*(filled after the run; nothing is written here from expectation)*

**Already collected by the run itself, 2026-08-23 18:5x — a finding about the MECHANISM, not the
channel, recorded here because it was observed while this document was being written:** on
2700 MHz at 850 mV the straightened curve **did not hold the ceiling** — the card delivered
**2715 MHz against a cap of 2700**, i.e. it leaked two grid steps upward. The engine refused to
judge the rung (no verdict about the VOLTAGE is possible when the frequency was not held), rolled
back, rejected the neighbour's seed and restarted the descent from stock. This is very likely the
same mechanism the dry run of the band above reported as «потолок на первой ступени держит: НИКТО».
