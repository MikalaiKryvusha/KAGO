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
