# Bug 71 — variants written as a TABLE parse to zero options, the owner gets a text box instead of buttons, and no guard reddens

**Status:** 🔧 **ВСЕ ЧЕТЫРЕ ПУНКТА ПЛАНА ИСПОЛНЕНЫ 2026-08-30 17:4x (сессия 68) — сторож (ось G12,
обе ветки) И отказ ПОДЪЁМА. ЖИВОГО ПОДТВЕРЖДЕНИЯ ЖДЁТ:** проверкой станет первый же вечерний
подъём страницы при владельце — он же и есть тот путь, ради которого шаг 3 откладывали. Разборы —
два раздела в конце документа. Найден 2026-08-30 11:2x while rebuilding `interviews/018`
after the owner refused to answer it. **Reproduced by the contour's own parser on the shipped
document.**
**Version/build:** `main` @ `666e17c` · **When/context:** session 66; the owner had been shown
interview 018 at 11:09 and answered at 11:12 with a complaint about the QUESTION, which is how the
second defect surfaced

## Symptom

`interviews/018` carried four variants — A (recommended), B, C, D — laid out as a markdown table,
one row per variant, in the shape this project has used before. The contour raised the page and the
owner saw **no choice controls at all**, only a free-text field. His decision came back:

```json
"answers": { "Q1": { "choice": null, "text": "Не понимаю вопрос и физику процесса. …" } }
```

Asked of the contour's OWN parser on the shipped file:

```
вопросов  : 1
вариантов : 0 []
```

Four variants in the document, zero variants on the page.

## Root cause

`review-core.RE_OPTION_START` is `/^\s*[-*]?\s*\*\*\s*([A-Za-zА-Яа-я])(?!\p{L})/u` — a variant is
recognised only when the LINE BEGINS with an optional list bullet and then `**A`. A table row begins
with `|`, so `| **A** **(Рекомендовано)** | … |` never matches. The parser is behaving exactly as
written; nothing is broken in it.

**The defect is that the failure is SILENT.** A question with zero options is a legitimate shape —
it is how a free-text question is written — so the page renders one with no complaint, and the
document looks fine to every reader who does not run the parser.

## Why the existing guard cannot see it — and this is the interesting half

`questions-guard` axis **G11** exists for precisely this family: it cross-checks
`q.options.length` against `q.optionCandidateLines`, the independent count of lines that LOOK like
an option start. On this document both are **0**, they agree, and G11 is honestly green:

```
[G11] сверка числа вариантов — новых: 0 · в долге: 0
СВЕРКА ВАРИАНТОВ (G11): проверено вопросов 38 — расхождений новых 0.
```

G11 answers *«did some option lines fail to parse?»*. It cannot answer *«were the options written
as option lines at all?»* — the case where the variants exist in the document but in a shape the
parser was never pointed at. **A guard that compares two counts is blind when both are zero for the
same reason**, which is the same shape as EXP-0176 (a fixture where the broken and the correct code
agree) one level up: here the two SIDES agree, so there is nothing to disagree about.

## Repro (deterministic, offline, no card)

1. Take any interview whose variants are table rows (`git show 666e17c:interviews/interview_018_what_feeds_the_upward_ratchet.md`).
2. Run the contour's parser over it and print `questions[0].options.length`.
3. Observe `0`, and observe `npm run questions` reporting no G11 discrepancy.

## Fix plan

1. **A new guard axis: a question with ZERO parsed options whose body contains variant-shaped
   evidence.** The evidence is mechanical and does not need cleverness: a table row, or any line,
   whose first cell is `**A**`/`**B**`/`**А**`/`**Б**` — i.e. the same letters the option regex
   looks for, found anywhere the regex does NOT look. Two or more such letters in one question
   body and zero parsed options is the finding. One letter alone is not: `**A**` can legitimately
   appear in prose referring to an earlier answer.
2. **Prove it red on the pre-fix document** (`git show 666e17c:…` as the fixture, committed under
   `interviews/__fixtures__/` or read from git in the block) — a guard that has never gone red
   proves nothing, and this one has a perfect historical fixture available for free.
3. **Say it on the PAGE too, not only in the guard.** The raise already refuses a document the
   owner cannot answer (`bugs/41` — no answer slot). «Variants exist but none were parsed» belongs
   in the same refusal: the owner's time is the thing being protected, and the guard runs only when
   somebody runs it, while the raise runs every time.
