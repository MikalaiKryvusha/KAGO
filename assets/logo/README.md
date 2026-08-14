# assets/logo — чип-логотип KAGO

**Выбор владельца** (2026-08-14, чат, дословно в `GOAL.md` → «Импрувменты оболочки»): вариант
C «Лёд и пламя» → *«строгий графитовый чип с льдом и пламенем»* → *«нужны иконки снежинки и
пламени как в емодзиках делают»*. Логотип проекта: витрина GitHub (README), папка KAGO на
рабочем столе, трей (по ответу на Q1 плана 10).

**Устройство:** композиция из двух слоёв —

- `chip-base.svg` — СВОЯ отрисовка: строгий графитовый чип с золотыми ножками (уникальная
  работа этого репозитория, MIT вместе с ним);
- `parts/snowflake_3d.png` + `parts/fire_3d.png` — ❄️ и 🔥 из **Fluent Emoji 3D** (Microsoft,
  MIT — `parts/LICENSE`; тот же набор, что иконки режимов в `assets/icons/fluent-3d/`).

**Правило качества, слово владельца:** *«ниже 128 не делаем»* — в `.ico` едут только кадры
**256 и 128**; малые размеры система масштабирует из высокого разрешения сама.

**Перегенерация** (ImageMagick; из корня `assets/logo/`):

```
magick chip-base.svg -resize 512x512 PNG32:base512.png
magick base512.png ( parts/snowflake_3d.png -resize 150x150 ) -geometry +97+181 -composite ( parts/fire_3d.png -resize 150x150 ) -geometry +265+181 -composite kago-logo.png
magick kago-logo.png -define icon:auto-resize=256,128 kago-folder.ico
```

(в PowerShell скобки берутся в кавычки: `'('` и `')'`; `base512.png` — промежуточный, в git не
едет). `candidates/` — четыре исходных варианта показа владельцу, история выбора.

Потребители: `setup-desktop.mjs` (иконка папки `Desktop\KAGO` через `desktop.ini`) · README
(шапка витрины) · трей — по плану 10.
