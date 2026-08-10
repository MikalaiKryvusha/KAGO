# KAGO — Project History (the chronicle)

> The APPEND-ONLY chronicle of how this project lived and grew: closed sessions, shipped phases,
> releases, big decisions in the order they happened. This is where `STATUS.md` sheds its past —
> STATUS stays a short live summary of NOW; everything finished moves HERE (the "bonsai trim" step
> of `/end-chat`).
>
> **Not required reading.** This file is NOT part of `/resume`'s canon set and not in the
> before-every-task minimum — open it only when you actually need the archaeology: how a decision
> came to be, what an old phase contained, when something shipped.
>
> **Chronicle rules (ADR discipline):**
> - **Append-only, newest on top.** A recorded entry is never edited to say something else —
>   history that can be rewritten is not history. Corrections come as NEW entries that reference
>   and supersede the old one.
> - An entry moves here VERBATIM from `STATUS.md` when its work closes — move, don't rewrite;
>   the entry already carries its dates, counters and file pointers.
> - Entries mention versions and dates freely — a chronicle legitimately speaks of old versions,
>   and the update machinery's stale-claims scan knows to leave this file alone.
> - When the file grows unwieldy, split by era: keep the newest era here, move older ones to
>   `PROJECT_HISTORY_<era>.md` files, and leave a one-line index at the top of this file
>   (the pattern large changelogs use).
>
> Living document — never DONE-tagged.

---

## Сессия 6 — 2026-08-10 (19:07 → 22:0x +03:00): игровой стенд, КРАЙ НАЙДЕН ВПЕРВЫЕ, и владелец назвал все недостающие числа

**Самая результативная сессия проекта по числу закрытых неизвестных.** Начали со стенда, кончили тем,
что у трёх из четырёх режимов появились измеренные кандидаты, а у критериев — числа от владельца.

### Что построено

| Инструмент | Что он даёт | Проверки |
|---|---|---|
| `npm run gfx` | игровая нагрузка (Q2RTX timedemo) как прибор: FPS, телеметрия из отдельного процесса, окно журнала Windows, загрузка CPU | 48 блоков, 10 мутаций |
| `npm run vmin` | храповик: сбойнувшее напряжение больше никогда не предлагается | 23 блока, 7 мутаций |
| `npm run engine` | поиск края: восхождение 25 мВ → вилка → бисекция 5 мВ, «НЕИЗВЕСТНО» = стоп | 31 блок, 8 мутаций |
| `npm run fanladder` | акустическая лестница — прибор, у которого наблюдатель это ухо владельца | 34 блока, 10 мутаций |

### Что измерено

- **Пол игрового прибора 0,90 % между запусками** (две стоковые серии) — бюджет владельца в 5 % шире
  пола в 5,5 раза, значит приговоры законны.
- **Сток под игрой:** 56,42 FPS · 299,85 Вт · 75,5 °C · вентилятор 70,5 % · 2775 МГц · 99 % загрузки.
- **Матрица размена трёх ручек:** `-pl 250` в одиночку стоит 5,6 % кадров, **вместе с кривой — 1,24 %**.
  Андервольт вернул 4,4 пункта при тех же 250 Вт — физика «высвобождения пула мощности», показанная
  числами.
- **Кандидат в Optimised:** −1,24 % кадров за −50 Вт, −9 °C, вентилятор 69 → 50 %.
- **Кандидат в Silent Cold** (плюс потолок 2400): −9,42 % кадров за −94 Вт, −14 °C, вентилятор 69 → 36 %.
- **КРАЙ НАЙДЕН ВПЕРВЫЕ за всю историю проекта:** точка 95, сток 1040 мВ, отказы около **885 мВ**,
  запас ~155 мВ. И он оказался **ВЕРОЯТНОСТНЫМ** — обе стороны вилки это одно напряжение, на котором
  карта и прошла, и упала.
- **Частота ядра под этой игрой — плохой рычаг:** +6,5 % частоты дали 0 % кадров на 2 лучах и +0,96 %
  на 0 лучах. Процессор исключён замером (максимум по ядру 25 %).
- **Линейка вентилятора:** 28,5 об/мин на процент, 40 % = 1000, 100 % = 2714.

### Что назвал владелец — семь решений за вечер

