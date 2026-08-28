---
name: dayloop
description: Daytime autonomous work loop while the human is BUSY and can't attend to the chat. The agent takes ANY task from the backlog (that doesn't need a human architectural decision), writes code, builds, tests on the harness, fixes, periodically commits and PUSHES, and works CONTINUOUSLY (no pauses, no time checks). Unlike nightloop there is NO requirement to stop at a certain time — it works as long as there's a backlog. Stops ONLY when: (1) the human writes in the chat, (2) an insurmountable critical error. Invoked by the human ("run the day loop", "work on your own, I'm busy", "dayloop", "grind the backlog") and by the agent when the human is busy and offline. Trigger aliases (ru): «дневной цикл», «работай сам, я занят», «гринди беклог днём»
---

# /dayloop — daytime autonomous work while the human is busy

Daytime. The human is BUSY — can't attend to the chat, no one to answer, don't ping them. The machine is
on, the harness is available. The agent's job: **enter a self-directed loop and grind the backlog
autonomously**, setting its own tasks, making its own non-architectural decisions, committing/pushing,
and working CONTINUOUSLY (no pauses, no time checks).

This is the "working-hours" variant of `/nightloop`: same execution discipline and full autonomy, but
**without a time-based stop** — the day isn't bounded; work as long as there's something in the backlog.

## 🛑 STOP CONDITIONS (check at the START of each iteration)

Stop the loop ONLY if one of:
1. **The human wrote in the chat — classify before you switch** (the drive-by rule, `AGENT_GUIDE.md`): a direct request or
   question → exit the loop immediately, switch to them; a **drive-by idea/bug NOT about the current
   task** → capture it as a document right away (`/propose-idea` / `/report-bug`, source noted:
   "tossed by the owner"), confirm in one chat line and CONTINUE the loop; vision-level →
   `/fix-vision`, then continue.
2. **ONLY a truly critical error** that can't be worked around autonomously and makes continuing
   impossible in principle (toolchain hopelessly broken; repo in an unresolvable state). This is RARE.
   ❗ **Non-critical errors are NOT a stop condition — just keep working:** a failed build (fix it), a
   flaky connection (reconnect), a bug in the software (file it and fix or defer), a hard/unclear task
   (take another), a crash (investigate/fix). These are normal working situations.
3. **The owner NAMED an end time when starting this run** ("work until 11", "for an hour") and it
   has arrived → **start `/end-chat-soft`**; until that time — normal pace, no early finish out of
   deadline fear (`AGENT_GUIDE.md` → Working until a named time).

⚠️ **No time-stop, no pauses, no time checks** (unless the owner named an end time — condition 3).
Unlike the night loop, don't stop at any hour and don't
look at the clock. Work **CONTINUOUSLY**: finished one — take the next. Don't pause, don't wait for
confirmations, don't schedule big "wake up later" gaps. The only stop is a stop condition above. A
**short** `ScheduleWakeup` (≈60s) is NOT a pause — it's the loop's heartbeat to continue in a new turn
when the current one is exhausted (see step 8).

> ⛔ **"Context overflow / filling up", "turn exhausted", "tired", "risk of hitting the limit" are NOT
> stop conditions and NOT a reason to announce a pause or cut the turn short.** Context management is the
> harness's job (it summarizes and continues on its own). Do NOT assess "how much context is left" and do
> NOT end the turn yourself. Grind to the limit — until a real stop condition above fires.

## 🔁 The cycle (one iteration)

1. **Check stop conditions** (above). If stop — go to "Finishing".
2. **Pick ANY backlog task** — scale unlimited (a big one is fine). Sources: `STATUS.md` → "where to
   continue" / active items, `bugs/` (open), `ideas/` (open), loose ends. Priority: finish started
   > bugs/polish > new ideas.
   - **Make decisions yourself** (technical, implementation, approach) — don't wait for the human.
   - **ONLY brand/UX/architecture-defining decisions** (shape the product long-term, not yours to make
     alone) — don't do them blind: file the question in `interviews/interview_NNN_*.md` (`/interview`)
     AND mark `STATUS.md` "❓ awaiting human review: …". Then take ANOTHER task and continue.
   - If a task needs **human actions** (test on real hardware, external accounts) — file **homework** in
     `homeworks/` and move on.
