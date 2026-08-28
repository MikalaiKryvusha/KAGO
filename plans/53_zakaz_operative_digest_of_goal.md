# Plan 53 — «ЗАКАЗ»: the operative digest of GOAL, approved by the owner

> **Created:** 2026-08-28 · **Parent:** интервью 017, Q3 = A (the owner's decision, 2026-08-28
> 01:23) · method audit `reports/KAIF_AUDIT/2026-08-28_audit_03_method.md` §6 (Р3)
> **Status:** 🟡 OPEN — written before any implementation, per the owner's word («мы напишем нужные
> планы и закроем чат, а делать по планам будем в новом чате», 2026-08-28)
> **Outbound:** the draft goes to the owner THROUGH THE REVIEW CONTOUR; nothing is in force until
> his approval is recorded.

## Goal vector

**Pain.** `GOAL.md` is 1,514 lines of verbatim transcript with cancellation layers; the operative
truth (what a mode IS, when tuning ENDS, what the barriers ARE) must be excavated from
redefinition history on every read — including documented traps («не перепутай два числа 885»).
The «two truths» class recurs because the corpus outgrew the sessions that maintain it.

**Where we want to be.** One document «ЗАКАЗ» (`ЗАКАЗ.md`, root, RU — the owner reads it): ~150
lines of CURRENT-FORCE definitions only, each line carrying a link to its verbatim source in
`GOAL.md`; approved by the owner; edited only on his word. `GOAL.md` remains the verbatim
append-only archive (its header already says so — интервью 017, Q3). Sessions re-read «ЗАКАЗ»;
the archive is for disputes and archaeology.

**Goal type:** Achieve (the digest exists and is in force) + Maintain (not one owner formulation
is lost or reworded — the digest LINKS, never paraphrases silently).

## Acceptance criteria (Scale · Meter · Target)

| # | Criterion | Meter | Target |
|---|---|---|---|
| AC1 | «ЗАКАЗ» is small and sourced | line count; every definition carries a `GOAL.md`-anchor + date | ≤ 200 lines; 0 definitions without a source link |
| AC2 | Coverage is the NAMED set, not «everything important» | section checklist (below) | all 9 sections present, none beyond them without the owner's word |
| AC3 | The owner approved it | review-contour decision record (`interviews/decisions/`) | recorded approval; until then «ЗАКАЗ» carries a draft banner and is NOT in force |
| AC4 | Wired into the canon surface | `AGENT_GUIDE.md` context router: definitions route to «ЗАКАЗ»; `/resume` set unchanged in size | router row edited; no new documents beyond «ЗАКАЗ» itself |
| AC5 | The archive is untouched | `git diff GOAL.md` for the delivery commit | header pointer only (already placed 2026-08-28); body byte-identical |

**AC2 — the nine sections:** (1) the four modes table (one voltage vector · power limits
300/250/250 · ceiling only in Silent Cold) · (2) the acceptance criterion of the whole project
(edges for ALL 389 frequencies; the four legal origins) · (3) the five barriers (ratchet · hang
floors · oracle as condition · watchdog/rollback · no unconfirmed writes) with «всё прочее —
помощники» · (4) the margin rule (last stable + 1 grid step) · (5) noise thresholds (40 % / 60 %,
the rpm ruler) and the temperature targets derived from them · (6) the flexible-tuning unit of
work (one burn; the three-source intersection; «каждый прожиг — улика») · (7) the frequency
language (no numbered points; frequency → serving voltage) and the register rule pointer ·
(8) live-run autonomy (интервью 017 Q4 verbatim: edge only with a human; unattended only
non-edge, guaranteed non-hanging) · (9) the standing method rules from интервью 017 (moratorium
threshold · delivery line · price on entry) as POINTERS to `AGENT_GUIDE.md`, not copies.

## Steps

