# Research 09 — The full-range edge search: the owner's algorithm, the industry's, and this card's real search space

> **Created:** 2026-08-15 15:3x +03:00 (agent, first rung of the ladder for `ideas/03` — the owner's
> instruction *«Запланировать эпик и операционные планы — переписать движок KAGO под написанный выше
> алгоритм»*)
> **Parent:** `ideas/03_edge_finder_algorithm.md` (the algorithm) · `GOAL.md` → «⭐ ЧТО ТАКОЕ ТЮНИНГ
> VF-КРИВОЙ» (the definition it implements) · `researches/02` (the Vmin method — this document extends
> it from ONE point to the WHOLE range and does not restate it)
> **Status:** 🔬 written BEFORE the meta-plan and before a single line of engine code (rung 1 of
> `/plan-epic`). Every local number in §3 was measured on the live card **today, with zero GPU writes**.
> **Outbound:** the search-space arithmetic → the epic's phase sizing · the lever wall → an honest
> verdict class the engine must be able to report · the unattended-sweep fork → `interviews/007`

---

## 0. What this document answers, and what it deliberately does not

The owner wrote an algorithm (`ideas/03`). Executing it literally as written costs **days** of machine
time and would test the same hardware knob five times over; executing it *in the card's own
coordinates* costs an evening and produces the identical table. This document is where that claim is
proved with numbers instead of asserted, so the epic can be sized honestly.

**Three questions, and nothing else:**

1. Has this problem been solved before, and how does the industry do it? (§2)
2. How big is the search space **on this card**, actually measured? (§3)
3. What does that arithmetic force the epic to look like? (§4, §5)

**Not here:** the Vmin method itself (`researches/02` — read §6 before §3), the NVAPI write path
(`researches/05`), the graphics load (`researches/06`). This document assumes them.

---

## 1. The requirement

### 1.1 The owner's algorithm — the shape, not the text

The text is `ideas/03` (groomed) and commit `fbb06cb` (verbatim). Its skeleton, in eighteen numbered
steps, reduces to five claims that matter for engineering:

| Steps | The claim | Status in KAGO today |
|---|---|---|
| 1–2, 5 | A profile REFERENCES a V/F tuning-curve document; the curve holds per-point objects with frequency, voltage, **status** and **date last edited** | ❌ the profile EMBEDS a raw `deltaByPointMhz` array with no status and no date (`plans/12`) |
| 3–4 | The card is ASKED for its full voltage grid and its full frequency grid; each is stored as its own JSON dictionary | 🟡 both are readable (`nvapi --curve`, `nvidia-smi -q -d SUPPORTED_CLOCKS`) but neither is stored as an artifact |
| 6–7 | The sweep walks frequencies **top-down at minimum step**, and at each one the card is **PINNED** to that frequency and no other | 🟡 the pin exists (`ladder-descent.mjs`) but the search uses a curve CAP instead, which has a floor of 2157 MHz (fact 38) |
| 8–14 | From stock voltage, descend one grid step at a time under a 10 s burn judged by the oracle, until the machine hangs or the oracle sees errors; the point is fixed at **V_fail + 10 mV**; **a reboot is an expected outcome** | 🟡 the descent and the +10 mV margin exist; **surviving a reboot and attributing it to the right rung does not** |
| 15–18 | Long verification (3 min/point, ratchet upward on failure), then three profiles off the one found curve | ❌ none of it |

### 1.2 The definition it implements — and it is older than the algorithm

`GOAL.md`, the owner's words of 2026-08-15 10:19: *«Карточка сама принимает решение, на какую частоту
ей гнаться. А вот какое напряжение будет эту частоту обслуживать — это мы тюним VF кривой»* … *«КАЖДУЮ
точку этого диапазона мы протестировали, для каждой частоты нашли минимальное-на-10-мВ-выше-отказа
напряжение»*.

