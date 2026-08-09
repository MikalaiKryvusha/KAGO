---
name: refresh-context
description: Refresh the project context — re-read the master plan and project map, the key guidance docs, walk bugs/ and plans/ (open, non-DONE) and rebuild the current backlog, then take something into work. Called by the human ("refresh context", "re-read the docs", "rebuild the backlog", "освежи контекст", "перечитай доки") AND by the agent itself periodically inside long autonomous loops (nightloop/dayloop) so it doesn't lose the big picture between iterations. Trigger aliases (ru): «освежи контекст», «перечитай доки», «пересобери беклог»
---

# /refresh-context — refresh context and rebuild the backlog

Long autonomous loops and context loss between sessions make the agent lose the big picture. This skill
restores it quickly and forms a current backlog.

## What to do

1. **Re-read strategy & map:**
   - `MASTER_PLAN.md` — the master plan and phases (where we're going).
   - `PROJECT_STRUCTURE_EXTERNAL_MAP.md` — the map of modules/files and data flows (how it's built).

2. **Re-read the KEY guidance docs:**
   - `AGENT_GUIDE.md` — the rules (git workflow, style, tools, build).
   - `STATUS.md` — current state, what's in progress, "where to continue", "awaiting human review".
   - `BUG_FIXING_FRAMEWORK.md` — how to fix bugs.
   - `TESTING_FRAMEWORK.md` — how you test what you make: the `[NOT-TESTED]`/`[TESTED]` contract.
   - `REQUIREMENTS_FRAMEWORK.md` — how requirements and acceptance criteria are written and checked.
   - `PHILOSOPHY.md` — the simplicity principle (KISS + Occam).
   - `GOAL.md` — the owner's vision: what all of this is ultimately for.
   - `EXPERIENCE.md` — recall accumulated lessons (grep by the current task's tags) before diving back in.

   Steps 1–2 together must cover the re-read core (`AGENT_GUIDE.md` → Document taxonomy, tier 1).
   The list above IS that core, spelled out — because a weak session executes bullets, not pointers:
   this skill once claimed full coverage while naming six documents of the nine, and all four
   autonomous loops delegate their refresh to exactly this skill.
   Finish the re-read by updating the two-part refresh witness (`AGENT_GUIDE.md` → Context refresh):
   rewrite `.kaif/refresh-marker.json` and quote in the chat one line from the re-read relevant to
   the current work.

3. **Check the environment dossier** (`AGENT_GUIDE.md` → Environment dossier). Read the "Taken"
   date in the section header: **older than four weeks, or values still `— not probed yet —`
   (a fresh deployment) → re-run the probes in column 3 and rewrite the values and the date.**
   Probe in EVERY shell available separately — the difference between shells is the point. Fresh
   dossier → skip this step; it is not a per-refresh ritual, it is a staleness check. A fact you
   could not probe stays `— not probed yet —`: a missing fact is honest, an invented one is a
   defect.

4. **Walk the backlog and rebuild it:**
   - `ls bugs/` — take everything NOT tagged `DONE` (open bugs).
   - `ls ideas/` — take everything NOT tagged `DONE` (open ideas/features).
   - Glance at `homeworks/` and `interviews/` — what's waiting on the human (don't take into
     work, but know it).
   - Form the current open-task list (briefly, e.g. in a TodoWrite list).
   - 🧹 **If the backlog hasn't been revised in a while** (closed files without the `DONE` tag have piled
     up) — call `/check-backlog`: it tags genuinely-closed files DONE and returns a clean open list.

5. **Pick one task** from the rebuilt backlog (priority: finish what's started > bugs > new ideas) that
   doesn't need a human decision. An unplanned item gets planned before code: `/plan-task` for an
   ordinary one, `/plan-epic` when the heaviness test says it's heavy. If you're in a loop — continue
   the loop with it.

## Notes
- This is a FAST skill (read + list), a couple of minutes. Don't rewrite docs without need.
- If human-level questions surface — file them in `interviews/` and mark `STATUS.md` "❓ awaiting human review".
- In autoloops, call this once every few iterations, not every iteration.
