#!/usr/bin/env node
/**
 * СТОРОЖ СОГЛАСИЯ ИМЕНИ ФАЙЛА И СТРОКИ СТАТУСА — `bugs/25` пункт 4 плана починки.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ЗАЧЕМ ОН, ЕСЛИ ЕСТЬ `/check-backlog`
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * `bugs/25` заведён 2026-08-21 по классу «репозиторий и список говорят разное»: тег `DONE` в имени
 * файла и строка статуса ВНУТРИ него расходятся, и беклог считается из обоих. Его же план починки
 * назвал лекарство пунктом 4 — *«дешёвая проверка согласия: грепать non-DONE шапки на `✅|DONE`, а
 * DONE-файлы на `OPEN`, чтобы две правды не разошлись молча»*. Пункт не исполнялся с 21 августа.
 *
 * 🔴 ЗА ЭТО ВРЕМЯ КЛАСС ВОЗВРАЩАЛСЯ ТРИЖДЫ, И КАЖДЫЙ РАЗ ЕГО НАХОДИЛИ ГЛАЗАМИ:
 * ревизия сессии 65 (58 открытых планов машинным триажем, подтвердились единицы), ревизия сессии 68
 * (археология трёх предметов), и 2026-09-07 — четыре закрытых тикета в списке «Открытые баги»
 * `STATUS.md`, замеченные при сверке имён файлов. Правило, живущее в прозе, не работает: ровно то,
 * чему проект уже научился на декларации угроз (`plans/75`) и на месте вопросов (`bugs/74`).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ЧЕГО ЭТОТ СТОРОЖ НЕ ДЕЛАЕТ, И ЭТО ГЛАВНОЕ В ЕГО УСТРОЙСТВЕ
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * **Он НЕ решает, закрыт предмет или нет.** Урок сессии 65, оплаченный ложным триажем: *«маркер ✅
 * внутри документа чаще всего относится к ОДНОМУ ШАГУ, а не к предмету целиком»*; источник истины —
 * строка РОДИТЕЛЯ или прогон, а не маркер. Поэтому сторож смотрит РОВНО на одно: согласны ли между
 * собой ДВА СИГНАЛА, по которым считается беклог, — тег в имени файла и СТРОКА СТАТУСА документа.
 * Разошлись — это находка, кто из них прав, решает человек или разбор.
 *
 * **Он смотрит на СТРОКУ СТАТУСА, а не на шапку целиком.** Первая редакция этого сторожа читала
 * первые 12 строк и дала 35 «нарушений», из которых почти все были ложными: в шапке эпика ✅ стоит
 * у закрытых ФАЗ, пока сам эпик открыт. Сузив до строки `**Статус:**`, получили 23 — и это уже
 * настоящие расхождения. Замерено, а не выбрано.
 *
 * **Словари обоих состояний ОБОЮДНЫЕ.** Строка «фазы 1 и 2 закрыты, открыта фаза 3» несёт ОБА
 * слова и нарушением НЕ является: предмет живёт дальше. Нарушение — когда строка говорит ТОЛЬКО
 * одно, а имя файла ТОЛЬКО другое.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * БАЗА ДОЛГА — ТОЛЬКО УБЫВАЕТ (форма `bugs/95` → `entry-guard-lint`)
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * На день заведения расхождений 23. Покраснеть на всех сразу значило бы отдать проекту красное
 * дерево и научить его игнорировать сторожа — это не сторож, а шум. Поэтому известные расхождения
 * лежат в `decisions/backlog-truth-baseline.json`, и правило одно: **новое расхождение — КРАСНЫЙ,
 * починенное и оставшееся в базе — тоже КРАСНЫЙ.** База может только сокращаться.
 *
 * @guard backlog-truth · УГРОЗА: две правды о состоянии предмета расходятся молча, и беклог
 *        считается из обеих — агент переделывает сделанное или считает открытое закрытым.
 *        КРАСНЕЕТ: новым расхождением или устаревшей строкой базы. ЗАМЕР: 23 на 2026-09-07.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const BASELINE = join(ROOT, 'decisions', 'backlog-truth-baseline.json');

/**
 * Словари состояний. ОБОЮДНОСТЬ намеренная: строка, несущая оба, — законная («фазы закрыты, открыта
 * следующая»), и сторож её пропускает. Ловится только ОДНОЗНАЧНОЕ расхождение.
 */
