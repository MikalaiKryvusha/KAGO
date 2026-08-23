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

import { writeFileSync, renameSync, readFileSync, existsSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const PULSE_PATH = join('runs', 'dashboard', 'live.json');
/** Where the side-car sampler writes the card's readings for the whole run. One file, appended. */
export const TELEMETRY_PATH = join('runs', 'dashboard', 'telemetry.jsonl');
export const PAGE_PATH = join('assets', 'dashboard', 'sweep.html');
export const FONT_PATH = join('assets', 'fonts', 'DSEG7Classic-Regular.woff2');
export const LOGO_PATH = join('assets', 'logo', 'kago-logo.webp');
/** ЗАПИСАННАЯ ТЕМА — готовый трек владельца, первая тема меню и тема по умолчанию. */
export const TRACK_PATH = join('assets', 'dashboard', 'themes', 'deep-space.mp3');
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
  shapesPerRung = 1,
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
  // 🔴 БЮДЖЕТ СЧИТАЕТСЯ НА ВЕСЬ НАБОР ФОРМ, А НЕ НА ОДНУ — и вот чем за это заплачено.
  //
  // Формула выше родилась, когда ступень была ОДНИМ прожигом на 10 секунд, и давала 24 с. Потом
  // ступень стала НАБОРОМ ИЗ ТРЁХ ФОРМ (сессия 36) — то есть молчит ~30 с, — а бюджет никто не
  // пересмотрел. Тревога снова загорелась на каждой ступени, и владелец снова увидел «ЗАМЕРЛО» на
  // здоровом прогоне (2026-08-22 21:2x, дословно: «оно каждый раз между сменой напряжения пишет,
  // что замерло», «это неправильное поведение»).
  //
  // Это тот же класс, что EXP-0104: новая верная механика молча отменила старый верный договор, и не
  // покраснело НИЧТО — договор был выражен числом, а число не знает, что работа под ним выросла.
  // Поэтому множитель здесь не константа, а САМ РАЗМЕР НАБОРА: вырастет набор — вырастет и бюджет,
  // без второй правки в другом файле.
  const QUIET_IDLE_MS = 4000;
  const shapes = Number.isFinite(shapesPerRung) && shapesPerRung > 0 ? shapesPerRung : 1;
  const quietForBurnMs = Math.round(probeSeconds * 1000 * shapes * 1.6) + 8000;
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
      // ПОСЛЕДНИЙ ВЫПОЛНЕННЫЙ ШАГ — слово владельца 2026-08-22: «величина напряжения, которой
      // спустились от высшего к текущему напряжению, последний выполненный шаг». Считается ЗДЕСЬ,
      // из того, что реально произошло, а не берётся из плана: план и пройденное расходятся на
      // затравке и на ступенях, которые сетка вынудила глубже, — а спрошено про пройденное.
      stepMv: null,
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
        case 'rung-start': {
          r.state = RUN_STATE.STRESS;
          // ШАГ СЧИТАЕТСЯ ДО ТОГО, как текущее напряжение затрёт предыдущее — иначе вычитать не из
          // чего. Внутри одной частоты это расстояние до предыдущей ступени; на ПЕРВОЙ ступени
          // частоты «высшее напряжение» — это сток, и шаг совпадает с глубиной. Смена частоты
          // обнуляет счёт: шаг между ступенями РАЗНЫХ лестниц не значит ничего.
          const sameFrequency = e.frequencyMhz != null && e.frequencyMhz === r.frequencyMhz;
          const prevMv = r.voltageMv;
          const nextMv = e.voltageMv ?? r.voltageMv;
          r.stepMv = (sameFrequency && Number.isFinite(prevMv) && Number.isFinite(nextMv) && prevMv > nextMv)
            ? prevMv - nextMv
            : (Number.isFinite(e.depthMv) ? e.depthMv : null);
          r.frequencyMhz = e.frequencyMhz ?? r.frequencyMhz;
          r.voltageMv = nextMv;
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
        }
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
        // ПЕРЕИГРЫВАНИЕ СТУПЕНИ ПЕРЕОБЪЯВЛЯЕТ БЮДЖЕТ МОЛЧАНИЯ — ЯВНО, а не по наследству.
        // Починка `bugs/28` жжёт набор заново с ослабленной нагрузкой, то есть впереди ЕЩЁ один
        // полный набор форм. До этой строки событие падало в `default`, и бюджет держался только
        // потому, что его никто не перетёр, — случайная правильность, которая живёт до первой
        // правки соседнего case. Объявляем вслух: событие уходит последним перед новой блокировкой.
        case 'load-eased':
          r.note = e.text ?? '';
          snap.quietMs = quietForBurnMs;
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

/**
 * THE PULSE AS IT IS AT THIS MOMENT, WITH ITS REAL AGE — and this exists because a window that opens
 * on a leftover file showed LAST run as if it were happening now.
 *
 * The owner, opening the window between runs: *«запустилось в состоянии прогон оставлен»* ·
 * *«визуализатор должен запускаться в АДЕКВАТНОМ СОСТОЯНИИ ОТРАЖАЮЩИМ СОСТОЯНИЕ ТЕКУЩЕГО ПРОГОНА!!!!»*
 *
 * The page measures silence from the moment it RECEIVED a pulse. That is right for pulses that arrive
 * during a run and wrong for the first one, which can be a file written an hour ago: received now,
 * it looks a second old. So the age is computed HERE, against the stamp inside the record, and
 * travels with it. The page adds its own waiting on top of that number instead of starting from zero.
 *
 * Three honest states, and «no run» is one of them — a window with nothing to show must say so
 * rather than show the last thing it remembers.
 *
 * @returns {object} the pulse plus `{ageMs, noRun}`, or a `noRun` stub when there is no file
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export const FINISHED_GRACE_MS = 60_000;

export function pulseNow(path = PULSE_PATH, nowMs = Date.now(), telemetryPath = TELEMETRY_PATH) {
  const p = readPulse(path);
  // A FINISHED RUN STOPS BEING THE CURRENT RUN. The owner, opening the window long after one ended:
  // «поднялось на ПРОГОН ОСТАНОВЛЕН - баг». He is right — his rule is «состояние ТЕКУЩЕГО прогона»,
  // and a run that ended ten minutes ago is not current, however honestly its ending is described.
  //
  // The grace exists because the opposite mistake is just as bad: wiping the result the instant a run
  // finishes hides the ending from the person who was watching for it. So the finish is shown for a
  // minute — long enough to read — and after that the window says what is true: nothing is running.
  const finishedAgeMs = p?.run?.finished && Number.isFinite(Date.parse(p.at)) ? nowMs - Date.parse(p.at) : 0;
  const staleFinish = p?.run?.finished === true && finishedAgeMs > FINISHED_GRACE_MS;
  if (!p || staleFinish) {
    const tail = staleFinish
      ? `прогона сейчас нет · последний («${p.run.state}») завершён ${Math.round(finishedAgeMs / 60_000)} мин назад`
      : 'прибор пуст — ни один прогон сейчас не идёт';
    return {
      kind: 'kago-run-pulse',
      noRun: true,
      ageMs: 0,
      seq: -1,
      runMs: 0,
      at: null,
      quietMs: 0,
      run: {
        source: '', band: '', state: 'ПРОГОНА НЕТ', frequencyMhz: null, voltageMv: null,
        stockVoltageMv: null, depthMv: null, seeded: false,
        probe: { elapsedSeconds: 0, totalSeconds: 0 },
        bandFromMhz: null, bandToMhz: null,
        coverage: { closed: 0, total: null, rungs: 0 },
        verdicts: { 'edge-found': 0, 'lever-limited': 0 },
        lastEvent: '', note: tail, finished: false, ok: null,
      },
      card: {
        clockMhz: null, voltageMv: null, tempC: null, fanPct: null, powerW: null,
        underLoad: false, synthetic: false, cappedByPowerLimit: false,
      },
    };
  }
  const stampedMs = Date.parse(p.at);
  const ageMs = Number.isFinite(stampedMs) ? Math.max(0, nowMs - stampedMs) : 0;
  // THE CARD'S OWN READINGS, MERGED FROM THE SEPARATE SAMPLER. The owner: «лсд дисплеи мертвые,
  // ничего не показывают - баг» — and they were, on the live path, by construction: the sweep is
  // blocked inside the burn and cannot sample its own card (`ideas/06` §A). Only a process that is
  // NOT blocked can, so one runs alongside for the whole sweep and the server reads its last line.
  // Merged HERE rather than pushed by the run, because the run is precisely the thing that is busy.
  const card = latestTelemetry(telemetryPath);

  // ⏱ И СЕКУНДЫ СТРЕСС-ТЕСТА — ТОЖЕ ЗДЕСЬ, ПО ТОЙ ЖЕ ПРИЧИНЕ. Владелец, глядя на живой прогон:
  // «циферки не тикают · стресс-тест устойчивости 0,0 из 10 с».
  //
  // `elapsedSeconds` в ФАЙЛЕ двигает тот, кто зовёт `telemetry()` — на стенде это виртуальная карта,
  // тикающая раз в имитируемую секунду. На живом пути звать его НЕКОМУ: развёртка заблокирована
  // внутри прожига ровно те десять секунд, которые надо показать. Тот же класс, что и мёртвые
  // индикаторы, и то же лекарство — вычислить у сервера, который не занят.
  //
  // ОДНА ФОРМУЛА НА ОБА ПУТИ, без флага «мы на стенде»: берём БОЛЬШЕЕ из «что натикало в файле» и
  // «сколько прошло с объявления ступени». На стенде прожиги ускорены вдесятеро, поэтому тиков
  // больше, чем настоящих секунд, и побеждает файл — стенд продолжает показывать пройденное им, а не
  // сжатое время (EXP-0078). Живьём в файле ноль, и побеждает время. Потолок в обоих случаях —
  // объявленная длительность, так что зависший прогон досчитает до неё и встанет, отдав сигнал
  // сторожу молчания, а не рисуя бесконечный рост.
  let run = p.run;
  if (run && run.finished !== true && run.probe && Number.isFinite(run.probe.totalSeconds)) {
    const byClock = Math.min(run.probe.totalSeconds, Math.max(0, ageMs / 1000));
    const shown = Math.max(run.probe.elapsedSeconds ?? 0, byClock);
    run = { ...run, probe: { ...run.probe, elapsedSeconds: Number(shown.toFixed(1)) } };
  }

  // ⏱ ЧАСЫ ПРОГОНА ТОЖЕ СЧИТАЕТ СЕРВЕР — ТРЕТЬЯ ВЕЛИЧИНА ЭТОГО ЖЕ КЛАССА.
  //
  // Владелец, глядя на живой прогон 2026-08-22 22:0x: «сломался счётчик время прогона», «был ноль,
  // затем резко стал 37 секунд. Не тикает равномерно».
  //
  // `runMs` двигал САМ прогон, а он на время прожига заблокирован целиком — файл пульса не
  // обновляется, часы стоят, а на следующей записи прыгают на всю длительность прожига разом. Ровно
  // то же уже чинили дважды: мёртвые индикаторы карты (их отдаёт сэмплер) и замерший счётчик секунд
  // пробы (его считает сервер). `runMs` тогда пропустили — и он остался последней величиной,
  // зависящей от того, кто занят.
  //
  // Лекарство то же и по той же причине: к записанному значению прибавляется время, прошедшее с
  // отметки пульса. Утверждение остаётся ИСТИННЫМ — прогон действительно идёт столько, — а тикает
  // оно теперь с частотой кадров сервера, а не прогона. ЗАВЕРШЁННЫЙ прогон не растёт: у него часы
  // остановлены по определению, иначе страница врала бы о законченной работе.
  const runMs = p.run?.finished === true ? p.runMs : (Number(p.runMs) || 0) + ageMs;

  return { ...p, noRun: false, ageMs, runMs, run, card: card ? { ...p.card, ...card } : p.card };
}

/** The freshest sample the side-car sampler has written, or `null`. Read-only, never throws. */
export function latestTelemetry(path = TELEMETRY_PATH, maxAgeMs = 15_000) {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    const lines = raw.trimEnd().split('\n');
    for (let i = lines.length - 1; i >= 0 && i > lines.length - 4; i--) {
      let rec = null;
      try { rec = JSON.parse(lines[i]); } catch { continue; }      // a torn last line is normal
      const s = rec?.sample ?? rec;
      if (!s) continue;
      const at = Date.parse(rec?.at ?? s?.at ?? '');
      if (Number.isFinite(at) && Date.now() - at > maxAgeMs) return null;   // stale is not a reading
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
      return {
        clockMhz: num(s['clocks.gr']),
        tempC: num(s['temperature.gpu']),
        fanPct: num(s['fan.speed']),
        powerW: num(s['power.draw.instant'] ?? s['power.draw']),
        underLoad: num(s['utilization.gpu']) > 50,
        synthetic: false,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// =================================================================================================
// 2. THE SERVER — the watcher's half. It READS. It has no path to the card, the journal or the document.
// =================================================================================================

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
};

function sendFile(res, path, type, { cache = false } = {}) {
  if (!existsSync(path)) { res.writeHead(404); res.end('нет файла: ' + path); return; }
  const body = readFileSync(path);
  res.writeHead(200, {
    'content-type': type,
    // ЗАПИСЬ ТЕМЫ — ЕДИНСТВЕННОЕ, ЧТО КЭШИРУЕТСЯ. Всё остальное на этом сервере обязано быть
    // свежим: страница и прибор меняются каждую секунду прогона, и старый ответ там — это ложь.
    // Трек не меняется никогда, а весит десять мегабайт: без кэша он ехал бы заново на каждую
    // перезагрузку окна, и первые секунды звучания достались бы загрузке, а не музыке.
    'cache-control': cache ? 'public, max-age=31536000, immutable' : 'no-store',
  });
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
  // ШОВ ДЛЯ ПЕСОЧНИЦЫ: путь телеметрии — параметр, а не константа. Без него самопроверка вынуждена
  // была писать в БОЕВОЙ файл и класть его обратно из резервной копии; на простое это безобидно, но
  // во время живого прогона стёрло бы его улики (`bugs/08` — набор не трогает улики) и закрывало
  // набору дорогу в батарею, которая обещает «карту можно не освобождать». Теперь дорога открыта.
  telemetryPath = TELEMETRY_PATH,
  pagePath = PAGE_PATH,
  pollMs = 200,
  heartbeatMs = 10_000,
  onListen = null,
  onError = null,
} = {}) {
  const clients = new Set();
  let lastSeq = -1;
  let lastPayload = null;
  // Слепок последней РАЗОСЛАННОЙ нагрузки без возраста — по нему решается, есть ли что сказать
  // (`bugs/27`). Отдельная переменная, а не сравнение с `lastPayload`: тот несёт возраст, который
  // тикает сам, и сравнение с ним всегда было бы «изменилось».
  let lastCompare = null;

  const server = createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') return sendFile(res, pagePath, MIME['.html']);
    if (url === '/font.woff2') return sendFile(res, FONT_PATH, MIME['.woff2']);
    if (url === '/logo.webp') return sendFile(res, LOGO_PATH, MIME['.webp']);
    if (url === '/theme.mp3') return sendFile(res, TRACK_PATH, MIME['.mp3'], { cache: true });
    // ⚡ ТЕЛЕМЕТРИЯ — ОТДЕЛЬНЫЙ КАНАЛ, И ЭТО СЛОВО ВЛАДЕЛЬЦА (2026-08-16): «ни анимация, ни
    // телеметрия карточки не должны замирать ни от каких тиков» · «телеметрия всегда в реальном
    // времени питается особым модулем телеметрии».
    //
    // Прежде показания ехали ВНУТРИ пульса, а пульс — это события ПРОГОНА: он молчит все десять
    // секунд каждого прожига, потому что процесс заблокирован внутри нагрузки. То есть индикаторы
    // застывали ровно в тот момент, ради которого их и рисовали. Источник у них другой — отдельный
    // процесс-сэмплер, который НЕ заблокирован, — значит и канал у них должен быть свой, со своим
    // темпом, не зависящим от хода прогона.
    if (url === '/telemetry') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      const live = latestTelemetry(telemetryPath);
      const fromPulse = readPulse(pulsePath)?.card ?? null;
      // Один ответ, один автор: живая проба поверх того, что записал сам прогон (на стенде карту
      // тикает виртуальная — там сэмплера нет вовсе). Страница спрашивает ОДИН адрес.
      return res.end(JSON.stringify(live ? { ...(fromPulse ?? {}), ...live } : fromPulse));
    }
    if (url === '/pulse') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(pulseNow(pulsePath, Date.now(), telemetryPath)));
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
      // THE CURRENT STATE IMMEDIATELY — and «current» is computed AT THIS INSTANT, not replayed from
      // whatever was last broadcast. A window opening between runs used to receive the last payload
      // of the PREVIOUS run and, having just received it, treat it as one second old: it showed a
      // finished run as if it were happening. Now the first frame carries the record's REAL age, or
      // says outright that no run exists.
      res.write(`data: ${JSON.stringify(pulseNow(pulsePath, Date.now(), telemetryPath))}\n\n`);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    res.writeHead(404);
    return res.end('нет такого адреса');
  });

  // POLLING, not `fs.watch`. The gauge is one small file rewritten by a rename; watching renames
  // across platforms is a pile of special cases, and 200 ms of latency on a picture that a human
  // watches is invisible. The simplest thing that cannot be wrong (PHILOSOPHY.md).
  //
  // ⚠️ THE GAUGE DISAPPEARING IS ITSELF A CHANGE, and the loop used to swallow it: `if (!p) return`
  // meant the transition «прогон был → прибора нет» never reached an OPEN window, which then kept
  // painting the last run forever. Same defect class as the stale first frame, one layer down —
  // both come from treating «нет данных» as «нечего сказать» instead of as a state (`bugs/14`).
  const timer = setInterval(() => {
    const p = pulseNow(pulsePath, Date.now(), telemetryPath);
    // 🔴 ЧТО СЧИТАЕТСЯ ИЗМЕНЕНИЕМ — ПЕРЕОПРЕДЕЛЕНО `bugs/27`. Прежде здесь стояло `p.seq === lastSeq`:
    // рассылку двигал ТОЛЬКО номер пульса, а его двигает развёртка — единственный участник, который
    // на все десять секунд прожига перестаёт говорить. Показания карты `pulseNow` подмешивает сюда с
    // ОТДЕЛЬНОГО сэмплера на каждом опросе, и делает это ровно потому, что «прогон занят», — но в
    // ворота они не проходили, потому что ключ от ворот был у занятого. Замерено на живом прогоне
    // 2026-08-22: сэмплер 260 замеров, страница 42 пульса за те же 259 с.
    //
    // Теперь изменением считается ЛЮБОЕ изменение нагрузки, КРОМЕ возраста: он тикает сам по себе и
    // превратил бы это в вещателя, которому нечего сказать. `seq` при этом никуда не делся — он
    // часть нагрузки, поэтому исчезновение прибора (`seq` = −1) по-прежнему уезжает на страницу.
    //
    // ЦЕНА, НАЗВАННАЯ ВСЛУХ: секунды стресс-теста считает сервер, они меняются чаще опроса — значит
    // во время прожига рассылка идёт с частотой опроса (5/с по 200 мс). Это петля обратной связи в
    // сотню байт на localhost, и она ровно то, ради чего всё: картинка ЖИВЁТ, пока идут данные, и
    // замирает в тот момент, когда они кончились. Свойство «замерла = прогон встал» сохранено, а не
    // разменяно.
    const compare = JSON.stringify({ ...p, ageMs: 0 });
    if (compare === lastCompare) return;
    lastCompare = compare;
    lastSeq = p.seq;
    lastPayload = JSON.stringify(p);
    for (const c of clients) {
      try { c.write(`data: ${lastPayload}\n\n`); } catch { clients.delete(c); }
    }
  }, pollMs);
  timer.unref?.();

  // ⚠️ A STREAM THAT SENDS NOTHING IS INDISTINGUISHABLE FROM A DEAD ONE — for the browser, for the
  // OS, and for us. Between runs this server has nothing to say for hours: `seq` never changes, so
  // the broadcast loop above writes not a single byte after the first frame. On 2026-08-16 that
  // silent stream was dropped somewhere below us and the page never came back — the window stayed
  // on screen, painted and frozen, while `/health` counted ZERO viewers and the sweep refused to
  // start «без окна» with a window plainly visible on the owner's monitor.
  //
  // An SSE comment line (`:` … ) is the protocol's own keep-alive: the client ignores it, and it
  // proves the path is still there in both directions. This is the established pattern, not our
  // invention — an idle EventSource without a heartbeat is a known way to lose a connection.
  const beat = setInterval(() => {
    for (const c of clients) {
      try { c.write(': пульс\n\n'); } catch { clients.delete(c); }
    }
  }, heartbeatMs);
  beat.unref?.();

  // A BIND FAILURE IS AN ANSWER, NEVER AN UNHANDLED EVENT.
  //
  // `listen` is asynchronous, so `serve()` returns while the bind is still in flight and an
  // `'error'` with no listener becomes a raw Node stack trace — thrown AFTER the caller has already
  // walked on and done its next thing. That is precisely what happened on 2026-08-16: the caller
  // had closed the operator's window by the time the throw arrived, so the crash landed on a
  // desktop with no window and an orphaned server from a previous session still holding the port.
  // The stack trace named `net.js` and nothing the operator could act on.
  server.on('error', (err) => {
    if (onError) return onError(err);
    console.error(`ДАШБОРД: не поднялся — ${err?.code ?? err?.message ?? 'причина не названа'}`);
    process.exitCode = 1;
    return undefined;
  });

  server.listen(port, '127.0.0.1', () => {
    if (onListen) onListen(`http://127.0.0.1:${port}/`);
  });

  return {
    server,
    url: `http://127.0.0.1:${port}/`,
    // Idempotent, and safe on a server that never bound. `startServing` hands the caller its object
    // even on EADDRINUSE (the polling timer still has to be stopped), so `close()` is reachable on a
    // handle libuv never opened — and closing that twice aborts the process from inside libuv.
    close() {
      clearInterval(timer);
      clearInterval(beat);
      for (const c of clients) { try { c.end(); } catch { /* gone */ } }
      try { if (server.listening) server.close(); } catch { /* already down */ }
    },
  };
}