**`ideas/03` is that definition turned into a procedure.** Nothing in it contradicts the canon; it
supersedes the *method* of phase 5 (one clock, one cap, one Δ) and re-specifies the *profiles* of
phase 6 as three modes over ONE found curve — which is exactly the table already written into
`GOAL.md` after `bugs/11`.

### 1.3 One thing the algorithm does NOT say, and it is not an omission

It names three profiles (steps 16–18) and does not name `Stock Default`. `Stock Default` is a reset,
not a tuning profile — it configures nothing and is already shipped and proven. **Four shortcuts stay
four**; the algorithm re-specifies the three that tune.

---

## 2. Industry sweep — what has already been solved, and what was abandoned

### 2.1 NVIDIA's own answer: OC Scanner samples and INTERPOLATES

NVIDIA ships an automated V/F curve tuner (`NvAPI_GPU_ClientOcEstimated*`, surfaced through MSI
Afterburner's OC Scanner since 2018). Its method, as reported by the tooling community: it **tests a
selected subset of curve points and interpolates the rest** rather than measuring every point
([LACT issue #936](https://github.com/ilya-zlobintsev/LACT/issues/936),
[TechPowerUp](https://www.techpowerup.com/250930/version-4-6-0-beta-10-of-msi-afterburner-introduces-oc-scanner-for-pascal?cp=2)).

**Implication, and it is the epic's headline:** the owner's algorithm is *stronger than the vendor's
own tool*, because it measures where the vendor guesses. That is a real product claim — and it is only
true if we actually measure every point rather than quietly interpolating when the sweep gets long.
**Interpolation is therefore a named anti-pattern for this epic, not a fallback.**

### 2.2 The practitioner's manual method — and the two things it borrows

The community method for the Afterburner curve editor: pick a voltage point, raise it to the target
frequency, **flatten every point to the right of it**, stress-test, repeat in ~20 MHz increments until
instability ([FPSHeaven](https://fpsheaven.com/nvidia-gpu-overclocking-and-undervolting-guide/),
[ASUS ROG / GPU Tweak III](https://rog.asus.com/articles/guides/how-to-undervolt-your-graphics-card-with-gpu-tweak-iii-for-lower-temperatures/),
[xilly.net 2026 guide](https://www.xilly.net/blog/nvidia-gpu-overclock-undervolt-guide)).

Two borrowings, and one rejection:

- **"Flatten to the right" is the industry's ceiling** — it is the same operation as KAGO's cap
  (`offset_i = min(Δ, cap − F_i)`), and it exists for the same reason: without it the raise is taken as
  SPEED instead of as saved voltage (`researches/02` §6.2). Independent confirmation of a mechanism this
  project derived on its own.
- **Small increments near the edge** — 20 MHz is the community's step; ours is one measured voltage grid
  step (5 mV), which is finer and is what rail S2 already enforces.
- **REJECTED: one point tuned, the rest flattened.** That is a single operating point, not a curve, and
  it is exactly the shape the owner cancelled (*«ты дрочишь целую неделю одну точку»*, EXP-0056).

### 2.3 The silicon-characterization name for what we are producing: a **shmoo plot**

Sweeping a pass/fail test across a voltage × frequency grid is standard silicon bring-up practice and
has a name: the **shmoo plot**
([Design & Reuse](https://www.design-reuse.com/articles/47330/understanding-shmoo-plots-and-various-terminology-of-testers.html),
[EDN — silicon debug guidelines](https://www.edn.com/silicon-debug-challenges-and-guidelines/)).
The relationship it exposes: Vmin is bounded by **setup-timing violations**, so failures increase as
frequency rises at a fixed voltage — i.e. **Vmin is monotonically non-decreasing in frequency**
([SemiEngineering — Optimizing Vmin With Path Margin Monitors](https://semiengineering.com/optimizing-vmin-with-path-margin-monitors/)).

**This is the single most valuable finding in the sweep, and §4 spends it:** monotonicity turns the
owner's algorithm from an O(points × rungs) march into an O(points + rungs) walk, without changing one
word of what it produces.

**Boundary, stated so nobody over-claims it:** monotonicity is a property of *timing-limited* failure.
It is a strong prior for ordering the search, **never a licence to skip a measurement** — the engine
uses it to choose where to START each descent, and still burns every rung it reports.

### 2.4 Crash-driven search is an established pattern, with an established shape

US patent 8,312,311 (*automatic overclocking*) describes the loop the owner's steps 11–13 describe:
raise, test, **reboot on crash**, and on the next boot **read back the parameters that were in effect
before the crash** and treat them as the limit
([USPTO 8312311](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8312311); the same
crash-then-resume shape appears in [USPTO 12399621](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12399621),
automated memory overclocking).

**The engineering requirement it names:** the parameter under test must be on **stable storage BEFORE
it is applied**, or the crash erases the very fact the crash was supposed to teach. This is a
write-ahead journal, and KAGO does not have one — today's engine persists a verdict *after* a step
returns, which is precisely the record a hang destroys.

### 2.5 Test duration: the industry says our 10 s is a PROBE, not a proof

Practitioner consensus is minutes-to-hours, not seconds: a looping benchmark for a few hours after
curve tuning, plus long real-game sessions as the true test
([FPSHeaven](https://fpsheaven.com/nvidia-gpu-overclocking-and-undervolting-guide/),
[xilly.net](https://www.xilly.net/blog/nvidia-gpu-overclock-undervolt-guide)).

**Honest handling of one claim that did NOT survive checking.** A search summary attributed to
[XDA](https://www.xda-developers.com/undervolting-is-great-but-you-need-to-properly-test-stability/)
the statement that stress tests exercise upper frequencies and therefore miss instability at partial
load. **Fetching the article did not confirm it** — the page discusses tool choice and a five-minute
benchmark for *performance* certification, not low-clock instability. The claim is therefore **not
cited to that source**. It happens to be true on this project's own evidence — `--lowload` exists
because an undervolt can survive every heavy test and die on a browser click (`AGENT_GUIDE.md` →
harness) — and that is the evidence the epic will lean on: **ours, measured, not a snippet.**

**Implication:** the owner's 10 s (step 9) and 3 min (step 15) are two different instruments, and the
epic must say so out loud. 10 s finds the gross edge cheaply; 3 min qualifies a point; neither is
"hours", and the closing argument for the shipped curve is his own play sessions plus the convergent
loop (`GOAL.md`), not a duration.

---

## 3. Local recon — the search space, MEASURED on this card today

**Provenance:** `npm run nvapi -- --curve` (read-only NvAPI) + `nvidia-smi -q -d SUPPORTED_CLOCKS`,
2026-08-15 15:3x, driver 610.88. Zero writes. Re-derivable from the two commands above.

### 3.1 The two grids the algorithm asks for (steps 3–4)

| Grid | Measured | Note |
|---|---|---|
| **Frequencies** | **389 distinct values, 180 … 3090 MHz, steps of 7 and 8 MHz** | The card's own ladder. 3090 is `clocks.max.graphics` — the R13 ceiling |
| **Voltages** | **127 graphics points, 450 … 1240 mV**; spacing **5 mV ×94** and **10 mV ×32** | The V/F table IS the voltage grid: there is no finer voltage the card can be asked for. Point 127 (515 mV / 405 MHz) is an outlier, excluded everywhere |

**The voltage grid is not uniform, and that matters for the algorithm's "снижается напряжение на шаг
ниже".** A "step" is the next point down, which is 5 mV in 94 places and 10 mV in 32. The engine must
step by POINT, and report millivolts; stepping by a fixed 5 mV would ask for voltages the card does not
have.

### 3.2 The search space is 74 knobs, not 389 frequencies — and this is the epic's central number

| Fact | Value | What it means |
|---|---|---|
| Graphics points on the curve | 127 | the vector's full width |
| …sitting on the 180 MHz floor | **44** | no stock frequency to search — but these are the *levers* that serve low clocks cheaply, not dead weight |
| …sitting **above the card's own 3090 MHz max** | **9** | the card will never run them. **This is the 82 MHz gap `bugs/11` escaped through** (curve top 3172 vs. card max 3090) |
| …**in the working band** | **74** (725 mV / 195 MHz … 1185 mV / 3090 MHz) | the points a sweep can actually exercise |
| Distinct serving points for all 389 ladder frequencies | **75** | |
| Ladder frequencies per serving point | **min 1 · max 19 · mean 5.19** | **walking all 389 frequencies tests the same knob 5.19 times on average** |

**Under a pinned clock C, exactly one curve point serves C** (`vf-step.voltageForClock`, proved). So
"for every frequency find the minimum voltage" and "for every voltage point find the maximum safe
frequency" are the same table read from two sides — and the card has only **75 sides**. Enumerating by
serving point is **not a narrowing of the owner's algorithm**: it is the identical answer written in
the hardware's own coordinates, at one fifth of the cost.

### 3.3 The lever runs out before the card does — and it is worst in the middle

Raising a low point to serve a high clock is an offset, and the offset is bounded by the hardware's
±1000 MHz. So the deepest reachable voltage at a given frequency is set by **our lever**, not by the
silicon:

| Frequency | Stock voltage | Deepest the lever can reach | Available | Rungs |
|---|---|---|---|---|
| 3090 | 1185 mV (point 117) | 835 mV (point 61) | **350 mV** | 56 |
| 2842 | 1045 mV (point 95) | 800 mV (point 56) | **245 mV** | 39 |
| 2400 | 910 mV (point 73) | 785 mV (point 53) | **125 mV** | 20 |
| **2000** | 815 mV (point 58) | 765 mV (point 50) | **50 mV** | **8** |
| **1700** | 795 mV (point 55) | 750 mV (point 48) | **45 mV** | **7** |
| 1100 | 770 mV (point 51) | 450 mV (point 0) | **320 mV** | 51 |
| 500 | 745 mV (point 47) | 450 mV (point 0) | **295 mV** | 47 |

**Consequence the engine must be able to SAY, not swallow:** across roughly 1700–2400 MHz the sweep
will exhaust the lever after 45–125 mV and stop **without having met the card's edge**. That is a
different verdict from "край найден", and reporting it as the edge would be a lie of exactly the class
this project keeps paying for. A third verdict is required: **`LEVER-LIMITED`** — measured, honest,
and not an edge.

(This table reproduces `STATUS.md`'s «Сколько андервольта ДОСТУПНО» from an independent recomputation
today; the two agree, which is what makes it a pair rather than a memory.)

### 3.4 What the code already has, and what it is missing

**Has** — and none of it needs rewriting:

| Capability | Where | Note |
|---|---|---|
| Read the curve, write a per-point vector, zero it | `nvapi.mjs` (`readVfCurve`, `writeCurve`, `zeroCurve`, `buildRaiseAndCapVector`) | one writer, R1 |
| One atomic judged step with rollback in `finally` | `vf-step.mjs` (`runStep`) | the search's atom |
| Verdict by the diverse set, worst wins, named | `stress-tester.mjs` (`judgeCandidate`, `DIVERSE_SET`) | fact 37, proved live |
| Ratchet with per-point history, quarantine by stamp | `vmin-store.mjs` | 38 blocks |
| Clock **PIN** with release in `finally`, abort on failed release | `ladder-descent.mjs` | 39 blocks — **this is step 7's mechanism, already built and mutation-proved** |
| Armed watchdog, drilled at 2.5 s | `watchdog.mjs` | R9 |
| Ceiling guard against the card's own max | `profile-manager.mjs` (R13) | born from `bugs/11` |
| Profile format carrying a per-point vector | `profile-store.mjs` (`deltaByPointMhz`) | `plans/12` |

**Missing** — and this is the epic's actual work:

1. **The two grid dictionaries as artifacts** (steps 3–4). Read today, stored never.
2. **The tuning-curve document** with per-point `{frequency, voltage, status, date}` and a profile that
   REFERENCES it (steps 1–2, 5). Today's profile embeds a bare integer array.
3. **The outer sweep** over the whole range (step 6). Today's `searchEdge` searches ONE cap.
4. **Pin-based search.** Today's search holds the region under test with a curve CAP, which cannot go
   below `top − 1000` = 2157 MHz (fact 38) — **so more than half the range is unreachable by today's
   engine**, and the owner's step 7 (a hard pin) is precisely the fix.
5. **Write-ahead journal + crash attribution + resume** (steps 11–13). The one genuinely new
   architectural organ.
6. **The `LEVER-LIMITED` verdict** (§3.3).
7. **The long-burn qualification pass** (step 15).
8. **Three profiles derived from one curve** (steps 16–18).

### 3.5 The rules that bind this epic — all of them already paid for

| Rule | Source | What it forbids here |
|---|---|---|
| **S1** — live curve writes only with the owner at the machine | `GPU_TUNING_RAILS.md` §0, `bugs/03` (5 h 40 min hang) | an unattended sweep — **and the owner's algorithm expects reboots, so this is the epic's one real fork (§6)** |
| **S2** — the first step is the shallowest | rails §0, `bugs/03` | a descent that starts deep. **The owner's algorithm satisfies S2 by construction** — it starts at stock and steps one grid rung |
| **S3** — every write under an armed watchdog; rollback is a LIST, not a chain | R9, R10a | a direct `nvapi` write outside the rails |
| **R13** — never above the instance's own maximum (3090) | `bugs/11`, the BSOD of 2026-08-15 09:59 | any vector offering a clock above 3090 — the 9 points of §3.2 |
| **R6** — driver/VBIOS stamp on every record | phase 1 | a curve document without its stamp |
| Evidence is keyed by the axis that does NOT move | `bugs/10`, EXP-0053 | keying by frequency: the curve slides ≈ −1.7 MHz per °C along the frequency axis; **the voltage axis is immovable, so the key is the point index** |
| A guard is believed only after it has gone RED | EXP-0008, EXP-0016 | a selftest whose mutations were not addressed by name before the run |
| The plan must print the depth the RUN will walk | `bugs/09`, EXP-0052 | a `--dry-run` that advertises a ladder deeper or shallower than the real one |
| Method is the agent's authorship; risk appetite on his machine is his | EXP-0026 | asking the owner about step sizes, order, or workload choice |

---

## 4. The arithmetic that sizes the epic

One rung = one voltage step, tested. Cost per rung = 10 s burn (owner's step 9) + overhead
(curve write, pin apply, read-back until two samples agree, workload launch, oracle, event-log query)
≈ **25 s**, taking today's measured lease shape as the reference (a 3-shape set at 30 s each ran under
a 150 s lease).

| Strategy | Rungs | Wall time | Verdict |
|---|---|---|---|
| **Literal**: all 389 frequencies × descend from stock at 5 mV each time | ≈ 9 700 | **≈ 67 h** | not executable |
| **Collapsed**: one representative frequency per serving point (75), still from stock at 5 mV | ≈ 1 900 | **≈ 13 h** | still not an evening |
| **Collapsed + the owner's STEP LADDER** (§4.1) — from stock every time, no prior assumed | ≈ 700–1 000 | ≈ 5–7 h | the fallback shape, used per-frequency whenever the seed is refused |
| **+ the owner's SEEDING** (§4.2): start each next frequency's descent at the higher frequency's already-tuned voltage | **≈ 250** | **≈ 1.7 h**, splittable by band | **THE SHIPPED PLAN** — authorized by the owner 2026-08-15 |

### 4.1 The owner's step ladder — coarse where failure is improbable, fine where it is near

His words, 2026-08-15 (verbatim in `GOAL.md` → «📐 ЛЕСТНИЦА ШАГОВ СПУСКА»): 25 mV for the first
100 mV below stock · 10 mV (the minimum step ×2) from 100 to 150 mV · 5 mV below 150 mV. Rungs to
reach depth *d*: `min(d,100)/25 + clamp(d−100,0,50)/10 + max(0,d−150)/5`.

| Frequency | Available depth | Rungs at 5 mV throughout | Rungs on his ladder |
|---|---|---|---|
| 3090 | 350 mV | 70 | **49** |
| 2842 | 245 mV | 49 | **28** |
| 2400 | 125 mV | 25 | **7** |
| 2000 | 50 mV | 10 | **2** |
| 1700 | 45 mV | 9 | **2** |
| 1100 | 320 mV | 64 | **43** |

**It composes with two rules already in the code, and breaks neither:**

- `ASCENT_FIRST_STEP_MAX_MV = 25` and `ASCENT_STEP_MAX_MV = 35` (the `bugs/03` governor) — his first
  step is exactly 25 and his largest gap is 25. **The guard is not weakened; it is satisfied.**
- **A failure found on a coarse rung MUST be refined at 5 mV before the +10 mV margin is applied.**
  His own margin rule is conditioned on it: *«Если нашли шагами по 5 мВ точку отказа…»*. Without the
  refinement, «V_fail + 10 mV» would name a voltage nobody ever burned.

**It supersedes `FAST_DESCENT_FLOOR_MV = 900` (absolute voltage) — and the two agree where the old one
was stated.** At 2842 MHz stock is 1045 mV, so his 150 mV boundary lands at 895 ≈ 900. But an absolute
key does not travel: at 1700 MHz stock is already 795 mV, below 900, so the old rule would crawl at
5 mV through a band that offers only 45. **Depth-from-stock is the key that works everywhere.**

**Its honest cost, stated once:** a 25 mV step approaches the edge coarsely, and failure at the edge is
an avalanche (§2, `researches/02`). So a coarse rung is likelier to HANG than to be caught by the
oracle. The owner accepted that risk explicitly the same day, and the ladder is shaped around it —
coarse only where failure is improbable.

### 4.2 Seeding: the agent deferred it, the OWNER switched it on — and named the exception himself

**The agent's position, recorded because it was wrong to hold and is useful to keep:** the prior of
§2.3 is sound silicon physics and it is still a PRIOR. Seeding means the descent JUMPS to a deep
voltage instead of walking to it — the exact shape of `bugs/03` («the sweep started the ascent at a
deep rung and hung the machine»), which `pickAscentRungs` refuses by design. So the agent planned to
walk from stock first and let the sweep MEASURE the prior before spending it.

**The owner read that reasoning and decided otherwise the same day**, in three messages:

> *«можно начинать спуск не со стокового напряжения, а с верхней по частоте отюненной точки»*
>
> *«как правило на более нижней частоте будет напряжение нужно или такое же как у старшей по частоте
> точки, или даже ниже, очень редко — выше, почти не бывает такого»*

**Two things make this a good decision rather than merely an authorized one.** First, his rule is the
same statement §2.3 arrived at from silicon-characterization literature — two independent sources, one
practitioner and one industrial, agreeing on the shape of Vmin(f). Second, **he stated the exception
himself** («очень редко — выше»), which is exactly the fact a safeguard needs in order to be designed
rather than hoped for.

**How the jump is made honest — three mechanisms, none of which soften his decision:**

1. **The first-step governor is GENERALIZED, not disabled.** Today it refuses a first step deeper than
   `ASCENT_FIRST_STEP_MAX_MV` **below stock**. The correct generalization: below **the deepest voltage
   already PROVEN by evidence**. With no evidence, proven = stock, so today's behaviour is the
   degenerate case — and that identity is the mutation this change must survive (EXP-0008).
2. **The seed is the neighbour's PASSING value** (its edge + 10 mV), never its failure voltage.
3. **A non-PASS on the seed cancels seeding for that frequency**, drops the descent back to stock on
   the owner's ladder, and is REPORTED as a finding about this silicon rather than swallowed as a
   failed run (E2-AC11). That is his rare case, made visible instead of assumed away.

**What the first sweep therefore still delivers:** a measured Vmin-versus-frequency curve, plus a count
of how many points needed the fallback. If that count is zero, monotonicity is confirmed on this card
by 74 observations; if it is not, the exceptions are named with their frequencies.

### 4.2a Long-burn duration: one minute, and it is the owner's ORIGINAL figure

*«Длительные прожиги сокращаем с 3 минут до 1 минуты»* (2026-08-15), amending step 15 of `ideas/03`.

**This is a return, not a relaxation.** On 2026-08-10 he said *«было бы здорово мерить… на длительных,
например, минуту»*, and `plans/05` P5-AC6 has stood at **≥ 60 s per shape** ever since. Three minutes
was the outlier in his own record.

**What a minute does NOT buy, said so nobody assumes it does:** neither one minute nor three reaches
thermal equilibrium — measured, the plateau arrives at **395–753 s** under load (fact 34+36). Burn
duration buys **error-detection probability**, not a thermal state. The thermal question has its own
instrument (`thermal-ladder.mjs`) and is not this pass's job.

**Where the minute is spent — agent's decision:** 60 s per point using the shape that DECIDED that
point's edge during the search (it is recorded in the evidence). `--lowload` gets its own whole-curve
pass instead of a per-point one: it exercises the BOTTOM of the range, so running it under a pinned
high clock would test nothing it exists to test.

### 4.3 Reboots are the owner's job, and that DELETES a subsystem

He settled it the same day: *«человек будет за компом во время тюнинга и поиска края. Человек будет
комп из экранов смерти перезагружать»*. The plan had called for the sweep to resume itself on boot —
i.e. a scheduler task that WRITES TO THE GPU on every startup. That task is now unnecessary: the resume
is a command he runs, and the journal is what makes the command continue instead of restart.

**This is a safety gain, not only a simplification.** `bugs/11` — the BSOD — happened on the
apply-at-logon path. Putting the edge sweep, whose whole job is to write unproven voltages, into that
same boot path would have installed the project's most dangerous operation into startup.

**Reboot cost, named rather than hidden.** Each *new* edge discovery is one failure. With seeding, the
number of failures across the sweep is bounded by the number of distinct voltage rungs the edge
crosses — realistically tens, not hundreds. A failure caught by the oracle (SDC) costs seconds; a
failure that hangs the machine costs a reboot (~3 min) plus resume. **Expectation, stated as an
expectation and not a promise:** at 5 mV past a proven-safe rung the failure regime is the one
`researches/02` §2 measured — errors climbing 3 % → 90 % across 2 % of voltage — so the oracle should
see corruption before the OS dies more often than not. The epic is planned to survive the other case,
not to bet against it.

**Long verification (step 15):** 75 points × 180 s ≈ **3.75 h** of burn plus overhead, ≈ 5 h — a
separate phase, and splittable by band because each point is independent.

---

## 5. Findings → implications for the epic

1. **The deliverable is one document — the tuning curve — and everything else references it.** Three
   profiles, one measured curve, one ratchet. This is the owner's steps 1–2 and it collapses the
   project's current sprawl (a scalar in the profile, a ratchet store, a per-point vector) into one
   artifact with a status and a date per point.
2. **Search by serving POINT, report by FREQUENCY.** 5.19× cheaper, identical table, and it is the
   hardware's own coordinate system. **Record this as a decision made without the owner, with the
   arithmetic** — it is method (EXP-0026), and it changes cost, not answers.
3. **The pin replaces the cap in the SEARCH, and that unlocks the bottom half of the range.** A curve
   cap cannot hold anything below 2157 MHz (fact 38); a pin holds any frequency on the 389-rung ladder.
   The pin is a MEASUREMENT instrument and never ships — `min = max` would forbid the card from
   clocking down (the owner's own requirement).
4. **Monotonicity is SPENT as a seed from the first sweep — the owner's call, with his own exception
   built in** (§4.2). The seed is the neighbour's passing value; the first-step governor is generalized
   from «below stock» to «below what evidence proves»; a non-PASS on the seed cancels it for that
   frequency, falls back to stock, and is reported as a finding. The sweep still MEASURES the prior —
   the count of fallbacks is the measurement.
4a. **The descent's step size is the owner's ladder** (25 / 10 / 5 mV by depth from stock, §4.1). It
   satisfies the `bugs/03` governor exactly, supersedes the absolute 900 mV floor, and requires one
   addition of its own: **a coarse-rung failure is refined at 5 mV before the +10 mV margin applies.**
5. **`LEVER-LIMITED` is a first-class verdict.** In 1700–2400 MHz the sweep will end on our lever, not
   on the card's edge, and saying otherwise would be a false `[TESTED]`.
6. **The write-ahead journal is the epic's one new organ**, and the industry shape (§2.4) matches the
   owner's steps 11–13 exactly: record the intent BEFORE the write; on boot, an intent with no verdict
   IS the failure.
7. **Two instruments, two durations, said out loud.** 10 s = probe (finds the edge), **60 s = qualifier**
   (step 15, amended by the owner 2026-08-15 — and it is his original figure, §4.2a), and the
   industry's "hours" is answered by the convergent loop plus the owner's own play sessions — not by
   pretending 10 s is a proof. **Neither duration reaches thermal equilibrium (395–753 s); that is a
   different instrument's job.**
8. **The 9 points above 3090 MHz are the `bugs/11` gap and get an explicit rule**: they can never serve
   a runnable clock, so they are never raised, and R13 refuses any vector that would offer more.
9. **The owner's algorithm is safer than the engine it replaces** on the one axis that has hurt this
   project twice: it starts every descent at stock and moves one grid rung at a time, which is rail S2
   by construction rather than by a guard bolted on afterwards.
10. **It is also stronger than the vendor's own tool** (§2.1) — measured points where NVIDIA
    interpolates. That claim survives only if we never interpolate to save time.

---

## 6. Forks — ALL CLOSED BY THE OWNER ON THE DAY THIS DOCUMENT WAS WRITTEN

**FORK 1 — the sweep expects reboots. May it continue without you in the room? — CLOSED, and it closed
in two moves.**

1. *«зависание компа и перезагрузка — осознанный риск. Мы уже поняли, что не можем гарантировать, что
   комп не зависнет при поиске края»* — the premise. A hang stops being an incident and becomes a
   normal verdict path: `ЗАВИС` is first-class, and the write-ahead journal is what makes it usable
   rather than merely survivable.
2. *«человек будет за компом во время тюнинга и поиска края. Человек будет комп из экранов смерти
   перезагружать»* — the presence half, and it is **option A**. It also deletes the boot-time resume
   task the plan had budgeted for (§4.3).

Both verbatim in `GOAL.md`; `interviews/007` is closed by them.

**FORK 2 — none. Nothing else in this epic requires his word.** The step ladder he supplied
unprompted (§4.1) closed the one remaining method question that had cost estimates attached to it.

**Still a REPORT rather than a fork, and he must hear it before the sweep starts:** the mid-band lever
wall (§3.3) means «для всех частот найдены минимальные напряжения» will be true at the ends of the
range and **lever-limited** in the middle — through no fault of the method and with no way around it on
this control path.

**NOT forks — decided by the agent and recorded in the epic's §8:** search order, the collapse to
serving points, the seeding prior, the step size, the workload set, the shape of the journal, what
happens to the 9 unreachable points. All method, all cheap to reverse.

**NOT a fork, but he must be TOLD before the sweep starts:** the mid-band lever wall (§3.3) means «для
всех частот найдены минимальные напряжения» will be true for the ends of the range and
**lever-limited** in the middle — through no fault of the method and with no way around it on this
control path.
