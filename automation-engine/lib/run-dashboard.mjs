// =================================================================================================
// THE RUN DASHBOARD — the pulse a run writes, and the server a watcher reads it through
// (`plans/20` §4.2 and §4.5, from `ideas/06`)
// =================================================================================================
//
// THE OWNER'S OBSERVATION THIS EXISTS FOR: when the machine hangs, the monitor keeps showing the last
// frame the card managed to draw, and it hangs there until Windows gives up and bugchecks. So a
// picture that MOVES is a better hang detector than any line of console output — the operator sees
// the movement stop, and the rung that was on screen is the rung that killed the machine.
//
// ─── TWO STREAMS, NEVER BLENDED ───────────────────────────────────────────────────────────────────
//
//   run data    — the REAL `engine.sweepRange`, through its `onEvent` seam. Not parsed from console
//                 prose: reading a program's own printed sentences is a class this project has paid
//                 for (EXP-0071), and the seam has existed since `plans/15` §4.5 precisely so a GUI
//                 would never have to.
//   card metrics— MEASURED on the owner's machine by the separate sampler; SYNTHETIC on the bench,
//                 computed by the virtual card from its own state. The flag `synthetic` travels
//                 INSIDE the sample, so nothing downstream can forget which it was looking at.
//
// ─── WHY THE SEAM IS A FILE, AND WHY THE SERVER IS ANOTHER PROCESS (`ideas/06`, variant A) ─────────
//
// The run BLOCKS. A stress test is a synchronous child process, so Node's event loop stands still for
// the whole burn — a socket served from inside the run would be silent for ten seconds out of every
// ten, i.e. exactly as silent as a dead machine. That is why the pulse is a FILE written
// synchronously, and the server is a separate process that only reads:
//
//   run process ──► runs/dashboard/live.json ──► server process ──► SSE ──► the page
//
// A file also fails the right way. If the machine dies, the file stops changing — nobody has to
// notice a socket has gone quiet, and no timeout has to be tuned. The gauge stops, and the page's
// animation stops with it, because its phase is a function of the pulse and not of its own clock.
//
// ─── THE GAUGE IS NOT THE RECORD (R15, `ideas/06` §4) ─────────────────────────────────────────────
//
// This file is ONE JSON object, rewritten in place, under `runs/` and therefore never in history. It
// has no memory and cannot acquire one. The record of what the silicon proved stays
// `runs/sweep/journal.jsonl` — `fsync`ed before the card is touched — and a second log of the same
// truth is exactly the shape R14a and R15 forbid. Losing a pulse costs a frame; losing a journal line
// costs a rung.
//
// [TESTED: 2026-08-16 03:4x, OFFLINE · `node automation-engine/lib/run-dashboard.mjs --selftest`.
//  The server half is exercised by the live rehearsal (`npm run bench -- --sweep --dashboard`), which
//  is what its screenshot proves; what is NOT tested here is the LIVE sweep's `--dashboard` wiring —
//  it has never run against a real card, and that is phase 3.]

import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PULSE_PATH = join('runs', 'dashboard', 'live.json');
export const PAGE_PATH = join('assets', 'dashboard', 'sweep.html');
export const FONT_PATH = join('assets', 'fonts', 'DSEG7Classic-Regular.woff2');
export const LOGO_PATH = join('assets', 'logo', 'kago-logo.webp');
export const DEFAULT_PORT = 7311;

/** How the run's states are NAMED to the operator. The owner's register: «прожиг» is jargon — what
 *  actually happens is a stability stress test, and that is what the screen says (`ideas/06`). */
export const RUN_STATE = Object.freeze({
  STARTING: 'ПОДЪЁМ ПРОГОНА',
  STRESS: 'ИДЁТ СТРЕСС-ТЕСТ',
  CLOSING: 'ЗАКРЫВАЕТСЯ ЧАСТОТА',
  DONE: 'ПРОГОН ЗАВЕРШЁН',
  STOPPED: 'ПРОГОН ОСТАНОВЛЕН',
});

// =================================================================================================
// 1. THE PULSE — the run's half
// =================================================================================================

