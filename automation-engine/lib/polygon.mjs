#!/usr/bin/env node
// automation-engine/lib/polygon.mjs — ПОЛИГОН НЕИЗВЕСТНЫХ GPU (эпик 67 фаза 4, `plans/71` шаг 4).
//
// Гоняет N СГЕНЕРИРОВАННЫХ карт через ПОЛНЫЙ цикл движка и судит каждый прогон пятью сторожами
// честности (`polygon-guards.mjs`). Печатает: пройдено · сломано · карту покрытия по осям · ВРЕМЯ
// ЧИСЛОМ · строку «вымысел²».
//
// ─── ЧТО ЭТО ДОКАЗЫВАЕТ И ЧЕГО НЕ ДОКАЗЫВАЕТ ────────────────────────────────────────────────────
//
// Зелёный полигон — утверждение о ЛОГИКЕ ДВИЖКА на широком поле поведений, и НИ О ЧЁМ БОЛЬШЕ. Ни о
// кремнии владельца, ни о правильности найденного края: у ВЫМЫСЛА² правильного края нет. Полигон,
// который судил бы край, учил бы движок проходить вымысел вместо кремния (риск №1 `plans/67`).
//
// ─── ПОЧЕМУ ЦИКЛ ЗАПУСКАЕТСЯ ОТДЕЛЬНЫМ ПРОЦЕССОМ, А НЕ ВЫЗОВОМ ФУНКЦИИ ──────────────────────────
//
// Полигон обязан гонять ТОТ ЖЕ путь, которым идёт живой прогон, — иначе он проверяет свою копию
// движка. Отдельный процесс даёт даром то, что вызовом функции пришлось бы подделывать: настоящий
// КОД ВЫХОДА (без него сторож И2 нечем кормить), настоящий журнал на диске, настоящую сборку
// двойника. И в движке не появляется ни одной ветки «мы на полигоне» — условие из таблицы проверки
// наблюдением `plans/71`.
//
// ─── КАЖДАЯ КАРТА СТАРТУЕТ С ЧИСТОГО ЛИСТА, И ЭТО НЕ ГИГИЕНА, А УСЛОВИЕ СУДА ────────────────────
//
// Документ и журнал двойника ЖИВУТ МЕЖДУ ПРОГОНАМИ (`twin-assembly.mjs`: `benches/runs/virtual-<имя
// карты>*`) — так и задумано, там копится пол карты между заходами. Полигону это ядовито: сторожа
// сверяют документ с журналом, и остатки прошлого прогона дали бы им судить СМЕСЬ двух прогонов —
// строку от одного, улики от другого. Поэтому артефакты карты сносятся перед её прогоном, и это
// названо здесь, а не спрятано в утилите.
//
// [TESTED: 2026-08-29 19:0x · --selftest (чистые функции: карта покрытия, сводка, план имён) +
//  живой прогон --count на сгенерированных картах, живые артефакты сверены отпечатком до и после.]

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { generateCard, ARCHETYPES } from './card-generator.mjs';
import { judgeRun } from './polygon-guards.mjs';
import { liveFingerprint } from './twin-assembly.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BENCH_RUNS = path.join(ROOT, 'benches', 'runs');
const GEN_DIR = path.join(ROOT, 'benches', 'cards', 'generated');
const ENGINE = path.join(ROOT, 'automation-engine', 'engine.mjs');

/** Где двойник держит артефакты ЭТОЙ карты. Одно место знания — иначе снос чистил бы не то. */
export function twinArtefactPaths(cardName, benchRuns = BENCH_RUNS) {
  const docName = `virtual-${cardName}`;
  return {
    docFile: path.join(benchRuns, `${docName}.json`),
    journalDir: path.join(benchRuns, `${docName}-journal`),
    journalFile: path.join(benchRuns, `${docName}-journal`, 'journal.jsonl'),
  };
}

/**
 * ГОЛОС ПРОГОНА — ОБА ПОТОКА. Вынесено функцией ради блока: пока склейка стояла строкой внутри
 * `runOneCard`, доказать её офлайн было нечем, а именно она отвечает за то, увидит ли сторож И2
 * названную причину отказа (движок печатает отказы в stderr).
 */
export function runVoice(stdout, stderr) {
  return [...String(stdout ?? '').split(/\r?\n/), ...String(stderr ?? '').split(/\r?\n/)];
}

/** Разобрать журнал в строки-объекты. Битую строку НЕ глотаем молча — она улика сама по себе. */
export function parseJournal(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { out.push({ state: 'НЕРАЗОБРАНО', raw: line.slice(0, 200) }); }
  }
  return out;
}

