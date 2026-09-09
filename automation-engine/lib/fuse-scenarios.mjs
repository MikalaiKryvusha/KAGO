// fuse-scenarios.mjs — МАТРИЦА ОТКАЗОВ ПРЕДОХРАНИТЕЛЯ: ЧТО КАЖДЫЙ ВХОД ВИДИТ В КАЖДОМ СЦЕНАРИИ.
//
// 🔴 ПОЧЕМУ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ, ДОСЛОВНО. Владелец 2026-09-09, после того как машина зависла на
// 3090 МГц / 900 мВ, а предохранитель промолчал: *«ты не охватываешь всевозможные сценарии, очень
// тупо и слабо его делаешь, не тестируешь нихуя - вот комп и зависает постоянно»*.
//
// Критика по существу верна, и вот её механизм. Предохранитель строился ВХОД ЗА ВХОДОМ, и каждый
// вход отвечал на ПРОШЛЫЙ отказ: вход 1 — на смерть 28.08, вход 2 — на остановку 05.09, вход 3 —
// на «карта отвечает, но не считает» 08.09. Ни разу никто не выписал пространство отказов ЦЕЛИКОМ
// и не спросил у каждой клетки: «а этот сценарий кто ловит?». Поэтому дыра нашлась ровно там, где
// сценарий не был назван вслух: прожиг, умерший ДО ПЕРВОГО удара прогресса.
//
// ЧТО ЗДЕСЬ ЕСТЬ. Перечисление сценариев отказа, и для каждого — что видит каждый из трёх входов и
// каким обязан быть ответ предохранителя. Сценарий, который не ловит НИКТО, обязан быть назван
// ДЫРОЙ вслух, а не молча отсутствовать. Матрица печатается целиком: непокрытая клетка видна
// глазом, а не выводится из чтения кода.
//
// ЧЕГО ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ. Это модель решения, а не сам судья: у судьи есть сокет, часы и
// руки. Поэтому суждение считают ТЕ ЖЕ функции, которыми судит живой путь (`judgeLiveness`,
// `stepPowerWindow`, `cancelsFalseTrip`), а моделируется здесь ровно одно — состояние провода,
// которое в живом цикле поднимает байт `0x02`. Расхождение этой пары стерегёт блок
// `матрица и живой цикл поднимают провод ОДНИМ И ТЕМ ЖЕ событием` ниже: он читает исходник судьи.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  judgeLiveness, stepPowerWindow, cancelsFalseTrip,
  POWER_ESTABLISHED_MW, POWER_LOW_HOLD_MS, DERIVED_ARM_N_MS,
  CARD_STALE_TELEMETRY_MS, BEATS_FRESH_MS,
} from './fuse.mjs';

/** Уставка входа 2 для горна на полосе — то самое число, что стояло в погибшем прогоне. */
export const SCENARIO_ARM_M_MS = 1166;
/** Такт судьи в модели — тот же, что живой. */
export const TICK_MS = 2;

/**
 * ПРОГОН ОДНОГО СЦЕНАРИЯ ЧЕРЕЗ НАСТОЯЩИЕ ФУНКЦИИ СУЖДЕНИЯ.
 *
 * Сценарий описывается функцией `at(ms)`, возвращающей, что произошло к этому мигу:
 *   · `beatAgeMs`     — сколько прошло с последнего удара живости (null — ударов не было вовсе)
 *   · `progressBeat`  — пришёл ли в этот такт удар прогресса `0x02`
 *   · `powerMw`       — что несёт удар (null — поле не пришло)
 *   · `burnAlive`     — жив ли процесс прожига (ответ `burnInFlight` живого пути)
 *
 * @returns {{tripped:boolean, cause:string|null, atMs:number|null, ticks:number}}
 */
