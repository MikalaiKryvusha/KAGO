# Research 20 — donor recon: the NDim Space review contour vs KAGO's own build

> **Created:** 2026-08-28 (owner's order in chat: «посмотри, как по KAIF поднять интерактивный
> контур… Можешь подсмотреть в проект Ndim Space — там уже он полностью построен. Строим
> интерактивный контур — через него развилки и вопросы мне — владельцу»)
> **Parent:** the order above · `.claude/skills/owner-reviews/SKILL.md` (the C1–C13 contract) ·
> `reports/KAIF_UPDATES/KAGO_OWNER_REVIEWS_FIELD_REPORT.md` (KAGO's own build, 2026-08-09)
> **Status:** ✅ recon complete 2026-08-28; contour raised live with `interviews/interview_017` the same session
> **Outbound:** donor lessons adopted as KAGO discipline (§4) · no code changes required (§3 verdict)

Donor read in the order the skill prescribes for borrowing: **its bugs → its plans → its code →
its EXPERIENCE → its upstream queue** (`d:\work\ai_sandbox\ndim`, KAIF 2.3, 49 interviews served
through the contour — the owner's reference of a contour that WORKS, because it is USED).

## 1. The surprise verdict, first

**KAGO's contour is built to a FULLER contract than the donor's.** NDim implements I1–I7 plus
field-paid patches; KAGO's build (5 files, 4,257 lines, built 2026-08-09 and maintained) carries
several invariants the donor lacks:

| Feature (contract §) | NDim | KAGO |
|---|---|---|
| one-document pid lock (I29) | NO — substituted by a human procedure (their EXP-0152) | **YES** (verify block B6: two windows on one document collide; I29b: lock gitignored) |
| reverse pulse `sendBeacon('/closed')` + silence watch (I14) | NO / partial (only with explicit `--timeout`) | **YES** |
| notice class — «прочитано», no options (I37–I38) | NO | **YES** |
| answer-target field (I18) `<!-- owner-review:target … -->` | NO — return leg by heuristic only (I20/I21) | **YES** (core parses it; guard checks both legs) |
| P3 clearable selection | mousedown scheme (older) | **pointerdown + preventDefault** (the field-corrected mechanics) |
| comment-only answer survives (their bugs/138, origin issue #19 — the costliest contour defect measured in 3 deployments) | fixed after the owner lost work | **built in from birth** — the skip condition (`review.mjs:613`) drops a question only when choice AND text AND comment are ALL empty |
| free port · `--app=` window · Edge→Chrome · `/alive` pulse · localStorage draft · rescue ring · three-places write bottom-up · normalization+sha256 · beeps→voice · quiet hours over midnight · batch page · die-on-save | YES | YES |

**The donor's real advantage is not code — it is USE.** 49 interviews went through their pages;
KAGO served 010–014 through the contour, then drifted back to answering in chat/files (015–017) —
exactly the skill's rake 2: *«tool built, agent not using it — chat is cheaper in the moment»*.
The owner's order fixes the practice, not the tool.

## 2. What was checked live this session (not assumed)

- `node tools/verify-review-contour.mjs` → **19 blocks, 0 failed** (gates, batch collision,
  answerability, G1 Russian forms, option parsing).
- The answerability guard (bugs/41) REFUSED interview 017's first form — no `**Ответ:**` fields —
  and prescribed the fix itself; the interview was reshaped to the house format (option tables +
  «Ваш вариант» row per interviews/013 lesson + `owner-review:target` per question).
- `npm run questions` was red with 10 «new» violations because the G2 debt baseline had never been
  seeded; `--freeze` recorded the 10 inherited items → **ИТОГ: ЧИСТО, exit 0** — red now fires
  only on NEW debt. (This also retires the practical half of `bugs/40` — the guard can be
  believed again; the frozen debt must go down.)
- The contour was raised for interview 017 as ONE tracked background task; the raised address was
  knocked (`/alive` → 200 — the donor's bug-128 class: guards prove the decision is written,
  only a knock proves the server survived its own launch).

## 3. Verdict

**No contour code is written or changed on this order.** The tool exceeds the donor's spec and
its QA is green; what the donor teaches is DISCIPLINE OF USE (§4). The one place KAGO's tool was
weaker than the practice — the un-seeded guard baseline — is fixed by data, not code.

## 4. Donor lessons adopted as KAGO discipline (each paid for in NDim's field)

1. **EXP-0119 (founding):** a tool that records an answer but does not WAKE the waiter is
   half-built. KAGO's die-on-save IS the wake-up; the agent's duty is to raise the page as a
   TRACKED background task and treat its termination as the event (exit 0 recorded · 3 closed
   unanswered · 130 interrupted).
2. **EXP-0126:** a signal to a human is a consumable — raise the page as ONE separate background
   task, never `&`, never bundled with a commit; a duplicate ring costs more than a missed one.
3. **EXP-0152:** one page — one server; never kill a server the human is standing on; the address
   goes in the SAME chat message as the raise. (KAGO's pid lock enforces the first half
   mechanically; the other two are the agent's manners.)
4. **EXP-0130:** between `**Ответ:**` and the next heading — not one word of the agent's own; and
   compare the question COUNT the contour reports against the document BEFORE the owner is called
   (017: reported 5 of 5 — matches).
5. **EXP-0161:** the proposal must be readable INSIDE the question card without scrolling — the
   option tables carry the full proposal text in place.
6. **EXP-0134 / I19:** GETTING an answer is not PROPAGATING it; the unit of propagation is the
   QUESTION (NDim measured 55 % orphan answers across three projects). Closing 017 = walking its
   declared targets, citing «интервью 017, QN» in each, and only then flipping the status.
7. **bugs/138 three-state reading:** a comment WITHOUT a choice is **rejected-with-direction** —
   the STRONGEST outcome, a STOP of the work in progress, never consent. KAGO's page saves it;
   the reading duty is the agent's.
8. **bugs/122 honesty:** after a failed save the page can only say what it KNOWS («записался или
   нет — страница знать не может; повторить безопасно») — never guess either way in chat.
9. **bugs/110:** clocks count the human's ABSENCE, never their thinking — no `--timeout` when
   raising for the owner; fixing twins is done by MECHANISM search, never by log-text search.
10. **bugs/142:** a return/rework action is needed in the most COMMON case; two comment fields
    never one; a note nobody reads equals an unwritten note.

## 5. What KAGO deliberately does NOT copy from the donor

- The explicit `--port` procedure (their EXP-0152 workaround) — KAGO's pid lock solves the same
  class mechanically; a procedure held by vigilance loses to a lock held by code.
- Any file copy-paste — «a copy is a second truth with two places to fix» (the skill's borrowing
  rule); what travels is the contract text and the lessons above.
- The donor's `mousedown` selection scheme — KAGO already carries the field-corrected
  `pointerdown` mechanics.

## 6. The raise ritual (executable, for every future session)

```bash
npm run ask interviews/interview_NNN.md      # ONE tracked background task; address → same chat message
npm run ask:batch                            # autonomous loops: one page «накопилось N», one signal
npm run questions                            # both legs + stale locks; exit 0 = clean (debt frozen 2026-08-28)
node tools/review.mjs <doc> --no-serve --no-signal   # answerability preflight without raising
```
