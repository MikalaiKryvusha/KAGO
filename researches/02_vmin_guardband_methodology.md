# Research 02 — Finding the per-point voltage optimum: Vmin search and the guardband

> **Created:** 2026-08-09 (agent, on the owner's question in chat)
> **Parent:** owner's drive-by note, 2026-08-09 21:33 +03:00 — *"нужна методология, как так настроить,
> чтобы напряжения были в каждой точке чуть выше точки сбоев видеокарты, в зоне надёжной стабильной
> работы без сбоев и артефактов. Уверен, эти методологии уже формализованы и описаны в интернете"*
> **Status:** ✅ the methodology exists and is quantified — synthesized below into KAGO's search
> algorithm. Feeds `MASTER_PLAN.md` phase 3 and the design of `engine.mjs` / `stress-tester.mjs`.
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

## 5. Sources

- Leng, Zu, Reddi — [*Safe Limits on Voltage Reduction Efficiency in GPUs: a Direct Measurement Approach*](https://cs.sjtu.edu.cn/~leng-jw/resources/Files/leng15micro-gpuvminexp.pdf), MICRO 2015 — all numbers in §2.
- [*Exploring the Voltage Limits of AMD NAVI GPUs for Energy Efficiency*](https://www.ceid.upatras.gr/webpages/faculty/gpapad/assets/papers/iolts2025_trakosa.pdf), IOLTS 2025 — the same guardband/SDC structure on a modern part.
- [*The Anatomy of Silent Data Corruption: GPU Error Pattern Study*](https://arxiv.org/html/2605.04213v1) — why SDC screening that looks only for NaN/INF catches ~1 % of corruptions; detection must compare full outputs.
- [OCCT — inside the adaptive approach to GPU stress testing](https://www.ocbase.com/news/occt-gpu-stress-testing-modern-adaptive-approach) — the 40–60 % intensity band and built-in artifact/error counters.
- [MSI — RTX 50-series undervolting guide](https://www.msi.com/blog/rtx-5070-5060ti-overclocking-undervolting-guide-with-msi-afterburner-part-2) — the practitioner "pick a voltage point, raise it, flatten the tail" procedure KAGO automates.
