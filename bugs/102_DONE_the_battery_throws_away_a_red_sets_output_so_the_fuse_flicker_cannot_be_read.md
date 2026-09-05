# Bug 102 — the battery reddens `fuse` and is green alone (second strike), and the runner throws the red lines away, so the flicker cannot be read

**Status:** ✅ **ЗАКРЫТ 2026-09-05 (сессия 85, автономный цикл): AC1 · AC2 · AC3 взяты.** Мигание
ДИАГНОСТИРОВАНО (остаток журнала от прогона с тем же pid), воспроизведено опытом строка в строку,
вылечено `mkdtempSync` во всех девяти песочницах и накрыто сторожем, который краснеет на возврате
класса. Гипотеза тикета про 60-мс подстой хоста опровергнута. Порогов не тронуто — AC3 держится.
Разбор — в разделе «ДИАГНОЗ ПОСТАВЛЕН» ниже. Ниже сохранена история тикета как она была. —
**step 2 HALF-DONE 2026-09-04 15:5x (session 82): the first red battery came with its evidence file and the two red lines are quoted below (section «Witness»); they carried no numbers, so the two blocks now print the sequence they saw — diagnosis waits for the next red.** **step 1 DONE 2026-09-04 12:1x (session 81):** `runSuite(suite, { evidenceDir })` writes a red set's full stdout+stderr to `runs/selftest/<battery ISO stamp>/<set>.log` and appends `улика: <path>` to `why`; green sets leave nothing; `runBattery` passes one dir per battery. Proof: block F in `selftest-all --selftest` (5 → **6**) — red fixture A leaves `A.log` containing «ПЛОХО два» and names it, green fixture D leaves no file; mutation «снять writeFileSync» → `ПЛОХО F … файл есть=false`, A…E stay green; `npm run check` green; `--only prayer,shrink` (green) creates no `runs/selftest/` at all. **Named debt:** the ONE line `runSuite(suite, { evidenceDir })` inside `runBattery` has no block of its own — its witness is the first red battery, whose report must carry the path (B102-AC1 half-taken until then). Steps 2–3 open (need a red to read). Filed by the rule of session 76 («если мигнёт снова — заводить») · **Filed:** 2026-09-04 12:1x (session 81, offline) · **Found:** `npm run selftest:all` at 12:07 — `КРАСНЫЙ fuse: код выхода 1 · красных строк 2`, 48 sets, 2482 green; `node automation-engine/lib/fuse.mjs --selftest` alone one minute later — **77 зелёных, 0 красных, exit 0** · **Severity: medium** — a guard suite that flickers trains the reader to ignore red; and the flicker is undiagnosable by construction (below).

⚠️ **ZERO GPU WRITES.** The fuse suite touches no card («карта не трогается, порт только эфемерный»).

---

## Symptom

| when | where | `fuse` | note |
|---|---|---|---|
| 2026-08-31 (session 75) | battery | 🔴 | first strike; session 76 reran the set alone: green 77; ticket deliberately NOT filed, rule set: «если мигнёт снова — заводить» |
| 2026-09-04 12:07 (session 81) | battery | 🔴 exit 1 · 2 red lines | second strike |
| 2026-09-04 12:09 | alone | ✅ 77/77, exit 0 | |
| 2026-09-04 12:10 | battery, rerun | ✅ 48 sets · 0 red · 2484 green | the flicker did not repeat — exactly what an undiagnosable defect looks like |

Same family as the single `dashboard` death inside a battery (STATUS, session 79 note) and the `watchdog` «red in battery, green alone» (STATUS, `plans/82` list item 6). Three suites, one symptom shape: **red only under the battery.**

## Forensics — and why there are none

`tools/selftest-all.mjs` `runSuite()` (line ~395): the set's stdout+stderr are joined, counted by `GREEN_LINE` / `RED_LINE` / `PENDING_LINE`, the summary line is looked up — and the text is **dropped**. The battery report carries the COUNT of red lines and the hint «повторить одной командой», never the lines. For a deterministic suite that is enough; for a suite that reddens only inside the battery the repeat command returns green and the only evidence that existed was in the discarded buffer. **The instrument records that a failure happened and destroys what it was** — the class of `bugs/93` («the run has no log of its own») one floor down.