4. **Do NOT make the parser accept tables.** That is the tempting fix and it is the wrong one:
   it would add a second legal shape for the same concept, i.e. a truth↔mirror pair inside the
   document format, and the page's one-click contract (a recorded `choice`) has no sensible meaning
   for an arbitrary table. One shape, enforced, beats two shapes, tolerated.

## 🆕 ВТОРОЙ СВИДЕТЕЛЬ, 2026-08-30 14:1x — И ОН ОТКРЫВАЕТ ВТОРУЮ ОСЬ, КОТОРОЙ В ПЛАНЕ НЕТ

Сессия 67 написала `interviews/020` и, помня этот тикет, проверила форму ПАРСЕРОМ, а не глазом.
Результат первой редакции:

```
вопросов : 0
```

**Ноль ВОПРОСОВ, а не ноль вариантов.** Причина другая: заголовок был написан как
`## Вопрос Q1 — считать ли плато промахом?`, а `parseInterview` узнаёт вопрос по заголовку,
НАЧИНАЮЩЕМУСЯ с `Q<N>.`. Варианты при этом стояли строками верхнего уровня (`**A** — …`) вместо
списочных (`- **A. …**`), то есть промахнулись обе формы сразу.

**Почему это ХУЖЕ исходного дефекта, а не его повторение.** При нуле вариантов владелец видит
вопрос и поле для текста — плохо, но он хотя бы знает, что его о чём-то спрашивают. При нуле
вопросов страница не показывает ВООБЩЕ НИЧЕГО из документа: контур честно докладывает «без ответа 0»
и считает документ не ждущим владельца. Вопрос исчезает молча и навсегда — ровно тот класс, который
`questions-guard` заводился ловить («в поле такой сторож вскрыл два вопроса, висевших 5 и 13 дней»).

**Ось 1 плана этого не поймает по построению:** она ищет «вариантоподобные улики В ТЕЛЕ ВОПРОСА», а
тела вопроса не существует, когда вопроса не разобрали.

### Дополнение к плану починки

1a. **Вторая ось: документ в `interviews/` со слотом ответа, но с НУЛЁМ разобранных вопросов.**
   Улика механическая и дешёвая: файл содержит строку `**Ответ:**` (или маркер
   `owner-review:answer`), а `parseInterview` вернул `questions.length === 0`. Слот ответа ставят
   только там, где спрашивают, — значит вопрос задуман, а разбор его не увидел.
2a. **Фикстура для неё тоже бесплатна и историческая:** первая редакция `interviews/020` живёт в
   истории правки этого дня; минимальная синтетическая фикстура (заголовок `## Вопрос Q1 — …` плюс
   `**Ответ:**`) короче и стабильнее, и её лучше положить рядом с фикстурой оси 1.
3a. **Отказ подъёма (шаг 3 плана) обязан покрывать ОБА случая одним предложением:** «в документе
   есть слот ответа, но контур не нашёл ни одного вопроса/варианта — владельцу нечего нажать».

> ⚠️ **И честная оговорка о цене этого свидетеля.** Он получен не наблюдением за чужим кодом, а
> тем, что агент сам написал документ в неправильной форме, зная о тикете. Это довод не «сторож
> полезен», а «сторож НЕОБХОДИМ»: правило формы, известное и записанное, было нарушено тем же днём
> тем, кто его записал. Прозой эта форма не удерживается.

## What this bug does NOT claim

That the owner's answer was CAUSED by the missing buttons. His words name the question's substance —
physics, a drawing, a graph — and that defect is real and separate (EXP-0192). This one compounded
it: he was handed prose he could not use AND no way to click even if he could.

## Decisions made without the owner

- **Filed rather than fixed on the spot.** Tonight is a live-card evening; the fixes that protect
  the evening (`bugs/45`, the twin rehearsal) come first. This defect bites the NEXT interview, not
  the run.
- **The rebuilt `interviews/018` was written with option LINES**, i.e. worked around rather than
  waiting for this fix — the fork blocks the harvest of tonight's run.

## Links

`interviews/018` (the document, before and after) · `interviews/decisions/interview_018_*.decision.json`
(`choice: null` — the receipt) · `tools/lib/review-core.mjs` → `RE_OPTION_START`, `parseQuestionBlock`
· `tools/questions-guard.mjs` → G11 · `bugs/41` (the raise refuses what the owner cannot answer) ·
`bugs/01` (the contour's adversarial findings) · EXP-0192 (the question's own defect) · EXP-0176
(a check blind because both sides agree)

---

## ✅ ОСЬ G12 ПОСТАВЛЕНА И ДОКАЗАНА КРАСНЫМ — 2026-08-30 16:0x (сессия 67)

