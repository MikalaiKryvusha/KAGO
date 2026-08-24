// =================================================================================================
// TRAP SUITE — the bench proves itself RED before anyone trusts its green (epic 03 phase 3,
// `plans/19` §4.1 and §4.7)
// =================================================================================================
//
// WHAT THIS IS FOR, IN ONE SENTENCE: a bench that cannot fail is a bench that certifies nothing, so
// every trap card here must make a WRONG engine visibly wrong and leave the RIGHT one alone. A trap
// that stays green either way is deleted, not kept (`plans/19` B3-AC2).
//
// THE ENGINE UNDER TEST IS THE REAL ONE. This suite calls `engine.searchEdge` — the same function the
// owner's card is driven by — through its own injected `runStepFn` seam. There is no second copy of
// the search here, and no branch anywhere in `engine.mjs` that knows a bench exists (E3-AC1).
//
// ─── WHAT «A WRONG ENGINE» MEANS HERE, NAMED SO NOBODY OVERREADS THE GREEN ────────────────────────
//
// The wrong engine is modelled at the seam this suite owns: a step function whose verdict is ALWAYS
// PASS. That is not a strawman — it is the exact failure `bugs/02` was closed over, where a guard
// fired, was explained away, and the search then walked seven rungs and reported an edge in
// millivolts the card had never been at. An engine that cannot see a failure walks past every edge.
//
// What this suite does NOT model is a wrong LADDER or a wrong bisection; those are mutated in
// `engine --selftest`, which is where they belong.
//
// ─── THE CLASS SPLIT, AND HOW IT ENDED ────────────────────────────────────────────────────────────
//
// Until 2026-08-16 three of the five traps judged behaviour that did not exist: the engine was the
// phase-5 search, with no write-ahead journal, no neighbour seeding, no `lever-limited` verdict and
// no two-hangs stop. Their cards and their assertions shipped anyway and were reported PENDING —
// E3-AC5's rule (no claim about an unrun half) applied inside the epic.
//
// **`plans/15` §4.5 built the sweep, and all four pending assertions now RUN.** The pending state
// ended the only honest way a waiver can: its condition came true. What they run against is the
// shipped `sweepRange`, driven through this suite's own seam — and for T2 and T5 through REAL child
// processes that REALLY die at the rung their card names, because a throw unwinds and lets `finally`
// blocks run, which is precisely what a hang does not do (R10).
//
// ─── MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016) ─────────────────────────────────────────
//
//   - the wrong engine reads the real verdict     → «T1: НЕПРАВИЛЬНЫЙ движок проходит край насквозь»
//   - a class-B assertion silently disappears     → «утверждение НАПИСАНО и ПРОГНАНО» (все три)
//   - the deterministic trap hang ignored         → «T2: процесс УМИРАЕТ по-настоящему»
//   - the forced inversion dropped                → «T3: инверсия НАСТОЯЩАЯ»
//   - the sweep ignores the blocked-rung set      → «T5: отказаться от третьей попытки…»
//   - a lever wall reported as an edge            → «T4: сказать „предел рычага“…»
//
// ─── ЧТО ДОБАВИЛ 2026-08-23 (`plans/25` шаг 1.3) ──────────────────────────────────────────────────
//
// До этого дня стенд ВСЕГДА закреплял частоту и ВСЕГДА возвращал заказ как выданное. То есть он не
// умел разойтись с заказом ВООБЩЕ, честно печатал «ЗАКАЗ ↔ ВЫДАЧА: не разошлись ни разу» — и главный
// путь метода владельца (строка пишется по ВЫДАННОЙ частоте) не репетировался ни разу. Слово
// владельца, 2026-08-23: *«заказать частоту у видеокарты невозможно. Можно тюнить ту частоту,
// которую она выдаёт»*.
//
// Три правки, и все три — о верности стенда живому пути, а не о новых возможностях:
//   · `makeSweepStepFn` слушается ФОРМЫ, которую ему выдали, и закрепляет ТОЛЬКО когда держатель —
//     закрепление (`bugs/26` п. 1); выданную частоту СПРАШИВАЕТ у карты, а не повторяет заказ;
//   · документ строится на ВЕСЬ диапазон карты, как `loadCurveDoc({})` на живом пути, — обрезанный
//     полосой документ ронял прогон, когда просевшая частота выпадала из него;
//   · шестая ловушка T6: карта, чей регулятор буста никогда не подходит к потолку ближе 60 МГц.
//
// ЧТО ЭТО НЕМЕДЛЕННО НАШЛО, и это и есть цена вопроса: `bugs/34` — сторож глубины сравнивал
// доказанное на ЗАКАЗАННОЙ частоте с напряжением, обслуживающим ВЫДАННУЮ, и останавливал развёртку
// на первой же ступени законного заказа.
//
// ⚠️ И ОДНО УТВЕРЖДЕНИЕ T3 ПЕРЕНАЦЕЛЕНО — читать его комментарий до того, как «восстанавливать».
//
// [TESTED: 2026-08-23 10:3x · `npm run traps` → **35 assertions, 0 failures, 0 pending**; шесть
//  ловушек. Мутации CV (стенд снова закрепляет всегда), CW (снова повторяет заказ), CX (у карты
//  отняли ограничитель регулятора), CY (карта под кривой не проседает), CZ (документ снова из
//  полосы), DA (оракул судит по последнему чтению) — каждая покраснила свои утверждения.
//
//  EARLIER: 2026-08-16 00:2x · `npm run traps` → **27 assertions, 0 failures, 0 pending**. T2's second
//  half and T5's two deaths are child processes that exited 70 with no `finally`, and the re-launch
//  named the killed rung — 2842 MHz / 995 mV — closing it ЗАВИС from the shipped journal. T3 rejected
//  its seed and printed the rejection; T4 closed two frequencies `lever-limited` and zero as edges.
//  Mutations for the two new addressees are recorded in `plans/15` §4.5.
//
//  EARLIER: 2026-08-15 20:2x · 22 assertions, 0 failures, 4 honestly pending.
//  T1 is the load-bearing one and it DISCRIMINATES: the right engine stops after 2 rungs, the wrong
//  one walks 13 — on three seeds each, through the REAL `searchEdge`, the REAL `runBurst` and the
//  REAL `decideVerdict`. T2 kills a child process for real at the rung its CARD names (exit 70, no
//  `finally`, the intent written beforehand survived). All four mutations above reddened their own
//  named block and nothing else.
//
//  ⚠️ ONE OF THOSE FOUR DID NOT REDDEN AT FIRST, AND THE HOLE WAS HERE, NOT IN THE MUTATION. The
//  drill built its victim child by resolving `./virtual-gpu.mjs` RELATIVE TO THIS FILE, so a run
//  against a mutated copy of the bench had the child importing the INTACT one: the suite reported
//  green about a module it was not testing. Fixed by importing the bench's own `MODULE_URL` — the
//  child now follows whatever bench this suite actually imported. The general shape is worth more
//  than the fix: **a subprocess that re-imports a module by PATH escapes every substitution its
//  parent made**, so the parent must hand down the module it is really using.]

// KAGO-BENCH-OWN — bench's own file; the «no branches on the bench» guard skips it by this mark.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import config from '../config.mjs';
import { loadCard, virtualCard, TRAPS, GOLDEN_CHECKSUM, PROVABILITY_LINE, MODULE_URL } from './virtual-gpu.mjs';
import { searchEdge, sweepRange } from '../engine.mjs';
import { openJournal, readJournal, resumeState, RUNG_OUTCOME } from './sweep-journal.mjs';

const TRAP_DIR = join('benches', 'cards', 'traps');

/**
 * The step function `searchEdge` drives the card through. This is the ONLY place the bench meets the
 * engine, and it is deliberately thin: write the vector, read what the card now serves, run the load,
 * and let the REAL `stress-tester` say what happened.
 *
 * `alwaysPass` is the wrong engine. It changes ONE thing — the verdict — and nothing else, so a
 * difference in the search's behaviour can only have come from the verdict it read.
 */
