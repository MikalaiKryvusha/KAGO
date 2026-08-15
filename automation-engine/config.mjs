// automation-engine/config.mjs — every safety number KAGO uses, named, in one place.
//
// RULE R3 of PROJECT_ARCHITECTURE_INTERNAL_MAP.md: this module depends on NOTHING and holds every
// safety parameter. Voltages, step sizes, temperature policy and guardbands are safety parameters,
// not literals scattered through call sites — a magic number in a call site is a number nobody can
// audit before it changes the owner's hardware.
//
// THE SOURCING RULE, and it has teeth here (PHILOSOPHY.md → the three doors): every constant below
// carries a comment naming WHERE THE NUMBER CAME FROM. A number with no source does not belong in
// this file. Where the honest answer is "we have not measured it yet", the constant is marked
// PROVISIONAL and says what will settle it — an invented number is worse than a missing one.
//
// Nothing here is read from the GPU at import time: reading hardware is hardware-mon's job. The
// functions at the bottom take an already-probed reading and turn it into policy, so this module
// stays pure and testable.
//
// [TESTED: 2026-08-09 · every constant printed and read back; guardbandMillivolts() → 25 mV
//  bound by grid-steps; powerEnvelope({min:250,max:300}) → 50 W / 16.7 % headroom, matching the
//  live probe in researches/01 §2; powerEnvelope({min:400,max:300}) threw as designed rather than
//  returning a negative range. Sourcing audited by grep: "4 curve steps"/"25 mV" → researches/02:86,
//  "6.25 mV … to be confirmed" → :87, "3-minute express test" → :110, "100 % load 5 s ↔ idle 5 s"
//  → :101, "40–60 % intensity band" → :102, "37 of 57 SDC-prone" → :35; temperature.memory = N/A
//  and temperature.gpu.tlimit → researches/03:40-41. The three constants that are OURS rather than
//  cited (DETERMINISM_REPEATS, TELEMETRY_SAMPLE_MS, THERMAL_SOAK_SECONDS) say so in their comments,
//  and the last carries a false IS_MEASURED flag so no caller mistakes it for a measurement.]

// =============================================================================================
// 1. The guardband — how far above the failure threshold a shipped profile sits
// =============================================================================================

/**
 * SOURCE: researches/02 §3 Step 3 — "guardband = at least 4 curve steps above V_fail, and never
 * less than 25 mV". The two conditions are ANDed: whichever is larger wins.
 *
 * WHY IT IS NOT A TASTE DECISION: researches/02 §2 measured a 3 % → 90 % error-rate explosion
 * across 2 % of voltage. The search finds an edge; the guardband pays for what the search could
 * not observe — untested workloads (Vmin spreads 100 mV across programs), aging, and thermal or
 * supply conditions outside the test.
 *
 * A COINCIDENCE WORTH KNOWING BEFORE IT MISLEADS SOMEONE: at the provisional 6.25 mV grid, four
 * steps is exactly 25 mV — the two conditions currently produce the SAME number and look redundant.
 * They are not. They are indistinguishable only while the grid step is an assumption; once phase 4
 * measures it, a finer grid makes the millivolt floor the binding one and a coarser grid makes the
 * step count bind. Deleting either constant now would silently delete a condition later.
 */
export const GUARDBAND_MIN_GRID_STEPS = 4;
export const GUARDBAND_MIN_MILLIVOLTS = 25;

/**
 * THE SHIPPED MARGIN, SETTLED BY THE OWNER 2026-08-10 21:xx — and it supersedes both numbers above as
 * the DEFAULT. His words, verbatim:
 *
 *   *«тогда делаем так. Если нашли шагами по 5 мВ точку отказа, то от неё вверх поднимаемся на два
 *   шага: на +10 мВ, это даст вероятностный запас стабильности.»*
 *
 * TWO measured grid steps above the observed failure. The arithmetic is not a preference: the grid
 * step is 5 mV MEASURED on the live curve (`VOLTAGE_GRID_STEP_MV`), so "two steps" is 10 mV on this
 * card and would be something else on another — which is why the constant is a STEP COUNT and the
 * millivolts are derived.
 *
 * WHY TWO AND NOT ONE, in his own reasoning: the edge is PROBABILISTIC. Measured the same evening at
 * 2842 MHz, the card both PASSED and CRASHED at the same 885 mV — so one step above a failure can sit
 * inside the region where failure is merely unlikely rather than absent. The second step is bought
 * deliberately to cover that.
 *
 * WHY NOT THE RESEARCH'S 25 mV: it buys protection against the same thing, three times more
 * expensively, and by ASSUMPTION rather than by observation. The owner's loop covers the residue by
 * observation instead — whole-curve retest, the ratchet, and his own play session as a second witness.
 */
export const MARGIN_STEPS_ABOVE_FAILURE = 2;

/**
 * PROVISIONAL — the voltage grid step of the V/F curve.
 *
 * SOURCE: researches/02 §3 Step 3 — "widely held to be 6.25 mV on NVIDIA parts", explicitly
 * flagged there as "to be confirmed by probing the live curve", because `nvidia-smi` cannot read
 * voltage at all (researches/03 §2) and nothing on this machine has measured it.
 *
 * SETTLED BY: phase 4, the NVAPI bridge — its exit gate includes "the voltage grid step measured
 * on the live curve, not assumed" (plans/01_EPIC §4). Until then any millivolt figure derived from
 * this constant is an estimate, and callers must say so.
 *
 * THE OWNER'S RULE FOR THE FINE SEARCH MODE (chat, 2026-08-10, in answer to his own question
 * "6,25 мВ - это минимальный шаг изменения, который позволяет сделать 5070 Ti?"): *«если да - тогда
 * он будет шагом для точной настройки»*. So the fine mode's step is defined as **the hardware's own
 * minimum step, whatever the measurement says it is** — not 5 mV, not 6.25 mV taken on faith. That
 * definition is correct on any card, which is why it is the rule rather than a number.
 *
 * THE LEAD THAT WILL MEASURE IT (web recon 2026-08-10, researches/04 sources): NVIDIA exposes the
 * V/F curve as a **128-point curve** through an UNDOCUMENTED NvAPI entry —
 * `ClockClientClkVfPointsGetStatus`, function id `0x21537AD4`, a 0x1C28-byte struct of 128 × 28-byte
 * entries, voltage in MICROVOLTS and frequency in kHz. Reported working on an RTX 5090 (Blackwell,
 * GB202) on driver 590.48.01 — the same architecture family as this card.
 *
 * AND A REASON TO DOUBT 6.25 BEFORE TRUSTING IT: the example curve in that source shows voltage
 * increments of 20…125 mV between the points it prints, which is not a uniform 6.25 mV grid. That
 * refutes nothing on its own (the printed points may be a sparse selection), but it does mean the
 * figure must be measured rather than adopted. Beware the confusion that makes this easy to get
 * wrong — TWO different quantities wear the same name:
 *   (1) the SPACING between adjacent curve points in voltage;
 *   (2) the GRANULARITY of an offset that may be applied to a point (an Afterburner slider step).
 * Folklore attaches 6.25 mV to (2). The fine mode needs whichever one actually binds.
 */
/**
 * ⚠️ MEASURED 2026-08-10 ON THE LIVE CURVE — AND THE INHERITED FIGURE WAS WRONG.
 *
 * Everything above this line is the history of an ASSUMPTION and is kept because it explains where the
 * wrong number came from. The measurement: `node automation-engine/lib/nvapi.mjs --curve` read all 128
 * V/F points through NvAPI `ClkVfPointsGetStatus` on this card, driver 610.88 — voltage 450…1240 mV,
 * frequency 180…3157 MHz, and the spacing between adjacent points is **5 mV**, with some 10 mV gaps.
 * Exactly two distinct step values, and the smallest is 5.
 *
 * So the folklore 6.25 mV is refuted here, and the owner's own figure was the correct one: he said
 * *«точный режим - меняет напряжение на 5 мВ»* while the agent recorded that 5 mV might not be
 * expressible. It is.
 *
 * WHAT THIS NUMBER IS, PRECISELY — the same distinction config already warned about, now that it
 * matters: this is the SPACING BETWEEN ADJACENT CURVE POINTS. It is NOT the granularity of an applied
 * offset; that is a different quantity, and it is still UNMEASURED. A caller that needs the offset
 * resolution must not use this constant for it.
 */
