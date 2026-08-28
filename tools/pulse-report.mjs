#!/usr/bin/env node
// pulse-report.mjs — the sampler's pulse, laid over the sweep's rungs.
//
// Plan anchor: `plans/27` §27.3. Parent: `ideas/10` — «пульс сэмплера как ЧЕТВЁРТОЕ наблюдение».
//
// WHAT THIS TOOL IS FOR. The card's edge on this silicon does not corrupt numbers — it strangles the
// system (fact 39: 584 burns, 0 SDC, 0 CRASH). The three observations R4 requires all watch OUR WORK
// and stayed silent through a rung that killed the machine two minutes later. The telemetry sampler
// is a SEPARATE process, not blocked by the burn, and on that same rung it lost two ticks where the
// three safe rungs before it lost none. This tool is what makes that comparison repeatable.
//
// 🔴 WHAT THIS REPORT DOES NOT DO: pick the PRECISE threshold number. `ideas/10` §5.1 is right that
// n = 1 cannot yield one, and this project has already paid for an alarm that lies on schedule
// (`bugs/27`). ⚠️ BUT that caution is about the REPORT and the exact number only — it must NOT be
// read as «the instrument gives no verdict»: the owner named that reading a lie (`bugs/62`,
// 2026-08-26), and the standing canon is «ЛАГ ТЕЛЕМЕТРИИ — ЭТО ОТКАЗ» (`GOAL.md`): the background
// (1008…1053 ms) and the precursors (3042/4490 ms) have NOTHING between them — the distinction
// needs no threshold. Wiring the rung's pulse into the verdict is `bugs/61`; the live-run stop is
// carried by the fuse (epic 51).
//
// GPU WRITES: NONE. Reads two files and prints.
//
// ⚠️ THE JOURNAL IS READ WITH PURE FUNCTIONS ONLY — `readJournal`, and nothing else. `resumeState`,
// `closeHangs`, `closeAsOperatorStop` and `writeCorrection` are WRITERS: they close orphaned intents
// as hangs, and a rung in flight is orphaned BY CONSTRUCTION. Three diagnostic calls during a live
// sweep once wrote three false hangs into the production journal (session 38). This tool may well be
// run while a sweep is going; it must not be able to do that.
//
// Usage:
//   node tools/pulse-report.mjs                        the newest archived pulse
//   node tools/pulse-report.mjs --all                  every archived pulse, one summary line each
//   node tools/pulse-report.mjs <file>                 one named file
//   node tools/pulse-report.mjs <file> --intervals     every interval, not just the gapped rungs
//   node tools/pulse-report.mjs --rung-profile         WHERE inside a rung the card idles (bugs/53)
//   node tools/pulse-report.mjs --selftest             the blocks
//
// [TESTED: 2026-08-23 12:5x · 24 блока офлайн + 11 мутаций, каждая красит свои; и прогон на
// ЗАХВАЧЕННЫХ файлах рокового прогона воспроизвёл таблицу `ideas/10` §2 машиной: 865 · 860 · 850 мВ
// дают 0,11-0,13 с сверх обещания, 845 мВ — 4,49 с при максимуме 3366 мс]

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  readPulseFile, pulseIntervals, pulseSummary, parseSampleTime, archivePulseFile, appendSampleLine,
  PULSE_BINS, PULSE_ARCHIVE_DIR,
} from '../automation-engine/lib/hardware-mon.mjs';
// `readJournal` and NOTHING else from this module — see the header. It needs only `.path`, so the
// journal handle is built here rather than through `openJournal`, which would `mkdirSync` the
// production directory. A read-only tool creates nothing.
import { readJournal } from '../automation-engine/lib/sweep-journal.mjs';
import { TELEMETRY_PATH } from '../automation-engine/lib/run-dashboard.mjs';

// =================================================================================================
// 1. The rungs, from the journal
// =================================================================================================

/**
 * Parse the journal's stamp — `2026-08-23T11:51:57+03:00` — into epoch ms.
 *
 * This one IS an ISO-8601 string with an explicit offset, which `Date.parse` is required to accept,
 * so unlike the sampler's `YYYY/MM/DD` format it is not hand-parsed. The difference is stated rather
 * than left to look like an inconsistency.
 */