/**
 * Open the gauge for one run. Everything it writes is derived from what the engine said and what the
 * card reported; this module invents no number of its own.
 *
 * @param {object} a
 * @param {string} [a.path]        where the gauge lives
 * @param {string} a.source        what is being tuned, in the operator's words
 * @param {boolean} a.synthetic    are the card metrics a model? (the bench says yes, and says it out loud)
 * @param {string} [a.band]        the band's label
 * @param {number} [a.probeSeconds] how long one stress test runs — the denominator on screen
 */
/**
 * IS ANYONE ACTUALLY WATCHING? — the gate a card-writing run must pass (`bugs/14`, the owner's rule
 * *«прогоны без визуализатора ПОД СТРОГИМ ЗАПРЕТОМ»*).
 *
 * Answers with the number of OPEN EVENT STREAMS, which is the number of browser windows holding the
 * page. **It deliberately does not answer «is the server up»:** on 2026-08-16 the server replied 200
 * twice while no window had opened (an already-running Edge swallowed the request), so a server
 * check would have waved both runs through.
 *
 * Read-only over loopback, and every failure mode returns `ok: false` WITH A REASON rather than
 * throwing — a gate that crashes is a gate that stops the run for the wrong reason.
 *
 * @returns {Promise<{ok:boolean, viewers:number, why:string}>}
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export async function viewersWatching({ port = DEFAULT_PORT, timeoutMs = 2500, fetchFn = null } = {}) {
  const url = `http://127.0.0.1:${port}/health`;
  const doFetch = fetchFn ?? ((u, o) => fetch(u, o));
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await doFetch(url, { signal: ac.signal });
    if (!r.ok) return { ok: false, viewers: 0, why: `сервер окна ответил ${r.status} на ${url}` };
    const j = await r.json();
    const viewers = Number(j?.viewers);
    if (!Number.isFinite(viewers)) return { ok: false, viewers: 0, why: `сервер окна не назвал число смотрящих (${url})` };
    return {
      ok: true,
      viewers,
      why: viewers > 0
        ? `окон на связи: ${viewers}`
        : `сервер окна ОТВЕЧАЕТ на ${url}, но открытых окон НОЛЬ — страница ни в одном браузере не открыта`,
    };
  } catch (e) {
    return {
      ok: false,
      viewers: 0,
      why: `сервер окна не отвечает на ${url}: ${e?.name === 'AbortError' ? `нет ответа за ${timeoutMs} мс` : e?.message ?? e}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function openPulse({
  path = PULSE_PATH,
  source = 'прогон',
  synthetic = false,
  band = '',
  probeSeconds = 10,
  clockMs = () => Date.now(),
  now = () => new Date().toISOString(),
} = {}) {
  const startedMs = clockMs();
  // HOW LONG SILENCE IS EXPECTED TO LAST FROM THIS PULSE — the field that stops the screen from
  // lying. `bugs/14`, the owner watching the second live run: *«почему-то написано, что замерло»*,
  // *«если оно работает, то и визуализатор должен так говорить»*, *«состояние должно быть
  // актуальное, не должно лгать»*.
  //
  // The run BLOCKS during a burn — the load is started synchronously, so nothing can be sent for ten
  // seconds, over SSE or a socket alike (a blocked event loop sends neither; the transport is not
  // what was wrong). The page had a fixed 3 s patience, so every single rung tripped the freeze
  // alarm. An alarm that fires 68 times per run is an alarm nobody believes on the 69th — and that
  // 69th is the real hang this instrument exists for.
  //
  // So the run DECLARES its silence instead of leaving the page to guess: «I am about to go quiet for
  // about N seconds». Silence within the declaration is a burn and the page says so; silence BEYOND
  // it is a hang and the page says that. Both statements are then true.
  const QUIET_IDLE_MS = 4000;
  const quietForBurnMs = Math.round(probeSeconds * 1000 * 1.6) + 8000;
  const snap = {
    kind: 'kago-run-pulse',
    seq: 0,
    runMs: 0,
    at: now(),
    quietMs: QUIET_IDLE_MS,
    run: {
      source,
      band,
      state: RUN_STATE.STARTING,
      frequencyMhz: null,
      voltageMv: null,
      stockVoltageMv: null,
      depthMv: null,
      seeded: false,
      probe: { elapsedSeconds: 0, totalSeconds: probeSeconds },
      bandFromMhz: null,
      bandToMhz: null,
      coverage: { closed: 0, total: null, rungs: 0 },
      verdicts: { 'edge-found': 0, 'lever-limited': 0 },
      lastEvent: '',
      note: '',
      finished: false,
      ok: null,
    },
    card: {
      clockMhz: null, voltageMv: null, tempC: null, fanPct: null, powerW: null,
      underLoad: false, synthetic, cappedByPowerLimit: false,
    },
  };

  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;

  const api = {
    path,
    snapshot: () => snap,

    /**
     * One write. SYNCHRONOUS and via a rename, and both halves matter: the run blocks, so a promise
     * would be delivered after the hang it is meant to report; and a reader polling a half-written
     * file would parse garbage, which a rename inside the same directory makes impossible.
     */
    write() {
      snap.seq += 1;
      snap.runMs = clockMs() - startedMs;
      snap.at = now();
      writeFileSync(tmp, JSON.stringify(snap), 'utf8');
      renameSync(tmp, path);
      return snap.seq;
    },

    /** The engine's own words. The mapping is the only interpretation this module does. */
    event(e) {
      if (!e || !e.kind) return;
      const r = snap.run;
      r.lastEvent = e.text ?? '';
      switch (e.kind) {
        case 'band':
          r.coverage.total = e.frequenciesInBand ?? r.coverage.total;
          // The band's ENDS travel as numbers, not only inside a label: «how far down are we» is a
          // question about position in the band, and a screen that can only print the band cannot
          // answer it. The owner asked it within a minute of watching: «мы ещё сильно вверху».
          r.bandFromMhz = e.fromMhz ?? r.bandFromMhz;
          r.bandToMhz = e.toMhz ?? r.bandToMhz;
          if (e.fromMhz && e.toMhz && !r.band) r.band = `${e.fromMhz}…${e.toMhz} МГц`;
          break;
        case 'rung-start':
          r.state = RUN_STATE.STRESS;
          r.frequencyMhz = e.frequencyMhz ?? r.frequencyMhz;
          r.voltageMv = e.voltageMv ?? r.voltageMv;
          r.depthMv = e.depthMv ?? null;
          r.seeded = e.seeded === true;
          if (r.voltageMv !== null && r.depthMv !== null) r.stockVoltageMv = r.voltageMv + r.depthMv;
          r.probe.elapsedSeconds = 0;
          r.coverage.rungs += 1;
          // THE DECLARATION, and it is made HERE because this event is the last thing sent before the
          // burn blocks everything. Announced after the burn it would be worthless: the silence it
          // describes would already be over.
          snap.quietMs = quietForBurnMs;
          break;
        case 'rung':
          r.state = RUN_STATE.CLOSING;
          // The burn is over and the loop is free again — ordinary patience applies from here.
          snap.quietMs = QUIET_IDLE_MS;
          break;
        case 'closed':
          r.coverage.closed = e.closedTotal ?? r.coverage.closed;
          r.coverage.total = e.frequenciesInBand ?? r.coverage.total;
          if (e.verdict && r.verdicts[e.verdict] !== undefined) r.verdicts[e.verdict] += 1;
          break;
        case 'seed-rejected':
        case 'seed-accepted':
        case 'ratchet':
        case 'recovered':
        case 'hang-attributed':
          r.note = e.text ?? '';
          break;
        default:
          break;
      }
      this.write();
    },

    /** One telemetry sample from whoever is watching the card. */
    telemetry(sample) {
      if (!sample) return;
      snap.card = {
        clockMhz: sample.clockMhz ?? null,
        voltageMv: sample.voltageMv ?? null,
        tempC: sample.tempC ?? null,
        fanPct: sample.fanPct ?? null,
        powerW: sample.powerW ?? null,
        underLoad: sample.underLoad === true,
        synthetic: sample.synthetic === true || synthetic,
        cappedByPowerLimit: sample.cappedByPowerLimit === true,
      };
      // The stress test's own stopwatch: the sample arrives once a simulated second, and the pulse
      // counts them rather than reading a clock — so a bench that does NOT spend the seconds still
      // shows the progress it really made.
      if (snap.card.underLoad) {
        snap.run.probe.elapsedSeconds = Math.min(
          snap.run.probe.totalSeconds,
          Number((snap.run.probe.elapsedSeconds + 1).toFixed(1)),
        );
      }
      this.write();
    },

    /** The end. A finished run must NOT look like a hung one — that is the whole point of saying so. */
    finish({ ok = true, why = '', state = null } = {}) {
      snap.run.finished = true;
      snap.run.ok = ok;
      snap.run.state = state ?? (ok ? RUN_STATE.DONE : RUN_STATE.STOPPED);
      if (why) snap.run.note = why;
      snap.run.probe.elapsedSeconds = 0;
      snap.quietMs = QUIET_IDLE_MS;
      this.write();
    },
  };

  api.write();
  return api;
}

