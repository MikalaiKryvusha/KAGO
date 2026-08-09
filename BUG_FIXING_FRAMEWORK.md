# BUG_FIXING_FRAMEWORK — how the agent fixes defects

> Defects arrive here from testing (`TESTING_FRAMEWORK.md`: nothing raw is trusted — `[NOT-TESTED]`
> content gets verified, and what verification finds broken lands in `bugs/`). Bugs are what is born
> when testing's checks run against what `REQUIREMENTS_FRAMEWORK.md` demanded — this canon closes
> that chain.

To fix a bug, the agent must:

- **Focus on this one bug only.** Don't refactor the world; don't fix three other things along the way.
- **Narrate in the chat**, at least a little, in natural language — what you are doing right now — so
  the human can glance over and understand where the work is.
- **Reflect and capture knowledge** for every bug, even small ones, in a dedicated markdown file per
  bug in the `bugs/` directory.
- **Intent gate before the first behavior-changing edit** (fable-method, Step 4): write one line —
  `INTENT: code does <X>; the failing check/task expects <Y>; the spec (README/docs/docstring) says <Z>`
  — actually opening the spec to fill the third slot. If X/Y/Z disagree, the disagreement IS the finding:
  the "bug" may live in the check or in the task framing, not in the code. Never silently make one side
  match another; authority order: explicit owner statement > spec > tests > current code behavior.
- **Enter the loop:** run the app → reproduce the bug → read the logs for this bug → form a guess at the
  cause → make a *single, targeted* change → build → run the app again → try to reproduce again.
- The essence: **targeted changes, then a build to test whether the change helped or not.**
- Simplified: Fix → Test → Read logs → Fix → Test → Read logs → … until it works correctly. Working
  correctly **is the acceptance criterion** — at that point the bug is considered fixed. "Works
  correctly" is an *observation* (it ran, it rendered, it counted), never an inference from reading the
  diff — an unverified "fixed" claim is the classic fraud `/fable-judge` exists to catch.
- **Twin check after the fix** (fable-method, Step 5c): a defect found in one place is presumed to recur
  elsewhere until you have searched. Name the exact wrong construct, search the whole project for it, and
  record in the bug document (and your report): `TWINS: searched <pattern> — found <N> other sites:
  <files, or "none">`. Fix them or list them — a completeness claim with no search behind it is hollow.
- **Close the class, not the instance.** The fix STARTS with an inventory of ALL occurrences of the
  defect class (grep/script → the list goes into the bug document), proceeds by the list, and is judged
  by the list: "one fixed" ≠ "class closed" — an owner who has to say "and in the other menus too" is
  doing the agent's sweep. Where possible, fix by *form* — copy the directory instead of the file, one
  shared component instead of clones, a named token instead of scattered literals — so the class cannot
  drift apart again.
- To fix a bug, it is often useful to **search the web** for the solution — forums, GitHub issues,
  Reddit, Stack Overflow, official docs.
- **Symptom "text silently corrupted / holes in a document"** → before any theory, check the
  text-through-CLI class first (`AGENT_GUIDE.md` → Document & text hygiene, four faces): a shell
  argument mangled by console encoding or command substitution corrupts data with a GREEN exit code.

> ⚠️ **THE 3-ATTEMPTS RULE → switch to research (`/bug-research`).**
> If after **three iterations** of "targeted fix → build → test" the bug is NOT fixed — STOP going
> blind and poking at random. Further random attempts waste time and builds, and (if the test depends
> on external services) are unreliable. Instead, run the **`/bug-research`** skill: deep web search with
> the raw knowledge base written into the bug document, reading and analyzing the code WITHOUT edits to
> locate the cause, reflection, and a justified hypothesis + plan. Return to fixing only once you
> understand the cause. Skill: `.claude/skills/bug-research/SKILL.md`.
>
> 🧠 **AND, MOST IMPORTANTLY (see `PHILOSOPHY.md`):** a long stall almost always means you are making
> the FIX TOO COMPLEX because you did NOT UNDERSTAND the task — NOT that the task is hard or the library
> is "buggy." Libraries are simple; it's all been figured out before us. If the fix is bulky, with a
> pile of flags and workarounds — that's a red flag: stop and RE-UNDERSTAND the task in plain words,
> find the simple supported path (KISS + Occam). A stall = a signal to simplify your understanding, not
> to "dig harder."

- For effective fixing, the code must be **commented**.
- For effective fixing you MUST reflect and write down your knowledge about working on this bug into a
  dedicated document about *this specific* fixing work. Such ruminations should and must be kept as
  separate markdown documents in the `bugs/` directory.
