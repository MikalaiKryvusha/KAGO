#!/usr/bin/env node
// automation-engine/lib/profile-store.mjs — THE PROFILE FORMAT: what a profile is, and what makes
// one refusable. Phase 2 step 4.1 (plans/03_epic01_phase2_silent_cold.md §4.1).
//
// WHY THIS IS NOT INSIDE profile-manager.mjs. R1 of PROJECT_ARCHITECTURE_INTERNAL_MAP.md makes
// profile-manager the ONLY module that writes to the GPU, and that rule is only worth what it costs
// to audit: the smaller and the less-imported the writer stays, the cheaper the audit. Everything
// here is pure — it reads JSON files and compares numbers — so it needs no card, touches no state,
// and is provable on hostile fixtures alone. The manager imports this module; nothing here imports
// the manager.
//
// THE ONE CONVENTION THE WHOLE FORMAT RESTS ON: **null means the card's own factory value.**
//   powerLimitWatts: null      -> restore `power.default_limit`, whatever the card says it is today
//   graphicsClockLockMhz: null -> release the lock (`nvidia-smi -rgc`)
// So the factory profile is a profile file exactly like the other two, with both settings null, and
// the reset path is NOT a special branch in the applier — internal map §4: «Сброс — это профиль, как
// два других, а не особый случай в коде». One convention buys that for free.
//
// WHAT IS DERIVED RATHER THAN FLAGGED. A profile carries a driver/VBIOS stamp **iff it sets
// something** (R6). The factory profile sets nothing measured — it restores values read off the card
// at apply time — so it needs no stamp, and, critically, MUST NOT need one: a reset that refuses to
// run after a driver update would be the worst possible failure of the one path that always has to
// work. That exemption follows from the data (all settings null) instead of from a `factory: true`
// flag somebody has to keep in sync.
//
// [TESTED: 2026-08-14 · `--selftest` → 25 blocks (17 of 2026-08-10 + 8 for phase-3 mode identity и
//  the qualified gate), no GPU touched; mutation-proved twice — 2026-08-10 the ladder check, the
//  stamp-required derivation and the takenAt offset rule; 2026-08-14 four more (unknown mode ·
//  stock-default-that-sets · qualified type/requirement · qualified-forbidden-on-factory), each
//  reddening exactly its own blocks. `--list` run against the live card the same night: 6 profiles,
//  0 refusals, drafts labeled.]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { powerEnvelope, CLOCK_OFFSET_MIN_MHZ, CLOCK_OFFSET_MAX_MHZ } from '../config.mjs';

// The directory is resolved from THIS file, never from the caller's cwd: a shortcut launched from
// the owner's Desktop (phase 3) runs with a cwd nobody chose.
export const PROFILES_DIR = fileURLToPath(new URL('../../profiles/', import.meta.url));
const GPU_INFO = fileURLToPath(new URL('../../tools/gpu-info.mjs', import.meta.url));

/** The settings a profile may carry. An unknown key is REFUSED, never ignored — `powerLimitWats`
 *  silently ignored is a profile that does nothing while reading as if it does. */
const SETTING_KEYS = Object.freeze(['powerLimitWatts', 'graphicsClockLockMhz', 'curveRaiseAndCapMhz']);
const STAMP_KEYS = Object.freeze(['driver', 'vbios', 'takenAt']);

/**
 * The four modes the owner named (GOAL.md → «Четыре режима»; names ship verbatim in `title`, these
 * ids are the machine identity phase 3's shortcuts and remembered state route by). Phase 3 step 4.2.
 *
 * THE CURVE ENTERED SETTINGS 2026-08-15 (`plans/11` §4.1), and the rule that kept it out until then is
 * the reason it may enter now: `settings` carries ONLY what the applier can actually write, because a
 * key the applier silently ignores is a profile that reads as doing something it does not do. The
 * applier learned the curve in the same change (`plans/11` §4.2) — the two land together or not at all.
 * [TESTED: 2026-08-14 · selftest blocks below — unknown mode refused, stock-default with non-null
 *  settings refused, both mutation-proved]
 */
export const MODE_IDS = Object.freeze(['max-performance', 'optimised', 'silent-cold', 'stock-default']);
const WORKING_MODES = Object.freeze(['max-performance', 'optimised', 'silent-cold']);

/**
 * THE KIND OF STATE A PROFILE DESCRIBES — the distinction `bugs/05` was born from.
 *
 * This project writes TWO kinds of non-factory state to the card, and only one of them is what
 * acceptance is about:
 *
 *   • a MODE — shipped, clicked from the Desktop, remembered as the boot state, and therefore
 *     forbidden to reach the card until phase 6 says it is proven (the qualification gate);
 *   • a MEASUREMENT — a clock pin an instrument holds for seconds so the region under test is the
 *     region actually loaded, released in a `finally`, never shipped, never remembered.
 *
 * The gate was keyed on «is this factory?», which sweeps the second kind in with the first: a pin
 * sets a clock, so it is not factory, so it was asked to be «qualified» — a word that has no meaning
 * for it, since no acceptance will ever be run on a state nobody ships. The result was that the pin
 * could not be applied at all, and with it the whole band sweep (`bugs/05`).
 *
 * **The module already relied on this distinction without naming it** — `profile-manager`'s CLI
 * writes the remembered boot state itself, with the comment *«measurement tools drive the library and
 * must not move the boot state»*. This constant is that sentence, moved into the format where the
 * validator can see it.
 *
 * Absent means MODE/shipped: the default is the strict side, so a profile that forgets to declare
 * itself meets the gate rather than slipping past it.
 */
const PROFILE_KINDS = Object.freeze(['measurement']);

/**
 * A machine receipt is a full LOCAL ISO 8601 moment WITH its offset (AGENT_GUIDE.md → «A stamp
 * carries the date and the time»). `Z` is deliberately refused: EXP-0012 caught a baseline stamped
 * `2026-08-09T21:52Z` while the owner's clock read `2026-08-10 00:52` — a receipt dated the previous
 * day. A profile is the artefact whose date decides whether it is still valid, so the format refuses
 * the shape that already lied once.
 */
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u;

