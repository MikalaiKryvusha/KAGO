#!/usr/bin/env node
// automation-engine/lib/death-watch.mjs — THE DEATH WATCH: two watchers at millisecond cadence,
// side by side, so that when the machine dies we finally learn WHAT STALLS FIRST (plans/52, epic 51
// phase 1; the owner's words: «ВИДЕТЬ ПРИБЛИЖАЮЩУЮСЯ СМЕРТЬ»).
//
// ─── WHY TWO WATCHERS, in one sentence each ─────────────────────────────────────────────────────
//
//   `timer`  — calls NOBODY. Its stall means «our thread was not scheduled»: the SYSTEM is being
//              strangled.
//   `driver` — one READ-ONLY NVML call per tick (nvmlDeviceGetPowerUsage). Its stall means «the
//              call into the driver hung»: the DISPLAY DRIVER is dying.
//
// They run in SEPARATE worker threads because a hung driver call blocks only its own thread — so
// `driver` can stall while `timer` keeps ticking, and that difference IS the measurement this phase
// exists for (plans/52, «The one question this phase must answer»). Both stalling together is the OS.
//
// ─── WHAT A TICK COSTS, measured on this machine 2026-08-28 ─────────────────────────────────────
//
// The default Windows timer grants sleeps in ~14 ms quanta — a 2 ms tick is impossible on it
// (measured: Atomics.wait(2) overshoots 13.6 ms median). `timeBeginPeriod(1)` (winmm.dll, the
// documented API every browser uses) raises the system timer to 1 ms: the same wait then overshoots
// **0.77 ms median, 2.5 ms max** — single-digit milliseconds without spinning a core. The process
// takes the resolution once at start and returns it in `finally`; that is a system-wide setting and
// the honest price of watching, named here rather than hidden (plans/52 risk (a)).
//
// Polling any CARD VALUE faster than ~18 ms buys nothing (the driver refreshes power at 18.3 ms
// median; clocks/temp at ~500 ms — measured 2026-08-26). The thing worth measuring at 2 ms is NOT a
// value at all — it is whether our own code GOT TO RUN, and whether a driver call CAME BACK.
//
// GPU WRITES: none, ever. `nvmlDeviceGetPowerUsage` is a documented read-only query (P52-AC4;
// `researches/05` §5.5 — NVML is an instrument, never a writer).
//
// DURABILITY: every recorded miss is `fsync`ed before the loop continues (P52-AC3) — the shape R15
// and `bugs/37` already paid for: an abrupt machine death takes the page cache with it, and a miss
// that lived only there never happened as far as the post-mortem is concerned.
//
// Usage:
//   npm run deathwatch -- --floor [--seconds 60] [--tick 2] [--record-threshold 10]
//       both watchers on an idle machine; prints the noise floor (P52-AC2). No card writes.
//   npm run deathwatch -- --selftest
//       pure decision logic — no threads, no card, no clock (P52-AC5).
//
// [TESTED: 2026-08-28 · --selftest 8 blocks, five mutations each reddening its own · AC3 abrupt
//  Stop-Process -Force at threshold 0, both tails parse · AC1+AC2 floor 60 s / tick 2 ms: timer
//  29235/30000 (97.45 %) median 0.92 max 3.99 ms, driver 29233/30001 (97.44 %) median 0.90 max
//  4.71 ms, zero misses ≥ 10 ms · GPU writes 0. AC6 (a captured death) rides on future authorised
//  runs and cannot be scheduled.]

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
// Такт наблюдения за прогрессом живёт ОДНИМ фактом у того, кто по нему решает (`fuse.deriveArmMMs`
// сравнивает выведенный порог с тремя его тактами). Импорт безопасен: у `fuse.mjs` есть сторож
// главного модуля, при импорте он ничего не запускает.
import { PROGRESS_POLL_MS } from './fuse.mjs';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);

// =================================================================================================
// 1. Constants — each one names what it is NOT, where that has already cost something
// =================================================================================================

/** Default tick. 2 ms rather than 1 by plans/52 risk (a): a slower honest watcher beats a fast one
 *  that changes the experiment. */
export const DEFAULT_TICK_MS = 2;

/** ⚠️ THE RECORD THRESHOLD IS **NOT** A FAILURE THRESHOLD — plans/52 forbids choosing one in this
 *  phase, and `ideas/10` §5.1 forbids deriving one from n = 1. This constant answers a cheaper
 *  question: which overshoots are worth an fsync'd line on disk. The failure threshold, when it
 *  exists, will be DERIVED from archived floors and deaths (epic 51 phase 3), never from here. */
export const RECORD_THRESHOLD_MS = 10;

/** Where the watch writes its misses. Its own sandbox under runs/, like every other instrument. */
export const DEATH_WATCH_DIR = fileURLToPath(new URL('../../runs/death-watch/', import.meta.url));

export const WATCHER_ROLES = Object.freeze(['timer', 'driver']);

// =================================================================================================
// 2. Decision logic — pure, no threads, no clock, no card (P52-AC5 proves it on fixtures alone)
// =================================================================================================

/**
 * The promised time of tick N — ARITHMETIC FROM THE START, never from the previous actual tick.
 *
 * This is the load-bearing decision of the whole instrument: if the schedule re-anchored on each
 * actual wake-up, a stall would silently shift every later promise and hide itself — overshoot
 * measured «since my last tick» reads 14 ms during a 3-second strangling, because the watcher was
 * asleep for the middle of it. Anchored at start, a 3-second stall is 3000 ms against ONE promise
 * and ~1500 missed ticks against the count — both visible, neither erasable.
 */
