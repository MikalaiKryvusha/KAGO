// =================================================================================================
// THE BENCH MEASURES THE ENGINE (epic 03 phase 3, `plans/19` §4.5 · E3-AC10)
// =================================================================================================
//
// `researches/09` §4 SIZED this epic with arithmetic: 9 700 rungs / 67 h literal · 1 900 / 13 h
// collapsed · 700–1 000 / 5–7 h on the owner's step ladder · ≈250 / 1.7 h once his seeding is on.
// Those four numbers decided the shape of the shipped plan, and **not one of them has ever been
// checked against a running engine.** An estimate that is never checked is a number that drifts, and
// this project has already paid twice for trusting an unchecked figure it inherited (the 250 W power
// floor, the absent hotspot sensor — `MASTER_PLAN.md`).
//
// ─── WHAT THIS CAN AND CANNOT MEASURE TODAY, STATED BEFORE THE FIRST NUMBER ───────────────────────
//
// The 1.7 h figure is the cost of the SHIPPED plan, and the shipped plan needs two things today's
// engine does not have: the owner's step ladder and his neighbour seeding. Both are `plans/15`
// deliverables. So this instrument reports THREE kinds of row and never blurs them:
//
//   ЗАМЕРЕНО    — the real `searchEdge` ran on the bench and this is what it cost.
//   ПОСЧИТАНО   — arithmetic over the FIXTURE's own numbers (its edges, its grid), no engine involved.
//   ЖДЁТ        — needs `plans/15`; the row exists so it cannot be forgotten, and it is never green.
//
// ─── AND THE ONE DIVERGENCE THAT IS ALREADY KNOWN, NAMED RATHER THAN ABSORBED (E3-AC10) ───────────
//
// The 1.7 h estimate assumes the seed USUALLY holds — the owner's own rule was «очень редко — выше,
// почти не бывает такого». On `benches/cards/rtx5070ti.json` the seed would be REJECTED on 111 of 389
// frequencies (28.5 %), because the card's tremble is ±8 mV while its smallest rung is 5 mV. That is
// a property of the FIXTURE, not of the engine, and a measured cost above 1.7 h on this card must be
// attributed to it rather than absorbed into a verdict about the engine.
//
// The card is deliberately NOT tuned down to make the estimate look right (`plans/19` §4.5): a
// fixture adjusted until it agrees with an estimate is a fixture that has stopped checking it.
//
// [TESTED: 2026-08-15 21:0x · `npm run measure` → exit 0, and it produced two results worth more
//  than the instrument.
//
//  ONE — THE ESTIMATE SURVIVED THE HARSH FIXTURE, and the worry that shaped `plans/19` §4.5 did not
//  reproduce. A 28.5 % seed-rejection rate costs **+11 %** (278 rungs against the estimated 250,
//  1.9 h against 1.7), not a multiple — because a refused seed does not fall back to a 5 mV crawl,
//  it falls back to the OWNER'S LADDER, and that ladder is cheap. The seeding optimisation is robust
//  to a rejection rate three times what he described. Recorded as a refuted concern rather than a
//  quietly-dropped one.
//
//  TWO — FACT 38 REPRODUCED ON THE BENCH WITHOUT BEING ASKED TO. Of six representative frequencies,
//  THREE (2002 · 1702 · 1102 MHz) could not be searched at all: below the curve's cap floor
//  (`верх − 1000` ≈ 2157 MHz) the shipped write shape does not exist, and the engine refuses BEFORE
//  the first rung. That is the engine being right, and it is the whole reason epic 02 introduces the
//  clock pin — now visible as a measurement instead of an argument.
//
//  Two defects of this instrument were found by its own first run and fixed: it read
//  `grid[1] - grid[0]` as «the minimum rung» and printed 10 mV on a grid documented as non-uniform
//  (true minimum 5 mV — the inversion count was undercounted 27 against the true 83), and it rendered
//  a refused write as a one-rung search. Both now computed and named.
//
//  What is NOT measured, and is labelled so in the output: the «плюс затравка» row rests on an
//  ASSUMPTION (a held seed costs 2 rungs, a refused one the full ladder). Only a live sweep engine
//  can replace that with an observation — `plans/15`.]

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCard, GOLDEN_CHECKSUM, PROVABILITY_LINE } from './virtual-gpu.mjs';
import { runSearch } from './trap-suite.mjs';

