# Research 03 — The headless verification toolchain: what loads the card, what watches it, and who says PASS

> **Created:** 2026-08-09 (agent, opening rung 1 of `/plan-epic` on the owner's instruction
> *«следующий чат начнём с эпик планирования и нарезания эпика на фазы и операционные планы»*)
> **Parent:** `MASTER_PLAN.md` phases 1 / 5 / 6 — every one of them assumes a harness that does not
> exist yet.
> **Status:** ✅ answered by probe and sweep, 2026-08-09 22:30 +03:00 · feeds
> `plans/01_EPIC_kago_orchestrator.md` and the phase-1 operational plan.
> **Outbound:** three owner forks → `interviews/interview_001_harness_boundaries.md` ·
> HWiNFO64 removal → `PROJECT_STRUCTURE_EXTERNAL_MAP.md` + `AGENT_GUIDE.md` architecture block ·
> four probed facts → the `AGENT_GUIDE.md` environment dossier.

---

## 1. The gap this fills

`researches/01` answered **how KAGO writes** to the card (the `nvidia-smi` → own-NVAPI ladder).
`researches/02` answered **what voltage to aim for** (Vmin, the guardband, the three-way verdict).
Neither answers the question every remaining phase actually trips over:

> With **what** do we load the card, with **what** do we watch it, and **who** pronounces
> PASS / SDC / CRASH — on this machine, with zero third-party GUI in the dependency list?

`MASTER_PLAN.md` phase 1 says "run stock benchmarks and store golden references"; phase 5 says
"a diverse workload set"; phase 6 says "20× SpeedWay". Those are outcomes, not tools. This document
finds the tools — by running them, not by recalling that they exist.

## 2. Local recon — probed on this machine, not assumed

All probes 2026-08-09, between 22:15 and 22:30 +03:00.

| Fact | Value observed | Probe |
|---|---|---|
| CUDA Toolkit | **13.3 installed, `nvcc` on PATH** at `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.3\bin` | `nvcc --version` |
| Host compiler | MSVC present, **not on PATH**; `nvcc` fails with `Cannot find compiler 'cl.exe' in PATH` until the VS developer environment is loaded | `nvcc -o x x.cu` · `vswhere -all` |
| VS installs | Community 2022 (17.14) · Build Tools 2022 (17.10) · Build Tools 2019 · Build Tools 2017 | `vswhere.exe -all -products *` |
| **Own CUDA workload builds and runs** | ✅ `probe.cu` compiled through `vcvars64.bat` + `nvcc -O2`, ran, returned a result | see §2.1 |
| **Its output is bit-deterministic** | ✅ FNV-1a over 1024 floats: `fd7d452ce569c9d7` on **three consecutive runs** | see §2.1 |
| GPU voltage via `nvidia-smi` | **absent — there is no voltage field at all** (`voltage.gpu` → *not a valid field to query*) | `nvidia-smi --help-query-gpu` |
| Memory-junction temperature | **`N/A`** on this card | `nvidia-smi --query-gpu=temperature.memory` |
| Thermal margin | `temperature.gpu.tlimit` = 33 (°C to the limit) alongside `temperature.gpu` = 55 | `nvidia-smi --query-gpu=temperature.gpu.tlimit` |
| Throttle reasons | **available and enumerable** — `clocks_event_reasons.{active,sw_power_cap,hw_thermal_slowdown,hw_power_brake_slowdown,sw_thermal_slowdown,…}` | `nvidia-smi --query-gpu=clocks_event_reasons.active` |
| Event Log read rights | **`Get-WinEvent` on the System log works unelevated** | `Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Display'}` |
| Provider `Display` | live, readable; retained history holds id **4107** (informational), **no 4101 TDR** in the window | as above |
| Provider `Microsoft-Windows-Kernel-Power` id 41 | **three historical events** — 29.07, 05.08, 06.08.2026 | `…ProviderName='Microsoft-Windows-Kernel-Power'; Id=41` |
| Provider `Microsoft-Windows-WHEA-Logger` | **zero events** in retained history | as above |
| Provider `…WER-SystemErrorReporting` (bugcheck) | zero events | as above |

### 2.1. The proof that decides the whole harness

A 20-line CUDA kernel (an FMA chain over 1024 threads, output hashed with FNV-1a) was compiled and
run three times:

```
OK checksum=fd7d452ce569c9d7 sample=1.023841858
OK checksum=fd7d452ce569c9d7 sample=1.023841858
OK checksum=fd7d452ce569c9d7 sample=1.023841858
```

Two properties matter, and both are now observed rather than hoped for:

