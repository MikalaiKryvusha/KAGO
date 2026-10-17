# Bug 145 — the watchdog selftest flickers red under the parallel battery: one of the fixture fire reports goes missing

**Status:** 🔧 FIX PENDING WITNESS — 2026-10-17 16:35 +03:00 (session 109): hypothesis 1 removed (unique report name), hypothesis
2 made visible (the write error is printed); DONE after several batteries without the flake (see «Fix log»)
**Severity:** S3 — a test flake, nothing shipped: the product path writes one report per real fire; the cost is a red battery line
that a later session may wave off as «flaky» or chase for an hour
**Version/build:** HEAD `524ad59` + the KAIF 2.9 hand merges (the update did not touch `automation-engine/lib/watchdog.mjs`) ·
**When/context:** `npm run selftest:all` after the KAIF 2.9 update, 2026-10-17 11:57 +03:00

## Symptom

`npm run selftest:all` → `ИТОГ: наборов 55, красных 1, зелёных блоков 2841, 89.0 с`, the red one `watchdog`; its log
(`runs/selftest/2026-10-17T08-55-57-540Z/watchdog.log:25`):

```
  ПЛОХО отчёты подставных срабатываний НЕ попали в настоящую папку — в песочнице 1, в настоящей было 30 и стало 30
```

The real folder did NOT grow (30 → 30) — the guard against fabricated evidence (EXP in `EXPERIENCE.md`, «a test that writes into
the product's real state…») holds. What fails is the other half of the predicate: `sandboxReports >= 2`
(`watchdog.mjs:686`) — the fixtures fired at least twice, one report is not in the sandbox.

## Reproduction (measured)

- alone: `node automation-engine/lib/watchdog.mjs --selftest` ×20 → red 0 of 20 (6 s);
- under load: 5 batches of 8 parallel runs → red 1 of 40, the same line, `в песочнице 1`.

## Hypotheses (not told apart yet)

1. **Same-millisecond name.** The report is written as `fired-${Date.now()}.json` (`watchdog.mjs:429`); two fixture fires
   inside one millisecond write the same name, the second overwrites the first.
2. **A swallowed write error.** The write sits in `try { … } catch { }` («a report that cannot be written must not stop a reset»);
   under load a transient `EBUSY`/`EPERM` (antivirus, indexer) would drop a report silently.

Telling them apart: log the caught error and the names written in the selftest, rerun the 40-run batch. A fix for (1) is a unique
suffix (`process.pid` + a counter); for (2) a retry or at least a logged failure — the product path wants a visible failure anyway.

## Fix log — session 109, 2026-10-17 16:3x

- **Mechanism of hypothesis 1 observed:** on this machine a file write fits inside one `Date.now()` value 1612 times of 2000 (a
  scratch loop writing a file between two `Date.now()` reads) — two fixture fires back to back share a millisecond easily.
- **Fix (1):** the report name is `fired-<ms>-<pid>-<per-process counter>.json` (`watchdog.mjs`, `fireSeq`); every reader matches
  the `fired-` prefix only (`git grep "fired-"`: lines 491, 682, 684, 759, 797 — none parses the rest of the name).
- **Visibility (2):** the swallowed write error is now printed («сторож: отчёт срабатывания НЕ записан — <code> <message>»); the
  reset still is not stopped by it.
- **Runs:** `node automation-engine/lib/watchdog.mjs --selftest` 40 times, 5 batches of 8 in parallel → red 0 of 40 (before: 1 of
  40). At a base rate of 1/40 this does NOT prove the fix — it is consistent with it. Witness for DONE: `selftest:all` batteries
  without a red `watchdog` across the next sessions; a red one now prints which hypothesis it was.
- `npm run watchdog -- --selftest` 25/0 · `npm run check` green.

TWINS: searched `\${String(nowMs())}` / `Date.now()}.json` as a file name — `git grep -n "Date.now()}\.json\|nowMs())}\.json"`.
— found 0 other sites.
