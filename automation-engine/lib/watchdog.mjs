#!/usr/bin/env node
// watchdog.mjs — THE DEAD-MAN'S SWITCH. The thing that returns the owner's card to factory when the
// process that changed it can no longer speak for itself.
//
// ─── WHY IT EXISTS, IN THE OWNER'S WORDS ──────────────────────────────────────────────────────────
//
// Asked for directly (chat, 2026-08-10): *«убедись, что у тебя есть страж на всякий случай, который
// перезагрузит драйвер видюхи, или откатит её к дефолту, если вдруг уроним драйвер и экран погаснет —
// винда и твой сторож должны будут по таймауту откатить»*.
//
// The next step of phase 4 is the FIRST POSITIVE offset — a real undervolt, the first operation in this
// project that can take the display down. Every rollback KAGO has written so far lives in a `finally`,
// and a `finally` is worth exactly as much as the process running it. A hung process runs no `finally`.
// A killed process runs no `finally`. A process waiting on a driver that has stopped answering runs no
// `finally`. That is the hole this module closes, and it must exist BEFORE the write that needs it.
//
// ─── THE FOUR LAYERS, AND WHAT EACH ONE ACTUALLY COVERS ───────────────────────────────────────────
//
//  1. `finally` inside the writing process     — covers an ordinary error. Useless if the process hangs.
//  2. THIS WATCHDOG, a SEPARATE detached process — covers a hung, killed or crashed writer, and a GPU
//     that stopped answering while Windows stayed alive. Fires on a deadline OR on the writer's death.
//  3. WINDOWS' OWN TDR                          — covers a driver that stops responding. VERIFIED on
//     this machine 2026-08-10 by reading the registry: the `GraphicsDrivers` TDR values are ABSENT,
//     which means the defaults are in force — TdrLevel 3 ("recover on timeout"), TdrDelay 2 s. Nothing
//     to configure, and deliberately nothing changed: those keys are machine state, not ours.
//  4. VOLATILITY + REBOOT                       — covers a machine so wedged that nothing above runs.
//     Clock offsets live in volatile driver state, so a power cycle returns the card to factory with no
//     action from the owner. INHERITED, NOT YET VERIFIED HERE — see the honesty note at the bottom.
//
// Layer 2 is the only one that is ours to build. Layers 3 and 4 are reported, not assumed, and neither
// is touched.
//
// ─── THE UNDO IS TOTAL, NOT DIFFERENTIAL — and that is the important design decision ───────────────
//
// The watchdog does NOT try to undo "what was applied". After a crash nobody knows what was applied:
// the writer may have died between the write and the record of it. So the undo is the same one the
// owner's third shortcut performs — RETURN THE CARD TO FACTORY, unconditionally and idempotently:
// every curve offset to zero, both NVML domain offsets to zero, clocks released, power limit to
// default. Zeroing something already zero costs nothing and cannot be wrong; guessing a differential
// undo from an incomplete record can be.
//
// ─── RULE R1 IS NOT BROKEN, AND THIS IS WHERE THAT IS ARGUED ──────────────────────────────────────
//
// `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` R1: `profile-manager.mjs` is the only module that writes to
// the GPU. The watchdog introduces NO new writer — it CALLS the existing ones: `resetToFactory()` from
// `profile-manager.mjs` for clocks and power, and `writeVfOffset()` from `nvapi.mjs` for the curve.
// One place to audit stays one place to audit; this module decides WHEN, never HOW.
//
// Usage:
//   npm run watchdog -- --status      what is armed right now, if anything          (read-only)
//   npm run watchdog -- --recover     a record was left behind -> reset and report   (WRITES)
//   npm run watchdog -- --drill       rehearsal on the live card: a victim dies, the guard restores it
//   npm run watchdog -- --selftest    the decision logic on an injected clock and an injected resetter
//   npm run watchdog -- --guard       the loop itself; spawned detached by arm(), not run by hand
//
// [TESTED: 2026-08-10 · the drill has FIRED FOR REAL, twice. A victim process wrote −20 MHz into point
//  110 and died via `process.exit` so no `finally` of its own could run; the detached guard restored the
//  card unaided in 2.5 s, and 2.2 s when the phase-4 judge pass re-ran it — the spread between those two
//  is the honest precision of the figure. Both runs left a report naming THAT drill, not merely a
//  non-empty directory (EXP-0025). Offline: `--selftest` 21 blocks, 0 failures, mutation-proved — five
//  mutations each reddening its own block, plus two more for the fan step added 2026-08-10, of which the
//  one that keeps the step but makes it PIN a level instead of restoring AUTO reddens that block ALONE]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), '..', '..');

/** Machine state, not project history — `runs/` is git-ignored, which is exactly right for this. */
export const WATCHDOG_DIR = path.join(ROOT, 'runs', 'watchdog');
export const ARMED_FILE = path.join(WATCHDOG_DIR, 'armed.json');

/** How often the guard wakes. Fast enough to matter, slow enough to cost nothing. */
export const GUARD_POLL_MS = 1000;

/**
 * The default lease. A writer holds the card for at most this long without saying it is still alive.
 *
 * Chosen against the real numbers rather than a round figure: the longest single measured burst in this
 * project is a 30 s sustained run (`plans/03` §4.3), and a stress verdict adds its event-log window on
 * top. 90 s leaves room for the slowest legitimate step while keeping an unattended failure short.
 * A caller doing something longer passes its own ttl — the lease is renewed by `beat()`, so the right
 * shape is a SHORT lease renewed often, never a long one set once.
 */
export const DEFAULT_TTL_MS = 90_000;

// =================================================================================================
// 1. The armed record
// =================================================================================================

function nowMs() { return Date.now(); }