- [ ] 1. **Extract candidates:** walk `GOAL.md` (+ `MASTER_PLAN.md` mode table, `STATUS.md`
      facts 15–39 where they define, not measure) and list every current-force definition with its
      source anchor and date; superseded formulations are NOT candidates.

      **🟡 НАЧАТО 2026-08-29 00:2x (сессия 60): карта якорей снята МЕХАНИЧЕСКИ** (grep по
      заголовкам, номера строк проверены командой; GOAL.md = 1639 строк):

      | секция ЗАКАЗа (AC2) | якорь в GOAL.md | строка |
      |---|---|---|
      | (1) четыре режима | «## Четыре режима» · таблица режимов · «⭐ ЧТО ТАКОЕ ТЮНИНГ VF-КРИВОЙ» (старший канон) | :325 · :475 · :718 |
      | (2) приёмка проекта | «🏁 КРИТЕРИЙ ПРИЁМКИ ТЮНИНГА» · «КОНЕЦ ТЮНИНГА» · «ПОЧЕМУ ВЫВОД НЕОБХОДИМ» | :139 · :163 · :188 |
      | (3) пять барьеров | «🏗 ЗДАНИЕ ВАЖНЕЕ ЛЕСОВ» · «Чего метод НЕ отменяет» (:322 рядом) | :86 · :322 |
      | (4) правило запаса | «🔴 ПЕРЕАНКЕРОВКА ЗАПАСА» (и подтверждение :754) | :399 · :754 |
      | (5) пороги шума | «Критерий шума» · «Поправка к Silent Cold» | :435 · :511 |
      | (6) гибкий тюнинг | «🌊 ГИБКИЙ ТЮНИНГ» · «🧾 КАЖДЫЙ ПРОЖИГ — УЛИКА» · «УПРАВЛЯЕМАЯ ВЕЛИЧИНА» | :216 · :271 · :1109 |
      | (7) язык частот | «🔤 ТОЧЕК С НОМЕРАМИ НЕ СУЩЕСТВУЕТ» (регистр — НЕ в GOAL: `AGENT_GUIDE.md` → «THE REGISTER», указателем) | :799 |
      | (8) автономия живых прогонов | + «🛑 ЛАГ ТЕЛЕМЕТРИИ — ОТКАЗ» · «🚑 СПАСЕНИЕ ВМЕСТО КОНСТАТАЦИИ» · «⚡ ПРЕДОХРАНИТЕЛИ» · «🖥 ЦИФРОВОЙ ДВОЙНИК» | :1363 · :1434 · :1470 · :1505/:1606 |
      | (9) метод-правила 017 | указателями на `AGENT_GUIDE.md` → «The critical path rule» | — |
      | (вне девяти, кандидат владельцу) | «🏷 БРЕНД-ИМЯ — привилегия владельца» | :57 |

      **Даты слова владельца, снятые ЧТЕНИЕМ (2026-08-29 00:2x):** язык частот :799 —
      2026-08-15 17:3x · «ЗАВИС — осознанный риск» :852 — 2026-08-15 16:2x · управляемая
      величина = напряжение :1109 — 2026-08-22 21:5x (⚠️ раздел ЗАПИСАН АГЕНТОМ по прямому
      распоряжению владельца — авторство решения его, формулировка техническая) · лаг = отказ
      :1363 — 2026-08-26 20:5x · спасение вместо констатации :1434 — 2026-08-28 · предохранители
      :1470 — 2026-08-28 вечер · барьеры :86 — 2026-08-24 · приёмка/край/конец тюнинга :139 —
      2026-08-24 ночь · гибкий тюнинг :216 — 2026-08-24 ночь · улика :271 — 2026-08-25 вечер ·
      переанкеровка запаса :399 — 2026-08-17 00:2x · тюнинг VF :718 — 2026-08-15 10:19 ·
      бренд-имя :57 — 2026-08-22 19:5x.

      **✅ GOAL.md ПРОЙДЕН ЦЕЛИКОМ (сессия 60, 00:2x–00:3x), добраны якоря с датами:**
      лестница шагов 25/10/5 :880 — 15.08 16:3x (механизм ЗАПУСКА: работает один раз на первой
      частоте; от соседки — минимальным шагом, уточнение :1038 — 17.08) · человек за машиной
      :922 — 15.08 16:3x · длинный прожиг = 1 мин :947 — 15.08 16:4x · затравка от соседки
      :970 — 15.08 16:4x (+ :1018 — 17.08 00:0x) · тюним ВЫДАННОЕ :1058 — 16.08 · то же правило
      на оси напряжения («ближайшее верхнее с сетки») :1516 — 16.08 13:4x · что такое прожиг
      :1193 — 16.08 15:5x + мера = МОЩНОСТЬ у предела :1230 — 16.08 23:0x · ЗАЧЕМ прожиг (все
      блоки · ватты · 10 с · предсказание края; тип нагрузки — свобода агента; «SDC
      несостоятелен») :1284 — 26.08 10:2x · визуализатор живёт всегда :1559 — 22.08 15:1x ·
      аварийный стоп = две перезагрузки подряд на одной ступени :871 · двойник: равноправный
      стенд :1505 + мат-модель/мокап-инструменты/в бою настоящие :1606 — 28.08 поздний вечер.
      Найденные ОТМЕНЁННЫЕ слои (в ЗАКАЗ не идут): «запас = отказ + 10 мВ» :394→:399 ·
      «до 900 мВ быстрыми» :901 (отменено лестницей глубин) · «3 минуты прожига» :947 ·
      «строгий проход сверху вниз» :216 · «SDC как ведущий критерий» :1319 (сверка остаётся —
      она бесплатна, :1334).

      **Осталось в шаге 1:** таблица режимов `MASTER_PLAN.md` (читана этой сессией — сверить
      при сборке черновика) · факты STATUS 15–39 — отобрать ОПРЕДЕЛЯЮЩИЕ (15 форма профиля ·
      29 линейка шума · 32 запас · 34+36 Silent Cold · 38 пол потолка) от измерительных.
      Дальше — шаг 2: сборка черновика `ЗАКАЗ.md` по этой карте.
