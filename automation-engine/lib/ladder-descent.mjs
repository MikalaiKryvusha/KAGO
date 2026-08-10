#!/usr/bin/env node
// ladder-descent.mjs — phase 2's search for the Silent Cold point, and the card's power↔performance curve.
//
// Plan anchor (plans/03_epic01_phase2_silent_cold.md §4.5): "Descend the measured ladder from stock,
// not by a search for a failure edge — that is phase 5's job and it needs the NVAPI bridge … Here the
// card stays inside its own stock V/F curve, so every point is a point the card already considers
// safe … Never leave the card locked at the end of a run. Every candidate run ends in
// `resetToFactory()` plus a stable read-back, including on failure."
//
// WHAT IT IS NOT: this is **not** `engine.mjs`. Phase 5's engine searches for a FAILURE EDGE by
// lowering VOLTAGE, needs the NVAPI bridge to see its own control variable, and ships a guardband
// above a measured threshold. This module lowers a CLOCK to points the card itself publishes as
// supported, so every candidate is inside the stock V/F curve and no failure edge is approached. The
// two must never be conflated: one is a walk inside the safe region, the other is a walk toward its
// boundary.
//
// THE SAFETY SHAPE, and it is the reason this is a module rather than fifteen commands by hand:
//
//  1. **The reset is a `finally`, not a step.** Every candidate — including one that throws, and
//     including the run that throws before the load ever starts — is followed by `resetToFactory()`
//     with a stable read-back. A descent that leaves the owner's card pinned at 900 MHz because a
//     capture failed is the exact class of outcome the owner's-machine rule exists to prevent.
//  2. **One writer.** Every write goes through `profile-manager.mjs` (rule R1); this module never
//     calls a GPU-control tool itself. It composes the writer with the meter and owns neither.
//  3. **Clocks come from the card's OWN ladder.** A requested value is snapped to the nearest
//     published point and the snap is PRINTED — a round number a human liked is not a clock this
//     card offers (§4.1).
//
// THE HONEST LIMIT OF THE `finally`, stated rather than implied: a burst runs under `spawnSync`,
// which blocks Node's event loop, so a Ctrl-C arriving mid-burst cannot run the handler until the
// burst returns. A process killed HARD leaves the lock in place. Two things make that survivable and
// both are real: `npm run profile -- --reset` returns the card at any time, and a profile lives in
// volatile GPU memory, so a reboot returns it anyway (MASTER_PLAN.md → заводское состояние).
//
// Usage:
//   node automation-engine/lib/ladder-descent.mjs --points 2400,2100,1800,1500,1200,900 --workload branchy
//   node automation-engine/lib/ladder-descent.mjs --dry-run --points 2400,900     snap and plan, no writes
//   node automation-engine/lib/ladder-descent.mjs --selftest                      the logic, no GPU
//
// [TESTED: 2026-08-10 · 32 selftest blocks with no GPU (the safety shape driven through an injected
// backend and an injected meter), nine mutations each reddening its own block, and six real candidates
// measured on the live card - table in plans/03 §4.5. The card read back at stock after every run.]

import { pathToFileURL } from 'node:url';

import config from '../config.mjs';
import { probeCard, nearestOnLadder, validateProfile } from './profile-store.mjs';
import { nvidiaSmiBackend, apply, resetToFactory, readState } from './profile-manager.mjs';
import { capture, loadRecords, spreadOf, median } from './power-baseline.mjs';

// =================================================================================================
// 1. The candidates
// =================================================================================================

/** A machine receipt carries the owner's local time with its offset, never UTC (AGENT_GUIDE.md). */
function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}

/**
 * Snap a requested clock to the card's own ladder, and say so.
 *
 * Ties go DOWNWARD: this is a descent toward quiet, and when a request sits exactly between two
 * published points the colder one is the one the step is asking for. Stated because a silent tie-break
 * is how a table ends up unreproducible.
 *
 * [TESTED: 2026-08-10 · selftest blocks 1-5; mutation-proved by flipping the tie-break upward]
 */