export const VOLTAGE_GRID_STEP_MV = 5;
export const VOLTAGE_GRID_STEP_IS_MEASURED = true;

/**
 * The OFFSET granularity — a different quantity from the point spacing above, and STILL OPEN.
 *
 * RENAMED 2026-08-10 from `VOLTAGE_OFFSET_GRANULARITY_IS_MEASURED`, because the old name lied about
 * the unit and phase 5 was about to build a search on it. What this API actually applies to a curve
 * point is a **FREQUENCY offset in kHz** — "this voltage point shall run at a higher frequency" — so
 * calling its resolution a *voltage* granularity would have sent the fine search looking for millivolts
 * in a kHz field. Nothing consumed the constant yet; renaming now costs one line and later costs a bug.
 *
 * WHAT IS MEASURED (2026-08-10, researches/05 §8): the field's POSITION, its UNIT (kHz) and its
 * allowed RANGE, below. What is NOT: the smallest offset the driver actually honours. Two magnitudes
 * were applied (-100 and -37 MHz) and both landed exactly, so the resolution is at worst 1 MHz — but
 * "at worst 1 MHz" is a bound, not a measurement, and sub-MHz was never tried.
 */
export const CLOCK_OFFSET_GRANULARITY_IS_MEASURED = false;

/**
 * The allowed frequency-offset range for the graphics domain at P0, in MHz.
 *
 * MEASURED 2026-08-10 by the documented, READ-ONLY `nvmlDeviceGetClockOffsets`, which publishes min and
 * max as outputs (researches/05 §8.4). This is a safety number and therefore lives here (rule R3), not
 * at a call site.
 *
 * WHY IT MATTERS BEYOND ARITHMETIC: until it was read, the permitted range was UNKNOWN, and the plan's
 * answer to that was to keep the first writes microscopic **by policy rather than by permission**. A
 * bound the hardware itself states replaces a self-imposed guess — and it stays a CEILING, never a
 * target: the search still climbs from small offsets, it simply now knows where the wall is.
 */
/**
 * THE METER'S OWN RUN-TO-RUN SPREAD, in watts. A delta thinner than this is NOT an effect.
 *
 * MEASURED 2026-08-10 (`npm run power -- --spread stock`): ten stock runs in TWO independent series
 * of five — 1.28 W = 0.65 % on power, 0.18 % on price. Pooled across series deliberately: the spread
 * INSIDE one series understated the floor (0.67 and 0.49 W) because runs in a series share a thermal
 * state, and the two series' medians sat 0.9 W apart — further than either series' own width
 * (EXP-0018).
 *
 * WHY IT LIVES IN CONFIG rather than at a call site (rule R3): it is the threshold that decides
 * whether a measured difference may be REPORTED as a saving at all, which makes it a safety number in
 * the same sense as a guardband — the owner's rule that "no loss" may only be claimed by an
 * instrument finer than the effect it denies.
 */
export const POWER_METER_SPREAD_W = 1.28;
export const POWER_METER_SPREAD_PCT = 0.65;

export const CLOCK_OFFSET_MIN_MHZ = -1000;
export const CLOCK_OFFSET_MAX_MHZ = 1000;
export const CLOCK_OFFSET_RANGE_IS_MEASURED = true;

/**
 * HOW MANY POINTS THE V/F CURVE HAS, and how many of them are GRAPHICS points.
 *
 * MEASURED 2026-08-10 on this card (`npm run nvapi -- --curve`): the driver's
 * `ClockClientClkVfPointsGetStatus` struct is 0x1C28 bytes = a 0x48 header plus **128 records** of
 * 0x1C. The LAST record is not a graphics point — it reads 515 mV / 405 MHz beside its neighbour's
 * 1240 mV / 3157 MHz — so every whole-curve operation this project performs covers **127** points and
 * excludes the outlier.
 *
 * WHY IT LIVES HERE rather than in `nvapi.mjs` where the struct geometry does (rule R3, moved
 * 2026-08-15 by `plans/12` §4.1): the profile VALIDATOR needs this number to check the length of a
 * per-point vector, and `profile-store.mjs` must stay offline and koffi-free — a validator that has to
 * load the FFI layer to learn a constant cannot run without the card. `nvapi.mjs` re-exports it, so
 * there is ONE definition and no mirror to drift (the pair registry would otherwise gain a row).
 */
export const CLK_VF_POINT_COUNT = 128;
export const CURVE_GRAPHICS_POINT_COUNT = CLK_VF_POINT_COUNT - 1;

/**
 * ONE STEP OF THE CARD'S OWN CLOCK GRID — the only tolerance a ceiling check is allowed.
 *
 * MEASURED, not chosen: this card's supported-clock ladder runs 180…3090 MHz in 389 points whose
 * spacing alternates **7 MHz (×194) and 8 MHz (×194)** (`npm run gpu:info`, dossier row "GPU"). Since
 * `clocks.gr` reports on that grid, a reading ONE step above a ceiling is the grid's rounding rather
 * than a breach; anything beyond it is the card genuinely exceeding the ceiling, and that voids the
 * verdict of the rung (`vf-step` → the ceiling proof).
 *
 * The larger of the two spacings is taken on purpose: a tolerance that admits the 7 MHz case but not
 * the 8 MHz one would redden on which half of the ladder the card happened to land.
 */
export const CLOCK_LADDER_STEP_TOLERANCE_MHZ = 8;

/**
 * HOW FAR BELOW THE DEEPEST **PROVEN** DEPTH ONE SESSION MAY EXPLORE — the bound bought on
 * 2026-08-14 21:14, when a search walked SEVEN rungs into unexplored depth in a single run and hung
 * the owner's machine on the eighth.
 *
 * WHY A BOUND IS NEEDED AT ALL, and it is not the same thing as the step governor. The step governor
 * (`ASCENT_STEP_MAX_MV`) bounds how COARSELY we descend; every step that night was small and legal.
 * What was unbounded was the TOTAL distance travelled beyond anything ever proven: 0 → −185 mV in one
 * run, on a shape with no history. At depth the failure is not graded corruption the oracle can catch
 * — it is an instant hang, and R10 says every rollback layer except volatility needs a live OS. So the
 * only thing that can be bounded is how far a single run is allowed to walk into the dark.
 *
 * WHY 30 mV. Two conditions meet here:
 *   • it must be at least one AVALANCHE WIDTH, or the search can never land inside the region where
 *     corruption becomes observable — `researches/02` §2 measures the error rate going 3 % → 90 %
 *     across 2 % of voltage, which is ≈ 20 mV at this card's ~1000 mV operating point;
 *   • it must be at most one COARSE STEP (the owner's own 25 mV mode, 30 mV as this card's ladder
 *     rounds it), so a session that finds nothing still makes exactly one step of progress.
 * The two bracket 20…30 mV and the upper end is taken: a smaller bound would make the search need
 * more sessions without making the hang cheaper — the hang costs one reboot either way.
 *
 * MEASURED CONTEXT, so the number is not read as generic: at 2842 MHz in the shipped shape this card
 * PASSED every load down to **860 mV** (−185 mV from a 1045 mV stock) with ZERO corruption counted at
 * every rung, and hung on the next one. The edge here is a cliff, not a slope.
 */
export const SESSION_MAX_DEPTH_BEYOND_KNOWN_MV = 30;

