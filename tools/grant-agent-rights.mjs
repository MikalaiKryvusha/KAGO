#!/usr/bin/env node
/**
 * grant-agent-rights.mjs — ВЛАДЕЛЕЦ выдаёт агенту право на консольные команды без вопросов.
 *
 * Зачем отдельный скрипт: агент НЕ МОЖЕТ поднять себе права сам — классификатор авто-режима
 * Claude Code блокирует правку `.claude/settings.local.json` и настроек авто-режима агентом,
 * и это защита харнесса, а не наша настройка. Поэтому скрипт пишет агент, а ЗАПУСКАЕТ человек:
 * тогда грант исходит от владельца, как и должно быть.
 *
 * Слово владельца, дословно (2026-08-14): «я вообще не люблю вопросы от тебя на твои команды
 * консольные, никаких вопросов. кроме продуктового видения, для чего есть KAIF».
 *
 * Что делает: добавляет в permissions.allow широкие правила на Bash/PowerShell и на правку файлов.
 * Чего НЕ делает: не трогает permissions.deny — запреты остаются и они СИЛЬНЕЕ разрешений
 * (rm -rf, winget/choco install, Remove-Item, force-push, удаление репозитория и релизов).
 * Идемпотентен: повторный запуск ничего не дублирует.
 *
 *   node tools/grant-agent-rights.mjs            # выдать
 *   node tools/grant-agent-rights.mjs --show     # только показать текущее состояние
 *   node tools/grant-agent-rights.mjs --revoke   # снять ровно эти широкие правила
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SETTINGS = path.join(REPO_ROOT, '.claude', 'settings.local.json');

// Ровно те правила, которые выдаёт этот скрипт — по ним же работает --revoke.
const WIDE_RULES = [
  'Bash(*)',          // любые команды bash без вопроса
  'PowerShell(*)',    // любые команды PowerShell без вопроса
  'Edit(**)',         // правка любого файла внутри проекта
  'Write(**)',        // создание любого файла внутри проекта
  'Read(**)',         // чтение любого файла внутри проекта
];

const mode = process.argv.includes('--show') ? 'show'
  : process.argv.includes('--revoke') ? 'revoke'
  : 'grant';

function load() {
  if (!existsSync(SETTINGS)) return { permissions: { allow: [], ask: [], deny: [] } };
  const raw = readFileSync(SETTINGS, 'utf8').replace(/^﻿/, '');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`ПРОВАЛ: ${SETTINGS} — не валидный JSON (${e.message}).`);
    console.error('Ничего не тронуто. Почини файл руками и запусти снова.');
    process.exit(1);
  }
}

function save(obj) {
  mkdirSync(path.dirname(SETTINGS), { recursive: true });
  // UTF-8 без BOM, LF — Claude Code читает именно так (и Set-Content сюда не пускаем, EXP-дело).
  writeFileSync(SETTINGS, JSON.stringify(obj, null, 2).replace(/\r\n/g, '\n') + '\n', 'utf8');
}

const settings = load();
settings.permissions ??= {};
settings.permissions.allow ??= [];
settings.permissions.ask ??= [];
settings.permissions.deny ??= [];

const allow = settings.permissions.allow;
const deny = settings.permissions.deny;

if (mode === 'show') {
  const have = WIDE_RULES.filter((r) => allow.includes(r));
  console.log(`файл: ${SETTINGS}`);
  console.log(`широкие правила: ${have.length} из ${WIDE_RULES.length} на месте${have.length ? ` (${have.join(', ')})` : ''}`);
  console.log(`всего разрешений: ${allow.length} · запретов: ${deny.length}`);
  console.log('\nЗАПРЕТЫ (они СИЛЬНЕЕ любых разрешений, широкий грант их не отменяет):');
  for (const d of deny) console.log(`  ✗ ${d}`);
  process.exit(0);
}

if (mode === 'revoke') {
  const before = allow.length;
  settings.permissions.allow = allow.filter((r) => !WIDE_RULES.includes(r));
  save(settings);
  console.log(`СНЯТО: ${before - settings.permissions.allow.length} широких правил. Остальные разрешения не тронуты.`);
  console.log('Агент снова будет спрашивать на командах, которых нет в узком списке.');
  process.exit(0);
}

const added = [];
for (const rule of WIDE_RULES) {
  if (!allow.includes(rule)) { allow.push(rule); added.push(rule); }
}

if (added.length === 0) {
  console.log('Права УЖЕ выданы — ничего не меняю (скрипт идемпотентен).');
} else {
  save(settings);
  console.log(`ВЫДАНО (${added.length}):`);
  for (const r of added) console.log(`  ✓ ${r}`);
}

console.log(`\nфайл: ${SETTINGS}`);
console.log(`\nЗАПРЕТЫ ОСТАЛИСЬ И ОНИ СИЛЬНЕЕ РАЗРЕШЕНИЙ — вот они, ${deny.length} шт.:`);
for (const d of deny) console.log(`  ✗ ${d}`);
console.log(`
Дальше:
  • перезапуск VS Code НЕ нужен — правила читаются на следующем вызове инструмента;
  • если вопрос всё-таки прилетит — посмотри /permissions, там видно, какое правило сработало;
  • мгновенная альтернатива на одну сессию — Shift+Tab, смена режима разрешений;
  • откат в любой момент: node tools/grant-agent-rights.mjs --revoke

Чего этот грант НЕ отменяет: агент по-прежнему спрашивает на ПРОДУКТОВОМ видении
(развилки, вкус, бренд) — для этого в KAIF есть interviews/ и homeworks/, и это
правило фреймворка, а не разрешений.`);
