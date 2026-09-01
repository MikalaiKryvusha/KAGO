#!/usr/bin/env node
// driver-voice.mjs — ГОЛОС ДРАЙВЕРА: правило, по которому серия ошибок `nvlddmkm` прекращает
// ступень. Эпик 73 фаза 3 (`plans/79`), тикет `bugs/79`, разведка `researches/30`.
//
// ─── ЧТО ЭТОТ МОДУЛЬ ЕСТЬ И ЧЕГО В НЁМ НЕТ ──────────────────────────────────────────────────────
//
// Здесь живёт ОДНО решающее правило и ничего кроме него: ни чтения журнала, ни часов, ни карты, ни
// процессов. Потребителей у правила ДВА, и это главная причина, по которой оно вынесено в отдельный
// модуль, а не написано по месту:
//
//   ярус 1 — движок на границе ступени (`runRung` уже получает раздел сигналов от `event-logger`);
//   ярус 2 — наблюдатель в реальном времени, кормящий предохранитель (движок во время прожига
//            МЁРТВ: прожиг зовётся через `spawnSync`, цикл событий заблокирован).
//
// Два потребителя, считающие порог каждый у себя, — это два порога, которые разойдутся молча.
// Урок оплачен ([[EXP-0193]]): доказанный судья плюс недоказанная проводка — недоказанные ворота,
// и отказывает такая конструкция в сторону СТЕНЫ, а не дыры.
//
// ─── ПОЧЕМУ РЕАКЦИЯ — СТУПЕНЬ, А НЕ ПОЛОСА ──────────────────────────────────────────────────────
//
// Замер архива (`researches/30` §2, 179 событий за 41 день, 21 вспышка):
//
//   одиночное событие         → замирания не было НИ РАЗУ (0 из 9)
//   вспышка из 2+ событий     → шесть смертельных из шести пойманы (полнота 6/6)
//   но и шесть БЕЗОБИДНЫХ вспышек несли 2+ события (точность 6/12)
//
// Поэтому «серия останавливает ПОЛОСУ» дало бы две ложные остановки за семь дней прогонов, что
// нарушает и критерий тикета, и границу владельца («сторож должен не ронять инструмент, а
// подсказывать»). «Серия прекращает СТУПЕНЬ и идёт в накопитель `bugs/80`» даёт ту же полноту при
// НУЛЕ ложных остановок: две ложные вспышки 08-22 дают два счёта при пороге накопителя три.
//
// GPU WRITES: NONE. Модуль ничего не запускает и ничего не пишет.
//
// Usage:
//   node automation-engine/lib/driver-voice.mjs --selftest
//   node automation-engine/lib/driver-voice.mjs --archive   разбор снятого архива вспышек
//
// [NOT-TESTED] на момент рождения; маркеры по функциям ниже.

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Рука 1 — та же, что у предохранителя, а не своя копия: две руки, убивающие прожиг по именам,
// разошлись бы молча при первой правке списка образов (DRY, и это не косметика — это писатель).
// Импорт безопасен: у `fuse.mjs` есть сторож главного модуля, при импорте он ничего не запускает.
import { makeImageKillHand } from './fuse.mjs';

// =================================================================================================
// 1. Порог — форма из отрасли, числа из своего замера
// =================================================================================================

/**
 * ПОРОГ ГОЛОСА ДРАЙВЕРА.
 *
 * @fork driver-voice-threshold
 * OPTIONS:  A — ничего (сегодня) · B — одно событие останавливает полосу · C — серия останавливает
 *           полосу · D — серия прекращает СТУПЕНЬ и идёт в накопитель · E — порог Microsoft (5 за 60 с)
 * COST:     ложная остановка стоит вечера владельца; пропущенная серия стоила машины 30.08
 * RECON:    researches/30 — отраслевая половина (Windows решает тот же вопрос счётом в скользящем
 *           окне: TdrLimitCount=5 / TdrLimitTime=60 с; CoreCycler даёт каналу ошибок ОС голос на
 *           уровне ПРОВЕРЯЕМОЙ ЕДИНИЦЫ, а не прогона) + пересчёт своего архива на 179 событиях
 * DECIDED:  D. Форма — счёт в скользящем окне, взята у Microsoft. ЧИСЛА — свои: порог Microsoft
 *           (5 за 60 с) НЕ сработал бы 30.08, там было три события за пять секунд. Взято 2 события
 *           за 120 с: два — нижняя граница, отделяющая девять безобидных одиночек архива от шести
 *           смертельных серий; 120 с — та же величина, которой архив разбит на вспышки
 */
export const DRIVER_VOICE = Object.freeze({ windowMs: 120_000, minCount: 2 });

