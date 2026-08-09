# KAGO — Current Status

> This file is read by the AI agent before every task. Update it on every significant change of state.
> It is the PRIMARY handoff between sessions: a new agent session starts with empty context and must be
> able to get productive from this file alone. Write accordingly — concrete, with file paths and commands.
> 🧠 Prime thinking principle — `PHILOSOPHY.md` (SIMPLICITY: KISS + Occam). Read your working framework
> in `AGENT_GUIDE.md`.
>
> ⚠️ **STATUS is a SUMMARY of NOW, not a chronicle.** Closed work MOVES to `PROJECT_HISTORY.md`.
> Soft target ~200 lines. Every line must answer: *"if I remove this, will the next agent err?"*

---

## Where we are now

**Phase 0 is closed** (2026-08-09). **The epic is planned** (2026-08-09 22:41 +03:00): the full
ladder exists — research → meta-plan → an operational plan for phase 1 only.

**The orchestrator is still zero lines of code.** Everything that exists is documents plus two
read-only tools. Do not let any document imply otherwise.

| Phase | Status | Where its plan lives |
|-------|--------|----------------------|
| 0 — KAIF deployment + research | ✅ done | `PROJECT_HISTORY.md` |
| 1 — Harness and baseline | 🔲 **open, planned** | `plans/02_epic01_phase1_harness_and_baseline.md` |
| 2 — Silent Cold on `nvidia-smi` | 🔲 skeleton | `plans/01_EPIC_kago_orchestrator.md` §3 |
| 3 — Three shortcuts + status tray | 🔲 skeleton | same |
| 4 — Own NVAPI bridge | 🔲 skeleton | same |
| 5 — Vmin sweep engine | 🔲 skeleton | same |
| 6 — Two profiles + acceptance | 🔲 skeleton | same |

> Operational plans are written **one phase at a time** — the plan for phase N+1 is written when
> phase N closes. That is deliberate, not an omission.

### The seven facts that shape every decision

1. **Power limit only moves 250 → 300 W** — 50 W of headroom. The PDF's −60…−120 W targets are
   unreachable by power limiting; curve editing is mandatory.
