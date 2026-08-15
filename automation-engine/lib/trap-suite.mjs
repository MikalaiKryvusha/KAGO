// =================================================================================================
// TRAP SUITE — the bench proves itself RED before anyone trusts its green (epic 03 phase 3,
// `plans/19` §4.1 and §4.7)
// =================================================================================================
//
// WHAT THIS IS FOR, IN ONE SENTENCE: a bench that cannot fail is a bench that certifies nothing, so
// every trap card here must make a WRONG engine visibly wrong and leave the RIGHT one alone. A trap
// that stays green either way is deleted, not kept (`plans/19` B3-AC2).
//
// THE ENGINE UNDER TEST IS THE REAL ONE. This suite calls `engine.searchEdge` — the same function the
// owner's card is driven by — through its own injected `runStepFn` seam. There is no second copy of
// the search here, and no branch anywhere in `engine.mjs` that knows a bench exists (E3-AC1).
//
// ─── WHAT «A WRONG ENGINE» MEANS HERE, NAMED SO NOBODY OVERREADS THE GREEN ────────────────────────
//
// The wrong engine is modelled at the seam this suite owns: a step function whose verdict is ALWAYS
// PASS. That is not a strawman — it is the exact failure `bugs/02` was closed over, where a guard
// fired, was explained away, and the search then walked seven rungs and reported an edge in
// millivolts the card had never been at. An engine that cannot see a failure walks past every edge.
//
// What this suite does NOT model is a wrong LADDER or a wrong bisection; those are mutated in
// `engine --selftest`, which is where they belong.
//
// ─── THE CLASS SPLIT, AND WHY IT IS NOT AN EXCUSE ─────────────────────────────────────────────────
//
// Three of the five traps judge behaviour that does not exist yet: today's engine is the phase-5
// search, with no write-ahead journal, no neighbour seeding, no `lever-limited` verdict and no
// two-hangs stop — all four are `plans/15` deliverables. Their cards and their assertions ship NOW
// and are reported PENDING. A pending row may read «ждёт движка развёртки»; it may never read green.
// That is E3-AC5's rule (no claim about an unrun half) applied inside the epic.
//
// ─── MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016) ─────────────────────────────────────────
//
//   - the wrong engine reads the real verdict     → «T1: НЕПРАВИЛЬНЫЙ движок проходит край насквозь»
//   - a class-B assertion reported OK not pending → «утверждение НАПИСАНО и стоит „ждёт“» (все три)
//   - the deterministic trap hang ignored         → «T2: процесс УМИРАЕТ по-настоящему»
//   - the forced inversion dropped                → «T3: инверсия НАСТОЯЩАЯ»
//
// [TESTED: 2026-08-15 20:2x · `npm run traps` → 22 assertions, 0 failures, 4 honestly pending.
//  T1 is the load-bearing one and it DISCRIMINATES: the right engine stops after 2 rungs, the wrong
//  one walks 13 — on three seeds each, through the REAL `searchEdge`, the REAL `runBurst` and the
//  REAL `decideVerdict`. T2 kills a child process for real at the rung its CARD names (exit 70, no
//  `finally`, the intent written beforehand survived). All four mutations above reddened their own
//  named block and nothing else.
//
//  ⚠️ ONE OF THOSE FOUR DID NOT REDDEN AT FIRST, AND THE HOLE WAS HERE, NOT IN THE MUTATION. The
//  drill built its victim child by resolving `./virtual-gpu.mjs` RELATIVE TO THIS FILE, so a run
//  against a mutated copy of the bench had the child importing the INTACT one: the suite reported
//  green about a module it was not testing. Fixed by importing the bench's own `MODULE_URL` — the
//  child now follows whatever bench this suite actually imported. The general shape is worth more
//  than the fix: **a subprocess that re-imports a module by PATH escapes every substitution its
//  parent made**, so the parent must hand down the module it is really using.]

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import config from '../config.mjs';
import { loadCard, virtualCard, TRAPS, GOLDEN_CHECKSUM, PROVABILITY_LINE, MODULE_URL } from './virtual-gpu.mjs';
import { searchEdge } from '../engine.mjs';

const TRAP_DIR = join('benches', 'cards', 'traps');

/**
 * The step function `searchEdge` drives the card through. This is the ONLY place the bench meets the
 * engine, and it is deliberately thin: write the vector, read what the card now serves, run the load,
 * and let the REAL `stress-tester` say what happened.
 *
 * `alwaysPass` is the wrong engine. It changes ONE thing — the verdict — and nothing else, so a
 * difference in the search's behaviour can only have come from the verdict it read.
 */
