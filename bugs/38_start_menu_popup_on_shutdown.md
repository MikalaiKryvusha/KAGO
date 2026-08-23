# Bug 38 — the Start Menu faults inside explorer.exe on every shutdown

**Status:** 🔬 RESEARCH-ONLY — cause is a LEADING HYPOTHESIS, not a diagnosis; the deciding
observation belongs to the owner
**Version/build:** Windows 11 Pro 25H2, build 10.0.26200.8875 · **When/context:** reported by the
OWNER 2026-08-23 in chat, during the session that also fixed `bugs/39`

The owner, verbatim:

> *«При перезагружке сыпется какая-то ошибка от explorer.exe — нужно найти логи и выяснить, в чём
> проблема.»*

> ⚠️ **This is NOT a KAGO defect.** It is filed here because `AGENT_GUIDE.md` → THE OWNER'S-MACHINE
> RULE makes a defect on the machine the owner works and lives on the main line of the session, and
> because the forensics must survive this chat. Nothing in this document is fixed by editing KAGO.

## Symptom

A modal error window appears **when the machine is shutting down or restarting** — not at boot, as
the initial wording suggested. Recovered verbatim from the Windows `System` log, provider
`Application Popup`, id 26:

> **Меню "Пуск": explorer.exe — Ошибка приложения : Инструкция по адресу 0x00007FFD4DA7BCB2
> обратилась к памяти по адресу 0x00007FFD8DD50000. Память не может быть written.**
>
> "ОК" -- завершение приложения · "Отмена" -- отладка приложения

## Repro (deterministic on this machine)

Restart from the Start menu. Observed on 2026-08-23 14:43, 2026-08-21 22:48, 2026-08-19 21:38,
2026-08-18 22:37 and 21:23, 2026-08-17 14:39 — i.e. essentially every restart.

Read the evidence back without repeating the restart:

```powershell
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Application Popup'} -MaxEvents 10 |
  ForEach-Object { $_.TimeCreated; $_.Message }
```

## Forensics

**1. The popup lands three seconds after the shutdown request, not at boot.**

| time | event |
|---|---|
| 14:43:21 | `User32` id 1074 — shutdown/restart initiated by the user |
| **14:43:24** | `Application Popup` id 26 — the message above |
| 14:43:55 | machine booted (`LastBootUpTime`) |

**2. Windows has NO crash report for it, and that is itself a fact.** No `Application Error`
(id 1000) record exists for `Explorer.EXE` on any of those dates, and
`C:\ProgramData\...\WER\ReportArchive` + `ReportQueue` (machine and user) hold **zero** directories
written in the last three days. A hard-error popup blocks; the machine then restarts while it is
still up, so WER never finalises the report. **Consequence: the faulting MODULE was never recorded
by the OS**, which is exactly why the cause below is a hypothesis.

The two `Explorer.EXE` id-1000 records that DO exist are from 2026-08-14 15:39 and name
`DUser.dll` with `0xc0000005` and `0xc000041d` — a different occasion, not this one.

**3. What is injected into explorer.exe.** Non-Microsoft modules loaded in the live process:

| module | version | file date |
|---|---|---|
| `StartAllBackLoaderX64.dll` · `StartAllBackX64.dll` · `DarkMagicX64.dll` | **3.9.20** at the time of the report | 2026-01-25 |
| `OldNewExplorer64.dll` | **1.1.9** | **2022-01-19** |
| `CoreSync_x64.dll` (Adobe) | — | — |

No `AppInit_DLLs`, no `Command Processor\AutoRun` — the injection surface is exactly those three
products.

**4. The neighbouring noise, recorded so it is not confused with this defect.** `MSIAfterburner.exe`
crashes on EVERY logon — 14 records in 10 days, module `RTHAL.dll`, `0xC0000005`; the scheduled task
`\MSIAfterburner` returned `LastTaskResult = 3221225477` (= `0xC0000005`) at 14:44:14. Afterburner
is therefore effectively dead on this machine. Irrelevant to KAGO (`GOAL.md` forbids it as a
dependency), and it is a SEPARATE failure from this one: different process, different logon-vs-
shutdown timing.