export function makeStepFn(vc, card, stress, golden, stampOk, { alwaysPass = false } = {}) {
  return async ({ offsetMhz, capMhz, sustain = 60 }) => {
    const before = vc.oracle.servingVoltageMv(capMhz);
    const w = await vc.curveBackend.writeRaiseAndCap(offsetMhz, capMhz, { cardMaxClockMhz: card.card.maxGraphicsMhz });
    if (!w.ok) return { verdict: null, reason: `запись отвергнута: ${w.why}` };
    const after = vc.oracle.servingVoltageMv(capMhz);
    vc.backend.lockGraphicsClocksMhz(capMhz, capMhz);
    vc.backend.query(['clocks.gr']);

    const burst = stress.runBurst({
      name: 'sdc_fma', args: [], sustainSeconds: sustain, run: (b, a) => vc.oracle.run(b, a),
    });
    const v = stress.decideVerdict({ bursts: [burst], golden, stamp: stampOk, faults: { providers: [], faults: [] } });

    return {
      verdict: alwaysPass ? config.VERDICT.PASS : v.verdict,
      reason: alwaysPass ? 'НЕПРАВИЛЬНЫЙ ДВИЖОК: вердикт подменён на PASS' : v.reason,
      worstShape: 'sdc_fma/sustained',
      // The saving is REAL and read off the card twice, so `refuseWithoutUndervolt` is exercised
      // rather than bypassed — a trap run that silently skipped the project's own stop guard would
      // be testing a search the owner never runs.
      undervolt: { savedMv: Number((before - after).toFixed(1)), capMhz },
      writeShape: 'raise-and-cap',
      capHeldBy: 'кривая',
      deliveredMhz: capMhz,
    };
  };
}

/**
 * THE STEP FUNCTION THE SWEEP IS DRIVEN THROUGH (`plans/15` §4.5) — the atom's contract, on the bench.
 *
 * It differs from `makeStepFn` above in exactly one way that matters: the sweep's rung asks the card
 * what voltage ACTUALLY served the clock after the write (`undervolt.after.mv`), and `runRung` VOIDS
 * the rung if that is not the voltage it ordered. So this returns the card's own reading rather than
 * an echo of the order — which is the whole reason a bench is worth more than a stub.
 *
 * The rollback is real too: the curve is zeroed and the block is stamped `undo: true`, because a rung
 * whose rollback failed is never reported as passed and a bench that faked a clean undo would hide
 * exactly that.
 */
export function makeSweepStepFn(vc, card, stress, golden, stampOk) {
  return async ({ offsetMhz, capMhz, pinMhz = null, writeShape = null, sustain = 10 }) => {
    // ─── СТЕНД СЛУШАЕТСЯ ФОРМЫ, КОТОРУЮ ЕМУ ВЫДАЛИ (`bugs/26`, `plans/25` шаг 1.3) ────────────────
    //
    // `runRung` решает, КТО держит потолок, и передаёт решение сюда тремя полями (`writeShape`,
    // `capMhz`, `pinMhz`). Стенд их не читал: писал ВСЕГДА потолок на испытуемой частоте и
    // ВСЕГДА закреплял. Отсюда два расхождения сразу — нижняя половина заказа владельца отвергалась
    // сторожем R11, которого живой путь не встречает, а наверху диапазона стенд закреплял там, где
    // живой прогон оставляет карту свободной.
    //
    // Форма `uniform` — это подъём БЕЗ потолка: ниже пола потолка (≈2157 МГц на карте владельца)
    // кривой удержать нечего, и держателем становится закрепление (факт 38, R11).
    const uniform = writeShape === 'uniform';
    const w = uniform
      ? await vc.curveBackend.writeRaiseAndCap(offsetMhz, null, { cardMaxClockMhz: card.card.maxGraphicsMhz })
      : await vc.curveBackend.writeRaiseAndCap(offsetMhz, capMhz, { cardMaxClockMhz: card.card.maxGraphicsMhz });
    if (!w.ok) {
      await vc.curveBackend.zeroCurve();
      return { verdict: null, reason: `запись отвергнута: ${w.why}`, blocks: [{ name: 'ОТКАТ: кривая обнулена', ok: true, undo: true }] };
    }
    // ЗАКРЕПЛЯЕМ ТОЛЬКО ТОГДА, КОГДА ДЕРЖАТЕЛЬ — ЗАКРЕПЛЕНИЕ. Пин это и есть ЗАКАЗ частоты, а
    // заказать частоту у карты нельзя (слово владельца 2026-08-23); там, где потолок держит кривая,
    // живой прогон карту не запирает, и стенд, запиравший её всегда, репетировал другую работу.
    if (pinMhz !== null) vc.backend.lockGraphicsClocksMhz(pinMhz, pinMhz);
    const ordered = pinMhz ?? capMhz;

    const burst = stress.runBurst({
      name: 'sdc_fma', args: [], sustainSeconds: sustain, run: (b, a) => vc.oracle.run(b, a),
    });
    const v = stress.decideVerdict({ bursts: [burst], golden, stamp: stampOk, faults: { providers: [], faults: [] } });

    // ─── ВЫДАННАЯ ЧАСТОТА СПРАШИВАЕТСЯ У КАРТЫ, А НЕ ПОВТОРЯЕТ ЗАКАЗ ──────────────────────────────
    //
    // Прежняя редакция возвращала `deliveredMhz: clock`, то есть эхо собственного заказа. При этом
    // репетиция честно печатала «ЗАКАЗ ↔ ВЫДАЧА: не разошлись ни разу» — и не могла напечатать
    // ничего другого ПО ПОСТРОЕНИЮ. Главный путь метода (строка пишется по ВЫДАННОЙ частоте) не
    // репетировался вовсе. Теперь читается `clocks.gr` — то же поле, что читает живой атом.
    const deliveredMhz = Number(vc.backend.query(['clocks.gr'])['clocks.gr']);
    // И напряжение — то, что обслуживает ВЫДАННУЮ частоту, а не заказанную: вердикт об одной
    // частоте при напряжении другой это ровно `bugs/28`.
    const after = vc.oracle.servingVoltageMv(deliveredMhz);

    // ─── ТЕ ЖЕ ПРОВЕРКИ, ЧТО ДЕЛАЕТ ЖИВОЙ АТОМ (`plans/38`, эпик 36 фаза 2) ───────────────────────
    //
    // 🔴 ЧЕГО ЗДЕСЬ НЕ БЫЛО И ПОЧЕМУ ЭТО ГЛАВНАЯ ПОЛОВИНА СЛЕПОТЫ СТЕНДА. Подменный атом возвращал
    // вердикт, выданную частоту и обслуживающее напряжение — и ОДИН блок отката. Ни одного из трёх
    // чисел, которыми 2026-08-24 пойман дефект живой записи, у него не было:
    //   · `highestOfferedMhz` — что кривая предлагает ПОСЛЕ записи (на живой карте 2370 при потолке 2355);
    //   · поточечная сверка — легли ли сдвиги вообще (различитель между тремя гипотезами);
    //   · блок потолка — устоял ли потолок в самой таблице.
    // Пока их нет, стенд не проверяет запись, а благословляет её: `researches/18` §6.
    //
    // ⚠️ ЧИТАЕМ КАРТУ, А НЕ СВОЙ ЗАКАЗ. Оба чтения идут в бэкенд (`readCurve`, `readCurveOffsets`);
    // сверять `w.vector` сам с собой значило бы вернуть ровно ту тавтологию, которую фаза 2 снимает.
    const curveAfter = await vc.curveBackend.readCurve();
    const offsetsAfter = await vc.curveBackend.readCurveOffsets();
    const blocks = [];
    let highestOfferedMhz = null;
    if (curveAfter.ok) {
      highestOfferedMhz = Math.max(...curveAfter.points.map((p) => p.mhz));
      // Имя и флаг `proof` — те же, что у живого атома: `engine.runRung` маршрутизирует по ПОЛЮ,
      // и блок, отличающийся флагом, поехал бы по другому проводу (`plans/28`, находка A).
      const capForProof = uniform ? null : capMhz;
      if (Number.isFinite(capForProof)) {
        blocks.push({
          name: `ПОТОЛОК ${capForProof} МГц УСТОЯЛ В ТАБЛИЦЕ`,
          ok: highestOfferedMhz <= capForProof,
          proof: true,
          why: highestOfferedMhz <= capForProof
            ? `максимум таблицы ${highestOfferedMhz} МГц при потолке ${capForProof}`
            : `карта ушла ВЫШЕ потолка: максимум ${highestOfferedMhz} МГц при потолке ${capForProof}`,
          detail: `план обещал не выше ${capForProof}`,
        });
      }
    }
    // ПОТОЧЕЧНАЯ СВЕРКА — обычный блок, без флагов: у него на живом пути тоже нет своего канала,
    // и именно поэтому фаза 1 научила движок довозить такие блоки до журнала.
    if (offsetsAfter.ok && Array.isArray(w.vector)) {
      let matched = 0;
      let firstMissAt = null;
      for (let i = 0; i < w.vector.length; i++) {
        if (offsetsAfter.offsets[i] === w.vector[i]) matched++;
        else if (firstMissAt === null) firstMissAt = i;
      }
      blocks.push({
        name: 'перечитано ПОТОЧЕЧНО: каждая точка несёт РОВНО заказанный сдвиг',
        ok: matched === w.vector.length,
        detail: matched === w.vector.length
          ? `сошлось ${matched} из ${w.vector.length}`
          : `сошлось ${matched} из ${w.vector.length}, первое расхождение в точке ${firstMissAt} `
            + `(заказано ${w.vector[firstMissAt]}, карта держит ${offsetsAfter.offsets[firstMissAt]})`,
      });
    }

    await vc.curveBackend.zeroCurve();
    if (pinMhz !== null) vc.backend.resetGraphicsClocks();
    return {
      verdict: v.verdict,
      reason: v.reason,
      worstShape: 'sdc_fma/transient',
      deliveredMhz,
      deliveredMaxMhz: deliveredMhz,
      clockShortfall: Number.isFinite(ordered) && deliveredMhz < ordered,
      deliveredShortfallMhz: Number.isFinite(ordered) ? ordered - deliveredMhz : null,
      // СДВИГ, КОТОРЫЙ РЕАЛЬНО ЛЁГ — то же поле, что живой атом отдаёт движку для журнала
      // (`bugs/49`). Без него `appliedDeltaMhz` на стенде всегда null, и репетиция не проверяет
      // проводку, которую живой прогон использует.
      offsetMhz,
      highestOfferedMhz,
      undervolt: { capMhz, offeredAfterMhz: highestOfferedMhz, after: { mv: after } },
      blocks: [{ name: 'ОТКАТ: кривая обнулена', ok: true, undo: true }, ...blocks],
    };
  };
}

