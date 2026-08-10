# Plan 05 — Epic 01 / Phase 5: the Vmin search engine and the guardband

> **Created:** 2026-08-10 17:04 +03:00 (agent, on the owner's instruction *«делаем срез чата и в новом
> чате начнём с планирования»*)
> **Parent:** `plans/01_EPIC_kago_orchestrator.md` — phase 5. Evidence base: `researches/02` (the Vmin
> method, **read §6 before §3**) · `researches/04` §2 (the throughput observable) · `researches/05` §8
> (the write path) · `plans/04` §5 (the phase-5 work already done as drift)
> **Status:** 🔲 open · written BEFORE the first planned line of phase-5 code, which is the whole point
> (EXP-0027) · entry gate NOT yet green — see §2
> **Outbound:** the margin policy → `interviews/interview_004_margin_policy.md` (the owner's risk
> appetite, with the arithmetic quoted) · the measured Vmin table → `interviews/interview_003` (N, already
> open) and phase 6's profile assembly · the profile's SHAPE decision → `PROJECT_ARCHITECTURE_INTERNAL_MAP.md`
> (R1/R2) · closure → `MASTER_PLAN.md` phase 5 and the plan for phase 6

---

## 0. WHY THIS PLAN EXISTS BEFORE ITS PHASE, AND THE WAIVER IT CARRIES

Phase 4 ran a full day without an operational plan and the work wandered into phase 5 while doing it
(`plans/04` §0 and §5; EXP-0027). The owner's fix was procedural and explicit: *«планы под это у тебя
написаны операционные? или ты импровизируешь? нужно работать по плану»*, then *«делаем срез чата и в
новом чате начнём с планирования»*.

**So this document is the first artifact of the new session, and it carries one recorded waiver.**
The epic's §4 says: *«Каждая фаза дополнительно закрывается проходом `/fable-judge` до того, как будет
написан операционный план следующей»*. Phase 4 is not closed — steps 4.7 (fans) and 4.8 (judge) are
open. Writing this plan ahead of that gate is the owner's instruction, and per EXP-0027 the waiver is
written down **on the same day** instead of living in a chat message:

| Condition | State | Disposition |
|---|---|---|
| `/fable-judge` pass over phase 4 | 🔲 not run | **Waived for WRITING this plan; NOT waived for EXECUTING it.** It is this plan's entry gate (§2). |
| Phase 4 step 4.7 — fans | 🔲 not done | Blocks step 5.7 only (matched thermal state), and that dependency is named there rather than assumed away. |

**What the waiver does not buy:** no step below may be executed until §2's gate is green. A plan is
allowed to exist ahead of its gate; code is not.

## 1. Goal vector

**The pain.** KAGO can now raise the V/F curve, judge a step with the full oracle, roll back, and
measure watts (`plans/04` §4.6, fact 20). What it cannot do is find **how far** the curve may be raised
and **stop at a defensible distance from the edge**. Everything measured so far is one workload, one
shape, thirty seconds, no margin, no memory — `--ascend` stopped at OUR ceiling without meeting a
failure, so the card's actual limit has never been observed. A number obtained that way is not a
profile, and `researches/02` §6.4 names exactly why: the edge is a **failure probability, not a line**,
so a single PASS says only *"this run did not catch it"*.

**Where we want to be.** For every operating point of this card's curve, a measured failure threshold
taken as the **worst verdict across a diverse workload set**, bracketed rather than stepped onto,
carrying **the history of every verdict it ever produced**, with a margin computed by a named policy —
and a whole-curve candidate that survived a long burn. The deliverable of the phase is the **measured
Vmin table plus the engine that produced it**, not a shipped profile: assembly and acceptance are
phase 6.

**Goal types.** *Achieve* — the measured table and `engine.mjs`. *Maintain* — factory state as the
default on every path, and the ratchet (a point that ever failed is never lowered again). *Avoid* — a
candidate that parks the card inside the silent-corruption region.

## 2. Entry gate

From the epic §4, quoted: phase 5's entry is *«ворота выхода фазы 4 зелёные»*. Restated from `plans/04`
§7, with today's state:

