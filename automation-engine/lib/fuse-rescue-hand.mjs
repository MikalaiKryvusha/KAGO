#!/usr/bin/env node
// automation-engine/lib/fuse-rescue-hand.mjs — ⚡ HAND 2 of the fuse: return the card to FACTORY
// voltage, from an ISOLATED short-lived process. Epic 51 phase 2 (`plans/55` step 3).
//
// WHY A SEPARATE PROCESS — this hand talks to the driver that is, by hypothesis, dying. A wedge
// here must take only this process; the judge never awaits it (`fuse.mjs` → `makeStockHand`). The
// same reasoning gave hand 1 the opposite property: it needs no driver at all.
//
// WHY FACTORY, NOT «one step up» — the owner's decision, 2026-08-28: «Заводское». And it is the
// R9 rollback reasoning the fan module already spells out: after a crash nobody knows what was
// applied, so the only honest undo is the factory state. `zeroCurve` verifies by READ-BACK
// (EXP-0024: status 0 is not verification), so `ok` here means «the card HOLDS stock», not «the
// call did not complain».
//
// WHAT THIS HAND DELIBERATELY DOES NOT TOUCH: the `-lgc` clock bound, if the engine held one. A
// stock-voltage card under a clock cap is SAFE at any capped clock; removing the cap would cost a
// second driver round-trip on the rescue path for zero safety gain. The surviving engine — or the
// next launch's recover() («ПОДБОР ЗАБЫТОЙ ЗАПИСИ») — owns that cleanup, as it always has.
//
// The hand writes its OWN outcome line (fsync) into the fuse journal passed via `--journal`: the
// judge does not wait, so the timeline's completeness must not depend on anyone hearing back.
//
// [TESTED: via `fuse --selftest` blocks «рука 2: …» — fake nvapi module injected; battery id `fuse`]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';

/**
 * СЧЁТЧИК НАМЕРЕНИЙ ПОЛОСЫ — ОДНО ЧИСЛО, ПО КОТОРОМУ РУКА УЗНАЁТ О ЧУЖОЙ ЗАПИСИ (`bugs/101` №1).
 *
 * Чистая функция и отдельное имя, потому что различать `state: 'intent'` полосы и `phase: 'intent'`
 * судьи придётся ещё не раз: это ДВА РАЗНЫХ намерения в двух разных журналах, и спутать их значило
 * бы считать собственные срабатывания за записи полосы.
 */
export function sweepIntentCount(lines) {
  let n = 0;
  for (const l of lines) {
    if (!l) continue;
    try { const d = JSON.parse(l); if (d && d.state === 'intent') n += 1; } catch { /* хвост записи — не строка */ }
  }
  return n;
}

