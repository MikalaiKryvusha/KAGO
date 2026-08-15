// =================================================================================================
// THE CONTRACT SUITE — one set of cases, stated over the INTERFACE, run against BOTH the virtual card
// and the live one (epic 03 phase 3, `plans/19` §4.2–§4.4)
// =================================================================================================
//
// WHY THIS IS THE EPIC'S REAL DELIVERABLE AND THE MOCK IS NOT (`researches/10` §4.3): every fake in
// the industry fails the same way — it drifts from the thing it stands in for, silently, in the
// direction nobody re-read. The one answer the field has is the CONTRACT TEST: the same assertions
// run against both sides, so drift becomes a red test instead of a false green.
//
// ─── THE TWO COLUMNS, AND WHY THE LIVE ONE STARTS EMPTY BY CONSTRUCTION ───────────────────────────
//
// Every case is reported per SIDE. The live column is built from RUNS, so an unrun case has nothing
// to render green — it reads «не прогонялась». That is E3-AC5 made mechanical rather than promised:
// the bench's green may never become a claim about silicon by accident.
//
// ─── WHAT THIS SUITE DOES NOT DO ──────────────────────────────────────────────────────────────────
//
// It does not write to the GPU. `--live` runs the READ-ONLY half of the contract against the real
// card; the writing half stays where the project already gates it, and every case declares which
// half it is. A contract suite that quietly wrote to the owner's card to «check parity» would be the
// worst instrument this project has ever built.
//
// ─── MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016) ─────────────────────────────────────────
//
//   - a seam dropped from the case table          → «КОНТРАКТ: все три шва покрыты»
//   - the live column filled from a virtual run   → «КОНТРАКТ: живая колонка не заполняется виртуальным прогоном»
//   - a branch on the bench planted in the engine → «ШОВ: ноль веток „мы на моке“ в движке»
//   - the bench shortens a burn by itself         → «ЧАСЫ: секунды тратит НАГРУЗКА, и стенд про это не врёт»
//
// [TESTED: 2026-08-15 20:4x · `npm run contract` → 7 assertions, 0 failures; all six contract cases
//  green on the virtual side and «не прогонялась» on the live one, which is the only legal reading
//  until a live run happens. The branch grep covered 22 engine files and found zero.
//
//  AND IT SETTLED A CLAIM BY MEASUREMENT RATHER THAN BY READING. `plans/16` §8.3 said «движок спит
//  по-настоящему эти секунды», and the numbers say otherwise: a 6-second burn on the bench completes
//  in 0 ms. The plan was right about the LIVE path and wrong about the bench, for a reason that is
//  structural rather than a bug — the seconds are spent by the WORKLOAD PROCESS, and the workload
//  process is exactly what the bench replaces. So the bench does not «shorten» anything; that time
//  was never its to spend. What follows is the part worth carrying: the OUTCOME stays honest
//  (duration enters the model as exposure — a 1 s burn finds strictly less than a 10 s one, asserted
//  here), while ANYTHING THAT DEPENDS ON TIME PASSING is not exercised at all. `burnRealSeconds`
//  buys the seconds back at their real price: measured 1016 ms for one second.]

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import config from '../config.mjs';
import { loadCard, virtualCard, GOLDEN_CHECKSUM, PROVABILITY_LINE } from './virtual-gpu.mjs';

const CARD_PATH = join('benches', 'cards', 'rtx5070ti.json');

/** The three seams the bench implements, and the methods each one owes (`researches/10` §3.1). */
export const SEAMS = Object.freeze({
  'бэкенд карты': ['query', 'setPowerLimitWatts', 'lockGraphicsClocksMhz', 'resetGraphicsClocks'],
  'бэкенд кривой': ['writeRaiseAndCap', 'readCurveOffsets', 'zeroCurve', 'close'],
  'оракул': ['run'],
});

/**
 * THE CASES. Each is stated over the interface and carries the SIDE it is legal on — `both` runs
 * against the virtual card and the live one, `virtual` is about the fiction and has no live meaning.
 * A case never names an implementation; that is the whole point of a contract.
 */
