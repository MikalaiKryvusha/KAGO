# Bug 10 — the serving point drifts between reads, so the ratchet cannot accumulate depth across sessions

**Status:** ✅ DONE — cause measured, evidence re-keyed to absolute millivolts, proved on the real
store (the same command that printed «истории НЕТ» now inherits «доказано до 1020 мВ»)
**Version/build:** driver 610.88 · VBIOS 98.03.58.40.8b · `engine.mjs` at commit `161c0f3`
**When/context:** 2026-08-14 23:2x…23:4x +03:00, immediately after the first successful bounded live
sweep (A2 re-run). Found while verifying the rollback, not while looking for it.

## Symptom — and it is observed, not inferred

`voltageForClock(curve, 2842)` resolved to a DIFFERENT curve point on three reads of the same card
within 90 minutes, with no offsets applied on any of them:

| when | card state | point | stock mV | rungs the plan built |
|---|---|---|---|---|
| 22:04 | 56 °C, P3 | **95** | 1045 | 39 |
| 23:22 (sweep start) | warm, under the run | **96** | 1050 | 40 |
| 23:3x (after rollback) | 41 °C, P5 | **94** | 1040 | 38 |

The live sweep then recorded five PASS rungs down to −30 mV **under point 96**. The very next dry
run — same command, same card, same shape, offsets verified zero — printed:

```
ГЛУБИНА СЕССИИ: истории НЕТ (карта «без истории»), отсчёт от стока · потолок −30 мВ
```

**We had just proven −30 mV, and the engine could not see it.**

## Why this is the bug that decides the whole plan

The recovery plan after `bugs/08` destroyed the store is explicitly *«путь к измеренным −185 мВ
придётся пройти заново, по сессии за раз»* — every session inherits the previous session's proven
depth and extends it by one bounded excursion (`SESSION_MAX_DEPTH_BEYOND_KNOWN_MV = 30`).

**That plan requires the inheritance to work.** The ratchet is keyed by POINT INDEX
(`bestPassing(records, point)`, `allowedOffset(records, point)`) — `STATUS.md` fact 37 already flags
this as a caveat about temperature. What was never stated is the CONSEQUENCE: if the point that
serves 2842 MHz drifts by ±1 between sessions, each session starts from "no history", walks to
−30 mV, and stops. **Depth never accumulates. The search would never reach the edge — not in six
sessions, not in sixty.**

Tonight's run is the proof: it did exactly the right thing, and its result is already invisible.

## Root cause — MEASURED, hypothesis 1 confirmed, 2 and 3 refuted

**Probe:** `scratchpad/probe-curve-drift.mjs`, read-only, zero GPU writes. Eight dumps at held state,
then twelve while the card heated under a compute load and cooled back.

**Hypothesis 3 (unstable read) — REFUTED first, and cheaply:** eight consecutive dumps with the card
held still gave ONE curve and ONE pick (point 95, 1045 mV), byte-identical. The read is stable.

**Hypothesis 2 (boundary flip in `voltageForClock`) — REFUTED, though the boundary is real:** point
95 does sit at *exactly* 2842 MHz, so the selection is indeed decided on the `p.mhz >= clockMhz`
boundary. But the neighbourhood dumps show the whole table moving underneath it, not the comparison
misbehaving.

**Hypothesis 1 (state-dependent curve) — CONFIRMED, and the mechanism is clean:** the curve slides
along the FREQUENCY axis with temperature while the VOLTAGE axis stays fixed. The voltage column was
identical in all four distinct dumps (1025 · 1035 · 1040 · 1045 · 1050 · 1060 · 1065 · 1070); only
the clocks moved.

| temperature | point 92's clock | serves 2842 MHz | its voltage |
|---|---|---|---|
| 41…42 °C | 2820 MHz | point **94** | **1040 mV** |
| 43…50 °C | 2805 | point **95** | **1045 mV** |
| 60 °C | 2797 | point **96** | **1050 mV** |
| 61…63 °C | 2782 | point **97** | **1060 mV** |

≈ **−1.7 MHz per °C**, i.e. **+20 mV over 22 °C** for the same 2842 MHz. It tracks TEMPERATURE, not
p-state: 50 °C in P0 and 43…46 °C in P3 both land in the same family. This is ordinary GPU Boost
behaviour — the finding is not that it happens, but that the evidence store was keyed on a name it
invalidates.

**This was already known as PROSE and that is why it kept costing.** `STATUS.md` fact 37 says a
failure taken at one temperature does not bound a search begun at another; `GOAL.md` carries the
owner's own note about thermal inertia. The owner said it plainly when this bug was being measured:
*«кривая ползает, мы это уже 1000 раз узнавали!»* — and he was right. What was missing was never the
knowledge; it was that no KEY and no BLOCK enforced it (`EXPERIENCE.md` rule: two strikes → a
mechanism, never a third reminder).