export function promisedTick(startMs, tickMs, n) {
  return startMs + tickMs * n;
}

/**
 * Judge one tick. Overshoot is measured FROM THE PROMISE (see `promisedTick`); early arrival is
 * ZERO, not negative — a negative overshoot averaged into a summary would let punctual ticks pay
 * off late ones, which is a books-balancing trick, not an observation.
 *
 * `callMs` is the duration of the driver call on this tick (null for the `timer` role). A stalled
 * CALL is its own kind — `call-stall` — and it WINS over `late` when both hold, because it is the
 * more specific fact: the thread ran, entered the driver, and waited there.
 *
 * The record threshold is INCLUSIVE at the boundary: an overshoot of exactly the threshold is
 * recorded. «Strict» here means the boundary behaviour is pinned by a block, not left to taste.
 */
export function classifyTick({ promisedMs, actualMs, callMs = null, recordThresholdMs = RECORD_THRESHOLD_MS }) {
  const overshootMs = Math.max(0, actualMs - promisedMs);
  const callStalled = callMs !== null && callMs >= recordThresholdMs;
  const late = overshootMs >= recordThresholdMs;
  const kind = callStalled ? 'call-stall' : (late ? 'late' : null);
  return { overshootMs, callMs, kind, record: kind !== null };
}

/** One miss → one JSON line. Parseable alone: the post-mortem reads a TAIL, not a document. */
export function formatMiss({ atIso, role, tickIndex, kind, overshootMs, callMs }) {
  return `${JSON.stringify({ at: atIso, role, tick: tickIndex, kind, overshootMs: round2(overshootMs), callMs: callMs === null ? null : round2(callMs) })}\n`;
}

function round2(x) { return Math.round(x * 100) / 100; }

/**
 * The run's summary. Median AND max travel TOGETHER by plan: a median alone hides the one 3-second
 * stall the instrument exists for, a max alone reads a single hiccup as a way of life.
 *
 * `expected` comes from ELAPSED TIME, not from the loop counter — a loop that stalled delivered
 * fewer ticks than the clock demanded, and that ratio (P52-AC1's ≥ 95 %) is exactly what the
 * counter alone could not show.
 */
export function summarize({ role, tickMs, startMs, endMs, overshoots, missCount }) {
  const sorted = [...overshoots].sort((a, b) => a - b);
  const n = sorted.length;
  const expected = Math.max(0, Math.floor((endMs - startMs) / tickMs));
  return {
    role,
    tickMs,
    expected,
    delivered: n,
    deliveredPct: expected === 0 ? 100 : round2((n / expected) * 100),
    medianOvershootMs: n === 0 ? null : round2(sorted[Math.floor(n / 2)]),
    maxOvershootMs: n === 0 ? null : round2(sorted[n - 1]),
    missCount,
  };
}

// =================================================================================================
// 3. The watcher loop — runs inside a worker thread, one role each
// =================================================================================================