| Gate | State | Evidence / what is missing |
|---|---|---|
| Read-after-write on the curve agrees | ✅ | `plans/04` §4.4 — three points, byte-exact rollback over 9 248 bytes |
| Voltage grid step measured on the live curve | ✅ | 5 mV, `VOLTAGE_GRID_STEP_IS_MEASURED = true` |
| Fans give a repeatable starting state | 🔲 | `plans/04` §4.7 — not started |
| `/fable-judge` pass over phase 4 | 🔲 | `plans/04` §4.8 — not run |
| Watchdog armed and PROVEN by firing | ✅ | 2.5 s from an abrupt writer death to a restored card |

**Order of work this session:** close `plans/04` §4.7 and §4.8 → then execute this plan from §4.1.
Nothing here starts earlier.

## 3. Acceptance criteria for this phase

Written per `REQUIREMENTS_FRAMEWORK.md` — Scale · Meter · Target, so a future session re-runs them
instead of judging them.

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **P5-AC1** | Every closed threshold rests on the FULL three-way oracle — checksum against the golden, the Windows fault log over the same window, AND throughput. "It didn't crash" is not a verdict. | Scale: closed thresholds whose record carries all three observations · Meter: the ratchet store's records · **Target: 100 %, and `UNKNOWN` recorded as a stop, never as a PASS** |
| **P5-AC2** | The edge is BRACKETED, never stood on. | Scale: MHz between the last PASS and the first non-PASS at a point · Meter: the search log in the store · **Target: ≤ `ASCENT_FINE_MHZ` (15 MHz ≈ 5 mV), and a rollback executed at the failing offset within the same step** |
| **P5-AC3** | A point's threshold is the WORST over the diverse set, never the first one found. | Scale: distinct load shapes each closed point was judged by · Meter: the store, per point · **Target: ≥ 3 shapes (`sdc_fma --sustain`, `branchy --sustain`, `--transient`), and the stored threshold equals the minimum passing offset across them** |
| **P5-AC4** | Nothing is called a candidate at V_fail: a margin from a NAMED policy is applied, and the policy is recorded with the number. | Scale: mV between the measured V_fail and the candidate's operating point · Meter: the policy function + the candidate record · **Target: ≥ 25 mV in `guardband` mode (`config.guardbandMillivolts()`); ≥ 1 measured grid step (5 mV) in `ratchet` mode; the mode named in the record** |
| **P5-AC5** | The ratchet holds: a point that ever failed is never lowered again. | Scale: closed points whose final offset is ≥ any offset that ever failed there · Meter: a selftest block over a store fixture carrying a past failure · **Target: 0** |
| **P5-AC6** | A whole-curve candidate survives a LONG burn, not an express test. | Scale: seconds of sustained load per shape at the candidate, with the verdict · Meter: `stress --sustain 60` per shape + `--lowload` + `power --capture` · **Target: ≥ 60 s per shape, all PASS, and the compared sides' start temperatures within 3 °C** |
| **P5-AC7** | The profile's SHAPE is decided by measurement, not by preference: is the safe offset the same across the operating band, and can the ceiling live inside the curve? | Scale: max passing offset per tested cap (≥ 3 caps) and the delivered clock under a flattened tail · Meter: §4.5 and §4.1 runs · **Target: a number per cap with the spread stated, plus a yes/no on the in-curve ceiling backed by `clocks.gr` under load** |
| **P5-AC8** | The watt payoff is stated as a measured effect, not a single reading. | Scale: watts saved at the same delivered clock, with the meter's own floor beside it · Meter: `power --spread` over TWO independent series (EXP-0018) · **Target: two series, pooled floor quoted, delta thicker than it — −14.67 W and −7.71 W are both single-sourced and neither satisfies this** |
| **P5-AC9** | The PRICE is stated on an observable that can carry it, and each observable keeps its own job. | Scale: which field each claim rests on · Meter: the automatic gate reports the **delivered clock** (exact to the hardware grid); **ops/s** is reported as the clock-stretching detector it was built to be; the performance PERCENTAGE comes from the owner's manual 3DMark run (interview 001, Q1 = A) · **Target: no percentage claim resting on ops/s across runs — measured 4.3 % stock-to-stock scatter (EXP-0030)** |

