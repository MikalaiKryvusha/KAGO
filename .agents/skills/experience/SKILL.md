---
name: experience
description: Work with the agent's accumulated experience log (EXPERIENCE.md) — either CAPTURE a fresh lesson ("let's add this to experience", "log this", "remember this lesson", "add to experience") or RECALL relevant past lessons before a task ("recount your experience", "what do we know about this", "check your experience", "recall lessons"). EXPERIENCE.md is externalized memory of what works and what doesn't, so a context-less session or an autonomous loop never repeats a dead end. Invoked by the human with those phrases AND by the agent itself — recall at the start of a task, capture after any meaningful success or failure. Trigger aliases (ru): «вспомни опыт», «сверься с опытом», «допиши урок в опыт»
---

# /experience — the agent's accumulated experience (EXPERIENCE.md)

`EXPERIENCE.md` (project root) is the agent's **growing log of lessons** — externalized memory of *what
works and what doesn't*. It survives context resets: a fresh session or an autonomous loop consults it and
avoids repeating dead ends. It is a **living reference — never DONE-tagged**. Plain markdown, searched with
grep — no database, no vectors.

This skill has two modes. Match the human's phrasing (or your own need) to one.

## Mode A — CAPTURE a lesson ("add this to experience")

Trigger: the human says "let's add this to experience" / "log this lesson" / "remember this", OR you just
finished something with a reusable takeaway (a success worth repeating, a failure worth avoiding, a
non-obvious gotcha). **Capture proactively — don't wait to be asked.**

1. **Distill the lesson** to its reusable core — the *approach-level* takeaway, not defect detail
   (defect detail belongs in `bugs/`; `EXPERIENCE.md` is "what to do / not do next time").
2. **Write one entry** at the **top** of the `## Entries` section, in the canonical format:
   ```
   ### EXP-NNNN · <ISO date> · <✅|❌|❌→✅> · #tag #area
   **Context:** one line.
   **Tried / did:** briefly.
   **Result:** ✅/❌ — what happened.
   **Lesson:** the reusable takeaway.   → link: bugs/NN · ideas/NN · plans/NN (if any)
   **Repro:** the ready-to-run command/check that verifies or applies the lesson — REQUIRED since 2.1:
     a lesson with no Repro line is not accepted (a weak session executes a pasted command reliably,
     an essay it won't act on). If the lesson genuinely has no command, say what to OBSERVE — as an action.
   **Trigger:** for class-level lessons — the decision point that must invoke this lesson, as
     "writing X → run Y" (the lesson names WHERE it applies, instead of hoping to be remembered).
   **Not for:** the validity range — where this lesson does NOT apply.
   ```
   - `EXP-NNNN` = next id (highest existing + 1, zero-padded).
   - Pick 1–3 short `#tags` **inline on the entry** (there is no central tag cloud) — reuse an existing tag
     where one fits (grep the file to see what's in use), so `grep '#tag'` collects related experiences.
   - Keep it SHORT and grep-friendly: stable id, ISO date, outcome marker, inline tags.
3. Keep it truthful — record what actually happened, including failures.
4. **A lesson that repeats is a lesson that failed as text.** When the same class recurs in NEW code
   after its entry was recorded, the lesson MUST become executable (a linter rule, a guard, a gate) and
   the entry gains the line `mechanized: <the tool>`. Two strikes → a mechanism, never a third reminder.

## Mode B — RECALL lessons ("recount your experience")

Trigger: the human says "recount your experience" / "what do we know about X" / "check your experience",
OR you are **starting a task** and want to avoid known dead ends. **Recall at the start of a task by
default** — it's cheap and prevents repeated mistakes.

1. **Grep** `EXPERIENCE.md` by the task's tags/keywords: `grep -i '#loop\|context' EXPERIENCE.md`
   (`-A4` to include the entry body), then read the matched entries.
2. **Summarize** the relevant lessons in 1–5 lines: what was tried, what worked, what to avoid — and let
   that steer the approach BEFORE writing code. If a past entry says an approach failed, don't blindly
   retry it; go the other way (or note why this time differs). Mind each entry's **Not for:** range —
   a lesson applied outside its range is a new mistake, not experience.
3. **Quote what you recalled** (id + one line each) in your report — or state "no relevant lessons".
   An unquoted recall is unverifiable; `/fable-judge` checks for this line.

## Notes

- **Boundary with `bugs/`:** `bugs/` = one document per defect (symptom → forensics → fix). `EXPERIENCE.md`
  = short, cross-task lessons at the level of approach — including successes. Link, don't duplicate.
- **Autonomy:** in loops (`/autoloop`, `/dayloop`, `/nightloop`) and on `/resume` / `/refresh-context`,
  recall at the start and capture after meaningful outcomes — without waiting for the human.
- **Hygiene:** keep entries short; reuse tag names consistently (grep before inventing a near-duplicate tag)
  and periodically prune stale entries (like grooming a backlog) so the file stays greppable.
