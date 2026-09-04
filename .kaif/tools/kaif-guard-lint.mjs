#!/usr/bin/env node
// kaif-guard-lint.mjs — the OPTIONAL guard-declaration linter (2.5, epic CN; TESTING_FRAMEWORK.md
// gate 5, second half — origin issue #35). Deployed to .kaif/tools/.
//
// What it mechanizes: A GUARD DECLARES WHAT IT IS PROVED AGAINST. Four field guards in one evening
// were green and mutation-proven — each against the failure that was convenient to simulate, none
// against the real threat; the machine froze and the fuse recorded nothing. Gate 5 ("a check that
// has never failed proves nothing") was satisfied in all four cases and was not enough. So the
// author of a guard writes a greppable block next to it, and this linter reds when a field is
// missing or empty, or when a forensic recorder declares a durability the canon rejects:
//
//   @guard <name>       THREAT · PROVED-AGAINST · GAP · ON-REAL-PATH   (ON-REAL-PATH "NOT YET" is
//                       legal and visible: such a guard is not DONE — BUG_FIXING_FRAMEWORK → Guards)
//   @forensic <name>    EXPLAINS · DURABLE-AT   (values close | exit | trip-only are REJECTED:
//                       evidence durable only at a clean ending does not survive the event)
//   @fork <name>        OPTIONS · COST · RECON · DECIDED   (the FORK artifact when a fork is
//                       recorded in code rather than in the chat — PHILOSOPHY.md → the fourth door)
//
// Boundaries, so the linter never becomes bureaucracy (the donor deployment's field lesson):
//   · fires ONLY on explicit markers — it never guesses what a guard is and never walks code with
//     heuristics (a guessing linter reds on healthy code, and that has been paid for);
//   · never walks .git / node_modules / .kaif / vendored trees;
//   · ADVISORY: exit 1 = findings, exit 0 = scanned and clean, exit 3 = SKIPPED (no markers found —
//     "not scanned" must never read as "clean", the bug-34 class).
//
// Rules are DATA (the "one engine + rules-as-data" architecture, owner decision #73): a new marker
// kind or a new rejected value is a table row, not a new script.
//
// Commands:
//   node .kaif/tools/kaif-guard-lint.mjs check [paths…]   # default: the whole tree minus excluded dirs
//   node .kaif/tools/kaif-guard-lint.mjs selftest         # PROVE every rule: red on its own bad fixture,
//                                                         # silent on the clean block (both answers)
// [TESTED: 2026-09-04 · observed in the sandbox polygon (npm run test:core, "all 15 suites green"):
//  selftest 8 cases green; s15 proves exit 1 on @guard-without-GAP + @forensic DURABLE-AT: close with
//  both named, exit 0 on the clean block with "NOT YET" visible, exit 3 (SKIPPED) on a marker-less tree]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const CMD = argv[0] || 'check';
const PATHS = argv.slice(1);
const EXIT_SKIPPED = 3;

