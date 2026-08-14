#!/usr/bin/env node
// automation-engine/lib/profile-manager.mjs — THE ONE MODULE THAT WRITES TO THE GPU.
// Phase 2 step 4.2 (plans/03_epic01_phase2_silent_cold.md §4.2).
//
// RULES IT EXISTS TO SATISFY (PROJECT_ARCHITECTURE_INTERNAL_MAP.md):
//   R1  nothing else in the tree calls a GPU-control tool. One writer, one place to audit.
//   R2  the backend is swappable: `nvidia-smi` today, the NVAPI bridge of phase 4 tomorrow. A
//       backend implements four semantic methods (query · setPowerLimitWatts ·
//       lockGraphicsClocksMhz · resetGraphicsClocks); the logic above them never changes.
//   R5  every write has its rollback in this same module, and the rollback is CODE THAT RUNS —
//       the failure-injection block of the selftest takes it.
//   R6  a profile whose driver/VBIOS stamp no longer matches the card is REFUSED before any write.
//
// THE THREE THINGS THIS MODULE KNOWS THAT COST SOMETHING TO LEARN:
//
// 1. THE TOOL'S SUCCESS TEXT IS NOT EVIDENCE. `-rgc` printed "All done" with exit 0 while the next
//    read still reported the locked 1200 MHz (EXP-0014), and `nvidia-smi` prints the DEFAULT in its
//    "from" field rather than the previous value (researches/01 §5). Nothing here parses stdout for
//    a decision; every decision comes from re-reading the card.
//
// 2. A WRITE SETTLES ASYNCHRONOUSLY. A single read taken straight after a write can return the
//    PREVIOUS value. So a value counts as read back only when READBACK_AGREEING_SAMPLES consecutive
//    samples agree with what was expected, and on timeout the read-back FAILS rather than returning
//    the last sample (P2-AC2).
//
// 3. THE APPLY ORDER IS POWER, THEN CLOCK — AND THAT IS A SAFETY PROPERTY, NOT A PREFERENCE.
//    Restoring a power limit is always possible (the previous watts are a number we read). Restoring
//    a clock LOCK we never set is not: `nvidia-smi` has no locked-clocks field to read a prior lock
//    from (EXP-0014), so a release cannot be undone. Putting the clock step LAST guarantees the one
//    un-undoable step is never a step the rollback has to walk back over.
//
// [TESTED: 2026-08-10 · `--selftest` → 13 blocks on injected backends, no GPU touched: stale-read,
//  a clock that FLASHES the target for one sample, lying success text, failure injected between the
//  two writes (power restored), stale stamp, off-ladder clock, read-back timeout failing instead of
//  returning stale. Mutation-proved on a copy — cutting the rollback loop → 1 red, accepting ONE
//  sample instead of two → 1 red, disabling the pre-write refusals → 2 red, widening the watt
//  epsilon → 5 red. The flash block exists BECAUSE of that run: without it the single-sample
//  mutation stayed green, i.e. the suite did not actually guard P2-AC2 (EXP-0008's own corollary —
//  a test written after the fix is written against the code it cannot judge).]
//
// [TESTED: 2026-08-14 · phase 3 §4.2: THE QUALIFICATION GATE (P3-AC3) — a draft (qualified: false)
//  is refused BEFORE the first write, naming the reason and the phase that lifts it; an all-null
//  working-mode draft does NOT fall through to the factory path. `--selftest` → 17 blocks; the
//  gate-removal mutation reddened exactly its two blocks. Live the same night: `--apply optimised`
//  refused with zero writes (power.limit 300 W before and after), `--roundtrip test-pl250`
//  converged — 300 → 250 W read back, reset to 300 W, all compared fields equal.]
//
// [TESTED: 2026-08-14 09:4x · phase 3 §4.4 live, through the TASK PATH: apply-test-pl250 wrote the
//  remembered state («test-pl250») · with the card returned to factory and that state restored (the
//  simulated post-logon condition), `schtasks /run \KAGO\boot-apply` re-applied it — 250.00 W read
//  back twice, Last Result 0, journal verdict `applied` · a second run with remembered=factory gave
//  `factory-by-physics`, zero writes, card stayed 300.00 W. Offline: the 10 boot blocks of
//  `--selftest`, three mutations each reddening exactly their named blocks.]

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync as fsReadFileSync, writeFileSync as fsWriteFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  READBACK_AGREEING_SAMPLES,
  READBACK_INTERVAL_MS,
  READBACK_TIMEOUT_MS,
  BOOT_PROBE_RETRIES,
  BOOT_PROBE_RETRY_INTERVAL_MS,
} from '../config.mjs';
import {
  REMEMBERED_STATE_PATH,
  BOOT_JOURNAL_PATH,
  writeRememberedState,
  readRememberedState,
  appendBootJournal,
} from './remembered-state.mjs';
import {
  PROFILES_DIR,
  loadProfileFile,
  listProfileFiles,
  validateProfile,
  checkStamp,
  isFactoryProfile,
  requiresQualification,
  probeCard,
} from './profile-store.mjs';

/** Power limits come back with two decimals ("250.00"); this is the width of "the same watts". */
const WATT_EPSILON = 0.5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===============================================================================================
// The backend — R2's seam. Four semantic methods; the NVAPI bridge of phase 4 implements the same
// four and nothing above this line changes.
// ===============================================================================================

/**
 * The `nvidia-smi` backend. Every write names ONE card (`-i 0`) rather than addressing all of them:
 * smallest reversible form (AGENT_GUIDE.md → the owner's-machine rule, step 3).
 *
 * The vendor's own documentation of the two writes and their rollbacks, read before the first
 * invocation rather than after the surprise (`nvidia-smi --help`):
 *   -lgc <min,max>  «defines the range of desired locked GPU clock speed in MHz»
 *   -rgc            «Resets the GPU clocks to the default values»   ← the documented rollback of -lgc
 *   -pl <watts>     «Specifies maximum power management limit in watts»
 *                   ← its rollback is -pl <power.default_limit>, a number the card publishes (300 W here)
 */
export function nvidiaSmiBackend() {
  const run = (args) => {
    const r = spawnSync('nvidia-smi', args, { encoding: 'utf8' });
    return {
      ok: !r.error && r.status === 0,
      status: r.status,
      stdout: (r.stdout ?? '').trim(),
      stderr: (r.stderr ?? '').trim(),
    };
  };
  return {
    name: 'nvidia-smi',
    query(fields) {
      const r = run([`--query-gpu=${fields.join(',')}`, '--format=csv,noheader,nounits']);
      if (!r.ok) throw new Error(`nvidia-smi не ответил на запрос полей (код ${r.status}): ${r.stderr}`);
      const values = r.stdout.split(',').map((v) => v.trim());
      return Object.fromEntries(fields.map((f, i) => [f, values[i]]));
    },
    setPowerLimitWatts(w) { return run(['-i', '0', '-pl', String(w)]); },
    lockGraphicsClocksMhz(min, max) { return run(['-i', '0', '-lgc', `${min},${max}`]); },
    resetGraphicsClocks() { return run(['-i', '0', '-rgc']); },
  };
}

// ===============================================================================================
// Reading — the module never consults its own memory of what it wrote
// ===============================================================================================

const STATE_FIELDS = Object.freeze([
  'driver_version', 'vbios_version',
  'power.limit', 'power.default_limit', 'power.min_limit', 'power.max_limit',
  'clocks.gr',
]);

