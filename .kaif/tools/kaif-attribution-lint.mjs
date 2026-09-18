#!/usr/bin/env node
// kaif-attribution-lint.mjs — the OPTIONAL authorship linter (2.7, epic AW; AGENT_GUIDE.md →
// "Authorship of a decision"; origin issue #55 — the owner's word, rendered from Russian: "you write
// some nonsense yourself, then read it back and interpret it as MY word"). Deployed to .kaif/tools/.
//
// What it mechanizes: a line that ATTRIBUTES a decision or a will to the owner — "the owner's
// decision", "решение владельца", "the owner decided", "владелец велел", or the owner's signature
// `[OWNER]` / `[ВЛАДЕЛЕЦ]` — must carry, within a window of WINDOW lines around it, one of:
//   · a verbatim quote of the owner — «…», “…” or "…" — or a `>` quote line;
//   · the address of the interview that holds the verbatim text — `interviews/…`, `интервью №NNN`,
//     `interview #NNN`, `interview_NNN`;
//   · the number of a RECORDED decision (`решение №109`, `decision #12`, `MASTER_PLAN §7 №95`) — a
//     number counts only with a registry word on the same line: a bare `№55` is an issue, a page, anything;
//   · the declared exception on the line — `<!-- attribution-ok: <where the quote lives> -->`;
// or the line is signed as the AGENT's own decision ([AI] / [AI-ed] / the localized `aiMarks` pair of
// .kaif/kaif.json) — a signed agent decision is no attribution. A "Decisions made without the owner"
// section (any language — see SELF_SECTION) is the agent's signature block-wise: its lines are skipped.
//
// Why a linter and not a paragraph: the canon already said "quote the owner verbatim"; a prose rule
// holds until the session tires — in one deployment 430 of 1083 references to the owner's will carried
// no quote, and one of them ("the owner's decision P1: wait, no threshold" — his actual word was "do as
// you see fit") held a run for 119 s while the owner's machine died.
//
// Boundaries, so the linter never becomes bureaucracy:
//   · patterns are DATA per language (ATTRIBUTION) — a project adds a row, the engine does not change;
//   · invisible by construction: fenced code, `>` quote lines (they are EVIDENCE for their neighbours,
//     never findings themselves), inline code spans, HTML comments, lines carrying ❌ (the canon's own
//     counter-examples);
//   · DEBT, not a turnstile: findings already recorded in the baseline (.kaif/attribution-lint.baseline.json,
//     keys `file:sha16(line)`) are printed as debt and exit 0; only NEW findings exit 1; the baseline is
//     written once on adoption (`--write-baseline`) and ONLY SHRINKS after that: a rewrite that would turn
//     a NEW finding into debt is REFUSED (exit 1) unless `--adopt-new` is passed explicitly — the count of
//     adopted lines is printed, never silent; a baselined line that changed or vanished is pruned;
//   · exit 3 = SKIPPED: no markdown in scope — "not scanned" must never read as "clean" (bug 34 class);
//   · it cannot see an attribution phrased outside the table ("as agreed", "как договаривались"), it
//     cannot judge whether a quote is genuine, and non-markdown files (code comments) are out of scope —
//     those stay with `/fable-judge` (the hunt "an agent decision worn as the owner's word").
//
// Commands:
//   node .kaif/tools/kaif-attribution-lint.mjs check [paths…] [--write-baseline [--adopt-new]] [--baseline <file>]
//         # default paths: plans bugs ideas interviews researches homeworks reports + the root *.md
//   node .kaif/tools/kaif-attribution-lint.mjs selftest
//         # PROVE both answers on in-memory fixtures (RU + EN): the field line without a quote → finding;
//         # with a quote / a `>` quote line / an interview address / a decision number / an agent signature /
//         # the marker → clean; the owner's signature without his words → finding; invisible zones stay
//         # silent; the baseline swallows old debt and reddens on a new line only.
//
// @guard kaif-attribution-lint
// THREAT:         an agent's own choice recorded as "the owner's decision" without his words becomes
//                 unrevisable and is obeyed by later sessions (origin #55: a run held for 119 s while
//                 the owner's machine died)
// PROVED-AGAINST: selftest — the field line «Решение владельца П1 (plans/81 §3): ЖДАТЬ, порога не
//                 заводить» with no quote within ±2 lines → 1 finding; the same line with «давай как ты
//                 считаешь» beside it → 0; the EN twin "the owner's decision P1: wait, no threshold" → 1;
//                 the ticket's own mutant «[ВЛАДЕЛЕЦ] без цитаты» → 1
// GAP:            an attribution phrased outside the pattern table is invisible; a fabricated quote
//                 passes as a quote (the judge's half); non-markdown files — code comments — are out of
//                 scope; an incidental quote or decision number within the window grounds a neighbour
// ON-REAL-PATH:   the origin's own knowledge directories and root documents — first live run
//                 2026-09-12 (epic AW), baseline written; see the [TESTED] line below
// [TESTED: 2026-09-12 · selftest green (RU + EN, 26 cases); sandbox suite s24 — bad fixture exit 1 with
//  both languages named, clean fixture exit 0, baseline swallows the old debt and reddens on the new
//  line only, a rewrite with a NEW finding present is refused unless --adopt-new, empty tree SKIPPED
//  (exit 3); live run over the origin — see STATUS "Инструменты"]
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const FLAGS = new Set(argv.filter((a) => a.startsWith('--')));
const baselineFlagAt = argv.indexOf('--baseline');
const BASELINE = baselineFlagAt >= 0 && argv[baselineFlagAt + 1] ? argv[baselineFlagAt + 1] : '.kaif/attribution-lint.baseline.json';
const PATHS = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--baseline');
const EXIT_SKIPPED = 3;
const WINDOW = 2;                       // lines before and after an attribution that may carry the evidence
const DEFAULT_DIRS = ['plans', 'bugs', 'ideas', 'interviews', 'researches', 'homeworks', 'reports'];
const SKIP_DIRS = new Set(['.git', 'node_modules', '.kaif', 'dist', 'vendor', 'framework']);
// The machinery's own transients legally QUOTE conventions while describing them (bug 34 class).
const TRANSIENTS = new Set(['KAIF.md', 'KAIF_UPDATE_TASK.md', 'KAIF_ADAPTATION_TASK.md', 'KAIF_UPDATE_TASK.superseded.md']);
const KAIF_JSON = '.kaif/kaif.json';

