# KAIF ticket 06 — update merge writes LF endings into a CRLF working tree, transiently reddening local byte-exact guards

> **Type:** B (improvement) · **Found:** 2026-08-28, during the KAGO 2.2 → 2.3 update ·
> **KAIF version:** 2.3 «Subjected KAIF» (the writer is the arriving machinery; observed with the
> 2.2 core performing the pass, and the written files came from the 2.3 bundle) ·
> **Severity:** low (cosmetic-to-transient; healed by the project's own tooling in one command) ·
> **Delivery:** tracking `origin` — folded into the 2.3 field update report
> (`reports/KAIF_UPDATES/KAGO_KAIF_2.3_UPDATE_REPORT.md`), delivered upstream with it.

## Symptom

On a Windows deployment with `core.autocrlf = true` (the working tree is CRLF), `update` writes
merged/replaced markdown files with **LF** endings. Git normalizes on commit, so the repository is
unharmed — but any LOCAL guard that compares text blocks **byte-exact across files on disk** sees
the rewritten file diverge from its untouched siblings.

This project pays for exactly that shape: the prayer block (a canon header mirrored into 12
documents from one source, `PHILOSOPHY.md`, compared byte-exact by `npm run check`). The update
merged a module into `PHILOSOPHY.md` (rewriting it with LF); `STATUS.md` and `GOAL.md` kept CRLF:

```
МОЛИТВА РАЗОШЛАСЬ с PHILOSOPHY.md в 2 файл(ах): STATUS.md, GOAL.md
лечение: node tools/prayer.mjs --apply (правится ТОЛЬКО в PHILOSOPHY.md)
```

`git diff STATUS.md GOAL.md` after the cure is EMPTY — the divergence was endings-only, zero
content. Cost: ~2 minutes, because the guard prescribed its own cure.

## Why it is worth a line of code upstream

The update's contract is "the project must stay whole and working at every step". A tree whose own
build gate goes red immediately after a green mechanical pass violates the letter of that, even
when the cause is cosmetic — and the next deployment's local guard may not print its own cure.

## Smallest fix

When rewriting an EXISTING file, detect the dominant line ending of the bytes being replaced
(first `\r\n` vs bare `\n`) and emit the merged content with the same convention. New files may
stay LF. One helper at the single write site covers merge and replace alike.

## Repro

Windows, `git config core.autocrlf true`, any deployment whose canon docs are CRLF on disk →
run `update` across a version that merges a module into one of them → compare endings:
`node -e "const s=require('fs').readFileSync('PHILOSOPHY.md','latin1'); console.log(s.includes('\r\n'))"`
prints `false` for the rewritten file, `true` for its untouched siblings.
