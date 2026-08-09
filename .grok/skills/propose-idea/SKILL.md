---
name: propose-idea
description: Propose an idea/feature/improvement that aligns with the project's master plan and the human's vision, filed as a separate md in ideas/ by the accepted rules. An idea born from the agent is an element of the product VISION, so it REQUIRES the human's approval (the agent does NOT implement it until approved). Invoked by the agent when a worthwhile idea arises (including in autoloops) AND by the human ("propose an idea", "file an idea", "propose-idea", "предложи идею", "оформи идею"). Trigger aliases (ru): «предложи идею», «оформи идею»
---

# /propose-idea — file an idea in ideas/ (for the human's approval)

When the agent gets a worthwhile idea (a feature, a UX/architecture improvement, a tool), it files it as
a SEPARATE md in `ideas/` by the same rules as existing ideas. **An agent's idea is a contribution
to the product VISION, and the vision belongs to the owner (the human).** So such an idea is created with
status "awaiting approval" and is **NOT implemented until the human approves it**.

## When to call

- An idea arises that moves the project toward the goals in `MASTER_PLAN.md`/`PHILOSOPHY.md` and doesn't
  contradict the human's vision.
- **The OWNER tossed an idea into the chat mid-task** (the drive-by rule, `AGENT_GUIDE.md`): file it immediately with
  the source noted in the header ("tossed by the owner, <date>"), confirm in one chat line, return to
  the interrupted task. An owner-tossed idea needs no approval gate (it IS the owner's) — but it waits
  its turn in the backlog unless the owner explicitly says "switch to it now".
- NOT for small technical decisions within an already-approved task (decide those yourself and just do them).
- NOT for questions needing the human's INPUT on work already in progress — that's `/interview` (a
  question), not an idea. The difference: `/interview` = "I need your answer to continue";
  `/propose-idea` = "I propose a NEW direction, evaluate it".

## What to do

1. **Check against the vision BEFORE filing.** Read (or recall) `MASTER_PLAN.md`, `PHILOSOPHY.md`
   (KISS) and decisions in `interviews/`. The idea must align. If it contradicts / leads astray /
   over-complicates without need — don't propose it (or reframe it simpler).

2. **Determine the next number.** `ls ideas/` → max `NN` + 1. Name:
   `ideas/NN_<short_english_name>.md` (like neighbors; NO `DONE` tag).

3. **Write the document by the canon** (structure like existing ideas):
   ```
   # Idea NN — <name>

   > Source: AI agent (dayloop/nightloop/observation), <date>.
   > Status: ❓ AWAITING HUMAN APPROVAL — an agent idea = an element of the vision; not implemented without approval.

   ## Goal vector — the pain it solves + how we check
   <what pain/opportunity, for whom, and where we want to be; acceptance criteria — how we will
   OBSERVE that the idea worked (REQUIREMENTS_FRAMEWORK.md); both may change as the work teaches>

   ## Essence
   <what is proposed, briefly>

   ## How it fits the master plan and vision
   <clear tie to master_plan / accepted decisions — why it's "on track", not sideways>

   ## Implementation sketch (KISS)
   <rough approach; reuse of what already exists; scope/risks>

   ## Open questions / what needs the human's answer
   <forks the owner must close>
   ```

4. **Mark for review and do NOT implement:**
   - A line in `STATUS.md`: "❓ awaiting human review: idea NN — <one line>".
   - Commit the document: run `git add -A && git commit -m "<msg>" && git push` with `<msg>` = `docs(ideaNN): proposal — …`.
   - **Do NOT start implementing** until the human explicitly approves. In an autoloop — continue with OTHER tasks.

5. **After the human reacts:**
   - Approved → take it into work (technical decisions inside — yours). An EPIC-scale idea (the
     heaviness test of `/plan-task`) is planned by the full ladder first — `/plan-epic`: research →
     meta-plan → phased operational plans. After implementing: status ✅ +
     date, and by the DONE-tag convention — `git mv` with the `DONE` tag and a status section inside.
   - Rejected/reframed → reflect their decision in the document (or delete the idea if rejected).

## Notes
- An idea is a PROPOSAL, not permission to act. Discipline: the product vision is shaped by the human.
- Better to gather a few small ideas meaningfully than to breed near-duplicates. Check existing open
  ideas (`ls ideas/`) so you don't duplicate.
