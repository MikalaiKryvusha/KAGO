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
- Don't ask what's already decided in `plans/`/`MASTER_PLAN.md` or past interviews.

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