export function makeStepFn(vc, card, stress, golden, stampOk, { alwaysPass = false } = {}) {
  return async ({ offsetMhz, capMhz, sustain = 60 }) => {
    const before = vc.oracle.servingVoltageMv(capMhz);
    const w = await vc.curveBackend.writeRaiseAndCap(offsetMhz, capMhz, { cardMaxClockMhz: card.card.maxGraphicsMhz });
    if (!w.ok) return { verdict: null, reason: `запись отвергнута: ${w.why}` };
    const after = vc.oracle.servingVoltageMv(capMhz);
    vc.backend.lockGraphicsClocksMhz(capMhz, capMhz);
    vc.backend.query(['clocks.gr']);

    const burst = stress.runBurst({
      name: 'sdc_fma', args: [], sustainSeconds: sustain, run: (b, a) => vc.oracle.run(b, a),
    });
    const v = stress.decideVerdict({ bursts: [burst], golden, stamp: stampOk, faults: { providers: [], faults: [] } });

    return {
      verdict: alwaysPass ? config.VERDICT.PASS : v.verdict,
      reason: alwaysPass ? 'НЕПРАВИЛЬНЫЙ ДВИЖОК: вердикт подменён на PASS' : v.reason,
      worstShape: 'sdc_fma/sustained',
      // The saving is REAL and read off the card twice, so `refuseWithoutUndervolt` is exercised
      // rather than bypassed — a trap run that silently skipped the project's own stop guard would
      // be testing a search the owner never runs.
      undervolt: { savedMv: Number((before - after).toFixed(1)), capMhz },
      writeShape: 'raise-and-cap',
      capHeldBy: 'кривая',
      deliveredMhz: capMhz,
    };
  };
}

/** One search over one card. Returns what the engine did, in the terms the traps are stated in. */
export async function runSearch(card, { seed, alwaysPass, capMhz = 2842, stress, golden, stampOk }) {
  const vc = virtualCard(card, { settleSamples: 0, seed });
  const out = await searchEdge({
    capMhz,
    point: 95,
    wholeCurve: true,
    writeShape: 'raise-and-cap',
    seconds: 60,
    sustain: 60,
    card: { driver: card.stamp.driver, vbios: card.stamp.vbios },
    runStepFn: makeStepFn(vc, card, stress, golden, stampOk, { alwaysPass }),
  });
  const rungs = out.attempts.filter((a) => a.verdict !== undefined).length;
  const deepest = out.attempts.reduce((d, a) => Math.max(d, a.offsetMhz ?? 0), 0);
  return { out, rungs, deepest, vc };
}