/**
 * A profile name is both a CLI argument and half a path (`profiles/<name>.json`), so it stays
 * lowercase letters, digits and hyphens — and the ONE suffix the project's own `.gitignore` requires:
 * `.local`, which marks a profile that stays on this machine. The suffix is spelled out literally
 * rather than by allowing dots in general, because a general dot would admit `..` and turn a name
 * into a path traversal.
 *
 * Found by running the thing, not by reading it: the first live round trip refused its own probe
 * profile, because the format did not know the convention its own directory README documents.
 */
const NAME_RE = /^[a-z0-9][a-z0-9-]*(\.local)?$/u;

/** A refusal names the FIELD, so the message tells the owner what to fix rather than that something
 *  is wrong. Order of production is fixed, so two runs over one profile print identically. */
function refuse(field, why) {
  return { field, why };
}

/** True when the profile changes nothing measured — every setting is the card's own factory value. */
export function isFactoryProfile(profile) {
  const s = profile?.settings;
  if (!s || typeof s !== 'object') return false;
  return SETTING_KEYS.every((k) => s[k] === null);
}

/**
 * THE QUALIFICATION GATE'S DERIVATION (phase 3, P3-AC3). A profile must carry `qualified: true|false`
 * — and the applier writes only `qualified: true` — when it could put an unproven state on the card:
 * either it SETS something, or it IS one of the three working modes (whose real payload, the curve,
 * is documentation until phase 6 — but whose shortcut exists on the owner's Desktop from phase 3 on,
 * so an all-null draft applying as a quiet no-op reset would be a click that lies).
 *
 * Factory-by-construction — all settings null AND not a working mode — must NOT carry the field at
 * all: same reasoning as the stamp exemption above, a reset that can be marked unqualified is a
 * reset that can stop working, and that is the one path that always has to work.
 *
 * **A MEASUREMENT is exempt for a third reason, and it is not leniency** (`bugs/05`, 2026-08-14):
 * qualification is the record of an ACCEPTANCE, and nothing will ever be accepted about a state that
 * is held for seconds and released in a `finally`. The gate's subject is narrowed here, never
 * widened — an unqualified MODE is refused exactly as before, and the suite carries a block that
 * fails if this edit ever turned into the other thing.
 */
export function requiresQualification(profile) {
  if (profile?.kind === 'measurement') return false;
  return !isFactoryProfile(profile) || WORKING_MODES.includes(profile?.mode);
}

/**
 * The two ladder points bracketing a value, for a refusal that is useful instead of merely correct.
 * Returns `{ below, above }`, either of which may be null at the ends of the ladder.
 */
export function nearestOnLadder(mhz, ladder) {
  let below = null;
  let above = null;
  for (const p of ladder) {
    if (p <= mhz && (below === null || p > below)) below = p;
    if (p >= mhz && (above === null || p < above)) above = p;
  }
  return { below, above };
}

/**
 * The set of graphics clocks `-lgc` may be given, taken from the card's own SUPPORTED_CLOCKS.
 *
 * WHICH RUNG. Observed on this card 2026-08-10: 5 memory rungs; the four FULL rungs (810 / 7001 /
 * 13801 / 14001 MHz) each publish the identical 389 points 180…3090 MHz, and the low 405 MHz rung's
 * 95 points (180…885) are a strict SUBSET of them. So the full-rung ladder IS the complete set and no
 * union or intersection choice arises. Where a card ever disagrees between its full rungs, this
 * refuses to produce a ladder at all rather than silently blending two search spaces into one that
 * the card never offered.
 */
export function ladderFromSupportedClocks(supported) {
  if (!supported || !supported.available) {
    return { ok: false, why: supported?.why ?? 'лестница частот не прочитана' };
  }
  if (!supported.ladder_identical_on_full_rungs) {
    return {
      ok: false,
      why: 'лестница различается между полными ступенями памяти — пространство надо выводить под каждую ступень, молчаливое объединение запрещено',
    };
  }
  const rung = supported.full_rungs_memory_mhz?.[0];
  const mhz = supported.graphics_by_memory_mhz?.[rung];
  if (!Array.isArray(mhz) || mhz.length === 0) {
    return { ok: false, why: `у полной ступени памяти ${rung} МГц пустой список частот` };
  }
  return { ok: true, mhz, rung };
}

/**
 * Read the card once: identity for the stamp check, the power envelope, and the clock ladder.
 *
 * It SPAWNS `tools/gpu-info.mjs --json` instead of re-parsing `nvidia-smi -q -d SUPPORTED_CLOCKS`
 * here. That parser is a tested thing with an awkward format behind it, and a second copy of it
 * would be a truth↔mirror pair nobody asked for — EXP-0013: a pair you can DELETE beats a pair you
 * must WATCH. Read-only, like everything else in this module.
 */
