# Research 41 — when the GPU stopped versus when the driver said so: attributing a driver-voice failure to a frequency

> **Created:** 2026-10-17 (session 110, recon before deciding — the owner: «я же тебе разрешаю гуглить в любой момент,
> писать себе конспекты») · **Parent:** `plans/106` Ш2, `bugs/148`, `bugs/146` · **Status:** ✅ written 2026-10-17 17:3x;
> the decision is the FORK line in `mode-validate.attributeFailure` · **Outbound:** —

## The question

A mode check (and the record of a failure in ordinary use) attributes a failure to the frequencies the card delivered
within `FAILURE_ATTRIBUTION_WINDOW_MS` (2 s) before the failing moment, and floors those rows (plans/105 level 3). For the
`driver-voice` class the «failing moment» was taken to be the first `nvlddmkm` event. Is it?

## What the sources say

1. **TDR timing (Microsoft, «TDR registry keys»,
   https://learn.microsoft.com/en-us/windows-hardware/drivers/display/tdr-registry-keys):** `TdrDelay` is the number of
   seconds the GPU may delay the scheduler's preempt request — the effective timeout — default **2 s**; `TdrLevel` default
   3 = recover on timeout. Recovery (and the driver's report) begins only AFTER that wait expires. So the driver's voice
   comes **≥ TdrDelay after** the GPU stopped answering. This machine: no `TdrDelay`/`TdrLevel` value under
   `HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers` (read 2026-10-17) → defaults hold.
2. **What a wedged GPU looks like in telemetry (netdata, «Xid 43 GPU stopped processing», «GPU utilization misleading»,
   https://www.netdata.cloud/guides/nvidia-gpu/nvidia-gpu-xid-43-gpu-stopped-processing/):** utilization is «at least
   one kernel was running in the window», so a stuck kernel pins it at 100 %; the stuck engine shows a flat, stale picture —
   power flat, nothing moving. Utilization alone cannot tell a hang from heavy work; power against the card's own recent
   level can.
3. **This project's own archive (`fuse.mjs` → `POWER_COLLAPSE_RATIO = 0.412`, `tools/power-collapse-floor.mjs`,
   `bugs/117`):** «100 % busy at a fraction of the power drawn moments before» separated 7 deaths of 7 from 166 burns,
   0 false; derived on 610.88 and the `furnace` shape (its own GAP line says so).

## The observation that raised it (17.10 16:45, `runs/use/2026-10-17T16-42-56-optimised.jsonl`, 500-ms sampler)

| time | MHz | W | util |
|---|---|---|---|
| 16:45:12.935 | 2857 | 81 | 24 |
| 13.438 | 2940 | 82 | 34 |
| 13.937 | 3037 | 196 | 75 |
| 14.440 | 3037 | 197 | 74 |
| **14.936** | 3037 | **71** | **100** ← collapse (0.36 of 197) |
| 15.435 … 17.631 | 3075 | 69–85 | 100 |
| **17.094** | — | — | first `nvlddmkm 153` (2.15–2.65 s after the collapse) |

The 2-s window before the voice holds only 3075 (the stalled card's report) — the instrument as it stood floored 3075
alone; 3037, where the card was when it stopped, got nothing. A window widened by TdrDelay (4 s) holds 2940…3075 — the
healthy ramp samples join it.

## Reflection — two halves

**Why this practice is best.** It reads the event where it happens: Windows itself defines the report as «after the
wait expired», and the stalled engine's signature (busy, no power) is what both the industry's hang diagnosis and this
project's own death archive use. Taking the voice as the moment is reading the alarm clock instead of the fire.

**How it serves THIS project.** The owner's order is precision to the frequency (`ЗАКАЗ.md` §10; «точечно», 17.10). A
floor on the stalled card's report (3075) leaves the guilty rows down — the next use or check resets the driver again;
a floor on the whole 4-s window raises innocent rows and costs depth the bisection can never win back (the ratchet does
not descend through a floor). The stall onset gives the narrowest honest span: from the last healthy sample to the voice.

## Decision (recorded at the code as a FORK line)

`driver-voice` class: find the collapse in [voice − TdrDelay − window, voice] (util ≥ 90 %, power ≤ 0.412 of the previous
sample with that sample ≥ 150 W — the archive's own gates); the span is the last healthy sample before it through the
voice. No collapse found → the envelope [voice − TdrDelay − window, voice] (never narrower than before). Other classes
unchanged.

## Limits named

The 0.412 ratio and 150-W gate come from one card, driver 610.88, `furnace` burns; a stall that does not drop power is
invisible to the onset rule and falls to the envelope. 500-ms sampling brackets the onset to half a second — 200-ms
telemetry (`plans/106` risk b) narrows it.
