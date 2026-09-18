---
name: resume
description: Resume work where the last session left off — read the key project documents, decide the single most important thing to do now, announce it, and start. Use when the human says "continue", "let's continue", "what's next", "where did we leave off", "resume", "резюм", "резюме", "pick up where we left off", "продолжи", "продолжим", "что дальше" — and ALWAYS when "resume" (or "резюм") is the FIRST word of the human's message with the task written below it: the skill runs FIRST, in full, then the task (AGENT_GUIDE.md → "A leading skill word is an order"). Trigger aliases (ru): «resume», «резюм», «резюме», «продолжи», «продолжим», «возобнови», «на чём мы остановились», «что дальше по работе»
---

# /resume — pick up where we left off

A new session starts with empty context. This skill rebuilds the picture fast and gets to work.

> **The word at the top of the message is the order; the task under it waits.** A message that
> opens with `resume` (or its Russian shorthand) and continues with a task runs THIS skill first, in full — the task
> is read only after the Step-2 announcement (`AGENT_GUIDE.md` → "A leading skill word is an
> order"; the mechanical half is the `prompt-resume-word.mjs` hook of the refresh-hooks module).

## Step 1. Read ALL the canon documents of the KAIF framework (in parallel)

**Read every canon document — the full set, not a slice.** A session that skips one resumes with a
hole exactly there; owners kept having to re-order the full pass by hand:

- `STATUS.md` — current state, what's in progress, the "where to continue" checklist
- `AGENT_GUIDE.md` — the rules for working on this project (the canon)
- `PHILOSOPHY.md` — how the agent thinks: KISS + Occam and the wider principle set
- `BUG_FIXING_FRAMEWORK.md` — how defects are fixed here
- `TESTING_FRAMEWORK.md` — nothing raw is trusted: the `[NOT-TESTED]`/`[TESTED]` contract
- `REQUIREMENTS_FRAMEWORK.md` — how requirements and acceptance criteria are written and checked
- `GOAL.md` — the owner's vision
- `MASTER_PLAN.md` — the long-term plan and phases
- `PROJECT_STRUCTURE_EXTERNAL_MAP.md` — external map: modules, files, data flow
- `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` — internal map: abstractions and interactions
- `KAIF_FRAMEWORK.md` — the deployment record: which KAIF is deployed here and how
- `EXPERIENCE.md` — recall relevant lessons (grep by the task's tags) so you don't repeat a known dead end

If relevant to open questions:
- `bugs/` — `ls bugs/`, open the non-`DONE` bugs

> `PROJECT_HISTORY.md` (the chronicle) is deliberately NOT in this set — it is the project's past,
> not its now. Open it on demand when you need the archaeology of a decision or an old phase.

> **This list is guarded.** `node .kaif/kaif-core.mjs check` warns BY NAME when one of the nine
> re-read core documents (`AGENT_GUIDE.md` → Document taxonomy, tier 1) is missing from the bullets
> above — a field `/resume` once opened 5 of 9 and nothing said a word (KAIF 2.7, epic TR). Put the
> bullet back; never silence the line.

> **Boundary with the context router** (`AGENT_GUIDE.md`): the router's "read only the relevant
> slice" governs tasks INSIDE a session; `/resume` is the session's ENTRY point — the one full pass
> here is exactly what makes the lazy slices safe afterwards. Never "optimize" one with the other.

The full pass IS a context refresh (`AGENT_GUIDE.md` → Context refresh): on completing it, rewrite
`.kaif/refresh-marker.json` (trigger `ritual:/resume`); the Step-2 announcement doubles as the
quote-acceptance when it cites at least one concrete line from the read — quote it.

## Step 1b. Run the owner's queue — a command with an exit condition, not a wish

Before choosing the session's direction, run the queue command of the project's interactive
contour (the one `/owner-reviews` built — e.g. `node tools/review.mjs --queue --list`, no browser)
and read what it prints: every waiting document shows its age and whether the owner has EVER seen
it (contract I40–I42). The step is not complete while a waiting document reads `NEVER SHOWN`: raise
it — the page, or a pointed question in chat with the fact recorded by `--mark-shown` — or write one
line here saying why not (a dead document → fix its status, and it leaves the queue). Printing the
queue is not delivering the question. The owner's word (field issue #47, a question printed by
~40 sessions for 48 days and never once shown): "questions to the owner come in priority number
ONE". A project without the contour runs the same step by hand: `ls interviews/` plus the status
line of every waiting document — and the same exit condition.

## Step 2. Synthesize — choose the one main thing

Pick a single direction for this session. Priority (descending):

1. **Open bugs with real symptoms** — if `STATUS.md` lists an open bug with reproducible symptoms, it's
   priority #1. Work by `BUG_FIXING_FRAMEWORK.md`.
2. **Next item from the `STATUS.md` "where to continue" checklist** — if bugs are clear.
3. **Next phase from `MASTER_PLAN.md`** — if the checklist is empty/done.

Before starting, **say the creed and the prayer aloud in the chat** (`AGENT_GUIDE.md`, the blocks
between `KAIF:CREED` / `KAIF:PRAYER` markers — in full, no paraphrase), then **tell the human in
one paragraph**: what you read and the current status; what you picked as the main thing and why;
what you're about to do right now.

Wait for confirmation only if the task is **destructive** or **large and non-obvious**. If the plan is
clear — start right after the short announcement.

## Step 3. Work

Do the chosen task. Along the way:
- Write short updates in the chat (what you're doing, what you found, where you're digging).
- Follow `AGENT_GUIDE.md` (code style, the bug framework, the test harness).
- If it's a bug — keep a log in the relevant `bugs/` file.

## Notes

- Verify the environment before relying on it (build toolchain, devices, services) — see `AGENT_GUIDE.md`.
- Don't re-derive what the docs already state; trust `STATUS.md` and the plans, then verify by doing.