1. **Optimised названо до конца:** FPS ≥ 95 % от Max Perfomance, покупаем сильное снижение ватт.
2. **Три ручки:** кривая — всегда, `-pl 250` — ставится, потолок частоты — решается замером.
3. **Кривая V/F — главный рычаг во всех режимах.**
4. **Стенд может занимать машину** — стоячее разрешение.
5. **Пороги шума: 60 % вообще, 45 % для Silent Cold.**
6. **Цель — ТЕМПЕРАТУРА, шум был лишь прибором;** перевод в градусы — работа агента (45 % ≈ 65 °C,
   60 % ≈ 71 °C, выведено из 12 пар, снятых с вентилятором на AUTO).
7. **Запас над отказом: два шага сетки, +10 мВ** — после того, как агент назвал вероятностный характер
   края. Интервью 004 не понадобилось.

### Чему научились — и все уроки нашли проверки, а не владелец

Восемь дефектов за сессию, и **семь из них поймали собственные проверки**: хранилище не умело записать
вердикт «НЕИЗВЕСТНО» · движок бисектировал после него · первый живой поиск упал на первой записи,
обнажив, что ветка сохранения не исполнялась в тестах ни разу · движок читал несуществующие поля и
складывал нули вместо напряжений · три ложных КРАСНЫХ в отчёте формы · метка замера затирала запись
предыдущего кандидата · `Number(null)` читался как остановленный вентилятор.

**Один поймал владелец, и он самый дорогой:** акустическая лестница определяла приезд вентилятора по
рапорту драйвера, а не по оборотам — две ступени звучали не тем, чем подписаны. EXP-0028 наизнанку.

**И один — арифметика перед докладом:** край «+540 МГц» выглядел как −360 мВ андервольта, чего не
бывает; перевод в вольты показал −155 мВ и заодно вскрыл, что вилка вообще не бракетит напряжение
(EXP-0034).

Новые уроки: **EXP-0033** (условие, которого не наблюдал, нельзя штамповать в запись) и **EXP-0034**
(единица, в которой ищешь, редко та, о которой вывод).

---

## Сессия 5 — 2026-08-10 (16:57 → 18:50 +03:00): фаза 4 закрыта судьёй, форма профиля найдена, и настоящая игровая нагрузка обесценила область прежних проверок

**Начали с планирования — по слову владельца** («делаем срез чата и в новом чате начнём с планирования»,
после того как фаза 4 отработала целый день без операционного плана — урок EXP-0027).

**Закрыто:** фаза 4 целиком (все восемь шагов, семь критериев приёмки, проход `/fable-judge`). **Написан**
`plans/05_epic01_phase5_vmin_engine.md` — до первой запланированной строки кода фазы. **Исполнен** его
шаг §4.1.

### 1. План фазы 5 — с записанным послаблением

Восемь шагов, девять критериев приёмки со шкалой/мерой/целью. Эпик требует прохода судьи по фазе N до
плана фазы N+1; план был написан раньше по слову владельца, и это записано в его §0 как послаблание, а не
осталось в чате. Ворота входа (§2) при этом никуда не делись: **план ворота опередить может, код — нет.**

### 2. Вентиляторы — шаг 4.7, и порядок работ был обратный привычному

