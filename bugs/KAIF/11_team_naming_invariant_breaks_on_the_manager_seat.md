# KAIF improvement request: the team naming invariant «address = directory = branch» is stated as universal and immediately broken by the manager seat

kaif-fp: `team-deployment/references/team-constitution-template.md#1` :: invariant-contradicts-own-example :: v2.4

**Delivered upstream:** not yet — rides the team-deployment field report collected by the origin
for the 2.5 scope (owner's word, 2026-08-28); filing an issue awaits the owner's approval per
tracking mode.

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.4 · project KAGO · sphere `programming` ·
language `ru` · tracking `origin` · agent claude-code (+4 mirrored) · Windows 11 Pro 10.0.26200 ·
Node v24.15.0

**Dedup attestation:** `bugs/KAIF/` 01–10 — none touch the team skill (new in 2.4);
`gh issue list --repo MikalaiKryvusha/KAIF --state all --limit 30` → 24 issues, none about
/team-deployment. No match.

## Gap

Constitution template §1 declares, in bold, the naming invariant:

> Naming invariant: **session address = directory name = branch name = `<project>-team-<role>`**.
> … A session learns its OWN role from its working directory — a role is where you are, not what
> you claim.

Three lines later its own reference table breaks all three equalities for the manager:

> | Manager | `<project>-team-manager` | `<main copy path>` | `main` | … |

For the manager: address `<project>-team-manager` ≠ directory `<project>` ≠ branch `main`. The
exception is real and correct (the manager owns the main copy — a worktree for him would be
wrong), but it is NOWHERE stated as an exception. Any tool built to the invariant as written
must special-case the main copy on its own authority: the KAGO board tool derives
`<project>` → `manager` (`tools/team-board.mjs::deriveRole`), and a weaker session could just as
honestly derive `<project>` → "not a team directory, refuse" — locking the manager out of his
own board — or demand a `KAGO-team-manager` worktree, splitting the manager from the main copy.

## Field evidence

KAGO deployment, 2026-08-28. The board tool contract says "the caller's role is DERIVED from the
working directory (workspace naming invariant, constitution § 1)". Implementing exactly that
required a rule the invariant does not contain:

```js
export function deriveRole(dirName) {
  if (dirName === PROJECT) return 'manager';   // <- invented locally: the §1 invariant never says this
  const m = dirName.match(new RegExp(`^${PROJECT}-team-([a-z-]+)$`));
  ...
```

Cost: minutes here (the template's own table hints at the answer), but the invariant's text and
its example disagree — the exact drift-pair class the framework's own registry rule exists for.

## Proposed change (smallest that closes the gap)

Add one sentence to §1 after the invariant: *"Exception — the manager: his seat IS the main copy
(directory `<project>`, branch `main`); only his session ADDRESS carries the `<project>-team-manager`
form. Tools deriving roles from directories treat the main copy as the manager."*

## Expected effect and its check

A tool written strictly to §1 needs no invented rules. Check: the section names both the rule and
its single exception; a fresh reader can write `deriveRole` without consulting the example table.

Invariant served: **a stated invariant must be executable as stated** — weak sessions follow the
letter, and the letter currently locks the manager out.

## Local remediation

`tools/team-board.mjs` and `tools/team-workplace.mjs` special-case the main copy as the manager;
KAGO's `TEAM_CONSTITUTION.md` §1 keeps the upstream wording (reconciles trivially at the next
update once upstream fixes the sentence).
