# Bug 103 — the polygon reddens EVERY generated card by guard И2 («stop named, exit code 0»), and the polygon's report does not print the line that matched

**Status:** 🟡 FIXED 2026-09-04 12:3x (session 81), the 30-card witness pending — the cause was READ from the polygon's own log (below): the bare marker `'АВАРИЙНАЯ'` matched the fuse's STARTUP banner on the twin. Marker replaced by the declaration of a trip (`'СРАБОТАЛА АВАРИЙНАЯ ЗАЩИТА'`); two blocks in `polygon-guards --selftest` (22 → **24**): the banner at exit 0 → green, the live trip line at exit 0 → red; mutation «вернуть голое АВАРИЙНАЯ» reddens the banner block alone; trap `b67` untouched and red as before. `npm run polygon -- --count 1` → **пройдена 1 из 1** (was 0 of 3); `--count 5` at 12:36 → **5 of 5, 188 s**; `--count 10 --seed-base 2000` at 12:44 → **10 of 10, 468 s** (16 cards green in total, two seed bases). **Left:** B103-AC3's `--count 30` (30 minutes of machine time; run it before the next `plans/71` claim) · **Filed:** 2026-09-04 12:2x (session 81, offline) · **Found:** `npm run polygon -- --count 3` run as an end-to-end regression after the per-rung `stopWhen` fix (`bugs/101` finding 2) · **Severity: high for the bench, none for the card** — the polygon is the instrument that certifies the engine on unknown GPUs (`plans/71`, closed 30/30 on 2026-08-29); a polygon that is red on every card certifies nothing.

⚠️ **ZERO GPU WRITES.** The polygon runs the engine on generated cards in a separate process.

---

## Symptom

| run | cards | result |
|---|---|---|
| 12:23, engine at `bc90b36` (per-rung stop) | seeds 1000 (typical) · 1001 (cold-lucky) · 1002 (hot-unlucky), amplitude 0.7 | **3 of 3 red**, class **И2**: «прогон объявил остановку и вернул КОД 0» |
| 12:25, engine at `bc90b36~1` (BEFORE today's change, `git show … > engine.mjs`, restored after) | seed 1000 | **red, same class** — the defect PREDATES today's fix |

Each card's run itself finishes normally: the twin's `live.json` says `ПРОГОН ЗАВЕРШЁН`, coverage 5/5, verdicts `lever-limited` 3, no open intent (И3 silent). So a line of the engine's report contains one of `DEFAULT_STOP_MARKERS` — `'ОСТАНОВЛЕН', 'СТОП', 'ПРЕДОХРАНИТЕЛЬ СРАБОТАЛ', 'ТРИП', 'ОТВЕРГ ЗАПИСЬ', 'АВАРИЙНАЯ'` (`polygon-guards.mjs:158`) — while the exit code is 0, and И2 (built for `bugs/67`) fires.

## Forensics — and the second defect

- ✏️ **RETRACTED 12:3x — the «line is not printed / capped at 200» claim was MY OWN `cut -c1-200` on the background task's output; the polygon prints the guard's line whole.** Left visible rather than deleted: a ticket that blamed the instrument for the reader's pipe is itself the lesson (EXP-0232's second half — never write a diagnosis on a hypothesis). The real line, from the polygon's full log:

  > `Строка: «⚡ АВАРИЙНАЯ ЗАЩИТА (САЗ, двойник): pid 32164, НЕ ВЗВЕДЕНА (только наблюдение); протокол в песочнице …»`

  **Diagnosis, read not guessed:** `DEFAULT_STOP_MARKERS` carried the bare word `'АВАРИЙНАЯ'`; since the fuse was renamed to САЗ (`researches/32`, session 73) the fuse's STARTUP banner on the twin contains «АВАРИЙНАЯ ЗАЩИТА» — on every card, with exit 0 — so И2 fires on a healthy run. The marker matched a mention of the protection, not a declaration of a stop. Same family as `bugs/102` (evidence computed and then thrown away one line before the reader).
- A direct re-run of the engine on the card is not one command: `benches/runs/virtual-virtual-gpu_1002.json` is the twin's CURVE DOCUMENT (`kind: tuning-curve`), not the card; the generated card file the polygon fed is not kept under that name (`polygon.mjs:130` writes it, the path is not printed). Reproduction therefore goes through the polygon itself.

## Hypothesis (a reading of the marker list, not a diagnosis)

Since 2026-08-29 the sweep's summary gained lines that the marker list was never checked against: `СРАБАТЫВАНИЙ АВАРИЙНОЙ ЗАЩИТЫ: … Полоса от этого НЕ останавливается` (bugs/90, `29358f4`), `🗣 ГОЛОС ДРАЙВЕРА …` (bugs/96, `911a270`), the «ЖДУ АПВ / АПВ УСПЕШНО» lines (Ш5, `2d0f547`), the «ОСТАНОВЛЕНО (…)» trailer of `--log` (bugs/93, `bd425ea`). `String.includes` is case-sensitive, so `'АВАРИЙНАЯ'` does not match `АВАРИЙНОЙ`; `'СТОП'` DOES match `ВНЕШНИМ СТОПОМ`, `'ОСТАНОВЛЕН'` matches `ОСТАНОВЛЕНО` — a summary that names a stop that did NOT happen (or a defended-against one) would trip И2 with code 0. **Which line — read it, do not guess:** step 1 below.

## Fix plan

1. **Print the evidence** (five minutes, and it is the `bugs/102` rule): the polygon's red line prints the guard's `line` field in full; a block in `polygon-guards --selftest` / `polygon --selftest` that the printed red carries the matched string.
2. Re-run `npm run polygon -- --count 1` and READ the line. Then either the marker list gains a word boundary / a whitelist of summary lines that mention stops without declaring one, or the summary line is reworded — decided by what the line says, and the twin trap `b67` (`polygon-guards.mjs:345`) must stay red.
3. Bisect if step 2 is not conclusive: the five commits above between the last green polygon (`plans/71`, 29.08 23:0x) and today.
4. Re-run the full polygon (`--count 30`) and restore the 30/30 line in `plans/71` / STATUS, or name the true number.

## Acceptance

| # | criterion | scale · meter · target |
|---|---|---|
| B103-AC1 | the polygon prints the matched line of a red И2 | `npm run polygon -- --count 1` output; target: the `Строка: «…»` text present |
| B103-AC2 | the cause is a READ line, not a reasoning | this ticket quotes the line |
| B103-AC3 | polygon green again without weakening И2 | `polygon-guards --selftest` trap `b67` still red; `--count 30` → 30/30 or the honest number |

## Decisions made without the owner

None. Nothing changed; the pre-fix engine was restored byte-for-byte (`git checkout -- automation-engine/engine.mjs`, tree clean).

## Links

`bugs/67` (И2's origin) · `bugs/102` (evidence thrown away one line before the reader) · `bugs/101` (the change whose regression test found this) · `plans/71` (polygon closed 30/30 on 29.08) · `automation-engine/lib/polygon-guards.mjs` (`guardStopIsNamedAndExitCodeAgrees`, `DEFAULT_STOP_MARKERS`) · `automation-engine/lib/polygon.mjs:160`