/**
 * Момент события в миллисекундах — ОДНА функция для обоих ярусов.
 *
 * Ярусы получают события из разных источников и в разной форме: `event-logger` отдаёт разобранные
 * события журнала с полем `timeCreated`, наблюдатель реального времени — свои строки с `at`. Разбор
 * времени в двух местах — это две линейки, и расходятся они молча.
 *
 * Нечитаемое время возвращает `null` и НЕ считается за событие: догадка о времени в стороже, который
 * прекращает работу владельца, хуже пропуска.
 *
 * [NOT-TESTED]
 */
export function momentOf(event) {
  const raw = event?.atMs ?? event?.at ?? event?.timeCreated ?? null;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const ms = new Date(String(raw)).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * РЕШЕНИЕ ГОЛОСА: набралась ли в каком-нибудь окне серия.
 *
 * Скользящее окно, а не «за всё время» и не «за последние N событий»: накопление без срока рано или
 * поздно наберёт порог на любой машине, а окно спрашивает ровно то, что нас интересует — участились
 * ли жалобы ПРЯМО СЕЙЧАС. Это форма, которой Windows решает тот же вопрос про сбросы драйвера.
 *
 * Окно ЗАКРЫТОЕ с обеих сторон (`<=`): два события, отстоящие ровно на `windowMs`, — уже серия.
 * Граница выбрана в сторону срабатывания и закреплена блоком, потому что молчаливое расхождение
 * двух ярусов на границе было бы парой «истина ↔ зеркало», которую никто не заметит.
 *
 * @param {Array<object>} events события ЛЮБОГО идентификатора этого провайдера — id 14 и 13 в
 *   системе не описаны (поле сообщения пусто), и решение намеренно от различия id не зависит
 * @param {{windowMs:number, minCount:number}} [limits]
 * @returns {{stop:boolean, count:number, windowFromIso:string|null, windowToIso:string|null,
 *            unreadable:number, why:string|null}}
 *
 * [NOT-TESTED]
 */
export function driverVoiceVerdict(events, limits = DRIVER_VOICE) {
  const list = Array.isArray(events) ? events : [];
  const unreadable = list.filter((e) => momentOf(e) === null).length;
  const moments = list.map(momentOf).filter((m) => m !== null).sort((a, b) => a - b);

  let best = { count: moments.length ? 1 : 0, from: moments[0] ?? null, to: moments[0] ?? null };
  for (let i = 0; i < moments.length; i += 1) {
    let j = i;
    while (j + 1 < moments.length && moments[j + 1] - moments[i] <= limits.windowMs) j += 1;
    const count = j - i + 1;
    if (count > best.count) best = { count, from: moments[i], to: moments[j] };
  }

  const stop = best.count >= limits.minCount;
  const iso = (ms) => (ms === null ? null : new Date(ms).toISOString());
  return {
    stop,
    count: best.count,
    windowFromIso: iso(best.from),
    windowToIso: iso(best.to),
    unreadable,
    why: stop
      ? `КАНАЛ ДРАЙВЕРА: ${best.count} ошибок(и) nvlddmkm за ${Math.round((best.to - best.from) / 1000)} с `
        + `при пороге ${limits.minCount} в окне ${limits.windowMs / 1000} с. По архиву проекта одиночная `
        + 'ошибка не предшествовала замиранию машины ни разу из девяти, а серия предшествовала шесть '
        + 'раз из шести. Ступень прекращена, точка возвращена на доказанную землю (bugs/79)'
      : null,
  };
}

// =================================================================================================
// 1a. Живой шов яруса 1 — окно ступени в журнале Windows
// =================================================================================================

/**
 * События канала драйвера за окно ступени. Это ЖИВОЙ шов для `runRung.driverEventsFn`.
 *
 * СПРАШИВАЕТ ТОЛЬКО СВОЙ ПРОВАЙДЕР, а не все пять: провайдеры класса `CRASH` уже опрашивает
 * оракул через `stress-tester`, и второй их опрос был бы вторым мнением о том же — парой
 * «правда ↔ зеркало», которая молча разойдётся. Здесь нужен ровно пятый вход.
 *
 * ⚠️ НЕЗАВИСИМ ОТ НАБЛЮДАТЕЛЯ РЕАЛЬНОГО ВРЕМЕНИ НАМЕРЕННО. Читать выхлоп наблюдателя было бы
 * дешевле на один порождённый процесс за ступень (~1 с на 30-секундной ступени), но тогда смерть
 * наблюдателя убивала бы ОБА яруса разом — а второй ярус для того и существует, что первый может
 * не запуститься.
 *
 * 🔴 НЕ ПРОЧИТАЛИ — НЕ ЗНАЧИТ «ЧИСТО», И ДО 2026-09-01 ЭТОТ ШОВ ГОВОРИЛ ОБРАТНОЕ (`bugs/96`).
 * Здесь стояло `return []` на упавшем запросе и на молчащем ответе одинаково, то есть отказ
 * запроса к Windows приходил к читателю как «событий нет». Прежний текст этого места УЖЕ ОБЕЩАЛ
 * различие («поднимает `unreadable`») — обещал документ, а не код; пара «правда↔зеркало» внутри
 * одной функции. Теперь различие в ТИПЕ ответа, который читатель не может проигнорировать:
 *
 *   `Array` — прочитали, и вот сколько (ноль — законный ответ «чисто»);
 *   `null`  — ПРОЧИТАТЬ НЕ УДАЛОСЬ, и «ноль» тут произносить некому.
 *
 * Оба читателя уже готовы к `null` и молчат на нём (`runRung` кладёт `driverCries = null`,
 * `driverVoiceVerdict(null)` не срабатывает) — правило R4b: прибор без данных молчит, но его
 * молчание НАЗЫВАЕТСЯ, а не выдаётся за наблюдение. Это то же правило, которым `event-logger`
 * отказывается говорить «сбоев нет» над упавшим запросом (`verdictFor` → `status === 'error'`).
 *
 * [TESTED: 2026-09-01 · три состояния шва прогнаны блоками `driver-voice --selftest` на
 * подставленном `queryFn` — ответ с событиями, молчащий ответ, отказ провайдера и бросок; мутация
 * «вернуть [] вместо null» краснит свой блок]
 */
export function driverEventsInWindow({ fromMs, toMs }, queryFn) {
  const rule = { provider: 'nvlddmkm', ids: [] };
  try {
    const res = queryFn({ from: new Date(fromMs), to: new Date(toMs), providers: [{ ...rule, means: 'SIGNAL' }] });
    // ОТКАЗ ИМЕННО НАШЕГО ПРОВАЙДЕРА — это «не прочитали», а не «пусто». Статус приходит от
    // `queryFaults` по каждому провайдеру отдельно (`ok` / `no-events` / `error`), и читать его
    // обязан тот, кто собирается произнести число.
    const mine = (res?.providers ?? []).find((p) => p?.provider === rule.provider);
    // ⚠️ ОТВЕТ, В КОТОРОМ НАШЕГО ПРОВАЙДЕРА НЕТ ВОВСЕ, — ТОЖЕ «НЕ ПРОЧИТАЛИ», И ЭТО НЕ
    // ПРЕДОСТОРОЖНОСТЬ, А НАЙДЕННЫЙ СЛУЧАЙ. 2026-09-01 моя собственная проба спросила журнал про
    // ДРУГОЙ провайдер, а шов вернул пустой список — то есть ответ про кого-то другого прочитался
    // как «в нашем канале чисто». Спрашивали про `nvlddmkm`; ответ, который о нём не упоминает,
    // ответом о нём не является.
    //
    // ЗАМЕРЕНО ПЕРЕД ЗАКРУЧИВАНИЕМ (иначе это был бы сторож, краснеющий на нормальной работе, —
    // ловушка, в которую уже падала первая редакция R13): живой ответ `queryFaults` по этому
    // правилу несёт `{"provider":"nvlddmkm","status":"ok","count":24}`, то есть запись о нашем
    // провайдере есть ВСЕГДА, а отсутствующий провайдер получает `status: "error"`.
    if (!mine || mine.status === 'error') return null;
    if (!Array.isArray(res?.events)) return null;
    return res.events.filter((e) => e.provider === rule.provider);
  } catch {
    return null;
  }
}

// =================================================================================================
// 1b. ЯРУС 2 — наблюдатель реального времени, прекращающий СТУПЕНЬ
// =================================================================================================

/**
 * Разбор одной строки наблюдателя. Чистая функция — доказуема без процессов.
 *
 * Четыре рода строк, и «не разобрана» — ПЯТЫЙ род, а не молчание: строка, которую наблюдатель
 * напечатал, а мы не поняли, обязана быть видна в разборе, иначе изменившийся формат тихо
 * превратит канал в пустой.
 *
 * [NOT-TESTED]
 */
export function parseWatchLine(line) {
  const s = String(line ?? '').trim();
  if (s.startsWith('EVENT ')) {
    try { return { kind: 'event', event: JSON.parse(s.slice(6)) }; } catch { return { kind: 'unparsed', raw: s }; }
  }
  if (s.startsWith('ALIVE ')) return { kind: 'alive', at: s.slice(6) };
  if (s.startsWith('READY ')) return { kind: 'ready', detail: s.slice(6) };
  if (s.startsWith('FAILED ')) return { kind: 'failed', detail: s.slice(7) };
  if (s === '') return { kind: 'blank' };
  return { kind: 'unparsed', raw: s };
}

/**
 * СОСТОЯНИЕ НАБЛЮДАТЕЛЯ — чистое, чтобы правило «сработать один раз на вспышку» было доказуемо
 * без процессов, портов и часов.
 *
 * ПОЧЕМУ СБРОС ПОСЛЕ СРАБАТЫВАНИЯ. Прожиг убит, ступень кончилась; следующая ступень — новое
 * наблюдение. Без сброса вспышка из сорока трёх событий (такие в архиве есть: 08-14 и 08-28)
 * убивала бы каждый следующий прожиг подряд, то есть один отказ машины превращался бы в
 * бесконечный отказ инструмента — ровно то, что владелец запретил словом «сторож должен не
 * ронять инструмент».
 *
 * [NOT-TESTED]
 */
export function makeVoiceState(limits = DRIVER_VOICE) {
  let cries = [];
  return {
    /** @returns {{fire:boolean, why:string|null, count:number}} */
    saw(event, nowMs) {
      cries.push({ atMs: nowMs });
      // Окно скользит: всё, что старше окна, к решению отношения не имеет и только растит память.
      cries = cries.filter((c) => nowMs - c.atMs <= limits.windowMs);
      const v = driverVoiceVerdict(cries, limits);
      if (!v.stop) return { fire: false, why: null, count: cries.length };
      const count = cries.length;
      cries = [];
      return { fire: true, why: v.why, count };
    },
    pending() { return cries.length; },
  };
}

// =================================================================================================
// 2. Разбор снятого архива — тем же правилом, которым судит прогон
// =================================================================================================

/**
 * Разбить поток событий на вспышки тем же разрывом, которым разбит архив в `researches/30` §2.
 * Нужен только разбору архива и блокам: прогон судит окно ступени целиком.
 *
 * [NOT-TESTED]
 */
export function burstsOf(events, gapMs = DRIVER_VOICE.windowMs) {
  const moments = (Array.isArray(events) ? events : []).map((e) => ({ e, ms: momentOf(e) }))
    .filter((x) => x.ms !== null).sort((a, b) => a.ms - b.ms);
  const out = [];
  for (const { e, ms } of moments) {
    const last = out[out.length - 1];
    if (!last || ms - last.endMs > gapMs) out.push({ startMs: ms, endMs: ms, events: [e] });
    else { last.endMs = ms; last.events.push(e); }
  }
  return out;
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_EVENTS = 'benches/fixtures/driver-voice/nvlddmkm-20260720-20260830.jsonl';
const FIXTURE_FREEZES = 'benches/fixtures/driver-voice/machine-freezes-20260729-20260830.jsonl';

/** Прочитать снятую фикстуру. Путь — от рабочего каталога: мутантов гоняют из корня ([[EXP-0193]]). */
export function readJsonl(path) {
  return readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

/**
 * Была ли вспышка ПОСЛЕДНИМ, что машина записала перед замиранием. Сверяется с отдельной снятой
 * фикстурой моментов замирания, а не с `Kernel-Power/41`: тот штампуется при следующей загрузке и
 * несёт время перезагрузки, то есть время реакции ЧЕЛОВЕКА (`researches/30` §0).
 *
 * [NOT-TESTED]
 */
export function burstIsTerminal(burst, freezes) {
  return freezes.some((f) => {
    const ms = new Date(f.lastBreathAt).getTime();
    return f.lastBreathProvider === 'nvlddmkm' && Math.abs(ms - burst.endMs) < 1000;
  });
}

// =================================================================================================
// 2b. Наблюдатель как процесс — тонкая обвязка над чистыми функциями выше
// =================================================================================================

/**
 * @guard driver-voice-watch
 * THREAT:         серия ошибок драйвера во время ступени, на которую никто не успевает ответить:
 *                 30.08 движок был заблокирован `spawnSync` прожига и не мог сделать НИЧЕГО до
 *                 конца ступени, а машина умерла внутри неё
 * PROVED-AGAINST: правило и его сброс — блоки `driver-voice --selftest` (включая счёт по СНЯТОМУ
 *                 архиву 179 событий); задержка доставки — замер `--bench-latency` на живом
 *                 `EventLogWatcher`, канал «Windows PowerShell», событие подкладывается запуском
 *                 процесса и время меряется от запуска до решения
 * GAP:            🔴 замер задержки снят на ДРУГОМ провайдере: канал `nvlddmkm` невозможно вызвать
 *                 по требованию, не сломав карту. Доказана дорога доставки, а НЕ то, что драйвер
 *                 пишет в журнал сразу. Второе: рука здесь ОДНА — убить прожиг; возврат напряжения
 *                 делает откат самой ступени, который отрабатывает, как только `spawnSync` вернул
 *                 управление. Если движок уже замер, не отработает ни то, ни другое — и на
 *                 инциденте 30.08 окно было 0,134 с, то есть не отработало бы (`researches/30` §3)
 * ON-REAL-PATH:   NOT YET — включается флагом `--driver-voice-watch` и по умолчанию ВЫКЛЮЧЕН;
 *                 первый живой прогон с флагом обязан оставить строку `READY` в журнале наблюдателя
 *
 * @forensic driver-voice-watch-journal
 * EXPLAINS:    что канал драйвера говорил во время прогона и что по этому поводу было сделано
 * DURABLE-AT:  every-line — `fsync` на каждой строке, включая секундную строку жизни: молчание
 *              канала обязано отличаться от смерти наблюдателя (`bugs/83`), а улика — переживать
 *              событие, а не штатный конец (`bugs/78`)
 */
export function watchLoop({ spawnFn, killImages, images, writeLine, nowFn = () => Date.now(), onReady = null }) {
  const state = makeVoiceState();
  const script = new URL('driver-voice-watch.ps1', import.meta.url);
  const child = spawnFn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(script)],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });

  let carry = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    carry += chunk;
    const lines = carry.split(/\r?\n/);
    carry = lines.pop() ?? '';
    for (const raw of lines) {
      const p = parseWatchLine(raw);
      if (p.kind === 'blank') continue;
      if (p.kind === 'ready') { writeLine({ kind: 'ready', detail: p.detail }); onReady?.(p); continue; }
      if (p.kind === 'failed') { writeLine({ kind: 'failed', detail: p.detail }); continue; }
      if (p.kind === 'alive') { writeLine({ kind: 'alive', at: p.at }); continue; }
      if (p.kind === 'unparsed') { writeLine({ kind: 'unparsed', raw: p.raw }); continue; }
      const now = nowFn();
      const d = state.saw(p.event, now);
      writeLine({ kind: 'event', event: p.event, pending: d.count, fired: d.fire });
      if (d.fire) {
        const killed = killImages(images);
        // РУКА ЗДЕСЬ ОДНА — УБИТЬ ПРОЖИГ, и это решение, а не упущение. Напряжение возвращает откат
        // самой ступени, который отрабатывает сразу, как только `spawnSync` вернул управление; второй
        // возвращающий был бы вторым писателем в карту при живом первом (R1 — писатель один).
        writeLine({ kind: 'fired', why: d.why, count: d.count, killed: killed.detail, killOk: killed.ok, ms: killed.ms });
      }
    }
  });
  return child;
}

