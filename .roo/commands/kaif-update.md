---
description: Respectfully update & migrate the KAIF framework deployed in this project to a newer version from the origin repository, preserving local customizations and all content artifacts. Use when the human accepts an update offer, or says "update KAIF", "migrate to the new framework version", "respectful update", "обнови KAIF", "проведи миграцию фреймворка". Trigger aliases (ru): «обнови KAIF», «проведи миграцию фреймворка»
---

# /kaif-update — respectful migration update from origin

> ⚙️ **The current mechanical command comes FIRST:** `npm run kaif:update`
> (`node .kaif/kaif-core.mjs update`). If this file's prose disagrees with the machinery, trust the
> machinery and the origin release notes: an ADOPTED local copy of this skill freezes at an older
> version's procedure and silently leads the updater off the mechanical path (field-caught — it cost
> a project a full manual migration and stale snapshots; lifecycle skills are exactly the class of
> file whose staleness breaks the update itself).

A newer KAIF version exists upstream (see `/kaif-version`). Since KAIF 1.5 the heavy lifting is
**mechanical**: the machinery (`.kaif/kaif-core.mjs`) knows what was deployed and which files were never
touched since (content snapshots in `.kaif/deploy-manifest.json`), so it replaces the untouched framework
files itself, adds the new ones, never enters owner content (`GOAL.md`, `STATUS.md`, the knowledge
directories, your project files), and hands you a short `KAIF_UPDATE_TASK.md` covering ONLY the genuinely
diverged places. Your cognitive work is that task, not the migration.

> ⚠️ This changes the framework wrapper. Confirm with the human before applying. Commit first so the
> update is a clean, revertable diff.

## Procedure

1. **Pre-flight.** Working tree clean (commit/stash first). Read `.kaif/kaif.json`: if `tracking` is
   `fork`, confirm the human really wants to pull from the official origin.

2. **Predict the pass BEFORE touching the tree** (both moves are cheap; the field proved both).
   Route note: `update` runs the interval with your CURRENTLY DEPLOYED core (the fresh one is
   swapped in at the end) — so the NEW version's update-time guarantees (pre-update backup
   tree, new task scopes) apply to the NEXT interval. To get them on THIS pass, update by the
   thin-`KAIF.md` bootstrap route instead: the fresh core classifies against your surviving
   deploy manifest and the pass is equally mechanical.
   - `node .kaif/kaif-core.mjs diff --source <url|dir>` — a per-module preview of what the new
     version would change *here*. Works even on a v1 manifest: the machinery builds a synthetic
     baseline of your CURRENT version (`--baseline <dir|url>` points it at saved artifacts when
     the origin release is unreachable).
   - The **sandbox copy** — not a model of the pass but the pass itself: export the tree
     (`git archive HEAD | tar -x -C <tmpdir>`), `git init` there, run the REAL update/bootstrap in
     the copy and read its diff. A minute and a few MB buy a byte-accurate preview — in the field
     the live pass matched the sandbox byte for byte. Prefer this on the first-ever update and on
     any deployment with heavy localization.

3. **Route by what the project has:**
   - **`.kaif/kaif-core.mjs` exists (KAIF ≥ 1.5):** run `node .kaif/kaif-core.mjs update`
     (or `npm run kaif:update`). It fetches the latest machinery from origin (sha256-verified),
     replaces every framework file that is byte-identical to its install snapshot, adds new files,
     keeps diverged ones untouched, swaps the machinery itself, stamps `.kaif/kaif.json`, and writes
     `KAIF_UPDATE_TASK.md`.
   - **No machinery (KAIF ≤ 1.4, or an anonymous install):** put the fresh **thin `KAIF.md`** from the
     origin release in the project root and follow its bootstrap (three `KAIF-BOOT:` steps). The
     installer detects the existing older `.kaif/kaif.json` and runs as an update: existing files are
     KEPT, new entities added, owner-level fields of the marker preserved, and `KAIF_UPDATE_TASK.md`
     replaces the usual adaptation task.

4. **Work `KAIF_UPDATE_TASK.md`** — the only cognitive part: merge the template news into the files the
   machinery could not touch (they carry your local edits), review what's new, run
   `node .kaif/kaif-core.mjs check`, and finish with a `/fable-judge` pass over the update. Tick each
   item AND append its `KAIF-UPDATE: <id> done` checkpoint.

5. **Field report — MANDATORY** (the framework's feedback loop; written even when the update went
   smoothly — deviations lead it, smooth is one line in the finale): the task's `field-report` item
   gives the skeleton — `reports/KAIF_UPDATES/<PROJECT>_KAIF_<to>_UPDATE_REPORT.md`, strictly EN,
   every number a command's output, every rake with verbatim evidence, the judge verdict quoted
   verbatim in the final section (decision #46). Its checkpoint EXECUTES the file check — the update
   does not verify green without the report. A rake that is an explicit framework defect/improvement
   also gets its own ticket: skill `/report-bug`, templates A/B (delivery upstream follows the
   deployment's tracking mode — an anonymous deployment never reaches for the origin).

6. **Verify & self-clean:** `node .kaif/kaif-core.mjs update-verify` — it greps the checkpoints and
   removes the transient installer files.

7. **Report & commit.** Summarize in the chat: replaced/added/kept counts, what you merged by hand,
   anything left for the human (the durable record is the field report from step 5). Commit
   `chore: update KAIF to X.Y`.

## Notes
- The guiding word is **respectful**: the project must stay whole and working at every step; owner
  content is never in the update's scope at all.
- If the migration is large or risky, do it behind a clean commit so it's easy to revert.
- A heavily diverged project may be better served by a fork (`/kaif-fork`) than by tracking origin.