/** One sample of the two fields a write can move. */
function sampleWritable(backend) {
  const r = backend.query(['power.limit', 'clocks.gr']);
  return { powerLimitW: Number(r['power.limit']), clockMhz: Number(r['clocks.gr']) };
}

/** The card as it is right now. Re-read, never inferred (plan §4.2). */
export function readState(backend) {
  const r = backend.query([...STATE_FIELDS]);
  return {
    driver: r.driver_version,
    vbios: r.vbios_version,
    powerLimitW: Number(r['power.limit']),
    powerDefaultW: Number(r['power.default_limit']),
    powerMinW: Number(r['power.min_limit']),
    powerMaxW: Number(r['power.max_limit']),
    clockMhz: Number(r['clocks.gr']),
  };
}

/**
 * THE PRIMITIVE EVERY WRITE GOES THROUGH (P2-AC2).
 *
 * ⚠️ WHAT A READ-BACK PROVES, AND WHAT IT DOES NOT (map rule R4a, `researches/04` §3.2): it proves the
 * command TOOK — not that the card is delivering that much work. NVIDIA parts can **clock-stretch**:
 * when a frequency/voltage point is unstable the hardware skips instructions instead of crashing, and
 * `clocks.gr` keeps reporting the locked value the whole time. So a green read-back here is evidence
 * about the COMMAND. Evidence about DELIVERED performance is a throughput measurement, and it lives
 * in the stress harness, not in this function. Do not let this function's confidence leak into a
 * claim it cannot support.
 *
 * Polls until `agreeing` CONSECUTIVE samples satisfy `expect`. One expectation covers both
 * directions of the only two writes we make, which is why there is one primitive and not two:
 *   locking   -> expect: the clock sits inside [min,max]   (two agreeing samples are equal ones)
 *   releasing -> expect: the clock has LEFT the locked point (two agreeing samples are both away
 *                from it) — because a released clock WANDERS (observed 810…1065, EXP-0014), so
 *                demanding it hold still would be demanding the very thing release destroys
 *   power     -> expect: the limit equals the watts asked for
 *
 * On timeout it THROWS. Returning the last sample would be exactly the defect this exists to
 * prevent: a stale value quietly accepted as the new one.
 */
export async function readBack(backend, expect, {
  what,
  agreeing = READBACK_AGREEING_SAMPLES,
  intervalMs = READBACK_INTERVAL_MS,
  timeoutMs = READBACK_TIMEOUT_MS,
} = {}) {
  const started = Date.now();
  const seen = [];
  let streak = 0;
  let last = null;

  for (;;) {
    const s = sampleWritable(backend);
    seen.push(s);
    last = s;
    streak = expect(s) ? streak + 1 : 0;
    if (streak >= agreeing) {
      return { value: s, samples: seen, agreedAfterMs: Date.now() - started };
    }
    if (Date.now() - started >= timeoutMs) {
      const tail = seen.slice(-4).map((x) => `${x.powerLimitW} Вт / ${x.clockMhz} МГц`).join(' → ');
      throw new Error(
        `перечитывание не сошлось за ${timeoutMs} мс: ${what}. Последние пробы: ${tail}. ` +
        `Значение НЕ принято — устаревшая проба, принятая молча, и есть тот самый дефект (EXP-0014).`,
      );
    }
    await sleep(intervalMs);
  }
}

// ===============================================================================================
// Writing
// ===============================================================================================

/** What the profile asks the card to be, with `null` resolved against the card's own factory values. */
export function resolveTarget(profile, state) {
  return {
    powerLimitW: profile.settings.powerLimitWatts ?? state.powerDefaultW,
    lock: profile.settings.graphicsClockLockMhz ?? null,
  };
}

/**
 * Apply a profile: refuse first, then write in the fixed order, then prove by re-reading.
 *
 * REFUSALS COME BEFORE ANY WRITE — a profile is judged whole, and a half-applied profile that turned
 * out to be invalid is a state nobody asked for.
 *
 * @returns {Promise<{applied:boolean, steps:Array, before:object, after:object, lockedTo:number|null}>}
 */
