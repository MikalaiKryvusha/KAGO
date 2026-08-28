# TEAM_STATUS — <team name> status board

> Template from the KAIF `team-deployment` skill. Copy to the project root of the MAIN copy as
> `TEAM_STATUS.md`, one row per seat of the approved design. Rules — the team's constitution
> (`TEAM_CONSTITUTION.md` § 4); this file carries the board itself, its form rules, and the
> CONTRACT for the board tool the project's agent builds.
>
> The board is the state IN THE MOMENT — transparent to the whole team so agents do not
> interrupt each other, respect each other's busyness, and can see where help is needed.
> The project's `STATUS.md` still carries the baton between sessions; the board never replaces it.

## Board

| Role | State | Doing | Waiting for | Updated |
|---|---|---|---|---|
| manager | 🟢 free | — | — | <stamp> |
| <role> | 🟢 free | — | — | <stamp> |

*(States: 🟢 free · 🔴 busy. "Doing" — one short line: what and on whose assignment. "Waiting
for" — who/what blocks, or "—". "Updated" — the project's canonical moment stamp.)*

## Resource locks

| Resource | Holder | Taken |
|---|---|---|
| <singleton resource 1 of N> | — free — | — |

*(one row per singleton the constitution names in § 7: test stand, emulators, port-bound
previews… Take → run → release; holding "just in case" is forbidden.)*

## Form rules (from the owner's field order — keep them)

- **Statuses are short; the document never grows** — rows are REWRITTEN, never appended.
- Update your row at EVERY state change: took a task · waiting on someone · freed.
- Successes and difficulties are legal status content — that is how neighbors see where to help.
- Reading the board before messaging someone is part of the communication regimen (constitution
  § 2 rule 4).

## Board tool — the contract (the project's agent builds it)

KAIF fixes the invariants; the implementation belongs to the project's agent, in the project's
stack. Reference implementation in the origin field project: ~500 lines of dependency-free
Node.js. The tool MUST hold:

1. **One board per team.** The board lives in the main copy; the tool invoked from ANY workspace
   finds the one true board (for git worktrees: resolve the common git directory — e.g.
   `git rev-parse --git-common-dir` — never the local checkout; a per-workspace copy would give
   every role a private board nobody reads).
2. **The caller's role is DERIVED from the working directory** (workspace naming invariant,
   constitution § 1), never passed as a claim. The tool edits ONLY the caller's row and refuses
   foreign rows; clearing a vanished role's stale row is a Manager-only override, explicit flag.
3. **Concurrent writes are safe:** a lock file next to the board (create-exclusive with retries;
   a lock older than a named timeout counts as abandoned), writes atomic (temp file + rename).
4. **Lock rows name the holder with its address** where the resource maps to per-role parameters
   (ports, slots): the reader must see WHOSE ports occupy the place — capacity rows (places) and
   role addresses (slots) are different things; conflating them was a paid-for field bug.
5. **Stamps use the project's canonical moment format**, taken from the system clock by the tool
   itself — never remembered by the session.
6. **Proven on a broken case before trusted** (project testing canon): a foreign-row edit is
   refused; an abandoned lock is recovered; two concurrent writers do not corrupt the table.

Suggested command surface (adapt names to the project):

```
<board-tool> set [--busy|--free] [--doing "…"] [--waiting "…"]   # my row only
<board-tool> lock <resource> | unlock <resource>                  # singleton locks
<board-tool> show                                                 # print the board
<board-tool> set --role <r> …                                     # Manager-only: clear a stale row
```
