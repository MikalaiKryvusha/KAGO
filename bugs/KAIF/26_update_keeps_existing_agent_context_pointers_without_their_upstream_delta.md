# KAIF bug: the update «keeps existing» the per-agent context pointers (`.clinerules/kaif.md`, `CLAUDE.md`, `AGENTS.md` …) and names none of their upstream changes — here `.clinerules/kaif.md` silently lacked the 2.7 `resume` rule

kaif-fp: .kaif/kaif-core.mjs install-as-update context pointers :: kept-file-upstream-delta-dropped-silently :: v2.8
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/120
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF 2.8 · project KAGO · sphere programming · language ru ·
tracking origin · agent system claude-code (Claude Opus 5.5) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "clinerules\|context pointer" bugs/KAIF/` → none) and origin issues
(`gh issue list --repo MikalaiKryvusha/KAIF --state all --search "clinerules"` → field reports #76 #79 #93 #48, none about this).
Nearest class: #72 (a dropped upstream delta, answered by 2.8 epic UP). No match found.

## Expected per canon

2.8 release page, item 6, verbatim: «The update loses nothing silently.»

## Got in the field

The same 2.8 bootstrap over the same commit, verbatim from the two logs: sandbox (a `git archive` export, git-ignored files absent)
`+ wrote .roo/rules/kaif.md` · `+ wrote .clinerules/kaif.md`; live `= kept existing .roo/rules/kaif.md` · `= kept existing
.clinerules/kaif.md`, also `= kept existing CLAUDE.md` · `= kept existing AGENTS.md` in both. The update task has no item for any of
them. After the pass, `diff` live vs the fresh sandbox output of `.clinerules/kaif.md` (both git-ignored in KAGO):

```
3a4,5
>
> A message that opens with the word `resume` (or the /resume alias of your language) is an ORDER to run /resume in full before the rest of the message (`AGENT_GUIDE.md` → "A leading skill word is an order").
```

— the rule 2.7 added. KAGO's 2.7 report records that `CLAUDE.md` and `AGENTS.md` received it BY HAND; nothing pointed at the
Cline copy, so a Cline session in this project has not had the rule since 2026-09-18.

## Repro (deterministic)

1. Deploy KAIF ≤ 2.6 with `--agents …,cline`; 2. update to ≥ 2.7 (either route); 3. `grep -c "A message that opens with the word"
.clinerules/kaif.md` → 0, while a fresh install of the same version → 1; the update task names no pointer file.

## Cost and violated invariant

**cold-start / universality**: an agent system other than the one that ran the update keeps the previous version's entry rules;
nothing reds, and the canon's multi-agent promise degrades per interval.

## What in KAIF led to this

Context pointers are treated as owner-seeded («kept existing») with no install snapshot and no delta rendering, so the classifier
has nothing to diff. Smallest fix: snapshot them like other shipped files (replace when untouched), or list «pointer X carries
upstream text Y you lack» in the update task; `update-verify` could check each promised pointer line on disk.

## Local remediation (per the "defect in KAIF itself" contour, if applied)

KAGO's `.clinerules/kaif.md` replaced with the fresh 2.8 install output (`diff` empty after); `.roo/rules/kaif.md` already equal.
