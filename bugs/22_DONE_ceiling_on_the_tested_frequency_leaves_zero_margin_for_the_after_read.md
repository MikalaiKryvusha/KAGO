# Bug 22 — the ceiling sits ON the tested frequency, so the AFTER re-read has ZERO margin and the sweep halts as soon as the card warms

**Status:** ✅ DONE — fixed `dda17a6`, and the live run walked straight past the halt point
**Version/build:** `main` @ `fbe0e78` · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** 2026-08-16 22:29–22:31 +03:00, the live sweep
`engine --sweep --from 2887 --to 900 --max-depth 100 --dashboard`. Halted after **2 closed
frequencies of 266 (0.8 %)**, 123 s in. The card passed every burn; it did not misbehave once.

## Symptom

```
2872 МГц ← 1035 мВ (глубина −25 мВ)
таблица уехала: 1035 мВ обслуживало 2812 МГц, теперь 2835 МГц — ступень считается по СВЕЖЕЙ таблице
ступень 2872 МГц / 1035 мВ прошла с вердиктом PASS, но карта НЕ сказала, какое напряжение
обслуживало частоту после записи — отсутствие наблюдения не является наблюдением совпадения
ОСТАНОВЛЕНО (halt): … исход «void»
```

The rung PASSED. The guard (`engine.mjs:722`) then refused to record it, correctly: it will not
treat the absence of an observation as an observation of agreement.

**What was banked before the halt:** 2880 МГц → 970 мВ and 2872 МГц → 965 мВ, both driven to the
full −100 mV depth cap, both `lever-limited`. The card was left factory-clean (watchdog disarmed,
curve reads 180…3172 MHz, power limit 300 W).

## Root cause — MEASURED, not reasoned

`engine.mjs:680` takes the re-assertion from the atom:

```js
record.servingMvAfter = atom?.undervolt?.after?.mv ?? null;
```

`vf-step.mjs:673–678` computes it at `measuredAtMhz = pinMhz ?? capMhz` — and with the pin retired
(`researches/11`: the lock holds only downward), `capMhz` **is the ordered frequency itself**. The
lookup is `voltageForClock` (`vf-step.mjs:235`), which requires a point with `p.mhz >= clockMhz`.

**The margin at that comparison is exactly zero, by construction.** Probed offline against the live
factory curve (read-only, no writes — `buildRaiseAndCapVector` + `voltageForClock` in memory):

| cap | raise | curve top after the write | gap to cap | serves the cap? |
|---|---|---|---|---|
| 2880 | +45 / +52 / +60 / +75 | **2880.0** | **0.0** | yes — 1040 / 1040 / 1035 / 1025 mV |
| 2872 | +45 / +52 / +60 / +75 | **2872.0** | **0.0** | yes — 1040 / 1035 / 1035 / 1020 mV |

The cap arithmetic lands the top precisely on the ceiling — **the margin is 0.0 MHz by
construction.** Now slide the table down (R14b: the factory table moves ≈ −1.7 MHz/°C along the
FREQUENCY axis):

| cap | table slid down by | curve top | serves the cap? |
|---|---|---|---|
| 2872 | 0 | 2872.0 | 1035 mV |
| 2872 | **7 MHz — ONE grid step (≈ 4 °C)** | 2865.0 | **NOTHING → halt** |
| 2872 | 15 MHz | 2857.0 | **NOTHING → halt** |
| 2880 | 7 MHz | 2873.0 | **NOTHING → halt** |

So the halt is not a rare race: **one grid step of movement is enough**, and this run's own log shows
the table moving **23 MHz between the plan and the fresh read** («1035 мВ обслуживало 2812 МГц,
теперь 2835 МГц»). Re-running cannot fix it; it only buys the two or three coldest frequencies each
time.

**WHERE THE MOVEMENT HAPPENS — corrected, because the first reading of this was wrong and a wrong
diagnosis is worse than none.** `curveAfter` is read at `vf-step.mjs:629`, and the burn runs at
`:754` (ordering confirmed independently by the stack trace preserved in `bugs/19`). So it is NOT
this rung's own burn that moves the table under the re-read — it is everything before it: the card
carries the heat of the previous rungs, and the table moves between the read the raise was COMPUTED
from and the read the answer is LOOKED UP in. What is certain without resolving which millisecond
did it: **the halt logically entails that the actual top landed below the ordered frequency**, and
with a designed margin of exactly zero, any cause at all — drift, grid snapping, offset granularity —
produces it. The fix below is correct under every one of them, which is why it does not wait on
telling them apart.

## The evidence the run threw away — a second, smaller defect in the same place

The atom MEASURED the actual ceiling (`out.highestOfferedMhz`, `vf-step.mjs:644–652`) and the halt
message does not carry it. So the run stopped saying «the card did not say which voltage served the
frequency» while holding, one field away, the number that explains why — and nothing persists it:
`runs/sweep/journal.jsonl` and `runs/dashboard/live.json` contain no atom blocks. A guard that names
what is MISSING but not what WAS THERE forces the next session to re-derive the diagnosis from
scratch, which is what this document just cost. The fix must put `highestOfferedMhz` into the halt
line.

**Why this is a NEW defect and not `bugs/16` again.** `bugs/16` is the same physical drift striking
the **plan** (rungs computed against a cold table); it was fixed by re-reading the table before every
rung, and that fix works — the log's «таблица уехала … ступень считается по СВЕЖЕЙ таблице» lines are
it working. This is the drift striking the **re-assertion**: the AFTER read asks a question that the
write itself made unanswerable-under-drift, because the ceiling leaves the answer no room.

