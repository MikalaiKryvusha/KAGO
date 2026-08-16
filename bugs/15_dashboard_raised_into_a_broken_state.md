# Bug 15 — `npm run dashboard` raised the observation window into a broken state

**Status:** ✅ DONE (2026-08-16 13:2x +03:00)
**Version/build:** `main` @ `54aec6d` · **When/context:** found by the OWNER, 2026-08-16 13:1x, at the
start of session 29, while the agent was preparing his minimal live smoke run.

The owner's words, verbatim: *«ты опять поднял в сломанном состоянии»* · *«чини это гавно»*.
Note **«опять»** — this was not the first time.

## Symptom

`npm run dashboard`, run while a dashboard from a PREVIOUS session still held port 7311:

1. printed its banner as if starting normally,
2. **closed the operator's existing window**,
3. opened a NEW window pointed at `http://127.0.0.1:7311/` — served by the ORPHANED old process,
4. then died with a raw Node stack trace:
   `Error: listen EADDRINUSE: address already in use 127.0.0.1:7311`.

Net result on the owner's desktop: a window connected to a zombie server running **old code**, with
no supervising process, and a terminal showing a `net.js` stack trace that names nothing actionable.

A second, independent face appeared while fixing the first: after the port was taken correctly, the
window still did not come up — `viewers: 0`, no KAGO window on screen — and the command reported
success anyway.

## Repro (deterministic)

```
npm run dashboard          # leave it running (or leave a server from a previous session alive)
npm run dashboard          # second raise, in another terminal
```
Before the fix: the first window dies, an EADDRINUSE trace follows, an orphan keeps serving.

## Forensics

```
ОКНО:    закрыл прежнее (pid 13428, окна с «KAGO» в заголовке)
Error: listen EADDRINUSE: address already in use 127.0.0.1:7311
    at Server.setupListenHandle [as _listen2] (node:net:2008:16)
```
Port holder at that moment: `PID 2212 node, started 08/16/2026 12:50:17` — the previous session's
server. `GET /health` answered `{"viewers":1,...}` from that orphan.

## Root cause

**Two causes, both of ORDER — not of logic. Every individual step worked.**

**(a) The irreversible step ran before the step that could fail.** `run-dashboard.mjs` did:

```
serve()          ← server.listen() is ASYNCHRONOUS; serve() returns immediately
closeWindow()    ← IRREVERSIBLE: destroys the operator's window
openWindow()     ← points a new window at a server we may not own
…                ← only now does the event loop deliver 'error' → EADDRINUSE
```

`serve()` attached no `'error'` handler at all, so the bind failure arrived as an **unhandled
`'error'` event** — i.e. a process abort — long after the caller had walked on and done the damage.
This is exactly the law **R9a** already states for the watchdog's undo (*the net before the jump*),
violated in a module the rule had never been applied to.

**(b) A fire-and-forget closer overlapping its own opener.** `closeWindow()` launched `taskkill` and
the PowerShell title sweep with `spawn` and returned instantly, so nothing had closed yet when
`openWindow()` ran. The sweep matches **any** window whose title contains `KAGO` — and the new
window's title contains `KAGO`. The command closed its own result. A closer that has not finished
closing has not closed anything.

**(c) The command reported the SPAWN as the outcome.** Launching a browser is not a window on
screen; the code said «запросил окно» and exited green. The server's own `/health` already counts
open event streams — the one observation that distinguishes «окно есть» from «мы попросили» — and
the raise never asked it.

## The fix

`automation-engine/lib/run-dashboard.mjs`, commit — see below.

1. **`serve()` handles `'error'`.** A bind failure is an answer with a named reason, never a stack
   trace. New `onError` seam; without one, a named diagnostic and `exitCode = 1`.
2. **`startServing()`** — `serve()` with its bind awaited, so a caller can branch on
   «поднялся / порт занят» instead of walking into an outcome that has not happened yet.
3. **`raiseDashboard()`** — the whole startup in one testable function, in the one safe order:
   **take the port first, touch the window only once this process owns it.** The window seams are
   injected, which is what makes the ORDER assertable offline.
