---
description: SOFTLY CLOSE this chat with full ceremonies — usually ordered IN ADVANCE, while work is still going. Acknowledge in one line, finish the current work to a natural cut WITHOUT rushing, and only then unhurriedly run the full closure (status + baton, bonsai trim, README, rebuild, pairs registry, judge pass, commit AND push, farewell). Use when the human says "wrap up when you're done", "finish up and close the chat later", "потихоньку потом закроешь чат", "нужно будет доделать и закругляться", "доделай и сворачивайся" — an advance request is NOT an order to drop the work right now. Neutral closing phrases with no urgency ("закончим чат", "завершаем чат", "wrap up", "end the chat") also mean THIS skill. For an urgent right-now closure use /end-chat-force; for a light in-chat pause (the chat continues) use /pause. Trigger aliases (ru): «потихоньку потом закроешь чат», «доделай и закругляйся», «закончим чат», «завершаем чат», «передай эстафету», «сверни сессию», «сохрани прогресс», «зафиксируй статус», «заверши сессию»
---

# /end-chat-soft — the soft closure: finish properly, then say goodbye

The human wants this chat closed — but closed WELL, not fast. The work continues in OTHER chats
with OTHER agent sessions that start from an empty context. Two phases: first honor the work,
then run the full closure ritual. Never rush either phase.

## Phase A. The advance order — keep working to a natural cut

The order usually arrives WHILE you are working ("wrap up when you're done"). Then:

1. **Acknowledge in one line** — "Got it: I'll soft-close after reaching a natural cut —
   continuing the current work." — and RETURN to the work.
2. **Finish the current work to a logical cut**: a self-contained piece is done, verified, and
   committable; nothing is left half-rewritten. Work at your NORMAL pace and quality — no rushing,
   no corner-cutting, no shrinking the task because a closure is pending.
3. Do NOT start new large work after the order — the next natural cut is where the closure begins.

If the ask arrives when nothing is in progress — Phase A collapses: begin the closure right away
(still unhurried).

## Phase B. The full closure ritual — in order, without haste

Run the steps **in order**, narrate briefly. Don't skip steps. A step fails — stop, tell the
human, don't continue blindly.

### Step 1. Record status & the baton in STATUS.md

Update `STATUS.md`:
- **What was done in this chat** — concrete, tied to bugs/features and files.
- **Current position** — what works, what's in progress, where we are.
- **The baton ("where to continue")** — a checklist written for a STRANGER: the next session knows
  nothing this chat knew. Commands, file paths, what to verify first, open questions with owners.
- Convert relative dates to absolute (find today's date from context / `date`).

Reconcile with the active bug docs in `bugs/` and reflect their status. If a reusable lesson
emerged in this chat, capture it in `EXPERIENCE.md` (skill: `/experience`) before the baton is
passed. If a previous `/end-chat-force` left a "ceremonies skipped" debt line in `STATUS.md` —
this closure pays it: run what was skipped and remove the line.

If the project keeps a **truth↔mirror pairs registry**, run its check commands before passing the
baton — a handoff over a drifted pair hands the next session a lie.

**The bonsai trim (STATUS is a summary, not a chronicle):** entries that stopped being "now" —
closed phases, finished sessions, shipped releases — move VERBATIM into `PROJECT_HISTORY.md`
(newest on top; move, don't rewrite). Then re-read what remains of `STATUS.md` with the two tests
from its header ("remove this line — will the next agent err?" · "readable in one sitting?"; soft
target ~200 lines). Leave the file the way you'd want to find it.

### Step 2. Refresh README (when reality moved)

Bring `README.md` in line with reality: phase status, working features, instructions. If the README
is bilingual, keep both languages in sync. Don't invent — reflect only what is done and verified.

### Step 3. (Re)build / regenerate artifacts

`<Run the project build and any artifact regeneration (e.g. a rendered README.pdf). For this framework's
own project: `node tools/build-framework.mjs` regenerates KAIF.md, and `node tools/readme-pdf.mjs`
regenerates README.pdf.>` If a build fails, stop and show the errors — don't commit broken state.

### Step 4. Commit and push (judge first)

Run a `/fable-judge` pass over this chat's finished claims before pushing (the canon: a judge pass
precedes every push). Then:

`<Use your commit tool/flow. If you have one (e.g. tools/commit.mjs that bumps build, adds, commits,
pushes), run it. Otherwise: git add -A && git commit -m "..." && git push.>`

Message style (from `AGENT_GUIDE.md`): `feat:` / `fix:` / `docs:` / `refactor:` / `ci:` + one line.
End the message with your standard co-author trailer, e.g.:
```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

### Step 5. The farewell report

Report to the human: what was recorded, what was built, the commit hash(es), what was pushed, and
the baton in one paragraph — the main thing the NEXT chat should do first. That's the goodbye.

## Notes

- The family in one line: **/pause — the chat continues later; /end-chat-soft — finish properly,
  then say goodbye; /end-chat-force — capture the essentials and say goodbye right now.**
- This skill is also the closing move of timed autonomous runs: a named end time means "START
  /end-chat-soft at that time" (`AGENT_GUIDE.md` → Working until a named time) — never an early
  finish out of deadline fear.
- If a push is rejected (non-fast-forward) — `git pull --rebase`, retry the push, then tell the
  human about the divergence.
- Generated artifacts that are gitignored (e.g. build outputs) won't be committed — that's fine.