export function probeCard() {
  const r = spawnSync(process.execPath, [GPU_INFO, '--json'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw new Error(`карта не прочитана: gpu-info вышел с кодом ${r.status ?? '—'} ${r.stderr ?? ''}`.trim());
  }
  const j = JSON.parse(r.stdout);
  // powerEnvelope refuses an implausible probe rather than returning a negative range — reused here
  // so a garbled read stops the run instead of becoming a validation rule.
  const env = powerEnvelope({ min: j['power.min_limit'], max: j['power.max_limit'] });
  return {
    driver: j.driver_version,
    vbios: j.vbios_version,
    power: {
      current: Number(j['power.limit']),
      default: Number(j['power.default_limit']),
      min: env.min,
      max: env.max,
    },
    ladder: ladderFromSupportedClocks(j.supported_clocks),
  };
}

/**
 * Validate a profile. Two tiers, deliberately in one function so a caller cannot run half of it:
 * the SHAPE tier needs nothing, the CARD tier runs only when a probed card is supplied.
 *
 * @param {object} profile
 * @param {{fileName?: string|null, card?: object|null}} opts
 * @returns {Array<{field:string, why:string}>} empty means accepted
 */
export function validateProfile(profile, { fileName = null, card = null } = {}) {
  const out = [];

  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return [refuse('<профиль>', 'ожидался JSON-объект')];
  }

  // --- identity -------------------------------------------------------------------------------
  if (typeof profile.name !== 'string' || !NAME_RE.test(profile.name)) {
    out.push(refuse('name', `ожидалось имя из строчных букв, цифр и дефисов, получено ${JSON.stringify(profile.name)}`));
  } else if (fileName !== null) {
    const stem = path.basename(fileName, '.json');
    if (stem !== profile.name) {
      out.push(refuse('name', `имя внутри файла (${profile.name}) не совпадает с именем файла (${stem}) — профиль не может врать о том, кто он`));
    }
  }
  if (typeof profile.title !== 'string' || profile.title.trim() === '') {
    out.push(refuse('title', 'нужна подпись, которую владелец увидит на ярлыке (фаза 3)'));
  }

  // --- settings -------------------------------------------------------------------------------
  const s = profile.settings;
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    return [...out, refuse('settings', 'обязательный блок настроек отсутствует')];
  }
  for (const k of Object.keys(s)) {
    if (!SETTING_KEYS.includes(k)) {
      out.push(refuse(`settings.${k}`, `неизвестная настройка; известны: ${SETTING_KEYS.join(', ')}`));
    }
  }
  // Both keys are required even when null. An OMITTED key is ambiguous — «оставить как есть» and
  // «вернуть заводское» are different instructions, and a profile must not leave the applier guessing.
  for (const k of SETTING_KEYS) {
    if (!(k in s)) out.push(refuse(`settings.${k}`, 'настройка не указана; null означает «заводское значение карты», пропуск не означает ничего'));
  }

  const pl = s.powerLimitWatts;
  if (pl !== null && pl !== undefined) {
    if (typeof pl !== 'number' || !Number.isFinite(pl) || pl <= 0) {
      out.push(refuse('settings.powerLimitWatts', `ожидалось число ватт или null, получено ${JSON.stringify(pl)}`));
    } else if (card) {
      if (pl < card.power.min || pl > card.power.max) {
        out.push(refuse('settings.powerLimitWatts', `${pl} Вт вне диапазона карты ${card.power.min}…${card.power.max} Вт`));
      }
    }
  }

  const lock = s.graphicsClockLockMhz;
  if (lock !== null && lock !== undefined) {
    if (typeof lock !== 'object' || Array.isArray(lock)) {
      out.push(refuse('settings.graphicsClockLockMhz', `ожидался объект {min,max} или null, получено ${JSON.stringify(lock)}`));
    } else {
      for (const k of Object.keys(lock)) {
        if (k !== 'min' && k !== 'max') out.push(refuse(`settings.graphicsClockLockMhz.${k}`, 'неизвестное поле; известны: min, max'));
      }
      const bad = [];
      for (const k of ['min', 'max']) {
        const v = lock[k];
        if (!Number.isInteger(v) || v <= 0) {
          out.push(refuse(`settings.graphicsClockLockMhz.${k}`, `ожидалось целое число МГц, получено ${JSON.stringify(v)}`));
          bad.push(k);
        }
      }
      if (bad.length === 0 && lock.min > lock.max) {
        out.push(refuse('settings.graphicsClockLockMhz', `min ${lock.min} больше max ${lock.max}`));
      }
      // The ladder check — plan §4.1: «Clock values are taken from the MEASURED ladder, never from a
      // round number a human liked. A value off the ladder is rejected at load time with the nearest
      // two named.»
      if (bad.length === 0 && card) {
        if (!card.ladder.ok) {
          out.push(refuse('settings.graphicsClockLockMhz', `частоту не с чем сверить: ${card.ladder.why}`));
        } else {
          for (const k of ['min', 'max']) {
            const v = lock[k];
            if (!card.ladder.mhz.includes(v)) {
              const { below, above } = nearestOnLadder(v, card.ladder.mhz);
              const near = [below, above].filter((x) => x !== null).join(' и ');
              out.push(refuse(`settings.graphicsClockLockMhz.${k}`,
                `${v} МГц нет на измеренной лестнице карты (${card.ladder.mhz.length} точек ${card.ladder.mhz[0]}…${card.ladder.mhz[card.ladder.mhz.length - 1]} МГц); ближайшие: ${near || '—'}`));
            }
          }
        }
      }
    }
  }

  // --- curveRaiseAndCapMhz (plans/11 §4.1) ------------------------------------------------------
  //
  // THE MAIN LEVER OF ALL THREE WORKING MODES, and the one the applier could not write until now. Its
  // shape is `{ deltaMhz, capMhz }`: raise the WHOLE curve by `deltaMhz`, then push every point above
  // `capMhz` back down onto it (`nvapi.buildRaiseAndCapVector`). Three refusals, and each is a fact
  // this project paid to learn:
  //
  //   · `deltaMhz` outside the hardware's ±1000 MHz offset range — the range is MEASURED, not assumed;
  //   · `capMhz` off the card's measured ladder — the same rule the clock lock already obeys, and the
  //     refusal names the two nearest points, because a round number a human liked is usually absent;
  //   · **`capMhz` below the curve's own floor `top − 1000` (R11, `bugs/02` step 1)** — the ceiling is
  //     held by pushing points DOWN, that push is an offset, and it runs out of range. A profile with a
  //     cap under the floor applies cleanly, reads back correctly, and lets the card reach a clock the
  //     mode forbade: 2100 MHz for `Silent Cold` leaked 57 MHz and nothing in the stack said so. This
  //     refusal is that silence closed.
  const curve = s.curveRaiseAndCapMhz;
  if (curve !== null && curve !== undefined) {
    if (typeof curve !== 'object' || Array.isArray(curve)) {
      out.push(refuse('settings.curveRaiseAndCapMhz', `ожидался объект {deltaMhz, capMhz} или null, получено ${JSON.stringify(curve)}`));
    } else {
      const bad = [];
      for (const k of Object.keys(curve)) {
        if (k !== 'deltaMhz' && k !== 'capMhz') {
          out.push(refuse(`settings.curveRaiseAndCapMhz.${k}`, 'неизвестное поле; известны: deltaMhz, capMhz'));
          bad.push(k);
        }
      }
      if (!Number.isInteger(curve.deltaMhz)) {
        out.push(refuse('settings.curveRaiseAndCapMhz.deltaMhz', `ожидалось целое число МГц, получено ${JSON.stringify(curve.deltaMhz)}`));
        bad.push('deltaMhz');
      }
      // `capMhz: null` — ПОТОЛКА НЕТ ВОВСЕ: равномерный подъём всей кривой, весь выигрыш уходит в
      // частоту. Владелец, 2026-08-15: «давай в нашем оптимайзд уберём потолок частоты». Записано
      // явным null, а не верхом лестницы: «потолок на верху кривой — не потолок» (plans/05 §4.1,
      // измерено 2026-08-10), и профиль не должен изображать ограничение, которого не ставит.
      //
      // ⚠️ ЧТО ЭТО СТОИТ, названо здесь, а не в чате: измерения ведутся ПОД потолком — точка,
      // обслуживающая потолок, и есть та, которую грузит нагрузка. Без потолка карта уходит на
      // частоты выше, их обслуживают ДРУГИЕ точки, и эти рабочие точки не проверялись. Такой профиль
      // требует собственного приёмочного прогона; чужие улики на него не переносятся.
      if (curve.capMhz !== null && !Number.isInteger(curve.capMhz)) {
        out.push(refuse('settings.curveRaiseAndCapMhz.capMhz', `ожидалось целое число МГц или null (потолка нет), получено ${JSON.stringify(curve.capMhz)}`));
        bad.push('capMhz');
      }
      if (curve.capMhz === null) bad.push('capMhz');   // нечего сверять с лестницей и полом
      if (!bad.includes('deltaMhz')) {
        const lo = CLOCK_OFFSET_MIN_MHZ ?? -1000;
        const hi = CLOCK_OFFSET_MAX_MHZ ?? 1000;
        if (curve.deltaMhz < lo || curve.deltaMhz > hi) {
          out.push(refuse('settings.curveRaiseAndCapMhz.deltaMhz',
            `${curve.deltaMhz} МГц вне аппаратного диапазона смещений ${lo}…${hi} МГц`));
        }
      }
      if (!bad.includes('capMhz') && card) {
        if (!card.ladder.ok) {
          out.push(refuse('settings.curveRaiseAndCapMhz.capMhz', `частоту не с чем сверить: ${card.ladder.why}`));
        } else {
          if (!card.ladder.mhz.includes(curve.capMhz)) {
            const { below, above } = nearestOnLadder(curve.capMhz, card.ladder.mhz);
            const near = [below, above].filter((x) => x !== null).join(' и ');
            out.push(refuse('settings.curveRaiseAndCapMhz.capMhz',
              `${curve.capMhz} МГц нет на измеренной лестнице карты (${card.ladder.mhz.length} точек ${card.ladder.mhz[0]}…${card.ladder.mhz[card.ladder.mhz.length - 1]} МГц); ближайшие: ${near || '—'}`));
          }
          // THE FLOOR THE CURVE CAN HOLD (R11). Derived from the card's own top clock, never a literal:
          // another card has another top, and a hard-coded 2157 would be this card's number wearing a
          // constant's clothes.
          const topMhz = card.ladder.mhz[card.ladder.mhz.length - 1];
          const floorMhz = topMhz + (CLOCK_OFFSET_MIN_MHZ ?? -1000);
          if (curve.capMhz < floorMhz) {
            out.push(refuse('settings.curveRaiseAndCapMhz.capMhz',
              `${curve.capMhz} МГц ниже пола, который кривая способна удержать (${floorMhz} МГц = верх ${topMhz} − 1000): `
              + 'потолок держится придавливанием точек вниз, а придавливание упирается в аппаратный диапазон. '
              + 'Такой профиль применится чисто и всё равно пустит карту выше своего потолка (R11, bugs/02)'));
          }
        }
      }
    }
  }

  // --- kind (bugs/05) ---------------------------------------------------------------------------
  //
  // Declared BEFORE the mode and qualification checks, because it is what decides whether they apply.
  // Three refusals, and each one closes a way this exemption could be abused into a hole:
  //   · an unknown kind is not a free pass — a typo must not silently become «shipped»;
  //   · a measurement that also claims a MODE is a contradiction: a mode is the thing that ships;
  //   · a measurement carrying `qualified` is forging an acceptance that никто не проводил, which is
  //     the false-`[TESTED]` class (the `else` branch below already refuses it — this is why the
  //     kind lands in that branch rather than getting a bypass of its own).
  if (profile.kind !== undefined) {
    if (!PROFILE_KINDS.includes(profile.kind)) {
      out.push(refuse('kind', `неизвестный вид ${JSON.stringify(profile.kind)}; известны: ${PROFILE_KINDS.join(', ')}. `
        + 'Отсутствие поля означает ОТГРУЖАЕМЫЙ профиль — умолчание строгое'));
    } else if (profile.mode !== undefined) {
      out.push(refuse('kind', 'приборный профиль не может быть РЕЖИМОМ: режим — это то, что отгружается, '
        + 'кликается ярлыком и запоминается для автозагрузки, а прибор держится секунды и отпускается в finally'));
    }
  }

  // --- mode & qualification (phase 3 §4.2) ------------------------------------------------------
  if (profile.mode !== undefined) {
    if (!MODE_IDS.includes(profile.mode)) {
      out.push(refuse('mode', `неизвестный режим ${JSON.stringify(profile.mode)}; известны: ${MODE_IDS.join(', ')}`));
    } else if (profile.mode === 'stock-default' && !isFactoryProfile(profile)) {
      out.push(refuse('mode', `stock-default обязан ничего не задавать (все ${SETTING_KEYS.length} настройки null) — сброс, который что-то настраивает, это не сброс`));
    }
  }

  if (requiresQualification(profile)) {
    if (typeof profile.qualified !== 'boolean') {
      out.push(refuse('qualified', 'профиль задаёт состояние или является рабочим режимом — обязан нести qualified: true|false; true ставит только приёмка (фаза 6)'));
    }
    if (profile.draft !== undefined) {
      if (profile.qualified === true) {
        out.push(refuse('draft', 'квалифицированный профиль не может быть черновиком — противоречие; блок draft снимается приёмкой вместе с флагом'));
      } else if (typeof profile.draft !== 'object' || profile.draft === null || Array.isArray(profile.draft)) {
        out.push(refuse('draft', 'ожидался объект с кандидатскими числами и их источниками'));
      }
    }
  } else {
    // Factory-by-construction: the field is FORBIDDEN, not optional — a reset that can be marked
    // unqualified is a reset that can stop working (same class as the stamp exemption below).
    // A MEASUREMENT lands in this branch too, and the field is forbidden there for its own reason:
    // `qualified: true` on a state nobody will ever accept is a forged acceptance. The message names
    // WHICH of the two exemptions is speaking — a refusal that explains the wrong case teaches the
    // reader something false (EXP-0012).
    const measurement = profile.kind === 'measurement';
    if (profile.qualified !== undefined) {
      out.push(refuse('qualified', measurement
        ? 'приборный профиль поля не несёт: квалификация — это запись о ПРИЁМКЕ, а состояние, которое держат '
          + 'секунды и отпускают в finally, приёмку не проходит никогда. qualified: true здесь — подделка приёмки'
        : 'заводской профиль квалифицирован ПО ПОСТРОЕНИЮ и поля не несёт — иначе сброс может перестать работать'));
    }
    if (profile.draft !== undefined) {
      out.push(refuse('draft', measurement
        ? 'приборному профилю нечего держать в черновике — он ничего не отгружает'
        : 'заводскому профилю нечего держать в черновике'));
    }
  }

  // --- stamp ----------------------------------------------------------------------------------
  // Required IFF the profile sets something (R6). Derived from the settings, not from a flag.
  const factory = isFactoryProfile(profile);
  const stamp = profile.stamp;
  if (factory) {
    if (stamp !== undefined && stamp !== null) {
      out.push(refuse('stamp', 'заводской профиль ничего не измеряет и штампа не несёт — иначе сброс перестанет работать после обновления драйвера'));
    }
  } else if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) {
    out.push(refuse('stamp', 'профиль что-то задаёт, значит обязан нести драйвер и VBIOS, на которых доказан (R6)'));
  } else {
    for (const k of Object.keys(stamp)) {
      if (!STAMP_KEYS.includes(k)) out.push(refuse(`stamp.${k}`, `неизвестное поле штампа; известны: ${STAMP_KEYS.join(', ')}`));
    }
    for (const k of STAMP_KEYS) {
      if (!(k in stamp)) out.push(refuse(`stamp.${k}`, 'обязательное поле штампа отсутствует'));
    }
    for (const k of ['driver', 'vbios']) {
      if (k in stamp && (typeof stamp[k] !== 'string' || stamp[k].trim() === '')) {
        out.push(refuse(`stamp.${k}`, `ожидалась непустая строка, получено ${JSON.stringify(stamp[k])}`));
      }
    }
    if ('takenAt' in stamp && !LOCAL_ISO.test(String(stamp.takenAt))) {
      out.push(refuse('stamp.takenAt', `ожидался локальный ISO 8601 со смещением (2026-08-10T09:41:00+03:00), получено ${JSON.stringify(stamp.takenAt)}; «Z» отвергается намеренно — EXP-0012`));
    }
    if (card) out.push(...checkStamp(profile, card));
  }

  // --- evidence -------------------------------------------------------------------------------
  // Optional at the FORMAT level and visible at the LIST level. A profile without evidence is not
  // malformed, it is unproven — and §4.6 is where a profile earns its evidence. Refusing it here
  // would block the round-trip test of §4.2, which must run before any profile has been proven.
  if (profile.evidence !== undefined && (typeof profile.evidence !== 'object' || profile.evidence === null || Array.isArray(profile.evidence))) {
    out.push(refuse('evidence', 'ожидался объект с доказательствами приёмки или отсутствие поля'));
  }

  return out;
}

