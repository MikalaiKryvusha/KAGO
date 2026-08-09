---
name: end-chat
description: FULLY CLOSE this chat and hand the baton over — update all status documents (STATUS.md, README if warranted), rebuild artifacts, commit AND push, then write the handoff so agents in OTHER chats can continue seamlessly. Use when the human says "end the chat", "wrap up", "закончим чат", "завершаем чат", "передай эстафету", "сворачиваемся", "save progress, commit and push", "заверши сессию", "зафиксируй статус". For a light in-chat pause (no pushes, no ceremony) use /pause instead. Trigger aliases (ru): «закончим чат», «завершаем чат», «передай эстафету», «сверни сессию», «сохрани прогресс», «зафиксируй статус», «заверши сессию»
---

# /end-chat — full closure: we say goodbye to this chat

The human is closing this chat for good; the work continues in OTHER chats with OTHER agent sessions
that start from an empty context. Run the closure routine **in order**, narrate each step briefly.
Don't skip steps. If a step fails — stop, tell the human, don't continue blindly.

## Step 1. Record status & the baton in STATUS.md

Update `STATUS.md`:
- **What was done in this chat** — concrete, tied to bugs/features and files.
- **Current position** — what works, what's in progress, where we are.
- **The baton ("where to continue")** — a checklist written for a STRANGER: the next session knows
  nothing this chat knew. Commands, file paths, what to verify first, open questions with owners.
- Convert relative dates to absolute (find today's date from context / `date`).

Reconcile with the active bug docs in `bugs/` and reflect their status. If a reusable lesson emerged
in this chat, capture it in `EXPERIENCE.md` (skill: `/experience`) before the baton is passed.

If the project keeps a **truth↔mirror pairs registry**, run its check commands before passing the
baton — a handoff over a drifted pair hands the next session a lie.

**The bonsai trim (STATUS is a summary, not a chronicle):** entries that stopped being "now" —
closed phases, finished sessions, shipped releases — move VERBATIM into `PROJECT_HISTORY.md`
(newest on top; move, don't rewrite). Then re-read what remains of `STATUS.md` with the two tests
from its header ("remove this line — will the next agent err?" · "readable in one sitting?"; soft
target ~200 lines). Leave the file the way you'd want to find it.

## Step 2. Refresh README (when reality moved)

Bring `README.md` in line with reality: phase status, working features, instructions. If the README
is bilingual, keep both languages in sync. Don't invent — reflect only what is done and verified.

## Step 3. (Re)build / regenerate artifacts

`<Run the project build and any artifact regeneration (e.g. a rendered README.pdf). For this framework's
own project: `node tools/build-framework.mjs` regenerates KAIF.md, and `node tools/readme-pdf.mjs`
regenerates README.pdf.>` If a build fails, stop and show the errors — don't commit broken state.

## Step 4. Commit and push (judge first)

Run a `/fable-judge` pass over this chat's finished claims before pushing (the canon: a judge pass
precedes every push). Then:

`<Use your commit tool/flow. If you have one (e.g. tools/commit.mjs that bumps build, adds, commits,
pushes), run it. Otherwise: git add -A && git commit -m "..." && git push.>`

Message style (from `AGENT_GUIDE.md`): `feat:` / `fix:` / `docs:` / `refactor:` / `ci:` + one line.
End the message with your standard co-author trailer, e.g.:
```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

## Step 5. The farewell report

Report to the human: what was recorded, what was built, the commit hash(es), what was pushed, and
the baton in one paragraph — the main thing the NEXT chat should do first. That's the goodbye.

## Notes

- The difference in one line: **/pause = the chat continues later; /end-chat = the chat says goodbye.**
- If a push is rejected (non-fast-forward) — `git pull --rebase`, retry the push, then tell the human
  about the divergence.
- Generated artifacts that are gitignored (e.g. build outputs) won't be committed — that's fine.
