#!/usr/bin/env node
// sweep-journal.mjs — THE WRITE-AHEAD JOURNAL OF THE SWEEP: a hang stops being a lost evening and
// becomes a verdict. `plans/15` §4.4.
//
// ─── WHY THIS FILE EXISTS, IN THE OWNER'S OWN WORDS ───────────────────────────────────────────────
//
// He settled it on 2026-08-15 (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»):
//
//   > *«зависание компа и перезагрузка — осознанный риск. Мы уже поняли, что не можем гарантировать,
//   > что комп не зависнет при поиске края.»*
//
// So a hang is not an accident this code hopes to avoid — it is a NORMAL PATH of the search, and the
// verdict `ЗАВИС` is first-class beside `SDC` and `CRASH`. What makes that executable is one property:
// **the intention is durable on disk BEFORE the card is touched.** A rung that hangs the machine kills
// the process with it, so nothing survives to write a verdict; the only record that can exist is the
// one written in advance. On 2026-08-14 the phase-5 store's last word was the PASS of the rung BEFORE
// the fatal one, and the next session would have walked straight back onto it (`bugs/07`).
//
// ─── WHY IT IS A SEPARATE FILE FROM `vmin-store.mjs` ──────────────────────────────────────────────
//
// They answer different questions and are keyed differently. The ratchet answers «what offset is this
// point still allowed» and is keyed by the phase-5 vocabulary; the journal answers «what was in flight
// when the machine died» and is keyed the way the owner settled the project speaks — by FREQUENCY and
// the VOLTAGE serving it (`GOAL.md` → «🔤 ТОЧЕК С НОМЕРАМИ НЕ СУЩЕСТВУЕТ»). One file holding two
// truths is how a session updates the side it sees and misses the other.
//
// ─── THE ONE EMERGENCY STOP THE OWNER LEFT IN PLACE ──────────────────────────────────────────────
//
// There is no ceiling on reboots — he removed it deliberately. What remains is: **two hangs in a row on
// the SAME rung stop the sweep.** That is not an edge, it is a fault, and repeating it is pointless.
//
// GPU WRITES: none. This module writes ONE file under `runs/sweep/` and reads it back.
//
// Usage:
//   npm run journal -- --selftest    the logic, sandboxed, no GPU
//
// [TESTED: 2026-08-15 23:2x, OFFLINE ONLY · 17 blocks in a sandboxed directory, with the PRODUCTION
//  journal photographed before and after (EXP-0025, `bugs/08`). Five mutations — 40 (append without
//  the fsync), 42 (infer a hang instead of closing it), 43 (count hangs cumulatively), 44 (treat a
//  truncated line as an orphan), 45 (take a bare path as the directory) — each reddening its own
//  blocks, addressees named before the run. The ORDER of «intent before the card» is proved in
//  `engine --selftest`, not here: only the rung knows when the card is touched.
//  **NOT TESTED: no sweep has ever run on the card, so this journal has never recorded a real hang.**]

import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

export const SWEEP_DIR = join(ROOT, 'runs', 'sweep');
const JOURNAL_FILE = 'journal.jsonl';

/**
 * The line kinds. An `intent` is a promise to touch the card; a `verdict` closes it; a `correction`
 * re-attributes a hang that was never the card's — see `writeCorrection` for why the third exists.
 */
export const LINE = Object.freeze({ INTENT: 'intent', VERDICT: 'verdict', CORRECTION: 'correction' });

/**
 * THE OUTCOME OF A RUNG AS THE JOURNAL RECORDS IT. `hung` is the one this module DERIVES rather than
 * receives: nobody is alive to report it, so it is inferred from an intent that never got its verdict.
 */
export const RUNG_OUTCOME = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
  VOID: 'void',
  HUNG: 'hung',
  // THE OPERATOR PRESSED STOP — and it is a SEPARATE outcome from `HUNG` for a reason the owner
  // stated as a question the code could not answer: *«ты ни разу не протестировал твою остановку?
  // И что это ЗАВИС напечатает!»* (2026-08-16).
  //
  // Until this existed, every death of the process read as «the card hung». So an operator's Ctrl+C
  // wrote a hang into the evidence store against a rung nobody had judged — and TWO stops on one
  // rung would have fired the single emergency brake the owner allows («две перезагрузки подряд на
  // ОДНОЙ ступени»), blocking a rung that was never even tested.
  //
  // ⚠️ WHAT MUST NOT CHANGE WITH IT: a process that dies WITHOUT writing this line is still a hang.
  // The trap suite's T5 kills a real process mid-rung and demands exactly that, and it stays the
  // proof that this addition narrowed nothing.
  STOPPED: 'operator-stop',
  // THE WRITER DIED OF ITS OWN SOFTWARE FAULT — the THIRD preimage of «no verdict was written»
  // (`bugs/20`). The inference `hung` is built on one world: a freeze hard enough to need the reset
  // button takes the process and the page cache with it, so no verdict CAN be written. That is true,
  // and it is the whole content of the inference — but «no verdict» is produced by three worlds, not
  // one, and only the FIRST of them genuinely cannot write:
  //
  //   the machine froze / was reset   → the process is gone with the OS   → `hung`, correct
  //   the operator pressed stop       → alive at the handler              → `operator-stop` (bugs/14)
  //   the writer threw and died       → ALIVE at the top-level handler    → this
  //
  // It fired for real on 2026-08-16: `bugs/19`'s EPERM killed the sweep, Windows kept running, the
  // card read clean seconds later — and the next launch printed «ЗАВИС: 2542 МГц / 895 мВ», i.e. a
  // measurement of silicon that nobody performed. Two such phantoms are on disk. The direction is
  // conservative (the ratchet only ever raises), which is why this is a defect and not an emergency —
  // but it is the false-`[TESTED]` class exactly, and it feeds the one emergency brake the owner left.
  //
  // ⚠️ WHAT MUST NOT CHANGE WITH IT, and it is the same line `operator-stop` had to hold: a process
  // that dies WITHOUT writing this is STILL a hang. This closes an intent only where the process
  // survived long enough to tell the truth.
  CRASHED: 'writer-crash',
});

/**
 * OPEN THE JOURNAL — and the argument is an OBJECT, exactly as `vmin-store.openStore` is, for exactly
 * the reason that cost this project its whole evidence store on 2026-08-14 (`bugs/08`, EXP-0025).
 *
 * A bare path destructures to nothing, the default takes over, and the "sandbox" silently IS the
 * production directory — a valid object pointing at the one place the parameter exists to avoid. The
 * type check is loud so that failure cannot be silent.
 *
 * [TESTED: 2026-08-15 23:2x · offline, by this module's 17-block suite; mutation-proved — see the
 *  module header for the addressees]
 */
export function openJournal(opts = {}) {
  if (typeof opts === 'string') {
    throw new TypeError('openJournal принимает ОБЪЕКТ: openJournal({ dir }). Строкой передан путь — '
      + 'это молча дало бы ПРОДАКШЕН-журнал вместо песочницы (так был потерян весь храповик 2026-08-14)');
  }
  const { dir = SWEEP_DIR } = opts;
  mkdirSync(dir, { recursive: true });
  return { dir, path: join(dir, JOURNAL_FILE) };
}

/** Refuse to delete the production journal — the same second guard `vmin-store` carries, and for the
 *  same incident. A teardown is the one place that deliberately deletes, so it is the one place that
 *  must be unable to delete the wrong thing. [TESTED: 2026-08-15 23:2x - offline, by this module's 17-block suite] */
export function assertSandbox(journal) {
  const dir = typeof journal === 'string' ? journal : journal?.dir;
  if (!dir) throw new TypeError('нечего проверять: журнал без каталога');
  if (resolve(dir) === resolve(SWEEP_DIR)) {
    throw new Error(`ОТКАЗ: это ПРОДАКШЕН-журнал (${dir}), его не удаляют. `
      + 'Песочница создаётся через mkdtempSync и передаётся как openJournal({ dir })');
  }
  return dir;
}

