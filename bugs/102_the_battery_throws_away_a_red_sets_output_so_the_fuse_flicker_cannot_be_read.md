# Bug 102 — the battery reddens `fuse` and is green alone (second strike), and the runner throws the red lines away, so the flicker cannot be read

**Status:** 🟡 PARTIAL — **step 1 DONE 2026-09-04 12:1x (session 81):** `runSuite(suite, { evidenceDir })` writes a red set's full stdout+stderr to `runs/selftest/<battery ISO stamp>/<set>.log` and appends `улика: <path>` to `why`; green sets leave nothing; `runBattery` passes one dir per battery. Proof: block F in `selftest-all --selftest` (5 → **6**) — red fixture A leaves `A.log` containing «ПЛОХО два» and names it, green fixture D leaves no file; mutation «снять writeFileSync» → `ПЛОХО F … файл есть=false`, A…E stay green; `npm run check` green; `--only prayer,shrink` (green) creates no `runs/selftest/` at all. **Named debt:** the ONE line `runSuite(suite, { evidenceDir })` inside `runBattery` has no block of its own — its witness is the first red battery, whose report must carry the path (B102-AC1 half-taken until then). Steps 2–3 open (need a red to read). Filed by the rule of session 76 («если мигнёт снова — заводить») · **Filed:** 2026-09-04 12:1x (session 81, offline) · **Found:** `npm run selftest:all` at 12:07 — `КРАСНЫЙ fuse: код выхода 1 · красных строк 2`, 48 sets, 2482 green; `node automation-engine/lib/fuse.mjs --selftest` alone one minute later — **77 зелёных, 0 красных, exit 0** · **Severity: medium** — a guard suite that flickers trains the reader to ignore red; and the flicker is undiagnosable by construction (below).

⚠️ **ZERO GPU WRITES.** The fuse suite touches no card («карта не трогается, порт только эфемерный»).

---

## Symptom

| when | where | `fuse` | note |
|---|---|---|---|
| 2026-08-31 (session 75) | battery | 🔴 | first strike; session 76 reran the set alone: green 77; ticket deliberately NOT filed, rule set: «если мигнёт снова — заводить» |
| 2026-09-04 12:07 (session 81) | battery | 🔴 exit 1 · 2 red lines | second strike |
| 2026-09-04 12:09 | alone | ✅ 77/77, exit 0 | |
| 2026-09-04 12:10 | battery, rerun | ✅ 48 sets · 0 red · 2484 green | the flicker did not repeat — exactly what an undiagnosable defect looks like |

Same family as the single `dashboard` death inside a battery (STATUS, session 79 note) and the `watchdog` «red in battery, green alone» (STATUS, `plans/82` list item 6). Three suites, one symptom shape: **red only under the battery.**

## Forensics — and why there are none

`tools/selftest-all.mjs` `runSuite()` (line ~395): the set's stdout+stderr are joined, counted by `GREEN_LINE` / `RED_LINE` / `PENDING_LINE`, the summary line is looked up — and the text is **dropped**. The battery report carries the COUNT of red lines and the hint «повторить одной командой», never the lines. For a deterministic suite that is enough; for a suite that reddens only inside the battery the repeat command returns green and the only evidence that existed was in the discarded buffer. **The instrument records that a failure happened and destroys what it was** — the class of `bugs/93` («the run has no log of its own») one floor down.

What CAN be said from the shape: the `fuse` suite is timing-bound (a deadman at N = 60 ms, an ephemeral UDP port, hands spawned as processes — EXP-0165, EXP-0166); the battery runs sets **sequentially** (`spawnSync`), so intra-battery concurrency is not the variable — but the machine's load at that minute is (this session had `node -e` probes and file edits in flight), and 12:07 was minutes after a reboot with the owner's startup apps (NVIDIA Broadcast ×6, Overlay ×5) still settling. **Hypothesis, not a finding:** a 60 ms deadman block reddens when the host stalls > 60 ms for reasons unrelated to the suite. Which two lines — unknown by construction.

## Fix plan — evidence first, diagnosis second

1. **The runner keeps a red set's full output** — `runs/selftest/<battery stamp>/<set>.log`, written ONLY for sets with `ok: false` (a green battery leaves no litter; `runs/` is git-ignored). The report line gains the path. Block in `selftest-all --selftest`: a fixture suite that prints one red line → the file exists and contains it; a green fixture → no file. Mutation: drop the write → red.
2. Then rerun the battery until `fuse` reddens again and READ the two lines. Only then: is it the 60 ms deadman under host stall (→ the suite needs a load guard or a wider budget for the block, decided by the fuse's own numbers), or a port collision (→ the ephemeral port choice), or something else.
3. Close `dashboard` and `watchdog` flickers by the same file, not by three tickets.

## Acceptance

| # | criterion | scale · meter · target |
|---|---|---|
| B102-AC1 | a red set's text survives the battery | file per red set under `runs/selftest/`; meter: the fixture block; target: 1 file per red set, 0 per green |
| B102-AC2 | the flicker is DIAGNOSED, not reasoned about | the two red lines quoted in this ticket from a saved file |
| B102-AC3 | no suite is weakened to make the battery green | diff of `fuse.mjs` thresholds = 0 until AC2 names the cause |

## Decisions made without the owner

None. The ticket follows the rule session 76 wrote for itself.

## Links

STATUS (session 75 note · session 76 «мигание fuse не воспроизвелось» · session 79 `dashboard` died once in a battery · `plans/82` item 6 `watchdog`) · `bugs/93` (a run without a log) · `tools/selftest-all.mjs` `runSuite` · EXP-0165 · EXP-0166