function localIso(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:`
    + `${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

export function readArmed({ file = ARMED_FILE } = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;                     // absent OR unreadable — both mean "nothing is armed for us"
  }
}

/**
 * How many times a rename is retried before the write is called failed, and how long the pause is.
 *
 * `bugs/19`: the guard polls `armed.json` once a second while the writer renames over it once per
 * burst, and on Windows a rename onto a destination another process holds open returns EPERM. The
 * collision is microseconds wide, so a handful of immediate retries clears it; the numbers are small
 * on purpose, because the caller of a heartbeat is holding a GPU under load and must not be stalled.
 */
const RENAME_RETRIES = 5;
const RENAME_RETRY_MS = 8;

function sleepSync(ms) {
  // A blocking sleep, deliberately: `beat()` is synchronous and called from inside an oracle's burst
  // callback. Atomics on a throwaway buffer is the only way to pause without an event-loop turn.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Write the armed record durably. THROWS on failure — every caller that must not proceed without an
 * armed switch (R9) depends on that. The soft-failure path belongs to `beat()` alone, below.
 *
 * @param {object} io injected `fs` seam, so the selftest can prove the retry and the failure
 *                    direction without needing a real sharing race (which is not schedulable).
 */
function writeArmed(record, { file = ARMED_FILE, io = fs } = {}) {
  io.mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename: the guard polls this file continuously, and a half-written JSON must never be
  // what it reads. A torn read here would be a watchdog that fires (or fails to) on garbage.
  const tmp = `${file}.tmp`;
  io.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
  let last = null;
  for (let attempt = 0; attempt <= RENAME_RETRIES; attempt++) {
    try { io.renameSync(tmp, file); return; } catch (e) {
      // ONLY the sharing race is retried. A genuine permission problem, a missing directory or a
      // read-only volume must surface immediately — retrying those would turn a clear error into a
      // slow one and teach nobody anything.
      if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') throw e;
      last = e;
      if (attempt < RENAME_RETRIES) sleepSync(RENAME_RETRY_MS);
    }
  }
  throw last;
}

export function clearArmed({ file = ARMED_FILE } = {}) {
  try { fs.unlinkSync(file); return true; } catch { return false; }
}

/**
 * Is that process still alive?
 *
 * `process.kill(pid, 0)` sends no signal — it only asks the OS whether the pid can be signalled. EPERM
 * means it exists and belongs to someone else, which still counts as alive.
 */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// =================================================================================================
// 2. Arm / beat / disarm — the writer's side
// =================================================================================================

/**
 * Arm the switch and start the guard.
 *
 * Called BEFORE the risky write, never after: a switch armed after the write does not cover the write.
 * Returns a handle whose `beat()` renews the lease and whose `disarm()` ends it.
 */
export function arm({ what, ttlMs = DEFAULT_TTL_MS, file = ARMED_FILE, spawnGuard = true, io = fs } = {}) {
  const record = {
    armedAt: localIso(nowMs()),
    armedAtMs: nowMs(),
    deadlineMs: nowMs() + ttlMs,
    ttlMs,
    ownerPid: process.pid,
    what: what ?? 'не названо',
    undo: 'полный возврат карты к заводскому состоянию (сдвиги кривой -> 0, NVML -> 0, -rgc, потолок мощности по умолчанию)',
  };
  // ARMING THROWS, AND THAT IS DELIBERATE (R9, `bugs/19` step 3). A write that could not arm must not
  // happen at all, so this failure is fatal by design — unlike the RENEWAL below, whose failure is
  // merely a lease not extended. The two are told apart here, in code, not in a comment downstream.
  writeArmed(record, { file, io });

  let guardPid = null;
  if (spawnGuard) {
    // Detached, with its own stdio and no handle held by us: the guard must OUTLIVE its parent, since
    // the parent dying is one of the two things it exists to notice.
    const child = spawn(process.execPath, [HERE, '--guard'], {
      detached: true, stdio: 'ignore', windowsHide: true, cwd: ROOT,
    });
    child.unref();
    guardPid = child.pid;
  }

  return {
    record,
    guardPid,
    // THE HEARTBEAT NEVER THROWS — `bugs/19`, and this is the whole fix.
    //
    // A beat is a lease RENEWAL. Its failure means «the lease was not extended», and the deadline
    // already on disk then does its job: if beats keep failing, the lease expires and the guard
    // restores the card. That is the SAFE direction, and it is the direction this mechanism exists
    // to point in. On 2026-08-16 it pointed the other way — an EPERM from the rename propagated out
    // of here, through the stability oracle, and killed a healthy sweep at 41 burns of 94, in the
    // middle of a GPU write. **A safety mechanism that kills what it guards has inverted its own
    // purpose**: the watchdog exists so a dead writer cannot leave the card held, and it manufactured
    // exactly the event it was built to survive.
    //
    // `false` is already this function's word for «not renewed» (the disarmed case below), and no
    // caller reads it — `vf-step.runStep` calls `watchdog.beat()` from `onBurst`/`onShape` and
    // discards the value. So the soft failure costs nothing and changes no caller.
    beat(extraMs = ttlMs) {
      try {
        const current = readArmed({ file });
        if (!current) return false;           // already disarmed or fired — do not resurrect it
        current.deadlineMs = nowMs() + extraMs;
        writeArmed(current, { file, io });
        return true;
      } catch {
        return false;
      }
    },
    disarm() { return clearArmed({ file }); },
  };
}

// =================================================================================================
// 3. The decision — kept pure so it can be tested without a GPU and without waiting
// =================================================================================================

export const VERDICT = Object.freeze({
  NOTHING_ARMED: 'ничего не взведено',
  HOLDING: 'держим — владелец жив и срок не вышел',
  FIRE_DEADLINE: 'СРАБОТКА: срок истёк без подтверждения жизни',
  FIRE_OWNER_GONE: 'СРАБОТКА: процесс, взведший сторожа, мёртв',
});

/**
 * Should the guard fire? A pure function of the record, the clock and a liveness oracle.
 *
 * Pure on purpose: the whole value of a watchdog is in WHEN it fires, and that must be provable
 * without a GPU, without real time, and without killing anything (`PHILOSOPHY.md` → code before
 * cognition; `TESTING_FRAMEWORK.md` → the work produces its own means of checking).
 *
 * Order matters: a dead owner fires immediately rather than waiting out the lease, because a dead
 * owner can never disarm and every second until the deadline is a second the card stays modified.
 */
export function decide(record, { now, alive = pidAlive } = {}) {
  if (!record) return { fire: false, verdict: VERDICT.NOTHING_ARMED };
  if (!alive(record.ownerPid)) {
    return { fire: true, verdict: VERDICT.FIRE_OWNER_GONE, detail: `pid ${record.ownerPid} не существует` };
  }
  if (now > record.deadlineMs) {
    return {
      fire: true,
      verdict: VERDICT.FIRE_DEADLINE,
      detail: `просрочка ${Math.round((now - record.deadlineMs) / 1000)} с`,
    };
  }
  return { fire: false, verdict: VERDICT.HOLDING, detail: `до срока ${Math.round((record.deadlineMs - now) / 1000)} с` };
}

// =================================================================================================
// 4. The undo — total, idempotent, and built out of the EXISTING writers (rule R1)
// =================================================================================================

/**
 * Return the card to factory. Every step is independent and every step is attempted.
 *
 * ONE FAILING STEP MUST NOT CANCEL THE OTHERS. This runs when things have already gone wrong, so the
 * usual "throw on the first error" shape is precisely backwards: if the curve reset throws, the clocks
 * and the power limit still have to come back. Each step reports its own outcome and the caller gets
 * the whole list.
 */
export async function resetCardToFactory({ deps = null } = {}) {
  const steps = [];
  const run = async (name, fn) => {
    try { steps.push({ name, ok: true, detail: await fn() }); } catch (e) { steps.push({ name, ok: false, detail: e.message }); }
  };

  const d = deps ?? await realDeps();

  // 1. The curve: every point to zero. 128 calls because the API takes one point per call — the same
  //    constraint that makes a bad write small makes a total reset a loop. Zeroing a zero is free.
  await run('сдвиги кривой -> 0 по всем 128 точкам', async () => {
    const r = await d.zeroAllCurveOffsets();
    return `записей обнулено ${r.written}, отказов ${r.failed}, ненулевых осталось ${r.remainingNonZero}`;
  });

  // 2. NVML's global domain offsets — a different lever onto the same state, so a reset must clear
  //    both or the card is only half returned (researches/05 §5.5).
  await run('сдвиги NVML (графика и память) -> 0', async () => {
    const r = await d.zeroNvmlOffsets();
    return `графика ${r.graphics}, память ${r.memory}`;
  });

  // 3. Clocks and power, through the sanctioned reset path.
  await run('частоты отпущены, потолок мощности по умолчанию', async () => {
    const r = await d.resetClocksAndPower();
    return r;
  });

  // 4. FANS -> AUTO. Added 2026-08-10 17:2x, BEFORE the project's first fan write existed, because
  //    without it layer 2 had a hole: a writer that died holding MANUAL left the fans pinned, and this
  //    card's own floor for manual control is 30 % (measured — `researches/05` §9), so "pinned" means
  //    the owner's idle card audibly changes and nothing brings it back. Pinned-HIGH is the harmless
  //    direction and it is the only one the cold-start protocol ever asks for; harmless is still not
  //    restored. AUTO is idempotent, so this step costs nothing on a card that was never touched.
  await run('вентиляторы -> автоматическая политика', async () => {
    const r = await d.resetFansToAuto();
    return r;
  });

  return { ok: steps.every((s) => s.ok), steps };
}

/** The real implementations, imported lazily so the selftest never loads koffi or touches a card. */
async function realDeps() {
  const nvapi = await import('./nvapi.mjs');
  const nvml = await import('./nvml.mjs');
  const pm = await import('./profile-manager.mjs');

  return {
    async zeroAllCurveOffsets() {
      const nv = nvapi.openNvapi();
      nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
      try {
        const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
        nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
        const handle = handles.readBigUInt64LE(0);
        let written = 0; let failed = 0;
        for (let i = 0; i < nvapi.CLK_VF_POINT_COUNT; i++) {
          const r = nvapi.writeVfOffset(nv, handle, i, 0);
          if (r.ok) written++; else failed++;
        }
        const after = nvapi.readVfOffsets(nv, handle);
        return { written, failed, remainingNonZero: after.ok ? after.nonZero : 'не прочитано' };
      } finally {
        nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload);
      }
    },

    async zeroNvmlOffsets() {
      const nv = nvml.openNvml();
      if (nv.init() !== 0) return { graphics: 'NVML не инициализирован', memory: '—' };
      try {
        const hb = Buffer.alloc(8);
        if (nv.getHandleByIndex(0, hb) !== 0) return { graphics: 'дескриптор не получен', memory: '—' };
        const h = hb.readBigUInt64LE(0);
        const g = nvml.writeClockOffset(nv, h, 0, { type: nvml.NVML_CLOCK_GRAPHICS });
        const m = nvml.writeClockOffset(nv, h, 0, { type: nvml.NVML_CLOCK_MEM });
        return { graphics: g.why, memory: m.why };
      } finally { nv.shutdown(); }
    },

    async resetClocksAndPower() {
      const backend = pm.nvidiaSmiBackend();
      const r = await pm.resetToFactory(backend);
      const s = r?.after ?? pm.readState(backend);
      return `потолок ${s.powerLimitW} Вт (по умолчанию ${s.powerDefaultW}), частота ${s.clockMhz} МГц`;
    },

    async resetFansToAuto() {
      const nv = nvapi.openNvapi();
      nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
      try {
        const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
        nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
        const handle = handles.readBigUInt64LE(0);
        const r = nvapi.resetFansToAuto(nv, handle);
        return `кулеров ${r.coolers.length}, в ручном режиме осталось ${r.manualLeft}, уровни ${JSON.stringify(r.levelsAfter)} (${r.status})`;
      } finally {
        nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload);
      }
    },
  };
}

