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
// [TESTED: 2026-08-10 · `node automation-engine/lib/profile-store.mjs --selftest` → 14 blocks, all
//  agreeing, on an injected card (no GPU touched); mutation-proved by breaking each of the three
//  load-bearing guards in turn — the ladder check, the stamp-required derivation and the takenAt
//  offset rule each turned its blocks red. `--list` loads profiles/factory.json against the live
//  card and prints it.]

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { powerEnvelope } from '../config.mjs';

// The directory is resolved from THIS file, never from the caller's cwd: a shortcut launched from
// the owner's Desktop (phase 3) runs with a cwd nobody chose.
export const PROFILES_DIR = fileURLToPath(new URL('../../profiles/', import.meta.url));
const GPU_INFO = fileURLToPath(new URL('../../tools/gpu-info.mjs', import.meta.url));

/** The settings a profile may carry. An unknown key is REFUSED, never ignored — `powerLimitWats`
 *  silently ignored is a profile that does nothing while reading as if it does. */
const SETTING_KEYS = Object.freeze(['powerLimitWatts', 'graphicsClockLockMhz']);
const STAMP_KEYS = Object.freeze(['driver', 'vbios', 'takenAt']);

/**
 * A machine receipt is a full LOCAL ISO 8601 moment WITH its offset (AGENT_GUIDE.md → «A stamp
 * carries the date and the time»). `Z` is deliberately refused: EXP-0012 caught a baseline stamped
 * `2026-08-09T21:52Z` while the owner's clock read `2026-08-10 00:52` — a receipt dated the previous
 * day. A profile is the artefact whose date decides whether it is still valid, so the format refuses
 * the shape that already lied once.
 */
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u;

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/u;

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
      console.log(`OK   ${base}  «${profile.title}»`);
      console.log(renderSettings(profile.settings));
      console.log(`    ${proven}${evidence}`);
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
  title: '⏹ Сброс к заводским',
  settings: { powerLimitWatts: null, graphicsClockLockMhz: null },
});

const measuredFixture = () => ({
  name: 'silent-cold',
  title: '❄️ Silent Cold',
  settings: { powerLimitWatts: 250, graphicsClockLockMhz: { min: 1200, max: 1200 } },
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
