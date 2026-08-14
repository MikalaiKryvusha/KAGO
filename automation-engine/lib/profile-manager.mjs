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

/**
 * THE CURVE BACKEND — the second half of R2's «backends are swappable», and the one the internal map
 * §4 already predicted: *«the applier composes the NVAPI backend (the curve) with the `nvidia-smi`
 * backend (`-pl`) in one profile»*.
 *
 * R1 IS UNTOUCHED, and that is worth stating because it looks like a new writer. `profile-manager`
 * stays the only module that DECIDES to write; this object is a thin seam over `nvapi`'s existing
 * primitives (`buildRaiseAndCapVector` · `writeCurve` · `zeroCurve` · `readVfOffsets`), each already
 * proved by its own suite. Nothing here computes the vector — the arithmetic has one author.
 *
 * WHY IT IS A FACTORY AND NOT A MODULE-LEVEL SINGLETON: the NVAPI handle has to be opened, used and
 * unloaded around the apply, and a caller that forgets to close it leaves the library loaded in a
 * process that may go on to do something else. `close()` is the whole reason this shape exists.
 *
 * UNITS ARE CONVERTED HERE, ONCE. The device speaks kHz (`writeVfOffset` takes `offsetMhz * 1000`,
 * `readVfOffsets` returns the raw kHz field); everything above this line speaks MHz. A unit that gets
 * converted in two places is a unit that will be converted twice somewhere (EXP-0034 — the search
 * once reported a conclusion in the wrong unit entirely).
 *
 * POINT 127 IS EXCLUDED, and by the same constant the writer uses — it is measured to be an outlier
 * (515 mV / 405 MHz beside a neighbour at 1240 mV / 3157 MHz) and no whole-curve operation touches it.
 * The read is therefore truncated to the SAME count, so a comparison is between like and like.
 *
 * [NOT-TESTED] live — the injected twin in the selftest proves the SHAPE; this proves nothing until it
 * runs on the card, and the profile it applies is a draft until the owner's acceptance says otherwise.
 */