export const CASES = Object.freeze([
  {
    id: 'C1', seam: 'бэкенд карты', side: 'both', writes: false,
    what: 'query отдаёт запрошенные поля и ничего не выдумывает',
  },
  {
    id: 'C2', seam: 'бэкенд карты', side: 'both', writes: true,
    what: 'закрепление частоты читается обратно, а снятие возвращает карте свободу',
  },
  {
    id: 'C3', seam: 'бэкенд кривой', side: 'both', writes: true,
    what: 'записанный вектор перечитывается тем же самым, а обнуление доказывается перечитыванием',
  },
  {
    id: 'C4', seam: 'бэкенд кривой', side: 'both', writes: false,
    what: 'отказы R11 / R13 / R12 принимает ОДНА функция, и оба бэкенда её зовут',
  },
  {
    id: 'C5', seam: 'оракул', side: 'both', writes: false,
    what: 'запускатель печатает строку KAGO-WORKLOAD, и вердикт по ней считает боевой stress-tester',
  },
  {
    id: 'C6', seam: 'оракул', side: 'virtual', writes: false,
    what: 'у карты есть придуманный край, и оракул ЧИТАЕТ обслуживающее напряжение с неё, а не получает его',
  },
]);

// =================================================================================================
// The virtual side
// =================================================================================================

async function runVirtualSide(card, stress) {
  const done = new Map();
  const pass = (id, note = '') => done.set(id, { state: 'OK', note });
  const flunk = (id, why) => done.set(id, { state: 'FAIL', why });

  const vc = virtualCard(card, { settleSamples: 0, seed: 3 });

  // C1 — query
  const q = vc.backend.query(['clocks.gr', 'power.limit']);
  pass('C1', `отдано полей ${Object.keys(q).length}`);
  if (!('clocks.gr' in q)) flunk('C1', `запрошенного поля нет в ответе: ${JSON.stringify(q)}`);

  // C2 — lock / release
  vc.backend.lockGraphicsClocksMhz(2400, 2400);
  const locked = vc.backend.query(['clocks.gr'])['clocks.gr'];
  vc.backend.resetGraphicsClocks();
  const freeA = vc.backend.query(['clocks.gr'])['clocks.gr'];
  const freeB = vc.backend.query(['clocks.gr'])['clocks.gr'];
  if (Number(locked) === 2400 && !(Number(freeA) === 2400 && Number(freeB) === 2400)) {
    pass('C2', `закреплено ${locked}, после снятия ${freeA}/${freeB}`);
  } else flunk('C2', `закреплено ${locked}, после снятия ${freeA}/${freeB}`);

  // C3 — write / read back / zero
  const w = await vc.curveBackend.writeRaiseAndCap(45, 2842, { cardMaxClockMhz: card.card.maxGraphicsMhz });
  const back = await vc.curveBackend.readCurveOffsets();
  const nonZero = (back.offsets ?? []).filter((x) => x !== 0).length;
  await vc.curveBackend.zeroCurve();
  const afterZero = await vc.curveBackend.readCurveOffsets();
  const zeroed = (afterZero.offsets ?? []).filter((x) => x !== 0).length;
  const sameBack = w.ok && back.ok && JSON.stringify(w.vector) === JSON.stringify(back.offsets);
  if (sameBack && nonZero > 0 && zeroed === 0) pass('C3', `ненулевых после записи ${nonZero}, после обнуления ${zeroed}`);
  else flunk('C3', `запись ${w.ok ? 'ок' : w.why}, ненулевых ${nonZero}, после обнуления ${zeroed}`);

  // C4 — the shared refusal. A vector ABOVE the card's own maximum must be refused (R13).
  const bad = await vc.curveBackend.writeRaiseAndCap(2000, null, { cardMaxClockMhz: card.card.maxGraphicsMhz });
  if (!bad.ok && bad.why) pass('C4', `отказано: ${String(bad.why).slice(0, 60)}…`);
  else flunk('C4', 'подъём выше максимума карты НЕ отвергнут — двойник мягче оригинала, и это худший из дефектов');

  // C5 — the real verdict logic over the bench's launcher
  const golden = { gpu: { driver: card.stamp.driver, vbios: card.stamp.vbios }, args: [], checksum: GOLDEN_CHECKSUM };
  const stampOk = stress.checkGoldenStamp(golden, { probed: true, driver: card.stamp.driver, vbios: card.stamp.vbios }, []);
  const fresh = virtualCard(card, { settleSamples: 0, seed: 3 });
  fresh.backend.lockGraphicsClocksMhz(2842, 2842);
  fresh.backend.query(['clocks.gr']);
  const burst = stress.runBurst({ name: 'sdc_fma', args: [], sustainSeconds: 10, run: (b, a) => fresh.oracle.run(b, a) });
  const v = stress.decideVerdict({ bursts: [burst], golden, stamp: stampOk, faults: { providers: [], faults: [] } });
  if (v.verdict === config.VERDICT.PASS) pass('C5', `вердикт ${v.verdict}, считал боевой код`);
  else flunk('C5', `на стоке ожидался PASS, получено ${v.verdict}: ${v.reason}`);

  // C6 — the oracle READS the voltage off the card
  const before = fresh.oracle.servingVoltageMv(2842);
  await fresh.curveBackend.writeRaiseAndCap(180, 2842, { cardMaxClockMhz: card.card.maxGraphicsMhz });
  const after = fresh.oracle.servingVoltageMv(2842);
  if (after < before) pass('C6', `подъём удешевил 2842 МГц: ${before} → ${after} мВ`);
  else flunk('C6', `подъём не изменил обслуживающее напряжение: ${before} → ${after}`);

  return done;
}

