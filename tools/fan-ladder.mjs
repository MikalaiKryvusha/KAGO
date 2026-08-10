#!/usr/bin/env node
// fan-ladder.mjs — THE ACOUSTIC LADDER: the owner listens, the card is the instrument.
//
// Asked for by the owner, 2026-08-10 21:xx: *«я дома и готов послушать шум куллеров видеокарты.
// Можешь написать тест, который ставит их по 10 секунд на 30/40/50/60/70/80/90/100 %»*. It closes the
// question interview 003 deferred in his own words — *«Акустический тест оставляем на вечер, пока верим
// ваттам»* — and it is the only measurement in this project whose INSTRUMENT IS A HUMAN EAR
// (`TESTING_FRAMEWORK.md` → the taste class: the agent prepares the observation, the owner observes).
//
// ─── WHY EACH LEVEL IS HELD LONGER THAN THE TEN SECONDS HE ASKED FOR ──────────────────────────────
//
// A fan RAMPS: measured on this card, ~8 s from a commanded change to the rpm actually reaching the
// target (EXP-0028 — the lesson that a read-back needs the TARGET, not merely two agreeing samples).
// Ten seconds of holding would therefore be mostly the RAMP, and he would be judging a transition
// instead of a level. So each rung is: command → wait until the rpm ARRIVES → *then* start his ten
// seconds. The listening window is exactly what he asked for; the ramp is paid for separately.
//
// ─── SAFETY, AND WHY THIS ONE IS GENTLE ───────────────────────────────────────────────────────────
//
//  · **The ladder only ever goes UP**, which is the direction `nvapi.writeFanControl` is allowed to
//    take: a fan stuck high costs noise, a fan stuck low costs the card.
//  · **30 % is the floor the CARD names** (`currentMinLevel`), not a number we chose — below it a
//    manual command has nothing to command.
//  · **Rollback is AUTO in a `finally`, and it is re-read**, not assumed (`resetFansToAuto`).
//  · **A watchdog is armed before the first write** (rule R9): if this process dies mid-ladder, the
//    detached guard returns the fans to AUTO on its own — which matters more here than anywhere else,
//    because a pinned fan on an idle desktop is something the owner would hear all night.
//  · No clock, no voltage, no power limit is touched. Fans only.
//
// Usage:
//   node tools/fan-ladder.mjs                       30…100 % by 10, ten seconds of listening each
//   node tools/fan-ladder.mjs --levels 60,70,80     only those rungs, for a second opinion
//   node tools/fan-ladder.mjs --hold 15             a longer listening window
//   node tools/fan-ladder.mjs --dry-run             the schedule, and NOT a single write
//   node tools/fan-ladder.mjs --no-cue              without the leading 100 % marker
//   node tools/fan-ladder.mjs --selftest            the ladder logic, no GPU
//
// [TESTED: 2026-08-10 21:3x · 34 selftest blocks green, TEN mutations each reddening the block named
//  for it BEFORE the run (§3). PLAYED ONCE on the live card and the owner listened — and that run found
//  the defect this file now guards against: arrival was decided on the driver ACK, so two rungs sounded
//  at the WRONG speed (2907 rpm under a label of «30 %»). Arrival is now decided on an rpm plateau, and
//  the mutation that restores the old behaviour reddens its block. NOT RE-TESTED: the corrected ladder
//  has not been played yet, so the owner has still never heard the 30 % floor honestly.]

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/** The card's own manual floor, measured — `currentMinLevel` = 30 % (`npm run nvapi -- --fans`). */
export const FAN_FLOOR_PCT = 30;
/** The ladder the owner asked for, in his own words: 30/40/50/60/70/80/90/100. */
export const DEFAULT_LEVELS = Object.freeze([30, 40, 50, 60, 70, 80, 90, 100]);
/** His listening window per rung. */
export const DEFAULT_HOLD_SECONDS = 10;

/**
 * THE CUE — a leading 100 % rung, asked for by the owner so the 100 → 30 drop marks the start of
 * the test for his ears: *«так я акустически услышу начало теста по переходу 100 в 30»*.
 *
 * It is a separate concept from the ladder on purpose. The ladder is upward-only because a fan left
 * LOW is the failure that costs the card, not the ears — so the descent lives here, with its own
 * guard, and `buildLadder` stays exactly as strict as it was.
 */
