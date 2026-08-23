# Bug 46 — the printed step is not the step the descent takes, and this is the SECOND strike

**Status:** 🔴 OPEN — reported by the owner mid-run, 2026-08-23 22:1x: *«пишет шаг -45 мВ — это баг»*,
*«заебали эти неверные шаги!»*. Not fixed; the session was closed on his instruction.
**Version/build:** `main` @ `f3f94c7` · **When/context:** the live sweep of 2355…2175 MHz
(`plans/32` step 3), reading the run's own output on screen

## 🔴 THIS IS THE SAME CLASS AS `bugs/42`, AND MY FIX THERE WAS WRONG IN KIND

On 2026-08-23 19:0x the owner read `(глубина −110 мВ)` and said *«шаг пишет −110 мВ — какой-то бред!
Такого шага не может быть!»*. I "fixed" it by ADDING the zone's step to the line:
`(глубина ОТ СТОКА … мВ, шаг зоны N мВ)`.

**That added a different number, not the one his eye was looking for.** Three hours later the same
complaint, on the same line, about the same missing quantity. By this project's own rule — *a lesson
that repeats is a lesson that failed as text; two strikes → a mechanism, never a third reminder* —
the fix this time must be a guard, not better wording alone.

## Symptom — two faces, one defect, both on screen tonight

```
2355 МГц ← 850 мВ (глубина ОТ СТОКА −45 мВ)
2355 МГц ← 845 мВ (глубина ОТ СТОКА −50 мВ, шаг зоны 25 мВ)
```

| line | step ACTUALLY taken | what the line shows | why the eye is misled |
|---|---|---|---|
| the seed rung | **45 mV** — from stock 895 to the seed 850 | **no step at all**; the only signed number is the depth, −45 | the reader takes −45 for the step and sees a 45 mV first step against the `bugs/03` wall of 25 |
| the next rung | **5 mV** — 850 → 845 | **«шаг зоны 25 мВ»** | the printed 25 is the zone's step by depth; the descent came off a seed and correctly walked the grid's minimum, 5 mV |

**The second line is the sharper one:** it does not omit the number, it prints a number that is
WRONG. The step taken was 5 mV and the line says 25.

## Root cause

`say('rung-start', …)` at `engine.mjs:2505` is handed `depthMv` and `zoneStepMv` and prints both.
Neither is the step. The step is `standMv − targetMv`, and it is known at the call site — the descent
computes it to obey the `bugs/03` wall — but it is never passed to the printer.

For the seed rung the omission has a second half: the seed IS a jump of 45 mV, and it is **legal**,
because it lands on ground the neighbour 2797 MHz already proved (`GOAL.md` → «🪜 СПУСК НАЧИНАЕТСЯ С
УЖЕ ОТТЮНЕННОЙ СОСЕДКИ»; the `bugs/03` governor generalises to «deeper than 25 mV from the deepest
voltage already PROVEN BY EVIDENCE»). The line never says that, so a legal jump reads as a violated
guard — and the owner was right to challenge it, because nothing on screen distinguishes the two.

## Fix plan

1. **Print the step ACTUALLY taken, on every rung line, as the leading quantity.** Depth stays, but
   subordinate; the zone's step stays only where it explains a difference.
2. **The seed rung says it is a seed and names its ground:** «затравка от соседки 2797 МГц —
   прыжок 45 мВ на ДОКАЗАННУЮ ею землю, а не шаг в темноту». A legal jump must read as legal.
3. **Where the actual step differs from the zone's step, say WHY in one clause** — «шаг 5 мВ
   (минимальный: спуск идёт от затравки, а не от стока)». Tonight's 5-vs-25 is exactly that case and
   it is the owner's own rule of 2026-08-17.
4. **THE GUARD, and it is the point of this document:** a block that asserts the printed step equals
   `standMv − targetMv` for every rung of a scripted descent — seed rung included. Mutation: print
   the zone's step instead → the block reddens. Without it this is the third reminder, not a fix.

## Decisions made without the owner

- **Not fixed inside the session it was found in.** He closed the chat immediately after reporting
  it; filing it precisely is what keeps it from being re-derived tomorrow.

## Links

`bugs/42_DONE` (first strike, and the insufficient fix) · `engine.mjs:2505` (the printer) ·
`GOAL.md` → «🪜 СПУСК НАЧИНАЕТСЯ С УЖЕ ОТТЮНЕННОЙ СОСЕДКИ» and its 2026-08-17 refinement (why the
step off a seed is the grid minimum) · `bugs/03` (the wall the reader thinks is being broken)