## 4. Steps

Every step names the meta-plan line it executes (the citing rule, `AGENT_GUIDE.md` checklist step 8).
Fresh code is born `[NOT-TESTED]` and flips only on observation (`TESTING_FRAMEWORK.md`).

### 4.1 — ONE curve writer, taking a VECTOR — and the experiment that decides the profile's shape 🔲

*Anchor: `researches/02` §6.5 — «A profile = raised curve + clock ceiling. The ceiling is part of the
profile, not an option.»*

Two things are settled here at once, because they are the same code.

**(a) The duplication is real and it is load-bearing.** The 128-point write/zero loop is open-coded
**five times in `vf-step.mjs`** and **once in `watchdog.mjs`** — and the copies already disagree:
`vf-step` iterates `CLK_VF_POINT_COUNT - 1` (point 127 excluded by measurement), `watchdog` iterates all
128. Harmless today (127 never moves), and exactly the shape of a defect class: one place must own
"point 127 is not a graphics point", "a rollback zeroes everything, not a difference", "status 0 is not
verification — read it back" (EXP-0024).

- [ ] `nvapi.mjs`: `writeCurve(nv, handle, offsetsMhz)` taking an ARRAY (a scalar is the array filled),
      `zeroCurve()`, and `readCurveOffsets()` — one implementation, point 127 excluded in one place.
- [ ] Every existing call site rewritten onto it; `watchdog`'s loop included, so the total undo has one
      author. No behaviour change intended → prove it by a byte-exact golden: `--prove-mask 64 -15`
      before and after the refactor must produce the same block list (`BUG_FIXING_FRAMEWORK.md` → Guards).

**(b) The ceiling lives inside the curve, and this is no longer a hypothesis — THE OWNER SETTLED IT.**
Asked whether to run this experiment, he answered with the requirement instead (chat, 2026-08-10):

> *«Я хочу, чтобы карта сама могла и разгоняться и снижать частоты, но работала на пониженном напряжении
> согласно кривой VF профиля»*

So `-lgc` is retired as a profile mechanism (full reasoning: `AGENT_GUIDE.md` → Notes from the human).
`ladder.candidateProfile()`'s `{min: mhz, max: mhz}` is a **PIN**: the card can go neither up nor down, so
at idle it would hold the locked clock instead of dropping to 180 MHz. Correct for a MEASUREMENT, wrong
for anything he boots into.

**THE VECTOR, as arithmetic.** With `F_top` = the stock curve's highest frequency and `Δ` = the raise:

```
offset_i = clamp(F_top − F_i , 0 , Δ)
```

Points well below the top take the full `Δ`, so every frequency they serve now needs less voltage; points
near the top take a SMALLER offset, so none can offer more than `F_top` and the maximum boost is provably
unchanged — which is what keeps the savings from being spent on speed (`researches/02` §6.2). Two
properties make this the safest shape available, and both were found by doing the arithmetic rather than
by planning: **every offset is non-negative** (the earlier draft of this step assumed the tail would need
NEGATIVE offsets — it does not), and `min(F_i + Δ, F_top)` preserves monotonicity, so the curve cannot be
made non-monotone by construction.

- [ ] `buildRaiseAndCapVector(points, deltaMhz)` — the formula above, as a pure function with its own
      offline blocks: full Δ in the middle, a shrinking offset at the top, offset 0 on the top point,
      monotonicity preserved, and nothing negative anywhere.
- [ ] Apply it with **no `-lgc` at all**, under the watchdog; load the card; read `clocks.gr` until two
      consecutive samples agree (EXP-0014). Expect the stock maximum, **not more**.
- [ ] **Then observe the card at IDLE under the same vector: it must still drop to the idle range.** This
      is the property a pin destroys, and it is the owner's requirement stated as a check.
- [ ] Confirm the undervolt itself by curve read-back: the point serving the top frequency must be a
      LOWER-voltage point than at stock (`voltageForClock`, already written and proved).
- [ ] Rollback: `zeroCurve()` in a `finally`, 0 non-zero of 128 verified.