export const DEFAULT_CUE_LEVEL = 100;

/**
 * The cue DESCENDS to the floor, so it is refused on a warm card — that is the precise situation the
 * upward-only rule exists for. 60 °C is chosen well above this card's idle (45 °C observed tonight)
 * and well below the 75–77 °C it reaches under load, so the guard never fires on an idle desktop and
 * always fires on a card that has just been working.
 */
export const CUE_MAX_TEMP_C = 60;
/** How long we allow a fan to reach its commanded level before calling the rung unproven (EXP-0028:
 *  measured ~8 s to target on this card, so 30 s is a generous ceiling rather than an expectation). */
const RAMP_TIMEOUT_MS = 30_000;
const RAMP_POLL_MS = 500;
/** A commanded level counts as REACHED within this many points — a fan settles near, not exactly. */
const RAMP_TOLERANCE_PCT = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The card's temperature right now — read-only, and the cue's guard depends on it. */
export function cardTemperatureC() {
  try {
    const { execFileSync } = createRequire(import.meta.url)('node:child_process');
    const out = execFileSync('nvidia-smi', ['--query-gpu=temperature.gpu', '--format=csv,noheader'],
      { encoding: 'utf8' });
    const n = Number(String(out).trim());
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

// =================================================================================================
// 1. The ladder — validated before anything is written
// =================================================================================================

/**
 * Build and check the ladder.
 *
 * THE INVARIANT THAT MATTERS IS "ONLY UPWARD", and it is checked here rather than trusted: a ladder
 * that descends would ask `writeFanControl` for the one direction this project refuses to take
 * casually. A descending or duplicated list is a REFUSAL with the reason named, never a silently
 * sorted one — quietly fixing a caller's mistake hides it.
 *
 * [NOT-TESTED]
 */
export function buildLadder(levels = DEFAULT_LEVELS, { floorPct = FAN_FLOOR_PCT } = {}) {
  const problems = [];
  const nums = levels.map(Number);
  if (!nums.length) problems.push('лестница пуста');
  if (nums.some((n) => !Number.isFinite(n))) problems.push('в лестнице есть нечисловая ступень');
  if (nums.some((n) => n < floorPct)) {
    problems.push(`ступень ниже пола карты ${floorPct} % — там ручной команде нечем командовать`);
  }
  if (nums.some((n) => n > 100)) problems.push('ступень выше 100 %');
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] <= nums[i - 1]) {
      problems.push(`лестница обязана идти ТОЛЬКО ВВЕРХ: ${nums[i - 1]} → ${nums[i]}`);
      break;
    }
  }
  return { levels: nums, ok: problems.length === 0, problems };
}

/** The schedule a human can read BEFORE the noise starts: what will play, and roughly when. The ramp
 *  is an estimate and says so — the run reports what actually happened. [NOT-TESTED] */
export function schedule(levels, { holdSeconds = DEFAULT_HOLD_SECONDS, rampEstimateS = 8, cueLevel = null, periodSeconds = null } = {}) {
  let t = 0;
  const all = cueLevel === null ? levels : [cueLevel, ...levels];
  // In PERIOD mode every rung is exactly N seconds from its command, so the boundaries are round and
  // a human with a stopwatch can follow them. The ramp is inside the rung rather than before it.
  if (periodSeconds !== null) {
    return all.map((level, i) => ({
      level,
      listenFromS: i * periodSeconds,
      listenToS: (i + 1) * periodSeconds,
      rampInsideS: rampEstimateS,
    }));
  }
  return all.map((level) => {
    const startsAt = t + rampEstimateS;
    t = startsAt + holdSeconds;
    return { level, listenFromS: startsAt, listenToS: t };
  });
}

/**
 * May the cue play right now? A pure decision, so the rule is testable without a card.
 *
 * Refusing is not a failure of the run — the cue is a convenience for the ear and the ladder plays
 * without it. Saying WHY it was refused is what keeps the refusal honest.
 *
 * [NOT-TESTED]
 */
