---
name: code-revision
description: A periodic READING revision of the codebase by the strongest available model — the complement to gates and judges, which only check what was CLAIMED: zone the code by axis, run parallel reviewers each armed with the project's own PAID-FOR failure classes (EXPERIENCE + bugs), demand a verbatim quote for every finding, then send every finding through an adversarial skeptic whose default verdict is "not a defect"; survivors become bug docs and their lessons feed the guardrails weak models run on. The run leaves audit reports in `reports/KAIF_AUDIT/` grouped by finding family, each finding written as a contract a weaker model can execute. Use when the human says "run a code revision", "прогони ревизию кода", "audit the codebase", or on the cadence the project sets (e.g., every N weeks); distilled from two field audits (project C and project A) that found every real defect OUTSIDE what gates could see. Trigger aliases (ru): «прогони ревизию кода», «ревизия кода», «аудит кодовой базы», «вычитай код»
---

# /code-revision — the periodic reading revision

Gates and judges verify what was CLAIMED ("did X — is X true?"). Two independent field audits
found the same thing: every real defect lived in the UNCLAIMED — checks that could not physically
fail, invariants guarded in one direction, comments describing deleted code. Those are found only
by READING, and reading at strength is exactly what a periodic revision by the strongest available
model buys: one strong hour closes weeks of accumulated weak-session gaps — and its findings feed
`EXPERIENCE.md` and the sphere's craft recipes, which is what makes the WEAK sessions smarter
afterwards.

> The output artifact — report skeletons, the finding contract, excluded classes, the noise budget
> — loads on demand: `references/audit-report-template.md` (a reviewer handed bloated instructions
> silently drops part of them). Steps marked *[judgment]* need the strong model; *[mechanical]*
> ones are code at any strength (`AGENT_GUIDE.md` → "Strictness modes", the model split).

## Step 0 — scope, cadence, and the ground before the hunt

Owner-triggered or on the project's recorded cadence. Scope: the zones touched since the last
revision (git log since the last revision's record), or the whole codebase on the first run.
Record the run's scope line in the chat before starting. What is hunted is wider than bugs —
**defects · vulnerabilities · frauds · contradictions · omissions**, including the omission of
something the canon promised; what is NOT hunted is named just as explicitly (excluded classes,
reference §5), because a revision reporting everything is ignored entirely.

- **Map the ground** *[judgment]*: subsystems, boundaries, contracts, what each zone is FOR, before
  any hunting — a reviewer who does not know a boundary reports crossing it as a defect. The map
  goes into the report's methodology table, so the next run inherits it.
- **Run the code first** *[mechanical]*: linters, guards, pairs-registry commands, the greps that
  encode already-paid classes. Mechanical checks precede any LLM judgment
  (`BUG_FIXING_FRAMEWORK.md` → "A finding is not a finding until verified", point 1); their output
  is evidence, and what code can find the model must not be spent on.

## Step 1 — zone and arm the reviewers

- Cut the scope into zones by language/layer/subsystem (one reviewer per zone; parallel where the
  harness allows).
- Arm EVERY reviewer with the project's own **paid-for failure classes**: the relevant
  `EXPERIENCE.md` entries (grep by the zone's tags) and the closed `bugs/` classes. A reviewer
  hunting the classes this project already paid for finds their new faces; a generic reviewer
  finds style nits.
- Standing axes that both field audits proved fertile (add the project's own): decorative
  guardians (can this check actually STOP anything? what happens on empty input?) ·
  one-directional invariants (`BOTH-WAYS`) · truth↔mirror drift (run the pairs registry) ·
  progress marks set before the work (`AFTER-WORK`) · comments/docs describing deleted behavior ·
  happy-path process/stream wiring · test-fraud (checks green for the wrong reason).

## Step 2 — the finding contract: no quote, no finding

Every finding carries a verbatim quote (file:line + the exact text). A finding without its quote
does not exist — this single rule kept both field audits' reports checkable by script.

The full card is eight fields (reference §3); the three that decide whether a WEAKER model can
execute the fix are the repro stated as a class condition, the verification command inside the
card, and the link to a paid class. Every finding is also marked against the baseline — `new` /
`known: <id>` / `regression of <id>` — reusing the feedback loop's deduplication fingerprint and
its attestation line, never a second key minted here.

## Step 3 — the adversarial skeptic (mandatory, not optional)

Every finding goes to a SEPARATE skeptic whose job is to REFUTE it and whose default verdict is
**"not a defect"**. The skeptic reads the project's decision documents — interviews, ideas, bugs —
because that is where the truth usually is: in the field, 9 of 21 findings died here as recorded
owner decisions or already-guarded behavior, and each would have become false work. Only survivors
move forward.

## Step 4 — verify, file, fix separately

- Each surviving finding is verified by REPRODUCTION before any fix (a finding is not a finding
  until verified — `BUG_FIXING_FRAMEWORK.md`).
- Survivors become `bugs/` documents (same-class findings → ONE class doc with a full inventory)
  AND land in the run's audit reports: one document per family, plus a summary carrying the verdict
  first, the coverage map and the limits (reference §§1–2).
- Fixes are a separate pass from the revision (separate commits; every fix proves itself with an
  ADDRESSED mutation: *mutant M → exactly checks P₁…Pₙ red, and only they; intact code → 0 red*).
- Refuted findings are recorded WITH their refutation reason — otherwise the next revision "finds"
  them again.

## Step 5 — feed the loop back

- Every confirmed class appends an `EXPERIENCE.md` lesson **with its Repro line and Trigger
  point**; a class seen for the SECOND time must leave as a mechanism (linter/guard/gate), not as
  a third reminder — a finding the model raised twice is the specification for a grep guard.
- New craft gaps go into the sphere's craft recipes (the guardian skeleton, platform patterns) —
  that is the amplification: the strong model's reading becomes the weak models' recipes.
- Record the revision (date, scope, found/refuted/fixed counts) so the next run knows its
  baseline, and name what the NEXT run must change — one pass finds roughly half, and an identical
  pass finds the same half.

## What this skill refuses to do

- Ship findings without quotes, or fix anything during the reading pass.
- Skip the skeptic — unrefuted findings are half false, and false findings become false work.
- Treat "the gates are green" as a reason not to read — the gates not lying is exactly what both
  audits confirmed, and every real defect was outside them anyway.
- Report a finding a weaker model cannot act on, or claim coverage the coverage map does not show.
