#!/usr/bin/env node
// graphics-load.mjs — the GAME-SHAPED load on KAGO's bench: Q2RTX's timedemo, driven from code.
//
// Plan anchor (plans/05_epic01_phase5_vmin_engine.md §4.3): «A point's verdict is the WORST over the
// diverse set» — and the set was three CUDA shapes, none of which touches the rasterizer, the RT
// cores, the texture units or a renderer's memory access pattern. researches/02 measured Vmin
// spreading 100 mV BETWEEN PROGRAMS, so a set that is all compute certifies compute.
//
// WHY THIS MODULE IS NOT OPTIONAL, in one measured sentence: every PASS this project owns was taken
// at ~137 W and 57 °C, and a real path-traced game takes 299.97 W, throttles on `sw_power_cap` and
// reaches 77 °C (researches/06 §7b). The oracle did not get worse — the region it certified turned
// out to be HALF the card's envelope, and the owner plays in the other half.
//
// WHAT THIS LOAD CONTRIBUTES TO THE THREE-WAY VERDICT, stated honestly because two of three is not
// three (internal map R4):
//
//   · the CRASH half   — YES: the process's own exit status, the frame count of every run, and the
//                        Windows fault window over the same interval.
//   · the THROUGHPUT half — YES, and this is its best contribution: FPS. Clock stretching and memory
//                        replay are invisible to a checksum and to the event log, and work-per-second
//                        is the only observable that sees them (researches/04 §2). Under a game the
//                        work per second IS the frame rate.
//   · the CHECKSUM half — **NO. There is none, and none is invented.** A benchmark reports speed, not
//                        correctness: an undervolt that corrupts PIXELS passes it silently. So this
//                        module NEVER returns PASS — that verdict belongs to the golden-reference
//                        comparison (event-logger says the same about its own half). A run that
//                        finished clean is reported as `faultFree`, which is a different claim.
//
// AND ITS OTHER JOB, added the evening of 2026-08-10: FPS is the instrument the `Optimised` mode is
// DEFINED in. The owner's criterion is «просадка FPS не более 5%» against `Max Perfomance`, bought
// with a hard cut in watts, heat and noise (GOAL.md → «Уточнение по Optimised»). A criterion stated
// about frames is measured in frames — not in ops/s (4.3 % stock-to-stock scatter, EXP-0030) and not
// in the delivered clock.
//
// GPU WRITES: NONE. This module runs a game on the card and reads telemetry beside it; it sets no
// clock, no offset, no power limit and no fan level. The profile a capture was taken under is a LABEL
// the caller supplies — applying one is `profile-manager.mjs`'s job and nobody else's (rule R1).
//
// Usage:
//   node automation-engine/lib/graphics-load.mjs --run                     one launch, printed
//   node automation-engine/lib/graphics-load.mjs --prove-not-capped        THE GATE — run this FIRST
//   node automation-engine/lib/graphics-load.mjs --capture --label stock   with telemetry + faults
//   node automation-engine/lib/graphics-load.mjs --spread stock            the meter's own floor
//   node automation-engine/lib/graphics-load.mjs --selftest                logic only, no GPU, no game
//
// TEST STATUS — SPLIT, because the two halves of this module were verified by different things and
// collapsing them into one marker is how a false [TESTED] is born:
//
//   OFFLINE HALF — the parser, the cold-run drop, the statistics, the cap proof, the invocation
//   builder, the geometry parser, the verdict and the comparability refusal:
//   [TESTED: 2026-08-10 · 43 selftest blocks green, and NINE mutations each reddening the block
//    named for it BEFORE the run (the addressee list is in §9). One of those mutations earned its
//    keep immediately: the direction rule in `capProof` stayed green when deleted, because the block
//    asserted only `ok === false` — which the magnitude guard also delivers. The check now reads the
//    refusal's REASON, so it guards what it claims to guard.]
//
//   LIVE HALF — `runTimedemo` and `probeGeometry` against the real game and the real card:
//   [TESTED: 2026-08-10 19:2x…19:4x · FOUR full launches on this machine, exit 0 every time, 631
//    frames per run every time. The cap-proof gate: expensive frame 57.586 fps, cheap frame 84.091 —
//    **+46.03 %**, so the instrument demonstrably responds to its input and nothing is clamping it.
//    Then two launches that refuted this module's own first draft about resolution: requested
//    1280x720 → 57.721, requested 1920x1080 → 57.283, i.e. **0.76 % apart inside a 1.84 % scatter**.
//    Both findings are written into `buildArgs`, and the second one is why the record now says the
//    render size is UNOBSERVED instead of naming one.]
//   `capture()` — [TESTED: 2026-08-10 19:5x · a real capture at stock, cooled to 42 °C first: 125
//    telemetry samples (113 under load, 12 idle) taken from the child sampler, the fault window
//    queried over the run's own interval, and the record written with the verdict «БЕЗ СБОЕВ (не
//    PASS)» exactly as designed. The card it saw is the saturated one: 299.8 W median, 76 °C, fan
//    72 %, 99 % utilization, delivered clock 2775 MHz — i.e. this bench reaches the envelope every
//    other load in this project failed to reach.]

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import config from '../config.mjs';
import { gpuClients, median, readSamples, spreadOf, summarizeSamples } from './power-baseline.mjs';
import { parseMoment, queryFaults, verdictFor } from './event-logger.mjs';
import { probeCard } from './stress-tester.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const MON = join(HERE, 'hardware-mon.mjs');
export const GRAPHICS_DIR = join(ROOT, 'runs', 'graphics');

/** How long we wait for the child sampler to write its header before calling the capture failed. */
const SAMPLER_START_TIMEOUT_MS = 10_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A machine receipt carries the owner's local time with its offset (AGENT_GUIDE.md → stamps). */
function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

// =================================================================================================
// 1. Finding the game — and refusing rather than guessing
// =================================================================================================

/**
 * Locate the installation and NAME what is missing when it is not there.
 *
 * A bench instrument that is absent must say so out loud: "could not look" and "nothing happened" are
 * different answers, and this project has a rule about that (event-logger's `no-events` vs `error`).
 * A missing game costs ONE workload shape — no profile depends on it (researches/06 §7).
 *
 * [NOT-TESTED]
 */
export function locateGame({ root = config.Q2RTX_ROOT } = {}) {
  const exePath = join(root, config.Q2RTX_EXE);
  const logPath = join(root, ...config.Q2RTX_LOG_RELATIVE.split('/'));
  const problems = [];
  if (!existsSync(root)) problems.push(`нет каталога игры: ${root}`);
  else if (!existsSync(exePath)) problems.push(`нет исполняемого файла: ${exePath}`);
  return { root, exePath, logPath, ok: problems.length === 0, problems };
}

// =================================================================================================
// 2. The invocation — every trap closed on the command line, every launch
// =================================================================================================