export function runScenario(at, { seconds = 20, armNMs = DERIVED_ARM_N_MS, armMMs = SCENARIO_ARM_M_MS, armPowerRatio = null } = {}) {
  let lastProgressMs = null;
  let progressWired = false;
  let win = { peakMw: 0, lowSinceMs: null };
  let ticks = 0;
  // Вход 4 живёт мигом ПОСЛЕДНЕГО ИЗМЕНЕНИЯ числа — ровно как в такте судьи.
  let lastPowerMw = null;
  let lastPowerChangeMs = null;
  for (let now = 0; now <= seconds * 1000; now += TICK_MS) {
    const s = at(now);
    ticks += 1;
    // ⚡ ЕДИНСТВЕННАЯ МОДЕЛИРУЕМАЯ ЧАСТЬ: провод поднимает удар `0x02`, и больше ничто.
    // Ровно эта строка живёт в судье (`fuse.mjs`, ветка `buf[0] === 0x02`), и её сторожит блок ниже.
    if (s.progressBeat) { lastProgressMs = now; progressWired = true; }
    const mwNow = s.powerMw ?? null;
    if (mwNow !== null && (lastPowerChangeMs === null || mwNow !== lastPowerMw)) lastPowerChangeMs = now;
    if (mwNow !== null) lastPowerMw = mwNow;
    win = stepPowerWindow(win, {
      progressWired, powerMw: s.powerMw ?? null, nowMs: now, armPowerRatio, establishedMw: POWER_ESTABLISHED_MW,
    });
    const verdict = judgeLiveness({
      nowMs: now,
      lastBeatMs: s.beatAgeMs === null ? null : now - s.beatAgeMs,
      armNMs, lastProgressMs, armMMs, progressWired,
      power: {
        mw: s.powerMw ?? null, peakMw: win.peakMw, ratio: armPowerRatio,
        establishedMw: POWER_ESTABLISHED_MW,
        lowForMs: win.lowSinceMs === null ? 0 : now - win.lowSinceMs,
        holdMs: POWER_LOW_HOLD_MS,
      },
      staleTelemetry: {
        limitMs: CARD_STALE_TELEMETRY_MS,
        frozenForMs: lastPowerChangeMs === null ? null : now - lastPowerChangeMs,
        beatsFresh: s.beatAgeMs !== null && s.beatAgeMs <= BEATS_FRESH_MS,
      },
    });
    if (!verdict.tripped) continue;
    // Ворота ложного срабатывания — те же, что на живом пути.
    if (cancelsFalseTrip({ cause: verdict.cause, burnAlive: s.burnAlive, lowSinceMs: win.lowSinceMs })) {
      lastProgressMs = null; progressWired = false; win = { peakMw: 0, lowSinceMs: null };
      continue;
    }
    return { tripped: true, cause: verdict.cause, atMs: now, ticks };
  }
  return { tripped: false, cause: null, atMs: null, ticks };
}

// =================================================================================================
// ПРОСТРАНСТВО ОТКАЗОВ — перечислено вслух, а не подразумевается
// =================================================================================================

const BURN_TICK_MS = 331;   // измеренный такт прожига furnace на 2820 МГц
const HOT_MW = 300_000;
const IDLE_MW = 47_000;     // ровно то, что стояло в кольце смерти 09.09

/**
 * 🔴 ЖИВАЯ КАРТА НЕ ДЕРЖИТ ЧИСЛО НЕПОДВИЖНЫМ, И МОДЕЛЬ ОБЯЗАНА ЭТО ЗНАТЬ.
 *
 * Первая редакция сценариев отдавала мощность КОНСТАНТОЙ — и как только появился вход 4, три
 * здоровых сценария (E, F, G) немедленно покраснели ложным срабатыванием. Дефект был не во входе,
 * а в модели: карта обновляет число примерно дважды в секунду, и самая длинная площадка на
 * 95 000 тактов настоящей работы 09.09 — 515 мс. Константа в фикстуре описывала МЁРТВУЮ карту и
 * называла её здоровой.
 *
 * Здесь число меняется каждые 490 мс — чуть чаще измеренного потолка, как и на живой карте.
 * Матрица поймала это на первом же прогоне; ради этого она и написана.
 */
const REFRESH_MS = 490;
const alive = (base) => (t) => base + (Math.floor(t / REFRESH_MS) % 7) * 137;

