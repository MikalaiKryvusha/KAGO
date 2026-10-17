# Bug 148 — the accepted Optimised reset the driver in the owner's ordinary use (17.10 16:16, driver 617.42)

**Status:** 🟡 MITIGATED, CAUSE NOT PINNED — top band −10 → +10 (16:51) did NOT change 3037…3075 MHz where the GPU stalled (see «✏️ Correction»); found 2026-10-17 16:41 +03:00 (session 109) by reading the card before a planned check: factory state where
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
  No driver event 16:54–16:57. The 1-hour recorder (`hardware-mon --seconds 3600`) ended at 16:56:46 (code 1) and its restart at
  16:57:29 — each exactly at the end of an agent turn: the `Stop` hook runs `tools/tidy.mjs --apply`, which removes every
  `hardware-mon` sampler by design (`tidy.mjs:230-234`, the owner's word of 2026-08-16 against leftover agent processes).
  ✏️ Corrected 16:58: the first edition of this line guessed «one failed sample kills the whole recording» — false; the sampler
  is not at fault. Consequence: a telemetry recording lives only inside one agent turn; across turns only the driver-voice watch
  (a Monitor polling `npm run events`, not a sampler) survives.
- **17:02–17:06 — Svarog load cycles under the new curve (the owner's word: «лучше бы тебе запускать игру и грузить сейв, чтобы
  резкий скачок нагрузки воспроизвести»; «самый последний сейв грузи, наклоняй камеру и максимально отдаляй»):** the KUMM
  session's recipe (`SvarogsDream/tools/run-game.sh`, `VIEW=far`, stop by the harness `kill`; saves left as the game wrote them —
  the owner: «похуй на сохранения»), 3 cycles × (load the latest save → 30 s in the world, max zoom-out, pitch 12°). Telemetry
  `nvidia-smi -lms 200` (not a `hardware-mon` sampler, so the end-of-turn tidy does not remove it):
  `runs/use/2026-10-17T17-02-21-svarog-loads.csv` — 1303 samples, 647 above 2950 MHz, peak 3082 MHz, **2 jumps from deep idle
  straight to the top within 200 ms** (17:04:38 900 → 3052 MHz; 17:06:07 292 → 3067 MHz) — the failing shape. `nvlddmkm` 0 events
  17:02:21–17:06:52. With the earlier 16:54–16:57 and 16:58–17:05 runs (0 events) and the wake exam: the top band at +10 holds
  every shape that failed at −10. **Status → 🔧 fixed, witness = ordinary use** (the week of use; the shortcut and autostart carry it).

## ✏️ Correction — 2026-10-17 17:1x, on the owner's question «точечно поднял их?»

The diff of the two snapshots (`curves/battle/2026-10-17T15-36-44.json` → `…16-46-32.json`) changes 10 rows: 2850/2857 870→875,
2880/2887/2895 885→890 (the −20 failure's floors), **2962/2970/2977 920–925→935, 3082/3090 1000→1015** (the top margin). **The rows
3037…3075 MHz — where the GPU stalled at 16:45:14.9 — are UNCHANGED**: earlier check floors (14:17/14:19) already held them above
the trend + 10 line, so the band raise did not reach them. Therefore the lines above «Fix by the ratchet» and «the top band at +10
holds every shape that failed at −10» are true of the curves and FALSE as a cause: the raise did not touch the failing frequencies.
Two explanations, not told apart: (1) the failure sat at 2962–2977 or 3082/3090, crossed between 500-ms samples; (2) the failure is
probabilistic and the 10 minutes since were luck. The chat claim «2950…3030 and 3082/3090 got +20 mV» was also false (+10…15 mV).
Status stays 🔧, but «fixed» is NOT established — the frequency-level step (a floor at 3037…3075 from the 16:45 failure, 200-ms
telemetry) is the next card action, the owner's word pending.

## Session 110 — 2026-10-17 17:4x (offline)

- The 16:45 failure is in the check journal (`plans/106` Ш2, seq 25, `observedIn: use`): floors 3037…3075 @990. The span is the
  instrument's own, after `bugs/149` (the driver voice is TdrDelay late; the stall onset is the 197 → 71 W collapse at 3037).
- The builder's Optimised curve with them is `90f679`: 3037…3075 990 → 1000 mV, every other row as `7b11e9`. NOT on the card —
  the next card act is its 4-min check (with the wake stage) → profile → shortcut, the owner present (Ш3/Ш4), under the machine
  lock agreed with the KUMM session.

## Third face — 2026-10-17 21:08, a plateau capture under Q2RTX (session 111)

The comparison capture `runs/graphics/cmp-opt.json` (curve `4215c7`, snapshot 2026-10-17T17-54-57, the computer in a CLOSED cabinet,
card 73 °C, 250 W `sw_power_cap`): 21:08:40.37 2812 MHz 250 W → 40.87 3075 MHz **72 W at 100 %** (stall onset) → 21:08:43
`nvlddmkm 153` ×3 → Q2RTX exit 1. Hotter than any check of the mode (checks ran 64…70 °C). Recorded in the check journal as a
failure outside a check (seq 34, `observedIn: use`), attributed by the `bugs/149` rule to 2812…3082 MHz; the step built `6ea8d6`
(2812+ raised 10–15 mV); Optimised and Max Perfomance re-checked on it — both PASSED (21:11 in the still-hot cabinet, 21:16).
Witness of the fix: the next plateau captures (21:30 chain, cabinet doors open) and the week of use.