/**
 * `serve()` WITH ITS BIND AWAITED — so a caller can branch on «поднялся / порт занят» instead of
 * walking on into an outcome that has not happened yet.
 *
 * Everything downstream of the raise (closing the old window, opening a new one) is irreversible on
 * the operator's screen, and an asynchronous bind means the caller reaches those lines BEFORE it
 * knows whether it owns the port. Awaiting the bind is what lets the order be «checked, then done».
 */
export function startServing(opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const s = serve({
      ...opts,
      onListen: (url) => {
        if (!settled) { settled = true; resolve({ ok: true, s, url }); }
        opts.onListen?.(url);
      },
      onError: (err) => {
        if (!settled) { settled = true; resolve({ ok: false, s, code: err?.code ?? null, why: err?.message ?? 'причина не названа' }); }
      },
    });
  });
}

/**
 * IS ANYTHING SERVING THIS PORT, AND IS IT ONE OF OURS?
 *
 * The port alone does not identify a program, and «kill whatever holds 7311» is not a thing this
 * project may do on the owner's machine. `/health` is the discriminator: it is this server's own
 * route and answers a shape nothing else does (`viewers` + `pulsePath`). A listener that cannot
 * produce that shape is somebody else's and is never touched — it is reported and the command
 * refuses.
 */