/**
 * ⚠️ **SUPERSEDED 2026-08-15 by `DESCENT_ZONES` below — kept, not deleted, and the reason is stated
 * here rather than left to be rediscovered.** The owner replaced this rule the same day with a ladder
 * keyed by DEPTH FROM STOCK instead of by an absolute voltage (`GOAL.md` → «📐 ЛЕСТНИЦА ШАГОВ
 * СПУСКА»). **The two agree exactly where this one was spoken** — at 2842 MHz stock is 1045 mV, so his
 * 150 mV boundary lands on 1045 − 150 = 895 ≈ 900 — but an ABSOLUTE key does not travel across the
 * range: at 1702 MHz stock is already 795 mV, below this floor, so this rule would crawl at 5 mV
 * through a band that offers only 45 mV in total.
 *
 * **Why it is still exported.** It is wired into `composeAscentLadder` and the `--band` / `--search`
 * path — the ONLY search this project has ever run on the live card. `plans/15` §5 keeps that path
 * standing until the sweep has run live once, because removing the proven path before its replacement
 * is proven loses both. So the retirement is by SCOPE, not by deletion: **no new caller reads this
 * constant.** Everything the epic-02 sweep does asks `DESCENT_ZONES`. When the sweep has replaced the
 * band path on the card, this constant and its readers go together.
 *
 * THE OWNER'S OWN FLOOR FOR FAST DESCENT — his word, chat, 2026-08-15, verbatim:
 *
 *   > *«до 900 можем опускаться быстрыми шагами. ниже 900 - опускаемся по 5 мВ»*
 *
 * This is a RISK decision, and risk on his machine is his to make — it outranks the bound above,
 * which the agent derived. What it changes, precisely:
 *
 *   • **At or above 900 mV** the ladder walks in COARSE steps and `SESSION_MAX_DEPTH_BEYOND_KNOWN_MV`
 *     does NOT truncate it — one session may go from stock all the way down to this floor.
 *   • **Below 900 mV** the step is one voltage grid step (5 mV), and the session bound applies again
 *     exactly as `bugs/07` wrote it: at most 30 mV past proven ground, per session.
 *
 * WHAT DOES NOT CHANGE, because he spoke about descent speed and not about the guards: the depth
 * governor still refuses a first step deeper than `ASCENT_FIRST_STEP_MAX_MV` and a rung-to-rung jump
 * beyond `ASCENT_STEP_MAX_MV` (`bugs/03`), and the ratchet still forbids every voltage that ever
 * failed, forever (`bugs/10`).
 *
 * HIS POLICY AGREES WITH THE PHYSICS WE MEASURED, which is worth recording because it means the two
 * bounds are not in tension: the avalanche `researches/02` §2 sizes at ~20 mV sits near the edge, and
 * the edge on this card is around 845…860 mV — i.e. BELOW his floor. Fine steps are what the graded
 * oracle needs to land INSIDE that avalanche, and fine steps are exactly what he asks for there.
 *
 * ⚠️ THE ONE PLACE THIS BITES, named rather than discovered later: a run with NO history descends to
 * this floor in a single session. On THIS card that is territory already walked (990 mV proven live,
 * and `bugs/07` reconstructs a PASS at 860 mV — **reconstructed from chat, never re-measured**). After
 * a DRIVER CHANGE, R6 invalidates every record, history goes empty, and the next run would take that
 * whole descent again in one go. If that matters, re-prove a shallow rung first.
 */
export const FAST_DESCENT_FLOOR_MV = 900;

/**
 * THE OWNER'S DESCENT STEP LADDER — his word, chat, 2026-08-15 16:3x +03:00, verbatim:
 *
 *   > *«от стока вниз можно шагать не минимальными шагами. От стока вниз на дельту 100 мВ можно
 *   > шагать шагом 25 мВ. Если дельта больше 100 мВ, меньше 150 мВ — шагаем минимальным шагом
 *   > умноженным на 2. Если дельта от стока больше 150 мВ, то шагаем ниже минимальными шагами 5 мВ.»*
 *
 * **The key is DEPTH FROM STOCK, not absolute voltage** — that is the whole correction over
 * `FAST_DESCENT_FLOOR_MV` above, and it is what makes one policy work at 3090 MHz (350 mV of headroom)
 * and at 1702 MHz (45 mV) alike.
 *
 * IT SATISFIES THE `bugs/03` GOVERNOR RATHER THAN WEAKENING IT: his first step is exactly 25 mV
 * (`ASCENT_FIRST_STEP_MAX_MV`) and his largest gap is 25 mV, well under `ASCENT_STEP_MAX_MV` = 35.
 *
 * ITS HONEST COST, stated once where the policy lives: a 25 mV step approaches the edge coarsely, and
 * failure at the edge is an avalanche (3 % → 90 % of errors across 2 % of voltage, `researches/02`).
 * So a coarse rung is likelier to HANG the machine than to be caught by the oracle. The owner accepted
 * that risk explicitly the same day (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»), and the ladder is
 * shaped around it: coarse only where failure is improbable, fine where it is near.
 *
 * A COARSE FAILURE IS NOT AN EDGE. Whatever this ladder finds at 25 or 10 mV must be refined at the
 * grid's own minimum before the +10 mV margin is applied (`plans/15` §4.6) — his margin rule is
 * conditioned on it: *«Если нашли шагами по 5 мВ точку отказа…»*. Otherwise «V_fail + 10 mV» would name
 * a voltage nobody ever burned.
 *
 * Ordered shallow → deep; the last zone must be open-ended.
 */
export const DESCENT_ZONES = Object.freeze([
  Object.freeze({ untilDepthMv: 100, stepMv: 25 }),
  Object.freeze({ untilDepthMv: 150, stepMv: 10 }),
  Object.freeze({ untilDepthMv: Infinity, stepMv: 5 }),
]);

// =============================================================================================
// 2. Workload timing — how long a thing runs before it is allowed to mean something
// =============================================================================================

/**
 * SOURCE: the owner's PDF, quoted in researches/02 §4 — the plan's per-point qualification is a
 * "3 min express test". researches/02 §3 Step 5 is equally explicit about its LIMIT: "A 3-minute
 * express test qualifies a point; it does not qualify a profile."
 */
export const EXPRESS_TEST_SECONDS = 180;

/**
 * SOURCE: the owner's PDF's Transient Load Test, quoted in researches/02 §3 Step 4 —
 * "100 % load 5 s ↔ idle 5 s".
 *
 * WHY THE TRANSIENT SHAPE MATTERS MOST: researches/02 §2 found voltage noise (IR drop and di/dt
 * droop) to be the DOMINANT source of Vmin variability — larger than process, temperature or
 * aging. Steady-state load testing is therefore the wrong test, and a flat 100 % tool like FurMark
 * cannot produce this shape at all.
 */
export const TRANSIENT_ON_SECONDS = 5;
export const TRANSIENT_OFF_SECONDS = 5;

/**
 * SOURCE: researches/02 §3 Step 4, citing OCCT's published analysis — instability shows up in the
 * 40–60 % intensity band that flat 100 % tests never reach.
 */
export const ADAPTIVE_INTENSITY_BAND = Object.freeze([0.40, 0.60]);

/**
 * THE LOW-LOAD SHAPE — a short burst against a long idle.
 *
 * SOURCE for its EXISTENCE: `researches/04` §3.1, plus the owner's own account of the same trap on
 * CPUs (`AGENT_GUIDE.md` → Notes from the human): an undervolt can be *conditionally* stable —
 * surviving sustained heavy stress and dying at idle or on a browser click, because the LOW end of
 * the V/F curve has stability requirements of its own. A heavy test never visits that region, so it
 * cannot qualify a profile however long it runs.
 *
 * SOURCE for the NUMBERS: ours, and chosen to be checkable rather than tasteful. The requirement is
 * that the card spends most of the window falling back toward its idle clocks while still being
 * woken repeatedly, so the run exercises BOTH the low-clock dwell and the idle→burst edge. A 1 s / 9 s
 * duty gives a 10 % duty cycle and ~6 wake edges per minute. **The choice is validated by
 * measurement, not by this comment: the shape prints the clocks it actually reached, and if the card
 * does not fall to low clocks the shape is not doing its job and the numbers must change.**
 *
 * WHY IT IS NOT THE SAME AS `--transient`. The transient shape (5 s / 5 s) exists to hit the card
 * with di/dt transitions at HIGH load — voltage noise is the dominant Vmin factor (researches/02 §2).
 * This one exists to hold the card LOW. Same machinery, opposite purpose, and one is not a substitute
 * for the other.
 */
