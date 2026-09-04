# KAGO — KAIF 2.4 → 2.5 update report (bootstrap route chosen at a rehearsed fork; same-day first pass)

> **Created:** 2026-09-04 · **Parent:** owner's order (chat, 2026-09-04: «обнови KAIF до последней версии
> 2.5 с написанием отчета в ориджин») · **Status:** update VERIFIED WITH CAVEATS, tree green ·
> **Agent:** Claude Fable 5.1, VS Code CLI · **Host:** Windows 11 Pro 10.0.26200, Node v24.15.0 ·
> **Deployment:** tracking `origin` · lang `ru` (8 owner docs localized, skills English) · sphere
> `programming` · agents claude-code (+4 mirrored) · **Outbound:** this report → origin (URL appended in
> §6 after delivery) + `bugs/KAIF/17` → origin **#40**, delivered by `kaif-core report` (the 2.5 command
> itself, exercised live).

## 1. Chronology with numbers

| Step | Command | Result |
|---|---|---|
| Pre-flight | `git status --porcelain` · `node .kaif/kaif-core.mjs version` | clean tree at `3a00d75` · `KAIF 2.4 (released 2026-08-28) · tracking: origin · lang: ru` |
| Origin | `gh release list --repo MikalaiKryvusha/KAIF` | `KAIF 2.5 — Experienced KAIF · Latest · v2.5 · 2026-09-04T13:16:03Z` (released ~3 h before this pass) |
| Preview (2.4 core) | `diff --source https://github.com/MikalaiKryvusha/KAIF` | `diff vs 2.5: 23 file(s) carry upstream static-module changes; 51 — nothing to do` |
| Sandbox A, attempt 1 | `git archive HEAD \| tar -x` → `git init` → `git add -A` | **`error: … Filename too long`** on a 96-char interview archive name under the scratchpad path; `update` never ran (§2 R9) |
| Sandbox A, attempt 2 | `git config core.longpaths true` → real `update` (core-update route, the DEPLOYED 2.4 core) | `2.4 → 2.5` · `18 files replaced, 12 modules merged in-place, 4 added, 63 kept` · task 9 items, 5 files with diffs · **the severity-ladder module landed INSIDE the localized prayer pair** (BUG_FIXING: line 3 BEGIN → line 4 module → line 30 prayer → line 63 END) · `npm run check` there **RED**: `МОЛИТВА РАЗОШЛАСЬ с PHILOSOPHY.md в 1 файл(ах): BUG_FIXING_FRAMEWORK.md` (exit 1) |
| Fork | chat | `FORK: options A (core-update, fold the module out by hand before prayer --apply, which replaces the whole BEGIN…END slice) \| B (bootstrap: thin KAIF.md + loader → the fresh 2.5 core classifies against the surviving manifest) · price of error: low (backup tree + git) · consulted: /kaif-update step 2 route note + rehearsal B` |
| Sandbox B | thin `KAIF.md` + `KAIF-LOADER.mjs --lang ru` | `existing KAIF 2.4 detected — running as an UPDATE to 2.5` · `AGENT_GUIDE.md: baseFound 28 of 29, ceiling 4 → merged`, PHILOSOPHY 22/22, BUG_FIXING 6/6, TESTING 7/7, REQUIREMENTS 7/7 → merged · same counters `18 replaced, 12 modules merged in-place, 4 added, 63 kept` · `.gitignore: ignore-first for .kaif/guarded-loop.json, .kaif/update-rehearsal.json` · severity ladder at line **109**, after the prayer END (37) · `kaif-core check` green · `npm run check` green (`молитва: 12 канон-документов, все копии совпадают`) |
| Live (route B) | `node KAIF-LOADER.mjs --lang ru`, loader byte-identical to the rehearsed one | output matched sandbox B line for line · `KAIF_UPDATE_TASK.md` byte-IDENTICAL to the rehearsal (`diff` empty) · prayer pairs 1/1 in all 8 carriers · `.kaif/kaif.json` history: `{"from":"2.4","to":"2.5","route":"bootstrap"}` |
| Task items 1–7 | `checkpoint policy-changes … recheck` | 8 rule changes surfaced · 7 modules folded by hand (§1a) · MASTER_PLAN delivery-metric block · 2 English arrivals kept English · 5 stale lines (2 bumped in KAIF_FRAMEWORK, 2 in README, 2 `KAIF-VERSION-OK` markers) · `✔ stale-claims scan ran clean (executed by the checkpoint itself)` · `✅ manifest satisfied: 89 files + 152 agent artifacts present` · mirrors re-synced, `check` → 0 drifted |
| Project gate | `npm run check` | `checked 79 .mjs file(s), 0 failed` · `1699 текстовых файлов, испорченных 0` · prayer 12/12 · `СТОРОЖ УГРОЗ … новых нарушений: 0 · в долге: 1` · `СТОРОЖ ВХОДА … приборов 34 · без сторожа 0 · в долге 0` |
| Battery | `npm run selftest:all` | `ИТОГ: наборов 48, красных 0, зелёных блоков 2501, 48.3 с` — identical to the pre-update STATUS numbers (48/0/2501) |
| Manifest | `node .kaif/kaif-core.mjs check` | green; budget warnings STATUS 1809/~200 · GOAL 1958/~300 · AGENT_GUIDE 1655/~1200 · MASTER_PLAN 466/~300 · REQUIREMENTS 251/~250 (pre-existing bonsai debt, advisory) |
| New tools | `kaif-guard-lint check` / `selftest` | `4 finding(s) in 23 declared block(s)` — all four in ONE pre-existing debt block (`bugs/99:72 @fork envelope-vs-vector`, written as a list); `selftest OK — 8 cases` |
| | `kaif-scenario-lint check` / `selftest` | `SKIPPED — no scenario block in 225 file(s) … (exit 3)`; `selftest OK — 33 cases, 7 rules × 2 languages` |
| Ticket | `kaif-core report bugs/KAIF/17_*.md --dry-run` → live | dry-run body via `--body-file`, em-dash bytes `342 200 224` · live: `✔ delivered: https://github.com/MikalaiKryvusha/KAIF/issues/40 — written into bugs/KAIF/17_… (Delivered upstream)` · read back from the API: body starts `# KAIF bug:`, no BOM, em-dash intact |
| Judge | `/fable-judge`, 8 claims re-run, `checkpoint judge --verdict-file` | **VERIFIED WITH CAVEATS** — quoted verbatim in §5 |