// =================================================================================================
// 5. The guard process
// =================================================================================================

/**
 * The loop. Runs detached, owns nothing, and does exactly one thing when the moment comes.
 *
 * It re-reads the record every tick rather than caching it, so a `beat()` from the writer is seen
 * immediately and a `disarm()` ends the guard without anyone having to signal it.
 */
export async function guardLoop({ file = ARMED_FILE, pollMs = GUARD_POLL_MS, maxTicks = Infinity, deps = null, log = () => {} } = {}) {
  for (let tick = 0; tick < maxTicks; tick++) {
    const record = readArmed({ file });
    if (!record) { log('запись снята — сторож выходит'); return { fired: false, reason: VERDICT.NOTHING_ARMED }; }

    const verdict = decide(record, { now: nowMs() });
    if (verdict.fire) {
      log(`${verdict.verdict} — ${verdict.detail}`);
      // Take the record away FIRST. If the reset itself hangs or dies, nothing must be left that makes
      // a second guard fire again on top of a reset already in flight.
      clearArmed({ file });
      const result = await resetCardToFactory({ deps });
      const report = {
        firedAt: localIso(nowMs()),
        verdict: verdict.verdict,
        detail: verdict.detail,
        armedFor: record.what,
        reset: result,
      };
      try {
        // The report goes NEXT TO ITS OWN RECORD, not into the module-level directory. That distinction
        // is not tidiness: a fire report is EVIDENCE that the card was reset in anger, and the selftest
        // — which fires the loop many times over injected fixtures in a temp file — was writing those
        // fixtures' reports into the real directory. Two dozen fabricated "the card crashed today"
        // records is exactly the kind of forensics this project must never manufacture.
        const dir = path.dirname(path.resolve(file));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `fired-${String(nowMs())}.json`), `${JSON.stringify(report, null, 2)}\n`);
      } catch { /* a report that cannot be written must not stop a reset that already ran */ }
      return { fired: true, reason: verdict.verdict, report };
    }

    await sleep(pollMs);
  }
  return { fired: false, reason: 'исчерпан лимит тиков' };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// =================================================================================================
