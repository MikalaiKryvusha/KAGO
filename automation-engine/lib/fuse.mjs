#!/usr/bin/env node
// automation-engine/lib/fuse.mjs — ⚡ THE FUSE: a deadman judge that RESCUES, where the death watch
// only records. Epic 51 phase 2 (`plans/55`), owner's order verbatim in `GOAL.md` → «⚡ Механизм
// назван владельцем: ПРЕДОХРАНИТЕЛИ» (2026-08-28).
//
// WHY A SECOND INSTRUMENT EXISTS AT ALL — the paid-for fact this file is built on: the death watch
// writes a line AFTER a probe call returns; the call that never returns writes NOTHING. On
// 2026-08-28 the third machine death left both watch files EMPTY — the instrument was honest and
// blind by construction. The fuse inverts the sense: ABSENCE of a liveness beat for N ms is itself
// the signal, read in real time, in memory. (`researches/21` §5.)
//
// PROCESS SHAPE — the judge lives in its OWN process and NEVER touches the driver. The component
// most likely to crash at the exact moment that matters is the one talking to a dying driver;
// housing the judge with it would kill the rescue precisely when it is needed. Beats arrive from
// the probe process (death-watch `--probe`) as loopback datagrams: in-memory, milliseconds, no disk
// in the loop — the owner's constraint T3 («НЕ ДИСК РАЗ В СЕКУНДУ!!!!») is a design input here.
//
// TWO INPUTS, ONE TRIP (`plans/55` decision diagram):
//   input 1 — driver-liveness beats (probe call RETURNED recently);
//   input 2 — burn-progress beats (the workload is retiring work) — drm-hangcheck's lesson: a
//             driver that answers queries can still sit over a dead executor. Phase 2 proves this
//             input on fixtures; the live furnace source is a separate, explicitly recorded
//             decision (see STATUS 2026-08-28) — an UNWIRED input never trips (absent ≠ stalled).
//
// TWO HANDS, FIXED ORDER — the owner's word, and the physics behind it (`GOAL.md` границы):
//   hand 1 — kill the burn pid. CPU-side, argv array, no shell (EXP-0057), no driver needed:
//            this hand cannot hang on the thing that is dying.
//   hand 2 — restore FACTORY voltage (owner's decision 2026-08-28: «Заводское»). It goes THROUGH
//            the possibly-dying driver, so it runs in a spawned, isolated, short-lived process
//            (`fuse-rescue-hand.mjs`): if it wedges, it takes only itself.
//   The intent line is fsync'd BEFORE the hands (~1 ms): if rescue fails, the next session still
//   reads what the fuse saw and what it attempted — the death watch's own durability lesson.
//
// ARMED vs OBSERVING — N and M are PARAMETERS here, never constants: phase 3 derives them from a
// measured floor UNDER LOAD (`plans/51` phase table). Unarmed (N absent) the judge observes and
// records exactly like the watch — it refuses to guess a threshold (правило трёх дверей; the
// RECORD_THRESHOLD_MS comment in death-watch.mjs is the same refusal, same reason).
//
// THE RING — the judge keeps EVERY tick observation (sub-threshold included) in a memory ring and
// dumps it, fsync'd, ON TRIP and on graceful close. That is the black box the 28.08 death proved
// missing: empty miss-files could not distinguish «no drift at all» from «drift below 10 ms».
// The ring is forensics OUTSIDE the control loop's cadence — not an oracle input, no disk per tick.
//
// LOOPBACK CHANNEL FLOOR (measured on THIS machine, 2026-08-28, `--jitter-floor --seconds 60`,
// tick 2 мс — THREE runs, each one a finding, kept in order because each killed a wrong design):
//   floor 1 — sender in the probe's `Atomics.wait` shape: **12,72 %** delivered, gaps 0,01 мс —
//             a blocked event loop never flushes dgram; beats left in bursts (EXP-0165). The
//             beat-armed probe therefore YIELDS per tick; the beat-less floor keeps Atomics.wait.
//   floor 2 — yielding sender, no own timer grant: **14,03 %**, gaps 15,76 мс — the stock Windows
//             quantum: since Win10 2004 `timeBeginPeriod` is PER-PROCESS and does not reach a
//             spawned child. The sender now holds its own grant, as the live `--probe` does.
//   floor 3 — yielding sender + own grant: **29 658 of ~30 000 (98,86 %)** · arrival gap median
//             2,01 мс · p99 4,06 мс · max 10,46 мс. Channel healthy; N≈50 мс keeps ~5× headroom
//             over max. The LOADED floor — and the final N — are phase 3's measurement.
//
// [TESTED: 2026-08-28 · `--selftest` → 27 blocks, 0 failed · battery id `fuse` in selftest:all;
//  mutation proof: boundary `>=`→`>` → 1 red · hand 1 filtered out → 6 red · beat send dropped →
//  1 red (received 0), each reverted to green · port inertness: selftest binds ONLY port 0
//  (OS-assigned ephemeral, loopback), never a fixed one]

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeSync } from 'node:fs';
import { isMainThread } from 'node:worker_threads';
// ⏱️ `bugs/128` — единственная дверь к разрешению таймера, с отказом от гашения фонового процесса.
import { loadWinmm } from './timer-resolution.mjs';

export const FUSE_DIR = fileURLToPath(new URL('../../runs/death-watch/', import.meta.url));

/** Judge cadence. Same 2 ms as the watch, same reason: a slower honest judge beats a faster one
 *  that perturbs the experiment. */
export const JUDGE_TICK_MS = 2;

/** ⚡ `bugs/128` AC3 — ОБЪЯВЛЕННОЕ ЗДОРОВЬЕ ТАКТА, ИЗМЕРЕННОЕ, А НЕ ЖЕЛАЕМОЕ.
 *  p90 = 2,68 мс — живой прогон 2026-09-09 22:40 при владельце: 90 секунд, из них 60 под настоящим
 *  горном, 41 259 тактов, судья пущен СКРЫТЫМ ОТСОЕДИНЁННЫМ (условия, в которых он и терял
 *  разрешение). Кольцо этого прогона лежит под git фикстурой:
 *  `bugs/evidence/p94_ring_tick_gate_loaded_2026-09-09.jsonl`. «До» — 15,67 мс, запись смерти 17:53.
 *  Множитель 2 — расстояние до тревоги: изменчивость машины лежит НИЖЕ него, сломанный прибор
 *  (15,3-15,7) — втрое ВЫШЕ. Сторож впритык краснел бы на шуме и был бы снят первым уставшим. */
export const TICK_P90_DECLARED_MS = 2.68;
export const TICK_P90_REGRESSION_FACTOR = 2;

/** Ring capacity. 15 000 entries at 2 ms ≈ the last 30 s — longer than any measured strangling
 *  precursor (4,49 s), short enough to dump in one write. */
export const RING_CAPACITY = 15_000;

/**
 * ⚡ КАК ЧАСТО НЕПРЕРЫВНЫЙ ЧЁРНЫЙ ЯЩИК ДОЖИМАЕТ ЗАПИСЬ ДО ДИСКА (`bugs/123`).
 *
 * Не выбор вкуса, а размен, названный числами: `fsync` на NVMe стоит единицы миллисекунд, такт
 * судьи — 2 мс, уставка здоровья такта — 60 мс (`DERIVED_ARM_N_MS`). Ежетактный `fsync` съел бы
 * такт целиком; 500 мс — это 250 тактов между дожимами и потеря не более полусекунды при синем
 * экране, при том что окно записанного составляет 30…60 секунд.
 */
export const LIVE_RING_FSYNC_MS = 500;

/**
 * ⚡ THE DERIVED DEADMAN THRESHOLD — phase 3's number (`plans/56` §Итог замера, 2026-08-28), the
 * one constant `plans/52` forbade inventing and this measurement finally earned:
 *
 *   loaded floor ×2 (furnace 2400·8192·256·64 --sustain 60, ~307 W, card at stock, ZERO writes):
 *     run 1 — beats 99,01 % · gap median 1,96 / p99 4,42 / max 9,57 мс
 *     run 2 — beats 98,91 % · gap median 1,96 / p99 4,45 / max 7,28 мс
 *
 *   N = 60 мс clears EVERY shoulder at once:
 *     ≥ 5 × max_loaded (9,57 → k = 6,3)      — the plan's formula, P56-AC2;
 *     ≥ 5 × worst gap of ALL floors (10,46 idle jitter floor → k = 5,7);
 *     ≤ 302 мс (a tenth of the 3042 мс strangling precursor) — 5× under the ceiling;
 *     ≥ 11 × the judge's own worst tick (5,43 мс) — the judge cannot trip on its own lateness.
 *
 * Still a PARAMETER at every call site (`--arm-n`): this constant is the derived recommendation
 * with its provenance, not a hidden hardcode — phase 4 arms with it, the доспех stays inspectable.
 */
export const DERIVED_ARM_N_MS = 60;

// =================================================================================================
// 1. Pure decision logic — no sockets, no clock, no card (provable on fixtures alone, P55-AC1/2)
// =================================================================================================

/**
 * The deadman verdict for one judge tick.
 *
 * Boundary is INCLUSIVE at N — silence of exactly N ms trips, pinned by a block (the same «strict»
 * convention `classifyTick` established; two instruments disagreeing on boundaries would be a
 * truth↔mirror pair nobody registered).
 *
 * An input that is NOT armed (its threshold is null) never trips — «absent» must not read as
 * «stalled» (EXP-0112: a green that is indistinguishable from «not looking» is a false green; here
 * the refusal is structural). Input 2 additionally requires the progress source to be DECLARED
 * (`progressWired`): a wired-but-silent source is a stall; an unwired source is nothing.
 *
 * `beat-silence` WINS over `progress-stall` when both hold — it is the more specific fact about
 * the card (the probe walks through the driver into the card; progress only walks out of our own
 * workload), mirroring how `call-stall` wins over `late` in the watch.
 *
 * ⚡ ВХОД 3 — `power-collapse` (`plans/91`, `bugs/117`). Третий датум — РАБОТА КАРТЫ, а не жизнь
 * наших процессов: карта, тихо переставшая считать, отвечает на звонки (вход 1 здоров) и позволяет
 * нашему циклу тикать (вход 2 здоров), но потребляет четверть своих ватт. Порядок причин по
 * КОНКРЕТНОСТИ факта о карте: канал мёртв (`beat-silence`) → карта не работает
 * (`power-collapse`) → наш цикл встал (`progress-stall`).
 *
 * Величина — ДОЛЯ ОТ БЕГУЩЕГО ПИКА, а не абсолютные ватты: 45 Вт на 2145 МГц законны, а на
 * 3060 МГц невозможны. Карта сравнивается с собой же минуту назад.
 */
export function judgeLiveness({ nowMs, lastBeatMs, armNMs = null, lastProgressMs = null, armMMs = null, progressWired = false, power = null }) {
  const beatSilenceMs = lastBeatMs === null ? null : Math.max(0, nowMs - lastBeatMs);
  const progressSilenceMs = (progressWired && lastProgressMs !== null) ? Math.max(0, nowMs - lastProgressMs) : null;
  const beatTripped = armNMs !== null && beatSilenceMs !== null && beatSilenceMs >= armNMs;
  const progressTripped = armMMs !== null && progressSilenceMs !== null && progressSilenceMs >= armMMs;
  // Вход 3 взводится ТОЛЬКО когда: порог назван · пик СОСТОЯЛСЯ (иначе делить не на что — на
  // разгоне доля близка к единице у любой карты) · провал держится дольше выдержки. Три условия,
  // и каждое снимает свой класс ложного: невзведённость, разгон, одиночный выброс.
  const powerTripped = power !== null && power.ratio !== null && power.mw !== null
    && power.peakMw >= power.establishedMw
    && power.mw <= power.ratio * power.peakMw
    && power.lowForMs >= power.holdMs;
  return {
    tripped: beatTripped || powerTripped || progressTripped,
    cause: beatTripped ? 'beat-silence' : (powerTripped ? 'power-collapse' : (progressTripped ? 'progress-stall' : null)),
    beatSilenceMs,
    progressSilenceMs,
    // Доля печатается в улику РЯДОМ с вердиктом: разбор следующей смерти начнётся с вопроса
    // «насколько глубоко провалилась карта», и ответ обязан лежать в той же строке, что и причина.
    powerRatio: (power !== null && power.mw !== null && power.peakMw > 0)
      ? round2(power.mw / power.peakMw) : null,
  };
}

/**
 * ⚡ ПРОИГРЫВАТЕЛЬ ЗАПИСИ — «журнал тактов → последовательность вердиктов» (`plans/93` Ш2).
 *
 * ЗАЧЕМ. Фикстура, собранная из чисел, набранных руками, доказывает поведение на данных, которых
 * в бою не было. `bugs/127`: блок `[ДОКАЗЫВАЕТ --arm-p]` даёт трип на ряде мощности настоящей
 * смерти — и вход всё равно не сработал живьём, потому что фикстура не подавала `progressWired`,
 * ту самую переменную, которая вход разоружает. Проигрыватель подаёт ВСЁ, что записал чёрный ящик,
 * и потому не умеет «забыть» неудобную переменную.
 *
 * ВЕРНОСТЬ ДОКАЗУЕМА, А НЕ ОБЪЯВЛЕНА. Строки кольца — это ВЫХОД судьи (`powerRatio` в них уже
 * посчитан живым прогоном). Значит проигрыватель обязан воспроизвести их до значения: сверка
 * «пересчитанная доля == записанная доля на каждом такте» и есть доказательство, что проигрыватель
 * не похож на живой путь, а совпадает с ним. Эта сверка стоит блоком в батарее.
 *
 * Восстановление входов из выходов (кольцо пишет молчания, судья ждёт метки времени):
 *   · `progressWired` ⇐ `progressSilenceMs !== null` — судья обнуляет молчание ровно при погасшем
 *     проводе, и это единственный носитель флага в записи;
 *   · `lastProgressMs` ⇐ `t − progressSilenceMs`;  · `lastBeatMs` ⇐ `t − beatSilenceMs`.
 *
 * @param {Array<object>} rows  строки кольца (`t`, `beatSilenceMs`, `progressSilenceMs`, `powerMw`)
 * @param {object} opts  уставки прогона; по умолчанию — БОЕВЫЕ
 * @returns {{ticks:Array<object>, trips:Array<object>, firstTrip:object|null}}
 */
export function replayRing(rows, opts = {}) {
  const {
    armPowerRatio = POWER_COLLAPSE_RATIO,
    armNMs = null,
    armMMs = null,
    holdMs = POWER_LOW_HOLD_MS,
    establishedMw = POWER_ESTABLISHED_MW,
  } = opts;
  // Порядок хранения ≠ порядок времени (`bugs/123`): сортировка обязательна и здесь, а не у зовущего.
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  let win = { peakMw: 0, lowSinceMs: null };
  const ticks = [];
  const trips = [];
  for (const row of sorted) {
    const nowMs = row.t;
    const powerMw = (row.powerMw === undefined || row.powerMw === null) ? null : row.powerMw;
    const progressWired = row.progressSilenceMs !== null && row.progressSilenceMs !== undefined;
    win = stepPowerWindow(win, { progressWired, powerMw, nowMs, armPowerRatio, establishedMw });
    const lowForMs = win.lowSinceMs === null ? 0 : nowMs - win.lowSinceMs;
    const verdict = judgeLiveness({
      nowMs,
      lastBeatMs: (row.beatSilenceMs === null || row.beatSilenceMs === undefined)
        ? null : nowMs - row.beatSilenceMs,
      armNMs,
      lastProgressMs: progressWired ? nowMs - row.progressSilenceMs : null,
      armMMs,
      progressWired,
      // Зеркало живого пути обязано двигаться ВМЕСТЕ с ним: проигрыватель, оставшийся на старой
      // форме, пересчитал бы записанную долю в `null` и объявил бы кольцо расходящимся с собой.
      power: {
        mw: powerMw, peakMw: win.peakMw, ratio: armPowerRatio, establishedMw, lowForMs, holdMs,
      },
    });
    const tick = {
      t: nowMs, powerRatio: verdict.powerRatio, peakMw: win.peakMw, lowForMs,
      tripped: verdict.tripped, cause: verdict.cause,
    };
    ticks.push(tick);
    if (verdict.tripped) trips.push(tick);
  }
  return { ticks, trips, firstTrip: trips.length ? trips[0] : null };
}

/**
 * ⚡ НОРМАЛЬНЫЕ КОНЦЫ ПРОЖИГА В ЗАПИСИ — ФИКСТУРА, КОТОРОЙ НЕ ХВАТАЛО (`bugs/130` AC3).
 *
 * 🔴 ЗАЧЕМ. Набор ложных срабатываний 08.09 дал «0 ложных» и был принят за чистый — а он был
 * ПУСТ: судимое окно кончалось на первом живом трипе, и ни один нормальный конец прожига в него
 * не попадал. На этой пустоте была принята правка, превратившая каждый здоровый прожиг в
 * аварийное спасение (9 ложных за 169 с, 6 изготовленных стен). **Пустая база сошла за чистую.**
 *
 * Функция ищет в записи моменты, где провод прогресса ГАСНЕТ — то есть прожиг кончился, — и
 * возвращает вместе с каждым измеренную в тот миг выдержку провала. Набор, у которого этот список
 * пуст, обязан краснеть: ему нечем судить.
 *
 * ЗАМЕР ПО ЗАПИСИ 19:21 (8 концов): выдержка 6173…6550 мс, доля 0,09…0,13. То есть на штатном
 * конце прожига мощность падает ГЛУБЖЕ порога 0,412 и держится ВДЕСЯТЕРО дольше уставки 500 мс —
 * ровно как при смерти. Различить эти два случая по глубине и длительности НЕЛЬЗЯ, и это доказано
 * здесь числом, а не рассуждением.
 *
 * @param {Array<object>} rows строки кольца
 * @param {object} opts уставки для проигрывания (по умолчанию боевые)
 * @returns {Array<{t:number, holdMs:number, ratio:number|null, peakMw:number}>}
 */
export function burnEnds(rows, opts = {}) {
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  const rep = replayRing(sorted, opts);
  const wired = (x) => x.progressSilenceMs !== null && x.progressSilenceMs !== undefined;
  const out = [];
  for (let i = 1; i < sorted.length; i += 1) {
    if (!wired(sorted[i - 1]) || wired(sorted[i])) continue;
    out.push({
      t: sorted[i].t,
      holdMs: rep.ticks[i - 1].lowForMs,
      ratio: rep.ticks[i - 1].powerRatio,
      peakMw: rep.ticks[i - 1].peakMw,
    });
  }
  return out;
}

// =================================================================================================
// 2a. ВХОД 2 — вывод порога M из ФОРМЫ нагрузки (фаза 5в эпика 51, `plans/66`, `researches/24`)
// =================================================================================================

/**
 * МАКСИМАЛЬНЫЙ ТАКТ ПРОГРЕССА КАЖДОЙ НАГРУЗКИ, В МИЛЛИСЕКУНДАХ — ИЗМЕРЕННЫЙ, НЕ НАЗНАЧЕННЫЙ.
 *
 * Такт прогресса = время одного запуска хостового цикла `--sustain` (событие → ядра → синхронизация
 * → memcpy → сверка → `launches++`). Числа сняты двумя независимыми способами и здесь стоит БОЛЬШЕЕ
 * из них, потому что порог обязан пережить худший наблюдавшийся случай, а не средний день:
 *
 *   нагрузка │ архив `runs/power/*.json` (max) │ замер 2026-08-29 (max) │ берётся
 *   ─────────┼─────────────────────────────────┼────────────────────────┼─────────
 *   furnace  │ 330,68 мс (7 прогонов)          │ 279,04 мс (15 касаний) │ 330,68
 *   branchy  │  81,89 мс (29 прогонов)         │  23,30 мс (сборка)     │  81,89
 *   sdc_fma  │   0,80 мс (6 прогонов)          │   0,77 мс (сборка)     │   0,80
 *
 * ⚠️ Такт различается в 400 раз между формами — поэтому M НЕ МОЖЕТ БЫТЬ КОНСТАНТОЙ. Константа была
 * бы числом, верным ровно для `furnace` и молча ложным для всех остальных.
 * ⚠️ Такт зависит от рабочей точки карты (под ограничением мощности запуск длиннее). Отсюда правило
 * «берём максимум обоих источников», а не «последний замер».
 */
export const PROGRESS_TICK_MAX_MS = Object.freeze({
  furnace: 330.68,
  branchy: 81.89,
  sdc_fma: 0.80,
});

/**
 * Во сколько раз порог прогресса выше такта. Число НЕ наше: правило индустрии из drm/i915 —
 * *«care must be taken that timeout is not set lower or close to three times the heartbeat
 * interval»* (`researches/24` §2). Ниже трёх тактов два механизма начинают срабатывать друг на
 * друге; здесь это означало бы трип на обычном медленном запуске.
 */
export const ARM_M_K = 3;

/**
 * РАБОЧАЯ ТОЧКА, НА КОТОРОЙ СНЯТ МАКСИМУМ ТАКТА, — частота графики под нагрузкой того самого
 * архивного прогона, что дал максимум (`runs/power/<файл>.json` → `medians.loaded['clocks.gr'].median`).
 *
 * ⚠️ ТАКТ ЗАПУСКА ОБРАТЕН ЧАСТОТЕ, И ЭТО ИЗМЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО — на `branchy` по 29 архивным
 * прогонам: 25,9 мс при 2797 МГц → 81,9 мс при 900 МГц (×3,16 при отношении частот 3,11; максимум
 * `branchy` выше и ЕСТЬ значение при 900 МГц). Максимум `furnace` снят при 2820 МГц, и все семь
 * его архивных прогонов лежат в 2805…2872 МГц под нагрузкой — на 900 МГц такт `furnace` не снят ни разу.
 * Уставка 993 мс, выведенная из такта при 2820 МГц, на полосе до 900 МГц красила бы ЗДОРОВЫЙ запуск
 * (ожидаемый такт 947…1036 мс по прямому отношению 2820/900), а трип закрывает частоту как край (`interviews/023`) — ложный порог,
 * записанный уликой (класс EXP-0038). Найдено 04.09 одним проходом по архиву ДО проводки
 * (`bugs/101`, поправка плана; правило EXP-0036: старые настоящие данные проверяют ПОРОГИ).
 *
 * Для `furnace` масштаб 1/f — ГИПОТЕЗА, перенесённая с `branchy`: ядро с половиной, упирающейся в
 * память, замедляется МЕНЬШЕ, чем 1/f, при падении только частоты ядра, так что 1/f — осторожная
 * сторона (M больше нужного, никогда не меньше). Меряет её первый живой прогон: протокол живости
 * пишет `worstProgressSilenceMs` каждую секунду на каждой частоте полосы.
 */
export const PROGRESS_TICK_REF_MHZ = Object.freeze({
  furnace: 2820,   // grid59-furnace-ramp-3s.json · n=6 · 2026-08-26 (разгон с 1590, медиана 2820)
  branchy: 900,    // cold_900.json · n=62 · 2026-08-10
  sdc_fma: 2835,   // uv_0.json · n=60 · 2026-08-10
});

/**
 * ВО СКОЛЬКО РАЗ ТАКТ ДЛИННЕЕ на нижней частоте полосы, чем на опорной. Никогда не ниже 1: полоса
 * ВЫШЕ опорной частоты оставляет измеренный максимум как есть — уменьшать порог ниже худшего
 * наблюдавшегося случая значило бы опускать его под пол наблюдателя (`branchy` при 2692 МГц дал бы
 * 82 мс < 150 мс и ложный отказ взведения). Без частоты — 1: двойник и прежние вызовы не меняются.
 */
export function progressTickScale(workload, lowestMhz = null) {
  const ref = PROGRESS_TICK_REF_MHZ[workload];
  if (!Number.isFinite(lowestMhz) || lowestMhz <= 0 || !Number.isFinite(ref)) return 1;
  return Math.max(1, ref / lowestMhz);
}

/**
 * Порог входа 2 для НАЗВАННОЙ нагрузки. Незнакомая нагрузка — ОТКАЗ, а не догадка: порог, выведенный
 * из неизмеренного такта, это выдуманное число в предохранителе, который убивает работу владельца.
 * `lowestMhz` — нижняя частота полосы, до которой спустится прожиг (масштаб выше); без неё — как прежде.
 */
export function deriveArmMMs(workload, { lowestMhz = null } = {}) {
  const tick = PROGRESS_TICK_MAX_MS[workload];
  if (tick === undefined) {
    throw new Error(`такт прогресса для нагрузки «${workload}» не измерен — порога вывести не из чего `
      + `(знаем: ${Object.keys(PROGRESS_TICK_MAX_MS).join(', ')})`);
  }
  return Math.ceil(tick * ARM_M_K * progressTickScale(workload, lowestMhz));
}

/**
 * ТАКТ НАБЛЮДЕНИЯ ЗА ПРОГРЕССОМ. Файл сердцебиения читает ПРОБА (у судьи одна дверь — память и
 * датаграммы), и читает подвыборкой: порог входа 2 на три порядка грубее порога входа 1, поэтому
 * смотреть файл каждые 2 мс незачем. 50 мс — двадцать чтений двадцати байт в секунду.
 */
export const PROGRESS_POLL_MS = 50;

// =================================================================================================
// 2b. ВХОД 3 — ОБВАЛ МОЩНОСТИ. Три числа, и все три ИЗМЕРЕНЫ, а не назначены
// =================================================================================================
//
// Прибор, которым они получены: `npm run powerfloor` (`tools/power-collapse-floor.mjs`). Он читает
// архив прожигов и журнал развёртки и печатает зазор. Числа ниже — его вывод от 2026-09-08 на
// 166 прожигах, и он воспроизводим: запусти прибор и сверь.
//
// 🔴 ПОЧЕМУ ДОЛЯ, А НЕ ВАТТЫ. Абсолютный порог не работает: в архиве первый процентиль мощности
// под нагрузкой — 65 Вт, есть пробы по 43 Вт в прогонах, никого не убивших. На 2145 МГц 45 Вт
// законны, на 3060 МГц невозможны. Доля от БЕГУЩЕГО пика сравнивает карту с ней же самой минуту
// назад и потому не зависит ни от частоты, ни от режима.

/**
 * @guard fuse-power-collapse
 * THREAT:         тихий отказ недовольтажа — карта заявляет 100 % загрузки и НЕ СЧИТАЕТ. Оплачен
 *                 синим экраном 2026-09-08 09:50 на 3067 МГц / 925 мВ (`bugs/117`): 60 Вт вместо
 *                 280 в течение 2500 мс, оба прежних входа предохранителя здоровы до последнего
 *                 такта (пульс 4,86 мс при пороге 60)
 * PROVED-AGAINST: ДВЕ ЖИВЫЕ ЗАПИСИ ПРОБ 2026-09-08, одна частота 3067 МГц, СОСЕДНИЕ ступени —
 *                 935 мВ прошло, 925 мВ убило машину; проиграны в настоящего судью через сокет.
 *                 Смерть даёт трип `power-collapse`, здоровая ступень молчит. Четыре мутации
 *                 краснят каждая своё: снять взведение · снять выдержку · порог 0,95 · порог 0,25
 * GAP:            🔴 МГНОВЕННАЯ СМЕРТЬ БЕЗ ПРЕДВЕСТНИКА ЭТОМУ ВХОДУ НЕВИДИМА. Правило требует, чтобы
 *                 провал держался 500 мс; отказ, убивающий машину быстрее, не будет пойман — как не
 *                 будет пойман и отказ, при котором мощность НЕ падает. Второе: порог выведен на
 *                 архиве ОДНОЙ карты, ОДНОГО драйвера (610.88) и ОДНОЙ формы нагрузки (`furnace`);
 *                 на другой форме его надо выводить заново. Третье: проверка идёт на ЗАПИСЯХ проб,
 *                 а живая проба шлёт милливатты каждые 2 мс. ✏️ ЭТА ТРЕТЬЯ ЧАСТЬ ЗАКРЫТА
 *                 2026-09-08 прогоном на живой карте (см. ON-REAL-PATH); первые две в силе.
 *                 ЧЕТВЁРТОЕ, ОТКРЫТОЕ: вход 3 НИ РАЗУ не трипал на живой карте — наблюдался
 *                 только его молчаливый режим. Настоящее срабатывание увидит первый же край
 * ON-REAL-PATH:   ✅ 2026-09-08 12:26 — УВИДЕН НА ЖИВОЙ КАРТЕ. Прогон при владельце,
 *                 `--sweep --from 2610 --to 2610 --max-depth 50`: одна частота, один прожиг 10 с
 *                 на ДОКАЗАННОМ 865 мВ, ступеней вниз ноль. Вход 3 взведён (журнал печатает его
 *                 состояние из аргументов судьи), кольцо несёт 13 секунд живых милливатт с такта
 *                 2 мс: простой 22-25 Вт → прожиг 230-240 Вт → конец 141 → 54 → 45 Вт.
 *                 ТРИПОВ 0 — включая конец прожига, где мощность законно упала до доли 0,19 при
 *                 пороге 0,412: ворота погасили источник, потому что прожиг кончился. Это и был
 *                 названный заранее риск ложного срабатывания, и он не выстрелил
 *
 * Строка `GAP` написана ДО живого прогона намеренно: у предохранителя, которого она описывает,
 * ровно такая строка от 28 августа сняла бы инцидент 30-го, и не была прочитана (`plans/76`, М1).
 */

/**
 * ДОЛЯ ОТ ПИКА, НИЖЕ КОТОРОЙ КАРТА СЧИТАЕТСЯ ПЕРЕСТАВШЕЙ РАБОТАТЬ.
 *
 * Выведена как СЕРЕДИНА самого широкого разрыва в нижней трети ряда: 0,331 → 0,494. Замер на
 * 166 прожигах архива: онлайн-форма правила дала 7 трипов, ВСЕ СЕМЬ на частотах с записанным полом
 * зависания, ЛОЖНЫХ 0. При этом 92 прожига на ТЕХ ЖЕ частотах провала не дали — величина различает
 * события, а не частоты. Ноль ложных проверен на подвижность: порог 0,504 даёт 1 ложный, 0,650 —
 * 36, 0,900 — 68, то есть счётчик умеет расти и его ноль что-то значит.
 */
export const POWER_COLLAPSE_RATIO = 0.412;

/**
 * ПИК ОБЯЗАН СОСТОЯТЬСЯ, ИНАЧЕ ДЕЛИТЬ НЕ НА ЧТО. Пока прожиг разгоняется от простоя, доля от пика
 * близка к единице у любой карты — и живой, и мёртвой. 150 Вт лежат ниже самого слабого пика в
 * архиве (213 Вт), поэтому условие отсекает не прожиги, а их первые миллисекунды.
 */
export const POWER_ESTABLISHED_MW = 150_000;

/**
 * СКОЛЬКО ПРОВАЛ ДОЛЖЕН ДЕРЖАТЬСЯ. Правило, давшее 7 из 7 при нуле ложных, требовало ДВУХ проб
 * подряд при такте архива 500 мс — то есть низкое состояние жило ≥ 500 мс. Наблюдённое окно
 * смерти 08.09 — 2500 мс, впятеро больше: выдержка не съедает запас, а одиночный выброс телеметрии
 * отсекает.
 */
export const POWER_LOW_HOLD_MS = 500;

/**
 * ⚡ ОКНО ВХОДА 3 — БЕГУЩИЙ ПИК И ВЫДЕРЖКА ПРОВАЛА, ОДНОЙ ФУНКЦИЕЙ НА ДВА ПУТИ (`plans/93` Ш2).
 *
 * Раньше эта машина состояний жила ВНУТРИ живого цикла судьи, и повторить её можно было только
 * копией. Копия — пара «правда ↔ зеркало» (`bugs/120`): чинишь одну, вторая молча остаётся со
 * старым поведением, и батарея продолжает зеленеть на том, чего в бою уже нет. Поэтому окно
 * ВЫНУТО: живой цикл и проигрыватель записи (`replayPowerWindow`) зовут ОДНУ функцию, и правка
 * поведения физически не может разойтись между ними.
 *
 * Функция чистая: ни времени, ни диска — всё приходит аргументами.
 *
 * @param {object}      s                    состояние окна на прошлом такте
 * @param {number}      s.peakMw             бегущий пик, мВт (0 — пика нет)
 * @param {number|null} s.lowSinceMs         когда началась выдержка провала (null — провала нет)
 * @param {boolean}     t.progressWired      идёт ли сердцебиение прогресса прожига
 * @param {number|null} t.powerMw            мощность этого такта
 * @param {number}      t.nowMs              время такта
 * @param {number|null} t.armPowerRatio      порог доли; null — вход не взведён
 * @param {number}      t.establishedMw      пик обязан состояться выше этого
 * @returns {{peakMw:number, lowSinceMs:number|null}}
 */
/**
 * ⚡ ВОРОТА ЛОЖНОГО ТРИПА — «прожиг КОНЧИЛСЯ» против «прожиг УМЕР» (`plans/93` Ш5, `bugs/126` AC4).
 *
 * 🔴 ЧТО ЭТО ЧИНИТ, ОПЛАЧЕНО СМЕРТЬЮ МАШИНЫ 2026-09-08 17:53. Кандидат в трип по причине
 * `progress-stall` или `power-collapse` спрашивал у диска «идёт ли прожиг», и при отрицательном
 * ответе трип ОТМЕНЯЛСЯ, а оба входа гасились. Замысел верен для настоящего конца прожига: между
 * ступенями прогрессу взяться неоткуда, и мощность законно падает к простою.
 *
 * Беда в том, что УМЕРШАЯ КАРТА перестаёт обновлять файл сердцебиения ровно так же, как кончившийся
 * прожиг. 17:53 вход 2 стал кандидатом на такте t=13053 (тишина 1185 мс при уставке 1177), ворота
 * прочитали «прожига нет» и отменили трип; тем же движением обнулился пик входа 3, у которого
 * выдержка шла уже 455 мс из нужных 500. Дальше 829 тактов слепоты и смерть.
 * **Одна улика разоружила два входа из трёх в пределах одного такта.**
 *
 * ✅ РАЗЛИЧИТЕЛЬ — ПОРЯДОК СОБЫТИЙ, И В НЁМ НЕТ НИ ОДНОГО ВЫДУМАННОГО ЧИСЛА. Обвал мощности
 * ПРЕДШЕСТВУЕТ смерти прожига и НЕ предшествует его нормальному концу:
 *
 *   запись 09:42 (нормальные концы) │ выдержка в миг ворот   0 мс
 *   запись 09:59 (нормальные концы) │ выдержка в миг ворот   0 мс
 *   запись 17:53 (смерть)           │ выдержка в миг ворот 455 мс
 *
 * Поэтому правило беспараметрическое: **отмена законна только когда выдержка провала НЕ ИДЁТ**.
 * Порога нет — сравнивается наличие, а не величина, и подгонять нечего.
 *
 * ⚠️ База тонкая: две записи нормальных концов, обе от 08.09. Названо здесь, а не спрятано.
 *
 * @param {string|null}  cause     причина вердикта
 * @param {boolean}      burnAlive ответ `burnInFlight()` — идёт ли прожиг по файлу сердцебиения
 * @param {number|null}  lowSinceMs когда началась выдержка провала (null — провала нет)
 * @returns {boolean} true — трип отменить и входы погасить; false — трип состоится
 */
export function cancelsFalseTrip({ cause, burnAlive, lowSinceMs }) {
  if (cause !== 'progress-stall' && cause !== 'power-collapse') return false;
  if (burnAlive) return false;
  // 🔴🔴 ПРАВИЛО «ВЫДЕРЖКА ИДЁТ ⇒ НЕ ОТМЕНЯТЬ» СНЯТО 2026-09-08 19:5x, ПОТОМУ ЧТО ОНО БЫЛО ОШИБКОЙ.
  //
  // Оно стояло здесь один вечер и опровергнуто ЖИВЫМ ПРОГОНОМ 19:21 (`bugs/130`). Различитель
  // строился на посылке «обвал мощности предшествует пропаже прожига только при смерти». Посылка
  // ЛОЖНА: так выглядит и НОРМАЛЬНЫЙ КОНЕЦ ПРОЖИГА. Замер двух записей:
  //
  //   17:53 (смерть)     прожиг длился 8,4 с · мощность обвалилась на 12 599 мс
  //   19:21 (девять раз) прожиг длился 8,9 с · мощность обвалилась на 12 506 мс
  //   бюджет прожига владельца — 10 с
  //
  // То же самое в тот же момент, и одна запись кончилась смертью машины через 11 с, а другая
  // прожила 169 с и ДЕВЯТЬ таких же концов. Правило превратило каждый штатный конец прожига в
  // спасение: 9 ложных трипов, 6 изготовленных стен (все 6 покраснели у сторожа физики), полоса
  // остановлена тормозом за отсутствие прогресса.
  //
  // ✅ ЧТО ОСТАЁТСЯ ВЕРНЫМ ИЗ `plans/93`: вынос окна в `stepPowerWindow`, проигрыватель
  // `replayRing` (верность доказана на 14 111 тактах), полевые блоки входов 1 и 2, второй вопрос
  // сторожа. Ошибочен был ОДИН вывод — тот, что менял поведение.
  return true;
}

export function stepPowerWindow(s, t) {
  // 🔴 `bugs/126` AC4 / `plans/93`: ВОТ ЭТА ВЕТКА УБИЛА МАШИНУ 08.09 В 17:53.
  // Замер: выдержка шла 455 мс из нужных 500, и на такте t=13068 `progressWired` погас —
  // пик обнулился, выдержка выброшена, доля перестала считаться на 829 тактов подряд, до
  // самой смерти. «Прожиг кончился» и «прожиг умер» приходят сюда ОДНИМ И ТЕМ ЖЕ флагом.
  // Сброс сам по себе законен: без него нормальный конец прожига читался бы как обвал.
  if (!t.progressWired || t.powerMw === null) {
    return { peakMw: 0, lowSinceMs: null };
  }
  const peakMw = t.powerMw > s.peakMw ? t.powerMw : s.peakMw;
  const low = t.armPowerRatio !== null
    && peakMw >= t.establishedMw
    && t.powerMw <= t.armPowerRatio * peakMw;
  return { peakMw, lowSinceMs: low ? (s.lowSinceMs === null ? t.nowMs : s.lowSinceMs) : null };
}

