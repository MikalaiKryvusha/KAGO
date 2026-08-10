# Research 04 — KAGO's own benchmark and stress test: the traps, and what may be reused

> **Created:** 2026-08-10 (agent, on the owner's instruction: *«вероятно, да, нужен будет свой
> бенчмарк нам разработать, и свой стресс тест. Нужно делать ресёрч в сети, как их делать»*)
> **Parent:** `plans/01_EPIC_kago_orchestrator.md` — the meter for AC4/AC5 · `plans/03` §4.3
> **Status:** 🟡 open — web recon done 2026-08-10; the four card-specific questions in §8 are NOT
> measured yet and are the next step
> **Outbound:** the fourth verdict axis → `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R4 and
> `automation-engine/lib/stress-tester.mjs` · the reuse decision → the owner · the low-load test
> shape → `plans/03` §4.3 and phase 5

---

## 1. Why this document exists

Phase 1 built an oracle with three verdicts — PASS / SDC / CRASH — and phase 2 needs a fourth
instrument the plan called "the price meter": something that says what a profile COSTS, because the
owner's design formula is *maximize the power reduction while the price stays ≤ N*.

While that was being planned, the owner brought two facts from CPU tuning and asked whether GPUs and
VRAM have the same traps:

> *«при сильном тюнинге CPU из низкой нагрузки при попытке резко разогнаться - падает в ошибку …
> Нестабильность в простое (Low-load crashes): … ПК будет стабильно проходить тяжёлые стресс-тесты
> (Cinebench, Prime95), но вылетать в синий экран (BSOD) при клике по иконке на рабочем столе …
> Clock Stretching (Замещение частоты): Если процессору не хватает питания, он может формально
> показывать высокую частоту в мониторинге, но фактически пропускать такты в ожидании стабильного
> тока. В итоге частота высокая, а производительность в тестах падает.»*
>
> *«возможно есть подобные подвохи и у GPU и у VRAM»*

**Both traps exist on GPUs. The VRAM analogue exists too and is the nastiest of the three.** All
three are documented below with sources. The consequence is not a footnote — it invalidates an
assumption our oracle is built on.

## 2. THE FINDING: KAGO's current oracle has a blind spot, and it is exactly where these traps live

`stress-tester.mjs` today issues a verdict from two observations: **the checksum against a golden
reference** (catches silent data corruption) and **the Windows event log** (catches crashes, TDR,
WHEA, bugcheck). `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R4 states the pair as sufficient: *"A
stability verdict needs BOTH `stress-tester` and `event-logger`."*

**Two of the three traps below produce a CORRECT checksum and NO event.** Clock stretching skips
work; the memory subsystem retries failed transfers until they succeed. In both cases the data that
comes out is right, nothing crashes, no artifact appears on screen — **the only thing that changes is
how much work happened per second.**

So a profile suffering either one would be stamped **PASS** by our current harness, and the owner
would receive a "verified" profile that quietly made his card slower. That is worse than a missed
defect: it is the false-PASS class, the same family as the false-SDC that EXP-0011 caught.

**Therefore the verdict needs a fourth axis, and it needs the price meter anyway:**

| Axis | Question | Instrument | Status |
|---|---|---|---|
| Correctness | did the output change? | checksum vs golden | ✅ built (phase 1) |
| Liveness | did anything crash? | Windows event log | ✅ built (phase 1) |
| **Throughput** | **did the same work take longer?** | **work per second vs a stock reference** | ❌ **missing — this document's subject** |
| Price | what did the profile cost? | the same throughput number | ❌ missing (same instrument) |

The price meter and the degradation detector are **one instrument**, which is a piece of luck: the
number the owner needs for N is the same number that catches two invisible failure modes.

## 3. The three traps, with evidence

### 3.1 Low-load instability — the owner's first fact, confirmed on GPUs

An undervolt can be **conditionally stable**: it survives sustained heavy stress and dies on light
work. Field reports describe an RTX 3080 at 850 mV / 1860 MHz that ran stable under load and crashed
**while idling**; others describe crashes in a browser or on one game while heavier games pass.
The mechanism named is that the low end of the V/F curve has different stability requirements from
the loaded high end.

This is the GPU form of exactly what the owner described for CPUs, and it means:

- **A heavy sustained test cannot qualify a profile.** It never visits the region where the failure
  lives. Our transient shape (5 s on / 5 s off, `config.TRANSIENT_ON_SECONDS`) already moves through
  that region — `researches/02` chose it because voltage noise dominates Vmin — but the test set must
  also *dwell* at low load and low clocks, not only pass through.
