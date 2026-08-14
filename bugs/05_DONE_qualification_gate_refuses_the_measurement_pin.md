# Bug 05 — the qualification gate refuses the MEASUREMENT pin, so every pinned run is blocked

**Status:** ✅ **DONE 2026-08-14 20:0x — fixed offline, mutation-proved, zero GPU writes.** The
suite that caught it is green again (39/39), and the gate was NARROWED rather than loosened — a
block asserting that an unqualified MODE is still refused runs beside every block that lets the
measurement through. **One honest caveat, stated rather than buried: the LIVE pin has not been
applied since the fix** — that write is owner-gated (S1) and happens as the first action of A2.
**Version/build:** driver 610.88 · VBIOS 98.03.58.40.8b · introduced by commit `4bd2e22`
(«фаза 3 §4.2 закрыт — режимы, гейт qualified, черновики»), 2026-08-14
**When/context:** found 2026-08-14 18:2x while re-measuring the offline suite counts `STATUS.md`
advertises, at the close of A1 (`bugs/02` step 1)

## Symptom

`node automation-engine/lib/ladder-descent.mjs --selftest` — a suite `STATUS.md` lists as **«descend
39»**, i.e. green — reports **«САМОПРОВЕРКА: есть расхождения»**, 8 red blocks. The first one names
the cause and the rest are its consequences:

```
ПЛОХО кандидат проходит валидатор формата
      -> получено [{"field":"qualified","why":"профиль задаёт состояние или является рабочим
         режимом — обязан нести qualified: true|false; true ставит только приёмка (фаза 6)"}]
```

## Why this is not a test problem

`ladder-descent.candidateProfile()` is **not a fixture — it is what pins the clock on the live card.**
The chain, in code:

- `vf-step.runStep({ pinMhz })` → `ld.candidateProfile(pinMhz, card)` → `pm.apply(...)`
- `profile-manager.apply()` runs `validateProfile(profile, { card })` and the qualification gate
  **BEFORE the first write** (by design, R1: whatever surface calls `apply()` meets the same gate)
- `requiresQualification(profile)` is `!isFactoryProfile(profile) || WORKING_MODES.includes(mode)` —
  a candidate sets a clock lock, so it is not factory, so it needs `qualified`
- `candidateProfile()` does not set `qualified` at all, and never did

**So the clock pin cannot be applied at all right now.** That blocks, specifically:

- **A2 — the next live step of the whole physics track** (`npm run engine -- --band 2842 …`): the pin
  is the first thing each rung does, and it would refuse before any curve write.
- `npm run descend` in every form.

The offline half of A1 is unaffected: it made no writes and used no pin.

## Repro (deterministic, no GPU)

```
node automation-engine/lib/ladder-descent.mjs --selftest      # 8 red blocks, first is «кандидат проходит валидатор формата»
```

## Root cause

The phase-3 gate was written for **shipped modes** — its own comment says *«a draft is a VALID file
the format accepts and the list shows — and a state this module never puts on the card»*, and the
draft it means is a MODE awaiting phase 6's acceptance. It was placed in the single writer, which is
correct (R1), and that placement swept in a profile of a different KIND: a measurement pin, which is
not a mode, is never shipped, is never remembered as boot state, and is released in a `finally`
seconds later.

**The class, stated so the next gate does not repeat it: a gate keyed on "is this factory?" treats
every non-factory state as a candidate for shipping — but this project writes two kinds of
non-factory state, MODES and MEASUREMENTS, and only the first is what acceptance is about.**

## What made it invisible for a session

The suite that catches it went red, and **the red was never looked at**: `STATUS.md` kept advertising
«descend 39» from a run that predates the gate. A stale green in the status file is worse than no
number — it answers the question a session would otherwise go and ask the suite itself.

## ✅ THE FIX AS APPLIED (2026-08-14 20:0x) — option 1, the KIND

`profile-store.mjs` gained `PROFILE_KINDS = ['measurement']`, and **an absent field means SHIPPED**:
the default is the strict side, so a profile that forgets to declare itself meets the gate instead of
slipping past it. `requiresQualification()` returns false for a measurement; `candidateProfile()`
declares `kind: 'measurement'`; the applier is untouched, because the gate it enforces did not change
— only its subject did.