/** Read the gauge. A torn or absent file is not an error — it is «no pulse», which is information. */
export function readPulse(path = PULSE_PATH) {
  try {
    const raw = readFileSync(path, 'utf8');
    const obj = JSON.parse(raw);
    return obj && obj.kind === 'kago-run-pulse' ? obj : null;
  } catch {
    return null;
  }
}

/** Remove a previous run's gauge, so a fresh watcher never shows a stale run as if it were live. */
export function clearPulse(path = PULSE_PATH) {
  try { if (existsSync(path)) unlinkSync(path); } catch { /* a gauge nobody can delete is still just a gauge */ }
}

// =================================================================================================
// 2. THE SERVER — the watcher's half. It READS. It has no path to the card, the journal or the document.
// =================================================================================================

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function sendFile(res, path, type) {
  if (!existsSync(path)) { res.writeHead(404); res.end('нет файла: ' + path); return; }
  const body = readFileSync(path);
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

/**
 * Serve the dashboard on loopback only.
 *
 * `127.0.0.1` is not a preference. This window watches a program that writes voltages into a graphics
 * card; the day it grows a command channel (the owner has already asked for one — `ideas/06`), a
 * network-reachable port would be a remote path to the card's V/F curve. The bind address is decided
 * now, while it costs nothing.
 */
export function serve({
  port = DEFAULT_PORT,
  pulsePath = PULSE_PATH,
  pagePath = PAGE_PATH,
  pollMs = 200,
  onListen = null,
} = {}) {
  const clients = new Set();
  let lastSeq = -1;
  let lastPayload = null;

  const server = createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') return sendFile(res, pagePath, MIME['.html']);
    if (url === '/font.woff2') return sendFile(res, FONT_PATH, MIME['.woff2']);
    if (url === '/logo.webp') return sendFile(res, LOGO_PATH, MIME['.webp']);
    if (url === '/pulse') {
      const p = readPulse(pulsePath);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(p));
    }
    // WHO IS ACTUALLY WATCHING — the route a run asks before it is allowed to touch the card.
    //
    // The owner's rule, 2026-08-16: *«прогоны без визуализатора ПОД СТРОГИМ ЗАПРЕТОМ!!! ЭТО БАГ!!!!!»*
    // A live sweep is authorised by the operator being able to SEE it: the frozen picture is what
    // tells him the machine hung (`ideas/06`), and without a window that signal does not exist.
    //
    // **`viewers` counts OPEN EVENT STREAMS, not server health**, and the difference is the whole
    // point. Twice this day the server answered 200 while no window had opened — an already-running
    // Edge swallowed the request — and a check on the server alone would have said «всё хорошо»
    // both times. A browser holding `/live` is a browser with the page on screen.
    if (url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ viewers: clients.size, pulsePath }));
    }
    if (url === '/live') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      clients.add(res);
      // The current state immediately, so a window opened mid-run is not blank until the next tick.
      if (lastPayload) res.write(`data: ${lastPayload}\n\n`);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    res.writeHead(404);
    return res.end('нет такого адреса');
  });

  // POLLING, not `fs.watch`. The gauge is one small file rewritten by a rename; watching renames
  // across platforms is a pile of special cases, and 200 ms of latency on a picture that a human
  // watches is invisible. The simplest thing that cannot be wrong (PHILOSOPHY.md).
  const timer = setInterval(() => {
    const p = readPulse(pulsePath);
    if (!p || p.seq === lastSeq) return;
    lastSeq = p.seq;
    lastPayload = JSON.stringify(p);
    for (const c of clients) {
      try { c.write(`data: ${lastPayload}\n\n`); } catch { clients.delete(c); }
    }
  }, pollMs);
  timer.unref?.();

  server.listen(port, '127.0.0.1', () => {
    if (onListen) onListen(`http://127.0.0.1:${port}/`);
  });

  return {
    server,
    url: `http://127.0.0.1:${port}/`,
    close() { clearInterval(timer); for (const c of clients) { try { c.end(); } catch { /* gone */ } } server.close(); },
  };
}