- **The idle→burst edge is a test case in its own right**, and it is the one the owner named first:
  "from low load, trying to ramp up hard".

### 3.2 Clock stretching — the owner's second fact, and NVIDIA GPUs do it

> *"Some GPUs, especially from NVIDIA, have something called clock stretching, which is a hardware
> level feature to avoid crashing. When the GPU notices that it'll be unstable at its current
> frequency/voltage setting it can skip instructions, essentially doing less effective work."*
> *"The tricky part is that this doesn't reduce the core clock — you'll still see a constant core
> clock while observing diminished scores on benchmarks."*

**This is a direct attack on our read-back.** `profile-manager.mjs` proves a clock lock by observing
`clocks.gr` sit on the requested point (EXP-0014). Under clock stretching, `clocks.gr` reporting
1200 MHz does **not** mean the card is doing 1200 MHz worth of work. The read-back is still correct
about what was *commanded*; it was never evidence about what was *delivered*, and this is the reason
that distinction matters.

**The documented detection method is precisely the missing instrument:** run a benchmark at stock and
again under the profile, **recording the core clock throughout**; a score drop outside the margin of
error while the reported clock is unchanged means the card is stretching. Note the two halves — the
clock must be recorded, or a plain slowdown from a lower clock looks the same.

Also documented, and worth keeping: **not every GPU stretches.** A 2080 Ti reportedly crashes outright
instead. So whether THIS card stretches is a question to answer by measurement, not by reading (§8).

### 3.3 The VRAM trap — the owner's guess was right, and this one is the worst

Modern NVIDIA memory subsystems **detect transmission errors and retry them**. On GDDR6X the feature
is named Error Detection and Replay (EDR): a CRC check value accompanies the transfer, and *"the
memory controller is able to detect most transmission errors, and will keep retrying that memory
transfer until it succeeds."*

The consequence, stated by the sources and by NVIDIA:

> *"For memory overclocking, you can no longer rely on crashes or artifacts as indicators of the
> maximum memory clock. Rather, you have to observe performance, which reaches a plateau when memory
> is 100 % stable and no transactions have to be replayed."*
>
> NVIDIA: *"you may not even see artifacts on the screen, but that does not mean that … the modules
> are not damaged by overclocking."*

**On THIS card the memory is GDDR7, not GDDR6X — and the masking is if anything stronger.** JEDEC's
GDDR7 standard carries **internal ECC** (minimum 16 parity bits per 256 data bits; the sample
implementation splits them 9 ECC + 7 CRC) plus forward error correction that *"can detect and correct
bit errors without requiring data retransmission."* Errors are therefore corrected or replayed rather
than surfacing — and the community characterization of GDDR7 overclock behaviour is explicitly still
in progress, which is a further argument for measuring rather than reading.

**Why this matters even though KAGO does not touch memory clocks today:** the failure mode is not
"memory overclocking" but "errors that cost throughput instead of showing themselves". It is the
generic shape of both 3.2 and 3.3, and the reason the throughput axis is not optional.

## 4. What may be REUSED — licenses read from the repositories, not recalled

The owner asked not to reinvent the wheel. The constraint that decides each row: **KAGO is MIT and
must not acquire a copyleft obligation, and `GOAL.md` forbids a third-party GUI in the dependencies**
(all four below are headless/console, so the GUI rule is satisfied by all of them; the licence is what
separates them).

| Tool | What it gives us | License (read from the repo) | Verdict |
|---|---|---|---|
| **gpu-burn** (wilicc) | A CUDA stress kernel that **verifies its own results against a reference** — the SDC oracle shape, already proven in the field; multi-GPU, console, reports passes/errors/temperature | **BSD-2-Clause**, © Ville Timonen | ✅ **May be vendored with attribution.** Closest match to our stress half |
| **memtest_vulkan** (GpuZelenograd) | VRAM stability testing via Vulkan compute; *"write once at start but reread every time"* pattern catches bits that flip during storage/refresh; console, no installation, prebuilt binaries | **zlib** | ✅ **May be vendored.** The one tool that addresses §3.3 directly. Caveat: output is human-readable tables, so KAGO would have to parse text — a truth↔mirror pair to register |
| **mixbench** (ekondis) | Sweeps **operational intensity** (compute↔memory ratio) and applies the roofline model — exactly the 40–60 % partial-load band `researches/02` says exposes instability, and the region §3.1 lives in | **GPL-2.0** | ❌ **Cannot be vendored into an MIT project.** Read the METHOD (the intensity sweep), write our own kernel |
| **BabelStream** (UoB-HPC) | Sustained memory bandwidth, the STREAM kernels — the natural throughput meter for the memory side | **Custom license**, © Tom Deakin, Simon McIntosh-Smith, University of Bristol: use/redistribute/modify are granted, but **published results must follow the "BabelStream Run Rules" or be clearly labelled as a variant** | ⚠️ **Usable, but it drags a publication obligation into a public repo.** Recommendation: take the STREAM *method* (copy/mul/add/triad), not the code |
| NVIDIA `cuda-samples` (`bandwidthTest`) | Reference bandwidth measurement | — not probed yet — | ⚠️ verify before use |

