# Research 33 — re-arming a deadman into a machine that is still stuttering: how the industry gates the return to service

> **Created:** 2026-09-04 12:1x +03:00 (session 81) · **Parent:** `bugs/101` observation 4 (six fuse trips in 21 s on 04.09, each 60 ms after the previous re-arm) · `plans/81` Ш5 (the АПВ wait) · mechanism M4 of the canon («на развилке — не решать самому, а учиться у лучших») · **Status:** 🟢 recon taken: three fields, four sources; the fork is written for the owner with the project's own numbers, no threshold chosen by the agent · **Outbound:** the fork is filed as `interviews/026` Q2 with §4 quoted inside it (2026-09-04 12:2x); the chosen form → `plans/81` (a Ш7) and `fuse.mjs`

---

## 0. The decision this recon serves

Since `plans/81` Ш5 the fuse survives its own trip: hand 1 kills the burn, hand 2 writes stock and verifies it by reading, and the judge **re-arms the moment stock is confirmed**. The sweep waits for that re-arm (`tripCount <= rearmCount`) and then writes the next rung.

On 04.09 10:56 that produced a storm: trips #2…#7 came **60 ms** after each re-arm (the deadman threshold itself), hand 1 found no burn to kill in four of five, the judge's own tick rate had collapsed from ~410/s to **4/s**, and each re-arm let the sweep write a rung into a machine that was still stuttering — which is how hand 2 ended up racing the sweep's write (`bugs/101` finding 1). The judge's only re-arm criterion is «stock confirmed by reading»; it never asks whether the SYSTEM is healthy again.

The fork: **what must be true before a tripped deadman returns to its post?** Two or more answers, a non-zero price of error (a re-arm too early = a rung burned into a sick machine; too late = a band that never resumes) — a fork by the canon's definition, so recon before decision.

## 1. The problem in the industry's vocabulary

A deadman that trips, rescues and re-arms is a **circuit breaker** (Nygard, *Release It!*, 2007; Fowler 2014): CLOSED (calls flow) → OPEN (trip; calls refused) → HALF-OPEN (a bounded probe period) → CLOSED again only if the probes succeed. Our fuse has CLOSED and OPEN and **no HALF-OPEN**: it goes OPEN → CLOSED on a single condition about the *resource we reset* (the card is at stock), not about the *system we protect* (the beat is healthy).

## 2. What each field answers

### 2.1 Resilience4j — the probe COUNT is a parameter, the wait is a parameter, and both are named

`CircuitBreaker` config, verbatim from the docs:

- `waitDurationInOpenState` — «The time that the CircuitBreaker should wait before transitioning from open to half-open» (default 60 000 ms);
- `permittedNumberOfCallsInHalfOpenState` — «Configures the number of permitted calls when the CircuitBreaker is half open» (default 10);
- HALF_OPEN → CLOSED «If the failure rate and slow call rate is below the threshold»; HALF_OPEN → OPEN «If the failure rate or slow call rate is then equal or greater than the configured threshold»;
- `automaticTransitionFromOpenToHalfOpenEnabled` — with it, a monitoring thread moves OPEN → HALF_OPEN by itself; without it, «the transition to HALF_OPEN only happens if a call is made».

**What it answers for us:** the return to service is a STATE with its own budget of observations (N permitted calls), and success is judged over that budget, not over one call. The wait before probing is a separate knob from the probe count.

### 2.2 Polly — the minimal form: ONE probe, and a failed probe re-opens at once

Polly's circuit breaker (docs, `strategies/circuit-breaker.md`): «After a preset duration the circuit breaker performs a probe, because the assumption is that this period was enough for the resource to self-heal»; HalfOpen → Closed «Passes the probe», HalfOpen → Open «Fails the probe». Options `BreakDuration`, `FailureRatio`, `MinimumThroughput`, `SamplingDuration`.

**What it answers for us:** even the minimal industrial form has a HALF-OPEN: a probe that FAILS sends the breaker back to OPEN immediately — it does not count as «tripped again from CLOSED». In our terms: a trip 60 ms after a re-arm is not a seventh trip, it is a failed probe of a re-arm that should not have completed.

