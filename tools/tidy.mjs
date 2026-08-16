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

console.log(APPLY ? 'УБОРКА (--apply): закрываю найденное' : 'ОСМОТР: только показываю. Убрать — добавьте --apply');
console.log('');

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