export function parseJournalTime(at) {
  const ms = Date.parse(String(at ?? ''));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The rungs a journal describes, each as a window in time: from its intent to its verdict.
 *
 * A rung with NO verdict is kept and its window is left open. That is not missing data — an orphaned
 * intent is the journal's way of saying the machine died there (R15), and it is precisely the rung
 * whose pulse this tool exists to look at. It is marked, never dropped.
 *
 * 🔴 BUT AN ORPHAN'S WINDOW IS CLOSED BY THE NEXT RUNG, NOT LEFT OPEN FOREVER — and this cost a
 * wrong answer on the first real run of the tool. The production journal holds 671 rungs across many
 * days and several dead machines. With orphans left unbounded, an orphan from AUGUST 22 matched
 * every interval of the August 23 file, and the report confidently attributed the fatal run's two
 * gaps to «2542 МГц / 895 мВ ЗАВИС» — a rung from a different run, a different band, a different day.
 *
 * The bound is not invented: the journal is sequential, so the NEXT intent existing at all proves
 * the previous rung is over — the machine rebooted and somebody launched again. Only the journal's
 * LAST rung has a genuinely open window, because only for it is there no later fact.
 *
 * [TESTED: 2026-08-23 12:5x · блоки 15а/15б на захваченном журнале; мутации PK и PN красят свои.
 *  И на БОЕВОМ журнале в 671 ступень отчёт после правки назвал 4 ступени 2797 МГц вместо одной
 *  чужой «2542 МГц / 895 мВ ЗАВИС», которую он называл до неё]
 */
export function rungsFromJournal(records) {
  const intents = records.filter((r) => r?.state === 'intent');
  const verdicts = new Map();
  for (const r of records) if (r?.state === 'verdict') verdicts.set(r.seq, r);

  const rungs = intents.map((intent) => {
    const v = verdicts.get(intent.seq) ?? null;
    return {
      seq: intent.seq,
      frequencyMhz: intent.frequencyMhz,
      voltageMv: intent.voltageMv,
      fromAt: parseJournalTime(intent.at),
      toAt: v ? parseJournalTime(v.at) : null,
      verdict: v?.verdict ?? null,
      outcome: v?.outcome ?? null,
      // No verdict = the writer stopped existing mid-rung. The journal's own first-class answer,
      // and it stays true regardless of where the window is closed: `orphaned` is about the
      // VERDICT, the window is about TIME, and conflating them is what produced the wrong answer.
      orphaned: v === null,
    };
  }).filter((r) => r.fromAt !== null).sort((a, b) => a.fromAt - b.fromAt);

  for (let k = 0; k < rungs.length - 1; k++) {
    if (rungs[k].toAt === null) rungs[k].toAt = rungs[k + 1].fromAt;
  }
  return rungs;
}

// =================================================================================================
// 2. The join — which gap fell in which rung
// =================================================================================================

/**
 * Lay the intervals over the rungs.
 *
 * An interval belongs to the rung whose window CONTAINS ITS END. The end, not the start, and not the
 * midpoint: the interval is the sampler's silence, and the moment it is noticed is the moment the
 * next probe finally lands. Attributing a 3-second silence to whatever rung it began in would credit
 * the stall to the rung that survived rather than to the one that caused it.
 *
 * An open rung (no verdict) runs to the end of the file — its window has no closing edge, because
 * the thing that would have written one is dead.
 *
 * Intervals falling in no rung at all are counted separately, never forced into the nearest one:
 * the sampler runs before the first rung and between rungs, and the card is idle there. Folding
 * idle time into a rung would put the sweep's own start-up cost inside a measurement of silicon.
 *
 * [TESTED: 2026-08-23 12:5x · блоки 14 · 15 · 16 · 17; мутации PJ и PL красят свои]
 */
export function layPulseOverRungs(intervals, rungs, { fileEndAt = null } = {}) {
  const rows = rungs.map((r) => ({ ...r, intervals: 0, overshootMs: 0, maxMs: null, longest: [] }));
  let outside = 0;

  for (const x of intervals) {
    const at = parseSampleTime(x.toT);
    if (at === null) continue;
    const row = rows.find((r) => at >= r.fromAt && (r.toAt !== null ? at <= r.toAt : (fileEndAt === null || at <= fileEndAt)));
    if (!row) { outside++; continue; }
    row.intervals++;
    row.overshootMs += x.overshootMs;
    if (row.maxMs === null || x.ms > row.maxMs) row.maxMs = x.ms;
    // The intervals worth naming individually are picked by the SMALLEST reporting bin — the same
    // bins the summary prints, so the table and the distribution cannot disagree about what «long»
    // meant. They remain bins, not a threshold: nothing here decides anything about the rung.
    if (x.multiple !== null && x.multiple >= PULSE_BINS[0]) row.longest.push({ at: x.toT, ms: x.ms, overshootMs: x.overshootMs });
  }
  return { rows, outside };
}

// =================================================================================================
// 3. Printing
// =================================================================================================

const s2 = (ms) => (ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(2)} с`);

function printFile(path, { withIntervals = false, journalPath = null } = {}) {
  const file = readPulseFile(path);
  if (!file.ok) { console.error(`ОШИБКА: ${file.why}`); return 1; }

  const sum = pulseSummary(file.records);
  const r = pulseIntervals(file.records);

  console.log(`ФАЙЛ:   ${path}`);
  console.log(`ПРОБЫ:  ${sum.samples} · период ${sum.periodMs} мс · интервалов ${sum.intervals}`
    + `${file.broken ? ` · БИТЫХ СТРОК ${file.broken}` : ''}${sum.unparsed ? ` · без времени ${sum.unparsed}` : ''}`);
  if (file.broken) {
    // Said out loud rather than counted quietly: a truncated tail on this file means the machine
    // died with samples still in the page cache, and those samples are the interesting ones
    // (`bugs/37`). A reader who does not know that reads a short file as a short run.
    console.log('        ⚠️ битая строка в конце — файл оборван; вероятно машина умерла, не сбросив кэш (`bugs/37`)');
  }
  console.log(`РАЗМАХ: медиана ${sum.medianMs} мс · максимум ${sum.maxMs} мс`);
  console.log(`СВЕРХ ОБЕЩАНИЯ: ${s2(sum.overshootMs)} за весь файл (сэмплер обещает пробу раз в ${sum.periodMs} мс)`);
  console.log('РАСПРЕДЕЛЕНИЕ — интервалов не короче, и сколько сверх обещания они дают:');
  for (const b of PULSE_BINS) {
    const c = sum.overBins[b];
    console.log(`        ×${String(b).padEnd(4)} ${String(c.count).padStart(4)} интервалов  ${s2(c.overshootMs).padStart(9)}`);
  }
  console.log('        ↑ РАСПРЕДЕЛЕНИЕ, а не вердикт. Порога здесь нет и быть не может: n = 1 (ideas/10 §5.1).');
  console.log('        Разница между строками — это дрожание; концентрация в верхних строках — это остановки.');
  console.log('');

  // ─── THE RUNGS ────────────────────────────────────────────────────────────────────────────────
  const jPath = journalPath ?? join('runs', 'sweep', 'journal.jsonl');
  if (!existsSync(jPath)) {
    console.log(`ЖУРНАЛ: ${jPath} не найден — раскладывать по ступеням не по чему`);
    return 0;
  }
  const { records: jrec } = readJournal({ path: jPath });
  const rungs = rungsFromJournal(jrec);
  const laid = layPulseOverRungs(r.intervals, rungs, { fileEndAt: sum.lastAt });
  const touched = laid.rows.filter((x) => x.intervals > 0);

  if (touched.length === 0) {
    console.log(`ЖУРНАЛ: ${rungs.length} ступеней, но ни одна не пересекается по времени с этим файлом`);
    return 0;
  }

  console.log(`СТУПЕНИ, накрытые этим файлом (${touched.length} из ${rungs.length} в журнале):`);
  console.log('');
  console.log('  частота   напряж.  вердикт   проб  сверх обещания  максимум');
  console.log('  ────────  ───────  ────────  ────  ──────────────  ────────');
  for (const x of touched) {
    const verdict = x.orphaned ? 'НЕТ ⚠️' : (x.verdict ?? '—');
    console.log(
      `  ${String(x.frequencyMhz).padStart(5)} МГц`
      + `  ${String(x.voltageMv).padStart(4)} мВ`
      + `  ${verdict.padEnd(8)}`
      + `  ${String(x.intervals).padStart(4)}`
      + `  ${s2(x.overshootMs).padStart(14)}`
      + `  ${String(x.maxMs ?? '—').padStart(6)} мс`,
    );
    for (const g of x.longest) console.log(`             долгий интервал в ${g.at} — ${s2(g.ms)}, сверх обещания ${s2(g.overshootMs)}`);
  }
  if (laid.outside > 0) {
    console.log('');
    console.log(`  вне ступеней: ${laid.outside} интервалов (сэмплер работает и до первой ступени, и между ними)`);
  }

  if (withIntervals) {
    console.log('');
    console.log('ВСЕ ИНТЕРВАЛЫ:');
    for (const x of r.intervals) {
      console.log(`  ${x.toT}  ${String(x.ms).padStart(5)} мс  ×${x.multiple.toFixed(2)}`
        + `${x.overshootMs ? `  сверх обещания ${x.overshootMs} мс` : ""}`);
    }
  }
  return 0;
}

/** Archived files, newest last — the name is the first sample's stamp, so lexical order is time order. */
export function archivedPulseFiles(dir = PULSE_ARCHIVE_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().map((f) => join(dir, f));
}

function printAll() {
  const files = archivedPulseFiles();
  if (files.length === 0) {
    console.log(`АРХИВ ПУЛЬСА: в ${PULSE_ARCHIVE_DIR} пусто.`);
    console.log('Он наполняется САМ: каждый следующий прогон убирает туда пульс предыдущего (`plans/27` §27.1).');
    return 0;
  }
  console.log(`АРХИВ ПУЛЬСА: ${files.length} прогонов в ${PULSE_ARCHIVE_DIR}`);
  console.log('');
  console.log("  файл                       проб  долгих  сверх обещ.  максимум");
  console.log("  ─────────────────────────  ────  ──────  ───────────  ────────");
  for (const f of files) {
    const rec = readPulseFile(f);
    const s = pulseSummary(rec.records);
    console.log(`  ${f.split(/[\\/]/u).pop().padEnd(25)}  ${String(s.samples).padStart(4)}`
      + `  ${String(s.overBins[PULSE_BINS[0]].count).padStart(6)}  ${s2(s.overshootMs).padStart(9)}`
      + `  ${String(s.maxMs ?? '—').padStart(6)} мс`);
  }
  console.log('');
  // The gate `ideas/10` §5.1 names, stated as a countdown rather than left to be remembered.
  const clean = files.filter((f) => !readPulseFile(f).broken).length;
  console.log('ВОРОТА ФАЗЫ 2 (ideas/10 §5.1): нужно ≥ 3 прогона, среди них ≥ 1 без смерти машины.');
  console.log(`СЕЙЧАС: прогонов ${files.length} · без обрыва файла ${clean}.`);
  console.log(files.length >= 3 && clean >= 1
    ? 'ПОРОГ МОЖНО ВЫВОДИТЬ ИЗ ДАННЫХ — фаза 2 планируется.'
    : 'ПОРОГ ВЫВОДИТЬ НЕ ИЗ ЧЕГО — назначать его сейчас значило бы выдумать число.');
  return 0;
}

// =================================================================================================
// 3a. THE RUNG PROFILE — where inside a rung the card is idle (`bugs/53`)
// =================================================================================================

/**
 * THE SECOND-BY-SECOND SHAPE OF A RUNG, averaged over every rung of a run.
 *
 * WHY IT LIVES HERE rather than in a tool of its own: this file already lays telemetry over the
 * sweep's rungs, already reads the journal with PURE functions only (the header explains why that
 * matters — three diagnostic calls once wrote three false hangs into the production journal), and
 * already writes nothing anywhere. A second tool would be a second copy of all three properties.
 *
 * WHAT IT ANSWERS, and it is `bugs/53`'s own first step («первый шаг починки не оптимизация, а
 * ЗАМЕР»): the run reports a quarter of the card's time as idle — WHERE is it? Between rungs, or
 * inside them; at the head, in the middle, or at the tail. Those three answers have completely
 * different remedies, and one of them (the middle) belongs to the burn's shape rather than to the
 * machinery, which is exactly what the 2026-08-26 measurement found.
 *
 * MEASURED THIS WAY ON 2026-08-25 22:4x — 6 rungs, ZERO variance between them:
 *   sec 0–2   idle   the head: curve write, watchdog arm, golden stamps
 *   sec 3–7   load   `furnace/transient@0` — and 5 s is exactly its ON phase
 *   sec 8–13  idle   the transient's OFF phase (5 s) plus process turnaround
 *   sec 14–22 load   `furnace/sustained@0`
 *   sec 23    idle   turnaround
 *   sec 24–34 load   `branchy/sustained`
 *   sec 35–37 idle   the tail: rollback and disarm
 * The three load blocks match the shape list's own order — an independent check that the segmentation
 * is read off the data rather than fitted to a story.
 *
 * THE LOADED/IDLE THRESHOLD IS NOT INVENTED HERE: 50 % of `utilization.gpu` is the same boundary
 * `power-baseline` already splits its halves on. One concept, one number, one place to change it.
 *
 * GPU WRITES: NONE. Two files read, a table printed.
 *
 * [NOT-TESTED] at birth — flipped by «ПРОФИЛЬ СТУПЕНИ» in `--selftest`.
 */
export const RUNG_PROFILE_LOADED_UTIL = 50;

export function rungProfile(samples, rungs, { loadedUtil = RUNG_PROFILE_LOADED_UTIL } = {}) {
  const windows = rungs.filter((r) => r.fromAt !== null).sort((a, b) => a.fromAt - b.fromAt);
  const rowAt = (ms) => {
    let hit = null;
    for (const w of windows) {
      if (ms < w.fromAt) continue;
      if (w.toAt !== null && ms > w.toAt) continue;
      hit = w;
    }
    return hit;
  };

  const bySecond = new Map();
  let loaded = 0, idle = 0, unattributed = 0;
  for (const s of samples) {
    const ms = parseSampleTime(s?.t);
    if (ms === null) continue;
    const w = rowAt(ms);
    if (!w) { unattributed++; continue; }
    const util = Number(s?.sample?.['utilization.gpu'] ?? 0);
    const isLoaded = util >= loadedUtil;
    if (isLoaded) loaded++; else idle++;
    const off = Math.floor((ms - w.fromAt) / 1000);
    if (!bySecond.has(off)) bySecond.set(off, { loaded: 0, idle: 0 });
    bySecond.get(off)[isLoaded ? 'loaded' : 'idle']++;
  }

  // Разрывы МЕЖДУ ступенями: от закрытия одной до намерения следующей. Замер 2026-08-26 на четырёх
  // прогонах подряд дал здесь РОВНО НОЛЬ — и это сузило поиск вдвое до того, как что-то трогалось.
  const gaps = [];
  for (let k = 1; k < windows.length; k++) {
    if (windows[k - 1].toAt !== null) gaps.push(windows[k].fromAt - windows[k - 1].toAt);
  }

  return {
    seconds: [...bySecond.keys()].sort((a, b) => a - b).map((off) => ({ off, ...bySecond.get(off) })),
    loaded,
    idle,
    unattributed,
    betweenRungsMs: gaps,
    rungCount: windows.length,
  };
}

function printRungProfile(path) {
  const pulse = readPulseFile(path);
  if (!pulse.ok) { console.log(pulse.why); return 1; }
  const jr = readJournal({ path: join('runs', 'sweep', 'journal.jsonl') });
  const rungs = rungsFromJournal(jr.records ?? jr ?? []);
  const samples = pulse.records.filter((r) => r?.sample && r?.t);
  if (!samples.length) { console.log('В файле нет проб с телеметрией.'); return 1; }

  // Только ступени, попадающие в окно ЭТОГО файла — иначе чужой прогон другого дня приклеится к
  // нашим пробам, как это уже случилось однажды с орфанами (см. `rungsFromJournal`).
  const t0 = parseSampleTime(samples[0].t);
  const t1 = parseSampleTime(samples[samples.length - 1].t);
  const mine = rungs.filter((r) => r.fromAt !== null && r.fromAt >= t0 - 5000 && r.fromAt <= t1 + 5000);

  const p = rungProfile(samples, mine);
  const total = p.loaded + p.idle;
  console.log(`ПРОФИЛЬ СТУПЕНИ — ${path}`);
  console.log(`  проб ${total} · ступеней ${p.rungCount} · окно ${samples[0].t} … ${samples[samples.length - 1].t}`);
  if (!total) { console.log('  Ни одна проба не легла в ступень: журнал и телеметрия из разных прогонов.'); return 1; }
  console.log(`  ПОД НАГРУЗКОЙ ${p.loaded} · В ПРОСТОЕ ${p.idle} · доля полезного ${(100 * p.loaded / total).toFixed(0)} %`
    + (p.unattributed ? ` · вне ступеней ${p.unattributed}` : ''));
  const med = (a) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const g = med(p.betweenRungsMs);
  console.log(`  МЕЖДУ ступенями: медиана ${g === null ? '—' : (g / 1000).toFixed(1) + ' с'}`
    + ` · сумма ${(p.betweenRungsMs.reduce((x, y) => x + y, 0) / 1000).toFixed(1)} с`);
  console.log('');
  console.log('  сек | нагружена | простой | картина');
  for (const row of p.seconds) {
    const n = row.loaded + row.idle;
    const share = row.loaded / n;
    const bar = '#'.repeat(Math.round(share * 20)).padEnd(20, '.');
    console.log(`  ${String(row.off).padStart(3)} | ${String(row.loaded).padStart(9)} | `
      + `${String(row.idle).padStart(7)} | ${bar} ${(100 * share).toFixed(0)}%`);
  }
  console.log('');
  console.log('  ГОЛОВА и ХВОСТ — это ЗАПИСЬ В КАРТУ И ЕЁ ОТКАТ, то есть машинерия безопасности');
  console.log('  (R5 · R9 · R10a · договор устаивания), а не накладные расходы стенда. Срезать их');
  console.log('  — та самая экономия, чья цена названа по имени: bugs/03, 5 ч 40 мин зависания.');
  return 0;
}

// =================================================================================================
// 4. The blocks
// =================================================================================================
//
// ADDRESSEES OF MUTATION, NAMED BEFORE THE RUN — the list a session mutating this code should reach
// for, so a green suite here is a claim that can be tested rather than a feeling:
//
//   PB. `overshootMs` → clamp small overshoots to zero                   (block 3, 8)
//   PE. period → take `config.TELEMETRY_SAMPLE_MS` instead of the header (block 7)
//   PF. `pulseSummary` → add a boolean «healthy» field                   (block 9)
//   PG. archive name → stamp it from the clock instead of the file       (block 10)
//   PH. archive → keep files with no parseable sample                    (block 11)
//   PI. archive → overwrite on collision                                 (block 13)
//   PJ. the join → attribute an interval by its START                    (block 14, 15)
//   PK. the join → drop rungs with no verdict                            (block 15а, 15б, 17а)
//   PL. the join → fold out-of-rung intervals into the nearest rung      (block 16)
//   PM. bins → report counts only, dropping the overshoot per bin        (block 8б)
//   PN. an orphan's window → leave it open forever                       (block 15а)
//
// Прогнаны 2026-08-23 12:5x: одиннадцать мутаций, каждая красит СВОИ блоки, ни одна не роняет набор.
//
// ⚠️ TWO MUTATIONS WERE TRIED AND REPORTED AS EQUIVALENT — recorded rather than quietly dropped,
// because «no block reddened» is a finding either way and the next session should not re-derive it:
//
//   PA. `parseSampleTime` → `Date.parse`. Reddens NOTHING on this Node build, which accepts the
//       `YYYY/MM/DD` form and agrees to the millisecond. The hand-parser is kept for PORTABILITY —
//       that form is not one the spec obliges any engine to accept — and portability is precisely
//       what a block on this machine cannot observe. Stated, not faked.
//   PC/PD. `missedTicks` and `catchUp` — see `pulseIntervals`. Both definitions were undecidable
//       and both quantities were REMOVED rather than given a block that could not judge them.
//
// THE TWO CAPTURED FIXTURES ARE THE POINT OF THIS SUITE. `pulse_2797mhz_death__captured.jsonl` and
// `journal_2797mhz_death__captured.jsonl` are the real files from 2026-08-23, committed because
// `runs/` is git-ignored and this is the project's ONLY recording of the sampler losing its tick
// before the machine died. Blocks 8 and 17 hold this code against the numbers `ideas/10` §2 measured
// by hand — and they are the reason the numbers cannot quietly change under a refactor.

const FIX = join('automation-engine', 'lib', '__fixtures__');

/** A sampler file built from stamps alone — the header plus one record per stamp given. */
function pulseOf(stamps, { periodMs = 1000 } = {}) {
  const recs = [{ i: -1, meta: { period_ms: periodMs, fields: [], sampler: 'фикстура' } }];
  stamps.forEach((t, i) => recs.push({ i, t, sample: {} }));
  return recs;
}

export function selfTest() {
  const results = [];
  // 🔴 БЛОК ОБЯЗАН ПОКРАСНЕТЬ, А НЕ УПАСТЬ — и поэтому условие и причина приходят ЗАМЫКАНИЯМИ.
  //
  // Цена этого правила уже названа в STATUS отдельным долгом (EXP-0040, страйк седьмой): падение
  // набора уносит ВЕСЬ отчёт, и «набор не дошёл до конца» читается как «ничего не найдено» — то
  // есть самая громкая поломка выглядит тише самой тихой. Здесь оно поймано в момент рождения:
  // мутация «выбрасывать ступени без вердикта» оставляла массив короче, и `rows[0].intervals`
  // ронял процесс вместо того, чтобы покрасить свой блок.
  //
  // Аргументы вычисляются ДО входа в функцию, поэтому обёртка `try` внутри неё спасает лишь то,
  // что передано незвано. Отсюда `() =>` на каждом месте вызова: это не украшение, это то, что
  // делает защиту работающей.
  const ok = (n, cond, why = '') => {
    try {
      results.push({
        n,
        ok: !!(typeof cond === 'function' ? cond() : cond),
        why: typeof why === 'function' ? why() : why,
      });
    } catch (e) {
      results.push({ n, ok: false, why: `БЛОК УПАЛ, а не покраснел: ${e?.message ?? e}` });
    }
  };

  // ─── 27.2 · чтение ─────────────────────────────────────────────────────────────────────────────
  ok('1. время пробы драйвера разбирается в миллисекунды эпохи',
    () => (parseSampleTime('2026/08/23 11:50:13.849') === new Date(2026, 7, 23, 11, 50, 13, 849).getTime()),
    () => (`получено ${parseSampleTime('2026/08/23 11:50:13.849')}`));

  ok('2. мусор вместо времени даёт null, а не NaN и не ноль',
    () => (parseSampleTime('не время') === null && parseSampleTime('') === null && parseSampleTime(undefined) === null),
    () => ('разбор принял то, что временем не является — дальше это поехало бы числом'));

  {
    // ДРОЖАНИЕ МЕРЯЕТСЯ, А НЕ ОТБРАСЫВАЕТСЯ. Оно правда есть — 2 мс сверх обещания это 2 мс, когда
    // карту никто не видел, — и клапан, зануляющий мелочь, был бы порогом под другим именем.
    const r = pulseIntervals(pulseOf(['2026/08/23 10:00:00.000', '2026/08/23 10:00:01.002']));
    ok('3. интервал 1002 мс даёт РОВНО 2 мс сверх обещания — мелочь не занулена',
      () => (r.intervals[0].overshootMs === 2), () => (`сверх обещания ${r.intervals[0].overshootMs} мс`));
  }
  {
    const r = pulseIntervals(pulseOf(['2026/08/23 10:00:00.000', '2026/08/23 10:00:03.070']));
    ok('4. интервал 3070 мс даёт 2070 мс сверх обещания и кратность 3,07',
      () => (r.intervals[0].overshootMs === 2070 && Math.abs(r.intervals[0].multiple - 3.07) < 1e-9),
      () => (`сверх обещания ${r.intervals[0].overshootMs}, кратность ${r.intervals[0].multiple}`));
  }
  {
    // Короткая проба — настоящая проба настоящей карты. Сверх обещания она не даёт НИЧЕГО, и
    // отрицательным это число не становится: время карта не возвращает.
    const r = pulseIntervals(pulseOf(['2026/08/23 10:00:00.000', '2026/08/23 10:00:00.063']));
    ok('5. интервал 63 мс сверх обещания не даёт ничего, и в минус не уходит',
      () => (r.intervals[0].overshootMs === 0 && r.intervals[0].ms === 63),
      () => (`сверх обещания ${r.intervals[0].overshootMs}, длина ${r.intervals[0].ms}`));
  }
  {
    // Первая проба не имеет предшественника, заголовок не имеет времени. Ни то ни другое не
    // превращается в интервал — синтезированный первый интервал был бы выдуманным наблюдением.
    const r = pulseIntervals(pulseOf(['2026/08/23 10:00:00.000']));
    ok('6. одна проба даёт НОЛЬ интервалов — заголовок и первая проба их не порождают',
      () => (r.intervals.length === 0 && r.samples === 1), () => (`интервалов ${r.intervals.length}, проб ${r.samples}`));
  }
  {
    // Архив, снятый с другим периодом, меряется СВОИМ периодом. Иначе месяц спустя он был бы
    // пересчитан по сегодняшнему config и вся его статистика уехала бы.
    const r = pulseIntervals(pulseOf(['2026/08/23 10:00:00.000', '2026/08/23 10:00:00.500'], { periodMs: 500 }));
    ok('7. период берётся из ЗАГОЛОВКА ФАЙЛА, а не из сегодняшнего config',
      () => (r.periodMs === 500 && r.intervals[0].overshootMs === 0),
      () => (`период ${r.periodMs}, сверх обещания ${r.intervals[0].overshootMs}`));
  }
  {
    // ЧИСЛА ПОЛЯ. Считаны руками в `ideas/10` §2 и сверены здесь с кодом.
    const f = readPulseFile(join(FIX, 'pulse_2797mhz_death__captured.jsonl'));
    const s = pulseSummary(f.records);
    const long = pulseIntervals(f.records).intervals.filter((x) => x.multiple >= PULSE_BINS[0]);
    ok('8. РОКОВОЙ ПРОГОН: 138 проб, два долгих интервала, 4436 мс сверх обещания в них — как намерено руками',
      () => (long.length === 2 && long.reduce((a, x) => a + x.overshootMs, 0) === 4436 && s.samples === 138),
      () => (`долгих ${long.length}, сверх обещания в них ${long.reduce((a, x) => a + x.overshootMs, 0)}, проб ${s.samples}`));
    ok('8а. и они стоят в СВОИ моменты — 11:52:07 и 11:52:18',
      () => (long[0]?.toT?.includes('11:52:07') && long[1]?.toT?.includes('11:52:18')),
      () => (`получено ${long.map((g) => g.toT).join(' · ')}`));
    // РАЗНИЦА МЕЖДУ ДВУМЯ ЧИСЛАМИ И ЕСТЬ ДРОЖАНИЕ, и оба обязаны быть на месте: 4840 за весь файл
    // против 4436 в двух долгих интервалах. Одно число без другого либо хоронит остановку в шуме,
    // либо прячет шум за остановкой.
    ok('8б. корзина ×1,5 несёт 4436 мс, а весь файл — 4840: разница и есть дрожание',
      () => (s.overshootMs === 4840 && s.overBins[1.5].overshootMs === 4436 && s.overBins[1.5].count === 2),
      () => (`весь файл ${s.overshootMs}, корзина ×1,5 ${s.overBins[1.5]?.overshootMs} в ${s.overBins[1.5]?.count} интервалах`));
  }
  {
    // P27-AC5. Сводка НЕ СУДИТ. Порога нет — значит и вердикта взяться неоткуда, и поле,
    // отвечающее «здоров ли прогон», было бы этим вердиктом под другим именем.
    const s = pulseSummary(pulseOf(['2026/08/23 10:00:00.000', '2026/08/23 10:00:01.000']));
    const verdictish = Object.entries(s).filter(([k, v]) => typeof v === 'boolean'
      || /^(ok|healthy|clean|edge|alarm|stalled|verdict|здоров|тревог)/iu.test(k));
    ok('9. в сводке НЕТ ВЕРДИКТА — ни одного булева поля и ни одного судящего имени',
      () => (verdictish.length === 0), () => (`найдено судящее: ${verdictish.map(([k]) => k).join(', ')}`));
  }

  // ─── bugs/37 · ДОЛГОВЕЧНОСТЬ ЗАПИСИ ────────────────────────────────────────────────────────────
  {
    // ПОРЯДОК ДОКАЗЫВАЕТСЯ СЛЕДОМ, А НЕ ЧТЕНИЕМ — тот же приём, которым журнал упреждающей записи
    // доказывает свой fsync (R15). Обычная запись возвращается из кэша страниц ОС; разницу создаёт
    // ровно одно событие — внезапная смерть машины, — и его не расписать, поэтому проверяется
    // ОТВЕТ: был ли вызван fsync, и был ли он вызван до закрытия дескриптора.
    // Проверяется ИЗВЛЕЧЁННАЯ функция, а не весь `sampleFor`: тот зовёт `nvidia-smi` за заголовком и
    // создаёт настоящий файл, то есть набор перестал бы быть офлайновым и инертным. Извлечение и
    // сделано ради этого — блок, дотягивающийся только до нужного шва, сторожит вопрос, а не ответ
    // (EXP-0108). Ни одного байта на диск, ни одного порождённого процесса.
    const trace = [];
    const io = {
      openSync: (p, flag) => { trace.push(`open:${flag}`); return 7; },
      // БЕЗ `trim()`: первая редакция обрезала здесь перевод строки — то есть ровно ту величину,
      // наличие которой блок 18в объявляет проверенной. Мутация PR («потерять \n») не покрасила
      // ничего именно поэтому. Подставной шов обязан отдавать сырое, иначе он судит себя.
      writeSync: (fd, line) => { trace.push(`write:${JSON.stringify(line)}`); return 0; },
      fsyncSync: () => { trace.push('fsync'); },
      closeSync: () => { trace.push('close'); },
    };
    appendSampleLine('фикстура.jsonl', { i: 0, t: 'проба' }, io);
    ok('18. КАЖДАЯ ПРОБА ФСИНКАЕТСЯ: порядок ровно открыть → записать → fsync → закрыть (`bugs/37`)',
      () => trace.map((x) => x.split(':')[0]).join(' ') === 'open write fsync close',
      () => `след: ${trace.join(' → ') || '(пусто)'}`);
    ok('18а. fsync стоит ДО закрытия дескриптора — после закрытия он бы уже ничего не гарантировал',
      () => trace.indexOf('fsync') >= 0 && trace.indexOf('fsync') < trace.indexOf('close'),
      () => `след: ${trace.join(' → ')}`);
    ok('18б. файл открыт на ДОПИСЫВАНИЕ, а не на перезапись — иначе каждая проба стирала бы прошлые',
      () => trace[0] === 'open:a', () => `первый шаг: ${trace[0]}`);
    ok('18в. записана ровно одна строка JSONL, и она КОНЧАЕТСЯ ПЕРЕВОДОМ СТРОКИ',
      () => trace[1] === `write:${JSON.stringify('{"i":0,"t":"проба"}\n')}`,
      () => `записано: ${trace[1]}`);
  }

  // ─── 27.1 · архив ──────────────────────────────────────────────────────────────────────────────
  {
    // Имя берётся из ПЕРВОЙ ПРОБЫ, а не из часов момента переноса: архив обязан называть, когда
    // снималась телеметрия. Часы момента подделать нельзя — их подставляет мутация PG.
    const files = new Map([['live.jsonl', pulseOf(['2026/08/23 11:50:13.849']).map((r) => JSON.stringify(r)).join('\n')]]);
    let moved = null;
    const fs = {
      existsSync: (p) => files.has(p),
      mkdirSync: () => {},
      readFileSync: (p) => files.get(p),
      renameSync: (from, to) => { moved = { from, to }; files.delete(from); },
    };
    const r = archivePulseFile('live.jsonl', { dir: 'арх', fs });
    ok('10. архив назван ПЕРВОЙ ПРОБОЙ файла (20260823-115013), а не часами переноса',
      () => (r.archived && /20260823-115013\.jsonl$/u.test(r.to)), () => (`перенесено в ${r.to} (${r.why})`));
    ok('10а. и файл действительно ПЕРЕНЕСЁН, а не скопирован',
      () => (moved !== null && moved.from === 'live.jsonl'), () => ('renameSync не вызван'));
  }
  {
    // Файл без единой пробы — не улика. Сэмплер оставляет ровно такой, если его завели и убили
    // в ту же секунду; архив из таких файлов пришлось бы сперва научиться фильтровать.
    // 🔴 ПОДСТАВНОЙ `renameSync` ЗАПИСЫВАЕТ ПОПЫТКУ, А НЕ БРОСАЕТ. Первая редакция бросала — и блок
    // был ЗЕЛЁН ПО ЛОЖНОЙ ПРИЧИНЕ: `archivePulseFile` ловит ошибку переноса и сама возвращает
    // `archived: false`, так что «отказался» и «попытался и не смог» становились неразличимы.
    // Мутация PH («хранить и файлы без проб») не покрасила ничего именно из-за этого.
    const files = new Map([['live.jsonl', JSON.stringify({ i: -1, meta: { period_ms: 1000 } })]]);
    let attempted = false;
    const fs = {
      existsSync: (p) => files.has(p), mkdirSync: () => {},
      readFileSync: (p) => files.get(p),
      renameSync: () => { attempted = true; },
    };
    const r = archivePulseFile('live.jsonl', { dir: 'арх', fs });
    ok('11. файл БЕЗ ПРОБ не архивируется — и перенос даже НЕ ПЫТАЕТСЯ произойти',
      () => (r.archived === false && attempted === false && /не улика/u.test(r.why)),
      () => (`архивировано=${r.archived}, перенос пытался=${attempted}, причина «${r.why}»`));
  }
  {
    const fs = { existsSync: () => false, mkdirSync: () => {}, readFileSync: () => '', renameSync: () => {} };
    const r = archivePulseFile('нет-такого.jsonl', { dir: 'арх', fs });
    ok('12. отсутствие предыдущего файла — не ошибка, а «архивировать нечего»',
      () => (r.archived === false && /нет/u.test(r.why)), () => (`получено «${r.why}»`));
  }
  {
    // Столкновение имён НЕ ЗАТИРАЕТ. Вся функция существует ради того, чтобы здесь ничего не
    // уничтожалось; перезапись по совпадению секунды была бы ровно тем, от чего она заведена.
    // `join`, а не строка со слэшем: на Windows разделитель обратный, и подставной `existsSync`,
    // сравнивающий с `'арх/…'`, не совпал бы никогда — блок покраснел бы на исправном коде.
    const existing = new Set(['live.jsonl', join('арх', '20260823-115013.jsonl')]);
    let target = null;
    const fs = {
      existsSync: (p) => existing.has(p), mkdirSync: () => {},
      readFileSync: () => pulseOf(['2026/08/23 11:50:13.849']).map((r) => JSON.stringify(r)).join('\n'),
      renameSync: (from, to) => { target = to; },
    };
    const r = archivePulseFile('live.jsonl', { dir: 'арх', fs });
    ok('13. совпадение имени НЕ затирает архив — берётся следующее свободное',
      () => (r.archived && /20260823-115013-2\.jsonl$/u.test(target)), () => (`перенесено в ${target}`));
  }

  // ─── 27.3 · раскладка по ступеням ──────────────────────────────────────────────────────────────
  {
    // Интервал приписывается ступени по СВОЕМУ КОНЦУ. Интервал — это молчание сэмплера, а замечено
    // оно тогда, когда наконец приходит следующая проба. Приписать трёхсекундное молчание ступени,
    // в которой оно НАЧАЛОСЬ, значит записать провал на ступень, которая его пережила.
    const rungs = [
      { seq: 1, frequencyMhz: 2797, voltageMv: 850, fromAt: 1000, toAt: 2000, verdict: 'PASS', orphaned: false },
      { seq: 2, frequencyMhz: 2797, voltageMv: 845, fromAt: 2000, toAt: 3000, verdict: 'PASS', orphaned: false },
    ];
    // 🔴 `fromT` ОБЯЗАН ЗДЕСЬ БЫТЬ, и он несёт ДРУГОЕ время, чем `toT`. Первая редакция этого блока
    // подставляла интервал без `fromT` — и мутация PJ («приписывать по началу») не покрасила
    // ничего, потому что откатывалась на `toT` за неимением начала. Блок, чья фикстура лишена
    // различаемой величины, не проверяет ничего (EXP: та же форма, что мутация CX сессии 39).
    const iv = [{ fromT: '2026/08/23 09:59:58.000', toT: '2026/08/23 10:00:00.000', ms: 2000, overshootMs: 1000, multiple: 2 }];
    const at = parseSampleTime('2026/08/23 10:00:00.000');
    // Окна ступеней ставятся так, что НАЧАЛО интервала лежит в 850 мВ, а КОНЕЦ — в 845 мВ.
    const shifted = [
      { ...rungs[0], fromAt: at - 4000, toAt: at - 1000 },
      { ...rungs[1], fromAt: at - 999, toAt: at + 1000 },
    ];
    const laid = layPulseOverRungs(iv, shifted);
    ok('14. интервал приписан ступени по СВОЕМУ КОНЦУ (845 мВ), а не по началу (850 мВ)',
      () => (laid.rows[1].intervals === 1 && laid.rows[0].intervals === 0),
      () => (`850 мВ получила ${laid.rows[0].intervals}, 845 мВ получила ${laid.rows[1].intervals}`));
  }
  {
    // Осиротевшая ступень — та, на которой умерла машина. Её окно НЕ ЗАКРЫТО, потому что закрыть
    // его было некому, и выбросить её значило бы выбросить ровно ту ступень, ради которой всё это.
    const at = parseSampleTime('2026/08/23 10:00:05.000');
    const rungs = [{ seq: 9, frequencyMhz: 2797, voltageMv: 840, fromAt: at - 1000, toAt: null, verdict: null, orphaned: true }];
    const iv = [{ fromT: '2026/08/23 10:00:02.000', toT: '2026/08/23 10:00:05.000', ms: 3000, overshootMs: 2000, multiple: 3 }];
    const laid = layPulseOverRungs(iv, rungs, { fileEndAt: at + 10_000 });
    ok('15. ступень БЕЗ ВЕРДИКТА сохраняет открытое окно и получает свои интервалы',
      () => (laid.rows[0].intervals === 1 && laid.rows[0].overshootMs === 2000),
      () => (`интервалов ${laid.rows[0].intervals}, сверх обещания ${laid.rows[0].overshootMs}`));
  }
  {
    // 🔴 ОСИРОТЕВШАЯ СТУПЕНЬ ЧУЖОГО ПРОГОНА НЕ ЗАБИРАЕТ СЕБЕ СЕГОДНЯШНИЙ ФАЙЛ. Ровно то, что
    // случилось на первом же настоящем прогоне прибора: боевой журнал несёт 671 ступень за много
    // дней и несколько смертей машины, и осиротевшая ступень 22 августа присвоила себе оба провала
    // 23-го — отчёт назвал «2542 МГц / 895 мВ ЗАВИС» вместо 2797 МГц.
    const rec = [
      { state: 'intent', seq: 1, frequencyMhz: 2542, voltageMv: 895, at: '2026-08-22T20:00:00+03:00' },
      // вердикта у seq 1 НЕТ — машина умерла. Но назавтра запустились снова:
      { state: 'intent', seq: 2, frequencyMhz: 2797, voltageMv: 845, at: '2026-08-23T11:51:57+03:00' },
      { state: 'verdict', seq: 2, verdict: 'PASS', at: '2026-08-23T11:52:32+03:00' },
    ];
    const rungs = rungsFromJournal(rec);
    // Опциональная цепочка НЕ украшение: блок обязан ПОКРАСНЕТЬ, а не упасть. Мутация «выбрасывать
    // ступени без вердикта» оставляет здесь одну строку вместо двух, и прямое `rungs[1].fromAt`
    // роняло весь набор — а упавший набор читается как «ничего не найдено» (EXP-0040).
    const closedAtNext = rungs.length === 2 && rungs[0]?.toAt === rungs[1]?.fromAt;
    const iv = [{ fromT: '2026/08/23 11:52:04.835', toT: '2026/08/23 11:52:07.905', ms: 3070, overshootMs: 2070, multiple: 3.07 }];
    const laid = layPulseOverRungs(iv, rungs, { fileEndAt: parseSampleTime('2026/08/23 11:52:30.843') });
    ok('15а. осиротевшая ступень ЧУЖОГО прогона закрыта следующей и не забирает сегодняшние провалы',
      () => (closedAtNext && laid.rows[0].intervals === 0 && laid.rows[1].intervals === 1),
      () => (`окно закрыто следующей=${closedAtNext}, 2542 МГц забрала ${laid.rows[0].intervals}, 2797 МГц ${laid.rows[1].intervals}`));
    ok('15б. и при этом она ОСТАЁТСЯ осиротевшей — окно про время, вердикт про смерть',
      () => (rungs[0].orphaned === true && rungs[1].orphaned === false),
      () => (`2542: осиротевшая=${rungs[0].orphaned}, 2797: осиротевшая=${rungs[1].orphaned}`));
  }
  {
    // Сэмплер работает и до первой ступени, и между ними — там карта простаивает. Свернуть это
    // время в ближайшую ступень значило бы положить стартовые расходы развёртки внутрь замера кремния.
    const at = parseSampleTime('2026/08/23 10:00:00.000');
    const rungs = [{ seq: 1, frequencyMhz: 2797, voltageMv: 850, fromAt: at + 60_000, toAt: at + 90_000, verdict: 'PASS', orphaned: false }];
    const iv = [{ fromT: '2026/08/23 09:59:55.000', toT: '2026/08/23 10:00:00.000', ms: 5000, overshootMs: 4000, multiple: 5 }];
    const laid = layPulseOverRungs(iv, rungs);
    ok('16. интервал ВНЕ всех ступеней считается отдельно, а не вминается в ближайшую',
      () => (laid.outside === 1 && laid.rows[0].intervals === 0),
      () => (`вне ступеней ${laid.outside}, ступень получила ${laid.rows[0].intervals}`));
  }
  {
    // ГЛАВНОЕ ЧИСЛО ИДЕИ, СВЕРЕННОЕ С ПОЛЕМ: сигнал РАЗЛИЧАЕТ. Три безопасные ступени подряд чисты,
    // последняя перед смертью — нет. Именно это утверждение `ideas/10` §2 и делает, и именно оно
    // обязано краснеть, если раскладка когда-нибудь перестанет попадать в ступени.
    const f = readPulseFile(join(FIX, 'pulse_2797mhz_death__captured.jsonl'));
    const j = readJournal({ path: join(FIX, 'journal_2797mhz_death__captured.jsonl') });
    const s = pulseSummary(f.records);
    const laid = layPulseOverRungs(pulseIntervals(f.records).intervals, rungsFromJournal(j.records), { fileEndAt: s.lastAt });
    const by = (mv) => laid.rows.find((x) => x.voltageMv === mv);
    ok('17. РОКОВАЯ СТУПЕНЬ РАЗЛИЧЕНА: у 865 · 860 · 850 мВ долгих интервалов НЕТ, у 845 мВ — оба',
      () => (by(865)?.longest.length === 0 && by(860)?.longest.length === 0 && by(850)?.longest.length === 0
      && by(845)?.longest.length === 2 && by(845)?.overshootMs >= 4436),
      () => (`865:${by(865)?.longest.length} 860:${by(860)?.longest.length} 850:${by(850)?.longest.length} `
      + `845:${by(845)?.longest.length} (сверх обещания ${by(845)?.overshootMs})`));
    ok('17а. и ступень 840 мВ — та, на которой умерла машина — опознана как осиротевшая',
      () => (by(840)?.orphaned === true), () => (`840 мВ: осиротевшая=${by(840)?.orphaned}`));
    ok('17б. а оракул на всех четырёх сказал PASS — то, чего три наблюдения R4 не увидели',
      () => ([865, 860, 850, 845].every((mv) => by(mv)?.verdict === 'PASS')),
      () => (`вердикты: ${[865, 860, 850, 845].map((mv) => `${mv}:${by(mv)?.verdict}`).join(' ')}`));
  }

  // ─── bugs/53 · ПРОФИЛЬ СТУПЕНИ ─────────────────────────────────────────────────────────────────
  // Данные ПОСТРОЕНЫ, а не сняты: блок обязан доказывать разметку, а не повторять один прогон.
  // Ступень длится 8 с; нагрузка стоит на секундах 2..5, простой — по краям. Это миниатюра того,
  // что замер 2026-08-26 нашёл на кремнии: голова, тело, хвост.
  //
  // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
  //   PR. считать смещение от НАЧАЛА ФАЙЛА, а не от начала ступени → «СЕКУНДА СЧИТАЕТСЯ ОТ СТУПЕНИ»
  //   PS. класть пробу вне окна в ближайшую ступень                → «ПРОБА ВНЕ СТУПЕНЕЙ НЕ ПРИПИСЫВАЕТСЯ»
  //   PT. взять порог нагрузки нулём                               → «ПОРОГ НАГРУЗКИ РАЗДЕЛЯЕТ»
  {
    const base = new Date(2026, 7, 26, 12, 0, 0, 0).getTime();
    const stamp = (ms) => {
      const d = new Date(ms);
      const q = (n, w = 2) => String(n).padStart(w, '0');
      return `${d.getFullYear()}/${q(d.getMonth() + 1)}/${q(d.getDate())} `
        + `${q(d.getHours())}:${q(d.getMinutes())}:${q(d.getSeconds())}.${q(d.getMilliseconds(), 3)}`;
    };
    // Две ступени по 8 с, встык — ровно как их пишет журнал (разрыв между ними ноль).
    const rungs = [
      { seq: 1, frequencyMhz: 2842, voltageMv: 900, fromAt: base, toAt: base + 8000, verdict: 'PASS', orphaned: false },
      { seq: 2, frequencyMhz: 2835, voltageMv: 895, fromAt: base + 8000, toAt: base + 16000, verdict: 'PASS', orphaned: false },
    ];
    const mk = (ms, util) => ({ t: stamp(ms), sample: { 'utilization.gpu': util } });
    const samples = [];
    for (const r of rungs) {
      for (let sec = 0; sec < 8; sec++) {
        samples.push(mk(r.fromAt + sec * 1000, sec >= 2 && sec <= 5 ? 99 : 3));
      }
    }
    // И одна проба ЗАДОЛГО до первой ступени — ей в ступени места нет.
    samples.unshift(mk(base - 60000, 4));

    const prof = rungProfile(samples, rungs);
    const at = (off) => prof.seconds.find((x) => x.off === off);

    ok('bugs/53 · СЕКУНДА СЧИТАЕТСЯ ОТ СТУПЕНИ, а не от начала файла: обе ступени дают один профиль',
      () => ([0, 1, 6, 7].every((o) => at(o) && at(o).loaded === 0 && at(o).idle === 2)
        && [2, 3, 4, 5].every((o) => at(o) && at(o).loaded === 2 && at(o).idle === 0)),
      () => ('профиль: ' + prof.seconds.map((x) => `${x.off}:${x.loaded}/${x.idle}`).join(' ')));
    ok('bugs/53 · ПОРОГ НАГРУЗКИ РАЗДЕЛЯЕТ: под нагрузкой 8 проб, в простое 8',
      () => (prof.loaded === 8 && prof.idle === 8),
      () => (`нагружено ${prof.loaded} · простой ${prof.idle}`));
    ok('bugs/53 · ПРОБА ВНЕ СТУПЕНЕЙ НЕ ПРИПИСЫВАЕТСЯ ближайшей — она считается отдельно',
      () => (prof.unattributed === 1),
      () => (`вне ступеней ${prof.unattributed}`));
    ok('bugs/53 · РАЗРЫВ МЕЖДУ СТУПЕНЯМИ СЧИТАЕТСЯ — встык это ноль, и ноль это ЗАМЕР',
      () => (prof.betweenRungsMs.length === 1 && prof.betweenRungsMs[0] === 0),
      () => (`разрывы ${JSON.stringify(prof.betweenRungsMs)}`));
    // Сторож обязан УМЕТЬ увидеть разрыв, иначе «ноль между ступенями» ничего не значит.
    ok('bugs/53 · и он ВИДИТ разрыв, когда тот есть — иначе ноль был бы слепотой, а не замером',
      () => {
        const moved = [rungs[0], { ...rungs[1], fromAt: base + 11000, toAt: base + 19000 }];
        return rungProfile(samples, moved).betweenRungsMs[0] === 3000;
      },
      () => ('разрыв со сдвинутой второй ступенью не опознан'));
  }

  return { ok: results.every((x) => x.ok), results };
}

// =================================================================================================
// 5. CLI
// =================================================================================================

async function main(argv) {
  if (argv.includes('--selftest')) {
    const r = selfTest();
    for (const x of r.results) console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.n}${x.ok ? '' : `\n       причина: ${x.why}`}`);
    console.log('');
    console.log(r.ok ? `САМОПРОВЕРКА ПУЛЬСА: ${r.results.length} блоков, все сходятся.` : 'САМОПРОВЕРКА ПУЛЬСА: есть расхождения.');
    return r.ok ? 0 : 1;
  }
  if (argv.includes('--all')) return printAll();

  const named = argv.find((a) => !a.startsWith('--')) ?? null;
  const withIntervals = argv.includes('--intervals');

  // ПРОФИЛЬ СТУПЕНИ (`bugs/53`) — тот же вход, тот же контракт «ничего не пишем», другой вопрос.
  if (argv.includes('--rung-profile')) {
    if (named) return printRungProfile(named);
    const arch = archivedPulseFiles();
    if (arch.length) return printRungProfile(arch[arch.length - 1]);
    if (existsSync(TELEMETRY_PATH)) return printRungProfile(TELEMETRY_PATH);
    console.log('Ни архива, ни текущего файла телеметрии нет.');
    return 1;
  }

  if (named) return printFile(named, { withIntervals });

  // No file named: the newest archived one, and failing that the live one — a run in progress is a
  // perfectly good thing to look at, and refusing to would make this tool useless exactly when the
  // operator is watching a sweep and wants to know whether the pulse is clean.
  const files = archivedPulseFiles();
  if (files.length > 0) return printFile(files[files.length - 1], { withIntervals });
  if (existsSync(TELEMETRY_PATH)) {
    console.log('АРХИВ ПУСТ — читаю ТЕКУЩИЙ файл сэмплера (возможно, прогон идёт прямо сейчас).');
    console.log('');
    return printFile(TELEMETRY_PATH, { withIntervals });
  }
  console.log('Ни архива, ни текущего файла телеметрии нет.');
  return 0;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