export async function runTrapSuite() {
  const results = [];
  const ok = (n, note = '') => results.push({ n, state: 'OK', note });
  const fail = (n, why) => results.push({ n, state: 'FAIL', why });
  const pending = (n, why) => results.push({ n, state: 'ЖДЁТ', why });
  const check = (n, cond, why = '', note = '') => (cond ? ok(n, note) : fail(n, why));

  const stress = await import('./stress-tester.mjs');

  // ---- 0. every trap card exists on disk, and its class travels inside the file (B3-AC1)
  const cards = new Map();
  for (const t of TRAPS) {
    const path = join(TRAP_DIR, `${t.name}.json`);
    if (!existsSync(path)) { fail(`ЛОВУШКА ${t.name}: файл на месте`, `нет ${path} — прогони --derive-traps`); continue; }
    const r = loadCard(path);
    if (!r.ok) { fail(`ЛОВУШКА ${t.name}: файл годен`, r.why); continue; }
    cards.set(t.name, r.card);
    check(`ЛОВУШКА ${t.name}: класс и назначение записаны В САМОМ файле`,
      r.card.trap?.klass === t.klass && Boolean(r.card.trap?.mustDo) && Boolean(r.card.trap?.otherwise),
      `в файле ${JSON.stringify(r.card.trap ?? null)}`, `класс ${t.klass}`);
  }
  check('ЛОВУШКИ: их пять, и класс каждой назван ДО прогона (B3-AC1)',
    TRAPS.length === 5 && cards.size === 5, `на диске ${cards.size} из ${TRAPS.length}`);

  // ---- 1. T1 — the edge sits above the descent's reach (class A, judged by the REAL searchEdge)
  const t1 = cards.get('T1_edge_above_reach');
  if (t1) {
    const golden = { gpu: { driver: t1.stamp.driver, vbios: t1.stamp.vbios }, args: [], checksum: GOLDEN_CHECKSUM };
    const probed = { probed: true, driver: t1.stamp.driver, vbios: t1.stamp.vbios };
    const stampOk = stress.checkGoldenStamp(golden, probed, []);

    // THE RIGHT ENGINE, on three seeds. Three rather than one because a single seed cannot tell a
    // guard from a coincidence, and this card's edge is sharp precisely so three is enough.
    const right = [];
    for (const seed of [11, 12, 13]) right.push(await runSearch(t1, { seed, alwaysPass: false, stress, golden, stampOk }));
    const worstRight = Math.max(...right.map((r) => r.rungs));
    check('T1: ПРАВИЛЬНЫЙ движок останавливается почти сразу — край прямо под стоком',
      right.every((r) => r.out.firstFail !== null) && worstRight <= 4,
      `ступеней ${right.map((r) => r.rungs).join('/')}, первый отказ ${right.map((r) => r.out.firstFail).join('/')}`,
      `ступеней не больше ${worstRight}`);

    // THE WRONG ENGINE — the same card, the same seeds, one thing changed.
    const wrong = [];
    for (const seed of [11, 12, 13]) wrong.push(await runSearch(t1, { seed, alwaysPass: true, stress, golden, stampOk }));
    const bestWrong = Math.min(...wrong.map((r) => r.rungs));
    check('T1: НЕПРАВИЛЬНЫЙ движок проходит край насквозь — ловушка РАЗЛИЧАЕТ, а не зеленеет всегда',
      bestWrong > worstRight && wrong.every((r) => r.out.firstFail === null),
      `правильный ${worstRight} ступеней, неправильный ${wrong.map((r) => r.rungs).join('/')}`,
      `${worstRight} против ${bestWrong} ступеней`);
  } else fail('T1: карта загружена', 'карты нет на диске');

  // ---- 2. T2 — a real death at a NAMED rung (class A in half; naming it after re-launch is plans/15)
  const t2 = cards.get('T2_hangs_at_a_named_rung');
  if (t2) {
    const hangAt = t2.fiction.failure.hangAtOrBelowMv;
    check('T2: ступень зависания названа В КАРТЕ, а не в коде набора',
      Number.isFinite(hangAt), `hangAtOrBelowMv = ${hangAt}`, `${hangAt} мВ`);

    const drill = await hangDrillOnCard(join(TRAP_DIR, 'T2_hangs_at_a_named_rung.json'), hangAt);
    check('T2: процесс УМИРАЕТ по-настоящему на этой ступени, ни один finally не отработал',
      drill.died && !drill.finallyRan,
      `код ${drill.status}, finally ${drill.finallyRan ? 'ОТРАБОТАЛ' : 'не отработал'}: ${drill.stderr}`);
    check('T2: намерение, записанное ДО обращения к карте, пережило смерть',
      drill.intentSurvived, 'намерения на диске нет — журналу упреждающей записи нечего было бы читать');
    pending('T2 (вторая половина): перезапуск НАЗЫВАЕТ убитую ступень',
      'нужен журнал упреждающей записи — plans/15 §4.4');
  } else fail('T2: карта загружена', 'карты нет на диске');

  // ---- 3. class B — the cards ship, the assertions wait, and they are NEVER green
  for (const t of TRAPS.filter((x) => x.klass === 'B')) {
    const card = cards.get(t.name);
    check(`${t.name}: карта существует и её вымысел годен`, Boolean(card), 'карты нет на диске');
    pending(`${t.name}: ${t.mustDo}`, t.judgedBy);
  }

  // T3 carries one thing worth asserting TODAY: that the inversion it exists for is really there.
  const t3 = cards.get('T3_non_monotone_vmin');
  if (t3) {
    const asc = [...t3.fiction.edge].sort((a, b) => a.mhz - b.mhz);
    const i = asc.findIndex((r) => r.mhz === 2842);
    const drop = i > 0 && i < asc.length - 1 ? Number((asc[i].edgeMv - asc[i + 1].edgeMv).toFixed(1)) : 0;
    const rung = t3.voltageGridMv[1] - t3.voltageGridMv[0];
    check('T3: инверсия НАСТОЯЩАЯ — частота требует больше соседки сверху, и глубже одной ступени',
      drop > rung,
      `${asc[i]?.mhz} МГц требует ${asc[i]?.edgeMv} мВ против ${asc[i + 1]?.edgeMv} у ${asc[i + 1]?.mhz} МГц`,
      `на ${drop} мВ глубже, ступень ${rung} мВ`);
  }

  // ---- 4. THE GUARD ON THE REPORT ITSELF (B3-AC3). Without it, «pending» is a convention, and a
  // convention is what a weak session quietly turns into a green. The assertion of every class-B trap
  // must be PRESENT and must be PENDING — never absent (it would be forgotten) and never OK (it would
  // be a claim about an engine nobody has run).
  for (const t of TRAPS.filter((x) => x.klass === 'B')) {
    const rows = results.filter((r) => r.n.includes(t.mustDo));
    check(`${t.name}: утверждение НАПИСАНО и стоит «ждёт» — не отсутствует и не зелёное`,
      rows.length > 0 && rows.every((r) => r.state === 'ЖДЁТ'),
      rows.length === 0 ? 'утверждения нет вовсе' : `состояния: ${rows.map((r) => r.state).join(', ')}`);
  }

  return report(results);
}