/** Blocking sleep with no timer object — the shape `nvml.mjs` already uses. */
function sleepMs(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Open NVML and declare the ONE read-only call this watcher makes. Refusal is LOUD — a driver
 *  watcher that cannot reach the driver must say so and stop, never silently degrade into a second
 *  `timer` (plans/52 risk (b): that would answer «who stalled first» with a forgery). */
async function openDriverProbe() {
  // Dynamic import, not require: `nvml.mjs` sits on an ESM graph with a top-level await, which
  // `createRequire` refuses by design — the first floor run said so verbatim.
  const { openNvml } = await import('./nvml.mjs');
  const nv = openNvml();
  const st = nv.init();
  if (st !== 0) throw new Error(`nvmlInit_v2() отказал: статус ${st} — сторож драйвера работать не может и НЕ притворяется таймером`);
  const handleBuf = Buffer.alloc(8);
  const sh = nv.getHandleByIndex(0, handleBuf);
  if (sh !== 0) { nv.shutdown(); throw new Error(`nvmlDeviceGetHandleByIndex_v2(0) отказал: статус ${sh}`); }
  const handle = handleBuf.readBigUInt64LE(0);
  const getPowerUsage = nv.lib.func('int nvmlDeviceGetPowerUsage(uint64_t device, _Out_ void *mw)');
  const mwBuf = Buffer.alloc(4);
  return {
    probe() { return getPowerUsage(handle, mwBuf); }, // read-only; the VALUE is irrelevant, the RETURN is the datum
    close() { try { nv.shutdown(); } catch { /* the watch is over either way */ } },
  };
}

async function runWatcher({ role, tickMs, seconds, outPath, recordThresholdMs, beatPort = null, progressFile = null }) {
  const driver = role === 'driver' ? await openDriverProbe() : null;
  // ⚡ THE FUSE'S LIVENESS FEED (epic 51 phase 2, `plans/55`): after every SUCCESSFUL probe return,
  // one datagram to the judge on loopback — in memory, fire-and-forget, no disk in the loop (the
  // owner's «НЕ ДИСК РАЗ В СЕКУНДУ» is a design input). Only status 0 beats: a LOST card answers
  // INSTANTLY with an error code, and a beat on that answer would hold the fuse asleep on a
  // corpse. No `beatPort` — no socket at all: the floor mode stays byte-identical to the
  // instrument the noise floor was measured on.
  let beatSock = null; let beatBuf = null;
  if (beatPort !== null && driver) {
    const dgram = await import('node:dgram');
    beatSock = dgram.createSocket('udp4');
    beatSock.unref?.();
    beatBuf = Buffer.from([0x01]);
  }
  // ⚡ Вход 2 (`plans/66`): ретранслятор прогресса на СВОЁМ таймере — такт живости он не трогает.
  const progressTimer = beatSock
    ? startProgressRelay({
      file: progressFile, port: beatPort, pollMs: PROGRESS_POLL_MS,
      sendFn: (b, p, h) => beatSock.send(b, p, h),
    })
    : null;
  progressTimer?.unref?.();
  mkdirSync(path.dirname(outPath), { recursive: true });
  const fd = openSync(outPath, 'a');
  const overshoots = [];
  let missCount = 0;

  /**
   * @forensic driver-alive
   * EXPLAINS:   жила ли ПРОБА в секунды перед смертью машины — вопрос, на который 30 августа
   *             ответить было нечем (`bugs/83`)
   * DURABLE-AT: every-second
   * GAP:        `fsync` не доказан стендом — убийство ПРОЦЕССА не теряет кэш страниц, теряет его
   *             только смерть МАШИНЫ. Тот же зазор, что у `@forensic fuse-alive` (`bugs/78`)
   *
   * ЗАЧЕМ. Этот журнал писал ТОЛЬКО промахи > порога, и каждый честно `fsync`-ал. Записи не
   * терялись — их не было: за четыре минуты до смерти ни один такт не промахнулся на 10 мс.
   * И ровно поэтому канал был бесполезен для разбора: **журнал, пишущий только аномалии, не
   * отличает «аномалий не было» от «проба умерла»**. В те 110 секунд между первым криком
   * драйвера и смертью машины его молчание означало одно из двух, и сказать какое нечем.
   * Итоговая сводка печатается при ШТАТНОМ выходе, то есть ровно тогда, когда она не нужна.
   *
   * Секундная строка делает молчание читаемым: пустое окно теперь значит «проба мертва».
   */
  const alivePath = outPath.replace(/\.jsonl$/u, '-alive.jsonl');
  let aliveFd = null;
  let aliveWindowEndMs = null;
  let aliveTicks = 0;
  let aliveMisses = 0;
  let aliveWorstOvershoot = 0;
  let aliveWorstCallMs = 0;
  const flushDriverAlive = (nowMs, tStartMs) => {
    const line = `${JSON.stringify({
      atIso: new Date().toISOString(),
      role,
      t: Math.round((nowMs - tStartMs) * 100) / 100,
      ticks: aliveTicks,
      misses: aliveMisses,
      worstOvershootMs: Math.round(aliveWorstOvershoot * 100) / 100,
      worstCallMs: Math.round(aliveWorstCallMs * 100) / 100,
    })}\n`;
    if (aliveFd === null) aliveFd = openSync(alivePath, 'a');
    writeSync(aliveFd, line);
    fsyncSync(aliveFd);
    aliveTicks = 0; aliveMisses = 0; aliveWorstOvershoot = 0; aliveWorstCallMs = 0;
  };

  const startMs = performance.now();
  const endTarget = startMs + seconds * 1000;
  let nextIndex = 1;
  try {
    for (;;) {
      const promisedMs = promisedTick(startMs, tickMs, nextIndex);
      if (promisedMs > endTarget) break;
      // TWO SLEEP SHAPES, AND THE DIFFERENCE IS MEASURED, NOT STYLISTIC. `Atomics.wait` blocks the
      // event loop, and a blocked loop never flushes dgram sends: the first jitter floor
      // (2026-08-28) delivered 12,72 % of beats, in bursts, because they queued for a loop that
      // never ran. So the BEAT-ARMED probe yields per tick (setTimeout chain, same promised-tick
      // arithmetic), while the beat-less floor keeps `Atomics.wait` — byte-identical to the
      // instrument the 2026-08-28 noise floor was measured on. The yielding probe's own floor is
      // phase 3's measurement, made with the shape that will actually ride the live runs.
      if (beatSock) await new Promise((res) => setTimeout(res, Math.max(0, promisedMs - performance.now())));
      else sleepMs(promisedMs - performance.now());
      const wokeMs = performance.now();

      let callMs = null;
      if (driver) {
        const before = performance.now();
        const st = driver.probe();
        callMs = performance.now() - before;
        if (beatSock && st === 0) beatSock.send(beatBuf, beatPort, '127.0.0.1');
      }

      const verdict = classifyTick({ promisedMs, actualMs: wokeMs, callMs, recordThresholdMs });
      overshoots.push(verdict.overshootMs);
      // ── СЕКУНДНАЯ СТРОКА ЖИЗНИ (`bugs/83`) — накопление в САМОМ такте, без второго таймера ──────
      // Второй таймер способен жить, когда такт уже встал, и написать «проба жива» про мёртвую.
      if (aliveWindowEndMs === null) aliveWindowEndMs = startMs + 1000;
      aliveTicks += 1;
      if (verdict.record) aliveMisses += 1;
      if (Number.isFinite(verdict.overshootMs) && verdict.overshootMs > aliveWorstOvershoot) aliveWorstOvershoot = verdict.overshootMs;
      if (Number.isFinite(callMs) && callMs > aliveWorstCallMs) aliveWorstCallMs = callMs;
      if (wokeMs >= aliveWindowEndMs) {
        flushDriverAlive(wokeMs, startMs);
        // Окно двигается ОТ ГРАНИЦЫ, а не от `now`: иначе задержка такта копилась бы в дрейф.
        aliveWindowEndMs += 1000;
        while (wokeMs >= aliveWindowEndMs) aliveWindowEndMs += 1000;
      }
      if (verdict.record) {
        missCount += 1;
        // fsync per miss (P52-AC3): a machine death takes the page cache with it; the line must not.
        writeSync(fd, formatMiss({ atIso: new Date().toISOString(), role, tickIndex: nextIndex, kind: verdict.kind, overshootMs: verdict.overshootMs, callMs }));
        fsyncSync(fd);
      }
      // The NEXT promise is the first one still in the FUTURE — after a stall the loop skips the
      // pile of expired promises rather than firing a burst of make-up ticks: make-up ticks would
      // read as delivered work during exactly the stall they failed to observe. The skipped ones
      // are not erased — they are the expected−delivered gap the summary reports. (The first
      // version wrote `ceil(elapsed/tick)` here and thereby skipped one tick after EVERY late wake:
      // 49.25 % delivered on a healthy machine. Off-by-one in the catch-up IS a finding of the
      // floor run, kept in this comment so nobody re-simplifies it back.)
      const elapsedTicks = (performance.now() - startMs) / tickMs;
      nextIndex = Math.max(nextIndex + 1, Math.floor(elapsedTicks) + 1);
    }
  } finally {
    // Последнее окно — только если в нём БЫЛИ такты: пустая строка не улика, а шум, и в разборе
    // читалась бы как «секунда прошла, проба молчала».
    if (aliveTicks > 0) flushDriverAlive(performance.now(), startMs);
    if (aliveFd !== null) closeSync(aliveFd);
    closeSync(fd);
    if (driver) driver.close();
    if (progressTimer) clearInterval(progressTimer);
    if (beatSock) { try { beatSock.close(); } catch { /* the watch is over either way */ } }
  }
  return summarize({ role, tickMs, startMs, endMs: performance.now(), overshoots, missCount });
}

// =================================================================================================
// 4. The floor run — both watchers side by side (P52-AC1, P52-AC2)
// =================================================================================================

function loadWinmm() {
  const koffi = require('koffi');
  const winmm = koffi.load('winmm.dll');
  return {
    begin: winmm.func('uint32_t timeBeginPeriod(uint32_t)'),
    end: winmm.func('uint32_t timeEndPeriod(uint32_t)'),
  };
}

async function cmdFloor({ seconds, tickMs, recordThresholdMs }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFor = (role) => path.join(DEATH_WATCH_DIR, `${stamp}-${role}.jsonl`);
  console.log(`СТОРОЖ СМЕРТИ — замер пола шума: такт ${tickMs} мс · ${seconds} с · порог записи ${recordThresholdMs} мс (порог ЗАПИСИ, не порог отказа)`);
  console.log(`промахи: ${outFor('timer')} · ${outFor('driver')}`);

  const mm = loadWinmm();
  const granted = mm.begin(1); // system-wide 1 ms timer resolution — returned in finally below
  if (granted !== 0) console.log(`⚠️ timeBeginPeriod(1) отказал (код ${granted}) — сон будет зернистым ~14 мс, и пол это покажет`);
  try {
    const spawn = (role) => new Promise((resolve, reject) => {
      const w = new Worker(fileURLToPath(import.meta.url), {
        workerData: { deathWatchRole: role, tickMs, seconds, outPath: outFor(role), recordThresholdMs },
      });
      w.on('message', (m) => { if (m?.summary) resolve(m.summary); });
      w.on('error', reject);
      w.on('exit', (code) => { if (code !== 0) reject(new Error(`сторож ${role} умер с кодом ${code}`)); });
    });
    const results = await Promise.allSettled([spawn('timer'), spawn('driver')]);

    let exit = 0;
    for (const [i, r] of results.entries()) {
      const role = WATCHER_ROLES[i];
      if (r.status === 'rejected') { console.log(`\n🔴 ${role}: ${r.reason.message}`); exit = 1; continue; }
      const s = r.value;
      console.log(`\n${role}: тактов ${s.delivered}/${s.expected} (${s.deliveredPct} %) · перелёт медиана ${s.medianOvershootMs} мс · max ${s.maxOvershootMs} мс · промахов записано ${s.missCount}`);
      if (s.deliveredPct < 95) { console.log(`  🔴 доставлено меньше 95 % тактов — AC1 не выполнен на этом прогоне`); exit = 1; }
    }
    console.log('\nЗаписей в GPU: 0 (nvmlDeviceGetPowerUsage — документированное чтение).');
    console.log('Числа пола ПЕРЕНОСЯТСЯ В plans/52 ШАГОМ 5 — порог отказа из них в этой фазе НЕ выводится.');
    return exit;
  } finally {
    mm.end(1);
  }
}

// =================================================================================================
// 4b. The beat sender — the jitter-floor's counterpart (`fuse.mjs --jitter-floor`, plan 55 step 1)
// =================================================================================================

/**
 * Sends liveness beats in the EXACT loop shape of the probe — `Atomics.wait` cadence, the same
 * catch-up idiom (EXP-0162's off-by-one lesson included) — but with NO card behind it. The jitter
 * floor must measure the channel as the probe will really drive it, not as an event-loop sender
 * would idealize it; a datagram that fails to leave a blocked-loop process would show up HERE, as
 * zero received, before it could ever silently disarm the live fuse.
 */
async function cmdBeatSender({ port, seconds, tickMs, progressFile = null }) {
  const dgram = await import('node:dgram');
  const sock = dgram.createSocket('udp4');
  const buf = Buffer.from([0x01]);
  // Since Windows 10 2004 the timer resolution is PER-PROCESS — the parent's `timeBeginPeriod(1)`
  // does not reach a spawned child. The second jitter floor (2026-08-28) measured it: a yielding
  // sender WITHOUT its own grant beat every 15,76 мс — the stock quantum — delivering 14 %. The
  // live probe (`--probe`) holds its own grant; this twin must too, or it mimics a slower probe
  // than the one that will actually ride.
  const mm = loadWinmm();
  const granted = mm.begin(1);
  if (granted !== 0) console.error(`⚠️ timeBeginPeriod(1) отказал (код ${granted}) — такт будет зернистым ~15,6 мс`);
  // ⚡ Вход 2 на двойнике — тот же ретранслятор, что у живой пробы (паритет стендов, эпик 59).
  const progressTimer = startProgressRelay({
    file: progressFile, port, pollMs: PROGRESS_POLL_MS, sendFn: (b, p, h) => sock.send(b, p, h),
  });
  try {
  const startMs = performance.now();
  const endTarget = startMs + seconds * 1000;
  let nextIndex = 1;
  for (;;) {
    const promisedMs = promisedTick(startMs, tickMs, nextIndex);
    if (promisedMs > endTarget) break;
    // Yielding sleep, NOT `Atomics.wait` — same reason and same receipt as the beat-armed probe in
    // `runWatcher` above: the first jitter floor measured 12,72 % delivery from a blocked loop.
    // This sender exists to mimic the fuse-mode probe, so it mimics the yielding shape.
    await new Promise((res) => setTimeout(res, Math.max(0, promisedMs - performance.now())));
    sock.send(buf, port, '127.0.0.1');
    const elapsedTicks = (performance.now() - startMs) / tickMs;
    nextIndex = Math.max(nextIndex + 1, Math.floor(elapsedTicks) + 1);
  }
  await new Promise((res) => setTimeout(res, 100)); // let the loop drain the send queue before close
  sock.close();
  return 0;
  } finally { mm.end(1); if (progressTimer) clearInterval(progressTimer); }
}

// =================================================================================================
// 4c. Death profiles — the two MEASURED ways this machine has died (epic 59 phase 4, plans/63)
// =================================================================================================
//
// The phase's gate forbids INVENTING a profile: each one cites its measurement, and the strangle
// profile is DERIVED from the committed fixture at play time rather than copied into numbers here —
// a copied list would be a truth↔mirror pair with the fixture (EXP-0077's shape), and the fixture is
// the project's ONLY recording of a sampler losing its tick before the machine died.
//
//   strangle — 2026-08-23, 2797 МГц (`__fixtures__/pulse_2797mhz_death__captured.jsonl`): eighteen
//              sub-trip overshoots of 11–29 ms (degraded but alive — the fuse must NOT trip here),
//              then +2070 ms and +2366 ms (the rung's 4,49 s total the pulse tool reports), then the
//              recording ends in a NUL-byte tail — the page cache died with the machine.
//   instant  — 2026-08-28 third death (STATUS session 58): both watch tails EMPTY (0 bytes), the
//              fatal probe call never returned, telemetry healthy one second before. Same class as
//              the 2026-08-26 20:18 death (pulse saw 0,03 s — the sampler vanished WITH the system).
//              Beats simply END mid-stream; there is nothing to derive — absence is the profile.

/** The strangle stalls, derived from a captured sampler file: every interval's overshoot beyond the
 *  sampler's own promised period, at the watch's record threshold. Pure — the selftest feeds it the
 *  committed fixture and pins the shape the rehearsal relies on (no stall between 30 ms and 2070 ms,
 *  so an armed N=60 judge trips exactly on the first big stall, never on the degradation phase). */
export function strangleStallsFromPulse(rows, { periodMs = 1000, thresholdMs = RECORD_THRESHOLD_MS } = {}) {
  const parse = (s) => {
    const m = String(s).match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})/u);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]).getTime() : null;
  };
  const ts = rows.filter((r) => r && r.t !== undefined).map((r) => parse(r.t)).filter((t) => t !== null);
  const stalls = [];
  for (let i = 1; i < ts.length; i++) {
    const overshoot = ts[i] - ts[i - 1] - periodMs;
    if (overshoot >= thresholdMs) stalls.push(overshoot);
  }
  return stalls;
}

