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

## Diagnosis and fix — session 109, 2026-10-17 16:42–16:54 (the owner at the machine, «комп твой»)

- **The load at 16:16 (owner's word):** «мы гоняли твои тесты, а соседний бот играет в сварог» — Svarog's Dream (Unity), driven by
  the neighbour session KUMM; «сварог по ГПУ не тяжелая игра, там ГПУ отдыхает, а CPU вот сильно грузится». KUMM independently
  saw the game die once today with d3d11 887a0005 (DXGI_ERROR_DEVICE_REMOVED) — the same event from the game's side.
- **Reproduced 16:45:17** (telemetry `runs/use/2026-10-17T16-42-56-optimised.jsonl`, sampler running since 16:42): Optimised
  applied by the shortcut 16:43, the game at its menu (3 %, 700–800 MHz), then `npm run stress -- --workload sdc_fma --lowload
  --seconds 60`. Seconds before the failure: P3→P5→P8 (330–600 MHz) 16:45:07–12, a burst woke the card straight to **3037 → 3075
  MHz** at 16:45:12.9, at 16:45:14.9 power collapsed 197 → 70 W under «100 %» (the GPU stalled), 16:45:17.09 `153` ×2, `14`
  (PF FLR), TDR — the same signature as 16:16. **The failing band: above 2950 MHz, on a wake from deep idle** — a transition the
  check's mix does not contain (12-s idles, 2 transitions of 5/5 s; the card never reaches P8 before a full burst).
- **Fix by the ratchet:** the top band −10 → +10 (two 10-mV grid steps), the other bands untouched:
  `npm run validate -- --step --mode optimised --band-margins 0,0,0,-10,-10,-10,10 --minutes 4` → PASSED
  (`runs/validate/2026-10-17T16-46-32/`, driver 0, gap 532 ms, Q2RTX 58.5 / 57.3 FPS) → `profiles/optimised.json` → snapshot
  `2026-10-17T16-46-32` → shortcut 16:51:36 → **the wake exam:** `stress --lowload` 2 × 60 s (105 wake bursts), checksums
  matched, `nvlddmkm` 0 events (16:51:52–16:53:57). The same exam on the previous snapshot failed within ~60 s.
- **Open:** (1) the check's mix lacks the wake-from-deep-idle shape — add a `--lowload` stage to `CANONICAL_MIX` (the instrument,
  not a new contour) so the next step is judged on it; (2) the Svarog run under the new curve (the game was relaunched at 16:54 by
  the neighbour session; the driver is watched while it runs); (3) the earlier «wrong» top floors of `bugs/146` (14:17/14:19,
  attributed to 2985…3082) may have been RIGHT — the top fails on wake; item 2 of `bugs/146` is to be re-judged with this in hand.
- **16:56 — Svarog under the new curve:** the game (relaunched 16:54 by the neighbour session) holds the card at **3037 MHz, ~50 %,
  ~150 W for 78 % of samples** — Svarog lives in the TOP band, Q2RTX does not (2800–2900); that is why a GPU-light game found it.
  No driver event 16:54–16:57. The 1-hour recorder (`hardware-mon --seconds 3600`) exited with code 1 at 16:56:46 after 1661
  samples, no driver event, the card still in Optimised — its `ОШИБКА:` line went to a stderr that was not kept; restarted with
  stderr kept (`runs/use/2026-10-17T16-57-optimised-2.jsonl`). The same sampler serves the mode check: one failed sample kills the
  whole recording — to be read when it recurs (S3 until then).
