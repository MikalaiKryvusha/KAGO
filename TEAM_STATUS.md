# TEAM_STATUS — KAGO team status board

> Generated 2026-08-28 by `/team-deployment` (KAIF 2.4), one row per seat of the approved design
> (plans/54). Rules — the team's constitution (`TEAM_CONSTITUTION.md` § 4); this file carries the
> board itself, its form rules, and the CONTRACT the board tool (`tools/team-board.mjs`,
> `npm run team`) implements.
>
> The board is the state IN THE MOMENT — transparent to the whole team so agents do not
> interrupt each other, respect each other's busyness, and can see where help is needed.
> The project's `STATUS.md` still carries the baton between sessions; the board never replaces it.

## Board

| Role | State | Doing | Waiting for | Updated |
|---|---|---|---|---|
| manager | 🟢 free | — | — | 2026-08-28 14:30 |
| engineer | 🟢 free | — | — | 2026-08-28 14:22 |
| verifier | 🟢 free | — | — | 2026-08-28 14:30 |

*(States: 🟢 free · 🔴 busy. "Doing" — one short line: what and on whose assignment. "Waiting
for" — who/what blocks, or "—". "Updated" — `YYYY-MM-DD HH:MM`, stamped by the tool from the
system clock.)*

## Resource locks

| Resource | Holder | Taken |
|---|---|---|
| gpu-card | — free — | — |
| dashboard-port | — free — | — |
| presentmon-etw | — free — | — |

*(The singletons of constitution § 7. Take → run → release; holding "just in case" is forbidden.
`gpu-card` is Manager-only by § 0 — the tool refuses it to other roles outright.)*

## Form rules (from the owner's field order — keep them)

- **Statuses are short; the document never grows** — rows are REWRITTEN, never appended.
- Update your row at EVERY state change: took a task · waiting on someone · freed.
- Successes and difficulties are legal status content — that is how neighbors see where to help.
- Reading the board before messaging someone is part of the communication regimen (constitution
  § 2 rule 4).

## Board tool — the contract (implemented by `tools/team-board.mjs`)

KAIF fixes the invariants; the implementation is the project's, in the project's stack
(dependency-free Node.js). The tool holds:

1. **One board per team.** The board lives in the main copy; the tool invoked from ANY workspace
   finds the one true board by resolving the common git directory (`git rev-parse
   --git-common-dir`), never the local checkout.
2. **The caller's role is DERIVED from the working directory** (naming invariant, constitution
   § 1: `KAGO-team-<role>`; the main copy is the manager), never passed as a claim. The tool
   edits ONLY the caller's row and refuses foreign rows; clearing a vanished role's stale row is
   a Manager-only override (`--role <r>`, explicit).
3. **Concurrent writes are safe:** a lock file next to the board (create-exclusive with retries;
   a lock older than 15 s counts as abandoned), writes atomic (temp file + rename).
4. **Lock rows name the holder's role address** — the reader must see WHO holds the resource.
   `gpu-card` is refused to any caller but the manager (constitution § 0).
5. **Stamps `YYYY-MM-DD HH:MM`** are taken from the system clock by the tool itself — never
   remembered by the session.
6. **Proven on a broken case before trusted** (testing canon): a foreign-row edit is refused; an
   abandoned lock is recovered; two concurrent writers do not corrupt the table; `gpu-card` from
   a non-manager seat is refused — all in `npm run team -- --selftest` (sandboxed, zero GPU).

Command surface:

```
npm run team -- show                                      # print the board
npm run team -- set [--busy|--free] [--doing "…"] [--waiting "…"]   # my row only
npm run team -- lock <resource> | unlock <resource>       # singleton locks
npm run team -- set --role <r> --free                     # Manager-only: clear a stale row
npm run team -- --selftest                                # sandboxed proof, no GPU, no board
```
