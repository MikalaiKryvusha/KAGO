# Plan 09 — [WEAK-EXECUTOR] А7: honest acoustic ladder rerun — the owner has never heard the 30 % floor

> **Created:** 2026-08-14 12:5x +03:00 (agent; sliced under `ideas/02`)
> **Parent:** `plans/01_EPIC` §9 track А, step **А7** · `STATUS.md` fact 30 (the defect that
> mislabeled the first run's bottom rungs — FIXED in code, never re-run live)
> **Status:** 🟢 open — **owner-gated: runs ONLY when the owner says he is nearby and listening**
> **Outbound:** a trustworthy 30…100 % acoustic row → `STATUS.md` fact 29/30 update

**Executor profile:** weak model. One command, one gate, strict stop rules. This WRITES fan state
(under the watchdog, AUTO restored in `finally`) — it is the smallest owner-gated live step on
track А and unblocks nothing else, so it never preempts А2.

## 1. Goal vector

**Pain:** the first acoustic run's «100 %» rung sounded at 207 rpm and its «30 %» at 2907 rpm
(fact 30 — the check read the COMMAND, not the physics). The code now waits for an rpm PLATEAU
(`tools/fan-ladder.mjs` → `rpmSettled()`, mutation-proved), but the owner has still never heard
the 30 % floor honestly — and 30 % is his EVERYDAY background (his own correction, fact 29).
**Target:** one clean live ladder 30…100 % with the owner listening. **Type:** Achieve.

## 2. Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| AC1 | Every rung reached physically before it is announced | Scale: rungs announced off-plateau · Meter: the tool's own rpm plateau blocks · Target: 0 red |
| AC2 | Fans return to AUTO | Scale: post-run manual-mode residue · Meter: `npm run nvapi -- --fans` after · Target: controlMode AUTO, rpm falling to ambient |
| AC3 | The owner's ear got the honest row | Scale: rungs the owner heard mislabeled · Meter: his words in chat · Target: 0 complaints; his comments quoted into STATUS |

## 3. Steps

**Step 1 — the gate (hard).** In THIS chat, the owner has said he is at the machine and ready to
listen (any wording; quote it in your report). No quote → this plan does not start. This is rail
S1's shape: presence cannot be machine-checked.

**Step 2 — pre-check.** Run plan 08 (А0 ritual) first; all green. Then
`npm run nvapi -- --fans` — expect 3 coolers, controlMode AUTO. The tool itself refuses a hot
card; do not pre-cool manually.

**Step 3 — the ladder.**

```
npm run fanladder -- --period 15
```

Expect: rungs announced ONLY after the rpm plateau block goes green per rung; the 100 % cutoff
rings FIRST by design (tell the owner before starting — one short loud burst, then the row).
While it runs, relay each announced rung to the chat so the owner can name what he hears.

**Step 4 — after.** `npm run nvapi -- --fans` → AUTO restored (AC2). Quote every acoustic comment
the owner made, verbatim, into the report. If his words move any threshold (45 % / 60 %,
facts 29/34) — do NOT edit `GOAL.md`/`STATUS.md` yourself: report the quotes and stop (owner-canon
edits are the strong session's, per `ideas/02` slicing).

## 4. Stop rules

- The tool reds any block, or a rung's rpm never plateaus → STOP, `AUTO` is restored by its
  `finally`; verify with `--fans`, then `/report-bug` with the raw output. No second attempt in
  the same sitting.
- The owner leaves mid-run → let the current rung finish, then Ctrl-C is NOT the path: the tool
  finishes and restores; simply do not start the next run.
- Anything else asks for improvisation → STOP (`GPU_TUNING_RAILS.md` §4.3).
