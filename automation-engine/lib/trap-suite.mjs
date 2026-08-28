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
// СУДЬЯ ВЫДАННОЙ ЧАСТОТЫ — ТОТ ЖЕ, ЧТО У ЖИВОГО АТОМА, А НЕ ВТОРАЯ ЕГО КОПИЯ (`plans/45` шаг 1).
// Стенд обязан приходить к тому же решению тем же путём: две реализации одного суждения — это пара
// «истина ↔ зеркало» внутри одного проекта, и она уже молчала здесь однажды (EXP-0077).
import { judgeDeliveredClock, applyCeilingJudgement } from './vf-step.mjs';
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
  return async ({ offsetMhz, capMhz, pinMhz = null, lockMhz = null, writeShape = null, sustain = 10 }) => {
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
    // ─── ГРАНИЦА СВЕРХУ — ДИАПАЗОНОМ, А НЕ ТОЧКОЙ (`plans/45` шаги 3–4) ───────────────────────────
    //
    // `min` — нижняя ступень лестницы САМОЙ карты, `max` — потолок. Написать `min = max` значило бы
    // поставить ЗАКРЕПЛЕНИЕ вместо границы: карта потеряла бы право сбрасывать частоту, а стенд
    // репетировал бы форму, которую владелец прямо запретил (`GOAL.md`: *«карта сама могла и
    // разгоняться и снижать частоты»*; факт 38 — диапазон и есть потолок).
    //
    // ⚠️ ПОРЯДОК ТОТ ЖЕ, ЧТО У ЖИВОГО АТОМА: сперва кривая (она покупает частоту), потом граница (она
    // её ограничивает). Обратный порядок ограничивал бы ЗАВОДСКУЮ форму — другое состояние.
    if (lockMhz !== null) vc.backend.lockGraphicsClocksMhz(card.frequencyGridMhz[card.frequencyGridMhz.length - 1], lockMhz);

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

    // ─── ПОТОЛОК СУДИТСЯ ПО ВЫДАННОЙ ЧАСТОТЕ, А НЕ ТОЛЬКО ПО ТАБЛИЦЕ (`plans/45` шаг 1) ────────────
    //
    // 🔴 РАЗРЫВ ВЕРНОСТИ, РАДИ КОТОРОГО ЭТОТ БЛОК И ПОЯВИЛСЯ. Замер фазы 1 (`plans/44` → «ЧТО ФАЗА 2
    // ОБЯЗАНА СДЕЛАТЬ ПЕРВЫМ ШАГОМ»): на живой карте пробитый потолок ловила проверка потолка ПОД
    // НАГРУЗКОЙ и называла держателя `КАРТА`; на стенде движок вставал РАНЬШЕ, на
    // `runRung#delivery-above-stock`, и держателей в сводке не было вовсе. Двойник падал не там, где
    // падает карта, — значит любой зелёный после починки доказывал бы ветку, которой живая карта не
    // проходит. Выяснилось это откатом чужой правки: убрали побочную остановку — и ловушка перестала
    // ловить ЧТО-ЛИБО (EXP-0148).
    //
    // Своего блока потолка у стенда было ДВА слова из трёх: «ПОТОЛОК УСТОЯЛ В ТАБЛИЦЕ» судит то, что
    // кривая ПРЕДЛАГАЕТ, а живой дефект в том, что карта уходит выше вставшей формы. Третье слово —
    // это оно и есть.
    //
    // ⚠️ ОДНА ПРОБА, И ОНА ЧЕСТНАЯ, А НЕ ЭКОНОМИЯ. Живой атом считает медиану и максимум по пробам
    // сэмплера под нагрузкой, потому что живые пробы шумят. Виртуальная карта детерминирована:
    // `clockNow()` при записанной кривой и без очереди отдаёт одно и то же число сколько ни спрашивай,
    // поэтому медиана и максимум РАВНЫ прочитанному, и лишние чтения дали бы те же цифры ценой
    // перемешивания состояния карты (очередь устаревших проб, блуждание в простое) — то есть цену без
    // выгоды. Асимметрия судьи (вверх — по максимуму, вниз — по медиане) при этом не теряется: она
    // живёт в самой функции и заработает, как только у стенда появятся разные пробы.
    //
    // ⚠️ РЕШЕНИЕ НЕ ПОВТОРЯЕТСЯ ЗДЕСЬ, А ВЫЗЫВАЕТСЯ. `applyCeilingJudgement` — то же самое место, что
    // решает на живом пути: какие поля выставить, снять ли вердикт, что считать недобором. Она БРОСАЕТ
    // на превышении, потому что у живого атома отказ выражается красным блоком списка отката; здесь
    // блок собирается руками, поэтому бросок гасится, а красным делается блок. Скопировать её тело
    // значило бы завести вторую правду о потолке — ровно то, что запрещает её собственная шапка.
    //
    // ⚠️ ЗАКРЕПЛЁННАЯ СТУПЕНЬ СЮДА НЕ ВХОДИТ, И ЭТО ТОЖЕ ВЕРНОСТЬ ЖИВОМУ ПУТИ: там, где держит
    // закрепление, живой атом судит СОВСЕМ ДРУГИМ прибором (`verifyLockUnderLoad` — «частота
    // ПОСТОЯННА»), а потолка у формы `uniform` нет вовсе.
    const out = { verdict: v.verdict };
    const judged = pinMhz === null && !uniform && Number.isFinite(capMhz);
    if (judged) {
      const j = judgeDeliveredClock({
        capMhz,
        median: deliveredMhz,
        max: deliveredMhz,
        samples: 1,
        offeredAfterMhz: Number.isFinite(highestOfferedMhz) ? highestOfferedMhz : null,
      });
      try {
        applyCeilingJudgement(out, j, { capMhz, median: deliveredMhz, max: deliveredMhz, loadedSamples: 1 });
      } catch {
        // Превышение — это КРАСНЫЙ БЛОК атома, а не исключение из него: `runRung` маршрутизирует
        // отказ по флагу `proof`, и брошенное отсюда исключение поехало бы мимо этого провода.
      }
      // Имя и флаг — те же, что у живого атома (`vf-step`, список отката, `kind: 'proof'`): движок
      // отбирает блоки ПО ФЛАГУ, и блок с другим флагом поехал бы другим каналом (`plans/28`, A).
      blocks.push({
        name: `ПОТОЛОК ${capMhz} МГц УСТОЯЛ ПОД НАГРУЗКОЙ`,
        // ⚠️ «НЕ ВЫШЕ», А НЕ «РОВНО»: карта под ГРАНИЦЕЙ законно сидит ниже неё, и это измеряемая
        // величина, а не отказ. Мутация NC (`ok: deliveredMhz === capMhz`) прогнана 2026-08-25 и
        // воспроизвела регресс 2026-08-14 дословно: полоса T6 встала на `runRung#proof-failed`,
        // закрыто 0 частот из 6 — здоровые ступени объявлены неизмеримыми.
        ok: !j.breached,
        proof: true,
        why: j.why,
        detail: `выдано ${deliveredMhz} МГц при потолке ${capMhz}`,
      });
    }

    await vc.curveBackend.zeroCurve();
    // ⚠️ ОДНО УСЛОВИЕ НА ОБА СПОСОБА ДЕРЖАТЬ ЧАСТОТУ — как и в живом атоме. Оставить здесь только
    // `pinMhz` значило бы бросить `-lgc` на карте и отчитаться чистым откатом: отказ, которого не
    // видит ни один сторож, потому что все они смотрят на блоки, а блок был бы зелёным.
    if (pinMhz !== null || lockMhz !== null) vc.backend.resetGraphicsClocks();
    return {
      verdict: out.verdict,
      // ГРАНИЦА, КОТОРАЯ РЕАЛЬНО ВСТАЛА — движок кладёт её в `record.appliedLockMhz`, и без этого
      // поля репетиция не проверяет проводку, которой пользуется живой прогон (класс `bugs/49`).
      lockMhz,
      // ПРИЧИНА СНЯТОГО ВЕРДИКТА ЕДЕТ ОТ СУДЬИ, А НЕ ОТ ОРАКУЛА. Оракул сказал PASS; вердикт снял
      // потолок, и объяснять ступень обязано то утверждение, которое её остановило.
      reason: out.reason ?? v.reason,
      worstShape: 'sdc_fma/transient',
      deliveredMhz,
      deliveredMaxMhz: deliveredMhz,
      // НЕДОБОР СЧИТАЕТ СУДЬЯ, А НЕ ЭТОТ ФАЙЛ. Прежняя редакция считала его здесь своей арифметикой
      // (`deliveredMhz < ordered`) — то есть второй копией решения, и копия была СТРОЖЕ оригинала:
      // она звала недобором любую разницу, включая одну ступень сетки, которую судья считает
      // округлением (`config.CLOCK_LADDER_STEP_TOLERANCE_MHZ`). Где судья не звался — закреплённая
      // ступень, — молчим, ровно как молчит живой атом на своей закреплённой ветке.
      clockShortfall: judged ? out.clockShortfall === true : false,
      deliveredShortfallMhz: judged ? (out.deliveredShortfallMhz ?? null) : null,
      // ДЕРЖАТЕЛЬ ПРОБИТОГО ПОТОЛОКА — `КАРТА` · `ЗАПИСЬ` · `НЕИЗВЕСТНО` (`bugs/50`). Без этого поля
      // сводка прогона на стенде не могла отличить починку КОДА записи от ЗАМЕРА карты.
      ceilingBreachHolder: out.ceilingBreachHolder ?? null,
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
  // ВМЕСТЕ с реестром, а не вслед за прогоном. Восьмую (T8, 2026-08-25, `plans/44`) он заметил
  // так же — красным, — и число правится здесь ОСОЗНАННО, а не подгоняется под то, что нашлось.
  check('ЛОВУШКИ: их ВОСЕМЬ, и класс каждой назван ДО прогона (B3-AC1)',
    TRAPS.length === 8 && cards.size === 8, `на диске ${cards.size} из ${TRAPS.length}`);

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

  // ─── КАРТА ПОСЛЕ ПОЛОСЫ ОБЯЗАНА ОСТАТЬСЯ ЧИСТОЙ — ОДИН СТОРОЖ НА ВСЕ ЛОВУШКИ ────────────────────
  //
  // 🔴 ЗАВЕДЁН ПО НАХОДКЕ МУТАЦИИ, А НЕ ПО ПЛАНУ (`plans/45` шаг 6, мутация NB). Мутация «взвести
  // границу и НЕ отпустить её» покрасила РОВНО НОЛЬ утверждений: набор из 51 блока прошёл целиком,
  // хотя стенд оставлял `-lgc` на карте после каждой ступени. Причина структурная и потому опасная:
  // следующая ступень ПЕРЕЗАПИСЫВАЕТ замок своим, а в конце полосы никто не спрашивал карту, держит
  // ли её ещё что-нибудь. То есть утечка состояния была невидима ПО ПОСТРОЕНИЮ.
  //
  // ⚠️ И ЭТО КЛАСС, А НЕ СЛУЧАЙ: границу с этого дня получает КАЖДАЯ ступень выше пола потолка, то
  // есть все полосы всех ловушек, — поэтому сторож один и зовётся после каждого прогона, а не живёт
  // внутри T8. «Починить экземпляр» здесь означало бы оставить четыре дыры из пяти.
  //
  // Спрашиваем КАРТУ (`peek`), а не свои намерения: счётчик вызовов сказал бы, сколько раз мы звали
  // сброс, а вопрос стоит о том, что осталось НА КАРТЕ.
  const cardAtRest = (label, vc) => {
    const st = vc?.peek?.();
    check(`${label}: КАРТА ПОСЛЕ ПОЛОСЫ ЧИСТА — ни замка, ни ненулевых сдвигов кривой`,
      Boolean(st) && st.lock === null && st.nonZeroOffsets === 0,
      !st ? 'карта не отдала своё состояние — спросить не у чего'
        : `осталось: замок ${st.lock ? `${st.lock.min}…${st.lock.max} МГц` : 'нет'}, `
          + `ненулевых сдвигов ${st.nonZeroOffsets}. Следующий прогон стартовал бы на карте, `
          + 'состояние которой никто не называл',
      'замка нет, ненулевых сдвигов 0');
  };

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
    cardAtRest('T3', r.vc);

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
    cardAtRest('T6', r6.vc);
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
    // ─── УРОЖАЙ ПРОЙДЁН НАСКВОЗЬ, НА КАРТЕ, КОТОРАЯ НИКОГДА НЕ ОТДАЁТ ЗАКАЗАННОЕ ──────────────────
    //
    // `plans/41` фаза 2. Ловушка T6 — единственное место, где вся цепочка проверяется в тех условиях,
    // ради которых урожай и заведён: заказ и выдача РАСХОДЯТСЯ. Утверждается не «функция работает»
    // (это держат блоки журнала), а что прогон ЦЕЛИКОМ — движок, воронка ступеней, запись вердикта и
    // сводка — доносит пару до конца.
    //
    // ⚠️ И УТВЕРЖДЕНИЕ НЕ ВАКУУМНОЕ: урожай обязан быть БОЛЬШЕ закрытого. Разрыв и есть предмет
    // эпика (живой прогон 2026-08-24: 23 ступени, 16 прожигов, 4 строки), а равенство означало бы,
    // что собирать было нечего и блок зеленеет по неинтересной причине (EXP-0016).
    const h6 = r6.report.harvest;
    check('T6: УРОЖАЙ ПРОЙДЁН НАСКВОЗЬ — пар собрано БОЛЬШЕ, чем закрыто строк, и половинок ноль',
      (h6?.burnsHeld ?? 0) > r6.report.closed && (h6?.halfPairs?.length ?? 1) === 0 && (h6?.pairs?.size ?? 0) > 0,
      `прожигов выдержано ${h6?.burnsHeld ?? '—'} против ${r6.report.closed} закрытых, `
        + `выданных частот ${h6?.pairs?.size ?? '—'}, половинок ${h6?.halfPairs?.length ?? '—'} `
        + '(половинка — ступень, прожиг выдержавшая, но оставившая на диске напряжение без частоты)',
      `${h6.burnsHeld} прожигов на ${h6.pairs.size} выданных частотах против ${r6.report.closed} закрытых строк, половинок 0`);
    // И ХОТЯ БЫ ОДНА ПАРА ЛЕЖИТ НЕ ПОД ЗАКАЗАННОЙ ЧАСТОТОЙ — то, что доказуемо ТОЛЬКО здесь.
    // Ключевание выданной частотой ради этого и введено; на карте, отдающей заказ, обе версии
    // ключа дали бы одно и то же, и блок ничего бы не различал.
    check('T6: и пара ключуется ВЫДАННОЙ частотой — есть пара, чей заказ был другим',
      [...(h6?.pairs?.values() ?? [])].some((p) => p.orderedMhz.some((o) => Number.isFinite(o) && o !== p.deliveredMhz)),
      'ни одна пара не разошлась с заказом — либо карта отдала всё заказанное, либо ключ всё ещё заказанный',
      // `?.` И ФРАЗА ВМЕСТО ПАДЕНИЯ — EXP-0075, предъявленный СЕДЬМОЙ раз, и на этот раз мною же:
      // сообщение об УСПЕХЕ вычисляется всегда, поэтому под мутацией, забирающей расхождение,
      // `find` вернул `undefined` и разыменование унесло ВЕСЬ набор ловушек. Сторож, прячущий своё
      // доказательство за падением, хуже снятого: мутация читается как «набор не завершился».
      (() => {
        const p = [...(h6?.pairs?.values() ?? [])].find((x) => x.orderedMhz.some((o) => o !== x.deliveredMhz));
        return p ? `${p.deliveredMhz} МГц ← ${p.deepestMv} мВ, а заказывали ${[...new Set(p.orderedMhz)].join('/')} МГц`
          : 'расхождения нет ни у одной пары';
      })());
    check('T6: и КАЖДЫЙ замер лёг в строку ВЫДАННОЙ частоты, а не заказанной',
      measured6.length > 0 && measured6.every((x) => {
        const m = typeof x.provenBy === 'string' ? x.provenBy.match(/ВЫДАНО (\d+)/) : null;
        return !m || Number(m[1]) === x.mhz;
      }),
      `строк с замером ${measured6.length}, из них с чужой выданной частотой: `
        + measured6.filter((x) => { const m = typeof x.provenBy === 'string' ? x.provenBy.match(/ВЫДАНО (\d+)/) : null; return m && Number(m[1]) !== x.mhz; }).map((x) => x.mhz).join(', '));

    // ─── ПРОЖИГ, КУПЛЕННЫЙ БЕЗ НОВОЙ ГЛУБИНЫ (`plans/48`, ЭПИК 47 ФАЗА 1) ────────────────────────
    //
    // Слово владельца 2026-08-25, живая приёмка: *«Ни один прожиг не должен быть в пустую. Если
    // что-то жгли — для нас эта улика о стабильности той пары VF, которую прожгли»*. До сегодня НИ
    // ОДНА ловушка не краснела за это: T6 расходится заказом и выдачей с 2026-08-23, и полоса всё
    // равно закрывалась зелёной — «прожиг не купил глубины» не утверждалось нигде.
    //
    // ⚠️ ПОЧЕМУ ЭТО ЛОВИТСЯ ИМЕННО ЗДЕСЬ, А НЕ НОВОЙ КАРТОЙ. Замерено до кода: полоса T6 УЖЕ жжёт
    // впустую — её регулятор уводит спуск разных ЗАКАЗАННЫХ частот на одну и ту же ВЫДАННУЮ, и
    // второй спуск проходит по ней всю лестницу заново, хотя глубина там доказана первым. Девятая
    // карта была бы вымыслом там, где хватает утверждения (`plans/48` шаг 1: каждая карта — вымысел,
    // который надо держать верным).
    //
    // ⚠️ ТРИ РЯДА, А НЕ ОДИН, И ЭТО ПРЯМО ПРОТИВ EXP-0148: побочная ловля и прямая проверка
    // неотличимы, пока обе красные. Поэтому механизм и прибор утверждаются ОТДЕЛЬНО и ЗЕЛЁНЫМИ —
    // их красит мутация, — а обязательство стоит третьим и ждёт фазы 2 с сегодняшним числом.
    const wasted6 = h6?.wastedBurns ?? [];
    // 1. МЕХАНИЗМ. Без повторно жжённых выданных частот трата ФИЗИЧЕСКИ невозможна, и любое
    //    «трат 0» ниже читалось бы вакуумно — класс `bugs/40` (заголовок совпал, под ним не читали).
    check('T6: ЕСТЬ ГДЕ ТРАТИТЬ — разные ЗАКАЗАННЫЕ частоты сходятся на одной ВЫДАННОЙ, и она жжётся повторно',
      (h6?.repeatedFrequencies ?? 0) > 0,
      `повторно жжённых выданных частот ${h6?.repeatedFrequencies ?? '—'} — ни одной, значит траты не может быть `
        + 'по построению полосы, и утверждения ниже ничего не проверяют',
      `${h6.repeatedFrequencies} выданных частот(ы) жглись повторно из ${h6.pairs.size}`);
    // 2. ПРИБОР. Счётчик обязан ВИДЕТЬ дефект на движке, который его допускает — иначе фаза 2 будет
    //    чинить то, чего не видно, и её зелёный ничего не докажет.
    //
    // ⚠️ РЯД НЕ УТВЕРЖДАЕТ, ПО КАКОМУ НАПРЯЖЕНИЮ ИДЁТ СЧЁТ, И ЭТО ИСПРАВЛЕНИЕ ПО ЗАМЕРУ, А НЕ
    //    ОСТОРОЖНОСТЬ. Первая редакция называлась «…и считает по ОБСЛУЖИВШЕМУ напряжению, а не по
    //    заказанному». Мутация PB (считать по заказанному) покрасила здесь НОЛЬ: на этой карте
    //    заказанное и обслужившее почти совпадают, и полоса такого различения не даёт вовсе. Это
    //    замер отсутствующего покрытия, а не крепкий код (EXP-0150). Различение держат блоки
    //    `journal --selftest` на ЖИВОЙ фикстуре полосы 2355 (заказ 820 → обслужило 840), где та же
    //    мутация красит два блока и обнуляет реальную трату. Утверждение обязано обещать ровно
    //    столько, сколько его прогон доказывает.
    check('T6: СЧЁТЧИК ВИДИТ ТРАТУ на полосе, где движок целится в частоту, которой карта не даёт',
      wasted6.length > 0 && wasted6.every((w) => Number.isFinite(w.servingMvAfter) && Number.isFinite(w.knownDeepestMv)
        && w.servingMvAfter >= w.knownDeepestMv),
      `пустых прожигов насчитано ${wasted6.length} — ноль означает, что прибор слеп к дефекту, который на этой полосе ЕСТЬ`,
      `${wasted6.length} пустых прожигов из ${h6.burnsHeld}; первый: ${wasted6[0]?.deliveredMhz} МГц ← `
        + `${wasted6[0]?.servingMvAfter} мВ при уже доказанных ${wasted6[0]?.knownDeepestMv} мВ`);
    // 3. И ЭТО НЕ ПОВТОРНЫЙ ЗАКАЗ, А ЗАКОННЫЙ СЛЕДУЮЩИЙ ШАГ ДВИЖКА (F1-AC2). Каждая пустая ступень
    //    заказывала пару «частота + напряжение», которой в этом прогоне ещё не заказывали, то есть
    //    прошла ВСЕ существующие сторожа и всё равно ничего не купила. Дефект живёт в
    //    ПОСЛЕДОВАТЕЛЬНОСТИ, а не в ступени — то же семейство, что `bugs/42`.
    check('T6: и трата — НЕ повторный заказ: каждый пустой прожиг был законным следующим шагом движка',
      wasted6.length > 0 && new Set(wasted6.map((w) => `${w.orderedMhz}@${w.orderedMv}`)).size === wasted6.length,
      `заказанных пар ${new Set(wasted6.map((w) => `${w.orderedMhz}@${w.orderedMv}`)).size} на ${wasted6.length} пустых `
        + 'прожигов — значит часть из них поймал бы уже существующий сторож повторного заказа, и ловушка лишняя',
      `${wasted6.length} пустых прожигов и столько же РАЗНЫХ заказанных пар — ни один не ловится сторожем bugs/42`);
    // 4. ОБЯЗАТЕЛЬСТВО. Красное сегодня и обязано быть красным: лечение — фаза 2 эпика 47, где цель
    //    спуска переезжает на выданную частоту. Стоит «ЖДЁТ» по той же объявленной причине, по
    //    которой стояла T8 между фазами 1 и 2 эпика 43: держать репозиторий красным между фазами
    //    нечестно перед следующей сессией, а молча зазеленить утверждение — нечестно перед дефектом.
    //
    // 🔴 ЗАМЕРЕНО КРАСНЫМ ПЕРЕД ТЕМ, КАК СТАТЬ «ЖДЁТ»: `npm run traps` 2026-08-25 20:5x с этим рядом
    //    как `check` → «провалов 1», причина «пустых прожигов 30 из 61 (49 % полосы)». Ряд не
    //    объявлен ждущим со слов — он был прогнан красным.
    //
    // ⚠️ И ОДНА МУТАЦИЯ ПЛАНА НЕ СРАБОТАЛА, ЧТО САМО ПО СЕБЕ НАХОДКА. `plans/48` шаг 5 PA обещал:
    //    «отнять у карты ограничитель регулятора → утверждение ЗЕЛЕНЕЕТ, то есть оно следит за
    //    расхождением, а не за полосой». Прогнано: `governorBelowCeilingMhz` 60 → 0 дало 30 → **14**
    //    пустых прожигов, а не 0, и повторно жжённых частот стало БОЛЬШЕ (8 из 11 против 7 из 8).
    //    Причина названа замером, а не догадкой: под андервольтом карта ПРОСЕДАЕТ, и разные
    //    заказанные частоты сходятся на одной выданной БЕЗ всякого регулятора. То есть трата —
    //    свойство СХОЖДЕНИЯ, а не свойство этой ловушки, и живая карта владельца показала ровно её.
    //    Дефект шире, чем «карта никогда не отдаёт заказ», и фаза 2 обязана целиться в схождение.
    // ⚠️ СУДИТСЯ ИЗБЕЖНАЯ ПОЛОВИНА, И РАЗДЕЛЕНИЕ ВВЕДЕНО ПОСЛЕ ЗАМЕРА — ГОВОРЮ ЭТО ВСЛУХ.
    //
    // Фаза 2 довела строгий счёт с 30 до 7, и все семь оказались ПЕРВЫМИ прожигами своих спусков:
    // движок не может знать, на какую частоту сядет карта, пока не прожжёт первую ступень. Выданная
    // частота — НАБЛЮДЕНИЕ, а не предсказание; требовать её угадать значит требовать выдумать факт
    // (`PHILOSOPHY.md` → три двери). Такой прожиг покупает знание, то есть пустым не является.
    //
    // Строгое число при этом НЕ спрятано: оно печатается рядом рядом с избежным и в сводке прогона.
    // Ослаблением это было бы, если бы величину подогнали под результат; здесь она РАЗДЕЛЕНА на две
    // разные величины, и каждая судится своим рядом.
    const avoidable6 = h6?.avoidableBurns ?? [];
    const discovery6 = h6?.discoveryBurns ?? [];
    check('T6: НИ ОДИН ИЗБЕЖНЫЙ ПРОЖИГ НЕ КУПЛЕН ВПУСТУЮ — узнав, где карта, спуск больше не жжёт зря',
      avoidable6.length === 0,
      `избежных пустых прожигов ${avoidable6.length} из ${h6.burnsHeld}: `
        + avoidable6.slice(0, 3).map((w) => `${w.deliveredMhz} МГц ← ${w.servingMvAfter} мВ при доказанных ${w.knownDeepestMv}`).join(' · ')
        + ' — спуск УЖЕ знал, где работает карта, и всё равно не углубился',
      `избежных 0 · разведочных ${discovery6.length} (первый прожиг спуска, которым и узнаётся выданная частота) `
        + `· строгий счёт ${wasted6.length} из ${h6.burnsHeld}`);
    // И РАЗВЕДОЧНЫЙ ПРОЖИГ ОБЯЗАН БЫТЬ РОВНО ОДИН НА СПУСК — иначе «разведка» становится корзиной,
    // куда прячут любую трату. Проверяется утвердительно: пар «заказ+выдача» столько же, сколько
    // разведочных прожигов.
    check('T6: и разведочных прожигов не больше одного на пару «заказ ↔ выдача» — это не корзина для трат',
      new Set(discovery6.map((w) => `${w.orderedMhz}@${w.deliveredMhz}`)).size === discovery6.length,
      `разведочных ${discovery6.length}, а различных пар «заказ ↔ выдача» среди них `
        + `${new Set(discovery6.map((w) => `${w.orderedMhz}@${w.deliveredMhz}`)).size} — значит какая-то пара разведывалась дважды`,
      `${discovery6.length} разведочных на ${new Set(discovery6.map((w) => `${w.orderedMhz}@${w.deliveredMhz}`)).size} пар «заказ ↔ выдача»`);
    // ─── ПОЛ КАРТЫ: ЗАКАЗЫВАЕМ ГЛУБЖЕ, А ОНА ВОЗВРАЩАЕТ УЖЕ ДОКАЗАННОЕ (`bugs/58`) ───────────────
    //
    // 🔴 РОДИЛОСЬ ИЗ ЖИВОГО ПРОГОНА 2026-08-25 22:0x ПРИ ВЛАДЕЛЬЦЕ, а не из воображения. Полоса
    // 2400…2305: заказали 820 мВ — карта подставила 840; заказали 810 — снова 840. На 2347 МГц
    // карта стоит на 840 и глубже не идёт. **3 прожига из 10 (30 %) не дали документу ничего.**
    //
    // ⚠️ СТОРОЖ `bugs/42` ЭТОГО НЕ ЛОВИТ НИ В ОДНОЙ ИЗ ДВУХ СВОИХ ФОРМ. Он ключуется ЗАКАЗАННЫМ
    // напряжением (эпик 47 фаза 2 сделала ключ парой «частота + заказ»), а заказы 820 и 810 РАЗНЫЕ.
    // Не движется ОБСЛУЖИВШЕЕ напряжение — и именно на него никто не смотрит.
    //
    // ⚠️ ПОЛОСА ДРУГАЯ, И ЭТО НЕ ПРИДИРКА К ВЫБОРУ. На 2857…2790 этой карты избежных трат нет ни на
    // одном семени; на 2842…2790 они есть на ШЕСТИ семенах из семи, подпись одна: «заказ 810 →
    // обслужило 810, а 810 там уже доказано». Полоса выбрана ЗАМЕРОМ (семь семян прогнаны до
    // написания утверждения), а не удобством, — иначе зелёное зависело бы от везения с семенем.
    const rFloor = await runSweep(t6card, { seed: 31, fromMhz: 2842, toMhz: 2790, stress, golden, stampOk });
    cardAtRest('T6-пол', rFloor.vc);
    const hFloor = rFloor.report.harvest;
    const avoidFloor = hFloor?.avoidableBurns ?? [];
    // МЕХАНИЗМ ПЕРВЫМ: полоса обязана СОДЕРЖАТЬ случай, иначе «избежных 0» проходит вакуумно.
    check('T6-пол: ПОЛОСА СОДЕРЖИТ СЛУЧАЙ — карта возвращает напряжение, которое там уже доказано',
      (hFloor?.repeatedFrequencies ?? 0) > 0 && (hFloor?.burnsHeld ?? 0) > 0,
      `повторно жжённых выданных частот ${hFloor?.repeatedFrequencies ?? '—'}, прожигов ${hFloor?.burnsHeld ?? '—'} — `
        + 'случая нет, и утверждение ниже ничего не проверяет',
      `прожигов ${hFloor.burnsHeld}, повторно жжённых частот ${hFloor.repeatedFrequencies}`);
    // ─── ЗАЗОР ЗАПАСА — ЦЕНА КОНСЕРВАТИВНОЙ ЗЕМЛИ, НАЗВАННАЯ ЧИСЛОМ И ЗАБЮДЖЕТИРОВАННАЯ ──────────
    //
    // ⚠️ РЯД ПЕРЕЦЕЛЕН ПОСЛЕ ПРОГОНА, И ГОВОРЮ ЭТО ВСЛУХ. Он писался как ловушка на пол карты
    // (`bugs/58`) и был КРАСНЫМ — но разбор показал, что краснеет он по СОСЕДНЕЙ причине: заказ 810
    // возвращает 810, то есть карта слушается, а трата берётся из зазора между СЫРЫМ доказанным
    // (810) и рабочей точкой строки документа (810 + запас владельца = 815). Пол карты здесь ни
    // при чём. Оставить прежнее имя значило бы держать утверждение, обещающее не то, что оно
    // проверяет, — ровно класс EXP-0148, за который этот эпик уже заплатил один раз.
    //
    // Пол карты проверяется ПРЯМО, подменной ступенью на реальной `sweepFrequency`
    // (`engine --selftest` → «ПОЛ КАРТЫ ОСТАНАВЛИВАЕТ СПУСК»), где ничто другое симптома не даёт.
    //
    // ЧТО УТВЕРЖДАЕТСЯ ЗДЕСЬ: зазор запаса — ОСОЗНАННАЯ ЦЕНА, а не дефект. Земля берётся из строки
    // документа (с запасом) намеренно: замер эпика 47 фазы 2 показал, что сырая земля делает спуск
    // агрессивнее и стоит КРАЯ (найденных краёв 3 → 2 на обычной карте). Цена измерена — 2 прожига
    // на этой полосе — и ряд сторожит, чтобы она НЕ РОСЛА. Ноль здесь требовать нельзя, не оплатив
    // его краями; закрыть по-настоящему может только сырая земля, не стоящая краёв, — это работа
    // фазы 3, а не подгонка числа сегодня.
    const FLOOR_BUDGET = 2;
    check(`T6-пол: ЗАЗОР ЗАПАСА НЕ РАСТЁТ — цена консервативной земли не больше ${FLOOR_BUDGET} прожигов`,
      avoidFloor.length <= FLOOR_BUDGET,
      `избежных пустых прожигов ${avoidFloor.length} из ${hFloor.burnsHeld} при бюджете ${FLOOR_BUDGET}: `
        + avoidFloor.slice(0, 3).map((w) => `заказ ${w.orderedMv} мВ → ${w.deliveredMhz} МГц обслужило `
          + `${w.servingMvAfter} мВ при уже доказанных ${w.knownDeepestMv}`).join(' · ')
        + ' — цена выросла, и это регресс, а не новая норма',
      `избежных ${avoidFloor.length} из ${hFloor.burnsHeld} прожигов при бюджете ${FLOOR_BUDGET} `
        + `· полоса закрыла ${rFloor.report.closed} строк(и)`);
    // И ПОЛОСА НЕ ГИБНЕТ ОТ ЭТОЙ ОСТАНОВКИ: закрывается ЧАСТОТА, а не прогон — граница `bugs/42`.
    check('T6-пол: и полоса НЕ ГИБНЕТ — частота закрывается тем, что доказано, прогон идёт дальше',
      rFloor.report.stoppedBy === null && rFloor.report.closed > 0,
      `остановлено «${rFloor.report.stoppedBy ?? '—'}», закрыто ${rFloor.report.closed}`,
      `закрыто ${rFloor.report.closed} строк(и), полоса доведена до конца`);
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

  // ── T8 — КАРТА, КОТОРАЯ РАБОТАЕТ ВЫШЕ ПОТОЛКА СОБСТВЕННОЙ КРИВОЙ (`plans/44`, эпик 43 фаза 1) ────
  //
  // Ловушка на `bugs/50`. До 2026-08-25 стенд этого не умел ПО ПОСТРОЕНИЮ — `deliveredUnderCurve`
  // отбрасывает всё, что выше потолка, — а живая карта делала это девять раз из девяти, всегда на
  // ЦЕЛОЕ число ступеней сетки (2 в семи случаях, 3 в двух; `researches/11` §8).
  //
  // ⚠️ ФАЗА 1 СТАВИТ ЛОВУШКУ, А НЕ ЛЕЧИТ. Утверждение ниже про то, что движок обязан НАЗВАТЬ
  // происходящее, а не про то, что прогон обязан пройти: замок появляется в фазе 2, и до неё
  // ступень законно остаётся без вердикта.
  const t8card = cards.get('T8_runs_above_the_ceiling_it_was_given');
  if (t8card) {
    const { golden, stampOk } = stressFor(t8card);
    // ⚠️ СНАЧАЛА — САМ МЕХАНИЗМ, ПРИ НУЛЕВОЙ ГЛУБИНЕ. Урок T6 дословно: первая редакция той ловушки
    // проверяла только следствие, и мутация «отнять у карты ограничитель» не покрасила НИЧЕГО.
    // Здесь спуска нет вовсе — кривая только подрезана потолком, — поэтому уйти ВЫШЕ потолка карта
    // может ТОЛЬКО от поля ловушки: ни край, ни шум вверх не двигают.
    const boostVc = virtualCard(t8card, { settleSamples: 0, seed: 31 });
    const CAP8 = 2842;
    await boostVc.curveBackend.writeRaiseAndCap(0, CAP8, { cardMaxClockMhz: t8card.card.maxGraphicsMhz });
    // Проба — `deliveredNowMhz`, ФИЗИЧЕСКАЯ выдача под работой (тот же `runningMhz`, по которому
    // судит оракул), а не `clocks.gr` в простое: с 2026-08-28 двойник в покое сбрасывается вниз,
    // как живая карта (спад простоя, эпик 59 фаза 3), и чтение без нагрузки о пробое не говорит.
    // Механизм ловушки — про то, что карта ДЕЛАЕТ под нагрузкой, и вопрос задаётся ровно ему.
    const deliveredAtZero = Number(boostVc.deliveredNowMhz());
    await boostVc.curveBackend.zeroCurve();
    check('T8: КАРТА УХОДИТ ВЫШЕ ПОТОЛКА ДАЖЕ БЕЗ АНДЕРВОЛЬТА — это и есть механизм ловушки',
      Number.isFinite(deliveredAtZero) && deliveredAtZero > CAP8,
      `при нулевой глубине карта выдала ${deliveredAtZero} МГц при потолке ${CAP8} — превышения нет, `
        + 'значит поле ловушки не доехало до карты и всё зелёное ниже ничего не стоит',
      `${deliveredAtZero} МГц при потолке ${CAP8}, превышение ${deliveredAtZero - CAP8} МГц`);
    // И ПРЕВЫШЕНИЕ ОБЯЗАНО БЫТЬ БОЛЬШЕ ДОПУСКА СУДЬИ, иначе ловушка ловит округление, а не дефект:
    // допуск — ОДНА ступень сетки (`config.CLOCK_LADDER_STEP_TOLERANCE_MHZ`), ловушка несёт две.
    check('T8: и превышение БОЛЬШЕ допуска судьи — ловушка ловит дефект, а не округление сетки',
      deliveredAtZero - CAP8 > config.CLOCK_LADDER_STEP_TOLERANCE_MHZ,
      `превышение ${deliveredAtZero - CAP8} МГц против допуска ${config.CLOCK_LADDER_STEP_TOLERANCE_MHZ} МГц`,
      `превышение ${deliveredAtZero - CAP8} МГц > допуска ${config.CLOCK_LADDER_STEP_TOLERANCE_MHZ} МГц`);

    // ─── ЗАМОК ПОДАВЛЯЕТ ПРЕВЫШЕНИЕ — КОНТРАКТ МОДЕЛИ, НА КОТОРЫЙ ОБОПРЁТСЯ ФАЗА 2 (F1-AC3) ──────
    //
    // ⚠️ ЧЕСТНО О ТОМ, ЧТО ЭТОТ БЛОК ДОКАЗЫВАЕТ, А ЧТО НЕТ. Подавление выпадает из модели ДАРОМ:
    // `runningMhz` возвращает закреплённую частоту первой, поэтому закреплённая виртуальная карта
    // не может уйти выше НИ ПРИ КАКОМ поле. Значит блок доказывает не кремний, а КОНТРАКТ двойника:
    // «замок сильнее буста» зафиксировано, и фаза 2 не сможет тихо его поменять. Держит ли замок на
    // ЖИВОЙ карте — вопрос `researches/11` §1 и приёмки фазы 3, и ничем другим он не закрывается.
    const lockedVc = virtualCard(t8card, { settleSamples: 0, seed: 31 });
    await lockedVc.curveBackend.writeRaiseAndCap(0, CAP8, { cardMaxClockMhz: t8card.card.maxGraphicsMhz });
    lockedVc.backend.lockGraphicsClocksMhz(CAP8, CAP8);
    // Та же проба, что у блока механизма выше, и по той же причине (физика, не чтение простоя).
    const deliveredLocked = Number(lockedVc.deliveredNowMhz());
    await lockedVc.curveBackend.zeroCurve();
    check('T8: ЗАМОК СИЛЬНЕЕ БУСТА — под замком та же карта превышения не даёт (контракт для фазы 2)',
      deliveredLocked === CAP8,
      `под замком ${CAP8} МГц карта выдала ${deliveredLocked} МГц — превышение ${deliveredLocked - CAP8} МГц, `
        + 'то есть замок буста не подавляет и фаза 2 строится на неверной посылке',
      `под замком ${CAP8} МГц выдано ровно ${deliveredLocked} МГц, превышение 0 (против ${deliveredAtZero - CAP8} МГц без замка)`);

    // ─── УТВЕРЖДЕНИЕ САМОЙ ЛОВУШКИ: АТОМ НАЗЫВАЕТ ДЕРЖАТЕЛЯ, И ЭТО ПРОВЕРЯЕТСЯ БЕЗ ЗАМКА ──────────
    //
    // ⚠️ ПОЧЕМУ ЭТО НЕ ПРОГОН ПОЛОСЫ, А ОДИН ВЫЗОВ АТОМА. `mustDo` этой ловушки говорит о том, что
    // движок обязан сделать, КОГДА ПРОБОЙ СЛУЧИЛСЯ. После фазы 2 отгружаемая форма несёт замок, и
    // пробоя в полосе не случается вовсе — значит на прогоне полосы это утверждение стало бы
    // ВАКУУМНЫМ: пустой список пропущенных «не содержит ЗАПИСЬ» с тем же успехом, что и полный. Оно
    // проверяется там, где пробой ещё возможен: атом получает форму БЕЗ замка и обязан назвать
    // держателя `КАРТА`.
    //
    // И это же — постоянный сторож проводки, которую поставил шаг 1 `plans/45`: пока
    // `judgeDeliveredClock` не проходил через стенд, держателя не называл никто, и дефект ловился
    // ПОБОЧНО, чужой проверкой (EXP-0148). Удалить вызов судьи из атома — и этот блок краснеет.
    const bareVc = virtualCard(t8card, { settleSamples: 0, seed: 31 });
    const bareStep = makeSweepStepFn(bareVc, t8card, stress, golden, stampOk);
    const bare = await bareStep({ offsetMhz: 0, capMhz: CAP8, pinMhz: null, writeShape: 'raise-and-cap', sustain: 1 });
    check(`T8: ${mustDoOf('T8_runs_above_the_ceiling_it_was_given')} — прогнано, а не заявлено`,
      bare.ceilingBreachHolder === 'КАРТА' && bare.verdict !== config.VERDICT.PASS,
      `атом без замка вернул держателя «${bare.ceilingBreachHolder ?? '—'}» и вердикт `
      + `«${bare.verdict ?? '—'}»: пробой либо не замечен, либо приписан не той стороне `
      + `(выдано ${bare.deliveredMhz} МГц при потолке ${CAP8})`,
      `без замка держатель «${bare.ceilingBreachHolder}», вердикт снят (выдано ${bare.deliveredMhz} МГц `
      + `при потолке ${CAP8}); запись при этом безупречна — кривая предлагает не выше ${bare.highestOfferedMhz}`);

    // ─── А ТЕПЕРЬ — ЛЕЧЕНИЕ: ОТГРУЖАЕМАЯ ФОРМА ОБЯЗАНА ПОТОЛОК УДЕРЖАТЬ ────────────────────────────
    //
    // Два утверждения об одном прогоне полосы, и они РАЗНЫЕ: первое — что пробоя больше нет, второе —
    // что полоса от этого не гибнет. Порознь каждое можно удовлетворить дёшево (не судить потолок
    // вовсе · закрыть полосу нулём строк), вместе — только замком.
    const r8 = await runSweep(t8card, { seed: 31, fromMhz: 2857, toMhz: 2827, stress, golden, stampOk });
    // ⚠️ ЗДЕСЬ ОН ГЛАВНЫЙ: это единственная полоса, где граница взводится на КАЖДОЙ ступени и
    // отпускается столько же раз. Мутация NB («не отпускать») краснит именно его.
    cardAtRest('T8', r8.vc);
    const skipped8 = r8.report.skipped ?? [];
    const byCard = skipped8.filter((s) => s.ceilingBreachHolder === 'КАРТА');
    const closed8 = Object.values(r8.report.verdicts ?? {}).reduce((a, b) => a + b, 0);
    check('T8: ОТГРУЖАЕМАЯ ФОРМА ДЕРЖИТ ПОТОЛОК — ни одна ступень полосы не пропущена по пробитому потолку',
      byCard.length === 0,
      `пропущено по пробитому потолку ${byCard.length} ступеней из ${skipped8.length}; остановлено `
      + `«${r8.report.stoppedBy ?? '—'}». Держатели в сводке: `
      + `${[...new Set(skipped8.map((s) => s.ceilingBreachHolder ?? '—'))].join(', ')}`,
      `пропущенных по потолку 0 (всего пропущено ${skipped8.length})`);
    check('T8: и полоса НЕ ГИБНЕТ — частота закрывается своей причиной, прогон идёт дальше',
      closed8 >= 1 && !r8.report.stoppedBy,
      `закрыто ${closed8} строк(и), остановлено «${r8.report.stoppedBy ?? '—'}» — `
      + `${String(r8.report.why ?? '').slice(0, 120)}`,
      `закрыто ${closed8} строк(и), полоса доведена до конца`);
  } else fail('T8: карта загружена', 'карты нет на диске');

  // ── T4 — the edge lies DEEPER than our ±1000 MHz lever reaches. Reporting that as an edge would be
  // the false `[TESTED]` the second verdict exists to forbid.
  const t4card = cards.get('T4_edge_below_the_lever');
  if (t4card) {
    const { golden, stampOk } = stressFor(t4card);
    const r = await runSweep(t4card, { seed: 31, fromMhz: 2842, toMhz: 2827, stress, golden, stampOk });
    cardAtRest('T4', r.vc);
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
    // ⚠️ И ЗДЕСЬ ТОЖЕ, ХОТЯ ПОЛОСА ОСТАНАВЛИВАЕТСЯ ПОЛОМ ЗАВИСАНИЯ: остановленный прогон — ровно тот
    // случай, где утечка состояния вероятнее всего, потому что путь выхода не штатный.
    cardAtRest('T5', third.vc);
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
    // ⚠️ ОДНО ОБЪЯВЛЕННОЕ ИСКЛЮЧЕНИЕ, И ОНО НЕ ОСЛАБЛЯЕТ СТОРОЖА (`plans/44`). Ловушка, поставленная
    // ФАЗОЙ, лечение которой стоит в СЛЕДУЮЩЕЙ фазе, объявляет это полем `openPhase` — и только тогда
    // ей позволено «ЖДЁТ». Без поля правило прежнее и жёсткое. Отсутствие утверждения по-прежнему
    // запрещено ВСЕМ: сторож заводился против того, что утверждение тихо исчезает, и это цело.
    const mayWait = typeof t.openPhase === 'string' && t.openPhase.length > 0;
    check(`${t.name}: утверждение НАПИСАНО и ПРОГНАНО — не отсутствует и больше не «ждёт»`
      + (mayWait ? ' (кроме объявленной открытой фазы)' : ''),
      rows.length > 0 && (mayWait || rows.every((r) => r.state !== 'ЖДЁТ')),
      rows.length === 0 ? 'утверждения нет вовсе' : `состояния: ${rows.map((r) => r.state).join(', ')}`,
      mayWait ? `ждёт по объявленной причине: ${t.openPhase}` : '');
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