### 2.3 Embedded / PLC watchdogs — the feed is PROOF OF HEALTH, not proof of life

The industrial watchdog pattern (PLC scan / process monitoring references; the Linux watchdog module parameters and the phyCORE hardware-watchdog guide say the same in driver terms): every critical task sets a heartbeat flag when it completes a *successful* iteration; a dedicated monitor feeds the watchdog **only when ALL flags are set**, then clears them. «If any task has missed its heartbeat deadline, the watchdog is intentionally starved … ensuring that the watchdog feed is proof of system health, not just proof that the CPU is running.»

**What it answers for us:** «stock confirmed by reading» is proof that ONE hand did its job — the CPU-is-running kind of proof. The health of the protected system is a different flag, and it is the beat: the same 2-ms datagram whose silence tripped the fuse. A re-arm that does not consult the beat re-arms on the wrong flag.

## 3. Reflection — WHY these are the best practices, and HOW they serve THIS project

1. **They separate «the resource is reset» from «the system is healthy».** Nygard's breaker exists because a dependency that just failed is, statistically, about to fail again; the half-open period is the industry's admission that a single successful reset proves little. Our 04.09 protocol is that statistic in miniature: five re-arms, each followed by silence within 60 ms — the rescue worked every time and the system was not back once.
2. **They make «too early» impossible by construction, not by a number.** Half-open does not need a magic wait: it needs a PROBE that can fail. Our probe already exists and already runs at 2 ms — the beat. A re-arm that waits for N healthy beats is a half-open state whose probes are free.
3. **They keep the sweep out of the half-open window.** In every breaker, callers are refused (or metered) while half-open; ours must not open a new `intent` until the judge is CLOSED. That is the fencing token of `researches/31` applied one state earlier — `tripCount > rearmCount` today, `state !== CLOSED` tomorrow.
4. **They serve the owner's own words twice.** «Сколько угодно спасений разрешаю» (`interviews/024` = E) — a half-open state does not cap rescues, it stops counting a failed probe as a rescue; and «зависание — наш провал» (S4) — six rescues in 21 s into a stuttering machine is the fuse *working* and the design *failing*, which is exactly the number S4 asks to bring down.

## 4. The three shapes side by side — quoted into `interviews/026` Q2 (the question lives THERE; this is its evidence)

| | A. HALF-OPEN by the BEAT (recommended) | B. HALF-OPEN by a fixed wait | C. as today |
|---|---|---|---|
| when the judge returns to post | after stock is confirmed **and** the beat has been healthy for a window | after stock is confirmed **and** a fixed pause | when stock is confirmed |
| what «healthy» means | no beat silence above the deadman N (60 ms) inside the window — the probe that already exists | nothing measured; time passes | nothing |
| a trip during the window | a FAILED PROBE: back to OPEN, hands run, no new rescue counted | same | a new trip, counted, another rescue |
| the number | the window length — **derived from the alive file** (`…-fuse-alive.jsonl`): on 04.09 the healthy baseline is 5…41 ms worst beat silence and ~410 ticks/s; the sick minute is 60+ ms and 4 ticks/s; a window is «the beat back at baseline for X s», X read off the storm's own duration (21 s), never typed | `BreakDuration` — a number somebody picks (the class `bugs/73` rejected) | — |
| cost | the sweep resumes later by the window; on 04.09 that is the 21 s the storm lasted, instead of five rungs burned blind | resumes after a pause that is wrong on both sides for any other storm | 04.09 repeats |
| what it does NOT buy | a machine that stops beating entirely (instant death, EXP class «мгновенная смерть») — no probe can pass; that is the reboot path and stays it | same | — |

**Measured 12:19 over every fuse protocol on disk** (`runs/death-watch/*-fuse.jsonl`, 31.08 and 04.09): re-arms into a sick machine — **10 of 10** — were followed by the next trip in **0.06 s**, one deadman period; the one re-arm into a healthy machine (04.09 10:50:41) held for **319 s**. Today's criterion («stock confirmed») separated sick from healthy zero times out of eleven; the beat separates them within 60 ms.

