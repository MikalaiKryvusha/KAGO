# Bug 11 — an uncapped curve raise was applied beyond the envelope it was proven in, and the machine BSOD'd

**Status:** 🔴 OPEN
**Version/build:** driver 610.88 · VBIOS 98.03.58.40.8b · `profiles/optimised.json` as of commit `bd30ea3`
**When/context:** 2026-08-15 ≈09:58 +03:00, session 20, while measuring the FPS price of `Optimised`
on the Q2RTX bench (STATUS handoff item 2). **The owner was at the machine and lost his session.**

---

## Symptom

`npm run profile -- --apply optimised --witness` applied the mode. Within ~2 minutes, **on the idle
desktop with no game running**, Windows bugchecked:

```
Код остановки: SYSTEM_SERVICE_EXCEPTION (0x3B)
Что вызвало проблему: nvlddmkm.sys
```

`nvlddmkm.sys` is the NVIDIA display driver. The machine rebooted; the owner lost whatever was open.

## Timeline (stamps from the run records and the Windows log, not from memory)

| moment | event |
|---|---|
| 09:55:40 | stock capture `s20-stock-a-b2` — 53.536 FPS, card factory |
| 09:56:35 | stock capture `s20-stock-a-b0` — 76.564 FPS, card factory |
| ≈09:58 | `--apply optimised --witness` — curve +592 MHz (no cap), power limit 250 W |
| ≈09:58 | **the applier's own read-back printed `3180 MHz`** |
| 09:59:52 | `Microsoft-Windows-Kernel-Power/41` — unexpected shutdown (the bugcheck) |
| 10:0x | reboot; card verified factory (300 W, curve offsets identical to the pre-write reading) |

**It died with no load of ours running.** The next bench capture had not started; the only work on the
card was the desktop compositor and the owner's background apps.

## Forensics

- Photo of the bugcheck screen (owner, chat 2026-08-15): `SYSTEM_SERVICE_EXCEPTION (0x3B)` ·
  `nvlddmkm.sys`.
- `npm run events -- --last 6h` → `CRASH`, `Kernel-Power/41` at `2026-08-15T06:59:52.376Z`
  (= 09:59:52 +03:00). `WHEA-Logger`, `Display`, `WER-SystemErrorReporting` — zero events (this
  machine has no history on those providers; see the environment dossier).
- No `MEMORY.DMP` / minidump on disk — nothing further to read from the dump path.
- **The applier printed the cause in its own output, three lines before the crash:**

```
    кривая V/F: подъём +592 МГц, ПОТОЛКА НЕТ (пишется через NVAPI)
    ⚠️  БЕЗ ПОТОЛКА карта уйдёт на частоты ВЫШЕ измеренных: андервольт проверялся
        на точке, обслуживавшей потолок, а выше её обслуживают другие точки.
ПОСЛЕ   : 250 Вт ... · частота 3180 МГц
```

## Root cause

The undervolt in this profile was measured **only inside a bounded envelope**: three live descents on
2026-08-14/15 walked the point serving **2842 MHz** down to **870 mV**, with the written shape being
*whole curve raised + ceiling at 2842*. Every PASS in that evidence belongs to that ceiling.

