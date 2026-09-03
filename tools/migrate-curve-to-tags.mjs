#!/usr/bin/env node
// МИГРАЦИЯ ДОКУМЕНТА КРИВОЙ НА ОБЛАКО ТЕГОВ — эпик 04, фаза 1, шаг 4.3 (`plans/24`).
//
// Читает документ в старом формате (поле `status`), выдаёт новый (поле `tags`). Перекладка и только
// она: НИ ОДНОГО нового факта не приписывается. Класс `origin` существующим строкам НЕ раздаётся —
// откуда взято старое число, документ не знает, а догадаться значило бы нарушить правило трёх дверей
// (`PHILOSOPHY.md`): выдуманный факт хуже отсутствующего. `origin` начинает жить с первого нового
// закрытия через `closePoint`.
//
// `--check` — ничего не пишет, только считает и печатает, что СДЕЛАЛОСЬ БЫ.
//
// [NOT-TESTED] сам по себе; обратимость доказывается голденом (P1-AC1) и блоками в `curve --selftest`.
import { readFileSync, writeFileSync } from 'node:fs';
import {
  curvePath, tagsForStatus, statusFromTags, CURVE_STATUS,
} from '../automation-engine/lib/curve-store.mjs';
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

const check = argv.includes('--check');
const file = curvePath('measured');
const doc = JSON.parse(readFileSync(file, 'utf8'));

const byStatus = {};
let already = 0;
const rows = doc.frequencies.map((r) => {
  if (Array.isArray(r.tags) && !('status' in r)) { already++; return r; }
  const tags = tagsForStatus(r.status);
  if (tags === null) {
    throw new Error(`строка ${r.mhz} МГц несёт статус вне словаря: ${JSON.stringify(r.status)}. `
      + `Известны: ${Object.values(CURVE_STATUS).join(', ')}`);
  }
  byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  // ОБРАТИМОСТЬ ПРОВЕРЯЕТСЯ НА КАЖДОЙ СТРОКЕ, а не один раз на документе: если карта туда-обратно
  // не сходится хоть на одной, миграция обязана упасть здесь, а не оставить тихо испорченный файл.
  const back = statusFromTags(tags);
  if (back !== r.status) {
    throw new Error(`строка ${r.mhz} МГц НЕ ОБРАТИМА: ${r.status} -> [${tags}] -> ${back}`);
  }
  const { status, ...rest } = r;
  // Порядок ключей — тот же, что у ROW_KEYS: документ сравнивают глазами и построчным разностным
  // сравнением, и стабильный порядок полей это то, что делает оба возможными.
  return {
    mhz: rest.mhz,
    voltageMv: rest.voltageMv,
    stockVoltageMv: rest.stockVoltageMv,
    tags,
    provenBy: rest.provenBy ?? null,
    editedAt: rest.editedAt,
  };
});

console.log(`строк всего: ${doc.frequencies.length} · уже в новом формате: ${already}`);
console.log('переложено по старым статусам:');
for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${s.padEnd(20)} ${String(n).padStart(4)} -> ${tagsForStatus(s).join(', ')}`);
}
console.log('обратимость: проверена ПОСТРОЧНО, расхождений 0');

if (check) {
  console.log('\n--check: НИЧЕГО НЕ ЗАПИСАНО.');
} else {
  writeFileSync(file, `${JSON.stringify({ ...doc, frequencies: rows }, null, 2)}\n`, 'utf8');
  console.log(`\nЗАПИСАНО: ${file}`);
}
return 0;
}

// СТОРОЖ ВХОДА — прибор исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && entryResolve(process.argv[1]) === entryResolve(entryPath(import.meta.url))) process.exit(await main(process.argv.slice(2)));
