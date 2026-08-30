# Bug 71 — variants written as a TABLE parse to zero options, the owner gets a text box instead of buttons, and no guard reddens

**Status:** 🔴 OPEN — found 2026-08-30 11:2x while rebuilding `interviews/018` after the owner
refused to answer it. **Reproduced by the contour's own parser on the shipped document.**
**Version/build:** `main` @ `666e17c` · **When/context:** session 66; the owner had been shown
interview 018 at 11:09 and answered at 11:12 with a complaint about the QUESTION, which is how the
second defect surfaced

## Symptom

`interviews/018` carried four variants — A (recommended), B, C, D — laid out as a markdown table,
one row per variant, in the shape this project has used before. The contour raised the page and the
owner saw **no choice controls at all**, only a free-text field. His decision came back:

```json
"answers": { "Q1": { "choice": null, "text": "Не понимаю вопрос и физику процесса. …" } }
```

Asked of the contour's OWN parser on the shipped file:

```
вопросов  : 1
вариантов : 0 []
```

Four variants in the document, zero variants on the page.

## Root cause

`review-core.RE_OPTION_START` is `/^\s*[-*]?\s*\*\*\s*([A-Za-zА-Яа-я])(?!\p{L})/u` — a variant is
recognised only when the LINE BEGINS with an optional list bullet and then `**A`. A table row begins
with `|`, so `| **A** **(Рекомендовано)** | … |` never matches. The parser is behaving exactly as
written; nothing is broken in it.

**The defect is that the failure is SILENT.** A question with zero options is a legitimate shape —
it is how a free-text question is written — so the page renders one with no complaint, and the
document looks fine to every reader who does not run the parser.

## Why the existing guard cannot see it — and this is the interesting half

`questions-guard` axis **G11** exists for precisely this family: it cross-checks
`q.options.length` against `q.optionCandidateLines`, the independent count of lines that LOOK like
an option start. On this document both are **0**, they agree, and G11 is honestly green:

```
[G11] сверка числа вариантов — новых: 0 · в долге: 0
СВЕРКА ВАРИАНТОВ (G11): проверено вопросов 38 — расхождений новых 0.
```

G11 answers *«did some option lines fail to parse?»*. It cannot answer *«were the options written
as option lines at all?»* — the case where the variants exist in the document but in a shape the
parser was never pointed at. **A guard that compares two counts is blind when both are zero for the
same reason**, which is the same shape as EXP-0176 (a fixture where the broken and the correct code
agree) one level up: here the two SIDES agree, so there is nothing to disagree about.

## Repro (deterministic, offline, no card)

1. Take any interview whose variants are table rows (`git show 666e17c:interviews/interview_018_what_feeds_the_upward_ratchet.md`).
2. Run the contour's parser over it and print `questions[0].options.length`.
3. Observe `0`, and observe `npm run questions` reporting no G11 discrepancy.

## Fix plan

1. **A new guard axis: a question with ZERO parsed options whose body contains variant-shaped
   evidence.** The evidence is mechanical and does not need cleverness: a table row, or any line,
   whose first cell is `**A**`/`**B**`/`**А**`/`**Б**` — i.e. the same letters the option regex
   looks for, found anywhere the regex does NOT look. Two or more such letters in one question
   body and zero parsed options is the finding. One letter alone is not: `**A**` can legitimately
   appear in prose referring to an earlier answer.
2. **Prove it red on the pre-fix document** (`git show 666e17c:…` as the fixture, committed under
   `interviews/__fixtures__/` or read from git in the block) — a guard that has never gone red
   proves nothing, and this one has a perfect historical fixture available for free.
3. **Say it on the PAGE too, not only in the guard.** The raise already refuses a document the
   owner cannot answer (`bugs/41` — no answer slot). «Variants exist but none were parsed» belongs
   in the same refusal: the owner's time is the thing being protected, and the guard runs only when
   somebody runs it, while the raise runs every time.
4. **Do NOT make the parser accept tables.** That is the tempting fix and it is the wrong one:
   it would add a second legal shape for the same concept, i.e. a truth↔mirror pair inside the
   document format, and the page's one-click contract (a recorded `choice`) has no sensible meaning
   for an arbitrary table. One shape, enforced, beats two shapes, tolerated.

## What this bug does NOT claim

That the owner's answer was CAUSED by the missing buttons. His words name the question's substance —
physics, a drawing, a graph — and that defect is real and separate (EXP-0192). This one compounded
it: he was handed prose he could not use AND no way to click even if he could.

## Decisions made without the owner

- **Filed rather than fixed on the spot.** Tonight is a live-card evening; the fixes that protect
  the evening (`bugs/45`, the twin rehearsal) come first. This defect bites the NEXT interview, not
  the run.
- **The rebuilt `interviews/018` was written with option LINES**, i.e. worked around rather than
  waiting for this fix — the fork blocks the harvest of tonight's run.

## Links

`interviews/018` (the document, before and after) · `interviews/decisions/interview_018_*.decision.json`
(`choice: null` — the receipt) · `tools/lib/review-core.mjs` → `RE_OPTION_START`, `parseQuestionBlock`
· `tools/questions-guard.mjs` → G11 · `bugs/41` (the raise refuses what the owner cannot answer) ·
`bugs/01` (the contour's adversarial findings) · EXP-0192 (the question's own defect) · EXP-0176
(a check blind because both sides agree)