/** Where the strangle fixture lives — exported so the player and the selftest read the SAME file. */
export const STRANGLE_FIXTURE = fileURLToPath(new URL('./__fixtures__/pulse_2797mhz_death__captured.jsonl', import.meta.url));

export const DEATH_PROFILES = Object.freeze({
  strangle: Object.freeze({
    class: 'удушение',
    source: '__fixtures__/pulse_2797mhz_death__captured.jsonl — 2026-08-23, 2797 МГц, машина умерла после записи',
  }),
  instant: Object.freeze({
    class: 'мгновенная',
    source: 'runs/death-watch 2026-08-28: оба хвоста сторожа 0 байт — роковой звонок не вернулся (STATUS сессия 58)',
  }),
});

/**
 * Останова СЫГРАННОГО профиля удушения — из той же фикстуры, что играет проба (`plans/65`).
 * Настройке порога нужно знать, сколько перелётов деградации несёт профиль, и это число обязано
 * приходить ИЗ ФИКСТУРЫ: назначенное разошлось бы с профилем в первый же день уточнения записи.
 */
export function strangleProfileStalls() {
  return strangleStallsFromPulse(readStrangleFixtureRows());
}

/**
 * ⚡ ВХОД 2 ПРЕДОХРАНИТЕЛЯ — ретранслятор прогресса (фаза 5в эпика 51, `plans/66`).
 *
 * Прожиг трогает файл сердцебиения раз в запуск (`--progress-file`); проба подсматривает файл
 * ПОДВЫБОРКОЙ и превращает продвижение счётчика в удар `0x02`. Три решения, каждое с причиной:
 *
 * 1. **Читает ПРОБА, а не судья.** У судьи одна дверь — память и датаграммы; диск в его такте был
 *    бы ровно тем, что владелец запретил («НЕ ДИСК РАЗ В СЕКУНДУ»).
 * 2. **Отдельный таймер, а не тело цикла ударов.** Порог входа 2 на три порядка грубее порога
 *    входа 1, и наблюдение за прогрессом не смеет сдвинуть такт живости ни на такт.
 * 3. **Удар шлётся ТОЛЬКО на ИЗМЕНЕНИЕ счётчика.** Файл, лежащий неподвижно, — это и есть
 *    остановившийся прогресс; повторять по нему удары значило бы усыпить предохранитель трупом
 *    (тот же довод, по которому удары живости шлются лишь на успешный возврат пробы).
 *
 * Нет файла (ещё не создан) — молчим: «источника нет» ≠ «прогресс застыл», и судья различает эти
 * два случая сторожем `progressWired` с фазы 2.
 */
