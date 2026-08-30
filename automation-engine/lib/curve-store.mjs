#!/usr/bin/env node
// automation-engine/lib/curve-store.mjs — THE TUNING CURVE: for every FREQUENCY on the card's grid,
// the voltage that serves it.
//
// Plan anchor (plans/14 §4.2, the owner's `ideas/03` steps 1–2 and 5), and the terminology is HIS,
// settled 2026-08-15: *«МЫ ПРЕКРАЩАЕМ НАЗЫВАТЬ ТОЧКИ НОМЕРАМИ. МЫ НАЗЫВАЕМ ТОЧКИ ЧАСТОТОЙ… Карта
// хочет сменить частоту — она устанавливает новую частоту, мы обслуживаем её соответствующим
// напряжением. Всё. Нет никаких "точка 120". Есть только частоты по сетке частот.»*
//
// ─── WHY HIS FRAMING IS THE CORRECT ONE, not merely the one we were told to use ─────────────────
//
// The first version of this file keyed by table INDEX and stored a frequency per index. That made an
// index look like an object that MOVES: «point 120 read 3112 MHz cold and 3105 at 57 °C», with a
// reclassification pass to chase it. In the owner's framing that observation does not exist. What
// exists is simpler and true: **1200 mV served 3112 MHz cold and 3105 MHz warm** — a statement about
// what a frequency COSTS, not about a point travelling.
//
// And it makes the artifact STABLE. «Frequency → voltage» is what we search for and what we keep, and
// it does not depend on the temperature of the measurement. The per-entry offsets the hardware wants
// DO depend on it — so they are COMPUTED at apply time from the live table and never stored. The old
// shape stored exactly the thing that moves.
//
// ─── THE ONE HARDWARE LIMIT, STATED UP FRONT ────────────────────────────────────────────────────
//
// The card's write interface is 127 table entries, each at a FIXED voltage; only the entry's
// frequency is writable. So the 389 grid frequencies CANNOT each get an independent voltage —
// **neighbouring frequencies share one**, because there are only 127 voltage rungs (450…1240 mV,
// 5 mV in 94 places and 10 mV in 32). «Serve the frequency with its voltage» is therefore executed
// with the nearest rung AT OR ABOVE the measured minimum. There is no other quantity the card takes.
//
// GPU WRITES: none. This module reads the card to seed a document and to verify one; it never writes.
//
// Usage:
//   npm run curve -- --grids     probe and store both card dictionaries (ideas/03 steps 3–4)
//   npm run curve -- --init      seed frequency → voltage from the live card (step 5)
//   npm run curve -- --show      print the table
//   npm run curve -- --verify    hold the document against the live card
//   npm run curve -- --progress  the delivery line: edges known / 389, modes shipped / 4 (ideas/14)
//   npm run curve -- --selftest  hostile fixtures, no GPU
//
// [NOT-TESTED] — born 2026-08-15 with plan 14; re-keyed to frequency the same day on the owner's word.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CLOCK_OFFSET_MIN_MHZ, CLOCK_OFFSET_MAX_MHZ, CURVE_GRAPHICS_POINT_COUNT } from '../config.mjs';
import { CURVES_DIR, writeJsonAtomic, loadGrid, localIso, buildGrids, writeGrids, validateGrid, probeGpuInfo } from './card-grids.mjs';

export { CURVES_DIR };

/**
 * The statuses a frequency may carry. CLOSED — an unknown status is refused, never ignored.
 *
 * The three PROOF statuses are the owner's own words from `ideas/03`, quoted rather than paraphrased:
 *   step  9 — «точка проверена, работает, доказано коротким прожигом»  → short-burn-proved
 *   step 12 — «протестирована, край найден!»                           → edge-found
 *   step 15 — «доказаны длительным прожигом»                           → long-burn-proved
 *
 * TWO STATUSES WERE REMOVED when the document was re-keyed to frequency: `clock-floor` and
 * `above-card-max` were artifacts of numbering table entries. The frequency grid IS 180…3090 MHz —
 * there is nothing above the card's maximum by construction, and the bottom of the grid is just its
 * bottom.
 */
export const CURVE_STATUS = Object.freeze({
  /** The factory voltage for this frequency, as read. Nothing tuned yet. */
  STOCK: 'stock',
  /** A rung is IN FLIGHT — written before the card is touched, so a hang leaves a trace and the next
   *  launch knows which rung killed the machine (`ideas/03` step 12, phase 2). */
  PROBING: 'probing',
  /** This frequency held the owner's 10 s burn at this voltage. */
  SHORT_BURN_PROVED: 'short-burn-proved',
  /** One rung lower failed; parked at V_fail + 10 mV (his margin, two grid steps). */
  EDGE_FOUND: 'edge-found',
  /** Held the long burn — one minute since his amendment of 2026-08-15. */
  LONG_BURN_PROVED: 'long-burn-proved',
  /** The ±1000 MHz offset range ran out BEFORE the silicon did: no LOWER voltage can be made to serve
   *  this frequency at all, because the entry holding it would have to be shifted further than the
   *  driver accepts. **Not an edge**, and it must never be reported as one — measured, 45 mV of
   *  headroom at 1700 MHz against 245 at 2842 (`researches/09` §3.3). */
  LEVER_LIMITED: 'lever-limited',
  /** THE RUN'S OWN CONDITION STOPPED THE DESCENT — `--max-depth`, the operator's ceiling — while the
   *  offset range still had room. **A different fact about the world, and it used to be recorded as
   *  the one above.**
   *
   *  Why this had to become its own status rather than stay prose: on 2026-08-17 the owner read a
   *  finished run and asked what «предел рычага» meant, because **54 of the 54 rows closed that night
   *  carried it and NOT ONE of them had hit the offset range** — every single one stopped at his own
   *  −100 mV. The `provenBy` witness said so literally («остановлено НАШИМ потолком глубины 100 мВ
   *  (… достаёт до −170 мВ)»), and the STATUS beside it said the opposite. A reader who trusts the
   *  status concludes the card cannot go lower; the truth is that we chose not to look.
   *
   *  It had been noticed the day before and left alone because «the vocabulary is CLOSED». That was
   *  the wrong reading of a good rule: the vocabulary is closed against ACCIDENTAL values — an unknown
   *  status is refused by name — not against correcting a statement that is false. A closed vocabulary
   *  containing a lie is worse than an open one, because the closure is what makes readers trust it.
   *
   *  ⚠️ NOT a third VERDICT. The owner settled that a frequency has two («край найден» / «предел
   *  рычага», `plans/13`), and that decision is untouched: this is the DOCUMENT's record of what
   *  stopped the descent, which is a different question from what the run concluded. */
  DEPTH_CAPPED: 'depth-capped',
  /** THE CARD DID NOT SERVE THE ORDERED VOLTAGE — a finding about the SILICON, and the sixth value
   *  of a vocabulary that was closed at five.
   *
   *  What it means: the descent asked for a voltage, read back what the card actually served, and got
   *  something else — repeatedly, at the same rung. The frequency is closed at what IS proved, and no
   *  further burns are spent on a request the card will not honour.
   *
   *  ⚠️ **Why it is not any of the other five, and each distinction is load-bearing:**
   *    • NOT `lever-limited` — the ±1000 MHz lever had room LEFT. That is precisely the lie this
   *      value removes: until 2026-08-23 this case was recorded as the lever running out.
   *    • NOT `depth-capped` — our own ceiling did not fire either. Nothing of OURS stopped it.
   *    • NOT `edge-found` — **nobody observed a failure.** The card served a different voltage; it
   *      did not fall over. Calling this an edge would be the false `[TESTED]` class of claim.
   *
   *  The owner's word, `interviews/013` Q1 = A (2026-08-23): *«Завести шестой тег `stop:not-served`»*.
   *  Read `DEPTH_CAPPED` above for why adding a value to a CLOSED vocabulary is the right move and not
   *  a violation of it: the closure is against ACCIDENTAL values, never against correcting a statement
   *  that is false. This is the same operation, one axis over — and this time the owner was asked
   *  first (`bugs/42_DONE`, `engine.mjs` carried the question in a comment until it was answered).
   *
   *  [NOT-TESTED] at birth — the blocks in `curve --selftest` are what flip this. */
  NOT_SERVED: 'not-served',
  /** СПУСК ПРЕРВАН АНОМАЛИЕЙ, А ДОКАЗАННАЯ ЗЕМЛЯ СОХРАНЕНА — седьмое значение словаря, закрытого на
   *  шести. Заведено 2026-08-24 вечером, и повод измерен, а не придуман.
   *
   *  ЧТО ОНО ЗНАЧИТ: спуск прошёл несколько ступеней, КАЖДАЯ из них выдержала прожиг, а следующая не
   *  дала вердикта по причине, лежащей в ПУТИ ЗАПИСИ (карта ушла выше потолка, выдача выше стока,
   *  назван класс отказа записи). Строка закрывается на ПОСЛЕДНЕЙ ПРОШЕДШЕЙ ступени — напряжении,
   *  которое реально держало прожиг, — и говорит вслух, что край НЕ найден.
   *
   *  ПОЧЕМУ ЭТО ПРИШЛОСЬ ЗАВЕСТИ, В ЧИСЛАХ ЖИВОГО ПРОГОНА 2026-08-24 22:0x: полоса 2355…2175 МГц
   *  дала **9 прошедших ступеней и 0 закрытых частот**. Каждая частота отдавала по несколько зелёных
   *  прожигов на карте владельца и выбрасывала их все, потому что спуск кончался аномалией вместо
   *  чистого края. Слово владельца того же вечера: *«Ты не продукт делаешь, а леса… Рабочий продукт
   *  важнее процессов»*. Терять оплаченный прожигами замер — это и есть леса вместо здания.
   *
   *  ⚠️ ПОЧЕМУ НЕ ЛЮБОЕ ИЗ ШЕСТИ, и каждое различие несущее:
   *    • НЕ `edge-found` — края мы не видели. Ни одна ступень не ОТКАЗАЛА; спуск прервался.
   *    • НЕ `lever-limited` — рычаг ±1000 МГц имел запас. Ровно та ложь, которую убрал `depth-capped`.
   *    • НЕ `depth-capped` — наш потолок глубины не срабатывал; остановило непредвиденное, а не наше
   *      условие. Записать сюда значило бы сказать «мы решили не смотреть», когда мы смотрели и не
   *      смогли.
   *    • НЕ `not-served` — карта напряжение ОБСЛУЖИЛА и прожиг выдержала; не далась СЛЕДУЮЩАЯ ступень.
   *    • НЕ `stock` — строка не заводская: под ней стоят настоящие прожиги.
   *
   *  ⚠️ И ЭТО НЕ ТРЕТИЙ ВЕРДИКТ. Владелец закрыл, что у частоты два вердикта («край найден» /
   *  «предел рычага»); это запись ДОКУМЕНТА о том, что прервало спуск, — другой вопрос, ровно как у
   *  `depth-capped`.
   *
   *  [NOT-TESTED] at birth — блоки `curve --selftest` и `engine --selftest` это переворачивают. */
  CUT_SHORT: 'cut-short',
});

const STATUS_VALUES = Object.freeze(Object.values(CURVE_STATUS));
/** Statuses that mean «a burn proved this» — the ones a report may count as evidence. */
export const PROVEN_STATUSES = Object.freeze([
  CURVE_STATUS.SHORT_BURN_PROVED, CURVE_STATUS.EDGE_FOUND, CURVE_STATUS.LONG_BURN_PROVED,
]);

// =================================================================================================
// 0a. THE TAG CLOUD — what a row is allowed to say about its own fate, history and properties
// =================================================================================================

/**
 * THE OWNER'S MODEL, 2026-08-22: *«мнесто якобы одного свойства строкой, облаго тегов, описывающих
 * судьбу, историю, свойства точки»* · *«чтобы код в будущем понимал, что за точка, и как с ней быть
 * по её тегам»*. Epic `plans/23`, phase 1 `plans/24`, evidence `researches/13`.
 *
 * ─── WHY ONE WORD WAS NOT ENOUGH, in this project's own receipts ──────────────────────────────────
 *
 * Read `DEPTH_CAPPED`'s comment above before this one. It records the day the single field was caught
 * lying to the owner: **54 of 54 rows closed that night said «предел рычага» and not one had hit the
 * lever** — the `provenBy` witness beside them said so literally. The remedy then was to add a word.
 * That remedy does not scale, because the distinctions are INDEPENDENT and words multiply: what
 * stopped the descent, how deeply the row is proved, and where its number came from are three
 * different questions, and one field can answer only one of them at a time.
 *
 * Worse than cramped — LOSSY. `long-burn-proved` OVERWRITES `edge-found`, so a frequency that found
 * its edge and then held the one-minute burn cannot say both. The owner's convergence loop
 * (`AGENT_GUIDE.md` → «THE SHIPPED POINT…») is built on accumulating exactly that evidence over time,
 * and until now the document had nowhere to accumulate it.
 *
 * ─── CLASSES, AND WHY THE CLOUD IS NOT FLAT ───────────────────────────────────────────────────────
 *
 * Every tag is `class:value` and every class declares itself EXCLUSIVE or CUMULATIVE. This is the
 * owner's decision (`interviews/010` Q1, answered *«по всем вопрсоам ДА на твои рекомендации»*), and
 * it exists to answer the one real objection the industry raises against tag sets: a flat bag cannot
 * express «exactly one of these» (`researches/13` §2.2). «What stopped the descent» IS exclusive —
 * `край-найден` and `предел-рычага` are two answers to one question and must never sit on one row.
 * The class buys that property back without giving up the cloud.
 *
 * ⚠️ **THE VOCABULARY IS CLOSED, and that is the half of the design most likely to be «improved» away.**
 * An unknown tag is refused BY NAME, exactly as an unknown status has always been. Free-form tags are
 * the documented failure mode of this model (`researches/13` §2.3): every session invents its own
 * word, and within weeks nothing can enumerate the vocabulary — least of all the code the owner wants
 * to branch on it. «Сколько хочешь много тегов» means many tags per ROW, never many words per project.
 */
export const TAG_CLASSES = Object.freeze({
  /** WHAT STOPPED THE DESCENT. Exactly one per row, or none — see the note under `TAG_OF_STATUS`. */
  STOP: Object.freeze({ name: 'stop', exclusive: true }),
  /** HOW DEEPLY THIS ROW IS PROVED. Accumulates: a 10 s burn and a one-minute burn are both true. */
  BURN: Object.freeze({ name: 'burn', exclusive: false }),
  /** WHERE THE NUMBER CAME FROM. Accumulates; today this lives as PROSE inside `provenBy`, which is
   *  why it is in the MVP at all — it is an existing fact being made machine-readable, not a new one. */
  ORIGIN: Object.freeze({ name: 'origin', exclusive: false }),
});

export const CURVE_TAGS = Object.freeze({
  /** Nothing tuned here yet — the factory voltage, as read. */
  STOP_UNTOUCHED: 'stop:untouched',
  /** A rung is IN FLIGHT: written before the card is touched, so a hang leaves a trace. */
  STOP_IN_FLIGHT: 'stop:in-flight',
  /** One rung lower failed; parked at the owner's margin above it. */
  STOP_EDGE_FOUND: 'stop:edge-found',
  /** The ±1000 MHz offset range ran out BEFORE the silicon did. **Not an edge, ever.** */
  STOP_LEVER_LIMIT: 'stop:lever-limited',
  /** OUR OWN condition stopped it — `--max-depth`, the operator's ceiling — with lever left to spare. */
  STOP_OUR_CAP: 'stop:depth-capped',
  /** THE CARD WOULD NOT SERVE THE ORDERED VOLTAGE — the silicon's answer, not our lever and not our
   *  ceiling, and **no failure was ever observed**. Full reasoning on `CURVE_STATUS.NOT_SERVED`.
   *  The sixth value; owner's word `interviews/013` Q1 = A. */
  STOP_NOT_SERVED: 'stop:not-served',
  /** СПУСК ПРЕРВАН АНОМАЛИЕЙ ПУТИ ЗАПИСИ, строка стоит на последней ПРОШЕДШЕЙ ступени, край НЕ найден.
   *  Седьмое значение; полное обоснование — на `CURVE_STATUS.CUT_SHORT`. */
  STOP_CUT_SHORT: 'stop:cut-short',
  /** Held the 10 s burn at this voltage. */
  BURN_SHORT: 'burn:short',
  /** Held the long burn — one minute since the owner's amendment of 2026-08-15. */
  BURN_LONG: 'burn:long',
  /** Burned at THIS frequency: the strongest provenance there is. */
  ORIGIN_MEASURED: 'origin:measured',
  /** Inherited DOWNWARD from the rung's highest frequency (R16b) — the same measured fact, not
   *  interpolation, and safe only in that direction. */
  ORIGIN_INHERITED: 'origin:inherited',
  /** Raised by the monotonicity ratchet because a LOWER frequency demanded more (R17). The row's
   *  voltage is therefore NOT the deepest this frequency reached — it is the safe direction. */
  ORIGIN_RATCHETED: 'origin:ratcheted',
  /** THE NUMBER WAS MEASURED AGAINST A VOLTAGE THE CARD SUBSTITUTED, and the substitution was more
   *  than ONE grid step above the order — «другая запись таблицы», not a rounding-up.
   *
   *  The owner's rule (`GOAL.md` → «ТО ЖЕ ПРАВИЛО НА ОСИ НАПРЯЖЕНИЯ», 2026-08-16) reads: one grid step
   *  up is a HIT and the served value becomes the measure; higher than that is a different table entry.
   *  His original ruling for that third row was STOP. `interviews/013` Q2 (2026-08-23) softened it to
   *  **C — the measurement counts, but it is MARKED** — after it turned out that a warmed card misses
   *  upward REGULARLY rather than rarely, so the letter of the rule would have cost most of the band.
   *
   *  ⚠️ **CUMULATIVE, and that is the point.** A row carries `origin:measured` (the number was burned
   *  at this frequency) AND this tag (it was burned against a voltage nobody ordered). The single
   *  status field could hold only one of the two — which is exactly what `researches/13` was about.
   *
   *  ⚠️ **NOT set on a one-step miss.** By the owner's rule that is a HIT; marking it would put the tag
   *  on half the document and leave it distinguishing nothing (`researches/13` §7.3).
   *
   *  ⚠️ **The SIZE of the miss is NOT in the tag** and must never be: `origin:overshot-4`,
   *  `origin:overshot-45`… would make the vocabulary unenumerable, which is the documented
   *  cardinality anti-pattern (`researches/13` §7.1, quoting Prometheus: *«Do not use labels to store
   *  dimensions with high cardinality … or other unbounded sets of values»*). The tag carries the CLASS
   *  of the fact for the code; the millivolts are named in `provenBy` for the human.
   *
   *  [NOT-TESTED] at birth — the blocks in `--selftest` are what flip this. */
  ORIGIN_OVERSHOT: 'origin:overshot',
});