// 6. Recovery — a record found at rest means somebody died holding the card
// =================================================================================================

/**
 * A stale record is EVIDENCE, and it outlives the session that made it.
 *
 * Any KAGO entry point can call this: if a record is sitting there and its owner is gone, the previous
 * run died holding the card. Reset first, report second, and never start new work on top of a state
 * nobody can describe.
 */
export async function recover({ file = ARMED_FILE, deps = null } = {}) {
  const record = readArmed({ file });
  if (!record) return { found: false };
  const alive = pidAlive(record.ownerPid);
  if (alive) return { found: true, ownerAlive: true, record };
  clearArmed({ file });
  const reset = await resetCardToFactory({ deps });
  return { found: true, ownerAlive: false, record, reset };
}

// =================================================================================================
// 7. The selftest — the decision logic, on an injected clock and an injected card
// =================================================================================================

/**
 * Everything that decides WHEN the switch fires, proved without a GPU and without waiting.
 *
 * The blocks that matter most are the unglamorous ones: that a dead owner beats a valid lease, that a
 * disarmed record is never resurrected by a late `beat()`, that the record is taken away BEFORE the
 * reset runs, and that one failing reset step does not cancel the others. Those are the behaviours a
 * future edit would break silently, because none of them shows up in a happy path.
 */
