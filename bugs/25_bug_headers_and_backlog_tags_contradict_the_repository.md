# Bug 25 — bug headers, DONE tags and the STATUS bug list contradict the repository: the project holds TWO diverging truths about what is open

**Status:** 🔴 OPEN — found by the 2026-08-21 audit (`ideas/08`)
**Version/build:** `main` @ `3d0a9ac`
**When/context:** 2026-08-21, audit pass over `bugs/*` headers vs STATUS session blocks vs
commit history. Documentation defect — no code, no card.

## Symptom

The canon says a document's own header is its truth (`AGENT_GUIDE.md` checklist step 18: after
implementing, «write the status and the implementation date back into it»; `/check-backlog`:
DONE work is renamed `git mv` + status section appended). Measured against that rule:

| file | its own header says | reality (STATUS blocks + commits) |
|---|---|---|
| `bugs/12` | «🔴 ОТКРЫТ — чинится в этой же сессии» | fixed `02c4bcd`, six mutations; two named tails remain |
| `bugs/14` | «🔴 ОТКРЫТ — три дефекта» | fixed in sessions 28–29 (STATUS lists all three as closed) |
| `bugs/17` | «🔴 OPEN · МАКСИМАЛЬНЫЙ ПРИОРИТЕТ» | closed by mechanism (Stop hook → `tools/tidy.mjs`), STATUS session 29 |
| `bugs/18` | «🔴 OPEN» | fixed `2fac685`, 5 blocks, 4 mutations (STATUS: ✅) |
| `bugs/20` | «🔴 OPEN» | fixed `901a123` («fix(bugs/20): своя смерть писателя больше не приписывается карте») |
| `bugs/13` | «✅ ЗАКРЫТ в тот же час» | closed but never renamed `13_DONE_…` |
| `bugs/15` | «✅ DONE (2026-08-16 13:2x)» | closed but never renamed `15_DONE_…` |

Adjacent faces of the same rot, found by the same pass:

- **`STATUS.md` → «Открытые баги»** still lists `bugs/20` as 🔴 open and describes the fix as
  future («Чинится закрытием намерения…») although the fix is committed; the section disagrees
  with the session-32 block a few hundred lines above it in the same file.
- **`PROJECT_ARCHITECTURE_INTERNAL_MAP.md` header** says «Updated: 2026-08-09» and «the
  orchestrator is designed, not yet written» — while rules R14–R18 in the same file are dated
  2026-08-15…17 and the orchestrator has 30+ modules on disk. The body is maintained; the
  header lies about it.
- Closed plans not DONE-tagged: `plans/15` (phase 2 — judged closed 2026-08-16), `plans/17`,
  `plans/18` (epic 03 phases 1–2, epic closed whole).

## Why it matters — this is not pedantry

1. **The backlog is computed from these signals.** `/check-backlog` and `/resume` treat a
   non-DONE filename and an OPEN header as work. A fresh session (or an autonomous loop
   grinding the backlog) picks up `bugs/17` «МАКСИМАЛЬНЫЙ ПРИОРИТЕТ» and re-fixes a fixed
   defect — the owner pays for the same work twice.
2. **Two truths is the drift-pair shape the canon itself bans** (`AGENT_GUIDE.md` — a prose
   changelog in a header is «an unlintable drift pair»). Here the pair is
   «STATUS session block ↔ bug header», and it has already diverged in seven files.
3. It hides real state: the audit had to consult commit history to learn what is actually open
   — exactly the archaeology STATUS exists to make unnecessary.

## Root cause

Sessions close under time pressure at the STATUS level (the session block is meticulously
written) but the per-document write-back — the LAST step of the bug framework — is skipped.
No gate checks the agreement: nothing red ever appears when a bug is fixed and its header is
not. `/check-backlog` exists and would have caught most of this, but it has not been run since
the rot began (its own trigger is «periodically in autonomous loops» — and recent sessions
were all interactive).

## Fix plan

1. One `/check-backlog` pass: for each row of the table above — verify against the code/commits
   (not against STATUS alone), append the status section, update the header, `git mv` to
   `NN_DONE_…` where truly done. Bugs with named open tails (`12`, `21`, `18` live-proof
   pending) stay open but their headers must SAY the current truth.
2. Refresh `STATUS.md` → «Открытые баги» from the corrected headers.
3. Fix the internal map header (Updated date + drop the «not yet written» caveat).
4. Follow-up (named, not done here): a cheap agreement check — the `/fable-judge` or a lint
   step that greps `bugs/*` non-DONE headers for «✅|DONE» and DONE-files for «OPEN», so the
   two truths cannot drift silently again.

## Verification by observation

`ls bugs/ plans/` matches the audited reality; a grep for `✅` in non-DONE filenames returns
only files whose open tails are named in the header.

---

## Ревизия сессии 65 (2026-08-30 00:1x) — расхождения названы ПОИМЁННО

