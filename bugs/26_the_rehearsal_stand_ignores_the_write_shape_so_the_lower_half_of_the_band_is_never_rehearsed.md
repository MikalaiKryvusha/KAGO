# Bug 26 — the rehearsal stand ignores the write shape it is handed, so the lower half of the owner's band is never rehearsed (and two claims say the sweep pins every rung, which it does not)

**Status:** 🔴 OPEN — found 2026-08-21 while executing step 4 of `bugs/24`'s fix plan
**Version/build:** `main` @ `678ae67` + the `bugs/24` fix · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** 2026-08-21 00:3x +03:00. Everything below is offline — the virtual card, its own
JSON table, and one direct call into `chooseWriteShape`. Zero writes to the live GPU.

## Symptom

`bugs/24` asked for a rehearsal below the curve's cap floor as its end-to-end proof. Run it:

```
npm run bench -- --from 2100 --to 2100 --max-depth 30
```

```
НЕИЗВЕСТНО на 2100 МГц / 815 мВ — оракул не вынес вердикта: запись отвергнута:
потолок 2100 МГц кривой не удержать: утечка 85 МГц, пол 2185 МГц (R11).
Это СТОП: уточнять край вокруг ненаблюдённой границы значило бы выдумать измерение
ПОКРЫТИЕ: закрыто 0 из 1 (0 %)
```

The rehearsal halts on the first rung. **The live path does not do this** — below the floor it writes
a UNIFORM raise with no ceiling at all and holds the frequency with the clock pin, which is precisely
the branch `bugs/24` was about. So the stand refuses a rung the card would have taken, for a reason
the card never meets.

## Root cause — MEASURED, not reasoned

`runRung` decides who holds the ceiling and hands the decision to the step function
(`engine.mjs:698–709`: `writeShape: held.shape`, `capMhz: capForAtom`, `pinMhz`).

**`trap-suite.makeSweepStepFn` (`trap-suite.mjs:128–155`) destructures `{ offsetMhz, capMhz, pinMhz,
sustain }` and never reads `writeShape`.** It then unconditionally does two things:

1. `writeRaiseAndCap(offsetMhz, capMhz, …)` — a CAPPED raise, always, even when the decision it was
   handed says `uniform` (no ceiling). At 2100 MHz `capMhz` is 2100, and the virtual card's own R11
   guard correctly refuses a ceiling the curve cannot hold (floor 2185 MHz on this card's geometry).
2. `lockGraphicsClocksMhz(clock, clock)` with `clock = pinMhz ?? capMhz` — it PINS on every rung,
   including the rungs where `chooseWriteShape` answered `pinRequired: false` and the live run would
   leave the card unpinned.

So the stand writes one shape for the whole band while the engine chooses between two, and the two
disagree in **both** directions.

Asked directly of `chooseWriteShape`, on the bench card's own V/F table, with the shipped defaults
(`pinned: true, demandPin: false`):

| clock | `capEnforced` | what the engine decides | what the bench does |
|---|---|---|---|
| 2842 МГц | true | holder **кривая**, `pinRequired: false`, `raise-and-cap` | capped raise **+ pin** ❌ |
| 2200 МГц | true | holder **кривая**, `pinRequired: false`, `raise-and-cap` | capped raise **+ pin** ❌ |
| 2100 МГц | false | holder **закрепление**, `pinRequired: true`, **`uniform`** | **capped raise** → refused ❌ |
| 1800 МГц | false | holder **закрепление**, `pinRequired: true`, **`uniform`** | **capped raise** → refused ❌ |

(Floor 2185 MHz here, ~2157 MHz on the owner's card — fact 38. The number differs, the shape of the
divergence does not.)

**And `candidateProfile` is never called on the bench at all.** The stand locks the virtual card's
backend directly instead of going through `profile-manager.apply`, so rule R1 («one writer») is not
rehearsed either — which is exactly why the bench stayed green for five days while the production pin
path was unapplicable (`bugs/24`). A stand that cannot go red for a production defect is not
rehearsing that production code.

## Second symptom, same root: two claims say the sweep pins EVERY rung

- `bench-run.mjs:258` prints `ФОРМА: ЗАКРЕПЛЕНИЕ частоты на каждой ступени (алгоритм владельца,
  ideas/03 шаг 7)` — while `runSweep`/`benchRun` never pass `demandPin`, which defaults to `false`.
- `STATUS.md:151` says of the live command: «**РАЗВЁРТКА ПО ДИАПАЗОНУ В ФОРМЕ ВЛАДЕЛЬЦА (шаг 7):
  частота ЗАКРЕПЛЯЕТСЯ на каждом прожиге**» — the live sweep (`engine.mjs:5632–5652`) does not pass
  `demandPin` either.

Above the cap floor neither run pins anything: the flattened curve holds the ceiling and
`pinRequired` is `false`. **The code is right and the claims are stale.** `runRung`'s own comment
says why the lock is not the default and names the measurement — `researches/11`: `-lgc 3082,3082`
delivered 2887 MHz and never moved, so a clock lock is a CEILING, not a command, and defaulting it on
made every sweep stop on its first rung. The live command's printed header is honest («где кривая
способна удержать потолок — пишем ОТГРУЖАЕМУЮ форму»); only the bench header and the STATUS row
overclaim. Same family as `bugs/25` — a claim that outlived the code it described.