export async function selftest() {
  const blocks = [];
  const check = (name, ok, detail = '') => blocks.push({ name, ok, detail });
  // A directory of its OWN, so the fixtures' fire reports cannot be mistaken for real ones later.
  const sandbox = path.join(WATCHDOG_DIR, `__selftest-${process.pid}`);
  const tmp = path.join(sandbox, 'armed.json');
  const alwaysAlive = () => true;
  const neverAlive = () => false;
  const selftestStartReports = fs.existsSync(WATCHDOG_DIR)
    ? fs.readdirSync(WATCHDOG_DIR).filter((f) => f.startsWith('fired-')).length : 0;

  try {
    // --- decide()
    check('пустая запись -> не срабатываем', decide(null, { now: 1e12 }).fire === false);

    const rec = { ownerPid: 4242, deadlineMs: 1000, what: 'опыт' };
    check('владелец жив, срок не вышел -> держим',
      decide(rec, { now: 500, alive: alwaysAlive }).verdict === VERDICT.HOLDING);
    check('владелец жив, срок вышел -> СРАБОТКА по сроку',
      decide(rec, { now: 1500, alive: alwaysAlive }).verdict === VERDICT.FIRE_DEADLINE);
    check('владелец мёртв -> СРАБОТКА, не дожидаясь срока',
      decide(rec, { now: 500, alive: neverAlive }).verdict === VERDICT.FIRE_OWNER_GONE,
      'срок ещё далеко, но снять сторожа уже некому');
    check('смерть владельца ПРИОРИТЕТНЕЕ действующего срока',
      decide(rec, { now: 0, alive: neverAlive }).fire === true);

    // --- the record's lifecycle
    const h = arm({ what: 'самопроверка', ttlMs: 5000, file: tmp, spawnGuard: false });
    const read1 = readArmed({ file: tmp });
    check('arm() пишет читаемую запись', read1 !== null && read1.ownerPid === process.pid,
      read1 ? `pid ${read1.ownerPid}` : 'запись не прочиталась');

    const before = readArmed({ file: tmp }).deadlineMs;
    h.beat(60_000);
    const after = readArmed({ file: tmp }).deadlineMs;
    check('beat() отодвигает срок', after > before, `+${after - before} мс`);

    h.disarm();
    check('disarm() убирает запись', readArmed({ file: tmp }) === null);
    check('beat() ПОСЛЕ снятия не воскрешает запись', h.beat() === false && readArmed({ file: tmp }) === null,
      'иначе снятый сторож вернулся бы к жизни и сбросил карту посреди работы');

    // --- THE HEARTBEAT'S FAILURE DIRECTION (`bugs/19`). MUTATION ADDRESSEES, NAMED BEFORE THE RUN
    //     (EXP-0016):
    //       a. `beat()` rethrows instead of returning false → «пульс НЕ убивает писателя»
    //       b. `arm()` swallows the same failure           → «взведение ОБЯЗАНО упасть»
    //       c. the rename retry loop is removed            → «переименование ПОВТОРЯЕТСЯ»
    //
    //     The real defect was a Windows sharing race between the writer and its own guard, and a race
    //     is not schedulable — so what is tested is the RESPONSE to it, through an injected `fs`.
    const epermIo = (failures) => {
      let left = failures;
      return {
        mkdirSync: (...a) => fs.mkdirSync(...a),
        writeFileSync: (...a) => fs.writeFileSync(...a),
        renameSync: (from, to) => {
          if (left-- > 0) { const e = new Error('EPERM: operation not permitted, rename'); e.code = 'EPERM'; throw e; }
          return fs.renameSync(from, to);
        },
      };
    };

    {
      // The rename starts working and then STOPS — exactly the shape of the real incident, where the
      // arming succeeded and the four-hundredth beat lost the race. Arming with a broken rename would
      // test a different thing (and is tested separately, below).
      const io = epermIo(0);
      const armed = io.renameSync;
      const h2 = arm({ what: 'пульс', ttlMs: 5000, file: tmp, spawnGuard: false, io });
      io.renameSync = (from, to) => { const e = new Error('EPERM: operation not permitted, rename'); e.code = 'EPERM'; throw e; };
      void armed;
      let threw = null;
      let ret = 'не вызывалось';
      try { ret = h2.beat(60_000); } catch (e) { threw = e; }
      check('пульс НЕ убивает писателя: отказ переименования -> false, а не исключение',
        threw === null && ret === false,
        threw ? `бросил ${threw.code ?? threw.message}` : `вернул ${ret}`);
      // …and the lease it failed to extend is STILL on disk, so the guard can still fire on it.
      // A beat that wiped the record would disarm the switch by failing, which is the other way to
      // get the same disaster.
      check('неудавшийся пульс НЕ снимает аренду — сторож по-прежнему может сработать',
        readArmed({ file: tmp }) !== null);
      h2.disarm();

      let armThrew = null;
      try { arm({ what: 'взведение', ttlMs: 5000, file: tmp, spawnGuard: false, io }); }
      catch (e) { armThrew = e; }
      check('взведение ОБЯЗАНО упасть: незаведённый сторож не даёт права писать в карту (R9)',
        armThrew !== null && armThrew.code === 'EPERM',
        armThrew ? `упало: ${armThrew.code}` : 'arm() промолчал — писать пошли бы без сторожа');
      try { fs.unlinkSync(tmp); } catch { /* may not exist */ }
    }

    {
      // Exactly RENAME_RETRIES failures then success: the write must SUCCEED, not give up.
      const io = epermIo(RENAME_RETRIES);
      let armThrew = null;
      try { arm({ what: 'повтор', ttlMs: 5000, file: tmp, spawnGuard: false, io }); }
      catch (e) { armThrew = e; }
      check('переименование ПОВТОРЯЕТСЯ: гонка совместного доступа переживается, а не роняет прогон',
        armThrew === null && readArmed({ file: tmp }) !== null,
        armThrew ? `упало на попытке из ${RENAME_RETRIES + 1}: ${armThrew.code}` : 'запись легла');
      try { fs.unlinkSync(tmp); } catch { /* may not exist */ }
    }

    // --- a torn or corrupt file is "nothing armed", never a crash
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, '{ это не JSON');
    check('битая запись читается как «ничего не взведено»', readArmed({ file: tmp }) === null);
    clearArmed({ file: tmp });

    // --- the undo: every step attempted, even when one throws
    //
    // The step keys live in ONE place and every block asserts against the SET, never against a count.
    // A hard-coded `called.length === 3` is what the fan step broke when it was added: the block failed
    // for a reason that had nothing to do with the guarantee it guards (the loop fires and resets), and
    // a count says nothing about WHICH steps ran anyway — delete the fan step, duplicate another, and a
    // count-only check stays green (EXP-0016).
    const UNDO_STEPS = ['curve', 'nvml', 'clocks', 'fans'];
    const allRan = (list) => UNDO_STEPS.every((k) => list.includes(k));
    let called = [];
    const failingDeps = {
      zeroAllCurveOffsets: async () => { called.push('curve'); throw new Error('кривая недоступна'); },
      zeroNvmlOffsets: async () => { called.push('nvml'); return { graphics: 'OK', memory: 'OK' }; },
      resetClocksAndPower: async () => { called.push('clocks'); return 'сброшено'; },
      resetFansToAuto: async () => { called.push('fans'); return 'кулеров 3, в ручном режиме осталось 0'; },
    };
    // The call is wrapped because the guarantee under test IS the catching. Without the wrapper a
    // regression that removes step isolation throws straight out of the selftest and KILLS it — and a
    // dead suite reports no failure at all, which reads exactly like green (EXP-0016, second half).
    let r = null; let threw = null;
    try { r = await resetCardToFactory({ deps: failingDeps }); } catch (e) { threw = e; }
    check('падение одного шага сброса НЕ отменяет остальные',
      threw === null && allRan(called),
      threw ? `сброс выбросил «${threw.message}» вместо изоляции шага` : `выполнено шагов: ${called.join(', ')}`);
    check('сброс с упавшим шагом честно докладывает ok=false', threw === null && r?.ok === false,
      threw ? 'вердикта нет — сброс упал' : `провалов ${r.steps.filter((s) => !s.ok).length} из ${r.steps.length}`);

    // The fan step is asserted BY NAME, not by the step count. A count-only check stays green if the
    // fan step is deleted and any other step is duplicated, and this project has already paid twice for
    // a block that was satisfied for the wrong reason (EXP-0016). AND the direction matters: the undo
    // must return the fans to AUTOMATIC, never set a level — a rollback that pins a speed is not a
    // rollback. So the block reads the step's own detail rather than trusting its title.
    check('вентиляторы входят в полный откат — ИМЕНЕМ, а не по числу шагов',
      threw === null && called.includes('fans') && r.steps.some((s) => /вентилятор/i.test(s.name) && /автоматическ/i.test(s.name)),
      threw ? 'сброс упал' : `шаги: ${r.steps.map((s) => s.name).join(' | ')}`);

    // --- the loop
    called = [];
    const okDeps = {
      zeroAllCurveOffsets: async () => { called.push('curve'); return { written: 128, failed: 0, remainingNonZero: 0 }; },
      zeroNvmlOffsets: async () => { called.push('nvml'); return { graphics: 'OK', memory: 'OK' }; },
      resetClocksAndPower: async () => { called.push('clocks'); return 'сброшено'; },
      resetFansToAuto: async () => { called.push('fans'); return 'кулеров 3, в ручном режиме осталось 0'; },
    };

    // The ordering fixture has to be observed FROM INSIDE the reset. Checking that the record is gone
    // after guardLoop returns passes under BOTH orderings, so it tests nothing — this is the "a fixture
    // a neighbouring rule also catches" trap, and the mutation run is what exposed it (EXP-0016).
    // Only the reset itself can see whether the record was already taken away when it started.
    let recordSeenByReset = 'сброс не вызывался';
    const orderingDeps = {
      ...okDeps,
      zeroAllCurveOffsets: async () => {
        called.push('curve');
        recordSeenByReset = readArmed({ file: tmp });
        return { written: 128, failed: 0, remainingNonZero: 0 };
      },
    };

    writeArmed({ ownerPid: 999_999, deadlineMs: nowMs() + 60_000, what: 'мёртвый владелец' }, { file: tmp });
    const fired = await guardLoop({ file: tmp, pollMs: 5, maxTicks: 3, deps: orderingDeps });
    check('цикл срабатывает на мёртвом владельце и сбрасывает карту',
      fired.fired === true && allRan(called), `${fired.reason} · шаги: ${called.join(', ')}`);
    check('цикл снимает запись ДО сброса (второй сторож не выстрелит поверх)',
      recordSeenByReset === null,
      recordSeenByReset === null ? 'в момент сброса записи уже не было'
        : `в момент сброса запись ЕЩЁ ЛЕЖАЛА: ${JSON.stringify(recordSeenByReset)}`);

    writeArmed({ ownerPid: process.pid, deadlineMs: nowMs() - 1, what: 'просрочка' }, { file: tmp });
    called = [];
    const fired2 = await guardLoop({ file: tmp, pollMs: 5, maxTicks: 3, deps: okDeps });
    check('цикл срабатывает по истёкшему сроку при ЖИВОМ владельце',
      fired2.fired === true && fired2.reason === VERDICT.FIRE_DEADLINE);

    clearArmed({ file: tmp });
    called = [];
    const quiet = await guardLoop({ file: tmp, pollMs: 5, maxTicks: 2, deps: okDeps });
    check('без записи цикл тихо выходит и НИЧЕГО не сбрасывает',
      quiet.fired === false && called.length === 0,
      'сторож не имеет права трогать карту, когда его никто не взводил');

    // --- pidAlive on something knowable
    check('pidAlive: собственный pid жив', pidAlive(process.pid) === true);
    check('pidAlive: заведомо отсутствующий pid мёртв', pidAlive(999_999) === false);
    check('pidAlive: мусор на входе -> мёртв', pidAlive(0) === false && pidAlive(-1) === false && pidAlive(NaN) === false);

    // The pollution guard, and it belongs in the suite rather than in a comment: the fixtures above
    // fired the loop several times, and every one of those reports must have landed in the sandbox.
    const realReports = fs.existsSync(WATCHDOG_DIR)
      ? fs.readdirSync(WATCHDOG_DIR).filter((f) => f.startsWith('fired-')).length : 0;
    const sandboxReports = fs.existsSync(sandbox)
      ? fs.readdirSync(sandbox).filter((f) => f.startsWith('fired-')).length : 0;
    check('отчёты подставных срабатываний НЕ попали в настоящую папку',
      sandboxReports >= 2 && realReports === selftestStartReports,
      `в песочнице ${sandboxReports}, в настоящей было ${selftestStartReports} и стало ${realReports}`);
  } finally {
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  return blocks;
}

