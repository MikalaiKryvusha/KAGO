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

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
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

async function runWatcher({ role, tickMs, seconds, outPath, recordThresholdMs }) {
  const driver = role === 'driver' ? await openDriverProbe() : null;
  mkdirSync(path.dirname(outPath), { recursive: true });
  const fd = openSync(outPath, 'a');
  const overshoots = [];
  let missCount = 0;

  const startMs = performance.now();
  const endTarget = startMs + seconds * 1000;
  let nextIndex = 1;
  try {
    for (;;) {
      const promisedMs = promisedTick(startMs, tickMs, nextIndex);
      if (promisedMs > endTarget) break;
      sleepMs(promisedMs - performance.now());
      const wokeMs = performance.now();

      let callMs = null;
      if (driver) {
        const before = performance.now();
        driver.probe();
        callMs = performance.now() - before;
      }

      const verdict = classifyTick({ promisedMs, actualMs: wokeMs, callMs, recordThresholdMs });
      overshoots.push(verdict.overshootMs);
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
    closeSync(fd);
    if (driver) driver.close();
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
    console.log('Использование: --floor [--seconds 60] [--tick 2] [--record-threshold 10] | --selftest');
    return 1;
  };
  run().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}

export default { promisedTick, classifyTick, summarize, formatMiss, DEFAULT_TICK_MS, RECORD_THRESHOLD_MS };
