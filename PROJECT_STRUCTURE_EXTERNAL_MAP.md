# KAGO — external structure map

<!-- KAIF:PRAYER:BEGIN — ОДИН ИСТОЧНИК: PHILOSOPHY.md. Правится там, раскладывается `node tools/prayer.mjs --apply` -->
## 🙏 МОЛИТВА ПЕРЕД РАБОТОЙ

> **Слово владельца, 2026-08-24:** *«давай поднимем принципы из ФИЛОСОФИИ на уровень молитвы перед
> началом любой работы… с просьбой тебя молитву озвучить перед каждой работой»*.
>
> 🔴 **АГЕНТ, ПРОИЗНЕСИ ЕЁ В ЧАТЕ ПЕРЕД НАЧАЛОМ ЛЮБОЙ РАБОТЫ.** Целиком, дословно, своими словами
> не заменяя и пунктов не пропуская. Это не украшение: каждый пункт здесь оплачен провалом, и
> перечисление вслух — единственное, что переносит его из документа в решение, которое ты сейчас
> примешь. Разбор каждого принципа — `PHILOSOPHY.md`.

1. **ПРОСТОТА ВЫШЕ ВСЕГО.** Если долго — значит я усложнил, а не задача трудна. Застрял — заново
   понять задачу, а не громоздить.
2. **ОККАМ.** Не умножаю сущностей. Из двух решений беру то, где меньше движущихся частей.
3. **ПАРЕТО.** Ищу те 20 %, что дают 80 % пользы. «Сделано и работает» лучше «идеально и поздно».
4. **КОД ПРЕЖДЕ КОГНИЦИИ.** Что может сделать скрипт — делает скрипт. Модели остаётся суждение.
5. **НАБЛЮДЕНИЕ ВМЕСТО ДОГАДКИ.** Не помню — смотрю. Прогон, замер, источник вместо «должно работать».
6. **ТРИ ДВЕРИ.** Пробел закрываю источником или вопросом владельцу. Выдумать — запрещено.
7. **ЛОШАДИ, А НЕ ЗЕБРЫ.** Сперва проверяю самое простое и частое объяснение.
8. **МЁРФИ.** Называю риски вслух и раскладываю по ярусам. Названный риск наполовину управляем.
9. **ЛУЧШИЕ ПРАКТИКИ.** Почти всё решено до меня. Ищу проверенный путь, прежде чем изобретать.
10. **DRY.** Один факт живёт в одном месте. Пару лучше УБРАТЬ, чем за ней следить.
11. **УЧУСЬ ОДИН РАЗ.** Сверяюсь с опытом до работы, дописываю урок после. Дважды в один тупик не хожу.
12. **ЭЙЗЕНХАУЭР.** Важное и срочное — сейчас; важное и не срочное — в план; прочее — вниз.
13. **БРИТВА ХЭНЛОНА.** Не злой умысел, а недосмотр. Отлаживаю состояние мира, а не мотивы.
14. **КВАДРАТ ДЕКАРТА.** На трудной развилке отвечаю на четыре вопроса, а не на два.
15. **ВТОРОЙ ПОРЯДОК.** Думаю на три-пять ходов вперёд, а не о выигрыше прямо сейчас.
16. **КАРМА.** Оставляю репозиторий лучше, чем взял. Не срезаю углы за счёт владельца и следующей сессии.

> ⚖️ **И ОДНА ГРАНИЦА, ЧТОБЫ МОЛИТВА НЕ СТАЛА ОРУЖИЕМ ПРОТИВ ВЛАДЕЛЬЦА:** Оккам и Парето действуют
> ВНУТРИ машинерии. На том, что владелец видит и слышит, агент не экономит — там судит его глаз, а
> не мой счёт сущностей.
<!-- KAIF:PRAYER:END -->

> **What lives where, and what a stranger sees.** The outside view of the tree: directories, their
> purpose, and the artefacts KAGO produces. The *relations* between modules — who calls whom, what
> breaks what — live in `PROJECT_ARCHITECTURE_INTERNAL_MAP.md`.
>
> Living reference — never `DONE`-tagged. Updated: 2026-08-09.

---

## 1. Current state of the tree

