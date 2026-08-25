# Plan 44 — epic 43, phase 1: the bench learns to BREACH the ceiling

> **Created:** 2026-08-25 10:1x (agent) · **Parent:** `plans/43_EPIC_the_ceiling_that_holds.md` → phase 1
> **Status:** 🟢 in work
> **Outbound:** unblocks phase 2 (the shape with the lock) — which cannot be proved without this

---

## Meta-plan anchor

> *«Фаза 1 — СТЕНД УЧИТСЯ ПРОБИВАТЬ ПОТОЛОК … Сегодня виртуальная карта честно соблюдает потолок,
> то есть дефекта, который мы собрались чинить, на стенде НЕ СУЩЕСТВУЕТ.»*

## Goal vector

**Pain.** The defect epic 43 exists to fix cannot be reproduced offline. Verified by reading, not
recalled: `virtual-gpu.deliveredUnderCurve()` computes `ceiling = max(effectiveTable)`, then walks
the frequency grid downward with `if (f > ceiling) continue`. **Exceeding the ceiling is
structurally impossible for the double.** A fix landing on top of that would be a fix nothing can
redden — the exact shape `BUG_FIXING_FRAMEWORK.md` → Guards forbids.

**Where we want to be.** The virtual card can deliver a clock ABOVE the ceiling its written curve
offers, by a whole number of grid steps taken from the live measurement (2 and 3), and a trap
exercises it, and that trap is RED on today's engine.

**Type:** Achieve (the behaviour + the trap) + Maintain (no existing bench assertion weakened).

---

## ⚠️ THE HONESTY BOUNDARY OF THIS WHOLE EPIC — stated in phase 1 because this is where it is born

Modelling the breach means encoding OUR BELIEF about the card into the double. In particular, the
lock's suppressing effect falls out of `runningMhz()` for free: it returns `targetMhz()` first, so a
locked virtual card cannot overshoot **by construction of the model**.

**Therefore a green bench in phase 2 proves the ENGINE, not the silicon.** It shows the sweep writes
the right shape, arms and rolls back the lock, and judges the ceiling correctly — GIVEN that a clock
lock bounds the clock. Whether it bounds it on THIS card is `researches/11` §1's claim from vendor
sources, and it is measured only by phase 3, live, with the owner present.

A future session reading a green `npm run traps` must not conclude `bugs/50` is closed. The bench's
own provability line already says this in general; this paragraph says it for this epic specifically.

---

## Acceptance criteria — scale · meter · target

| # | Criterion | Meter | Target |
|---|---|---|---|
| F1-AC1 | The double CAN exceed its curve's ceiling | delivered clock minus ceiling, in grid steps, on a card carrying the new fiction field | **2 or 3**, and it is the number the fixture asks for |
| F1-AC2 | Default behaviour is BYTE-identical for every existing card | `npm run vgpu -- --derive` output diff on all cards in `benches/cards/` | **empty diff** |
| F1-AC3 | The breach is suppressed by a lock | delivered clock on the same card while locked | **equals the lock**, overshoot 0 |
| F1-AC4 | A trap exercises it, and it is RED on today's engine | `npm run traps` | the new trap **fails** before phase 2, with the reason naming the breach |
| F1-AC5 | Nothing existing weakened | `npm run selftest:all` | red 0, block count does not decrease |
| F1-AC6 | Zero GPU writes | burn log | **0** |

---

## Steps

- [ ] **1. The fiction field.** `boostStepsAboveCeilingMhz` — how many GRID STEPS above the written
      curve's ceiling the card's boost arbitration may land. Absent / 0 → today's behaviour exactly,
      which is what F1-AC2 protects. Value comes from the measurement (`researches/11` §8: 2 in
      seven cases, 3 in two), never from a round number someone liked.
- [ ] **2. `deliveredUnderCurve` honours it** — the ceiling used for the downward walk is raised by
      that many grid steps BEFORE the walk. One edit, in the one place the ceiling is computed
      (`plans/38` collapsed the three copies into `effectiveTable`; do not re-fork them).
- [ ] **3. A trap card** in `benches/cards/traps/` deriving from the measured geometry, carrying the
      field. Its name says what it traps.
- [ ] **4. The trap assertion** in `trap-suite`: the rung must NOT be judged PASS while the card ran
      above the ceiling — i.e. the engine's own `judgeDeliveredClock` must call it `breached` with
      holder `КАРТА`, which is the field `bugs/50` added this morning.
- [ ] **5. Blocks and mutations.** Addressees named before the run:
      **MA.** ignore the fiction field (walk from the unraised ceiling) → F1-AC1 block reddens ·
      **MB.** let a LOCKED card overshoot → F1-AC3 block reddens ·
      **MC.** default the field to 2 instead of 0 → F1-AC2 (empty diff) reddens.
- [ ] **6.** `npm run check` · `npm run vgpu -- --selftest` · `npm run traps` · `npm run selftest:all`.

---

## Risks

