# Research 02 — Finding the per-point voltage optimum: Vmin search and the guardband

> **Created:** 2026-08-09 (agent, on the owner's question in chat)
> **Parent:** owner's drive-by note, 2026-08-09 21:33 +03:00 — *"нужна методология, как так настроить,
> чтобы напряжения были в каждой точке чуть выше точки сбоев видеокарты, в зоне надёжной стабильной
> работы без сбоев и артефактов. Уверен, эти методологии уже формализованы и описаны в интернете"*
> **Status:** 🟢 **REVISED 2026-08-10 — READ §6 BEFORE §3.** The SCIENCE in §3 survived an industry
> sweep; the PRACTICE did not. §6 records what the sweep found: the missing "flatten the tail" step
> (without which raising the curve buys speed, not watts), the express test demoted to candidate
> selection, and the edge being a PROBABILITY rather than a line. Feeds `MASTER_PLAN.md` phases 5–6
> and the design of `engine.mjs` / `stress-tester.mjs`.
> **Outbound:** the "one benchmark is not enough" finding → a correction to the acceptance criteria
> inherited from the owner's PDF, which validates on 3DMark alone.

---

## 1. The owner was right — it is formalized

The industry term for what the owner described is the **voltage guardband**: the margin the vendor
adds above the lowest voltage at which the chip is still functionally correct (**Vmin**), to survive
worst-case process, temperature, aging and supply noise. Undervolting is the act of reclaiming part
of that guardband; the whole craft is deciding *how much* to leave.

The reference measurement is **Leng, Zu, Reddi, "Safe Limits on Voltage Reduction Efficiency in
GPUs: a Direct Measurement Approach"** (MICRO 2015) — 57 programs, four GPU generations, real
cards, output-correctness checking. Its numbers are the backbone of everything below.

## 2. What the measurements actually say

| Finding | Number | What it means for KAGO |
|---|---|---|
| Guardband available | **9.2–18.3 %** of nominal (GTX 680); 11.5–23.3 % across four cards | There is real room. Roughly 100–200 mV on a ~1.0 V part. |
| **Vmin is program-dependent** | **0.89 V … 0.99 V** across 57 programs on ONE card — a **100 mV spread** | A profile validated on one benchmark says almost nothing about another workload. This is the single most important finding. |
| Distance from Vmin to OS crash | **only 4–5 %** of voltage | The corridor between "first error" and "the machine dies" is narrow. |
| **Avalanche effect** | one program's error rate went **3 % → 90 %** when undervolt went 10 % → 12 % | Failure near the edge is a **cliff, not a slope**. Stopping the search at "first observed failure" leaves you sitting on it. |
| Card-to-card process variation | up to **0.07 V** between five identical GTX 780s | Copying a profile from a forum, or from another 5070 Ti, is not valid. Each card must be characterized on its own. This is KAGO's reason to exist. |
| Dominant cause of Vmin variability | **voltage noise (IR drop and di/dt droop)** — larger than process, temperature or aging | Steady-state load testing is the *wrong* test. Transients are what kill an undervolt. |
| Failure-mode split | **37 of 57 SDC-prone**, 20 crash-prone; control-heavy code crashes, fixed-loop code corrupts silently | "It didn't crash" is not a stability result. Output correctness must be checked. |

### 2.1. The consequence nobody likes

Two of these compound badly. Failure near the edge is a cliff, and more than half of programs fail
**silently** first. So the naive loop — *drop voltage until it crashes, then step back one* — finds
the edge of the *crash* region, having already spent an unknown distance inside the *corruption*
region without noticing. That is the method most online guides teach, and it is how people end up
with a "stable" undervolt that quietly writes wrong pixels for a year.

## 3. The method KAGO will implement

### Step 0 — the golden reference

Run the whole workload set at stock and store the outputs (frame checksums, benchmark scores,
compute results) as **golden references**, along with driver and VBIOS version. Everything later is
compared against this, not against "looks fine".

### Step 1 — per-point descent with an error-detecting oracle

For each voltage point on the curve, walk the frequency up (or the voltage down) in single grid
steps, and at each step run a **short express test whose output is compared to the golden
reference**. The stability oracle is a three-way classification, taken straight from the paper:

| Verdict | How it is detected |
|---|---|
| **PASS** | output matches the golden reference |
| **SDC** — silent data corruption | output differs, nothing crashed — *the dangerous one* |
| **CRASH** | driver TDR (Windows Event Log, source `Display`), CUDA/runtime error, application death, WHEA, BSOD |

`event-logger.mjs` owns the crash half of this table; `stress-tester.mjs` owns the SDC half. A test
harness that can only see the crash half is only half a harness.

### Step 2 — bracket the edge, don't step onto it

Coarse descent to first failure, then binary search *upward* between last-PASS and first-FAIL to
locate the edge at grid resolution. Because of the avalanche effect, the search never dwells at the
failing point: one failure at a point is enough to mark it and back off.

### Step 3 — apply the guardband

The edge found in step 2 is **V_fail**. The shipped profile uses **V_fail + guardband**, and the
guardband is not a taste decision — it is sized from the things the search could not observe:

| Source of risk | Why the search misses it | Contribution |
|---|---|---|
| Avalanche steepness | error rate explodes within ~2 % of voltage | ≥ 20 mV |
| Workloads never tested | Vmin spread across programs is 100 mV; our set is finite | the main reason margin exists at all |
| Aging | silicon slows over months; the search is a snapshot | re-validation, plus margin |
| Thermal and supply conditions outside the test | summer ambient, a different PSU load | validate hot, then still leave room |

**Working rule: guardband = at least 4 curve steps above V_fail, and never less than 25 mV** — with
the curve's voltage grid (widely held to be 6.25 mV on NVIDIA parts) to be **confirmed by probing
the live curve in phase 2**, not taken on faith. If a point's guardband cannot be afforded without
losing the profile's target, the profile loses, not the guardband.

### Step 4 — the workload set must be diverse, or the number is a lie

Because Vmin is program-dependent by 100 mV, the profile is only as good as the worst workload it
was validated against. The set must span both failure classes:

- **Crash-prone shape** — control-heavy, branchy, irregular memory: real game engines, graph or
  path-tracing workloads.
- **SDC-prone shape** — fixed-loop, regular, arithmetic-dense: matrix and FFT kernels, where the
  answer is checkable exactly.
- **Transient shape** — the one that matters most, since voltage noise dominates: the PDF's
  *Transient Load Test* (100 % load 5 s ↔ idle 5 s), plus **OCCT's 3D Adaptive**, which varies load
  continuously and is documented to expose instability in the 40–60 % intensity band that flat
  100 % tests like FurMark never reach.

**The final V_fail for a point is the maximum across the whole set**, never the average and never
the first one found.

### Step 5 — soak, then re-validate on change

A 3-minute express test qualifies a point; it does not qualify a profile. The profile faces the
long run (the PDF's 20× SpeedWay stress loop, frame-rate stability ≥ 98.5 %) and a soak. After that,
the profile is bound to the driver and VBIOS it was proved on, and **any driver update invalidates
it** until re-validated — see the `595.71` voltage-cap incident recorded in research 01.

## 4. What this changes in the owner's PDF

The master plan's step engine walks frequency in ±15/−20 MHz steps and judges a point by "3 min
express test → pass or driver TDR". That is the crash-only oracle. Three corrections follow:

1. **Add the SDC verdict.** Output comparison against a golden reference, not just "did it survive".
2. **Add the guardband step.** The PDF fixes `Freq_max_stable` at the last passing point; KAGO backs
   off from it by a sized margin.
3. **Validate on a diverse set, not on 3DMark alone.** The acceptance matrix in the PDF measures
   performance with TimeSpy/SpeedWay — fine for *performance*, insufficient for *stability*.

## 6. REVISION 2026-08-10 — the industry sweep, and two things §3 got wrong

> **Why this section exists.** The owner asked the question this document should have answered before
> anything was built: *«это такой процесс описывают в интернете? он самый надёжный и научно
> оптимальный?»* Checking it found that §3 is well grounded in the SCIENCE and materially incomplete
> against the PRACTICE. `PHILOSOPHY.md` names the failure exactly: *"look for the established pattern
> first… don't invent where a proven path exists."*

### 6.1 What survived the check

| §3 element | Verdict | Where it stands |
|---|---|---|
| SDC oracle — output vs golden | ✅ and it is **stronger than the mainstream** | Practitioner guides say "watch for artifacts and crashes"; Leng et al. measured that 37 of 57 programs corrupt SILENTLY first. Our oracle closes a gap the hobbyist method leaves open. |
| Guardband above the failure point | ✅ standard | Vendor patents add margins over a searched Vmin explicitly for process variation and aging. |
| Binary search for the edge | ✅ used in the literature | Leng et al. determine each benchmark's Vmin by binary search. |
| Diverse workload set | ✅ and it is the paper's central finding | 100 mV Vmin spread across programs. |

### 6.2 THE MISSING STEP — raising the curve without capping the top is not an undervolt

The practitioner method has **two** actions and §3 described only the first:

1. pick a voltage point and raise its frequency — §3 has this;
2. **flatten the curve above that point**, so the card STOPS there instead of boosting on to higher
   voltage points — **§3 does not have this at all**.

Without step 2 the card simply takes the extra headroom and climbs: it runs faster at the same
voltage rather than the same speed at less voltage. Watts and degrees do not fall — which is the
whole objective in the owner's formula («снижаем потребление, пока цена ≤ N»). The first live step
(point 95, +15 MHz, verdict PASS) therefore proved the MECHANISM and delivered no undervolt benefit.

**This is a composition, not a redesign: both halves already exist here.** The clock ceiling is
`nvidia-smi -lgc`, measured and proved in phase 2 (`LOCK_DELIVERY_TOLERANCE_MHZ = 8`, lock observable
under load — EXP-0020). `MASTER_PLAN.md` phase 6 already implied it in the owner's own terms:
`Max Optimal`'s lever is *"напряжение при ПОЛНОЙ частоте"* — full clocks held while voltage drops is
precisely "anchor and flatten".

### 6.3 THE EXPRESS TEST IS NOT A STABILITY RESULT

§3 Step 5 says a 3-minute express test qualifies a point and not a profile. The sweep says the gap is
wider than that wording admits: practice calls for **an hour of stress as an EARLY check**, plus real
gameplay, and states plainly that even hours of play can leave instability undiscovered. So:

- an express test **selects a candidate**; it never qualifies anything;
- qualification is the long burn plus the diverse set — and the owner's own convergence loop
  (`AGENT_GUIDE.md` → Notes from the human) is the better-shaped version of this, because it retests
  the WHOLE curve after each iteration and ratchets any point that ever failed.

### 6.4 THE HONEST LIMIT OF THE METHOD — the edge is a probability, not a line

Binary search presupposes a boundary: below it fails, above it passes. The paper's own numbers say
otherwise — the error rate runs 3 % → 90 % across 2 % of voltage, so a point has a FAILURE
PROBABILITY, not a threshold. Consequences that must not be smoothed over:

- **one PASS does not qualify a point** — it says this run did not catch it;
- a binary search returns the edge *as sampled*, and re-running it can return a different one;
- this is exactly why the guardband is not optional and why a ratchet (a point that ever failed is
  never lowered again) is sounder than a re-searched number.

Where the industry is actually heading is a third thing entirely: vendor patents describe PREDICTING
the guardband from performance counters with a failsafe, rather than searching once and shipping.
Out of scope here, but it is evidence that "find the edge and freeze it" is regarded as fragile.

### 6.5 What changes in KAGO

1. **A profile = raised curve + clock ceiling.** The ceiling is part of the profile, not an option.
   For `Max Optimal` the target is stated as "the stock clock, at less voltage".
2. **The express test is demoted** to candidate selection; the point's verdict comes from the diverse
   set and the long burn.
3. **A point carries the history of every verdict it ever produced**, so escalation is a ratchet
   rather than a fresh guess.

## 5. Sources

- Leng, Zu, Reddi — [*Safe Limits on Voltage Reduction Efficiency in GPUs: a Direct Measurement Approach*](https://cs.sjtu.edu.cn/~leng-jw/resources/Files/leng15micro-gpuvminexp.pdf), MICRO 2015 — all numbers in §2.
- [*Exploring the Voltage Limits of AMD NAVI GPUs for Energy Efficiency*](https://www.ceid.upatras.gr/webpages/faculty/gpapad/assets/papers/iolts2025_trakosa.pdf), IOLTS 2025 — the same guardband/SDC structure on a modern part.
- [*The Anatomy of Silent Data Corruption: GPU Error Pattern Study*](https://arxiv.org/html/2605.04213v1) — why SDC screening that looks only for NaN/INF catches ~1 % of corruptions; detection must compare full outputs.
- [OCCT — inside the adaptive approach to GPU stress testing](https://www.ocbase.com/news/occt-gpu-stress-testing-modern-adaptive-approach) — the 40–60 % intensity band and built-in artifact/error counters.
- **Industry sweep, 2026-08-10 (§6):** [XDA — undervolting is great, but you need to properly test stability](https://www.xda-developers.com/undervolting-is-great-but-you-need-to-properly-test-stability/) · [wccftech — why FurMark alone is not enough](https://wccftech.com/how-to/how-to-properly-stress-test-your-gpu/) · [US10642342B2 — predicting voltage guardband and operating at a safe limit](https://patents.google.com/patent/US10642342B2/en) — the vendors' own direction: predict the guardband, do not freeze a searched one
- [MSI — RTX 50-series undervolting guide](https://www.msi.com/blog/rtx-5070-5060ti-overclocking-undervolting-guide-with-msi-afterburner-part-2) — the practitioner "pick a voltage point, raise it, flatten the tail" procedure KAGO automates.
