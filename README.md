<a id="english"></a>

# KAGO — Krinik Automated GPU Orchestrator

<h3 align="center"><em>Finds the quietest voltage your GPU can actually hold — and proves it before you trust it.</em></h3>

<p align="center">
  <a href="#english"><img src="https://img.shields.io/badge/English-2C7BE5?style=for-the-badge" alt="English"></a>
  &nbsp;
  <a href="#russian"><img src="https://img.shields.io/badge/Русский-C0392B?style=for-the-badge" alt="Русский"></a>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-FF1A8C.svg?style=flat-square)](LICENSE)
[![Status](https://img.shields.io/badge/Status-phase%201%3A%20harness%20in%20progress%2C%20engine%20not%20written-E67E22.svg?style=flat-square)](STATUS.md)
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

Two phases of six are closed. The research base, the architecture and **the test bench** are done;
the orchestrator's engine is not written yet.

The bench samples the card, loads it with KAGO's own CUDA workloads, watches the Windows event log,
and returns a three-way verdict — PASS, SDC or CRASH — by comparing a run against a golden reference
captured at stock. SDC is the one that matters: more than half of undervolting failures corrupt data
before anything crashes, so "it did not fall over" is not a passing run. One command runs the whole
phase-1 acceptance:

```bash
npm run phase1:accept
```

**Nothing built so far writes to the GPU.** There is no write path in the code at all — phase 2 is
the first that will have one.

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
               This is the CLOCK grid. The VOLTAGE grid is still unmeasured (phase 4).
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
| How its point is chosen | The largest power reduction whose performance cost is indistinguishable from zero **on this card** | The coldest and quietest point that still passes the stability oracle |
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

These are **acceptance targets, not measured results.** Nothing here has been validated on hardware
yet — that is phase 6. What *has* been proven on hardware is narrower and worth stating exactly: the
driver accepts a power-limit write on this card (300 → 290 W, read back, restored).

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
[![Состояние](https://img.shields.io/badge/Состояние-фаза%201%3A%20стенд%20строится%2C%20движка%20нет-E67E22.svg?style=flat-square)](STATUS.md)
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

Закрыты две фазы из шести. Разведка, архитектура и **испытательный стенд** готовы, движка
оркестратора ещё нет.

Стенд снимает телеметрию, грузит карту своими ядрами на CUDA, читает журнал Windows и выносит
вердикт из трёх — PASS, SDC или CRASH, — сверяя прогон с эталоном, снятым на заводских настройках.
Важен средний: больше половины отказов от андервольта портят данные раньше, чем что-нибудь упадёт,
поэтому «не свалилось» — это не пройденный прогон. Вся приёмка первой фазы идёт одной командой:

```bash
npm run phase1:accept
```

**Ничего из построенного в GPU не пишет.** Пути записи в коде нет вовсе — первой его получит вторая
фаза.

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
               This is the CLOCK grid. The VOLTAGE grid is still unmeasured (phase 4).
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
| Как выбирается точка | Наибольшее снижение потребления, у которого потеря производительности неотличима от нуля **на этой карте** | Самая холодная и тихая точка, которая ещё проходит оракул стабильности |
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

Это **цели приёмки, а не измеренный результат.** На железе пока не проверено ничего — это фаза 6.
Проверено на железе кое-что поуже, и стоит сказать точно: драйвер принимает запись потолка мощности
на этой карте (300 → 290 Вт, чтение, возврат).

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
