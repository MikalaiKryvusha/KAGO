# Test run report — the mode check's offline half on RECORDED data (epic 101 Ф1, `plans/102` Ш3–Ш6)

**Created:** 2026-09-25 02:05 +03:00 · **Run by:** the agent (Claude Opus 5.5), session 102 ·
**Version/build:** `automation-engine/lib/mode-validate.mjs` at `d1b2928` (39 selftest blocks)

## 1. Work

The post-check half of the mode check and its offline instruments, against `plans/102` P102-AC2/AC3/AC5/AC6 and
E101-AC2: the visit map (`--hits`), the benefit table against stock (`--compare`), the whole post-check half over a
recorded capture (`--replay`: verdict · the REAL driver voice from the Windows log · visit map · report), the death
rule («an unclosed intent = a failure in the band of the last durable sample»), the driver-voice seam, and the check
command's dry run. Basis: the recorded captures in `runs/graphics/`, the sampler record of the proven death of
2026-09-08 17:53 (`researches/36` §1.3), the Windows event log.

## 2. Contour

Offline, the owner's machine. No GPU write, no GPU load; the Windows event log is read (the OS, not the card). Data:
committed/recorded files only. `REAL WORLD:` not applicable — nothing reaches the card or a profile; the executor's card
path (`makeCardSeams`) was NOT run (Ш8).

## 3. Runs

| # | Moment | Command | Exit / outcome |
|---|---|---|---|
| 1 | 2026-09-25 01:29 +03:00 | `npm run validate -- --hits runs/graphics/exp0914_d.jsonl runs/graphics/opt83_a.jsonl runs/graphics/mp83_a.jsonl runs/graphics/stock_c.jsonl` | 0 · four visit maps |
| 2 | 2026-09-25 01:32 +03:00 | `node --input-type=module -e "…deathVerdicts([{ intent, telemetryPath: 'runs/telemetry/20260908-175308.jsonl' }])"` | 0 · one death verdict |
| 3 | 2026-09-25 01:34 +03:00 | `node --input-type=module -e "…realDriverEvents(<30.08 21:47:30>, <21:49:30>) · (<24.09 12:00>, <12:20>)"` | 0 · 3 events · 0 events |
| 4 | 2026-09-25 01:38 +03:00 | `npm run validate -- --compare --stock runs/graphics/stock_c.json,runs/graphics/stock_d.json --mode runs/graphics/opt_a.json,runs/graphics/opt_b.json` | 0 · the table |
| 5 | 2026-09-25 01:39 +03:00 | `npm run validate -- --replay runs/graphics/opt_a.json --stock runs/graphics/stock_c.json,runs/graphics/stock_d.json` · `--replay runs/graphics/mp83_a.json` | 0 · two reports |
| 6 | 2026-09-25 01:48 / 01:51 +03:00 | `npm run validate -- --mode optimised --candidate <scratch candidate> --dry-run` · `--mode stock-default --candidate profiles/factory.json --minutes 1 --dry-run` · `--mode silent-cold --candidate <optimised candidate> --dry-run` | 0 · 0 · 2 (refused: wrong mode) |
| 7 | 2026-09-25 02:04 +03:00 | run 4 re-run after the judge's defect A (the `--mode` branch had swallowed `--compare`) | 0 · the table again |

## 4. Checks

Hygiene: selftest 39/39 · mutations MV1–MV11 and the CLI-order mutant each red on target, unmutated control copies green · `npm run check` 0
Functional run: the instruments walked on the operator's path over REAL recordings (Q2RTX captures of 31.08 and 01.09, the 08.09 death sampler) and the REAL Windows event log; READ: the lines quoted below

| Case | Status | Observation |
|---|---|---|
| visit map, Optimised 14.09 (250 W) | pass | 2800–2900 86 % |
| visit map, Max Perfomance 01.09 (300 W) | pass | 2900–2950 57 % · above 2950 **20 %** — corrects «above 2950 is not visited» (fixed where it stood) |
| death rule on the 08.09 17:53 sampler | pass | `death · band B7 · last sample 3022 MHz, gpu_idle` — the run held 3030 MHz / 900 mV and died at rest |
| driver voice, 30.08 21:47:30–21:49:30 | pass | 3 events (153 · 14 · 153), as `researches/30` records |
| driver voice, quiet 24.09 window | pass | 0 events, READ (not `null`) |
| benefit table vs the 31.08 record | pass, with a caveat | FPS +1,3 % · 300,3 → 250,2 W · 81 → 73 °C · 86 → 67 % · 2730 → 2805 MHz; recorded 300,1 / 81,5 / 2729 — the gap is pooled samples against the mean of two medians |
| replay of `opt_a` | pass | ПРОЙДЕНА · 127 samples · max gap 532 ms · `nvlddmkm` 0 · all four report parts present |
| dry run of the check command | pass | plan printed; card, journal and files untouched; wrong-mode candidate refused |
| `--compare` after 128f6bf | fail → fixed | usage error instead of the table (judge, defect A); fixed in `d1b2928` with a run-level guard block |

## 5. Found

- `--compare` swallowed by the `--mode` branch (introduced `128f6bf`, found by the independent judge) — fixed `d1b2928`, guard block added.
- «Above 2950 MHz is not visited under heavy load» was false for Max Perfomance at 300 W — corrected in `researches/39`, `config.mjs`, `curve-proposal.mjs`, `interviews/interview_030`.

## 6. Traces

`runs/graphics/{exp0914_d,opt83_a,mp83_a,stock_c,stock_d,opt_a,opt_b}.json(l)` · `runs/telemetry/20260908-175308.jsonl` ·
the Windows System log (`nvlddmkm`) · replay sandboxes removed after the run (`--out <dir>` keeps one) · commits
`422b169`, `eaf2eea`, `2f5c486`, `bc792a7`, `2560a41`, `128f6bf`, `d1b2928`.

## 7. Verdict

**partial** — the offline half passes on real recordings; the card half of the check (apply · sampler · Q2RTX · burn ·
rollback) has never run: that is the smoke of Ш8, with the owner present.