/**
 * R6 as a pure function: does this profile's stamp still describe the card in front of us?
 * The applier calls it BEFORE any write and refuses naming the field that differs (P2-AC5).
 */
export function checkStamp(profile, card) {
  if (isFactoryProfile(profile)) return [];
  const stamp = profile?.stamp;
  if (!stamp || typeof stamp !== 'object') return [refuse('stamp', 'штампа нет — сверять нечего')];
  const out = [];
  const pairs = [['driver', card.driver], ['vbios', card.vbios]];
  for (const [k, live] of pairs) {
    if (stamp[k] !== undefined && String(stamp[k]) !== String(live)) {
      out.push(refuse(`stamp.${k}`, `профиль доказан на ${stamp[k]}, карта сейчас ${live} — профиль недействителен до перепроверки (R6)`));
    }
  }
  return out;
}

/** Every profile file in the directory, sorted — the output is diffed, so the order is canonical. */
export function listProfileFiles(dir = PROFILES_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Load one profile file. A parse failure is a refusal like any other, so one broken file names
 * itself instead of taking the whole listing down with a stack trace.
 */
export function loadProfileFile(file, card = null) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (e) {
    return { file, profile: null, refusals: [refuse('<файл>', `не читается: ${e.message}`)] };
  }
  let profile;
  try {
    profile = JSON.parse(raw);
  } catch (e) {
    return { file, profile: null, refusals: [refuse('<файл>', `не разбирается как JSON: ${e.message}`)] };
  }
  return { file, profile, refusals: validateProfile(profile, { fileName: file, card }) };
}

