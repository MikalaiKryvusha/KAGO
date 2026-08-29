#!/usr/bin/env node
// burn-model.mjs — модель НАГРУЗКИ прожига для цифрового двойника (эпик 67 фаза 1, `plans/68`).
//
// ЗАЧЕМ ЭТО ЕСТЬ. До этой фазы прожиг двойника был носителем времени стены: ватты не считались,
// каденция была одна на все формы (0,132 с — замер СТАРОЙ формы «процесс на запуск» от 2026-08-10),
// контрольная сумма — константа. Полигон эпика 67, гоняющий цикл по такому суррогату, дёшев.
//
// ЧТО ЗДЕСЬ ЛЕЖИТ И ЧЕГО НЕ ЛЕЖИТ. Здесь — ИЗМЕРЕННЫЕ таблицы (ватты по форме, каденция, доля
// GPU-времени) и штамп контрольной суммы. Здесь НЕТ формулы телеметрии: она живёт в
// `virtual-gpu.mjs` (`TELEMETRY_MODEL`), и активность формы выводится ТАМ из ватт этого модуля —
// один факт в одном месте, никакой пары констант, которая может разъехаться.
//
// [TESTED: 2026-08-29 · --selftest ниже + блоки «модель нагрузки» в vgpu --selftest]

// =================================================================================================
// 1. Ватты по форме — измеренная сетка, не назначенная
// =================================================================================================

/**
 * Рабочая точка, В КОТОРОЙ снималась сетка ватт: сток, верх диапазона. Частота — потолок стоковой
 * кривой (2842 МГц); напряжение — обслуживающее его по таблице карты (1020 мВ; то же число несут
 * живые логи ступени 2842). Активность формы выводится относительно ЭТОЙ точки — и потому обязана
 * быть записана рядом с таблицей, а не подразумеваться.
 */
export const REFERENCE_POINT = Object.freeze({ clockMhz: 2842, voltageMv: 1020 });

/**
 * Сетка «fma на слово → ватты», снятая 2026-08-22 на живой карте: 10 с на точку, сток, сэмплер и
 * нагрузка мерялись независимо (источник — шапка `workloads/furnace.cu`, там же разбор формы
 * кривой: мало FMA — SM стоят на памяти; много — тракт памяти сохнет). Пик 64 — карта ЗАЖАТА
 * пределом мощности (305 медиана / 325 пик при лимите 300, `sw_power_cap` наблюдался).
 *
 * ⚠️ ИЗВЕСТНОЕ РАСХОЖДЕНИЕ ДВУХ ЗАМЕРОВ, не решённое молча: `FURNACE_LADDER.wattsSeen`
 * (`stress-tester.mjs`, снят 2026-08-26 в работе `plans/50`) даёт fma=48 → 303 Вт против 269 здесь.
 * Калибровка идёт ПО СЕТКЕ (один протокол, десять точек одного дня); расхождение названо в
 * `plans/68` §Итог. Уточнит только живой перезамер — не подгонка.
 */
export const FURNACE_WATTS_BY_FMA = Object.freeze([
  Object.freeze([0, 207]), Object.freeze([16, 238]), Object.freeze([32, 248]),
  Object.freeze([48, 269]), Object.freeze([64, 305]), Object.freeze([96, 287]),
  Object.freeze([128, 275]), Object.freeze([256, 267]), Object.freeze([1024, 252]),
  Object.freeze([4096, 229]),
]);

/** Линейная интерполяция по сетке; за краями — зажим на крайние строки (экстраполяция — выдумка). */
export function furnaceWattsAt(fmaPerRead) {
  const g = FURNACE_WATTS_BY_FMA;
  if (fmaPerRead <= g[0][0]) return g[0][1];
  if (fmaPerRead >= g[g.length - 1][0]) return g[g.length - 1][1];
  for (let i = 1; i < g.length; i++) {
    if (fmaPerRead <= g[i][0]) {
      const t = (fmaPerRead - g[i - 1][0]) / (g[i][0] - g[i - 1][0]);
      return g[i - 1][1] + t * (g[i][1] - g[i - 1][1]);
    }
  }
  return g[g.length - 1][1];
}

