# Plan 02 — Epic 01 / Phase 1: the harness and the baseline

> **Created:** 2026-08-09 22:42 +03:00 (agent)
> **Parent:** `plans/01_EPIC_kago_orchestrator.md` — phase 1
> **Status:** 🔲 open · not started
> **Outbound:** the environment-dossier rows → `AGENT_GUIDE.md` · the new harness commands → the
> `AGENT_GUIDE.md` test-harness table · closure → `MASTER_PLAN.md` phase 1

---

## 1. Goal vector

**The pain.** KAGO has no way to see what the card is doing, no way to load it on demand, and no
idea what "stock" looks like in numbers. Every later phase judges profiles — and a judge with no
instruments returns opinions.

**Where we want to be at the close of this phase.** A harness that can, without a human in the room:
sample the card, load it in three different shapes, notice when Windows reports a fault, and say
**PASS / SDC / CRASH** about a run by comparing it to a golden reference captured at stock.

**Anchor in the epic** (`plans/01_EPIC_kago_orchestrator.md` §3): *"Phase 1 — Harness and baseline.
Nothing can be judged before it can be observed. … Zero GPU writes in this whole phase."*

## 2. Acceptance criteria for this phase

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **P1-AC1** | Each workload runner shall return a byte-identical result on repeated runs at stock. | Scale: distinct checksums over N runs · Meter: `npm run workload -- <name> --repeat 5` · **Target: exactly 1** |
| **P1-AC2** | The fault watcher shall report a real fault that actually happened on this machine. | Scale: events found · Meter: query `Microsoft-Windows-Kernel-Power` id 41 over the retained window · **Target: ≥ 1** (three exist: 29.07, 05.08, 06.08.2026) |
| **P1-AC3** | The fault watcher's TDR and WHEA parsers shall be proven on captured event XML, since this machine has no such history. | Scale: fixtures parsed to the right verdict · Meter: the fixture suite · **Target: 100 %** |
| **P1-AC4** | The telemetry sampler shall record every field `researches/03` §2 found available, and record nothing it found `N/A`. | Scale: fields present in the sample vs. the probed list · Meter: read one sample file · **Target: exact match** |
| **P1-AC5** | The golden reference shall carry the driver and VBIOS it was captured on. | Scale: baseline files missing the stamp · Meter: read `runs/baseline/*.json` · **Target: 0** |
| **P1-AC6** | The phase shall perform zero GPU writes. | Scale: write calls in the diff · Meter: `git diff` review + no `-pl`/`-lgc`/`-rgc` outside `[planned]` steps · **Target: 0** |
| **P1-AC7** | `npm run check` shall stay green. | Scale: exit code · Meter: `npm run check` · **Target: 0** |

## 3. Steps

Each step cites the epic line it executes. Verification is an **observation**, never an inference
from reading the diff (`TESTING_FRAMEWORK.md`).

### 3.1 — `automation-engine/config.mjs` — the safety constants, named

*Anchor: epic §4, phase-1 exit gate — "guardband ≥ 4 grid steps and ≥ 25 mV" originates here.*

- [ ] Every threshold from `researches/02` as a named constant with a comment naming its source:
      guardband (≥ 4 grid steps, ≥ 25 mV), the assumed 6.25 mV grid **marked as unconfirmed until
      phase 4 measures it**, temperature ceilings, express-test duration, the transient duty cycle
      (5 s on / 5 s off), the OCCT-documented 40–60 % intensity band.
- [ ] Power-limit floor and ceiling read from the card at startup, never hard-coded (250/300 W here,
      but the module must not assume this card).
- **Verify:** `node -e "import('./automation-engine/config.mjs').then(m=>console.log(m.default))"`
  prints every constant; each one is greppable back to a line in `researches/02`.

### 3.2 — `automation-engine/lib/toolchain.mjs` — find the compiler, never assume it

*Anchor: epic §6(b) — "the toolchain … already seen in the field tonight; phase 1 locates it via
`vswhere` rather than assuming a PATH."*

