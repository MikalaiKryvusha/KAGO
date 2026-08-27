# KAGO — KAIF 2.3 update field report (a clean mechanical pass, one endings rake)

> **Pass:** `/kaif-update` 2.2 → 2.3 «Subjected KAIF», requested by the owner · **Date:** 2026-08-28
> **Agent:** Claude Fable 5, VS Code CLI · **Host:** Windows 11 Pro 10.0.26200, Node v24.15.0
> **Deployment:** tracking `origin` · lang `ru` · sphere `programming` · agents claude-code (+4 mirrored)
> **Outcome:** updated mechanically, all 8 task items closed with executing checkpoints, both gates
> green, judge verdict VERIFIED WITH CAVEATS. One new upstream ticket (endings), one 2.2 rake
> confirmed fixed in 2.3, one 2.2 rake re-met on the old core exactly as already ticketed.

---

## 1. Chronology with numbers

| Step | Command | Result |
|---|---|---|
| Pre-flight | `git status --porcelain` | clean tree at `cfb2ada` |
| Deployed version | `node .kaif/kaif-core.mjs version` | `KAIF 2.2 (released 2026-08-08) · tracking: origin · lang: ru` |
| Origin releases | `gh release list --repo MikalaiKryvusha/KAIF` | `KAIF 2.3 — Subjected KAIF · Latest · v2.3 · 2026-08-21T15:49:41Z` |
| Preview | `diff --source …/releases/download/v2.3` | `9 file(s) carry upstream static-module changes; 59 — nothing to do` |
| Sandbox | real `update` in a `git archive` copy | full pass; live run later matched it line-for-line |
| Update | `node .kaif/kaif-core.mjs update` | backup 79 files → `.kaif/backup-2.2-2.3/` · merged 8 modules into 4 canon docs (1 kept for the project) · replaced 5 files (core included) · added `.kaif/_testcases-template.md` · task: 8 items |
| Checkpoints 1–6 | `checkpoint policy-changes … recheck` | all executed; placeholder scan clean · stale-claims clean after 3 edits · mirrors re-synced (152 copies) |
| Manifest | `node .kaif/kaif-core.mjs check` | `✅ manifest satisfied: 80 files + 144 agent artifacts present` |
| Project gate, run 1 | `npm run check` | **RED** — prayer block diverged (see rake §2.1) |
| Cure | `node tools/prayer.mjs --apply` | `изменено файлов 2 — STATUS.md, GOAL.md`; `git diff` of both EMPTY |
| Project gate, run 2 | `npm run check` | GREEN: `56 .mjs, 0 failed · 420 текстовых файлов, испорченных 0 · молитва: 12 канон-документов, все копии совпадают` |
| Judge | `/fable-judge`, 6 claims re-run | **VERIFIED WITH CAVEATS** — quoted verbatim in §5 |

## 2. Rakes

### 2.1 `update` writes LF endings into a CRLF working tree → the project's own byte-exact guard reddens

Severity: **low**. Cost: ~2 minutes. The machinery rewrote `PHILOSOPHY.md` (a module merge) with LF
endings on an `autocrlf = true` tree; this project mirrors a canon header (the "prayer" block)
byte-exact across 12 documents and compares them in `npm run check`. Verbatim:

```
МОЛИТВА РАЗОШЛАСЬ с PHILOSOPHY.md в 2 файл(ах): STATUS.md, GOAL.md
лечение: node tools/prayer.mjs --apply (правится ТОЛЬКО в PHILOSOPHY.md)
```

Content loss: **zero** (`git diff STATUS.md GOAL.md` empty after the cure — endings only). But a
green mechanical pass that immediately reddens the deployment's own build gate breaks the letter of
"the project stays whole at every step", and another deployment's guard may not print its own cure.
Smallest fix proposed: preserve the dominant line ending of the file being rewritten. Ticket:
`bugs/KAIF/06_update_merge_writes_lf_into_a_crlf_working_tree.md` (template B, delivered with this
report).

### 2.2 Re-met on the OLD core, already ticketed, already fixed upstream

`diff --source https://github.com/MikalaiKryvusha/KAIF` (bare repo URL) with the 2.2 core:

```
✖ download failed (404) — https://github.com/MikalaiKryvusha/KAIF/kaif-manifest.json
Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76
```

This is `bugs/KAIF/04` from the 2.2 report, and the 2.3 release news declares both halves fixed
(issue #10: bare URL resolves to release assets; no hard-exit after the first network call). The
route note in `/kaif-update` is accurate: the fixes ride the NEW core and apply from the next
interval. No new ticket.

### 2.3 Kindness worth naming: the 2.2 placeholder rake did not reproduce

`checkpoint placeholders` executed its scan against a tree where `<BUILD_COMMAND>` exists only
inside verbatim QUOTES (a lesson in `EXPERIENCE.md`, the deployment record in `KAIF_FRAMEWORK.md`)
— and ran clean. On 2.2 this exact shape cost a refusal (`bugs/KAIF/01`).

## 3. What was exercised vs NOT

**Exercised:** version/release discovery · `diff --source` preview (release-assets URL) · the
sandbox-copy rehearsal (skill step 2 — byte-accurate: live matched sandbox) · the `core-update`
route · pre-update backup · module merge into locally-edited canon (additive, prayer blocks
survived) · file replacement · mirror re-sync (152 copies) · all 8 checkpoints incl. the three
EXECUTING gates · `update-verify` self-clean · the project's own gate interplay.

**NOT exercised:** the thin-`KAIF.md` bootstrap route · crash-mid-update + the new `resume`
command · `adopt-current` · localization transfer of the English arrivals into `ru` (accepted in
English as-is; the localized-owner-docs list printed by the updater is on file) · the new
`testcases/` home (template delivered; first feature use pending) · language-pack freeze effects
(this deployment is `ru`, one of the two maintained packs — unaffected, recorded for the owner).

## 4. Wishes for the next version (by cost, descending)

1. **Preserve the target file's line-ending convention when merging/replacing** (ticket 06) — one
   helper at the write site; removes the whole class of §2.1 on Windows deployments.
2. **Print the module SIGNATURES in the update's merge lines** (`merged 1 module(s) into
   AGENT_GUIDE.md (1 kept for you)` → name which module was kept) — the sandbox diff answered it,
   but the answer should not require a sandbox.

## 5. Final state and the judge verdict

`node .kaif/kaif-core.mjs version` → `KAIF 2.3` · `.kaif/kaif.json` carries
`history: [{from: 2.2, to: 2.3, route: core-update, date: 2026-08-28}]` with every owner field
preserved · manifest `80 files + 144 agent artifacts` green · project gate green
(56 .mjs · 420 texts, 0 corrupted · prayer identical across 12 docs).

Judge verdict, verbatim (full text in the update receipt, `.kaif/last-update.json`):

> **VERDICT: VERIFIED WITH CAVEATS.**
>
> Caveats, both named: (1) the machinery writes LF line endings, which transiently reddened the
> project's own prayer-consistency guard — healed by the guard's own cure, zero content loss;
> (2) the 152 re-synced mirror skill copies (.agents/.grok/.cline/.roo) are verified by the
> manifest check, not read individually.