/** The card's V/F table in the shape `planRung` reads it. Graphics points only — the table's 128th
 *  entry is not one of the 127 the curve document knows. */
export function pointsForCard(card) {
  return card.vfTable.slice(0, card.voltageGridMv.length)
    .map((p, i) => ({ i, mv: p.voltageMv, mhz: p.mhz, freqKhz: p.mhz * 1000 }));
}

/**
 * Документ тюнинг-кривой этой карты — каждая частота при своём заводском обслуживающем напряжении,
 * ровно то, что `curve --init` строит по живой карте.
 *
 * ⚠️ ПО УМОЛЧАНИЮ — ВЕСЬ ДИАПАЗОН, А НЕ ПОЛОСА (`plans/25` шаг 1.3). Живой прогон читает документ
 * целиком (`loadCurveDoc({})`, 389 строк) и ограничивает полосой ГРУППЫ, а не документ. Стенд же
 * строил документ ИЗ ПОЛОСЫ — и это стало видно, как только карта получила право проседать: при
 * заказе 2805 МГц карта выдала 2640, строки-адресата в обрезанном документе не нашлось, и развёртка
 * встала на «притягивать некуда». Живой путь такого края не имеет вовсе, то есть стенд репетировал
 * остановку, которой не бывает.
 *
 * Полоса остаётся аргументом РАЗВЁРТКИ (`fromMhz`/`toMhz` у `sweepRange`) — там ей и место.
 */
export function curveDocForCard(card, { fromMhz = Infinity, toMhz = -Infinity } = {}) {
  const pts = pointsForCard(card);
  const frequencies = card.frequencyGridMhz
    .filter((mhz) => mhz >= toMhz && mhz <= fromMhz)
    .sort((a, b) => b - a)
    .map((mhz) => {
      const serving = pts.find((p) => p.mhz >= mhz) ?? pts[pts.length - 1];
      return {
        mhz, voltageMv: serving.mv, stockVoltageMv: serving.mv,
        tags: ['stop:untouched'], provenBy: null, editedAt: '2026-08-16T00:00:00+03:00',
      };
    });
  return {
    kind: 'tuning-curve', name: 'measured',
    card: { ...card.card },
    voltageGridMv: [...card.voltageGridMv],
    stamp: { driver: card.stamp.driver, vbios: card.stamp.vbios, takenAt: '2026-08-16T00:00:00+03:00', tempC: 42 },
    frequencies,
  };
}

/** One SWEEP over one card — the real `sweepRange`, through the bench's own seam. */
export async function runSweep(card, { seed, fromMhz, toMhz, journal = null, stress, golden, stampOk, onEvent = null }) {
  const vc = virtualCard(card, { settleSamples: 0, seed });
  const said = [];
  const report = await sweepRange({
    // Документ — ВЕСЬ диапазон карты, как на живом пути; полоса ограничивает группы ниже.
    curveDoc: curveDocForCard(card),
    points: pointsForCard(card),
    fromMhz, toMhz,
    // The card's OWN maximum, taken from the bench card rather than from the V/F table — the locked
    // shape caps the curve there so no raised point offers above the envelope (R13, `bugs/11`).
    envelopeMhz: card.card.maxGraphicsMhz,
    journal,
    runStepFn: makeSweepStepFn(vc, card, stress, golden, stampOk),
    onEvent: (e) => { said.push(e); if (onEvent) onEvent(e); },
    now: () => '2026-08-16T03:00:00+03:00',
    clockMs: (() => { let t = 0; return () => (t += 1000); })(),
  });
  return { report, said, vc };
}

/** One search over one card. Returns what the engine did, in the terms the traps are stated in. */
export async function runSearch(card, { seed, alwaysPass, capMhz = 2842, stress, golden, stampOk }) {
  const vc = virtualCard(card, { settleSamples: 0, seed });
  const out = await searchEdge({
    capMhz,
    point: 95,
    wholeCurve: true,
    writeShape: 'raise-and-cap',
    seconds: 60,
    sustain: 60,
    card: { driver: card.stamp.driver, vbios: card.stamp.vbios },
    runStepFn: makeStepFn(vc, card, stress, golden, stampOk, { alwaysPass }),
  });
  const rungs = out.attempts.filter((a) => a.verdict !== undefined).length;
  const deepest = out.attempts.reduce((d, a) => Math.max(d, a.offsetMhz ?? 0), 0);
  return { out, rungs, deepest, vc };
}