- [x] 2. **Draft `ЗАКАЗ.md`** ✅ 2026-08-29 00:3x (сессия 60) — 115 строк, баннер черновика,
      девять секций AC2, каждая дефиниция с якорем и датой слова владельца.
- [x] 3. **Self-check** ✅ — механический link-check: 34 якоря `GOAL.md:N`, все 34 попали в
      заголовки/цитаты своих разделов (прогон в сессии 60); вопросов черновик не задаёт —
      только утверждает; стоп-слова живут внутри цитат владельца.
- [ ] 4. **Raise through the review contour** (`npm run ask ЗАКАЗ.md` — the show contour opens any
      markdown, I16); the owner reads, comments, approves. A comment without approval =
      rejected-with-direction = rework, not force.
- [ ] 5. **On approval:** remove the draft banner (the approval record is the force), edit the
      `AGENT_GUIDE.md` context-router row (definitions → «ЗАКАЗ»), append the pointer line to the
      STATUS relay. NO other canon edits; no new guards (the moratorium holds — this plan adds
      ZERO machinery).
- [ ] 6. **DONE-tag this plan** with the approval date and the recorded decision path.

## Verification by observation

| claim | observation |
|---|---|
| every definition has a source | a link-check pass over the draft (grep `GOAL.md#`/dates), count = definitions count |
| the owner approved | the decision file exists with `by`/`at`; quoted in this plan's DONE section |
| the archive untouched | `git diff` of the delivery commit shows GOAL.md unchanged |
| sessions actually read less | the router row; the next session's /resume names «ЗАКАЗ» in its pass |

## Risks, tiered

- **(a) Highest — distillation drops a nuance the owner meant.** Mitigation: links-not-paraphrase
  as the default form; the owner's contour read IS the gate; anything he flags returns to GOAL
  verbatim quoting.
- **(b) Plausible — «ЗАКАЗ» starts drifting from GOAL as new owner words arrive.** Mitigation
  WITHOUT new machinery (moratorium): the fix-vision ritual gains one line in its checklist — a
  new owner word that changes a definition updates «ЗАКАЗ» + appends to GOAL in the same commit;
  named here, wired during step 5 as a one-line edit to the `/fix-vision` skill text.
- **(c) Small — the draft exceeds 200 lines.** Mitigation: pointers instead of copies for
  anything already canonical elsewhere (AC2 §9 pattern).

## Price (интервью 017, Q5 discipline)

~1 offline session for steps 1–3, one owner contour read for step 4, minutes for step 5.
Displaces nothing: it is itself the audit queue's item.
