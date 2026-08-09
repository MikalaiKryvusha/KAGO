# Research 01 — How an RTX 5070 Ti can be undervolted from a CLI, and what the hardware actually allows

> **Created:** 2026-08-09 (agent, on the owner's question in `GOAL.md`)
> **Parent:** `GOAL.md` — *"Не уверен, можно ли решать эту задачу через CLI без MSI Afterburner.
> Не хочется GUI приложение стороннее иметь в зависимостях для KAGO."*
> **Status:** ✅ answered — owner picked the ladder (`nvidia-smi` → own NVAPI bridge) on
> 2026-08-09 21:28 +03:00. Feeds `MASTER_PLAN.md` phases 1–3.
> **Outbound:** the ladder decision → `MASTER_PLAN.md` decision log; the power-limit floor finding →
> a correction to the acceptance criteria inherited from the owner's PDF.

---

## 1. Why this document exists

The owner's master plan (`RTX_5070Ti_Undervolting_Master_Plan.pdf`, v2.0) names
**MSI Afterburner CLI** as the profile applier inside `profile-manager.mjs`. The owner then wrote
the opposite constraint into `GOAL.md`: no third-party GUI application in KAGO's dependencies.
Two source documents disagree, and the disagreement decides the whole architecture — so the
external truth was read from the live machine and from the tool ecosystem instead of recalled.

Everything below in §2 is the **output of a command on the owner's own machine**, not a
specification sheet.

## 2. The machine — probed, not assumed

Probe: `nvidia-smi --query-gpu=... --format=csv` and `nvidia-smi -q -d SUPPORTED_CLOCKS,PERFORMANCE,POWER`
(2026-08-09 21:24 +03:00).

| Fact | Value |
|---|---|
| GPU | NVIDIA GeForce RTX 5070 Ti (Blackwell, GB203) |
| PCI bus id | `00000000:01:00.0` |
| Driver / KMD | `610.88` · CUDA UMD 13.3 |
| VBIOS | `98.03.58.40.8b` |
| Power limit — current / default | 300.00 W / 300.00 W |
| **Power limit — min / max** | **250.00 W / 300.00 W** |
| Max graphics clock | 3090 MHz |
| Supported clock ladder | 3090 MHz downwards in ~7.5 MHz steps (enumerable) |
| Idle temperature at probe time | 53 °C |
| Perf state at probe time | P5 |

### 2.1. The finding that reshapes the plan

**The power-limit floor is 250 W of a 300 W board.** `nvidia-smi -pl` can therefore remove at most
**50 W (≈17 %)**.

The owner's PDF asks for **−60…−80 W** on *Max Optimal* and **−100…−120 W** on *Silent Cold*.
Neither target is reachable by power limiting alone. This is not a tuning detail — it is the
reason the project cannot be a thin `nvidia-smi` wrapper.

## 3. The three CLI paths, and what each one can actually deliver

### Path A — driver-native only (`nvidia-smi`)

| | |
|---|---|
| Dependencies | none — ships with the driver |
| Writes | `-lgc <min,max>` lock graphics clock · `-pl <W>` power ceiling · `-rgc` / `-pl <default>` reset |
| Persistence | volatile on Windows: cleared by reboot and by driver reload — which is exactly the "back to factory" behaviour `GOAL.md` wants |
| Rights | administrator |

**What it can do:** locking the core clock low forces the GPU down its *stock* V/F curve, so the
voltage the card selects falls with it. That is a genuine power and thermal win and it reaches the
**Silent Cold** territory.

**What it cannot do:** it cannot make the card run a *higher* frequency at a *given* voltage. That
is the definition of undervolting, and it is the whole content of the **Max Optimal ≥97 % of stock
score** target. Path A trades performance for cool; it cannot keep performance *and* cut voltage.

### Path B — an existing open-source curve tool

| Tool | State | Verdict |
|---|---|---|
| [`aufkrawall/green-curve`](https://github.com/aufkrawall/green-curve) | MIT · Blackwell listed as tested · Windows x64 · headless writes: `--apply-config`, `--reset --apply-config`, `--json-live`, `--probe` · elevated background service | The only current tool that both edits the 128-point curve and can be driven headlessly |
| [`Demion/nvapioc`](https://github.com/Demion/nvapioc) | v0.7 · pure CLI · `-curve <count> <µV> <kHz> …` writes curve points · admin · volatile | Right shape, but old; Blackwell support unverified |
| [`arcnmx/nvoclock`](https://github.com/arcnmx/nvoclock) | Rust CLI over NVAPI · VFP curve import/export | Documented against Pascal; no RTX 40/50 evidence |

`green-curve` would be the fastest route to a working *Max Optimal*, at the cost of one external
binary plus an elevated service in KAGO's dependency list.

### Path C — KAGO's own NVAPI bridge

The curve lives behind `nvapi64.dll`, reached through `nvapi_QueryInterface` and the
Pstates20 / clock-boost-table entry points — the same mechanism every tool in Path B uses, MSI
Afterburner included. From Node.js this is an FFI call (`koffi`), so it stays inside the
`.mjs` stack the master plan already mandates.

- **For:** zero third-party binaries — precisely what `GOAL.md` asks for. Three MIT-licensed
  reference implementations exist to read the call sequence from.
- **Against:** the interesting entry points are undocumented; NVIDIA's public NVAPI SDK exposes the
  `NV_GPU_PERF_PSTATES20_INFO` structures but not a supported curve-write contract. This is the
  most expensive path and the one that needs the most defensive verification.

## 4. Decision

**The ladder — Path A first, Path C after** (owner, 2026-08-09 21:28 +03:00, chat).

1. **Phase 1 on Path A.** Zero dependencies, low risk, ships a working *Silent Cold* and the whole
   orchestration skeleton — sweep engine, monitoring, event log watch, rollback, shortcuts, tray.
   Every part of the system except the curve writer gets built and proven here.
2. **Phase 2 on Path C.** Swap only the profile applier behind an interface that Phase 1 already
   defined. *Max Optimal* becomes reachable at that point, and not before.

Path B is not adopted, but it stays on the table as the fallback if the NVAPI bridge proves
unstable on Blackwell — and `green-curve`'s MIT source is read as reference either way.

The architectural consequence is one line, and it is worth stating plainly: **`profile-manager.mjs`
must be an interface with swappable backends** (`nvidia-smi` today, `nvapi` tomorrow), never a
direct caller of a specific tool. The owner's PDF hard-wires MSI Afterburner into that module; this
document supersedes that choice.

## 5. Risks carried forward

- **Driver updates change voltage behaviour without warning.** In March 2026 driver `595.71`
  silently capped RTX 40/50 voltages near 1.005 V and cost users ~200 MHz of headroom; it was
  widely reported and later addressed. The machine here runs `610.88`, long past it — but the
  *class* is live. **Every stored profile therefore records the driver and VBIOS version it was
  validated against, and KAGO re-validates when either changes.**
- **Blackwell curve writes are unproven for us.** Path C ships only behind a read-back check: write
  the curve, read it back, and refuse the profile if the two disagree.
- ~~**`nvidia-smi -pl` was not exercised.**~~ **RESOLVED 2026-08-09 22:4x +03:00** — confirmed by
  observation, on the owner's explicit consent, from an elevated shell:

  ```
  before:   300.00 W (default 300.00 W)
  nvidia-smi -i 0 -pl 290
            Power limit for GPU 00000000:01:00.0 was set to 290.00 W from 300.00 W. All done.
  readback: 290.00 W
  nvidia-smi -i 0 -pl 300      ← restored
  readback: 300.00 W (default 300.00 W)
  ```

  **`-pl` writes on this GeForce card under Windows.** The path A backend is real, not assumed.

  **Quirk worth knowing before it costs a debugging hour:** the restore printed *"was set to
  300.00 W **from 300.00 W**"* while the limit was actually 290 W — `nvidia-smi` reports the
  *default* in the "from" field, not the previous value. **Never parse that message to learn the
  prior state; read it back.** `profile-manager.mjs` must verify by query, never by the tool's own
  success text.
- **A killed tray process cannot run an exit handler.** `GOAL.md` requires the GPU to return to
  factory state when the tray icon is killed. `SIGKILL`/Task-Manager termination runs nothing, so
  the reset cannot live in an exit hook — it needs a heartbeat the applier watches, or a watchdog
  that owns the reset. Named here so Phase 1 designs for it instead of discovering it.

## 6. Sources

- Live probes on the owner's machine (`nvidia-smi`, 2026-08-09) — the numbers in §2.
- [NVIDIA/nvapi](https://github.com/NVIDIA/nvapi) · [NVAPI reference](https://docs.nvidia.com/nvapi/modules.html) — `NV_GPU_PERF_PSTATES20_INFO`, the public half of the surface.
- [aufkrawall/green-curve](https://github.com/aufkrawall/green-curve) · [Demion/nvapioc](https://github.com/Demion/nvapioc) · [arcnmx/nvoclock](https://github.com/arcnmx/nvoclock) — the curve-writing tool ecosystem.
- [Tom's Hardware on driver 595.71](https://www.tomshardware.com/pc-components/gpus/nvidia-driver-595-71-reportedly-limits-overclocks-on-some-geforce-gpus-but-not-all-troubled-driver-release-seems-to-stifle-voltages-on-rtx-40-and-50-series-cards) · [Igor's Lab](https://www.igorslab.de/en/nvidias-new-drivers-are-suspected-of-limiting-voltages-in-rtx-50-graphics-cards/) — the voltage-cap incident behind the risk in §5.
- [MSI's own 50-series undervolting guide](https://www.msi.com/blog/rtx-5070-5060ti-overclocking-undervolting-guide-with-msi-afterburner-part-2) — the curve-editor method KAGO reproduces without the GUI.