export function cueAllowed(temperatureC, { maxC = CUE_MAX_TEMP_C } = {}) {
  if (!Number.isFinite(temperatureC)) {
    return { ok: false, why: 'температура не прочиталась — спуск на пол вслепую не делаем' };
  }
  if (temperatureC > maxC) {
    return { ok: false, why: `карта ${temperatureC} °C, а спуск на пол разрешён только холодной (≤ ${maxC} °C)` };
  }
  return { ok: true, why: `карта ${temperatureC} °C — холодная, отсечка разрешена` };
}

/** mm:ss — so the owner can follow the ladder by a clock instead of by the screen. */
export function mmss(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Has the fan ARRIVED at the commanded level?
 *
 * The question is deliberately about the TARGET and not about stability: two agreeing samples taken
 * while a fan is still spinning up agree with each other and with nothing else (EXP-0028). So the
 * predicate is "every cooler is within tolerance OF THE COMMAND".
 *
 * [NOT-TESTED]
 */
export function reachedLevel(coolers, target, { tolerancePct = RAMP_TOLERANCE_PCT } = {}) {
  if (!Array.isArray(coolers) || !coolers.length) return false;
  return coolers.every((c) => Number.isFinite(c.level) && Math.abs(c.level - target) <= tolerancePct);
}

/**
 * HAS THE FAN PHYSICALLY ARRIVED? — the question `reachedLevel` above CANNOT answer, and the first
 * live run is what proved it.
 *
 * The driver reports the `level` field the instant it accepts the command, so a level-based test
 * passes on the FIRST poll, 0.5 s in, while the blades are still spinning at the previous speed. In
 * the owner's acoustic ladder that put 2907 rpm — nearly the 3000 rpm ceiling — under a rung labelled
 * "30 %", and 207 rpm under one labelled "100 %". He listened to two rungs that were not what they
 * said. **This is EXP-0028 inverted: that lesson said "read the TARGET, not mere stability"; the
 * mistake here was reading the COMMAND instead of the physics.**
 *
 * So arrival is decided on RPM, and on rpm alone: the last `samples` readings must agree within
 * `tolerancePct` of each other. A ramp changes rpm monotonically, so a plateau IS arrival — there is
 * no "plateau on the way up" for this quantity, which is exactly why it is a legitimate test here
 * while it was not for the level field.
 *
 * `history` is a list of readings, oldest first, each an array of coolers.
 *
 * [NOT-TESTED]
 */
export function rpmSettled(history, { samples = 3, tolerancePct = 2 } = {}) {
  if (!Array.isArray(history) || history.length < samples) return false;
  const last = history.slice(-samples);
  if (last.some((snap) => !Array.isArray(snap) || !snap.length)) return false;
  const coolerCount = last[0].length;
  if (last.some((snap) => snap.length !== coolerCount)) return false;
  for (let i = 0; i < coolerCount; i++) {
    // NOT `Number(rpm)`: `Number(null)` is 0, and 0 is then read as "the fan is stopped" — so a
    // reading that never arrived would masquerade as a settled, silent fan. «Could not look» and
    // «nothing is happening» are different answers, and this module must not merge them (the same
    // rule event-logger keeps between `error` and `no-events`). Caught by its own selftest.
    const rpms = last.map((snap) => snap[i]?.rpm);
    if (rpms.some((r) => typeof r !== 'number' || !Number.isFinite(r))) return false;
    const lo = Math.min(...rpms);
    const hi = Math.max(...rpms);
    // A stopped fan is a legitimate settled state; treat 0 as settled only if every sample is 0.
    if (hi === 0) continue;
    if (((hi - lo) / hi) * 100 > tolerancePct) return false;
  }
  return true;
}

/**
 * The rpm this card should show at a given level, from the line MEASURED during the owner's ladder:
 * 40 % → 1000 rpm and 100 % → 2714 rpm, i.e. **28.55 rpm per percent**. It is a CROSS-CHECK printed
 * beside the observation, never the arrival test — a predicted number that decided when to stop
 * waiting would be the same mistake as trusting the command field, one layer up.
 *
 * [NOT-TESTED]
 */
export function expectedRpm(level) {
  return Math.round(1000 + (level - 40) * 28.55);
}

// =================================================================================================
// 2. The run
// =================================================================================================

/**
 * Walk the ladder, holding each rung for the owner's listening window.
 *
 * Returns one row per rung with what was COMMANDED and what the card actually reported — level and
 * rpm per cooler — so his verdict lands next to numbers rather than next to a memory.
 *
 * [NOT-TESTED]
 */
export async function runLadder({
  levels = DEFAULT_LEVELS,
  holdSeconds = DEFAULT_HOLD_SECONDS,
  periodSeconds = null,
  cueLevel = DEFAULT_CUE_LEVEL,
  dryRun = false,
  onRung = null,
} = {}) {
  const built = buildLadder(levels);
  if (!built.ok) throw new Error(built.problems.join('; '));

  const nvapi = await import(pathToFileURL(join(ROOT, 'automation-engine', 'lib', 'nvapi.mjs')).href);
  const wd = await import(pathToFileURL(join(ROOT, 'automation-engine', 'lib', 'watchdog.mjs')).href);

  const out = { levels: built.levels, holdSeconds, rungs: [], rollback: null };
  if (dryRun) { out.dryRun = true; return out; }

  const stale = await wd.recover({});
  if (stale.found && stale.ownerAlive) {
    throw new Error(`карту держит живой процесс pid ${stale.record.ownerPid} — лестница не начата`);
  }

  const nv = nvapi.openNvapi();
  nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
  const handles = Buffer.alloc(64 * 8);
  const count = Buffer.alloc(4);
  nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
  const handle = handles.readBigUInt64LE(0);

  // The reference the ear needs: what the card sounds like RIGHT NOW, before we touch anything.
  const before = nvapi.readFanCoolers(nv, handle);
  out.before = before.status.ok
    ? before.status.coolers.map((c) => ({ id: c.id, level: c.level, rpm: c.rpm }))
    : null;

  let watchdog = null;
  let touched = false;
  try {
    watchdog = wd.arm({
      what: `АКУСТИЧЕСКАЯ ЛЕСТНИЦА: вентиляторы ${built.levels.join(' → ')} %, по ${holdSeconds} с`,
      ttlMs: (built.levels.length * (holdSeconds + 40) + 120) * 1000,
    });
    out.watchdogPid = watchdog.guardPid;

    // THE CUE IS DECIDED HERE, ON A FRESH TEMPERATURE, and the decision is recorded either way.
    // It descends to the floor, so it is allowed only while the card is cold — the one situation
    // the upward-only rule exists to prevent is a fan dropped low on a hot card.
    let plan = [...built.levels];
    if (cueLevel !== null) {
      const t0 = cardTemperatureC();
      const verdict = cueAllowed(t0);
      out.cue = { level: cueLevel, ...verdict, temperatureC: t0 };
      if (verdict.ok) plan = [cueLevel, ...built.levels];
      if (onRung) onRung({ phase: 'cue', ...out.cue });
    }

    for (const level of plan) {
      watchdog.beat();
      const started = Date.now();
      const w = nvapi.writeFanControl(nv, handle, { mode: nvapi.FAN_MODE.MANUAL, level });
      touched = true;

      // WAIT FOR THE BLADES, not for the driver's acknowledgement. The level field is true the
      // instant the command lands; the rpm is true when the fan actually got there.
      let reached = false;
      let last = null;
      const history = [];
      while (Date.now() - started < RAMP_TIMEOUT_MS) {
        await sleep(RAMP_POLL_MS);
        watchdog.beat();
        const s = nvapi.readFanCoolers(nv, handle);
        last = s.status.ok ? s.status.coolers.map((c) => ({ id: c.id, level: c.level, rpm: c.rpm })) : null;
        if (last) history.push(last);
        if (last && reachedLevel(last, level) && rpmSettled(history)) { reached = true; break; }
      }
      const rampMs = Date.now() - started;

      const rung = {
        level,
        isCue: out.cue?.ok === true && out.rungs.length === 0,
        commanded: w.ok,
        reached,
        rampSeconds: Number((rampMs / 1000).toFixed(1)),
        expectedRpm: expectedRpm(level),
        coolers: last,
        rpm: last ? last.map((c) => c.rpm) : null,
      };
      if (onRung) onRung({ ...rung, phase: 'listen' });

      // TWO WAYS TO SPEND THE RUNG, and the owner picks by how he is measuring.
      //  · holdSeconds — his listening window starts AFTER the ramp, so every rung is as long as its
      //    ramp made it. Honest, and impossible to follow on a stopwatch.
      //  · periodSeconds — every rung is exactly N seconds from the moment it was COMMANDED, so the
      //    boundaries land on round multiples and he can follow by counting. Asked for 2026-08-10:
      //    «давай шаги твоей лестницы сделаем по 15 секунд, мне так будет легко ориентироваться по
      //    секундомеру». The ramp then lives INSIDE the rung, and the report says how much of it was
      //    ramp — so he knows how much of each window was settled sound rather than a transition.
      if (periodSeconds !== null) {
        while (Date.now() - started < periodSeconds * 1000) {
          await sleep(500);
          watchdog.beat();
        }
      } else {
        const listenStart = Date.now();
        while (Date.now() - listenStart < holdSeconds * 1000) {
          await sleep(1000);
          watchdog.beat();
        }
      }
      const after = nvapi.readFanCoolers(nv, handle);
      rung.coolersAtEnd = after.status.ok
        ? after.status.coolers.map((c) => ({ id: c.id, level: c.level, rpm: c.rpm }))
        : null;
      out.rungs.push(rung);
      if (onRung) onRung({ ...rung, phase: 'done' });
    }
  } finally {
    if (touched) {
      const back = nvapi.resetFansToAuto(nv, handle);
      out.rollback = back;
    }
    watchdog?.disarm();
    nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload);
  }

  return out;
}

