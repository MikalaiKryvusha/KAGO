// =================================================================================================
// THE REHEARSAL — a REAL sweep over the VIRTUAL card, watched through the dashboard (`plans/20` §4.6)
// =================================================================================================
//
// KAGO-BENCH-OWN — bench's own file; the «no branches on the bench» guard skips it by this mark.
//
// WHAT THE OWNER ASKED FOR, IN HIS WORDS: *«тюнинг виртуальной видеокарты с отображением этого
// процесса в html визуализаторе. Репетиция перед реальным прогоном — но такая, которую глазами в
// визуализаторе видит владелец»*. So this is not a demo of a dashboard: it is a dress rehearsal of
// phase 3, with everything real except the silicon.
//
// ─── WHAT IS REAL HERE AND WHAT IS NOT — the only line that matters when reading the screen ───────
//
//   REAL: `engine.sweepRange` · `runRung` · the write-ahead journal · the tuning-curve document and
//         its only author `closePoint` · the descent ladder, the seeding, the refinement · the whole
//         `stress-tester` verdict stack, including `runBurst` and `decideVerdict`.
//   NOT:  the card. It is `virtual-gpu.mjs` — an invented edge with noise, a probabilistic failure
//         model, and a TELEMETRY MODEL fitted to this project's own four measured thermal rows.
//
// A green run here proves the ENGINE and the WIRING. It proves nothing about the owner's silicon,
// and the page says so on its own face rather than in a comment nobody opens.
//
// ─── WHY THE SECONDS ARE SPENT FOR REAL ───────────────────────────────────────────────────────────
//
// By default the bench does NOT spend the burn's seconds — the seconds belong to the workload
// process, and the workload process is exactly what the bench replaces (`virtual-gpu.mjs`, «ЧАСЫ»).
// A rehearsal is the one case that needs them back: the property being rehearsed is what the OPERATOR
// sees while the run is blocked for ten seconds at a time, and that is unobservable at full speed.
// So `--sustain` seconds are really spent, and the card ticks telemetry inside them.
//
// [TESTED: 2026-08-16 04:0x — the rehearsal itself, watched. `--selftest` covers the wiring offline.]

import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadCard, GOLDEN_CHECKSUM, PROVABILITY_LINE } from './virtual-gpu.mjs';
import { virtualCard } from './virtual-gpu.mjs';
import { curveDocForCard, pointsForCard, makeSweepStepFn } from './trap-suite.mjs';
import { sweepRange, sweepReportLines } from '../engine.mjs';
import { openJournal } from './sweep-journal.mjs';
import { openPulse, clearPulse, PULSE_PATH } from './run-dashboard.mjs';

const CARD_PATH = join('benches', 'cards', 'rtx5070ti.json');
const RUN_DIR = join('runs', 'bench');

/**
 * One rehearsal.
 *
 * @param {object} a
 * @param {number} a.fromMhz   top of the band
 * @param {number} a.toMhz     bottom of the band
 * @param {number} [a.sustain] seconds per stress test — really spent, so the operator can watch
 * @param {boolean} [a.dashboard] feed the gauge the dashboard reads
 */
export async function rehearse({
  fromMhz, toMhz, sustain = 10, seed = 20260816, dashboard = true,
  cardPath = CARD_PATH, pulsePath = PULSE_PATH, onLine = console.log,
} = {}) {
  // `loadCard` answers with a VERDICT, not a card — a profile that failed its validator must not be
  // silently used as one.
  const loaded = loadCard(cardPath);
  if (!loaded.ok) throw new Error(`карта стенда не поднялась: ${loaded.why}`);
  const card = loaded.card;
  const stress = await import('./stress-tester.mjs');
  const golden = { gpu: { driver: card.stamp.driver, vbios: card.stamp.vbios }, args: [], checksum: GOLDEN_CHECKSUM };
  const stampOk = stress.checkGoldenStamp(golden, { probed: true, driver: card.stamp.driver, vbios: card.stamp.vbios }, []);

  // The gauge is opened BEFORE the card, so a window opened early shows «поднимаемся», not a blank.
  const pulse = dashboard
    ? openPulse({
      path: pulsePath,
      source: `виртуальная карта · ${card.card.name}`,
      synthetic: true,
      band: `${fromMhz}…${toMhz} МГц`,
      probeSeconds: sustain,
    })
    : null;

  // THE CARD, WITH ITS SECONDS BOUGHT BACK AND ITS PULSE WIRED. `onTick` fires once per second from
  // INSIDE the burn — the one place the process cannot otherwise speak.
  const vc = virtualCard(card, {
    settleSamples: 0,
    seed,
    burnRealSeconds: sustain > 0,
    onTick: (sample) => pulse?.telemetry(sample),
  });

  // The journal is REAL and it is the record; it lives in this run's own directory because a bench
  // that wrote into the project's production run artefacts would fabricate evidence a later session
  // reads as history (EXP-0025).
  mkdirSync(RUN_DIR, { recursive: true });
  const journal = openJournal({ dir: RUN_DIR });

  const inner = makeSweepStepFn(vc, card, stress, golden, stampOk);
  const runStepFn = async (a) => {
    const r = await inner(a);
    // Between rungs the card COOLS, and the operator should see it cool: the run's idle is as real a
    // part of the picture as its load.
    pulse?.telemetry(vc.telemetry.advance(1, {}));
    return r;
  };

  const startedMs = Date.now();
  const report = await sweepRange({
    curveDoc: curveDocForCard(card, { fromMhz, toMhz }),
    points: pointsForCard(card),
    fromMhz,
    toMhz,
    bandLabel: `${fromMhz}…${toMhz} МГц (репетиция на виртуальной карте)`,
    journal,
    seconds: sustain,
    sustain,
    runStepFn,
    // The document stays in memory: this run must not touch `curves/measured.json`, which is the
    // owner's real card's document and the memory of everything phase 3 will prove.
    saveFn: null,
    onEvent: (e) => {
      pulse?.event(e);
      if (e.kind !== 'rung-start') onLine(`  ${e.text}`);
    },
  });

  pulse?.finish({ ok: report.ok, why: report.ok ? '' : report.why });
  return { report, vc, elapsedMs: Date.now() - startedMs, journalPath: journal.path };
}

