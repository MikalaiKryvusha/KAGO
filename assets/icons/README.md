# assets/icons — иконки ярлыков и трея

**Набор выбран владельцем** (интервью 005 + homework 01, 2026-08-14): **Fluent Emoji 3D**
(Microsoft, лицензия MIT — файл `fluent-3d/LICENSE` рядом с иконками). Лицо «⏹ Stock Default» —
«counterclockwise arrows» (две стрелки, концепция «возврат», не «стоп») — вердикт владельца.

| Файл | Режим | Исходник (microsoft/fluentui-emoji, assets/…/3D) |
|---|---|---|
| `fluent-3d/max-performance.ico` | 🚀 Max Perfomance | `Rocket/3D/rocket_3d.png` |
| `fluent-3d/optimised.ico` | ⚖️ Optimised | `Balance scale/3D/balance_scale_3d.png` |
| `fluent-3d/silent-cold.ico` | ❄️ Silent Cold | `Snowflake/3D/snowflake_3d.png` |
| `fluent-3d/stock-default.ico` | ⏹ Stock Default | `Counterclockwise arrows button/3D/counterclockwise_arrows_button_3d.png` |

Каждый `.ico` несёт 6 кадров: 256 / 64 / 48 / 32 / 24 / 16 px.

**Перегенерация** (исходник → многоразмерный ico, ImageMagick):

```
magick <источник>.png -define icon:auto-resize=256,64,48,32,24,16 <имя>.ico
```

Потребители: `setup-desktop.mjs` (IconLocation четырёх ярлыков; отсутствие файла деградирует до
«без иконки») · `tray.ps1` (лицо ⏹; отсутствие файла — откат на рисованное лицо).
