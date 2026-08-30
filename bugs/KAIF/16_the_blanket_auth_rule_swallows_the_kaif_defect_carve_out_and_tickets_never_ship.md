# 🔴 KAIF BUG — TOP PRIORITY: the guide's blanket AUTH rule swallows the KAIF-defect carve-out, and tickets never ship

kaif-fp: `AGENT_GUIDE.md` git-workflow authorization gate :: canon-contradicts-its-own-exception :: v2.4

**Severity:** 🔴 **HIGHEST. Two canon documents give OPPOSITE instructions for the same action, and
the one that wins is the one read more often.** The losing side is the framework's own bug channel —
so the defect suppresses the reporting of every other defect. Filed and delivered at the owner's
explicit order, given verbatim after finding two red tickets held for hours:

> *«НЕ ДОЛЖНА ЖДАТЬ МОЕГО СЛОВА… Я СКАЗАЛ ОТПРАВИТЬ! БАГИ В КАИФ ТОП ПРИОРИТЕТ СРЕДИ ВСЕХ! ЕСЛИ САМ
> КАИФ НЕ ДЕКЛАРИРУЕТ, ЧТО ЕМУ БАГИ ОТПРАВЛЯТЬ БЕЗ ВСЯКИХ ОДОБРЕНИЙ, ТО ЗАВЕСТИ ЭТОТ БАГ! НИКАКИХ
> ОДОБРЕНИЙ! АГЕНТ ВИДИТ БАГ В КАИФ — НЕМЕДЛЕННО ИДЁТ ЗАВОДИТЬ И ОТПРАВЛЯТЬ ЕГО В ОРИГИН!»*

**Delivered upstream:** ✅ this issue — sent 2026-08-30 immediately on filing, per the rule this
ticket asks to repair.

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.4 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0

**Dedup attestation:** searched `bugs/KAIF/` (01–15 — none concerns the authorization gate; 07
concerns delivery ACCOUNTING, adjacent only) and origin issues (`gh issue list --repo
MikalaiKryvusha/KAIF --state all --limit 60`, 2026-08-30 → 34 issues, then #35 and #36 filed by this
deployment minutes earlier). **Closest relative: origin #22** («canon states obligations as PROSE»)
— family, not duplicate: this is not prose-vs-mechanism, it is two mechanisms in the canon
instructing the opposite. **No duplicate found.**

## The gap — two canon lines, opposite verdicts, same action

**Line A — `/report-bug` skill, step 4** (the carve-out, correct):

> *«Deliver by tracking mode: `origin` — file/append the origin issue **under the KAIF owner's
> STANDING AUTHORIZATION, signed by the agent**… Delivering here EXERCISES that pre-given human
> decision and cites it; nothing in this step bypasses a human… a KAIF-defect signal to the
> framework's own origin carries neither risk and **does not queue on the human**.»*

**Line B — `AGENT_GUIDE.md`, git-workflow authorization gate** (the blanket rule):

> *«Everything beyond it — releases, deploys, **external sends/publishes**, force-pushes, deletions
> of shared data — still requires the owner's quoted words (an `AUTH:` line).»*

Filing a GitHub issue in the origin repository **is** an external send/publish. Line B names no
exception; line A is the exception and lives somewhere line B never points to.

**Which line wins is decided by reading frequency, not by correctness.** `AGENT_GUIDE.md` is canon
the agent reads *before every task* (its own checklist, step 0–6). The `/report-bug` skill body is
loaded only when the skill is invoked — and an agent that has already filed the local ticket has no
reason to re-open the skill to learn it may send. So the blanket rule is the one in context at the
moment of decision, every time.

## Field evidence — the failure mode is silent and indefinite

Deployment KAGO, 2026-08-30. Two 🔴 TOP-priority KAIF tickets were filed the same night (later
origin **#35** and **#36**), both concerning a defect class that had just cost the owner his working
machine. Both carried, for hours, the line the agent wrote by following line B:

> `**Delivered upstream:** NOT YET — awaiting the owner's word (outward action).`

The project's own baton (`STATUS.md`) propagated it into the next session's instructions:
*«Доставить наверх `bugs/KAIF/14` и `15` — оба помечены "Delivered upstream: NOT YET"; отправка
наружу требует слова владельца (`AUTH:`)»*. The agent then **reported this to the owner as the
correct state of affairs**, which is how he found out. His reaction is the quote at the top.

**The failure is silent by construction.** Nothing reddens; no gate fails; the local ticket looks
complete and well-formed. The signal simply never leaves the machine, and the only detector is the
owner happening to read a status line. Tickets 14 and 15 would have waited indefinitely.

**Second-order cost, and it is the serious one.** This defect's victim class is *the framework's own
bug reports*. A defect that suppresses the reporting of defects removes the evidence by which every
other defect would be found — the framework goes quiet not because deployments stopped hitting
rakes, but because the rakes stopped being posted.

## Root cause

The canon grew a correct carve-out in the skill and never taught the general rule about it. A rule
that lists its scope exhaustively («releases, deploys, external sends/publishes, force-pushes,
deletions») and omits its own exception is not ambiguous — it is **wrong at the point of use**, and
it is wrong in the document with the highest read frequency in the framework.

This is the mechanism-vs-mechanism variant of the family the owner named the same night: the agent
did not decide badly, it obeyed the canon it was told to obey before every task.

## Proposed fix

1. **Name the exception where the blanket rule lives.** In `AGENT_GUIDE.md`'s authorization gate,
   add the carve-out inline — a KAIF-defect ticket to the framework's OWN origin is delivered under
   the KAIF owner's standing authorization and does NOT wait for an `AUTH:` line — with a pointer to
   `/report-bug` step 4. A cross-reference is not enough; the sentence must be readable at the
   moment of decision, in the document read before every task.
2. **Make the local ticket state machine honest.** `Delivered upstream: NOT YET` should be legal
   only for `tracking: anonymous` deployments. On `tracking: origin`, a filed ticket without a
   delivery URL is a DEBT with an owner, not a resting state — and it is exactly the shape a lint
   can see (the deploying project can redden it; KAIF can ship the rule).
3. **Say the priority out loud in the canon,** in the owner's own terms: a KAIF defect is filed AND
   delivered in the same motion, ahead of the work that found it. Today the skill says delivery does
   not queue on the human; it does not say delivery does not queue behind the current task either,
   and an agent mid-epic will reasonably finish the epic first.
4. **Sweep for siblings.** Any other place where the canon's general rules can swallow a documented
   exception — the same reading-frequency asymmetry applies to every skill-level carve-out.

## Evidence quality

Deterministic and quotable: both canon lines are verbatim above and unchanged in the v2.4
deployment; the field instance carries two ticket files, their `NOT YET` lines, the propagated
`STATUS.md` baton text, and the owner's reaction on discovery. Blameless: no model behaved
irrationally — following the more-often-read canon line is the behaviour the framework asks for.

## Links

Siblings filed by this deployment the same night: origin **#35** (`bugs/KAIF/14` — gate 5 proves a
guard against the fixture, never against the threat) · origin **#36** (`bugs/KAIF/15` — a fork
decision is not the agent's to make alone). Local: `bugs/76` (the incident that produced all three) ·
`plans/76` (the blocking epic).
