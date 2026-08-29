#!/usr/bin/env node
// automation-engine/lib/polygon-guards.mjs — СТОРОЖА ЧЕСТНОСТИ ПОЛИГОНА (эпик 67 фаза 4, plans/71
// шаги 1-3). ЧИСТЫЕ ФУНКЦИИ НАД УЛИКАМИ ПРОГОНА: ни карты, ни диска, ни часов.
//
// ─── ЧТО ЭТИ СТОРОЖА СУДЯТ, И ЧЕГО ОНИ НЕ СУДЯТ НИКОГДА ─────────────────────────────────────────
//
// Судят ЧЕСТНОСТЬ УТВЕРЖДЕНИЙ ЦИКЛА. НЕ судят «нашёл ли движок правильный край»: правильного края у
// вымысла нет, и полигон, который его проверяет, учит движок проходить вымысел вместо кремния
// (`researches/10`, риск №1 `plans/67`). Проверка формулировки каждого сторожа: он обязан быть
// осмысленным на карте БЕЗ пола, без дрейфа и без ловушечных ручек.
//
// ─── ПОЧЕМУ СТОРОЖА СМОТРЯТ В ДВА АРТЕФАКТА, А НЕ В ОДИН ────────────────────────────────────────
//
// Утверждение цикла живёт в ДОКУМЕНТЕ («2842 МГц закрыта: 800 мВ»), а то, что было на самом деле, —
// в ЖУРНАЛЕ упреждающей записи (вердикты ступеней с `servingMvAfter`). Сторож, читающий один
// артефакт, проверяет его на согласие с самим собой. `bugs/68` прожил ровно в зазоре между ними:
// журнал честно нёс выданные 1045 мВ, документ закрывал строку числом 800, и оба были «валидны».
//
// ─── ОПЛАЧЕННОЕ ПРОИСХОЖДЕНИЕ КАЖДОГО ИНВАРИАНТА ───────────────────────────────────────────────
//
//   И1 — `bugs/68` (обе половины): документ завышал доказанную глубину на 245-315 мВ.
//   И2 — `bugs/67` (ОТКРЫТ): трип предохранителя останавливает полосу, а прогон возвращает КОД 0.
//        Человек строку видит, скрипт и ночной прогон — нет.
//   И3 — журнал упреждающей записи: намерение без вердикта — это ЗАВИС, и он обязан быть закрыт
//        как зависание, а не потерян.
//   И4 — R13 / `bugs/11`: выше конверта карты ни одна поднятая точка ничего не предлагает.
//   И5 — инвариант I1 эпика 59: прогон на двойнике не смеет трогать живые артефакты.
//
// [TESTED: 2026-08-29 18:4x · --selftest, каждый сторож доказан КРАСНЫМ на подставной улике;
//  сторож И1 доказан на настоящих числах `bugs/68` (заказ 800 / выдача 1045).]

import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * УЛИКИ ОДНОГО ПРОГОНА — форма, которую собирает пакетный прогон (шаг 1 `plans/71`).
 * Собиратель НИЧЕГО не судит: разделение «собрать» и «судить» — это то, что позволяет доказать
 * сторожей красным дёшево, подставив улики вместо прогона.
 *
 * @typedef {{
 *   exitCode: number,
 *   journal: Array<object>,          // строки journal.jsonl, разобранные
 *   docRows: Array<object>,          // frequencies документа кривой
 *   reportLines: Array<string>,      // строки сводки прогона
 *   envelopeMhz: number|null,
 *   fingerprintBefore: object|null,  // отпечаток живых артефактов до прогона
 *   fingerprintAfter: object|null,
 * }} RunEvidence
 */

/** Общая форма вердикта сторожа. `ok:false` обязан нести УЛИКУ — строку, а не слово «нарушено». */
const verdict = (name, ok, why = null, evidence = null) => ({ name, ok, why, evidence });