export const LOWLOAD_ON_SECONDS = 1;
export const LOWLOAD_OFF_SECONDS = 9;

/**
 * SOURCE: researches/02 §3 Step 1 — the express test runs at each step of the descent; repeats are
 * what turn one observation into a determinism claim. The count is ours: five repeats is the
 * smallest number that makes a single-run fluke visible, and phase 1's acceptance criterion
 * P1-AC1 is written against it (plans/02_epic01_phase1 §2).
 */
export const DETERMINISM_REPEATS = 5;

/**
 * THE SPLITTER between a run's LOADED and IDLE halves, in percent of GPU utilization.
 *
 * SOURCE: ours, and chosen against a MEASUREMENT rather than by taste. Utilization under these
 * shapes is strongly bimodal — measured 2026-08-10 (plans/03 §4.3): 5 % in the low-load dwell,
 * 8 % under the spawn-per-burst shape, 57 % under sustained `sdc_fma`, 97 % under sustained
 * `branchy`. A whole-run median across a duty cycle sits BETWEEN the two lobes and moves with
 * sample alignment instead of with the card, which is why the halves are separated at all.
 *
 * WHY AN ABSOLUTE NUMBER IS HONEST HERE, and how it announces its own failure: 50 % sits in the gap
 * for every shape measured on this card. If a future workload lands near the line, the split stops
 * meaning anything — so the record always carries the SAMPLE COUNT of both halves and each half's own
 * utilization median, and a split that failed to split is then visible in the output rather than
 * hidden inside one number (EXP-0012).
 */
export const LOAD_PHASE_UTILIZATION_PCT = 50;

/**
 * How much longer the telemetry sampler runs than the load it is measuring, in seconds.
 *
 * SOURCE: ours, and it exists because of an OBSERVED mechanic rather than a preference: the sampler
 * must be a SEPARATE PROCESS (`runBurst` uses `spawnSync` and blocks Node's event loop, so an
 * in-process sampler records zero samples — plans/03 §4.3), and a separate process starts and stops
 * at times that do not exactly bracket the load. Two seconds at a 500 ms period is four samples of
 * margin on each side; the loaded/idle split then discards the edges by itself, since a sample taken
 * before the load started is an idle sample and lands in the other half.
 */
export const BASELINE_SAMPLER_PAD_SECONDS = 2;

// =============================================================================================
// 3. Thermal policy — expressed as an OBSERVATION, not as an invented ceiling
// =============================================================================================

/**
 * There is no sourced temperature ceiling for this card, and inventing one would be exactly the
 * defect PHILOSOPHY.md forbids. So the policy is written as something the card itself reports.
 *
 * SOURCE: researches/03 §2 — `nvidia-smi` exposes `clocks_event_reasons.hw_thermal_slowdown`,
 * `.sw_thermal_slowdown` and `.hw_power_brake_slowdown`, plus `temperature.gpu.tlimit`, the
 * card's own margin to its own limit. A run during which the card never declared a thermal
 * slowdown needed no ceiling from us; a run in which it did is disqualified whatever the absolute
 * number was.
 */
export const THERMAL_THROTTLE_REASONS = Object.freeze([
  'clocks_event_reasons.hw_thermal_slowdown',
  'clocks_event_reasons.sw_thermal_slowdown',
  'clocks_event_reasons.hw_power_brake_slowdown',
]);

/**
 * SOURCE: researches/02 §3 Step 3 — "validate hot, then still leave room". A cold card is a
 * different card; a verdict taken before the thermals settle is a verdict about the warm-up.
 * PROVISIONAL: the number of seconds it takes THIS card to settle is measured in phase 1 (the
 * baseline capture, plans/02_epic01_phase1 §3.7) and this constant is corrected from that
 * measurement.
 */
export const THERMAL_SOAK_SECONDS = 300;
export const THERMAL_SOAK_IS_MEASURED = false;

// =============================================================================================
// 4. Telemetry — the exact field set, and the one field this card does not have
// =============================================================================================

/**
 * SOURCE: researches/03 §2, probed on this machine 2026-08-09. Every field below returned a real
 * value; the deliberate absence is `temperature.memory`, which returns `N/A` here because NVIDIA
 * disabled the memory-junction sensor at driver level on RTX 50 (researches/03 §3.5). Sampling a
 * field that is always `N/A` writes a column of nothing and invites a future session to "fix" it.
 */
export const TELEMETRY_FIELDS = Object.freeze([
  'timestamp',
  'pstate',
  'temperature.gpu',
  'temperature.gpu.tlimit',
  'fan.speed',
  'power.draw.instant',
  'power.limit',
  'clocks.gr',
  'clocks.sm',
  'clocks.mem',
  'utilization.gpu',
  'utilization.memory',
  'clocks_event_reasons.active',
]);

/** SOURCE: researches/03 §2 — probed absent on this card. Kept named so nobody re-adds it blind. */
export const TELEMETRY_FIELDS_UNAVAILABLE_HERE = Object.freeze(['temperature.memory']);

/**
 * The sampling period. SOURCE: ours, and bounded by the instrument rather than by taste —
 * `nvidia-smi` costs a process spawn per sample, and the transient shape this harness exists to
 * observe switches every 5 s (TRANSIENT_ON_SECONDS). Ten samples per transition is enough to see
 * the edge without the sampler becoming the load.
 */
export const TELEMETRY_SAMPLE_MS = 500;

// =============================================================================================
// 5. Fault detection — the Windows providers that carry the crash half of the verdict
// =============================================================================================

/**
 * SOURCE: researches/03 §3.4, each provider verified readable on this machine with `Get-WinEvent`
 * from an UNELEVATED shell.
 *
 * `provable` records the honest truth about each detector's proof status, because a detector that
 * has never gone red proves nothing (BUG_FIXING_FRAMEWORK.md → Guards):
 *   'history' — this machine has real events of this kind to prove the reader against;
 *   'fixture' — it does not, so the parser is proven on captured event XML instead.
 * That difference must reach the code's [TESTED] markers rather than being blurred.
 */
export const FAULT_PROVIDERS = Object.freeze([
  { provider: 'Display', ids: [4101], means: 'CRASH', what: 'display driver reset (TDR)', provable: 'fixture' },
  { provider: 'Microsoft-Windows-WHEA-Logger', ids: [17, 18, 19, 47], means: 'CRASH', what: 'machine check / hardware error', provable: 'fixture' },
  { provider: 'Microsoft-Windows-Kernel-Power', ids: [41], means: 'CRASH', what: 'unexpected shutdown or power loss', provable: 'history' },
  { provider: 'Microsoft-Windows-WER-SystemErrorReporting', ids: [1001], means: 'CRASH', what: 'bugcheck (BSOD)', provable: 'fixture' },
]);

// =============================================================================================
// 6. The three-way verdict
// =============================================================================================

/**
 * SOURCE: researches/02 §3 Step 1, taken from Leng et al. (MICRO 2015). The middle verdict is the
 * whole reason the harness exists: 37 of 57 programs corrupt output BEFORE they crash, so a
 * two-way pass/crash oracle walks an unknown distance inside the corruption region without
 * noticing.
 */
/**
 * THE DEPTH GOVERNOR'S TWO CEILINGS — paid for by `bugs/03`, which hung the owner's machine.
 *
 * SOURCE for the first number: the owner's own coarse search mode, *«грубый меняет напряжение на
 * 25 мВ»*. It is the deepest single move he ever described, so it is the deepest a FIRST move may be.
 *
 * SOURCE for the second: this card's measured curve. Its bottom holds ~20 points on the 180 MHz floor,
 * so a whole-curve raise there steps −5 mV and then −230 mV with nothing in between. 35 mV is one
 * coarse step plus one fine step — wide enough to walk any graded region, narrow enough that a cliff
 * is refused instead of leapt.
 *
 * WHY THESE ARE SAFETY CONSTANTS AND NOT TUNING: at depth there is no rollback. A state that hangs the
 * machine cannot be undone by anything running on the machine — the writer's `finally`, the detached
 * watchdog and Windows TDR all need a scheduling OS, and none of them ran on 2026-08-11. Step size is
 * the only protection that acts BEFORE the hang.
 */
