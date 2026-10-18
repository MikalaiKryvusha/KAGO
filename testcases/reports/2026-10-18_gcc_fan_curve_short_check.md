# Run report — 2026-10-18 · four modes under the owner's GIGABYTE Control Center fan curve

- **Work:** the owner's ask 18.10 ~09:00 — «короткие тесты профилей, по 5 минут на каждый» after installing GIGABYTE Control Center
  (GCC, `C:\Program Files\GIGABYTE\Control Center`) with a custom fan curve (GvProfile `41800_GFans_Profile 1.dat`:
  0 % ≤ 55 °C · 63 % / 1899 rpm @ 75 °C · 100 % @ 84 °C, all three coolers, zero-RPM on). Basis: `testcases/reports/2026-10-17_cmp2_stock_comparison.md`
  (same chain, 60 passes, before GCC). Plus the GCC-off control: does the curve live in the card or in the GCC process?
- **Contour:** RTX 5070 Ti, driver 617.42, VBIOS 98.03.58.40.8b, curve `6ea8d6` snapshots; Q2RTX 1.8.1 4K timedemo; the owner's
  shortcuts (`explorer.exe <.lnk>`); attics open (as 17.10 evening).
- **Runs:**
  1. 2026-10-18 09:04:29–09:41:14 +03:00 — `RUNS=25 PREFIX=gcc AIR_S=300 node tools/cmp-chain.mjs` (detached), stock → max → silent → opt.
  2. 2026-10-18 09:54:22 — GCC.exe closed (`Stop-Process`); 09:54–09:56 `node automation-engine/lib/graphics-load.mjs --capture --label gccoff-opt --profile optimised --runs 10`
     with a guard loop (kill q2rtx at ≥ 80 °C with fan < 30 %); 09:56:45 GCC restarted via `explorer.exe`.