/**
 * A separate, minimalist browser window — never a tab in the owner's working browser.
 *
 * Lifted from the review contour (`tools/review.mjs`), including its honesty: we report the ACTION,
 * not the outcome. Spawning the browser we found on disk does not prove the window that appears
 * belongs to it — observed 2026-08-09, when Edge was launched and the page came up in Chrome.
 */
// THE WINDOW'S PROFILE LIVES IN THE OS TEMP DIR, NOT IN THE PROJECT. A browser profile is hundreds
// of JSON files, and the first run of it inflated `npm run check`'s encoding scan from 240 text files
// to 594 — a guard whose input is mostly somebody else's noise is a guard nobody reads. It is also
// not ours to keep: nothing in it describes this project.
export const WINDOW_PROFILE_DIR = join(tmpdir(), 'kago-dashboard-window');
export const WINDOW_PID_PATH = join('runs', 'dashboard', 'window.pid');

/**
 * OUR OWN WINDOW, IN OUR OWN PROFILE — and that is what makes it CLOSABLE.
 *
 * A plain `--app=` launch joins the browser the owner already has running: the process we spawned
 * exits immediately, its pid means nothing, and the window that appears belongs to HIS session. So we
 * could open windows and never close them — which is how the review contour ended up with an orphaned
 * window that swallowed the owner's answers (`bugs/04`), and what he asked for here in one line:
 * «старый браузер умей закрывать».
 *
 * `--user-data-dir` gives this window a profile of its own, so the process we spawn IS the browser
 * instance, its pid is real, and killing it closes exactly our window and nothing of his.
 */