/**
 * Build the argument vector.
 *
 * THE CVARS ARE PASSED EVERY TIME ON PURPOSE. The engine persists settings into `q2config.cfg` on
 * exit, so a bench that relied on the saved file would drift between runs — and two of these settings
 * are the difference between measuring the card and measuring the owner's television (EXP-0032).
 * The full reasoning for each one is in `config.Q2RTX_FIXED_CVARS`.
 *
 * RESOLUTION — AND THE TWO THINGS MEASURED ABOUT IT, because the first draft asserted a third that was
 * false. It set nothing and recorded the DESKTOP's geometry as the run's condition, on the belief that
 * fullscreen renders at the desktop resolution. Two live runs later, neither belief survives:
 *
 *   1. **The desktop's geometry does not describe the load.** At a 3840×2160 desktop the expensive
 *      frame ran 57.59 fps, against 54.29 fps measured earlier at a 1280×720 desktop. Nine times the
 *      pixels cannot be FASTER, so whatever the render size is, it is not the desktop's.
 *   2. **`vid_geometry` does not control it either — measured, same session, same card:** requested
 *      1280x720 → 57.721 fps; requested 1920x1080 → 57.283 fps. **0.76 % apart, inside the 1.84 %
 *      scatter of the launch itself.** A knob that moves the number by less than the noise is not a
 *      knob (the same discriminator as the cap proof, applied to a setting instead of an instrument).
 *
 * SO THE RENDER SIZE ON THIS BUILD IS **UNOBSERVED**, and the record says exactly that rather than
 * naming a plausible number (PHILOSOPHY.md → the three doors: an invented number is worse than a
 * missing one). What IS measured to drive the load is `pt_num_bounce_rays` — +46 % between 2 and 0.
 * `vid_geometry` is still passed through when asked for and recorded as REQUESTED, because a setting
 * we changed belongs in the conditions even after it was measured inert; it is never called the render
 * size. `r_customwidth/height` stay untouched: those govern a WINDOW, and a requested 1920×1080 window
 * was already observed coming out at the desktop's size.
 *
 * [NOT-TESTED]
 */
export function buildArgs({
  demo = config.Q2RTX_DEMO,
  runs = config.Q2RTX_TIMEDEMO_RUNS,
  bounceRays = config.Q2RTX_BOUNCE_RAYS,
  geometry = null,
  extraCvars = [],
} = {}) {
  if (geometry !== null && !/^\d{3,4}x\d{3,4}$/.test(String(geometry))) {
    throw new Error(`геометрия задаётся строкой вида 1280x720, дано ${geometry}`);
  }
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`число прогонов должно быть целым ≥ 1, дано ${runs}`);
  if (!Number.isFinite(Number(bounceRays))) throw new Error(`pt_num_bounce_rays должно быть числом, дано ${bounceRays}`);
  const args = [];
  for (const [name, value] of config.Q2RTX_FIXED_CVARS) args.push('+set', name, String(value));
  args.push('+set', 'pt_num_bounce_rays', String(bounceRays));
  if (geometry !== null) args.push('+set', 'vid_geometry', String(geometry));
  for (const [name, value] of extraCvars) args.push('+set', name, String(value));
  // `timedemo` is a COUNT, not a flag: +timedemo 5 plays the demo five times from one launch and
  // prints five FPS lines (researches/06 §4a.2). It is set last so nothing can overwrite it.
  args.push('+set', 'timedemo', String(runs));
  args.push('+demo', String(demo));
  return args;
}

// =================================================================================================
// 3. The parser — read out of the engine's source, not out of a forum post
// =================================================================================================

/**
 * Parse every timedemo result line out of the console log.
 *
 * FORMAT, from `src/client/demo.c` verbatim:
 *   Com_Printf("%u frames, %3.2f seconds: %f fps\n", cls.demo.time_frames, sec, fps);
 *
 * THE ONE TRAP, and it would produce zero matches with no error: `logfile_prefix` defaults to
 * `[%Y-%m-%d %H:%M] `, so EVERY logged line carries a timestamp prefix. A parser anchored at the
 * start of the line matches nothing. Phoronix's `grep "frames"` survives this by accident; ours does
 * it deliberately and the comment says why, so nobody "fixes" the missing `^`.
 *
 * ALL THREE CAPTURES ARE KEPT because all three mean something: the FRAME COUNT proves the demo ran
 * to the end rather than being cut short — a run with a different frame count is not a slower run, it
 * is a DIFFERENT run, and only that number can tell those apart.
 *
 * [NOT-TESTED]
 */
export function parseTimedemoLines(text) {
  const re = /(\d+) frames, ([\d.]+) seconds: ([\d.]+) fps/g;
  const out = [];
  for (const m of String(text ?? '').matchAll(re)) {
    out.push({ frames: Number(m[1]), seconds: Number(m[2]), fps: Number(m[3]) });
  }
  return out;
}

/**
 * Drop the cold opening run(s) — and REPORT the drop rather than performing it silently.
 *
 * SOURCE: the first pass of a launch reads ~1.7 % low (cold caches, shader warm-up). A discarded
 * observation nobody can see is indistinguishable from a discarded observation nobody agrees with,
 * so both halves come back.
 *
 * [NOT-TESTED]
 */
export function dropColdRuns(runs, n = config.Q2RTX_COLD_RUNS_DROPPED) {
  const list = Array.isArray(runs) ? runs : [];
  const drop = Math.max(0, Math.min(n, list.length));
  return { kept: list.slice(drop), dropped: list.slice(0, drop) };
}

/**
 * Summarize the kept runs: the number, its scatter, and whether the runs are even comparable.
 *
 * `framesAgree` is not decoration. Two runs of different LENGTH are two different measurements, and
 * averaging them produces a number that describes neither.
 *
 * [NOT-TESTED]
 */
export function fpsStats(runs) {
  const list = (runs || []).filter((r) => r && Number.isFinite(r.fps));
  if (!list.length) return { n: 0, median: null, min: null, max: null, spread: null, spreadPct: null, frames: [], framesAgree: null };
  const values = list.map((r) => r.fps);
  const frames = [...new Set(list.map((r) => r.frames))];
  const mid = median(values);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    n: list.length,
    median: mid,
    min,
    max,
    spread: max - min,
    spreadPct: mid ? (100 * (max - min)) / mid : null,
    frames,
    framesAgree: frames.length === 1,
  };
}

// =================================================================================================
// 4. THE GATE — prove the number is not a clamp before believing any of it
// =================================================================================================

/**
 * Compare a full-cost run against a deliberately cheap one and demand that the FPS MOVED.
 *
 * THIS IS STATUS FACT 17 AND EXP-0032 AS A COMMAND, and it exists because the project already got
 * this wrong once: nine of ten runs printed 143.998154 fps to six decimal places and that was written
 * up as an extraordinarily precise instrument. It was the owner's television. The discriminator costs
 * one extra launch: make the frame dramatically cheaper and see whether the number responds — a
 * quantity that ignores a large change in its input is not measuring its input.
 *
 * DIRECTION IS ASSERTED, not just magnitude: a cheaper frame must be FASTER. A cheap run that came
 * out slower is not a passed proof with an odd sign, it is a broken comparison.
 *
 * [NOT-TESTED]
 */
