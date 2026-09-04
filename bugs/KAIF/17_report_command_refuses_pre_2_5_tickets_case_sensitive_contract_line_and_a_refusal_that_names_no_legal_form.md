# KAIF bug: `kaif-core report` refuses pre-2.5 tickets — the `Delivered upstream:` contract is case-sensitive, reads one physical line, and the refusal names neither legal form

kaif-fp: `.kaif/kaif-core.mjs` cmdReport (contract-line parse) :: refusal-without-the-fix :: v2.5
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/40
**Autocapture** (from `.kaif/kaif.json` + update receipt): KAIF 2.5 · project KAGO · sphere `programming` ·
language `ru` · i18n partial (8 owner docs localized, skills English) · tracking `origin` · agent system
claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0 · route of this update: bootstrap
(thin `KAIF.md` + loader, fresh 2.5 core)
**Dedup attestation:** searched `bugs/KAIF/` (`ls` → 01–16; 16 is the AUTH carve-out, none about the
delivery command's line contract) and origin issues (`gh issue list --state all --limit 60 --search
"Delivered upstream"` → #37, #23, #17, #38, #31 — none about the parser). No match found.

## Expected per canon

Release notes 2.5, §3: *"Refusals are named (anonymous tracking · no `gh` · not a ticket · `gh` refused),
a timeout is 'outcome unknown' rather than a refusal, `--dry-run` calls nothing."* — the delivery step
became a command precisely so that no agent has to reason about it.

Template A (`/report-bug`): *"`**Delivered upstream:** <origin issue URL · or NOT YET — legal only on
tracking: anonymous>`"*. The field's 16 tickets were written under the 2.2–2.4 templates.

<!-- owner-review:allow because=цитата СТРОКИ ШАБЛОНА KAIF 2.2–2.4, которую отвергает команда report, а не обращение к владельцу: за ним по этому тикету ничего не числится, тикет уже отправлен в исток (origin #40). Класс ложной находки bugs/40 — «цитата читается как обращение К нему». -->
Their line read *"NOT YET — awaiting the owner's word (outward action)"*, and three of them wrote it
lowercase.


## Got in the field

```
$ node .kaif/kaif-core.mjs report bugs/KAIF/16_the_blanket_auth_rule_swallows_the_kaif_defect_carve_out_and_tickets_never_ship.md --dry-run
✖ the Delivered upstream line is neither NOT YET nor a URL: "**Delivered upstream:** ✅ this issue — sent 2026-08-30 immediately on filing, per the rule this"
exit=1
```

Ticket 16 IS delivered (origin #37) — its line wraps at the project's 100-column convention and the issue
number lives further down the document as `origin **#37**`. Three more tickets carry the undelivered form
in lowercase and would be refused with the same words:

```
$ grep -n "^\*\*Delivered upstream:\*\*" bugs/KAIF/1[0-2]_*.md
bugs/KAIF/10_placeholder_task_item_lists_verbatim_quotes_as_fill_locations.md:5:**Delivered upstream:** not yet — this update's field report is collected by t…
bugs/KAIF/11_team_naming_invariant_breaks_on_the_manager_seat.md:5:**Delivered upstream:** not yet — rides the team-deployment field report collected by the o…
bugs/KAIF/12_team_roles_library_ships_web_archetypes_only.md:5:**Delivered upstream:** not yet — rides the team-deployment field report collected by the origi…
```

The code that decides (`.kaif/kaif-core.mjs`, cmdReport, 2.5):

```js
const lineRe = /^\*\*Delivered upstream:\*\*[^\n]*$/m;
const deliveredLine = (text.match(lineRe) || [])[0];
…
const already = deliveredLine.match(/https?:\/\/\S+/);
if (already) { log(`✔ already delivered: …`); return; }
if (!/NOT YET/.test(deliveredLine)) die(`the Delivered upstream line is neither NOT YET nor a URL: "${deliveredLine.trim()}"`);
```

## Repro (deterministic)

1. In any `tracking: origin` deployment, write a ticket whose line reads
   `**Delivered upstream:** not yet — awaiting the field report` (lowercase, as three field tickets did).
2. `node .kaif/kaif-core.mjs report <ticket> --dry-run` → `✖ the Delivered upstream line is neither NOT YET
   nor a URL`, exit 1. Nothing tells the agent that `NOT YET` in capitals is the only accepted spelling.
3. Write a delivered-by-hand line `**Delivered upstream:** ✅ sent 2026-08-30 — origin #37` (no `https://`)
   → the same refusal, although the ticket is delivered; the idempotency branch never fires.

## Cost and violated invariant

Severity S3 on this pass (minutes; caught inside a `--dry-run`). The risk is the next agent, not this one: the
refusal says what the line is NOT and never what it must BE, so a weaker session either concludes "not a
ticket" and leaves a real defect undelivered, or "repairs" a delivered-by-hand line to `NOT YET` and sends a
duplicate of an issue that already exists. Invariants: **autonomy** (the delivery step was mechanized so
that no reasoning stands between a ticket and its issue; a refusal without the fix re-opens that
reasoning) and **honest-green** (a delivered ticket reads as undeliverable).

## What in KAIF led to this

The contract line was introduced in 2.5 while the field already held tickets written under three earlier
templates; the parser tests `/NOT YET/` case-sensitively, reads ONE physical line (`[^\n]*$`) in a canon
that wraps prose at 100 columns, and recognizes delivery only by a full `https?://` URL. No update-task
item lists the pre-2.5 tickets whose line matches neither form (the `stale-claims` item scans version
claims, not contract lines).

Smallest fix, by cost: (1) `/not yet/i`; (2) treat `#\d+` on the line — or the first origin issue URL
anywhere in the ticket — as "already delivered"; (3) the refusal names both legal forms and the exact edit
(*"write `NOT YET` or the issue URL on this line"*); (4) optional: on a version change the update task lists
`bugs/KAIF/*` files whose contract line matches neither form, the way `stale-claims` lists version lines.

## Local remediation (per the "defect in KAIF itself" contour, if applied)

None in the machinery. Locally: tickets 10–12 are fixed in 2.5 (10 observed on this pass — the bootstrap
route's task carries no quote-only `placeholders` locations; 11–12 per the release notes) and their DONE
closure is a `/check-backlog` follow-up; ticket 16 keeps its prose line (delivered, #37). This ticket is
itself delivered by the command under test — `node .kaif/kaif-core.mjs report bugs/KAIF/17_*.md` — as the
field exercise of the 2.5 delivery path (report: `reports/KAIF_UPDATES/KAGO_KAIF_2.5_UPDATE_REPORT.md`).
