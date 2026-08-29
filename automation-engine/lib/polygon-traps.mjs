#!/usr/bin/env node
// automation-engine/lib/polygon-traps.mjs — ⛳ ТРИ ЛОМАЮЩИЕ КАРТЫ ПОЛИГОНА (эпик 67 фаза 4,
// `plans/71` шаг 6). Заказ владельца 2026-08-29 20:0x: «одну вещь ломает, вторую вещь ломает, обе
// вещи ломает».
//
// ─── ЗАЧЕМ ОНИ, И ПОЧЕМУ БЕЗ НИХ ПОЛИГОН СТОИТ НОЛЬ ─────────────────────────────────────────────
//
// Полигон зелен на пятнадцати картах двух чистых пакетов — и его сторожа не краснели на настоящем
// прогоне НИ РАЗУ. Сторож, ни разу не сработавший, не доказывает ничего
// (`BUG_FIXING_FRAMEWORK.md` → Guards): пока это так, зелёный полигона неотличим от полигона,
// который ловить не умеет вовсе.
//
// ⚠️ ГРАНИЦА, ЧТОБЫ КРАСНОЕ НЕ ПРОЧЛИ НЕВЕРНО. Красный на этих картах доказывает, что ПОЛИГОН
// УМЕЕТ ЛОВИТЬ, и НЕ доказывает дефекта в движке. Роль ровно та же, что у `benches/cards/traps/`
// T1…T8 для движка: карта существует, чтобы НЕПРАВИЛЬНЫЙ ПРИБОР на ней покраснел.
//
// ─── ЧТО ДАЁТ ТРЕТЬЯ КАРТА, ЧЕГО НЕ ДАЮТ ДВЕ ПЕРВЫЕ ────────────────────────────────────────────
//
// Две первые судят НЕЗАВИСИМОСТЬ: каждый сторож срабатывает на своей причине и молчит на чужой.
// Третья судит СЛОЖЕНИЕ: два нарушения сразу не должны схлопываться в одно. Здесь ловится
// отдельный класс дефекта — «первый сработавший сторож заслоняет второго», из-за которого отчёт
// назвал бы одну болезнь вместо двух, а сжатие пошло бы минимизировать не тот вход.
//
// ─── ОЖИДАНИЕ ОБЪЯВЛЯЕТСЯ ДО ПРОГОНА ───────────────────────────────────────────────────────────
//
// Поле `mustRedden` — это ПРЕДСКАЗАНИЕ, записанное в файл карты до того, как её прогнали.
// Прогон его подтверждает или ОПРОВЕРГАЕТ; подгонять ожидание под результат запрещено, и
// расхождение — такая же находка, как совпадение (P71-AC10).
//
// [NOT-TESTED] на рождении: числа `mustRedden` — предсказание, а не замер. Строка снимается
// прогоном `--run`, и его вывод переезжает в `plans/71` § Шаг 6.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildTrapCard } from './virtual-gpu.mjs';

/** Порядок сторожей — тот же, что в `polygon-guards.mjs` GUARDS: класс = ПЕРВЫЙ покрасневший. */
export const G_JOURNAL = 'И3 журнал цел';
export const G_ENVELOPE = 'И4 конверт не превышен';

