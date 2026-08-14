# Bug 04 — the review contour left the owner answering into a DEAD server's window

**Status:** 🟡 partial — root cause is the agent's process error (named by the owner); tool-side hardening ideas listed, not implemented
**Version/build:** tools/review.mjs @ 7b7742f · **When/context:** 2026-08-14 11:3x, interview 005 (icon sets)

## Symptom

The owner answered interview 005 in the rendered page and got «Запись не удалась — сервер не принял
ответы». The page's copy-fallback worked (he pasted the full answer text into chat — nothing was
lost). The same window also showed Q2 as «уже отвеченное», which he never answered.

## What actually happened (reconstructed, deterministic)

1. Agent raised the contour on a DRAFT of the interview that still carried an «**Ответ:** _…_»
   placeholder under Q2 → the first server's page rendered Q2 as answered.
2. Agent fixed the file and wanted a fresh render. The tool itself refused a second window
   («УЖЕ ОТКРЫТО … я не поднимаю его») — correctly.
3. Agent killed the first server (pid 50024) and raised a new one — **without closing the owner's
   already-open browser window**. Two windows now existed; the owner answered in the ORPHANED one;
   its save POST hit a dead port.

## Root cause

**The agent's sequencing: a served page is the OWNER'S open artifact, and restarting the server
under it orphans it silently.** The tool did everything it promised — it even warned. The one
tool-side gap: a page cannot tell «server gone» from «temporary error», and it renders a template
placeholder as a given answer.

## Fix plan

- **Process rule (in force now):** before killing/restarting a review server — either the owner's
  window is confirmed closed, or the answers are taken via chat and written by the agent. A raised
  contour is not restarted for cosmetic edits.
- **Tool hardening (backlog, minor):** (a) the page pings its server and self-marks «страница
  устарела — сервер ушёл» on failure; (b) the renderer refuses a document whose answer slot is a
  template placeholder (`_…_`) instead of showing it as answered. Both are small; neither blocks
  the interview flow (chat + fallback cover it).

## Decisions made without the owner

- Answers for interview 005 are taken via chat and written into the document by the agent (the
  fallback path the page itself offered); the contour server for 005 is stopped and not re-raised.

## Links

`interviews/interview_005_desktop_icons.md` · `homeworks/01_icon_sets_taste.md` · EXP-0044