/**
 * ⚡ КАРТА ОТВЕЧАЕТ, НО ПЕРЕСТАЛА СЧИТАТЬ — СКОЛЬКО ТЕЛЕМЕТРИЯ МОЖЕТ СТОЯТЬ, ПОКА ЭТО ЕЩЁ ЖИЗНЬ.
 * `bugs/122`, куплено зависанием 08.09 в 10:02.
 *
 * ЧТО СЛУЧИЛОСЬ. Второе спасение прогона `reburn-42`: трип 10:00:26, рука 1 убила прожиг, рука 2
 * стартовала в 10:00:27.222 — и НЕ ОТЧИТАЛАСЬ НИКОГДА. Судья прожил после этого ещё **119 секунд**
 * (разрыв такта 16 мс — сам он был здоров), полоса стояла в «ЖДУ АПВ», а в 10:02:25 машина умерла.
 *
 * ЧТО ПРИ ЭТОМ ГОВОРИЛ ЧЁРНЫЙ ЯЩИК, И ПОЧЕМУ ЭТО НЕ АРТЕФАКТ ПОГАШЕННОГО ИСТОЧНИКА:
 *   · удары ПРИХОДИЛИ все 119 секунд — тишина пульса 15…30 мс, проба была жива и слала мощность;
 *   · и всё это время мощность равнялась **34 781 мВт, одно значение, байт в байт, 121 секунду**;
 *   · в соседнем прогоне 09:42 после спасения мощность нормально гуляла 40 → 298 Вт.
 * То есть драйвер отвечал на опрос, а число за ним перестало обновляться. Ровно тот отказ, что убил
 * машину утром: карта ОТВЕЧАЕТ и не СЧИТАЕТ.
 *
 * ОТКУДА ЧИСЛО (кольцо, потактно 2 мс, плато одного значения):
 *   · здоровый прогон 09:42 — 28 плато, медиана 498 мс, **максимум 510 мс** (такт опроса NVML);
 *   · прогон смерти — те же ~490 мс весь прогон, затем плато **1971 мс за 2 с до срабатывания**,
 *     а после него телеметрия не двинулась вовсе: **119 000 мс**.
 * Между 510 и 1971 мс измеренных точек НЕТ. Уставка 5000 мс стоит в этом разрыве с запасом на
 * ОБЕ стороны: почти вдесятеро выше здорового максимума и в двадцать четыре раза ниже наблюдённой
 * заморозки. Кратно ближе к здоровому краю — цена ложного здесь мала (мы УЖЕ внутри спасения).
 *
 * 🔴 GAP, НАЗВАННЫЙ ЧЕСТНО (`bugs/118` AC5 — у непустого GAP есть тикет, это `bugs/122`):
 * выборка — ОДИН здоровый прогон и ОДНА смерть, оба 08.09, потому что милливатты в кольце живут со
 * вчерашнего дня. Числа обязаны пересниматься каждым следующим вечером, и уставка правится замером,
 * а не вкусом. Поэтому же сторож поставлен ТОЛЬКО в ожидание расписки, а не четвёртым входом
 * трипа: там ложное срабатывание стоит прожига владельца, здесь — ничего.
 *
 * ⚠️ И ЭТО НЕ ОТМЕНЯЕТ **[ИИ] решения АГЕНТА П1** (`plans/81` §3: «ждать, порога не заводить» —
 * выбрал агент, слово владельца там одно: «давай как ты считаешь»). Порог
 * времени не заведён: ждём по-прежнему, пока жива рука. Здесь добавлено НАБЛЮДЕНИЕ — карта, чья
 * телеметрия стоит, расписки уже не напишет, и ждать её значит смотреть, как машина умирает.
 */
export const CARD_TELEMETRY_FROZEN_MS = 5_000;

/**
 * НАСКОЛЬКО СВЕЖИМ ДОЛЖЕН БЫТЬ ПУЛЬС, ЧТОБЫ «МОЩНОСТЬ СТОИТ» ЗНАЧИЛО «КАРТА НЕ СЧИТАЕТ».
 * Замолчавшая проба даёт ровно ту же неподвижную мощность — и это СОВСЕМ ДРУГОЙ отказ, за который
 * отвечает вход 1. Без этого условия сторож `bugs/122` перехватывал бы чужую беду и врал бы про
 * карту. Секунда — тот же порядок, что уставка входа 1 (60 мс), с запасом на шестнадцать пропусков.
 */
export const BEATS_FRESH_MS = 1_000;

/**
 * ВЗВОДИТЬ ЛИ ВХОД 2 ДЛЯ ЭТОЙ НАГРУЗКИ — и если нет, то ПОЧЕМУ, вслух.
 *
 * Наблюдатель не может разглядеть событие чаще, чем смотрит. Если выведенный порог не пережил бы
 * трёх собственных тактов наблюдения, он краснел бы не на отказе карты, а на дороге, по которой
 * едет — ровно тот класс, что уже оплачен на входе 1 (EXP-0165: пол канала). Такая форма получает
 * ЧЕСТНОЕ «не взведён с названной причиной», а не порог, который врёт.
 *
 * ⚠️ Это РЕШЕНИЕ, а не заявление о невозможности (EXP-0169): такт `sdc_fma` — 0,8 мс, он быстрее
 * любого файлового наблюдения, и другой источник для такой формы потребовал бы другой дороги.
 */
export function armMDecision(workload, { lowestMhz = null } = {}) {
  const armMMs = deriveArmMMs(workload, { lowestMhz });
  const floor = ARM_M_K * PROGRESS_POLL_MS;
  if (armMMs < floor) {
    return {
      armed: false,
      armMMs: null,
      why: `вход 2 НЕ взведён для «${workload}»: выведенный порог ${armMMs} мс мельче трёх тактов `
        + `наблюдения (${floor} мс) — такт запуска ${PROGRESS_TICK_MAX_MS[workload]} мс быстрее, `
        + `чем файловая дорога способна разглядеть`,
    };
  }
  const scale = progressTickScale(workload, lowestMhz);
  return { armed: true, armMMs, why: `вход 2 взведён для «${workload}»: M = ${armMMs} мс `
    + `(${ARM_M_K} × ${PROGRESS_TICK_MAX_MS[workload]} мс измеренного такта`
    + (scale > 1 ? ` × ${scale.toFixed(2)}: такт снят при ${PROGRESS_TICK_REF_MHZ[workload]} МГц, полоса спускается до ${lowestMhz} МГц` : '')
    + ')' };
}

/**
 * КАК ВХОД 2 ЕДЕТ НА ВСАДНИКАХ — ОДНО МЕСТО ЗНАНИЯ для двойника и живого пути (`bugs/101` находка 3:
 * двойник знал форму в сборке, живой путь поднимал судью и пробу двумя литералами без неё, и никакой
 * блок этой пары «правда ↔ зеркало» не видел). Судье путь нужен для ворот «идёт ли прожиг»
 * (`burnInFlight`), пробе — для ретранслятора удара `0x02`.
 *   · `armMMs` число — ВЗВЕДЁН: тишина прогресса ≥ M при существующем файле — трип `progress-stall`;
 *   · `armMMs` null — НАБЛЮДЕНИЕ: файл проведён, тишина пишется в протокол живости
 *     (`worstProgressSilenceMs`), трипа по входу 2 нет — дверь калибровки такта на настоящей полосе;
 *   · без файла — пусто на обоих: непроведённый источник и застывший — разные вещи (`progressWired`).
 */
export function progressRiderArgs({ progressFile = null, armMMs = null } = {}) {
  if (!progressFile) return { judge: [], probe: [] };
  return {
    judge: [...(armMMs !== null ? ['--arm-m', String(armMMs)] : []), '--progress-file', progressFile],
    probe: ['--progress-file', progressFile],
  };
}

// =================================================================================================
// 2b. Настройка порога на двойнике — словарь исходов (фаза 5б эпика 51, `plans/65`)
// =================================================================================================

/**
 * ЗАКРЫТЫЙ словарь исходов настроечного прогона. Закрыт по той же причине, что словарь тегов кривой
 * (R14d): читатель сетки должен различать успех здорового сценария и пропуск смертельного, а не
 * гадать по слову «нет трипа».
 */
export const TUNE_OUTCOME = Object.freeze({
  RESCUED: 'спасено',
  PREMATURE: 'преждевременно',
  MISSED: 'пропущено',
  FALSE: 'ложно',
  CLEAN: 'чисто',
});

/**
 * Сколько ОСТАНОВОВ пережил судья до трипа — по своему же чёрному ящику.
 *
 * ⚠️ Различить «трип на перелёте деградации» и «трип на роковом останове» по `beatSilenceMs` строки
 * намерения НЕЛЬЗЯ, и это ловушка, в которую легко попасть: судья трипает, как только тишина
 * достигла N, поэтому записанная тишина всегда ≈ N — что при останове 29 мс, что при 2070.
 * Различает ИСТОРИЯ: кольцо держит закрытые зазоры ударов, и их счёт до трипа говорит, сколько
 * перелётов порог пережил. Порог счёта — тот же `RECORD_THRESHOLD_MS` = 10 мс, которым сторож
 * смерти отделяет промах от такта; пол канала (max 9,73 мс, замер 2026-08-29) лежит ПОД ним.
 */
export function countStallsBeforeTrip(ringRows, { thresholdMs = 10 } = {}) {
  return gapsFromRing(ringRows).filter((g) => g >= thresholdMs).length;
}

/**
 * Исход одного настроечного прогона. Чистая функция: сетка кормит её тем, что прочитала с диска.
 *
 * `degradationStalls` — сколько перелётов деградации несёт сыгранный профиль. Число берётся ИЗ
 * ФИКСТУРЫ (`strangleStallsFromPulse`), а не назначается здесь: назначенное разошлось бы с
 * профилем в первый же день, когда фикстуру уточнят.
 */
export function classifyTuneOutcome({ scenario, tripped, stallsSurvived = 0, degradationStalls = 0 }) {
  if (scenario === 'healthy') return tripped ? TUNE_OUTCOME.FALSE : TUNE_OUTCOME.CLEAN;
  if (!tripped) return TUNE_OUTCOME.MISSED;
  return stallsSurvived >= degradationStalls ? TUNE_OUTCOME.RESCUED : TUNE_OUTCOME.PREMATURE;
}

/**
 * The rescue programme for a trip. ALWAYS both hands, ALWAYS this order — the owner's word
 * («снимают нагрузку, поднимают напряжение») backed by physics: hand 1 needs no driver and cannot
 * hang; hand 2 goes through the dying driver and runs isolated. The cause does NOT reorder the
 * hands: even on a progress-stall with a live driver, load goes first — a burn left running while
 * voltage rises would re-enter the same edge on the next tick.
 */
export function decideRescue({ cause }) {
  return [
    { hand: 1, action: 'kill-burn', needsDriver: false },
    { hand: 2, action: 'stock-voltage', needsDriver: true },
  ].map((h) => ({ ...h, cause }));
}

/** One fuse-journal line — intent or outcome. Same contract as `formatMiss`: each line is a
 *  self-sufficient JSON record, because the post-mortem reads a TAIL. */
export function formatFuseLine({ atIso, phase, cause = null, beatSilenceMs = null, progressSilenceMs = null, hand = null, action = null, ok = null, ms = null, detail = null }) {
  return `${JSON.stringify({
    at: atIso, phase, cause,
    beatSilenceMs: beatSilenceMs === null ? null : round2(beatSilenceMs),
    progressSilenceMs: progressSilenceMs === null ? null : round2(progressSilenceMs),
    hand, action, ok, ms: ms === null ? null : round2(ms), detail,
  })}\n`;
}

function round2(x) { return Math.round(x * 100) / 100; }

/** The black-box ring: fixed capacity, overwrite-oldest. A push never allocates beyond capacity —
 *  a forensic instrument that grows without bound would eventually perturb the process it rides. */
export function makeRing(capacity = RING_CAPACITY) {
  return { buf: new Array(capacity), next: 0, filled: 0, capacity };
}

export function pushRing(ring, entry) {
  ring.buf[ring.next] = entry;
  ring.next = (ring.next + 1) % ring.capacity;
  if (ring.filled < ring.capacity) ring.filled += 1;
}

/**
 * Oldest→newest, exactly `filled` entries — the dump must read as a timeline, not as raw storage.
 *
 * 🔴 И ОНО ДЕЙСТВИТЕЛЬНО ОПУСТОШАЕТ — с 2026-09-05 (`bugs/107`). До этого дня функция называлась
 * «drain», вела себя как «peek», и рядом, в `resetForRearm`, стоял комментарий, утверждавший
 * обратное: *«`ring` — уже опустошён `dumpRing` внутри трипа»*. Читатель кода получал ответ на свой
 * вопрос и дальше не смотрел — так дефект и прожил.
 *
 * ЧЕМ ЭТО ПЛАТИЛОСЬ, ИЗМЕРЕНО НА ПРОГОНЕ, А НЕ ВЫВЕДЕНО: каждое срабатывание дописывало в файл ВЕСЬ
 * ринг заново, включая такты, уже сброшенные предыдущими. Репетиция `strangle` 05.09 до правки —
 * **10718 строк на 1365 различных отметок времени, до восьми копий одной**. Разбор, считающий
 * события ПО КОЛЬЦУ (`countStallsBeforeTrip`, сетка `plans/65`), считал копии.
 *
 * УЛИКА ПРИ ЭТОМ НЕ ТЕРЯЕТСЯ, и это проверяемое утверждение, а не надежда: объединение всех сбросов
 * до и после правки одно и то же — исчезают ровно повторы. Кольцо как было, так и остаётся буфером
 * фиксированной ёмкости с вытеснением старейшего; что не влезло между двумя сбросами, терялось и
 * раньше.
 */
export function drainRing(ring) {
  const out = new Array(ring.filled);
  const start = (ring.next - ring.filled + ring.capacity) % ring.capacity;
  for (let i = 0; i < ring.filled; i++) out[i] = ring.buf[(start + i) % ring.capacity];
  // Сами ячейки не чистятся намеренно: они недостижимы при `filled === 0` и будут перезаписаны,
  // а обход пятнадцати тысяч слотов — работа в форензическом пути, который обязан быть дешёвым.
  ring.filled = 0;
  ring.next = 0;
  return out;
}

// =================================================================================================
// 2. The hands — injectable for fixtures, real by default
// =================================================================================================

/**
 * Hand 1: kill the burn. TWO paths, fast first — the live drill priced them (2026-08-28):
 * spawning `taskkill` cost 131,95 мс against the N=60 budget; `process.kill` is a direct
 * TerminateProcess syscall in microseconds. The syscall does not take a TREE, so death is
 * VERIFIED (signal 0 probing, ≤ 40 мс) and a survivor — a burn with children — gets the
 * `taskkill /T /F` fallback by argv array WITHOUT a shell (EXP-0057: Git Bash rewrites `/PID`
 * as a POSIX path). «Убит» здесь — наблюдение, не отправленный сигнал.
 */
export function makeKillHand({ spawnSyncFn, killFn = process.kill.bind(process) }) {
  return (pid) => {
    const t0 = performance.now();
    let how = 'process.kill';
    try { killFn(pid, 'SIGKILL'); } catch { /* ESRCH — уже мёртв; это не отказ руки */ }
    let dead = false;
    for (let i = 0; i < 20; i++) {
      try { killFn(pid, 0); } catch { dead = true; break; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    }
    if (!dead) {
      how = 'taskkill /T fallback';
      const r = spawnSyncFn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 5_000 });
      dead = r.status === 0;
    }
    return { ok: dead, ms: performance.now() - t0, detail: how };
  };
}

/**
 * Hand 1 for ENGINE duty: kill the burn BY IMAGE NAME. The live burn runs inside `spawnSync`
 * (vf-step's measurement core) and its pid is unreachable from outside by construction — plumbing
 * it out would refactor the very path the fuse guards. The workload images are OURS and
 * distinctive (furnace.exe, branchy.exe, sdc_fma.exe), so `taskkill /IM` by argv array takes the
 * load down without knowing the pid. «Образ не найден» (status 128) is NOT a failure: the burn
 * may have exited on its own during the very stall that tripped us.
 */
export function makeImageKillHand({ spawnSyncFn }) {
  return (images) => {
    const t0 = performance.now();
    const results = [];
    for (const image of images) {
      const r = spawnSyncFn('taskkill', ['/IM', image, '/F'], { windowsHide: true, encoding: 'utf8', timeout: 5_000 });
      results.push(`${image}:${r.status === 0 ? 'убит' : (r.status === 128 ? 'не найден' : `status ${r.status}`)}`);
    }
    const ok = results.every((s) => /убит|не найден/.test(s));
    return { ok, ms: performance.now() - t0, detail: results.join(' · ') };
  };
}

/**
 * Hand 2: spawn the isolated stock-voltage process and DO NOT WAIT for it. The judge's loop must
 * stay alive to record; a hand that can wedge (it talks to the dying driver) gets a process
 * boundary, not an await. The hand writes its own outcome line into the same journal (fsync'd
 * there), so the timeline stays complete even when the judge never hears back.
 */
export function makeStockHand({ spawnFn, journalPath, extraArgs = [] }) {
  const handScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fuse-rescue-hand.mjs');
  return () => {
    const t0 = performance.now();
    // `detached: true` IS the rescue property, paid for on the first live drill (2026-08-28): the
    // judge exits ~200 мс after a trip, and on this machine a NON-detached child dies WITH its
    // parent — the hand was spawned (pid printed) and silently never ran. Proven both ways: parent
    // alive 3 с → line lands; detached + parent dead in 50 мс → line lands; non-detached + parent
    // dead → nothing. A hand that needs ~2 с of NVAPI work must own its life. (EXP-0166)
    //
    // `extraArgs` is the twin door (epic 59 phase 4): an ARMED judge riding a virtual sweep passes
    // `--twin <card>` here, so a trip stocks the TWIN through the mock bridge — a live-NVAPI hand
    // under a twin rehearsal would be exactly the I1 violation the rehearsal exists to avoid.
    const child = spawnFn(process.execPath, [handScript, '--journal', journalPath, ...extraArgs], {
      windowsHide: true, stdio: 'ignore', detached: true,
    });
    child.unref?.();
    // `pid` ОТДАЁТСЯ ОТДЕЛЬНЫМ ПОЛЕМ, а не только внутри текста `detail` (`plans/81` Ш5).
    // Судья ждёт расписку руки и обязан отличить «рука ещё работает» от «рука умерла молча»;
    // границей служит ЖИЗНЬ ПРОЦЕССА, а не выдуманный таймаут. Разбирать своё же предложение
    // регулярным выражением было бы парой «правда ↔ зеркало» внутри одной функции.
    return {
      ok: child.pid !== undefined,
      ms: performance.now() - t0,
      pid: child.pid ?? null,
      detail: child.pid === undefined ? 'spawn failed' : `pid ${child.pid}`,
    };
  };
}

/** The burn carrier's pid, read AT TRIP TIME — never cached at judge start: the carrier of the
 *  FATAL burst is what must die, and it is spawned long after the judge was. A missing or stale
 *  file is an honest null (hand 1 then reports «nothing to kill»; hand 2 still runs). */