export async function apply(backend, profile, { card, timing = {}, verifyLock = 'idle' } = {}) {
  const before = readState(backend);

  // R6 and the format, both before the first write (P2-AC5).
  const refusals = validateProfile(profile, { card });
  refusals.push(...checkStamp(profile, card ?? { driver: before.driver, vbios: before.vbios }));
  // THE QUALIFICATION GATE (phase 3, P3-AC3): a draft is a VALID file the format accepts and the
  // list shows — and a state this module never puts on the card. The refusal names the reason and
  // the phase that lifts it, and it sits here, in the one writer (R1), not in the shortcut layer:
  // whatever surface calls apply() — CLI, .lnk, the logon task — meets the same gate.
  if (requiresQualification(profile) && profile.qualified !== true) {
    refusals.push({
      field: 'qualified',
      why: 'профиль — ЧЕРНОВИК (qualified: false): его числа — кандидаты, не прошедшие приёмку. '
        + 'Применение запрещено, на карту не записано ничего. Отказ снимает фаза 6 (приёмка режимов), '
        + 'которая проставит qualified: true по результатам квалификации.',
    });
  }
  if (refusals.length) {
    const err = new Error(`профиль «${profile?.name}» отвергнут до записи:\n` + refusals.map((r) => `    ${r.field}: ${r.why}`).join('\n'));
    err.refusals = refusals;
    throw err;
  }

  const target = resolveTarget(profile, before);
  const done = [];   // steps already applied, for the rollback to walk backwards
  const log = [];

  // The ordered steps. `undo` exists only where an undo is POSSIBLE; see note 3 in the header for
  // why the step without one is deliberately last.
  const steps = [];

  if (Math.abs(before.powerLimitW - target.powerLimitW) >= WATT_EPSILON) {
    steps.push({
      what: `потолок мощности ${before.powerLimitW} → ${target.powerLimitW} Вт`,
      run: async () => {
        const r = backend.setPowerLimitWatts(target.powerLimitW);
        if (!r.ok) throw new Error(`запись потолка мощности не удалась (код ${r.status}): ${r.stderr || r.stdout}`);
        return readBack(backend, (s) => Math.abs(s.powerLimitW - target.powerLimitW) < WATT_EPSILON,
          { what: `потолок мощности должен стать ${target.powerLimitW} Вт`, ...timing });
      },
      undo: async () => {
        const r = backend.setPowerLimitWatts(before.powerLimitW);
        if (!r.ok) throw new Error(`ОТКАТ потолка мощности не удался (код ${r.status}): ${r.stderr || r.stdout}`);
        return readBack(backend, (s) => Math.abs(s.powerLimitW - before.powerLimitW) < WATT_EPSILON,
          { what: `потолок мощности должен вернуться на ${before.powerLimitW} Вт`, ...timing });
      },
    });
  } else {
    log.push(`потолок мощности уже ${before.powerLimitW} Вт — запись не нужна`);
  }

  if (target.lock) {
    const { min, max } = target.lock;
    steps.push({
      what: `фиксация частоты ${min}…${max} МГц`,
      run: async () => {
        const r = backend.lockGraphicsClocksMhz(min, max);
        if (!r.ok) throw new Error(`фиксация частоты не удалась (код ${r.status}): ${r.stderr || r.stdout}`);

        // WHERE A LOCK CAN BE PROVED, and it is not here for every clock. Measured 2026-08-10: at idle
        // a lock to 1500…2850 leaves the clock wandering wherever idle management puts it (1260, 1717,
        // 1935, 1980 observed for four requests, and one request read differently in two runs), while
        // under load the same lock is dead constant. EXP-0014's «the lock is observable at idle» was
        // taken at 1200 MHz — a point that happens to sit inside this card's idle range — and
        // generalized from there; `config.LOCK_IS_OBSERVABLE_AT_IDLE` now records that it does not hold.
        //
        // So the caller says where the proof will come from. `idle` keeps the strict historical
        // behaviour — converge or throw. `deferred` is for a caller that is ABOUT TO LOAD THE CARD and
        // will verify there; it returns a NAMED unproven status rather than a quiet success, so the
        // difference between «proved» and «commanded» never disappears into a boolean.
        if (verifyLock === 'deferred') {
          const s1 = sampleWritable(backend);
          await sleep(timing.intervalMs ?? READBACK_INTERVAL_MS);
          const s2 = sampleWritable(backend);
          return { value: s2, samples: [s1, s2], proof: 'deferred-to-load' };
        }
        return readBack(backend, (s) => s.clockMhz >= min && s.clockMhz <= max,
          { what: `частота должна встать в ${min}…${max} МГц`, ...timing });
      },
      // Undoable — `-rgc` is the vendor's documented reset — and never actually walked, because this
      // step is last. Registered anyway so a future step added after it inherits a correct rollback.
      undo: async () => {
        const r = backend.resetGraphicsClocks();
        if (!r.ok) throw new Error(`ОТКАТ фиксации частоты не удался (код ${r.status}): ${r.stderr || r.stdout}`);
        return readBack(backend, (s) => s.clockMhz < min || s.clockMhz > max,
          { what: 'частота должна покинуть зафиксированную точку', ...timing });
      },
    });
  } else {
    steps.push({
      what: 'снятие фиксации частоты (-rgc)',
      run: async () => {
        const r = backend.resetGraphicsClocks();
        if (!r.ok) throw new Error(`снятие фиксации не удалось (код ${r.status}): ${r.stderr || r.stdout}`);
        // A release we did not perform ourselves cannot be PROVEN by this instrument: there is no
        // locked-clocks field to read, and "the clock moved" only proves anything against a point we
        // know it was pinned to. So this reports rather than claims — inventing evidence would be
        // the worse failure (PHILOSOPHY.md → the three doors).
        const s1 = sampleWritable(backend);
        await sleep(timing.intervalMs ?? READBACK_INTERVAL_MS);
        const s2 = sampleWritable(backend);
        return { value: s2, samples: [s1, s2], proof: 'reported-only' };
      },
      // No undo: re-establishing a lock we never read cannot be done — `nvidia-smi` carries no
      // locked-clocks field (EXP-0014). Harmless because this step is LAST and the rollback only
      // ever walks back over EARLIER steps. The rollback of "go to factory" is applying a profile.
    });
  }

  for (const step of steps) {
    try {
      const proof = await step.run();
      done.push(step);
      const caveat = proof.proof === 'reported-only'
        ? ' (только доложено: снятие несуществующей фиксации доказать нечем)'
        : proof.proof === 'deferred-to-load'
          ? ' (КОМАНДА ОТДАНА, доставка не доказана: на простое фиксация высокой частоты не наблюдается — проверка под нагрузкой)'
          : '';
      log.push(`${step.what} — перечитано: ${proof.value.powerLimitW} Вт / ${proof.value.clockMhz} МГц${caveat}`);
    } catch (e) {
      // P2-AC4: any failing step returns the card to the state it held before the apply began.
      const undone = [];
      for (const applied of [...done].reverse()) {
        if (!applied.undo) { undone.push(`${applied.what}: откатить нечем`); continue; }
        try {
          const proof = await applied.undo();
          undone.push(`${applied.what}: откачено, перечитано ${proof.value.powerLimitW} Вт / ${proof.value.clockMhz} МГц`);
        } catch (e2) {
          undone.push(`${applied.what}: ОТКАТ ПРОВАЛИЛСЯ — ${e2.message}`);
        }
      }
      const err = new Error(`применение «${profile.name}» провалилось на шаге «${step.what}»: ${e.message}\n` +
        (undone.length ? `ОТКАТ:\n${undone.map((u) => `    ${u}`).join('\n')}` : '    откатывать было нечего — упал первый шаг'));
      err.rollback = undone;
      err.after = readState(backend);
      throw err;
    }
  }

  return {
    applied: true, steps: log, before, after: readState(backend),
    lockedTo: target.lock ? target.lock.min : null,
    // The caller must be able to ASK whether the lock was proved, not infer it from a log string.
    lockProof: target.lock ? (verifyLock === 'deferred' ? 'deferred-to-load' : 'read-back') : null,
  };
}

/**
 * Return the card to factory. Always available, and it is what "the third shortcut" applies.
 *
 * `knownLockMhz` is what THIS process locked, when it knows: with it, release is PROVED (the clock
 * left the point); without it, the state is reported honestly. R5's rollback for this direction is
 * `apply()` itself — going toward factory is the safe direction and needs no undo.
 */
export async function resetToFactory(backend, { knownLockMhz = null, timing = {} } = {}) {
  const before = readState(backend);
  const log = [];

  const r = backend.resetGraphicsClocks();
  if (!r.ok) throw new Error(`-rgc не удался (код ${r.status}): ${r.stderr || r.stdout}`);
  let clockProof;
  if (knownLockMhz !== null) {
    clockProof = await readBack(backend, (s) => s.clockMhz !== knownLockMhz,
      { what: `частота должна уйти с зафиксированных ${knownLockMhz} МГц`, ...timing });
    log.push(`фиксация снята — частота ушла с ${knownLockMhz} МГц на ${clockProof.value.clockMhz} МГц`);
  } else {
    const s = sampleWritable(backend);
    clockProof = { value: s, samples: [s], proof: 'reported-only' };
    log.push(`-rgc отправлен; частота сейчас ${s.clockMhz} МГц (снятие фиксации, которую мы не ставили, этим прибором не доказывается)`);
  }

  if (Math.abs(before.powerLimitW - before.powerDefaultW) >= WATT_EPSILON) {
    const p = backend.setPowerLimitWatts(before.powerDefaultW);
    if (!p.ok) throw new Error(`возврат потолка мощности не удался (код ${p.status}): ${p.stderr || p.stdout}`);
    const proof = await readBack(backend, (s) => Math.abs(s.powerLimitW - before.powerDefaultW) < WATT_EPSILON,
      { what: `потолок мощности должен вернуться на заводские ${before.powerDefaultW} Вт`, ...timing });
    log.push(`потолок мощности ${before.powerLimitW} → ${proof.value.powerLimitW} Вт (заводской)`);
  } else {
    log.push(`потолок мощности уже заводской (${before.powerLimitW} Вт) — запись не нужна`);
  }

  return { before, after: readState(backend), steps: log };
}

/**
 * P2-AC3 as a runnable thing: read stock → apply → read back → roll back → read back, and compare
 * the final state against the initial one field by field.
 *
 * The reset runs in a `finally`: a round trip that throws must still leave the card unlocked
 * (plan §4.5 — «Never leave the card locked at the end of a run»).
 */
