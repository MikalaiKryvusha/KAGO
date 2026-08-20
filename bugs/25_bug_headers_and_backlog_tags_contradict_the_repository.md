# Bug 25 — bug headers, DONE tags and the STATUS bug list contradict the repository: the project holds TWO diverging truths about what is open

**Status:** 🔴 OPEN — found by the 2026-08-21 audit (`ideas/08`)
**Version/build:** `main` @ `3d0a9ac`
**When/context:** 2026-08-21, audit pass over `bugs/*` headers vs STATUS session blocks vs
commit history. Documentation defect — no code, no card.

## Symptom

The canon says a document's own header is its truth (`AGENT_GUIDE.md` checklist step 18: after
implementing, «write the status and the implementation date back into it»; `/check-backlog`:
DONE work is renamed `git mv` + status section appended). Measured against that rule:

| file | its own header says | reality (STATUS blocks + commits) |
|---|---|---|
| `bugs/12` | «🔴 ОТКРЫТ — чинится в этой же сессии» | fixed `02c4bcd`, six mutations; two named tails remain |
| `bugs/14` | «🔴 ОТКРЫТ — три дефекта» | fixed in sessions 28–29 (STATUS lists all three as closed) |
| `bugs/17` | «🔴 OPEN · МАКСИМАЛЬНЫЙ ПРИОРИТЕТ» | closed by mechanism (Stop hook → `tools/tidy.mjs`), STATUS session 29 |
| `bugs/18` | «🔴 OPEN» | fixed `2fac685`, 5 blocks, 4 mutations (STATUS: ✅) |
| `bugs/20` | «🔴 OPEN» | fixed `901a123` («fix(bugs/20): своя смерть писателя больше не приписывается карте») |
| `bugs/13` | «✅ ЗАКРЫТ в тот же час» | closed but never renamed `13_DONE_…` |
| `bugs/15` | «✅ DONE (2026-08-16 13:2x)» | closed but never renamed `15_DONE_…` |

Adjacent faces of the same rot, found by the same pass:

- **`STATUS.md` → «Открытые баги»** still lists `bugs/20` as 🔴 open and describes the fix as
  future («Чинится закрытием намерения…») although the fix is committed; the section disagrees
  with the session-32 block a few hundred lines above it in the same file.
- **`PROJECT_ARCHITECTURE_INTERNAL_MAP.md` header** says «Updated: 2026-08-09» and «the
  orchestrator is designed, not yet written» — while rules R14–R18 in the same file are dated
  2026-08-15…17 and the orchestrator has 30+ modules on disk. The body is maintained; the
  header lies about it.
- Closed plans not DONE-tagged: `plans/15` (phase 2 — judged closed 2026-08-16), `plans/17`,
  `plans/18` (epic 03 phases 1–2, epic closed whole).

## Why it matters — this is not pedantry

1. **The backlog is computed from these signals.** `/check-backlog` and `/resume` treat a
   non-DONE filename and an OPEN header as work. A fresh session (or an autonomous loop
   grinding the backlog) picks up `bugs/17` «МАКСИМАЛЬНЫЙ ПРИОРИТЕТ» and re-fixes a fixed
   defect — the owner pays for the same work twice.
2. **Two truths is the drift-pair shape the canon itself bans** (`AGENT_GUIDE.md` — a prose
   changelog in a header is «an unlintable drift pair»). Here the pair is
   «STATUS session block ↔ bug header», and it has already diverged in seven files.
3. It hides real state: the audit had to consult commit history to learn what is actually open
   — exactly the archaeology STATUS exists to make unnecessary.

## Root cause

Sessions close under time pressure at the STATUS level (the session block is meticulously
written) but the per-document write-back — the LAST step of the bug framework — is skipped.
No gate checks the agreement: nothing red ever appears when a bug is fixed and its header is
not. `/check-backlog` exists and would have caught most of this, but it has not been run since
the rot began (its own trigger is «periodically in autonomous loops» — and recent sessions
were all interactive).

## Fix plan

1. One `/check-backlog` pass: for each row of the table above — verify against the code/commits
   (not against STATUS alone), append the status section, update the header, `git mv` to
   `NN_DONE_…` where truly done. Bugs with named open tails (`12`, `21`, `18` live-proof
   pending) stay open but their headers must SAY the current truth.
2. Refresh `STATUS.md` → «Открытые баги» from the corrected headers.
3. Fix the internal map header (Updated date + drop the «not yet written» caveat).
4. Follow-up (named, not done here): a cheap agreement check — the `/fable-judge` or a lint
   step that greps `bugs/*` non-DONE headers for «✅|DONE» and DONE-files for «OPEN», so the
   two truths cannot drift silently again.

## Verification by observation

`ls bugs/ plans/` matches the audited reality; a grep for `✅` in non-DONE filenames returns
only files whose open tails are named in the header.