// =================================================================================================
// И1 — ЗАКРЫТАЯ СТРОКА НЕ ГЛУБЖЕ ВЫДАННОГО
// =================================================================================================
/**
 * Документ не смеет утверждать глубину, которой кремний не испытывал.
 *
 * Формулировка ИНВАРИАНТНАЯ, а не «случай пола»: сравниваются напряжение закрытой строки и самое
 * глубокое напряжение, которое на этой частоте РЕАЛЬНО обслуживало прошедший прожиг. Пол карты —
 * лишь одна из причин разойтись; промах по сетке, дрейф таблицы и подстановка драйвера дают тот же
 * класс лжи, и сторож ловит их все, не зная о них.
 *
 * ⚠️ НАПРАВЛЕНИЕ ОДНО. Строка ВЫШЕ выданного — не нарушение: это консервативно (документ обещает
 * меньше, чем доказано). Красным становится только строка НИЖЕ выданного.
 */
export function guardClosedRowNotDeeperThanServed(ev) {
  const served = new Map();                       // частота → самое глубокое ПРОШЕДШЕЕ выданное
  for (const line of ev.journal ?? []) {
    if (line?.state !== 'verdict') continue;
    if (line.outcome !== 'passed') continue;      // отказ ничего не доказывает о глубине
    const f = line.frequencyMhz ?? line.mhz;
    const mv = line.servingMvAfter;
    if (!Number.isFinite(f) || !Number.isFinite(mv)) continue;
    served.set(f, Math.min(served.get(f) ?? Infinity, mv));
  }
  const bad = [];
  for (const row of ev.docRows ?? []) {
    const f = row?.mhz;
    const v = row?.voltageMv;
    if (!Number.isFinite(f) || !Number.isFinite(v)) continue;
    const deepest = served.get(f);
    if (!Number.isFinite(deepest)) continue;      // строка без прожига на этой частоте — не наш случай
    if (v < deepest) bad.push({ mhz: f, closedMv: v, servedMv: deepest, overstatedMv: deepest - v });
  }
  return bad.length === 0
    ? verdict('И1 закрытая строка не глубже выданного', true)
    : verdict('И1 закрытая строка не глубже выданного', false,
      `документ утверждает глубину, которой прожиг не видел: ${bad.length} строк(и), худшая — `
      + `${bad[0].mhz} МГц закрыта ${bad[0].closedMv} мВ при выданных ${bad[0].servedMv} мВ `
      + `(завышение ${bad[0].overstatedMv} мВ)`, bad);
}

// =================================================================================================
// И2 — СТОП ИМЕНОВАН, И КОД ВЫХОДА ЕМУ НЕ ПРОТИВОРЕЧИТ
// =================================================================================================
/**
 * `bugs/67` дословно: полоса остановлена, строка об этом в логе есть, а прогон вернул 0. Человек
 * видит, скрипт — нет, и ночной прогон считает такую карту пройденной.
 *
 * Сторож судит СОГЛАСИЕ двух свидетельств, а не наличие одного: код выхода и слова отчёта.
 */
export function guardStopIsNamedAndExitCodeAgrees(ev, stopMarkers = DEFAULT_STOP_MARKERS) {
  const lines = ev.reportLines ?? [];
  const hit = lines.find((l) => stopMarkers.some((m) => String(l).includes(m))) ?? null;
  const code = ev.exitCode;
  if (hit && code === 0) {
    return verdict('И2 стоп именован и код выхода согласен', false,
      `прогон объявил остановку и вернул КОД 0 — скрипт и ночной прогон считают такую карту `
      + `пройденной (bugs/67). Строка: «${String(hit).trim().slice(0, 160)}»`, { exitCode: code, line: hit });
  }
  if (!hit && code !== 0) {
    return verdict('И2 стоп именован и код выхода согласен', false,
      `прогон вернул КОД ${code}, но НИ ОДНА строка отчёта не называет причину — отказ без имени `
      + 'нельзя ни воспроизвести, ни сжать', { exitCode: code });
  }
  return verdict('И2 стоп именован и код выхода согласен', true);
}