Тикет до сих пор говорил о классе. Ниже — конкретные экземпляры, найденные машинным триажем
(`/check-backlog`: 58 открытых планов, 25 открытых багов, 12 идей) и сверкой каждого файла с его
родителем. **Свидетель закрытия фазы — строка её эпика, а не память агента.**

### Исправлено этой ревизией

| файл | что говорила шапка | что говорил репозиторий | сделано |
|---|---|---|---|
| `plans/70` | «🟠 К ИСПОЛНЕНИЮ» | `plans/71_DONE` шапка: «Предыдущая фаза: `plans/70` — ✅ закрыта» | тег `DONE`, раздел статуса |
| `plans/02` | без тега = открыт | `plans/01` § Дети: «`plans/02…` ✅»; § Статус: «фазы 1 и 4 закрыты 2026-08-10» | тег `DONE` |
| `plans/04` | без тега = открыт | там же: «`plans/04…` ✅» | тег `DONE` |
| `plans/68`, `plans/69` | «✅ ИСПОЛНЕН» в тексте, но без тега в имени | эпик 67 закрыт целиком | тег `DONE` |
| `plans/67`, `plans/72` | эпик и фаза 5 закрыты словом владельца | — | тег `DONE` |

### 🔴 НАЙДЕНО И НАМЕРЕННО НЕ ТРОНУТО — требует археологии, а не тега

| файл | шапка утверждает | репозиторий говорит обратное |
|---|---|---|
| `plans/13` (ЭПИК 02) | «🔲 распланирован 2026-08-15, **ни строки кода не написано**» | фаза 1 закрыта (`plans/14_DONE`), а в фазе 2 (`plans/15`) стоит «### 4.5 — The sweep: the loop, and the TWO verdicts ✅ **DONE 2026-08-16 00:3x**» |
| `plans/16` (ЭПИК 03) | «🔲 распланирован 2026-08-15, **кода не написано**» | фаза 3 закрыта (`plans/19_DONE`), а виртуальная карта — фундамент, на котором стоят эпики 59 и 67 целиком |
| `bugs/12` | «🔴 ОТКРЫТ — **чинится в этой же сессии**» | та сессия давно кончилась; «эта сессия» в шапке — метка без даты, которая не стареет |

**Почему не закрыты сходу.** Шапка эпика врёт в СТОРОНУ НЕДООЦЕНКИ, и это не значит, что эпик
закрыт: он может быть закрыт, брошен или наполовину исполнен под другим именем. Поставить `DONE`
по одному лишь противоречию — значит заменить одну ложь другой, и вторая будет дороже: закрытый
тег снимает предмет с беклога совсем. Каждому нужен разбор на полчаса с прогоном по родителю и
детям — это отдельный предмет, а не хвост ревизии.

### Урок ревизии, годный для машины

**Шапка документа — не источник его состояния.** Источник — строка РОДИТЕЛЯ (эпик про фазу) или
прогон. Машинный триаж по маркерам внутри файла дал 24 «закрытых» из 58 открытых планов, и при
сверке с родителями подтвердились единицы: маркер `✅` внутри документа чаще всего относится к
ОДНОМУ ШАГУ, а не к предмету целиком. Следующей ревизии начинать сразу со строк родителей.

---

## Ревизия сессии 68 (2026-08-30 18:1x) — закрыта археология, оставленная сессией 65

Сессия 65 назвала поимённо три предмета, «требующих археологии, а не тега». Один (`bugs/12`) закрыт
сессией 67 репро на двойнике. Два остальных разобраны здесь, и разбор дал больше, чем ожидалось.

### Правило, которым велась эта ревизия

Урок сессии 65 исполнен буквально: **начинать со строк РОДИТЕЛЕЙ**. Ни один тег ниже не поставлен по
маркеру внутри самого документа — каждому найден ВТОРОЙ, независимый свидетель: строка эпика, ворота
следующей фазы в документе с уже стоящим тегом, коммит или замер в прогоне.

### Поставлено `DONE` — 8 файлов, каждый с двумя свидетелями

| файл | свидетель 1 | свидетель 2 |
|---|---|---|
| `plans/17` · `plans/18` (эпик 03, фазы 1–2) | `plans/16` §4: вход фазы 3 = «фаза 2 закрыта», вход фазы 2 = «фаза 1 закрыта» | `plans/19_DONE` шапка: «entry gate passed 19:5x», «✅ ИСПОЛНЕНА … все семь шагов и все одиннадцать критериев» |
| `plans/34` (эпик 33, фаза 1) | `plans/33`: «Фаза 1 — Q1 ✅ ЗАКРЫТА 2026-08-23 23:2x (`plans/34`)» | замеры в шапке: `curve` 63/0, 5 мутаций, документ байт-в-байт |
| `plans/35` (эпик 33, фаза 2) | `plans/33`: «Фаза 2 — Q2 ✅ ЗАКРЫТА 2026-08-23 23:5x (`plans/35`)» | `engine --selftest` 320 блоков, 6 мутаций |
| `plans/48` (эпик 47, фаза 1) | `plans/47`: «ФАЗА 1 ЗАКРЫТА 2026-08-25 20:5x (`plans/48`)» | коммит `e83e18d` |
| `plans/49` (эпик 47, фаза 2) | коммит `ca007b7` | собственная шапка «ворота взяты» ⚠️ родитель молчит — см. ниже |
| `plans/50` (прожиг одной формой) | коммит + собственная шапка | **замер в прогоне:** STATUS дважды называет следствие измеренным — «15,0 с ОДНОЙ формой `furnace/sustained@0` (21 из 21 после `plans/50`)» |
| `plans/12` (срез 2 фазы 6 эпика 01) | коммит `92771c7` | собственная шапка «all five steps, zero GPU writes» |

