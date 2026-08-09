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

### 2026-08-09 — Session 2: the epic planned, the review contour built, phase 1 opened

Moved from `STATUS.md` at `/end-chat`. Eight commits, `e5dfa67` … `406f0bf`.

**The planning ladder, on the owner's instruction to open the session with it**

- **`researches/03_headless_verification_toolchain.md`** — the third recon doc: what loads the card,
  what watches it, who says PASS. Its decisive finding was proved by running it: CUDA Toolkit 13.3
  and MSVC are on this machine, a test kernel compiled and returned the same checksum on three
  consecutive runs — so KAGO can build its own deterministic workload and needs no third-party
  binary. It also found that every mature benchmark sells script automation only in a paid tier,
  that `nvidia-smi` has no voltage field at all (so phase 5 depends on phase 4 by evidence), and
  that HWiNFO64 must leave the architecture.
- **`plans/01_EPIC_kago_orchestrator.md`** — the meta-plan: goal vector, seven acceptance criteria
  with Scale/Meter/Target, six phases with their order argued, entry and exit gates, tiered risks.
  Written in English first, rewritten in Russian on the owner's decision (see below).
- **`plans/02_epic01_phase1_harness_and_baseline.md`** — the operational plan for phase 1 only.

**The owner-review contour, built on the owner's mid-session instruction** *«если нужно будет от
меня слово — разворачивай интерактивный контур KAIF»*

Five files, ≈3 470 lines, zero external dependencies: `tools/lib/review-core.mjs` (the one truth —
normalization, hash, parsing, decision writes, the renderer), `tools/questions-guard.mjs` (four
axes with a ratchet), `tools/review.mjs` (page, server, signal, queue), `tools/review-gate.mjs`
(fail-closed `checkApproval`), `tools/send-upstream.mjs` (its real consumer — a KAIF ticket via
`gh`). Proven by observation, not claimed: the guard red on a new violation and green on an excused
one; the full save cycle writing all three places and the server terminating on its own; the gate's
five behaviours including that a real content change voids an approval while CRLF+BOM does not.
Field report filed as [KAIF#7](https://github.com/MikalaiKryvusha/KAIF/issues/7).

**Interview 001 — the contour's first live cycle, closed without one clarification in chat**

| Question | Owner's answer (2026-08-09 23:23 +03:00) |
|---|---|
| What measures performance acceptance (3DMark automation is Professional-only) | **A** — the automated gate uses KAGO's own numbers; the percentage of stock is one manual 3DMark run at the close of phase 6 |
| Does FurMark go on the bench | **A** — not adopted at all, neither as a dependency nor as a bench tool |
| Does the compiled binary ship | **B** — **it ships**, against the agent's recommendation, so KAGO works on a machine with no CUDA Toolkit |

Answers propagated to every declared target before the status flip; the return-leg guard reports
`проверок 3 · нарушений 0`.

**Phase 1 opened — three steps closed**

- `automation-engine/config.mjs` — every safety number named, each with the line it came from, each
  audited by grep. The thermal policy is written as an observation (the card never declared a
  throttle) rather than as an invented ceiling; the power range is probed, never hard-coded.
- `automation-engine/lib/toolchain.mjs` — three lookup strategies for `nvcc` + the MSVC environment,
  with the x86-hosted cross compiler as a proven fallback and a NAMED refusal instead of a stack.
- `workloads/sdc_fma.cu` and `workloads/branchy.cu` + `tools/build-workloads.mjs` — the SDC-prone
  and crash-prone shapes, each deterministic across five repeats (P1-AC1), shipped with
  `MANIFEST.json` so a committed binary can be verified rather than trusted.

**The KAIF language defect, found by the owner**

The canon routed document language by directory, so the epic meta-plan — which the same guide calls
"where the owner sees the whole shape once" — came out in English in a Russian-language project.
Contradiction three lines apart in one file. Fixed locally by routing on a QUESTION (*does the owner
read this?*) with an audience table; filed as [KAIF#6](https://github.com/MikalaiKryvusha/KAIF/issues/6)
with corroborating evidence from this project's own install report, which had recorded the ambiguity
hours earlier without it being acted on. `plans/01_EPIC` and `STATUS.md` rewritten in Russian.

**The machine incident, recorded because it cost real time**

`winget upgrade --id Microsoft.VisualStudio.2022.Community`, run believing it a read-only check,
started an unrequested Visual Studio upgrade; interrupting it left MSVC half-installed. Repaired the
same evening (finished 22:50, toolset 14.44 with both hosts restored). The detour bought one useful
fact: the same kernel produced an identical checksum on three different toolchain configurations, so
the golden reference survives a compiler change. Lessons `EXP-0005` and `EXP-0007`; a `deny` rule in
the harness permission file now blocks the whole verb class.

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
