# Epic 01 — KAGO: from zero lines of code to two proven undervolt profiles on a shortcut

> **Created:** 2026-08-09 22:41 +03:00 (agent, on the owner's instruction *«следующий чат начнём с
> эпик планирования и нарезания эпика на фазы и операционные планы»*)
> **Parent:** `MASTER_PLAN.md` phases 1–6 — this document refines their shape, it does not replace
> them. Evidence base: `researches/01` (control paths) · `researches/02` (Vmin and the guardband) ·
> `researches/03` (the headless harness).
> **Status:** 🟡 phase 1 planned and open · phases 2–6 are skeletons by design (an operational plan
> for phase N+1 is written when phase N closes)
> **Outbound:** three forks → `interviews/interview_001_harness_boundaries.md` (open) · the phase
> reordering evidence → `MASTER_PLAN.md` decision log
> **Descendants:** `plans/02_epic01_phase1_harness_and_baseline.md`

---

## 1. Goal vector

**The pain.** The owner's RTX 5070 Ti runs hotter and louder than it needs to, and every ordinary
route to fixing that has a defect the owner named himself: it requires installing a third-party GUI
tuning application, and it judges the result by *"it didn't crash"*. `researches/02` measured what
that verdict misses — 37 of 57 programs corrupt data **silently** before they ever crash, and the
failure is a cliff, not a slope (error rate 3 % → 90 % across 2 % of voltage).

**Where we want to be.** Two profiles, measured on **this** card, each proved against silent
corruption as well as crashes, switched by a desktop shortcut, remembered across a reboot — and
factory state always one shortcut or one power cycle away, with no action required from the owner
and no third-party GUI anywhere in the dependency list.

**Goal types in play:** *Achieve* — the two profiles and the surface. *Maintain* — factory state as
the default, and the zero-GUI constraint. *Avoid* — a profile that corrupts data silently.

## 2. Acceptance criteria for the epic

