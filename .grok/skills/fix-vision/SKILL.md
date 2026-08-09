---
name: fix-vision
description: Capture the owner's latest VISIONARY chat messages — vision corrections, priorities, brand and direction given while the agent worked — and fix them into the project's KAIF documents (GOAL.md, MASTER_PLAN.md, the owner's notes in AGENT_GUIDE.md). Use when the human says "fix the vision", "capture my vision", "зафиксируй видение", "обнови видение из чата", OR when the agent notices vision-level guidance accumulating in the chat that is not yet reflected in the docs. Trigger aliases (ru): «зафиксируй видение», «обнови видение из чата»
---

# /fix-vision — fix the owner's vision from the chat into the docs

If the owner wrote into the chat during working sessions — corrected the agent, set priorities, refined
what the product should be — that is **vision entering through the side door**. Chat evaporates; the
KAIF documents do not. This skill moves the vision from the chat into the framework.

## Procedure

### Step 1. Collect
Re-read the **owner's messages** in the current session (plus, where available, recent traces: the
session notes in `STATUS.md`, `interviews/`, recent commit messages) and extract the statements that are
**vision-level** — about what the product should be, priorities, brand, values, working style — as
opposed to one-off task instructions.

### Step 2. Distill
Turn each into a short principle **in the owner's voice**. Keep the owner's wording where it carries
meaning; never paraphrase the intent away. Convert relative dates to absolute.

### Step 3. Fix into the documents
- **`GOAL.md`** — changes to the vision itself (what we want in the end, for whom).
- **`MASTER_PLAN.md`** — changes of priorities/scope; if the shift is big, re-derive via `/revision`.
- **`AGENT_GUIDE.md` → "Notes from the owner"** — durable working-style directives.
- The agent system's persistent memory, if it has one — a pointer, not a copy (DRY).

### Step 4. De-duplicate & report
Update existing records instead of appending duplicates; delete captures that the owner has since
overridden. Then report in chat: what was captured, where it landed, and anything ambiguous — ask, or
open an `/interview` for fateful forks.

## Rules
- The vision belongs to the owner: capture faithfully, **never invent or extrapolate** it.
- This is a hygiene skill — cheap to run; prefer running it at `/pause` if the owner wrote a lot.