export function capProof(fullStats, cheapStats, minChangePct = config.Q2RTX_CAP_PROOF_MIN_CHANGE_PCT) {
  if (!fullStats || !cheapStats || !Number.isFinite(fullStats.median) || !Number.isFinite(cheapStats.median)) {
    return { ok: false, changePct: null, reason: 'одна из сторон не дала ни одного числа FPS — сравнивать нечего' };
  }
  const changePct = (100 * (cheapStats.median - fullStats.median)) / fullStats.median;
  if (changePct < 0) {
    return { ok: false, changePct, reason: `дешёвый кадр вышел МЕДЛЕННЕЕ дорогого (${changePct.toFixed(2)} %) — это не потолок, это сломанное сравнение` };
  }
  if (changePct < minChangePct) {
    return {
      ok: false,
      changePct,
      reason: `FPS почти не сдвинулся при резко подешевевшем кадре (${changePct.toFixed(2)} % < ${minChangePct} %) — `
        + 'величину что-то ДЕРЖИТ, и мерить ей нельзя (EXP-0032)',
    };
  }
  return {
    ok: true,
    changePct,
    reason: `кадр подешевел — FPS вырос на ${changePct.toFixed(2)} % (порог ${minChangePct} %), значит прибор реагирует на свой вход`,
  };
}

// =================================================================================================
// 5. The conditions this measurement depends on and does not control
// =================================================================================================

/**
 * The resolution the card is actually rendering at — probed, because fullscreen takes the DESKTOP's
 * geometry and the desktop is the owner's to change. Measured 2026-08-10: the earlier saturation runs
 * were taken at 1280×720; the same evening the display read 3840×2160 @ 144 Hz. A frame nine times
 * dearer is not the same load, so this is a CONDITION of every record (EXP-0011).
 *
 * Reported per adapter, with the NVIDIA one named separately — this machine also carries a virtual
 * display adapter, and telling them apart matters when a number is compared later.
 *
 * [NOT-TESTED]
 */
export function probeGeometry({ powershell = 'powershell.exe' } = {}) {
  const ps = 'Get-CimInstance Win32_VideoController | ForEach-Object { '
    + '"$($_.Name)`t$($_.CurrentHorizontalResolution)`t$($_.CurrentVerticalResolution)`t$($_.CurrentRefreshRate)" }';
  const r = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (r.error || r.status !== 0) {
    return { adapters: [], primary: null, error: (r.error && r.error.message) || `powershell вышел с кодом ${r.status}` };
  }
  return parseGeometry(r.stdout);
}

/** Split out so the parsing is provable without a machine. [NOT-TESTED] */
export function parseGeometry(text) {
  const adapters = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split('\t'))
    .filter((p) => p.length >= 4)
    .map(([name, w, h, hz]) => ({
      name: name.trim(),
      width: Number(w) || null,
      height: Number(h) || null,
      refreshHz: Number(hz) || null,
    }))
    .filter((a) => a.width && a.height);
  // The card under test is the one that matters; if it is not among them, say null rather than
  // silently promoting some other adapter's mode into the record.
  const primary = adapters.find((a) => /nvidia|geforce/i.test(a.name)) || null;
  return { adapters, primary };
}

// =================================================================================================
// 5a. THE CPU, because "the GPU is not the limit" and "the CPU is the limit" are different claims
// =================================================================================================

/**
 * Sample processor utilization across the run — asked for by the owner, 2026-08-10 20:2x:
 * *«было бы хорошо смотреть загрузку процессора, чтобы исключать то, что ограничение кадров может
 * быть вызвано лимитом по CPU»*. He is right that it is a hole: this bench had proved the frame rate
 * ignores a 6.5 % core-clock increase, which says the GPU's clock is not the limit — it does NOT say
 * what the limit is, and a CPU-bound game behaves exactly like that.
 *
 * **MAX-CORE, NOT AVERAGE, IS THE NUMBER THAT ANSWERS THE QUESTION.** A game bound on its render
 * thread pegs ONE core while fifteen others idle: on this 8-core/16-thread part that is ~6 % total
 * utilization and 100 % on one core. An average would call that "the CPU is nearly idle" and be
 * precisely wrong — so both are recorded and the max is the one the report leads with.
 *
 * `os.cpus()` deltas rather than a perf counter: no process to spawn, no PowerShell, no permission,
 * and the quantity is exactly what we want (busy vs idle ticks per core over the interval). The
 * parent's event loop is free during the run — `runTimedemo` awaits a promise rather than blocking —
 * which is what makes an in-process sampler legal here and illegal in power-baseline (`spawnSync`).
 *
 * [NOT-TESTED]
 */
export function cpuSnapshot() {
  return cpus().map((c) => {
    const t = c.times;
    const busy = t.user + t.nice + t.sys + t.irq;
    return { busy, total: busy + t.idle };
  });
}

/** Per-core utilization between two snapshots, plus the two summary numbers. [NOT-TESTED] */
export function cpuUsageBetween(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length || !before.length) {
    return { cores: [], totalPct: null, maxCorePct: null, why: 'снимки несопоставимы' };
  }
  const cores = before.map((b, i) => {
    const dTotal = after[i].total - b.total;
    const dBusy = after[i].busy - b.busy;
    return dTotal > 0 ? Number(((100 * dBusy) / dTotal).toFixed(1)) : null;
  });
  const valid = cores.filter((c) => Number.isFinite(c));
  if (!valid.length) return { cores, totalPct: null, maxCorePct: null, why: 'ни одно ядро не дало интервала' };
  return {
    cores,
    totalPct: Number((valid.reduce((s, c) => s + c, 0) / valid.length).toFixed(1)),
    maxCorePct: Math.max(...valid),
  };
}

// =================================================================================================
// 6. One launch
// =================================================================================================

/**
 * Run the timedemo once and return everything the run said about itself.
 *
 * THE LOG IS TRUSTED ONLY AFTER IT IS PROVED FRESH. `logfile` is 1 by default, which opens the file
 * in WRITE mode, so every launch truncates it — convenient, and exactly the kind of convenience that
 * turns into a stale-data defect the day the cvar changes. So the file's mtime must be at or after
 * this launch's start, or the run is UNKNOWN rather than parsed.
 *
 * The game is spawned directly rather than through `explorer.exe`: this call needs the exit status
 * and the wait, and a detached launch gives neither.
 *
 * [NOT-TESTED]
 */
