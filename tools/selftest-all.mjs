#!/usr/bin/env node
// tools/selftest-all.mjs — ВСЯ ОФЛАЙН-БАТАРЕЯ САМОПРОВЕРОК ОДНОЙ КОМАНДОЙ.
//
// WHY IT EXISTS, and the receipt is five days long. The `curveCapMhz` migration (commit `2d7d266`,
// 2026-08-16 22:13) left three suites red — `descend` 7 blocks, `profile` 1, `vgpu` 1 — and STATUS
// carried all three as green until the 2026-08-21 audit re-ran the battery by hand
// (`reports/KAIF_AUDIT/2026-08-21_audit_01_tech.md` §3, `bugs/24`). Nobody lied: sessions 31-32
// re-ran the suites of the modules they touched, which is the correct habit, and the table of
// numbers in STATUS was updated from memory, which is the defect. **«Перемерено» has to be a
// command, not a memory** — that is the whole of this tool's job.
//
// THE RULE THAT COMES WITH IT: the block counts in `STATUS.md` are updated ONLY from this command's
// output. A number typed from recollection is a false `[TESTED]` at the level of the summary table
// (`TESTING_FRAMEWORK.md` → the trust contract).
//
// ─── WHAT IT RUNS, AND WHAT IT REFUSES TO RUN ────────────────────────────────────────────────────
//
// Only suites that touch NO card: seventeen of them, exactly the battery the audit re-ran. Anything
// that writes to the GPU stays out by construction — `nvml --verify-decode` writes and is therefore
// absent, and so is every command whose job is a measurement rather than a check. A gate the owner
// cannot run while his card is busy is a gate nobody runs.
//
// Deliberately NOT here, and each for a stated reason rather than by oversight:
//   `nvml --verify-decode`  — it WRITES to the card (STATUS names it so).
//   `stress --verify-baseline`, `gpu:info`, `mon`, `measure`  — they READ the live card; a battery
//                             that needs the card present is a battery that is skipped.
//   `dashboard` — JOINED 2026-08-22 by this very rule; the proof of inertness is written next to its
//                             entry in the list below (`bugs/27`).
//   `shortcuts`, `fanladder`, `thermal`, `tidy`, `bench` — their selftests were never
//                             part of the audited battery, and each touches something outside the
//                             process (the owner's desktop, a port, the fan controller, files it
//                             tidies). They join the day someone proves the run is inert, one at a
//                             time, with the proof written next to the entry.
//
// ─── HOW A SUITE IS JUDGED: TWO INDEPENDENT READINGS, AND A DISAGREEMENT IS ITSELF RED ───────────
//
// 1. THE EXIT CODE — the declared contract, and the only reading that cannot be reworded.
// 2. THE SUITE'S OWN LINES — its red lines counted, and its COMPLETION LINE demanded present.
//
// Neither alone is enough, and this project has paid for both halves. Parsing prose for failures
// reports on the suite's vocabulary rather than on the code (EXP-0060), and the three suites here
// spell failure three different ways — `ПЛОХО`, `ПРОВАЛ`, `FAIL` — so a single grep would have been
// blind to two thirds of the battery. Trusting the exit code alone is the other half: a suite whose
// summary says «провалов 3» while it exits 0 is a suite whose exit code lies, and that is a finding,
// not a green. Demanding the completion line is the third guard: a suite that crashes, hangs or dies
// on an import prints no failures either, and «no failures» must never read as «all passed»
// (EXP-0016, EXP-0029, EXP-0060 — one family, paid for four times).
//
// So: green ⟺ exit code 0 AND zero red lines AND the completion line present. Everything else is red
// and says which of the three failed.
//
// Usage:
//   npm run selftest:all              the whole battery, then a paste-ready line of numbers
//   npm run selftest:all -- --only engine,vgpu     a subset, by id, for a module you just touched
//   npm run selftest:all -- --selftest             this tool's OWN guard, four fixtures, no suites
// Exit: 0 = every suite green · 1 = at least one red (or an unknown id was asked for)
//
// [TESTED: 2026-08-21 00:4x · `--selftest` → 5 blocks, 0 failed: five fixture children driven through
//  the same `runSuite()` the battery uses — honest red (exit 1), LYING exit code (red lines, exit 0),
//  a suite that died before its completion line, a green one as the negative control, and one mixing
//  all three vocabularies at once (2 green / 3 red / 1 waiting). The battery itself: 17 suites, 848
//  green blocks, 0 red, 10.9 s. RED-PROVED END TO END against the real defect it was built for:
//  deleting `curveCapMhz` from `candidateProfile` again (the `bugs/24` mutation) turned the battery
//  red on exactly `descend` (7) and `profile` (1), named both, quoted their summary lines and exited 1.]

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// =================================================================================================
// The battery
// =================================================================================================
//
// `npm` is what the human types and what the report prints; the run itself spawns `node` directly.
// Seventeen `npm run` launches cost more wall clock on Windows than the suites themselves, and a
// gate that is slow is a gate that gets skipped.
//
// `done` is each suite's COMPLETION LINE, written out per suite rather than guessed by a shared
// pattern. That makes it a contract: a suite that renames its summary line reddens here loudly
// instead of being read as «nothing failed», which is the direction of failure this tool exists for.

