---
description: Switch this project's KAIF tracking from the user's fork back to the official origin (Mikalai Kryvusha's repo), performing a respectful migration that preserves the project and its content artifacts. Use when the human says "switch back to official KAIF", "track the origin again", "return to upstream KAIF", "вернись на официальный KAIF", "переключись обратно на origin". Trigger aliases (ru): «вернись на официальный KAIF», «переключись обратно на origin»
---

# /kaif-switch-origin — return tracking to the official origin

> ⚙️ **Staleness warning:** this is a lifecycle procedure, and an adopted local copy of it goes stale
> silently across releases. Before following it, verify the procedure against the CURRENT origin
> release notes — the machinery and the release page win over this file's prose.

The inverse of `/kaif-fork`. A project that was tracking the user's own KAIF fork can return to the
official origin (`MikalaiKryvusha/KAIF`), reconciling the two lineages respectfully.

## Procedure

1. **Read `.kaif/kaif.json`** — confirm `tracking: "fork"` and note the current (fork) version.
2. **Confirm with the human** — switching lineages can be significant if the fork diverged a lot. Make
   sure they want the official origin's evolution, not their fork's.
3. **Respectful migration to origin:** fetch the official origin's current `KAIF.md`; diff against
   the deployed (fork-derived) wrapper; apply the same careful 3-way merge as `/kaif-update` — preserve
   local customizations where possible, surface conflicts, **never** touch content artifacts or the
   user's project files.
4. **Switch tracking:** set `origin` back to `https://github.com/MikalaiKryvusha/KAIF` and
   `tracking: "origin"` in `.kaif/kaif.json`; stamp the origin version + date.
5. **Validate, report, commit:** `npm run kaif:check`; summarize what reconciled and any conflicts left;
   commit `chore: switch KAIF tracking to origin vX.Y (DATE)`.

## Notes
- If the fork had valuable improvements, consider contributing them upstream (a PR to the origin) before
  switching, so they aren't lost.
- As always: respectful — the project stays whole and working throughout.