**The recommendation, and it is a small one on purpose:** KAGO already builds its own CUDA workloads
with deterministic checksums (phase 1, `workloads/*.cu`, `MANIFEST.json`). The gap is not "a stress
kernel" — we have one. The gap is **a throughput number and a low-load shape.** Both are small
additions to the kernels we already own, and owning them keeps the manifest, the determinism proof and
the golden-reference machinery in one place. Vendoring gpu-burn would give us a second, differently
built oracle whose determinism we would have to prove from scratch.

So: **write our own, read their methods, and vendor only `memtest_vulkan`** — because §3.3 is the one
thing we cannot cheaply build ourselves, and zlib costs us nothing.

## 5. How the throughput meter must be built — the method, from benchmarking practice

- **Time on the GPU, not on the host.** CUDA events (`cudaEventRecord` / `cudaEventElapsedTime`)
  measure GPU-side and exclude host overhead; they give stable, low-variance numbers across kernel
  sizes.
- **Warm up, then time many iterations.** The common shape is ~10 warmup iterations followed by
  tens of timed ones, reporting the arithmetic mean. This is what makes a *difference* meaningful.
- **Below ~10 µs nothing is measurable** — the timing method's own overhead dominates. Our kernels
  currently run 0–25 ms per launch, which is above that floor, but the sustained shape of `plans/03`
  §4.3 must keep each timed unit comfortably large.
- **Variance is not automatically small.** Reported figures range from *"below 1 % across
  implementations"* in well-built benchmarks to *"~10–30 %"* even after warmups in badly-conditioned
  ones. **This is the empirical backing for the owner's own requirement:** the meter's run-to-run
  spread must be measured before any delta is believed, and a delta thinner than the spread is not an
  effect.
- **Defeat the caches** between timed calls, or a benchmark measures the L2 rather than the card.
- **Record the clock alongside the throughput** — §3.2's detection needs both series, not one.

## 6. What the test set must contain (and why each row is there)

| Shape | What it catches | Status |
|---|---|---|
| Sustained heavy compute, checksum-verified | classic instability + SDC | ✅ have (`sdc_fma`) |
| Divergent control flow | the crash shape | ✅ have (`branchy`) |
| Transient 5 s / 5 s | voltage noise, di/dt droop — the dominant Vmin factor | ✅ have |
| **Sustained load that saturates** | makes a power delta measurable at all | ❌ `plans/03` §4.3 |
| **Throughput measurement with the clock recorded** | **clock stretching (§3.2), memory replay (§3.3), and the price for N** | ❌ this document |
| **Low-load dwell + idle→burst edge** | **low-load instability (§3.1) — the failure heavy tests never reach** | ❌ new, from this recon |
| **Partial-load intensity sweep (40–60 %)** | the band OCCT's analysis and mixbench's model both point at | ❌ new, from this recon |
| VRAM pattern test (`memtest_vulkan`) | memory errors that ECC/CRC would otherwise hide | ❌ new, from this recon |

## 7. Consequences to carry out of this document

