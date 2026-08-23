#!/usr/bin/env node
// event-logger.mjs — the CRASH half of the stability oracle, and (since 2026-08-23) the FIFTH INPUT.
//
// Plan anchor (plans/02_epic01_phase1_harness_and_baseline.md §3.5): "Query four providers over a
// time window: Display (id 4101), Microsoft-Windows-WHEA-Logger (17, 18, 19, 47),
// Microsoft-Windows-Kernel-Power (41), Microsoft-Windows-WER-SystemErrorReporting (1001)."
// Upward: epic §4, phase-1 exit gate — "the fault watcher goes red against a real historical event".
// EXTENDED by plans/29 §4: a FIFTH provider and a SECOND class — see below.
//
// WHY A WHOLE MODULE FOR FOUR QUERIES. R4 of the internal map: a stability verdict needs BOTH the
// checksum comparison and this. A profile that corrupts one float and a profile that reboots the
// machine are different failures, and only one of them leaves a checksum behind to compare.
//
// THE MODULE NOW CARRIES TWO CLASSES, AND MIXING THEM IS THE DEFECT IT GUARDS AGAINST.
// `config.FAULT_PROVIDERS` rows are `means: 'CRASH'` (a fault — it votes, through `verdictFor`) or
// `means: 'SIGNAL'` (an observation — read, carried, printed, and structurally unable to vote).
// The fifth row is `nvlddmkm`, the display driver's OWN error channel, which the four original
// providers were blind to for the project's whole life: this card emits `Display` 4107 and never
// 4101, `WHEA-Logger` is empty over its entire history, and `nvlddmkm` holds 129 events over 34
// days — two of them INSIDE the rung that killed the machine on 2026-08-23, each seconds before the
// sampler pulse noticed (researches/15 §0).
// It is an INPUT and not a verdict because the same research scored it against ALL TWELVE deaths of
// this machine and found it SPECIFIC but NOT SENSITIVE (§2): three deaths carried a driver error
// within 10 minutes, the canonical BSOD of fact 39 carried none for two days, and lone errors on
// quiet days would have produced false stops — which `ideas/10` §5.5 forbids shipping at all. The
// same shape R4a-pulse holds in the internal map: an observation whose promotion to a verdict is a
// separate, gated act.
//
// THE PROPERTY THIS MODULE IS BUILT AROUND — "found nothing" and "could not look" are DIFFERENT
// ANSWERS, and conflating them is how a watcher becomes a rubber stamp. Every provider carries its
// own status (`ok` / `no-events` / `error`), and `verdictFor()` REFUSES to say "no fault" when any
// provider failed to answer: it returns UNKNOWN with the reason. A silent empty result read as
// "clean" is precisely the defect the contour's own review found one level up — a guard that
// reports a positive all-clear because its input directory was missing.
//
// PROOF STATUS IS SPLIT AND STAYS SPLIT (config.FAULT_PROVIDERS `provable`):
//   · Kernel-Power 41 is RED-PROVABLE ON THIS MACHINE — three real events (29.07, 05.08, 06.08.2026);
//   · `nvlddmkm` is RED-PROVABLE TOO, and it is the only row that arrives with a HISTORY instead of
//     a promise: 129 real events over 34 days, of which both fixtures are CAPTURED — including the
//     11:52:04 event `researches/15` is built on. That is what makes it worth doing first;
//   · Display 4101 (TDR), WHEA-Logger and WER 1001 are FIXTURE-PROVABLE ONLY — this machine has no
//     such history, and `__fixtures__/README.md` says which fixtures are CAPTURED and which are
//     CONSTRUCTED. A fixture proves the PARSER handles a shape; it never proves the shape is what
//     this machine would really emit. Those two claims are not blurred into one [TESTED] marker.
//
// GPU WRITES: NONE. This module reads the Windows event log. `Get-WinEvent` on the System log works
// UNELEVATED here (probed 2026-08-09, environment dossier) — do not demand admin.
//
// Usage:
//   node automation-engine/lib/event-logger.mjs --since 2026-08-06 --until 2026-08-07
//   node automation-engine/lib/event-logger.mjs --last 24h
//   node automation-engine/lib/event-logger.mjs --fixtures      run the fixture suite (P1-AC3)
//
// Verified 2026-08-10 by observation — see the [TESTED] markers per function.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

