# Plan 48 — epic 47, phase 1: the bench can SHOW a burn that bought nothing

> **Created:** 2026-08-25 20:2x (agent) · **Parent:** `plans/47_EPIC_the_descent_follows_the_card.md` → phase 1
> **Status:** ✅ **ЗАКРЫТА 2026-08-25 20:5x — ворота взяты, и две находки поправили сам эпик**
> **Outbound:** unblocks phase 2 (the descent re-targets) — which cannot be proved without this

---

## Meta-plan anchor

> *«Фаза 1 — СТЕНД УМЕЕТ ПОКАЗАТЬ ПОТЕРЮ … Сегодня ни одна ловушка не краснеет на том, что прожиг
> куплен и не дал глубины … Ворота: ловушка КРАСНАЯ на сегодняшнем движке, и краснеет она за ПОТЕРЮ,
> а не за что-то соседнее.»*

## Goal vector

**Pain.** The defect costs 36 % of the card's time (4 wasted burns of 11, measured live 2026-08-25)
and **nothing on the bench goes red for it.** T6 already makes the card deliver a frequency other
than the ordered one, and its band still closes green — because "the burn bought no new depth" is
not asserted anywhere. A fix landing on top of that is a fix nothing can redden
(`BUG_FIXING_FRAMEWORK.md` → Guards).

**Where we want to be.** A trap band where two consecutive rungs return the SAME serving voltage on
the SAME delivered frequency, an assertion that says so, and that assertion is RED on today's engine
for exactly that reason — not for a neighbouring one.

**Type:** Achieve (the assertion) + Maintain (no existing bench assertion weakened).

---

## ⚠️ THE LESSON THIS PHASE EXISTS TO OBEY

EXP-0148, paid for one day ago on this same epic's neighbour: **an incidental catch and a direct
check look identical while both are red.** Phase 1 of epic 43 built a trap that went red for the
wrong reason, and it took a reverted experiment to notice.

So this phase's gate is not «the assertion is red». It is **«the assertion is red, and removing the
mechanism that should cause it turns it green»** — proved by mutation, before phase 2 touches the
descent.

---

## Acceptance criteria — scale · meter · target

| # | Criterion | Meter | Target |
|---|---|---|---|
| F1-AC1 | The bench PRODUCES a wasted burn | rungs whose `servingMvAfter` equals the previous rung's on the same `deliveredMhz` | `npm run traps` | **≥ 2** on the trap band · ⚠️ шкала уточнена по замеру: считается «не дал НОВОЙ ГЛУБИНЫ», а не «совпал с предыдущим» — см. находку 1 |
| F1-AC2 | And it is a REAL waste, not a repeat order | the ORDERED voltages of those rungs differ | the same run | ordered values **distinct**, serving value **identical** |
| F1-AC3 | The assertion is RED on today's engine | `npm run traps` | the new assertion **fails**, and its reason names the wasted burns by number |
| F1-AC4 | It is red for THE RIGHT reason | mutation: make the card deliver exactly what was ordered | the assertion goes **green** — i.e. it tracks the divergence, not the band · 🔴 **ОПРОВЕРГНУТ ЗАМЕРОМ 2026-08-25, см. находку 2 внизу: мутация дала 30 → 14, а не 0** |
| F1-AC5 | The run's summary COUNTS the waste | `npm run bench` / live summary | a line naming «прожигов без новой глубины: N» |
| F1-AC6 | Nothing existing weakened | `npm run selftest:all` | red 0, block count does not decrease |
| F1-AC7 | Zero GPU writes | burn log | **0** |

---

## Steps

- [x] **0.** Re-read `plans/47` findings F1–F6 and EXP-0148. The trap must fail for the waste, not
      for the divergence T6 already covers.
- [x] **1. Decide the trap card.** Prefer REUSING T6 (it already delivers below the order) over a
      ninth card — a new fiction field is a new thing to keep true. Check first whether T6's band
      actually produces two same-serving rungs; if it does, the trap is an assertion, not a card.
- [x] **2. The counter.** The waste is a property of a SEQUENCE, not of a rung (same class as
      `bugs/42`), so it is computed where the sequence lives — over the run's harvested rungs, which
      already carry `deliveredMhz` and `servingMvAfter` (finding F3). No new measurement is needed;
      this is arithmetic over what the journal already holds.
- [x] **3. The assertion**, worded so it cannot pass vacuously: an EMPTY list of rungs must not read
      as «no waste» (the `bugs/40` class — a heading matched without reading what is under it).
- [x] **4. The summary line** (F1-AC5) — the operator must see the number without opening the journal.
      One line, and it prints **0** honestly when there is no waste.
- [x] **5. Blocks and mutations.** Addressees named before the run:
      **PA.** make the trap card deliver exactly the ordered clock → the assertion goes GREEN (F1-AC4) ·
      **PB.** count waste by ORDERED voltage instead of SERVING → the assertion goes green while the
      waste is still there, which is the defect this trap exists to catch ·
      **PC.** let the empty list read as «no waste» → the vacuous-pass block reddens.