export function snapToLadder(requestedMhz, ladder) {
  const { below, above } = nearestOnLadder(requestedMhz, ladder);
  if (below === null && above === null) return { ok: false, why: 'лестница пуста' };
  if (below === null) return { ok: true, mhz: above, snapped: above !== requestedMhz, from: requestedMhz };
  if (above === null) return { ok: true, mhz: below, snapped: below !== requestedMhz, from: requestedMhz };
  const pick = (requestedMhz - below) <= (above - requestedMhz) ? below : above;
  return { ok: true, mhz: pick, snapped: pick !== requestedMhz, from: requestedMhz };
}

/**
 * The in-memory profile for one candidate.
 *
 * Candidates are NOT written into `profiles/`: a candidate is a question, and only the answer earns a
 * file (§4.6 stores the chosen profile with its evidence). The stamp is taken from the card in front
 * of us, so R6 refuses the whole descent the moment a driver update lands mid-run.
 *
 * The power limit is deliberately `null` — the card's own factory value. Measured in §4.3: saturated,
 * this card draws ~197 W against a 300 W limit, so `-pl` cannot bite on this workload at all and
 * moving it would add a second variable that changes nothing. Silent Cold's reduction has to come
 * from the clock lock, and the descent must therefore vary the clock ALONE.
 *
 * [TESTED: 2026-08-10 · selftest blocks 6-10; mutation-proved twice - a candidate that also moves the
 * power limit, and an invented stamp, each reddening its own block]
 */
export function candidateProfile(mhz, card) {
  return {
    name: `candidate-${mhz}`,
    title: `Кандидат ${mhz} МГц`,
    settings: {
      powerLimitWatts: null,
      graphicsClockLockMhz: { min: mhz, max: mhz },
    },
    stamp: {
      driver: card.driver,
      vbios: card.vbios,
      takenAt: stampNow(),
    },
  };
}

// =================================================================================================
// 2. Proving the lock where the proof exists — under load
// =================================================================================================

/**
 * Did the card actually take the lock?
 *
 * Measured 2026-08-10, and it corrected a design assumption the plan carried: at IDLE a high lock is
 * invisible (the clock wanders wherever idle management puts it — 1260, 1717, 1935, 1980 observed for
 * four different requests). Under LOAD the same lock is dead constant. So this is where the proof
 * lives, and `apply()` is called with `verifyLock: 'deferred'` precisely so the two are not confused.
 *
 * TWO CONDITIONS, and the first is the one that means "locked" (EXP-0014 — a value that stops VARYING
 * is the lock; a status field is not):
 *   1. the clock is CONSTANT across the loaded samples, to within one ladder step;
 *   2. it sits within one ladder step of what was requested.
 *
 * The tolerance is the card's measured delivery granularity, not a fudge factor: asked for 2400 it
 * delivers 2392, asked 2392 it delivers 2385, asked 1800 it delivers 1792 — always the requested point
 * or its lower neighbour, with ZERO throttle reasons active. Anything outside that is a refusal.
 *
 * [TESTED: 2026-08-10 · selftest blocks 18-24 on injected records; mutation-proved three times (the
 * constancy check, the distance check, the no-samples refusal). Grounded in the live runs above]
 */
export function verifyLockUnderLoad(record, requestedMhz, tolerance = config.LOCK_DELIVERY_TOLERANCE_MHZ) {
  const c = record?.medians?.loaded?.['clocks.gr'];
  if (!c || c.median === null) return { ok: false, why: 'под нагрузкой не снято ни одной пробы частоты', delivered: null };
  const spread = c.max - c.min;
  if (spread > tolerance) {
    return {
      ok: false,
      delivered: c.median,
      why: `частота под нагрузкой ГУЛЯЛА ${c.min}…${c.max} МГц (размах ${spread} > ${tolerance}) — это не фиксация`,
    };
  }
  const off = c.median - requestedMhz;
  if (Math.abs(off) > tolerance) {
    return {
      ok: false,
      delivered: c.median,
      why: `просили ${requestedMhz} МГц, карта выдала ${c.median} (разница ${off} > ${tolerance} МГц — шире её собственного шага лестницы)`,
    };
  }
  return { ok: true, delivered: c.median, off, why: off === 0 ? 'выдано ровно столько, сколько просили' : `выдано ${c.median} вместо ${requestedMhz} — на ${Math.abs(off)} МГц ниже, в пределах одного шага лестницы` };
}