import config from '../config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, '__fixtures__');

/** Reading a few thousand event records must terminate; a hung query would hang the whole sweep. */
const PS_TIMEOUT_MS = 120_000;

// =================================================================================================
// 1. Parsing an event — pure, and therefore the part fixtures can prove
// =================================================================================================

const ENTITIES = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };

/** XML entity decode, plus numeric refs. Small on purpose: this module has zero dependencies. */
function unxml(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/gu, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/giu, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(amp|lt|gt|apos|quot);/gu, (_, n) => ENTITIES[n]);
}

/**
 * Parse ONE `<Event>` element into the fields a verdict needs.
 *
 * Written against CAPTURED XML from this machine, not from memory, and that paid off immediately:
 * the two providers spell the same field differently. `Microsoft-Windows-Kernel-Power` (a manifested
 * provider) emits `<EventID>41</EventID>`, while `Display` (a classic provider) emits
 * `<EventID Qualifiers='0'>4107</EventID>`. A regex written for the first form silently returns
 * nothing for the second — and "no id" would have been read as "no fault".
 *
 * [TESTED: 2026-08-10 · both real shapes parsed from captured fixtures; the fixture suite asserts
 * provider, id, level and time on every one]
 */
export function parseEventXml(xml) {
  const src = String(xml ?? '');
  const provider = src.match(/<Provider\b[^>]*\bName='([^']*)'/u);
  // BOTH forms: `<EventID>41</EventID>` and `<EventID Qualifiers='0'>4107</EventID>`.
  const id = src.match(/<EventID\b[^>]*>\s*(\d+)\s*<\/EventID>/u);
  const level = src.match(/<Level>\s*(\d+)\s*<\/Level>/u);
  const time = src.match(/<TimeCreated\b[^>]*\bSystemTime='([^']*)'/u);
  const record = src.match(/<EventRecordID>\s*(\d+)\s*<\/EventRecordID>/u);
  const computer = src.match(/<Computer>([^<]*)<\/Computer>/u);
  const channel = src.match(/<Channel>([^<]*)<\/Channel>/u);

  if (!provider || !id) return null;   // not an event element we understand — never guessed at

  const data = {};
  const unnamed = [];
  const dataRe = /<Data(?:\s+Name='([^']*)')?\s*>([\s\S]*?)<\/Data>/gu;
  for (let m = dataRe.exec(src); m; m = dataRe.exec(src)) {
    const value = unxml(m[2]);
    if (m[1]) data[unxml(m[1])] = value; else unnamed.push(value);
  }

  return {
    provider: unxml(provider[1]),
    eventId: Number(id[1]),
    level: level ? Number(level[1]) : null,
    timeCreated: time ? time[1] : null,       // the log's own UTC stamp, verbatim
    recordId: record ? Number(record[1]) : null,
    computer: computer ? unxml(computer[1]) : null,
    channel: channel ? unxml(channel[1]) : null,
    data,
    unnamedData: unnamed,
  };
}

/** Split a blob holding several `<Event>` elements and parse each. */
export function parseEvents(xmlBlob) {
  const out = [];
  const re = /<Event\b[\s\S]*?<\/Event>/gu;
  for (let m = re.exec(String(xmlBlob ?? '')); m; m = re.exec(String(xmlBlob ?? ''))) {
    const ev = parseEventXml(m[0]);
    if (ev) out.push(ev);
  }
  return out;
}