export function nvapiCurveBackend({ nvapi = null } = {}) {
  let nv = null;
  let handle = null;
  let mod = null;

  const open = async () => {
    if (nv) return;
    mod = nvapi ?? await import('./nvapi.mjs');
    nv = mod.openNvapi();
    nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
    const handles = Buffer.alloc(64 * 8);
    const count = Buffer.alloc(4);
    nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
    handle = handles.readBigUInt64LE(0);
  };

  const COUNT = () => (mod.CLK_VF_POINT_COUNT ?? 128) - 1;

  return {
    async writeRaiseAndCap(deltaMhz, capMhz) {
      await open();
      const curve = mod.readVfCurve(nv, handle);
      if (!curve.ok) return { ok: false, why: `кривая не прочиталась: ${curve.why}` };
      // `capMhz: null` reaches `buildRaiseAndCapVector` as `null`, which is its own documented way of
      // saying «cap at the curve's top», i.e. a UNIFORM raise with nothing pushed down.
      const vec = mod.buildRaiseAndCapVector(curve.points, deltaMhz, { capMhz });
      if (!vec.ok) return { ok: false, why: `вектор не построился: ${vec.why}` };
      // THE HOLDER CHECK, HERE TOO — the format already refuses a cap below the curve's floor, and this
      // is the same rule at the moment of writing, where the CARD's own top is in hand rather than the
      // ladder's. Two checks of one fact is not duplication when one of them is the last line before a
      // device write (R11, `bugs/02`).
      if (vec.capIsBelowTop && vec.capEnforced === false) {
        return { ok: false, why: `потолок ${capMhz} МГц кривой не удержать: утечка ${vec.capLeakMhz} МГц, `
          + `пол ${vec.lowestEnforceableCapMhz} МГц (R11)` };
      }
      const w = mod.writeCurve(nv, handle, vec.offsets, { count: COUNT() });
      if (!w.ok) return { ok: false, why: `запись кривой: ${w.failed} точек из ${COUNT()} не записались` };
      return { ok: true, vector: vec.offsets.slice(0, COUNT()) };
    },

    async readCurveOffsets() {
      await open();
      const r = mod.readVfOffsets(nv, handle);
      if (!r.ok) return { ok: false, why: r.why ?? `статус ${r.status}` };
      // kHz -> MHz, and truncated to the written count so the comparison is like for like.
      return { ok: true, offsets: r.offsets.slice(0, COUNT()).map((khz) => Math.round(khz / 1000)) };
    },

    async zeroCurve() {
      await open();
      const z = mod.zeroCurve(nv, handle, { count: COUNT() });
      if (!z.ok) return { ok: false, why: `обнуление: осталось ненулевых ${z.remainingNonZero}, не записалось ${z.failed}` };
      return { ok: true };
    },

    close() {
      if (!nv) return;
      try { nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload); } catch { /* закрытие не должно ронять вызывающего */ }
      nv = null; handle = null;
    },
  };
}

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
export async function apply(backend, profile, {
  card, timing = {}, verifyLock = 'idle', curveBackend = null,
  // THE ONE NAMED WAY PAST THE QUALIFICATION GATE (`plans/11` §4.4, P6-AC4), and it is a PARAMETER
  // rather than a doctored profile object. The first draft of the witness path passed
  // `{ ...profile, qualified: true }` — and the format refused it, correctly, because a qualified
  // profile may not carry a `draft` block. That refusal was a gift: a caller that edits the artifact
  // to get past a check makes the artifact lie, and the next reader cannot tell a spoof from an
  // acceptance. An explicit flag says «I am knowingly applying a draft» in the one place that can
  // audit it, and leaves the file untouched.
  witness = false,
} = {}) {
  const before = readState(backend);

  // R6 and the format, both before the first write (P2-AC5).
  const refusals = validateProfile(profile, { card });
  refusals.push(...checkStamp(profile, card ?? { driver: before.driver, vbios: before.vbios }));
  // THE QUALIFICATION GATE (phase 3, P3-AC3): a draft is a VALID file the format accepts and the
  // list shows — and a state this module never puts on the card. The refusal names the reason and
  // the phase that lifts it, and it sits here, in the one writer (R1), not in the shortcut layer:
  // whatever surface calls apply() — CLI, .lnk, the logon task — meets the same gate.
  if (requiresQualification(profile) && profile.qualified !== true && !witness) {
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

  // --- THE CURVE, FIRST (`plans/11` §4.2) -------------------------------------------------------
  //
  // First in the order for the same reason it is zeroed first in the reset: it is the step whose undo
  // is cheapest and most total. If a later step fails, the rollback walks back over a curve-zero that
  // always works; if the curve itself fails, nothing else has been written yet.
  //
  // A profile that asks for a curve and gets NO curve backend is REFUSED, not applied without it. This
  // is the whole reason the format kept the key out until today: a profile that reads as raising the
  // curve while the applier quietly ignores it is the defect `profiles/README.md` is written against.
  const wantCurve = profile.settings.curveRaiseAndCapMhz ?? null;
  if (wantCurve) {
    if (!curveBackend) {
      const err = new Error(`профиль «${profile.name}» задаёт кривую V/F, а бэкенд кривой не передан — `
        + 'применять его частично запрещено: это профиль, который читается как поднимающий кривую, а на деле её не трогает');
      err.refusals = [{ field: 'settings.curveRaiseAndCapMhz', why: 'нет бэкенда кривой' }];
      throw err;
    }
    steps.push({
      what: `кривая V/F: подъём +${wantCurve.deltaMhz} МГц с потолком ${wantCurve.capMhz} МГц`,
      run: async () => {
        const w = await curveBackend.writeRaiseAndCap(wantCurve.deltaMhz, wantCurve.capMhz);
        if (!w.ok) throw new Error(`запись кривой не удалась: ${w.why ?? 'причина не названа'}`);
        // P6-AC3 — PROVED BY READ-BACK, never by a status code. `nvidia-smi` already taught this
        // project that a tool's own success text is not evidence (`researches/01` §5), and the curve
        // is written through an UNDOCUMENTED struct, where the standard of proof has to be higher.
        const back = await curveBackend.readCurveOffsets();
        if (!back.ok) throw new Error(`кривая записана, но перечитать не смогли: ${back.why ?? 'причина не названа'}`);
        const want = w.vector;
        const mismatch = back.offsets.findIndex((v, i) => v !== want[i]);
        if (mismatch !== -1) {
          // A STEP THAT KNOWS IT WROTE CLEANS UP AFTER ITSELF. The outer rollback only walks steps that
          // COMPLETED, so a verify failure here would otherwise leave the curve on the card while the
          // apply reports a refusal — an undervolt applied under a message saying nothing was applied.
          // Found by the block «расхождение при перечитывании», which is why it exists.
          let cleanup = '';
          try {
            const z = await curveBackend.zeroCurve();
            cleanup = z.ok ? ' Кривая обнулена.' : ` ОБНУЛИТЬ КРИВУЮ НЕ УДАЛОСЬ: ${z.why ?? 'причина не названа'}.`;
          } catch (e) {
            cleanup = ` ОБНУЛИТЬ КРИВУЮ НЕ УДАЛОСЬ: ${e.message}.`;
          }
          throw new Error(`перечитанная кривая не совпала с записанной: точка ${mismatch} — записывали ${want[mismatch]}, прочитали ${back.offsets[mismatch]}.${cleanup}`);
        }
        return { value: sampleWritable(backend), samples: [], proof: 'curve-read-back' };
      },
      undo: async () => {
        const z = await curveBackend.zeroCurve();
        if (!z.ok) throw new Error(`ОТКАТ кривой не удался: ${z.why ?? 'причина не названа'}`);
        const back = await curveBackend.readCurveOffsets();
        if (!back.ok) throw new Error(`кривую откатили, но перечитать не смогли: ${back.why ?? 'причина не названа'}`);
        const nonZero = back.offsets.filter((v) => v !== 0).length;
        if (nonZero !== 0) throw new Error(`ОТКАТ кривой неполон: ненулевых смещений ${nonZero}`);
        return { value: sampleWritable(backend), samples: [], proof: 'curve-zeroed' };
      },
    });
  } else if (curveBackend && profile.settings.curveRaiseAndCapMhz === null) {
    // `null` means the card's factory value — the same convention every other setting obeys. For the
    // curve that is «zero every offset», and it is what makes `factory.json` a reset of ALL state
    // rather than of the two settings that existed before today.
    steps.push({
      what: 'кривая V/F: возврат к заводской (все смещения 0)',
      run: async () => {
        const z = await curveBackend.zeroCurve();
        if (!z.ok) throw new Error(`обнуление кривой не удалось: ${z.why ?? 'причина не названа'}`);
        const back = await curveBackend.readCurveOffsets();
        if (!back.ok) throw new Error(`кривую обнулили, но перечитать не смогли: ${back.why ?? 'причина не названа'}`);
        const nonZero = back.offsets.filter((v) => v !== 0).length;
        if (nonZero !== 0) throw new Error(`кривая обнулена не полностью: ненулевых смещений ${nonZero}`);
        return { value: sampleWritable(backend), samples: [], proof: 'curve-zeroed' };
      },
      // No undo, and it is the safe direction: re-applying a curve we did not read is not restoring,
      // it is inventing. Going TOWARD factory needs no way back (the same reasoning as `-rgc` below).
    });
  }

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
export async function resetToFactory(backend, { knownLockMhz = null, timing = {}, curveBackend = null } = {}) {
  const before = readState(backend);
  const log = [];

  // THE CURVE IS ZEROED FIRST, AND THE UNDO LEARNED IT BEFORE THE APPLIER COULD WRITE IT (R9a, and
  // `plans/11` §4.2 states the order as a rule rather than a preference). Fans cost this project the
  // lesson: a writer that died holding MANUAL left the owner's idle machine audibly changed with no
  // path back, because the undo had never been taught that kind of state. The curve is the fourth
  // kind, and it is the most dangerous one — an undervolt nobody is holding is a card that can hang.
  //
  // It runs FIRST because it is the state whose absence is safest: a zeroed curve is stock behaviour
  // regardless of what the power limit does next. And a curve backend that is absent is REPORTED, not
  // silently skipped — «reset did nothing about the curve» must never look like «there was no curve».
  if (curveBackend) {
    const z = await curveBackend.zeroCurve();
    if (!z.ok) throw new Error(`обнуление кривой не удалось: ${z.why ?? 'причина не названа'}`);
    const back = await curveBackend.readCurveOffsets();
    const nonZero = back.ok ? back.offsets.filter((v) => v !== 0).length : null;
    if (!back.ok) throw new Error(`кривую обнулили, но перечитать не смогли: ${back.why ?? 'причина не названа'}`);
    if (nonZero !== 0) throw new Error(`кривая обнулена не полностью: ненулевых смещений ${nonZero} из ${back.offsets.length}`);
    log.push(`кривая V/F обнулена — перечитано: 0 ненулевых смещений из ${back.offsets.length}`);
  } else {
    log.push('кривая V/F НЕ трогалась: бэкенд кривой не передан (если профиль её задавал, она осталась на карте)');
  }

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
  settings: { powerLimitWatts: 250, graphicsClockLockMhz: { min: 1200, max: 1200 }, curveRaiseAndCapMhz: null },
  stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: '2026-08-10T10:00:00+03:00' },
});

