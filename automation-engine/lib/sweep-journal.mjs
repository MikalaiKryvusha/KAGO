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
  //
  // ⚠️ NOT `JSON.stringify(record, Object.keys(record).sort())`, and the difference is not stylistic.
  // An ARRAY second argument is a KEY FILTER, and `JSON.stringify` applies it at EVERY level — so a
  // nested object keeps only the keys that happen to exist at the TOP level, and loses the rest
  // SILENTLY. Measured 2026-08-24 the moment the first nested field arrived (`redBlocks`, `plans/37`):
  // the array came through with the right length and every element gutted to `{}`.
  //
  // Nothing was lost historically — every line this journal has ever written is flat — but the trap
  // was armed and would have fired on the first diagnostic field anyone nested. Sorting an object's
  // own keys is what was wanted; filtering the document was never the intent.
  const sorted = {};
  for (const k of Object.keys(record).sort()) sorted[k] = record[k];
  const line = `${JSON.stringify(sorted)}\n`;
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

/**
 * The line that CLOSES an intent. Fsynced too: a verdict lost to the page cache would make the next
 * launch read a finished rung as the one that killed the machine — safe, but it would cost the sweep
 * a rung it had already paid for, and on the second such loss it would block the rung outright.
 *
 * ─── THE FACT OF THE WRITE LIVES HERE, NOT IN THE INTENT (`bugs/49`) ────────────────────────────────
 *
 * The intent is a CLAIM, and it must stay one: it is fsynced BEFORE the card is touched, so it cannot
 * possibly know what the card ended up being given. `bugs/47` made that gap real — the atom now
 * RECOMPUTES the offset against its own reading of the table (the frequency axis slides with heat,
 * R14b), so from 2026-08-24 the intent's `deltaMhz` may name an offset the card never saw. Moving the
 * journalling behind the recompute was the tempting fix and it is the wrong one: an intent written
 * after the write survives nothing, which is the entire reason R15 exists.
 *
 * So the pair is collapsed the only way that keeps both halves honest — **the intent claims, the
 * verdict reports**:
 *
 *   `appliedDeltaMhz`  the offset that ACTUALLY reached the card (`runStep` → `out.offsetMhz`).
 *                      The asked value is NOT repeated here: it is already on the intent line under
 *                      the same `seq`, and duplicating it would be a truth↔mirror pair created on
 *                      purpose (`AGENT_GUIDE.md` → the pairs registry prefers removal over watching).
 *   `tableDriftMhz`    the MEASURED disagreement between the caller's reading of the table and the
 *                      atom's, in MHz. This is the only place in the project where that quantity is
 *                      recorded at all. **`null` is a third state and it is not `0`:** `null` means
 *                      the atom was given no target and therefore measured nothing (hand runs,
 *                      `--drill`, experiments), while `0` means it looked and the tables agreed.
 *   `appliedPinMhz`    the clock the card was ACTUALLY pinned to, or `null` for «no pin was used» —
 *                      which is the normal case above the curve's cap floor, where the curve carries
 *                      the ceiling itself (R11).
 *   `offeredAfterMhz`  the highest frequency the curve offers AFTER the write, RE-READ FROM THE CARD
 *                      (`runStep` → `out.highestOfferedMhz`). Added 2026-08-24 for `bugs/50`, and it
 *                      is the DISCRIMINATOR that investigation lacked: the ceiling breaches recorded
 *                      in this journal say what the card DELIVERED, and nothing said what it was
 *                      being OFFERED at the time. Those are different claims and they blame different
 *                      parties — `offered ≤ cap` while the card ran above it means the CARD exceeded
 *                      its own curve; `offered > cap` means our write did not land. The atom has
 *                      always measured this and had always dropped it on the floor.
 *
 * ⚠️ **The third field is here because the TWIN CHECK found it, and the inventory is what the class is
 * judged by** (`BUG_FIXING_FRAMEWORK.md`). The atom overrides exactly TWO of its caller's numbers, not
 * one: the offset above, and the pin — `snapToLadder` moves the requested clock onto the card's own
 * ladder (`vf-step`, «1500 is not on this card's ladder; 1492 is»). Below the cap floor the sweep DOES
 * pin, and until now the journal recorded nothing about it at all: if a snap ever moves the clock, the
 * line's own `frequencyMhz` names a frequency the card was not held at — the same lie one field over,
 * in the field the whole journal is keyed by. Whether the snap ever moves in the sweep's path is a
 * question only the live card can answer, and recording the number is what makes the next live run
 * answer it for free instead of leaving a note nobody can settle.
 *
 * The caller's own numbers are NOT repeated in any of the three: they are on the intent line under the
 * same `seq`. The precedent is already in this record — `servingMvAfter` has always been the
 * verdict-side counterpart of the intent's ordered `voltageMv`, for exactly this reason.
 *
 * [TESTED: 2026-08-15 23:2x · offline, by this module's 17-block suite; the two fields added
 *  2026-08-24 are held by the `bugs/49` blocks in `journal --selftest` and `engine --selftest`]
 */
