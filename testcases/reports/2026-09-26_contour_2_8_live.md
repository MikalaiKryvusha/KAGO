# Test run report — the owner's question page and call on the KAIF 2.8 contour (plans/104 Ш6–Ш7)

**Created:** 2026-09-26 ≈ 16:4x +03:00 (written after the runs; the run moments below are from the logs and the decision record) ·
**Run by:** the agent (Claude Opus 5.5) with the owner at the machine for runs 3–6 ·
**Version/build:** KAGO `0e00669` (runs 1–3) → `0e00669` + the uncommitted `bugs/143` fix of `tools/tidy.mjs` (runs 4–6), committed
in `f0b8613`; KAIF 2.8 contour `.kaif/tools/contour/review.mjs` through `tools/ask.mjs`

## 1. Work

`plans/104`: the owner's question page and the call moved to the shipped KAIF 2.8 contour through the door `tools/ask.mjs` (KAGO's
voice for the child process), `contour.callName` «Проект КАГО», the `tools/tidy.mjs` twin of `bugs/64`. Basis: the plan's AC1–AC7
and `.kaif/INTERACTIVE_CONTOUR_SPEC.md` §4–§6 (2.8). The live page: `interviews/interview_032` (two real questions of the owner's level).

## 2. Contour

The owner's own machine (Windows 11 Pro 10.0.26200), his browser (Edge, `--app` window on the contour's own profile
`.kaif/contour-window/`), the owner answering by touch; the call through `F:\KLAS\tools\voice-say.mjs` (Silero, voice `eugene`).
REAL WORLD: accumulated — the owner's usual desktop and VS Code session; data and machine — his; path — the page the agent raises
for him, the only door he uses to answer.

## 3. Runs

| # | Moment | Command | Exit / outcome |
|---|---|---|---|
| 1 | 2026-09-26 16:1x +03:00 | `node .kaif/tools/contour/review.mjs --selftest` | 0 · `contour selftest green: 111 checks` |
| 2 | 2026-09-26 16:1x +03:00 | `node tools/ask.mjs --call "проверка входа" --dry-run` | 0 · `CALL (dry run, no sound): Проект КАГО, проверка входа` |
| 3 | 2026-09-26 16:16:28 +03:00 | `node tools/ask.mjs interviews/interview_032_….md` + `node tools/ask.mjs --wait interviews/interview_032_….md` | page 2 · `Outcome: page closed without an answer — ending the contour (I14, beacon fast path)` at 16:16:44 — the owner: «закралась сама страница, я не успел почитать» → `bugs/143` |
| 4 | 2026-09-26 16:1x +03:00 (page 2 live) | `node tools/tidy.mjs` (inspection) | 0 · `ПРОГОН В РАБОТЕ — НЕ ТРОГАЮ НИЧЕГО (контур согласований ждёт владельца: pid 26264).` |
| 5 | 2026-09-26 16:20:32 → 16:21:31 +03:00 | the same page + `--wait` twice | waiter 0 · `Recorded: … Q1 = A · questions left: 1`; page: `Questions left: 1 — the page STAYS open`; then waiter 0 · `Q1 = A, Q2 = A`; page 0 · `Outcome: decision recorded … Q2 = A … — ending the contour (I8).` |
| 6 | 2026-09-26 16:22:49 +03:00 | `node tools/ask.mjs --call "проверка зова завершена, спасибо"` | 0 · 9 s · `CALL: Проект КАГО, проверка зова завершена, спасибо` · `CALL: voice — eugene via KAIF_VOICE_TOOL; fallback — system voice of culture "ru" (I35).` |

## 4. Checks

Hygiene: contour selftest 111/111 · `tidy --selftest` 21/21 (4 blocks for the 2.8 paths, 2 for `bugs/143`; each of the new blocks red on
its own mutant) · `npm run check` exit 0 · battery `наборов 55, красных 0, зелёных блоков 2830`
Functional run: the owner walked the real page by his own path (touch) on his machine — READ: the page's own lines («Записано.
Осталось вопросов: 1», the window staying), the contour and waiter logs, the decision record `interviews/decisions/interview_032_….decision.json`

| Case | Status | Observation |
|---|---|---|
| AC1 one answer at a time, page alive until the last | pass | run 5: Q1 recorded alone, «the page STAYS open»; Q2 later; the page ended itself with exit 0 |
| AC2 the waiter wakes on each answer | pass | run 5: `--wait` exit 0 after Q1 and again after Q2 |
| AC3 readable without zoom | pass | the owner's own answer Q1 = A («Читается — оставить так») |
| AC4 the call reaches the owner | pass | run 6: exit 0, 9 s; the owner answered the call's «спасибо» in the chat: «пожалуйста)» — the call reached him; the voice name rests on the log line |
| AC5 the Stop-hook cleaner leaves a live page alone | fail → fixed → pass | run 3: the page closed after 16 s (`bugs/143`, `wmic` gone); run 4: after the fix the cleaner reports the page busy, and the page lived through runs 5 |
| P3 a second tap clears a radio | fail | the owner, three fields of the page: «Не снимаются радиокнопки повторным тапом - баг в КАИФ и у тебя» → `bugs/144`, origin #128 |
| all three free fields are recorded | pass | the decision record holds the Q2 text, the Q2 comment and the document comment |

## 5. Found

- `bugs/143` — the Stop-hook `tools/tidy.mjs` blind without `wmic` closed the owner's page (fixed, DONE)
- `bugs/144` — a radio is not cleared by a second tap (open; upstream #128)
- `bugs/KAIF/27` → origin #126 — `.kaif/.contour-tmp/` missing from the ignore-first set (found at the pre-flight render)

## 6. Traces

- `interviews/decisions/interview_032_the_new_question_page_is_it_readable_and_shall_the_old_one_go.decision.json` (`records: 2`)
- `interviews/decisions/shown.json` · `interviews/decisions/implemented.json` · `interviews/decisions/archive/interview_032_…`
- the contour and waiter logs of this session (outside the repository; their decisive lines are quoted in §3 verbatim)
- the owner's chat words quoted above (session of 2026-09-26)

## 7. Verdict

`partial` — the 2.8 page contract, the waiter and the call pass on the owner's machine with him answering, but the same page carries an
open contract defect (P3, `bugs/144`) that the owner found.