/** The rung's identity, in the owner's coordinates. Frequency and voltage, never a table index: the
 *  factory table slides along the FREQUENCY axis with temperature while the voltage axis stands still,
 *  so an index is a name and not an identity (EXP-0053, R14b). [TESTED: 2026-08-15 23:2x - offline, by this module's 17-block suite] */
export function rungKey({ frequencyMhz, voltageMv } = {}) {
  return `${frequencyMhz}/${voltageMv}`;
}

/**
 * APPEND ONE LINE, AND MAKE IT SURVIVE THE MACHINE DYING ON THE NEXT INSTRUCTION.
 *
 * `writeFileSync(..., 'a')` returns when the data reaches the OS page cache, NOT the platter. A hang
 * hard enough to need the reset button takes that cache with it, and the whole journal would then be
 * a file that is durable only when nothing went wrong — i.e. exactly never when it matters. So the
 * sequence is open → write → **fsync** → close, and the fsync is the point of the function.
 *
 * The `fs` seam is injected for one reason and it is not cosmetics: a block has to be able to prove
 * that the fsync happened BEFORE the card was touched (F2-AC4), and ordering is provable only by
 * recording the calls. `card-grids.writeJsonAtomic` already takes the same seam.
 *
 * @param {object} journal  from `openJournal`
 * @param {object} record   the line; serialized with sorted keys so two runs diff cleanly
 * @param {object} [io]     `{ openSync, writeSync, fsyncSync, closeSync }` — injected in tests
 * @returns {object} the record as written
 *
 * [TESTED: 2026-08-15 23:2x · offline, by this module's 17-block suite; mutation-proved — see the
 *  module header for the addressees]
 */
export function appendLine(journal, record, io = {}) {
  const open = io.openSync ?? openSync;
  const write = io.writeSync ?? writeSync;
  const sync = io.fsyncSync ?? fsyncSync;
  const close = io.closeSync ?? closeSync;
  // Sorted keys: the journal is diffed between runs and read by eye after an incident; a stable field
  // order is what makes both possible (`AGENT_GUIDE.md` → canonical order for anything compared).
  const line = `${JSON.stringify(record, Object.keys(record).sort())}\n`;
  const fd = open(journal.path, 'a');
  try {
    write(fd, line);
    sync(fd);
  } finally {
    close(fd);
  }
  return record;
}

/**
 * THE PROMISE TO TOUCH THE CARD. Written, flushed and fsynced BEFORE the first byte reaches the GPU.
 *
 * Everything a post-mortem needs is in this line, because after a hang it is the ONLY line there is:
 * which frequency, which voltage, how deep, who held the ceiling, what shape was about to be written,
 * and whether the descent had been seeded there.
 *
 * @returns {object} the intent record, carrying the `seq` its verdict must quote
 *
 * [TESTED: 2026-08-15 23:2x · offline, by this module's 17-block suite; mutation-proved — see the
 *  module header for the addressees]
 */
export function writeIntent(journal, rung, io = {}) {
  const record = {
    state: LINE.INTENT,
    seq: rung.seq,
    at: rung.at ?? null,
    frequencyMhz: rung.frequencyMhz ?? null,
    voltageMv: rung.voltageMv ?? null,
    pointIndex: rung.pointIndex ?? null,
    deltaMhz: rung.deltaMhz ?? null,
    depthMv: rung.depthMv ?? null,
    zoneStepMv: rung.zoneStepMv ?? null,
    seeded: rung.seeded ?? false,
    holder: rung.holder ?? null,
    writeShape: rung.writeShape ?? null,
  };
  return appendLine(journal, record, io);
}

/** The line that CLOSES an intent. Fsynced too: a verdict lost to the page cache would make the next
 *  launch read a finished rung as the one that killed the machine — safe, but it would cost the sweep
 *  a rung it had already paid for, and on the second such loss it would block the rung outright.
 *  [TESTED: 2026-08-15 23:2x - offline, by this module's 17-block suite] */
export function writeVerdict(journal, closing, io = {}) {
  const record = {
    state: LINE.VERDICT,
    seq: closing.seq,
    at: closing.at ?? null,
    outcome: closing.outcome ?? null,
    verdict: closing.verdict ?? null,
    decidedBy: closing.decidedBy ?? null,
    servingMvAfter: closing.servingMvAfter ?? null,
    why: closing.why ?? '',
  };
  return appendLine(journal, record, io);
}

/** Read every line. A truncated final line means the writer died mid-append — which on this journal is
 *  an expected event, not a corruption: it is DROPPED and COUNTED, never silently treated as absent.
 *  [TESTED: 2026-08-15 23:2x - offline, by this module's 17-block suite] */
