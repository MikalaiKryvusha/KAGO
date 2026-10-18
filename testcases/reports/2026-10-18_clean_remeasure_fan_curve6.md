# Run report — 2026-10-18 · clean re-measure of the four modes on fan curve №6, GCC removed

- **Work:** the owner's order 12:1x «нужно будет все перемерить, сток и все режимы» → «чтобы не было помех» → «Минут 7 на прогон.
  Минуты 3 на остывание» → «всегда квейк выводи на фореграунд… поверх всех окон». Basis: `testcases/reports/2026-10-18_gcc_fan_curve_short_check.md`
  (5-min runs disturbed by ~2.5 % FPS steps) and `testcases/reports/2026-10-17_cmp2_stock_comparison.md`.
- **Contour:** RTX 5070 Ti · driver 617.42 · VBIOS 98.03.58.40.8b · curve `6ea8d6` (⚖️ 🚀), ❄️ snapshot `2026-10-18T11-17-34` (cap 2302) ·
  fan curve №6 stored in the card (55 °C 0 · 70 °C 1805 rpm · 81 °C 3000), **GIGABYTE Control Center uninstalled 13:50, its 8 modules 13:51**
  (owner: «удалить бы GCC с компа») · Q2RTX 1.8.1 4K timedemo · background quieted (HOUSE_RULES R4): LG Hub, Parsec + service, Broadcast,
  Vibepollo (`ApolloService`), Phone Link; NVIDIA Overlay respawns by itself · KUMM and the Godot session idle (both confirmed by message).
- **Runs:** 2026-10-18 13:52:49–14:34:44 +03:00 — `RUNS=36 PREFIX=final6b AIR_S=180 AIR_FIRST=1 node tools/cmp-chain.mjs` (detached) +
  `runs/q2rtx-foreground-2026-10-18.ps1 -Minutes 55` (keeps q2rtx topmost/foreground; it refocused the game once at each launch:
  13:56:18 · 14:06:56 · 14:16:59 · 14:28:03). Background restored 14:35 (`runs/restore-card-background-2026-10-18.ps1`, services started).
- **Checks:**
  - Hygiene: none new.
  - Functional run: four modes applied through the owner's shortcuts, 36 Q2RTX passes each; per-pass FPS, medians, plateau READ.

  | mode | FPS (vs stock) | W | clock MHz | plateau °C | plateau fan | per-pass FPS |
  |---|---|---|---|---|---|---|
  | 🔄 stock | 55.7 | 300 | 2737 | 77 | 84 % | 55.7 on 34/36 passes |
  | 🚀 Max Perfomance | 58.4 (+4.8 %) | 285 | 3007 | 75 | 75 % | 58.4 on 33/36 |
  | ❄️ Silent Cold (2302) | 50.5 (−9.3 %) | 200 | 2310 | 65 | 39 % | 50.5 on 33/36 |
  | ⚖️ Optimised | 57.5 (+3.2 %) | 250 | 2767 | 70 | 58 % | 57.5 on 31/36 |

  - the intra-run FPS steps of the morning are GONE: after the first 2–5 warm-up passes every pass agrees within ±0.1 FPS.
  - offsets before/after each capture equal (0 · 61 · 70 · 60); `nvlddmkm` 0 in the hour.
  - fan curve №6 acts with GCC uninstalled (stock: 77 °C → 84 %, the curve gives ≈ 85 %).
- **Found:**
  1. 🚀 delivers 58.4 at 3007 MHz and 285 W — below its 300 W limit and 1.9 FPS under 17.10 (60.3 at the same 3007 MHz, 291 W); the 17.10
     run itself stepped 59.0 → 60.4 at pass 24. Two stable states of 🚀; cause not established.
  2. `bugs/153` proven 13:47:04→13:47:35: GCC start turned 61 offsets / 250 W into 0 / 300 W. Removed with GCC.
- **Traces:** `runs/graphics/final6b-chain.log` · `runs/graphics/final6b-{stock,max,silent,opt}.json(l)` · `runs/graphics/q2rtx-foreground.log`.
- **Verdict:** pass — clean, fault-free table of all four modes on curve №6; ⚖️ meets «70 °C в обычной игре» (owner) at 58 % ≤ 60 %;
  ❄️ 39 % at the lower edge of 40…50 %; 🚀 frames are a named open question.
