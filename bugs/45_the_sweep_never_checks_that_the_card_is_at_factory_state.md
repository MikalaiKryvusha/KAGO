# Bug 45 — the sweep never checks that the card is at factory state, and measured against an applied profile

**Status:** 🔧 FIXED 2026-08-30 11:5x, OFFLINE-PROVED AND LIVE-PROVED ON THE POSITIVE BRANCH —
awaiting one live refusal to be called DONE. The precondition stands before the band derivation and
before the dry-run exit; the judge is mutation-proved three ways; the misnamed cause is fixed. What
is NOT yet observed is the REFUSAL on a real applied profile — proving it would mean applying a
profile to the owner's card, which is his state to change, not a measurement's convenience. It will
be observed the next time a mode is live and a run is started; until then the negative branch rests
on the fixtures. See «✅ The fix» below.
**Was:** 🔴 OPEN — reproduced on the owner's card 2026-08-23 22:0x, first live run after the
`bugs/42` fixes. **Nothing was written to the GPU**: the engine refused before the first burn.
**Version/build:** `main` @ `d4fd39a` · **When/context:** `plans/32` step 3 — the live sweep of a
single hole at 2775 MHz, which ended with coverage 0 of 1 and a refusal nobody expected

## Symptom

```
2775 МГц ← 850 мВ (глубина ОТ СТОКА −165 мВ)
850 мВ обслуживает 2775 МГц уже на стоке (сдвиг -22 МГц) — писать нечего и мерить нечего
ЗАТРАВКА ОТВЕРГНУТА на 2775 МГц: … вердикт НЕИЗВЕСТНО … Монотонность на этом кремнии здесь НАРУШЕНА
2775 МГц ← 990 мВ (глубина ОТ СТОКА −25 мВ, шаг зоны 25 мВ)
СТУПЕНЬ НЕ ИЗМЕРЯЛА БЫ ТО, ЧТО ЗАКАЗАНО: при сдвиге -112 МГц частоту 2775 МГц обслуживало бы
875 мВ (запись 68), а мерить заказано 990 мВ (запись 86). Такое возможно на НЕМОНОТОННОЙ
таблице, и вердикт был бы о чужом напряжении
ОСТАНОВЛЕНО (halt) · ПОКРЫТИЕ: закрыто 0 из 1 (0 %) · ВРЕМЯ: 0.0 с
```

The run reported **«НЕМОНОТОННАЯ таблица»** and **«монотонность на этом кремнии НАРУШЕНА»** — two
statements about the SILICON. Both are wrong, and the truth is worse.

## Root cause — the card was not at stock, and nothing asked

Measured immediately after the run:

| probe | reading |
|---|---|
| `nvidia-smi --query-gpu=power.limit,power.default_limit` | **250 W** against a factory default of **300 W** |
| `runs/shell/remembered-state.json` | `"profile": "optimised"`, written **2026-08-23T19:47:41+03:00** |
| `nvapi --control` | **65 non-zero 32-bit words** in the curve control structure — per-point offsets ARE applied |

**The `⚖️ Optimised` profile was live on the card the whole time.** The sweep read the V/F curve, got
the RAISED curve, and compared it against a document whose `stockVoltageMv` column was captured on
the FACTORY curve (2026-08-15 17:37, 52 °C).

That is the whole discrepancy, and it is large:

| frequency | document says stock | what the run implies from the live curve |
|---|---|---|
| 2775 MHz | 1015 mV | served well below that — `850 mV` already reaches it, offset **−22 MHz** |
| 2887 MHz | 1070 mV | **990 mV** reaches it, hence the **−112 MHz** in the refusal |

~80 mV of disagreement. Thermal drift on this card is ≈ −1.7 MHz/°C on the FREQUENCY axis
(R14b) — nowhere near enough to explain it. The curve is raised, not warm.

## Why the guard's diagnosis was wrong, and why that matters more than the refusal

R12's check computes the write vector's order and refuses when the entry that would actually serve
the tested clock is not the entry we ordered. On a raised curve that condition is TRUE — so the guard
fired correctly and **saved the run from writing a measurement about a foreign voltage.**

But it named the cause **«НЕМОНОТОННАЯ таблица»** and the run summary escalated it to **«монотонность
на этом кремнии НАРУШЕНА — это находка о карте»**. Both sentences accuse the silicon of a property it
does not have. A future session reading that line goes hunting for a non-monotone factory table and
finds nothing, with a green test suite behind the claim. This is EXP-0127 exactly: *a mutation proves
a block goes red, never that it is RIGHT about why* — and here the block was right to fire and wrong
about the reason.

## The defect proper, stated once

**`engine --sweep` has no precondition «the card is at factory state».** It probes the envelope, the
clock ladder, the watch window, the watchdog's stale records and the journal — and never asks the one
question on which every number it is about to take depends.

**The exposure is not this run.** Here the offsets were big enough for R12 to trip. A SMALLER applied
profile would shift the curve by a few MHz, R12 would stay silent, and the sweep would write rows
whose voltages were measured against a baseline the document does not describe. Those rows would look
perfectly well-formed. That is the `bugs/02` shape — a number that is wrong for a reason no field of
the record mentions.

## Fix plan