1. **KAGO can build and run its own GPU workload on this machine** — no third-party binary, no
   licence, nothing in the dependency list that `GOAL.md` forbids.
2. **The output is bit-identical across runs**, which is precisely what the golden-reference method
   of `researches/02` §3 Step 0 requires. A run that returns a different checksum on the same input
   has produced silent data corruption, and the harness can say so *without a human looking at
   anything*.

> ⚠️ **An accident that turned into a stronger result.** Midway through this recon the agent ran
> `winget upgrade --id Microsoft.VisualStudio.2022.Community` believing it to be a read-only check;
> it started a real Visual Studio upgrade, and the agent then interrupted it, leaving MSVC
> half-installed. Visual Studio was repaired the same evening (finished 2026-08-09 22:50 +03:00,
> toolset 14.44 with both host architectures restored). Lesson filed as `EXPERIENCE.md` → EXP-0005.
>
> **What the detour bought:** the same kernel was built and run on **three different toolchain
> configurations** — MSVC 14.40 native x64, MSVC 14.44 via the x86-hosted cross compiler, and
> MSVC 14.44 native x64 (`cl` 19.44.35228) after the repair. **All three returned
> `fd7d452ce569c9d7`.** The golden reference therefore survives a compiler change, which is a
> property the method needs and which nobody had checked. `[TESTED: 2026-08-09 · three toolchains,
> three runs each, identical checksum]`.

## 3. Industry sweep — what the field uses, and where it walls off

### 3.1. Every mature benchmark puts automation behind a paid tier

| Tool | Headless / CLI | Cost of automation | Verdict for KAGO |
|---|---|---|---|
| UNIGINE Superposition / Heaven | Command-line automation + CSV reports exist | **Professional edition only** | rejected — paid, and a GUI app |
| 3DMark (TimeSpy, SpeedWay) | CLI automation exists | **Professional edition only** | the PDF's acceptance matrix rests on it — see the fork in §6 |
| OCCT | Fully automatable via command-line switches | **Enterprise licence only**; free tier is personal-use GUI | rejected as an engine dependency |
| FurMark 2 | CLI parameters documented (`-demo`, `-furmark-vram-test-gb`, presets) | free for personal use | **NOT ADOPTED — owner's decision, interview 001 Q2 = A, 2026-08-09.** Not a dependency and not a bench tool either: the owner read his own constraint literally. It was also the wrong load shape — flat 100 %, while `researches/02` §2 found transients are what expose instability |

**The pattern is consistent enough to be a finding, not an accident:** the exact capability KAGO
needs — *drive a GPU load from a script and read a machine-parseable result* — is the feature these
vendors sell. Building on them means either paying per tool or shipping a GUI application inside a
project whose first constraint forbids one.

### 3.2. The consequence: KAGO writes its own loads

Combined with §2.1, this stops being a compromise and becomes the simpler design. `researches/02`
§3 Step 4 already names the three shapes the set must span, and each maps onto something a few
hundred lines of CUDA can produce:

| Shape (from `researches/02`) | Why it is needed | How KAGO produces it |
|---|---|---|
| **SDC-prone** — fixed-loop, arithmetic-dense, exactly checkable | more than half of undervolt failures corrupt silently | FMA/matmul/FFT kernel + checksum — **proven in §2.1** |
| **Crash-prone** — control-heavy, branchy, irregular memory | this is what actually TDRs | divergent-branch and pointer-chase kernels |
| **Transient** — load stepping between idle and full | voltage noise (IR drop, di/dt) dominates Vmin | a scheduler around the two above: 5 s on / 5 s off, plus continuous 40–60 % intensity bands |

The third shape is the one no off-the-shelf tool gives away for free, and it is the one the
research says matters most. Writing it ourselves is the only way to get it.

### 3.3. SDC detection — the state of the art agrees with the checksum

Recent production-scale work converges on the same mechanism KAGO just proved: **bitwise
deterministic replay plus checksums**. `SDCHUNTER` (OSDI 2026) localizes defective GPUs by
deterministic replay of the triggering workload; fleet-scale mitigation work fuses hash computation
into communication kernels to sign data in flight. The documented **anti-pattern** is equally
useful: screening only for `NaN`/`INF` catches roughly **1 %** of corruptions — detection must
compare full outputs, which is exactly what a golden-reference checksum does and what an
"it looked fine" verdict does not.

### 3.4. The crash half — Windows names its own faults

