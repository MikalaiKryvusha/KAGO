# Bug 140 — 🔄 Stock Default resets the power limit and the clock lock, but NOT the V/F curve offsets

**Status:** 🔴 OPEN — found by code reading + one observed function result; NOT yet observed on the card
**Severity:** S1 — the owner's machine: a click on «Stock Default» after a tuned mode would leave the undervolt
offsets on the card while the shell reports the factory mode
**Version/build:** HEAD 2026-09-25 (`c20980a`) · **When/context:** session 102, 02:1x +03:00, while checking offline
how the mode check's stock smoke (Ш8) will apply `profiles/factory.json`

## Symptom (expected by the code, not yet observed)

✏️ *Corrected 02:1x after an independent skeptic pass: the first edition said «and the tray's Exit» — the tray HAS
no Exit item (`automation-engine/tray.ps1:8` «no menu, no buttons, no click actions»; `lib/tray-autostart.mjs:205`
«the Exit item of `plans/10` §4.5 is not built yet»); and the early return is at `profile-manager.mjs:700`, not
:685. The skeptic CONFIRMED the chain for the shortcut and found no other path that zeroes the curve.*

The Stock Default shortcut runs the scheduled task `\KAGO\apply-factory`, whose action is
`profile-manager.mjs --apply factory` (`automation-engine/setup-desktop.mjs:277`). That path zeroes the power limit
and releases the clock lock but — by the chain below — never zeroes the per-point V/F frequency offsets written by a
previous mode. The card would stay undervolted under a «Stock Default» indicator until a reboot (volatility) or
`npm run profile -- --reset` (`resetToFactory` zeroes the curve with its own backend).

## Repro (deterministic, offline)

1. `node --input-type=module -e "const pm=await import('./automation-engine/lib/profile-manager.mjs'); const fs=await import('node:fs'); console.log(await pm.resolveProfileCurve(JSON.parse(fs.readFileSync('profiles/factory.json','utf8'))))"` → **`null`** (observed 02:1x and re-run 02:26 with this exact command; the first edition's command mixed `require` with top-level await and did not run — caught by the second judge; early return at `profile-manager.mjs:700`: `curveRaiseAndCapMhz`, `curveRef`, `curveSnapshot` all null).
   ⚠️ Not inspected: the INSTALLED task on the machine — the chain reads the installer (`setup-desktop.mjs:277`). Card day, read-only: `schtasks /query /tn "\KAGO\apply-factory" /xml` (from PowerShell).
2. CLI `--apply` (`profile-manager.mjs:3468-3473`): `needsCurve = effCurve !== null` → **false** → `curveBackend = null`.
3. `apply()` (`:1176`): the step «кривая V/F: возврат к заводской (все смещения 0)» exists only under
   `else if (curveBackend && profile.settings.curveRaiseAndCapMhz === null)` → **skipped** without a backend.
   The comment above it says this step «is what makes `factory.json` a reset of ALL state» — the CLI never feeds it.

## Forensics

- `runs/` holds no record of the step «возврат к заводской (все смещения 0)» ever running (`grep -rl` → 0 files).
- Earlier proofs of the factory path checked the power limit only (`setup-desktop.mjs:20`: «apply-factory FROM that
  non-factory state → 300.00 W twice»); P3-AC4 (14.08) predates the curve.
- Since 18.09 the risk is dormant: `Optimised` is refused at every logon (driver 616.92, `bugs`-free line in STATUS),
  so no tuned curve reaches the card through the shell.

- Same gap, harmless in practice (skeptic, 02:1x): boot restore of a remembered FACTORY state calls
  `resetToFactory(b, { timing })` without a curve backend (`profile-manager.mjs:1612`) and logs «кривая V/F НЕ
  трогалась» (`:1434`) — after a reboot the curve is factory anyway (volatile), so nothing is left behind.
- Related stale text, not this bug: `engine.mjs:11374` prints advice about a tray Exit item that is not built;
  STATUS «Решено владельцем» records the owner's 23.08 DECISION for Exit, not a built feature.

TWINS: searched printed advice (`console.log|error` with «Stock Default» / `apply-factory`) and the docs that call the
shortcut a full reset — fixed: `engine.mjs:11374` (`0bb9d2b`), `profile-manager.mjs:3494`, `MASTER_PLAN.md` row,
`profiles/README.md`, `README.md` (both languages) — session 102, after the second judge pass.

## Fix plan (card day, with the owner present — it changes what his shortcut does)

1. `--apply`: open a curve backend also when the profile's curve means «factory» (`curveRaiseAndCapMhz === null` and
   no ref/snapshot), so `apply()` runs its zero-and-read-back step. Smallest form: `needsCurve = effCurve !== null ||
   isFactoryCurve(profile)`.
2. Guard (born with the fix): a `profile --selftest` block — the CLI's backend decision for `factory.json` is TRUE;
   mutation «needsCurve = effCurve !== null» reddens it.
3. Live witness: apply a tuned candidate → click 🔄 Stock Default → `npm run profile -- --state` → non-zero offsets
   **0** of 127. If the curve backend cannot open inside the scheduled task, the click must still reset power and
   clocks and SAY the curve was not reset (never a silent partial reset).

## Decisions made without the owner

- `[AI]` Not fixed tonight: the fix changes the owner's shortcut on the machine he lives on and needs a live witness;
  filed and put first in the card-day order (`plans/102` Ш8).

## Links

`plans/102` Ш8 (card-day order) · `plans/100` (the shortcut is silent when it refuses) · `bugs/139` · R9a (the total
undo covers every kind of state — `resetToFactory` does; the Stock Default path does not)
