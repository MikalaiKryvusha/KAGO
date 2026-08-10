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

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  READBACK_AGREEING_SAMPLES,
  READBACK_INTERVAL_MS,
  READBACK_TIMEOUT_MS,
} from '../config.mjs';
import {
  PROFILES_DIR,
  loadProfileFile,
  listProfileFiles,
  validateProfile,
  checkStamp,
  isFactoryProfile,
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
export async function apply(backend, profile, { card, timing = {} } = {}) {
  const before = readState(backend);

  // R6 and the format, both before the first write (P2-AC5).
  const refusals = validateProfile(profile, { card });
  refusals.push(...checkStamp(profile, card ?? { driver: before.driver, vbios: before.vbios }));
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
      log.push(`${step.what} — перечитано: ${proof.value.powerLimitW} Вт / ${proof.value.clockMhz} МГц` +
        (proof.proof === 'reported-only' ? ' (только доложено: снятие несуществующей фиксации доказать нечем)' : ''));
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

  return { applied: true, steps: log, before, after: readState(backend), lockedTo: target.lock ? target.lock.min : null };
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
// CLI
// ===============================================================================================

function profilePath(name) {
  return path.join(PROFILES_DIR, `${name}.json`);
}

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
  settings: { powerLimitWatts: 250, graphicsClockLockMhz: { min: 1200, max: 1200 } },
  stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: '2026-08-10T10:00:00+03:00' },
});

const factoryFixture = () => ({
  name: 'factory',
  title: '⏹ Сброс к заводским',
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
    return 0;
  }

  if (argv.includes('--reset')) {
    console.log('СБРОС К ЗАВОДСКИМ — -rgc плюс заводской потолок мощности карты.');
    const r = await resetToFactory(backend);
    printState(r.before, 'ДО      ');
    for (const s of r.steps) console.log(`  ${s}`);
    printState(r.after, 'ПОСЛЕ   ');
    return 0;
  }

  console.error('Команды: --state · --apply <имя> · --reset · --roundtrip <имя> · --verify-stamps · --selftest');
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
