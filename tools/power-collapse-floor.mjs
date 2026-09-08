// power-collapse-floor.mjs — ВЫВОД ПОРОГА ВХОДА 3 ИЗ АРХИВА, а не назначение его головой.
//
// `plans/91` Ш3 (AC2). Родитель — `bugs/117`: 2026-09-08 машина упала синим экраном на
// 3067 МГц / 925 мВ, а предохранитель не сработал, потому что оба его входа мерили НАШИ процессы.
// Разделяющая величина нашлась в пробах, которые снимались всё это время: карта заявляла 100 %
// загрузки и потребляла 60 Вт вместо 280.
//
// 🔴 ЧТО ЭТОТ ПРИБОР НЕ ДЕЛАЕТ: он не назначает число. Он читает архив прожигов, считает по нему
// величину и печатает ЗАЗОР между смертями и здоровьем. Если зазора нет — он говорит это вслух и
// возвращает 1. Выдуманный порог в предохранителе, который убивает работу владельца, запрещён
// (`PHILOSOPHY.md` → три двери).
//
// ВЕЛИЧИНА. Не абсолютные ватты: архив показывает, что низкая мощность под нагрузкой сама по себе
// не редкость (первый процентиль 65 Вт, есть пробы по 43 Вт в прогонах, никого не убивших) — на
// 2145 МГц 45 Вт законны, на 3060 МГц они невозможны. Считается ПРОВАЛ ВНУТРИ ОДНОГО ПРОЖИГА:
// доля «дно после пика / пик». Она сравнивает карту с ней же самой минуту назад и потому не
// зависит от частоты.
//
// [TESTED: 2026-09-08 · прогон на боевом архиве, 166 прожигов. Порог выведен 0,412 (середина
//  разрыва 0,331 → 0,494). ОНЛАЙН-ФОРМА, та что поедет в судью: трипов 7, ВСЕ СЕМЬ на частотах с
//  полом зависания, ЛОЖНЫХ 0. При этом 92 прожига на ТЕХ ЖЕ частотах провала не дали — величина
//  различает события, а не частоты. Ноль ложных проверен на подвижность: порог 0,504 → 1 ложный,
//  0,650 → 36, 0,900 → 68. --selftest 6/6]
//
// ⚠️ ПЕРВАЯ РЕДАКЦИЯ ЭТОЙ МЕТКИ БЫЛА НАПИСАНА ДО ПРОГОНА и несла числа, которых никто не мерил
// («170 файлов», «5 смертей», «0,520»). Исправлено по факту прогона. Это тот самый класс, за
// который платит весь проект: заявление впереди наблюдения.

import fs from 'node:fs';
import path from 'node:path';

const VMIN_DIR = path.join(process.cwd(), 'runs', 'vmin');
const SWEEP_JOURNAL = path.join(process.cwd(), 'runs', 'sweep', 'journal.jsonl');

/** Загрузка считается идущей при этой занятости — ниже проба описывает паузу, а не работу. */
export const LOAD_UTIL_PCT = 90;

/**
 * ПИК ОБЯЗАН СОСТОЯТЬСЯ, ИНАЧЕ ДЕЛИТЬ НЕ НА ЧТО. Пока прожиг разгоняется от простоя, «доля от
 * пика» близка к единице у любой карты, и живой, и мёртвой. Порог взят НИЖЕ самого слабого пика
 * в архиве — он отсекает не прожиги, а их первые миллисекунды.
 */
export const ESTABLISHED_PEAK_W = 150;

/**
 * Провал внутри прожига: сколько ПРОБ подряд должна держаться низкая мощность. Проба архива идёт
 * раз в 500 мс; два подряд — это ≥ 1 секунда, вчетверо короче наблюдённого окна смерти (2,5 с).
 */
export const LOW_RUN_SAMPLES = 2;

/** Разбор одного файла проб в ряд замеров под нагрузкой. */
export function loadSamples(text) {
  const out = [];
  for (const line of text.trim().split('\n')) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const s = o?.sample;
    if (!s || typeof s['power.draw.instant'] !== 'number') continue;
    out.push({ w: s['power.draw.instant'], util: s['utilization.gpu'], mhz: s['clocks.sm'], t: o.t });
  }
  return out;
}

