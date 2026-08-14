# KAGO — internal architecture map

> **Who depends on whom, and what breaks what.** Read this before editing code, to know the blast
> radius. The *layout* of the tree is in `PROJECT_STRUCTURE_EXTERNAL_MAP.md`.
>
> Living reference — never `DONE`-tagged. Updated: 2026-08-09.
> **Status caveat:** the orchestrator is designed, not yet written. This map describes the contract
> the code must satisfy; it becomes a description of reality during phase 1.

---

## 1. The dependency shape

```
                    engine.mjs  ── the only module that decides
                         │
        ┌────────────────┼─────────────────┬──────────────────┐
        ▼                ▼                 ▼                  ▼
 profile-manager   stress-tester    hardware-mon        event-logger
   (WRITES)          (verdict)       (telemetry)      (fault detection)
        │                                                     │
   ┌────┴────┐                                                │
   ▼         ▼                                    Windows Event Log
nvidia-smi  nvapi        ← swappable backends       (TDR/WHEA/BSOD)
 backend    backend

           config.mjs ← read by everyone, depends on nothing
```

`setup-desktop.mjs` and `desktop-shortcuts.mjs` sit outside this loop: they consume finished
profiles and build the owner-facing surface. They never search and never test.

## 2. The rules that hold it together

| # | Rule | Why it exists |
|---|---|---|
| R1 | **`profile-manager.mjs` is the only module that writes to the GPU.** | One writer means one place to audit, and one place that owns rollback. |
| R2 | **`profile-manager.mjs` is an interface; backends are swappable.** | Phase 2 ships `nvidia-smi`, phase 4 ships the NVAPI bridge, `green-curve` is the fallback. The owner's PDF hard-wires MSI Afterburner here — `GOAL.md` forbids it (`researches/01`). |
| R3 | **`config.mjs` depends on nothing and holds every safety number.** | Voltages, step sizes, temperature ceilings and guardbands are safety parameters, not literals scattered through call sites. |
| R4 | **A stability verdict needs THREE observations: the checksum, the event log, AND the throughput.** | Crash detection alone misses silent data corruption, the majority failure mode (`researches/02`). The third was added 2026-08-10 from `researches/04`, and it closes a genuine blind spot: **clock stretching** (the card skips work while still REPORTING the locked clock) and **memory error replay** (GDDR7 carries internal ECC + CRC, so failed transfers are corrected or retried) both produce a CORRECT checksum and NO event. A profile suffering either would have been stamped PASS. The only observable is work-per-second against a stock reference — the same number that serves as the price in the owner's «снижаем, пока цена ≤ N» formula. |
| R4a | **A read-back proves what was COMMANDED, never what was DELIVERED.** | `clocks.gr` sitting on the locked point is evidence the command took (EXP-0014) — it is not evidence the card is doing that much work, precisely because of clock stretching. Anything claiming delivered performance must measure throughput. |
| R5 | **Every write has its rollback in the same module.** | A function that changes hardware and cannot undo itself does not ship. |
| R6 | **Profiles carry the driver and VBIOS they were proved on.** | A driver update can silently change voltage behaviour — it did in `595.71`. A profile whose stamp no longer matches is invalid until re-validated. |
| R7 | **Telemetry comes from `nvidia-smi` alone; no GUI monitoring app is ever a source.** | `GOAL.md` forbids a third-party GUI dependency, and the sensor HWiNFO64 was there for (hotspot / memory junction) is disabled at driver level on RTX 50 — this card returns `N/A` (`researches/03` §3.5). |
| R9 | **A GPU write that can take the display down is made only under an ARMED WATCHDOG.** | Asked for by the owner (2026-08-10) before the first positive offset. Every rollback KAGO had was a `finally`, and a `finally` is worth exactly as much as the process running it: a hung, killed or driver-blocked process runs none. `watchdog.mjs` writes an armed record and spawns a SEPARATE detached process that returns the card to factory on a deadline or on the writer's death — proved live, 2.5 s from an abrupt death to a restored card. It introduces NO new writer (it calls `profile-manager.resetToFactory`, `nvapi.writeVfOffset` and `nvapi.resetFansToAuto`), so R1 is untouched: this module decides WHEN, never HOW. Its undo is TOTAL, not differential — after a crash nobody knows what was applied, so the only honest undo is "return to factory", which is idempotent and cannot be wrong. |
| R9a | **The total undo covers every kind of state the project can write — and a new writable state EXTENDS the undo before its first write exists.** | Added 2026-08-10 with fan control. The undo had three steps (curve offsets, NVML domain offsets, clocks + power limit) and the fans would have been a fourth kind of state with nothing to restore it: a writer that died holding MANUAL left the fans pinned, and this card's own manual floor is 30 %, so "pinned" means the owner's idle machine audibly changes with no path back. The order is the rule — **the net before the jump**: the undo learned fans, mutation-proved (the mutation that KEEPS the step but makes it pin a level instead of restoring AUTO reddens that block alone), and only then was the first fan write run. Corollary for the selftest: the undo's steps are asserted BY NAME, never by a count — a count-only check stays green when a step is deleted and another duplicated. |
| **R10** | **THREE OF THE FOUR ROLLBACK LAYERS REQUIRE A LIVE OPERATING SYSTEM — so at depth, STEP SIZE is the only protection, and it acts BEFORE the state exists.** | Paid for on **2026-08-11**: a band sweep applied a deep whole-curve undervolt at a pinned 1100 MHz, and the machine hung for ~5 h 40 min. The writer's `finally` never ran (its process was never scheduled again), the detached watchdog never ran (a guard needs the OS too), Windows TDR did not fire (the hang was harder than a display timeout). What restored the card was the FOURTH layer — volatility plus the owner's reboot. **The generalisation, and it is not about GPUs: every undo this project owns is conditional on the machine surviving, and that condition is invisible until the day it fails.** Consequences now in code: `engine.pickAscentRungs()` refuses a first step deeper than `config.ASCENT_FIRST_STEP_MAX_MV` and a step-to-step jump beyond `ASCENT_STEP_MAX_MV`, **and it refuses BEFORE the first write** (proved by a block that counts writes and a mutation that removes the pre-write check). Consequence in process: an unattended sweep is never run on machinery that has not completed one full attended run. Full record: `bugs/03`, EXP-0039. |
| **R10a** | **A rollback with more than one duty is a LIST, never a chain.** | Same incident, second face. The atom's `finally` held five duties in sequence — prove the pin, release the clock, zero the curve, disarm the watchdog, unload the driver — so the first throw cancelled everything behind it, and a `ReferenceError` on its first line did exactly that. Two of those duties sat outside every `try`, so a failed curve-zeroing would have left the watchdog ARMED, firing later on a card nobody was holding. `vf-step.runUndo()` now runs each duty in its own `try`; a throw becomes a red block, never an exit. Order expresses PREFERENCE (a read that needs the state precedes the release that destroys it), not dependency. 16 offline blocks, three mutations. EXP-0040. |
| R8 | **The workload build locates its own toolchain.** | `nvcc` does not find an MSVC host compiler by itself, and a machine's PATH is not KAGO's to assume — `toolchain.mjs` resolves it via `vswhere`, with the x86-hosted cross compiler as a proven fallback (`researches/03` §2.1). |