/**
 * КАРТА ПОКРЫТИЯ ПО ОСЯМ — обязательная часть отчёта (P71-AC5), а не приложение.
 * Без неё «30 карт» неотличимо от «30 раз одна карта», и зелёный полигон ничего не стоит.
 */
export function coverageOf(cards) {
  const axes = {};
  const track = (k, v) => {
    if (!Number.isFinite(v)) return;
    const a = (axes[k] ??= { min: Infinity, max: -Infinity, n: 0 });
    a.min = Math.min(a.min, v); a.max = Math.max(a.max, v); a.n++;
  };
  const byArch = {};
  for (const c of cards) {
    if (!c) continue;
    byArch[c.archetype] = (byArch[c.archetype] ?? 0) + 1;
    const ph = c.card?.physics ?? {};
    track('предел мощности, Вт', ph.power?.limitW);
    track('дрейф таблицы, МГц/°C', ph.tableDriftMhzPerC);
    track('крутизна отказа, мВ', c.card?.fiction?.failure?.scaleMv);
    track('пол карты, мВ', ph.floor?.baseMv);
    track('сдвиг края, мВ/°C', ph.edgeShift?.mvPerC);
  }
  return { axes, byArch, cards: cards.filter(Boolean).length };
}

/**
 * У скольких прогонов ФАКТУРА ПРОЖИГОВ вообще собралась.
 *
 * ⚠️ ВЫНЕСЕНО ИЗ `runBatch` РАДИ ПРОВЕРЯЕМОСТИ, и это оплачено мутацией: пока счёт стоял строкой
 * внутри пакетного прогона, мутация «вернуть 99» проходила ЗЕЛЁНОЙ — блок судил ОТЧЁТ, а до самого
 * счёта офлайн было не добраться (нужен был настоящий прогон). Число, которое никто не может
 * покрасить, — не сторож, а украшение.
 */
export function countWithBurns(results) {
  return results.filter((r) => (r?.evidence?.burns ?? []).length > 0).length;
}

