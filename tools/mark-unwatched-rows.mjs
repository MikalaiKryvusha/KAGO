// =================================================================================================
// ОДНОРАЗОВЫЙ: пометить строки, прожжённые БЕЗ СТОРОЖА НА ПОСТУ (`plans/87` Ш5)
// =================================================================================================
//
// ЗАЧЕМ. Слово владельца, `interviews/026`, 2026-09-04:
//   Q1 = B — «оракул, который корректность расчетов смотрел — не видел предсказание края. Сейчас он
//            стал лучше, когда он смотрит на лаги телеметрии. Перемерить то, что было намерено по
//            старому оракулу.»
//   Q4 = A — «все перемерить. Но в понедельник. не сегодня.»
//
// Метка ставится СЕГОДНЯ (документ — файл, карты скрипт не касается), перепрожиг — в понедельник,
// при владельце у машины, его словом.
//
// ДВА МАРШРУТА ОДНОГО ФАКТА — сторож, видящий предвестник края, не был на посту:
//   1. прожиг ДО 2026-08-29 — сторожа тогда не существовало (коммит 8409546, `bugs/61` DONE);
//   2. 2692 и 2685 МГц — сторож существовал, но ВЫШЕЛ с поста 04.09 (код 2, `bugs/101`).
//
// ЧЕГО СКРИПТ НЕ ДЕЛАЕТ: не трогает карту · не выдумывает напряжений (ни одно число не меняется,
// добавляется ровно один тег) · не метит строку БЕЗ собственного прожига — унаследованная от соседки
// или поднятая храповиком своего прожига не имела, и её происхождение это отдельный вопрос
// (`plans/87` риск 1, назван и оставлен открытым).
//
// СТОРОЖ ГРАНИЦ. Скрипт печатает поимённый список ДО записи и отказывается писать, если посчитанное
// число расходится с ожидаемым (`--expect N`) или если документ после правки не проходит проверку.
// Числа из головы в этом проекте уже стоили правок задним числом (EXP-0019).
//
// Запуск: `node tools/mark-unwatched-rows.mjs [--apply] [--expect N]`. Без `--apply` — только показать.

import { resolve as entryResolve } from 'node:path';
import { fileURLToPath as entryPath } from 'node:url';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

import {
  loadCurveDoc, saveCurveDoc, curvePath, validateCurveDoc,
  acceptanceProgress, renderDeliveryLine, CURVE_TAGS,
} from '../automation-engine/lib/curve-store.mjs';

/** Граница оракула: дата, с которой ступор телеметрии стал вердиктом. Проверяемая, не оценочная. */
export const ORACLE_DATE = '2026-08-29';
/** Строки 04.09, прожжённые при вышедшем с поста предохранителе (`interviews/026` Q1). */
export const FUSE_OFF_POST_MHZ = Object.freeze([2692, 2685]);

const tagsOf = (r) => (Array.isArray(r?.tags) ? r.tags : []);
const has = (r, t) => tagsOf(r).includes(t);
const dayOf = (r) => String(r?.editedAt ?? '').slice(0, 10);

/**
 * ЗА ЧТО СТРОКА ПОЛУЧАЕТ МЕТКУ — один предикат, названный причиной, а не молчаливым фильтром.
 * @returns {string|null} причина по-русски, либо null — метки нет
 */
export function whyUnwatched(row) {
  if (has(row, CURVE_TAGS.ORIGIN_UNWATCHED)) return null;            // уже помечена — не дублируем
  if (FUSE_OFF_POST_MHZ.includes(row?.mhz)) {
    return 'прожжена 04.09, когда предохранитель вышел с поста (bugs/101)';
  }
  const own = has(row, CURVE_TAGS.ORIGIN_MEASURED);
  const edge = has(row, CURVE_TAGS.STOP_EDGE_FOUND);
  if (!(own || edge)) return null;                                    // своего прожига нет — не метим
  if (!(dayOf(row) < ORACLE_DATE)) return null;
  return `${own ? 'прожжена' : 'край закрыт'} ${dayOf(row)} — до ${ORACLE_DATE}, сторож не видел предвестника`;
}

export function main(argv) {
  const apply = argv.includes('--apply');
  const expectAt = argv.indexOf('--expect');
  const expect = expectAt >= 0 ? Number(argv[expectAt + 1]) : null;

  const doc = loadCurveDoc();
  const before = acceptanceProgress(doc);
  const hits = doc.frequencies
    .map((r) => ({ row: r, why: whyUnwatched(r) }))
    .filter((x) => x.why !== null);

  console.log('ДОКУМЕНТ:', curvePath(), '· строк', doc.frequencies.length);
  console.log('\nДО ПРАВКИ:');
  console.log(renderDeliveryLine(before));

  console.log(`\nПОД МЕТКУ ПОПАДАЮТ ${hits.length} СТРОК(И) — поимённо, ДО записи:`);
  for (const { row, why } of hits.sort((a, b) => b.row.mhz - a.row.mhz)) {
    const edge = has(row, CURVE_TAGS.STOP_EDGE_FOUND) ? ' 🔴КРАЙ' : '';
    console.log(`  ${String(row.mhz).padStart(4)} МГц ← ${String(row.voltageMv).padStart(4)} мВ${edge}  · ${why}`);
  }

  if (Number.isFinite(expect) && expect !== hits.length) {
    console.error(`\nОТКАЗ: ждали ${expect} строк, посчитано ${hits.length}. Ничего не записано.`);
    return 2;
  }
  if (hits.length === 0) {
    console.log('\nМетить нечего — все такие строки уже помечены.');
    return 0;
  }

  for (const { row } of hits) row.tags = [...tagsOf(row), CURVE_TAGS.ORIGIN_UNWATCHED];

  const refusals = validateCurveDoc(doc);
  if (refusals.length > 0) {
    console.error('\nОТКАЗ: документ после правки не проходит проверку — ничего не записано:');
    for (const r of refusals.slice(0, 10)) console.error('  ·', r.field ?? '', r.why ?? r);
    return 3;
  }

  const after = acceptanceProgress(doc);
  console.log('\nПОСЛЕ ПРАВКИ:');
  console.log(renderDeliveryLine(after));
  console.log(`\nСДВИГ: краёв ${before.edges.total} -> ${after.edges.total} из ${after.total}`);

  if (!apply) {
    console.log('\nОСМОТР: ничего не записано. Записать — добавьте --apply');
    return 0;
  }

  if (!existsSync('runs')) mkdirSync('runs', { recursive: true });
  const backup = 'runs/measured.before-unwatched-marking.json';
  copyFileSync(curvePath(), backup);
  saveCurveDoc(doc);
  console.log(`\nЗАПИСАНО. Копия до правки: ${backup}`);
  console.log('Перепрожиг — понедельник, при владельце у машины (interviews/026 Q4: «но в понедельник»).');
  return 0;
}

if (process.argv[1] && entryResolve(process.argv[1]) === entryResolve(entryPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