**Recommendation A**, on the recon's argument, not on taste: the probe exists, runs at 2 ms, costs nothing, and its failure is already the fuse's own definition of «sick». The window's length is a MEASUREMENT question (how long did the beat stay sick after each rescue, over every fuse-alive file on disk — a one-line script), and it goes to the owner as measured numbers, not as a proposal of «10 s».

## 4a. THE WINDOW LENGTH — MEASURED 2026-09-04 (the §5 gap, closed) — ⚠️ ITS PROBE IS CORRECTED IN §4b BELOW

§5 left the window length open and named the measurement that yields it. Run over **every**
`runs/death-watch/*-fuse-alive.jsonl` on disk — 705 seconds carrying a beat-silence figure, across
six protocols of 31.08 and 04.09:

| | healthy | sick |
|---|---|---|
| worst beat silence, ms | 2.84 … **41.21** (691 s) | **60.89** … 500.61 (14 s) |
| judge ticks per second | 406 … 442 | **4** |
| separation | -- | **19.68 ms with not one of the 705 samples inside it** |

**The number the window actually needs, and it is not the storm duration.** The sick EPISODES are:
31.08 05:12:05 (a single second), 31.08 14:04:26 → 14:04:38 (11.3 s), 04.09 07:56:07 → 07:56:22
(15.4 s, UTC — the 10:56 storm). Inside all three there are **ZERO healthy seconds**: a stuttering
machine does not emit a healthy beat at all. The one re-arm into a healthy machine (04.09 07:50:40 UTC)
was followed by **319 consecutive healthy seconds**.

So the window does not have to cover the storm — §4 guessed «X read off the storm’s own duration
(21 s)» and the measurement REFUTES that guess: any window above zero already separates the two
states, because the storm contains no healthy second to be fooled by.

**Chosen: 3 consecutive healthy seconds, threshold the existing deadman setpoint 60 ms.** The
measurement earns «above zero»; the margin from 1 s to 3 s is MY choice and is named as mine, not
presented as measured — it costs the sweep 3 s per rescue (against five rungs burned blind on 04.09)
and buys tolerance against a single fluke reading. The threshold is not chosen at all: 60 ms is the
deadman period already in service, and the measurement CONFIRMS it sits inside the empty 41 → 61 ms
gap rather than cutting through a distribution.

> ⚠️ **This is a number for the MECHANISM, not a policy for the owner** (EXP-0214). The policy — «the
> sweep must not burn while the watch is off post» — is the owner’s, given 2026-09-04 19:37 in
> `interviews/026` Q1: *«Перемерить то, что было намерено по старому оракулу»*. What §5 forbade under
> `bugs/73` was an agent inventing the owner’s THRESHOLD and calling it his; deriving a window from a
> measurement to serve a policy he already gave is the agent’s own work.

[NOT-TESTED] — the window is measured, not yet wired into `fuse.mjs`; the wiring and its guard belong
to ОТДЕЛЬНЫЙ ПЛАН полуоткрытого окна (ещё не написан; `plans/81` Ш7 ЗАКРЫТ 31.08 — ссылка на него была ошибкой).

## 4b. ✏️ THE PROBE OF §4a WAS THE WRONG SIGNAL — CORRECTED THE SAME DAY, BY READING THE CODE

§4a chose «beat silence» as the half-open probe and measured it. **Then the code was read, and the
probe turned out not to exist in the state it is meant to guard.**

`fuse.mjs:825` — `if (buf[0] === 0x01) { lastBeatMs = now; beats += 1; }`. The beat is the BURN
RIDER's heartbeat, arriving over the rider's channel. Half-open begins after hand 1 has killed the
burn and hand 2 has restored stock: **there is no burn, therefore no beats, therefore no probe.** A
window waiting for «healthy beats» with the load off would wait forever — the run would never resume,
which is a wall, not a guard (`bugs/72` · EXP-0193, the shape this project keeps paying for).

**The signal that survives the load being off is the judge's OWN tick rate** — its loop keeps ticking
through half-open. Re-measured over the same 716 seconds of `runs/death-watch/*-fuse-alive.jsonl`:

