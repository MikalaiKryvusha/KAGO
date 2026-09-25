# Bug 139 — the digital twin's suite turned red after 2026-09-09: five blocks, its rungs close `unknown` instead of reaching a verdict

**Status:** ✅ DONE 2026-09-25 20:1x +03:00 — the expected cure worked: goldens re-captured on 616.92 at 18:57–18:59
(session 104), and the full battery at 20:1x ran `twin` GREEN (30 blocks) — 55 suites, 0 red, 2824 blocks
**Severity:** S2 — no card, no data touched; the cost is a red battery line that hides the next real red
**Version/build:** HEAD `e4e580b` (2026-09-25) · **When/context:** found 2026-09-25 01:16 +03:00, session 102, by the full offline battery run while closing Ф1 Ш3/Ш5 (`npm run selftest:all`: 55 suites, **1 red — `twin`**, 2789 green blocks)

## Symptom

`node automation-engine/lib/twin-assembly.mjs --selftest` → exit 1, five `ПЛОХО` lines; every one is a twin rung that
closes `unknown` (no verdict) where the block expects `passed` / `hung`:

```
ПЛОХО ЗАКРЕПЛЕНИЕ: закреплённая ступень двойника ДОХОДИТ ДО ВЕРДИКТА … -> получено ["unknown",null,"закрепление частоты",2145], ждали ["passed","PASS",…]
ПЛОХО СПАСЕНИЕ ПОД ЖИВОЙ СТУПЕНЬЮ (bugs/88): рука 2 обнулила кривую … -> получено [true,false,null], ждали [true,true,0]
ПЛОХО СПАСЕНИЕ ПОД ЖИВОЙ СТУПЕНЬЮ (bugs/88): БЕЗ входа предохранителя … -> получено ["unknown",null], ждали ["passed","PASS"]
ПЛОХО ЛЕЧЕНИЕ НА ДВОЙНИКЕ (bugs/88): с проведённым входом … -> получено ["unknown",null,"sdc_fma/transient",null], ждали ["hung","ЗАВИС",…]
ПЛОХО ПУЛЬС: пульс твин-прогона — в песочнице … -> получено [false,true,true,true,true], ждали [true,true,true,true,true]
```

## Forensics

- **Not caused by session 102.** The five reds reproduce on the committed tree with this session's uncommitted edits
  stashed (`git stash push -- <5 files>` → `node automation-engine/lib/twin-assembly.mjs --selftest` → exit 1, the same
  5 lines → `git stash pop`). Evidence: `runs/selftest/2026-09-24T22-14-34-940Z/twin.log`.
- **Green on 2026-09-09:** `PROJECT_HISTORY.md:11646` — «53 набора, красных 0, зелёных блоков 2697» (session 96).
  `twin-assembly.mjs` itself last changed 2026-09-08 (`cd66c1a`), so the break came from a dependency or from state
  between 09.09 and 25.09 — candidates by `git log --since=2026-09-09 -- automation-engine/lib/`: `767c862` (KAIF 2.7
  update, 18.09) · `1170a07` (profiles/optimised experiment, 14.09) · `31c613a` (battle snapshot format, 13.09) ·
  the 09.09 series (`bugs/131`–`133`, canary).
- `unknown` is the verdict for «a comparison that did not happen» — a golden, a stamp or an input the rung needs was not
  there; not yet observed which.

## Root cause / Hypotheses

**Observed 2026-09-25 02:00 +03:00, for ONE red (the pinned rung, «ЗАКРЕПЛЕНИЕ»):** a probe copy of the suite printed
that rung's record (`automation-engine/lib/_probe-twin.mjs`, deleted after the run): `"why":"НЕИЗВЕСТНО на 2145 МГц /
790 мВ — оракул не вынес вердикта"`, and in `judged.preflight`: *«эталон снят на драйвере 610.88 / VBIOS
98.03.58.40.8b, а карта сейчас 616.92 / 98.03.58.40.8b — эталон недействителен до перепроверки (R6). Карту не
грузили»*. The golden-stamp preflight compares the goldens with the LIVE card's driver, and the machine moved to 616.92
on ≤ 18.09 (`runs/shell/boot-apply.jsonl`). That was hypothesis (1) of the first edition — a state dependency (the
golden stamp) — with the DRIVER, not the data, as what changed.

**Not observed:** the other four reds. Three more close `unknown` the same way and plausibly share the cause; the
PULSE red (`[false,true,…]`) was not shown to come from the stamp. So the cure below is EXPECTED, not proven.

**Second defect, named:** an «offline» twin whose verdict depends on the real card's driver is a sandbox leak (the class
`profile-manager.mjs` calls «код тайком опирается на состояние машины», `bugs/18`); frozen by epic 101, recorded.

**Withdrawn — a bisect (01:50) proved nothing.** `git bisect start HEAD 75c676d` + `bisect run` with the suite named
`24b2c7d` as «first bad», and the first edition built «it is CODE» and a narrower R12 theory on it. The independent
judge (02:0x, re-run from `git archive` snapshots, no GPU) showed: the «good» end `75c676d` was taken from the 09.09
battery record and not re-run — TODAY it is red with the same FIVE lines as `24b2c7d` and HEAD — and `24b2c7d` is
`75c676d`'s only child, so the bisect could name nothing else. Both the «code» claim and the R12 theory are withdrawn
(corrections also in commits `c3c148e`, `b442d38`). The bisect had side effects: with `core.autocrlf=true` it rewrote
~227 files with CRLF — `npm run check` went red on the prayer guard (fixed by form, `30a35b7`) and a battle snapshot's
recorded source hash stopped matching (restored; fixed by form, `.gitattributes curves/** -text`, `8dacf8d`). Lesson —
EXP-0291.

## Fix plan (card day)

1. Re-capture the goldens on 616.92 at stock: `npm run stress -- --capture-baseline` → `--verify-baseline`
   (`plans/102` Ш8, step 2).
2. Re-run `node automation-engine/lib/twin-assembly.mjs --selftest` — expect 0 red. Any red left (the PULSE block
   above all) is a separate cause: print its record the same way before any theory.
3. Unfrozen later: stop the twin reading the live card's driver (the sandbox leak).

## Decisions made without the owner

- `[AI]` Not investigated now: the twin is frozen by epic 101 and is not on the new path (the mode check does not use
  it); the red suite is named in STATUS so it does not hide the next red.

## Links

`plans/101` (the freeze) · `bugs/88` · `bugs/89` · `tools/selftest-all.mjs`

## ✅ STATUS: DONE (2026-09-25 20:1x +03:00)

Hygiene: `npm run selftest:all` — 55 suites, 0 red, 2824 green blocks; `twin` 30/30 (log
`runs/selftest-all-2026-09-25-evening2.log`).
Functional run: the cure was a live act — `npm run stress -- --capture-baseline` plus the four `furnace` intensity levels
(`--workload furnace --arg 2400 --arg 8192 --arg 256 --arg 64|48|32|20`) on the card at 616.92, 18:57–18:59; the 6
goldens that existed on 610.88 came back byte-identical in checksum (only the stamps changed); `canary.json` and the
default `furnace.json` are new (no 610.88 copy — ✏️ corrected after the judge); `--verify-baseline` — 8 of 8.
Root cause confirmed by the cure: all five reds were the stamp gate (R6) on 610.88 goldens against the 616.92 driver —
the one proved at 02:00 and the four it predicted.
