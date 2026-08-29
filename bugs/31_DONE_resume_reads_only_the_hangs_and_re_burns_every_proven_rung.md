# Bug 31 — the resume reads only the HANGS from the journal, so every reboot re-burns the whole descent

**Status:** 🔴 OPEN
**Version/build:** 0.9.0 · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** 2026-08-22 22:2x +03:00 — resuming the band `2820…2700` after the machine hung at
2820 MHz / 850 mV. Found by the owner watching the window: *«а почему всё опять началось с 2820? ведь
её уже нашли край»*.

## Symptom

The resumed run closed the orphaned intent correctly and recorded the wall:

```
ЗАВИС: 2820 МГц / 850 мВ
ПОЛ ЗАВИСАНИЯ: 2820 МГц уже вешала машину на 850 мВ — спуск туда больше не идёт
```

…and then **started the descent of 2820 MHz again from 995 mV**, although the SAME journal holds a
PASS of that frequency at **870 mV** from eleven minutes earlier. About eleven already-proven rungs
are burned a second time — 6–8 minutes per resumed frequency, on a card that must be undervolted to
do it.

## Repro (deterministic)

1. Run `--sweep --from <F> --to <M>`; let a rung hang the machine (or kill the writer so an intent is
   orphaned).
2. Reboot, run the same command.
3. Observe: the hang is closed and becomes a floor, and the descent of `F` restarts from the seed
   rather than from the deepest PASS the journal holds for `F`.

## Forensics

`sweep-journal.resumeState` returns exactly:

```js
{ hung, floors, blocked, truncated, nextSeq, attempted }
```

`hangFloors` · `blockedRungs` · `attributions` · `corrections` all exist. **No exported function
answers «what is the deepest rung of frequency F that PASSED».** The journal records verdicts of both
kinds — `outcome: "passed"` lines are right there — but nothing reads them back.

Evidence from this incident, same journal:

| seq | state | frequency · voltage | outcome |
|---|---|---|---|
| 623 | verdict | 2820 МГц | passed (870 mV served) |
| 624 | verdict | 2820 МГц | passed (870 mV served, 860 ordered) |
| 625 | intent | 2820 МГц · 850 мВ | — → closed as `ЗАВИС` on the next launch |

## Root cause

The resume path was built around the question *«what may the descent NOT touch»* (`bugs/23`, R18) and
answers it completely. It never grew the mirror question *«what has the descent already PROVEN»*.
Two consequences, and the second is the expensive one:

1. **The starting ground is wrong.** Rail S2 says depth is measured from what EVIDENCE has proven
   (`provenSavedMv`; with no evidence, proven ground = stock). Evidence exists for this frequency and
   is not consulted, so the descent falls back to the neighbour's seed.
2. **The frequency cannot close without a fresh PASS.** The owner's margin needs both brackets — the
   hang above (present) and the deepest PASS below (in the journal, invisible to the code) — so
   `refineEdge` has nothing to bracket with and the run must re-earn a PASS by burning.

**Why it matters more than it looks:** the owner made a hang a NORMAL path (`GOAL.md` → «ЗАВИСАНИЕ —
ОСОЗНАННЫЙ РИСК»), so reboots are the currency this search is paid in. A defect that re-costs a full
descent per reboot roughly DOUBLES the price of the epic.

## Fix plan

1. **Expose the evidence.** `sweep-journal.provenRungs(records)` → per frequency, the deepest voltage
   with `outcome: "passed"`, keyed by FREQUENCY + VOLTAGE like everything else (R15c). Add it to
   `resumeState`.
2. **Use it as ground.** The descent of a resumed frequency starts from its own deepest PASS, not the
   neighbour's seed. The first-step guard is untouched — it is written about proven ground, and this
   makes the ground true instead of pessimistic.
3. **Use it as the inner bracket.** A frequency whose journal holds both a PASS and a hang above it
   closes as `edge-found` WITHOUT burning anything: the margin rule applies to the deepest PASS.
   In this incident that closes 2820 MHz at 875 mV immediately.
4. **Guard, proved red first:** a journal with a PASS at V and a hang at V−Δ must close the frequency
   with zero burns. Mutation: stop reading the passes → the block must redden on the burn count.

## Decisions made without the owner

<filled at closing>

## Links

`bugs/23` (the resume path this extends) · `bugs/29` · R15 (write-ahead journal) · R18 (a recorded
hang is a wall) · rail S2 (`GPU_TUNING_RAILS.md`) · `plans/25` шаг 1.4a

## STATUS: DONE (2026-08-29 10:0x, session 61 backlog revision, EXP-0170 class)

Fix commits `b9529e2` («вторая половина памяти — что частота уже ДОКАЗАЛА») and `8d2e72a`
(«частота с уже зажатым краем ПРОПУСКАЕТСЯ, а не жжётся заново»); the engine cites this ticket
at the wiring sites («ЧТО ЧАСТОТА УЖЕ ДОКАЗАЛА (bugs/31)», engine.mjs:3225, :3860) and
`provenRungs` is threaded through the resume path. The follow-up refinement of the proven
ground (deepest vs latest) was its own ticket and is closed: bugs/36 DONE. Ticket lagged the code.