export const POLYGON_TRAPS = Object.freeze([
  {
    name: 'P1_hangs_and_leaves_an_open_intent',
    breaks: 'ОДНО: зависание',
    traps: 'детерминированный ЗАВИС на 1000 мВ и ниже — карта умирает посреди ступени',
    mustRedden: [G_JOURNAL],
    mustDo: 'полигон обязан УВИДЕТЬ незакрытое намерение и назвать это классом И3',
    otherwise: 'ступень потеряна молча, и пакет из тридцати карт зеленеет по пустоте',
    judgedBy: 'polygon-guards → guardJournalHasNoOpenIntent',
    // ⚠️ ПРЕДСКАЗАНИЕ, ЗАПИСАННОЕ ДО ПРОГОНА (`plans/71` § риск шага 6): возможно, И3 здесь ЛОЖЕН.
    // Журнал упреждающей записи ровно для того и сделан, чтобы намерение без вердикта ОСТАЛОСЬ и
    // было закрыто СЛЕДУЮЩИМ запуском («намерение без вердикта И ЕСТЬ ответ»). Если так — красный
    // на этой карте есть дефект СТОРОЖА, а не движка, и формулировку И3 надо менять на «открытое
    // намерение ОБЪЯСНЕНО зависанием».
    fiction: { hangAtOrBelowMv: 1000, noiseSeed: 20260929 },
    band: { fromMhz: 2842, toMhz: 2812 },
  },
  {
    name: 'P2_boost_carries_it_over_the_envelope',
    breaks: 'ОДНО: выход за конверт',
    traps: 'регулятор буста уносит карту на две ступени сетки ВЫШЕ выданного потолка, у самого '
      + 'конверта карты — то есть выдача перелезает 3090 МГц',
    mustRedden: [G_ENVELOPE],
    mustDo: 'полигон обязан увидеть выдачу выше конверта и назвать это классом И4',
    otherwise: 'нарушение R13 проходит незамеченным, а конверт перестаёт быть границей',
    judgedBy: 'polygon-guards → guardEnvelopeNotExceeded',
    // Живой аналог измерен: `bugs/50` — кривая после записи предлагала на 15 МГц выше потолка,
    // 9 из 9 при безупречной записи. Две ступени сетки (7-8 МГц) дают ровно этот порядок.
    fiction: { boostStepsAboveCeiling: 2, noiseSeed: 20260930 },
    band: { fromMhz: 3082, toMhz: 3060 },
  },
  {
    name: 'P3_hangs_AND_overshoots',
    breaks: 'ОБЕ вещи сразу',
    traps: 'оба свойства в одной карте: и ЗАВИС на 1000 мВ, и буст на две ступени выше потолка',
    mustRedden: [G_JOURNAL, G_ENVELOPE],
    mustDo: 'полигон обязан назвать ОБА класса, а не первый попавшийся; класс карты = первый по '
      + 'порядку сторожей',
    otherwise: 'один сторож заслоняет другого: отчёт называет одну болезнь вместо двух, а сжатие '
      + 'идёт минимизировать не тот вход',
    judgedBy: 'polygon-guards → judgeRun (весь список failures, не только первый)',
    fiction: { hangAtOrBelowMv: 1000, boostStepsAboveCeiling: 2, noiseSeed: 20260931 },
    band: { fromMhz: 3082, toMhz: 3060 },
  },
]);

/** Вывести карты на диск ТОЙ ЖЕ дорогой, что и ловушки движка — второго способа не заводим. */
export function deriveAll({ from = 'curves', outDir = path.join('benches', 'cards', 'traps') } = {}) {
  const out = [];
  for (const t of POLYGON_TRAPS) {
    const r = buildTrapCard(t, { dir: from });
    if (!r.ok) { out.push({ name: t.name, ok: false, why: r.why }); continue; }
    // Расписка ловушки уже проставлена `buildTrapCard`; дописываем ПРЕДСКАЗАНИЕ — оно свойство
    // именно полигонной ловушки и обязано жить В КАРТЕ, а не только в плане (P71-AC9/AC10).
    r.card.trap.breaks = t.breaks;
    r.card.trap.mustRedden = [...t.mustRedden];
    r.card.trap.band = { ...t.band };
    out.push({ name: t.name, ok: true, card: r.card, outDir });
  }
  return out;
}

/** Совпало ли наблюдение с предсказанием. Множества, а не списки: порядок сторожей тут не смысл. */
export function verdictAgainstPrediction(mustRedden, actualNames) {
  const want = new Set(mustRedden);
  const got = new Set(actualNames);
  const missing = [...want].filter((n) => !got.has(n));
  const extra = [...got].filter((n) => !want.has(n));
  return {
    // ⚠️ РОВНО, А НЕ «ХОТЯ БЫ» (P71-AC7): лишний красный — такая же находка, как недостающий.
    // Сторож, ловящий чужое, разрушает независимость не меньше, чем сторож слепой.
    ok: missing.length === 0 && extra.length === 0,
    missing,
    extra,
  };
}

function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('САМОПРОВЕРКА polygon-traps — состав трёх карт и сверка с предсказанием; карт не строит');
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона: «ровно, а не хотя бы» · состав третьей карты · предсказание в карте');

  ok('карт РОВНО три — «одну ломает, вторую ломает, обе ломает»', POLYGON_TRAPS.length === 3);
  const [p1, p2, p3] = POLYGON_TRAPS;
  ok('P1 ломает ОДНО и обещает ровно одного сторожа', p1.mustRedden.length === 1 && p1.mustRedden[0] === G_JOURNAL);
  ok('P2 ломает ОДНО и обещает ДРУГОГО сторожа', p2.mustRedden.length === 1 && p2.mustRedden[0] === G_ENVELOPE);
  ok('P3 обещает ОБОИХ — и это ровно объединение первых двух',
    p3.mustRedden.length === 2 && p3.mustRedden.includes(G_JOURNAL) && p3.mustRedden.includes(G_ENVELOPE));
  // ⚠️ ТРЕТЬЯ КАРТА ОБЯЗАНА НЕСТИ ОБА СВОЙСТВА, а не быть переименованной первой: иначе «обе вещи»
  // проверялось бы на карте, которая ломает одну.
  ok('P3 несёт ОБА свойства физики, а не одно под другим именем',
    p3.fiction.hangAtOrBelowMv === p1.fiction.hangAtOrBelowMv
    && p3.fiction.boostStepsAboveCeiling === p2.fiction.boostStepsAboveCeiling);
  ok('у трёх карт РАЗНЫЕ посевы шума — иначе это одна карта под тремя именами',
    new Set(POLYGON_TRAPS.map((t) => t.fiction.noiseSeed)).size === 3);
  ok('каждая карта несёт расписку целиком: что ловит · что обязан прибор · чем грозит · чем судится',
    POLYGON_TRAPS.every((t) => t.traps && t.mustDo && t.otherwise && t.judgedBy && t.breaks));

  ok('сверка: предсказание сбылось ровно — ok',
    verdictAgainstPrediction([G_JOURNAL], [G_JOURNAL]).ok === true);
  ok('сверка: сторож НЕ сработал — недостача названа',
    (() => { const v = verdictAgainstPrediction([G_JOURNAL], []); return v.ok === false && v.missing[0] === G_JOURNAL; })());
  ok('сверка: ЛИШНИЙ красный — тоже НЕ ok, и он назван (P71-AC7: ровно, а не хотя бы)',
    (() => { const v = verdictAgainstPrediction([G_JOURNAL], [G_JOURNAL, G_ENVELOPE]); return v.ok === false && v.extra[0] === G_ENVELOPE; })());
  ok('сверка: порядок сторожей на совпадение НЕ влияет',
    verdictAgainstPrediction([G_JOURNAL, G_ENVELOPE], [G_ENVELOPE, G_JOURNAL]).ok === true);

  console.log(`ИТОГ: блоков ${pass + fail}, зелёных ${pass}, красных ${fail}`);
  return fail === 0 ? 0 : 1;
}

