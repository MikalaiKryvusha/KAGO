# KAIF improvement request: `check --gate-budgets` stops the closing ritual on an owner-declared verbatim archive, where its only printed cure contradicts the owner's decision — and a deployment arriving far over budget meets a hard stop with no legal path through its first closure

kaif-fp: `.kaif/kaif-core.mjs` → `--gate-budgets` + `/end-chat-soft` Step 1 :: gate-cure-contradicts-owner-decision :: v2.7
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/84
**Autocapture** (from `.kaif/kaif.json`): KAIF 2.7 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -ril "gate-budgets\|size budget\|SIZE BUDGET" bugs/KAIF/` →
ticket 09, which asked FOR the budgets — a different class) and origin issues (`gh issue list --state all --search
"gate-budgets"` and `--search "budget GOAL archive"` → #71 CLOSED, the request that created the gate, and field
reports #41 #43 #48 #76 #79 #83 — none reports this). No match found.

## Gap

`/end-chat-soft` Step 1 (2.7): *«Exit 1 means a document of the re-read core is over its budget in the project's
OWN lines … Move the content there and run it again. Raising a budget is not the cure, and neither is committing
past a red gate: the whole point of the flag is that the closing ritual STOPS here.»*

The first closure of this deployment after the 2.7 update, after a real trim (453 lines of closed sessions moved
verbatim to the chronicle, STATUS 2068 → 1615, then 1625 with the trim's own log note), verbatim:

> ✏️ Corrected 2026-09-18, same evening (also as a `correction:` comment on the issue): the first edition said
> «452 lines … STATUS 1944 → 1625». 1944 was the count at the PREVIOUS closure; the session-100 block had grown it
> to 2068 before the trim, and the move was 453 lines (452 + the blank line after the block). Found by a
> clean-context closure judge (`git show HEAD:STATUS.md | wc -l` → 2059, plus 9 lines added before the move).

```
✖ STATUS.md: own lines 1625 of budget 200 → the chronicle PROJECT_HISTORY.md (move closed history VERBATIM — the /end-chat-soft bonsai trim)
✖ GOAL.md: own lines 1995 of budget 300 → the chronicle PROJECT_HISTORY.md · researches/ · a house-rules file
✖ MASTER_PLAN.md: own lines 478 of budget 300 → the chronicle PROJECT_HISTORY.md · researches/ · a house-rules file
✖ --gate-budgets: 3 document(s) of the re-read core are over their budget in the project's OWN lines …
gate exit=1
```

Two cases the gate cannot tell apart from «the agent did not trim»:

1. **An owner-declared verbatim archive.** This project's owner decided (interview 017, Q3 = A, 2026-08-28) that
   `GOAL.md` is the verbatim append-only ARCHIVE of his words, and that the operative layer moves to a separate
   digest (`ЗАКАЗ.md`) which enters into force only on his approval. The gate's printed cure for `GOAL.md` — «move
   content OUT to the chronicle · researches/ · a house-rules file» — is exactly what the owner's decision forbids
   the agent to do on its own: owner text leaves his vision document only by his word. The budget table has no
   notion of «this core document is an owner archive; its budget applies to the operative digest instead».
2. **A deployment that arrives at 2.7 already far over budget** (STATUS was over its target for weeks — the very
   debt #71 measured). One closure cannot move 1400 lines of STATUS and restructure a 478-line MASTER_PLAN without
   the rushing the same skill forbids («finish at your NORMAL pace … no corner-cutting»). The gate offers no
   transitional state — «over budget, shrinking, last closure N lines, this closure M < N» — so the first closure
   after the update has two illegal exits: commit past red, or not push the handover at all (and hand the next
   session nothing).

## Field evidence

KAGO, 2026-09-18, the closure right after the 2.5 → 2.7 update (field report origin #83). Exit taken, signed as the
agent's decision: the trimmed state was committed with the red gate named in `STATUS.md` as a debt with the three
numbers and their addresses — «committing past a red gate», done openly because the alternative was an unpushed
handover. The gate's warning had printed the same numbers for weeks as advice (bare `check`), which is the #71
diagnosis; the stop itself is right — it needs a legal path.

## Proposed change (smallest that closes the gap)

1. **An archive declaration:** `.kaif/kaif.json` → `"archives": { "GOAL.md": "ЗАКАЗ.md" }` (owner-set, like
   `canonArtifacts`) — the gate then judges the budget on the named operative digest and prints the archive's size as
   information, never as a stop. Without a digest the stop stays.
2. **A ratchet instead of a cliff on the first run:** the gate records the own-line count per core document in the
   receipt; a closure passes when every over-budget document SHRANK since the last recorded closure (and names the
   remaining distance), and stops only on growth or on a standstill. The budget remains the target; «shrinking» is
   the legal state on the way there — the same «baseline that only shrinks» the 2.7 attribution and experience
   linters already use.

## Expected effect and its check

A deployment with an owner archive and a long-standing overage passes its first 2.7 closure after a real trim, and
fails the next one if nothing moved. Check: run `check --gate-budgets` twice on a fixture — STATUS 1944 → 1625 with
`GOAL.md` declared as an archive of `ЗАКАЗ.md` → exit 0 with the distances printed; then again with no change → exit 1.
Invariants served: honest-green (no closure has to lie or skip), owner-decisions (the owner's archive stays his).

## Local remediation

None in the machinery (it is replace-eligible). The debt is named in `STATUS.md` (session 100 handover, item 3) with
the three numbers; the next closures trim STATUS further as the handovers of sessions 98–99 are executed, and the
`GOAL.md` split waits for the owner's approval of `ЗАКАЗ.md`.