export function readBurnPidfile(pidfilePath, { readFileSyncFn = null } = {}) {
  if (!pidfilePath) return null;
  try {
    const read = readFileSyncFn ?? require('node:fs').readFileSync;
    const pid = Number(String(read(pidfilePath, 'utf8')).trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

/**
 * РАСПИСКИ РУКИ 2 — «сток подтверждён ЧТЕНИЕМ» (`plans/81` Ш2, `ideas/17` часть 1).
 *
 * ЗАЧЕМ. Судья обязан перевзводиться ТОЛЬКО после подтверждённого стока — это смягчение риска (а)
 * идеи 17, одобренной владельцем (`interviews/022` Q2 = A). Но рука 2 запускается DETACHED и судья
 * её НЕ ЖДЁТ: `makeStockHand` возвращается за ~5 мс, и это стоимость СПАУНА, а не спасения.
 * Канал, однако, уже существует — рука пишет в тот же журнал СВОЮ `fsync`-нутую строку с
 * результатом ПЕРЕЧИТЫВАНИЯ (`fuse-rescue-hand.mjs`):
 *
 *   {"phase":"outcome","hand":2,"action":"stock-voltage-verified","ok":true,
 *    "ms":58444.85,"detail":"сток подтверждён чтением: остаточных смещений 0"}
 *
 * 🔴 ПОЧЕМУ РАСПИСКИ РАЗЛИЧАЮТСЯ СЧЁТОМ, А НЕ ВРЕМЕНЕМ. Соблазнительно отбирать расписки «позже
 * момента трипа». Штампы, однако, ставят РАЗНЫЕ ПРОЦЕССЫ по своим часам, и сравнение таких концов
 * — ровно та ловушка, за которую проект заплатил ([[EXP-0207]]: «число проверяется не арифметикой,
 * а вопросом, интервалом МЕЖДУ ЧЕМ И ЧЕМ оно является»; там один конец интервала оказался
 * человеком, а не машиной). Порядковый номер расписки в СВОЁМ журнале от часов не зависит вовсе:
 * судья помнит, сколько их было ДО его трипа, и ждёт следующую.
 *
 * ЗАМЕР, ОПРАВДЫВАЮЩИЙ ОЖИДАНИЕ (2026-08-31, живая карта в покое, `plans/81` §4): вся рука на
 * ЗДОРОВОЙ карте — **≈ 1,9 с** (мост, инициализация, перечисление и чтение вместе 30 мс; запись
 * 127 нулей с перечитыванием 1870,7 мс). На живом трипе 31.08 та же рука отчиталась через
 * **58,4 с** — в 31 раз медленнее. Значит долгое ожидание случается ровно тогда, когда карте
 * плохо, то есть когда ждать и НАДО; порога не заводится, потому что задачи для него нет.
 *
 * Чистая функция над СТРОКАМИ: никакого ввода-вывода, чтобы решение проверялось фикстурами.
 *
 * @param {Array<object|string>} lines строки журнала предохранителя (объекты или сырой JSONL)
 * @returns {Array<{ok:boolean, ms:number|null, at:string|null}>} расписки в порядке появления
 *
 * [TESTED: 2026-08-31 · блоки в `--selftest`, включая фикстуру из НАСТОЯЩЕГО журнала трипа 31.08]
 */
/**
 * РАЗБОР СТРОК ЖУРНАЛА — ОДИН на все три читателя (`stockReceipts` · `tripCount` · `rearmCount`).
 *
 * До Ш5 этот цикл стоял в файле ТРИЖДЫ слово в слово, и это была пара «правда ↔ зеркало», которую
 * дешевле УБРАТЬ, чем за ней следить (`PHILOSOPHY.md` → DRY): расхождение проявилось бы не отказом,
 * а тем, что один читатель терпит битую строку, а другой на ней падает. Принимает и объекты, и
 * сырой JSONL — журнал читают и из памяти (фикстуры), и с диска (движок, судья).
 */
function eachRecord(lines, fn) {
  for (const raw of Array.isArray(lines) ? lines : []) {
    let d = raw;
    if (typeof raw === 'string') {
      const t = raw.trim();
      if (!t) continue;
      // Битая строка ПРОПУСКАЕТСЯ, а не роняет разбор: журнал читают у живой машины, и последняя
      // строка может быть оборвана смертью процесса ровно посередине.
      try { d = JSON.parse(t); } catch { continue; }
    }
    if (d) fn(d);
  }
}

export function stockReceipts(lines) {
  const out = [];
  eachRecord(lines, (d) => {
    if (d.phase !== 'outcome' || d.hand !== 2) return;
    // ИМЯ ДЕЙСТВИЯ РАЗЛИЧАЕТ СПАУН И ПОДТВЕРЖДЕНИЕ, и это не придирка: `stock-voltage` пишет САМ
    // судья в момент спауна (ok: true означает «процесс запущен»), а `stock-voltage-verified`
    // пишет РУКА после перечитывания. Принять первую за вторую значило бы считать подтверждённым
    // сток, которого никто не читал, — то есть построить смягчение риска на факте спауна.
    if (d.action !== 'stock-voltage-verified' && d.action !== 'stock-voltage-verified-twin') return;
    out.push({ ok: d.ok === true, ms: Number.isFinite(d.ms) ? d.ms : null, at: d.at ?? null });
  });
  return out;
}

/**
 * СКОЛЬКО ТРИПОВ ЗАПИСАНО В ЖУРНАЛЕ СУДЬИ — счёт, а не время (`plans/81` Ш4, `interviews/023`).
 *
 * ЗАЧЕМ. Решение владельца 2026-08-31: спасение есть НАЙДЕННЫЙ КРАЙ — частота закрывается, полоса
 * идёт дальше. Чтобы ступень могла закрыться отказом, она обязана УЗНАТЬ, что под ней сработал
 * предохранитель; сегодня узнать неоткуда (AC2 `bugs/88`, доказано блоком двойника).
 *
 * 🔴 ПОЧЕМУ СЧЁТ, А НЕ ВРЕМЯ, — тот же довод, что у `stockReceipts`, и он оплачен. Соблазнительно
 * отбирать трипы «позже начала ступени». Штамп трипа ставит СУДЬЯ своими часами, штамп начала
 * ступени — ДВИЖОК своими; сравнение таких концов это ровно ловушка [[EXP-0207]] («число
 * проверяется не арифметикой, а вопросом, интервалом МЕЖДУ ЧЕМ И ЧЕМ оно является» — там один
 * конец интервала оказался человеком). Порядковый счёт в СВОЁМ журнале от часов не зависит вовсе:
 * ступень запоминает, сколько трипов было до её начала, и сравнивает.
 *
 * Чистая функция над СТРОКАМИ — никакого ввода-вывода, чтобы решение проверялось фикстурами.
 *
 * @param {Array<object|string>} lines строки журнала предохранителя (объекты или сырой JSONL)
 * @returns {number} сколько НАМЕРЕНИЙ (трипов) записано
 *
 * [TESTED: 2026-08-31 · блоки в `--selftest`, включая фикстуру из НАСТОЯЩЕГО журнала трипа 31.08]
 */
export function tripCount(lines) {
  let n = 0;
  // `phase: 'intent'` пишется ПЕРВЫМ делом трипа и `fsync`-ится ДО рук (см. `runTrip`): значит
  // строка существует даже у спасения, которое само не дожило до конца. Строки `outcome` не
  // считаются — их у одного трипа две, и счёт по ним поехал бы вдвое.
  eachRecord(lines, (d) => { if (d.phase === 'intent') n += 1; });
  return n;
}

/**
 * СКОЛЬКО ТРИПОВ СУДЬЯ ПЕРЕЖИЛ — счёт УСПЕШНЫХ перевзведений (`plans/81` Ш5).
 *
 * ЗАЧЕМ ОТДЕЛЬНАЯ СТРОКА, А НЕ ПОВТОРНОЕ РЕШЕНИЕ У ПОЛОСЫ. Полосе нужно знать одно: «взведён ли
 * предохранитель прямо сейчас». Она могла бы спросить `rearmDecision` сама — и тогда решение
 * «можно ли перевзводиться» жило бы в ДВУХ местах (у судьи и у полосы), то есть было бы парой
 * «правда ↔ зеркало»: разойдясь, они не покраснели бы, а тихо разрешили бы прожиг без судьи.
 * Поэтому решает ОДИН судья и пишет РАСПИСКУ О СВОЁМ РЕШЕНИИ; полоса её ЧИТАЕТ, а не повторяет.
 * Эта же строка — прибор критерия P81-AC4 («ступеней после спасения без взведённого судьи»):
 * `tripCount(lines) > rearmCount(lines)` и есть «трип, который ещё никто не закрыл».
 *
 * Считаются только `ok: true`: строка отказа (`ok: false`) существует ради разбора, и признать её
 * перевзведением значило бы пустить полосу дальше ровно там, где судья сказал «нельзя».
 *
 * @param {Array<object|string>} lines строки журнала предохранителя
 * @returns {number} сколько раз судья ПЕРЕВЗВЁЛСЯ
 */
export function rearmCount(lines) {
  let n = 0;
  eachRecord(lines, (d) => { if (d.phase === 'rearm' && d.ok === true) n += 1; });
  return n;
}

/**
 * ТАКТ ОПРОСА РАСПИСКИ — ЭТО КАДЕНЦИЯ, А НЕ ПОРОГ, и различие существенное.
 *
 * Порогом здесь ничего не решается: решение принимает расписка руки 2 (`ok`) и жизнь самой руки.
 * Это число говорит лишь, КАК ЧАСТО спрашивать, — то есть его можно поменять вдвое в любую
 * сторону, и ни один исход не изменится. Поэтому оно не требует вывода из замера (`plans/81` §3
 * закрыл развилку «сколько ждать» замером: ждать до расписки, порога не заводить).
 *
 * 250 мс против измеренной руки в 1,9 с — восьмая часть самого быстрого ожидания: полоса не
 * простаивает заметно, а диск опрашивается 4 раза в секунду вместо 500 (такт судьи 2 мс).
 */
export const REARM_POLL_MS = 250;

/**
 * ПОЛУОТКРЫТОЕ ОКНО ВОЗВРАТА НА ПОСТ — `plans/88`, и обе уставки здесь ИЗМЕРЕНЫ, а не выбраны.
 *
 * ЗАЧЕМ ОНО ЕСТЬ. Сегодня условие возврата одно — «сток подтверждён чтением». Замер по всем
 * протоколам предохранителя на диске: перевзведений в БОЛЬНУЮ машину **10 из 10** получили следующее
 * срабатывание через 0,06 с (ровно один период сторожа), единственное в здоровую держало пост 319 с.
 * То есть действующий критерий не отличил больную машину от здоровой НИ РАЗУ из одиннадцати, и
 * 04.09 это стоило пяти ступеней, сожжённых без защиты (`bugs/101`), две из которых доехали до
 * документа кривой и сегодня помечены как непроверенные (`plans/87`).
 *
 * ПОЧЕМУ ПРОБА — СОБСТВЕННЫЙ ТАКТ СУДЬИ, А НЕ УДАРЫ ЖИВОСТИ. Удар шлёт ВСАДНИК ПРОЖИГА
 * (`buf[0] === 0x01` ниже). Полуоткрытое состояние наступает ПОСЛЕ того, как рука 1 убила прожиг:
 * нагрузки нет → ударов нет → проба по ударам не прошла бы НИКОГДА, и полоса встала бы навсегда на
 * первом же спасении. Это стена, а не сторож (`bugs/72` · [[EXP-0193]]). Цикл судьи тикает и без
 * прожига — он и есть проба. Разбор: `researches/33` §4b.
 *
 * ОТКУДА ЧИСЛА (`researches/33` §4b, 716 секунд из шести протоколов 31.08 и 04.09):
 *   · здоровая машина — **356…442** такта/с (676 секунд); больная — 4…**261** (40 секунд);
 *   · между классами пустой разрыв в **95 тактов/с**, и в нём НЕТ НИ ОДНОЙ из 716 точек;
 *   · уставка 300 стоит В РАЗРЫВЕ: любое значение от 262 до 355 даёт то же самое разбиение
 *     измеренных данных, поэтому это не «выбранный порог» в смысле `bugs/73`;
 *   · уставка 100 была опробована ПЕРВОЙ и отвергнута замером — она оставляла три «здоровые»
 *     секунды (100, 102, 107) внутри больного эпизода, то есть резала распределение, а не разрыв.
 *
 * ДЛИНА ОКНА. Шесть НЕПРЕРЫВНЫХ больных эпизодов (0,0 · 11,3 · 24,0 · 0,0 · 0,0 · 14,8 с), и ни в
 * одном нет ни одной здоровой секунды: заикающаяся машина здорового такта не даёт вовсе. Значит окну
 * достаточно быть БОЛЬШЕ НУЛЯ. **Запас от 1 до 3 секунд — выбор агента, и он назван выбором, а не
 * замером:** он стоит прогону 3 секунды на спасение против пяти ступеней, сожжённых вслепую.
 */
export const JUDGE_HEALTHY_TICKS_PER_SEC = 300;
export const REARM_HEALTHY_SECONDS = 3;

/**
 * ⚡ ПРОБА ПОЛУОТКРЫТОГО ОКНА — РАЗРЫВ ТАКТА, А НЕ ЧИСЛО ТАКТОВ (`bugs/121`, живой путь 08.09).
 *
 * 🔴 ЧИСЛО ТАКТОВ В СЕКУНДУ МЕРЯЕТ НЕ ЗДОРОВЬЕ МАШИНЫ, А РАЗРЕШЕНИЕ СИСТЕМНОГО ТАЙМЕРА WINDOWS,
 * и держит его ПРОЖИГ — тот самый, который рука 1 убивает ПЕРЕД входом в это окно. Замер живого
 * пути 08.09 (`2026-09-08T09-42-00-765Z-fuse-alive.jsonl`, 48 секунд подряд):
 *
 *   · секунды 1–12, прожиг идёт     — 438…473 такта/с, худший разрыв 3,9–6,1 мс;
 *   · секунды 14–48, прожиг убит    — 86…105 тактов/с, худший разрыв 16,1–23,9 мс.
 *
 * 16,6 мс — штатный квант таймера Windows. Машина была ЗДОРОВА все 35 секунд, и все 35 уставка
 * 300/с прочитала как больные. То есть возврат на пост после СПАСЕНИЯ не мог сработать НИКОГДА, а
 * полоса вставала на ПЕРВОМ же спасении. Тот же класс, что `bugs/72`: там пробу сняли с УДАРОВ
 * прожига, а собственный такт судьи оставили с той же зависимостью, только через таймер. Стена
 * была НАЗВАНА 07.09 («уставка живого пути 300 при измеренной медиане 65») и закрыта тогда СРОКОМ
 * окна — то есть быстрым отказом вместо молчания. Отказ стал быстрым; стена осталась стеной.
 *
 * РАЗДЕЛЯЮЩАЯ ВЕЛИЧИНА — ХУДШИЙ РАЗРЫВ ТАКТА ЗА ЗАКРЫТУЮ СЕКУНДУ, и она от кванта таймера НЕ
 * ЗАВИСИТ. Счёт по ВСЕМ 13 строкам жизни на диске (1684 секунды):
 *
 *   · здоров, прожиг идёт       — 3,2…6,1 мс;
 *   · здоров, прожига нет       — 16,1…23,9 мс;
 *   · секунда смерти 08.09      — 452,16 мс;
 *   · больные секунды 07.09     — 475…712 мс.
 *
 * Между 24 и 452 мс нет НИ ОДНОЙ измеренной точки. Уставка ставится В ЭТОТ РАЗРЫВ и НЕ ВЫБИРАЕТСЯ
 * вовсе: берётся `DERIVED_ARM_N_MS` = 60 мс — та же уставка сторожа тишины, уже стоящая на службе и
 * уже измеренная в своём пустом разрыве (`researches/33` §4a: здоровые до 41,21 мс, больные от
 * 60,89). Одно число на два места — это DRY, а не совпадение.
 *
 * Число тактов ОСТАЁТСЯ в журнале и в строке жизни — как НАБЛЮДЕНИЕ, а не как критерий: выборка
 * растёт сама, а решение больше не висит на чужом таймере.
 */
export const JUDGE_HEALTHY_WORST_GAP_MS = DERIVED_ARM_N_MS;

/**
 * ⚡ СРОК ПОЛУОТКРЫТОГО ОКНА — ЧТОБЫ НЕДОСТИГНУТОЕ ЗДОРОВЬЕ КОНЧАЛОСЬ ОТКАЗОМ, А НЕ МОЛЧАНИЕМ.
 *
 * 🔴 ЗАВЕДЕНО 2026-09-07, И ПОВОД ЕСТЬ ДОВОД. В тот день полуоткрытое окно на стенде оказалось
 * СТЕНОЙ: уставка живого пути 300 тактов/с при измеренной медиане 65. Судья вошёл в `half-open`
 * (10:54:27.782) и не вышел НИКОГДА — строки `rearm` в журнале нет вовсе. Полоса встала в
 * «ЖДУ АПВ» и провисела до внешнего таймаута 300 с, а снаружи это было неотличимо от зависания
 * машины. **Пять дней подряд это списывали на посторонний тикет** (`bugs/108`, шторм спасений),
 * который к тому моменту был уже починен.
 *
 * Без срока окно кончается только глобальным дедлайном судьи (`--seconds`, на живом пути 36000).
 * То есть механизм, придуманный ради быстрого возврата на пост, при неудаче становится самым
 * долгим молчанием в системе — и молчит именно тогда, когда сказать важнее всего.
 *
 * ПОЧЕМУ 30 СЕКУНД. Окну нужны `REARM_HEALTHY_SECONDS` (3) ПОДРЯД здоровых секунды. Тридцать —
 * десятикратный запас: машина, не давшая трёх здоровых секунд за тридцать, не выздоравливает, она
 * больна. Число НЕ замер, и это сказано прямо: замерены две вещи — успешные возвраты укладываются
 * в 3,3 с (`ms` строк `rearm` 07.09: 3295, 3289), а неудачное окно того же дня не закрылось за
 * 300 с. Между 3,3 и 300 пустой разрыв; 30 стоит в нём и ближе к успешному краю.
 *
 * ⚠️ ЭТО НЕ УКОРАЧИВАЕТ ЗАЩИТУ. Истёкший срок ведёт в `closeRescue(false)` — ТУ ЖЕ дорогу, что и
 * отказ руки 2: судья выходит кодом 2, полоса встаёт, карта остаётся на стоке. Прежнее поведение
 * целиком, только названное вслух и на два порядка раньше.
 */
export const HALF_OPEN_DEADLINE_MS = 30_000;

/**
 * НАКОПИТЕЛЬ ЗДОРОВЫХ СЕКУНД — чистая функция, потому что условие внутри цикла ожидания нельзя ни
 * замутировать, ни накрыть (урок `bugs/104`, где инлайн-проверка простояла красной пять дней).
 *
 * Одна больная секунда СБРАСЫВАЕТ счёт в ноль, а не уменьшает его на единицу: окно доказывает
 * НЕПРЕРЫВНОЕ здоровье, и «две здоровые, одна больная, две здоровые» — это не четыре здоровые.
 *
 * @param {object}  a
 * @param {number}  a.ticksPerSec    такт судьи за последнюю секунду
 * @param {number}  a.healthyNeeded  сколько здоровых секунд подряд нужно
 * @param {number}  a.worstGapMs     худший разрыв такта за закрытую секунду — ЭТИМ и решается
 * @param {number}  a.healthyWorstGapMs  уставка здоровья; умолчание — `DERIVED_ARM_N_MS` (см. выше)
 * @param {object|null} a.state      предыдущее состояние (null — начало полуоткрытого окна)
 * @returns {{healthySeconds:number, onPost:boolean, ticksPerSec:number}}
 *
 * 🔴 ПОЧЕМУ УСТАВКА — ПАРАМЕТР, А НЕ ТОЛЬКО КОНСТАНТА (найдено замером 2026-09-05, ДО проводки Ш3).
 * 300 тактов/с — свойство не «здоровой машины», а «здоровой машины, на которой судья не голодает».
 * Безголовый судья в одиночку даёт 401…404/с (замер: `--judge --seconds 5`), но В РЕПЕТИЦИИ СМЕРТИ,
 * где ту же машину грузит вся полоса, строка жизни показывает 4…70/с. С уставкой 300 окно не
 * закрылось бы В РЕПЕТИЦИИ НИКОГДА — то есть механизм стал бы СТЕНОЙ ровно там, где его принимают
 * (`bugs/72` · [[EXP-0193]], та же стена, что и в §3, и в §4a плана 88). Поэтому уставку называет
 * СРЕДА: живой путь берёт измеренную 300, стенд — свою, и обе видны в журнале (P88-AC5).
 */
export function halfOpenGate({
  ticksPerSec, worstGapMs, healthyNeeded = REARM_HEALTHY_SECONDS,
  healthyWorstGapMs = JUDGE_HEALTHY_WORST_GAP_MS, state = null,
} = {}) {
  // 🔴 РЕШАЕТ РАЗРЫВ, А НЕ ЧИСЛО ТАКТОВ (`bugs/121`). Отсутствующий разрыв — НЕ здоровье:
  // секунда без замера ничего не доказала, и счёт сбрасывается, а не наследуется.
  const healthy = Number.isFinite(worstGapMs) && worstGapMs <= healthyWorstGapMs;
  const healthySeconds = healthy ? (state?.healthySeconds ?? 0) + 1 : 0;
  return {
    healthySeconds, onPost: healthySeconds >= healthyNeeded,
    worstGapMs: Number.isFinite(worstGapMs) ? worstGapMs : null,
    ticksPerSec: ticksPerSec ?? null,
  };
}

/**
 * ГОТОВ ЛИ СУДЬЯ ПЕРЕВЗВЕСТИСЬ — одно решение в одном месте (`plans/81` Ш2).
 *
 * Три исхода, и два из них означают ПРЕЖНЕЕ поведение (выход, полоса встаёт):
 *   `waiting`   — расписки ещё нет; судья продолжает ждать;
 *   `refused`   — расписка пришла с `ok: false`: сток НЕ подтверждён чтением, продолжать нельзя;
 *   `confirmed` — сток подтверждён; перевзведение разрешено.
 *
 * @param {Array} lines строки журнала · @param {number} seenBefore сколько расписок было ДО трипа
 */
export function rearmDecision(lines, seenBefore = 0) {
  const all = stockReceipts(lines);
  if (all.length <= seenBefore) return { state: 'waiting', receipt: null };
  const receipt = all[seenBefore];
  return { state: receipt.ok ? 'confirmed' : 'refused', receipt };
}

/**
 * The trip procedure, pure in its ORDER (the part fixtures must pin): intent first — fsync'd
 * BEFORE any action, so a rescue that dies mid-way still left evidence; then hand 1; then hand 2;
 * then outcomes and the ring dump. Returns what happened for the caller's log line.
 */
export function runTrip({ verdict, burnPid, burnImages = null, killHand, imageKillHand = null, stockHand, writeLine, dumpRing }) {
  writeLine(formatFuseLine({
    atIso: new Date().toISOString(), phase: 'intent', cause: verdict.cause,
    beatSilenceMs: verdict.beatSilenceMs, progressSilenceMs: verdict.progressSilenceMs,
  }));
  const outcomes = [];
  for (const step of decideRescue({ cause: verdict.cause })) {
    // Hand 1 targets: an exact pid when the caller has one (drills), the image list on engine
    // duty (the burn's pid lives inside spawnSync), honestly «nothing» otherwise — and a missing
    // target never cancels hand 2: voltage rescue is meaningful even when the burn already
    // exited on its own (the strangling can outlive the workload that started it).
    const r = step.hand === 1
      ? (burnPid ? killHand(burnPid)
        : (burnImages?.length && imageKillHand ? imageKillHand(burnImages)
          : { ok: null, ms: 0, detail: 'no burn pid — nothing to kill' }))
      : stockHand();
    outcomes.push({ ...step, ...r });
    writeLine(formatFuseLine({
      atIso: new Date().toISOString(), phase: 'outcome', cause: step.cause,
      hand: step.hand, action: step.action, ok: r.ok, ms: r.ms, detail: r.detail,
    }));
  }
  dumpRing();
  return outcomes;
}

// =================================================================================================
// 3. The judge process — event loop, not Atomics.wait: datagrams need a live loop to be received
// =================================================================================================

/**
 * Why the judge does NOT reuse the watch's blocking-sleep cadence: `Atomics.wait` freezes the
 * event loop, and a frozen loop never delivers `dgram` messages — the judge would starve on the
 * very channel it exists to hear. A `setTimeout` chain at 2 ms under `timeBeginPeriod(1)` is the
 * honest alternative; the judge's own late wake-ups are data (they ARE the timer-role
 * observation), recorded into the ring like everything else.
 */
/**
 * @guard fuse-deadman
 * THREAT:         зависание машины владельца при спуске по напряжению — класс, оплаченный дважды
 *                 (`bugs/03`, 5 ч 40 мин; `bugs/76`, 2026-08-30)
 * PROVED-AGAINST: смерть ПРОЦЕССА горна на цифровом двойнике (`--rehearse-death strangle` и
 *                 `instant`), 9/9 проверок репетиции, вход 1 и вход 2
 * GAP:            🔴 ЗАВИСАНИЕ МАШИНЫ НЕ ДОКАЗАНО И НА ДВОЙНИКЕ НЕДОКАЗУЕМО. Судья — процесс на
 *                 той же ОС; встала ОС — встал судья. Двойник по построению не может заморозить
 *                 свой хост. 2026-08-30 машина зависла, трипов записано НОЛЬ. Роль «констатация
 *                 смерти» изнутри ОС невыполнима в принципе; роль «предсказание» выполнима и
 *                 закрывается фазами 3–4 эпика `plans/73` (`researches/26`)
 * ON-REAL-PATH:   2026-08-30 — наблюдён на живом прогоне полосы 2887…2745: взведён, N=60 мс,
 *                 трипов 0, машина зависла на 2752 МГц / 825 мВ (`bugs/76`)
 *
 * Строка `GAP`, написанная 28 августа, сняла бы инцидент 30-го: владелец прочитал бы «доказан»
 * правильно, а не так, как агент ему это подал. Ради этого и заведён механизм М1 (`plans/76`).
 */
export async function runJudge({
  beatPort = 0, armNMs = null, armMMs = null, burnPid = null, burnImages = null,
  // ⚡ ВХОД 3 (`plans/91`): доля от бегущего пика. `null` — НЕ ВЗВЕДЁН, как у входов 1 и 2:
  // невзведённый вход не трипает никогда, и «отсутствует» не читается как «в порядке».
  armPowerRatio = null,
  burnPidFile = null, twinStockCard = null,
  // ⚡ `bugs/101` находка 1: ПУТЬ ЖУРНАЛА ПОЛОСЫ, и судья им НЕ ПОЛЬЗУЕТСЯ — он лишь передаёт его
  // руке 2, которой счётчик намерений нужен как сейлок вокруг собственной записи. Судья читать его
  // не должен: решение о гонке принимает тот, кто в ней участвовал, а не наблюдатель со стороны.
  sweepJournalPath = null,
  // ⚡ Вход 2 (`plans/66`): путь файла сердцебиения прожига. Судья его НЕ ЧИТАЕТ в такте — он лишь
  // спрашивает о его СУЩЕСТВОВАНИИ, и только когда вход 2 уже собрался трипнуть.
  progressFile = null, existsFn = existsSync,
  journalPath, ringCapacity = RING_CAPACITY, seconds = null,
  // ⚡ `bugs/123`: дверь нужна РОВНО для мутации — блок обязан уметь воспроизвести прежнюю беду,
  // иначе он не сторож, а украшение. В боевом пути непрерывная запись включена всегда.
  liveRing = true,
  // ⚡ Ш3 (`plans/88` §4b(4) и §4c): ПОЛУОТКРЫТОЕ ОКНО ПРИХОДИТ ПАРАМЕТРАМИ, А НЕ ТОЛЬКО КОНСТАНТОЙ.
  // Умолчания — измеренные числа живого пути. Своими значениями окно называют те, кто физически не
  // может дать 300 тактов/с: фикстура без `timeBeginPeriod` (~62/с) и репетиция смерти, где ту же
  // машину грузит вся полоса (4…70/с). Без этой двери окно стало бы СТЕНОЙ на стенде — тот самый
  // класс, за который проект уже платил (`bugs/72` · [[EXP-0193]]).
  healthySeconds = REARM_HEALTHY_SECONDS,
  // ⚡ `bugs/121`: РЕШАЕТ ТЕПЕРЬ РАЗРЫВ, и уставка такта убрана отсюда совсем — держать параметр,
  // которым никто не судит, значило бы оставить в приборе ручку без провода. Дверь остаётся одна:
  // фикстура вправе назвать свой разрыв, но умолчание ОДНО на все среды, потому что квант таймера
  // в него уже уложен.
  healthyWorstGapMs = JUDGE_HEALTHY_WORST_GAP_MS,
  // ⚡ `bugs/122`: сколько телеметрия карты может стоять, пока это ещё жизнь. Дверь нужна фикстуре:
  // она обязана уметь проиграть заморозку за секунды, а не за пять.
  cardTelemetryFrozenMs = CARD_TELEMETRY_FROZEN_MS,
  // ⚡ Срок полуоткрытого окна. Своей дверью, как и уставка: фикстура, которой отведены секунды,
  // не может ждать тридцати, а без двери блок «окно-стена» проверял бы терпение прогонщика.
  halfOpenDeadlineMs = HALF_OPEN_DEADLINE_MS,
  // ⚡ Ш5 (`plans/81`): чем судья ЧИТАЕТ собственный журнал, когда ждёт расписку руки 2. Своя дверь
  // нужна затем же, зачем `existsFn`: фикстура обязана уметь подать расписку без настоящей руки.
  readLinesFn = null,
  // ЖИВ ЛИ ПРОЦЕСС — ОТДЕЛЬНАЯ ДВЕРЬ ОТ `killFn`, НАМЕРЕННО. Сигнал 0 не убивает, а спрашивает о
  // существовании; пустить этот вопрос через канал убийства значило бы, что фикстура, считающая
  // убитых, посчитает и опрошенных — две разные правды через одну дверь.
  isAliveFn = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } },
  spawnSyncFn, spawnFn, killFn = process.kill.bind(process), onReady = null, log = () => {},
}) {
  const dgram = await import('node:dgram');
  mkdirSync(path.dirname(journalPath), { recursive: true });
  const fd = openSync(journalPath, 'a');
  const writeLine = (line) => { writeSync(fd, line); fsyncSync(fd); };
  const ring = makeRing(ringCapacity);
  const ringPath = journalPath.replace(/\.jsonl$/u, '-ring.jsonl');
  let ringDumped = false;
  /**
   * @forensic fuse-ring
   * EXPLAINS:   полную картину такта в разрешении 2 мс В МОМЕНТ ТРИПА — что именно видел судья,
   *             когда решил бить. Про смерть машины кольцо больше НЕ отвечает: этот вопрос забрал
   *             `@forensic fuse-alive` ниже
   * DURABLE-AT: trip-only
   *
   * 🔴 НАРУШЕНИЕ ОСТАЛОСЬ, И ЭТО ЧЕСТНО, А НЕ НЕДОДЕЛКА. `bugs/78` закрыт 2026-08-31, но закрыт
   * НЕ ТЕМ, что кольцо стало секундным — оно им не стало и не должно. Лечение было другим: рядом
   * встал второй слой (`fuse-alive`, `DURABLE-AT: every-second`), который переживает то, чего
   * кольцо не переживает. Кольцо осталось best-effort дампом высокого разрешения, и `trip-only` —
   * ПРАВДА о нём.
   *
   * План `plans/74` предписывал после починки поставить сюда `every-second` и снять долг. **Не
   * исполнено намеренно: это была бы ложь в маркере ради зелёного линтера** — ровно то, против
   * чего заведён весь механизм. Долг остаётся в `decisions/guard-lint-baseline.json` и меняет
   * смысл: не «незакрытый дефект», а «объявленное свойство, покрытое соседом».
   *
   * ⚠️ ОТСЮДА ВОПРОС К САМОМУ ПРАВИЛУ R4, и он записан в `plans/74` §8: правило спрашивает «когда
   * улика становится долговечной», а спрашивать должно **«становится ли она долговечной в момент
   * ТОГО СОБЫТИЯ, КОТОРОЕ ОБЪЯСНЯЕТ»**. Кольцо объясняет трип и ложится на трипе — для своего
   * события оно долговечно. Изобретать это правило в ночь закрытия фазы я не стал: семантическое
   * правило, придуманное под давлением срока, — это способ, которым родились дефекты 30 августа.
   */
  const dumpRing = () => {
    // On-trip and on-close only — NEVER per tick: the ring is forensics, not the control loop.
    const rfd = openSync(ringPath, 'a');
    try {
      for (const e of drainRing(ring)) writeSync(rfd, `${JSON.stringify(e)}\n`);
      fsyncSync(rfd);
      ringDumped = true;
    } finally { closeSync(rfd); }
  };

  /**
   * ⚡ НЕПРЕРЫВНЫЙ ЧЁРНЫЙ ЯЩИК — `bugs/123`, куплен ТРЕМЯ смертями 08.09 подряд.
   *
   * @forensic fuse-live-ring
   * EXPLAINS:   что видел судья в разрешении 2 мс перед смертью машины, КОТОРАЯ НЕ ДАЛА ТРИПА
   * DURABLE-AT: every-tick (сброс на диск батчем, окно потери названо числом ниже)
   *
   * 🔴 ЗАЧЕМ. Кольцо в памяти объясняет ТРИП и ложится на трипе — для своего события оно
   * долговечно, и это записано этажом выше честно. Но смерть машины трипа не даёт: 08.09 в 13:26
   * машина умерла из полностью здорового состояния (мощность 250 Вт, разрыв такта 16,53 мс, пульс
   * 15,44 мс) между двумя тактами, срабатывания не было — и пятнадцать тысяч тактов высокого
   * разрешения умерли вместе с процессом. Так же ушли обе смерти до неё. Заказ владельца от
   * 26.08 — *«чтобы по результатам нагрузки можно было предсказывать приближение видеокарты к краю
   * и отказу»* — на секундной строке жизни неисполним: там предвестника НЕТ. Он может быть только
   * в такте 2 мс, а такт 2 мс мы каждый раз выбрасывали.
   *
   * КАК. Две файла-половины по `ringCapacity` записей. Пишем в текущую; заполнилась — переключаемся
   * на другую и обнуляем её. На диске всегда лежит от одного до двух объёмов кольца, то есть
   * 30…60 секунд при такте 2 мс, а размер ограничен сверху и не растёт с длиной прогона.
   * Разбор читает обе половины и сортирует по `t` — порядок хранения не является порядком времени,
   * ровно как у кольца в памяти.
   *
   * ⚠️ ОКНО ПОТЕРИ НАЗВАНО, А НЕ ЗАМОЛЧАНО. `writeSync` кладёт такт в страничный кэш ОС; синий
   * экран уносит кэш. Поэтому `fsync` идёт раз в `LIVE_RING_FSYNC_MS`, и при синем экране теряется
   * НЕ ВСЁ, а последнее окно — до 500 мс. Ежетактный `fsync` не рассматривается: он стоит
   * миллисекунды на вызов при такте 2 мс, то есть убил бы сам такт, ради которого всё делается.
   * Обещание здесь ровно такое: «последние полсекунды могут не долететь, всё предыдущее долетит».
   */
  const liveRingPaths = [
    journalPath.replace(/\.jsonl$/u, '-live-a.jsonl'),
    journalPath.replace(/\.jsonl$/u, '-live-b.jsonl'),
  ];
  let liveHalf = 0;
  let liveCount = 0;
  let liveFd = liveRing ? openSync(liveRingPaths[0], 'w') : null;
  let liveLastFsyncMs = 0;
  const recordLive = (row) => {
    if (!liveRing) return;
    try {
      writeSync(liveFd, `${JSON.stringify(row)}\n`);
      liveCount += 1;
      if (liveCount >= ringCapacity) {
        closeSync(liveFd);
        liveHalf = 1 - liveHalf;
        // 'w' — половина ОБНУЛЯЕТСЯ при переключении: иначе файл рос бы весь вечер, и «ограничен
        // сверху» было бы неправдой.
        liveFd = openSync(liveRingPaths[liveHalf], 'w');
        liveCount = 0;
        liveLastFsyncMs = 0;
      }
      const nowMs = performance.now();
      if (nowMs - liveLastFsyncMs >= LIVE_RING_FSYNC_MS) { fsyncSync(liveFd); liveLastFsyncMs = nowMs; }
    } catch { /* чёрный ящик НИКОГДА не роняет судью: улика дешевле защиты (R14) */ }
  };
  const closeLive = () => {
    if (!liveRing || liveFd === null) return;
    try { fsyncSync(liveFd); closeSync(liveFd); } catch { /* уже закрыт */ }
  };

  /**
   * @forensic fuse-alive
   * EXPLAINS:   жил ли судья в последние секунды перед смертью машины и что он видел — единственный
   *             вопрос, на который 30 августа ответить было нечем (`bugs/76`, `bugs/78`)
   * DURABLE-AT: every-second
   * GAP:        🔴 `fsync` НЕ ДОКАЗАН НИЧЕМ. Мутация K3 (снять `fsync`, оставить `write`) прошла
   *             ЗЕЛЁНОЙ — 57/0, стенд не увидел разницы. Причина честная и неустранимая на стенде:
   *             `taskkill /T /F` убивает ПРОЦЕСС, а не ОС; байты уже отданы ядру, и кэш страниц
   *             переживает смерть процесса. Потерю кэша даёт только настоящая смерть МАШИНЫ,
   *             которую двойник воспроизвести не может. Значит доказано СВОЙСТВО «строка пишется
   *             раз в секунду и переживает отсутствие штатного закрытия», а НЕ «улика переживает
   *             зависание хоста». Второе держится на отраслевой практике (самописцы, аварийные
   *             дампы, журналы упреждающей записи) и на `bugs/37`, где кэш страниц уже съел архив
   *             пульса на этой машине, — но не на нашем замере. Поле стоит здесь намеренно:
   *             у `@forensic` его не требует ни одно правило линтера, и это отдельная дыра
   *             механизма М3 — сторож формы не спрашивает самописца, чего его доказательство
   *             не покрывает.
   *
   * СТРОКА ЖИЗНИ — второй слой чёрного ящика, и он существует ровно потому, что первый не пережил
   * событие. Кольцо выше даёт разрешение 2 мс, но становится долговечным только при трипе или
   * штатном закрытии; зависание машины не даёт НИ ТОГО, НИ ДРУГОГО, и 30 августа файла кольца не
   * появилось вовсе. Здесь — дешёвая непрерывная запись: одна строка в секунду с немедленным
   * `fsync`, то есть улика на диске ДО того, как случится то, ради чего она нужна.
   *
   * Так решает отрасль, и это не наше изобретение: бортовые самописцы, аварийные дампы ядра и
   * журналы упреждающей записи баз данных сбрасывают буфер НЕПРЕРЫВНО. Развилку «каждый такт или
   * в конце» 28 августа я принял за исчерпывающую и выбрал «в конце» — цена записана в EXP-0200.
   *
   * ⚠️ Кольцо НИЧЕГО не теряет: полный дамп остаётся ровно таким, как был. Слой добавлен, не
   * заменён — там, где есть кому записать, разрешение 2 мс никуда не делось.
   *
   * @fork ring-flush-cadence
   * OPTIONS:  сброс каждый такт (2 мс) · только на трипе и штатном закрытии · секундный агрегат
   * COST:     улика не переживает событие → разбор зависания невозможен вовсе (случилось 30.08)
   * RECON:    researches/27 — отрасль решает это непрерывным сбросом: бортовые самописцы,
   *           аварийные дампы ядра, журналы упреждающей записи баз данных
   * DECIDED:  секундный агрегат с fsync. 28 августа я принял эту развилку за исчерпывающую
   *           («каждый такт дорого → значит в конце») и не назвал третий вариант — он стоил
   *           копейки. Ровно этот промах записан в EXP-0200 и породил механизм М4
   *
   * @fork silence-of-an-unwired-channel
   * OPTIONS:  писать 0 · писать null · не писать поле вовсе
   * COST:     выдуманное число в улике — разбор построит вывод на том, чего никто не измерял
   * RECON:    NOT YET — разведки не было; решение принято по канону проекта (`PHILOSOPHY.md`,
   *           три двери: выдуманное число хуже отсутствующего). Долг признан и виден
   * DECIDED:  null. Ноль читался бы как «молчания не было» — утверждение о канале, которого
   *           никто не слушал. Защищено мутацией K5: подмена null на ноль краснеет
   */
  const alivePath = journalPath.replace(/\.jsonl$/u, '-alive.jsonl');
  const ALIVE_WINDOW_MS = 1000;
  let aliveFd = null;
  // Конец текущего окна. `null` до первого такта: `startMs` берётся ниже, и заводить окно здесь
  // значило бы держать два источника времени вместо одного.
  let aliveWindowEndMs = null;
  let aliveTicks = 0;
  let aliveWorstGap = 0;
  let aliveWorstBeat = null;
  let aliveWorstProgress = null;
  // ⚡ `plans/91` Ш1 — ВХОД 3: МИНИМУМ мощности за окно, а не максимум. Отказ, который нас убил,
  // выглядит как ПРОВАЛ потребления при заявленной загрузке (60 Вт вместо 280), поэтому
  // разборчива нижняя граница. Максимум сказал бы «карта работала» про секунду, в которой она
  // работала первые 200 мс и умерла.
  let aliveMinPowerMw = null;

  const flushAlive = (nowMs, tStartMs) => {
    // 🔴 ЧЕСТНЫЙ `null` ВМЕСТО ВЫДУМАННОГО НУЛЯ. Пока канал не проведён (ударов не было ни одного,
    // прогресс не подключён), «худшее молчание» не равно нулю — оно НЕИЗВЕСТНО. Ноль здесь читался
    // бы как «молчания не было», то есть как утверждение о канале, которого никто не слышал.
    // Выдуманное число в улике хуже отсутствующего (`PHILOSOPHY.md` → три двери), а разбор,
    // построенный на нём, тем опаснее, чем стройнее.
    const line = `${JSON.stringify({
      atIso: new Date().toISOString(),
      t: round2(nowMs - tStartMs),
      ticks: aliveTicks,
      worstGapMs: round2(aliveWorstGap),
      worstBeatSilenceMs: aliveWorstBeat === null ? null : round2(aliveWorstBeat),
      worstProgressSilenceMs: aliveWorstProgress === null ? null : round2(aliveWorstProgress),
      minPowerMw: aliveMinPowerMw,
    })}\n`;
    if (aliveFd === null) aliveFd = openSync(alivePath, 'a');
    writeSync(aliveFd, line);
    // `fsync` — весь смысл слоя. Без него строка живёт в кэше страниц и умирает вместе с машиной
    // ровно так же, как умерло кольцо (семья `bugs/37`: архив пульса терялся в кэше именно тогда,
    // когда был нужен).
    fsyncSync(aliveFd);
    aliveTicks = 0;
    aliveWorstGap = 0;
    aliveWorstBeat = null;
    aliveWorstProgress = null;
    aliveMinPowerMw = null;
  };

  const killHand = makeKillHand({ spawnSyncFn, killFn });
  const imageKillHand = makeImageKillHand({ spawnSyncFn });
  const stockHand = makeStockHand({
    spawnFn,
    journalPath,
    extraArgs: [
      ...(twinStockCard ? ['--twin', twinStockCard] : []),
      ...(sweepJournalPath ? ['--sweep-journal', sweepJournalPath] : []),
    ],
  });

  const sock = dgram.createSocket('udp4');
  let lastBeatMs = null;
  let lastProgressMs = null;
  let progressWired = false;
  let lastPowerMw = null;
  // ⚡ `bugs/122`: когда мощность в последний раз ИЗМЕНИЛАСЬ (а не когда пришла).
  let lastPowerChangeMs = null;
  let peakPowerMw = 0;         // бегущий пик прожига — вход 3 делит на него
  let lowPowerSinceMs = null;  // когда началась выдержка провала; null — провала нет
  let beats = 0;
  sock.on('message', (buf) => {
    const now = performance.now();
    // One byte is the whole protocol: 0x01 = driver-liveness beat, 0x02 = burn progress. Anything
    // else is noise on a loopback port and is counted, not obeyed.
    if (buf[0] === 0x01) {
      lastBeatMs = now; beats += 1;
      // ⚡ ВХОД 3 (`plans/91` Ш1): удар в пять байт несёт милливатты пробы. Однобайтный удар
      // старой пробы остаётся законным — поле просто не появится, и это честное «не слышал»,
      // а не ноль (тот же довод, что у `progressWired`).
      if (buf.length >= 5) {
        const mw = buf.readUInt32LE(1);
        // ⚡ `bugs/122`: ОТДЕЛЬНО ЗАПОМИНАЕТСЯ НЕ ЗНАЧЕНИЕ, А МИГ ЕГО ПОСЛЕДНЕГО ИЗМЕНЕНИЯ. Разница
        // между «удары идут» и «карта считает» ровно здесь: 08.09 удары шли 119 секунд, а число за
        // ними не двинулось ни разу. Первый удар задаёт отсчёт, иначе «не менялось» началось бы от
        // старта судьи и соврало бы на всю разгонную паузу.
        if (lastPowerChangeMs === null || mw !== lastPowerMw) lastPowerChangeMs = now;
        lastPowerMw = mw;
      }
    }
    else if (buf[0] === 0x02) { lastProgressMs = now; progressWired = true; }
  });

  await new Promise((resolve, reject) => {
    sock.once('error', reject);
    sock.bind({ address: '127.0.0.1', port: beatPort }, resolve);
  });
  const boundPort = sock.address().port;
  log(`СУДЬЯ: порт ${boundPort} · такт ${JUDGE_TICK_MS} мс · N=${armNMs ?? 'НЕ ВЗВЕДЁН (наблюдение)'} · M=${armMMs ?? 'не взведён'} · pid прожига: ${burnPid ?? (burnPidFile ? `из пид-файла в момент трипа (${burnPidFile})` : (burnImages?.length ? 'по именам: ' + burnImages.join(',') : 'нет'))}${twinStockCard ? ' · рука 2: ДВОЙНИК' : ''}`);
  if (onReady) onReady({ port: boundPort });

  const startMs = performance.now();
  const endMs = seconds === null ? Infinity : startMs + seconds * 1000;
  let tripOutcomes = null;
  let lastTickMs = startMs;
  // ⚡ Ш5: трипов случилось / перевзведений сделано. Считаются ОБА, потому что отвечают на разные
  // вопросы: сколько раз машину спасали (показатель владельца, AC6) и сколько раз спасение
  // ПЕРЕЖИЛИ. Раньше хватало одного булева `tripOutcomes !== null`, потому что трип был последним
  // событием в жизни судьи.
  let tripsFired = 0;
  let rearmsDone = 0;
  // Судья вышел, НЕ пережив свой трип, — это и есть прежнее поведение и прежний код выхода 2.
  // Отдельное поле, а не `tripsFired > 0`: пережитый трип полосу останавливать НЕ должен, иначе
  // весь шаг бессмыслен.
  let exitedUnRearmed = false;
  // ⚡ Ш3 (`plans/88`): ВРЕМЯ ОТКРЫТОГО СПАСЕНИЯ и СОСТОЯНИЕ ПОЛУОТКРЫТОГО ОКНА.
  //
  // `tripAtMs !== null` означает «срабатывание случилось и ещё не закрыто» — им живут ОБЕ половины
  // возврата: ожидание расписки руки 2 и накопление здоровых секунд после неё. Раньше это время
  // было аргументом `awaitRearm`, потому что закрыть спасение мог только он; теперь закрыть его
  // может и такт (дедлайн вечера настигает судью В ОКНЕ), значит время обязано жить снаружи обоих.
  //
  // `halfOpen === null` — окна нет: либо спасения нет вовсе, либо расписка ещё не пришла.
  let tripAtMs = null;
  let halfOpen = null;
  // Идёт ли прожиг ПРЯМО СЕЙЧАС. Признак — существование файла сердцебиения: его создаёт прожиг и
  // снимает при штатном выходе (и `.cu`, и носитель двойника). Источника не проведено — ворота
  // открыты, и это верно: тогда вход 2 не взведён и трипать нечему.
  const burnInFlight = () => (progressFile === null ? true : existsFn(progressFile));

  await new Promise((resolve) => {
    // ⚡ Ш3: ТАКТ ТЕПЕРЬ ПЕРЕЖИВАЕТ СПАСЕНИЕ, ЗНАЧИТ ЕГО НАДО УМЕТЬ ОСТАНОВИТЬ ЯВНО.
    //
    // До Ш3 останавливать было нечего: судья, ушедший ждать расписку, такта не планировал вовсе, и
    // `resolve()` заставал систему без единого висящего таймера. Теперь такт идёт весь рескью — и
    // `resolve()` без остановки оставил бы его тикать ПОСЛЕ `closeSync(fd)`: первая же запись
    // строки жизни ударила бы в закрытый дескриптор. Это не гипотеза о стиле, а прямое следствие
    // снятия того самого `return`, ради которого шаг и делается.
    let tickTimer = null;
    let stopped = false;
    const stopJudge = () => {
      stopped = true;
      if (tickTimer !== null) { clearTimeout(tickTimer); tickTimer = null; }
      resolve();
    };
    /**
     * ⚡ Ш5 — ПЕРЕВЗВЕДЕНИЕ: ЯВНЫЙ СПИСОК ПОЛЕЙ, А НЕ «ПРОДОЛЖАЕМ КАК БЫЛО».
     *
     * Риск (д) плана 81, класс `bugs/19`: судья, унёсший состояние прошлой ступени, судит СЛЕДУЮЩУЮ
     * по чужим таймерам. «Продолжаем как было» здесь означало бы мгновенный повторный трип на
     * трупе: `lastBeatMs` указывает в момент ДО спасения, и первый же такт увидит тишину длиной во
     * всё спасение. Поэтому список ПОЛНЫЙ и каждое поле названо — включая те, что оставлены
     * НАМЕРЕННО: молчание про поле неотличимо от забытого поля.
     */
    const resetForRearm = (now) => {
      // ── СБРАСЫВАЕТСЯ ────────────────────────────────────────────────────────────────────────
      lastBeatMs = now;          // иначе тишина всего спасения читается как отказ следующей ступени
      lastProgressMs = null;     // прожиг убит рукой 1; прогрессу взяться неоткуда
      progressWired = false;     // канал проводил МЁРТВЫЙ прожиг: «источника нет» ≠ «застыл» (R4c)
      lastTickMs = now;          // иначе вся пауза спасения ляжет в кольцо одним ложным зазором
      tripOutcomes = null;       // ЭТО И ЕСТЬ ВЗВЕДЕНИЕ: ворота такта — `verdict.tripped && !tripOutcomes`
      ringDumped = false;        // иначе штатное закрытие НЕ сбросит кольцо второй половины вечера
      aliveTicks = 0;            // накопители строки жизни — за новое окно, а не за пережитое
      aliveWorstGap = 0;
      aliveWorstBeat = null;
      aliveWorstProgress = null;
      aliveMinPowerMw = null;
      peakPowerMw = 0;           // вход 3: прожиг убит рукой 1, пик прошлой ступени судить нечем
      lowPowerSinceMs = null;
      // Окно строки жизни переносится ЗА `now`, а не двигается шагами: спасение могло длиться
      // 58 секунд, и догонять его пятьюдесятью восемью пустыми окнами значило бы писать «судья
      // молчал» про судью, который в это время ЖДАЛ расписку — а это разные факты.
      aliveWindowEndMs = now + ALIVE_WINDOW_MS;
      // ── ОСТАЁТСЯ НАМЕРЕННО ──────────────────────────────────────────────────────────────────
      // `beats`   — счёт за ВСЮ жизнь судьи, он в сводке; обнулять значило бы потерять показатель.
      // `endMs`   — дедлайн вечера. Продлить его на время спасения значило бы тихо удлинить прогон.
      // `ring`    — уже опустошён `dumpRing` внутри трипа; повторная чистка была бы второй правдой.
      //             ✏️ 2026-09-05: до этого дня строка была НЕПРАВДОЙ — `drainRing` не опустошал
      //             кольцо, и утверждение здесь ровно поэтому никто и не проверял (`bugs/107`).
      //             Теперь опустошает, и строка снова описывает то, что происходит.
      // `fd` · `aliveFd` · `sock` — те же каналы: судья не перезапускается, он ПРОДОЛЖАЕТСЯ.
    };

    /**
     * ⚡ Ш5 — ОЖИДАНИЕ РАСПИСКИ РУКИ 2. **[ИИ] Решение АГЕНТА П1** (`plans/81` §3): ЖДАТЬ, порога не
     * заводить.
     *
     * ✏️ ПОПРАВКА 2026-09-08, СЛОВОМ ВЛАДЕЛЬЦА: *«решение владельца П1 — я НЕ ПОМНЮ ТАКОГО
     * РЕШЕНИЯ!!!»*. Здесь семнадцать дней стояло «решение владельца», и это была ЛОЖНАЯ ПРИПИСКА.
     * В `plans/81` §3 его слово ровно одно — *«давай как ты считаешь»*, то есть он отдал выбор
     * агенту. Всё, что дальше, выбрал агент и обязан подписывать своим именем: **[ИИ]**. Замер, на котором это стоит: вся рука на здоровой карте ≈ 1,9 с, на живом трипе
     * 31.08 — 58,4 с. Долгим ожидание становится ровно тогда, когда карте плохо, то есть когда
     * ждать и НАДО.
     *
     * 🔴 ГРАНИЦА ОЖИДАНИЯ — НАБЛЮДЕНИЕ, А НЕ ВЫДУМАННЫЙ ТАЙМАУТ: ждём, пока ЖИВА САМА РУКА.
     * Рука, умершая молча (она говорит с умирающим драйвером — это её штатный риск), расписки уже
     * не напишет, и ждать её вечно значило бы повесить полосу на глазах у владельца. Пид руки
     * приходит из её же спауна, живость спрашивается сигналом 0 — стандартная проверка
     * существования процесса, без единого назначенного числа.
     */
    const awaitRearm = (startedAtMs) => {
      const hand2 = tripOutcomes?.find((o) => o.hand === 2) ?? null;
      const handPid = Number.isInteger(hand2?.pid) ? hand2.pid : null;
      // Порядковый номер расписки, которую ждёт ИМЕННО ЭТОТ трип. Счёт, а не время: штампы ставят
      // разные процессы своими часами ([[EXP-0207]]). Каждое перевзведение съедает ровно одну.
      const seenBefore = rearmsDone;
      const readLines = readLinesFn ?? (() => {
        try { return readFileSync(journalPath, 'utf8').split(/\r?\n/u); } catch { return []; }
      });
      const poll = () => {
        // Судья мог закончить, пока опрос спал: такт теперь живёт параллельно и умеет закрыть
        // спасение раньше (дедлайн вечера). Опрос, проснувшийся после закрытия дескрипторов,
        // написал бы в закрытый файл — поэтому первый вопрос всегда «а судья ещё жив».
        if (stopped || tripAtMs === null) return;
        const now = performance.now();
        const d = rearmDecision(readLines(), seenBefore);
        if (d.state === 'confirmed') {
          // ⚡ Ш3: РАСПИСКА БОЛЬШЕ НЕ ЗАКРЫВАЕТ СПАСЕНИЕ — ОНА ОТКРЫВАЕТ ПОЛУОТКРЫТОЕ ОКНО.
          // Замер, ради которого шаг и делается: перевзведений в БОЛЬНУЮ машину было 10 из 10, и
          // каждое кончалось новым срабатыванием через 0,06 с. Расписка говорит про КАРТУ («сток
          // возвращён и перечитан»), а не про МАШИНУ — здоровье машины доказывает такт судьи.
          openHalfOpen(now, d.receipt);
          return;
        }
        if (d.state === 'refused') {
          closeRescue(false, 'рука 2 отчиталась ok:false — сток НЕ подтверждён чтением', now);
          return;
        }
        // `waiting`: расписки ещё нет. Единственный вопрос — жива ли рука.
        if (handPid === null) { closeRescue(false, 'рука 2 не запустилась — расписки не будет', now); return; }
        if (!isAliveFn(handPid)) {
          closeRescue(false, `рука 2 (pid ${handPid}) вышла, не оставив расписки`, now);
          return;
        }
        // ⚡ `bugs/122` — ВТОРОЙ ВОПРОС ОЖИДАНИЯ: А КАРТА ЕЩЁ СЧИТАЕТ? Рука жива, но она говорит с
        // драйвером, и 08.09 она ушла туда и не вернулась — 119 секунд, пока машина умирала. Живой
        // процесс руки этого не различает вовсе, а телеметрия различает: удары ИДУТ (пульс свежий),
        // а мощность стоит на одном числе. Это не часы и не порог ожидания — это НАБЛЮДЕНИЕ, и оно
        // не отменяет [ИИ] решения П1 «ждать»: ждать больше нечего, расписки не будет.
        if (lastPowerMw !== null && lastPowerChangeMs !== null
          && lastBeatMs !== null && now - lastBeatMs <= BEATS_FRESH_MS
          && now - lastPowerChangeMs >= cardTelemetryFrozenMs) {
          closeRescue(false,
            `КАРТА ОТВЕЧАЕТ, НО НЕ СЧИТАЕТ: пульс свежий (${round2(now - lastBeatMs)} мс), а мощность `
            + `стоит на ${lastPowerMw} мВт уже ${round2((now - lastPowerChangeMs) / 1000)} с — рука 2 `
            + `(pid ${handPid}) расписки не напишет`,
            now);
          return;
        }
        // Дедлайн вечера здесь БОЛЬШЕ НЕ ПРОВЕРЯЕТСЯ, и это не забытая строка. Такт идёт весь
        // рескью и опрашивает тот же `endMs` каждые 2 мс против 250 мс у опроса — две копии
        // одного решения были бы парой «правда ↔ зеркало», разошедшейся на четверть секунды.
        setTimeout(poll, REARM_POLL_MS);
      };
      void startedAtMs;
      poll();
    };

    /**
     * ⚡ Ш3 (`plans/88`) — ВХОД В ПОЛУОТКРЫТОЕ СОСТОЯНИЕ.
     *
     * Отсюда и до взведения судья НАБЛЮДАЕТ: такт идёт, строка жизни пишется, срабатывание
     * невозможно — ворота такта `verdict.tripped && !tripOutcomes` закрыты, пока спасение открыто,
     * а закрывает его только `resetForRearm` при взведении. Это ровно то, что отрасль называет
     * half-open: контур смотрит на пробу, не пропуская нагрузку (`researches/33`).
     *
     * 🔴 ОКНО СТРОКИ ЖИЗНИ ВЫРАВНИВАЕТСЯ ЗДЕСЬ, И БЕЗ ЭТОГО ОКНО ЛГАЛО БЫ. Границы окон стоят от
     * старта судьи; спасение кончается посреди окна, и первой «здоровой секундой» оказался бы
     * огрызок в сто миллисекунд с сотней тактов — то есть здоровая машина была бы прочитана как
     * больная, а счёт сброшен на пустом месте. Перенос границы ЗА `now` — тот же приём и та же
     * причина, что у `resetForRearm`.
     */
    const openHalfOpen = (now, receipt) => {
      halfOpen = { state: null, sinceMs: now, receiptMs: receipt?.ms ?? null };
      if (aliveTicks > 0) flushAlive(now, startMs);
      aliveWindowEndMs = now + ALIVE_WINDOW_MS;
      writeLine(formatFuseLine({
        atIso: new Date().toISOString(), phase: 'rearm', cause: 'fuse-rescue',
        // `ok: null` — НЕ решение, а состояние: ни «вернулся», ни «отказался». Полоса читает
        // `rearmCount` (`phase: 'rearm' && ok === true`), и строка с `null` для неё невидима —
        // проверено предикатом, а не надеждой: половина возврата, посчитанная за возврат, пустила
        // бы прожиг без взведённой защиты.
        hand: 2, action: 'half-open', ok: null, ms: now - tripAtMs,
        detail: `сток подтверждён чтением (рука 2 отчиталась за ${round2(receipt?.ms ?? 0)} мс); ПОЛУОТКРЫТО — нужно ${healthySeconds} здоровых секунд подряд при разрыве такта ≤ ${healthyWorstGapMs} мс`,
      }));
      log(`⚡ ПОЛУОТКРЫТО: сток подтверждён, но на пост судья вернётся, ДОКАЗАВ здоровье машины — ${healthySeconds} здоровых секунд подряд (разрыв такта ≤ ${healthyWorstGapMs} мс)`);
    };

    /**
     * ⚡ Ш3 — ЗАКРЫТИЕ СПАСЕНИЯ, ОДНО НА ВСЕ ТРИ ПУТИ (расписка отказала · рука умерла · вечер
     * кончился в окне). Вынесено из `awaitRearm` наружу именно потому, что третий путь принадлежит
     * теперь ТАКТУ: держать закрытие внутри опроса значило бы иметь два разных способа закрыть одно
     * состояние — DRY здесь не украшение, а условие того, что `rearm`-строка в журнале ровно одна.
     */
    const closeRescue = (ok, detail, now, gate = null) => {
      // Закрыть можно только ОТКРЫТОЕ спасение, и ровно один раз. Пути к закрытию теперь три
      // (опрос · такт · дедлайн), и два из них способны сработать в один и тот же миг: без этой
      // строки в журнал легла бы вторая `rearm`-строка на то же срабатывание, а счёт `rearmCount`
      // у полосы поехал бы — то есть прожиг без взведённой защиты.
      if (stopped || tripAtMs === null) return;
      writeLine(formatFuseLine({
        atIso: new Date().toISOString(), phase: 'rearm', cause: 'fuse-rescue',
        hand: 2, action: ok ? 'rearm' : 'rearm-refused', ok, ms: now - tripAtMs,
        // P88-AC5: уставка и длина окна ПЕЧАТАЮТСЯ, а не живут только в коде. Так выборка растёт
        // сама (риск 3 плана 88: шесть эпизодов — малая выборка, и лечится она не угадыванием
        // пошире, а числом в каждом перевзведении).
        detail: gate === null ? detail
          // P88-AC5 + `bugs/121`: печатается И РЕШАЮЩАЯ величина, и наблюдаемая. Такт остаётся в
          // строке ровно затем, чтобы выборка росла: он больше не судит, но всё ещё свидетель.
          : `${detail} · worstGapMs=${gate.worstGapMs} · ticksPerSec=${gate.ticksPerSec} · healthySeconds=${gate.healthySeconds}/${healthySeconds} · уставка ≤ ${healthyWorstGapMs} мс`,
      }));
      if (ok) {
        rearmsDone += 1;
        // §4b(2): `resetForRearm` зовётся ЗДЕСЬ, при взведении, и ни секундой раньше. Он ставит
        // `lastBeatMs = now`; позови его на входе в окно — и к моменту взведения он протух бы на
        // всю длину окна, а первый же взведённый такт увидел бы тишину в три секунды и ударил
        // мгновенно. Спасение, порождающее спасение, — шторм 04.09, сделанный своими руками.
        resetForRearm(now);
        halfOpen = null;
        tripAtMs = null;
        log(`⚡ СУДЬЯ ПЕРЕВЗВЁЛСЯ: ${detail} — полоса идёт дальше (спасений за прогон: ${tripsFired})`);
        // §4b(3): такта здесь НЕ ПЛАНИРУЕТСЯ. Цикл идёт непрерывно с самого старта, и второй
        // `setTimeout(tick)` завёл бы ВТОРОГО судью на том же журнале: удвоенный `aliveTicks`
        // прочитался бы как «машина стала здоровее» — ложь в безопасную сторону, худший сорт.
      } else {
        exitedUnRearmed = true;
        halfOpen = null;
        tripAtMs = null;
        log(`⚡ СУДЬЯ НЕ ПЕРЕВЗВОДИТСЯ: ${detail} — полоса встаёт`);
        stopJudge();
      }
    };

    const tick = () => {
      // ⚡ Ш3: судья уже закончил — такт молчит. Строка стоит ПЕРВОЙ и до любого обращения к
      // дескрипторам: закрытие происходит в другом колбэке, и один запланированный такт всегда
      // успевает проснуться после него.
      if (stopped) return;
      const now = performance.now();
      // ⚡ `bugs/111`: СЧЁТ ВЗВЕДЕНИЙ НА ВХОДЕ В ТАКТ — ЧТОБЫ ОТЛИЧИТЬ СВОЙ ЖЕ СБРОС ОТ ОТКАЗА КАРТЫ.
      //
      // Вердикт ниже снимается ЗДЕСЬ, а взведение случается СЕРЕДИНОЙ этого же такта — в блоке
      // полуоткрытого окна, где `closeRescue(true)` зовёт `resetForRearm`. Тот обнуляет и
      // `lastProgressMs`, и `tripOutcomes`. Значит к воротам трипа внизу приходит вердикт,
      // снятый ДО сброса, против ворот, открытых ПОСЛЕ него, — и тишина, накопленная за
      // собственное спасение, бьёт мгновенно. Замерено на первом живом прогоне 07.09:
      // взведение 10:11:59.776 → трип 10:11:59.777, `progressSilenceMs 6754.37` при уставке 1046,
      // рука 1 не нашла ни одного образа («убивать было нечего»).
      //
      // Признак взят СУЩЕСТВУЮЩИЙ (`rearmsDone` растёт ровно во взведении), а не новый флаг: флаг
      // был бы парой «правда ↔ зеркало» к нему и разошёлся бы при первой правке `closeRescue`.
      const rearmsAtTickStart = rearmsDone;
      // ⚡ ВХОД 3: БЕГУЩИЙ ПИК И ВЫДЕРЖКА ПРОВАЛА — считаются здесь, в памяти, без диска.
      //
      // Признак «идёт ли прожиг» взят СУЩЕСТВУЮЩИЙ — `progressWired`, а не новый: сердцебиение
      // прогресса поднимает его ударом `0x02` и гасит на конце прожига. Новый флаг был бы парой
      // «правда ↔ зеркало» к нему и разошёлся бы при первой правке (тот же довод, что у
      // `rearmsDone` в `bugs/111`). Нет прожига — нет и суждения о работе карты: пик обнуляется,
      // выдержка снимается. Это ровно «источника нет» ≠ «застыл», третий раз в этом файле.
      // ⚡ `plans/93` Ш2: окно ВЫНЕСЕНО в `stepPowerWindow` — живой путь и проигрыватель записи
      // зовут одну функцию, поэтому правка поведения не может разойтись между ними (`bugs/120`).
      {
        const w = stepPowerWindow(
          { peakMw: peakPowerMw, lowSinceMs: lowPowerSinceMs },
          {
            progressWired,
            powerMw: lastPowerMw,
            nowMs: now,
            armPowerRatio,
            establishedMw: POWER_ESTABLISHED_MW,
          },
        );
        peakPowerMw = w.peakMw;
        lowPowerSinceMs = w.lowSinceMs;
      }
      const verdict = judgeLiveness({
        nowMs: now, lastBeatMs, armNMs, lastProgressMs, armMMs, progressWired,
        // ⚡ `plans/94` Ш4: ДОЛЯ ПИШЕТСЯ ВСЕГДА, ТРИПАЕТ — ТОЛЬКО ВЗВЕДЁННАЯ. Раньше здесь стояло
        // `armPowerRatio === null ? null : {...}`, и невзведённый вход 3 не давал В КОЛЬЦО ни
        // одной доли: измерять было нечем ровно в том режиме, в котором проходят чистые записи
        // фазы (взводить порог, выведенный из отменённого замера, запрещено эстафетой 92).
        // Наблюдение отделено от взведения ОДНИМ полем: `ratio: null` — и `powerTripped` выше
        // мёртв по первому же условию (`power.ratio !== null`), а `powerRatio` считается как
        // считался. Это та же граница «проведён ≠ взведён», что у входа 2 (`--progress-observe`).
        power: {
          mw: lastPowerMw,
          peakMw: peakPowerMw,
          ratio: armPowerRatio,
          establishedMw: POWER_ESTABLISHED_MW,
          lowForMs: lowPowerSinceMs === null ? 0 : now - lowPowerSinceMs,
          holdMs: POWER_LOW_HOLD_MS,
        },
      });
      // Every tick lands in the ring — the judge's own wake-up gap included: a judge that stalls
      // with the system records its own stall, which is exactly the timer-role observation.
      const tickRow = {
        t: round2(now - startMs), gapMs: round2(now - lastTickMs),
        beatSilenceMs: verdict.beatSilenceMs === null ? null : round2(verdict.beatSilenceMs),
        progressSilenceMs: verdict.progressSilenceMs === null ? null : round2(verdict.progressSilenceMs),
        // ⚡ ВХОД 3 (`plans/91` Ш1): мощность ложится ПОТАКТНО, а не только в секундную строку.
        // Ш3 выводит порог ИЗ АРХИВА, и архивом будет именно кольцо: обвал 08.09 занял 2,5 с, то
        // есть в секундной строке от него осталось бы два-три числа, а в кольце их больше тысячи.
        powerMw: lastPowerMw,
        powerRatio: verdict.powerRatio,
      };
      pushRing(ring, tickRow);
      // ⚡ `bugs/123` — И ТОТ ЖЕ ТАКТ ЛОЖИТСЯ НА ДИСК СРАЗУ. Кольцо в памяти объясняет ТРИП; смерть
      // машины без трипа оно не переживает вовсе, потому что процесс умирает вместе с памятью.
      // Три смерти 08.09 унесли с собой ровно ту улику, ради которой заведён предсказатель края.
      recordLive(tickRow);
      // ── СТРОКА ЖИЗНИ: накопление идёт ЗДЕСЬ ЖЕ, в такте, без второго таймера ──────────────────
      // Второй таймер — вторая сущность и второй источник расхождения: он способен жить, когда
      // такт уже встал, и написать «судья жив» про мёртвого судью. Накопитель едет на самом такте,
      // поэтому строка жизни физически не может пережить его остановку.
      if (aliveWindowEndMs === null) aliveWindowEndMs = startMs + ALIVE_WINDOW_MS;
      aliveTicks += 1;
      const gapNow = now - lastTickMs;
      if (gapNow > aliveWorstGap) aliveWorstGap = gapNow;
      if (verdict.beatSilenceMs !== null && (aliveWorstBeat === null || verdict.beatSilenceMs > aliveWorstBeat)) {
        aliveWorstBeat = verdict.beatSilenceMs;
      }
      if (verdict.progressSilenceMs !== null && (aliveWorstProgress === null || verdict.progressSilenceMs > aliveWorstProgress)) {
        aliveWorstProgress = verdict.progressSilenceMs;
      }
      if (lastPowerMw !== null && (aliveMinPowerMw === null || lastPowerMw < aliveMinPowerMw)) {
        aliveMinPowerMw = lastPowerMw;
      }
      if (now >= aliveWindowEndMs) {
        // ⚡ Ш3: ЧИСЛО ТАКТОВ ЗА ЗАКРЫВАЕМОЕ ОКНО СНИМАЕТСЯ ДО СБРОСА — `flushAlive` обнуляет
        // накопитель, и полуоткрытому окну мерить было бы уже нечего.
        const ticksThisWindow = aliveTicks;
        // ⚡ `bugs/121`: ХУДШИЙ РАЗРЫВ ЗАКРЫВАЕМОГО ОКНА СНИМАЕТСЯ ТОЙ ЖЕ СТРОКОЙ, ЧТО И ТАКТЫ —
        // `flushAlive` обнуляет и его, а решает теперь именно он.
        const worstGapThisWindow = aliveWorstGap;
        flushAlive(now, startMs);
        // Окно двигается ОТ ПРЕДЫДУЩЕЙ ГРАНИЦЫ, а не от `now`: иначе задержка такта накапливалась
        // бы в дрейф, и «строка в секунду» незаметно стала бы строкой в полторы.
        aliveWindowEndMs += ALIVE_WINDOW_MS;
        // Если судья проспал целые окна (система встала), не пишем строку за каждое пропущенное —
        // пустые строки не улика. Догоняем до ближайшей будущей границы, а сам факт проспанного
        // времени виден в `worstGapMs` следующей строки.
        let sleptWindows = 0;
        while (now >= aliveWindowEndMs) { aliveWindowEndMs += ALIVE_WINDOW_MS; sleptWindows += 1; }
        // ── ПОЛУОТКРЫТОЕ ОКНО: ОДНА ЗАКРЫТАЯ СЕКУНДА — ОДНО РЕШЕНИЕ НАКОПИТЕЛЯ ──────────────────
        // Считается только ЗАКРЫТОЕ окно строки жизни: огрызок между спасением и границей не
        // секунда, и мерить по нему такт значило бы делить на время, которого не было.
        if (halfOpen !== null) {
          // 🔴 ПРОСПАННЫЕ ГРАНИЦЫ ОБЕСЦЕНИВАЮТ ВСЮ ЗАКРЫТУЮ СТРОКУ, А НЕ ДОБАВЛЯЮТСЯ К НЕЙ.
          // `aliveTicks` считает такты ОТ ПРЕДЫДУЩЕГО СБРОСА, а не за секунду: замри машина на две
          // секунды — и такты, накопленные ДО заморозки, лягут в одну строку и прочитаются как
          // «здоровая секунда». Замершая машина оказалась бы ЗДОРОВЕЕ заикающейся, то есть окно
          // пропустило бы ровно тот случай, ради которого заведено.
          //
          // Порядок здесь и был первой ошибкой проводки: сброс стоял ПОСЛЕ решения `onPost`, и
          // блок «проспанное окно» покраснел на первом же прогоне — судья взвёлся, увидев 63 такта
          // за 2,3 секунды. Найдено блоком, а не рассуждением, и потому записано числом.
          halfOpen.state = halfOpenGate({
            ticksPerSec: sleptWindows > 0 ? 0 : ticksThisWindow,
            // Проспанные границы обесценивают строку целиком — тем же способом, что и раньше:
            // не «разрыв 16 мс», а «замера нет». Здоровьем это не считается.
            worstGapMs: sleptWindows > 0 ? Infinity : worstGapThisWindow,
            healthyNeeded: healthySeconds, healthyWorstGapMs, state: halfOpen.state,
          });
          if (halfOpen.state.onPost) {
            closeRescue(true, `машина доказала здоровье: ${halfOpen.state.healthySeconds} здоровых секунд подряд`, now, halfOpen.state);
          }
        }
      }
      // ⚡ СРОК ПОЛУОТКРЫТОГО ОКНА (`HALF_OPEN_DEADLINE_MS`) — ПРОВЕРЯЕТСЯ КАЖДЫМ ТАКТОМ, А НЕ ТОЛЬКО
      // НА ГРАНИЦЕ СЕКУНДЫ. Граница закрытой секунды — событие самого окна; если машина встала
      // НАСТОЛЬКО, что границы перестали приходить, проверка на границе не сработала бы никогда, и
      // срок молчал бы ровно в том случае, ради которого заведён.
      if (halfOpen !== null && now - halfOpen.sinceMs > halfOpenDeadlineMs) {
        closeRescue(false,
          `машина не доказала здоровье за ${Math.round(halfOpenDeadlineMs / 1000)} с: нужно `
          + `${healthySeconds} здоровых секунд подряд при разрыве такта ≤ ${healthyWorstGapMs} мс, набрано `
          + `${halfOpen.state?.healthySeconds ?? 0}`,
          now, halfOpen.state);
        return;
      }
      lastTickMs = now;
      // ⚡ `bugs/111`: ВЗВЕДЕНИЕ СЛУЧИЛОСЬ В ЭТОМ ЖЕ ТАКТЕ — СУДИТЬ НЕЧЕМ, ВЕРДИКТ ПРОТУХ.
      //
      // Он снят до `resetForRearm` и описывает состояние, которого уже нет: `lastProgressMs` и
      // `lastBeatMs` указывают в момент ДО спасения. Такт не «пропускается» — он ОТКЛАДЫВАЕТ
      // суждение на следующий, где вердикт снимется с состояния после взведения. Это не потеря
      // наблюдения: настоящий отказ никуда не денется за 60 мс, а вот эхо собственного спасения
      // существует ровно один такт.
      //
      // Строка стоит ПОСЛЕ `lastTickMs = now` и после кольца намеренно: сам такт состоялся и обязан
      // быть записан — иначе взведение оставляло бы в улике дыру ровно там, где её будут искать.
      if (rearmsDone !== rearmsAtTickStart) {
        tickTimer = setTimeout(tick, JUDGE_TICK_MS);
        return;
      }
      if (verdict.tripped && !tripOutcomes) {
        // The pidfile is read HERE, at the trip, never at judge start: the carrier of the fatal
        // burst is spawned long after the judge was, and a pid cached at start would name a corpse.
        const pidNow = burnPid ?? readBurnPidfile(burnPidFile);
        // ⚡ ВОРОТА ВХОДА 2: ПРОГРЕСС ЖДУТ ТОЛЬКО ОТ ИДУЩЕГО ПРОЖИГА (`plans/66`, оплачено замером).
        //
        // Между ступенями прожига нет — и прогрессу взяться неоткуда. Вход 1 этой дыры не имеет:
        // проба бьёт непрерывно, независимо от того, жжём мы сейчас или считаем. Первый же замер
        // ложных срабатываний поймал это на здоровом прогоне: `progress-stall` при тишине
        // 994,9 мс, удары при этом идеальны (0,87 мс), а рука 1 сама назвала причину — «no burn
        // pid — nothing to kill». Трип на пустом месте.
        //
        // Ворота стоят ЗДЕСЬ, а не в такте: обращение к диску — не дело такта судьи, он обязан
        // жить в памяти. Здесь оно случается не чаще одного раза за окно M, и только для
        // КАНДИДАТА в трип. Тишина, накопленная без прожига, не считается: таймер перезаводится.
        //
        // ПРИЗНАК — САМ ФАЙЛ СЕРДЦЕБИЕНИЯ, а не пид-файл, и это важно: пид-файл есть только у
        // двойника (на живом пути pid прожига заперт внутри `spawnSync`), и ворота на нём молча
        // выключили бы вход 2 там, где он и нужен. Файл же снимают ОБА — и `.cu`, и носитель.
        // 🔴 `bugs/117` ДЫРА 2, ОПЛАЧЕНА СИНИМ ЭКРАНОМ 2026-09-08: ЗДЕСЬ СТОЯЛО
        // `lastProgressMs = now`, И ЭТО ОБРЕЗÁЛО ИЗМЕРЯЕМУЮ ВЕЛИЧИНУ ЕЁ ЖЕ ПОРОГОМ.
        //
        // Отказывая в трипе, ворота ПЕРЕВОДИЛИ ЧАСЫ ВПЕРЁД. Тишина после этого начинала счёт
        // заново, снова доходила до M, снова упиралась в эти же ворота — и так по кругу. Итог,
        // замеренный на кольце инцидента: за 232 секунды МАКСИМУМ тишины 1179,58 мс при уставке
        // 1177 — семьдесят восемь пересечений и ни одного превышения больше чем на 2,6 мс.
        // Величина, которая физически не может вырасти выше своего порога, не различает НИЧЕГО:
        // пауза между ступенями (1,2 с) и мёртвый прожиг (9 с) выглядели одинаково, и в окне
        // смерти тишина простояла на 1177 девять секунд подряд, ничем не отличаясь от здоровой.
        //
        // ✅ ЧИНИТСЯ ИДИОМОЙ, КОТОРАЯ В ЭТОМ ЖЕ ФАЙЛЕ УЖЕ ЕСТЬ — `resetForRearm`: «источника нет»
        // ≠ «застыл» (R4c). Прожига нет ⇒ источник прогресса НЕ ПРОВЕДЁН, а не «молчит»:
        // `progressWired = false` честно гасит величину в `null`, и `judgeLiveness` перестаёт
        // считать её вовсе. Кольцо пишет `null` — то есть улику «здесь мерить было нечего»
        // вместо клипованного числа, которое врало все прошлые прогоны.
        //
        // ⚡ И ЭТО ЖЕ СНИМАЕТ ПРИЧИНУ, ПО КОТОРОЙ ЧАСЫ ВООБЩЕ КРУТИЛИ: обращение к диску не должно
        // случаться каждый такт. Погашенный источник больше не даёт кандидата в трип, поэтому
        // `burnInFlight()` не спрашивается до следующего удара `0x02` — то есть до старта
        // следующего прожига, который сам поднимет `progressWired` и заведёт часы с нуля.
        // ⚡ ВХОД 3 ПОД ТЕМИ ЖЕ ВОРОТАМИ, И ЭТО НЕ ПЕРЕСТРАХОВКА. На конце прожига мощность
        // законно падает к простою, а файл сердцебиения ещё может лежать долю секунды — трип по
        // такому падению был бы ложным ровно того класса, что уже оплачен на входе 2.
        // ⚡ `plans/93` Ш5: решение вынесено в `cancelsFalseTrip` — чистую функцию, которую батарея
        // судит настоящими числами трёх записей, а не пересказом. Единственная перемена поведения:
        // идущая выдержка провала ЗАПРЕЩАЕТ отмену (обвал предшествовал пропаже прожига — значит
        // прожиг умер, а не кончился). `bugs/126` AC4.
        // Диск спрашивается ЛЕНИВО и только у своих причин — путь `beat-silence` (самый срочный)
        // обращения к диску как не имел, так и не имеет.
        const burnGateCause = verdict.cause === 'progress-stall' || verdict.cause === 'power-collapse';
        if (burnGateCause && cancelsFalseTrip({
          cause: verdict.cause, burnAlive: burnInFlight(), lowSinceMs: lowPowerSinceMs,
        })) {
          lastProgressMs = null;
          progressWired = false;
          peakPowerMw = 0;
          lowPowerSinceMs = null;
          tickTimer = setTimeout(tick, JUDGE_TICK_MS);
          return;
        }
        tripOutcomes = runTrip({ verdict, burnPid: pidNow, burnImages, killHand, imageKillHand, stockHand, writeLine, dumpRing });
        tripsFired += 1;
        log(`⚡ ТРИП: ${verdict.cause} — тишина ${round2(verdict.beatSilenceMs ?? -1)} мс. Руки отработали: ${tripOutcomes.map((o) => `${o.action}=${o.ok}`).join(' · ')}`);
        // ⚡ Ш5 (`plans/81`): ЗДЕСЬ СТОЯЛ `resolve()` — «один трип кончает судью». Он и кончал вечер:
        // 31.08 первое живое срабатывание отработало безупречно и закрыло 0 из 20 частот. Заказ
        // владельца прямо обратный: *«чтобы предохранители не останавливали прогон, а спасали комп…
        // и чтобы прогон продолжался»*. Прежний довод («второй трип ударит по трупу») снят не
        // смелостью, а ПОРЯДКОМ: второго трипа не будет, пока рука 2 не подтвердит сток ЧТЕНИЕМ, —
        // то есть судья возвращается к работе на карте, про которую перечитано, что она заводская.
        // Отказ подтвердить — прежнее поведение целиком: выход, код 2, полоса встаёт.
        //
        // ✏️ ПЕРЕПИСАНО Ш3 (`plans/88` §4b(1)). ЗДЕСЬ СТОЯЛО: «дальше судья намеренно не тикает, и
        // дыру во времени объясняет ПАРА строк `intent` → `rearm`». Решение было ОСОЗНАННЫМ, и
        // отменяется оно тоже осознанно, а не обходится молча: на остановленном такте полуоткрытое
        // окно ждало бы такта, которого никто не производит, — стена, а не сторож (§4a). Такт идёт
        // ВЕСЬ рескью, и улика от этого только лучше: строка жизни покрывает и само спасение, а
        // пара `intent` → `rearm` никуда не девается (смерть машины во время спасения по-прежнему
        // читается по ней: `intent` есть, `rearm` нет). Огрызок окна строки жизни здесь больше НЕ
        // сбрасывается — его закрывает `openHalfOpen`, когда выравнивает границу.
        tripAtMs = now;
        awaitRearm(now);
        // `return` СНЯТ намеренно — он и был остановкой такта. Дальше по функции только дедлайн и
        // планирование следующего такта, и оба теперь обязаны работать посреди спасения.
        // Первый опрос расписки идёт СИНХРОННО и умеет закрыть спасение отказом здесь же (рука не
        // запустилась) — тогда судья уже кончился, и планировать ему такт нечего.
        if (stopped) return;
      }
      if (now >= endMs) {
        // Дедлайн вечера, застигший ОТКРЫТОЕ спасение, — это прежнее поведение (полоса встаёт), и
        // оно обязано быть записано как отказ: трип под судьёй так и не был закрыт. Раньше эту
        // ветку держал опрос расписки; теперь спасение может застать вечер и В ПОЛУОТКРЫТОМ окне —
        // машина, не выздоровевшая до конца окна судьи, оставляет его НЕПЕРЕВЗВЕДЁННЫМ (P88-AC4).
        if (tripAtMs !== null) {
          closeRescue(false, halfOpen === null
            ? 'окно судьи кончилось прежде расписки руки 2'
            : 'окно судьи кончилось прежде окна здоровья: машина не выздоровела', now, halfOpen?.state ?? null);
          return;
        }
        stopJudge();
        return;
      }
      tickTimer = setTimeout(tick, JUDGE_TICK_MS);
    };
    tickTimer = setTimeout(tick, JUDGE_TICK_MS);
  });

  if (!ringDumped) dumpRing(); // graceful close = step close: the black box lands either way
  closeLive();                 // `bugs/123`: непрерывная половина дожимается и закрывается тоже
  // Последнее окно строки жизни — только если в нём БЫЛИ такты. Пустая строка не улика, а шум,
  // и в разборе она читалась бы как «секунда прошла, судья молчал».
  if (aliveTicks > 0) flushAlive(performance.now(), startMs);
  if (aliveFd !== null) closeSync(aliveFd);
  closeSync(fd);
  sock.close();
  // ⚡ Ш5 (`plans/81`): `tripped` СМЕНИЛ СМЫСЛ, и это названо, а не сделано тихо.
  //
  // Было: «срабатывание случилось» — и оно же было последним событием жизни предохранителя, поэтому
  // одного поля хватало. Стало: срабатывание можно ПЕРЕЖИТЬ, и тогда полосу останавливать НЕЛЬЗЯ —
  // иначе весь шаг бессмыслен. Поэтому `tripped` теперь отвечает на вопрос вызывающего («обязана ли
  // полоса встать»), а сколько раз спасали и сколько раз пережили — отдельные счётчики.
  //
  // Различие видно в коде выхода: 2 отдаётся ТОЛЬКО за непережитое срабатывание.
  return {
    port: boundPort,
    beats,
    tripped: exitedUnRearmed,
    trips: tripsFired,
    rearms: rearmsDone,
    tripOutcomes,
    ringPath,
    liveRingPaths,   // `bugs/123`: две половины непрерывного чёрного ящика
  };
}

// =================================================================================================
// 3b. Gap analysis from the ring — the loaded floor's arithmetic (plans/56 step 2), pure
// =================================================================================================

/**
 * COMPLETED beat gaps from a ring timeline. The ring stores `beatSilenceMs` per judge tick — a
 * sawtooth that climbs during a gap and drops on each beat. The honest gap list is the sawtooth's
 * local maxima: the value on the tick JUST BEFORE each drop. A median over raw silences would
 * read ≈ gap/2 (every gap is sampled along its whole climb) — a books-balancing average this
 * function exists to refuse. The tail climb (never closed by a beat) is NOT a gap — an
 * unfinished measurement reported as one would be an invented number.
 *
 * Resolution honesty: gaps are sampled at the judge's tick, so every figure carries ±tick — the
 * caller prints the tick next to the numbers.
 */
export function gapsFromRing(rows) {
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].beatSilenceMs;
    const cur = rows[i].beatSilenceMs;
    if (prev !== null && cur !== null && cur < prev) gaps.push(prev);
  }
  return gaps;
}