/**
 * Ватты остальных форм — с КАРТОЧКОЙ ПРОИСХОЖДЕНИЯ на каждой (правило эпика 67: параметр без
 * источника не существует). `watts: null` = ваттами не измерено; тогда потребитель берёт
 * `provisionalActivity` и честно знает, что это назначенное число.
 */
export const SHAPE_WATTS = Object.freeze({
  sdc_fma: Object.freeze({
    watts: 233,
    origin: 'замер 2026-08-22 (та же сетка; зафиксирован в шапке furnace.cu: «back to sdc_fma’s 233 W»)',
  }),
  branchy: Object.freeze({
    watts: null,
    provisionalActivity: 0.62,
    origin: 'НАЗНАЧЕНО: ваттами не измерялась; взята активность fma=0 — формы, тоже стоящей на памяти, '
      + 'а не на плотном FMA. Уточняется одним живым замером ватт под branchy --sustain',
  }),
});

/**
 * Целевые ватты формы; `null` = не измерено (потребитель обязан взять provisional и сказать об этом).
 * `args` — позиционные аргументы нагрузки; у furnace четвёртый (индекс 3) — fma на слово, дефолт 64
 * (дефолт самого `furnace.cu`).
 */
export function targetWattsFor(workload, args = []) {
  if (workload === 'furnace') {
    const fma = Number.isFinite(Number(args[3])) ? Number(args[3]) : 64;
    return furnaceWattsAt(fma);
  }
  const s = SHAPE_WATTS[workload];
  return s ? s.watts : null;
}

// =================================================================================================
// 2. Каденция и доля GPU-времени — медианы 42 архивных прогонов (`runs/power/*.json`)
// =================================================================================================

/**
 * Миллисекунды на ОДИН запуск хостового цикла `--sustain`, медианы по архиву (`researches/24` §3:
 * furnace n=7 · branchy n=29 · sdc_fma n=6). Это ДРУГОЙ факт, чем `fuse.PROGRESS_TICK_MAX_MS`:
 * там МАКСИМУМЫ двух источников (порог предохранителя обязан пережить худший случай), здесь
 * медианы (счёт запусков должен попадать в типичный прогон). Оба из замера, потребители разные.
 */
export const LAUNCH_PERIOD_MS = Object.freeze({ furnace: 302.32, branchy: 26.11, sdc_fma: 0.78 });

/**
 * Доля времени стены, проведённая в GPU (`gpu_us / wall_us`). Медианы того же архива; вторые,
 * НЕЗАВИСИМЫЕ источники сходятся: шапка `furnace.cu` — 93,6 %, шапка `sdc_fma.cu` — 6759026/12000036
 * = 56,3 %, `cold_2400.json` — 98,66 %.
 */
export const DUTY = Object.freeze({ furnace: 0.934, branchy: 0.985, sdc_fma: 0.565 });

// =================================================================================================
// 3. Контрольная сумма по ШТАМПУ — дисциплина R6 становится упражняемой на двойнике
// =================================================================================================

/**
 * Сумма — функция (нагрузка, аргументы): другая интенсивность — другая сумма, эталон годен только
 * для СВОЕГО штампа (R6; `runOptionsForShape` прямо говорит «different intensity is a different
 * computation with a different checksum»). ДЕФОЛТ СОХРАНЁН: пустые аргументы возвращают базовую
 * сумму карты (`GOLDEN_CHECKSUM` у обычной) — ни один существующий эталон и блок не сдвигается.
 * `--sustain` в штамп НЕ входит — тем же решением, что в `runBurst` («sustainSeconds is
 * deliberately NOT part of args»).
 */
