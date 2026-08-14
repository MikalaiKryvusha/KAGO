# Bug 09 — the dry run printed a ladder four times deeper than the run would actually walk

**Status:** ✅ DONE — fixed offline, zero GPU writes, mutation-proved (block 20)
**Version/build:** driver 610.88 · VBIOS 98.03.58.40.8b · `engine.mjs` at commit `80b07af`
**When/context:** 2026-08-14 22:0x +03:00, the first `--dry-run` of session 18 — the pre-flight read
that `STATUS.md`'s own handoff instructed the next session to perform before the live A2 re-run

## Symptom

`npm run engine -- --band 2842 --dry-run` printed:

```
2842 МГц → точка 96 (1050 мВ) · ступеней 40, глубже всего −250 мВ · ПЕРВЫЙ ШАГ −5 мВ
```

and **no session-depth line at all** — although `STATUS.md` § «эстафета» told the next session to
read one («посмотреть строку „ГЛУБИНА СЕССИИ"»). The bound bought by the hang of `bugs/07`
(`SESSION_MAX_DEPTH_BEYOND_KNOWN_MV = 30`) was invisible in the plan, and the plan's own numbers
advertised a sweep to −250 mV — **eight times the depth the run would actually reach.**

## Why this matters, stated exactly

**The bound itself worked.** `searchEdge` computed it at run time and would have stopped at −30 mV.
Nothing unsafe was going to happen. What was broken is the ARTIFACT THE OPERATOR READS BEFORE
DECIDING TO WRITE TO THE OWNER'S CARD — and that artifact is named as a duty in two places:

- `GPU_TUNING_RAILS.md` §0, S2: *«Your duty: run `--dry-run` first and READ the printed first-step
  depth.»*
- EXP-0039: *«print the depth of the FIRST step, check it against a ceiling, and ask whether you
  would be present when it lands.»*

A pre-flight read that under-reports risk is a defect; one that OVER-reports it is a different
defect with the same root — the reader cannot use it to decide. Here it over-reported by 8×, which
is precisely the number that would make a careful operator refuse a run that was in fact safe, or
(worse) normalise the gap between what the plan says and what the engine does.

**And it is `bugs/02`'s class wearing new clothes:** a number whose true shape the reader has to
infer.

## Root cause

The session bound lived INSIDE `searchEdge` (`engine.mjs`, the ascent-ladder section) as inline
code. The CLI plan loop composed its own, simpler view — `pickAscentRungs` over the raw ladder — and
printed that. **Two computations of one fact, only one of which knew about the bound.** The moment
`bugs/07`'s fix landed in the run, the plan was left behind, and nothing could notice: no pair
existed between them.

Second, smaller face of the same root, found while fixing: the `--search` plan read the ratchet as
`partitionByStamp(readAll(store).records, card)` — WITHOUT `resolveAttempts` and WITHOUT the
write-shape quarantine that `searchEdge` applies (`bugs/06`). So that plan could print a ratchet
limit the search does not use.

## The fix (offline, zero GPU writes)

1. **`composeAscentLadder()`** — one exported pure function holding the governor call plus both
   session bounds, returning `{ chosen, ladderRungs, sessionDepth }`. `searchEdge` now calls it; the
   inline copy is gone. Order preserved verbatim: the governor runs FIRST on the whole ladder, the
   session bounds may only REMOVE rungs it blessed (the `bugs/03` invariant).
2. **`sessionDepthLine()`** — the bound worded once, so plan and run cannot describe it differently.
3. **`ratchetView()`** — the ratchet's usable evidence (resolve + both quarantine axes) exported, so
   the PLAN sees the ratchet the RUN will see. Both CLI plans use it.
4. `sessionDepth` gained `deepestPlannedMv` and `rungsPlanned` — the two numbers an operator compares
   against «глубже всего» before starting.

After the fix, the same command prints:

```
2842 МГц → точка 95 (1045 мВ) · ступеней 39, глубже всего −245 мВ · ПЕРВЫЙ ШАГ −5 мВ
      ГЛУБИНА СЕССИИ: истории НЕТ (карта «без истории»), отсчёт от стока · потолок −30 мВ ·
      эта сессия дойдёт до −30 мВ и остановится САМА · ступеней в прогоне 5
      (отброшено потолком 8, точных на фронтире 4)
```

## Verification

- `npm run check` — 33 files, 0 failed.
- `node automation-engine/engine.mjs --selftest` — **70 blocks** (was 67), all green. The refactor
  landed at 67/67 BEFORE the new blocks were added, which is how we know it preserved behaviour.
- **Mutation, addressee named before the run (EXP-0016), harness `scratchpad/mutate-plan-depth.mjs`:**
  make the plan report the depth of the WHOLE ladder while the run stays bounded — i.e. re-create the
  shipped defect exactly. Result: **3 red blocks, all of them the new ones**, and the session-depth
  blocks 17/18 stayed GREEN (the run was untouched — which is the whole point):
  - `ПЛАН ВИДИТ ТУ ЖЕ ГЛУБИНУ, ЧТО ПРОЙДЁТ ПРОГОН` → got 225, wanted 5
  - `и план обещает столько же ступеней, сколько прогон сделал` → got 8, wanted 1
  - `строка плана НАЗЫВАЕТ эту глубину вслух и говорит, что истории нет` → got false

## TWINS

`TWINS: searched pickAscentRungs( · partitionByStamp( · allowedOffset( across all .mjs — found 2
other production sites composing this fact independently, both fixed here (the --band plan loop and
the --search plan's ratchet read). Every remaining hit is either inside composeAscentLadder /
ratchetView themselves, inside vmin-store (the definitions), or a selftest fixture exercising the
governor directly — which is legitimate.`

## Decisions made without the owner

- **Fixed rather than only reported.** The defect is in the agent's own instrument, method is the
  agent's (EXP-0026), and the fix is offline with zero GPU writes.
- **Fixed by EXTRACTION, not by copying the bound into the CLI.** A second copy would have been
  three lines instead of a refactor of `searchEdge` — and would have been the same defect one edit
  later. Closing the class, not the instance (`BUG_FIXING_FRAMEWORK.md`).
- **The `--search` ratchet read was fixed in the same pass** even though nobody had hit it. It is
  the identical defect in the sibling entry point; leaving it would make the twin check a formality.

## Links

- `automation-engine/engine.mjs` → `composeAscentLadder`, `sessionDepthLine`, `ratchetView`
- `bugs/07` (the bound this plan could not see) · `bugs/03` (the first-step depth, the same duty)
- `bugs/02` (the class: a number whose shape the reader must infer) · `bugs/06` (the quarantine axes)
- `GPU_TUNING_RAILS.md` §0 S2 · EXP-0039

## ✅ STATUS: DONE (2026-08-14 22:2x +03:00)

Closed offline the same session it was found. The live A2 re-run it unblocks is owner-gated (S1) and
is a separate step — this bug is about the PLAN telling the truth, and it now does.
