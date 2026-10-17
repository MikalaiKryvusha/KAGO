# Bug 145 — the watchdog selftest flickers red under the parallel battery: one of the fixture fire reports goes missing

**Status:** 🔴 open — found during the KAIF 2.9 update (2026-10-17); cause narrowed to two hypotheses, not yet told apart
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
