#!/usr/bin/env node
// card-generator.mjs — генератор виртуальных карт (эпик 67 фаза 3, `plans/70`).
//
// (семя, амплитуда хаоса, архетип) → ВАЛИДНЫЙ файл карты, байт-идентичный своему семени.
// Двухслойная выборка по методу кремниевой индустрии (`researches/25` §2.3): архетип-КОРНЕР задаёт
// центры (глобальный разброс между «кристаллами»), Монте-Карло качает оси вокруг центров
// (локальный разброс), амплитуда A — множитель ширин. Карточка происхождения КАЖДОЙ ширины — в
// `AXES`; ширины «назначено» не смеют читаться как замер.
//
// Дверь валидации ОДНА — `validateCard` (P70-AC5): вторая проверка внутри генератора была бы
// вторым мнением о том, что такое карта.
//
// [TESTED: 2026-08-29 · --selftest ниже]

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deriveCardFromCurves, buildFiction, validateCard, mulberry32 } from './virtual-gpu.mjs';

// =================================================================================================
// 1. Оси хаоса — таблица ширин с происхождением (правится ЗДЕСЬ, код ниже её цитирует)
// =================================================================================================

/** Происхождения: 'наш-замер' · 'публичный-порядок' · 'назначено'. Дословно в файл карты. */
export const AXES = Object.freeze({
  headroomScale: Object.freeze({ width: 0.30, origin: 'публичный-порядок: лотерея кремния — десятки мВ между экземплярами (researches/25 §2.4)' }),
  headroomShiftMv: Object.freeze({ width: 25, origin: 'публичный-порядок: пример 975 против 1000 мВ на одной частоте' }),
  scaleMv: Object.freeze({ lo: 2, hi: 6, origin: 'наш-замер центра (3,5 мВ, researches/02); ширина назначена' }),
  noiseScale: Object.freeze({ width: 0.5, origin: 'назначено' }),
  packagePct: Object.freeze({ width: 0.10, origin: 'наш-замер центра (лестница ±2 %); ширина — публичный-порядок разброса SKU' }),
  limitW: Object.freeze({ values: [250, 285, 300, 320, 350], origin: 'публичный-порядок SKU' }),
  tableDriftMhzPerC: Object.freeze({ lo: -3, hi: -0.5, origin: 'наш-замер центра (−1,7 МГц/°C, R14b); ширина назначена' }),
  edgeShiftMvPerC: Object.freeze({ lo: 0, hi: 3, origin: 'назначено; наш замер дал r = 0,22 (bugs/63) — связь не доказана' }),
  boostSteps: Object.freeze({ values: [0, 1, 2, 3], origin: 'наш-замер: 2 ступени в 7 случаях из 9, 3 — в 2 (researches/11 §8)' }),
  governorMhz: Object.freeze({ lo: 20, hi: 80, origin: 'наш-замер порядка: заказ 2820 → выдача 2760…2805' }),
  floorDepthShare: Object.freeze({ lo: 0.3, hi: 0.7, origin: 'назначено: числа пола живой замер не дал (plans/69)' }),
});

/**
 * АРХЕТИПЫ-КОРНЕРЫ — каждый ловит СВОЙ класс дефектов движка, как SS/FF ловят свои
 * (`researches/25` §2.3). Поле = центр или включённость механизма; MC качает вокруг.
 */
export const ARCHETYPES = Object.freeze({
  'typical': Object.freeze({ headroomMul: 1.0, drift: true, floor: false, edgeShift: false, governor: false }),
  'cold-lucky': Object.freeze({ headroomMul: 1.35, drift: false, floor: false, edgeShift: false, governor: false }),
  'hot-unlucky': Object.freeze({ headroomMul: 0.65, drift: true, floor: true, edgeShift: false, governor: false }),
  'angry-governor': Object.freeze({ headroomMul: 1.0, drift: true, floor: false, edgeShift: false, governor: true }),
  'drifty': Object.freeze({ headroomMul: 1.0, drift: true, floor: false, edgeShift: true, governor: false }),
});

const REDRAW_CAP = 20; // подряд отказов одной карты → ГРОМКИЙ отказ, не тихий цикл (P70-AC2)

// =================================================================================================
// 2. Генерация одной карты — чистая функция от (семя, A, архетип)
// =================================================================================================

