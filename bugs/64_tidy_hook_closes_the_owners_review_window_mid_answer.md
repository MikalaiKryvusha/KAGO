# Bug 64 — the tidy hook closes the owner's review window while he is answering

**Status:** 🔧 fixed, awaiting live confirmation (the very next raise of the contour IS the check)
**Version/build:** 2026-08-28, session 55 · **When/context:** the owner asked to route the five
method forks (interview 017) through the review contour; the page died in front of him TWICE.

## Symptom

The review contour is raised for `interviews/interview_017`; the Edge app window opens; shortly
after the agent's turn ends, the window closes BY ITSELF. The owner, verbatim: *«закрылся контур,
а я ничего не ответил =(»*, then *«опять закрылось само!!!!»*. The server records the honest
outcome and dies: `ИТОГ: страница закрыта без ответа · страница сообщила о закрытии и не
вернулась за 3 с · код выхода 3`. Twice in a row, both times right after a turn end.

## Forensics

- Both raises: page served, `/alive` knocked 200, then exit 3 minutes later — the page LOADED and
  then fired its `pagehide` beacon: something closed the WINDOW, not the server.
- Timing correlation: both deaths land at the end of an agent turn — which is when the Stop hook
  runs `tools/tidy.mjs --apply` (`.claude/settings.json`, wired 2026-08-16 per the owner's word).
- The weapon: `tidy.mjs:168-171` calls `dash.closeWindow()` UNCONDITIONALLY on every `--apply`;
  `run-dashboard.closeWindow()` (`:931-934`) sweeps **every** `msedge`/`chrome` process whose
  `MainWindowTitle` matches `'*KAGO*'` and posts `WM_CLOSE`.
- The review page title (`review.mjs:806`): `PROJECT + ' — ' + headline` = «KAGO — Интервью 017 —
  …» → matches the sweep. The contour's server is NOT in tidy's busy markers
  (`runInFlight` MARKERS, `tidy.mjs:117-121`), so nothing stopped the sweep.

## Root cause

**Twin of `bugs/21`, one contour up.** The cleanup tool cannot tell its own garbage from its own
LIVE WORK: bugs/21 taught it about the sweep engine; the review contour — a server whose whole
purpose is to WAIT with an open window — was never added to the busy list, and the title sweep
recognizes «ours» by the one substring every KAGO page shares.

Second face, latent until today: the `'*KAGO*'` title sweep also matches the owner's MAIN browser
whenever his ACTIVE TAB is titled KAGO (the GitHub repo page, the published audit page «Аудит
метода KAGO»). `CloseMainWindow` posts WM_CLOSE to the WINDOW — closing his entire browser with
all tabs, despite the comment above the sweep promising «his other tabs are not touched». Not yet
observed live; refused by the same fix.

## Fix (landed with this document)

1. **`tidy.mjs` / `runInFlight`:** a live `node tools/review.mjs` process (not `--no-serve`, not
   `--selftest`) makes the machine BUSY — same rule as a live sweep: the owner is being asked, and
   cleanup waits one turn. `why` names it: «контур согласований ждёт владельца». Selftest blocks
   added; the marker mutation reddens exactly its own block.
2. **`run-dashboard.closeWindow` + `countVisibleWindows`:** the title sweep additionally requires
   `MainWindowTitle -notlike '*Microsoft Edge*' -and -notlike '*Google Chrome*'` — an app window
   (`--app=`) carries the bare page title, the owner's real browser always carries the product
   suffix. The sweep can now close only suffix-less app windows; the owner's browser is out of
   reach BY SHAPE. (This also makes the bugs/56 second witness more truthful: a KAGO-titled tab in
   the owner's browser is not «окно KAGO».) Assumption named: Edge/Chrome do not localize their
   product-name suffix — true on this machine, re-check if the sweep ever goes quiet on a real
   dashboard window.

## TWINS

Searched every `taskkill`/`CloseMainWindow`/window-title site: `tidy.mjs` (this fix) ·
`run-dashboard.closeWindow`/`countVisibleWindows` (this fix) · `dashboard --close` path (same
function — covered) · `review.mjs` closes only ITS OWN window via `window.close()` in-page — no
sweep. No other site closes windows by title.

## Decisions made without the owner

The fix shape (busy marker + suffix exclusion) — mechanical, follows the owner's own precedent in
bugs/21 («уборка не трогает живую работу»); severity S2 per the method audit's ladder: bug doc +
guard, no epic.

## Links

`bugs/21` (tidy killed the live sweep — the class) · `bugs/56` (the second witness this fix
sharpens) · `researches/20` §4 (donor lessons: one page — one server) · method audit Р2/Р4
(a run/window torn down by our own machinery is severity 2 minimum).