1. **`PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R4 is incomplete as written** and must gain the
   throughput axis: crash + checksum is not a sufficient pair when the hardware's own protection
   converts errors into slowness.
2. **`plans/03` §4.3 grows a second deliverable:** the sustained workload must REPORT throughput, not
   only saturate. Without it P2-AC7 has no price column, and §3.2/§3.3 stay invisible.
3. **A read-back proves what was COMMANDED, never what was DELIVERED.** That sentence belongs next to
   `readBack()` in `profile-manager.mjs`, because the module's whole promise sounds stronger than it is.
4. **The low-load region is a first-class test case**, not a corner. Phase 5's descent must qualify a
   point at low load as well as under it.

## 8. What is NOT known, and must be measured on THIS card

Per `PHILOSOPHY.md` (observation over conjecture) these are written as unanswered rather than guessed:

1. **Does this RTX 5070 Ti stretch clocks at all?** Sources say some NVIDIA parts do and some crash
   instead. **Meter:** lock the core to a ladder point, measure throughput and `clocks.gr` together at
   stock power and at a reduced power limit; a throughput drop with an unchanged clock is stretching.
2. **What is the throughput meter's own run-to-run spread on this machine?** Everything else depends on
   it. **Meter:** two identical stock runs, compared (`plans/03` §4.4).
3. **Does the desktop background (dwm.exe, ~6 W, EXP-0015) move the throughput number**, and by how
   much relative to that spread?
4. **Is `memtest_vulkan`'s output parseable stably enough** to be a machine oracle, or is it an
   operator tool only?

---

## Sources

- [Blur Busters Forums — clock stretching on NVIDIA GPUs, and how to detect it with a benchmark while recording the core clock](https://forums.blurbusters.com/viewtopic.php?t=13502)
- [TechPowerUp — RTX 3080 review, GPU Boost 5.0 & Overclocking: GDDR6X Error Detection and Replay (EDR), CRC, retried transfers, performance plateau as the stability signal](https://www.techpowerup.com/review/nvidia-geforce-rtx-3080-founders-edition/39.html)
- [itigic — GDDR6X: retried transactions consume bandwidth, so performance stops gaining at the limit](https://itigic.com/gddr6x-memory-why-it-achieves-more-speed-and-overclock/)
- [Real World Technologies forum — JEDEC GDDR7 standard: internal ECC, 16 parity bits per 256 data bits, sample split 9 ECC + 7 CRC](https://realworldtech.com/forum/?curpostid=216765&threadid=216743)
- [PatSnap Eureka — GDDR7 error resilience: FEC, BER targets, correction without retransmission](https://eureka.patsnap.com/report-gddr7-error-resilience-fec-overheads-ber-targets-and-reliability)
- [VoltGround — GPU memory overclock stability testing: VRAM errors, and GDDR7 behaviour still being characterized](https://voltground.com/hardware/gpu-memory-overclock-stability-testing/)
- [Linus Tech Tips — an undervolt stable under load that crashes at idle (RTX 3080, 850 mV)](https://linustechtips.com/topic/1269756-can-a-gpu-undervolt-which-runs-stable-under-load-cause-the-computer-to-crash-when-the-gpu-is-idling/)
- [XDA — what the crashes after a first undervolt taught: selective, conditional stability](https://www.xda-developers.com/what-i-learned-from-the-crashes-after-unvolting-my-gpu-for-the-first-time/)
- [gpu-burn (wilicc) — multi-GPU CUDA stress test](https://github.com/wilicc/gpu-burn) · [its LICENSE: BSD-2-Clause, © Ville Timonen](https://raw.githubusercontent.com/wilicc/gpu-burn/master/LICENSE)
- [memtest_vulkan (GpuZelenograd) — open-source VRAM stability test, zlib license, "write once at start but reread every time"](https://github.com/GpuZelenograd/memtest_vulkan)
- [mixbench (ekondis) — mixed operational intensity kernels, roofline model](https://github.com/ekondis/mixbench) · [its LICENSE: GPL-2.0](https://raw.githubusercontent.com/ekondis/mixbench/master/LICENSE)
- [BabelStream (UoB-HPC)](https://github.com/UoB-HPC/BabelStream) · [its LICENSE: custom, with run-rules/labelling obligation on published results](https://github.com/UoB-HPC/BabelStream/blob/main/LICENSE)
- [standardkernel.com — "This kernel was faster yesterday": high-fidelity GPU kernel benchmarking, variance and cache clearing](https://standardkernel.com/blog/in-pursuit-of-high-fidelity-gpu-kernel-benchmarking/)
- [jan.ai — how we try to benchmark GPU kernels accurately: warmups, timed iterations, CUDA events](https://www.jan.ai/post/how-we-benchmark-kernels)
- [PyTorch forums — stable CUDA event timings, observed variance after warmups](https://discuss.pytorch.org/t/how-to-get-stable-torch-cuda-event-timings-for-reliable-benchmarking/223766)
- [NVIDIA Research — Estimating Silent Data Corruption Rates Using a Two-Level Model](https://research.nvidia.com/publication/2020-04_estimating-silent-data-corruption-rates-using-two-level-model)