Раскладки структур взяты из ДВУХ независимо написанных источников (nvfancontrol на Rust/Windows и
LibreHardwareMonitor на C#), сошлись поле в поле, размеры выведены из их полей арифметикой. Драйвер принял
все три структуры **на версии 1 с первой попытки**.

**Сперва сеть, потом прыжок:** полный откат сторожа выучил вентиляторы ДО того, как появилась первая
запись — умерший в ручном режиме писатель оставил бы вентиляторы приколоченными, а ручной пол этой карты
30 %. Правило R9a внутренней карты записано именно как правило, а не как совпадение. Мутационная проверка:
две мутации, и та, что ОСТАВЛЯЕТ шаг, но заставляет его приколачивать уровень вместо возврата в AUTO,
краснит свой блок ОДНА.

**Что сказала карта:** 3 кулера, 3 000 об/мин каждый, `currentMinLevel` = **30 %** — то самое число,
которое фаза 2 видела на пяти ступенях лестницы и не могла объяснить. Это пол железа. Записи 60 % и 80 %
приняты и исполнены (61 % / 1878-1860-1873 об/мин и 79 % / 2404-2366-2401), каждый откат проверен.
Холодный старт: три цикла «нагрев → остывание до 42 °C» дали **42 / 42 / 41 °C за 8 / 4 / 0 с, разброс
1 °C** — цель P4-AC7 назначена замером и взята с запасом.

**Находка важнее самого шага (EXP-0028):** один и тот же запрос 60 % читался 768 об/мин через 2 с и 1856
через 14 с. **Вентилятор РАЗГОНЯЕТСЯ, а не переключается**, поэтому правило EXP-0014 «читай до двух
совпавших проб» механической величине не годится — перечитывание обязано требовать ЦЕЛЬ. И первая версия
проверки прошла на 30 % при заказанных 60, потому что её предикат просил только «не ниже пола».

### 3. Судья по фазе 4 — ПОДТВЕРЖДЕНО С ОГОВОРКАМИ

Перепрогнано заново, а не принято с отчёта: ids 17/17 · цепочка на трёх независимых чтениях драйвера и
имени карты · сетка 5 мВ · `--prove-mask 64 -15` 9 блоков и побайтовый откат на 9 248 байтах · сторож
измеренной раскладки 5/5, причём **опубликованная раскладка покраснела за свою причину** · учебная тревога
вернула карту за **2,2 с** · 142 блока офлайн-самопроверок без провалов · фикстуры 5/5 · расшифровка
троттлинга сходится в обе стороны. Подлогов не найдено: существующие наборы в диапазоне фазы не тронуты.

**Три оговорки, две исправлены на месте:** все четыре модуля фазы носили `[NOT-TESTED]`, причём три
комментария уже врали (заявляли, что прогон ещё впереди, хотя он был) — маркеры перевёрнуты на
`[TESTED: дата · как]`, а `vf-step.mjs` получил намеренно ЧАСТИЧНЫЙ маркер с перечнем непроверенного.
Числа стояли без своих условий — «180…3157 МГц» и «2,5 с» получили свои температуры и оба замера. Третья
не исправлена намеренно: у P4-AC7 нет переиспользуемого прибора, и он занесён в `plans/05` §4.7.

### 4. Форма профиля — владелец задал требование, замер его подтвердил

Дословно: *«Я хочу, чтобы карта сама могла и разгоняться и снижать частоты, но работала на пониженном
напряжении согласно кривой VF профиля»*. Это **сняло `-lgc` с роли механизма профиля**:
`candidateProfile()` ставит `min = max`, то есть приколачивает частоту — годится для замера ватт, негодно
для того, что переживает загрузку ПК.

Форма как арифметика: `offset_i = clamp(F_top − F_i, 0, Δ)` при потолке на верху кривой; при потолке НИЖЕ
верха нижний обрез снимается, и точки над потолком толкаются вниз. 17 офлайн-блоков, четыре мутации с
названными ДО прогона адресатами, включая ту регрессию, что молча вернула бы найденный дефект.

**Замерено на живой карте, обе стороны остужены до 42 °C, фиксации частоты нет:**

| потолок | выданная частота | Вт | °C | напряжение для потолка |
|---|---|---|---|---|
| 3172 — ВЕРХ кривой | 2887 → **2932** | 137,3 → 137,1 | 57 → 54 | 1240 → 1200 мВ |
| 2887 — медиана стока | 2887 → 2857 | 136,95 → **126,42** | 57 → 53 | 1065 → 1040 мВ |
| **2917 — медиана + 30** | **2887 = ровно сток** | 137,15 → **129,44** | 58 → 53 | 1075 → 1050 мВ |

Простой не тронут: 855 / 802 / 787 МГц. **Потолок на ВЕРХУ кривой — не потолок** (EXP-0031): под
нагрузкой карта туда не доходит, ограничение стоит там, где система не работает, и подъём уходит в
скорость. Карта выдаёт чуть НИЖЕ потолка, поэтому место потолка — рычаг с курсом **30 МГц ≈ 2,8 Вт**.

### 5. Прибор цены сменил роль — по вопросу владельца

Он спросил: *«оп/c — это индустриальный стандарт замера производительности для видеокарты?»* Нет.
Индустрия и оверклокеры мерят FPS, стабильность времени кадра и баллы бенчмарков. И тут же замер показал,
почему это не придирка: две стоковые стороны разошлись по оп/с на **4,3 %** при совпавших ваттах (0,15 %)
и одинаковой частоте (EXP-0030). Роли разведены: **оп/с — детектор clock stretching** (его настоящая
работа, R4/R4a), **автоматическая цена — выданная частота**, **процент производительности — ручной 3DMark
владельца** (интервью 001, Q1 = A). Записано критерием P5-AC9.

### 6. Игровая нагрузка: переучёт по GitHub, установка и решающий замер

Владелец попросил открытый 3D-бенчмарк с FPS и был почти уверен, что такой есть на GitHub с большими
звёздами. **Пересчитано по самому GitHub: такого инструмента нет.** Все звёздные «gpu benchmark» —
вычислительные (FluidX3D 5217, nvbench 916, mixbench 464); пересечение тем `benchmark`+`graphics` не даёт
ничего выше 88 ⭐; единственный настоящий графический — `vkmark` (242 ⭐) и **без бэкенда под Windows**.
Нишу держат закрытые продукты с платной автоматизацией. Зато со звёздами есть открытые ИГРЫ с timedemo, и
для цели «ближе к играм» это лучше синтетики.

**Q2RTX 1.8.1 установлен в `D:\Games\Quake2RTX`** по слову владельца («сюда, игры тут» · «ставь»). NSIS,
`/S /D=`, флаги прочитаны в документации ДО запуска; размер установщика совпал с манифестом релиза байт в
байт; **откат существует и проверен** — родной `Uninstall.exe`. FurMark не рассматривался: владелец
исключил его сам (интервью 001, Q2 = A), и он не той формы — ровная полка не даёт переходов, которыми
валится андервольт.

**Владелец поймал ловушку, которую агент записал как достижение (EXP-0032).** Девять проходов из десяти
дали `143.998154 fps` — одно значение до шестого знака, и агент назвал это точностью прибора. Владелец:
*«144 кадра в секунду — это частота моего телевизора»*. Проверка кадром в девять раз дешевле (640×360,
ноль лучей) дала **то же 143.998154**. Это был ПОТОЛОК: оконный режим синхронизируется с обновлением
экрана даже при `vid_vsync 0`.

**Полный экран снял потолок, и карта насытилась впервые за весь проект:**

| | Q2RTX полный экран, 2 луча | наш `sdc_fma --sustain` |
|---|---|---|
| загрузка | 99 % | 97 % |
| **мощность** | **299,97 Вт, пик 308,55** | ~137 Вт |
| троттлинг | **`sw_power_cap`** | нет |
| частота | 2760, мин 2445 | 2887 |
| температура | **75 °C, макс 77** | 57 °C |
| память | **62 %** | 15 % |
| FPS | 54,07…54,54 (0,88 %) | — |

**Четыре следствия:** `utilization.gpu` — плохой прибор нагрузки, правду говорит мощность · ось `-pl`
ожила · **вся база по стабильности снята при половинном конверте** — PASS при 137 Вт и 57 °C не
доказательство для 300 Вт и 77 °C, где владелец играет · **под игрой выгода меняет форму**: карта,
режущаяся по мощности, отдаёт частоту, значит андервольт проявится как FPS, а не как ватты.

### Коммиты сессии

`2575347` план фазы 5 · `39bf3fe` вентиляторы и сторож · `e71b030` судья закрыл фазу 4 · `8668893` форма
профиля, −10,53 Вт · `80821b8` место потолка как рычаг, оп/с теряет роль цены · `962e5b3` переучёт
бенчмарков · `76610a5` Q2RTX установлен · `6485db6` Q2RTX насыщает карту.

### Уроки, оплаченные этой сессией

EXP-0028 (механическая величина разгоняется — перечитывание требует цель) · EXP-0029 (ранний `return`
внутри `try` пропускает печать отчёта: молчат ровно отказные пути) · EXP-0030 (разброс одного поля записи
нельзя занимать у соседнего) · EXP-0031 (ограничение работает только там, где система работает) ·
EXP-0032 (невозможно хорошая повторяемость — симптом, а не достижение).

---

## Сессия 4 — 2026-08-10: прибор измерил сам себя, кривая карты снята, и проект развернулся на NVAPI

**Закрыто:** фаза 2 §4.4 (эталон стока и разброс прибора) и §4.5 (спуск по лестнице, кривая
мощность↔производительность). **Начата фаза 4** — по слову владельца, посреди фазы 2.

**Чем мерили и что намерили.** `power-baseline.mjs` (`npm run power`) снимает медианы под нагрузкой
вместе с вердиктом и фоном, сэмплер в ОТДЕЛЬНОМ процессе (внутри одного он записывает ноль проб —
`spawnSync` блокирует цикл событий). Десять стоковых прогонов двумя независимыми сериями дали
**собственный разброс прибора 1,28 Вт = 0,65 % по мощности и 0,18 % по цене** — число, без которого ни
одна дельта не имеет права называться эффектом. Две находки попутно: разброс ВНУТРИ серии занижает пол
(серии дали 0,67 и 0,49 Вт, а их медианы разошлись на 0,9), и мощность идёт за температурой, которой
прогон ДОСТИГ (~4 Вт на 5 °C).

**Кривая этой карты, зажимом частоты** (`ladder-descent.mjs`, `npm run descend`): десять точек от 2790
до 900 МГц, все PASS. Перегиб посчитан, а не назначен: **2692 МГц**, где предельная отдача падает с 73
до 6,1 Вт за процент. Откат в `finally` после каждого кандидата, доказан на подставной карте для трёх
сценариев падения (запись, замер, сам откат).

**Две поправки к тому, что считалось решённым.** Замок частоты доказуем **только под нагрузкой** —
EXP-0014 мерил его на 1200 МГц, точке внутри диапазона простоя, и правило обобщили на всю лестницу
ошибочно; на простое высокий замок не наблюдается вовсе. И карта выдаёт **запрошенную точку или
соседнюю снизу** (2400→2392, 1800→1792), при нуле причин троттлинга в каждой пробе.

**Разворот на NVAPI.** Владелец: *«ты рубить хочешь, а я ТЮНИТЬ И ВЫЖИМАТЬ МАКСИМУМ СОКОВ»*,
*«НЕ СНИЖАЕМ ЧАСТОТУ… СНИЖАЕМ НАПРЯЖЕНИЯ НА ВСЁМ ДИАПАЗОНЕ ЧАСТОТ»* — агент показывал результаты
зажима частоты как продукт, тогда как профили строятся андервольтом. Итог: `researches/05`,
`automation-engine/lib/nvapi.mjs`, зависимость `koffi`. **17 ids из 17 отвечают на драйвере 610.88**
(включая добытые на Linux — это был главный риск фазы), цепочка доказана на драйвере и имени карты,
которые уже знал второй прибор, и **кривая читается: 128 точек, 450…1240 мВ, шаг сетки 5 мВ**.
Константа 6,25 «из фольклора» опровергнута замером; права оказалась цифра владельца.

**Определения профилей, данные владельцем операционно:** Max Optimal — ПЕРЕГИБ кривой, потолок 5 %
(потолок, а не цель); Silent Cold — МАКСИМУМ ХОЛОДА ценой назначенных ~10 %. Критерий стал кодом
(`findKnee()`) после пяти повторов владельца — урок EXP-0021.

**Уроки сессии:** EXP-0018 (разброс внутри серии занижает пол прибора — нужна вторая серия),
EXP-0019 (штамп времени берётся из `date` или из квитанции коммита, а не из головы), EXP-0020 (у
наблюдаемости есть область применимости: правило, снятое в одной точке, не переносится на диапазон),
EXP-0021 (повтор критерия владельцем — это сообщение о дефекте: критерий надо делать исполняемым).

**Перенесено из STATUS как закрытое:**

## 🔴 Находка 2026-08-10: у нашего оракула была слепая зона

`researches/04` (разведка по слову владельца про подвохи CPU) вскрыл, что **правило R4 внутренней
карты было неполным**. Оракул фазы 1 судит по двум наблюдениям — контрольная сумма и журнал Windows.
Два реальных класса отказа не видны ни одному из них:

- **Clock stretching.** Часть карт NVIDIA при нестабильной точке V/F **пропускает инструкции вместо
  падения**, а `clocks.gr` всё это время продолжает показывать зафиксированную частоту. Данные верные,
  падения нет — падает только работа в секунду.
- **Замещение ошибок памяти.** GDDR7 на этой карте несёт **внутреннюю ECC плюс CRC**: сбойная передача
  исправляется или повторяется. NVIDIA прямо пишет, что артефактов на экране может не быть вовсе.

**Профиль с любым из двух получил бы вердикт PASS.** Единственный прибор, который их видит, —
пропускная способность против стокового эталона, **и это тот же самый прибор, который меряет «цену»
для формулы владельца «снижаем, пока цена ≤ N»**. Один инструмент закрывает и слепую зону, и цену.

Проведено: R4 внутренней карты дополнено (плюс R4a — «перечитывание доказывает КОМАНДУ, а не
ДОСТАВЛЕННОЕ»), `plans/03` §4.3 получил замер пропускной способности с записью частоты рядом и низкую
нагрузку как отдельную форму теста. **Не измерено:** стретчит ли ЭТА карта вообще — §8 разведдокумента.

---

## Entries (newest first)

### 2026-08-10 — Session 3: bug 01 re-verified and its blockers closed, PHASE 1 CLOSED WHOLE

**Фаза 1 «Стенд и базовая линия» закрыта 2026-08-10 01:00 +03:00** — все девять шагов, все семь
критериев приёмки прогнаны своими мерами. Одной командой: `npm run phase1:accept`.

| Шаг | Что появилось | Чем доказано |
|---|---|---|
| 3.4 | `hardware-mon.mjs` — сэмплер телеметрии | два прогона по 30 с: 60 записей, **ноль `null` на 120 записей × 13 полей**, заголовки байт в байт, расходятся только `t` и значения карты |
| 3.5 | `event-logger.mjs` — четыре провайдера журнала Windows | нашёл **все три** настоящих `Kernel-Power` 41 (29.07, 05.08, 06.08) → `CRASH`; 5 фикстур, две захвачены с машины |
| 3.6 | `stress-tester.mjs` — вердикт PASS/SDC/CRASH | гвард плана на настоящем файле: одна шестнадцатеричная цифра → `SDC`, выход 1; сама самопроверка доказана красным мутацией |
| 3.7 | базовая линия + дамп карты | P1-AC5 стал командой `--verify-baseline`, доказан красным дважды |
| 3.8 | лестница частот в `gpu:info --json` | 5 ступеней памяти, **все четыре полные дают одинаковые 389 точек** 180…3090 МГц, шаг 7/8 МГц; 3090 сошлось с тремя независимыми чтениями |
| 3.9 | таблица стенда, досье среды, реестр пар | пару `researches/03` ↔ сэмплер **удалил, а не завёл** |

**Три находки, изменившие устройство, и все три пришли из настоящих прогонов, а не из чтения кода:**

1. **Ложный SDC.** Прогон с другими аргументами против эталона, снятого с аргументами по умолчанию,
   дал «58 из 58 разошлись». Ничего не искажалось — сумма зависит от аргументов. Ложный SDC хуже
   пропущенного: развёртка объявила бы здоровую карту нестабильной в каждой точке. Аргументы вошли в
   штамп эталона; расхождение штампа даёт НЕИЗВЕСТНО, а не вердикт. Так вердиктов стало **четыре**.
2. **Окно с 03:00.** `--since 2026-07-01` печатало «ОКНО: 2026-07-01T03:00» — голая дата по
   спецификации это полночь UTC, а на +03:00 три часа отрезаются от начала каждого окна поиска сбоев.
3. **Квитанция вчерашним днём.** `captured_at` писался в UTC: `2026-08-09T21:52Z` при часах владельца
   `2026-08-10 00:52`.

**Ограничение, унесённое в фазу 5:** один прогон нагрузки — один процесс, запуск (~140 мс) сильно
больше ядра (0–25 мс), поэтому даже под непрерывной нагрузкой карта выходит лишь на 20–30 %. Форма
переходной нагрузки верная (наблюдал собственным сэмплером: чередование 30 %/4 % пятисекундными
блоками), насыщение — нет. Фазе 5 нужна нагрузка, крутящаяся внутри себя N секунд.

**Баг 01 (контур согласований) — перепроверен и припаркован.** Прежняя редакция говорила «23 находки,
8 серьёзных»; журнал девяти рецензентов уцелел на диске и содержал **71 сырую находку, 54 после
дедупликации, 6 блокеров**, включая 14 по `questions-guard.mjs`, которого документ не разбирал вовсе.
Список перенесён в баг-документ целиком. Написан `tools/verify-review-contour.mjs` (18 блоков), и
**каждый блок доказан красным против копии `HEAD`** до правок. Закрыто 23 находки, 1 опровергнута,
**все 5 блокеров** — оба были ложным зелёным:

- **гейт отправки не мог одобрить ничего**: `decision.artifacts` не писал никто, а страница
  переписывала решение целиком, стирая даже вписанное руками одобрение. Теперь `writeDecision` сливает;
- **сторож вопросов был слеп к русскому**: `\w` в Node ASCII-only даже под `/u`. Замерено до правки —
  **13 настоящих обращений из 18 невидимы**, при этом прогон печатал ЧИСТО.

**Решение владельца 2026-08-10:** *«чини явные блокеры, и переходим к KAGO, срать на леса»*.
Оставшиеся 30 находок припаркованы: обвязка процесса весила 4161 строку против 1066 строк самого
KAGO, и это соотношение владелец назвал первым.

**Уроки:** EXP-0008 (доказывать сторож красным против `HEAD`) · EXP-0009 (пересказ бага — не
инвентарь) · EXP-0010 (Read показывает NUL пробелами) · EXP-0011 (эталон хранит значение, штамп —
условия) · EXP-0012 (тесты проверяют задуманное, вывод показывает построенное) · EXP-0013 (пара,
которую можно удалить, лучше пары, которую надо сторожить).

**Коммиты:** `5d462a2` `3b5c7c7` `6c42673` `450ac3b` `0a6d9b8` `d91e15d` `82fc8fe` `a9936f3`.


### 2026-08-09 — Session 2: the epic planned, the review contour built, phase 1 opened

Moved from `STATUS.md` at `/end-chat`. Eight commits, `e5dfa67` … `406f0bf`.

**The planning ladder, on the owner's instruction to open the session with it**

- **`researches/03_headless_verification_toolchain.md`** — the third recon doc: what loads the card,
  what watches it, who says PASS. Its decisive finding was proved by running it: CUDA Toolkit 13.3
  and MSVC are on this machine, a test kernel compiled and returned the same checksum on three
  consecutive runs — so KAGO can build its own deterministic workload and needs no third-party
  binary. It also found that every mature benchmark sells script automation only in a paid tier,
  that `nvidia-smi` has no voltage field at all (so phase 5 depends on phase 4 by evidence), and
  that HWiNFO64 must leave the architecture.
- **`plans/01_EPIC_kago_orchestrator.md`** — the meta-plan: goal vector, seven acceptance criteria
  with Scale/Meter/Target, six phases with their order argued, entry and exit gates, tiered risks.
  Written in English first, rewritten in Russian on the owner's decision (see below).
- **`plans/02_epic01_phase1_harness_and_baseline.md`** — the operational plan for phase 1 only.

**The owner-review contour, built on the owner's mid-session instruction** *«если нужно будет от
меня слово — разворачивай интерактивный контур KAIF»*

Five files, ≈3 470 lines, zero external dependencies: `tools/lib/review-core.mjs` (the one truth —
normalization, hash, parsing, decision writes, the renderer), `tools/questions-guard.mjs` (four
axes with a ratchet), `tools/review.mjs` (page, server, signal, queue), `tools/review-gate.mjs`
(fail-closed `checkApproval`), `tools/send-upstream.mjs` (its real consumer — a KAIF ticket via
`gh`). Proven by observation, not claimed: the guard red on a new violation and green on an excused
one; the full save cycle writing all three places and the server terminating on its own; the gate's
five behaviours including that a real content change voids an approval while CRLF+BOM does not.
Field report filed as [KAIF#7](https://github.com/MikalaiKryvusha/KAIF/issues/7).

**Interview 001 — the contour's first live cycle, closed without one clarification in chat**

| Question | Owner's answer (2026-08-09 23:23 +03:00) |
|---|---|
| What measures performance acceptance (3DMark automation is Professional-only) | **A** — the automated gate uses KAGO's own numbers; the percentage of stock is one manual 3DMark run at the close of phase 6 |
| Does FurMark go on the bench | **A** — not adopted at all, neither as a dependency nor as a bench tool |
| Does the compiled binary ship | **B** — **it ships**, against the agent's recommendation, so KAGO works on a machine with no CUDA Toolkit |

Answers propagated to every declared target before the status flip; the return-leg guard reports
`проверок 3 · нарушений 0`.

**Phase 1 opened — three steps closed**

- `automation-engine/config.mjs` — every safety number named, each with the line it came from, each
  audited by grep. The thermal policy is written as an observation (the card never declared a
  throttle) rather than as an invented ceiling; the power range is probed, never hard-coded.
- `automation-engine/lib/toolchain.mjs` — three lookup strategies for `nvcc` + the MSVC environment,
  with the x86-hosted cross compiler as a proven fallback and a NAMED refusal instead of a stack.
- `workloads/sdc_fma.cu` and `workloads/branchy.cu` + `tools/build-workloads.mjs` — the SDC-prone
  and crash-prone shapes, each deterministic across five repeats (P1-AC1), shipped with
  `MANIFEST.json` so a committed binary can be verified rather than trusted.

**The KAIF language defect, found by the owner**

The canon routed document language by directory, so the epic meta-plan — which the same guide calls
"where the owner sees the whole shape once" — came out in English in a Russian-language project.
Contradiction three lines apart in one file. Fixed locally by routing on a QUESTION (*does the owner
read this?*) with an audience table; filed as [KAIF#6](https://github.com/MikalaiKryvusha/KAIF/issues/6)
with corroborating evidence from this project's own install report, which had recorded the ambiguity
hours earlier without it being acted on. `plans/01_EPIC` and `STATUS.md` rewritten in Russian.

**The machine incident, recorded because it cost real time**

`winget upgrade --id Microsoft.VisualStudio.2022.Community`, run believing it a read-only check,
started an unrequested Visual Studio upgrade; interrupting it left MSVC half-installed. Repaired the
same evening (finished 22:50, toolset 14.44 with both hosts restored). The detour bought one useful
fact: the same kernel produced an identical checksum on three different toolchain configurations, so
the golden reference survives a compiler change. Lessons `EXP-0005` and `EXP-0007`; a `deny` rule in
the harness permission file now blocks the whole verb class.

### 2026-08-09 — Session 1: KAIF deployed, phase 0 closed, project published 🎉

Moved verbatim from `STATUS.md` at `/end-chat`.

**Phase 0 — KAIF deployment and the research base ✅**

- **KAIF 2.2 deployed**, lang `ru`, sphere `programming`, mode standard, five agent systems.
  Loader exit 0; both artefacts sha256-verified; 246 files written; `verify-final` green and
  self-cleaned.
- **`researches/01_gpu_control_paths.md`** — the owner's `GOAL.md` question answered: undervolting
  without MSI Afterburner is possible; three paths compared; the ladder chosen.
- **`researches/02_vmin_guardband_methodology.md`** — the per-point Vmin search and the guardband,
  built on Leng et al. (MICRO 2015) measurements.
- **`tools/check.mjs`** and **`tools/gpu-info.mjs`** written and run green.
- **`MASTER_PLAN.md`** derived: phases 0–6 with a decision log.
- **Published:** https://github.com/MikalaiKryvusha/KAGO — public, MIT, bilingual README.
- **Owner's voice portrait installed** — the full private core at the project root, git-ignored.
- **Feedback loop closed upstream:** [KAIF#3](https://github.com/MikalaiKryvusha/KAIF/issues/3),
  [KAIF#4](https://github.com/MikalaiKryvusha/KAIF/issues/4),
  [KAIF#5](https://github.com/MikalaiKryvusha/KAIF/issues/5) — filed on the owner's approval.

**Decisions the owner made in this session:**

| Time (+03:00) | Decision |
|---|---|
| 21:28 | The ladder: `nvidia-smi` first, an own NVAPI bridge after. License MIT. |
| 22:35 | Pull the full private voice core into the project, git-ignored. |
| 22:50 | Three shortcuts (Max Optimal · Silent Cold · Reset to factory), each writing the remembered boot state. The tray displays only — no buttons. This supersedes the `GOAL.md` line about killing the tray to reset. |

**Proved by observation, not assumed:** `nvidia-smi -pl` writes on this card (300 → 290 W, read
back, restored to 300), on the owner's explicit consent from an elevated shell.

**The framework gap the owner caught:** KAIF's adaptation task has nine items and none installs the
owner's voice portrait — so this project's README was written before its author's voice arrived.
Filed as KAIF#4 with a proposed tenth item.

### <date> — <session/phase/release title> <✅/🎉>
`<The entry as it lived in STATUS.md — verbatim: what was done, key numbers, file pointers.>`