/** median / p99 / max over a list — the three the floor prints, together (a median alone hides
 *  the one long stall, a max alone reads a hiccup as a way of life — `summarize`'s reasoning). */
export function distStats(xs) {
  if (xs.length === 0) return { n: 0, medianMs: null, p90Ms: null, p99Ms: null, maxMs: null };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  // ⚡ `bugs/128` AC3: p90 добавлен сюда, а не посчитан у сторожа. Ворота фазы объявлены В p90
  // (15,67 → 2,68 мс при цели ≤ 4), и вторая формула квантиля в проекте означала бы, что сторож
  // и объявление меряют РАЗНОЕ одним словом — тот самый класс `bugs/124`.
  return { n: s.length, medianMs: round2(at(0.5)), p90Ms: round2(at(0.9)), p99Ms: round2(at(0.99)), maxMs: round2(s[s.length - 1]) };
}

/**
 * ⚡ `bugs/128` AC3 — СТОРОЖ ПОЧИНЕННОГО ТАКТА, И ОН СТОРОЖИТ РЕГРЕСС, А НЕ ПОРОГ.
 *
 * Что случилось (сессии 92-93): судья, пущенный СКРЫТЫМ ОТСОЕДИНЁННЫМ процессом, попадал под
 * EcoQoS Windows 11, где `timeBeginPeriod(1)` принимается и МОЛЧА игнорируется; такт разваливался
 * с 2,2 до 15,4 мс на третьей секунде и не восстанавливался. Лекарство — `refuseTimerThrottling`
 * (`lib/timer-resolution.mjs`), и живой прогон 09.09 22:40 закрыл ворота: p90 = 2,68 мс.
 *
 * Порог — ВДВОЕ хуже объявленного, а не «около»: между 2,68 и 5,36 мс лежит вся разумная
 * изменчивость машины (фон, температура, чужой процесс), а сломанный прибор давал 15,3-15,7 мс,
 * то есть промахивался мимо порога в три раза. Сторож, поставленный впритык к 2,68, краснел бы на
 * шуме и был бы снят первым же, кто устал от ложных тревог, — и тогда регресс проехал бы молча.
 *
 * ⚠️ ЧЕГО ЭТОТ СТОРОЖ НЕ ДЕЛАЕТ: он не спрашивает у ядра, поднято ли разрешение таймера.
 * `NtQueryTimerResolution` печатал 0,5 мс НА КАЖДОЙ СЕКУНДЕ РАЗВАЛА — он читает разрешение
 * СИСТЕМЫ, а гасят его ПРОЦЕССУ. Свидетель здесь один: НАБЛЮДЁННЫЙ ЗАЗОР, величина, которую
 * гашение подделать не может.
 *
 * @param {Array<object>} rows строки кольца (поле `gapMs` — наблюдённый зазор такта)
 * @returns {{ p90Ms: number|null, ticks: number, ok: boolean, why: string }}
 */
export function tickHealthVerdict({ rows, declaredP90Ms = TICK_P90_DECLARED_MS, factor = TICK_P90_REGRESSION_FACTOR }) {
  const gaps = rows.map((x) => x.gapMs).filter((x) => typeof x === 'number' && Number.isFinite(x));
  const d = distStats(gaps);
  const limit = round2(declaredP90Ms * factor);
  if (d.n === 0) {
    return { p90Ms: null, ticks: 0, ok: false, why: '🔴 ТАКТ НЕ СУДИМ: в кольце нет ни одного зазора `gapMs`. Пустое кольцо — это не здоровый такт, а отсутствие свидетеля.' };
  }
  if (d.p90Ms > limit) {
    return { p90Ms: d.p90Ms, ticks: d.n, ok: false, why: `🔴 РЕГРЕСС ТАКТА (bugs/128 AC3): p90 ${d.p90Ms} мс при пороге ${limit} (вдвое от объявленных ${declaredP90Ms}). Медиана ${d.medianMs} · p99 ${d.p99Ms} · max ${d.maxMs}. Так выглядел прибор ДО починки (p90 15,67) — проверь, что процесс не пущен фоновым без refuseTimerThrottling.` };
  }
  return { p90Ms: d.p90Ms, ticks: d.n, ok: true, why: `🟢 ТАКТ ЗДОРОВ: p90 ${d.p90Ms} мс ≤ ${limit} (объявлено ${declaredP90Ms}, тактов ${d.n}).` };
}

// =================================================================================================
// 4. Jitter floor — the channel measured in the sender's REAL loop shape (plan step 1)
// =================================================================================================

async function cmdJitterFloor({ seconds, tickMs }) {
  const dgram = await import('node:dgram');
  const { spawn } = await import('node:child_process');
  console.log(`ПОЛ ДЖИТТЕРА КАНАЛА УДАРОВ: loopback-датаграммы · такт отправителя ${tickMs} мс · ${seconds} с`);
  // ⚠️ Здесь до 2026-08-29 стояло «ТОТ ЖЕ цикл, что у пробы сторожа (Atomics.wait)». Это перестало
  // быть правдой в тот же вечер, когда писалось: EXP-0165 перевёл и пробу с ударами, и её двойника
  // `--beat-sender` на УСТУПАЮЩИЙ сон (setTimeout) — блокированный цикл доставлял 12,72 % датаграмм.
  // Прибор спавнит именно `--beat-sender`, значит меряет уступающую форму. Класс `bugs/62`.
  console.log('Отправитель — ТОТ ЖЕ `--beat-sender`, что едет в прогоне (уступающий сон, EXP-0165): меряем реальность, не идеал.');

  const sock = dgram.createSocket('udp4');
  const gaps = [];
  let last = null; let got = 0;
  sock.on('message', () => {
    const now = performance.now();
    if (last !== null) gaps.push(now - last);
    last = now; got += 1;
  });
  await new Promise((res) => sock.bind({ address: '127.0.0.1', port: 0 }, res));
  const port = sock.address().port;

  const mm = loadWinmm();
  mm.begin(1);
  let child;
  try {
    const watchScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'death-watch.mjs');
    child = spawn(process.execPath, [watchScript, '--beat-sender', '--port', String(port), '--seconds', String(seconds), '--tick', String(tickMs)], { windowsHide: true, stdio: 'ignore' });
    await new Promise((res) => child.on('exit', res));
    await new Promise((res) => setTimeout(res, 200)); // let the last datagrams drain
  } finally { mm.end(1); try { child?.kill(); } catch { /* gone */ } }

  const sorted = [...gaps].sort((a, b) => a - b);
  const q = (p) => sorted.length === 0 ? null : round2(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]);
  const expected = Math.floor((seconds * 1000) / tickMs);
  console.log(`\nотправлено ~${expected} · получено ${got} (${round2((got / expected) * 100)} %)`);
  console.log(`зазор прихода: медиана ${q(0.5)} мс · p99 ${q(0.99)} мс · max ${round2(sorted[sorted.length - 1] ?? -1)} мс`);
  console.log('Числа переносятся в шапку fuse.mjs — N фазы 3 обязан быть кратно выше max.');
  sock.close();
  return got > 0 ? 0 : 1;
}

// koffi rides CommonJS — `createRequire`, not a bare import: the death watch paid an EXP receipt
// for require-vs-import mixups on exactly this dll pair (its own header notes the first floor run).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// 🔴 `bugs/128`: определение УЕХАЛО в `timer-resolution.mjs` и там же вылечено. Здесь стояла
// вторая копия той же пары (первая — в `death-watch.mjs`), и лекарство пришлось бы держать в
// обеих. Форма `{ begin, end }` сохранена, поэтому места вызова не тронуты.
// Импорт — вверху файла, рядом с остальными.

// =================================================================================================
// 4b. Loaded floor — the REAL rig: unarmed judge + live probe, load started by the operator
// =================================================================================================

/**
 * ⚡ `plans/94` Ш4 — ВОРОТА ЗАСЧИТЫВАНИЯ ЗАПИСИ, И ОНИ МАШИННЫЕ, А НЕ В ГОЛОВЕ ОПЕРАТОРА.
 *
 * Запись фазы 6б-бис существует ради РАСПРЕДЕЛЕНИЯ доли мощности (`P94-AC4`), а доля считается
 * только при проведённом входе 2: `stepPowerWindow` держит `peakMw = 0`, пока `progressWired`
 * погашен, и кольцо получает `powerRatio: null` от первой строки до последней. Прогон 09.09 22:40
 * прошёл ровно так — 90 секунд, 41 259 тактов, НОЛЬ эпизодов, и понято это было ПОСЛЕ прогона.
 *
 * Поэтому стенд печатает не «прогон кончился», а ЗАСЧИТАНА ли запись, и отдаёт код 3: «отработал,
 * но материала нет» — это ни успех (0), ни отказ прибора (1).
 *
 * Функция отдельная и чистая ровно потому, что решение «засчитано» дороже прогона, которым оно
 * получено: внутри `cmdLoadedFloor` его нельзя было бы накрыть блоком, не подняв судью и NVML, —
 * то есть непроверяемым осталось бы единственное место, ради которого шаг и делается (класс
 * `bugs/101`: строка жила у `spawn`, и ни один блок её не видел).
 *
 * @param {Array<object>} rows         строки кольца
 * @param {string|null}   progressFile проведённый файл сердцебиения (null — вход 2 не проводили)
 * @returns {{ wired: number, withRatio: number, counted: boolean, why: string }}
 */
export function recordVerdict({ rows, progressFile }) {
  const live = (v) => v !== null && v !== undefined;
  const wired = rows.filter((x) => live(x.progressSilenceMs)).length;
  const withRatio = rows.filter((x) => live(x.powerRatio)).length;
  if (!progressFile) {
    return { wired, withRatio, counted: false, why: '🟡 ЗАПИСЬ НЕ ЗАСЧИТАНА ЗА ФАЗУ 6б-бис: стенд пущен БЕЗ `--progress-file`. Как замер ПОЛА ТАКТА прогон полноценен, как одна из трёх записей — нет.' };
  }
  if (wired === 0) {
    return { wired, withRatio, counted: false, why: '🔴 ЗАПИСЬ НЕ ЗАСЧИТАНА: провод входа 2 не ожил НИ РАЗУ. Файл сердцебиения провели, но его никто не трогал — горн запущен БЕЗ `--progress-file` либо не запускался вовсе. Материала для распределения P94-AC4 здесь нет.' };
  }
  // Провод и ДОЛЯ судятся порознь, хотя после правки Ш4 второе следует из первого. Проверяется
  // именно та величина, которую заказывает `P94-AC4`: живой провод при нулевой доле означал бы,
  // что доля перестала считаться по какой-то ТРЕТЬЕЙ причине, и запись снова пуста — но уже
  // незаметно, потому что провод зелен.
  if (withRatio === 0) {
    return { wired, withRatio, counted: false, why: `🔴 ЗАПИСЬ НЕ ЗАСЧИТАНА: провод входа 2 оживал (${wired} строк), а доля мощности не посчитана НИ РАЗУ. Это не тот отказ, что немой провод, — ищи причину в самом суждении, а не в горне.` };
  }
  return { wired, withRatio, counted: true, why: `🟢 ЗАПИСЬ ЗАСЧИТАНА: вход 2 оживал (${wired} строк), доля мощности считалась в ${withRatio}.` };
}

/**
 * Phase 3's measurement (`plans/56` шаги 2, 4): the judge runs UNARMED in this process, the live
 * probe (`death-watch --probe`) rides as a child on this judge's port, and the OPERATOR starts the
 * load in another window when told — the rig measures beat gaps exactly as the armed fuse will see
 * them. Artifacts land in the real `runs/death-watch/` deliberately: this is a genuine floor
 * measurement, the same standing the phase-1 night floor files have — NOT a rehearsal (rehearsals
 * take `--judge --out` into a sandbox).
 */
