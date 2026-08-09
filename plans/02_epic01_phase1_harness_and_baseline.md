# Plan 02 — Epic 01 / Phase 1: the harness and the baseline

> **Created:** 2026-08-09 22:42 +03:00 (agent)
> **Parent:** `plans/01_EPIC_kago_orchestrator.md` — phase 1
> **Status:** 🟡 in progress · 3.1–3.7 closed (3.7 on 2026-08-10 00:53 +03:00) · next: 3.8 the supported-clock ladder
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
      **Changed by the owner, interview 001 Q3 = B (2026-08-09):** an absent toolchain no longer
      costs the sweep, because the built binaries ship in the repository. The locator's job is now
      to REBUILD when a source changes or when a binary's checksum does not match its manifest —
      not to be the only way a workload can exist.
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
- [ ] **The built `.exe` ships** (owner, interview 001 Q3 = B). Because a committed binary is the
      one artefact nobody can review by eye, it travels with `workloads/MANIFEST.json`: for each
      binary its sha-256, the source it was built from, the toolchain that built it, and the
      checksum its own run produces on this card. Anyone — including a future session — rebuilds
      and compares instead of trusting the bytes.
- **Verify:** build each through `toolchain.mjs`, run 5×, compare checksums (P1-AC1); then verify
  the manifest by recomputing every sha-256 in it.

### 3.4 — `automation-engine/lib/hardware-mon.mjs` — the sampler ✅ CLOSED 2026-08-10

*Anchor: epic §2 AC4 — the meter for Silent Cold's power reduction.*

- [x] Sample exactly the fields probed available in `researches/03` §2 — **and from ONE source:** the
      module reads `config.TELEMETRY_FIELDS` rather than carrying its own copy, so the pair step 3.9
      asked for became a single truth instead of two lists to keep in step. It REFUSES to run if
      config's list ever contains a field named in `TELEMETRY_FIELDS_UNAVAILABLE_HERE`
      (`temperature.memory`, `N/A` on this card).
- [x] JSONL with a monotonic sample index; sorted keys; no `Date.now()` anywhere in the output. The
      header record carries gpu / driver / vbios / fields / period — every one of them stable, so two
      runs produce a byte-identical header.
- [x] Throttle reasons decoded to names in `config.THERMAL_THROTTLE_REASONS`' own notation, with the
      raw mask kept beside them; an unrecognised bit is surfaced as `unknown_bit_0x…`, never dropped.
- [x] **Verified 2026-08-10 00:27 +03:00 by observation** — `npm run mon -- --seconds 30 --out
      runs/idle_a.jsonl`, twice:
      · 60 records each, index monotonic `0..59`;
      · **zero nulls across 120 records × 13 keys** (P1-AC4: every probed field present and
        populated, and the one probed absent is not there);
      · headers byte-identical between runs; record skeletons byte-identical;
      · the only columns that move are `t` and card-reported values (`clocks.gr`, `clocks.sm`,
        `power.draw.instant`, `utilization.*`) — **none of our bookkeeping**;
      · `npm run mon -- --check-decode` holds the throttle table against the card's own named list in
        BOTH directions and was **mutation-proved red**: a mistyped `smiLabel` produced
        «карта знает причину «SW Power Cap», а таблица — нет» and exit 1;
      · a bogus `nvidia-smi` path produces the named refusal, not a stack.

### 3.5 — `automation-engine/lib/event-logger.mjs` — the crash half of the oracle ✅ CLOSED 2026-08-10

*Anchor: epic §4, phase-1 exit gate — "the fault watcher goes red against a real historical event".*

- [x] Four providers queried over a window, ids exactly from `config.FAULT_PROVIDERS` — no second
      copy of the id list in this module.