const CARD_PATH = join('benches', 'cards', 'rtx5070ti.json');

/** `researches/09` §4, quoted as data so a drift between the doc and this instrument is visible. */
export const ESTIMATE = Object.freeze({
  secondsPerRung: 25,
  strategies: [
    { id: 'буквальная', rungs: 9700, hours: 67, note: 'все 389 частот от стока по 5 мВ' },
    { id: 'схлопнутая', rungs: 1900, hours: 13, note: '75 обслуживающих точек, от стока по 5 мВ' },
    { id: 'лестница шагов', rungs: 850, hours: 6, note: '25/10/5 мВ по глубине, от стока каждый раз' },
    { id: 'плюс затравка', rungs: 250, hours: 1.7, note: 'ОТГРУЖАЕМЫЙ план — спуск от соседки сверху' },
  ],
});

/** Rungs to reach depth `d` on the owner's ladder (25 mV / 10 mV / 5 mV by depth from stock). */
export function rungsOnOwnersLadder(depthMv) {
  const d = Math.max(0, depthMv);
  return Math.ceil(Math.min(d, 100) / 25)
    + Math.ceil(Math.min(Math.max(d - 100, 0), 50) / 10)
    + Math.ceil(Math.max(0, d - 150) / 5);
}

/**
 * The FIXTURE's own arithmetic — no engine runs here. Two questions: how deep is this card's edge at
 * each frequency, and how often would the neighbour seed be refused.
 */
export function computeFromFixture(card) {
  const asc = [...card.fiction.edge].sort((a, b) => a.mhz - b.mhz);
  const grid = card.voltageGridMv;
  const rungAbove = (mv) => grid.find((g) => g > mv) ?? grid[grid.length - 1];
  // THE SMALLEST RUNG IS COMPUTED, NEVER TAKEN FROM THE FIRST PAIR. This grid is non-uniform BY
  // MEASUREMENT — 5 mV in 94 places and 10 mV in 32 — and its first two entries happen to be 10 apart.
  // Reading `grid[1] - grid[0]` as «the minimum step» therefore printed 10 mV and undercounted the
  // inversions deeper than one rung as 27 when the true figure is 83. A non-uniform grid is stated as
  // such in three documents; taking one sample of it as the rule is how a stated fact stops binding.
  const minRungMv = Math.min(...grid.slice(1).map((v, i) => v - grid[i]));

  let seedRefused = 0;
  const drops = [];
  for (let i = 1; i < asc.length; i++) {
    const higher = asc[i];
    const lower = asc[i - 1];
    const drop = Number((lower.edgeMv - higher.edgeMv).toFixed(1));
    if (drop > 0) drops.push(drop);
    // The seed is the lowest rung that still HELD for the neighbour above — i.e. the rung at or above
    // its edge. It is refused when that rung is already below this frequency's own edge.
    if (rungAbove(higher.edgeMv) < lower.edgeMv) seedRefused++;
  }
  drops.sort((a, b) => a - b);

  // Cost on the owner's ladder, from stock, for the 75 serving points the epic actually walks.
  const perPoint = asc.map((r) => rungsOnOwnersLadder(r.stockMv - r.edgeMv));
  const collapsedFactor = 75 / asc.length;
  const ladderRungs = Math.round(perPoint.reduce((s, x) => s + x, 0) * collapsedFactor);

  // With seeding: a held seed costs a couple of rungs to confirm; a refused one falls back to the
  // full ladder from stock. That is the owner's own rule (E2-AC11), priced.
  const refusedShare = seedRefused / asc.length;
  const avgLadder = ladderRungs / 75;
  const seededRungs = Math.round(75 * ((1 - refusedShare) * 2 + refusedShare * avgLadder));

  return {
    frequencies: asc.length,
    minRungMv,
    seedRefused,
    refusedShare,
    inversions: drops.length,
    medianDropMv: drops[Math.floor(drops.length / 2)] ?? 0,
    maxDropMv: drops[drops.length - 1] ?? 0,
    deeperThanRungMv: drops.filter((d) => d > minRungMv).length,
    ladderRungs,
    seededRungs,
  };
}