// =================================================================================================
// 3. The descent
// =================================================================================================

/**
 * Walk the candidates, measuring each, and return the table.
 *
 * @returns {Promise<{rows:Array, aborted:object|null}>}
 */
export async function descend({
  points,
  workload = 'branchy',
  seconds = 30,
  sustain = 30,
  labelPrefix = 'cold',
  card,
  backend = nvidiaSmiBackend(),
  // The meter, as a SEAM. Injecting it is what lets the safety shape below be proven without a GPU:
  // the selftest drives a capture that throws and demands the card was released anyway. A branch that
  // can only be exercised by breaking real hardware is a branch nobody ever exercises.
  captureFn = capture,
  timing = {},
  onRow = null,
} = {}) {
  const rows = [];
  let aborted = null;

  for (const mhz of points) {
    const profile = candidateProfile(mhz, card);
    const refusals = validateProfile(profile, { card });
    if (refusals.length) {
      rows.push({ mhz, error: refusals.map((r) => `${r.field}: ${r.why}`).join(' · ') });
      continue;
    }

    let applied = null;
    let record = null;
    let error = null;
    try {
      // THE WRITE. Its rollback is the `finally` below, and it exists before this line runs.
      applied = await apply(backend, profile, { card, timing, verifyLock: 'deferred' });
      record = await captureFn({
        workload, seconds, sustain,
        label: `${labelPrefix}_${mhz}`,
        profile: profile.name,
      });
      // The lock was COMMANDED before the load and is PROVED here, where the evidence exists.
      // A candidate whose lock cannot be proved is not a slower candidate — it is no measurement.
      const proof = verifyLockUnderLoad(record, mhz);
      if (!proof.ok) throw new Error(`фиксация не подтвердилась под нагрузкой: ${proof.why}`);
      record.lockDelivered = proof.delivered;
      record.lockProof = proof.why;
    } catch (e) {
      error = e;
    } finally {
      // §4.5: never leave the card locked — including on failure, including on the failure of the
      // failure. `knownLockMhz` is passed only when WE locked it, so the release is PROVED rather
      // than reported (the clock must leave the point we pinned it to).
      try {
        await resetToFactory(backend, { knownLockMhz: applied ? applied.lockedTo : null, timing });
      } catch (e2) {
        // A failed reset is the one outcome that must stop the whole descent: continuing would stack
        // a second lock on a card that never left the first.
        aborted = { mhz, why: `ОТКАТ ПРОВАЛИЛСЯ: ${e2.message}` };
      }
    }

    const row = record
      ? {
        mhz,
        verdict: record.verdict,
        watts: record.medians.loaded['power.draw.instant'].median,
        celsius: record.medians.loaded['temperature.gpu'].median,
        fan: record.medians.loaded['fan.speed'].median,
        clockSeen: record.medians.loaded['clocks.gr'].median,
        delivered: record.lockDelivered,
        lockProof: record.lockProof,
        util: record.medians.loaded['utilization.gpu'].median,
        opsPerSecond: record.meters ? record.meters.opsPerSecond : null,
        startCelsius: record.startTemperature,
        label: record.label,
      }
      : { mhz, error: error ? error.message : 'замер не состоялся' };

    rows.push(row);
    if (onRow) onRow(row);
    if (aborted) break;
  }

  return { rows, aborted };
}

/**
 * The stock reference the descent is measured against: the median of the stock captures, and the
 * meter's own floor beneath every delta computed from them.
 *
 * Returns null when no stock capture exists — a descent with nothing to compare against still has a
 * table, and inventing a reference would be worse than having none (PHILOSOPHY.md → the three doors).
 *
 * [TESTED: 2026-08-10 · exercised for real against the ten stock captures - it produced the 196.6 W /
 * 1.28 W floor the descent table is measured against]
 */
