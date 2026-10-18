# Bug 153 — GIGABYTE Control Center resets the applied mode to factory (at logon, and on some saves)

**Status:** 🔴 OPEN · **Severity:** S2 (the owner silently runs on factory instead of his mode; no hardware harm)
**Version/build:** KAGO 0.9.3 · driver 617.42 · GCC installed 2026-10-18 08:50 · **When/context:** session 113, 2026-10-18
**Fixing:** after the owner's choice (keep GCC / drop it from autostart / uninstall) — a decision about HIS app, not ours

## Symptom

The remembered mode (⚖️ Optimised: 60 raised offsets, 250 W) is replaced by factory (0 offsets, 300 W) with no reboot and no
action of KAGO. Seen three times on 2026-10-18:

| moment | what happened just before | card after |
|---|---|---|
| ≤ 09:01 | GCC installed 08:50, its Performance page opened 08:56 (GCC log) | 0 offsets · 300 W |
| 09:59 | the owner saved fan curve №2 in GCC (09:58:52) | 0 offsets |
| 13:03 | power-loss reboot 12:59:11 → `\KAGO\boot-apply` **applied and re-read** ⚖️ at 13:00:40 (`runs/shell/boot-apply.jsonl`) → GCC (autostart 13:00:21) enumerated the card at **13:00:41** | 0 offsets · 300 W |

Not every GCC save resets: the saves at 10:20:03, 10:39:21, 11:00:20, 11:44:02 left the mode in place (read after each).

## Root cause (hypothesis, ranked)

1. GCC's VGA module applies its own OC profile (`GvProfile\41800_GOC_Profile 1.dat`: `"Oc": false, "Power": 100`, a full VF table)
   when it initialises the card — at its start and on some page actions. That writes a zero offset vector and 100 % power over ours.
   The 13:00:40 → 13:00:41 timing makes this the leading hypothesis; not proven by a controlled repro.

## Repro (not yet run — it writes to the card)

Apply ⚖️ by shortcut → read offsets → close and restart `GCC.exe` → read offsets twice. Expected if hypothesis 1 holds: 0 offsets.

## Options for the owner (his app, his call)

- Keep GCC but remove it from autostart (the fan curve acted with GCC closed, 09:54 control run — survival across a reboot NOT yet checked);
- uninstall GCC (LED setting usually lives in the card; NOT verified);
- keep it as is and re-apply the mode by shortcut after each logon (KAGO cannot win a race it does not see).

## Decisions made without the owner

- `[AI]` the missing snapshot `curves/battle/2026-10-18T11-17-34.json` (referenced by `profiles/silent-cold.json`) committed `9354519`.

## Links

`testcases/reports/2026-10-18_gcc_fan_curve_short_check.md` · `STATUS.md` → machine state