/**
 * Каждый сценарий: имя · что случилось физически · чем это кончилось в жизни (если случалось) ·
 * ожидание. `expect: 'trip'` — обязан сработать; `'silent'` — обязан промолчать; `'HOLE'` — сегодня
 * не ловит НИКТО, и это записано как дыра, а не как норма.
 */
export const SCENARIOS = [
  {
    id: 'A-канал-мёртв',
    what: 'проба ушла в драйвер и не вернулась — ударов живости нет вовсе',
    paid: 'смерть 28.08, ради неё построен вход 1',
    expect: 'trip', by: 'вход 1',
    at: (t) => ({
      beatAgeMs: t < 3000 ? 2 : t - 3000,
      progressBeat: t < 3000 && t % BURN_TICK_MS < TICK_MS,
      powerMw: alive(HOT_MW)(t), burnAlive: true,
    }),
  },
  {
    id: 'B-прожиг-застыл-после-первого-удара',
    what: 'прожиг отдал удары, потом карта встала: прогресс замолчал, процесс жив',
    paid: 'остановка 05.09, ради неё построен вход 2',
    expect: 'trip', by: 'вход 2',
    at: (t) => ({
      beatAgeMs: 2,
      progressBeat: t < 4000 && t % BURN_TICK_MS < TICK_MS,
      powerMw: t < 4000 ? alive(HOT_MW)(t) : alive(IDLE_MW)(t), burnAlive: true,
    }),
  },
  {
    id: 'C-прожиг-умер-ДО-первого-удара',
    what: 'напряжение применено, прожиг запущен, карта встала СРАЗУ: ни одного удара прогресса, '
      + 'удары живости идут (драйвер отвечает), мощность стоит на простое',
    paid: '🔴 ЗАВИСАНИЕ 09.09 14:44, 3090 МГц / 900 мВ. Предохранитель молчал 3 минуты и умер с машиной',
    expect: 'trip', by: 'ВХОД 4 — телеметрия карты замерла при живом канале (bugs/132)',
    at: () => ({ beatAgeMs: 2, progressBeat: false, powerMw: IDLE_MW, burnAlive: true }),
  },
  {
    id: 'D-карта-отвечает-но-не-считает',
    what: 'прогресс идёт, удары идут, но мощность обвалилась вчетверо и держится',
    paid: 'зависание 08.09 10:02, ради него построен вход 3',
    expect: 'trip', by: 'вход 3 (сегодня РАЗОРУЖЁН — bugs/131)',
    armPowerRatio: 0.412,
    at: (t) => ({
      beatAgeMs: 2,
      progressBeat: t % BURN_TICK_MS < TICK_MS,
      powerMw: t < 3000 ? alive(HOT_MW)(t) : alive(60_000)(t), burnAlive: true,
    }),
  },
  {
    id: 'E-штатный-конец-прожига',
    what: 'прожиг отработал и вышел сам: прогресс кончился, мощность ушла к простою, процесса нет',
    paid: 'девять ложных спасений 08.09 19:21 и шесть фальшивых стен',
    expect: 'silent', by: 'ворота отмены (прожига нет)',
    at: (t) => ({
      beatAgeMs: 2,
      progressBeat: t < 5000 && t % BURN_TICK_MS < TICK_MS,
      powerMw: t < 5000 ? alive(HOT_MW)(t) : alive(IDLE_MW)(t), burnAlive: t < 5000,
    }),
  },
  {
    id: 'F-между-ступенями-прожига-нет',
    what: 'полоса считает следующую ступень: прожига нет вовсе, карта в покое, удары идут',
    paid: 'ложный трип 29.08 — тишина 994 мс при идеальных ударах',
    expect: 'silent', by: '«источника нет» ≠ «застыл»',
    at: (t) => ({ beatAgeMs: 2, progressBeat: false, powerMw: alive(IDLE_MW)(t), burnAlive: false }),
  },
  {
    id: 'G-зазор-DPC-под-занятым-драйвером',
    what: 'драйвер занят, зазоры ударов выросли до 40 мс — но НИЖЕ уставки 60 мс',
    paid: 'замер живого пола под нагрузкой, plans/56',
    expect: 'silent', by: 'уставка выше измеренного пола',
    at: (t) => ({
      beatAgeMs: t % 100 < 50 ? 40 : 2,
      progressBeat: t % BURN_TICK_MS < TICK_MS,
      powerMw: alive(HOT_MW)(t), burnAlive: true,
    }),
  },
  {
    id: 'H-проба-умерла-карта-жива',
    what: 'процесс пробы убит, ударов нет; карта при этом работает',
    paid: 'не наблюдалось; сценарий назван как возможный',
    expect: 'trip', by: 'вход 1 — и это ВЕРНО: наблюдения нет, значит защиты нет',
    at: (t) => ({
      beatAgeMs: t < 1000 ? 2 : t - 1000,
      progressBeat: t % BURN_TICK_MS < TICK_MS,
      powerMw: alive(HOT_MW)(t), burnAlive: true,
    }),
  },
];

