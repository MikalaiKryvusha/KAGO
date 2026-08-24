# Plan 40 — epic 36, phase 4: the FIX, debugged on the bench

> **Created:** 2026-08-24 (agent)
> **Parent:** `plans/36_EPIC_the_bench_that_can_fail.md` → phase 4 · phases 1–3 closed (`plans/37`, `plans/38`, `plans/39`)
> **Status:** 🟢 in work 2026-08-24 18:3x
> **Outbound:** unblocks phase 5 (the evening live run, the owner's acceptance) · closes the write-path
> half of `bugs/50` · retires the "the run halts on a SYMPTOM" defect named in `plans/39`

---

## The owner's word this phase executes

> *«1) Чини»* — and its placement, from the same order: *«2) Развивай виртуальную видеокарту,
> отлаживайся на ней, пока не починишь»*. So the fix is written against the bench of phases 2–3,
> and the live card is not a debugging surface.

## Goal vector

**Pain.** Six failure classes of the curve write are now injectable on the bench (`plans/39`), and the
engine's answer to all six is the same: it halts on a SYMPTOM. Three separate defects sit under that
one sentence, and each is quotable from this repository rather than deduced:

1. **The settle contract is written and unused on this path.** `nvapi.readVfOffsetsStable`
   (`nvapi.mjs:1069`) reads until two consecutive samples agree and cites EXP-0014 for why. Its only
   callers are inside `proveMaskWrite`. **The sweep's write path — `writeCurve`, and the atom's
   `readVfOffsets` / `readVfCurve` right after it — reads exactly once.** That is class **C1** left
   unhandled by an omission, not by a decision, and C1 is the leading live hypothesis
   (`researches/18` §5 H1, `bugs/50`).
2. **`writeCurve` returns success from STATUSES.** `nvapi.mjs:688` — `ok: failed === 0`, where
   `failed` counts non-zero returns. The module's own header says *«status 0 is not verification, the
   read-back is»* (EXP-0024) and only the neighbouring `zeroCurve` obeys it. Classes **C5** (wholly
   inert) and **C2** (partly inert) are invisible to a status-only success by construction.
3. **No caller ever NAMES the class.** The engine's stops read `ВЫДАЧА ВЫШЕ СТОКА`
   (`engine.mjs:1113`), `ПРОВЕРКА НЕ ДАЛА ОТВЕТА` (`:988`), `НЕИЗВЕСТНО` (`:1046`). All three are
   true and none of them tells the operator which of the six ways the write failed — which is the
   `plans/39` standard, item 2, stated before this phase existed.

**Where we want to be.** A write whose result is verified against the card's own table, read after it
has settled; and, when it disagrees, a stop that NAMES the class in the first clause — in the console
and in the journal — so tonight's run produces a discriminator instead of a symptom.

**Type:** Achieve (the classifier and the read-back) + Maintain (no phase-3 block goes green by
weakening).

**Meta-plan anchor:** *«4 — ПОЧИНКА, отлаженная на стенде — договор об устаивании (читать до
совпадения двух проб) · сверка по эффективной кривой · честный отказ, когда не устоялось»*.

## What this phase does NOT do

- **It does not decide which class the owner's card actually suffers.** That is a measurement, and
  the evening run is its instrument. This phase makes the answer legible; it does not invent it.
- **It does not turn any stop into a continue.** `plans/39`: *«"Handled" does NOT mean "the sweep
  continues" … The criterion is honesty, not coverage.»*
- **It does not touch NVML** (epic gate) and **writes nothing to the card** (E-AC7).

## Acceptance criteria

Scale · meter · target, per `REQUIREMENTS_FRAMEWORK.md`.

| # | Criterion | Meter | Target |
|---|---|---|---|
| F4-AC1 | The write path reads through the settle contract | source inventory | **0** single-shot reads of the curve/offsets between the write and the verdict |
| F4-AC2 | `writeCurve` refuses on a read-back mismatch, not on statuses alone | `nvapi --selftest` | mutation «trust the statuses» reddens (E-AC5) |
| F4-AC3 | Every class C1…C6 gets its NAME from the classifier | `vgpu --selftest` | 6 of 6 named, and no two share a name |
| F4-AC4 | The name reaches the operator AND the journal | `engine --selftest` | the stop text opens with the class; `writeFailureClass` is a journal field |
| F4-AC5 | A class that never settles is refused HONESTLY | `nvapi --selftest` | bounded retry → a stop naming C1, never a written number |
| F4-AC6 | No phase-3 block weakened | `git diff` on `virtual-gpu.mjs` phase-3 region | deletions **0** |
| F4-AC7 | Zero GPU writes | burn log | **0** |
| F4-AC8 | The whole battery stays green | `npm run selftest:all` | red 0 |

## The classifier — the decision table, written before the code

Input evidence, all of it already available at the write site: the per-call statuses (`failed`,
addresses) · the requested offsets · the offsets the card HOLDS after settling · whether the read
settled at all.

Order is part of the rule: the first row that matches wins, because the earlier rows describe
evidence the later rows cannot produce.

