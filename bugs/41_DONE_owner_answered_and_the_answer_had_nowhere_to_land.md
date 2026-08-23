# Bug 41 — the owner answered and the answer had nowhere to land: one interview had no answer FIELD, the other had no recognised QUESTION at all

**Status:** ✅ **DONE 2026-08-23 18:27 +03:00** (штамп взят по КВИТАНЦИИ коммита `eb9af1c`, а не из головы — EXP-0019) — guard written, proven RED on the two real documents
before the repair and by a mutation after it; both documents repaired and re-measured answerable.
See «✅ STATUS: DONE» at the foot.
**Version/build:** `main` @ `6ac94be` · **When/context:** found 2026-08-23 18:0x by the OWNER, while
answering `interviews/011` and `interviews/012` through the review contour raised by `npm run ask:batch`

## Symptom — reported by the owner, in his own words

> *«Во втором интервью поле для ответа было не доступно для ввода. Там ответ, как рекомендуешь»*

And the contour's own closing line, on the same run:

```
ИТОГ: решение записано
      interview_011… — только комментарий, в поля не легло: 3 — перенесено в комментарий;
      interview_012… — только комментарий · осталось ждать владельца: 2 документа
```

**Both documents were answered by the owner, and NEITHER answer reached its document.** They survive
only because the contour also writes a decision record (`interviews/decisions/*.decision.json`) and
appends the text as a document-level comment. The intended carrier — the answer field inside the
question — stayed empty, and the documents kept reading «ЖДЁТ ВЛАДЕЛЬЦА» after he had answered.

**Why this is worse than a cosmetic miss.** The project has already paid twice for exactly this
divergence: a fork that lived only in a file's tail and the owner found it himself (*«Что за мной? Я
даже не в курсе»*), and `interviews/008`, which was carried as OPEN for seven days after he had
answered it (`STATUS.md`, session 43 item 4). Both are the same disease — **the summary and the
document disagree because the answer did not land where the reader looks.** This defect MANUFACTURES
that disease on every answer.

## Repro (deterministic, offline, no GPU)

```bash
node -e "
import('./tools/lib/review-core.mjs').then(core => {
  const fs = require('fs');
  for (const f of ['interviews/interview_011_ambient_theme_tempo_and_cycle.md',
                   'interviews/interview_012_virtual_card_failure_simulation_scope.md']) {
    const doc = core.parseInterview(fs.readFileSync(f,'utf8'), { file: f });
    console.log(f, '| вопросов:', doc.questions.length,
                '| поля Ответ:', doc.questions.map(q => q.answerLine ?? 'НЕТ').join(' '));
  }
});"
```

Observed 2026-08-23 18:1x:

```
interviews/interview_011_… | вопросов: 3 | поля Ответ: НЕТ НЕТ НЕТ
interviews/interview_012_… | вопросов: 0 | поля Ответ:
```

## Forensics — two faces, two different mechanisms, one symptom

**Face A — `interviews/011`: the questions are recognised, the answer field does not exist.**
`tools/lib/review-core.mjs:94` requires a literal field line:

```js
const RE_ANSWER_FIELD = /^\s*\*\*\s*(Ответ|Answer)\s*:?\s*\*\*\s*:?\s*(.*)$/iu;
```

The document's question blocks carry a table of variants and a recommendation, and no `**Ответ:**`
line at all. The writer therefore refuses each question by NAME — `review-core.mjs:410`, *«у вопроса
нет поля „Ответ:“ — записывать некуда»* — and degrades to the comment. The refusal is honest and
loud; the defect is that nothing warned anyone BEFORE the owner was standing in front of the page.

**Face B — `interviews/012`: there is no recognised question, so the page had no input.**
`review-core.mjs:105`:

```js
const RE_QUESTION_HEADING = /^#{2,4}\s*(Вопрос|Question|Q)\s*(\d+)/iu;
```

The heading is `## Вопрос: какой объём берём?` — **`Вопрос` with no NUMBER after it**, so the pattern
does not match and the document parses to **zero questions**. Two independent readings agree: the
parser above prints `вопросов: 0`, and the raise line printed `СОБРАНО: 2 документа, вопросов 3` —
all three of them from 011. The owner's *«поле для ответа было не доступно для ввода»* is literally
accurate: there was no field, because there was no question.

