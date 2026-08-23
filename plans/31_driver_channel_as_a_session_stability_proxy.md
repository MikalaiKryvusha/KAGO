# Plan 31 — the driver channel as a graded per-session stability proxy

> **Created:** 2026-08-23 21:2x +03:00 · **Parent:** `researches/16` (the probability profile — method
> written, data not collected) · `researches/15` §2 (the channel measured over all twelve deaths) ·
> R4b-signal · a neighbouring agent's proposal relayed by the owner 2026-08-23 21:1x ·
> **Status:** 🔲 PLANNED, NOT STARTED · **Outbound:** the measured Q1–Q4 numbers fill
> `researches/16`; the per-session figure becomes a printed line of the sweep report, never a verdict

---

## Goal vector

**Pain.** The edge is judged by whether the machine survived. That is a one-bit answer arriving after
the damage, and between «fine» and «dead» this card has a whole region it never reports: on
2026-08-10 the driver logged **32 errors, 26 of them recovered by the driver itself, and the machine
never hung** — instability that left a trace and cost nothing. Today that day reads exactly like a
day with no events at all, because nothing counts them per session.

**Where we want to be (Achieve).** A run prints, alongside its verdict, **how much the driver
complained while it was running** — a graded number the operator can compare between profiles and
bands. Not «clean/marginal/failed» as a verdict; a count with its history beside it.

**Type: Achieve.** A new observation, printed. Explicitly **not** a new stop.

## 🔴 The boundary this plan may not cross, and it is not negotiable

`researches/15` §2 measured the channel over all twelve machine deaths: **specific, NOT sensitive.**

- before the canonical BSOD of 2026-08-16 23:32 — the one that closed fact 39 — **the driver said
  nothing for two days**;
- five deaths (29.07, 05.08, 06.08, 15.08, 16.08) carry **zero** driver errors on the day;
- `means: 'CRASH'` would have converted **123 historical complaints into 123 run stops**, and
  `ideas/10` §5.5 forbids shipping a mechanism with false stops at all.

**Therefore: this plan adds a COUNTER and a PRINTED DISTRIBUTION. It does not add a threshold, and it
does not let the channel vote.** `classifyEvent` keeps returning `fault: false` for the signal class
(R4b-signal), and `verdictFor` keeps having no expression that mentions it. The same discipline the
pulse runs under (`ideas/10` §5.1: n = 1 cannot yield a threshold).

The neighbouring agent's framing — «a cheap stability proxy, catches instability before it becomes a
hang» — is accepted in exactly that reading: a proxy is an input, not a verdict.

## Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **AC1** | The sweep reports, per run, the count of driver-channel events inside its own window | events · the run report's СИГНАЛЫ section · a number present on every run, including 0 |
| **AC2** | The count is attributed to the RUNG it fell inside, not only to the run | events per rung · the report's per-rung lines · every event lands on exactly one rung or is named «between rungs» |
| **AC3** | Two message ids are counted SEPARATELY, because `researches/15` §8 measured them to be different messages | series · the report · id 153 and id 14 never summed into one figure |
| **AC4** | The figure votes on NOTHING | code paths · `grep` for the field among verdict consumers + a class-invariant block · zero consumers outside the printer |
| **AC5** | AC4 is proved on a broken version | mutation · let the count reach `verdictFor` · the class-invariant block reddens |
| **AC6** | `researches/16` Q1–Q4 are answered with measured numbers, or explicitly marked «not enough cases» | filled cells · the research doc · four cells, each a number or a named gap — never a plausible guess |
| **AC7** | Zero writes to the GPU to produce any of it | count · the probes are `Get-WinEvent` only · 0 |

## §1. Steps

### 1.1 Answer `researches/16` Q1–Q4 from what is already on disk — **[NOT-TESTED]**
- [ ] Join the twelve deaths (`Kernel-Power` 41 timestamps) against the driver channel's 129 events
      and against the sweep journal's rungs. **The journal is the piece the neighbouring agent does
      not have**: it knows which frequency and which voltage were being burned at that minute.
- [ ] Q1 — how often the channel warns before a death · Q2 — the delay distribution · Q3 — the
      false-negative rate · Q4 — the rate on days with no death.
- [ ] ⚠️ **The Windows System log keeps ~34 days.** Anything older is already gone, so this join is
      time-boxed by the log's own retention, and the answer must say how many of the twelve deaths
      still had their events available. A figure computed over «the deaths we can still see» and
      reported as «over twelve deaths» would be the false-`[TESTED]` class.
- [ ] Capture the raw joined rows into `researches/16` as a fixture, so the numbers survive the log's
      rollover — the same reason `plans/29` captured its two events instead of describing them.

### 1.2 Count per run, not per day — **[NOT-TESTED]**
- [ ] The sweep already opens a window per rung for the fault providers. Extend the SIGNAL class to
      accumulate: per rung, per run, per id.
- [ ] Print it in the run report next to the pulse distribution — the two are the same kind of
      instrument (an observation without a threshold) and belong side by side.
- [ ] `--last <window>` on `npm run events` grows the same summary, so the figure can be taken for a
      profile the sweep did not produce (a gaming session, an idle evening).

### 1.3 Keep the vote impossible BY CONSTRUCTION — **[NOT-TESTED]**
- [ ] Extend `runClassInvariants` with a block asserting the new count reaches no verdict path.
- [ ] Mutation (AC5): wire the count into `verdictFor` → the invariant block must redden.
- [ ] ⚠️ Read the RED LINE, not just the red (EXP-0127): two mutations reddening one block with the
      same message means the block asserts a conjunction and its check order is the diagnosis.

### 1.4 Only then ask whether a threshold may exist — **[NOT-TESTED]**
- [ ] With Q1–Q4 filled, state plainly whether the data supports one. **The expected answer is no**,
      and writing «no» is a result, not a failure of the plan.
- [ ] Gate for ever promoting this to a verdict is the same as R4a-pulse's: ≥ 3 archived runs, ≥ 1
      without a machine death. Not met today.

## §2. What is already done and must not be rebuilt

| Piece | State |
|---|---|
| Reading `nvlddmkm` at all | ✅ `plans/29_DONE`, commit `c69373f` |
| The two-class roster (`CRASH` votes, `SIGNAL` cannot) | ✅ `config.FAULT_PROVIDERS`, R4b-signal |
| Empty id list = the whole provider, on both sides | ✅ invariant block in `events --fixtures` |
| Captured fixtures (11:52:04 and id 14) | ✅ survive the log's 34-day rollover |
| The method for the probability profile | ✅ `researches/16` — **written, data missing** |
| The per-session count and its print | ❌ **this plan** |

## §3. Risks

| Tier | Risk | Contingency |
|---|---|---|
| **(a)** | The count quietly becomes a verdict later, because a number on a screen invites a threshold | AC4 + AC5 make it structural, not a convention; the gate in §1.4 is written down |
| **(a)** | Q1–Q4 answered over the deaths still visible in the log and reported as «over twelve» | §1.1 requires the availability count to be stated next to every figure |
| (b) | The join mis-attributes an event to the wrong rung when they abut | attribute by the journal's fsynced intent timestamps and name the ambiguous cases rather than resolving them |
| (c) | id 14 and id 153 get summed by a later refactor | AC3 has its own block |

## §4. Decisions made without the owner

*(filled at closing)*
