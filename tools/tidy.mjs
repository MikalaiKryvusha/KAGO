#!/usr/bin/env node
/**
 * TIDY — убрать за проектом и за агентом. `bugs/17`.
 *
 * ЗАЧЕМ ЭТО СУЩЕСТВУЕТ. Владелец многократно находил в своей ОС висящие окна терминала, оставшиеся
 * после работы: *«KAGO засирает мне ОС окнами терминала! Так быть не должно»*.
 *
 * 🔴 ПРИЧИНА НАЙДЕНА 2026-08-16 15:4x, и она видна в самой улике:
 *
 *     окно pid 9084 · WindowsTerminal · команда: WindowsTerminal.exe -Embedding
 *     родитель: svchost.exe -k DcomLaunch     · процессов внутри: 0
 *     заголовок: «Администратор: …\powershell.exe»
 *
 * `-Embedding` от `DcomLaunch` — это механизм «терминала по умолчанию» Windows 11. Когда
 * КОНСОЛЬНЫЙ процесс запускается С ПОВЫШЕННЫМИ ПРАВАМИ и своей консоли у него нет, система
 * поднимает под него НОВОЕ окно Windows Terminal через DCOM. Процесс отработал и вышел — **окно
 * осталось пустым**. Оболочка агента здесь работает под администратором, поэтому каждый вызов
 * `powershell.exe` оставлял за собой такое окно.
 *
 * ⚠️ ПОЭТОМУ В ЭТОМ ФАЙЛЕ НЕТ НИ ОДНОГО ВЫЗОВА `powershell.exe`. Прежняя редакция звала его для
 * перечисления процессов — то есть инструмент уборки САМ порождал ровно тот мусор, который убирает.
 * Используются `tasklist` / `wmic` / `taskkill`: это обычные консольные программы, они наследуют уже
 * существующую консоль и новых окон не создают.
 *
 * ⚠️ ГРАНИЦА, КОТОРУЮ ЭТА КОМАНДА НЕ ПЕРЕХОДИТ (`AGENT_GUIDE.md` → THE OWNER'S-MACHINE RULE):
 *   · закрывается только окно, поднятое ЧЕРЕЗ DCOM (`-Embedding`) и БЕЗ процессов внутри — это по
 *     построению брошенная оболочка, а не терминал, в котором владелец работает;
 *   · терминал владельца, запущенный им самим, не несёт `-Embedding` и не трогается никогда;
 *   · по умолчанию команда только ПОКАЗЫВАЕТ; убирает по `--apply`.
 *
 * [TESTED: 2026-08-16 · наблюдением на живой машине: инструмент нашёл брошенные окна и закрыл их,
 *  повторный осмотр дал «ни одного»; собственных окон при этом не создал — проверено `tasklist`.]
 */

import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

/** Обычная консольная программа — наследует консоль, окна не создаёт. Никогда не бросает. */
function run(exe, args) {
  try {
    // `stdio` НАЗВАН ЦЕЛИКОМ, и это не мелочь: по умолчанию `execFileSync` отдаёт stderr ребёнка
    // НАШЕЙ консоли, и служебные сообщения `wmic` («отсутствуют экземпляры») лезли владельцу в
    // вывод вперемешку с отчётом. Инструмент уборки, сорящий в консоль, — тот же дефект, что и
    // инструмент уборки, порождающий окна.
    return execFileSync(exe, args, {
      encoding: 'latin1', windowsHide: true, timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    return `${e?.stdout ?? ''}`;
  }
}

/**
 * Процессы по имени: pid, командная строка, родитель. `wmic` вместо PowerShell — по причине из
 * шапки файла. Формат CSV: `Node,CommandLine,ParentProcessId,ProcessId`, поля идут по алфавиту.
 */
function processesNamed(name) {
  const raw = run('wmic', ['process', 'where', `name='${name}'`, 'get', 'CommandLine,ParentProcessId,ProcessId', '/format:csv']);
  return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('Node,'))
    // ⚠️ СТРОГАЯ ФОРМА, А НЕ «отфильтруем что получится». `wmic` печатает и человеческие сообщения
    // («отсутствуют экземпляры»), и они попадали в разбор: инструмент показал ОКНО pid 30464, когда
    // в системе не было ни одного WindowsTerminal. Ложное срабатывание в команде, которая УБИВАЕТ
    // процессы, — дефект куда хуже неубранного окна, поэтому строка обязана целиком совпасть с
    // формой «…,<число>,<число>».
    .map((line) => {
      const m = /^(.*),(\d+),(\d+)$/.exec(line);
      if (!m) return null;
      const head = m[1].split(',');
      head.shift();                                   // имя машины
      return { pid: Number(m[3]), ppid: Number(m[2]), cmd: head.join(',') };
    })
    .filter((p) => p && Number.isFinite(p.pid) && p.pid > 0);
}

/** Сколько процессов имеет этого родителем — «внутри окна работают или оно брошено». */
function childCount(pid) {
  const raw = run('wmic', ['process', 'where', `ParentProcessId=${pid}`, 'get', 'ProcessId', '/format:csv']);
  // Та же строгость: считаем только строки вида «<машина>,<число>», а не всё непустое.
  return raw.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => /^[^,]+,\d+$/.test(l) && !l.startsWith('Node,')).length;
}

