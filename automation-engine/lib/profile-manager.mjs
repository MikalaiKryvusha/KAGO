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
  appendBootIntent,
  readBootJournal,
  bootLoopBreaker,
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
/**
 * THE FOUR REFUSALS THAT STAND BETWEEN A COMPUTED VECTOR AND THE DEVICE — extracted 2026-08-15 so
 * that the virtual card of epic 03 can be held to the SAME bar rather than to a copy of it.
 *
 * WHY EXTRACTED RATHER THAN DUPLICATED, because it looks like ceremony and is not. A test double is
 * only worth its FIDELITY, and the one way a double silently becomes worthless is by being MORE
 * PERMISSIVE than the thing it stands in for: every later green would then be a lie, and nothing
 * would go red to say so (`researches/10` §2.2 — the industry's whole reason for contract tests).
 * Two copies of these four checks would be a truth↔mirror pair that must be WATCHED; one function
 * called by both is a pair that cannot drift. The registry's own preference, stated in
 * `AGENT_GUIDE.md`: «a pair that can be removed beats a pair that must be watched».
 *
 * Pure: it decides, it does not write. Returns `null` when the write may proceed, or `{ ok: false,
 * why, rule }` — `rule` naming which guard spoke, so a caller (and a parity block) can assert WHICH
 * rule refused rather than only THAT something did.
 *
 * [TESTED: 2026-08-15 18:5x · the extraction changed no behaviour — `profile-manager --selftest` is
 *  still 41 blocks / 0 failures, INCLUDING the two that judge these very rules («R13: кривая ВЫШЕ
 *  МАКСИМУМА КАРТЫ отвергнута до записи» and «ВЕКТОР: инверсия ОТВЕРГНУТА последней строкой перед
 *  записью»). That both survived an extraction they never mention is the evidence: they exercise the
 *  backend, not this function, so they would have gone red had the move changed a verdict.
 *  `virtual-gpu --selftest` adds the parity block, and a mutation that stops the virtual backend from
 *  calling this function reddens it — i.e. the shared decision is proved SHARED, not merely present.]
 */