/**
 * ВЕЛИЧИНА ЗАДНИМ ЧИСЛОМ — для вывода порога по архиву. Дно ПОСЛЕ пика, делённое на пик.
 * Возвращает `null`, если прожиг не состоялся (пика нет или после него нечего мерить).
 */
export function collapseRatio(samples) {
  const load = samples.filter((s) => s.util >= LOAD_UTIL_PCT);
  if (load.length < 3) return null;
  let peak = -Infinity; let peakAt = -1;
  for (let i = 0; i < load.length; i += 1) if (load[i].w > peak) { peak = load[i].w; peakAt = i; }
  if (peak < ESTABLISHED_PEAK_W || peakAt === load.length - 1) return null;
  let trough = Infinity;
  for (let i = peakAt + 1; i < load.length; i += 1) if (load[i].w < trough) trough = load[i].w;
  return { ratio: trough / peak, peak, trough, samples: load.length };
}

/**
 * ВЕЛИЧИНА ОНЛАЙН — та, которую сможет считать судья. Отличие от `collapseRatio` принципиальное:
 * пик здесь БЕГУЩИЙ (что видели до сих пор), будущего нет. Прибор считает её по тому же архиву,
 * чтобы порог выводился на форме, которая реально поедет в предохранитель, а не на удобной.
 */
export function onlineTrip(samples, { ratio, lowRun = LOW_RUN_SAMPLES }) {
  const load = samples.filter((s) => s.util >= LOAD_UTIL_PCT);
  let peak = 0; let low = 0;
  for (const s of load) {
    if (s.w > peak) peak = s.w;
    if (peak < ESTABLISHED_PEAK_W) { low = 0; continue; }
    if (s.w <= ratio * peak) { low += 1; if (low >= lowRun) return { tripped: true, atW: s.w, peak }; }
    else low = 0;
  }
  return { tripped: false };
}

/**
 * Частоты, у которых в журнале развёртки записан ПОЛ ЗАВИСАНИЯ — это и есть смерти.
 *
 * 🔴 ЗОВЁТСЯ ФУНКЦИЯ ПРОЕКТА, А НЕ СВОЯ КОПИЯ — И ЭТО ОПЛАЧЕНО ЗДЕСЬ ЖЕ, В ЭТОМ ФАЙЛЕ.
 * Первая редакция прибора разбирала журнал сама и считала только `verdict/hung`. Она ПРОПУСТИЛА
 * смерть 2026-09-08 — ту самую, ради которой прибор написан: журнал оборвался на намерении,
 * вердикта нет вовсе. Прибор объявил сегодняшнюю смерть ЛОЖНЫМ срабатыванием, то есть соврал
 * ровно в ту сторону, в какую врать нельзя. Настоящая `hangFloors` берёт ещё и ОСИРОТЕВШИЕ
 * НАМЕРЕНИЯ и применяет поправки. Урок в одну строку: у журнала один читатель
 * (`PHILOSOPHY.md` → DRY).
 */
export async function hangFrequencies() {
  if (!fs.existsSync(SWEEP_JOURNAL)) return new Set();
  const recs = fs.readFileSync(SWEEP_JOURNAL, 'utf8').trim().split('\n')
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const { hangFloors } = await import('../automation-engine/lib/sweep-journal.mjs');
  return new Set([...hangFloors(recs).keys()]);
}

/** Все файлы архива, разобранные в строки: частота, доля провала, стоит ли на частоте с полом. */
export async function surveyArchive(dir = VMIN_DIR) {
  const hang = await hangFrequencies();
  const rows = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const m = /^(?:cap|pin)-(\d+)-/u.exec(f);
    if (!m) continue;
    const r = collapseRatio(loadSamples(fs.readFileSync(path.join(dir, f), 'utf8')));
    if (!r) continue;
    rows.push({ file: f, mhz: +m[1], ...r, atHangFrequency: hang.has(+m[1]) });
  }
  return rows;
}

/**
 * ЗАЗОР — сердце прибора. Смертями считаются файлы, чья доля НИЖЕ разрыва в упорядоченном ряду;
 * прибор не знает заранее, сколько их, и не подгоняет число под ответ: он ищет самый широкий
 * разрыв в нижней части ряда и печатает обе его границы.
 */