const TAG_VALUES = Object.freeze(Object.values(CURVE_TAGS));
const CLASS_OF_TAG = Object.freeze(Object.fromEntries(
  TAG_VALUES.map((t) => [t, t.slice(0, t.indexOf(':'))]),
));
const EXCLUSIVE_CLASSES = Object.freeze(
  Object.values(TAG_CLASSES).filter((c) => c.exclusive).map((c) => c.name),
);

/**
 * THE LOSSLESS MAP FROM THE OLD FIELD — one status, one tag, and the reverse recovers it exactly.
 *
 * ⚠️ **TWO OLD STATUSES ARE NOT ABOUT THE DESCENT AT ALL, and that is a FINDING rather than an
 * inconvenience.** `short-burn-proved` and `long-burn-proved` say how deeply a row is proved; they
 * never said what stopped it. Under the old field they occupied the same slot as `edge-found`, which
 * is precisely the conflation the owner's model removes. So a row migrated from them carries a
 * `burn:*` tag and **NO `stop:*` tag** — because nothing is known about what stopped its descent,
 * and inventing one would be the three-doors violation this project refuses (`PHILOSOPHY.md`).
 *
 * Consequence for the validator: a row must carry AT MOST one tag of an exclusive class, never
 * exactly one. «At least one `стоп`» would refuse the truth.
 */
export const TAG_OF_STATUS = Object.freeze({
  [CURVE_STATUS.STOCK]: CURVE_TAGS.STOP_UNTOUCHED,
  [CURVE_STATUS.PROBING]: CURVE_TAGS.STOP_IN_FLIGHT,
  [CURVE_STATUS.EDGE_FOUND]: CURVE_TAGS.STOP_EDGE_FOUND,
  [CURVE_STATUS.LEVER_LIMITED]: CURVE_TAGS.STOP_LEVER_LIMIT,
  [CURVE_STATUS.DEPTH_CAPPED]: CURVE_TAGS.STOP_OUR_CAP,
  [CURVE_STATUS.NOT_SERVED]: CURVE_TAGS.STOP_NOT_SERVED,
  [CURVE_STATUS.CUT_SHORT]: CURVE_TAGS.STOP_CUT_SHORT,
  [CURVE_STATUS.SHORT_BURN_PROVED]: CURVE_TAGS.BURN_SHORT,
  [CURVE_STATUS.LONG_BURN_PROVED]: CURVE_TAGS.BURN_LONG,
});

/** The tags a legacy `status` becomes. Total over `CURVE_STATUS` — a block asserts that, so neither
 *  side can gain a value the other does not know about. */
export function tagsForStatus(status) {
  const tag = TAG_OF_STATUS[status];
  return tag === undefined ? null : [tag];
}

/**
 * THE LEGACY VIEW, DERIVED — never stored. `status` left `ROW_KEYS` in epic 04 phase 1, and this is
 * how six existing consumers keep working while they migrate one at a time.
 *
 * The shape is the project's own precedent, not an invention: R14c already derives `offsetMhz` on
 * load rather than storing it, because a file carrying both a frequency and its offset records one
 * fact twice — and two copies of one fact drift. A stored `status` beside stored tags would be that
 * pair exactly, and the canon says COLLAPSE a pair rather than watch it.
 *
 * **The priority is stated rather than implied**, because going forward a row CAN carry both a stop
 * tag and burn tags: the terminal reason wins, since that is what the old field meant on any row that
 * had one. Burn depth answers only where no terminal reason exists — which is exactly the pair of
 * statuses that never described the descent (see `TAG_OF_STATUS`).
 */
export function statusFromTags(tags) {
  const has = (t) => Array.isArray(tags) && tags.includes(t);
  if (has(CURVE_TAGS.STOP_EDGE_FOUND)) return CURVE_STATUS.EDGE_FOUND;
  if (has(CURVE_TAGS.STOP_LEVER_LIMIT)) return CURVE_STATUS.LEVER_LIMITED;
  if (has(CURVE_TAGS.STOP_OUR_CAP)) return CURVE_STATUS.DEPTH_CAPPED;
  // ⚠️ THE POSITION IS A DECISION, not an append. This list is ORDERED and the order decides which
  // tag wins on a row carrying several. `stop:not-served` sits with its two siblings — the group
  // «the descent stopped and NOBODY SAW A FAILURE» — and ABOVE every `burn:*`, because a `stop:*`
  // answers what became of the frequency while a `burn:*` answers how deeply it is proved. A row that
  // held a burn and was THEN closed by the card refusing the order must read as closed, not as
  // «burn-proved»: the burn is still true, and it is still on the row as its own tag.
  if (has(CURVE_TAGS.STOP_NOT_SERVED)) return CURVE_STATUS.NOT_SERVED;
  if (has(CURVE_TAGS.STOP_CUT_SHORT)) return CURVE_STATUS.CUT_SHORT;
  if (has(CURVE_TAGS.STOP_IN_FLIGHT)) return CURVE_STATUS.PROBING;
  if (has(CURVE_TAGS.BURN_LONG)) return CURVE_STATUS.LONG_BURN_PROVED;
  if (has(CURVE_TAGS.BURN_SHORT)) return CURVE_STATUS.SHORT_BURN_PROVED;
  if (has(CURVE_TAGS.STOP_UNTOUCHED)) return CURVE_STATUS.STOCK;
  return null;
}

/**
 * NO BURN HAS EVER TOUCHED THIS ROW — it is at its factory value, or a rung is in flight on it.
 *
 * ⚠️ **Asked of the TAGS, never of the derived `status`, and the reason is a trap this migration
 * stepped into on its first run.** `closePoint` copies rows with `{...r}`, and a spread copies only
 * ENUMERABLE own properties — so the non-enumerable derived `status` does NOT survive it, and every
 * check written against `r.status` silently became `undefined === 'stock'`, i.e. false. The ratchet
 * would then have raised untouched factory rows, which is the exact thing R17 exists to forbid.
 *
 * The generalisation, and it is why this is a named helper rather than an inline test: a DERIVED view
 * is only present where somebody attached it, so code inside the format's own module asks the STORED
 * truth. The view is for consumers; the author reads the source.
 */
export function isUnmeasured(row) {
  const tags = row?.tags;
  if (!Array.isArray(tags)) return true;
  return tags.includes(CURVE_TAGS.STOP_UNTOUCHED) || tags.includes(CURVE_TAGS.STOP_IN_FLIGHT);
}

/** The tag-model twin of `PROVEN_STATUSES`: tags that CLAIM a burn proved this voltage here, and
 *  therefore owe a witness. Read from the stored tags for the same reason `isUnmeasured` is. */
export const PROVEN_TAGS = Object.freeze([
  CURVE_TAGS.BURN_SHORT, CURVE_TAGS.BURN_LONG, CURVE_TAGS.STOP_EDGE_FOUND,
]);

/**
 * ДОКАЗАЛА ЛИ ЭТА СТРОКА, ЧТО СТОЛЬКО НАПРЯЖЕНИЯ ДЕЙСТВИТЕЛЬНО ТРЕБУЕТСЯ.
 *
 * Различие, которое стоило проекту его самых глубоких замеров (2026-08-22 22:3x). Храповик
 * монотонности поднимал закрываемую строку до напряжения любой ИЗМЕРЕННОЙ соседки снизу. Но
 * «измеренная» и «требующая» — разные вещи, и в документе их было 60 против 2:
 *
 *   `stop:edge-found`     — под этим напряжением НАБЛЮДАЛСЯ отказ. Это требование кремния.
 *   `stop:lever-limited`  — кончился ход НАШЕГО рычага ±1000 МГц. Отказа никто не видел.
 *   `stop:depth-capped`   — сработал НАШ потолок глубины. Отказа никто не видел.
 *
 * Строка «предел рычага» говорит «ниже мы не смогли попросить», а не «ниже карта не может». Пуская
 * её в храповик, мы позволяли непроверенной стене затирать честный замер: измеренные 875 мВ на
 * 2887 МГц поднимались до 1000 мВ, потому что так стояло у 2872 МГц, где спуск остановил рычаг.
 * Физическое основание храповика (Vmin не убывает с частотой) при этом не нарушается — оно и
 * работает только тогда, когда нижняя соседка ДОКАЗАЛА свою потребность отказом.
 *
 * Безопасность: правило по-прежнему никогда не опускает строку молча. Оно лишь перестаёт ПОДНИМАТЬ
 * её ради значения, за которым нет отказа.
 */
export function demandsVoltage(row) {
  const tags = row?.tags;
  if (!Array.isArray(tags)) return false;
  if (!tags.includes(CURVE_TAGS.STOP_EDGE_FOUND)) return false;
  // ⚠️ И ПОДНЯТАЯ ХРАПОВИКОМ СТРОКА НЕ ТРЕБУЕТ НИЧЕГО — она СЛЕДСТВИЕ, а не причина.
  //
  // Её напряжение принадлежит не ей: храповик поставил его по требованию какой-то более низкой
  // соседки. Оставляя такую строку источником требования, документ размножает одно ограничение
  // вверх по таблице, и цепочка затирает всё, что измерено позже. Живой пример, 2026-08-22:
  // 2835 МГц носит 995 мВ (её собственный измеренный край — 865), и через неё 2842 поднялась до
  // 995, затем 2880 до 995, затем 2887 до 1000 — три честных замера подряд стёрты одним чужим
  // значением.
  //
  // Ограничение при этом НЕ ТЕРЯЕТСЯ: настоящий источник требования по-прежнему стоит в таблице и
  // действует напрямую на всех, кто выше. Мы убираем ретранслятор, а не правило.
  return !tags.includes(CURVE_TAGS.ORIGIN_RATCHETED);
}

/** Does this row claim a burn proved it? A claim without a witness is a statement, not evidence. */
export function claimsBurnProof(row) {
  const tags = row?.tags;
  return Array.isArray(tags) && tags.some((t) => PROVEN_TAGS.includes(t));
}

/**
 * WHAT IS WRONG WITH THIS TAG SET — the vocabulary's gate, and it refuses by NAME.
 *
 * @returns {string[]} refusal reasons; empty means the set is well-formed
 */
export function tagSetRefusals(tags) {
  if (!Array.isArray(tags)) return [`ожидался массив тегов, получено ${JSON.stringify(tags)}`];
  if (tags.length === 0) return ['строка без единого тега ничего о себе не говорит'];
  const out = [];
  for (const t of tags) {
    if (!TAG_VALUES.includes(t)) {
      out.push(`неизвестный тег ${JSON.stringify(t)}; словарь ЗАКРЫТ: ${TAG_VALUES.join(', ')}`);
    }
  }
  if (new Set(tags).size !== tags.length) out.push('один и тот же тег указан дважды');
  // The exclusive classes — the property a flat cloud would have thrown away (`researches/13` §2.2).
  for (const cls of EXCLUSIVE_CLASSES) {
    const inClass = tags.filter((t) => CLASS_OF_TAG[t] === cls);
    if (inClass.length > 1) {
      out.push(`класс «${cls}» взаимоисключающий, а на строке ${inClass.length} его тега: `
        + `${inClass.join(', ')} — это два ответа на один вопрос`);
    }
  }
  return out;
}

export const CURVE_FILE = 'measured.json';
/**
 * THE STORED ROW. `status` LEFT this list in epic 04 phase 1 and `tags` took its place — the single
 * field is gone from disk, and the legacy view is derived by `statusFromTags` at load time (R14c's
 * shape, the same one `offsetMhz` has always used).
 *
 * ⚠️ The list is EXACT-MATCH: an unknown field is a refusal, not a warning. That is what makes a
 * format migration visible instead of silent — and it is also why `bugs/24`'s lesson applies here in
 * full: the FILES are the easy half, the places that BUILD a row in code are the half that gets
 * missed (`plans/24` §1 carries the inventory of all nine).
 */
const ROW_KEYS = Object.freeze(['mhz', 'voltageMv', 'stockVoltageMv', 'tags', 'provenBy', 'editedAt']);
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u;
const refuse = (field, why) => ({ field, why });

export function curvePath(name = 'measured', dir = CURVES_DIR) {
  return path.join(dir, name === 'measured' ? CURVE_FILE : `${name}.json`);
}

// =================================================================================================
// 1. Reading the card in the owner's coordinates: frequency → voltage
// =================================================================================================

/**
 * The voltage the card's factory table currently uses to serve `mhz`.
 *
 * The table is ascending in both axes, so the serving voltage is the LOWEST rung whose frequency
 * reaches `mhz`. Returns `null` when no rung reaches it (which, for a frequency taken off the card's
 * own grid, means the reading is wrong rather than the frequency is impossible).
 */
export function stockVoltageFor(mhz, tablePoints) {
  for (const p of tablePoints) {
    if (p.freqKhz > 0 && p.mhz >= mhz) return p.mv;
  }
  return null;
}

/**
 * The LOWEST voltage that could be made to serve `mhz` at all, given the hardware's ±1000 MHz lever.
 *
 * To serve `mhz` from a rung whose factory frequency is F, that rung must be raised by (mhz − F), and
 * the raise is capped. So the reachable floor is the lowest rung within reach — and THAT is what
 * `lever-limited` means when a descent stops there: our lever ran out, not the silicon.
 */
export function leverFloorFor(mhz, tablePoints, maxRaiseMhz = CLOCK_OFFSET_MAX_MHZ ?? 1000) {
  for (const p of tablePoints) {
    if (p.freqKhz > 0 && mhz - p.mhz <= maxRaiseMhz) return p.mv;
  }
  return null;
}

/**
 * Seed a document: every frequency on the card's grid, with the voltage the factory currently uses.
 *
 * `ideas/03` step 5. Descending by frequency because the sweep walks top-down (step 6) and a table
 * stored in the order it is consumed is one fewer place to get a direction wrong.
 */
export function initFromCard({ frequencyGrid, tablePoints, card, stamp, tempC = null, nowIso = null }) {
  const at = nowIso ?? localIso();
  const frequencies = [...frequencyGrid.values].sort((a, b) => b - a).map((mhz) => {
    const v = stockVoltageFor(mhz, tablePoints);
    return {
      mhz,
      voltageMv: v,
      stockVoltageMv: v,
      tags: [CURVE_TAGS.STOP_UNTOUCHED],
      provenBy: null,
      editedAt: at,
    };
  });

  return {
    kind: 'tuning-curve',
    name: 'measured',
    card: { ...card, frequencyCount: frequencies.length },
    // The voltage rungs the card offers. Stored WITH the document because a voltage that is not on
    // this list is not a voltage the card can be asked for, and the validator says so by name.
    voltageGridMv: [...new Set(tablePoints.slice(0, CURVE_GRAPHICS_POINT_COUNT).map((p) => p.mv))].sort((a, b) => a - b),
    stamp: { ...stamp, takenAt: stamp.takenAt ?? at, tempC },
    frequencies,
  };
}

/** Coverage arithmetic — what E2-AC2 is counted with. Pure. */
export function summarize(doc) {
  const rows = doc.frequencies ?? [];
  const by = Object.fromEntries(STATUS_VALUES.map((s) => [s, 0]));
  for (const r of rows) by[r.status] = (by[r.status] ?? 0) + 1;
  // `depth-capped` counts as CLOSED for the same reason `lever-limited` does: the frequency carries a
  // measured voltage that held a burn. What differs is only WHY the descent stopped, and coverage is
  // a question about measurements, not about stopping reasons — omitting it here would have made the
  // honesty fix cost 54 rows of coverage, i.e. punished the truth.
  //
  // `not-served` joins them 2026-08-23 by the SAME argument, and the argument is the whole point: the
  // descent is OVER on that frequency and its voltage is proved. Leaving it out would repeat the error
  // this comment was written about — a second honesty fix silently paid for in coverage, and a reader
  // would blame the card for a hole the bookkeeping made.
  const closed = rows.filter((r) => r.status === CURVE_STATUS.EDGE_FOUND
    || r.status === CURVE_STATUS.LEVER_LIMITED || r.status === CURVE_STATUS.DEPTH_CAPPED
    || r.status === CURVE_STATUS.NOT_SERVED
    || r.status === CURVE_STATUS.LONG_BURN_PROVED).length;
  const savedMv = rows.reduce((n, r) => n + Math.max(0, (r.stockVoltageMv ?? 0) - (r.voltageMv ?? 0)), 0);
  const tuned = rows.filter((r) => Number.isFinite(r.stockVoltageMv) && r.voltageMv < r.stockVoltageMv);
  return {
    total: rows.length,
    byStatus: by,
    closed,
    tuned: tuned.length,
    deepestCutMv: tuned.length ? Math.max(...tuned.map((r) => r.stockVoltageMv - r.voltageMv)) : 0,
    averageCutMv: tuned.length ? Math.round((savedMv / tuned.length) * 10) / 10 : 0,
  };
}

// =================================================================================================
// 2a. Acceptance progress — the delivery line (ideas/14; интервью 017 Q1 reads the moratorium
//     threshold «краёв ≥ 195/389» off this exact count)
// =================================================================================================

/** The two DERIVED origins the owner legalised (`GOAL.md` → «🏁 КРИТЕРИЙ ПРИЁМКИ ТЮНИНГА» §3) that
 *  are NOT in `CURVE_TAGS` yet — their mechanism is epic 42 phases 5/5a. The counter names them
 *  TODAY so that the day they land, «выведено» lights up without touching this module again; until
 *  then they count 0 by construction. Deliberately not added to the vocabulary here: the vocabulary
 *  grows with the mechanism, not with the report (the moratorium, интервью 017 Q1 = A). */
export const DERIVED_ORIGIN_TAGS = Object.freeze(['origin:interpolated', 'origin:extrapolated']);

/** The four shortcuts on the owner's desk — the denominator of «режимов отгружено Y/4». */
export const ACCEPTANCE_MODES = Object.freeze(['max-performance', 'optimised', 'silent-cold', 'stock-default']);

/**
 * THE ACCEPTANCE COUNT — the one number the owner and the agent read the same way (ideas/14).
 * Pure: takes the curve document and the parsed profile objects, touches nothing.
 *
 * «Край известен» is read FROM THE TAGS, not re-invented (ideas/14 step 2): a row is closed by an
 * edge when it carries `stop:edge-found`. The breakdown inside follows the owner's closed provenance
 * vocabulary (прожигом · соседкой · выведено); an edge row whose provenance fits none of the three —
 * today that is the row whose only origin is `origin:ratcheted` — is printed as ITS OWN line rather
 * than swallowed or guessed into a column. `stop:lever-limited` and a bare `origin:ratcheted` are
 * NOT edges, ever — the first is our lever running out, the second is a consequence of someone
 * else's edge (`demandsVoltage` holds the full argument).
 *
 * «Режим отгружен» = its profile stopped refusing and passed qualification — machine-readably,
 * `qualified === true` (the qualification gate P3-AC3 refuses anything else before the first
 * write). Today the honest answer is 0/4 and the counter must say so (ideas/14 step 3).
 */
