---
name: interview
description: Interview the human about open questions the agent must NOT decide alone — UI/UX decisions, serious technical forks, choices that define the brand or architecture. A rare event: by default the agent works autonomously. Use when the agent hits such a decision, OR when the human says "interview me", "ask me", "let's do an interview", "interview", "проведи интервью", "спроси меня", "уточни у меня". Trigger aliases (ru): «возьми интервью», «задай вопросы по развилке», «интервью»
---

# /interview — interview the owner

This skill captures decisions that **must not be made autonomously** into an md document in
`interviews/` and pauses the work until the human answers.

All interviews live in `interviews/interview_NNN_<topic>.md`.

## When to call (this is a RARE event)

By default the agent works **autonomously** and makes technical decisions with sensible defaults.
Interviews are the exception. Call one ONLY when the question is genuinely the owner's:

- **A UI/UX decision** — how something looks, behaves, feels for the end user. Never make a UI/UX choice
  without confirmation.
- **A serious technical fork** — choosing a library/protocol/architectural approach with long-lived,
  hard-to-reverse consequences.
- **Brand / vision / product priorities** — naming, icon, target platforms, what's in a phase vs. not.

Do NOT call an interview for: small implementation details, variable names, ordinary bug fixes,
refactors, choices between equivalent technical options — decide those yourself and report in the chat.

If unsure "is this the owner's level or mine?", ask: *is it cheap to reverse?* If yes — decide yourself.
If it shapes brand/architecture/UX for the long term — interview.

## Procedure

### Step 1. Preparation (before writing questions)
- Read the context in code/docs — don't ask what you can find out yourself.
- Verify the technical facts that determine which options are even possible (e.g. "can this dialog be
  removed?", "does the library have the needed API?"). A question without verified groundwork is a bad question.
- Look at past interviews (`ls interviews/`) so you don't duplicate accepted decisions and keep one style.
  Looking is not searching: the search per question, its command and its attestation are **step 3d**, and
  the contour's door refuses a question that skipped it.

### Step 2. Create the interview document
- Name: `interviews/interview_NNN_<short_topic>.md`, where `NNN` is the next free number
  (`ls interviews/` → max+1, format `004`, `005`, …).
- Template:
  ```markdown
  # Interview #NNN — <Topic>

  > Topic: <one sentence on what this interview is about>
  > Source of the idea: <file/chat, date>
  > Status: **🟡 awaiting the owner's answers**

  ## Context / what I already found in the code
  <briefly: current state + verified technical facts that constrain the options>

  ## QUESTIONS

  ### Q1. <question>

  **Answer target:** <the document/section that waits on this answer — e.g. `plans/24 §B8` — written TOGETHER with the question>

  **Origin:** <the question's extended meta, written for the owner facing the card without your context: where the question came from and what problem it decides · who formulated it and when · which documents, tasks and epics it feeds or blocks (the owner's field ask, 2026-08-07: options without this context earn "I don't know what we are deciding here")>

  - **A) (recommended)** <the option distilled through PHILOSOPHY.md — simplest/most effective — + why>
  - **B)** <option>
  - **C)** <option>
  - **D) your own answer** — <the owner writes their own here>

  **Answer:**

  ### Q2. ...

  ## Proposed implementation plan (after answers)
  <the steps you'll take once the questions are closed>
  ```

### Step 3. Rules for good questions
- **Closed** options **A/B/C/D** — not an open "what's best?".
- **Option A is always the recommendation**, marked `(recommended)`, and is **distilled through
  `PHILOSOPHY.md`** — run the choice through the principle set (simplicity/KISS + Occam first, then Pareto,
  best-practices, second-order thinking, …). In the vast majority of cases A is the simplest, clearest, most
  useful, effective, and fastest way to what the owner wants. Put it first.
- **Option D is always "your own answer"** — a slot for the owner to write their own choice if none of
  A/B/C fits.
- **B and C** are the serious alternatives, each with a short "why" / trade-off.
- **Every question declares its ANSWER TARGET** (contour invariant I18) — the document/section
  blocked by the question, written at question-writing time: the agent knows it exactly then
  (that knowledge is the reason to ask), and by closing time — often another session, days later —
  it is gone. The field is cheaper than any memory.
- **A question to the owner is a CLAIM about the state of the canon, and it is verified as a
  claim** — before showing it, three subchecks: a negative claim ("the system has no X") needs
  proof over the WHOLE source, not one read spot (one spot proves only itself) · a quote offered
  as the owner's canon needs a look at its provenance marker (unaccepted AI text repeated to the
  human launders invention into canon) · every name in the ANSWER OPTIONS must exist — an
  invented entity in an option is worse than in prose: the human physically cannot answer, and
  the question burns for nothing. Questions about things that do not exist YET are legal — declare
  the intent explicitly ("proposing to create X") instead of implying X exists.