const SUITES = [
  // `countsBlocks: false` — this one has no per-block lines at all: it reports two totals (files
  // parsed, texts scanned) and nothing else. Printing «блоков 0» for it would put a zero in the
  // STATUS line that reads like «nothing was checked», so its own summary is quoted instead.
  { id: 'check', npm: 'npm run check', argv: ['tools/check.mjs'], countsBlocks: false,
    what: 'парсинг всех .mjs + порча кодировки', done: /^checked \d+ \.mjs file/mu },
  { id: 'engine', npm: 'npm run engine -- --selftest', argv: ['automation-engine/engine.mjs', '--selftest'],
    what: 'движок: лестница, затравка, ступень, петля развёртки', done: /^САМОПРОВЕРКА:/mu },
  { id: 'journal', npm: 'npm run journal -- --selftest', argv: ['automation-engine/lib/sweep-journal.mjs', '--selftest'],
    what: 'журнал упреждающей записи', done: /^САМОПРОВЕРКА:/mu },
  { id: 'curve', npm: 'npm run curve -- --selftest', argv: ['automation-engine/lib/curve-store.mjs', '--selftest'],
    what: 'документ тюнинг-кривой', done: /^ИТОГ: /mu },
  { id: 'contract', npm: 'npm run contract', argv: ['automation-engine/lib/seam-contract.mjs'],
    what: 'контрактный набор над тремя швами', done: /^КОНТРАКТНЫЙ НАБОР:/mu },
  { id: 'traps', npm: 'npm run traps', argv: ['automation-engine/lib/trap-suite.mjs'],
    what: 'пять карт-ловушек против настоящего движка', done: /^НАБОР ЛОВУШЕК:/mu },
  { id: 'stress', npm: 'npm run stress -- --selftest', argv: ['automation-engine/lib/stress-tester.mjs', '--selftest'],
    what: 'оракул: вердикты PASS/SDC/CRASH', done: /^САМОПРОВЕРКА:/mu },
  { id: 'vfstep', npm: 'npm run vfstep -- --selftest', argv: ['automation-engine/lib/vf-step.mjs', '--selftest'],
    what: 'атом записи: форма профиля и её сторожа', done: /^САМОПРОВЕРКА:/mu },
  { id: 'watchdog', npm: 'npm run watchdog -- --selftest', argv: ['automation-engine/lib/watchdog.mjs', '--selftest'],
    what: 'сторож записей и подбор забытой аренды', done: /^САМОПРОВЕРКА СТОРОЖА:/mu },
  { id: 'profiles', npm: 'npm run profiles -- --selftest', argv: ['automation-engine/lib/profile-store.mjs', '--selftest'],
    what: 'ФОРМАТ профиля и его отказы', done: /^САМОПРОВЕРКА ФОРМАТА:/mu },
  { id: 'profile', npm: 'npm run profile -- --selftest', argv: ['automation-engine/lib/profile-manager.mjs', '--selftest'],
    what: 'ПРИМЕНИТЕЛЬ профиля, единственный писатель', done: /^САМОПРОВЕРКА ПРИМЕНЕНИЯ:/mu },
  { id: 'safemode', npm: 'npm run safe-mode -- --selftest', argv: ['tools/safe-mode.mjs', '--selftest'],
    what: 'безопасный режим дисков: взведён / снят / ВЗВЕДЁН НАПОЛОВИНУ', done: /^САМОПРОВЕРКА safe-mode:/mu },
  { id: 'power', npm: 'npm run power -- --selftest', argv: ['automation-engine/lib/power-baseline.mjs', '--selftest'],
    what: 'эталон мощности и пол прибора', done: /^САМОПРОВЕРКА:/mu },
  { id: 'descend', npm: 'npm run descend -- --selftest', argv: ['automation-engine/lib/ladder-descent.mjs', '--selftest'],
    what: 'спуск по лестнице частот, кандидат и откат', done: /^САМОПРОВЕРКА:/mu },
  { id: 'vgpu', npm: 'npm run vgpu -- --selftest', argv: ['automation-engine/lib/virtual-gpu.mjs', '--selftest'],
    what: 'виртуальная видеокарта: край, шум, три исхода', done: /^САМОПРОВЕРКА ВИРТУАЛЬНОЙ КАРТЫ:/mu },
  { id: 'burn', npm: 'node automation-engine/lib/burn-model.mjs --selftest', argv: ['automation-engine/lib/burn-model.mjs', '--selftest'],
    what: 'модель нагрузки: ватты по форме, каденция, штамп суммы (plans/68)', done: /^ИТОГ:/mu },
  { id: 'cardgen', npm: 'node automation-engine/lib/card-generator.mjs --selftest', argv: ['automation-engine/lib/card-generator.mjs', '--selftest'],
    what: 'генератор карт: детерминизм, валидность, границы осей (plans/70)', done: /^ИТОГ:/mu },
  { id: 'gfx', npm: 'npm run gfx -- --selftest', argv: ['automation-engine/lib/graphics-load.mjs', '--selftest'],
    what: 'игровой стенд и разбор кадров', done: /^САМОПРОВЕРКА:/mu },
  { id: 'nvapi', npm: 'npm run nvapi -- --selftest-shape', argv: ['automation-engine/lib/nvapi.mjs', '--selftest-shape'],
    what: 'форма профиля на мосту NVAPI', done: /^ФОРМА ПРОФИЛЯ:/mu },
  { id: 'vmin', npm: 'npm run vmin -- --selftest', argv: ['automation-engine/lib/vmin-store.mjs', '--selftest'],
    what: 'храповик фазы 5', done: /^САМОПРОВЕРКА:/mu },
  // ВОШЁЛ 2026-08-22 ПО ПРАВИЛУ ВЫШЕ — «по одному, с доказательством инертности рядом с записью».
  // Он был исключён как «трогающий порт», и это было верно. Инертность ДОКАЗАНА, а не заявлена:
  //   · порт — все серверы набора поднимаются на `port: 0` (эфемерный, назначает ОС); боевой 7311
  //     не занимается ни разу, так что открытое окно наблюдения набору не мешает и он ему;
  //   · окно — `raiseDashboard` испытывается через подставные швы (`openWindowFn`/`closeWindowFn`),
  //     ни один настоящий браузер не поднимается;
  //   · файлы — всё в `runs/dashboard-selftest*`; последний боевой адрес (`TELEMETRY_PATH`) убран
  //     швом `telemetryPath` в тот же день. Проверено наблюдением: mtime боевого файла телеметрии
  //     до и после прогона набора совпадает.
  // ЗАЧЕМ ВООБЩЕ: `bugs/27` пять дней жил в наборе, которого батарея не звала. Ровно находка №2
  // аудита, только этажом ниже — набор, который никто не гоняет, зелен ровно до первого взгляда.
  { id: 'dashboard', npm: 'npm run dashboard -- --selftest', argv: ['automation-engine/lib/run-dashboard.mjs', '--selftest'],
    what: 'окно наблюдения: пульс, лента, обрыв связи', done: /^САМОПРОВЕРКА ДАШБОРДА:/mu },
  // ВОШЁЛ 2026-08-23 ВМЕСТЕ С САМИМ КОДОМ, а не «потом»: правило этого списка оплачено `bugs/27`,
  // который пять дней жил в наборе, которого батарея не звала. Инертность здесь тривиальна —
  // набор читает две ЗАФИКСИРОВАННЫЕ фикстуры и подставные `fs`, не трогая ни карту, ни `runs/`.
  { id: 'pulse', npm: 'npm run pulse -- --selftest', argv: ['tools/pulse-report.mjs', '--selftest'],
    what: 'пульс сэмплера: интервалы, архив, раскладка по ступеням', done: /^САМОПРОВЕРКА ПУЛЬСА:/mu },
  // ВОШЁЛ 2026-08-24 ВМЕСТЕ С САМИМ ИНСТРУМЕНТОМ — набор, который никто не гоняет, зелен до первого
  // взгляда (`bugs/27`), и заводить его вне батареи значило бы повторить тот класс осознанно.
  // Логика на ПОДСТАВНОМ чтении: ни один файл проекта набор не открывает и не пишет.
  { id: 'prayer', npm: 'npm run prayer -- --selftest', argv: ['tools/prayer.mjs', '--selftest'],
    what: 'молитва вверху канона: раскладка из одного источника и сторож расхождения', done: /^САМОПРОВЕРКА:/mu },
  // ВОШЁЛ 2026-08-23 — И ЭТО НАБОР, КОТОРЫЙ СУЩЕСТВОВАЛ С ФАЗЫ 1 И КОТОРОГО БАТАРЕЯ НЕ ЗВАЛА.
  // Он жил только внутри `npm run phase1:accept`, то есть команды, которую рутинно не гоняет никто.
  // Ровно класс `bugs/27`, названный в комментарии к `dashboard` этажом выше: набор, который никто
  // не гоняет, зелен до первого взгляда. Найден при работе над `plans/29`, когда в него понадобилось
  // добавить сторожа — и выяснилось, что сторож попал бы в непрогоняемый набор.
  // ИНЕРТНОСТЬ ЗДЕСЬ ТРИВИАЛЬНА И ЭТО ПРОВЕРЯЕТСЯ ЧТЕНИЕМ КОДА, а не обещанием: `--fixtures` читает
  // фиксированные `.xml` из `__fixtures__/` и гоняет `runClassInvariants` на построенных объектах.
  // Ни PowerShell, ни журнала Windows, ни карты, ни `runs/`, ни порта — путь `queryFaults` в этом
  // режиме не вызывается вовсе.
  { id: 'events', npm: 'npm run events -- --fixtures', argv: ['automation-engine/lib/event-logger.mjs', '--fixtures'],
    what: 'разбор событий журнала Windows и инварианты класса СИГНАЛ', done: /^ФИКСТУРЫ: /mu },
  // ЧЕТЫРЕ НАБОРА, ВОШЕДШИЕ 2026-08-23 ОДНОЙ ИНВЕНТАРИЗАЦИЕЙ — и это ЗАКРЫТИЕ КЛАССА, а не добавка.
  // `events` нашёлся случайно, при попытке положить в него сторожа. После этого была снята полная
  // опись: все модули с режимом `--selftest` против списка ниже. Расхождение оказалось не в один
  // набор, а в ПЯТЬ — то есть батарея не звала четверть собственных наборов проекта, и 56 зелёных
  // блоков не считал никто. `BUG_FIXING_FRAMEWORK.md`: «закрывать КЛАСС, а не экземпляр» — починка
  // начинается с описи всех вхождений и судится по ней.
  //
  // ИНЕРТНОСТЬ КАЖДОГО ДОКАЗАНА ДВАЖДЫ, и ни разу обещанием:
  //   · чтением — ни один из четырёх не импортирует пишущий модуль вовсе (`nvapi`,
  //     `profile-manager`, `watchdog`, `nvml`), так что тронуть карту им нечем;
  //   · их собственным выводом — каждый ПЕЧАТАЕТ свою границу: `desktop-shortcuts` заканчивает
  //     «Песочница удалена, Desktop не тронут», `bench-run` — «документ владельца и ПРОДАКШЕН-журнал
  //     не тронуты (сверка до/после)».
  //
  // ЭТИ ЧЕТЫРЕ БЫЛИ НАЗВАНЫ В STATUS КАК ИСКЛЮЧЁННЫЕ НАМЕРЕННО, И ЭТА ЗАПИСЬ НЕ ПЕРЕЕЗЖАЕТСЯ МОЛЧА.
  // Причина там стояла одна на всех: «их прогон трогает что-то вне процесса». Она разбирается на две
  // половины, и выживает только одна:
  //   · для `tidy` и `fanladder` она просто НЕВЕРНА — их `--selftest` чистый, на подставных функциях
  //     и разборе строк; за пределы процесса не выходит ничего;
  //   · для `bench` и `shortcuts` она ВЕРНА по букве — они пишут файлы. Но пишут в СВОЮ песочницу и
  //     сами доказывают её границу выводом, а по этой же мерке в батарее давно стоят `curve`,
  //     `journal`, `vgpu` и `dashboard`. Мерка «пишет ли файлы вообще» отсеивает половину батареи;
  //     работающая мерка — «трогает ли ЧУЖОЕ», и на неё оба отвечают своей последней строкой.
  // То есть исключение было написано до того, как правило «по одному, с доказательством инертности
  // рядом с записью» созрело, и сегодня доказательство снято. `events` в том списке не было вовсе —
  // его просто забыли.
  //
  // ПЯТЫЙ, `thermal`, БЫЛ ТРУДНЫМ СЛУЧАЕМ И ЕГО ДОКАЗАТЕЛЬСТВО СНЯТО ТУТ ЖЕ — оно записано здесь
  // целиком, потому что это единственный набор батареи, у которого писатели вообще в области
  // видимости, и следующая сессия обязана видеть, чем закрыт этот вопрос, а не верить строке.
  // ИМПОРТ НЕ РАВЕН ВЫЗОВУ, и разница показана адресами:
  //   · `selfTest()` (`thermal-ladder.mjs:571`) — синхронная ЧИСТАЯ функция над разобранными
  //     строками замера; ни одного импортированного модуля не трогает;
  //   · единственные места, где живут `nvidiaSmiBackend`/`readState`, — внутри `stableState()`
  //     (:825), и её ЕДИНСТВЕННЫЙ вызывающий — :949;
  //   · `wd.readArmed()` (:907) и `wd.arm()` (:915) — там же, ниже;
  //   · ветка `--selftest` в `main` ВОЗВРАЩАЕТ на :878, то есть выше всех троих.
  // Дотянуться до писателя этот путь не может по строению файла, а не по намерению автора.
  { id: 'tidy', npm: 'npm run tidy -- --selftest', argv: ['tools/tidy.mjs', '--selftest'],
    what: 'уборка после прогона: кого можно убивать, кого нельзя', done: /^САМОПРОВЕРКА УБОРКИ:/mu },
  { id: 'fanladder', npm: 'npm run fanladder -- --selftest', argv: ['tools/fan-ladder.mjs', '--selftest'],
    what: 'акустическая лестница: план уровней и разбор замера', done: /^САМОПРОВЕРКА:/mu },
  { id: 'bench', npm: 'npm run bench -- --selftest', argv: ['automation-engine/lib/bench-run.mjs', '--selftest'],
    what: 'репетиция развёртки на стенде, в песочнице', done: /^САМОПРОВЕРКА РЕПЕТИЦИИ:/mu },
  { id: 'shortcuts', npm: 'npm run shortcuts -- --selftest', argv: ['automation-engine/lib/desktop-shortcuts.mjs', '--selftest'],
    what: 'ярлыки: эмодзи и кириллица туда-обратно, Desktop только читается', done: /^САМОПРОВЕРКА ЯРЛЫКОВ:/mu },
  { id: 'thermal', npm: 'npm run thermal -- --selftest', argv: ['automation-engine/lib/thermal-ladder.mjs', '--selftest'],
    what: 'тепловая лестница: разбор плато и штампов сэмплера', done: /^САМОПРОВЕРКА:/mu },
  // ВОШЁЛ 2026-08-23 18:1x ВМЕСТЕ СО СВОИМ КОДОМ, а не «потом» — правило этого списка, оплаченное
  // `bugs/27` и описью сессии 43. ДОКАЗАТЕЛЬСТВО ИНЕРТНОСТИ, рядом с записью: планировщик задач в
  // наборе не участвует вовсе — каждая функция берёт исполнитель (`run`) швом, и суите передаётся
  // подставной, который только ЗАПИСЫВАЕТ вызовы и отвечает заготовленным. Единственное, что
  // касается диска, — метка подавления, и она создаётся в `mkdtempSync`-песочнице, снимаемой в
  // `finally`. Ни GPU, ни `runs/`, ни задач планировщика.
  { id: 'trayautostart', npm: 'node automation-engine/lib/tray-autostart.mjs --selftest', argv: ['automation-engine/lib/tray-autostart.mjs', '--selftest'],
    what: 'автозагрузка трея: возврат в неё применением режима, отказы названы вслух', done: /^САМОПРОВЕРКА АВТОЗАГРУЗКИ ТРЕЯ:/mu },
  // ВОШЁЛ 2026-08-28 ВМЕСТЕ СО СВОИМ КОДОМ (plans/52 шаг 2). ДОКАЗАТЕЛЬСТВО ИНЕРТНОСТИ, рядом с
  // записью: ветка `--selftest` зовёт ТОЛЬКО чистые функции (`promisedTick` · `classifyTick` ·
  // `summarize` · `formatMiss`) — ни worker_threads, ни NVML, ни winmm, ни файлов: потоки и карта
  // живут в `runWatcher`/`cmdFloor`, куда из самопроверки нет ни одного вызова. Заголовок набора
  // сам говорит: «ни потоков, ни карты, ни часов».
  { id: 'deathwatch', npm: 'npm run deathwatch -- --selftest', argv: ['automation-engine/lib/death-watch.mjs', '--selftest'],
    what: 'сторож смерти: логика тактов, порога записи и сводки (эпик 51 фаза 1)', done: /^САМОПРОВЕРКА death-watch/mu },
  // Inertness proof for the battery rule above: the fuse selftest binds ONLY port 0 (OS-assigned
  // ephemeral, loopback) — no fixed port to collide with; artefacts go to os.tmpdir(), never to
  // runs/death-watch/ (EXP-0025); the card is never opened — hands are injected fakes.
  { id: 'fuse', npm: 'npm run fuse -- --selftest', argv: ['automation-engine/lib/fuse.mjs', '--selftest'],
    what: 'предохранитель: deadman-судья, руки спасения, кольцо чёрного ящика (эпик 51 фаза 2)', done: /^САМОПРОВЕРКА fuse/mu },
  // ВОШЛИ 2026-08-28 ВМЕСТЕ СО СВОИМ КОДОМ (развёртывание команды, plans/54). ДОКАЗАТЕЛЬСТВО
  // ИНЕРТНОСТИ, рядом с записью: доска гоняет ЧИСТЫЕ функции переписывания строк плюс замок-файл
  // в `mkdtempSync`-песочнице, снимаемой в `finally` — настоящий TEAM_STATUS.md не открывается
  // вовсе; места гоняют placeOf/create/reset/remove через ПОДСТАВНОЙ git (шов `run`), настоящий
  // git не зовётся, диск не трогается. Ни GPU, ни runs/, ни worktree.
  { id: 'teamboard', npm: 'npm run team -- --selftest', argv: ['tools/team-board.mjs', '--selftest'],
    what: 'доска команды: своя строка, чужой отказ, замки и брошенный замок', done: /^САМОПРОВЕРКА ДОСКИ КОМАНДЫ:/mu },
  { id: 'teamplace', npm: 'npm run workplace -- --selftest', argv: ['tools/team-workplace.mjs', '--selftest'],
    what: 'рабочие места команды: инвариант имён, грязный отказ, ветка остаётся', done: /^САМОПРОВЕРКА РАБОЧИХ МЕСТ:/mu },
  // ВОШЁЛ 2026-08-28 ВМЕСТЕ СО СВОИМ КОДОМ (эпик 59 фаза 3, plans/62). ДОКАЗАТЕЛЬСТВО ИНЕРТНОСТИ,
  // рядом с записью: набор гоняет НАСТОЯЩИЙ runStep через устройство ДВОЙНИКА — карта не
  // открывается вовсе (nvapi берётся только за чистые функции: pollUntilApplied,
  // classifyWriteFailure, buildRaiseAndCapVector); документ и журнал двойника — benches/runs;
  // последний блок сверяет отпечаток живых артефактов (curves/measured.json · runs/sweep ·
  // runs/death-watch) до и после — I1 эпика судится командой, а не обещанием.
  { id: 'twin', npm: 'npm run twin -- --selftest', argv: ['automation-engine/lib/twin-assembly.mjs', '--selftest'],
    what: 'сборка --card virtual: живой путь на цифровом двойнике, край меняет вердикт, песочница I1 (эпик 59 фаза 3)', done: /^САМОПРОВЕРКА twin/mu },
  // ВОШЁЛ 2026-08-29 ВМЕСТЕ СО СВОИМ КОДОМ (сторож защищённого цикла, слой 2 скилла /guarded-loop).
  // ДОКАЗАТЕЛЬСТВО ИНЕРТНОСТИ, рядом с записью: ветка `--selftest` возвращает из `selftest()` до
  // единой строки рабочего кода — она зовёт ТОЛЬКО две чистые функции (`pulseAgeMinutes` над
  // текстом-аргументом и `decide` над числами). Ни `.kaif/heartbeat.log`, ни файл-замок, ни
  // `spawnSync` с уведомлением не достижимы: `if (has('--selftest')) selftest()` стоит ВЫШЕ разбора
  // `--until`, а `selftest` выходит через `process.exit`. Часы тоже не берутся — «сейчас» в наборе
  // подставлено константой, поэтому набор не может позеленеть от того, который час.
  { id: 'loopguard', npm: 'node tools/loop-guard.mjs --selftest', argv: ['tools/loop-guard.mjs', '--selftest'],
    what: 'сторож цикла: возраст пульса, дребезг тревоги, пустой журнал не тревога', done: /^ИТОГ:/mu },
  // ВОШЁЛ 2026-08-29 ВМЕСТЕ СО СВОИМ КОДОМ (эпик 67 фаза 4, plans/71 шаги 1-3). ДОКАЗАТЕЛЬСТВО
  // ИНЕРТНОСТИ, рядом с записью: модуль состоит ИЗ ЧИСТЫХ ФУНКЦИЙ над объектами-уликами — ни
  // одного импорта кроме отсутствующих (файл не импортирует ничего вообще), ни карты, ни диска,
  // ни часов. Улики в наборе — литералы, а не прогон; «сейчас» не берётся нигде.
  { id: 'polyguard', npm: 'node automation-engine/lib/polygon-guards.mjs --selftest',
    argv: ['automation-engine/lib/polygon-guards.mjs', '--selftest'],
    what: 'сторожа честности полигона: пятеро, каждый доказан красным (эпик 67 фаза 4)', done: /^ИТОГ:/mu },
  // ВОШЁЛ 2026-08-29 ВМЕСТЕ СО СВОИМ КОДОМ (эпик 67 фаза 4, plans/71 шаг 4). ДОКАЗАТЕЛЬСТВО
  // ИНЕРТНОСТИ, рядом с записью: ветка `--selftest` возвращает из `cmdSelftest()` ДО разбора
  // остальных флагов и зовёт ТОЛЬКО чистые функции (`twinArtefactPaths` над подставным корнем
  // «/b», `parseJournal` над строкой, `coverageOf` и `reportLines` над литералами). Ни `spawnSync`,
  // ни `rmSync`, ни `liveFingerprint` из неё недостижимы: они живут в `runOneCard`/`runBatch`,
  // куда из набора нет ни одного вызова. Сам пакетный прогон в батарею НЕ входит и не должен —
  // он занимает минуты и запускается отдельной командой `npm run polygon`.
  // ВОШЁЛ 2026-08-29 ВМЕСТЕ СО СВОИМ КОДОМ (эпик 67 фаза 4, plans/71 шаг 5). ДОКАЗАТЕЛЬСТВО
  // ИНЕРТНОСТИ: модуль — чистая логика над ВНЕДРЯЕМЫМ оракулом; в наборе оракул подставной
  // (функция от объекта), поэтому ни прогонов, ни карт, ни диска.
  { id: 'shrink', npm: 'node automation-engine/lib/polygon-shrink.mjs --selftest',
    argv: ['automation-engine/lib/polygon-shrink.mjs', '--selftest'],
    what: 'сжатие ломающей карты: бисекция, зануление осей, отказ при смене класса', done: /^ИТОГ:/mu },
  { id: 'polygon', npm: 'node automation-engine/lib/polygon.mjs --selftest',
    argv: ['automation-engine/lib/polygon.mjs', '--selftest'],
    what: 'полигон: пути артефактов, разбор журнала, карта покрытия, отчёт (эпик 67 фаза 4)', done: /^ИТОГ:/mu },
];