- [x] `Get-WinEvent` run **unelevated**; admin is never demanded.
- [x] **"Found nothing" and "could not look" are different answers.** Every provider carries its own
      status (`ok` / `no-events` / `error`), and `verdictFor()` returns UNKNOWN — never "clean" —
      when any provider failed to answer. A silent empty result read as an all-clear is the exact
      defect the contour's own review found one level up.
- [x] Proof status split and kept split: Kernel-Power 41 **red-proved on real history**; Display
      4101, WHEA and WER **fixture-proved only**, and the fixtures' filenames carry
      `__captured` / `__constructed` so nobody has to open a README to know which is which.
- [x] Fixtures in `automation-engine/lib/__fixtures__/` with `expectations.json` and a README stating
      the boundary: a constructed fixture proves the PARSER handles a shape, never that this machine
      would emit it.
- [x] **Verified 2026-08-10 00:36 +03:00 by observation:**
      · **P1-AC2** — `npm run events -- --since 2026-07-01 --until 2026-08-10` returned all THREE real
        `Kernel-Power` 41 events (29.07 10:00:36Z, 05.08 19:14:30Z, 06.08 17:35:10Z) and the verdict
        `CRASH`; the other three providers reported `no-events` separately, not as one silent zero.
      · **P1-AC3** — `npm run events -- --fixtures`: 5 fixtures, all match, exit 0.
      · **Mutation-proved red:** pointing the Display rule at 4107 turned the REAL negative fixture
        into a fault — suite red, exit 1, «fault: true != false».
      · **Mutation-proved red:** a provider forced to `status: 'error'` yields
        `{verdict: null}` with the reason, never `clean`.
      · A defect found by READING THE TOOL'S OWN OUTPUT, not the code: `--since 2026-07-01` printed
        «ОКНО: 2026-07-01T03:00:00» — a bare date is UTC midnight by spec, which on +03:00 cut three
        hours off the start of every window. Now a date-only argument is LOCAL midnight, and
        `--until <date>` means through the END of that day.

### 3.6 — `automation-engine/lib/stress-tester.mjs` — the verdict ✅ CLOSED 2026-08-10

*Anchor: epic §2 AC3 — "no crash and no silent corruption".*

- [x] Runs a workload, captures its checksum, compares against the golden reference, asks
      `event-logger.mjs` for faults over the same window, returns **PASS / SDC / CRASH** — or
      **UNKNOWN**, which is a fourth honest outcome and the one that keeps the other three truthful.
- [x] The transient scheduler lives here, on config's duty cycle.
- [x] SDC is loud: never averaged, never retried until it agrees, and printed inside a banner.
- [x] **Verdict ORDER is the design.** A dead process or a logged fault outranks everything (a run
      that fell over says nothing about its checksum); a mismatch observed directly is SDC even when
      the event log could not be read — seeing beats not-looking; PASS requires that nothing died,
      nothing mismatched, AND every witness actually answered.
- [x] **A GOLDEN REFERENCE IS ONLY VALID FOR THE CONDITIONS IT WAS CAPTURED UNDER.** The stamp
      carries driver + VBIOS (R6) **and the run arguments**, and a mismatch of either makes the
      verdict UNKNOWN rather than a verdict. The arguments half was NOT designed in — it was found by
      a real run, see the verification below.
- [x] **Verified 2026-08-10 00:52 +03:00 by observation:**
      · `npm run stress -- --selftest` — 10 blocks covering all five outcomes, each produced by
        MAKING IT HAPPEN through an injected runner, never by asserting what the code would do;
      · **the guard this step demands, on a real file:** one hex digit changed in
        `runs/baseline/sdc_fma.json` → `ВЕРДИКТ: SDC`, exit 1, «25 из 25 прогонов разошлись с
        эталоном»; restored → PASS again;
      · **the self-test itself mutation-proved red:** rounding SDC to PASS in `decideVerdict` turned
        two blocks red — ten green blocks that cannot fail would prove nothing;
      · real runs on this card: `sdc_fma` 82 bursts in 10 s → PASS against a baseline captured from
        the card itself, checksum `e27ec24a82d509d7`, which independently matches `MANIFEST.json`;
      · **the transient shape observed with our OWN sampler** — `hardware-mon` running alongside
        showed utilization alternating ~30 % / ~4 % in five-second blocks, exactly config's duty cycle.

