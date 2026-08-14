# Bug 07 — the search walked seven rungs into unproven depth in one run and hung the owner's machine

**Status:** ✅ DONE — cause proved from the machine's own log, three bounds applied and
mutation-proved offline (commit `dfd10d6`), **and the live re-run under those bounds passed with the
owner present, 2026-08-14 23:2x** (see the closing section)
**Version/build:** driver 610.88 · VBIOS 98.03.58.40.8b · `engine.mjs` at commit `a582052`
**When/context:** 2026-08-14 21:14:42 +03:00, the second live band sweep at 2842 MHz in the shipped
shape, minutes after the write-shape quarantine of `bugs/06` was applied

## Symptom

The owner, verbatim: *«картинка компа зависла, компт так висел какое-то время, а затем винда свалилась
по watchdog в черный экран смерти, попросила перезагружки. Сторожа не сработали. Вешает комп наш
алгоритм...»*

**The second time this project has hung his machine.** He lost no work — he had been warned and was
prepared.

## Forensics — from the machine's own log, not from recall

| moment | evidence |
|---|---|
| 21:12:30 | rung **+540 MHz → 885 mV** (−160 mV) — PASS, all three shapes |
| 21:13:05 | rung **+667 MHz → 860 mV** (−185 mV) — PASS, all three shapes |
| **21:14:42** | **unexpected shutdown** (`EventLog` 6008), i.e. **97 s after the last record** |
| 21:16:00 | reboot; `Kernel-Power` 41 «rebooted without cleanly shutting down first» |

No `WHEA-Logger` events, no `Display` 4101 in the window, no minidump (dumps are off on this machine,
and a GPU hang rarely writes one). **The rung that killed the machine left NO record at all** — the
process died with the OS before any verdict could be written.

Card state after the reboot, verified: **0 non-zero offsets of 128**, power limit 300 W factory,
watchdog record absent. Volatility did what R10 says is the only layer that always works.

## Why no guard fired, and none could

`R10`: **three of the four rollback layers require a live operating system.** The writer's `finally`,
the detached watchdog process, and Windows TDR all need a scheduling kernel. A hard hang schedules
nothing. The fourth layer — profiles live in volatile GPU memory — is what returned the card, and it
needs a reboot rather than a guard.

**This was stated to the owner in this same chat, an hour before it happened**, in answer to his
question «сторож сможет это быстро выявить и откатить?». The answer given was «при жёстком зависании
это до перезагрузки», and that is exactly what occurred. The prediction being correct did not make
the run safe — it made the run's bounds the only thing that mattered, and they were missing.

## Root cause — two halves, and the first one is mine

**(a) The agent removed the only bound that was holding the search shallow.** One hour earlier the
ratchet limit `≤ 540 MHz` for point 95 was quarantined away as «evidence from a different experiment»
(`bugs/06`). The REASONING was correct — that limit came from a single-point-shape run that died at
~3400 MHz, a state the shipped shape cannot reach. The CONSEQUENCE was not thought through: correct
or not, it was the only thing keeping the ladder short, and removing it let the search walk **0 →
−185 mV in one run** on a shape whose history was empty.

**(b) Nothing bounded the TOTAL distance travelled beyond proven ground.** The depth governor
(`pickAscentRungs`) bounds how COARSELY the search descends — first step ≤ 25 mV, gap ≤ 35 mV — and
every step that night obeyed it. It has nothing to say about walking seven small, legal steps into
territory nobody has ever tested. That was the hole.

## What the graded oracle saw, and it is the finding the owner asked for

He proposed searching by rising corruption rather than by machine death. The data says the detector
had nothing to report:

| rung | depth | badElemsMax | faultRate | bitDistMin | launches |
|---|---|---|---|---|---|
| +7 | −5 mV | 0 | 0 | 0 | 6630 |
| +90 | −35 mV | 0 | 0 | 0 | 6407 |
| +195 | −70 mV | 0 | 0 | 0 | 6314 |
| +300 | −100 mV | 0 | 0 | 0 | 6220 |
| +412 | −130 mV | 0 | 0 | 0 | 6261 |
| +540 | −160 mV | 0 | 0 | 0 | 6194 |
| +667 | −185 mV | 0 | 0 | 0 | 6289 |
| next | ~−215 mV | — | — | — | **hang** |

**Zero, zero, zero — then a cliff.** The meter ran (6000+ launches per rung); it had nothing to see.

**Why, and it does not refute his idea — it sizes it.** `researches/02` §2 measures the avalanche as
3 % → 90 % error rate across **2 % of voltage** ≈ 20 mV at this operating point. The ascent stepped
**30 mV** at a time, so it stepped OVER the entire avalanche region, landing either before it or past
it. The detector was never given a chance to fire.

## The fix as applied (commit `dfd10d6`, offline, zero GPU writes)

1. **Beyond proven depth the step becomes FINE** — every rung (5 mV), not every fifth. The owner's own
   proposal made executable: land INSIDE the avalanche instead of striding over it.
