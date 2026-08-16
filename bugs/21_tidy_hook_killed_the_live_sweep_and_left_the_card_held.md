# Bug 21 — the tidy hook killed the live sweep after every agent turn and left the card under an undervolt

**Status:** 🔧 fix pending live verification
**Version/build:** `main` @ `2fac685` · driver 610.88 / VBIOS 98.03.58.40.8b
**When/context:** 2026-08-16 ≈17:2x +03:00. The resumed full-range sweep died a second time, with
NO exception and NO stack — the tell that a process was killed rather than thrown.

## Symptom

`engine --sweep --from 2887 --to 900 --max-depth 50 --dashboard` stopped at 10 closed frequencies.
The log ends mid-rung, cleanly, with no error of any kind. Exit code 1, nothing on stderr.

**And the card was left HELD.** Not inferred — quoted from the recovery that fixed it:

```
НАЙДЕНА ЗАБЫТАЯ ЗАПИСЬ: «АНДЕРВОЛЬТ, ОТГРУЖАЕМАЯ ФОРМА: вся кривая +158 МГц с потолком
2775 МГц, нагрузка набор из 1 форм», владелец pid 35212 мёртв.
  OK   сдвиги кривой -> 0 по всем 128 точкам — записей обнулено 128, отказов 0, ненулевых осталось 0
```

The detached guard had NOT fired — `watchdog --status` still showed 50 s of lease left. The card
came back only because a human-equivalent action (`watchdog --recover`) was run by hand.

## Root cause

`tools/tidy.mjs --apply` is wired to the **`Stop` hook** (`.claude/settings.json`), which fires
**after every single agent turn**. Its three actions:

```js
if (APPLY && pid) { kill(pid); }                        // the dashboard server, line 95
dash.closeWindow();                                     // the dashboard window, line 100
const samplers = processesNamed('node.exe').filter((p) => /hardware-mon/.test(p.cmd));
if (APPLY) for (const s of samplers) { kill(s.pid); }   // the telemetry sampler, line 106
function kill(pid) { run('taskkill', ['/PID', String(pid), '/T', '/F']); }   // /T = the whole TREE
```

A live sweep with `--dashboard` **raises the dashboard server itself and spawns its own separate
`hardware-mon` telemetry sampler** — the run's own log says so: *«ТЕЛЕМЕТРИЯ: отдельный сэмплер
pid 24568…»*. Those are precisely the two things tidy identifies as its litter. It killed them,
`/T` took the tree, and the run died holding the card.

**This is the SECOND time this file has been infected by the disease it treats.** The first edition
called `powershell.exe` to enumerate processes and therefore SPAWNED the very terminal windows it
existed to close (`bugs/17`). The lesson is the same both times, and it is now written in the file:
**a cleanup tool must be able to tell its own litter from its own work, and the discriminator must
be POSITIVE** — «this belongs to a live run» — never «this looks like nobody's».

Second-order note worth keeping: the hook was introduced BECAUSE a mechanism that depends on the
agent's diligence should be moved into machinery (`bugs/17`). That reasoning was right. What it did
not carry was that machinery running unconditionally after every turn now shares the blast radius
of everything the project does — so the machinery needs the same «what is running right now?»
awareness a careful human would have had.

## Fix

`runInFlight(nodeProcs, armed, isAlive)` — a pure function, checked before anything else in the
tool, exported and fixture-tested. Two independent signals, either sufficient, covering different
windows of time:

- **A live run process** — matched by command line against a NAMED list of every long-running or
  card-writing entry point (`engine --sweep|--band|--search`, `vf-step`, `ladder-descent`,
  `thermal-ladder`, `fan-ladder`, `trap-suite`, `bench`). This covers the whole run including the
  pauses between rungs, when the watchdog is briefly disarmed. `--dry-run` is excluded: it writes
  nothing and raises nothing.
- **An armed watchdog whose owner pid is alive** — covers a run this tool did not start (a
  shortcut, a scheduled task, the owner's own hand), whose command line is not in the list.

When either holds, tidy prints why and **exits 0 having touched nothing**. An armed record with a
DEAD owner is deliberately NOT «busy» — that is a wreck, not work, and it belongs to
`watchdog --recover`; tidy names it out loud and proceeds.

## Verification

- `node tools/tidy.mjs --selftest` — **13 blocks, 0 failures.** The eight entry points are asserted
  BY NAME rather than by a count: a count stays green when one is deleted and another duplicated.
- **Mutation-proved, addressees named before the run** (EXP-0016); each reddened its own block and
  only its own, and the intact code reddened none:
  | Mutation | Block that reddened |
  |---|---|
  | p. the `--dry-run` exclusion removed | «СУХОЙ прогон не считается работой» |
  | q. the armed-watchdog branch removed | «взведённый сторож с ЖИВЫМ владельцем» |
  | r. the `--sweep` marker dropped from the list | «узнаёт живой прогон: развёртка» |
  | s. a DEAD owner treated as busy | «взведённый сторож с МЁРТВЫМ владельцем» |
- **The WIRING checked by observation, not by reading the diff** — a stand-in process with a
  matching command line was raised and the tool asked what it thought:
  ```
  ПРОГОН В РАБОТЕ — НЕ ТРОГАЮ НИЧЕГО (идёт прогон: pid 37068).
  ```
  …and with nothing running it still does its job (`ОКНО НАБЛЮДЕНИЯ: сервера нет · СЭМПЛЕРЫ: нет ·
  ОКНА ТЕРМИНАЛА: ни одного`), which is the half that proves the fix is a discriminator and not an
  off switch.

**Still open:** the fix has not yet survived a real turn boundary with a real sweep running. That is
the observation only the next live run can give, and it is why the status is 🔧 rather than ✅.

## Decisions made without the owner

<filled at closing>

## Links

- `bugs/17` — the terminal windows this tool exists for, and its first self-infection.
- `bugs/19`, `bugs/20` — the other two defects of the same session; different mechanisms.
- `AGENT_GUIDE.md` → THE OWNER'S-MACHINE RULE — the card was left in a state nobody had described,
  which is exactly what that rule and R9 exist to prevent.
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R9/R10 — the four rollback layers; this incident is the
  case where the writer's `finally` never ran because the process was killed outright.
