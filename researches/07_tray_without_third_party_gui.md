# Research 07 — a tray icon with zero third-party GUI dependencies

> **Created:** 2026-08-14 00:5x +03:00 (agent; recon for phase 3 step 4.1)
> **Parent:** `plans/06_epic01_phase3_shell.md` §4.1 · `plans/01_EPIC` §9 track Б, step Б1
> **Status:** ✅ verdict reached — PowerShell 5.1 + `System.Windows.Forms.NotifyIcon`; fallback = ship
> without the tray. No code written from this doc yet.
> **Outbound:** — (the fork to the owner is NOT needed: a GUI-free path exists)

The question this doc answers, from the plan verbatim: *candidate paths read from vendor docs, not
recall — for each: message-loop requirements, behaviour when the process dies, elevation
interaction.* The law it answers under: **zero third-party GUI applications in the dependency tree**
(`GOAL.md`, epic AC6).

---

## 1. What the tray must actually do (scope, from the internal map §4)

Display the active mode and nothing else. It reads the remembered-state file written by the applier;
it never touches the card, never elevates, owns no state, and killing it must change nothing
(P3-AC4). This scope is what makes the recon short: we need ONE icon with a tooltip/title and the
ability to swap it when the state file changes — no menu, no clicks, no notifications.

## 2. The API surface (vendor truth)

All Windows tray icons, whatever the language, end at one Win32 call: **`Shell_NotifyIcon`**
(`shell32.dll`) with a `NOTIFYICONDATA` struct ([Notifications and the Notification Area,
learn.microsoft.com](https://learn.microsoft.com/en-us/windows/win32/shell/notification-area)).
Facts read from that page and its neighbours that bind our design:

- **A window handle is required.** `NOTIFYICONDATA.hWnd` associates the icon with a window; events
  come back as messages to that window. Therefore ANY implementation needs a message loop — there is
  no loop-free tray icon.
- **Explorer restart erases icons.** The shell broadcasts the registered `TaskbarCreated` message
  and *"applications should assume that any taskbar icons they added have been removed and add them
  again"*. An implementation that ignores this loses its icon on every explorer crash/restart.
- **A dead process leaves a ghost.** When the owning process exits without `NIM_DELETE`, the icon
  lingers in the tray until the user's mouse passes over it (observed Windows behaviour, widely
  documented — e.g. [the MSDN-forums archive](https://learn.microsoft.com/en-us/archive/msdn-technet-forums/a3232ff6-fa1d-47db-b76a-94f35dae3ccc)).
  **Consequence for P3-AC4:** killing the tray may leave a stale pixel for a moment; it leaves no
  process, no handle, no card state. The AC's meter (`gpu:info --json` diff = 0) is unaffected.
- **Elevation:** notifications from elevated processes are unsupported, and the icon lives in the
  interactive user session's taskbar. **Our tray never needs elevation** — it reads one JSON file —
  so the clean design is: the APPLIER elevates (scheduled task, `researches/03` §3.6), the TRAY runs
  as the plain logged-on user. No interaction between the two beyond the state file.

## 3. Candidates

### Candidate A — PowerShell 5.1 + `System.Windows.Forms.NotifyIcon` ✅ CHOSEN

`NotifyIcon` is the .NET Framework's wrapper over `Shell_NotifyIcon`
([NotifyIcon component, learn.microsoft.com](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/controls/notifyicon-component-windows-forms)).
It is **not a third-party GUI application** — it is the OS's own framework, in the GAC of every
Windows 11 (probed on this machine: `GAC_MSIL\System.Windows.Forms\v4.0_4.0.0.0`), and the host is
`powershell.exe`, already this project's primary shell.

- **Message loop:** `[System.Windows.Forms.Application]::Run($appContext)` with an
  `ApplicationContext` — the documented pattern for a form-less tray script (e.g. the
  [PowerShell Quick Tray](https://hackaday.io/project/187681-powershell-quick-tray) write-ups).
  WinForms requires STA; **probed on this machine: powershell.exe 5.1 starts STA by default.**
  State-file watching rides the same loop as a `System.Windows.Forms.Timer` (or a
  `FileSystemWatcher` whose handler marshals via the context) — no second thread needed.
- **Explorer restart: handled FOR us.** `NotifyIcon` registers `TaskbarCreated` and re-adds itself
  (`WmTaskbarCreated() { _added = false; UpdateIcon(_visible); }`, read in the
  [dotnet/winforms source](https://github.com/dotnet/winforms/blob/main/src/System.Windows.Forms/System/Windows/Forms/NotifyIcon.cs);
  the .NET Framework 4.x lineage carries the same handler). It also brings its own
  `NotifyIconNativeWindow`, so we write no WndProc at all.
- **Process death:** ghost-until-hover as in §2; on a clean exit the script calls
  `.Visible = $false; .Dispose()` (NIM_DELETE under the hood).
- **Console window:** powershell.exe is a console app; `-WindowStyle Hidden` still flashes a window
  briefly ([PowerShell#3028](https://github.com/PowerShell/PowerShell/issues/3028)). The recorded
  native cure is a `wscript.exe` wrapper (WSH `Run(..., 0)`) — `wscript.exe` probed present at
  `C:\Windows\system32\wscript.exe`, ships with Windows
  ([hidden-run patterns](https://robztech.com/post/running-powershell-hidden)). The logon task
  launches the wrapper, the wrapper launches the hidden powershell.
- **Dependency delta: zero.** No npm package, no binary, no install.

### Candidate B — Node + koffi FFI straight to `Shell_NotifyIcon` — rejected (kept as reserve)

The project already drives `nvapi64.dll` through koffi, so calling `shell32.dll` is proven
technique. But the tray needs what NVAPI never did: an own window class (`RegisterClassEx` /
`CreateWindowEx`), a WndProc callback crossing the FFI boundary, a message pump that must not block
Node's event loop (`PeekMessage` on a timer instead of a blocking `GetMessage`), and hand-rolled
`TaskbarCreated` re-registration. Every one of those is a moving part Candidate A gets from the
framework for free. KISS: rejected while A stands; it remains the reserve if A hits a wall live.

### Candidate C — a tiny compiled own helper (C# via `Add-Type` / csc) — rejected

Compiling our own `.exe` at deploy time buys a cleaner process name and nothing else Candidate A
lacks, at the price of a build step, an artifact to sign/trust, and antivirus surface on the
owner's machine. Occam: no.

## 4. Verdict

**Path: Candidate A.** One PowerShell script (`tools/tray.mjs`-style naming will follow the repo
convention, actual carrier `.ps1`), started hidden by the logon task via a `wscript` wrapper after
the re-apply step, reading the remembered-state JSON, swapping icon + tooltip on change. Kill it —
nothing happens to the card (it holds no handles beyond the icon); explorer restart — the framework
re-adds the icon; elevation — never.

**Fallback, named per the plan:** ship phase 3 **without the tray**. The owner's wording makes it a
nice-to-have (*«Будет хорошо, если…»*, `GOAL.md`), and only display is lost. The fork to the owner
is NOT raised — a GUI-free path exists.

## 5. What 4.5 must still prove by observation (this doc proves nothing live)

- The icon appears and tracks a mode change (state-file edit → icon/tooltip change).
- P3-AC4: kill the tray process → `gpu:info --json` diff = 0.
- Explorer restart (`taskkill /f /im explorer.exe & start explorer`) → icon returns on its own.
- The wscript wrapper leaves no visible console at logon.
