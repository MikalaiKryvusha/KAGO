# KAGO — external structure map

> **What lives where, and what a stranger sees.** The outside view of the tree: directories, their
> purpose, and the artefacts KAGO produces. The *relations* between modules — who calls whom, what
> breaks what — live in `PROJECT_ARCHITECTURE_INTERNAL_MAP.md`.
>
> Living reference — never `DONE`-tagged. Updated: 2026-08-09.

---

## 1. Current state of the tree

KAGO is at the end of its **phase 0**: the framework is deployed, the research base is written, the
architecture is decided — and no orchestrator code exists yet. The tree below marks what is on disk
today (**·live·**) against what `MASTER_PLAN.md` will add (*planned*).

```
KAGO/
├── README.md                     ·live·  bilingual storefront (RU + EN)
├── LICENSE                       ·live·  MIT
├── GOAL.md                       ·live·  the owner's vision — the source of every constraint
├── MASTER_PLAN.md                ·live·  phases 0–6, decision log
├── RTX_5070Ti_..._Master_Plan.pdf ·live· the owner's original brief, committed verbatim
├── package.json                  ·live·  scripts: check · gpu:info · kaif:*
│
├── tools/                        ·live·  standalone operator utilities
│   ├── check.mjs                 ·live·  the build gate — parses every project .mjs
│   └── gpu-info.mjs              ·live·  read-only probe of the GPU's tunable envelope
│
├── automation-engine/            planned the orchestrator itself (layout fixed by the owner's PDF)
│   ├── config.mjs                planned every threshold, step size and guardband, named
│   ├── engine.mjs                planned the Vmin sweep loop
│   ├── setup-desktop.mjs         planned profiles → shortcuts → autostart → tray
│   └── lib/
│       ├── hardware-mon.mjs      planned telemetry (nvidia-smi, HWiNFO64 CSV)
│       ├── profile-manager.mjs   planned APPLIES profiles — interface over swappable backends
│       ├── stress-tester.mjs     planned workload runner + golden-reference comparison
│       ├── event-logger.mjs      planned Windows Event Log watch (TDR / WHEA / BSOD)
│       └── desktop-shortcuts.mjs planned .lnk generation via WScript.Shell
│
├── profiles/                     planned measured profiles, bound to driver + VBIOS
├── logs/ · runs/                 planned telemetry and sweep artefacts — git-ignored
│
├── researches/                   ·live·  recon before code
│   ├── 01_gpu_control_paths.md   ·live·  can it be done without MSI Afterburner — and how
│   └── 02_vmin_guardband_...md   ·live·  the per-point Vmin search and the safety margin
├── plans/ · ideas/ · bugs/ · interviews/ · homeworks/ · reports/   ·live· KAIF working dirs
│
└── (KAIF canon: AGENT_GUIDE · PHILOSOPHY · STATUS · EXPERIENCE · the frameworks · .kaif/ · skills)
```

## 2. What KAGO produces

| Artefact | Where | Who reads it |
|---|---|---|
| Two desktop shortcuts — *Max Optimal*, *Silent Cold* | the owner's Desktop, as `.lnk` | the owner, by double-click |
| A tray icon showing the active profile | the notification area | the owner, at a glance |
| Measured profiles, stamped with driver and VBIOS | `profiles/` | `profile-manager.mjs` at boot and on switch |
| Sweep logs and telemetry | `logs/`, `runs/` — git-ignored | the agent, when a profile misbehaves |
| Golden references from the stock run | `runs/baseline/` | `stress-tester.mjs`, for every stability verdict |

## 3. Boundaries worth stating

- **`tools/` is not `automation-engine/`.** `tools/` holds things an operator runs by hand and that
  never touch GPU state. The engine is the thing that writes. Keeping the read-only utilities out of
  the engine is what makes them safe to run at any moment.
- **Nothing in the tree is portable to another machine.** Measured profiles encode one specific
  card's silicon; card-to-card Vmin differs by up to 70 mV (`researches/02`). The repository ships
  the *method*, never someone else's numbers.
- **The owner's private voice portrait is not here and must never arrive.** It lives in
  `d:\work\krinik_voice\`; `.gitignore` carries `AUTHOR_STYLOMETRY.md` so a stray copy cannot ship
  from this public repository.