export function startProgressRelay({ file, port, pollMs, sendFn, readFn = null, setIntervalFn = setInterval }) {
  if (!file || port === null || port === undefined) return null;
  const read = readFn || ((p) => { try { return readFileSync(p, 'utf8').trim(); } catch { return null; } });
  const buf = Buffer.from([0x02]);
  let last = null;
  return setIntervalFn(() => {
    const v = read(file);
    if (v === null || v === '' || v === last) return;
    last = v;
    sendFn(buf, port, '127.0.0.1');
  }, pollMs);
}

/** Read the strangle fixture from disk (NUL-tail and blank lines skipped — the tail IS the death). */
function readStrangleFixtureRows() {
  const { readFileSync } = require('node:fs');
  const rows = [];
  for (const line of readFileSync(STRANGLE_FIXTURE, 'utf8').split(/\r?\n/u)) {
    const t = line.replace(/\0/gu, '').trim();
    if (!t) continue;
    try { rows.push(JSON.parse(t)); } catch { /* the NUL tail the death left — not a record */ }
  }
  return rows;
}

/**
 * Play a measured death profile through the beat channel (epic 59 phase 4, `plans/63` шаг 2).
 *
 * Healthy beats until `afterPidfile` appears (the burn carrier wrote its pid — the burn is in
 * flight, exactly when the real stranglings began), then the profile:
 *   strangle — for each measured stall: SILENCE of that length (a strangled sender's loop does not
 *              run — the first jitter floor measured exactly that, EXP-0165), then `betweenMs` of
 *              healthy beats. Real spacing between stalls was 1–15 s; the rehearsal compresses it
 *              (the bench's own acceleration rule, `ideas/04`) and says so here. After the last
 *              measured stall the sender EXITS — on the real evening nothing ever beat again.
 *   instant  — beats END mid-stream, process exits. No taper: both empty-tail deaths had none.
 */
