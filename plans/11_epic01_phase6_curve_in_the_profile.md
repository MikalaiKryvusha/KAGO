# Plan 11 — Epic 01 / Phase 6, slice 1: the curve enters the profile, and `Optimised` becomes applicable

> **Created:** 2026-08-15 00:1x +03:00 (agent, on the owner's instruction «браться», after he caught the
> session tuning without having named which profile the result lands in)
> **Parent:** `plans/01_EPIC_kago_orchestrator.md` — phase 6. Evidence base: `plans/05` §4.1 and §4.5
> (the shape and the three caps) · `profiles/README.md` (the format canon and the reason the curve is
> NOT in `settings` yet) · `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R1/R2/R9a/R11
> **Status:** 🔲 open · written BEFORE the first line of its code (EXP-0027, the lesson this project
> already paid for once)
> **Outbound:** the applied profile → the owner's Palworld session as the acceptance witness
> (`plans/05` §4.6, interview 001 Q1 = A) · the format change → `profiles/README.md` · closure →
> `MASTER_PLAN.md` phase 6

---

## 0. Why this slice exists, and what the owner actually asked for

He asked to descend to 870 mV, **fix it**, and then run Palworld for five minutes. In this project's own
terms «fix it» has exactly one meaning — put the measured numbers into a profile so a desktop shortcut
applies them — and today that is impossible for a reason `profiles/README.md` states deliberately:

> *«Главный рычаг трёх рабочих режимов — кривая V/F — в `settings` не появляется, пока applier не умеет
> её писать (фаза 6, бэкенд NVAPI): ключ настроек, который модуль молча игнорирует, — это профиль,
> читающийся как делающий то, чего не делает.»*

So the curve is missing from the profile BY DESIGN, and the design says the way to add it is to teach
the applier first. That is this slice. It is deliberately narrow: **one mode, `Optimised`, one cap
(2842 MHz), and the acceptance witness the owner is waiting to run.**

## 1. Goal vector

**The pain.** Phase 5 has measured a real undervolt at the cap that IS `Optimised`'s ceiling
(`plans/05` §4.5: *«Optimised = ceiling at the stock operating clock»*), and the owner cannot use it.
Every number lives in the ratchet store and in a `draft` block that no code reads. The shortcut on his
desktop applies `-pl 250` and nothing else — the main lever, the curve, is not in the artifact at all.

**Where we want to be.** `Optimised` carries its measured curve payload in `settings`; `profile-manager`
applies BOTH parts (curve through NVAPI, power limit through `nvidia-smi`) and undoes BOTH; the owner
launches the mode and plays, and his verdict is what qualifies it.

**Goal types.** *Achieve* — an applicable `Optimised`. *Maintain* — R1 (one writer), R9a (the undo
covers every kind of state written), factory-by-volatility. *Avoid* — a profile that reads as doing
something the applier ignores, which is the exact defect the format canon was written to prevent.

## 2. Entry gate

| Gate | State | Evidence |
|---|---|---|
| A measured undervolt at cap 2842 in the SHIPPED shape | ✅ | three live sweeps 2026-08-14/15, proven to **870 mV** (from 1045 stock), every rung PASS by the 3-shape set |
| The shipped shape's arithmetic exists and is proved | ✅ | `nvapi.buildRaiseAndCapVector`, `--selftest-shape` 31 blocks |
| The ceiling has a named holder and a floor | ✅ | R11: curve holds a cap down to `top − 1000` = 2157 MHz; 2842 is well above it |
| The evidence survives across sessions | ✅ | `bugs/10` — ratchet keyed by absolute millivolts |
| Watchdog armed and proven by firing | ✅ | 2.5 s, drilled |

## 3. Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **P6-AC1** | The profile CARRIES the curve, and the format refuses a curve the card cannot hold. | Scale: hostile fixtures the validator points at the right field for · Meter: `npm run profiles -- --selftest` · **Target: ≥ 5 new fixtures — cap below the curve floor (R11), cap off the measured ladder, delta beyond ±1000 MHz, missing key, wrong shape — each naming its own field** |
| **P6-AC2** | The applier writes BOTH parts and undoes BOTH. | Scale: kinds of state restored after a failed/aborted apply · Meter: `profile-manager --selftest` on an injected curve backend · **Target: curve zeroed AND power limit restored, asserted BY NAME (R9a: never by a count)** |
| **P6-AC3** | The curve write is proved by READ-BACK, not by exit code. | Scale: non-zero offsets read back vs commanded · Meter: the applier's own verify step · **Target: the commanded vector read back equal; a mismatch is a refusal and a rollback, never a warning** |
| **P6-AC4** | The qualification gate is NOT weakened to make this work. | Scale: paths by which an unqualified draft can reach the card · Meter: code read + the P3-AC3 fixture · **Target: 0 from the shortcut/logon path; exactly ONE explicit, named, logged operator path for a witness run** |
| **P6-AC5** | The owner can run the mode and judge it. | Scale: his verdict after a real session · Meter: his own words in chat · **Target: recorded verbatim; his Palworld run is the witness interview 001 Q1 = A already assigned** |

## 4. Steps

### 4.1 — The format learns the curve 🔲

*Anchor: `profiles/README.md` — «настройки черновика не врут»; the key may appear only once the applier
writes it, so this step and 4.2 land together or not at all.*

- [ ] `profile-store.mjs`: `SETTING_KEYS` gains `curveRaiseAndCapMhz` — `{ deltaMhz, capMhz }` or `null`.
- [ ] Validation, each refusal naming its own field: `deltaMhz` integer within the hardware offset range
      (`CLOCK_OFFSET_MIN/MAX_MHZ`); `capMhz` on the card's MEASURED ladder (same rule the lock already
      obeys, naming the two nearest points); **`capMhz` ≥ the curve's floor `top − 1000` (R11)** — a cap
      the curve cannot hold is refused here rather than leaking 57 MHz at runtime.
- [ ] `stock-default` carrying a curve is a refusal (the existing rule: a reset that configures is not a
      reset).
- [ ] New hostile fixtures per P6-AC1, mutation-proved.

### 4.2 — The applier writes the curve, and the undo grows a fourth kind of state 🔲

*Anchor: internal map R9a — «a new writable state EXTENDS the undo BEFORE its first write exists», the
rule fans already paid for; and R1 — `profile-manager` stays the only writer.*

- [ ] A curve backend seam alongside the `nvidia-smi` one (R2: backends are swappable, and the map
      already states the applier composes both for `Optimised`). Injected in the selftest, real in
      production — `nvapi.writeCurve` / `zeroCurve` / `readCurveOffsets`.
- [ ] **THE UNDO LEARNS THE CURVE FIRST, and is mutation-proved, BEFORE the first curve write runs.**
      Order is the rule, not a preference (R9a).
- [ ] The apply step: build the vector (`buildRaiseAndCapVector`), write, **read back and compare**,
      refuse + roll back on any mismatch (P6-AC3).
- [ ] The rollback is a LIST, not a chain (R10a): curve-zero and power-limit-restore each in their own
      `try`, a throw becomes a red step and never cancels the one behind it.
- [ ] `resetToFactory` zeroes the curve too — the third shortcut and every failure path go through it.

### 4.3 — `Optimised` gets its measured numbers 🔲

- [ ] `profiles/optimised.json`: `curveRaiseAndCapMhz = { deltaMhz: <measured>, capMhz: 2842 }`,
      `powerLimitWatts: 250` (the owner's settled lever), a fresh stamp.
- [ ] The `draft` block keeps the provenance — which sweep, which voltage, which date — because a number
      in a shipped artifact must carry its source (`PHILOSOPHY.md` → three doors).
- [ ] **`qualified` stays `false`.** It is flipped by the acceptance in 4.5, by the owner's verdict, not
      by the agent wanting the shortcut to work.

### 4.4 — ONE explicit witness path, and the gate stays where it is 🔲

*Anchor: P3-AC3 — the draft gate lives in the one writer so every surface meets it.*

- [ ] `npm run profile -- --apply optimised --witness` — an explicit, logged operator path that applies
      an UNQUALIFIED profile for an acceptance run. It says out loud that the profile is a draft, what
      it is writing, and how to undo it.
- [ ] **The shortcut and the logon task do NOT gain this flag** (P6-AC4): a draft still refuses there,
      and the P3-AC3 fixture proves it still refuses.
- [ ] The witness run arms the watchdog with a lease sized for a play session, and says so.

### 4.5 — The owner plays, and his verdict is the acceptance 🔲

- [ ] He launches Palworld on the applied mode and plays.
- [ ] Recorded: FPS/feel in his words, plus telemetry over the window (watts, °C, fan) — the mode's own
      criterion is *«FPS ≥ 95 % от Max Perfomance, вентилятор ≤ 60 %, сильное снижение ватт»*.
- [ ] His verdict flips `qualified` — or sends the numbers back to phase 5.

## 5. What this slice does NOT do — boundaries, so drift is visible

- **It does not qualify the other two modes.** `Max Perfomance` and `Silent Cold` need their own caps
  measured (`plans/05` §4.5 wants three caps; ONE is done). This slice ships the mechanism and one mode.
- **It does not close phase 5.** §4.5's band table, §4.6's margin application and §4.7's long burn and
  two watt series are still open, and the profile written here carries a measured-but-not-burned number.
- **It does not touch the shortcuts, the tray or the logon task.** Phase 3's surface is standing and
  this changes only what a profile CONTAINS and what the applier DOES with it.
- **It does not lift the qualification gate.** One explicit operator path is added beside it.

## 6. Risks

**(a) Highest.**

| # | Risk | Defence |
|---|---|---|
| R1 | An applied curve survives a crash of the applier and the card is left undervolted with nobody holding it | The watchdog (R9), armed before the write, and volatility + reboot as the layer that always works |
| R2 | The profile claims a curve the applier silently ignores — the exact defect the format canon forbids | 4.1 and 4.2 land together; a settings key with no writer is not merged |
| R3 | The witness path becomes a back door into the shortcut | P6-AC4 measured as «0 paths from the shortcut», with the P3-AC3 fixture still green |

**(b) Plausible.**

| # | Risk | Contingency |
|---|---|---|
| R4 | The measured 870 mV does not survive a REAL game load (path tracing stresses differently from our compute shapes) | That is exactly what 4.5 is for; a failure there is evidence, and the ratchet records it forever |
| R5 | A driver update invalidates the stamp mid-way | R6 refuses at load, as it already does for every profile |

## 7. Verification map

| Step | The observation that closes it |
|---|---|
| 4.1 | `profiles --selftest` — new fixtures each naming their own field, mutation-proved |
| 4.2 | `profile-manager --selftest` — undo steps asserted by name on an injected curve backend |
| 4.3 | `npm run profiles` — the file loads against the LIVE card, ladder and floor checks green |
| 4.4 | the shortcut path still REFUSES the draft; the witness path applies and says it is a draft |
| 4.5 | the owner's verdict, verbatim, plus telemetry over his session |

## 8. Decisions made without the owner

*(filled at closing)*

- **The witness path is a separate named flag rather than flipping `qualified`.** Flipping it would be
  the agent awarding acceptance to itself, and `profiles/README.md` says acceptance sets that field.
- **One mode, one cap, in this slice.** The mechanism is what unblocks him tonight; the other two modes
  need measurements phase 5 has not taken.