// =================================================================================================
// Selftest — the wiring, offline, at full bench speed (no seconds spent)
// =================================================================================================
//
// MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
//   - the engine's events never reach the gauge   → «ПРОВОДКА: пульс получает ход НАСТОЯЩЕГО прогона»
//   - the card's telemetry never reaches it       → «ПРОВОДКА: пульс получает показания карты»
//   - the run writes into the owner's document    → «ПЕСОЧНИЦА: документ владельца не тронут»
export async function selfTest() {
  const results = [];
  const check = (n, cond, why = '', note = '') => results.push({ n, ok: !!cond, why, note });

  const box = join('runs', 'bench-selftest');
  if (existsSync(box)) rmSync(box, { recursive: true, force: true });
  mkdirSync(box, { recursive: true });
  const pulsePath = join(box, 'live.json');

  // THE SANDBOX CHECK IS TAKEN AS A BEFORE/AFTER PAIR, because «the owner's file is fine» asserted
  // against nothing is a block that cannot go red — the tautology class this project already pays for
  // (EXP-0055). The first version of this block said `|| true`; it is written down rather than
  // quietly replaced.
  const witnessed = [
    join('curves', 'measured.json'),
    join('runs', 'sweep', 'journal.jsonl'),
  ].map((p) => ({ p, before: existsSync(p) ? statSync(p).mtimeMs + ':' + statSync(p).size : 'нет файла' }));

  const seen = [];
  const { report } = await rehearse({
    fromMhz: 2842, toMhz: 2820, sustain: 0, dashboard: true, pulsePath, onLine: (l) => seen.push(l),
  });

  const { readPulse } = await import('./run-dashboard.mjs');
  const p = readPulse(pulsePath);
  check('ПРОВОДКА: пульс получает ход НАСТОЯЩЕГО прогона — полоса, ступени, покрытие',
    p !== null && p.run.coverage.total > 0 && p.run.coverage.rungs > 0 && p.run.frequencyMhz !== null,
    JSON.stringify(p?.run ?? null));
  check('ПРОВОДКА: пульс получает показания карты, и они помечены синтетикой',
    p !== null && p.card.clockMhz !== null && p.card.powerW !== null && p.card.synthetic === true,
    JSON.stringify(p?.card ?? null));
  check('ПРОГОН: развёртка дошла до конца полосы и закрыла частоты',
    report.ok === true && report.closed > 0, `${report.stoppedBy ?? ''} ${report.why}`);
  const touched = witnessed.filter(({ p, before }) => {
    const after = existsSync(p) ? statSync(p).mtimeMs + ':' + statSync(p).size : 'нет файла';
    return after !== before;
  });
  check('ПЕСОЧНИЦА: документ владельца и ПРОДАКШЕН-журнал не тронуты (сверка до/после)',
    touched.length === 0, `тронуто: ${touched.map((t) => t.p).join(', ')}`,
    `под наблюдением ${witnessed.length} файла`);

  clearPulse(pulsePath);
  rmSync(box, { recursive: true, force: true });

  const failed = results.filter((r) => !r.ok).length;
  return { ok: failed === 0, results, failed };
}

// =================================================================================================
// CLI
// =================================================================================================

async function main(argv) {
  if (argv.includes('--selftest')) {
    const r = await selfTest();
    for (const x of r.results) console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.n}${x.ok ? '' : `\n       причина: ${x.why}`}`);
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА РЕПЕТИЦИИ: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА РЕПЕТИЦИИ: есть расхождения.');
    return r.ok ? 0 : 1;
  }

  const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const fromMhz = Number(arg('from'));
  const toMhz = Number(arg('to'));
  if (!Number.isFinite(fromMhz) || !Number.isFinite(toMhz) || toMhz > fromMhz) {
    console.error('ОШИБКА: нужны --from <МГц> и --to <МГц>, причём --to не выше --from.');
    console.error('        Пример: npm run bench -- --sweep --from 2842 --to 2820 --sustain 3');
    return 2;
  }
  const sustain = Number(arg('sustain', 10));

  console.log('РЕПЕТИЦИЯ ПЕРЕД ЖИВЫМ ПРОГОНОМ — настоящий движок, виртуальная карта');
  console.log('');
  console.log(`  ПОЛОСА:    ${fromMhz}…${toMhz} МГц`);
  console.log(`  КАРТА:     ${CARD_PATH} — ВЫМЫСЕЛ. Ни одной записи в настоящую видеокарту не будет`);
  console.log(`  ТЕСТ:      ${sustain} с на ступень, и эти секунды тратятся ПО-НАСТОЯЩЕМУ —`);
  console.log('             иначе смотреть было бы не на что');
  console.log(`  ЖУРНАЛ:    ${join(RUN_DIR, 'journal.jsonl')} (песочница репетиции)`);
  console.log(`  ДАШБОРД:   ${PULSE_PATH} · окно — npm run dashboard`);
  console.log('');

  const { report, elapsedMs } = await rehearse({ fromMhz, toMhz, sustain });
  for (const line of sweepReportLines(report)) console.log(line);
  console.log('');
  console.log(`ВРЕМЯ РЕПЕТИЦИИ: ${(elapsedMs / 1000).toFixed(1)} с`);
  console.log(PROVABILITY_LINE);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