**Verification by observation:** the delivered clock under load (= stock max, not above), the idle clock
under the same vector (= still falling), the serving point's voltage (= lower), and a byte-exact
rollback. **P5-AC7 half one.**

#### DONE 2026-08-10 — the evidence, and the three things it taught

`npm run vfstep -- --shape --mhz 45 [--cap-at N]`, both sides cooled to 42 °C first, no clock lock at
any point. Offline half: `npm run nvapi -- --selftest-shape`, 17 blocks, mutation-proved with four
mutations against addressees named before the run.

| cap | delivered clock | watts | °C | voltage for the cap | blocks |
|---|---|---|---|---|---|
| **3172 — the curve's TOP** | 2887 → **2932** | 137.3 → 137.1 | 57 → 54 | 1240 → 1200 mV | the cap bound NOTHING |
| **2887 — the stock median** | 2887 → **2857** | 136.95 → **126.42** | 57 → 53 | 1065 → 1040 mV | 15 of 16 |
| **2917 — median + 30** | 2887 → **2887, exactly stock** | 137.15 → **129.44** | 58 → 53 | 1075 → 1050 mV | **16 of 16** |

1. **A cap at the curve's top is not a cap.** The card never reaches 3172 under load — it sits at 2887 —
   so nothing was bound and the raise was taken as SPEED at unchanged watts, exactly as `researches/02`
   §6.2 predicts. The cap must sit at the OPERATING clock. Consequence for the vector: points above the
   cap need NEGATIVE offsets, so "no negative offsets are needed" was true only for a cap at the top.
2. **The card delivers a little BELOW its cap**, so the cap's placement is a knob with a measured
   exchange rate: 2887 → 2857 MHz and −10.53 W; 2917 → 2887 MHz and −7.71 W. **30 MHz of clock costs
   2.8 W.** The `--cap-at 2917` row is the `Max Optimal` candidate shape: the stock clock delivered
   exactly, for 7.71 W (5.6 %) and 5 °C.
3. **THE PRICE METER CANNOT CARRY A 1–4 % CLAIM, and this run is what proved it.** The two STOCK sides
   measured 40 minutes apart gave **15.58 and 14.94 ×10¹² ops/s — 4.3 % apart** while their watts agreed
   within 0.15 % and their delivered clock was identical (2887 both). So phase 2's "price 0.18 %" is a
   WITHIN-series figure and cannot be used across runs (EXP-0018's trap, reproduced on a different
   quantity — now EXP-0030). Until P5-AC8's two independent series exist, **"no performance loss" is
   claimed about the DELIVERED CLOCK, which is a direct observation, and not about ops/s.**

#### THE PRICE OBSERVABLE, settled by the owner's question — and ops/s is NOT it

He asked directly: *«оп/c — это индустриальный стандарт замера производительности для видеокарты?
оверклокеры так и делают?»* **No, and the answer reassigns a role rather than adjusting a number.** The
industry and the overclocking community measure **frames per second and frametime stability**, plus
benchmark scores (3DMark Time Spy / Port Royal / Steel Nomad, Superposition). Nobody tunes a card by
operations per second.

**Why ops/s exists here anyway, and it is a good reason:** it was never built as a performance metric. It
is the **clock-stretching detector** (internal map R4/R4a, `researches/04` §2) — under an unsafe
undervolt a card can quietly skip work while still REPORTING the locked clock, with a correct checksum
and zero events in the Windows log. Work-per-second is the only observable that sees that, and it was
validated against an independently-authored second reading (EXP-0017). That job it does well.

**So the three roles are split, and none of them is "ops/s as the price":**

| Question | Observable | Why this one |
|---|---|---|
| did the card quietly skip work? | **ops/s** — its real job | nothing else sees clock stretching or memory replay |
| what did the profile cost automatically? | **the DELIVERED CLOCK** (`clocks.gr` median under load) | a direct observation, exact to the hardware's 7/8 MHz grid, and it read 2887 vs 2887 while ops/s wandered 4.3 % |
| what is the performance percentage? | **the owner's own 3DMark run**, plus his Palworld session | already his decision — interview 001, Q1 = A, and it is written into the epic's AC5 |