/** Один розыгрыш в [lo, hi] из потока. */
const pick = (rng, lo, hi) => lo + (hi - lo) * rng();
/** Симметричный множитель 1 ± width·A. */
const mul = (rng, width, A) => 1 + (rng() * 2 - 1) * width * A;

/**
 * Построить карту. Возвращает { ok, card, redraws } либо { ok: false, why, redraws }.
 * ДЕТЕРМИНИЗМ: единственный источник случайности — mulberry32(seed); перевыборка продолжает ТОТ ЖЕ
 * поток, поэтому (seed, A, archetype) → байты файла воспроизводятся всегда (P70-AC1).
 */
export function generateCard({ seed, amplitude = 0.5, archetype = 'typical', dir = 'curves' } = {}) {
  const arch = ARCHETYPES[archetype];
  if (!arch) return { ok: false, why: `нет такого архетипа: ${archetype} (есть: ${Object.keys(ARCHETYPES).join(', ')})` };
  if (!(amplitude >= 0 && amplitude <= 1)) return { ok: false, why: `амплитуда ${amplitude} вне [0,1]` };
  const rng = mulberry32(seed >>> 0);
  const A = amplitude;

  for (let attempt = 0; attempt <= REDRAW_CAP; attempt++) {
    // ─── слой 2: Монте-Карло по осям (слой 1 — центры архетипа) ────────────────────────────────
    const headroomMul = arch.headroomMul * mul(rng, AXES.headroomScale.width, A);
    const headroomShift = (rng() * 2 - 1) * AXES.headroomShiftMv.width * A;
    const scaleMv = A === 0 ? 3.5 : pick(rng, AXES.scaleMv.lo, AXES.scaleMv.hi);
    const noiseMul = mul(rng, AXES.noiseScale.width, A);
    const limitW = A === 0 ? 300 : AXES.limitW.values[Math.floor(rng() * AXES.limitW.values.length)];
    const staticW = 40.669 * mul(rng, AXES.packagePct.width, A);
    const perMhzVolt2 = 0.091223 * mul(rng, AXES.packagePct.width, A);
    const drift = arch.drift ? (A === 0 ? -1.7 : pick(rng, AXES.tableDriftMhzPerC.lo, AXES.tableDriftMhzPerC.hi)) : null;
    const edgeShift = arch.edgeShift ? pick(rng, AXES.edgeShiftMvPerC.lo, AXES.edgeShiftMvPerC.hi) : null;
    const boost = A === 0 ? 2 : AXES.boostSteps.values[Math.floor(rng() * AXES.boostSteps.values.length)];
    const governor = arch.governor ? Math.round(pick(rng, AXES.governorMhz.lo, AXES.governorMhz.hi)) : null;
    const floorShare = arch.floor ? pick(rng, AXES.floorDepthShare.lo, AXES.floorDepthShare.hi) : null;
    const noiseSeed = Math.floor(rng() * 0xFFFFFFFF);

    // ─── сборка: геометрия ОБРАЗЦА (консервативно, риск 3 плана), край и физика — выборкой ──────
    const d = deriveCardFromCurves({
      dir,
      name: `virtual-gpu_${seed}`,
      fiction: {
        noiseSeed,
        noiseAmplitudeMv: 8 * noiseMul,
        driftMaxMv: 20 * noiseMul,
        scaleMv,
        anchors: scaledAnchors(headroomMul, headroomShift),
      },
    });
    if (!d.ok) return { ok: false, why: d.why, redraws: attempt };
    const card = d.card;

    card.physics = {
      origin: `СГЕНЕРИРОВАНО: семя ${seed} · амплитуда ${A} · архетип ${archetype} — карточки ширин в card-generator.AXES`,
      power: { limitW, staticW: round3(staticW), perMhzVolt2: round6(perMhzVolt2) },
      ...(drift !== null ? { tableDriftMhzPerC: round3(drift) } : {}),
      ...(edgeShift !== null ? { edgeShift: { mvPerC: round3(edgeShift), refC: 41 } } : {}),
      ...(boost ? { boostStepsAboveCeiling: boost } : {}),
      ...(governor !== null ? { governorBelowCeilingMhz: governor } : {}),
      ...(floorShare !== null ? { floor: { baseMv: floorBaseMv(card, floorShare) } } : {}),
    };
    card.provenance = `СГЕНЕРИРОВАНО семенем ${seed}, амплитуда ${A}, архетип ${archetype} — `
      + 'ВЫМЫСЕЛ²: этой карты не существует и как замера; зелёный цикл на ней — утверждение о ЛОГИКЕ движка';

    const chk = validateCard(card);
    if (chk.ok) return { ok: true, card, redraws: attempt, lastRefusal: null };
    // Перевыборка продолжает тот же поток — детерминизм сохранён; причина копится для сводки.
    if (attempt === REDRAW_CAP) {
      return { ok: false, why: `ГЕНЕРАТОР СДАЛСЯ после ${REDRAW_CAP} перевыборок: ${chk.field} — ${chk.why}`, redraws: attempt };
    }
  }
  return { ok: false, why: 'недостижимо', redraws: REDRAW_CAP };
}

