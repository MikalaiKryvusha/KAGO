// automation-engine/apply-shortcut.js — WSH JScript for wscript.exe. NOT a Node module.
//
// WHAT THE DESKTOP SHORTCUTS POINT AT. A mode `.lnk` used to name `schtasks.exe` directly, so a
// double-click flashed TWO consoles in a row: schtasks' own, and then node.exe's inside the task it
// triggered. `bugs/39` fixed the second one; this file fixes the first.
//
// WHY THIS IS ITS OWN FILE INSTEAD OF `run-hidden.js`. `schtasks` takes `/`-flags, and WSH parses
// `/x` arguments into its Named collection before a script ever sees them — the same class of
// argument-mangling this project already paid for in EXP-0043. So the `/`-flags are never passed
// THROUGH a wrapper: this script receives only a mode name and composes the schtasks line itself.
//
// THE CONTRACT: exactly one argument, the mode name, which must be one of the four the shell ships.
// The list is CLOSED and checked here rather than interpolated blindly — a `.lnk` is a file the
// owner (or anything else on his Desktop) can edit, and this script runs an ELEVATED task, so the
// task name it builds may never come from unchecked input.
//
// [NOT-TESTED]

var EXIT_NO_ARG = 64;       // no mode given
var EXIT_BAD_MODE = 66;     // the mode is not one of ours

var shell = new ActiveXObject('WScript.Shell');
var fso = new ActiveXObject('Scripting.FileSystemObject');

// Closed vocabulary — mirrors SURFACE in setup-desktop.mjs. Guarded by a block in that file's
// verification pass, so the two cannot drift apart silently.
var MODES = ['max-performance', 'optimised', 'silent-cold', 'factory', 'test-pl250'];

if (WScript.Arguments.Length < 1) {
    WScript.Quit(EXIT_NO_ARG);
}
var mode = WScript.Arguments(0);

var ok = false;
for (var i = 0; i < MODES.length; i++) {
    if (MODES[i] === mode) { ok = true; break; }
}
if (!ok) {
    WScript.Quit(EXIT_BAD_MODE);
}

var schtasks = fso.BuildPath(
    shell.ExpandEnvironmentStrings('%SystemRoot%'),
    'System32\\schtasks.exe'
);

// 0 = SW_HIDE, true = wait. The elevated task does the actual work; this only triggers it, so the
// exit code here is schtasks' own — «did the task start», not «did the profile apply». The profile's
// own verdict lands in runs/shell/boot-apply.jsonl and on the tray icon.
WScript.Quit(shell.Run('"' + schtasks + '" /run /tn "KAGO\\apply-' + mode + '"', 0, true));
