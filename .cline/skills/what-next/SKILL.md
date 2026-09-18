---
name: what-next
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
Rank FIRST by the denominator: does the step move the acceptance metric of the main phase
(`MASTER_PLAN.md` → the phase marked as the main one now: its acceptance criteria closed k of n —
read from the plan, never asked of the owner) or unblock the next
run of a scarce resource (the owner's live evening, a machine, a device)? Only then order the rest by
**value toward the vision** per
`PHILOSOPHY.md`: Pareto (the vital few that move the result), the Eisenhower matrix (important ×
urgent), second-order effects (what unblocks the most future work). The newest pain is NOT a
priority claim by itself — a fresh incident earns its rank by the metric, not by its date (field:
54 honest, green sessions moved the product 11 of 389). Note the rough effort of each.

### Step 3. Answer in chat — in the FIXED FORM (KAIF 2.6, origin issue #53)
The rule "the newest pain is not a priority claim" stood here as prose, and a field agent quoted it and
broke it in the same answer. Prose does not rank; the form does. The answer OPENS with two lines read
from the documents, never from memory, then the table, then two mandatory lines:

```
METRIC: <the main phase's acceptance metric — criteria closed k of n, read from MASTER_PLAN.md / the active plan, with its date>
MAIN PHASE: <the phase MASTER_PLAN.md marks as the main one now; no mark → the first phase not closed, and say so>

| step | moves | closes | effort |
|---|---|---|---|
| 1. <step> | <metric component it shifts, or —> | <bugs/NN, plans/NN it closes, or empty> | <chats> |

Fresh owner words — not ranked by the metric (→ /fix-vision): <words of the last 48 h not yet in GOAL/MASTER_PLAN, or "none">
Tech debt: open bugs N · red M · drifted pairs K
```
Rules of the table: every row carries `moves` (or `—`) and `closes`; a row with `moves: —` and an empty
`closes` NEVER stands above a row that has at least one — and row 1 in particular moves the metric or
closes something. A fresh word of the owner earns its rank by the metric, not by its date: until
`/fix-vision` puts it into GOAL/MASTER_PLAN it sits on the shelf — visible, recorded, NOT ranked. The
debt line is always there (count the open bugs, the red ones, the drifted registry pairs). Then:
1. **The ONE next step** — row 1, and *why it is next* (tie it to GOAL/MASTER_PLAN).
2. **2–4 runner-ups** — the rest of the table, one line each.
3. **Blocked on the owner** — open interviews/homework, if any.
Lint the draft BEFORE printing it: `node .kaif/tools/kaif-ranking-lint.mjs check <draft.md>` — exit 1 names
what is missing (no METRIC:, a fresh word on row 1, no shelf, no debt line); exit 3 means it saw no answer.

### Step 4. Offer to start
Offer to begin the top step immediately; on the owner's confirmation (or in an autonomous loop) — start.
An unplanned step gets planned before code: `/plan-task` for an ordinary one, `/plan-epic` when the
heaviness test says it's heavy.

## Rules
- Never answer "nothing to do": an empty backlog means propose `/check-backlog` or `/refresh-context`,
  quality/debt work, or an `/interview` to refill the vision.
- Be concrete: steps with names and files, not generalities.