async function cmdPlayProfile({ port, profileName, tickMs, afterPidfile, warmupMs, betweenMs }) {
  const profile = DEATH_PROFILES[profileName];
  if (!profile) { console.error(`нет такого профиля смерти: ${profileName} (есть: ${Object.keys(DEATH_PROFILES).join(', ')})`); return 1; }
  const dgram = await import('node:dgram');
  const { existsSync: exists } = await import('node:fs');
  const sock = dgram.createSocket('udp4');
  const buf = Buffer.from([0x01]);
  const mm = loadWinmm();
  const granted = mm.begin(1);
  if (granted !== 0) console.error(`⚠️ timeBeginPeriod(1) отказал (код ${granted})`);
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  try {
    const healthyBeats = async (ms) => {
      const until = performance.now() + ms;
      while (performance.now() < until) { sock.send(buf, port, '127.0.0.1'); await sleep(tickMs); }
    };
    // Warmup: healthy rhythm while the engine boots; then wait for the burn to actually start.
    await healthyBeats(warmupMs);
    if (afterPidfile) {
      const deadline = performance.now() + 120_000;
      while (!exists(afterPidfile) && performance.now() < deadline) await healthyBeats(tickMs * 5);
    }
    if (profileName === 'instant') return 0; // beats END — the exit IS the profile
    const stalls = strangleStallsFromPulse(readStrangleFixtureRows());
    for (const stallMs of stalls) {
      await sleep(stallMs);       // silence: the strangled loop never runs, nothing is sent
      await healthyBeats(betweenMs);
    }
    return 0; // after the last measured stall the machine was dead — no more beats, ever
  } finally {
    mm.end(1);
    await sleep(50);
    try { sock.close(); } catch { /* the run is over either way */ }
  }
}