// =================================================================================================
// 3. Selftest — the ladder logic. No GPU, no fans, no noise.
// =================================================================================================

/**
 * MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
 *   1. sort the ladder instead of refusing a descending one → «лестница вниз — ОТКАЗ, а не тихая сортировка»
 *   2. accept a rung below the card's floor                  → «ступень ниже пола карты — отказ»
 *   3. call a level reached when only ONE cooler arrived      → «уровень достигнут только когда ДОШЛИ ВСЕ кулеры»
 *   4. treat two agreeing samples as arrival                  → «пустой список кулеров — это НЕ достигнутый уровень»
 *   5. let the cue play on a hot card                          → «на горячей карте отсечка ОТКАЗАНА — спуск на пол это и есть тот случай, ради которого правило»
 *   6. assume cold when the temperature did not read         → «непрочитанная температура — тоже отказ, а не «наверное холодно»»
 *   7. let the cue relax the ladder rule                       → «ЛЕСТНИЦА ОТ ЭТОГО НЕ ПОДОБРЕЛА: спуск внутри неё по-прежнему отказ»
 */
export function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  ok('лестница владельца принимается как есть', buildLadder().ok, true);
  ok('и она ровно та, что он назвал', buildLadder().levels, [30, 40, 50, 60, 70, 80, 90, 100]);
  const down = buildLadder([60, 50]);
  ok('лестница вниз — ОТКАЗ, а не тихая сортировка', down.ok, false);
  ok('и отказ называет направление', /ТОЛЬКО ВВЕРХ/.test(down.problems.join(' ')), true);
  ok('повтор ступени — тоже отказ (это не подъём)', buildLadder([50, 50]).ok, false);
  ok('ступень ниже пола карты — отказ', buildLadder([20, 40]).ok, false);
  ok('и пол назван числом, а не «низко»', /30 %/.test(buildLadder([20]).problems.join(' ')), true);
  ok('выше 100 % — отказ', buildLadder([90, 110]).ok, false);
  ok('пустая лестница — отказ', buildLadder([]).ok, false);

  // arrival
  const three = (l) => [{ level: l, rpm: 1 }, { level: l, rpm: 1 }, { level: l, rpm: 1 }];
  ok('уровень достигнут только когда ДОШЛИ ВСЕ кулеры', reachedLevel(three(70), 70), true);
  ok('один отставший кулер — уровень НЕ достигнут',
    reachedLevel([{ level: 70 }, { level: 70 }, { level: 41 }], 70), false);
  ok('допуск в 3 пункта принимается', reachedLevel(three(68), 70), true);
  ok('пустой список кулеров — это НЕ достигнутый уровень', reachedLevel([], 70), false);
  ok('нечитаемый уровень — не достигнутый', reachedLevel([{ level: null }], 70), false);

  // --- ARRIVAL BY RPM, and these blocks exist because the level field lied to the owner's ears.
  const snap = (rpm) => [{ rpm }, { rpm }, { rpm }];
  ok('плато оборотов — это приезд', rpmSettled([snap(1000), snap(1005), snap(1000)]), true);
  ok('РАЗГОН — это НЕ приезд, даже если поле level уже рапортует цель',
    rpmSettled([snap(500), snap(1200), snap(1900)]), false);
  ok('двух проб мало для плато', rpmSettled([snap(1000), snap(1000)]), false);
  ok('один отставший кулер ломает плато', rpmSettled([[{ rpm: 1000 }, { rpm: 500 }], [{ rpm: 1000 }, { rpm: 900 }], [{ rpm: 1000 }, { rpm: 1000 }]]), false);
  ok('остановленные кулеры — законное плато', rpmSettled([snap(0), snap(0), snap(0)]), true);
  ok('нечитаемые обороты плато не дают', rpmSettled([snap(null), snap(null), snap(null)]), false);
  // the cross-check line, taken from the owner's own ladder
  ok('предсказание оборотов сходится с замером на 40 %', expectedRpm(40), 1000);
  ok('и на 100 % — с точностью до оборота', expectedRpm(100), 2713);
  ok('и на пороге владельца 60 %', expectedRpm(60), 1571);

  // THE CUE — the owner's audible start marker, and the one descent this tool performs
  ok('на холодной карте отсечка разрешена', cueAllowed(45).ok, true);
  ok('на горячей карте отсечка ОТКАЗАНА — спуск на пол это и есть тот случай, ради которого правило',
    cueAllowed(75).ok, false);
  ok('и отказ называет обе температуры', /75 °C.*60 °C/.test(cueAllowed(75).why), true);
  ok('непрочитанная температура — тоже отказ, а не «наверное холодно»', cueAllowed(null).ok, false);
  ok('граница включительно: ровно порог ещё разрешён', cueAllowed(60).ok, true);
  ok('ЛЕСТНИЦА ОТ ЭТОГО НЕ ПОДОБРЕЛА: спуск внутри неё по-прежнему отказ',
    buildLadder([100, 30, 40]).ok, false);

  // the schedule a human reads
  const withCue = schedule([30, 40], { holdSeconds: 10, rampEstimateS: 8, cueLevel: 100 });
  ok('отсечка идёт ПЕРВОЙ ступенью расписания', withCue[0].level, 100);
  ok('и не вытесняет ни одной ступени лестницы', withCue.length, 3);
  const s = schedule([30, 40], { holdSeconds: 10, rampEstimateS: 8 });
  ok('расписание: слушать начинаем ПОСЛЕ разгона', s[0].listenFromS, 8);
  ok('и следующая ступень стартует после окна предыдущей', s[1].listenFromS, 26);
  ok('время печатается человеку как мм:сс', mmss(75), '01:15');

  return { ok: results.every((r) => r.ok), results };
}

