# Bug 39 — console windows appear at logon, and two of them are KAGO's

**Status:** 🟡 PARTIAL — KAGO's own offender is FIXED and measured; the rest is an inventory with
one item awaiting the owner and one belonging to a neighbouring project
**Version/build:** `main` @ `c9b9012` · **When/context:** reported by the OWNER 2026-08-23 in chat

The owner, verbatim:

> *«При загрузке компьютера появляется несколько терминалов, что-то от node — мне не нравятся
> терминалы, которые я вижу, на запуске компьютера. Нужно установить, чьи они, нужны ли они, можно
> ли их скрыть, чтобы то, что они делают, работало в фоне Window… но не открывали окна терминала.»*

> This is the **fourth** time the owner has reported terminal windows in his OS (`bugs/17` carries
> the first three). `bugs/17` found the cause of windows appearing DURING work — a neighbour's task
> repeating every 5 minutes. This document is the LOGON case, which that investigation never
> covered, and it turned out that KAGO owned one of the offenders all along.

## Symptom

Console windows appear on the screen while the machine finishes logging in. The owner names node.

## Forensics — the complete inventory, taken by enumerating live windows and their owners

Boot 2026-08-23 14:43:55; the scheduler fired its logon batch at **14:44:14**.

### Windows that PERSIST (real `ConsoleWindowClass` windows, alive as of 14:5x)

| pid | window title | what raised it | whose |
|---|---|---|---|
| 15612 | «Администратор: …powershell.exe» | `powershell -NoProfile -Sta -ExecutionPolicy RemoteSigned -File F:\KLAS\tools\klas.ps1 -Action tray` — **no hide flag at all** | neighbour project KLAS |
| 17732 | «Администратор: …powershell.exe» | `powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File F:\KLAS\tools\gpu-watch.ps1` · repeats every 5 min | KLAS — the `bugs/17` culprit |
| 11732 | «Администратор: …powershell.exe» | `powershell … -WindowStyle Hidden -File D:\work\ai_sandbox\KAGO\automation-engine\tray.ps1` | **KAGO's tray** |
| 19876 | «openclaw-gateway» | `node … openclaw.mjs gateway run`, parent is pid 15612 | started BY KLAS |

### Windows that FLASH and vanish (one-shot tasks in the 14:44:14 batch)

| task | action | `Hidden` | principal | whose |
|---|---|---|---|---|
| **`\KAGO\boot-apply`** | `C:\Program Files\nodejs\node.exe "…\profile-manager.mjs" --boot-apply` | False | Interactive / Highest | **KAGO** ← the node the owner names |
| `\EdgeUpdate` | `cmd.exe /c auditpol /set /category:"Система" …` | False | Interactive / Highest | created 2024-09-10 under the owner's account; the NAME is misleading — it does not update Edge |

Not offenders, recorded so nobody re-investigates them: `\KAGO\tray` and both KLAS tasks launch
through `wscript //B`, which is a GUI-subsystem host and draws nothing itself; the real Edge
updaters (`\MicrosoftEdgeUpdateTaskMachineCore` / `…MachineUA`) run as SYSTEM in session 0 and
cannot draw a window at all; PM2's `Run` key goes through `invisible.vbs`.

## Root cause — and it is one mechanism, stated once

**`-WindowStyle Hidden` and a minimized `.lnk` hide a window that has ALREADY BEEN DRAWN.** A
console-subsystem binary (node.exe, cmd.exe, powershell.exe) gets a console allocated by Windows at
process creation; a task with an `InteractiveToken` principal draws that console in the owner's
session. The flag then hides it — one frame later. That frame is what the owner sees.

`bugs/17` had already recorded the second half of the mechanism: Windows 11's "default terminal
application" was **«Let Windows decide»** (`DelegationConsole`/`DelegationTerminal` =
`{00000000-…}`), which resolves to Windows Terminal — and Windows Terminal windows outlive the
process that caused them, leaving EMPTY windows behind.

**The cure the project already owned:** `tray-launcher.js` runs the tray through
`WScript.Shell.Run(cmd, 0, …)` — `SW_HIDE` **at creation**, so no frame is ever visible. Its own
comment names the reason and cites `researches/07` §3 and PowerShell#3028. `\KAGO\boot-apply` was
the one call site that never got it.

## The fix, and the measurement that proves it

A throwaway twin task (`\KAGO-probe\flash-probe`, deleted afterwards) ran a harmless node payload —
no GPU write anywhere in the experiment — while an `EnumWindows` sampler polled every 100 ms for
console-class windows that APPEARED, recording whether each was EVER visible.