- [ ] Locate `nvcc` and the MSVC developer environment: `vswhere -latest -requires
      Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`, then the
      `vcvars` batch under `VC\Auxiliary\Build\`.
- [ ] Prefer the native x64 host; **fall back to the x86-hosted cross compiler** — that fallback is
      already proven to build and produce the same checksum (`researches/03` §2.1 and the repair
      episode of 2026-08-09).
- [ ] Absent toolchain is a clean, named failure — never a crash, and never a silent skip.
- **Verify:** run it on this machine and print the resolved paths; then run it with `PATH` stripped
  of the CUDA bin directory and watch it fail with the named error rather than a stack trace.

### 3.3 — `workloads/` — KAGO's own loads, in the three shapes the research demands

*Anchor: epic §3 phase 1; shapes from `researches/02` §3 Step 4.*

- [ ] `workloads/sdc_fma.cu` — fixed-loop, arithmetic-dense, output hashed. **The seed already
      exists and is proven**: FNV-1a over 1024 floats, `fd7d452ce569c9d7`, identical across three
      runs and across two MSVC toolsets.
- [ ] `workloads/branchy.cu` — control-heavy, divergent branches, irregular memory: the crash-prone
      shape.
- [ ] `workloads/README.md` — what each load is FOR, in terms of the failure class it exposes.
- [ ] The transient shape is **not** a third kernel: it is a scheduler in `stress-tester.mjs` that
      steps the loads between idle and full (config's duty cycle).
- **Verify:** build each through `toolchain.mjs`, run 5×, compare checksums (P1-AC1).

### 3.4 — `automation-engine/lib/hardware-mon.mjs` — the sampler

*Anchor: epic §2 AC4 — the meter for Silent Cold's power reduction.*

- [ ] Sample exactly the fields probed available in `researches/03` §2: `pstate`,
      `temperature.gpu`, `temperature.gpu.tlimit`, `fan.speed`, `power.draw.instant`, `power.limit`,
      `clocks.gr`, `clocks.sm`, `clocks.mem`, `utilization.gpu`, `utilization.memory`,
      `clocks_event_reasons.active`. **Do not sample `temperature.memory` — it returns `N/A` here.**
- [ ] Write JSONL with a monotonic sample index; sorted keys, no `Date.now()` inside compared
      output (`AGENT_GUIDE.md` → canonical order).
- [ ] Throttle reasons decoded to names, not left as a hex mask.
- **Verify:** sample for 30 s at idle, read the file, confirm every field is present and populated;
  confirm two runs differ only in the timestamp column.

### 3.5 — `automation-engine/lib/event-logger.mjs` — the crash half of the oracle

*Anchor: epic §4, phase-1 exit gate — "the fault watcher goes red against a real historical event".*

- [ ] Query four providers over a time window: `Display` (id 4101), `Microsoft-Windows-WHEA-Logger`
      (17, 18, 19, 47), `Microsoft-Windows-Kernel-Power` (41),
      `Microsoft-Windows-WER-SystemErrorReporting` (1001).
- [ ] `Get-WinEvent` works **unelevated** here (probed) — do not demand admin for reading.
- [ ] Each detector carries its own honest proof status in its comment: Kernel-Power 41 is
      **red-provable on this machine**; TDR and WHEA are **fixture-provable only** (no local
      history) — `[TESTED: … via fixture]` says so explicitly rather than blurring the two.
- [ ] Fixtures live in `automation-engine/lib/__fixtures__/` as captured event XML.
- **Verify:** run it over a window covering 06.08.2026 and watch it return the real Kernel-Power 41
  event (P1-AC2); run the fixture suite (P1-AC3).

### 3.6 — `automation-engine/lib/stress-tester.mjs` — the verdict

*Anchor: epic §2 AC3 — "no crash and no silent corruption".*

- [ ] Run a workload, capture its checksum, compare against the golden reference; ask
      `event-logger.mjs` for faults in the same window; return **PASS / SDC / CRASH**.
- [ ] The transient scheduler lives here (step 3.3).
- [ ] **SDC is the dangerous verdict and must be loud** — a mismatch is never rounded to "probably
      fine".
- **Verify:** feed it a deliberately corrupted golden file and watch it return SDC — the guard must
  go red before its green is trusted (`BUG_FIXING_FRAMEWORK.md` → Guards).

### 3.7 — Capture the baseline

*Anchor: epic §2 AC7 — the driver/VBIOS stamp.*

- [ ] Run every workload at stock, store outputs in `runs/baseline/` with driver `610.88`, VBIOS
      `98.03.58.40.8b`, timestamp and the full `gpu:info` dump alongside.
- [ ] `runs/` is already git-ignored — confirm before the first write (ignore-first rule).
- **Verify:** read one baseline file and confirm the stamp (P1-AC5).

### 3.8 — Extend `tools/gpu-info.mjs` with the supported-clock ladder

*Anchor: `STATUS.md` autonomous backlog — "that ladder is phase 5's search space".*

- [ ] `nvidia-smi -q -d SUPPORTED_CLOCKS` parsed into sorted JSON.
- **Verify:** `npm run gpu:info -- --json` shows the ladder; spot-check its top entry against the
  3090 MHz already recorded in `researches/01` §2.

### 3.9 — Housekeeping the phase owes

- [ ] Fill the four `— not probed yet —` rows in the `AGENT_GUIDE.md` environment dossier, plus the
      new rows this session earned: CUDA Toolkit, MSVC location and the vcvars requirement, Event
      Log read rights.
- [ ] Add the new harness commands to the `AGENT_GUIDE.md` test-harness table as they land.
- [ ] Add the truth↔mirror pair: `researches/03` §2 field list ↔ `hardware-mon.mjs` sampled fields.

## 4. Risks for this phase

- **A workload that is not actually deterministic** (fast-math reordering, atomics, timing-dependent
  reductions) would poison every later verdict. → P1-AC1 is exactly this check, and it runs 5×, not
  twice.
- **A detector that never goes red.** → the split proof status of step 3.5, written into the marker
  rather than assumed.
- **The half-repaired Visual Studio install** (2026-08-09 incident). → step 3.2's fallback path is
  already proven to work on the cross compiler; the repair is tracked separately and does not block
  this phase.

## 5. Decisions made without the owner

*Filled at phase close.*
