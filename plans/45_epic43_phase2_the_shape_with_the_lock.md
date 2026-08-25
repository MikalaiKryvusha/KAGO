# Plan 45 — epic 43, phase 2: the shape with the LOCK

> **Created:** 2026-08-25 10:3x (agent) · **Parent:** `plans/43_EPIC_the_ceiling_that_holds.md` → phase 2
> **Status:** 🟢 **EXECUTED OFFLINE 2026-08-25 11:0x…11:4x** — steps 0–7 done, seven of eight criteria
> closed by measurement; F2-AC6's live half belongs to phase 3 by construction. Commit `58260e6`.
> **Predecessor:** `plans/44` (phase 1 closed with one named gap — that gap was step 1 here and is closed)
> **Outbound:** unblocks phase 3 (live acceptance with the owner); closes `bugs/50`'s write-shape half

---

## Meta-plan anchor

> *«Фаза 2 — ФОРМА С ЗАМКОМ. `chooseWriteShape` учится третьей форме: поднятая кривая + замок
> верхней границей. Писатель взводит и откатывает замок в том же `finally`, что и кривую. Сухой
> прогон называет держателя.»*

## Goal vector

**Pain.** The ceiling the sweep writes is not a ceiling: measured nine times, the card runs 2–3 grid
steps above it while the write itself is provably intact. Five of eleven rungs across two live bands
lost their verdict to this, and the second band's coverage fell to 38.5 % against the first's 94.7 %.

**Where we want to be.** Above the ceiling floor the shipped shape carries a clock lock as its UPPER
BOUND alongside the raised curve, on every rung of a band; the lock is armed and rolled back on the
same path as the curve; and a rung whose ceiling is breached becomes impossible rather than merely
named. Owner's decision: `interviews/015` Q1 = A · Q2 = A (*«A, на всей полосе частот»*).

**Type:** Achieve (the third shape) + Maintain (no existing bench or engine assertion weakened).

---

## ⚠️ STEP 0 IS NOT THE LOCK, AND SKIPPING IT MAKES EVERY LATER GREEN A LIE

Phase 1 measured this and it is the reason this plan opens here rather than at `chooseWriteShape`:

| | live card (9 cases) | bench T8 today |
|---|---|---|
| where the engine stops | the ceiling proof → `ФОРМА УСТОЯЛА, КАРТА ЕЁ НЕ СОБЛЮЛА` | `runRung#delivery-above-stock` |
| `ceilingBreachHolder` | `КАРТА` | `—` (never reached) |

**Cause, established by a reverted experiment rather than by reasoning** (`plans/44` → the amended
hypothesis): the bench's stand-in atom (`trap-suite.makeSweepStepFn`) **never calls
`judgeDeliveredClock` at all.** It has no sampler, while the live ceiling proof judges sampled
`clocks.gr` under load. Its own ceiling block judges the TABLE (`offeredAfterMhz` vs cap) — and the
table is exactly what is NOT broken here.

Proven by removing the incidental stop: the trap then caught **nothing** (0 skipped, no holder). An
incidental catch and a direct check look identical while both are red.

**So until the bench judges the delivered clock, a green `npm run traps` after the lock lands would
prove a branch the live card does not walk.** That is step 1 below, and phase 2's gate depends on it.

---

## Acceptance criteria — scale · meter · target

| # | Criterion | Meter | Target |
|---|---|---|---|
| F2-AC1 | The bench judges the DELIVERED clock, like the live path | source inventory + `npm run traps` | `judgeDeliveredClock` called on the bench path; T8's holder is **`КАРТА`**, not `—` |
| F2-AC2 | T8's two pending assertions RUN and are GREEN, and `openPhase` is deleted | `npm run traps` | waiting **0**, failures **0** |
| F2-AC3 | …and they are green FROM THE LOCK, not from weakening | mutation: remove the lock from the shape | T8's assertions go **red** again |
| F2-AC4 | The lock is armed and rolled back on the curve's own path | `vfstep --selftest` + `watchdog --status` after a bench sweep | rollback steps asserted BY NAME; nothing held at rest |
| F2-AC5 | The dry run NAMES the holder before any write | `engine --sweep --dry-run` | every frequency above the floor prints «кривая + замок» |
| F2-AC6 | The lock does not drag the delivered clock DOWN | median delivered vs cap, on the bench and then live | shortfall ≤ **one grid step** |
| F2-AC7 | Nothing weakened | `npm run selftest:all` | red 0, block count does not decrease |
| F2-AC8 | Zero GPU writes during development | burn log | **0** — the live card is phase 3 |

---

## Steps

- [x] **0. Re-read** `plans/44` → «ЧТО ФАЗА 2 ОБЯЗАНА СДЕЛАТЬ ПЕРВЫМ ШАГОМ» and `researches/11` §8.
- [x] **1. The bench judges the delivered clock.** The stand-in atom gains what the live atom has:
      a delivered median and max, fed to the SAME `judgeDeliveredClock` (never a second copy —
      EXP-0077), with `offeredAfterMhz` passed so the holder can be named. ⚠️ **T7 is sensitive to
      this path** — it went red on the first attempt at a neighbouring change; run `npm run traps`
      after every edit, not at the end.