## 3. Blast radius — what to check before you edit

| Editing… | Also affected | The check |
|---|---|---|
| `config.mjs` | everything — it is the shared constant table | re-run the last profile validation; a changed guardband invalidates measured profiles |
| `profile-manager.mjs` or any backend | `engine.mjs` (search results), `setup-desktop.mjs` (applied profiles), the tray reset path | write → read back → compare; refuse the profile if they differ |
| `stress-tester.mjs` | every past verdict | golden references were captured by the old code — a changed comparison invalidates them; recapture the baseline |
| `event-logger.mjs` | the crash half of every verdict | mutation-prove it: it must go red against a known TDR event, or it is not a detector |
| `desktop-shortcuts.mjs` / `setup-desktop.mjs` | the owner's Desktop and Task Scheduler | these touch the owner's environment — never run them to "see what happens" |

## 4. The joint that was open, and how the owner closed it

> **BUILT — phase 3 closed 2026-08-14 12:4x (judge: VERIFIED WITH CAVEATS, `plans/06` §4.6).**
> The design below is now standing machinery: 4 desktop `.lnk` (owner's names verbatim, Fluent
> Emoji 3D icons — his verdict after the render), 5 elevated apply tasks + `\KAGO\boot-apply`
> (logon re-apply through the same gates) + `\KAGO\tray` (unelevated, passive NotifyIcon reading
> the remembered-state file on a 2 s mtime timer). Kill-safety proven live: P3-AC4 = 0 settable
> diffs of 29 fields. Draft modes REFUSE until phase 6 qualifies them. The one open meter:
> P3-AC2's five natural logons, collecting in `runs/shell/boot-apply.jsonl`.