## The fix — key the evidence by the axis that does not move

Not "loosen the key" (the tempting one, and it is wrong: keying by clock alone would let a failure at
one point bound a search at another — the very defect `bugs/06` removed). **Key by the ABSOLUTE
VOLTAGE**, which the measurement above shows is the one axis temperature does not touch, and which
is what stability is physically about anyway.

1. **`vmin-store.allowedVoltageMv(records, capMhz)`** — never at or below the lowest voltage that
   ever failed at this cap; allowance is `lowestFailureMv + one grid step`. Forever, at any
   temperature. A write-ahead mark that never came back is honoured through its `plannedMv`.
2. **`vmin-store.bestPassingMv(records, capMhz)`** — the LOWEST voltage ever passed: the ground a new
   session inherits. A `min` where the old `bestPassing` was a `max`, because deeper is lower.
3. **`engine.markAhead` now records `plannedMv`** — the rung's intended voltage. Without it, a run
   that dies leaves a mark that forbids nothing in the new unit, which is the mark's whole job.
4. **`composeAscentLadder` decides in absolute volts** — a session floor of
   `provenMv − SESSION_MAX_DEPTH_BEYOND_KNOWN_MV`, and the ratchet floor from every failure. Depth
   from stock is now only a RENDERING for the reader, because stock itself slides.
5. **The report line prints the absolute volt beside the depth**, since the volt is what the next
   session inherits.

**The honest caveat, recorded rather than buried:** hotter silicon needs more voltage, so a PASS at
1020 mV taken warm does not PROVE 1020 mV when hotter still. The direction that matters is
conservative — a FAILURE forbids that voltage and everything below it, forever, at any temperature.
The optimistic direction is bounded by three things already standing: every verdict is taken under
sustained load (hot by construction), a session may only descend 30 mV past proven ground, and
beyond proven ground the step is fine. Records carry `tempStartC`/`tempReachedC` so this stays
auditable.

## Verification

- `npm run check` 33/0 · `vmin-store --selftest` 38 blocks · **`engine --selftest` 73 blocks** (was
  70), all green.
- **New guard, mutation-proved (addressee 21, named before the run):** «УЛИКА ПЕРЕЖИВАЕТ СПОЛЗАНИЕ
  КРИВОЙ» — evidence filed under point 96 on a hot card must be found by a session that resolves the
  same clock to point 94 when cold. Mutation «re-key the inherited evidence by point index» (the
  pre-fix behaviour) reddens it and its companion, and nothing else:
  - `УЛИКА ПЕРЕЖИВАЕТ СПОЛЗАНИЕ КРИВОЙ` → got null, wanted 1020
  - `и сессия наследует ЗЕМЛЮ, а не начинает от стока заново` → got 1010, wanted 990
- **Proved on the REAL store, which is the check that matters:** the command that printed «истории
  НЕТ» minutes earlier now prints
  `ГЛУБИНА СЕССИИ: доказано до 1020 мВ (−25 от стока 1045) · пол сессии 990 мВ · эта сессия дойдёт
  до 990 мВ и остановится САМА · ступеней в прогоне 6`. Tonight's five rungs are inherited.

## Decisions made without the owner

- **Re-keyed rather than filed as a question.** Choosing the evidence key is method, and method is
  the agent's (EXP-0026). The owner's input was the correction that we already knew the curve moves.
- **Tonight's records were NOT rewritten.** They already carried `capMhz` and `servingMv`, so the new
  key finds them as they are. Nothing was back-filled; a record with no measurement behind it is
  fabricated forensics (EXP-0025).
- **The old point-keyed `allowedOffset`/`bestPassing` were kept, not deleted.** They still serve the
  ungraded ladder path and every offline fixture that has no voltage axis. The voltage key applies
  where a graded ladder exists, which is every live run.
- **The caveat about hot-vs-cold PASSes was written down instead of being engineered away.** Making
  the key temperature-aware as well would be a second unproven model; the bounds already in place
  cover the optimistic direction, and the record carries the temperatures for whoever revisits it.

## Links

- `automation-engine/lib/vf-step.mjs` → `voltageForClock` · `automation-engine/lib/vmin-store.mjs` →
  `bestPassing`, `allowedOffset` · `automation-engine/engine.mjs` → `composeAscentLadder`
- `STATUS.md` fact 37 (the caveat this bug is the consequence of) · `bugs/06` (why the key is tight)
- `bugs/07` (the session bound whose convergence this breaks) · `bugs/08` (why history was empty)