/**
 * The rescue core, injectable for fixtures. Initialize → EnumPhysicalGPUs → zeroCurve — the exact
 * open sequence `profile-manager` uses (one pattern, not a second dialect of the same bridge).
 *
 * ═══ СЕЙЛОК ВОКРУГ СОБСТВЕННОЙ ЗАПИСИ (`bugs/101` находка 1, форма из `researches/31` §2.2) ═══
 *
 * ЧТО БЫЛО. Рука пишет сток, перечитывает кривую и требует нулей. 31.08 и 04.09 она нашла НЕ нули —
 * 113000 на 127 точках и 75000 на 126 — и назвала это C3, «драйвер правит результат». Оба числа
 * оказались НАШИМИ: `deltaMhz` ступеней seq 833 и seq 857, которые полоса писала В ТО ЖЕ ОКНО.
 * Проверяющий не умел отличить «после меня записал кто-то ещё» от «драйвер переписал меня», и его
 * отказ обрывал возврат судьи на пост: 04.09 полоса сожгла после этого пять ступеней без защиты.
 *
 * ЧТО ТЕПЕРЬ. Линуксовый `seqlock`: читатель берёт счётчик ДО и ПОСЛЕ своей критической секции, и
 * ИЗМЕНИВШИЙСЯ счётчик обесценивает чтение — оно отбрасывается, а не чинится и не толкуется. Здесь
 * счётчик — число намерений в журнале ПОЛОСЫ: полоса `fsync`-ит намерение ДО того, как коснётся
 * карты, значит выросшее число и означает «наша же запись легла в моё окно».
 *
 * ПОЧЕМУ ОТБРАСЫВАЕТСЯ И ЧИСТОЕ ЧТЕНИЕ. Прочитать нули посреди чужой записи можно просто раньше
 * неё — тогда «сток подтверждён» было бы утверждением о карте, которой уже нет. Отрасль здесь
 * единодушна и проект тоже: недействительное измерение ОТБРАСЫВАЕТСЯ, а не принимается наполовину.
 *
 * ПОВТОР РОВНО ОДИН, И ЭТО МОЙ ВЫБОР, НАЗВАННЫЙ ВЫБОРОМ. Гонщик — запись ОДНОЙ ступени, и к моменту
 * обнаружения она уже закончена; второй гонки в том же спасении не будет, пока полоса ждёт возврата
 * (`stopWhen`: `tripCount > rearmCount`). Цена — один лишний `zeroCurve` (замер: 1,9 с на здоровой
 * карте). Неограниченный повтор, как в ядре, здесь запрещён: рука говорит с умирающим драйвером.
 *
 * ИСТОЧНИКА НЕ ПРОВЕДЕНО — СТОРОЖ МОЛЧИТ, А НЕ ГОЛОСУЕТ. Без `sweepJournalPath` счётчик равен
 * `null`, гонка не объявляется никогда, и поведение остаётся ДОСЛОВНО прежним. «Не смотрели» и
 * «посмотрели и чисто» — разные вещи (структурное правило невзведённого входа, R4b).
 */
export async function doStockRescue({
  nvapiModule = null, sweepJournalPath = null, readSweepLinesFn = null,
} = {}) {
  const t0 = performance.now();
  const readIntents = () => {
    if (sweepJournalPath === null && readSweepLinesFn === null) return null;
    const read = readSweepLinesFn ?? (() => {
      try { return readFileSync(sweepJournalPath, 'utf8').split(/\r?\n/u); } catch { return []; }
    });
    return sweepIntentCount(read());
  };
  try {
    const mod = nvapiModule ?? await import('./nvapi.mjs');
    const nv = mod.openNvapi();
    nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
    const handles = Buffer.alloc(64 * 8);
    const count = Buffer.alloc(4);
    nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
    const handle = handles.readBigUInt64LE(0);
    let z = null;
    let raced = false;
    let racedTwice = false;
    let seenBefore = null;
    let seenAfter = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      seenBefore = readIntents();
      z = mod.zeroCurve(nv, handle);
      seenAfter = readIntents();
      raced = seenBefore !== null && seenAfter !== null && seenAfter !== seenBefore;
      if (!raced) break;
      if (attempt === 2) { racedTwice = true; break; }
    }
    if (racedTwice) {
      return {
        ok: false,
        ms: performance.now() - t0,
        // ⚠️ ИМЯ ОТКАЗА — ПОЛОВИНА ЕГО ЦЕНЫ. Два разбора подряд (31.08 и 04.09) пошли по ложному
        // следу «драйвер правит наши записи» именно потому, что отказ был назван C3.
        detail: `ГОНКА С ПОЛОСОЙ, а не C3: намерений полосы стало ${seenAfter} против ${seenBefore} — наша же запись легла в окно проверки; чтение отброшено, повтор тоже гонка`,
      };
    }
    return {
      ok: z.ok === true,
      ms: performance.now() - t0,
      detail: z.ok === true
        ? `сток подтверждён чтением: остаточных смещений ${z.remainingNonZero}${seenAfter === null ? '' : ` (намерений полосы ${seenAfter}, не двигались)`}`
        : (z.why ?? `zeroCurve не подтвердился: остаточных ${z.remainingNonZero}, отказов ${z.failed}`),
    };
  } catch (e) {
    return { ok: false, ms: performance.now() - t0, detail: e.message };
  }
}