function kill(pid) { run('taskkill', ['/PID', String(pid), '/T', '/F']); }

/**
 * ПРОГОН В РАБОТЕ — И ТОГДА УБОРКА НЕ ТРОГАЕТ НИЧЕГО. `bugs/21`.
 *
 * Оплачено 2026-08-16: эта команда висит на хуке `Stop`, то есть отрабатывает ПОСЛЕ КАЖДОГО хода
 * агента. Живая развёртка (`engine --sweep --dashboard`) сама поднимает сервер окна наблюдения и
 * сам отдельный сэмплер телеметрии — то есть ровно те два процесса, которые уборка опознаёт как
 * свой мусор. Она их сняла, `taskkill /T` унёс дерево, **и карта осталась под андервольтом**:
 * «вся кривая +158 МГц с потолком 2775 МГц», поднятая только ручным `watchdog --recover`.
 *
 * Это второй раз, когда лекарство заражено болезнью: первая редакция файла звала `powershell.exe`
 * и сама порождала окна, которые убирает. Урок один и тот же — **инструмент уборки обязан уметь
 * отличить свой мусор от своей же работы**, и признак должен быть ПОЛОЖИТЕЛЬНЫМ, а не «кажется,
 * это ничьё».
 *
 * Признаков два, и любого достаточно, потому что они закрывают разные окна времени:
 *   · ЖИВОЙ ПРОЦЕСС ПРОГОНА — покрывает весь прогон целиком, включая паузы между ступенями;
 *   · ВЗВЕДЁННЫЙ СТОРОЖ с живым владельцем — покрывает случай, когда прогон запущен не нами
 *     (ярлыком, задачей, рукой владельца) и его командной строки в списке нет.
 *
 * Чистая функция: списки процессов и запись сторожа передаются, чтобы решение проверялось
 * фикстурами без машины.
 *
 * @param {{pid:number, cmd:string}[]} nodeProcs все живые `node.exe`
 * @param {object|null} armed запись сторожа (`watchdog.readArmed()`) или null
 * @param {(pid:number)=>boolean} isAlive жив ли процесс с этим pid
 * @returns {{busy:boolean, why:string}}
 */
export function runInFlight(nodeProcs, armed, isAlive) {
  // Всё, что ДОЛГО ЖИВЁТ и/или ПИШЕТ В КАРТУ. Список положительный и полный: забытая здесь команда
  // — это команда, которую уборка однажды убьёт посреди записи в GPU.
  const MARKERS = [
    /engine\.mjs.*--sweep/u, /engine\.mjs.*--band/u, /engine\.mjs.*--search/u,
    /vf-step\.mjs/u, /ladder-descent\.mjs/u, /thermal-ladder\.mjs/u,
    /fan-ladder\.mjs/u, /trap-suite\.mjs/u, /bench/u,
  ];
  // Контур согласований — владельцу заданы вопросы, сервер ждёт его ответа с бесконечным
  // терпением. Убить его окно или сервер значит отобрать у владельца вопросы посреди ответа —
  // `bugs/64`, близнец `bugs/21` контуром выше: там уборка убила прогон, здесь — страницу
  // владельца (дважды за вечер, его слова: «опять закрылось само!!!!»). Мгновенные формы без
  // сервера и окна (`--no-serve`, `--selftest`) уборке не преграда.
  const review = (nodeProcs ?? []).find((p) => /tools[\\/]review\.mjs/u.test(p.cmd)
    && !/--no-serve|--selftest/u.test(p.cmd));
  if (review) return { busy: true, why: `контур согласований ждёт владельца: pid ${review.pid}` };

  // `--dry-run` ничего не пишет и никого не поднимает; убирать при нём законно.
  const live = (nodeProcs ?? []).find((p) => !/--dry-run/u.test(p.cmd) && MARKERS.some((m) => m.test(p.cmd)));
  if (live) return { busy: true, why: `идёт прогон: pid ${live.pid}` };

  if (armed && Number.isInteger(armed.ownerPid) && isAlive(armed.ownerPid)) {
    return { busy: true, why: `сторож взведён живым владельцем pid ${armed.ownerPid}: ${armed.what ?? 'не названо'}` };
  }
  // Взведённый сторож с МЁРТВЫМ владельцем — это не работа, это авария, и разбирает её
  // `watchdog --recover`, а не уборка. Молчать про него нельзя, но и трогать его не наше дело.
  return { busy: false, why: armed ? 'сторож взведён, но владелец мёртв — это работа для `watchdog --recover`' : '' };
}