// =================================================================================================
// 8. The drill — the switch actually firing, on the live card
// =================================================================================================

const DRILL_MARKER = path.join(WATCHDOG_DIR, 'drill-victim.json');

/**
 * THE VICTIM. Arms the switch, really changes the card, and then DIES WITHOUT DISARMING.
 *
 * `process.exit()` is the point of this function, not a shortcut: it is how a `finally` gets skipped,
 * which is the exact scenario the watchdog exists for. It records its own read-back first, so the
 * drill can prove the offset was genuinely applied without having to race the guard for a glimpse.
 */
async function drillVictim({ point = 110, offsetMhz = -20 } = {}) {
  const nvapi = await import('./nvapi.mjs');
  arm({ what: `учебная тревога: точка ${point}, сдвиг ${offsetMhz} МГц`, ttlMs: 120_000 });

  const nv = nvapi.openNvapi();
  nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
  const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
  nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
  const handle = handles.readBigUInt64LE(0);

  const w = nvapi.writeVfOffset(nv, handle, point, offsetMhz * 1000);
  const back = nvapi.readVfOffsets(nv, handle);
  fs.mkdirSync(WATCHDOG_DIR, { recursive: true });
  fs.writeFileSync(DRILL_MARKER, `${JSON.stringify({
    pid: process.pid, point, offsetMhz,
    writeOk: w.ok, readBackKhz: back.ok ? back.offsets[point] : null,
    nonZero: back.ok ? back.nonZero : null,
    at: localIso(nowMs()),
  }, null, 2)}\n`);

  process.exit(0);      // no disarm, no finally, no goodbye — exactly like a crash
}

