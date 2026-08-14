# Bug 05 — the qualification gate refuses the MEASUREMENT pin, so every pinned run is blocked

**Status:** 🔴 OPEN — cause proved offline, deterministic, **not patched on purpose** (it is a change
to a safety gate, and the fix is a design call inside the profile format)
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

## Fix plan — ranked, NOT applied

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

- **Filed rather than patched, deliberately.** It is a safety gate on the one module that writes to
  the owner's card, the fix is a format decision, and it was found at the end of a session. `bugs/02`
  paid for the opposite choice: *«the correction is a design decision… and it is the kind of choice
  this project has already paid for making at speed»*.
- **Not marked as blocking A1.** A1 was offline and made no writes; this blocks A2.

## Links

- `automation-engine/lib/ladder-descent.mjs` → `candidateProfile`
- `automation-engine/lib/profile-store.mjs` → `requiresQualification`, `validateProfile`
- `automation-engine/lib/profile-manager.mjs` → `apply` (the gate, ~line 243)
- `automation-engine/lib/vf-step.mjs` → `runStep`, the `pinMhz` branch
- `plans/06_DONE_epic01_phase3_shell.md` §4.2 (where the gate was born) · commit `4bd2e22`