// =================================================================================================
// Reading a suite's own lines
// =================================================================================================
//
// The vocabularies are MEASURED, not assumed: every suite in the battery was run and its result
// lines counted before this parser was written (EXP-0060 — read a real failure first, then write the
// parser against what you saw). Greens: `OK` everywhere except the curve document, which prints `✅`.
// Reds: `ПЛОХО` (engine, descend, stress, …), `ПРОВАЛ` (the applier), `FAIL` (the virtual card, the
// seam contract, and `check` on a file that will not parse), `❌` (the curve document). `ЖДЁТ` is the
// trap suite's THIRD state — waiting, and it is never mixed into either of the other two.
//
// `\b` is deliberately absent: it is defined over ASCII word characters, so it never matches after a
// Cyrillic letter and would silently drop every Russian token here.
const GREEN_LINE = /^[ \t]*(?:OK|✅)(?:[ \t]|$)/u;
const RED_LINE = /^[ \t]*(?:ПЛОХО|ПРОВАЛ|FAIL|❌)(?:[ \t]|$)/u;
const PENDING_LINE = /^[ \t]*ЖДЁТ(?:[ \t]|$)/u;

/** Local time with its offset, never UTC — a machine receipt in this project carries the owner's
 *  clock (`AGENT_GUIDE.md`), and this line is meant to be pasted into STATUS beside the numbers. */
