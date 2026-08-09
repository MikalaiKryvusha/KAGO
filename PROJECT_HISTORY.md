# KAGO — Project History (the chronicle)

> The APPEND-ONLY chronicle of how this project lived and grew: closed sessions, shipped phases,
> releases, big decisions in the order they happened. This is where `STATUS.md` sheds its past —
> STATUS stays a short live summary of NOW; everything finished moves HERE (the "bonsai trim" step
> of `/end-chat`).
>
> **Not required reading.** This file is NOT part of `/resume`'s canon set and not in the
> before-every-task minimum — open it only when you actually need the archaeology: how a decision
> came to be, what an old phase contained, when something shipped.
>
> **Chronicle rules (ADR discipline):**
> - **Append-only, newest on top.** A recorded entry is never edited to say something else —
>   history that can be rewritten is not history. Corrections come as NEW entries that reference
>   and supersede the old one.
> - An entry moves here VERBATIM from `STATUS.md` when its work closes — move, don't rewrite;
>   the entry already carries its dates, counters and file pointers.
> - Entries mention versions and dates freely — a chronicle legitimately speaks of old versions,
>   and the update machinery's stale-claims scan knows to leave this file alone.
> - When the file grows unwieldy, split by era: keep the newest era here, move older ones to
>   `PROJECT_HISTORY_<era>.md` files, and leave a one-line index at the top of this file
>   (the pattern large changelogs use).
>
> Living document — never DONE-tagged.

---

## Entries (newest first)

### 2026-08-09 — Session 1: KAIF deployed, phase 0 closed, project published 🎉

Moved verbatim from `STATUS.md` at `/end-chat`.

**Phase 0 — KAIF deployment and the research base ✅**

- **KAIF 2.2 deployed**, lang `ru`, sphere `programming`, mode standard, five agent systems.
  Loader exit 0; both artefacts sha256-verified; 246 files written; `verify-final` green and
  self-cleaned.
- **`researches/01_gpu_control_paths.md`** — the owner's `GOAL.md` question answered: undervolting
  without MSI Afterburner is possible; three paths compared; the ladder chosen.
- **`researches/02_vmin_guardband_methodology.md`** — the per-point Vmin search and the guardband,
  built on Leng et al. (MICRO 2015) measurements.
- **`tools/check.mjs`** and **`tools/gpu-info.mjs`** written and run green.
- **`MASTER_PLAN.md`** derived: phases 0–6 with a decision log.
- **Published:** https://github.com/MikalaiKryvusha/KAGO — public, MIT, bilingual README.
- **Owner's voice portrait installed** — the full private core at the project root, git-ignored.
- **Feedback loop closed upstream:** [KAIF#3](https://github.com/MikalaiKryvusha/KAIF/issues/3),
  [KAIF#4](https://github.com/MikalaiKryvusha/KAIF/issues/4),
  [KAIF#5](https://github.com/MikalaiKryvusha/KAIF/issues/5) — filed on the owner's approval.

**Decisions the owner made in this session:**

| Time (+03:00) | Decision |
|---|---|
| 21:28 | The ladder: `nvidia-smi` first, an own NVAPI bridge after. License MIT. |
| 22:35 | Pull the full private voice core into the project, git-ignored. |
| 22:50 | Three shortcuts (Max Optimal · Silent Cold · Reset to factory), each writing the remembered boot state. The tray displays only — no buttons. This supersedes the `GOAL.md` line about killing the tray to reset. |

**Proved by observation, not assumed:** `nvidia-smi -pl` writes on this card (300 → 290 W, read
back, restored to 300), on the owner's explicit consent from an elevated shell.

**The framework gap the owner caught:** KAIF's adaptation task has nine items and none installs the
owner's voice portrait — so this project's README was written before its author's voice arrived.
Filed as KAIF#4 with a proposed tenth item.

### <date> — <session/phase/release title> <✅/🎉>
`<The entry as it lived in STATUS.md — verbatim: what was done, key numbers, file pointers.>`