| run | new console windows | **ever-visible** | task exit code |
|---|---|---|---|
| **RED** — `node.exe` named directly as the task action | 2 | **2** (a `CASCADIA_HOSTING_WINDOW_CLASS` titled `C:\Program Files\nodejs\node.exe`) | 42 ✅ |
| **GREEN** — `wscript //B` + launcher | 2 | **0** | 42 ✅ |
| **LIVE** — the real `\KAGO\boot-apply` after the fix | 1 | **0** | `LastTaskResult = 0`, journal gained `intent` + `applied` at 250 W |

Shipped in `c9b9012`:

- **`automation-engine/boot-apply-launcher.js`** — the deliberate twin of `tray-launcher.js`, with
  ONE difference: it WAITS and exits with the child's code, because `LastTaskResult` is the receipt
  STATUS's reboot recipe reads. A wrapper returning its own zero would launder an applier failure
  into a green task result.
- **`setup-desktop.mjs`** registers the task in the new form — otherwise the next `npm run setup`
  would silently restore the flash (a truth↔mirror pair). The read-back now asserts the WRAPPER, not
  merely `RunLevel` + trigger: a check looking only at those would stay green on exactly the defect
  it exists to prevent.

Machine-side changes, each with its rollback receipt written to `runs/shell/rollback/` BEFORE the
change (authorised by the owner in chat, *«разрешаю всё»*):

| change | rollback |
|---|---|
| `\KAGO\boot-apply` action → `wscript //B` + launcher | `KAGO-boot-apply.BEFORE.xml` |
| default terminal → Windows Console Host `{B23D10C0-…}` | `default-terminal.BEFORE.json` |
| `\EdgeUpdate` → **Disabled**, not deleted | `EdgeUpdate.BEFORE.xml`, `Enable-ScheduledTask` |

## What is NOT fixed — named rather than left to be discovered

1. **KLAS's two persistent PowerShell windows** — `klas.ps1 -Action tray` (no hide flag at all) and
   `gpu-watch.ps1`. **A neighbouring deployment is read-only evidence and is never edited from
   here** (`AGENT_GUIDE.md`). The cure for them is the same shape: either a `wscript //B` launcher,
   or the task set to "run whether the user is logged on or not" (session 0, no window can exist).
2. **🔴 THE SAME DEFECT CLASS IS STILL LIVE ON THE MODE SHORTCUTS, and it was left alone on
   purpose.** Every desktop `.lnk` targets `C:\Windows\System32\schtasks.exe` — a console binary —
   and the `\KAGO\apply-*` task it triggers runs `node.exe` directly. **So switching a mode by
   double-click flashes two consoles in a row.** The owner reported the BOOT case, and re-writing
   his Desktop shortcuts without asking is a wider blast radius than the report justifies. The cure
   is known and identical; it needs one sentence from him.
3. **The owner's own eye on a real logon.** The sampler measures window visibility, which is the
   mechanism; a logon also runs a dozen other tasks. `AGENT_GUIDE.md` is explicit that where the
   observation is beyond the agent's reach, the honest report says so.

## Decisions made without the owner

- **The tray was NOT moved to session 0**, although that removes windows absolutely. A tray icon
  lives in the interactive session by definition — the move would have removed the icon along with
  the window. The tray already uses the launcher and does not flash.
- **`boot-apply` was NOT moved to session 0 either**, though it would also work. Running as SYSTEM
  would change the ownership of `runs/shell/boot-apply.jsonl`, which the owner's own CLI appends to
  — a new failure mode traded for a solved one. The wrapper solves it with no new entity.
- **`\EdgeUpdate` was disabled, not deleted.** Disabling is the more reversible of the two, and the
  owner's answer was *«не помню, не уверен»* — uncertainty is a reason to keep the artifact.
- **The real Edge updater tasks were NOT touched.** The owner said he does not need Edge updates,
  but those tasks run in session 0 and draw nothing, so they are not part of this defect; turning
  off a browser's security updates is a separate decision that is his to make deliberately.
- **`\EdgeUpdate`'s own effect was not undone.** Disabling the task stops it from RE-APPLYING the
  audit policy at each logon; the policy already set on the machine was left as it is.

## Links

- `bugs/17` — the first three reports, the 5-minute neighbour task, and the mechanism this document
  reuses; EXP-0083 carries its two refuted theories.
- `researches/07` §3 — `WScript.Shell.Run(…, 0)` recorded as the native cure.
- `automation-engine/tray-launcher.js` — the proven original this fix twins.
- `researches/14` — the locked-machine research, which shares the session-1 subject matter.
