#!/usr/bin/env node
// ЗАКРЫТЬ ОСИРОТЕВШЕЕ НАМЕРЕНИЕ ПОСЛЕ ЖЁСТКОЙ ОСТАНОВКИ ПРОГОНА.
//
// Зачем нужен отдельный инструмент. Развёртка закрывает своё намерение сама — на останове оператора
// (`closeAsOperatorStop`, `bugs/14`) и на собственной смерти (`closeAsWriterDeath`, `bugs/20`). Оба
// пути требуют, чтобы процесс был ЖИВ в момент обработки. `taskkill /F` этого не оставляет: процесс
// исчезает мгновенно, намерение остаётся незакрытым, и по правилу R15b следующий читатель обязан
// прочесть его как ЗАВИСАНИЕ МАШИНЫ — что честно по построению и неверно по факту.
//
// Найдено судьёй 2026-08-22 21:0x: после остановки прогона по слову владельца на 2872 МГц повис
// ложный пол 1000 мВ — то есть ПЕРВАЯ ЖЕ частота следующей полосы закрылась бы «краем», не спустив
// ни одной ступени.
//
// ⚠️ ЭТО НЕ ПОПРАВКА (`writeCorrection`). Поправка переатрибутирует ЗАКРЫТУЮ запись и требует улики;
// здесь запись не закрыта вовсе, и штатный путь — закрыть её тем, чем она была.
//
// [NOT-TESTED] сам по себе; механизм, который он зовёт, доказан блоками `journal --selftest`.
import {
  openJournal, readJournal, orphanIntents, closeAsOperatorStop, hangFloors, SWEEP_DIR,
} from '../automation-engine/lib/sweep-journal.mjs';
import { resolve as entryResolve } from 'node:path';
import { fileURLToPath as entryPath } from 'node:url';

/**
 * ВСЯ РАБОТА ПРИБОРА — здесь, и зовётся она ТОЛЬКО при прямом запуске (`bugs/95`, сессия 78).
 * До починки тело стояло на верхнем уровне модуля и исполнялось при ИМПОРТЕ с argv вызывающего.
 * Тело намеренно НЕ сдвинуто по отступу: в приборах этого класса есть многострочные шаблоны,
 * и сдвиг изменил бы порождаемые артефакты; голден байт-в-байт дороже отступа.
 * @param {string[]} argv аргументы БЕЗ `node` и пути к файлу
 */
async function main(argv) {

const journal = openJournal({ dir: SWEEP_DIR });
const before = readJournal(journal).records;
const orphans = orphanIntents(before);

if (orphans.length === 0) {
  console.log('ОСИРОТЕВШИХ НАМЕРЕНИЙ НЕТ — закрывать нечего.');
  process.exit(0);
}

console.log('ОСИРОТЕВШИЕ НАМЕРЕНИЯ:');
for (const o of orphans) console.log(`   seq ${o.seq}: ${o.frequencyMhz} МГц / ${o.voltageMv} мВ · ${o.at}`);
console.log(`\nПОЛОВ ДО: ${hangFloors(before).size}`);

const closed = closeAsOperatorStop(journal, {
  at: new Date().toISOString(),
  signal: 'taskkill /F (остановка по слову владельца, обработчик не успел отработать)',
});

const after = readJournal(journal).records;
console.log(`\nЗАКРЫТО ОСТАНОВОМ ОПЕРАТОРА: ${closed.length}`);
console.log('ПОЛЫ ПОСЛЕ:');
for (const [mhz, v] of [...hangFloors(after)].sort((a, b) => b[0] - a[0])) {
  console.log(`   ${mhz} МГц -> ${v.voltageMv} мВ (seq ${v.seq})`);
}
return 0;
}

// СТОРОЖ ВХОДА — прибор исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && entryResolve(process.argv[1]) === entryResolve(entryPath(import.meta.url))) process.exit(await main(process.argv.slice(2)));
