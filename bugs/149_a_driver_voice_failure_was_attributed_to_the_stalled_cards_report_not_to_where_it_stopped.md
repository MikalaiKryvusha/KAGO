# Bug 149 — a driver-voice failure was attributed to the stalled card's report, not to the frequency where the GPU stopped

**Status:** 🔧 fixed in code 2026-10-17 17:4x (session 110), functional run on the recorded 16:45 failure; live witness = the next
driver-voice failure inside a check · **Severity:** S2 — a floor on the wrong rows leaves the guilty frequencies down: one more
driver reset in a check or in use · **Version/build:** HEAD after `fb67b76`, driver 617.42 · **When/context:** `plans/106` Ш2, writing
the 16:45 failure of `bugs/148` into the check journal. Fixing: this session.

## Symptom

`attributeFailure` for class `driver-voice` took the first `nvlddmkm` event as the failing moment and floored the frequencies of
the 2 s before it. On the 16:45 record that window holds only **3075 MHz** — the clock a STALLED card reports — while the GPU
stopped at **3037 MHz**.

## Forensics (`runs/use/2026-10-17T16-42-56-optimised.jsonl`, 500-ms sampler; driver log)

```
16:45:13.937 3037 MHz 196 W util 75 · 14.440 3037 197 W 74 · 14.936 3037 71 W 100  ← collapse
15.435 … 17.631 3075 MHz 69–85 W util 100 (stalled)
13:45:17.0935Z nvlddmkm 153 ×2 → 14 (PF FLR) → TDR      ← the voice, 2.15–2.65 s after the collapse
```

## Root cause

Windows reports a hang only after the scheduler's preempt wait — `TdrDelay`, default 2 s (Microsoft «TDR registry keys»; no
override on this machine, registry read 2026-10-17). The voice is the alarm, not the fire. Recon: `researches/41`.

## Fix

`mode-validate.driverFailureSpan` / `stallOnset`: in [voice − TdrDelay − 2 s, voice] find the first sample busy (≥ 90 %) at
≤ `POWER_COLLAPSE_RATIO` (0.412) of an established previous power (≥ 150 W) — the archive's own stall signature (`fuse.mjs`,
`bugs/117`); span = last healthy sample → voice (`by: 'stall-onset'`). No onset seen → the window widened by TdrDelay
(`by: 'tdr-window'`), never narrower than before. Other classes untouched. `config.TDR_DELAY_MS` — one home of the number.
`parseSamples` now carries `w`/`util` when the sampler wrote them.

## Guard

Block «ГОЛОС ДРАЙВЕРА: СБОЙ ПРИПИСАН МОМЕНТУ ОСТАНОВКИ…» of `npm run validate -- --selftest` on the 16:45 numbers + a no-collapse
case + a load that ended + death unchanged. Mutations MT1 (old window) · MT2 (fallback without TdrDelay) · MT3 (no «busy» gate) —
each red on this block alone.

```
@guard driver-voice-stall-onset
THREAT:         a check's driver-voice failure floors the stalled card's report and leaves the frequency that failed down
PROVED-AGAINST: the 16:45 record's numbers in the selftest (3075 alone under the old rule → 3037…3075 now); mutations MT1–MT3
GAP:            0.412 / 150 W come from one card, driver 610.88, furnace burns; a stall without a power drop falls to the 4-s window;
                500-ms sampling brackets the onset to half a second
ON-REAL-PATH:   2026-10-17 17:4x — the real 16:45 telemetry + snapshot 2026-10-17T15-36-44 → stall-onset 3037…3075, 6 points @990
                (functional run on the recording, not inside a live check — NOT YET inside a check)
```

## Twins

`TWINS: searched the other failure classes and the journal's recorded failures` — `death` (last durable sample — no voice, no
TDR lag) and `telemetry-gap` (the sampler's own gap moment) do not take the voice as their moment; `load-died` is not attributed.
Re-attribution of all four failed checks in `runs/validate/journal.jsonl` (seq 16, 18, 19, 23) with the fixed rule: spans
unchanged — no floor in the journal was laid by this defect.

## Decisions made without the owner

- `[AI]` the stall rule over a widened window (FORK line at `attributeFailure`, `researches/41`).
- `[AI]` the death class left as it was (its moment is the last durable sample, not a report).

## Links

`bugs/148` · `plans/106` Ш2 · `researches/41` · `bugs/117` (the power-collapse signature) · `bugs/146`
