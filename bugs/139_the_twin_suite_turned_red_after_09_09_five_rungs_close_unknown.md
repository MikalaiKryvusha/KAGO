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

**🔎 BISECTED 2026-09-25 01:50 +03:00 (session 102) — hypotheses 1–3 REFUTED; it is CODE.**
`git bisect start HEAD 75c676d` · `git bisect run sh -c 'node automation-engine/lib/twin-assembly.mjs --selftest …'`
(exit > 1 → skip) → **first bad commit `24b2c7d`** (2026-09-09 21:55, «fix(bugs/133, ярлык Optimised): ПОДРЕЗКА
ПОРЯДКА — режим владельца снова применяется с рабочего стола») — the applier's order clamp against the worst-case
reference. The twin drives the SAME applier (`curveWriteRefusal` / the vector builder are shared by design, R11–R13
parity), and after the clamp its rungs close `unknown`. Next step when unfrozen: diff the twin's rung inputs at
`24b2c7d^` vs `24b2c7d` — which refusal or clamp the twin's synthetic curve now meets. `git bisect reset` done; tree clean.

## Fix plan (when unfrozen)

Bisect with the suite itself: `git bisect start HEAD <09.09 green commit>` · `git bisect run node automation-engine/lib/twin-assembly.mjs --selftest`.

## Decisions made without the owner

- `[AI]` Not investigated now: the twin is frozen by epic 101 and is not on the new path (the mode check does not use
  it); the red suite is named in STATUS so it does not hide the next red.

## Links

`plans/101` (the freeze) · `bugs/88` · `bugs/89` · `tools/selftest-all.mjs`