/**
 * THE DRILL. Spawn the victim, let it die holding the card, and watch the guard put the card back.
 *
 * Safe by construction: the offset is NEGATIVE (the card runs slower at the same voltage), and if the
 * guard fails the drill itself resets the card at the end. A rehearsal that could leave the card
 * modified would be a strange thing to rehearse.
 */
export async function drill({ point = 110, offsetMhz = -20, timeoutMs = 30_000 } = {}) {
  const nvapi = await import('./nvapi.mjs');
  const out = { blocks: [], point, offsetMhz };
  const check = (name, ok, detail = '') => out.blocks.push({ name, ok, detail });

  const openCard = () => {
    const nv = nvapi.openNvapi();
    nv.koffi.call(nv.resolve(0x0150E828).ptr, nv.protos.Initialize);
    const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
    nv.koffi.call(nv.resolve(0xE5AC921F).ptr, nv.protos.EnumPhysicalGPUs, handles, count);
    return { nv, handle: handles.readBigUInt64LE(0) };
  };
  const readNonZero = () => {
    const { nv, handle } = openCard();
    try { const r = nvapi.readVfOffsets(nv, handle); return r.ok ? r.nonZero : -1; }
    finally { nv.koffi.call(nv.resolve(0xD22BDD7E).ptr, nv.protos.Unload); }
  };

  try { fs.unlinkSync(DRILL_MARKER); } catch { /* ignore */ }
  clearArmed();
  const firesBefore = new Set(fs.existsSync(WATCHDOG_DIR)
    ? fs.readdirSync(WATCHDOG_DIR).filter((f) => f.startsWith('fired-')) : []);

  check('старт: карта чистая, сторож не взведён', readNonZero() === 0 && readArmed() === null);

  // --- the victim, in its own process so its death is real
  const victim = spawn(process.execPath, [HERE, '--drill-victim', String(point), String(offsetMhz)], {
    stdio: 'ignore', windowsHide: true, cwd: ROOT,
  });
  const victimPid = victim.pid;
  await new Promise((resolve) => victim.on('exit', resolve));

  const marker = (() => { try { return JSON.parse(fs.readFileSync(DRILL_MARKER, 'utf8')); } catch { return null; } })();
  check('жертва РЕАЛЬНО изменила карту и умерла, не сняв сторожа',
    Boolean(marker) && marker.writeOk && marker.readBackKhz === offsetMhz * 1000,
    marker ? `pid ${marker.pid} записал ${marker.readBackKhz} кГц в точку ${marker.point}, ненулевых ${marker.nonZero}` : 'маркер жертвы не найден');
  check('процесс жертвы действительно мёртв', pidAlive(victimPid) === false, `pid ${victimPid}`);

  // --- now watch the guard do its job
  const startedAt = nowMs();
  let restoredAfterMs = null;
  while (nowMs() - startedAt < timeoutMs) {
    if (readNonZero() === 0) { restoredAfterMs = nowMs() - startedAt; break; }
    await sleep(250);
  }
  check('СТОРОЖ ВЕРНУЛ КАРТУ САМ, без единого нашего вызова',
    restoredAfterMs !== null,
    restoredAfterMs !== null ? `за ${(restoredAfterMs / 1000).toFixed(1)} с` : `не вернул за ${timeoutMs / 1000} с`);
  check('сторож снял запись за собой', readArmed() === null);

  // The report must be THIS drill's, not merely "a report exists". The first version of this block
  // asked only whether the directory was non-empty — and it was, from unrelated runs, so it would have
  // stayed green with a completely mute guard (EXP-0016: a fixture a neighbouring rule also catches).
  //
  // And it must WAIT for it. The guard's contract is: clear the record -> reset -> report. The drill
  // notices restoration by watching the CURVE offsets, which the reset zeroes FIRST, so it can see a
  // clean card seconds before the guard has finished the NVML and `nvidia-smi` halves and written its
  // report. Checking instantly measured that gap, not the guard.
  const freshMine = () => (fs.existsSync(WATCHDOG_DIR) ? fs.readdirSync(WATCHDOG_DIR) : [])
    .filter((f) => f.startsWith('fired-') && !firesBefore.has(f))
    .map((f) => { try { return { f, r: JSON.parse(fs.readFileSync(path.join(WATCHDOG_DIR, f), 'utf8')) }; } catch { return null; } })
    .filter((x) => x && x.r.armedFor?.includes('учебная тревога'));

  let mine = freshMine();
  const reportDeadline = nowMs() + 20_000;
  while (mine.length === 0 && nowMs() < reportDeadline) {
    await sleep(250);
    mine = freshMine();
  }
  check('сторож оставил отчёт ИМЕННО ОБ ЭТОЙ тревоге',
    mine.length > 0,
    mine.length ? `${mine[mine.length - 1].f} — «${mine[mine.length - 1].r.armedFor}», ${mine[mine.length - 1].r.verdict}`
      : 'за 20 с отчёт об этой тревоге не появился');

  // --- belt and braces: whatever happened above, the card leaves this function at stock
  if (readNonZero() !== 0) await resetCardToFactory({});
  check('итог: карта чистая', readNonZero() === 0);

  return out;
}