// `node:http` AND NOT `fetch`. A probe must leave NOTHING behind: `fetch` keeps its abort timer and
// parks the socket in a keep-alive pool, and this function is called from a command that exits
// immediately afterwards — exiting on top of those handles aborts the process from inside libuv
// («Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)», observed 2026-08-16). A raw request we
// own can be destroyed on every path, which is the whole reason to use the lower-level API here.
export async function probeDashboard(port = DEFAULT_PORT, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = httpRequest({
      host: '127.0.0.1', port, path: '/health', method: 'GET', agent: false, timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return finish({ alive: true, ours: false, why: `ответил ${res.statusCode}` });
        try {
          const body = JSON.parse(raw);
          const ours = !!body && typeof body === 'object'
            && typeof body.pulsePath === 'string' && typeof body.viewers === 'number';
          return finish({ alive: true, ours, viewers: body?.viewers ?? null, pulsePath: body?.pulsePath ?? null });
        } catch {
          return finish({ alive: true, ours: false, why: 'ответ не разбирается как JSON' });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); finish({ alive: false, ours: false, why: 'молчит дольше отпущенного' }); });
    req.on('error', (e) => { finish({ alive: false, ours: false, why: e?.message ?? 'нет ответа' }); });
    req.end();
  });
}

/**
 * Which process is listening on the port. PowerShell and not bash — `Get-NetTCPConnection` is a
 * Windows API call, and MSYS2 rewrites `/Flag` arguments into paths before the program sees them
 * (EXP-0043, dossier row «Windows slash-flags from Git Bash»).
 */
export function findListenerPid(port = DEFAULT_PORT) {
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue `
      + '| Select-Object -First 1 -ExpandProperty OwningProcess',
    ], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim();
    const pid = Number(out);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

/** Stop a process we have positively identified as ours. Same instrument the window uses. */
export function killPid(pid) {
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: 15000 });
    return true;
  } catch { return false; }
}

/**
 * Poll until nothing answers on the port. A kill is asynchronous — the socket outlives the process
 * by a moment — and rebinding into that moment is how a takeover turns into a second failure.
 */
export async function waitPortFree(port = DEFAULT_PORT, { tries = 20, everyMs = 250, probeFn = probeDashboard } = {}) {
  for (let i = 0; i < tries; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await probeFn(port, { timeoutMs: 500 })).alive) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, everyMs); });
  }
  return false;
}

/**
 * Poll until a browser is actually HOLDING the event stream — the only proof a window exists.
 *
 * A browser takes seconds to start cold, so the absence of a viewer in the first instant means
 * nothing; the absence of one after the whole budget means the window never came up.
 */
export async function waitForViewer(port = DEFAULT_PORT, { tries = 40, everyMs = 250, probeFn = probeDashboard } = {}) {
  for (let i = 0; i < tries; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const p = await probeFn(port, { timeoutMs: 700 });
    if (p.ours && (p.viewers ?? 0) >= 1) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, everyMs); });
  }
  return false;
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
 *
 * AND THAT SAME OWNED PROFILE IS WHY THE RUN CAN START WITH SOUND (owner, 2026-08-22: «прогон
 * должен начинаться с включенным звуком»). A page cannot lift the autoplay policy — only the
 * browser that hosts it can, and here we ARE that browser: `--autoplay-policy=no-user-gesture-required`
 * applies to this window and to nothing else the owner has open. The page still checks whether sound
 * genuinely runs and falls back to «waiting for a click» if it does not, because a flag we pass is a
 * REQUEST, not a fact — the same rule that closed `bugs/27`: ask the transport, do not assume it.
 */
/**
 * The argv the window is opened with — a FUNCTION, so the selftest can read what we actually pass
 * instead of taking the source code's word for it. A flag asserted by grepping the file is not
 * asserted at all: the grep survives the day someone moves the spawn.
 */
export function windowArgs(url, { size = '--window-size=1200,820', profileDir = WINDOW_PROFILE_DIR } = {}) {
  return [
    `--app=${url}`, size,
    `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
    // Звук на старте прогона — слово владельца 2026-08-22. Действует ТОЛЬКО на это окно: профиль наш.
    '--autoplay-policy=no-user-gesture-required',
  ];
}

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
      const child = spawn(path, windowArgs(url, { size, profileDir }), { detached: true, stdio: 'ignore' });
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
// ⚠️ SYNCHRONOUS ON PURPOSE, AND THAT IS THE WHOLE POINT OF THIS FUNCTION'S SHAPE.
//
// Both closers used to be `spawn` — fire-and-forget — so `closeWindow()` returned while nothing had
// closed yet, and the caller opened the new window into that gap. The title sweep then arrived LATE
// and matched the window we had just opened, because its title also says «KAGO»: the command closed
// its own result and left the operator with a live server and no window (`viewers: 0`, observed
// 2026-08-16 13:1x). A closer that has not finished closing has not closed anything — so every
// child here is awaited, and the sweep waits for the windows it asked to exit.
export function closeWindow({ titleLike = 'KAGO', waitMs = 4000 } = {}) {
  const closed = [];
  if (existsSync(WINDOW_PID_PATH)) {
    const pid = Number(readFileSync(WINDOW_PID_PATH, 'utf8').trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, timeout: waitMs + 2000 });
        closed.push(`pid ${pid}`);
      } catch { /* already gone — taskkill exits non-zero on an unknown pid */ }
    }
    try { unlinkSync(WINDOW_PID_PATH); } catch { /* fine */ }
  }
  try {
    // PowerShell and not bash: this is a Windows API call, and the project pays for that mix-up
    // often enough to have a dossier row about it (EXP-0043).
    // `CloseMainWindow` only POSTS WM_CLOSE, so the wait is not decoration — without it the process
    // is still alive (and still holding the browser profile directory) when we return.
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `$w = @(Get-Process msedge,chrome -ErrorAction SilentlyContinue | `
      + `Where-Object { $_.MainWindowTitle -like '*${titleLike}*' }); `
      + `$w | ForEach-Object { $_.CloseMainWindow() } | Out-Null; `
      + `$w | ForEach-Object { $_.WaitForExit(${waitMs}) } | Out-Null; `
      + '$w.Count',
    ], { encoding: 'utf8', windowsHide: true, timeout: waitMs + 6000 }).trim();
    if (Number(out) > 0) closed.push(`окна с «${titleLike}» в заголовке: ${out}`);
  } catch { /* nothing to close */ }
  return { closed };
}

/**
 * RAISE THE WINDOW — THE WHOLE STARTUP, IN THE ONE ORDER THAT CANNOT LEAVE A BROKEN DESKTOP.
 *
 * ⚠️ THE ORDER IS THE FIX, and it was paid for on 2026-08-16 by the owner («ты опять поднял в
 * сломанном состоянии»). The previous shape ran: `serve()` → close the old window → open a new one,
 * with the bind still in flight the whole time. On a port already held by a previous session's
 * server that sequence destroyed the operator's window, opened a fresh one pointed at the ORPHAN,
 * and only then died on an unhandled `EADDRINUSE`. Every single one of those steps succeeded from
 * the code's point of view; what was wrong was that the irreversible one ran BEFORE the one that
 * could fail. This is the same law R9a states for the watchdog's undo — **the net before the jump**.
 *
 * So: the port is taken FIRST, and the window is touched only once this process owns it.
 *
 * **Why an occupied port is TAKEN OVER rather than reused.** A server answering `/health` is
 * running the code it was started with, and this file changes. Reusing it would serve the operator
 * yesterday's page and yesterday's logic while the terminal reports success — a stale green, which
 * is the class this project spends most of its guards on. Killing it is the honest move, and it is
 * only ever done to a listener that has positively identified itself as ours.
 */
