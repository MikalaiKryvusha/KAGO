---
name: revision
description: (Re)derive the project's MASTER_PLAN.md from GOAL.md and the current state — the high-level, stepwise roadmap from where the project is now to the vision. Run it at deploy (right after GOAL.md is filled) and whenever GOAL.md or the project's state shifts materially. Use when the human says "revise the master plan", "re-derive the roadmap", "update the plan from the goal", "revision", "пересмотри мастер-план", "перестрой план от цели", "ревизия плана". Trigger aliases (ru): «пересмотри мастер-план», «перестрой план от цели», «ревизия плана»
---

# /revision — derive the master plan from the vision

This skill turns `GOAL.md` (the vision) into `MASTER_PLAN.md` (the phased path from the current state to
that vision). It is the bridge between *what the owner wants* and *how the project gets there*.

## When to call

- **At deploy**, right after `GOAL.md` is filled — to produce the first `MASTER_PLAN.md`.
- **When `GOAL.md` changes** — the vision sharpened or shifted; the roadmap must follow.
- **When the project's state changes materially** — a phase is done, a fork was taken, priorities moved.
- On explicit request from the owner.

If `GOAL.md` is missing or empty, do **not** invent a vision — seed the `GOAL.md` template, ask the owner
to fill it, and pause. The master plan is derived from the goal, never guessed in its place.

## Procedure

1. **Read the vision.** Read `GOAL.md` end to end: the desired end result, why it matters, what success
   looks like, the boundaries and constraints. This is the destination.
2. **Read the current state.** Read `STATUS.md`, the maps (`PROJECT_STRUCTURE_EXTERNAL_MAP.md`,
   `PROJECT_ARCHITECTURE_INTERNAL_MAP.md`), and skim the project itself. This is the starting point.
3. **Decompose the journey into phases.** Break the path from *here* → *GOAL* into a handful of coherent
   phases (milestones), each moving the project meaningfully closer. High-level only — the day-to-day
   detail lives in `plans/NN_*.md`, not here. Think by `PHILOSOPHY.md`: Pareto (the vital few phases that
   move the outcome), second-order thinking (consequences of each phase), simplicity (fewest phases that
   get there).
4. **Write/refresh `MASTER_PLAN.md`.** Fill the vision line, guiding principles, the phased path (goal +
   steps + status per phase), and the decision log. If it already exists, **update in place** — preserve
   the decision log and completed phases; re-derive only what the new goal/state changed.
5. **Escalate the forks.** If deriving the plan surfaces an owner-level decision (a serious technical fork,
   a scope/priority choice), don't bake in a guess — raise it via `/interview` and note it in the plan.
6. **Sync & report.** Update `STATUS.md` if the phases changed the "where we are / what's next". Report to
   the owner: the phases you derived and any interview you filed.

## Notes
- `MASTER_PLAN.md` is a **living reference**, not a task — never DONE-tag it.
- The relationship is one-directional: `GOAL.md` drives `MASTER_PLAN.md`, which drives `plans/NN_*.md`.
  Keep it flowing that way — don't let the plan drift from the goal.
