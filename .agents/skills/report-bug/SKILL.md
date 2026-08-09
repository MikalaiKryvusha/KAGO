---
name: report-bug
description: File a bug document in bugs/ by the project's rules, when the agent hits a defect during development/testing (a crash, wrong behavior, regression, library defect). The agent keeps its OWN bug backlog — one md per noticed bug, by the canon of the existing bugs/ docs. Branches for a defect of the KAIF framework ITSELF (a doc/skill/machinery rake) — bugs/KAIF/ with templates A/B, dedup against existing tickets, origin delivery by tracking mode. Invoked by the agent when it finds a bug (including inside autoloops) AND by the human ("file a bug", "report this bug", "report-bug", "write this bug down", "заведи баг", "зарепорти баг"). Trigger aliases (ru): «заведи баг», «зарепорти баг», «запиши этот баг»
---

# /report-bug — file a bug document in bugs/ (the agent keeps its own bug backlog)

Whenever the agent writes code, tests it, and **hits a bug** (crash, wrong behavior, artifact,
regression, library defect), it files a SEPARATE md document in `bugs/` by the same rules as the
existing bug docs. This way the agent accumulates a bug backlog for itself — nothing is lost, and any bug
can be returned to (or handed to `/bug-research`).

> Project rule (`AGENT_GUIDE.md`): "for every bug, even small ones — reflect and capture knowledge in a
> dedicated md in `bugs/`." This skill automates exactly that.

## When to call

- The agent saw a defect during dev/test that it is NOT fixing right now (or is fixing, but wants to
  capture the forensics/postmortem).
- A bug needs to be deferred (take another task) without losing it.
- The human asks to file a bug.
- **The owner mentioned a bug in passing while you worked on something else** (the drive-by rule, `AGENT_GUIDE.md`):
  file it with the source noted ("tossed by the owner, <date>"), confirm in one line, return to the
  current task.
- NOT for a "stuck-from-misunderstanding" stall (that's `PHILOSOPHY.md`) and not instead of fixing a trivial typo.

## Branch first — a defect of the FRAMEWORK itself, not the project

If the rake exists because of how **KAIF itself** is worded or behaves — a guiding doc/skill/machinery
step misled you, a gate lied green, a guardrail that would have prevented the mistake is missing — the
signal is addressed to the KAIF developer, not to this project's backlog (the "defect in KAIF itself"
contour in `AGENT_GUIDE.md` governs the local fix; this branch governs the REPORT):

1. **Classify:** a defect → template A (bug report); a gap or wish — including a battle-tested
   principle proposal (or dropping a non-working one) → template B (improvement request).
2. **Dedup BEFORE filing** (the attestation line in the body is mandatory — a search claim without
   the command behind it is empty): grep the local registry —
   `grep -ri "<surface>" bugs/KAIF/ | grep -i "<symptom-class>"`; on an origin-tracked deployment
   (`tracking: origin` in `.kaif/kaif.json`) also search open origin issues:
   `gh issue list --repo <origin> --state open --search "<surface> <symptom-class>"`.
   A match on surface + symptom-class (the version is NOT part of the key) = the SAME signal →
   append a "+1 observation" comment there (conditions, environment, version, steps, expected/got;
   new version of the same class → "reproduced on vX.Y") — do NOT open a new ticket.
3. **File locally:** `bugs/KAIF/NN_*.md` by template A/B below (create the directory on first use).
4. **Deliver by tracking mode:** `origin` — also file/append the origin issue ON THE OWNER'S
   BEHALF, and only through the project's send gate / with the owner's quotable standing
   authorization; `anonymous` — the signal stays LOCAL, never reach for the origin.
5. **Sender quality gate:** a signal goes upstream only with a deterministic repro OR verbatim
   quote-evidence; blameless wording (a weak model's failure is described as a missing guardrail,
   never as "the model is dumb").

Both templates open with the machine-grepable fingerprint
`kaif-fp: <surface> :: <symptom-class> :: v<major.minor>` — surface is the canonical delivery path
(doc, skill, tool, module anchor); symptom-class is a short slug from an open dictionary.

### Template A — KAIF bug report

