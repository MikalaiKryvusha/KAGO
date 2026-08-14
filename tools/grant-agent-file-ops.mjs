#!/usr/bin/env node
// grant-agent-file-ops.mjs — ЗАПУСКАЕТ ВЛАДЕЛЕЦ. Снимает вопросы на ФАЙЛОВЫЕ операции агента.
//
// ─── ЗАЧЕМ ОТДЕЛЬНЫЙ СКРИПТ, ЕСЛИ ЕСТЬ grant-agent-rights.mjs ─────────────────────────────────────
//
// Тот выдаёт ШИРОКИЕ правила (`Bash(*)`, `PowerShell(*)`, `Edit(**)`…) и они УЖЕ на месте — 5 из 5.
// А вопросы всё равно приходили. Причина названа самим отказом 2026-08-14 21:5x:
//
//   «Permission for this action was denied by the Claude Code auto mode classifier… To allow this
//    type of action in the future, the user can add a Bash permission rule to their settings.»
//
// То есть решает не файл настроек, а КЛАССИФИКАТОР авто-режима — модель, которая судит каждое
// действие отдельно и стоит ВЫШЕ разрешений. Широкая звёздочка его не убеждает; по его же словам
// помогает КОНКРЕТНОЕ правило. Этот скрипт добавляет конкретные — по одному на операцию.
//
// ─── ЧЕГО ЭТОТ СКРИПТ НЕ ДЕЛАЕТ, И ЭТО НАЗВАНО ЧЕСТНО ─────────────────────────────────────────────
//
//   • НЕ трогает `deny`. Там стоят запреты, которые владелец поставил сам и которые ловили
//     небрежность агента (`PowerShell(Remove-Item *)` — 2026-08-10). Запреты СИЛЬНЕЕ разрешений, и
//     снимать их этим скриптом было бы подменой его решения.
//   • НЕ обещает, что вопросы исчезнут полностью. Классификатор — модель; гарантированный рычаг
//     остаётся у владельца и он один: команда `/permissions` в Claude Code и смена режима.
//   • НЕ добавляет удаление. `rm` и `Remove-Item` сюда не входят намеренно: агент обходится без них
//     (переименование — `git add` + `git mv`, уборка временных файлов — из кода через Node), а
//     разрешение на удаление это ровно то, чем был потерян храповик 2026-08-14 (`bugs/08`).
//
// Куда пишет: `.claude/settings.local.json` — личный файл владельца, под gitignore. Общий
// `.claude/settings.json` не трогается: правила такого рода личные, а не проектные.
//
// Запуск:  node tools/grant-agent-file-ops.mjs           — выдать
//          node tools/grant-agent-file-ops.mjs --show     — показать, ничего не меняя
//          node tools/grant-agent-file-ops.mjs --revoke   — снять РОВНО то, что выдал этот скрипт
//
// [NOT-TESTED] на момент написания — проверяется первым же запуском владельца: `--show` до и после.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SETTINGS = join(ROOT, '.claude', 'settings.local.json');

/**
 * КОНКРЕТНЫЕ правила на файловые операции, которые агенту нужны в обычной работе.
 *
 * Каждое — созидательное: перенос, копирование, создание. Ни одного разрушающего: удаление в этот
 * список не входит по причине, названной в шапке. Пары Bash/PowerShell даны обе, потому что агент
 * выбирает оболочку по КОМАНДЕ, а не по настроению (EXP-0043: флаги через `/` идут в PowerShell,
 * POSIX-инструменты — в bash).
 */
const FILE_OPS = [
  'Bash(mv *)',
  'Bash(cp *)',
  'Bash(mkdir *)',
  'Bash(touch *)',
  'PowerShell(Move-Item *)',
  'PowerShell(Copy-Item *)',
  'PowerShell(New-Item *)',
  'PowerShell(Rename-Item *)',
];

function load() {
  if (!existsSync(SETTINGS)) return { permissions: { allow: [], ask: [], deny: [] } };
  try {
    return JSON.parse(readFileSync(SETTINGS, 'utf8'));
  } catch (e) {
    console.error(`ОШИБКА: ${SETTINGS} не разбирается как JSON — ${e.message}`);
    console.error('Файл НЕ тронут. Почините JSON и запустите снова.');
    process.exit(1);
  }
}

const settings = load();
settings.permissions ??= {};
settings.permissions.allow ??= [];
settings.permissions.deny ??= [];
const allow = settings.permissions.allow;
const deny = settings.permissions.deny;

if (process.argv.includes('--show')) {
  const have = FILE_OPS.filter((r) => allow.includes(r));
  console.log(`файл: ${SETTINGS}`);
  console.log(`правила файловых операций: ${have.length} из ${FILE_OPS.length} на месте`);
  for (const r of FILE_OPS) console.log(`  ${allow.includes(r) ? '✓' : '·'} ${r}`);
  console.log('');
  console.log(`всего разрешений: ${allow.length} · запретов: ${deny.length} (запреты СИЛЬНЕЕ разрешений)`);
  console.log('');
  console.log('ЕСЛИ ВОПРОСЫ ОСТАЛИСЬ — дело не в этом файле, а в классификаторе авто-режима.');
  console.log('Рычаг: команда /permissions в Claude Code и смена режима.');
  process.exit(0);
}

if (process.argv.includes('--revoke')) {
  const before = allow.length;
  settings.permissions.allow = allow.filter((r) => !FILE_OPS.includes(r));
  writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  console.log(`СНЯТО: ${before - settings.permissions.allow.length} правил. Остальные разрешения и все запреты не тронуты.`);
  process.exit(0);
}

const added = [];
for (const rule of FILE_OPS) {
  if (!allow.includes(rule)) { allow.push(rule); added.push(rule); }
}
writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

console.log(`файл: ${SETTINGS}`);
if (added.length) {
  console.log(`ДОБАВЛЕНО ${added.length}:`);
  for (const r of added) console.log(`  + ${r}`);
} else {
  console.log('Все правила уже были на месте — ничего не изменилось.');
}
console.log('');
console.log(`Итого разрешений: ${allow.length} · запретов: ${deny.length}. Запреты НЕ тронуты и остаются сильнее.`);
console.log('');
console.log('ЧЕСТНАЯ ОГОВОРКА: это снимает вопросы, которые задаёт файл настроек. Классификатор');
console.log('авто-режима — отдельная модель НАД настройками, и он может спросить снова. Если так —');
console.log('единственный надёжный рычаг ваш: /permissions в Claude Code, смена режима.');
console.log('Откат этого скрипта: node tools/grant-agent-file-ops.mjs --revoke');