export const OPEN_WORDS = /🔴|🟠|\bOPEN\b|ОТКРЫТ|Открыт|открыт|в работе|В РАБОТЕ|ЖДЁТ|ждёт/u;
export const DONE_WORDS = /✅|\bDONE\b|ЗАКРЫТ|Закрыт|закрыт|ПОЧИНЕН|Починен/u;

/** Строка статуса — первая в шапке, начинающаяся с `**Статус:**` или `**Status:**` (можно в цитате). */
export function statusLineOf(text) {
  for (const l of String(text ?? '').split(/\r?\n/u).slice(0, 14)) {
    if (/^\s*>?\s*\*\*(Статус|Status)\s*:?\*\*/u.test(l)) return l;
  }
  return null;
}

/**
 * Вердикт по ОДНОМУ документу. Чистая функция: имя и текст приходят снаружи, диск не трогается —
 * решение проверяется фикстурами без дерева.
 *
 * @returns {{kind:'ok'|'done-tag-open-line'|'no-tag-done-line'|'no-status-line', line:string|null}}
 */
export function judgeDoc(fileName, text) {
  const line = statusLineOf(text);
  if (line === null) return { kind: 'no-status-line', line: null };
  const tagged = /_DONE_/u.test(fileName);
  const saysOpen = OPEN_WORDS.test(line);
  const saysDone = DONE_WORDS.test(line);
  // Оба слова — законная строка живого предмета с закрытыми частями. Ни одного — сторож молчит:
  // он не выдумывает состояние там, где документ его не называет.
  if (saysOpen === saysDone) return { kind: 'ok', line };
  if (tagged && saysOpen) return { kind: 'done-tag-open-line', line };
  if (!tagged && saysDone) return { kind: 'no-tag-done-line', line };
  return { kind: 'ok', line };
}

