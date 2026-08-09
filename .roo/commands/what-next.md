---
description: Propose the next steps when the owner asks "what's next?" — a value-ranked plan of what to do right now toward the owner's vision, derived from GOAL.md, MASTER_PLAN.md, STATUS.md and the open backlog. Use when the human says "what's next", "what now", "what should we do next", "что дальше", "предложи следующие шаги" — especially to pull the agent out of a stalled state where it stopped without proposing anything. Trigger aliases (ru): «что дальше», «что теперь», «предложи следующие шаги»
---

# /what-next — propose the highest-value next steps

Sometimes the agent stops and proposes nothing. This skill is the one-command answer to the owner's
simple question — **"what's next?"** — a plan of next steps ranked by value toward the owner's vision.

## Procedure

### Step 1. Re-orient (cheap, no deep dive)
Read `GOAL.md` (the vision), `MASTER_PLAN.md` (the phase we're in), `STATUS.md` (where we are), and walk
the open backlog: `bugs/`, `ideas/`, `plans/`, `homeworks/` without the `DONE` tag, plus unanswered
`interviews/`.

### Step 2. Rank by value
Order candidate steps by **value toward the vision** per `PHILOSOPHY.md`: Pareto (the vital few that
move the result), the Eisenhower matrix (important × urgent), second-order effects (what unblocks the
most future work). Note the rough effort of each.

### Step 3. Answer in chat
1. **The ONE next step** — highest value, and *why it is next* (tie it to GOAL/MASTER_PLAN).
2. **2–4 runner-ups** — one line each, with value/effort.
3. **Blocked on the owner** — open interviews/homework, if any.

### Step 4. Offer to start
Offer to begin the top step immediately; on the owner's confirmation (or in an autonomous loop) — start.
An unplanned step gets planned before code: `/plan-task` for an ordinary one, `/plan-epic` when the
heaviness test says it's heavy.

## Rules
- Never answer "nothing to do": an empty backlog means propose `/check-backlog` or `/refresh-context`,
  quality/debt work, or an `/interview` to refill the vision.
- Be concrete: steps with names and files, not generalities.
