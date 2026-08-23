# Bug 42 — the descent re-orders a voltage the warmed card will not take, and burns are spent for nothing

**Status:** 🟡 PARTIAL — the bench can now REPRODUCE the mechanism (trap T7, and it is proven red);
the guard against the repeat SHIPPED but its own red proof is OWED; the 30 mV rebase step is OPEN.
**Version/build:** `main` @ `2b62f2f` · **When/context:** found 2026-08-23 19:0x on the OWNER'S CARD,
during the live sweep of the band 2700…2600 MHz, and the owner saw it before the agent did

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

## What is OWED, named precisely so the next session does not re-derive it

1. **The repeat guard has no red proof.** Mutation DM (delete the check) left the block green and the
   rung count identical, because the fixture never produces the repeated pair. **The fixture needed:
   one where the rebase from the frozen ground returns EXACTLY the same rung a second time** — i.e.
   the ladder's next rung must fall below `ground − wall` twice running while the delivered voltage
   stays pinned. Until that exists, the guard is unproven code, and the canon's own rule (`a check
   that has never failed proves nothing`) applies to it.
2. **The 30 mV rebase step** must obey the depth zone (10 mV at depth 100…150), with the wall staying
   a ceiling. Its guard goes red on today's live transcript.
3. **«сток 995» without units** — find the string on the watch page and fix it.
4. **The leftover watch window.** Stopping a run left the visualizer open and audible in another room
   — the owner heard music and believed the run was alive. Teardown must close the window in the same
   action that stops the run (`tools/tidy.mjs`, or the engine's own exit handler); it must not depend
   on the agent remembering. Same class as `bugs/17` and `bugs/39`, fourth occurrence.

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