const log = (s) => console.log(s);
const sha16 = (s) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

// ---------------------------------------------------------------------------
// Patterns — DATA per language. Cyrillic word boundaries are lookarounds on the Cyrillic range
// (JavaScript `\b` is blind to non-ASCII letters — a paid-for lesson).
const CYR = '[А-Яа-яЁё]';
const cyr = (src) => new RegExp(`(?<!${CYR})(?:${src})(?!${CYR})`, 'iu');
// Only forms that ASSERT a decision or an order are attributions. A bare mention of the concept
// ("the owner's word is the source of truth", "a candidate for the owner's word") is prose about the
// rule, not a claim about a choice — it stays invisible, or the linter reddens on every canon page.
export const ATTRIBUTION = {
  ru: [
    cyr('(?:решени[еяю]|приказ[аеу]?|вердикт[аеу]?|распоряжени[еяю])\\s+(?:владельца|заказчика|автора)'),
    cyr('(?:владелец|заказчик|автор)\\s+(?:решил|велел|сказал|выбрал|попросил|потребовал|постановил|утвердил|запретил|разрешил|заказал|отверг|принял|одобрил)'),
    cyr('по\\s+(?:решению|слову|воле|приказу|требованию|распоряжению)\\s+(?:владельца|заказчика|автора)'),
  ],
  en: [
    /\bthe owner['’]?s\s+(?:decision|order|verdict|ruling|instruction)\b/i,
    /\b(?:the\s+)?owner\s+(?:decided|said|chose|ordered|asked|demanded|ruled|approved|forbade|allowed|rejected|accepted)\b/i,
    /\b(?:per|by|under|on)\s+the\s+owner['’]?s\s+(?:decision|word|will|order|instruction)\b/i,
    /\bdecided by the owner\b/i,
  ],
  // The owner's SIGNATURE (AGENT_GUIDE → "Authorship of a decision") is itself an attribution: `[OWNER]`
  // without his words beside it is the ticket's own acceptance mutant (#55 "как проверить починку").
  any: [/\[(?:OWNER|ВЛАДЕЛЕЦ)\]/u],
};
// Evidence that the attribution is grounded — any of these within the window.
// An opening guillemet or curly quote anywhere in the window counts: prose wraps at ~100 columns, so a
// verbatim quote often opens on one line and closes on the next; the ASCII pair must close on its line
// (a lone " is code and JSON as often as it is speech). A `>` quote line is evidence too — the most
// natural quoting form of a markdown document.
const QUOTE_RE = /«|“|"[^"\n]{3,}"/u;
const QUOTE_LINE_RE = /^\s*>/;
// An interview address — a pointer into the registry that holds the words.
const INTERVIEW_RE = /interviews\/|интервью\s*№\s*\d|interview\s*#\s*\d|interview_\d{3}/iu;
// The NUMBER of a recorded decision (`решение №109`, `decision #12`, `MASTER_PLAN §7 №95`) — a pointer into
// the decision journal. The number alone is NOT evidence (`issue №55`, a page, a bug): it must sit on a line
// that also carries a registry word. A plan or section address alone is not evidence either: the field
// line "the owner's decision P1 (plans/81 §3)" pointed at a plan whose "decision" was the agent's own.
// The registry word must sit NEXT to the number ("решение №105", "№105 (решение", "decision #12",
// "§7 №95", "MASTER_PLAN … №95"): the attribution line itself says "решение владельца", so a word
// anywhere on the line would ground a bare "(issue №55)" through the attribution's own wording.
const DECISION_ADDRESS_RE = /(?:решени[а-яё]*\s+(?:владельца\s+)?№\s*\d+|№\s*\d+\s*\(?\s*решени|decision\s*#\s*\d+|№\s*\d+\s*\(?\s*decision|§\s*7\s*№\s*\d+|MASTER_PLAN[^\n]{0,40}№\s*\d+|журнал[а-яё]*\s+решений[^\n]{0,20}№\s*\d+)/iu;
const decisionAddress = (l) => DECISION_ADDRESS_RE.test(l);
const OK_MARK_RE = /<!--\s*attribution-ok:/iu;
// The agent's own signature on the line — a signed agent decision is not an attribution.
const DEFAULT_AGENT_MARKS = ['[AI]', '[AI-ed]', '[ИИ]', '[ИИ-ред]'];
// A "decisions made without the owner" section is the agent's signature block-wise (any language).
const SELF_SECTION = /(Decisions made without the owner|Решения, принятые агентом без владельца|Решения без владельца|Decisions without the owner)/iu;

function agentMarks(root = '.') {
  const marks = [...DEFAULT_AGENT_MARKS];
  const p = join(root, KAIF_JSON);
  if (existsSync(p)) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
      if (Array.isArray(j.aiMarks)) for (const m of j.aiMarks) if (typeof m === 'string') marks.push(m);
    } catch { /* a malformed marker is the provenance gate's business, not this linter's */ }
  }
  return marks;
}

// Strip what must not be judged: HTML comments and inline code spans (the text stays for evidence).
const stripInvisible = (line) => line.replace(/<!--.*?-->/g, ' ').replace(/`[^`]*`/g, ' ');
const headingLevel = (l) => { const m = l.match(/^(#{1,6})\s/); return m ? m[1].length : 0; };
const grounds = (l) => QUOTE_RE.test(l) || QUOTE_LINE_RE.test(l) || INTERVIEW_RE.test(l) || decisionAddress(l);

/** Findings of one document: [{ line, text }] — text is the exact source line (trimmed). */
export function lintText(src, marks = DEFAULT_AGENT_MARKS) {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  let fence = false;
  let selfUntil = -1;   // inside a "decisions without the owner" section until this heading level closes it
  let selfLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    const h = headingLevel(raw);
    if (h) {
      if (selfUntil >= 0 && h <= selfLevel) selfUntil = -1;
      if (SELF_SECTION.test(raw)) { selfUntil = i; selfLevel = h; continue; }
    }
    if (selfUntil >= 0) continue;                       // the agent's own decisions, signed block-wise
    if (QUOTE_LINE_RE.test(raw)) continue;              // a quote line — evidence for neighbours, never a finding
    if (raw.includes('❌')) continue;                    // the canon's counter-example
    const text = stripInvisible(raw);
    const attributes = Object.values(ATTRIBUTION).some((rules) => rules.some((re) => re.test(text)));
    if (!attributes) continue;
    if (OK_MARK_RE.test(raw)) continue;                 // the declared exception names where the quote lives
    if (marks.some((m) => raw.includes(m))) continue;   // signed as the agent's decision
    const lo = Math.max(0, i - WINDOW), hi = Math.min(lines.length - 1, i + WINDOW);
    let grounded = false;
    for (let j = lo; j <= hi && !grounded; j++) if (grounds(lines[j])) grounded = true;
    if (grounded) continue;
    out.push({ line: i + 1, text: raw.trim() });
  }
  return out;
}

function* walkMd(dir, root) {
  if (!existsSync(dir)) return;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (SKIP_DIRS.has(n)) continue;
    if (statSync(p).isDirectory()) { yield* walkMd(p, root); continue; }
    if (/\.md$/i.test(n)) yield p;
  }
}
function scopeFiles(root, paths) {
  const files = [];
  if (paths.length) {
    for (const p of paths) {
      const full = join(root, p);
      if (!existsSync(full)) continue;
      if (statSync(full).isDirectory()) files.push(...walkMd(full, root)); else if (/\.md$/i.test(full)) files.push(full);
    }
  } else {
    for (const d of DEFAULT_DIRS) files.push(...walkMd(join(root, d), root));
    for (const n of readdirSync(root)) if (/\.md$/i.test(n) && !TRANSIENTS.has(n) && statSync(join(root, n)).isFile()) files.push(join(root, n));
  }
  return files.map((f) => f.replaceAll('\\', '/')).sort();
}
const rel = (root, f) => f.replaceAll('\\', '/').replace(root.replaceAll('\\', '/').replace(/\/?$/, '/'), '').replace(/^\.\//, '');

function readBaseline(p) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
}

/** The check over a root: { findings: [{file, line, text, key}], scanned } */
export function runCheck(root, paths = []) {
  const marks = agentMarks(root);
  const files = scopeFiles(root, paths);
  const findings = [];
  for (const f of files) {
    const r = rel(root, f);
    for (const x of lintText(readFileSync(f, 'utf8'), marks)) findings.push({ file: r, line: x.line, text: x.text, key: `${r}:${sha16(x.text)}` });
  }
  return { findings, scanned: files.length };
}

function writeBaseline(findings) {
  const entries = {};
  for (const f of findings) entries[f.key] = `${f.file}:${f.line} ${f.text.slice(0, 100)}`;
  const dir = dirname(BASELINE);
  if (dir && dir !== '.') mkdirSync(dir, { recursive: true });   // a bare file name has no directory to create
  writeFileSync(BASELINE, JSON.stringify({ written: new Date().toISOString(), count: findings.length, entries }, null, 2) + '\n');
}

function cmdCheck() {
  const root = '.';
  const { findings, scanned } = runCheck(root, PATHS);
  if (!scanned) { log(`⊘ SKIPPED — no markdown in scope (${PATHS.length ? PATHS.join(' ') : DEFAULT_DIRS.join(' ') + ' + root *.md'}): nothing was proven (exit 3).`); process.exit(EXIT_SKIPPED); }
  const baseline = readBaseline(BASELINE);
  const known = new Set(Object.keys((baseline && baseline.entries) || {}));
  const fresh = findings.filter((f) => !known.has(f.key));
  if (FLAGS.has('--write-baseline')) {
    // Adoption writes the whole picture once. After that the baseline ONLY SHRINKS: a rewrite that would
    // launder a NEW finding into debt is refused — growth is an explicit, printed act (--adopt-new).
    if (baseline && fresh.length && !FLAGS.has('--adopt-new')) {
      for (const f of fresh) console.error(`✖ NEW, not baselined: ${f.file}:${f.line} — «${f.text.slice(0, 100)}»`);
      console.error(`✖ baseline NOT rewritten: ${fresh.length} NEW finding(s) would become debt — ground them (quote · address · [AI]) or pass --adopt-new to record them on purpose`);
      process.exit(1);
    }
    writeBaseline(findings);
    const pruned = baseline ? [...known].filter((k) => !findings.some((f) => f.key === k)).length : 0;
    log(`baseline written: ${BASELINE} — ${findings.length} finding(s) recorded as debt${baseline ? ` (${fresh.length} adopted as NEW on purpose, ${pruned} pruned)` : ''} (it only shrinks from here; a changed or vanished line is pruned on the next write)`);
    return;
  }
  const debt = findings.length - fresh.length;
  for (const f of fresh) console.error(`✖ ${f.file}:${f.line} — attribution to the owner without his words: «${f.text.slice(0, 120)}» (no verbatim quote, quote line, interview address or decision number within ±${WINDOW} lines; sign it [AI] if it is the agent's, quote him if it is his, or mark <!-- attribution-ok: … -->)`);
  const prunable = baseline ? known.size - debt : 0;
  const tail = baseline ? ` · debt ${debt} (baseline ${BASELINE}${prunable > 0 ? `, ${prunable} entr${prunable === 1 ? 'y' : 'ies'} no longer found — rewrite it` : ''})` : (findings.length ? ' · no baseline yet — adopt with --write-baseline' : '');
  if (fresh.length) { console.error(`✖ attribution-lint: ${fresh.length} NEW finding(s) in ${scanned} file(s)${tail}`); process.exit(1); }
  log(`✅ attribution-lint OK — ${scanned} file(s) scanned, new 0${tail}`);
}

// ---------------------------------------------------------------------------
// selftest — both answers on in-memory fixtures, then the baseline behaviour on a temp tree.
function cmdSelftest() {
  let n = 0, bad = 0;
  const expect = (name, src, want, marks = DEFAULT_AGENT_MARKS) => {
    n++;
    const got = lintText(src, marks).length;
    const ok = got === want;
    if (!ok) bad++;
    log(`${ok ? '✅' : '❌'} ${name} — findings ${got}, expected ${want}`);
  };
  const FIELD_LINE = '* ⚡ Ш5 — ОЖИДАНИЕ РАСПИСКИ РУКИ 2. Решение владельца П1 (plans/81 §3): ЖДАТЬ, порога не заводить.';
  expect('RU: the field line, no quote → finding', `# x\n\n${FIELD_LINE}\n\nТекст.\n`, 1);
  expect('RU: the same line with the mandate quoted beside it → clean', `${FIELD_LINE}\nСлово владельца дословно: «давай как ты считаешь».\n`, 0);
  expect('RU: a `>` quote line beside it → clean', `Решение владельца — ждать.\n> давай как ты считаешь\n`, 0);
  expect('RU: an interview address in the window → clean', `Решение владельца — ждать.\nИсточник: интервью №031, Q1.\n`, 0);
  expect('RU: a decision number WITH a registry word → clean', `По слову владельца порог снят (решение №105).\n`, 0);
  expect('RU: a bare number without a registry word (an issue) → finding', `Решение владельца П1: ждать (issue №55).\n`, 1);
  expect('RU: signed as the agent\'s decision → clean', `[ИИ] по мандату — «давай как ты считаешь»: ждать расписки; решение владельца не требовалось.\n`, 0);
  expect('RU: the declared exception on the line → clean', `Решение владельца П1: ждать. <!-- attribution-ok: plans/81 §3 -->\n`, 0);
  expect('RU: "владелец велел" without words → finding', `Владелец велел убрать порог.\n`, 1);
  expect('RU: "по слову владельца" with a quote two lines away → clean', `По слову владельца порог снят.\n\n«порога не заводить» — его слова 2026-09-08.\n`, 0);
  expect('RU: a quote THREE lines away is outside the window → finding', `По слову владельца порог снят.\n\n\n«порога не заводить».\n`, 1);
  expect('RU: the owner\'s signature without his words → finding (the ticket\'s mutant)', `[ВЛАДЕЛЕЦ] ждать, порога не заводить · 2026-09-08 — не пересматривать.\n`, 1);
  expect('RU: the owner\'s signature with his words → clean', `[ВЛАДЕЛЕЦ] «давай как ты считаешь» · 2026-09-08.\n`, 0);
  expect('EN: the owner\'s decision without words → finding', `The owner's decision P1: wait, no threshold.\n`, 1);
  expect('EN: with the interview address → clean', `The owner's decision (interview #031, Q1): wait.\n`, 0);
  expect('EN: "the owner decided" with a quote → clean', `The owner decided: "do as you see fit".\n`, 0);
  expect('EN: with a decision number and the registry word → clean', `Per the owner's decision (decision #12): wait.\n`, 0);
  expect('EN: signed [AI] by mandate → clean', `[AI] by mandate — "do as you see fit": wait for the receipt; the owner's decision is not claimed.\n`, 0);
  expect('EN: the owner\'s signature without his words → finding', `[OWNER] wait, no threshold · 2026-09-08 — not to be revisited.\n`, 1);
  expect('EN: the owner\'s signature with his words → clean', `[OWNER] "do as you see fit" · 2026-09-08.\n`, 0);
  expect('invisible: ❌ counter-example → clean', `❌ the owner's decision with no quote — the bad form.\n`, 0);
  expect('invisible: inline code and a fenced block → clean', 'Use `the owner\'s decision` and `[OWNER]` as the pattern.\n\n```\nthe owner\'s decision P1: wait\n```\n', 0);
  expect('invisible: a `>` quote line is never a finding → clean', `> Решение владельца П1: ждать — цитата из старого документа.\n`, 0);
  expect('block signature: a "decisions without the owner" section is skipped, the next section is not', `## Decisions made without the owner\n\n1. По решению владельца ждать — нет, это выбор агента.\n\n## Links\n\nПо решению владельца ждать.\n`, 1);
  expect('localized aiMarks from kaif.json are a signature too', `[КИ] по мандату: ждать; решение владельца не требовалось.\n`, 0, [...DEFAULT_AGENT_MARKS, '[КИ]']);

  // baseline behaviour on a temp tree: adopt → clean; a NEW line → exit 1 naming it only
  const root = mkdtempSync(join(tmpdir(), 'kaif-attribution-'));
  try {
    mkdirSync(join(root, 'plans'), { recursive: true });
    writeFileSync(join(root, 'plans', '01.md'), `# P\n\n${FIELD_LINE}\n`);
    const first = runCheck(root);
    const entries = {}; for (const f of first.findings) entries[f.key] = f.text;
    writeFileSync(join(root, 'baseline.json'), JSON.stringify({ entries }));
    writeFileSync(join(root, 'plans', '01.md'), `# P\n\n${FIELD_LINE}\n\nВладелец велел убрать порог.\n`);
    const second = runCheck(root);
    const fresh = second.findings.filter((f) => !(f.key in entries));
    n++;
    const ok = second.findings.length === 2 && fresh.length === 1 && /велел/.test(fresh[0].text);
    if (!ok) bad++;
    log(`${ok ? '✅' : '❌'} baseline: the old line is debt, only the new line is NEW — findings ${second.findings.length}, new ${fresh.length}`);
  } finally { rmSync(root, { recursive: true, force: true }); }

  if (bad) { console.error(`✖ selftest FAILED — ${bad} of ${n} cases`); process.exit(1); }
  log(`✅ selftest OK — ${n} cases (RU + EN; both answers on every fixture; baseline proven)`);
}

({ check: cmdCheck, selftest: cmdSelftest }[CMD] || (() => { console.error(`✖ unknown command: ${CMD} (check [paths…] [--write-baseline [--adopt-new]] [--baseline <file>] | selftest)`); process.exit(1); }))();