export async function runTrapSuite() {
  const results = [];
  const ok = (n, note = '') => results.push({ n, state: 'OK', note });
  const fail = (n, why) => results.push({ n, state: 'FAIL', why });
  const pending = (n, why) => results.push({ n, state: 'ЖДЁТ', why });
  const check = (n, cond, why = '', note = '') => (cond ? ok(n, note) : fail(n, why));

  const stress = await import('./stress-tester.mjs');

  // ---- 0. every trap card exists on disk, and its class travels inside the file (B3-AC1)
  const cards = new Map();
  for (const t of TRAPS) {
    const path = join(TRAP_DIR, `${t.name}.json`);
    if (!existsSync(path)) { fail(`ЛОВУШКА ${t.name}: файл на месте`, `нет ${path} — прогони --derive-traps`); continue; }
    const r = loadCard(path);
    if (!r.ok) { fail(`ЛОВУШКА ${t.name}: файл годен`, r.why); continue; }
    cards.set(t.name, r.card);
    check(`ЛОВУШКА ${t.name}: класс и назначение записаны В САМОМ файле`,
      r.card.trap?.klass === t.klass && Boolean(r.card.trap?.mustDo) && Boolean(r.card.trap?.otherwise),
      `в файле ${JSON.stringify(r.card.trap ?? null)}`, `класс ${t.klass}`);
  }
  // ⚠️ ЧИСЛО ЗДЕСЬ ЖЁСТКОЕ НАМЕРЕННО, И ЭТО НЕ ПЕДАНТИЗМ: ловушка, тихо выпавшая с диска, — это
  // покрытие, исчезнувшее без единого красного блока. Сторож заметил появление шестой (T6,
  // 2026-08-23) и седьмой (T7, тот же день, вечер) ровно так, как должен был, и число правится
  // ВМЕСТЕ с реестром, а не вслед за прогоном.
  check('ЛОВУШКИ: их СЕМЬ, и класс каждой назван ДО прогона (B3-AC1)',
    TRAPS.length === 7 && cards.size === 7, `на диске ${cards.size} из ${TRAPS.length}`);

  // ---- 1. T1 — the edge sits above the descent's reach (class A, judged by the REAL searchEdge)
  const t1 = cards.get('T1_edge_above_reach');
  if (t1) {
    const golden = { gpu: { driver: t1.stamp.driver, vbios: t1.stamp.vbios }, args: [], checksum: GOLDEN_CHECKSUM };
    const probed = { probed: true, driver: t1.stamp.driver, vbios: t1.stamp.vbios };
    const stampOk = stress.checkGoldenStamp(golden, probed, []);

    // THE RIGHT ENGINE, on three seeds. Three rather than one because a single seed cannot tell a
    // guard from a coincidence, and this card's edge is sharp precisely so three is enough.
    const right = [];
    for (const seed of [11, 12, 13]) right.push(await runSearch(t1, { seed, alwaysPass: false, stress, golden, stampOk }));
    const worstRight = Math.max(...right.map((r) => r.rungs));
    check('T1: ПРАВИЛЬНЫЙ движок останавливается почти сразу — край прямо под стоком',
      right.every((r) => r.out.firstFail !== null) && worstRight <= 4,
      `ступеней ${right.map((r) => r.rungs).join('/')}, первый отказ ${right.map((r) => r.out.firstFail).join('/')}`,
      `ступеней не больше ${worstRight}`);

    // THE WRONG ENGINE — the same card, the same seeds, one thing changed.
    const wrong = [];
    for (const seed of [11, 12, 13]) wrong.push(await runSearch(t1, { seed, alwaysPass: true, stress, golden, stampOk }));
    const bestWrong = Math.min(...wrong.map((r) => r.rungs));
    check('T1: НЕПРАВИЛЬНЫЙ движок проходит край насквозь — ловушка РАЗЛИЧАЕТ, а не зеленеет всегда',
      bestWrong > worstRight && wrong.every((r) => r.out.firstFail === null),
      `правильный ${worstRight} ступеней, неправильный ${wrong.map((r) => r.rungs).join('/')}`,
      `${worstRight} против ${bestWrong} ступеней`);
  } else fail('T1: карта загружена', 'карты нет на диске');

  // ---- 2. T2 — a real death at a NAMED rung (class A in half; naming it after re-launch is plans/15)
  const t2 = cards.get('T2_hangs_at_a_named_rung');
  if (t2) {
    const hangAt = t2.fiction.failure.hangAtOrBelowMv;
    check('T2: ступень зависания названа В КАРТЕ, а не в коде набора',
      Number.isFinite(hangAt), `hangAtOrBelowMv = ${hangAt}`, `${hangAt} мВ`);

    const drill = await hangDrillOnCard(join(TRAP_DIR, 'T2_hangs_at_a_named_rung.json'), hangAt);
    check('T2: процесс УМИРАЕТ по-настоящему на этой ступени, ни один finally не отработал',
      drill.died && !drill.finallyRan,
      `код ${drill.status}, finally ${drill.finallyRan ? 'ОТРАБОТАЛ' : 'не отработал'}: ${drill.stderr}`);
    check('T2: намерение, записанное ДО обращения к карте, пережило смерть',
      drill.intentSurvived, 'намерения на диске нет — журналу упреждающей записи нечего было бы читать');

    // ── THE SECOND HALF, AND IT IS NO LONGER PENDING (`plans/15` §4.5 wired the sweep) ────────────
    // A REAL child process runs a REAL `sweepRange` on this card and REALLY dies at the rung the
    // card names. Then this process re-launches and must name that exact rung. Nothing here is
    // simulated: the death is a process exit with no `finally`, and the journal is the shipped one.
    const relaunch = await sweepDeathAndRelaunch(join(TRAP_DIR, 'T2_hangs_at_a_named_rung.json'), hangAt);
    check('T2 (вторая половина): перезапуск НАЗЫВАЕТ убитую ступень — частоту И напряжение',
      relaunch.died && relaunch.named !== null && relaunch.named.voltageMv <= hangAt,
      `умер ${relaunch.died} (код ${relaunch.status}), названо ${JSON.stringify(relaunch.named)}: ${relaunch.why}`,
      relaunch.named ? `${relaunch.named.frequencyMhz} МГц / ${relaunch.named.voltageMv} мВ, вердикт ЗАВИС` : '');
    check('T2: и убитая ступень закрыта именно вердиктом ЗАВИС, а не «нет ответа»',
      relaunch.named?.verdict === config.VERDICT.HUNG,
      `вердикт ${JSON.stringify(relaunch.named?.verdict ?? null)}, ждали ${config.VERDICT.HUNG}`);
  } else fail('T2: карта загружена', 'карты нет на диске');

  // ---- 3. class B — the cards ship, and since `plans/15` §4.5 the assertions RUN. Every one of them
  // drives the REAL `sweepRange` over the trap card through the bench's own seam.
  for (const t of TRAPS.filter((x) => x.klass === 'B')) {
    const card = cards.get(t.name);
    check(`${t.name}: карта существует и её вымысел годен`, Boolean(card), 'карты нет на диске');
  }

  // The assertion's NAME carries the trap's own `mustDo` verbatim, and that is not decoration: the
  // report guard below finds an assertion by that substring, so a renamed check would read as a
  // VANISHED one. One string, one source — the trap's definition.
  const mustDoOf = (name) => TRAPS.find((t) => t.name === name)?.mustDo ?? `<ловушки ${name} нет>`;

  const stressFor = (card) => {
    const golden = { gpu: { driver: card.stamp.driver, vbios: card.stamp.vbios }, args: [], checksum: GOLDEN_CHECKSUM };
    const probed = { probed: true, driver: card.stamp.driver, vbios: card.stamp.vbios };
    return { golden, stampOk: stress.checkGoldenStamp(golden, probed, []) };
  };

  // ── T3 — the owner's rare case: one frequency needs MORE than its higher neighbour. The seed comes
  // from above, so it FAILS here, and the sweep must cancel it, fall back to stock, and SAY SO.
  const t3card = cards.get('T3_non_monotone_vmin');
  if (t3card) {
    const { golden, stampOk } = stressFor(t3card);
    // A band that CONTAINS the inversion: the neighbour above 2842 is tuned first and seeds it.
    const r = await runSweep(t3card, { seed: 21, fromMhz: 2857, toMhz: 2842, stress, golden, stampOk });

    // ─── МЕХАНИЗМ ЗАЩИТЫ СМЕНИЛСЯ КАНОНОМ, СВОЙСТВО — НЕТ (2026-08-23, `plans/25` шаг 1.3) ─────────
    //
    // ⚠️ ЧИТАТЬ ДО ТОГО, КАК «ВОССТАНАВЛИВАТЬ» ПРЕЖНИЕ УТВЕРЖДЕНИЯ. Здесь стояли две проверки о
    // МЕХАНИЗМЕ: «затравка ОТВЕРГНУТА» и «спуск пошёл ОТ СТОКА». Обе описывали стенд, который
    // ЗАКРЕПЛЯЛ частоту на каждой ступени, — то есть заказывал её. Слово владельца 2026-08-23:
    // *«заказать частоту у видеокарты невозможно. Можно тюнить ту частоту, которую она выдаёт»*.
    // Инверсия этой карты (37,2 мВ на 2842→2850) лежит ВЫШЕ пола потолка (2090 МГц), где потолок
    // держит кривая и закрепления нет вовсе, — значит на этой полосе прежний механизм отменён
    // каноном, а не сломан правкой.
    //
    // ЧТО ПРОИСХОДИТ ТЕПЕРЬ, ЗАМЕРЕНО: край 2857 МГц = 868,4 мВ, край 2842 МГц = 915,3 мВ. Затравка
    // 885 мВ приходит сверху; карта не тянет на ней 2842 и ПРОСЕДАЕТ на 2835, замер ложится в строку
    // 2835 МГц, а 2842 МГц остаётся НЕТРОНУТОЙ. Ложной строки о ней не появляется — ровно то, ради
    // чего ловушка заведена. Цена названа вслух: инвертированная частота теперь не измеряется вовсе
    // и остаётся заводской. По канону это ОТСУТСТВУЮЩАЯ ВЫГОДА, а не риск: заводское напряжение
    // валидировано производителем (`GOAL.md` → «Границы метода, названные заранее»).
    //
    // Поэтому утверждения перенацелены с механизма на СВОЙСТВО, и новое СИЛЬНЕЕ прежнего: оно ловит
    // не только эту карту, а весь класс `bugs/28` — «вердикт об одной частоте, снятый на другой».
    const measured = r.report.doc.frequencies.filter((x) => !x.tags.includes('stop:untouched'));
    const closedElsewhere = r.said.filter((e) => e.kind === 'delivered-elsewhere');
    check(`T3: ${mustDoOf('T3_non_monotone_vmin')} — ЗАЩИТА ДЕРЖИТ, механизм сменился каноном`,
      measured.length >= 1 && !measured.some((x) => x.mhz === 2842),
      `строк с замером ${measured.length}: ${measured.map((x) => `${x.mhz}/${x.voltageMv}`).join(' ')} — `
        + 'если среди них есть 2842 МГц, то инвертированная частота получила значение, которого на ней не мерили',
      `2842 МГц осталась заводской, просадок названо ${closedElsewhere.length}`);
    check('T3: и после инверсии развёртка ВСЁ РАВНО закрывает частоты, а не бросает полосу',
      r.report.closed >= 1 && r.report.stoppedBy === null,
      `закрыто ${r.report.closed}, остановлено: ${r.report.stoppedBy ?? '—'} ${r.report.why}`);
    // ОБЩЕЕ СВОЙСТВО, РАДИ КОТОРОГО ВСЁ И ДЕЛАЛОСЬ: каждая строка с замером обязана быть строкой ТОЙ
    // частоты, на которой шёл прожиг. Это класс `bugs/28`, и просадка — единственный способ его
    // воспроизвести; до 2026-08-23 стенд не умел просаживаться и потому этого не проверял НИКОГДА.
    const misfiled = measured.filter((x) => x.tags.includes('origin:measured'))
      .filter((x) => typeof x.provenBy === 'string' && /ЗАКАЗАНО (\d+) МГц, ВЫДАНО (\d+)/.test(x.provenBy)
        && (() => { const m = x.provenBy.match(/ВЫДАНО (\d+)/); return Number(m[1]) !== x.mhz; })());
    check('T3: КАЖДЫЙ ЗАМЕР ЛЕЖИТ В СТРОКЕ ТОЙ ЧАСТОТЫ, НА КОТОРОЙ ШЁЛ ПРОЖИГ (класс bugs/28)',
      misfiled.length === 0,
      `строк, где выданная частота не равна имени строки: ${misfiled.length} — `
        + misfiled.map((x) => `${x.mhz}: ${x.provenBy}`).join(' · '));
  } else fail('T3: карта загружена', 'карты нет на диске');

  // ── T6 — КАРТА, КОТОРАЯ НИКОГДА НЕ ДАЁТ ЗАКАЗАННУЮ ЧАСТОТУ (`plans/25` шаг 1.3) ─────────────────
  //
  // Ловушка на E25-AC1: «недобор частоты не роняет прогон». До 2026-08-23 стенд не мог её поставить
  // вовсе — он ВСЕГДА закреплял частоту, то есть заказывал её, и репетиция честно печатала «ЗАКАЗ ↔
  // ВЫДАЧА: не разошлись ни разу». Главный путь метода владельца не репетировался.
  //
  // Здесь регулятор буста карты не подходит к потолку ближе 60 МГц НИ ПРИ КАКОМ напряжении, значит
  // заказ не исполняется ни разу за всю полосу. Прогон обязан довести полосу до конца, положив
  // каждый замер в строку ВЫДАННОЙ частоты.
  const t6card = cards.get('T6_never_delivers_the_ordered_clock');
  if (t6card) {
    const { golden, stampOk } = stressFor(t6card);
    // ⚠️ СНАЧАЛА — САМ МЕХАНИЗМ ЛОВУШКИ, ПРИ НУЛЕВОМ АНДЕРВОЛЬТЕ. Первая редакция этого блока
    // проверяла только «просадка случилась», и мутация «отнять у карты ограничитель регулятора»
    // НЕ ПОКРАСНИЛА НИЧЕГО (замерено 2026-08-23): при глубоком спуске карта проседает и от одного
    // лишь вымышленного края, как обычная. То есть ловушка не проверяла того, что заявляет своим
    // именем. Здесь глубина спуска НУЛЕВАЯ — кривая только подрезана потолком, напряжение стоковое,
    // и краю просадку дать нечем: всё, что ниже 60 МГц от потолка, может прийти ТОЛЬКО от
    // регулятора (EXP-0077 — мутация, не покрасившая ничего, это находка о коде).
    const govVc = virtualCard(t6card, { settleSamples: 0, seed: 31 });
    const CAP = 2842;
    await govVc.curveBackend.writeRaiseAndCap(0, CAP, { cardMaxClockMhz: t6card.card.maxGraphicsMhz });
    const atZeroDepth = Number(govVc.backend.query(['clocks.gr'])['clocks.gr']);
    await govVc.curveBackend.zeroCurve();
    check('T6: РЕГУЛЯТОР НЕ ДОХОДИТ ДО ПОТОЛКА ДАЖЕ БЕЗ АНДЕРВОЛЬТА — это и есть механизм ловушки',
      Number.isFinite(atZeroDepth) && CAP - atZeroDepth >= 60,
      `при нулевой глубине карта выдала ${atZeroDepth} МГц при потолке ${CAP} — недобор `
        + `${CAP - atZeroDepth} МГц, а ловушка заявляет не меньше 60`,
      `${atZeroDepth} МГц при потолке ${CAP}, недобор ${CAP - atZeroDepth} МГц`);
    const r6 = await runSweep(t6card, { seed: 31, fromMhz: 2857, toMhz: 2790, stress, golden, stampOk });
    const diverged = r6.said.filter((e) => e.kind === 'delivered-elsewhere');
    const measured6 = r6.report.doc.frequencies.filter((x) => !x.tags.includes('stop:untouched'));
    check(`T6: ${mustDoOf('T6_never_delivers_the_ordered_clock')} — прогнано, а не заявлено`,
      r6.report.stoppedBy === null && r6.report.closed > 0,
      `остановлено «${r6.report.stoppedBy ?? '—'}» ${String(r6.report.why).slice(0, 140)}, закрыто ${r6.report.closed}`,
      `закрыто ${r6.report.closed} строк(и), полоса доведена до конца`);
    // И ЭТО НЕ ЗЕЛЁНОЕ ПО СОВПАДЕНИЮ: недобор обязан был случиться, иначе прогон дошёл до конца
    // просто потому, что расходиться было нечему, и ловушка не поймала бы ничего (EXP-0016).
    check('T6: недобор ДЕЙСТВИТЕЛЬНО случился — иначе полоса закрылась бы по неинтересной причине',
      diverged.length > 0,
      `просадок названо ${diverged.length} — ни одной, значит карта отдавала заказ и ловушка бессмысленна`,
      `${diverged.length} просадок(и), первая: ${String(diverged[0]?.text ?? '').slice(0, 90)}`);
    check('T6: и КАЖДЫЙ замер лёг в строку ВЫДАННОЙ частоты, а не заказанной',
      measured6.length > 0 && measured6.every((x) => {
        const m = typeof x.provenBy === 'string' ? x.provenBy.match(/ВЫДАНО (\d+)/) : null;
        return !m || Number(m[1]) === x.mhz;
      }),
      `строк с замером ${measured6.length}, из них с чужой выданной частотой: `
        + measured6.filter((x) => { const m = typeof x.provenBy === 'string' ? x.provenBy.match(/ВЫДАНО (\d+)/) : null; return m && Number(m[1]) !== x.mhz; }).map((x) => x.mhz).join(', '));
  } else fail('T6: карта загружена', 'карты нет на диске');

  // ── T7 — КАРТА, КОТОРАЯ ОБСЛУЖИВАЕТ ЧАСТОТУ НАПРЯЖЕНИЕМ, КОТОРОГО НИКТО НЕ ЗАКАЗЫВАЛ ────────────
  //
  // 🔴 ЭТА ЛОВУШКА ПОСТАВЛЕНА ПОСЛЕ ЖИВОГО ВЕЧЕРА 2026-08-23, И ОНА ВОСПРОИЗВОДИТ ЕГО, А НЕ ВЫДУМКУ.
  // Прогон на карте владельца заказал 885 мВ на 2700 МГц, прогретая карта подставила 915, движок
  // записал 915 как ДОКАЗАННУЮ ЗЕМЛЮ, сторож шага (стена 35 мВ от доказанного) разрешил снова только
  // 885 — и прогон крутился на месте, грея карту, пока владелец его не остановил.
  //
  // Утверждение ловушки — НЕ «подстановки не бывает» (она законна и правилом владельца разрешена на
  // ОДНУ ступень сетки вверх), а «прогон обязан ПРОДВИГАТЬСЯ»: одну и ту же пару «заказано →
  // обслуживало» дважды подряд он повторять не имеет права. Либо шаг ниже, либо честная остановка.
  const t7card = cards.get('T7_serves_a_voltage_nobody_ordered');
  if (t7card) {
    const { golden, stampOk } = stressFor(t7card);

    // ⚠️ СНАЧАЛА — САМ МЕХАНИЗМ, иначе зелёное ниже ничего не стоит (EXP-0016, и урок T6: мутация,
    // не покрасившая ничего, — это находка о коде). Прогреваем карту и спрашиваем ТУ ЖЕ частоту.
    const vc7 = virtualCard(t7card, { settleSamples: 0, seed: 31 });
    const F = 2700;
    const cold = vc7.oracle.servingVoltageMv(F);
    vc7.telemetry.advance(600, { load: 1 });
    const warm = vc7.oracle.servingVoltageMv(F);
    check('T7: МЕХАНИЗМ — прогретая карта обслуживает ту же частоту БОЛЕЕ ВЫСОКОЙ записью',
      warm > cold,
      `на ${F} МГц холодная карта дала ${cold} мВ и прогретая ${warm} мВ — таблица не поехала, ловушка проверяет не то, что заявляет`,
      `${F} МГц: холодная ${cold} мВ → прогретая ${warm} мВ (дрейф ${vc7.oracle.tableDriftMhz().toFixed(1)} МГц)`);

    // БЮДЖЕТ СТУПЕНЕЙ — он здесь не украшение. Если движок зациклится, набор повиснет вместе с ним и
    // не доложит ничего: «не напечатал провалов» и «умер» неотличимы (правило батареи). Бюджет
    // превращает петлю в КРАСНЫЙ БЛОК с числом.
    const BUDGET = 40;
    let steps = 0;
    const seen = new Map();
    let looped = null;
    const vcRun = virtualCard(t7card, { settleSamples: 0, seed: 31 });
    const inner = makeSweepStepFn(vcRun, t7card, stress, golden, stampOk);
    const countingStep = async (a) => {
      if (++steps > BUDGET) throw new Error(`БЮДЖЕТ СТУПЕНЕЙ ИСЧЕРПАН (${BUDGET}) — прогон не продвигается`);
      const r = await inner(a);
      const key = `${a.clockMhz ?? a.frequencyMhz}@${a.voltageMv}`;
      const answer = `${r?.servingVoltageMv ?? r?.measuredMv ?? '?'}`;
      if (seen.get(key) === answer && looped === null) looped = `${key} → ${answer} мВ, повторено дважды`;
      seen.set(key, answer);
      return r;
    };
    let report7 = null;
    let threw7 = null;
    try {
      report7 = await sweepRange({
        curveDoc: curveDocForCard(t7card), points: pointsForCard(t7card),
        fromMhz: F, toMhz: F, envelopeMhz: t7card.card.maxGraphicsMhz,
        journal: null, runStepFn: countingStep, onEvent: () => {},
        now: () => '2026-08-16T03:00:00+03:00',
        clockMs: (() => { let t = 0; return () => (t += 1000); })(),
      });
    } catch (e) { threw7 = e.message; }

    check(`T7: ${mustDoOf('T7_serves_a_voltage_nobody_ordered')} — прогнано, а не заявлено`,
      threw7 === null && looped === null,
      threw7 ? `прогон встал: ${threw7} (ступеней ${steps})`
        : `ПЕТЛЯ: ${looped} — за ${steps} ступеней движок повторил ту же ступень с тем же ответом`,
      `ступеней ${steps} из бюджета ${BUDGET}, повторов нет, исход «${report7?.stoppedBy ?? 'полоса закрыта'}»`);
  } else fail('T7: карта загружена', 'карты нет на диске');

  // ── T4 — the edge lies DEEPER than our ±1000 MHz lever reaches. Reporting that as an edge would be
  // the false `[TESTED]` the second verdict exists to forbid.
  const t4card = cards.get('T4_edge_below_the_lever');
  if (t4card) {
    const { golden, stampOk } = stressFor(t4card);
    const r = await runSweep(t4card, { seed: 31, fromMhz: 2842, toMhz: 2827, stress, golden, stampOk });
    check(`T4: ${mustDoOf('T4_edge_below_the_lever')} — прогнано, а не заявлено`,
      r.report.verdicts['lever-limited'] >= 1 && r.report.verdicts['edge-found'] === 0,
      `край найден ${r.report.verdicts['edge-found']}, предел рычага ${r.report.verdicts['lever-limited']}, `
        + `остановлено: ${r.report.stoppedBy ?? '—'} ${r.report.why}`,
      `предел рычага ${r.report.verdicts['lever-limited']}, краёв 0`);
    check('T4: и такая частота записана в документ кривой статусом lever-limited, а не уликой прожига',
      r.report.doc.frequencies.some((x) => x.status === 'lever-limited'),
      `статусы: ${[...new Set(r.report.doc.frequencies.map((x) => x.status))].join(', ')}`);
  } else fail('T4: карта загружена', 'карты нет на диске');

  // ── T5 — the same rung kills the machine TWICE. A third attempt is an infinite reboot loop on the
  // owner's desk, and the sweep must refuse it and report a failure the CLI turns into exit 1.
  const t5card = cards.get('T5_hangs_twice_on_one_rung');
  if (t5card) {
    const { golden, stampOk } = stressFor(t5card);
    const twice = await twoDeathsOnOneRung(join(TRAP_DIR, 'T5_hangs_twice_on_one_rung.json'),
      t5card.fiction.failure.hangAtOrBelowMv);
    // 🔴 ЭТА ЛОВУШКА ПЕРЕСТАЛА ЛОВИТЬ ВТОРУЮ СМЕРТЬ — И ЭТО НЕ ОСЛАБЛЕНИЕ, А ЕЁ ЦЕЛЬ, ДОСТИГНУТАЯ
    // РАНЬШЕ (`bugs/23`). Пока ступень запрещал только тормоз «два зависания подряд», второй прогон
    // ОБЯЗАН был снова дойти до смертельной ступени и убить машину второй раз — то есть цена одного
    // защищённого рунга равнялась ДВУМ перезагрузкам на столе владельца. Пол зависания закрывает
    // ступень после ПЕРВОЙ, поэтому вторая попытка честно доживает до конца (код 0) и просто не
    // спускается туда.
    //
    // Утверждение переписано на то, что теперь ИСТИННО, а не подогнано под старое поведение: смерть
    // одна, вторая попытка выжила, и ступень уже недостижима. Тормоз «два подряд» при этом НЕ удалён
    // и не остался недоказанным — у него свой прямой блок в `engine --selftest`, который гоняет
    // `runRung` с заблокированным ключом.
    check('T5: ПЕРВАЯ смерть настоящая, а ВТОРАЯ попытка до ступени уже не доходит — цена одна перезагрузка',
      twice.deaths === 1 && twice.codes?.[1] === 0,
      `смертей ${twice.deaths}, коды ${JSON.stringify(twice.codes ?? null)}: ${twice.why}`,
      `код первой попытки ${twice.codes?.[0]}, второй ${twice.codes?.[1]} — вторая не умерла`);
    const third = await runSweep(t5card, {
      seed: 41, fromMhz: twice.frequencyMhz, toMhz: twice.frequencyMhz,
      journal: openJournal({ dir: twice.dir }), stress, golden, stampOk,
    });
    check(`T5: ${mustDoOf('T5_hangs_twice_on_one_rung')} — развёртка встаёт, а не пропускает молча`,
      third.report.ok === false && third.report.stoppedBy === 'hang-floor',
      `ok ${third.report.ok}, остановлено «${third.report.stoppedBy}»: ${third.report.why}`,
      'ok=false → команда выходит ненулевым кодом, и причина названа зависанием');
    check('T5: и ненулевой код — это ровно отображение ok=false, а не отдельное решение',
      sweepExitCode(third.report) === 1 && sweepExitCode({ ok: true }) === 0,
      `ok=false → ${sweepExitCode(third.report)}, ok=true → ${sweepExitCode({ ok: true })}`);
    twice.cleanup();
  } else fail('T5: карта загружена', 'карты нет на диске');

  // T3 carries one thing worth asserting TODAY: that the inversion it exists for is really there.
  const t3 = cards.get('T3_non_monotone_vmin');
  if (t3) {
    const asc = [...t3.fiction.edge].sort((a, b) => a.mhz - b.mhz);
    const i = asc.findIndex((r) => r.mhz === 2842);
    const drop = i > 0 && i < asc.length - 1 ? Number((asc[i].edgeMv - asc[i + 1].edgeMv).toFixed(1)) : 0;
    const rung = t3.voltageGridMv[1] - t3.voltageGridMv[0];
    check('T3: инверсия НАСТОЯЩАЯ — частота требует больше соседки сверху, и глубже одной ступени',
      drop > rung,
      `${asc[i]?.mhz} МГц требует ${asc[i]?.edgeMv} мВ против ${asc[i + 1]?.edgeMv} у ${asc[i + 1]?.mhz} МГц`,
      `на ${drop} мВ глубже, ступень ${rung} мВ`);
  }

  // ---- 4. THE GUARD ON THE REPORT ITSELF (B3-AC3), and it has CHANGED SIDES rather than been
  // deleted — which is the honest way for a «pending» convention to end.
  //
  // Until 2026-08-16 this guard demanded that every class-B assertion be PRESENT and PENDING: never
  // absent (it would be forgotten) and never OK (it would be a claim about an engine nobody had run).
  // `plans/15` §4.5 built that engine, so the second half of the demand expired the moment its
  // condition came true — the only way a waiver may end. What the guard still refuses is the thing it
  // was always for: an assertion that quietly VANISHES. Present-and-run, never absent, and never
  // pending again, because a pending row now would mean the sweep exists and nobody pointed it here.
  for (const t of TRAPS.filter((x) => x.klass === 'B')) {
    const rows = results.filter((r) => r.n.includes(t.mustDo));
    check(`${t.name}: утверждение НАПИСАНО и ПРОГНАНО — не отсутствует и больше не «ждёт»`,
      rows.length > 0 && rows.every((r) => r.state !== 'ЖДЁТ'),
      rows.length === 0 ? 'утверждения нет вовсе' : `состояния: ${rows.map((r) => r.state).join(', ')}`);
  }

  return report(results);
}