export function stockReference(prefix = 'stock') {
  const records = loadRecords(prefix).filter((r) => r.profile === null || r.profile === undefined);
  if (!records.length) return null;
  const watts = spreadOf(records, 'power.draw.instant');
  const ops = spreadOf(records, 'opsPerSecond', { from: 'meters' });
  return {
    n: records.length,
    watts: median(records.map((r) => r.medians.loaded['power.draw.instant'].median)),
    celsius: median(records.map((r) => r.medians.loaded['temperature.gpu'].median)),
    fan: median(records.map((r) => r.medians.loaded['fan.speed'].median)),
    clock: median(records.map((r) => r.medians.loaded['clocks.gr'].median)),
    opsPerSecond: median(records.map((r) => (r.meters ? r.meters.opsPerSecond : null))),
    floorWatts: watts ? watts.spread : null,
    floorPriceFraction: ops ? ops.spreadFraction : null,
  };
}

/**
 * One row of the curve: what the point cost and what it bought, with the meter's floor applied.
 *
 * THE OWNER'S FORMULA LIVES HERE (MASTER_PLAN.md → ведущие принципы 4a): power is the CONTROLLED
 * variable, performance is the CURRENCY, and a profile is one value of N. So the row reports the power
 * SAVED and the price PAID as a percentage, and marks any difference thinner than the meter's own
 * floor as «не эффект» rather than letting it read as a measurement.
 *
 * [TESTED: 2026-08-10 · selftest blocks 11-17; mutation-proved by removing the floor gate]
 */
export function priceRow(row, ref) {
  if (!ref || row.error) return null;
  const wattsSaved = ref.watts - row.watts;
  const priceFraction = ref.opsPerSecond && row.opsPerSecond
    ? (ref.opsPerSecond - row.opsPerSecond) / ref.opsPerSecond
    : null;
  return {
    wattsSaved,
    wattsSavedIsEffect: ref.floorWatts === null ? null : Math.abs(wattsSaved) > ref.floorWatts,
    priceFraction,
    priceIsEffect: (priceFraction === null || ref.floorPriceFraction === null)
      ? null : Math.abs(priceFraction) > ref.floorPriceFraction,
  };
}

// =================================================================================================
// 3. Selftest — the logic on injected data, no GPU
// =================================================================================================

/**
 * A card that answers without being one. `clocks.gr` reports the locked point until `-rgc` is called
 * and a wandering value afterwards — which is what makes the release PROVABLE here exactly as it is on
 * the real card (a value that stops varying is the lock; a value that moves is the release, EXP-0014).
 */
function fakeBackend({ lockFails = false, resetFails = false, lockedTo = null } = {}) {
  const calls = [];
  let released = false;
  return {
    name: 'fake',
    calls,
    query(fields) {
      const clock = released ? 1620 : (lockedTo ?? 1620);
      const v = {
        driver_version: '610.88', vbios_version: 'v1',
        'power.limit': '300', 'power.default_limit': '300', 'power.min_limit': '250', 'power.max_limit': '300',
        'clocks.gr': String(clock),
      };
      return Object.fromEntries(fields.map((f) => [f, v[f]]));
    },
    setPowerLimitWatts(w) { calls.push(`pl:${w}`); return { ok: true, status: 0, stdout: '', stderr: '' }; },
    lockGraphicsClocksMhz(min, max) {
      calls.push(`lgc:${min},${max}`);
      if (lockFails) return { ok: false, status: 1, stdout: '', stderr: 'нет прав на -lgc' };
      lockedTo = min;
      return { ok: true, status: 0, stdout: '', stderr: '' };
    },
    resetGraphicsClocks() {
      calls.push('rgc');
      if (resetFails) return { ok: false, status: 1, stdout: '', stderr: 'сброс сломан' };
      released = true;
      return { ok: true, status: 0, stdout: '', stderr: '' };
    },
  };
}