/** Прогон всей матрицы. Возвращает строки для печати и список ДЫР. */
export function runMatrix() {
  const rows = [];
  for (const s of SCENARIOS) {
    const r = runScenario(s.at, { armPowerRatio: s.armPowerRatio ?? null });
    const got = r.tripped ? `трип (${r.cause}) на ${Math.round(r.atMs)} мс` : 'молчание';
    const ok = s.expect === 'trip' ? r.tripped : !r.tripped;
    rows.push({ ...s, got, ok, tripped: r.tripped });
  }
  return rows;
}

/** Модель провода обязана совпадать с живым циклом — иначе матрица судит выдумку. */
export function wireTransitionGuard() {
  const src = readFileSync(fileURLToPath(new URL('./fuse.mjs', import.meta.url)), 'utf8');
  const live = /else if \(buf\[0\] === 0x02\) \{ lastProgressMs = now; progressWired = true; \}/u.test(src);
  const model = /if \(s\.progressBeat\) \{ lastProgressMs = now; progressWired = true; \}/u
    .test(readFileSync(fileURLToPath(import.meta.url), 'utf8'));
  return { live, model, ok: live && model };
}

export function selfTest() {
  const rows = runMatrix();
  console.log('МАТРИЦА ОТКАЗОВ ПРЕДОХРАНИТЕЛЯ — что ловится, что нет:\n');
  const holes = [];
  for (const r of rows) {
    const mark = r.ok ? '✅' : '🔴';
    console.log(`${mark} ${r.id}`);
    console.log(`     что: ${r.what}`);
    console.log(`     оплачено: ${r.paid}`);
    console.log(`     ждали: ${r.expect === 'trip' ? `срабатывание (${r.by})` : `молчание (${r.by})`} · получили: ${r.got}`);
    if (!r.ok) holes.push(r);
  }
  const g = wireTransitionGuard();
  console.log(`\nСТОРОЖ ПАРЫ: модель провода ${g.model ? 'на месте' : 'РАЗОШЛАСЬ'} · живой цикл ${g.live ? 'на месте' : 'РАЗОШЁЛСЯ'}`);
  console.log(`\nИТОГ: сценариев ${rows.length} · покрыто ${rows.length - holes.length} · ДЫР ${holes.length}`);
  for (const h of holes) console.log(`  🔴 ДЫРА: ${h.id} — ${h.what}`);
  return holes.length === 0 && g.ok ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith('fuse-scenarios.mjs')) {
  if (process.argv.includes('--help')) {
    console.log('fuse-scenarios — МАТРИЦА ОТКАЗОВ ПРЕДОХРАНИТЕЛЯ (bugs/132).');
    console.log('  node automation-engine/lib/fuse-scenarios.mjs            прогнать матрицу целиком');
    console.log('  node automation-engine/lib/fuse-scenarios.mjs --selftest то же самое: матрица И ЕСТЬ самопроверка');
    console.log('Печатает по сценарию: что случилось физически · чем оплачено · кто обязан сработать · что вышло.');
    console.log('Сценарий, которого не ловит НИКТО, называется ДЫРОЙ вслух и роняет код выхода.');
    console.log('Карту не трогает: фикстуры в памяти, читается один файл — исходник судьи, ради сторожа пары.');
    process.exit(0);
  }
  process.exit(selfTest());
}
