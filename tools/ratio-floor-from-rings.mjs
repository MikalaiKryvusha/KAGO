// ratio-floor-from-rings.mjs — ПОЛ ЛОЖНЫХ СРАБАТЫВАНИЙ ВХОДА 3, СЧИТАННЫЙ С КОЛЕЦ СУДЬИ.
//
// `plans/94` шаг 6 (P94-AC3, P94-AC4). Заказ фазы 6б-бис: «эпизоды ниже порога, их длительность и
// глубина, РАЗДЕЛЬНО ПО СОСТОЯНИЮ ГОРНА — и только потом выводить число».
//
// 🔴 ЧЕМ ЭТОТ ПРИБОР ОТЛИЧАЕТСЯ ОТ `tools/power-collapse-floor.mjs`, И ПОЧЕМУ ОН ОТДЕЛЬНЫЙ.
//
// Тот считает долю по АРХИВУ прожигов: «дно после пика / пик» по пробам `nvidia-smi`, снятым раз в
// секунду, усреднённым внутри прожига. Его замер дал 0,412 — и `bugs/125` этот замер ОТМЕНИЛ:
// судью кормят МГНОВЕННЫМ значением мощности, приходящим ударом пробы каждые 2 мс, а порог был
// выведен из СЕКУНДНОГО СРЕДНЕГО. Две разные величины под одним именем — класс `bugs/124`.
//
// Здесь величина ровно та, которой судит судья: `powerRatio` из его собственного кольца, где
// `peakMw` — бегущий пик того же потока, а не среднее. Поэтому прибор отдельный, а не режим
// соседнего: держать две несовместимые величины в одном месте и значит завести пару, которая
// разойдётся при первой правке.
//
// ⚠️ ЧТО ЭТОТ ПРИБОР НЕ ДЕЛАЕТ. Он НЕ выводит уставку. По ЧИСТЫМ записям (без единой смерти) он
// может дать только ПОЛ ЛОЖНЫХ: насколько глубоко и надолго доля проваливается, когда всё
// в порядке. Порог обнаружения из них не выводится — для него нужна запись, где карта
// действительно встала. Это записано в границах фазы ДО работы и повторено здесь, чтобы число
// отсюда не поехало в предохранитель под видом порога.
//
// Использование:
//   node tools/ratio-floor-from-rings.mjs <кольцо.jsonl> [ещё кольца...] [--hold 500]

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Пик обязан состояться — иначе делить не на что (тот же довод и то же число, что у входа 3). */
export const ESTABLISHED_MW = 150_000;

/**
 * 🔴 «ПРОВОД ПРОВЕДЁН» ≠ «ГОРН ИДЁТ ПРЯМО СЕЙЧАС», И ПЕРВЫЙ ЖЕ ПРОГОН ЭТОГО ПРИБОРА ПОКАЗАЛ РАЗНИЦУ.
 *
 * `progressWired` в судье поднимается первым ударом `0x02` и БОЛЬШЕ НЕ ГАСНЕТ до перевзведения —
 * он отвечает на вопрос «проведён ли источник», а не «работает ли он». Прибор, спросивший его о
 * втором, получил в обеих чистых записях по одному «провалу доли» длиной 15 048 и 15 000 мс с
 * глубиной 0,12-0,14 — и это был ХВОСТ ПОСЛЕ ГОРНА: карта честно ушла в покой, а флаг остался.
 * Записи длиной 90 с несут ровно 15 с такого хвоста, и числа совпали с ним до миллисекунды.
 *
 * Свидетель «горн идёт» берётся не у флага, а у величины: СВЕЖЕСТЬ последнего продвижения
 * прогресса. Такт прожига измерен — 330,68 мс на 2820 МГц, уставка входа 2 берёт три таких такта
 * (M = 1177 мс). Здесь тот же порядок и то же обоснование: молчание дольше секунды означает, что
 * прожиг уже не идёт, чем бы ни был поднят флаг.
 */
export const FRESH_PROGRESS_MS = 1000;

/** Идёт ли прожиг В ЭТОТ ТАКТ — по свежести прогресса, а не по флагу проведённости. */
export function isBurning(row, freshMs = FRESH_PROGRESS_MS) {
  const s = row.progressSilenceMs;
  return s !== null && s !== undefined && s <= freshMs;
}

/**
 * ЭПИЗОДЫ ПРОВАЛА ДОЛИ — с тем же разделением, которым живёт сам судья.
 *
 * Эпизод — непрерывная череда тактов, где доля ≤ порога. Он ЗАКРЫВАЕТСЯ первым тактом выше порога
 * либо погасшим проводом входа 2: «прожига нет» и «доля низка» — разные факты, и складывать их в
 * один эпизод значило бы приписывать простою глубину рабочего провала.
 *
 * @param {Array<object>} rows строки кольца (`t`, `powerRatio`, `powerMw`, `progressSilenceMs`)
 * @param {number} ratio порог, ниже которого такт считается провалом
 * @returns {Array<{fromMs:number,toMs:number,ms:number,minRatio:number,ticks:number,wired:boolean}>}
 */