4. **An occupied port is TAKEN OVER, not reused** — a server answering `/health` runs the code it
   was started with, and this file changes; reusing it would serve yesterday's logic under a green
   message. The listener is killed **only** after `probeDashboard()` positively identifies it as
   ours by its own `/health` shape (`viewers` + `pulsePath`) **and** its pid is resolved. A foreign
   listener, or one that cannot be identified, means: refuse, having touched nothing.
5. **`closeWindow()` is synchronous** (`execFileSync`), and the title sweep now `WaitForExit`s the
   windows it asked to close, so it can never overlap the opener.
6. **`waitForViewer()`** — the raise polls `/health` and states the truth: «подключилось» or
   «НЕ ПОДКЛЮЧИЛОСЬ… прогон стартовать ОТКАЖЕТСЯ».
7. `close()` made idempotent and safe on a server that never bound (a double close aborts the
   process from inside libuv), and `probeDashboard` uses `node:http` rather than `fetch` — `fetch`
   leaves an abort timer and a pooled socket behind, and exiting on top of them aborted the suite
   («Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)», observed while fixing this).

## Verification — by observation, not by reading the diff

- `node automation-engine/lib/run-dashboard.mjs --selftest` → **31 blocks, 0 red, exit 0** (was 21).
  Ten blocks are new and four of them are about this defect's ORDER.
- **Mutations, addressees named BEFORE the run (EXP-0016), each reddening its own block:**

  | # | mutation | what went red |
  |---|---|---|
  | **AK** | window closed BEFORE the port is ours — *the original defect, restored* | «ОКНО НЕ ТРОГАЕТСЯ, ПОКА ПОРТ НЕ НАШ» + 2 more |
  | **AM** | any listener on the port counted as ours | «ПОХОЖИЙ ОТВЕТ — ЕЩЁ НЕ НАШ» |
  | **AN** | kill the listener without identifying it | «НЕОПОЗНАННЫЙ СЛУШАТЕЛЬ НЕ СНИМАЕТСЯ» |

  Intact code reddens none. **AK is the proof that matters:** re-inserting the exact defect turns the
  guard red.
- **Live, on the owner's machine:** the raise found the orphan (`pid 2212`), announced it, killed it,
  bound, closed the stale window, opened a new one, and reported **«ОКНО: подключилось»**.
  `GET /health` → `{"viewers":1,...}`, window `PID 7936 «KAGO — прогона нет»`.
- `npm run check` → 43 `.mjs`, 245 text files, 0 failures.

## TWINS

`TWINS: searched spawn(/spawnSync(/execFileSync( across automation-engine/ — 34 sites, found 0 other
sites of this class.` Every other asynchronous `spawn` is a process whose completion the caller
deliberately does NOT wait for — the telemetry side-cars (`engine.mjs:4767`, `graphics-load.mjs:559`,
`vf-step.mjs:745`, `power-baseline.mjs:263`), the detached watchdog guard and its drill victim
(`watchdog.mjs:163`, `:637`), the game launch (`graphics-load.mjs:423`) and the window opener itself.
`closeWindow` was the only place where the caller's very next statement depended on the child having
finished.

## Decisions made without the owner

- **Take over an occupied port rather than reuse or refuse.** Reuse would silently serve old code;
  a plain refusal would leave the owner to hunt a pid by hand. Takeover is bounded by positive
  identification (`/health` shape + resolved pid) and refuses in every other case.
- **Kept the title-based window sweep** despite it being the mechanism that closed our own window.
  It is the only way to reach a window opened before the pid file existed — exactly the orphan we
  had on screen today. Made safe by ordering (synchronous, completed before the opener runs) rather
  than removed.
- **`waitForViewer` budget = 10 s** (40 × 250 ms). A cold browser start on this machine takes
  seconds; a shorter budget would report a false «не подключилось».
- **Did NOT add a server pid file.** The port plus `/health` already identify the process, and a
  second identity mechanism is a pair to keep in sync (Occam, and the truth↔mirror registry's own
  preference: a pair that can be removed beats a pair that must be watched).

## Links

- `bugs/04` — the review contour's orphaned window swallowing the owner's answers: same family
  («поднятый контур не перезапускается под открытым окном»), and the reason `closeWindow` exists.
- `bugs/14` — the window lying about run state; this bug is the layer below it (the window not
  being there at all).
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` → **R9a** — *the net before the jump*, the law this
  violated.
- `ideas/06` — the dashboard's origin and the owner's rule that a sweep without a visualiser is
  forbidden.
