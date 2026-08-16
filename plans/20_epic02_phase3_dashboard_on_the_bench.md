# Plan 20 — the run dashboard, proved on the VIRTUAL card before the live run

> **Created:** 2026-08-16 02:5x +03:00 (owner's word in chat: «делаем тестовый прогон на виртуальной
> видеокарте с поднятым визуализатором, который должен кормиться реальными данными от виртуальной
> видеокарты… движок должен кормить визуализатор своими реальными данными прогона»)
> **Parent:** `ideas/06_sweep_dashboard_and_freeze_detector.md` (owner-accepted look) · epic 02
> (`plans/13`) phase 3 — the first live sweep
> **Status:** 🟢 steps 4.1-4.7 done 2026-08-16 03:2x - the rehearsal ran and the owner watched it live;
> 4.8 (the freeze drill) is the one open step
> **Outbound:** the dashboard becomes phase 3's observation instrument · the telemetry model's
> calibration is a claim about the OWNER'S card and belongs in `STATUS.md` facts if it ever drives a
> decision

---

## 0. The goal vector

One command brings up a browser window that shows a REAL sweep running against the VIRTUAL card, fed
by two independent streams that are never blended:

| Stream | Source | What it feeds | Truthfulness |
|---|---|---|---|
| **card metrics** | the virtual card's own state (locked clock · serving voltage after the written offsets · whether a burn is in flight) | the four seven-segment displays ON the card: MHz · °C · fan % · W | SYNTHETIC — a model, calibrated on the project's own measured rows (fact 34+36), and labelled as a model in the UI |
| **run data** | the REAL `engine.sweepRange` — its `onEvent` seam, nothing parsed from console prose | the four tiles: frequency under test · voltage and depth from stock · stress-test progress · band coverage | REAL — this is the shipped engine, driven through the shipped seam |

Zero GPU writes. The owner's card is not touched, opened or read at any point.

## 1. Why the bench and not the live run

`ideas/06` puts the dashboard into phase 3, and phase 3 needs the owner at the machine. The bench
needs nobody — and it is the only place where the instrument can be proved BEFORE it is trusted at
three in the morning next to a machine that is about to hang. The freeze detector in particular can
only be honestly tested where a process is allowed to die: the bench already kills child processes
for real (trap T2, `allowProcessDeath`).

## 2. Done-criteria (acceptance, countable)

- **AC1.** `npm run bench -- --sweep --from N --to N` runs the REAL `sweepRange` over
  `benches/cards/rtx5070ti.json` and exits 0, with **zero** branches on "we are on a bench" inside
  `engine.mjs` (the existing `npm run contract` block keeps counting this).
- **AC2.** The card answers `telemetry()` with four quantities computed FROM ITS OWN STATE, and the
  model reproduces the project's four measured thermal rows (fact 34+36) within **±3 %** on watts,
  **±1 °C** on the equilibrium temperature and **±2 pp** on the fan. Not a claim — a self-test block
  over those rows. ✅ MET: measured residuals ±2 %, ±0.7 °C, ±1.6 pp (`vgpu --selftest`, 71 blocks).
- **AC3.** A pulse exists DURING the blocked burn: with `burnRealSeconds: true` the run emits a
  telemetry tick at least once a second while the stress test is running. This is the requirement
  `ideas/06` §2 states as the invariant of the whole instrument.
- **AC4.** The page's animation phase is a FUNCTION OF THE LAST PULSE, not of its own timer: the
  accepted keyframes are paused and driven by the pulse clock, with a bounded extrapolation leash
  named out loud in the page. No pulse → no movement beyond the leash.
- **AC5.** No pulse for `FREEZE_MS` → the page says ЗАМЕРЛО and names the frequency and voltage that
  were under test, taken from the last pulse.
- **AC6.** The dashboard is a SEPARATE process from the run (variant A of `ideas/06`), and it never
  writes: not to the card, not to the journal, not to the curve document.