**And automating a graphics benchmark is not an option we are declining out of taste:** third-party GUI
applications are forbidden by `GOAL.md`, FurMark was excluded by the owner himself (interview 001, Q2 =
A), and `researches/03` measured that UNIGINE, 3DMark and OCCT sell automation only in paid editions.
That is the whole reason KAGO writes its own CUDA loads — and it is also why the final percentage was
always going to be one manual run by him.

**What this step does NOT deliver:** a profile. One workload, 30 s, no guardband, one Δ, and the watt
figures are single-sourced. §4.3 (the diverse set), §4.6 (the margin) and §4.7 (the long burn and the two
series) are what turn this shape into one.

### 4.2 — The ratchet store: a point's history IS the state of the search 🔲

*Anchor: `researches/02` §6.5 point 3 — «A point carries the history of every verdict it ever
produced, so escalation is a ratchet rather than a fresh guess.»*

- [ ] `automation-engine/lib/vmin-store.mjs`. One record per (point, offset, shape) attempt:
      driver · VBIOS · workload · shape · seconds · offset · serving point · mV · start temperature ·
      reached temperature · verdict · reason · ISO local stamp.
- [ ] `allowedOffset(point)` as a FUNCTION, not a convention: never above `min(failing offsets) − one
      fine step`. The ratchet is code, so it cannot be forgotten by a session (EXP-0021).
- [ ] **R6 is a quarantine, not a delete:** records stamped with a different driver/VBIOS stop counting
      as evidence and are kept, marked, and reported — a profile whose stamp no longer matches is
      invalid until re-validated, and the history is what says how it got there.
- [ ] Every artefact path derived from a parameter, never a module constant; the selftest sandboxed,
      with a block asserting the production directory did not grow (EXP-0025 — a fixture among real
      records fabricates forensics).
- [ ] `--selftest` with mutations: each guarantee broken one at a time must redden **its own** block
      (EXP-0016), including a fixture only the ratchet rule can fail.

**Verification:** the selftest's completion line PRESENT plus ≥1 failed block per mutation (a crashed
verifier is not a green verifier).

### 4.3 — A point's verdict is the WORST over the diverse set 🔲

*Anchor: `plans/01_EPIC` §4 — «порог точки — худший по всему набору нагрузок, никогда не первый
найденный»; `researches/02` §4.*

- [ ] `judgeCandidate()` — runs the set, returns the worst verdict AND which shape produced it.
- [ ] The set, and why each member is in it:
      `sdc_fma --sustain` (SDC shape — fixed-loop arithmetic corrupts silently) ·
      `branchy --sustain` (crash shape — control-heavy code dies instead) ·
      `sdc_fma --transient` (**the most important one**: voltage noise dominates Vmin, `researches/02` §2).
- [ ] `--lowload` is the FOURTH shape and it runs at whole-curve iterations (§4.7), not at every step:
      it exercises the low end that a capped run never touches, and an undervolt can survive every heavy
      test and die on a browser click.
- [ ] Baselines exist for both workloads (`runs/baseline/sdc_fma.json`, `branchy.json`). Confirm the
      ARGS the engine will run match each golden's stamp — a mismatch must return `UNKNOWN`, and a false
      SDC is worse than a missed one (EXP-0011: a wrong-args run once reported 58 of 58 corrupted).
- [ ] `UNKNOWN` is a STOP in the engine, never progress. Stated as a named branch with its own test.

**Verification:** a fixture run where one shape fails and another passes must yield the failing shape's
verdict as the point's threshold, named.

### 4.4 — `engine.mjs`: coarse ascent → bracket → bisect, and never dwell at the edge 🔲

*Anchor: `MASTER_PLAN.md` phase 5 — «спуск до первого сбоя, бинарный поиск края по сетке»;
`researches/02` §3 step 2. Internal map §1: `engine.mjs` is the only module that DECIDES.*

- [ ] `automation-engine/engine.mjs` — the search loop over the atom that already exists
      (`vf-step.runStep` / `runAscent`), with the store as its memory.