async function cmdLoadedFloor({ seconds, tickMs, progressFile = null, burnSeconds = 0, burnAfterSeconds = 15, wantWindow = true }) {
  const { spawn, spawnSync } = await import('node:child_process');
  const dash = await import('./run-dashboard.mjs');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const journalPath = path.join(FUSE_DIR, `${stamp}-loaded-floor.jsonl`);
  console.log(`ПОЛ ПОД НАГРУЗКОЙ: судья unarmed · такт ${JUDGE_TICK_MS} мс · ${seconds} с · проба живая (NVML, чтение)`);
  console.log(progressFile
    ? `ВХОД 2 ПРОВЕДЁН: файл сердцебиения ${progressFile} — доля мощности будет считаться.`
    : 'ВХОД 2 НЕ ПРОВЕДЁН (нет --progress-file): доля мощности останется null весь прогон — стенд годится для ПОЛА ТАКТА, но НЕ для записи фазы 6б-бис.');

  const mm = loadWinmm(); mm.begin(1);
  // Ссылки, нужные гасителю: он зовётся и из `process.on('exit')`, где `await import` уже поздно.
  const spawnSyncRef = spawnSync;
  const dashScriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-dashboard.mjs');
  let probe = null;
  let burn = null;
  let dashProc = null;
  let sampler = null;
  let pulse = null;
  let pulseTimer = null;
  let burnTimer = null;

  /**
   * ⚡ ОКНО ЖИВЁТ РОВНО СТОЛЬКО, СКОЛЬКО ПРОГОН — ТРЕБОВАНИЕ ВЛАДЕЛЬЦА 2026-09-09, ДОСЛОВНО:
   * *«Запускается прогон — он открывает окно визуализатора. Нет прогона — нет окна визуализатора.
   * Есть прогон — есть окно визуализатора»*.
   *
   * Оплачено накануне: я поднял окно РУКАМИ при отсутствующем прогоне, и оно показало пустоту —
   * *«ну так закрой визуализатор, если нет прогона !!!!!!!!!!!!!»*. Окно, пережившее свой прогон,
   * это `bugs/04`: застывшая картинка того, чего уже не происходит.
   *
   * Гасится на ЛЮБОМ выходе, а не только на предусмотренном: на Windows дочерний процесс НЕ
   * умирает вместе с родителем, поэтому `finally` (возврат и исключение), `exit` (в том числе
   * чужой `process.exit`) и сигналы — три слоя, тот же приём, что у развёртки в `engine.mjs`.
   */
  const stopSideCars = () => {
    if (pulseTimer !== null) { clearInterval(pulseTimer); pulseTimer = null; }
    if (burnTimer !== null) { clearTimeout(burnTimer); burnTimer = null; }
    // 🔴 ОКНО ГАСИТСЯ ЕГО СОБСТВЕННОЙ КОМАНДОЙ, А НЕ `kill()` — ЗАМЕРЕНО, А НЕ ПРЕДПОЛОЖЕНО.
    //
    // Первая проба этого стенда (09.09, 12 с): сервер на 7311 умер, а ОКНО БРАУЗЕРА ОСТАЛОСЬ —
    // два процесса `msedge` с адресом окна пережили прогон. Причина: на Windows `child.kill()`
    // это `TerminateProcess`, процесс не получает шанса отработать свой `exit`, а закрывает окно
    // именно он. То есть механика «окно умирает вместе с прогоном» существовала только в
    // намерении. Владелец бы увидел ровно то, на что жаловался накануне.
    //
    // `--close` гасит ОБЕ половины (окно и сервер) и написан ровно для этого. Синхронный вызов
    // законен и в `process.on('exit')`, где асинхронному уже нечем работать.
    if (dashProc) {
      try {
        spawnSyncRef(process.execPath, [dashScriptPath, '--close'], { windowsHide: true, stdio: 'ignore', timeout: 8000 });
      } catch { /* гасим дальше руками */ }
    }
    for (const child of [burn, probe, sampler, dashProc]) {
      if (child) { try { child.kill(); } catch { /* уже вышел */ } }
    }
    burn = null; probe = null; sampler = null; dashProc = null;
  };
  process.on('exit', stopSideCars);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { stopSideCars(); process.exit(130); });
  }

  try {
    const watchScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'death-watch.mjs');
    const monScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hardware-mon.mjs');

    // ── ОКНО НАБЛЮДЕНИЯ: УСЛОВИЕ ПРОГОНА, А НЕ УКРАШЕНИЕ ────────────────────────────────────────
    if (wantWindow) {
      // Телеметрия карты приходит от ОТДЕЛЬНОГО сэмплера, и это не выбор стиля: судья занят своим
      // тактом, а показания карты нужны раз в секунду — тот же довод и тот же сэмплер, что у
      // развёртки (`bugs/27`: занятый процесс не отдаёт ни HTTP, ни SSE, ни собственных проб).
      try {
        const mon = await import('./hardware-mon.mjs');
        const archived = mon.archivePulseFile(dash.TELEMETRY_PATH);
        console.log(archived.archived
          ? `ТЕЛЕМЕТРИЯ ПРОШЛОГО ПРОГОНА: убрана в ${archived.to} — не затёрта`
          : `ТЕЛЕМЕТРИЯ ПРОШЛОГО ПРОГОНА: ${archived.why}`);
      } catch (e) { console.log(`ТЕЛЕМЕТРИЯ ПРОШЛОГО ПРОГОНА: не убрана (${e.message}) — сэмплер всё равно начнёт файл заново`); }
      sampler = spawn(process.execPath, [monScript, '--seconds', String(seconds + 30), '--period', '1000', '--out', dash.TELEMETRY_PATH],
        { windowsHide: true, stdio: 'ignore' });
      sampler.unref?.();

      // Пульс открывается ДО окна, чтобы открывшееся окно показало «поднимаемся», а не пустоту.
      pulse = dash.openPulse({
        source: burnSeconds > 0 ? `запись такта под горном · ${burnSeconds} с нагрузки` : 'пол такта под наблюдением',
        band: '',
        probeSeconds: burnSeconds > 0 ? burnSeconds : seconds,
      });

      dashProc = spawn(process.execPath, [dashScriptPath, '--port', String(dash.DEFAULT_PORT)],
        { windowsHide: true, stdio: 'ignore' });
      dashProc.unref?.();
      const seen = await dash.waitForViewer(dash.DEFAULT_PORT);
      const watch = await dash.viewersWatching({ port: dash.DEFAULT_PORT });
      if (!seen || !watch.ok || watch.viewers < 1) {
        console.error('ОТКАЗ: ОКНО НАБЛЮДЕНИЯ НЕ ОТКРЫЛОСЬ, а прогон без окна запрещён владельцем.');
        console.error(`       ${watch?.why ?? 'зритель не появился'}`);
        console.error('       Слово владельца 2026-09-09: «Есть прогон — есть окно визуализатора».');
        console.error('       ЧТО СДЕЛАТЬ: `npm run dashboard` руками и посмотреть, на чём он встанет.');
        return 2;
      }
      console.log(`ОКНО НАБЛЮДЕНИЯ: открыто, смотрящих ${watch.viewers} — условие прогона выполнено.`);

      // Пульс обязан ДЫШАТЬ: страница меряет молчание от отметки внутри записи, и прогон,
      // не написавший ни строки за 90 секунд, выглядел бы на ней ЗАМЕРШИМ — то есть прибор
      // докладывал бы о зависании там, где всё в порядке (`bugs/14`, дважды оплачено).
      // Раз в секунду, а не в такте: диск в такте судьи запрещён с фазы 2.
      pulseTimer = setInterval(() => { try { pulse.write(); } catch { /* окно дешевле прогона */ } }, 1000);
      pulseTimer.unref?.();
    } else {
      console.log('ОКНО НАБЛЮДЕНИЯ: не поднимается (--no-window) — прогон не считается записью фазы.');
    }
    const r = await runJudge({
      beatPort: 0, armNMs: null, armMMs: null, burnPid: null,
      // ⚡ `plans/94` Ш4: СТЕНД ОБЯЗАН ПРОВОДИТЬ ВХОД 2, ИНАЧЕ ЗАПИСЬ ПУСТА. Судья сам файл не
      // читает — он спрашивает лишь о его СУЩЕСТВОВАНИИ (`burnInFlight`); поднимает
      // `progressWired` удар `0x02` от пробы. Поэтому файл идёт В ОБА: сюда и в строку пробы ниже.
      progressFile,
      journalPath, seconds,
      // The ring must cover the WHOLE run: the default 30-second cap silently drops the loaded
      // window's head on a 90-second floor (paid on run 1: 15 000 ticks kept, load at t≈12-72
      // partly outside). Slack on top for late-wake catch-ups.
      ringCapacity: Math.ceil((seconds * 1000) / JUDGE_TICK_MS) + 2000,
      spawnSyncFn: spawnSync, spawnFn: spawn, log: console.log,
      onReady: ({ port }) => {
        probe = spawn(process.execPath, [watchScript, '--probe', '--port', String(port), '--seconds', String(seconds), '--tick', String(tickMs),
          // ⚡ DRY: строку пробы собирает ТА ЖЕ функция, что и на живом пути (`progressRiderArgs`).
          // Вторая копия «`--progress-file`, путь» здесь была бы ровно парой из `bugs/101`.
          ...progressRiderArgs({ progressFile }).probe], { windowsHide: true, stdio: 'inherit' });
        console.log(`ПРОБА: pid ${probe.pid}, удары на порт ${port}${progressFile ? ' · ретранслятор прогресса включён' : ''}.`);
        // ⚡ ГОРН ЗАПУСКАЕТ САМ СТЕНД — ОДНО ДЕЙСТВИЕ, А НЕ ДВА ОКНА И РИТУАЛ.
        //
        // Здесь стояла метка `LOAD-NOW`: стенд печатал команду, а нагрузку набирал руками оператор
        // во втором окне. Владелец 2026-09-09: *«LOAD-NOW — не понимаю, о чём ты»*, и он прав —
        // это машинерия, протёкшая наружу. Оператор, набирающий команду руками, к тому же способен
        // потерять `--progress-file` и дать немую запись; стенд, запускающий горн сам, не способен.
        if (burnSeconds > 0) {
          burnTimer = setTimeout(() => {
            const furnace = path.join(fileURLToPath(new URL('../../workloads/', import.meta.url)), 'furnace.exe');
            const args = ['2400', '8192', '256', '64', '--sustain', String(burnSeconds),
              ...(progressFile ? ['--progress-file', progressFile] : [])];
            burn = spawn(furnace, args, { windowsHide: true, stdio: 'ignore' });
            console.log(`ГОРН: pid ${burn.pid} · ${burnSeconds} с нагрузки${progressFile ? ' · сердцебиение прогресса пишется' : ''}`);
            // Состояние на экране называется ТЕМ, что происходит: под нагрузкой — стресс-тест,
            // после неё — закрытие. Иначе окно показывало бы «поднимаемся» все девяносто секунд.
            pulse?.event({ kind: 'rung-start', text: `горн ${burnSeconds} с` });
            burn.on('exit', (code) => {
              console.log(`ГОРН ЗАКОНЧИЛ: код ${code}`);
              burn = null;
              pulse?.event({ kind: 'rung', text: 'горн отработал' });
            });
          }, burnAfterSeconds * 1000);
        } else {
          console.log('ГОРН: не запускается (--burn 0) — прогон идёт БЕЗ нагрузки.');
        }
      },
    });
    const { readFileSync } = await import('node:fs');
    const rows = readFileSync(r.ringPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const gaps = distStats(gapsFromRing(rows));
    const ticks = distStats(rows.map((x) => x.gapMs).filter((x) => x !== undefined));
    const expected = Math.floor((seconds * 1000) / 2);
    console.log(`\nударов ${r.beats} из ~${expected} (${round2((r.beats / expected) * 100)} %) · тактов судьи в кольце ${rows.length}`);
    console.log(`ЗАЗОРЫ УДАРОВ (±${JUDGE_TICK_MS} мс такта): закрытых ${gaps.n} · медиана ${gaps.medianMs} мс · p99 ${gaps.p99Ms} мс · max ${gaps.maxMs} мс`);
    console.log(`такт самого судьи: медиана ${ticks.medianMs} мс · p90 ${ticks.p90Ms} мс · p99 ${ticks.p99Ms} мс · max ${ticks.maxMs} мс`);
    // ⚡ `bugs/128` AC3: сторож такта стоит и ЗДЕСЬ, а не только в батарее. Батарея судит фикстуру
    // и ловит регресс кода; живая запись судится собственным кольцом и ловит регресс СРЕДЫ —
    // фоновый запуск, чужой процесс, вернувшийся EcoQoS. Числа те же, источник разный.
    const tickHealth = tickHealthVerdict({ rows });
    console.log(tickHealth.why);
    console.log(`кольцо: ${r.ringPath}`);
    console.log('N выводится ТОЛЬКО из прогона С НАГРУЗКОЙ: N = k × max, k ≥ 5, и N ≤ 302 мс (десятая предвестника 3042 мс).');
    const verdict = recordVerdict({ rows, progressFile });
    console.log(`ВХОД 2 В КОЛЬЦЕ: строк с живым прогрессом ${verdict.wired} из ${rows.length} · строк с посчитанной долей мощности ${verdict.withRatio}`);
    console.log(verdict.why);
    // Такт и провод судятся ОТДЕЛЬНО и оба обязаны быть зелёными: запись с немым входом 2 не несёт
    // материала, а запись на разваленном такте несёт материал, измеренный сломанным прибором, —
    // и второе опаснее первого, потому что выглядит полноценным.
    if (!tickHealth.ok) {
      console.log('🔴 ЗАПИСЬ НЕ ЗАСЧИТАНА: такт судьи хуже объявленного вдвое — числа этой записи сняты сломанным прибором.');
      return 3;
    }
    return verdict.counted ? 0 : 3;
  } finally {
    mm.end(1);
    // Пульс закрывается ПЕРЕД гашением окна: страница держит завершённый прогон минуту, и это
    // единственная возможность оператора прочитать, чем всё кончилось. Закрытый прогон не выглядит
    // зависшим — ровно ради этого различения `finish` и существует.
    try { pulse?.finish({ ok: true, why: 'запись закончена' }); } catch { /* окно дешевле прогона */ }
    stopSideCars();
  }
}

// =================================================================================================
// 5. Selftest — fixtures only; the ONLY port it may bind is 0 (ephemeral, loopback)
// =================================================================================================

