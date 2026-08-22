# Bug 29 — ladder exhaustion is reported through the ROLLBACK channel, so a measurement outcome halts the sweep

**Status:** 🔴 OPEN
**Version/build:** 0.9.0 · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** 2026-08-22 21:3x +03:00 — the owner's live tuning run `--sweep --from 2872 --to 2700`,
launched with him at the machine (S1 satisfied). The run halted after 308 s with **0 of 24 frequencies
closed**. Nothing was measured.

## Symptom

Every rung at 2872 MHz walked the `bugs/28` intensity ladder to its last step and then halted:

```
2872 МГц ← 1000 мВ (глубина −60 мВ)
  прожиг шёл на 2820 МГц вместо 2872 — ослабляю нагрузку (ступень 1 из 3) и жгу заново
  прожиг шёл на 2850 МГц вместо 2872 — ослабляю нагрузку (ступень 2 из 3) и жгу заново
  прожиг шёл на 2857 МГц вместо 2872 — ослабляю нагрузку (ступень 3 из 3) и жгу заново
  ОТКАТ НЕ ЧИСТ на 2872 МГц / 1000 мВ — 1 шаг(ов) не отработали: ПОТОЛОК 2872 МГц УСТОЯЛ ПОД
  НАГРУЗКОЙ. Следующая ступень стартовала бы на карте, состояние которой никто не может назвать,
  и это СТОП, а не вердикт о напряжении
```

The dry run for the SAME band had promised the opposite, in its own words:

> «Кончились ступени — это НАХОДКА, а не вердикт о другой частоте (bugs/28).»

## Repro (deterministic)

`npm run engine -- --sweep --from 2872 --to 2700` on this card. Any frequency the card will not
deliver under the lightest ladder step reproduces it. Cheaper reproduction without the card: a rung
whose `judgeDeliveredClock` returns `short` on every ladder step.

## Forensics

**The card was NOT left in a bad state.** Verified after the halt: watchdog not armed · curve top reads
factory `1240 mV → 3172.0 MHz` · control struct body all zeroes (6 non-zero words are the header:
version + four `-1` masks) · power limit 300 W default · card idle at 180 MHz / P5. `runUndo` gives
each duty its own `try` (R10a), so the throw did not cancel the real rollback duties.

**Why the card would not deliver 2872 MHz** — measured, not assumed. Telemetry during the run:

| time | clock | watts | pstate | throttle reasons |
|---|---|---|---|---|
| 21:30:07 | 2850 | 193 | P0 | `[]` |
| 21:30:10 | 2812 | 198 | P0 | `[]` |
| 21:30:12 | 2812 | 201 | P0 | `[]` |
| 21:30:18 | 2857 | 63 | P0 | `[]` |

The card is already in P0 and nothing throttles it; the heavier the burn, the lower the clock it will
hold. This matches the intensity ladder measured in session 36: **307 W→2820 · 303 W→2842 ·
272 W→2872 · 257 W→2872.** 2872 MHz is reachable only at ≲272 W.

## Root cause

`vf-step.mjs:912–984` — **the ceiling proof is a step INSIDE `runUndo`.** It is not a rollback duty:
it is a MEASUREMENT verdict (did the card stay under the cap, and did it reach the target). It was
placed there deliberately, because the proof is a read that must happen while the state still holds.

The proof throws on `!j.ok`, which covers two unrelated outcomes:

| outcome | what it means | what it should cause |
|---|---|---|
| `j.breached` — card went ABOVE the cap | the shipped shape did not hold | a real refusal |
| `j.short` — card never REACHED the target | a fact about silicon under this load | a FINDING, per `bugs/28` |

Both become a red **undo** block. R10a then applies its rule correctly — *a caller may not report work
as successful while an undo block is red; a rung whose rollback failed is `unknown`, and `unknown` is a
STOP* — and the sweep halts. `out.clockShortfall` exists precisely as «код отказа, по которому
развёртка переигрывает», so after the ladder is exhausted the shortfall is still on the rollback wire
with nothing left to retry.

**Two unrelated facts share one channel:** «the card's state cannot be described» (genuinely a STOP)
and «the card would not reach this frequency» (a finding). This is the class `bugs/27` and EXP-0104
already named — a later mechanism (`bugs/28`'s ladder) invalidated an earlier contract, and nothing
went red.

### The second, sharper consequence — the run made a FALSE statement about the card

Because the rung returned `unknown`, the seed was judged rejected and the run announced:

```
ЗАТРАВКА ОТВЕРГНУТА на 2872 МГц: 1000 мВ от соседки 2880 МГц дало вердикт НЕИЗВЕСТНО, а не PASS.
Монотонность на этом кремнии здесь НАРУШЕНА — это находка о карте, а не сбой прогона.
```

**Monotonicity was not violated.** The seed never got a voltage verdict at all — the rung failed on
frequency delivery. Reporting a mechanism failure as a silicon finding is the false-`[TESTED]` class
(`TESTING_FRAMEWORK.md`), and it is the more dangerous half of this defect: a halted run wastes an
evening, a false finding about the silicon would have been written down and believed.

## Fix plan

1. **Split the channel.** `j.short` must NOT travel as an undo failure. The ceiling proof stays where
   it is (the read must happen while the state holds), but its `short` outcome becomes a rung
   OUTCOME — `clockShortfall` — carried beside the verdict, never a red undo block. `j.breached`
   keeps throwing: that one really is a refusal.
2. **Ladder exhaustion closes the frequency as a finding**, exactly as the dry run advertises: the
   frequency is recorded as «not deliverable under burn», the sweep moves to the next frequency, and
   the report names how many frequencies ended that way.
3. **The seed's rejection must distinguish** «PASS not obtained» from «no voltage verdict was ever
   produced». Only the first is evidence about monotonicity; the second must say so.
4. **Guard, proved red first:** a rung whose every ladder step returns `short` must (a) not halt the
   sweep and (b) not produce any statement about monotonicity. Both assertions fail on today's code.

## Decisions made without the owner

<filled at closing>

## Links

`bugs/28` (the intensity ladder this defect rides on) · `bugs/27` (same class: one channel carrying two
facts) · `bugs/30` (the silence budget, found the same evening) · EXP-0104 (two correct rules disabling
each other) · R10a · `GOAL.md` → «🎚 ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ»
