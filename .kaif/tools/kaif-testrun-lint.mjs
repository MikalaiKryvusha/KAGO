#!/usr/bin/env node
// kaif-testrun-lint.mjs — the OPTIONAL run-report linter (2.7, epic TR; TESTING_FRAMEWORK.md →
// "An executed run produces its report"; origin issue #59 — the owner-QA's word: "THERE WAS NO
// TESTING"). Deployed to .kaif/tools/.
//
// What it mechanizes: the report an EXECUTED run leaves behind in the project's test-doc home,
// as a catalog by date — `<testdocs>/reports/<YYYY-MM-DD>_<work>.md` — keeps its FORM: seven
// fields (Work · Contour · Runs · Checks · Found · Traces · Verdict), none empty; Runs with a
// command in a code span and a moment per run; Found as a list or an explicit "none"; a Verdict
// named by one of four words. The canon requires the report; this linter judges the shape of one
// that was written.
//
// What it does NOT do, said aloud: it cannot see a report that was never written — a `[TESTED: …]`
// claim about a run with no report behind it is the judge's hunt ("tested without a run report"),
// never this linter's finding; and it does not verify that the commands ran — the judge re-executes
// one, this linter only checks that they are there to re-execute.
//
// Boundaries, so the linter never becomes bureaucracy:
//   · field keywords are a per-language table (like the scenario form); a project adds a row;
//   · rules are DATA (one engine + rules-as-data): a new rule is a table row, not a new script;
//   · ADVISORY: exit 1 = findings, exit 0 = judged and clean, exit 3 = SKIPPED (no reports catalog
//     in the home — "not judged" must never read as "clean");
//   · placeholders `<…>` (multi-line, one level nested) and table header/separator rows are not content:
//     an unfilled copy of the template reddens with `empty-field` naming all seven fields, and a copy
//     with ONE field filled reddens naming the other six — one filled row is not a report;
//   · word boundaries are lookarounds on Unicode letters — JavaScript `\b` is blind to non-ASCII
//     letters, a paid-for lesson.
//
// Commands:
//   node .kaif/tools/kaif-testrun-lint.mjs check [home]   # home: .kaif/kaif.json → testdocs, default testcases/
//   node .kaif/tools/kaif-testrun-lint.mjs selftest       # PROVE every rule on in-memory fixtures (EN + RU):
//                                                         # mutation N reddens rule N and only N, the clean
//                                                         # report yields 0; the shipped template, unfilled, reddens
// [TESTED: 2026-09-12 · selftest 45 cases green (8 rules × 2 languages, mutation N → rule N only; "Functional run:
//  NONE" under pass → pass-without-functional-run only, under partial → clean; a bare label, the template's own
//  placeholder and "NONE (see below)" ABOVE a filled table under pass → the rule (judge of epic CL: `\s*` after the
//  colon had swallowed the newline and the table read as the value); the shipped template unfilled →
//  empty-field naming all seven fields — the bare `Hygiene:`/`Functional run:` labels are scaffold; the template
//  with only Runs filled → empty-field naming the other six); the CL probe BEFORE the rule: a hygiene-only "pass —
//  all 25 closed, all tested" report → exit 0, 0 findings (the loophole #62 measured), AFTER → red by name; the
//  origin's three earlier 2.7 reports reddened until their two lines were added by the facts of their runs;
//  sandbox suite s25 observed: two clean reports (full · NONE under partial) exit 0, nine mutations exit 1 with
//  every rule named (10 findings in 9 reports), no catalog SKIPPED, home read from .kaif/kaif.json → testdocs,
//  deployed copy — template and module arrive, an unfilled copy reddens, a hygiene-only pass reddens by name; red
//  proven on the 2.6 dist via KAIF_DIST («8 of 32») — the origin's run reports: testcases/reports/2026-09-12_polygon-2.7-TR.md
//  (epic TR) and testcases/reports/2026-09-12_polygon-2.7-CL.md (epic CL, this rule)]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const ARG = argv[1];
const EXIT_SKIPPED = 3;
const MARKER = '.kaif/kaif.json';
const DEFAULT_HOME = 'testcases';
const REPORTS_DIR = 'reports';