/** Прогнать ОДНУ карту через полный цикл и осудить. Возвращает улики и вердикт. */
export function runOneCard({ seed, amplitude, archetype, freezeAxes = [], fromMhz, toMhz, maxDepthMv = 300, timeoutMs = 300000 }) {
  const gen = generateCard({ seed, amplitude, archetype, freezeAxes });
  if (!gen.ok) return { ok: false, seed, amplitude, archetype, why: `карта не сгенерирована: ${gen.why}` };
  const cardName = gen.card.name;
  const cardFile = path.join(GEN_DIR, `${cardName}.json`);
  // Карта пишется тем же путём, что и CLI генератора: полигон не заводит второго способа положить
  // файл на диск (иначе появилась бы пара «правда↔зеркало» из двух писателей одной карты).
  const write = spawnSync(process.execPath, [
    path.join(ROOT, 'automation-engine', 'lib', 'card-generator.mjs'),
    '--seed', String(seed), '--amplitude', String(amplitude), '--archetype', archetype,
    // ⚠️ ЗАМОРОЗКА ЕДЕТ И В CLI: файл на диске обязан быть ТЕМ ЖЕ, что вернул `generateCard` выше.
    // Иначе сжатие судило бы кандидата, которого на диске не существует, — пара «правда↔зеркало»
    // ровно в том месте, где мы ищем минимальный ВОСПРОИЗВОДИМЫЙ вход.
    ...(freezeAxes.length ? ['--freeze', freezeAxes.join(',')] : []),
  ], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  if (write.status !== 0) {
    return { ok: false, seed, amplitude, archetype, why: `запись карты вернула ${write.status}: ${(write.stderr ?? '').slice(0, 300)}` };
  }

  // ─── ЧИСТЫЙ ЛИСТ (см. шапку): остатки прошлого прогона заставили бы сторожей судить СМЕСЬ ─────
  const p = twinArtefactPaths(cardName);
  for (const target of [p.docFile, p.journalDir]) {
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
  }

  const started = Date.now();
  const run = spawnSync(process.execPath, [
    ENGINE, '--sweep', '--card', 'virtual', '--twin-card', cardFile,
    '--from', String(fromMhz), '--to', String(toMhz), '--max-depth', String(maxDepthMv),
  ], { cwd: ROOT, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const seconds = (Date.now() - started) / 1000;

  // ФАКТУРА ПРОЖИГОВ ЛЕЖИТ В КАТАЛОГЕ ПРОГОНА, А ЕГО ИМЯ ЗНАЕТ ТОЛЬКО САМ ПРОГОН — берём его из
  // напечатанной строки, а не угадываем по времени: угадывание по свежести каталога подобрало бы
  // чужой прогон при параллельных запусках, и сторож И6 судил бы не ту карту.
  const runDir = (String(run.stdout ?? '').match(/песочниц[ае]\s+(\S+twin-[^\s]+)/u)
    ?? String(run.stdout ?? '').match(/(\S*twin-\d{4}-\d{2}-\d{2}T[^\s\/]+)/u))?.[1] ?? null;
  const burnsFile = runDir ? path.join(runDir.replace(/[\/]$/, ''), 'burns.jsonl') : null;
  const burns = burnsFile && existsSync(burnsFile)
    ? parseJournal(readFileSync(burnsFile, 'utf8'))
    : [];

  const evidence = {
    // `signal` переживает таймаут: убитый прогон даёт status null, и «null === 0» ложно, а вот
    // «не 0» — правда, которую сторож И2 обязан увидеть.
    exitCode: run.status === null ? -1 : run.status,
    journal: existsSync(p.journalFile) ? parseJournal(readFileSync(p.journalFile, 'utf8')) : [],
    docRows: existsSync(p.docFile) ? (JSON.parse(readFileSync(p.docFile, 'utf8')).frequencies ?? []) : [],
    // ⚠️ ОБА ПОТОКА, И ЭТО НАЙДЕНО ПЕРВЫМ ЖЕ НАСТОЯЩИМ СРАБАТЫВАНИЕМ ПОЛИГОНА. Карта 3009/drifty
    // дала «код 1, но НИ ОДНА строка не называет причину» — и причина была: движок печатает её
    // через `console.error`, то есть в STDERR (`engine.mjs`: «ОШИБКА: кривая не прочиталась», «ОТКАЗ:
    // …» и ещё с полдюжины мест). Сборщик, читавший один stdout, был слеп к ГОЛОСУ ОТКАЗА — то есть
    // сторож И2 краснел на моей собственной слепоте, а не на дефекте движка.
    // Урок общий: улики собираются со ВСЕГО, что процесс сказал, а не с того потока, о котором
    // вспомнил собиратель.
    reportLines: runVoice(run.stdout, run.stderr),
    envelopeMhz: gen.card.card?.maxGraphicsMhz ?? null,
    burns,
    fingerprintBefore: null,     // отпечаток снимается на ПАКЕТ, проставляется вызывающим
    fingerprintAfter: null,
  };
  return {
    ok: true, seed, amplitude, archetype, cardName, cardFile, card: gen.card,
    seconds, evidence, killedBySignal: run.signal ?? null,
  };
}

/**
 * ОРАКУЛ СЖАТИЯ — настоящий прогон под сторожами, свёрнутый в один вопрос: «каким КЛАССОМ ломается
 * этот вход?». Дорогой (минуты на кандидата) и потому живёт здесь, а не в наборе: логика сжатия
 * доказана мутациями на подставном оракуле (`polygon-shrink.mjs`), а это — только проводка.
 * Разделение не эстетическое: иначе сжатие было бы недоказуемо офлайн.
 *
 * ⚠️ ОТПЕЧАТОК ПОДСТАВЛЯЕТСЯ ОДИН И ТОТ ЖЕ. Сторож И5 сравнивает «до» и «после»; сжатие гоняет
 * десятки кандидатов, и снимать отпечаток на каждого значило бы кормить И5 шумом файловой системы
 * вместо ответа о карте. И5 — свойство ПАКЕТА, и пакетом он уже проверен.
 */
export function breakClassOracle({ seed, fromMhz, toMhz, maxDepthMv, fingerprint,
  // ШОВ ПРОГОНА — ради блока, а не ради гибкости: без него проводка «класс = имя сторожа»
  // проверялась бы только настоящими минутами, то есть не проверялась бы вовсе.
  runFn = runOneCard, judgeFn = judgeRun } = {}) {
  return (cand) => {
    const r = runFn({
      seed: cand.seed ?? seed,
      amplitude: cand.amplitude,
      archetype: cand.archetype,
      freezeAxes: cand.frozenAxes ?? [],
      fromMhz, toMhz, maxDepthMv,
    });
    // «НЕ ЗАПУСТИЛОСЬ» — ОТДЕЛЬНЫЙ КЛАСС, А НЕ «не ломается». Слить его с null значило бы, что
    // бисекция примет несобравшуюся карту за успешно сжатую и уедет в пустоту.
    if (!r.ok) return 'НЕ ЗАПУСТИЛОСЬ';
    r.evidence.fingerprintBefore = fingerprint;
    r.evidence.fingerprintAfter = fingerprint;
    const j = judgeFn(r.evidence);
    return j.ok ? null : j.failures[0].name;
  };
}

/** Пакет: N карт, архетипы по кругу, отпечаток живых артефактов на весь прогон. */
export function runBatch({ count = 30, amplitude = 0.7, seedBase = 1000,
  fromMhz = 2842, toMhz = 2812, maxDepthMv = 300, log = console.log } = {}) {
  const names = Object.keys(ARCHETYPES);
  const before = liveFingerprint();
  const started = Date.now();
  const results = [];
  for (let i = 0; i < count; i++) {
    const archetype = names[i % names.length];
    const seed = seedBase + i;
    const r = runOneCard({ seed, amplitude, archetype, fromMhz, toMhz, maxDepthMv });
    if (!r.ok) { results.push({ ...r, judged: null }); log(`  🔴 ${seed}/${archetype}: ${r.why}`); continue; }
    // Отпечаток — свойство ПАКЕТА, не карты: снимать его на каждую карту значило бы платить за
    // хеши живых артефактов N раз и всё равно не узнать больше.
    r.evidence.fingerprintBefore = before;
    r.evidence.fingerprintAfter = liveFingerprint();
    const judged = judgeRun(r.evidence);
    results.push({ ...r, judged });
    log(judged.ok
      ? `  ✅ ${seed}/${archetype}: пройдена (${r.seconds.toFixed(1)} с)`
      : `  🔴 ${seed}/${archetype}: ${judged.failures[0].name} — ${judged.failures[0].why}`);
  }
  const seconds = (Date.now() - started) / 1000;
  const broken = results.filter((r) => r.judged && !r.judged.ok);
  const failedToRun = results.filter((r) => !r.ok);
  return {
    ok: broken.length === 0 && failedToRun.length === 0,
    count, amplitude, seedBase, seconds,
    passed: results.filter((r) => r.judged?.ok).length,
    broken, failedToRun, results,
    withBurns: countWithBurns(results),
    coverage: coverageOf(results.map((r) => (r.ok ? r : null))),
    fingerprintHeld: JSON.stringify(before) === JSON.stringify(liveFingerprint()),
  };
}

/** Печать отчёта. Строка «вымысел²» — обязательная, а не украшение (E67-AC6). */
export function reportLines(batch) {
  const L = [];
  L.push('');
  L.push(`ПОЛИГОН: карт ${batch.count} · пройдено ${batch.passed} · сломано ${batch.broken.length}`
    + `${batch.failedToRun.length ? ` · не запустилось ${batch.failedToRun.length}` : ''}`);
  L.push(`ВРЕМЯ: ${batch.seconds.toFixed(1)} с (${(batch.seconds / batch.count).toFixed(1)} с на карту)`);
  // ⚠️ ТИХАЯ ДЕГРАДАЦИЯ ОБЪЯВЛЯЕТСЯ ВСЛУХ. Путь песочницы полигон берёт из НАПЕЧАТАННОЙ строки
  // прогона; поменяется формулировка — фактура не соберётся, и сторож И6 будет молча пропускать
  // карту за картой, оставаясь зелёным. Число собранных фактур в отчёте превращает эту поломку
  // из невидимой в заметную с первого взгляда.
  L.push(`ФАКТУРА ПРОЖИГОВ: собрана у ${batch.withBurns ?? 0} из ${batch.passed + batch.broken.length} прогнанных карт`
    + `${(batch.withBurns ?? 0) === 0 ? ' — 🔴 НИ ОДНОЙ: сторож И6 не судил НИЧЕГО' : ''}`);
  L.push(`ЖИВЫЕ АРТЕФАКТЫ: отпечаток ${batch.fingerprintHeld ? 'СОШЁЛСЯ' : '🔴 РАЗОШЁЛСЯ'} до и после пакета`);
  L.push('ПОКРЫТИЕ ПО ОСЯМ (иначе «30 карт» неотличимо от «30 раз одна карта»):');
  for (const [axis, a] of Object.entries(batch.coverage.axes)) {
    L.push(`   ${axis}: ${a.min} … ${a.max} на ${a.n} карт(ах)`);
  }
  L.push(`   архетипы: ${Object.entries(batch.coverage.byArch).map(([k, v]) => `${k} ×${v}`).join(' · ')}`);
  for (const b of batch.broken) {
    L.push(`🔴 ЛОМАЮЩАЯ КАРТА семя ${b.seed}, амплитуда ${b.amplitude}, архетип ${b.archetype}`);
    for (const f of b.judged.failures) L.push(`   класс: ${f.name} — ${f.why}`);
    L.push(`   воспроизвести: node automation-engine/lib/card-generator.mjs --seed ${b.seed} --amplitude ${b.amplitude} --archetype ${b.archetype}`);
  }
  L.push('ВЫМЫСЕЛ²: этих карт не существует и как замера. Зелёный полигон — утверждение о ЛОГИКЕ '
    + 'ДВИЖКА на широком поле поведений, и НИ О ЧЁМ БОЛЬШЕ: ни о кремнии владельца, ни о том, что '
    + 'найденный край верен — правильного края у вымысла нет.');
  return L;
}

// =================================================================================================
// Самопроверка — только чистые функции; ни одного прогона, ни одной карты
// =================================================================================================
function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('САМОПРОВЕРКА polygon — чистые функции: пути артефактов, разбор журнала, карта покрытия, отчёт');
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона: имя документа двойника · битая строка журнала · счёт осей');

  const p = twinArtefactPaths('virtual-gpu_42', '/b');
  ok('пути артефактов карты — те же, что строит сборка двойника',
    p.docFile.includes('virtual-virtual-gpu_42.json') && p.journalFile.includes('virtual-virtual-gpu_42-journal'),
    `${p.docFile} · ${p.journalFile}`);

  // 🔴 ОПЛАЧЕНО ПЕРВЫМ НАСТОЯЩИМ СРАБАТЫВАНИЕМ ПОЛИГОНА (карта 3009/drifty): движок печатает
  // отказы в STDERR, сборщик читал один stdout, и сторож И2 краснел на слепоте собирателя.
  ok('ГОЛОС ПРОГОНА — ОБА ПОТОКА: причина отказа из stderr доходит до сторожей',
    (() => {
      const v = runVoice('обычная строка', 'ОШИБКА: кривая не прочиталась');
      return v.some((l) => l.includes('обычная строка')) && v.some((l) => l.includes('ОШИБКА: кривая не прочиталась'));
    })());

  const j = parseJournal('{"state":"intent","seq":1}\n{сломано\n{"state":"verdict","seq":1}\n');
  ok('битая строка журнала НЕ глотается молча — она улика',
    j.length === 3 && j[1].state === 'НЕРАЗОБРАНО', JSON.stringify(j.map((x) => x.state)));

  const cov = coverageOf([
    { archetype: 'typical', card: { physics: { power: { limitW: 300 } }, fiction: { failure: { scaleMv: 3.5 } } } },
    { archetype: 'typical', card: { physics: { power: { limitW: 250 } }, fiction: { failure: { scaleMv: 5 } } } },
    { archetype: 'hot-unlucky', card: { physics: { power: { limitW: 350 }, floor: { baseMv: 900 } }, fiction: { failure: { scaleMv: 4 } } } },
    null,
  ]);
  ok('карта покрытия: границы осей и счёт карт по каждой',
    cov.axes['предел мощности, Вт'].min === 250 && cov.axes['предел мощности, Вт'].max === 350
    && cov.axes['предел мощности, Вт'].n === 3, JSON.stringify(cov.axes['предел мощности, Вт']));
  ok('ось, которой у большинства карт НЕТ, считает только своих (пол — одна карта из трёх)',
    cov.axes['пол карты, мВ'].n === 1 && cov.cards === 3);
  ok('архетипы посчитаны по отдельности', cov.byArch.typical === 2 && cov.byArch['hot-unlucky'] === 1);

  const rep = reportLines({
    count: 2, amplitude: 0.7, seedBase: 1, seconds: 10, passed: 1, failedToRun: [],
    broken: [{ seed: 5, amplitude: 0.7, archetype: 'hot-unlucky', judged: { failures: [{ name: 'И1 закрытая строка не глубже выданного', why: 'завышение 245 мВ' }] } }],
    coverage: cov, fingerprintHeld: true,
  });
  ok('отчёт называет ломающую карту, класс отказа И КОМАНДУ ВОСПРОИЗВЕДЕНИЯ',
    rep.some((l) => l.includes('семя 5')) && rep.some((l) => l.includes('И1 закрытая строка'))
    && rep.some((l) => l.includes('--seed 5 --amplitude 0.7 --archetype hot-unlucky')));
  ok('отчёт несёт строку «вымысел²» и границу утверждения (E67-AC6)',
    rep.some((l) => l.includes('ВЫМЫСЕЛ²')) && rep.some((l) => l.includes('правильного края у вымысла нет')));
  ok('отчёт называет ВРЕМЯ числом, и на карту тоже',
    rep.some((l) => /ВРЕМЯ: 10\.0 с \(5\.0 с на карту\)/.test(l)));
  // ⚠️ ТИХАЯ ДЕГРАДАЦИЯ ОБЯЗАНА БЫТЬ ГРОМКОЙ. Ноль собранных фактур означает, что сторож И6 не
  // судил НИЧЕГО и полигон зелен по пустоте — это самый опасный вид зелёного, и он называется.
  ok('отчёт называет, у скольких карт собрана ФАКТУРА, и кричит на нуле',
    (() => {
      const zero = reportLines({ count: 2, amplitude: 0.7, seedBase: 1, seconds: 10, passed: 2, failedToRun: [], broken: [], coverage: cov, fingerprintHeld: true, withBurns: 0 });
      const some = reportLines({ count: 2, amplitude: 0.7, seedBase: 1, seconds: 10, passed: 2, failedToRun: [], broken: [], coverage: cov, fingerprintHeld: true, withBurns: 2 });
      return zero.some((l) => l.includes('НИ ОДНОЙ: сторож И6 не судил'))
        && some.some((l) => /ФАКТУРА ПРОЖИГОВ: собрана у 2 из 2/.test(l))
        && !some.some((l) => l.includes('НИ ОДНОЙ'));
    })());

  // ─── ОРАКУЛ СЖАТИЯ: три исхода, и они РАЗНЫЕ ────────────────────────────────────────────────
  {
    const seen = [];
    const mk = (judgeResult, runOk = true) => breakClassOracle({
      seed: 1, fromMhz: 2842, toMhz: 2842, maxDepthMv: 300, fingerprint: { x: 1 },
      runFn: (c) => { seen.push(c); return runOk ? { ok: true, evidence: {} } : { ok: false, why: 'карта не легла' }; },
      judgeFn: () => judgeResult,
    });
    ok('оракул: чистый прогон — НЕ ломается (null), а не «какой-то класс»',
      mk({ ok: true, failures: [] })({ amplitude: 0.5, archetype: 'typical' }) === null);
    ok('оракул: класс = ИМЯ первого сторожа, а не «сломалось»',
      mk({ ok: false, failures: [{ name: 'И2 стоп именован и код выхода согласен' }] })({ amplitude: 0.5, archetype: 'typical' })
      === 'И2 стоп именован и код выхода согласен');
    ok('оракул: карта, которая не собралась, — ОТДЕЛЬНЫЙ класс, а не «не ломается»',
      mk({ ok: true, failures: [] }, false)({ amplitude: 0.5, archetype: 'typical' }) === 'НЕ ЗАПУСТИЛОСЬ');
    ok('оракул доносит до прогона замороженные оси кандидата',
      (seen[seen.length - 1] ?? {}).freezeAxes !== undefined);
  }

  ok('счёт собранных фактур считает ПО УЛИКАМ, а не по числу прогонов',
    countWithBurns([
      { evidence: { burns: [{ mhz: 1 }] } },
      { evidence: { burns: [] } },
      { evidence: {} },
      { ok: false },
      null,
    ]) === 1);

  ok('отчёт называет судьбу отпечатка живых артефактов',
    rep.some((l) => l.includes('ЖИВЫЕ АРТЕФАКТЫ') && l.includes('СОШЁЛСЯ')));

  console.log(`ИТОГ: блоков ${pass + fail}, зелёных ${pass}, красных ${fail}`);
  return fail === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const num = (f, d) => { const i = argv.indexOf(f); return i !== -1 ? Number(argv[i + 1]) : d; };
  const str = (f, d) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : d; };
  if (argv.includes('--selftest')) process.exit(cmdSelftest());
  const batch = runBatch({
    count: num('--count', 5),
    amplitude: num('--amplitude', 0.7),
    seedBase: num('--seed-base', 1000),
    fromMhz: num('--from', 2842),
    toMhz: num('--to', 2812),
    maxDepthMv: num('--max-depth', 300),
  });
  for (const l of reportLines(batch)) console.log(l);
  void str;
  process.exit(batch.ok ? 0 : 1);
}