### 1a. What was folded by hand (the 7 diverged modules)

- `AGENT_GUIDE.md` (3): `FORK` added to the forced-artifact list of checklist step 7; the fourth-door
  sentence appended to step 9 (the project's own carrier 9a / `/recon-before-decision` kept); the local
  delivery rule 1 now carries the `DELIVERY:` prefix the judge hunts; the Git-workflow carve-out kept in
  its localized, stronger form (the owner's words of 2026-08-30, origin #37); the prayer module stays the
  localized one with the owner's cadence (интервью 017 Q2 = B — legal under 2.5, cadence is an owner setting).
- `TESTING_FRAMEWORK.md` (1): gate 5's second half (`@guard THREAT · PROVED-AGAINST · GAP ·
  ON-REAL-PATH`, `@forensic … DURABLE-AT`) folded in verbatim; the project's own 6a («is the engine
  mounted?», 2026-08-30) collapsed to the owner's quote + a pointer to gate 5 and to the local linter
  `tools/guard-lint.mjs` — the 2.5 rule "a mechanized lesson collapses", applied on arrival.
- `autoloop` · `dayloop` · `nightloop` (1 each): the short chat report opens with
  `DELIVERY: краёв X/389 → Y/389 · режимов A/4 → B/4; moved by: … | blocker: …` — the project's metric
  (`npm run curve -- --progress`); the `<BUILD_COMMAND>`/`<TEST_HARNESS>` slots stay filled locally.
- `MASTER_PLAN.md` (owner convention): a «Метрика доставки» block under the vision line — the ONE metric
  (`краёв X/389 · режимов Y/4`, `GOAL.md` → «🏁 КРИТЕРИЙ ПРИЁМКИ ТЮНИНГА»), the command that prints it,
  where the line stands, and that only the owner's word changes it. No owner text touched (+7/−0).

## 2. Rakes

### R1 — the route decides whether 2.5's anchored-block rule is in play at all (no ticket; the 2.5 core is right)

Severity: medium for a localized deployment, low here (two rehearsals, ~10 min). The core-update route
runs the interval with the DEPLOYED core; on a tree whose core predates the anchored-block rule, the OLD
merge logic places a new top-of-document module inside a localized `KAIF:PRAYER` pair. Sandbox A, verbatim:

```
3:<!-- KAIF:PRAYER:BEGIN — ОДИН ИСТОЧНИК: PHILOSOPHY.md. Правится там, раскладывается `node tools/prayer.mjs --apply` -->
4:## The severity ladder — the response is sized by the incident, never fixed at maximum
30:## 🙏 МОЛИТВА ПЕРЕД РАБОТОЙ
63:<!-- KAIF:PRAYER:END -->
```

The project's own tool would have finished the damage: `tools/prayer.mjs --apply` replaces the whole
`BEGIN…END` slice with the source block (`text.replace(had, block)`) — one "cure" away from deleting the
arrival. The bootstrap route with the fresh core placed the same module at line 109, after the END:

```
3:<!-- KAIF:PRAYER:BEGIN — … -->
4:## 🙏 МОЛИТВА ПЕРЕД РАБОТОЙ
37:<!-- KAIF:PRAYER:END -->
109:## The severity ladder — the response is sized by the incident, never fixed at maximum
```

So 2.5's claim holds — for the 2.5 core. The route note in `/kaif-update` says the new guarantees "apply to
the NEXT interval" and offers the bootstrap route as an option; on a localized tree with anchored pairs it
is not an option but the only safe route, and nothing in the machinery says so before the merge. Wish §4.1.

### R2 — `kaif-core report` refuses pre-2.5 tickets (ticketed: `bugs/KAIF/17` → origin #40)

Severity: S3 (minutes, caught in `--dry-run`). Verbatim:

```
$ node .kaif/kaif-core.mjs report bugs/KAIF/16_the_blanket_auth_rule_swallows_the_kaif_defect_carve_out_and_tickets_never_ship.md --dry-run
✖ the Delivered upstream line is neither NOT YET nor a URL: "**Delivered upstream:** ✅ this issue — sent 2026-08-30 immediately on filing, per the rule this"
exit=1
```

Ticket 16 IS delivered (#37); its line wraps at 100 columns and the parser reads one physical line and only
`https?://`. Three more field tickets (10, 11, 12) wrote `not yet` in lowercase and hit the case-sensitive
`/NOT YET/` with the same words. The refusal names what the line is not, never what it must be — the class
a weaker session turns into "not a ticket" or into a duplicate issue. Smallest fix in the ticket.

### R3 — positive: `bugs/KAIF/10` closed in the field, and the two routes showed it side by side

Route A's task (2.4 core) still listed `<BUILD_COMMAND> → EXPERIENCE.md, KAIF_FRAMEWORK.md` — the two
verbatim quotes of the 2.2 refusal. Route B's task (2.5 core) carried **no `placeholders` item at all** and a
`language-arrivals` item instead (`diff` of the two task files: lines 21–22 differ, nothing else but the
header). "The placeholders item names only the surfaces the final gate judges" — confirmed.

### R4 — positive: the rehearsal matched the live pass byte for byte for the third release running — and this time it changed the route

2.3 and 2.4 rehearsals matched live in composition; 2.5's matched in the task file itself (`diff` empty).
The first rehearsal's red gate was the reason to rehearse the other route before touching the tree — the
skill's "sandbox copy is the pass itself" line paid for itself in the most useful way: before the pass.

### R5 — observation: `kaif-guard-lint` also parses `@fork`, and both linters agree on the schema

The release page says the linter "fires only on explicit `@guard` / `@forensic` markers"; the tool's own
header adds `@fork OPTIONS · COST · RECON · DECIDED` — the very fields this project's `tools/guard-lint.mjs`
(mechanism М4, `plans/76`) has used since 2026-08-31. Result on this tree: 23 blocks parsed, 4 findings, all
four in one known debt (`bugs/99:72`, OPTIONS written as a bulleted list; the local linter reports it as
«в долге: 1»). No collision; a doc nit (§4.4).

### R6 — observation: the language-mix heuristic in `check` flipped 37 → 34 "English skills" on three Cyrillic tokens

After `краёв · режимов · Метрика доставки` entered the three loop skills' report lines, `check` reported
`language mix: 34 of 38 skills are English` (was `37 of 38`). Advisory and harmless; the heuristic is
coarse (§4.4).

### R7 — my own near-miss, S3 → one EXPERIENCE entry (EXP-0238): a false CRLF reading

`grep -c $'\r$' AGENT_GUIDE.md` in Git Bash printed `1652` of 1652 lines; `tr -cd '\r' < AGENT_GUIDE.md | wc -c`
printed `0` and `git ls-files --eol` printed `i/lf w/lf`. The tree is LF in the working copy
(`core.autocrlf=true`); git's «LF will be replaced by CRLF» warnings on every touched file are the norm, not
damage — and the 2.4 report's R3 phrase "a CRLF Windows tree" should be read with that in mind. Caught
before it became a claim; recorded per the 2.5 ladder as one entry, no bug document.

### R8 — the previous delivery, not this pass: origin issue #23's body is double-encoded

`gh api repos/MikalaiKryvusha/KAIF/issues/23 --jq .body | head -c 120 | od -c` → `357 273 277` (a BOM) then
`K A G O 320 262 320 202 342 200 235` where `—` should be — the 2026-08-28 manual delivery went through a
shell that re-encoded UTF-8. The 2.5 command's `--body-file` path is clean (#40 read back: no BOM, em-dash
`342 200 224`); this report goes out the same `--body-file` way and is read back before §6 is written.
Repairing #23's body (`gh issue edit --body-file` from the local report) is one command — left to the owner.

### R9 — sandbox recipe on Windows: `Filename too long`

`git add -A` in a `git archive` copy under the scratchpad path died on
`interviews/decisions/archive/interview_022_…--2026-08-31T10-40-18+03-00.json` (96 chars + a 130-char
prefix). `git config core.longpaths true` in the copy cures it; a one-line note in the skill's sandbox
recipe would save the next Windows deployment the retry (§4.5).

## 3. What was exercised vs NOT

**Exercised:** `diff --source` preview (2.4 core) · two sandbox rehearsals, one per route · the
**bootstrap route on an existing deployment** (first time in this project) · wholesale verdicts printed
with numbers · ignore-first for the two new state files · pre-update backup (85 files) + crash journal
(success path) · module merge into localized canon with anchored pairs under the 2.5 placement rule · all 9
task items incl. `language-arrivals` · executing checkpoints (`stale-claims` scan, `check`) · mirrors
re-sync (0 drifted after) · judge via `--verdict-file` · **`kaif-core report`** dry-run + live (#40) with
byte read-back · both new linters (`check` + `selftest`) · this report and its delivery.

**NOT exercised:** the core-update route live (sandbox A only) · `--rehearsal <receipt>` binding (the 2.4
core's `diff` wrote no `update-rehearsal.json`; the receipt path is untested) · crash mid-update + `resume` ·
`kaif-scenario-lint` on a real scenario (none written yet) · `@guard` blocks in this project's code (the
local linter covers them) · the `team-adopt` / `team-ci-template` references · the `/guarded-loop` armed
boundary · the `DELIVERY:` line in a live loop · the permission-layer allowlist for `report` (owner's config).

## 4. Wishes for the next version (by cost, descending)

1. **Let the NEW core run the interval** (or say in `/kaif-update` step 3 that a localized deployment with
   anchored pairs MUST take the bootstrap route while its deployed core predates the anchored-block rule) —
   closes R1's class for every i18n deployment; today the safety depends on the agent rehearsing.
2. **`report` line contract** (#40): case-insensitive `not yet`, `#NN` on the line as delivered, a refusal
   that names both legal forms and the edit.
3. **The bootstrap-route task file lacks the old-template baseline:** a module absent from disk renders as an
   all-`+` block (route A, with its synthetic baseline, showed the real `−`/`+` of the cadence line). Ship
   the baseline on that route too.
4. **Cheap:** the release page's linter sentence lists `@fork`; the language-mix heuristic ignores a skill
   whose non-English share is a few tokens.
5. **Cheap:** a Windows note in the sandbox recipe (`git config core.longpaths true`).

## 5. Final state and the judge verdict

`.kaif/kaif.json`: version **2.5**, released 2026-09-04, history 2.2→2.3→2.4 (core-update) →2.5
(**bootstrap**), tracking `origin`. Manifest 89 + 152 green, 0 drifted mirrors; battery 48/0/2501;
encoding guard 1699/0; prayer 12/12. `DELIVERY: краёв 11/389 → 11/389 · режимов 1/4 → 1/4; moved by: nothing
(a framework update, offline by the owner's order) | blocker: edge runs happen only with the owner at the
machine (интервью 017, Q4)`. Eight policy changes adopted on the owner's update order, surfaced in the chat,
veto open.

Judge verdict, verbatim (full text in the `.kaif/last-update.json` receipt):

> FABLE-JUDGE VERDICT on the KAIF 2.4 → 2.5 update (KAGO, 2026-09-04): VERIFIED WITH CAVEATS.
>
> Claims re-run, not trusted: 1. "Versions stamped" — `.kaif/kaif.json`: version=2.5, released=2026-09-04,
> history carries 2.4→2.5 (route `bootstrap`, 2026-09-04T17:11:13+03:00). CONFIRMED. 2. "Nothing
> owner-authored lost" — `git status` over the owner directories: two lines only, both deliberate additions
> of this pass (MASTER_PLAN.md +7/−0, plans/54 +1 comment line); prayer 12/12 copies identical. CONFIRMED.
> 3. "The merges are real" — anchored pairs KAIF:PRAYER 1/1 in all 8 carriers; every mechanically merged
> module found exactly once (the severity ladder at BUG_FIXING line 109 AFTER the prayer END at 37); every
> hand fold once; `cmp` of the four edited skills against three mirror dirs 12/12; 0 drifted mirrors.
> CONFIRMED. 4. "The project still works" — `npm run check` green (79 .mjs, 1699 files encoding-clean,
> threat guard 0 new / 1 debt); `npm run selftest:all` 48 sets / 0 red / 2501 blocks / 48.3 s = the
> pre-update STATUS numbers; `kaif-core check` manifest 89 + 152. CONFIRMED. 5. "Replaced content carries no
> owner edits" — backup vs `git show HEAD:` for every replaced/merged path in the backup: compared 29,
> mismatches 0. CONFIRMED. 6. "The rehearsal bound the live pass" — sandbox-b's KAIF_UPDATE_TASK.md
> byte-identical to live, same counters 18/12/4/63, same verdicts with numbers. CONFIRMED. 7.
> Fork-without-recon hunt — the route choice carried its FORK: line before the live run (options A | B ·
> price low · consulted: the route note + two rehearsals). PASSES. 8. Delivery-line hunt — zero delta with a
> named blocker. PASSES. Weakened tests: none.
>
> Caveats: eight 2.5 policy changes adopted on the owner's update order with the veto open (the prayer
> cadence stays the owner's own setting, интервью 017 Q2 = B — legal under 2.5); the two new
> team-deployment references stay English; `kaif-core report` refuses three pre-2.5 tickets (10–12,
> lowercase «not yet») and one delivered-by-hand ticket (16) with the same message — ticketed (bugs/KAIF/17
> → #40), the DONE closure of 10–12 (fixed in 2.5) is a follow-up; line budgets warn on five re-read
> documents (pre-existing bonsai debt); the permission-layer allowlist for `report` was NOT added.

**`update-verify` postscript:** passed with 54 «promised upstream line not found» warnings — all inside the seven hand-folded modules, where the template’s slots were replaced by the project’s own carriers on purpose: `<BUILD_COMMAND>` / `<TEST_HARNESS>` stay `npm run check` / `npm run gpu:info`; `DELIVERY: <the owner’s metric> X → Y` became `DELIVERY: краёв X/389 → Y/389 · режимов A/4 → B/4`; the English prayer module stays absent (the localized block with the owner’s cadence is the carrier). The STATUS/GOAL «MODULE ABSENT» lines are the known shape of a fully localized owner canon (upstream bug 26), unchanged by this pass. Installer files self-cleaned (`KAIF.md`, `KAIF-LOADER.mjs`, `KAIF_UPDATE_TASK.md`, `.kaif/install/`), `.kaif/last-update.json` stamped `verifiedAt`.

## Сигналы в исток (signals to origin)

1. R1 — on a localized deployment the core-update route (deployed 2.4 core) planted a new module inside the
   `KAIF:PRAYER` pair; the bootstrap route (fresh 2.5 core) placed it after the END. The 2.5 rule is
   correct; the route selection is the gap. Wish §4.1.
2. R2 — `bugs/KAIF/17` → **#40**: the `report` contract-line parse (case, one physical line, URL-only).
3. R3 — positive: `bugs/KAIF/10` fixed in the field (no quote-only `placeholders` item on the 2.5 core).
4. R4 — positive: the sandbox rehearsal matched live byte for byte (third release running) and this time
   caught a red gate BEFORE the live pass and changed the route.
5. R5/R6 — doc nit (`@fork` in the linter sentence) and a coarse language-mix heuristic.
6. R8 — origin issue #23 (this project's 2.3 report) has a double-encoded body from the old manual path;
   the 2.5 `--body-file` path is clean (#40 verified by bytes).
7. R9 — Windows sandbox recipe: `core.longpaths`.
8. Positive: `stale-claims` and `check` are now EXECUTED by their checkpoints (`✔ stale-claims scan ran
   clean (executed by the checkpoint itself)`), and `KAIF-VERSION-OK` markers were honoured on the first try.

## 6. Delivery record (appended after the send)

- This report → origin issue **#41**: https://github.com/MikalaiKryvusha/KAIF/issues/41 (`gh issue create --body-file`, 2026-09-04 17:3x +03:00; read back from the API: no BOM, em-dash bytes `342 200 224`, arrow `342 206 222`).
- `bugs/KAIF/17` → origin issue **#40**: https://github.com/MikalaiKryvusha/KAIF/issues/40 (`kaif-core report`, the URL written into the ticket by the command).
- Final re-run after the self-clean: `npm run check` reads **78** `.mjs` (not the 79 of the §1 row) — `KAIF-LOADER.mjs` was still in the root at that reading and `update-verify` removed it; every other number is unchanged (1700 text files scanned, prayer 12/12, manifest 89 + 152, battery 48/0/2501).
- The mirror re-sync also propagated this project’s OWN skill `/recon-before-decision` (created 2026-08-31, after the 2.4 update) into `.agents/`, `.grok/`, `.cline/` and `.roo/commands/` — the first sync since it was written; the manifest does not track it, `sync` simply mirrors everything under `.claude/skills/`.
