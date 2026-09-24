# Bug 139 — the digital twin's suite turned red after 2026-09-09: five blocks, its rungs close `unknown` instead of reaching a verdict

**Status:** 🧊 FROZEN by epic 101 (the twin is frozen machinery — `plans/101` «Что эпик замораживает»); recorded, not investigated
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

Not investigated (moratorium, epic 101). Ranked, for whoever unfreezes the twin: (1) a data/state dependency the twin
reads from the live tree (a golden stamp, a profile, a snapshot) changed on 13–14.09; (2) the KAIF 2.7 update touched a
module the twin imports; (3) date-dependent logic.

**✅ ROOT CAUSE OBSERVED 2026-09-25 02:00 +03:00 — the DRIVER CHANGE, through the golden stamp (hypothesis 1 was
RIGHT; the two paragraphs below overstated the bisect and are corrected here).** A probe copy of the suite printing
the pinned rung's record (`automation-engine/lib/_probe-twin.mjs`, removed after the run) shows:
`"why":"НЕИЗВЕСТНО на 2145 МГц / 790 мВ — оракул не вынес вердикта"`, and in `judged.preflight`: *«эталон снят на
драйвере 610.88 / VBIOS 98.03.58.40.8b, а карта сейчас 616.92 / 98.03.58.40.8b — эталон недействителен до
перепроверки (R6). Карту не грузили»*. The golden-stamp preflight compares the goldens with the LIVE card's driver;
the machine moved to 616.92 on ≤ 18.09 (`runs/shell/boot-apply.jsonl`), so every twin rung that reaches the oracle
is UNKNOWN. ✏️ **The bisect proved NOTHING** (independent judge, 02:0x, re-run from `git archive` snapshots, no GPU):
its «good» end `75c676d` was taken from the 09.09 battery record and not re-run — TODAY it is red with the same six
lines as `24b2c7d` and HEAD; and `24b2c7d` is `75c676d`'s ONLY child, so `bisect run` could name nothing else. An
earlier edition of this paragraph said the bisect «found where the twin STARTED to reach that preflight» — also
wrong, withdrawn. The cause stands on the probe alone: the driver change, through the golden stamp. **Cure: re-capture the goldens on
616.92** (card day, `plans/102` Ш8 order, step 2) — then re-run the suite. **Second defect, named:** an «offline»
twin whose verdict depends on the real card's driver is a sandbox leak (the class `profile-manager.mjs` calls «код
тайком опирается на состояние машины», `bugs/18`); frozen by epic 101, recorded.

**🔎 BISECTED 2026-09-25 01:50 +03:00 (session 102) — ✏️ the heading said «hypotheses 1–3 REFUTED; it is CODE»; wrong
about hypothesis 1, see the paragraph above.**
`git bisect start HEAD 75c676d` · `git bisect run sh -c 'node automation-engine/lib/twin-assembly.mjs --selftest …'`
(exit > 1 → skip) → **first bad commit `24b2c7d`** (2026-09-09 21:55, «fix(bugs/133, ярлык Optimised): ПОДРЕЗКА
ПОРЯДКА — режим владельца снова применяется с рабочего стола») — the applier's order clamp against the worst-case
reference. The twin drives the SAME applier (`curveWriteRefusal` / the vector builder are shared by design, R11–R13
parity), and after the clamp its rungs close `unknown`. Next step when unfrozen: diff the twin's rung inputs at
`24b2c7d^` vs `24b2c7d` — which refusal or clamp the twin's synthetic curve now meets. `git bisect reset` done; ✏️ «tree clean» was wider than the observation: `git status` was clean, but with
`core.autocrlf=true` the checkouts had rewritten ~227 files with CRLF — `npm run check` went red on the prayer guard
(fixed by form, `30a35b7`) and the battle snapshot's recorded source hash stopped matching (restored and fixed by form,
`.gitattributes curves/** -text`, `8dacf8d`). A bisect in this repository is not side-effect-free.
**✏️ REFUTED 02:00 by the probe above — kept for the record. Narrower hypothesis (NOT observed, a 10-minute read, 01:52):** the commit's message says «ПАРИТЕТ: двойник получил тот
же провод» (`virtual-gpu.mjs`, 6 lines) and «ничего не заявлено → R12 отказывает». The twin's pinned rung
(`twin-assembly.mjs:1089`, 2145 MHz / 790 mV through `engine.runRung` → `vf.runStep`) declares no intent — so it
plausibly now meets R12 on the virtual card and closes `unknown`. Check first: print the rung record's refusal at
`24b2c7d` for that block.

## Fix plan (when unfrozen)

Bisect with the suite itself: `git bisect start HEAD <09.09 green commit>` · `git bisect run node automation-engine/lib/twin-assembly.mjs --selftest`.

## Decisions made without the owner

- `[AI]` Not investigated now: the twin is frozen by epic 101 and is not on the new path (the mode check does not use
  it); the red suite is named in STATUS so it does not hide the next red.

## Links

`plans/101` (the freeze) · `bugs/88` · `bugs/89` · `tools/selftest-all.mjs`