- **AC7.** The pulse file is a GAUGE, not a record: single JSON object, rewritten in place, under
  `runs/` (gitignored). The record stays `runs/sweep/journal.jsonl` (R15) — the dashboard reads it
  and never writes a second log (`ideas/06` §4).

## 3. The seam, drawn once

```
process 1 — the run                       process 2 — the dashboard         the window
  engine.sweepRange (REAL, unmodified)      http 127.0.0.1:<port>             assets/dashboard/sweep.html
    ├── onEvent ─────────────► pulse ──► runs/dashboard/live.json ──► SSE ──► tiles · animation clock
    └── virtualCard.telemetry ┘ (ticks per second, INCLUDING inside the burn)
  sweep-journal.jsonl (the record) ─────────────────────────► read ─────────► verdict history
```

The file is the seam. On the LIVE path the same file is written by the separate telemetry sampler
(which already exists and already samples per second) instead of the virtual card — the dashboard
does not learn which it was, and that is the point.

## 4. Steps

- [x] **4.1 — the card gets synthetic telemetry.** `virtual-gpu.mjs`: a telemetry model over the
      card's own state. Power `P = P0 + load·k·f·V²` with `k`/`P0` FITTED to the four measured rows;
      fan `% = 30 + 2.4·(T − 55)` (that curve IS the four rows, and it is the card's own); temperature
      approaches its equilibrium with a time constant, because a plateau took 395–753 s on the real
      card (fact 35 — a transient is not an equilibrium, and a bench that jumped straight to the
      plateau would teach the operator the opposite of what the card does).
- [x] **4.2 — the pulse.** `run-dashboard.mjs`: one author of the pulse file's shape; `writePulse`
      is synchronous, because the burn blocks the event loop and an async write would be delivered
      after the hang it is supposed to report.
- [x] **4.3 — the tick inside the burn.** The card's `run()` already spends the seconds when asked
      (`burnRealSeconds`); slice that wait into one-second steps and call `onTick` in each, so the
      pulse exists exactly where the process is least able to speak.
- [x] **4.4 — the page.** `assets/dashboard/sweep.html`, built FROM the accepted mockup — the look is
      closed by the owner's word and is not reopened. What is added: the SSE subscription, the pulse
      clock driving the accepted keyframes, the freeze alarm, the four tiles bound to run data.
- [x] **4.5 — the server.** Serves the page, the logo, and `/live` as SSE. Read-only. Opens a
      minimalist Edge window (`--app`), reusing the proven launcher from the review contour.
- [x] **4.6 — the bench run.** `bench-run.mjs` (marked `KAGO-BENCH-OWN`): the real `sweepRange` over
      the virtual card, wired to the pulse. Journal in a run-local sandbox, curve document in memory —
      a bench that wrote into the project's real run artefacts would fabricate evidence (EXP-0025).
- [x] **4.7 — verification by observation.** Run it; watch it; screenshot the live page and LOOK at
      the picture (EXP-0046: a render is accepted by measurement, never by reading the code).
- [ ] **4.8 — the freeze, proved.** Kill the run mid-burn and watch the page stop and say ЗАМЕРЛО
      with the right frequency. A freeze detector that has never seen a freeze is decoration.

## 5. Risks, named before the build

- **The animation is a liar by default** (`ideas/06` §2). Mitigated by AC4; the leash is the honest
  residue and it is printed in the page's own comment, not hidden.
- **A second log.** Mitigated by AC7 — the gauge is not a record and cannot be mistaken for one: it
  has no history, it is one object, it is rewritten.
- **The telemetry model is fiction.** It is, and it says so: it is calibrated on the card's own
  measured rows and labelled СИНТЕТИКА in the UI. It must never be quoted as a measurement of the
  owner's card.
- **Scope creep into the live path.** The live sweep gets ONE optional flag (`--dashboard`) and no
  behaviour change without it. Everything else stays on the bench.
