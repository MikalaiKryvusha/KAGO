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
  // ── ГОЛЫЕ ИМЕНА ИНСТРУМЕНТОВ — ЭТО И ЕСТЬ «РАЗРЕШИТЬ ЦЕЛИКОМ» ───────────────────────────────────
  //
  // ПОЧЕМУ ПРЕЖНИЙ ГРАНТ НЕ СРАБОТАЛ (владелец, 2026-08-15: «опять ты выполнял команду, на которую
  // мне пришлось давать тебе разрешение»). По схеме прав Claude Code форма `Bash(*)` — это
  // ПРЕФИКСНЫЙ ШАБЛОН аргумента, такой же, как `Bash(git *)`, и он совпадает не со всякой командой:
  // составные команды, фоновые запуски и разные разборы строки под него не подходят. Форма
  // «разрешить инструмент во всех его вызовах» — ГОЛОЕ ИМЯ БЕЗ СКОБОК. Поэтому ниже стоят обе:
  // голые имена делают работу, шаблоны остаются как совместимость и ничего не ломают.
  'Bash',             // любой вызов bash — без вопроса
  'PowerShell',       // любой вызов PowerShell — без вопроса
  'WebSearch',        // поиск в сети (текст запроса уходит наружу — названо вслух)
  'WebFetch',         // загрузка страницы по ссылке, любой домен
  'Read',             // чтение любого файла
  'Edit',             // правка любого файла
  'Write',            // создание любого файла
  // ── прежние шаблонные формы: оставлены для совместимости, вреда не несут ───────────────────────
  'Bash(*)',          // любые команды bash без вопроса
  'PowerShell(*)',    // любые команды PowerShell без вопроса
  'Edit(**)',         // правка любого файла внутри проекта
  'Write(**)',        // создание любого файла внутри проекта
  'Read(**)',         // чтение любого файла внутри проекта
  // ДОБАВЛЕНО 2026-08-15 по прямому слову владельца: «опять ты выполнял команду, на которую мне
  // пришлось давать тебе разрешение. я устал от этого». Дыра была именно здесь: WebFetch выдан
  // ПОДОМЕННО (14 записей), а WebSearch не выдан ВООБЩЕ — и поиск в сети спрашивал каждый раз.
  //
  // Почему это не расширяет возможности агента, а только убирает вопрос: `Bash(*)` выше уже
  // разрешает `curl` к любому адресу, то есть исходящий запрос агенту доступен и без этих строк.
  // Новое здесь ровно одно — отсутствие вопроса. Сам факт ИСХОДЯЩЕЙ отправки называется вслух:
  // поисковый запрос уходит наружу, во внешний сервис, и это не читается как локальная команда.
];

// РЕЖИМ ПО УМОЛЧАНИЮ. Слово владельца, 2026-08-15: «Никакие твои консольные команды не должны меня
// спрашивать разрешения. всё разрешено, кроме деструктивных». Списком разрешений это не
// закрывается: список покрывает то, что в нём перечислено, а вопрос прилетает как раз на том, чего
// в нём НЕТ. `dontAsk` снимает вопрос по умолчанию, и ЗАПРЕТЫ ПРИ ЭТОМ ПРОДОЛЖАЮТ ДЕЙСТВОВАТЬ —
// deny сильнее allow и проверяется первым. Это и есть «всё, кроме деструктивных».
//
// ЧЕГО ЗДЕСЬ СОЗНАТЕЛЬНО НЕТ: `bypassPermissions`. Он не «ещё шире» — он ОТКЛЮЧАЕТ проверки целиком,
// вместе с вашими 18 запретами, включая `PowerShell(Remove-Item *)`, который однажды уже поймал мою
// небрежность. Это ровно противоположно тому, что вы просили, поэтому не предлагается даже флагом.
const WIDE_MODE = 'dontAsk';
const MODE_KEY = 'defaultMode';

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
  console.log(`режим по умолчанию: ${settings.permissions[MODE_KEY] ?? 'не задан (значит «спрашивать»)'} — нужен «${WIDE_MODE}»`);
  console.log(`всего разрешений: ${allow.length} · запретов: ${deny.length}`);
  console.log('\nЗАПРЕТЫ (они СИЛЬНЕЕ любых разрешений, широкий грант их не отменяет):');
  for (const d of deny) console.log(`  ✗ ${d}`);
  process.exit(0);
}

if (mode === 'revoke') {
  const before = allow.length;
  settings.permissions.allow = allow.filter((r) => !WIDE_RULES.includes(r));
  // Режим снимаем ТОЛЬКО если это наш — чужой (выставленный вручную) не трогаем.
  const hadMode = settings.permissions[MODE_KEY] === WIDE_MODE;
  if (hadMode) delete settings.permissions[MODE_KEY];
  save(settings);
  console.log(`СНЯТО: ${before - settings.permissions.allow.length} широких правил${hadMode ? ` и режим «${WIDE_MODE}»` : ''}. Остальные разрешения не тронуты.`);
  console.log('Агент снова будет спрашивать на командах, которых нет в узком списке.');
  process.exit(0);
}

const added = [];
for (const rule of WIDE_RULES) {
  if (!allow.includes(rule)) { allow.push(rule); added.push(rule); }
}
const modeWas = settings.permissions[MODE_KEY];
const modeChanged = modeWas !== WIDE_MODE;
if (modeChanged) settings.permissions[MODE_KEY] = WIDE_MODE;

if (added.length === 0 && !modeChanged) {
  console.log('Права УЖЕ выданы — ничего не меняю (скрипт идемпотентен).');
} else {
  save(settings);
  if (added.length) {
    console.log(`ВЫДАНО (${added.length}):`);
    for (const r of added) console.log(`  ✓ ${r}`);
  }
  if (modeChanged) {
    console.log(`РЕЖИМ ПО УМОЛЧАНИЮ: ${modeWas ?? 'не был задан'} → ${WIDE_MODE}`);
    console.log('  (именно он снимает вопрос на том, чего НЕТ в списке разрешений — а спрашивают');
    console.log('   всегда именно про это. Запреты продолжают действовать и проверяются ПЕРВЫМИ.)');
  }
}

console.log(`\nфайл: ${SETTINGS}`);
console.log(`\nЗАПРЕТЫ ОСТАЛИСЬ И ОНИ СИЛЬНЕЕ РАЗРЕШЕНИЙ — вот они, ${deny.length} шт.:`);
for (const d of deny) console.log(`  ✗ ${d}`);
console.log(`
Дальше:
  • ПЕРЕЗАПУСТИ СЕССИЮ АГЕНТА — режим по умолчанию читается на старте, в отличие от списка
    разрешений, который подхватывается на следующем же вызове;
  • если вопрос всё-таки прилетит — посмотри /permissions, там видно, какое правило сработало,
    и скажи мне: значит форма правила снова не та, и чинить надо её, а не терпеть;
  • мгновенная альтернатива на одну сессию — Shift+Tab, смена режима разрешений;
  • откат в любой момент: node tools/grant-agent-rights.mjs --revoke

Чего этот грант НЕ отменяет: агент по-прежнему спрашивает на ПРОДУКТОВОМ видении
(развилки, вкус, бренд) — для этого в KAIF есть interviews/ и homeworks/, и это
правило фреймворка, а не разрешений.`);