export const ASCENT_FIRST_STEP_MAX_MV = 25;
export const ASCENT_STEP_MAX_MV = 35;

export const VERDICT = Object.freeze({
  PASS: 'PASS',    // output matches the golden reference and no fault was logged
  SDC: 'SDC',      // output differs, nothing crashed — the dangerous one
  CRASH: 'CRASH',  // a fault provider fired, or the process died
});

// =============================================================================================
// 7. Read-back after a write — how a written value is allowed to count as read
// =============================================================================================

/**
 * SOURCE: EXP-0014, observed on this card 2026-08-10. `nvidia-smi -rgc` printed "All done" with exit
 * 0 while the very next read still reported the locked 1200 MHz; the release surfaced about a second
 * later. `researches/01` §5 had already caught the same tool printing the DEFAULT in its "from"
 * field. So the tool's own success text is not evidence, and neither is a single read.
 *
 * THE RULE THESE THREE NUMBERS ENCODE: a written value counts as read back only when
 * READBACK_AGREEING_SAMPLES consecutive samples agree with what was expected. Two is the smallest
 * count that can distinguish a settled value from the stale one seen once — which is the exact shape
 * the defect took (P2-AC2, plans/03 §4.2).
 *
 * The timeout is 10× the ~1 s settle actually observed, and on expiry the read-back FAILS rather
 * than returning the last sample: a stale value silently accepted is precisely the defect.
 */
export const READBACK_AGREEING_SAMPLES = 2;
export const READBACK_INTERVAL_MS = 250;
export const READBACK_TIMEOUT_MS = 10_000;

/**
 * THE LOGON RACE (phase 3 §4.4, plans/06). The boot-apply task fires at logon and may start before
 * the NVIDIA driver answers queries. The probe is retried a bounded number of times and then gives
 * up LOUDLY into the boot journal — with zero writes, so factory state stands by physics (map rule
 * "factory state is the default"): the failure mode of the whole boot path is «nothing happened»,
 * which is the designed-in safety. 6 × 5 s is a 30 s window — margin over any driver init this
 * machine has shown; the numbers are a budget, not a measurement, and a give-up costs one journal
 * line, never a write. [NOT-TESTED against a real logon race — the race needs a reboot to exist.]
 */
export const BOOT_PROBE_RETRIES = 6;
export const BOOT_PROBE_RETRY_INTERVAL_MS = 5_000;

/**
 * THE SAME RULE DOES NOT TRANSFER TO A MECHANICAL ACTUATOR, and this card measured the difference.
 *
 * MEASURED 2026-08-10 17:3x on this card, two runs of the identical command (manual fan level 60 %):
 * read ~2 s after the write the coolers reported **768 / 824 / 768 rpm** and `nvidia-smi` said 30 %;
 * read ~14 s after the write they reported **1856 / 1861 / 1877 rpm** and the level matched what was
 * commanded. Nothing changed between the runs except WHEN the reading was taken.
 *
 * So a fan does not FLIP to its commanded value, it RAMPS to it — and "two consecutive samples agree"
 * (READBACK_AGREEING_SAMPLES above) can settle on a plateau ON THE WAY UP. Agreement is evidence of a
 * settled DIGITAL state; for a ramping quantity the read-back must additionally require the TARGET.
 *
 * Hence two numbers instead of reusing the ones above:
 *   • the tolerance is in percentage points, because the card reports a percentage that tracks rpm
 *     (768/3000 = 26 % against a reported 30 %, so the two agree within a few points);
 *   • the timeout is ~2x the 14 s at which the ramp was observed complete — generous on purpose, since
 *     expiry here means "the card did not obey", which must be a failure and never a shrug.
 */
export const FAN_LEVEL_TOLERANCE_PCT = 8;
export const FAN_RAMP_TIMEOUT_MS = 30_000;
export const FAN_RAMP_IS_MEASURED = true;

/**
 * HOW CLOSE THE DELIVERED CLOCK COMES TO THE REQUESTED ONE — measured, not assumed.
 *
 * SOURCE: observed on this card 2026-08-10 under sustained load, with ZERO throttle reasons active in
 * every sample: `-lgc 2400,2400` delivered a rock-constant 2392 · `-lgc 2392` delivered 2385 ·
 * `-lgc 1800` delivered 1792 · `-lgc 1200` and `-lgc 900` delivered 1200 and 900, and their sample
 * series show the card alternating between the point and its lower neighbour (1200/1192, 900/892).
 * So the card honours a lock TO WITHIN ONE LADDER STEP and jitters across that step. The ladder's own
 * step alternates 7 and 8 MHz (measured, `gpu:info`), so one step is at most 8.
 *
 * WHY THIS IS A TOLERANCE AND NOT A WEAKENED TEST: the quantity being checked is still "did the card
 * take the lock", and the evidence is still that the clock STOPS VARYING (EXP-0014). What this number
 * admits is the hardware's own delivery granularity, which was measured rather than guessed — and it
 * is expressed as the ladder's step so a card with a different ladder gets a different tolerance.
 *
 * WHERE IT MUST NOT BE USED: as an excuse to accept a clock far from the request. A delivered value
 * outside this tolerance is a REFUSAL, and the descent rejects that candidate rather than recording it.
 */
export const LOCK_DELIVERY_TOLERANCE_MHZ = 8;

/**
 * WHERE A CLOCK LOCK CAN BE PROVED AT ALL — an observation that corrected a design assumption.
 *
 * SOURCE: the same 2026-08-10 runs. At IDLE, a lock to 1500…2850 leaves the clock wandering wherever
 * idle management puts it (observed 1260, 1717, 1935, 1980 for four different requests — and the same
 * request read differently in two runs), so an idle read-back can neither confirm nor refute a high
 * lock. Under LOAD the same lock is dead constant. The earlier rule — «the lock is directly observable
 * at idle and needs no load» (EXP-0014, plan §2 row 2) — was measured at 1200 MHz, which happens to sit
 * inside the idle clock range on this card, and generalized from there. It holds only there.
 *
 * The consequence is structural, which is why it lives in config rather than in a comment: a clock
 * lock is verified UNDER LOAD, and an applier that cannot load the card may only report the write as
 * COMMANDED, never as delivered.
 */
export const LOCK_IS_OBSERVABLE_AT_IDLE = false;

// =============================================================================================
// 8. The graphics load — Q2RTX on the test bench
// =============================================================================================
//
// WHY THESE CONSTANTS EXIST AT ALL. Every stability verdict this project owns was taken at ~137 W
// and 57 °C — HALF this card's power envelope — while a real path-traced game takes 299.97 W,
// throttles on `sw_power_cap` and reaches 77 °C (researches/06 §7b). The region the oracle
// certified turned out to be narrow, so the game-like shape is not a nicety: it is the load the
// owner actually plays under, and plans/05 §4.3 puts it in the diverse set for exactly that reason.
//
// NOTHING HERE IS A DEPENDENCY. Q2RTX is a bench instrument, never a control path: it is not in
// `package.json`, no shipped profile needs it, and a machine without it loses ONE workload shape and
// nothing else (researches/06 §7 — the reconciliation with GOAL.md's no-third-party-GUI constraint,
// which was aimed at MSI Afterburner in the APPLY path).

/**
 * SOURCE: the owner's word, chat 2026-08-10 — «D:\Games\Quake2RTX — сюда, игры тут», then «ставь».
 * Installed the same day, v1.8.1, NSIS, rollback `D:\Games\Quake2RTX\Uninstall.exe` (researches/06 §7a).
 *
 * A PATH, not a number, and it lives here for the same reason the numbers do: one place to audit, one
 * place to change. Nothing derives it — a module that cannot find the game says so and refuses.
 */
export const Q2RTX_ROOT = 'D:\\Games\\Quake2RTX';
export const Q2RTX_EXE = 'q2rtx.exe';