export function curveWriteRefusal(vec, { capMhz = null, cardMaxClockMhz = null } = {}) {
  // ─── R11: A CEILING MUST BE HELD BY SOMETHING ──────────────────────────────────────────────────
  // The format already refuses a cap below the curve's floor, and this is the same rule at the moment
  // of writing, where the CARD's own top is in hand rather than the ladder's. Two checks of one fact
  // is not duplication when one of them is the last line before a device write (R11, `bugs/02`).
  if (vec.capIsBelowTop && vec.capEnforced === false) {
    return { ok: false, rule: 'R11', why: `потолок ${capMhz} МГц кривой не удержать: утечка ${vec.capLeakMhz} МГц, `
      + `пол ${vec.lowestEnforceableCapMhz} МГц (R11)` };
  }
  // ─── R13: THE CARD'S OWN CEILING, born from `bugs/11` ──────────────────────────────────────────
  //
  // The owner's rule, verbatim (`GOAL.md` → «⭐ ЧТО ТАКОЕ ТЮНИНГ VF-КРИВОЙ», 2026-08-15):
  // *«НИКОГДА НЕ ГНАТЬ КАРТУ ВЫШЕ ЭТОЙ ЧАСТОТЫ»* — «this frequency» being what the specimen itself
  // answers, not what the reference spec publishes.
  //
  // THE INCIDENT THIS EXISTS FOR: a raise of +592 MHz proven only under a ceiling of 2842 MHz was
  // applied with the ceiling removed. The card was handed a curve offering 3180 MHz — past the
  // validated 2842, past the V/F table's own top of 3157, past the card's maximum of 3090 — and
  // bugchecked in `nvlddmkm.sys` two minutes later, on an IDLE desktop.
  //
  // WHY THE BOUND IS REQUIRED RATHER THAN DEFAULTED: a write whose ceiling is unknown is exactly the
  // write this guard exists to stop. Defaulting an absent bound to «no limit» would make the guard
  // disappear precisely for the caller careless enough not to pass it.
  const bound = Number(cardMaxClockMhz);
  if (!Number.isFinite(bound) || bound <= 0) {
    return { ok: false, rule: 'R13-bound', why: 'максимум карты не передан — писать кривую, не зная потолка экземпляра, запрещено '
      + '(правило владельца «НИКОГДА НЕ ГНАТЬ КАРТУ ВЫШЕ ЭТОЙ ЧАСТОТЫ», R13, bugs/11)' };
  }
  // The judged number is what WE lifted, never what the factory table already offered: on this card
  // the stock top entry is 3172 MHz against a card maximum of 3090, so reading the whole curve's top
  // here would refuse a vector of all zeroes.
  if (vec.highestRaisedOfferMhz !== null && vec.highestRaisedOfferMhz > bound) {
    return { ok: false, rule: 'R13-offer', why: `мы подняли точку до ${vec.highestRaisedOfferMhz} МГц при максимуме карты ${bound} МГц `
      + `— превышение ${vec.highestRaisedOfferMhz - bound} МГц. Это правило владельца «НИКОГДА НЕ ГНАТЬ КАРТУ ВЫШЕ `
      + 'ЭТОЙ ЧАСТОТЫ» (R13). Опустите подъём или поставьте потолок; ровно эта форма уронила машину '
      + '2026-08-15 (bugs/11)' };
  }
  // ─── R12: A UNIFORM RAISE CANNOT INVERT THE CURVE; A VECTOR CAN ────────────────────────────────
  // That is a proof about `min(F_i + Δ, F_top)`. Raise point i more than point i+1 and a
  // lower-VOLTAGE point ends up offering a HIGHER frequency than its neighbour. This project has
  // never written such a curve and has never observed what the card does with one, so it refuses
  // instead of finding out on the owner's machine — «look it up FIRST, never learn a state-changing
  // flag's semantics by running it» (the owner's-machine rule).
  //
  // It refuses on `introducesInversion`, NOT on `monotone`: an inversion the CARD's own factory
  // curve already has is not ours to blame the write for, and refusing on it would block writes
  // that work today — a guard causing the regression it exists to prevent.
  if (vec.introducesInversion) {
    const f = vec.firstInversionAt;
    return { ok: false, rule: 'R12', why: `вектор ЛОМАЕТ ПОРЯДОК кривой: точка ${f.at} даёт ${f.mhz} МГц после ${f.previousMhz} МГц `
      + `у точки ${f.previous} — то есть меньшее напряжение предлагает БОЛЬШУЮ частоту. Такой формы карта от нас `
      + 'ещё не получала, и что она с ней делает — не измерено. Поднимите точку ' + `${f.at} или опустите ${f.previous}` };
  }
  return null;
}

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
    async writeRaiseAndCap(deltaMhz, capMhz, { cardMaxClockMhz = null } = {}) {
      await open();
      const curve = mod.readVfCurve(nv, handle);
      if (!curve.ok) return { ok: false, why: `кривая не прочиталась: ${curve.why}` };
      // 🔴 ОДНА БАЗА НА ВСЁ ПРИМЕНЕНИЕ, И ОНА ЗАВОДСКАЯ — ПОЧИНКА `bugs/98`, ВТОРАЯ ПОЛОВИНА.
      //
      // `readVfCurve` отдаёт таблицу УЖЕ С НАШИМИ СДВИГАМИ, а сдвиги пишутся АБСОЛЮТНО. Значит на
      // применённом профиле и арифметика вектора, и сторож R13 считали от неверной опоры:
      //   · вектор получал почти нули и СТИРАЛ настоящие сдвиги (измерено 31.08: карта вернулась к
      //     заводским частотам, а режим числился применённым);
      //   · сторож, получив полный вектор, складывал сдвиг с уже сдвинутой частотой и отказывал по
      //     превышению, которого нет («мы подняли точку до 3157» — а наш сдвиг там 0).
      // Первая половина починки живёт в `resolveProfileCurve`; без ЭТОЙ второй она лишь меняла тихую
      // порчу на ложный отказ, потому что базы у двух читателей остались разные. Один рычаг, одна
      // опора — иначе это пара «правда ↔ зеркало», которую проект предпочитает УБИРАТЬ.
      //
      // Заводская частота точки = живая минус её собственный сдвиг. Карта отдаёт сдвиги поточечно
      // (`readVfOffsetsStable`), так что опора берётся ЧТЕНИЕМ, без обнуления кривой: обнуление тоже
      // дало бы идемпотентность, но ценою лишней записи в карту на каждом применении (правило
      // машины владельца, шаг 3 — наименьшая форма).
      //
      // ⚠️ ЧИТАТЕЛЬ МОЖЕТ ОТСУТСТВОВАТЬ — у двойника эпика 03 своего моста нет. Тогда опорой
      // остаётся живая таблица, то есть прежнее поведение: двойник применяет профиль от заводского
      // состояния и двойного счёта там не бывает.
      // 🔴 ДВА РАЗНЫХ СЛУЧАЯ, И СМЕШИВАТЬ ИХ НЕЛЬЗЯ (R4b: «не смотрел» ≠ «посмотрел и не нашёл»).
      // Найдено МУТАЦИЕЙ: первая редакция при ОТКАЗЕ чтения молча возвращалась к живой таблице —
      // то есть к самому дефекту, — а комментарий рядом обещал, что «об этом скажет строка
      // применения». Такой строки не было: я написал пожелание вместо факта. Мутация «отказ чтения
      // читать как отсутствие сдвигов» прошла ЗЕЛЁНОЙ, потому что фикстура всегда отвечала `ok`.
      //
      //   · КАНАЛА НЕТ ВОВСЕ (`readVfOffsetsStable` не функция) — это цифровой двойник эпика 03: у
      //     него своего моста нет, профиль он применяет от заводского состояния, двойного счёта не
      //     бывает. Работаем по живой таблице, как раньше, и это законно.
      //   · КАНАЛ ЕСТЬ, НО НЕ ОТВЕТИЛ — писать ОТКАЗЫВАЕМСЯ. Не зная, что уже стоит на карте,
      //     абсолютный вектор посчитать нечем: любая догадка даёт либо стирание кривой, либо
      //     двойной счёт и ложный отказ сторожа. Отказ здесь дешевле обеих ошибок.
      let basePoints = curve.points;
      if (typeof mod.readVfOffsetsStable === 'function') {
        const cur = mod.readVfOffsetsStable(nv, handle);
        if (!cur?.ok || !Array.isArray(cur.offsets)) {
          return {
            ok: false,
            rule: 'B98-base',
            why: 'текущие сдвиги карты не прочитались'
              + `${cur?.why ? ` (${cur.why})` : ''} — писать кривую, не зная, что на карте уже стоит, `
              + 'ЗАПРЕЩЕНО: сдвиги задаются абсолютно, и без опоры запись либо стирает прежнюю кривую, '
              + 'либо считает подъём дважды (bugs/98). Повторите применение или сбросьте карту: '
              + 'npm run profile -- --reset',
          };
        }
        basePoints = curve.points.map((pt, j) => (pt && Number.isFinite(pt.mhz)
          ? { ...pt, mhz: pt.mhz - Math.round((cur.offsets[j] ?? 0) / 1000) }
          : pt));
      }
      // `capMhz: null` reaches `buildRaiseAndCapVector` as `null`, which is its own documented way of
      // saying «cap at the curve's top», i.e. a UNIFORM raise with nothing pushed down.
      const vec = mod.buildRaiseAndCapVector(basePoints, deltaMhz, { capMhz });
      if (!vec.ok) return { ok: false, why: `вектор не построился: ${vec.why}` };
      // THE FOUR REFUSALS — R11, R13 (bound), R13 (raised offer), R12 — live in `curveWriteRefusal`
      // above, so the virtual card of epic 03 is held to the SAME bar rather than to a copy of it.
      // Everything the long comments there say applied here first and was moved, not softened.
      const refusal = curveWriteRefusal(vec, { capMhz, cardMaxClockMhz });
      if (refusal) return refusal;
      const w = mod.writeCurve(nv, handle, vec.offsets, { count: COUNT() });
      // ⚠️ `w.ok` NOW MEANS «the calls were accepted AND the card holds what we asked», not «the
      // statuses were zero» (`plans/40`, epic 36 phase 4). So the refusal quotes the NAMED class when
      // there is one: `w.why` carries it, and «C5 — запись инертна ЦЕЛИКОМ» is an answer the old
      // wording could not produce at all, because a wholly inert write fails zero calls.
      if (!w.ok) {
        return {
          ok: false,
          failureClass: w.failureClass ?? null,
          why: w.why ?? `запись кривой: ${w.failed} точек из ${COUNT()} не записались`,
        };
      }
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
  // THE CARD'S OWN CEILING, asked of the card rather than remembered (`GOAL.md` → «⭐ ЧТО ТАКОЕ ТЮНИНГ
  // VF-КРИВОЙ», the owner's rule 1: «спросить у моего экземпляра локально, сколько она может
  // максимально частоту гнать»). Measured here 2026-08-15: 3090 MHz, and the supported-clock ladder
  // ends on exactly that. It is NOT the reference spec — NVIDIA publishes 2452 MHz boost for the
  // 5070 Ti, which is a floor for this specimen, not a ceiling — and it is NOT the V/F table's top
  // entry either, which reads 3157 MHz. That gap of 67 MHz is the one `bugs/11` drove through.
  'clocks.max.graphics',
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
    // The specimen's own ceiling (R13). Read every time rather than cached: it is a fact of the card
    // in front of us, and a driver change may move it — the same reason R6 stamps profiles.
    clockMaxMhz: Number(r['clocks.max.graphics']),
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
/**
 * The curve a profile actually asks for — inline or BY REFERENCE — reduced to one shape.
 *
 * `plans/14` §4.3: `settings.curveRef` names a tuning-curve document, and the applier resolves it to
 * the same `{deltaByPointMhz, capMhz}` the inline key produces. Downstream nothing changes: one
 * arithmetic (`nvapi.buildRaiseAndCapVector`), one writer (R1). Pure apart from the injected loader,
 * so it is provable on fixtures.
 *
 * A reference that cannot be resolved THROWS rather than degrading to «no curve»: a profile that reads
 * as tuning the card while the applier quietly writes nothing is the exact defect `profiles/README.md`
 * is written against.
 */
export function effectiveCurveSetting(profile, { loadCurve = null, liveTable = null, toOffsets = null } = {}) {
  const inline = profile?.settings?.curveRaiseAndCapMhz ?? null;
  const ref = profile?.settings?.curveRef ?? null;
  if (inline && ref) {
    const err = new Error(`профиль «${profile.name}» задаёт кривую дважды — и ссылкой, и встроенным объектом`);
    err.refusals = [{ field: 'settings.curveRef', why: 'кривая задана дважды; формат это отвергает, применяющий тоже' }];
    throw err;
  }
  if (inline) return inline;
  if (!ref) return null;

  const load = loadCurve ?? defaultCurveLoader;
  const doc = load(ref);
  if (!doc) {
    const err = new Error(`профиль «${profile.name}» ссылается на кривую «${ref}», которой нет`);
    err.refusals = [{ field: 'settings.curveRef', why: `документа кривой «${ref}» нет — применять профиль частично запрещено` }];
    throw err;
  }
  // The document says «this frequency costs this voltage». The card takes per-entry frequency
  // offsets. The conversion is COMPUTED against the LIVE table (`curve-store.offsetsFor`), never
  // stored — that is what makes one document produce the right write at 40 °C and at 57 °C.
  if (!liveTable) {
    const err = new Error(`профиль «${profile.name}» ссылается на кривую «${ref}», но живая таблица карты не передана`);
    err.refusals = [{ field: 'settings.curveRef', why: 'перевод «частота → напряжение» в смещения требует ЖИВОГО чтения таблицы' }];
    throw err;
  }
  const { offsets, clamped } = toOffsets(doc, liveTable);
  // ПОТОЛОК РЕЖИМА ЕДЕТ ВМЕСТЕ С ВЕКТОРОМ (2026-08-16). Документ — это ЗАМЕР, потолок — ручка
  // РЕЖИМА, поэтому он лежит в профиле отдельным полем и подставляется здесь, в одном месте, где
  // «ссылка» превращается в ту же форму, что и встроенная кривая. Ниже по течению ничто не меняется:
  // одна арифметика, один писатель (R1), и `buildRaiseAndCapVector` придавит всё, что торчит выше.
  // `null` — потолка нет вовсе, и это НЕ то же самое, что «потолок на верху кривой» (EXP-0031).
  const capMhz = profile?.settings?.curveCapMhz ?? null;
  return { deltaByPointMhz: offsets, capMhz, __fromRef: ref, __clamped: clamped };
}

function defaultCurveLoader(name) {
  // Imported lazily and synchronously through `createRequire`-free means is not possible in ESM, so
  // the real loader is injected by the CLI (which can `await import`). A module that reaches for the
  // store on its own would drag the card probes into every consumer of this file.
  throw new Error(`ссылка на кривую «${name}» не разрешена: загрузчик не передан (loadCurve)`);
}

/**
 * THE ONE RESOLVER EVERY CALLER USES — `bugs/18`.
 *
 * [NOT-TESTED]
 *
 * `effectiveCurveSetting` above is PURE and needs three things injected (the document loader, the
 * live table, the offset arithmetic). Assembling those three is async and pulls the card probes, so
 * it cannot live inside `apply()` — and for that reason it used to live in the CLI, which resolved
 * the reference correctly, PRINTED it, and then handed `apply()` the raw profile to resolve a SECOND
 * time without the injections. That second resolution threw on every `curveRef` profile, so the
 * shipped shape of all three modes (`plans/13` phase 5 — «три файла профиля, ссылающихся на один
 * документ кривой») could not reach the card by any path: not a shortcut, not the logon task, not
 * the tray. The qualification gate refused earlier and with a different reason, which is what hid it.
 *
 * The fix is the one this project prefers: **a pair that can be REMOVED beats a pair that must be
 * watched** (`AGENT_GUIDE.md` → the truth↔mirror registry). There is now ONE resolution per apply,
 * performed here by whoever is about to call `apply()`, and `apply()` is TOLD the answer.
 *
 * `null` is a real answer — «this profile asks for no curve» — which is why `apply()` distinguishes
 * it from `undefined` («nobody resolved it for me»).
 *
 * @returns {Promise<object|null>} the resolved `{deltaMhz|deltaByPointMhz, capMhz}` shape, or null.
 */
export async function resolveProfileCurve(profile, {
  loadCurve = null, readLive = null, toOffsets = null,
  // Внедряемые чтения текущих сдвигов карты (`bugs/98`). Отсутствуют — импортируются; заданы —
  // набор проверяет вычитание без карты.
  readVfOffsetsFn = null, openNvapiFn = null,
} = {}) {
  const inline = profile?.settings?.curveRaiseAndCapMhz ?? null;
  const ref = profile?.settings?.curveRef ?? null;
  if (!inline && !ref) return null;
  if (inline && !ref) return effectiveCurveSetting(profile);

  // Only a REFERENCE needs the store and a live reading of the card's table — and each import happens
  // only where its injection is ABSENT, so the selftest below resolves a reference with no `curves/`
  // directory, no nvapi and no card. A profile carrying an inline curve reaches neither import.
  let load = loadCurve;
  let offs = toOffsets;
  if (!load || !offs) {
    const store = await import('./curve-store.mjs');
    load = load ?? ((name) => store.loadCurveDoc({ name }));
    offs = offs ?? store.offsetsFor;
  }
  let live = readLive;
  if (!live) ({ readLiveCurvePoints: live } = await import('./card-grids.mjs'));
  // 🔴 БАЗОЙ СЛУЖИТ ЗАВОДСКАЯ ТАБЛИЦА, А НЕ ЖИВАЯ — ПОЧИНКА `bugs/98`.
  //
  // Слово владельца, которым дефект назван: *«Не применяйте профиль поверх уже применённого — ну это
  // баг. Я говорил, что повторное применение не должно ломать профиль»*. Он прав дважды: и по
  // существу, и по тому, что инструкция «не щёлкайте дважды» — это обход, живущий до первого раза,
  // когда о нём не вспомнят.
  //
  // Механизм дефекта, ИЗМЕРЕННЫЙ: `readLiveCurvePoints` возвращает таблицу УЖЕ С НАШИМИ СДВИГАМИ.
  // Сдвиг считается как «цель минус то, что точка несёт сейчас», а запись задаёт сдвиги АБСОЛЮТНО.
  // Значит второе применение считает почти нули и записывает их ПОВЕРХ настоящих: 31.08 карта
  // вернулась к заводским частотам (1875/2182/2377/2737/2857/3037), а режим числился применённым,
  // код возврата 0, перечитывание зелёное. Опорой служило то, что мы сами изменили.
  //
  // Лечится вычитанием, а не обнулением кривой перед записью: карта умеет отдать ТЕКУЩИЕ сдвиги по
  // точкам (`nvapi.readVfOffsetsStable`), и заводская частота точки есть «живая минус её сдвиг».
  // Обнуление тоже дало бы идемпотентность, но ценой ЛИШНЕЙ ЗАПИСИ В КАРТУ на каждом применении —
  // а правило машины владельца требует наименьшей формы (шаг 3). Вычитание не пишет ничего.
  //
  // ⚠️ ЭТО НЕ ЗАКРЫВАЕТ `bugs/97`. Полученная база — заводская таблица В ТЕКУЩЕМ СОСТОЯНИИ КАРТЫ, а
  // она сама едет: замер 31.08 дал 60 разошедшихся точек из 128 между 51 и 53 °C. Здесь чинится
  // ПОВТОРЯЕМОСТЬ (одна и та же карта, два нажатия подряд — одна кривая), а не выбор опоры.
  //
  // Читатель сдвигов ВНЕДРЯЕМ: набор обязан резолвить ссылку без карты и без nvapi, и импорт
  // происходит только там, где инъекции нет.
  const liveTable = await live();
  let base = liveTable;
  try {
    const nvapi = await import('./nvapi.mjs');
    const readOffsets = readVfOffsetsFn ?? nvapi.readVfOffsetsStable;
    // Открытие по умолчанию — тем же приёмом, что и остальные потребители моста (`vf-step`): id
    // разрешаются через `resolve`, ручка берётся первой из перечисления. Своей копии идиомы здесь
    // нет — при её расхождении с мостом отказ был бы молчаливым.
    const open = openNvapiFn ?? (() => {
      const nvh = nvapi.openNvapi();
      nvh.koffi.call(nvh.resolve(0x0150E828).ptr, nvh.protos.Initialize);
      const hs = Buffer.alloc(64 * 8); const cnt = Buffer.alloc(4);
      nvh.koffi.call(nvh.resolve(0xE5AC921F).ptr, nvh.protos.EnumPhysicalGPUs, hs, cnt);
      return { nv: nvh, handle: hs.readBigUInt64LE(0) };
    });
    const nv = open();
    const cur = nv ? readOffsets(nv.nv, nv.handle) : null;
    if (cur?.ok && Array.isArray(cur.offsets) && cur.offsets.length >= liveTable.length) {
      base = liveTable.map((pt, j) => ({ ...pt, mhz: pt.mhz - Math.round((cur.offsets[j] ?? 0) / 1000) }));
    }
  } catch { /* сдвиги не прочитались — работаем как раньше, но об этом скажет строка применения */ }
  return effectiveCurveSetting(profile, { loadCurve: load, liveTable: base, toOffsets: offs });
}

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
  // СОГЛАСИЕ — КТО ИМЕННО РАЗРЕШИЛ ПРИМЕНИТЬ ЧЕРНОВИК, СТРОКОЙ, А НЕ БУЛЕВЫМ.
  //
  // Строка, потому что вопрос ворот теперь «кто применяет», и ответ «да» на него не отвечает. В
  // журнале и в отказе стоит имя согласия («клик владельца», «приёмочный прогон --witness»,
  // «восстановление при входе»), и по нему видно, чьё решение исполнялось. `witness: true` остаётся
  // рабочим псевдонимом для приёмочного прогона — старые вызовы и блоки не переписываются.
  consent: consentArg = null,
  // The tuning-curve loader, INJECTED so this module stays testable without a `curves/` directory and
  // so the selftest can drive a document that exists only in memory. Defaults to the real store.
  loadCurve = null,
  // THE ALREADY-RESOLVED CURVE (`bugs/18`). `undefined` means «nobody resolved it for me, do it
  // yourself» — the legacy path, which works for an INLINE curve and throws for a reference, because
  // resolving a reference needs an async store import and a live table read that this function has no
  // way to perform. `null` is a real answer and means «this profile asks for no curve at all», so the
  // two must not be conflated: `curve: null` must NOT fall through to a second resolution.
  curve = undefined,
} = {}) {
  const before = readState(backend);

  // R6 and the format, both before the first write (P2-AC5).
  // Одно согласие из двух входов: `witness: true` — исторический псевдоним приёмочного прогона.
  const consent = consentArg || (witness ? 'приёмочный прогон (--witness)' : null);

  const refusals = validateProfile(profile, { card });
  refusals.push(...checkStamp(profile, card ?? { driver: before.driver, vbios: before.vbios }));
  // THE QUALIFICATION GATE (phase 3, P3-AC3): a draft is a VALID file the format accepts and the
  // list shows — and a state this module never puts on the card. The refusal names the reason and
  // the phase that lifts it, and it sits here, in the one writer (R1), not in the shortcut layer:
  // whatever surface calls apply() — CLI, .lnk, the logon task — meets the same gate.
  // 🔴 ВОРОТА СПРАШИВАЮТ, КТО ПРИМЕНЯЕТ, А НЕ «БЛАГОСЛОВЛЁН ЛИ ПРОФИЛЬ» — слово владельца 2026-08-23.
  //
  // Прежде здесь стояло `profile.qualified !== true` — и это был запрет на ПРОФИЛЬ. Владелец,
  // упёршись в него на собственной машине: *«почему какой-то нами же выдуманный флаг нам же
  // мешает?»* Он прав по существу: `qualified` придуман агентом как тормоз для АГЕНТА — чтобы тот
  // не применил непроверенные числа по своей инициативе, — но написан был так, что блокировал
  // ВЛАДЕЛЬЦА, то есть саму инстанцию приёмки. Его клик по ярлыку И ЕСТЬ решение о приёмке.
  //
  // ЧТО НЕ ИЗМЕНИЛОСЬ: числа остаются честными. `qualified: false` в файле НЕ становится `true` —
  // доказательств приёмки действительно нет, и врать в данных проект не будет. Изменилось то, ЧЬЁ
  // разрешение спрашивают ворота.
  //
  // ⚠️ ЕДИНСТВЕННАЯ НАСТОЯЩАЯ РАБОТА ФЛАГА НЕ ПОТЕРЯНА, А ПЕРЕЕХАЛА ТУДА, ГДЕ ЕЙ МЕСТО. Флаг охранял
  // НЕПРИСУТСТВЕННЫЙ путь: задача логона восстанавливает режим при каждом входе, без человека рядом,
  // и плохой режим дал бы петлю загрузки на рабочей машине. Теперь это делает
  // `remembered-state.bootLoopBreaker` — механизм, который наблюдает НАСТОЯЩУЮ смерть машины по
  // осиротевшему намерению (R15), а не хранит обещание в булевом поле, которое никто не измерял.
  if (requiresQualification(profile) && profile.qualified !== true && !consent) {
    refusals.push({
      field: 'consent',
      why: 'профиль — ЧЕРНОВИК (qualified: false), и зовущий не назвал согласия. Применение черновика '
        + 'делается ТОЛЬКО по явному решению владельца (ярлык, CLI) — автоматическое восстановление '
        + 'при входе в систему проходит через прерыватель петли загрузки. На карту не записано ничего.',
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

  // --- THE REFERENCED CURVE BECOMES AN INLINE ONE, ONCE, HERE (`plans/14` §4.3) ----------------
  //
  // `settings.curveRef` names a tuning-curve document; the applier turns it into the SAME
  // `{deltaByPointMhz, capMhz}` shape the inline key already produces, and everything downstream —
  // the vector build, the R13 ceiling, the read-back, the undo — is untouched. One arithmetic, one
  // writer (R1). A second code path for «the same curve, but from a file» would be a pair to watch.
  //
  // `capMhz: null` deliberately: this phase does not assemble modes (`plans/14` §5), and the cap is a
  // MODE's knob, not the measurement's. Phase 5 decides how a mode carries its ceiling; inventing that
  // shape now, before a measured curve exists, would be inventing.

  // --- THE CURVE, FIRST (`plans/11` §4.2) -------------------------------------------------------
  //
  // First in the order for the same reason it is zeroed first in the reset: it is the step whose undo
  // is cheapest and most total. If a later step fails, the rollback walks back over a curve-zero that
  // always works; if the curve itself fails, nothing else has been written yet.
  //
  // A profile that asks for a curve and gets NO curve backend is REFUSED, not applied without it. This
  // is the whole reason the format kept the key out until today: a profile that reads as raising the
  // curve while the applier quietly ignores it is the defect `profiles/README.md` is written against.
  // ONE RESOLUTION PER APPLY (`bugs/18`). When the caller resolved it — and every caller that can
  // reach a `curveRef` profile MUST, because only they can `await import` the store — we use their
  // answer verbatim. `undefined` is the only value that triggers a resolution here.
  const wantCurve = curve === undefined ? effectiveCurveSetting(profile, { loadCurve }) : curve;
  if (wantCurve) {
    if (!curveBackend) {
      const err = new Error(`профиль «${profile.name}» задаёт кривую V/F, а бэкенд кривой не передан — `
        + 'применять его частично запрещено: это профиль, который читается как поднимающий кривую, а на деле её не трогает');
      err.refusals = [{ field: 'settings.curveRaiseAndCapMhz', why: 'нет бэкенда кривой' }];
      throw err;
    }
    // ONE NUMBER OR ONE PER POINT (`plans/12` §4.4). The format has already refused every shape that is
    // neither, so here the choice is a read, not a decision. The `what:` line NAMES which shape is
    // being applied, because that line is what an operator reads in the seconds before a write to the
    // owner's card — «подъём +592» and «вектор на 127 точек» are different writes and must not print
    // the same.
    const raise = Array.isArray(wantCurve.deltaByPointMhz) ? wantCurve.deltaByPointMhz : wantCurve.deltaMhz;
    const raiseSaid = Array.isArray(raise)
      ? `ВЕКТОР на ${raise.length} точек (подъём ${Math.min(...raise)}…${Math.max(...raise)} МГц)`
      : `подъём +${raise} МГц на всю кривую`;
    steps.push({
      what: `кривая V/F: ${raiseSaid}, ${wantCurve.capMhz === null ? 'без потолка' : `потолок ${wantCurve.capMhz} МГц`}`,
      run: async () => {
        // R13: the specimen's own maximum travels WITH the write. `before` was read from the card at
        // the top of `apply`, so this is a measured bound rather than a constant anyone can forget to
        // update after a driver change.
        const w = await curveBackend.writeRaiseAndCap(raise, wantCurve.capMhz, { cardMaxClockMhz: before.clockMaxMhz });
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
 * IS THE CARD AT FACTORY RIGHT NOW? — the judge, pure, over readings the caller took (`bugs/45`).
 *
 * WHY THIS EXISTS. The sweep probes the envelope, the clock ladder, the watch window, the watchdog's
 * stale records and the journal — and never asked the one question every number it is about to take
 * depends on. On 2026-08-23 the `⚖️ Optimised` profile was live on the card for a whole live run: the
 * sweep read the RAISED curve and compared it against a document whose stock column was captured on
 * the FACTORY curve, ~80 mV apart. R12 tripped and saved that run — but only because those offsets
 * were large. **A SMALLER applied profile shifts the curve by a few MHz, R12 stays silent, and the
 * sweep writes rows whose voltages were measured against a baseline the document does not describe.**
 * Those rows would be perfectly well-formed and wrong — the `bugs/02` shape.
 *
 * TWO AXES, AND WHY EXACTLY THESE TWO. The curve's per-point offsets are what poisons the
 * MEASUREMENT (every frequency→voltage pair is read off a table we did not mean to be reading); the
 * power limit is what poisons the BURN (a card held at 250 W does not deliver what it delivers at
 * 300). Both are read-only probes the caller already has in hand.
 *
 * WHAT IS DELIBERATELY NOT COVERED, said rather than left to be discovered: a clock LOCK (`-lgc`).
 * `nvidia-smi` publishes no "am I locked" field — the project detects a lock only by the clock
 * HOLDING STILL, which an idle card does anyway, so a probe for it would be a guess wearing a
 * measurement's clothes (`PHILOSOPHY.md` → the three doors). It is also the axis least likely to
 * bite: no shipped mode pins the clock (the owner's requirement), so a lock could only be a leftover
 * from a measurement tool, and the sweep pins clocks itself below the ceiling floor.
 *
 * «COULD NOT LOOK» IS NOT «FOUND NOTHING» (the same rule `events` runs on): an unreadable axis
 * returns `factory: null`, never a quiet `true`. A caller that cannot see the card's state must say
 * so, not proceed as if the state were good.
 *
 * @param {object}  r
 * @param {number}  r.powerLimitW    what the card reports now
 * @param {number}  r.powerDefaultW  what the card calls its factory default
 * @param {number}  r.curveNonZero   count of NON-ZERO per-point offsets in the curve control struct
 * @param {string}  [r.curveWhy]     why the curve could not be read, when it could not
 * @returns {{factory:boolean|null, parts:Array<{axis:string, factory:boolean|null, why:string}>, why:string}}
 *
 * [TESTED: 2026-08-30 · `profile-manager --selftest` — factory · a raised curve · a power limit ·
 *  both · an unreadable curve; mutations EA-EC each reddening their own block. Pure function, no GPU.]
 */
export function factoryStateVerdict({
  powerLimitW = null, powerDefaultW = null, curveNonZero = null, curveWhy = null,
} = {}) {
  const parts = [];

  // --- the curve ------------------------------------------------------------------------------
  if (Number.isFinite(curveNonZero)) {
    parts.push(curveNonZero === 0
      ? { axis: 'кривая', factory: true, why: 'ненулевых сдвигов 0 — кривая заводская' }
      : { axis: 'кривая', factory: false, why: `на кривой ${curveNonZero} ненулевых сдвиг(ов) — применён профиль` });
  } else {
    parts.push({ axis: 'кривая', factory: null, why: `кривая НЕ ПРОЧИТАНА (${curveWhy ?? 'причина не названа'})` });
  }

  // --- the power limit ------------------------------------------------------------------------
  if (Number.isFinite(powerLimitW) && Number.isFinite(powerDefaultW)) {
    const off = Math.abs(powerLimitW - powerDefaultW) >= WATT_EPSILON;
    parts.push(off
      ? { axis: 'мощность', factory: false, why: `предел ${powerLimitW} Вт при заводских ${powerDefaultW} Вт` }
      : { axis: 'мощность', factory: true, why: `предел ${powerLimitW} Вт — заводской` });
  } else {
    parts.push({ axis: 'мощность', factory: null, why: 'предел мощности НЕ ПРОЧИТАН' });
  }

  // A single unreadable axis makes the whole answer UNKNOWN even when the other says factory:
  // "three quarters of the state is clean" is not the claim the caller needs.
  const factory = parts.some((p) => p.factory === null) ? null : parts.every((p) => p.factory);
  const why = parts.map((p) => p.why).join(' · ');
  return { factory, parts, why };
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
export async function roundTrip(backend, profile, { card, timing = {}, curve = undefined, curveBackend = null } = {}) {
  const initial = readState(backend);
  let applied = null;
  let lockedTo = null;
  let error = null;
  try {
    // `curve` / `curveBackend` are PASSED THROUGH rather than re-derived (`bugs/18`): a prover that
    // resolves the profile differently from the applier proves the wrong thing.
    applied = await apply(backend, profile, { card, timing, curve, curveBackend });
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
 *   degraded-to-factory    the gates refused (stale stamp / missing file), OR the BOOT-LOOP BREAKER
 *                          found the previous restore of this profile left no verdict — the machine
 *                          died with it on the card → zero writes, factory stands, code 1
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
  // Швы прерывателя — внедряемые по той же причине, что и всё остальное здесь: набор обязан гонять
  // его в песочнице, не трогая боевой журнал владельца (EXP-0025).
  readJournalFn = readBootJournal,
  writeIntentFn = appendBootIntent,
  retries = BOOT_PROBE_RETRIES,
  retryIntervalMs = BOOT_PROBE_RETRY_INTERVAL_MS,
  timing = {},
  // THE CURVE AT LOGON (`bugs/18`, the second face). This path had NO curve backend and no resolver
  // at all, so `apply()` refused every profile that tunes the V/F curve — which by the owner's own
  // definition is EVERY working mode (`GOAL.md`: «все режимы наши должны тюнить VF кривую»). The
  // remembered state therefore survived a reboot only for `factory`. Both are injected so this stays
  // provable on a machine with no card, which is what the boot blocks below run on.
  resolveCurve = resolveProfileCurve,
  openCurveBackend = () => nvapiCurveBackend(),
  // РАЗЖАТИЕ ДИСКОВ ПРИ ВХОДЕ В СИСТЕМУ (`plans/30` §2.6, AC10). Шов, как и всё здесь: набор гоняет
  // его без единой команды PowerShell.
  disarmDisksFn = null,
} = {}) {
  const journal = (record) => { appendBootJournal(record, journalPath); return record; };

  // ─── ДИСКИ РАЗЖИМАЮТСЯ ПЕРВЫМИ, ДО ЛЮБОЙ РАБОТЫ С КАРТОЙ ────────────────────────────────────────
  //
  // Владелец просил «чтобы при перезапуске KAGO вывел диски в онлайн, если вдруг был BSOD»
  // (`interviews/013` Q3). Сделано СИЛЬНЕЕ просимого и в другом месте: не при запуске KAGO, а при
  // ВХОДЕ В СИСТЕМУ. После чёрного экрана владелец KAGO не запускает — он жмёт кнопку и смотрит на
  // рабочий стол. Задача `\KAGO\boot-apply` уже существует, уже имеет права `Highest` и уже висит на
  // триггере входа, поэтому НОВОЙ автозагрузки не заводится: разжатие едет тем же поездом, что и
  // восстановление профиля карты.
  //
  // ⚠️ ПЕРВЫМИ, А НЕ ПОСЛЕДНИМИ. Пока режим взведён наполовину, гейт развёртки писать в карту
  // откажется (AC4). Разжать сначала — значит не оставить двум сторожам возможности гоняться друг за
  // другом. И это дёшево: если разжимать нечего, работы ноль.
  //
  // ⚠️ ОШИБКА РАЗЖАТИЯ НЕ ОТМЕНЯЕТ ВОССТАНОВЛЕНИЕ ПРОФИЛЯ. Это два независимых дежурства одного
  // поезда, и R10a про них ровно то же, что про откат: список, а не цепь.
  if (disarmDisksFn) {
    try {
      const d = disarmDisksFn();
      if (d && (d.done?.length || d.failed?.length)) {
        journal({ verdict: 'disks-disarmed', remembered: null, detail: `безопасный режим дисков разжат при входе: восстановлено ${d.done?.length ?? 0}, не удалось ${d.failed?.length ?? 0}` });
      }
    } catch (e) {
      journal({ verdict: 'disks-disarm-failed', remembered: null, detail: `разжать диски при входе не удалось: ${e?.message ?? e} — профиль карты восстанавливается всё равно` });
    }
  }

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

  // The curve is resolved BEFORE the backend is opened, and the backend is opened only when a curve
  // is actually wanted: a power-limit-only mode must not load nvapi64.dll for nothing. A resolution
  // that throws is caught by the same handler below and degrades to factory — the designed-in safety
  // of this whole path (the card boots factory by physics, so «nothing happened» is always safe).
  // ─── ПРЕРЫВАТЕЛЬ ПЕТЛИ ЗАГРУЗКИ — ДО ЛЮБОЙ ЗАПИСИ (`remembered-state.bootLoopBreaker`) ──────────
  //
  // Это то, что заняло место флага `qualified` на неприсутственном пути. Флаг спрашивал «обещано ли,
  // что числа хороши»; прерыватель СМОТРИТ, чем кончилось прошлое восстановление. Осиротевшее
  // намерение означает, что машина умерла с этим режимом на карте, — и второй раз мы этого не
  // делаем, иначе каждый вход в систему повторял бы смерть.
  const breaker = bootLoopBreaker(readJournalFn(journalPath), state.profile);
  if (breaker.blocked) {
    return {
      code: 1,
      record: journal({
        verdict: 'degraded-to-factory', remembered: state.profile, probeAttempts,
        detail: `ПРЕРЫВАТЕЛЬ ПЕТЛИ ЗАГРУЗКИ: ${breaker.why} — записей ноль`,
      }),
    };
  }

  let curveBackend = null;
  try {
    const wantCurve = await resolveCurve(profile);
    if (wantCurve) curveBackend = openCurveBackend();
    // НАМЕРЕНИЕ — ПОСЛЕДНЕЕ, ЧТО ПИШЕТСЯ ДО КАРТЫ, и оно `fsync`-ится. Если следующая строка в
    // журнале так и не появится, следующий вход прочтёт это намерение как «здесь машина умерла».
    writeIntentFn({ remembered: state.profile }, journalPath);
    // СОГЛАСИЕ ИМЕНОВАНО: по журналу видно, что это было восстановление, а не решение человека.
    const r = await apply(b, profile, { card, timing, curve: wantCurve, curveBackend, consent: 'восстановление при входе в систему' });
    return { code: 0, record: journal({ verdict: 'applied', remembered: state.profile, probeAttempts, powerLimitW: r.after.powerLimitW, detail: `применено и перечитано: ${r.after.powerLimitW} Вт / ${r.after.clockMhz} МГц` }) };
  } catch (e) {
    if (e.refusals) {
      return { code: 1, record: journal({ verdict: 'degraded-to-factory', remembered: state.profile, probeAttempts, detail: `применитель отказал ДО записи, заводское стоит: ${e.message.split('\n').join(' · ')}` }) };
    }
    return { code: 1, record: journal({ verdict: 'apply-failed-rolled-back', remembered: state.profile, probeAttempts, detail: `применение провалилось, откат внутри применителя отработал: ${e.message.split('\n').join(' · ')}` }) };
  } finally {
    // Its own `try` — a close that throws must not turn a successful logon apply into a failure, and
    // must not swallow the verdict already computed above (R10a: a rollback with more than one duty
    // is a LIST, never a chain).
    if (curveBackend) { try { curveBackend.close(); } catch { /* the handle dies with the process */ } }
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
  settings: { powerLimitWatts: 250, graphicsClockLockMhz: { min: 1200, max: 1200 }, curveRaiseAndCapMhz: null, curveRef: null, curveCapMhz: null },
  stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: '2026-08-10T10:00:00+03:00' },
});

const factoryFixture = () => ({
  name: 'factory',
  title: '🔄 Сброс к заводским',
  settings: { powerLimitWatts: null, graphicsClockLockMhz: null, curveRaiseAndCapMhz: null, curveRef: null, curveCapMhz: null },
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
// Exported for the CONTRACT SUITE (`seam-contract.mjs`, epic 03 phase 3) — see the twin note in
// `ladder-descent.mjs`. This one models STALE READS and a clock that FLASHES the target for a single
// sample, which is EXP-0014's incident preserved as a fixture. The virtual card cannot lie, so this
// double is NOT replaced by it; the contract only checks that both satisfy the same seam.
export function fakeBackend({ staleReads = 0, lieOn = null, flashOn = null, failOn = null, wander = [810, 940, 1065] } = {}) {
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
        // The real card's answer, not a round number: measured 2026-08-15 on this specimen, and the
        // supported-clock ladder ends on exactly it. A stand-in that reported something else would let
        // the R13 blocks pass against a card nobody has.
        'clocks.max.graphics': '3090',
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
  // ⚠️ ДОГОВОР ЭТОГО БЛОКА ПЕРЕПИСАН 2026-08-23 СЛОВОМ ВЛАДЕЛЬЦА, и старая его редакция ПОКРАСНЕЛА
  // на правке — как и должна была. Прежде он требовал, чтобы отказ назвал «фазу 6, которая его
  // снимет»: гейт был запретом на ПРОФИЛЬ и ждал приёмки. Теперь гейт спрашивает, КТО применяет, и
  // фаза тут ни при чём — черновик применяется по явному решению владельца, а его числа остаются
  // честными (`qualified: false` в файле не подделывается).
  //
  // ЧТО БЛОК ОБЯЗАН ДЕРЖАТЬ ПО-ПРЕЖНЕМУ И НАВСЕГДА: БЕЗ согласия черновик НЕ применяется, и отказ
  // случается ДО первой записи в карту. Ослабление именно этого и было бы дырой.
  block('ЧЕРНОВИК БЕЗ СОГЛАСИЯ -> отказ ДО первой записи, поле и причина названы (P3-AC3)', async () => {
    const b = fakeBackend();
    const p = silentColdFixture();
    p.qualified = false;
    p.mode = 'silent-cold';
    p.draft = { candidate: 'потолок 2400, кривая +180', source: 'STATUS факт 27' };
    try {
      await apply(b, p, { card: SELFTEST_CARD, timing: FAST });
      return 'черновик применён БЕЗ согласия — гейт не сработал';
    } catch (e) {
      if (b.writes.length !== 0) return `до отказа успели записать: ${b.writes.join(', ')}`;
      if (!/consent/u.test(e.message)) return `отказ не назвал поле: ${e.message}`;
      if (!/ЧЕРНОВИК/u.test(e.message)) return `отказ не назвал причину черновика: ${e.message}`;
      if (!/согласи/u.test(e.message)) return `отказ не сказал, чего именно не хватает: ${e.message}`;
      return null;
    }
  });

  // СОГЛАСИЕ ИМЕНОВАНО, А НЕ БУЛЕВО — и это половина смысла правки: по записи должно быть видно,
  // ЧЬЁ решение исполнялось. Строка «клик владельца» и строка «восстановление при входе» — разные
  // основания с разной ценой, и сворачивать их в один `true` значит терять именно то, что важно.
  block('ЧЕРНОВИК С ИМЕНОВАННЫМ СОГЛАСИЕМ применяется, и ФАЙЛ НЕ ПОДМЕНЯЕТСЯ', async () => {
    const b = fakeBackend();
    const p = silentColdFixture();
    p.qualified = false;
    p.mode = 'silent-cold';
    const before = JSON.stringify(p);
    const r = await apply(b, p, { card: SELFTEST_CARD, timing: FAST, consent: 'клик владельца' });
    if (!r.applied) return 'с названным согласием черновик всё равно не применился';
    if (JSON.stringify(p) !== before) return 'профиль подменён при применении — файл обязан остаться как был';
    if (p.qualified !== false) return 'флаг qualified подделан — числа обязаны остаться честными';
    return null;
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
      settings: { powerLimitWatts: null, graphicsClockLockMhz: null, curveRaiseAndCapMhz: null, curveRef: null, curveCapMhz: null },
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

  // ═══ РАЗЖАТИЕ ДИСКОВ ПРИ ВХОДЕ (`plans/30` §2.6, AC10) ═══════════════════════════════════════════
  block('вход: безопасный режим дисков РАЗЖИМАЕТСЯ, и это попадает в журнал (AC10)', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    let called = 0;
    const r = await bootApply(bootOpts(b, sb, {
      disarmDisksFn: () => { called += 1; return { ok: true, done: ['ftpsvc', 'disk:E'], failed: [] }; },
    }));
    if (called !== 1) return `разжатие звали ${called} раз вместо 1`;
    const lines = journalLines(sb.jr);
    if (!lines.some((l) => l.includes('disks-disarmed'))) return 'в журнале нет строки о разжатии дисков';
    if (!lines.some((l) => l.includes('восстановлено 2'))) return 'журнал не назвал, сколько пунктов восстановлено';
    if (r.record.verdict === 'disks-disarmed') return 'разжатие подменило собой вердикт восстановления профиля';
    return null;
  });

  block('вход: разжатие УПАЛО -> профиль карты восстанавливается ВСЁ РАВНО (R10a: список, не цепь)', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'factory' }, sb.rem);
    const r = await bootApply(bootOpts(b, sb, {
      disarmDisksFn: () => { throw new Error('Set-Disk отказал'); },
      loadProfileByName: () => ({ profile: factoryFixture(), refusals: [] }),
    }));
    const lines = journalLines(sb.jr);
    if (!lines.some((l) => l.includes('disks-disarm-failed'))) return 'падение разжатия не названо в журнале';
    if (!lines.some((l) => l.includes('Set-Disk отказал'))) return 'журнал не назвал ПРИЧИНУ падения';
    if (r.record.verdict === 'disks-disarm-failed') return 'падение разжатия отменило восстановление профиля — это цепь, а не список';
    return null;
  });

  block('вход: разжимать нечего -> журнал НЕ засоряется (тихий путь остаётся тихим)', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    const r = await bootApply(bootOpts(b, sb, { disarmDisksFn: () => ({ ok: true, done: [], failed: [] }) }));
    if (journalLines(sb.jr).some((l) => l.includes('disks-disarmed'))) return 'пустое разжатие всё равно написало строку';
    if (r.record.verdict !== 'no-remembered-state') return `вердикт ${r.record.verdict}`;
    return null;
  });

  // ⚠️ ДЫРА КЛАССА N3 (EXP-0133): дежурство со швом, которого БОЕВОЙ ПУТЬ не передаёт, доказано на
  // наборе и не исполняется на машине. Блок читает САМ ИСХОДНИК боевой ветки `--boot-apply`.
  block('вход: БОЕВАЯ ветка --boot-apply реально ПОДАЁТ шов разжатия, а не только набор', async () => {
    const src = fsReadFileSync(fileURLToPath(import.meta.url), 'utf8');
    // ⚠️ ЯКОРЬ БЕРЁТСЯ ПО ПЕЧАТИ БОЕВОЙ ВЕТКИ, А НЕ ПО `argv.includes(...)`. Первая редакция искала
    // именно эту подстроку — и находила ЭТОТ ЖЕ БЛОК, потому что он её содержит: блок читал
    // собственный исходник, видел `disarmDisksFn:` в своём тексте отказа и зеленел ВСЕГДА. Пойман
    // мутацией P1 (снять шов из боевой ветки → блок остался зелёным). Пустая проверка — худший вид
    // сторожа: он отчитывается о защите, которой нет.
    // ⚠️ КЛЮЧ СОБИРАЕТСЯ ИЗ ЧАСТЕЙ, И ЭТО НЕ УКРАШЕНИЕ. Блок, читающий СВОЙ ЖЕ исходник, не имеет
    // права содержать искомую строку целиком — иначе он находит самого себя, а не то, что проверяет.
    // Обе первые редакции этого блока попались: сперва на `argv.includes('--boot-apply')`, потом на
    // печати боевой ветки. Склейка разрывает совпадение, а `lastIndexOf` — вторая страховка: боевая
    // ветка в этом файле идёт ПОСЛЕ набора.
    const marker = `ВОССТАНОВЛЕНИЕ ПРИ ${'ВХОДЕ'} — запомненное состояние`;
    const at = src.lastIndexOf(marker);
    if (at < 0) return 'боевая ветка --boot-apply в исходнике не найдена по своей печати';
    const tail = src.slice(at, at + 1400);
    if (tail.includes('block(')) return 'якорь уехал в набор, а не в боевую ветку — блок снова читает сам себя';
    if (!tail.includes('disarmDisksFn:')) return 'боевой вызов bootApply НЕ передаёт disarmDisksFn — дежурство мертво на машине';
    if (!tail.includes('safe-mode.mjs')) return 'боевая ветка не загружает инструмент безопасного режима';
    return null;
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

  block('загрузка: ВХОД В СИСТЕМУ восстанавливает режим С КРИВОЙ — вектор доезжает до карты (bugs/18)', async () => {
    // THE SECOND FACE OF `bugs/18`, and the one nobody would have seen: this path had no curve
    // backend and no resolver at all, so `apply()` refused every mode that tunes the V/F curve —
    // i.e. every working mode the owner defined («все режимы наши должны тюнить VF кривую»). The
    // remembered state survived a reboot for `factory` and for nothing else, and the only evidence
    // was one journal line on a machine nobody was watching.
    const sb = bootSandbox();
    const b = fakeBackend();
    const cb = fakeCurve();
    let opened = 0;
    writeRememberedState({ profile: 'with-curve' }, sb.rem);
    const p = { ...curveProfile(), name: 'with-curve', qualified: true };
    delete p.draft;
    const r = await bootApply(bootOpts(b, sb, {
      loadProfileByName: () => ({ profile: p, refusals: [] }),
      resolveCurve: async (prof) => resolveProfileCurve(prof),   // inline curve — no store, no card
      openCurveBackend: () => { opened++; return cb; },
    }));
    if (r.record.verdict !== 'applied') return `вердикт ${r.record.verdict}: ${r.record.detail}`;
    if (opened !== 1) return `бэкенд кривой открывали ${opened} раз(а) вместо 1`;
    if (!cb.state.offsets.every((v) => v === 592)) return `кривая на карте не та: ${cb.state.offsets[0]}…`;
    return null;
  });

  block('загрузка: режим БЕЗ кривой не открывает бэкенд кривой вовсе (bugs/18)', async () => {
    // The other half of the same wiring, and it is what keeps the fix from costing every logon an
    // nvapi64.dll load: a power-limit-only mode must reach `apply()` with no curve backend at all.
    const sb = bootSandbox();
    const b = fakeBackend();
    let opened = 0;
    writeRememberedState({ profile: 'silent-cold' }, sb.rem);
    const r = await bootApply(bootOpts(b, sb, { openCurveBackend: () => { opened++; return fakeCurve(); } }));
    if (r.record.verdict !== 'applied') return `вердикт ${r.record.verdict}: ${r.record.detail}`;
    if (opened !== 0) return 'бэкенд кривой открыт для профиля, который кривую не трогает';
    return null;
  });

  // ⚠️ ДОГОВОР ЭТОГО БЛОКА ПЕРЕПИСАН 2026-08-23 СЛОВОМ ВЛАДЕЛЬЦА, и старая редакция ПОКРАСНЕЛА на
  // правке — как и должна была. Прежде загрузка отвергала ЧЕРНОВИК как таковой; теперь она его
  // восстанавливает (владелец применил его своей рукой, и его выбор исполняется), а от петли
  // загрузки защищает ПРЕРЫВАТЕЛЬ — он смотрит, чем кончилось прошлое восстановление, а не читает
  // обещание из булева поля.
  const draftOptimised = () => {
    const p = silentColdFixture();
    p.name = 'optimised'; p.mode = 'optimised'; p.qualified = false;
    p.draft = { candidate: 'кривая +180, -pl 250', source: 'STATUS факт 27' };
    return p;
  };

  block('загрузка: запомненный ЧЕРНОВИК ВОССТАНАВЛИВАЕТСЯ — выбор владельца исполняется', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'optimised' }, sb.rem);
    const r = await bootApply(bootOpts(b, sb, { loadProfileByName: () => ({ profile: draftOptimised(), refusals: [] }) }));
    if (r.record.verdict !== 'applied') return `вердикт ${r.record.verdict} (${r.record.detail})`;
    if (r.code !== 0) return `код ${r.code} вместо 0`;
    return null;
  });

  block('загрузка: НАМЕРЕНИЕ пишется ДО карты — иначе смерть машины не отличить от «не пробовали»', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'optimised' }, sb.rem);
    const order = [];
    await bootApply(bootOpts(b, sb, {
      loadProfileByName: () => ({ profile: draftOptimised(), refusals: [] }),
      writeIntentFn: (rec, p) => { order.push('НАМЕРЕНИЕ'); appendBootIntent(rec, p); },
      openCurveBackend: () => { order.push('КАРТА'); return null; },
    }));
    const iAt = order.indexOf('НАМЕРЕНИЕ');
    if (iAt < 0) return 'намерение не записано вовсе';
    const written = readBootJournal(sb.jr).filter((x) => x.state === 'intent');
    if (written.length !== 1) return `строк намерения в журнале ${written.length} вместо 1`;
    if (written[0].remembered !== 'optimised') return `намерение не назвало профиль: ${JSON.stringify(written[0])}`;
    return null;
  });

  block('ПРЕРЫВАТЕЛЬ ПЕТЛИ: осиротевшее намерение -> восстановление ОСТАНОВЛЕНО, НОЛЬ записей', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'optimised' }, sb.rem);
    // Прошлый вход умер: намерение есть, вердикта за ним нет. Ровно то, что оставляет BSOD.
    appendBootIntent({ remembered: 'optimised' }, sb.jr);
    const r = await bootApply(bootOpts(b, sb, { loadProfileByName: () => ({ profile: draftOptimised(), refusals: [] }) }));
    if (r.record.verdict !== 'degraded-to-factory') return `вердикт ${r.record.verdict}`;
    if (r.code !== 1) return `код ${r.code} вместо 1 — остановка обязана быть громкой`;
    if (b.writes.length !== 0) return `при заблокированном восстановлении ПИСАЛИ в карту: ${b.writes.join(', ')}`;
    if (!/ПРЕРЫВАТЕЛЬ ПЕТЛИ/u.test(r.record.detail)) return `журнал не назвал причину: ${r.record.detail}`;
    return null;
  });

  block('ПРЕРЫВАТЕЛЬ ПЕТЛИ: намерение, ЗАКРЫТОЕ вердиктом, восстановлению не мешает', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'optimised' }, sb.rem);
    appendBootIntent({ remembered: 'optimised' }, sb.jr);
    appendBootJournal({ verdict: 'applied', remembered: 'optimised', detail: 'прошлый вход дожил до вердикта' }, sb.jr);
    const r = await bootApply(bootOpts(b, sb, { loadProfileByName: () => ({ profile: draftOptimised(), refusals: [] }) }));
    if (r.record.verdict !== 'applied') return `вердикт ${r.record.verdict} — закрытое намерение блокировать не должно`;
    return null;
  });

  block('ПРЕРЫВАТЕЛЬ ПЕТЛИ: сирота ЧУЖОГО профиля не блокирует запомненный', async () => {
    const sb = bootSandbox();
    const b = fakeBackend();
    writeRememberedState({ profile: 'optimised' }, sb.rem);
    appendBootIntent({ remembered: 'silent-cold' }, sb.jr);
    const r = await bootApply(bootOpts(b, sb, { loadProfileByName: () => ({ profile: draftOptimised(), refusals: [] }) }));
    if (r.record.verdict !== 'applied') return `вердикт ${r.record.verdict} — сирота чужого режима здесь ни при чём`;
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
        state.calls.push(`write:${Array.isArray(deltaMhz) ? `вектор[${deltaMhz.length}]` : deltaMhz}:${capMhz}`);
        if (!writeOk) return { ok: false, why: 'подставной отказ записи' };
        // The twin mirrors the real backend's contract: a per-point raise lands per point, a scalar
        // fills. A stand-in that flattened a vector would make the vector blocks green by not testing
        // the vector at all.
        const vector = Array.isArray(deltaMhz)
          ? Array.from({ length: 128 }, (_, i) => deltaMhz[i] ?? 0)
          : new Array(128).fill(deltaMhz);
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
    settings: { powerLimitWatts: 250, graphicsClockLockMhz: null, curveRef: null, curveCapMhz: null, curveRaiseAndCapMhz: { deltaMhz: 592, capMhz: 2130 } },
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

  // --- ВЕКТОР (`plans/12` §4.4). МУТАЦИОННЫЕ АДРЕСАТЫ, НАЗВАННЫЕ ДО ПРОГОНА (EXP-0016):
  //   H. `raise` всегда берёт `deltaMhz`      → «ВЕКТОР: своё смещение на каждую точку доезжает до карты»
  //   I. строка шага всегда «подъём +N»       → «ВЕКТОР: шаг НАЗЫВАЕТ форму записи»
  //   J. снят отказ по introducesInversion    → «ВЕКТОР: инверсия ОТВЕРГНУТА последней строкой перед записью»
  const vectorProfile = () => {
    const p = curveProfile();
    // Bottom of the curve raised little, top raised much — the shape the band sweep will produce,
    // because the lever yields 45 mV at 1700 MHz and 245 mV at 2842 (`STATUS.md`).
    p.settings.curveRaiseAndCapMhz = {
      deltaMhz: null,
      deltaByPointMhz: Array.from({ length: 127 }, (_, i) => (i < 60 ? 40 : 300)),
      capMhz: 2130,
    };
    return p;
  };

  block('ВЕКТОР: своё смещение на каждую точку доезжает до карты, а не схлопывается в одно число', async () => {
    const b = fakeBackend(); const cb = fakeCurve();
    const r = await apply(b, vectorProfile(), { card: SELFTEST_CARD, timing: FAST, curveBackend: cb });
    if (!r.applied) return 'профиль с вектором не применился';
    if (cb.state.offsets[0] !== 40 || cb.state.offsets[59] !== 40) return `низ кривой не 40: ${cb.state.offsets[0]}/${cb.state.offsets[59]}`;
    if (cb.state.offsets[60] !== 300 || cb.state.offsets[126] !== 300) return `верх кривой не 300: ${cb.state.offsets[60]}/${cb.state.offsets[126]}`;
    return null;
  });

  block('ВЕКТОР: шаг НАЗЫВАЕТ форму записи — оператор читает эту строку перед записью в карту владельца', async () => {
    const b = fakeBackend(); const cb = fakeCurve();
    const r = await apply(b, vectorProfile(), { card: SELFTEST_CARD, timing: FAST, curveBackend: cb });
    const said = r.steps.find((s) => s.includes('кривая V/F')) ?? '';
    if (!/ВЕКТОР на 127 точек/u.test(said)) return `шаг не назвал форму: ${said || '(шага кривой нет)'}`;
    if (/подъём \+/u.test(said)) return `шаг вектора напечатался как скалярный подъём: ${said}`;
    return null;
  });

  block('ВЕКТОР: падение позже откатывает кривую ПО ИМЕНИ — откат не зависит от формы записи (R9a)', async () => {
    const b = fakeBackend({ failOn: 'power' }); const cb = fakeCurve();
    try {
      await apply(b, vectorProfile(), { card: SELFTEST_CARD, timing: FAST, curveBackend: cb });
      return 'применение прошло, хотя шаг потолка мощности должен был упасть';
    } catch (e) {
      const undone = (e.rollback ?? []).join(' | ');
      if (!/кривая V\/F/u.test(undone)) return `в откате нет шага кривой ПО ИМЕНИ: ${undone || '(пусто)'}`;
      if (cb.state.offsets.some((v) => v !== 0)) return 'кривая не обнулена откатом';
      return null;
    }
  });

  block('bugs/98: ПРИМЕНЕНИЕ ИДЕМПОТЕНТНО — записанные сдвиги НЕ зависят от того, что уже стоит на карте', async () => {
    // ЧТО ЭТОТ БЛОК СТОРОЖИТ, СЛОВАМИ ВЛАДЕЛЬЦА 2026-08-31: *«Не применяйте профиль поверх уже
    // применённого — ну это баг. Я говорил, что повторное применение не должно ломать профиль»*.
    //
    // Дефект, ИЗМЕРЕННЫЙ на его карте: `readVfCurve` отдаёт таблицу УЖЕ С НАШИМИ СДВИГАМИ, а сдвиги
    // пишутся АБСОЛЮТНО. Второе применение считало почти нули и записывало их поверх настоящих —
    // 127 точек из 127 вернулись к заводским, при нулевом коде возврата и зелёном перечитывании.
    //
    // ОПЫТ ПОСТРОЕН КАК ПАРА, А НЕ КАК ОДИН ПРОГОН, и это его суть: одно применение доказать
    // идемпотентность НЕ МОЖЕТ по построению. Прогон А пишет от заводской таблицы; прогон Б получает
    // таблицу «заводская + то, что записал А» И читателя сдвигов А. Требование: Б записывает РОВНО
    // то же, что А. Мутация «убрать читателя сдвигов из прогона Б» краснит блок — тогда Б получает
    // почти нули, то есть ровно дефект.
    const nvapiReal = await import('./nvapi.mjs');
    const factory = Array.from({ length: 128 }, (_, i) => {
      if (i === 127) return { i, mhz: 405, mv: 515, freqKhz: 405_000 };
      const mhz = i <= 20 ? 180 : Math.round(180 + ((3000 - 180) * (i - 20)) / (126 - 20));
      return { i, mhz, mv: 450 + i * 5, freqKhz: mhz * 1000 };
    });
    // Вектор поднимает ВСЕ точки от 40-й и выше, а не участок посередине: подъём участка обрывает
    // монотонность на его границе (точка 90 поднята, 91 нет), и сторож порядка законно отказывает —
    // первая редакция этой фикстуры на том и села. Фикстура обязана выражать опыт, а не спорить с
    // соседним сторожем.
    const asked = Array.from({ length: 127 }, (_, i) => (i >= 40 ? 200 : 0));
    const ROOMY = { cardMaxClockMhz: 3600 };
    const run = (points, offsetsOnCard) => {
      let written = null;
      const injected = {
        CLK_VF_POINT_COUNT: nvapiReal.CLK_VF_POINT_COUNT,
        buildRaiseAndCapVector: nvapiReal.buildRaiseAndCapVector,
        readVfCurve: () => ({ ok: true, points }),
        writeCurve: (nv, h, offs) => { written = [...offs]; return { ok: true }; },
        zeroCurve: () => ({ ok: true }),
        openNvapi: () => ({ koffi: { call: () => {} }, resolve: () => ({ ptr: 0 }), protos: {} }),
        ...(offsetsOnCard ? { readVfOffsetsStable: () => ({ ok: true, offsets: offsetsOnCard.map((mhz) => mhz * 1000) }) } : {}),
      };
      const cb = nvapiCurveBackend({ nvapi: injected });
      return cb.writeRaiseAndCap(asked, null, ROOMY).then((r) => ({ r, written }));
    };

    // ── ПРОГОН А: карта на заводе, сдвигов нет ──────────────────────────────────────────────────
    const A = await run(factory, new Array(128).fill(0));
    if (!A.r.ok) return `прогон А (от заводской таблицы) не записал: ${A.r.why}`;
    if (!A.written) return 'прогон А не дошёл до записи';
    const raisedA = A.written.filter((v) => v !== 0).length;
    if (raisedA === 0) return 'прогон А не поднял ни одной точки — фикстура не выражает опыт';

    // ── ПРОГОН Б: карта УЖЕ несёт то, что записал А ─────────────────────────────────────────────
    const applied = factory.map((pt, j) => (j < 127 && Number.isFinite(pt.mhz)
      ? { ...pt, mhz: pt.mhz + (A.written[j] ?? 0) } : pt));
    const B = await run(applied, A.written);
    if (!B.r.ok) return `прогон Б (поверх применённого) ОТКАЗАЛ: ${B.r.why}`;
    if (!B.written) return 'прогон Б не дошёл до записи';

    const diff = A.written.reduce((n, v, j) => n + (v === B.written[j] ? 0 : 1), 0);
    if (diff !== 0) {
      const ex = A.written.map((v, j) => [j, v, B.written[j]]).filter(([, v, w]) => v !== w).slice(0, 4);
      return `повторное применение записало ДРУГОЕ: разошлось ${diff} точек из 127 — ${JSON.stringify(ex)}`;
    }
    return null;
  });

  block('bugs/98: и сторож огибающей R13 НЕ отказывает поверх применённого профиля (ложная тревога)', async () => {
    // Вторая половина, без которой первая недоказуема. Починка вектора без починки СТОРОЖА лишь
    // меняла тихую порчу на ложный отказ: сторож складывал полный сдвиг с уже сдвинутой частотой и
    // видел превышение, которого нет. Ровно это и случилось на карте владельца — «мы подняли точку
    // до 3157 МГц», при том что наш сдвиг в той точке был НОЛЬ.
    const nvapiReal = await import('./nvapi.mjs');
    const factory = Array.from({ length: 128 }, (_, i) => {
      if (i === 127) return { i, mhz: 405, mv: 515, freqKhz: 405_000 };
      const mhz = i <= 20 ? 180 : Math.round(180 + ((3000 - 180) * (i - 20)) / (126 - 20));
      return { i, mhz, mv: 450 + i * 5, freqKhz: mhz * 1000 };
    });
    // Подъём 80 МГц выбран арифметикой, а не на вкус: верх заводской таблицы 3000, значит один
    // подъём даёт 3080 и проходит под огибающей 3100, а двойной счёт дал бы 3160 и НЕ прошёл бы.
    // Так блок различает починку от её отсутствия, а не проверяет, что места много.
    const asked = Array.from({ length: 127 }, (_, i) => (i >= 40 ? 80 : 0));
    // Огибающая ТЕСНАЯ: она пропускает заводскую таблицу с этим вектором и НЕ пропустила бы двойной
    // счёт. Иначе блок зеленел бы просто потому, что места много.
    const TIGHT = { cardMaxClockMhz: 3100 };
    const mk = (points, offsetsOnCard) => nvapiCurveBackend({
      nvapi: {
        CLK_VF_POINT_COUNT: nvapiReal.CLK_VF_POINT_COUNT,
        buildRaiseAndCapVector: nvapiReal.buildRaiseAndCapVector,
        readVfCurve: () => ({ ok: true, points }),
        writeCurve: () => ({ ok: true }),
        zeroCurve: () => ({ ok: true }),
        readVfOffsetsStable: () => ({ ok: true, offsets: offsetsOnCard.map((mhz) => mhz * 1000) }),
        openNvapi: () => ({ koffi: { call: () => {} }, resolve: () => ({ ptr: 0 }), protos: {} }),
      },
    });
    const first = await mk(factory, new Array(128).fill(0)).writeRaiseAndCap(asked, null, TIGHT);
    if (!first.ok) return `от заводской таблицы сторож отказал, хотя не должен: ${first.why}`;
    const applied = factory.map((pt, j) => (j < 127 && Number.isFinite(pt.mhz)
      ? { ...pt, mhz: pt.mhz + (asked[j] ?? 0) } : pt));
    const second = await mk(applied, asked).writeRaiseAndCap(asked, null, TIGHT);
    if (!second.ok) return `поверх применённого сторож отказал ЛОЖНО: ${second.why}`;
    return null;
  });

  block('bugs/98: канал сдвигов ОТВЕТИЛ ОТКАЗОМ -> запись НЕ идёт (R4b), и ни одна точка не записана', async () => {
    // Найдено мутацией: «отказ чтения = сдвигов нет» проходило зелёным, потому что фикстура всегда
    // отвечала успехом. Молчаливый съезд на живую таблицу и есть дефект bugs/98 — значит отказ канала
    // обязан ОСТАНОВИТЬ запись, а не подменить опору догадкой.
    //
    // И вторая половина, без которой это была бы просто строгость: ОТСУТСТВИЕ канала (цифровой
    // двойник) обязано по-прежнему РАБОТАТЬ. Иначе сторож против дефекта сломал бы стенд.
    const nvapiReal = await import('./nvapi.mjs');
    const points = Array.from({ length: 128 }, (_, i) => {
      if (i === 127) return { i, mhz: 405, mv: 515, freqKhz: 405_000 };
      const mhz = i <= 20 ? 180 : Math.round(180 + ((3000 - 180) * (i - 20)) / (126 - 20));
      return { i, mhz, mv: 450 + i * 5, freqKhz: mhz * 1000 };
    });
    const asked = Array.from({ length: 127 }, (_, i) => (i >= 40 ? 80 : 0));
    let writes = 0;
    const base = {
      CLK_VF_POINT_COUNT: nvapiReal.CLK_VF_POINT_COUNT,
      buildRaiseAndCapVector: nvapiReal.buildRaiseAndCapVector,
      readVfCurve: () => ({ ok: true, points }),
      writeCurve: () => { writes++; return { ok: true }; },
      zeroCurve: () => ({ ok: true }),
      openNvapi: () => ({ koffi: { call: () => {} }, resolve: () => ({ ptr: 0 }), protos: {} }),
    };
    const ROOMY = { cardMaxClockMhz: 3600 };

    // (1) КАНАЛ ЕСТЬ, НО ОТВЕТИЛ ОТКАЗОМ — записи быть не должно ВОВСЕ
    const refused = await nvapiCurveBackend({
      nvapi: { ...base, readVfOffsetsStable: () => ({ ok: false, why: 'проба не устоялась' }) },
    }).writeRaiseAndCap(asked, null, ROOMY);
    if (refused.ok) return 'отказ канала сдвигов НЕ остановил запись';
    if (writes !== 0) return `при отказе канала записано ${writes} раз(а) — должно быть 0`;
    if (!/сдвиги карты не прочитались/u.test(refused.why ?? '')) return `причина отказа не названа: ${refused.why}`;

    // (2) КАНАЛА НЕТ ВОВСЕ (двойник) — обязано работать как раньше
    const twin = await nvapiCurveBackend({ nvapi: base }).writeRaiseAndCap(asked, null, ROOMY);
    if (!twin.ok) return `без канала сдвигов (двойник) запись сломалась: ${twin.why}`;
    if (writes !== 1) return `двойник записал ${writes} раз(а) вместо одного`;
    return null;
  });

  block('ВЕКТОР: инверсия ОТВЕРГНУТА последней строкой перед записью, и ни одна точка не записана', async () => {
    // This one drives the REAL `nvapiCurveBackend` with an injected nvapi module, because the refusal
    // lives there — in the last line before the device write (P6-AC10). A block that checked it on the
    // fake backend would prove nothing about the path that actually writes.
    const nvapiReal = await import('./nvapi.mjs');
    const points = Array.from({ length: 128 }, (_, i) => {
      if (i === 127) return { i, mhz: 405, mv: 515, freqKhz: 405_000 };
      const mhz = i <= 20 ? 180 : Math.round(180 + ((3172 - 180) * (i - 20)) / (126 - 20));
      return { i, mhz, mv: 450 + i * 5, freqKhz: mhz * 1000 };
    });
    let writes = 0;
    const injected = {
      CLK_VF_POINT_COUNT: nvapiReal.CLK_VF_POINT_COUNT,
      buildRaiseAndCapVector: nvapiReal.buildRaiseAndCapVector,      // the REAL arithmetic
      readVfCurve: () => ({ ok: true, points }),
      writeCurve: () => { writes++; return { ok: true }; },
      zeroCurve: () => ({ ok: true }),
      readVfOffsets: () => ({ ok: true, offsets: new Array(128).fill(0) }),
      openNvapi: () => ({ koffi: { call: () => {} }, resolve: () => ({ ptr: 0 }), protos: {} }),
    };
    const cb = nvapiCurveBackend({ nvapi: injected });
    // Point 61 dragged 900 MHz above its neighbours: a LOWER-voltage point offering a HIGHER clock.
    const inverting = Array.from({ length: 127 }, (_, i) => (i === 61 ? 900 : 0));
    // The bound is deliberately set ABOVE anything this synthetic curve can offer (its top is 3172 and
    // the well-ordered vector below reaches 3472): this block is about ORDER, and it must not be
    // pre-empted by R13's envelope refusal. R13 has its own block, on its own numbers.
    const ROOMY = { cardMaxClockMhz: 3600 };
    const bad = await cb.writeRaiseAndCap(inverting, null, ROOMY);
    if (bad.ok !== false) return 'инвертирующий вектор ПРОШЁЛ в карту';
    if (!/ЛОМАЕТ ПОРЯДОК/u.test(bad.why ?? '')) return `отказ не про порядок кривой: ${bad.why}`;
    if (!/точка 62/u.test(bad.why ?? '') || !/точки 61/u.test(bad.why ?? '')) return `отказ не назвал пару точек: ${bad.why}`;
    if (writes !== 0) return `отказ произошёл ПОСЛЕ записи: записей ${writes}`;
    // …and the same backend accepts a well-ordered vector, or the block above is green because
    // nothing ever passes.
    const good = await cb.writeRaiseAndCap(Array.from({ length: 127 }, (_, i) => (i < 60 ? 40 : 300)), null, ROOMY);
    if (good.ok !== true) return `нормальный вектор тоже отвергнут: ${good.why}`;
    return null;
  });

  // --- ССЫЛКА НА ДОКУМЕНТ КРИВОЙ (`bugs/18`). МУТАЦИОННЫЕ АДРЕСАТЫ, НАЗВАННЫЕ ДО ПРОГОНА (EXP-0016):
  //   L. `apply` игнорирует переданный `curve` и разрешает сам → «ССЫЛКА: разрешение вызывающего…»
  //   M. `curve: null` проваливается во второе разрешение    → «ССЫЛКА: null это ОТВЕТ…»
  //   N. `resolveProfileCurve` не зовёт `toOffsets` для ссылки → «ССЫЛКА: документ становится ВЕКТОРОМ…»
  //   O. `bootApply` зовёт `apply` без `curve`/`curveBackend`  → «ССЫЛКА: ВХОД В СИСТЕМУ восстанавливает…»
  //
  // A document with four frequencies against a four-point table — small on purpose, so the expected
  // offsets can be read by eye rather than recomputed by the same code under test.
  const refProfile = () => {
    const p = curveProfile();
    p.settings.curveRaiseAndCapMhz = null;
    p.settings.curveRef = 'measured';
    return p;
  };
  // The resolution a CALLER would produce: a per-point vector, distinct at every point so a collapse
  // into one number cannot pass unnoticed.
  const resolvedVector = () => ({
    deltaByPointMhz: Array.from({ length: 127 }, (_, i) => 10 + i),
    capMhz: null,
    __fromRef: 'measured',
  });

  block('ССЫЛКА: разрешение ВЫЗЫВАЮЩЕГО доезжает до карты — apply не разрешает второй раз (bugs/18)', async () => {
    const b = fakeBackend(); const cb = fakeCurve();
    // No `loadCurve` is passed on purpose: if `apply` re-resolved, it would reach `defaultCurveLoader`
    // and throw — which is EXACTLY the defect this block is the regression test for.
    const r = await apply(b, refProfile(), { card: SELFTEST_CARD, timing: FAST, curveBackend: cb, curve: resolvedVector() });
    if (!r.applied) return 'профиль со ссылкой не применился';
    if (cb.state.offsets[0] !== 10) return `первая точка не 10: ${cb.state.offsets[0]}`;
    if (cb.state.offsets[126] !== 136) return `последняя точка не 136: ${cb.state.offsets[126]}`;
    return null;
  });

  block('ССЫЛКА: null это ОТВЕТ «кривой нет», а не «разреши сам» — карта не тронута кривой (bugs/18)', async () => {
    const b = fakeBackend(); const cb = fakeCurve();
    // The same reference profile, but the caller resolved it to «no curve». A fall-through to a second
    // resolution would throw on the missing loader; a correct one writes no curve at all.
    const r = await apply(b, refProfile(), { card: SELFTEST_CARD, timing: FAST, curveBackend: cb, curve: null });
    if (!r.applied) return 'применение провалилось, хотя кривой не запрашивалось';
    if (cb.state.offsets.some((v) => v !== 0)) return 'кривая записана, хотя вызывающий сказал «кривой нет»';
    // The precise assertion is «no RAISE was written», not «no curve step appears»: a profile without
    // a curve legitimately ZEROES one a previous profile may have left, and the first draft of this
    // block called that zeroing a defect. The block was wrong, not the code — the same over-specified
    // assertion EXP-0075 keeps producing, caught here by the block failing on correct behaviour.
    const wrote = cb.state.calls.filter((c) => c.startsWith('write:'));
    if (wrote.length) return `кривая ЗАПИСАНА при curve: null: ${wrote.join(', ')}`;
    return null;
  });

  block('ССЫЛКА: документ «частота → напряжение» становится ВЕКТОРОМ смещений, без карты и без curves/ (bugs/18)', async () => {
    const { offsetsFor } = await import('./curve-store.mjs');
    // Four frequencies, four table entries. The document asks for LESS voltage at the two top
    // frequencies and leaves the two bottom ones at stock.
    // The document's own field names, taken from `curve-store.offsetsFor` rather than guessed: rows
    // live in `frequencies`, high → low, and the voltage field is `voltageMv`. The first draft of this
    // fixture invented `points`/`mv` and the block DIED instead of reddening — EXP-0075 again, and the
    // reason the fixture is now written against the reader's contract.
    const doc = {
      card: { maxGraphicsMhz: 3090 },
      frequencies: [
        { mhz: 3000, voltageMv: 1000, status: 'lever-limited' },
        { mhz: 2000, voltageMv: 900, status: 'lever-limited' },
        { mhz: 1000, voltageMv: 800, status: 'stock' },
        { mhz: 500, voltageMv: 700, status: 'stock' },
      ],
    };
    // A table entry needs `freqKhz > 0` to count at all — that is how `offsetsFor` skips the memory
    // rung's dead entries.
    const table = [
      { i: 0, mhz: 500, mv: 700, freqKhz: 500_000 }, { i: 1, mhz: 1000, mv: 800, freqKhz: 1_000_000 },
      { i: 2, mhz: 1800, mv: 900, freqKhz: 1_800_000 }, { i: 3, mhz: 2800, mv: 1000, freqKhz: 2_800_000 },
    ];
    const eff = await resolveProfileCurve(refProfile(), {
      loadCurve: (name) => (name === 'measured' ? doc : null),
      readLive: async () => table,
      toOffsets: (d, t) => offsetsFor(d, t, { count: 4 }),
    });
    if (!eff) return 'ссылка разрешилась в «кривой нет»';
    if (!Array.isArray(eff.deltaByPointMhz)) return `разрешилось не вектором: ${JSON.stringify(eff)}`;
    if (eff.deltaByPointMhz.length !== 4) return `точек ${eff.deltaByPointMhz.length}, ожидалось 4`;
    if (eff.__fromRef !== 'measured') return 'разрешённая кривая не помнит, из какого документа она';
    // 900 mV serves 1800 MHz on the table and must serve 2000 MHz per the document → +200 MHz.
    // 1000 mV serves 2800 and must serve 3000 → +200 MHz. The two stock rows must not move.
    if (eff.deltaByPointMhz[2] !== 200) return `1800 МГц: смещение ${eff.deltaByPointMhz[2]}, ожидалось 200`;
    if (eff.deltaByPointMhz[3] !== 200) return `2800 МГц: смещение ${eff.deltaByPointMhz[3]}, ожидалось 200`;
    if (eff.deltaByPointMhz[0] !== 0 || eff.deltaByPointMhz[1] !== 0) {
      return `стоковые строки сдвинуты: ${eff.deltaByPointMhz[0]}/${eff.deltaByPointMhz[1]}`;
    }
    return null;
  });

  block('R13: кривая ВЫШЕ МАКСИМУМА КАРТЫ отвергнута до записи, и бомба bugs/11 краснит именно этот блок', async () => {
    // THE REGRESSION TEST OF THE BSOD, on the real backend with an injected nvapi module — the refusal
    // lives in the last line before the device write, so a fake backend would prove nothing.
    //
    // The fixture is not invented: the synthetic curve is shaped like this card (top 3157 MHz in the
    // V/F table), the bound is this card's answer (3090 MHz), and the raise is the one that shipped
    // in `profiles/optimised.json` at commit `bd30ea3` — +592 MHz with `capMhz: null`. That exact
    // trio bugchecked the owner's machine on 2026-08-15.
    const nvapiReal = await import('./nvapi.mjs');
    const points = Array.from({ length: 128 }, (_, i) => {
      if (i === 127) return { i, mhz: 405, mv: 515, freqKhz: 405_000 };
      const mhz = i <= 20 ? 180 : Math.round(180 + ((3157 - 180) * (i - 20)) / (126 - 20));
      return { i, mhz, mv: 450 + i * 5, freqKhz: mhz * 1000 };
    });
    let writes = 0;
    const injected = {
      CLK_VF_POINT_COUNT: nvapiReal.CLK_VF_POINT_COUNT,
      buildRaiseAndCapVector: nvapiReal.buildRaiseAndCapVector,
      readVfCurve: () => ({ ok: true, points }),
      writeCurve: () => { writes++; return { ok: true }; },
      zeroCurve: () => ({ ok: true }),
      readVfOffsets: () => ({ ok: true, offsets: new Array(128).fill(0) }),
      openNvapi: () => ({ koffi: { call: () => {} }, resolve: () => ({ ptr: 0 }), protos: {} }),
    };
    const cb = nvapiCurveBackend({ nvapi: injected });
    const CARD_MAX = 3090;

    // 1. THE BOMB: exactly what was applied on 2026-08-15 — uniform +592, no cap.
    const bomb = await cb.writeRaiseAndCap(592, null, { cardMaxClockMhz: CARD_MAX });
    if (bomb.ok !== false) return 'форма, уронившая машину 2026-08-15, ПРОШЛА в карту';
    if (!/НИКОГДА НЕ ГНАТЬ/u.test(bomb.why ?? '')) return `отказ не сослался на правило владельца: ${bomb.why}`;
    if (!new RegExp(String(CARD_MAX), 'u').test(bomb.why ?? '')) return `отказ не назвал максимум карты: ${bomb.why}`;
    if (!/мы подняли точку до/u.test(bomb.why ?? '')) return `отказ не назвал, что превышение НАШЕ: ${bomb.why}`;
    if (writes !== 0) return `отказ произошёл ПОСЛЕ записи: записей ${writes}`;

    // 1a. AND THE GUARD MUST NOT BE A WALL. This synthetic curve, like the real one, has a FACTORY top
    //     (3157) ABOVE the card's maximum (3090). A guard reading the whole curve's top instead of what
    //     WE lifted would refuse a vector of all zeroes — a guard causing the regression it exists to
    //     prevent. Found by running the first version of this check against the live card.
    const noop = await cb.writeRaiseAndCap(0, null, { cardMaxClockMhz: CARD_MAX });
    if (noop.ok !== true) return `нулевой подъём отвергнут, хотя мы ничего не поднимали: ${noop.why}`;

    // 2. THE BOUND IS REQUIRED, not defaulted: a caller that forgets it is refused, not waved through.
    //    The write counter is compared against ITS OWN previous value, not against zero: case 1a above
    //    legitimately writes, and an absolute-zero assertion would fail for the wrong reason (it did,
    //    on the first run of this block — the assertion was wrong, not the guard).
    const writesBeforeNoBound = writes;
    const noBound = await cb.writeRaiseAndCap(592, null);
    if (noBound.ok !== false) return 'запись без известного максимума карты прошла';
    if (!/максимум карты не передан/u.test(noBound.why ?? '')) return `отказ не про отсутствующий максимум: ${noBound.why}`;
    if (writes !== writesBeforeNoBound) return `отказ без максимума произошёл ПОСЛЕ записи: новых записей ${writes - writesBeforeNoBound}`;

    // 3. THE SAME RAISE UNDER THE CEILING IT WAS PROVEN WITH PASSES — or block 1 is green because
    //    nothing ever passes, and the guard would be a wall instead of a gate. 2842 MHz is the ceiling
    //    the three live descents actually used.
    const proven = await cb.writeRaiseAndCap(592, 2842, { cardMaxClockMhz: CARD_MAX });
    if (proven.ok !== true) return `доказанная форма (подъём 592 под потолком 2842) отвергнута: ${proven.why}`;

    // 4. THE EDGE IS INCLUSIVE: landing exactly on the card's maximum is legal, one MHz over is not.
    //    Without this the guard's boundary would be whatever an off-by-one happened to make it.
    const exact = await cb.writeRaiseAndCap(592, CARD_MAX, { cardMaxClockMhz: CARD_MAX });
    if (exact.ok !== true) return `ровно максимум карты отвергнут, хотя он разрешён: ${exact.why}`;
    const writesBeforeOver = writes;
    const over = await cb.writeRaiseAndCap(592, CARD_MAX + 1, { cardMaxClockMhz: CARD_MAX });
    if (over.ok !== false) return 'потолок на 1 МГц выше максимума карты прошёл';
    if (writes !== writesBeforeOver) return `отказ на границе произошёл ПОСЛЕ записи: новых записей ${writes - writesBeforeOver}`;
    return null;
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

  // ─── `bugs/45`: ЗАВОДСКОЕ СОСТОЯНИЕ КАРТЫ — СУДЬЯ, И ОН ЧИСТАЯ ФУНКЦИЯ ────────────────────────
  //
  // Фикстуры подобраны так, чтобы СЛОМАННЫЙ вариант давал ДРУГОЙ ответ, а не тот же самый
  // (EXP-0176): у заводского случая обе оси заводские, у каждого дефектного — ровно одна ось не
  // заводская, поэтому мутация, убирающая проверку одной оси, краснит свой блок и только свой.
  // АДРЕСАТЫ МУТАЦИЙ: EA — убрать ветку кривой · EB — убрать ветку мощности ·
  // EC — считать непрочитанную ось заводской (`factory: null` → `true`).

  block('bugs/45: заводская карта — обе оси заводские, вердикт ЗАВОДСКАЯ', async () => {
    const v = factoryStateVerdict({ powerLimitW: 300, powerDefaultW: 300, curveNonZero: 0 });
    if (v.factory !== true) return `заводская карта названа незаводской: ${v.why}`;
    if (v.parts.length !== 2) return `осей должно быть две, а их ${v.parts.length}`;
    return null;
  });

  block('bugs/45: ПОДНЯТАЯ КРИВАЯ при заводской мощности — вердикт НЕ заводская, и названа ось', async () => {
    const v = factoryStateVerdict({ powerLimitW: 300, powerDefaultW: 300, curveNonZero: 65 });
    if (v.factory !== false) return `поднятая кривая пропущена как заводское состояние: ${v.why}`;
    if (!/65/u.test(v.why)) return `отказ не назвал ЧИСЛО ненулевых сдвигов: ${v.why}`;
    const curve = v.parts.find((p) => p.axis === 'кривая');
    if (curve?.factory !== false) return 'ось кривой не названа незаводской';
    if (v.parts.find((p) => p.axis === 'мощность')?.factory !== true) return 'ось мощности оболгана — она заводская';
    return null;
  });

  block('bugs/45: ПОТОЛОК МОЩНОСТИ 250 при заводских 300 и чистой кривой — вердикт НЕ заводская', async () => {
    const v = factoryStateVerdict({ powerLimitW: 250, powerDefaultW: 300, curveNonZero: 0 });
    if (v.factory !== false) return `применённый предел мощности пропущен: ${v.why}`;
    if (!/250/u.test(v.why) || !/300/u.test(v.why)) return `отказ не назвал ОБА числа: ${v.why}`;
    if (v.parts.find((p) => p.axis === 'кривая')?.factory !== true) return 'ось кривой оболгана — она заводская';
    return null;
  });

  block('bugs/45: ровно тот случай 2026-08-23 — Optimised целиком: 250 Вт И 65 сдвигов', async () => {
    const v = factoryStateVerdict({ powerLimitW: 250, powerDefaultW: 300, curveNonZero: 65 });
    if (v.factory !== false) return `состояние живого прогона 23.08 признано заводским: ${v.why}`;
    if (v.parts.filter((p) => p.factory === false).length !== 2) return 'незаводскими названы не обе оси';
    return null;
  });

  block('bugs/45: НЕПРОЧИТАННАЯ кривая — вердикт НЕИЗВЕСТНО, а не «заводская» («не смогли посмотреть» ≠ «не нашли»)', async () => {
    const v = factoryStateVerdict({ powerLimitW: 300, powerDefaultW: 300, curveNonZero: null, curveWhy: 'ClkVfPointsGetControl не разрешился' });
    if (v.factory !== null) return `непрочитанная ось выдана за ответ: ${v.factory} (${v.why})`;
    if (!/НЕ ПРОЧИТАНА/u.test(v.why)) return `вердикт не сказал, что смотреть не удалось: ${v.why}`;
    if (!/не разрешился/u.test(v.why)) return `вердикт не донёс ПРИЧИНУ до вызывающего: ${v.why}`;
    return null;
  });

  block('bugs/45: одна непрочитанная ось делает НЕИЗВЕСТНЫМ весь ответ, даже когда вторая ось грязная', async () => {
    const v = factoryStateVerdict({ powerLimitW: 250, powerDefaultW: 300, curveNonZero: null });
    if (v.factory !== null) return `ответ выдан по половине состояния: ${v.factory}`;
    return null;
  });

  block('bugs/45: допуск по ваттам тот же, что у сброса — 0,3 Вт дрожания не делают карту незаводской', async () => {
    const v = factoryStateVerdict({ powerLimitW: 300.3, powerDefaultW: 300, curveNonZero: 0 });
    if (v.factory !== true) return `дрожание телеметрии в ${WATT_EPSILON} Вт принято за применённый профиль: ${v.why}`;
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
    // ⚠️ ШОВ ПОДАЁТСЯ ИМЕННО ЗДЕСЬ, В БОЕВОМ ПУТИ. Функция с необязательным швом, которого боевой
    // вызов не передаёт, — это дежурство, доказанное на наборе и не исполняемое на машине; ровно эту
    // дыру нашла мутация N3 в эпике 33 (EXP-0133: сторожить оба конца провода — не значит сторожить
    // провод). Блок ниже проверяет, что вызов подаёт его.
    // Модуль грузится ЗАРАНЕЕ и мягко: сломанный или отсутствующий инструмент дисков не имеет права
    // помешать восстановлению профиля карты — это два независимых дежурства одного поезда.
    let safeMode = null;
    try { safeMode = await import('../../tools/safe-mode.mjs'); } catch (e) {
      console.log(`  ДИСКИ    инструмент безопасного режима не загрузился (${e?.message ?? e}) — разжатие пропущено`);
    }
    const { code, record } = await bootApply({
      disarmDisksFn: safeMode ? () => (safeMode.readReceipt() ? safeMode.disarm({}) : null) : null,
    });
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
    // The referenced document is loaded HERE, in the CLI, because only the CLI may `await import` the
    // store (which transitively pulls the card probes). Everything below sees one resolved shape.
    const effCurve = await resolveProfileCurve(profile);
    const needsCurve = effCurve !== null;
    const curveBackend = needsCurve ? nvapiCurveBackend() : null;

    console.log(`ПРИМЕНЕНИЕ «${profile.name}» — «${profile.title}»`);
    if (witness && isDraft) {
      console.log('⚠️  ПРИЁМОЧНЫЙ ПРОГОН ЧЕРНОВИКА (--witness): числа этого профиля НЕ прошли приёмку.');
      console.log('    Он применяется, чтобы вы его СУДИЛИ, и НЕ запоминается для автозагрузки.');
      console.log('    Ярлык на столе этот профиль по-прежнему отвергает.');
    }
    if (needsCurve) {
      const c = effCurve;
      const shape = c.__fromRef
        ? `вектор из документа «${c.__fromRef}» на ${c.deltaByPointMhz.length} точек`
        : (Array.isArray(c.deltaByPointMhz) ? `вектор на ${c.deltaByPointMhz.length} точек` : `подъём +${c.deltaMhz} МГц`);
      console.log(`    кривая V/F: ${shape}, ${c.capMhz === null ? 'ПОТОЛКА НЕТ' : `потолок ${c.capMhz} МГц`} (пишется через NVAPI)`);
      if (c.capMhz === null) {
        console.log('    ⚠️  БЕЗ ПОТОЛКА карта уйдёт на частоты ВЫШЕ измеренных: андервольт проверялся');
        console.log('        на точке, обслуживавшей потолок, а выше её обслуживают другие точки.');
      }
    }
    console.log('ОТКАТ НАЗВАН ДО ЗАПИСИ: npm run profile -- --reset (то же, что третий ярлык владельца).');

    let r;
    try {
      // `curve: effCurve` — the resolution above is HANDED OVER, not recomputed (`bugs/18`).
      // СОГЛАСИЕ ИМЕНОВАНО. Приёмочный прогон и обычный клик — РАЗНЫЕ основания с разной ценой:
      // первый не запоминается для автозагрузки, второй запоминается. Свернуть их в один булев
      // значило бы потерять именно то, что различает (`plans/28`, слово владельца 2026-08-23).
      const consent = witness && isDraft ? 'приёмочный прогон (--witness)' : 'клик владельца';
      r = await apply(backend, profile, { card, curveBackend, curve: effCurve, consent });
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
    // РУКА ВЛАДЕЛЬЦА СНИМАЕТ БЛОКИРОВКУ ПРЕРЫВАТЕЛЯ. Если прошлое восстановление этого режима
    // умерло вместе с машиной, в журнале лежит осиротевшее намерение, и загрузка больше его не
    // трогает. Владелец, применивший режим ЗАНОВО и своей рукой, тем самым говорит «пробуем ещё» —
    // и эта строка закрывает сироту. Автоматически такое сняться не может по построению.
    appendBootJournal({ verdict: 'owner-cleared', remembered: profile.name, detail: 'владелец применил режим своей рукой — блокировка прерывателя петли снята' });
    if (isDraft) {
      console.log('ЧЕРНОВИК ЗАПОМНЕН. Числа НЕ подделаны: qualified остаётся false — приёмки не было.');
      console.log('При входе в систему он будет восстановлен; если машина умрёт с ним на карте,');
      console.log('прерыватель петли остановит восстановление и оставит заводское.');
    }
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