1. **A precondition at start-up, beside the watch-window gate:** read the power limit against the
   factory default and count non-zero words in the curve control structure. Non-factory → **REFUSE**,
   naming what is applied and the exact command that clears it (`🔄 Stock Default`, or
   `npm run profile -- --reset`). Never reset on the sweep's own initiative: the applied profile is
   the owner's state and clearing it is his decision, not a side effect of starting a measurement.
2. **The same check in `--dry-run`**, or the rail lies: tonight's dry run printed exit 0 for a band
   the live path could not walk. That is `bugs/09`'s disease — the plan promising what the run will
   not do — and it is the one pair this project keeps collapsing rather than watching.
3. **Fix the misnamed cause** (§ «Why the guard's diagnosis was wrong»): when the refusal fires while
   the card is not at stock, the reason must say so instead of accusing the silicon.
4. Guard for each, proved red by mutation.

## ✅ The fix — 2026-08-30 11:5x, session 66

**Item 1 — the precondition.** `profile-manager.factoryStateVerdict()` is a PURE judge over two
readings the caller already holds; `engine.mjs` takes them through `factoryStateReadings()` and
refuses with exit 2. Placed right after the clock-ladder check, i.e. **before the band derivation**
— which matters more than it looks: the band is derived FROM THE LIVE CURVE, so on a raised card the
sweep would have planned the wrong work before ever reaching a write.

**Item 2 — the dry run.** Satisfied by placement rather than by a second check: the gate sits ABOVE
the dry-run exit, so `--dry-run` refuses on the same state the live path refuses on. One computation,
not a pair to watch (R16c).

**Item 3 — the misnamed cause.** Two halves, and the first was already closed: `seedOutcome`
distinguishes «the oracle judged and failed» (a finding about SILICON) from «the rung was never
judged» (a finding about the WRITE PATH) since `plans/28`, 2026-08-25. The half still open was
`planRung`'s serving-mismatch refusal, which offered exactly ONE explanation — «НЕМОНОТОННАЯ
таблица» — for an observation with two. It now names both doors and says outright that it cannot
tell which, with the probe command for the first. `planRung` is a pure function over the table and
has no business claiming to know the card's state.

**Item 4 — the guards.**

| what | where | proved |
|---|---|---|
| the judge, five shapes + the watt tolerance | `profile-manager --selftest`, 55 → **62 blocks** | mutations **EA** (curve axis always factory) · **EB** (power axis never fires) · **EC** (unreadable counts as factory) — each reddening only its own blocks |
| the WIRING — that the gate reads the fields the two probes actually return | `engine --selftest`, 381 → **387 blocks** | mutation **ED** (one probe field renamed) reddens exactly those 6 and nothing else |
| the positive branch on real silicon | `--sweep --from 2400 --to 2380 --dry-run`, read-only | **«ЗАВОДСКОЕ СОСТОЯНИЕ КАРТЫ: подтверждено — ненулевых сдвигов 0 — кривая заводская · предел 300 Вт — заводской»**, exit 0 |

**Why the wiring needed its own block, stated because it is the non-obvious half.** A renamed probe
field does not produce a loud failure: it yields `undefined`, the judge honestly answers «НЕ
ПРОЧИТАНО», and the sweep then refuses **every** run — including on a perfectly factory card. That is
the guard-causes-the-regression trap the canon names three times (R12 · R13 · R17) and this project
has fallen into twice. Worse, the five verdict blocks would have AGREED with each other under that
mutation, because both sides read the same broken mapping — the EXP-0176 blindness. The block that
actually catches it asserts the readings are NUMBERS, not verdicts.

**What is deliberately NOT covered, and why.** A clock lock (`-lgc`): `nvidia-smi` publishes no
"am I locked" field, and the project detects a lock only by the clock holding still — which an idle
card does anyway. A probe for it would be a guess wearing a measurement's clothes (the three-doors
rule). It is also the axis least likely to bite: no shipped mode pins the clock (the owner's
requirement), so a lock could only be a leftover from a measurement tool.

**Two field notes for the next session, both paid for during this fix.** The engine's pulse-fixture
block resolves `benches/fixtures/...` against the **process CWD**, so a mutant run started from
inside `automation-engine/` reddens it for a reason that has nothing to do with the mutation — run
mutants of `engine.mjs` from the repository ROOT. And the first reading of that red was wrong
(«the block is not copy-safe»); measuring an UNMUTATED copy is what corrected it, and cost one
command.

## What this bug does NOT excuse

The seed rejection at 850 mV also produced **НЕИЗВЕСТНО**, not a clean PASS/FAIL, and the run
attributed that to monotonicity too. On a raised curve that verdict is uninterpretable — but
«uninterpretable» is not «monotonicity broken», and the summary line should not have said it was.

## Decisions made without the owner

- **The card was NOT reset to factory to make the run work.** The `optimised` profile is his applied
  state; clearing it is a change to his machine that he must choose, and «the measurement wanted it»
  is not authority (`AGENT_GUIDE.md` → the owner's-machine rule).
- **Filed as a separate bug rather than as a note in `plans/32`.** It is a missing precondition in
  shipped machinery, not an incident of tonight's sequence.

## Links

`plans/32` §3 (the run that found it) · `bugs/42_DONE` (the fixes this run was meant to prove) ·
R12 (the guard that fired) · R6 (the stamp discipline this precondition is the missing sibling of) ·
`bugs/09` (the plan-vs-run pair, item 2) · EXP-0127 (right to fire, wrong about why)