// ===============================================================================================
// CLI
// ===============================================================================================

/** Human rendering of one setting, in the owner's language, with the null convention spelled out. */
function renderSettings(s) {
  const lines = [];
  lines.push(`    потолок мощности   ${s.powerLimitWatts === null ? 'заводской (power.default_limit)' : `${s.powerLimitWatts} Вт`}`);
  const l = s.graphicsClockLockMhz;
  lines.push(`    фиксация частоты   ${l === null ? 'снята (-rgc)' : `${l.min}…${l.max} МГц`}`);
  // The curve is the MAIN lever of every working mode, so it is printed like the others rather than
  // hidden in `draft`: a listing that shows the power limit and stays silent about a 592 MHz curve
  // raise describes a different profile than the one on disk.
  const c = s.curveRaiseAndCapMhz;
  lines.push(`    кривая V/F         ${c === null || c === undefined
    ? 'заводская (все смещения 0)'
    : `подъём +${c.deltaMhz} МГц, ${c.capMhz === null ? 'ПОТОЛКА НЕТ — выигрыш уходит в частоту' : `потолок ${c.capMhz} МГц`}`}`);
  return lines.join('\n');
}

function cmdList(card) {
  const files = listProfileFiles();
  if (files.length === 0) {
    console.log(`ПРОФИЛИ: каталог ${PROFILES_DIR} пуст.`);
    return 0;
  }
  let refused = 0;
  console.log(`ПРОФИЛИ · каталог ${PROFILES_DIR}`);
  console.log(`КАРТА    драйвер ${card.driver} · VBIOS ${card.vbios} · мощность ${card.power.min}…${card.power.max} Вт (заводская ${card.power.default} Вт)`);
  console.log(card.ladder.ok
    ? `ЛЕСТНИЦА ${card.ladder.mhz.length} точек ${card.ladder.mhz[0]}…${card.ladder.mhz[card.ladder.mhz.length - 1]} МГц (ступень памяти ${card.ladder.rung} МГц)`
    : `ЛЕСТНИЦА недоступна: ${card.ladder.why}`);
  console.log('');
  for (const f of files) {
    const { profile, refusals } = loadProfileFile(f, card);
    const base = path.basename(f);
    if (refusals.length === 0) {
      const proven = isFactoryProfile(profile)
        ? 'заводской — штамп не нужен'
        : `доказан на драйвере ${profile.stamp.driver}, VBIOS ${profile.stamp.vbios}, снят ${profile.stamp.takenAt}`;
      const evidence = isFactoryProfile(profile)
        ? ''
        : (profile.evidence ? '' : '\n    ⚠ БЕЗ ДОКАЗАТЕЛЬСТВ — профиль задаёт настройки, но не несёт результатов приёмки');
      const mode = profile.mode ? `\n    режим              ${profile.mode}` : '';
      const qual = !requiresQualification(profile)
        ? '\n    квалификация       заводской — квалифицирован по построению'
        : profile.qualified === true
          ? '\n    квалификация       ✅ квалифицирован — применение разрешено'
          : '\n    квалификация       📝 ЧЕРНОВИК (qualified: false) — применение ОТКАЖЕТ до фазы 6';
      console.log(`OK   ${base}  «${profile.title}»`);
      console.log(renderSettings(profile.settings));
      console.log(`    ${proven}${mode}${qual}${evidence}`);
    } else {
      refused++;
      console.log(`ОТКАЗ ${base} — ${refusals.length} причин(ы):`);
      for (const r of refusals) console.log(`    ${r.field}: ${r.why}`);
    }
    console.log('');
  }
  console.log(`ИТОГ: профилей ${files.length}, отказов ${refused}.`);
  return refused === 0 ? 0 : 1;
}