У `plans/34` и `plans/35` раздела «Решения, принятые без владельца» не было вовсе — предусловие тега
по `/check-backlog`. Раздел восстановлен из того, что документы уже записали прозой (правка метода
шага 4 против плана в 34; отказ пересчитывать промах и порог из существующей константы в 35).
Ничего нового при этом не решено, и это сказано в самих разделах.

### 🔴 НАЙДЕНО НОВОЕ — расхождение, которого в тикете не было

**`plans/15` (эпик 02, фаза 2) — фаза исполнена, а расписки судьи нет ни в одном документе.**

| источник | что говорит |
|---|---|
| `STATUS.md` | «✅ ЗАКРЫТА 2026-08-16 **00:5x**, судья: СВЕРЕНО С ОГОВОРКАМИ» |
| `plans/13` §4, строка ворот фазы 2 | «🟢 ВСЕ ДЕВЯТЬ ШАГОВ ИСПОЛНЕНЫ 2026-08-16 **01:1x**, **ЖДЁТ СУДЬИ**» |
| сам `plans/15` | расписки нет; есть только расписка судьи по ФАЗЕ 1, и та лежит в `plans/14_DONE` §9 |

Времена спорят друг с другом: судья якобы прошёл в 00:5x — РАНЬШЕ, чем в 01:1x исполнен последний
шаг. **Заявление о судье невоспроизводимо, а невоспроизводимое заявление — опровергнуто**
(`TESTING_FRAMEWORK.md`). Тег НЕ поставлен; шапка `plans/15` переписана так, чтобы свежая сессия не
приняла её за «фазу надо исполнить» и не исполнила заново. **До тега остался один проход
`/fable-judge` по фазе с распиской в самом документе.**

### Шапки, врущие В СТОРОНУ НЕДООЦЕНКИ, — исправлены

- **`plans/13` (ЭПИК 02)** говорил «ни строки кода не написано». Движок развёртки гоняется каждый
  день. Шапка переписана по фазам: 1 ✅ · 2 🟡 (см. выше) · 3 готова, живьём не запущена · 4–5 впереди.
- **`plans/16` (ЭПИК 03)** говорил «кода не написано». Виртуальная карта несёт на себе эпики 59 и 67
  целиком. Шапка переписана: все три фазы исполнены.

**Оба эпика оставлены ОТКРЫТЫМИ, и причина названа в каждой шапке.** У `plans/16` десять критериев
приёмки E3-AC1…AC10 не несут в файле эпика ни одного записанного вердикта; закрыть эпик по строке в
STATUS — значит заменить одну недостоверную запись другой, а закрытый тег снимает предмет с беклога
совсем. Это и есть правило, которое сессия 65 сформулировала, и оно здесь соблюдено.

### Что осталось открытым по этому тикету

1. **Приёмка эпика 03 (`plans/16`)** — проход по десяти критериям с уликой на каждый. Полчаса.
2. **Судья фазы 2 эпика 02 (`plans/15`)** — один проход `/fable-judge` с распиской в документе.
3. **Строка фазы 2 в шапке `plans/47`** до сих пор говорит «фаза 2 следующая», хотя фаза закрыта и
   помечена. Родитель не записал закрытие своего ребёнка — та же болезнь, вид сбоку.
4. **Пункт 4 исходного плана починки — сторож соглашения** (грепом ловить `✅|DONE` в шапках
   не-DONE-файлов и `OPEN` в DONE-файлах). Без него ревизия остаётся ручной и повторится.
   ⚠️ Это НОВАЯ МАШИНЕРИЯ — под мораторий `interviews/017` Q1, нести владельцу с ценой.

### Урок, добавленный к уроку сессии 65

**Свидетель «ворота следующей фазы взяты» сильнее, чем маркер закрытия предыдущей** — потому что
следующая фаза физически не начинается, пока ворота не истинны, и её собственный тег `DONE`
превращает это в проверяемую цепочку. Именно так закрыты фазы 1–2 эпика 03: ни одна из них не
говорит о себе ничего, что нельзя было бы прочитать в документе, помеченном чужим тегом.