2. **The write-ahead mark.** A rung is recorded BEFORE it is attempted. If the run does not come back,
   the mark survives carrying `verdict: null`, which the ratchet already reads as «not a pass» — so
   the rung that hung the machine is forbidden forever, with no new rule needed. **Before this, the
   fatal rung left no trace and the next run would have walked onto it again.**
3. **`SESSION_MAX_DEPTH_BEYOND_KNOWN_MV = 30`** — a session may go at most one coarse step deeper than
   the deepest PASS it inherited. Derived, not chosen: ≥ one avalanche width (~20 mV) so the search
   can still land inside it, ≤ one coarse step so a fruitless session still makes exactly one step of
   progress.

**Order turned out to be a safety property**, and a guard caught it before any card did: the first
draft composed the ladder and then governed only part of it, letting frontier rungs bypass
`pickAscentRungs` entirely. The `bugs/03` block «ОТКАЗ СТОРОЖА СЛУЧАЕТСЯ ДО ПЕРВОЙ ЗАПИСИ» went red.
The governor now runs FIRST on the whole ladder; the session bounds may only REMOVE rungs it blessed.

**And the mutation harness found the hole in the fix itself:** the mutation «walk past the session
depth ceiling» reddened NOTHING — the most important new bound was guarded by no block at all. The
block was written; the mutation reddens.

Suites after the fix: `engine` 67 · `vf-step` 29 · `vmin-store` 38 · `profile-store` 30 ·
`profile-manager` 29 · `descend` 39 · `stress` 55 · `watchdog` 21 · `power` 28 · shape green.
Fourteen mutations, each reddening the addressee named for it before the run.

## What is measured about this card, and it survived only because it was printed into the chat

The evidence store was destroyed later the same evening (`bugs/08`), so these numbers are
**reconstructed from this session's own output** and are marked as such rather than re-entered into
the store as if measured:

- at 2842 MHz in the shipped shape, this card **PASSED every load down to 860 mV** (stock 1045 mV,
  i.e. **−185 mV**) with zero corruption counted at every rung;
- the rung after that **hung the machine**;
- so the edge at 2842 MHz lies between −185 mV and roughly −215 mV, and it is a **cliff, not a slope**.

## Decisions made without the owner

- **The bounds were applied before any re-run**, without asking. Method is the agent's (EXP-0026), and
  the owner had said plainly that hand-driving atoms is not what he wants — he wants the engine fixed.
- **The lost numbers were NOT written back into the ratchet.** A record with no measurement behind it
  is fabricated forensics that a later session cannot tell from the real thing (EXP-0025). They live
  in this document, labelled as reconstruction.
- **`bugs/06`'s quarantine was kept, not reverted.** It is correct: a single-point crash at ~3400 MHz
  says nothing about a capped shape. What was missing was a bound of its own, and that is what was
  added — reverting a correct fix to compensate for a missing one would have hidden both.

## Links

- `automation-engine/engine.mjs` → the ascent ladder, `markAhead` · `config.SESSION_MAX_DEPTH_BEYOND_KNOWN_MV`
- `automation-engine/lib/vmin-store.mjs` → `resolveAttempts`
- `bugs/03` (the first hang, and rule R10) · `bugs/06` (the quarantine whose removal uncovered this)
- `bugs/08` (the evidence store lost the same evening) · `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` → R10
- `bugs/09` (the plan could not SHOW this bound — found by the very dry run this re-run required)
- `bugs/10` (found BY this re-run: the proven depth is already invisible to the next session)

## ✅ STATUS: DONE (2026-08-14 23:3x +03:00) — the bounds were proved ON THE CARD, not only by mutation

`npm run engine -- --band 2842 --seconds 10`, owner present and warned (S1), after the dry run had
printed what would happen (`bugs/09` made that line exist at all).

**Observed, in order:** five rungs, every one PASS by the three-shape set, `branchy/sustained` the
deciding shape on each · the engine STOPPED ITSELF at −30 mV — *«край НЕ встречен: лестница
кончилась на 60 МГц (это НАШ предел, а не карты)»* — which is the session bound doing exactly its
job · the machine stayed alive.

| rung | serving mV | from stock | delivered under load |
|---|---|---|---|
| +7 | 1045 | −5 | 2827 (max 2835) |
| +22 | 1035 | −15 | 2835 (max 2850) |
| +30 | 1035 | −15 | 2827 (max 2835) |
| +45 | 1020 | −30 | 2827 (max 2835) |
| +60 | 1020 | −30 | 2827 (max 2835) |

Taken at **point 96** (stock 1050 mV) — the point is named because it turned out to matter
(`bugs/10`). The ceiling held under load on every rung.

**Rollback proved by READING, not by exit code** (the owner's-machine rule, step 4): **0 non-zero
offsets of 128**, watchdog not armed, power limit 300 W factory, card 41 °C. The store carries 20
records = 5 rungs × (one write-ahead mark + three shapes), and every mark was resolved by a verdict —
i.e. the run survived every rung it started, which is the write-ahead mark's whole purpose.

What this does NOT claim: the edge. It was not met, by design — this session was allowed one bounded
excursion and used it. The edge at 2842 MHz still lies somewhere near the reconstructed −185…−215 mV,
and reaching it now depends on `bugs/10` first.