export async function measure({ frequencies = [3090, 2842, 2400, 2002, 1702, 1102] } = {}) {
  const cardR = loadCard(CARD_PATH);
  if (!cardR.ok) { console.error(`ОТКАЗ: ${cardR.why}`); return { ok: false }; }
  const card = cardR.card;
  const stress = await import('./stress-tester.mjs');
  const golden = { gpu: { driver: card.stamp.driver, vbios: card.stamp.vbios }, args: [], checksum: GOLDEN_CHECKSUM };
  const stampOk = stress.checkGoldenStamp(golden, { probed: true, driver: card.stamp.driver, vbios: card.stamp.vbios }, []);

  const fx = computeFromFixture(card);
  const edgeAt = new Map(card.fiction.edge.map((r) => [r.mhz, r]));

  console.log('ИЗМЕРЕНИЕ ДВИЖКА ПРОТИВ ОЦЕНКИ researches/09 §4 (E3-AC10)\n');
  console.log('Три рода строк, и они НЕ смешиваются: ЗАМЕРЕНО — движок правда бежал · ПОСЧИТАНО —');
  console.log('арифметика по числам самой фикстуры, движок не участвовал · ЖДЁТ — нужен plans/15.\n');

  // ---- ЗАМЕРЕНО: what today's searchEdge actually costs per frequency, on a KNOWN edge
  console.log('ЗАМЕРЕНО — сегодняшний searchEdge на стенде, край известен заранее:\n');
  console.log('  частота    ступеней   край карты   посл. PASS → первый отказ   чем кончилось');
  console.log('  ' + '-'.repeat(88));
  let measuredRungs = 0;
  let measuredMs = 0;
  let refusedByFloor = 0;
  for (const mhz of frequencies) {
    const e = edgeAt.get(mhz);
    if (!e) continue;
    const t0 = Date.now();
    const r = await runSearch(card, { seed: 21, alwaysPass: false, capMhz: mhz, stress, golden, stampOk });
    measuredMs += Date.now() - t0;

    // WHY THE SEARCH STOPPED, NOT JUST HOW FAR IT GOT. Three frequencies below reported «1 ступень»
    // in the first run and it read like a one-rung search; it was not. Below the curve's cap floor
    // (`верх − 1000` ≈ 2157 MHz, STATUS fact 38) the curve CANNOT hold a ceiling, so the shipped write
    // shape is refused before any rung is walked. That is the engine being right, and a table that
    // renders it as a cheap search is a table that would make a reader conclude the opposite.
    const refused = r.out.attempts.some((a) => a.verdict === null) && r.out.lastPass === null;
    const cheap = refused ? 'ОТКАЗ ЗАПИСИ: кривой не удержать потолок ниже пола 2157 МГц (факт 38)'
      : (r.out.firstFail === null ? 'край не встречен — остановила граница сессии' : 'край найден');
    if (refused) refusedByFloor++; else measuredRungs += r.rungs;
    const found = refused ? '—' : `${r.out.lastPass ?? '—'} → ${r.out.firstFail ?? '—'} МГц`;
    console.log(`  ${String(mhz).padStart(5)} МГц ${String(refused ? '—' : r.rungs).padStart(9)} `
      + `${String(e.edgeMv).padStart(9)} мВ   ${found.padEnd(20)}   ${cheap}`);
  }
  if (refusedByFloor) {
    console.log(`\n  ⚠️ ${refusedByFloor} частот из ${frequencies.length} НЕ ИСКАЛИСЬ вовсе — и это верное `
      + 'поведение, а не пропуск:');
    console.log('     ниже пола потолка кривой отгружаемая форма записи не существует, и движок отказывает');
    console.log('     ДО первой ступени. Их край найдёт закрепление частоты — прибор фазы 2 эпика 02.');
  }
  const searched = frequencies.length - refusedByFloor;
  console.log(`\n  Итого: искалось ${searched} частот из ${frequencies.length}, ступеней ${measuredRungs}, `
    + `стена стенда ${(measuredMs / 1000).toFixed(1)} с (стенд секунд прожига не тратит — см. блок «ЧАСЫ»).`);
  console.log(`  На живой карте те же ${measuredRungs} ступеней стоили бы `
    + `${((measuredRungs * ESTIMATE.secondsPerRung) / 60).toFixed(0)} минут (25 с на ступень, researches/09 §4).`);

  // ---- ПОСЧИТАНО: the fixture's own numbers against the four strategies
  console.log('\nПОСЧИТАНО — по числам самой фикстуры, против стратегий researches/09 §4.');
  console.log('ДОПУЩЕНИЕ НАЗВАНО, потому что это арифметика, а не замер: удержавшаяся затравка стоит');
  console.log('2 ступени на подтверждение, отвергнутая — полную лестницу от стока. Проверить это может');
  console.log('только живой прогон движка развёртки, и он в строке «ЖДЁТ».\n');
  console.log('  стратегия            оценка, ступеней   оценка, ч   по фикстуре   расхождение');
  console.log('  ' + '-'.repeat(78));
  const rows = [
    ['лестница шагов', ESTIMATE.strategies[2], fx.ladderRungs],
    ['плюс затравка', ESTIMATE.strategies[3], fx.seededRungs],
  ];
  for (const [name, est, actual] of rows) {
    const hours = (actual * ESTIMATE.secondsPerRung) / 3600;
    const delta = ((actual / est.rungs - 1) * 100);
    console.log(`  ${name.padEnd(20)} ${String(est.rungs).padStart(16)} ${String(est.hours).padStart(11)} `
      + `${String(actual).padStart(13)} ${(delta >= 0 ? '+' : '') + delta.toFixed(0) + ' %'} (${hours.toFixed(1)} ч)`);
  }

  // ---- THE DIVERGENCE, ATTRIBUTED (E3-AC10: named, never absorbed)
  const inflation = fx.seededRungs / ESTIMATE.strategies[3].rungs;
  console.log('\n🔴 РАСХОЖДЕНИЕ НАЗВАНО, А НЕ ПОГЛОЩЕНО — и оно от ФИКСТУРЫ, не от движка:\n');
  console.log(`  Затравка соседкой отвергается на ${fx.seedRefused} частотах из ${fx.frequencies} `
    + `(${(fx.refusedShare * 100).toFixed(1)} %).`);
  console.log(`  Слово владельца было «очень редко — выше, почти не бывает такого». `
    + `${(fx.refusedShare * 100).toFixed(0)} % — это не «почти не бывает».`);
  console.log(`  Причина механическая: дрожь края ±${card.fiction.noise.amplitudeMv} мВ при минимальной `
    + `ступени сетки ${fx.minRungMv} мВ — шум по построению крупнее ступени.`);
  console.log(`  Глубины инверсий: медиана ${fx.medianDropMv} · максимум ${fx.maxDropMv} мВ · `
    + `глубже одной ступени ${fx.deeperThanRungMv} из ${fx.frequencies}.`);
  console.log(`\n  ✅ И ВОТ ЧТО ЭТО СТОИТ НА САМОМ ДЕЛЕ: +${((inflation - 1) * 100).toFixed(0)} % `
    + `(${fx.seededRungs} ступеней против ${ESTIMATE.strategies[3].rungs}, то есть `
    + `${((fx.seededRungs * ESTIMATE.secondsPerRung) / 3600).toFixed(1)} ч против ${ESTIMATE.strategies[3].hours}).`);
  console.log('  Оценка ВЫДЕРЖАЛА жёсткую фикстуру, и это сам по себе результат: затравка остаётся');
  console.log('  выгодной даже когда её отвергают на трети частот, потому что откат стоит не полного');
  console.log('  спуска по 5 мВ, а лестницы владельца — а она дёшева. Опасение, что фикстура раздует');
  console.log('  цену кратно, проверено и НЕ подтвердилось.');
  console.log('\n  Карта всё равно оставлена жёсткой намеренно: фикстура, подкрученная до согласия с');
  console.log('  оценкой, перестаёт эту оценку проверять (plans/19 §4.5). На кремнии владельца доля');
  console.log('  инверсий своя, и её ещё никто не мерил — это работа фазы 2 эпика 02.');

  // ---- ЖДЁТ
  console.log('\nЖДЁТ движка развёртки (plans/15) — строки существуют, чтобы их не забыли:\n');
  console.log('  · лестница шагов 25/10/5 мВ — сегодня движок шагает своей, не владельца');
  console.log('  · затравка соседкой и её откат — измерить ДОЛЮ откатов живым прогоном, а не арифметикой');
  console.log('  · полный проход по всем 75 обслуживающим точкам одной командой');
  console.log('  · стена по полосам — оценка обещает делимость, и её надо проверить');

  console.log(`\n${PROVABILITY_LINE}`);
  return { ok: true, measuredRungs, fixture: fx };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  measure()
    .then((r) => process.exit(r.ok ? 0 : 1))
    .catch((e) => { console.error(e); process.exit(1); });
}