export function acceptanceProgress(doc, { profiles = [] } = {}) {
  const rows = doc?.frequencies ?? [];
  const has = (r, t) => Array.isArray(r.tags) && r.tags.includes(t);
  const edges = rows.filter((r) => has(r, CURVE_TAGS.STOP_EDGE_FOUND));
  const burned = edges.filter((r) => has(r, CURVE_TAGS.ORIGIN_MEASURED));
  const inherited = edges.filter((r) => !has(r, CURVE_TAGS.ORIGIN_MEASURED) && has(r, CURVE_TAGS.ORIGIN_INHERITED));
  const derived = edges.filter((r) => !has(r, CURVE_TAGS.ORIGIN_MEASURED) && !has(r, CURVE_TAGS.ORIGIN_INHERITED)
    && DERIVED_ORIGIN_TAGS.some((t) => has(r, t)));
  const unclassified = edges.filter((r) => !burned.includes(r) && !inherited.includes(r) && !derived.includes(r));
  const untouched = rows.filter(isUnmeasured).length;

  const byMode = new Map(profiles.filter((p) => p && typeof p === 'object').map((p) => [p.mode, p]));
  const shipped = ACCEPTANCE_MODES.filter((m) => byMode.get(m)?.qualified === true);

  return {
    total: rows.length,
    edges: {
      total: edges.length,
      burned: burned.length,
      inherited: inherited.length,
      derived: derived.length,
      unclassified: unclassified.map((r) => ({ mhz: r.mhz, tags: [...(r.tags ?? [])] })),
    },
    untouched,
    touched: rows.length - untouched,
    modes: { shipped: shipped.length, total: ACCEPTANCE_MODES.length, names: shipped },
  };
}

/** The delivery line itself — one string, the exact shape the canon orders a session to open and
 *  close with (`AGENT_GUIDE.md` → The critical path rule, rule 1). */
export function renderDeliveryLine(p) {
  const e = p.edges;
  let line = `ПРИЁМКА: краёв ${e.total}/${p.total} (прожигом ${e.burned} · соседкой ${e.inherited} · выведено ${e.derived})`
    + ` · не тронуто ${p.untouched} · режимов отгружено ${p.modes.shipped}/${p.modes.total}`;
  if (e.unclassified.length > 0) {
    line += `\nне классифицировано: ${e.unclassified.length} — ${e.unclassified.map((r) => `${r.mhz} МГц [${r.tags.join(', ')}]`).join(' · ')}`;
  }
  return line;
}

// =================================================================================================
// 2. Validation — pure, provable on fixtures alone
// =================================================================================================

export function validateCurveDoc(doc, { card = null, frequencyGrid = null } = {}) {
  const out = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return [refuse('<кривая>', 'ожидался JSON-объект')];
  }
  if (doc.kind !== 'tuning-curve') {
    out.push(refuse('kind', `ожидался tuning-curve, получено ${JSON.stringify(doc.kind)}`));
  }

  const stamp = doc.stamp;
  if (!stamp || typeof stamp !== 'object' || Array.isArray(stamp)) {
    out.push(refuse('stamp', 'штамп обязателен: кривая действительна только для драйвера и VBIOS, на которых снята (R6)'));
  } else {
    for (const k of ['driver', 'vbios']) {
      if (typeof stamp[k] !== 'string' || stamp[k].trim() === '') out.push(refuse(`stamp.${k}`, 'обязательное поле штампа'));
    }
    if (!LOCAL_ISO.test(String(stamp.takenAt))) {
      out.push(refuse('stamp.takenAt', `ожидался локальный ISO 8601 со смещением, получено ${JSON.stringify(stamp.takenAt)}; «Z» отвергается намеренно — EXP-0012`));
    }
  }

  if (!Array.isArray(doc.voltageGridMv) || doc.voltageGridMv.length === 0) {
    out.push(refuse('voltageGridMv', 'сетка напряжений обязательна: напряжение, которого на ней нет, карта принять не может'));
  }
  if (!Array.isArray(doc.frequencies) || doc.frequencies.length === 0) {
    return [...out, refuse('frequencies', 'обязательная таблица частот отсутствует или пуста')];
  }

  const grid = Array.isArray(doc.voltageGridMv) ? doc.voltageGridMv : [];
  const bound = card?.maxGraphicsMhz ?? null;
  const ladder = frequencyGrid?.values ?? null;

  let prevMhz = Infinity;
  for (let k = 0; k < doc.frequencies.length; k++) {
    const r = doc.frequencies[k];
    const at = `frequencies[${k}]`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      out.push(refuse(at, 'ожидался объект строки'));
      continue;
    }
    for (const key of Object.keys(r)) {
      if (!ROW_KEYS.includes(key)) out.push(refuse(`${at}.${key}`, `неизвестное поле; известны: ${ROW_KEYS.join(', ')}`));
    }

    // --- the frequency itself
    if (!Number.isFinite(r.mhz)) {
      out.push(refuse(`${at}.mhz`, `ожидалась частота в МГц, получено ${JSON.stringify(r.mhz)}`));
    } else {
      if (r.mhz >= prevMhz) {
        out.push(refuse(`${at}.mhz`, `таблица идёт сверху вниз по частоте, а ${r.mhz} МГц стоит после ${prevMhz}`));
      }
      prevMhz = r.mhz;
      if (ladder && !ladder.includes(r.mhz)) {
        out.push(refuse(`${at}.mhz`, `${r.mhz} МГц нет на сетке частот карты — карта на этой частоте работать не станет`));
      }
      // R13 read in the owner's coordinates, and it is trivial here BY CONSTRUCTION: frequencies come
      // off the card's own grid, whose top IS the instance maximum. The check stays because «by
      // construction» is an argument about today's code, and this is the rule `bugs/11` cost a BSOD.
      if (bound !== null && r.mhz > bound) {
        out.push(refuse(`${at}.mhz`, `${r.mhz} МГц выше максимума этой карты (${bound} МГц). `
          + 'Слово владельца: «НИКОГДА НЕ ГНАТЬ КАРТУ ВЫШЕ ЭТОЙ ЧАСТОТЫ» (R13, bugs/11)'));
      }
    }

    // --- the voltage that serves it
    if (!Number.isFinite(r.voltageMv)) {
      out.push(refuse(`${at}.voltageMv`, `ожидалось напряжение в мВ, получено ${JSON.stringify(r.voltageMv)}`));
    } else if (grid.length && !grid.includes(r.voltageMv)) {
      out.push(refuse(`${at}.voltageMv`, `${r.voltageMv} мВ нет на сетке напряжений карты — такого напряжения у неё попросить нельзя. `
        + `Сетка: ${grid[0]}…${grid[grid.length - 1]} мВ, ${grid.length} ступеней`));
    }
    if (Number.isFinite(r.stockVoltageMv) && Number.isFinite(r.voltageMv) && r.voltageMv > r.stockVoltageMv) {
      // Tuning LOWERS the voltage a frequency needs. Raising it above stock is not undervolting, and
      // it is not something this project has ever measured a reason for.
      out.push(refuse(`${at}.voltageMv`, `${r.voltageMv} мВ ВЫШЕ стокового ${r.stockVoltageMv} мВ: тюнинг снижает напряжение частоты, `
        + 'а не поднимает; повышение — это не андервольт и оснований для него не измерено'));
    }

    // THE TAG CLOUD replaces the single status (epic 04 phase 1). The vocabulary stays CLOSED and the
    // refusal still names the offender — the property that made the old field trustworthy is the one
    // thing the migration was not allowed to lose (`researches/13` §2.3).
    for (const why of tagSetRefusals(r.tags)) out.push(refuse(`${at}.tags`, why));
    if (!LOCAL_ISO.test(String(r.editedAt))) {
      out.push(refuse(`${at}.editedAt`, `дата последней правки обязательна, локальный ISO со смещением; получено ${JSON.stringify(r.editedAt)}`));
    }
    // ⚠️ ASKED OF THE TAGS, never of the derived `status` — and this line is where that rule was PAID
    // FOR: written as `PROVEN_STATUSES.includes(r.status)`, it read `undefined` on every document
    // built in memory (fixtures, and anything that has not been through `attachDerivedStatus`), so the
    // witness requirement silently never fired. A guard that cannot fire is not a guard.
    if (claimsBurnProof(r) && (typeof r.provenBy !== 'string' || r.provenBy.trim() === '')) {
      out.push(refuse(`${at}.provenBy`, `теги ${JSON.stringify(r.tags)} утверждают, что частоту доказал прожиг — тогда назови форму нагрузки и вердикт; `
        + 'статус без свидетеля это заявление, а не улика'));
    }
  }

  // ─── MONOTONICITY, in the owner's coordinates and physically meaningful ────────────────────────
  // A higher frequency cannot need LESS voltage than a lower one — that is the same setup-timing fact
  // the whole search rests on, and the owner stated it from his own practice: «на более нижней частоте
  // напряжение нужно такое же или ниже, очень редко выше, почти не бывает такого». A table that
  // violates it is either a measurement error or that rare case, and either way it is not written
  // silently. The refusal names BOTH frequencies.
  const inv = firstInversion(doc.frequencies);
  if (inv) {
    const a = doc.frequencies[inv.at]; const b = doc.frequencies[inv.loAt];
    out.push(refuse(`frequencies[${inv.loAt}].voltageMv`,
      `${b.mhz} МГц требует ${b.voltageMv} мВ, а более ВЫСОКАЯ ${a.mhz} МГц — только ${a.voltageMv} мВ. `
      + 'Более высокой частоте не может хватать меньшего напряжения: либо замер ошибочен, либо это тот редкий случай, '
      + 'который владелец назвал сам, — и тогда его записывают явно, а не проносят молча'));
  }

  return out;
}

/**
 * The first place where a LOWER frequency demands MORE voltage than the higher one above it in the
 * table (the table runs high → low). `null` when the table is consistent.
 *
 * ⚠️ **ONLY MEASURED ROWS ARE COMPARED, and that is a correction paid for by running the sweep**
 * (`plans/15` §4.5, 2026-08-16). An inversion is a contradiction between two MEASUREMENTS — «this
 * frequency costs more than a higher one» — and a row still carrying its FACTORY voltage is not a
 * measurement, it is the absence of one. A sweep walks top-down, so between the frequency it just
 * closed and the ones it has not reached yet there is ALWAYS an apparent inversion: the closed row
 * dropped to its measured voltage while its lower neighbours still hold the higher factory value.
 * Comparing those two reddened on every single point and stopped the sweep at its first write —
 * **a guard causing the very regression it exists to prevent**, which is the trap R12 and R13 both
 * name and which the first version of R13's check fell into as well.
 *
 * What this deliberately does NOT weaken: a FINISHED document has no unmeasured rows, so every
 * comparison it can make is still made. And the comparison walks CONSECUTIVE MEASURED rows rather
 * than adjacent ones — an unmeasured gap between two measurements does not excuse a contradiction
 * across it.
 *
 * The boundary, stated because it is the thing this correction moves rather than removes: a partially
 * swept document is CONSISTENT but not APPLICABLE — a frequency still at stock cannot be served the
 * factory voltage once a HIGHER frequency has been made cheaper, because the card serves a clock with
 * the lowest entry that reaches it. Applying is epic 02's phase 5 and that is where the applicability
 * check belongs; refusing to SAVE knowledge because it is incomplete would simply lose it.
 *
 * [TESTED: 2026-08-16 00:3x, OFFLINE · 4 blocks in `curve --selftest` — an inversion between two
 *  MEASURED rows is caught and names both frequencies; equal voltages are not an inversion; an
 *  UNMEASURED row is not one either; and a contradiction ACROSS an unmeasured gap still is.
 *  Mutation 63 (judge unmeasured rows too) reddens the last two and stops the sweep in `engine
 *  --selftest` as well — which is the regression this correction removed.]
 */
export function firstInversion(rows) {
  const measured = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Number.isFinite(r?.voltageMv)) continue;
    if (isUnmeasured(r)) continue;
    // ⚠️ ПРОТИВОРЕЧИТЬ МОЖЕТ ТОЛЬКО СТРОКА, КОТОРАЯ СВОЁ НАПРЯЖЕНИЕ ТРЕБУЕТ (`bugs/35`).
    //
    // Противоречие — это столкновение ДВУХ УТВЕРЖДЕНИЙ о кремнии. А «измеренная» и «требующая» это
    // разные вещи, и в этом документе их 60 против 2:
    //   `stop:lever-limited` — кончился ход НАШЕГО рычага; отказа никто не видел;
    //   `origin:ratcheted`   — число поставил храповик по требованию другой строки; оно не её.
    // Ни то, ни другое не утверждает «карте нужно столько», значит противоречить замеру не может.
    //
    // Разбор написан не здесь, а в шапке `demandsVoltage`, и предикат берётся ОТТУДА — храповик уже
    // спрашивает его с 2026-08-22. Второго определения «что есть утверждение» в модуле не заводится:
    // это была бы пара «истина↔зеркало», которая разъедется на первой же правке словаря.
    //
    // ЦЕНА ОТСУТСТВИЯ ЭТОЙ СТРОКИ, ЗАМЕРЕННАЯ НА ЖИВОМ ПРОГОНЕ 2026-08-23 при владельце: развёртка
    // нашла край 2820 МГц за 184 с, четыре прожига прошли — и не сохранила НИЧЕГО, потому что
    // строка-стена 2872 МГц «противоречила» честному замеру 2880 МГц. Покрытие 0 из 17.
    if (!demandsVoltage(r)) continue;
    measured.push({ at: i, mv: r.voltageMv });
  }
  for (let k = 0; k + 1 < measured.length; k++) {
    if (measured[k + 1].mv > measured[k].mv) return { at: measured[k].at, loAt: measured[k + 1].at };
  }
  return null;
}

// =================================================================================================
// 2a. THE ONE MUTATOR — how a measured frequency enters the document (`plans/15` §4.5)
// =================================================================================================

/**
 * CLOSE ONE FREQUENCY, AND KEEP THE DOCUMENT A DOCUMENT.
 *
 * This is the ONLY way a sweep's result reaches the artifact, and it lives here rather than in the
 * engine because R14a says this module is the document's single author: a second writer would be a
 * second truth about what the silicon proved, which is the shape R1 forbids for the card itself.
 *
 * ─── IT DOES THREE THINGS, AND THE SECOND AND THIRD ARE NOT DECORATION ────────────────────────────
 *
 * **(1) It writes the measured row.** Frequency, the voltage that now serves it, the status from the
 * CLOSED vocabulary, the witness, the date. Every refusal names the field, because a mutator that
 * silently drops a bad value is how a document becomes a rumour.
 *
 * **(2) It carries the value DOWN to the rest of the rung — and that is not interpolation** (E2-AC3,
 * the criterion this project measures itself against, and the exact thing the vendor's OC Scanner
 * does that we do not). The card has 127 voltage rungs for 389 frequencies, so neighbouring
 * frequencies SHARE a voltage by construction; a rung's frequencies are burned at the HIGHEST of
 * them, and the lower ones inherit that result. The direction is what makes it safe rather than
 * convenient: **Vmin does not decrease with frequency** (setup-time violation at the edge,
 * `researches/09` §2.3, and the owner's own practice — «на более нижней частоте напряжение нужно
 * такое же или ниже»), so a voltage PROVEN at a higher frequency is not optimistic at a lower one.
 * The inherited rows carry the rung's verdict, and `provenBy` says whose burn it was — which is why
 * `provenBy` is a REQUIRED field for a proven status in the first place: a status can never stand
 * without naming its witness.
 *
 * **(3) It ratchets the frequencies ABOVE, upward, and NAMES every one it moved.** A lower frequency
 * that measures a HIGHER requirement than an already-closed higher one is the rare case the owner
 * named himself (*«очень редко — выше, почти не бывает такого»*, `plans/13` risk R8). The document
 * cannot hold it — `validateCurveDoc` refuses an inversion, and rightly, because «a higher frequency
 * needs less voltage» is physically false. The resolution is forced rather than chosen: shipping the
 * higher frequency at a voltage a LOWER frequency demonstrably failed at would be shipping a known
 * failure, so the higher rows come UP to the measured value. Raising is the safe direction and it
 * invents no measurement — it refuses to keep one that a neighbour's measurement contradicts. The
 * epic already expects this vocabulary at its phase-4 gate: *«поднятые храповиком частоты названы»*
 * (`plans/13` §4), and `raised` is what names them.
 *
 * ─── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────────
 *
 * It does not save. Persistence is `saveCurveDoc` and it is atomic; keeping them apart is what lets
 * the sweep validate the RESULT before it reaches the disk, so a document that would fail its own
 * validator never becomes the file the next session trusts.
 *
 * @param {object} doc  the tuning-curve document; NOT mutated — a new one is returned
 * @param {object} a
 * @param {number} a.mhz            the frequency that was burned
 * @param {number} a.voltageMv      the voltage that now serves it — must be on the card's grid
 * @param {string} a.status         from `CURVE_STATUS`; the vocabulary is closed
 * @param {string} [a.provenBy]     the witness — REQUIRED for a proven status
 * @param {string[]} [a.extraTags]  CUMULATIVE tags to add beside the ones the status implies — today
 *   `origin:overshot` (epic `plans/33` phase 2). ⚠️ **Validated against the SAME closed vocabulary and
 *   the SAME exclusive-class rule as any other tag set.** An entry point that accepts an arbitrary tag
 *   would repeal `researches/13` §2.3 — the closure is the property that makes the document readable,
 *   and a back door into it is worth more than the front door is worth keeping shut.
 * @param {number} [a.inheritDownToMhz]  the bottom of this rung; rows in [that, mhz) inherit
 * @param {string} [a.at]           the stamp; defaults to now, local ISO
 * @returns {{ok:boolean, doc:object, closed:number, inherited:Array, raised:Array,
 *            ratchetWithheld:{mhz:number, reason:string, rows:Array}|null, why:string}}
 *
 * [TESTED: 2026-08-16 00:3x, OFFLINE · 7 blocks in `engine --selftest` (inheritance down the rung and
 *  its witness, the refusal of upward inheritance, the ratchet naming every frequency it moved, the
 *  closed vocabulary, the card's grid, the missing witness). Mutations 57 (drop the ratchet) and 60
 *  (allow upward inheritance) each redden their own block. **NOT TESTED: never called against the
 *  production `curves/measured.json`.**]
 */