- [ ] Coarse ascent at `ASCENT_COARSE_MHZ` (75 ≈ 25 mV, the owner's coarse mode) to the first non-PASS;
      then bisect between the last PASS and that offset down to `ASCENT_FINE_MHZ` (15 ≈ 5 mV, his fine
      mode = one measured grid step).
- [ ] **Roll back the instant a verdict is not PASS.** The avalanche lives at the edge — 3 % → 90 %
      error rate across 2 % of voltage (`researches/02` §2). The engine never runs a second test at a
      failing offset to "confirm" it.
- [ ] ONE watchdog arm for the whole search, lease renewed from inside every burst (the shape
      `runAscent` already uses), so coverage has no gaps between steps.
- [ ] Every verdict persisted BEFORE the next step — a search that dies must not lose what it learned.
- [ ] **Resume from the store, not from zero**, and refuse to start if a stale watchdog record shows a
      previous run died holding the card (`watchdog --recover` first).
- [ ] `--selftest` on an injected write backend and an injected oracle: the bracket arithmetic, the
      ratchet, rollback-on-not-PASS, the `UNKNOWN` stop, resume. Mutation-proved.
- [ ] `--dry-run` prints the whole search plan and writes nothing.

**Verification:** the selftest offline; then ONE real bracket at one cap, with the store showing a
last-PASS / first-FAIL pair ≤ 15 MHz apart. **P5-AC1, AC2, AC5.**

### 4.5 — Is the safe offset uniform across the band? The measurement that sizes the artifact 🔲

*Anchor: `plans/01_EPIC` §4 — «по каждой точке», read honestly: a curve point is only exercised when
the card actually runs a clock that point serves.*

The mechanism is already proved: under a held clock C, exactly one point serves C
(`vf-step.voltageForClock`), so **the ascent at cap C IS the Vmin search for the point serving C**. Run
it at several caps and the per-point curve falls out of one mechanism.

**AND SINCE 2026-08-10 18:5x THESE THREE CAPS ARE THE THREE MODES** — the owner split the profiles by
objective function (`GOAL.md` → «Четыре режима»), and the split lands exactly on this step's axis: the
ceiling's PLACE is what distinguishes the modes, so the three-cap sweep below is not a survey any more, it
is the measurement that sizes all three at once. **Max Perfomance** = ceiling at the curve's top (already
observed: 2887 → 2932 MHz at unchanged watts) · **Optimised** = ceiling at the stock operating clock
(already measured: stock clock delivered at −7.71 W / −5 °C) · **Silent Cold** = ceiling well below it.

- [ ] Search at ≥ 3 caps spanning the operating band: the stock sustained clock (~2842), the clock-axis
      knee (2392, `plans/03` §4.5), and a mid rung (1800).
- [ ] Report max passing offset per cap, converted to mV, with each run's temperature beside it — the
      curve derates 15–22 MHz over 12 °C (fact 18), so a number without its temperature is not a number.
- [ ] State the verdict: **uniform within one fine step → the profile is one offset plus a flat tail;
      not uniform → the profile is a VECTOR** and the store's per-point history is what fills it.

**Settled by measurement, not by taste:** the shape of the artifact follows from the three-cap table,
and escalating a methodology fork to the owner on the project built to spare him that expertise inverts
its purpose (EXP-0026).

**Verification:** the table itself, three caps, each with its own bracket. **P5-AC7 half two.**

### 4.6 — The margin: two named policies, and the owner's arithmetic goes to him 🔲

