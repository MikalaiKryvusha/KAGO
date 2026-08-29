#!/usr/bin/env node
// automation-engine/lib/polygon-shrink.mjs — СЖАТИЕ ЛОМАЮЩЕЙ КАРТЫ (эпик 67 фаза 4, `plans/71` шаг 5).
//
// ЧИСТАЯ ЛОГИКА С ВНЕДРЯЕМЫМ ОРАКУЛОМ. Сжатие спрашивает у оракула ровно одно: «ломается ли ЭТОТ
// вход, и КАКИМ классом». Оракул в бою — настоящий прогон карты под сторожами (минуты); в наборе —
// подставная функция (миллисекунды). Разделение не ради красоты: логика сжатия — это то, что можно
// и нужно доказать мутациями, а прогонять её на настоящих картах в батарее нельзя.
//
// ─── ЧТО СЖАТИЕ МИНИМИЗИРУЕТ ───────────────────────────────────────────────────────────────────
//
// ВХОД ГЕНЕРАТОРА, а не файл карты (интегрированное сжатие, решение 3 журнала `plans/67`). Файл
// восстанавливается из тройки (семя, амплитуда, архетип) байт-в-байт, поэтому минимальный ВХОД и
// есть минимальная карта — и она воспроизводима одной командой, а не приложена бинарником.
//
// ─── ГЛАВНОЕ ПРАВИЛО: КЛАСС ОТКАЗА ОБЯЗАН СОХРАНИТЬСЯ ──────────────────────────────────────────
//
// Названный анти-паттерн PBT (риск 4 `plans/67`): сжатие, меняющее класс, МАСКИРУЕТ дефект — оно
// подменяет найденную болезнь другой, попроще, и отчёт рассказывает о ней. Поэтому кандидат,
// сломавшийся ДРУГИМ классом, отвергается, и отказ виден в выводе, а не глотается.
//
// [TESTED: 2026-08-29 19:1x · --selftest — бисекция находит границу, смена класса отвергается,
//  ось, без которой отказ жив, снимается, а ось-виновница возвращается; мутации ×3.]

import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Оси, которые сжатие пробует «занулить» — по одной, от самой подозрительной к самой общей. */
export const SHRINKABLE_AXES = Object.freeze(['floor', 'tableDrift', 'edgeShift', 'governor', 'boost']);

/**
 * Сжать ломающий вход.
 *
 * @param {{amplitude:number, archetype:string, seed:number, frozenAxes?:string[]}} start
 * @param {(cand:object) => (string|null)} breaksWith — класс отказа кандидата, либо null
 * @param {{minStepA?:number, axes?:string[], log?:(s:string)=>void}} opts
 * @returns {{ok:boolean, minimal:object|null, klass:string|null, steps:Array<object>, rejected:Array<object>}}
 */
export function shrink(start, breaksWith, { minStepA = 0.05, axes = SHRINKABLE_AXES, log = () => {} } = {}) {
  const klass = breaksWith(start);
  if (!klass) return { ok: false, minimal: null, klass: null, steps: [], rejected: [], why: 'исходный вход не ломается — сжимать нечего' };

  const steps = [];
  const rejected = [];
  let best = { ...start, frozenAxes: [...(start.frozenAxes ?? [])] };

  // ─── 1. БИСЕКЦИЯ АМПЛИТУДЫ ВНИЗ ──────────────────────────────────────────────────────────────
  // Инвариант бисекции: `lo` НЕ ломается тем же классом (или не проверялась и равна 0), `hi` —
  // ломается. Сходимся, пока окно шире шага; результат — наименьшая амплитуда, на которой класс жив.
  let lo = 0;
  let hi = best.amplitude;
  while (hi - lo > minStepA) {
    const mid = Math.round(((lo + hi) / 2) * 1000) / 1000;
    const cand = { ...best, amplitude: mid };
    const k = breaksWith(cand);
    if (k === klass) { hi = mid; best = cand; steps.push({ move: 'амплитуда', to: mid, verdict: 'ломается' }); } else if (k === null) { lo = mid; steps.push({ move: 'амплитуда', to: mid, verdict: 'не ломается' }); } else {
      // ⚠️ ДРУГОЙ КЛАСС — НЕ УСПЕХ И НЕ НЕЙТРАЛЬНО. Такой кандидат не годится как «меньший вход»,
      // и молча считать его «не ломается» значило бы уводить бисекцию по чужой болезни.
      lo = mid;
      rejected.push({ move: 'амплитуда', to: mid, klass: k, why: 'сменился класс отказа' });
      steps.push({ move: 'амплитуда', to: mid, verdict: `ДРУГОЙ КЛАСС: ${k}` });
    }
  }
  log(`амплитуда сжата до ${best.amplitude}`);

  // ─── 2. ЗАНУЛЕНИЕ ОСЕЙ ПО ОДНОЙ ──────────────────────────────────────────────────────────────
  // Ось, БЕЗ которой отказ жив, — не виновница: её снимаем и идём дальше. Ось, без которой отказ
  // исчезает (или меняет класс), ВОЗВРАЩАЕТСЯ: она часть минимального объяснения.
  for (const axis of axes) {
    if (best.frozenAxes.includes(axis)) continue;
    const cand = { ...best, frozenAxes: [...best.frozenAxes, axis] };
    const k = breaksWith(cand);
    if (k === klass) { best = cand; steps.push({ move: `ось ${axis}`, verdict: 'снята — отказ жив без неё' }); } else {
      steps.push({ move: `ось ${axis}`, verdict: k === null ? 'ВОЗВРАЩЕНА — без неё отказа нет' : `ВОЗВРАЩЕНА — сменился класс: ${k}` });
      if (k !== null) rejected.push({ move: `ось ${axis}`, klass: k, why: 'сменился класс отказа' });
    }
  }

  return { ok: true, minimal: best, klass, steps, rejected };
}