/**
 * Is this event one of the ones we watch, and IN WHICH CLASS? The rule set is
 * `config.FAULT_PROVIDERS` and nothing else — a second copy of the id list here is the mirror that
 * drifts.
 *
 * TWO CLASSES, and the separation is the whole point (`plans/29`, added 2026-08-23):
 *   · `means: 'CRASH'`  → `{ fault: true,  signal: false }` — it votes, through `verdictFor`.
 *   · `means: 'SIGNAL'` → `{ fault: false, signal: true  }` — it is OBSERVED and never votes.
 *
 * `fault` stays strictly boolean and stays FALSE for a signal, which is what makes every existing
 * consumer safe by construction: `queryFaults` filters on `.fault`, `stress-tester` and
 * `graphics-load` read only `verdictFor()`, so none of them can see a signal even by accident. That
 * is deliberate — `researches/15` §2 measured this channel as specific but NOT sensitive, and
 * `ideas/10` §5.5 forbids shipping a mechanism that produces false stops.
 *
 * AN EMPTY `ids` MATCHES ANY ID OF THAT PROVIDER — the same meaning the Windows query has always
 * given it (`QUERY_PS1` adds the ID filter only for a non-empty list). Before this, the two halves
 * disagreed silently, because `[].includes(x)` is false.
 *
 * [TESTED: 2026-08-10 · the fixture suite includes a REAL Display 4107 event, a provider we watch
 * at an id we do not, and asserts it is NOT a fault]
 * [TESTED: 2026-08-23 · the suite gained two CAPTURED `nvlddmkm` events — id 153 from inside the
 * rung that killed the machine, and id 14 — and asserts both are signals and NEITHER is a fault;
 * mutation-proved three ways, see `runFixtureSuite`]
 */
export function classifyEvent(ev, providers = config.FAULT_PROVIDERS) {
  if (!ev) return { fault: false, signal: false };
  const rule = providers.find((p) => p.provider === ev.provider
    && (p.ids.length === 0 || p.ids.includes(ev.eventId)));
  if (!rule) return { fault: false, signal: false };
  const isSignal = rule.means === 'SIGNAL';
  return { fault: !isSignal, signal: isSignal, means: rule.means, what: rule.what, provable: rule.provable };
}

// =================================================================================================
// 2. Asking Windows — the impure half
// =================================================================================================

/**
 * The query script. It lives here as a string rather than as a repo file so the ONE place that
 * describes what runs against the owner's machine is the code that runs it.
 *
 * Two details are load-bearing:
 *  · the "no events" case is told apart from a real failure by `FullyQualifiedErrorId`, never by the
 *    message text — this machine's PowerShell speaks ru-RU and matching on words would be a guard
 *    that works only in one locale;
 *  · results travel through a FILE, never through stdout: event messages are Russian here and a
 *    console codepage round-trip is exactly the silent-corruption class the canon names.
 */
const QUERY_PS1 = [
  '$ErrorActionPreference = "Stop"',
  '$spec = Get-Content -Raw -LiteralPath $env:KAGO_EVT_SPEC | ConvertFrom-Json',
  '$ci = [Globalization.CultureInfo]::InvariantCulture',
  '$from = [datetime]::Parse($spec.from, $ci)',
  '$to = [datetime]::Parse($spec.to, $ci)',
  '$lines = New-Object System.Collections.ArrayList',
  'foreach ($p in $spec.providers) {',
  '  $filter = @{ LogName = "System"; ProviderName = $p.provider; StartTime = $from; EndTime = $to }',
  '  if ($p.ids -and $p.ids.Count -gt 0) { $filter["ID"] = $p.ids }',
  '  $status = "ok"; $detail = ""; $evts = @()',
  '  try {',
  '    $evts = @(Get-WinEvent -FilterHashtable $filter -ErrorAction Stop)',
  '  } catch {',
  '    if ($_.FullyQualifiedErrorId -like "NoMatchingEventsFound*") { $status = "no-events" }',
  '    else { $status = "error"; $detail = ($_.Exception.Message -replace "\\s+", " ") }',
  '  }',
  '  [void]$lines.Add("###PROVIDER`t" + $p.provider + "`t" + $status + "`t" + $evts.Count + "`t" + $detail)',
  '  foreach ($e in $evts) { [void]$lines.Add($e.ToXml()) }',
  '}',
  '($lines -join "`n") | Out-File -LiteralPath $env:KAGO_EVT_OUT -Encoding utf8',
].join('\n');

/** PowerShell 5.1 writes UTF-8 WITH a BOM; JSON.parse and our regexes both dislike it. */
function readNoBom(path) {
  let t = readFileSync(path, 'utf8');
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  return t;
}