/**
 * The hang drill on a TRAP card. Same shape as `virtual-gpu.hangDrill` — a child process that really
 * dies — but pointed at a card whose hang is DETERMINISTIC and at a NAMED voltage, which is the half
 * of T2 that today's engine can be judged on.
 */
async function hangDrillOnCard(cardPath, hangAt) {
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { writeFileSync, unlinkSync } = await import('node:fs');
  // THE BENCH THIS SUITE ACTUALLY IMPORTED, not a path spelled out by hand. Spelling it out made the
  // victim child import the intact module during a mutation run, so a mutation that disabled the
  // deterministic trap hang passed unnoticed — the suite was green about a module it was not testing.
  const vgpu = fileURLToPath(MODULE_URL);
  const base = join(tmpdir(), `kago-trap-hang-${process.pid}`);
  const intentPath = `${base}-intent.json`;
  const finallyPath = `${base}-finally.txt`;
  const childPath = `${base}-victim.mjs`;

  const child = `
import { writeFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const m = await import(pathToFileURL(${JSON.stringify(vgpu)}).href);
const [cardPath, intentPath, finallyPath, hangAt] = process.argv.slice(2);
const card = JSON.parse(readFileSync(cardPath, 'utf8'));
const vc = m.virtualCard(card, { settleSamples: 0, seed: 5, allowProcessDeath: true });
// Спускаемся, пока карта не окажется НА названной ступени — глубину не помним, а считаем.
for (let delta = 20; delta <= 1000; delta += 20) {
  const w = await vc.curveBackend.writeRaiseAndCap(delta, 2842, { cardMaxClockMhz: card.card.maxGraphicsMhz });
  if (w.ok && vc.oracle.servingVoltageMv(2842) <= Number(hangAt)) break;
}
vc.backend.lockGraphicsClocksMhz(2842, 2842);
try {
  writeFileSync(intentPath, JSON.stringify({ state: 'intent', mhz: 2842, servingMv: vc.oracle.servingVoltageMv(2842) }));
  for (let i = 0; i < 200; i++) vc.oracle.run('sdc_fma.exe', ['--sustain', '10']);
} finally {
  writeFileSync(finallyPath, 'finally отработал');
}
`;
  writeFileSync(childPath, child);
  const r = spawnSync(process.execPath, [childPath, cardPath, intentPath, finallyPath, String(hangAt)],
    { cwd: process.cwd(), encoding: 'utf8', timeout: 60_000 });
  const out = {
    died: r.status === 70,
    status: r.status,
    finallyRan: existsSync(finallyPath),
    intentSurvived: existsSync(intentPath),
    stderr: (r.stderr || '').split('\n').slice(0, 2).join(' '),
  };
  for (const p of [childPath, intentPath, finallyPath]) { try { unlinkSync(p); } catch { /* уже нет */ } }
  return out;
}

function report(results) {
  for (const r of results) {
    if (r.state === 'OK') console.log(`OK   ${r.n}${r.note ? `  — ${r.note}` : ''}`);
    else if (r.state === 'ЖДЁТ') console.log(`ЖДЁТ ${r.n}\n       почему: ${r.why}`);
    else { console.log(`FAIL ${r.n}`); if (r.why) console.log(`       причина: ${r.why}`); }
  }
  const failed = results.filter((r) => r.state === 'FAIL').length;
  const waiting = results.filter((r) => r.state === 'ЖДЁТ').length;
  console.log(`\nНАБОР ЛОВУШЕК: ${results.length} утверждений, провалов ${failed}, ждут движка развёртки ${waiting}.`);
  console.log('«ЖДЁТ» — это НЕ зелёный. Утверждение написано и будет прогнано, когда plans/15 даст движок развёртки.');
  console.log(PROVABILITY_LINE);
  return { total: results.length, failed, waiting };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runTrapSuite()
    .then((r) => process.exit(r.failed ? 1 : 0))
    .catch((e) => { console.error(e); process.exit(1); });
}