`event-logger.mjs` has four providers to watch, and three of them have **live historical events on
this machine to prove the reader against** (the mutation-proof obligation of
`PROJECT_ARCHITECTURE_INTERNAL_MAP.md` §3):

| Signal | Provider · id | Provable here today? |
|---|---|---|
| Display driver reset (TDR) | `Display` · **4101** | provider live (4107 present); **no 4101 in history** — reader provable, detector not |
| Corrected / uncorrected hardware error | `Microsoft-Windows-WHEA-Logger` · 17, 18, 19, 47 | **no events at all** — see the gap below |
| Unexpected shutdown / power loss | `Microsoft-Windows-Kernel-Power` · **41** | ✅ three real events (29.07, 05.08, 06.08.2026) |
| Bugcheck (BSOD) | `Microsoft-Windows-WER-SystemErrorReporting` · 1001 | no events |

**The gap, named rather than papered over:** a detector that has never gone red proves nothing
(`BUG_FIXING_FRAMEWORK.md` → Guards). Kernel-Power 41 gives a genuine red for the shutdown path.
TDR and WHEA have no local history, so their detectors get proved against **captured event XML
fixtures** — the query mechanism proven live on a provider that does have events, the parser proven
on a fixture. That split must be stated in the code's test-status markers, not blurred.

### 3.5. HWiNFO64 comes out of the architecture

The owner's PDF, and this project's own external map, list **HWiNFO64 CSV** as a telemetry source
in `hardware-mon.mjs`. Three facts retire it:

1. **It is a third-party GUI application** — the one thing `GOAL.md` forbids in the dependency list.
2. **The sensor it was there for is gone anyway.** On RTX 50-series, NVIDIA disabled the hotspot /
   memory-junction sensor at driver level; the reading vanished from the public NVAPI *and* from
   the private partner interfaces, which is why even MSI Afterburner cannot show it. Community
   access exists only through direct GPU register reads (a `Hotspot.dll` plugin) or NVIDIA's
   internal MODS tool.
3. **This card confirms it:** `temperature.memory` returns `N/A` (§2).

So the telemetry source for phase 1 is `nvidia-smi` alone, and it is richer than expected —
`temperature.gpu.tlimit` gives thermal margin, and `clocks_event_reasons.*` says *why* the card is
being held back, which is a better signal for a cooling-oriented project than a junction
temperature would have been.

### 3.6. Elevation — solved by a standard Windows pattern, no dependency

`nvidia-smi` writes need administrator. A desktop shortcut that raises UAC on every double-click
would make the owner-facing surface unusable. The established Windows pattern: register a
**Scheduled Task with "Run with highest privileges"**, and let the shortcut call
`schtasks.exe /run /tn "<task>"`. The Task Scheduler service is already elevated, so it launches
the action in the configured elevated context **with no UAC prompt** — the elevation decision is
made once, at task creation. This is phase 3's material; it is recorded here because it removes the
last "can this even be built?" doubt from the shortcut design, and because it uses only what
Windows ships.

## 4. Findings

1. **KAGO can build and run its own deterministic GPU workload on this machine** — proven, with a
   stable checksum across three runs (§2.1). The SDC oracle of `researches/02` is buildable in-house.
2. **Automation is the paywall of every mature benchmark** (§3.1) — so writing our own loads is the
   cheap path, not the expensive one, and it is the only path to the transient shape that matters
   most.
3. **`nvidia-smi` cannot read voltage at all** (§2). The Vmin search of phase 5 therefore cannot
   observe its own control variable until the NVAPI bridge exists. **Phase 5 depends on phase 4 —
   this is now evidence, not intuition**, and it confirms the ordering `MASTER_PLAN.md` already has.
4. **`nvidia-smi` telemetry is richer than the plan assumed** in the directions that matter:
   thermal margin (`tlimit`) and throttle reasons (`clocks_event_reasons.*`).
5. **HWiNFO64 leaves the architecture** (§3.5) — forbidden by `GOAL.md`, and the sensor it existed
   for is disabled on RTX 50 hardware anyway.
6. **The Event Log is readable unelevated**, and one of the four fault signals (Kernel-Power 41) has
   real local history to prove a detector against; TDR and WHEA need fixtures (§3.4).
7. **Elevation without UAC prompts is a solved, dependency-free Windows pattern** (§3.6).
8. **The build of KAGO's own workload needs `nvcc` + the MSVC developer environment**, which
   `nvcc` does not find on its own — the toolchain must be located programmatically (`vswhere` →
   `vcvars64.bat`), never assumed to be on the operator's PATH.

## 5. What this changes for the epic

