#!/usr/bin/env node
/**
 * TIDY — убрать за проектом и за агентом. `bugs/17`.
 *
 * ЗАЧЕМ ЭТО СУЩЕСТВУЕТ. Владелец ТРИ раза подряд находил в своей ОС висящие окна терминала, оставшиеся
 * после работы агента: *«KAGO засирает мне ОС окнами терминала! Так быть не должно»*. Источник окон
 * на момент написания НЕ НАЙДЕН (три версии опровергнуты — `bugs/17`), и это ровно тот случай, когда
 * лечить надо СЛЕДСТВИЕ, не дожидаясь причины: пустое окно бесполезно всем, а владельцу мешает.
 *
 * ⚠️ ГРАНИЦА, КОТОРУЮ ЭТА КОМАНДА НЕ ПЕРЕХОДИТ, и она важнее самой уборки. Это машина владельца
 * (`AGENT_GUIDE.md` → THE OWNER'S-MACHINE RULE). Поэтому:
 *   · закрывается ТОЛЬКО окно БЕЗ дочерних процессов — в нём заведомо ничего не работает;
 *   · окно, где что-то живёт, не трогается никогда, даже если оно наше;
 *   · сначала по-хорошему (`CloseMainWindow`), и лишь потом принудительно;
 *   · по умолчанию команда НИЧЕГО НЕ ДЕЛАЕТ, а только показывает — убирает по `--apply`.
 *
 * Плюс убираются НАШИ собственные артефакты, опознанные положительно: сервер окна наблюдения на его
 * порту, само окно наблюдения и процессы-сэмплеры телеметрии.
 *
 * [NOT-TESTED] в части «найти и закрыть чужое пустое окно» — проверяется наблюдением на живой
 * машине, фикстуры для процессов ОС у проекта нет.
 */

import { execFileSync } from 'node:child_process';

const APPLY = process.argv.includes('--apply');

/** PowerShell и не bash: это вызовы Windows API, и MSYS2 переписал бы `/Flag` в путь (EXP-0043). */
function ps(script) {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script],
      { encoding: 'utf8', windowsHide: true, timeout: 30_000 }).trim();
  } catch (e) {
    return `ОШИБКА: ${e?.message ?? e}`;
  }
}

console.log(APPLY ? 'УБОРКА (--apply): закрываю найденное' : 'ОСМОТР: только показываю. Убрать — добавьте --apply');
console.log('');

// ---- 1. НАШИ АРТЕФАКТЫ. Опознаются положительно, поэтому убираются без оговорок.
const dash = await import('../automation-engine/lib/run-dashboard.mjs');
const probe = await dash.probeDashboard(dash.DEFAULT_PORT);
if (probe.alive && probe.ours) {
  const pid = dash.findListenerPid(dash.DEFAULT_PORT);
  console.log(`ОКНО НАБЛЮДЕНИЯ: сервер жив на ${dash.DEFAULT_PORT} (pid ${pid ?? 'не опознан'})`);
  if (APPLY && pid) { dash.killPid(pid); console.log('   снят'); }
} else {
  console.log(`ОКНО НАБЛЮДЕНИЯ: сервера нет (${probe.why ?? 'порт свободен'})`);
}
if (APPLY) {
  const gone = dash.closeWindow();
  console.log(gone.closed.length ? `   окно: закрыто (${gone.closed.join(', ')})` : '   окно: закрывать было нечего');
}

const samplers = ps("@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*hardware-mon*' } | ForEach-Object { $_.ProcessId }) -join ' '");
if (samplers && !samplers.startsWith('ОШИБКА')) {
  console.log(`СЭМПЛЕРЫ ТЕЛЕМЕТРИИ: ${samplers}`);
  if (APPLY) { ps(`Stop-Process -Id ${samplers.split(/\s+/).join(',')} -Force -ErrorAction SilentlyContinue`); console.log('   сняты'); }
} else {
  console.log('СЭМПЛЕРЫ ТЕЛЕМЕТРИИ: нет');
}

// ---- 2. ПУСТЫЕ ОКНА ТЕРМИНАЛА. Чужие по происхождению, но пустые — и именно они мешают владельцу.
console.log('');
const report = ps(`
$out = @()
foreach ($p in Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -match 'WindowsTerminal|OpenConsole|conhost' }) {
  $kids = @(Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $p.Id))
  $out += ('' + $p.Id + '|' + $p.ProcessName + '|' + $p.StartTime + '|' + $kids.Count)
}
$out -join "\`n"
`);
const rows = report && !report.startsWith('ОШИБКА') ? report.split('\n').filter(Boolean) : [];
if (rows.length === 0) {
  console.log('ОКНА ТЕРМИНАЛА: ни одного — чисто');
} else {
  for (const r of rows) {
    const [pid, name, started, kids] = r.split('|');
    const empty = Number(kids) === 0;
    console.log(`ОКНО ТЕРМИНАЛА: pid ${pid} · ${name} · поднято ${started} · процессов внутри ${kids}`
      + (empty ? '  → ПУСТОЕ, можно закрыть' : '  → В НЁМ РАБОТАЮТ, НЕ ТРОГАЮ'));
    if (APPLY && empty) {
      ps(`$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
          if ($p) { $null = $p.CloseMainWindow(); Start-Sleep -Milliseconds 900; $p.Refresh(); if (-not $p.HasExited) { $p.Kill() } }`);
      console.log('   закрыто');
    }
  }
}

console.log('');
console.log(APPLY ? 'ГОТОВО.' : 'Ничего не тронуто. Убрать — `node tools/tidy.mjs --apply`');