KAGO is at the end of its **phase 0**: the framework is deployed, the research base is written, the
architecture is decided — and no orchestrator code exists yet. The tree below marks what is on disk
today (**·live·**) against what `MASTER_PLAN.md` will add (*planned*).

```
KAGO/
├── README.md                     ·live·  bilingual storefront (RU + EN)
├── LICENSE                       ·live·  MIT
├── GOAL.md                       ·live·  the owner's vision — the source of every constraint
├── MASTER_PLAN.md                ·live·  phases 0–6, decision log
├── RTX_5070Ti_..._Master_Plan.pdf ·live· the owner's original brief, committed verbatim
├── package.json                  ·live·  scripts: check · gpu:info · kaif:*
│
├── tools/                        ·live·  standalone operator utilities
│   ├── check.mjs                 ·live·  the build gate — parses every project .mjs
│   └── gpu-info.mjs              ·live·  read-only probe of the GPU's tunable envelope
│
├── automation-engine/            planned the orchestrator itself (layout fixed by the owner's PDF)
│   ├── config.mjs                planned every threshold, step size and guardband, named
│   ├── engine.mjs                planned the Vmin sweep loop
│   ├── setup-desktop.mjs         planned profiles → shortcuts → autostart → tray
│   └── lib/
│       ├── hardware-mon.mjs      planned telemetry — nvidia-smi ONLY (see below)
│       ├── toolchain.mjs         planned locates nvcc + the MSVC dev environment via vswhere
│       ├── profile-manager.mjs   planned APPLIES profiles — interface over swappable backends
│       ├── stress-tester.mjs     planned workload runner + golden-reference comparison
│       ├── event-logger.mjs      planned Windows Event Log watch (TDR / WHEA / BSOD)
│       └── desktop-shortcuts.mjs planned .lnk generation via WScript.Shell
│
├── workloads/                    planned KAGO's OWN loads — .cu sources, built on the machine
│   ├── sdc_fma.cu                planned fixed-loop arithmetic, output hashed — the SDC shape
│   └── branchy.cu                planned divergent control flow — the crash shape
│
├── profiles/                     planned measured profiles, bound to driver + VBIOS
├── logs/ · runs/                 planned telemetry and sweep artefacts — git-ignored
│
├── researches/                   ·live·  recon before code
│   ├── 01_gpu_control_paths.md   ·live·  can it be done without MSI Afterburner — and how
│   ├── 02_vmin_guardband_...md   ·live·  the per-point Vmin search and the safety margin
│   └── 03_headless_verificat....md ·live· what loads the card, what watches it, who says PASS
├── plans/                        ·live·  01_EPIC_kago_orchestrator · 02_epic01_phase1_...
├── interviews/                   ·live·  001_harness_boundaries — open, awaiting the owner
├── ideas/ · bugs/ · homeworks/ · reports/   ·live· KAIF working dirs
│
└── (KAIF canon: AGENT_GUIDE · PHILOSOPHY · STATUS · EXPERIENCE · the frameworks · .kaif/ · skills)
```

## 2. What KAGO produces

| Artefact | Where | Who reads it |
|---|---|---|
| Two desktop shortcuts — *Max Optimal*, *Silent Cold* | the owner's Desktop, as `.lnk` | the owner, by double-click |
| A tray icon showing the active profile | the notification area | the owner, at a glance |
| Measured profiles, stamped with driver and VBIOS | `profiles/` | `profile-manager.mjs` at boot and on switch |
| Sweep logs and telemetry | `logs/`, `runs/` — git-ignored | the agent, when a profile misbehaves |
| Golden references from the stock run | `runs/baseline/` | `stress-tester.mjs`, for every stability verdict |

## 3. Boundaries worth stating

- **`tools/` is not `automation-engine/`.** `tools/` holds things an operator runs by hand and that
  never touch GPU state. The engine is the thing that writes. Keeping the read-only utilities out of
  the engine is what makes them safe to run at any moment.
- **Nothing in the tree is portable to another machine.** Measured profiles encode one specific
  card's silicon; card-to-card Vmin differs by up to 70 mV (`researches/02`). The repository ships
  the *method*, never someone else's numbers.
- **The owner's private voice portrait is not here and must never arrive.** It lives in
  `d:\work\krinik_voice\`; `.gitignore` carries `AUTHOR_STYLOMETRY.md` so a stray copy cannot ship
  from this public repository.
