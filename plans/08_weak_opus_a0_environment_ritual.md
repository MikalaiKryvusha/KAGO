# Plan 08 — [WEAK-EXECUTOR] А0: the environment ritual — prove the bench before trusting it

> **Created:** 2026-08-14 12:5x +03:00 (agent; sliced under `ideas/02`)
> **Parent:** `plans/01_EPIC` §9 track А, step **А0** · `GPU_TUNING_RAILS.md` §1
> **Status:** 🟢 open — a REPEATABLE ritual, run at the start of any autonomous loop iteration
> and before any track-А work; DONE-tagged only if А0 is retired from the epic
> **Outbound:** a red probe → bug doc + report; green → one line in the session report

**Executor profile:** weak model, strict step-following. Zero owner decisions. Zero GPU writes —
every command here is read-only toward GPU state.

## 1. Goal vector

**Pain:** a session that assumes the bench (driver version, parse-clean tree, free card, valid
goldens) builds on sand — R6 says a driver change silently invalidates every golden and NVAPI id.
**Target:** the environment proven green by observation, or the exact red probe named. **Type:**
Maintain.

## 2. Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| AC1 | All probes run, each judged against its expected line | Scale: probes skipped or eyeballed · Meter: the transcript · Target: 0 |
| AC2 | A mismatch is reported, never worked around | Scale: mismatches silently accepted · Meter: report vs transcript · Target: 0 |

## 3. Steps — run all six, compare each against «expect»

```
npm install
```
Expect: exits 0 (koffi present).

```
npm run check
```
Expect: `checked 31 .mjs file(s), 0 failed` (a HIGHER file count is fine; any `failed` > 0 → STOP).

```
npm run gpu:info
```
Expect: driver **610.88** · VBIOS **98.03.58.40.8b** · power limit 250–300 W · max clock 3090 MHz.
**Driver ≠ 610.88 → STOP, report R6: all goldens/ids invalid until re-proved. Do not re-capture
anything yourself.**

```
npm run watchdog -- --status
```
Expect: `СТОРОЖ НЕ ВЗВЕДЁН — ничего не держит карту.`
If a record is held → run `npm run watchdog -- --recover`, then re-run `--status`, report what was
recovered (this is the ONE state-changing command in this plan, and it only ever restores factory).

```
npm run stress -- --verify-baseline
```
Expect: every baseline stamp matches the card. On a fresh clone: baselines ABSENT is the expected
honest answer — report it, do NOT run `--capture-baseline` (that needs a proven-stock card and a
strong session's judgement).

```
npm run questions
```
Expect: `ИТОГ: ЧИСТО`.

## 4. Report form (paste, fill)

```
А0 environment ritual <date>:
check 31/0 ✓ · driver 610.88 ✓ · watchdog clear ✓ · baselines valid ✓ · questions clean ✓
(or the exact failing line + probe name)
```

## 5. Stop rules

- Any «expect» mismatch not covered above → STOP, `/report-bug`, quote the raw output.
- 3 attempts at anything → STOP (`BUG_FIXING_FRAMEWORK.md`); this ritual has no third attempt —
  probes either pass or are reported.