```markdown
# KAIF bug: <one-line defect statement>

kaif-fp: <surface> :: <symptom-class> :: v<major.minor>
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF <version> · project <name | anonymized> ·
sphere <…> · language <…> · i18n <…> · tracking <origin | none> · agent system <…> · OS <…> · Node <…>
**Dedup attestation:** searched `bugs/KAIF/` (<command → result>) and open origin issues
(`gh issue list --search "…"` → <result>). No match found. <!-- match found → comment there, no new ticket -->

## Expected per canon
<verbatim quote of the KAIF doc/skill/tool output that promises the behavior> — <file / section>

## Got in the field
<verbatim evidence: log lines, diff, command output — never a paraphrase>

## Repro (deterministic)
1. <smallest step sequence; sandbox recipe if the live project cannot be shared>

## Cost and violated invariant
<what it broke or nearly broke (near-miss counts); which framework invariant it violates:
owner-work-safety / honest-green / owner-decisions / cold-start / memory / autonomy / universality-anonymity / self-sufficiency / simplicity>

## What in KAIF led to this
<the mechanism or assumption that produced the defect — point at the module, not the symptom>

## Local remediation (per the "defect in KAIF itself" contour, if applied)
<local fix + whether it is mutation-proved; "none" if not applicable>
```

### Template B — KAIF improvement request

```markdown
# KAIF improvement request: <one-line proposal>

kaif-fp: <surface> :: <symptom-class> :: v<major.minor>
**Autocapture:** <same line as template A>
**Dedup attestation:** <same as template A>

## Gap
<what KAIF lacks or does clumsily — with a verbatim quote of the current canon/tool output that shows the gap>

## Field evidence
<the episode(s) that paid for this proposal: project, date, what happened; ≥1 verbatim artifact.
For principle proposals (battle-tested methodology — or dropping a non-working one): where it is
proven in production — projects, hours, sources. The owner of KAIF decides the proposal's fate.>

## Proposed change (smallest that closes the gap)
<doc/skill/tool + sketch of wording or behavior>

## Expected effect and its check
<observable verification that the change worked; which framework invariant it serves>
```

## What to do

1. **Determine the next number.** `ls bugs/` → max two-digit `NN` + 1. Filename:
   `bugs/NN_<short_english_name>.md` (snake_case, like its neighbors; NO `DONE` tag — the bug is open).

2. **Gather facts BEFORE writing** (don't invent — a bug doc is valuable for its facts):
   - Symptom: what exactly is observed (and how it differs from expected).
   - Repro: deterministic steps. Where possible — via the harness, so the bug reproduces without the human.
   - Forensics: logs / crash file / measurements — attach the key lines (stack, abort message, error
     codes, sizes).
   - Build/version, environment, mode.

3. **Write the document by the canon** (structure like the existing bug docs):
   ```
   # Bug NN — <one-line description>

   **Status:** 🔴 OPEN   (or 🟡 partial / 🔬 research-only / 🔧 fix pending verification)
   **Version/build:** <build>   ·   **When/context:** <date, during which task it was found>
   **Fix accepted when (observable):** <what will be SEEN working after the fix — written by
   REQUIREMENTS_FRAMEWORK.md; refine as the investigation teaches>

   ## Symptom
   <what is observed>

   ## Repro (deterministic)
   <steps; harness commands if available>

   ## Forensics
   <key logs / crash / measurements>

   ## Root cause / Hypotheses
   <the cause if clear; otherwise ranked hypotheses — do NOT patch blindly>

   ## Fix plan (or the fix, if done)
   <steps; relation to architecture / other bugs>

   ## Decisions made without the owner
   <filled at closing: every call the agent made solo (and how it chose), or "none">

   ## Links
   <related bugs / ideas / interviews>
   ```
   Follow `BUG_FIXING_FRAMEWORK.md`. If the bug is in a third-party library, file a ticket for them (e.g.
   via `gh`) and reference it from the doc.

4. **Record in the backlog/process:**
   - If important/blocking — a short line in `STATUS.md`.
   - Commit (in autoloops, by the usual discipline): run `git add -A && git commit -m "<msg>" && git push` with `<msg>` = `docs(bugNN): …`.

5. **Lifecycle:** while open — file WITHOUT `DONE`. When CONFIRMED closed (fixed and verified) — rename
   `git mv bugs/NN_x.md bugs/NN_DONE_x.md` and append a `## ✅ STATUS: DONE (date + time)` section (what was
   done / how verified). Backlog revision — the `/check-backlog` skill.

## Notes
- Better to file a bug and leave it open than to lose it. Factual accuracy beats prose.
- If a bug resists (≥3 blind fix attempts) — switch to `/bug-research` (investigation without code) on the same doc.