/**
 * SOURCE: the engine's own source. `logfile` is `Cvar_Get("logfile", "1", 0)` — logging is ON by
 * default and, at 1, the file is opened in WRITE mode, so EVERY LAUNCH TRUNCATES IT. That is what
 * makes reading the whole file after a run legal: it contains that run and nothing else.
 */
export const Q2RTX_LOG_RELATIVE = 'baseq2/logs/console.log';

/**
 * SOURCE: `pak0.pak`'s directory, read rather than assumed — `demos/q2demo1.dm2`, 135 KiB, the only
 * demo in the free shareware pak. The retail paks are not needed and not redistributable anyway.
 */
export const Q2RTX_DEMO = 'q2demo1.dm2';

/**
 * THE CVARS THAT MUST BE FORCED ON EVERY LAUNCH — each one is a measured trap, not a preference.
 * They are passed on the COMMAND LINE every time so the game's saved `q2config.cfg` can never govern
 * a measurement (it persists cvars on exit, and a bench whose settings drift between runs is not a
 * bench).
 *
 *  · `vid_fullscreen 1` — WITHOUT IT THE NUMBER IS A LIE. Windowed, the desktop compositor paces the
 *    app to the display's refresh rate even with the engine's own vsync off: nine of ten runs printed
 *    143.998154 fps to six decimals, and a ~9× cheaper frame printed the SAME value. The owner named
 *    it from the raw number — «144 кадра в секунду — это частота моего телевизора» (EXP-0032).
 *  · `cl_maxfps 0` — its default is 60, and with `cl_async 0` it limits rendering as well as physics.
 *    Left alone, the bench caps at 60 fps and the card is never loaded at all.
 *  · `r_maxfps 0` — the renderer's own limiter, zeroed for the same reason.
 *  · `vid_vsync 0` — the engine's vsync. Necessary and, as EXP-0032 proved, NOT sufficient.
 *  · `drs_enable 0` — dynamic resolution scaling silently retargets the load to hit a frame-rate
 *    goal, which makes two runs incomparable by changing the work rather than the speed.
 *  · `flt_enable 1` — the denoiser, part of what makes this a game-shaped frame rather than a
 *    synthetic one. Fixed so it is a condition of the measurement and not a drifting default.
 *  · `nextserver quit` — the game ends ITSELF when the demo finishes. This is the one that makes an
 *    automated loop possible at all (researches/06 §4a).
 *
 * RESOLUTION IS DELIBERATELY ABSENT. In fullscreen this engine renders at the DESKTOP's resolution
 * and ignores `r_customwidth/height` — observed 2026-08-10, when a requested 1920×1080 window came
 * out at the desktop's 1280×720. So the geometry is a CONDITION to be probed and recorded, never a
 * setting to impose: imposing one would change the owner's display mode, which is the destructive
 * class for a measurement that has no business touching his desktop.
 */
export const Q2RTX_FIXED_CVARS = Object.freeze([
  ['vid_fullscreen', '1'],
  ['vid_vsync', '0'],
  ['cl_maxfps', '0'],
  ['r_maxfps', '0'],
  ['drs_enable', '0'],
  ['flt_enable', '1'],
  ['nextserver', 'quit'],
]);

/**
 * SOURCE: the engine's `com_timedemo` is a COUNT, not a flag — `+timedemo 5` plays the demo five
 * times from one launch and prints five FPS lines (researches/06 §4a.2). Five is what Phoronix's own
 * profile approximates with `TimesToRun 3`, and it costs one launch instead of five.
 *
 * THE DISTINCTION THAT MUST SURVIVE THIS CONVENIENCE: runs inside ONE launch share a thermal state
 * and a warm cache, so their agreement is a WITHIN-series spread. A pooled figure still needs
 * launches taken apart in time (EXP-0018, and P5-AC8 asks for exactly two independent series).
 */
export const Q2RTX_TIMEDEMO_RUNS = 5;

/**
 * SOURCE: measured — the first pass of a launch reads ~1.7 % low (cold caches, shader warm-up).
 * One run dropped, and the drop is RECORDED rather than silent: a discarded observation nobody can
 * see is indistinguishable from a discarded observation nobody agrees with.
 */
export const Q2RTX_COLD_RUNS_DROPPED = 1;

/**
 * The per-frame cost knob, and the two settings the cap proof compares.
 *
 * SOURCE: `pt_num_bounce_rays` is the engine's own indirect-lighting depth. Measured on this card at
 * 1280×720 fullscreen: 2 bounces → 54.07…54.54 fps at 299.97 W; 0 bounces → 79.08…79.98 fps. Two
 * settings whose cost differs by ~46 % is what makes the proof below cheap and unambiguous.
 */
export const Q2RTX_BOUNCE_RAYS = 2;
export const Q2RTX_BOUNCE_RAYS_CHEAP = 0;

/**
 * THE CAP PROOF'S THRESHOLD — how much the FPS must MOVE when the frame is made dramatically cheaper
 * before this bench's numbers are allowed to mean anything (STATUS fact 17; EXP-0032).
 *
 * SOURCE: the two states are not close. Capped, a ninefold cost change moved the number by
 * 0.000000 % (143.998154 both times). Uncapped, dropping the bounce rays moved it ~46 %. Any
 * threshold between those separates them; 5 % is chosen as ~6× the 0.88 % within-launch spread this
 * bench actually shows, so noise cannot fake a pass and a real cap cannot fake one either.
 *
 * WHAT IT IS NOT: a quality bar for the load. It is a proof that the instrument is measuring its
 * input at all — a number that ignores a large change in its input is not measuring that input.
 */
export const Q2RTX_CAP_PROOF_MIN_CHANGE_PCT = 5;

/**
 * THIS BENCH'S OWN FLOOR — the run-to-run scatter ACROSS LAUNCHES, which is the only kind that may
 * judge a delta (EXP-0018: a within-series figure understates the floor, and the power meter paid for
 * that lesson first).
 *
 * SOURCE: measured 2026-08-10 19:5x — two independent series of 5 runs each, both cooled to 42/40 °C
 * before starting, at stock: **56.68 and 56.17 fps → 0.90 %**. The sides also agreed on everything
 * else, which is what makes the figure believable rather than lucky: 299.8 vs 299.9 W (0.03 %),
 * 76 vs 75 °C, 2775 vs 2782 MHz (0.25 %).
 *
 * WHY IT MATTERS MORE THAN ANY OTHER NUMBER HERE: the owner's `Optimised` criterion is «просадка FPS
 * не более 5 %», and a budget can only be judged by an instrument whose own wobble is well inside it.
 * 5 % is **5.5×** this floor, so the judgement is legitimate.
 *
 * THE HONEST CAVEAT, kept in the constant rather than in a report nobody re-reads: the figure rests on
 * TWO series, and a min-max range over two points understates the true scatter. A third series
 * sharpens it — `npm run gfx -- --capture --label stock_gfx_c` then `--spread stock_gfx`.
 */
export const Q2RTX_FPS_SPREAD_PCT = 0.90;
export const Q2RTX_FPS_SPREAD_IS_ACROSS_LAUNCHES = true;
export const Q2RTX_FPS_SPREAD_SERIES = 2;

/**
 * A runaway backstop, not an expectation. Five timedemo runs took ~58 s at 1280×720; a heavier
 * desktop resolution multiplies that, and a hung Vulkan device would otherwise hold the bench
 * forever. Chosen an order of magnitude above the measured duration so it can only ever catch a
 * failure, never a slow-but-working run.
 */
export const Q2RTX_LAUNCH_TIMEOUT_MS = 900_000;