/**
 * The hang drill on a TRAP card. Same shape as `virtual-gpu.hangDrill` — a child process that really
 * dies — but pointed at a card whose hang is DETERMINISTIC and at a NAMED voltage, which is the half
 * of T2 that today's engine can be judged on.
 */
async function hangDrillOnCard(cardPath, hangAt) {
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  // THE BENCH THIS SUITE ACTUALLY IMPORTED, not a path spelled out by hand. Spelling it out made the
  // victim child import the intact module during a mutation run, so a mutation that disabled the
  // deterministic trap hang passed unnoticed — the suite was green about a module it was not testing.
  const vgpu = fileURLToPath(MODULE_URL);
  const base = join(tmpdir(), `kago-trap-hang-${process.pid}`);
  const intentPath = `${base}-intent.json`;
  const finallyPath = `${base}-finally.txt`;
  const childPath = `${base}-victim.mjs`;

  const child = `
import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const m = await import(pathToFileURL(${JSON.stringify(vgpu)}).href);
const [cardPath, intentPath, finallyPath, hangAt] = process.argv.slice(2);
const card = JSON.parse(readFileSync(cardPath, 'utf8'));
const vc = m.virtualCard(card, { settleSamples: 0, seed: 5, allowProcessDeath: true });
// Спускаемся, пока карта не окажется НА названной ступени — глубину не помним, а считаем.
for (let delta = 20; delta <= 1000; delta += 20) {
  const w = await vc.curveBackend.writeRaiseAndCap(delta, 2842, { cardMaxClockMhz: card.card.maxGraphicsMhz });
  if (w.ok && vc.oracle.servingVoltageMv(2842) <= Number(hangAt)) break;
}
vc.backend.lockGraphicsClocksMhz(2842, 2842);
try {
  writeFileSync(intentPath, JSON.stringify({ state: 'intent', mhz: 2842, servingMv: vc.oracle.servingVoltageMv(2842) }));
  for (let i = 0; i < 200; i++) vc.oracle.run('sdc_fma.exe', ['--sustain', '10']);
} finally {
  writeFileSync(finallyPath, 'finally отработал');
}
`;
  writeFileSync(childPath, child);
  const r = spawnSync(process.execPath, [childPath, cardPath, intentPath, finallyPath, String(hangAt)],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 });
  const out = {
    died: r.status === 70,
    status: r.status,
    finallyRan: existsSync(finallyPath),
    intentSurvived: existsSync(intentPath),
    stderr: (r.stderr || '').split('\n').slice(0, 2).join(' '),
  };
  for (const p of [childPath, intentPath, finallyPath]) { try { unlinkSync(p); } catch { /* уже нет */ } }
  return out;
}