| # | Class | Test | Why this order |
|---|---|---|---|
| C4 | a call returned non-zero | `failed > 0` | the only class that is visible BEFORE any read; it is also the only one that costs no card time |
| C1 | the read never settled | `settled === false` | until the table stands still, every mismatch below is unproven — a mismatch read off a moving table is not evidence |
| C5 | the write is wholly inert | every requested non-zero entry holds `0` | the degenerate case of C2; named separately because the run must not read the surviving stock table as «an undervolt that saved nothing» |
| C6 | the table landed shifted | most mismatched `i` hold `requested[i-1]` | systematic; distinguishable from C2 by the SHAPE, not by the count alone |
| C2 | part of the entries is inert | every mismatched entry holds `0` | scattered zeroes with a faithful remainder |
| C3 | the driver adjusted the result | a mismatched entry holds a non-zero that is neither ours nor a shift | what is left after the four above are excluded |

**A seventh shape is `unclassified`, and it is a first-class answer** rather than a fall-through into
C3: an unnamed disagreement reported as C3 would be an invented diagnosis, which is the three-doors
rule's forbidden door (`PHILOSOPHY.md`). It carries the first five mismatches verbatim.

### ✏️ TWO ROWS CHANGED WHEN THE BENCH ANSWERED — recorded rather than quietly rewritten

The table above was written before the code. Two of its rows did not survive contact with the
fixtures, and both corrections came from the bench rather than from reasoning:

1. **C1's test is not «the read never settled» in the sense of quiet.** The bench models C1 as «the
   first N reads return the PRE-WRITE table» — the faithful shape of the canon's own 2026-08-10
   measurement. Two probes taken inside that window AGREE WITH EACH OTHER and are both stale, so a
   «two consecutive samples agree» contract would have accepted the old table and called it settled.
   The poll therefore waits for the card to hold **what we asked**, not for quiet
   (`nvapi.pollUntilApplied`), and the bound's expiry is told apart by the last two probes: still
   moving → C1; stopped elsewhere → classified by shape. The fast path costs nothing — an obedient
   card answers on probe 1 with no sleep at all. **`probes > 1` is itself evidence and is reported on
   SUCCESS too:** it means C1 happened and was waited out.
2. **C3 cannot be recognised in the control structure alone, and the bench proved it by accident.**
   Its fixture nudges the first pressed entry by +15 MHz; that entry's own offset is −15, so the
   adjusted value lands on exactly ZERO — indistinguishable from an inert entry. The fixture was NOT
   touched (the phase-4 gate forbids exactly that). Instead the classifier gained the evidence the
   class is actually observed by: **`offeredAboveCapMhz`, the effective curve's top above the
   ceiling** — the shape the live card produced on 2026-08-24 (2370 at a 2355 ceiling). Only the atom
   can measure it; `writeCurve` passes `null` and gets the honest C2.
   **Consequence for the evening run, and it is the useful half:** the point-by-point re-read ALONE
   does not settle hypothesis H3 — the number «how far above the ceiling» must travel with it. Both
   fields now reach the journal. And a GREEN point-by-point together with a breached ceiling is C3
   rather than «no failure», which is precisely the case that would otherwise have been thrown away.

## Steps

- [x] **1. `readVfCurveStable`** beside the existing `readVfOffsetsStable` — the same contract for the
      EFFECTIVE curve, because `researches/18` §5 H1 is about `curveAfter`, a single read of the
      effective table right after 127 writes. One shared helper, two readers; the offsets version
      keeps its name and its callers.
- [x] **2. `writeCurve` verifies the result** — after the write loop it reads the offsets through the
      settle contract and compares point by point against what was asked. Returns `held`,
      `mismatches`, `settled`, `failureClass`. `ok` becomes «the calls were accepted AND the card
      holds what we asked», which is what EXP-0024 has demanded in this module's own header since
      2026-08-10.
- [x] **3. `classifyWriteFailure`** — a pure exported function implementing the table above, judged
      offline against the six fixtures of `WRITE_FAILURE_CLASSES`.
- [x] **4. The atom carries the name** — `vf-step` stops re-reading the offsets itself (it now gets
      `held` from the write, which removes a second reader of one fact rather than keeping the two in
      agreement) and puts `writeFailureClass` into its result and into a named block.
- [x] **5. The engine NAMES the class first** — every stop that can be caused by a failed write opens
      with the class; `sweep-journal` gains `writeFailureClass` beside `redBlocks`.
- [x] **6. Blocks and mutations.** Addressees named before the run:
      **MA.** `writeCurve` trusts the statuses again → F4-AC2 block reddens ·
      **MB.** the settle contract replaced by a single read → the C1 block reddens ·
      **MC.** `unclassified` folded into C3 → the «no invented diagnosis» block reddens ·
      **MD.** the class dropped between the atom and the journal → F4-AC4 block reddens.
- [ ] **7. `npm run check` · `npm run selftest:all` · traps · bench**, then the judge pass, then
      `plans/41` for phase 5 (the live run).

## Risks

