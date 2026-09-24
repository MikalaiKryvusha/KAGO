# KAIF bug: the shipped contour's `--queue --list` dies with a `TypeError` when `queue.json` in the decisions dir holds another shape (a project-built contour's `{ "items": [...] }`) — `/resume` step 1b's exit condition then has no working command

kaif-fp: `.kaif/tools/contour/review.mjs` → `readQueue` / `listQueue` + `/resume` Step 1b :: queue-reader-crashes-on-foreign-shape :: v2.7
**Delivered upstream:** https://github.com/MikalaiKryvusha/KAIF/issues/100
**Autocapture** (from `.kaif/kaif.json`): KAIF 2.7 · project KAGO · sphere `programming` · language `ru` ·
tracking `origin` · agent system claude-code (+4 mirrored) · OS Windows 11 Pro 10.0.26200 · Node v24.15.0
**Dedup attestation:** searched `bugs/KAIF/` (`grep -rln "queue.json\|readQueue\|--queue" bugs/KAIF/` → 0 hits) and
origin issues (`gh issue list -R MikalaiKryvusha/KAIF --state all --search "readQueue"` and `--search "queue.json"` →
0 hits). No match found.
**Severity:** S2 by this project's ladder — nothing lost; the cost is a `/resume` whose owner-queue step cannot run
its own command and has to be done by hand.

## Expected per canon

`/resume` Step 1b: *«run the queue command of the project's interactive contour (the one `/owner-reviews` built —
e.g. `node tools/review.mjs --queue --list`, no browser) and read what it prints … The step is not complete while a
waiting document reads `NEVER SHOWN`»*. The shipped contour is expected either to list the queue or to say plainly
why it cannot.

## Got in the field

This deployment built its OWN contour before the shipped one existed (`tools/review.mjs`, 2026-08-09+). It keeps
`interviews/decisions/queue.json` in its own shape — an object `{ "items": [ { "file", "title", "awaiting",
"lastShownAt" } ] }`. The shipped contour uses the SAME file name in the SAME decisions dir (`QUEUE_FILE =
'queue.json'`, `cfg.decisionsDir`) and expects an ARRAY. On 2026-09-25 01:00 +03:00:

```
$ node .kaif/tools/contour/review.mjs --queue --list
TypeError: readQueue(...).filter is not a function
    at pendingDocs (.kaif/tools/contour/review.mjs:242:46)
    at ownerDocs (.kaif/tools/contour/review.mjs:280:16)
    at listQueue (.kaif/tools/contour/review.mjs:324:16)
```

The project's own `tools/review.mjs` has no `--queue` flag (`ОШИБКА: неизвестный флаг: --queue`), so the example
command in Step 1b does not exist here either. The step was done by hand (a one-line `node -e` over `queue.json`).

## Repro (deterministic)

1. In any deployment: `echo '{"items":[]}' > <decisionsDir>/queue.json`.
2. `node .kaif/tools/contour/review.mjs --queue --list` → the `TypeError` above, exit 1.

## Cost and violated invariant

A reader that crashes on a file it did not write turns a queue question («is anything waiting that the owner never
saw?») into a stack trace. The canon's promise «the queue command has an EXIT CONDITION» holds only while the command
runs; here the exit condition was satisfiable only by hand.

## What in KAIF led to this

`readJsonOr(path, [])` returns whatever JSON is in the file; `readQueue` trusts it to be an array. The file name
`queue.json` is generic and collides with a project-built contour that predates the shipped one — exactly the
deployments `/owner-reviews` says «the project's agent builds the tools».

## Proposed fix (smallest)

`readQueue`: if the parsed value is not an array, print one line naming the file and its shape
(`queue.json is not a shipped-contour queue (found an object with keys: items) — the project keeps its own queue;
list it with the project's contour`) and treat the queue as foreign, never crash. Optionally accept `{ items: [...] }`
by mapping `file → doc`.

## Local remediation (per the "defect in KAIF itself" contour, if applied)

None in the shipped file (it is framework machinery, patched by `/kaif-update`). Step 1b was executed by hand in
session 102: 4 items with `awaiting > 0`, every one with a `lastShownAt` (the oldest 2026-08-14) — none `NEVER SHOWN`.