// -----------------------------------------------------------------------------------------------
// The selftest — hostile fixtures, no GPU touched.
//
// A brand-new guard has no previous version to redden against (EXP-0008's own «Not for»), so it is
// proven the other way the lesson names: on deliberately broken inputs. Every block below IS the
// mutation — each fixture carries exactly one defect and names the field the validator must point at.
// The injected card is the real one measured on 2026-08-10, so the ladder numbers are the card's own.
// -----------------------------------------------------------------------------------------------

const FAKE_CARD = Object.freeze({
  driver: '610.88',
  vbios: '98.03.58.40.8b',
  power: { current: 300, default: 300, min: 250, max: 300 },
  // A short stand-in ladder with the real card's spacing: 1200 is on it, 1000 is not.
  ladder: { ok: true, rung: 810, mhz: [180, 1192, 1200, 1207, 2130, 3090] },
});

const factoryFixture = () => ({
  name: 'factory',
  title: '🔄 Сброс к заводским',
  settings: { powerLimitWatts: null, graphicsClockLockMhz: null, curveRaiseAndCapMhz: null },
});

const measuredFixture = () => ({
  name: 'silent-cold',
  title: '❄️ Silent Cold',
  qualified: true,
  settings: { powerLimitWatts: 250, graphicsClockLockMhz: { min: 1200, max: 1200 }, curveRaiseAndCapMhz: null },
  stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: '2026-08-10T10:00:00+03:00' },
});