/**
 * Query the fault providers over `[from, to]`.
 *
 * Returns `{ window, providers: [{provider, status, count, detail}], events, faults }`. The
 * per-provider status is the whole point: a caller that only counts `faults` and ignores `status`
 * is reading "I could not look" as "nothing happened".
 *
 * [TESTED: 2026-08-10 · run over 2026-07-01..2026-08-10 on this machine — returned the three real
 * Kernel-Power 41 events (29.07, 05.08, 06.08) with status `ok`, and `no-events` for the other three
 * providers, each reported separately rather than merged into one silent zero]
 */
export function queryFaults({ from, to, providers = config.FAULT_PROVIDERS, powershell = 'powershell.exe' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kago-evt-'));
  const specPath = join(dir, 'spec.json');
  const scriptPath = join(dir, 'query.ps1');
  const outPath = join(dir, 'out.xml');

  const window = { from: isoLocalNoZone(from), to: isoLocalNoZone(to) };
  writeFileSync(specPath, JSON.stringify({
    from: window.from,
    to: window.to,
    providers: providers.map((p) => ({ provider: p.provider, ids: [...p.ids] })),
  }, null, 2), 'utf8');
  writeFileSync(scriptPath, QUERY_PS1, 'utf8');

  const r = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
    encoding: 'utf8',
    timeout: PS_TIMEOUT_MS,
    windowsHide: true,
    env: { ...process.env, KAGO_EVT_SPEC: specPath, KAGO_EVT_OUT: outPath },
  });

  if (r.error && r.error.code === 'ENOENT') {
    throw new Error(`нет powershell.exe на PATH — журнал Windows читать нечем`);
  }
  if (!existsSync(outPath)) {
    const tail = String((r && r.stderr) || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(`запрос к журналу не дал файла результата${tail ? `: ${tail}` : ''}`);
  }

  const blob = readNoBom(outPath);
  try { for (const f of [specPath, scriptPath, outPath]) unlinkSync(f); } catch { /* best effort */ }

  // Split the blob back into per-provider sections by the marker the script wrote.
  const sections = [];
  let current = null;
  for (const line of blob.split('\n')) {
    if (line.startsWith('###PROVIDER\t')) {
      const [, provider, status, count, detail] = line.split('\t');
      current = { provider, status, count: Number(count) || 0, detail: (detail || '').trim(), xml: [] };
      sections.push(current);
      continue;
    }
    if (current) current.xml.push(line);
  }

  const events = [];
  for (const s of sections) {
    for (const ev of parseEvents(s.xml.join('\n'))) events.push(ev);
  }
  // ONE pass, TWO lists. `faults` keeps exactly the meaning every existing consumer already relies
  // on; `signals` is new and nobody votes with it (`plans/29` §3).
  const classified = events.map((ev) => ({ ...ev, ...classifyEvent(ev, providers) }));
  const faults = classified.filter((e) => e.fault);
  const signals = classified.filter((e) => e.signal);

  return {
    window,
    providers: sections.map(({ provider, status, count, detail }) => ({ provider, status, count, detail })),
    events,
    faults,
    signals,
  };
}

/**
 * The verdict this module contributes.
 *
 * `CRASH` when a watched fault fired · `null` (UNKNOWN) when any provider could not be read —
 * never "clean" over a failed query · `undefined`-free by construction. The caller (stress-tester,
 * step 3.6) combines this with the checksum comparison for the three-way verdict.
 *
 * SIGNALS RIDE ALONG AND DO NOT VOTE. `signals` is attached to the returned object so a caller can
 * RECORD what the driver said in the same window, and the verdict computation below does not
 * mention it — the fifth input is an input to a DECISION, not a decision (`researches/15` §2 (в),
 * `plans/29` §0). This is the same shape R4a-pulse holds in the internal map: an observation whose
 * promotion to a verdict is a separate, gated act needing data this project does not have yet.
 *
 * [TESTED: 2026-08-10 · CRASH over the real 06.08 window; UNKNOWN when a provider status is forced
 * to `error`; clean over a window with no events and every provider answering]
 * [TESTED: 2026-08-23 · run over the window holding the two real `nvlddmkm` errors of the fatal
 * rung: signals 2, verdict NOT CRASH; mutation «let signals vote» reddens its own block]
 */