Each criterion carries Scale · Meter · Target (`REQUIREMENTS_FRAMEWORK.md` → the fit criterion).
A criterion whose target comes from the owner's PDF says so; nothing here is invented.

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **AC1** | WHEN a shortcut is double-clicked, the orchestrator shall apply its profile and confirm it by reading the state back. | Scale: shortcuts whose write→read-back matches · Meter: `profile-manager.mjs` verification log · **Target: 3 of 3** |
| **AC2** | WHILE the machine boots, the card shall end at either the remembered profile or factory state — never at an unverified intermediate. | Scale: boots ending in a verified state · Meter: `npm run gpu:info -- --json` diffed against the remembered record · **Target: 5 of 5 consecutive reboots** |
| **AC3** | The acceptance run shall produce no crash and no silent corruption. | Scale: count of CRASH + SDC verdicts · Meter: `event-logger.mjs` + `stress-tester.mjs` over the phase-6 suite · **Target: 0** |
| **AC4** | *Silent Cold* shall cut package power under the standard transient load. | Scale: W, median over the run · Meter: `hardware-mon.mjs` samples, stock vs. profile · **Target: ≥ 100 W below stock** (source: owner's PDF, −100…−120 W) |
| **AC5** | *Max Optimal* shall hold performance near stock. | Scale: % of stock throughput · Meter: **gated on `interview_001` Q1** · **Target: ≥ 97 %** (source: owner's PDF) |
| **AC6** | The dependency list shall contain no third-party GUI application. | Scale: count of such dependencies · Meter: read `package.json` + the tree · **Target: 0** (source: `GOAL.md`, owner's words) |
| **AC7** | IF the driver or VBIOS version changes, THEN every stored profile shall be marked invalid until re-validated. | Scale: profiles applied with a stale stamp · Meter: the stamp check in `profile-manager.mjs` · **Target: 0** |

These may be edited as phases teach — changing a criterion is an edit, not a failure. AC5's meter is
deliberately blank until the owner answers `interview_001`; that blank is a known gap, not an
oversight.

## 3. The phases, their order, and why that order

```
  1 Harness & baseline ──► 2 Silent Cold ──► 3 Surface ──►  [a complete, useful product]
                                                    │
                                                    ▼
                                        4 NVAPI bridge ──► 5 Vmin engine ──► 6 Two profiles
```

**Phase 1 — Harness and baseline.** *Nothing can be judged before it can be observed.* Telemetry,
the fault watcher, KAGO's own workload runners, and the golden references captured at stock. Zero
GPU writes in this whole phase — which is exactly why it is first: it is the only phase that carries
no risk to the owner's hardware, and everything after it depends on its verdicts being trustworthy.

**Phase 2 — Silent Cold on `nvidia-smi`.** The first real profile, on the backend already proven to
write (`researches/01` §5: 300 → 290 W, read back, restored). Locking the core clock walks the card
down its stock curve; that reaches *cold and quiet* and cannot reach *fast and cool*.

**Phase 3 — The surface.** Three shortcuts, the passive tray, autostart, and elevation through a
Scheduled Task (`researches/03` §3.6). Placed **before** the expensive NVAPI work on purpose: after
phase 3 the owner has a finished, daily-useful product — one profile, on a shortcut, that survives a
reboot. That is the Pareto cut of this epic; everything after it buys the second profile.

**Phase 4 — KAGO's own NVAPI bridge.** FFI to `nvapi64.dll` for the V/F curve. The most expensive
and least certain phase, and the one with a named fallback (`green-curve` as a backend, which the
phase-2 interface already permits).

**Phase 5 — The Vmin sweep engine.** *Formally gated on phase 4, by evidence rather than by taste:*
`nvidia-smi` has no voltage field at all (`researches/03` §2), so until the bridge exists the search
cannot observe its own control variable.

**Phase 6 — Two profiles and acceptance.** Assembly, the long runs, the owner's verdict.

## 4. Gates

A phase is not closed by feeling finished. Entry and exit are checkable.

| Phase | Entry gate | Exit gate |
|---|---|---|
| **1** | `researches/03` exists (✅) | `npm run check` green · every workload runner returns a byte-identical checksum on repeat runs · the fault watcher goes **red** against a real historical event · golden references stored with driver + VBIOS stamp · every new module carries `[NOT-TESTED]`/`[TESTED: …]` honestly |
| **2** | phase 1 exit gate green | a profile applies, reads back, and matches · its rollback is exercised, not merely written · `[TESTED]` markers carry the observation |
| **3** | phase 2 exit gate green | AC1 and AC2 met · the reset shortcut proven from a non-factory state · the tray survives being killed without changing GPU state |
| **4** | phase 3 exit gate green · owner's consent for curve writes (a new write class — `researches/01` risk list) | read-after-write on the curve matches, or the profile is refused · the voltage grid step measured on the live curve, not assumed |
| **5** | phase 4 exit gate green | per point: three-way verdict, edge bracketed, guardband ≥ 4 grid steps and ≥ 25 mV (`researches/02` §3) · worst-case across the whole workload set, never the first failure found |
| **6** | phase 5 exit gate green | AC3, AC4, AC5 met · `/fable-judge` pass · the owner's acceptance |

Every phase also closes with a `/fable-judge` pass before the next phase's operational plan is
written (`AGENT_GUIDE.md` → task execution discipline).

## 5. Open forks

Three, all filed with their material quoted in full in
**`interviews/interview_001_harness_boundaries.md`**: the acceptance-benchmark question (3DMark
automation is Professional-only), the graphics-load question (our own vs. FurMark on the bench),
and the shipped-binary question. **None of them blocks phase 1** — phase 1 proceeds while they wait.

## 6. Risks, tiered

**(a) Highest — defended, not merely listed.**

- *A profile that passes our tests and corrupts data in the owner's real work.* Defence: the
  golden-reference oracle (proven buildable, `researches/03` §2.1), the diverse workload set, and a
  guardband sized from what the search could not see.
- *A GPU write with no way back.* Defence: R5 of the internal map — every write has its rollback in
  the same module — plus the fact that profiles live in volatile memory, so a power cycle is always
  the last resort.
- *A driver update silently changing voltage behaviour* (it happened: `595.71`). Defence: AC7 — the
  stamp check.

**(b) Plausible — contingency named.**

- *Blackwell resists the NVAPI curve writes.* → fall back to `green-curve` as a backend; the phase-2
  interface was designed for exactly this.
- *The toolchain that builds our workload is absent or broken on a future machine.* → already seen
  in the field tonight; phase 1 locates it via `vswhere` rather than assuming a PATH.

**(c) Least likely — recorded so they are not forgotten.**

- Task Scheduler policy changes break the no-UAC elevation pattern.
- The tray icon's Windows API changes across a feature update.

## 7. Trace

Children are named `NN_epic01_<phase>_<name>.md`, and every operational step cites the line of this
document it executes. A step that cannot be anchored here is scope drift, caught before the diff.

## 8. Decisions made without the owner

*Filled at epic close. Running list so far:*

- **HWiNFO64 removed from the architecture** — it is a third-party GUI application (`GOAL.md`
  forbids it) and the sensor it existed for is disabled at driver level on RTX 50; this card returns
  `N/A`. Recorded in `researches/03` §3.5.
- **Phase 3 placed before phase 4** — to put a complete, useful product in the owner's hands before
  the expensive and uncertain bridge work.
- **Phase 1 widened** from "telemetry" to "harness and baseline", because `researches/03` showed the
  workload runners cannot be bought and must be built here.