async function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('САМОПРОВЕРКА fuse — deadman-судья, руки, кольцо; карта не трогается, порт только эфемерный');
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона: включительная граница N · невзведённый не трипает · '
    + 'непроведённый прогресс не трипает · порядок рук · намерение раньше рук · кольцо переживает трип · судья слышит настоящие удары · '
    + 'пид-файл читается В МОМЕНТ трипа · рука 2 двойника несёт --twin · '
    + 'граница «спасено ↔ преждевременно» по счёту остановов · порог счёта остановов 10 мс');

  // ── plans/88 Ш1 — ПОЛУОТКРЫТОЕ ОКНО: судья встаёт на пост, ДОКАЗАВ здоровье, а не по расписке ──
  // Сторожа написаны ДО функции и обязаны краснеть на пустом месте. Замер, из которого взяты числа,
  // — `researches/33` §4b: здоровый такт 356…442/с, больной 4…261/с, пустой разрыв 95 тактов, и ни
  // одной из 716 секунд внутри него; уставка 300 стоит В РАЗРЫВЕ (любая от 262 до 355 даст то же
  // разбиение). Длина окна: шесть непрерывных больных эпизодов, здоровых секунд внутри — НОЛЬ.
  // 🔴 `bugs/121`: ВСЯ ЭТА ПРИЁМКА ПЕРЕВЕДЕНА С ЧИСЛА ТАКТОВ НА РАЗРЫВ ТАКТА. Числа ниже — из
  // строк жизни на диске: здоров при прожиге 3,2…6,1 мс · здоров БЕЗ прожига 16,1…23,9 мс ·
  // секунда смерти 452 мс · больные 07.09 475…712 мс. Уставка 60 мс стоит в разрыве 24…452.
  const gateSeq = (gapSeq, needed = REARM_HEALTHY_SECONDS) => {
    let st = null; const armedAt = [];
    gapSeq.forEach((g, i) => {
      st = halfOpenGate({ worstGapMs: g, healthyNeeded: needed, state: st });
      if (st.onPost) armedAt.push(i);
    });
    return { armedAt, healthy: st?.healthySeconds ?? null };
  };
  ok('P88-AC1: три здоровые секунды подряд ставят судью на пост — и ровно на третьей, не раньше',
    JSON.stringify(gateSeq([4.2, 4.2, 4.2, 4.2]).armedAt) === JSON.stringify([2, 3]));
  ok('P88-AC1: больная секунда посреди — пост занимается позже ровно на её цену',
    JSON.stringify(gateSeq([4.2, 452, 4.2, 4.2, 4.2]).armedAt) === JSON.stringify([4]));
  ok('P88-AC2: одна больная СБРАСЫВАЕТ накопление в ноль, а не уменьшает на единицу',
    JSON.stringify(gateSeq([4.2, 4.2, 452, 4.2, 4.2]).armedAt) === JSON.stringify([]));
  ok('P88-AC2: накопитель после сброса считает с нуля (счёт виден числом, а не выводится)',
    gateSeq([4.2, 4.2, 452, 4.2]).healthy === 1);
  ok('P88-AC1: больная машина не встаёт на пост НИКОГДА, сколько бы секунд ни прошло',
    JSON.stringify(gateSeq([452, 500.71, 475.47, 618.57, 680.97, 711.78]).armedAt) === JSON.stringify([]));
  ok('🔴 bugs/121 — РАДИ ЧЕГО ВСЁ: ЗДОРОВАЯ МАШИНА БЕЗ ПРОЖИГА ВСТАЁТ НА ПОСТ. Ровно те 35 секунд '
    + 'живого пути 08.09, которые уставка 300 тактов/с прочитала как больные',
    JSON.stringify(gateSeq([16.37, 19.7, 16.11, 16.33, 16.35]).armedAt) === JSON.stringify([2, 3, 4]));
  ok('bugs/121: и САМАЯ ХУДШАЯ из тех 35 секунд (23,93 мс) — тоже здоровая, а не «на грани»',
    JSON.stringify(gateSeq([23.93, 23.93, 23.93]).armedAt) === JSON.stringify([2]));
  ok('P88-AC1: уставка — ГРАНИЦА ВКЛЮЧИТЕЛЬНАЯ, ровно 60 мс уже здоровье (канон classifyTick)',
    JSON.stringify(gateSeq([60, 60, 60]).armedAt) === JSON.stringify([2]));
  ok('P88-AC1: 60,01 мс — больная секунда (сторож на самой границе, оба берега)',
    JSON.stringify(gateSeq([60.01, 60.01, 60.01]).armedAt) === JSON.stringify([]));
  ok('bugs/121: ОТСУТСТВУЮЩИЙ замер разрыва — НЕ здоровье (проспанное окно ничего не доказало)',
    JSON.stringify(gateSeq([4.2, 4.2, Infinity, 4.2, 4.2]).armedAt) === JSON.stringify([])
    && JSON.stringify(gateSeq([null, null, null]).armedAt) === JSON.stringify([]));
  ok('P88-AC8 МУТАЦИЯ: окно в ОДНУ секунду ставит на пост немедленно — сторож AC1 умеет краснеть',
    JSON.stringify(gateSeq([4.2, 4.2, 4.2], 1).armedAt) === JSON.stringify([0, 1, 2]));
  ok('🔴 bugs/121 МУТАЦИЯ: ВЕРНИ ПРОБУ НА ЧИСЛО ТАКТОВ — и здоровые 35 секунд снова станут больными',
    (() => {
      // Прежняя проба, дословно: ticksPerSec ≥ 300. Кормим ЗАМЕРЕННЫМ тактом тех же секунд.
      let st = null; const armed = [];
      [86, 105, 94, 84, 97].forEach((t, i) => {
        const healthy = t >= JUDGE_HEALTHY_TICKS_PER_SEC;
        st = { healthySeconds: healthy ? (st?.healthySeconds ?? 0) + 1 : 0 };
        if (st.healthySeconds >= REARM_HEALTHY_SECONDS) armed.push(i);
      });
      return armed.length === 0;   // стена: пост не занят НИ РАЗУ — то, что случилось 08.09
    })());
  ok('plans/88 + bugs/121: уставки названы ОДНИМ местом, и решающая — та же, что у сторожа тишины',
    JUDGE_HEALTHY_WORST_GAP_MS === DERIVED_ARM_N_MS && REARM_HEALTHY_SECONDS === 3);

  // ---- judgeLiveness: the deadman core (P55-AC1)
  ok('тишина РОВНО N — трип (граница включительная, канон classifyTick)',
    judgeLiveness({ nowMs: 1050, lastBeatMs: 1000, armNMs: 50 }).tripped === true
    && judgeLiveness({ nowMs: 1049.99, lastBeatMs: 1000, armNMs: 50 }).tripped === false);

  ok('удары идут — сброса таймера достаточно, трипа нет', (() => {
    const v = judgeLiveness({ nowMs: 1002, lastBeatMs: 1001, armNMs: 50 });
    return !v.tripped && v.beatSilenceMs === 1;
  })());

  ok('НЕ ВЗВЕДЁН (N=null) — никогда не трипает, даже при вечной тишине: наблюдение, не выдуманный порог',
    judgeLiveness({ nowMs: 99999, lastBeatMs: 0, armNMs: null }).tripped === false);

  ok('до первого удара трипа нет — «ещё не слышал» ≠ «замолчал»',
    judgeLiveness({ nowMs: 99999, lastBeatMs: null, armNMs: 50 }).tripped === false);

  // ---- input 2: progress (P55-AC2)
  ok('прогресс встал при ЖИВОЙ пробе — трип по progress-stall (вход 2 независим)', (() => {
    const v = judgeLiveness({ nowMs: 2000, lastBeatMs: 1999, armNMs: 50, lastProgressMs: 1000, armMMs: 500, progressWired: true });
    return v.tripped && v.cause === 'progress-stall';
  })());

  ok('НЕПРОВЕДЁННЫЙ прогресс (progressWired=false) не трипает — «отсутствует» ≠ «застыл» (EXP-0112)',
    judgeLiveness({ nowMs: 2000, lastBeatMs: 1999, armNMs: 50, lastProgressMs: 1000, armMMs: 500, progressWired: false }).tripped === false);

  ok('обе тишины сразу — побеждает beat-silence: более специфичный факт о КАРТЕ', (() => {
    const v = judgeLiveness({ nowMs: 5000, lastBeatMs: 0, armNMs: 50, lastProgressMs: 0, armMMs: 500, progressWired: true });
    return v.tripped && v.cause === 'beat-silence';
  })());

  // ---- decideRescue: the hands and their order (P55-AC1)
  ok('рук всегда две и порядок ЖЁСТКИЙ: сперва нагрузка (без драйвера), потом завод (через драйвер)', (() => {
    const r = decideRescue({ cause: 'beat-silence' });
    return r.length === 2 && r[0].action === 'kill-burn' && !r[0].needsDriver && r[1].action === 'stock-voltage' && r[1].needsDriver;
  })());

  ok('причина не переставляет руки: progress-stall — тот же порядок', (() => {
    const r = decideRescue({ cause: 'progress-stall' });
    return r[0].action === 'kill-burn' && r[1].action === 'stock-voltage';
  })());

  // ---- runTrip: intent BEFORE hands, outcomes after (P55-AC3), injected hands (P55-AC4 targets)
  {
    const lines = []; const calls = [];
    const outcomes = runTrip({
      verdict: { cause: 'beat-silence', beatSilenceMs: 61.2, progressSilenceMs: null },
      burnPid: 4242,
      killHand: (pid) => { calls.push(`kill:${pid}`); return { ok: true, ms: 3.1, detail: null }; },
      stockHand: () => { calls.push('stock'); return { ok: true, ms: 8.7, detail: 'pid 555' }; },
      writeLine: (l) => lines.push(JSON.parse(l)),
      dumpRing: () => calls.push('dump'),
    });
    ok('намерение пишется РАНЬШЕ любых рук — спасение, умершее на полпути, оставляет улику',
      lines[0]?.phase === 'intent' && calls[0] === 'kill:4242');
    ok('исходы обеих рук записаны, порядок в журнале совпадает с порядком исполнения',
      lines.length === 3 && lines[1].hand === 1 && lines[1].action === 'kill-burn' && lines[2].hand === 2 && lines[2].action === 'stock-voltage');
    ok('кольцо сброшено ПОСЛЕ рук (руки быстрее, форензика не задерживает спасение)',
      calls[calls.length - 1] === 'dump' && outcomes.length === 2);
    ok('нет pid прожига — рука 1 честно «нечего убивать», рука 2 ВСЁ РАВНО идёт (удушение переживает свой горн)', (() => {
      const ls = []; const cs = [];
      runTrip({
        verdict: { cause: 'beat-silence', beatSilenceMs: 70, progressSilenceMs: null }, burnPid: null,
        killHand: () => { cs.push('kill'); return { ok: true, ms: 1, detail: null }; },
        stockHand: () => { cs.push('stock'); return { ok: true, ms: 1, detail: null }; },
        writeLine: (l) => ls.push(JSON.parse(l)), dumpRing: () => {},
      });
      return !cs.includes('kill') && cs.includes('stock') && ls[1].ok === null;
    })());
  }

  // 🔴 `bugs/102` — ПЕСОЧНИЦА ФИКСТУРЫ ОБЯЗАНА БЫТЬ СВЕЖЕЙ, И ЭТО СТОРОЖИТСЯ, А НЕ ПОМНИТСЯ.
  //
  // ДИАГНОЗ, ПОЛУЧЕННЫЙ ОПЫТОМ 2026-09-05, а не рассуждением. Набор `fuse` трижды за четыре сессии
  // краснел ВНУТРИ батареи и был зелен, запущенный отдельно (сессии 75, 81, 82). Улика сессии 82
  // назвала две красные строки; обе читают ФАЙЛ журнала, а соседний блок, читающий ВОЗВРАЩЁННОЕ
  // значение, оставался зелёным. Проба воспроизвела это точно: положи в журнал одну строку от
  // «прошлого прогона» — и получишь ровно ту картину, строка в строку.
  //
  // ПОЧЕМУ ОСТАТОК ВООБЩЕ БЫЛ ВОЗМОЖЕН: девять фикстур звали песочницу по `process.pid`, судья
  // открывает журнал на ДОПИСЫВАНИЕ, а Windows номера процессов переиспользует. Батарея запускает
  // сорок с лишним процессов подряд — там совпадение много вероятнее, чем у набора, запущенного в
  // одиночку минутой позже. Отсюда и «красный в батарее, зелёный отдельно», и невоспроизводимость.
  //
  // Гипотеза тикета (подстой хоста дольше 60 мс) ОПРОВЕРГНУТА: она не объясняла, почему зелен
  // именно тот блок, что не читает файл.
  ok('bugs/102: песочницы фикстур свежие — ни одна не названа по pid (тот же pid = чужой журнал)', (() => {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    // Ищем ИМЕНОВАНИЕ временного пути номером процесса. Исключений нет намеренно: правило без
    // исключений сторожится одной строкой, а правило с оговоркой требует помнить оговорку.
    const bad = [...src.matchAll(/tmpdir\(\)[^\n]*process\.pid/gu)].map((m) => m[0].trim());
    return bad.length === 0;
  })(), 'песочницы, названные по pid, всё ещё есть — остаток чужого прогона снова покрасит батарею');

  // ---- the ring (P55-AC5)
  ok('кольцо: до заполнения отдаёт всё по порядку', (() => {
    const r = makeRing(4); pushRing(r, 1); pushRing(r, 2); pushRing(r, 3);
    return JSON.stringify(drainRing(r)) === '[1,2,3]';
  })());
  ok('кольцо: переполнение выталкивает СТАРЕЙШЕЕ, порядок старое→новое сохранён', (() => {
    const r = makeRing(3); [1, 2, 3, 4, 5].forEach((x) => pushRing(r, x));
    return JSON.stringify(drainRing(r)) === '[3,4,5]';
  })());
  ok('кольцо: ёмкость не растёт — форензика не смеет искажать процесс, на котором едет', (() => {
    const r = makeRing(3); for (let i = 0; i < 100; i++) pushRing(r, i);
    return r.buf.length === 3 && r.filled === 3;
  })());
  // 🔴 `bugs/107` — ДВА СБРОСА ПОДРЯД НЕ ДУБЛИРУЮТ ЛЕНТУ. Имя функции обещало опустошение, тело его
  // не делало, и каждое срабатывание дописывало в файл улики весь ринг заново: репетиция `strangle`
  // 05.09 дала 10718 строк на 1365 различных отметок времени, до восьми копий одной. Разбор,
  // считающий события по кольцу (`countStallsBeforeTrip`), считал копии.
  ok('кольцо: ОПУСТОШАЕТСЯ сбросом — второй сброс отдаёт только новое, а не ленту заново (bugs/107)', (() => {
    const r = makeRing(8); [1, 2, 3].forEach((x) => pushRing(r, x));
    const first = drainRing(r);
    const emptyNow = drainRing(r);                 // ничего не случилось — отдавать нечего
    [4, 5].forEach((x) => pushRing(r, x));
    const second = drainRing(r);
    return JSON.stringify(first) === '[1,2,3]'
      && JSON.stringify(emptyNow) === '[]'
      && JSON.stringify(second) === '[4,5]';
  })());
  // И ГЛАВНОЕ СВОЙСТВО, РАДИ КОТОРОГО ПРАВКА БЕЗОПАСНА: объединение сбросов не изменилось — исчезли
  // ровно повторы. Без этой строки «опустошает» было бы неотличимо от «теряет».
  ok('кольцо: объединение всех сбросов ПОЛНОЕ — опустошение убирает повторы, а не улики', (() => {
    const r = makeRing(8); const seen = [];
    for (const batch of [[1, 2], [3, 4, 5], [6]]) {
      batch.forEach((x) => pushRing(r, x));
      seen.push(...drainRing(r));
    }
    return JSON.stringify(seen) === '[1,2,3,4,5,6]';
  })());

  // ---- journal lines
  ok('строка фьюза — самостоятельный JSON, числа округлены до сотых', (() => {
    const o = JSON.parse(formatFuseLine({ atIso: 'T', phase: 'intent', cause: 'beat-silence', beatSilenceMs: 61.239 }));
    return o.phase === 'intent' && o.beatSilenceMs === 61.24;
  })());

  // ---- hand 1: fast syscall path, verified death, tree fallback (times priced by the live drill)
  ok('рука 1, быстрый путь: process.kill + смерть ПОДТВЕРЖДЕНА пробой сигналом 0, taskkill не зван', (() => {
    let sig9 = 0; let probes = 0; let taskkillCalled = false;
    const kill = makeKillHand({
      spawnSyncFn: () => { taskkillCalled = true; return { status: 0 }; },
      killFn: (pid, sig) => { if (sig === 'SIGKILL') { sig9++; return; } probes++; throw new Error('ESRCH'); },
    });
    const r = kill(777);
    return r.ok && sig9 === 1 && probes === 1 && !taskkillCalled && r.detail === 'process.kill';
  })());
  ok('рука 1, откат: выживший после сисколла (дерево) добивается taskkill /PID /T /F argv-массивом (EXP-0057)', (() => {
    let seen = null;
    const kill = makeKillHand({
      spawnSyncFn: (cmd, args) => { seen = [cmd, ...args]; return { status: 0 }; },
      killFn: () => { /* и SIGKILL, и проба сигналом 0 «проходят» — процесс упрямо жив */ },
    });
    const r = kill(777);
    return r.ok && JSON.stringify(seen) === JSON.stringify(['taskkill', '/PID', '777', '/T', '/F']) && r.detail === 'taskkill /T fallback';
  })());

  // ---- hand 1 by IMAGE (engine duty, P58-AC2): the burn's pid is locked inside spawnSync
  ok('рука 1 по именам: taskkill /IM <образ> /F argv-массивом на каждый образ, «не найден» (128) — не отказ', (() => {
    const seen = [];
    const hand = makeImageKillHand({ spawnSyncFn: (cmd, args) => { seen.push([cmd, ...args].join(' ')); return { status: seen.length === 1 ? 0 : 128 }; } });
    const r = hand(['furnace.exe', 'branchy.exe']);
    return r.ok && seen[0] === 'taskkill /IM furnace.exe /F' && seen[1] === 'taskkill /IM branchy.exe /F'
      && /furnace\.exe:убит/.test(r.detail) && /branchy\.exe:не найден/.test(r.detail);
  })());
  ok('рука 1 по именам: настоящий отказ taskkill (не 0 и не 128) — рука честно не-ok', (() => {
    const hand = makeImageKillHand({ spawnSyncFn: () => ({ status: 1 }) });
    return hand(['furnace.exe']).ok === false;
  })());
  ok('трип без pid, но с образами — рука 1 бьёт по образам (режим движка)', (() => {
    const calls = [];
    runTrip({
      verdict: { cause: 'beat-silence', beatSilenceMs: 70, progressSilenceMs: null },
      burnPid: null, burnImages: ['furnace.exe'],
      killHand: () => { calls.push('pid'); return { ok: true, ms: 1, detail: null }; },
      imageKillHand: (imgs) => { calls.push(`img:${imgs.join(',')}`); return { ok: true, ms: 1, detail: 'furnace.exe:убит' }; },
      stockHand: () => ({ ok: true, ms: 1, detail: null }),
      writeLine: () => {}, dumpRing: () => {},
    });
    return JSON.stringify(calls) === '["img:furnace.exe"]';
  })());

  // ─── РАСПИСКА РУКИ 2 И РЕШЕНИЕ О ПЕРЕВЗВЕДЕНИИ (`plans/81` Ш2, `ideas/17` часть 1) ────────────
  //
  // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
  //   R1. принять `stock-voltage` (спаун) за подтверждение → «спаун — НЕ подтверждение»
  //   R2. вернуть `confirmed` при `ok: false`              → «отказ руки НЕ разрешает продолжать»
  //   R3. не учитывать `seenBefore`                        → «второй трип ждёт ВТОРУЮ расписку»
  {
    // 🔴 ФИКСТУРА ИЗ НАСТОЯЩЕГО ЖУРНАЛА — четыре строки живого трипа 2026-08-31 05:12, как есть.
    // Выдуманная фикстура проверяла бы мой разбор собственного формата; эта проверяет разбор ТОГО,
    // что рука пишет на самом деле.
    const realTrip = [
      '{"at":"2026-08-31T05:12:05.154Z","phase":"intent","cause":"beat-silence","beatSilenceMs":500.61,"progressSilenceMs":null,"hand":null,"action":null,"ok":null,"ms":null,"detail":null}',
      '{"at":"2026-08-31T05:12:05.664Z","phase":"outcome","cause":"beat-silence","hand":1,"action":"kill-burn","ok":true,"ms":507.29,"detail":"furnace.exe:не найден"}',
      '{"at":"2026-08-31T05:12:05.671Z","phase":"outcome","cause":"beat-silence","hand":2,"action":"stock-voltage","ok":true,"ms":5.15,"detail":"pid 18728"}',
      '{"at":"2026-08-31T05:13:04.146Z","phase":"outcome","cause":null,"hand":2,"action":"stock-voltage-verified","ok":true,"ms":58444.85,"detail":"сток подтверждён чтением: остаточных смещений 0"}',
    ];
    ok('расписка: на НАСТОЯЩЕМ журнале трипа 31.08 находится РОВНО ОДНА, и это подтверждение чтением',
      stockReceipts(realTrip).length === 1 && stockReceipts(realTrip)[0].ok === true
        && stockReceipts(realTrip)[0].ms === 58444.85);
    ok('расписка: СПАУН руки 2 (`stock-voltage`, ok:true) подтверждением НЕ считается — иначе смягчение стояло бы на факте запуска процесса',
      stockReceipts(realTrip.filter((l) => !l.includes('verified'))).length === 0);
    ok('решение: подтверждённый сток РАЗРЕШАЕТ перевзведение', rearmDecision(realTrip, 0).state === 'confirmed');
    ok('решение: пока расписки нет — ЖДЁМ, а не продолжаем',
      rearmDecision(realTrip.filter((l) => !l.includes('verified')), 0).state === 'waiting');

    // ОТКАЗ РУКИ — вторая сторона, и она важнее первой: продолжить полосу на карте, про которую
    // рука сказала «сток НЕ подтверждён», значит отменить само смягчение.
    const refused = [...realTrip.slice(0, 3),
      '{"at":"2026-08-31T05:13:04.146Z","phase":"outcome","hand":2,"action":"stock-voltage-verified","ok":false,"ms":1870.7,"detail":"zeroCurve не подтвердился: остаточных 12, отказов 0"}'];
    ok('🔴 решение: отказ руки НЕ разрешает продолжать — это прежнее поведение, выход и остановка',
      rearmDecision(refused, 0).state === 'refused');

    // ВТОРОЙ ТРИП ждёт ВТОРУЮ расписку. Различение счётом, а не временем: штампы ставят разные
    // процессы своими часами, и сравнение таких концов — ловушка EXP-0207.
    const twoTrips = [...realTrip,
      '{"at":"2026-08-31T05:20:00.000Z","phase":"outcome","hand":2,"action":"stock-voltage-verified","ok":false,"ms":2000,"detail":"остаточных 3"}'];
    ok('решение: ВТОРОЙ трип ждёт ВТОРУЮ расписку, а не видит первую (различение счётом, не временем)',
      rearmDecision(twoTrips, 1).state === 'refused' && rearmDecision(twoTrips, 0).state === 'confirmed');
    ok('решение: после ПОСЛЕДНЕЙ расписки следующий трип снова ЖДЁТ', rearmDecision(twoTrips, 2).state === 'waiting');
    ok('расписка двойника (`-verified-twin`) считается так же — репетиция обязана ходить тем же путём',
      stockReceipts(['{"phase":"outcome","hand":2,"action":"stock-voltage-verified-twin","ok":true,"ms":12}']).length === 1);
    ok('мусор и пустые строки расписками не притворяются',
      stockReceipts(['', 'не json', '{"phase":"outcome","hand":1,"action":"stock-voltage-verified","ok":true}']).length === 0);

    // ─── СЧЁТ ТРИПОВ — ВХОД СТУПЕНИ (`bugs/88`, решение владельца `interviews/023`) ──────────────
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   R4. считать ЛЮБУЮ строку трипа (`phase !== 'intent'` тоже) → «строки исхода не считаются»
    //   R5. вернуть длину массива вместо счёта намерений          → тот же блок
    ok('счёт трипов: НАСТОЯЩИЙ журнал трипа 31.08 из четырёх строк несёт РОВНО ОДИН трип',
      tripCount(realTrip) === 1);
    // ⚠️ САМЫЙ ВАЖНЫЙ ИЗ ЭТИХ БЛОКОВ. У одного трипа ТРИ строки `outcome` (рука 1, спаун руки 2,
    // расписка руки 2) и одна `intent`. Счёт по всем строкам дал бы четыре «трипа» на одном
    // событии, и ступень, спросившая «сколько было до меня», получала бы растущее число на ровном
    // месте — то есть КАЖДАЯ ступень после первого трипа закрывалась бы отказом. Это не педантизм
    // формата, а разница между «частота закрыта краем» и «полоса закрыта вся».
    ok('счёт трипов: строки ИСХОДА не считаются — у одного трипа их три, и счёт по ним врал бы вчетверо',
      tripCount(realTrip.filter((l) => !l.includes('"intent"'))) === 0);
    ok('счёт трипов: два трипа считаются двумя',
      tripCount([...realTrip, '{"phase":"intent","cause":"progress-stall"}']) === 2);
    ok('счёт трипов: пустой журнал, мусор и не-массив дают честный НОЛЬ, а не бросок',
      tripCount([]) === 0 && tripCount(['', 'не json']) === 0 && tripCount(null) === 0);
  }

  ok('рука 2: ИЗОЛИРОВАННЫЙ процесс, судья НЕ ждёт, и он DETACHED — на этой машине недетачнутый ребёнок умирает с родителем (живой прогон 28.08, EXP-0166)', (() => {
    let spawned = null; let opts = null;
    const stock = makeStockHand({ spawnFn: (exe, args, o) => { spawned = args; opts = o; return { pid: 999, unref() {} }; }, journalPath: 'X.jsonl' });
    const r = stock();
    return r.ok && spawned[0].endsWith('fuse-rescue-hand.mjs') && spawned.includes('--journal') && opts.detached === true;
  })());

  // ---- hand 2 core, the isolated process's own logic (fake nvapi injected)
  {
    const { doStockRescue } = await import('./fuse-rescue-hand.mjs');
    const calls = [];
    const fake = {
      openNvapi: () => ({
        koffi: { call: (_ptr, proto) => calls.push(proto) },
        resolve: () => ({ ptr: 1 }),
        protos: { Initialize: 'init', EnumPhysicalGPUs: 'enum' },
      }),
      zeroCurve: () => { calls.push('zero'); return { ok: true, remainingNonZero: 0, failed: 0 }; },
    };
    const r = await doStockRescue({ nvapiModule: fake });
    ok('рука 2 (ядро): Initialize → EnumPhysicalGPUs → zeroCurve, исход подтверждён ЧТЕНИЕМ (EXP-0024)',
      r.ok && JSON.stringify(calls) === '["init","enum","zero"]' && /подтверждён чтением/.test(r.detail));
    const bad = await doStockRescue({ nvapiModule: { openNvapi: () => { throw new Error('нет драйвера'); } } });
    ok('рука 2 (ядро): драйвер недоступен — честный не-ok с причиной, не исключение наружу',
      bad.ok === false && /нет драйвера/.test(bad.detail));
    const unverified = await doStockRescue({ nvapiModule: { ...fake, zeroCurve: () => ({ ok: false, remainingNonZero: 3, failed: 1, why: null }) } });
    ok('рука 2 (ядро): статус 0 без подтверждения чтением — НЕ ok («status 0 is not verification»)',
      unverified.ok === false && /остаточных 3/.test(unverified.detail));

    // ══ `bugs/101` НАХОДКА 1 — СЕЙЛОК: «после меня записал кто-то ещё» ≠ «драйвер переписал меня» ══
    //
    // 🔴 ЦЕНА РАЗЛИЧИЯ НАЗВАНА ЧИСЛАМИ, А НЕ СЛОВАМИ. 31.08 рука нашла 113000 на 127 точках, 04.09 —
    // 75000 на 126, и оба раза назвала это C3, «драйвер правит результат». Оба числа — `deltaMhz`
    // ступеней seq 833 и seq 857, то есть НАША ЖЕ запись в её окне. Ложный C3 обрывал возврат судьи
    // на пост: 04.09 после него полоса сожгла ПЯТЬ ступеней без взведённой защиты.
    const { sweepIntentCount } = await import('./fuse-rescue-hand.mjs');
    ok('сейлок: счётчик считает намерения ПОЛОСЫ и НЕ считает намерения судьи — это два разных журнала',
      sweepIntentCount([
        '{"state":"intent","seq":1}', '{"state":"verdict","seq":1}',
        '{"phase":"intent","cause":"beat-silence"}',   // строка СУДЬИ: не намерение полосы
        'битый хвост', '', '{"state":"intent","seq":2}',
      ]) === 2, `насчитано ${sweepIntentCount(['{"state":"intent","seq":1}', '{"phase":"intent"}'])} на смеси`);
    // Гонка ОДИН раз: повтор чистый → сток подтверждён, судья идёт в окно. Это и есть «отбросить и
    // перечитать» из `researches/31` §2.2, и именно эта ветка спасает возврат на пост.
    {
      let seen = 0; let zeroed = 0;
      const raceOnce = {
        ...fake,
        zeroCurve: () => { zeroed += 1; return { ok: true, remainingNonZero: 0, failed: 0 }; },
      };
      const r1 = await doStockRescue({
        nvapiModule: raceOnce,
        // Полоса пишет намерение ВНУТРИ первой проверки и больше не пишет: счётчик 0,1 · 1,1.
        readSweepLinesFn: () => { seen += 1; return seen === 2 ? ['{"state":"intent","seq":1}'] : (seen > 2 ? ['{"state":"intent","seq":1}'] : []); },
      });
      ok('сейлок: гонка на первой проверке — чтение ОТБРОШЕНО, повтор чистый, сток подтверждён (возврат жив)',
        r1.ok === true && zeroed === 2, `zeroCurve вызван ${zeroed} раз(а) · ${r1.detail}`);
    }
    // Гонка ОБА раза → отказ, но назван СВОИМ именем. Полоса всё равно встанет — но разбор пойдёт
    // по верному следу, а не в третий раз в «драйвер правит наши записи».
    {
      let n = 0;
      const raceAlways = { ...fake, zeroCurve: () => ({ ok: false, remainingNonZero: 126, failed: 0, why: 'C3 — драйвер правит результат: want 0, got 75000' }) };
      const r2 = await doStockRescue({
        nvapiModule: raceAlways,
        readSweepLinesFn: () => { n += 1; return Array.from({ length: n }, (_, i) => `{"state":"intent","seq":${i + 1}}`); },
      });
      ok('сейлок: гонка на обеих проверках — отказ назван ГОНКОЙ, а не C3 (два разбора ушли по ложному следу)',
        r2.ok === false && /ГОНКА С ПОЛОСОЙ/u.test(r2.detail) && !/^C3/u.test(r2.detail), r2.detail);
    }
    // 🔴 И ОБРАТНАЯ СТОРОНА, БЕЗ КОТОРОЙ ПОЧИНКА БЫЛА БЫ ХУЖЕ БОЛЕЗНИ: настоящий C3 при НЕПОДВИЖНОМ
    // счётчике обязан остаться C3. Списать правку драйвера на гонку значило бы снять защиту.
    {
      const realC3 = { ...fake, zeroCurve: () => ({ ok: false, remainingNonZero: 126, failed: 0, why: 'C3 — драйвер правит результат: want 0, got 75000' }) };
      const r3 = await doStockRescue({ nvapiModule: realC3, readSweepLinesFn: () => ['{"state":"intent","seq":1}'] });
      ok('сейлок: счётчик НЕ двигался — настоящий C3 остаётся C3, гонкой его не прикрывают',
        r3.ok === false && /C3/u.test(r3.detail) && !/ГОНКА/u.test(r3.detail), r3.detail);
    }
    // Источника не проведено — сторож МОЛЧИТ: поведение прежнее до байта («не смотрели» ≠ «чисто»).
    {
      const r4 = await doStockRescue({ nvapiModule: fake });
      ok('сейлок: журнала полосы не передали — гонка не объявляется никогда, поведение прежнее до байта',
        r4.ok === true && !/ГОНКА/u.test(r4.detail) && !/намерений полосы/u.test(r4.detail), r4.detail);
    }
  }

  // ---- hand 2 on the TWIN (epic 59 phase 4): the same core, the bridge is the model, zeroing OBSERVED
  {
    const { doStockRescue, buildTwinNvapiModule } = await import('./fuse-rescue-hand.mjs');
    const vgpu = await import('./virtual-gpu.mjs');
    const cardFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'benches', 'cards', 'rtx5070ti.json');
    const loaded = vgpu.loadCard(cardFile);
    const vc = vgpu.virtualCard(loaded.card, { seed: 63 });
    vc.curveBackend.holdOffsetsSync(vc.curveBackend.points().map(() => 30)); // то, что оставил умирающий писатель
    const mod = await buildTwinNvapiModule({ vc });
    const r = await doStockRescue({ nvapiModule: mod });
    const after = vc.curveBackend.readOffsetsSync().filter((o) => o !== 0).length;
    ok('рука 2 двойника: тот же doStockRescue, смещения РЕАЛЬНО обнулены на модели и подтверждены чтением',
      r.ok === true && /подтверждён чтением/.test(r.detail) && after === 0);
  }

  // ---- burn pidfile (epic 59 phase 4): the carrier's pid, resolved at the trip and never earlier
  {
    const os = await import('node:os');
    const { writeFileSync: wf } = await import('node:fs');
    // `bugs/102`: свежий каталог вместо имени по pid — «файла нет» здесь ИСТИНА по построению, а не
    // по удачно сработавшему `rmSync`. Прежняя форма чистила файл руками и потому работала; соседние
    // фикстуры той же чистки не имели, и остаток чужого прогона краснил их внутри батареи.
    const pf = path.join(mkdtempSync(path.join(os.tmpdir(), 'fuse-pidfile-')), 'burn-carrier.pid');
    ok('пид-файл: нет файла — честный null (рука 1 скажет «нечего убивать», рука 2 всё равно идёт)',
      readBurnPidfile(pf) === null && readBurnPidfile(null) === null);
    wf(pf, '4242\n', 'utf8');
    ok('пид-файл: число читается, мусор и не-положительное — null', (() => {
      const good = readBurnPidfile(pf) === 4242;
      wf(pf, 'мусор', 'utf8');
      const bad = readBurnPidfile(pf) === null;
      wf(pf, '-5', 'utf8');
      const neg = readBurnPidfile(pf) === null;
      try { rf(pf, { force: true }); } catch { /* done */ }
      return good && bad && neg;
    })());
  }

  ok('рука 2 двойника: --twin <карта> доезжает до argv изолированного процесса, живой дефолт — без него', (() => {
    let twinArgs = null; let liveArgs = null;
    makeStockHand({ spawnFn: (exe, args) => { twinArgs = args; return { pid: 1, unref() {} }; }, journalPath: 'X.jsonl', extraArgs: ['--twin', 'CARD.json'] })();
    makeStockHand({ spawnFn: (exe, args) => { liveArgs = args; return { pid: 1, unref() {} }; }, journalPath: 'X.jsonl' })();
    return twinArgs.includes('--twin') && twinArgs[twinArgs.indexOf('--twin') + 1] === 'CARD.json'
      && !liveArgs.includes('--twin');
  })());

  // ---- live integration on fixtures: a real judge, real datagrams, ephemeral port (P55-AC1 end-to-end)
  {
    const dgram = await import('node:dgram');
    const os = await import('node:os');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fuse-selftest-'));
    // Selftest artefacts land in a SANDBOX, never in runs/death-watch/ — a fixture among real
    // post-mortems is fabricated evidence (EXP-0025).
    const journalPath = path.join(tmp, 'judge.jsonl');
    let readyPort = null;
    const sender = dgram.createSocket('udp4');
    const judgeDone = runJudge({
      beatPort: 0, armNMs: 60, burnPid: 31337, journalPath, seconds: 5,
      spawnSyncFn: (cmd, args) => ({ status: 0, cmdSeen: [cmd, ...args] }),
      killFn: (pid, sig) => { if (sig === 0) throw new Error('ESRCH'); },
      spawnFn: () => ({ pid: 1, unref() {} }),
      // ⚡ Ш5: рука возврата напряжения в этой фикстуре УМИРАЕТ, не оставив расписки — проверяется
      // ветка «ждать больше нечего». Она даёт ПРЕЖНЕЕ поведение целиком: выход, полоса встаёт.
      // Настоящий `process.kill` был бы здесь недетерминирован (жив ли на этой машине процесс с
      // номером 1 — вопрос к машине, а не к предохранителю).
      isAliveFn: () => false,
      onReady: ({ port }) => { readyPort = port; },
    });
    // Feed real beats for ~200 ms, then go silent — the strangling fixture, END-TO-END through the socket.
    await new Promise((res) => setTimeout(res, 50));
    const feeder = setInterval(() => { if (readyPort) sender.send(Buffer.from([0x01]), readyPort, '127.0.0.1'); }, 5);
    await new Promise((res) => setTimeout(res, 250));
    clearInterval(feeder);
    const result = await judgeDone;
    sender.close();
    const { readFileSync } = await import('node:fs');
    const journal = readFileSync(journalPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    ok('живой судья на эфемерном порту услышал настоящие удары и трипнул, когда они смолкли',
      result.beats > 10 && result.tripped && result.tripOutcomes[0].action === 'kill-burn');
    // ⚡ ЧТО ВИДЕЛ БЛОК — В СТРОКЕ, А НЕ ТОЛЬКО ИМЯ (`bugs/102` шаг 2). Первая сохранённая улика красной
    // батареи 04.09 15:48 принесла ровно эти два имени и НИ ОДНОГО числа: последовательность фаз, счёт
    // ударов, трипов и перевзведений остались невидимыми. Пороги не тронуты (B102-AC3) — печатается
    // только то, что блок и так сравнивает; следующее мигание станет читаемым.
    const seen = journal.map((l) => l.phase + (l.hand ? '/рука' + l.hand : '') + (l.ok === false ? '(не-ok)' : '')).join(' → ')
      + ' · ударов ' + result.beats + ' · трипов ' + result.trips + ' · перевзведений ' + result.rearms;
    ok('журнал предохранителя: намерение → снятие нагрузки → возврат напряжения → решение о перевзведении',
      journal.length === 4 && journal[0].phase === 'intent' && journal[1].hand === 1 && journal[2].hand === 2
      && journal[3]?.phase === 'rearm', seen);
    // ⚡ Ш5: РАСПИСКИ НЕТ И РУКА МЕРТВА → ПЕРЕВЗВЕДЕНИЯ НЕТ. Ветка отказа обязана давать ПРЕЖНЕЕ
    // поведение (код выхода 2, полоса встаёт), иначе шаг не «пережил спасение», а «снял защиту».
    ok('Ш5 отказ: рука умерла без расписки — судья НЕ перевзвёлся, счёт перевзведений 0',
      journal[3]?.ok === false && rearmCount(journal) === 0 && result.rearms === 0
      && /не оставив расписки/u.test(journal[3]?.detail ?? ''), seen);
    ok('Ш5 отказ: непережитое срабатывание оставляет прежний код выхода (полоса встаёт) [ДОКАЗЫВАЕТ --arm-n]',
      result.tripped === true && result.trips === 1);
    ok('кольцо сброшено при трипе и держит СУБ-пороговые такты (то, чего не было у пустых файлов 28.08)', (() => {
      // ≥ 10, not a tight count: the selftest holds NO timeBeginPeriod, so its setTimeout(2) ticks
      // at Windows' default ~15 ms granularity. The REAL judge CLI raises the resolution; the
      // selftest asserts the ring's CONTRACT (dumped at trip, carries per-tick gaps and silences),
      // not the cadence — cadence is phase 3's measurement, on the machine, under load.
      const rows = readFileSync(result.ringPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      return rows.length >= 10 && rows[0].gapMs !== undefined && rows.some((r) => r.beatSilenceMs !== null);
    })());
    // The feeder above STOPS abruptly (clearInterval), with no taper — that IS the measured
    // instant-death profile (26.08/28.08: beats end mid-stream). The strangling profile (23.08,
    // beats slow 0,13 → 4,49 s) reaches the same verdict through the same silence check: the
    // deadman does not need to distinguish the two to rescue — only the post-mortem does.
    ok('обрыв ударов без замедления (профиль мгновенной смерти) — тот же трип', result.tripped);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚡ Ш5 `plans/81` — АПВ: ЗАЩИТА ПЕРЕЖИВАЕТ СРАБАТЫВАНИЕ И СНОВА СТОИТ НА ПОСТУ
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // 🔴 ЭТО ГЛАВНЫЙ БЛОК ШАГА, и он проверяет НЕ «защита не вышла», а два факта, которых без него
  // не было бы вовсе:
  //   (1) после возврата на пост защита СНОВА СЛЕДИТ — сигналы живости считаются дальше;
  //   (2) возврат на пост НЕ ПОРОЖДАЕТ ЛОЖНОГО срабатывания — то есть состояние сброшено, а не
  //       унесено с прошлой ступени (риск (д) плана 81, класс `bugs/19`).
  //
  // Второй факт и есть цена явного списка полей: не сбрось `lastBeatMs`, и первый же такт после
  // возврата увидит «тишину» длиной во всё спасение и ударит по здоровой карте. Фикстура ловит
  // это прямо: сигналы живости ВОЗОБНОВЛЯЮТСЯ сразу после возврата, и повторное срабатывание при
  // живых сигналах означало бы ровно унесённое состояние.
  {
    const dgram = await import('node:dgram');
    const os = await import('node:os');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fuse-rearm-'));
    const journalPath = path.join(tmp, 'judge.jsonl');
    let readyPort = null;
    let handSpawns = 0;
    let feeding = true;
    const sender = dgram.createSocket('udp4');
    // Расписка ВЗН подкладывается ЧИСЛОМ, равным числу запусков руки: у каждого срабатывания своя,
    // и порядковый номер — ровно то, чем их различает `rearmDecision` (счёт, а не время).
    const receipt = '{"phase":"outcome","hand":2,"action":"stock-voltage-verified","ok":true,"ms":1870}';
    const judgeDone = runJudge({
      // Окно защиты кончается, ПОКА СИГНАЛЫ ЖИВОСТИ ЕЩЁ ИДУТ. Это не мелочь фикстуры: гаси их
      // раньше конца окна — и защита честно сработает ещё десяток раз уже ПОСЛЕ опыта, а блок
      // прочитает это как «состояние не сброшено». Опыт обязан кончаться на здоровом входе.
      // ⚡ Ш3 (`plans/88` §4b(4)): ОКНО ЗДОРОВЬЯ ФИКСТУРЫ — СВОИМИ ЧИСЛАМИ, И ОБА ИЗМЕРЕНЫ.
      // `healthySeconds: 1` — иначе на трёх секундах окна прогон в 2 с не перевзвёлся бы НИКОГДА
      // (то самое ограничение, найденное чтением до кода). ✏️ 08.09 (`bugs/121`): ВТОРОГО ЧИСЛА
      // ЗДЕСЬ БОЛЬШЕ НЕТ. Фикстуре нужна была своя уставка такта ровно потому, что внутри
      // самопроверки `timeBeginPeriod(1)` никто не поднимает и такт стоит на 64…65/с при зазоре
      // 16 мс — то есть проба мерила разрешение таймера Windows, а не механизм. Проба переведена на
      // РАЗРЫВ такта: те же 16 мс проходят умолчанием 60 мс, и фикстура судится тем же числом, что
      // живой путь. Что окно УМЕЕТ не пустить — доказывает соседний блок «стена» с уставкой 0.
      // Окно ВЫРОСЛО с 2 с до 5: половина возврата теперь ждёт закрытой секунды строки жизни, и
      // прежние 2 с не вмещали ДВЕ такие секунды — фикстура мерила бы дедлайн, а не механизм.
      beatPort: 0, armNMs: 60, burnPid: 31337, journalPath, seconds: 5,
      healthySeconds: 1,
      spawnSyncFn: () => ({ status: 0 }),
      killFn: (pid, sig) => { if (sig === 0) throw new Error('ESRCH'); },
      spawnFn: () => {
        handSpawns += 1;
        // Возврат заводского напряжения отработал — карта снова здорова, значит сигналы живости
        // ВОЗОБНОВЛЯЮТСЯ. Это и есть здоровый вход, на котором ложное срабатывание видно.
        feeding = true;
        return { pid: 4242, unref() {} };
      },
      isAliveFn: () => true,
      readLinesFn: () => Array.from({ length: handSpawns }, () => receipt),
      onReady: ({ port }) => { readyPort = port; },
    });
    await new Promise((res) => { setTimeout(res, 50); });
    const feeder = setInterval(() => {
      if (readyPort && feeding) sender.send(Buffer.from([0x01]), readyPort, '127.0.0.1');
    }, 5);
    // ДВЕ ТИШИНЫ, А НЕ ОДНА — И ЭТО СУТЬ ШАГА, а не богатство фикстуры. Одна тишина доказывает
    // только «защита не вышла»; вторая доказывает, что она СНОВА СПОСОБНА СРАБОТАТЬ, то есть что
    // возврат на пост был настоящим взведением, а не выживанием процесса. Найдено зелёной
    // мутацией М4 ([[EXP-0205]]: зелёная мутация — находка, а не облегчение): снятие сброса
    // `tripOutcomes` не краснило НИЧЕГО, потому что второго срабатывания никто не просил.
    await new Promise((res) => { setTimeout(res, 250); });
    feeding = false;                                    // t≈300: тишина №1 → срабатывание, затем возврат
    // ⚡ Ш3: ПАУЗА ВЫРОСЛА 700 → 1700 мс, И ЭТО НЕ ЗАПАС «НА ВСЯКИЙ СЛУЧАЙ». Возврат на пост теперь
    // ждёт ЗАКРЫТОЙ секунды строки жизни: полуоткрытое окно распахивается на срабатывании (t≈360) и
    // выравнивает границу на t≈1360. Гаси сигналы раньше — и тишина №2 упала бы ВНУТРЬ окна, где
    // судья наблюдает и трипать не может; фикстура прочитала бы это как «защита больше не
    // срабатывает» и обвинила бы механизм в том, чего он не делал.
    await new Promise((res) => { setTimeout(res, 1700); });
    feeding = false;                                    // t≈2000: тишина №2 → защита обязана сработать СНОВА
    // Ждём КОНЦА ОКНА защиты, не гася сигналы: она обязана досидеть его на здоровом входе.
    const r = await judgeDone;
    clearInterval(feeder);
    sender.close();
    const lines = readFileSync(journalPath, 'utf8').trim().split('\n');

    // 🔴 ДВЕ СТРОКИ НИЖЕ ПОЧИНЕНЫ 2026-09-05 (`bugs/106`), И ЭТО НАШЛОСЬ ПОД ПРИЁМКОЙ Ш3.
    // Они были написаны ЧУЖИМ ДИАЛЕКТОМ `ok`: в батарее `driver-voice` подпись `(имя, факт,
    // ожидание)`, а здесь — `(имя, УСЛОВИЕ, подробность)`. Непустой массив и число 2 — истина, то
    // есть обе строки горели зелёным СТРУКТУРНО, чего бы ни намерил прогон, и мутация М4, которой
    // они приписаны, покраснить их не могла. Зелёный, неотличимый от «не смотрели», — оплаченный
    // класс ([[EXP-0112]]). Теперь это условия, а измеренное печатается подробностью.
    const seenRearm = `трипов ${r.trips} · перевзведений ${r.rearms} · вышел неперевзведённым: ${r.tripped}`;
    ok('Ш5 АПВ: защита ПЕРЕЖИЛА срабатывание — вернулась на пост, а не вышла',
      r.trips >= 1 && r.rearms >= 1 && r.tripped === false, seenRearm);
    ok('Ш5 АПВ: возврат на пост записан в протокол успешной распиской, счёт сходится',
      rearmCount(lines) === r.rearms && tripCount(lines) === r.trips && r.rearms === r.trips,
      `${seenRearm} · строк rearm ${rearmCount(lines)} · строк intent ${tripCount(lines)}`);
    // 🔴 ГЛАВНАЯ СТРОКА ШАГА. Мутация М4 (не сбрасывать `tripOutcomes`) краснит ровно её: защита
    // пережила бы срабатывание, но осталась бы слепой навсегда — а слепая защита хуже вышедшей,
    // потому что выглядит работающей.
    ok('Ш5 АПВ: после возврата на пост защита СНОВА СРАБАТЫВАЕТ — взведение настоящее, а не выживание',
      r.trips === 2, seenRearm);
    // ⚠️ И РОВНО ДВА, не больше: без сброса `lastBeatMs` унесённая тишина спасения ударила бы по
    // здоровой карте немедленно, и срабатываний стало бы много (риск (д), класс `bugs/19`).
    ok('Ш5 АПВ: ложных срабатываний при живых сигналах НЕТ — состояние сброшено, а не унесено',
      r.trips <= 2, `срабатываний: ${r.trips}`);
    // И защита действительно СЛЕДИТ дальше, а не досиживает окно молча: сигналы после возврата
    // приняты. Без этого «пережила» означало бы только «процесс не умер».
    ok('Ш5 АПВ: защита снова СЧИТАЕТ сигналы живости после возврата на пост',
      r.beats > 60, `принято сигналов: ${r.beats}`);

    // ══ Ш3 (`plans/88`) — ПОЛУОТКРЫТОЕ ОКНО НА СКВОЗНОМ ПРОГОНЕ, а не только в чистой функции ══
    const recs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const halfOpenLines = recs.filter((d) => d.action === 'half-open');
    const rearmLines = recs.filter((d) => d.phase === 'rearm' && d.ok === true);
    ok('Ш3: у КАЖДОГО возврата на пост есть своё полуоткрытое состояние — расписка и взведение разведены',
      halfOpenLines.length === r.rearms && r.rearms === 2,
      `строк half-open ${halfOpenLines.length} · перевзведений ${r.rearms}`);
    // 🔴 ГЛАВНАЯ СТРОКА Ш3. Полоса читает `rearmCount` (`phase: 'rearm' && ok === true`). Посчитай
    // она половину возврата за возврат — и прожиг пошёл бы при судье, который ещё НАБЛЮДАЕТ, то
    // есть ровно то, что шаг пришёл предотвратить. Мутация: поставить `ok: true` в `openHalfOpen`.
    ok('Ш3: половина возврата НЕ считается возвратом — счёт полосы половинки не видит',
      rearmCount(lines) === 2 && halfOpenLines.every((d) => d.ok === null),
      `rearmCount=${rearmCount(lines)} · ok у half-open: ${halfOpenLines.map((d) => String(d.ok)).join(',')}`);
    // Окно РЕАЛЬНО ЗАДЕРЖАЛО возврат, а не проехало формально: между срабатыванием и взведением
    // легла закрытая секунда строки жизни, тогда как расписка руки пришла в первые же миллисекунды.
    // Без этой строки «окно есть» доказывалось бы наличием строки в журнале, а не задержкой.
    ok('Ш3: возврат на пост ОТСТАЁТ от расписки на длину окна здоровья (окно работает, а не значится)',
      rearmLines.every((d) => d.ms >= 1000) && halfOpenLines.every((d) => d.ms < 1000),
      `ms у rearm: ${rearmLines.map((d) => d.ms).join(',')} · ms у half-open: ${halfOpenLines.map((d) => d.ms).join(',')}`);
    // P88-AC5: уставка и длина окна ПЕЧАТАЮТСЯ в журнал каждого перевзведения — так малая выборка
    // (шесть эпизодов, риск 3 плана 88) растёт сама, вместо того чтобы угадываться пошире.
    ok('P88-AC5: строка возврата несёт ticksPerSec и healthySeconds — выборка растёт сама',
      rearmLines.every((d) => /ticksPerSec=\d+/u.test(d.detail ?? '') && /healthySeconds=\d+\/1/u.test(d.detail ?? '')),
      rearmLines.map((d) => d.detail).join(' || '));
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // 🔴 `bugs/111` — ЗАЩИТА НЕ СМЕЕТ СРАБАТЫВАТЬ ЭХОМ СОБСТВЕННОГО СПАСЕНИЯ
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // НАЙДЕНО ЖИВЫМ ПРОГОНОМ 2026-09-07, не чтением: взведение 10:11:59.776 → трип 10:11:59.777,
  // `progressSilenceMs 6754.37` при уставке 1046, рука 1 не нашла ни одного образа прожига.
  // Отказ был ОДИН, счётчик показал ДВА.
  //
  // ПОЧЕМУ ЭТОГО НЕ ЛОВИЛ СОСЕДНИЙ БЛОК «Ш5 АПВ» (и это не его вина, а разница входов): там
  // тишина идёт по входу 1, а сигналы живости ВОЗОБНОВЛЯЮТСЯ — `spawnFn` руки 2 включает подачу
  // обратно. У входа 2 возобновлять НЕКОМУ: прожиг убит рукой 1, и писать в файл сердцебиения
  // больше некому по построению. Поэтому эхо живёт только на входе 2, и блок обязан быть свой.
  //
  // ФИКСТУРА ВОСПРОИЗВОДИТ ЖИВОЙ ПУТЬ ДОСЛОВНО В ДВУХ МЕСТАХ, и оба важны:
  //   · `existsFn: () => true` — файл сердцебиения ПЕРЕЖИВАЕТ убитый прожиг. Его снимает `.cu` при
  //     ШТАТНОМ выходе, а рука 1 прожиг убивает — снимать некому. Значит ворота входа 2
  //     (`verdict.cause === 'progress-stall' && !burnInFlight()`) на этом пути молчат, и надеяться
  //     на них нельзя: сторож, читающий труп как живого, — оплаченный класс.
  //   · удары 0x01 идут ВСЁ ВРЕМЯ — иначе трипнул бы вход 1 и опыт мерил бы не то.
  {
    const dgram = await import('node:dgram');
    const os = await import('node:os');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fuse-echo-'));
    const journalPath = path.join(tmp, 'judge.jsonl');
    let readyPort = null;
    let handSpawns = 0;
    let feedProgress = true;
    const sender = dgram.createSocket('udp4');
    const receipt = '{"phase":"outcome","hand":2,"action":"stock-voltage-verified","ok":true,"ms":1870}';
    const judgeDone = runJudge({
      beatPort: 0, armNMs: 60, armMMs: 200, burnPid: 31337, journalPath, seconds: 5,
      progressFile: path.join(tmp, 'burn-progress.txt'),
      existsFn: () => true,             // ← файл пережил убитый прожиг, как на живом пути
      healthySeconds: 1,
      spawnSyncFn: () => ({ status: 0 }),
      killFn: (pid, sig) => { if (sig === 0) throw new Error('ESRCH'); },
      // Рука 2 отработала — но прогресс НЕ возобновляется: прожиг мёртв. В этом вся разница
      // с блоком «Ш5 АПВ», и потому `feedProgress` здесь обратно НЕ включается.
      spawnFn: () => { handSpawns += 1; return { pid: 4242, unref() {} }; },
      isAliveFn: () => true,
      readLinesFn: () => Array.from({ length: handSpawns }, () => receipt),
      onReady: ({ port }) => { readyPort = port; },
    });
    await new Promise((res) => { setTimeout(res, 50); });
    const feeder = setInterval(() => {
      if (!readyPort) return;
      sender.send(Buffer.from([0x01]), readyPort, '127.0.0.1');                    // вход 1 — всегда жив
      if (feedProgress) sender.send(Buffer.from([0x02]), readyPort, '127.0.0.1');  // вход 2 — до остановки прожига
    }, 5);
    await new Promise((res) => { setTimeout(res, 250); });
    feedProgress = false;               // прожиг встал → через 200 мс трип progress-stall, и больше НИКОГДА
    const r = await judgeDone;
    clearInterval(feeder);
    sender.close();
    const lines = readFileSync(journalPath, 'utf8').trim().split('\n');
    const recs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    // 🔴 ГЛАВНАЯ СТРОКА. Отказ ОДИН — значит и срабатывание одно. Без правки взведение возвращает
    // судью на пост с вердиктом, снятым ДО сброса, и он бьёт по трупу в тот же такт: 2 и больше.
    ok('bugs/111: отказ входа 2 ОДИН — срабатывание тоже одно, эха собственного спасения нет',
      r.trips === 1, `срабатываний ${r.trips} · перевзведений ${r.rearms} · вышел неперевзведённым: ${r.tripped}`);
    // Защита при этом ЖИВА и вернулась на пост — иначе «одно срабатывание» означало бы просто
    // вышедшего судью, а это совсем другой (и худший) исход.
    ok('bugs/111: судья вернулся на пост и досидел окно — одно срабатывание это НЕ выход защиты',
      r.rearms === 1 && r.tripped === false, `перевзведений ${r.rearms} · вышел неперевзведённым: ${r.tripped}`);
    // ⚡ ПРЯМОЕ ВЫСКАЗЫВАНИЕ ДЕФЕКТА, а не только его следствие: между возвратом на пост и следующим
    // намерением бить обязан пройти хотя бы один ЧЕСТНЫЙ такт. На живом прогоне 07.09 их разделяла
    // ОДНА миллисекунда. Порог 50 мс — с запасом ниже такта судьи (60 мс уставки), то есть
    // «в том же такте» и «через такт» им различаются, а дрожь планировщика — нет.
    const rearmAts = recs.filter((d) => d.phase === 'rearm' && d.action === 'rearm').map((d) => Date.parse(d.at));
    const intentAts = recs.filter((d) => d.phase === 'intent').map((d) => Date.parse(d.at));
    const echoes = intentAts.filter((t) => rearmAts.some((rt) => t - rt >= 0 && t - rt < 50));
    ok('bugs/111: ни одно намерение бить не стоит в том же такте, что и возврат на пост',
      echoes.length === 0,
      `намерений ${intentAts.length} · возвратов ${rearmAts.length} · в одном такте с возвратом: ${echoes.length}`);
    // И причина единственного срабатывания названа правильно: это вход 2, а не сбившийся вход 1.
    // Без этой строки блок прошёл бы и на фикстуре, где вход 2 не участвовал вовсе.
    ok('bugs/111: сработал именно вход 2 — причина progress-stall, а не beat-silence',
      recs.some((d) => d.phase === 'intent' && d.cause === 'progress-stall')
      && !recs.some((d) => d.phase === 'intent' && d.cause === 'beat-silence'),
      `причины намерений: ${recs.filter((d) => d.phase === 'intent').map((d) => d.cause).join(',') || '—'}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚡ `bugs/123` — НЕПРЕРЫВНЫЙ ЧЁРНЫЙ ЯЩИК: УЛИКА 2 мс ПЕРЕЖИВАЕТ СМЕРТЬ БЕЗ ТРИПА
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // Три смерти 08.09 не дали ни одного трипа, и каждая унесла кольцо целиком. Блок доказывает
  // РОВНО то, чего не хватало: такты лежат на диске УЖЕ, пока судья ещё работает и ничего не
  // случилось. Проверка идёт ЧТЕНИЕМ ФАЙЛА ВО ВРЕМЯ ПРОГОНА — то есть в тот момент, в который
  // синий экран и приходил.
  {
    const os = await import('node:os');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fuse-livering-'));
    const journalPath = path.join(tmp, 'judge.jsonl');
    let midRunLines = 0;
    let midRunTripped = null;
    const judgeDone = runJudge({
      beatPort: 0, armNMs: null, armMMs: null, burnPid: null, journalPath, seconds: 1.2,
      // Ёмкость мала НАРОЧНО: так за прогон случится переключение половин, и блок судит ротацию,
      // а не только запись.
      ringCapacity: 40,
      spawnSyncFn: () => ({ status: 0 }), spawnFn: () => ({ pid: 1, unref() {} }), log: () => {},
    });
    // Через полсекунды после старта — читаем файл ПРЯМО СЕЙЧАС, не дожидаясь конца прогона.
    await new Promise((res) => { setTimeout(res, 500); });
    const half = (n) => journalPath.replace(/\.jsonl$/u, `-live-${n}.jsonl`);
    for (const n of ['a', 'b']) {
      try { midRunLines += readFileSync(half(n), 'utf8').trim().split('\n').filter(Boolean).length; } catch { /* половина ещё не заведена */ }
    }
    midRunTripped = false;
    const r = await judgeDone;
    ok('🔴 bugs/123: ТАКТЫ ЛЕЖАТ НА ДИСКЕ ПОСРЕДИ ПРОГОНА, БЕЗ ЕДИНОГО ТРИПА — мгновенная смерть больше не уносит улику',
      midRunLines > 0 && r.trips === 0,
      `строк на диске через 0,5 с: ${midRunLines} · трипов за прогон: ${r.trips}`);
    const total = ['a', 'b'].reduce((s, n) => {
      try { return s + readFileSync(half(n), 'utf8').trim().split('\n').filter(Boolean).length; } catch { return s; }
    }, 0);
    ok('bugs/123: размер ограничен сверху — две половины по ёмкости кольца, а не файл, растущий весь вечер',
      total > 0 && total <= 2 * 40,
      `строк в обеих половинах после прогона: ${total} при потолке ${2 * 40}`);
    // Порядок хранения ≠ порядок времени: половины пишутся по кругу, разбор ОБЯЗАН сортировать.
    const rows = ['a', 'b'].flatMap((n) => {
      try { return readFileSync(half(n), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
    }).sort((x, y) => x.t - y.t);
    ok('bugs/123: записанное читается как ВРЕМЕННОЙ РЯД — метки растут после сортировки, разрыв такта у каждой',
      rows.length > 1 && rows.every((x, i) => i === 0 || x.t >= rows[i - 1].t) && rows.every((x) => typeof x.gapMs === 'number'),
      `тактов ${rows.length}`);
    // МУТАЦИЯ: сними непрерывную запись — и посреди прогона на диске не будет НИЧЕГО, ровно как
    // 08.09. Проверяется тем же способом: файл читается ДО конца прогона.
    const tmp2 = mkdtempSync(path.join(os.tmpdir(), 'fuse-livering-mut-'));
    const jp2 = path.join(tmp2, 'judge.jsonl');
    const done2 = runJudge({
      beatPort: 0, armNMs: null, armMMs: null, burnPid: null, journalPath: jp2, seconds: 1.2,
      ringCapacity: 40, liveRing: false,
      spawnSyncFn: () => ({ status: 0 }), spawnFn: () => ({ pid: 1, unref() {} }), log: () => {},
    });
    await new Promise((res) => { setTimeout(res, 500); });
    let mutLines = 0;
    for (const n of ['a', 'b']) {
      try { mutLines += readFileSync(jp2.replace(/\.jsonl$/u, `-live-${n}.jsonl`), 'utf8').trim().split('\n').filter(Boolean).length; } catch { /* файла нет — это и есть прежняя беда */ }
    }
    await done2;
    ok('bugs/123 МУТАЦИЯ: без непрерывной записи посреди прогона на диске НОЛЬ тактов — прежняя беда воспроизведена',
      mutLines === 0, `строк на диске: ${mutLines}`);
    try { rmSync(tmp, { recursive: true, force: true }); rmSync(tmp2, { recursive: true, force: true }); } catch { /* песочница во временных */ }
    void midRunTripped;
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚡ `bugs/122` — РУКА 2 УШЛА В ДРАЙВЕР И НЕ ВЕРНУЛАСЬ: ОЖИДАНИЕ КОНЧАЕТСЯ НАБЛЮДЕНИЕМ, А НЕ ЧАСАМИ
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // ЧТО ВОСПРОИЗВОДИТСЯ, ДОСЛОВНО ПО ЖУРНАЛУ 08.09: трип · рука 1 убила прожиг · рука 2 стартовала и
  // НЕ ОТЧИТАЛАСЬ · процесс руки ЖИВ · удары ИДУТ · мощность стоит на одном числе. В тот день это
  // продлилось 119 секунд, и машина умерла посреди ожидания. Фикстура играет то же за доли секунды.
  {
    const dgram = await import('node:dgram');
    const os = await import('node:os');
    const frozen = async ({ freeze, frozenMs }) => {
      const tmp = mkdtempSync(path.join(os.tmpdir(), 'fuse-frozen-'));
      const journalPath = path.join(tmp, 'judge.jsonl');
      let readyPort = null;
      let feeding = true;
      let mw = 240_000;
      const sender = dgram.createSocket('udp4');
      const judgeDone = runJudge({
        beatPort: 0, armNMs: 60, burnPid: 31337, journalPath, seconds: 3,
        healthySeconds: 1, cardTelemetryFrozenMs: frozenMs,
        spawnSyncFn: () => ({ status: 0 }),
        killFn: (pid, sig) => { if (sig === 0) throw new Error('ESRCH'); },
        // Рука 2 стартовала и ЖИВЁТ — ровно как pid 7152 в 10:00:27. Расписки не будет НИКОГДА:
        // `readLinesFn` возвращает пустой журнал.
        spawnFn: () => { feeding = true; return { pid: 7152, unref() {} }; },
        isAliveFn: () => true,
        readLinesFn: () => [],
        onReady: ({ port }) => { readyPort = port; },
      });
      await new Promise((res) => { setTimeout(res, 50); });
      const feeder = setInterval(() => {
        if (!readyPort || !feeding) return;
        // Удар в пять байт: пульс + милливатты. `freeze` решает, ДВИГАЕТСЯ ли число.
        if (!freeze) mw = mw === 240_000 ? 238_000 : 240_000;
        const b = Buffer.alloc(5); b[0] = 0x01; b.writeUInt32LE(mw, 1);
        sender.send(b, readyPort, '127.0.0.1');
      }, 5);
      await new Promise((res) => { setTimeout(res, 250); });
      feeding = false;                                   // тишина → срабатывание → рука 2 → ожидание
      const r = await judgeDone;
      clearInterval(feeder);
      sender.close();
      const recs = readFileSync(journalPath, 'utf8').trim().split('\n')
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      try { rmSync(tmp, { recursive: true, force: true }); } catch { /* песочница во временных */ }
      return { r, refusal: recs.find((d) => d.action === 'rearm-refused') ?? null };
    };

    const stuck = await frozen({ freeze: true, frozenMs: 300 });
    ok('🔴 bugs/122: КАРТА ОТВЕЧАЕТ, НО НЕ СЧИТАЕТ — ожидание расписки кончается ОТКАЗОМ, а не смертью машины',
      /НЕ СЧИТАЕТ/u.test(stuck.refusal?.detail ?? ''),
      stuck.refusal?.detail ?? 'строки отказа нет');
    ok('bugs/122: отказ оставляет судью НЕПЕРЕВЗВЕДЁННЫМ — полоса встаёт, карта на стоке',
      stuck.r.tripped === true && stuck.r.rearms === 0,
      `трипов ${stuck.r.trips} · перевзведений ${stuck.r.rearms} · вышел неперевзведённым: ${stuck.r.tripped}`);

    // ПАРНЫЙ КОНТРОЛЬ: та же фикстура, та же молчащая рука — но карта СЧИТАЕТ. Отказа быть не должно:
    // иначе сторож ловил бы не заморозку, а само ожидание, и убивал бы каждое честное спасение.
    const live = await frozen({ freeze: false, frozenMs: 300 });
    ok('bugs/122 ПАРНЫЙ КОНТРОЛЬ: мощность ДВИЖЕТСЯ — ожидание продолжается, отказа по заморозке нет',
      !/НЕ СЧИТАЕТ/u.test(live.refusal?.detail ?? ''),
      live.refusal?.detail ?? 'отказа нет — верно');

    // МУТАЦИЯ: убери сторож (уставка недостижимо велика) — и вернётся поведение 08.09: ожидание без
    // конца при мёртвой карте. Блок обязан покраснеть на этом, иначе он бутафория.
    const mutated = await frozen({ freeze: true, frozenMs: 1_000_000 });
    ok('bugs/122 МУТАЦИЯ: снятый сторож возвращает БЕСКОНЕЧНОЕ ожидание мёртвой карты (как 08.09)',
      !/НЕ СЧИТАЕТ/u.test(mutated.refusal?.detail ?? ''),
      mutated.refusal?.detail ?? 'отказа нет — мутация воспроизвела прежнюю беду');
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚡ Ш3 `plans/88` — ОКНО, КОТОРОЕ НЕ ПУСКАЕТ: судья с недостижимой уставкой НЕ ВСТАЁТ НА ПОСТ
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // 🔴 БЕЗ ЭТОГО БЛОКА ПРЕДЫДУЩИЕ ДОКАЗЫВАЮТ ТОЛЬКО «ОКНО ПРОПУСКАЕТ». Пара к ним обязана быть
  // симметричной: тот же сквозной прогон, та же расписка, единственная разница — уставка здоровья
  // выше всего, что машина способна дать (5000 тактов/с против измеренных 64…65). Судья обязан
  // остаться НЕПЕРЕВЗВЕДЁННЫМ, а полоса — встать: это прежнее поведение, и оно не потеряно.
  // И это же страховка от обратной беды: сделай окно бутафорией — блок покраснеет.
  {
    const dgram = await import('node:dgram');
    const os = await import('node:os');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fuse-halfopen-wall-'));
    const journalPath = path.join(tmp, 'judge.jsonl');
    let readyPort = null;
    let handSpawns = 0;
    let feeding = true;
    const sender = dgram.createSocket('udp4');
    const receipt = '{"phase":"outcome","hand":2,"action":"stock-voltage-verified","ok":true,"ms":1870}';
    const judgeDone = runJudge({
      beatPort: 0, armNMs: 60, burnPid: 31337, journalPath, seconds: 3,
      healthySeconds: 1, healthyWorstGapMs: 0,   // НЕДОСТИЖИМО (bugs/121): любой реальный разрыв больше нуля — окно-стена в новой величине
      spawnSyncFn: () => ({ status: 0 }),
      killFn: (pid, sig) => { if (sig === 0) throw new Error('ESRCH'); },
      spawnFn: () => { handSpawns += 1; feeding = true; return { pid: 4242, unref() {} }; },
      isAliveFn: () => true,
      readLinesFn: () => Array.from({ length: handSpawns }, () => receipt),
      onReady: ({ port }) => { readyPort = port; },
    });
    await new Promise((res) => { setTimeout(res, 50); });
    const feeder = setInterval(() => {
      if (readyPort && feeding) sender.send(Buffer.from([0x01]), readyPort, '127.0.0.1');
    }, 5);
    await new Promise((res) => { setTimeout(res, 250); });
    feeding = false;                                   // тишина → срабатывание → расписка → ПОЛУОТКРЫТО
    const r = await judgeDone;
    clearInterval(feeder);
    sender.close();
    const lines = readFileSync(journalPath, 'utf8').trim().split('\n');
    const recs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const refusal = recs.find((d) => d.action === 'rearm-refused') ?? null;
    const seen = `трипов ${r.trips} · перевзведений ${r.rearms} · вышел неперевзведённым: ${r.tripped}`;
    ok('P88-AC1 сквозной: машина, не давшая здорового такта, НЕ пускает судью на пост — расписки мало',
      r.rearms === 0 && rearmCount(lines) === 0, seen);
    ok('P88-AC4 сквозной: невыздоровевшая машина оставляет судью НЕПЕРЕВЗВЕДЁННЫМ — полоса встаёт, как и прежде',
      r.tripped === true && r.trips === 1, seen);
    ok('P88-AC4: отказ назван СВОИМ именем — «прежде окна здоровья», а не «прежде расписки»',
      /прежде окна здоровья/u.test(refusal?.detail ?? ''), refusal?.detail ?? 'строки отказа нет');
    // Полуоткрытое состояние ОТКРЫЛОСЬ (расписка была принята) — иначе блок доказывал бы стену на
    // ступень раньше, у руки 2, и про само окно не сказал бы ничего.
    ok('Ш3: полуоткрытое состояние ОТКРЫЛОСЬ и не закрылось — стена именно в окне, а не в расписке',
      recs.filter((d) => d.action === 'half-open').length === 1,
      `строк half-open ${recs.filter((d) => d.action === 'half-open').length}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // 🔴 НЕДОСТИГНУТОЕ ОКНО ЗДОРОВЬЯ КОНЧАЕТСЯ ОТКАЗОМ ПО СРОКУ, А НЕ МОЛЧАНИЕМ ДО ДЕДЛАЙНА СУДЬИ
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // ОПЛАЧЕНО ПЯТЬЮ ДНЯМИ. 2026-09-07 окно на стенде оказалось стеной (уставка живого пути 300 при
  // медиане 65), судья вошёл в `half-open` и не вышел никогда, полоса встала в «ЖДУ АПВ» и
  // провисела до внешнего таймаута 300 с. Снаружи это было неотличимо от ЗАВИСАНИЯ МАШИНЫ, и
  // диагноз пять дней приписывали постороннему тикету.
  //
  // 🔴 ЧЕМ ЭТОТ БЛОК ОТЛИЧАЕТСЯ ОТ СОСЕДНЕГО «ОКНО, КОТОРОЕ НЕ ПУСКАЕТ» — И ПОЧЕМУ ОН НУЖЕН ОТДЕЛЬНО.
  // Там судье отведено 3 секунды, и окно не закрывается потому, что КОНЧАЕТСЯ САМ СУДЬЯ: блок не
  // отличил бы срок окна от дедлайна прогона. Здесь наоборот — судье отведено ПЯТЬ секунд, а окну
  // 1,2, и отказ обязан прийти ОТ ОКНА. Без этой асимметрии оба блока проверяли бы одно и то же.
  {
    const dgram = await import('node:dgram');
    const os = await import('node:os');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fuse-halfopen-deadline-'));
    const journalPath = path.join(tmp, 'judge.jsonl');
    let readyPort = null;
    let handSpawns = 0;
    let feeding = true;
    const sender = dgram.createSocket('udp4');
    const receipt = '{"phase":"outcome","hand":2,"action":"stock-voltage-verified","ok":true,"ms":1870}';
    const startedAt = Date.now();
    const judgeDone = runJudge({
      beatPort: 0, armNMs: 60, burnPid: 31337, journalPath, seconds: 5,
      healthySeconds: 1, healthyWorstGapMs: 0,   // НЕДОСТИЖИМО (bugs/121): любой реальный разрыв больше нуля — окно-стена в новой величине
      halfOpenDeadlineMs: 1200,                      // ...и окно кончается РАНЬШЕ судьи
      spawnSyncFn: () => ({ status: 0 }),
      killFn: (pid, sig) => { if (sig === 0) throw new Error('ESRCH'); },
      spawnFn: () => { handSpawns += 1; feeding = true; return { pid: 4242, unref() {} }; },
      isAliveFn: () => true,
      readLinesFn: () => Array.from({ length: handSpawns }, () => receipt),
      onReady: ({ port }) => { readyPort = port; },
    });
    await new Promise((res) => { setTimeout(res, 50); });
    const feeder = setInterval(() => {
      if (readyPort && feeding) sender.send(Buffer.from([0x01]), readyPort, '127.0.0.1');
    }, 5);
    await new Promise((res) => { setTimeout(res, 250); });
    feeding = false;                                 // тишина → спасение → расписка → ПОЛУОТКРЫТО
    const r = await judgeDone;
    const elapsed = Date.now() - startedAt;
    clearInterval(feeder);
    sender.close();
    const recs = readFileSync(journalPath, 'utf8').trim().split('\n')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const refused = recs.find((d) => d.action === 'rearm-refused');

    // 🔴 ГЛАВНАЯ СТРОКА: отказ ЕСТЬ, и он назван СВОИМИ словами — про окно здоровья, а не про
    // расписку и не про конец прогона. Прибор, кончающийся молча, дороже прибора, кончающегося
    // с неверной причиной, ровно настолько, насколько молчание дольше ищут.
    // ⚠️ ЭТА СТРОКА НЕ РАЗЛИЧАЕТ СРОК, И ЕЁ ИМЯ ПРИВЕДЕНО К ЭТОМУ ЧЕСТНО (замерено мутацией
    // 2026-09-07: со снятым сроком она остаётся ЗЕЛЁНОЙ). Недостигнутое окно отказывает и без
    // срока — только позже, дедлайном судьи, — поэтому «отказ есть и он назван» верно в ОБОИХ
    // мирах. Различает срок строка НИЖЕ, и она за него и отвечает. Оставлена потому, что стережёт
    // другое: что отказ вообще доезжает до протокола отдельной строкой `rearm-refused`.
    ok('окно-стена: отказ ДОЕЗЖАЕТ до протокола отдельной строкой (эту строку срок НЕ различает)',
      refused !== undefined,
      refused ? `строка есть: ${String(refused.detail ?? '').slice(0, 80)}` : 'строки rearm-refused нет');
    // 🔴 ВОТ СТРОКА, КОТОРАЯ ОТВЕЧАЕТ ЗА СРОК, и она доказана красным: со снятым сроком прогон
    // досиживает дедлайн судьи, и она краснеет. 1,2 с срока против 5 с прогона — асимметрия
    // намеренная, без неё блок мерил бы конец прогона, а не конец окна.
    ok('срок окна: отказ пришёл от ОКНА, а не от конца прогона — задолго до дедлайна судьи',
      elapsed < 3000, `прогон занял ${elapsed} мс при дедлайне судьи 5000 мс`);
    // Прежнее поведение целиком: судья выходит неперевзведённым, полоса встаёт. Срок НЕ ослабляет
    // защиту — он только называет вслух то, что раньше кончалось истечением всего окна судьи.
    ok('срок окна: судья вышел НЕПЕРЕВЗВЕДЁННЫМ — прежнее поведение, только названное вслух',
      r.tripped === true && r.rearms === 0,
      `вышел неперевзведённым: ${r.tripped} · перевзведений ${r.rearms}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚡ Ш3 — ВНУТРИ ОКНА СУДЬЯ НАБЛЮДАЕТ: СРАБАТЫВАНИЕ НЕВОЗМОЖНО, ХОТЯ УДАРОВ НЕТ ВОВСЕ
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // 🔴 БЛОК РОДИЛСЯ ИЗ ЗЕЛЁНОЙ МУТАЦИИ, А НЕ ИЗ ПЛАНА ([[EXP-0205]]). Мутация M3 — перенести
  // `resetForRearm` со ВЗВЕДЕНИЯ на вход в окно, то есть нарушить §4b(2) плана 88, — не покрасила
  // НИ ОДНОГО из 99 блоков: в остальных фикстурах удары возобновляются вместе с рукой 2, и
  // протухший `lastBeatMs` там нечем поймать. Здесь удары НЕ возобновляются — ровно как на живом
  // пути, где рука 1 убила прожиг и бить стало некому (§3 плана 88). `resetForRearm` снимает
  // `tripOutcomes`, а это и есть взведение: сделай его на входе — и судья ударит ВНУТРИ окна, по
  // машине, которую сам же лечит, и штормом 04.09 (шесть срабатываний за 21 с) уже собственного
  // изготовления.
  {
    const dgram = await import('node:dgram');
    const os = await import('node:os');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fuse-halfopen-observe-'));
    const journalPath = path.join(tmp, 'judge.jsonl');
    let readyPort = null;
    let handSpawns = 0;
    let feeding = true;
    const sender = dgram.createSocket('udp4');
    const receipt = '{"phase":"outcome","hand":2,"action":"stock-voltage-verified","ok":true,"ms":1870}';
    const judgeDone = runJudge({
      // Окно судьи (1,2 с) КОРОЧЕ окна здоровья, считая от срабатывания: взведения тут не будет ни
      // при какой погоде, и блок говорит ровно об одном — сколько раз ударила защита.
      beatPort: 0, armNMs: 60, burnPid: 31337, journalPath, seconds: 1.2,
      healthySeconds: 1,
      spawnSyncFn: () => ({ status: 0 }),
      killFn: (pid, sig) => { if (sig === 0) throw new Error('ESRCH'); },
      // Рука 2 запускается, но УДАРЫ НЕ ВОЗВРАЩАЕТ: нагрузка снята, бить некому.
      spawnFn: () => { handSpawns += 1; return { pid: 4242, unref() {} }; },
      isAliveFn: () => true,
      readLinesFn: () => Array.from({ length: handSpawns }, () => receipt),
      onReady: ({ port }) => { readyPort = port; },
    });
    await new Promise((res) => { setTimeout(res, 50); });
    const feeder = setInterval(() => {
      if (readyPort && feeding) sender.send(Buffer.from([0x01]), readyPort, '127.0.0.1');
    }, 5);
    await new Promise((res) => { setTimeout(res, 250); });
    feeding = false;                                   // тишина → одно срабатывание → ПОЛУОТКРЫТО
    const r = await judgeDone;
    clearInterval(feeder);
    sender.close();
    ok('Ш3 §4a: в полуоткрытом окне судья НАБЛЮДАЕТ — при полной тишине ударов срабатывание ровно ОДНО',
      r.trips === 1 && r.rearms === 0,
      `трипов ${r.trips} (ждали 1) · перевзведений ${r.rearms} · вышел неперевзведённым: ${r.tripped}`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ⚡ Ш3 — ПРОСПАННОЕ ОКНО НЕ ЗДОРОВАЯ СЕКУНДА: замри судья на две секунды, счёт СБРАСЫВАЕТСЯ
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  //
  // 🔴 ВТОРАЯ ЗЕЛЁНАЯ МУТАЦИЯ (M6), И ОНА ОПАСНЕЕ ПЕРВОЙ. `aliveTicks` считает такты ОТ ПРЕДЫДУЩЕГО
  // сброса, а не за секунду; замри машина на две секунды — и накопленные ДО заморозки такты лягут
  // в одну закрытую строку, где прочитаются как «здоровая секунда». То есть замершая машина
  // выглядела бы ЗДОРОВЕЕ заикающейся, и окно пропустило бы ровно тот случай, ради которого
  // заведено. Здесь событийный цикл замораживается по-настоящему (`Atomics.wait` — судья живёт в
  // ЭТОМ процессе), и счёт обязан обнулиться на проспанном окне.
  {
    const dgram = await import('node:dgram');
    const os = await import('node:os');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fuse-halfopen-slept-'));
    const journalPath = path.join(tmp, 'judge.jsonl');
    let readyPort = null;
    let handSpawns = 0;
    let feeding = true;
    const sender = dgram.createSocket('udp4');
    const receipt = '{"phase":"outcome","hand":2,"action":"stock-voltage-verified","ok":true,"ms":1870}';
    const judgeDone = runJudge({
      beatPort: 0, armNMs: 60, burnPid: 31337, journalPath, seconds: 3,
      // Уставка 30 при измеренных 64…65: заморозка обязана сорвать окно ПРОСПАННЫМ ОКНОМ, а не
      // тем, что тактов случайно не хватило, — иначе блок доказывал бы не то, что назван доказывать.
      healthySeconds: 1,
      spawnSyncFn: () => ({ status: 0 }),
      killFn: (pid, sig) => { if (sig === 0) throw new Error('ESRCH'); },
      spawnFn: () => { handSpawns += 1; return { pid: 4242, unref() {} }; },
      isAliveFn: () => true,
      readLinesFn: () => Array.from({ length: handSpawns }, () => receipt),
      onReady: ({ port }) => { readyPort = port; },
    });
    await new Promise((res) => { setTimeout(res, 50); });
    const feeder = setInterval(() => {
      if (readyPort && feeding) sender.send(Buffer.from([0x01]), readyPort, '127.0.0.1');
    }, 5);
    await new Promise((res) => { setTimeout(res, 250); });
    feeding = false;                                   // t≈300: срабатывание ≈360, окно до ≈1360
    await new Promise((res) => { setTimeout(res, 1000); });
    // t≈1300: МАШИНА ЗАМИРАЕТ НА 1,4 с — событийный цикл встал, судья вместе с ним. Проснувшись,
    // он закроет окно, накопленное ДО заморозки, и обязан увидеть проспанные границы.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1400);
    const r = await judgeDone;
    clearInterval(feeder);
    sender.close();
    const alive = readFileSync(journalPath.replace(/\.jsonl$/u, '-alive.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l));
    ok('Ш3: проспанное окно СБРАСЫВАЕТ накопление — замершая машина не выглядит здоровее заикающейся',
      r.rearms === 0 && r.tripped === true,
      `перевзведений ${r.rearms} (ждали 0) · строка жизни: ${alive.map((a) => `${a.t}:${a.ticks}т/зазор ${a.worstGapMs}`).join(' · ')}`);
  }

  // ---- pidfile end-to-end: the file appears AFTER the judge starts, and the trip still kills ITS pid
  {
    const dgram = await import('node:dgram');
    const os = await import('node:os');
    const { writeFileSync: wf } = await import('node:fs');
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'fuse-pidfile-e2e-'));
    const pf = path.join(tmp, 'burn-carrier.pid');
    const journalPath = path.join(tmp, 'judge.jsonl');
    const killed = [];
    let readyPort = null;
    const sender = dgram.createSocket('udp4');
    const judgeDone = runJudge({
      beatPort: 0, armNMs: 60, burnPid: null, burnPidFile: pf, journalPath, seconds: 5,
      spawnSyncFn: () => ({ status: 0 }),
      killFn: (pid, sig) => { if (sig === 'SIGKILL') killed.push(pid); else throw new Error('ESRCH'); },
      spawnFn: () => ({ pid: 1, unref() {} }),
      onReady: ({ port }) => { readyPort = port; },
    });
    await new Promise((res) => setTimeout(res, 50));
    const feeder = setInterval(() => { if (readyPort) sender.send(Buffer.from([0x01]), readyPort, '127.0.0.1'); }, 5);
    await new Promise((res) => setTimeout(res, 120));
    wf(pf, '31415\n', 'utf8'); // the carrier is born LONG after the judge — a start-time read finds nothing
    await new Promise((res) => setTimeout(res, 120));
    clearInterval(feeder);
    const result = await judgeDone;
    sender.close();
    ok('пид-файл, сквозной: судья трипнул и убил pid, записанный ПОСЛЕ его старта — чтение в момент трипа',
      result.tripped && JSON.stringify(killed) === '[31415]');
  }

  // ---- gap analysis (plans/56 step 2): the sawtooth arithmetic, pinned before any live floor
  ok('зазоры из кольца — локальные максимумы пилы, хвост без удара НЕ зазор', (() => {
    const rows = [0, 2, 4, 0.5, 2.5, 4.5, 6.5, 1, 3, 5].map((v) => ({ beatSilenceMs: v }));
    return JSON.stringify(gapsFromRing(rows)) === '[4,6.5]';
  })());
  ok('зазоры: null-такты (до первого удара) не рождают зазор', (() => {
    const rows = [null, null, 0, 2, 0.5].map((v) => ({ beatSilenceMs: v }));
    return JSON.stringify(gapsFromRing(rows)) === '[2]';
  })());
  ok('distStats несёт медиану, p90, p99 и max ВМЕСТЕ; пустой список — нули честно null', (() => {
    const d = distStats([1, 2, 3, 4, 100]);
    const e = distStats([]);
    return d.medianMs === 3 && d.maxMs === 100 && d.p90Ms === 100 && e.maxMs === null && e.p90Ms === null && e.n === 0;
  })());

  // ---- вход 2: вывод M из формы (P66-AC4) — порог не константа и не догадка
  ok('M выводится ИЗ ФОРМЫ: две нагрузки — два разных порога, и оба ≥ 3× своего такта', (() => {
    const f = deriveArmMMs('furnace'); const s = deriveArmMMs('sdc_fma');
    return f !== s && f >= 3 * PROGRESS_TICK_MAX_MS.furnace && s >= 3 * PROGRESS_TICK_MAX_MS.sdc_fma;
  })());
  ok('M незнакомой нагрузки — ОТКАЗ, а не догадка (выдуманный порог убивает работу владельца)', (() => {
    try { deriveArmMMs('несуществующая'); return false; } catch { return true; }
  })());
  ok('M «furnace» лежит МЕЖДУ своим тактом и роковым остановом удушения (993 ∈ (330,68 · 2070))', (() => {
    const m = deriveArmMMs('furnace');
    return m > PROGRESS_TICK_MAX_MS.furnace && m < 2070;
  })());
  // ---- ворота входа 2 сквозным прогоном судьи (оплачено ложным трипом 2026-08-29)
  {
    const os = await import('node:os');
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'fuse-gate-'));
    // Прогресс молчит ВСЁ время прогона, вход 2 взведён на 100 мс — трипнуть обязано, если бы не
    // ворота. Файла сердцебиения нет: «прожига нет» ⇒ тишина законна.
    const noBurn = await runJudge({
      beatPort: 0, armNMs: null, armMMs: 100, burnPid: null,
      progressFile: path.join(outDir, 'нет-такого-файла.txt'),
      journalPath: path.join(outDir, 'gate-a.jsonl'), seconds: 0.6,
      spawnSyncFn: () => ({ status: 0 }), spawnFn: () => ({ pid: 1, unref() {} }), log: () => {},
      onReady: ({ port }) => {
        // Один удар прогресса в начале — источник ПРОВЕДЁН (иначе сторож `progressWired` закроет
        // вопрос сам, и блок доказал бы не то).
        const dgram = require('node:dgram'); const s = dgram.createSocket('udp4');
        s.send(Buffer.from([0x02]), port, '127.0.0.1', () => s.close());
      },
    });
    ok('ВОРОТА входа 2: прогресс молчит, но прожига НЕТ — трипа нет (тишина между ступенями законна)',
      noBurn.tripped === false, `трипнул: ${JSON.stringify(noBurn.tripOutcomes)}`);

    // ---- `bugs/117` ДЫРА 2: ворота ГАСЯТ источник, а не переводят часы ------------------------
    //
    // Прежний код писал здесь `lastProgressMs = now`, и тишина начинала счёт заново — снова до M,
    // снова в эти ворота, и так весь прогон. Величина упиралась в собственный порог и переставала
    // что-либо различать (замер инцидента: max 1179,58 при уставке 1177, 78 пересечений).
    //
    // 🔴 ЧЕМ ЭТОТ БЛОК КРАСНЕЕТ НА СЛОМАННОЙ ВЕРСИИ: верни `lastProgressMs = now` — и кольцо
    // наполнится ПИЛОЙ ненулевых значений до самого конца прогона; здесь их единицы, а хвост
    // кольца пуст. Считается не «есть ли null», а СКОЛЬКО тиков успело намерить: пила даёт их
    // на порядок больше, и разделяет версии именно счёт.
    {
      const rows = readFileSync(noBurn.ringPath, 'utf8').trim().split('\n')
        .map((l) => JSON.parse(l)).filter((r) => r.progressSilenceMs !== undefined);
      const measured = rows.filter((r) => r.progressSilenceMs !== null);
      const tail = rows.slice(-3);
      // ГРАНИЦА ВЫВЕДЕНА ИЗ ПОРОГА, А НЕ ПОДОБРАНА: тишина мерится ровно один подъём до M, и по
      // времени это ≈ M. Пила старой версии размазана по ВСЕМУ прогону. Здесь M = 100 мс против
      // прогона 600 мс — зазор шестикратный, и запас 2× его не съедает. (Считать ТИКИ нельзя:
      // такт судьи под нагрузкой батареи плавает, и число тиков пришлось бы калибровать.)
      const spanMs = measured.length ? measured[measured.length - 1].t - measured[0].t : 0;
      ok('bugs/117 ДЫРА 2: погашённый источник НЕ мерится — тишина считается ОДИН подъём, а не пилой',
        rows.length > 5 && measured.length > 0 && spanMs <= 2 * 100,
        `размах намеренной тишины ${round2(spanMs)} мс при пороге 100 мс и прогоне 600 мс `
        + `(тиков в кольце ${rows.length}, из них мерящих ${measured.length}); `
        + `пила старой версии размазала бы их на весь прогон`);
      ok('bugs/117 ДЫРА 2: хвост кольца — null, то есть «мерить было нечего», а не клипованное число',
        tail.length === 3 && tail.every((r) => r.progressSilenceMs === null),
        `хвост: ${JSON.stringify(tail.map((r) => r.progressSilenceMs))}`);
    }

    // ПАРНЫЙ блок, и без него первый ничего не стоит: он прошёл бы и на вовсе сломанном входе 2.
    // Та же тишина, но файл сердцебиения СУЩЕСТВУЕТ — прожиг идёт, и молчание работы есть отказ.
    mkdirSync(outDir, { recursive: true });
    const live = path.join(outDir, 'burn-progress.txt');
    closeSync(openSync(live, 'w'));
    const inFlight = await runJudge({
      beatPort: 0, armNMs: null, armMMs: 100, burnPid: null,
      progressFile: live,
      journalPath: path.join(outDir, 'gate-b.jsonl'), seconds: 2,
      spawnSyncFn: () => ({ status: 0 }), spawnFn: () => ({ pid: 1, unref() {} }), log: () => {},
      onReady: ({ port }) => {
        const dgram = require('node:dgram'); const s = dgram.createSocket('udp4');
        s.send(Buffer.from([0x02]), port, '127.0.0.1', () => s.close());
      },
    });
    ok('ВХОД 2 РАБОТАЕТ: тот же простой прогресса при ИДУЩЕМ прожиге — трип с причиной progress-stall [ДОКАЗЫВАЕТ --arm-m]',
      inFlight.tripped === true && inFlight.tripOutcomes?.[0]?.cause === 'progress-stall',
      `исход: ${JSON.stringify(inFlight.tripOutcomes)}`);
  }
  // ---- ВХОД 3 (`plans/91` Ш1, AC1): милливатты пробы доезжают до судьи --------------------------
  //
  // Карта здесь не нужна: удар входа 3 — это пять байт на петле, и блок шлёт их сам. Проверяется
  // ровно проводка (значение доехало и легло в улику), а НЕ порог: порог выводится из архива на
  // Ш3, и назначать его здесь значило бы выдумать число в предохранителе.
  //
  // 🔴 ЧЕМ КРАСНЕЕТ: убери у судьи разбор полезной нагрузки (`buf.length >= 5`) — и `powerMw`
  // останется `null` во всех тактах, а `minPowerMw` в строке жизни не появится. Оба ok ниже
  // покраснеют, и второй разборчивее первого: он требует именно МИНИМУМ, а не последнее значение.
  {
    const os = await import('node:os');
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'fuse-power-'));
    const out = path.join(outDir, 'power.jsonl');
    const sent = [280_000, 61_000, 84_000]; // милливатты: здоровый прожиг → обвал 08.09 → он же
    const run = await runJudge({
      beatPort: 0, armNMs: null, armMMs: null, burnPid: null,
      journalPath: out, seconds: 1.4,
      spawnSyncFn: () => ({ status: 0 }), spawnFn: () => ({ pid: 1, unref() {} }), log: () => {},
      onReady: ({ port }) => {
        const dgram = require('node:dgram'); const s = dgram.createSocket('udp4');
        let i = 0;
        const t = setInterval(() => {
          if (i >= sent.length) { clearInterval(t); s.close(); return; }
          const b = Buffer.alloc(5); b[0] = 0x01; b.writeUInt32LE(sent[i], 1); i += 1;
          s.send(b, port, '127.0.0.1');
        }, 120);
      },
    });
    const ring = readFileSync(run.ringPath, 'utf8').trim().split('\n')
      .map((l) => JSON.parse(l)).filter((r) => r.powerMw !== undefined);
    const withPower = ring.filter((r) => r.powerMw !== null);
    ok('ВХОД 3 (plans/91 Ш1): милливатты удара доехали до судьи и легли ПОТАКТНО в кольцо',
      withPower.length > 0 && sent.includes(withPower[withPower.length - 1].powerMw),
      `тактов с мощностью ${withPower.length} из ${ring.length}; последнее значение `
      + `${withPower.length ? withPower[withPower.length - 1].powerMw : 'нет'} (слали ${sent.join(', ')})`);

    const aliveRows = existsSync(out.replace(/\.jsonl$/u, '-alive.jsonl'))
      ? readFileSync(out.replace(/\.jsonl$/u, '-alive.jsonl'), 'utf8').trim().split('\n')
        .map((l) => JSON.parse(l)).filter(Boolean)
      : [];
    const withMin = aliveRows.filter((r) => r.minPowerMw !== null && r.minPowerMw !== undefined);
    ok('ВХОД 3: строка жизни несёт МИНИМУМ за окно — обвал, а не последнее значение',
      withMin.length > 0 && withMin.every((r) => sent.includes(r.minPowerMw))
      && Math.min(...withMin.map((r) => r.minPowerMw)) === Math.min(...sent),
      `строк жизни ${aliveRows.length}, с минимумом ${withMin.length}: `
      + `${JSON.stringify(withMin.map((r) => r.minPowerMw))} (слали ${sent.join(', ')})`);
    try { rmSync(outDir, { recursive: true, force: true }); } catch { /* песочница во временных */ }
  }

  // ---- ВХОД 3 (`plans/91` Ш4, AC3): ОБВАЛ МОЩНОСТИ, СЫГРАННЫЙ ПО ЗАПИСИ НАСТОЯЩЕЙ СМЕРТИ --------
  //
  // Обе фикстуры — ЖИВЫЕ пробы 2026-09-08 с одной частоты 3067 МГц и СОСЕДНИХ ступеней:
  // 935 мВ прошло, 925 мВ убило машину синим экраном. Различаются только напряжением, поэтому
  // контроль здесь не «какой-то здоровый прогон», а тот самый, что был за пять секунд до смерти.
  //
  // 🔴 БЕЗ ПАРНОГО БЛОКА ПЕРВЫЙ НЕ СТОИТ НИЧЕГО: вход, трипающий на всём подряд, прошёл бы его.
  // Замер прибора `npm run powerfloor` на этих двух: доля 0,217 против 0,855.
  {
    const os = await import('node:os');
    const fixDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
    const powersFrom = (file) => readFileSync(path.join(fixDir, file), 'utf8').trim().split('\n')
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((o) => o?.sample && typeof o.sample['power.draw.instant'] === 'number'
        && o.sample['utilization.gpu'] >= 90)
      .map((o) => Math.round(o.sample['power.draw.instant'] * 1000));

    const play = async (file, stepMs) => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'fuse-p3-'));
      const live = path.join(dir, 'burn-progress.txt');
      closeSync(openSync(live, 'w'));            // прожиг ИДЁТ — иначе ворота погасят вход 3
      const mws = powersFrom(file);
      const r = await runJudge({
        beatPort: 0, armNMs: null, armMMs: null, armPowerRatio: POWER_COLLAPSE_RATIO,
        burnPid: null, progressFile: live,
        journalPath: path.join(dir, 'p3.jsonl'), seconds: (mws.length * stepMs) / 1000 + 0.4,
        spawnSyncFn: () => ({ status: 0 }), spawnFn: () => ({ pid: 1, unref() {} }), log: () => {},
        onReady: ({ port }) => {
          const dgram = require('node:dgram'); const s = dgram.createSocket('udp4');
          let i = 0;
          const t = setInterval(() => {
            if (i >= mws.length) { clearInterval(t); s.close(); return; }
            const b = Buffer.alloc(5); b[0] = 0x01; b.writeUInt32LE(mws[i], 1);
            s.send(b, port, '127.0.0.1');
            s.send(Buffer.from([0x02]), port, '127.0.0.1'); // прогресс жив: вход 2 судить не должен
            i += 1;
          }, stepMs);
        },
      });
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* песочница во временных */ }
      return { r, mws };
    };

    const death = await play('power_collapse_3067mhz_death__captured.jsonl', 100);
    ok('ВХОД 3 (plans/91 Ш4): ЗАПИСЬ НАСТОЯЩЕЙ СМЕРТИ 3067 МГц / 925 мВ даёт трип power-collapse [ДОКАЗЫВАЕТ --arm-p]',
      death.r.tripped === true && death.r.tripOutcomes?.[0]?.cause === 'power-collapse',
      `трип ${death.r.tripped}, причина ${death.r.tripOutcomes?.[0]?.cause ?? 'нет'}; `
      + `милливатты ${death.mws.join(' ')}`);

    const alive = await play('power_healthy_3067mhz_935mv__captured.jsonl', 80);
    ok('ВХОД 3: СОСЕДНЯЯ ЗДОРОВАЯ ступень 935 мВ той же частоты трипа НЕ даёт (парный контроль)',
      alive.r.tripped === false,
      `трипнул на здоровой: ${JSON.stringify(alive.r.tripOutcomes)}; милливатты ${alive.mws.join(' ')}`);

    // =============================================================================================
    // `plans/93` — ЧЕТЫРЕ НАБОРА ИЗ ПОЛЯ. Первая в проекте фикстура по Ш4 `bugs/127`.
    //
    // 🔴 ЗАЧЕМ ОНИ, ЕСЛИ ДВА БЛОКА ВЫШЕ УЖЕ «ДОКАЗЫВАЮТ» ВХОД 3. Оба блока выше держат файл
    // сердцебиения ЖИВЫМ (`openSync(live,'w')`), поэтому ворота ложного трипа в них не срабатывают
    // никогда. Они доказывают вход на данных, где нет переменной, которая его разоружает, — и
    // потому зеленели всё время, пока вход 3 на живой карте не трипал ни разу. Наборы ниже питаются
    // ЗАПИСЯМИ ЧЁРНОГО ЯЩИКА целиком: и мощностью, и проводом прогресса.
    // =============================================================================================
    {
      const evid = (f) => path.join(
        path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bugs', 'evidence', f,
      );
      const load = (f) => readFileSync(evid(f), 'utf8').trim().split('\n')
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const DEATH = load('p93_ring_death_2026-09-08T17-53.jsonl');
      const R0942 = load('p93_ring_rescue_2026-09-08T09-42.jsonl');
      const R0959 = load('p93_ring_rescue_2026-09-08T09-59.jsonl');
      // Боевое взведение того вечера — из строки 20 журнала прогона 17:53.
      const LIVE = { armNMs: 60, armMMs: 1177 };

      // ---- ВЕРНОСТЬ ПРОИГРЫВАТЕЛЯ: он СОВПАДАЕТ с живым путём, а не похож на него --------------
      // Строки кольца — ВЫХОД живого судьи. Значит пересчёт обязан воспроизвести их до значения;
      // расхождение хоть на одном такте означает, что все наборы ниже судят не тот путь.
      {
        let ticks = 0; let diff = 0; let firstBad = null;
        for (const rows of [DEATH, R0942, R0959]) {
          const sorted = [...rows].sort((a, b) => a.t - b.t);
          const rep = replayRing(sorted, {});
          for (let i = 0; i < sorted.length; i += 1) {
            ticks += 1;
            const was = sorted[i].powerRatio === undefined ? null : sorted[i].powerRatio;
            if (was !== rep.ticks[i].powerRatio) {
              diff += 1;
              if (!firstBad) firstBad = `t=${sorted[i].t} записано ${was} пересчитано ${rep.ticks[i].powerRatio}`;
            }
          }
        }
        ok('`plans/93` ВЕРНОСТЬ ПРОИГРЫВАТЕЛЯ: доля пересчитана по трём записям и совпала с записанной',
          ticks === 14280 && diff === 0, `тактов ${ticks}, разошлось ${diff}${firstBad ? ` — ${firstBad}` : ''}`);
      }

      // ---- НАБОР А — БОЕВАЯ СМЕРТЬ 17:53: кандидат в трип есть, и фора ОДИННАДЦАТЬ СЕКУНД --------
      {
        const rep = replayRing(DEATH, LIVE);
        const first = rep.firstTrip;
        const last = rep.ticks[rep.ticks.length - 1].t;
        const fora = first ? last - first.t : 0;
        ok('`plans/93` НАБОР А: запись смерти 17:53 даёт кандидата в трип за 11 секунд до смерти',
          first !== null && first.t <= 13_100 && fora >= 11_000,
          `первый трип ${first ? `${first.cause} на t=${first.t.toFixed(0)}` : 'НЕТ'}, `
          + `последний такт ${last.toFixed(0)}, фора ${fora.toFixed(0)} мс (нужно ≥ 11000)`);
        // Вход 2 выигрывает гонку у входа 3 на 45 мс — измерено, а не предположено планом.
        const held = Math.max(...rep.ticks.map((x) => x.lowForMs));
        ok('`plans/93` НАБОР А: вход 3 накопил 455 мс выдержки — 45 мс не дотянув до уставки 500',
          Math.round(held) === 455 && POWER_LOW_HOLD_MS === 500,
          `накоплено ${held.toFixed(0)} мс при уставке ${POWER_LOW_HOLD_MS}`);
      }

      // ---- НАБОР Б — ЛОЖНЫЕ. ПЕРЕСТРОЕН ПО `bugs/130` AC3: БАЗА ОБЯЗАНА БЫТЬ НЕ ПУСТОЙ --------
      //
      // 🔴 Прежняя редакция печатала «0 ложных» и была ПУСТА: судимое окно кончалось на первом
      // живом трипе, и ни один нормальный конец прожига в него не попадал. На этой пустоте была
      // принята правка, давшая 9 ложных спасений и 6 изготовленных стен. Теперь набор СНАЧАЛА
      // доказывает, что ему есть что судить, и только потом судит.
      {
        const ends = burnEnds(load('p94_ring_nine_rescues_2026-09-08T19-21.jsonl'), LIVE);
        ok('🔴 `bugs/130` AC3: база ложных НЕ ПУСТА — в записи найдены настоящие концы прожига',
          ends.length >= 8, `концов прожига в базе: ${ends.length} (нужно ≥ 8) — пустая база не смеет сойти за чистую`);

        // Замер, отменивший `plans/93`: на ШТАТНОМ конце прожига мощность падает глубже порога и
        // держится вдесятеро дольше уставки. Значит ни глубина, ни длительность не различают
        // конец прожига и смерть — и любое правило, построенное на них, ложно по построению.
        const worst = ends.reduce((a, e) => (e.holdMs > a ? e.holdMs : a), 0);
        const deepest = ends.reduce((a, e) => (e.ratio !== null && e.ratio < a ? e.ratio : a), 1);
        ok('🔴 `bugs/130`: на штатном конце прожига доля ГЛУБЖЕ порога, а выдержка ДЛИННЕЕ уставки',
          deepest <= POWER_COLLAPSE_RATIO && worst >= POWER_LOW_HOLD_MS * 5,
          `самая глубокая доля ${deepest}, самая долгая выдержка ${worst.toFixed(0)} мс `
          + `(порог ${POWER_COLLAPSE_RATIO}, уставка ${POWER_LOW_HOLD_MS})`);

        // ⚡ СТОРОЖ РЕГРЕССА. Каждый настоящий конец прожига подаётся воротам С ЕГО ИЗМЕРЕННОЙ
        // выдержкой. Вернуть снятое правило «выдержка идёт ⇒ не отменять» — и все восемь покраснеют.
        const leaked = ends.filter((e) => cancelsFalseTrip({
          cause: 'power-collapse', burnAlive: false, lowSinceMs: e.holdMs > 0 ? e.t - e.holdMs : null,
        }) !== true);
        ok('🔴 `bugs/130` AC3 СТОРОЖ РЕГРЕССА: ворота гасят трип на ВСЕХ настоящих концах прожига',
          leaked.length === 0,
          `пропущено концов: ${leaked.length} из ${ends.length} — вернулись ложные спасения 19:21`);

        // Прежняя проверка сохранена: на записях 09:42 и 09:59 вход 3 не накапливает выдержки
        // до первого живого трипа. Она верна, но САМА ПО СЕБЕ ничего не доказывает — см. выше.
        let holds = 0; const detail = [];
        for (const [name, rows] of [['09:42', R0942], ['09:59', R0959]]) {
          const rep = replayRing(rows, LIVE);
          const upto = rep.firstTrip ? rep.ticks.filter((x) => x.t <= rep.firstTrip.t) : rep.ticks;
          const t3 = upto.filter((x) => x.cause === 'power-collapse').length;
          holds += t3;
          detail.push(`${name}: трипов входа 3 ${t3}`);
        }
        ok('`plans/93` НАБОР Б (прежняя часть): до первого живого трипа вход 3 не срабатывает',
          holds === 0, detail.join(' · '));
      }

      // ---- ПОЛЕВЫЕ ДОКАЗАТЕЛЬСТВА ВХОДОВ 1 И 2 (`plans/93` Ш7, договор `armed-proven-lint`) ------
      // Метка `[ПОЛЕ --arm-X]` означает: вход судится ЗАПИСЬЮ ЧЁРНОГО ЯЩИКА со всеми переменными,
      // какие были в бою, а не рядом чисел, набранным руками. Вход 3 такого блока НЕ ИМЕЕТ и стоит
      // в долге (`decisions/armed-proven-field-baseline.json`): полевого трипа входа 3 в проекте
      // не существует, и выдумать его значило бы повторить ту самую ложь, против которой сторож заведён.
      {
        // [ПОЛЕ --arm-n] — вход 1 на записи 09:59: молчание канала, настоящий трип живого прогона.
        const rep = replayRing(R0959, LIVE);
        const first = rep.firstTrip;
        ok('ВХОД 1 ПОЛЕМ: запись 09:59 даёт трип beat-silence — та же причина, что записал живой судья',
          first !== null && first.cause === 'beat-silence',
          `первый трип ${first ? `${first.cause} на t=${first.t.toFixed(0)}` : 'НЕТ'}`);
      }
      {
        // [ПОЛЕ --arm-m] — вход 2 на записи смерти 17:53: простой прогресса при уставке M=1177 мс.
        const rep = replayRing(DEATH, LIVE);
        const first = rep.firstTrip;
        ok('ВХОД 2 ПОЛЕМ: запись смерти 17:53 даёт кандидата progress-stall — тот, что ворота отменили',
          first !== null && first.cause === 'progress-stall' && first.t <= 13_100,
          `первый трип ${first ? `${first.cause} на t=${first.t.toFixed(0)}` : 'НЕТ'}`);
      }
      {
        // 🔴 ЗАМЕР, А НЕ ДОКАЗАТЕЛЬСТВО ВХОДА 3 — И ЭТО ГЛАВНЫЙ УРОК ВЕЧЕРА (`bugs/130`).
        //
        // Полчаса здесь стояла полевая метка входа 3 и надпись «первый живой трип за проект».
        // Оба `power-collapse` прогона 19:21 случились на ШТАТНЫХ КОНЦАХ ПРОЖИГА, пропущенных
        // ошибочной правкой ворот. Метка снята, долг возвращён; блок оставлен как ЗАМЕР записи.
        //
        // ⚠️ ЧТО ПРОВЕРЯЕТСЯ ЗДЕСЬ, А ЧТО НЕТ: проигрыватель не моделирует спасение и перевзведение,
        // поэтому число трипов у него больше живого (после обвала условие держится каждый такт).
        // Судится ПЕРВОЕ достижение условия — глубина и выдержка, — и оно совпадает с живым.
        // 🔴 ПОЛЕВАЯ МЕТКА ВХОДА 3 СНЯТА 2026-09-08 19:5x — `bugs/130`. Она стояла здесь минуты и
        // была НЕПРАВДОЙ: два `power-collapse` прогона 19:21 случились на ШТАТНЫХ КОНЦАХ ПРОЖИГА,
        // пропущенных моей же ошибочной правкой ворот. Полевого трипа входа 3 у проекта по-прежнему
        // НЕТ, и он снова в долге. Блок оставлен как ЗАМЕР записи, а не как доказательство входа.
        const rep = replayRing(load('p94_ring_nine_rescues_2026-09-08T19-21.jsonl'), LIVE);
        const pc = rep.trips.filter((x) => x.cause === 'power-collapse');
        ok('🔴 `bugs/130` ЗАМЕР: условие входа 3 достигается и на ШТАТНОМ конце прожига — это не доказательство входа',
          pc.length > 0 && pc[0].powerRatio <= POWER_COLLAPSE_RATIO && pc[0].lowForMs >= POWER_LOW_HOLD_MS,
          pc.length
            ? `первый на t=${pc[0].t.toFixed(0)} доля ${pc[0].powerRatio} выдержка ${pc[0].lowForMs.toFixed(0)} мс`
            : 'трипов power-collapse на записи НЕТ');
      }

      // ---- НАБОР В — ВОРОТА ЛОЖНОГО ТРИПА, судимые настоящими числами трёх записей ---------------
      {
        ok('`plans/93` НАБОР В: ворота ОТМЕНЯЮТ трип на нормальном конце прожига (выдержка не идёт)',
          cancelsFalseTrip({ cause: 'progress-stall', burnAlive: false, lowSinceMs: null }) === true
          && cancelsFalseTrip({ cause: 'power-collapse', burnAlive: false, lowSinceMs: null }) === true,
          'отмена на нормальном конце не сработала — вернутся ложные, оплаченные bugs/117');
        // 🔴 БЫЛО НАОБОРОТ И БЫЛО НЕВЕРНО (`bugs/130`). Идущая выдержка НЕ отличает смерть от
        // штатного конца прожига: на конце мощность падает точно так же. Опровергнуто прогоном
        // 19:21 — девять ложных спасений на девяти здоровых прожигах.
        ok('🔴 `bugs/130`: идущая выдержка НЕ мешает отмене — на штатном конце прожига мощность падает так же',
          cancelsFalseTrip({ cause: 'progress-stall', burnAlive: false, lowSinceMs: 12_599 }) === true
          && cancelsFalseTrip({ cause: 'power-collapse', burnAlive: false, lowSinceMs: 12_599 }) === true,
          'ворота пропустили трип при идущей выдержке — вернулись девять ложных спасений 19:21');
        ok('`plans/93` НАБОР В: живой прожиг отмены не вызывает, чужая причина воротам не подсудна',
          cancelsFalseTrip({ cause: 'progress-stall', burnAlive: true, lowSinceMs: null }) === false
          && cancelsFalseTrip({ cause: 'beat-silence', burnAlive: false, lowSinceMs: null }) === false,
          'ворота вмешались туда, где не их дело');
      }

      // ---- НАБОР Г — ГОНКА: разрыв «обвал → пропажа прожига» не должен решать исход -------------
      // Прежнее поведение зависело от разрыва: успела выдержка добрать уставку — трип, не успела —
      // разоружение. Новое правило от разрыва НЕ ЗАВИСИТ: важно наличие выдержки, а не её длина.
      {
        // 🔴 БЫЛО НАОБОРОТ И БЫЛО НЕВЕРНО (`bugs/130`): разрыв «обвал → пропажа прожига» НЕ несёт
        // различающего сведения — он одинаков у смерти 17:53 (8,4 с прожига) и у девяти штатных
        // концов 19:21 (8,9 с). Признак отвергнут замером, а не мнением.
        const gaps = [0, 100, 250, 455, 600];
        const bad = gaps.filter((g) => cancelsFalseTrip({
          cause: 'power-collapse', burnAlive: false, lowSinceMs: g === 0 ? 0 : 13_053 - g,
        }) !== true);
        ok('`bugs/130` НАБОР Г: разрыв обвал→пропажа прожига НИЧЕГО не различает — отмена стоит при любом',
          bad.length === 0, `не отменил на разрывах: ${bad.join(', ')} мс`);
      }
    }

    // ---- ВЫДЕРЖКА: ОДИНОЧНЫЙ ВЫБРОС ТЕЛЕМЕТРИИ НЕ СМЕЕТ УБИТЬ ВЕЧЕР ВЛАДЕЛЬЦА ------------------
    //
    // 🔴 ЭТОТ БЛОК НАПИСАН ПОТОМУ, ЧТО МУТАЦИЯ НАШЛА ДЫРУ В МОИХ ЖЕ БЛОКАХ: `POWER_LOW_HOLD_MS = 0`
    // не покрасил НИЧЕГО, то есть выдержку не проверял никто. Ложное срабатывание для владельца
    // дороже пропуска — оно останавливает работу, — и оставить его без блока было нельзя.
    //
    // Провал длиной в ОДИН замер (100 мс) короче выдержки (500 мс) и обязан быть проигнорирован.
    {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'fuse-p3s-'));
      const live = path.join(dir, 'burn-progress.txt');
      closeSync(openSync(live, 'w'));
      const mws = [280_000, 280_000, 280_000, 55_000, 280_000, 280_000, 280_000];
      const spike = await runJudge({
        beatPort: 0, armNMs: null, armMMs: null, armPowerRatio: POWER_COLLAPSE_RATIO,
        burnPid: null, progressFile: live,
        journalPath: path.join(dir, 'p3s.jsonl'), seconds: (mws.length * 100) / 1000 + 0.4,
        spawnSyncFn: () => ({ status: 0 }), spawnFn: () => ({ pid: 1, unref() {} }), log: () => {},
        onReady: ({ port }) => {
          const dgram = require('node:dgram'); const s = dgram.createSocket('udp4');
          let i = 0;
          const t = setInterval(() => {
            if (i >= mws.length) { clearInterval(t); s.close(); return; }
            const b = Buffer.alloc(5); b[0] = 0x01; b.writeUInt32LE(mws[i], 1);
            s.send(b, port, '127.0.0.1');
            s.send(Buffer.from([0x02]), port, '127.0.0.1');
            i += 1;
          }, 100);
        },
      });
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* песочница во временных */ }
      ok('ВХОД 3: ОДИНОЧНЫЙ провал короче выдержки трипа НЕ даёт — ложное дороже пропуска',
        spike.tripped === false,
        `трипнул на выбросе: ${JSON.stringify(spike.tripOutcomes)}`);
    }

    // ---- САМО ЗНАЧЕНИЕ ПОРОГА ЗАКРЕПЛЕНО ЗА УЛИКАМИ В РЕПОЗИТОРИИ ------------------------------
    //
    // 🔴 ВТОРАЯ ДЫРА, НАЙДЕННАЯ МУТАЦИЕЙ: задери порог до 0,95 — и не покраснеет НИЧЕГО. Блоки выше
    // проверяли механизм, а не калибровку. Число выведено прибором `npm run powerfloor` по архиву,
    // но `runs/` под gitignore: свежий клон не может его перепроверить, и константа осталась бы
    // висеть в воздухе.
    //
    // Здесь она привязана к ДВУМ ФИКСТУРАМ, которые в репозитории лежат. Запас 0,1 с каждой
    // стороны — чтобы порог не жался к границе: подвинется карта или запись, и блок скажет об этом
    // раньше, чем скажет живой прогон.
    {
      const ratioOf = (file) => {
        const mws = powersFrom(file);
        const peak = Math.max(...mws);
        const trough = Math.min(...mws.slice(mws.indexOf(peak) + 1));
        return trough / peak;
      };
      const dead = ratioOf('power_collapse_3067mhz_death__captured.jsonl');
      const live = ratioOf('power_healthy_3067mhz_935mv__captured.jsonl');
      ok('ВХОД 3: ПОРОГ лежит между смертью и здоровьем с запасом 0,1 с обеих сторон',
        POWER_COLLAPSE_RATIO >= dead + 0.1 && POWER_COLLAPSE_RATIO <= live - 0.1,
        `порог ${POWER_COLLAPSE_RATIO} · смерть ${dead.toFixed(3)} · здоровье ${live.toFixed(3)} — `
        + `допустимо [${(dead + 0.1).toFixed(3)}; ${(live - 0.1).toFixed(3)}]`);
    }
  }

  ok('форма БЫСТРЕЕ наблюдателя не взводится вовсе, и причина НАЗВАНА (sdc_fma: 3 мс < 150 мс)', (() => {
    const d = armMDecision('sdc_fma');
    return d.armed === false && d.armMMs === null && /мельче трёх тактов наблюдения/u.test(d.why);
  })());
  ok('формы медленнее наблюдателя взводятся, порог назван в причине (furnace · branchy)', (() => {
    const f = armMDecision('furnace'); const b = armMDecision('branchy');
    return f.armed && b.armed && f.armMMs === 993 && b.armMMs === 246 && /M = 993 мс/u.test(f.why);
  })());
  // ---- ⚡ порог следует за НИЖНЕЙ частотой полосы (`bugs/101` находка 3, поправка плана 04.09)
  //   АДРЕСАТЫ МУТАЦИЙ: снять масштаб в deriveArmMMs → «3109»; снять Math.max(1, …) → «branchy 246».
  ok('такт обратен частоте: M(furnace, полоса до 900 МГц) = 3109 мс — 993 × 2820/900, а не 993', (() => {
    const d = armMDecision('furnace', { lowestMhz: 900 });
    return d.armed && d.armMMs === 3109 && /2820 МГц/u.test(d.why) && /900 МГц/u.test(d.why);
  })());
  ok('полоса не ниже опорной частоты такта — M прежний до байта (2842 → 993; без частоты → 993)', (() => {
    const d = armMDecision('furnace', { lowestMhz: 2842 });
    return d.armMMs === 993 && armMDecision('furnace').armMMs === 993 && !/спускается/u.test(d.why);
  })());
  ok('масштаб НИКОГДА не ниже 1: максимум branchy снят на 900 МГц, полоса до 2692 не опускает M ниже 246', (() => {
    return armMDecision('branchy', { lowestMhz: 2692 }).armMMs === 246 && progressTickScale('branchy', 2692) === 1;
  })());
  ok('опорная частота такта есть у КАЖДОЙ измеренной нагрузки — масштаб без неё был бы догадкой', (() => {
    return Object.keys(PROGRESS_TICK_MAX_MS).every((w) => Number.isFinite(PROGRESS_TICK_REF_MHZ[w]) && PROGRESS_TICK_REF_MHZ[w] > 0);
  })());
  ok('всадники входа 2 — одна форма на двойник и живой путь: взведён → --arm-m + файл судье, файл пробе; наблюдение → без --arm-m; без файла → пусто', (() => {
    const armed = progressRiderArgs({ progressFile: 'F', armMMs: 1040 });
    const observe = progressRiderArgs({ progressFile: 'F' });
    const none = progressRiderArgs({});
    return JSON.stringify(armed) === JSON.stringify({ judge: ['--arm-m', '1040', '--progress-file', 'F'], probe: ['--progress-file', 'F'] })
      && JSON.stringify(observe) === JSON.stringify({ judge: ['--progress-file', 'F'], probe: ['--progress-file', 'F'] })
      && JSON.stringify(none) === JSON.stringify({ judge: [], probe: [] });
  })());

  // ---- ⚡ `plans/94` Ш4: ВОРОТА ЗАСЧИТЫВАНИЯ ЗАПИСИ. Оплачено прогоном 09.09 22:40 — стенд
  //   отработал безупречно и дал НОЛЬ материала, а понято это было после, чтением кольца.
  //   АДРЕСАТЫ МУТАЦИЙ: снять ветку `wired === 0` → «немое кольцо засчитано»;
  //   снять ветку `!progressFile` → «стенд без провода засчитан».
  ok('немое кольцо НЕ засчитано за запись фазы: провод есть, оживать было нечему', (() => {
    const rows = [{ progressSilenceMs: null, powerRatio: null }, { progressSilenceMs: null, powerRatio: null }];
    const v = recordVerdict({ rows, progressFile: 'F' });
    return v.counted === false && v.wired === 0 && /не ожил НИ РАЗУ/u.test(v.why);
  })());
  ok('стенд БЕЗ провода не засчитан, и причина названа отдельно от немого кольца (это разные беды)', (() => {
    const rows = [{ progressSilenceMs: null, powerRatio: null }];
    const v = recordVerdict({ rows, progressFile: null });
    return v.counted === false && /БЕЗ `--progress-file`/u.test(v.why) && !/не ожил НИ РАЗУ/u.test(v.why);
  })());
  ok('ожившего провода достаточно: запись засчитана, и обе величины посчитаны по кольцу', (() => {
    const rows = [
      { progressSilenceMs: null, powerRatio: null },
      { progressSilenceMs: 12, powerRatio: 0.98 },
      { progressSilenceMs: 40, powerRatio: null },
    ];
    const v = recordVerdict({ rows, progressFile: 'F' });
    return v.counted === true && v.wired === 2 && v.withRatio === 1;
  })());
  ok('живой провод при НУЛЕВОЙ доле — тоже не запись, и причина названа ОТДЕЛЬНО от немого провода', (() => {
    const rows = [{ progressSilenceMs: 10, powerRatio: null }, { progressSilenceMs: 12, powerRatio: null }];
    const v = recordVerdict({ rows, progressFile: 'F' });
    return v.counted === false && v.wired === 2 && v.withRatio === 0 && /ТРЕТЬЕЙ причине|не посчитана НИ РАЗУ/u.test(v.why);
  })());
  ok('`undefined` в строке кольца читается как «нет величины», а не как живая (старые кольца поля не несли)', (() => {
    const v = recordVerdict({ rows: [{}, {}], progressFile: 'F' });
    return v.counted === false && v.wired === 0 && v.withRatio === 0;
  })());

  // ---- ⚡ `bugs/128` AC3: СТОРОЖ ПОЧИНЕННОГО ТАКТА. Судится ЖИВОЙ фикстурой — кольцом прогона
  //   09.09 22:40, а не синтетикой: синтетика доказала бы арифметику квантиля, а стеречь надо
  //   ПРИБОР. «До» здесь тоже настоящее: 15,3-15,7 мс — квант Windows, снятый записью смерти 17:53.
  //   АДРЕСАТЫ МУТАЦИЙ: factor 2 → 10 → «сломанное кольцо зелено»; убрать ветку d.n === 0 →
  //   «пустое кольцо здорово».
  ok('живое кольцо ПОСЛЕ починки такта — зелено, и p90 совпадает с объявленным (41 259 тактов под горном)', (() => {
    const fx = path.join(fileURLToPath(new URL('../../bugs/evidence/', import.meta.url)), 'p94_ring_tick_gate_loaded_2026-09-09.jsonl');
    const rows = readFileSync(fx, 'utf8').trim().split(/\r?\n/u).map((l) => JSON.parse(l));
    const v = tickHealthVerdict({ rows });
    return v.ok === true && rows.length === 41_259 && v.p90Ms === TICK_P90_DECLARED_MS;
  })());
  ok('кольцо со сломанным тактом КРАСНЕЕТ: 15,6 мс — штатный квант Windows, то есть погашенное разрешение', (() => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ gapMs: i < 100 ? 2.1 : 15.6 }));
    const v = tickHealthVerdict({ rows });
    return v.ok === false && v.p90Ms > 5.36 && /РЕГРЕСС ТАКТА/u.test(v.why) && /refuseTimerThrottling/u.test(v.why);
  })());
  ok('порог именно ВДВОЕ: 5,36 мс проходит, 5,37 краснеет — граница названа числом, а не «около»', (() => {
    const at = (g) => tickHealthVerdict({ rows: Array.from({ length: 100 }, () => ({ gapMs: g })) }).ok;
    return at(5.36) === true && at(5.37) === false;
  })());
  ok('пустое кольцо — НЕ здоровый такт: отсутствие свидетеля не читается как отсутствие беды', (() => {
    const v = tickHealthVerdict({ rows: [{ gapMs: undefined }, {}] });
    return v.ok === false && v.p90Ms === null && /НЕ СУДИМ/u.test(v.why);
  })());

  // ---- настройка на двойнике (P65-AC3/AC5): словарь исходов и различитель «на чём трипнуло»
  ok('перелёт и роковой останов НЕ различаются по тишине трипа — различает счёт зазоров в кольце', (() => {
    // Один и тот же порог, две разные смерти: записанная тишина в обоих случаях ≈ N.
    const atPremature = judgeLiveness({ nowMs: 1000, lastBeatMs: 1000 - 62, armNMs: 60 });
    const atFatal = judgeLiveness({ nowMs: 9000, lastBeatMs: 9000 - 62, armNMs: 60 });
    return atPremature.tripped && atFatal.tripped
      && atPremature.beatSilenceMs === atFatal.beatSilenceMs;
  })());
  ok('счёт остановов до трипа: зазоры ≥ 10 мс считаются, пол канала (≤ 9,73 мс) — нет', (() => {
    const rows = [0, 2, 4, 9.7, 0.5, 2, 15, 0.5, 2, 26, 1].map((v) => ({ beatSilenceMs: v }));
    return countStallsBeforeTrip(rows) === 2; // 15 и 26; 9,7 — пол канала, не останов
  })());
  ok('удушение: трип ПОСЛЕ всех перелётов деградации — спасено; раньше — преждевременно', (() => {
    const late = classifyTuneOutcome({ scenario: 'strangle', tripped: true, stallsSurvived: 18, degradationStalls: 18 });
    const early = classifyTuneOutcome({ scenario: 'strangle', tripped: true, stallsSurvived: 3, degradationStalls: 18 });
    return late === TUNE_OUTCOME.RESCUED && early === TUNE_OUTCOME.PREMATURE;
  })());
  ok('смертельный сценарий без трипа — ПРОПУЩЕНО; здоровый без трипа — ЧИСТО (успех, а не пропуск)', (() => {
    const missed = classifyTuneOutcome({ scenario: 'strangle', tripped: false, degradationStalls: 18 });
    const clean = classifyTuneOutcome({ scenario: 'healthy', tripped: false });
    return missed === TUNE_OUTCOME.MISSED && clean === TUNE_OUTCOME.CLEAN;
  })());
  ok('здоровый сценарий с трипом — ЛОЖНО, и счёт остановов на это не влияет', (() => {
    const a = classifyTuneOutcome({ scenario: 'healthy', tripped: true, stallsSurvived: 0 });
    const b = classifyTuneOutcome({ scenario: 'healthy', tripped: true, stallsSurvived: 99 });
    return a === TUNE_OUTCOME.FALSE && b === TUNE_OUTCOME.FALSE;
  })());
  ok('словарь исходов ЗАКРЫТ: пять имён, все различны (R14d — читатель не гадает)',
    new Set(Object.values(TUNE_OUTCOME)).size === 5 && Object.isFrozen(TUNE_OUTCOME));

  // ---- --out (P56-AC4): the REAL CLI, a sandbox journal, and the combat dir left untouched
  {
    const { spawn } = await import('node:child_process');
    const { readdirSync, existsSync } = await import('node:fs');
    const os = await import('node:os');
    const outDir = mkdtempSync(path.join(os.tmpdir(), 'fuse-out-'));
    const outJournal = path.join(outDir, 'rehearsal.jsonl');
    const combatBefore = new Set(existsSync(FUSE_DIR) ? readdirSync(FUSE_DIR) : []);
    const code = await new Promise((res) => {
      const c = spawn(process.execPath, [fileURLToPath(import.meta.url), '--judge', '--seconds', '0.3', '--out', outJournal], { windowsHide: true, stdio: 'ignore' });
      c.on('exit', res);
    });
    const combatAfter = new Set(existsSync(FUSE_DIR) ? readdirSync(FUSE_DIR) : []);
    const newInCombat = [...combatAfter].filter((f) => !combatBefore.has(f));
    ok('--out: живой CLI судьи уводит журнал и кольцо в песочницу, боевая папка НЕ пополнилась (EXP-0025)',
      code === 0 && existsSync(outJournal.replace(/\.jsonl$/u, '-ring.jsonl')) && newInCombat.length === 0,
      newInCombat.length ? `в боевой папке появилось: ${newInCombat.join(', ')}` : '');
  }

  // ---- the derived N: both shoulders pinned as arithmetic, so a drive-by edit of the constant
  // (or of the floor numbers it stands on) reddens a block instead of silently rearming the fuse
  ok('выведенное N держит оба плеча: ≥ 5× худшего зазора всех полов (10,46) и ≤ 302 мс потолка удушения', (() => {
    const worstGapMs = 10.46; const stranglePrecursorMs = 3042;
    const { DERIVED_ARM_N_MS: N } = { DERIVED_ARM_N_MS };
    return N >= 5 * worstGapMs && N <= stranglePrecursorMs / 10;
  })());

  // ---- the real sender process end-to-end (mutation target «удар не отправлен»): death-watch's
  // `--beat-sender` is the probe's exact loop shape minus the card; a mutant that drops the send
  // must go red HERE, offline, not first on a live evening. ~1 s of runtime, ephemeral port only.
  {
    const dgram = await import('node:dgram');
    const { spawn } = await import('node:child_process');
    const recv = dgram.createSocket('udp4');
    let got = 0;
    recv.on('message', (b) => { if (b[0] === 0x01) got += 1; });
    await new Promise((res) => recv.bind({ address: '127.0.0.1', port: 0 }, res));
    const port = recv.address().port;
    const watchScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'death-watch.mjs');
    const child = spawn(process.execPath, [watchScript, '--beat-sender', '--port', String(port), '--seconds', '1'], { windowsHide: true, stdio: 'ignore' });
    await new Promise((res) => child.on('exit', res));
    await new Promise((res) => setTimeout(res, 150));
    recv.close();
    // ≥ 30, not ~500: without timeBeginPeriod the sender's Atomics.wait ticks at Windows' default
    // granularity. The count proves the CHANNEL end-to-end; the cadence is the jitter floor's job.
    ok(`отправитель ударов (настоящий процесс, цикл пробы) дошёл до судьи по loopback — получено ${got}`, got >= 30);
  }

  // ---- C1 (`testcases/TC_fuse_blackbox_survives_death.md`): СЛЕД СУДЬИ ПЕРЕЖИВАЕТ СМЕРТЬ БЕЗ
  // ШТАТНОГО ЗАКРЫТИЯ. Настоящий процесс судьи, настоящее убийство дерева, чтение с диска.
  //
  // 🔴 ПОЧЕМУ БЛОК НАПИСАН ДО ПОЧИНКИ И ОБЯЗАН БЫЛ УПАСТЬ. 30 августа машина владельца зависла:
  // трипа не было, штатного закрытия не было, и кольца судьи не появилось ВООБЩЕ — разбор
  // `bugs/76` остался без единственной улики, способной ответить, жил ли судья в момент события.
  // Блок воспроизводит ровно это: смерть без трипа и без закрытия. Зелёный блок на коде ДО правки
  // означал бы, что он проверяет не то ([[EXP-0181]]: ловушка обязана ловить), и тогда переписывать
  // надо блок, а не радоваться.
  //
  // ⚠️ ГРАНИЦА ЧЕСТНОСТИ: `taskkill /T /F` — это смерть ПРОЦЕССА, а не заморозка ХОСТА. По
  // отношению к чёрному ящику эффект тот же (ни трипа, ни закрытия), но класс «машина замёрзла»
  // этим НЕ доказан, и говорить обратное — ровно та ошибка, за которую заплачено 30 августа
  // (матрица покрытия тест-документа, строка «Способ смерти»).
  {
    const { spawn, spawnSync } = await import('node:child_process');
    const os = await import('node:os');
    const fs = await import('node:fs');
    // Артефакты блока — в ПЕСОЧНИЦЕ, никогда в runs/death-watch/: фикстура среди настоящих
    // посмертных разборов это сфабрикованная улика (EXP-0025).
    // `bugs/102`: эта фикстура и раньше была уникальной (`pid` + `Date.now()`) и за собой убирала —
    // единственная из девяти. Переведена на общую форму, чтобы правило «песочница свежая» стало БЕЗ
    // ИСКЛЮЧЕНИЙ и его можно было сторожить одной строкой, а не помнить про особый случай.
    const sandbox = mkdtempSync(path.join(os.tmpdir(), 'fuse-alive-'));
    const out = path.join(sandbox, 'fuse.jsonl');
    const alivePath = out.replace(/\.jsonl$/u, '-alive.jsonl');
    // НЕ взведён (`--arm-n` не передан) — трипа быть не должно: нам нужна смерть БЕЗ трипа.
    // Порт фиксируем, чтобы к судье можно было привести ЖИВУЮ пробу.
    const beatPort = 54999;
    const judge = spawn(process.execPath, [fileURLToPath(import.meta.url), '--judge', '--out', out,
      '--seconds', '60', '--beat-port', String(beatPort)], { windowsHide: true, stdio: 'ignore' });
    // 🔴 ПРОБА ОБЯЗАТЕЛЬНА, И ЭТО НЕ УКРАШЕНИЕ БЛОКА. Без неё судья никогда не слышал удара, поле
    // `worstBeatSilenceMs` честно пусто, и C2 проверял бы форму строки вместо её содержания —
    // ровно та ошибка (проверка формы вместо существа), за которую заплачено в `bugs/81` и
    // `bugs/82` этой же ночью. С живой пробой поле несёт настоящее число, и проверка различает.
    const watchScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'death-watch.mjs');
    const prober = spawn(process.execPath, [watchScript, '--beat-sender', '--port', String(beatPort), '--seconds', '10'],
      { windowsHide: true, stdio: 'ignore' });
    await new Promise((res) => setTimeout(res, 3500));
    const killedAtMs = Date.now();
    spawnSync('taskkill', ['/PID', String(judge.pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 5_000 });
    try { prober.kill(); } catch { /* проба могла выйти сама по --seconds */ }
    await new Promise((res) => setTimeout(res, 300));

    const aliveExists = fs.existsSync(alivePath);
    const rows = aliveExists
      ? fs.readFileSync(alivePath, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
      : [];
    const last = rows.length ? rows[rows.length - 1] : null;
    const ageMs = last && last.atIso ? killedAtMs - Date.parse(last.atIso) : Infinity;
    ok(`C1 след судьи ПЕРЕЖИЛ смерть без штатного закрытия — строк ${rows.length}, возраст последней ${Number.isFinite(ageMs) ? `${ageMs} мс` : 'файла нет'} (порог 1500 мс)`,
      aliveExists && rows.length >= 2 && ageMs <= 1500);
    // C2 — строка отвечает на вопрос разбора. Шесть полей ПРИСУТСТВУЮТ; четыре всегда-знаемых
    // несут число; молчание карты несёт число, потому что проба живая.
    //
    // 🔴 `worstProgressSilenceMs` проверяется на РОВНО `null`, и это не поблажка, а самая
    // разборчивая часть блока: канал прогресса здесь не проведён, и честный ответ о нём —
    // «не слышал», а не ноль. Ноль читался бы как «молчания не было» — утверждение о канале,
    // которого никто не слушал. Выдуманное число в улике хуже отсутствующего, и мутант, решивший
    // «заполнить нулями, чтобы было шесть из шести», покраснеет ЗДЕСЬ.
    const sixKeys = ['atIso', 't', 'ticks', 'worstGapMs', 'worstBeatSilenceMs', 'worstProgressSilenceMs'];
    ok('C2 строка жизни несёт шесть полей разбора; молчание непроведённого канала — честный null, а не ноль',
      Boolean(last)
      && sixKeys.every((k) => k in last)
      && Number.isFinite(Date.parse(last.atIso)) && last.t > 0 && last.ticks > 0 && last.worstGapMs > 0
      && Number.isFinite(last.worstBeatSilenceMs)
      && last.worstProgressSilenceMs === null);
    // C7 (R5) — кольца после убийства НЕТ, и это ОЖИДАЕМО, а не дефект: честная граница приёма.
    ok('C7 кольца после смерти без закрытия НЕТ — потеря признана, а не замаскирована',
      !fs.existsSync(out.replace(/\.jsonl$/u, '-ring.jsonl')));
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* песочница во временных */ }
  }

  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

// =================================================================================================
// 6. Entry
// =================================================================================================

if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const num = (f, dflt) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt; };
  const str = (f, dflt) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : dflt; };
  const run = async () => {
    if (has('--selftest')) return cmdSelftest();
    if (has('--jitter-floor')) return cmdJitterFloor({ seconds: num('--seconds', 60), tickMs: num('--tick', JUDGE_TICK_MS) });
    if (has('--judge')) {
      const { spawnSync, spawn } = await import('node:child_process');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const mm = loadWinmm(); mm.begin(1);
      try {
        const r = await runJudge({
          beatPort: num('--beat-port', 0),
          armNMs: has('--arm-n') ? num('--arm-n', null) : null,
          armMMs: has('--arm-m') ? num('--arm-m', null) : null,
          armPowerRatio: has('--arm-p') ? num('--arm-p', null) : null,
          burnPid: has('--burn-pid') ? num('--burn-pid', null) : null,
          burnImages: str('--burn-images', null)?.split(',').map((x) => x.trim()).filter(Boolean) ?? null,
          burnPidFile: str('--burn-pidfile', null),
          twinStockCard: str('--twin-stock', null),
          // ⚡ `bugs/101` находка 1 — журнал полосы едет насквозь до руки 2 и нигде не читается судьёй.
          sweepJournalPath: str('--sweep-journal', null),
          progressFile: str('--progress-file', null),
          // --out: the sandbox door (P56-AC4, the phase-2 verdict's caveat). A rehearsal that can
          // only write into runs/death-watch/ plants fixtures among real post-mortems (EXP-0025).
          journalPath: str('--out', null) ?? path.join(FUSE_DIR, `${stamp}-fuse.jsonl`),
          seconds: has('--seconds') ? num('--seconds', null) : null,
          // ⚡ Ш3 (`plans/88`): ПОЛУОТКРЫТОЕ ОКНО СВОИМИ ЧИСЛАМИ — только для тех, кто физически не
          // может дать измеренный такт живого пути (стенд, фикстура). Умолчание — измеренное, и
          // живой путь флагов не передаёт: возможность назвать уставку не то же, что необходимость.
          healthySeconds: has('--rearm-healthy-seconds') ? num('--rearm-healthy-seconds', REARM_HEALTHY_SECONDS) : REARM_HEALTHY_SECONDS,
          healthyWorstGapMs: has('--rearm-healthy-gap') ? num('--rearm-healthy-gap', JUDGE_HEALTHY_WORST_GAP_MS) : JUDGE_HEALTHY_WORST_GAP_MS,
          spawnSyncFn: spawnSync, spawnFn: spawn, log: console.log,
        });
        console.log(`СУДЬЯ ЗАКОНЧИЛ: ударов ${r.beats} · трип: ${r.tripped} · кольцо: ${r.ringPath}`);
        return r.tripped ? 2 : 0; // exit 2 = rescue fired: the caller must treat the step as a FAIL edge
      } finally { mm.end(1); }
    }
    if (has('--loaded-floor')) {
      // ⚡ `plans/94`: путь у флага НЕОБЯЗАТЕЛЕН. Оператор, набравший голый `--progress-file`,
      // получает файл рядом с журналом прогона и готовую строку горна — вариантов разойтись
      // путями у судьи, пробы и горна не остаётся ни одного.
      const pfRaw = str('--progress-file', null);
      const progressFile = has('--progress-file')
        ? ((pfRaw === null || pfRaw.startsWith('--')) ? path.join(FUSE_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-burn-progress.txt`) : pfRaw)
        : null;
      return cmdLoadedFloor({
        seconds: num('--seconds', 90),
        tickMs: num('--tick', JUDGE_TICK_MS),
        progressFile,
        // Горн внутри прогона: одно действие вместо двух окон. `--burn 0` оставляет прежнюю форму
        // (стенд без нагрузки) для тех замеров, где нагрузка не нужна вовсе.
        burnSeconds: num('--burn', 0),
        burnAfterSeconds: num('--burn-after', 15),
        wantWindow: !has('--no-window'),
      });
    }
    console.log('Использование: --selftest | --jitter-floor [--seconds 60] [--tick 2] | --judge [--beat-port P] [--arm-n N] [--arm-m M] [--arm-p RATIO] [--burn-pid PID | --burn-pidfile F | --burn-images a.exe,b.exe] [--twin-stock CARD] [--seconds S] [--out FILE] [--rearm-healthy-seconds N] [--rearm-healthy-gap MS] | --loaded-floor [--seconds 90] [--progress-file [F]] [--burn СЕК] [--burn-after 15] [--no-window]');
    console.log('--progress-file у --loaded-floor — ВХОД 2: без него доля мощности в кольце null весь прогон, и запись не годится в фазу 6б-бис (plans/94). Путь необязателен — стенд выберет сам.');
    console.log('--burn СЕК — стенд сам запускает горн на СЕК секунд (по умолчанию через 15 с после старта) и сам его гасит. Окно наблюдения поднимается вместе с прогоном и умирает вместе с ним: слово владельца «есть прогон — есть окно, нет прогона — нет окна». --no-window снимает окно и вместе с ним право называть прогон записью фазы.');
    console.log(`--rearm-healthy-* — ПОЛУОТКРЫТОЕ ОКНО возврата на пост (plans/88): по умолчанию ${REARM_HEALTHY_SECONDS} здоровых секунд подряд при такте ≥ ${JUDGE_HEALTHY_TICKS_PER_SEC}/с (замер researches/33 §4b). Свои числа называет тот, кто не может дать измеренный такт живого пути: стенд и фикстура.`);
    return 1;
  };
  run().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}
