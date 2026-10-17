# KAIF bug: a turn that ends WAITING for the owner ends with a chat question and no voice call — nothing at the decision point makes the call happen

kaif-fp: AGENT_GUIDE.md#decisions-the-agent-must-not-make-alone :: wait-without-call :: v2.9
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/157
**Autocapture** (from `.kaif/kaif.json`): KAIF 2.9 · project KAGO · sphere programming · language ru · tracking origin ·
agent system claude-code (VS Code extension) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "\-\-call\|голосом\|voice" bugs/KAIF/` → 02, 03, 05, 07, 19, 23, 27 —
none about a missing call at a wait; they are voice timbre, language, delivery accounting) and open origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state open --search "call owner voice turn end"` and `--search "--call"` →
#137, #148, #149, #153, #154, #155, #156 — none about the call at a wait). No match found.

## Expected per canon

> «**When the work STOPS until the owner acts or answers** — a password, a cable, a device to unlock, a one-line answer —
> **CALL the owner:** `node .kaif/tools/contour/review.mjs --call "<what is needed>"` (sound → banner → voice, naming the calling
> session); a request left only in the chat is not delivered: the owner does not watch the chat while you work (2.8, origin
> issues #95 · #98).» — `AGENT_GUIDE.md` → «Decisions the agent must NOT make alone — interviews»

## Got in the field (KAGO, 2026-10-17)

The session ran `/resume`, did the offline steps of its plan, and its only next step was a LIVE card step that by the
project's rule needs the owner at the machine. It ended the turn with the question in the chat — «Решение за вами:
запускаем проверку режима на новой кривой?» — and no `--call`. The owner, verbatim, in four messages:

> «а хули ты встал?» · «так а хули голосом не позвал!!!» · «БАГ В КАИФ!!» · «АГЕНТ ВСТАЛ, ЖДЕТ ВЛАДЕЛЬЦА И НЕ ПОЗВАЛ ГОЛОСОМ, А ДОЛЖЕН БЫЛ!"!!!»

The agent had read the rule above IN FULL at the start of the same session (the `/resume` canon pass).

## Repro (deterministic)

1. A deployment with the contour (`--call` available), a session whose next step needs the owner's go (a live/destructive step).
2. The agent finishes the work it can do alone and composes the final message with «shall I …?».
3. Observe: nothing between composing that message and ending the turn asks «does this turn end waiting on the owner?» — the
   rule lives in one paragraph of a long guide; no skill step, no checklist line, no hook fires at turn end. The call is skipped.

## Cost and violated invariant

The owner's time: he discovered the stop himself, minutes later, by looking at the chat — exactly the case the rule exists for.
Invariant: **autonomy** (the session idles without the owner knowing) and **owner-work-safety** of attention (the owner is made
to poll the agent). Fourth face of the same class after #95 · #98.

## What in KAIF led to this

The obligation has the PROSE form only (`AGENT_GUIDE.md` → «The form of an obligation»: a command, a step, or a checkbox — prose
never carries an obligation alone). The decision point is «the turn ends while waiting on the owner», and none of the places that
point passes through carries the command: `/resume` Step 2 says «wait for confirmation only if it is destructive or large» with no
call; the fable loop's step 7 (report) has no «waiting? → call» line; there is no Stop-hook check. A weak session under load follows
the step it is executing, not a paragraph read an hour earlier.

## Proposed change (smallest)

1. A step at the decision point: `/resume` Step 2 and the fable loop's report step — «the turn ends waiting on the owner →
   `node .kaif/tools/contour/review.mjs --call "<what is needed>"` in the same turn; the chat repeats it».
2. The mechanical half (optional refresh-hooks module): a `Stop` hook that reads the last assistant message for a question to the
   owner (`?` in the final paragraph / «решение за вами», «запускаем?», «shall I») and, when no `--call` ran in that turn, prints
   the reminder — or runs the call itself.

## Local remediation

Agent memory `call-by-voice-when-waiting-for-owner` (written 2026-10-17 17:4x) — prose again, not mutation-proved; the class is
closed only by a step or a hook upstream.
