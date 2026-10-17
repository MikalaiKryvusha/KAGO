# Test run report — the honest stock comparison of the four modes (cmp2, attics open)

**Created:** 2026-10-17 23:28 +03:00 · **Run by:** the agent (Claude Opus 5.5), session 112 · **Version/build:** KAGO 0.9.3
(working tree after `f82b555` + this session's `tidy.mjs` / `hardware-mon.mjs` fixes), curve `6ea8d6`, driver 617.42

## 1. Work

The gain table of every mode against stock, asked by the owner on 2026-10-17 20:3x («замеры ДО ПОСЛЕ и по каждому режиму…
по температуре, вентиляторам, производительности, ваттам») and carried as STATUS «Эстафета» item 1. The session-111 set was
taken with the attics CLOSED (stock 91 % fan, 81 °C) and was declared not comparable; this run repeats it with the attics open
and five minutes of idle between states. Basis: `ЗАКАЗ.md` §1 (mode definitions) and §5 (noise thresholds).

## 2. Contour

The owner's machine, live card (RTX 5070 Ti, VBIOS 98.03.58.40.8b, driver 617.42), modes applied by the desktop shortcuts
(the owner's path: `explorer.exe <.lnk>` → `\KAGO\apply-*`), the Q2RTX 1.8.1 timedemo at 3840 × 2160 as the load, the
telemetry sampler in its own process. Machine lock `kago` held for the whole chain (KUMM shares the machine).
REAL WORLD: accumulated — the owner's desktop with his usual background apps running (not silenced; the same for all four
states); data and machine — his card, his curve, his profiles; path — the shortcuts he clicks. Verified on the real world.

## 3. Runs

Chain script `cmp2-chain.mjs` (scratchpad), log `runs/graphics/cmp2-chain.log` (+ the two aborted logs beside it).

| # | Moment | Command | Exit / outcome |
|---|---|---|---|
| 1 | 2026-10-17 21:43 +03:00 | `node automation-engine/lib/graphics-load.mjs --capture --label cmp2-stock --profile stock-default --runs 60` | exit 0, FPS 56.56, **7 samples — sampler killed** (bugs/152) |
| 2 | 2026-10-17 21:59 +03:00 | same | aborted by the agent at 22:02 — sampler killed again (bugs/152) |
| 3 | 2026-10-17 22:08 +03:00 | same | exit 0 · 1378 loaded samples · plateau 78 °C / 83 % / 300 W |
| 4 | 2026-10-17 22:25 +03:00 | `… --label cmp2-max --profile max-performance --runs 60` | aborted at 22:27 — sampler killed by the tidy race (bugs/152) |
| 5 | 2026-10-17 22:33 +03:00 | same | exit 0 · 1274 loaded samples · plateau 76 °C / 78 % / 293 W |
| 6 | 2026-10-17 22:49 +03:00 | `… --label cmp2-silent --profile silent-cold --runs 60` | exit 0 · 1550 loaded samples · plateau 62 °C / 47 % / 197 W |
| 7 | 2026-10-17 23:08 +03:00 | `… --label cmp2-opt --profile optimised --runs 60` | exit 0 · 1352 loaded samples · plateau 69 °C / 63 % / 250 W |
| 8 | 2026-10-17 23:20 +03:00 | `node automation-engine/lib/mode-validate.mjs --compare --stock runs/graphics/cmp2-stock.json --mode runs/graphics/cmp2-<mode>.json` ×3 | the tables below |
| 9 | 2026-10-17 23:20 +03:00 | `npm run events -- --last 2h` | all five providers `no-events`, `nvlddmkm` 0 |

## 4. Checks

Hygiene: `node tools/tidy.mjs --selftest` 24/24 (MTD2 and MTD3 each red on target) · `node automation-engine/lib/hardware-mon.mjs --selftest` 3/3 (try/catch mutation red) · `npm run check` exit 0.
Functional run: four Q2RTX captures on the owner's card through his shortcuts; READ — the state reads after each shortcut
(offsets 0 / 61 / 71 (10 raised) / 60 of 128; power 300 / 300 / 250 / 250 W), the plateau detector on each telemetry file,
the comparison tables, the Windows event log.

| case | expected | observed | status |
|---|---|---|---|
| stock reads as factory after the shortcut | 0 offsets, 300 W | 0 of 128, 300 W | pass |
| each capture reaches a thermal plateau | ПЛАТО | stock 545 s · max 397 s · silent 751 s · opt 608 s stable | pass |
| no driver fault during any state | 0 events | 0 | pass |
| 🚀 frames above stock beyond the meter's floor (0.90 %) | > +0.9 % | +9.0 % (plateau-trend 59.0 → 60.4, not noise) | pass |
| ⚖️ power at its 250 W limit, frames ≥ stock | 250 W, ≥ 55.3 | 250 W, 56.4 FPS | pass |
| ❄️ fans within 40…50 % on the plateau (`ЗАКАЗ.md` §1) | 40…50 % | 47 % | pass |
| ⚖️ frames ≥ 95 % of 🚀 (`ЗАКАЗ.md` §1) | ≥ 57.3 | 56.4 (−6.5 %) | **fail** — to the owner |
| ⚖️ fans ≤ 60 % («желательно», `ЗАКАЗ.md` §5) | ≤ 60 % | 62 % median, 63 % plateau | **fail (soft target)** — to the owner |

## 5. Found

- `bugs/152` — the end-of-turn `tidy` killed the capture's sampler (no `graphics-load --capture` marker; then a race between two
  process snapshots). Fixed and witnessed on the real path (runs 3, 5–7 survived many turn ends, run 5 started exactly in the
  race window).
- ⚖️ Optimised misses two of its own targets against 🚀 on this curve (cases above) — not a defect of the tool; an owner decision.

## 6. Traces

`runs/graphics/cmp2-{stock,max,silent,opt}.{json,jsonl}` · `runs/graphics/cmp2-chain.log` · `runs/graphics/cmp2-chain-2143-aborted.log` ·
`runs/graphics/cmp2-chain-2159-aborted.log` · `runs/graphics/cmp2-stock-nometer-2143.json` · infographic `assets/comparison-9x16.png`.

## 7. Verdict

**pass** for the comparison itself (four states, plateau reached in each, zero faults, numbers read by the instrument);
two target misses of ⚖️ Optimised are recorded as findings for the owner, not hidden.