export function dipEpisodes(rows, ratio, freshMs = FRESH_PROGRESS_MS) {
  const out = [];
  let cur = null;
  const close = () => { if (cur && cur.ticks > 0) out.push(cur); cur = null; };
  for (const r of rows) {
    const wired = isBurning(r, freshMs);
    const v = r.powerRatio;
    const low = wired && v !== null && v !== undefined && v <= ratio;
    if (!low) { close(); continue; }
    if (cur === null) cur = { fromMs: r.t, toMs: r.t, ms: 0, minRatio: v, ticks: 0, wired };
    cur.toMs = r.t;
    cur.ms = cur.toMs - cur.fromMs;
    cur.ticks += 1;
    if (v < cur.minRatio) cur.minRatio = v;
  }
  close();
  return out;
}

/** Сводка записи: сколько тактов под пиком, какова самая глубокая и самая долгая просадка. */
export function ringSummary(rows) {
  const wired = rows.filter((r) => isBurning(r));
  const withRatio = wired.filter((r) => r.powerRatio !== null && r.powerRatio !== undefined);
  const established = withRatio.filter((r) => (r.powerMw ?? 0) >= 0);
  const ratios = withRatio.map((r) => r.powerRatio);
  const sorted = [...ratios].sort((a, b) => a - b);
  const at = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
  return {
    ticks: rows.length,
    wired: wired.length,
    withRatio: withRatio.length,
    established: established.length,
    minRatio: sorted[0] ?? null,
    p01: at(0.01),
    p05: at(0.05),
    median: at(0.5),
  };
}

/**
 * Собственные блоки прибора. Фикстуры, ни одного боевого кольца.
 *
 * Судится ровно то, на чём прибор УЖЕ ошибся один раз: разделение «провод проведён» и «горн идёт».
 * Блок с хвостом после горна краснеет на прежней версии — она считала хвост провалом под нагрузкой
 * и выдавала просадку в 15 секунд, которой не было.
 */
function selfTest() {
  const results = [];
  const ok = (name, cond, detail = '') => {
    results.push(cond);
    console.log(`  ${cond ? '✅' : '❌'} ${name}${cond || !detail ? '' : ` — ${detail}`}`);
  };
  console.log('САМОПРОВЕРКА ПОЛА ЛОЖНЫХ ПО КОЛЬЦАМ:');

  // Хвост после горна: прогресс молчит и растёт, доля низка. Это НЕ провал под нагрузкой.
  const tail = [];
  for (let i = 0; i < 1000; i += 1) tail.push({ t: i * 2, powerRatio: 0.13, powerMw: 40_000, progressSilenceMs: 1200 + i * 2 });
  ok('хвост после горна НЕ считается провалом под нагрузкой (иначе 15 с ложной просадки, оплачено 09.09)',
    dipEpisodes(tail, 0.412).length === 0, `эпизодов ${dipEpisodes(tail, 0.412).length}`);

  // Настоящий провал ПОД нагрузкой: прогресс свежий, доля низка.
  const dip = [];
  for (let i = 0; i < 400; i += 1) dip.push({ t: i * 2, powerRatio: i >= 100 && i < 300 ? 0.2 : 0.9, powerMw: 60_000, progressSilenceMs: 40 });
  const eps = dipEpisodes(dip, 0.412);
  ok('провал ПРИ свежем прогрессе виден, и его длительность считается по краям эпизода',
    eps.length === 1 && Math.round(eps[0].ms) === 398, JSON.stringify(eps.map((e) => Math.round(e.ms))));
  ok('глубина эпизода — САМОЕ НИЗКОЕ значение внутри него, а не первое',
    eps.length === 1 && eps[0].minRatio === 0.2, JSON.stringify(eps[0]?.minRatio));

  // Граница свежести названа числом и проверяется с обеих сторон.
  ok('граница свежести: 1000 мс молчания — ещё горн, 1002 мс — уже нет',
    isBurning({ progressSilenceMs: 1000 }) === true && isBurning({ progressSilenceMs: 1002 }) === false);
  ok('непроведённый провод не считается горном ни при какой доле',
    isBurning({ progressSilenceMs: null }) === false && dipEpisodes([{ t: 0, powerRatio: 0.01, progressSilenceMs: null }], 0.5).length === 0);

  const bad = results.filter((x) => !x).length;
  console.log(`\nИТОГ: ${results.length - bad} зелёных, ${bad} красных.`);
  return bad === 0 ? 0 : 1;
}

