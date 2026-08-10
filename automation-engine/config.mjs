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
// 8. Power limit — read from the card, never hard-coded
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
  VOLTAGE_GRID_STEP_MV,
  VOLTAGE_GRID_STEP_IS_MEASURED,
  CLOCK_OFFSET_GRANULARITY_IS_MEASURED,
  POWER_METER_SPREAD_W,
  POWER_METER_SPREAD_PCT,
  CLOCK_OFFSET_MIN_MHZ,
  CLOCK_OFFSET_MAX_MHZ,
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
  VERDICT,
  READBACK_AGREEING_SAMPLES,
  READBACK_INTERVAL_MS,
  READBACK_TIMEOUT_MS,
  FAN_LEVEL_TOLERANCE_PCT,
  FAN_RAMP_TIMEOUT_MS,
  FAN_RAMP_IS_MEASURED,
  LOCK_DELIVERY_TOLERANCE_MHZ,
  LOCK_IS_OBSERVABLE_AT_IDLE,
});