// =================================================================================================
// 3. CLI
// =================================================================================================

/** Строка журнала наблюдателя — `fsync` на каждой, тем же приёмом, что у сэмплера (`bugs/37`). */
function makeJournalWriter(path) {
  mkdirSync(dirname(path), { recursive: true });
  return (record) => {
    const fd = openSync(path, 'a');
    try {
      writeSync(fd, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
      fsyncSync(fd);
    } finally { closeSync(fd); }
  };
}

/** Живой наблюдатель: процесс, который прекращает СТУПЕНЬ, убивая прожиг. */
async function watch(argv) {
  const images = (argv.find((a) => a.startsWith('--burn-images='))?.split('=')[1]
    ?? 'furnace.exe,branchy.exe,sdc_fma.exe').split(',').filter(Boolean);
  const out = argv.find((a) => a.startsWith('--out='))?.split('=')[1]
    ?? join('runs', 'death-watch', `${new Date().toISOString().replace(/[:.]/gu, '-')}-drivervoice.jsonl`);
  const write = makeJournalWriter(out);
  const kill = makeImageKillHand({ spawnSyncFn: spawnSync });
  console.log(`ГОЛОС ДРАЙВЕРА: наблюдатель поднят · журнал ${out} · руки: ${images.join(',')} · `
    + `порог ${DRIVER_VOICE.minCount} события за ${DRIVER_VOICE.windowMs / 1000} с`);
  const child = watchLoop({ spawnFn: spawn, killImages: kill, images, writeLine: write });
  await new Promise((resolve) => child.once('exit', resolve));
  console.log('ГОЛОС ДРАЙВЕРА: наблюдатель завершился');
}

/**
 * ЗАМЕР ЗАДЕРЖКИ ДОСТАВКИ — единственный честный способ получить число для P79-AC1.
 *
 * Канал `nvlddmkm` по требованию не вызвать, не сломав карту. Поэтому та же дорога
 * (`EventLogWatcher` → строка → правило → решение) меряется на канале, который вызывается
 * непривилегированно: журнал «Windows PowerShell» получает событие на КАЖДЫЙ запуск движка
 * PowerShell. Часы — наши, от момента запуска процесса до момента решения.
 */
async function benchLatency() {
  const script = fileURLToPath(new URL('driver-voice-watch.ps1', import.meta.url));
  const child = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, 'PowerShell', 'Windows PowerShell'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const state = makeVoiceState();
  let ready = false;
  let firedAtMs = null;
  let seen = 0;
  let carry = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    carry += c;
    const lines = carry.split(/\r?\n/); carry = lines.pop() ?? '';
    for (const raw of lines) {
      const p = parseWatchLine(raw);
      if (p.kind === 'ready') { ready = true; console.log(`  наблюдатель готов: ${p.detail}`); }
      if (p.kind === 'failed') console.log(`  ❌ ПЛОХО  наблюдатель не поднялся: ${p.detail}`);
      if (p.kind === 'event') {
        seen += 1;
        const d = state.saw(p.event, Date.now());
        if (d.fire && firedAtMs === null) firedAtMs = Date.now();
      }
    }
  });
  const waitFor = async (cond, ms) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 25));
    return cond();
  };
  if (!await waitFor(() => ready, 20_000)) { console.log('❌ ПЛОХО  наблюдатель не поднялся за 20 с'); child.kill(); return 1; }
  // Пауза после READY: подписка уже принята, но дадим каналу устояться, чтобы в замер не попали
  // события, порождённые самим наблюдателем.
  await new Promise((r) => setTimeout(r, 1500));
  const t0 = Date.now();
  for (let i = 0; i < DRIVER_VOICE.minCount; i += 1) {
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'exit'], { windowsHide: true, timeout: 20_000 });
  }
  const got = await waitFor(() => firedAtMs !== null, 20_000);
  child.kill();
  if (!got) { console.log(`❌ ПЛОХО  решение не принято за 20 с (событий получено ${seen})`); return 1; }
  const ms = firedAtMs - t0;
  console.log(`ЗАМЕР ЗАДЕРЖКИ: от подложенных событий до РЕШЕНИЯ ${ms} мс (событий получено ${seen}); порог P79-AC1 — 5000 мс`);
  console.log(ms <= 5000 ? '✅  P79-AC1 ВЗЯТ на живой дороге доставки' : '❌ ПЛОХО  порог не взят');
  return ms <= 5000 ? 0 : 1;
}