/** Слова, которыми прогон объявляет остановку. Список ЗАКРЫТ и живёт здесь одним местом. */
export const DEFAULT_STOP_MARKERS = Object.freeze([
  'ОСТАНОВЛЕН', 'СТОП', 'ПРЕДОХРАНИТЕЛЬ СРАБОТАЛ', 'ТРИП', 'ОТВЕРГ ЗАПИСЬ', 'АВАРИЙНАЯ',
]);

// =================================================================================================
// И3 — ЖУРНАЛ ЦЕЛ: НИ ОДНОГО НАМЕРЕНИЯ БЕЗ ВЕРДИКТА
// =================================================================================================
/**
 * Намерение без вердикта — это ЗАВИС (журнал упреждающей записи существует ровно ради него), и
 * следующий запуск обязан закрыть его как зависание. Внутри ОДНОГО завершённого прогона открытых
 * намерений быть не должно: если они есть, прогон потерял ступень молча.
 */
export function guardJournalHasNoOpenIntent(ev) {
  const intents = new Set();
  const closed = new Set();
  for (const line of ev.journal ?? []) {
    if (line?.state === 'intent' && Number.isFinite(line.seq)) intents.add(line.seq);
    if (line?.state === 'verdict' && Number.isFinite(line.seq)) closed.add(line.seq);
  }
  const open = [...intents].filter((s) => !closed.has(s));
  return open.length === 0
    ? verdict('И3 журнал цел', true)
    : verdict('И3 журнал цел', false,
      `намерений без вердикта: ${open.length} (seq ${open.slice(0, 5).join(', ')}) — ступень потеряна молча`,
      open);
}

// =================================================================================================
// И4 — КОНВЕРТ КАРТЫ НЕ ПРЕВЫШЕН
// =================================================================================================
/** R13 / `bugs/11`: выше конверта ни одна поднятая точка ничего не предлагает — ни в документе, ни в выдаче. */
export function guardEnvelopeNotExceeded(ev) {
  const cap = ev.envelopeMhz;
  if (!Number.isFinite(cap)) return verdict('И4 конверт не превышен', true, null, { skipped: 'конверт не назван' });
  const over = [];
  for (const row of ev.docRows ?? []) {
    if (Number.isFinite(row?.mhz) && row.mhz > cap) over.push({ where: 'документ', mhz: row.mhz });
  }
  for (const line of ev.journal ?? []) {
    if (line?.state !== 'verdict') continue;
    if (Number.isFinite(line.deliveredMhz) && line.deliveredMhz > cap) {
      over.push({ where: 'выдача', mhz: line.deliveredMhz });
    }
  }
  return over.length === 0
    ? verdict('И4 конверт не превышен', true)
    : verdict('И4 конверт не превышен', false,
      `конверт ${cap} МГц превышен ${over.length} раз(а), первое — ${over[0].where} ${over[0].mhz} МГц`, over);
}

// =================================================================================================
// И5 — ЖИВЫЕ АРТЕФАКТЫ НЕ ТРОНУТЫ
// =================================================================================================
/**
 * Инвариант I1 эпика 59. ⚠️ ОТСУТСТВИЕ ОТПЕЧАТКА — КРАСНЫЙ, А НЕ ПРОПУСК: сторож, который молча
 * зеленеет, когда его не о чем спросить, — это способ не заметить, что его перестали кормить.
 */
export function guardLiveArtefactsUntouched(ev) {
  const a = ev.fingerprintBefore;
  const b = ev.fingerprintAfter;
  if (!a || !b) {
    return verdict('И5 живые артефакты не тронуты', false,
      'отпечаток живых артефактов не снят — прогон нечем оправдать');
  }
  const same = JSON.stringify(a) === JSON.stringify(b);
  return same
    ? verdict('И5 живые артефакты не тронуты', true)
    : verdict('И5 живые артефакты не тронуты', false,
      'отпечаток живых артефактов ИЗМЕНИЛСЯ за прогон на двойнике', { before: a, after: b });
}