3. **Do it**: code → build (`npm run check`) → deploy → test on the harness (`npm run gpu:info`),
   verify objectively. Use the high-level harness commands; if one is missing, do it the low-level way,
   then ADD a command to the harness so next time it's one step. Execute the item by the fable loop
   (`/fable-method`; `/fable-loop` for substantive items) — its gates and forced artifacts
   (`INTENT`/`AUTH`/`TWINS`/`PENDING`) apply inside the cycle too. A HEAVY item with no plan yet →
   `/plan-epic` first (research → meta-plan), then execute phase by phase.
4. **Judge pass — MANDATORY before "done"**: run `/fable-judge` over the finished item — re-run the
   claimed checks, diff what actually changed against the item's scope. REFUTED → the item goes back to
   work (step 3), not to "done"; after 3 failed fix-judge cycles on the same item, record it honestly in
   `STATUS.md`/`bugs/` and take another task.
5. **Document**: a worklog in `plans/`, bug docs in `bugs/`, `STATUS.md` along the way; append the
   approach-level lesson to `EXPERIENCE.md` after a meaningful success/failure (skill: `/experience`).
6. **Commit and PUSH** (per `AGENT_GUIDE.md` git workflow): after each finished task or every ~20–30
   minutes. `git add -A && git commit -m "<msg>" && git push`. **The one-step rule:** one meaningful change = one full gate run = one
   commit — no batch commits of half a day's work (a big diff can't be honestly reviewed; a judged
   failure then rolls back one file, not a session). `/fable-judge` pass before every push.
7. **Short chat report** (1–3 lines): what you did, what's next — so the human sees progress on a break.
8. **Continue CONTINUOUSLY**: finished a task — next iteration in the same turn. No pauses, no waiting,
   no time checks. **Don't assess how much context is left and don't end the turn yourself** — the
   harness does that.
   - **Loop heartbeat (`ScheduleWakeup`):** this is a *mechanical fallback* for when the harness ITSELF
     ends the turn (not you). If that happens while work remains and no stop condition fired — on resume
     call `ScheduleWakeup` with the same `/dayloop` input and a **minimal** interval (≈60s) so the cycle
     resumes immediately in a new turn. This is NOT a pause — it's how the loop survives the turn boundary.
   - Do NOT call `ScheduleWakeup` preemptively "because context is filling up", and do NOT use it as a
     pause/wait: no big "wait an hour" intervals, no time-gating.

## ⚙️ Practice

- **Don't go interactive:** the human is busy — no questions in chat with waiting for an answer.
  Human-level decisions — file in `interviews/` + mark STATUS, take another task.
- **Change safety:** small verified commits; if you break something, fix it or revert via git history.
- **🔄 Periodically refresh context** — every few iterations call `/refresh-context`; the hour rule
  applies (`AGENT_GUIDE.md` → Context refresh): >60 min since the last refresh, or a HEAVY item
  next → refresh now, with the marker + quote witness.
- **🧹 Occasionally revise the backlog** — every few iterations (not every) call `/check-backlog`.
- **🐞 Hit a bug** you won't fix right now — file it with `/report-bug`.
- **💡 A worthwhile NEW idea** (in line with the master plan/vision) — file it with `/propose-idea` and
  continue with OTHER tasks. **Don't implement it before the human approves.**

## Backlog empty / nothing to do

If no open tasks remain in `bugs/` and `ideas/` (all DONE or awaiting the human) — **still don't
pause and don't wait**, keep working:
- Polish/refactor/tests/docs per `PHILOSOPHY.md` (KISS) — acceptable work.
- Form and record in `STATUS.md` proposals of new tasks/ideas for the human.
- Continue the next iteration until a stop condition fires.

## Finishing (when a stop condition fired)

- Get the current micro-step to a compiling state, **commit and push** (don't leave broken/uncommitted main).
- Update `STATUS.md`: what's done, where you stopped, what's next, any "❓ awaiting human review".
- If stop = the human wrote — switch to them; give a short summary of what got done.
- If stop = a critical error — describe it, what you tried, why you can't continue; wait.

## Notes

- This is an INTENSIVE mode: don't spare tokens/time, maximize useful autonomous work.
- The global goal and vision live in `STATUS.md`/`plans/`/`AGENT_GUIDE.md`/`PHILOSOPHY.md`. Keep checking against them.