export async function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  const ladder = [180, 187, 195, 1200, 1207, 2842, 2850, 3090];

  ok('частота с лестницы берётся как есть', snapToLadder(2842, ladder).mhz, 2842);
  ok('частота вне лестницы притягивается к ближайшей', snapToLadder(2845, ladder).mhz, 2842);
  ok('притяжение отмечается флагом, а не молча', snapToLadder(2845, ladder).snapped, true);
  ok('ровно посередине — вниз, потому что это спуск к тишине', snapToLadder(1203.5, ladder).mhz, 1200);
  ok('выше вершины лестницы — вершина', snapToLadder(9000, ladder).mhz, 3090);

  const card = {
    driver: '610.88', vbios: 'v1',
    power: { min: 250, max: 300, current: 300, default: 300 },
    ladder: { ok: true, mhz: ladder, rung: 810 },
  };
  const p = candidateProfile(1200, card);
  ok('кандидат не трогает потолок мощности — только частоту', p.settings.powerLimitWatts, null);
  ok('кандидат фиксирует частоту одной точкой', p.settings.graphicsClockLockMhz, { min: 1200, max: 1200 });
  ok('кандидат проходит валидатор формата', validateProfile(p, { card }), []);
  ok('штамп кандидата снят с живой карты, а не выдуман', [p.stamp.driver, p.stamp.vbios], ['610.88', 'v1']);
  ok('штамп кандидата — местное время со смещением, не Z', /[+-]\d\d:\d\d$/.test(p.stamp.takenAt), true);

  // --- the price row and the meter's floor
  const ref = { watts: 196.6, opsPerSecond: 5.1157e10, floorWatts: 1.28, floorPriceFraction: 0.0018 };
  const big = priceRow({ mhz: 1200, watts: 120, opsPerSecond: 3.0e10 }, ref);
  ok('крупная экономия ватт — эффект', big.wattsSavedIsEffect, true);
  ok('крупная цена — эффект', big.priceIsEffect, true);
  ok('сэкономленные ватты считаются от эталона', Number(big.wattsSaved.toFixed(1)), 76.6);
  const tiny = priceRow({ mhz: 2842, watts: 196.2, opsPerSecond: 5.1150e10 }, ref);
  ok('разница тоньше пола прибора — НЕ эффект', tiny.wattsSavedIsEffect, false);
  ok('цена тоньше пола прибора — НЕ эффект', tiny.priceIsEffect, false);
  ok('без эталона строка цены не выдумывается', priceRow({ mhz: 1200, watts: 120 }, null), null);
  ok('строка с ошибкой не даёт цены', priceRow({ mhz: 1200, error: 'x' }, ref), null);

  // --- the lock's proof, which lives under load and nowhere else
  const rec = (med, min, max) => ({ medians: { loaded: { 'clocks.gr': { median: med, min, max, n: 30 } } } });
  ok('частота постоянна и ровно та, что просили -> фиксация доказана',
    verifyLockUnderLoad(rec(1200, 1200, 1200), 1200).ok, true);
  ok('выдано на один шаг лестницы ниже -> доказана, и разница НАЗВАНА',
    [verifyLockUnderLoad(rec(2392, 2392, 2392), 2400).ok, verifyLockUnderLoad(rec(2392, 2392, 2392), 2400).delivered], [true, 2392]);
  ok('дрожание в пределах одного шага -> всё ещё фиксация (карта так и делает: 1200/1192)',
    verifyLockUnderLoad(rec(1200, 1192, 1200), 1200).ok, true);
  ok('частота ГУЛЯЛА шире шага -> это не фиксация, а отказ',
    verifyLockUnderLoad(rec(2000, 1200, 2800), 2000).ok, false);
  ok('карта выдала совсем не то, что просили -> отказ, а не «медленный кандидат»',
    verifyLockUnderLoad(rec(1260, 1260, 1260), 2400).ok, false);
  ok('отказ по расхождению называет обе величины',
    /2400/.test(verifyLockUnderLoad(rec(1260, 1260, 1260), 2400).why)
      && /1260/.test(verifyLockUnderLoad(rec(1260, 1260, 1260), 2400).why), true);
  ok('нет проб частоты -> отказ, а не молчаливое согласие',
    verifyLockUnderLoad({ medians: { loaded: {} } }, 1200).ok, false);

  // --- THE SAFETY SHAPE, on a fake card. These three are the reason the module exists as a module.
  const fast = { intervalMs: 1, timeoutMs: 500 };

  const beApplyFails = fakeBackend({ lockFails: true });
  const rApply = await descend({
    points: [1200], card, backend: beApplyFails, timing: fast,
    captureFn: async () => { throw new Error('замер не должен был запуститься'); },
  });
  ok('фиксация не удалась -> карта всё равно отпущена (-rgc вызван)', beApplyFails.calls.includes('rgc'), true);
  ok('фиксация не удалась -> строка несёт ошибку, а не числа', Boolean(rApply.rows[0].error), true);
  ok('фиксация не удалась -> замер не запускался', beApplyFails.calls.some((c) => c.startsWith('lgc')), true);

  const beCaptureFails = fakeBackend({});
  const rCapture = await descend({
    points: [1200], card, backend: beCaptureFails, timing: fast,
    captureFn: async () => { throw new Error('карта сорвалась посреди замера'); },
  });
  ok('ЗАМЕР УПАЛ -> карта всё равно отпущена, это и есть finally',
    beCaptureFails.calls.filter((c) => c === 'rgc').length >= 1, true);
  ok('замер упал -> строка несёт ошибку', rCapture.rows[0].error, 'карта сорвалась посреди замера');
  ok('замер упал -> спуск не объявлен прерванным (откат-то сработал)', rCapture.aborted, null);

  const beResetFails = fakeBackend({ resetFails: true });
  const rReset = await descend({
    points: [1200, 900], card, backend: beResetFails, timing: fast,
    captureFn: async () => { throw new Error('неважно'); },
  });
  ok('ОТКАТ не удался -> спуск прерван, а не продолжен на второй точке', rReset.rows.length, 1);
  // Null-safe on purpose: a block that THROWS when its expectation is unmet reports nothing at all,
  // and the suite then dies instead of naming the broken guarantee. Found by the mutation run — two
  // mutations crashed this suite rather than reddening their block (EXP-0016: a crashed verifier is
  // not a green verifier, and it is not a useful red one either).
  ok('ОТКАТ не удался -> прерывание названо с точкой и причиной',
    [rReset.aborted?.mhz ?? null, /ОТКАТ ПРОВАЛИЛСЯ/.test(rReset.aborted?.why ?? '')], [1200, true]);

  return { ok: results.every((r) => r.ok), results };
}

