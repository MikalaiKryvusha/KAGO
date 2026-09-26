# KAIF bug: the shipped contour writes its renders into `.kaif/.contour-tmp/`, which the ignore-first set does not cover — a sweeping commit ships them

kaif-fp: .kaif/kaif-core.mjs ignore-first set :: tool-output-dir-not-ignored :: v2.8
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/126
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF 2.8 · project KAGO · sphere programming · language ru ·
tracking origin · agent system claude-code (Claude Opus 5.5) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "contour-tmp" bugs/KAIF/` → none) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state all --search "contour-tmp"` → #66, #122, #8, #27, #28 — none about the render
directory). No match found.
**Found:** 2026-09-26, KAGO's first use of the shipped contour after the 2.8 update (`plans/104`).

## Expected per canon

`AGENT_GUIDE.md` → Git workflow, verbatim: «**Ignore first, then the tool.** Any new tool, export, dump, key, or binary enters the
project ONLY after its `.gitignore` line exists.» The core writes such lines itself for its own runtime state — the ignore-first set
at `.kaif/kaif-core.mjs:463-475` holds `.kaif/contour-window/` (the owner page's browser profile), `.kaif/refresh-marker.json`,
`.kaif/voice-marker.json`, `.kaif/update-rehearsal.json` and others.

## Got in the field

`node .kaif/tools/contour/review.mjs <doc.md> --no-serve` (the pre-flight render) printed `Render written:
…\.kaif\.contour-tmp\interview_032_….html`; the next `git add -A` + commit carried it:

```
A  .kaif/.contour-tmp/interview_032_the_new_question_page_is_it_readable_and_shall_the_old_one_go.html
```

`grep -n "contour-tmp" .gitignore .kaif/kaif-core.mjs` → nothing; the directory is defined only in
`.kaif/tools/contour/core.mjs:720` (`export const TMP_DIR = '.kaif/.contour-tmp';`).

## Repro (deterministic)

1. A KAIF 2.8 deployment, clean tree. 2. `node .kaif/tools/contour/review.mjs <any interview.md> --no-serve`.
3. `git status --short` → `?? .kaif/.contour-tmp/` — not ignored.

## Cost and violated invariant

**honest history / owner-work-safety**: a render of an owner-facing page (his questions, sometimes his answers once saved) rides into
the history of a possibly public repository by an ordinary sweeping commit; the canon names exactly this («a NEW file in the tree
stops a sweeping commit»), and the machinery that writes the file does not ignore it.

## What in KAIF led to this

The ignore-first set is a hand-kept list in the core; the contour's `TMP_DIR` was added (or moved) without its line. Smallest fix: add
`.kaif/.contour-tmp/` to the set; a build-time check that every directory a shipped tool writes under `.kaif/` is in the set.

## Local remediation (per the "defect in KAIF itself" contour, if applied)

KAGO: `.kaif/.contour-tmp/` added to `.gitignore`, the committed render removed from the index (`git rm --cached`) in the next commit.