/**
 * ПРОГНАТЬ ТРИ ЛОВУШКИ и сверить наблюдение с ПРЕДСКАЗАНИЕМ, записанным в карте.
 * Дорого (настоящие развёртки, минуты) — поэтому отдельной командой, а не в батарее.
 */
async function cmdRun() {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const poly = await import('./polygon.mjs');
  const { judgeRun } = await import('./polygon-guards.mjs');

  console.log('ЛОВУШКИ ПОЛИГОНА — три карты: одну вещь ломает, вторую ломает, обе ломает');
  console.log('⚠️ КРАСНЫЙ ЗДЕСЬ ДОКАЗЫВАЕТ, ЧТО ПОЛИГОН УМЕЕТ ЛОВИТЬ, а НЕ дефект движка.\n');

  const derived = deriveAll({ from: 'curves' });
  let bad = 0;
  for (const d of derived) {
    if (!d.ok) { bad++; console.log(`🔴 ${d.name}: не собралась — ${d.why}`); continue; }
    mkdirSync(d.outDir, { recursive: true });
    const file = path.join(d.outDir, `${d.name}.json`);
    writeFileSync(file, `${JSON.stringify(d.card, null, 2)}\n`, 'utf8');

    const band = d.card.trap.band;
    const r = poly.runCardFile({ cardFile: file, fromMhz: band.fromMhz, toMhz: band.toMhz });
    if (!r.ok) { bad++; console.log(`🔴 ${d.name}: прогон не состоялся — ${r.why}`); continue; }
    // Отпечаток подставляется один и тот же: сторож И5 — свойство ПАКЕТА, и на ловушках он не судит.
    r.evidence.fingerprintBefore = { trap: true };
    r.evidence.fingerprintAfter = { trap: true };
    const j = judgeRun(r.evidence);
    const actual = j.failures.map((f) => f.name);
    const v = verdictAgainstPrediction(d.card.trap.mustRedden, actual);

    console.log(`${v.ok ? '✅' : '🔴'} ${d.name} (${d.card.trap.breaks}) — ${r.seconds.toFixed(1)} с`);
    console.log(`     ОБЕЩАНО: ${d.card.trap.mustRedden.join(' + ') || '—'}`);
    console.log(`     ВЫШЛО:   ${actual.join(' + ') || '— (все сторожа зелёные)'}`);
    if (!v.ok) {
      bad++;
      if (v.missing.length) console.log(`     🔴 НЕ СРАБОТАЛ: ${v.missing.join(' · ')} — сторож слеп ЛИБО карта не ломает обещанного`);
      if (v.extra.length) console.log(`     🔴 ЛИШНИЙ: ${v.extra.join(' · ')} — сторож ловит ЧУЖОЕ, независимость нарушена`);
    }
    for (const f of j.failures) console.log(`     улика [${f.name}]: ${f.why}`);
    console.log('');
  }
  console.log(bad === 0
    ? 'ИТОГ: все три ловушки сработали РОВНО как обещано — полигон умеет ловить.'
    : `ИТОГ: расхождений ${bad} — и каждое есть НАХОДКА, а не повод подогнать ожидание.`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--selftest')) process.exit(cmdSelftest());
  if (process.argv.includes('--run')) process.exit(await cmdRun());
  console.log('Использование: --selftest | --run   (--run гоняет три ловушки настоящими развёртками, минуты)');
}