- [x] **2. T8 turns from pending to running** — and must be RED at this point, for the RIGHT reason
      («держатель КАРТА»). A red here is the phase's real gate: it proves step 1 wired the judgement
      through. Only then proceed.
- [x] **3. `chooseWriteShape` learns the third shape** — raised curve + clock lock as the upper
      bound, chosen on every rung above the ceiling floor (owner's Q2 = A: one shape per band).
      The 2026-08-14 conflict does NOT repeat: both mechanisms name the SAME frequency, the curve
      from below and the lock from above. The assertion for this shape is «never ABOVE», never
      «the clock is CONSTANT» — a capped card is legitimately free below its ceiling.
- [x] **4. The writer arms and releases the lock** in the same `finally` as the curve; the total undo
      (R9a) already covers clocks, so this EXTENDS an existing step rather than adding a fourth kind
      of state. Assert the undo's steps BY NAME, never by a count.
- [x] **5. The dry run names the holder** — «кривая + замок» per frequency (F2-AC5), computed by the
      same `planFrequency` the run walks, so plan and run cannot drift (`bugs/09`).
- [x] **6. Blocks and mutations.** Addressees named before the run:
      **NA.** drop the lock from the shape → T8's assertions red (F2-AC3) ·
      **NB.** arm the lock but never release it → the undo block red (F2-AC4) ·
      **NC.** assert «constant clock» instead of «never above» → the healthy capped rung goes red,
      which is the 2026-08-14 regression and must be caught ·
      **ND.** name the holder only in prose, not in the field → F2-AC1 red.
- [x] **7.** `npm run check` · `traps` · `selftest:all` · a bench rehearsal (`npm run bench`), then
      the judge pass, then `plans/46` for phase 3 (live acceptance).

---

## Risks

| Risk | Tier | Mitigation |
|---|---|---|
| The lock drags the delivered clock DOWN and we measure a lower frequency than we think | **(a)** | F2-AC6 measures it — bench first, then live. `researches/11` §1 says a lock BOUNDS rather than commands, but that is a vendor claim, not a measurement on this card |
| The 2026-08-14 conflict repeats (two mechanisms fighting) | **(a)** | They named DIFFERENT frequencies then; here they name the same one. Mutation NC exists to catch the wrong assertion being restored |
| A lock left on the card after a writer's death | **(a)** | R9a's total undo already covers clocks; step 4 extends it BEFORE the first write, and the drill is the proof (`watchdog --drill`) |
| The bench goes green while the live card still breaches | **(b)** | Named in `plans/44`'s honesty boundary: the bench proves the ENGINE. Phase 3 is the only thing that measures the silicon, and E43-AC5 is its number |
| T7 or another trap breaks on the shared atom path | (b) | Observed once already; step 1 says run `traps` after every edit |

---

## Результат — измерен прогонами 2026-08-25 11:0x…11:4x, коммит `58260e6`

| # | Критерий | Чем закрыт |
|---|---|---|
| F2-AC1 | ✅ | Атом стенда зовёт `judgeDeliveredClock` и `applyCeilingJudgement` — ТЕ ЖЕ, что живой путь, а не копии. Держатель T8 стал **`КАРТА`** (было `—`), остановка — `ceiling-КАРТА` (было `runRung#delivery-above-stock`). То есть двойник теперь падает ТАМ ЖЕ, где падает карта |
| F2-AC2 | ✅ | `npm run traps`: **56 утверждений, провалов 0, ЖДУТ 0** (было 51/2/2). Поле `openPhase` у T8 удалено — сторож снова требует прогнанного утверждения без оговорок |
| F2-AC3 | ✅ | Мутация **NA** («убрать замок из формы») красит оба утверждения T8, блок `chooseWriteShape` и блок проводки. Зелень — от замка, а не от ослабления |
| F2-AC4 | 🟡 **половина, и вторая названа ниже** | Стенд: сторож «КАРТА ПОСЛЕ ПОЛОСЫ ЧИСТА» на всех ПЯТИ полосах, мутация **NB** красит 4 из 5. Живой атом: откат расширен общим флагом `clocksHeld` и шаг сохранил ИМЯ — но офлайн-блока на это НЕТ, потому что у `runStep` нет офлайн-шва вовсе (долг, объявленный в шапке модуля задолго до этой фазы). Разбор — «Долг» ниже |
| F2-AC5 | ✅ | Оба сухих прогона называют держателя по каждой ступени: «потолок держит **кривая + замок**». Пара план↔прогон СХЛОПНУТА (обе стороны зовут одну `chooseWriteShape`), и блок движка это сторожит |
| F2-AC6 | 🟡 **стендовая половина закрыта, живая принадлежит фазе 3** | Репетиция: «разброс выдачи внутри прожига: худший **0 МГц**», «ЗАКАЗ ↔ ВЫДАЧА: не разошлись ни разу». И главное — **T6 сохранила свой недобор 60 МГц ПОД замком**: граница ограничивает сверху и не командует снизу. ⚠️ Это свойство МОДЕЛИ, а не кремния (см. границу честности `plans/44`) |
| F2-AC7 | ✅ | Батарея: **28 наборов, красных 0, 1370 зелёных блоков** (было 1360). Ни один набор не убыл: `traps` 48 → 56, `vfstep` 68 → 70 |
| F2-AC8 | ✅ | Записей в видеокарту за фазу — **0**. На закрытии: карта **300 Вт заводских**, сторож НЕ взведён |

**Мутации: 4 из 4 покрасили ровно свои названные блоки**, целый код не покрасил ни одного, файлы
восстановлены из снимков и перепроверены прогоном.

### 🔴 ЧТО НАШЛА МУТАЦИЯ NB — И ЭТО ЦЕННЕЕ САМОЙ МУТАЦИИ

С первого захода NB («взвести границу и НЕ отпустить её») покрасила **НОЛЬ блоков**: набор из 51
утверждения прошёл целиком, пока стенд оставлял `-lgc` на карте после каждой ступени.

**Причина структурная, и потому опасная:** следующая ступень ПЕРЕЗАПИСЫВАЕТ замок своим, а в конце
полосы никто не спрашивал карту, держит ли её ещё что-нибудь. Утечка состояния была невидима ПО
ПОСТРОЕНИЮ — ровно тот класс, где зелёный набор означает «мы туда не смотрели», а не «там чисто».

Сторож заведён **ОДИН на все пять полос**, а не внутри T8: границу с этой фазы получает КАЖДАЯ
ступень выше пола потолка, то есть все полосы всех ловушек. «Починить экземпляр» здесь оставило бы
четыре дыры из пяти (`BUG_FIXING_FRAMEWORK.md` → «закрывай класс, а не случай»). После этого NB
красит 4 утверждения и НАЗЫВАЕТ утечку числом: «осталось: замок 180…2842 МГц».

## 💸 Долг, названный и НЕ закрытый

**У живого атома нет офлайн-блока на то, что граница отпускается.** Шаг отката теперь общий для
закрепления и границы (флаг `clocksHeld`), и это верно по R9a — но доказано оно только на стенде.
Причина не в лени: **у `runStep` нет офлайн-шва вовсе**, и это долг, объявленный в шапке
`vf-step.mjs` задолго до этой фазы. Извлечь состав списка отката из `finally` — правка ПУТИ ЗАПИСИ в
карту владельца, и делать её в конце сессии, после которой запланирован живой прогон, — ровно та
спешка, которой владелец просил избегать.

**Чем риск ограничен прямо сейчас, по ярусам:** откат ТОТАЛЬНЫЙ, а не разностный
(`resetToFactory`, R9), то есть он возвращает карту к заводскому независимо от того, что было
записано; внешний сторож R9 покрывает смерть писателя и доказан живым `--drill`; и `-lgc` не
переживает перезагрузку. Остаточный риск — забытая граница до конца сессии на живой машине, и его
видит `npm run watchdog -- --status`, который в чеклист приёмки уже входит.

## Decisions made without the owner

- **Граница пишется ДИАПАЗОНОМ `min` = нижняя ступень лестницы карты, `max` = потолок, а не
  `min = max`.** Выбрано так, потому что `min = max` — это ЗАКРЕПЛЕНИЕ, которое владелец запретил в
  отгружаемой форме прямым словом (*«карта сама могла и разгоняться и снижать частоты»*), а факт 38
  `STATUS.md` называет диапазон лекарством дословно. Своего влияния у `min` на этой карте, судя по
  `researches/11` §1 (проба 3: заказ 2700 → выдано 2692), нет вовсе — то есть выбор консервативен.
- **`lockRequired` заведено ОТДЕЛЬНЫМ полем от `pinRequired`,** а не значением того же. Слить их
  значило бы потребовать от карты под границей ПОСТОЯНСТВА частоты — конфликт 2026-08-14 дословно.
  Мутация NC это воспроизвела: полоса T6 встала на `runRung#proof-failed`, закрыто 0 частот из 6.
- **Форма записи (`writeShape`) НЕ изменилась** и осталась `raise-and-cap`. Замок в кривую не пишет
  ничего, а новая строка формы отрезала бы 86 уже оттюненных частот от храповика
  (`partitionByWriteShape`) — и отрезала бы ЛОЖНО: кривая побайтово та же самая.
- **Недобор частоты на стенде теперь считает СУДЬЯ, а не сам стенд.** Прежняя копия была СТРОЖЕ
  оригинала (звала недобором и одну ступень сетки, которую судья считает округлением). Схлопнуто в
  сторону оригинала, потому что вторая правда о недоборе — это пара, которую нельзя сторожить.
- **Сторож «карта после полосы чиста» поставлен на ВСЕ пять полос сразу,** а не только на T8.
- **Шапки обоих сухих прогонов переписаны.** Они описывали форму, которой больше нет; оператор
  читает их ПЕРЕД санкцией на запись (рельс S2), и шапка, описывающая прошлое, превращает санкцию
  в подпись под другим документом.