- [x] **6.** `npm run check` · `traps` · `selftest:all`, then `plans/49` for phase 2.

---

## Risks

| Risk | Tier | Mitigation |
|---|---|---|
| The trap goes red for T6's existing divergence rather than for the waste | **(a)** | F1-AC4's mutation is exactly this discriminator; EXP-0148 is why it is a gate and not a nicety |
| A ninth trap card is added where an assertion would do | **(b)** | Step 1 checks T6 first. Every card is a fiction that must stay true to the measurement |
| The counter double-counts inherited rows as burns | **(b)** | It counts RUNGS (burns), never document rows — the run's own summary already keeps those numbers apart («закрыто ≠ доказано») |

---

## Decisions made without the owner

- *(filled at closing)*

---

## ✅ ЗАКРЫТО 2026-08-25 20:5x — что сделано и чем доказано

**Приборы после работы:** `check` ✓ 56 файлов / 396 текстов · батарея **28 наборов, красных 0,
1385 зелёных блоков** (было 1373) · `traps` **60 утверждений, провалов 0, ЖДЁТ 1** ·
**записей в видеокарту 0** (сторож не взведён, карта 300 Вт заводских, журнал прогонов не вырос:
1535 строк до и после).

| # | Критерий | Цель | Замерено |
|---|---|---|---|
| F1-AC1 | стенд ПРОИЗВОДИТ пустой прожиг | ≥ 2 | **30 из 61** на полосе T6 (49 %) |
| F1-AC2 | это настоящая трата, а не повторный заказ | заказы различны | **30 разных заказанных пар на 30 трат** — ни одну не ловит сторож `bugs/42` |
| F1-AC3 | утверждение КРАСНОЕ на сегодняшнем движке | красное | **прогнано красным:** «провалов 1», причина называет 30 из 61 и механизм |
| F1-AC4 | красное по ПРАВИЛЬНОЙ причине | мутация зеленит | ⚠️ **мутация плана ОПРОВЕРГНУТА замером — см. находку 2** |
| F1-AC5 | сводка СЧИТАЕТ трату | строка есть | есть, и печатает 0 честно; на обычной репетиции — «24 из 89 (27 %)» |
| F1-AC6 | ничего не ослаблено | красных 0, блоков не убыло | **0 красных, блоков +12** (journal 57 → 66, traps 56 → 59) |
| F1-AC7 | ноль записей в карту | 0 | **0** |

### Шаг 1 решён ЗАМЕРОМ: девятой карты не нужно

Полоса T6 **уже** жжёт впустую — её просадка уводит спуск разных ЗАКАЗАННЫХ частот на одну
ВЫДАННУЮ, и второй спуск проходит по ней всю лестницу заново, хотя глубина там доказана первым.
Ловушка — утверждение, а не карта. Каждая карта это вымысел, который надо держать верным; вымысел,
которого можно не заводить, не заводят.

### Где живёт счёт — в `harvestPairs`, а не рядом

Трата — свойство ПОСЛЕДОВАТЕЛЬНОСТИ, и последовательность уже проходит через `harvestPairs`: она
идёт по ступеням по порядку, группирует по выданной частоте и держит самое глубокое напряжение.
Второй автор счёта был бы парой «истина ↔ зеркало» внутри одного модуля. Побочная выгода, которой
не планировали: счёт достался и `harvestFromJournal`, поэтому **любой прошлый прогон перемеривается
с диска без единого нового прожига** (EXP-0146).

### 🔴 НАХОДКА 1 — «4 из 11» в эпике меряно НЕ ТОЙ МЕРКОЙ

Прочитан боевой журнал вечернего прогона (11 ступеней, `runs/sweep/journal.jsonl`, 19:51→19:58) и
посчитаны все четыре кандидатные мерки:

| мерка | сегодня |
|---|---|
| обслужившее напряжение не дало новой глубины на выданной частоте | **2 из 11** |
| совпало с предыдущей на той же выданной частоте (написано в шкале E47-AC1) | **2 из 11** |
| **карта не отдала ЗАКАЗАННОЕ напряжение** ← отсюда «4» | 4 из 11 |
| заказали частоту, которую предыдущая не выдала (E47-AC2) | 10 из 11 |

«Карта не отдала заказ» и «прожиг ничего не купил» — РАЗНЫЕ факты. Ступень 761 заказывала 820,
получила 840 — на 5 мВ **глубже** предыдущих 845, то есть прожиг купил глубину. Пустая только 762.
**Цель E47-AC1 исправлена на измеренную: 2 → 0.** Заголовок критерия («прожиг, не давший новой
глубины») с самого начала говорил правильную вещь; неверны были его шкала и число под ней.

### 🔴 НАХОДКА 2 — МУТАЦИЯ PA ОПРОВЕРГНУТА, И ДЕФЕКТ ОКАЗАЛСЯ ШИРЕ ЭПИКА