function archive() {
  const events = readJsonl(FIXTURE_EVENTS);
  const freezes = readJsonl(FIXTURE_FREEZES);
  const bursts = burstsOf(events);
  console.log(`АРХИВ: событий ${events.length} · вспышек ${bursts.length} · нештатных выключений ${freezes.length}`);
  let fires = 0; let terminal = 0; let firedTerminal = 0; let singles = 0; let firedSingles = 0;
  for (const b of bursts) {
    const v = driverVoiceVerdict(b.events);
    const t = burstIsTerminal(b, freezes);
    if (v.stop) fires += 1;
    if (t) terminal += 1;
    if (t && v.stop) firedTerminal += 1;
    if (b.events.length === 1) { singles += 1; if (v.stop) firedSingles += 1; }
    console.log(`${new Date(b.startMs).toISOString().slice(0, 19)} · событий ${String(b.events.length).padStart(2)} · `
      + `${v.stop ? 'СРАБАТЫВАЕТ' : 'молчит     '} · ${t ? 'ЗАМИРАНИЕ сразу после' : '—'}`);
  }
  console.log(`ИТОГ: срабатываний ${fires} · смертельных вспышек ${terminal}, из них поймано ${firedTerminal} · `
    + `одиночек ${singles}, из них сработало ${firedSingles}`);
}

