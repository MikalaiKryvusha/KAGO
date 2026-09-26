# KAIF bug: `kaif-attribution-lint check <path> --write-baseline` erases every baselined finding outside <path> — and the path-scoped check itself advises «rewrite it»

kaif-fp: .kaif/tools/kaif-attribution-lint.mjs --write-baseline :: debt-ratchet-bypassed-by-scope :: v2.8
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/112
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF 2.8 · project KAGO · sphere programming · language ru ·
tracking origin · agent system claude-code (Claude Opus 5.5) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "attribution" bugs/KAIF/` → only `20_*`, the budget gate) and origin
issues (`gh issue list --repo MikalaiKryvusha/KAIF --state all --search "attribution baseline"` / `"attribution-lint"` → none on
this surface). No match found.
**Found:** 2026-09-26, the KAIF 2.7 → 2.8 update of KAGO.

## Expected per canon

The lint's own words, verbatim: «Adoption writes the whole picture once. After that the baseline ONLY SHRINKS: a rewrite that would
launder a NEW finding into debt is refused» (`kaif-attribution-lint.mjs:355-356`) and «it only shrinks from here; a changed or
vanished line is pruned on the next write». `/end-chat-soft` (2.8) sends the closing agent to exactly the scoped form: «if the trim
moved text into a directory outside it, name that directory — `node .kaif/tools/kaif-attribution-lint.mjs check <dir>`». A debt
entry should leave the baseline when ITS line is fixed or gone — never because the run did not look at its file.

## Got in the field

On KAGO right after adopting the baseline (93 findings under 92 keys), a path-scoped check prints the invitation (verbatim):

```
$ node .kaif/tools/kaif-attribution-lint.mjs check AUTHOR_STYLOMETRY.md
✅ attribution-lint OK — 1 file(s) scanned, new 0 · debt 0 (baseline .kaif/attribution-lint.baseline.json, 92 entries no longer found — rewrite it)
```

Following it, on a COPY of the baseline:

```
$ node .kaif/tools/kaif-attribution-lint.mjs check AUTHOR_STYLOMETRY.md --write-baseline --baseline <copy>.json
baseline written: <copy>.json — 0 finding(s) recorded as debt (0 adopted as NEW on purpose, …
$ node -e "…Object.keys(b.entries).length" <copy>.json
entries left: 0
```

(«92 entries» is the whole baseline: it records `count: 93` under 92 keys, because two identical lines of one file —
`PROJECT_HISTORY.md`, «край, а край — это спуск в непросмотренное…», 2 occurrences — share one key. The scoped run found none of
them in its one file, and the copy then lost all 92 keys.)

**Correction, 2026-09-26 (after a second clean-context judge pass, re-measured by the author in a scratch repo before posting):** the
first edition ended «The shared key is a side observation: fixing one of two identical lines cannot be told from fixing both» —
FALSE: with two identical unquoted lines baselined (`count 2 keys 1`), fixing one gives `new 0 · debt 1`, fixing both `debt 0`. The
real hole of the shared key is the opposite direction: ADDING a third identical unquoted line to the same file gives
`✅ attribution-lint OK — 1 file(s) scanned, new 0 · debt 3`, exit 0 — a NEW finding is absorbed into the inherited debt. Repro:
`plans/p.md` with «The owner decided to ship it on Friday.» on two lines → `check --write-baseline --baseline bl.json` → append the
same line a third time → `check --baseline bl.json`. A fix: key by (file, text, occurrence count) and red when a key's count grows.

## Repro (deterministic)

1. In a deployed project with findings in two directories, adopt: `check --write-baseline` (N entries).
2. `check <one directory> --write-baseline` → the baseline now holds only that directory's entries; the rest are «pruned».
3. A later full `check` reds on every pruned line as NEW, or — if they were pruned on purpose to silence a closing — the debt
   record is simply gone.

## Cost and violated invariant

Invariant **honest-green**: the ratchet «only shrinks» is bypassed without a single line fixed, by a command shape the closing
ritual itself names; an agent under a red closing gate is one flag away from erasing the debt it was told to carry.

## What in KAIF led to this

`cmdCheck` → `writeBaseline(findings)` writes the findings of the CURRENT scope as the whole baseline (`:362`), and the prune
count (`:363`, `:369`) compares the whole baseline with a scoped scan. Smallest fix: with explicit paths, `--write-baseline`
merges — it prunes only entries whose file is inside the scanned scope, keeps the rest — or refuses; and the «no longer found —
rewrite it» hint is printed only for entries inside the scope.

## Local remediation (per the "defect in KAIF itself" contour, if applied)

None. KAGO's baseline was written by a full-scope run (93 findings, 92 keys) — untracked when this ticket was filed, committed
with the update's commit; the experiment above ran on a copy.