> **A LIMITATION FOUND WHILE MEASURING, recorded rather than smoothed over.** One burst is one
> PROCESS, and process startup (~140 ms) dwarfs the kernel (0–25 ms at default arguments), so even
> during the ON half the card only reaches **~20–30 % utilization**. The transient SHAPE is real and
> that is what phase 1 needed; but a load that never saturates will not expose Vmin the way a
> sustained kernel does. **Phase 5 needs a workload that loops internally for N seconds instead of
> running once and exiting** — raising `iters` does not fix it (a heavier burst measured 23 % peak,
> because the spawn cost stays). Recorded here so the Vmin engine does not inherit a blunt instrument
> believing it is sharp.

### 3.7 — Capture the baseline ✅ CLOSED 2026-08-10

*Anchor: epic §2 AC7 — the driver/VBIOS stamp.*

- [x] Both workloads captured at stock into `runs/baseline/`, each with checksum, **run arguments**,
      repeat count, driver `610.88`, VBIOS `98.03.58.40.8b` and a local timestamp; the full
      `gpu:info` dump sits beside them as `_card.json`, taken by RUNNING `tools/gpu-info.mjs --json`
      rather than by a second copy of the probe.
- [x] Ignore-first confirmed BEFORE the first write: `git check-ignore -v runs/baseline/sdc_fma.json`
      → `.gitignore:26:runs/`.
- [x] **P1-AC5 is now EXECUTABLE, not a sentence:** `npm run stress -- --verify-baseline` reads every
      baseline, refuses one missing any stamp field, and holds each stamp against the card RIGHT NOW —
      so the day a driver update lands, the baselines announce themselves invalid instead of waiting
      to be believed (R6). An acceptance criterion only a human can check is one nobody checks after
      the day it was written.
- [x] **Verified 2026-08-10 00:53 +03:00 by observation:**
      · `--verify-baseline` → «эталонов 2, без штампа — 0», exit 0 — P1-AC5 met;
      · **mutation-proved red twice:** deleting `gpu.vbios` from one baseline → exit 1, «нет полей
        gpu.vbios — правило R6 не выполнено»; rewriting the driver stamp to `000.00` → exit 1, AND a
        real stress run against that same stale golden returned **НЕИЗВЕСТНО, not PASS**;
      · both workloads run against the fresh baseline: `branchy` 54 bursts → PASS, `sdc_fma` 67
        bursts → PASS, checksums `67e95c85bb6299a2` / `e27ec24a82d509d7` — the same values
        `workloads/MANIFEST.json` recorded on 2026-08-09, i.e. the reference reproduced across a day
        and across a re-capture.

> **A canon defect caught by reading the captured file, not the code.** `captured_at` was written as
> UTC (`2026-08-09T21:52Z`) while the owner's clock read `2026-08-10 00:52` — a machine receipt dated
> the PREVIOUS DAY, which is precisely the collision `AGENT_GUIDE.md` → "A stamp carries the DATE AND
> THE TIME" exists to prevent. Receipts are now local ISO 8601 with the offset.

> **What ships and what does not.** `runs/` is git-ignored by design, so the baseline is LOCAL state:
> a fresh clone has no golden and `npm run stress` will answer НЕИЗВЕСТНО until
> `--capture-baseline` is run once. The shipped copy of the same truth is `workloads/MANIFEST.json`,
> which carries each binary's `run_checksum` with the same driver/VBIOS stamp. Two artefacts, one
> fact — and the stress tester deliberately does NOT fall back to the manifest, because a missing
> baseline must be visible rather than papered over.

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