export function scanTree(root = ROOT) {
  const out = [];
  for (const dir of ['bugs', 'plans']) {
    const d = join(root, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith('.md') || f === 'README.md') continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) continue;
      const v = judgeDoc(f, readFileSync(p, 'utf8'));
      if (v.kind !== 'ok' && v.kind !== 'no-status-line') out.push({ id: `${dir}/${f}`, kind: v.kind });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function loadBaseline() {
  try { return JSON.parse(readFileSync(BASELINE, 'utf8')); } catch { return { known: [] }; }
}

export function compare(found, baseline) {
  const known = new Set((baseline.known ?? []).map((k) => k.id));
  const now = new Set(found.map((f) => f.id));
  return {
    fresh: found.filter((f) => !known.has(f.id)),
    stale: [...known].filter((id) => !now.has(id)).sort(),
  };
}

function main(argv) {
  const found = scanTree();
  if (argv.includes('--freeze')) {
    writeFileSync(BASELINE, `${JSON.stringify({
      why: 'Известные расхождения имени файла и строки статуса на день заведения сторожа (bugs/25 п.4). '
        + 'База ТОЛЬКО УБЫВАЕТ: починил — убери строку, иначе сторож краснеет на устаревшей.',
      measuredAt: '2026-09-07',
      known: found,
    }, null, 2)}\n`, 'utf8');
    console.log(`БАЗА ДОЛГА ЗАПИСАНА: ${found.length} расхождени(я/й) → ${BASELINE}`);
    return 0;
  }
  const { fresh, stale } = compare(found, loadBaseline());
  if (argv.includes('--report')) {
    for (const f of found) console.log(`  ${f.kind === 'done-tag-open-line' ? 'тег DONE ↔ строка ОТКРЫТ' : 'без тега ↔ строка ЗАКРЫТ'}  ${f.id}`);
  }
  for (const f of fresh) {
    console.error(`НОВОЕ РАСХОЖДЕНИЕ: ${f.id}`);
    console.error(f.kind === 'done-tag-open-line'
      ? '       имя файла помечено DONE, а строка статуса говорит, что предмет открыт.'
      : '       имя файла без тега DONE, а строка статуса говорит, что предмет закрыт.');
    console.error('       Беклог считается из ОБОИХ сигналов — разойдясь, они заставят следующую сессию');
    console.error('       переделывать сделанное или считать открытое закрытым (`bugs/25`).');
    console.error('       Лечение: привести в согласие ТО, ЧТО ВЕРНО, — а верное решает разбор, не сторож.');
  }
  for (const id of stale) {
    console.error(`УСТАРЕВШАЯ СТРОКА БАЗЫ: ${id} — расхождения больше нет, убери её из ${BASELINE}.`);
    console.error('       База долга ТОЛЬКО УБЫВАЕТ: починенное, оставшееся в ней, прячет следующее.');
  }
  console.log(`СОГЛАСИЕ БЕКЛОГА (bugs/25 п.4): расхождений ${found.length} · новых ${fresh.length} · в долге ${found.length - fresh.length} · устаревших строк базы ${stale.length}`);
  return fresh.length + stale.length > 0 ? 1 : 0;
}

export function selfTest() {
  const r = [];
  const ok = (what, cond, detail = '') => r.push({ ok: Boolean(cond), what, detail });
  const S = (line) => `# Bug 1 — x\n\n**Статус:** ${line}\n`;

  ok('строка статуса найдена в шапке', statusLineOf(S('🔴 ОТКРЫТ')) !== null,
    `нашли: ${statusLineOf(S('🔴 ОТКРЫТ'))}`);
  ok('строка статуса в ЦИТАТЕ тоже находится — планы пишут её так',
    statusLineOf('# П\n\n> **Status:** 🟢 open\n') !== null, 'форма планов');
  ok('нет строки статуса — сторож МОЛЧИТ, а не выдумывает состояние',
    judgeDoc('7_x.md', '# Просто документ\n\nтекст\n').kind === 'no-status-line');

  ok('DONE в имени + строка говорит ТОЛЬКО открыт → расхождение',
    judgeDoc('20_DONE_x.md', S('🔴 OPEN')).kind === 'done-tag-open-line');
  ok('без тега + строка говорит ТОЛЬКО закрыт → расхождение',
    judgeDoc('63_x.md', S('✅ ЗАКРЫТ 2026-08-30')).kind === 'no-tag-done-line');
  // 🔴 ГЛАВНАЯ СТРОКА НАБОРА. Без неё сторож краснел бы на каждом живом эпике, и его бы выключили.
  ok('строка с ОБОИМИ словами законна: «фазы 1 и 2 закрыты, открыта фаза 3»',
    judgeDoc('43_EPIC_x.md', S('🟢 ФАЗЫ 1 И 2 ЗАКРЫТЫ. Открыта ФАЗА 3')).kind === 'ok');
  ok('и в обратную сторону: DONE-файл, чья строка говорит про закрытие, — не расхождение',
    judgeDoc('70_DONE_x.md', S('✅ ЗАКРЫТ 2026-08-30')).kind === 'ok');
  ok('строка без слов состояния вовсе — молчание, а не догадка',
    judgeDoc('9_x.md', S('план на завтра')).kind === 'ok');

  const base = { known: [{ id: 'bugs/1_x.md', kind: 'no-tag-done-line' }] };
  const cmpNew = compare([{ id: 'bugs/2_y.md', kind: 'no-tag-done-line' }], base);
  ok('НОВОЕ расхождение отделено от долга — краснеет только оно',
    cmpNew.fresh.length === 1 && cmpNew.fresh[0].id === 'bugs/2_y.md',
    `новых ${cmpNew.fresh.length}`);
  ok('и починенная строка базы объявляется УСТАРЕВШЕЙ — база только убывает',
    cmpNew.stale.length === 1 && cmpNew.stale[0] === 'bugs/1_x.md',
    `устаревших ${cmpNew.stale.length}`);
  const cmpSame = compare([{ id: 'bugs/1_x.md', kind: 'no-tag-done-line' }], base);
  ok('расхождение, стоящее в базе, НЕ краснеет — иначе дерево красное и сторожа выключат',
    cmpSame.fresh.length === 0 && cmpSame.stale.length === 0);

  for (const x of r) console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok || !x.detail ? '' : `  -> ${x.detail}`}`);
  const failed = r.filter((x) => !x.ok).length;
  console.log(`\nСОГЛАСИЕ БЕКЛОГА: ${r.length} блоков, провалов ${failed}.`);
  return { blocks: r.length, failed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--selftest')) process.exit(selfTest().failed ? 1 : 0);
  process.exit(main(process.argv.slice(2)));
}