/** Команда воспроизведения минимальной карты — отчёт обязан давать её, а не описание. */
export function reproCommand(minimal) {
  const frozen = (minimal.frozenAxes ?? []).length ? ` --freeze ${minimal.frozenAxes.join(',')}` : '';
  return `node automation-engine/lib/card-generator.mjs --seed ${minimal.seed} `
    + `--amplitude ${minimal.amplitude} --archetype ${minimal.archetype}${frozen}`;
}

// =================================================================================================
// Самопроверка — оракул подставной, ни одного прогона
// =================================================================================================
function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('САМОПРОВЕРКА polygon-shrink — бисекция, зануление осей, отказ при смене класса; оракул подставной');
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона: направление бисекции · возврат оси-виновницы · трактовка ДРУГОГО класса');

  const start = { seed: 42, amplitude: 0.8, archetype: 'hot-unlucky', frozenAxes: [] };

  // Оракул: ломается классом «И6», пока амплитуда ≥ 0.3 И ось floor НЕ заморожена.
  const oracle = (c) => ((c.amplitude >= 0.3 && !(c.frozenAxes ?? []).includes('floor')) ? 'И6' : null);
  const r = shrink(start, oracle, { minStepA: 0.05 });
  ok('бисекция нашла ГРАНИЦУ, а не осталась на старте', r.ok && r.minimal.amplitude < 0.8 && r.minimal.amplitude >= 0.3,
    `амплитуда ${r.minimal?.amplitude}`);
  ok('граница ТОЧНАЯ в пределах шага: ниже неё отказа уже нет',
    oracle({ ...r.minimal, amplitude: r.minimal.amplitude - 0.05 }) === null, `${r.minimal?.amplitude}`);
  ok('ось-ВИНОВНИЦА возвращена: без floor отказа нет, значит floor — часть объяснения',
    !r.minimal.frozenAxes.includes('floor'), r.minimal?.frozenAxes?.join(','));
  ok('оси, БЕЗ которых отказ жив, сняты — минимальный вход не тащит лишнего',
    r.minimal.frozenAxes.includes('tableDrift') && r.minimal.frozenAxes.includes('edgeShift'),
    r.minimal?.frozenAxes?.join(','));

  // Смена класса — отказ, а не успех.
  const shifty = (c) => (c.amplitude >= 0.7 ? 'И6' : (c.amplitude >= 0.2 ? 'И2' : null));
  const rs = shrink({ ...start, amplitude: 0.9 }, shifty, { minStepA: 0.05 });
  ok('кандидат со СМЕНОЙ КЛАССА отвергнут и назван, а не принят за меньший вход',
    rs.rejected.some((x) => x.klass === 'И2' && /сменился класс/.test(x.why)), JSON.stringify(rs.rejected.slice(0, 1)));
  ok('и сжатие НЕ уехало по чужой болезни: класс остался тем, с которого начали',
    rs.klass === 'И6' && rs.minimal.amplitude >= 0.7, `${rs.klass} @ ${rs.minimal?.amplitude}`);

  ok('вход, который не ломается, сжимать отказываемся ВСЛУХ',
    (() => { const x = shrink(start, () => null, {}); return x.ok === false && /не ломается/.test(x.why); })());

  ok('отчёт даёт КОМАНДУ воспроизведения, включая замороженные оси',
    /--seed 42 --amplitude .* --archetype hot-unlucky --freeze /.test(reproCommand(r.minimal)),
    reproCommand(r.minimal));

  console.log(`ИТОГ: блоков ${pass + fail}, зелёных ${pass}, красных ${fail}`);
  return fail === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
    && process.argv.includes('--selftest')) {
  process.exit(cmdSelftest());
}