export async function roundTrip(backend, profile, { card, timing = {} } = {}) {
  const initial = readState(backend);
  let applied = null;
  let lockedTo = null;
  let error = null;
  try {
    applied = await apply(backend, profile, { card, timing });
    lockedTo = applied.lockedTo;
  } catch (e) {
    error = e;
  }
  const reset = await resetToFactory(backend, { knownLockMhz: lockedTo, timing });
  const final = readState(backend);

  const compared = [
    { field: 'потолок мощности, Вт', initial: initial.powerLimitW, final: final.powerLimitW, same: Math.abs(initial.powerLimitW - final.powerLimitW) < WATT_EPSILON },
    { field: 'драйвер', initial: initial.driver, final: final.driver, same: initial.driver === final.driver },
    { field: 'VBIOS', initial: initial.vbios, final: final.vbios, same: initial.vbios === final.vbios },
  ];
  return { initial, applied, reset, final, compared, error, ok: !error && compared.every((c) => c.same) };
}

// ===============================================================================================
// The boot re-apply — phase 3 §4.4. Runs at logon through the SAME apply() gates as every click.
// ===============================================================================================

function profilePath(name) {
  return path.join(PROFILES_DIR, `${name}.json`);
}

/**
 * Re-apply the remembered state at logon (plans/06 §4.4). The card boots FACTORY by physics
 * (volatile GPU state), so every refusing or failing path here ends in «nothing happened» — the
 * designed-in safety. The verdict vocabulary, exhaustively:
 *
 *   no-remembered-state    nothing was ever remembered → zero writes, code 0
 *   remembered-unreadable  the state file exists and cannot be trusted → zero writes, code 1 (loud)
 *   driver-gave-up         the probe never answered within the bounded retries → zero writes, code 1
 *   factory-by-physics     remembered factory, card already factory → zero writes, code 0
 *   factory-restored       remembered factory, card was NOT factory (manual runs only) → reset, code 0
 *   applied                remembered profile applied and read back through apply()'s gates, code 0
 *   degraded-to-factory    the SAME gates refused (draft / stale stamp / missing file) → zero
 *                          writes, factory stands, code 1 — a stale remembered state degrades to
 *                          factory plus a journal line, never to a blind write
 *   apply-failed-rolled-back  a write failed mid-apply; apply() already rolled back, code 1
 *
 * Every run appends exactly ONE journal line (P3-AC2's meter). The remembered state itself is NOT
 * rewritten here: restoration is not a new owner decision.
 */
export async function bootApply({
  backend = null,
  probe = probeCard,
  loadProfileByName = (name, card) => loadProfileFile(profilePath(name), card),
  rememberedPath = REMEMBERED_STATE_PATH,
  journalPath = BOOT_JOURNAL_PATH,
  retries = BOOT_PROBE_RETRIES,
  retryIntervalMs = BOOT_PROBE_RETRY_INTERVAL_MS,
  timing = {},
} = {}) {
  const journal = (record) => { appendBootJournal(record, journalPath); return record; };

  const { state, problem } = readRememberedState(rememberedPath);
  if (problem) {
    return { code: 1, record: journal({ verdict: 'remembered-unreadable', remembered: null, detail: `${problem} — на карту не записано ничего, заводское состояние стоит по физике` }) };
  }
  if (!state) {
    return { code: 0, record: journal({ verdict: 'no-remembered-state', remembered: null, detail: 'запомненного состояния нет — заводское по физике, записей ноль' }) };
  }

  // The logon race (config.BOOT_PROBE_*): the driver may not answer yet. Bounded retries, then a
  // loud give-up with zero writes — factory stands, the journal says why.
  let card = null;
  let probeAttempts = 0;
  let probeError = null;
  for (let i = 0; i < retries; i++) {
    probeAttempts++;
    try { card = probe(); probeError = null; break; } catch (e) { probeError = e; }
    if (i < retries - 1) await sleep(retryIntervalMs);
  }
  if (!card) {
    return { code: 1, record: journal({ verdict: 'driver-gave-up', remembered: state.profile, probeAttempts, detail: `драйвер не ответил за ${probeAttempts} попыток: ${probeError?.message} — записей ноль, заводское состояние стоит по физике` }) };
  }

  const b = backend ?? nvidiaSmiBackend();
  const { profile, refusals } = loadProfileByName(state.profile, card);
  if (refusals.length) {
    return {
      code: 1,
      record: journal({
        verdict: 'degraded-to-factory', remembered: state.profile, probeAttempts,
        detail: `запомненный профиль отвергнут теми же воротами, записей ноль, заводское стоит: ${refusals.map((r) => `${r.field} — ${r.why}`).join('; ')}`,
      }),
    };
  }

  if (isFactoryProfile(profile) && !requiresQualification(profile)) {
    const s = readState(b);
    if (Math.abs(s.powerLimitW - s.powerDefaultW) < WATT_EPSILON) {
      return { code: 0, record: journal({ verdict: 'factory-by-physics', remembered: state.profile, probeAttempts, powerLimitW: s.powerLimitW, detail: 'запомнено заводское, карта заводская — записей ноль' }) };
    }
    const r = await resetToFactory(b, { timing });
    return { code: 0, record: journal({ verdict: 'factory-restored', remembered: state.profile, probeAttempts, powerLimitW: r.after.powerLimitW, detail: `запомнено заводское, карта была ${r.before.powerLimitW} Вт — сброшена и перечитана: ${r.after.powerLimitW} Вт` }) };
  }

  try {
    const r = await apply(b, profile, { card, timing });
    return { code: 0, record: journal({ verdict: 'applied', remembered: state.profile, probeAttempts, powerLimitW: r.after.powerLimitW, detail: `применено и перечитано: ${r.after.powerLimitW} Вт / ${r.after.clockMhz} МГц` }) };
  } catch (e) {
    if (e.refusals) {
      return { code: 1, record: journal({ verdict: 'degraded-to-factory', remembered: state.profile, probeAttempts, detail: `применитель отказал ДО записи, заводское стоит: ${e.message.split('\n').join(' · ')}` }) };
    }
    return { code: 1, record: journal({ verdict: 'apply-failed-rolled-back', remembered: state.profile, probeAttempts, detail: `применение провалилось, откат внутри применителя отработал: ${e.message.split('\n').join(' · ')}` }) };
  }
}

// ===============================================================================================
// CLI
// ===============================================================================================

function mustLoad(name, card) {
  const { profile, refusals } = loadProfileFile(profilePath(name), card);
  if (refusals.length) {
    console.error(`ОТКАЗ профиль «${name}»:`);
    for (const r of refusals) console.error(`    ${r.field}: ${r.why}`);
    process.exit(1);
  }
  return profile;
}

function printState(s, label) {
  console.log(`${label}: ${s.powerLimitW} Вт (заводской ${s.powerDefaultW}, диапазон ${s.powerMinW}…${s.powerMaxW}) · частота ${s.clockMhz} МГц · драйвер ${s.driver} · VBIOS ${s.vbios}`);
}

async function cmdVerifyStamps(card) {
  const files = listProfileFiles();
  let bad = 0;
  console.log(`ШТАМПЫ · карта: драйвер ${card.driver}, VBIOS ${card.vbios}`);
  for (const f of files) {
    const { profile, refusals } = loadProfileFile(f, card);
    const base = path.basename(f);
    if (refusals.length) { bad++; console.log(`ОТКАЗ ${base}: ${refusals.map((r) => `${r.field} — ${r.why}`).join('; ')}`); continue; }
    console.log(isFactoryProfile(profile)
      ? `OK   ${base} — заводской, штамп не нужен`
      : `OK   ${base} — доказан на драйвере ${profile.stamp.driver}, VBIOS ${profile.stamp.vbios}; сходится с картой`);
  }
  console.log(`ИТОГ: профилей ${files.length}, расхождений ${bad}.`);
  return bad === 0 ? 0 : 1;
}