At the end of session 18 the ceiling was removed from the profile on the owner's word — `capMhz: 2842
→ null` (commit `bd30ea3`) — turning the shipped shape into a **uniform raise with no ceiling**. The
raise itself was left at the value found under the ceiling.

With no ceiling, the raised curve lets the card boost far past the tested region: the read-back was
**3180 MHz**, which is not only 338 MHz above the validated 2842 — it is **above the card's own
reported maximum of 3090 MHz** (`npm run gpu:info`). Clocks in that region are served by curve points
that were never validated at the lowered voltage, so the driver faulted on the first real graphics
work: exactly the failure the applier's warning describes.

**The envelope was not carried with the number.** `deltaMhz: 592` is meaningless without "…proven up
to 2842 MHz", and the profile format has no field for the second half, so removing the cap silently
voided every PASS behind the first half.

## Why nothing stopped it — two failures, both real

**1. Machine failure: the same rule is a GATE on one path and a PRINTF on the other.**

| path | behaviour with `capMhz: null` |
|---|---|
| `vf-step.mjs:1770` — `--shipped-shape`, the agent's manual path | **REFUSES:** *«--shipped-shape требует --cap <МГц> — без потолка это не отгружаемая форма, а равномерный подъём»* |
| `profile-manager.mjs:1575-1577` — `--apply`, **the path the owner's desktop shortcut uses** | prints `⚠️ БЕЗ ПОТОЛКА…` and writes |

The guard exists. It is installed on the path used by the agent under supervision, and missing from
the path that ships to the owner's Desktop. `GPU_TUNING_RAILS.md` I1-AC2 requires every rule to carry
either a machine gate or a STOP line; this one carries a console warning, which is neither.

**2. Operator failure, and it is mine.** The warning fired, I read it, I quoted the very field it was
about in the chat ("мерить буду равномерный подъём +592 МГц без потолка"), and I proceeded. The
read-back then printed `3180 MHz` next to a validated 2842 — two independent observations on my screen,
both pointing at the same thing, and I treated the applier's warning as narration instead of as a
verdict. `GPU_TUNING_RAILS.md` §4 STOP line 6 is exactly this: *«a guard that fired and got explained
away is a guard that did not fire»*.

## Twin check

`TWINS: searched every site that writes a curve raise (grep 'curveRaiseAndCapMhz', 'ПОТОЛКА НЕТ',
'--cap') — found 2 write paths and 1 reader:`

- `vf-step.mjs` `--shipped-shape` — **guarded** (refuses without `--cap`).
- `profile-manager.mjs` `apply()` — **unguarded**, this bug.
- `profile-store.mjs:405,627` — a READER: it describes `capMhz: null` as legitimate («равномерный
  подъём… выигрыш уходит в частоту») and validates the profile as OK. It never asks in what envelope
  the raise was proven, so `npm run profiles` reported this profile as fine both before and after the
  crash.
- `engine.mjs --search --cap C` requires a cap by construction (refuses below the curve floor), so the
  search side cannot produce an uncapped shape — only the profile file could, and did.

## Fix plan

1. **A curve raise carries the envelope it was proven in.** Add a required field to the profile format
   next to `curveRaiseAndCapMhz` — the maximum clock at which the raise was validated (here: 2842).
   A raise with no proven envelope is not a profile.
2. **`profile-manager.apply()` REFUSES before the device write** when the applied shape can reach a
   clock above that envelope — which `capMhz: null` always can, and which a cap above the envelope
   also can. Turn the existing `console.log('⚠️ БЕЗ ПОТОЛКА…')` into the refusal it should have been.
3. **`profile-store` validates the pair**, so `npm run profiles` reddens on a profile whose raise
   exceeds its own proven envelope instead of printing OK.
4. **Guard proved red first** (`BUG_FIXING_FRAMEWORK.md` → Guards): the fixture is
   `profiles/optimised.json` exactly as it stood at commit `bd30ea3` — the file that caused this
   bugcheck must make the new block fail, and the same file with `capMhz: 2842` must pass.
5. **Reconcile with the owner's decision, do not overturn it.** He asked for a uniform raise with no
   ceiling; that is a legitimate mode shape (it is what `Max Perfomance` is). What is illegitimate is
   shipping it with a raise measured under a ceiling. The honest paths are: re-measure the edge with
   no ceiling (the card decides how high it boosts), or keep the ceiling for `Optimised`. **This is a
   vision-level fork → interview, not an agent decision.**

## Decisions made without the owner

- Verified the card returned to factory by READING it (300 W; curve control struct shows 6 nonzero
  words of 2312 — byte-identical to the pre-write reading taken at 09:4x the same morning) rather than
  trusting volatility. No further write was made.
- Did NOT re-apply anything, did not attempt to reproduce the crash, and did not continue the FPS
  measurement — the measurement is blocked on the fork above.
- Filed this document before writing anything else, so the incident is not held in a session's head.

## Links

- `bugs/03` — the first hang (5 h 40 min), where R10 was born: at depth, step size is the only
  protection. Same family: an unvalidated state reached the card.
- `bugs/02` — the cap/undervolt relationship; step 3 (re-measure the edge) is still open.
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R11 (a ceiling must be held by something and the run names by
  what) and R12 (a property that was a proof under the old shape is measured under the new one, never
  inherited). **R12 predicted this bug in words and did not stop it in code:** removing the ceiling is
  precisely a shape change that voided a proof.
- `plans/05` §4.5 — «Optimised = ceiling at the stock operating clock», the definition the cap came from.
- Commit `bd30ea3` — where `capMhz` became `null`.