// =================================================================================================
// 4. CLI
// =================================================================================================

async function main(argv) {
  if (argv.includes('--selftest')) {
    const r = selfTest();
    for (const x of r.results) {
      console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok ? '' : `  -> получено ${JSON.stringify(x.got)}, ждали ${JSON.stringify(x.want)}`}`);
    }
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА: есть расхождения.');
    return r.ok ? 0 : 1;
  }

  const arg = (name, fallback = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const levels = (arg('levels') ?? DEFAULT_LEVELS.join(',')).split(',').map((s) => Number(s.trim()));
  const holdSeconds = Number(arg('hold', DEFAULT_HOLD_SECONDS));
  const periodArg = arg('period', null);
  const periodSeconds = periodArg === null ? null : Number(periodArg);
  const noCue = argv.includes('--no-cue');
  const cueLevel = noCue ? null : Number(arg('cue', DEFAULT_CUE_LEVEL));
  const dryRun = argv.includes('--dry-run');

  const built = buildLadder(levels);
  if (!built.ok) {
    console.error('ЛЕСТНИЦА НЕ ПРИНЯТА:');
    for (const p of built.problems) console.error(`  · ${p}`);
    return 2;
  }

  const t0 = cardTemperatureC();
  const cueVerdict = cueLevel === null ? { ok: false, why: 'отсечка выключена флагом --no-cue' } : cueAllowed(t0);
  const plan = schedule(built.levels, { holdSeconds, periodSeconds, cueLevel: cueVerdict.ok ? cueLevel : null });
  console.log('АКУСТИЧЕСКАЯ ЛЕСТНИЦА — слушает ВЛАДЕЛЕЦ, карта здесь прибор');
  console.log('');
  console.log(`  СТУПЕНИ:   ${built.levels.join(' → ')} %`);
  console.log(periodSeconds !== null
    ? `  ШАГ:       РОВНО ${periodSeconds} с на ступень от момента команды — границы падают на круглые`
    : `  ОКНО:      ${holdSeconds} с на каждой — и оно начинается ПОСЛЕ того, как обороты ДОЙДУТ`);
  console.log('             до команды. Вентилятор разгоняется ~8 с, и десять секунд «сразу после');
  console.log('             команды» дали бы вам послушать разгон, а не уровень (EXP-0028).');
  console.log(`  ВСЕГО:     примерно ${mmss(plan.at(-1).listenToS)} звучания`);
  console.log(`  ОТСЕЧКА:   ${cueVerdict.ok ? `ДА — ${cueLevel} % первой ступенью, чтобы переход ${cueLevel} → ${built.levels[0]} % отметил старт для уха` : `НЕТ — ${cueVerdict.why}`}`);
  console.log('  ПИШЕМ:     только вентиляторы. Ни частот, ни напряжений, ни потолка мощности.');
  console.log('  ОТКАТ:     AUTO в finally, с перечитыванием; сторож взводится ДО первой записи и');
  console.log('             вернёт кулеры в AUTO сам, если этот процесс умрёт.');
  console.log('');
  console.log('  РАСПИСАНИЕ (оценка, разгон может отличаться):');
  for (const [i, p] of plan.entries()) {
    const mark = (cueVerdict.ok && i === 0) ? '  ← ОТСЕЧКА: за ней услышите падение на пол' : '';
    console.log(`    ${String(p.level).padStart(3)} %  слушать с ${mmss(p.listenFromS)} до ${mmss(p.listenToS)}${mark}`);
  }
  console.log('');

  if (dryRun) {
    console.log('СУХОЙ ПРОГОН: ни одной записи не сделано.');
    return 0;
  }

  let r;
  try {
    r = await runLadder({
      levels: built.levels,
      holdSeconds,
      periodSeconds,
      cueLevel,
      onRung: (x) => {
        if (x.phase === 'listen') {
          console.log(`  ▶ ${String(x.level).padStart(3)} % — ОБОРОТЫ ДОШЛИ за ${x.rampSeconds} с `
            + `(${x.rpm ? x.rpm.join(' / ') : '—'} об/мин). СЛУШАЙТЕ ${x.reached ? '' : '(цель НЕ достигнута — учтите это)'}`);
        }
      },
    });
  } catch (e) {
    console.error(`ОШИБКА: ${e.message}`);
    return 1;
  }

  console.log('');
  console.log('  уровень | дошёл за | обороты (3 кулера)      | цель достигнута');
  for (const rung of r.rungs) {
    console.log(`  ${String(rung.level).padStart(6)} % | ${String(rung.rampSeconds).padStart(7)} с | `
      + `${(rung.rpm ? rung.rpm.join(' / ') : '—').padEnd(23)} | ${rung.reached ? 'да' : 'НЕТ'}`);
  }
  console.log('');
  if (r.rollback) {
    console.log(`ОТКАТ: ${r.rollback.ok ? 'все кулеры вернулись в AUTO, и это перечитано' : 'НЕ ПОДТВЕРДИЛСЯ'}`
      + ` — в ручном режиме осталось ${r.rollback.manualLeft}`);
  }
  console.log('');
  console.log('ТЕПЕРЬ ВАШЕ СЛОВО: на каком уровне шум перестаёт быть приемлемым? Число, а не «громко» —');
  console.log('оно станет критерием приёмки для Silent Cold и Optimised, и я запишу его в канон.');
  return r.rollback && r.rollback.ok ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
