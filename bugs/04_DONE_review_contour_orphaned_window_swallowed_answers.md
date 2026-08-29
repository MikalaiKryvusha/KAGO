# Bug 04 — the review contour left the owner answering into a DEAD server's window

**Status:** ✅ CLOSED 2026-08-30 (session 65) — both tool-side hardenings are in place and proven red; the process rule stands in `interviews/README.md`
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
---

## ✅ STATUS: CLOSED (2026-08-30, session 65)

**Both hardenings were checked BY OBSERVATION, not by reading — and the two answers differed.**

| hardening | state found | evidence |
|---|---|---|
| **(a)** the page notices its server is gone | ✅ **already done** by later work | `DEF4_PULSE_MS = 15000` and the `I13` pulse block in `tools/review.mjs`: the page knocks `/alive` and says out loud «Сервер молчит» with the reason (`ответ NNN` · `нет ответа` · `таймаут`) |
| **(b)** a template placeholder is not shown as an answer | 🔴 **STILL LIVE — reproduced today** | a document with `**Ответ:** _(впишите A, B, C…)_` rendered clean: «вопросов 2, без ответа 1» — the slot counted as an ANSWER, exit code 0 |

### What was wrong, at the root

`parseQuestion` closed a question on the mere presence of text: `q.answered = q.answer !== null`.
A template placeholder is text, so a draft raised over the contour showed the owner a question as
ALREADY ANSWERED — which is the 2026-08-14 symptom word for word.

### The fix, in two strikes rather than one

1. **At the parser** — `isPlaceholderAnswer()`: a slot that is NOTHING BUT emphasis (`_…_`,
   `_(впишите A, B, C…)_`) is the one shape a real answer never has. Such a slot no longer closes
   a question, so the page **cannot** render it as answered in the first place.
2. **At the gate** — a new row in `answerabilityRefusals` (the `bugs/41` family): the run refuses,
   names the question by id and says how to fix it. **The refusal reaches the AGENT before the
   owner is ever called** — the whole point of that guard family.

The rule is deliberately NARROW: emphasis *inside* an answer stays an answer, and a bare `A` stays
an answer. Both directions are asserted in the guard, not just the positive one.

### Proven red, with the addressivity declared BEFORE the run

| mutant | declared | observed |
|---|---|---|
| `isPlaceholderAnswer` always returns false | red exactly N4 | ✅ exactly N4 |
| intact code (rolled back by COPY) | zero red | ✅ zero |

**And the guard caught the FIRST version of my own fix.** The refusal was gated behind `isWaiting`,
so a document whose ONLY question held a placeholder read as fully answered and never reached the
check — the worst case of this very ticket. N4 went red on it. That is why the fix moved to the
parser: a placeholder must stop being an answer, not merely be complained about.

Contour suite **22 → 23 blocks**, battery **40 sets / 1659 / 0**.

### Found in the repository while fixing, and deliberately NOT touched

`interviews/interview_007_unattended_sweep_and_reboots.md:85` carries
`**Ответ:** _(впишите A, B, C или свой вариант в D)_` — a live instance of exactly this defect.
The interview is **closed by the owner** (2026-08-15, variant A, recorded in its own Status line),
so the agent left the document alone: a closed interview is the owner's record, not the agent's to
rewrite. It is harmless where it sits — closed documents are never raised — and it is named here so
the next session does not rediscover it as a mystery.

## Decisions made without the owner — second batch (the close)

| # | decision | why, and how to undo it |
|---|---|---|
| 1 | **A placeholder is defined by SHAPE (a slot that is entirely emphasis), not by a list of known template strings** | A list would have to be kept in sync with every template that ever ships — a pair to watch. The shape is one rule and needs no registry. Undo: narrow the regex in `isPlaceholderAnswer` |
| 2 | **Fixed at the parser AND at the gate, not at one of them** | The gate alone left the worst case open (the guard proved it); the parser alone would have silently reopened a question the agent thought answered, with no word to the agent. Two strikes, different addressees |
| 3 | **`interview_007` left untouched** | It is the owner's closed record. Undo: write his recorded verdict «A» into the slot — but that is his call to authorise, not mine |
