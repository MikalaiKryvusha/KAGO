# KAIF improvement request: the adaptation task never installs the owner's voice portrait

kaif-fp: `KAIF_ADAPTATION_TASK.md` (item set) + `AGENT_GUIDE.md#checklist-step-19` :: obligation-exists-but-no-deploy-step :: v2.2

**Autocapture** (from `.kaif/kaif.json`): KAIF 2.2 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0

**Dedup attestation:** searched `bugs/KAIF/` (`ls bugs/KAIF/` → only `01_placeholder_gate_scans_sphere_library.md`,
a different surface) and origin issues (`gh issue list --repo MikalaiKryvusha/KAIF --state all --limit 10`
→ 2 issues, both CLOSED: #1 anonymous-install mode, #2 interactive-contour field notes). No match found.

## Gap

The adaptation task ships **nine** items — `study`, `project-name`, `placeholders`, `maps`,
`goal-plan`, `sphere`, `kaif-framework`, `field-report`, `verify`. **None of them installs the
owner's voice portrait**, and none asks whether the owner has one.

The framework clearly *wants* the portrait present. `AGENT_GUIDE.md` checklist step 19:

> Writing into the owner's artifact?   # text the human signs or reads as their own (docs, paper, site
> copy) → open the owner's voice portrait `AUTHOR_STYLOMETRY.md` when the project has one
> (/owner-voice) and run its checklist before handover

and the context router carries a whole row for it:

> | Writing into the owner's artifact (text the human signs or reads as their own) | `AUTHOR_STYLOMETRY.md` — the owner's voice portrait, when the project has one (`/owner-voice`) · the artifact's styleguide |

Both are **reactive** and both are hedged with *"when the project has one"*. Nothing in the
deployment ever makes the project have one. So the obligation fires for the first time at the moment
the agent is already writing the owner's text — which, in a fresh deployment, is the README, written
during the same adaptation pass.

That is exactly what happened here, and the ordering is the point: **the README of this project was
written before its author's voice portrait was installed.**

## Field evidence

KAGO, 2026-08-09, deploying KAIF 2.2 into a fresh project.

The agent worked all nine adaptation items, wrote a bilingual README, and never installed the
portrait — because no item told it to and the portrait was hedged as optional. The owner had to
intervene twice in the chat, verbatim:

> «мой стилометрический портрет уже готов, и забрать его можно из
> https://github.com/MikalaiKryvusha/krinik-stylometry»

and, when the agent still only *referenced* it rather than installing it:

> «и стилометрию НУЖНО установить, это моя прямая команда»

The owner's own diagnosis of the cause, verbatim:

> «Это должно было быть выполнено по успеху установки KAIF, а ты не выполнил. Значит тебя не
> достаточно ясно проинструктировали»

**Cost:** the project's storefront was drafted without the owner's voice available, and the owner
spent two turns correcting a step the framework should have driven. Blameless framing: the agent
followed the item list exactly; the item list is what is missing a line.

## Proposed change (smallest that closes the gap)

Add a **tenth adaptation item**, between `kaif-framework` and `field-report`:

> - **owner-voice** — Ask the owner whether a voice portrait exists (`AUTHOR_STYLOMETRY.md`, skill
>   `/owner-voice`). If yes: install it at the project root and, when the repository is public,
>   add it to `.gitignore` in the same step — the portrait may quote the owner's private writing.
>   If no: record in `AGENT_GUIDE.md` that the project has none, so a future session does not
>   re-ask. Either way this closes BEFORE any owner-facing text is written.
>   When done, run: `node .kaif/kaif-core.mjs checkpoint owner-voice`

Two details matter and are cheap to include:

1. **The item must come before the README exists.** A portrait installed after the storefront is
   written has already missed its only deadline of the deployment.
2. **The ignore decision belongs to the same step** ("ignore first, then the tool" is already
   canon). A public project that installs a quote-bearing portrait without an ignore line publishes
   the owner's private writing, and the agent will not notice — the file looks like framework canon.

## Expected effect and its check

A deployment either has the portrait on disk with the right ignore status, or has a recorded "this
owner has no portrait", before the adaptation pass writes a single owner-facing sentence.

Check, runnable at the end of any install:
`test -f AUTHOR_STYLOMETRY.md || grep -q "no voice portrait" AGENT_GUIDE.md` — and, when the
portrait exists in a public repository, `git check-ignore -q AUTHOR_STYLOMETRY.md`.

Invariant served: **owner-work-safety** (the owner's text comes out in the owner's voice, and the
owner's private writing does not ship) and **cold-start** (a future session finds the portrait
instead of re-discovering that it exists).

## Local remediation

Installed on the owner's direct instruction: the **full private core** was copied from the owner's
voice store to the project root and added to `.gitignore` (the repository is public), with the
refresh command recorded in `AGENT_GUIDE.md` → "Notes from the human". Not mutation-proved — the
proof is the owner's intervention, which is what the missing item would have prevented.