export function closePoint(doc, {
  mhz = null,
  voltageMv = null,
  status = null,
  provenBy = null,
  extraTags = [],
  inheritDownToMhz = null,
  at = null,
} = {}) {
  const no = (why) => ({ ok: false, doc, closed: 0, inherited: [], raised: [], why });
  if (!doc || !Array.isArray(doc.frequencies) || doc.frequencies.length === 0) {
    return no('документ кривой пуст — закрывать частоту не в чем');
  }
  if (!Number.isFinite(mhz)) return no('частота не названа');
  if (!Number.isFinite(voltageMv)) return no(`напряжение для ${mhz} МГц не названо`);
  if (!STATUS_VALUES.includes(status)) {
    return no(`неизвестный статус ${JSON.stringify(status)}; словарь закрыт: ${STATUS_VALUES.join(', ')}`);
  }
  if (PROVEN_STATUSES.includes(status) && (typeof provenBy !== 'string' || provenBy.trim() === '')) {
    return no(`статус «${status}» утверждает, что частоту доказал прожиг — тогда назови форму нагрузки и вердикт; `
      + 'статус без свидетеля это заявление, а не улика');
  }
  // ⚠️ ДОПОЛНИТЕЛЬНЫЕ ТЕГИ ПРОВЕРЯЮТСЯ ТЕМ ЖЕ СТОРОЖЕМ, ЧТО И ЛЮБОЙ НАБОР (эпик `plans/33` фаза 2).
  // Проверяется ОБЪЕДИНЁННЫЙ набор, а не только добавка: правило исключительного класса — свойство
  // НАБОРА, и добавка, безобидная сама по себе, может дать второй `stop:*` рядом с тем, который
  // подразумевает статус. Вход, пускающий тег мимо словаря, отменяет `researches/13` §2.3 — а закрытость
  // и есть то, ради чего читатель документу верит.
  const addTags = Array.isArray(extraTags) ? extraTags : [];
  if (addTags.length) {
    const merged = [...new Set([...(tagsForStatus(status) ?? []), ...addTags])];
    const refusals = tagSetRefusals(merged);
    if (refusals.length) return no(`дополнительные теги отвергнуты: ${refusals.join(' · ')}`);
  }
  const grid = Array.isArray(doc.voltageGridMv) ? doc.voltageGridMv : [];
  if (grid.length && !grid.includes(voltageMv)) {
    return no(`${voltageMv} мВ нет на сетке напряжений карты — такого напряжения у неё попросить нельзя`);
  }

  const rows = doc.frequencies.map((r) => ({ ...r }));
  const idx = rows.findIndex((r) => r.mhz === mhz);
  if (idx < 0) return no(`частоты ${mhz} МГц нет в документе — она не с сетки этой карты`);
  if (Number.isFinite(rows[idx].stockVoltageMv) && voltageMv > rows[idx].stockVoltageMv) {
    return no(`${voltageMv} мВ ВЫШЕ стокового ${rows[idx].stockVoltageMv} мВ для ${mhz} МГц: тюнинг снижает напряжение частоты, а не поднимает`);
  }

  const stamp = at ?? localIso();

  // ---- (1a) ХРАПОВИК ДЛЯ САМОЙ ЗАКРЫВАЕМОЙ СТРОКИ — та же R17, прочитанная с другой стороны.
  //
  // Пункт (3) ниже поднимает ЧУЖИЕ строки: те, что ВЫШЕ по частоте и оказались дешевле только что
  // измеренной. Но бывает зеркальный случай, и живой прогон его принёс (2026-08-16, полоса
  // 3082…3015): закрывается 3045 МГц на 1020 мВ, а уже измеренная БОЛЕЕ НИЗКАЯ 3037 требует 1025.
  // Поднимать здесь надо ЭТУ строку, а поднимать её было некому — и документ отвергался целиком,
  // останавливая прогон на честном замере.
  //
  // Направление то же, что у пункта (3), и по той же причине: Vmin не убывает с частотой (нарушение
  // setup-времени, `researches/09` §2.3), поэтому более высокой частоте не может хватать меньшего
  // напряжения. **Поднимать — безопасно и ничего не выдумывает**, опускать соседку было бы отгрузкой
  // напряжения, на котором она уже провалилась. Слово владельца об этом случае: «очень редко — выше,
  // почти не бывает такого», то есть он назван возможным, значит движок обязан уметь его встретить.
  let effectiveMv = voltageMv;
  let ratchetedBy = null;
  // ⚠️ ПОДНИМАЕТ ТОЛЬКО СОСЕДКА, ДОКАЗАВШАЯ СВОЮ ПОТРЕБНОСТЬ ОТКАЗОМ (`demandsVoltage`), а не любая
  // «не стоковая». Разбор — на самой `demandsVoltage`: строка «предел рычага» говорит «ниже мы не
  // смогли попросить», и пуская её сюда, документ позволял непроверенной стене затирать честный
  // замер (2026-08-22: измеренные 875 мВ на 2887 МГц поднимались до 1000 мВ соседкой 2872 МГц,
  // где спуск остановил НАШ рычаг, а не кремний).
  for (let k = idx + 1; k < rows.length; k++) {          // таблица идёт высокие → низкие
    const r = rows[k];
    if (!demandsVoltage(r)) continue;
    if (!Number.isFinite(r.voltageMv) || r.voltageMv <= effectiveMv) continue;
    effectiveMv = r.voltageMv;
    ratchetedBy = r.mhz;
  }
  if (ratchetedBy !== null) {
    if (Number.isFinite(rows[idx].stockVoltageMv) && effectiveMv > rows[idx].stockVoltageMv) {
      return no(`храповик хотел поднять ${mhz} МГц до ${effectiveMv} мВ (столько требует более низкая `
        + `${ratchetedBy} МГц), а её собственный сток всего ${rows[idx].stockVoltageMv} мВ. Выше стока не `
        + 'поднимаем, и молча оставить инверсию тоже нельзя — этот замер противоречит стоковой таблице');
    }
    if (grid.length && !grid.includes(effectiveMv)) {
      return no(`храповик хотел поднять ${mhz} МГц до ${effectiveMv} мВ, а такого напряжения нет на сетке карты`);
    }
  }

  // ─── ЗАКРЫТИЕ БЕЗ НАБЛЮДЁННОГО ОТКАЗА НЕ ПИШЕТ МЕЛЬЧЕ ПОВЕРХ ГЛУБЖЕ (`bugs/55`) ────────────────
  //
  // 🔴 НАЙДЕНО ЖИВЫМ ПРОГОНОМ 2026-08-25, И ЦЕНА БЫЛА ИЗМЕРЕНА: одна такая запись стоила проекту
  // **22 измеренные строки**. Строка 2362 МГц стояла на 800 мВ; спуск прервался пробитым потолком
  // (`bugs/50`) и закрыл её на 850 мВ статусом `cut-short`. Запись прошла, а следом храповик ВВЕРХ
  // поднял до 850 двадцать одну строку выше, каждая из которых несла ПРОЙДЕННЫЙ прожиг на 800–845.
  //
  // ПОЧЕМУ ЭТО НЕПРАВИЛЬНО ПО СУЩЕСТВУ, а не по бухгалтерии. `cut-short`, `lever-limited`,
  // `depth-capped`, `not-served` — все они означают «спуск ОСТАНОВИЛСЯ», и ни один не означает
  // «частота ОТКАЗАЛА». Такая строка доказывает, что напряжение РАБОТАЕТ, и не доказывает, что
  // меньшее не работает. Значит она не вправе отменять более глубокое значение, которое кто-то уже
  // прожёг: из «2377 МГц работает на 800» и монотонности следует, что и 2362 работает на 800.
  // Инверсию создавала запись 850, а не строки выше, — и документ выбирал сторону, которую никто
  // не измерял.
  //
  // ⚠️ ОТКАЗ ЗДЕСЬ — НЕ АВАРИЯ, а находка о строке: `ok: true`, `closed: 0`, документ НЕ тронут,
  // полоса идёт дальше (слово владельца «здание важнее лесов»). Что прогон намерил, не теряется —
  // оно в журнале упреждающей записи и в урожае, у которого правило «только глубже» ТО ЖЕ САМОЕ.
  // Один принцип, два писателя.
  //
  // ⚠️ ЧЕГО ЭТО НЕ ЗАПРЕЩАЕТ: `edge-found` (в том числе рождённый зависанием, R18) пишет ВСЕГДА —
  // наблюдённый отказ на ЭТОЙ частоте сильнее любого унаследованного прохода, и храповик вверх по
  // нему обязан отработать. Поэтому отдельного сторожа на храповик ВВЕРХ не заводится: без записи
  // мельче ему нечего разносить (вариант A развилки `bugs/55` снят как лечение следствия).
  const existingRow = rows[idx];
  const closeDemandsVoltage = tagsForStatus(status).includes(CURVE_TAGS.STOP_EDGE_FOUND);
  if (!closeDemandsVoltage && !isUnmeasured(existingRow)
    && Number.isFinite(existingRow.voltageMv) && existingRow.voltageMv < effectiveMv) {
    return {
      ok: true,
      doc,
      closed: 0,
      inherited: [],
      raised: [],
      // ОСТАВЛЕННОЕ НАЗЫВАЕТСЯ ПОЛЕМ, А НЕ ПРОЗОЙ: сводке нужно СЧИТАТЬ такие случаи, а по прозе
      // считать нельзя — тот же довод, по которому класс отказа записи стал полем (`plans/40`).
      kept: { mhz, keptMv: existingRow.voltageMv, offeredMv: effectiveMv, status },
      why: `${mhz} МГц ОСТАВЛЕНА НА ${existingRow.voltageMv} мВ: прогон предложил ${effectiveMv} мВ со статусом `
        + `«${status}», то есть спуск ОСТАНОВИЛСЯ, а не встретил отказ. Более мелкое значение не отменяет `
        + 'более глубокое, которое уже доказано — иначе одна прерванная ступень поднимает храповиком всё, '
        + 'что выше (bugs/55: так были потеряны 22 измеренные строки)',
    };
  }

  // ---- the measured row itself.
  // TAGS, not a status (epic 04 phase 1). `origin:measured` is the strongest provenance there is, and
  // when the ratchet moved this very row it ALSO carries `origin:ratcheted` — two true facts that the
  // single field could only have held one of, which is the whole point of the class being cumulative.
  const measuredTags = [...tagsForStatus(status), CURVE_TAGS.ORIGIN_MEASURED];
  if (ratchetedBy !== null) measuredTags.push(CURVE_TAGS.ORIGIN_RATCHETED);
  // ⚠️ ТОЛЬКО НА ЗАМЕРЕННУЮ СТРОКУ, И НАСЛЕДНИКАМ НЕ ПЕРЕДАЁТСЯ. `origin:overshot` — свойство ТОГО
  // САМОГО измерения: карта подставила другое напряжение в ответ на ЭТОТ заказ. Строки ниже по
  // ступени наследуют ЧИСЛО (R16b), но не обстоятельства, при которых его сняли, — иначе одна
  // промахнувшаяся ступень пометила бы весь диапазон наследования, и тег снова перестал бы отличать.
  // Проверено выше на объединённом наборе, поэтому здесь только добавление.
  for (const t of addTags) if (!measuredTags.includes(t)) measuredTags.push(t);
  rows[idx] = {
    ...rows[idx],
    voltageMv: effectiveMv,
    tags: measuredTags,
    provenBy: ratchetedBy === null ? provenBy
      : `${provenBy} · ПОДНЯТО ХРАПОВИКОМ с ${voltageMv} до ${effectiveMv} мВ: более низкая ${ratchetedBy} МГц `
        + 'потребовала больше, а более высокой не может хватать меньшего',
    editedAt: stamp,
  };

  // ---- (2) the rest of the rung inherits, DOWNWARD ONLY. The table runs high → low, so the rows
  // that inherit are the ones AFTER this index.
  const inherited = [];
  if (Number.isFinite(inheritDownToMhz)) {
    if (inheritDownToMhz > mhz) {
      return no(`наследование идёт ВНИЗ по частоте: ${inheritDownToMhz} МГц не ниже ${mhz} МГц. `
        + 'Вверх наследовать нельзя — там напряжения требуется не меньше, а это и есть небезопасное направление');
    }
    for (let k = idx + 1; k < rows.length; k++) {
      if (!Number.isFinite(rows[k].mhz) || rows[k].mhz < inheritDownToMhz) break;
      // Inside one rung every stock voltage is the same by construction; a caller that hands over a
      // range straddling rungs would silently ship a frequency ABOVE its own stock, and that is a
      // refusal rather than a clamp — a clamp would hide the caller's bug in the artifact.
      if (Number.isFinite(rows[k].stockVoltageMv) && effectiveMv > rows[k].stockVoltageMv) {
        return no(`наследование ${effectiveMv} мВ от ${mhz} МГц не годится для ${rows[k].mhz} МГц: там сток `
          + `${rows[k].stockVoltageMv} мВ, то есть УЖЕ дешевле доказанного. Диапазон наследования пересёк ступень напряжения`);
      }
      rows[k] = {
        ...rows[k],
        voltageMv: effectiveMv,
        // Same terminal reason, DIFFERENT provenance — and the difference is now machine-readable
        // instead of buried in the witness prose below it.
        tags: [...tagsForStatus(status), CURVE_TAGS.ORIGIN_INHERITED],
        provenBy: `${provenBy ?? ''} · унаследовано ступенью от ${mhz} МГц (прожиг там): Vmin не убывает с частотой, `
          + 'значит доказанное выше по частоте не оптимистично ниже (E2-AC3 — не интерполяция, а тот же измеренный факт)',
        editedAt: stamp,
      };
      inherited.push(rows[k].mhz);
    }
  }

  // ---- (3) the ratchet, UPWARD, and every moved frequency is named
  //
  // ─── И ОНО РАБОТАЕТ ТОЛЬКО ОТ ЗАКРЫТИЯ, КОТОРОЕ СВОЁ НАПРЯЖЕНИЕ ТРЕБУЕТ (`bugs/57`) ───────────
  //
  // 🔴 НАЙДЕНО ЖИВЫМ ПРОГОНОМ 2026-08-25, И ЭТО ВТОРОЙ РАЗ ЗА ДВОЕ СУТОК ОДНИ И ТЕ ЖЕ 22 СТРОКИ.
  // Здесь стояло письменное утверждение, что сторож на этом направлении не нужен: «без записи
  // мельче ему нечего разносить». Прогон его опроверг — разносить есть что и БЕЗ записи мельче.
  // Строка 2302 МГц была ЗАВОДСКОЙ (`stop:untouched`, 885 мВ), спуск прервался пробитым потолком
  // (`bugs/50`) и закрыл её на 850 статусом `cut-short`. Запись законна: 850 глубже её стока 885,
  // сторож `bugs/55` пропустил её правильно, потому что перезаписывать было нечего. А потом этот
  // цикл разнёс 850 на 22 частоты выше, каждая с ПРОЙДЕННЫМ прожигом на 800–845.
  //
  // ПОЧЕМУ ЭТО НЕПРАВИЛЬНО ПО СУЩЕСТВУ: `cut-short` доказывает, что 850 мВ РАБОТАЕТ, и не
  // доказывает, что 800 не работает — вердикта о напряжении не было вовсе. Основание храповика
  // (Vmin не убывает с частотой) держится только тогда, когда нижняя строка ДОКАЗАЛА потребность
  // отказом; разбор — в шапке `demandsVoltage`, и предикат берётся ОТТУДА. Из «800 мВ прошло на
  // 2377 МГц» и монотонности следует, что и 2362 работает на 800: противоречие создало закрытие,
  // а не строки выше.
  //
  // ⚠️ ЧЕГО ЭТО НЕ ОТМЕНЯЕТ: `edge-found` (в том числе рождённый зависанием, R18) поднимает как
  // поднимал — наблюдённый отказ на ЭТОЙ частоте сильнее любого унаследованного прохода.
  // `closeDemandsVoltage` вычислен выше и здесь только ЧИТАЕТСЯ: второе определение «что есть
  // требование» было бы парой «истина ↔ зеркало» внутри одного модуля (EXP-0077).
  // ─── ВОРОТА ВЛАДЕЛЬЦА: ПРОМАХНУВШИЙСЯ ЗАМЕР НЕ КОРМИТ ХРАПОВИК (`bugs/63`, interviews/018 = A) ──
  //
  // Решение владельца 2026-08-30 11:51 через контур, вариант A. Разбор — в самом интервью, там же
  // рисунок и графики, по которым он его принимал. Короткая версия, чтобы её не пришлось искать:
  //
  // Когда карта отказывается идти ниже своего пола, она подставляет СВОЁ напряжение вместо
  // заказанного. Замерено по 805 ступеням боевого журнала: 26 ступеней с разрывом ≥ 30 мВ, и выдача
  // на них садится всего на ЧЕТЫРЕ значения (915 ×13 · 910 ×6 · 840 ×5 · 890 ×2) при РАЗНЫХ заказах
  // от 810 до 885 мВ. Так выглядит пол, а не дрейф таблицы: дрейф размазал бы выдачу по сетке, пол
  // собирает её в точки. Температура проверена и не объясняет (наклон 2,56 мВ/°C при r = 0,27, все
  // 26 сняты при обычных 49…54 °C); решающее число — средний ЗАКАЗ у широких разрывов 855 мВ против
  // 936 у остальных: широкий разрыв там, где мы просим ГЛУБОКО, а не там, где карта горячая.
  //
  // Значит такая строка честна про СЕБЯ («частоту обслуживало 915 мВ, и это прошло прожиг») и
  // ничего не говорит о ПОТРЕБНОСТИ частоты — это замер состояния карты в ту минуту. Основание
  // храповика (Vmin не убывает с частотой) сравнивает ПОТРЕБНОСТИ, поэтому кормить его таким
  // замером незаконно: 26 августа он так отобрал 45 мВ у 15 частот, каждая с пройденным прожигом.
  //
  // ⚠️ ЧЕГО ВОРОТА НЕ ТРОГАЮТ, И ЭТО ПОЛОВИНА ОТВЕТА: строка САМА пишется как писалась (пункт (1),
  // канон владельца «тюним то, что карта выдаёт»), и правило монотонности не отменяется (пункт (2)).
  // Отключается ровно распространение НА ЧУЖИЕ СТРОКИ. `edge-found` без промаха поднимает как
  // поднимал.
  //
  // ⚠️ И УДЕРЖАНИЕ НАЗЫВАЕТСЯ ВСЛУХ, А НЕ ПРОГЛАТЫВАЕТСЯ. Тихий пропуск оставил бы документ в
  // противоречии, о котором никто не знает, — это возражение варианта C, и владелец выбрал не его.
  // Поэтому считается, КОГО храповик поднял бы, и это едет полем к вызывающему: монотонность
  // восстановит следующий честный прожиг, а до тех пор долг виден и счётен.
  const closeIsOvershot = measuredTags.includes(CURVE_TAGS.ORIGIN_OVERSHOT);
  const raised = [];
  const withheld = [];
  for (let k = idx - 1; closeDemandsVoltage && k >= 0; k--) {
    const r = rows[k];
    // A row still at its FACTORY value is not a measurement, and the ratchet exists to reconcile two
    // measurements that contradict each other. Raising an untouched row would be inventing one — and
    // it cannot be needed anyway: the factory table is monotone, so a stock row above already carries
    // at least as much as this frequency's stock, hence at least as much as anything we ship for it.
    if (isUnmeasured(r)) continue;
    if (!Number.isFinite(r.voltageMv) || r.voltageMv >= effectiveMv) continue;
    if (closeIsOvershot) {
      // СЧИТАЕМ, НО НЕ ДВИГАЕМ. Отказ «выше стока не поднимаем» ниже сюда НЕ переносится намеренно:
      // он ловит противоречие замера со стоковой таблицей, а промахнувшийся замер противоречить ей
      // не уполномочен — из него вообще не следует утверждения о потребности этой частоты.
      withheld.push({ mhz: r.mhz, fromMv: r.voltageMv, wouldBeMv: effectiveMv });
      continue;
    }
    if (Number.isFinite(r.stockVoltageMv) && effectiveMv > r.stockVoltageMv) {
      return no(`храповик хотел поднять ${r.mhz} МГц до ${effectiveMv} мВ, а её сток всего ${r.stockVoltageMv} мВ — `
        + 'выше стока не поднимаем, и молча оставить инверсию тоже нельзя. Замер противоречит стоковой таблице');
    }
    raised.push({ mhz: r.mhz, fromMv: r.voltageMv, toMv: effectiveMv });
    rows[k] = {
      ...r,
      voltageMv: effectiveMv,
      // THE ROW KEEPS ITS OWN TERMINAL REASON and gains `origin:ratcheted`. Under the single field
      // this fact existed only as prose, so nothing could ask «is this voltage the deepest this
      // frequency reached, or the safe direction somebody raised it to?» — and that is exactly the
      // question the owner's outlier idea will need answered (`plans/23` phase 3).
      tags: [...new Set([...(Array.isArray(r.tags) ? r.tags : []), CURVE_TAGS.ORIGIN_RATCHETED])],
      // ПРЕЖНЕЕ ЗНАЧЕНИЕ — В САМОЙ СТРОКЕ («с X до Y»), симметрично точке (2) выше. Хвост
      // `bugs/57`: семь строк раннего прогона восстановить было НЕЧЕМ — подъём назывался только
      // в сводке возврата, а сводка живёт в вызвавшей сессии и умирает с ней. Улика в строке
      // делает урон обратимым без снимков.
      provenBy: `${r.provenBy ?? 'сток'} · ПОДНЯТО ХРАПОВИКОМ с ${r.voltageMv} до ${effectiveMv} мВ измерением на ${mhz} МГц: `
        + 'более низкая частота потребовала больше, а более высокой не может хватать меньшего',
      editedAt: stamp,
    };
  }

  const closed = 1 + inherited.length;
  return {
    ok: true,
    // The derived view is re-attached because `{...r}` above dropped it (see `isUnmeasured`): a caller
    // that reads `.status` off a closePoint RESULT must see the same thing it sees off a loaded doc,
    // or the view would be present or absent depending on which door the document came through.
    doc: attachDerivedStatus({ ...doc, frequencies: rows }),
    closed,
    inherited,
    raised,
    // ПОЛЕ, А НЕ ПРОЗА (`bugs/63`): сводке и сторожам нужно СЧИТАТЬ удержанные подъёмы, а по прозе
    // считать нельзя — тот же довод, по которому классом стал отказ записи и `kept` выше.
    ratchetWithheld: withheld.length ? { mhz, reason: CURVE_TAGS.ORIGIN_OVERSHOT, rows: withheld } : null,
    why: `${mhz} МГц закрыта: ${voltageMv} мВ, статус «${status}»`
      + (inherited.length ? ` · ступень унаследовали ${inherited.length} частот(ы) до ${inheritDownToMhz} МГц` : '')
      + (raised.length ? ` · ⚠️ ХРАПОВИК ПОДНЯЛ ${raised.length} частот(у) выше: ${raised.map((x) => `${x.mhz} МГц ${x.fromMv}→${x.toMv} мВ`).join(', ')}` : '')
      + (withheld.length ? ` · 🔒 ХРАПОВИК УДЕРЖАН (замер с промахом, ${CURVE_TAGS.ORIGIN_OVERSHOT}, решение владельца interviews/018 = A): `
        + `не поднято ${withheld.length} частот(а) — ${withheld.map((x) => `${x.mhz} МГц осталась ${x.fromMv} мВ вместо ${x.wouldBeMv}`).join(', ')}`
        + '. Монотонность здесь восстановит следующий честный прожиг' : ''),
  };
}