// =============================================================================================
// 8a. THE PLATEAU — what "the card has settled" means, as numbers a machine can check
// =============================================================================================
//
// WHY THIS SECTION EXISTS, and it is the most expensive lesson of phase 5 so far. Every fan↔temperature
// pair this project owns was taken off a TRANSIENT, and the owner named the cause before the data
// arrived: «эта телеметрия не учитывает огромную инерцию тепловую и механическую. Вентиляторы очень
// медленно разгоняются». The measurement agreed with a margin: on the way DOWN the fan crossed 40 % at
// 47 °C, on the way UP the same 40 % sat at 62-63 °C — a 15-16 °C spread for ONE fan level (STATUS
// fact 33). `Silent Cold` is now defined as maximum performance at T ≤ T(40 %), so the whole mode
// hangs off a number that only exists at equilibrium.
//
// AND EVERY RUN THIS PROJECT HAS EVER TAKEN WAS STILL CLIMBING WHEN IT ENDED — measured 2026-08-10
// 22:0x by running the detector below over the four saturated game captures on disk. Over each run's
// LAST 60 seconds the temperature still moved 10, 10, 17 and 24 °C. That is not a criticism of those
// runs (they were built to compare watts at matched start temperatures, which they did); it is the
// reason a plateau has to be DETECTED rather than assumed after a fixed wait.
//
// THE SHAPE OF THE TEST — two gates per quantity, because one is not enough and this project already
// paid for knowing that. EXP-0028: «"read until two consecutive samples agree" proves a settled DIGITAL
// state and does not transfer to a MECHANICAL one — a ramping quantity has plateaus, and a plateau
// agrees with itself.» A RANGE gate alone is exactly that mistake at window scale: a run climbing
// 2 °C/min sits inside a 3 °C band for ninety seconds at a time. So each quantity must pass BOTH:
//   · BAND — the p5…p95 spread over the window, which catches wobble;
//   · DRIFT — a RATE: the median of the window's second half minus the median of its first half,
//     divided by the time between the two halves' centroids, which catches a slow climb that the range
//     gate waves through.
//
// DRIFT IS A RATE AND NOT A DIFFERENCE, and the first draft of this section got it wrong in a way worth
// recording. Written as a plain «difference of half medians ≤ 1 °C» the gate reads as "moves less than
// a degree" and MEANS "moves less than a degree per HALF-WINDOW" — i.e. it silently permitted 2 °C per
// minute, and the selftest fixture that climbs 1.5 °C/min sailed through it. Expressed per minute the
// number means what a reader thinks it means, and it stops depending on the window length.

/**
 * SOURCE: the owner's own construction of this measurement, `plans/05` §4.5a, quoted: «нужно сделать
 * лестницу с жёсткими максимальными частотами, и гонять на них игру с лучами», with the plan's
 * requirement «temperature AND fan both stable for ≥ 60 s».
 */
export const PLATEAU_WINDOW_SECONDS = 60;

/**
 * SOURCE: THE FIRST GENUINELY SETTLED RUN THIS PROJECT HAS EVER TAKEN — 2400 MHz pinned under the RT
 * game, 555 s of load, measured 2026-08-10 22:5x. From 300 s onward the rung held four consecutive
 * minute-windows with zero drift; across its 510 settled samples the **p5…p95 band is 2 °C** (465 of
 * them sit on 65-66 °C). Three admits that with one degree to spare.
 *
 * WHY IT IS A PERCENTILE BAND AND NOT MIN-MAX, which is what the first draft used: min-max over the
 * same settled samples reads **10 °C**, decided entirely by five demo-transition samples at 58-62 °C.
 * A gate on min-max would refuse a perfectly settled card whenever the demo changed scene inside the
 * window — i.e. it would pass by luck. The earlier value (3 °C from min-max) came from the last 20 s of
 * SIXTY-SECOND runs, a window too short to contain a scene change, which is why it looked plausible.
 */
export const PLATEAU_TEMP_BAND_C = 3;

/**
 * DEGREES PER MINUTE, and the unit is the whole point (see the section header).
 *
 * SOURCE — physics, then calibration. The card approaches equilibrium exponentially, so the residual
 * RATE and the residual DISTANCE are the same fact: `dT/dt = (T∞ − T)/τ`. Measured on this card under
 * the game, 53 → 76 °C in 56 s, τ is on the order of a minute — so a residual 1 °C/min means the card
 * is roughly 1 °C from where it is going, which is inside the 3 °C band the sensor's own noise occupies
 * anyway. Asking for less is asking for a number this instrument cannot resolve: medians of whole
 * degrees quantize the drift to 0.5 °C steps, and over a 60 s window that IS 1 °C/min.
 *
 * CALIBRATED BY WHAT IT REFUSES, which is the only honest way to set a gate: on the 555 s settled run
 * the minute-by-minute drift went **+4 → +2 → +1 → −4 → 0 → 0 → 0 → 0 → 0** °C/min, so this value
 * admits the tail and refuses the approach. And `npm run thermal -- --analyze` refuses every one of the
 * thirteen captures that predate it. A gate that passes everything already measured would be decoration.
 */
export const PLATEAU_TEMP_DRIFT_C_PER_MIN = 1;

/**
 * SOURCE: the same settled run — across its 510 settled samples the fan's **p5…p95 band is 1 pp**
 * (54-55 %). Three admits it with room for the quantization of a whole-percent reading.
 */
export const PLATEAU_FAN_BAND_PCT = 3;

/**
 * PERCENTAGE POINTS PER MINUTE — and this number was DERIVED first and then MEASURED, which is the only
 * reason it is now correct. The derivation ran: the AUTO curve moves ≈ 2.3 pp per °C, so 1 °C/min of
 * allowed temperature drift is worth ≈ 2 pp/min of fan. **The premise was wrong.** On the first settled
 * run the temperature's drift was exactly ZERO while the fan still fell 2 %/min — the fan is not merely
 * following the temperature, it has its own slow convergence, and a gate of 2 accepted a window while
 * the fan still had 2-4 pp of travel left in it. That is not a rounding error: the two 2400 MHz runs
 * reported 59 % and 53 % as "equilibrium" while the true settled value is 55 %.
 *
 * MEASURED REPLACEMENT: on the 555 s run the fan's minute-by-minute drift went **+20 → +4 → +2 → 0 →
 * −2 → 0 → 0 → 0 → −2** pp/min. One admits the settled tail and refuses every approach window.
 */
export const PLATEAU_FAN_DRIFT_PCT_PER_MIN = 1;

/**
 * How long one rung may be held before the run gives up and REPORTS that it never settled.
 *
 * SOURCE: the measured approach. Under the game the card went 53 → 76 °C in 56 s, so the thermal
 * constant is short; the fan is the slow part (≈ 8 s to ramp, plus the AUTO curve's own lag). Ten
 * minutes is an order of magnitude above the observed approach — it can only catch a rung that never
 * equilibrates, never a slow-but-working one. A rung that hits it is reported as «не вышла на плато»
 * with how far it got, never averaged into the table (`PHILOSOPHY.md` → the three doors).
 */
export const PLATEAU_TIMEOUT_SECONDS = 600;

/**
 * WHAT COUNTS AS "UNDER LOAD" WHILE HUNTING A PLATEAU — and it is NOT the same threshold the burst
 * runs use (`LOAD_PHASE_UTILIZATION_PCT` = 50), which is why it is a separate constant instead of a
 * reused one.
 *
 * SOURCE: measured 2026-08-10 22:1x by running the detector over the thirteen captures on disk and
 * then reading the samples it refused. The game's utilization falls into TWO clusters, and 50 % sits
 * exactly in the gap of the wrong one:
 *   · mid-run frame boundaries read **47-49 % at 100-160 W** — the card is working; a 0.5 s dip like
 *     that cannot move a thermal equilibrium whose time constant is a minute;
 *   · genuine non-load (game start-up, the reload between demo repetitions) reads **0-22 % at
 *     29-58 W** — an order of magnitude less power.
 * Thirty per cent sits between the clusters with roughly a factor of two of headroom on each side.
 *
 * WHY IT MATTERED: at 50 % those single frame-boundary samples chopped a continuous run into 22-second
 * pieces, and a 60 s window could never form under the very load this ladder is built to use.
 *
 * WHY UTILIZATION AT ALL, given that this project measured `utilization.gpu` to be a poor instrument of
 * load MAGNITUDE (STATUS fact 16: 99 % at 137 W and 99 % at 300 W): the question here is not how hard
 * the card is working but WHETHER it is, and for that the two clusters above are unambiguous.
 */
