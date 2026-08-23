# Bug 42 — the descent re-orders a voltage the warmed card will not take, and burns are spent for nothing

**Status:** ✅ ALL FOUR DEBTS CLOSED 2026-08-23 20:4x — commits `6dcaf81` (the descent) and `fb5df50`
(the window and the page). Battery 26 sets / 1190 green blocks / 0 red; zero GPU writes to close it.
**Version/build:** found on `main` @ `2b62f2f`, closed on `fb5df50` · **When/context:** found
2026-08-23 19:0x on the OWNER'S CARD, during the live sweep of the band 2700…2600 MHz, and the owner
saw it before the agent did

## Symptom, as it appeared on his screen

```
2700 МГц: план звал на 875 мВ, но доказано 915 мВ — это 40 мВ при стене 35.
          Беру ближайшую достижимую ступень сетки: 885 мВ (шаг 30 мВ)
2700 МГц ← 885 мВ (глубина −110 мВ)
ПОПАЛИ ВЫШЕ: заказано 885 мВ, карта подставила 915 мВ … ПРОШЛО
2700 МГц: план звал на 865 мВ, но доказано 915 мВ — это 50 мВ при стене 35.
          Беру ближайшую достижимую ступень сетки: 885 мВ (шаг 30 мВ)
2700 МГц ← 885 мВ (глубина −110 мВ)
```

The same rung, ordered twice, answered twice with the same 915 mV. Each turn costs a FULL burn on the
owner's card. His words on the print itself: *«шаг пишет −110 мВ — какой-то бред! Такого шага не может
быть!»* — and he was right twice over, see «Two print defects» below.

## 🔴 THE FIRST FINDING IS THE AGENT'S OWN DIAGNOSIS, AND IT WAS WRONG

The agent stopped the live run calling it an infinite loop. **It was not.** The descent walks a FINITE
ladder, so it would have spent a few more rungs and closed the frequency by itself. Measured
afterwards on a fixture that pins the delivered voltage: the descent ends after **6 rungs**, with the
guard and without it, identically.

**What was true:** burns were being spent on a rung whose answer was already known.
**What was false:** «it will never end», which is what justified killing the run.

The cost of the wrong diagnosis was the owner's evening: the run was killed, the card returned to
factory, and the measurement he was waiting for was not taken. **A stop is an action with a price, so
the claim that justifies it is held to the same standard as any other measurement** — and this one
was an impression, not a measurement (`PHILOSOPHY.md` → observation instead of conjecture).

## Root cause of the real defect

1. The card, warmed by its own burn, serves the tested frequency from a HIGHER table entry — the
   table slides ≈ −1.7 MHz/°C (R14b). Ordered 885 mV, served 915 mV.
2. The proven ground is the deepest voltage that PASSED (`bugs/36`) — so it becomes 915.
3. The plan's next rung is deeper than the `bugs/03` wall allows from 915, so the descent REBASES to
   `ground − wall` → 885 again.
4. 885 is served by 915 again. Two identical burns, zero new knowledge.

**And step 3 carries a second, independent defect: the rebase step is 30 mV at a depth of 110 mV,
where the owner's ladder says 10 mV** (`GOAL.md` → «ЛЕСТНИЦА ШАГОВ СПУСКА»: 0…100 → 25 · 100…150 →
10 · deeper → 5). The rebase maximizes the step to the wall instead of obeying the zone. Тhe wall is
a CEILING on the step, never the step itself. **This one is OPEN.**

## Two print defects, both named by the owner

| what he read | what it was | state |
|---|---|---|
| `(глубина −110 мВ)` read as the STEP | it is the depth from stock; the eye looks for the step there, and the step is what decides whether we catch a verdict or hang the machine | ✅ FIXED — the line now says «глубина ОТ СТОКА … шаг зоны N мВ» |
| «сток 995» with no units | — | 🟡 not found in the engine's or the dashboard's sources; he saw it on the watch page. OPEN, needs the exact string |

## What was built tonight — the bench can now reproduce the mechanism

**`config.VF_TABLE_DRIFT_MHZ_PER_C = −1.7`** — the measured slide, previously living only in prose.

**The virtual card learned to drift** (`virtual-gpu.mjs` → `tableDriftMhz`), and it is a CARD
PROPERTY, off by default. Measured reason for opt-in: with the shipped shape dozens of entries sit
exactly at the ceiling, so a global drift drops them all below it and «what voltage serves the
ceiling» stops having an answer — on the live card that case lowers the DELIVERED FREQUENCY instead,
and modelling it as a rising voltage would be invented physics.

**Trap T7 — `T7_serves_a_voltage_nobody_ordered`** carries the drift with the measured constant. Its
mechanism block is proven: on 2700 MHz a cold card serves 995 mV and the warmed one 1000 mV (drift
−14.2 MHz). The field reaches the card FILE, which is the check EXP-0077 paid for.

**The engine got the repeat guard** (`sweepFrequency`): the same ordered voltage answered by the same
delivered voltage twice in a row closes the FREQUENCY by what is proven — never the band.

## What was OWED — and how each debt actually closed

