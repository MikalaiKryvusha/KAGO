# Research 38 — how a hidden task tells the owner it refused

> **Created:** 2026-09-09 (session 97) · **Parent:** `bugs/135` — the desktop shortcut swallows the
> applier's refusal · **Status:** written; the fork is CLOSED by a local precedent, and the plan
> `plans/100` cites it · **Outbound:** —

---

## 0. The fork this document exists to close

`bugs/135`: the shortcut runs `wscript //B` and throws away every byte the applier prints. On
2026-09-09 the applier printed a complete, self-sufficient refusal — rule, point number, both
frequencies, and the remedy — and the owner saw **nothing**, then asked *«Почему?»*.

The fork has ≥ 2 options and a real price (**what the owner sees is where this project does not
economize** — `PHILOSOPHY.md`, the Occam boundary), so it is decided by recon, never by the agent's
own reasoning.

**Hard constraint, and it disqualifies the obvious answer:** bringing back a console window
resurrects `bugs/17` and `bugs/39` — «terminal windows in the owner's OS» and «console windows at
logon» — which he complained about **three times in one session**. Any candidate that shows a window
is refused before it is weighed.

---

## 1. Industry practice — what a hidden scheduled task does about failure

The sweep found a consistent answer and, more usefully, a consistent NON-answer.

**What is standard:** failures of a hidden task are surfaced **out of band**, never by making the
task visible. The named mechanisms are: the task's own exit code read from the scheduler
(`LastTaskResult`), the **Task Scheduler Operational log** (event id 201 with a non-zero result
code — the log has to be enabled: `wevtutil set-log Microsoft-Windows-TaskScheduler/Operational
/enabled:true`), and a watcher process that reacts to either. A representative recommendation is a
PowerShell watcher that polls `LastTaskResult` and **raises an alert** on a non-zero code.

**What is NOT standard, and this is the useful half:** none of the sources proposes showing a
console window, and none proposes silence either. The failure mode this project shipped — an exit
code that lands only in a UI the owner never opens — is exactly the state the whole literature exists
to prevent.

**What does not transfer:** most of the field answers with e-mail or a monitoring service. Both are
outbound network dependencies for a single-owner desktop tool, and `GOAL.md` already forbids a
third-party GUI in the dependency list; the spirit is the same.

---

## 2. The local precedent — this project already solved it, in another corner

🔴 **The decisive finding, and it is ours, not the industry's.**

`tools/loop-guard.mjs` — the external watchdog of the autonomous loop — already notifies the owner
with **no window at all**:

```js
'$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Warning;'
+ `$n.Visible=$true;$n.ShowBalloonTip(20000,'KAGO: цикл замолчал',${JSON.stringify(text)},'Warning');`
```

And the tray itself (`automation-engine/tray.ps1`) is **already** a
`System.Windows.Forms.NotifyIcon` — the same class — already running, already visible, already
reading a file on a 2 s timer.

So the mechanism is not a candidate to evaluate: it is **shipped machinery with a working precedent
in this repository**. That collapses the fork.

---

## 3. The three candidates, judged

| candidate | verdict | why |
|---|---|---|
| bring back a console window | **refused before weighing** | resurrects `bugs/17` and `bugs/39`; the owner complained three times |
| a log file the owner reads | **refused** | «lies at path…» is the banned form of showing (`AGENT_GUIDE.md` → «Showing is an action, not a link»); the owner: *«I will NOT open it by double-click!»* |
| **the tray speaks** — balloon on refusal, through the NotifyIcon already standing | **CHOSEN** | Occam: no new moving part · local precedent (`loop-guard.mjs`) · industry shape (out-of-band alert on a non-zero result) · the instrument is already in the owner's field of view |

**`FORK:` options `console window | log file | the tray speaks` · price of error: the owner sees
nothing when his mode refuses, or gets windows he has rejected three times · consulted: local
precedent `tools/loop-guard.mjs` (proven in-tree) + industry practice for hidden scheduled tasks
(out-of-band alerting, never visibility) — never the agent's own reasoning.**

---

## 4. What the chosen path still has to decide (goes into the plan, not here)

1. **Who raises the balloon** — the applier itself at the moment of refusal, or the tray noticing a
   changed refusal file. The applier is simpler; the tray already owns a message loop. This is a
   small fork with a small price and is decided in the plan on the spot.
2. **Silence on success is mandatory.** A notification that fires on every successful click becomes
   noise the owner learns to ignore, and then the refusal is invisible again — the defect returns
   wearing the fix's clothes.
3. **The balloon carries the CAUSE, not «error».** The applier's refusal text is already
   self-sufficient; the balloon shows its first line, and the full text stays in the run's log.
4. **The tray must not gain state.** It is an INDICATOR (`PROJECT_ARCHITECTURE_INTERNAL_MAP.md` §4);
   showing a message is display, not state — the boundary holds only if the tray never decides
   anything about the card.

---

## 5. Sources

- [Windows Task Scheduler Job Failure Notification — Complete 2026 Guide](https://copyprogramming.com/howto/windows-task-scheduler-job-failure-notification)
- [The forsaken world of Windows Task Scheduler](https://ssg.dev/the-forsaken-world-of-windows-task-scheduler/)
- [script for failed task scheduler — Microsoft Community Hub](https://techcommunity.microsoft.com/discussions/windowspowershell/script-for-failed-task-scheduler/3805673)
- Local, and decisive: `tools/loop-guard.mjs` (a proven balloon with no window) · `automation-engine/tray.ps1` (a NotifyIcon already standing) · `bugs/17` · `bugs/39` (why a window is disqualified) · `AGENT_GUIDE.md` → «Showing is an action, not a link»