**The three refusals that keep the exemption from becoming a hole**, each with its own hostile
fixture: an UNKNOWN kind is refused (a typo must not silently become «shipped») · a measurement that
also claims a `mode` is refused (a mode is the thing that ships) · a measurement carrying `qualified`
is refused, because writing that field where no acceptance was run is the false-`[TESTED]` class
wearing another name.

**Why this is the shape the code already wanted:** `profile-manager`'s CLI — not `apply()` — writes
the remembered boot state, with the comment *«measurement tools drive the library and must not move
the boot state»*. The distinction between a mode and a measurement was already load-bearing; it was
simply never said in the format where the validator could see it. This fix moves that sentence into
the format.

**Evidence, all of it re-runnable:**

| suite | before | after |
|---|---|---|
| `ladder-descent --selftest` | **8 red** | **39/39 green** — the number `STATUS.md` had been advertising all along, now true again |
| `profile-store --selftest` | 25 | **30** (+5 hostile fixtures for the kind) |
| `profile-manager --selftest` | 27 | **29** (+the pin passes the gate and really writes · +a mode disguised as a measurement is refused) |

Five mutations, addressees named BEFORE the run, each reddening its own: exempt every profile
(→ «а РАБОЧИЙ РЕЖИМ без qualified по-прежнему ОТКАЗ») · accept any kind string (→ «неизвестный вид»)
· drop the measurement+mode contradiction · let a measurement carry `qualified: true` · drop the kind
from `candidateProfile` (→ «ПРИБОРНЫЙ пин ПРОХОДИТ гейт», in the applier's suite).

**What is NOT proved: the pin on the real card.** The applier block drives an injected backend and
asserts a write actually happened, which is the strongest offline statement available; the live one
is A2's first action and it needs the owner at the machine (S1).

## Fix plan — ranked, as written before the fix

1. **Give the format a KIND, and key the gate on that.** A measurement profile declares itself
   (`kind: 'measurement'`); `requiresQualification` returns false for it; the gate keeps refusing
   every unqualified MODE exactly as it does today. Costs one field and one branch, and it makes the
   distinction the gate was always implicitly about. **Recommended.**
2. Let `candidateProfile` carry `qualified: false` and let `apply` accept `false` for profiles with
   no `mode`. Cheaper, but it overloads a field whose whole meaning is «acceptance said so», and a
   later reader would have to reconstruct why a `false` is sometimes allowed through a gate that
   exists to stop exactly that.
3. ~~`candidateProfile` sets `qualified: true`~~ — **refused.** That field is set by phase 6's
   acceptance, and writing it anywhere else is the false-`[TESTED]` fraud class wearing another name.

Whichever lands: the `descend` suite must go GREEN as the proof, and one block must assert that an
unqualified **MODE** is still refused — otherwise the fix would have widened the gate instead of
narrowing its subject.

## Decisions made without the owner

- **Filed first, patched second — and the order mattered.** The bug was written up with three ranked
  options BEFORE any code changed, so the option that shipped could be compared against the ones that
  did not. Option 3 (`qualified: true` on a candidate) is recorded as REFUSED rather than omitted,
  because a later session will think of it again.
- **The default is the STRICT side.** An absent `kind` means «shipped», so the exemption has to be
  claimed explicitly. The opposite default would make every future profile that forgets the field
  slip past the acceptance gate — the gate would have been widened by an oversight rather than by a
  decision.
- **The applier was NOT touched.** The gate's rule is unchanged; only the format learned to say which
  kind of state it describes. A fix inside `apply()` would have put an exception in the one module
  that writes to the owner's card, where exceptions are exactly what nobody should have to reason
  about later.
- **A measurement may not carry `qualified` at all** (not even `false`). `false` would read as «a
  candidate awaiting acceptance», which is a claim about a future that will never come for a state
  released seconds later.
- **Not marked as blocking A1.** A1 was offline and made no writes; this blocked A2.

## Links

- `automation-engine/lib/ladder-descent.mjs` → `candidateProfile`
- `automation-engine/lib/profile-store.mjs` → `requiresQualification`, `validateProfile`
- `automation-engine/lib/profile-manager.mjs` → `apply` (the gate, ~line 243)
- `automation-engine/lib/vf-step.mjs` → `runStep`, the `pinMhz` branch
- `plans/06_DONE_epic01_phase3_shell.md` §4.2 (where the gate was born) · commit `4bd2e22`