**1. The repeat guard had no red proof. → CLOSED, and the debt turned out to be in the FIXTURE.**
Measured, not reasoned: the "stuck" fixture was an ORDINARY card. Its pin sat at `915 mV` while the
suite's grid runs 930…1045, so `max(ordered, 915)` returned the ordered value on all six rungs —
`1020→1020 995→995 970→970 945→945 935→935 930→930`, zero repeats. Mutation DM could not have
reddened it. Same family as EXP-0077: a mutation that reddens nothing is a finding about the code
under it — here, about the fixture's number falling outside the range where the mechanism exists.

**2. The 30 mV rebase step. → CLOSED, and it pulled TWO more real defects out with it.**
The rebase MAXIMIZED the step to the `bugs/03` wall instead of walking the owner's ladder. Fixed by
collapsing the decision into ONE function, `nextRungFrom`, called by both `descentLadder` and the
rebase — the outcome the pairs registry prefers over a pair that must be watched. The refactor is
proved by a **byte-exact golden over 1152 ladder configurations: empty diff.**

- **2a. Two anchors were conflated, and the suite caught it.** The first redaction measured BOTH the
  zone step and the wall from the proven ground, so on the `bugs/23` fixture (ground frozen at stock
  1045 because the card answered an order of 1020 with 1045) it re-proposed **1020 — a rung already
  burned** — and the frequency lost the 970 mV edge it used to find. Correct split: **the zone step
  is measured from where the descent STANDS (the last ordered rung), the wall from PROVEN ground.**
- **2b. The early exit fell through into the refinement.** The tail of `sweepFrequency` opens on the
  premise «the ladder ran out», and on that premise it calls `closeByHang()` — i.e. a REFINEMENT,
  another ten voltage orders on the owner's card. Every `break` violates that premise. After
  `no-progress` it is a flat contradiction: the guard has just established that the card does not
  honour orders, and the refinement does nothing but order and read. Measured on the drift fixture:
  **17 rungs and the frequency lost (`closed: 0`) → 3 rungs and the frequency closed.** The gate is
  narrowed to `no-progress` only — the first version also suppressed the legitimate hang closure and
  reddened the R18 block, which is the «guard fires on a legal state» trap R12/R13/R17 all name.
- **2c. The guard moved BEFORE the burn.** Re-ordering a voltage buys no knowledge whatever the card
  answers, so there is no reason to burn it to find that out. **One full burn cheaper.**

**3. «сток 995» without units. → CLOSED.** The string lived in `assets/dashboard/_wiring.js`. The
unit was present on the neighbouring undervolt at the end of the line, and that is exactly what
masked the hole. The build gate caught a first attempt to patch the GENERATED `sweep.html` in place.

**4. The leftover watch window. → CLOSED, and the hole was structural rather than forgetful.** The
exit handlers were registered INSIDE the branch «no window — I raise one myself». A run started while
a window was already open registered nothing at all, so the window outlived the run — with its sound.
Registration is now unconditional: the window belongs to the RUN, whoever raised it.

## Guards born with the fixes, each proved red

| guard | mutation that reddens it |
|---|---|
| the descent never orders one voltage twice and never walks UP (`engine`, 293 blocks) | DM — measure the zone step from the proven ground instead of from where the descent stands (the real rejected redaction) |
| the stock voltage on the page carries its unit (`dashboard`, 72 blocks) | strip «мВ» from the stock, leaving it on the undervolt |
| teardown is registered BEFORE the raise branch; it takes both halves; it hangs on signals | BW — put the registration back inside the branch (yesterday's state) |

Mutations DK and DL (the proven ground) were re-run against the changed machinery and still redden
their own blocks — the canon's obligation after a behaviour change.

## Still open, and it is a question for the owner rather than a defect

**There is no `stop:*` tag for «the card does not serve the ordered voltage».** The vocabulary is
CLOSED at five values and refuses by name (R14d), so a frequency closed by the no-progress guard is
written `stop:lever-limited` — which is not true: our lever had reach left, the card would not take
the order. The real cause is named in `why` and `provenBy`, but the TAG misnames it, and misnaming
what stopped a run is the class the owner caught on 2026-08-17. Extending his document's vocabulary
is a canon edit, not an agent's call (`PHILOSOPHY.md` → the three doors).

**Second, smaller:** `runRung` computes whether an overshoot is «the nearest grid rung up» and PRINTS
the distinction — but does not stop on «above, yet not the nearest», which `GOAL.md` → «ТО ЖЕ ПРАВИЛО
НА ОСИ НАПРЯЖЕНИЯ» calls a STOP. Left as it is deliberately: turning a print into a stop changes what
a live run does, and the owner should see that decision rather than inherit it.

## Decisions made without the owner

- **The drift is opt-in per card rather than global** — measured reason above; a global default broke
  the rehearsal outright.
- **The repeat guard closes the FREQUENCY, not the band** — a card that will not take the ordered
  voltage is a finding about silicon (the same family as T6, «never delivers the ordered clock»), and
  dropping the whole run over it would discard burns already paid for.
- **The guard shipped despite lacking its red proof**, with the debt named here and in the block's own
  comment. The alternative — deleting it — would drop a real protection over a missing fixture.

## Links

`bugs/36` (the ground is the deepest pass, not the last) · `bugs/03` (the step is the only protection
that acts before the state exists) · `bugs/34` · `GOAL.md` → «ЛЕСТНИЦА ШАГОВ СПУСКА» · «ТО ЖЕ ПРАВИЛО
НА ОСИ НАПРЯЖЕНИЯ» · R14b · `ideas/11` · `interviews/012`