/** Якоря запаса образца, отмасштабированные и сдвинутые; форма кривой — образца (центр честный). */
function scaledAnchors(mulK, shiftMv) {
  const BASE = [
    { mhz: 180, belowStockMv: 0 }, { mhz: 500, belowStockMv: 110 }, { mhz: 1100, belowStockMv: 120 },
    { mhz: 1700, belowStockMv: 80 }, { mhz: 2000, belowStockMv: 90 }, { mhz: 2400, belowStockMv: 150 },
    { mhz: 2842, belowStockMv: 180 }, { mhz: 3090, belowStockMv: 200 },
  ];
  return BASE.map((a) => ({ mhz: a.mhz, belowStockMv: Math.max(0, a.belowStockMv * mulK + (a.belowStockMv > 0 ? shiftMv : 0)) }));
}

/** База пола: доля глубины запаса на верхней частоте — пол «съедает» часть спуска. */
function floorBaseMv(card, share) {
  // Кривая стока НЕ отсортирована по частоте (оплачено первым красным этого набора: «верх» с хвоста
  // массива оказался 180 МГц) — верх ищется МАКСИМУМОМ, не позицией.
  const top = card.stockCurve.reduce((m, r) => (r.mhz > m.mhz ? r : m));
  const edge = card.fiction.edge.reduce((m, r) => (r.mhz > m.mhz ? r : m));
  const depth = top.voltageMv - edge.edgeMv;
  return Math.round(edge.edgeMv + depth * share);
}

const round3 = (x) => Math.round(x * 1000) / 1000;
const round6 = (x) => Math.round(x * 1e6) / 1e6;

// =================================================================================================
// 3. Пакет и CLI
// =================================================================================================

export function generateBatch({ count = 100, amplitude = 0.5, seedBase = 1000, dir = 'curves' } = {}) {
  const names = Object.keys(ARCHETYPES);
  const out = { ok: 0, bad: 0, redraws: 0, byArchetype: {}, spans: {} };
  const track = (k, v) => { const s = (out.spans[k] ??= { min: Infinity, max: -Infinity }); s.min = Math.min(s.min, v); s.max = Math.max(s.max, v); };
  for (let i = 0; i < count; i++) {
    const archetype = names[i % names.length];
    const r = generateCard({ seed: seedBase + i, amplitude, archetype, dir });
    out.redraws += r.redraws ?? 0;
    if (!r.ok) { out.bad++; continue; }
    out.ok++;
    out.byArchetype[archetype] = (out.byArchetype[archetype] ?? 0) + 1;
    track('limitW', r.card.physics.power.limitW);
    track('staticW', r.card.physics.power.staticW);
    if (r.card.physics.tableDriftMhzPerC !== undefined) track('driftMhzPerC', r.card.physics.tableDriftMhzPerC);
    track('scaleMv', r.card.fiction.failure.scaleMv);
  }
  return out;
}