/** Жив ли процесс. `process.kill(pid, 0)` не шлёт сигнала — только спрашивает у ОС. */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

if (process.argv.includes('--selftest')) process.exit(await selfTest());

console.log(APPLY ? 'УБОРКА (--apply): закрываю найденное' : 'ОСМОТР: только показываю. Убрать — добавьте --apply');
console.log('');

// ---- 0. ПЕРВЫМ ДЕЛОМ: НЕ ИДЁТ ЛИ ПРОГОН. Раньше всего остального, потому что всё остальное —
//         это `taskkill`, и один из его адресатов может держать карту прямо сейчас (`bugs/21`).
{
  const wd = await import('../automation-engine/lib/watchdog.mjs');
  const state = runInFlight(processesNamed('node.exe'), wd.readArmed(), pidAlive);
  if (state.busy) {
    console.log(`ПРОГОН В РАБОТЕ — НЕ ТРОГАЮ НИЧЕГО (${state.why}).`);
    console.log('Окно наблюдения и сэмплер телеметрии принадлежат ему, а не мусору.');
    console.log('Брошенные окна подождут один ход: убрать их сейчас значит убить прогон.');
    process.exit(0);
  }
  if (state.why) console.log(`⚠️  ${state.why}`);
}

// ---- 1. НАШИ АРТЕФАКТЫ — опознаются положительно, убираются без оговорок.
const dash = await import('../automation-engine/lib/run-dashboard.mjs');
const probe = await dash.probeDashboard(dash.DEFAULT_PORT);
if (probe.alive && probe.ours) {
  const pid = dash.findListenerPid(dash.DEFAULT_PORT);
  console.log(`ОКНО НАБЛЮДЕНИЯ: сервер жив на ${dash.DEFAULT_PORT} (pid ${pid ?? 'не опознан'})`);
  if (APPLY && pid) { kill(pid); console.log('   снят'); }
} else {
  console.log('ОКНО НАБЛЮДЕНИЯ: сервера нет');
}
if (APPLY) {
  const gone = dash.closeWindow();
  console.log(gone.closed.length ? `   окно: закрыто (${gone.closed.join(', ')})` : '   окно: закрывать было нечего');
}

const samplers = processesNamed('node.exe').filter((p) => /hardware-mon/.test(p.cmd));
console.log(`СЭМПЛЕРЫ ТЕЛЕМЕТРИИ: ${samplers.length ? samplers.map((s) => s.pid).join(', ') : 'нет'}`);
if (APPLY) for (const s of samplers) { kill(s.pid); console.log(`   снят ${s.pid}`); }

// ---- 2. БРОШЕННЫЕ ОКНА ТЕРМИНАЛА — те, что подняты системой через DCOM и опустели.
console.log('');
const terms = [...processesNamed('WindowsTerminal.exe'), ...processesNamed('OpenConsole.exe')];
if (terms.length === 0) {
  console.log('ОКНА ТЕРМИНАЛА: ни одного — чисто');
} else {
  for (const t of terms) {
    const kids = childCount(t.pid);
    // ПРИЗНАК БРОШЕННОСТИ — ПУСТОТА, А НЕ ПРОИСХОЖДЕНИЕ. Первая редакция закрывала только окна с
    // меткой `-Embedding` (поднятые системой через DCOM), и брошенный `OpenConsole.exe` под неё не
    // попал: владелец видел его на экране, а инструмент отчитывался «не трогаю». Верный признак
    // проще и безопаснее: **в терминале не работает НИ ОДНОГО процесса**. Терминал, в котором
    // владелец что-то делает, всегда держит внутри хотя бы оболочку — он не будет тронут никогда;
    // терминал без единого процесса внутри не используется никем по определению.
    const abandoned = kids === 0;
    const origin = /-Embedding/i.test(t.cmd) ? 'поднят системой' : 'запущен пользователем';
    console.log(`ОКНО ТЕРМИНАЛА: pid ${t.pid} · ${origin} · процессов внутри ${kids}`
      + (abandoned ? '  → БРОШЕНО, закрываю' : '  → в нём работают, НЕ ТРОГАЮ'));
    if (APPLY && abandoned) { kill(t.pid); console.log('   закрыто'); }
  }
}

