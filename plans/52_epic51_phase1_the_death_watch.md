# Plan 52 — epic 51, phase 1: THE DEATH WATCH, and which of two stalls comes first

> **Created:** 2026-08-26 21:1x +03:00 · **Parent:** `plans/51` (epic) · `bugs/61` · `bugs/62` ·
> `GOAL.md` → «🛑 ЛАГ ТЕЛЕМЕТРИИ — ЭТО ОТКАЗ, А НЕ PASS. КРАЙ НАЙДЕН»
> **Status:** 🟡 OPEN — written before any implementation, on the owner's instruction
> («сначала мы пишем планы, а затем по планам пишем имплементацию», 2026-08-26)
> **Outbound:** the answer to step 3 decides WHICH signal becomes the verdict input in phase 2, so
> phase 2 is not planned until this closes.

---

## Why this plan exists at all, and why it is phase 1 rather than "just wire the pulse in"

The owner ruled that a telemetry lag IS a failure (canon, today). The obvious next move looks like
"give the existing pulse a vote". **It is the wrong next move, and the reason is measured:** the
existing pulse ticks at **1000 ms**, and it ticks that slowly because the sampler spawns an
`nvidia-smi` PROCESS per sample — measured 2026-08-26, five runs: **51 · 47 · 48 · 46 · 48 ms** per
spawn. Wiring a 1-second instrument into the verdict would buy a detector whose best possible
warning is «somewhere in the last second», when the thing we are chasing is the owner's own words:
*«ВИДЕТЬ ПРИБЛИЖАЮЩУЮСЯ СМЕРТЬ»*.

## Goal vector

**Pain, in numbers.** On 2026-08-26 at 20:39 the machine died at 2775 MHz / 835 mV. One rung earlier
— 840 mV — the sampler lost its tick for **3042 ms** and the oracle still said PASS. The owner SAW
that stall on his monitor and said: *«на 835 можно было не спускаться — и избежать смерти машины»*.
The signal existed, was visible to a human eye, and no instrument in the run was watching for it.

**Where we want to be.** A watcher that notices a stall in **single-digit milliseconds** instead of
a second, running beside the sweep, costing the card nothing, and writing nothing but its own
misses — so that the rung which is about to kill the machine is refused BEFORE it is taken.

**Goal type:** Achieve (a new observation) + Avoid (never ship an alarm that lies — `bugs/27`).

## The heaviness test, run honestly

| criterion | holds? |
|---|---|
| touches ≥3 subsystems or canon documents | **yes** — engine, hardware-mon, R4/R4a-pulse, GOAL |
| rests on an external truth | **yes** — what the driver and the OS actually do under a dying GPU |
| does not fit one session | no |
| changes shipped composition or public contracts | **yes** — a lag becomes a first-class verdict |
| needs owner-level decisions | no — the owner already ruled (canon, today) |

**Three of five → HEAVY → the ladder applies.** The meta-plan already exists (`plans/51`), so what
this document is, correctly, is the **operational plan of its next phase** — not a new epic.

⚠️ **And the epic's own phase list is now partly superseded by the owner's ruling.** `plans/51` was
written when the pulse was «a candidate observation awaiting a threshold»; the owner has since ruled
that a lag IS a failure. Phase 2 of that epic («archive until a threshold can be derived») keeps its
value as data collection, but it is no longer a GATE on acting. Recorded here rather than silently
diverging; the epic's header gets the same note when this plan closes.

## What is already measured, so it is not re-measured

All taken 2026-08-26 on the live card, read-only:

| fact | number |
|---|---|
| one `nvidia-smi` spawn | **48 ms** (5 runs: 51·47·48·46·48) |
| one NVML call, in-process via koffi | **sub-microsecond** — ~5 million polls/s observed |
| driver refresh: `power.draw` | **18.3 ms** median between value changes |
| driver refresh: clock · temperature · utilization | **~500 ms** each |
| pulse noise floor, all safe rungs of three runs | max interval **1008…1053 ms** |
| pulse precursors before a death | **3042 ms** (26.08) · **4490 ms** (23.08) |

**Consequence the plan rests on:** polling the card's NUMBERS faster than ~500 ms buys nothing
(the driver returns the same value), and polling POWER faster than ~18 ms buys nothing either.
The thing worth measuring at 1–5 ms is **not a card value at all** — it is whether our own code got
to run. The owner said this himself: *«смотреть красивые циферки… можно и реже»*.

## The one question this phase must answer by measurement

When the machine dies, **what stalls first?**

| watcher | calls | its stall means |
|---|---|---|
| **`timer`** | nobody | «we were not scheduled» — the SYSTEM is being strangled |
| **`driver`** | one read-only NVML call per tick | «the call into the driver hung» — the DISPLAY DRIVER died |

These have different remedies and different warning times, and **today's evidence is a hint, not a
measurement**: the existing sampler spawns a process, so its 3-second gap could be either. The two
watchers must therefore run SIDE BY SIDE, in **separate threads** — a hung driver call blocks only
its own thread, so `driver` can stall while `timer` keeps ticking. Both stalling together is the OS.

## Acceptance criteria

Each carries Scale · Meter · Target.

- **P52-AC1 — the watcher exists and costs nothing.** Scale: CPU time per tick · Meter: the tool's
  own summary at 2 ms over 60 s · Target: the run completes with **≥ 95 %** of expected ticks
  delivered, on an otherwise idle machine.
