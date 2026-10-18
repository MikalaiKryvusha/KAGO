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
