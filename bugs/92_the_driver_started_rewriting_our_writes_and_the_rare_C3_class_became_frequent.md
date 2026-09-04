# Баг 92 — драйвер начал править НАШИ записи: редчайший класс C3 за один вечер всплыл дважды

**Статус:** 🔴 ОТКРЫТ · **Заведён:** 2026-08-31 (сессия 73) · **Найден:** двумя живыми прогонами
подряд · **Цена:** это ЕДИНСТВЕННАЯ причина, по которой аварийная защита не смогла вернуться на
пост и вечер кончился. И это факт о ЖЕЛЕЗЕ ИЛИ ДРАЙВЕРЕ, а не о нашем коде.

---

## Симптом

Класс отказа записи **C3 — «драйвер правит результат»** до сегодняшнего дня был **одним случаем за
всю историю журнала** (`seq 702`, разобран в `bugs/50`). За один вечер 2026-08-31 он всплыл дважды:

**Случай 1 — прогон 2872…2812, ступень 2872 МГц / 875 мВ:**
```
КЛАСС ОТКАЗА C3 — драйвер правит результат: кривая после записи предлагает
на 15 МГц ВЫШЕ потолка, чего вектор дать не может по арифметике;
в управляющей структуре при этом 0 расхождений (инертных 0) — поточечная сверка ЗЕЛЁНАЯ
максимум кривой 2887 МГц при потолке 2872
```

**Случай 2 — прогон 2145…2000, шестое срабатывание защиты, рука возврата напряжения:**
```
outcome | ВЗН | stock-voltage-verified | ok=false | ms=3778.83 |
C3 — драйвер правит результат: 127 записей легли не туда, куда послал вектор
```

**127 записей из 127.** Вся кривая.

## Почему это отдельный тикет, а не строка в `bugs/50`

`bugs/50` разбирал ОДИН случай и называл его редким; на этом основании проект жил год. Сегодня
частота изменилась на порядок, а во втором случае поражена **вся кривая целиком**, а не одна точка.
Это другое явление по масштабу, и подшивать его к старому тикету значило бы спрятать изменение
частоты внутри документа, чей вывод («один случай за историю») стал ложным.

🔴 **И самое тревожное:** во ВТОРОМ случае C3 случился в руке СПАСЕНИЯ. То есть механизм, которым
мы возвращаем карту в безопасное состояние, сам оказался под тем же отказом. Он честно доложил
`ok=false` и защита честно отказалась продолжать — но если бы драйвер портил записи МОЛЧА, возврат
к стоку был бы заявлен успешным, не будучи им.

## Что известно, а что нет

| Известно | Не известно |
|---|---|
| Поточечная сверка управляющей структуры ЗЕЛЁНАЯ — расхождений 0 | почему при зелёной сверке результат другой |
| Карта ПОСЛЕ обоих прогонов заводская: ненулевых сдвигов 0, 300 Вт | воспроизводится ли C3 по требованию |
| Драйвер 610.88, VBIOS 98.03.58.40.8b — те же, на которых снят весь архив | связано ли это с нагревом, с длительностью сессии, с числом записей подряд |
| Второй случай пришёл ПОСЛЕ пяти срабатываний защиты за 18 с | является ли череда записей причиной или совпадением |

## Первый шаг разбора (НЕ починка)

1. **Опись по архиву:** сколько C3 в `runs/sweep/journal.jsonl` за всю историю против сегодняшних.
   Инструмент считает `writeFailureClass` — поле есть, счётчика нет.
2. **Сверить с каналом драйвера:** были ли события `nvlddmkm` в окно обоих случаев. Канал уже
   читается (`driver-voice.mjs`), архив есть.
3. Только потом — гипотезы о причине. **Три двери: выдумывать механизм запрещено.**

## Ворота приёмки

| # | Критерий | Шкала · Прибор · Порог |
|---|---|---|
| B92-AC1 | Частота C3 ИЗМЕРЕНА по всему архиву, а не оценена | Прибор: счётчик по `writeFailureClass` · **Порог: число с датами** |
| B92-AC2 | Молчаливый C3 невозможен: возврат к стоку не может доложить успех, не перечитав | **Порог: 0 путей, где `ok=true` без перечитывания** |