const factoryFixture = () => ({
  name: 'factory',
  title: '🔄 Сброс к заводским',
  settings: { powerLimitWatts: null, graphicsClockLockMhz: null, curveRaiseAndCapMhz: null },
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
      settings: { powerLimitWatts: null, graphicsClockLockMhz: null, curveRaiseAndCapMhz: null },
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

  // ===============================================================================================
  // THE CURVE IN THE PROFILE (`plans/11` §4.2, P6-AC2 / P6-AC3) — on an INJECTED curve backend, so the
  // undo's shape is provable without a card. Mutation addressees, named before the run:
  //   24. skip the read-back after writing the curve   → «КРИВАЯ: расхождение при перечитывании -> отказ»
  //   25. drop the curve from the undo                 → «КРИВАЯ: падение ПОЗЖЕ откатывает кривую ПО ИМЕНИ»
  //   26. apply a curve profile without a backend      → «КРИВАЯ: профиль просит кривую, бэкенда нет -> ОТКАЗ»
  // ===============================================================================================
  const fakeCurve = ({ writeOk = true, readsBack = 'same', zeroOk = true } = {}) => {
    const state = { offsets: new Array(128).fill(0), calls: [] };
    return {
      state,
      writeRaiseAndCap: async (deltaMhz, capMhz) => {
        state.calls.push(`write:${deltaMhz}:${capMhz}`);
        if (!writeOk) return { ok: false, why: 'подставной отказ записи' };
        const vector = new Array(128).fill(deltaMhz);
        state.offsets = readsBack === 'wrong' ? vector.map((v, i) => (i === 7 ? v - 1 : v)) : [...vector];
        return { ok: true, vector };
      },
      readCurveOffsets: async () => ({ ok: true, offsets: [...state.offsets] }),
      zeroCurve: async () => {
        state.calls.push('zero');
        if (!zeroOk) return { ok: false, why: 'подставной отказ обнуления' };
        state.offsets = new Array(128).fill(0);
        return { ok: true };
      },
    };
  };
  const curveProfile = () => ({
    name: 'optimised',
    title: '⚖️ Optimised',
    mode: 'optimised',
    qualified: true,
    settings: { powerLimitWatts: 250, graphicsClockLockMhz: null, curveRaiseAndCapMhz: { deltaMhz: 592, capMhz: 2130 } },
    stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: '2026-08-15T00:30:00+03:00' },
  });

  block('ЧЕРНОВИК: без witness гейт отвергает; с witness — применяется, и ФАЙЛ НЕ ПОДМЕНЯЕТСЯ', async () => {
    // The gate's both directions in one block, plus the property the first draft got wrong: the
    // profile object must come out of `apply` exactly as it went in. A witness path that doctors
    // `qualified` makes the artifact lie to the next reader (and the format caught it doing so).
    const draft = { ...curveProfile(), qualified: false, draft: { 'что это': 'ЧЕРНОВИК' } };
    const frozen = JSON.stringify(draft);
    try {
      await apply(fakeBackend(), draft, { card: SELFTEST_CARD, timing: FAST, curveBackend: fakeCurve() });
      return 'черновик применился БЕЗ witness — гейт не держит';
    } catch (e) {
      if (!/ЧЕРНОВИК/u.test(e.message)) return `отказ не про квалификацию: ${e.message}`;
    }
    const cb = fakeCurve();
    const r = await apply(fakeBackend(), draft, { card: SELFTEST_CARD, timing: FAST, curveBackend: cb, witness: true });
    if (!r.applied) return 'с witness черновик всё равно не применился';
    if (JSON.stringify(draft) !== frozen) return 'apply ИЗМЕНИЛ профиль — артефакт начал врать читателю';
    if (draft.qualified !== false) return 'qualified подменён — это подделка приёмки';
    return null;
  });

  block('КРИВАЯ: применяется и ДОКАЗЫВАЕТСЯ перечитыванием, а не кодом возврата', async () => {
    const b = fakeBackend(); const cb = fakeCurve();
    const r = await apply(b, curveProfile(), { card: SELFTEST_CARD, timing: FAST, curveBackend: cb });
    if (!r.applied) return 'профиль не применился';
    if (!cb.state.offsets.every((v) => v === 592)) return 'кривая на карте не та, что заказана';
    if (!r.steps.some((s) => s.includes('кривая V/F'))) return 'шаг кривой не попал в журнал применения';
    return null;
  });

  block('КРИВАЯ: расхождение при перечитывании -> ОТКАЗ и откат, а не предупреждение', async () => {
    const b = fakeBackend(); const cb = fakeCurve({ readsBack: 'wrong' });
    try {
      await apply(b, curveProfile(), { card: SELFTEST_CARD, timing: FAST, curveBackend: cb });
      return 'применение прошло, хотя перечитанная кривая не совпала с записанной';
    } catch (e) {
      if (!/не совпал/u.test(e.message)) return `упало не на сверке перечитывания: ${e.message}`;
      if (cb.state.offsets.some((v) => v !== 0)) return 'после отказа кривая осталась на карте';
      return null;
    }
  });

  block('КРИВАЯ: падение ПОЗЖЕ откатывает кривую, и откат назван ПО ИМЕНИ (R9a: никогда по счётчику)', async () => {
    // The power-limit step is made to fail AFTER the curve has been written, so the rollback has to
    // walk back over the curve. Asserted by the step's NAME: a count stays green when one step is
    // deleted and another duplicated, which is exactly what R9a forbids.
    const b = fakeBackend({ failOn: 'power' }); const cb = fakeCurve();
    try {
      await apply(b, curveProfile(), { card: SELFTEST_CARD, timing: FAST, curveBackend: cb });
      return 'применение прошло, хотя шаг потолка мощности должен был упасть';
    } catch (e) {
      const undone = (e.rollback ?? []).join(' | ');
      if (!/кривая V\/F/u.test(undone)) return `в откате нет шага кривой ПО ИМЕНИ: ${undone || '(пусто)'}`;
      if (cb.state.offsets.some((v) => v !== 0)) return 'кривая не обнулена откатом';
      return null;
    }
  });

  block('КРИВАЯ: профиль просит кривую, а бэкенда нет -> ОТКАЗ до единой записи', async () => {
    const b = fakeBackend();
    const before = readState(b);
    try {
      await apply(b, curveProfile(), { card: SELFTEST_CARD, timing: FAST });
      return 'профиль применился БЕЗ кривой — ровно тот дефект, ради которого ключ держали вне settings';
    } catch (e) {
      if (!/бэкенд кривой не передан/u.test(e.message)) return `отказ не про бэкенд кривой: ${e.message}`;
      const after = readState(b);
      if (after.powerLimitW !== before.powerLimitW) return 'потолок мощности успел измениться до отказа';
      return null;
    }
  });

  block('СБРОС обнуляет кривую и доказывает это перечитыванием', async () => {
    const b = fakeBackend(); const cb = fakeCurve();
    cb.state.offsets = new Array(128).fill(592);
    const r = await resetToFactory(b, { timing: FAST, curveBackend: cb });
    if (cb.state.offsets.some((v) => v !== 0)) return 'после сброса кривая осталась на карте';
    if (!r.steps.some((s) => s.includes('кривая V/F обнулена'))) return 'сброс не сказал вслух, что обнулил кривую';
    return null;
  });

  block('СБРОС без бэкенда кривой ГОВОРИТ об этом, а не молчит', async () => {
    const b = fakeBackend();
    const r = await resetToFactory(b, { timing: FAST });
    if (!r.steps.some((s) => s.includes('НЕ трогалась'))) return 'сброс промолчал о том, что кривую не трогал';
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
    // THE WITNESS PATH (`plans/11` §4.4, P6-AC4). An acceptance run needs the mode ON the card, and the
    // mode is a DRAFT until that run judges it — a circle the qualification gate cannot break by
    // itself. This flag is the one way out, and every property of it is chosen so it stays one:
    //
    //   · it is typed by a human, per run, and never lives in a shortcut or a scheduled task;
    //   · it says out loud that the profile is unqualified and what that means;
    //   · it does NOT write the remembered boot state — an unqualified mode must not survive a reboot,
    //     and that is exactly the difference between «applied for a measurement» and «shipped».
    //
    // What it does NOT do is lower the gate: `qualified` is still flipped only by acceptance, and the
    // shortcut path still meets the refusal (its own selftest block proves that).
    const witness = argv.includes('--witness');
    const isDraft = profile.qualified !== true && profile.mode !== undefined;
    // The curve backend is opened only when the profile actually asks for a curve — a profile that
    // sets no curve must not load nvapi64.dll for nothing.
    const needsCurve = (profile.settings?.curveRaiseAndCapMhz ?? null) !== null;
    const curveBackend = needsCurve ? nvapiCurveBackend() : null;

    console.log(`ПРИМЕНЕНИЕ «${profile.name}» — «${profile.title}»`);
    if (witness && isDraft) {
      console.log('⚠️  ПРИЁМОЧНЫЙ ПРОГОН ЧЕРНОВИКА (--witness): числа этого профиля НЕ прошли приёмку.');
      console.log('    Он применяется, чтобы вы его СУДИЛИ, и НЕ запоминается для автозагрузки.');
      console.log('    Ярлык на столе этот профиль по-прежнему отвергает.');
    }
    if (needsCurve) {
      const c = profile.settings.curveRaiseAndCapMhz;
      console.log(`    кривая V/F: подъём +${c.deltaMhz} МГц, ${c.capMhz === null ? 'ПОТОЛКА НЕТ' : `потолок ${c.capMhz} МГц`} (пишется через NVAPI)`);
      if (c.capMhz === null) {
        console.log('    ⚠️  БЕЗ ПОТОЛКА карта уйдёт на частоты ВЫШЕ измеренных: андервольт проверялся');
        console.log('        на точке, обслуживавшей потолок, а выше её обслуживают другие точки.');
      }
    }
    console.log('ОТКАТ НАЗВАН ДО ЗАПИСИ: npm run profile -- --reset (то же, что третий ярлык владельца).');

    let r;
    try {
      r = await apply(backend, profile, { card, curveBackend, witness: witness && isDraft });
    } finally {
      if (curveBackend) curveBackend.close();
    }
    printState(r.before, 'ДО      ');
    for (const s of r.steps) console.log(`  ${s}`);
    printState(r.after, 'ПОСЛЕ   ');
    if (witness && isDraft) {
      console.log('');
      console.log('ЧЕРНОВИК НА КАРТЕ. Запомненное состояние НЕ тронуто — перезагрузка вернёт заводское.');
      console.log('Когда закончите судить: npm run profile -- --reset');
      return 0;
    }
    // The remembered state (§4.4) — written HERE, in the owner-facing CLI, never inside apply():
    // measurement tools drive the library and must not move the boot state. Only after the verified
    // apply above — a throw has already exited.
    const rec = writeRememberedState({ profile: profile.name, title: profile.title ?? null, stamp: profile.stamp ?? null });
    console.log(`ЗАПОМНЕНО для автозагрузки: «${rec.profile}» (${REMEMBERED_STATE_PATH})`);
    return 0;
  }

  if (argv.includes('--reset')) {
    console.log('СБРОС К ЗАВОДСКИМ — обнуление кривой V/F, -rgc и заводской потолок мощности карты.');
    // The reset always opens the curve backend, unconditionally: it is the one path that must return
    // EVERY kind of state this project can write, and it cannot know what the previous run applied
    // (R9a — the undo is total, never differential).
    const curveBackend = nvapiCurveBackend();
    let r;
    try {
      r = await resetToFactory(backend, { curveBackend });
    } finally {
      curveBackend.close();
    }
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
