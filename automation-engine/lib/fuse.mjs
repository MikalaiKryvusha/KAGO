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
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
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
 * Hand 2: spawn the isolated stock-voltage process and DO NOT WAIT for it. The judge's loop must
 * stay alive to record; a hand that can wedge (it talks to the dying driver) gets a process
 * boundary, not an await. The hand writes its own outcome line into the same journal (fsync'd
 * there), so the timeline stays complete even when the judge never hears back.
 */
export function makeStockHand({ spawnFn, journalPath }) {
  const handScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fuse-rescue-hand.mjs');
  return () => {
    const t0 = performance.now();
    // `detached: true` IS the rescue property, paid for on the first live drill (2026-08-28): the
    // judge exits ~200 мс after a trip, and on this machine a NON-detached child dies WITH its
    // parent — the hand was spawned (pid printed) and silently never ran. Proven both ways: parent
    // alive 3 с → line lands; detached + parent dead in 50 мс → line lands; non-detached + parent
    // dead → nothing. A hand that needs ~2 с of NVAPI work must own its life. (EXP-0166)
    const child = spawnFn(process.execPath, [handScript, '--journal', journalPath], {
      windowsHide: true, stdio: 'ignore', detached: true,
    });
    child.unref?.();
    return { ok: child.pid !== undefined, ms: performance.now() - t0, detail: child.pid === undefined ? 'spawn failed' : `pid ${child.pid}` };
  };
}

/**
 * The trip procedure, pure in its ORDER (the part fixtures must pin): intent first — fsync'd
 * BEFORE any action, so a rescue that dies mid-way still left evidence; then hand 1; then hand 2;
 * then outcomes and the ring dump. Returns what happened for the caller's log line.
 */
export function runTrip({ verdict, burnPid, killHand, stockHand, writeLine, dumpRing }) {
  writeLine(formatFuseLine({
    atIso: new Date().toISOString(), phase: 'intent', cause: verdict.cause,
    beatSilenceMs: verdict.beatSilenceMs, progressSilenceMs: verdict.progressSilenceMs,
  }));
  const outcomes = [];
  for (const step of decideRescue({ cause: verdict.cause })) {
    // A missing burn pid does not cancel hand 2 — voltage rescue is meaningful even when the burn
    // already exited on its own (the strangling can outlive the workload that started it).
    const r = step.hand === 1
      ? (burnPid ? killHand(burnPid) : { ok: null, ms: 0, detail: 'no burn pid — nothing to kill' })
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
  beatPort = 0, armNMs = null, armMMs = null, burnPid = null,
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
  const stockHand = makeStockHand({ spawnFn, journalPath });

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
  log(`СУДЬЯ: порт ${boundPort} · такт ${JUDGE_TICK_MS} мс · N=${armNMs ?? 'НЕ ВЗВЕДЁН (наблюдение)'} · M=${armMMs ?? 'не взведён'} · pid прожига: ${burnPid ?? 'нет'}`);
  if (onReady) onReady({ port: boundPort });

  const startMs = performance.now();
  const endMs = seconds === null ? Infinity : startMs + seconds * 1000;
  let tripOutcomes = null;
  let lastTickMs = startMs;

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
        tripOutcomes = runTrip({ verdict, burnPid, killHand, stockHand, writeLine, dumpRing });
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
  console.log('Отправитель — ТОТ ЖЕ цикл, что у пробы сторожа (Atomics.wait): меряем реальность, не идеал.');

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
    + 'непроведённый прогресс не трипает · порядок рук · намерение раньше рук · кольцо переживает трип · судья слышит настоящие удары');

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
    console.log('Использование: --selftest | --jitter-floor [--seconds 60] [--tick 2] | --judge [--beat-port P] [--arm-n N] [--arm-m M] [--burn-pid PID] [--seconds S] [--out FILE] | --loaded-floor [--seconds 90]');
    return 1;
  };
  run().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}