// -----------------------------------------------------------------------------------------------
// The selftest — injected backends, no GPU touched. Every block is a lie the real card told us once,
// or a lie it plausibly could tell.
// -----------------------------------------------------------------------------------------------

const FAST = { intervalMs: 1, timeoutMs: 60 };

const SELFTEST_CARD = Object.freeze({
  driver: '610.88',
  vbios: '98.03.58.40.8b',
  power: { current: 300, default: 300, min: 250, max: 300 },
  ladder: { ok: true, rung: 810, mhz: [180, 1192, 1200, 1207, 2130, 3090] },
});

const silentColdFixture = () => ({
  name: 'silent-cold',
  title: '❄️ Silent Cold',
  qualified: true,
  settings: { powerLimitWatts: 250, graphicsClockLockMhz: { min: 1200, max: 1200 } },
  stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: '2026-08-10T10:00:00+03:00' },
});

const factoryFixture = () => ({
  name: 'factory',
  title: '🔄 Сброс к заводским',
  settings: { powerLimitWatts: null, graphicsClockLockMhz: null },
});

/**
 * A scriptable stand-in for the card.
 *   staleReads  — how many reads after a write still report the OLD value (the real card did this)
 *   lieOn       — an operation that returns exit 0 and a cheerful message while changing NOTHING
 *   flashOn     — an operation whose value appears for exactly ONE read and then goes back. This is
 *                 the ONLY scenario in which the second agreeing sample earns its keep, and it was
 *                 found by mutation: with just the stale-read block, cutting the rule to a single
 *                 sample left the suite green (the stale value fails the expectation anyway, so the
 *                 streak was never what saved us). A wandering clock brushing past the target is
 *                 physically plausible — it wanders 810…1065 — and a single read would call it done.
 *   failOn      — an operation that returns a non-zero exit
 *   wander      — the values an UNLOCKED idle clock walks through (observed 810…1065)
 */
function fakeBackend({ staleReads = 0, lieOn = null, flashOn = null, failOn = null, wander = [810, 940, 1065] } = {}) {
  const st = { powerLimitW: 300, defaultW: 300, lockedTo: null, wanderAt: 0 };
  let stale = 0;
  let flash = null;
  let previous = { powerLimitW: 300, clockMhz: 810 };

  const liveClock = () => (st.lockedTo !== null ? st.lockedTo : wander[(st.wanderAt++) % wander.length]);

  const back = {
    name: 'fake',
    writes: [],
    query(fields) {
      const live = { powerLimitW: st.powerLimitW, clockMhz: liveClock() };
      let shown;
      if (flash && flash.reads > 0) {
        flash.reads--;
        shown = { powerLimitW: flash.powerLimitW ?? live.powerLimitW, clockMhz: flash.clockMhz ?? live.clockMhz };
      } else {
        shown = stale > 0 ? (stale--, previous) : live;
        if (stale === 0) previous = live;
      }
      const map = {
        driver_version: '610.88',
        vbios_version: '98.03.58.40.8b',
        'power.limit': shown.powerLimitW.toFixed(2),
        'power.default_limit': st.defaultW.toFixed(2),
        'power.min_limit': '250.00',
        'power.max_limit': '300.00',
        'clocks.gr': String(shown.clockMhz),
      };
      return Object.fromEntries(fields.map((f) => [f, map[f]]));
    },
    setPowerLimitWatts(w) {
      back.writes.push(`pl:${w}`);
      if (failOn === 'power') return { ok: false, status: 3, stdout: '', stderr: 'отказано (подставная ошибка)' };
      if (lieOn !== 'power') { previous = { powerLimitW: st.powerLimitW, clockMhz: liveClock() }; st.powerLimitW = w; stale = staleReads; }
      return { ok: true, status: 0, stdout: `Power limit for GPU 0 was set to ${w}.00 W from 300.00 W.` };
    },
    lockGraphicsClocksMhz(min) {
      back.writes.push(`lgc:${min}`);
      if (failOn === 'lock') return { ok: false, status: 3, stdout: '', stderr: 'отказано (подставная ошибка)' };
      if (flashOn === 'lock') { flash = { reads: 1, clockMhz: min }; return { ok: true, status: 0, stdout: 'All done.' }; }
      if (lieOn !== 'lock') { previous = { powerLimitW: st.powerLimitW, clockMhz: liveClock() }; st.lockedTo = min; stale = staleReads; }
      return { ok: true, status: 0, stdout: 'All done.' };
    },
    resetGraphicsClocks() {
      back.writes.push('rgc');
      if (failOn === 'reset') return { ok: false, status: 3, stdout: '', stderr: 'отказано (подставная ошибка)' };
      if (lieOn !== 'reset') { previous = { powerLimitW: st.powerLimitW, clockMhz: st.lockedTo ?? liveClock() }; st.lockedTo = null; stale = staleReads; }
      return { ok: true, status: 0, stdout: 'All done.' };
    },
    _state: st,
  };
  return back;
}