function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    + ` ${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

/**
 * Run ONE suite and judge it by all three readings. Exported shape is deliberate: this tool's own
 * `--selftest` drives its fixtures through THIS function, so the thing proved is the thing used.
 *
 * @param {{id:string, argv:string[], done:RegExp}} suite
 * @returns {{id:string, ok:boolean, why:string, code:number, ms:number,
 *            green:number, red:number, pending:number, summary:string|null}}
 */
export function runSuite(suite, { cwd = ROOT } = {}) {
  const started = Date.now();
  // `stdout` and `stderr` are read as ONE stream: a suite that prints its failures to stderr (which
  // `check` does) would otherwise be counted as having none.
  const r = spawnSync(process.execPath, suite.argv, { cwd, encoding: 'buffer', windowsHide: true });
  const ms = Date.now() - started;
  const text = Buffer.concat([r.stdout ?? Buffer.alloc(0), r.stderr ?? Buffer.alloc(0)]).toString('utf8');
  const lines = text.split(/\r?\n/u);

  let green = 0; let red = 0; let pending = 0;
  for (const line of lines) {
    if (GREEN_LINE.test(line)) green++;
    else if (RED_LINE.test(line)) red++;
    else if (PENDING_LINE.test(line)) pending++;
  }

  // The completion line, and it is looked for in the OUTPUT rather than inferred from the exit code:
  // a suite killed mid-run exits non-zero AND prints no summary, and the two facts are reported
  // separately because they fail for different reasons.
  const summaryLine = lines.find((l) => suite.done.test(l)) ?? null;
  const code = r.status === null ? -1 : r.status;

  const reasons = [];
  if (r.error) reasons.push(`набор не запустился: ${r.error.message}`);
  if (code !== 0) reasons.push(code === -1 ? `набор убит сигналом ${r.signal}` : `код выхода ${code}`);
  if (red > 0) reasons.push(`красных строк ${red}`);
  if (summaryLine === null) reasons.push('СВОДНОЙ СТРОКИ НЕТ — набор не дошёл до конца, и «нет провалов» тут ничего не значит');
  // The disagreement is its own finding and is named as one: a suite that reports failures and still
  // exits 0 has a broken exit code, and a battery that quietly took the greener of the two readings
  // would be hiding exactly the class it was built to catch.
  if (code === 0 && red > 0) reasons.push('РАСХОЖДЕНИЕ ДВУХ ЧТЕНИЙ: код выхода 0, а набор печатает провалы — врёт код выхода');
  if (code !== 0 && red === 0 && summaryLine !== null) reasons.push('РАСХОЖДЕНИЕ ДВУХ ЧТЕНИЙ: код выхода не ноль, а красных строк нет');

  return {
    id: suite.id, ok: reasons.length === 0, why: reasons.join(' · '),
    code, ms, green, red, pending, summary: summaryLine,
  };
}

// =================================================================================================
// The battery, and the report the numbers in STATUS are copied from
// =================================================================================================

function runBattery(only) {
  const chosen = only ? SUITES.filter((s) => only.has(s.id)) : SUITES;
  if (only) {
    const unknown = [...only].filter((id) => !SUITES.some((s) => s.id === id));
    if (unknown.length) {
      console.error(`ОШИБКА: неизвестный набор — ${unknown.join(', ')}. Известны: ${SUITES.map((s) => s.id).join(', ')}`);
      return 1;
    }
  }

  console.log('БАТАРЕЯ САМОПРОВЕРОК — всё офлайн, ни одной записи в видеокарту');
  console.log(`  наборов: ${chosen.length}${only ? ` из ${SUITES.length} (по запросу --only)` : ''}`);
  console.log('');

  /** What this suite counts, in its own units — blocks for sixteen of them, its summary line for the
   *  one that has no blocks. Never invented: a suite that counted nothing says so. */
  const counted = (suite, r) => (suite.countsBlocks === false
    ? (r.summary ? r.summary.trim() : 'сводки нет')
    : `блоков ${r.green}${r.pending ? ` · ждут ${r.pending}` : ''}`);

  const results = [];
  for (const suite of chosen) {
    process.stdout.write(`  ${suite.id.padEnd(9)} ${suite.what} … `);
    const r = runSuite(suite);
    r.counted = counted(suite, r);
    r.countsBlocks = suite.countsBlocks !== false;
    results.push(r);
    console.log(r.ok
      ? `ЗЕЛЁНЫЙ · ${r.counted} · ${(r.ms / 1000).toFixed(1)} с`
      : `КРАСНЫЙ · ${r.why}`);
  }

  const redOnes = results.filter((x) => !x.ok);
  console.log('');
  for (const r of redOnes) {
    console.log(`КРАСНЫЙ ${r.id}: ${r.why}`);
    console.log(`        повторить одной командой: ${SUITES.find((s) => s.id === r.id).npm}`);
    if (r.summary) console.log(`        сводная строка набора: ${r.summary.trim()}`);
  }
  if (redOnes.length) console.log('');

  // THE PASTE-READY LINE. It exists so that the numbers in STATUS have exactly one origin, and the
  // stamp travels with them: a count without the moment it was measured is the same claim STATUS
  // carried for five days.
  const totalMs = results.reduce((a, x) => a + x.ms, 0);
  const blocks = results.reduce((a, x) => a + (x.countsBlocks ? x.green : 0), 0);
  console.log(`ИТОГ: наборов ${results.length}, красных ${redOnes.length}, зелёных блоков ${blocks}, `
    + `${(totalMs / 1000).toFixed(1)} с`);
  console.log(`ЧИСЛА ДЛЯ STATUS (перемерено ${stampNow()}): `
    + results.map((r) => {
      if (!r.ok) return `${r.id} КРАСНЫЙ(${r.red})`;
      return r.countsBlocks ? `${r.id} ${r.green}` : `${r.id} ✓`;
    }).join(' · '));
  if (redOnes.length === 0) {
    console.log('Все наборы сошлись по ТРЁМ чтениям сразу: код выхода, красные строки, сводная строка на месте.');
  }
  return redOnes.length === 0 ? 0 : 1;
}

// =================================================================================================
// This tool's OWN guard — because a detector nobody showed a failure to is not a detector
// =================================================================================================
//
// MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016). Each fixture is a whole child process driven
// through the same `runSuite()` the battery uses, so what is proved here is what runs there:
//
//   A. honest red      — prints `ПЛОХО`, exits 1        → red, and the code is named
//   B. LYING exit code — prints `ПЛОХО`, exits 0        → red, and the disagreement is named
//   C. died early      — prints `OK`, no summary, exit 0 → red, and the missing summary is named
//   D. honest green    — prints `OK` and its summary     → GREEN, the negative control without which
//                                                          a detector that reddens everything passes
//
// D is not ceremony: three fixtures reddening proves the alarm rings, and nothing else. It is the
// fourth that proves it is an alarm rather than a bell stuck on.
function toolSelftest() {
  const fixture = (id, body, done) => ({
    id, npm: `(фикстура ${id})`, what: `фикстура ${id}`, done,
    argv: ['-e', body],
  });
  const DONE = /^ФИКСТУРА:/mu;
  const cases = [
    { name: 'A. честный красный: печатает ПЛОХО и выходит с кодом 1 -> КРАСНЫЙ',
      suite: fixture('A', 'console.log("OK   раз");console.log("ПЛОХО два");console.log("ФИКСТУРА: есть расхождения.");process.exit(1)', DONE),
      wantOk: false, wantIn: 'код выхода 1' },
    { name: 'B. ВРЁТ КОД ВЫХОДА: печатает ПЛОХО и выходит с нулём -> КРАСНЫЙ, расхождение названо',
      suite: fixture('B', 'console.log("ПЛОХО два");console.log("ФИКСТУРА: есть расхождения.");process.exit(0)', DONE),
      wantOk: false, wantIn: 'РАСХОЖДЕНИЕ ДВУХ ЧТЕНИЙ' },
    { name: 'C. набор УМЕР до сводной строки: одни OK, кода ноль -> КРАСНЫЙ, отсутствие сводки названо',
      suite: fixture('C', 'console.log("OK   раз");process.exit(0)', DONE),
      wantOk: false, wantIn: 'СВОДНОЙ СТРОКИ НЕТ' },
    { name: 'D. честный зелёный -> ЗЕЛЁНЫЙ (контроль: сторож не красит всё подряд)',
      suite: fixture('D', 'console.log("OK   раз");console.log("OK   два");console.log("ФИКСТУРА: все сходятся.");process.exit(0)', DONE),
      wantOk: true, wantIn: '' },
  ];

  let failed = 0;
  for (const c of cases) {
    const r = runSuite(c.suite);
    const okMatches = r.ok === c.wantOk;
    const whyMatches = c.wantIn === '' ? r.why === '' : r.why.includes(c.wantIn);
    if (okMatches && whyMatches) console.log(`OK   ${c.name}`);
    else {
      failed++;
      console.log(`ПЛОХО ${c.name}`);
      console.log(`      получено ok=${r.ok} why=«${r.why}» green=${r.green} red=${r.red} summary=${JSON.stringify(r.summary)}`);
    }
  }

  // The counting itself, on output that mixes all three vocabularies at once — one suite never does
  // that, so no suite in the battery could have proved it.
  const mixed = runSuite(fixture('E',
    'console.log("OK   один");console.log("✅ два");console.log("ПРОВАЛ три");console.log("FAIL четыре");'
    + 'console.log("❌ пять");console.log("ЖДЁТ шесть");console.log("ФИКСТУРА: смесь.");process.exit(1)', DONE));
  const counted = [mixed.green, mixed.red, mixed.pending];
  if (JSON.stringify(counted) === JSON.stringify([2, 3, 1])) {
    console.log('OK   E. три словаря разом: 2 зелёных, 3 красных (ПРОВАЛ/FAIL/❌), 1 ждёт — и они не смешались');
  } else {
    failed++;
    console.log(`ПЛОХО E. три словаря разом -> получено ${JSON.stringify(counted)}, ждали [2,3,1]`);
  }

  console.log('');
  console.log(`САМОПРОВЕРКА БАТАРЕИ: 5 блоков, провалов ${failed}.`);
  return failed === 0 ? 0 : 1;
}

// =================================================================================================

function main(argv) {
  if (argv.includes('--selftest')) return toolSelftest();
  const i = argv.indexOf('--only');
  const only = i >= 0 && argv[i + 1] ? new Set(argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean)) : null;
  return runBattery(only);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