export function openWindow(url, { size = '--window-size=1200,820', profileDir = WINDOW_PROFILE_DIR } = {}) {
  const env = process.env;
  const candidates = [
    ['Edge', join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
    ['Edge', join(env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe')],
    ['Chrome', join(env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')],
    ['Chrome', join(env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')],
  ];
  mkdirSync(dirname(WINDOW_PID_PATH), { recursive: true });
  for (const [name, path] of candidates) {
    if (!path || !existsSync(path)) continue;
    try {
      const child = spawn(path, [
        `--app=${url}`, size,
        `--user-data-dir=${profileDir}`,
        '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
      ], { detached: true, stdio: 'ignore' });
      child.unref();
      writeFileSync(WINDOW_PID_PATH, String(child.pid), 'utf8');
      return { ok: true, browser: name, pid: child.pid };
    } catch { /* try the next one */ }
  }
  try {
    spawn('cmd.exe', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return { ok: true, browser: null, pid: null };
  } catch (e) {
    return { ok: false, why: e?.message ?? 'окно не открылось' };
  }
}

/**
 * Close the window we opened. Two ways, in order of certainty:
 *   1. the pid we recorded — ours by construction, killed with its children;
 *   2. a window whose TITLE is this page's — the fallback for windows opened before the profile
 *      existed, and the only way to reach a window that joined the owner's own browser. It sends
 *      WM_CLOSE to that window alone, so his other tabs are not touched.
 */
export function closeWindow({ titleLike = 'KAGO' } = {}) {
  const closed = [];
  if (existsSync(WINDOW_PID_PATH)) {
    const pid = Number(readFileSync(WINDOW_PID_PATH, 'utf8').trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        closed.push(`pid ${pid}`);
      } catch { /* already gone */ }
    }
    try { unlinkSync(WINDOW_PID_PATH); } catch { /* fine */ }
  }
  try {
    // PowerShell and not bash: this is a Windows API call, and the project pays for that mix-up
    // often enough to have a dossier row about it (EXP-0043).
    spawn('powershell.exe', ['-NoProfile', '-Command',
      `Get-Process msedge,chrome -ErrorAction SilentlyContinue | `
      + `Where-Object { $_.MainWindowTitle -like '*${titleLike}*' } | ForEach-Object { $_.CloseMainWindow() } | Out-Null`,
    ], { stdio: 'ignore', windowsHide: true });
    closed.push(`окна с «${titleLike}» в заголовке`);
  } catch { /* nothing to close */ }
  return { closed };
}

// =================================================================================================
// 3. Selftest — no browser, no card, no production directories
// =================================================================================================
//
// MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
//   - the gauge keeps a history instead of one object   → «ГАУГЕ: один объект, а не журнал»
//   - `rung-start` published after the burn             → «ПУЛЬС: ступень названа ДО обращения к карте»
//   - the sequence number stops advancing               → «ПУЛЬС: каждая запись двигает номер»
//   - a finished run left looking live                  → «КОНЕЦ: завершённый прогон не выглядит зависшим»
//   - the synthetic flag dropped on the way through     → «ЧЕСТНОСТЬ: метка синтетики доезжает до экрана»
export async function selfTest() {
  const results = [];
  const check = (n, cond, why = '', note = '') => results.push({ n, ok: !!cond, why, note });

  const dir = join('runs', 'dashboard-selftest');
  const path = join(dir, 'live.json');
  clearPulse(path);

  let t = 0;
  const pulse = openPulse({
    path, source: 'самопроверка', synthetic: true, band: '2842…2800 МГц', probeSeconds: 10,
    clockMs: () => (t += 250), now: () => '2026-08-16T03:00:00+03:00',
  });

  check('ГАУГЕ: файл появляется сразу и разбирается', readPulse(path) !== null, 'пульса нет на диске');

  pulse.event({ kind: 'band', text: 'полоса', fromMhz: 2842, toMhz: 2800, frequenciesInBand: 43 });
  pulse.event({ kind: 'rung-start', text: 'ступень', frequencyMhz: 2842, voltageMv: 995, depthMv: 50, seeded: false });
  const afterStart = readPulse(path);
  check('ПУЛЬС: ступень названа ДО обращения к карте — на экране частота и напряжение под тестом',
    afterStart.run.frequencyMhz === 2842 && afterStart.run.voltageMv === 995
    && afterStart.run.stockVoltageMv === 1045 && afterStart.run.state === RUN_STATE.STRESS,
    JSON.stringify(afterStart.run));
  check('ПУЛЬС: полоса даёт знаменатель покрытия', afterStart.run.coverage.total === 43,
    `в пульсе ${afterStart.run.coverage.total}`);

  // — `bugs/14`: ПРОГОН ОБЪЯВЛЯЕТ СВОЁ МОЛЧАНИЕ, и страница из-за этого перестаёт лгать.
  //   Владелец, второй живой прогон: «почему-то написано, что замерло» — при живом и здоровом
  //   прогоне. Прожиг блокирует процесс на десять секунд, а терпение страницы было три.
  //   АДРЕСАТЫ МУТАЦИЙ, названы ДО прогона:
  //     AB. не поднимать бюджет перед прожигом      → «БЮДЖЕТ МОЛЧАНИЯ ПОДНЯТ ПЕРЕД ПРОЖИГОМ»
  //     AC. не опускать его после                   → «и ОПУЩЕН, как только процесс снова свободен»
  //     AD. бюджет короче самого прожига            → «бюджет ПОКРЫВАЕТ прожиг с запасом»
  check('БЮДЖЕТ МОЛЧАНИЯ ПОДНЯТ ПЕРЕД ПРОЖИГОМ — иначе тревога врёт на каждой ступени',
    afterStart.quietMs > 10_000, `quietMs=${afterStart.quietMs}, а прожиг 10 с`);
  check('и бюджет ПОКРЫВАЕТ прожиг С ЗАПАСОМ — тревога зажигается только за пределом объявленного',
    afterStart.quietMs >= 10_000 * 1.5, `quietMs=${afterStart.quietMs}`);

  const seqBefore = afterStart.seq;
  pulse.telemetry({ clockMhz: 2842, voltageMv: 995, tempC: 61.2, fanPct: 44, powerW: 248, underLoad: true, synthetic: true });
  pulse.telemetry({ clockMhz: 2842, voltageMv: 995, tempC: 62.0, fanPct: 45, powerW: 249, underLoad: true, synthetic: true });
  const afterTele = readPulse(path);
  check('ПУЛЬС: каждая запись двигает номер — по нему watcher и отличает живое от замершего',
    afterTele.seq === seqBefore + 2, `было ${seqBefore}, стало ${afterTele.seq}`);
  check('ПУЛЬС: секунды стресс-теста считаются по тикам карты, а не по часам',
    afterTele.run.probe.elapsedSeconds === 2 && afterTele.run.probe.totalSeconds === 10,
    JSON.stringify(afterTele.run.probe));
  check('ЧЕСТНОСТЬ: метка синтетики доезжает до экрана вместе с показаниями',
    afterTele.card.synthetic === true && afterTele.card.tempC === 62,
    JSON.stringify(afterTele.card));

  pulse.event({ kind: 'rung', text: 'ступень прошла', frequencyMhz: 2842, voltageMv: 995, outcome: 'passed' });
  pulse.event({ kind: 'closed', text: 'частота закрыта', frequencyMhz: 2842, verdict: 'edge-found', closedTotal: 7, frequenciesInBand: 43 });
  const afterClosed = readPulse(path);
  check('ПОКРЫТИЕ: закрытые частоты берутся из собственного счёта прогона',
    afterClosed.run.coverage.closed === 7 && afterClosed.run.verdicts['edge-found'] === 1,
    JSON.stringify(afterClosed.run.coverage));
  check('и бюджет молчания ОПУЩЕН, как только процесс снова свободен — иначе зависание после прожига проспим',
    afterClosed.quietMs < 10_000 && afterClosed.quietMs > 0,
    `quietMs=${afterClosed.quietMs} после закрытия ступени`);

  const keys = Object.keys(afterClosed);
  check('ГАУГЕ: один объект, а не журнал — у прибора нет памяти и он не может её завести',
    !Array.isArray(afterClosed) && !keys.includes('history') && !keys.includes('events'), keys.join(','));

  pulse.finish({ ok: true });
  const done = readPulse(path);
  check('КОНЕЦ: завершённый прогон НЕ выглядит зависшим — он говорит, что закончился',
    done.run.finished === true && done.run.ok === true && done.run.state === RUN_STATE.DONE,
    JSON.stringify(done.run.state));

  clearPulse(path);
  check('ПЕСОЧНИЦА: самопроверка убирает за собой', !existsSync(path), 'файл остался');

  const failed = results.filter((r) => !r.ok).length;
  return { ok: failed === 0, results, failed };
}

// =================================================================================================
// 4. CLI
// =================================================================================================

async function main(argv) {
  if (argv.includes('--selftest')) {
    const r = await selfTest();
    for (const x of r.results) console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.n}${x.ok ? '' : `\n       причина: ${x.why}`}`);
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА ДАШБОРДА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА ДАШБОРДА: есть расхождения.');
    return r.ok ? 0 : 1;
  }

  if (argv.includes('--close')) {
    const gone = closeWindow();
    console.log(gone.closed.length ? `ОКНО: закрыто (${gone.closed.join(', ')})` : 'ОКНО: закрывать было нечего');
    return 0;
  }

  const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const port = Number(arg('port', DEFAULT_PORT));

  const s = serve({ port, onListen: (url) => console.log(`ДАШБОРД: ${url}`) });
  console.log('ЧТО ЭТО: окно наблюдения за прогоном. Оно только ЧИТАЕТ — ни карты, ни журнала, ни документа кривой');
  console.log(`         оно не касается. Источник — ${PULSE_PATH} (прибор, не запись).`);
  // THE OLD WINDOW GOES FIRST — the owner's instruction while watching the first rehearsal
  // («старый браузер умей закрывать»). A second window on the same gauge is not a second view, it is
  // a stale one: whoever glances at the wrong one is reading a run that no longer exists.
  if (!argv.includes('--no-window')) {
    const gone = closeWindow();
    if (gone.closed.length) console.log(`ОКНО:    закрыл прежнее (${gone.closed.join(', ')})`);
    const w = openWindow(s.url);
    console.log(w.ok
      ? `ОКНО:    запросил отдельное окно ${w.browser ?? 'браузера по умолчанию'}. Если система открыла другим — так решила она.`
      : `ОКНО:    не открылось (${w.why}). Адрес выше — откройте вручную.`);
  }
  console.log('         Ctrl+C — закрыть сервер И окно.');
  // A server that dies leaving its window up is the `bugs/04` shape: the picture stays on screen,
  // frozen, and looks exactly like the hang this instrument exists to report.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { closeWindow(); s.close(); process.exit(0); });
  }
  return new Promise(() => {});
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