export function readJournal(journal) {
  if (!existsSync(journal.path)) return { records: [], truncated: 0 };
  const lines = readFileSync(journal.path, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const records = [];
  let truncated = 0;
  for (const l of lines) {
    try { records.push(JSON.parse(l)); } catch { truncated++; }
  }
  return { records, truncated };
}

/**
 * THE INTENTS NOBODY CLOSED — and this is the whole point of the file.
 *
 * An intent with no verdict is not a gap in the data. It is the ANSWER: that rung was in flight when
 * the process stopped existing, so that rung is what hung the machine. The owner's step 12, executed.
 *
 * A truncated final line is deliberately NOT treated as an orphan: it was dropped by `readJournal`,
 * and inventing a rung from an unparseable line would be forensics out of thin air.
 *
 * [TESTED: 2026-08-15 23:2x · offline, by this module's 17-block suite; mutation-proved — see the
 *  module header for the addressees]
 */
export function orphanIntents(records) {
  const closed = new Set(records.filter((r) => r?.state === LINE.VERDICT).map((r) => r.seq));
  return records.filter((r) => r?.state === LINE.INTENT && !closed.has(r.seq));
}

/**
 * ON LAUNCH: TURN EVERY ORPHAN INTO A RECORDED `ЗАВИС`, THEN CARRY ON.
 *
 * The closure is APPENDED rather than inferred each time, and that is what makes «two in a row»
 * countable at all: an orphan re-derived on every launch would be one event or a hundred depending on
 * how often someone ran the command. Closing it makes the journal say, once, what happened.
 *
 * @returns {Array} the rungs that were closed as hung, in the order they were found
 *
 * [TESTED: 2026-08-15 23:2x · offline, by this module's 17-block suite; mutation-proved — see the
 *  module header for the addressees]
 */
export function closeHangs(journal, { at = null, io = {} } = {}) {
  const { records } = readJournal(journal);
  const orphans = orphanIntents(records);
  for (const o of orphans) {
    writeVerdict(journal, {
      seq: o.seq,
      at,
      outcome: RUNG_OUTCOME.HUNG,
      verdict: config.VERDICT.HUNG,
      why: `НАМЕРЕНИЕ БЕЗ ВЕРДИКТА: ступень ${o.frequencyMhz} МГц / ${o.voltageMv} мВ была в полёте, когда `
        + 'прогон перестал существовать. Значит эта ступень и повесила машину — вердикт ЗАВИС, '
        + 'первого класса наравне с SDC и CRASH (слово владельца 2026-08-15)',
    }, io);
  }
  return orphans;
}

/**
 * THE OPERATOR STOPPED THE RUN — close what is in flight as a STOP, not as a hang. `bugs/14`.
 *
 * Called from the sweep's signal handler, BEFORE the process leaves. That timing is the whole design:
 * the journal's rule is «an intent with no verdict means the card hung», and it is a good rule — so
 * the only way to keep it true is for a deliberate stop to leave a verdict behind. Nothing here
 * infers anything; it writes what the operator did.
 *
 * ⚠️ **It does NOT weaken the hang path.** A process killed outright (`SIGKILL`, a real freeze, the
 * reset button) never reaches this function, its intent stays orphaned, and the next launch closes it
 * `ЗАВИС` exactly as before. The trap suite's T5 kills a real process and is what holds that line.
 *
 * Synchronous on purpose: a handler that awaits may never finish before the process exits, and a
 * half-written stop is worse than none — it would look like a hang with extra steps.
 *
 * @returns {Array} the intents closed, in the order found
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export function closeAsOperatorStop(journal, { at = null, signal = null, io = {} } = {}) {
  const { records } = readJournal(journal, io);
  const orphans = orphanIntents(records);
  for (const o of orphans) {
    writeVerdict(journal, {
      seq: o.seq,
      at,
      outcome: RUNG_OUTCOME.STOPPED,
      verdict: null,
      why: `ОСТАНОВЛЕНО ОПЕРАТОРОМ${signal ? ` (${signal})` : ''}: ступень ${o.frequencyMhz} МГц / `
        + `${o.voltageMv} мВ была в полёте, когда человек прекратил прогон. Это НЕ зависание и НЕ вердикт `
        + 'о напряжении — ступень не испытана и края не несёт. В аварийную остановку «два подряд» не считается',
    }, io);
  }
  return orphans;
}

/**
 * THE WRITER DIED OF ITS OWN FAULT — close what is in flight as OUR crash, not as the card hanging.
 * `bugs/20`.
 *
 * The sibling of `closeAsOperatorStop` above, and it exists for the same structural reason: the
 * journal's rule «an intent with no verdict means the card hung» is a GOOD rule, so every actor that
 * can leave an intent open without the card being at fault must close it itself. Each preimage is
 * shut at its own source; the inference keeps the one world it was actually built for.
 *
 * Called from the sweep's top-level catch AND from `uncaughtException` / `unhandledRejection`, which
 * is why it must be idempotent: `orphanIntents` returns nothing once the intents are closed, so a
 * second call is a no-op rather than a duplicate line.
 *
 * Synchronous on purpose, exactly as the operator-stop path is: a handler that awaits may never
 * finish before the process leaves, and a half-written closure looks like a hang with extra steps.
 *
 * ⚠️ **It does NOT weaken the hang path**, and that is the property mutation (c) exists to hold: a
 * process killed outright never reaches any handler, its intent stays orphaned, and the next launch
 * closes it `ЗАВИС` exactly as before.
 *
 * @returns {Array} the intents closed, in the order found
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export function closeAsWriterDeath(journal, { at = null, error = null, io = {} } = {}) {
  const { records } = readJournal(journal, io);
  const orphans = orphanIntents(records);
  // THE EXCEPTION IS NAMED, not summarised as «an error». A future session reading this line is
  // diagnosing OUR defect, and the class of the throw is the first thing it needs (`bugs/19` was
  // `EPERM: operation not permitted, rename` — the whole diagnosis is in those four words).
  const named = error === null ? 'причина не названа'
    : (error?.stack?.split('\n')[0] ?? error?.message ?? String(error));
  for (const o of orphans) {
    writeVerdict(journal, {
      seq: o.seq,
      at,
      outcome: RUNG_OUTCOME.CRASHED,
      verdict: null,
      why: `ПРОГОН УМЕР СВОЕЙ СМЕРТЬЮ, А НЕ ПО ВИНЕ КАРТЫ: ступень ${o.frequencyMhz} МГц / `
        + `${o.voltageMv} мВ была в полёте, когда писатель упал — ${named}. Это НЕ зависание машины `
        + 'и НЕ вердикт о напряжении: ступень не испытана, края не несёт, в аварийную остановку '
        + '«два подряд» не считается. Дефект наш, и чинить его надо там, где он брошен',
    }, io);
  }
  return orphans;
}

/**
 * WHAT A HANG MAY BE RE-ATTRIBUTED TO. Never to `HUNG` — and that asymmetry is the whole safety
 * property of the mechanism below, not a stylistic choice.
 *
 * A correction may only ever REMOVE a wall, because removing one costs a rung that gets burned again
 * under the owner's eye, while ADDING one would let a document be given an edge nobody measured —
 * the false-`[TESTED]` class this project hunts. So the vocabulary here is exactly the two outcomes
 * that mean «this death was not the silicon».
 */
export const CORRECTABLE_TO = Object.freeze([RUNG_OUTCOME.CRASHED, RUNG_OUTCOME.STOPPED]);

/**
 * RE-ATTRIBUTE A RECORDED HANG THAT WAS NEVER THE CARD'S — append-only, evidence mandatory.
 *
 * ─── WHY THIS EXISTS: TWO CORRECT RULES THAT DISABLED EACH OTHER ──────────────────────────────────
 *
 * `bugs/20` (2026-08-16) found that OUR OWN death — `bugs/19`'s EPERM, `bugs/21`'s tidy hook — was
 * being written down as «the card hung», and left two such phantoms on disk: **2542 MHz / 895 mV**
 * and **2775 MHz / 965 mV**. It fixed the WRITER (`closeAsWriterDeath` above) and prescribed the
 * remedy for the records already written: *«It must be re-measured rather than hand-edited —
 * `curve-store` is the document's only author (R14a)… let the run measure that frequency again.»*
 * That was right, and on 2542 MHz it worked: the resumed sweep re-walked it to 845 mV at 23:08 the
 * same evening.
 *
 * **Then R18 arrived the next day and made a recorded hang a WALL** (`bugs/23`): no rung may land on
 * or below a voltage a `ЗАВИС` names, and the seed is cancelled by it too. R18 is correct — it is
 * what stops a resumed run from walking back onto the rung that bugchecked the machine. But it
 * silently REVOKED `bugs/20`'s remedy: after R18 the phantom cannot be re-measured, because the
 * phantom itself forbids the descent that would re-measure it. Neither document mentions the other.
 *
 * The consequence is not theoretical. Asked for a plan over 2887…2700 MHz on 2026-08-22, the dry run
 * gave 2775 MHz exactly ONE rung and announced it would close as an EDGE at 990 mV — while its
 * measured neighbours sit at 970 (2782) and 965 (2767). That edge would be an inversion, and
 * `closePoint`'s monotonicity ratchet would then raise every frequency above it to 990 mV, deleting
 * measurements the same run had taken minutes earlier.
 *
 * ─── THE SHAPE, AND WHY IT IS THIS ONE ────────────────────────────────────────────────────────────
 *
 * **Append-only, never an edit.** The journal is the one artifact that survives a machine death, and
 * an agent editing evidence by hand is `bugs/08`. The original `ЗАВИС` line stays on disk, readable,
 * forever; this adds a line that says «that one was ours, and here is how we know».
 *
 * **One author for «what is a hang».** `hangFloors` and `blockedRungs` both consult `corrections()`;
 * neither derives the answer a second time. That is the same rule R14a states for the document and
 * R16a for the sweep — a pair that can be REMOVED beats a pair that must be watched.
 *
 * **It can only ever remove a wall** (`CORRECTABLE_TO`), and it refuses a seq that is not a hang —
 * so it cannot re-label a PASS, cannot invent a floor, and cannot reach a rung nobody attempted.
 *
 * **The evidence is a required field, not a courtesy.** A correction with no `why` would be exactly
 * the hand-edit this shape exists to avoid, one JSON line further out.
 *
 * ⚠️ **The boundary, named rather than left to be discovered:** there is no un-correction. If a
 * correction is itself wrong, the honest path is the same one `bugs/20` prescribed — let a run
 * measure that frequency again, which a lifted wall now permits. Building an undo would give the
 * journal two ways to say one thing.
 *
 * @param {object} journal from `openJournal`
 * @param {object} c `{ seq, outcome, why, correctedBy, at }`
 * @returns {object} the correction record as written
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export function writeCorrection(journal, { seq, outcome, why = '', correctedBy = null, at = null, io = {} } = {}) {
  if (!Number.isInteger(seq)) {
    throw new TypeError('ПОПРАВКА БЕЗ НОМЕРА СТУПЕНИ: seq обязателен и должен быть целым — '
      + 'поправка адресует одну конкретную запись журнала, а не «похожие»');
  }
  if (!CORRECTABLE_TO.includes(outcome)) {
    throw new TypeError(`ПОПРАВКА МОЖЕТ ТОЛЬКО СНЯТЬ СТЕНУ, а не поставить: outcome «${outcome}» вне `
      + `словаря ${CORRECTABLE_TO.join(' · ')}. Поставить полом можно только измерением, а не строкой`);
  }
  if (typeof why !== 'string' || why.trim() === '') {
    throw new TypeError('ПОПРАВКА БЕЗ УЛИКИ — это правка улик руками одной строкой ниже (bugs/08): '
      + 'поле why обязано называть, ПОЧЕМУ эта смерть была наша, а не карты');
  }
  // The target must BE a hang right now — both preimages, through the same two sources `hangFloors`
  // reads. A correction aimed at a PASS, or at a rung nobody attempted, is a defect in the caller and
  // must not reach the file: on disk it would look exactly like a legitimate one.
  const { records } = readJournal(journal, io);
  const isClosedHang = records.some((r) => r?.state === LINE.VERDICT && r.seq === seq
    && r.outcome === RUNG_OUTCOME.HUNG);
  const isOrphan = orphanIntents(records).some((o) => o.seq === seq);
  if (!isClosedHang && !isOrphan) {
    throw new Error(`ПОПРАВЛЯТЬ НЕЧЕГО: ступень ${seq} не является зависанием — ни закрытым вердиктом `
      + 'ЗАВИС, ни осиротевшим намерением. Поправка снимает стену; там, где стены нет, она бы '
      + 'молча переписала чужую запись');
  }
  const intent = records.find((r) => r?.state === LINE.INTENT && r.seq === seq) ?? null;
  return appendLine(journal, {
    state: LINE.CORRECTION,
    seq,
    at,
    outcome,
    correctedBy,
    frequencyMhz: intent?.frequencyMhz ?? null,
    voltageMv: intent?.voltageMv ?? null,
    why,
  }, io);
}

/**
 * WHICH RECORDED HANGS HAVE BEEN RE-ATTRIBUTED — the single author of that answer.
 *
 * Idempotent by construction: two corrections of one `seq` mean the same thing as one, so there is no
 * «latest wins» ordering rule to get wrong. A `Map` keyed by `seq` carries the FIRST one, because the
 * first is the one that made the decision and the rest are noise.
 *
 * @returns {Map<number, object>} keyed by the corrected `seq`
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export function corrections(records) {
  const out = new Map();
  for (const r of records) {
    if (r?.state !== LINE.CORRECTION) continue;
    if (!Number.isInteger(r.seq)) continue;
    if (!CORRECTABLE_TO.includes(r.outcome)) continue;   // a malformed line decides nothing
    if (!out.has(r.seq)) out.set(r.seq, r);
  }
  return out;
}

/**
 * WHAT HAPPENED AT EACH RUNG, IN ORDER — the join between intents and their verdicts.
 *
 * @returns {Map<string, Array<{seq, outcome, frequencyMhz, voltageMv}>>}
 *
 * [TESTED: 2026-08-15 23:2x · offline, by this module's 17-block suite; mutation-proved — see the
 *  module header for the addressees]
 */
export function attributions(records) {
  const intents = new Map(records.filter((r) => r?.state === LINE.INTENT).map((r) => [r.seq, r]));
  const byRung = new Map();
  for (const v of records.filter((r) => r?.state === LINE.VERDICT)) {
    const i = intents.get(v.seq);
    if (!i) continue;                       // a verdict whose intent is missing describes no rung
    const key = rungKey(i);
    if (!byRung.has(key)) byRung.set(key, []);
    byRung.get(key).push({
      seq: v.seq, outcome: v.outcome ?? null,
      frequencyMhz: i.frequencyMhz, voltageMv: i.voltageMv,
    });
  }
  // Ordered by `seq`, which is the order the rungs were attempted — «consecutive» below means
  // consecutive IN TIME at that rung, and a Map's insertion order would not guarantee it.
  for (const list of byRung.values()) list.sort((a, b) => a.seq - b.seq);
  return byRung;
}

/**
 * WHAT VOLTAGE HAS ALREADY HUNG THIS FREQUENCY — the floor a later descent may never step onto again.
 * `bugs/23`.
 *
 * The owner made `ЗАВИС` a verdict of the FIRST CLASS (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»),
 * *«…записывается в документ кривой как причина, по которой точка встала на своё значение»*. Until
 * this existed the verdict reached the journal and stopped there: `blockedRungs` engages only after
 * **two consecutive** hangs, so a resumed run rebuilt the same ladder and walked back down onto the
 * rung that had killed the machine. Measured on 2026-08-16: 2842 MHz hung at 845 mV, and nothing in
 * the stack would have stopped the next launch from ordering 845 mV again.
 *
 * **The HIGHEST hung voltage is the binding one, and that is not arbitrary.** Voltage descends, so a
 * rung deeper than a known hang is at least as dangerous; the shallowest failure is therefore the
 * whole constraint. Two hangs at 860 and 845 leave a floor of 860.
 *
 * ⚠️ **Only genuine hangs count.** `writer-crash` and `operator-stop` are excluded by construction —
 * they are OUR death and the operator's decision, and neither says anything about the silicon
 * (`bugs/20`, `bugs/14`). Feeding them in here would ratchet a frequency upward for a reason that
 * was never measured, which is exactly the false-`[TESTED]` class this project hunts.
 *
 * ⚠️ **And a hang RE-ATTRIBUTED by a correction is excluded for the same reason** (`writeCorrection`).
 * The exclusion above protects records closed correctly at the time; a correction is how a record
 * closed WRONGLY — before `bugs/20`'s fix existed — stops being a wall. Both preimages are filtered
 * here, at the one place that decides what a floor is.
 *
 * ─── TWO SOURCES, ONE MEANING: A CLOSED `ЗАВИС` AND AN INTENT NOBODY CLOSED ────────────────────────
 *
 * A recorded `ЗАВИС` verdict is a hang somebody has written down; an ORPHAN INTENT is the same hang
 * before anybody has (R15b — *«an intent with no verdict IS the answer»*). Counting only the first
 * would make the floor depend on whether a launch happened to run `closeHangs` yet — and the one
 * reader that must NOT write is the dry run, which is precisely the artifact the operator reads
 * BEFORE authorising the card (rail S2). A wall the plan cannot print is a wall the operator meets
 * mid-run. So both are read here, through the SAME `orphanIntents` the closure uses — one author,
 * never a second derivation of «what is a hang».
 *
 * The two sources cannot double-count: closing an orphan removes it from `orphanIntents` and adds
 * the identical rung on the verdict side, so the answer is the same before and after the closure.
 *
 * ⚠️ **Read this ONCE, before the run's own intents start landing.** Inside a live sweep the rung in
 * flight is an orphan by construction, and re-reading the journal mid-run would read it as its own
 * hang floor. `sweepRange` calls `resumeState` exactly once, before the first rung, for this reason.
 *
 * @returns {Map<number, {voltageMv:number, seq:number, at:string|null}>} keyed by frequency
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export function hangFloors(records) {
  const out = new Map();
  const intents = new Map(records.filter((r) => r?.state === LINE.INTENT).map((r) => [r.seq, r]));
  const fixed = corrections(records);
  const hung = [
    ...records
      .filter((r) => r?.state === LINE.VERDICT && r.outcome === RUNG_OUTCOME.HUNG)
      .map((v) => ({ rung: intents.get(v.seq), seq: v.seq, at: v.at ?? null })),
    ...orphanIntents(records).map((i) => ({ rung: i, seq: i.seq, at: i.at ?? null })),
  ].filter((h) => !fixed.has(h.seq));
  for (const { rung: i, seq, at } of hung) {
    if (!i || !Number.isFinite(i.frequencyMhz) || !Number.isFinite(i.voltageMv)) continue;
    const seen = out.get(i.frequencyMhz);
    if (!seen || i.voltageMv > seen.voltageMv) {
      out.set(i.frequencyMhz, { voltageMv: i.voltageMv, seq, at });
    }
  }
  return out;
}

/**
 * THE ONLY EMERGENCY STOP THE OWNER LEFT — two hangs in a row on ONE rung (F2-AC5).
 *
 *   > *«Единственная аварийная остановка: две перезагрузки подряд на ОДНОЙ И ТОЙ ЖЕ ступени. Это уже
 *   > не край, а поломка, и повторять её бессмысленно.»*
 *
 * **CONSECUTIVE, not cumulative.** A rung that hung, then ran cleanly, then hung again is a
 * probabilistic edge — this card has shown one (fact 28) — and blocking it would delete a real
 * observation. What is a fault is the same rung killing the machine twice with nothing in between.
 *
 * ⚠️ **A RE-ATTRIBUTED HANG IS DROPPED FROM THE SEQUENCE, not re-labelled in place** — `bugs/20`'s
 * fix plan, item 3: our own death «must NOT count toward the two-consecutive brake. It is not a card
 * event.» Dropping is deliberately the direction that keeps the brake STRONGER: leaving the record in
 * place with a non-hang outcome would break the adjacency of two genuine hangs that happened to have
 * one of our crashes between them, and a rung that really killed the machine twice would go unbraked.
 *
 * @returns {Array<{key, frequencyMhz, voltageMv, why}>}
 *
 * [TESTED: 2026-08-15 23:2x · offline, by this module's 17-block suite; mutation-proved — see the
 *  module header for the addressees]
 */
export function blockedRungs(records) {
  const out = [];
  const fixed = corrections(records);
  for (const [key, list] of attributions(records)) {
    const tail = list.filter((a) => !fixed.has(a.seq)).slice(-2);
    if (tail.length === 2 && tail.every((a) => a.outcome === RUNG_OUTCOME.HUNG)) {
      out.push({
        key,
        frequencyMhz: tail[0].frequencyMhz,
        voltageMv: tail[0].voltageMv,
        why: `ДВА ЗАВИСАНИЯ ПОДРЯД на ступени ${tail[0].frequencyMhz} МГц / ${tail[0].voltageMv} мВ `
          + '(попытки ' + tail.map((a) => a.seq).join(' и ') + '). Это не край, а поломка: '
          + 'край даёт вердикт оракула, а поломка повторяется. Развёртка эту ступень третий раз не начинает',
      });
    }
  }
  return out;
}

/**
 * WHAT A RE-LAUNCH NEEDS TO KNOW, in one call: what hung, what is blocked, and where to carry on.
 *
 * Resume is a COMMAND, not a scheduled task — the owner is at the machine and reboots it himself
 * (`GOAL.md` → «🧑‍💻 ЧЕЛОВЕК ЗА МАШИНОЙ»), so nothing is installed into the boot path. This function
 * is what the command reads.
 *
 * [TESTED: 2026-08-15 23:2x · offline, by this module's 17-block suite; mutation-proved — see the
 *  module header for the addressees]
 */
export function resumeState(journal, { at = null, io = {} } = {}) {
  const hung = closeHangs(journal, { at, io });
  const { records, truncated } = readJournal(journal);
  const blocked = blockedRungs(records);
  const seqs = records.map((r) => r?.seq).filter(Number.isFinite);
  return {
    hung,
    // EVERY hang this journal has ever recorded, not only the ones this launch closed (`bugs/23`).
    // `hung` above is the orphans closed a moment ago; a hang from an EARLIER launch is already
    // closed and would be invisible here — and it constrains the descent exactly as much.
    floors: hangFloors(records),
    blocked,
    truncated,
    nextSeq: seqs.length ? Math.max(...seqs) + 1 : 1,
    attempted: attributions(records).size,
  };
}

// =================================================================================================
// Selftest — sandboxed, and it ASSERTS the production journal did not grow (EXP-0025, `bugs/08`)
// =================================================================================================

/**
 * MUTATION ADDRESSEES, NAMED BEFORE THE RUN (EXP-0016):
 *  40. append without the fsync                     → «намерение на диске ДО обращения к карте: fsync вызван»
 *      (and its sibling «порядок ровно тот, что обещан» — one break, two blocks, both by their own reason)
 *  42. infer a hang instead of CLOSING it           → «зависание ЗАКРЫВАЕТСЯ строкой, иначе его не сосчитать»
 *  43. count hangs cumulatively, not consecutively  → «через успешный прогон это ВЕРОЯТНОСТНЫЙ край»
 *  44. treat a truncated line as an orphan intent   → «обрезанная строка СЧИТАЕТСЯ, но ступени из неё не выдумывают»
 *  45. take a bare path as the journal directory    → «путь строкой — громкий отказ, а не молчаливый продакшен»
 *
 * 41 IS DELIBERATELY ABSENT, and saying so beats a gap a future session reads as a lost mutation: the
 * addressee «write the intent AFTER the card is touched» cannot be applied HERE, because this module
 * does not know what a card is. It lives where the ordering does — `engine.runRung`, addressee 46.
 */
export function selfTest() {
  const results = [];
  const ok = (what, got, want) => results.push({ ok: JSON.stringify(got) === JSON.stringify(want), what, got, want });

  // THE PRODUCTION JOURNAL IS PHOTOGRAPHED BEFORE AND AFTER. A suite that fabricates forensics in the
  // real directory leaves a future session unable to tell an invented hang from a measured one
  // (EXP-0025) — and the teardown that deletes the wrong directory is `bugs/08` itself.
  const prodBefore = existsSync(SWEEP_DIR) ? readdirSync(SWEEP_DIR).length : -1;
  const sandbox = mkdtempSync(join(tmpdir(), 'kago-journal-'));

  try {
    // — the loud refusal that `bugs/08` bought
    let threw = false;
    try { openJournal(sandbox); } catch { threw = true; }
    ok('путь СТРОКОЙ — громкий отказ, а не молчаливый продакшен', threw, true);
    let sandboxThrew = false;
    try { assertSandbox({ dir: SWEEP_DIR }); } catch { sandboxThrew = true; }
    ok('и продакшен-журнал удалить нельзя даже намеренно', sandboxThrew, true);

    // — F2-AC4: THE INTENT IS DURABLE BEFORE THE CARD IS TOUCHED, and the ORDER is what is asserted.
    //   An injected io records the call sequence; an injected «card» appends its own marker at the
    //   moment it would be written to. The block reads the sequence, not the outcome.
    const j1 = openJournal({ dir: join(sandbox, 'ordering') });
    const trace = [];
    const io = {
      openSync: (p, f) => { trace.push('open'); return openSync(p, f); },
      writeSync: (fd, s) => { trace.push('write'); return writeSync(fd, s); },
      fsyncSync: (fd) => { trace.push('fsync'); return fsyncSync(fd); },
      closeSync: (fd) => { trace.push('close'); return closeSync(fd); },
    };
    writeIntent(j1, { seq: 1, frequencyMhz: 2842, voltageMv: 1000, pointIndex: 90, deltaMhz: 142, depthMv: 45, holder: 'кривая', writeShape: 'raise-and-cap' }, io);
    trace.push('КАРТА');                       // the first byte to the GPU would happen here
    ok('намерение на диске ДО обращения к карте: fsync вызван, и вызван раньше',
      [trace.includes('fsync'), trace.indexOf('fsync') < trace.indexOf('КАРТА')], [true, true]);
    ok('порядок ровно тот, что обещан: открыть → записать → fsync → закрыть → и только потом карта',
      trace, ['open', 'write', 'fsync', 'close', 'КАРТА']);
    ok('и намерение действительно ЛЕЖИТ на диске, а не только в отчёте',
      readJournal(j1).records.map((r) => [r.state, r.frequencyMhz, r.voltageMv]), [['intent', 2842, 1000]]);

    // — an intent with no verdict IS the answer
    ok('намерение без вердикта — это и есть ответ, кто повесил машину',
      orphanIntents(readJournal(j1).records).map((r) => rungKey(r)), ['2842/1000']);
    const hung = closeHangs(j1, { at: '2026-08-15T23:10:00+03:00' });
    ok('зависание ЗАКРЫВАЕТСЯ строкой, иначе его не сосчитать',
      [hung.length, readJournal(j1).records.filter((r) => r.state === 'verdict').length], [1, 1]);
    // `?.` and a spoken fallback rather than a bare `.verdict`: a block that THROWS takes the whole
    // report with it and a mutation then reads as «the suite did not complete» instead of naming what
    // broke (EXP-0040 — assertions must not kill the reporter). Measured here: mutation 42 crashed
    // this line before the fallback existed.
    ok('и закрытая ступень несёт вердикт ЗАВИС словом владельца',
      readJournal(j1).records.find((r) => r.state === 'verdict')?.verdict ?? 'строки вердикта нет вовсе',
      config.VERDICT.HUNG);
    ok('повторный запуск НЕ считает то же зависание заново',
      closeHangs(j1, { at: '2026-08-15T23:11:00+03:00' }).length, 0);

    // — F2-AC5: two in a row is a FAULT; two with a clean run between them is a probabilistic edge
    const j2 = openJournal({ dir: join(sandbox, 'twice') });
    const rung = { frequencyMhz: 2400, voltageMv: 880, pointIndex: 70 };
    writeIntent(j2, { ...rung, seq: 1 }); closeHangs(j2, {});
    ok('одно зависание развёртку НЕ останавливает', blockedRungs(readJournal(j2).records).length, 0);
    writeIntent(j2, { ...rung, seq: 2 }); closeHangs(j2, {});
    ok('ДВА ПОДРЯД на одной ступени — поломка, и развёртка эту ступень больше не начинает',
      blockedRungs(readJournal(j2).records).map((b) => [b.frequencyMhz, b.voltageMv]), [[2400, 880]]);
    ok('и отказ называет, что это НЕ край',
      /не край, а поломка/.test(blockedRungs(readJournal(j2).records)[0]?.why ?? ''), true);

    const j3 = openJournal({ dir: join(sandbox, 'probabilistic') });
    writeIntent(j3, { ...rung, seq: 1 }); closeHangs(j3, {});
    writeIntent(j3, { ...rung, seq: 2 });
    writeVerdict(j3, { seq: 2, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS });
    writeIntent(j3, { ...rung, seq: 3 }); closeHangs(j3, {});
    ok('через успешный прогон это ВЕРОЯТНОСТНЫЙ край, а не поломка — считаем ПОДРЯД, а не всего',
      blockedRungs(readJournal(j3).records).length, 0);

    // — a truncated final line: counted, never turned into a rung nobody recorded
    const j4 = openJournal({ dir: join(sandbox, 'truncated') });
    writeIntent(j4, { seq: 1, frequencyMhz: 2842, voltageMv: 1000 });
    writeFileSync(j4.path, '{"state":"intent","seq":2,"frequ', { encoding: 'utf8', flag: 'a' });
    const t = readJournal(j4);
    ok('обрезанная строка СЧИТАЕТСЯ, но ступени из неё не выдумывают',
      [t.truncated, t.records.length, orphanIntents(t.records).length], [1, 1, 1]);

    // — resume tells the command everything it needs in one call
    const state = resumeState(j4, { at: '2026-08-15T23:12:00+03:00' });
    ok('возобновление — ОДИН вызов: что повисло, что заблокировано, с какого номера продолжать',
      [state.hung.length, state.blocked.length, state.nextSeq, state.truncated], [1, 0, 2, 1]);

    // — the journal speaks the owner's coordinates: frequency and voltage, never a table index
    ok('ключ ступени — ЧАСТОТА и НАПРЯЖЕНИЕ, а не индекс записи таблицы',
      rungKey({ frequencyMhz: 2842, voltageMv: 1000, pointIndex: 90 }), '2842/1000');

    // ─── СВОЯ СМЕРТЬ ПИСАТЕЛЯ — НЕ ЗАВИСАНИЕ КАРТЫ (`bugs/20`) ────────────────────────────────
    //
    // Третий прообраз «вердикта не написано»: процесс ЖИВ у обработчика верхнего уровня, значит
    // может сказать правду — и обязан. 2026-08-16 не сказал, и в документ уехали два выдуманных
    // отказа (2542 МГц / 895 мВ и 2775 МГц / 965 мВ), то есть замер кремния, которого никто не делал.
    //
    // ⚠️ Всюду `?.` и проговорённая заглушка: утверждение, разыменовывающее ровно то, что убирает
    // мутация, БРОСАЕТ вместо покраснения и уносит весь отчёт (EXP-0075, шесть страйков).
    const j5 = openJournal({ dir: join(sandbox, 'writer-death') });
    writeIntent(j5, { ...rung, seq: 1 });
    const died = closeAsWriterDeath(j5, {
      at: '2026-08-16T17:05:00+03:00',
      error: new Error('EPERM: operation not permitted, rename'),
    });
    ok('СВОЯ СМЕРТЬ ЗАКРЫВАЕТ НАМЕРЕНИЕ САМА — иначе следующий запуск припишет её карте',
      [died.length, orphanIntents(readJournal(j5).records).length], [1, 0]);
    const dv = readJournal(j5).records.find((r) => r.state === 'verdict');
    ok('и исход НЕ «завис»: у ступени свой класс, потому что виноват НЕ кремний',
      dv?.outcome ?? 'строки вердикта нет вовсе', RUNG_OUTCOME.CRASHED);
    //   ⚠️ СРАВНЕНИЕ НЕ ЧЕРЕЗ `?? заглушка`: `null ?? x` возвращает x, то есть такое утверждение не
    //   отличает «поля нет» от «поле пустое» и зелено в обоих случаях. Заглушка нужна только на
    //   случай отсутствия САМОЙ СТРОКИ, а пустоту поля проверяем нестрогим сравнением.
    ok('вердикта о напряжении при этом НЕТ — ступень не испытана',
      dv === undefined ? 'строки вердикта нет вовсе' : (dv.verdict == null), true);
    //   ИСКЛЮЧЕНИЕ НАЗВАНО. Диагноз `bugs/19` целиком помещался в четыре слова его сообщения;
    //   строка, говорящая «упал с ошибкой», стоила бы следующей сессии отдельного расследования.
    ok('ПРИЧИНА НАЗВАНА ДОСЛОВНО, а не сведена к «упал с ошибкой»',
      /EPERM: operation not permitted, rename/.test(dv?.why ?? 'строки вердикта нет вовсе'), true);
    //   И ГЛАВНОЕ, РАДИ ЧЕГО ОТДЕЛЬНЫЙ КЛАСС: единственный аварийный тормоз владельца считает
    //   ТОЛЬКО настоящие зависания. Кормить его нашими падениями значило бы блокировать здоровую
    //   ступень на здоровой карте.
    const j6 = openJournal({ dir: join(sandbox, 'crash-twice') });
    writeIntent(j6, { ...rung, seq: 1 });
    closeAsWriterDeath(j6, { at: '2026-08-16T17:05:00+03:00', error: new Error('раз') });
    writeIntent(j6, { ...rung, seq: 2 });
    closeAsWriterDeath(j6, { at: '2026-08-16T17:06:00+03:00', error: new Error('два') });
    ok('ДВЕ СВОИ СМЕРТИ ПОДРЯД НЕ БЛОКИРУЮТ СТУПЕНЬ — тормоз только за настоящие зависания',
      blockedRungs(readJournal(j6).records).length, 0);
    //   ⚠️ И ТО, ЧТО ЭТА ПРАВКА НЕ ИМЕЛА ПРАВА СУЗИТЬ: процесс, убитый наотмашь, не доходит ни до
    //   какого обработчика, его намерение остаётся сиротой, и следующий запуск закрывает его ЗАВИС.
    const j7 = openJournal({ dir: join(sandbox, 'still-hangs') });
    writeIntent(j7, { ...rung, seq: 1 });
    const stillHung = closeHangs(j7, { at: '2026-08-16T17:07:00+03:00' });
    ok('НАСТОЯЩЕЕ ЗАВИСАНИЕ ПО-ПРЕЖНЕМУ ЗАВИС: правка закрыла свой прообраз, а не чужой',
      [stillHung.length, readJournal(j7).records.find((r) => r.state === 'verdict')?.outcome ?? 'строки нет'],
      [1, RUNG_OUTCOME.HUNG]);
    //   ИДЕМПОТЕНТНОСТЬ: зовётся и из catch, и из uncaughtException — второй вызов обязан быть
    //   пустым, иначе одна смерть напишет две строки и исказит счёт.
    const again = closeAsWriterDeath(j5, { at: '2026-08-16T17:08:00+03:00', error: new Error('снова') });
    ok('ПОВТОРНЫЙ ВЫЗОВ ПУСТ: одна смерть — одна строка, сколько бы обработчиков её ни поймало',
      [again.length, readJournal(j5).records.filter((r) => r.state === 'verdict').length], [0, 1]);

    // ─── ПОЛ ЗАВИСАНИЯ: КАКОЕ НАПРЯЖЕНИЕ УЖЕ ВЕШАЛО ЭТУ ЧАСТОТУ (`bugs/23`) ────────────────────────
    //
    // 2026-08-16 живая карта повисла на 2842 МГц / 845 мВ, и НИЧТО не помешало бы следующему запуску
    // заказать 845 мВ снова: блокировка ступени включается только после ДВУХ зависаний подряд.
    // Эта функция — половина лечения (вторая, потребление пола спуском, — задача следующей сессии).
    const j8 = openJournal({ dir: join(sandbox, 'hang-floor') });
    writeIntent(j8, { seq: 1, frequencyMhz: 2842, voltageMv: 845, pointIndex: 63 });
    closeHangs(j8, { at: '2026-08-16T23:40:00+03:00' });
    const f1 = hangFloors(readJournal(j8).records);
    ok('ЗАВИСШЕЕ НАПРЯЖЕНИЕ ЗАПОМНЕНО ПРОТИВ СВОЕЙ ЧАСТОТЫ',
      f1.get(2842)?.voltageMv ?? 'частоты в полу нет вовсе', 845);
    //   САМОЕ ВЫСОКОЕ ЗАВИСШЕЕ И ЕСТЬ ПОЛ: напряжение ниже уже известного зависания заведомо не легче,
    //   поэтому связывает САМЫЙ МЕЛКИЙ отказ, а не самый глубокий.
    writeIntent(j8, { seq: 2, frequencyMhz: 2842, voltageMv: 860, pointIndex: 65 });
    closeHangs(j8, { at: '2026-08-16T23:41:00+03:00' });
    ok('ПОЛ — САМОЕ ВЫСОКОЕ ЗАВИСШЕЕ, а не последнее и не самое глубокое',
      hangFloors(readJournal(j8).records).get(2842)?.voltageMv ?? 'частоты в полу нет вовсе', 860);
    //   ⚠️ И СЧИТАЮТСЯ ТОЛЬКО НАСТОЯЩИЕ ЗАВИСАНИЯ. Своя смерть писателя и останов оператора — не
    //   свойство кремния (`bugs/20`, `bugs/14`); пустить их сюда значило бы поднять частоту храповиком
    //   по причине, которой никто не мерил.
    const j9 = openJournal({ dir: join(sandbox, 'not-a-hang') });
    writeIntent(j9, { seq: 1, frequencyMhz: 2700, voltageMv: 900 });
    closeAsWriterDeath(j9, { at: '2026-08-16T23:42:00+03:00', error: new Error('EPERM') });
    writeIntent(j9, { seq: 2, frequencyMhz: 2700, voltageMv: 890 });
    closeAsOperatorStop(j9, { at: '2026-08-16T23:43:00+03:00', signal: 'SIGINT' });
    ok('НИ СВОЯ СМЕРТЬ, НИ ОСТАНОВ ОПЕРАТОРА ПОЛА НЕ СОЗДАЮТ — они не о кремнии',
      hangFloors(readJournal(j9).records).size, 0);
    //   И возобновление отдаёт пол вместе с остальным — одним вызовом, как и всё прочее.
    ok('ВОЗОБНОВЛЕНИЕ НЕСЁТ ПОЛ: он нужен спуску, а спуск читает журнал один раз',
      resumeState(j8, { at: '2026-08-16T23:44:00+03:00' }).floors?.get(2842)?.voltageMv
        ?? 'пола в возобновлении нет вовсе', 860);
    //   ПОЛ ВИДЕН И ДО ТОГО, КАК ЗАВИСАНИЕ ЗАКРЫТО СТРОКОЙ. Читатель, которому ПИСАТЬ НЕЛЬЗЯ, — сухой
    //   прогон: он строит план ДО первой записи в карту (рельс S2), и стена, которой в плане нет,
    //   встречает оператора уже посреди прогона.
    const j10 = openJournal({ dir: join(sandbox, 'unclosed-floor') });
    writeIntent(j10, { seq: 1, frequencyMhz: 2842, voltageMv: 845, pointIndex: 63 });
    ok('НЕЗАКРЫТОЕ НАМЕРЕНИЕ — ТОЖЕ ПОЛ: сухой прогон видит стену, ничего не записав в журнал',
      [hangFloors(readJournal(j10).records).get(2842)?.voltageMv ?? 'пола нет вовсе',
        readJournal(j10).records.filter((r) => r.state === 'verdict').length],
      [845, 0]);
    //   И ответ НЕ МЕНЯЕТСЯ от того, закрыли зависание строкой или ещё нет — иначе пол зависел бы от
    //   того, кто раньше запустился, а не от того, что случилось с машиной.
    closeHangs(j10, { at: '2026-08-16T23:45:00+03:00' });
    ok('и он ТОТ ЖЕ после закрытия — двух источников хватает на один ответ, а не на два',
      hangFloors(readJournal(j10).records).get(2842)?.voltageMv ?? 'пола нет вовсе', 845);
    //   ⚠️ И ЭТО НЕ РАЗМЫВАЕТ ГРАНИЦУ `bugs/20` / `bugs/14`: незакрытое намерение считается полом,
    //   а ЗАКРЫТОЕ своей смертью или остановом оператора — нет, хотя вердикта ЗАВИС там тоже нет.
    ok('незакрытость — не индульгенция: закрытое своей смертью намерение полом не становится',
      hangFloors(readJournal(j9).records).size, 0);

    // ─── ПОПРАВКА: ЗАВИС, КОТОРЫЙ БЫЛ НАШЕЙ СМЕРТЬЮ, ПЕРЕСТАЁТ БЫТЬ СТЕНОЙ ────────────────────────
    //   Два верных правила отменили друг друга: `bugs/20` прописал «пусть прогон перемерит частоту»,
    //   а R18 назавтра сделал записанное зависание стеной — и перемер стал невозможен. Разбор целиком
    //   в шапке `writeCorrection`; здесь проверяется механизм.
    const j11 = openJournal({ dir: join(sandbox, 'correction') });
    writeIntent(j11, { seq: 1, frequencyMhz: 2775, voltageMv: 965, pointIndex: 70 });
    closeHangs(j11, { at: '2026-08-16T17:13:00+03:00' });
    const beforeFix = hangFloors(readJournal(j11).records).get(2775)?.voltageMv ?? 'пола нет';
    writeCorrection(j11, {
      seq: 1,
      outcome: RUNG_OUTCOME.CRASHED,
      at: '2026-08-22T20:2x',
      correctedBy: 'самопроверка',
      why: 'фикстура: та же улика, что у настоящей поправки — разрыв 8 минут, машина не перезагружалась',
    });
    ok('ПОПРАВКА СНИМАЕТ СТЕНУ: до неё пол стоит, после — частота свободна',
      [beforeFix, hangFloors(readJournal(j11).records).size], [965, 0]);
    //   И ОРИГИНАЛ ОСТАЁТСЯ НА ДИСКЕ. Журнал дописываемый: правка улик руками — это `bugs/08`, а не
    //   лечение. Поправка ДОБАВЛЯЕТ строку, читаемую вечно, и ничего не стирает.
    const afterRecords = readJournal(j11).records;
    ok('оригинальный ЗАВИС никуда не делся — поправка дописывает, а не переписывает',
      [afterRecords.filter((r) => r.outcome === RUNG_OUTCOME.HUNG).length,
        afterRecords.filter((r) => r.state === LINE.CORRECTION).length], [1, 1]);
    //   ⚠️ ПОПРАВКА УМЕЕТ ТОЛЬКО СНИМАТЬ СТЕНУ. Поставить полом можно измерением, а не строкой:
    //   иначе документу можно было бы выдать край, которого никто не мерил.
    let cannotInvent = false;
    try {
      writeCorrection(j11, { seq: 1, outcome: RUNG_OUTCOME.HUNG, why: 'попытка поставить стену строкой' });
    } catch { cannotInvent = true; }
    ok('СТЕНУ СТРОКОЙ НЕ ПОСТАВИТЬ: поправка в ЗАВИС отвергается по словарю', cannotInvent, true);
    //   И БЕЗ УЛИКИ — тоже отказ: поправка без причины и есть правка улик, одной строкой ниже.
    let needsWhy = false;
    try { writeCorrection(j11, { seq: 1, outcome: RUNG_OUTCOME.CRASHED, why: '   ' }); } catch { needsWhy = true; }
    ok('ПОПРАВКА БЕЗ УЛИКИ ОТВЕРГАЕТСЯ: поле why обязательно и не может быть пустым', needsWhy, true);
    //   И НЕЛЬЗЯ ПОПРАВИТЬ ТО, ЧТО ЗАВИСАНИЕМ НЕ БЫЛО. На диске такая строка выглядела бы законной.
    const j12 = openJournal({ dir: join(sandbox, 'correction-target') });
    writeIntent(j12, { seq: 1, frequencyMhz: 2700, voltageMv: 900 });
    writeVerdict(j12, { seq: 1, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: 'PASS', why: 'прошло' });
    let onlyHangs = false;
    try {
      writeCorrection(j12, { seq: 1, outcome: RUNG_OUTCOME.CRASHED, why: 'попытка переписать PASS' });
    } catch { onlyHangs = true; }
    let noSuchRung = false;
    try {
      writeCorrection(j12, { seq: 99, outcome: RUNG_OUTCOME.CRASHED, why: 'ступени с таким номером нет' });
    } catch { noSuchRung = true; }
    ok('ПОПРАВЛЯЕТСЯ ТОЛЬКО ЗАВИСАНИЕ: ни PASS, ни несуществующая ступень', [onlyHangs, noSuchRung], [true, true]);
    //   ⚠️ И ЖУРНАЛ БЕЗ ПОПРАВОК ВЕДЁТ СЕБЯ РОВНО КАК ПРЕЖДЕ. Это то, чего требует всякое добавление
    //   к работающему механизму: доказать, что оно ничего не сдвинуло там, где его нет.
    ok('журнал БЕЗ поправок не изменился ни в полу, ни в тормозе',
      [hangFloors(readJournal(j8).records).get(2842)?.voltageMv ?? 'пола нет',
        blockedRungs(readJournal(j8).records).length,
        hangFloors(readJournal(j10).records).get(2842)?.voltageMv ?? 'пола нет'],
      [860, 0, 845]);
    //   ТОРМОЗ «ДВА ПОДРЯД» ТОЖЕ НЕ СЧИТАЕТ ПОПРАВЛЕННОЕ — `bugs/20`, пункт 3 плана починки: своя
    //   смерть не событие карты, а тормоз — про карту.
    const j13 = openJournal({ dir: join(sandbox, 'correction-brake') });
    writeIntent(j13, { seq: 1, frequencyMhz: 2842, voltageMv: 845 });
    writeIntent(j13, { seq: 2, frequencyMhz: 2842, voltageMv: 845 });
    closeHangs(j13, { at: '2026-08-16T23:50:00+03:00' });
    const brakeBefore = blockedRungs(readJournal(j13).records).length;
    writeCorrection(j13, {
      seq: 1, outcome: RUNG_OUTCOME.CRASHED, why: 'фикстура: первая попытка убита нашим же сторожем',
    });
    ok('ТОРМОЗ НЕ СЧИТАЕТ ПОПРАВЛЕННОЕ: два подряд превратились в одно настоящее',
      [brakeBefore, blockedRungs(readJournal(j13).records).length], [1, 0]);
  } finally {
    // assertSandbox FIRST — this exact teardown deleted the production store on 2026-08-14.
    rmSync(assertSandbox({ dir: sandbox }), { recursive: true, force: true });
  }

  const prodAfter = existsSync(SWEEP_DIR) ? readdirSync(SWEEP_DIR).length : -1;
  ok('ПРОДАКШЕН-ЖУРНАЛ НЕ ВЫРОС: самопроверка не подбросила ни одного зависания',
    prodAfter, prodBefore);

  return { ok: results.every((r) => r.ok), results };
}

/**
 * A CRASHING BLOCK BECOMES A RED BLOCK, NOT A DEAD REPORT.
 *
 * Paid for three times in one sitting, 2026-08-15: `.find(...).verdict` and `list[0].why` inside
 * assertions threw under mutations 42 and 46, so the suite DIED and the mutation harness read «did
 * not complete» instead of the name of what broke. Each site was fixed with `?.` — and a class fixed
 * three times by hand is a class that needs a mechanism (`EXPERIENCE.md` → «a lesson that repeats is
 * a lesson that failed as text»).
 *
 * So the runner catches. The partial results still print, the crash becomes ONE red block that names
 * the exception, and the completion line still appears — which is what EXP-0071's harness reads. The
 * `?.` at each site is still the better fix, because it names WHICH assertion failed and what it got;
 * this is the net under it.
 */
export function runSelfTest() {
  try {
    return selfTest();
  } catch (e) {
    return {
      ok: false,
      results: [{
        ok: false,
        what: 'НАБОР УПАЛ, НЕ ДОЙДЯ ДО КОНЦА — это красный блок, а не «проверок не было»',
        got: `${e.name}: ${e.message}`,
        want: 'ни одно утверждение не бросает: падающее утверждение уносит с собой ВЕСЬ отчёт',
      }],
    };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--selftest')) {
    const r = runSelfTest();
    for (const x of r.results) {
      console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.what}${x.ok ? '' : `  -> получено ${JSON.stringify(x.got)}, ждали ${JSON.stringify(x.want)}`}`);
    }
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА: есть расхождения.');
    process.exit(r.ok ? 0 : 1);
  } else {
    console.error('ОШИБКА: журнал развёртки — библиотека. Прогон логики: --selftest');
    process.exit(2);
  }
}

export default {
  SWEEP_DIR, LINE, RUNG_OUTCOME, openJournal, assertSandbox, rungKey,
  appendLine, writeIntent, writeVerdict, readJournal, orphanIntents, closeHangs, closeAsOperatorStop,
  closeAsWriterDeath, attributions, hangFloors, blockedRungs, resumeState,
};