/**
 * THE EXIT CODE OF A SWEEP — one line, in one place, so «exits non-zero» is a MAPPING that can be
 * asserted rather than a behaviour buried in the CLI's tail. T5's `mustDo` names it explicitly.
 */
export function sweepExitCode(report) {
  return report && report.ok === true ? 0 : 1;
}

/**
 * A REAL DEATH INSIDE A REAL SWEEP, AND THE RE-LAUNCH THAT NAMES IT — T2's second half.
 *
 * The child runs the shipped `sweepRange` against a trap card whose hang is deterministic, with the
 * shipped write-ahead journal. It dies the way the owner's machine dies: a process exit with no
 * `finally`, nothing written afterwards. Then THIS process reads that journal and must be told which
 * rung was in flight.
 *
 * Why a child and not a throwing atom: a throw unwinds and lets `finally` blocks run, which is
 * exactly the thing a hang does NOT do (R10 — three of the four rollback layers need a live OS).
 */
async function sweepDeathAndRelaunch(cardPath, hangAt) {
  const { tmpdir } = await import('node:os');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'kago-trap-sweep-'));
  const journalDir = join(dir, 'journal');
  const death = await spawnSweepChild(cardPath, journalDir, dir);

  const jrn = openJournal({ dir: journalDir });
  const before = readJournal(jrn).records.length;
  resumeState(jrn, { at: '2026-08-16T03:30:00+03:00' });
  const { records } = readJournal(jrn);
  const intents = new Map(records.filter((r) => r?.state === 'intent').map((r) => [r.seq, r]));
  const hung = records
    .filter((r) => r?.state === 'verdict' && r.outcome === RUNG_OUTCOME.HUNG)
    .map((v) => ({
      outcome: v.outcome,
      verdict: v.verdict ?? null,
      frequencyMhz: intents.get(v.seq)?.frequencyMhz ?? null,
      voltageMv: intents.get(v.seq)?.voltageMv ?? null,
    }));

  const out = {
    died:death.died,
    status:death.status,
    named: hung.length ? hung[hung.length - 1] : null,
    why: `строк в журнале до перезапуска ${before}, зависаний приписано ${hung.length}. ${death.stderr}`,
    hangAt,
  };
  rmSync(dir, { recursive: true, force: true });
  return out;
}

