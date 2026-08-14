# Bug 10 — the serving point drifts between reads, so the ratchet cannot accumulate depth across sessions

**Status:** 🔴 OPEN — proved by observation the moment it was looked for; NOT yet fixed
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

## Root cause — RANKED HYPOTHESES, not a conclusion

Not yet established, and it must not be guessed at — the fix differs completely per cause.

1. **The driver reports a state-dependent curve.** Most likely (Occam: three reads, three card
   states, three answers, monotone with temperature — 56 °C → 95, warm → 96, 41 °C → 94). If so the
   curve's mapping clock→point is genuinely not a constant, and the KEY is wrong, not the reading.
2. **`voltageForClock` picks a boundary point unstably** — e.g. `>=` vs `>` on a clock that sits
   between two points, so a sub-MHz difference in the read flips the answer. Cheap to check by
   reading the neighbouring points' clocks on one dump.
3. **The read is sampled during a P-state transition** and catches a partially-updated struct.
   `readVfOffsetsStable()` already exists for exactly this class on the offsets side, which suggests
   the project has met instability on this interface before.

## The fix is NOT "loosen the key" — stated because it is the tempting one

Widening the ratchet key (e.g. key by clock instead of point) would make tonight's evidence visible
again — and would also make a failure recorded at one point bound a search at another, which is the
defect `bugs/06` was opened to remove. That fix would trade a stalled search for an unsound one.
**Whatever the cause, the key stays as tight as the evidence justifies; what must change is either
the reading or what we key ON.**

## Repro (deterministic, read-only, free)

```
npm run engine -- --band 2842 --dry-run          # note the point index and stock mV
# let the card change temperature (a game run, or 20 minutes idle)
npm run engine -- --band 2842 --dry-run          # the point index moves
```

## Next step

Cause first, fix second (`BUG_FIXING_FRAMEWORK.md`: do not patch blindly). All three hypotheses are
testable **read-only, with zero GPU writes** — one curve dump plus the neighbouring points' clocks
distinguishes (2) from (1) immediately.

## Decisions made without the owner

- **Filed rather than fixed on the spot.** The cause is unknown, three hypotheses are live, and the
  tempting fix is the unsound one. Patching now would be the blind poke the framework forbids.
- **Tonight's five PASS rungs were left in the store as recorded, under point 96.** They are honest
  measurements; re-keying them to another point would be fabricated forensics (EXP-0025).

## Links

- `automation-engine/lib/vf-step.mjs` → `voltageForClock` · `automation-engine/lib/vmin-store.mjs` →
  `bestPassing`, `allowedOffset` · `automation-engine/engine.mjs` → `composeAscentLadder`
- `STATUS.md` fact 37 (the caveat this bug is the consequence of) · `bugs/06` (why the key is tight)
- `bugs/07` (the session bound whose convergence this breaks) · `bugs/08` (why history was empty)