| Risk | Tier | Mitigation |
|---|---|---|
| The double learns to breach DIFFERENTLY than the card does | **(a)** | Steps are grid steps, and the count comes from the nine measured cases, not from a guess. The fixture cites `researches/11` §8 by name |
| An existing card silently changes behaviour | **(a)** | F1-AC2 is a byte diff, not an opinion; MC is the mutation that proves the diff can go red |
| The trap goes green for the wrong reason (engine never reaches the judgement) | **(a)** | F1-AC4 demands the trap be RED first, with the reason naming the breach — a trap that has never failed proves nothing |
| Modelling the lock's suppression pre-decides phase 3's answer | **(b)** | Named above in the honesty boundary; phase 3 is the only thing that measures the card |

---

## Результат — измерен прогонами 2026-08-25 10:2x…10:4x

| # | Критерий | Чем закрыт |
|---|---|---|
| F1-AC1 | ✅ | При НУЛЕВОЙ глубине карта выдала **2857 МГц при потолке 2842 — ровно две ступени сетки**, то есть в точности живое число. Мутация MA («игнорировать поле», состояние ДО фазы) краснит этот блок |
| F1-AC2 | ✅ **по моей правке** | Чистый опыт: правка отложена, карта выведена заново — **диф тот же самый**. То есть обычная карта от поля не меняется. ⚠️ Рядом найдена ОТДЕЛЬНАЯ разошедшаяся пара — см. долг ниже |
| F1-AC3 | ✅ **как контракт модели, не как факт о кремнии** | Под замком та же карта выдала ровно 2842, превышение 0 против 15 без замка. Мутация MB краснит блок. Граница честности — раздел выше |
| F1-AC4 | 🟡 **половина** | Ловушка КРАСНАЯ на сегодняшнем движке — да. Но причина называет **не тот механизм**: движок встаёт на `runRung#delivery-above-stock` РАНЬШЕ проверки потолка, держатели в сводке «—», а не «КАРТА». На живой карте срабатывала именно проверка потолка. **Разрыв верности двойника — первый шаг фазы 2** |
| F1-AC5 | ✅ | Батарея: 28 наборов, красных 0, **1360 зелёных блоков** (было 1354), `traps` 42 → 48 |
| F1-AC6 | ✅ | Записей в видеокарту за фазу — **0** |

**Мутации: 2 из 2 покраснили ровно свои названные блоки** (MA · MB), целый код не покраснил ни
одного, файл восстановлен побайтово. MC проверена не прогонщиком, а опытом изоляции (F1-AC2).

### 🔴 ЧТО ФАЗА 2 ОБЯЗАНА СДЕЛАТЬ ПЕРВЫМ ШАГОМ — и это не «замок»

**Двойник падает не там, где падает карта.** Пока это так, зелёный стенд после починки не будет
означать ничего: он докажет ветку, которой живая карта не проходит.

| | живая карта (9 случаев) | стенд T8 сегодня |
|---|---|---|
| где встаёт движок | проверка потолка → `ФОРМА УСТОЯЛА, КАРТА ЕЁ НЕ СОБЛЮЛА` | `runRung#delivery-above-stock` |
| `ceilingBreachHolder` | `КАРТА` | `—` (до проверки не дошло) |
| `servingMvAfter` | не выше стока (напр. 845 мВ, `seq 727`) | ВЫШЕ стока |

Ведущая гипотеза разрыва, НЕ проверенная: у частоты выше верха записанной кривой
`oracle.servingVoltageMv` не находит ни одной записи и возвращает МАКСИМУМ таблицы. Физически же
карта на выпрямленном плато обслуживается тем же напряжением, что и потолок, — и живой журнал это
подтверждает (`servingMvAfter` равен ЗАКАЗАННОМУ). Проверять чтением, а не правкой наугад.

Оба утверждения T8 о движке поэтому стоят в состоянии **«ЖДЁТ» по ОБЪЯВЛЕННОЙ причине** (поле
`openPhase` у ловушки), а не в «провале»: держать репозиторий красным между фазами нечестно перед
следующей сессией, а зазеленить утверждение молча — нечестно перед дефектом.

## 💸 Долг, найденный по дороге и НЕ закрытый

**`benches/cards/rtx5070ti.json` разошёлся со своим генератором.** Записанный файл выведен старшей
версией кода: сегодняшний `--derive` добавляет `"hangAtOrBelowMv": null`, которого в файле нет.
Доказано опытом изоляции — расхождение есть и БЕЗ моей правки. Это пара «истина ↔ зеркало»
(генератор ↔ его артефакт), и её место в реестре пар `AGENT_GUIDE.md`. Не чинил намеренно: правка
генерируемой карты трогает то, с чем сверяются другие наборы, и делать это в последние минуты
сессии — ровно та спешка, которой владелец просил избегать.

## Decisions made without the owner

- **Ловушке разрешено состояние «ЖДЁТ» через ОБЪЯВЛЕННОЕ поле `openPhase`**, а не через ослабление
  сторожа: без поля правило прежнее и жёсткое, отсутствие утверждения запрещено по-прежнему ВСЕМ.
  Выбрано так, потому что альтернативы хуже: красный репозиторий между фазами или молча зелёное
  утверждение о непочиненном дефекте.
- **В ловушку взято МЕНЬШЕЕ из двух замеренных превышений** (2 ступени, а не 3): ловушка обязана
  ловить и слабейшую форму дефекта.
- **Число ловушек в стороже поднято с 7 на 8 осознанно**, как требует его собственный комментарий —
  сторож сработал правильно, заметив восьмую.
