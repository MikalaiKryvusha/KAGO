# KAIF bug: `kaif-attribution-lint` reads git-ignored root `*.md` from disk and `--write-baseline` copies their lines into the baseline the closing ritual tells you to commit

kaif-fp: .kaif/tools/kaif-attribution-lint.mjs root *.md scope :: git-ignored-file-scanned-and-copied-into-committed-artifact :: v2.8
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/111
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF 2.8 · project KAGO · sphere programming · language ru ·
tracking origin · agent system claude-code (Claude Opus 5.5) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "attribution" bugs/KAIF/` → only `20_*`, about the budget gate) and origin
issues (`gh issue list --repo MikalaiKryvusha/KAIF --state all --search "attribution baseline"` / `"attribution-lint"` /
`"gitignored private"` → none on this surface). Nearest: #77 (CLOSED — `stale-claims` walked git-ignored nested checkouts),
which 2.8 answered with ONE git-aware walker; this is the same class escaping on another surface. No match found.
**Found:** 2026-09-26, the KAIF 2.7 → 2.8 update of KAGO (closing-gates item, then `--write-baseline`).

## Expected per canon

2.8 release page, item 7, verbatim: «The core and the six tool modules that walk the file tree read the files that `git ls-files`
lists». `/end-chat-soft` (2.8), verbatim: «record that debt ONCE — `node .kaif/tools/kaif-attribution-lint.mjs check --write-baseline`
writes `.kaif/attribution-lint.baseline.json`; commit it». A git-ignored file is outside the project as git sees it, and nothing
of it should reach a committed file.

## Got in the field

`kaif-attribution-lint.mjs:308`: `for (const n of readdirSync(root)) if (/\.md$/i.test(n) && !TRANSIENTS.has(n)) {` — the root
`*.md` of the default scope come from the DISK, not from `git ls-files`. Evidence it bites: the same tree scanned in a sandbox
export (`git archive`, so no ignored files) and live gave `93 NEW finding(s) in 392 file(s)` vs `… in 393 file(s)` (the update task's
`closing-gates` line, sandbox vs live); `git ls-files --cached --others --exclude-standard | wc -l` was 953 in both, and the one
extra file is the git-ignored `AUTHOR_STYLOMETRY.md` — the owner's PRIVATE voice portrait, git-ignored because it quotes his
personal writing in a public repository. It carries no finding today, so nothing leaked here. The baseline format stores the
line text: `"PROJECT_HISTORY.md:45df345a48f37a0d": "PROJECT_HISTORY.md:363 the project root: the **full private core**, pulled in …"`.

## Repro (deterministic)

1. In an empty directory: `git init`; `.gitignore` = `PRIVATE.md`; `PRIVATE.md` = `# Notes` / `` / `The owner decided to keep the secret recipe of his grandmother in this file.`; `README.md` = `# Public`.
2. `node <kaif>/.kaif/tools/kaif-attribution-lint.mjs check --write-baseline --baseline out.json`
3. Got (verbatim): `baseline written: out.json — 1 finding(s) recorded as debt …` and in `out.json`:
   `"PRIVATE.md:ca9a68192423980a": "PRIVATE.md:3 The owner decided to keep the secret recipe of his grandmother in this file."`
   while `git check-ignore PRIVATE.md` → `PRIVATE.md`.

## Cost and violated invariant

Near-miss, invariant **owner-work-safety** (privacy) and **universality**: the closing ritual orders `--write-baseline` + commit, so
the first unquoted «the owner decided …» line in any git-ignored root note (a private portrait, a local secrets memo) lands, as
text, in a committed file of a possibly public repository. Secondary: scan counts differ between a sandbox rehearsal and the live
tree, so the rehearsal's number cannot be compared byte for byte.

## What in KAIF led to this

The 2.8 walker unification (`kaifWalk`, git-aware) covers the seven directories, but the root `*.md` loop enumerates with
`readdirSync` and only then hands each name to `kaifWalk([file])` — a file root is «taken when it is a file», with no
`--exclude-standard` filter. Smallest fix: take the root `*.md` from the same `git ls-files --cached --others --exclude-standard`
list (without git: the current behaviour), and never store the line TEXT of a finding in a file meant to be committed (the key
hash suffices; the text can be re-read from the file).

## Local remediation (per the "defect in KAIF itself" contour, if applied)

None in code. KAGO's portrait has 0 findings today (`check AUTHOR_STYLOMETRY.md` → `new 0`) and the baseline holds no line of
it (`grep -c AUTHOR_STYLOMETRY .kaif/attribution-lint.baseline.json` → 0). Correction, 2026-09-26: the first edition said «the
committed baseline» — at filing time the file was still untracked; it is committed with the update's commit.