function main(argv) {
  if (argv.includes('--help')) {
    console.log('ratio-floor-from-rings — ПОЛ ЛОЖНЫХ входа 3 по кольцам судьи (plans/94 шаг 6).');
    console.log('  node tools/ratio-floor-from-rings.mjs <кольцо.jsonl> [ещё кольца...] [--hold 500]');
    console.log('  --hold МС   выдержка провала, при которой срабатывание считается состоявшимся (по умолчанию 500)');
    console.log('  --selftest  собственные блоки прибора на фикстурах, без чтения боевых колец');
    console.log('НЕ выводит уставку: по записям без смерти выводится только пол ЛОЖНЫХ (границы фазы 6б-бис).');
    console.log('Отличие от tools/power-collapse-floor.mjs — величина: там среднее по прожигу из архива');
    console.log('nvidia-smi (замер отменён bugs/125), здесь — мгновенная доля из кольца, которой судит судья.');
    return 0;
  }
  if (argv.includes('--selftest')) return selfTest();
  const files = argv.filter((a) => !a.startsWith('--'));
  const holdIdx = argv.indexOf('--hold');
  const holdMs = holdIdx !== -1 && argv[holdIdx + 1] ? Number(argv[holdIdx + 1]) : 500;
  if (files.length === 0) {
    console.log('Использование: node tools/ratio-floor-from-rings.mjs <кольцо.jsonl> [...] [--hold 500]');
    console.log('Читает кольца судьи и печатает ПОЛ ЛОЖНЫХ по доле мощности. Уставку НЕ выводит.');
    return 1;
  }
  const CANDIDATES = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.412, 0.45, 0.5, 0.6, 0.7];
  let worstAcross = null;

  for (const f of files) {
    const rows = fs.readFileSync(f, 'utf8').trim().split(/\r?\n/u).map((l) => JSON.parse(l));
    const s = ringSummary(rows);
    console.log(`\n=== ${f}`);
    console.log(`тактов ${s.ticks} · ГОРН ИДЁТ (прогресс свежее ${FRESH_PROGRESS_MS} мс) ${s.wired} · доля посчитана ${s.withRatio}`);
    console.log(`доля: минимум ${s.minRatio} · p01 ${s.p01} · p05 ${s.p05} · медиана ${s.median}`);
    console.log(`порог │ эпизодов │ самый долгий │ самый глубокий │ эпизодов ≥ ${holdMs} мс`);
    for (const c of CANDIDATES) {
      const eps = dipEpisodes(rows, c);
      const longest = eps.reduce((a, b) => (a === null || b.ms > a.ms ? b : a), null);
      const deepest = eps.reduce((a, b) => (a === null || b.minRatio < a.minRatio ? b : a), null);
      const overHold = eps.filter((e) => e.ms >= holdMs);
      console.log(`${String(c).padStart(5)} │ ${String(eps.length).padStart(8)} │ ${String(longest ? `${Math.round(longest.ms)} мс` : '—').padStart(12)} │ ${String(deepest ? deepest.minRatio : '—').padStart(14)} │ ${overHold.length}`);
      if (overHold.length > 0) {
        const w = overHold.reduce((a, b) => (a === null || b.ms > a.ms ? b : a), null);
        if (worstAcross === null || c > worstAcross.ratio || (c === worstAcross.ratio && w.ms > worstAcross.ms)) {
          worstAcross = { ratio: c, ms: w.ms, file: f, minRatio: w.minRatio };
        }
      }
    }
  }

  console.log('\n=== ЧТО ИЗ ЭТОГО СЛЕДУЕТ ===');
  if (worstAcross === null) {
    console.log(`Ни на одном кандидате провал не продержался ${holdMs} мс. То есть на ЧИСТЫХ записях`);
    console.log('пара «порог + выдержка» ложных не даёт вовсе — но это ПОЛ ЛОЖНЫХ, а не порог');
    console.log('обнаружения: записи без смерти не могут сказать, на какой глубине встаёт карта.');
  } else {
    console.log(`ЛОЖНОЕ ВОЗМОЖНО: порог ${worstAcross.ratio} держался ${Math.round(worstAcross.ms)} мс`);
    console.log(`(глубина ${worstAcross.minRatio}) в ${worstAcross.file} при выдержке ${holdMs} мс.`);
    console.log('Значит уставка обязана лежать НИЖЕ этого порога либо требовать более долгой выдержки.');
  }
  console.log('\n⚠️ Порог обнаружения отсюда НЕ выводится (границы фазы 6б-бис, записано до работы).');
  return 0;
}

// Идиома «я — точка входа» взята у соседнего прибора (`tools/pulse-report.mjs`), а не изобретена:
// на Windows наивное сравнение с `file://` + argv[1] расходится по числу косых и молча НИЧЕГО не
// печатает. На этом потерян один прогон прибора — прибор, который молчит, неотличим от пустого
// результата, и это ровно класс `bugs/124`.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}
