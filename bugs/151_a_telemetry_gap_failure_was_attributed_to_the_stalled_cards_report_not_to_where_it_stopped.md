# Bug 151 — a telemetry-gap failure was attributed to the stalled card's report, not to the frequency where the GPU stopped

**Status:** 🔧 fix pending verification · **Severity:** S2 (a check lost; the next one would have been lost on the same rows)
**Version/build:** `mode-validate.mjs` after `bugs/149` (19a91fa…9215b53), driver 617.42 · **When/context:** 2026-10-17 20:04,
session 111, `plans/108` Ш1 — the first ❄️ Silent Cold check (curve `4215c7`, 250 W, cap 2797 MHz), check seq 30
**Fixing:** this session

## Symptom

The check FAILED at 20:04:52 (driver reset under Q2RTX, 18 × `nvlddmkm`). The earliest failure was the class `telemetry-gap`
(the sampler silent 4131 ms), and the instrument floored **2805 MHz @ 860 mV** alone — the clock a STALLED card reports above
the mode's own cap. The frequencies the card was actually serving under load (2722…2745 MHz) were not floored, so the next step
would raise 2805 and run straight into the same failure.

## Repro (deterministic, offline)

`runs/validate/2026-10-17T20-03-18/mon.jsonl` + snapshot `2026-10-17T20-03-18`; journal seq 30 `failureAt` = `{2805…2805, by: window}`.

## Forensics (500-ms sampler)

```
20:04:48.615  2737 MHz  225.7 W  util 100   ← last healthy
20:04:49.107  2797 MHz   58.5 W  util 100   ← collapse: busy at 0.26 of the power — the stall onset (bugs/117 signature)
20:04:49.6 … 52.111  2805 MHz  57 W  util 100  (stalled report, temperature falling 57 → 52 °C)
20:04:52.111 → 20:04:56.242  sampler silent 4131 ms  ← the failure moment the instrument used
17:04:52Z nvlddmkm 153 ×5 → 14 → 153 …  (the voice; sorted after the gap moment by milliseconds)
```

## Root cause

`attributeFailure` took the stall onset (`bugs/149`) only for class `driver-voice`. `telemetry-gap` kept «the 2 s before the
sampler's own gap moment» — but the sampler stalls when the OS starts TDR recovery, i.e. AFTER the GPU stopped (the same TdrDelay
lag `bugs/149` paid for). `bugs/149` §Twins named this class and judged it unaffected — wrong: the gap is the alarm too, not the fire.

## Fix

- `attributeFailure`: `telemetry-gap` takes the stall onset too (`stallFailureSpan`, one rule for both classes): onset seen →
  span last healthy sample → failing moment (`by: 'stall-onset'`); none → the plain window as before (`by: 'window'`).
- A floor already written from the old rule is corrected by a journal CORRECTION line (`writeCheckCorrection`, the check's twin of
  `sweep-journal.writeCorrection`, promised in `checkFailureFloors`' header): it may only ADD floor points (⊇ the old ones — a
  failure is never descended through again, `ЗАКАЗ.md` §3); `checkFailureFloors` reads the last correction of a seq.
- `npm run validate -- --reattribute <seq> [--write]` recomputes a failed check's `failureAt` from its own telemetry and snapshot by
  today's rule and (with `--write`) appends the correction.

## Guard

Selftest block «МОЛЧАНИЕ СЭМПЛЕРА: СБОЙ ПРИПИСАН МОМЕНТУ ОСТАНОВКИ…» on the 20:04 numbers; block «ПОПРАВКА ЖУРНАЛА ПРОВЕРОК…»;
mutations named in the suite header (MT4, MT5, MT6).

## Decisions made without the owner

- `[AI]` the correction may only add points (the ratchet's direction) — removing the wrong 2805 floor would need the owner's word.

## Links

`bugs/149` (the driver-voice face) · `bugs/117` (the power-collapse signature) · `plans/108` · `researches/41`