export const PLATEAU_LOAD_UTILIZATION_PCT = 30;

/**
 * THE CEILING THAT DEFINES `Silent Cold`, and it is the owner's ear rather than a round number.
 *
 * SOURCE: his words, chat 2026-08-10, after listening to the fan ladder on the live card — *«Я слышу
 * 40 - приемлимо, тихо. 50 уже слышно»* — and then the mode's definition itself: *«целится на то, чтобы
 * Silent Cold давал максимально возможную производительность при температуре не выше, при которой
 * вертушки вращаются на 40%»* (GOAL.md → «Поправка к Silent Cold»).
 *
 * WHAT CHANGED WHEN HE SAID IT: the earlier threshold was 45 %, which he had derived as the midpoint
 * between «тихо» and «уже слышно». The mode is no longer a budget of losses («отдать до 10 %») but an
 * OPTIMIZATION — the most performance obtainable under a temperature ceiling — so the ceiling moved to
 * the level he actually called quiet.
 *
 * HOW IT IS USED: `readSilentCold()` in `thermal-ladder.mjs` reads the mode straight off the ladder —
 * the HIGHEST rung whose EQUILIBRIUM fan is ≤ this. Equilibrium is the load-bearing word: the same
 * fan level sat at 47 °C on a cooling card and 62-63 °C on a heating one (STATUS fact 33), so a
 * transient reading of this number decides nothing.
 */
export const SILENT_COLD_FAN_CEILING_PCT = 40;

// =============================================================================================
// 9. Power limit — read from the card, never hard-coded
// =============================================================================================

/**
 * This card's range is 250–300 W (researches/01 §2), and that pair is deliberately NOT a constant
 * here. A hard-coded floor is a number that silently becomes wrong on another card, after a VBIOS
 * change, or under a different power profile — and this module's job is to be auditable, not to
 * remember hardware.
 *
 * @param {{min:number, max:number, current:number, default:number}} probed
 *   as returned by hardware-mon from `power.min_limit` / `power.max_limit` / `power.limit` /
 *   `power.default_limit`.
 * @returns {{min:number, max:number, headroomWatts:number, headroomFraction:number}}
 */
export function powerEnvelope(probed) {
  const min = Number(probed.min);
  const max = Number(probed.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0 || min > max) {
    throw new Error(`powerEnvelope: implausible probe {min:${probed.min}, max:${probed.max}} — read the card again rather than assuming a range`);
  }
  return {
    min,
    max,
    headroomWatts: max - min,
    headroomFraction: (max - min) / max,
  };
}

/**
 * The guardband in millivolts for a given failure voltage, applying both conditions of
 * researches/02 §3 Step 3 — at least GUARDBAND_MIN_GRID_STEPS steps AND at least
 * GUARDBAND_MIN_MILLIVOLTS, whichever is larger.
 *
 * Returns the margin AND whether it rests on a measured grid step, so a caller that reports a
 * millivolt figure to the owner can say honestly which half of it is an estimate.
 */
/**
 * THE MARGIN THE OWNER SET, as millivolts on THIS card — two measured grid steps above the failure.
 *
 * Returns the number AND whether the grid step under it was measured, so a caller reporting a
 * millivolt figure can say honestly which half of it is an estimate. On this card the step is
 * measured (5 mV), so the answer is a measurement: 10 mV.
 */
export function marginAboveFailureMv(gridStepMv = VOLTAGE_GRID_STEP_MV) {
  return {
    millivolts: MARGIN_STEPS_ABOVE_FAILURE * gridStepMv,
    steps: MARGIN_STEPS_ABOVE_FAILURE,
    gridStepMv,
    gridStepIsMeasured: VOLTAGE_GRID_STEP_IS_MEASURED,
  };
}

export function guardbandMillivolts(gridStepMv = VOLTAGE_GRID_STEP_MV) {
  const fromSteps = GUARDBAND_MIN_GRID_STEPS * gridStepMv;
  return {
    millivolts: Math.max(fromSteps, GUARDBAND_MIN_MILLIVOLTS),
    boundBy: fromSteps >= GUARDBAND_MIN_MILLIVOLTS ? 'grid-steps' : 'millivolt-floor',
    gridStepIsMeasured: VOLTAGE_GRID_STEP_IS_MEASURED,
  };
}

/** Every constant in one object — what the phase-1 step 3.1 verification prints and audits. */
export default Object.freeze({
  GUARDBAND_MIN_GRID_STEPS,
  GUARDBAND_MIN_MILLIVOLTS,
  MARGIN_STEPS_ABOVE_FAILURE,
  VOLTAGE_GRID_STEP_MV,
  VOLTAGE_GRID_STEP_IS_MEASURED,
  CLOCK_OFFSET_GRANULARITY_IS_MEASURED,
  POWER_METER_SPREAD_W,
  POWER_METER_SPREAD_PCT,
  CLOCK_OFFSET_MIN_MHZ,
  CLOCK_OFFSET_MAX_MHZ,
  CLK_VF_POINT_COUNT,
  CURVE_GRAPHICS_POINT_COUNT,
  CLOCK_LADDER_STEP_TOLERANCE_MHZ,
  SESSION_MAX_DEPTH_BEYOND_KNOWN_MV,
  FAST_DESCENT_FLOOR_MV,
  DESCENT_ZONES,
  CLOCK_OFFSET_RANGE_IS_MEASURED,
  EXPRESS_TEST_SECONDS,
  TRANSIENT_ON_SECONDS,
  TRANSIENT_OFF_SECONDS,
  ADAPTIVE_INTENSITY_BAND,
  LOWLOAD_ON_SECONDS,
  LOWLOAD_OFF_SECONDS,
  DETERMINISM_REPEATS,
  LOAD_PHASE_UTILIZATION_PCT,
  BASELINE_SAMPLER_PAD_SECONDS,
  THERMAL_THROTTLE_REASONS,
  THERMAL_SOAK_SECONDS,
  THERMAL_SOAK_IS_MEASURED,
  TELEMETRY_FIELDS,
  TELEMETRY_FIELDS_UNAVAILABLE_HERE,
  TELEMETRY_SAMPLE_MS,
  FAULT_PROVIDERS,
  ASCENT_FIRST_STEP_MAX_MV,
  ASCENT_STEP_MAX_MV,
  VERDICT,
  READBACK_AGREEING_SAMPLES,
  READBACK_INTERVAL_MS,
  READBACK_TIMEOUT_MS,
  BOOT_PROBE_RETRIES,
  BOOT_PROBE_RETRY_INTERVAL_MS,
  FAN_LEVEL_TOLERANCE_PCT,
  FAN_RAMP_TIMEOUT_MS,
  FAN_RAMP_IS_MEASURED,
  LOCK_DELIVERY_TOLERANCE_MHZ,
  LOCK_IS_OBSERVABLE_AT_IDLE,
  Q2RTX_ROOT,
  Q2RTX_EXE,
  Q2RTX_LOG_RELATIVE,
  Q2RTX_DEMO,
  Q2RTX_FIXED_CVARS,
  Q2RTX_TIMEDEMO_RUNS,
  Q2RTX_COLD_RUNS_DROPPED,
  Q2RTX_BOUNCE_RAYS,
  Q2RTX_BOUNCE_RAYS_CHEAP,
  Q2RTX_CAP_PROOF_MIN_CHANGE_PCT,
  Q2RTX_FPS_SPREAD_PCT,
  Q2RTX_FPS_SPREAD_IS_ACROSS_LAUNCHES,
  Q2RTX_FPS_SPREAD_SERIES,
  Q2RTX_LAUNCH_TIMEOUT_MS,
  PLATEAU_WINDOW_SECONDS,
  PLATEAU_TEMP_BAND_C,
  PLATEAU_TEMP_DRIFT_C_PER_MIN,
  PLATEAU_FAN_BAND_PCT,
  PLATEAU_FAN_DRIFT_PCT_PER_MIN,
  PLATEAU_TIMEOUT_SECONDS,
  PLATEAU_LOAD_UTILIZATION_PCT,
  SILENT_COLD_FAN_CEILING_PCT,
});