export async function runTimedemo({
  root = config.Q2RTX_ROOT,
  demo = config.Q2RTX_DEMO,
  runs = config.Q2RTX_TIMEDEMO_RUNS,
  bounceRays = config.Q2RTX_BOUNCE_RAYS,
  geometry = null,
  extraCvars = [],
  timeoutMs = config.Q2RTX_LAUNCH_TIMEOUT_MS,
  dryRun = false,
} = {}) {
  const game = locateGame({ root });
  const args = buildArgs({ demo, runs, bounceRays, geometry, extraCvars });
  if (dryRun) return { dryRun: true, game, args, command: `${game.exePath} ${args.join(' ')}` };
  if (!game.ok) throw new Error(game.problems.join('; '));

  const startedAt = new Date();
  const child = spawn(game.exePath, args, { cwd: game.root, windowsHide: false, stdio: 'ignore' });
  const finished = new Promise((res) => {
    child.on('close', (code, signal) => res({ code, signal }));
    child.on('error', (e) => res({ code: null, signal: null, error: e.message }));
  });
  const outcome = await Promise.race([
    finished,
    sleep(timeoutMs).then(() => ({ code: null, signal: null, timedOut: true })),
  ]);
  if (outcome.timedOut) { try { child.kill(); } catch { /* already gone */ } }
  const endedAt = new Date();

  const problems = [];
  if (outcome.error) problems.push(`процесс не запустился: ${outcome.error}`);
  if (outcome.timedOut) problems.push(`процесс не завершился за ${timeoutMs} мс и был снят`);
  if (!outcome.timedOut && outcome.code !== 0) problems.push(`процесс вышел с кодом ${outcome.code}`);

  let log = '';
  let logFresh = null;
  if (existsSync(game.logPath)) {
    const st = statSync(game.logPath);
    logFresh = st.mtimeMs >= startedAt.getTime() - 1000;
    if (!logFresh) problems.push('лог игры старше запуска — читать его как результат этого прогона нельзя');
    log = readFileSync(game.logPath, 'utf8');
  } else {
    problems.push(`лог игры не найден: ${game.logPath}`);
  }

  const all = parseTimedemoLines(log);
  const { kept, dropped } = dropColdRuns(all);
  const stats = fpsStats(kept);
  if (all.length === 0) problems.push('в логе нет ни одной строки результата — таймдемо не отработало');
  else if (all.length !== runs) problems.push(`строк результата ${all.length}, а запрошено прогонов ${runs}`);
  if (stats.framesAgree === false) problems.push(`число кадров разошлось между прогонами (${stats.frames.join(', ')}) — это разные прогоны, а не разная скорость`);

  return {
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    exitCode: outcome.code,
    timedOut: Boolean(outcome.timedOut),
    args,
    demo,
    runsRequested: runs,
    bounceRays,
    // What we ASKED for via `vid_geometry` — a SETTING, not the render size. Measured inert on this
    // build (0.76 % between 720p and 1080p requests, inside the launch's own 1.84 % scatter), so it is
    // recorded as a condition and never described as the resolution being rendered.
    vidGeometryRequested: geometry,
    // The render size itself: NOT OBSERVED. The engine's log prints no resolution line, and the two
    // candidate explanations were both refuted by measurement. An honest null beats a plausible number.
    renderGeometryObserved: null,
    logFresh,
    all,
    kept,
    dropped,
    stats,
    problems,
    ok: problems.length === 0,
  };
}

// =================================================================================================
// 7. A capture — the run, the telemetry beside it, and the fault window over the same interval
// =================================================================================================

/** Wait until the child sampler has written its header: a spawned process is a guess, a line on disk
 *  is an observation (the same rule power-baseline pays for). */
async function waitForSampler(jsonlPath, timeoutMs = SAMPLER_START_TIMEOUT_MS) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (existsSync(jsonlPath) && readFileSync(jsonlPath, 'utf8').includes('\n')) return true;
    await sleep(100);
  }
  return false;
}

/**
 * THE VERDICT THIS LOAD IS ENTITLED TO — and the one it is not.
 *
 * CRASH when the process died or a watched Windows fault fired in the window. `null` (UNKNOWN) when
 * something could not be observed — a provider that failed to answer, a log that was not fresh, a
 * timedemo that printed nothing. Otherwise `faultFree`, which is deliberately NOT `PASS`: there is no
 * checksum on this path, so an undervolt that corrupts pixels would sail through. Inventing a PASS
 * here would park the search inside exactly the silent region researches/02 exists to keep it out of.
 *
 * [NOT-TESTED]
 */
export function decideGraphicsVerdict({ run, faultVerdict }) {
  if (run.timedOut || run.exitCode !== 0) {
    return { verdict: config.VERDICT.CRASH, faultFree: false, reason: `процесс: ${run.problems.join('; ') || 'ненулевой выход'}` };
  }
  if (faultVerdict && faultVerdict.verdict === config.VERDICT.CRASH) {
    return { verdict: config.VERDICT.CRASH, faultFree: false, reason: `журнал Windows: ${faultVerdict.reason}` };
  }
  if (faultVerdict && faultVerdict.verdict === null && !faultVerdict.clean) {
    return { verdict: null, faultFree: false, reason: `журнал прочитать не удалось: ${faultVerdict.reason}` };
  }
  if (!run.ok) {
    return { verdict: null, faultFree: false, reason: `наблюдение неполное: ${run.problems.join('; ')}` };
  }
  return {
    verdict: null,
    faultFree: true,
    reason: 'прогон чист: процесс вышел нулём, сбоев в окне нет. PASS этот модуль не выдаёт — '
      + 'сверки с эталоном на графическом пути нет (внутренняя карта R4)',
  };
}

/**
 * One capture: sampler in its own process, the game in another, the fault window over both.
 *
 * The sampler MUST be a separate process — an in-process one records zero samples while the parent
 * waits (measured, plans/03 §4.3). It is given the launch's whole timeout as its budget and killed
 * when the game exits; a truncated final JSONL line is tolerated by the reader.
 *
 * [NOT-TESTED]
 */