// =================================================================================================
// 3. Persistence — atomic, because a hang is a NORMAL event here
// =================================================================================================

export function saveCurveDoc(doc, { name = 'measured', dir = CURVES_DIR, fs = null } = {}) {
  return writeJsonAtomic(curvePath(name, dir), doc, { fs });
}

export function loadCurveDoc({ name = 'measured', dir = CURVES_DIR } = {}) {
  const file = curvePath(name, dir);
  if (!existsSync(file)) return null;
  return attachDerivedStatus(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * HANG THE LEGACY `status` ON EVERY ROW AS A NON-ENUMERABLE, READ-ONLY VIEW.
 *
 * ─── WHY NON-ENUMERABLE, and it is the whole safety of the migration ──────────────────────────────
 *
 * `JSON.stringify` walks ENUMERABLE keys, and so does `Object.keys` — which is what the `ROW_KEYS`
 * exact-match gate iterates. So a derived status declared this way is:
 *
 *   · readable exactly as before — `r.status` keeps working for every consumer not yet migrated;
 *   · **impossible to save by accident** — it cannot reach the file, so the document on disk holds
 *     ONE truth and the pair the canon forbids is not created but PREVENTED;
 *   · invisible to the format gate, so `ROW_KEYS` needs no exception carved into it for a field that
 *     is not really there.
 *
 * A plain assignment would have given the first property and neither of the other two, and the field
 * would have drifted back into the file the first time anything round-tripped a loaded document.
 *
 * Idempotent: re-attaching to a row that already has the view is a no-op, because a getter defined
 * twice with the same source is the same view.
 */
export function attachDerivedStatus(doc) {
  if (!doc || !Array.isArray(doc.frequencies)) return doc;
  for (const r of doc.frequencies) {
    if (!r || typeof r !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(r, 'status')) continue;
    Object.defineProperty(r, 'status', {
      get() { return statusFromTags(this.tags); },
      enumerable: false,
      configurable: true,
    });
  }
  return doc;
}

// =================================================================================================
// 4. The conversion to what the hardware takes — COMPUTED, never stored
// =================================================================================================

/**
 * Turn «frequency → voltage» into the per-entry frequency offsets the card's table accepts.
 *
 * ─── THIS FUNCTION IS WHERE THE OWNER'S FRAMING PAYS OFF ────────────────────────────────────────
 *
 * The document says what each frequency must cost. The hardware says «I have 127 entries, each at a
 * fixed voltage; tell me each entry's frequency». So for every entry at voltage V we ask the document
 * one question: **what is the highest frequency our table says V can serve?** — and that becomes the
 * entry's frequency. The offset is that frequency minus what the entry reads RIGHT NOW.
 *
 * Because the current reading is taken live, the same document produces different offsets at 40 °C
 * and at 57 °C — and the RESULT is identical: every frequency gets the voltage we measured for it.
 * Storing the offsets instead would have frozen one temperature into the artifact.
 */
export function offsetsFor(doc, tablePoints, { count = CURVE_GRAPHICS_POINT_COUNT } = {}) {
  const rows = doc.frequencies;
  const offsets = new Array(count).fill(0);
  const served = new Array(count).fill(null);
  const lo = CLOCK_OFFSET_MIN_MHZ ?? -1000;
  const hi = CLOCK_OFFSET_MAX_MHZ ?? 1000;
  let clamped = 0;

  for (let j = 0; j < count; j++) {
    const entry = tablePoints[j];
    if (!entry || entry.freqKhz <= 0) continue;
    // The highest frequency this voltage is allowed to serve, per the document. Rows run high → low,
    // so the FIRST row whose voltage fits is the answer.
    const row = rows.find((r) => r.voltageMv <= entry.mv);
    if (!row) continue;
    served[j] = row.mhz;
    const want = row.mhz - entry.mhz;
    // Never LOWER an entry: pushing entries down is what a mode's ceiling does, and a ceiling is a
    // mode's knob applied on top of this — not part of the measurement (`plans/14` §4.3).
    const off = Math.max(0, Math.min(want, hi));
    if (want > hi) clamped++;
    offsets[j] = Math.max(lo, off);
  }
  return { offsets, served, clamped };
}

// =================================================================================================
// 5. The pair check: the document against the live card
// =================================================================================================

/**
 * The truth↔mirror check of `plans/14` F1-AC4, re-expressed in the owner's coordinates.
 *
 * What is held against the card is **the voltage grid** — the set of rungs the card offers. Those do
 * not move. What deliberately is NOT compared is the stock voltage per frequency: a warmer card wants
 * more voltage for the same frequency, and an instrument that reddens because the room warmed up is
 * an instrument nobody will keep running.
 */
export function verifyAgainstCard(doc, tablePoints, { card = null } = {}) {
  const problems = [];
  const liveGrid = [...new Set(tablePoints.slice(0, CURVE_GRAPHICS_POINT_COUNT).map((p) => p.mv))].sort((a, b) => a - b);
  const stored = doc.voltageGridMv ?? [];

  if (liveGrid.length !== stored.length) {
    problems.push({ field: 'voltageGridMv', why: `у карты ${liveGrid.length} ступеней напряжения, в документе ${stored.length}` });
  } else {
    for (let i = 0; i < liveGrid.length; i++) {
      if (liveGrid[i] !== stored[i]) {
        problems.push({
          field: `voltageGridMv[${i}]`,
          why: `в документе ${stored[i]} мВ, у карты ${liveGrid[i]} мВ`
            + ` · штамп документа: драйвер ${doc.stamp?.driver}, VBIOS ${doc.stamp?.vbios}`
            + (card ? ` · карта сейчас: драйвер ${card.driver}, VBIOS ${card.vbios}` : ''),
        });
        break;
      }
    }
  }
  if (card && doc.stamp && (doc.stamp.driver !== card.driver || doc.stamp.vbios !== card.vbios)) {
    problems.push({
      field: 'stamp',
      why: `кривая снята на драйвере ${doc.stamp.driver} / VBIOS ${doc.stamp.vbios}, а карта сейчас `
        + `${card.driver} / ${card.vbios} — по правилу R6 каждая запись недействительна до перепроверки`,
    });
  }
  return { ok: problems.length === 0, problems, compared: stored.length };
}

// =================================================================================================
// 6. The CLI
// =================================================================================================

const H = (t) => `\n${t}\n${'─'.repeat(Math.min(t.length, 96))}`;

async function readLiveTable() {
  const { readLiveCurvePoints } = await import('./card-grids.mjs');
  return readLiveCurvePoints();
}

async function cmdGrids() {
  console.log(H('СЛОВАРИ КАРТЫ — только чтение (ideas/03 шаги 3–4)'));
  const grids = await buildGrids({});
  for (const [kind, g] of [['напряжений', grids.voltage], ['частот', grids.frequency]]) {
    const bad = validateGrid(g, { kind: g.kind.replace('-grid', '') });
    console.log(`\nСЛОВАРЬ ${kind.toUpperCase()}: ${g.count} значений · ${g.kind === 'voltage-grid'
      ? `${g.rangeMv[0]}…${g.rangeMv[1]} мВ · ступени ${g.spacingsMv.map((s) => `${s.mv} мВ ×${s.count}`).join(' · ')} · равномерна: ${g.uniform ? 'да' : 'НЕТ'}`
      : `${g.rangeMhz[0]}…${g.rangeMhz[1]} МГц · шаги ${g.stepsMhz.map((s) => `${s.mhz} ×${s.count}`).join(' · ')} · максимум экземпляра ${g.maxGraphicsMhz} МГц (потолок R13)`}`);
    console.log(`  переснимается: ${g.probe}`);
    console.log(`  проверка формата: ${bad.length === 0 ? 'ЧИСТО' : `ОТКАЗ — ${bad.map((b) => `${b.field}: ${b.why}`).join(' · ')}`}`);
  }
  const written = writeGrids(grids);
  console.log(`\nЗАПИСАНО: ${written.voltage}\n          ${written.frequency}`);
  return 0;
}

async function cmdInit({ force = false } = {}) {
  console.log(H('ТЮНИНГ-КРИВАЯ — посев: каждой частоте её стоковое напряжение (ideas/03 шаг 5)'));
  const existing = loadCurveDoc();
  if (existing && !force) {
    const s = summarize(existing);
    console.log(`ОТКАЗ: ${curvePath()} уже существует.`);
    console.log(`  частот ${s.total} · закрыто ${s.closed} · доказано прожигом ${PROVEN_STATUSES.reduce((n, k) => n + (s.byStatus[k] ?? 0), 0)}`);
    console.log('  Пересев СТЁР БЫ найденный край. Если это и требуется — `--init --force`.');
    return 1;
  }
  const freq = loadGrid('frequency');
  if (!freq) {
    console.log('ОТКАЗ: словаря частот нет. Сперва `npm run curve -- --grids`.');
    return 1;
  }
  const info = probeGpuInfo();
  const table = await readLiveTable();
  const doc = initFromCard({
    frequencyGrid: freq,
    tablePoints: table,
    card: { name: String(info.name), maxGraphicsMhz: Number(info['clocks.max.graphics']) },
    stamp: { driver: String(info.driver_version), vbios: String(info.vbios_version), takenAt: localIso() },
    // The temperature is part of the reading: at 57 °C the same frequency wants more voltage than
    // cold. It is recorded so the STOCK column can be read honestly, not so anything is chased.
    tempC: Number(info['temperature.gpu']) || null,
  });
  const bad = validateCurveDoc(doc, { card: doc.card, frequencyGrid: freq });
  if (bad.length) {
    console.log(`ОТКАЗ: свежепосеянный документ не проходит собственный валидатор — это дефект кода, а не данных:\n  ${bad.slice(0, 5).map((b) => `${b.field}: ${b.why}`).join('\n  ')}`);
    return 1;
  }
  const file = saveCurveDoc(doc);
  const s = summarize(doc);
  console.log(`ПОСЕЯНО: ${file}`);
  console.log(`  частот ${s.total} · ${doc.frequencies[doc.frequencies.length - 1].mhz}…${doc.frequencies[0].mhz} МГц`);
  console.log(`  ступеней напряжения у карты: ${doc.voltageGridMv.length} (${doc.voltageGridMv[0]}…${doc.voltageGridMv[doc.voltageGridMv.length - 1]} мВ)`);
  console.log(`  снято при ${doc.stamp.tempC ?? '—'} °C · всё пока стоковое, тюнинга ноль`);
  return 0;
}

function cmdShow() {
  const doc = loadCurveDoc();
  if (!doc) { console.log(`Документа кривой нет: ${curvePath()}. Посеять — \`npm run curve -- --init\`.`); return 1; }
  console.log(H(`ТЮНИНГ-КРИВАЯ «${doc.name}» · ${doc.card?.name ?? '—'} · драйвер ${doc.stamp?.driver}, VBIOS ${doc.stamp?.vbios}, снята ${doc.stamp?.takenAt} при ${doc.stamp?.tempC ?? '—'} °C`));
  const s = summarize(doc);
  console.log(`\nЧАСТОТ ${s.total} · закрыто ${s.closed} · оттюнено ${s.tuned}`
    + (s.tuned ? ` · глубже всего −${s.deepestCutMv} мВ, в среднем −${s.averageCutMv} мВ` : ''));
  console.log(`ПО СТАТУСАМ: ${Object.entries(s.byStatus).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
  console.log('\n   МГц    сток мВ   стало мВ   снято  статус             правлена');
  for (const r of doc.frequencies) {
    const cut = (r.stockVoltageMv ?? 0) - (r.voltageMv ?? 0);
    if (cut === 0 && r.status === CURVE_STATUS.STOCK && r.mhz % 100 > 8) continue;
    console.log(`  ${String(r.mhz).padStart(5)} ${String(r.stockVoltageMv).padStart(9)} ${String(r.voltageMv).padStart(10)} ${String(cut).padStart(7)}  ${r.status.padEnd(18)} ${r.editedAt}`);
  }
  console.log('\n(нетронутые стоковые частоты печатаются примерно через сотню МГц — остальные были бы шумом)');
  const bad = validateCurveDoc(doc, { card: doc.card, frequencyGrid: loadGrid('frequency') });
  console.log(`\nВАЛИДАТОР: ${bad.length === 0 ? 'ЧИСТО' : `ОТКАЗ (${bad.length})\n  ${bad.slice(0, 8).map((b) => `${b.field}: ${b.why}`).join('\n  ')}`}`);
  return bad.length === 0 ? 0 : 1;
}

/** The profiles directory, resolved locally rather than imported: `profile-store` depends on curve
 *  documents, so importing it from here would be a cycle bought for one constant. One path, stated. */
const PROFILES_DIR_LOCAL = fileURLToPath(new URL('../../profiles/', import.meta.url));

/** Read every parseable profile JSON in the directory. Reads only; a broken file is reported to the
 *  caller by name rather than swallowed — a mode whose file does not parse is NOT shipped. */
function readProfileObjects(dir = PROFILES_DIR_LOCAL) {
  if (!existsSync(dir)) return { profiles: [], broken: [] };
  const profiles = []; const broken = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    try { profiles.push(JSON.parse(readFileSync(path.join(dir, f), 'utf8'))); } catch { broken.push(f); }
  }
  return { profiles, broken };
}

function cmdProgress({ json = false } = {}) {
  const doc = loadCurveDoc();
  if (!doc) { console.log(`Документа кривой нет: ${curvePath()}. Посеять — \`npm run curve -- --init\`.`); return 1; }
  const { profiles, broken } = readProfileObjects();
  const p = acceptanceProgress(doc, { profiles });
  if (json) { console.log(JSON.stringify({ ...p, brokenProfileFiles: broken }, null, 2)); return 0; }
  console.log(renderDeliveryLine(p));
  if (broken.length > 0) console.log(`⚠️ профили не прочитались и отгруженными не считаются: ${broken.join(', ')}`);
  return 0;
}

async function cmdVerify() {
  const doc = loadCurveDoc();
  if (!doc) { console.log(`Документа кривой нет: ${curvePath()}.`); return 1; }
  console.log(H('СВЕРКА ДОКУМЕНТА С ЖИВОЙ КАРТОЙ (пара «правда ↔ зеркало»)'));
  const info = probeGpuInfo();
  const table = await readLiveTable();
  const r = verifyAgainstCard(doc, table, {
    card: { driver: String(info.driver_version), vbios: String(info.vbios_version) },
  });
  console.log(`\nСверено ступеней напряжения: ${r.compared}. Стоковые напряжения частот НЕ сверяются: `
    + `при нагреве та же частота требует больше, и прибор краснел бы от прогретой комнаты (карта сейчас ${info['temperature.gpu']} °C).`);
  if (r.ok) { console.log('РАСХОЖДЕНИЙ НЕТ.'); return 0; }
  console.log(`РАСХОЖДЕНИЯ (${r.problems.length}):`);
  for (const p of r.problems) console.log(`  ${p.field}: ${p.why}`);
  return 1;
}

// =================================================================================================
// 7. Selftest — hostile fixtures, no GPU
// =================================================================================================

const GRID_MV = [800, 850, 900, 950, 1000, 1050, 1100];

function healthyDoc({ maxMhz = 3090 } = {}) {
  const at = '2026-08-15T16:20:00+03:00';
  const mhzList = [3090, 3000, 2900, 2800, 2400, 2000, 1500, 1000, 500, 180];
  const volts = [1100, 1100, 1050, 1050, 1000, 950, 900, 850, 800, 800];
  return {
    kind: 'tuning-curve', name: 'measured',
    card: { name: 'NVIDIA GeForce RTX 5070 Ti', maxGraphicsMhz: maxMhz, frequencyCount: mhzList.length },
    voltageGridMv: [...GRID_MV],
    stamp: { driver: '610.88', vbios: '98.03.58.40.8b', takenAt: at, tempC: 44 },
    frequencies: mhzList.map((mhz, i) => ({
      mhz, voltageMv: volts[i], stockVoltageMv: volts[i],
      tags: [CURVE_TAGS.STOP_UNTOUCHED], provenBy: null, editedAt: at,
    })),
  };
}
const FAKE_LADDER = { values: [3090, 3000, 2900, 2800, 2400, 2000, 1500, 1000, 500, 180] };

function cmdSelftest() {
  let pass = 0; let fail = 0;
  const ok = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); }
  };
  const card = { maxGraphicsMhz: 3090 };
  const fieldsOf = (doc) => validateCurveDoc(doc, { card, frequencyGrid: FAKE_LADDER }).map((b) => b.field);

  console.log(H('САМОПРОВЕРКА curve-store — враждебные фикстуры, карта не нужна'));
  console.log('АДРЕСАТЫ МУТАЦИЙ, названные ДО прогона (EXP-0016): словарь статусов · напряжение с сетки · '
    + 'напряжение не выше стокового · монотонность по частоте · порядок таблицы · частота с сетки карты · '
    + 'потолок R13 · штамп · свидетель прожига · атомарная запись · перевод в смещения · сверка сетки · '
    + 'счётчик приёмки (подмена происхождения)');

  console.log('\n— ЗДОРОВЫЙ ДОКУМЕНТ —');
  ok('чистый документ принимается', fieldsOf(healthyDoc()).length === 0, JSON.stringify(fieldsOf(healthyDoc()).slice(0, 3)));
  ok('сводка: ничего не оттюнено на посеве', summarize(healthyDoc()).tuned === 0);
  ok('сводка считает глубину среза', (() => {
    const d = healthyDoc(); d.frequencies[0].voltageMv = 1000; d.frequencies[1].voltageMv = 1000;
    const s = summarize(d); return s.tuned === 2 && s.deepestCutMv === 100;
  })());

  console.log('\n— СЧЁТЧИК ПРИЁМКИ (ideas/14): край читается из тегов, происхождение не подменяется —');
  const T = CURVE_TAGS;
  const progDoc = (tagSets) => {
    const d = healthyDoc();
    tagSets.forEach((tags, i) => { d.frequencies[i].tags = tags; });
    return d;
  };
  ok('посев: краёв 0, не тронуто всё, режимов 0/4', (() => {
    const p = acceptanceProgress(healthyDoc(), { profiles: [] });
    return p.edges.total === 0 && p.untouched === p.total && p.modes.shipped === 0 && p.modes.total === 4;
  })());
  ok('край с прожигом идёт в «прожигом», край от соседки — в «соседкой»', (() => {
    const p = acceptanceProgress(progDoc([
      [T.STOP_EDGE_FOUND, T.ORIGIN_MEASURED],
      [T.STOP_EDGE_FOUND, T.ORIGIN_INHERITED],
    ]));
    return p.edges.total === 2 && p.edges.burned === 1 && p.edges.inherited === 1 && p.untouched === 8;
  })());
  ok('МУТАЦИЯ КРИТЕРИЯ 3: выведенный край НЕ считается прожжённым', (() => {
    const p = acceptanceProgress(progDoc([[T.STOP_EDGE_FOUND, 'origin:interpolated']]));
    return p.edges.burned === 0 && p.edges.derived === 1 && p.edges.total === 1;
  })());
  ok('предел рычага и голый храповик краем не являются', (() => {
    const p = acceptanceProgress(progDoc([
      [T.STOP_LEVER_LIMIT, T.ORIGIN_MEASURED],
      [T.STOP_OUR_CAP, T.ORIGIN_RATCHETED],
    ]));
    return p.edges.total === 0;
  })());
  ok('спорная комбинация (край только от храповика) не глотается и называет частоту', (() => {
    const p = acceptanceProgress(progDoc([[T.STOP_EDGE_FOUND, T.ORIGIN_RATCHETED]]));
    return p.edges.total === 1 && p.edges.burned === 0 && p.edges.unclassified.length === 1
      && p.edges.unclassified[0].mhz === 3090
      && renderDeliveryLine(p).includes('не классифицировано: 1');
  })());
  ok('режим отгружен только при qualified === true; чужой mode и черновик не считаются', (() => {
    const p = acceptanceProgress(healthyDoc(), {
      profiles: [
        { mode: 'optimised', qualified: true },
        { mode: 'silent-cold', qualified: false },
        { mode: 'max-performance' },
        { mode: 'test-pl250', qualified: true },
      ],
    });
    return p.modes.shipped === 1 && p.modes.names.join() === 'optimised';
  })());
  ok('строка доставки несёт форму канона', (() => {
    const line = renderDeliveryLine(acceptanceProgress(progDoc([[T.STOP_EDGE_FOUND, T.ORIGIN_MEASURED]])));
    return line.startsWith('ПРИЁМКА: краёв 1/10 (прожигом 1 · соседкой 0 · выведено 0)')
      && line.includes('не тронуто 9') && line.includes('режимов отгружено 0/4');
  })());

  console.log('\n— ФОРМА И ОБЯЗАТЕЛЬНЫЕ ПОЛЯ —');
  const cases = [
    ['не объект', () => null, '<кривая>'],
    ['чужой kind', () => ({ ...healthyDoc(), kind: 'profile' }), 'kind'],
    ['нет штампа', () => { const d = healthyDoc(); delete d.stamp; return d; }, 'stamp'],
    ['takenAt в Z', () => { const d = healthyDoc(); d.stamp.takenAt = '2026-08-15T13:20:00Z'; return d; }, 'stamp.takenAt'],
    ['нет сетки напряжений', () => { const d = healthyDoc(); d.voltageGridMv = []; return d; }, 'voltageGridMv'],
    ['пустая таблица частот', () => { const d = healthyDoc(); d.frequencies = []; return d; }, 'frequencies'],
    ['неизвестное поле строки', () => { const d = healthyDoc(); d.frequencies[3].hz = 1; return d; }, 'frequencies[3].hz'],
    ['тега нет в словаре', () => { const d = healthyDoc(); d.frequencies[3].tags = ['стоп:почти-хорошо']; return d; }, 'frequencies[3].tags'],
    ['нет даты правки', () => { const d = healthyDoc(); d.frequencies[3].editedAt = 'вчера'; return d; }, 'frequencies[3].editedAt'],
  ];
  for (const [name, make, expect] of cases) {
    const fields = fieldsOf(make());
    ok(`${name} → ${expect}`, fields.includes(expect), `получено ${JSON.stringify(fields.slice(0, 3))}`);
  }

  console.log('\n— ЧАСТОТА: только с сетки карты, только сверху вниз, не выше максимума —');
  ok('частоты нет на сетке карты', fieldsOf((() => { const d = healthyDoc(); d.frequencies[4].mhz = 2401; return d; })()).includes('frequencies[4].mhz'));
  ok('порядок таблицы нарушен', (() => {
    const d = healthyDoc();
    [d.frequencies[2], d.frequencies[3]] = [d.frequencies[3], d.frequencies[2]];
    return fieldsOf(d).some((f) => f.startsWith('frequencies[') && f.endsWith('.mhz'));
  })());
  ok('R13: частота выше максимума карты отвергается', (() => {
    const d = healthyDoc();
    d.frequencies[0].mhz = 3200;
    const bad = validateCurveDoc(d, { card, frequencyGrid: null }).find((b) => b.field === 'frequencies[0].mhz');
    return Boolean(bad) && bad.why.includes('3090');
  })());

  console.log('\n— НАПРЯЖЕНИЕ: только ступень сетки, только вниз от стока —');
  ok('напряжения нет на сетке карты, и отказ печатает саму сетку', (() => {
    const d = healthyDoc(); d.frequencies[5].voltageMv = 947;
    const bad = validateCurveDoc(d, { card, frequencyGrid: FAKE_LADDER }).find((b) => b.field === 'frequencies[5].voltageMv');
    return Boolean(bad) && bad.why.includes('ступеней');
  })());
  ok('напряжение ВЫШЕ стокового отвергается (тюнинг снижает, а не поднимает)', (() => {
    const d = healthyDoc(); d.frequencies[5].voltageMv = 1000;   // сток 950
    return fieldsOf(d).includes('frequencies[5].voltageMv');
  })());
  ok('снижение напряжения принимается', (() => {
    const d = healthyDoc(); d.frequencies[5].voltageMv = 900; d.frequencies[6].voltageMv = 900;
    return fieldsOf(d).length === 0;
  })());

  console.log('\n— МОНОТОННОСТЬ: высокой частоте не может хватать МЕНЬШЕГО напряжения —');
  ok('инверсия ловится и называет ОБЕ частоты', (() => {
    // 2000 МГц опускаем до 850, а 1500 остаётся на 900 — более НИЗКОЙ частоте нужно БОЛЬШЕ. Снижение,
    // а не повышение: иначе сработал бы соседний отказ «выше стокового» и блок зеленел бы не своей
    // причиной (EXP-0016 — мутационный проход именно за этим и нужен).
    // ⚠️ ОБЕ СТРОКИ ОБЪЯВЛЕНЫ ИЗМЕРЕННЫМИ, и это не украшение фикстуры: инверсия — противоречие
    // между двумя ЗАМЕРАМИ, а строка на заводском значении замером не является. Прежняя редакция
    // фикстуры правила одно напряжение и оставляла статус `stock`, то есть моделировала не инверсию,
    // а недомеренный документ — ровно то состояние, в котором развёртка находится всё время работы.
    const d = healthyDoc();
    for (const i of [5, 6]) { d.frequencies[i].tags = [CURVE_TAGS.STOP_EDGE_FOUND]; d.frequencies[i].provenBy = 'прожиг'; }
    d.frequencies[5].voltageMv = 850;
    const bad = validateCurveDoc(d, { card, frequencyGrid: FAKE_LADDER }).find((b) => b.field.endsWith('.voltageMv'));
    return Boolean(bad) && bad.why.includes('1500') && bad.why.includes('2000');
  })());
  ok('равные напряжения соседних частот инверсией НЕ считаются (127 ступеней на 389 частот — они делятся)',
    firstInversion(healthyDoc().frequencies) === null);
  // — THE CORRECTION `plans/15` §4.5 PAID FOR, and it has its own block because it is what a
  // mutation must be able to break: a top-down sweep leaves EVERY closed frequency standing above
  // lower ones that still carry the factory voltage. Judging that as an inversion stopped the sweep
  // at its first write — a guard causing the regression it exists to prevent.
  ok('НЕДОМЕРЕННАЯ строка инверсией НЕ считается — иначе развёртка встанет на первой же записи', (() => {
    const d = healthyDoc();
    d.frequencies[4].tags = [CURVE_TAGS.STOP_EDGE_FOUND];
    d.frequencies[4].provenBy = 'прожиг';
    d.frequencies[4].voltageMv = 850;                       // 2400 МГц закрыта, 2000 и ниже ещё на стоке
    return validateCurveDoc(d, { card, frequencyGrid: FAKE_LADDER }).length === 0;
  })());
  // The assertion names BOTH frequencies rather than merely counting a refusal: 845 vs 850 could also
  // trip «not on the card's grid», and a block that greens on a neighbour's reason is a false green.
  ok('но противоречие между двумя ЗАМЕРАМИ ловится и ЧЕРЕЗ недомеренный промежуток', (() => {
    const d = healthyDoc();
    d.frequencies[4].tags = [CURVE_TAGS.STOP_EDGE_FOUND]; d.frequencies[4].provenBy = 'прожиг';
    d.frequencies[4].voltageMv = 800;                       // 2400 МГц измерена на 800
    d.frequencies[7].tags = [CURVE_TAGS.STOP_EDGE_FOUND]; d.frequencies[7].provenBy = 'прожиг';
    d.frequencies[7].voltageMv = 850;                       // 1000 МГц измерена ВЫШЕ, через две стоковые строки
    const bad = validateCurveDoc(d, { card, frequencyGrid: FAKE_LADDER }).find((b) => b.field.endsWith('.voltageMv'));
    return Boolean(bad) && bad.why.includes('2400') && bad.why.includes('1000');
  })());

  // ─── ПРОТИВОРЕЧИТЬ МОЖЕТ ТОЛЬКО ТРЕБУЮЩАЯ СТРОКА (`bugs/35`) ─────────────────────────────────
  //
  // Принёс ЖИВОЙ ПРОГОН 2026-08-23 при владельце: развёртка нашла край 2820 МГц за 184 с, четыре
  // прожига прошли — и не сохранила НИЧЕГО. Строка 2872 МГц (`lever-limited` + `ratcheted`)
  // «противоречила» честному замеру 2880 МГц, документ был отвергнут целиком, покрытие 0 из 17.
  // Таких строк в боевом документе 28 — то есть заблокирована была бы ЛЮБАЯ запись.
  //
  // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
  //   DH. вернуть сравнение по `isUnmeasured`      → «СТЕНА РЫЧАГА НЕ ПРОТИВОРЕЧИТ ЗАМЕРУ»
  //   DI. пустить в сравнение эхо храповика        → «ЭХО ХРАПОВИКА НЕ ПРОТИВОРЕЧИТ ЗАМЕРУ»
  //   DJ. выключить сторож вовсе                   → «ДВА НАСТОЯЩИХ ЗАМЕРА ПРОТИВОРЕЧАТ ПО-ПРЕЖНЕМУ»
  console.log('\n— ЧТО ВООБЩЕ МОЖЕТ ПРОТИВОРЕЧИТЬ ЗАМЕРУ —');
  {
    // Индекс 4 — 2400 МГц (выше), индекс 5 — 2000 МГц (ниже). Инверсия: НИЖНЯЯ просит БОЛЬШЕ.
    const withLower = (tags, mv, provenBy = 'прожиг') => {
      const d = healthyDoc();
      d.frequencies[4].tags = [CURVE_TAGS.STOP_EDGE_FOUND];   // 2400 МГц — честный замер
      d.frequencies[4].provenBy = 'прожиг sdc_fma/transient';
      d.frequencies[4].voltageMv = 800;
      d.frequencies[5].tags = tags; d.frequencies[5].provenBy = provenBy; d.frequencies[5].voltageMv = mv;
      return validateCurveDoc(d, { card, frequencyGrid: FAKE_LADDER })
        .filter((b) => b.field.endsWith('.voltageMv') && /не может хватать меньшего/.test(b.why));
    };
    // ⚠️ `ok` В ЭТОМ НАБОРЕ ДВУАРГУМЕНТНЫЙ — `(имя, условие)`. Первая редакция этих двух строк
    // передала `(имя, длина, 0)` по сигнатуре соседних наборов, и обе покраснели: длина 0 — ложь.
    // Файл предупреждает об этой ловушке своим же комментарием ниже; я в неё всё равно попал.
    ok('СТЕНА РЫЧАГА НЕ ПРОТИВОРЕЧИТ ЗАМЕРУ: «ниже не смогли попросить» это не «карте нужно столько»',
      withLower([CURVE_TAGS.STOP_LEVER_LIMIT], 850).length === 0);
    ok('ЭХО ХРАПОВИКА НЕ ПРОТИВОРЕЧИТ ЗАМЕРУ: число поднятой строки принадлежит не ей',
      withLower([CURVE_TAGS.STOP_EDGE_FOUND, CURVE_TAGS.ORIGIN_RATCHETED], 850).length === 0);
    // И ГЛАВНОЕ — СТОРОЖ НЕ ВЫКЛЮЧЕН. Без этого блока правка была бы неотличима от «снять сторож».
    ok('ДВА НАСТОЯЩИХ ЗАМЕРА ПРОТИВОРЕЧАТ ПО-ПРЕЖНЕМУ, и отказ называет ОБЕ частоты',
      (() => {
        const bad = withLower([CURVE_TAGS.STOP_EDGE_FOUND, CURVE_TAGS.ORIGIN_MEASURED], 850);
        return bad.length === 1 && /2400/.test(bad[0].why) && /2000/.test(bad[0].why);
      })(), true);
  }

  // ХРАПОВИК ДЛЯ САМОЙ ЗАКРЫВАЕМОЙ СТРОКИ — зеркальная половина R17, и её принёс живой прогон
  // 2026-08-16: закрывалась 3045 МГц на 1020 мВ, а уже измеренная БОЛЕЕ НИЗКАЯ 3037 требовала 1025.
  // Поднимать надо было ЭТУ строку, а поднимать её было некому — документ отвергался целиком, и
  // прогон вставал на ЧЕСТНОМ замере, закрыв 2 частоты из 10.
  // АДРЕСАТЫ: BA. убрать подъём закрываемой строки → «ЗАКРЫВАЕМАЯ СТРОКА ПОДНИМАЕТСЯ ХРАПОВИКОМ» ·
  //           BB. поднять её молча → «и подъём НАЗВАН в свидетеле».
  console.log('\n— ХРАПОВИК ДЛЯ ЗАКРЫВАЕМОЙ СТРОКИ —');
  {
    const prep = () => {
      const d = healthyDoc();
      // 2000 МГц (индекс 5) измерена ДОРОЖЕ, чем мы сейчас закроем более высокую 2400 (индекс 4)
      d.frequencies[5].tags = [CURVE_TAGS.STOP_EDGE_FOUND];
      d.frequencies[5].provenBy = 'прожиг sdc_fma/transient';
      d.frequencies[5].voltageMv = 850;
      return d;
    };
    // Индекс 4 — 2400 МГц (сток 1000), индекс 5 — 2000 МГц: более НИЗКАЯ частота.
    // Оба напряжения берутся С СЕТКИ фикстуры (800 · 850 · 900 …) — иначе запись отвергнется раньше
    // храповика, и блок покраснеет по чужой причине.
    const r = closePoint(prep(), {
      mhz: 2400, voltageMv: 800, status: CURVE_STATUS.EDGE_FOUND,
      provenBy: 'прожиг sdc_fma/transient', at: '2026-08-16T15:30:00+03:00',
    });
    ok('ЗАКРЫВАЕМАЯ СТРОКА ПОДНИМАЕТСЯ ХРАПОВИКОМ до того, что требует более НИЗКАЯ частота',
      r.ok === true && r.doc.frequencies[4].voltageMv === 850, JSON.stringify({ ok: r.ok, why: r.why }));
    ok('и подъём НАЗВАН в свидетеле — молча документ не правится',
      r.ok === true && /ПОДНЯТО ХРАПОВИКОМ с 800 до 850/.test(r.doc.frequencies[4].provenBy ?? ''));
    ok('после подъёма документ проходит СВОЙ ЖЕ сторож противоречия — прогон не встаёт',
      r.ok === true && validateCurveDoc(r.doc, { card, frequencyGrid: FAKE_LADDER }).length === 0);
    // И граница: выше СОБСТВЕННОГО стока не поднимаем даже ради согласованности — это уже не
    // примирение двух замеров, а противоречие со стоковой таблицей, и оно называется вслух.
    const tooHigh = (() => {
      const d = prep();
      d.frequencies[5].voltageMv = 1050;   // с сетки, и ВЫШЕ стока 2400 МГц (1000)
      return closePoint(d, {
        mhz: 2400, voltageMv: 800, status: CURVE_STATUS.EDGE_FOUND,
        provenBy: 'прожиг', at: '2026-08-16T15:30:00+03:00',
      });
    })();
    ok('но ВЫШЕ СВОЕГО СТОКА храповик не поднимает — отказ с названной причиной',
      tooHigh.ok === false && /сток/.test(tooHigh.why ?? ''));
  }

  // ─── МЕНЕЕ ГЛУБОКОЕ НЕ ОТМЕНЯЕТ БОЛЕЕ ГЛУБОКОЕ, ЕСЛИ ОТКАЗА НИКТО НЕ ВИДЕЛ (`bugs/55`) ─────────
  //
  // 🔴 ПРИНЕСЕНО ЖИВЫМ ПРОГОНОМ 2026-08-25, И ЦЕНА ИЗМЕРЕНА: 22 строки с ПРОЙДЕННЫМИ прожигами
  // (800–845 мВ) подняты до 850 мВ одной записью `cut-short`. Фикстура воспроизводит его форму:
  // строка уже стоит глубже, а спуск предлагает мельче и БЕЗ наблюдённого отказа.
  //
  // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
  //   BC. снять сторож (писать всегда)                 → «ДОКУМЕНТ ЗНАЛ ГЛУБЖЕ — ЗАПИСЬ ОТКЛОНЕНА»
  //   BD. распространить сторож на `edge-found`        → «НАБЛЮДЁННЫЙ ОТКАЗ ПИШЕТ ВСЕГДА»
  console.log('\n— ДОКУМЕНТ ЗНАЛ ГЛУБЖЕ (bugs/55) —');
  {
    // 2400 МГц (индекс 4, сток 1000) уже несёт ПРОЙДЕННЫЙ прожиг на 800 мВ — предел рычага, не край.
    const deeperDoc = () => {
      const d = healthyDoc();
      d.frequencies[4].tags = [CURVE_TAGS.STOP_LEVER_LIMIT, CURVE_TAGS.ORIGIN_MEASURED];
      d.frequencies[4].provenBy = '800 мВ прошло на 2400 МГц, а глубже спускать нечем';
      d.frequencies[4].voltageMv = 800;
      return d;
    };
    const shallow = closePoint(deeperDoc(), {
      mhz: 2400, voltageMv: 900, status: CURVE_STATUS.CUT_SHORT,
      provenBy: 'прожиг: спуск прерван', at: '2026-08-25T01:00:00+03:00',
    });
    ok('ДОКУМЕНТ ЗНАЛ ГЛУБЖЕ — ЗАПИСЬ ОТКЛОНЕНА: 800 мВ остаются, 900 не пишутся',
      shallow.ok === true && shallow.closed === 0
        && shallow.doc.frequencies[4].voltageMv === 800
        && shallow.kept?.keptMv === 800 && shallow.kept?.offeredMv === 900,
      JSON.stringify({ ok: shallow.ok, closed: shallow.closed, mv: shallow.doc.frequencies[4].voltageMv, kept: shallow.kept }));
    // ⚠️ И ЭТО НЕ АВАРИЯ: полоса обязана идти дальше, иначе сторож против потери данных стал бы
    // сторожем против прогонов — ровно то, что владелец отменил словом «здание важнее лесов».
    ok('...и это НЕ авария: ok=true, причина названа, полоса продолжается',
      shallow.ok === true && /ОСТАВЛЕНА НА 800 мВ/.test(shallow.why ?? '') && /не встретил отказ/.test(shallow.why ?? ''));
    // НАБЛЮДЁННЫЙ ОТКАЗ ПИШЕТ ВСЕГДА. Без этого блока сторож выше зеленел бы и на коде, который
    // не пишет НИЧЕГО, — а `edge-found` обязан отменять унаследованный проход: отказ на ЭТОЙ
    // частоте сильнее прохода, доказанного на другой.
    const edge = closePoint(deeperDoc(), {
      mhz: 2400, voltageMv: 900, status: CURVE_STATUS.EDGE_FOUND,
      provenBy: 'прожиг: отказ на 895 мВ, запас вверх', at: '2026-08-25T01:00:00+03:00',
    });
    ok('НАБЛЮДЁННЫЙ ОТКАЗ ПИШЕТ ВСЕГДА: edge-found отменяет унаследованный проход',
      edge.ok === true && edge.closed >= 1 && edge.doc.frequencies[4].voltageMv === 900 && !edge.kept,
      JSON.stringify({ ok: edge.ok, closed: edge.closed, mv: edge.doc.frequencies[4].voltageMv }));
    // И ГЛУБЖЕ — пишет любой статус: сторож судит НАПРАВЛЕНИЕ, а не статус сам по себе.
    // Строка стоит на 900, прогон предлагает 850 — оба с сетки фикстуры (800 · 850 · 900 …).
    const deeper = closePoint((() => { const d = deeperDoc(); d.frequencies[4].voltageMv = 900; return d; })(), {
      mhz: 2400, voltageMv: 850, status: CURVE_STATUS.CUT_SHORT,
      provenBy: 'прожиг: спуск прерван, но глубже', at: '2026-08-25T01:00:00+03:00',
    });
    ok('...а ГЛУБЖЕ пишет любой статус — сторож судит НАПРАВЛЕНИЕ, а не имя статуса',
      deeper.ok === true && deeper.doc.frequencies[4].voltageMv === 850 && !deeper.kept,
      JSON.stringify({ ok: deeper.ok, mv: deeper.doc.frequencies[4].voltageMv, why: deeper.why }));
    // И НА СТОКОВУЮ СТРОКУ сторож не действует: там нечего защищать, любой замер её углубляет.
    const onStock = closePoint(healthyDoc(), {
      mhz: 2400, voltageMv: 900, status: CURVE_STATUS.CUT_SHORT,
      provenBy: 'прожиг: спуск прерван', at: '2026-08-25T01:00:00+03:00',
    });
    ok('...и стоковую строку он не защищает: там нечего терять, замер её углубляет',
      onStock.ok === true && onStock.doc.frequencies[4].voltageMv === 900 && !onStock.kept,
      JSON.stringify({ ok: onStock.ok, mv: onStock.doc.frequencies[4].voltageMv }));
  }

  // ─── ПРЕРВАННОЕ ЗАКРЫТИЕ НЕ КОРМИТ ХРАПОВИК ВВЕРХ (`bugs/57`) ──────────────────────────────────
  //
  // 🔴 БЛИЗНЕЦ БЛОКОВ ВЫШЕ, И ЖИВОЙ ПРОГОН 2026-08-25 09:47 СНЯЛ ТЕ ЖЕ 22 СТРОКИ ВТОРОЙ РАЗ ЗА
  // ДВОЕ СУТОК. Сторож `bugs/55` цел и сработал правильно: он защищает строку, которая УЖЕ стоит
  // глубже. Здесь закрываемая строка была ЗАВОДСКОЙ — защищать нечего, запись законна, — а урон
  // нанёс следующий шаг: храповик разнёс `cut-short` вверх по 22 частотам с пройденными прожигами.
  //
  // Фикстура воспроизводит ровно ту форму, и она НЕ повторяет фикстуру выше: там строка стояла
  // глубже, здесь она стоковая. Одно направление — один блок; общая фикстура скрыла бы, что это
  // разные пути (EXP-0144: у храповика ТРИ направления, а сторож стоял на одном).
  //
  // АДРЕСАТЫ МУТАЦИЙ, НАЗВАННЫЕ ДО ПРОГОНА:
  //   BE. снять условие (храповик вверх работает всегда) → «ПРЕРВАННОЕ ЗАКРЫТИЕ НЕ КОРМИТ ХРАПОВИК»
  //   BF. распространить условие на `edge-found`         → «НАБЛЮДЁННЫЙ ОТКАЗ ПОДНИМАЕТ КАК ПОДНИМАЛ»
  console.log('\n— ПРЕРВАННОЕ ЗАКРЫТИЕ НЕ КОРМИТ ХРАПОВИК ВВЕРХ (bugs/57) —');
  {
    // 2800 МГц (индекс 3, сток 1050) несёт ПРОЙДЕННЫЙ прожиг на 800 мВ — предел рычага, не край.
    // 2400 МГц (индекс 4, сток 1000) ЗАВОДСКАЯ: её и закрываем, как 2302 в живом прогоне.
    const higherIsDeeper = () => {
      const d = healthyDoc();
      d.frequencies[3].tags = [CURVE_TAGS.STOP_LEVER_LIMIT, CURVE_TAGS.ORIGIN_MEASURED];
      d.frequencies[3].provenBy = '800 мВ прошло на 2800 МГц — предел рычага, отказа никто не видел';
      d.frequencies[3].voltageMv = 800;
      return d;
    };
    const cut = closePoint(higherIsDeeper(), {
      mhz: 2400, voltageMv: 850, status: CURVE_STATUS.CUT_SHORT,
      provenBy: 'прожиг выдержан на 850, спуск ниже прерван пробитым потолком',
      at: '2026-08-25T10:00:00+03:00',
    });
    ok('ПРЕРВАННОЕ ЗАКРЫТИЕ НЕ КОРМИТ ХРАПОВИК: 2800 МГц остаётся на измеренных 800 мВ',
      cut.ok === true && cut.closed >= 1 && cut.raised.length === 0
        && cut.doc.frequencies[3].voltageMv === 800,
      JSON.stringify({ ok: cut.ok, closed: cut.closed, raised: cut.raised, mv3: cut.doc.frequencies[3].voltageMv }));
    // ⚠️ И СВОЮ строку закрытие всё равно пишет: сторож снимает РАСПРОСТРАНЕНИЕ, а не запись.
    // Без этого блока мутация «не писать вовсе» зеленела бы вместе с правильной.
    ok('...но СВОЮ строку оно пишет: сторож снимает распространение, а не сам замер',
      cut.doc.frequencies[4].voltageMv === 850
        && (cut.doc.frequencies[3].tags ?? []).includes(CURVE_TAGS.ORIGIN_RATCHETED) === false,
      JSON.stringify({ mv4: cut.doc.frequencies[4].voltageMv, tags3: cut.doc.frequencies[3].tags }));
    // НАБЛЮДЁННЫЙ ОТКАЗ ПОДНИМАЕТ КАК ПОДНИМАЛ. Без этого блока сторож зеленел бы и на коде,
    // который отключил храповик ВВЕРХ насовсем, — а это уже потеря безопасного направления.
    const edgeUp = closePoint(higherIsDeeper(), {
      mhz: 2400, voltageMv: 850, status: CURVE_STATUS.EDGE_FOUND,
      provenBy: 'прожиг: отказ ниже 850, запас вверх', at: '2026-08-25T10:00:00+03:00',
    });
    ok('НАБЛЮДЁННЫЙ ОТКАЗ ПОДНИМАЕТ КАК ПОДНИМАЛ: 2800 МГц идёт с 800 на 850 и помечена храповиком',
      edgeUp.ok === true && edgeUp.raised.length === 1 && edgeUp.raised[0].mhz === 2800
        && edgeUp.doc.frequencies[3].voltageMv === 850
        && (edgeUp.doc.frequencies[3].tags ?? []).includes(CURVE_TAGS.ORIGIN_RATCHETED),
      JSON.stringify({ raised: edgeUp.raised, mv3: edgeUp.doc.frequencies[3].voltageMv }));
    // ПРЕЖНЕЕ ЗНАЧЕНИЕ ЖИВЁТ В САМОЙ ПОДНЯТОЙ СТРОКЕ — хвост `bugs/57`: семь строк раннего
    // прогона восстановить было нечем, потому что «с чего подняли» жило только в сводке возврата.
    // Мутация-адресат: убрать «с ${r.voltageMv}» из улики подъёма → этот блок.
    ok('...и поднятая строка несёт ПРЕЖНЕЕ значение в своей улике («с 800 до 850») — урон обратим без снимков',
      /ПОДНЯТО ХРАПОВИКОМ с 800 до 850 мВ измерением на 2400/.test(edgeUp.doc.frequencies[3].provenBy ?? ''),
      JSON.stringify({ provenBy3: edgeUp.doc.frequencies[3].provenBy }));
    // И СВОДКА ОБЯЗАНА НАЗЫВАТЬ ПОДЪЁМ, когда он был: по этой строке владелец видит, что документ
    // тронули не только там, где заказывали.
    ok('...и сводка называет подъём числом — по ней подъём видно без разбора документа',
      /ХРАПОВИК ПОДНЯЛ 1 частот/.test(edgeUp.why ?? '') && !/ХРАПОВИК ПОДНЯЛ/.test(cut.why ?? ''),
      JSON.stringify({ edgeWhy: edgeUp.why, cutWhy: cut.why }));

    // ─── ВОРОТА ВЛАДЕЛЬЦА (`bugs/63`, interviews/018 = A): ПРОМАХ НЕ КОРМИТ ХРАПОВИК ────────────
    //
    // Фикстура — ТОТ ЖЕ `edgeUp`, но замер помечен `origin:overshot`. Пара выбрана так, что
    // сломанный и правильный код дают РАЗНЫЙ ответ (EXP-0176): без ворот подъём происходит и
    // `raised.length === 1`, с воротами — 0, а строка 2800 МГц остаётся на своих 800.
    // АДРЕСАТЫ МУТАЦИЙ: EE — снять условие `closeIsOvershot` (подъём вернётся) ·
    // EF — удерживать МОЛЧА (обнулить `ratchetWithheld`) · EG — удерживать и САМУ строку не писать.
    const overshot = closePoint(higherIsDeeper(), {
      mhz: 2400, voltageMv: 850, status: CURVE_STATUS.EDGE_FOUND,
      extraTags: [CURVE_TAGS.ORIGIN_OVERSHOT],
      provenBy: 'прожиг: карта подставила своё напряжение вместо заказанного', at: '2026-08-30T12:00:00+03:00',
    });
    ok('ПРОМАХНУВШИЙСЯ ЗАМЕР НЕ ПОДНИМАЕТ ЧУЖИЕ СТРОКИ: 2800 МГц остаётся на измеренных 800 мВ',
      overshot.ok === true && overshot.raised.length === 0
        && overshot.doc.frequencies[3].voltageMv === 800
        && (overshot.doc.frequencies[3].tags ?? []).includes(CURVE_TAGS.ORIGIN_RATCHETED) === false,
      JSON.stringify({ ok: overshot.ok, raised: overshot.raised, mv3: overshot.doc.frequencies[3].voltageMv }));
    // ⚠️ ПОЛОВИНА ОТВЕТА, БЕЗ КОТОРОЙ ВОРОТА СТАЛИ БЫ ВАРИАНТОМ C: СВОЯ строка пишется как писалась.
    // Мутация EG (не писать вовсе) зеленела бы вместе с правильной, если бы этого блока не было.
    ok('...но СВОЮ строку он пишет как писал — канон «тюним то, что карта выдаёт» цел',
      overshot.doc.frequencies[4].voltageMv === 850
        && (overshot.doc.frequencies[4].tags ?? []).includes(CURVE_TAGS.ORIGIN_OVERSHOT)
        && (overshot.doc.frequencies[4].tags ?? []).includes(CURVE_TAGS.ORIGIN_MEASURED),
      JSON.stringify({ mv4: overshot.doc.frequencies[4].voltageMv, tags4: overshot.doc.frequencies[4].tags }));
    // УДЕРЖАНИЕ НАЗВАНО ПОЛЕМ И СЧЁТНО. Тихий пропуск — это вариант C, которого владелец не выбрал:
    // документ остался бы в противоречии, о котором никто не знает.
    ok('...и удержание НАЗВАНО полем: кого не подняли, с чего и до чего — счётно, а не прозой',
      overshot.ratchetWithheld !== null
        && overshot.ratchetWithheld.reason === CURVE_TAGS.ORIGIN_OVERSHOT
        && overshot.ratchetWithheld.rows.length === 1
        && overshot.ratchetWithheld.rows[0].mhz === 2800
        && overshot.ratchetWithheld.rows[0].fromMv === 800
        && overshot.ratchetWithheld.rows[0].wouldBeMv === 850,
      JSON.stringify({ withheld: overshot.ratchetWithheld }));
    ok('...и сводка говорит об удержании вслух, со ссылкой на решение владельца',
      /ХРАПОВИК УДЕРЖАН/.test(overshot.why ?? '') && /interviews\/018/.test(overshot.why ?? '')
        && !/ХРАПОВИК ПОДНЯЛ/.test(overshot.why ?? ''),
      JSON.stringify({ why: overshot.why }));
    // И ОБРАТНАЯ СТОРОНА, БЕЗ КОТОРОЙ СТОРОЖ БЫЛ БЫ СТЕНОЙ: чистый замер поле НЕ заводит.
    // Сторож, который «удерживает» всегда, отключил бы храповик насовсем — потеря безопасного
    // направления, тот же класс, что R12 · R13 · R17.
    ok('ЧИСТЫЙ ЗАМЕР ВОРОТ НЕ ЗАМЕЧАЕТ: поля удержания нет, подъём прошёл',
      edgeUp.ratchetWithheld === null && edgeUp.raised.length === 1,
      JSON.stringify({ withheld: edgeUp.ratchetWithheld, raised: edgeUp.raised }));
  }

  console.log('\n— ОБЛАКО ТЕГОВ: словарь, классы, накопление (эпик 04 фаза 1) —');
  // P1-AC3 — СЛОВАРЬ ЗАКРЫТ. То же свойство, что было у статуса, и терять его было нельзя: закрытость
  // и есть причина, по которой читатель документу верит (`researches/13` §2.3).
  // ⚠️ `ok` ЗДЕСЬ ДВУАРГУМЕНТНЫЙ — `(name, cond, detail)`, а не `(name, got, want)`, как у соседних
  // наборов. Первая редакция этих блоков была написана по чужой сигнатуре, и часть из них зеленела
  // ПО НЕВЕРНОЙ ПРИЧИНЕ: `.length` со значением 1 истинно, пустой массив истинен. Покраснел ровно
  // один — тот, где ожидался НОЛЬ, — и он вскрыл остальные. Урок общий: утверждение, сравнивающее
  // «получено» с «ждали», обязано делать сравнение САМО, иначе оно проверяет истинность.
  const eq = (got, want) => JSON.stringify(got) === JSON.stringify(want);
  ok('НЕИЗВЕСТНЫЙ ТЕГ ОТВЕРГАЕТСЯ, и отказ НАЗЫВАЕТ его',
    (() => {
      const why = tagSetRefusals([CURVE_TAGS.STOP_EDGE_FOUND, 'выдуманный:тег']).join(' ');
      return why.includes('выдуманный:тег') && why.includes('ЗАКРЫТ');
    })());
  // P1-AC4 — ВЗАИМОИСКЛЮЧАЮЩИЙ КЛАСС. Единственная претензия отрасли к модели тегов, и класс её снимает.
  ok('ДВА ТЕГА ОДНОГО ВЗАИМОИСКЛЮЧАЮЩЕГО КЛАССА — ОТКАЗ: это два ответа на один вопрос',
    eq(tagSetRefusals([CURVE_TAGS.STOP_EDGE_FOUND, CURVE_TAGS.STOP_LEVER_LIMIT]).length, 1));
  ok('а два тега НАКОПИТЕЛЬНОГО класса — норма, ради этого облако и заводилось',
    eq(tagSetRefusals([CURVE_TAGS.BURN_SHORT, CURVE_TAGS.BURN_LONG]), []));
  ok('пустой набор тегов — тоже отказ: строка без тегов ничего о себе не говорит',
    eq(tagSetRefusals([]).length, 1));
  // P1-AC5 — НАКОПЛЕНИЕ. Ровно то, чего одно поле не умело: `long-burn-proved` СТИРАЛ `edge-found`.
  ok('СТРОКА ГОВОРИТ И «КРАЙ НАЙДЕН», И «ВЫДЕРЖАЛА МИНУТУ» ОДНОВРЕМЕННО — старое поле стирало одно другим',
    (() => {
      const tags = [CURVE_TAGS.STOP_EDGE_FOUND, CURVE_TAGS.BURN_LONG, CURVE_TAGS.ORIGIN_MEASURED];
      return eq([tagSetRefusals(tags), statusFromTags(tags)], [[], CURVE_STATUS.EDGE_FOUND]);
    })());
  // ⚠️ КАРТА СТАРОГО ПОЛЯ ПОЛНА И ОБРАТИМА. Блок идёт по САМОМУ словарю, поэтому значение, добавленное
  // в `CURVE_STATUS` без пары в `TAG_OF_STATUS`, покраснит его — молча разойтись стороны не могут.
  ok('КАЖДЫЙ старый статус имеет тег, и обратное преобразование возвращает ЕГО ЖЕ (P1-AC1 в малом)',
    eq(Object.values(CURVE_STATUS).filter((s) => {
      const t = tagsForStatus(s);
      return t === null || statusFromTags(t) !== s;
    }), []));
  // ⚠️ ВЫВЕДЕННЫЙ ВИД НЕ ПОПАДАЕТ В ФАЙЛ. Ровно это отличает вывод от ВТОРОГО ХРАНИМОГО ПОЛЯ, то есть
  // от пары «правда↔зеркало», которую канон велит не заводить.
  ok('ВЫВЕДЕННЫЙ status ЧИТАЕТСЯ, но в JSON НЕ ПОПАДАЕТ — второго хранимого факта не появилось',
    (() => {
      const d = attachDerivedStatus({ frequencies: [{ mhz: 2842, tags: [CURVE_TAGS.STOP_EDGE_FOUND] }] });
      return eq([d.frequencies[0].status, JSON.stringify(d).includes('status')],
        [CURVE_STATUS.EDGE_FOUND, false]);
    })());
  // ⚠️ И СПРЕД ТЕРЯЕТ ЭТОТ ВИД — то, на чём миграция споткнулась живьём: `{...r}` копирует только
  // ПЕРЕЧИСЛЯЕМЫЕ свойства, поэтому внутри `closePoint` проверки по `r.status` молча читали undefined.
  ok('СПРЕД СТРОКИ ТЕРЯЕТ ВЫВЕДЕННЫЙ status — поэтому автор формата читает ТЕГИ, а не вид',
    (() => {
      const d = attachDerivedStatus({ frequencies: [{ mhz: 2842, tags: [CURVE_TAGS.STOP_UNTOUCHED] }] });
      const copy = { ...d.frequencies[0] };
      return eq([copy.status, isUnmeasured(copy)], [undefined, true]);
    })());
  // P1-AC6 — ПОДМНОЖЕСТВО СЛОВАРЯ БОЛЬШЕ НИГДЕ НЕ ПЕРЕПИСАНО РУКАМИ. `engine.seedFor` спрашивает эту
  // функцию, а не свой список; блок краснеет, если «доказанность» перестанет включать край или прожиг.
  ok('«ДОКАЗАНО ПРОЖИГОМ» СПРАШИВАЕТСЯ У ОДНОЙ ФУНКЦИИ — и предел рычага доказанностью НЕ является',
    eq([CURVE_TAGS.STOP_EDGE_FOUND, CURVE_TAGS.BURN_SHORT, CURVE_TAGS.BURN_LONG,
      CURVE_TAGS.STOP_LEVER_LIMIT, CURVE_TAGS.STOP_UNTOUCHED].map((t) => claimsBurnProof({ tags: [t] })),
    [true, true, true, false, false]));

  // ═══ ЭПИК 33, ФАЗА 1 — ШЕСТОЕ ЗНАЧЕНИЕ КЛАССА `stop` (`interviews/013` Q1 = A) ═══════════════════
  // Блоки F1-AC3 · F1-AC4 · F1-AC5 и сторож ПОРЯДКА. Мутации M1–M4 в `plans/34`.
  console.log('\n— stop:not-served, шестое значение (эпик 33 фаза 1) —');
  // F1-AC3. Словарь ОСТАЛСЯ закрытым: шестое значение принято, седьмое выдуманное — отвергнуто, и
  // отказ перечисляет словарь. Без второй половины блок зеленел бы и на распахнутом словаре.
  ok('ШЕСТОЕ ЗНАЧЕНИЕ ПРИНЯТО, а выдуманное седьмое — отвергнуто с перечислением словаря (F1-AC3)',
    (() => {
      const okSix = tagSetRefusals([CURVE_TAGS.STOP_NOT_SERVED, CURVE_TAGS.ORIGIN_MEASURED]);
      const why = tagSetRefusals([CURVE_TAGS.STOP_NOT_SERVED, 'stop:выдумка']).join(' ');
      return eq([okSix, why.includes('stop:выдумка'), why.includes(CURVE_TAGS.STOP_NOT_SERVED)],
        [[], true, true]);
    })());
  // Класс `stop` ИСКЛЮЧИТЕЛЬНЫЙ, и шестое значение обязано этому подчиняться: «карта не обслужила» и
  // «предел рычага» — два ответа на один вопрос, и на одной строке им не место.
  ok('«не обслужено» и «предел рычага» на одной строке — ОТКАЗ: класс stop исключительный',
    eq(tagSetRefusals([CURVE_TAGS.STOP_NOT_SERVED, CURVE_TAGS.STOP_LEVER_LIMIT]).length, 1));
  // ⚠️ СТОРОЖ ПОРЯДКА в `statusFromTags` — риск яруса (a) из `plans/34`. Строка, выдержавшая прожиг и
  // ЗАТЕМ закрытая отказом карты обслужить заказ, обязана читаться как ЗАКРЫТАЯ, а не как «доказана
  // прожигом»: `stop:*` отвечает о судьбе, `burn:*` — о глубине. Прожиг при этом НЕ теряется, он
  // остаётся своим тегом на той же строке — ровно ради этого облако и заводилось.
  ok('ПОРЯДОК: stop:not-served выигрывает у burn:*, но прожиг со строки НЕ пропадает',
    (() => {
      const tags = [CURVE_TAGS.BURN_LONG, CURVE_TAGS.STOP_NOT_SERVED, CURVE_TAGS.ORIGIN_MEASURED];
      return eq([tagSetRefusals(tags), statusFromTags(tags), tags.includes(CURVE_TAGS.BURN_LONG)],
        [[], CURVE_STATUS.NOT_SERVED, true]);
    })());
  // F1-AC5. «Карта не обслужила заказ» — НЕ доказательство прожига: отказа никто не видел.
  ok('«НЕ ОБСЛУЖЕНО» ДОКАЗАТЕЛЬСТВОМ ПРОЖИГА НЕ ЯВЛЯЕТСЯ — отказа никто не наблюдал (F1-AC5)',
    eq(claimsBurnProof({ tags: [CURVE_TAGS.STOP_NOT_SERVED] }), false));
  // F1-AC4. СЧЁТЧИК ПОКРЫТИЯ. Спуск на такой частоте ОКОНЧЕН и напряжение доказано — не учесть её
  // значит занизить покрытие молча и заставить читателя винить карту за дыру, которую сделала
  // бухгалтерия. Считаем ДЕЛЬТУ на одном и том же документе, а не абсолют: абсолют зеленел бы от
  // любой другой закрытой строки в фикстуре.
  ok('ЗАКРЫТАЯ ПО «НЕ ОБСЛУЖЕНО» СТРОКА СЧИТАЕТСЯ ЗАКРЫТОЙ В ПОКРЫТИИ (F1-AC4)',
    (() => {
      const before = summarize(healthyDoc()).closed;
      const d = healthyDoc();
      d.frequencies[4].tags = [CURVE_TAGS.STOP_NOT_SERVED, CURVE_TAGS.ORIGIN_MEASURED];
      d.frequencies[4].provenBy = '885 мВ прошло, а заказ 870 карта не обслужила';
      return eq(summarize(attachDerivedStatus(d)).closed - before, 1);
    })());

  console.log('\n— СВИДЕТЕЛЬ ПРОЖИГА —');
  ok('статус «доказано прожигом» без свидетеля отвергается', (() => {
    const d = healthyDoc(); d.frequencies[4].tags = [CURVE_TAGS.BURN_SHORT];
    return fieldsOf(d).includes('frequencies[4].provenBy');
  })());
  ok('тот же статус со свидетелем принимается', (() => {
    const d = healthyDoc(); d.frequencies[4].tags = [CURVE_TAGS.STOP_EDGE_FOUND];
    d.frequencies[4].provenBy = 'sdc_fma/transient 10 с → SDC на 5 мВ ниже';
    return fieldsOf(d).length === 0;
  })());

  console.log('\n— ПЕРЕВОД В СМЕЩЕНИЯ: считается от ЖИВОЙ таблицы, не хранится —');
  const table = (shiftMhz = 0) => [
    { mv: 800, mhz: 500 + shiftMhz, freqKhz: 1 },
    { mv: 900, mhz: 1500 + shiftMhz, freqKhz: 1 },
    { mv: 1000, mhz: 2400 + shiftMhz, freqKhz: 1 },
    { mv: 1100, mhz: 3000 + shiftMhz, freqKhz: 1 },
  ];
  // The document is SEEDED FROM the same fake table, so «untouched» genuinely means «what the card
  // already does». Hand-writing both sides independently is how the first draft of these blocks
  // measured its own fixture's disagreement instead of the function.
  const seeded = (shift = 0) => initFromCard({
    frequencyGrid: { values: [3000, 2400, 1500, 500] },
    tablePoints: table(shift),
    card: { maxGraphicsMhz: 3090 },
    stamp: { driver: 'd', vbios: 'v', takenAt: '2026-08-15T16:20:00+03:00' },
  });
  ok('нетронутый документ даёт нулевые смещения', (() => {
    const { offsets } = offsetsFor(seeded(), table(), { count: 4 });
    return offsets.every((o) => o === 0);
  })());
  ok('снижение напряжения частоты поднимает НУЖНУЮ запись таблицы', (() => {
    const d = seeded();
    d.frequencies[0].voltageMv = 1000;                       // 3000 МГц теперь просит 1000, а не 1100
    const { offsets, served } = offsetsFor(d, table(), { count: 4 });
    // Проверяется ВЕСЬ раскрой, а не одна запись. Первая редакция этого блока смотрела только на
    // запись 1000 мВ — и оставалась зелёной, когда выбор строки ломали целиком (мутация «берёт НЕ ту
    // запись» отдавала всем записям высшую частоту). Блок, зелёный по соседней причине, EXP-0016.
    return served[0] === 500 && served[1] === 1500        // низкие напряжения обслуживают СВОИ частоты
      && served[2] === 3000 && offsets[2] === 3000 - 2400 // 1000 мВ забрала 3000 МГц у 1100
      && offsets[3] === 0 && offsets[0] === 0 && offsets[1] === 0;
  })());
  ok('ТА ЖЕ таблица при другой температуре даёт ДРУГИЕ смещения и ТОТ ЖЕ результат', (() => {
    const d = seeded();
    d.frequencies[0].voltageMv = 1000;
    const cold = offsetsFor(d, table(0), { count: 4 });
    const warm = offsetsFor(d, table(-15), { count: 4 });
    return cold.offsets[2] !== warm.offsets[2] && cold.served[2] === warm.served[2];
  })());
  ok('смещение никогда не отрицательное — придавливание это потолок режима, а не замер', (() => {
    const { offsets } = offsetsFor(seeded(), table(500), { count: 4 });
    return offsets.every((o) => o >= 0);
  })());
  ok('упор в аппаратный предел ±1000 МГц СЧИТАЕТСЯ и называется', (() => {
    const d = seeded();
    for (const r of d.frequencies) r.voltageMv = 800;         // всё на самой нижней ступени
    const { clamped } = offsetsFor(d, table(), { count: 4 });
    return clamped > 0;
  })());

  console.log('\n— СВЕРКА С КАРТОЙ: сверяется то, что НЕ ездит —');
  const tp = GRID_MV.map((mv, i) => ({ mv, mhz: 500 + i * 300, freqKhz: 1 }));
  ok('совпадающая сетка проходит', verifyAgainstCard(healthyDoc(), tp).ok);
  ok('СДВИНУТАЯ СТУПЕНЬ НАПРЯЖЕНИЯ ловится', (() => {
    const t = tp.map((p, i) => (i === 3 ? { ...p, mv: p.mv + 5 } : p));
    const r = verifyAgainstCard(healthyDoc(), t);
    return !r.ok && r.problems[0].field.startsWith('voltageGridMv');
  })());
  ok('ПРОГРЕВ (частоты таблицы уехали, напряжения те же) расхождением НЕ считается', (() => {
    const t = tp.map((p) => ({ ...p, mhz: p.mhz - 15 }));
    return verifyAgainstCard(healthyDoc(), t).ok;
  })());
  ok('другой драйвер ловится штампом (R6)', (() => {
    const r = verifyAgainstCard(healthyDoc(), tp, { card: { driver: '620.10', vbios: '98.03.58.40.8b' } });
    return !r.ok && r.problems.some((p) => p.field === 'stamp');
  })());

  console.log('\n— АТОМАРНАЯ ЗАПИСЬ: машина умирает посреди сохранения —');
  ok('обрыв ДО переименования не трогает целевой файл', (() => {
    const seen = { wrote: null, removed: false, existing: new Set(['dir']) };
    const fs = {
      existsSync: (p) => seen.existing.has(p),
      mkdirSync: () => {},
      writeFileSync: (p) => { seen.wrote = p; seen.existing.add(p); },
      renameSync: () => { throw new Error('машина умерла между записью и переименованием'); },
      rmSync: (p) => { seen.removed = true; seen.existing.delete(p); },
    };
    let threw = false;
    try { saveCurveDoc(healthyDoc(), { dir: 'dir', fs }); } catch { threw = true; }
    return threw && seen.wrote.endsWith('.tmp') && seen.removed;
  })());
  ok('успешная запись идёт через временный файл и переименование', (() => {
    const order = [];
    const fs = {
      existsSync: () => true, mkdirSync: () => {},
      writeFileSync: (p) => order.push(`write:${path.basename(p)}`),
      renameSync: (a, b) => order.push(`rename:${path.basename(a)}→${path.basename(b)}`),
      rmSync: () => order.push('rm'),
    };
    saveCurveDoc(healthyDoc(), { dir: 'dir', fs });
    return order.length === 2 && order[0].endsWith('.tmp') && order[1].includes('→measured.json');
  })());

  console.log('\n— СЛОВАРИ СЕТОК —');
  const goodFreq = {
    kind: 'frequency-grid', probe: 'nvidia-smi -q -d SUPPORTED_CLOCKS', order: 'descending',
    count: 3, rangeMhz: [180, 3090], maxGraphicsMhz: 3090, values: [3090, 3082, 180],
    stamp: { driver: '610.88', vbios: 'v', takenAt: '2026-08-15T16:20:00+03:00' },
  };
  ok('здоровый словарь частот принимается', validateGrid(goodFreq, { kind: 'frequency' }).length === 0);
  ok('словарь без команды пересъёмки отвергается', validateGrid({ ...goodFreq, probe: '' }).some((b) => b.field === 'probe'));
  ok('count разошёлся с числом значений', validateGrid({ ...goodFreq, count: 4 }).some((b) => b.field === 'count'));
  ok('объявленный порядок не совпал с фактическим', validateGrid({ ...goodFreq, values: [180, 3082, 3090] }).some((b) => b.field === 'values'));
  ok('максимум не совпал с верхом лестницы', validateGrid({ ...goodFreq, maxGraphicsMhz: 3000 }).some((b) => b.field === 'maxGraphicsMhz'));
  ok('словарь без штампа отвергается', validateGrid({ ...goodFreq, stamp: undefined }).some((b) => b.field === 'stamp'));

  console.log('\n— ПЕСОЧНИЦА —');
  ok('самопроверка не выросла в рабочем каталоге curves/', (() => {
    if (!existsSync(CURVES_DIR)) return true;
    return !readdirSync(CURVES_DIR).some((f) => f.endsWith('.tmp'));
  })());

  console.log(`\nИТОГ: ${pass} зелёных, ${fail} красных.`);
  return fail === 0 ? 0 : 1;
}

// =================================================================================================

async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  if (has('--selftest')) return cmdSelftest();
  if (has('--grids')) return cmdGrids();
  if (has('--init')) return cmdInit({ force: has('--force') });
  if (has('--verify')) return cmdVerify();
  if (has('--progress')) return cmdProgress({ json: has('--json') });
  if (has('--show') || argv.length === 0) return cmdShow();
  console.log('Использование: --grids | --init [--force] | --show | --verify | --progress [--json] | --selftest');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
}

export default {
  CURVE_STATUS, CURVES_DIR, initFromCard, validateCurveDoc, saveCurveDoc, loadCurveDoc,
  verifyAgainstCard, summarize, offsetsFor, firstInversion, curvePath, stockVoltageFor, leverFloorFor,
  acceptanceProgress, renderDeliveryLine,
};