## Root cause — LEADING HYPOTHESIS, and the reason it is not called a diagnosis

**Hypothesis: a shell-patching product faults while writing into a loaded module's pages as the
Start Menu is torn down at shutdown.** Three independent facts point the same way:

1. **The window's own caption is «Меню "Пуск"»** — the Start Menu, which is precisely what
   StartAllBack replaces.
2. **The fault is a WRITE violation to `0x00007FFD8DD50000`** — a page-aligned address in the range
   where module images are mapped. Writing into another module's image is the signature of code
   patching, not of ordinary application logic.
3. **Both patchers were older than the OS.** StartAllBack 3.9.20 (January 2026) against build
   26200.8875; the vendor's current release is **3.9.24, published 2026-07-27**, i.e. newer than
   the Windows build in front of us. `OldNewExplorer` 1.1.9 dates from **2022** — the Windows 10
   era — and has had no release since.

**Why it stays a hypothesis:** the OS never recorded the faulting module (§Forensics 2), so nothing
in the evidence NAMES the culprit. Three theories once cost this project three complaints from the
owner in one session (`bugs/17`, EXP-0083); the rule learned there applies here.

## Fix plan — the owner's ladder, since every step is on his machine

- [x] **Update StartAllBack 3.9.20 → 3.9.24.** DONE by the owner 2026-08-23 15:08; verified by
      measurement rather than by the installer's word: files on disk are 3.9.24, and the freshly
      restarted `explorer.exe` (pid 22520, started 15:09:12) has **3.9.24 loaded**, not the old copy
      still resident in memory. The owner confirmed his licence is active.
- [ ] **Watch across several restarts.** The popup fired on essentially every restart before the
      update; if it stops, the hypothesis is confirmed by the only observation that can confirm it.
      Re-read with the `Get-WinEvent` line above — no need to remember what was on screen.
- [ ] **If it still fires: `OldNewExplorer` 1.1.9 is the remaining suspect** and the only one left
      that is provably unsupported on this build. Ask the owner whether he still uses it —
      StartAllBack 3.9.x covers most of what it did on Windows 11. Removing it is his call.
- [ ] **If it still fires with both settled:** enable WER LocalDumps for `explorer.exe` so the next
      occurrence records the faulting module instead of being lost. This is a REGISTRY WRITE on the
      owner's machine and needs his word first (`HKLM\...\Windows Error Reporting\LocalDumps`,
      rollback = delete the key).

## Decisions made without the owner

- **The cause is written as a HYPOTHESIS with three supporting facts, not as a diagnosis.** The
  faulting module is absent from the evidence, and `PHILOSOPHY.md`'s three-doors rule forbids
  filling that gap plausibly.
- **StartAllBack was NOT proposed for removal** — the owner said in chat *«я им пользуюсь, важно его
  не сломать»*, so the remedy chosen was the update, which is the non-breaking one.
- **`OldNewExplorer` was NOT touched or proposed for removal unilaterally**, only named as the
  remaining suspect with a question attached: it changes the look of his File Explorer, and that is
  taste, which is his (`AGENT_GUIDE.md` → the taste class).
- **Nothing was uninstalled, no registry key was written.** Installing/removing software and
  registry writes are the destructive class by the owner's-machine rule.

## Links

- `AGENT_GUIDE.md` → THE OWNER'S-MACHINE RULE — why this preempted the session's other work.
- `bugs/39` — the other machine defect reported in the same message.
- `bugs/17` / EXP-0083 — the last time a machine-surface defect was diagnosed three times wrongly;
  the reason this document refuses to name a cause it cannot show.
- StartAllBack changelog (3.9.24, 2026-07-27): https://www.startallback.com/
