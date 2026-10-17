# Bug 148 — the accepted Optimised reset the driver in the owner's ordinary use (17.10 16:16, driver 617.42)

**Status:** 🔴 OPEN — found 2026-10-17 16:41 +03:00 (session 109) by reading the card before a planned check: factory state where
Optimised had been applied at 15:59; the driver log explains it. Waiting for the owner's word on what ran at 16:16.
**Severity:** S1 — the ACCEPTED mode (4-minute check passed 15:36, on the shortcut since 15:59) failed on the owner's machine in
ordinary use; the card fell back to factory silently (the owner was not told; `remembered-state` still says optimised).
**Version/build:** HEAD `f0d2aa2` · driver 617.42 · curve `2dc644` (trend + 0/0/0/−10/−10/−10/−10 + check floors), snapshot
`2026-10-17T15-36-44` · **When/context:** between the shortcut at 15:59 and the card read at 16:41; the owner at his own work
(«через 15 минут будет занят»).

## Symptom

`node tools/probe-offer.mjs` 16:41 → «сдвигов ненулевых: 0 из 128»; `nvidia-smi` → 300 W. Expected: 61 offsets, 250 W.
`npm run events -- --since 2026-10-17T15:58:00` → `nvlddmkm` 7 events, all inside 5 s:

```
13:16:46.3426Z 153 Error occurred on GPUID: 100
13:16:46.3443Z 153 Error occurred on GPUID: 100
13:16:46.8450Z 14  GPU recovery action changed from 0x0 (None) to 0x1 (PF FLR)
13:16:48.1176Z 153 GpuRcReset TDR · 13:16:49.9259Z Resetting TDR · 13:16:51.6419Z Reset TDR · 13:16:51.6816Z Restarting TDR
```

No reboot (last boot 15:28:42), Kernel-Power 0, Display 0. The reset (PF FLR) returns the card to factory — our state is volatile.
At 16:42 the GPU clients were light: explorer, Chrome ×2, VS Code, NVIDIA Overlay ×2, SnippingTool, LG Hub tray, dwm.

## What is known / not known

- **Not known:** what load ran at 16:16 (the owner's word is asked); no telemetry was recorded in ordinary use (the «week of use»
  has no instrument — the metric line says so), so the band is unknown.
- **Strong prior:** a light/desktop load. The check's mix touches idle and transitions only briefly (12 s idle on each end, 2
  transitions), and the bands below 2700 MHz stand at the TREND (margin 0) — extrapolated from 14 edges, none of them burned low.
  `HOUSE_RULES` §3 (`--lowload`): «an undervolt can survive every heavy test and die on a browser click».
- The earlier smoke failure (15:52, −20 at 2800–2900) is a different curve; this one is the accepted `2dc644`.

## Next (not started — waits for the owner's answer)

1. The owner's word on the 16:16 load.
2. Reproduce on the card with the owner present: Optimised applied + the light shapes (`stress --lowload`, a browser video) with
   the sampler running, so a failure gets its band.
3. Remedy by the method: the failing band's margin up (ratchet), never a guess over all bands.

## Links

`runs/shell/remembered-state.json` (still «optimised») · `bugs/146` · `bugs/147` · `plans/100` (the shortcut is silent when a mode fails)
