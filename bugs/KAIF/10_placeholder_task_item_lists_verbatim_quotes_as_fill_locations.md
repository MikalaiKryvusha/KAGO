# KAIF improvement request: the placeholders task item lists verbatim QUOTES as fill locations, while the gate itself correctly skips them

kaif-fp: `KAIF_UPDATE_TASK.md#placeholders` (generator) vs `kaif-core.mjs checkpoint placeholders` (gate) :: instruction-wider-than-gate :: v2.4

**Delivered upstream:** not yet — this update's field report is collected by the origin for the 2.5
scope (owner's word, 2026-08-28); filing the issue itself awaits the owner's approval per the
tracking mode.

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.4 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0

**Dedup attestation:** searched `bugs/KAIF/` (tickets 01–09; `01` is the INVERSE shape — gate scope
wider than the item's list, fixed in 2.3 by teaching the gate to skip verbatim quotes) and origin
issues (`gh issue list --repo MikalaiKryvusha/KAIF --state all --limit 30` → 24 issues, none about
the task GENERATOR's location list; #3 is the 2.2 gate-side half, CLOSED). No match found.

## Gap

The 2.4 update task's `placeholders` item names, as authoritative fill locations:

> `<BUILD_COMMAND>` → EXPERIENCE.md, KAIF_FRAMEWORK.md

Both mentions are verbatim QUOTES of history, not template slots: `EXPERIENCE.md:1514` quotes the
2.2 gate refusal inside lesson EXP-0002 (*"one `<BUILD_COMMAND>` survived in
`.kaif/spheres/programming.md`"*), and `KAIF_FRAMEWORK.md:86` narrates the same incident in the
deployment record. "Filling" either would falsify recorded history — the exact fraud class the
project's own chronicle rules forbid (append-only, originals never rewritten).

The GATE already knows better: since the 2.3 fix, `checkpoint placeholders` skips quoted
placeholders and ran clean over this very tree. The generator that writes the task item does not
share that filter — so the item instructs the agent to do what the gate was just taught to stop
requiring. In 2.2 the gate was wider than the instruction (`bugs/KAIF/01`); now the instruction is
wider than the gate. The two scanners still disagree — the asymmetry only changed sides.

## Field evidence

KAGO, 2026-08-28, update 2.3 → 2.4. `KAIF_UPDATE_TASK.md` item as generated:

> **placeholders** — New templates carry deploy-time slots the machinery could not fill — fill each
> at its REAL location(s), verified on disk at generation time (canonical copies; mirrors re-sync
> at update-verify): `<BUILD_COMMAND>` → EXPERIENCE.md, KAIF_FRAMEWORK.md · `<YOUR AGENT/MODEL>` →
> .claude/skills/end-chat-soft/SKILL.md · `<YOUR AGENT'S noreply EMAIL>` → .claude/skills/end-chat-soft/SKILL.md

The end-chat-soft entries are real slots and were filled. The two `<BUILD_COMMAND>` entries were NOT
filled — and the gate agreed:

```
$ node .kaif/kaif-core.mjs checkpoint placeholders
↻ re-synced 169 system skill copies from the canon
✔ placeholder scan ran clean (executed by the checkpoint itself; mirrors re-synced first)
✔ recorded: KAIF-UPDATE: placeholders done
```

Cost: ~10 minutes of verification (re-reading both files, the 2.3 report and `bugs/KAIF/01` to
prove the mentions are quotes). **Low severity, nothing shipped wrong.** The residual risk is the
same one `01` named, mirrored: a weak session that TRUSTS the item's list would "fill" a quoted
refusal inside an experience lesson and corrupt the chronicle — and the gate would not catch it,
because the gate does not read prose semantics, only placeholder literals.

## Proposed change (smallest that closes the gap)

Make the task generator use the SAME quote-filter the 2.3 gate fix gave `checkpoint placeholders`:
a location whose placeholder occurrence the gate would skip (inline code span / quoted context)
must not enter the item's location list. One shared predicate, two callers — the 2.2 fix pattern,
applied one layer up.

## Expected effect and its check

An update task's `placeholders` item lists only locations the gate would actually refuse on. Check:
generate the task on a tree whose only `<BUILD_COMMAND>` mentions are quoted → the item lists only
the genuinely unfilled slots (or is absent).

Invariant served: **one fact, one scanner** — the instruction and its gate must judge by the same
rule, or the task file teaches sessions to distrust its other lists.

## Local remediation

None needed on disk: the quotes stayed verbatim, the real slots (`.claude/skills/end-chat-soft/SKILL.md`
agent/e-mail) were filled, the checkpoint passed. The divergence is zero.
