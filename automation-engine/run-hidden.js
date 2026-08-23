// automation-engine/run-hidden.js — WSH JScript for wscript.exe. NOT a Node module.
//
// WHAT IT IS. The project's ONE cure for the console-window flash, at every call site that needs
// it. `wscript.exe //B //E:JScript run-hidden.js <exe> [arg…]` runs `<exe> [arg…]` with the console
// created ALREADY HIDDEN, waits for it, and exits with its code.
//
// WHY IT EXISTS AS ONE FILE. A console-subsystem binary (node.exe, schtasks.exe, powershell.exe)
// gets a console allocated at process creation, and a scheduled task with an InteractiveToken
// principal draws that console in the owner's session. `-WindowStyle Hidden` and a minimized `.lnk`
// hide a window that has ALREADY been drawn, so they still flash (PowerShell#3028; researches/07 §3
// records `WScript.Shell.Run(cmd, 0, …)` as the native cure). The owner reported the flash four
// times across `bugs/17` and `bugs/39`; every time it turned out to be a NEW call site of the same
// disease. So the cure is a shared file rather than a per-site copy — «fix by form», so the class
// cannot drift apart again (BUG_FIXING_FRAMEWORK.md → close the class, not the instance).
//
// IT WAITS AND PROPAGATES THE EXIT CODE, and that is not incidental: `\KAGO\boot-apply`'s
// `LastTaskResult` is the receipt STATUS's reboot recipe reads after a logon. A wrapper returning
// its own zero would launder an applier failure into a green task result — a truth↔mirror pair
// created for free.
//
// ⚠️ ARGUMENTS THAT START WITH `/` MUST NOT TRAVEL THROUGH HERE. WSH parses `/x` and `/x:y` into
// its Named collection, and this project has already paid once for `/`-flags being mangled in
// transit (EXP-0043, MSYS2 rewriting `schtasks /Run`). Node's flags are `--like-this` and are safe.
// A caller that needs `/`-flags builds them INSIDE its own script — see `apply-shortcut.js`, which
// takes a mode name and composes the `schtasks /run /tn …` line itself.
//
// [TESTED: 2026-08-23 — see the red/green measurement recorded on its predecessor
//  `boot-apply-launcher.js`, which this file generalises: node.exe named directly as a task action
//  produced 2 console windows with EVER-VISIBLE 2, the wrapper produced EVER-VISIBLE 0, and the
//  child's exit code (42 in the probe) survived both. Re-proved for this file by the same
//  EnumWindows sampler at 100 ms before it replaced its predecessor.]

var EXIT_NO_ARG = 64;   // nothing to run
var EXIT_NO_EXE = 65;   // the first argument names a file that is not on disk

var fso = new ActiveXObject('Scripting.FileSystemObject');
var shell = new ActiveXObject('WScript.Shell');

if (WScript.Arguments.Length < 1) {
    WScript.Quit(EXIT_NO_ARG);
}

// Quote anything that could be split by the command-line parser. Deliberately simple: this file
// carries paths and `--flags`, never free text — and free text through argv is banned project-wide
// (AGENT_GUIDE.md → "text travels through files, never through command-line arguments").
function quoted(s) {
    return (s.length === 0 || s.indexOf(' ') >= 0) ? '"' + s + '"' : s;
}

var exe = WScript.Arguments(0);
if (!fso.FileExists(exe)) {
    WScript.Quit(EXIT_NO_EXE);
}

var line = quoted(exe);
for (var i = 1; i < WScript.Arguments.Length; i++) {
    line += ' ' + quoted(WScript.Arguments(i));
}

// 0 = SW_HIDE — the console never becomes visible, not even for one frame.
// true = WAIT — so the child's exit code becomes this script's.
WScript.Quit(shell.Run(line, 0, true));
