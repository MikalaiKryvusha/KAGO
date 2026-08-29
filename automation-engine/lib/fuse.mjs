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
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
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
 * Порог входа 2 для НАЗВАННОЙ нагрузки. Незнакомая нагрузка — ОТКАЗ, а не догадка: порог, выведенный
 * из неизмеренного такта, это выдуманное число в предохранителе, который убивает работу владельца.
 */
export function deriveArmMMs(workload) {
  const tick = PROGRESS_TICK_MAX_MS[workload];
  if (tick === undefined) {
    throw new Error(`такт прогресса для нагрузки «${workload}» не измерен — порога вывести не из чего `
      + `(знаем: ${Object.keys(PROGRESS_TICK_MAX_MS).join(', ')})`);
  }
  return Math.ceil(tick * ARM_M_K);
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
export function armMDecision(workload) {
  const armMMs = deriveArmMMs(workload);
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
  return { armed: true, armMMs, why: `вход 2 взведён для «${workload}»: M = ${armMMs} мс `
    + `(${ARM_M_K} × ${PROGRESS_TICK_MAX_MS[workload]} мс измеренного такта)` };
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

/** Oldest→newest, exactly `filled` entries — the dump must read as a timeline, not as raw storage. */
export function drainRing(ring) {
  const out = new Array(ring.filled);
  const start = (ring.next - ring.filled + ring.capacity) % ring.capacity;
  for (let i = 0; i < ring.filled; i++) out[i] = ring.buf[(start + i) % ring.capacity];
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
    return { ok: child.pid !== undefined, ms: performance.now() - t0, detail: child.pid === undefined ? 'spawn failed' : `pid ${child.pid}` };
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
export async function runJudge({
  beatPort = 0, armNMs = null, armMMs = null, burnPid = null, burnImages = null,
  burnPidFile = null, twinStockCard = null,
  // ⚡ Вход 2 (`plans/66`): путь файла сердцебиения прожига. Судья его НЕ ЧИТАЕТ в такте — он лишь
  // спрашивает о его СУЩЕСТВОВАНИИ, и только когда вход 2 уже собрался трипнуть.
  progressFile = null, existsFn = existsSync,
  journalPath, ringCapacity = RING_CAPACITY, seconds = null,
  spawnSyncFn, spawnFn, killFn = process.kill.bind(process), onReady = null, log = () => {},
}) {
  const dgram = await import('node:dgram');
  mkdirSync(path.dirname(journalPath), { recursive: true });
  const fd = openSync(journalPath, 'a');
  const writeLine = (line) => { writeSync(fd, line); fsyncSync(fd); };
  const ring = makeRing(ringCapacity);
  const ringPath = journalPath.replace(/\.jsonl$/u, '-ring.jsonl');
  let ringDumped = false;
  const dumpRing = () => {
    // On-trip and on-close only — NEVER per tick: the ring is forensics, not the control loop.
    const rfd = openSync(ringPath, 'a');
    try {
      for (const e of drainRing(ring)) writeSync(rfd, `${JSON.stringify(e)}\n`);
      fsyncSync(rfd);
      ringDumped = true;
    } finally { closeSync(rfd); }
  };

  const killHand = makeKillHand({ spawnSyncFn, killFn });
  const imageKillHand = makeImageKillHand({ spawnSyncFn });
  const stockHand = makeStockHand({ spawnFn, journalPath, extraArgs: twinStockCard ? ['--twin', twinStockCard] : [] });

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
  // Идёт ли прожиг ПРЯМО СЕЙЧАС. Признак — существование файла сердцебиения: его создаёт прожиг и
  // снимает при штатном выходе (и `.cu`, и носитель двойника). Источника не проведено — ворота
  // открыты, и это верно: тогда вход 2 не взведён и трипать нечему.
  const burnInFlight = () => (progressFile === null ? true : existsFn(progressFile));

  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      const verdict = judgeLiveness({ nowMs: now, lastBeatMs, armNMs, lastProgressMs, armMMs, progressWired });
      // Every tick lands in the ring — the judge's own wake-up gap included: a judge that stalls
      // with the system records its own stall, which is exactly the timer-role observation.
      pushRing(ring, {
        t: round2(now - startMs), gapMs: round2(now - lastTickMs),
        beatSilenceMs: verdict.beatSilenceMs === null ? null : round2(verdict.beatSilenceMs),
        progressSilenceMs: verdict.progressSilenceMs === null ? null : round2(verdict.progressSilenceMs),
      });
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
          setTimeout(tick, JUDGE_TICK_MS);
          return;
        }
        tripOutcomes = runTrip({ verdict, burnPid: pidNow, burnImages, killHand, imageKillHand, stockHand, writeLine, dumpRing });
        log(`⚡ ТРИП: ${verdict.cause} — тишина ${round2(verdict.beatSilenceMs ?? -1)} мс. Руки отработали: ${tripOutcomes.map((o) => `${o.action}=${o.ok}`).join(' · ')}`);
        resolve(); // one trip ends this judge: the step is over either way, a second trip would fire on a corpse
        return;
      }
      if (now >= endMs) { resolve(); return; }
      setTimeout(tick, JUDGE_TICK_MS);
    };
    setTimeout(tick, JUDGE_TICK_MS);
  });

  if (!ringDumped) dumpRing(); // graceful close = step close: the black box lands either way
  closeSync(fd);
  sock.close();
  return { port: boundPort, beats, tripped: tripOutcomes !== null, tripOutcomes, ringPath };
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
    ok('журнал судьи: намерение → исход руки 1 → исход руки 2, fsync-строками',
      journal.length === 3 && journal[0].phase === 'intent' && journal[1].hand === 1 && journal[2].hand === 2);
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
          progressFile: str('--progress-file', null),
          // --out: the sandbox door (P56-AC4, the phase-2 verdict's caveat). A rehearsal that can
          // only write into runs/death-watch/ plants fixtures among real post-mortems (EXP-0025).
          journalPath: str('--out', null) ?? path.join(FUSE_DIR, `${stamp}-fuse.jsonl`),
          seconds: has('--seconds') ? num('--seconds', null) : null,
          spawnSyncFn: spawnSync, spawnFn: spawn, log: console.log,
        });
        console.log(`СУДЬЯ ЗАКОНЧИЛ: ударов ${r.beats} · трип: ${r.tripped} · кольцо: ${r.ringPath}`);
        return r.tripped ? 2 : 0; // exit 2 = rescue fired: the caller must treat the step as a FAIL edge
      } finally { mm.end(1); }
    }
    if (has('--loaded-floor')) {
      return cmdLoadedFloor({ seconds: num('--seconds', 90), tickMs: num('--tick', JUDGE_TICK_MS) });
    }
    console.log('Использование: --selftest | --jitter-floor [--seconds 60] [--tick 2] | --judge [--beat-port P] [--arm-n N] [--arm-m M] [--burn-pid PID | --burn-pidfile F | --burn-images a.exe,b.exe] [--twin-stock CARD] [--seconds S] [--out FILE] | --loaded-floor [--seconds 90]');
    return 1;
  };
  run().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}