**Что сделано.** Новая ось сторожа вопросов — `questions-guard.checkUnreachableChoices`, имя в
отчёте «владельцу нечего нажать». Две ветки, ровно по двум свидетелям этого дня:

| ветка | что ловит | свидетель |
|---|---|---|
| **G12a** | вопрос есть, разобранных вариантов ноль, а в теле ≥ 2 ячейки таблицы вида `\| **A**` | `interviews/018`, четыре варианта таблицей |
| **G12b** | слот ответа есть, а разобранных вопросов НОЛЬ | `interviews/020`, заголовок «## Вопрос Q1 — …» |

**Две границы, чтобы сторож не кричал впустую (G9).** Нужны ДВЕ РАЗНЫЕ буквы — одиночное `**A**`
законно живёт в прозе, ссылающейся на прежний ответ. И нужен слот ответа — документ без вопросов и
без слота это заметка, а не сломанный вопрос.

### 🔴 ОБЛАСТЬ ОСИ СУЖЕНА ПЕРВЫМ ЖЕ ПРОГОНОМ, И ЭТО НЕ ПОСЛАБЛЕНИЕ

Первый прогон дал **23 находки в 19 документах**, и все они НАСТОЯЩИЕ: старые интервью (011 · 012 ·
013 · 014 · 016 …) действительно свёрстаны таблицами, и владелец действительно отвечал на них
ТЕКСТОМ — кнопок ему не показывали. Но **все они закрыты**, а закрытый оригинал не переписывают
(`AGENT_GUIDE.md`). Находка, по которой никто не вправе действовать, — ложная тревога по построению,
и это первый принцип этого сторожа.

Поэтому ось судит **только документы, ещё ждущие владельца** (`statusIsWaiting`). Это тот же приём,
что `EXCLUDED_FILES` для хроники: ОБЛАСТЬ, а не список подавления — поддерживать нечего, а новый
сломанный вопрос загорится сам. После сужения: проверено документов 1, находок 0, долг сторожа не
вырос.

### Доказательства

| что | результат |
|---|---|
| блоки | `verify:contour` 24 → **28**, 0 красных: G12a · G12b · G12c (одна буква в прозе не поднимает) · G12d (закрытое интервью не трогается) |
| механизм фикстуры G12b | блок СНАЧАЛА проверяет, что разбор действительно не видит заголовка, иначе зеленел бы по чужой причине (EXP-0016) |
| мутации | **GA** → ровно G12a · **GB** → ровно G12b · **GC** → ровно G12c · **GD** → ровно G12d · целый код — **0 красных** |
| батарея | **41 набор / 1689 зелёных / 0 красных**, 32,4 с |

Мутанты гонялись копией ОБОИХ файлов (сторож + набор, с подменой импорта у копии), из корня
репозитория; оригиналы не тронуты ни разу ([[EXP-0193]]).

## 🟡 Что осталось открытым — и почему именно это

**Шаг 3 плана — отказ ПОДЪЁМА.** Сторож ловит дефект, когда его кто-то запускает; подъём контура
происходит каждый раз. Место для этого готово (`bugs/41` уже отказывается поднимать документ без
слота ответа), и одно предложение покрыло бы обе ветки: «в документе есть слот ответа, но контур не
нашёл ни одного вопроса или варианта — владельцу нечего нажать».

**Не сделано намеренно.** Это правка `review.mjs` — пути, которым владелец сегодня вечером поднимает
страницу при живом прогоне. Менять его за несколько часов до использования значит ставить свою
аккуратность против его вечера, а выигрыш — поймать дефект, который сторож уже ловит. Следующая
офлайн-сессия сделает это первой строкой.

## Решения, принятые без владельца

- **Ось сужена до ждущих документов, а 23 исторические находки НЕ заморожены в долг.** Долг — это
  список, который надо поддерживать; область — свойство, которое поддерживать не надо. Проект уже
  выбрал этот приём для хроники, и здесь он верен по той же причине.
- **Парсер таблицам НЕ научен** (шаг 4 плана): вторая законная форма одного понятия — пара
  «истина ↔ зеркало» внутри формата документа.
- **Старые интервью не переписаны** под новую форму: они закрыты, а оригинал не правят.

---

## ✅ ШАГ 3 ЗАКРЫТ — ОТКАЗ ПОДЪЁМА, 2026-08-30 17:4x (сессия 68)

