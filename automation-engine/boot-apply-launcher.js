// automation-engine/boot-apply-launcher.js — WSH JScript for wscript.exe. NOT a Node module.
//
// WHY THIS FILE EXISTS. `\KAGO\boot-apply` used to name node.exe as its task action directly.
// node.exe is a CONSOLE-subsystem binary, so Windows allocates a console for it, and a task with
// an InteractiveToken principal draws that console IN THE OWNER'S SESSION — a window flashes on
// every logon. The owner reported it (2026-08-23, bugs/38) as terminals appearing at boot.
//
// The cure is the one this project already owns and already proved for the tray: WSH
// `Run(cmd, 0, ...)` creates the console ALREADY HIDDEN (SW_HIDE at creation), instead of
// `-WindowStyle Hidden` / a minimized .lnk, which hide a window that has already been drawn and
// therefore still flash (PowerShell#3028; researches/07 §3, candidate A). See tray-launcher.js —
// this file is its deliberate twin, and the twin-ness is the point: one cure, two call sites.
//
// THE ONE DIFFERENCE FROM THE TRAY, AND IT IS DELIBERATE: this launcher WAITS (`Run(..., true)`)
// and exits with the child's code. The tray is a daemon and nobody reads its exit code; boot-apply
// is a one-shot whose LastTaskResult is a RECEIPT the owner and the agent read after a logon
// (STATUS's reboot recipe reads exactly it). A launcher that returned its own 0 would launder the
// applier's failure into a green task result — a truth↔mirror pair created for free.
//
// THE CONTRACT: exactly one argument — the absolute path of the node.exe to run. It is passed by
// setup-desktop.mjs from `process.execPath` rather than hard-coded here, because the machine's node
// location is a fact of the machine and this file ships in a repository. A missing or non-existent
// interpreter is REFUSED with a distinct exit code instead of silently doing nothing: a boot task
// that quietly stops re-applying the owner's profile is exactly the failure that must be loud.
//
// [NOT-TESTED]

var EXIT_NO_ARG = 64;      // no interpreter argument was passed
var EXIT_NO_NODE = 65;     // the argument names a file that is not on disk

var fso = new ActiveXObject('Scripting.FileSystemObject');
var shell = new ActiveXObject('WScript.Shell');

if (WScript.Arguments.Length < 1) {
    WScript.Quit(EXIT_NO_ARG);
}
var node = WScript.Arguments(0);
if (!fso.FileExists(node)) {
    WScript.Quit(EXIT_NO_NODE);
}

var here = fso.GetParentFolderName(WScript.ScriptFullName);
var applier = fso.BuildPath(fso.BuildPath(here, 'lib'), 'profile-manager.mjs');

// 0 = SW_HIDE — the console never becomes visible, not even for a frame.
// true = WAIT — so the applier's exit code becomes this script's, and the task's LastTaskResult
// keeps meaning what it meant before the wrapper was introduced.
var rc = shell.Run('"' + node + '" "' + applier + '" --boot-apply', 0, true);
WScript.Quit(rc);