async function cmdSelftest() {
  const blocks = [];
  const block = (what, fn) => blocks.push({ what, fn });

  block('чистое применение Silent Cold -> обе записи прошли и перечитаны', async () => {
    const b = fakeBackend();
    const r = await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
    if (b._state.powerLimitW !== 250) return `потолок остался ${b._state.powerLimitW}`;
    if (b._state.lockedTo !== 1200) return `частота не зафиксирована (${b._state.lockedTo})`;
    if (r.after.powerLimitW !== 250 || r.after.clockMhz !== 1200) return `перечитанное состояние не совпало: ${JSON.stringify(r.after)}`;
    return null;
  });

  block('карта возвращает СТАРОЕ значение один раз -> модуль дожидается НОВОГО, а не верит первой пробе', async () => {
    const b = fakeBackend({ staleReads: 1 });
    const r = await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
    if (r.after.powerLimitW !== 250) return `принято устаревшее значение: ${r.after.powerLimitW} Вт`;
    if (r.after.clockMhz !== 1200) return `принята устаревшая частота: ${r.after.clockMhz} МГц`;
    return null;
  });

  block('карта МИГНУЛА нужной частотой на одну пробу и ушла обратно -> НЕ принято (за это и платим второй пробой)', async () => {
    const b = fakeBackend({ flashOn: 'lock' });
    try {
      await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
      return 'принято по одной пробе — мимолётное совпадение засчитано как результат';
    } catch (e) {
      if (!/перечитывание не сошлось/u.test(e.message)) return `провал не по той причине: ${e.message}`;
      return null;
    }
  });

  block('успешный текст утилиты при неизменившемся состоянии -> применение ПРОВАЛЕНО, а не принято', async () => {
    const b = fakeBackend({ lieOn: 'lock' });
    try {
      await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
      return 'применение прошло, хотя частота не менялась — поверили stdout';
    } catch (e) {
      if (!/перечитывание не сошлось/u.test(e.message)) return `провал не по той причине: ${e.message}`;
      return null;
    }
  });

  // The two blocks below guard the deferral added 2026-08-10, when the card showed that a HIGH lock is
  // invisible at idle (config.LOCK_IS_OBSERVABLE_AT_IDLE). The fake with `lieOn: 'lock'` reproduces
  // exactly that: the write is accepted, the clock keeps wandering. The pair matters more than either
  // half — one proves the relaxation exists, the other proves it did NOT leak into the default path.
  block('режим deferred: частота не встала на простое -> применение НЕ падает, но доставка помечена НЕдоказанной', async () => {
    const b = fakeBackend({ lieOn: 'lock' });
    const r = await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST, verifyLock: 'deferred' });
    if (!r.applied) return 'применение провалилось, хотя проверка отложена под нагрузку';
    if (r.lockProof !== 'deferred-to-load') return `доставка не помечена отложенной: ${r.lockProof}`;
    if (!r.steps.some((s) => /КОМАНДА ОТДАНА/u.test(s))) return 'в журнале нет пометки, что доставка не доказана';
    return null;
  });

  block('режим deferred НЕ становится умолчанием: тот же подставной сценарий по умолчанию по-прежнему ПРОВАЛЕН', async () => {
    const b = fakeBackend({ lieOn: 'lock' });
    try {
      await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
      return 'по умолчанию применение прошло — послабление протекло в строгий путь';
    } catch (e) {
      if (!/перечитывание не сошлось/u.test(e.message)) return `провал не по той причине: ${e.message}`;
      return null;
    }
  });

  block('отказ МЕЖДУ двумя записями -> потолок мощности возвращён на исходный (P2-AC4)', async () => {
    const b = fakeBackend({ failOn: 'lock' });
    try {
      await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
      return 'применение не провалилось, хотя фиксация частоты отказала';
    } catch (e) {
      if (b._state.powerLimitW !== 300) return `на карте остался частичный профиль: потолок ${b._state.powerLimitW} Вт вместо 300`;
      if (b._state.lockedTo !== null) return 'осталась фиксация частоты';
      if (!/ОТКАТ/u.test(e.message)) return 'в сообщении нет следа отката';
      return null;
    }
  });

  block('отказ на ПЕРВОЙ записи -> откатывать нечего, карта не тронута', async () => {
    const b = fakeBackend({ failOn: 'power' });
    try {
      await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
      return 'применение не провалилось';
    } catch (e) {
      if (b._state.powerLimitW !== 300 || b._state.lockedTo !== null) return 'карта изменилась, хотя первая же запись отказала';
      return null;
    }
  });

  // Phase 3 §4.2 — the qualification gate (P3-AC3): a draft never reaches the card, the refusal
  // names the reason and the phase that lifts it, and the gate does not catch the factory path.
  block('ЧЕРНОВИК (qualified: false) -> отказ ДО первой записи, причина и фаза названы (P3-AC3)', async () => {
    const b = fakeBackend();
    const p = silentColdFixture();
    p.qualified = false;
    p.mode = 'silent-cold';
    p.draft = { candidate: 'потолок 2400, кривая +180', source: 'STATUS факт 27' };
    try {
      await apply(b, p, { card: SELFTEST_CARD, timing: FAST });
      return 'черновик применён — гейт квалификации не сработал';
    } catch (e) {
      if (b.writes.length !== 0) return `до отказа успели записать: ${b.writes.join(', ')}`;
      if (!/qualified/u.test(e.message)) return `отказ не назвал поле: ${e.message}`;
      if (!/ЧЕРНОВИК/u.test(e.message)) return `отказ не назвал причину черновика: ${e.message}`;
      if (!/фаза 6/u.test(e.message)) return `отказ не назвал фазу, которая его снимет: ${e.message}`;
      return null;
    }
  });

  // `bugs/05` — the gate keyed on «is this factory?» swept in the MEASUREMENT pin, which sets a clock
  // and is therefore not factory, and the whole band sweep died on its first rung. These two blocks
  // are the pair that has to hold FOREVER: the pin goes through, the unqualified MODE does not. One
  // of them alone would let a later edit widen the gate instead of narrowing its subject.
  block('ПРИБОРНЫЙ пин (kind: measurement) ПРОХОДИТ гейт и реально пишется (bugs/05)', async () => {
    const b = fakeBackend();
    const ld = await import('./ladder-descent.mjs');
    // 2130 is ON this fixture card's ladder — the first draft used 2400 and the block went red for a
    // DIFFERENT reason (the ladder check), which is exactly what a block asserting its own subject
    // should do rather than pass by accident.
    const p = ld.candidateProfile(2130, { driver: SELFTEST_CARD.driver, vbios: SELFTEST_CARD.vbios });
    try {
      const r = await apply(b, p, { card: SELFTEST_CARD, timing: FAST, verifyLock: 'deferred' });
      if (r.ok === false) return `прибор отвергнут: ${r.why}`;
      if (!b.writes.length) return 'гейт пропустил, но записи не случилось — пин не встал бы и на карте';
      return null;
    } catch (e) {
      return `прибор не прошёл гейт: ${e.message}`;
    }
  });

  block('а РЕЖИМ-черновик, объявивший себя прибором, гейт НЕ обманывает — формат его отвергает', async () => {
    const b = fakeBackend();
    const p = silentColdFixture();
    p.mode = 'silent-cold';
    p.qualified = false;
    p.kind = 'measurement';                       // ровно та подмена, которой боимся
    try {
      await apply(b, p, { card: SELFTEST_CARD, timing: FAST });
      return 'режим проехал под видом прибора — гейт расширился вместо того, чтобы сузиться';
    } catch (e) {
      if (b.writes.length !== 0) return `до отказа успели записать: ${b.writes.join(', ')}`;
      if (!/kind/u.test(e.message)) return `отказ не назвал поле вида: ${e.message}`;
      return null;
    }
  });

  block('режим-черновик с обеими настройками null -> НЕ применяется как тихий сброс, а отказывает', async () => {
    const b = fakeBackend();
    const p = {
      name: 'max-performance', title: '🚀 Max Perfomance', mode: 'max-performance',
      qualified: false, draft: { candidate: '+180, потолок 3172', source: 'STATUS факты 24, 27' },
      settings: { powerLimitWatts: null, graphicsClockLockMhz: null },
    };
    try {
      await apply(b, p, { card: SELFTEST_CARD, timing: FAST });
      return 'черновик режима с пустыми настройками применился как заводской — клик, который врёт';
    } catch (e) {
      if (b.writes.length !== 0) return `до отказа успели записать: ${b.writes.join(', ')}`;
      return null;
    }
  });

  block('штамп с чужого драйвера -> отказ ДО первой записи (P2-AC5)', async () => {
    const b = fakeBackend();
    const p = silentColdFixture();
    p.stamp.driver = '595.71';
    try {
      await apply(b, p, { card: SELFTEST_CARD, timing: FAST });
      return 'профиль с чужим штампом применён';
    } catch (e) {
      if (b.writes.length !== 0) return `до отказа успели записать: ${b.writes.join(', ')}`;
      if (!/stamp\.driver/u.test(e.message)) return `отказ не назвал поле: ${e.message}`;
      return null;
    }
  });

  block('частота не с лестницы -> отказ ДО первой записи', async () => {
    const b = fakeBackend();
    const p = silentColdFixture();
    p.settings.graphicsClockLockMhz = { min: 1000, max: 1000 };
    try {
      await apply(b, p, { card: SELFTEST_CARD, timing: FAST });
      return 'профиль с частотой не с лестницы применён';
    } catch (e) {
      if (b.writes.length !== 0) return `до отказа успели записать: ${b.writes.join(', ')}`;
      return null;
    }
  });

  block('круговой рейс: применить и откатить -> карта вернулась в исходное (P2-AC3)', async () => {
    const b = fakeBackend();
    const r = await roundTrip(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
    if (!r.ok) return `рейс не сошёлся: ${JSON.stringify(r.compared)}`;
    if (b._state.lockedTo !== null) return 'карта осталась с зафиксированной частотой';
    if (b._state.powerLimitW !== 300) return `потолок остался ${b._state.powerLimitW} Вт`;
    return null;
  });

  block('круговой рейс при отказе применения -> сброс всё равно выполнен, карта не заперта', async () => {
    const b = fakeBackend({ failOn: 'lock' });
    const r = await roundTrip(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
    if (!r.error) return 'ожидалась ошибка применения';
    if (b._state.lockedTo !== null) return 'карта осталась запертой';
    if (b._state.powerLimitW !== 300) return `потолок остался ${b._state.powerLimitW} Вт`;
    return null;
  });

  block('сброс с известной зафиксированной точкой -> уход с неё ДОКАЗАН', async () => {
    const b = fakeBackend();
    await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
    const r = await resetToFactory(b, { knownLockMhz: 1200, timing: FAST });
    if (r.after.clockMhz === 1200) return 'частота осталась на зафиксированной точке';
    if (!r.steps.some((s) => /ушла с 1200/u.test(s))) return `в отчёте нет доказательства ухода: ${r.steps.join(' | ')}`;
    return null;
  });

  block('заводской профиль применяется как обычный -> без особой ветки, -rgc отправлен', async () => {
    const b = fakeBackend();
    await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
    const r = await apply(b, factoryFixture(), { card: SELFTEST_CARD, timing: FAST });
    if (b._state.lockedTo !== null) return 'фиксация не снята';
    if (b._state.powerLimitW !== 300) return `потолок ${b._state.powerLimitW} Вт вместо заводских 300`;
    if (!b.writes.includes('rgc')) return 'команда -rgc не отправлялась';
    if (!r.applied) return 'применение не заявлено выполненным';
    return null;
  });

  block('перечитывание не сходится вовсе -> ошибка по тайм-ауту, а НЕ последняя проба', async () => {
    const b = fakeBackend({ lieOn: 'power' });
    try {
      await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });
      return 'применение прошло, хотя потолок не менялся';
    } catch (e) {
      if (!/перечитывание не сошлось/u.test(e.message)) return `не та ошибка: ${e.message}`;
      if (!/НЕ принято/u.test(e.message)) return 'ошибка не говорит, что значение отвергнуто';
      return null;
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Phase 3 §4.4 — the boot re-apply. Sandboxed tmpdir per block (EXP-0025: a test that writes into
  // the production directory fabricates forensics); injected probe and loader; fakeBackend as card.
  // ---------------------------------------------------------------------------------------------

  const bootSandbox = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kago-boot-'));
    return { rem: path.join(dir, 'remembered-state.json'), jr: path.join(dir, 'boot-apply.jsonl') };
  };
  const journalLines = (jr) => {
    try { return fsReadFileSync(jr, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; }
  };
  const bootOpts = (b, sb, extra = {}) => ({
    backend: b, probe: () => SELFTEST_CARD, rememberedPath: sb.rem, journalPath: sb.jr,
    retries: 3, retryIntervalMs: 1, timing: FAST,
    loadProfileByName: () => ({ profile: silentColdFixture(), refusals: [] }),
    ...extra,
  });

  block('загрузка: запомненного состояния НЕТ -> ноль записей, вердикт назван, журнал получил строку', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    const r = await bootApply(bootOpts(b, sb));
    if (r.record.verdict !== 'no-remembered-state') return `вердикт ${r.record.verdict}`;
    if (r.code !== 0) return `код ${r.code} вместо 0 — «ничего не запомнено» не ошибка`;
    if (b.writes.length !== 0) return `на карту писали: ${b.writes.join(', ')}`;
    if (journalLines(sb.jr).length !== 1) return `в журнале ${journalLines(sb.jr).length} строк вместо 1`;
    return null;
  });

  block('загрузка: запомнено заводское, карта заводская -> заводское ПО ФИЗИКЕ, ноль записей', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'factory' }, sb.rem);
    const r = await bootApply(bootOpts(b, sb, { loadProfileByName: () => ({ profile: factoryFixture(), refusals: [] }) }));
    if (r.record.verdict !== 'factory-by-physics') return `вердикт ${r.record.verdict}`;
    if (b.writes.length !== 0) return `на карту писали: ${b.writes.join(', ')}`;
    return null;
  });

  block('загрузка: запомнено заводское, а карта НЕ заводская -> восстановлена и перечитана', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    await apply(b, silentColdFixture(), { card: SELFTEST_CARD, timing: FAST });   // карта: 250 Вт + фиксация
    writeRememberedState({ profile: 'factory' }, sb.rem);
    const r = await bootApply(bootOpts(b, sb, { loadProfileByName: () => ({ profile: factoryFixture(), refusals: [] }) }));
    if (r.record.verdict !== 'factory-restored') return `вердикт ${r.record.verdict}`;
    if (b._state.powerLimitW !== 300 || b._state.lockedTo !== null) return `карта не заводская: ${b._state.powerLimitW} Вт, фиксация ${b._state.lockedTo}`;
    return null;
  });

  block('загрузка: запомнен профиль -> применён через ТЕ ЖЕ ворота и перечитан', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'silent-cold' }, sb.rem);
    const r = await bootApply(bootOpts(b, sb));
    if (r.record.verdict !== 'applied') return `вердикт ${r.record.verdict}: ${r.record.detail}`;
    if (b._state.powerLimitW !== 250 || b._state.lockedTo !== 1200) return `карта не в профиле: ${b._state.powerLimitW} Вт, фиксация ${b._state.lockedTo}`;
    return null;
  });

  block('загрузка: запомнен ЧЕРНОВИК -> деградация к заводскому, НОЛЬ записей, причина в журнале', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'optimised' }, sb.rem);
    const draft = () => {
      const p = silentColdFixture();
      p.name = 'optimised'; p.mode = 'optimised'; p.qualified = false;
      p.draft = { candidate: 'кривая +180, -pl 250', source: 'STATUS факт 27' };
      return p;
    };
    const r = await bootApply(bootOpts(b, sb, { loadProfileByName: () => ({ profile: draft(), refusals: [] }) }));
    if (r.record.verdict !== 'degraded-to-factory') return `вердикт ${r.record.verdict}`;
    if (r.code !== 1) return `код ${r.code} вместо 1 — деградация обязана быть громкой`;
    if (b.writes.length !== 0) return `до отказа успели записать: ${b.writes.join(', ')}`;
    if (!/qualified|ЧЕРНОВИК/u.test(r.record.detail)) return `журнал не назвал причину: ${r.record.detail}`;
    return null;
  });

  block('загрузка: драйвер не готов две пробы -> повторы ДОЖАЛИ, применение прошло', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'silent-cold' }, sb.rem);
    let calls = 0;
    const probe = () => { calls++; if (calls < 3) throw new Error('NVIDIA-SMI has failed'); return SELFTEST_CARD; };
    const r = await bootApply(bootOpts(b, sb, { probe, retries: 5 }));
    if (r.record.verdict !== 'applied') return `вердикт ${r.record.verdict}`;
    if (r.record.probeAttempts !== 3) return `попыток ${r.record.probeAttempts} вместо 3`;
    return null;
  });

  block('загрузка: драйвер так и НЕ ответил -> громкий отказ в журнал, ноль записей, заводское по физике', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'silent-cold' }, sb.rem);
    const r = await bootApply(bootOpts(b, sb, { probe: () => { throw new Error('NVIDIA-SMI has failed'); }, retries: 2 }));
    if (r.record.verdict !== 'driver-gave-up') return `вердикт ${r.record.verdict}`;
    if (r.code !== 1) return `код ${r.code} вместо 1`;
    if (r.record.probeAttempts !== 2) return `попыток ${r.record.probeAttempts} вместо 2`;
    if (b.writes.length !== 0) return `на карту писали: ${b.writes.join(', ')}`;
    return null;
  });

  block('загрузка: файл состояния ПОВРЕЖДЁН -> не падение и не догадка, а названная деградация', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    fsWriteFileSync(sb.rem, '{{{ это не JSON');
    const r = await bootApply(bootOpts(b, sb));
    if (r.record.verdict !== 'remembered-unreadable') return `вердикт ${r.record.verdict}`;
    if (b.writes.length !== 0) return `на карту писали: ${b.writes.join(', ')}`;
    if (!/JSON/u.test(r.record.detail)) return `журнал не назвал проблему: ${r.record.detail}`;
    return null;
  });

  block('журнал загрузки ДОПИСЫВАЕТСЯ, а не перезаписывается: два прогона -> две строки (мера P3-AC2)', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    await bootApply(bootOpts(b, sb));
    await bootApply(bootOpts(b, sb));
    const lines = journalLines(sb.jr);
    if (lines.length !== 2) return `строк ${lines.length} вместо 2 — серия из пяти логонов несчитаема`;
    return null;
  });

  block('загрузка НЕ переписывает запомненное состояние: восстановление — не новое решение владельца', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'silent-cold' }, sb.rem);
    const before = fsReadFileSync(sb.rem, 'utf8');
    await bootApply(bootOpts(b, sb));
    const after = fsReadFileSync(sb.rem, 'utf8');
    if (before !== after) return 'файл состояния изменился после boot-apply';
    return null;
  });

  let failed = 0;
  for (const b of blocks) {
    let problem;
    try {
      problem = await b.fn();
    } catch (e) {
      problem = `блок сам упал: ${e.message}`;
    }
    if (problem === null || problem === undefined) {
      console.log(`OK   ${b.what}`);
    } else {
      failed++;
      console.log(`ПРОВАЛ ${b.what}`);
      console.log(`       ${problem}`);
    }
  }
  console.log('');
  console.log(`САМОПРОВЕРКА ПРИМЕНЕНИЯ: ${blocks.length} блоков, провалов ${failed}.`);
  return failed === 0 ? 0 : 1;
}