/**
 * The TWIN bridge for this hand (epic 59 phase 4, `plans/63` шаг 4): the same `doStockRescue` code
 * path — Initialize → EnumPhysicalGPUs → zeroCurve → READ-BACK — over the virtual card's model
 * instead of the driver. The read-back is REAL (the twin's backend models write/read semantics), so
 * `ok` still means «the card HOLDS stock», never «the call did not complain».
 *
 * Named modelling limit, honestly: the hand process holds ITS OWN twin instance — the live card is
 * machine-global state, the twin is per-process by construction. What this rehearses is the hand's
 * whole FORM (detached process, mock bridge open, zeroing, read-back verification, its own fsync'd
 * journal line); state identity across processes goes to the parity register (epic 59 phase 5).
 *
 * `vc` is injectable so a selftest can hold offsets on the SAME instance and observe them zeroed.
 */
export async function buildTwinNvapiModule({ cardFile = null, vc = null, seed = 63 } = {}) {
  const vgpu = await import('./virtual-gpu.mjs');
  let card = null;
  if (!vc) {
    const loaded = vgpu.loadCard(cardFile);
    if (!loaded.ok) throw new Error(`карта двойника не поднялась (${cardFile}): ${loaded.why}`);
    card = loaded.card;
    vc = vgpu.virtualCard(card, { seed });
    // The state a dying writer leaves behind: a raised curve. Without it the zeroing would verify
    // vacuously — there would be nothing to zero and nothing the read-back could catch.
    const points = vc.curveBackend.points();
    vc.curveBackend.holdOffsetsSync(points.map(() => 30));
  }
  return {
    vc,
    openNvapi: () => ({
      koffi: { call: () => {} },
      resolve: () => ({ ptr: 1 }),
      protos: { Initialize: 'Initialize', EnumPhysicalGPUs: 'EnumPhysicalGPUs' },
    }),
    zeroCurve: () => {
      vc.curveBackend.zeroCurveSync();
      const remaining = vc.curveBackend.readOffsetsSync().filter((o) => o !== 0).length;
      return { ok: remaining === 0, remainingNonZero: remaining, failed: 0 };
    },
  };
}

// ---- CLI: --journal PATH [--twin CARDFILE] ------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--journal');
  const journalPath = i !== -1 ? argv[i + 1] : null;
  const t = argv.indexOf('--twin');
  const twinCard = t !== -1 ? argv[t + 1] : null;
  // ⚡ `bugs/101` находка 1: журнал ПОЛОСЫ — тот самый счётчик сейлока. Флага нет — сторож молчит.
  const sj = argv.indexOf('--sweep-journal');
  const sweepJournalPath = sj !== -1 ? argv[sj + 1] : null;
  const run = async () => {
    const r = await doStockRescue({
      nvapiModule: twinCard ? await buildTwinNvapiModule({ cardFile: twinCard }) : null,
      sweepJournalPath,
    });
    if (journalPath) {
      mkdirSync(path.dirname(journalPath), { recursive: true });
      const fd = openSync(journalPath, 'a');
      try {
        writeSync(fd, `${JSON.stringify({
          at: new Date().toISOString(), phase: 'outcome', cause: null,
          beatSilenceMs: null, progressSilenceMs: null,
          // The twin marks its OWN line: a rehearsal stock that read like a live stock in a
          // post-mortem would be a twin trace in real forensics — the worst class (EXP-0025).
          hand: 2, action: twinCard ? 'stock-voltage-verified-twin' : 'stock-voltage-verified', ok: r.ok,
          ms: Math.round(r.ms * 100) / 100, detail: r.detail,
        })}\n`);
        fsyncSync(fd);
      } finally { closeSync(fd); }
    }
    console.log(`РУКА 2: ${r.ok ? 'сток подтверждён' : 'НЕ подтверждён'} за ${Math.round(r.ms)} мс — ${r.detail}`);
    return r.ok ? 0 : 1;
  };
  run().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}