// =================================================================================================
// 5. Selftest — pure logic, no threads, no card, no clock (P52-AC5)
// =================================================================================================

function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('САМОПРОВЕРКА death-watch — чистая логика решений; ни потоков, ни карты, ни часов');
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона: якорь расписания · перелёт от обещания · '
    + 'ноль на раннем приходе · граница порога записи · класс зависшего вызова · медиана и максимум вместе · ожидаемые такты из времени');

  // ---- ретранслятор прогресса (вход 2, `plans/66`): удар шлётся ТОЛЬКО на продвижение счётчика
  {
    const sent = [];
    let value = null;                       // что «лежит в файле» прямо сейчас
    const timers = [];
    const fakeInterval = (fn) => { timers.push(fn); return { id: timers.length }; };
    const relay = startProgressRelay({
      file: 'файл', port: 1234, pollMs: 50,
      sendFn: (b) => sent.push(b[0]), readFn: () => value, setIntervalFn: fakeInterval,
    });
    const tickRelay = () => timers[0]();
    tickRelay();                            // файла ещё нет — молчим
    ok('прогресс: файла нет — ударов нет («источника нет» ≠ «прогресс застыл», сторож фазы 2)', sent.length === 0);
    value = '1'; tickRelay();
    value = '2'; tickRelay();
    ok('прогресс: каждое продвижение счётчика — один удар 0x02', sent.length === 2 && sent.every((b) => b === 0x02));
    tickRelay(); tickRelay(); tickRelay();  // счётчик не двигается — прожиг встал
    ok('прогресс: НЕПОДВИЖНЫЙ счётчик ударов НЕ РОЖДАЕТ — иначе предохранитель уснёт на трупе',
      sent.length === 2, `ударов стало ${sent.length}`);
    value = '3'; tickRelay();
    ok('прогресс: работа возобновилась — удары пошли снова', sent.length === 3);
    ok('прогресс: без пути файла ретранслятор не заводится вовсе (дефолт бит-в-бит)',
      startProgressRelay({ file: null, port: 1234, pollMs: 50, sendFn: () => {}, setIntervalFn: fakeInterval }) === null
      && relay !== null);
  }

  ok('расписание — арифметика от старта: обещание такта N не зависит от фактических пробуждений',
    promisedTick(1000, 2, 5) === 1010 && promisedTick(1000, 2, 1500) === 4000);

  ok('перелёт меряется от ОБЕЩАННОГО такта — застрявший такт виден целиком', (() => {
    const v = classifyTick({ promisedMs: 1000, actualMs: 4042, callMs: null });
    return v.overshootMs === 3042 && v.kind === 'late' && v.record;
  })());

  ok('ранний приход — ноль, не отрицательный', (() => {
    const v = classifyTick({ promisedMs: 1000, actualMs: 999.4, callMs: null });
    return v.overshootMs === 0 && v.kind === null && !v.record;
  })());

  ok('граница порога записи закреплена: ровно порог — уже запись, чуть ниже — нет', (() => {
    const at = classifyTick({ promisedMs: 0, actualMs: RECORD_THRESHOLD_MS, callMs: null });
    const under = classifyTick({ promisedMs: 0, actualMs: RECORD_THRESHOLD_MS - 0.01, callMs: null });
    return at.record && !under.record;
  })());

  ok('зависший вызов драйвера — СВОЙ класс, и он старше опоздания', (() => {
    const pure = classifyTick({ promisedMs: 0, actualMs: 0, callMs: 12 });
    const both = classifyTick({ promisedMs: 0, actualMs: 15, callMs: 12 });
    return pure.kind === 'call-stall' && pure.record && both.kind === 'call-stall';
  })());

  ok('сводка несёт медиану И максимум ВМЕСТЕ', (() => {
    const s = summarize({ role: 'timer', tickMs: 2, startMs: 0, endMs: 20, overshoots: [0, 0, 1, 1, 3000], missCount: 1 });
    return s.medianOvershootMs === 1 && s.maxOvershootMs === 3000;
  })());

  ok('ожидаемые такты считаются из ВРЕМЕНИ, а не из счётчика цикла', (() => {
    const s = summarize({ role: 'timer', tickMs: 2, startMs: 0, endMs: 100, overshoots: [0, 0, 0, 0, 0], missCount: 0 });
    return s.expected === 50 && s.delivered === 5 && s.deliveredPct === 10;
  })());

  ok('строка промаха — самостоятельный JSON с ролью, видом и числами', (() => {
    const line = formatMiss({ atIso: '2026-08-28T02:00:00.000Z', role: 'driver', tickIndex: 7, kind: 'call-stall', overshootMs: 0.123, callMs: 12.345 });
    const o = JSON.parse(line);
    return o.role === 'driver' && o.kind === 'call-stall' && o.callMs === 12.35 && line.endsWith('\n');
  })());

  // ---- death profiles (epic 59 phase 4, plans/63): measured, never invented
  ok('удушение выводится из проб: перелёт сверх обещания, порог записи включительно', (() => {
    const rows = [
      { t: '2026/08/23 10:00:00.000' }, { t: '2026/08/23 10:00:01.000' },        // ровно период — не останов
      { t: '2026/08/23 10:00:02.010' },                                          // +10 = ровно порог — уже останов
      { t: '2026/08/23 10:00:03.009' },                                          // +9 — под порогом
      { t: '2026/08/23 10:00:06.079' },                                          // +2070
    ];
    return JSON.stringify(strangleStallsFromPulse(rows)) === '[10,2070]';
  })());

  ok('профиль удушения ИЗ ФИКСТУРЫ держит форму репетиции: мелочь < 30 мс, затем 2070 и 2366, между ними пусто', (() => {
    const { readFileSync } = require('node:fs');
    const rows = [];
    for (const line of readFileSync(STRANGLE_FIXTURE, 'utf8').split(/\r?\n/u)) {
      const t = line.replace(/\0/gu, '').trim();
      if (!t) continue;
      try { rows.push(JSON.parse(t)); } catch { /* NUL-хвост смерти */ }
    }
    const stalls = strangleStallsFromPulse(rows);
    const small = stalls.filter((s) => s < 60);
    const big = stalls.filter((s) => s >= 60);
    // Ни одного останова между 30 и 2070: взведённый N=60 трипает РОВНО на первом большом, и
    // фаза деградации (11–29 мс) не даёт ложного трипа — это и есть AC1 в арифметике.
    return small.length === 18 && small.every((s) => s <= 29)
      && JSON.stringify(big) === '[2070,2366]';
  })());

  ok('словарь профилей закрыт и каждый называет свой замер источником', (() => {
    const names = Object.keys(DEATH_PROFILES);
    return JSON.stringify(names) === '["strangle","instant"]'
      && /pulse_2797mhz_death/.test(DEATH_PROFILES.strangle.source)
      && /0 байт|хвоста/u.test(DEATH_PROFILES.instant.source);
  })());

  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