- **P52-AC2 — the noise floor is MEASURED, never assumed.** Scale: max overshoot, ms · Meter:
  `--floor` on an idle machine, ≥ 60 s, both watchers · Target: **a number is printed and written
  down** in this plan. No threshold is chosen in this phase.
- **P52-AC3 — misses survive the machine's death.** Scale: bytes lost from the tail after an abrupt
  kill · Meter: kill the process without letting it exit cleanly, then read the file · Target: the
  last recorded miss is **present and parseable** (`fsync` per miss, the shape R15 and `bugs/37`
  already paid for).
- **P52-AC4 — it writes nothing to the GPU.** Scale: GPU writes · Meter: code review + `watchdog
  --status` before/after · Target: **0**, and NVML used through read-only calls only.
- **P52-AC5 — born with its own checks.** Scale: blocks · Meter: `--selftest`, offline, no threads
  and no card · Target: **≥ 6 green**, and each proven RED by a mutation that reddens only its own.
- **P52-AC6 — the discriminating measurement is obtained.** Scale: runs in which a machine death was
  captured with both watchers running · Meter: the watcher's own file · Target: **≥ 1**, and the
  report says which watcher stalled first, or says honestly that they stalled together.

⚠️ **AC6 cannot be scheduled and must not be chased.** Deaths happen when they happen; the watcher
rides along on runs the owner authorises for his own reasons. **No run is to be launched in order to
kill the machine.**

## Steps

- [ ] **1. Build `automation-engine/lib/death-watch.mjs`** — one process, two worker threads, tick
      configurable (default 2 ms). Pure decision logic (`classifyTick`, `summarize`) separated from
      threads and time, so it can be proven without either.
- [ ] **2. Its checks, in the same step** (`--selftest`): overshoot measured from the PROMISED tick
      rather than the actual one; early arrival is zero, not negative; the record threshold is
      strict at the boundary; the summary carries median AND max together.
- [ ] **3. Prove the checks RED by mutation** before trusting any green.
- [ ] **4. Prove durability (AC3)** — abrupt kill, then read the tail.
- [ ] **5. Measure the noise floor (`--floor`, AC2)** on an idle machine, ≥ 60 s, and WRITE THE
      NUMBERS INTO THIS PLAN. This is the step that makes a future threshold derivable instead of
      invented (`ideas/10` §5.1).
- [ ] **6. Ride along, don't drive.** The engine spawns the watcher beside the telemetry sampler on
      the next sweep the owner authorises. It votes on nothing yet — it only records.
- [ ] **7. Report to the owner** what the floor is and, when a death is finally captured, which
      watcher saw it first.

**Phase 2 (giving it a vote) is NOT planned here** and is written only when step 7 has an answer.

## Verification by observation

| claim | observation |
|---|---|
| the tick is delivered at 2 ms | the tool's own tick count against elapsed time |
| the noise floor is X ms | the `--floor` run, printed and pasted into this plan |
| a miss survives an abrupt death | kill without cleanup, read the file's last line |
| nothing was written to the GPU | `watchdog --status` before and after; NVML calls reviewed by name |
| the decision logic is right | `--selftest`, and each block reddened by its own mutation |

**[NOT-TESTED] until each row above has actually run.**

## Risks, tiered

- **(a) Highest — the watcher itself perturbs what it measures.** A 1 ms tick on a busy core could
  starve the sweep or the sampler. Contingency: default 2 ms rather than 1; AC1 measures delivered
  ticks; if the floor run shows the watcher costing real CPU, the tick lengthens — a slower honest
  watcher beats a fast one that changes the experiment.
- **(b) Plausible — the driver watcher cannot open NVML** (missing DLL, permissions). Contingency:
  it says so OUT LOUD in the report and does not silently degrade into a second `timer`, which would
  answer «who stalled first» with a forgery.
- **(c) Plausible — both watchers always stall together**, and the discrimination this phase exists
  for turns out to be empty. That is a legitimate FINDING, not a failure: it would mean the signal
  is OS-level, and a watcher that calls nobody is the cheapest possible detector.
- **(d) Small — a death is captured with the watcher not running.** Cost: one lost data point.
  Mitigation: step 6 wires it into the sweep's own start-up, so remembering is not required.

## What this plan deliberately does NOT do

- Does not give the watcher a vote — that is the next phase, and it needs step 7's answer.
- Does not choose a failure threshold. The record threshold (what is worth writing to disk) is NOT a
  failure threshold, and the code must say so where the constant is declared.
- Does not touch the telemetry sampler, the dashboard, or the 500 ms cadence of the «pretty
  numbers» — the owner explicitly said those are fine as they are.
- Does not launch a run of its own.

## Links

`plans/51` (epic) · `bugs/61` (the pulse had no vote) · `bugs/62` (the false «gives no verdict») ·
`bugs/27` (an alarm that lies on schedule) · `bugs/37` (a tail lost without `fsync`) ·
`ideas/10` §5.1 · `GOAL.md` → «🛑 ЛАГ ТЕЛЕМЕТРИИ — ЭТО ОТКАЗ» · `PROJECT_ARCHITECTURE_INTERNAL_MAP.md`
→ R4, R4a-pulse, R15 · `researches/05` §5.5 (NVML is an instrument, never a writer)