**Settled by the owner, 2026-08-09 (chat):** *"в трее делаем без кнопок, а просто показ статуса, а
сброс до заводских настроек — по третьему ярлыку с записью в автозагрузку"*.

The design is now three shortcuts and a passive tray:

**SUPERSEDED 2026-08-10 18:5x — there are FOUR shortcuts, not three.** The owner split the modes by their
objective functions (`GOAL.md` → «Четыре режима»; the long form is `MASTER_PLAN.md`). What changed
structurally: the old `Max Optimal` was one profile trying to serve two different optima, and it becomes
two modes. None of them uses a clock lock.

**AND AT 19:1x THE SAME EVENING THE APPLIER GAINED A SECOND LEVER, so the line "nothing in the applier
changes" no longer holds and is corrected here rather than left standing.** The owner sharpened
`Optimised`: FPS within 5 % of `Max Perfomance`, bought with a hard reduction in watts, heat and noise,
*«чтобы она молотила не на 300 Вт, а сильно ниже, и выше не поднималась»*. A raised curve with a clock cap
bounds consumption only indirectly, so `Optimised` additionally sets a **power limit** — which means the
applier composes the NVAPI backend (the curve) with the `nvidia-smi` backend (`-pl`) in one profile. R1 is
untouched (`profile-manager.mjs` remains the only writer, and it already owns both backends); what changes
is that a profile is no longer a single-backend artifact, and its rollback must undo BOTH parts — the same
totality rule R9a states for the watchdog. Range, measured: `-pl` moves 300 → 250 W only.

| Shortcut | Applies | Becomes the remembered boot state |
|---|---|---|
| 🚀 **Max Perfomance** | curve raised, ceiling at the curve's TOP — the gain goes into clock | yes |
| ⚖️ **Optimised** | curve raised, ceiling at the stock operating clock, **AND a power limit through `-pl`** — the only mode that uses two backends' levers at once | yes |
| ❄️ **Silent Cold** | curve raised, ceiling well below stock — the cold mode, ~10 % paid deliberately | yes |
| 🔄 **Stock Default** | factory — every offset to 0, `-rgc`, power limit back to default | yes |

**The tray icon displays the active profile and nothing else.** No menu, no buttons, no click
actions. It reads state; it never writes it.

**What this supersedes, stated plainly rather than dropped.** `GOAL.md` asks: *"Если убить её —
профиль сбрасывается, GPU переводится в режим по умолчанию"*. With a status-only tray that owns no
state, killing it no longer resets anything — the profile stays applied until a shortcut changes it.
The owner's later instruction is the more specific one and governs. **A killed tray now means the
owner loses the indicator, not the profile**, and the deliberate way back to stock is the third
shortcut.

**Why this is the better design, and not merely the easier one:** a process killed by Task Manager
runs no exit handler, so kill-detection would have needed a heartbeat, a watchdog, or a Job Object —
a second moving part whose failure mode is *resetting the GPU when nothing was wrong*. An explicit
shortcut has no failure mode at all. The safety property that actually matters is untouched:
profiles live in volatile GPU memory, so a reboot or a driver reload still returns the card to
stock without anyone doing anything.

**Consequence for the applier:** every shortcut, reset included, writes the same "remembered state"
record that the boot task reads. Reset is a profile like the other two — the stock one — not a
special case in the code.

## 5. Contours

| Contour | Boundary | Quality gate |
|---|---|---|
| **Search** | `engine.mjs`, `stress-tester.mjs`, `event-logger.mjs` — finds the safe voltage per point | a point is closed only with a three-way verdict and a sized guardband |
| **Apply** | `profile-manager.mjs` and its backends — puts a profile on the card | write → read back → match, else refuse |
| **Surface** | `setup-desktop.mjs`, `desktop-shortcuts.mjs`, the tray — what the owner touches | the owner can always reach factory state without the agent |
| **Safety net** | `watchdog.mjs` — the armed record, the detached guard, the total undo, the stale-record recovery | four layers, and each one's coverage is stated rather than assumed: the writer's `finally` · this guard (a hung/killed writer) · Windows TDR (defaults verified in the registry, deliberately unchanged) · volatility + reboot. The drill must fire it for real before any of it is believed. **See R10 — three of the four need a live OS, and 2026-08-11 proved it** |
