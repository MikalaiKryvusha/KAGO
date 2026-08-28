# KAGO — /team-deployment field report (KAIF 2.4's version-defining skill, first deployment here)

> **Created:** 2026-08-28 · **Parent:** owner's order (chat: "разверни для проекта команду
> ИИ-агентов новым навыком /team-deployment из KAIF 2.4 — полным циклом, без срезания шагов") ·
> **Status:** operations 1–3 done; the first dispatch round waits for the owner to open the role
> windows (§9: launch is the owner's single line per window) · **Outbound:** this report +
> `bugs/KAIF/11`, `bugs/KAIF/12` → origin, for the 2.5 scope.

## 1. Chronology with numbers

- **Op 1 — analyze:** profile note written as `plans/54` (ru — the owner decides on it). Profile
  in one line: hardware-lab project, ONE GPU that is the subject under test, moratorium
  (интервью 017 Q1) caps parallel machinery, live edge runs only with the owner present (Q4),
  weeks of genuinely device-free backlog exist.
- **Op 2 — suggest:** archetype web-product-small adapted to a "gpu-lab" shape; **3 seats**
  (manager folding architect and holding the only card authority · engineer restricted to
  offline machinery · qa-verifier), 4-seat and 2-seat variants offered with honest
  anti-recommendation on the 4th seat; price line attached (интервью 017 Q5 = A). **Owner
  approved "3 места" in chat 2026-08-28** (same answer ratified both 2.4 policy changes).
- **Op 3 — deploy:** `TEAM_CONSTITUTION.md` (nine invariants kept + a project-specific §0 card
  rule ABOVE them) · `TEAM_STATUS.md` (3 rows, 3 singleton locks) · `tools/team-board.mjs`
  (7 selftest blocks) · `tools/team-workplace.mjs` (5 blocks) · both suites entered the battery
  WITH their code: **31 sets / 1433 green / 0 red, 17.2 s** · two worktrees live at `b85726a`:
  `KAGO-team-engineer`, `KAGO-team-verifier` (`npm run workplace -- list` shows all three seats
  on one commit) · role briefings prepared (plans/54 §7).
- **Broken-case proofs, live (not just sandboxed):** from the engineer worktree — foreign-row
  edit REFUSED, `gpu-card` lock REFUSED (manager-only, §0), own row landed in the ONE board of
  the main copy; from the verifier worktree — `dashboard-port` taken with the holder's address
  on the row; foreign unlock REFUSED naming the holder; holder unlock and the manager's
  `--role` override both passed. Exit codes checked on every refusal (all 1).

## 2. Where the skill led by hand vs where invention was required

**Led by hand (most of the way):** the operation order with the owner gate exactly where the
owner wanted it · the sizing heuristics and anti-pattern list killed the 4th seat with a named
reason instead of taste · the nine constitution invariants and the board contract were adopted
verbatim-with-parameters · the paid-for field lessons (fresh main before resume; NEW_ numbering;
undelivered-message rule) went in untouched — nothing in the project contradicted them · the
board tool contract was implementable as written, item by item, including "proven on a broken
case".

**Invented locally (the honest list):**
1. **§0 — the card rule.** The templates have no concept of a physical singleton UNDER TEST;
   KAGO's central resource demanded a rule above all nine sections plus a manager-only refusal
   in the board tool. → `bugs/KAIF/12` (archetype gap).
2. **`deriveRole('KAGO') → manager`.** The naming invariant as stated locks the manager out of
   his own board; the exception lives only in the template's example table. → `bugs/KAIF/11`.
3. **The verifier-vs-singleton tension:** independence says "re-execute claims", the card says
   "one seat only" — resolved as "verify device claims from journals, never re-touch"; no
   template names this.
4. **Workspace parent directory:** the template says `<workspaces dir>` without a default; chose
   siblings of the main copy (`d:\work\ai_sandbox\KAGO-team-<role>`) so the owner tells windows
   apart by directory name alone.

## 3. What was unclear

- Whether "Manager gets no worktree" extends to his BRANCH: §1's table says branch `main`, §5
  says roles work in role branches — for the manager these meet only via the §1 example. Wrote
  the KAGO constitution to the example (manager = main copy = `main`).
- The board template's "project's canonical moment format" — KAGO had none canonized for boards;
  chose `YYYY-MM-DD HH:MM` and wrote it INTO the board contract so the next session does not
  re-choose.
- "First dispatch round completed" sits in *Done when*, but launch (§9) belongs to the owner —
  on a deployment ordered while the owner is not opening windows, the last done-item is
  structurally unreachable in-session. Reported honestly as "waiting for windows" rather than
  simulated.

## 4. Which templates were bent, and did the board and naming work

**Bent:** constitution — §0 added above the invariants, manager contract extended with card
authority, engineer contract zone defined NEGATIVELY (never the card/journal/curve document);
roles library — archetype adapted from web-product-small (see `bugs/KAIF/12`); board template —
`gpu-card` lock given a role-refusal semantics the contract did not foresee (locks in the
template gate concurrency, not AUTHORITY — KAGO needed both on one row).

**Board:** worked, and the "one board" resolution via `git rev-parse --git-common-dir` held on
the first try from both worktrees — the engineer's write from its own directory landed in the
main copy's file with no path configuration at all. **Naming:** the `KAGO-team-<role>` pattern
held everywhere a directory exists; its one soft spot is the manager seat (`bugs/KAIF/11`).

## 5. Final state and the judge line

Three seats materialized on `b85726a`; constitution and board in the project root; tools proven
green in sandbox (7 + 5 blocks) AND on live broken cases; battery **31/0/1433**; encoding guard
green over 442 text files. Judge pass over the deployment's claims: every claim above was
re-executed in this session (each refusal's exit code read, the board file's change observed in
the main copy, `worktree list` read back) — **СВЕРЕНО**, with one open item named honestly: the
first dispatch round runs when the owner opens the two windows and each gets its briefing from
plans/54 §7.

## Сигналы в исток (signals to origin)

1. `bugs/KAIF/11` — the naming invariant's manager exception must be stated in §1's text, not
   implied by its example; one sentence closes it.
2. `bugs/KAIF/12` — add a `hardware-lab-small` archetype (device singleton as a first-class
   sizing axis; device-free engineer; journal-based verifier). KAGO's §0 + `gpu-card` lock are
   donor material.
3. Positive: the board tool contract is the best-written contract this project has received from
   KAIF — all six invariants were implementable without interpretation, and the
   `--git-common-dir` hint saved the exact private-board failure it warns about.
4. Positive: the owner-gate placement in operation 2 matched the owner's own order word for word
   («ничего не разворачивай до моего "да"») — the skill's shape let the agent obey it without
   tension.
5. Wording nit: *Done when* includes "first dispatch round completed", which cannot complete
   inside a deployment session the owner runs headless; consider marking it "at first launch"
   the way §9 already frames the owner's role.
