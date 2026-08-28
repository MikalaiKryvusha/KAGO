#!/usr/bin/env node
// twin-assembly.mjs — СБОРКА «--card virtual»: живой путь развёртки на цифровом двойнике
// (эпик 59 фаза 3, `plans/62`; опись швов — `researches/23`).
//
// ЧТО ЭТО. Одно место, где швы E1–E10 живого пути получают виртуальную сторону: документ кривой и
// журнал зависаний — в песочнице стенда, устройство порта runStep — поверх `virtualCard()`,
// всадники (судья фьюза + проба) — с журналами в песочницу. `engine --sweep --card virtual` берёт
// отсюда готовую сборку и НЕ меняет ни одной строки `sweepRange` (R16a: движок — композитор).
//
// ИНВАРИАНТЫ ЭПИКА 59, КОТОРЫЕ ДЕРЖИТ ИМЕННО ЭТОТ ФАЙЛ:
//   I1 — виртуальный прогон не касается живой карты (ни одного NVAPI/NVML/nvidia-smi вызова),
//        `curves/measured.json`, боевого журнала `runs/sweep/`, боевой папки `runs/death-watch/`.
//        Проверяется КОМАНДОЙ: `--smoke` снимает отпечаток всех трёх до и после (EXP-0025 — след
//        двойника в настоящей форензике это худший класс проекта).
//   I2 — двойник НЕ МЯГЧЕ живого пути: вердикты судит НАСТОЯЩИЙ `decideVerdict` через НАСТОЯЩИЙ
//        `runBurst` (шов `oracle.run`, B2-AC7); сверка записи — НАСТОЯЩИЕ `pollUntilApplied` +
//        `classifyWriteFailure`; закрепление/граница — НАСТОЯЩИЙ `profile-manager.apply` поверх
//        бэкенда двойника. Устройство сборки не приносит своей арифметики (EXP-0134).
//   I3 — печатается строка канона: зелёный на виртуалке — утверждение о ЛОГИКЕ, не о кремнии.
//   I4 — дефолт живой: без `--card virtual` эта сборка вообще не импортируется.
//
// ПОЧЕМУ ДОКУМЕНТ СТОКОВО-СВЕЖИЙ, А НЕ КОПИЯ `curves/measured.json` (P62-AC3): края живого
// документа — заработанные прожигами знания; стенд, унаследовавший их, репетировал бы не поиск, а
// чтение чужих ответов.
//
// [TESTED: 2026-08-28 · `--smoke`: полоса на двойнике от старта до отчёта, отпечаток I1 совпал]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BENCH_RUNS = join(ROOT, 'benches', 'runs');
const DEFAULT_CARD_FILE = join(ROOT, 'benches', 'cards', 'rtx5070ti.json');