**Первая находка захода — половина работы уже стояла, и это выяснил замер, а не чтение плана.**
Пункт 3a требовал покрыть отказом ОБА случая. Ветку «ноль ВОПРОСОВ» ворота `bugs/41` несут с
23 августа: документ без разобранных вопросов не поднимается вовсе. Проверено прогоном, а не
доверием к шапке:

```
=== 020, первая редакция (ноль вопросов) ===
вопросов  : 0
ОТКАЗОВ ПОДЪЁМА: 1
   - ни одного распознанного вопроса
```

Значит настоящей дырой была ровно одна ветка — G12a. **Воспроизведена на историческом документе:**

```
=== interviews/018 @ 666e17c, ДО правки ===
вопросов  : 1
  Q1: вариантов 0 · строк-кандидатов 0 · слот ответа есть
ОТКАЗОВ ПОДЪЁМА: 0        ← страница поднялась бы. Так владелец её и увидел.
```

По всем прежним меркам документ отвечаем: вопрос разобран, слот на месте, заглушки нет. Ворота
молчали честно — и в этом был дефект.

### Что сделано

| # | Правка | Зачем именно так |
|---|---|---|
| 1 | `review-core.unreachableVariantLetters(q)` — экспортированная улика: РАЗНЫЕ буквы вариантов, найденные в ячейках таблицы тела вопроса | улику потребляют ДВОЕ (ось G12a и ворота), а две копии одного распознавания разошлись бы молча и ровно в нужный день |
| 2 | `RE_OPTION_IN_CELL` переехал из `questions-guard` в ядро, рядом с `RE_OPTION_START`, которое он зеркалит | один факт живёт в одном месте |
| 3 | Третий отказ в `answerabilityRefusals`: вариантов 0 + ≥ 2 разных буквы в теле → подъём отказывает, называя буквы и починку | сторож судит, когда его запускают; подъём происходит КАЖДЫЙ раз |
| 4 | Шапка отказа: «нечем ответить **или нечего нажать** (bugs/41 · bugs/71)» | пункт 3a требовал одного предложения на оба случая |

Ветка «ноль вопросов» в новый код НЕ продублирована намеренно — её несёт первый отказ той же
функции. Дублировать её значило бы завести вторую причину для одного и того же красного.

### Доказательства

| что | результат |
|---|---|
| воспроизведение | `interviews/018` @ `666e17c` → **0 отказов** до правки, **1 отказ** после, с буквами `A, B, C, D` |
| блоки | `verify:contour` **28 → 30**: **G12e** (подъём отказывает) · **G12f** (одна буква в прозе подъём не ломает) |
| механизм фикстуры | G12e СНАЧАЛА проверяет, что разбор не видит вариантов И что слот ответа на месте — иначе блок зеленел бы по старой причине (EXP-0016) |
| мутации | **MA** (улика не собирается) → G12a **И** G12e · **MB** (порог ворот 3 буквы) → ровно G12e · **MC** (порог 1 буква) → ровно G12f · целый код — 0 красных |
| контроль | ждущие документы проекта поднимаются по-прежнему: ждут владельца 1 · отказано 0 |
| батарея | **41 набор / 1689 зелёных / 0 красных**, 33,6 с · `npm run check` зелёный |

**MA — главная из трёх.** Сломанная общая улика покрасила и сторож, и ворота: значит вынос в одну
функцию несущий, а не косметика. Не будь его, каждая сторона считала бы буквы сама, обе согласились
бы на сломанном распознавании и обе остались бы зелёными — [[EXP-0193]] дословно.

Мутанты гонялись копией ВСЕГО дерева `tools/` из корня репозитория; НЕМУТИРОВАННАЯ копия сперва
прогнана оттуда же и дала зелёное — это отделяет дефект от артефакта запуска ([[EXP-0193]]).
Оригиналы не тронуты ни разу.

### Чего ещё нет

**Живого подтверждения при владельце.** Отказ доказан на фикстурах и на историческом документе;
вечерний подъём страницы — первая настоящая проверка того, что путь цел. Ровно ради этого шаг 3 и
откладывали, и до его прохода тикет не DONE.

## Решения, принятые без владельца — шаг 3

- **Ветка «ноль вопросов» не продублирована** в новом коде: её уже несёт `bugs/41`. Выяснено
  замером до первой правки, а не принято на веру из плана.
- **Порог оставлен «≥ 2 РАЗНЫЕ буквы»** — тот же, что у оси G12a. Общая улика с двумя порогами
  была бы той же парой «истина ↔ зеркало», против которой написан пункт 4 плана.
- **`--force` не заведён.** Ворота `bugs/41` его не имеют по прямому решению, и третья форма
  отказа не повод открывать люк.