// =================================================================================================
// 4. CLI
// =================================================================================================

function parseArgs(argv) {
  const o = { points: null, workload: 'branchy', seconds: 30, sustain: 30, selftest: false, dryRun: false, prefix: 'cold', stock: 'stock' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--selftest') o.selftest = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--points') o.points = String(argv[++i]).split(',').map((x) => Number(x.trim()));
    else if (a === '--workload') o.workload = argv[++i];
    else if (a === '--seconds') o.seconds = Number(argv[++i]);
    else if (a === '--sustain') o.sustain = Number(argv[++i]);
    else if (a === '--prefix') o.prefix = argv[++i];
    else if (a === '--stock') o.stock = argv[++i];
    else throw new Error(`неизвестный флаг: ${a}`);
  }
  if (!o.selftest && (!o.points || !o.points.length || o.points.some((x) => !Number.isFinite(x)))) {
    throw new Error('нужен список точек: --points 2400,2100,1800');
  }
  return o;
}

function fmt(n, digits = 1) { return n === null || n === undefined ? '—' : Number(n).toFixed(digits); }

async function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`ОШИБКА: ${e.message}`); return 2; }

  if (o.selftest) {
    const r = await selfTest();
    for (const x of r.results) {
      console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok ? '' : `  -> получено ${JSON.stringify(x.got)}, ждали ${JSON.stringify(x.want)}`}`);
    }
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА: есть расхождения.');
    return r.ok ? 0 : 1;
  }

  // `probeCard()` already resolved the ladder — take it, do not re-derive it (EXP-0013: a second
  // copy of a list is a pair that drifts).
  const card = probeCard();
  if (!card.ladder.ok) { console.error(`ОШИБКА: лестница частот недоступна — ${card.ladder.why}`); return 1; }
  const ladder = card.ladder;

  const snapped = o.points.map((p) => snapToLadder(p, ladder.mhz));
  console.log(`КАРТА: драйвер ${card.driver} · VBIOS ${card.vbios} · потолок ${card.power.current} Вт (заводской ${card.power.default})`);
  console.log(`ЛЕСТНИЦА: ${ladder.mhz.length} точек ${ladder.mhz[0]}…${ladder.mhz[ladder.mhz.length - 1]} МГц`);
  console.log(`КАНДИДАТЫ: ${snapped.map((s) => (s.snapped ? `${s.from}→${s.mhz}` : `${s.mhz}`)).join(' · ')} МГц`);
  console.log('ОТКАТ: resetToFactory() (-rgc + заводской потолок) после КАЖДОГО кандидата, в finally — включая падение.');
  console.log('       В любой момент вручную: npm run profile -- --reset');

  const ref = stockReference(o.stock);
  if (ref) {
    console.log(`ЭТАЛОН СТОКА (${ref.n} замеров): ${fmt(ref.watts)} Вт · ${fmt(ref.celsius, 0)} °C · вент ${fmt(ref.fan, 0)} % · `
      + `${fmt(ref.clock, 0)} МГц · ${ref.opsPerSecond.toExponential(3)} операций/с`);
    console.log(`ПОЛ ПРИБОРА: ${fmt(ref.floorWatts, 2)} Вт · цена ${fmt(100 * ref.floorPriceFraction, 2)} % — тоньше этого не эффект.`);
  } else {
    console.log(`ЭТАЛОНА СТОКА НЕТ (искал «${o.stock}*» в runs/power) — таблица будет без дельт.`);
  }

  if (o.dryRun) { console.log(''); console.log('СУХОЙ ПРОГОН: в карту ничего не записано.'); return 0; }

  console.log('');
  const { rows, aborted } = await descend({
    points: snapped.map((s) => s.mhz),
    workload: o.workload, seconds: o.seconds, sustain: o.sustain,
    labelPrefix: o.prefix, card,
    onRow: (row) => {
      if (row.error) { console.log(`  ${String(row.mhz).padStart(4)} МГц — ОШИБКА: ${row.error}`); return; }
      const pr = priceRow(row, ref);
      const got = row.delivered !== undefined && row.delivered !== row.mhz ? `(выдано ${row.delivered}) ` : '';
      console.log(`  ${String(row.mhz).padStart(4)} МГц ${got}· ${row.verdict} · ${fmt(row.watts)} Вт · ${fmt(row.celsius, 0)} °C · `
        + `вент ${fmt(row.fan, 0)} % · ${row.opsPerSecond.toExponential(3)} оп/с`
        + (pr ? ` · −${fmt(pr.wattsSaved)} Вт${pr.wattsSavedIsEffect === false ? ' (не эффект)' : ''}`
          + ` · цена −${fmt(100 * pr.priceFraction)} %${pr.priceIsEffect === false ? ' (не эффект)' : ''}` : ''));
    },
  });

  const final = readState(nvidiaSmiBackend());
  console.log('');
  console.log(`КАРТА ПОСЛЕ СПУСКА: ${final.powerLimitW} Вт (заводской ${final.powerDefaultW}) · частота ${final.clockMhz} МГц`);
  if (aborted) {
    console.error(`СПУСК ПРЕРВАН на ${aborted.mhz} МГц — ${aborted.why}`);
    console.error('ВЕРНИТЕ КАРТУ ВРУЧНУЮ: npm run profile -- --reset');
    return 1;
  }
  return rows.some((r) => r.error) ? 1 : 0;
}

// T9 — a module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
