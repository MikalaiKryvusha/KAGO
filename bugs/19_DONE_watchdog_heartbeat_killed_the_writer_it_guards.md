# Bug 19 — the watchdog's heartbeat killed the live sweep it was guarding (EPERM on rename, Windows)

**Status:** ✅ DONE — fixed `c5f2717`, verified by reading the shipped code 2026-08-16 23:2x
**Version/build:** `main` @ `dce8007` · driver 610.88 / VBIOS 98.03.58.40.8b · Node v24.15.0 · Windows 11 Pro 10.0.26200
**When/context:** 2026-08-16 ≈16:5x +03:00, during the first full-range live sweep
(`engine --sweep --from 2887 --to 900 --max-depth 50 --dashboard`). Killed the run at 41 burns of 94.

## Symptom

The sweep died mid-rung with an uncaught exception. Not a card failure — the card had passed every
one of its 41 burns:

```
2542 МГц ← 895 мВ (глубина −50 мВ)
таблица уехала: 895 мВ обслуживало 2362 МГц, теперь 2355 МГц — ступень считается по СВЕЖЕЙ таблице

Error: EPERM: operation not permitted, rename
  'D:\work\ai_sandbox\KAGO\runs\watchdog\armed.json.tmp'
    -> 'D:\work\ai_sandbox\KAGO\runs\watchdog\armed.json'
    at Object.renameSync (node:fs:1013:11)
    at writeArmed (lib/watchdog.mjs:119:6)
    at Object.beat (lib/watchdog.mjs:177:7)
    at onShape (lib/vf-step.mjs:762:35)
    at Module.judgeCandidate (lib/stress-tester.mjs:621:18)
    at async Module.runStep (lib/vf-step.mjs:754:22)
    at async runRung (engine.mjs:652:16)
  errno: -4048, code: 'EPERM', syscall: 'rename'
```

**The safety net held, and that is the one good thing here.** Verified by READING the card
afterwards, not by inference: watchdog `СТОРОЖ НЕ ВЗВЕДЁН` · power limit 300 W (factory default) ·
P8 / 45 °C · V/F curve top `1240 mV → 3172.0 MHz`, which is this specimen's factory table. The
`finally` chain (R10a) unwound on the way out and left the card stock.

**What was banked:** the tuning-curve document went from 9 closed frequencies to **30 of 389**
(deepest −145 mV, average −52.3 mV). Every closed point was saved before the next rung started
(R16a), so nothing measured was lost.

## Repro (deterministic)

Not yet reduced to a one-liner — it is a timing race and it fired once in ~400 beats. The mechanism
is deterministic and can be forced:

1. Arm the switch (`watchdog.arm`), which spawns the detached guard.
2. Hold `armed.json` open for reading in another process.
3. Call `beat()` → `renameSync` fails EPERM.

The selftest guard planned below reproduces it by injecting an `fs` whose `renameSync` throws
`EPERM`, which is the honest way to test it: the race itself is not schedulable, the RESPONSE to it
is what must be correct.

## Root cause

Two faults, and the second is the one that matters.

**1. The mechanism.** `writeArmed` (`watchdog.mjs:113–120`) writes a temp file and renames it over
`armed.json`, on every beat. The detached guard polls that same file continuously
(`readArmed` → `readFileSync`). On Windows a rename onto a destination another process holds open
returns `EPERM` — so the writer and its own guard race over one file, once per burst, for the whole
run. Over hundreds of beats a collision is not a risk, it is a schedule.

The write-then-rename is not wrong in itself — the comment above it is correct that a torn read
would be a watchdog firing on garbage. It is wrong to do it *repeatedly against a live reader*.

**2. The direction of the failure, and this is the defect.** `beat()` is a lease RENEWAL. If a
renewal fails, the correct outcome is «the lease was not renewed» — the deadline stands, and if
beats keep failing the guard fires and restores the card. That is the SAFE direction and the whole
point of having a deadline. Instead the throw propagated out of `beat()`, through the oracle, and
killed the writer in the middle of a GPU write.