| Risk | Tier | Mitigation |
|---|---|---|
| Making `writeCurve.ok` stricter changes the owner's SHIPPED applier | **(a)** | `profile-manager.apply` already re-reads and refuses (`:642`); this makes it refuse EARLIER and with a name. The applier's own blocks are re-run, and a refusal there was always the correct answer to a write that did not land |
| The settle loop costs card time on every rung | (b) | Two agreeing samples at the existing 250 ms gap; a settled table returns on the second read. Bounded by `maxSamples`, and the bound's expiry is C1, not a silent accept |
| The classifier names a class the card did not suffer | **(a)** | `unclassified` exists so nothing is forced into a row; each row is tested against the fixture that models it, and the mutation MC proves the fall-through is not silently generous |
| A phase-3 block goes green by weakening | **(a)** | F4-AC6 counts deletions in the phase-3 region; the meta-plan's gate says the same in words |

## Результат — измерен прогонами, 2026-08-24 18:5x…19:0x

| # | Критерий | Чем закрыт |
|---|---|---|
| F4-AC1 | ✅ **на пути развёртки** | Опись вызовов: до записи — `readVfOffsets`/`readVfCurve` (законно), запись — `writeCurve` с опросом, после — `readVfCurveStable`, откат — `zeroCurve` через тот же опрос. **Ноль одиночных чтений между записью и вердиктом.** ⚠️ Названо как долг: `measureUndervolt` и `runShapeExperiment` — отдельные приборы, не путь развёртки — читают одиночно и обнуляют кривую своим циклом вместо `zeroCurve`; в объём фазы 4 это не входило и молча не расширялось |
| F4-AC2 | ✅ | Мутация MA («судить по статусам») краснит блок «C5 ВИДЕН ПРИ УСПЕШНЫХ СТАТУСАХ» |
| F4-AC3 | ✅ | 6 из 6 имён, все различны (блок F4-AC3) |
| F4-AC4 | ✅ | `writeFailureClass` и `writeSettled` — поля строки вердикта; текст остановки открывается классом, симптом сохранён рядом (три блока, мутации EA/EB/EC) |
| F4-AC5 | ✅ | «НЕ ПРИШЛА К ЗАКАЗАННОЙ И ПРОДОЛЖАЕТ МЕНЯТЬСЯ = C1», мутация NB |
| F4-AC6 | ✅ | `git diff` по `virtual-gpu.mjs`: 125 добавлений, **1 удаление — строка `import`**. Ни одного утверждения фазы 3 не тронуто |
| F4-AC7 | ✅ | Записей в видеокарту за фазу — **0**. Единственное обращение к карте — сухой прогон (только чтение, код 0) |
| F4-AC8 | ✅ | Батарея: 27 наборов, красных 0, **1304 зелёных блока** (было 1282) |

**Мутации: 11 из 11 покраснили ровно свои названные блоки** — NA · NB · NC (опрос) · MA · MB · MC ·
MD · ME (классификатор) · EA · EB · EC (движок и журнал). Прогонщик — одноразовый скрипт вне
репозитория; каждая мутация накладывается, набор гоняется, файл восстанавливается побайтово.

⚠️ **И одна мутация СНАЧАЛА УБИЛА НАБОР ВМЕСТО ТОГО, ЧТОБЫ ПОКРАСНЕТЬ.** MA делает классификатор
возвращающим `null`, а блок F4-AC3 разыменовывал `asC1.class` — `TypeError` уносил весь набор, то есть
сторож прятал своё доказательство за падением. Это **EXP-0075, предъявленный ШЕСТОЙ раз**; исправлен
блок (через `?.`), а не мутация, и причина оставлена в комментарии рядом.

## Decisions made without the owner

- **Опрос ждёт «запись легла», а не «таблица успокоилась».** Обоснование выше (правка №1); альтернатива
  — договор согласия — на модели C1 принимает устаревшую таблицу, то есть не лечит ведущую гипотезу.
- **Границы опроса — 6 проб × 250 мс (худший случай 1,5 с на запись).** Основание: замер 2026-08-10,
  где состояние сменилось «примерно через секунду». Полный бюджет проходится ТОЛЬКО на отказном пути;
  послушная карта отвечает первой пробой без единой паузы.
- **`zeroCurve` перестал читать вторично** — доказательство переехало ВНУТРЬ записи, а не повторяется
  рядом. Само утверждение отката («ненулевых не осталось») не изменено. Откат — самый чувствительный
  путь, поэтому больше в нём не тронуто ничего.
- **`writeCurve.ok` стал строже и это меняет поведение ОТГРУЖАЕМОГО применителя** (`profile-manager`):
  он теперь отказывает раньше и с именем класса. Считаю это верным — отказ на записи, которая не
  легла, всегда был правильным ответом, — но называю вслух, потому что это поверхность владельца.
- **Долг F4-AC1 по двум приборам назван, а не закрыт** (см. таблицу): расширять объём фазы 4 на них
  вечером, перед приёмкой, значило бы менять то, что никто не собирался прогонять.