2. **`nvidia-smi -pl` writes here — proven** (2026-08-09, owner's consent): 300 → 290 W, read back,
   restored. **The trap:** the tool's success message prints the *default* in its "from" field, not
   the previous value — always read state back, never parse the message (`researches/01` §5).
3. **`nvidia-smi` cannot read voltage at all** — there is no such field. Phase 5 therefore *depends*
   on phase 4's NVAPI bridge (`researches/03` §2).
4. **Vmin is program-dependent by ~100 mV**, and failure near the edge is a cliff (3 % → 90 % error
   rate over 2 % of voltage). One benchmark proves nothing; the guardband is not optional.
5. **More than half of undervolting failures are silent.** "It didn't crash" is not a pass.
6. **KAGO builds its own workloads — proven.** CUDA Toolkit 13.3 + MSVC are on this machine; a test
   kernel compiled and returned `fd7d452ce569c9d7` on three consecutive runs. Every mature benchmark
   sells script automation only in a paid tier, so writing our own is the cheap path, not the
   expensive one (`researches/03`).
7. **HWiNFO64 is out of the architecture** — a third-party GUI (forbidden by `GOAL.md`), and the
   hotspot sensor it existed for is disabled at driver level on RTX 50; this card returns `N/A`.

### Settled by the owner — do not relitigate

- **Three shortcuts, passive tray.** 🚀 Max Optimal · ❄️ Silent Cold · ⏹ Reset to factory. Each one
  becomes the remembered boot state. The tray shows the active profile and has no buttons.
  This **supersedes** the `GOAL.md` line about killing the tray to reset —
  `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` §4 explains why.
- **The ladder:** `nvidia-smi` backend now, an own NVAPI bridge (FFI to `nvapi64.dll`) later.
  No third-party GUI, ever. `green-curve` is the fallback only if Blackwell resists.
- **`profile-manager.mjs` is an interface with swappable backends.** Nothing else calls a GPU tool.

---

## 🤖 Autonomous backlog pool (no human / no special hardware needed)

> **The whole of phase 1 is autonomous-safe** — it performs zero GPU writes by design. Work it by
> `plans/02_epic01_phase1_harness_and_baseline.md`, in order, ticking its checkboxes. Its steps:
> `config.mjs` → `toolchain.mjs` → `workloads/*.cu` → `hardware-mon.mjs` → `event-logger.mjs` →
> `stress-tester.mjs` → capture the baseline → extend `gpu:info` with the clock ladder.

Not covered by that plan and still open:

- [ ] Re-run the CUDA build proof after the Visual Studio repair finishes, and only then let a
      `[TESTED]` marker for the workload builder travel into code.

---

## ❓ Awaiting human review

- **`interviews/interview_001_harness_boundaries.md` — OPEN, three questions.** Acceptance benchmark
  (3DMark automation is Professional-only) · whether FurMark may sit on the bench · whether the
  compiled workload binary ships. **None of them blocks phase 1.**
- **`-lgc` (clock locking) has never been exercised.** The owner's consent covered `-pl` only. Ask
  before the first `-lgc` write — it is the other half of the path A backend.
- **KAIF signals are filed and open upstream** — nothing is blocked on them, but keep the local
  `bugs/KAIF/*` docs open until an update actually retires the defects:
  [KAIF#3](https://github.com/MikalaiKryvusha/KAIF/issues/3) ·
  [KAIF#4](https://github.com/MikalaiKryvusha/KAIF/issues/4) ·
  [KAIF#5](https://github.com/MikalaiKryvusha/KAIF/issues/5).

---

## Where to continue next session — the baton

1. **Start coding phase 1**, by `plans/02_epic01_phase1_harness_and_baseline.md`. The planning
   ladder is built; the next artifact is code, not another plan. Quote the plan's anchor line before
   each step (`AGENT_GUIDE.md` checklist step 8).
2. **Read first, in order:** this file → `plans/01_EPIC_kago_orchestrator.md` (the whole shape once)
   → `plans/02_epic01_phase1_...` (what to do now) → `researches/03` (what the harness may use).
   `researches/01` and `02` are the evidence base — read, never re-derive.
3. **Check `interviews/interview_001`** — if the owner has answered, fold the answers into the epic's
   AC5 meter and the phase-1 plan before touching related code.
4. **Re-probe before trusting any number:** `npm run gpu:info`. **If the driver changed from 610.88,
   every stored profile is invalid until re-validated** — that is rule R6.
5. **Do not write to the GPU** outside a planned step with a stated rollback and the owner's consent
   for that class of write. Probes are free; writes are the owner's hardware. The harness permission
   file now makes every `-pl`/`-lgc`/`-rgc` call prompt.
6. **Writing anything the owner signs** — README, release notes, landing copy? Open
   `AUTHOR_STYLOMETRY.md` (project root, git-ignored) and run its checklist first. Missing after a
   fresh clone: `cp d:\work\krinik_voice\AUTHOR_STYLOMETRY.md .`

---

## Machine state to know about

- **Visual Studio Community 2022 was repaired on 2026-08-09** after an agent command
  (`winget upgrade --id …`) started an unrequested upgrade and the agent then interrupted it,
  leaving MSVC half-installed. Lesson: `EXPERIENCE.md` → EXP-0005. A `deny` rule in
  `.claude/settings.local.json` now blocks `winget upgrade/install` outright — the read-only form is
  `winget list --upgrade-available`.
- **`.claude/settings.local.json` holds the harness permission grant** (owner, 2026-08-09). It is
  git-ignored: one owner, one machine, public repository.
- **`nvcc` needs the MSVC environment loaded** — it does not find a host compiler by itself. The
  x86-hosted cross compiler is a proven fallback. Details in the `AGENT_GUIDE.md` dossier.

---

## Open bugs

None in the product. Two framework tickets are open upstream — see "Awaiting human review".
