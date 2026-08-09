---
name: kaif-remove
description: Respectfully remove KAIF from the project. Default — surgical removal of the framework core/wrapper while KEEPING the content artifacts (bugs, interviews, ideas, homework). Full mode (--all) also removes the artifacts. Either way the user's own project stays whole and working. Use when the human says "remove KAIF", "uninstall the framework", "remove KAIF but keep my bug reports", "fully remove KAIF", "удали KAIF", "убери фреймворк, артефакты оставь", "выжги KAIF полностью". Trigger aliases (ru): «удали KAIF», «убери фреймворк»
---

# /kaif-remove — respectful removal of KAIF (partial or full)

> ⚙️ **Staleness warning:** this is a lifecycle procedure, and an adopted local copy of it goes stale
> silently across releases. Before following it, verify the procedure against the CURRENT origin
> release notes — the machinery and the release page win over this file's prose.

Cleanly take KAIF out of a project. The guiding word is **respectful**: the user's own project remains
intact and working — we only remove what KAIF added, surgically.

## Two modes

- **Partial** — remove the framework **core/wrapper** but **keep the content artifacts**:
  `bugs/`, `interviews/`, `ideas/`, `researches/`, `homeworks/`, `reports/`, and any other knowledge the
  work produced. The agent's accumulated knowledge survives; only the KAIF machinery leaves.
- **Full** — remove the core/wrapper **and** the content artifacts. KAIF is burned out of the project's
  history as if it had never been there — leaving only the user's project.

## Procedure

1. **MANDATORY — ask the owner, in natural language, WHICH removal to run, and wait for an explicit,
   unambiguous answer.** This is destructive; never assume a mode. Ask plainly, e.g.:

   > *"Removing KAIF. Which do you want — **partial** (remove the framework, but KEEP your content
   > artifacts: bugs, interviews, ideas, research, homework) or **full** (remove KAIF AND those artifacts)?
   > The rest of your project stays untouched either way. Please answer in words."*

   - Proceed **only** on a clear, unambiguous natural-language answer that names one mode.
   - If the answer is vague, ambiguous, or conditional ("maybe", "whatever's cleaner", "up to you", silence)
     — do **not** guess and do **not** default. Ask again, restating the two options, until the owner gives
     an explicit choice.
   - A `--all` flag or an explicit phrase like "full removal" (in any language the owner speaks) counts
     as an explicit answer for **full**; "keep my artifacts" / "partial" counts as **partial**. Anything
     else → re-ask.

2. **Identify KAIF-owned items** from `.kaif/kaif.json` and the known layout:
   - **Core/wrapper (removed in both modes):** the key docs (`AGENT_GUIDE.md`, `PHILOSOPHY.md`,
     `BUG_FIXING_FRAMEWORK.md`, `STATUS.md`, `GOAL.md`, `MASTER_PLAN.md`, the two maps, `KAIF_FRAMEWORK.md`),
     the deployed skills (`.claude/skills/` or the agent's equivalent), the `kaif` tools,
     `KAIF.md`/`framework/` if present, `.kaif/`, and the KAIF additions to the auto-loaded context file
     (`CLAUDE.md`/`AGENTS.md`).
   - **Content artifacts (kept in partial, removed in full):** `bugs/`, `interviews/`, `ideas/`,
     `researches/`, `homeworks/`, `plans/`, `reports/`, etc.
   - **NEVER touched:** the user's own project files and directories.

3. **Un-wire the npm handles.** Remove the `kaif:*` scripts that KAIF added to the project's
   `package.json` (the block KAIF inserted), leaving the user's own scripts untouched. (`npm run` is no
   longer cluttered with KAIF handles.)

4. **Remove** the identified items per mode. In partial mode, leave a short note (e.g. keep `bugs/` with
   its README) so the artifacts remain self-explanatory without KAIF.

5. **Verify the project still works** (its own build/tests) and **report**: what was removed, what was
   kept, and confirm the project is intact. Commit `chore: remove KAIF (partial|full) — project preserved`.

## Notes
- **Never default the mode** — always get the owner's explicit natural-language choice first (Step 1). If
  you must nudge, note that **partial** is the safer/gentler option (accumulated knowledge — bug forensics,
  decisions, research — survives), but the owner decides.
- Respect git history: removal is a normal commit; the user can still see KAIF in past history unless
  they choose to rewrite it (we don't rewrite history without an explicit request).