export async function capture({
  label = 'graphics',
  profile = null,
  dir = GRAPHICS_DIR,
  bounceRays = config.Q2RTX_BOUNCE_RAYS,
  runs = config.Q2RTX_TIMEDEMO_RUNS,
  demo = config.Q2RTX_DEMO,
  geometry = null,
  timeoutMs = config.Q2RTX_LAUNCH_TIMEOUT_MS,
} = {}) {
  mkdirSync(dir, { recursive: true });
  const jsonl = join(dir, `${label}.jsonl`);

  const desktop = probeGeometry();
  const card = probeCard();
  const backgroundBefore = gpuClients();

  const samplerSeconds = Math.ceil(timeoutMs / 1000);
  const child = spawn(process.execPath, [MON, '--seconds', String(samplerSeconds), '--out', jsonl],
    { windowsHide: true, stdio: 'ignore' });
  if (!await waitForSampler(jsonl)) {
    child.kill();
    throw new Error(`сэмплер не записал ни строки за ${SAMPLER_START_TIMEOUT_MS} мс — замер без телеметрии не замер`);
  }

  // The CPU is sampled across exactly the same interval as the run, so the two numbers describe the
  // same event (the owner asked for this instrument, 2026-08-10 20:2x).
  const cpuBefore = cpuSnapshot();
  let run;
  try {
    run = await runTimedemo({ demo, runs, bounceRays, geometry, timeoutMs });
  } finally {
    try { child.kill(); } catch { /* already gone */ }
    await sleep(300); // let the last line land before we read the file
  }

  const cpu = cpuUsageBetween(cpuBefore, cpuSnapshot());
  const samples = summarizeSamples(readSamples(jsonl));

  // The fault window is the run's OWN interval, padded by nothing: a wider window borrows somebody
  // else's crash, a narrower one misses the tail of ours.
  let faults = null;
  let faultVerdict = null;
  try {
    faults = queryFaults({ from: parseMoment(run.startedAt), to: parseMoment(run.endedAt) });
    faultVerdict = verdictFor(faults);
  } catch (e) {
    faultVerdict = { verdict: null, reason: `запрос к журналу не состоялся: ${e.message}` };
  }

  const decision = decideGraphicsVerdict({ run, faultVerdict });

  const record = {
    label,
    captured_at: stampNow(),
    // The stamp — everything the numbers depend on. `comparability` below refuses on these.
    load: 'q2rtx-timedemo',
    demo,
    runsRequested: runs,
    bounceRays,
    cvars: config.Q2RTX_FIXED_CVARS.map(([k, v]) => `${k}=${v}`),
    // THREE DIFFERENT FACTS, kept apart because conflating them is the defect the first live runs
    // found: what we ASKED for, what the display IS, and what the card actually renders — which we do
    // not know. See `buildArgs` for the two measurements that forced this split.
    vidGeometryRequested: run.vidGeometryRequested,
    renderGeometryObserved: run.renderGeometryObserved,
    desktopGeometry: desktop.primary,
    profile,
    gpu: { name: card.name, driver: card.driver, vbios: card.vbios },
    verdict: decision.verdict,
    faultFree: decision.faultFree,
    reason: decision.reason,
    sdcOracle: 'none — на графическом пути сверки с эталоном нет',
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    problems: run.problems,
    fps: run.stats,
    fpsRunsAll: run.all,
    fpsDropped: run.dropped,
    // `meters` mirrors power-baseline's shape on purpose: `spreadOf(records,'fps',{from:'meters'})`
    // then works on these records with no second implementation (DRY — a pair you can delete beats a
    // pair you must watch).
    meters: { fps: run.stats.median, fpsSpreadPct: run.stats.spreadPct, frames: run.stats.frames[0] ?? null },
    background: { before: backgroundBefore, after: gpuClients() },
    samples: samples.counts,
    startTemperature: samples.startTemperature,
    startFanSpeed: samples.startFanSpeed,
    medians: { all: samples.all, loaded: samples.loaded, idle: samples.idle, loadPct: samples.loadPct },
    // MAX-CORE first: a render-thread-bound game pegs one core and leaves the average near idle.
    cpu,
    faultProviders: faults ? faults.providers : null,
    sampleFile: `${label}.jsonl`,
  };
  writeFileSync(join(dir, `${label}.json`), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

// =================================================================================================
// 8. Comparability — the same refusal power-baseline makes, on this instrument's own conditions
// =================================================================================================

/** The stamp fields that must agree before two graphics records may be compared at all. */
export const COMPARABLE_FIELDS = Object.freeze(['load', 'demo', 'runsRequested', 'bounceRays', 'profile', 'vidGeometryRequested']);

/**
 * Refuse to compare records taken under different conditions, and NAME the field that differs.
 *
 * GEOMETRY GETS TWO DIFFERENT TREATMENTS, and which is which was decided by measurement rather than by
 * caution:
 *
 *   · `vidGeometryRequested` — a SETTING WE CHANGED, so a difference is a REFUSAL. It was measured
 *     inert on this build, and it is still refused on: runs configured differently are different runs,
 *     and "inert" is one measurement, not a law.
 *   · `desktopGeometry` — a CAVEAT, named and printed, never a refusal. Refusing here would block
 *     legitimate comparisons over a quantity this bench was measured NOT to follow (the 4K desktop ran
 *     FASTER than the 720p one). Naming what differs and letting a human judge is what power-baseline
 *     already does with the background client list, for the same reason.
 *
 * [NOT-TESTED]
 */
export function comparability(records) {
  const problems = [];
  const caveats = [];
  if (records.length < 2) problems.push(`разброс требует минимум двух замеров, дано ${records.length}`);
  const first = records[0];
  if (first) {
    for (const f of COMPARABLE_FIELDS) {
      if (records.some((r) => String(r[f] ?? '') !== String(first[f] ?? ''))) {
        problems.push(`поле «${f}» расходится: ${[...new Set(records.map((r) => String(r[f] ?? '—')))].join(' / ')}`);
      }
    }
    const geo = (r) => (r.desktopGeometry ? `${r.desktopGeometry.width}x${r.desktopGeometry.height}@${r.desktopGeometry.refreshHz}` : '—');
    if (records.some((r) => geo(r) !== geo(first))) {
      caveats.push(`геометрия РАБОЧЕГО СТОЛА расходится (${[...new Set(records.map(geo))].join(' / ')}) — `
        + 'замером эта нагрузка за ней НЕ следует (4K-стол дал больше кадров, чем 720p), поэтому это оговорка, а не отказ');
    }
    const cvars = (r) => (r.cvars || []).join(' ');
    if (records.some((r) => cvars(r) !== cvars(first))) problems.push('набор фиксированных cvar расходится между замерами');
    for (const key of ['driver', 'vbios']) {
      const vals = [...new Set(records.map((r) => (r.gpu || {})[key] ?? '—'))];
      if (vals.length > 1) problems.push(`${key} расходится между замерами (${vals.join(' / ')}) — правило R6: сравнивать нечего`);
    }
  }
  return { ok: problems.length === 0, problems, caveats };
}

// =================================================================================================
// 9. Selftest — the logic on injected data. No GPU, no game.
// =================================================================================================

/**
 * MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016). Break one guarantee at a time and exactly the
 * named block must redden:
 *   1. anchor the parser at `^`                        → «строка результата найдена под префиксом даты»
 *   2. drop the cold run silently (return kept only)   → «холодный прогон отброшен И назван»
 *   3. compare only the magnitude in capProof          → «дешёвый кадр МЕДЛЕННЕЕ — это не пройденная проверка»
 *   4. let capProof pass on a tiny change              → «зажатая величина не проходит порог»
 *   5. drop the DESKTOP geometry refusal                → «разная геометрия СТОЛА — тоже отказ, но по своей причине»
 *   6. return PASS from decideGraphicsVerdict          → «чистый прогон НЕ выдаёт PASS»
 *   7. average frame counts instead of flagging them   → «разное число кадров — это разные прогоны»
 *   8. drop the requested geometry from the comparable fields → «разная ЗАПРОШЕННАЯ геометрия — отказ (настройку меняли мы)»
 *   9. turn the desktop-geometry caveat into silence      → «и оговорка при этом названа вслух, а не проглочена»
 *   9. accept a record whose render geometry is unset   → «незаданная геометрия рендера — отказ, а не молчаливое согласие»
 */
export function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  // --- the parser, against the log this engine actually writes
  const realLog = [
    '[2026-08-10 18:44] Logging console to logs/console.log',
    '[2026-08-10 18:45] 631 frames, 11.61 seconds: 54.359058 fps',
    '[2026-08-10 18:45] 631 frames, 11.57 seconds: 54.537594 fps',
    '[2026-08-10 18:45] Closing console log.',
  ].join('\n');
  const parsed = parseTimedemoLines(realLog);
  ok('строка результата найдена под префиксом даты', parsed.length, 2);
  ok('все три величины разобраны', parsed[0], { frames: 631, seconds: 11.61, fps: 54.359058 });
  ok('лог без результатов даёт пустой список, а не ноль', parseTimedemoLines('[x] Shutting down OpenAL.'), []);
  ok('пустой ввод не роняет парсер', parseTimedemoLines(null), []);

  // --- the cold run
  const five = [1, 2, 3, 4, 5].map((i) => ({ frames: 631, seconds: 11, fps: 50 + i }));
  const d = dropColdRuns(five, 1);
  ok('холодный прогон отброшен И назван', { kept: d.kept.length, dropped: d.dropped.map((r) => r.fps) }, { kept: 4, dropped: [51] });
  ok('отбрасывать больше, чем есть, не уводит в минус', dropColdRuns([{ fps: 1 }], 3).kept.length, 0);

  // --- the statistics, computed on what the pipeline actually feeds them: the KEPT runs (52..55),
  // never the raw five. Getting this wrong the first time is exactly the confusion the cold-run drop
  // creates, which is why the fixture is chained rather than restated.
  const st = fpsStats(d.kept);
  ok('медиана FPS считается по оставшимся прогонам, а не по всем', st.median, 53.5);
  ok('разброс в процентах от медианы', Number(st.spreadPct.toFixed(4)), Number(((100 * 3) / 53.5).toFixed(4)));
  ok('одинаковое число кадров — прогоны сравнимы', st.framesAgree, true);
  const mixedFrames = fpsStats([{ frames: 631, fps: 54 }, { frames: 400, fps: 80 }]);
  ok('разное число кадров — это разные прогоны', mixedFrames.framesAgree, false);
  ok('пустой набор не даёт нулевую медиану', fpsStats([]).median, null);

  // --- THE GATE
  const capped = capProof({ median: 143.998154 }, { median: 143.998154 });
  ok('зажатая величина не проходит порог', capped.ok, false);
  ok('отказ по потолку называет урок', /EXP-0032/.test(capped.reason), true);
  ok('реальная пара 54 → 79 проверку проходит', capProof({ median: 54.29 }, { median: 79.53 }).ok, true);
  // The direction rule needs its OWN evidence, and the mutation suite is what proved that. Asserting
  // only `ok === false` here passed even with the direction branch deleted — the magnitude guard
  // refuses a −31 % change too, so the block claimed to watch direction while watching nothing. The
  // check therefore reads the REASON: a backwards comparison must be refused AS backwards.
  ok('дешёвый кадр МЕДЛЕННЕЕ — это не пройденная проверка',
    /МЕДЛЕННЕЕ/.test(capProof({ median: 79 }, { median: 54 }).reason), true);
  ok('сторона без чисел — отказ, а не ноль', capProof({ median: 54 }, { median: null }).ok, false);
  ok('порог берётся из config, а не из головы', config.Q2RTX_CAP_PROOF_MIN_CHANGE_PCT, 5);

  // --- the invocation
  const args = buildArgs({ runs: 5, bounceRays: 2 });
  const joined = args.join(' ');
  ok('полноэкранный режим форсируется каждый запуск', /\+set vid_fullscreen 1/.test(joined), true);
  ok('потолок кадров движка снят', /\+set cl_maxfps 0/.test(joined), true);
  ok('динамическое масштабирование выключено', /\+set drs_enable 0/.test(joined), true);
  ok('игра завершает себя сама', /\+set nextserver quit/.test(joined), true);
  ok('число прогонов уходит в timedemo', /\+set timedemo 5/.test(joined), true);
  ok('без явной геометрии движок не получает её вовсе', /vid_geometry|r_customwidth|r_mode/.test(joined), false);
  ok('заданная геометрия уходит в движок как vid_geometry',
    /\+set vid_geometry 1920x1080/.test(buildArgs({ geometry: '1920x1080' }).join(' ')), true);
  let threw = false;
  try { buildArgs({ runs: 0 }); } catch { threw = true; }
  ok('ноль прогонов — отказ, а не молчаливый запуск', threw, true);
  let threwGeo = false;
  try { buildArgs({ geometry: '4k' }); } catch { threwGeo = true; }
  ok('геометрия мусором — отказ, а не молчаливая подстановка', threwGeo, true);

  // --- geometry parsing
  const geo = parseGeometry('SudoMaker Virtual Display Adapter\t1680\t1050\t288\nNVIDIA GeForce RTX 5070 Ti\t3840\t2160\t144');
  ok('геометрия карты выбрана среди адаптеров', geo.primary, { name: 'NVIDIA GeForce RTX 5070 Ti', width: 3840, height: 2160, refreshHz: 144 });
  ok('чужой адаптер не подменяет карту', parseGeometry('Some Virtual Adapter\t800\t600\t60').primary, null);

  // --- the verdict
  const cleanRun = { timedOut: false, exitCode: 0, ok: true, problems: [] };
  const clean = decideGraphicsVerdict({ run: cleanRun, faultVerdict: { verdict: null, clean: true, reason: 'x' } });
  ok('чистый прогон НЕ выдаёт PASS', clean.verdict, null);
  ok('чистый прогон помечен faultFree', clean.faultFree, true);
  ok('отсутствие эталона названо в причине', /эталон/.test(clean.reason), true);
  ok('упавший процесс — CRASH',
    decideGraphicsVerdict({ run: { timedOut: false, exitCode: 1, ok: false, problems: ['код 1'] }, faultVerdict: null }).verdict,
    config.VERDICT.CRASH);
  ok('сбой в журнале — CRASH',
    decideGraphicsVerdict({ run: cleanRun, faultVerdict: { verdict: config.VERDICT.CRASH, reason: 'TDR' } }).verdict,
    config.VERDICT.CRASH);
  ok('непрочитанный журнал — НЕИЗВЕСТНО, а не «чисто»',
    decideGraphicsVerdict({ run: cleanRun, faultVerdict: { verdict: null, clean: false, reason: 'провайдер молчит' } }).faultFree,
    false);

  // --- the CPU instrument, on injected snapshots (the owner's ask, 2026-08-10 20:2x)
  const snapA = [{ busy: 100, total: 1000 }, { busy: 100, total: 1000 }];
  const snapB = [{ busy: 1100, total: 2000 }, { busy: 150, total: 2000 }];
  const cpu = cpuUsageBetween(snapA, snapB);
  ok('загрузка ядра считается по приращению, а не по абсолютным тикам', cpu.cores, [100, 5]);
  ok('МАКС ПО ЯДРУ — то число, которым ловится упор в одно ядро', cpu.maxCorePct, 100);
  ok('среднее по ядрам сообщается рядом, но НЕ вместо максимума', cpu.totalPct, 52.5);
  ok('несопоставимые снимки — отказ, а не нули',
    cpuUsageBetween(snapA, [{ busy: 1, total: 2 }]).maxCorePct, null);
  // A zero interval measured NOTHING, so the honest answer is null — not a fabricated 0 %, which
  // would read as "the CPU was idle" and is exactly the invented number the three-doors rule bans.
  ok('нулевой интервал даёт null, а не выдуманные 0 %', cpuUsageBetween(snapA, snapA).maxCorePct, null);

  // --- comparability
  const rec = (over = {}) => ({
    load: 'q2rtx-timedemo', demo: 'q2demo1.dm2', runsRequested: 5, bounceRays: 2, profile: null,
    vidGeometryRequested: '1280x720', renderGeometryObserved: null,
    desktopGeometry: { width: 1280, height: 720, refreshHz: 144 }, cvars: ['vid_fullscreen=1'],
    gpu: { driver: '610.88', vbios: 'v1' }, ...over,
  });
  ok('один замер — это ещё не разброс', comparability([rec()]).ok, false);
  ok('одинаковые условия — сравнение состоялось', comparability([rec(), rec()]).ok, true);
  ok('разная ЗАПРОШЕННАЯ геометрия — отказ (настройку меняли мы)',
    comparability([rec(), rec({ vidGeometryRequested: '1920x1080' })]).ok, false);
  const deskDiff = comparability([rec(), rec({ desktopGeometry: { width: 3840, height: 2160, refreshHz: 144 } })]);
  ok('разная геометрия СТОЛА — ОГОВОРКА, а не отказ: замером нагрузка за ней не следует', deskDiff.ok, true);
  ok('и оговорка при этом названа вслух, а не проглочена', /РАБОЧЕГО СТОЛА/.test(deskDiff.caveats.join(' ')), true);
  ok('разное число лучей — отказ', comparability([rec(), rec({ bounceRays: 0 })]).ok, false);
  ok('сток и профиль не смешиваются', comparability([rec(), rec({ profile: 'optimised' })]).ok, false);
  const drv = comparability([rec(), rec({ gpu: { driver: '611.00', vbios: 'v1' } })]);
  ok('другой драйвер — отказ по правилу R6', drv.ok, false);
  ok('отказ по драйверу называет правило', /R6/.test(drv.problems.join(' ')), true);

  return { ok: results.every((r) => r.ok), results };
}

// =================================================================================================
// 10. CLI
// =================================================================================================

function parseArgs(argv) {
  const o = {
    run: false, capture: false, proveNotCapped: false, selftest: false, dryRun: false,
    spread: null, label: null, profile: null, runs: config.Q2RTX_TIMEDEMO_RUNS,
    bounceRays: config.Q2RTX_BOUNCE_RAYS, geometry: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') o.run = true;
    else if (a === '--capture') o.capture = true;
    else if (a === '--prove-not-capped') o.proveNotCapped = true;
    else if (a === '--selftest') o.selftest = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--spread') o.spread = argv[++i];
    else if (a === '--label') o.label = argv[++i];
    else if (a === '--profile') o.profile = argv[++i];
    else if (a === '--runs') o.runs = Number(argv[++i]);
    else if (a === '--bounce-rays') o.bounceRays = Number(argv[++i]);
    else if (a === '--geometry') o.geometry = argv[++i];
    else throw new Error(`неизвестный флаг: ${a}`);
  }
  if (o.capture && !o.label) throw new Error('--capture требует --label <метка> — замер без имени нельзя сравнить');
  return o;
}

function printRun(r) {
  console.log(`  ПРОГОНОВ В ЛОГЕ: ${r.all.length} (запрошено ${r.runsRequested}) · отброшен холодный: `
    + `${r.dropped.map((x) => x.fps.toFixed(2)).join(', ') || '—'}`);
  console.log(`  КАДРОВ:          ${r.stats.frames.join(', ')}${r.stats.framesAgree ? ' (совпадают)' : ' — РАЗОШЛИСЬ'}`);
  if (r.stats.n) {
    console.log(`  FPS:             медиана ${r.stats.median.toFixed(3)} · мин ${r.stats.min.toFixed(3)} · макс ${r.stats.max.toFixed(3)}`
      + ` · разброс ${r.stats.spreadPct.toFixed(2)} % (внутри одного запуска)`);
  }
  console.log(`  ВЫХОД:           код ${r.exitCode} · ${(r.durationMs / 1000).toFixed(1)} с`);
  for (const p of r.problems) console.log(`  ! ${p}`);
}

function printMedians(medians) {
  const set = medians.loaded || {};
  const row = (f, unit, digits = 1) => {
    const c = set[f];
    if (!c || c.median === null) return `    ${f}: —`;
    return `    ${f.padEnd(24)} ${c.median.toFixed(digits).padStart(8)} ${unit.padEnd(4)} (мин ${c.min} · макс ${c.max} · проб ${c.n})`;
  };
  console.log(row('power.draw.instant', 'Вт'));
  console.log(row('temperature.gpu', '°C', 0));
  console.log(row('fan.speed', '%', 0));
  console.log(row('clocks.gr', 'МГц', 0));
  console.log(row('utilization.gpu', '%', 0));
}

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`ОШИБКА: ${e.message}`); return 2; }

  if (o.selftest) {
    const r = selfTest();
    for (const x of r.results) {
      console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok ? '' : `  -> получено ${JSON.stringify(x.got)}, ждали ${JSON.stringify(x.want)}`}`);
    }
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА: есть расхождения.');
    return r.ok ? 0 : 1;
  }

  const game = locateGame();
  if (!game.ok && !o.spread) {
    console.error('ИГРЫ НЕТ НА МЕСТЕ:');
    for (const p of game.problems) console.error(`  · ${p}`);
    console.error('  Это стенд, а не зависимость: без него недоступна ОДНА форма нагрузки и больше ничего.');
    return 1;
  }

  if (o.dryRun) {
    const plan = await runTimedemo({ runs: o.runs, bounceRays: o.bounceRays, geometry: o.geometry, dryRun: true });
    console.log('ПЛАН ЗАПУСКА (ничего не запущено):');
    console.log(`  ${plan.command}`);
    return 0;
  }

  if (o.proveNotCapped) {
    // THE GATE. Two launches, the frame made dramatically cheaper in the second, and the number is
    // required to MOVE. Until this passes, nothing this bench prints means anything (STATUS fact 17).
    const geo = probeGeometry();
    console.log('ПРОВЕРКА, ЧТО ВЕЛИЧИНУ НИЧТО НЕ ДЕРЖИТ (факт 17, EXP-0032)');
    console.log(`  СТОЛ:   ${geo.primary ? `${geo.primary.width}×${geo.primary.height} @ ${geo.primary.refreshHz} Гц — ${geo.primary.name}` : 'не опрошен'}`);
    console.log(`  vid_geometry: ${o.geometry ?? 'не задан'} · РАЗМЕР КАДРА НЕ НАБЛЮДАЕТСЯ (замерено: эта настройка на нагрузку не влияет)`);
    console.log(`\n  ЗАПУСК 1/2 — дорогой кадр (лучей ${config.Q2RTX_BOUNCE_RAYS})`);
    const full = await runTimedemo({ runs: o.runs, bounceRays: config.Q2RTX_BOUNCE_RAYS, geometry: o.geometry });
    printRun(full);
    console.log(`\n  ЗАПУСК 2/2 — дешёвый кадр (лучей ${config.Q2RTX_BOUNCE_RAYS_CHEAP})`);
    const cheap = await runTimedemo({ runs: o.runs, bounceRays: config.Q2RTX_BOUNCE_RAYS_CHEAP, geometry: o.geometry });
    printRun(cheap);
    const proof = capProof(full.stats, cheap.stats);
    console.log('');
    console.log(proof.ok ? `ВОРОТА ОТКРЫТЫ: ${proof.reason}` : `ВОРОТА ЗАКРЫТЫ: ${proof.reason}`);
    return proof.ok ? 0 : 1;
  }

  if (o.run) {
    const geo = probeGeometry();
    console.log(`СТОЛ: ${geo.primary ? `${geo.primary.width}×${geo.primary.height} @ ${geo.primary.refreshHz} Гц` : 'не опрошен'} · рендер ${o.geometry ?? 'НЕ ЗАДАН'}`
      + ` · лучей ${o.bounceRays} · прогонов ${o.runs}`);
    const r = await runTimedemo({ runs: o.runs, bounceRays: o.bounceRays, geometry: o.geometry });
    printRun(r);
    return r.ok ? 0 : 1;
  }

  if (o.capture) {
    console.log(`ЗАМЕР: ${o.label}${o.profile ? ` · профиль ${o.profile}` : ' · сток'} · лучей ${o.bounceRays} · прогонов ${o.runs}`);
    let rec;
    try {
      rec = await capture({ label: o.label, profile: o.profile, runs: o.runs, bounceRays: o.bounceRays, geometry: o.geometry });
    } catch (e) { console.error(`ОШИБКА: ${e.message}`); return 1; }
    console.log(`  vid_geometry: ${rec.vidGeometryRequested ?? 'не задан'} · размер кадра не наблюдался`);
    console.log(`  СТОЛ:    ${rec.desktopGeometry ? `${rec.desktopGeometry.width}×${rec.desktopGeometry.height} @ ${rec.desktopGeometry.refreshHz} Гц` : 'не опрошен'}`);
    console.log(`  ВЕРДИКТ: ${rec.verdict ?? (rec.faultFree ? 'БЕЗ СБОЕВ (не PASS)' : 'НЕИЗВЕСТНО')} — ${rec.reason}`);
    if (rec.fps.n) {
      console.log(`  FPS:     медиана ${rec.fps.median.toFixed(3)} · разброс ${rec.fps.spreadPct.toFixed(2)} % внутри запуска`
        + ` · кадров ${rec.fps.frames.join(', ')}`);
    }
    console.log(`  ПРОБЫ:   всего ${rec.samples.total} · под нагрузкой ${rec.samples.loaded} · в простое ${rec.samples.idle}`);
    console.log(`  ПРОЦЕССОР: МАКС ПО ЯДРУ ${rec.cpu?.maxCorePct ?? '—'} % · среднее ${rec.cpu?.totalPct ?? '—'} % `
      + `(упор в CPU выглядит как одно ядро под 100 % при низком среднем)`);
    console.log(`  НА СТАРТЕ: ${rec.startTemperature ?? '—'} °C · вентилятор ${rec.startFanSpeed ?? '—'} %`);
    console.log('  МЕДИАНЫ ПОД НАГРУЗКОЙ:');
    printMedians(rec.medians);
    console.log(`  ФАЙЛ:    runs/graphics/${o.label}.json`);
    return rec.verdict === config.VERDICT.CRASH ? 1 : 0;
  }

  if (o.spread) {
    const { readdirSync } = await import('node:fs');
    if (!existsSync(GRAPHICS_DIR)) { console.error('ОШИБКА: runs/graphics пуст'); return 1; }
    const records = readdirSync(GRAPHICS_DIR)
      .filter((f) => f.endsWith('.json') && f.startsWith(o.spread)).sort()
      .map((f) => JSON.parse(readFileSync(join(GRAPHICS_DIR, f), 'utf8')));
    if (!records.length) { console.error(`ОШИБКА: нет замеров с меткой «${o.spread}*»`); return 1; }
    console.log(`ЗАМЕРОВ: ${records.length} — ${records.map((r) => r.label).join(', ')}`);
    const c = comparability(records);
    if (!c.ok) {
      console.error('СРАВНИВАТЬ НЕЛЬЗЯ:');
      for (const p of c.problems) console.error(`  · ${p}`);
      return 1;
    }
    const sp = spreadOf(records, 'fps', { from: 'meters' });
    if (!sp) { console.error('ОШИБКА: в записях нет FPS'); return 1; }
    console.log(`FPS: медиана ${sp.median.toFixed(3)} · разброс ${sp.spread.toFixed(3)} = ${(100 * sp.spreadFraction).toFixed(2)} %`
      + ` · значения [${sp.values.map((v) => v.toFixed(2)).join(', ')}]`);
    console.log('');
    console.log(`ПРАВИЛО: дельта FPS тоньше ${(100 * sp.spreadFraction).toFixed(2)} % НЕ является эффектом — это разброс самого прибора.`);
    console.log('         Этот разброс МЕЖДУ ЗАПУСКАМИ, и только он годится для критерия Optimised «просадка ≤ 5 %».');
    return 0;
  }

  console.error('ОШИБКА: нужен один из режимов — --run, --capture --label <метка>, --prove-not-capped, --spread <метка>, --dry-run или --selftest');
  return 2;
}

// A module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