function selftest() {
  let bad = 0;
  let blocks = 0;
  // Число блоков СЧИТАЕТСЯ, а не пишется: ярлык с числом врёт молча в тот же день, когда блок
  // добавили и забыли поправить подпись (та же причина, по которой его не пишет `guard-lint`).
  const ok = (name, got, want) => {
    blocks += 1;
    const good = JSON.stringify(got) === JSON.stringify(want);
    if (!good) bad += 1;
    // Слова зелёной и красной строки — из словарей батареи (`selftest-all`): она читает набор
    // ТРЕМЯ чтениями сразу, и «ХОРОШО» ей неизвестно — набор насчитал бы ноль блоков, а ноль
    // вместо числа в сводке хуже отсутствия.
    console.log(`${good ? '✅' : '❌ ПЛОХО'}  ${name}${good ? '' : `\n           получено ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`}`);
  };
  const at = (s) => ({ at: `2026-08-30T${s}+03:00` });

  console.log('САМОПРОВЕРКА driver-voice — правило голоса драйвера\n');

  // ── Ось 1: само правило, обе стороны (сторож, доказанный в одну сторону, — стена, EXP-0194)
  ok('ноль событий — молчит', driverVoiceVerdict([]).stop, false);
  ok('ОДНО событие — молчит (0 из 9 одиночек архива предшествовали замиранию)',
    driverVoiceVerdict([at('21:48:34')]).stop, false);
  ok('ДВА события в окне — СРАБАТЫВАЕТ (граница снизу)',
    driverVoiceVerdict([at('21:48:34'), at('21:48:39')]).stop, true);
  ok('два события РОВНО на границе окна — срабатывает (граница закрытая)',
    driverVoiceVerdict([{ atMs: 0 }, { atMs: DRIVER_VOICE.windowMs }]).stop, true);
  ok('два события ЗА границей окна — молчит (граница сверху)',
    driverVoiceVerdict([{ atMs: 0 }, { atMs: DRIVER_VOICE.windowMs + 1 }]).stop, false);
  ok('нечитаемое время НЕ считается за событие и названо',
    (() => { const v = driverVoiceVerdict([at('21:48:34'), { at: 'вчера' }]); return [v.stop, v.unreadable]; })(), [false, 1]);
  ok('мусор вместо списка не роняет', driverVoiceVerdict(null).stop, false);
  ok('причина названа, когда сработало',
    /КАНАЛ ДРАЙВЕРА/u.test(driverVoiceVerdict([at('21:48:34'), at('21:48:39')]).why || ''), true);
  ok('причины нет, когда не сработало', driverVoiceVerdict([at('21:48:34')]).why, null);

  // ── Ось 2: СНЯТЫЙ АРХИВ. Фикстура построенная доказывает разбор формы; снятая — что форма та.
  const events = readJsonl(FIXTURE_EVENTS);
  const freezes = readJsonl(FIXTURE_FREEZES);
  const bursts = burstsOf(events);
  ok('архив на месте: 179 событий, 21 вспышка, 16 нештатных выключений',
    [events.length, bursts.length, freezes.length], [179, 21, 16]);

  const judged = bursts.map((b) => ({ b, stop: driverVoiceVerdict(b.events).stop, terminal: burstIsTerminal(b, freezes) }));
  ok('ПОЛНОТА: все шесть смертельных вспышек архива пойманы',
    [judged.filter((x) => x.terminal).length, judged.filter((x) => x.terminal && x.stop).length], [6, 6]);
  ok('ОДИНОЧКИ: девять одиночных вспышек, сработало ноль',
    [judged.filter((x) => x.b.events.length === 1).length,
      judged.filter((x) => x.b.events.length === 1 && x.stop).length], [9, 0]);
  ok('ТОЧНОСТЬ названа честно: срабатываний 12 при шести смертельных — потому реакция и есть СТУПЕНЬ, а не полоса',
    judged.filter((x) => x.stop).length, 12);
  ok('порог Microsoft (5 за 60 с) НЕ поймал бы 30.08 — довод, по которому взяты свои числа',
    driverVoiceVerdict(bursts[bursts.length - 1].events, { windowMs: 60_000, minCount: 5 }).stop, false);

  // ── ШОВ ЧТЕНИЯ ОКНА: «НЕ ПРОЧИТАЛИ» ≠ «ЧИСТО» (`bugs/96`) ───────────────────────────────────
  //
  // До 2026-09-01 этот шов отвечал пустым списком и на молчащий канал, и на упавший запрос — то
  // есть отказ инструмента приходил к читателю как наблюдение «событий нет». Блоки держат ровно
  // различие: список (в том числе пустой) значит «прочитали», `null` значит «прочитать не удалось».
  const win = { fromMs: 0, toMs: 1000 };
  ok('шов отдаёт события СВОЕГО провайдера и отбрасывает чужие',
    driverEventsInWindow(win, () => ({
      providers: [{ provider: 'nvlddmkm', status: 'ok', count: 1 }],
      events: [{ provider: 'nvlddmkm', at: 'x' }, { provider: 'Display', at: 'y' }],
    })).length, 1);
  ok('молчащий канал — ПУСТОЙ СПИСОК, законное «чисто»',
    driverEventsInWindow(win, () => ({
      providers: [{ provider: 'nvlddmkm', status: 'no-events', count: 0 }], events: [],
    })), []);
  ok('ОТКАЗ провайдера — null, а не пустой список: «не прочитали» это не «событий нет»',
    driverEventsInWindow(win, () => ({
      providers: [{ provider: 'nvlddmkm', status: 'error', detail: 'access denied' }], events: [],
    })), null);
  ok('бросок запроса — тоже null, а не молчание',
    driverEventsInWindow(win, () => { throw new Error('powershell died'); }), null);
  ok('ответ без списка событий — null: форма сменилась, и это видно',
    driverEventsInWindow(win, () => ({})), null);
  // НАЙДЕНО ЖИВОЙ ПРОБОЙ 2026-09-01, а не придумано: ответ ПРО ДРУГОГО провайдера читался как
  // «в нашем канале чисто». Спрашивали про `nvlddmkm` — ответ, который о нём не упоминает, ответом
  // о нём не является. Живой ответ по нашему правилу запись о `nvlddmkm` несёт всегда (замерено).
  ok('ответ ПРО ДРУГОГО провайдера — null, а не «чисто»',
    driverEventsInWindow(win, () => ({
      providers: [{ provider: 'Display', status: 'ok', count: 4107 }], events: [],
    })), null);
  ok('правило молчит на null, а не срабатывает — прибор без данных не голосует (R4b)',
    driverVoiceVerdict(driverEventsInWindow(win, () => null)).stop, false);

  // ── ЯРУС 2: разбор строк наблюдателя и правило «один раз на вспышку» ────────────────────────
  ok('строка события разбирается', parseWatchLine('EVENT {"at":"2026-08-30T21:48:34+03:00","id":153}').kind, 'event');
  ok('строка жизни разбирается — молчание канала обязано отличаться от смерти наблюдателя',
    parseWatchLine('ALIVE 2026-08-30T21:48:34+03:00').kind, 'alive');
  ok('отказ подъёма разбирается отдельным родом, а не молчанием',
    parseWatchLine('FAILED access denied').kind, 'failed');
  ok('НЕПОНЯТНАЯ строка — ПЯТЫЙ род, а не тишина: сменившийся формат обязан быть виден',
    [parseWatchLine('нечто').kind, parseWatchLine('EVENT не-json').kind], ['unparsed', 'unparsed']);

  {
    const st = makeVoiceState();
    ok('первое событие не решает', st.saw({}, 1000).fire, false);
    ok('второе в окне — РЕШАЕТ', st.saw({}, 4000).fire, true);
    ok('и счётчик СБРОШЕН: вспышка из сорока трёх не убивает сорок два прожига подряд',
      [st.pending(), st.saw({}, 5000).fire], [0, false]);
  }
  {
    const st = makeVoiceState();
    ok('два события ЗА окном не решают — старое выпадает из окна, а не копится вечно',
      [st.saw({}, 0).fire, st.saw({}, DRIVER_VOICE.windowMs + 1).fire, st.pending()], [false, false, 1]);
  }

  // ── ЯРУС 2: ПРОВОДКА — рука зовётся ровно тогда, когда правило сработало, и не раньше ───────
  {
    const killed = [];
    const written = [];
    const fake = { stdout: { setEncoding() {}, on(_, cb) { this._cb = cb; } }, once() {} };
    const child = watchLoop({
      spawnFn: () => fake,
      killImages: (imgs) => { killed.push(imgs); return { ok: true, ms: 1, detail: 'furnace.exe:убит' }; },
      images: ['furnace.exe'],
      writeLine: (r) => written.push(r),
      nowFn: (() => { let t = 0; return () => (t += 1000); })(),
    });
    child.stdout._cb('READY 2026-08-31T01:00:00+03:00\nALIVE 2026-08-31T01:00:01+03:00\n');
    ok('до событий рука НЕ зовётся, а строки жизни пишутся',
      [killed.length, written.map((w) => w.kind)], [0, ['ready', 'alive']]);
    child.stdout._cb('EVENT {"id":153}\n');
    ok('ОДНО событие руки не поднимает', killed.length, 0);
    child.stdout._cb('EVENT {"id":14}\n');
    ok('ДВА события в окне — прожиг убит, и это записано с причиной',
      [killed, written.at(-1).kind, /КАНАЛ ДРАЙВЕРА/u.test(written.at(-1).why || '')],
      [[['furnace.exe']], 'fired', true]);
    // Строка приходит РАЗОРВАННОЙ по границе куска — обычное дело для потока; склейка обязана
    // работать, иначе половина событий станет «непонятными строками» на живом прогоне.
    const before = killed.length;
    child.stdout._cb('EVE');
    child.stdout._cb('NT {"id":153}\nEVENT {"id":153}\n');
    ok('РАЗОРВАННАЯ строка склеивается, а не теряется', killed.length, before + 1);
  }

  console.log(`\nСАМОПРОВЕРКА: блоков ${blocks}, провалов ${bad}`);
  return bad === 0 ? 0 : 1;
}

// Сторож главного модуля — тот же, что у соседей по каталогу: импорт не запускает ничего.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  if (argv.includes('--archive')) archive();
  else if (argv.includes('--selftest')) process.exit(selftest());
  else if (argv.includes('--watch')) await watch(argv);
  else if (argv.includes('--bench-latency')) process.exit(await benchLatency());
  else console.log('Голос драйвера (bugs/79). Режимы: --selftest · --archive · --watch · --bench-latency\n'
    + `Каталог модуля: ${HERE}`);
}