## Решения, принятые без владельца

Ни одного. Отдельно: **это может оказаться дефектом драйвера или деградацией карты, а не нашим
кодом** — и такой вывод я делать не вправе без замера.

## Связи

`bugs/50` (первый и до сегодня единственный случай) · `bugs/45` · `plans/82` ·
`runs/death-watch/2026-08-31T14-03-05-531Z-fuse.jsonl` · `runs/sweep-session73*.log`.

---

## ✏️ 2026-09-04 12:0x (session 81) — CASE 2 IS REFUTED AS A DRIVER EVENT: it was OUR OWN write, racing the rescue hand

Read in `runs/death-watch/2026-08-31T14-03-05-531Z-fuse.jsonl:28-30` against `runs/sweep/journal.jsonl`:
hand 2 wrote stock at 17:04:38.240 (+03:00) and verified at 17:04:42.057 — **«127 записей … `want 0,
got 113000`»**. In that same window the sweep wrote **seq 833** (intent 17:04:38, 2115 MHz ← 815 mV,
**`deltaMhz: 113`**). The number hand 2 «found» is the next rung's raise, not a driver rewrite. The
identical pattern repeated on 04.09 (hand 2 stock 10:56:22.372 → verify 10:56:26.530 «got 75000» on
126 points; **seq 857** intent 10:56:23, **`deltaMhz: 75`**). Two cases, two exact matches.

**What this changes in this ticket:** the sentence «во ВТОРОМ случае C3 случился в руке СПАСЕНИЯ»
stays true as an observation and becomes false as a diagnosis — the hand's verifier cannot tell «the
driver rewrote my zeros» from «the sweep wrote after me», and labelled a race as C3. The frequency
count B92-AC1 must EXCLUDE rescue-hand C3s whose numbers match an open intent of the journal.
**Case 1** (a settled write whose curve offers 15 MHz above the cap — seq 702, and again seq 845 on
04.09, both PASS) is untouched by this and remains the open question of this ticket.

Race, per-rung stop and the unmounted progress input — `bugs/101`. Lesson — EXP-0233.

## ✅ B92-AC1 TAKEN 2026-09-04 12:1x — the count, by the journal, not by memory

`writeFailureClass` over all **864** verdict lines of `runs/sweep/journal.jsonl`: `—` 850 · **C3 12** · C5 1 · C1 1.

| day | C3 write-path cases | verdicts | seqs |
|---|---|---|---|
| 2026-08-24 | 1 | PASS/void | 702 (the `bugs/50` case) |
| 2026-08-25 | 2 | PASS | 743 · 764 |
| 2026-08-26 | **6** | PASS ×6 | 786…791 — one band, six rungs in two minutes |
| 2026-08-30 | 1 | **ЗАВИС** | 808 (2857 MHz / 885 mV — the unremeasured hang, EXP-0231 «not for») |
| 2026-08-31 | 1 | PASS | 824 |
| 2026-09-04 | 1 | PASS | 845 (2737 MHz, «offers 15 MHz above the cap») |

Plus the two rescue-hand refusals (31.08 `…14-03-05-531Z`, 04.09 `…07-50-16-246Z`) — **both the race of `bugs/101`, excluded from this count.**

**What the number says.** «One case for the whole history» was never true: the class had 6 cases on 26.08 alone, before this ticket was filed; and in 11 of 12 write-path cases the rung went on to a PASS — the curve offered above the cap after a settled, point-by-point-green write, and the card held the ceiling anyway (the lock — `plans/83`). The one hung C3 (seq 808) is the only case where a verdict coincided with the class, and that hang has no remeasurement. So the open question narrows to: **why does a settled write sometimes offer 7…15 MHz above the cap, and does the bound (`-lgc`) make that harmless by construction** — a question for the live card with the owner (read the offered top after a write with the bound armed, at rest and under load), not for a driver-defect hypothesis.
