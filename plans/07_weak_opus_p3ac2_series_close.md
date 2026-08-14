# Plan 07 — [WEAK-EXECUTOR] Watch the P3-AC2 logon series and close it on the fifth record

> **Created:** 2026-08-14 12:5x +03:00 (agent; sliced under `ideas/02` — weak-model plans)
> **Parent:** `plans/06_DONE_epic01_phase3_shell.md` §4.4 (P3-AC2) · `plans/01_EPIC` §9 step Б4 ·
> `ideas/02` (slicing criteria)
> **Status:** 🟢 open — the journal collects itself; this plan is the WATCH and the CLOSURE
> **Outbound:** on closure — epic §9 Б4 ✅ · `STATUS.md` phase-3 row loses its «открытый прибор» rider

**Executor profile:** a weak model strong at following steps. Zero owner decisions inside. Zero
GPU writes. Read `GPU_TUNING_RAILS.md` §0–§1 first; if anything below diverges from what you
observe — STOP and report, do not improvise.

## 1. Goal vector

**Pain:** the epic's AC2 («a logon arrives at the remembered profile or at factory — never at an
unverified intermediate») is proven as a MECHANISM but not as a SERIES: the journal needs 5
natural logons, and nobody forces reboots. **Target state:** 5 consecutive natural-logon records,
each a verified terminal verdict, and the canon updated. **Type:** Achieve.

## 2. Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| AC1 | Series complete | Scale: natural-logon records with verified verdicts · Meter: `runs/shell/boot-apply.jsonl` · Target: **5 consecutive** (manual `schtasks /run` records DO NOT count — only records whose timestamp matches a real system logon) |
| AC2 | Every record is a terminal verdict | Scale: records with verdicts outside the 8-word list (`GPU_TUNING_RAILS.md` §3) · Meter: reading the journal · Target: 0 (any other string → file a bug, `/report-bug`) |
| AC3 | Canon closed | Scale: canon spots still naming the series open · Meter: grep below · Target: 0 |

## 3. Steps

**Step 1 — check the meter (run at every session start; repeat until 5).**

```
node -e "const j=require('fs').readFileSync('runs/shell/boot-apply.jsonl','utf8').trim().split(/\r?\n/).map(JSON.parse); j.forEach(r=>console.log(r.at, r.verdict, r.powerLimitW)); console.log('records:', j.length)"
```

Expect: one line per record, `records: N`. Baseline at plan creation: **2 records
(2026-08-14 09:46 / 09:47) — both MANUAL mechanism runs, they do not count toward the 5.**
Natural = the record's `at` falls at a real boot/logon (cross-check if unsure:
`Get-WinEvent -FilterHashtable @{LogName='System'; Id=6005} -MaxEvents 5` in PowerShell —
eventlog start ≈ boot time; run it from the PowerShell tool, never Git Bash).

**Step 2 — judge each new record.** Verdict must be one of the 8 terminal words. `applied` /
`factory-by-physics` / `factory-restored` = verified good. `degraded-to-factory` /
`no-remembered-state` = good (factory stands), note why. `driver-gave-up` / `apply-failed-rolled-back` /
`remembered-unreadable` = the series still counts the logon as VERIFIED (the state is named and
factory physics stands) **but file a bug doc for the cause** (`/report-bug`) — then continue.

**Step 3 — when the count of natural verified records reaches 5, close the canon (exact edits):**

1. `plans/01_EPIC_kago_orchestrator.md` §9: row **Б4** — replace the 🟡 marker with ✅ and the
   closure cell with `✅ <date>: AC2 5 из 5 — журнал runs/shell/boot-apply.jsonl`.
2. `STATUS.md` phase-table row «3 — Четыре ярлыка + трей»: remove the «один открытый прибор…»
   rider, leave «✅ ЗАКРЫТА … СВЕРЕНО С ОГОВОРКАМИ · AC2 5/5 <date>».
3. `STATUS.md` «Шесть вещей» item 6: replace the last two sentences (open-meter ones) with
   «Серия P3-AC2 закрыта <date>: 5 из 5 естественных входов, все вердикты терминальные.»
4. This plan: append `## ✅ STATUS: DONE (<date>)` with the 5 records quoted, then
   `git mv plans/07_weak_opus_p3ac2_series_close.md plans/07_DONE_weak_opus_p3ac2_series_close.md`.

**Step 4 — verify and ship.**

```
npm run check          # expect: 31 .mjs files (or more), 0 failed
git diff --stat        # expect: ONLY the files named in step 3
```

Commit `docs(shell): P3-AC2 series closed — AC2 5/5` + the model co-author trailer; push.

## 4. Stop rules

- A record with a verdict word not in the list → STOP after filing the bug; do not close.
- Any edit target line not found verbatim → STOP and report (the canon moved; a strong session
  re-anchors this plan).
- Nothing in this plan writes to the GPU; if a step seems to need it, you misread — STOP.