- **Checks:**
  - Hygiene: `node --check tools/cmp-chain.mjs`, `npm run check` — green.
  - Functional run: four modes applied through the owner's shortcuts and loaded 5 min each by Q2RTX; medians, plateau and curve offsets READ
    from the chain log and the capture records; `nvlddmkm` 0 events in the window.

  | mode | FPS 17.10 → 18.10 | W | plateau °C | plateau fan |
  |---|---|---|---|---|
  | stock | 55.3 → 55.2 | 300 | 78 → 77 | 83 → 74 % |
  | max | 60.3 → 59.3 | 291 → 300 | 76 → 78 | 78 → 70 % |
  | silent | 49.2 → 47.3 | 197 → 177 | 62 → 65 (still +0.8 °C/min) | 47 → 30 % (card's manual floor) |
  | opt | 56.4 → 56.1 | 250 | 69 → 72 | 63 → 50 % |

  - curve offsets before/after each capture equal (stock 0/0 · max 61/61 · silent 71/71 · opt 60/60) — GCC did not overwrite a mode mid-run.
  - GCC-off control (opt): 72 °C · fan 48 % median — identical to the GCC-on opt capture (72 °C · 48 %); 17.10 before GCC: 69 °C · 62 %.
    → the curve acts with the GCC process closed, i.e. it lives in the card/driver. Survival across a reboot or a GCC uninstall — NOT checked.
- **Found:**
  1. At 2026-10-18 09:01 the card was at FACTORY (0 offsets, 300 W) with no reboot since 17.10 15:28 and the remembered mode `optimised`;
     GCC was installed 08:50 and its Performance page opened 08:56 (GCC log) — the likely author. Re-applied by the chain's shortcut.
  2. silent: −4 % FPS at the same 2235 MHz vs 17.10 — cause not established (short run; power 177 vs 197 W).
  3. max: one sample at 100 % fan (09:15:23, 49 → 68 °C in 1 s) — zero-RPM spin-up, not a fault.
- **Traces:** `runs/graphics/gcc-chain.log`, `runs/graphics/gcc-{stock,max,silent,opt}.json(l)`, `runs/graphics/gccoff-opt.json(l)`, GCC log `C:\Program Files\GIGABYTE\Control Center\logs\log_20261018.log`.
- **Addendum — curve №2** (owner saved 09:58:52: 0 % ≤ 59 °C · 67 % / 1999 rpm @ 74 · 100 % @ 79; screenshot
  `assets/fans/2026-10-18_gcc_fan_curve.png`). The save RESET the V/F curve to factory again (0 offsets at 09:59) → ⚖️ re-applied by
  shortcut 09:59:33 (61 offsets, 250 W, two reads). Run 10:00:14–10:16:33 `RUNS=25 PREFIX=gcc2 AIR_S=300 node tools/cmp-chain.mjs silent opt`:
  silent 49.9 FPS · 200 W · plateau 68 °C · fan 34 % (rising +1 %/min) · 71/71 offsets; opt 54.1 FPS median but spread 8.7 %
  (52.1…56.8, normal ≈ 1 %) — a disturbed run, median not comparable · 250 W · plateau 72 °C · fan 52 % · 60/60 offsets. `nvlddmkm` 0.
- **Verdict:** pass — 4/4 modes ran fault-free under the new fan curve; opt now meets its fan goal (50 % ≤ 60 %); silent is below its 40…50 % target band.
- **Addendum — curve №3** (agent's points, owner set 73 °C → 1420; GCC saved 10:20:03 as 56 °C 0 · 73 °C 1420 rpm / 47 % · 82 °C 3000;
  this save did NOT reset the V/F curve: 60 offsets, 250 W). Run 10:20:30–10:36:29 `RUNS=25 PREFIX=gcc3 AIR_S=300 node tools/cmp-chain.mjs silent opt`:
  silent 50.8 FPS (spread 1.3 %) · 198 W · plateau 70 °C (+0.5 °C/min) · fan 30 % (floor, flat) · 71 offsets;
  opt 56.4 FPS (spread 2.1 %) · 250 W · plateau 74 °C · fan 47 % (+0.9 %/min) · 60/60 offsets. `nvlddmkm` 0.
- **Addendum — curve №4** (owner «охладить сильнее»; agent proposed 50 °C 0 · 70 °C 1650 · 80 °C 3000; GCC file saved 10:39:21 reads
  56 °C 0 · 73 °C 1839 rpm / 61 % · 80 °C 3000 — tested as it stands; V/F curve not reset: 60 offsets, 250 W).
  Run 10:39:52–10:56:01 `RUNS=25 PREFIX=gcc4 AIR_S=300 node tools/cmp-chain.mjs silent opt`:
  silent 49.1 FPS (spread 0.8 %) · 197 W · plateau 67 °C (−0.7 °C/min) · fan 35 % (+0.7 %/min) · 71 offsets;
  opt 56.8 FPS (spread 2.9 %) · 250 W · plateau 71 °C (0.0 °C/min) · fan 52 % (+1.0 %/min) · 60/60 offsets. `nvlddmkm` 0.
- **Addendum — curve №5 + Silent Cold cap 2205 → 2302** (owner 11:00 saved 55 °C 0 · 73 °C 1999 · 80 °C 3000). Run 11:00:42–11:17:05
  `PREFIX=gcc5 … silent opt`: silent 48.9 FPS (spread 4.4 %) · 191 W · plateau 66 °C · 35 %; opt 54.4 FPS (spread 1.5 %, below the usual
  56–57 at a HIGHER clock 2872 — unexplained) · 250 W · plateau 71 °C · 55 %. `nvlddmkm` 0.
  Owner ~11:10: «66°C, обороты 35% - поднимаем ограничение частоты холодного режима на 100 МГц» → `curveCapMhz` 2302 (ladder) →
  `npm run validate -- --step --mode silent-cold --band-margins 0,0,0,-10,-10,-10,10 --minutes 4` 11:17:34–11:22:21 ПРОЙДЕНА
  (`runs/validate/2026-10-18T11-17-34/report.md`, gap 585 ms, driver 0) → `profiles/silent-cold.json` snapshot 2026-10-18T11-17-34 →
  `PREFIX=cap2302 … silent` 11:22:44–11:28:41: 48.9 FPS (spread 2.7 %) · 182 W · 2310 MHz · plateau 66 °C (+0.9 °C/min, started warm
  at 43 °C with fans at 30 %) · 31 %. The +75 MHz delivered bought NO frames and LESS power; the last 50 loaded samples carry the
  clock-event reason `gpu_idle` in both captures — the GPU waits on something else (CPU / frame pacing, cf. `bugs/113`): not explained.
  ⚖️ re-applied by shortcut 11:28:53 (61 offsets, 250 W, two reads).
- **Addendum — 🚀 on curve №5** 11:33:20–11:38:20 `PREFIX=gcc5max … max`: 60.1 FPS (spread 3.2 %) · 300 W · plateau 76 °C · 77 % · 61/61 offsets; `nvlddmkm` 0.
  ⚖️ re-applied 11:38:4x (61 offsets, 250 W, two reads).
- **First thermal model (owner 11:3x: «Sweet Spot … в некотором термодинамическом приближении»)** — least squares over the 14 plateaus
  of this report (P W, fan %, T °C): **T = 22.2 + P·(0.1411 + 3.013 / fan%)**, RMS 0.40 °C, worst residual 0.6 °C. Ta = 22.2 °C reads as the
  room air. `[NOT-TESTED]` as a predictor: fitted on the same points, no held-out prediction yet; FPS(P) ≈ 49 @ 190 W · 56 @ 250 · 60 @ 300.
- **Addendum — curve №6, designed by the model for ⚖️ = 70 °C** (owner: «давай на 70 ориентироваться при обычной игре»; proposed
  55 °C 0 · 70 °C 1800 · 82 °C 3000; GCC saved 11:44:02 as 55 °C 0 · 70 °C 1805 / 60 % · 81 °C 3000). First HELD-OUT test of the model:
  - silent (cap 2302) 11:44:17–11:50:00: 50.9 FPS (spread 0.3 %) · 199 W · plateau 65 °C · 39 % — model at 199 W: 65.1 °C · 40 %;
  - opt 11:55–12:00:09: 58.0 FPS (spread 3.0 %) · 250 W · plateau 70 °C (−0.8 °C/min) · 58 % — model: 70 °C · 60 %;
  - max (AIR_FIRST) 12:05–12:10:26: 57.7 FPS (spread 3.7 %) · 283 W (below its 300 W limit) · 3007 MHz · plateau 74 °C · 72 % —
    model at 283 W: 73.7 °C · 73 %. FPS is NOT comparable: below ⚖️ at a higher clock and an unsaturated power limit — the platform
    (CPU, cf. `bugs/113`) or the owner's Chrome (he reported opening it during the 11:33 max run) shaped the frames today.
  `nvlddmkm` 0. ⚖️ re-applied ~12:11. Verdict on the model: three held-out plateaus within 1 °C and 2 % fan.
- **Why the frames disagree (agent's look at the per-pass FPS, 12:1x):** inside ONE run the FPS jumps between two levels at a constant
  clock and power cap: cmp2-max (17.10) 59.0 → 60.4 at pass 24; gcc5max 60.1 → 58.5 at pass 16; gcc6-opt 56.8 → 58.1 at pass 10;
  gcc6max wanders 56.2…58.3. A ~2.5 % step of the machine's state (not of the card) — the same size as the mode differences being
  judged. All max runs carry only `sw_power_cap`, util 100 %; gcc6max nevertheless drew 283 W median at a 300 W limit — not explained.
  → today's 5-min FPS cannot rank modes closer than ~3 %; temperature and fan are unaffected (the card sat at its power cap).
  Owner 12:1x: «нужно будет все перемерить, сток и все режимы. Когда комп освободится».