/** Все пятеро, в порядке плана. Класс отказа карты = ИМЯ первого покрасневшего сторожа. */
export const GUARDS = Object.freeze([
  guardClosedRowNotDeeperThanServed,
  guardStopIsNamedAndExitCodeAgrees,
  guardJournalHasNoOpenIntent,
  guardEnvelopeNotExceeded,
  guardLiveArtefactsUntouched,
]);

/** Прогнать всех. Возвращает { ok, failures, verdicts } — класс отказа берётся из `failures[0].name`. */
export function judgeRun(ev) {
  const verdicts = GUARDS.map((g) => g(ev));
  const failures = verdicts.filter((v) => !v.ok);
  return { ok: failures.length === 0, failures, verdicts };
}

// =================================================================================================
// САМОПРОВЕРКА — каждый сторож доказан КРАСНЫМ, иначе он не сторож
// =================================================================================================
function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('САМОПРОВЕРКА polygon-guards — чистые функции над уликами; ни карты, ни диска, ни часов');
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона: направление сравнения И1 · согласие кода в И2 · «нет отпечатка = красный» в И5');

  // ─── ЗДОРОВЫЙ ПРОГОН: все пятеро молчат ─────────────────────────────────────────────────────
  const healthy = {
    exitCode: 0,
    journal: [
      { state: 'intent', seq: 1 },
      { state: 'verdict', seq: 1, outcome: 'passed', frequencyMhz: 2842, servingMvAfter: 1045, deliveredMhz: 2842 },
    ],
    docRows: [{ mhz: 2842, voltageMv: 1045 }],
    reportLines: ['ПОКРЫТИЕ: закрыто 1 из 1 (100 %)'],
    envelopeMhz: 3090,
    fingerprintBefore: { doc: 'aaa' }, fingerprintAfter: { doc: 'aaa' },
  };
  ok('здоровый прогон: все пятеро зелёные', judgeRun(healthy).ok === true,
    judgeRun(healthy).failures.map((f) => f.name).join(', '));

  // ─── И1 НА НАСТОЯЩИХ ЧИСЛАХ `bugs/68` ───────────────────────────────────────────────────────
  // Не выдуманная фикстура: ровно то, что печатал прогон seed 42 до починки.
  const b68 = { ...healthy, docRows: [{ mhz: 2842, voltageMv: 800 }] };
  const r68 = guardClosedRowNotDeeperThanServed(b68);
  ok('И1 КРАСНЕЕТ на числах bugs/68: закрыто 800 при выданных 1045 (завышение 245)',
    r68.ok === false && r68.evidence?.[0]?.overstatedMv === 245, r68.why ?? '');
  ok('И1 НЕ краснеет в обратную сторону: строка ВЫШЕ выданного консервативна, а не лжива',
    guardClosedRowNotDeeperThanServed({ ...healthy, docRows: [{ mhz: 2842, voltageMv: 1100 }] }).ok === true);
  // ⚠️ ФИКСТУРА ПОДОБРАНА ТАК, ЧТОБЫ СНЯТИЕ ФИЛЬТРА ДАВАЛО ЛОЖНУЮ ТРЕВОГУ, а не совпадало с
  // правильным ответом. Две первые редакции фикстуры мутацию «считать и отказы» НЕ ловили, и
  // вторая промахнулась по направлению оси: «глубже» — это НИЖЕ по напряжению. Ложную тревогу даёт
  // отказавшая ступень, обслуженная ВЫШЕ строки: без фильтра сторож посчитал бы 1045 доказанным и
  // объявил строку 1000 завышением, которого нет. Прожиг там ОТКАЗАЛ и не доказал ничего.
  ok('И1 не судит по ОТКАЗАВШИМ ступеням: провал ничего не доказывает о глубине',
    guardClosedRowNotDeeperThanServed({
      ...healthy,
      journal: [
        { state: 'intent', seq: 1 },
        { state: 'verdict', seq: 1, outcome: 'failed', frequencyMhz: 2842, servingMvAfter: 1045 },
      ],
      docRows: [{ mhz: 2842, voltageMv: 1000 }],
    }).ok === true);

  // ─── И2 НА СЛУЧАЕ `bugs/67` ─────────────────────────────────────────────────────────────────
  const b67 = { ...healthy, reportLines: ['ПРЕДОХРАНИТЕЛЬ СРАБОТАЛ: полоса ОСТАНОВЛЕН'], exitCode: 0 };
  ok('И2 КРАСНЕЕТ на случае bugs/67: остановка объявлена, а код 0',
    guardStopIsNamedAndExitCodeAgrees(b67).ok === false);
  ok('И2 КРАСНЕЕТ и в обратную сторону: код не 0, а причина не названа',
    guardStopIsNamedAndExitCodeAgrees({ ...healthy, exitCode: 3 }).ok === false);
  ok('И2 зелен, когда код и слова согласны (остановка + ненулевой код)',
    guardStopIsNamedAndExitCodeAgrees({ ...b67, exitCode: 3 }).ok === true);

  // ─── И3 · И4 · И5 ───────────────────────────────────────────────────────────────────────────
  ok('И3 КРАСНЕЕТ на намерении без вердикта',
    guardJournalHasNoOpenIntent({ ...healthy, journal: [...healthy.journal, { state: 'intent', seq: 2 }] }).ok === false);
  ok('И4 КРАСНЕЕТ на строке документа выше конверта',
    guardEnvelopeNotExceeded({ ...healthy, docRows: [{ mhz: 3200, voltageMv: 1045 }] }).ok === false);
  ok('И4 КРАСНЕЕТ и на ВЫДАЧЕ выше конверта, не только на документе',
    guardEnvelopeNotExceeded({
      ...healthy,
      journal: [{ state: 'verdict', seq: 1, outcome: 'passed', frequencyMhz: 2842, servingMvAfter: 1045, deliveredMhz: 3200 }],
    }).ok === false);
  ok('И5 КРАСНЕЕТ на изменившемся отпечатке',
    guardLiveArtefactsUntouched({ ...healthy, fingerprintAfter: { doc: 'bbb' } }).ok === false);
  ok('И5 КРАСНЕЕТ на ОТСУТСТВУЮЩЕМ отпечатке — молчаливая зелень тут запрещена',
    guardLiveArtefactsUntouched({ ...healthy, fingerprintBefore: null }).ok === false);

  // ─── КЛАСС ОТКАЗА = ИМЯ СТОРОЖА (P71-AC3) ───────────────────────────────────────────────────
  ok('класс отказа карты — ИМЯ сторожа, а не «что-то сломалось» (P71-AC3)',
    judgeRun(b68).failures[0]?.name === 'И1 закрытая строка не глубже выданного',
    judgeRun(b68).failures[0]?.name ?? 'нет отказа');

  console.log(`ИТОГ: блоков ${pass + fail}, зелёных ${pass}, красных ${fail}`);
  return fail === 0 ? 0 : 1;
}

// ⚠️ ВХОД СРАВНИВАЕТ ПУТЬ С СОБСТВЕННЫМ URL, А НЕ С ИМЕНЕМ ФАЙЛА. Первая редакция стояла на
// `endsWith('polygon-guards.mjs')` — и ВСЕ ПЯТЬ мутантов молча не запускали набор вовсе: копия под
// другим именем переставала быть собой. Мутационная проверка, у которой мутант ничего не печатает,
// читается как «мутация не поймана», и это ровно тот способ обмануть самого себя, ради которого
// мутации и гоняют. Канон проекта на этот случай уже был (`card-generator.mjs`) — взят он.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
    && process.argv.includes('--selftest')) {
  process.exit(cmdSelftest());
}