// ===============================================================================================

async function main(argv) {
  if (argv.includes('--selftest')) return cmdSelftest();

  // BEFORE the unconditional probe below: at logon the driver may not answer yet, and the bounded
  // retry lives INSIDE bootApply — a probe thrown here would defeat it (§4.4, the logon race).
  if (argv.includes('--boot-apply')) {
    console.log('ВОССТАНОВЛЕНИЕ ПРИ ВХОДЕ — запомненное состояние через те же ворота применителя.');
    const { code, record } = await bootApply({});
    console.log(`  ВЕРДИКТ  ${record.verdict}${record.remembered ? ` («${record.remembered}»)` : ''}`);
    console.log(`  ${record.detail}`);
    console.log(`  ЖУРНАЛ   ${BOOT_JOURNAL_PATH}`);
    return code;
  }

  const backend = nvidiaSmiBackend();
  const card = probeCard();

  const argOf = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : null;
  };

  if (argv.includes('--verify-stamps')) return cmdVerifyStamps(card);

  if (argv.includes('--state') || argv.length === 0) {
    printState(readState(backend), 'КАРТА СЕЙЧАС');
    return 0;
  }

  const rt = argOf('--roundtrip');
  if (rt) {
    const profile = mustLoad(rt, card);
    console.log(`КРУГОВОЙ РЕЙС «${profile.name}» — применить, перечитать, откатить, перечитать.`);
    console.log('ОТКАТ НАЗВАН ДО ЗАПИСИ: -rgc (документированный сброс частоты) + -pl на заводские ватты карты.');
    const r = await roundTrip(backend, profile, { card });
    printState(r.initial, 'ДО      ');
    if (r.applied) for (const s of r.applied.steps) console.log(`  ПРИМЕНЕНО  ${s}`);
    if (r.error) console.log(`  ОШИБКА     ${r.error.message}`);
    for (const s of r.reset.steps) console.log(`  СБРОС      ${s}`);
    printState(r.final, 'ПОСЛЕ   ');
    for (const c of r.compared) console.log(`  ${c.same ? 'СОВПАЛО ' : 'РАЗОШЛОСЬ'} ${c.field}: ${c.initial} → ${c.final}`);
    console.log(r.ok ? 'ИТОГ: рейс сошёлся — карта вернулась туда, откуда начали.' : 'ИТОГ: РЕЙС НЕ СОШЁЛСЯ.');
    return r.ok ? 0 : 1;
  }

  const ap = argOf('--apply');
  if (ap) {
    const profile = mustLoad(ap, card);
    console.log(`ПРИМЕНЕНИЕ «${profile.name}» — «${profile.title}»`);
    console.log('ОТКАТ НАЗВАН ДО ЗАПИСИ: npm run profile -- --reset (то же, что третий ярлык владельца).');
    const r = await apply(backend, profile, { card });
    printState(r.before, 'ДО      ');
    for (const s of r.steps) console.log(`  ${s}`);
    printState(r.after, 'ПОСЛЕ   ');
    // The remembered state (§4.4) — written HERE, in the owner-facing CLI, never inside apply():
    // measurement tools drive the library and must not move the boot state. Only after the verified
    // apply above — a throw has already exited.
    const rec = writeRememberedState({ profile: profile.name, title: profile.title ?? null, stamp: profile.stamp ?? null });
    console.log(`ЗАПОМНЕНО для автозагрузки: «${rec.profile}» (${REMEMBERED_STATE_PATH})`);
    return 0;
  }

  if (argv.includes('--reset')) {
    console.log('СБРОС К ЗАВОДСКИМ — -rgc плюс заводской потолок мощности карты.');
    const r = await resetToFactory(backend);
    printState(r.before, 'ДО      ');
    for (const s of r.steps) console.log(`  ${s}`);
    printState(r.after, 'ПОСЛЕ   ');
    // Reset is a mode like the others (internal map §4): it writes the same remembered state.
    const factory = loadProfileFile(profilePath('factory')).profile;
    const rec = writeRememberedState({ profile: 'factory', title: factory?.title ?? 'заводское состояние', stamp: null });
    console.log(`ЗАПОМНЕНО для автозагрузки: «${rec.profile}» (${REMEMBERED_STATE_PATH})`);
    return 0;
  }

  console.error('Команды: --state · --apply <имя> · --reset · --boot-apply · --roundtrip <имя> · --verify-stamps · --selftest');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