/**
 * TWO REAL DEATHS ON ONE RUNG — T5's fixture, built the way the owner's evening would build it: run,
 * die, reboot, run again, die again. Both runs share ONE journal, which is what makes «consecutive»
 * countable at all.
 */
async function twoDeathsOnOneRung(cardPath, hangAt) {
  const { tmpdir } = await import('node:os');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'kago-trap-twice-'));
  const journalDir = join(dir, 'journal');

  let deaths = 0;
  const notes = [];
  const codes = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await spawnSweepChild(cardPath, journalDir, dir);
    if (r.died) deaths += 1;
    codes.push(r.status);
    notes.push(`попытка ${attempt + 1}: код ${r.status}`);
    // The re-launch is what CLOSES the orphan intent as ЗАВИС — the same call the next run makes.
    resumeState(openJournal({ dir: journalDir }), { at: `2026-08-16T0${4 + attempt}:00:00+03:00` });
  }
  const state = resumeState(openJournal({ dir: journalDir }), { at: '2026-08-16T06:00:00+03:00' });
  return {
    deaths,
    // THE CODES OF BOTH ATTEMPTS, kept since `bugs/23`: the interesting fact is no longer «how many
    // died» but «the second one SURVIVED». A count alone cannot tell «it did not reach the rung»
    // from «it never ran».
    codes,
    blocked: state.blocked,
    // The floor, which is what stops the second attempt now — read from the same resume call.
    floors: state.floors,
    frequencyMhz: state.blocked[0]?.frequencyMhz ?? [...(state.floors?.keys() ?? [])][0] ?? 2842,
    dir: journalDir,
    why: `${notes.join(' · ')}, порог зависания ${hangAt} мВ`,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * The victim: a child process that runs the shipped sweep on a trap card and dies where the card says.
 *
 * The bench module is handed down by its OWN url (`MODULE_URL`) rather than by a path spelled out
 * here — a child that re-derives the path escapes every substitution a mutation run made, and this
 * suite has already paid for that once (EXP-0070).
 */
async function spawnSweepChild(cardPath, journalDir, dir) {
  const { spawnSync } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const vgpu = fileURLToPath(MODULE_URL);
  const suite = fileURLToPath(import.meta.url);
  const childPath = join(dir, 'victim-sweep.mjs');

  const child = `
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const bench = await import(pathToFileURL(${JSON.stringify(vgpu)}).href);
const suite = await import(pathToFileURL(${JSON.stringify(suite)}).href);
const engine = await import(pathToFileURL(${JSON.stringify(fileURLToPath(new URL('../engine.mjs', import.meta.url)))}).href);
const journal = await import(pathToFileURL(${JSON.stringify(fileURLToPath(new URL('./sweep-journal.mjs', import.meta.url)))}).href);
const stress = await import(pathToFileURL(${JSON.stringify(fileURLToPath(new URL('./stress-tester.mjs', import.meta.url)))}).href);
const [cardPath, journalDir] = process.argv.slice(2);
const card = JSON.parse(readFileSync(cardPath, 'utf8'));
// allowProcessDeath — the card is permitted to really kill this process at its named rung.
const vc = bench.virtualCard(card, { settleSamples: 0, seed: 7, allowProcessDeath: true });
const golden = { gpu: { driver: card.stamp.driver, vbios: card.stamp.vbios }, args: [], checksum: bench.GOLDEN_CHECKSUM };
const stampOk = stress.checkGoldenStamp(golden, { probed: true, driver: card.stamp.driver, vbios: card.stamp.vbios }, []);
await engine.sweepRange({
  curveDoc: suite.curveDocForCard(card, { fromMhz: 2842, toMhz: 2842 }),
  points: suite.pointsForCard(card),
  fromMhz: 2842, toMhz: 2842,
  envelopeMhz: card.card.maxGraphicsMhz,
  journal: journal.openJournal({ dir: journalDir }),
  runStepFn: suite.makeSweepStepFn(vc, card, stress, golden, stampOk),
  now: () => '2026-08-16T03:00:00+03:00',
  clockMs: (() => { let t = 0; return () => (t += 1000); })(),
});
`;
  writeFileSync(childPath, child);
  const r = spawnSync(process.execPath, [childPath, cardPath, journalDir],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 120_000 });
  return {
    died: r.status === 70,
    status: r.status,
    stderr: (r.stderr || '').split('\n').slice(0, 2).join(' '),
  };
}

