# KAIF bug: `/experience` (2.8) still sends a dangerous-action lesson to «the tool registry (`AGENT_GUIDE.md` → Tools)» — the table 2.8 moved to `HOUSE_RULES.md`

kaif-fp: .claude/skills/experience/SKILL.md step 1 :: pointer-into-a-moved-module :: v2.8
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/119
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF 2.8 · project KAGO · sphere programming · language ru ·
tracking origin · agent system claude-code (Claude Opus 5.5) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "experience" bugs/KAIF/` → no ticket on this skill line) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state all --search "experience skill registry Tools"` → #108, #71, #72, #83, none
about this line). No match found. Found by the clean-context judge of KAGO's 2.8 update.

## Expected per canon

2.8, `AGENT_GUIDE.md` → "Tools" (the template, verbatim): «The project's automation tools (build, commit, release, codegen,
graphics…) are one table in the house-rules file — `HOUSE_RULES.md` → "Tools of this project"; when you add or extend a tool, add
its row there the same day.»

## Got in the field

The same release's `/experience`, step 1 (`.claude/skills/experience/SKILL.md:30-33`, byte-identical to the 2.8 bundle): «A lesson
about a dangerous ACTION … also lives IN THE ROW OF THAT ACTION in the project's tool registry (`AGENT_GUIDE.md` → Tools) — where
sessions look when they RUN it». On a 2.8 deployment that section holds three lines and no rows; the rows are in `HOUSE_RULES.md` §6.

**Second instance, the same class (added 2026-09-26, found by the author's own ripgrep sweep right after the second judge pass —
corrected 2026-09-26: the first wording credited that judge pass, which never mentioned it):** `BUG_FIXING_FRAMEWORK.md` → «Grow the
harness over time», in the 2.8 template itself (`diff --source <v2.8 assets> --render BUG_FIXING_FRAMEWORK.md`, line 130): «Then
add it, and document it in `AGENT_GUIDE.md`. The harness is a living tool — extend and document it.» — 2.8's guide sends each
harness command to `HOUSE_RULES.md` → «Stands, environments and devices».

## Repro (deterministic)

`grep -n "AGENT_GUIDE.md\` → Tools" .claude/skills/experience/SKILL.md` on any fresh 2.8 install → line 32; `grep -c "^|" ` over
the "## Tools" section of the installed `AGENT_GUIDE.md` → 0.

## Cost and violated invariant

**cold-start / memory**: the lesson about a destructive command is written where no session looks when it RUNS the command — the
exact placement the step exists to guarantee. Low cost per event, silent.

## What in KAIF led to this

Epic CK moved the project-fact modules out of the guide and updated the guide, the house-rules skeleton, `/refresh-context` and
`/fix-vision`, but not this pointer. Fix: `HOUSE_RULES.md` → "Tools of this project" (and a build-time grep for skill pointers into
the moved headings).

## Local remediation (per the "defect in KAIF itself" contour, if applied)

None: the skill is a shipped file (a local edit would make it diverge from the template). KAGO's tools table is in `HOUSE_RULES.md` §6.
