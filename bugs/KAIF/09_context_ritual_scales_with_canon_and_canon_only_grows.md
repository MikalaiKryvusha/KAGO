# KAIF improvement request: the context ritual scales O(canon) while the canon only grows — sessions start context-starved, and past a threshold the corpus can no longer be kept consistent by the sessions it instructs

kaif-fp: `/resume` full pass + context-refresh hourly re-read + canon size :: ritual-cost-unbounded :: v2.3

**Delivered upstream:** NOT YET — awaiting the owner's word (outward action).

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.3 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0

**Dedup attestation:** searched `bugs/KAIF/` (01–06 — different surfaces) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state all --limit 40`, 2026-08-28 → 24 issues; none
concerns ritual cost or canon growth; #22 concerns rule FORM). No match found.

## Gap

Three mechanisms multiply each other, and none has a brake:

1. **The ritual is O(canon):** `/resume` demands the FULL canon pass; the context-refresh rule
   re-reads the core hourly; the prayer is recited verbatim in chat before every task.
2. **The canon only grows:** every incident may add a rule, a fact, a section; nothing ever
   collapses or archives by rule. Size targets exist as advice (STATUS «~200 lines») with no
   carrier, and are exceeded 6×.
3. **The loop is positive:** a violated rule → a new rule → a longer canon → worse in-context
   retention → the next violation. The framework's own documented drift incidents (language
   register, EXP-0006/0023) are this loop observed.

Past a threshold the corpus exceeds what any session can hold, and the «two truths» class appears:
the state documents disagree with the repository because maintaining their agreement costs more than
the sessions can pay.

## Field evidence (KAGO, day 19)

- Re-read core: **5.8k lines** per pass, hourly; full key-document set 12.1k lines; whole-repo
  markdown **83,598 lines** across 475 files (vs 50,252 lines of code).
- `STATUS.md` 1,322 lines against its own 200-line target, the debt acknowledged inside the file;
  `GOAL.md` 1,514 lines of verbatim transcript with cancellation layers (including a trap
  documented in-file: «do not confuse the two different numbers 885»).
- The prayer: 35 lines × 8 files, mechanically synced (`tools/prayer.mjs`), recited before every
  task, with its own 6-block selftest.
- The «two truths» class recurred within a week of being filed: `bugs/25` (headers vs repository),
  then epic 42's header still claiming «awaits the owner's answers» four days after the owner
  answered (interview 014, closed 2026-08-24 22:54).
- This audit session itself could not read three canon documents in one tool pass — they exceed the
  reader's own limits.
- Sessions spent dominantly on document metabolism (haircuts with border-guard scripts, backlog
  re-tagging, canon sync): 8 of 54.

## Proposed change

1. **Size budgets with a carrier:** the build/check gate WARNS (advisory) when a canon document
   exceeds its stated budget; every canon document states one.
2. **Digest/archive split as a framework pattern:** an operative digest (current definitions only,
   owner-approved, ~150 lines) over a verbatim append-only archive — for GOAL-class documents.
   Nothing is ever deleted; the OPERATIVE surface is what sessions re-read.
3. **A generated context pack:** `/resume` reads a script-assembled pack (relay + open bugs +
   delivery line + operative digest) instead of the full corpus; full documents on demand via the
   existing context router.
4. **Collapse rules:** a lesson mechanized into a guard → one line + pointer; a closed fork's
   superseded formulations → archive, not strikethrough-in-place.
5. **Ritual cadence as an owner setting** (e.g., the prayer: full text once per session vs before
   every task) rather than a fixed maximal default.

## Local remediation

KAGO puts the split, the budgets and the cadence to the owner as forks Q2/Q3 of
`interviews/interview_017_five_method_forks.md`; the method audit
(`reports/KAIF_AUDIT/2026-08-28_audit_03_method.md` §6, rule Р3) carries the local plan.