- Once the bug is understood or fixed (and always after the three-attempts stop), **capture the reusable
  lesson** in `EXPERIENCE.md` (skill: `/experience`) — the approach-level takeaway ("X failed because R;
  Y worked"), not the defect detail (that stays in the `bugs/` document). This is how a later session
  avoids re-walking the same dead end.
- To be able to interact with the program under test, you can and should **install or build extra
  tooling** that lets the agent observe and drive the software: see its output, inspect its state,
  reproduce the defect deterministically, and exercise it without a human. Invest in that instrumentation
  — it pays for itself across every future bug.

---

## Instrumentation — build a test harness, don't guess

The single biggest force multiplier for autonomous debugging is a **harness**: tooling that lets the
agent reproduce and observe a bug on its own, without a human in the loop and without unreliable manual
inspection.

Principles:

- **Never guess what the program is doing — observe it.** Add structured logging, a debug command
  channel, a deterministic way to drive the software into the exact state that triggers the bug.
- **Make reproduction deterministic.** A bug you can reproduce on demand is a bug you can fix. A bug
  you see "sometimes" is a research task first (`/bug-research`).
- **Prefer objective verification over eyeballing.** If a visual/manual check is unreliable (subtle
  distortions, timing), invent an objective check (a known-shape control input, a measurable output, a
  size/checksum log) and write it into the bug document.
- **Grow the harness over time.** Every time you do something manually to reproduce or verify, ask:
  "can I add a command/flag/script so next time it's one step?" Then add it, and document it in
  `AGENT_GUIDE.md`. The harness is a living tool — extend and document it.

---

## Guards — every fix births a check, and the check itself is checked

- **A fix without a guard is a fix on loan.** When a defect is closed, add a guard for its whole class —
  a lint rule, an assert, a watched string, a golden output — so the class cannot silently return. A
  cancelled decision becomes a forbidden pattern; an accepted one becomes a watched line.
- **Verify the guard on a broken version.** A guard that has never gone red proves nothing. Feed it the
  very defect it exists to catch and watch it fail; only then trust its green. Guard with **full unique
  strings/shapes, not short substrings** — a short pattern will happily match someone else's line and
  stay green while the real thing rots.
- **Byte-exact goldens for refactors:** capture the output BEFORE the change, diff AFTER. "Looks like
  the same numbers" is not evidence; an empty diff is.
- **The same obligation runs forward, not only after a defect:** new code is born with the artifacts
  that check it (`TESTING_FRAMEWORK.md` → "The work produces its own means of checking"). A guard is
  what a defect leaves behind; a test suite is what the work brings with it.

---

## A finding is not a finding until verified

Findings produced by a model — audit results, detected issues, "I found N problems" — are roughly half
false until proven, and acting on unverified findings creates edits out of thin air. Before any finding
drives a change:

1. **Mechanical checks run as a script BEFORE any LLM judgment.** Does the quoted line actually exist?
   Is the file really missing X? Code verifies hundreds of such claims in seconds, exactly.
2. **Then the skeptic pass:** the verifier's job is to REFUTE the finding; the default verdict under
   doubt is REFUTED. A finding survives verification — only then it drives work.
3. **Distinguish "refuted" from "the verifier failed to run."** A crashed or killed verifier returns
   nothing — never silently treat that as an empty list of confirmations, or real findings die with it.

---

## Working with logs

- Always check the **current time** and the **timestamp of the log file/entries** before reading — so
  you read fresh, relevant logs, not yesterday's.
- Filter logs to the bug: grep for the relevant subsystem, error text, crash markers.
- Attach the key lines (stack trace, abort message, error codes, sizes) into the bug document — they are
  the forensics future sessions will rely on.

---

## The bug document (one per bug, in `bugs/`)

Capture, don't narrate. A good bug doc lets a future session (with empty context) pick the bug up cold.
Canonical structure (see `/report-bug` for the full template):

```
# Bug NN — <one-line description>

**Status:** 🔴 OPEN  (or 🟡 partial / 🔬 research-only / 🔧 fix pending verification / ✅ DONE)
**Version/build:** <...>   ·   **When/context:** <date, during which task it was found>

## Symptom
<what is observed, and how it differs from expected>

## Repro (deterministic)
<steps; harness commands if available>

## Forensics
<key logs / crash / measurements>

## Root cause / Hypotheses
<the cause if known; otherwise ranked hypotheses — do NOT patch blindly>

## Fix plan (or the fix, if done)
<steps; relation to architecture / other bugs>

## Decisions made without the owner
<filled at closing: every call the agent made solo (and how it chose), or "none" — see AGENT_GUIDE.md>

## Links
<related bugs / ideas / interviews>
```

When the bug is confirmed fixed and verified, mark it DONE by the `DONE`-tag convention (rename
`bugs/NN_x.md` → `bugs/NN_DONE_x.md` and append a `## ✅ STATUS: DONE (date + time)` section). See
`AGENT_GUIDE.md` → "Backlog & the DONE tag" and the `/check-backlog` skill.

---

## If the bug is in someone else's library

If you find a genuine defect in a third-party dependency, file an issue/ticket in their tracker (e.g.
via the `gh` CLI, on the human's behalf if authorized), and reference that ticket from your bug document.
This both helps the ecosystem and documents why you worked around it.
