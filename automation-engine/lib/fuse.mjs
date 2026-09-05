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
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { isMainThread } from 'node:worker_threads';

export const FUSE_DIR = fileURLToPath(new URL('../../runs/death-watch/', import.meta.url));

/** Judge cadence. Same 2 ms as the watch, same reason: a slower honest judge beats a faster one
 *  that perturbs the experiment. */
export const JUDGE_TICK_MS = 2;

/** Ring capacity. 15 000 entries at 2 ms ≈ the last 30 s — longer than any measured strangling
 *  precursor (4,49 s), short enough to dump in one write. */
export const RING_CAPACITY = 15_000;

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
 */
export function judgeLiveness({ nowMs, lastBeatMs, armNMs = null, lastProgressMs = null, armMMs = null, progressWired = false }) {
  const beatSilenceMs = lastBeatMs === null ? null : Math.max(0, nowMs - lastBeatMs);
  const progressSilenceMs = (progressWired && lastProgressMs !== null) ? Math.max(0, nowMs - lastProgressMs) : null;
  const beatTripped = armNMs !== null && beatSilenceMs !== null && beatSilenceMs >= armNMs;
  const progressTripped = armMMs !== null && progressSilenceMs !== null && progressSilenceMs >= armMMs;
  return {
    tripped: beatTripped || progressTripped,
    cause: beatTripped ? 'beat-silence' : (progressTripped ? 'progress-stall' : null),
    beatSilenceMs,
    progressSilenceMs,
  };
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
 * НАКОПИТЕЛЬ ЗДОРОВЫХ СЕКУНД — чистая функция, потому что условие внутри цикла ожидания нельзя ни
 * замутировать, ни накрыть (урок `bugs/104`, где инлайн-проверка простояла красной пять дней).
 *
 * Одна больная секунда СБРАСЫВАЕТ счёт в ноль, а не уменьшает его на единицу: окно доказывает
 * НЕПРЕРЫВНОЕ здоровье, и «две здоровые, одна больная, две здоровые» — это не четыре здоровые.
 *
 * @param {object}  a
 * @param {number}  a.ticksPerSec    такт судьи за последнюю секунду
 * @param {number}  a.healthyNeeded  сколько здоровых секунд подряд нужно
 * @param {number}  a.healthyTicksPerSec  уставка здоровья; умолчание — измеренная (см. ниже)
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
  ticksPerSec, healthyNeeded = REARM_HEALTHY_SECONDS,
  healthyTicksPerSec = JUDGE_HEALTHY_TICKS_PER_SEC, state = null,
} = {}) {
  const healthy = Number.isFinite(ticksPerSec) && ticksPerSec >= healthyTicksPerSec;
  const healthySeconds = healthy ? (state?.healthySeconds ?? 0) + 1 : 0;
  return { healthySeconds, onPost: healthySeconds >= healthyNeeded, ticksPerSec: ticksPerSec ?? null };
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
  burnPidFile = null, twinStockCard = null,
  // ⚡ `bugs/101` находка 1: ПУТЬ ЖУРНАЛА ПОЛОСЫ, и судья им НЕ ПОЛЬЗУЕТСЯ — он лишь передаёт его
  // руке 2, которой счётчик намерений нужен как сейлок вокруг собственной записи. Судья читать его
  // не должен: решение о гонке принимает тот, кто в ней участвовал, а не наблюдатель со стороны.
  sweepJournalPath = null,
  // ⚡ Вход 2 (`plans/66`): путь файла сердцебиения прожига. Судья его НЕ ЧИТАЕТ в такте — он лишь
  // спрашивает о его СУЩЕСТВОВАНИИ, и только когда вход 2 уже собрался трипнуть.
  progressFile = null, existsFn = existsSync,
  journalPath, ringCapacity = RING_CAPACITY, seconds = null,
  // ⚡ Ш3 (`plans/88` §4b(4) и §4c): ПОЛУОТКРЫТОЕ ОКНО ПРИХОДИТ ПАРАМЕТРАМИ, А НЕ ТОЛЬКО КОНСТАНТОЙ.
  // Умолчания — измеренные числа живого пути. Своими значениями окно называют те, кто физически не
  // может дать 300 тактов/с: фикстура без `timeBeginPeriod` (~62/с) и репетиция смерти, где ту же
  // машину грузит вся полоса (4…70/с). Без этой двери окно стало бы СТЕНОЙ на стенде — тот самый
  // класс, за который проект уже платил (`bugs/72` · [[EXP-0193]]).
  healthySeconds = REARM_HEALTHY_SECONDS, healthyTicksPerSec = JUDGE_HEALTHY_TICKS_PER_SEC,
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
  let beats = 0;
  sock.on('message', (buf) => {
    const now = performance.now();
    // One byte is the whole protocol: 0x01 = driver-liveness beat, 0x02 = burn progress. Anything
    // else is noise on a loopback port and is counted, not obeyed.
    if (buf[0] === 0x01) { lastBeatMs = now; beats += 1; }
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
     * ⚡ Ш5 — ОЖИДАНИЕ РАСПИСКИ РУКИ 2. Решение владельца П1 (`plans/81` §3): ЖДАТЬ, порога не
     * заводить. Замер, на котором это стоит: вся рука на здоровой карте ≈ 1,9 с, на живом трипе
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
        detail: `сток подтверждён чтением (рука 2 отчиталась за ${round2(receipt?.ms ?? 0)} мс); ПОЛУОТКРЫТО — нужно ${healthySeconds} здоровых секунд подряд при такте ≥ ${healthyTicksPerSec}/с`,
      }));
      log(`⚡ ПОЛУОТКРЫТО: сток подтверждён, но на пост судья вернётся, ДОКАЗАВ здоровье машины — ${healthySeconds} здоровых секунд подряд (такт ≥ ${healthyTicksPerSec}/с)`);
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
          : `${detail} · ticksPerSec=${gate.ticksPerSec} · healthySeconds=${gate.healthySeconds}/${healthySeconds} · уставка ${healthyTicksPerSec}/с`,
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
      const verdict = judgeLiveness({ nowMs: now, lastBeatMs, armNMs, lastProgressMs, armMMs, progressWired });
      // Every tick lands in the ring — the judge's own wake-up gap included: a judge that stalls
      // with the system records its own stall, which is exactly the timer-role observation.
      pushRing(ring, {
        t: round2(now - startMs), gapMs: round2(now - lastTickMs),
        beatSilenceMs: verdict.beatSilenceMs === null ? null : round2(verdict.beatSilenceMs),
        progressSilenceMs: verdict.progressSilenceMs === null ? null : round2(verdict.progressSilenceMs),
      });
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
      if (now >= aliveWindowEndMs) {
        // ⚡ Ш3: ЧИСЛО ТАКТОВ ЗА ЗАКРЫВАЕМОЕ ОКНО СНИМАЕТСЯ ДО СБРОСА — `flushAlive` обнуляет
        // накопитель, и полуоткрытому окну мерить было бы уже нечего.
        const ticksThisWindow = aliveTicks;
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
            healthyNeeded: healthySeconds, healthyTicksPerSec, state: halfOpen.state,
          });
          if (halfOpen.state.onPost) {
            closeRescue(true, `машина доказала здоровье: ${halfOpen.state.healthySeconds} здоровых секунд подряд`, now, halfOpen.state);
          }
        }
      }
      lastTickMs = now;
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
        if (verdict.cause === 'progress-stall' && !burnInFlight()) {
          lastProgressMs = now;
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
  if (xs.length === 0) return { n: 0, medianMs: null, p99Ms: null, maxMs: null };
  const s = [...xs].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { n: s.length, medianMs: round2(at(0.5)), p99Ms: round2(at(0.99)), maxMs: round2(s[s.length - 1]) };
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

function loadWinmm() {
  const koffi = require('koffi');
  const winmm = koffi.load('winmm.dll');
  return { begin: winmm.func('uint32_t timeBeginPeriod(uint32_t)'), end: winmm.func('uint32_t timeEndPeriod(uint32_t)') };
}

// =================================================================================================
// 4b. Loaded floor — the REAL rig: unarmed judge + live probe, load started by the operator
// =================================================================================================

/**
 * Phase 3's measurement (`plans/56` шаги 2, 4): the judge runs UNARMED in this process, the live
 * probe (`death-watch --probe`) rides as a child on this judge's port, and the OPERATOR starts the
 * load in another window when told — the rig measures beat gaps exactly as the armed fuse will see
 * them. Artifacts land in the real `runs/death-watch/` deliberately: this is a genuine floor
 * measurement, the same standing the phase-1 night floor files have — NOT a rehearsal (rehearsals
 * take `--judge --out` into a sandbox).
 */
async function cmdLoadedFloor({ seconds, tickMs }) {
  const { spawn, spawnSync } = await import('node:child_process');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const journalPath = path.join(FUSE_DIR, `${stamp}-loaded-floor.jsonl`);
  console.log(`ПОЛ ПОД НАГРУЗКОЙ: судья unarmed · такт ${JUDGE_TICK_MS} мс · ${seconds} с · проба живая (NVML, чтение)`);
  const mm = loadWinmm(); mm.begin(1);
  let probe = null;
  try {
    const watchScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'death-watch.mjs');
    const r = await runJudge({
      beatPort: 0, armNMs: null, armMMs: null, burnPid: null,
      journalPath, seconds,
      // The ring must cover the WHOLE run: the default 30-second cap silently drops the loaded
      // window's head on a 90-second floor (paid on run 1: 15 000 ticks kept, load at t≈12-72
      // partly outside). Slack on top for late-wake catch-ups.
      ringCapacity: Math.ceil((seconds * 1000) / JUDGE_TICK_MS) + 2000,
      spawnSyncFn: spawnSync, spawnFn: spawn, log: console.log,
      onReady: ({ port }) => {
        probe = spawn(process.execPath, [watchScript, '--probe', '--port', String(port), '--seconds', String(seconds), '--tick', String(tickMs)], { windowsHide: true, stdio: 'inherit' });
        console.log(`ПРОБА: pid ${probe.pid}, удары на порт ${port}.`);
        // LOAD-NOW is deliberately ASCII: an orchestrating shell greps for it, and both Cyrillic
        // bytes and backslash paths already cost one silently-spinning wait loop (run 1).
        console.log('>>> LOAD-NOW — нагрузку можно запускать (окно 2): workloads/furnace.exe 2400 8192 256 64 --sustain <с> <<<');
      },
    });
    const { readFileSync } = await import('node:fs');
    const rows = readFileSync(r.ringPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const gaps = distStats(gapsFromRing(rows));
    const ticks = distStats(rows.map((x) => x.gapMs).filter((x) => x !== undefined));
    const expected = Math.floor((seconds * 1000) / 2);
    console.log(`\nударов ${r.beats} из ~${expected} (${round2((r.beats / expected) * 100)} %) · тактов судьи в кольце ${rows.length}`);
    console.log(`ЗАЗОРЫ УДАРОВ (±${JUDGE_TICK_MS} мс такта): закрытых ${gaps.n} · медиана ${gaps.medianMs} мс · p99 ${gaps.p99Ms} мс · max ${gaps.maxMs} мс`);
    console.log(`такт самого судьи: медиана ${ticks.medianMs} мс · p99 ${ticks.p99Ms} мс · max ${ticks.maxMs} мс`);
    console.log(`кольцо: ${r.ringPath}`);
    console.log('N выводится ТОЛЬКО из прогона С НАГРУЗКОЙ: N = k × max, k ≥ 5, и N ≤ 302 мс (десятая предвестника 3042 мс).');
    return 0;
  } finally {
    mm.end(1);
    if (probe) { try { probe.kill(); } catch { /* уже вышла */ } }
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
  const gateSeq = (ticksSeq, needed = REARM_HEALTHY_SECONDS) => {
    let st = null; const armedAt = [];
    ticksSeq.forEach((t, i) => {
      st = halfOpenGate({ ticksPerSec: t, healthyNeeded: needed, state: st });
      if (st.onPost) armedAt.push(i);
    });
    return { armedAt, healthy: st?.healthySeconds ?? null };
  };
  ok('P88-AC1: три здоровые секунды подряд ставят судью на пост — и ровно на третьей, не раньше',
    JSON.stringify(gateSeq([400, 400, 400, 400]).armedAt) === JSON.stringify([2, 3]));
  ok('P88-AC1: больная секунда посреди — пост занимается позже ровно на её цену',
    JSON.stringify(gateSeq([400, 100, 400, 400, 400]).armedAt) === JSON.stringify([4]));
  ok('P88-AC2: одна больная СБРАСЫВАЕТ накопление в ноль, а не уменьшает на единицу',
    JSON.stringify(gateSeq([400, 400, 100, 400, 400]).armedAt) === JSON.stringify([]));
  ok('P88-AC2: накопитель после сброса считает с нуля (счёт виден числом, а не выводится)',
    gateSeq([400, 400, 100, 400]).healthy === 1);
  ok('P88-AC1: больная машина не встаёт на пост НИКОГДА, сколько бы секунд ни прошло',
    JSON.stringify(gateSeq([4, 100, 261, 4, 200, 4, 250]).armedAt) === JSON.stringify([]));
  ok('P88-AC1: уставка — ГРАНИЦА ВКЛЮЧИТЕЛЬНАЯ, ровно 300 тактов уже здоровье (канон classifyTick)',
    JSON.stringify(gateSeq([300, 300, 300]).armedAt) === JSON.stringify([2]));
  ok('P88-AC1: 299 тактов — больная секунда (сторож на самой границе, оба берега)',
    JSON.stringify(gateSeq([299, 299, 299]).armedAt) === JSON.stringify([]));
  ok('P88-AC8 МУТАЦИЯ: окно в ОДНУ секунду ставит на пост немедленно — сторож AC1 умеет краснеть',
    JSON.stringify(gateSeq([400, 400, 400], 1).armedAt) === JSON.stringify([0, 1, 2]));
  ok('plans/88: уставки названы ОДНИМ местом и это числа замера, а не литералы в коде',
    JUDGE_HEALTHY_TICKS_PER_SEC === 300 && REARM_HEALTHY_SECONDS === 3);

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
    const { writeFileSync: wf, rmSync: rf } = await import('node:fs');
    const pf = path.join(os.tmpdir(), `fuse-pidfile-${process.pid}.pid`);
    try { rf(pf, { force: true }); } catch { /* clean slate */ }
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
    const tmp = path.join(os.tmpdir(), `fuse-selftest-${process.pid}`);
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
    ok('Ш5 отказ: непережитое срабатывание оставляет прежний код выхода (полоса встаёт)',
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
    const tmp = path.join(os.tmpdir(), `fuse-rearm-${process.pid}`);
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
      // (то самое ограничение, найденное чтением до кода). `healthyTicksPerSec: 40` — внутри
      // процесса самопроверки `timeBeginPeriod(1)` никто не поднимал, и такт стоит на 64…65/с при
      // зазоре 16 мс (замер 2026-09-05, четыре секунды подряд: 65 · 65 · 64 · 65). Уставка живого
      // пути 300 здесь недостижима СТРУКТУРНО — прими её фикстура, и она доказывала бы не механизм,
      // а разрешение таймера Windows. 40 стоит с запасом вдвое ниже измеренного и заведомо выше
      // нуля; что окно вообще УМЕЕТ не пустить — доказывает соседний блок «стена» с уставкой 5000.
      // Окно ВЫРОСЛО с 2 с до 5: половина возврата теперь ждёт закрытой секунды строки жизни, и
      // прежние 2 с не вмещали ДВЕ такие секунды — фикстура мерила бы дедлайн, а не механизм.
      beatPort: 0, armNMs: 60, burnPid: 31337, journalPath, seconds: 5,
      healthySeconds: 1, healthyTicksPerSec: 40,
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
    const tmp = path.join(os.tmpdir(), `fuse-halfopen-wall-${process.pid}`);
    const journalPath = path.join(tmp, 'judge.jsonl');
    let readyPort = null;
    let handSpawns = 0;
    let feeding = true;
    const sender = dgram.createSocket('udp4');
    const receipt = '{"phase":"outcome","hand":2,"action":"stock-voltage-verified","ok":true,"ms":1870}';
    const judgeDone = runJudge({
      beatPort: 0, armNMs: 60, burnPid: 31337, journalPath, seconds: 3,
      healthySeconds: 1, healthyTicksPerSec: 5000,   // НЕДОСТИЖИМО: измерено 64…65 тактов/с
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
    const tmp = path.join(os.tmpdir(), `fuse-halfopen-observe-${process.pid}`);
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
      healthySeconds: 1, healthyTicksPerSec: 40,
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
    const tmp = path.join(os.tmpdir(), `fuse-halfopen-slept-${process.pid}`);
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
      healthySeconds: 1, healthyTicksPerSec: 30,
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
    const tmp = path.join(os.tmpdir(), `fuse-pidfile-e2e-${process.pid}`);
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
  ok('distStats несёт медиану, p99 и max ВМЕСТЕ; пустой список — нули честно null', (() => {
    const d = distStats([1, 2, 3, 4, 100]);
    const e = distStats([]);
    return d.medianMs === 3 && d.maxMs === 100 && e.maxMs === null && e.n === 0;
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
    const outDir = path.join(os.tmpdir(), `fuse-gate-${process.pid}`);
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
    ok('ВХОД 2 РАБОТАЕТ: тот же простой прогресса при ИДУЩЕМ прожиге — трип с причиной progress-stall',
      inFlight.tripped === true && inFlight.tripOutcomes?.[0]?.cause === 'progress-stall',
      `исход: ${JSON.stringify(inFlight.tripOutcomes)}`);
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
    const outDir = path.join(os.tmpdir(), `fuse-out-${process.pid}`);
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
    const sandbox = path.join(os.tmpdir(), `fuse-alive-${process.pid}-${Date.now()}`);
    fs.mkdirSync(sandbox, { recursive: true });
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
          healthyTicksPerSec: has('--rearm-healthy-ticks') ? num('--rearm-healthy-ticks', JUDGE_HEALTHY_TICKS_PER_SEC) : JUDGE_HEALTHY_TICKS_PER_SEC,
          spawnSyncFn: spawnSync, spawnFn: spawn, log: console.log,
        });
        console.log(`СУДЬЯ ЗАКОНЧИЛ: ударов ${r.beats} · трип: ${r.tripped} · кольцо: ${r.ringPath}`);
        return r.tripped ? 2 : 0; // exit 2 = rescue fired: the caller must treat the step as a FAIL edge
      } finally { mm.end(1); }
    }
    if (has('--loaded-floor')) {
      return cmdLoadedFloor({ seconds: num('--seconds', 90), tickMs: num('--tick', JUDGE_TICK_MS) });
    }
    console.log('Использование: --selftest | --jitter-floor [--seconds 60] [--tick 2] | --judge [--beat-port P] [--arm-n N] [--arm-m M] [--burn-pid PID | --burn-pidfile F | --burn-images a.exe,b.exe] [--twin-stock CARD] [--seconds S] [--out FILE] [--rearm-healthy-seconds N] [--rearm-healthy-ticks T] | --loaded-floor [--seconds 90]');
    console.log(`--rearm-healthy-* — ПОЛУОТКРЫТОЕ ОКНО возврата на пост (plans/88): по умолчанию ${REARM_HEALTHY_SECONDS} здоровых секунд подряд при такте ≥ ${JUDGE_HEALTHY_TICKS_PER_SEC}/с (замер researches/33 §4b). Свои числа называет тот, кто не может дать измеренный такт живого пути: стенд и фикстура.`);
    return 1;
  };
  run().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}