Шаг 5 PA обещал: «заставить карту выдавать ровно заказанное → утверждение ЗЕЛЕНЕЕТ, то есть следит
за расхождением, а не за полосой». Прогнано: `governorBelowCeilingMhz` 60 → 0 дало **30 → 14**
пустых прожигов (не 0), а повторно жжённых частот стало **БОЛЬШЕ**: 8 из 11 против 7 из 8.

**Причина названа замером:** под андервольтом карта ПРОСЕДАЕТ, и разные заказанные частоты сходятся
на одной выданной БЕЗ всякого регулятора. Трата — свойство **СХОЖДЕНИЯ**, а не свойство ловушки.

Подтверждение на карте без единой ловушки: обычная репетиция `npm run bench --from 2857 --to 2790`
даёт **24 пустых прожига из 89 — 27 % полосы**.

**Что это меняет для фазы 2:** целиться надо в схождение («карта выдала частоту, чья глубина уже
доказана в этом прогоне»), а НЕ в «карта не отдаёт заказанную частоту». Второе — частный случай
первого, и починка по нему оставила бы 27 % трат на обычной карте.

### 🔴 НАХОДКА 3 — УТВЕРЖДЕНИЕ ОБЕЩАЛО БОЛЬШЕ, ЧЕМ ЕГО ПОЛОСА ДОКАЗЫВАЕТ

Ряд 2 назывался «…и считает по ОБСЛУЖИВШЕМУ напряжению, а не по заказанному». Мутация PB (считать
по заказанному) покрасила на T6 **ноль**: на этой карте заказанное и обслужившее почти совпадают,
и полоса такого различения не даёт вовсе. По EXP-0150 это замер отсутствующего покрытия, а не
крепкий код. Ряд переименован в то, что полоса действительно доказывает; различение перенесено в
блоки `journal --selftest` на ЖИВОЙ фикстуре полосы 2355 (заказ 820 → обслужило 840), где та же
мутация красит два блока и обнуляет реальную трату.

### Мутации — прогнаны, каждая названа ДО прогона

| | мутация | ожидание | что вышло |
|---|---|---|---|
| **PA** | карта выдаёт ровно заказанное (`governorBelowCeilingMhz` 60 → 0) | утверждение зеленеет | ❌ **30 → 14, осталось красным** — находка 2 |
| **PA′** | ключевать пару ЗАКАЗАННОЙ частотой вместо выданной | траты исчезают | ✅ **7 блоков красных**, в т. ч. два новых |
| **PB** | считать по ЗАКАЗАННОМУ напряжению вместо обслужившего | зеленеет, пока трата на месте | ✅ **2 блока красных** на живой фикстуре; на T6 — ноль (находка 3) |
| **PC** | вакуумный проход: пустой список читается как «трат нет» | блок вакуумности краснеет | ✅ **ровно свой блок, и только он** |

### Почему обязательство стоит «ЖДЁТ», а не красным

Ряд 4 **был прогнан красным** («провалов 1», 30 из 61) и только после этого объявлен ждущим —
по той же объявленной причине, по которой стояла T8 между фазами 1 и 2 эпика 43: держать
репозиторий красным между фазами нечестно перед следующей сессией, а молча зазеленить утверждение
о непочиненном дефекте — нечестно перед дефектом. Фаза 2 переводит `pending` → `check`.

## 💸 Долг, найденный по дороге и НЕ закрытый

**Поле `openPhase` у ловушки T8 пережило свою фазу.** Его собственный комментарий говорит: *«Поле
исчезает вместе с закрытием фазы 2»*. Фаза 2 эпика 43 закрыта коммитом `58260e6`, поле на месте, и
`ЖДЁТ` у T8 сегодня 0 — то есть послабление объявлено и никем не используется. Не снимал намеренно:
это закрывающий долг эпика 43, а не 47, и трогать силу чужого сторожа в чужой фазе — не моё дело.
Снимается одной строкой в `virtual-gpu.mjs` → `TRAPS`.

## Decisions made without the owner

- **Пустой прожиг определён как «не дал НОВОЙ ГЛУБИНЫ», а не «повторил предыдущее значение».**
  Второе — частный случай первого и пропускает повтор через одну; на стенде такие составляют
  большинство трат. Развилку «а не второе ли это свидетельство вероятностного края» решать самому
  не пришлось: владелец закрыл её в `interviews/014` Q5 = B — *«один прожиг = доказано, движемся
  глубже сразу»*, против рекомендации агента. Раз одного прожига достаточно, второй той же пары не
  покупает ничего.
- **Счёт положен внутрь `harvestPairs`, а не в отдельную функцию** — DRY: один автор ответа на
  вопрос «что такое пара».
- **Половинка (напряжение без частоты) в траты НЕ идёт** — это дефект журнала (`bugs/54`), и
  записать его в трату значило бы предъявить карте счёт за нашу потерю данных.
- **Отказ и зависание в траты не идут** — они покупают знание о крае.
- **Число повторно жжённых частот печатается РЯДОМ с нулём трат.** Без него «трат 0» двусмыслен:
  на полосе без повторов трата невозможна по построению. Это класс `bugs/40`.