export function stampChecksum(workload, args, baseChecksum) {
  if (!args || args.length === 0) return baseChecksum;
  // FNV-1a по строке штампа — тот же алгоритм, которым живые нагрузки хешируют буфер; BigInt ради
  // честных 64 бит без зависимости.
  let h = 0xcbf29ce484222325n;
  for (const ch of `${workload}:${args.join(',')}`) {
    h ^= BigInt(ch.codePointAt(0));
    h = (h * 0x100000001b3n) & 0xFFFFFFFFFFFFFFFFn;
  }
  return h.toString(16).padStart(16, '0');
}

// =================================================================================================
// 4. Самопроверка — чистая арифметика, ни карты, ни файлов
// =================================================================================================

function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('САМОПРОВЕРКА burn-model — таблицы нагрузки и штамп; чистая арифметика');
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона: строка сетки ватт · штамп различает аргументы · '
    + 'дефолтный штамп — базовая сумма');

  ok('сетка ватт: узлы отдаются точно (0→207 · 64→305 · 4096→229)',
    furnaceWattsAt(0) === 207 && furnaceWattsAt(64) === 305 && furnaceWattsAt(4096) === 229);
  ok('сетка ватт: между узлами — линейно (80 лежит строго между 305 и 287)', (() => {
    const w = furnaceWattsAt(80);
    return w < 305 && w > 287;
  })());
  ok('сетка ватт: за краями — зажим, не экстраполяция (−5 → 207 · 10⁶ → 229)',
    furnaceWattsAt(-5) === 207 && furnaceWattsAt(1e6) === 229);
  ok('targetWattsFor: furnace читает fma из args[3], дефолт 64',
    targetWattsFor('furnace', [2400, 8192, 256, 48]) === 269 && targetWattsFor('furnace') === 305);
  ok('targetWattsFor: sdc_fma измерен (233), branchy честно null + провизорная активность с origin',
    targetWattsFor('sdc_fma') === 233 && targetWattsFor('branchy') === null
    && SHAPE_WATTS.branchy.provisionalActivity > 0 && /НАЗНАЧЕНО/u.test(SHAPE_WATTS.branchy.origin));
  ok('каденция и доля: таблицы полны для трёх форм и заморожены',
    ['furnace', 'branchy', 'sdc_fma'].every((w) => LAUNCH_PERIOD_MS[w] > 0 && DUTY[w] > 0 && DUTY[w] <= 1)
    && Object.isFrozen(LAUNCH_PERIOD_MS) && Object.isFrozen(DUTY));
  ok('каденция: furnace в ~387 раз медленнее sdc_fma — различие форм не потерялось',
    LAUNCH_PERIOD_MS.furnace / LAUNCH_PERIOD_MS.sdc_fma > 300);
  ok('штамп: пустые args → базовая сумма ДОСЛОВНО (эталоны не сдвигаются)',
    stampChecksum('furnace', [], 'fd7d452ce569c9d7') === 'fd7d452ce569c9d7'
    && stampChecksum('furnace', null, 'aaaa') === 'aaaa');
  ok('штамп: разные аргументы — разные суммы; та же пара — та же сумма; 16 hex', (() => {
    const a = stampChecksum('furnace', [2400, 8192, 256, 64], 'x');
    const b = stampChecksum('furnace', [2400, 8192, 256, 48], 'x');
    const a2 = stampChecksum('furnace', [2400, 8192, 256, 64], 'x');
    return a !== b && a === a2 && /^[0-9a-f]{16}$/u.test(a);
  })());
  ok('штамп: та же строка аргументов у ДРУГОЙ нагрузки — другая сумма',
    stampChecksum('furnace', [7], 'x') !== stampChecksum('branchy', [7], 'x'));

  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const code = process.argv.includes('--selftest') ? cmdSelftest() : (() => {
    console.log('Использование: --selftest');
    console.log('Модуль — таблицы модели нагрузки для virtual-gpu.mjs; сам ничего не запускает.');
    return 2;
  })();
  process.exit(code);
}
