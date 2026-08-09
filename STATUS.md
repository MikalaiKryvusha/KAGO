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

**Phase 0 is closed** (2026-08-09 — the full record is in `PROJECT_HISTORY.md`). KAIF is deployed,
the research base and the architecture are settled, the repository is public at
https://github.com/MikalaiKryvusha/KAGO.

**The orchestrator is zero lines of code.** Everything that exists is documents plus two read-only
tools. Do not let any document imply otherwise.

| Phase | Status | What's there |
|-------|--------|--------------|
| 0 — KAIF deployment + research | ✅ done | the two maps, `researches/01`, `researches/02`, `MASTER_PLAN.md`, public repo |
| 1 — Baseline and telemetry | 🔲 **next** | nothing yet; `tools/gpu-info.mjs` is the seed |
| 2 — Silent Cold on `nvidia-smi` | 🔲 todo | backend proven to write (see below) |
| 3 — Three shortcuts + status tray | 🔲 todo | design settled by the owner |
| 4 — Own NVAPI bridge | 🔲 todo | — |
| 5 — Vmin sweep engine | 🔲 todo | method decided in `researches/02` |
| 6 — Two profiles + acceptance | 🔲 todo | — |

### The four facts that shape every decision

1. **Power limit only moves 250 → 300 W** on this card — 50 W of headroom. The master plan's
   −60…−120 W targets are unreachable by power limiting; curve editing is mandatory.
2. **`nvidia-smi -pl` writes here — proven**, 2026-08-09, on the owner's consent: 300 → 290 W, read
   back, restored. Path A is a real backend, not an assumption. `researches/01` §5 carries the
   transcript **and the trap**: the tool's own success message prints the *default* in its "from"
   field, not the previous value — always read state back, never parse the message.
3. **Vmin is program-dependent by ~100 mV**, and failure near the edge is a cliff (3 % → 90 % error
   rate over 2 % of voltage). One benchmark proves nothing; the guardband is not optional.
4. **More than half of undervolting failures are silent.** "It didn't crash" is not a pass.

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

> Write code → `npm run check` → verify → commit. All of these are READ-ONLY toward the GPU.

- [ ] `automation-engine/config.mjs` — the named safety constants from `researches/02`
      (guardband ≥4 grid steps / ≥25 mV, step sizes, temperature ceilings), each with a comment
      naming where the number came from.
- [ ] `automation-engine/lib/event-logger.mjs` — read the Windows Event Log for TDR (source
      `Display`), WHEA and unexpected shutdowns. Prove it against a historical event, not a claim.
- [ ] `automation-engine/lib/hardware-mon.mjs` — wrap `nvidia-smi` polling into a sampler.
- [ ] Extend `tools/gpu-info.mjs` to dump the full supported-clock ladder as JSON — that ladder is
      phase 5's search space.
- [ ] Fill the four `— not probed yet —` rows in the `AGENT_GUIDE.md` environment dossier.

---

## ❓ Awaiting human review

- **`-lgc` (clock locking) has never been exercised.** The owner's consent covered `-pl` only. Ask
  before the first `-lgc` write — it is the other half of the path A backend.
- **KAIF signals are filed and open upstream** — nothing is blocked on them, but keep the local
  `bugs/KAIF/*` docs open until an update actually retires the defects:
  [KAIF#3](https://github.com/MikalaiKryvusha/KAIF/issues/3) ·
  [KAIF#4](https://github.com/MikalaiKryvusha/KAIF/issues/4) ·
  [KAIF#5](https://github.com/MikalaiKryvusha/KAIF/issues/5).

---

## Where to continue next session — the baton

**The owner's instruction for the next chat, verbatim:** *«следующий чат начнём с эпик планирования
и нарезания эпика на фазы и операционные планы»*.

1. **Start with `/plan-epic`, not with code.** KAGO passes the heaviness test on every axis
   (`AGENT_GUIDE.md` → Planning discipline): it touches many subsystems, rests on external truth,
   spans many sessions, and can damage the owner's hardware. The ladder is: research → meta-plan in
   `plans/` → operational plans **per phase, one at a time** — never all upfront.
2. **The research rung is already built.** `researches/01` (control paths) and `researches/02`
   (Vmin and the guardband) are the evidence base — read them first and do not re-derive them.
   `MASTER_PLAN.md` already carries phases 0–6; the epic plan refines that shape, it does not
   replace it.
3. **Then read, in order:** `GOAL.md` (the owner's own words) → this file → `MASTER_PLAN.md` →
   `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` (the six rules and the blast-radius table).
4. **Re-probe before trusting any number:** `npm run gpu:info`. **If the driver changed from
   610.88, every stored profile is invalid until re-validated** — that is rule R6.
5. **Do not write to the GPU** outside a planned step with a stated rollback and the owner's
   consent for that class of write. Probes are free; writes are the owner's hardware.
6. **Writing anything the owner signs** — README, release notes, landing copy? Open
   `AUTHOR_STYLOMETRY.md` (project root, git-ignored) and run its checklist first. Missing after a
   fresh clone: `cp d:\work\krinik_voice\AUTHOR_STYLOMETRY.md .`

---

## Open bugs

None in the product. Two framework tickets are open upstream — see "Awaiting human review".
