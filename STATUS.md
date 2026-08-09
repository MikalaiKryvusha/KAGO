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

## What's done (the short tail — older entries live in PROJECT_HISTORY.md)

### Phase 0 — KAIF deployment and the research base ✅ (2026-08-09)
- **KAIF 2.2 deployed**, lang `ru`, sphere `programming`, mode standard, five agent systems.
- **`researches/01_gpu_control_paths.md`** — the owner's `GOAL.md` question answered: undervolting
  without MSI Afterburner is possible; three paths compared; the ladder chosen.
- **`researches/02_vmin_guardband_methodology.md`** — the per-point Vmin search and the guardband,
  built on Leng et al. (MICRO 2015) measurements.
- **`tools/check.mjs`** and **`tools/gpu-info.mjs`** written and run green — the first two commands
  of the harness.
- **`MASTER_PLAN.md`** derived: phases 0–6 with a decision log.

---

## Where we are now

The framework is in place and the architecture is settled, but **no orchestrator code exists yet**.
The next real work is phase 1: telemetry and the stock baseline. Everything about the GPU that any
document asserts came from a live probe (`npm run gpu:info`) — keep it that way.

| Phase | Status | What's there |
|-------|--------|--------------|
| 0 — KAIF deployment + research | ✅ done | this file, the two maps, `researches/01`, `researches/02`, `MASTER_PLAN.md` |
| 1 — Baseline and telemetry | 🔲 next | nothing yet; `tools/gpu-info.mjs` is the seed |
| 2 — Silent Cold on `nvidia-smi` | 🔲 todo | — |
| 3 — Shortcuts, tray, autostart, reset | 🔲 todo | the reset-on-kill design is still open |
| 4 — Own NVAPI bridge | 🔲 todo | — |
| 5 — Vmin sweep engine | 🔲 todo | method decided in `researches/02` |
| 6 — Two profiles + acceptance | 🔲 todo | — |

### The three facts that shape every decision

1. **Power limit only moves 250 → 300 W** on this card — 50 W of headroom. The master plan's
   −60…−120 W targets are unreachable by power limiting; curve editing is mandatory.
2. **Vmin is program-dependent by ~100 mV**, and failure near the edge is a cliff (3 % → 90 % error
   rate over 2 % of voltage). One benchmark proves nothing; the guardband is not optional.
3. **More than half of undervolting failures are silent.** "It didn't crash" is not a pass.

---

## 🤖 Autonomous backlog pool (no human / no special hardware needed)

> Tasks the agent can do FULLY autonomously: write code → build → test on the harness → fix → commit.

- [ ] Write `automation-engine/config.mjs` with the named safety constants from `researches/02`
      (guardband ≥4 grid steps / ≥25 mV, step sizes, temperature ceilings) — pure code, no GPU write.
- [ ] Write `automation-engine/lib/event-logger.mjs` — read Windows Event Log for TDR (source
      `Display`), WHEA and unexpected-shutdown records. Read-only; prove it against a historical event.
- [ ] Write `automation-engine/lib/hardware-mon.mjs` — wrap `nvidia-smi` polling into a sampler.
      Read-only.
- [ ] Extend `tools/gpu-info.mjs` to enumerate the full supported-clock ladder into JSON — the
      search space for phase 5.
- [ ] Fill the four `— not probed yet —` rows in the `AGENT_GUIDE.md` environment dossier.

---

## ❓ Awaiting human review (interviews / homework)

- ✅ **The three KAIF signals were sent** on the owner's approval, 2026-08-09, under the owner's
  account — nothing here is waiting on them any more, but they stay listed until upstream closes them:
  [KAIF#3](https://github.com/MikalaiKryvusha/KAIF/issues/3) (placeholder gate vs the sphere library) ·
  [KAIF#4](https://github.com/MikalaiKryvusha/KAIF/issues/4) (no owner-voice step in the adaptation task) ·
  [KAIF#5](https://github.com/MikalaiKryvusha/KAIF/issues/5) (the install field report).
  Keep the local `bugs/KAIF/*` docs open until an update actually retires the defects.
- 🧰 **Confirm `nvidia-smi -pl` actually writes on this card.** Needs an elevated shell and the
  owner's consent — it is the first GPU *write* the project will ever make. The card reports a
  250–300 W range, which implies support, but implication is not observation.
- ❓ **Reset-on-kill design** (heartbeat vs watchdog vs Job Object) — `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` §4.
  Decide in phase 3; file an interview if the owner has a preference.

---

## Where to continue next session

1. Read `GOAL.md`, then `researches/01` and `researches/02` — they carry every constraint.
2. Run `npm run gpu:info` and compare against the numbers in `STATUS.md` above. **Driver changed?
   Every stored profile is invalid until re-validated** — that is rule R6.
3. Start phase 1 from the autonomous backlog: `config.mjs`, then `event-logger.mjs`.
4. **Do not write to the GPU** without a planned step and a stated rollback. Probes are free; writes
   are the owner's hardware.

---

## Open bugs

None yet.
