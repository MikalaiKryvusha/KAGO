---
description: Snapshot this project's evolved KAIF into the user's own GitHub repository and switch version tracking to that fork — so the user develops and versions their own evolution of KAIF independently of the origin. Use when the human says "fork KAIF", "make my own KAIF", "snapshot the framework to my repo", "track my own KAIF", "сделай свой слепок KAIF", "форкни фреймворк под себя". Trigger aliases (ru): «форкни KAIF под себя», «сделай свой слепок KAIF»
---

# /kaif-fork — snapshot KAIF into the user's own repo & track it

> ⚙️ **Staleness warning:** this is a lifecycle procedure, and an adopted local copy of it goes stale
> silently across releases. Before following it, verify the procedure against the CURRENT origin
> release notes — the machinery and the release page win over this file's prose.

After living in a project, KAIF often evolves far from origin — locally improved, adapted, extended. At
some point the user wants to **own that evolution**: keep developing and versioning *their* KAIF in
*their* repo, no longer bound to the origin's release cadence. This skill does that in one move.

## Procedure

> The load-bearing fact (Reference §15): **a fork IS an origin only when it publishes a RELEASE**
> carrying the three machinery artifacts. `update` fetches from `releases/latest/download` — a
> repository without a release answers 404, and the fork's update path is dead on arrival.
> (Field-caught: the old procedure skipped the release step and every fork it produced was an
> unworkable origin.)

1. **Gather the current KAIF.** Everything that constitutes the deployed framework in this project
   (guidance docs, `.claude/skills/` or the agent's equivalent, `.kaif/` machinery and manifests) —
   **not** the user's project files and **not** the content artifacts (those stay in the project).
   The transient `KAIF.md` does NOT exist in a deployed project — the fork's copy of the three
   machinery artifacts comes from the CURRENT origin release (`gh release download` from the
   tracked origin), or is rebuilt from a checkout of the origin's build tooling.

2. **Create the user's KAIF repo.** With the human's confirmation: `gh repo create
   <user>/<their-kaif-name> --public`. Put the snapshot there as a self-contained KAIF (docs,
   skills, tools, README, LICENSE, attribution). This repository becomes the user's origin —
   pending step 3, which is what makes it real.

3. **Publish the fork's first release — this step is NOT optional.** Attach the three machinery
   artifacts: `kaif-manifest.json` (bump its `version`; this file — not any `version.json` — is
   where the release side's version lives), `KAIF-CORE.mjs`, `KAIF-CORE-BUNDLE.md` (with sha256
   pins in the manifest recomputed for the fork's bundle). Then **verify by observation**:
   ```
   node .kaif/kaif-core.mjs update --source https://github.com/<user>/<repo>/releases/latest/download
   ```
   shall answer with a version or "already up to date" — never 404. A fork that fails this check
   is not an origin yet.

4. **Switch tracking.** Update `.kaif/kaif.json` in the project: set `origin` to the fork and
   `tracking: "fork"`. From now on `/kaif-version` and `/kaif-update` follow the user's fork.

5. **Report & commit.** Tell the human the fork URL, show the step-3 verification output, and
   commit the `.kaif/kaif.json` change in the project.

## Notes
- This is a branching of lineage: the user's KAIF may diverge from and even surpass the origin.
- To return to the official origin later, use `/kaif-switch-origin` (with a respectful migration).
- Respect attribution: a fork still carries the MIT license and credits KAIF's origin author; the user
  adds themselves as the fork's maintainer.
- Candidate mechanization (backlog): a `fork-bundle` core command assembling the three artifacts
  from the deployed tree.