function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  console.log('САМОПРОВЕРКА card-generator — детерминизм, валидность, границы осей; карта не трогается');
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона: посев потока · счётчик перевыборок · строка вымысел²');

  // Хеш ВЫБОРКИ, не этикеток: name, provenance и physics.origin несут СЕМЯ текстом и различали бы
  // карты при мёртвом посеве (вскрыто мутацией посева: 7/0 на мутанте, пока хеш их включал —
  // детектор этикетки, не выборки).
  const sha = (c) => {
    const { name, provenance, ...rest } = c;
    if (rest.physics) { const { origin, ...p } = rest.physics; rest.physics = p; }
    return createHash('sha256').update(JSON.stringify(rest)).digest('hex');
  };
  const a = generateCard({ seed: 42, amplitude: 0.7, archetype: 'hot-unlucky' });
  const b = generateCard({ seed: 42, amplitude: 0.7, archetype: 'hot-unlucky' });
  ok('детерминизм: одно (семя, A, архетип) дважды — байт-идентичная карта (P70-AC1)',
    a.ok && b.ok && sha(a.card) === sha(b.card));
  const c = generateCard({ seed: 43, amplitude: 0.7, archetype: 'hot-unlucky' });
  ok('соседнее семя — ДРУГАЯ карта (генератор не константа)', c.ok && sha(c.card) !== sha(a.card));

  const zero = generateCard({ seed: 7, amplitude: 0, archetype: 'typical' });
  ok('амплитуда 0 — центры архетипа: предел 300 · крутизна 3,5 · дрейф −1,7 (P70-AC3)',
    zero.ok && zero.card.physics.power.limitW === 300
    && zero.card.fiction.failure.scaleMv === 3.5 && zero.card.physics.tableDriftMhzPerC === -1.7);

  const batch = generateBatch({ count: 30, amplitude: 0.8, seedBase: 500 });
  ok('пакет 30 карт: 30/30 валидны, перевыборки СЧИТАЮТСЯ (P70-AC2)',
    batch.ok === 30 && batch.bad === 0 && Number.isFinite(batch.redraws),
    `ok=${batch.ok} bad=${batch.bad}`);
  ok('границы осей держатся на пакете: limitW из списка, дрейф в [−3, −0,5], scaleMv в [2, 6]',
    batch.spans.limitW.min >= 250 && batch.spans.limitW.max <= 350
    && batch.spans.driftMhzPerC.min >= -3 && batch.spans.driftMhzPerC.max <= -0.5
    && batch.spans.scaleMv.min >= 2 && batch.spans.scaleMv.max <= 6);

  ok('происхождение: каждый файл несёт строку «вымысел²» и семя (P70-AC4)',
    /ВЫМЫСЕЛ²/u.test(a.card.provenance) && a.card.provenance.includes('семенем 42')
    && /СГЕНЕРИРОВАНО/u.test(a.card.physics.origin));

  ok('пол hot-unlucky лежит МЕЖДУ краем и стоком верхней частоты (съедает часть спуска, не весь)', (() => {
    const top = a.card.stockCurve.reduce((m, r) => (r.mhz > m.mhz ? r : m));
    const edge = a.card.fiction.edge.reduce((m, r) => (r.mhz > m.mhz ? r : m));
    const f = a.card.physics.floor.baseMv;
    return f > edge.edgeMv && f < top.voltageMv;
  })());

  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const num = (f, d) => { const i = argv.indexOf(f); return i !== -1 ? Number(argv[i + 1]) : d; };
  const str = (f, d) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : d; };
  if (argv.includes('--selftest')) process.exit(cmdSelftest());
  if (argv.includes('--batch')) {
    const r = generateBatch({ count: num('--batch', 100), amplitude: num('--amplitude', 0.5), seedBase: num('--seed', 1000) });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.bad === 0 ? 0 : 1);
  }
  if (argv.includes('--seed')) {
    const seed = num('--seed', 1);
    const r = generateCard({ seed, amplitude: num('--amplitude', 0.5), archetype: str('--archetype', 'typical') });
    if (!r.ok) { console.error(`ОТКАЗ: ${r.why} (перевыборок ${r.redraws})`); process.exit(1); }
    const outDir = str('--out', join('benches', 'cards', 'generated'));
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `virtual-gpu_${seed}.json`);
    writeFileSync(file, `${JSON.stringify(r.card, null, 2)}\n`, 'utf8');
    console.log(r.card.provenance);
    console.log(`ЗАПИСАН: ${file} (перевыборок ${r.redraws})`);
    process.exit(0);
  }
  console.log('Использование: --selftest | --seed N [--amplitude 0..1] [--archetype typical|cold-lucky|hot-unlucky|angry-governor|drifty] [--out dir] | --batch 100 [--amplitude A] [--seed base]');
  process.exit(2);
}
