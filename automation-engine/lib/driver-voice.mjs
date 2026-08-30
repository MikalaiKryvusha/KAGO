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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * НЕ ПРОЧИТАЛИ — НЕ ЗНАЧИТ «ЧИСТО»: провайдер, не ответивший на запрос, возвращает пустой список
 * И поднимает `unreadable`, а решение по пустому списку — молчание. Это то же правило, которым
 * `event-logger` отказывается говорить «сбоев нет» над упавшим запросом.
 *
 * [NOT-TESTED] — живой путь; блоки доказывают правило и проводку, а не запрос к Windows.
 */
export function driverEventsInWindow({ fromMs, toMs }, queryFn) {
  const rule = { provider: 'nvlddmkm', ids: [] };
  try {
    const res = queryFn({ from: new Date(fromMs), to: new Date(toMs), providers: [{ ...rule, means: 'SIGNAL' }] });
    return (res?.events ?? []).filter((e) => e.provider === rule.provider);
  } catch {
    return [];
  }
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
// 3. CLI
// =================================================================================================

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

  console.log(`\nСАМОПРОВЕРКА: блоков ${blocks}, провалов ${bad}`);
  return bad === 0 ? 0 : 1;
}

// Сторож главного модуля — тот же, что у соседей по каталогу: импорт не запускает ничего.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  if (argv.includes('--archive')) archive();
  else if (argv.includes('--selftest')) process.exit(selftest());
  else console.log(`Голос драйвера (bugs/79). Режимы: --selftest · --archive\nКаталог модуля: ${HERE}`);
}