## Blast radius

- **The lower half of the owner's standing order `--sweep --from 2887 --to 900` has never been
  rehearsed, and cannot be with today's stand.** Everything below ~2157 MHz on the live card takes
  the uniform+pin branch; the bench refuses that whole region on its first rung.
- **The bench cannot go red for defects on the pin path.** `bugs/24` is the proof: the production pin
  was unapplicable for five days and `npm run traps`/`npm run bench` never noticed, because neither
  ever builds a candidate profile.
- No risk to the card: everything here refuses BEFORE any write, and the live path is unaffected —
  this is a defect of the instrument, not of the engine.

## Fix plan (not started)

1. `makeSweepStepFn` obeys the decision it is handed: on `writeShape === 'uniform'` write a uniform
   raise (no cap); pin only when `pinMhz !== null`, and do not pin when it is null.
2. Route the bench's pin through `profile-manager.apply(candidateProfile(...))` against the virtual
   card's backend — the applier already drives that backend green (`vgpu --selftest` block 9), so the
   seam exists. Then a `bugs/24`-class defect reddens the bench.
3. A trap or a bench block for a band BELOW the floor: coverage must be 1 of 1, holder «закрепление
   частоты», shape `uniform`, and the rung must not be refused.
4. Fix the two stale claims (`bench-run.mjs:258`, `STATUS.md:151`) to say what actually happens:
   the curve holds the ceiling where it can, the pin holds it below the floor, and the run prints
   which one per rung.
5. Decide deliberately whether `demandPin: true` should ever be the sweep's mode — the owner's step 7
   asks for it in words, `researches/11` measured why it cannot be a blanket default. That is a
   question for the owner, not a silent flip: `interviews/`.

## Verification by observation

- `npm run bench -- --from 2100 --to 2100` → closes 1 of 1, holder named «закрепление частоты»,
  shape `uniform`, no R11 refusal.
- Deleting `curveCapMhz` from `candidateProfile` again (the `bugs/24` mutation) reddens the bench or
  the trap suite — today it does not.
- `npm run selftest:all` stays green throughout.

## Related

- `bugs/24` — the defect this was found while trying to prove; its step 4 is the thing that could not
  be executed.
- `bugs/25` — the same family as the second symptom: claims that outlived their code.
- `bugs/11` / R13 — why a raise without a ceiling is dangerous above the envelope, and why the
  `uniform` branch is nonetheless correct below the floor (the pin bounds the card, not the cap).
- EXP-0070 — a stand that tests something other than the module under test, and reports green.
