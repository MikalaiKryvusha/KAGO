// automation-engine/tray-launcher.js — WSH JScript for wscript.exe. NOT a Node module.
// Phase 3 §4.5 (plans/06): the logon task runs `wscript.exe //B` on this file, and this file
// starts the tray's powershell HIDDEN. This wrapper exists because powershell.exe is a console
// app and `-WindowStyle Hidden` still flashes a window (PowerShell#3028); WSH Run(..., 0) is the
// recorded native cure (researches/07 §3, candidate A).
//
// Kept deliberately tiny: resolve our own directory, launch tray.ps1 beside us, exit. No
// parameters travel through here — the tray reads everything from the repo it lives in.
//
// [TESTED: 2026-08-14 · live via `schtasks /Run \KAGO\tray`: hidden powershell appeared with the
//  tray icon, no console window; pid file and log written by tray.ps1.]

var fso = new ActiveXObject('Scripting.FileSystemObject');
var shell = new ActiveXObject('WScript.Shell');

var here = fso.GetParentFolderName(WScript.ScriptFullName);
var ps1 = fso.BuildPath(here, 'tray.ps1');
var powershell = fso.BuildPath(
  shell.ExpandEnvironmentStrings('%SystemRoot%'),
  'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
);

// 0 = SW_HIDE, false = do not wait. -Sta is explicit although 5.1's console default is STA
// (probed, researches/07 §3): WinForms REQUIRES STA and an implicit default is a dependency
// on somebody else's default.
shell.Run('"' + powershell + '" -NoProfile -ExecutionPolicy Bypass -Sta -WindowStyle Hidden -File "' + ps1 + '"', 0, false);