## Root cause, stated in one line

**The re-assertion asks about the ORDERED frequency, while the owner's standing rule says we tune
what the card DELIVERS.** With a ceiling on the ordered frequency, the delivered clock is the
capped top — which after the burn is one or two grid steps BELOW what we ordered, exactly as the
delivered FREQUENCY already is. The rule was extended from the frequency axis to the voltage axis
(`GOAL.md` → «🎚 ТО ЖЕ ПРАВИЛО НА ОСИ НАПРЯЖЕНИЯ»); it was never extended to this third place.

## Fix plan — the candidate, and the two rejected alternatives

**Candidate (preferred): key the AFTER re-read on what the card DELIVERED, not on what we ordered.**
`voltageForClock(curveAfter, deliveredMhz)` where `deliveredMhz` is the top the capped curve actually
offers after the write — the clock the card was running when the burn produced its verdict. This is
not a new decision: it is the owner's own rule (`GOAL.md` → «🎚 ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ») applied
where it had not reached. It invents nothing, and it keeps the guard's teeth: an absent answer is
still a stop, it just stops being absent for the normal case.

**Rejected — raise the ceiling one grid step above the tested frequency.** It buys the same margin
and is a one-line change, but it lets the card boost ABOVE the frequency the verdict is about, which
is the exact shape `bugs/02` cost a night for (a verdict recorded about 2842 while the card ran at
~3400). The margin must not be bought on the safety side of the ledger.

**Rejected — relax `voltageForClock` to «nearest point, either direction».** That silently answers a
question nobody asked and would return a voltage for a clock the card never reached. It is the
false-`[TESTED]` class the guard exists to catch.

## Guard, to be proved RED first (EXP-0008), addressees named BEFORE the run

- (a) revert the re-read to the ordered frequency → the block «ПЕРЕЧИТЫВАНИЕ СПРАШИВАЕТ О ВЫДАННОЙ
  ЧАСТОТЕ» reddens on a fixture whose after-table is slid one grid step down;
- (b) make the absent answer non-fatal → the existing halt block must redden, proving the fix did not
  eat the real case (a genuinely unanswerable read is still a stop);
- (c) slide the fixture's after-table so that NOTHING is offered at all → the halt must still fire,
  proving the fix did not become «take whatever is on top» unconditionally.

⚠️ **EXP-0075 applies at every one of these:** the assertion must not dereference the thing the
mutation removes — `find(...)?.x ?? '<what was missing, in words>'`.

## Decisions made without the owner

- **The margin was bought by asking LOWER, not by raising the ceiling.** Both restore the run; only
  one keeps the verdict about a frequency the card was allowed to reach. Raising the ceiling is the
  `bugs/02` shape — a number recorded about 2842 while the card ran at ~3400 — and it was rejected
  for that reason and not for cost.
- **Both sides of the undervolt measurement move together.** Measuring `before` at the order and
  `after` at the delivered clock would compare two different frequencies and overstate the saving,
  because a lower clock is cheaper at stock. One clock, two readings.
- **`voltageForClock` was NOT relaxed.** Making it return «the nearest point in either direction»
  would answer a question nobody asked, with a voltage for a clock the card never reached. The
  decision moved OUT of the lookup into a named function instead, so the lookup keeps its meaning.
- **The halt still halts when the answer is genuinely absent.** The fix removes the false absences,
  not the guard: an unmeasured ceiling falls back to the ordered clock and the stop downstream is
  untouched (its own block, mutation c).

## Links

- `bugs/16` — the same physical drift striking the PLAN; fixed, and its fix is visible working in
  this run's log. Different surface, same cause.
- `bugs/02` — why the rejected «raise the ceiling» alternative is not acceptable.
- `GOAL.md` → «🎚 ТЮНИМ ТО, ЧТО КАРТА ВЫДАЁТ» and «🎚 ТО ЖЕ ПРАВИЛО НА ОСИ НАПРЯЖЕНИЯ» — the owner's
  rule this fix extends rather than invents.
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R11 (a ceiling must be held by something), R14b (the table
  slides along the frequency axis with temperature), R16c (plan and run are one computation).
- `EXPERIENCE.md` EXP-0082 — a snapshot of something that moves is a lie that grows with the run.

## ✅ STATUS: DONE (2026-08-16 23:4x +03:00)

Fixed in `dda17a6`. `askAtClockMhz(ordered, offered) = min(ordered, offered)` — extracted as a pure
exported function so the decision is provable without a card. 6 blocks in `vf-step --selftest`
(29 → 35) and 2 in `engine --selftest` (241 → 243) for the evidence carried in the halt message.

**Mutation-proved, addressees named BEFORE the run; each reddened its own block, the intact code
reddened none:** (a) always ask about the ordered clock — the pre-fix behaviour → 3 blocks ·
(b) always take the offered clock even when higher → «никогда не спрашивает выше» · (c) an
unmeasured ceiling kills the question → «верх не измерен» · (d) a missing order falls back to the
ceiling → «заказа нет — нет и вопроса» · (e) the halt message drops the evidence → both evidence
blocks.

**VERIFIED LIVE, which is what closes it rather than the suite.** The same command that halted at
2872 MHz with 2 frequencies of 266 was re-run after the fix and walked straight past that point,
closing 2872 → 965 mV and continuing down the band. The halt did not recur.

**What this does NOT claim:** the individual mechanism that put the actual top below the ceiling
(drift · grid snap · offset granularity) was never isolated, and does not need to be — with a
designed margin of exactly zero any of them produces the halt, and the fix is correct under all
three. The measurement that matters is the one in this document: **gap to cap 0.0 MHz.**