/** Локальный ISO-штамп с поясом машины — форма расписок проекта (EXP-0012: UTC уже врал). */
function localIso(d = new Date()) {
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + `${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

/**
 * Собрать сборку двойника: устройство порта, адреса документа/журнала, всадников и песочницу.
 *
 * Документ и журнал двойника ЖИВУТ МЕЖДУ ПРОГОНАМИ (`benches/runs/virtual-<профиль>*`): пол
 * зависания, который двойник заработал вчера, обязан останавливать его и сегодня — иначе журнал
 * упреждающей записи репетируется без своей главной работы. Журналы всадников — в каталоге ЭТОГО
 * прогона (`benches/runs/twin-<штамп>/`).
 */
export async function makeTwinAssembly({
  cardFile = DEFAULT_CARD_FILE,
  seed = 20260828,
  nowIso = null,
  // Классы отказов устройства (C1 · C4 · C7 · applyWrite) — сквозные параметры `virtualCard`:
  // фаза 4 эпика 59 (смерти по профилям) и самопроверка ниже включают их адресно, боевой смоук
  // идёт на честной карте.
  cardOpts = {},
} = {}) {
  const vgpu = await import('./virtual-gpu.mjs');
  const nvapi = await import('./nvapi.mjs');
  const stress = await import('./stress-tester.mjs');
  const pm = await import('./profile-manager.mjs');
  const cs = await import('./curve-store.mjs');

  const loaded = vgpu.loadCard(cardFile);
  if (!loaded.ok) throw new Error(`карта двойника не поднялась (${cardFile}): ${loaded.why}`);
  const card = loaded.card;
  const vc = vgpu.virtualCard(card, { seed, ...cardOpts });

  const stamp = localIso().replace(/[:+]/g, '-');
  const docName = `virtual-${card.name}`;
  const docDir = BENCH_RUNS;
  const journalDir = join(BENCH_RUNS, `${docName}-journal`);
  const runDir = join(BENCH_RUNS, `twin-${stamp}`);
  mkdirSync(journalDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });

  const desc = vc.describe();
  // Тот же словарь полей, которым стенд уже проходит настоящую проверку штампа (vgpu selftest §16).
  const probedCard = {
    probed: true,
    driver: desc.driver,
    vbios: desc.vbios,
    ladder: desc.ladder,
    power: desc.power,
    maxGraphicsMhz: desc.maxGraphicsMhz,
  };

  /** Документ двойника: догрузить существующий или посеять СТОКОВО-свежий из словарей карты. */
  const loadDoc = () => {
    const have = cs.loadCurveDoc({ name: docName, dir: docDir });
    if (have) return have;
    const doc = cs.initFromCard({
      frequencyGrid: { values: [...card.frequencyGridMhz] },
      tablePoints: vc.curveBackend.points(),
      card: { maxGraphicsMhz: card.card.maxGraphicsMhz },
      stamp: { driver: desc.driver, vbios: desc.vbios },
      tempC: vc.telemetry.read().tempC,
      nowIso: nowIso ?? localIso(),
    });
    doc.name = docName;
    cs.saveCurveDoc(doc, { name: docName, dir: docDir });
    return cs.loadCurveDoc({ name: docName, dir: docDir });
  };

  // ─── ОРАКУЛ ДВОЙНИКА ЧЕРЕЗ БОЕВОЙ СТЕК ВЕРДИКТА (I2, B2-AC7) ─────────────────────────────────
  // Ровно композиция стенда (`virtual-gpu.mjs` §16 и `trap-suite.mjs`): НАСТОЯЩИЙ `runBurst` с
  // лаунчером двойника, НАСТОЯЩИЙ `decideVerdict`, настоящая проверка штампа. ОДИН прожиг на
  // форму, экспозиция — в секундах модели отказа (B2-AC3): боевой цикл `stressTest` меряет
  // ВРЕМЯ СТЕНЫ, которого у двойника нет по построению (см. шапку `burnRealSeconds`).
  const goldenFor = (args) => ({
    gpu: { driver: desc.driver, vbios: desc.vbios },
    args,
    checksum: card.fiction?.goldenChecksum ?? vgpu.GOLDEN_CHECKSUM,
  });
  const twinStressTest = async ({
    name = 'sdc_fma', seconds = 10, sustain = 0, args = [], onBurst = null,
  } = {}) => {
    const golden = goldenFor(args);
    const stampOk = stress.checkGoldenStamp(golden, probedCard, args);
    const burst = stress.runBurst({ name, args, sustainSeconds: Math.max(1, sustain || seconds), run: (b, a) => vc.oracle.run(b, a) });
    if (onBurst) onBurst(burst);
    const decision = stress.decideVerdict({ bursts: [burst], golden, stamp: stampOk, faults: { providers: [], faults: [] } });
    return {
      name, seconds, card: probedCard, golden, stamp: stampOk,
      bursts: [burst],
      checksums: [...new Set([burst.checksum])],
      meters: null,
      faults: { providers: [], faults: [], events: [] },
      ...decision,
    };
  };

  /** Виртуальный сторож записи: чистая расписка в памяти — карты, которую он мог бы держать, нет. */
  const recover = async () => ({ found: false });

  // ─── УСТРОЙСТВО ПОРТА ФАЗЫ 2 — та же поверхность, что живой адаптер в `runStep` ───────────────
  const CURVE_POINTS = nvapi.CLK_VF_POINT_COUNT - 1;
  let samplerN = 0;
  const device = {
    recover,
    arm: ({ what }) => ({ guardPid: process.pid, what, beat: () => {}, disarm: () => {} }),
    open: () => ({ nv: { virtual: true, card: card.name }, handle: 0n }),
    close: () => { vc.curveBackend.close(); },
    readVfOffsets: () => {
      const offsets = vc.curveBackend.readOffsetsSync();
      return { ok: true, nonZero: offsets.filter((o) => o !== 0).length, offsets };
    },
    readVfCurve: () => ({ ok: true, points: vc.curveBackend.points() }),
    // Контракт живого чтения «после записи»: две подряд согласные пробы. Недоустоявшаяся таблица
    // двойника (класс C1) честно тратит пробы здесь же.
    readVfCurveStable: () => {
      let prev = null;
      for (let i = 0; i < 12; i++) {
        const points = vc.curveBackend.readCurveSync();
        const sig = JSON.stringify(points.map((p) => p.freqKhz));
        if (prev !== null && sig === prev) return { ok: true, settled: true, points, probes: i + 1 };
        prev = sig;
      }
      return { ok: true, settled: false, points: vc.curveBackend.readCurveSync(), why: 'таблица двойника не устоялась за 12 проб' };
    },
    // Запись вектора: держит УСТРОЙСТВО двойника (классы C4/C7/applyWrite — его модель), а сверку
    // и классификацию делает БОЕВОЙ код (`pollUntilApplied` + `classifyWriteFailure`) — вторая
    // арифметика не заводится (I2). Возвращаемая форма — форма `nvapi.writeCurve`.
    writeCurve: (_nv, _h, offsetsMhz) => {
      const asArray = Array.isArray(offsetsMhz)
        ? offsetsMhz
        : Array.from({ length: CURVE_POINTS }, () => offsetsMhz);
      const requestedKhz = Array.from({ length: CURVE_POINTS }, (_, p) => Math.round((asArray[p] ?? 0) * 1000));
      const w = vc.curveBackend.holdOffsetsSync(asArray);
      const failed = w.ok ? 0 : (w.failed ?? CURVE_POINTS);
      const failures = w.ok ? [] : (w.failures ?? []);
      const read = () => {
        const offsets = vc.curveBackend.readOffsetsSync().map((o) => Math.round(o * 1000));
        return { ok: true, offsets, raw: Buffer.from(offsets.join(',')) };
      };
      const back = nvapi.pollUntilApplied(read, requestedKhz, CURVE_POINTS, { maxSamples: 6, gapMs: 0 });
      const failure = nvapi.classifyWriteFailure({
        requested: requestedKhz,
        held: back.heldKhz,
        failedCalls: failed,
        failedAddresses: failures.map((f) => f.point),
        settled: back.settled,
        readWhy: back.why ?? null,
      });
      return {
        written: CURVE_POINTS - failed, failed, failures, requestedKhz,
        ok: failure === null, verified: true,
        heldKhz: back.heldKhz, settled: back.settled, probes: back.probes,
        mismatches: failure?.mismatches ?? 0,
        failureClass: failure?.class ?? null,
        why: failure ? `${failure.class} — ${failure.name}: ${failure.why}` : undefined,
      };
    },
    writeVfOffset: (_nv, _h, point, offsetKhz) => {
      const offsets = vc.curveBackend.readOffsetsSync();
      offsets[point] = offsetKhz / 1000;
      const w = vc.curveBackend.holdOffsetsSync(offsets);
      return { ok: w.ok, why: w.why };
    },
    zeroCurve: () => {
      vc.curveBackend.zeroCurveSync();
      const remaining = vc.curveBackend.readOffsetsSync().filter((o) => o !== 0).length;
      return { ok: remaining === 0, failed: 0, remainingNonZero: remaining };
    },
    readTempC: () => vc.telemetry.read().tempC,
    clockBackend: async () => vc.backend,
    applyProfile: async (be, profile, opts) => pm.apply(be, profile, opts),
    resetToFactory: async (be, opts) => pm.resetToFactory(be, opts),
    probeCard: async () => probedCard,
    // Свидетель потолка: пробы «под нагрузкой» синтезируются из ВЫДАЧИ двойника в песочницу этого
    // прогона. Пишутся при `kill()` — к этому моменту прожиги отработали, и выдача кремния стоит
    // там, куда её посадила записанная кривая (тот же `runningMhz`, по которому судил оракул).
    startSampler: ({ pinMhz, capMhz, offsetMhz }) => {
      const file = join(runDir, `sampler-${samplerN++}-${pinMhz ? `pin-${pinMhz}` : `cap-${capMhz}`}-${offsetMhz}.jsonl`);
      return {
        file,
        kill: () => {
          const mhz = vc.deliveredNowMhz();
          const lines = Array.from({ length: 12 }, () => JSON.stringify({ 'utilization.gpu': 99, 'clocks.gr': mhz }));
          writeFileSync(file, `${lines.join('\n')}\n`, 'utf8');
        },
      };
    },
    burn: {
      judgeCandidate: (o) => stress.judgeCandidate(o),
      stressTest: (o) => twinStressTest(o),
      runOptionsForShape: (sh, o) => stress.runOptionsForShape(sh, o),
    },
  };

  return {
    vc, card, device, probedCard, recover, loadDoc,
    docName, docDir, journalDir, runDir,
    saveDoc: (d) => cs.saveCurveDoc(d, { name: docName, dir: docDir }),
    canonLine: 'ЦИФРОВОЙ ДВОЙНИК — ВЫМЫСЕЛ (I3): зелёный прогон здесь доказывает ЛОГИКУ движка и '
      + 'проводку живого пути, а не кремний, драйвер или карту владельца.',
    riders: {
      judgeArgs: ['--judge', '--seconds', '600', '--out', join(runDir, 'fuse.jsonl')],
      probeMode: 'beat-sender',
    },
  };
}

// =================================================================================================
// I1 — отпечаток живых артефактов, снимаемый КОМАНДОЙ (P62-AC2)
// =================================================================================================

function sha256(file) {
  if (!existsSync(file)) return 'нет файла';
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16);
}

/** Отпечаток всего, чего виртуальный прогон не смеет коснуться (I1). */
export function liveFingerprint() {
  const deathDir = join(ROOT, 'runs', 'death-watch');
  return {
    measuredSha: sha256(join(ROOT, 'curves', 'measured.json')),
    journalSha: sha256(join(ROOT, 'runs', 'sweep', 'journal.jsonl')),
    deathWatchFiles: existsSync(deathDir) ? readdirSync(deathDir).length : 0,
  };
}

function deliveryLine() {
  const r = spawnSync(process.execPath, [join(HERE, 'curve-store.mjs'), '--progress'], { encoding: 'utf8' });
  const line = (r.stdout ?? '').split(/\r?\n/u).find((l) => l.includes('краёв')) ?? (r.stdout ?? '').trim().split(/\r?\n/u)[0] ?? '';
  return line.trim();
}

async function mainSmoke(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const from = arg('from', '2842');
  const to = arg('to', '2812');
  // 300 мВ, а не 60: придуманный край двойника на верхах лежит ~245 мВ под стоком, и смоук обязан
  // ДОЙТИ до края — иначе репетируется только «предел глубины», а оракул и уточнение края спят.
  const maxDepth = arg('max-depth', '300');

  console.log('СМОУК СБОРКИ «--card virtual» (plans/62 шаг 4): та же команда развёртки, целиком на двойнике.');
  const before = liveFingerprint();
  const lineBefore = deliveryLine();
  console.log(`I1 ДО:    документ ${before.measuredSha} · журнал ${before.journalSha} · runs/death-watch ${before.deathWatchFiles} файлов`);
  console.log(`СТРОКА ДОСТАВКИ ДО:    ${lineBefore}`);

  const engine = join(HERE, '..', 'engine.mjs');
  const r = spawnSync(process.execPath, [engine, '--sweep', '--card', 'virtual',
    '--from', from, '--to', to, '--max-depth', maxDepth], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const log = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const logFile = join(BENCH_RUNS, `twin-smoke-${localIso().replace(/[:+]/g, '-')}.log`);
  mkdirSync(BENCH_RUNS, { recursive: true });
  writeFileSync(logFile, log, 'utf8');

  const after = liveFingerprint();
  const lineAfter = deliveryLine();
  console.log(`ПРОГОН: код ${r.status} · лог ${logFile} (${log.split('\n').length} строк)`);
  for (const l of log.split('\n').filter((l) => /ЦИФРОВОЙ ДВОЙНИК|ПРЕДОХРАНИТЕЛЬ|ПРОБА|полоса|ЗАКРЫТА|ИТОГ|ОШИБКА|ОТКАЗ/u.test(l)).slice(0, 30)) console.log(`  | ${l.trim()}`);
  console.log(`I1 ПОСЛЕ: документ ${after.measuredSha} · журнал ${after.journalSha} · runs/death-watch ${after.deathWatchFiles} файлов`);
  console.log(`СТРОКА ДОСТАВКИ ПОСЛЕ: ${lineAfter}`);

  const clean = before.measuredSha === after.measuredSha
    && before.journalSha === after.journalSha
    && before.deathWatchFiles === after.deathWatchFiles
    && lineBefore === lineAfter;
  console.log(clean
    ? '✅ I1 ДЕРЖИТСЯ: живой документ, боевой журнал и боевая папка всадников не тронуты, строка доставки не сдвинулась.'
    : '🔴 I1 НАРУШЕН: отпечатки разошлись — виртуальный прогон дотянулся до живого пути.');
  return r.status === 0 && clean ? 0 : 1;
}

// =================================================================================================
// Самопроверка — без карты, записи только в песочницу стенда (benches/runs)
// =================================================================================================
//
// АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА (EXP-0016):
//   TA1. `clockNow`: вернуть `runningMhz()` в чтение ПРОСТОЯ (снять burning-ветку)
//        → «ПРОСТОЙ: незакреплённая карта в покое НЕ держит потолок кривой»
//   TA2. `device.writeCurve`: перестать звать боевой классификатор (всегда ok, класс null)
//        → «СВЕРКА: отказ вызова записи доезжает КЛАССОМ боевого классификатора»
//   TA3. `twinStressTest`: судить самому вместо `decideVerdict` (всегда PASS)
//        → «КРАЙ: у края двойника вердикт МЕНЯЕТСЯ» (фейк фазы 2 этого не умел — модель края
//        и есть то, чем сборка отличается от фикстуры)
export async function selfTest() {
  const results = [];
  const ok = (what, got, want) => {
    const g = JSON.stringify(got); const w = JSON.stringify(want);
    results.push({ what, ok: g === w, got, want });
  };

  const vf = await import('./vf-step.mjs');
  const config = (await import('../config.mjs')).default ?? await import('../config.mjs');
  const V = config.VERDICT ?? (await import('../config.mjs')).VERDICT;

  const before = liveFingerprint();
  const asm = await makeTwinAssembly({ seed: 7 });

  // Точка под опыт: самая высокая ступень таблицы, обслуживающая ≤ 2842 МГц.
  const pts = asm.vc.curveBackend.points();
  const POINT = pts.reduce((best, p, i) => (p.mhz <= 2842 && (best < 0 || p.mhz > pts[best].mhz) ? i : best), -1);
  const CAP = pts[POINT].mhz + 30;

  // 1. Счастливый путь: НАСТОЯЩИЙ runStep через устройство сборки, неглубоко — PASS.
  const r1 = await vf.runStep({
    point: POINT, offsetMhz: 30, writeShape: 'raise-and-cap', capMhz: CAP,
    workload: 'sdc_fma', seconds: 1, sustain: 1, device: asm.device,
  });
  ok('СБОРКА: путь записи целиком на модели двойника — вердикт PASS, красных блоков нет',
    [r1.verdict, r1.blocks.filter((b) => !b.ok).length], [V.PASS, 0]);
  ok('СБОРКА: андервольт ИЗМЕРЕН на модели — точка подешевела',
    (r1.undervolt?.savedMv ?? -1) > 0, true);

  // 2. КРАЙ: тот же атом, глубина к придуманному краю — вердикт МЕНЯЕТСЯ (TA3). Ровно это
  //    отличает устройство сборки от фейка фазы 2: там оракул был константой.
  const asmDeep = await makeTwinAssembly({ seed: 7 });
  const r2 = await vf.runStep({
    point: POINT, offsetMhz: 940, writeShape: 'raise-and-cap', capMhz: CAP,
    workload: 'sdc_fma', seconds: 10, sustain: 10, device: asmDeep.device,
  });
  ok('КРАЙ: у края двойника вердикт МЕНЯЕТСЯ — глубокая ступень не PASS, а настоящий отказ оракула',
    r2.verdict !== V.PASS && r2.verdict !== null, true);

  // 3. ПРОСТОЙ (TA1): кривая записана, замка нет — в покое карта НЕ держит потолок кривой,
  //    иначе откат «частота должна уйти» ждал бы вечно (первый смоук повесил ровно это).
  const asmIdle = await makeTwinAssembly({ seed: 7 });
  const nvapi = await import('./nvapi.mjs');
  const vecIdle = nvapi.buildRaiseAndCapVector(asmIdle.vc.curveBackend.points(), 30, { capMhz: CAP });
  asmIdle.device.writeCurve(null, 0n, vecIdle.offsets);
  asmIdle.vc.backend.query(['clocks.gr']); // слить устоявшуюся пробу очереди
  const idleClock = Number(asmIdle.vc.backend.query(['clocks.gr'])['clocks.gr']);
  ok('ПРОСТОЙ: незакреплённая карта в покое НЕ держит потолок кривой — сбрасывается вниз',
    idleClock < CAP - 500, true);

  // 4. СВЕРКА (TA2): отказ вызова записи (класс C4 двойника) доезжает до порта КЛАССОМ боевого
  //    классификатора, а не растворяется в «ok: false».
  const asmSour = await makeTwinAssembly({ seed: 7, cardOpts: { writeCallFailsAt: [5, 6] } });
  const w = asmSour.device.writeCurve(null, 0n, vecIdle.offsets);
  ok('СВЕРКА: отказ вызова записи доезжает КЛАССОМ боевого классификатора',
    [w.ok, w.failureClass !== null && w.failureClass !== undefined], [false, true]);

  // 5. ПЕСОЧНИЦА: документ и журнал двойника — в benches/runs; живые артефакты не тронуты.
  ok('ПЕСОЧНИЦА: документ и журнал двойника живут в benches/runs, не в curves/ и не в runs/sweep',
    [asm.docDir.includes(join('benches', 'runs')), asm.journalDir.includes(join('benches', 'runs'))],
    [true, true]);
  const after = liveFingerprint();
  ok('I1: живой документ, боевой журнал и боевая папка всадников самопроверкой не тронуты',
    after, before);

  return { ok: results.every((r) => r.ok), results };
}

async function main(argv) {
  if (argv.includes('--selftest')) {
    const r = await selfTest();
    for (const x of r.results) {
      console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok ? '' : `  -> получено ${JSON.stringify(x.got)}, ждали ${JSON.stringify(x.want)}`}`);
    }
    console.log('');
    console.log(r.ok
      ? `САМОПРОВЕРКА twin: ${r.results.length} блоков, все сходятся. Песочница — benches/runs; живой документ, боевой журнал и runs/death-watch не тронуты.`
      : 'САМОПРОВЕРКА twin: есть расхождения.');
    return r.ok ? 0 : 1;
  }
  if (argv.includes('--smoke')) return mainSmoke(argv);
  if (argv.includes('--i1')) {
    const f = liveFingerprint();
    console.log(`I1: документ ${f.measuredSha} · журнал ${f.journalSha} · runs/death-watch ${f.deathWatchFiles} файлов`);
    console.log(`СТРОКА ДОСТАВКИ: ${deliveryLine()}`);
    return 0;
  }
  console.log('Использование: --selftest | --smoke [--from МГц --to МГц] [--max-depth мВ] | --i1');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