function cmdSelftest() {
  const blocks = [
    {
      what: 'заводской профиль (обе настройки null) -> принят, штамп не требуется',
      profile: factoryFixture(), expect: [],
    },
    {
      what: 'измеренный профиль со штампом и частотой с лестницы -> принят',
      profile: measuredFixture(), expect: [],
    },
    // --- КРИВАЯ В ПРОФИЛЕ (`plans/11` §4.1, P6-AC1). Пять враждебных фикстур, каждая несёт РОВНО
    // один дефект и называет поле, на которое обязан показать валидатор.
    {
      what: 'КРИВАЯ: измеренный подъём с потолком на лестнице -> принят',
      profile: (() => { const p = measuredFixture(); p.settings.curveRaiseAndCapMhz = { deltaMhz: 592, capMhz: 2130 }; return p; })(),
      expect: [],
    },
    {
      what: 'КРИВАЯ: потолка НЕТ (capMhz null) -> принят, равномерный подъём',
      profile: (() => { const p = measuredFixture(); p.settings.curveRaiseAndCapMhz = { deltaMhz: 592, capMhz: null }; return p; })(),
      expect: [],
    },
    {
      what: 'КРИВАЯ: потолок НИЖЕ пола кривой (верх 3090 − 1000 = 2090) -> отказ на capMhz',
      profile: (() => { const p = measuredFixture(); p.settings.curveRaiseAndCapMhz = { deltaMhz: 100, capMhz: 1200 }; return p; })(),
      expect: ['settings.curveRaiseAndCapMhz.capMhz'],
      alsoMustSay: ['2090'],
    },
    {
      what: 'КРИВАЯ: потолок не с измеренной лестницы -> отказ с ближайшими двумя',
      profile: (() => { const p = measuredFixture(); p.settings.curveRaiseAndCapMhz = { deltaMhz: 100, capMhz: 2500 }; return p; })(),
      expect: ['settings.curveRaiseAndCapMhz.capMhz'],
      alsoMustSay: ['2130', '3090'],
    },
    {
      what: 'КРИВАЯ: подъём за аппаратным диапазоном ±1000 -> отказ на deltaMhz',
      profile: (() => { const p = measuredFixture(); p.settings.curveRaiseAndCapMhz = { deltaMhz: 1500, capMhz: 2130 }; return p; })(),
      expect: ['settings.curveRaiseAndCapMhz.deltaMhz'],
    },
    {
      what: 'КРИВАЯ: лишнее поле внутри -> отказ именно на нём',
      profile: (() => { const p = measuredFixture(); p.settings.curveRaiseAndCapMhz = { deltaMhz: 100, capMhz: 2130, pointIndex: 95 }; return p; })(),
      expect: ['settings.curveRaiseAndCapMhz.pointIndex'],
    },
    {
      what: 'КРИВАЯ: сброс к заводским, который задаёт кривую -> отказ (сброс, который настраивает, не сброс)',
      profile: (() => {
        const p = factoryFixture();
        p.mode = 'stock-default';
        p.settings.curveRaiseAndCapMhz = { deltaMhz: 100, capMhz: 2130 };
        return p;
      })(),
      expect: ['mode'],
    },
    {
      what: 'круглая частота 1000 МГц не с лестницы -> отказ с ближайшими двумя',
      profile: (() => { const p = measuredFixture(); p.settings.graphicsClockLockMhz = { min: 1000, max: 1000 }; return p; })(),
      expect: ['settings.graphicsClockLockMhz.min', 'settings.graphicsClockLockMhz.max'],
      alsoMustSay: ['180', '1192'],
    },
    {
      what: 'в штампе нет VBIOS -> отказ именно на stamp.vbios',
      profile: (() => { const p = measuredFixture(); delete p.stamp.vbios; return p; })(),
      expect: ['stamp.vbios'],
    },
    {
      what: 'измеренный профиль вовсе без штампа -> отказ',
      profile: (() => { const p = measuredFixture(); delete p.stamp; return p; })(),
      expect: ['stamp'],
    },
    {
      what: 'штамп во времени UTC («Z») -> отказ (EXP-0012: расписка вчерашним днём)',
      profile: (() => { const p = measuredFixture(); p.stamp.takenAt = '2026-08-10T07:00:00Z'; return p; })(),
      expect: ['stamp.takenAt'],
    },
    {
      what: 'опечатка в имени настройки -> отказ, а не молчаливое игнорирование',
      profile: (() => { const p = measuredFixture(); p.settings.powerLimitWats = 250; return p; })(),
      expect: ['settings.powerLimitWats'],
    },
    {
      what: 'настройка пропущена (не null, а отсутствует) -> отказ',
      profile: (() => { const p = factoryFixture(); delete p.settings.graphicsClockLockMhz; return p; })(),
      expect: ['settings.graphicsClockLockMhz'],
    },
    {
      what: 'имя внутри файла не совпадает с именем файла -> отказ',
      profile: measuredFixture(), fileName: 'max-optimal.json',
      expect: ['name'],
    },
    {
      what: 'мощность 200 Вт ниже пола карты 250 Вт -> отказ с диапазоном',
      profile: (() => { const p = measuredFixture(); p.settings.powerLimitWatts = 200; return p; })(),
      expect: ['settings.powerLimitWatts'],
      alsoMustSay: ['250', '300'],
    },
    {
      what: 'штамп с чужого драйвера -> отказ R6 с обеими версиями',
      profile: (() => { const p = measuredFixture(); p.stamp.driver = '595.71'; return p; })(),
      expect: ['stamp.driver'],
      alsoMustSay: ['595.71', '610.88'],
    },
    {
      what: 'min больше max -> отказ',
      profile: (() => { const p = measuredFixture(); p.settings.graphicsClockLockMhz = { min: 2130, max: 1200 }; return p; })(),
      expect: ['settings.graphicsClockLockMhz'],
    },
    {
      what: 'заводской профиль со штампом -> отказ (сброс не должен зависеть от версии драйвера)',
      profile: (() => { const p = factoryFixture(); p.stamp = { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: '2026-08-10T10:00:00+03:00' }; return p; })(),
      expect: ['stamp'],
    },
    {
      what: 'нет подписи для ярлыка -> отказ',
      profile: (() => { const p = factoryFixture(); delete p.title; return p; })(),
      expect: ['title'],
    },
    {
      what: 'машинный профиль с суффиксом .local -> принят (соглашение .gitignore этого проекта)',
      profile: (() => { const p = measuredFixture(); p.name = 'roundtrip-probe.local'; return p; })(),
      fileName: 'roundtrip-probe.local.json',
      expect: [],
    },
    {
      what: 'имя с попыткой выйти из каталога -> отказ (имя это половина пути)',
      profile: (() => { const p = measuredFixture(); p.name = '../evil'; return p; })(),
      fileName: '../evil.json',
      expect: ['name'],
    },
    {
      what: 'точка НЕ в суффиксе .local -> отказ, форточка открыта ровно на одно слово',
      profile: (() => { const p = measuredFixture(); p.name = 'silent.cold'; return p; })(),
      fileName: 'silent.cold.json',
      expect: ['name'],
    },
    // ---- phase 3 §4.2: mode identity + the qualification gate's format half -------------------
    {
      what: 'неизвестный режим -> отказ с перечислением четырёх известных',
      profile: (() => { const p = measuredFixture(); p.mode = 'turbo'; return p; })(),
      expect: ['mode'],
      alsoMustSay: ['max-performance', 'stock-default'],
    },
    {
      what: 'stock-default, который что-то задаёт -> отказ (сброс, который настраивает, это не сброс)',
      profile: (() => { const p = measuredFixture(); p.mode = 'stock-default'; return p; })(),
      expect: ['mode'],
    },
    {
      what: 'профиль задаёт состояние, а qualified не несёт -> отказ',
      profile: (() => { const p = measuredFixture(); delete p.qualified; return p; })(),
      expect: ['qualified'],
    },
    // --- ВИД ПРОФИЛЯ (bugs/05). Гейт квалификации СУЖАЕТ свой предмет, а не ослабевает: первый блок
    // ниже — это то, ради чего вид заведён, а второй — доказательство, что режим по-прежнему ловится.
    {
      what: 'ПРИБОРНЫЙ профиль (закрепление частоты) без qualified -> ПРИНЯТ: приёмка не про него',
      profile: (() => {
        const p = measuredFixture(); delete p.qualified; delete p.mode;
        p.kind = 'measurement'; p.name = 'candidate-2400'; p.title = 'Кандидат 2400 МГц';
        return p;
      })(),
      expect: [],
    },
    {
      what: 'а РАБОЧИЙ РЕЖИМ без qualified по-прежнему ОТКАЗ — гейт сузился, а не ослаб',
      profile: (() => {
        const p = measuredFixture(); delete p.qualified;
        p.name = 'optimised'; p.title = '⚖️ Optimised'; p.mode = 'optimised';
        return p;
      })(),
      expect: ['qualified'],
    },
    {
      what: 'приборный профиль с qualified: true -> отказ (подделка приёмки, которой не было)',
      profile: (() => {
        const p = measuredFixture(); delete p.mode;
        p.kind = 'measurement'; p.qualified = true; p.name = 'candidate-2400'; p.title = 'Кандидат 2400 МГц';
        return p;
      })(),
      expect: ['qualified'],
    },
    {
      what: 'приборный профиль, объявленный ещё и РЕЖИМОМ -> отказ (режим отгружается, прибор нет)',
      profile: (() => {
        const p = measuredFixture(); delete p.qualified;
        p.kind = 'measurement'; p.mode = 'optimised'; p.name = 'optimised'; p.title = '⚖️ Optimised';
        return p;
      })(),
      expect: ['kind'],
    },
    {
      what: 'неизвестный вид (опечатка) -> отказ, а не тихий пропуск в отгружаемые',
      profile: (() => {
        const p = measuredFixture(); delete p.qualified; delete p.mode;
        p.kind = 'mesurement'; p.name = 'candidate-2400'; p.title = 'Кандидат 2400 МГц';
        return p;
      })(),
      expect: ['kind', 'qualified'],
    },
    {
      what: 'рабочий режим с обеими настройками null (черновик кривой) -> qualified всё равно обязателен',
      profile: (() => {
        const p = factoryFixture();
        p.name = 'max-performance'; p.title = '🚀 Max Perfomance'; p.mode = 'max-performance';
        return p;
      })(),
      expect: ['qualified'],
    },
    {
      what: 'черновик режима: qualified: false + блок draft -> формат ПРИНИМАЕТ (откажет применяющий, не формат)',
      profile: (() => {
        const p = factoryFixture();
        p.name = 'max-performance'; p.title = '🚀 Max Perfomance'; p.mode = 'max-performance';
        p.qualified = false; p.draft = { candidate: '+180 МГц, потолок 3172', source: 'STATUS факт 27' };
        return p;
      })(),
      expect: [],
    },
    {
      what: 'qualified: true при живом блоке draft -> отказ (противоречие)',
      profile: (() => { const p = measuredFixture(); p.draft = { candidate: 'x' }; return p; })(),
      expect: ['draft'],
    },
    {
      what: 'qualified на заводском профиле -> отказ (сброс не должен уметь перестать работать)',
      profile: (() => { const p = factoryFixture(); p.qualified = true; return p; })(),
      expect: ['qualified'],
    },
    {
      what: 'qualified строкой "true" -> отказ (булево, а не строка)',
      profile: (() => { const p = measuredFixture(); p.qualified = 'true'; return p; })(),
      expect: ['qualified'],
    },
  ];

  let failed = 0;
  for (const b of blocks) {
    const refusals = validateProfile(b.profile, { card: FAKE_CARD, fileName: b.fileName ?? `${b.profile?.name ?? 'x'}.json` });
    const fields = refusals.map((r) => r.field);
    const text = refusals.map((r) => `${r.field}: ${r.why}`).join(' | ');

    const missing = b.expect.filter((f) => !fields.includes(f));
    const unexpected = b.expect.length === 0 && fields.length > 0;
    const wordsMissing = (b.alsoMustSay ?? []).filter((w) => !text.includes(w));

    if (missing.length === 0 && !unexpected && wordsMissing.length === 0) {
      console.log(`OK   ${b.what}`);
    } else {
      failed++;
      console.log(`ПРОВАЛ ${b.what}`);
      if (missing.length) console.log(`       не назвал поля: ${missing.join(', ')}`);
      if (unexpected) console.log(`       ожидалось принятие, получены отказы: ${text}`);
      if (wordsMissing.length) console.log(`       в тексте отказа не хватает: ${wordsMissing.join(', ')}`);
      if (text) console.log(`       фактически: ${text}`);
    }
  }
  console.log('');
  console.log(`САМОПРОВЕРКА ФОРМАТА: ${blocks.length} блоков, провалов ${failed}.`);
  return failed === 0 ? 0 : 1;
}

// Run only when invoked directly — importing this module must never probe or print.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let code = 0;
  if (argv.includes('--selftest')) {
    code = cmdSelftest();
  } else {
    // --list is the default: the plan's verification for §4.1 is «load every profile and print it».
    code = cmdList(probeCard());
  }
  process.exit(code);
}