export function verdictFor(result) {
  // Carried on EVERY return path, including the two early ones: a caller that reads `signals` must
  // never find it missing because the query happened to fail or a fault happened to fire.
  const signals = result.signals || [];
  const broken = (result.providers || []).filter((p) => p.status === 'error');
  if (broken.length) {
    return {
      verdict: null,
      signals,
      reason: `не смог опросить ${broken.length} провайдер(ов): ` +
        broken.map((p) => `${p.provider} — ${p.detail || 'без пояснения'}`).join('; '),
    };
  }
  if (result.faults.length) {
    return {
      verdict: config.VERDICT.CRASH,
      signals,
      reason: result.faults.map((f) => `${f.provider}/${f.eventId} (${f.what}) в ${f.timeCreated}`).join('; '),
    };
  }
  return {
    verdict: null,
    signals,
    reason: 'сбоев в окне нет — но вердикт PASS даёт не этот модуль, а сверка с эталоном (R4)',
    clean: true,
  };
}

/**
 * Parse a moment the way a HUMAN typing it means it.
 *
 * `new Date('2026-07-01')` is UTC midnight by the ECMAScript spec, and on this machine (+03:00) that
 * silently becomes 03:00 local — a three-hour hole at the start of every window given as a bare
 * date. Caught by reading the tool's own printed window, not by reading the code: the run said
 * «ОКНО: 2026-07-01T03:00:00» for `--since 2026-07-01`. For a fault window three hours is a crash
 * nobody sees. A date-only string is therefore LOCAL midnight; anything else is left to `Date`.
 *
 * [TESTED: 2026-08-10 · `--since 2026-07-01` now prints 00:00:00, and a window ending at local
 * midnight tonight includes the events of the small hours it used to cut off]
 */
export function parseMoment(value) {
  if (value instanceof Date) return value;
  const s = String(value ?? '').trim();
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (dateOnly) return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 0, 0, 0, 0);
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) throw new Error(`не разобрал момент времени: ${value}`);
  return t;
}

