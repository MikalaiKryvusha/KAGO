# KAIF bug: the 2.9 update deletes the retired hook's script before its `.claude/settings.json` entry is gone — when `wire-hooks` is refused, every tool call runs a hook on a missing file

kaif-fp: .kaif/kaif-core.mjs deprecations × wire-hooks :: retired-script-removed-before-its-entry :: v2.9
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/154
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF 2.9 · project KAGO · sphere programming · language ru ·
tracking origin · agent system claude-code (Claude Opus 5.5, VS Code extension, auto mode) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "dangling" bugs/KAIF/` → none) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state all --search "dangling hook"` → #57, #93, #122 — none about hooks;
`--search "Self-Modification"` → #83, #144, #122 — #144 retired the hook, none covers a refused removal). The sibling field report #148
ran `wire-hooks` with the harness silent, so it never met this order. No match found.
**Found:** 2026-10-17, the KAGO 2.8 → 2.9 update (bootstrap route).

## Expected per canon

The update task, item `wire-hooks`, verbatim: «The same run REMOVES the entries of hooks KAIF retired (2.9: `pretool-owner-word.mjs` …).
The write is yours and open to your harness: … if it REFUSES, do not work around it … record its words with `checkpoint wire-hooks
--verdict` and give the owner that one command». So a refusal is a foreseen, legal state of the update — and in that state the project
should still be whole: no hook should point at nothing.

## Got in the field

1. The bootstrap pass, before the task is even written: `- retired .kaif/hooks/pretool-owner-word.mjs (retired in 2.9 …) → successor:
   none — … node .kaif/kaif-core.mjs wire-hooks removes its entry from .claude/settings.json`. The script is deleted.
2. `node .kaif/kaif-core.mjs wire-hooks` → refused by the harness: «Permission for this action was denied by the Claude Code auto mode
   classifier. Reason: [Self-Modification].» (the same refusal KAGO met on the 2.8 update for the same file — `KAGO_KAIF_2.8_UPDATE_REPORT.md`
   R13, #122).
3. `.claude/settings.json` still holds `"PreToolUse": [{ "hooks": [{ "command": "node", "args":
   ["${CLAUDE_PROJECT_DIR}/.kaif/hooks/pretool-owner-word.mjs"] … }] }]`; `check` says so: «⚠ .claude/settings.json still runs 1 hook(s)
   KAIF retired in 2.9: PreToolUse → pretool-owner-word.mjs».
4. What that entry now does on every tool call: `echo '{}' | node .kaif/hooks/pretool-owner-word.mjs` → `node:internal/modules/cjs/loader:1479
   throw err;` · exit 1 (a non-blocking hook error in Claude Code — exit 2 would block; still a spawned node and an error per call until
   the owner acts).

## Repro (deterministic)

1. A KAIF 2.8 deployment with `pretool-owner-word.mjs` wired in `.claude/settings.json` (the 2.8 opt-in).
2. Update to 2.9 by either route; make `wire-hooks` fail (Claude Code auto mode refuses it as Self-Modification; or `chmod -w
   .claude/settings.json`).
3. `ls .kaif/hooks/pretool-owner-word.mjs` → missing; `grep pretool-owner-word .claude/settings.json` → the entry is there.

## Cost and violated invariant

**the project stays whole at every step** (`/kaif-update`: «the project must stay whole and working at every step»): between the
update and the owner's command — hours or days, the owner is not at the machine for every update — the retired hook fires on every
tool call with an error, where the 2.8 script, left in place, would have done its 2.8 job or nothing. Cheap per call, but it is
exactly the kind of noise that teaches an agent to ignore hook errors.

## What in KAIF led to this

The deprecation step (file removal) and the entry removal (`wire-hooks`) are two acts with different owners — the core does the first
unconditionally, the harness may forbid the second — and the first runs first.

Smallest fixes, either one: (a) while a retired hook's entry is still wired, the deprecation step replaces the script with a delivered
no-op stub (`process.exit(0)`, a header naming its retirement) instead of deleting it, and `wire-hooks` / `update-verify` delete the stub
once the entry is gone; or (b) the update leaves the script in place and `wire-hooks` deletes it after a successful removal of its entry.

## Local remediation (per the "defect in KAIF itself" contour, if applied)

KAGO: none taken by the agent (a stub would be a local file the next update must classify); the owner is given the one command
`node .kaif/kaif-core.mjs wire-hooks` in the farewell and in the field report.