What CAN be said from the shape: the `fuse` suite is timing-bound (a deadman at N = 60 ms, an ephemeral UDP port, hands spawned as processes — EXP-0165, EXP-0166); the battery runs sets **sequentially** (`spawnSync`), so intra-battery concurrency is not the variable — but the machine's load at that minute is (this session had `node -e` probes and file edits in flight), and 12:07 was minutes after a reboot with the owner's startup apps (NVIDIA Broadcast ×6, Overlay ×5) still settling. **Hypothesis, not a finding:** a 60 ms deadman block reddens when the host stalls > 60 ms for reasons unrelated to the suite. Which two lines — unknown by construction.

## Fix plan — evidence first, diagnosis second

1. **The runner keeps a red set's full output** — `runs/selftest/<battery stamp>/<set>.log`, written ONLY for sets with `ok: false` (a green battery leaves no litter; `runs/` is git-ignored). The report line gains the path. Block in `selftest-all --selftest`: a fixture suite that prints one red line → the file exists and contains it; a green fixture → no file. Mutation: drop the write → red.
2. Then rerun the battery until `fuse` reddens again and READ the two lines. Only then: is it the 60 ms deadman under host stall (→ the suite needs a load guard or a wider budget for the block, decided by the fuse's own numbers), or a port collision (→ the ephemeral port choice), or something else.
3. Close `dashboard` and `watchdog` flickers by the same file, not by three tickets.

## Witness — the first red battery WITH its evidence file (2026-09-04 15:48, session 82)

`npm run selftest:all` right after the 30-card polygon: **47 sets green, `fuse` RED — код выхода 1 · красных строк 2 · улика: `runs/selftest/2026-09-04T12-48-09-473Z/fuse.log`** (the path printed in the battery's red line, as step 1 promised; the ONE unblocked line `runSuite(suite, { evidenceDir })` inside `runBattery` is thereby witnessed — B102-AC1 taken in full). The file holds the suite's whole output, 86 lines, `ИТОГ: 80 зелёных, 2 красных`; the two red lines, verbatim:

> `❌ журнал предохранителя: намерение → снятие нагрузки → возврат напряжения → решение о перевзведении`
> `❌ Ш5 отказ: рука умерла без расписки — судья НЕ перевзвёлся, счёт перевзведений 0`

Both belong to ONE scenario — «живой судья на эфемерном порту» (`fuse.mjs` ~1493): a real judge armed at N = 60 ms, real datagrams fed every 5 ms for 250 ms from a `setInterval` in the same process, then silence; the block before them (**«услышал настоящие удары и трипнул, когда они смолкли»**) was GREEN, so the judge heard > 10 beats, tripped, and hand 1 ran. What the two red lines could NOT say: the journal's actual phase sequence and the counts — the blocks printed their NAME only. **Same session, minutes later:** `node automation-engine/lib/fuse.mjs --selftest` alone — 82/0 green (third time the pattern «red in the battery, green alone» holds: sessions 75, 81, 82).

**What was changed (B102-AC3 kept — zero thresholds touched):** the two blocks now carry a detail string — the phase sequence as seen (`intent → …/рука1 → …/рука2 → rearm(не-ok)`), beats, trips, rearms — and read `journal[3]` optionally, so a short journal reddens the block instead of killing the reporter (EXP-0040). The next red battery will show the sequence in its evidence file.

**Diagnosis — still NOT made (AC2 half-taken):** the evidence names the scenario and the two assertions, not the numbers. The hypothesis stays what the ticket's shape already said — a host stall > 60 ms between fixture beats (the feeder is a `setInterval(5)` in the suite's own event loop, and the battery had just spawned 40+ processes) trips the judge EARLY, and the journal that follows is not the four-line one the block expects. That is a hypothesis to be READ from the next evidence file, not reasoned into a fix.

---

# ✅ ДИАГНОЗ ПОСТАВЛЕН 2026-09-05 (сессия 85, автономный цикл) — И ГИПОТЕЗА ТИКЕТА ОПРОВЕРГНУТА

## Как он получен: не ожиданием третьего мигания, а ЧТЕНИЕМ ФОРМЫ уже собранной улики

Тикет ждал, пока `fuse` мигнёт снова, чтобы прочитать числа. Читать оказалось нечего ждать — форма
улики сессии 82 уже несла ответ, и его никто не спросил:

> **Зелёным остался блок, читающий ВОЗВРАЩЁННОЕ значение** («услышал настоящие удары и трипнул»).
> **Красными стали ровно те два, что читают ФАЙЛ журнала.**

Прибор, который смотрит в память процесса, согласен; прибор, который смотрит в файл, — нет. Значит
расхождение не во времени и не в порогах, а **в содержимом файла**.

## Причина

Девять фикстур набора `fuse` называли песочницу по номеру процесса:

```js
const tmp = path.join(os.tmpdir(), `fuse-selftest-${process.pid}`);   // и ещё восемь таких
```

Судья открывает журнал на **ДОПИСЫВАНИЕ** (`openSync(journalPath, 'a')`), временный каталог Windows
сам не чистится, а **номера процессов переиспользуются**. Батарея запускает сорок с лишним процессов
подряд — совпадение номера с прошлым прогоном `fuse` там много вероятнее, чем у набора, запущенного
в одиночку минутой позже. Отсюда всё разом: «красный в батарее, зелёный отдельно», невоспроизводимость
и то, что обе красные строки принадлежат ОДНОЙ фикстуре.

## Воспроизведено опытом, а не выведено

Проба: положить в журнал одну строку от «прошлого прогона» и прогнать ту же фикстуру.

```
строк в журнале: 5 (блок ждёт ровно 4)
блок «услышал настоящие удары и трипнул» (читает ВОЗВРАЩЁННОЕ): ЗЕЛЁНЫЙ
блок «журнал предохранителя: намерение → …»  (читает ФАЙЛ):     КРАСНЫЙ
блок «Ш5 отказ: рука умерла без расписки»    (читает ФАЙЛ):     КРАСНЫЙ
```

**Строка в строку та же картина, что в улике сессии 82.** B102-AC2 взят.

🔴 **ГИПОТЕЗА ТИКЕТА ОПРОВЕРГНУТА.** «Подстой хоста дольше 60 мс роняет deadman-блок» звучала
правдоподобно и была неверна: она не объясняла, почему зелен именно тот блок, что не читает файл.
Правдоподобие и объяснительная сила — разные вещи, и различает их форма улики, а не убедительность.

## Починка

Все девять песочниц переведены на `mkdtempSync` — уникальны по построению, столкновение невозможно.
Две, которые и раньше были защищены (ручной `rmSync` у пид-файла, `Date.now()` у строки жизни),
переведены тоже: **правило без исключений сторожится одной строкой, а правило с оговоркой требует
помнить оговорку.**

**Сторож:** блок в `fuse --selftest` сканирует собственный исходник и краснеет, если хоть одна
временная песочница снова названа по `process.pid`. Мутация «вернуть одну песочницу к pid-имени» →
красный ровно на нём. Набор `fuse` 108 → **109 блоков**, батарея проекта **2565**, 0 красных.

## Шаг 3 тикета — два других мигавших набора

- **`watchdog`** (мигал по `plans/82`, пункт 6) нёс тот же образец `__selftest-${process.pid}` и
  переведён на `mkdtempSync`. ⚠️ **Это ПРЕДОСТОРОЖНОСТЬ ПО АНАЛОГИИ, а не диагноз:** его песочница
  убирается в `finally`, значит остаток возможен только после аварийного обрыва. Названо честно,
  чтобы никто не прочёл это как «причина найдена и там».
- **`dashboard`** (умер однажды в батарее, сессия 79) образца по pid НЕ несёт; его временный путь —
  общая константа `kago-dashboard-window` окна наблюдения, а не песочница набора. **Не тронут:
  причина его смерти по-прежнему неизвестна**, и записывать её на этот класс без улики значило бы
  закрыть тикет догадкой.

## Acceptance

| # | criterion | scale · meter · target |
|---|---|---|
| B102-AC1 | a red set's text survives the battery | file per red set under `runs/selftest/`; meter: the fixture block; target: 1 file per red set, 0 per green |
| B102-AC2 | the flicker is DIAGNOSED, not reasoned about | the two red lines quoted in this ticket from a saved file |
| B102-AC3 | no suite is weakened to make the battery green | diff of `fuse.mjs` thresholds = 0 until AC2 names the cause |

## Decisions made without the owner

None. The ticket follows the rule session 76 wrote for itself.

## Links

STATUS (session 75 note · session 76 «мигание fuse не воспроизвелось» · session 79 `dashboard` died once in a battery · `plans/82` item 6 `watchdog`) · `bugs/93` (a run without a log) · `tools/selftest-all.mjs` `runSuite` · EXP-0165 · EXP-0166