// =================================================================================================
// 6. Entry — worker or CLI
// =================================================================================================

if (!isMainThread && workerData?.deathWatchRole) {
  runWatcher({
    role: workerData.deathWatchRole,
    tickMs: workerData.tickMs,
    seconds: workerData.seconds,
    outPath: workerData.outPath,
    recordThresholdMs: workerData.recordThresholdMs,
  }).then((summary) => parentPort.postMessage({ summary }));
} else if (isMainThread && process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const num = (f, dflt) => { const i = argv.indexOf(f); return i !== -1 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt; };
  const run = async () => {
    if (has('--selftest')) return cmdSelftest();
    if (has('--floor')) {
      return cmdFloor({
        seconds: num('--seconds', 60),
        tickMs: num('--tick', DEFAULT_TICK_MS),
        recordThresholdMs: num('--record-threshold', RECORD_THRESHOLD_MS),
      });
    }
    if (has('--beat-sender')) {
      // Профиль смерти поверх отправителя ударов (эпик 59 фаза 4): здоровый ритм до появления
      // пид-файла горна, затем ИЗМЕРЕННЫЙ профиль — см. cmdPlayProfile.
      const i = argv.indexOf('--play-profile');
      if (i !== -1) {
        const j = argv.indexOf('--after-pidfile');
        return cmdPlayProfile({
          port: num('--port', 0),
          profileName: argv[i + 1],
          tickMs: num('--tick', DEFAULT_TICK_MS),
          afterPidfile: j !== -1 ? argv[j + 1] : null,
          warmupMs: num('--warmup-ms', 500),
          betweenMs: num('--between-ms', 200),
        });
      }
      const pf = argv.indexOf('--progress-file');
      return cmdBeatSender({
        port: num('--port', 0), seconds: num('--seconds', 60), tickMs: num('--tick', DEFAULT_TICK_MS),
        progressFile: pf !== -1 ? argv[pf + 1] : null,
      });
    }
    if (has('--probe')) {
      // The LIVE probe with beats — the fuse's driver-role process (phases 4-5 wire the engine to
      // this; running it by hand is safe: the probe is the same documented read the floor uses).
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const mm = loadWinmm();
      const granted = mm.begin(1);
      if (granted !== 0) console.log(`⚠️ timeBeginPeriod(1) отказал (код ${granted})`);
      try {
        const s = await runWatcher({
          role: 'driver', tickMs: num('--tick', DEFAULT_TICK_MS), seconds: num('--seconds', 36000),
          outPath: path.join(DEATH_WATCH_DIR, `${stamp}-driver.jsonl`),
          recordThresholdMs: num('--record-threshold', RECORD_THRESHOLD_MS),
          beatPort: argv.includes('--port') ? num('--port', null) : null,
          // ⚡ Вход 2 (`plans/66`): путь файла сердцебиения прожига, если он проведён.
          progressFile: argv.includes('--progress-file') ? argv[argv.indexOf('--progress-file') + 1] : null,
        });
        console.log(`ПРОБА ЗАКОНЧИЛА: тактов ${s.delivered}/${s.expected} (${s.deliveredPct} %) · промахов ${s.missCount}`);
        return 0;
      } finally { mm.end(1); }
    }
    console.log('Использование: --floor [--seconds 60] [--tick 2] [--record-threshold 10] | --probe [--port P] [--seconds S] [--progress-file F] | --beat-sender --port P [--seconds S] [--progress-file F] [--play-profile strangle|instant [--after-pidfile F] [--warmup-ms 500] [--between-ms 200]] | --selftest');
    console.log('--progress-file — файл сердцебиения прожига (вход 2 предохранителя, plans/66): продвижение счётчика едет судье ударом 0x02.');
    return 1;
  };
  run().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}

export default { promisedTick, classifyTick, summarize, formatMiss, DEFAULT_TICK_MS, RECORD_THRESHOLD_MS };