// ---------------------------------------------------------------------------
// The seven fields per language, in the canonical order of the template. A project whose owner
// writes in another language adds a row; the engine does not change. Rules address fields by ROLE.
export const KEYWORDS = {
  en: ['Work', 'Contour', 'Runs', 'Checks', 'Found', 'Traces', 'Verdict'],
  ru: ['Работа', 'Контур', 'Прогоны', 'Проверки', 'Найдено', 'Следы', 'Вердикт'],
};
export const ROLES = ['work', 'contour', 'runs', 'checks', 'found', 'traces', 'verdict'];
// The two lines that open Checks (2.7, epic CL; origin issue #62 — the owner-QA recounted "25 tested" as 3):
// hygiene (lint · unit · selftest · mutation) and the FUNCTIONAL RUN on the real product by the user's path,
// its result read. Never summed: a Verdict `pass` with no functional run behind it is the loophole the ticket
// measured — hygiene alone is `partial`. Keywords per language, like the fields.
export const LINES = {
  en: { hygiene: 'Hygiene', functional: 'Functional run' },
  ru: { hygiene: 'Гигиена', functional: 'Функциональный прогон' },
};
const LINE_LABELS = Object.values(LINES).flatMap((l) => [l.hygiene, l.functional]);
const LINE_LABEL_RE = new RegExp(`^\\s*(?:${LINE_LABELS.join('|')})\\s*:`, 'iu');
// Whitespace after the colon is LINE-BOUND (`[^\S\n]*`, never `\s*`): under the `u` flag `\s*` spans newlines, so an
// empty value would swallow the next non-blank line — the Checks table — as its "value" (judge of epic CL: a report with a
// bare `Functional run:` or the template's own placeholder above a filled table passed green).
const FUNCTIONAL_LINE = new RegExp(`^[^\\S\\n]*(?:${Object.values(LINES).map((l) => l.functional).join('|')})[^\\S\\n]*:[^\\S\\n]*(.*)$`, 'imu');
// NONE as the whole value or followed only by punctuation — "NONE (see below)", "нет — см. ниже" — or nothing at all;
// "None of the walked flows failed …" is a filled line, not NONE (a word after it is prose, not a qualifier).
const NONE_VALUE = /^(?:(?:none|нет|ноль|n\/a|—|-)(?:\s*$|\s*[(\[—–:;,.])|$)/iu;
const CATALOG_NAME = /^\d{4}-\d{2}-\d{2}_.+\.md$/;              // the date-first name IS the index
const MOMENT = /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/;                 // a timestamp per run
const CODE_SPAN = /`[^`\n]+`/;                                    // a command the reader can re-run
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/m;                  // one item per defect
const EXPLICIT_NONE = /(?<![\p{L}\p{N}/.])(none|zero|0|ноль|нет)(?![\p{L}\p{N}])/iu;
const VERDICT_WORD = /(?<![\p{L}\p{N}])(pass|fail|blocked|partial)(?![\p{L}\p{N}])/iu;
const SEPARATOR_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

// Scaffolding is not content: placeholders `<…>` (multi-line and one level nested — the shipped
// template's own placeholders span lines and carry `<feature>` inside), table separator rows and
// table HEADER rows (the row right above a separator). What is left must carry a LETTER: a row
// number or a bare date is not a filled field. (Judge of epic TR: the first cut stripped only
// single-line placeholders, so the unfilled template reddened for the wrong reason and a copy with
// one filled row passed green.)
const PLACEHOLDER = /<(?:[^<>]|<[^<>]*>)*>/g;
const stripScaffold = (s) => {
  const lines = s.replace(PLACEHOLDER, '').split(/\r?\n/);
  return lines.filter((l, i) => !SEPARATOR_ROW.test(l) &&
    !(/^\s*\|/.test(l) && i + 1 < lines.length && SEPARATOR_ROW.test(lines[i + 1]))).join('\n');
};
// The two labels of Checks with nothing after the colon are scaffold too (the unfilled template carries them):
// a bare `Hygiene:` is a label, not a filled field.
const hasContent = (s) => /\p{L}/u.test(stripScaffold(s).split(/\r?\n/).filter((l) => !(LINE_LABEL_RE.test(l) && /:\s*$/.test(l))).join('\n'));
// The functional-run line of Checks: absent → null; present → its value after the colon (scaffold stripped).
// Fenced code is not the line (judge of epic CL: a label hidden inside ``` … ``` satisfied the rule).
const functionalRun = (r) => { const m = FUNCTIONAL_LINE.exec(r.text('checks').replace(/```[\s\S]*?```/g, '')); return m ? m[1].trim() : null; };
const verdictIsPass = (r) => { const m = VERDICT_WORD.exec(r.text('verdict')); return !!m && m[1].toLowerCase() === 'pass'; };

// ---------------------------------------------------------------------------
// The rules — data. Each: id · test(report) → true when violated · msg(report).
// report = { name, lang, keys, fields: {role → text}, missing: [keyword…], empty: [keyword…], has(role), text(role) }
export const RULES = [
  { id: 'outside-catalog', test: (r) => !CATALOG_NAME.test(r.name),
    msg: () => 'the report is outside the date catalog — name it <YYYY-MM-DD>_<work>.md (the date-first name is the index)' },
  { id: 'missing-field', test: (r) => r.missing.length > 0,
    msg: (r) => `missing field(s): ${r.missing.join(', ')} — the seven fields are ${r.keys.join(' · ')}` },
  { id: 'empty-field', test: (r) => r.empty.length > 0,
    msg: (r) => `empty field(s): ${r.empty.join(', ')} — placeholders are not content` },
  { id: 'runs-no-command', test: (r) => r.has('runs') && !CODE_SPAN.test(r.text('runs')),
    msg: () => 'Runs carries no command in a code span — the reader must be able to re-run it' },
  { id: 'runs-no-moment', test: (r) => r.has('runs') && !MOMENT.test(r.text('runs')),
    msg: () => 'Runs carries no moment (YYYY-MM-DD HH:MM) — when did it run?' },
  { id: 'found-not-explicit', test: (r) => r.has('found') && !LIST_ITEM.test(r.text('found')) && !EXPLICIT_NONE.test(r.text('found')),
    msg: () => 'Found is neither a list of defects nor an explicit "none" — zero is a finding, silence is not' },
  { id: 'verdict-not-named', test: (r) => r.has('verdict') && !VERDICT_WORD.test(r.text('verdict')),
    msg: () => 'Verdict names none of pass · fail · blocked · partial' },
  // CL (2.7, #62): `pass` is a claim about the product; hygiene alone does not back it. The functional-run line
  // must be there and must not say NONE — NONE itself is honest (fixed, not tested); `pass` above it is the fraud.
  { id: 'pass-without-functional-run', test: (r) => verdictIsPass(r) && (functionalRun(r) === null || NONE_VALUE.test(functionalRun(r))),
    msg: (r) => `Verdict says pass while Checks ${functionalRun(r) === null ? 'carries no' : 'says NONE on the'} "${LINES[r.lang].functional}:" line — hygiene alone is partial, never pass: name what was walked on the real product, on which contour and what was READ, or write partial` },
];
export const RULE_IDS = RULES.map((r) => r.id);

// ---------------------------------------------------------------------------
// Parsing — the H2 headings of a report (`## 3. Runs`, `## Runs`, `## 3) <localized keyword> …`) and their bodies.
const roleOf = (title) => {
  for (const [lang, keys] of Object.entries(KEYWORDS))
    for (let i = 0; i < keys.length; i++)
      if (new RegExp(`^${keys[i]}(?![\\p{L}])`, 'iu').test(title)) return { lang, role: ROLES[i] };
  return null;
};

export function parseReport(name, src) {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/);
  const fields = {};
  let lang = null, cur = null, fence = false;
  for (const l of lines) {
    if (/^\s*```/.test(l)) { fence = !fence; if (cur) fields[cur] += l + '\n'; continue; }
    const m = !fence && /^##\s+(?:\d+[.)]\s*)?(.+?)\s*$/.exec(l);
    if (m) {
      const hit = roleOf(m[1]);
      if (hit) { lang = lang || hit.lang; cur = hit.role; fields[cur] = fields[cur] || ''; continue; }
      cur = null; continue;                                          // a foreign H2 — its body is nobody's
    }
    if (cur) fields[cur] += l + '\n';
  }
  lang = lang || 'en';
  const keys = KEYWORDS[lang];
  const missing = ROLES.filter((r) => !(r in fields)).map((r) => keys[ROLES.indexOf(r)]);
  const empty = ROLES.filter((r) => r in fields && !hasContent(fields[r])).map((r) => keys[ROLES.indexOf(r)]);
  return { name, lang, keys, fields, missing, empty,
           has: (role) => role in fields && hasContent(fields[role]),
           text: (role) => stripScaffold(fields[role] || '') };
}

export function lint(name, src) {
  const r = parseReport(name, src);
  return RULES.filter((rule) => rule.test(r)).map((rule) => ({ id: rule.id, msg: rule.msg(r) }));
}

// ---------------------------------------------------------------------------
function homeOf(arg) {
  if (arg) return arg;
  try {
    const j = JSON.parse(readFileSync(MARKER, 'utf8'));
    if (typeof j.testdocs === 'string' && j.testdocs.trim()) return j.testdocs.trim();
  } catch { /* no marker or unreadable — the default home stands */ }
  return DEFAULT_HOME;
}

function check(arg) {
  const home = homeOf(arg);
  const dir = join(home, REPORTS_DIR);
  const shown = dir.replace(/\\/g, '/') + '/';
  const files = existsSync(dir) && statSync(dir).isDirectory()
    ? readdirSync(dir).filter((f) => /\.md$/i.test(f) && statSync(join(dir, f)).isFile()).sort() : [];
  if (!files.length) {
    console.log(`⚠ testrun-lint SKIPPED — no reports catalog at ${shown} (home "${home}"${arg ? '' : ` — ${MARKER} → testdocs, default ${DEFAULT_HOME}/`}); nothing was judged — an unwritten report is invisible to this linter (exit ${EXIT_SKIPPED})`);
    process.exit(EXIT_SKIPPED);
  }
  let nF = 0;
  for (const f of files)
    for (const x of lint(f, readFileSync(join(dir, f), 'utf8'))) { nF++; console.log(`✖ ${shown}${f} — ${x.id}: ${x.msg}`); }
  if (nF) { console.log(`✖ testrun-lint: ${nF} finding(s) in ${files.length} report(s) under ${shown} — a run without a report in form is a run the owner cannot see`); process.exit(1); }
  console.log(`✅ testrun-lint OK — ${files.length} report(s) under ${shown}, 0 findings`);
}

// ---------------------------------------------------------------------------
// selftest — every rule proves BOTH answers on in-memory fixtures, in both shipped languages:
// mutation N reddens rule N and only N; the clean report yields 0; the shipped template, unfilled, reddens.
const CLEAN = {
  en: {
    work: 'The polygon of the deploy/update machinery against `plans/104` criteria 7–8; case set — the 24 suites of `tools/sandbox-suite.mjs`.',
    contour: 'Machinery `KAIF-CORE.mjs` + tool modules; stand — a clean checkout at `231c063`, Node v24, Windows 11; no production involved.',
    runs: '| # | Moment | Command | Exit / outcome |\n|---|---|---|---|\n| 1 | 2026-09-12 11:05 +03:00 | `npm run test:core` | 0 — all 24 suites green |',
    checks: 'Hygiene: selftest 31/31 · s25 27/27\nFunctional run: the deployed copy under s25 — `.kaif/kaif-core.mjs check` and the deployed linter run as the user of the shipment, their output READ (the warning names GOAL.md; the unfilled copy reddens)\n\n| Case | Status | Observation |\n|---|---|---|\n| s25 linter half | pass | selftest OK, bad fixture exit 1 with 7 rules named |',
    found: '- none',
    traces: '- the polygon log: `run.log` in the session scratchpad',
    verdict: 'pass — every suite green on the first run after the build.',
  },
  ru: {
    work: 'Полигон машинерии развёртывания и обновления против критериев 7–8 `plans/104`; набор кейсов — 24 свода `tools/sandbox-suite.mjs`.',
    contour: 'Машинерия `KAIF-CORE.mjs` + tool-модули; стенд — чистый чекаут `231c063`, Node v24, Windows 11; продакшена нет.',
    runs: '| # | Момент | Команда | Код / исход |\n|---|---|---|---|\n| 1 | 2026-09-12 11:05 +03:00 | `npm run test:core` | 0 — все 24 свода зелёные |',
    checks: 'Гигиена: selftest 31/31 · s25 27/27\nФункциональный прогон: развёрнутая копия под s25 — `.kaif/kaif-core.mjs check` и развёрнутый линтер запущены как пользователь поставки, вывод ПРОЧИТАН (предупреждение называет GOAL.md; незаполненная копия краснеет)\n\n| Кейс | Статус | Наблюдение |\n|---|---|---|\n| половина линтера s25 | pass | selftest OK, плохая фикстура exit 1 с 7 правилами |',
    found: 'ноль',
    traces: '- лог полигона: `run.log` в скретчпаде сессии',
    verdict: 'pass — все своды зелёные с первого прогона после сборки.',
  },
};
// Each mutation is a role → replacement body (null = drop the section); the name mutation is separate.
const MUTATIONS = {
  en: {
    'missing-field': ['contour', null],
    'empty-field': ['contour', '<the stand it ran on>'],
    'runs-no-command': ['runs', '| 1 | 2026-09-12 11:05 +03:00 | ran the polygon by hand | 0 |'],
    'runs-no-moment': ['runs', '| 1 | this morning | `npm run test:core` | 0 |'],
    'found-not-explicit': ['found', 'We looked at the output and everything seemed fine.'],
    'verdict-not-named': ['verdict', 'Everything went well, no worries.'],
    'pass-without-functional-run': ['checks', 'Hygiene: unit 5/5 · selftest 14/14 · mutation K4 2 red on target\n\n| Case | Status | Observation |\n|---|---|---|\n| unit | pass | 5/5 |'],
  },
  ru: {
    'missing-field': ['contour', null],
    'empty-field': ['contour', '<стенд, на котором гоняли>'],
    'runs-no-command': ['runs', '| 1 | 2026-09-12 11:05 +03:00 | гоняли полигон руками | 0 |'],
    'runs-no-moment': ['runs', '| 1 | утром | `npm run test:core` | 0 |'],
    'found-not-explicit': ['found', 'Смотрели вывод, всё выглядело спокойно.'],
    'verdict-not-named': ['verdict', 'Всё прошло хорошо.'],
    'pass-without-functional-run': ['checks', 'Гигиена: юнит 5/5 · селфтест 14/14 · мутация К4 2 красных адресно\n\n| Кейс | Статус | Наблюдение |\n|---|---|---|\n| юнит | pass | 5/5 |'],
  },
};
// The second skin of the same rule — the line is there and says NONE — and the legal pair beside it: NONE with `partial`.
const NONE_LINE = { en: 'Hygiene: unit 5/5\nFunctional run: NONE', ru: 'Гигиена: юнит 5/5\nФункциональный прогон: NONE' };
// Judge of epic CL: the label with NO value above a filled table, and the template's own placeholder above it, must not
// read as a filled line — the whitespace after the colon is line-bound.
const TABLE = { en: '\n\n| Case | Status | Observation |\n|---|---|---|\n| unit | pass | 5/5 |', ru: '\n\n| Кейс | Статус | Наблюдение |\n|---|---|---|\n| юнит | pass | 5/5 |' };
const BARE_LINE = { en: 'Hygiene: unit 5/5\nFunctional run:' + TABLE.en, ru: 'Гигиена: юнит 5/5\nФункциональный прогон:' + TABLE.ru };
const PLACEHOLDER_LINE = { en: 'Hygiene: unit 5/5\nFunctional run: <what was walked · on which contour · what was READ — or NONE>' + TABLE.en,
                           ru: 'Гигиена: юнит 5/5\nФункциональный прогон: <что пройдено · на каком контуре · что ПРОЧИТАНО — или NONE>' + TABLE.ru };
const NONE_PREFIX_LINE = { en: 'Hygiene: unit 5/5\nFunctional run: NONE (see below)' + TABLE.en, ru: 'Гигиена: юнит 5/5\nФункциональный прогон: нет (см. ниже)' + TABLE.ru };
// …and a real line that merely STARTS with the word is content, never NONE (judge of epic CL: "None of the flows failed").
const NONE_WORD_CONTENT = { en: 'Hygiene: unit 5/5\nFunctional run: None of the 12 walked flows failed — stage, as the user, every screen read' + TABLE.en,
                            ru: 'Гигиена: юнит 5/5\nФункциональный прогон: нет ни одного упавшего из 12 пройденных путей — стейдж, как пользователь, каждый экран прочитан' + TABLE.ru };
const PARTIAL_VERDICT = { en: 'partial — fixed, not tested: hygiene green, no functional run yet.', ru: 'partial — починено, не протестировано: гигиена зелёная, функционального прогона ещё не было.' };
const CLEAN_NAME = '2026-09-12_polygon.md';
const render = (lang, bodies) => {
  const keys = KEYWORDS[lang];
  let out = `# Test run report — polygon\n\n**Created:** 2026-09-12 11:20 +03:00\n\n`;
  ROLES.forEach((role, i) => { if (bodies[role] === null) return; out += `## ${i + 1}. ${keys[i]}\n\n${bodies[role]}\n\n`; });
  return out;
};

function selftest() {
  let failed = 0, cases = 0;
  const say = (ok, name) => { cases++; if (!ok) { failed++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`); };
  for (const lang of Object.keys(CLEAN)) {
    const clean = lint(CLEAN_NAME, render(lang, CLEAN[lang]));
    say(clean.length === 0, `${lang}: clean report — 0 findings${clean.length ? ' (got ' + clean.map((x) => x.id).join(',') + ')' : ''}`);
    const outside = lint('smoke.md', render(lang, CLEAN[lang])).map((x) => x.id);
    say(outside.length === 1 && outside[0] === 'outside-catalog', `${lang}: mutation outside-catalog → exactly [outside-catalog] (got [${outside.join(',')}])`);
    for (const id of RULE_IDS) {
      if (id === 'outside-catalog') continue;
      const mut = MUTATIONS[lang][id];
      say(!!mut, `${lang}: rule ${id} has a mutation`);
      if (!mut) continue;
      const got = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], [mut[0]]: mut[1] })).map((x) => x.id);
      say(got.length === 1 && got[0] === id, `${lang}: mutation ${id} → exactly [${id}] (got [${got.join(',')}])`);
    }
    // CL (#62): the line present and saying NONE under a `pass` → the same rule; NONE under `partial` → clean.
    const none = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], checks: NONE_LINE[lang] })).map((x) => x.id);
    say(none.length === 1 && none[0] === 'pass-without-functional-run', `${lang}: "Functional run: NONE" under pass → exactly [pass-without-functional-run] (got [${none.join(',')}])`);
    const partial = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], checks: NONE_LINE[lang], verdict: PARTIAL_VERDICT[lang] })).map((x) => x.id);
    say(partial.length === 0, `${lang}: "Functional run: NONE" under partial → clean — fixed, not tested, said honestly (got [${partial.join(',')}])`);
    for (const [name, body] of [['bare label above a filled table', BARE_LINE[lang]], ["the template's own placeholder above a filled table", PLACEHOLDER_LINE[lang]], ['"NONE (see below)" — NONE as the first word', NONE_PREFIX_LINE[lang]]]) {
      const got = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], checks: body })).map((x) => x.id);
      say(got.length === 1 && got[0] === 'pass-without-functional-run', `${lang}: ${name} under pass → exactly [pass-without-functional-run] (got [${got.join(',')}])`);
    }
    const wordContent = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], checks: NONE_WORD_CONTENT[lang] })).map((x) => x.id);
    say(wordContent.length === 0, `${lang}: a filled line that merely starts with the word none/нет under pass → clean (got [${wordContent.join(',')}])`);
    const fenced = lint(CLEAN_NAME, render(lang, { ...CLEAN[lang], checks: '```\n' + LINES[lang].functional + ': walked, read\n```' + TABLE[lang] })).map((x) => x.id);
    say(fenced.length === 1 && fenced[0] === 'pass-without-functional-run', `${lang}: the label only inside a code fence under pass → exactly [pass-without-functional-run] (got [${fenced.join(',')}])`);
  }
  // A report whose headings are recognised in neither language names all seven fields missing.
  const foreign = lint(CLEAN_NAME, '# Report\n\n## Summary\n\nfine\n').map((x) => x.id);
  say(foreign.length === 1 && foreign[0] === 'missing-field', `unrecognised headings → [missing-field] naming all seven (got [${foreign.join(',')}])`);
  // The shipped template, copied unfilled, reddens — placeholders are not content.
  const here = dirname(fileURLToPath(import.meta.url));
  const tmpl = [join(here, '..', '_testrun-report-template.md'), join(here, '..', 'templates', '_testrun-report-template.md')].find((p) => existsSync(p));
  if (tmpl) {
    const text = readFileSync(tmpl, 'utf8');
    const got = lint(CLEAN_NAME, text);
    const allSeven = got.length === 1 && got[0].id === 'empty-field' && KEYWORDS.en.every((k) => got[0].msg.includes(k));
    say(allSeven, `the shipped template, unfilled → exactly [empty-field] naming all seven fields (got [${got.map((x) => x.id).join(',')}])`);
    // One filled field is not a report: the copy with a real Runs row and nothing else names the other six.
    const runsOnly = text.replace(/## 3\. Runs[\s\S]*?(?=## 4\. )/, `## 3. Runs\n\n${CLEAN.en.runs}\n\n`);
    const six = lint(CLEAN_NAME, runsOnly);
    say(six.length === 1 && six[0].id === 'empty-field' && !six[0].msg.includes('Runs') &&
        KEYWORDS.en.filter((k) => k !== 'Runs').every((k) => six[0].msg.includes(k)),
      `the template with only Runs filled → [empty-field] naming the other six (got [${six.map((x) => x.id).join(',')}])`);
  } else console.log('  · the shipped template is not beside the module — its unfilled-copy proof skipped (not a failure)');
  if (failed) { console.error(`✖ testrun-lint selftest: ${failed} of ${cases} case(s) FAILED`); process.exit(1); }
  console.log(`✅ testrun-lint selftest OK — ${cases} cases, ${RULE_IDS.length} rules × ${Object.keys(CLEAN).length} languages, every rule red on its mutation only and silent on the clean report`);
}

if (CMD === 'check') check(ARG);
else if (CMD === 'selftest') selftest();
else { console.error('usage: node .kaif/tools/kaif-testrun-lint.mjs check [home] | selftest'); process.exit(1); }