// ---------------------------------------------------------------------------
// The rules — data. `required` names the fields a marker must carry (order is irrelevant, presence
// and non-emptiness are not); `rejected` names values the canon forbids for a field.
export const RULES = {
  guard:    { required: ['THREAT', 'PROVED-AGAINST', 'GAP', 'ON-REAL-PATH'], rejected: {} },
  forensic: { required: ['EXPLAINS', 'DURABLE-AT'],
              rejected: { 'DURABLE-AT': ['close', 'exit', 'trip-only'] } },
  fork:     { required: ['OPTIONS', 'COST', 'RECON', 'DECIDED'], rejected: {} },
};
// A marker is the FIRST thing on its line (after an optional comment opener): a marker mentioned
// mid-sentence — a test-case name, prose about the linter, a placeholder like `@guard <name>` —
// is not a declaration. Judge-caught on the linter's own source: its selftest names ("full @guard
// block is clean") were read as four half-declared guards.
const MARKER = /^\s*(?:\/\/|#|\*|\/\*|<!--|--|;)?\s*@(guard|forensic|fork)\s+([\w.:/-]+)/;
// A field line inside a comment of any syntax: `THREAT: …`, `// GAP: …`, `* DURABLE-AT: …`, `# …`.
const FIELD = /^\s*(?:\/\/|\*|#|--|;|<!--|\/\*)?\s*([A-Z][A-Z-]+):\s*(.*?)\s*(?:\*\/|-->)?\s*$/;
// A block ends at the first line that carries neither a field nor a continuation of the previous
// field (a continuation is an indented text line with no `KEY:`), or after this many lines.
const BLOCK_WINDOW = 16;
// Fixture trees are skipped by name: a deliberately broken block in a test fixture is the test's
// material, not a declaration of the project's guards.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.kaif', 'dist', 'vendor', '.venv', 'venv', '__pycache__', 'sandbox', 'fixtures']);
const TEXT_EXT = /\.(mjs|cjs|js|ts|tsx|jsx|py|go|rs|java|kt|cs|c|cc|cpp|h|hpp|sh|ps1|rb|php|swift|lua|sql|yaml|yml|toml|md)$/i;

/** Parse one file's text → the declared blocks with their findings. Pure: no disk. */
export function lintText(text, file = '<text>') {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(MARKER);
    if (!m) continue;
    const kind = m[1], name = m[2], rule = RULES[kind];
    const fields = {};
    let last = null;
    for (let j = i + 1; j < lines.length && j <= i + BLOCK_WINDOW; j++) {
      const f = lines[j].match(FIELD);
      if (f) { fields[f[1]] = f[2]; last = f[1]; continue; }
      const cont = /^\s*(?:\/\/|\*|#|--|;)?\s{2,}\S/.test(lines[j]) && last && !MARKER.test(lines[j]);
      if (cont) { fields[last] = (fields[last] + ' ' + lines[j].replace(/^\s*(?:\/\/|\*|#|--|;)?\s*/, '')).trim(); continue; }
      break;
    }
    const findings = [];
    for (const key of rule.required) {
      if (!(key in fields)) findings.push(`missing ${key}`);
      else if (!fields[key]) findings.push(`empty ${key}`);
    }
    for (const [key, bad] of Object.entries(rule.rejected)) {
      const v = (fields[key] || '').toLowerCase();
      if (v && bad.includes(v)) findings.push(`${key}: "${fields[key]}" is a rejected value (evidence durable only at a clean ending is not evidence)`);
    }
    blocks.push({ file, line: i + 1, kind, name, fields, findings });
  }
  return blocks;
}

function walk(dir, out) {
  for (const n of readdirSync(dir)) {
    if (SKIP_DIRS.has(n)) continue;
    const p = join(dir, n);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(n)) out.push(p);
  }
  return out;
}

function check() {
  const roots = PATHS.length ? PATHS : ['.'];
  const files = [];
  for (const r of roots) {
    if (!existsSync(r)) { console.error(`✖ path not found: ${r}`); process.exit(1); }
    if (statSync(r).isDirectory()) walk(r, files); else files.push(r);
  }
  let blocks = 0, findings = 0, notYet = 0;
  for (const f of files) {
    let text; try { text = readFileSync(f, 'utf8'); } catch { continue; }
    if (!/^\s*(?:\/\/|#|\*|\/\*|<!--|--|;)?\s*@(guard|forensic|fork)\s/m.test(text)) continue;
    for (const b of lintText(text, f)) {
      blocks++;
      if ((b.fields['ON-REAL-PATH'] || '').toUpperCase().startsWith('NOT YET')) notYet++;
      for (const x of b.findings) { findings++; console.log(`✖ ${b.file}:${b.line} — @${b.kind} ${b.name}: ${x}`); }
    }
  }
  if (blocks === 0) {
    console.log(`⚠ guard-lint SKIPPED — no @guard / @forensic / @fork markers in ${files.length} file(s); nothing was linted (exit ${EXIT_SKIPPED})`);
    process.exit(EXIT_SKIPPED);
  }
  if (findings) { console.log(`✖ guard-lint: ${findings} finding(s) in ${blocks} declared block(s) — a guard without its declared threat is proved against nothing`); process.exit(1); }
  console.log(`✅ guard-lint OK — ${blocks} declared block(s) in ${files.length} file(s)` + (notYet ? `; ${notYet} guard(s) still ON-REAL-PATH: NOT YET — declared, not DONE` : ''));
}

// ---------------------------------------------------------------------------
// selftest — every rule proves BOTH answers on in-memory fixtures (no disk, no repo).
function selftest() {
  const cases = [
    ['full @guard block is clean', `// @guard fuse\n// THREAT: machine freeze\n// PROVED-AGAINST: process kill on the twin\n// GAP: the twin cannot freeze its host\n// ON-REAL-PATH: NOT YET\n`, []],
    ['@guard missing GAP reds and names it', `// @guard fuse\n// THREAT: machine freeze\n// PROVED-AGAINST: process kill\n// ON-REAL-PATH: NOT YET\n`, ['missing GAP']],
    ['@guard with an empty THREAT reds', `# @guard ring\n# THREAT:\n# PROVED-AGAINST: readback\n# GAP: none\n# ON-REAL-PATH: 2026-08-30 live sweep\n`, ['empty THREAT']],
    ['@forensic DURABLE-AT close is rejected', `/* @forensic ring\n * EXPLAINS: the judge at the moment of death\n * DURABLE-AT: close\n */`, ['DURABLE-AT: "close" is a rejected value']],
    ['@forensic DURABLE-AT every-second is clean', `// @forensic ring\n// EXPLAINS: the judge at the moment of death\n// DURABLE-AT: every-second\n`, []],
    ['@fork missing RECON reds', `// @fork ring-dump\n// OPTIONS: per tick | on close | 1 s aggregate\n// COST: zero bytes of evidence if wrong\n// DECIDED: 1 s aggregate\n`, ['missing RECON']],
    ['continuation lines belong to the previous field', `// @guard x\n// THREAT: machine freeze\n//   during the descent\n// PROVED-AGAINST: kill\n// GAP: none\n// ON-REAL-PATH: NOT YET\n`, []],
    ['a marker-less text yields no blocks', `const a = 1; // nothing declared here\n`, null],
  ];
  let failed = 0;
  for (const [name, text, expect] of cases) {
    const blocks = lintText(text, 'fixture');
    let pass;
    if (expect === null) pass = blocks.length === 0;
    else {
      const got = blocks.flatMap((b) => b.findings);
      pass = blocks.length === 1 && got.length === expect.length && expect.every((e) => got.some((g) => g.startsWith(e)));
    }
    console.log((pass ? '✅ ' : '❌ ') + name + (pass ? '' : ' — got: ' + JSON.stringify(blocks.map((b) => b.findings))));
    if (!pass) failed++;
  }
  if (failed) { console.error(`✖ guard-lint selftest: ${failed} of ${cases.length} case(s) FAILED`); process.exit(1); }
  console.log(`✅ guard-lint selftest OK — ${cases.length} cases, every rule red on its fixture and silent on the clean block`);
}

if (CMD === 'check') check();
else if (CMD === 'selftest') selftest();
else { console.error(`usage: node .kaif/tools/kaif-guard-lint.mjs check [paths…] | selftest`); process.exit(1); }