**A heartbeat that kills the thing it guards has inverted its own purpose.** Generalisation for
`EXPERIENCE.md`: *a safety mechanism's failure path must point the same way as its purpose.* The
watchdog exists so a dead writer cannot leave the card held; a watchdog that KILLS a healthy writer
is manufacturing the event it was built to survive. This is a sibling of R17's lesson (a guard
causing the very regression it exists to prevent), on the reliability axis rather than the
correctness axis.

## Fix plan

1. **`beat()` never throws.** A failed renewal returns `false`, like the existing
   «already disarmed» path at `watchdog.mjs:175` — a value every caller already tolerates
   (`vf-step.mjs:760,762` discard it). The lease then expires on its own if the failure persists,
   which is the safe direction.
2. **`writeArmed` retries a `EPERM`/`EBUSY` rename** a bounded number of times with a short
   backoff, so the ordinary Windows sharing collision costs microseconds instead of a lease.
3. **`arm()` still THROWS on failure.** Arming is a precondition of the risky write (R9): a write
   that could not arm must not happen. Only the RENEWAL is allowed to fail softly, and the two paths
   must be told apart in code rather than by comment.
4. **Guard, proved red first** (EXP-0008). Mutation addressees, named before the run:
   (a) let `beat()` rethrow → the block «пульс НЕ убивает писателя» reddens;
   (b) make `arm()` swallow the same error → the block «взведение ОБЯЗАНО упасть» reddens;
   (c) remove the retry → the block «переименование повторяется» reddens.
   The `fs` seam is injected, exactly as `journal.mjs` injects it to prove ordering (R15a).

**Blast radius:** `watchdog.mjs` is called by every writing path (`vf-step`, `engine --sweep`,
`nvapi --fan-write`, `descend`, `thermal`). The change makes a previously-fatal path non-fatal; no
caller reads `beat()`'s return today, so no caller changes.

## Decisions made without the owner

- **`beat()` fails soft, `arm()` still throws — the two verbs were split rather than made uniform.**
  The alternative (make everything in the module soft) would have let a risky write proceed with no
  armed guard, which is the opposite defect. Chosen because arming is a PRECONDITION of the write
  while renewing is a lease, and only the lease has a safe failure direction.
- **The rename is retried rather than replaced.** A different transport (a lock-free append, a
  separate lease file) would remove the collision entirely, but it changes the format the detached
  guard reads — a bigger blast radius for a defect whose direction was the real fault.
- **No new emergency stop was added for repeated beat failures.** The deadline already on disk is
  that stop: if renewals keep failing the lease expires and the guard restores the card, which is
  precisely the mechanism this bug had been short-circuiting.

## Links

- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R9 (armed watchdog), R9a (total undo), R10/R10a (rollback
  layers and the list-not-chain rule that made this crash land safely).
- `bugs/03`, `bugs/07` — the two hangs the watchdog exists for. This is the inverse case.
- `bugs/18` — found in the same session; unrelated mechanism, same session's work.
- `bugs/20` — the SECOND defect this crash produced: the death it caused was then blamed on the card.
- `EXPERIENCE.md` EXP-0084 — the reusable lesson (a safety mechanism's failure path must point the
  same way as its purpose).

## ✅ STATUS: DONE (2026-08-16 23:2x +03:00)

Fixed in `c5f2717`. **Closed on evidence rather than on the relay's word:** the shipped
`watchdog.mjs` was re-read at closing time and carries all three parts — `beat()` returns `false`
inside a `catch` instead of throwing (line ~232), the reasoning sits at the definition, and `arm()`
is untouched and still throws. 3 blocks, 3 mutations.

**What is deliberately NOT claimed:** the EPERM race itself has not been re-observed in the wild
since — it fired once in ~400 beats. What is proven is the RESPONSE to it, which is the honest thing
to test: the race is not schedulable, the reaction is.