- Group: usually 1–5 questions per interview; when the topic genuinely needs it — **up to 10**. Don't
  pad, but don't starve the interview either: a cramped interview that misses what the agent actually
  needed to clarify is worse than a few extra questions.
- Don't ask what's already decided in `plans/`/`MASTER_PLAN.md` or past interviews — and this one is not
  kept by resolve: it is **step 3d**, a command whose result is written under the question.

### Step 3a. Every question and every option — a scenario of what the owner will see, the formula after

The rule is one line: every question and every option opens with a four-line scenario with
concrete values (`REQUIREMENTS_FRAMEWORK.md` → "The scenario form": Situation · Action · Result ·
Check) in the CUSTOMER's language — what the owner will see on the screen, in the file, in the chat — and only
then the technical explanation (vector or scalar, flag, command, schema): the formula explains WHY
it comes out so; a scenario without the formula is still a question the owner can answer, a formula
without the scenario is not (the origin's owner returned two such questions with "I don't understand
the problem — as a customer", decision #98). This holds for the mechanic a question explains AND for
each answer option: an option is a scenario of the world after that choice, not a label. The values
in the scenario come from the canon or from a run, never invented (the three doors,
`PHILOSOPHY.md`); the owner answers in the same language — the owner's scenario may leave the Check
line empty, and filling it is the agent's work. An option, written this way:

```
- **A) Close the proofreading page with "Done" and no remarks**
  - Situation. The agent brought you a page to proofread; you read it and have nothing to add.
  - Action. You click "Done" with every field left empty.
  - Result. You see the page close — nobody shows you this page again, and no question to you.
  - Check. The agent's console prints `Outcome: proofread recorded (<doc>, no remarks, by …)`.
```

Where the project runs a questions guard, a live question whose body carries none of the four lines
is a finding (the origin: `questions-guard`, axis G6); the declared exception is a marker with a
reason on the line — `<!-- questions-guard:no-scenario <reason> -->` — legal only for a question
with no behaviour to show (a name, the taste class).

**The voice of the conversation is the customer's language, never the agent's vocabulary** (the
origin owner's word, 2026-09-06, decision #106, rendered from Russian: "this is the voice of
requirements and questions — the voice of the conversation between the AI agent and the owner; the
owner reasons in meanings and behavioural scenarios"). The scenario form does not translate the text
by itself: an epic code can be typed into the Action line and the form stays green — and the owner
answers "your codes mean nothing to me" (the origin's bug 112, the fourth rejection of one class in a
month). So in option labels and in the Situation · Action · Result lines every named thing is what
the owner will SEE or GET after it: not "CB → RW → HY remain" but "the budget warning stops blaming
the canon that arrived; the agent no longer says done without checking on the real world". Epic
codes, plan and bug addresses, tool names, flags and canon terms live only in the Check line, in the
answer-target line and in the technical note under the scenario. The pre-show check is the
customer's eye: is there a word in the question the owner never said himself? The origin guards the
class with axis G8 of the same questions guard (epic codes read from the meta-plan tables; the
declared exception — `<!-- questions-guard:vocabulary-ok <reason> -->`); `/fable-judge` hunts
"owner text in agent vocabulary".

**Proposed canon content inside a question is marked (KAIF 2.7).** When an option or a draft carries
text the agent proposes AS the owner's canon — a lore line, a rule, a value, a table row — that text is
wrapped `[AI]…[/AI]` (or the localized pair from `.kaif/kaif.json` → `aiMarks`) right there in the
interview or the draft: the mark survives the session, a pronoun does not (origin issue #55: "(my
taste)" read as the owner's taste a day later). The question's own scaffolding — option letters, the
recommendation, the scenario lines — is not marked. And the owner's answer is recorded as HIS word:
`[OWNER] "<verbatim>" · <date>` or the interview address (`AGENT_GUIDE.md` → "Authorship of a
decision"); "do as you see fit" is a mandate, recorded as `[AI] by mandate — "<his words>"`.

### Step 3b. Confused by the owner's proposal? Search → measure → ask — never "it breaks X" (KAIF 2.6)

The origin owner's rule (origin issue #50): an owner's proposal that confuses you is a proposal you
have not yet understood — not a wrong one. Before writing an interview about it, and before ANY
message that says the proposal cannot be done ("breaks the model", "impossible", "contradicts"), run
the pre-flight `confusion → search → measure → ask`: (1) search the web for what the owner most
likely meant — the term of the owner's domain and its usage (the Cyrillic spelling of "RPG" is the
ordinary Russian way to write it, so "role-playing game and RPG at once" meant two complete pairs,
not a third tag); (2) measure against the owner's own data — the catalogue, the archive, prior
answers (in the field 90 live records already carried the pair the agent had called impossible);
(3) only then ask. The interview body — and any report that says "cannot" — carries a `Recon:`
block: `query: …` · `found: …` · `measurement: …` (a localized wrapper names the block and its three
keys in the owner's language — the guard of the origin reads both); an empty block is a pre-flight
refusal, the same way `lintSelfContained` refuses a question that points outward. Rolling back work the owner asked for because a guard went red is a
fork for THIS document — quote the guard's output inside the question; never disarm the guard to
make the proposal fit (the guard was right; the reading was wrong). Do not turn this into "always
ask": a question before the search is the same defect with better manners. `/fable-judge` hunts
"confusion delivered as verdict".

### Step 3c. Check the form against the contour contract before opening the page (KAIF 2.6)

The two legal option forms (a table row `| **A** | … |` or a list item `- **A)** …`), the declared free
field, and the pre-flight that refuses to open a page whose question has neither (exit 3 — the page would
open without radio buttons, origin issue #51) are written in one page: `.kaif/INTERACTIVE_CONTOUR_SPEC.md`.
Before opening the page, run the shipped generator's form check — `node .kaif/tools/contour/review.mjs
<interview.md> --check` — and fix what it names (a pre-flight refusal, or a block that looks like a question but
is not in the form `### Q<n>.`). The check is a door of its own: it never serves, never sounds, never calls and
never records a showing (2.7, origin issue #56 — `--no-open` is NOT a check: it serves the page and CALLS the owner,
only the window is not opened). The same door has a SECOND axis — the archaeology of every live question (step 3d,
2.7, origin issue #70): no attestation, exit 3, and the refusal prints the search command to run.
A project that runs its own contour checks the document against that page by hand.
Paragraph headings like `**A. …**` are not options.

### Step 3d. Archaeology BEFORE the question — search, read, attest (KAIF 2.7)

A question to the owner is a CLAIM that the matter is not settled yet, and nothing used to verify it.
One field owner answered the same questions thirteen times, one of them 44 days after his own answer
(origin issue #70; his words, rendered from Russian: "you are asking ME? did you look into GOAL.md,
smart guy, before asking?" · "you ask me questions without having looked at the history of decisions…
we have discussed this already. Search."). So the search is a step with a command, and its result is
written under the question — never "I looked at the interviews" in the agent's memory:

1. **Run the search.** The door prints the ready command for the question's own heading — `node
   .kaif/tools/contour/review.mjs <interview.md> --check` — and it looks like
   `grep -rniE "<the heading's words: 4+ letters, 6+ by their stem>" interviews/ GOAL.md MASTER_PLAN.md plans/`.
   Run it as printed; broaden it when the topic has a synonym, never narrow it.
2. **READ the hits** — the files, not the number. A count with nothing read is the same claim unverified.
3. **Write the attestation** between the question heading and its FIRST option:
   ```
   <!-- archaeology: grep -rniE "…" interviews/ GOAL.md MASTER_PLAN.md plans/ → N hits · read: <files | none> · prior: <none | "<the prior answer>" + address> -->
   ```
   `N` and the file list come from the run that just happened. `N = 0` is an honest attestation: the axis
   does not promise a find, it promises you searched and said with what.
4. **A prior answer found → the question does not go to the owner.** Either DROP it and carry the decision
   over from the old answer (`node .kaif/tools/contour/review.mjs --mark-implemented <old interview.md> <Q>
   --where <commit or file>`, step 5), or reformulate it as "the prior answer was X; Y has changed — confirm
   it or change it", with the old answer quoted and addressed. Re-serving a settled question is the defect.
5. **The door refuses what skipped this step.** A live question of a document dated on or after 2026-09-18
   without the attestation: exit 3, the grep printed, nothing shown and nobody called — the same for `--check`
   and for any show. Hits found with `prior: none` is refused too: name the prior answer, or write
   `prior: unrelated — <why>`. A question with nothing to search — a name, the taste class — declares
   `<!-- archaeology: n/a — <reason> -->`. Interviews dated before that day are never judged (the field's
   history is not rewritten), and `--check` says so out loud: `archaeology: not judged — header date …`.

Where the project runs a questions guard, the same class is an axis of it (the origin: `questions-guard`,
axis G11); `/fable-judge` hunts a question asked past its archaeology.

### Step 4. Ask the owner — via the document
The default, autonomy-friendly method: the owner answers **right in the md document** (fills the
"**Answer:**" fields). This keeps the work async — the agent isn't blocked on a synchronous chat.

Sequence:
- Compose `interviews/interview_NNN_<topic>.md` with questions and "**Answer:**" fields.
- Write ONE paragraph in the chat: what you found, the forks, and a link to the document.
- **Optional render step** — if the project has the `/owner-reviews` contour: render the document
  to its HTML page and open it to the owner, signaling AFTER the page is up (contour invariant I5).
  No contour → nothing changes; the md document alone is the full-fledged path.
- **Pause** the work (so the owner is signaled to come and fill in the answers). Don't guess for them and
  don't proceed blindly on UI/UX/brand/architecture questions. **In an autonomous loop** with the
  contour present: don't stand at the open page — queue the interview for the "N accumulated" batch
  page (contour invariant I7) and move to unblocked work.

### Step 5. After the answers
- **Implemented → mark it, in the same move (KAIF 2.7, origin issue #54).** The moment a decision lands in
  rules or code, record the fourth fact by hand — `node .kaif/tools/contour/review.mjs --mark-implemented
  <interview.md> <Q> --where <commit or file>` — so the queue never raises that question again (I44/I45);
  `--queue --list` then says `implemented, but open → close the status`, and the status closes by propagation.
- **Answer equivalence:** an answer given on the rendered HTML page = an answer written into the md
  = an answer said in chat. All three are the owner's word with equal force; whatever the
  transport, the decision is recorded into the md document (the contour does it mechanically for
  HTML; the agent does it for chat) **with `by` (who decided) and `at` (when)** — that is what
  makes the archive readable months later.
- **First commit the owner's answers verbatim** (the owner's originals are inviolable —
  `AGENT_GUIDE.md`, git hygiene); only then rework the document in a following commit.
- **Closing = PROPAGATION, not a status flip** (contour invariant I19). The interview counts as
  closed only when EVERY declared answer target cites "interview #NNN, QN" and is brought in line
  with the answer — **including REMOVING what the answer cancelled**: a stale risk or a phase
  order derived from the open question keeps steering the plan long after the answer landed. Cap
  on form: one citation in the blocked document — not a traceability table, not a separate
  register. For old interviews that never declared targets, the soft heuristic applies (at least
  one citation anywhere outside `interviews/`; history is not rewritten — I21).
- Only AFTER the propagation pass: add the "Decisions" table and change status to
  `✅ ANSWERS RECEIVED <date + time>` — the status change is the LAST action, not the first.
- **Stale-status check** (the guard's second half): status says "awaiting" while no answer field
  is empty ⇒ THE STATUS IS STALE — fix it and look for what else never propagated. In the field an
  interview hung "awaiting" for two days over twelve filled answers.
- **An owner's comment on an UNANSWERED question is INPUT, not a footnote.** Before showing the
  question again, REWORK it: rebuild the options FROM the comment's words (mark them v2, with
  provenance), never re-serve the stale list. The owner's field complaint, paraphrased: "my
  comment should have shaped the new answer options — instead you fed me the old ones I had
  explicitly not chosen" (2026-08-07). Re-showing an unchanged question after a comment makes
  the owner repeat themselves — the same class as re-asking a settled verdict.
- Proceed to implement per the approved plan (or, if the owner asks to pause — call `/pause`).

## Notes
- Style and language — match the owner's.
- Past interviews are the reference for tone and structure.
- The skill's goal — minimize bothering the owner, but do NOT make their fateful decisions for them.