export function writeVerdict(journal, closing, io = {}) {
  // ─── ЗАПИСЬ НЕ ПЕРЕЧИСЛЯЕТ ПОЛЯ ВЫЗЫВАЮЩЕГО — ОНА ИХ РАСКРЫВАЕТ (`bugs/54`) ────────────────────
  //
  // Здесь стояло явное перечисление семнадцати полей, и оно МОЛЧА роняло всё, чего в нём не было:
  // ни ошибки, ни исключения, зелёный код возврата. Движок передавал `deliveredMhz` с коммита
  // `5b3456e`, а на диск не попало ни одной: замер боевого журнала 2026-08-24 — **678 строк
  // `passed`, поле в НУЛЕ из них.** Вторая половина каждой доказанной пары терялась между вызовом
  // и файлом, и вызывающий увидеть этого не мог.
  //
  // ⚠️ ЛЕЧЕНИЕ — НЕ СТОРОЖ НАД ПЕРЕЧИСЛЕНИЕМ, А ОТСУТСТВИЕ ПЕРЕЧИСЛЕНИЯ. Первая редакция починки
  // завела список полей и блок, который парсил исходники проекта и сверял ключи вызывающих с ним;
  // он тут же дал ложную находку на куске метки времени. Владелец 2026-08-24 23:0x: *«стенд должен
  // становиться проще и гениальнее в своей простоте. KISS, Паретто»*. Раскрытие делает класс
  // НЕВОЗМОЖНЫМ вместо того, чтобы за ним следить, — и убирает вместе с собой список, сторож,
  // парсер и его мутацию. Ровно та же форма уже стоит в `remembered-state.appendBootJournal`,
  // и твин-проверка нашла её чистой ПО ПОСТРОЕНИЮ.
  //
  // Перечисление ниже осталось УМОЛЧАНИЯМИ, а не фильтром: строка вердикта должна нести свои поля
  // явными `null`, иначе «не измерено» и «поля нет» на диске не различить (EXP-0136).
  const record = {
    seq: null,
    at: null,
    outcome: null,
    verdict: null,
    decidedBy: null,
    servingMvAfter: null,
    // ⚠️ УМОЛЧАНИЕ `null`, А НЕ `deltaMhz`: вердикт, чей вызывающий не смог назвать лёгший сдвиг,
    // так и говорит, а не подставляет число, которому это поле и заведено не доверять.
    appliedDeltaMhz: null,
    tableDriftMhz: null,
    appliedPinMhz: null,
    offeredAfterMhz: null,
    // КРАСНЫЕ БЛОКИ АТОМА — `plans/37`. Зелёные сюда НЕ едут: строка с двумя дюжинами зелёных
    // хоронит свой единственный красный.
    redBlocks: [],
    redBlocksDropped: 0,
    // КЛАСС ОТКАЗА ЗАПИСИ — `plans/40`. `redBlocks` несёт УЛИКУ, это поле — ДИАГНОЗ по ней, потому
    // что диагноз, закопанный в прозу блока, нельзя сосчитать по журналу.
    writeFailureClass: null,
    writeSettled: null,
    // ДЕРЖАТЕЛЬ ПРОБИТОГО ПОТОЛОКА — `ЗАПИСЬ` · `КАРТА` · `НЕИЗВЕСТНО` (`bugs/50`). `writeFailureClass`
    // отвечает «что случилось с ЗАПИСЬЮ», это поле — «кто не удержал ПОТОЛОК». Они не подменяют друг
    // друга: три ступени полосы 2026-08-25 несут `writeFailureClass: null` при вставшей форме и
    // пробитом под нагрузкой потолке, и по одному лишь первому полю они неотличимы от чистых.
    ceilingBreachHolder: null,
    // ВЫДАННАЯ ЧАСТОТА — вторая половина доказанной пары (`GOAL.md` → «🎚 ТЮНИМ ТО, ЧТО КАРТА
    // ВЫДАЁТ»). Без неё `servingMvAfter` — напряжение без частоты, и восстановить вторую половину
    // задним числом нельзя: медиана `clocks.gr` считается по пробам ЭТОГО прожига.
    deliveredMhz: null,
    deliveredMaxMhz: null,
    why: '',
    ...closing,
    // `state` — последним: он принадлежит журналу, а не вызывающему.
    state: LINE.VERDICT,
  };
  // `undefined` не переживает JSON и оставил бы поле ОТСУТСТВУЮЩИМ, то есть неотличимым от старых
  // строк. Приводится к `null` — «не названо» говорится вслух.
  for (const k of Object.keys(record)) if (record[k] === undefined) record[k] = null;
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
/**
 * WHAT THIS FREQUENCY HAS ALREADY PROVEN — the deepest voltage that PASSED. `bugs/31`.
 *
 * The mirror of `hangFloors`, and it exists because the resume path had only the first half. Until
 * this function the journal could answer *«what may the descent never touch again»* and could NOT
 * answer *«what has the descent already survived»* — so a resumed frequency restarted from the
 * neighbour's seed and re-burned every rung it had already proven. The owner watching that happen,
 * 2026-08-22 22:2x: *«край найден у точки, какого хуя вновь с неё начинать»*. He is right: with a
 * hang above and a PASS below, the edge is BRACKETED and nothing needs burning at all.
 *
 * **THE PROVEN VOLTAGE IS THE ONE THE CARD SERVED, NOT THE ONE WE ORDERED.** The factory table slides
 * along the frequency axis as the card warms, so an ordered 860 mV can be served as 870 (measured
 * this very evening, twice in a row). The PASS is a statement about the voltage the silicon actually
 * ran at; taking the ordered value would claim proof of a rung nobody burned, and it would err in the
 * OPTIMISTIC direction — the one that ships an undervolt deeper than the evidence. `servingMvAfter`
 * is therefore preferred, and the intent's voltage is only the fallback for records written before
 * that field existed.
 *
 * Deliberately NOT filtered by `corrections()`: a correction may only ever REMOVE a hang wall
 * (see `writeCorrection`), and it never invalidates a PASS — a rung that survived a burn survived it.
 *
 * @returns {Map<number, {voltageMv:number, seq:number, at:string|null}>} keyed by frequency,
 *          carrying the DEEPEST (lowest) voltage that passed at it
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export function provenRungs(records) {
  const out = new Map();
  const intents = new Map(records.filter((r) => r?.state === LINE.INTENT).map((r) => [r.seq, r]));
  for (const v of records) {
    if (v?.state !== LINE.VERDICT || v.outcome !== RUNG_OUTCOME.PASSED) continue;
    const i = intents.get(v.seq);
    if (!i || !Number.isFinite(i.frequencyMhz)) continue;
    const mv = Number.isFinite(v.servingMvAfter) ? v.servingMvAfter : i.voltageMv;
    if (!Number.isFinite(mv)) continue;
    const seen = out.get(i.frequencyMhz);
    if (!seen || mv < seen.voltageMv) out.set(i.frequencyMhz, { voltageMv: mv, seq: v.seq, at: v.at ?? null });
  }
  return out;
}

/**
 * ─── УРОЖАЙ: КАЖДАЯ СТУПЕНЬ, ВЫДЕРЖАВШАЯ ПРОЖИГ, КАК ПОЛНАЯ ПАРА ──────────────────────────────────
 * `plans/41` фаза 1. Один автор счёта на весь проект: и прогон, и чтение журнала зовут ЭТУ функцию,
 * поэтому «доказано прожигом N» не может получиться двух разных значений (`AGENT_GUIDE.md` → пару
 * лучше УБРАТЬ, чем за ней следить).
 *
 * ЗАЧЕМ ЭТО ОТДЕЛЬНО ОТ `provenRungs`. Та ключуется ЗАКАЗАННОЙ частотой (она берёт `frequencyMhz` с
 * намерения) и отвечает на вопрос возобновления «куда этой частоте уже нельзя». Здесь ключ —
 * **ВЫДАННАЯ** частота, то есть та, на которой карта РЕАЛЬНО работала, и вопрос другой: «что мы
 * на самом деле доказали». Правило владельца: *«невозможно у карты заказать частоту и ожидать, что
 * она её послушно выдаст. Она выдаст какую-то частоту. И нам нужно это знание фиксировать»*.
 *
 * ЧТО СЧИТАЕТСЯ ПАРОЙ. Ступень с исходом `passed`, у которой на диске ЕСТЬ ОБЕ половины: выданная
 * частота и напряжение, обслуживавшее её после записи. Половинки НЕ отбрасываются молча — они
 * возвращаются списком, и это прибор критерия H-AC1 (`plans/41` §3): их должно быть НОЛЬ.
 *
 * КТО ПОБЕЖДАЕТ ПРИ СТОЛКНОВЕНИИ — решено владельцем 2026-08-24 (`interviews/014` Q2 = A):
 * **меньшее напряжение**, потому что оно тоже выдержало прожиг под оракулом, то есть доказано
 * наблюдением, а «позже = честнее» было бы рассуждением. Столкновения при этом СЧИТАЮТСЯ и
 * возвращаются: правило выбрало победителя, а не спрятало факт.
 *
 * ─── ПРОЖИГ БЕЗ НОВОЙ ГЛУБИНЫ — ЧЕТВЁРТАЯ ВЕЛИЧИНА, И ОНА ПРО ЦЕНУ, А НЕ ПРО УРОЖАЙ ───────────────
 * `plans/48` (эпик 47 фаза 1). Слово владельца 2026-08-25: *«Ни один прожиг не должен быть в
 * пустую»*. Ступень куплена впустую, если её ВЫДАННАЯ частота в этом прогоне уже жглась, а
 * обслужившее напряжение не стало глубже уже доказанного там. Такой прожиг стоит минуту карты
 * владельца и не добавляет к документу ничего.
 *
 * ⚠️ ПОЧЕМУ «НЕ ГЛУБЖЕ», А НЕ «РОВНО ТО ЖЕ». Повтор ровно того же значения — частный случай; шаг,
 * вернувшийся ВЫШЕ уже доказанного, покупает столько же, то есть ничего: более высокое напряжение
 * на той же частоте уже подразумевается прошедшим более низким. Мерка «совпало с предыдущей» ловит
 * только соседей и пропускает повтор через одну.
 *
 * ⚠️ И ПОЧЕМУ ЭТО НЕ РЕШЕНИЕ АГЕНТА, А РЕШЕНИЕ ВЛАДЕЛЬЦА. Край этой карты вероятностный, поэтому
 * повторный прожиг той же пары можно было бы считать вторым свидетельством, а не тратой. Развилка
 * задавалась ему прямо (`interviews/014` Q5) и закрыта **вариантом B — «один прожиг = доказано,
 * движемся глубже сразу»**, против рекомендации агента. Здесь исполняется его ответ: раз одного
 * прожига достаточно, второй той же пары не покупает ничего.
 *
 * ⚠️ ПОЛОВИНКА — НЕ ТРАТА. Ступень, оставившая на диске напряжение без частоты, отсеивается ВЫШЕ и
 * сюда не доходит: это дефект журнала (`bugs/54`), и записать его в трату значило бы предъявить
 * карте счёт за нашу же потерю данных.
 *
 * @param {Array} rungs записи ступеней: `{outcome, deliveredMhz, deliveredMaxMhz, servingMvAfter,
 *                      orderedMhz, orderedMv, seq, at}`
 * @returns {{burnsHeld:number, fullPairs:number, pairs:Map, halfPairs:Array, contested:Array,
 *            worstSpreadMhz:number|null, wastedBurns:Array, repeatedFrequencies:number}}
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export function harvestPairs(rungs) {
  const pairs = new Map();
  const halfPairs = [];
  const wastedBurns = [];
  let burnsHeld = 0;
  let worstSpreadMhz = null;

  for (const r of Array.isArray(rungs) ? rungs : []) {
    if (r?.outcome !== RUNG_OUTCOME.PASSED) continue;
    burnsHeld += 1;
    const mhz = Number.isFinite(r?.deliveredMhz) ? r.deliveredMhz : null;
    const mv = Number.isFinite(r?.servingMvAfter) ? r.servingMvAfter : null;
    if (mhz === null || mv === null) {
      // ПОЛОВИНКА НАЗЫВАЕТСЯ, А НЕ ПРОПУСКАЕТСЯ. Уцелевшая половина выглядит как запись, и молчание
      // о второй — ровно то, чем этот дефект жил (EXP-0141, `bugs/54`).
      halfPairs.push({
        seq: r?.seq ?? null,
        at: r?.at ?? null,
        orderedMhz: r?.orderedMhz ?? null,
        deliveredMhz: mhz,
        servingMvAfter: mv,
        missing: mhz === null && mv === null ? 'обе половины' : (mhz === null ? 'выданная частота' : 'напряжение'),
      });
      continue;
    }
    // РАЗБРОС ВЫДАЧИ ВНУТРИ ПРОЖИГА. `deliveredMhz` — медиана проб ПОД НАГРУЗКОЙ, `deliveredMaxMhz` —
    // максимум. Их разность печатается, но пару НЕ отбрасывает: порога никто не мерил, а назначенное
    // число хуже отсутствующего (`PHILOSOPHY.md` → три двери). Порог назовёт замер, когда он будет.
    const spread = Number.isFinite(r?.deliveredMaxMhz) ? Math.max(0, r.deliveredMaxMhz - mhz) : null;
    if (spread !== null) worstSpreadMhz = worstSpreadMhz === null ? spread : Math.max(worstSpreadMhz, spread);

    const seen = pairs.get(mhz);
    if (!seen) {
      pairs.set(mhz, {
        deliveredMhz: mhz,
        voltagesMv: [mv],
        deepestMv: mv,
        shallowestMv: mv,
        burns: 1,
        orderedMhz: [r?.orderedMhz ?? null],
        worstSpreadMhz: spread,
        seq: r?.seq ?? null,
        at: r?.at ?? null,
      });
      continue;
    }
    // ⚠️ СЧИТАЕТСЯ ДО ОБНОВЛЕНИЯ `deepestMv` — иначе сравнение шло бы с самим собой и трата никогда
    // бы не нашлась. Сравнение с тем, что было известно ПЕРЕД этим прожигом, и есть весь вопрос.
    if (mv >= seen.deepestMv) {
      wastedBurns.push({
        seq: r?.seq ?? null,
        at: r?.at ?? null,
        deliveredMhz: mhz,
        servingMvAfter: mv,
        // ЧТО УЖЕ БЫЛО ИЗВЕСТНО НА ЭТОЙ ВЫДАННОЙ ЧАСТОТЕ ДО ПРОЖИГА — без этого числа строка
        // «прожиг впустую» недоказуема глазом: читатель обязан видеть, ЧЕМУ он не добавил.
        knownDeepestMv: seen.deepestMv,
        // ЧТО ЗАКАЗЫВАЛИ — обе половины заказа. Именно расхождение заказа с выдачей и покупает
        // пустой прожиг: движок целится в частоту, которой карта не даёт (`plans/47` F1).
        orderedMhz: r?.orderedMhz ?? null,
        orderedMv: r?.orderedMv ?? null,
      });
    }
    seen.burns += 1;
    seen.voltagesMv.push(mv);
    seen.orderedMhz.push(r?.orderedMhz ?? null);
    seen.shallowestMv = Math.max(seen.shallowestMv, mv);
    if (spread !== null) {
      seen.worstSpreadMhz = seen.worstSpreadMhz === null ? spread : Math.max(seen.worstSpreadMhz, spread);
    }
    // ПОБЕДИТЕЛЬ — МЕНЬШЕЕ НАПРЯЖЕНИЕ (`interviews/014` Q2 = A). Вместе с ним переезжает и подпись
    // (`seq`, `at`): строка обязана указывать на ТУ ступень, чьё число она несёт.
    if (mv < seen.deepestMv) {
      seen.deepestMv = mv;
      seen.seq = r?.seq ?? null;
      seen.at = r?.at ?? null;
    }
  }

  for (const p of pairs.values()) p.voltagesMv.sort((a, b) => a - b);
  const contested = [...pairs.values()]
    .filter((p) => p.deepestMv !== p.shallowestMv)
    .map((p) => ({ deliveredMhz: p.deliveredMhz, voltagesMv: p.voltagesMv, wonByMv: p.deepestMv }));

  return {
    burnsHeld,
    fullPairs: burnsHeld - halfPairs.length,
    pairs,
    halfPairs,
    contested,
    worstSpreadMhz,
    // ПРОЖИГИ, КУПЛЕННЫЕ БЕЗ НОВОЙ ГЛУБИНЫ (`plans/48`). Ноль здесь — результат, а не молчание.
    wastedBurns,
    // ⚠️ СКОЛЬКО ЧАСТОТ ВООБЩЕ ЖГЛИСЬ ПОВТОРНО — И БЕЗ ЭТОГО ЧИСЛА НОЛЬ ВЫШЕ НИЧЕГО НЕ ЗНАЧИТ.
    // Прогон, где каждая выданная частота прожигалась ровно один раз, физически не может дать
    // траты: там «трат 0» означает «случая не было», а не «движок не тратит». Это ровно класс
    // `bugs/40` — заголовок, совпавший без чтения того, что под ним, — и утверждение, которое
    // читает `wastedBurns.length === 0` без этого числа, проходит вакуумно.
    repeatedFrequencies: [...pairs.values()].filter((p) => p.burns > 1).length,
  };
}

/**
 * ТОТ ЖЕ УРОЖАЙ, СНЯТЫЙ С ДИСКА — прибор критерия H-AC1 (`plans/41` §3).
 *
 * Соединяет вердикт с его намерением по `seq`: заказанная частота живёт на намерении, выданная — на
 * вердикте, и пара существует только вместе. Считает ОДНОЙ функцией с прогоном — см. `harvestPairs`.
 *
 * [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this.
 */
export function harvestFromJournal(records) {
  const intents = new Map(
    (Array.isArray(records) ? records : []).filter((r) => r?.state === LINE.INTENT).map((r) => [r.seq, r]));
  const rungs = (Array.isArray(records) ? records : [])
    .filter((r) => r?.state === LINE.VERDICT)
    .map((v) => ({
      outcome: v.outcome,
      deliveredMhz: v.deliveredMhz ?? null,
      deliveredMaxMhz: v.deliveredMaxMhz ?? null,
      servingMvAfter: v.servingMvAfter ?? null,
      orderedMhz: intents.get(v.seq)?.frequencyMhz ?? null,
      orderedMv: intents.get(v.seq)?.voltageMv ?? null,
      seq: v.seq,
      at: v.at ?? null,
    }));
  return harvestPairs(rungs);
}

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
    // ЧТО ЧАСТОТА УЖЕ ДОКАЗАЛА — вторая половина памяти, которой здесь не было (`bugs/31`).
    // Возобновление читало только смерти, поэтому частота с найденным краем начинала спуск заново
    // от затравки соседки и заново жгла каждую уже прошедшую ступень.
    proven: provenRungs(records),
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

    // ─── ЧТО ЧАСТОТА УЖЕ ДОКАЗАЛА — ВТОРАЯ ПОЛОВИНА ПАМЯТИ (`bugs/31`, `plans/25` шаг 1.2) ─────────
    //
    // `provenRungs` родилась 2026-08-22 и вышла в бой БЕЗ ЕДИНОГО БЛОКА: замерено 2026-08-23 —
    // мутация, стирающая её чтение в развёртке, оставляла всю батарею зелёной (959 из 959).
    // Функция при этом решает, откуда начнётся спуск на карте владельца, то есть сколько прожигов
    // он оплатит и на какой ступени окажется первый.
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   CE. брать любой исход, не только PASSED      → «СЧИТАЮТСЯ ТОЛЬКО ПРОШЕДШИЕ»
    //   CF. брать ПЕРВУЮ прошедшую вместо глубочайшей → «ХРАНИТСЯ ГЛУБОЧАЙШАЯ»
    //   CG. читать заказанное вместо подставленного   → «УЛИКА — НАПРЯЖЕНИЕ, КОТОРОЕ КАРТА ПОДСТАВИЛА»
    //   CH. отвечать по вердикту без намерения        → «БЕЗ НАМЕРЕНИЯ УЛИКИ НЕТ»
    const j14 = openJournal({ dir: join(sandbox, 'proven') });
    // 2820 МГц: три прошедшие ступени вниз, затем зависание. Ровно форма живого журнала 2026-08-22.
    writeIntent(j14, { seq: 1, frequencyMhz: 2820, voltageMv: 900 });
    writeVerdict(j14, { seq: 1, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS, servingMvAfter: 900 });
    writeIntent(j14, { seq: 2, frequencyMhz: 2820, voltageMv: 870 });
    writeVerdict(j14, { seq: 2, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS, servingMvAfter: 870 });
    writeIntent(j14, { seq: 3, frequencyMhz: 2820, voltageMv: 880 });   // ПОЗЖЕ, но ВЫШЕ — не глубже
    writeVerdict(j14, { seq: 3, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS, servingMvAfter: 880 });
    writeIntent(j14, { seq: 4, frequencyMhz: 2820, voltageMv: 850 });
    writeVerdict(j14, { seq: 4, at: null, outcome: RUNG_OUTCOME.HUNG, verdict: config.VERDICT.HUNG, why: 'машина ушла в перезагрузку' });
    // И соседняя частота — чтобы блок утверждал ключевание, а не «в карте одна запись».
    writeIntent(j14, { seq: 5, frequencyMhz: 2842, voltageMv: 940 });
    writeVerdict(j14, { seq: 5, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS, servingMvAfter: 940 });
    const proven = provenRungs(readJournal(j14).records);
    ok('ХРАНИТСЯ ГЛУБОЧАЙШАЯ ПРОШЕДШАЯ СТУПЕНЬ, а не последняя по времени',
      proven.get(2820)?.voltageMv ?? 'улики по 2820 нет вовсе', 870);
    ok('СЧИТАЮТСЯ ТОЛЬКО ПРОШЕДШИЕ: убившая ступень 850 мВ уликой не становится',
      (proven.get(2820)?.voltageMv ?? 0) > 850, true);
    ok('улика КЛЮЧУЕТСЯ ЧАСТОТОЙ: соседка отвечает своим числом, а не чужим',
      [proven.get(2842)?.voltageMv ?? 'нет', proven.size], [940, 2]);
    // Ось напряжения: владелец, 2026-08-16 — «мы должны попасть в ближайшее верхнее напряжение».
    // Улика обязана нести то, что карта ПОДСТАВИЛА, иначе она утверждает о напряжении, которого не было.
    const j15 = openJournal({ dir: join(sandbox, 'proven-serving') });
    writeIntent(j15, { seq: 1, frequencyMhz: 2820, voltageMv: 866 });   // заказано
    writeVerdict(j15, { seq: 1, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS, servingMvAfter: 870 });
    ok('УЛИКА — НАПРЯЖЕНИЕ, КОТОРОЕ КАРТА ПОДСТАВИЛА, а не то, что мы заказали',
      provenRungs(readJournal(j15).records).get(2820)?.voltageMv ?? 'улики нет', 870);
    // ...а когда карта его не назвала — заказанное остаётся единственным, что известно, и берётся оно.
    const j16 = openJournal({ dir: join(sandbox, 'proven-fallback') });
    writeIntent(j16, { seq: 1, frequencyMhz: 2820, voltageMv: 875 });
    writeVerdict(j16, { seq: 1, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS });
    ok('карта не назвала напряжение → уликой остаётся заказанное, но улика ЕСТЬ',
      provenRungs(readJournal(j16).records).get(2820)?.voltageMv ?? 'улики нет', 875);
    // БЕЗ НАМЕРЕНИЯ УЛИКИ НЕТ. Вердикт сам по себе не называет ни частоты, ни напряжения — принять
    // его значило бы завести улику без координат, а по ней потом начался бы спуск.
    const j17 = openJournal({ dir: join(sandbox, 'proven-orphan-verdict') });
    writeVerdict(j17, { seq: 7, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS, servingMvAfter: 800 });
    ok('БЕЗ НАМЕРЕНИЯ УЛИКИ НЕТ: вердикт без своей ступени не заводит доказанной земли',
      provenRungs(readJournal(j17).records).size, 0);
    // И обе половины памяти читаются ОДНИМ вызовом возобновления — иначе развёртка получила бы
    // смерти без успехов, ровно как до `bugs/31`.
    const resumed = resumeState(j14, { at: '2026-08-23T09:00:00+03:00' });
    ok('ВОЗОБНОВЛЕНИЕ ОТДАЁТ ОБЕ ПОЛОВИНЫ: и пол зависания, и доказанную землю',
      [resumed.floors?.get(2820)?.voltageMv ?? 'пола нет', resumed.proven?.get(2820)?.voltageMv ?? 'улики нет'],
      [850, 870]);

    // ─── ВЛОЖЕННЫЙ ОБЪЕКТ ПЕРЕЖИВАЕТ ЗАПИСЬ ЦЕЛИКОМ (найдено 2026-08-24, `plans/37`) ─────────────
    //
    // `appendLine` сортировал ключи через `JSON.stringify(record, Object.keys(record).sort())`, а
    // МАССИВ вторым аргументом — это ФИЛЬТР КЛЮЧЕЙ, и он применяется на ВСЕХ уровнях. Значит
    // вложенный объект сохранял только те ключи, которые случайно есть НАВЕРХУ, а остальные
    // терял МОЛЧА. Замерено в тот же миг, когда появилось первое вложенное поле: массив пришёл
    // нужной длины, а каждый элемент выпотрошен до `{}`.
    //
    // Исторически не потеряно ничего — все строки этого журнала плоские, — но ловушка стояла
    // заряженной и сработала бы на первом же диагностическом поле, которое кто-нибудь вложит.
    // Блок держит СВОЙСТВО, а не сегодняшнее поле: любой вложенный объект round-trip'ится целиком.
    //
    // МУТАЦИЯ: вернуть массив-фильтр вторым аргументом → блок краснеет.
    {
      const nestBox = openJournal({ dir: join(sandbox, 'nested') });
      appendLine(nestBox, {
        state: 'verdict', seq: 1, at: null,
        // Ключи вложенного НАРОЧНО не совпадают ни с одним верхним — так фильтр и проявлялся.
        payload: [{ имя: 'блок', причина: 'сошлось 120 из 127' }],
        глубже: { уровень2: { уровень3: 'дно' } },
      });
      const back = readJournal(nestBox).records[0];
      ok('ВЛОЖЕННЫЙ ОБЪЕКТ ПЕРЕЖИВАЕТ ЗАПИСЬ ЦЕЛИКОМ — сортируются КЛЮЧИ, а не фильтруется документ',
        [back?.payload?.[0]?.имя ?? 'ПОТЕРЯНО', back?.payload?.[0]?.причина ?? 'ПОТЕРЯНО',
          back?.глубже?.уровень2?.уровень3 ?? 'ПОТЕРЯНО'],
        ['блок', 'сошлось 120 из 127', 'дно']);
      // И сортировка верхнего уровня при этом НЕ потеряна — иначе починка обменяла бы один дефект
      // на другой: журнал диффят между прогонами, и порядок полей это то, что делает дифф читаемым.
      ok('и порядок ключей ВЕРХНЕГО уровня остался отсортированным — дифф между прогонами цел',
        (() => {
          const raw = readFileSync(nestBox.path, 'utf8').split(/\r?\n/).filter(Boolean)[0];
          const keys = [...raw.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
          const top = keys.filter((k) => ['at', 'seq', 'state', 'payload', 'глубже'].includes(k));
          return top.join(',') === [...top].sort().join(',');
        })(), true);
    }

    // ─── УРОЖАЙ: ПОЛНАЯ ПАРА НА КАЖДУЮ ВЫДЕРЖАВШУЮ ПРОЖИГ СТУПЕНЬ (`bugs/54`, `plans/41` фаза 1) ──
    //
    // ЧТО ЗДЕСЬ ПРОИЗОШЛО, ЧТОБЫ БЛОКИ НЕ ЧИТАЛИСЬ КАК ЦЕРЕМОНИЯ. `writeVerdict` перечисляет поля
    // ЯВНО и неизвестный ключ вызывающего роняет молча — ни ошибки, ни исключения, зелёный код
    // возврата. Движок передавал `deliveredMhz` с коммита `5b3456e`, а на диск не попало НИ ОДНОЙ:
    // замер боевого журнала 2026-08-24 — **678 строк `passed`, поле в НУЛЕ из них.**
    //
    // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
    //   HA. вернуть перечисление полей вместо раскрытия → «ОБЕ ПОЛОВИНЫ» и «ПОЛЕ, О КОТОРОМ ЗАПИСЬ НЕ ЗНАЕТ»
    //   HB. дать вызывающему переопределить `state`     → «`state` вызывающий переопределить не может»
    //   HC. ключевать урожай ЗАКАЗАННОЙ частотой      → «УРОЖАЙ КЛЮЧУЕТСЯ ВЫДАННОЙ ЧАСТОТОЙ»
    //   HD. молча пропускать половинку                → «ПОЛОВИНКА СЧИТАЕТСЯ, А НЕ ПРОПУСКАЕТСЯ»
    //   HE. при столкновении брать последнее по времени → «ПОБЕЖДАЕТ МЕНЬШЕЕ НАПРЯЖЕНИЕ»
    //   HF. считать урожай по всем исходам, не только PASSED → «УРОЖАЙ СНИМАЕТСЯ ТОЛЬКО С ПРОШЕДШИХ»
    {
      const j18 = openJournal({ dir: join(sandbox, 'harvest') });
      writeIntent(j18, { seq: 1, frequencyMhz: 2355, voltageMv: 850 });
      writeVerdict(j18, {
        seq: 1, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS,
        servingMvAfter: 850, deliveredMhz: 2205, deliveredMaxMhz: 2212, why: 'прошло',
      });
      const backHarvest = readJournal(j18).records.find((r) => r.state === LINE.VERDICT);
      // — ЭТО И ЕСТЬ БЛОК ПРОТИВ `bugs/54`. Он читает ДИСК, а не то, что функция вернула: потеря
      //   происходила именно между вызовом и файлом, и вызывающий её увидеть не мог.
      ok('ОБЕ ПОЛОВИНЫ ПАРЫ ПЕРЕЖИВАЮТ ЗАПИСЬ: напряжение без своей частоты — половина улики',
        [backHarvest?.servingMvAfter ?? 'ПОТЕРЯНО', backHarvest?.deliveredMhz ?? 'ПОТЕРЯНО',
          backHarvest?.deliveredMaxMhz ?? 'ПОТЕРЯНО'],
        [850, 2205, 2212]);

      // — И ГЛАВНОЕ: ЛЮБОЕ ПОЛЕ ВЫЗЫВАЮЩЕГО, А НЕ ТОЛЬКО ЭТИ ДВА.
      //   Блок держит СВОЙСТВО записи, а не список её полей: поле, о котором запись не знает вовсе,
      //   обязано доехать до диска. Это и есть проверка того, что перечисления БОЛЬШЕ НЕТ — оно и
      //   было механизмом потери. Мутация «вернуть перечисление полей» красит и этот блок, и
      //   круговой ход выше, и ничего больше городить не нужно.
      const j18b = openJournal({ dir: join(sandbox, 'harvest-unknown-field') });
      writeVerdict(j18b, {
        seq: 1, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS,
        поле_которого_запись_не_знает: 'доехало',
      });
      ok('ПОЛЕ, О КОТОРОМ ЗАПИСЬ НЕ ЗНАЕТ, ДОЕЗЖАЕТ ДО ДИСКА — терять нечем, перечисления нет',
        readJournal(j18b).records[0]?.поле_которого_запись_не_знает ?? 'ПОТЕРЯНО', 'доехало');
      // И `state` вызывающему не принадлежит: строка вердикта обязана остаться вердиктом.
      writeVerdict(j18b, { seq: 2, state: 'intent', outcome: RUNG_OUTCOME.PASSED });
      ok('но `state` вызывающий переопределить не может — иначе вердикт притворился бы намерением',
        readJournal(j18b).records[1]?.state, LINE.VERDICT);

      // — УРОЖАЙ КЛЮЧУЕТСЯ ВЫДАННОЙ ЧАСТОТОЙ. Заказали 2355, карта работала на 2205: пара
      //   принадлежит 2205, потому что напряжение обслуживало ЕЁ (`GOAL.md` → «ТЮНИМ ТО, ЧТО КАРТА
      //   ВЫДАЁТ»). `provenRungs` рядом ключуется заказанной — это РАЗНЫЕ вопросы, и блок держит обе.
      const h1 = harvestFromJournal(readJournal(j18).records);
      ok('УРОЖАЙ КЛЮЧУЕТСЯ ВЫДАННОЙ ЧАСТОТОЙ, а память возобновления — заказанной',
        [[...h1.pairs.keys()], [...provenRungs(readJournal(j18).records).keys()]],
        [[2205], [2355]]);
      ok('и пара несёт напряжение, обслуживавшее выданную частоту, и разброс выдачи',
        [h1.pairs.get(2205)?.deepestMv ?? 'нет', h1.worstSpreadMhz, h1.burnsHeld, h1.fullPairs],
        [850, 7, 1, 1]);

      // — ПОЛОВИНКА СЧИТАЕТСЯ, А НЕ ПРОПУСКАЕТСЯ. Это прибор критерия H-AC1: цель — НОЛЬ половинок.
      //   Фикстура воспроизводит боевой журнал ДО починки: `servingMvAfter` есть, частоты нет.
      const j19 = openJournal({ dir: join(sandbox, 'harvest-half') });
      writeIntent(j19, { seq: 1, frequencyMhz: 2355, voltageMv: 850 });
      writeVerdict(j19, { seq: 1, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS, servingMvAfter: 850 });
      const h2 = harvestFromJournal(readJournal(j19).records);
      ok('ПОЛОВИНКА СЧИТАЕТСЯ, А НЕ ПРОПУСКАЕТСЯ: прожиг был, пары нет, и это НАЗВАНО',
        [h2.burnsHeld, h2.fullPairs, h2.pairs.size, h2.halfPairs.length, h2.halfPairs[0]?.missing ?? 'нет'],
        [1, 0, 0, 1, 'выданная частота']);

      // — ПОБЕЖДАЕТ МЕНЬШЕЕ НАПРЯЖЕНИЕ (`interviews/014` Q2 = A, слово владельца 2026-08-24).
      //   Фикстура строится так, что «последнее по времени» и «меньшее» РАСХОДЯТСЯ — иначе блок
      //   зеленел бы при обоих правилах и не доказывал бы ничего.
      const j20 = openJournal({ dir: join(sandbox, 'harvest-contest') });
      writeIntent(j20, { seq: 1, frequencyMhz: 2355, voltageMv: 850 });
      writeVerdict(j20, { seq: 1, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS, servingMvAfter: 785, deliveredMhz: 2205 });
      writeIntent(j20, { seq: 2, frequencyMhz: 2340, voltageMv: 860 });
      writeVerdict(j20, { seq: 2, at: null, outcome: RUNG_OUTCOME.PASSED, verdict: config.VERDICT.PASS, servingMvAfter: 850, deliveredMhz: 2205 });
      const h3 = harvestFromJournal(readJournal(j20).records);
      ok('ПОБЕЖДАЕТ МЕНЬШЕЕ НАПРЯЖЕНИЕ, а не последнее по времени',
        [h3.pairs.get(2205)?.deepestMv ?? 'нет', h3.pairs.get(2205)?.seq ?? 'нет'], [785, 1]);
      // И СТОЛКНОВЕНИЕ НЕ ПРЯЧЕТСЯ: правило выбрало победителя, факт остался видимым.
      ok('и столкновение НАЗВАНО: две ступени доказали одну выданную частоту разными напряжениями',
        [h3.contested.length, h3.contested[0]?.voltagesMv ?? 'нет', h3.burnsHeld, h3.pairs.size],
        [1, [785, 850], 2, 1]);

      // — УРОЖАЙ СНИМАЕТСЯ ТОЛЬКО С ПРОШЕДШИХ. Отказ и зависание тоже несут выданную частоту, но
      //   доказывают ОБРАТНОЕ; собрать их в урожай значило бы записать край как рабочую точку.
      const j21 = openJournal({ dir: join(sandbox, 'harvest-outcomes') });
      writeIntent(j21, { seq: 1, frequencyMhz: 2355, voltageMv: 780 });
      writeVerdict(j21, { seq: 1, at: null, outcome: RUNG_OUTCOME.FAILED, verdict: config.VERDICT.SDC, servingMvAfter: 780, deliveredMhz: 2205 });
      writeIntent(j21, { seq: 2, frequencyMhz: 2355, voltageMv: 775 });
      writeVerdict(j21, { seq: 2, at: null, outcome: RUNG_OUTCOME.HUNG, verdict: config.VERDICT.HUNG, servingMvAfter: 775, deliveredMhz: 2205 });
      ok('УРОЖАЙ СНИМАЕТСЯ ТОЛЬКО С ПРОШЕДШИХ: отказ и зависание пары не заводят',
        (() => { const h = harvestFromJournal(readJournal(j21).records); return [h.burnsHeld, h.pairs.size, h.halfPairs.length]; })(),
        [0, 0, 0]);

      // — ОДИН АВТОР СЧЁТА. Прогон считает урожай по своим записям ступеней, чтение журнала — по
      //   диску, и оба зовут ОДНУ функцию. Блок держит именно это: пару лучше УБРАТЬ, чем следить.
      ok('ОДИН АВТОР СЧЁТА: прогон и чтение журнала дают одно число, потому что зовут одну функцию',
        harvestPairs([
          { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2205, deliveredMaxMhz: 2212, servingMvAfter: 850, orderedMhz: 2355, seq: 1 },
        ]).pairs.get(2205)?.deepestMv ?? 'нет',
        h1.pairs.get(2205)?.deepestMv ?? 'нет');

      // ─── ПРОЖИГ БЕЗ НОВОЙ ГЛУБИНЫ — АРИФМЕТИКА (`plans/48`, эпик 47 фаза 1) ─────────────────────
      //
      // Фикстура — ЖИВОЙ ЗАМЕР, а не выдумка: полоса 2355 МГц вечером 2026-08-25, четыре ступени
      // подряд, все заказывали потолок 2355, карта все четыре раза выдала 2347. Именно на ней
      // владелец сказал «каждый прожиг — для нас должен быть уликой».
      const band2355 = [
        { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 850, orderedMhz: 2355, orderedMv: 850, seq: 759 },
        { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 845, orderedMhz: 2355, orderedMv: 845, seq: 760 },
        { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 840, orderedMhz: 2355, orderedMv: 820, seq: 761 },
        { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 840, orderedMhz: 2355, orderedMv: 810, seq: 762 },
      ];
      const hw = harvestPairs(band2355);
      // ⚠️ ОЖИДАЕТСЯ ОДИН, А НЕ ДВА. Ступень 761 заказывала 820 и получила 840 — это НА 5 мВ ГЛУБЖЕ
      //   предыдущих 845, то есть прожиг купил глубину, хоть карта заказ и не отдала. Пустая только
      //   762: те же 840 при уже доказанных 840. Разница «карта не отдала заказ» ↔ «прожиг ничего не
      //   купил» — это и есть содержание счётчика, и путать их значит считать не то.
      ok('ПУСТОЙ ПРОЖИГ НАЗВАН ПОИМЁННО: не давший НОВОЙ ГЛУБИНЫ, а не «карта не отдала заказ»',
        [hw.wastedBurns.length, hw.wastedBurns[0]?.seq ?? 'нет', hw.wastedBurns[0]?.servingMvAfter ?? 'нет',
          hw.wastedBurns[0]?.knownDeepestMv ?? 'нет'],
        [1, 762, 840, 840]);
      // — И ГЛУБЖЕ УЖЕ ДОКАЗАННОГО — НЕ ТРАТА, даже когда карта промахнулась мимо заказа.
      ok('ступень, ушедшая ГЛУБЖЕ доказанного, тратой НЕ считается — даже с промахом заказа',
        hw.wastedBurns.some((w) => w.seq === 761), false);
      // — ВЫШЕ УЖЕ ДОКАЗАННОГО — ТОЖЕ ТРАТА, а не только точный повтор. Более высокое напряжение на
      //   той же частоте уже подразумевается прошедшим более низким; мерка «совпало с предыдущей»
      //   пропустила бы этот случай, и на стенде он составляет большинство трат.
      ok('ВЫШЕ доказанного — тоже трата: повтор не обязан быть точным',
        harvestPairs([
          { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 800, orderedMhz: 2355, orderedMv: 800, seq: 1 },
          { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 900, orderedMhz: 2340, orderedMv: 900, seq: 2 },
        ]).wastedBurns.length, 1);
      // — ЧУЖАЯ ВЫДАННАЯ ЧАСТОТА — НЕ ТРАТА. Ключ — пара, а не напряжение: то же напряжение на
      //   ДРУГОЙ выданной частоте это новое знание. Ровно та ошибка ключа, что живёт в стороже
      //   продвижения (`plans/47` F6) и сделала бы прогоны короче, а не длиннее.
      ok('то же напряжение на ДРУГОЙ выданной частоте — НЕ трата: ключ это пара, а не напряжение',
        harvestPairs([
          { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 840, orderedMhz: 2355, orderedMv: 840, seq: 1 },
          { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2325, servingMvAfter: 840, orderedMhz: 2332, orderedMv: 840, seq: 2 },
        ]).wastedBurns.length, 0);
      // — ⚠️ ВАКУУМНЫЙ ПРОХОД НАЗВАН ЧИСЛОМ, А НЕ ДОВЕРИЕМ. Полоса, где каждая выданная частота
      //   жглась ровно один раз, даёт «трат 0» ПО ПОСТРОЕНИЮ. Читатель обязан отличать «движок не
      //   тратит» от «тратить было негде» — иначе это `bugs/40`: заголовок совпал, под ним не читали.
      ok('НОЛЬ ТРАТ БЕЗ ПОВТОРОВ — это «тратить было негде», и число повторов стоит рядом',
        (() => {
          const h = harvestPairs([
            { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 840, orderedMhz: 2355, orderedMv: 840, seq: 1 },
            { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2325, servingMvAfter: 800, orderedMhz: 2332, orderedMv: 800, seq: 2 },
          ]);
          return [h.wastedBurns.length, h.repeatedFrequencies];
        })(), [0, 0]);
      // — И НАОБОРОТ: повтор БЫЛ, и он ушёл глубже — тогда ноль трат это результат, а не отсутствие случая.
      ok('НОЛЬ ТРАТ ПРИ ПОВТОРЕ — это результат: случай был, и каждый повтор ушёл глубже',
        (() => {
          const h = harvestPairs([
            { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 850, orderedMhz: 2355, orderedMv: 850, seq: 1 },
            { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 840, orderedMhz: 2355, orderedMv: 840, seq: 2 },
          ]);
          return [h.wastedBurns.length, h.repeatedFrequencies];
        })(), [0, 1]);
      // — ПОЛОВИНКА НЕ ПОПАДАЕТ В ТРАТЫ. Ступень, оставившая напряжение без частоты, — дефект
      //   журнала (`bugs/54`), и записать его в трату значило бы предъявить карте счёт за нашу
      //   потерю данных. Обе величины считаются, и они РАЗНЫЕ.
      ok('ПОЛОВИНКА — дефект журнала, а не пустой прожиг: считается отдельно и в траты не идёт',
        (() => {
          const h = harvestPairs([
            { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 840, orderedMhz: 2355, orderedMv: 840, seq: 1 },
            { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: null, servingMvAfter: 840, orderedMhz: 2355, orderedMv: 835, seq: 2 },
          ]);
          return [h.wastedBurns.length, h.halfPairs.length, h.burnsHeld];
        })(), [0, 1, 2]);
      // — ОТКАЗ И ЗАВИСАНИЕ В ТРАТЫ НЕ ИДУТ: они покупают знание о крае, то есть прожиг не пустой.
      ok('отказ и зависание — не пустые прожиги: они покупают край',
        harvestPairs([
          { outcome: RUNG_OUTCOME.PASSED, deliveredMhz: 2347, servingMvAfter: 840, orderedMhz: 2355, orderedMv: 840, seq: 1 },
          { outcome: RUNG_OUTCOME.FAILED, deliveredMhz: 2347, servingMvAfter: 840, orderedMhz: 2355, orderedMv: 835, seq: 2 },
          { outcome: RUNG_OUTCOME.HUNG, deliveredMhz: 2347, servingMvAfter: 845, orderedMhz: 2355, orderedMv: 830, seq: 3 },
        ]).wastedBurns.length, 0);
      // — ТОТ ЖЕ СЧЁТ С ДИСКА. Урожай и траты считает одна функция, поэтому журнал прошлого прогона
      //   можно перемерить без нового прожига (EXP-0146: инструмент пишет улики и после сессии).
      const j22 = openJournal({ dir: join(sandbox, 'harvest-waste') });
      for (const r of band2355) {
        writeIntent(j22, { seq: r.seq, frequencyMhz: r.orderedMhz, voltageMv: r.orderedMv });
        writeVerdict(j22, { seq: r.seq, at: null, outcome: r.outcome, verdict: config.VERDICT.PASS,
          servingMvAfter: r.servingMvAfter, deliveredMhz: r.deliveredMhz });
      }
      ok('ТРАТЫ ЧИТАЮТСЯ С ДИСКА тем же счётом: прошлый прогон перемеривается без нового прожига',
        (() => { const h = harvestFromJournal(readJournal(j22).records); return [h.wastedBurns.length, h.wastedBurns[0]?.seq ?? 'нет']; })(),
        [1, 762]);
    }
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
  provenRungs, harvestPairs, harvestFromJournal,
};