export function deriveFloor(rows) {
  const sorted = [...rows].sort((a, b) => a.ratio - b.ratio);
  let bestGap = 0; let cut = -1;
  // Разрыв ищется только в нижней трети: выше он ничего не отделяет, и самый широкий разрыв
  // здорового «плато» увёл бы порог в область, где живут обычные прожиги.
  const limit = Math.max(2, Math.floor(sorted.length / 3));
  for (let i = 0; i < limit - 1; i += 1) {
    const gap = sorted[i + 1].ratio - sorted[i].ratio;
    if (gap > bestGap) { bestGap = gap; cut = i; }
  }
  if (cut < 0) return null;
  const below = sorted.slice(0, cut + 1);
  const above = sorted.slice(cut + 1);
  return {
    highestBelow: below[below.length - 1].ratio,
    lowestAbove: above[0].ratio,
    gap: bestGap,
    // Порог ставится ПОСЕРЕДИНЕ зазора: равное расстояние до пропуска и до ложного.
    floor: (below[below.length - 1].ratio + above[0].ratio) / 2,
    below,
    above,
  };
}

async function report() {
  const rows = await surveyArchive();
  if (rows.length < 20) {
    console.error(`АРХИВ СЛИШКОМ МАЛ: прожигов ${rows.length}. Порог выводить не из чего.`);
    return 1;
  }
  const d = deriveFloor(rows);
  const hangAll = await hangFrequencies();
  console.log(`АРХИВ: прожигов ${rows.length} · частот с полом зависания ${hangAll.size}`);
  if (!d) { console.error('ЗАЗОРА НЕТ — величина не разделяет. Порог не выводится.'); return 1; }

  console.log('');
  console.log(`САМЫЙ ШИРОКИЙ РАЗРЫВ В НИЖНЕЙ ТРЕТИ: ${d.highestBelow.toFixed(3)} → ${d.lowestAbove.toFixed(3)}`);
  console.log(`  ширина ${d.gap.toFixed(3)} · ПОРОГ ${d.floor.toFixed(3)} (посередине)`);
  console.log('');
  console.log('НИЖЕ ПОРОГА (прибор считает это провалами):');
  for (const r of d.below) {
    console.log(`  ${r.ratio.toFixed(3)} · ${String(r.mhz).padStart(4)} МГц · пик ${r.peak.toFixed(1)} → дно ${r.trough.toFixed(1)} Вт`
      + ` · ${r.atHangFrequency ? '🔴 частота С ПОЛОМ ЗАВИСАНИЯ' : '⚠️ частота БЕЗ пола'} · ${r.file}`);
  }

  // ── СВЕРКА С НЕЗАВИСИМЫМ СВИДЕТЕЛЕМ: журналом развёртки ──────────────────────────────────────
  // Прибор считает по ПРОБАМ и ничего не знает о зависаниях; журнал знает о зависаниях и ничего не
  // знает о пробах. Совпадение двух независимых источников — это улика, а согласие прибора с самим
  // собой ею не было бы.
  const hitsAtHang = d.below.filter((r) => r.atHangFrequency).length;
  const falseAtHealthy = d.below.length - hitsAtHang;
  const missedHangFiles = d.above.filter((r) => r.atHangFrequency).length;
  console.log('');
  console.log(`СВЕРКА С ЖУРНАЛОМ: из ${d.below.length} провалов на частотах с полом зависания ${hitsAtHang},`
    + ` вне их ${falseAtHealthy}`);
  console.log(`  прожигов на частотах с полом, провала НЕ давших: ${missedHangFiles}`
    + ' — то есть величина различает СОБЫТИЯ, а не частоты');

  // ── ОНЛАЙН-ФОРМА: та, которую сможет считать судья ────────────────────────────────────────────
  console.log('');
  console.log('ОНЛАЙН-ФОРМА (бегущий пик, будущего нет) — как поедет в предохранитель:');
  const onlineRows = [];
  for (const f of fs.readdirSync(VMIN_DIR).filter((x) => x.endsWith('.jsonl'))) {
    const m = /^(?:cap|pin)-(\d+)-/u.exec(f);
    if (!m) continue;
    const smp = loadSamples(fs.readFileSync(path.join(VMIN_DIR, f), 'utf8'));
    const t = onlineTrip(smp, { ratio: d.floor });
    if (t.tripped) onlineRows.push({ file: f, mhz: +m[1], ...t });
  }
  const hang = hangAll;
  const onlineFalse = onlineRows.filter((r) => !hang.has(r.mhz));
  console.log(`  трипов ${onlineRows.length}: на частотах с полом ${onlineRows.length - onlineFalse.length},`
    + ` ЛОЖНЫХ ${onlineFalse.length}`);
  for (const r of onlineRows) {
    console.log(`    ${hang.has(r.mhz) ? '🔴' : '⚠️ ЛОЖНЫЙ'} ${String(r.mhz).padStart(4)} МГц · сработал на ${r.atW.toFixed(1)} Вт при пике ${r.peak.toFixed(1)} · ${r.file}`);
  }

  // ── ЧУВСТВИТЕЛЬНОСТЬ: прибор ОБЯЗАН уметь показать ложные, иначе его ноль ничего не значит ────
  console.log('');
  console.log('ЧУВСТВИТЕЛЬНОСТЬ (ноль ложных стоит чего-то, только если счётчик умеет расти):');
  for (const probe of [d.floor, d.lowestAbove + 0.01, 0.65, 0.9]) {
    let n = 0; let f2 = 0;
    for (const f of fs.readdirSync(VMIN_DIR).filter((x) => x.endsWith('.jsonl'))) {
      const m = /^(?:cap|pin)-(\d+)-/u.exec(f);
      if (!m) continue;
      const t = onlineTrip(loadSamples(fs.readFileSync(path.join(VMIN_DIR, f), 'utf8')), { ratio: probe });
      if (t.tripped) { n += 1; if (!hang.has(+m[1])) f2 += 1; }
    }
    console.log(`  порог ${probe.toFixed(3)} → трипов ${n}, из них ложных ${f2}`);
  }
  console.log('');
  console.log(`ВЫВОД: порог входа 3 = ${d.floor.toFixed(3)} доли от бегущего пика,`
    + ` пик считается состоявшимся от ${ESTABLISHED_PEAK_W} Вт, провал держится ${LOW_RUN_SAMPLES} пробы подряд.`);
  return 0;
}

function selftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, extra = '') => {
    if (cond) { pass += 1; console.log(`  ✅ ${name}`); } else { fail += 1; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
  };
  const mk = (ws, util = 100) => ws.map((w, i) => ({ w, util, mhz: 3000, t: i }));

  ok('провал считается ПОСЛЕ пика, а не до него',
    Math.abs(collapseRatio(mk([60, 280, 60])).ratio - 60 / 280) < 1e-9);
  ok('неразогнавшийся прожиг доли не даёт — делить не на что',
    collapseRatio(mk([40, 50, 45])) === null);
  ok('проба вне нагрузки в счёт не идёт',
    collapseRatio(mk([280, 280, 280]).concat([{ w: 30, util: 2, mhz: 3000, t: 9 }])).trough === 280);
  ok('ОНЛАЙН: один низкий замер НЕ трипает — нужен ряд (защита от выброса)',
    onlineTrip(mk([280, 280, 60, 280, 280]), { ratio: 0.35 }).tripped === false);
  ok('ОНЛАЙН: два низких подряд трипают',
    onlineTrip(mk([280, 280, 60, 60, 280]), { ratio: 0.35 }).tripped === true);
  // 🔴 РАЗБОРЧИВЫЙ БЛОК: без него прибор мог бы всегда возвращать «ложных 0» и выглядеть идеальным.
  ok('ОНЛАЙН: при пороге у самого потолка ложные ПОЯВЛЯЮТСЯ — счётчик умеет расти',
    onlineTrip(mk([280, 270, 265, 260, 255]), { ratio: 0.99 }).tripped === true);

  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'))) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Использование: node tools/power-collapse-floor.mjs [--selftest]\n'
      + '  без флагов — вывести порог входа 3 из архива runs/vmin и сверить с журналом развёртки\n'
      + '  --selftest — батарея прибора (архив не нужен)');
    process.exit(0);
  }
  process.exit(argv.includes('--selftest') ? selftest() : await report());
}
