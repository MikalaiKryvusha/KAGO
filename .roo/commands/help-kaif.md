---
description: Give the human operator a clear, structured user manual for KAIF right here in the chat — what it is (briefly), and mainly HOW to use it — the structure, the conventions, the documents, the directories, and the skills/commands. Use when the human says "help kaif", "how do I use KAIF", "explain KAIF", "KAIF manual", "what can KAIF do", "как пользоваться KAIF", "помощь по KAIF", "мануал KAIF", "что умеет KAIF", "справка KAIF". Trigger aliases (ru): «расскажи про KAIF», «как пользоваться KAIF», «помощь по KAIF»
---

# /help-kaif — explain KAIF to the operator, in chat

Deliver a **user manual for KAIF directly in the chat**, in the operator's working language. This is a
teaching moment for the human running the project — it produces **no file changes**, just a clear,
well-structured explanation they can read and act on.

## Framing (important)
- **Read `.kaif/KAIF_REFERENCE.md` FIRST — it is the authoritative framework reference.** Answer
  from it and CITE its sections ("Reference §10.2") so the operator can go deeper themselves; for
  a specific mechanism question, quote the exact paragraph. Never answer about the framework from
  memory of an older version: the reference on disk describes the version actually deployed here
  (field-caught: an operator once asked "what do I have" and got an answer two versions old).
- KAIF is **already deployed** in this project. Do **not** talk about unpacking/installation — that's done.
  Speak as "here's how to *use* what's already here."
- Keep "what KAIF is" to a **couple of sentences**. Spend the bulk of the answer on **how to use it**:
  structure, conventions, documents, directories, and skills.
- Write in the operator's working language. Keep `/command` names and file names canonical.
- Base it on the deployed reality of *this* project (the reference + `KAIF_FRAMEWORK.md`,
  `AGENT_GUIDE.md`, the actual `.claude/skills/` inventory — never a hardcoded list) — not a
  generic pitch. Adapt terminology to the project's sphere.

## What to output (structure the chat message like this)

1. **What KAIF is (2–3 sentences).** A context-resilient, autonomy-disciplined method for the human–AI
   tandem: the human is the visionary, the agent the executor, and the project's memory/discipline live in
   files in the repo so no session starts from zero. One line on why it's useful here.

2. **The key documents — what to read/keep, and who owns each.** Briefly, as a list:
   `AGENT_GUIDE.md` (the canon), `PHILOSOPHY.md` (how the agent thinks), `REQUIREMENTS_FRAMEWORK.md` +
   `TESTING_FRAMEWORK.md` + `BUG_FIXING_FRAMEWORK.md` (requirements shape, testing compares,
   bug-fixing closes the gap),
   **`GOAL.md`** (the owner's vision — *your* document), `STATUS.md` (the living summary of now),
   `PROJECT_HISTORY.md` (the chronicle — archaeology on demand), `MASTER_PLAN.md`
   (roadmap), the external & internal maps, `KAIF_FRAMEWORK.md` (this "what's deployed" summary).

3. **The directories — where knowledge lives, and where the owner acts.** `plans/`, `ideas/` (mostly
   yours), `bugs/`, `researches/`, `interviews/` (you answer here), `homeworks/` (tasks for you),
   `reports/` (the agent's field and audit reports; KAIF update/install reports are mandatory there).
   Mention the DONE-tag convention in one line.

4. **The skills — the commands you type.** List them grouped, each with a one-line purpose — build the
   groups from the ACTUAL skills inventory (never this example verbatim): session (`/resume`, `/pause` —
   soft-park, the chat continues, `/end-chat` — full wrap-up with a handoff), autonomy (`/autoloop`,
   `/dayloop`, `/nightloop`, `/guarded-loop`), hygiene (`/refresh-context`, `/check-backlog`), knowledge & memory
   (`/report-bug`, `/bug-research`, `/propose-idea`, `/experience`), owner (`/interview`, `/fix-vision`,
   `/what-next`, `/owner-voice`, `/owner-reviews`), planning (`/plan-task`, `/plan-epic`, `/revision`),
   guardrails (`/derive-styleguide`, `/code-revision`), execution discipline
   (`/fable-method`, `/fable-loop`, `/fable-judge`, `/fable-domain`), help (`/help-kaif`), shipping
   (`/release`), and the lifecycle (`/kaif-version`, `/kaif-update`, `/kaif-fork`, `/kaif-switch-origin`,
   `/kaif-remove`).

5. **How a normal workflow looks.** A short example: *"`/resume` to start → I work and keep `STATUS.md`
   current → you drop ideas in `ideas/` or answer an `/interview` → `/pause` to break off (the chat
   continues later) or `/end-chat` to close the chat with a handoff."* Note the human's role (visionary:
   `GOAL.md`, ideas, interview answers) vs. the agent's (executor).

6. **Where to go deeper.** Point to `.kaif/KAIF_REFERENCE.md` (the authoritative framework
   reference — first), then `KAIF_FRAMEWORK.md` and `AGENT_GUIDE.md` for the full detail.

## Notes
- This is a **read-and-explain** skill — don't edit files, don't deploy, don't change state.
- Keep it scannable: short sections, lists over paragraphs. The goal is that the operator finishes reading
  and knows exactly which document to open and which command to type next.
- If the operator asked about one specific part ("how do interviews work?"), answer that focused, then
  offer the full manual.
