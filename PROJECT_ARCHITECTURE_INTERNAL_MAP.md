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
| R4 | **A stability verdict needs BOTH `stress-tester` and `event-logger`.** | Crash detection alone misses silent data corruption, which is the majority failure mode (`researches/02`). |
| R5 | **Every write has its rollback in the same module.** | A function that changes hardware and cannot undo itself does not ship. |
| R6 | **Profiles carry the driver and VBIOS they were proved on.** | A driver update can silently change voltage behaviour — it did in `595.71`. A profile whose stamp no longer matches is invalid until re-validated. |
| R7 | **Telemetry comes from `nvidia-smi` alone; no GUI monitoring app is ever a source.** | `GOAL.md` forbids a third-party GUI dependency, and the sensor HWiNFO64 was there for (hotspot / memory junction) is disabled at driver level on RTX 50 — this card returns `N/A` (`researches/03` §3.5). |
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

**Settled by the owner, 2026-08-09 (chat):** *"в трее делаем без кнопок, а просто показ статуса, а
сброс до заводских настроек — по третьему ярлыку с записью в автозагрузку"*.

The design is now three shortcuts and a passive tray:

| Shortcut | Applies | Becomes the remembered boot state |
|---|---|---|
| 🚀 **Max Optimal** | the sweet-spot profile | yes |
| ❄️ **Silent Cold** | the deep-undervolt profile | yes |
| ⏹ **Reset to factory** | stock — `-rgc`, power limit back to default | yes |

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
