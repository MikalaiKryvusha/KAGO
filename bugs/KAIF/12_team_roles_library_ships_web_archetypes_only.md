# KAIF improvement request: the team roles library ships web-product archetypes only — a hardware-lab project has no nearest archetype to pick

kaif-fp: `team-deployment/references/team-roles-library.md#team-archetypes` :: archetype-coverage-gap :: v2.4

**Delivered upstream:** not yet — rides the team-deployment field report collected by the origin
for the 2.5 scope (owner's word, 2026-08-28); filing an issue awaits the owner's approval per
tracking mode.

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.4 · project KAGO · sphere `programming` ·
language `ru` · tracking `origin` · agent claude-code (+4 mirrored) · Windows 11 Pro 10.0.26200 ·
Node v24.15.0

**Dedup attestation:** `bugs/KAIF/` 01–11 — no ticket on the roles library;
`gh issue list --repo MikalaiKryvusha/KAIF --state all --limit 30` → none about archetypes.
No match.

## Gap

Operation 2 of the skill instructs: *"Pick the nearest archetype from
`references/team-roles-library.md` (web-product-small · web-product-medium) and adapt."* The
library carries exactly those two, both assuming a web product: the designer's activation
condition is UI complexity, the engineers' split is "by feature boundary", and no archetype knows
the axis that DOMINATES a measurement/hardware project: **a physical singleton under test that
serializes the core work and may require a human at the machine.**

KAGO is such a project (one GPU, the subject under test; edge runs only with the owner present —
its интервью 017 Q4). "Nearest archetype" had real distance: the deciding design questions —
who may touch the device, how device access maps to a board lock, whether the verifier may
re-run device claims — have no home in either archetype and were answered from the project's own
canon (a §0 card rule was added to the constitution above all nine sections, and the
`gpu-card` lock got a manager-only refusal in the board tool).

## Field evidence

KAGO deployment, 2026-08-28 (plans/54). What the adaptation had to invent beyond both archetypes:

1. A **§0 device rule** above the nine invariant sections: only the manager's seat writes to the
   card, only under the `gpu-card` board lock, edge runs only with the owner present.
2. A lock class the templates don't mention: the singleton IS the product under test, so the
   verifier verifies device claims from journals (`runs/`), never by re-touching the device —
   an independence-vs-singleton tension neither archetype names.
3. The engineer's zone had to be defined negatively ("OFFLINE machinery only; a task that seems
   to need the card goes back to the manager") — no archetype models a seat forbidden from the
   project's central resource.

Cost: the design still landed (the role CONTRACTS generalized fine — the gap is only in the
archetype layer), but every device question was answered without library support, which is
exactly what the library exists to prevent.

## Proposed change (smallest that closes the gap)

Add one archetype: **`hardware-lab-small`** (2–3 seats): manager (folds architect; the ONLY seat
with device-write authority, human-present rule inherited from the project's canon where one
exists) · engineer ×0–1 (device-free work streams only; activation condition: device-free
backlog exceeding the manager's pace) · qa-verifier (verdicts from recorded observations —
journals, fixtures; never re-touches the device). Plus one sentence in the archetype preamble:
*"a physical singleton under test is a first-class sizing axis: it serializes core work and can
demand a human present — name its lock and its one authorized seat in §7/§0 of the
constitution."*

## Expected effect and its check

A measurement/hardware project picks an archetype instead of bending a web one. Check: the KAGO
design (plans/54) maps onto `hardware-lab-small` with zero invented rules.

Invariant served: **evidence before scale** — the archetype layer should carry the field lessons
for the project classes the framework is actually deployed on (KAIF's own flagship deployments
include a GPU lab).

## Local remediation

None needed: KAGO's constitution §0, the `gpu-card` manager-only lock, and the negative
engineer zone cover the gap locally; they are this ticket's donor material.