// =================================================================================================
// The suite
// =================================================================================================

export async function runContract({ live = false } = {}) {
  const results = [];
  const ok = (n, note = '') => results.push({ n, state: 'OK', note });
  const fail = (n, why) => results.push({ n, state: 'FAIL', why });
  const check = (n, cond, why = '', note = '') => (cond ? ok(n, note) : fail(n, why));

  const stress = await import('./stress-tester.mjs');

  // ---- 1. every seam is covered by at least one case (B3-AC4)
  const covered = new Set(CASES.map((c) => c.seam));
  check('КОНТРАКТ: все три шва покрыты',
    Object.keys(SEAMS).every((s) => covered.has(s)),
    `непокрытые: ${Object.keys(SEAMS).filter((s) => !covered.has(s)).join(', ') || '(нет)'}`,
    `швов ${Object.keys(SEAMS).length}, случаев ${CASES.length}`);

  // ---- 2. the virtual column
  const cardR = loadCard(CARD_PATH);
  check('КОНТРАКТ: карта стенда загружена', cardR.ok, cardR.why ?? '');
  const virtualDone = cardR.ok ? await runVirtualSide(cardR.card, stress) : new Map();

  // ---- 3. the live column — and it is EMPTY unless a live run actually happened
  //
  // Written as a separate map rather than as a flag on the case, because the property being guarded
  // is «nothing filled this in», and an absent entry states that better than any boolean.
  const liveDone = new Map();
  if (live) {
    fail('КОНТРАКТ: живая половина', 'живой прогон ещё не реализован — карта владельца не трогается '
      + 'этой командой ни на шаг (plans/19 §4.2 оставляет его на ворота фазы)');
  }

  // ---- 4. THE GUARD THAT MAKES THE TWO COLUMNS WORTH HAVING (B3-AC5)
  const leaked = CASES.filter((c) => liveDone.has(c.id) && !liveDone.get(c.id).fromLiveRun);
  check('КОНТРАКТ: живая колонка не заполняется виртуальным прогоном',
    leaked.length === 0,
    `протекло случаев: ${leaked.map((c) => c.id).join(', ')}`,
    liveDone.size === 0 ? 'живая колонка честно пуста' : `живых записей ${liveDone.size}`);

  // ---- 5. E3-AC1 — ZERO branches on the bench inside the engine, checked BY THE SUITE
  //
  // In the suite and not in a session's memory of having grepped once: a check that lives in a
  // person's habit is a check that stops running the day the person changes.
  const engineFiles = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mjs')) engineFiles.push(p);
    }
  };
  walk('automation-engine');
  const BENCH_OWN = ['virtual-gpu.mjs', 'trap-suite.mjs', 'seam-contract.mjs'];
  const BENCH_IDENT = /\b(isVirtual|isMock|onBench|virtualMode|benchMode|IS_VIRTUAL|IS_MOCK|usingBench)\b/;
  const suspects = [];
  for (const f of engineFiles) {
    if (BENCH_OWN.some((b) => f.endsWith(b))) continue;
    const text = readFileSync(f, 'utf8');
    text.split(/\r?\n/).forEach((line, i) => {
      // CODE, not prose: the words are legal in a comment (this very file explains them), and banning
      // the word instead of the branch makes a check nobody can keep green.
      const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
      if (!isComment && BENCH_IDENT.test(line)) suspects.push(`${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  check('ШОВ: ноль веток «мы на моке» в движке (E3-AC1)',
    suspects.length === 0, suspects.join(' | '), `просмотрено файлов ${engineFiles.length - BENCH_OWN.length}`);

  // ---- 6. THE CLOCK (B3-AC7). Measured, and the answer is NOT what `plans/16` §8.3 assumed.
  const card = cardR.ok ? cardR.card : null;
  if (card) {
    const t0 = Date.now();
    const fast = virtualCard(card, { settleSamples: 0, seed: 9 });
    stress.runBurst({ name: 'sdc_fma', args: [], sustainSeconds: 6, run: (b, a) => fast.oracle.run(b, a) });
    const fastMs = Date.now() - t0;

    const t1 = Date.now();
    const slow = virtualCard(card, { settleSamples: 0, seed: 9, burnRealSeconds: true });
    stress.runBurst({ name: 'sdc_fma', args: [], sustainSeconds: 1, run: (b, a) => slow.oracle.run(b, a) });
    const slowMs = Date.now() - t1;

    check('ЧАСЫ: по умолчанию стенд секунд НЕ тратит — их тратила НАГРУЗКА, а её стенд и заменяет',
      fastMs < 500, `прожиг на 6 с занял ${fastMs} мс`, `6 с прошли за ${fastMs} мс`);
    check('ЧАСЫ: и стенд умеет их потратить, когда прогону нужно настоящее время',
      slowMs >= 950, `прожиг на 1 с с burnRealSeconds занял ${slowMs} мс`, `1 с заняла ${slowMs} мс`);
    check('ЧАСЫ: длительность всё равно входит в МОДЕЛЬ — короткий прожиг находит меньше (B2-AC3)',
      fast.oracle.failureProbability({ mhz: 2842, voltageMv: 860, seconds: 1 })
        < fast.oracle.failureProbability({ mhz: 2842, voltageMv: 860, seconds: 10 }),
      'вероятность отказа не зависит от длительности — ускорение стало бы бесплатным враньём');
  }

  return report(results, virtualDone, liveDone);
}

function report(results, virtualDone, liveDone) {
  for (const r of results) {
    if (r.state === 'OK') console.log(`OK   ${r.n}${r.note ? `  — ${r.note}` : ''}`);
    else { console.log(`FAIL ${r.n}`); if (r.why) console.log(`       причина: ${r.why}`); }
  }

  console.log('\nКОНТРАКТ ПО ШВАМ — одни и те же случаи, две стороны:\n');
  console.log('  случай  шов                 виртуальная      живая');
  console.log('  ' + '-'.repeat(74));
  let failed = results.filter((r) => r.state === 'FAIL').length;
  for (const c of CASES) {
    const v = virtualDone.get(c.id);
    const l = liveDone.get(c.id);
    const vs = c.side === 'live' ? 'неприменимо' : (v ? (v.state === 'OK' ? 'ПРОШЛА' : 'ПРОВАЛ') : 'не прогонялась');
    const ls = c.side === 'virtual' ? 'неприменимо' : (l ? (l.state === 'OK' ? 'ПРОШЛА' : 'ПРОВАЛ') : 'не прогонялась');
    if (v && v.state === 'FAIL') failed++;
    console.log(`  ${c.id.padEnd(7)} ${c.seam.padEnd(19)} ${vs.padEnd(16)} ${ls}`);
    console.log(`          ${c.what}`);
  }

  const liveGreen = [...liveDone.values()].filter((x) => x.state === 'OK').length;
  console.log(`\nКОНТРАКТНЫЙ НАБОР: утверждений ${results.length}, провалов ${failed}. `
    + `Случаев ${CASES.length}: виртуальная сторона прогнана, живая — ${liveGreen} из ${CASES.filter((c) => c.side !== 'virtual').length}.`);
  console.log('«НЕ ПРОГОНЯЛАСЬ» — это честный ответ и единственный законный для живой стороны, пока живого '
    + 'прогона не было. Зелёной она от виртуального прогона не становится (E3-AC5).');
  console.log(PROVABILITY_LINE);
  return { total: results.length, failed };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runContract({ live: process.argv.includes('--live') })
    .then((r) => process.exit(r.failed ? 1 : 0))
    .catch((e) => { console.error(e); process.exit(1); });
}
