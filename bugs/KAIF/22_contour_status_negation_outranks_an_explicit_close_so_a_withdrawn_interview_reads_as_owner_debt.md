# KAIF bug: a CLOSED status line that explains «not answered by the owner» is read as open — and the 2.8 owner-debt view turns it into a red «decisions await application» line

kaif-fp: .kaif/tools/contour/core.mjs docStatus :: negation-outranks-explicit-close :: v2.8
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/109
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF 2.8 · project KAGO · sphere programming ·
language ru · i18n 8 owner docs localized, skills English · tracking origin · agent system claude-code (Claude Opus 5.5) ·
OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "negation\|docStatus\|не отвечен" bugs/KAIF/` → 0 files) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state open --search "contour status negation"` → none;
`--search "owner debt"` → #108 and #94, neither about this; `--state all --search "docStatus"` → none). No match found.
**Found:** 2026-09-26, the KAIF 2.7 → 2.8 update of KAGO, task item `review-news` (the first `--queue --list` after the #100 fix).

## Expected per canon

The 2.8 news, verbatim: «`node .kaif/tools/contour/review.mjs --queue --list` names FIRST the owner's decisions awaiting
application — every question answered, the status not closed» (`KAIF_UPDATE_TASK.md`, "THE OWNER'S DEBT COMES FIRST").
And the status rule, verbatim from `.kaif/tools/contour/core.mjs:155-156`: «The marker is looked for ONLY in the status line
(markup, never a bare word); a document is LIVE by default — only explicit markup without a negation closes it». A status
line whose explicit markup is ✅ + «ЗАКРЫТО» / «CLOSED» is closed; the debt view must not name it.

## Got in the field

```
$ node .kaif/tools/contour/review.mjs --queue --list
🔴 РЕШЕНИЯ ВЛАДЕЛЬЦА ЖДУТ ВНЕСЕНИЯ — 1: все вопросы отвечены, статус не закрыт. Внеси их ПЕРВЫМИ, раньше плана (#86), затем закрой статус.
   interviews/interview_020_does_a_delivery_plateau_count_as_a_missed_measurement.md — отвечено 26 дн. назад
```

The document's status line (line 6), verbatim:

```
**Status:** ✅ **ЗАКРЫТО 2026-08-30 14:5x — ВОПРОС СНЯТ АГЕНТОМ, А НЕ ОТВЕЧЕН ВЛАДЕЛЬЦЕМ.**
```

It is closed, and its explanation («the question was withdrawn by the agent, NOT answered by the owner») is exactly what
`statusNegation` matches: `(?<!\p{L})не\s*отвечен` (and, in English, `\bnot\b[^.]{0,40}\banswer`). `docStatus` checks the
negation FIRST («negation outranks the tick», `core.mjs:179`), so the explicit ✅ + ЗАКРЫТО never gets a vote.

## Repro (deterministic)

1. A script in the project root importing the shipped reader:
   ```js
   import { docStatus } from './.kaif/tools/contour/core.mjs';
   for (const s of ['✅ **ЗАКРЫТО 2026-08-30 14:5x — ВОПРОС СНЯТ АГЕНТОМ, А НЕ ОТВЕЧЕН ВЛАДЕЛЬЦЕМ.**',
                    '✅ CLOSED 2026-08-30 — the question was withdrawn by the agent, not answered by the owner.',
                    '✅ CLOSED 2026-08-30 — withdrawn by the agent.'])
     console.log(JSON.stringify(docStatus('# X\n\n**Status:** ' + s + '\n')), '←', '**Status:** ' + s);
   ```
2. Output on KAIF 2.8 (build `106b97d7715c`), verbatim:
   ```
   "waiting" ← **Status:** ✅ **ЗАКРЫТО 2026-08-30 14:5x — ВОПРОС СНЯТ АГЕНТОМ, А НЕ ОТВЕЧЕН ВЛАДЕЛЬЦЕМ.**
   "waiting" ← **Status:** ✅ CLOSED 2026-08-30 — the question was withdrawn by the agent, not answered by the owner.
   "closed" ← **Status:** ✅ CLOSED 2026-08-30 — withdrawn by the agent.
   ```
3. Add one `## Q1` with an owner-review answer under the first line and run `--queue --list`: the document is named as owner debt.

## Cost and violated invariant

Invariants: **honest-green** (here an honest RED — a false alarm) and **owner-decisions**. `/resume` step 2 in 2.8 puts the owner's
debt ABOVE the plan and `/what-next` makes closing one its row 1, so a false debt either sends a session to «apply» a
decision the owner never made (he answered «Не понимаю проблемы и вопроса. Нужно проще пояснить», `choice: null`), or teaches
it to skip the red line — the alarm-fatigue shape that hides the next real debt. Neither local exit is honest:
`--mark-withdrawn` refuses (the question carries an owner answer), and `--mark-implemented` would record a false implementation.
Before 2.8 the misclassification existed silently; the 2.8 debt view is what makes it loud.

## What in KAIF led to this

`docStatus()` evaluates `statusNegation` over the WHOLE status line before `statusClosed`, and `statusClosed`
(`texts.mjs:46`: `✅|🟢|STATUS:\s*DONE|ANSWERS\s+RECEIVED|ОТВЕЧЕНО`) has no explicit closing WORD — no `CLOSED` / `ЗАКРЫТ` /
`WITHDRAWN` / `СНЯТ`. The negation rule was written against «✅ not answered yet»-type lines (origin bugs/70), where the
negation negates the tick; in a line that says CLOSED and then explains WHY it closed without an answer, the negation belongs
to the explanation, not to the status.

Smallest fix (suggestion): an explicit closing word at the head of the status value (`✅?\s*\*{0,2}(CLOSED|ЗАКРЫТ\p{L}*|WITHDRAWN|СНЯТ\p{L}*)`)
outranks a negation later in the line; keep «negation outranks the tick» for the bare tick. One selftest fixture per language
with the lines above.

## Local remediation (per the "defect in KAIF itself" contour, if applied)

None in code. The interview's status line is a record and is not reworded to dodge the regex. KAGO's `STATUS.md` names the
line as a known false positive pointing at this ticket, so a session does not act on it.