- **Phase 1 gains a real first deliverable:** the workload runner and its golden-reference store,
  not just a telemetry wrapper. The harness can be built and proven *before* a single GPU write.
- **Phase 1 loses the HWiNFO64 integration** — dropped, with the reason recorded.
- **Phase 5 is formally gated on phase 4** (finding 3), so no operational plan for 5 is written
  until the bridge reads voltage.
- **Every detector in `event-logger.mjs` carries its own proof status** — red-provable (Kernel-Power)
  vs. fixture-provable (TDR, WHEA). This goes into the code as `[NOT-TESTED]` / `[TESTED: …]`
  markers per `TESTING_FRAMEWORK.md`, distinguishing the two.
- **A build-time toolchain locator** is a named phase-1 step, not an assumption.

## 6. Forks for the owner — CLOSED

All three were answered on **2026-08-09 23:23 +03:00** through the review contour
(`interviews/interview_001_harness_boundaries.md`, record in `interviews/decisions/`):

| Fork | Answer | Consequence for this document |
|---|---|---|
| Acceptance benchmark (3DMark automation is Professional-only) | **A** | the automated gate uses KAGO's own numbers; the percentage-of-stock figure is one manual 3DMark run by the owner at the close of phase 6 |
| FurMark on the bench | **A** | not adopted at all — §3.1 updated |
| Does the compiled binary ship | **B** | **it ships**, against the agent's recommendation. §3.2's conclusion is unaffected — we still write our own loads and still build them from source; what changes is that a machine without the CUDA Toolkit can now run them |

The `.gitignore` line that excluded `workloads/*.exe` was REMOVED rather than commented out: a
cancelled rule left alive keeps steering the tree (`/owner-reviews` I19).

## 7. Sources

**Probes on the owner's machine, 2026-08-09** — everything in §2, and the compile/run proof in §2.1.

- [UNIGINE Benchmarks](https://benchmark.unigine.com/) — command-line automation and CSV reports are Professional-edition features.
- [FurMark 2.10.2 release notes, Geeks3D](https://geeks3d.com/20251016/furmark-2-10-gpu-stress-test-and-graphics-benchmark/) · [FurMark homepage](https://www.geeks3d.com/furmark/) — CLI parameters, free for personal use.
- [OCCT Enterprise](https://www.ocbase.com/occt/enterprise) — "fully automatable… command-line switches" is the Enterprise tier.
- [OCCT — inside the modern adaptive approach to GPU stress testing](https://www.ocbase.com/news/occt-gpu-stress-testing-modern-adaptive-approach) — the 40–60 % intensity band that flat tests miss.
- [SDCHUNTER (OSDI 2026)](https://www.usenix.org/system/files/osdi26-zheng.pdf) — bitwise deterministic replay to localize SDC-defective GPUs.
- [The Anatomy of Silent Data Corruption: GPU Error Pattern Study](https://arxiv.org/html/2605.04213) — why NaN/INF screening catches ~1 % of corruptions.
- [Mitigating Silent Data Corruption in Scaled AI Inference Fleets](https://acefleet.dev/blog/silent-data-corruption) — checksums fused into kernels as the production mechanism.
- [Tom's Hardware — plugin unlocks RTX 50 VRAM temperature sensors](https://www.tomshardware.com/pc-components/gpus/new-plugin-unlocks-granular-vram-temperature-tracking-on-nvidia-rtx-50-series-gpus-community-cracks-open-blackwells-forbidden-telemetry-sensors) · [TechPowerUp — hotspot accessible only via NVIDIA's internal MODS tool](https://www.techpowerup.com/350705/nvidia-geforce-rtx-50-series-hotspot-sensor-can-be-accessed-with-nvidias-internal-tool) — the sensor is disabled at driver level on RTX 50.
- [NVIDIA Developer Forums — request: memory junction temperature via nvidia-smi / NVML](https://forums.developer.nvidia.com/t/request-gpu-memory-junction-temperature-via-nvidia-smi-or-nvml-api/168346) — it is not exposed.
- [Microsoft Q&A — WHEA-Logger event ID 17](https://learn.microsoft.com/en-us/answers/questions/5624386/whea-logger-event-id-17) — the WHEA id set (1, 17, 18, 19, 46, 47).
- [Smallvoid — run programs elevated without a UAC prompt via a scheduled task](https://smallvoid.com/article/winnt-uac-scheduled-task.html) · [Digital Citizen — Task Scheduler without UAC prompts](https://www.digitalcitizen.life/use-task-scheduler-launch-programs-without-uac-prompts/) — the `schtasks /run` pattern of §3.6.