function report(results) {
  for (const r of results) {
    if (r.state === 'OK') console.log(`OK   ${r.n}${r.note ? `  — ${r.note}` : ''}`);
    else if (r.state === 'ЖДЁТ') console.log(`ЖДЁТ ${r.n}\n       почему: ${r.why}`);
    else { console.log(`FAIL ${r.n}`); if (r.why) console.log(`       причина: ${r.why}`); }
  }
  const failed = results.filter((r) => r.state === 'FAIL').length;
  const waiting = results.filter((r) => r.state === 'ЖДЁТ').length;
  console.log(`\nНАБОР ЛОВУШЕК: ${results.length} утверждений, провалов ${failed}, ждут движка развёртки ${waiting}.`);
  // The line is printed only while something actually waits. Printing it over a run with zero pending
  // rows would be the report describing a state it is not in — and a footer nobody trusts is a footer
  // nobody reads. All four class-B assertions started running on 2026-08-16 (`plans/15` §4.5).
  if (waiting > 0) {
    console.log('«ЖДЁТ» — это НЕ зелёный. Утверждение написано и будет прогнано, когда движок дорастёт до него.');
  }
  console.log(PROVABILITY_LINE);
  return { total: results.length, failed, waiting };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runTrapSuite()
    .then((r) => process.exit(r.failed ? 1 : 0))
    .catch((e) => { console.error(e); process.exit(1); });
}