/** `Date` → `YYYY-MM-DDTHH:MM:SS` in LOCAL time, no zone: the log filter works in local time. */
function isoLocalNoZone(d) {
  const t = parseMoment(d);
  if (Number.isNaN(t.getTime())) throw new Error(`не разобрал момент времени: ${d}`);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

// =================================================================================================
// 3. The fixture suite (P1-AC3)
// =================================================================================================

/**
 * Parse every fixture and hold it against `__fixtures__/expectations.json`.
 *
 * This is what proves the detectors this machine cannot prove with history. It asserts the
 * classification AND the parsed fields, so a parser that returns a plausible-but-wrong id fails
 * here rather than in a sweep six weeks from now.
 *
 * [TESTED: 2026-08-10 · green on 5 fixtures; and mutation-proved by pointing the Display rule at
 * 4107, which turned the negative fixture into a fault and made the suite red]
 */
export function runFixtureSuite({ dir = FIXTURES_DIR } = {}) {
  const expectationsPath = join(dir, 'expectations.json');
  if (!existsSync(expectationsPath)) throw new Error(`нет файла ожиданий: ${expectationsPath}`);
  const expectations = JSON.parse(readNoBom(expectationsPath));

  const onDisk = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.xml')).sort();
  const declared = Object.keys(expectations).sort();
  const results = [];

  // A fixture with no expectation is a fixture nobody checks; an expectation with no fixture is a
  // check that silently does not run. Both are failures, not warnings.
  for (const f of onDisk) {
    if (!declared.includes(f)) results.push({ file: f, ok: false, why: 'фикстура есть, а ожидания для неё нет' });
  }
  for (const f of declared) {
    if (!onDisk.includes(f)) results.push({ file: f, ok: false, why: 'ожидание есть, а фикстуры нет — проверка молча не выполнялась бы' });
  }

  for (const file of onDisk) {
    const exp = expectations[file];
    if (!exp) continue;
    const events = parseEvents(readNoBom(join(dir, file)));
    if (events.length !== 1) {
      results.push({ file, ok: false, why: `ожидал ровно одно событие, разобрал ${events.length}` });
      continue;
    }
    const ev = events[0];
    const cls = classifyEvent(ev);
    const checks = [
      ['provider', ev.provider, exp.provider],
      ['eventId', ev.eventId, exp.eventId],
      ['level', ev.level, exp.level],
      ['timeCreated', ev.timeCreated, exp.timeCreated],
      ['fault', cls.fault, exp.fault],
      // `signal` is normalised to a strict boolean on BOTH sides, so an expectation that simply
      // omits the field (every pre-2026-08-23 fixture) reads as `false` instead of `undefined` —
      // otherwise adding the class would have reddened five fixtures that are perfectly correct.
      ['signal', cls.signal === true, exp.signal === true],
      ['means', (cls.fault || cls.signal) ? cls.means : null, (exp.fault || exp.signal) ? exp.means : null],
    ];
    const bad = checks.filter(([, got, want]) => JSON.stringify(got) !== JSON.stringify(want));
    results.push(bad.length === 0
      ? { file, ok: true, provenance: exp.provenance, what: exp.what }
      : { file, ok: false, why: bad.map(([k, got, want]) => `${k}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`).join(' · ') });
  }

  for (const r of runClassInvariants()) results.push(r);

  return { ok: results.every((r) => r.ok), results };
}

/**
 * THE CLASS INVARIANTS — what the fixtures above CANNOT catch, and therefore what would otherwise
 * be guarded by nobody.
 *
 * The fixture loop only exercises `classifyEvent`. The property this whole change exists to hold is
 * one level up: **a SIGNAL must never reach a verdict.** Between `classifyEvent` and `verdictFor`
 * sit two filters and three return paths, and every one of them is a place where a signal could
 * start voting without a single fixture noticing. So the invariants are asserted on constructed
 * results, offline, with no event log and no card involved.
 *
 * Why this is the shape rather than a comment saying «be careful»: `researches/15` §2 measured this
 * channel across ALL twelve deaths of this machine and found it misses half of them while firing on
 * quiet days. A signal that quietly became a stop would halt the owner's sweep on evidence that has
 * already been shown insufficient — and `ideas/10` §5.5 forbids shipping that at all.
 *
 * [TESTED: 2026-08-23 · mutation-proved three ways, each reddening its own block and the intact
 * module reddening none: (a) `classifyEvent` returning `fault: true` for a SIGNAL rule;
 * (b) an empty `ids` matching nothing; (c) `verdictFor` counting `signals` alongside `faults`]
 */
export function runClassInvariants() {
  const out = [];
  const ok = (name) => out.push({ file: name, ok: true, provenance: 'CONSTRUCTED', what: 'инвариант класса' });
  const bad = (name, why) => out.push({ file: name, ok: false, why });

  const answering = [{ provider: 'nvlddmkm', status: 'ok', count: 1, detail: '' }];
  const signalEvent = { provider: 'nvlddmkm', eventId: 153, timeCreated: 'T', fault: false, signal: true, what: 'x' };
  const faultEvent = { provider: 'Microsoft-Windows-Kernel-Power', eventId: 41, timeCreated: 'T', fault: true, signal: false, what: 'y' };

  // A — the invariant this change exists for. Signals present, no fault: the window is CLEAN.
  {
    const v = verdictFor({ providers: answering, faults: [], signals: [signalEvent] });
    if (v.verdict === config.VERDICT.CRASH) bad('инвариант A: СИГНАЛ НЕ ДАЁТ ВЕРДИКТА', 'сигнал превратился в CRASH — это и есть запрещённый ложный стоп');
    else if (!v.clean) bad('инвариант A: СИГНАЛ НЕ ДАЁТ ВЕРДИКТА', `окно должно быть чистым, а clean=${v.clean}`);
    else if (!Array.isArray(v.signals) || v.signals.length !== 1) bad('инвариант A: СИГНАЛ НЕ ДАЁТ ВЕРДИКТА', 'сигнал не доехал до вызывающего — наблюдение потеряно');
    else ok('инвариант A: СИГНАЛ НЕ ДАЁТ ВЕРДИКТА, но доезжает до вызывающего');
  }

  // B — the signals must survive the OTHER two return paths as well, or a caller finds them missing
  // exactly when something interesting happened.
  {
    const onFault = verdictFor({ providers: answering, faults: [faultEvent], signals: [signalEvent] });
    const onBroken = verdictFor({ providers: [{ provider: 'x', status: 'error', count: 0, detail: 'd' }], faults: [], signals: [signalEvent] });
    if (onFault.verdict !== config.VERDICT.CRASH) bad('инвариант B: СИГНАЛЫ ЕДУТ ПО ВСЕМ ТРЁМ ВЫХОДАМ', 'настоящий сбой перестал давать CRASH');
    else if (onFault.signals.length !== 1 || onBroken.signals.length !== 1) bad('инвариант B: СИГНАЛЫ ЕДУТ ПО ВСЕМ ТРЁМ ВЫХОДАМ', 'на выходе со сбоем или с неопрошенным провайдером сигналы потерялись');
    else ok('инвариант B: СИГНАЛЫ ЕДУТ ПО ВСЕМ ТРЁМ ВЫХОДАМ verdictFor');
  }

  // C — an empty `ids` means «the whole provider», on the classifier's side too. This is the half
  // that used to disagree with the Windows query, and an id the driver has never emitted before is
  // exactly the case the empty list exists for.
  //
  // THE ORDER OF THESE CHECKS IS THE DIAGNOSIS, and it was rewritten after the mutation run caught
  // the first version LYING. Asking «is it a signal?» first made a misclassification (mutation a)
  // report «the empty list stopped catching events» — which is false: the list caught it fine and
  // then filed it wrong. A guard whose red line names the wrong cause sends the next session down
  // the wrong corridor, and that is worse than a guard that merely goes red. So MATCHING is asked
  // before CLASS: `means` is present iff a rule matched at all.
  {
    const rules = [{ provider: 'nvlddmkm', ids: [], means: 'SIGNAL', what: 'w', provable: 'history' }];
    const seen = classifyEvent({ provider: 'nvlddmkm', eventId: 153 }, rules);
    const unseen = classifyEvent({ provider: 'nvlddmkm', eventId: 999999 }, rules);
    const other = classifyEvent({ provider: 'Display', eventId: 4107 }, rules);
    const NAME = 'инвариант C: ПУСТОЙ СПИСОК ID = ВЕСЬ ПРОВАЙДЕР';
    if (!seen.means || !unseen.means) bad(NAME, 'СОПОСТАВЛЕНИЕ: пустой список перестал ловить события своего провайдера — новый идентификатор драйвера стал бы невидим');
    else if (!seen.signal || !unseen.signal || seen.fault || unseen.fault) bad(NAME, `КЛАССИФИКАЦИЯ: правило нашлось (means=${seen.means}), но событие отнесено к сбоям — жалоба драйвера стала бы остановкой`);
    else if (other.means || other.signal || other.fault) bad(NAME, 'ОБЛАСТЬ: пустой список захватил ЧУЖОГО провайдера');
    else ok(`${NAME}, и только он`);
  }

  // D — the roster itself. A future edit that quietly reclassifies the driver channel as CRASH is
  // the one-line defect `plans/29` §0 exists to prevent, and it must not pass silently.
  {
    const rule = config.FAULT_PROVIDERS.find((p) => p.provider === 'nvlddmkm');
    if (!rule) bad('инвариант D: КАНАЛ ДРАЙВЕРА ЧИСЛИТСЯ СИГНАЛОМ', 'провайдера nvlddmkm нет в списке — пятое наблюдение исчезло');
    else if (rule.means !== 'SIGNAL') bad('инвариант D: КАНАЛ ДРАЙВЕРА ЧИСЛИТСЯ СИГНАЛОМ', `means=${rule.means}: 123 исторические жалобы драйвера стали бы 123 остановками`);
    else if (rule.ids.length !== 0) bad('инвариант D: КАНАЛ ДРАЙВЕРА ЧИСЛИТСЯ СИГНАЛОМ', 'появился список id — новый идентификатор драйвера станет невидимым');
    else ok('инвариант D: КАНАЛ ДРАЙВЕРА ЧИСЛИТСЯ СИГНАЛОМ, без списка id');
  }

  return out;
}

// =================================================================================================
// 4. CLI
// =================================================================================================

function parseArgs(argv) {
  const o = { since: null, until: null, last: null, fixtures: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fixtures') o.fixtures = true;
    else if (a === '--json') o.json = true;
    else if (a === '--since') o.since = argv[++i];
    else if (a === '--until') o.until = argv[++i];
    else if (a === '--last') o.last = argv[++i];
    else throw new Error(`неизвестный флаг: ${a}`);
  }
  return o;
}

/** `24h` / `90m` / `7d` → milliseconds. A bare number is refused rather than guessed at. */
export function parseDuration(text) {
  const m = String(text ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(m|h|d)$/iu);
  if (!m) throw new Error(`не разобрал длительность «${text}» — нужно вида 90m, 24h, 7d`);
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return n * (unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000);
}

function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`ОШИБКА: ${e.message}`); return 2; }

  try {
    if (o.fixtures) {
      const r = runFixtureSuite();
      for (const x of r.results) {
        console.log(`${x.ok ? 'OK  ' : 'ПЛОХО'} ${x.file}${x.ok ? `  (${x.provenance}) ${x.what}` : ''}`);
        if (!x.ok) console.log(`      ${x.why}`);
      }
      console.log('');
      console.log(r.ok ? `ФИКСТУРЫ: ${r.results.length} шт., все сходятся.` : 'ФИКСТУРЫ: есть расхождения.');
      return r.ok ? 0 : 1;
    }

    const now = new Date();
    // A bare `--until 2026-08-10` means "through the end of that day", not "at its first instant" —
    // otherwise the day the human named is the one day the window excludes.
    const to = o.until ? new Date(parseMoment(o.until).getTime() + (/^\d{4}-\d{2}-\d{2}$/u.test(o.until) ? 86_400_000 - 1000 : 0)) : now;
    const from = o.since ? parseMoment(o.since)
      : new Date(to.getTime() - (o.last ? parseDuration(o.last) : parseDuration('24h')));

    const r = queryFaults({ from, to });
    const v = verdictFor(r);

    console.log(`ОКНО: ${r.window.from} .. ${r.window.to}`);
    for (const p of r.providers) {
      const rule = config.FAULT_PROVIDERS.find((x) => x.provider === p.provider);
      console.log(`  · ${p.provider} [${rule ? rule.provable : '?'}] — ${p.status}, событий ${p.count}` +
        (p.detail ? `, ${p.detail}` : ''));
    }
    if (r.faults.length) {
      console.log('');
      console.log(`СБОИ (${r.faults.length}):`);
      for (const f of r.faults) console.log(`  · ${f.timeCreated}  ${f.provider}/${f.eventId} — ${f.what}`);
    }
    // Its own section, and the wording is load-bearing: this is what the driver SAID, and it is an
    // input to the edge decision. A reader who takes it for a verdict would be taking a signal that
    // missed half of this machine's deaths for a stop condition (`researches/15` §2).
    if (r.signals.length) {
      console.log('');
      console.log(`СИГНАЛЫ (${r.signals.length}) — наблюдение, вердикта не дают:`);
      for (const s of r.signals) {
        const said = [...(s.unnamedData || []), ...Object.values(s.data || {})]
          .map((x) => String(x).trim()).filter(Boolean).join(' · ');
        console.log(`  · ${s.timeCreated}  ${s.provider}/${s.eventId}${said ? ` — ${said}` : ''}`);
      }
    }
    console.log('');
    console.log(`ВЕРДИКТ: ${v.verdict ?? (v.clean ? 'сбоев нет' : 'НЕИЗВЕСТНО')}`);
    console.log(`         ${v.reason}`);
    if (o.json) console.log(JSON.stringify({ window: r.window, providers: r.providers, faults: r.faults, signals: r.signals, verdict: v }, null, 2));

    // Exit 0 means the QUESTION was answered, not that the answer was good. A caller reads the
    // verdict; conflating "a fault was found" with "the tool failed" would make both unreadable.
    return v.verdict === null && !v.clean ? 1 : 0;
  } catch (e) {
    console.error(`ОШИБКА: ${e.message}`);
    return 1;
  }
}

// T9 — a module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)));
}

export { FIXTURES_DIR };
