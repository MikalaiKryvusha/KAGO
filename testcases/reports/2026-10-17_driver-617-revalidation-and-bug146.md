# Run report — 2026-10-17 · Optimised re-validated on driver 617.42 · bugs/146 attribution fix

## Work
(1) Re-validation of ⚖️ Optimised after the owner reinstalled the driver (616.92 → 617.42): basis — R6 (a profile is
invalid until re-validated on a new driver), `STATUS.md` → Эстафета п. 2, `plans/105` Ш6–Ш11. (2) `bugs/146` fix plan items
1 and 3: a check failure is attributed to the rows the step lowered, not only to the 2-s window.

## Contour
The owner's machine: RTX 5070 Ti, driver 617.42, VBIOS 98.03.58.40.8b, Windows 11; the mode check `mode-validate.mjs`
(`--step`), the reference taker (`curve-store.mjs --take-reference`), the burn goldens (`stress-tester.mjs`). Curve
`2dc644` (trend + 0/0/0/−10/−10/−10/−10 + the check floors of 17.10). Background: Broadcast, Parsec, VS Code, Chrome running.

## Runs
- 15:29 — boot log: `optimised` REFUSED by stamp 616.92 (`npm run curve -- --progress`).
- 15:32–15:34 — `npm run curve -- --take-reference` (no card writes): exit 0.
- 15:35–15:40 — `npm run stress -- --capture-baseline` and `--workload furnace --arg 2400 --arg 8192 --arg 256 --arg 64|48|32|20`, then `--verify-baseline`.
- 15:36:44–15:41:19 — `npm run validate -- --step --mode optimised --band-margins 0,0,0,-10,-10,-10,-10 --minutes 4` (WRITES TO THE GPU; rollback in `finally`).
- 15:42 — shortcut `⚖️ Optimised.lnk` launched by the agent (`explorer.exe`); `node tools/probe-offer.mjs`; `npm run profiles`.
- 15:45–15:48 — `npm run validate -- --selftest`; a scratch mutation script (control, MV18, MV19); a scratch replay of the
  17.10 failures on recorded data; `npm run check`; `npm run selftest:all`.

## Checks
Hygiene: validate selftest 58/58; control copy 58/58, MV18 and MV19 each red on the new block alone; `npm run check` green;
`npm run selftest:all` — see Verdict.
Functional run: (a) reference — 8 reads at 79 °C · 299 W · P0, 64 of 128 points moved (≤ 15 MHz), worst case taken, 127
working points monotone — pass; (b) goldens — 8 of 8 re-captured, checksums byte-identical to 616.92, stamps match — pass;
(c) mode check — PASSED: driver 0 events, max telemetry gap 530 ms (threshold 2130), 9 stages normal, Q2RTX 57.6 / 56.3 FPS,
rollback confirmed — pass; (d) shortcut — the card reads 61 non-zero offsets of 128, power limit 250 W, raised points above
3090 MHz: 0, remembered state `optimised` / 617.42 — pass; (e) bugs/146 replay on the real journal: seq 18 and 19 now floor
2850…2895 MHz (the rows the step lowered), seq 16 floors the 46 rows of its broad step — pass.

## Found
- `bugs/141` and `bugs/142` carried «open» status lines under their DONE tags (red backlog lint since session 108) — fixed.
- The mode check prints «вход 2: файл сердцебиения ДО ГОРНА НЕ ДОШЁЛ» before its first burn — a frozen fuse helper, not a
  check condition; not investigated (moratorium on the protection machinery, ЗАКАЗ §9).
- The new reference moved 64 points between 8 reads where 616.92's moved 0 — noted, worst case taken.

## Traces
`curves/reference-table.json` (a76e09b) · `runs/baseline/` (git-ignored) · `runs/validate/2026-10-17T15-36-44/{report.md,result.json,mon.jsonl}`
· `curves/battle/2026-10-17T15-36-44.json` · `profiles/optimised.json` (9525787) · `runs/probe-offer.json` ·
`bugs/146_…md` → «Fix log — session 109».

## Verdict
pass — Optimised re-validated on 617.42 and on the shortcut; bugs/146 items 1 and 3 done offline, the live witness of the
new attribution waits for the next descent of 2800–2900 with the owner at the machine.

## Addendum — 15:51–16:05, the deepening smoke and what it found

- **Run:** 15:51:50 `npm run validate -- --step --mode optimised --band-margins 0,0,0,-10,-20,-10,-10 --minutes 0.5` (WRITES TO
  THE GPU), the owner at the machine. **Verdict: FAILED** — driver reset (`nvlddmkm` 153) 12:52:07Z in the first Q2RTX pass,
  37 resets to 12:55:53Z, the screen hung ~4 min, the machine survived; Q2RTX hung in the driver and left a crash report.
- **Checks:** the new attribution floored the 5 rows the step lowered (2850…2895 MHz @ 865…875 mV) plus 3082 @ 1000 — the live
  witness of `bugs/146` item 1 — pass. The rollback waited for the hung game (killed by the agent ~15:56) and was not confirmed
  («nvidia-smi не ответил»); the card read factory at 15:57 and 15:59 (0 offsets, 300 W), driver silent since 15:56; ⚖️ Optimised
  re-applied 15:59 by the shortcut (61 offsets, 250 W, 0 above 3090) — pass.
- **Found:** `bugs/147` (the game stage inherited a 900-s timeout — fixed: 63 s / 261 s by passes, MV20); the metric printed
  1/4 after the failed candidate (a check of another curve demoted the mode — fixed, MV21; the live line reads 2/4 again).
- **Hygiene:** validate selftest 60/60; control 60/60; MV18–MV21 each red on its own block alone.
- **Traces:** `runs/validate/2026-10-17T15-51-50/` · journal seq 23 · `curves/battle/2026-10-17T15-51-50.json` · `bugs/147_…md`.
- **Verdict:** partial — the band 2800–2900 has its edge at −20 on 617.42 (three failures over two drivers); Optimised stays on −10.
