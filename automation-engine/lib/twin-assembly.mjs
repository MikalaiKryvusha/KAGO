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
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const BENCH_RUNS = join(ROOT, 'benches', 'runs');
const DEFAULT_CARD_FILE = join(ROOT, 'benches', 'cards', 'rtx5070ti.json');

/** Строка канона I3 — ОДИН дом (P64-AC2): сборка отдаёт её движку, CLI печатает её сам на каждой
 *  двери. Зелёный на виртуалке — утверждение о ЛОГИКЕ; копия этой строки где-то ещё была бы парой
 *  правда↔зеркало. */
export const CANON_LINE = 'ЦИФРОВОЙ ДВОЙНИК — ВЫМЫСЕЛ (I3): зелёный прогон здесь доказывает ЛОГИКУ движка и '
  + 'проводку живого пути, а не кремний, драйвер или карту владельца.';

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
  // ─── ФАЗА 4 ЭПИКА 59 — смерти по профилям (`plans/63`) ────────────────────────────────────────
  // `armJudge` — судья всадников ВЗВОДИТСЯ (N = DERIVED_ARM_N_MS) и получает руку 2 ДВОЙНИКА
  //   (`--twin-stock`): взведённый судья на виртуальном прогоне БЕЗ виртуальной руки 2 бил бы
  //   стоком по живой карте владельца — ровно нарушение I1, ради недопущения которого судья до
  //   этой фазы ездил невзведённым.
  // `deathRehearsal` — 'strangle' | 'instant' | 'hang': прожиг идёт через ПРОЦЕСС-НОСИТЕЛЬ (руке 1
  //   есть кого убивать, у ступени есть настоящее время стены), проба играет ИЗМЕРЕННЫЙ профиль
  //   смерти (кроме 'hang' — там движок убивают снаружи, профиль не нужен). Подразумевает armJudge
  //   для strangle/instant; 'hang' идёт с невзведённым судьёй — смерть МАШИНЫ не спасает никто,
  //   её запись держит журнал упреждающей записи (R15).
  armJudge = false,
  deathRehearsal = null,
  // ─── ФАЗА 5б ЭПИКА 51 — настройка порога на двойнике (`plans/65`) ─────────────────────────────
  // `armNMs` — порог судьи ПАРАМЕТРОМ, а не константой: сетка гоняет одну и ту же репетицию при
  //   разных N, чтобы у порога появилась КРИВАЯ вместо одной точки. `null` = прежняя выведенная
  //   рекомендация `DERIVED_ARM_N_MS`, и без флага аргументы всадников обязаны остаться бит-в-бит
  //   (I4) — на это стоит свой блок в самопроверке.
  armNMs = null,
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
  // ─── НОСИТЕЛЬ ГОРНА (фаза 4): тело прожига — процесс, вердикт — внутрипроцессный оракул ────────
  // Состояние модели (тепло, последовательность ГСЧ, удержанные смещения) НЕ форкается в ребёнка —
  // ребёнок держит только ВРЕМЯ СТЕНЫ и умирает от руки 1. Убитый носитель возвращается статусом
  // ≠ 0 ДОСЛОВНО в форме spawnSync — `runBurst` проваливает его своей штатной дорогой
  // («нагрузка вышла с кодом …»), ровно как taskkill валит furnace на живом пути (фаза 5 эпика 51).
  const carrierScript = join(HERE, 'twin-burn-carrier.mjs');
  const burnPidfile = join(runDir, 'burn-carrier.pid');
  const carrierLauncher = (binary, argv) => {
    const i = argv.indexOf('--sustain');
    const secs = i === -1 ? 1 : Number(argv[i + 1]);
    const r = spawnSync(process.execPath, [carrierScript, '--seconds', String(secs), '--pidfile', burnPidfile],
      { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) return r; // убит рукой 1 — дорога оракула, без нового кода записи
    return vc.oracle.run(binary, argv);
  };
  const twinStressTest = async ({
    name = 'sdc_fma', seconds = 10, sustain = 0, args = [], onBurst = null,
  } = {}) => {
    const golden = goldenFor(args);
    const stampOk = stress.checkGoldenStamp(golden, probedCard, args);
    const burst = stress.runBurst({
      name, args, sustainSeconds: Math.max(1, sustain || seconds),
      run: deathRehearsal ? carrierLauncher : (b, a) => vc.oracle.run(b, a),
    });
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

  // ─── ВСАДНИКИ (фаза 4): взведение и профили — только по явному заказу, дефолт прежний ──────────
  const { DERIVED_ARM_N_MS } = await import('./fuse.mjs');
  const armed = armJudge || deathRehearsal === 'strangle' || deathRehearsal === 'instant';
  const playsProfile = deathRehearsal === 'strangle' || deathRehearsal === 'instant';
  // Порог: заказанный сеткой или выведенная рекомендация. Одно место, где число берётся.
  const armN = armNMs === null ? DERIVED_ARM_N_MS : armNMs;
  return {
    vc, card, device, probedCard, recover, loadDoc,
    docName, docDir, journalDir, runDir, burnPidfile,
    saveDoc: (d) => cs.saveCurveDoc(d, { name: docName, dir: docDir }),
    canonLine: CANON_LINE,
    riders: {
      judgeArgs: ['--judge',
        // Взведённый судья на двойнике НЕ БЫВАЕТ без руки 2 двойника: --arm-n и --twin-stock —
        // одна дверь, не две (см. комментарий у armJudge выше).
        ...(armed ? ['--arm-n', String(armN), '--burn-pidfile', burnPidfile, '--twin-stock', cardFile] : []),
        '--seconds', '600', '--out', join(runDir, 'fuse.jsonl')],
      probeArgs: ['--beat-sender', '--seconds', '600', '--tick', '2',
        ...(playsProfile ? ['--play-profile', deathRehearsal, '--after-pidfile', burnPidfile] : [])],
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

/** Свежая песочница двойника: документ и журнал зависаний УНОСЯТСЯ в archive-<штамп>, не стираются.
 *  Репетиции смертей должны начинаться с известного состояния — иначе уже закрытая полоса не даст
 *  ни одного прожига и профилю не на чем сыграть; а стирать заработанные двойником знания незачем. */
function archiveTwinSandbox() {
  const stamp = localIso().replace(/[:+]/g, '-');
  const dest = join(BENCH_RUNS, `archive-${stamp}`);
  let moved = 0;
  if (existsSync(BENCH_RUNS)) {
    for (const name of readdirSync(BENCH_RUNS)) {
      if (!name.startsWith('virtual-')) continue;
      mkdirSync(dest, { recursive: true });
      renameSync(join(BENCH_RUNS, name), join(dest, name));
      moved += 1;
    }
  }
  return { moved, dest: moved ? dest : null };
}

/** Новейший каталог прогона всадников (`twin-<штамп>`) — там журнал и кольцо судьи. */
function newestTwinRunDir() {
  if (!existsSync(BENCH_RUNS)) return null;
  const dirs = readdirSync(BENCH_RUNS).filter((n) => n.startsWith('twin-') && statSync(join(BENCH_RUNS, n)).isDirectory());
  if (!dirs.length) return null;
  dirs.sort();
  return join(BENCH_RUNS, dirs[dirs.length - 1]);
}

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split(/\r?\n/u).map((s) => s.trim()).filter(Boolean).map((s) => {
    try { return JSON.parse(s); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Фаза 5б эпика 51 (`plans/65`): `--arm-n <мс>` у твин-команд едет до движка одним аргументом.
 * БЕЗ флага возвращается ПУСТОЙ массив — командная строка развёртки остаётся бит-в-бит прежней
 * (I4), а порог берётся из `DERIVED_ARM_N_MS` там же, где брался всегда.
 */
export function armNArgs(argv) {
  const i = argv.indexOf('--arm-n');
  return i >= 0 && argv[i + 1] ? ['--twin-arm-n', argv[i + 1]] : [];
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
  // P63-AC5: тот же здоровый смоук, но судья ВЗВЕДЁН (N=60) — ложных трипов обязано быть ноль.
  const armed = argv.includes('--armed');

  console.log(`СМОУК СБОРКИ «--card virtual» (${armed ? 'plans/63 P63-AC5: судья ВЗВЕДЁН' : 'plans/62 шаг 4'}): та же команда развёртки, целиком на двойнике.`);
  if (armed) archiveTwinSandbox(); // взведённому смоуку нужны настоящие прожиги — свежая полоса
  const before = liveFingerprint();
  const lineBefore = deliveryLine();
  console.log(`I1 ДО:    документ ${before.measuredSha} · журнал ${before.journalSha} · runs/death-watch ${before.deathWatchFiles} файлов`);
  console.log(`СТРОКА ДОСТАВКИ ДО:    ${lineBefore}`);

  const engine = join(HERE, '..', 'engine.mjs');
  const r = spawnSync(process.execPath, [engine, '--sweep', '--card', 'virtual',
    '--from', from, '--to', to, '--max-depth', maxDepth,
    ...(armed ? ['--twin-arm', ...armNArgs(argv)] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
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

  if (!armed) return r.status === 0 && clean ? 0 : 1;

  // ─── P63-AC5: ложных трипов НОЛЬ — по журналу судьи, не по впечатлению ───────────────────────
  const runDir = newestTwinRunDir();
  const fuseLines = runDir ? readJsonl(join(runDir, 'fuse.jsonl')) : [];
  const trips = fuseLines.filter((l) => l.phase === 'intent');
  const noTrip = trips.length === 0 && !/ТРИП/u.test(log);
  console.log(noTrip
    ? `✅ P63-AC5: судья ВЗВЕДЁН (N=60) прошёл здоровый смоук БЕЗ ЕДИНОГО ТРИПА (журнал ${runDir ?? '—'}/fuse.jsonl пуст от намерений).`
    : `🔴 P63-AC5 ПРОВАЛЕН: ложных трипов ${trips.length} — читать ${runDir}/fuse.jsonl и кольцо.`);
  return r.status === 0 && clean && noTrip ? 0 : 1;
}

// =================================================================================================
// Репетиции смертей по ИЗМЕРЕННЫМ профилям (эпик 59 фаза 4, `plans/63` шаг 5)
// =================================================================================================

/** Прочитать журнал судьи и кольцо после репетиции; рука 2 — ДЕТАЧНУТЫЙ процесс, ей дают дожить. */
async function collectRescueEvidence() {
  await new Promise((res) => setTimeout(res, 4000)); // рука 2 двойника: спавн + модель + своя строка
  const runDir = newestTwinRunDir();
  if (!runDir) return { runDir: null, fuse: [], ring: [] };
  return {
    runDir,
    fuse: readJsonl(join(runDir, 'fuse.jsonl')),
    ring: readJsonl(join(runDir, 'fuse-ring.jsonl')),
  };
}

async function mainRehearseDeath(profile, { withWindow = true, armNMs = null } = {}) {
  console.log(`РЕПЕТИЦИЯ СМЕРТИ «${profile}» НА ДВОЙНИКЕ (plans/63): проба играет ИЗМЕРЕННЫЙ профиль, судья взведён, руки бьют по двойнику.`);
  // ОКНО — НОСИТЕЛЬ ПОКАЗА, ПО УМОЛЧАНИЮ (`bugs/65`, найдено владельцем: «я ничего не видел. даже
  // визуализатор не открылся»). Вечер владельца = окно + звук, терминал — приложение. `--no-window`
  // оставлен для безголовой отладки и назван в usage.
  if (withWindow) console.log('ОКНО: репетиция идёт В ОКНЕ НАБЛЮДЕНИЯ — смотреть туда; терминал — приложение к нему.');
  const archived = archiveTwinSandbox();
  if (archived.moved) console.log(`песочница двойника унесена в ${archived.dest} (${archived.moved} шт.) — репетиция со свежего стока`);
  const before = liveFingerprint();
  const lineBefore = deliveryLine();
  console.log(`I1 ДО:    документ ${before.measuredSha} · журнал ${before.journalSha} · runs/death-watch ${before.deathWatchFiles} файлов`);

  const engine = join(HERE, '..', 'engine.mjs');
  const r = spawnSync(process.execPath, [engine, '--sweep', '--card', 'virtual',
    '--from', '2842', '--to', '2812', '--max-depth', '300', '--twin-death', profile,
    ...(armNMs === null ? [] : ['--twin-arm-n', String(armNMs)]),
    ...(withWindow ? ['--twin-window'] : [])],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  const log = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  const logFile = join(BENCH_RUNS, `twin-death-${profile}-${localIso().replace(/[:+]/g, '-')}.log`);
  writeFileSync(logFile, log, 'utf8');
  console.log(`ПРОГОН: код ${r.status} · лог ${logFile}`);
  for (const l of log.split('\n').filter((l) => /ПРЕДОХРАНИТЕЛЬ|ПРОБА ФЬЮЗА|ТРИП|СПАСЕНИЕ|встал|ОТКАЗ|вышла с кодом|ИТОГ/u.test(l)).slice(0, 25)) console.log(`  | ${l.trim()}`);

  const ev = await collectRescueEvidence();
  const intents = ev.fuse.filter((l) => l.phase === 'intent');
  const hand1 = ev.fuse.find((l) => l.phase === 'outcome' && l.hand === 1);
  const hand2spawn = ev.fuse.find((l) => l.phase === 'outcome' && l.hand === 2 && l.action === 'stock-voltage');
  const hand2done = ev.fuse.find((l) => l.hand === 2 && l.action === 'stock-voltage-verified-twin');
  const after = liveFingerprint();
  const lineAfter = deliveryLine();
  const i1 = JSON.stringify(before) === JSON.stringify(after) && lineBefore === lineAfter;

  // Пульс прогона — в ПЕСОЧНИЦЕ этого прогона, и он обязан объявлять двойника (`bugs/65`):
  // окно, которое нельзя отличить от живого вечера, хуже отсутствующего.
  const twinPulse = (() => {
    try { return JSON.parse(readFileSync(join(ev.runDir ?? '', 'live.json'), 'utf8')); } catch { return null; }
  })();
  const checks = [
    ['трип случился (намерение в журнале судьи, причина beat-silence)', intents.length === 1 && intents[0].cause === 'beat-silence'],
    ['рука 1 отработала: носитель горна убит (pid из пид-файла)', hand1?.ok === true],
    ['рука 2 запущена детачнуто и сама подтвердила СТОК ДВОЙНИКА чтением', hand2spawn?.ok === true && hand2done?.ok === true],
    ['полоса ВСТАЛА до следующей ступени (stopWhen: судья вышел, код 2 — спасение)', /СПАСЕНИЕ сработало/u.test(log)],
    ['спасённая ступень провалилась дорогой оракула (нагрузка вышла с кодом / ОТКАЗ)', /вышла с кодом|ОТКАЗ/u.test(log)],
    ['кольцо судьи сброшено и читается (суб-пороговые такты на месте)', ev.ring.length >= 10],
    ['пульс — в песочнице прогона и объявляет двойника (source I3 · карта synthetic · индикаторы не тёмные)',
      twinPulse?.run?.source?.includes('ЦИФРОВОЙ ДВОЙНИК') === true && twinPulse?.card?.synthetic === true
      && Number.isFinite(twinPulse?.card?.clockMhz)],
    ...(withWindow ? [['окно наблюдения ПОДНЯЛОСЬ с песочными путями (строка подъёма в логе прогона)',
      /ОКНО НАБЛЮДЕНИЯ \(двойник\): поднято/u.test(log)]] : []),
    ['I1: живой документ · боевой журнал · боевая папка всадников · строка доставки — не тронуты', i1],
  ];
  let bad = 0;
  for (const [what, okc] of checks) { console.log(`${okc ? '✅' : '🔴'} ${what}`); if (!okc) bad += 1; }
  console.log(`журнал судьи: ${ev.runDir ?? '—'}\\fuse.jsonl · кольцо: fuse-ring.jsonl (${ev.ring.length} тактов)`);
  return bad === 0 ? 0 : 1;
}

/**
 * НАСТРОЙКА ПОРОГА НА ДВОЙНИКЕ — фаза 5б эпика 51 (`plans/65`, P65-AC2/AC4).
 *
 * Живая карта даёт по одной точке за смерть машины; двойник играет ИЗМЕРЕННУЮ смерть сколько
 * угодно раз. Сетка гоняет одну и ту же репетицию при разных N и снимает кривую «N → исход».
 *
 * Окно намеренно НЕ поднимается: это замер, а не показ (показ — `--rehearse-death`).
 */
async function mainTuneN(argv) {
  const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const values = arg('values', '20,40,60,90,150').split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  const repeats = Number(arg('repeats', '3'));
  const scenarios = arg('scenarios', 'strangle,healthy').split(',').map((s) => s.trim()).filter(Boolean);
  if (values.length === 0 || !Number.isFinite(repeats) || repeats < 1) {
    console.error('--tune-n: --values принимает список положительных чисел, --repeats — целое ≥ 1.');
    return 2;
  }
  const fuseMod = await import('./fuse.mjs');
  const dw = await import('./death-watch.mjs');
  const stalls = dw.strangleProfileStalls();
  // Перелёты деградации — те останова профиля, что НЕ роковые. Граница берётся из самой записи:
  // между группами пусто (11…29 против 2070/2366), поэтому «меньше секунды» её не размывает.
  const degradationStalls = stalls.filter((s) => s < 1000).length;
  const fatal = stalls.filter((s) => s >= 1000);

  console.log(CANON_LINE);
  console.log(`НАСТРОЙКА ПОРОГА (plans/65): N ∈ {${values.join(', ')}} мс · сценарии ${scenarios.join(', ')} · повторов ${repeats}`);
  console.log(`ПРОФИЛЬ УДУШЕНИЯ ИЗ ФИКСТУРЫ: перелётов деградации ${degradationStalls} (${Math.min(...stalls.filter((s) => s < 1000))}…${Math.max(...stalls.filter((s) => s < 1000))} мс), роковых ${fatal.length} (${fatal.join(', ')} мс).`);
  console.log(`ОКНО РЕШЕНИЯ ИЗ АРИФМЕТИКИ: N ∈ (${Math.max(...stalls.filter((s) => s < 1000))} · ${Math.min(...fatal)}) мс — сетка проверяет, держится ли оно на сквозном прогоне.`);

  const before = liveFingerprint();
  const lineBefore = deliveryLine();
  console.log(`I1 ДО:    документ ${before.measuredSha} · журнал ${before.journalSha} · runs/death-watch ${before.deathWatchFiles} файлов`);

  const engine = join(HERE, '..', 'engine.mjs');
  mkdirSync(BENCH_RUNS, { recursive: true });
  const outFile = join(BENCH_RUNS, `tune-n-${localIso().replace(/[:+]/g, '-')}.jsonl`);
  const rows = [];
  let n = 0;
  const total = values.length * scenarios.length * repeats;
  for (const armN of values) {
    for (const scenario of scenarios) {
      for (let rep = 1; rep <= repeats; rep++) {
        n += 1;
        archiveTwinSandbox(); // каждый прогон — со свежего стока, иначе жечь нечего и профилю не на чем играть
        const startedAt = localIso();
        const r = spawnSync(process.execPath, [engine, '--sweep', '--card', 'virtual',
          '--from', '2842', '--to', '2812', '--max-depth', '300',
          '--twin-arm-n', String(armN),
          ...(scenario === 'healthy' ? ['--twin-arm'] : ['--twin-death', scenario])],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
        const ev = await collectRescueEvidence();
        // Лог прогона кладётся В ПЕСОЧНИЦУ этого прогона, а не теряется: разбор первой же аномалии
        // сетки (`bugs/67`) начался с того, что лога не было и пришлось воспроизводить руками.
        if (ev.runDir) writeFileSync(join(ev.runDir, 'engine.log'), `${r.stdout ?? ''}\n${r.stderr ?? ''}`, 'utf8');
        const intents = ev.fuse.filter((l) => l.phase === 'intent');
        const stallsSurvived = fuseMod.countStallsBeforeTrip(ev.ring);
        const outcome = fuseMod.classifyTuneOutcome({
          scenario, tripped: intents.length > 0, stallsSurvived, degradationStalls,
        });
        const row = {
          startedAt, armNMs: armN, scenario, rep, outcome,
          exitCode: r.status, intents: intents.length,
          beatSilenceMs: intents[0]?.beatSilenceMs ?? null,
          stallsSurvived, degradationStalls, ringTicks: ev.ring.length,
          runDir: ev.runDir,
        };
        rows.push(row);
        appendFileSync(outFile, `${JSON.stringify(row)}\n`, 'utf8');
        console.log(`[${n}/${total}] N=${armN} · ${scenario} · попытка ${rep} → ${outcome.toUpperCase()} (остановов пережито ${stallsSurvived}/${degradationStalls}, тактов в кольце ${ev.ring.length}, код ${r.status})`);
      }
    }
  }

  const after = liveFingerprint();
  const i1 = JSON.stringify(before) === JSON.stringify(after) && lineBefore === deliveryLine();
  console.log(`\nСВОДКА (сырьё: ${outFile})`);
  for (const armN of values) {
    const parts = scenarios.map((s) => {
      const mine = rows.filter((x) => x.armNMs === armN && x.scenario === s);
      const tally = mine.reduce((m, x) => ({ ...m, [x.outcome]: (m[x.outcome] ?? 0) + 1 }), {});
      return `${s}: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}`;
    });
    console.log(`  N=${String(armN).padStart(4)} мс │ ${parts.join(' │ ')}`);
  }
  console.log(i1
    ? '✅ I1 ДЕРЖИТСЯ: живой документ, боевой журнал и боевая папка всадников не тронуты, строка доставки не сдвинулась.'
    : '🔴 I1 НАРУШЕН — разбирать до любых выводов из сетки.');
  return i1 ? 0 : 1;
}

/**
 * Виртуальный ЗАВИС (P63-AC4): процесс развёртки УМИРАЕТ посреди прожига — движок убивают снаружи,
 * ровно как машину убивает край. Намерение уже fsync-нуто (R15); ВТОРОЙ прогон обязан закрыть его
 * как ЗАВИС, поднять виртуальный пол зависания и не вернуться на роковую ступень.
 */
async function mainRehearseHang({ withWindow = true } = {}) {
  console.log('РЕПЕТИЦИЯ ВИРТУАЛЬНОГО ЗАВИСА (plans/63): движок умирает посреди прожига, второй прогон закрывает намерение полом.');
  // Окно по умолчанию (`bugs/65`): застывшая картинка при смерти движка — ровно тот показ, ради
  // которого прибор существует; второй прогон перехватывает порт и доигрывает закрытие в окне.
  if (withWindow) console.log('ОКНО: смерть и закрытие видны В ОКНЕ НАБЛЮДЕНИЯ — картинка застынет вместе с движком.');
  const archived = archiveTwinSandbox();
  if (archived.moved) console.log(`песочница двойника унесена в ${archived.dest} (${archived.moved} шт.)`);
  const before = liveFingerprint();

  const { spawn } = await import('node:child_process');
  const engine = join(HERE, '..', 'engine.mjs');
  const child = spawn(process.execPath, [engine, '--sweep', '--card', 'virtual',
    '--from', '2842', '--to', '2812', '--max-depth', '300', '--twin-death', 'hang',
    ...(withWindow ? ['--twin-window'] : [])],
  { windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  // Ждём ПИД-ФАЙЛ носителя — прожиг в полёте, намерение уже на диске (R15: fsync ДО касания карты).
  const started = Date.now();
  let pidfile = null;
  while (Date.now() - started < 120_000) {
    const runDir = newestTwinRunDir();
    const cand = runDir ? join(runDir, 'burn-carrier.pid') : null;
    if (cand && existsSync(cand)) { pidfile = cand; break; }
    await new Promise((res) => setTimeout(res, 100));
  }
  if (!pidfile) { try { child.kill(); } catch { /* уже вышел */ } console.log('🔴 носитель так и не родился — прожиг не начался'); return 1; }
  const carrierPid = Number(readFileSync(pidfile, 'utf8').trim());
  await new Promise((res) => setTimeout(res, 300)); // прожиг заведомо В полёте
  try { process.kill(child.pid, 'SIGKILL'); } catch { /* умер сам? */ }
  try { process.kill(carrierPid, 'SIGKILL'); } catch { /* носитель мог выйти */ }
  // Всадники пережили SIGKILL движка (его exit-обработчики не бежали) — гасим по напечатанным pid.
  for (const m of out.matchAll(/(?:судья|ПРОБА ФЬЮЗА:) pid (\d+)/gu)) { try { process.kill(Number(m[1]), 'SIGKILL'); } catch { /* уже нет */ } }
  console.log(`движок убит посреди прожига (pid ${child.pid}, носитель ${carrierPid}) — намерение осталось незакрытым`);

  await new Promise((res) => setTimeout(res, 500));
  const r2 = spawnSync(process.execPath, [engine, '--sweep', '--card', 'virtual',
    '--from', '2842', '--to', '2812', '--max-depth', '300',
    ...(withWindow ? ['--twin-window'] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000 });
  const log2 = `${r2.stdout ?? ''}\n${r2.stderr ?? ''}`;
  const logFile = join(BENCH_RUNS, `twin-hang-${localIso().replace(/[:+]/g, '-')}.log`);
  writeFileSync(logFile, `=== ПЕРВЫЙ (убит) ===\n${out}\n=== ВТОРОЙ ===\n${log2}`, 'utf8');
  for (const l of log2.split('\n').filter((l) => /ЗАВИС|ПОЛ ЗАВИСАНИЯ|ИТОГ|полоса/u.test(l)).slice(0, 15)) console.log(`  | ${l.trim()}`);

  const after = liveFingerprint();
  const checks = [
    ['второй прогон закрыл намерение: «ЗАВИС» приписан своей частоте и напряжению', /ЗАВИС/u.test(log2)],
    ['виртуальный пол зависания поднят — на роковую ступень спуск не возвращается', /ПОЛ ЗАВИСАНИЯ/u.test(log2)],
    ['второй прогон дошёл до конца полосы (код 0)', r2.status === 0],
    ['I1: живые артефакты не тронуты обоими прогонами', JSON.stringify(before) === JSON.stringify(after)],
  ];
  let bad = 0;
  for (const [what, okc] of checks) { console.log(`${okc ? '✅' : '🔴'} ${what}`); if (!okc) bad += 1; }
  console.log(`лог: ${logFile}`);
  return bad === 0 ? 0 : 1;
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
//   TA4. всадники: взвести судью БЕЗ руки 2 двойника (снять --twin-stock из armed-ветки)
//        → «ВСАДНИКИ: взведённый судья двойника НЕ БЫВАЕТ без руки 2 двойника»
//   TA5. носитель: вернуть прожиг в процесс движка (carrierLauncher → oracle.run напрямую)
//        → «НОСИТЕЛЬ: убитое тело прожига проваливает ступень дорогой оракула»
//   TA6. движок: снять `path: twinPulsePath` из openPulse твин-ветки (пульс уедет в боевой файл)
//        → «ПУЛЬС: пульс твин-прогона — в песочнице, объявляет двойника, боевой файл не тронут»
//   TA7. движок: снять `pulse.telemetry(twin.vc.telemetry.read())` (индикаторы тёмные)
//        → тот же блок: `card.clockMhz` в песочном пульсе обязан быть числом
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

  // 6. ВСАДНИКИ (фаза 4, TA4): дефолт — судья невзведён и без профиля (поведение фазы 3, I4);
  //    взведение и рука 2 двойника — ОДНА дверь; профиль смерти играет только репетиция.
  ok('ВСАДНИКИ: дефолт — судья невзведён, проба без профиля (фаза 3 как была)',
    [asm.riders.judgeArgs.includes('--arm-n'), asm.riders.probeArgs.includes('--play-profile')],
    [false, false]);
  const asmArmed = await makeTwinAssembly({ seed: 7, armJudge: true });
  ok('ВСАДНИКИ: взведённый судья двойника НЕ БЫВАЕТ без руки 2 двойника (--arm-n ⇒ --twin-stock и пид-файл)',
    [asmArmed.riders.judgeArgs.includes('--arm-n'), asmArmed.riders.judgeArgs.includes('--twin-stock'),
      asmArmed.riders.judgeArgs.includes('--burn-pidfile'), asmArmed.riders.probeArgs.includes('--play-profile')],
    [true, true, true, false]);
  const asmDeath = await makeTwinAssembly({ seed: 7, deathRehearsal: 'strangle' });
  ok('ВСАДНИКИ: репетиция смерти — судья взведён И проба играет измеренный профиль после пид-файла',
    [asmDeath.riders.judgeArgs.includes('--arm-n'),
      asmDeath.riders.probeArgs.includes('--play-profile'),
      asmDeath.riders.probeArgs[asmDeath.riders.probeArgs.indexOf('--play-profile') + 1],
      asmDeath.riders.probeArgs.includes('--after-pidfile')],
    [true, true, 'strangle', true]);
  const asmHang = await makeTwinAssembly({ seed: 7, deathRehearsal: 'hang' });
  ok('ВСАДНИКИ: репетиция ЗАВИСА — носитель есть, но судья НЕВЗВЕДЁН (смерть машины не спасает никто) и профиль не играется',
    [asmHang.riders.judgeArgs.includes('--arm-n'), asmHang.riders.probeArgs.includes('--play-profile')],
    [false, false]);

  // 6б. ПОРОГ ПАРАМЕТРОМ (фаза 5б эпика 51, `plans/65`): сетка задаёт N, а БЕЗ заказа аргументы
  //     всадников обязаны остаться прежними до байта — иначе настройка тихо переписала бы боевой
  //     дефолт (I4). Мутация «проброс снят» краснеет именно этот блок.
  {
    const { DERIVED_ARM_N_MS } = await import('./fuse.mjs');
    const asmTuned = await makeTwinAssembly({ seed: 7, armJudge: true, armNMs: 25 });
    const nOf = (a) => a.judgeArgs[a.judgeArgs.indexOf('--arm-n') + 1];
    ok('ПОРОГ: без --arm-n аргументы судьи БИТ-В-БИТ прежние (N = выведенная рекомендация)',
      nOf(asmArmed.riders), String(DERIVED_ARM_N_MS));
    ok('ПОРОГ: заказанный N доезжает до аргументов судьи, остальная строка не меняется',
      [nOf(asmTuned.riders), JSON.stringify(asmTuned.riders.probeArgs) === JSON.stringify(asmArmed.riders.probeArgs)],
      ['25', true]);
    ok('ПОРОГ: --arm-n твин-команды переводится в --twin-arm-n движка; без флага — пусто',
      [JSON.stringify(armNArgs(['--rehearse-death', 'strangle', '--arm-n', '40'])),
        JSON.stringify(armNArgs(['--rehearse-death', 'strangle']))],
      ['["--twin-arm-n","40"]', '[]']);
  }

  // 7. НОСИТЕЛЬ (TA5): счастливый путь служит время и отдаёт вердикт оракулу; убитое тело
  //    проваливает ступень ДОРОГОЙ ОРАКУЛА — «нагрузка вышла с кодом …», без нового кода записи.
  {
    const stress = await import('./stress-tester.mjs');
    const happy = stress.runBurst({
      name: 'sdc_fma', args: [], sustainSeconds: 1,
      run: (b, a) => {
        const carrier = join(HERE, 'twin-burn-carrier.mjs');
        const pf = join(asmDeath.runDir, 'burn-carrier.pid');
        const rr = spawnSync(process.execPath, [carrier, '--seconds', '0.2', '--pidfile', pf], { encoding: 'utf8', windowsHide: true });
        if (rr.status !== 0) return rr;
        return asmDeath.vc.oracle.run(b, a);
      },
    });
    ok('НОСИТЕЛЬ: счастливый путь — время отслужено, вердикт от внутрипроцессного оракула (PASS-форма)',
      [happy.died, typeof happy.checksum === 'string'], [false, true]);
    const killedShape = stress.runBurst({
      name: 'sdc_fma', args: [], sustainSeconds: 1,
      run: () => ({ status: 1, stdout: '', stderr: 'убит рукой 1 (SIGKILL)' }),
    });
    ok('НОСИТЕЛЬ: убитое тело прожига проваливает ступень дорогой оракула («нагрузка вышла с кодом»)',
      [killedShape.died, /вышла с кодом 1/u.test(killedShape.reason)], [true, true]);
  }

  // 8. СТРОКА КАНОНА I3 (P64-AC2, «шаг 2» plans/64): одна печать в main() кроет все двери CLI —
  //    доказано сквозным запуском самой дешёвой (--i1); сборка отдаёт ТУ ЖЕ константу (один дом).
  //    Мутация-адресат: снять печать из main() → этот блок красный.
  {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--i1'], { encoding: 'utf8', timeout: 60_000 });
    ok('КАНОН I3: каждая дверь CLI печатает строку канона (сквозной --i1), сборка несёт ту же константу',
      [r.status === 0 && (r.stdout ?? '').includes(CANON_LINE), asm.canonLine === CANON_LINE], [true, true]);
  }

  // 9. ПУЛЬС ОКНА (`bugs/65`, TA6/TA7): твин-прогон БЕЗ окна всё равно пишет пульс — в ПЕСОЧНИЦУ
  //    своего прогона, с объявленным источником двойника и накормленными индикаторами; боевой файл
  //    прибора (`runs/dashboard/live.json`) при этом не тронут. Узкая полоса — одна частота.
  {
    const livePulse = join(ROOT, 'runs', 'dashboard', 'live.json');
    const liveBefore = existsSync(livePulse) ? `${statSync(livePulse).mtimeMs}:${statSync(livePulse).size}` : 'нет файла';
    const engine = join(HERE, '..', 'engine.mjs');
    const r = spawnSync(process.execPath, [engine, '--sweep', '--card', 'virtual',
      '--from', '2842', '--to', '2842', '--max-depth', '30'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240_000 });
    const runDir = newestTwinRunDir();
    const p = (() => {
      try { return JSON.parse(readFileSync(join(runDir ?? '', 'live.json'), 'utf8')); } catch { return null; }
    })();
    const liveAfter = existsSync(livePulse) ? `${statSync(livePulse).mtimeMs}:${statSync(livePulse).size}` : 'нет файла';
    ok('ПУЛЬС: пульс твин-прогона — в песочнице, объявляет двойника (source I3 · synthetic · индикаторы), боевой файл не тронут',
      [r.status === 0, p?.run?.source?.includes('ЦИФРОВОЙ ДВОЙНИК') === true,
        p?.card?.synthetic === true, Number.isFinite(p?.card?.clockMhz), liveAfter === liveBefore],
      [true, true, true, true, true]);
  }

  const after = liveFingerprint();
  ok('I1: живой документ, боевой журнал и боевая папка всадников самопроверкой не тронуты',
    after, before);

  // УБОРКА ЗА СОБОЙ (находка судьи сессии 60): каждая makeTwinAssembly заводит twin-<штамп>
  // каталог, и у сборок без прожига он остаётся ПУСТЫМ мусором. Пустой каталог улик не несёт —
  // сносим только пустые, и только на выходе набора (каталог с файлами — чья-то форензика).
  const { rmdirSync } = await import('node:fs');
  for (const name of readdirSync(BENCH_RUNS)) {
    if (!name.startsWith('twin-')) continue;
    const dir = join(BENCH_RUNS, name);
    try { if (statSync(dir).isDirectory() && readdirSync(dir).length === 0) rmdirSync(dir); } catch { /* занят — не мусор */ }
  }

  return { ok: results.every((r) => r.ok), results };
}

async function main(argv) {
  // P64-AC2: строка I3 — на КАЖДОЙ двери твин-команд, одной печатью (кроме самопроверки: её вывод
  // читает батарея построчно, и лишняя строка там — шум, а не канон). Сторож — блок по выводу --i1.
  if (!argv.includes('--selftest')) console.log(CANON_LINE);
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
  if (argv.includes('--tune-n')) return mainTuneN(argv);
  // Окно — по умолчанию у РЕПЕТИЦИЙ (они для глаза владельца, `bugs/65`); `--no-window` — для
  // безголовой отладки. Смоук остаётся безголовым: он ворота, а не показ.
  const withWindow = !argv.includes('--no-window');
  if (argv.includes('--rehearse-death')) {
    const i = argv.indexOf('--rehearse-death');
    const profile = argv[i + 1];
    if (!['strangle', 'instant'].includes(profile)) {
      console.error('--rehearse-death принимает strangle | instant (виртуальный ЗАВИС — --rehearse-hang).');
      return 2;
    }
    const n = argv.indexOf('--arm-n');
    return mainRehearseDeath(profile, { withWindow, armNMs: n >= 0 && argv[n + 1] ? argv[n + 1] : null });
  }
  if (argv.includes('--rehearse-hang')) return mainRehearseHang({ withWindow });
  if (argv.includes('--i1')) {
    const f = liveFingerprint();
    console.log(`I1: документ ${f.measuredSha} · журнал ${f.journalSha} · runs/death-watch ${f.deathWatchFiles} файлов`);
    console.log(`СТРОКА ДОСТАВКИ: ${deliveryLine()}`);
    return 0;
  }
  console.log('Использование: --selftest | --smoke [--from МГц --to МГц] [--max-depth мВ] [--armed] [--arm-n мс] | --rehearse-death strangle|instant [--no-window] [--arm-n мс] | --rehearse-hang [--no-window] | --i1');
  console.log('               | --tune-n [--values 20,40,60,90,150] [--scenarios strangle,healthy] [--repeats 3] — сетка порога (plans/65)');
  console.log('--arm-n — порог судьи для НАСТРОЙКИ на двойнике (plans/65); без флага — выведенная рекомендация 60 мс.');
  console.log('Репетиции поднимают ОКНО НАБЛЮДЕНИЯ по умолчанию (bugs/65) — показ владельцу идёт в нём.');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
