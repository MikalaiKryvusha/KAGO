# Интервью 005 — красивые иконки для четырёх ярлыков: какой набор берём?

**Topic:** вы попросили предложить опенсорсные наборы иконок для ярлыков профилей на выбор — вот проверенные кандидаты с превью
**Status:** 🔴 ОТКРЫТО — ждёт вашего выбора
**Создано:** 2026-08-14 · **Родитель:** ваше слово в чате 2026-08-14 («нужно найти красивые иконки для ярлыгов профилей… предлагаем мне на выбор»)
**Куда уйдут ответы:** `assets/icons/` (четыре `.ico` 16–256 px) · `desktop-shortcuts.mjs` (IconLocation у ярлыков) · при желании — те же иконки в трей вместо моих цветных кружков

---

## Как проверялись кандидаты

Каждый набор проверен по живым источникам (не по памяти): лицензия — по файлу LICENSE в репозитории,
наличие всех четырёх понятий (ракета · весы · снежинка · стоп) — по API самих наборов, ссылки на
файлы — реально скачаны. Отпали: Heroicons (нет снежинки), Bootstrap (нет весов), Iconoir (нет весов
и стопа), Papirus (GPL + нет ракеты и весов), Tabler-filled (закрашены только 2 из 4).

**Главное наблюдение:** имена ярлыков уже несут эмодзи (🚀 ⚖️ ❄️ ⏹), поэтому ЦВЕТНЫЕ эмодзи-наборы
дают совпадение 1:1 с именем — а **Fluent Emoji это буквально стиль эмодзи самой Windows 11**
(Segoe UI Emoji), то есть иконка на столе будет родной системе.

## Вопрос 1. Какой набор?

| | вариант | лицензия | как выглядит | превью (кликните) |
|---|---|---|---|---|
| **A** | **Fluent Emoji 3D** (Microsoft) — объёмные, глянцевые, родной стиль Win11 | **MIT** — идеально для нашего MIT-репо, ноль оговорок | яркие 3D, PNG 256×256 готовые | [🚀](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Rocket/3D/rocket_3d.png) · [⚖️](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Balance%20scale/3D/balance_scale_3d.png) · [❄️](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Snowflake/3D/snowflake_3d.png) · [⏹](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Stop%20button/3D/stop_button_3d.png) |
| B | Fluent Emoji Color — та же семья, плоский вектор (чётче на мелких 16–32 px) | MIT | плоские цветные | [🚀](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Rocket/Color/rocket_color.svg) · [⚖️](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Balance%20scale/Color/balance_scale_color.svg) · [❄️](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Snowflake/Color/snowflake_color.svg) · [⏹](https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/Stop%20button/Color/stop_button_color.svg) |
| C | Twemoji (Twitter-стиль) — чистая плоская графика | CC-BY 4.0 — нужна строка благодарности в README | плоские, минималистичные | [🚀](https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/1f680.svg) · [⚖️](https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/2696.svg) · [❄️](https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/2744.svg) · [⏹](https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/svg/23f9.svg) |
| D | Noto Emoji (Google) — гугловский стиль | Apache-2.0 (арт) | плоские, тёплые | [🚀](https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/512/emoji_u1f680.png) · [⚖️](https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/512/emoji_u2696.png) · [❄️](https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/512/emoji_u2744.png) · [⏹](https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/512/emoji_u23f9.png) |
| E | Phosphor Fill / Material Design — одноцветные «инженерные» глифы, единый строгий стиль (подберу цвет каждому режиму + подложку) | MIT / Apache-2.0 | моноцвет, строго | [🚀](https://api.iconify.design/ph/rocket-launch-fill.svg?height=256) · [⚖️](https://api.iconify.design/ph/scales-fill.svg?height=256) · [❄️](https://api.iconify.design/ph/snowflake-fill.svg?height=256) · [⏹](https://api.iconify.design/ph/stop-fill.svg?height=256) |

**Моя рекомендация — A (Fluent Emoji 3D).** Три причины: это стиль эмодзи самой Windows 11, то есть
иконки будут выглядеть родными и совпадать 1:1 с эмодзи в именах ярлыков; лицензия MIT — как у
KAGO, ни одной оговорки; готовые PNG 256×256 → сборка `.ico` одной командой, без рисования.

## Вопрос 2. Куда применить выбранный набор?

- **A. (Рекомендовано)** Ярлыки + трей: четыре `.ico` на ярлыки, и те же иконки в трей вместо моих
  цветных кружков с буквами — один язык образов везде.
- **B.** Только четыре ярлыка на столе; трей оставить с кружками (кружки мельче и контрастнее в
  углу экрана).
- **C.** Пока только скачать в репозиторий (`assets/icons/`), применение обсудим отдельно.

---

*Технически дальше без вас: скачаю четыре файла выбранного набора, соберу многоразмерные `.ico`
(16/24/32/48/64/256), положу в `assets/icons/` с файлом лицензии набора, пропишу `IconLocation` в
ярлыки через `setup-desktop` (расписка и откат как обычно). Ни одна из опций не трогает карту.*