| | healthy | sick |
|---|---|---|
| judge ticks per second | **356 … 442** (676 s) | 4 … **261** (40 s) |
| the empty gap between the classes | \-- | **95 ticks/s, and not one of the 716 samples inside it** |

A threshold of **300 ticks/s** sits in that gap. It is not a chosen number in the `bugs/73` sense —
every value from 262 to 355 gives the identical partition of the measured data; 300 is the round one
inside the empty band. **A threshold of 100 was tried first and REJECTED by the measurement**: it left
three «healthy» seconds (100, 102, 107) sitting inside a sick episode, i.e. it cut through the
distribution instead of the gap.

**The window length — re-derived on the correct signal, and the §4a conclusion SURVIVES.** Sick
seconds grouped into CONTIGUOUS episodes (a run of 3 healthy seconds breaks an episode):

| episode | duration | sick seconds | healthy seconds INSIDE |
|---|---|---|---|
| 31.08 05:12:05 | 0.0 s | 1 | **0** |
| 31.08 14:04:26 → 14:04:38 | 11.3 s | 6 | **0** |
| 04.09 06:37:50 → 06:38:14 | 24.0 s | 25 | **0** |
| 04.09 07:50:40 | 0.0 s | 1 | **0** |
| 04.09 07:50:51 | 0.0 s | 1 | **0** |
| 04.09 07:56:07 → 07:56:22 (the storm) | 14.8 s | 6 | **0** |

**Six episodes, not one healthy second inside any of them.** So the window need only exceed zero, and
**3 seconds is a 3× margin** — my choice, named as mine, costing the sweep 3 s per rescue against the
five rungs it burned blind on 04.09.

⚠️ **§4a's own numbers stay on the page rather than being deleted, and this is deliberate**: they are
the correct measurement of a DIFFERENT thing — the health of the burn's heartbeat WHILE a burn runs,
which is what input 1 already trips on. What was wrong was not the arithmetic but the choice of
signal, and arecon document that quietly swaps a number teaches nobody why the first one was wrong.

**How this was caught:** not by review and not by a test — by reading `fuse.mjs` before writing the
plan that would use the probe. The measurement was made first and the code read second, which is the
wrong order; had the plan been written on §4a alone, the window would have hung the run forever on the
first rescue. [[EXP]] candidate: *«замер сигнала не доказывает, что сигнал существует в том состоянии,
ради которого меришь»*.

## 5. What this recon did NOT establish — named

- Whether the display corruption of 04.09 (cursor, wallpaper) came from the six curve zero/raise cycles in 21 s or from the driver storm that started three minutes earlier — the recon is about the fuse's return to service, not about the display.
- The window length: **not chosen here** (`bugs/73`: agent-chosen thresholds are rejected); the measurement that yields it is named in §4 and is the next step.
- Whether the beat sender itself is a fair probe during a driver reset (it lives on the CPU; the card may be dead while the OS beats) — that is input 2's territory (`bugs/101` finding 3), and the two inputs together are the full probe.

## Sources

- [Resilience4j CircuitBreaker — configuration and the HALF_OPEN state](https://resilience4j.readme.io/docs/circuitbreaker)
- [Polly — circuit breaker strategy (half-open probe, BreakDuration)](https://github.com/App-vNext/Polly/blob/main/docs/strategies/circuit-breaker.md)
- [Watchdog Timer (WDT) technical reference — PLC scan, process monitoring, communication heartbeats](https://industrialmonitordirect.com/blogs/knowledgebase/watchdog-timer-wdt-technical-reference-plc-scan-process-monitoring-and-communication-heartbeats)
- [WatchDog module parameters — the Linux kernel documentation](https://www.kernel.org/doc/html/v5.8/watchdog/watchdog-parameters.html)
- Michael Nygard, *Release It!* (2007) — the circuit-breaker pattern; Martin Fowler, «CircuitBreaker» (2014) — the three states
- Project evidence: `runs/death-watch/2026-09-04T07-50-16-246Z-fuse.jsonl` (trips #2…#7 at 60 ms after each re-arm) · `…-fuse-alive.jsonl` (ticks 410/s → 4/s at 10:56:11) · `researches/31` (fencing token · seqlock · e-stop latch)