*Anchor: `researches/02` §3 step 3 (guardband ≥ 4 grid steps AND ≥ 25 mV) vs `AGENT_GUIDE.md` → Notes
from the human (the owner's convergence loop: one minimal step above failure, whole-curve retest, ratchet).*

These two are not the same number and the collision is already recorded in the canon: *"the likely
reconciliation is that his three numbers describe the SEARCH RESOLUTION while the guardband governs the
SHIPPED OPERATING POINT — but that is the owner's call, not ours, and it goes to him as a question with
the arithmetic shown."* So both are implemented, neither is invented, and the default is the
conservative one until he speaks.

- [ ] `marginPolicy` with two named modes:
      **`guardband`** — `config.guardbandMillivolts()` → max(4 × 5 mV, 25 mV) = **25 mV** above V_fail;
      **`ratchet`** — one fine step (5 mV) above V_fail, then the whole-curve retest and the ratchet
      carry the risk instead of the margin.
- [ ] Default `guardband`: it is the epic's own exit gate (§4). `ratchet` is unlocked only by the
      owner's word, recorded.
- [ ] The record carries which mode produced the number, so a later session cannot mistake one for the
      other.
- [ ] `interviews/interview_004_margin_policy.md` — the question with the SUBJECT QUOTED INSIDE IT (the
      self-sufficient-question rule): the measured V_fail per cap, what each policy costs in mV, and what
      that costs in watts off the §4.5 table. Raised with `npm run ask`, together with the already-open
      `interview_003` (N).
- [ ] Nothing ships at V_fail under either policy — that is not a mode, it is the thing both modes exist
      to prevent.

**Verification:** `guardbandMillivolts()` already carries the arithmetic and reports which half bounds
it; the policy function gets its own blocks plus a mutation. **P5-AC4.**

### 4.7 — The whole-curve iteration: the long burn, at a matched thermal state 🔲

*Anchor: the owner, verbatim — «было бы здорово мерить не только на коротких импульсах, но и на
длительных, например, минуту — но не на каждом шаге, а после очередной итерации тюнинга всей кривой,
чтобы проверить нагревы на длительном прожиге, и стабильность».*

- [ ] After each whole-curve candidate: ≥ 60 s sustained per shape (§4.3's three) plus `--lowload`.
- [ ] Matched start temperature between compared sides, ≤ 3 °C. **This depends on `plans/04` §4.7
      (fans)** — and until fan control exists the honest substitute is to WAIT for the temperature and
      say that is what happened, never to compare across thermal states (fact 10: ~4 W per 5 °C; fact 18:
      the curve itself derates).
- [ ] Re-measure the watt payoff as **two independent series**, pooled (EXP-0018), because −14.67 W is
      single-sourced and `power --spread` refuses to compare records whose conditions differ.
- [ ] The price line (ops/s, duty factor, per-thread fault rate) recorded beside the watts — it is the
      CURRENCY in the owner's formula, and it is also the only observable for clock stretching and memory
      replay (internal map R4/R4a).
- [ ] A failing whole-curve iteration escalates by the ratchet: find the shape and the serving point that
      failed, raise THAT point one step, retest the WHOLE curve. Never lower it again.

**Verification:** two series with the pooled floor quoted, both sides PASS, temperatures within 3 °C.
**P5-AC6, AC8.**

### 4.8 — Phase closure 🔲

- [ ] `/fable-judge` over everything this plan claims closed.
- [ ] `MASTER_PLAN.md` phase 5 → closed, with the date and the evidence; `STATUS.md` rewritten as a
      summary of the present, closed work moved to `PROJECT_HISTORY.md`.
- [ ] `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` updated: the curve writer's single author, and `engine.mjs`
      arriving as a real module rather than a designed one.
- [ ] Then, and only then, `plans/06_epic01_phase6_two_profiles.md`.

## 5. What phase 5 does NOT do — boundaries, so drift is visible

- **It does not ship a profile.** Assembly of `Max Optimal` / `Silent Cold`, the 3DMark run and the
  owner's acceptance are phase 6 (`plans/01_EPIC` §3). This phase produces the table and the engine.
- **It does not touch the surface.** Shortcuts, tray and autostart are phase 3, still undone, and still
  the epic's declared Pareto slice — *«после фазы 3 у вас на руках законченный продукт»*. The debt is
  real and belongs in the epic's ordering, not in this phase.
- **Point 127 is excluded from every whole-curve operation** — measured to be an outlier three ways
  (the NVML lever never moves it; 515 mV / 405 MHz against its neighbour's 1240 mV / 3157 MHz; the
  structure's only non-zero service dword). Excluding it is narrower than including it.
- **Points 0…~20 sit on the 180 MHz floor.** A positive offset there is legal but buys nothing to
  measure; the floor is remembered, not fought.
- **The offset granularity is known only from above** (`CLOCK_OFFSET_GRANULARITY_IS_MEASURED = false`,
  "no worse than 1 MHz"). The search uses 15 MHz as its fine step because that is one MEASURED curve
  spacing, not because finer is impossible.

## 6. Risks by tier

**(a) Highest — with a defence built, not merely named.**

| # | Risk | Defence |
|---|---|---|
| R1 | The search parks the card inside the silent-corruption region — the worst outcome available | The full three-way oracle at every step (AC1), the diverse set (AC3), the margin (AC4), and `prove:gradient` already demonstrates the graded half can see a single flipped bit at a MATCHING checksum |
| R2 | A write leaves the display down and the run cannot recover itself | The watchdog, armed before every write and PROVEN by firing (2.5 s). Its undo is total, not differential |
| R3 | A long search dies mid-way and its knowledge dies with it | Every verdict persisted before the next step; resume from the store; `watchdog --recover` refuses to start on a state nobody can describe |
| R4 | A false PASS from a mismatched golden sends the search past the real edge | `UNKNOWN` is a stop, and the stamp check runs first (EXP-0011) |

**(b) Plausible — with the contingency named.**

| # | Risk | Contingency |
|---|---|---|
| R5 | The in-curve ceiling (§4.1) does not hold — the card boosts past the flattened tail | Fall back to `-lgc <idleFloor>,<cap>` as a RANGE, never `min=max`, and record the idle-power cost of whichever shape wins |
| R6 | The safe offset varies enough across the band that the profile must be a vector | Already the point of §4.5; the store is per point from the start, so the vector needs no redesign |
| R7 | Fans (phase 4 §4.7) refuse manual control below a firmware floor, so matched temperatures stay unreachable | Wait for temperature instead of forcing it, and report the wait as part of the method (`plans/04` R1) |
| R8 | A driver update mid-phase invalidates every id, layout, golden and record (R6) | `npm run nvapi`, `stress --verify-baseline`, and the store's quarantine all report it rather than absorbing it |

**(c) Least likely — written so they are not rediscovered.**

- The bisect converges on an offset the hardware cannot express (sub-grid), which the granularity flag
  already warns about.
- Thermal drift during a long bracket moves the curve enough to shift which point serves the cap
  mid-search — detectable, because every record carries its temperature.

## 7. Verification map — which command proves which step

| Step | The observation that closes it |
|---|---|
| 4.1 | `clocks.gr` under load ≤ F, idle clock still falling, byte-exact rollback; `--prove-mask 64 -15` unchanged across the refactor |
| 4.2 | `vmin-store --selftest` — completion line present, every mutation reddening its own block, `runs/vmin/` not grown by the suite |
| 4.3 | a two-shape fixture where the WORSE verdict becomes the point's threshold, named |
| 4.4 | `engine --selftest` offline, then one live bracket with a last-PASS / first-FAIL pair ≤ 15 MHz |
| 4.5 | the three-cap table, each row with its temperature |
| 4.6 | the policy blocks plus a mutation; `interview_004` raised and visible in `npm run questions` |
| 4.7 | two pooled series, both sides PASS, ΔT ≤ 3 °C, the price line beside the watts |
| 4.8 | `/fable-judge` verdict, `npm run check` green, the canon updated |

## 8. Decisions made without the owner

*(filled at closing; the calls already made in writing this plan)*

- **The ceiling is tried INSIDE the curve first, before `-lgc`.** Reason measured, not aesthetic:
  `candidateProfile()` pins `min = max`, which forbids the card from clocking down — fine for a
  measurement, wrong for a profile that must survive a boot. Smallest reversible form: the curve is one
  artifact with one rollback.
- **The search is organized by held CLOCK, not by point index.** A curve point is only exercised when the
  card runs a clock it serves, so capping the clock is what makes "test this point" a real test rather
  than a write nobody loads.
- **`guardband` stays the default over the owner's more aggressive `ratchet`** until he answers
  `interview_004`. His loop is defensible and recorded; choosing it for him would be inventing an
  authorization (`PHILOSOPHY.md` → the three doors).
- **The margin question goes to him; the step sizes, the search order and the workload set do not.**
  Method is the agent's authorship on this project (EXP-0026); risk appetite on his machine is his.
- **The duplicated curve-write loop is consolidated inside this phase rather than deferred**, because the
  engine is about to become its sixth caller and the copies already disagree about point 127.