export async function raiseDashboard({
  port = DEFAULT_PORT,
  withWindow = true,
  log = console.log,
  closeWindowFn = closeWindow,
  openWindowFn = openWindow,
  probeFn = probeDashboard,
  findPidFn = findListenerPid,
  killFn = killPid,
  startFn = startServing,
  waitFreeFn = waitPortFree,
  waitViewerFn = waitForViewer,
} = {}) {
  let viewerSeen = null;
  let started = await startFn({ port });

  if (!started.ok && started.code === 'EADDRINUSE') {
    const probe = await probeFn(port);
    if (!probe.ours) {
      log(`ПОРТ:    ${port} занят, и это НЕ наш дашборд (${probe.why ?? 'ответ чужой формы'}).`);
      log('         Ничего не тронуто — ни окно, ни чужой процесс. Освободите порт или дайте --port N.');
      return { ok: false, why: 'порт занят чужим слушателем', windowTouched: false };
    }
    const pid = findPidFn(port);
    if (!pid) {
      log(`ПОРТ:    ${port} держит наш прежний дашборд, но его процесс не опознан — снимать вслепую не буду.`);
      log('         Ничего не тронуто. Закройте прежний процесс вручную и повторите.');
      return { ok: false, why: 'слушатель не опознан', windowTouched: false };
    }
    log(`ПОРТ:    ${port} держит дашборд прошлой сессии (pid ${pid}) — снимаю его: он крутит СТАРЫЙ код.`);
    killFn(pid);
    if (!(await waitFreeFn(port, { probeFn }))) {
      log(`ПОРТ:    ${port} так и не освободился. Ничего не тронуто.`);
      return { ok: false, why: 'порт не освободился', windowTouched: false };
    }
    started = await startFn({ port });
  }

  if (!started.ok) {
    log(`ДАШБОРД: не поднялся — ${started.code ?? started.why}. Окно не тронуто.`);
    return { ok: false, why: started.why ?? started.code, windowTouched: false };
  }

  log(`ДАШБОРД: ${started.url ?? `http://127.0.0.1:${port}/`}`);
  log('ЧТО ЭТО: окно наблюдения за прогоном. Оно только ЧИТАЕТ — ни карты, ни журнала, ни документа кривой');
  log(`         оно не касается. Источник — ${PULSE_PATH} (прибор, не запись).`);

  // THE OLD WINDOW GOES ONLY NOW — the owner's instruction while watching the first rehearsal
  // («старый браузер умей закрывать»). A second window on the same gauge is not a second view, it
  // is a stale one: whoever glances at the wrong one is reading a run that no longer exists.
  let windowTouched = false;
  if (withWindow) {
    const gone = closeWindowFn();
    windowTouched = true;
    if (gone.closed.length) log(`ОКНО:    закрыл прежнее (${gone.closed.join(', ')})`);
    const w = openWindowFn(started.url ?? `http://127.0.0.1:${port}/`);
    log(w.ok
      ? `ОКНО:    запросил отдельное окно ${w.browser ?? 'браузера по умолчанию'}. Если система открыла другим — так решила она.`
      : `ОКНО:    не открылось (${w.why}). Адрес выше — откройте вручную.`);

    // SPAWNING A BROWSER IS NOT A WINDOW ON SCREEN, and this command used to report the spawn as if
    // it were. `viewers` counts OPEN EVENT STREAMS, so it is the one observation that distinguishes
    // «окно есть» from «мы попросили». Without this the command answers «поднято» to an operator
    // looking at nothing — which is the state the owner named «ты опять поднял в сломанном
    // состоянии», and which a live sweep would then refuse to start against for a reason nobody
    // could see from the terminal.
    // The BOUND port, not the requested one — `port: 0` means «any free port», and asking the
    // gauge about port 0 would probe nothing at all.
    const livePort = started.s?.server?.address?.()?.port ?? port;
    const seen = await waitViewerFn(livePort, { probeFn });
    viewerSeen = seen;
    log(seen
      ? 'ОКНО:    подключилось — прибор его видит, прогон стартовать сможет.'
      : 'ОКНО:    НЕ ПОДКЛЮЧИЛОСЬ. Сервер поднят, зрителей ноль — прогон в таком виде стартовать ОТКАЖЕТСЯ.');
  }
  return { ok: true, s: started.s, url: started.url, windowTouched, viewerSeen };
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

  // — ПОСЛЕДНИЙ ВЫПОЛНЕННЫЙ ШАГ (слово владельца 2026-08-22). Считается из пройденного, а не из
  //   плана, поэтому и проверяется прогоном событий, а не чтением страницы.
  //   АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
  //     BG. брать шаг из плана (`zoneStepMv`) вместо разности        → «ШАГ — ЭТО ПРОЙДЕННОЕ»
  //     BH. считать шаг и через смену частоты                        → «СМЕНА ЧАСТОТЫ ОБНУЛЯЕТ СЧЁТ»
  //     BI. затирать напряжение до вычисления разности               → «ШАГ СЧИТАЕТСЯ ДО ЗАТИРАНИЯ»
  check('ШАГ НА ПЕРВОЙ СТУПЕНИ ЧАСТОТЫ РАВЕН ГЛУБИНЕ — спустились прямо от стока',
    afterStart.run.stepMv === 50, `шаг ${afterStart.run.stepMv}, глубина 50`);
  {
    // СВОЙ ПУЛЬС, а не общий: спуск по ступеням двигает номер записи, а ниже стоит блок, который
    // судит ИМЕННО номер («каждая запись двигает номер»). Проверка, ломающая соседнюю проверку
    // своим побочным действием, — это не проверка, а помеха.
    const stepPath = join(dir, 'live-step.json');
    clearPulse(stepPath);
    let ts = 0;
    const pulse = openPulse({
      path: stepPath, source: 'самопроверка шага', synthetic: true, band: '2842…2800 МГц',
      probeSeconds: 10, clockMs: () => (ts += 250), now: () => '2026-08-16T03:00:00+03:00',
    });
    const readPulseStep = () => readPulse(stepPath);
    pulse.event({ kind: 'rung-start', text: 'ступень', frequencyMhz: 2842, voltageMv: 995, depthMv: 50, seeded: false });
    pulse.event({ kind: 'rung-start', text: 'ступень', frequencyMhz: 2842, voltageMv: 970, depthMv: 75, seeded: false });
    const second = readPulseStep();
    check('ШАГ — ЭТО ПРОЙДЕННОЕ: расстояние до ПРЕДЫДУЩЕЙ ступени той же частоты',
      second.run.stepMv === 25, `995 → 970 должно дать 25, дало ${second.run.stepMv}`);
    check('ШАГ СЧИТАЕТСЯ ДО ЗАТИРАНИЯ — иначе вычитать не из чего, и напряжение уже новое',
      second.run.voltageMv === 970 && second.run.stepMv === 25,
      JSON.stringify({ v: second.run.voltageMv, step: second.run.stepMv }));

    pulse.event({ kind: 'rung-start', text: 'ступень', frequencyMhz: 2842, voltageMv: 965, depthMv: 80, seeded: false });
    check('МЕЛКИЙ ШАГ У КРАЯ ВИДЕН КАК ЕСТЬ — 5 мВ не округляются и не теряются',
      readPulseStep().run.stepMv === 5, `970 → 965 должно дать 5, дало ${readPulseStep().run.stepMv}`);

    // ГЛАВНОЕ: разность между ступенями РАЗНЫХ лестниц не значит ничего. Новая частота начинает
    // счёт заново — иначе первый шаг новой частоты показал бы расстояние до чужого спуска.
    pulse.event({ kind: 'rung-start', text: 'ступень', frequencyMhz: 2835, voltageMv: 1015, depthMv: 25, seeded: false });
    const moved = readPulseStep();
    check('СМЕНА ЧАСТОТЫ ОБНУЛЯЕТ СЧЁТ — шаг новой лестницы это её глубина, а не разность с чужой',
      moved.run.stepMv === 25, `965 → 1015 на новой частоте должно дать глубину 25, дало ${moved.run.stepMv}`);
  }

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

  // — `bugs/14`: ОКНО ОТКРЫВАЕТСЯ В СОСТОЯНИИ ТЕКУЩЕГО ПРОГОНА, а не прошлого.
  //   АДРЕСАТЫ МУТАЦИЙ: AE. отдавать возраст нулём → «ВОЗРАСТ ЗАПИСИ ЕДЕТ С НЕЙ» ·
  //   AF. на пустом приборе отдавать null вместо состояния → «ПУСТОЙ ПРИБОР — ЭТО „ПРОГОНА НЕТ“».
  const stampedMs = Date.parse(readPulse(path).at);
  const aged = pulseNow(path, stampedMs + 47_000);
  check('ВОЗРАСТ ЗАПИСИ ЕДЕТ ВМЕСТЕ С НЕЙ — иначе окно, открытое между прогонами, покажет прошлый как текущий',
    aged.ageMs === 47_000 && aged.noRun === false, `ageMs=${aged.ageMs}`);
  const fresh = pulseNow(path, stampedMs);
  check('и у свежей записи возраст ноль — прибавка не выдумывается',
    fresh.ageMs === 0, `ageMs=${fresh.ageMs}`);

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

  // THE EMPTY GAUGE, and it must be a STATE rather than an absence: a window with nothing to show
  // says «прогона нет», it does not paint the last thing it remembers and it does not raise an alarm.
  const empty = pulseNow(path);
  check('ПУСТОЙ ПРИБОР — ЭТО СОСТОЯНИЕ «ПРОГОНА НЕТ», а не тишина и не тревога',
    empty.noRun === true && empty.run.state === 'ПРОГОНА НЕТ' && empty.run.finished === false,
    JSON.stringify({ noRun: empty.noRun, state: empty.run.state }));

  // — `bugs/14`: ЗАВЕРШЁННЫЙ ПРОГОН ПЕРЕСТАЁТ БЫТЬ ТЕКУЩИМ. Владелец: «поднялось на ПРОГОН
  //   ОСТАНОВЛЕН - баг». Отсрочка есть, чтобы не отнять у смотрящего сам финал.
  //   АДРЕСАТЫ: AH. показывать финал вечно → «ЗАВЕРШЁННЫЙ ПРОГОН СТАРЕЕТ» ·
  //   AI. стирать финал сразу → «свежий финал ПОКАЗЫВАЕТСЯ».
  {
    const finBox = join('runs', 'dashboard-selftest-fin');
    const finPath = join(finBox, 'live.json');
    clearPulse(finPath);
    const fp = openPulse({ path: finPath, probeSeconds: 10, now: () => '2026-08-16T10:00:00+03:00' });
    fp.finish({ ok: true });
    const t0 = Date.parse('2026-08-16T10:00:00+03:00');
    const justFinished = pulseNow(finPath, t0 + 5_000);
    check('свежий финал ПОКАЗЫВАЕТСЯ — тот, кто ждал результата, обязан его увидеть',
      justFinished.noRun === false && justFinished.run.finished === true,
      JSON.stringify({ noRun: justFinished.noRun, state: justFinished.run.state }));
    const longFinished = pulseNow(finPath, t0 + 10 * 60_000);
    check('ЗАВЕРШЁННЫЙ ПРОГОН СТАРЕЕТ и перестаёт быть текущим — окно говорит «прогона нет»',
      longFinished.noRun === true && /последний/.test(longFinished.run.note),
      JSON.stringify({ noRun: longFinished.noRun, note: longFinished.run.note }));
    clearPulse(finPath);
  }

  // — `bugs/14`: ПОКАЗАНИЯ КАРТЫ ПРИХОДЯТ ОТ ОТДЕЛЬНОГО СЭМПЛЕРА. Владелец: «лсд дисплеи мертвые».
  //   АДРЕСАТ: AJ. принимать протухшую пробу за показание → «ПРОТУХШАЯ ПРОБА — НЕ ПОКАЗАНИЕ».
  {
    const tPath = join('runs', 'dashboard-selftest-telemetry.jsonl');
    const stamp = (iso, s) => writeFileSync(tPath, `${JSON.stringify({ at: iso, sample: s })}\n`, 'utf8');
    stamp(new Date().toISOString(), { 'clocks.gr': 2887, 'temperature.gpu': 63, 'fan.speed': 41, 'power.draw.instant': 212.5, 'utilization.gpu': 97 });
    const live = latestTelemetry(tPath);
    check('ПОКАЗАНИЯ КАРТЫ читаются у отдельного сэмплера — индикаторы больше не мертвы',
      live && live.clockMhz === 2887 && live.tempC === 63 && live.fanPct === 41 && live.powerW === 212.5 && live.underLoad === true,
      JSON.stringify(live));
    stamp(new Date(Date.now() - 120_000).toISOString(), { 'clocks.gr': 2887 });
    check('ПРОТУХШАЯ ПРОБА — НЕ ПОКАЗАНИЕ: старое число на индикаторе хуже пустого',
      latestTelemetry(tPath) === null, 'протухшая проба принята за живую');
    check('и отсутствие сэмплера — тоже не показание, а тишина',
      latestTelemetry(join('runs', 'нет-такого-файла.jsonl')) === null, 'придумало показание из ничего');
    try { rmSync(tPath, { force: true }); } catch { /* ok */ }
  }

  // — ПОДЪЁМ НА ЗАНЯТОМ ПОРТУ. Владелец, 2026-08-16: «ты опять поднял в сломанном состоянии».
  //   Порядок «необратимое ПОСЛЕ проверки» — единственное, что здесь проверяется, и он проверяется
  //   на НАСТОЯЩЕМ сокете: порт занимается живым сервером, а не заглушкой.
  //   АДРЕСАТЫ: AK. вернуть окно вперёд подъёма → «ОКНО НЕ ТРОГАЕТСЯ, ПОКА ПОРТ НЕ НАШ» ·
  //             AL. снять `server.on('error')` → «ЗАНЯТЫЙ ПОРТ — ОТВЕТ, А НЕ ТРАССИРОВКА» ·
  //             AM. считать любой ответ на порту нашим → «ЧУЖОЙ СЛУШАТЕЛЬ НЕ НАШ ДАШБОРД» ·
  //             AN. снимать процесс, не опознав его → «НЕОПОЗНАННЫЙ СЛУШАТЕЛЬ НЕ СНИМАЕТСЯ».
  {
    // A real, listening socket — a stub would prove the branch, not the bind.
    const busy = serve({ port: 0, pulsePath: join('runs', 'dashboard-selftest', 'live.json') });
    await new Promise((r) => { busy.server.once('listening', r); });
    const busyPort = busy.server.address().port;

    const taken = await startServing({ port: busyPort });
    check('ЗАНЯТЫЙ ПОРТ — ОТВЕТ, А НЕ ТРАССИРОВКА: подъём возвращает EADDRINUSE, а не падает',
      taken.ok === false && taken.code === 'EADDRINUSE',
      JSON.stringify({ ok: taken.ok, code: taken.code }));
    taken.s?.close();

    // The window seams as spies. The whole defect is that these ran BEFORE the port was known.
    let closes = 0; let opens = 0;
    const spyClose = () => { closes += 1; return { closed: [] }; };
    const spyOpen = () => { opens += 1; return { ok: true, browser: 'фальшивка' }; };
    const quiet = () => {};

    const foreign = await raiseDashboard({
      port: busyPort, log: quiet, closeWindowFn: spyClose, openWindowFn: spyOpen,
      probeFn: async () => ({ alive: true, ours: false, why: 'чужая форма ответа' }),
      findPidFn: () => 999999, killFn: () => true,
    });
    check('ЧУЖОЙ СЛУШАТЕЛЬ НЕ НАШ ДАШБОРД — порт занят кем-то ещё, команда отказывает',
      foreign.ok === false, JSON.stringify(foreign));
    check('ОКНО НЕ ТРОГАЕТСЯ, ПОКА ПОРТ НЕ НАШ — чужой слушатель не стоит окна оператора',
      closes === 0 && opens === 0 && foreign.windowTouched === false,
      JSON.stringify({ closes, opens, windowTouched: foreign.windowTouched }));

    let killed = 0;
    const unidentified = await raiseDashboard({
      port: busyPort, log: quiet, closeWindowFn: spyClose, openWindowFn: spyOpen,
      probeFn: async () => ({ alive: true, ours: true }),
      findPidFn: () => null, killFn: () => { killed += 1; return true; },
    });
    check('НЕОПОЗНАННЫЙ СЛУШАТЕЛЬ НЕ СНИМАЕТСЯ — вслепую не убиваем ничего',
      unidentified.ok === false && killed === 0 && closes === 0 && opens === 0,
      JSON.stringify({ ok: unidentified.ok, killed, closes, opens }));

    busy.close();
    await new Promise((r) => { setTimeout(r, 50); });

    // And the green half: a free port raises, and THEN the window is opened.
    const good = await raiseDashboard({
      port: 0, log: quiet, closeWindowFn: spyClose, openWindowFn: spyOpen, waitViewerFn: async () => true,
    });
    check('СВОБОДНЫЙ ПОРТ: сервер поднят, и ТОЛЬКО ПОСЛЕ ЭТОГО открыто окно',
      good.ok === true && closes === 1 && opens === 1,
      JSON.stringify({ ok: good.ok, closes, opens }));
    good.s?.close();

    // — СПАВН БРАУЗЕРА — НЕ ОКНО НА ЭКРАНЕ. Владелец получил зелёное сообщение и пустой экран.
    //   АДРЕСАТ: AP. докладывать успех, не спросив прибор → этот блок.
    const blind = await raiseDashboard({
      port: 0, log: quiet, closeWindowFn: spyClose, openWindowFn: spyOpen, waitViewerFn: async () => false,
    });
    check('ОКНО, КОТОРОЕ НЕ ПОДКЛЮЧИЛОСЬ, НАЗЫВАЕТСЯ ВСЛУХ — спавн браузера не выдаётся за окно',
      blind.viewerSeen === false,
      JSON.stringify({ viewerSeen: blind.viewerSeen }));
    blind.s?.close();

    // And the meter itself: a live server with nobody watching must say «нет зрителя», not hope.
    const lonely = serve({ port: 0, pulsePath: join('runs', 'dashboard-selftest', 'live.json') });
    await new Promise((r) => { lonely.server.once('listening', r); });
    const none = await waitForViewer(lonely.server.address().port, { tries: 2, everyMs: 50 });
    check('ПРИБОР ЗРИТЕЛЕЙ НЕ ВЫДУМЫВАЕТ: сервер жив, зрителей ноль — ответ «нет»',
      none === false, 'насчитал зрителя там, где окна нет');
    lonely.close();
  }

  // — СЕКУНДЫ СТРЕСС-ТЕСТА НА ЖИВОМ ПУТИ. Владелец: «циферки не тикают · 0,0 из 10 с». В файл их
  //   двигает тот, кто зовёт telemetry(), а живьём звать некому — развёртка заблокирована внутри
  //   прожига ровно эти секунды. Считает сервер, по возрасту записи.
  //   АДРЕСАТЫ: AU. вернуть выдачу числа из файла как есть → «СЕКУНДЫ ИДУТ БЕЗ ТИКОВ» ·
  //             AV. дать им расти выше объявленной длительности → «СЕКУНДЫ НЕ ПЕРЕРАСТАЮТ ПРОЖИГ».
  {
    const dir = join('runs', 'dashboard-selftest');
    const livePath = join(dir, 'live-elapsed.json');
    const g = openPulse({ path: livePath, source: 'ЖИВАЯ КАРТА', band: '2887…2820 МГц', probeSeconds: 10 });
    g.event({ kind: 'rung-start', text: 'ступень', frequencyMhz: 2887, voltageMv: 1045, depthMv: 25, seeded: false });
    const t0 = Date.parse(readPulse(livePath).at);

    const atOnce = pulseNow(livePath, t0);
    check('на живом пути секунды стартуют с нуля — до прожига считать нечего',
      atOnce.run.probe.elapsedSeconds === 0, JSON.stringify(atOnce.run.probe));

    const at4s = pulseNow(livePath, t0 + 4200);
    check('СЕКУНДЫ ИДУТ БЕЗ ТИКОВ: развёртка молчит внутри прожига, а плитка всё равно растёт',
      at4s.run.probe.elapsedSeconds === 4.2, JSON.stringify(at4s.run.probe));

    const at30s = pulseNow(livePath, t0 + 30_000);
    check('СЕКУНДЫ НЕ ПЕРЕРАСТАЮТ ПРОЖИГ: потолок — объявленная длительность, дальше говорит сторож молчания',
      at30s.run.probe.elapsedSeconds === 10, JSON.stringify(at30s.run.probe));

    // И СТЕНД НЕ ЛОМАЕТСЯ ЭТИМ: там прожиги ускорены вдесятеро, натикавшее больше настоящего
    // времени, и побеждать обязано натикавшее (EXP-0078).
    g.telemetry({ clockMhz: 2887, underLoad: true });
    g.telemetry({ clockMhz: 2887, underLoad: true });
    g.telemetry({ clockMhz: 2887, underLoad: true });
    const bench = pulseNow(livePath, Date.parse(readPulse(livePath).at) + 500);
    check('НА СТЕНДЕ ПОБЕЖДАЮТ ТИКИ, а не сжатое время — ускоренный прожиг показывает пройденное им',
      bench.run.probe.elapsedSeconds === 3, JSON.stringify(bench.run.probe));

    clearPulse(livePath);
  }

  // — ТЕЛЕМЕТРИЯ ОТВЕЧАЕТ НА СВОЁМ АДРЕСЕ, НЕЗАВИСИМО ОТ ХОДА ПРОГОНА. Слово владельца: «ни
  //   анимация, ни телеметрия карточки не должны замирать ни от каких тиков».
  //   АДРЕСАТ: AZ. убрать маршрут /telemetry → «ПОКАЗАНИЯ КАРТЫ ОТДАЮТСЯ ОТДЕЛЬНО ОТ ПУЛЬСА».
  {
    // ПЕСОЧНИЦА ПО ПОСТРОЕНИЮ, а не по уборке за собой. Здесь стоял БОЕВОЙ `TELEMETRY_PATH`: набор
    // затирал его своей строкой и возвращал из резервной копии. На простое это безобидно, но во
    // время живого прогона стёрло бы его улики — а батарея обещает «карту можно не освобождать».
    // Теперь путь передаётся швом, и трогать нечего (`bugs/27`, шов `telemetryPath`).
    const tPath = join('runs', 'dashboard-selftest', 'telemetry.jsonl');
    mkdirSync(dirname(tPath), { recursive: true });
    writeFileSync(tPath, `${JSON.stringify({
      at: new Date().toISOString(),
      sample: { 'clocks.gr': 2842, 'temperature.gpu': 64, 'fan.speed': 43, 'power.draw.instant': 233.5, 'utilization.gpu': 98 },
    })}\n`, 'utf8');

    const s = serve({ port: 0, pulsePath: join('runs', 'dashboard-selftest', 'live.json'), telemetryPath: tPath });
    await new Promise((r) => { s.server.once('listening', r); });
    const got = await new Promise((resolve) => {
      let raw = '';
      const req = httpRequest({ host: '127.0.0.1', port: s.server.address().port, path: '/telemetry', agent: false }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve(raw));
      });
      req.on('error', () => resolve(''));
      req.end();
    });
    let parsed = null;
    try { parsed = JSON.parse(got); } catch { parsed = null; }
    check('ПОКАЗАНИЯ КАРТЫ ОТДАЮТСЯ ОТДЕЛЬНО ОТ ПУЛЬСА — свой адрес, свой темп, ход прогона не участвует',
      parsed && parsed.clockMhz === 2842 && parsed.tempC === 64 && parsed.fanPct === 43 && parsed.powerW === 233.5,
      `ответ: ${got.slice(0, 160)}`);
    s.close();

    try { rmSync(tPath, { force: true }); } catch { /* ok */ }
  }

  // — ПРОСТАИВАЮЩИЙ ПОТОК ОБЯЗАН ПОДАВАТЬ ПРИЗНАКИ ЖИЗНИ. Между прогонами номер не меняется, и
  //   без сердцебиения поток молчит часами — 2026-08-16 такой поток обронили, и окно осталось на
  //   экране мёртвой картинкой при нуле зрителей.
  //   АДРЕСАТ: AQ. убрать сердцебиение → «ПОТОК БЕЗ НОВОСТЕЙ ВСЁ РАВНО ДЫШИТ».
  {
    const s = serve({ port: 0, pulsePath: join('runs', 'dashboard-selftest', 'live.json'), heartbeatMs: 60 });
    await new Promise((r) => { s.server.once('listening', r); });
    const got = await new Promise((resolve) => {
      let raw = '';
      const req = httpRequest({ host: '127.0.0.1', port: s.server.address().port, path: '/live', agent: false }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (c) => { raw += c; });
      });
      req.on('error', () => resolve(''));
      req.end();
      setTimeout(() => { req.destroy(); resolve(raw); }, 400);
    });
    check('ПОТОК БЕЗ НОВОСТЕЙ ВСЁ РАВНО ДЫШИТ — иначе простой неотличим от обрыва',
      /:\s*пульс/.test(got), `за 400 мс сердцебиения не пришло: ${JSON.stringify(got.slice(0, 120))}`);
    s.close();
  }

  // — 🔴 ЖИВОЕ ДОЕЗЖАЕТ ДО СТРАНИЦЫ, ДАЖЕ КОГДА РАЗВЁРТКА МОЛЧИТ — `bugs/27`.
  //   Рассылка была привязана к `seq`, а `seq` двигает ТОЛЬКО сама развёртка — единственный участник,
  //   который на все десять секунд прожига перестаёт говорить. Всё, что сервер добирает САМ (показания
  //   карты с отдельного сэмплера и секунды стресс-теста), в ворота не проходило: ключ был у занятого.
  //   Здесь развёртка не пишет НИ ОДНОЙ новой записи — файл прибора неподвижен, `seq` неподвижен, —
  //   и страница обязана всё равно получать кадры.
  //   АДРЕСАТ МУТАЦИИ: BA. вернуть `if (p.seq === lastSeq) return;` → этот блок.
  {
    const quietPath = join('runs', 'dashboard-selftest', 'live-quiet.json');
    mkdirSync(dirname(quietPath), { recursive: true });
    // Прогон ИДЁТ (не `finished`) и объявил длительность пробы — значит секунды считает сервер, и
    // они меняются САМИ, от одного лишь хода времени, без единой новой записи от развёртки.
    writeFileSync(quietPath, JSON.stringify({
      kind: 'kago-run-pulse', seq: 7, runMs: 1000, at: new Date().toISOString(), quietMs: 15_000,
      run: {
        source: 'самопроверка', band: '2842…2842 МГц', state: RUN_STATE.STRESS,
        frequencyMhz: 2842, voltageMv: 995, stockVoltageMv: 1045, depthMv: 50, seeded: false,
        probe: { elapsedSeconds: 0, totalSeconds: 10 },
        bandFromMhz: 2842, bandToMhz: 2842,
        coverage: { closed: 0, total: 1, rungs: 0 },
        verdicts: { 'edge-found': 0, 'lever-limited': 0 },
        lastEvent: '', note: '', finished: false, ok: null,
      },
      card: { clockMhz: 2842, voltageMv: 995, tempC: 61, fanPct: 44, powerW: 248, underLoad: true, synthetic: true, cappedByPowerLimit: false },
    }), 'utf8');

    const s = serve({ port: 0, pulsePath: quietPath, heartbeatMs: 60_000 });
    await new Promise((r) => { s.server.once('listening', r); });
    const raw = await new Promise((resolve) => {
      let acc = '';
      const req = httpRequest({ host: '127.0.0.1', port: s.server.address().port, path: '/live', agent: false }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (c) => { acc += c; });
      });
      req.on('error', () => resolve(''));
      req.end();
      setTimeout(() => { req.destroy(); resolve(acc); }, 900);
    });
    s.close();
    const frames = (raw.match(/^data: /gm) ?? []).length;
    const seqs = [...raw.matchAll(/"seq":(-?\d+)/g)].map((m) => m[1]);
    // ⚠️ СЧИТАТЬ КАДРЫ — НЕДОСТАТОЧНО, и это выяснила сама мутация BA: со старыми воротами кадра
    // всё равно ДВА (первый отдаёт обработчик подключения, второй проходит потому, что `lastSeq`
    // стартует с −1), поэтому «кадров ≥ 2» держалось и на дефекте. Полый блок в этом проекте уже
    // оплачен (`bugs/16`). Судим по тому, ради чего всё затевалось: РАСТУТ ЛИ ЧИСЛА НА ЭКРАНЕ.
    const secs = [...raw.matchAll(/"elapsedSeconds":([\d.]+)/g)].map((m) => Number(m[1]));
    const grew = secs.length >= 2 ? secs[secs.length - 1] - secs[0] : 0;
    check('ЖИВОЕ ДОЕЗЖАЕТ, ПОКА РАЗВЁРТКА МОЛЧИТ — прибор неподвижен, а числа на экране РАСТУТ',
      grew >= 0.4, `за 900 мс секунды выросли на ${grew} (кадров ${frames}, значения ${JSON.stringify(secs)})`);
    check('И ЭТО ТОТ ЖЕ ПРОГОН, А НЕ НОВЫЙ — номер не двигался ни разу',
      seqs.length > 0 && seqs.every((x) => x === '7'), `номера в кадрах: ${JSON.stringify(seqs)}`);
  }

  // — ОПОЗНАНИЕ ДАШБОРДА ИДЁТ ПО ЕГО СОБСТВЕННОМУ МАРШРУТУ, а не по факту «порт отвечает».
  //   АДРЕСАТ: AO. признать наш дашборд чужим (или наоборот) → этот блок.
  {
    const mine = serve({ port: 0, pulsePath: join('runs', 'dashboard-selftest', 'live.json') });
    await new Promise((r) => { mine.server.once('listening', r); });
    const seen = await probeDashboard(mine.server.address().port);
    check('НАШ ДАШБОРД ОПОЗНАЁТСЯ по /health — виден и счётчик зрителей, и путь прибора',
      seen.alive === true && seen.ours === true && typeof seen.pulsePath === 'string',
      JSON.stringify(seen));
    mine.close();

    const stranger = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"viewers":1}'); });
    await new Promise((r) => { stranger.listen(0, '127.0.0.1', r); });
    const other = await probeDashboard(stranger.address().port);
    check('ПОХОЖИЙ ОТВЕТ — ЕЩЁ НЕ НАШ: без пути прибора слушатель чужой',
      other.alive === true && other.ours === false, JSON.stringify(other));
    stranger.close();

    const nobody = await probeDashboard(1, { timeoutMs: 400 });
    check('МОЛЧАЩИЙ ПОРТ — это «никого нет», а не «наш»',
      nobody.alive === false && nobody.ours === false, JSON.stringify(nobody));
  }

  // — ЗВУК НА СТАРТЕ ПРОГОНА И ОДНА КНОПКА УПРАВЛЕНИЯ (слово владельца 2026-08-22).
  //
  //   Что здесь доказывается ЧЕСТНО: аргументы окна и содержимое СОБРАННОЙ страницы. Чего здесь
  //   НЕ доказывается: что из колонок пошёл звук — на это отвечает ухо владельца, и никакой офлайн
  //   блок такого вердикта не выдаёт. Блоки названы так, чтобы их нельзя было прочесть шире.
  //
  //   АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА (EXP-0016):
  //     BB. убрать `--autoplay-policy` из `windowArgs`                → блок «ФЛАГ АВТОЗАПУСКА»
  //     BC. вернуть в сборщик плоскую полосу `sndbar` вместо меню     → блок «ОДНА КНОПКА»
  //     BD. вынести органы звука наружу выпадения                     → блок «ОРГАНЫ ЖИВУТ ВНУТРИ»
  //     BE. стереть `fadeIn`/`running` из движка                      → блок «ДВИЖОК УМЕЕТ ПОДАЧУ»
  //     BF. поменять 20 секунд подачи на другое число                 → блок «ДВАДЦАТЬ СЕКУНД»
  {
    const args = windowArgs('http://127.0.0.1:7777/');
    check('ФЛАГ АВТОЗАПУСКА ЗВУКА УЕЗЖАЕТ В ОКНО — иначе «включено» на странице остаётся немым',
      args.includes('--autoplay-policy=no-user-gesture-required'), JSON.stringify(args));
    check('И ФЛАГ ДЕЙСТВУЕТ ТОЛЬКО НА НАШЕ ОКНО — свой профиль рядом в тех же аргументах',
      args.some((a) => a.startsWith('--user-data-dir=')), JSON.stringify(args));

    const pagePath = join('assets', 'dashboard', 'sweep.html');
    const page = existsSync(pagePath) ? readFileSync(pagePath, 'utf8') : '';
    check('СТРАНИЦА СОБРАНА — без неё следующие блоки судили бы пустоту',
      page.length > 1000, `${pagePath}: ${page.length} байт`);
    check('ОДНА КНОПКА В УГЛУ, А НЕ РОССЫПЬ ОРГАНОВ — плоской полосы на странице больше нет',
      page.includes('id="viz-btn"') && page.includes('id="viz-pop"') && !page.includes('class="sndbar"'),
      `viz-btn ${page.includes('id="viz-btn"')} · viz-pop ${page.includes('id="viz-pop"')} · sndbar ${page.includes('class="sndbar"')}`);
    {
      // Органы обязаны лежать ВНУТРИ выпадения: снаружи они снова полоса, просто с кнопкой рядом.
      // Границу берём по МЕТКЕ КОНЦА, а не по первому попавшемуся `</div>`: срез «от метки до
      // ближайшего закрытия» остался бы зелёным, даже если органы вынести наружу, — он резал бы
      // текст, а не элемент. Метку ставит сам сборщик.
      const from = page.indexOf('id="viz-pop"');
      const to = page.indexOf('<!-- /viz-pop -->');
      const inside = from > 0 && to > from ? page.slice(from, to) : '';
      check('ОРГАНЫ ЗВУКА ЖИВУТ ВНУТРИ ВЫПАДЕНИЯ — кнопка, темы, рабочие звуки и ход цикла',
        ['id="snd-btn"', 'id="snd-theme"', 'id="snd-work"', 'id="snd-move"'].every((id) => inside.includes(id)),
        `в выпадении ${inside.length} байт`);
      check('И У ВЫПАДЕНИЯ ЕСТЬ ЗАГОЛОВОК РАЗДЕЛА — меню задумано шире звука, «в частности, раздел звука»',
        inside.includes('vizsec'), 'нет заголовка секции');
    }
    // Спрашиваем ОПРЕДЕЛЕНИЕ в движке, а не упоминание: `fadeIn(` встречается и в проводке, поэтому
    // блок, ищущий подстроку, остался бы зелёным на движке, потерявшем метод.
    check('ДВИЖОК УМЕЕТ ПОДАЧУ И ОТЛИЧАЕТ «ВКЛЮЧЁН» ОТ «ЗВУЧИТ»',
      /fadeIn\(seconds\s*=/.test(page) && page.includes('get running()') && page.includes('resume()'),
      'в движке нет подачи или нет отдельного факта о звучании');
    check('ДВАДЦАТЬ СЕКУНД ПОДАЧИ — ровно то число, которое назвал владелец',
      /SND_FADE_SECONDS\s*=\s*20\b/.test(page) && page.includes('KagoSound.fadeIn(SND_FADE_SECONDS)'),
      'подача не названа числом 20 или не вызывается проводкой');

    // ─── ⏱ ЧАСЫ ПРОГОНА ТИКАЮТ В ТАКТ СТЕННЫМ (слово владельца 2026-08-23) ──────────────────────
    //
    // *«время прогона и локальное время не синхронно тикают. Было бы хорошо тики времени прогона
    // привязать к тикам локального времени»*. Часы обновлялись ТОЛЬКО при приходе кадра по SSE, а
    // сервер шлёт кадр лишь при изменении нагрузки: между прожигами часы стояли и потом прыгали.
    //
    // ⚠️ ЧТО ЭТИ БЛОКИ ДОКАЗЫВАЮТ, А ЧТО НЕТ — сказано прямо, чтобы зелёное не переоценили. Это
    // проверка ПРОВОДКИ по тексту собранной страницы: часы ведёт кадр, знающий вердикт `frozen`, и
    // приход пульса их больше НЕ пишет. Арифметика в браузере здесь не исполняется, поэтому
    // «тикает ровно раз в секунду» доказывается ГЛАЗОМ владельца на живой странице, а не отсюда.
    // Отрицательное утверждение — половина ценности блока: откат правки вернул бы запись в `paint`.
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   DE. вернуть запись часов в приход пульса     → «ПРИХОД ПУЛЬСА ЧАСЫ БОЛЬШЕ НЕ ПИШЕТ»
    //   DF. убрать вызов из кадра                    → «ЧАСЫ ПРОГОНА ВЕДЁТ КАДР»
    //   DG. тикать и при ЗАМЕРЛО                     → «ЗАМЕРШИЙ ПРОГОН ЧАСЫ НЕ КРУТИТ»
    //   DH. вернуть стенным часам свой `setInterval` → «ОБА ЦИФЕРБЛАТА ЩЁЛКАЮТ ОТ ОДНОГО ТИКА»
    //   DJ. писать часы прогона мимо тика секунды    → «ОБА ЦИФЕРБЛАТА ЩЁЛКАЮТ ОТ ОДНОГО ТИКА»
    // ⚠️ ВЫЗОВ, А НЕ УПОМИНАНИЕ. Первая редакция искала подстроку и осталась ЗЕЛЁНОЙ на мутации,
    // которая вызов ЗАКОММЕНТИРОВАЛА: `// renderRunClock({ frozen });` подстроке подходит. Тот же
    // класс, что уже назван строкой ниже про `fadeIn(`. Теперь требуется строка, начинающаяся с
    // вызова, — комментарий её не даёт.
    check('ЧАСЫ ПРОГОНА ВЕДЁТ КАДР, а не приход пульса — только так они идут в такт стенным',
      /function renderRunClock\(\{\s*frozen,\s*wallTicked\s*\}\)/.test(page)
        && /^\s*renderRunClock\(\{ frozen, wallTicked \}\);/m.test(page),
      'нет функции часов или её не зовёт кадр с вердиктом frozen и тиком секунды (вызов, а не упоминание)');
    // 🔴 ЗАКАЗ ВЛАДЕЛЬЦА БЫЛ ПРО МОМЕНТ, А НЕ ПРО СКОРОСТЬ, и первая правка это перепутала.
    //
    // «тики времени прогона привязать к тикам локального времени» — она сделала так, что часы
    // прогона ИДУТ с той же скоростью. Владелец посмотрел: «время прогона и локально ВСЁ ЕЩЁ тикает
    // вразнобой». Он был прав: темп совпал, а МОМЕНТ переворота цифры — нет. Часы прогона щёлкали в
    // фазе прихода пульса, стенные — в фазе своего `setInterval`, заданной загрузкой страницы.
    //
    // Замер это подтвердил ОТРИЦАТЕЛЬНО и тем сузил поиск: 65 кадров живой ленты, расхождение
    // `runMs` со стенными часами максимум 4 мс, немонотонных кадров ноль. Сервер был чист, значит
    // дело в странице — и оказалось, что в фазе, единственном, чего замер на сервере увидеть не мог.
    check('ОБА ЦИФЕРБЛАТА ЩЁЛКАЮТ ОТ ОДНОГО ТИКА — системной секунды, а не двух своих таймеров',
      /const wallTicked = Math\.floor\(Date\.now\(\) \/ 1000\) !== lastWallSec/.test(page)
        && /if \(wallTicked\) \{ lastWallSec = Math\.floor\(Date\.now\(\) \/ 1000\); wallClock\(\); \}/.test(page)
        && /if \(!wallTicked\) return;/.test(page)
        // ⚠️ ВЫЗОВ, А НЕ УПОМИНАНИЕ — и здесь это укусило сразу: страница НЕСЁТ комментарий
        // «Прежде здесь стоял `setInterval(wallClock, 1000)`», объясняющий, почему таймера больше
        // нет. Подстрочный запрет краснел на объяснении собственной правки. Тот же класс, что уже
        // назван двумя проверками выше; требуем строку, НАЧИНАЮЩУЮСЯ с вызова.
        && !/^\s*setInterval\(wallClock/mu.test(page),
      'стенные часы снова тикают своим setInterval, либо часы прогона пишутся мимо тика секунды');
    check('И СЧИТАЮТСЯ ОНИ ОТ ЛОКАЛЬНЫХ ЧАСОВ, привязанных к последнему пульсу',
      /shownRunMs\s*=\s*\(Number\(pulse\.runMs\)\s*\|\|\s*0\)\s*\+\s*\(performance\.now\(\)\s*-\s*pulseAt\)/.test(page),
      'часы не считаются от performance.now() с якорем на пульсе');
    check('ПРИХОД ПУЛЬСА ЧАСЫ БОЛЬШЕ НЕ ПИШЕТ — иначе они снова задёргаются рассылкой',
      !/\$\('c-elapsed'\)\.textContent\s*=\s*hms\(pulse\.runMs\)/.test(page),
      'в странице осталась прямая запись часов из пульса');
    check('ЗАМЕРШИЙ ПРОГОН ЧАСЫ НЕ КРУТИТ — секунда остановки остаётся на экране',
      /\}\s*else if \(!frozen\) \{/.test(page) && /finished === true\) \{[\s\S]{0,220}?shownRunMs = Number\(pulse\.runMs\)/.test(page),
      'нет ветки заморозки по frozen или по finished');

    // — ПОРЯДОК ПЛИТОК И ИХ СОДЕРЖИМОЕ (слово владельца 2026-08-22).
    //   АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //     BJ. вернуть плитку диапазона на прежнее место       → «ДИАПАЗОН — ВТОРАЯ ПЛИТКА»
    //     BK. вернуть строку «% пути»                         → «ПРОЦЕНТА ПУТИ НА СТРАНИЦЕ НЕТ»
    //     BL. убрать место под шаг из плитки напряжения       → «У НАПРЯЖЕНИЯ ЕСТЬ МЕСТО ПОД ШАГ»
    {
      const order = ['f-freq', 'f-band', 'f-volt', 'f-probe'].map((id) => page.indexOf(`id="${id}"`));
      check('ДИАПАЗОН — ВТОРАЯ ПЛИТКА СВЕРХУ, сразу за частотой под тестом',
        order.every((x) => x > 0) && order[0] < order[1] && order[1] < order[2] && order[2] < order[3],
        `положения f-freq/f-band/f-volt/f-probe: ${JSON.stringify(order)}`);
      check('ПРОЦЕНТА ПУТИ НА СТРАНИЦЕ НЕТ — доля считалась по оси частот, а прогон идёт по частотам',
        !page.includes('% пути'), 'строка «% пути» ещё на странице');
      check('НАСТРОЕНО ЧАСТОТ ОСТАЛОСЬ — счёт, а не оценка',
        page.includes('настроено частот'), 'счёт закрытых частот пропал вместе с процентом');
      check('У НАПРЯЖЕНИЯ ЕСТЬ МЕСТО ПОД ШАГ, и проводка его заполняет',
        page.includes('id="f-step"') && page.includes("$('f-step')"),
        'плитка напряжения не несёт шага или он никем не заполняется');
    }

    // — ЗАПИСАННАЯ ТЕМА (слово владельца 2026-08-22). Маршрут проверяется НАСТОЯЩИМ запросом:
    //   «сервер знает про файл» и «сервер его отдаёт» — разные утверждения, и стоит второе.
    //   АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //     BM. убрать маршрут /theme.mp3 с сервера            → «СЕРВЕР ОТДАЁТ ЗАПИСЬ»
    //     BN. поставить запись не первой в меню              → «ЗАПИСЬ — ПЕРВАЯ ТЕМА»
    //     BO. вернуть кнопке имя ВИЗУАЛИЗАТОР                → «КНОПКА НАЗЫВАЕТСЯ МЕНЮ»
    //     BP. сделать умолчанием синтезированную тему        → «УМОЛЧАНИЕ — ЗАПИСЬ»
    //     BQ. снять круг у записи                            → «ЗАПИСЬ ИДЁТ ПО КРУГУ»
    //     BR. вернуть смене темы медленный уход              → «СМЕНА ТЕМЫ МГНОВЕННА»
    {
      const optTrack = page.indexOf('value="3"');
      const optFirstSynth = page.indexOf('value="0"');
      check('ЗАПИСЬ — ПЕРВАЯ ТЕМА МЕНЮ, до всех синтезированных',
        optTrack > 0 && optFirstSynth > optTrack, `запись на ${optTrack}, «Маяк» на ${optFirstSynth}`);
      check('КНОПКА НАЗЫВАЕТСЯ МЕНЮ — прежнее имя со страницы ушло',
        page.includes('<span>МЕНЮ</span>') && !page.includes('<span>ВИЗУАЛИЗАТОР</span>'),
        'на кнопке не МЕНЮ либо старое имя ещё на странице');
      // ⚠️ УТВЕРЖДЕНИЕ ПЕРЕПИСАНО 2026-08-22 21:4x, И ВОТ ПОЧЕМУ — ОНО ТРЕБОВАЛО ОБРАТНО ДЕФЕКТ.
      //
      // Стояло: `/DEFAULT_THEME\s*=\s*3\b/` — то есть «умолчание названо ЧИСЛОМ». Починка умолчания
      // темы (2026-08-22 20:55) намеренно СХЛОПНУЛА эту пару: число перестало писаться второй раз и
      // спрашивается у самого звукового движка. Сторож после этого требовал вернуть дубль, ради
      // устранения которого правка и делалась.
      //
      // И он этого не показал, потому что судил УСТАРЕВШУЮ сборку страницы: батарея была зелёной,
      // пока `sweep.html` носил прежний литерал. Зелёный блок над несвежим артефактом — это не
      // проверка, а её имитация; сторож свежести сборки (`build-dashboard-page.mjs --check`) заведён
      // тем же вечером ровно против этого.
      //
      // Проверяется теперь НАМЕРЕНИЕ, а не изъятая форма: умолчание есть записанная тема, и оно
      // выведено из движка, а не продублировано числом. Оба плеча — на странице.
      check('УМОЛЧАНИЕ — ЗАПИСЬ, и оно ВЫВЕДЕНО у движка, а не продублировано числом',
        /DEFAULT_THEME\s*=\s*KagoSound\.trackIndex\b/.test(page)
        && /let\s+melIdx\s*=\s*TRACK_INDEX\b/.test(page)
        && !/DEFAULT_THEME\s*=\s*\d/.test(page),
        'умолчание темы не выведено из движка либо снова названо числом');
      check('ЗАПИСЬ ИДЁТ ПО КРУГУ — круг даёт сам элемент, без таймера склейки',
        /trackEl\.loop\s*=\s*true/.test(page), 'у записи не выставлен круг');
      check('СМЕНА ТЕМЫ МГНОВЕННА — предыдущая отдаёт очередь, а не доигрывает',
        page.includes('stopTheme({ instant: true })') && /trackEl\.pause\(\)/.test(page),
        'смена темы не глушит предыдущую сразу');

      const srv = serve({ port: 0, pulsePath: join('runs', 'dashboard-selftest', 'live.json') });
      await new Promise((r) => { srv.server.once('listening', r); });
      const got = await new Promise((resolve) => {
        const req = httpRequest({ host: '127.0.0.1', port: srv.server.address().port, path: '/theme.mp3', agent: false }, (res) => {
          let bytes = 0;
          res.on('data', (c) => { bytes += c.length; });
          res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], bytes }));
        });
        req.on('error', (e) => resolve({ status: 0, type: null, bytes: 0, why: e.message }));
        req.end();
      });
      srv.close();
      check('СЕРВЕР ОТДАЁТ ЗАПИСЬ по /theme.mp3 — и это проверено запросом, а не наличием файла',
        got.status === 200 && got.type === 'audio/mpeg' && got.bytes > 100000,
        JSON.stringify(got));
    }
  }

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

  // УБОРКА ЗА СОБОЙ — ОДНОЙ КОМАНДОЙ, И ОНА УБИРАЕТ ОБЕ ПОЛОВИНЫ. Прежде `--close` гасил только
  // окно и оставлял сервер жить на порту: следующий подъём натыкался на него, а владелец видел
  // процесс, которому нечего делать. Половинчатая уборка хуже отсутствующей — она создаёт
  // уверенность, что убрано.
  if (argv.includes('--close')) {
    const gone = closeWindow();
    console.log(gone.closed.length ? `ОКНО:   закрыто (${gone.closed.join(', ')})` : 'ОКНО:   закрывать было нечего');
    const port = Number(((i) => (i >= 0 && argv[i + 1] ? argv[i + 1] : DEFAULT_PORT))(argv.indexOf('--port')));
    const probe = await probeDashboard(port);
    if (!probe.alive) { console.log(`СЕРВЕР: на ${port} никого — гасить нечего`); return 0; }
    if (!probe.ours) { console.log(`СЕРВЕР: ${port} занят НЕ нашим дашбордом — не трогаю`); return 0; }
    const pid = findListenerPid(port);
    if (!pid) { console.log(`СЕРВЕР: наш дашборд на ${port} есть, но процесс не опознан — вслепую не снимаю`); return 1; }
    killPid(pid);
    console.log(await waitPortFree(port)
      ? `СЕРВЕР: снят (pid ${pid}), порт ${port} свободен`
      : `СЕРВЕР: pid ${pid} снят, но порт ${port} ещё занят — проверьте вручную`);
    return 0;
  }

  const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const port = Number(arg('port', DEFAULT_PORT));

  const raised = await raiseDashboard({ port, withWindow: !argv.includes('--no-window') });
  if (!raised.ok) return 1;
  const s = raised.s;
  console.log('         Ctrl+C — закрыть сервер И окно.');
  // A server that dies leaving its window up is the `bugs/04` shape: the picture stays on screen,
  // frozen, and looks exactly like the hang this instrument exists to report.
  // ЛЮБОЙ ВЫХОД, А НЕ ТОЛЬКО Ctrl+C. Прежде ловились лишь сигналы, поэтому жёсткое завершение
  // (`process.exit`, необработанное отклонение, закрытие терминала) оставляло на рабочем столе
  // владельца ОКНО БРАУЗЕРА, которому нечего показывать: сервер мёртв, картинка застыла — форма
  // `bugs/04` и ровно тот мусор, на который он указал («какие-то терминалы открытыми в ОС остаются
  // после тебя»). `exit` синхронен, а `closeWindow` синхронен по построению — значит он успевает.
  process.on('exit', () => { try { closeWindow(); } catch { /* уже закрыто */ } });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { closeWindow(); s.close(); process.exit(0); });
  }
  return new Promise(() => {});
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