## Root cause

**The contour's document contract is real, mechanical and UNWRITTEN, and nothing checks it on the
authoring side.** Two conditions must hold for an answer to land:

1. every question's heading is NUMBERED — `## Вопрос 1.` / `## Q1.` / `## Question 3 —`;
2. every question block carries an `**Ответ:**` field for the writer to fill.

Both were violated by the agent that WROTE the documents (this session's predecessor), and both are
invisible until the owner tries to answer. The parser is not at fault: it refuses correctly and says
why. **The gap is that the refusal arrives at the owner instead of at the agent.**

This is the shape `AGENT_GUIDE.md` already names for the whole contour — *«a tool counts as ADOPTED
only when a ritual contains the executable command that shows violations»* — applied one level
deeper: the place-of-questions rule got its guard (`npm run questions`), and the ANSWERABILITY of a
question never did.

## Fix plan

1. **A guard, and it runs at the moment that matters — when the contour is RAISED.** `npm run ask`
   / `ask:batch` checks every document it is about to show: questions found > 0, and every question
   block carries an answer field. A document that fails is named with the exact reason and the exact
   line, and the run REFUSES rather than calling the owner to a page he cannot answer on.
2. **The same check as a block in `npm run verify:contour`**, proven RED against the two documents
   as they stand today (they are the fixture, and they are real).
3. **Fix both documents** — 012's heading gets a number, both get `**Ответ:**` fields — and re-run
   the repro above: expect `вопросов: 1` for 012 and a field on every question of 011.
   ⚠️ The owner's ALREADY GIVEN answers are recorded verbatim in both documents' status lines and
   answer sections by hand; the repair must not overwrite or re-ask them.
4. **The template follows the guard, never the other way round:** `interviews/README.md` and the
   `/interview` skill state the two conditions in the same words the guard checks.

## ✅ STATUS: DONE (2026-08-23 18:27 +03:00, по квитанции коммита `eb9af1c`)

**What was built — the refusal now arrives at the AGENT, before the owner is called.**

1. **`review-core.answerabilityRefusals(doc)`** — the two conditions in ONE place, beside the parser
   that defines them (C1): at least one recognised question, and an `**Ответ:**` field in every
   question block. Each refusal carries the ADDRESS (`file → Q2`), the consequence, and the exact
   repair — «fix the document» is not an address.
2. **`review.mjs → refuseUnanswerable()`** runs on both collection paths (single and `--batch`) and
   the run STOPS with exit **2**. No `--force`: a hatch here is the hole through which the class
   returns. Notices (I37) carry no questions by definition and are exempt — the exemption is a named
   class, not a guess.
3. **Both documents repaired** — `interviews/012`'s heading became `## Вопрос 1.`, and every question
   of `011` and `012` received the `**Ответ:**` field carrying the owner's already-given words. His
   answers were NOT re-asked and not re-worded.

**Proof, in the order it was taken:**

| what | observation |
|---|---|
| guard RED on the real 012 | `СТРАНИЦА НЕ ПОДНЯТА … ни одного распознанного вопроса`, exit **2** |
| guard RED on the real 011 | three refusals, one per question, addressed `→ Q1` `→ Q2` `→ Q3`, exit **2** |
| documents after repair | `011` — вопросов 3, отвечено 3, отказов 0 · `012` — вопросов 1, отвечено 1, отказов 0 |
| the raise proceeds again | `--no-serve` run on 012: `СОБРАНО: 1 документ, вопросов 1, без ответа 0`, exit 0 |
| the new block | `npm run verify:contour` → **19 blocks, 0 failed** (block `ANSWERABLE`) |
| mutation | `answerabilityRefusals` forced to return `[]` → `ANSWERABLE` reddens with `a heading without a number was accepted: []`; reverted → green |

🔴 **AND THE FIX BROKE A NEIGHBOURING BLOCK, WHICH IS RECORDED RATHER THAN QUIETLY REPAIRED.**
Block **B4** («the success summary counts what LANDED») drove its assertion THROUGH the server on a
document with no answer field — the very shape the new gate refuses to raise. So B4 started failing
with the gate's own message: the guard made its scenario unreachable through the front door. The
property was not weakened, it moved one floor down, and the block moved with it — B4 now calls
`applyAnswersToDocument` directly and asserts the same three facts (nothing written · document
byte-identical · the skip reported by name and reason). **The block was NOT deleted and NOT relaxed:
the gate protects the human from an unanswerable page, and it does not protect a library caller from
a lying report — those are two different guarantees and both are kept.**

## The class inventory — taken by the judge pass, not by the fix

`BUG_FIXING_FRAMEWORK.md` judges a fix BY THE LIST, so the list was taken by running the new guard
over EVERY interview in the directory. Two were the incident; **six more carry the same shape, and
all six are CLOSED:**

| document | refusals | shape |
|---|---|---|
| `interview_005_desktop_icons.md` | 2 | questions with no `**Ответ:**` field |
| `interview_006_optimised_ceiling_after_bsod.md` | 2 | same |
| `interview_007_unattended_sweep_and_reboots.md` | 1 | same |
| `interview_008_burn_must_load_rt_cores.md` | 1 | same |
| `interview_009_step_guard_measures_against_the_order.md` | 1 | same |
| `interview_010_point_tag_vocabulary.md` | 3 | same |

**They are NOT repaired, and the reason is a rule rather than a shortage of time:** every one of them
was answered long ago, in prose, by the owner — and an original is not rewritten to match today's
format (`AGENT_GUIDE.md` → the owner's originals are inviolable; the terminology boundary says the
same of closed documents). Nothing can be lost through them: a closed interview is never collected
by `--batch`, and the gate below no longer touches a document that is not waiting.

🔴 **AND THE INVENTORY IMMEDIATELY FOUND A DEFECT IN THE FIX ITSELF, which is why it is worth
taking.** The FIRST version of the gate judged every document it was handed, so raising one of these
six to SHOW it — a normal thing to do, and the only way the canon allows showing anything — was
refused with «владельцу нечем было бы ответить». A closed interview is raised to be READ, not
answered. **That is the R17 trap verbatim: a guard firing on a state the work legitimately passes
through, describing an unwritten assumption instead of catching a defect.** Narrowed the same hour:
the gate judges only documents that are WAITING. Proven both ways — a closed fieldless document
raises with exit 0, a waiting numberless one still refuses with exit 2 — and the narrowing has its
own assertion inside block `ANSWERABLE`, mutation-proved (remove the narrowing → the block reddens).

## Decisions made without the owner

- **The six closed interviews are left as they are** — see the inventory above; repairing a closed
  original to satisfy today's format is exactly what the canon forbids.
- **The gate judges only WAITING documents.** The alternative (judge everything, add a flag to show)
  puts a hatch in the one place a hatch must not be.
- **The run REFUSES instead of warning, and there is no `--force`.** A warning is read by the agent
  that is already about to call the owner; the cost of being wrong is one extra chat message, while
  the cost of the hatch is the owner's time in front of a page that cannot take his answer.
- **The two conditions live in `review-core`, not in `review.mjs`.** They are properties of the
  document format, and the format has one parser — a second copy is the drift this contour already
  paid for (C1, `bugs/01` → A1).
- **The repaired documents carry the owner's answers verbatim in the new fields**, with his own
  wording quoted in brackets. Nothing was re-asked and no answer was re-interpreted; where his word
  was a bare «90» / «А» / «хватает», the variant letter it maps to is stated NEXT to the quote, not
  instead of it.
- **B4 moved rather than being deleted** — reasoning in full above.

## Links

`bugs/01` (the contour's 54 adversarial findings — 30 parked by the owner) · `bugs/04` (an orphaned
contour window swallowed answers — the same class: an answer given and not kept) · `bugs/40` (the
questions guard was written off on a false diagnosis; that guard finds questions in the wrong PLACE,
this one is about a question in the right place that cannot be answered) · `interviews/011` ·
`interviews/012` · `AGENT_GUIDE.md` → «The place of questions» · `.claude/skills/owner-reviews/`
