<a id="english"></a>

# KAGO — Krinik Automated GPU Orchestrator

<h3 align="center"><em>Finds the quietest voltage your GPU can actually hold — and proves it before you trust it.</em></h3>

<p align="center">
  <a href="#english"><img src="https://img.shields.io/badge/English-2C7BE5?style=for-the-badge" alt="English"></a>
  &nbsp;
  <a href="#russian"><img src="https://img.shields.io/badge/Русский-C0392B?style=for-the-badge" alt="Русский"></a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-FF1A8C.svg?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/Status-phases%200%2C1%2C4%20closed%20%C2%B7%20undervolt%20measured%20%E2%88%927.71%20W-E67E22.svg?style=flat-square)](STATUS.md)
[![Platform](https://img.shields.io/badge/Platform-Windows%2011-2C7BE5.svg?style=flat-square)](#5-requirements)
[![Runtime](https://img.shields.io/badge/Node.js-%E2%89%A518-3DDC84.svg?style=flat-square)](#5-requirements)
[![Built with KAIF](https://img.shields.io/badge/Built%20with-KAIF%202.2-8E44AD.svg?style=flat-square)](https://github.com/MikalaiKryvusha/KAIF)

<p align="center">
  <a href="#1-general">General</a> · <a href="#2-where-the-project-actually-is">Status</a> · <a href="#3-the-method">The method</a> · <a href="#4-the-two-profiles">Profiles</a> · <a href="#5-requirements">Requirements</a> · <a href="#6-built-with-kaif">KAIF</a>
</p>

**KAGO is a Node.js orchestrator that undervolts an NVIDIA GPU on Windows — automatically, with a measured safety margin, and without installing a single third-party GUI.**

---

<a id="1-general"></a>

## 1. General

1. Undervolting trades voltage for heat and noise. Every graphics card ships with a **voltage
   guardband** — a margin the vendor adds so the worst chip in the batch survives the worst
   conditions. Your chip is not the worst one, and your room is not the worst room. Part of that
   margin is yours to take back.
2. Taking it back by hand means hours in a curve editor, one point at a time, with a stress test
   between every change. KAGO does that loop instead of you and writes down what it found.
3. **No third-party GUI is required, and none will be added.** The card is driven through the
   driver's own command-line interface first, and through an in-house NVAPI bridge after that. MSI
   Afterburner is not a dependency of this project.
4. Two profiles ship: one for quiet performance, one for the coldest and quietest the card can go.
   Each is a desktop shortcut, and a tray icon shows which one is live.
5. **Factory state is the default.** Profiles live in the GPU's volatile memory. Kill the tray icon,
   crash the machine, or simply reboot — the card comes back stock, and you do nothing.

### 1.1. Why this exists as a project rather than a forum post

Silicon differs from chip to chip. Between five identical cards of one model, the lowest safe
voltage varies by as much as 70 mV — so a profile copied from someone else's card is not a
shortcut, it is a guess with your hardware as the stake. KAGO ships **the method**, never someone
else's numbers.

---

<a id="2-where-the-project-actually-is"></a>

## 2. Where the project actually is

Three phases of six are closed, and the card has been measured. The research base, the architecture,
**the test bench** and **KAGO's own bridge to the driver** are done; the card runs undervolted and comes
back on command. The search engine now exists and judges a candidate by three different load shapes at
once, taking the worst verdict — but it has not yet measured this card's edge, and it refuses to report
one until it can prove the write it made actually cheapened the clock it tested.

**The undervolt is measured, not claimed.** With the whole voltage/frequency curve raised and nothing
offered above the clock the card already delivered, it draws **7.71 W (5.6 %) less and runs 5 °C cooler at
exactly the stock clock** — and no clock lock is used, so the card still boosts and still drops to idle
speeds. One number from one pair of runs; two independent series are what will make it a result.

The bench samples the card, loads it with KAGO's own CUDA workloads, watches the Windows event log,
and returns a three-way verdict — PASS, SDC or CRASH — by comparing a run against a golden reference
captured at stock. SDC is the one that matters: more than half of undervolting failures corrupt data
before anything crashes, so "it did not fall over" is not a passing run. One command runs the whole
phase-1 acceptance:

```bash
npm run phase1:accept
```

**KAGO writes to the card, and the way back is executed rather than promised.** One module owns every
write; a profile is applied, re-read until two consecutive samples agree, and rolled back — the round
trip has run on the live card. The card also has its own bridge now: KAGO talks to the NVIDIA driver
API directly from Node, with no third-party GUI and no compiled binary, and reads the 128-point
voltage/frequency curve.

The measurement it produced first is the one that licenses every other number: the meter's **own**
run-to-run spread, taken over ten stock runs in two independent series — **1.28 W (0.65 %)** on power.
A difference thinner than that is not an effect, and the tool prints that sentence beside every delta it
computes. The throughput half of that figure did not survive: measured across separate runs, the same
stock workload varies **4.3 %**, so performance is judged on the delivered clock, which is exact.

**And the load matters more than the meter.** A real path-traced game load drives this card to **300 W,
99 % and 77 °C**; KAGO's own compute workloads reach 137 W at the same reported utilization. So every
stability verdict so far was earned at half the card's power envelope, and that limit is stated here
rather than left for a reader to discover.

```bash
npm run gpu:info
```

```
GPU            NVIDIA GeForce RTX 5070 Ti
Driver / VBIOS 610.88 / 98.03.58.40.8b
Power limit    300.00 W (default 300.00 W)
Power range    250.00 … 300.00 W  → only 50 W of headroom
Graphics clock 1050 MHz (max 3090 MHz)
Temperature    52 °C   Perf state P5
Memory clocks  405, 810, 7001, 13801, 14001 MHz
Clock ladder   1651 points total, 389 per full rung, 180 … 3090 MHz  (phase 5's search space)
               identical on all 4 full memory rungs — sweep the graphics clock once
Ladder step    7 MHz ×194, 8 MHz ×194 — measured on the 810 MHz memory rung.
               This is the CLOCK grid. The VOLTAGE grid is 5 mV, read off the live curve.
```

That headroom line is the finding that shaped everything else. The driver will only move
the power ceiling from 300 W down to 250 W — 50 W. The targets this project was built for need two
to three times that, so power limiting alone was never going to be enough, and curve editing became
mandatory. The full reasoning is in [`researches/01`](researches/01_gpu_control_paths.md); the
roadmap is in [`MASTER_PLAN.md`](MASTER_PLAN.md); the current state is
[`STATUS.md`](STATUS.md).

---

<a id="3-the-method"></a>

## 3. The method

The naive recipe — *drop the voltage until it crashes, then step back one* — is what most guides
teach, and it has two holes that measurements close.

**Hole one: a crash is not the first failure.** In a study of 57 programs across four GPU
generations, more than half failed **silently** before they ever crashed: the card kept drawing
frames and returning answers, and the answers were wrong. A test that only watches for crashes
walks straight through the corruption zone without noticing.

**Hole two: the edge is a cliff, not a slope.** For one program, the error rate went from 3 % to
90 % across two percent of voltage. Stopping at the last setting that passed leaves you standing on
that cliff, where a warm afternoon or a heavier game is enough to push you off.

So KAGO does it differently:

| Step | What happens |
|---|---|
| **Golden reference** | The workload set runs at stock, and its outputs are stored. Everything later is compared against them — not against "looks fine". |
| **Three-way verdict** | Each trial ends as **PASS**, **SDC** (output changed, nothing crashed), or **CRASH** (driver TDR, WHEA, application death, BSOD). The middle column is the one that matters. |
| **Bracket the edge** | Coarse descent to first failure, then a binary search to locate it at grid resolution. The search never dwells at a failing point. |
| **Add the guardband** | The shipped voltage sits **at least four curve steps, and never less than 25 mV**, above the measured failure point. |
| **Diverse workloads** | Branchy code and arithmetic-dense code fail differently, and the lowest safe voltage varies by ~100 mV between programs. A point's threshold is the **worst** result across the whole set, never the first one found. |
| **Transients, not just load** | Supply noise matters more than temperature here, so the hard test is rapid load changes — not a flat 100 % burn. |
| **Bind to the driver** | Every profile records the driver and VBIOS it was proved against. A driver update invalidates it until re-validated. |

The measurements behind each of these are cited in
[`researches/02`](researches/02_vmin_guardband_methodology.md).

---

<a id="4-the-two-profiles"></a>

## 4. The two profiles

| | 🚀 **Max Optimal** | ❄️ **Silent Cold** |
|---|---|---|
| For | Everyday gaming, quiet but fast | Night sessions and light games |
| How its point is chosen | **The knee of the curve** — the point after which giving up more performance stops paying. The owner's ceiling is 5 %, and it is a ceiling, not a destination | **The coldest the card can go** for a price fixed in advance: **~10 %** of performance, spent deliberately |
| Performance · temperature · power saved | Measured, not inherited — **not measured yet** | Measured, not inherited — **not measured yet** |
| Applied | At boot, plus a shortcut | By shortcut, when you want it |

The source plan quoted figures — ≥ 97 % of stock, 60–120 W saved, 65 / 58 °C. KAGO does not carry
them as targets: they float from one card to the next, and on some cards there is no performance cost
at all for a substantial power reduction. So the numbers this table will carry are the ones measured
on this die — reported next to the meter's own run-to-run spread, because "no loss" measured with a
blunt instrument is not a finding.

A **third shortcut resets the card to factory settings**, and all three write the state that gets
re-applied at boot — so whichever you clicked last is what you come back to. The tray icon shows
which profile is live and does nothing else: no menu, no buttons.

These are **acceptance targets, not shipped profiles.** No profile has been fixed yet — that is
phase 6, and it waits on the owner's own listening test. What *has* been proven on this hardware is
worth stating exactly, because it is more than it was: the driver accepts power-limit and clock-lock
writes and gives them back (300 → 290 W and a core pinned to 1200 MHz, each re-read to stability and
rolled back); the card's power↔performance curve has been measured across ten points; the meter's own
spread is 1.28 W; and KAGO's own NVAPI bridge reads the 128-point voltage/frequency curve, whose
voltage grid turned out to be 5 mV rather than the 6.25 mV folklore assumes.

---

<a id="5-requirements"></a>

## 5. Requirements

- Windows 11
- Node.js ≥ 18
- An NVIDIA GPU with a current driver. Developed against a GeForce RTX 5070 Ti; the method is
  general, the numbers are not.
- Administrator rights — the driver refuses clock and power writes without them.

> **Undervolting changes how your hardware is powered.** Done carelessly it costs you a frozen
> screen, a failed benchmark run, or corrupted output you do not notice for months. KAGO is built to
> make that unlikely and always reversible, and it is still your card. MIT means no warranty, and
> that clause is not decoration.

---

<a id="6-built-with-kaif"></a>

## 6. Built with KAIF

The project runs under [KAIF 2.2](https://github.com/MikalaiKryvusha/KAIF) — the author's framework
for AI agents: external memory, bounded autonomy, and the discipline that keeps a claim of "it
works" attached to an observation. `AGENT_GUIDE.md`, `STATUS.md` and the two project maps are how a
fresh session picks this project up from nothing.

## License

MIT © 2026 Mikalai Kryvusha (**KOT KRINIK**). See [LICENSE](LICENSE).

---
---

<a id="russian"></a>

# KAGO — Криник Автоматизированный ГПУ Оркестратор

<h3 align="center"><em>Находит самое тихое напряжение, которое карта действительно держит, — и доказывает это прежде, чем вы ему поверите.</em></h3>

<p align="center">
  <a href="#english"><img src="https://img.shields.io/badge/English-2C7BE5?style=for-the-badge" alt="English"></a>
  &nbsp;
  <a href="#russian"><img src="https://img.shields.io/badge/Русский-C0392B?style=for-the-badge" alt="Русский"></a>
</p>

[![Лицензия: MIT](https://img.shields.io/badge/Лицензия-MIT-FF1A8C.svg?style=flat-square)](LICENSE)
[![Состояние](https://img.shields.io/badge/Состояние-фазы%200%2C1%2C4%20закрыты%20%C2%B7%20андервольт%20измерен%20%E2%88%927%2C71%20Вт-E67E22.svg?style=flat-square)](STATUS.md)
[![Платформа](https://img.shields.io/badge/Платформа-Windows%2011-2C7BE5.svg?style=flat-square)](#5-что-нужно)
[![Среда](https://img.shields.io/badge/Node.js-%E2%89%A518-3DDC84.svg?style=flat-square)](#5-что-нужно)
[![Собран на KAIF](https://img.shields.io/badge/Собран%20на-KAIF%202.2-8E44AD.svg?style=flat-square)](https://github.com/MikalaiKryvusha/KAIF)

<p align="center">
  <a href="#1-общие-сведения">Общие сведения</a> · <a href="#2-где-проект-находится-на-самом-деле">Состояние</a> · <a href="#3-методика">Методика</a> · <a href="#4-два-профиля">Профили</a> · <a href="#5-что-нужно">Что нужно</a> · <a href="#6-собран-на-kaif">KAIF</a>
</p>

**KAGO — оркестратор на Node.js, который сам подбирает андервольтинг для видеокарты NVIDIA под Windows: с измеренным запасом надёжности и без единого стороннего GUI в зависимостях.**

---

<a id="1-общие-сведения"></a>

## 1. Общие сведения

1. Андервольтинг меняет напряжение на тепло и тишину. Каждая карта уезжает с завода с **запасом по
   напряжению** — производитель закладывает его так, чтобы худший чип в партии выжил в худших
   условиях. Ваш чип не худший, и комната у вас не худшая. Часть этого запаса можно забрать себе.
2. Забирать руками — это часы в редакторе кривой, по одной точке, со стресс-тестом после каждой
   правки. KAGO проходит этот цикл вместо вас и записывает, что нашёл.
3. **Сторонний GUI не нужен, и его тут не появится.** Картой управляет сначала штатная утилита
   драйвера, а затем собственный мост к NVAPI. MSI Afterburner в зависимостях проекта нет.
4. Профилей два: один для тихой производительности, второй — на самый холод и тишину, какие карта
   может дать. Каждый лежит ярлыком на рабочем столе, а иконка в трее показывает, какой сейчас
   включён.
5. **Заводское состояние — состояние по умолчанию.** Профиль живёт в энергозависимой памяти GPU.
   Убили иконку в трее, упала система, просто перезагрузились — карта вернулась стоковой, и делать
   для этого ничего не надо.

### 1.1. Почему это проект, а не пост на форуме

Кремний у каждого чипа свой. У пяти одинаковых карт одной модели самое низкое безопасное напряжение
расходится на 70 мВ — поэтому чужой профиль не короткий путь, а догадка, ставка в которой ваше
железо. KAGO отдаёт **методику**, а не чужие числа.

---

<a id="2-где-проект-находится-на-самом-деле"></a>

## 2. Где проект находится на самом деле

Закрыты три фазы из шести, и карта измерена. Разведка, архитектура, **испытательный стенд** и
**собственный мост KAGO к драйверу** готовы; карта работает с пониженным напряжением и возвращается по
команде. Движок поиска написан и судит кандидата сразу тремя разными формами нагрузки, беря худший
вердикт, — но края этой карты он ещё не измерил и отказывается называть его, пока не докажет, что
сделанная запись действительно удешевила проверяемую частоту.

**Андервольт измерен, а не заявлен.** Когда вся кривая «напряжение — частота» поднята, а выше той частоты,
которую карта и так выдавала, не предлагается ничего, она берёт **на 7,71 Вт (5,6 %) меньше и работает на
5 °C холоднее при ровно стоковой частоте** — и никакой фиксации частоты при этом не применяется, так что
карта по-прежнему разгоняется и по-прежнему сбрасывается на простое. Это одно число из одной пары
прогонов; результатом его сделают две независимые серии.

Стенд снимает телеметрию, грузит карту своими ядрами на CUDA, читает журнал Windows и выносит
вердикт из трёх — PASS, SDC или CRASH, — сверяя прогон с эталоном, снятым на заводских настройках.
Важен средний: больше половины отказов от андервольта портят данные раньше, чем что-нибудь упадёт,
поэтому «не свалилось» — это не пройденный прогон. Вся приёмка первой фазы идёт одной командой:

```bash
npm run phase1:accept
```

**KAGO пишет в карту, и обратная дорога не обещана, а пройдена.** Записывает один-единственный
модуль; профиль применяется, перечитывается до совпадения двух проб подряд и откатывается — круговой
рейс прогнан на живой карте. И у карты теперь есть свой мост: KAGO разговаривает с драйвером NVIDIA
напрямую из Node, без стороннего GUI и без единого скомпилированного бинарника, и читает кривую
«напряжение — частота» из 128 точек.

Первым же замером он выдал число, которое даёт право на все остальные: **собственный разброс прибора**
между прогонами — десять стоковых прогонов двумя независимыми сериями, **1,28 Вт (0,65 %)** по мощности.
Разница тоньше этой — не эффект, и инструмент печатает эту фразу рядом с каждой дельтой, которую считает.
А вот половина этой цифры про производительность не выжила: между отдельными прогонами одна и та же
стоковая нагрузка расходится на **4,3 %**, поэтому производительность судится по выданной частоте — она
точна.

**И нагрузка важнее прибора.** Настоящая игровая нагрузка с путевой трассировкой загоняет эту карту в
**300 Вт, 99 % и 77 °C**, а собственные вычислительные нагрузки KAGO дают 137 Вт при той же заявленной
загрузке. Значит все вердикты о стабильности пока получены при половинном конверте карты — и этот предел
назван здесь, а не оставлен читателю на самостоятельное открытие.

```bash
npm run gpu:info
```

```
GPU            NVIDIA GeForce RTX 5070 Ti
Driver / VBIOS 610.88 / 98.03.58.40.8b
Power limit    300.00 W (default 300.00 W)
Power range    250.00 … 300.00 W  → only 50 W of headroom
Graphics clock 1050 MHz (max 3090 MHz)
Temperature    52 °C   Perf state P5
Memory clocks  405, 810, 7001, 13801, 14001 MHz
Clock ladder   1651 points total, 389 per full rung, 180 … 3090 MHz  (phase 5's search space)
               identical on all 4 full memory rungs — sweep the graphics clock once
Ladder step    7 MHz ×194, 8 MHz ×194 — measured on the 810 MHz memory rung.
               This is the CLOCK grid. The VOLTAGE grid is 5 mV, read off the live curve.
```

Строка про запас и определила всё остальное. Потолок мощности драйвер двигает только с
300 Вт до 250 Вт — на 50 Вт. Цели, ради которых проект затевался, требуют в два-три раза больше,
так что одним потолком мощности их было не взять никогда, и правка кривой стала обязательной. Весь
разбор — в [`researches/01`](researches/01_gpu_control_paths.md), дорожная карта — в
[`MASTER_PLAN.md`](MASTER_PLAN.md), текущее состояние — в [`STATUS.md`](STATUS.md).

---

<a id="3-методика"></a>

## 3. Методика

Наивный рецепт — «снижай напряжение, пока не упадёт, потом шаг назад» — ему учит большинство
руководств, и в нём две дыры, которые закрываются измерениями.

**Дыра первая: крах — не первый отказ.** В исследовании 57 программ на четырёх поколениях карт
больше половины отказывали **молча**, ещё до всякого краха: карта продолжала рисовать кадры и
возвращать ответы, и ответы были неверные. Тест, который следит только за крахом, проходит зону
порчи данных насквозь и не замечает её.

**Дыра вторая: у края обрыв, а не склон.** У одной программы вероятность ошибки выросла с 3 % до
90 % на двух процентах напряжения. Остановиться на последней прошедшей настройке — это встать
ровно на обрыв, с которого хватит тёплого дня или игры потяжелее.

Поэтому KAGO делает иначе:

| Шаг | Что происходит |
|---|---|
| **Золотой эталон** | Набор нагрузок прогоняется на стоке, выходы сохраняются. Всё дальнейшее сравнивается с ними, а не с «вроде нормально». |
| **Трёхзначный вердикт** | Каждая проба заканчивается как **PASS**, **SDC** (выход изменился, ничего не упало) или **CRASH** (сброс драйвера, WHEA, гибель приложения, BSOD). Средняя графа и есть главная. |
| **Взять край в вилку** | Грубый спуск до первого сбоя, затем бинарный поиск края по сетке. На сбойной точке поиск не задерживается. |
| **Добавить запас** | Отгружаемое напряжение стоит **минимум на четыре шага сетки и не ближе 25 мВ** над измеренным порогом сбоя. |
| **Разные нагрузки** | Ветвистый код и счётный отказывают по-разному, а самое низкое безопасное напряжение гуляет между программами на ~100 мВ. Порог точки — **худший** результат по всему набору, а не первый найденный. |
| **Переходы, а не просто нагрузка** | Шум питания тут значит больше температуры, поэтому тяжёлый тест — это быстрая смена нагрузки, а не ровные 100 %. |
| **Привязка к драйверу** | Профиль записывает драйвер и VBIOS, на которых был доказан. Обновление драйвера делает его недействительным до перепроверки. |

Измерения под каждым пунктом названы в
[`researches/02`](researches/02_vmin_guardband_methodology.md).

---

<a id="4-два-профиля"></a>

## 4. Два профиля

| | 🚀 **Max Optimal** | ❄️ **Silent Cold** |
|---|---|---|
| Для чего | Повседневная игра, тихо и быстро | Ночные сессии и лёгкие игры |
| Как выбирается точка | **Перегиб кривой** — точка, после которой дальнейшая отдача производительности перестаёт окупаться. Потолок владельца — 5 %, и это именно потолок, а не цель | **Максимальный холод**, какой карта может дать, за назначенную заранее плату: **~10 %** производительности |
| Производительность · температура · экономия | Измеряется, а не наследуется — **ещё не измерено** | Измеряется, а не наследуется — **ещё не измерено** |
| Как применяется | При старте ПК и ярлыком | Ярлыком, когда захочется |

Исходный план приводил числа — ≥ 97 % от стока, 60–120 Вт экономии, 65 / 58 °C. KAGO не несёт их как
цели: они плавают от экземпляра к экземпляру, а на части карт существенное снижение потребления вообще
не стоит производительности. Поэтому в этой таблице появятся числа, измеренные на этом кристалле, — и
рядом с ними разброс самого прибора, потому что «потери нет», снятое тупым инструментом, находкой не
является.

**Третий ярлык возвращает карту к заводским настройкам**, и все три записывают состояние, которое
применится при следующем старте ПК, — куда кликнули последним, туда и вернётесь. Иконка в трее
показывает активный профиль и больше ничего не делает: ни меню, ни кнопок.

Это **цели приёмки, а не отгруженные профили.** Ни один профиль ещё не зафиксирован — это фаза 6, и
она ждёт, пока владелец послушает кандидатов ушами. А вот что на этом железе уже проверено, и сказать
это стоит точно, потому что список вырос: драйвер принимает запись потолка мощности и фиксацию частоты
и отдаёт их назад (300 → 290 Вт и ядро на 1200 МГц, каждая перечитана до устойчивости и откачена);
кривая мощность↔производительность этой карты снята по десяти точкам; собственный разброс прибора —
1,28 Вт; а свой мост к NVAPI читает кривую «напряжение — частота» из 128 точек, и шаг её сетки
оказался **5 мВ**, а не 6,25 мВ, как гласит фольклор.

---

<a id="5-что-нужно"></a>

## 5. Что нужно

- Windows 11
- Node.js ≥ 18
- Видеокарта NVIDIA со свежим драйвером. Разрабатывается на GeForce RTX 5070 Ti: методика общая,
  числа — нет.
- Права администратора: без них драйвер не примет запись частот и мощности.

> **Андервольтинг меняет то, как питается ваше железо.** Сделанный небрежно, он стоит замёрзшего
> экрана, сорванного прогона или испорченных данных, которых вы полгода не заметите. KAGO построен
> так, чтобы это было маловероятно и всегда обратимо, — и карта всё равно ваша. MIT означает
> отсутствие гарантий, и это не украшение текста.

---

<a id="6-собран-на-kaif"></a>

## 6. Собран на KAIF

Проект живёт под [KAIF 2.2](https://github.com/MikalaiKryvusha/KAIF) — авторским фреймворком для
ИИ-агентов: внешняя память, ограниченная автономия и дисциплина, которая держит заявление «работает»
привязанным к наблюдению. `AGENT_GUIDE.md`, `STATUS.md` и две карты проекта — то, чем свежая сессия
поднимает проект с нуля.

## Лицензия

MIT © 2026 Николай Кривуша (**КОТ КРИНИК**). См. [LICENSE](LICENSE).