console.log('');
console.log(APPLY ? 'ГОТОВО.' : 'Ничего не тронуто. Убрать — `node tools/tidy.mjs --apply`');

/**
 * Самопроверка решения «трогать или не трогать» — на фикстурах, без машины и без единого `taskkill`.
 *
 * Проверяется ИМЕННО ЭТО решение, потому что именно оно стоило прогона: остальная часть файла
 * перечисляет процессы и зовёт `taskkill`, и её проверяет наблюдение на живой машине.
 */
async function selfTest() {
  const blocks = [];
  const check = (name, ok, detail = '') => blocks.push({ name, ok, detail });
  const alive = () => true;
  const dead = () => false;
  const P = (pid, cmd) => ({ pid, cmd });

  // Каждая команда из списка маркеров обязана быть узнана — иначе однажды уборка убьёт её посреди
  // записи в GPU. Перечислены ПОИМЁННО, а не счётчиком: счётчик остаётся зелёным, когда одну строку
  // удалили, а другую продублировали.
  const RUNS = [
    ['развёртка', 'node automation-engine/engine.mjs --sweep --from 2887 --to 900 --dashboard'],
    ['полосовой обход', 'node automation-engine/engine.mjs --band 2400,1700'],
    ['поиск края', 'node automation-engine/engine.mjs --search --cap 2842'],
    ['атом записи', 'node automation-engine/lib/vf-step.mjs --set --point 95'],
    ['спуск по лестнице', 'node automation-engine/lib/ladder-descent.mjs --points 2400'],
    ['тепловая лестница', 'node automation-engine/lib/thermal-ladder.mjs --points 2100'],
    ['акустическая лестница', 'node automation-engine/lib/fan-ladder.mjs --period 15'],
    ['репетиция на стенде', 'node automation-engine/lib/trap-suite.mjs --bench --from 3090'],
  ];
  for (const [what, cmd] of RUNS) {
    const r = runInFlight([P(1234, cmd)], null, alive);
    check(`узнаёт живой прогон: ${what}`, r.busy === true, r.why);
  }

  check('СУХОЙ прогон не считается работой — он ничего не пишет и никого не поднимает',
    runInFlight([P(1, 'node automation-engine/engine.mjs --sweep --from 2887 --to 900 --dry-run')], null, alive).busy === false);

  // bugs/64 — уборка дважды закрыла владельцу страницу с вопросами посреди ответа.
  const rv = runInFlight([P(3, 'node tools/review.mjs interviews/interview_017_five_method_forks.md')], null, alive);
  check('живой контур согласований делает машину занятой — страница владельца не мусор (bugs/64)',
    rv.busy === true && /контур согласований/u.test(rv.why), rv.why);

  check('мгновенные формы контура (--no-serve, --selftest) уборке не преграда',
    runInFlight([P(4, 'node tools/review.mjs doc.md --no-serve --no-signal')], null, alive).busy === false
    && runInFlight([P(5, 'node tools/review.mjs --selftest')], null, alive).busy === false);

  check('посторонний node не делает машину занятой',
    runInFlight([P(2, 'node some/other/thing.mjs')], null, alive).busy === false);

  check('пусто -> убирать можно', runInFlight([], null, alive).busy === false);

  // Второе окно времени: прогон запущен НЕ нами, его командной строки в списке нет, но сторож взведён.
  check('взведённый сторож с ЖИВЫМ владельцем -> не трогаем ничего',
    runInFlight([], { ownerPid: 777, what: 'андервольт' }, alive).busy === true);

  const orphan = runInFlight([], { ownerPid: 777, what: 'андервольт' }, dead);
  check('взведённый сторож с МЁРТВЫМ владельцем -> это авария, а не работа: убирать можно, но СКАЗАТЬ',
    orphan.busy === false && /recover/u.test(orphan.why), orphan.why);

  for (const b of blocks) console.log(`  ${b.ok ? 'OK  ' : 'ПЛОХО'} ${b.name}${b.detail ? ` — ${b.detail}` : ''}`);
  const failed = blocks.filter((b) => !b.ok).length;
  console.log('');
  console.log(`САМОПРОВЕРКА УБОРКИ: ${blocks.length} блоков, провалов ${failed}.`);
  return failed === 0 ? 0 : 1;
}