// =================================================================================================
// 9. CLI
// =================================================================================================

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--guard')) {
    const r = await guardLoop({ log: () => {} });
    return r.fired ? 0 : 0;                    // a guard that was simply disarmed is not a failure
  }

  if (argv.includes('--drill-victim')) {
    const i = argv.indexOf('--drill-victim');
    await drillVictim({ point: Number(argv[i + 1] ?? 110), offsetMhz: Number(argv[i + 2] ?? -20) });
    return 0;                                   // unreachable: the victim exits inside
  }

  if (argv.includes('--selftest')) {
    const blocks = await selftest();
    for (const b of blocks) console.log(`  ${b.ok ? 'OK  ' : 'ПЛОХО'} ${b.name}${b.detail ? ` — ${b.detail}` : ''}`);
    const failed = blocks.filter((b) => !b.ok).length;
    console.log('');
    console.log(`САМОПРОВЕРКА СТОРОЖА: ${blocks.length} блоков, провалов ${failed}.`);
    return failed === 0 ? 0 : 1;
  }

  if (argv.includes('--status')) {
    const rec = readArmed();
    if (!rec) { console.log('СТОРОЖ НЕ ВЗВЕДЁН — ничего не держит карту.'); return 0; }
    const v = decide(rec, { now: nowMs() });
    console.log('СТОРОЖ ВЗВЕДЁН');
    console.log(`  что держит:   ${rec.what}`);
    console.log(`  взведён:      ${rec.armedAt}`);
    console.log(`  владелец:     pid ${rec.ownerPid} — ${pidAlive(rec.ownerPid) ? 'жив' : 'МЁРТВ'}`);
    console.log(`  до срока:     ${Math.round((rec.deadlineMs - nowMs()) / 1000)} с`);
    console.log(`  вердикт:      ${v.verdict}${v.detail ? ` (${v.detail})` : ''}`);
    console.log(`  откат:        ${rec.undo}`);
    return 0;
  }

  if (argv.includes('--recover')) {
    const r = await recover({});
    if (!r.found) { console.log('ЗАБЫТЫХ ЗАПИСЕЙ НЕТ — предыдущий прогон закрылся чисто.'); return 0; }
    if (r.ownerAlive) {
      console.log(`ЗАПИСЬ ЕСТЬ, И ЕЁ ВЛАДЕЛЕЦ ЖИВ (pid ${r.record.ownerPid}) — не трогаю.`);
      console.log('Это не забытая запись, а идущая работа.');
      return 0;
    }
    console.log(`НАЙДЕНА ЗАБЫТАЯ ЗАПИСЬ: «${r.record.what}», владелец pid ${r.record.ownerPid} мёртв.`);
    console.log('Значит прошлый прогон умер, держа карту. Возвращаю карту к заводскому состоянию:');
    for (const s of r.reset.steps) console.log(`  ${s.ok ? 'OK  ' : 'ПЛОХО'} ${s.name} — ${s.detail}`);
    return r.reset.ok ? 0 : 1;
  }

  if (argv.includes('--drill')) {
    console.log('УЧЕБНАЯ ТРЕВОГА: жертва изменит карту и умрёт, не сняв сторожа.');
    console.log('  БЕЗОПАСНОСТЬ: сдвиг ОТРИЦАТЕЛЬНЫЙ (карта медленнее при том же напряжении),');
    console.log('  и если сторож не справится — сброс всё равно выполнит сам прогон в конце.');
    console.log('');
    const r = await drill({});
    for (const b of r.blocks) console.log(`  ${b.ok ? 'OK  ' : 'ПЛОХО'} ${b.name}${b.detail ? ` — ${b.detail}` : ''}`);
    const failed = r.blocks.filter((b) => !b.ok).length;
    console.log('');
    console.log(`УЧЕБНАЯ ТРЕВОГА: ${r.blocks.length} блоков, провалов ${failed}.`);
    return failed === 0 ? 0 : 1;
  }

  console.log('watchdog.mjs — сторож, возвращающий карту к заводскому состоянию, когда некому это сделать.');
  console.log('  --status     что взведено сейчас (только чтение)');
  console.log('  --recover    найти забытую запись и сбросить карту (ПИШЕТ)');
  console.log('  --drill      учебная тревога на живой карте (ПИШЕТ, откат гарантирован)');
  console.log('  --selftest   логика решения без карты');
  return 0;
}

export { realDeps };
export default { arm, decide, guardLoop, recover, resetCardToFactory, readArmed, clearArmed, pidAlive };

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(`ОШИБКА: ${e.message}`); process.exit(1); });
}
