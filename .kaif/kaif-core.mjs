#!/usr/bin/env node
// KAIF-CORE.mjs — the heavy KAIF installer machinery (thin-install architecture; version-neutral:
// the deployed version lives in the bundle manifest and .kaif/kaif.json, never in this header —
// a baked-in version here shipped stale twice, bug 10).
// Downloaded by KAIF-LOADER.mjs from the origin repo; does EVERYTHING mechanizable
// about deploying KAIF so the AI agent's cognitive work shrinks to one short final
// adaptation task. Successor of kaif-unpack.mjs (which stays embedded in the
// offline KAIF-FULL.md); this file lives on at .kaif/kaif-core.mjs after install
// and backs the kaif:* npm handles (version/check).
//
// Commands (a bare or flags-only run prints `help` and touches NOTHING — bug 33; the full list
// with one-liners lives in the COMMANDS spec at the end of this file and in `help`):
//   node kaif-core.mjs help                        # the command list (also the bare-run default)
//   node kaif-core.mjs install --bundle <KAIF-CORE-BUNDLE.md> [options]
//   node kaif-core.mjs check                       # validate the deployed manifest (bundle must still exist)
//   node kaif-core.mjs verify-final                # checkpoints done? then self-clean the install artifacts
//   node kaif-core.mjs sync                        # re-sync per-system skill mirrors from .claude/skills/
//   node kaif-core.mjs diff [--source <x>]         # audit disk vs deployed templates | preview vs another version
//   node kaif-core.mjs adopt-current               # rebuild the snapshot after a MANUAL migration
//   node kaif-core.mjs version                     # report the deployed version from .kaif/kaif.json
// Unknown commands, flags and stray arguments REFUSE (exit 1) instead of being silently
// ignored — a plausible-but-wrong run is the most expensive kind (bug 33, project D Г10).
//
// Install options:
//   --lang <code>       owner's working language (default: en). Owner-facing docs come from the
//                       bundle's language templates when present; otherwise English + a translation
//                       item in the adaptation task.
//   --mode <m>          standard (default) | anonymous — anonymous skips origin-tied skills and
//                       writes no origin field (anonymity by design; no prose scrubbing needed).
//   --agents <list>     comma list to narrow the target systems (default: all five:
//                       claude-code,codex,grok-build,cline,zoo-code). AGENTS.md is always written.
//   --force             overwrite existing non-empty files.
//
// Exit code 0 = the step is 100% satisfied; non-zero = incomplete (fix and re-run).
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------- CLI
const args = process.argv.slice(2);
// A bare or flags-only run means HELP, never install (bug 33 — THE field data loss: a curious
// bare run defaulted to `install` and overwrote a live update task; the loader always names
// `install` explicitly, so nothing legitimate relied on the old default).
const IMPLICIT_CMD = !args[0] || args[0].startsWith('-');
const CMD = IMPLICIT_CMD ? 'help' : args[0];
const val = (f) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
const has = (f) => args.includes(f);

const BUNDLE = val('--bundle') || '.kaif/install/KAIF-CORE-BUNDLE.md';
// LANG/AGENTS/MODE are `let`: post-install commands inherit them from the project's
// .kaif/kaif.json unless explicitly overridden on the CLI (see below for MODE/ANON).
let LANG = (val('--lang') || 'en').toLowerCase();
let MODE = (val('--mode') || 'standard').toLowerCase();
let ANON = MODE === 'anonymous';
const FORCE = has('--force');
const ALL_AGENTS = ['claude-code', 'codex', 'grok-build', 'cline', 'zoo-code'];
let AGENTS = (val('--agents') || ALL_AGENTS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const ORIGIN = 'https://github.com/MikalaiKryvusha/KAIF';
// Skills skipped on anonymous installs. kaif-version included since 1.5: its template
// references the origin repo, and anonymity is BY DESIGN now — the version stays readable
// in .kaif/kaif.json directly.
const ORIGIN_TIED = ['kaif-update', 'kaif-switch-origin', 'kaif-fork', 'kaif-version'];
// Author identity tokens, grouped in transliteration CLUSTERS: anonymous installs strip marked
// regions, de-expand the brand acronym, and the final gates grep the DEPLOYED paths for these.
// Clusters matter because the scan must excuse the PROJECT OWNER's own name across scripts:
// an owner named Кривуша writes Latin "Kryvusha" into git config — both spellings are his,
// neither is a leak (bug 13, field blocker: 44 false hits froze an update).
const AUTHOR_TOKEN_CLUSTERS = [['Kryvusha', 'Кривуша', 'MikalaiKryvusha'], ['KRINIK', 'Krinik', 'Криник']];
const ACRONYM_EXPANSIONS = ['KAIF (Krinik AI Framework)', 'Krinik AI Framework (KAIF)', 'Krinik AI Framework'];
const KAIF_JSON = '.kaif/kaif.json';
const DEPLOY_MANIFEST = '.kaif/deploy-manifest.json'; // persisted path list — `check` works after the bundle is cleaned
const TASK_FILE = 'KAIF_ADAPTATION_TASK.md';
const FENCE = '`'.repeat(6);

// The canonical deploy-time placeholders (KAIF.md §11). CORE fills what it can
// detect mechanically; the rest lands in the adaptation task for the agent.
const PLACEHOLDERS = ['<PROJECT_NAME>', '<SHORT_NAME>', '<AUTHOR>', '<REPO_URL>', '<LOCAL_PATH>',
                      '<LICENSE>', '<BUILD_COMMAND>', '<TEST_HARNESS>', '<COMMIT_COMMAND>', '<YOUR AGENT/MODEL>',
                      "<YOUR AGENT'S noreply EMAIL>",   // bug 28: shipped by /end-chat, was invisible to the gate
                      '<OWNER_LANGUAGE>'];

// Docs seeded/owned by the OWNER after deploy — an update never touches them and never
// even lists them as "diverged" (their divergence is the whole point of their existence).
const OWNER_SEEDED = ['GOAL.md', 'STATUS.md', 'PROJECT_HISTORY.md', 'EXPERIENCE.md', 'MASTER_PLAN.md',
  'PROJECT_STRUCTURE_EXTERNAL_MAP.md', 'PROJECT_ARCHITECTURE_INTERNAL_MAP.md', 'KAIF_FRAMEWORK.md'];
// Where update fetches the fresh machinery from (mirrors KAIF-LOADER.mjs).
const SOURCES = { release: `${ORIGIN}/releases/latest/download`,
                  main: 'https://raw.githubusercontent.com/MikalaiKryvusha/KAIF/main/dist' };
const UPDATE_TASK = 'KAIF_UPDATE_TASK.md';
// The owner's soft target for STATUS.md length (decision #27, 2.1): a SUMMARY of "now", not a
// chronicle; `check` warns above this (bugs/37 — the promised guard now exists as code).
const STATUS_SOFT_LINES = 200;

const log = (s) => console.log(s);
const die = (s) => { console.error('✖ ' + s); process.exit(1); };
const okOnDisk = (p) => existsSync(p) && statSync(p).size > 0;
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const fileSha = (p) => sha256(readFileSync(p));
const sh = (cmd) => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
// JSON reader tolerant of a UTF-8 BOM (Windows tools like PowerShell 5 write one).
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));

// Anonymity is a property of the DEPLOYMENT, not of the CLI call (bug 11 / GH issue #1,
// reproduced by three field reports): a bare `check` on an anonymous install reported the
// deliberately-skipped origin-tied skills as MISSING, and the red gate pushed weak models
// toward "fixing" it by deploying them — breaking anonymity. When --mode is not passed,
// inherit `tracking` from the deployed marker — the same pattern `check` already uses for agents.
// [TESTED: 2026-07-27 · sandbox S2: bare `check` green on an anonymous install with the bundle
// alive; explicit `--mode standard` still red (CLI override wins)]
if (!val('--mode') && okOnDisk(KAIF_JSON)) {
  try { if (readJson(KAIF_JSON).tracking === 'anonymous') { MODE = 'anonymous'; ANON = true; } }
  catch { /* unreadable marker — the CLI default stands */ }
}

// ---------------------------------------------------------------------------- modules (plan 21)
// A MODULE is a logical section of a template — the atom of diffing and replacement (KAIF 2.0).
// The splitter/classifier MIRROR tools/module-map-lib.mjs at the origin (the core must stay one
// self-contained file); the build's check pins the two implementations behaviorally: the `modules`
// command output must equal dist/kaif-module-map.json for the same bundle.
const normEol = (s) => s.replace(/\r\n/g, '\n');
const normSha = (data) => sha256(normEol(String(data)));           // EOL-normalized sha: CRLF never
const fileShaNorm = (p) => normSha(readFileSync(p, 'utf8'));       // fakes a divergence (bug 12)

function splitModules(content) {
  const lines = content.split('\n');
  const modules = [];
  let cur = { signature: '<preamble>', lines: [] };
  let inFence = false;
  for (const line of lines) {
    if (/^(`{3,}|~{3,})/.test(line.trim())) inFence = !inFence;    // headings inside fences are not anchors
    if (!inFence && /^#{1,3} /.test(line)) { modules.push(cur); cur = { signature: line, lines: [] }; }
    cur.lines.push(line);
  }
  modules.push(cur);
  return modules.filter((m) => m.signature !== '<preamble>' || m.lines.join('').length > 0);
}
const joinModules = (mods) => mods.flatMap((m) => m.lines).join('\n');
const modText = (m) => m.lines.join('\n');

// Computed classes (plan 21 §3.1): owner files are never in scope; a module carrying a canonical
// placeholder (or a skill frontmatter) is adaptive — replaced WITH value transfer; the rest is
// static — upstream-owned, mechanically replaceable. `overrides` ship in the bundle meta.
function classifyModule(dest, mod, overrides) {
  const eff = dest.replace(/^templates\/languages\/[^/]+\//, '');
  const o = (overrides || {})[eff] || (overrides || {})[dest];
  if (o && o.modules && o.modules[mod.signature]) return o.modules[mod.signature];
  if (o && o.default) return o.default;
  if (OWNER_SEEDED.includes(eff)) return 'owner';
  const text = modText(mod);
  if (PLACEHOLDERS.some((ph) => text.includes(ph))) return 'adaptive';
  if (mod.signature === '<preamble>' && /^\.claude\/skills\//.test(eff) && /^description:/m.test(text)) return 'adaptive';
  return 'static';
}
const moduleEntries = (dest, content, overrides) => splitModules(content).map((m) => ({
  signature: m.signature, class: classifyModule(dest, m, overrides), sha256: normSha(modText(m)) }));

// The owner's writing system, for the localization safety net (decision #17): a disk module in
// the owner's script must never be silently replaced by a template that carries none of it.
const SCRIPTS = { ru: /[А-Яа-яЁё]/, uk: /[А-Яа-я]/, be: /[А-Яа-я]/, 'zh-hans': /[一-鿿]/,
                  zh: /[一-鿿]/, ja: /[぀-ヿ一-鿿]/, ar: /[؀-ۿ]/,
                  hi: /[ऀ-ॿ]/ };

// SCRIPTS answers "is the owner's writing system present" — exact, cheap, and blind BY
// CONSTRUCTION for every language written in the Latin alphabet. Four Latin packs SHIP (de, es,
// fr, pt) and none of them had a row, so a German deployment had no protection at all: the
// wholesale net, the per-file freeze, the automatic `i18n` flag and the audit's `localized` class
// were every one of them off (bugs/66 №3). The table cannot be completed for those languages,
// because their writing system IS Latin — so the property has to be MEASURED, not looked up.
//
// The second axis measures what the net actually needs: does this text still speak the template's
// language? Prose-vocabulary overlap — the share of the disk's distinct words that also occur in
// the incoming template. Measured on the source repository before the threshold was chosen:
//   de/es/fr/pt packs vs their English source        0.059 … 0.346   (32 files)
//   English disk 2 releases old vs today's template  0.985 … 1.000   (11 files × v2.0 and v2.1)
// The threshold sits inside that gap, far from both sides. The axis runs ONLY where the table is
// silent AND the deployment is not English, so an English project keeps its previous behaviour
// byte for byte; and it errs toward "localized", i.e. toward KEEPING the owner's file, which is
// the safe direction for a net whose whole purpose is "no silent English takeover".
const OVERLAP_LOCALIZED_BELOW = 0.6;
const OVERLAP_MIN_WORDS = 12;      // below this a body carries no evidence either way — abstain
const PROSE_WORD = /[\p{L}][\p{L}\p{M}'-]{2,}/gu;
const distinctWords = (t) => new Set(String(t).toLowerCase().match(PROSE_WORD) || []);
function proseOverlap(diskText, newText) {
  const disk = distinctWords(diskText);
  if (disk.size < OVERLAP_MIN_WORDS) return 1;          // no evidence → reads as the template
  const tpl = distinctWords(newText);
  let shared = 0;
  for (const w of disk) if (tpl.has(w)) shared++;
  return shared / disk.size;
}
function localizedAgainst(diskText, newText) {
  const re = SCRIPTS[LANG];
  if (re) return re.test(diskText) && !re.test(newText);
  if (!LANG || LANG === 'en') return false;
  return proseOverlap(diskText, newText) < OVERLAP_LOCALIZED_BELOW;
}

// The whole-file variant of the test is BLIND on skills (bug 31): machinery-appended trigger
// aliases put the owner's script into every frontmatter on BOTH sides, so no skill ever read as
// "translated" and the i18n flag protected nothing. Judge "is this file a translation" by the
// BODY only — the modules below the preamble.
function bodyLocalized(diskText, newText) {
  const body = (t) => splitModules(normEol(t)).filter((m) => m.signature !== '<preamble>').map(modText).join('\n');
  return localizedAgainst(body(diskText), body(newText));
}

// The alias tail applyLanguage appends to a skill's description is MACHINERY's, not the owner's:
// frontmatter comparisons must ignore it, or a trigger-pack change between versions makes every
// skill's preamble read as owner-edited forever — and an updated `description` never reaches the
// disk while the body merges on, leaving one file with two contradicting claims (bug 43,
// project D /dayloop: the routing field kept asserting the OLD rule the merged body had dropped).
const stripAliasTail = (t) => t.replace(/ Trigger aliases \([a-zA-Z-]+\): [^\n]*/g, '');

// A real translation keeps some TERM headings untranslated (project C field: KISS and DRY survived —
// 2 of PHILOSOPHY's 21), so the wholesale net tolerates up to this share of surviving base
// signatures instead of the old absolute "≤1" that read every real translation as English (bug 31).
const WHOLESALE_SURVIVOR_SHARE = 0.15;

// A tiny line-level LCS diff — modules are small (median 9 lines), so O(n·m) is nothing.
// Renders the "old template → new template" delta the field asked for in 7 of 8 reports.
function lineDiff(oldText, newText) {
  const a = oldText.split('\n'), b = newText.split('\n');
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push('  ' + a[i]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { out.push('- ' + a[i]); i++; }
    else { out.push('+ ' + b[j]); j++; }
  }
  while (i < a.length) out.push('- ' + a[i++]);
  while (j < b.length) out.push('+ ' + b[j++]);
  return out.join('\n');
}

// Ignore-first (canon 1.6, bug 18): the transient installer artifacts enter .gitignore BEFORE
// they hit the tree, so a `git add -A` during the manual-merge window between update and
// update-verify cannot drag a 425 KB bundle into history (field-caught on project A, which trapped
// exactly that). The lines stay useful after self-clean — updates recur.
// [TESTED: 2026-08-07 · npm run test:core all 13 suites green — S1 (entries present right after
// install) + S4 (idempotent on update), re-run with the refresh-marker entry added]
function ensureIgnoreFirst() {
  const wanted = ['.kaif/install/', 'KAIF.md', 'KAIF-LOADER.mjs', TASK_FILE, UPDATE_TASK,
                  'KAIF_UPDATE_TASK.superseded.md', 'KAIF_ADAPTATION_TASK.superseded.md',
                  '.kaif/backup-*/',        // pre-update backups are rollback material, never history (field ask)
                  '.kaif/heartbeat.log',    // the guarded loop's pulse is runtime state, not history
                  '.kaif/refresh-marker.json']; // the context-refresh witness is session state, not history (AGENT_GUIDE → Context refresh)
  let text = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf8') : '';
  const have = new Set(text.split(/\r?\n/).map((s) => s.trim()));
  const add = wanted.filter((w) => !have.has(w) && !have.has(w.replace(/\/$/, '')));
  if (!add.length) return;
  writeFileSync('.gitignore', text.replace(/\s*$/, text ? '\n' : '') + add.join('\n') + '\n');
  log(`+ .gitignore: ignore-first for ${add.join(', ')}`);
}

// ---------------------------------------------------------------------------- bundle parsing
// The bundle uses the proven KAIF.md block format: `> **FILE: \`path\`** …` + 6-backtick fence.
// One special block, FILE: `kaif-bundle-manifest.json`, carries per-file metadata
// (audience/adaptation notes) and the version stamp — it is data, never written to disk.
// `loose` (plan 21 §5.5): a synthetic-baseline source may be an OLD-era artifact (KAIF-FULL.md,
// a 1.4 KAIF.md) with FILE: blocks but no bundle manifest — return what parses instead of dying.
function parseBundle(src, loose = false) {
  if (!existsSync(src)) { if (loose) return null; die(`bundle not found: ${src} (pass --bundle <path>)`); }
  const text = readFileSync(src, 'utf8');
  const re = new RegExp('^> \\*\\*FILE: `([^`]+)`\\*\\*[^\\n]*\\r?\\n\\r?\\n' + FENCE + '\\w*\\r?\\n([\\s\\S]*?)\\r?\\n' + FENCE + '\\s*$', 'gm');
  const files = [];
  for (let m; (m = re.exec(text)); ) files.push({ path: m[1], content: m[2].replace(/\r\n/g, '\n') + '\n' });
  if (!files.length) { if (loose) return null; die('no FILE: blocks found — is this a KAIF-CORE-BUNDLE.md?'); }
  const metaBlock = files.find((f) => f.path === 'kaif-bundle-manifest.json');
  if (!metaBlock) { if (loose) return { files, meta: {} }; die('bundle manifest block (kaif-bundle-manifest.json) missing'); }
  const meta = JSON.parse(metaBlock.content);
  return { files: files.filter((f) => f.path !== 'kaif-bundle-manifest.json'), meta };
}

const skillName = (p) => (p.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/) || [])[1] || null;
const isSkippedAnon = (p) => ANON && ORIGIN_TIED.includes(skillName(p) || '');

// The "N skills trigger-aliased" summary counts what is ON DISK, never what was planned
// (bugs/65 №1). The planning site (`applyLanguage`) cannot know the anonymity filter — that
// filter lives BELOW it, at the write — so an intent counter reported 35 while an anonymous
// install had written 31, and the same log four lines earlier admitted skipping the four
// ORIGIN_TIED skills. A counter incremented next to the write would drift again the moment a
// new filter appears between plan and write; reading the deployed skills back is the only
// form that cannot: the property is "the skill carries its alias line", so it is measured
// where that line either exists or does not.
const countAliasedOnDisk = () => {
  const dir = join('.claude', 'skills');
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name, 'SKILL.md');
    if (okOnDisk(p) && readFileSync(p, 'utf8').includes(`Trigger aliases (${LANG}):`)) n++;
  }
  return n;
};

// Language templates live in the bundle under templates/languages/<lang>/<dest-path>.
// For the chosen language they OVERRIDE the English default at <dest-path> (owner-facing
// docs: GOAL.md, KAIF_FRAMEWORK.md, the directory READMEs). A special member,
// templates/languages/<lang>/skill-triggers.json, maps skill → localized trigger aliases:
// the machinery appends them to each skill's `description:` line so the agent keeps
// matching commands in the owner's language while the skills stay English.
function applyLanguage(files) {
  // Case-insensitive prefix match: --lang is normalized to lowercase, but pack
  // directories may carry canonical casing (zh-Hans). Verified by the zh sandbox.
  const prefix = `templates/languages/${LANG}/`.toLowerCase();
  const overrides = new Map();
  let triggers = null;
  for (const f of files) {
    const lower = f.path.toLowerCase();
    if (!lower.startsWith(prefix)) continue;
    if (lower === prefix + 'skill-triggers.json') { try { triggers = JSON.parse(f.content); } catch { die(`bad JSON in ${f.path}`); } }
    else overrides.set(f.path.slice(prefix.length), f.content);
  }
  const out = [];
  // No alias counter lives here. The pack's key count was the first proxy (bug 34 / project C D3:
  // "34 skills trigger-aliased" while 23 carried aliases on disk); counting APPLIED rewrites here
  // was the second, and it drifted the same way as soon as the anonymity filter appeared below
  // this function (bugs/65 №1). The summary reads the deployed skills back — `countAliasedOnDisk`.
  for (const f of files) {
    if (f.path.startsWith('templates/languages/')) continue;          // templates are inputs, not outputs
    let entry = overrides.has(f.path) ? { path: f.path, content: overrides.get(f.path) } : { ...f };
    const skill = skillName(entry.path);
    if (skill && triggers && triggers[skill]) {
      entry.content = entry.content.replace(/^(description:[^\n]*?)(\s*)$/m,
        (_, d) => `${d.replace(/\s+$/, '')} Trigger aliases (${LANG}): ${triggers[skill]}`);
    }
    out.push(entry);
  }
  return { deploy: out, translated: overrides.size };
}

// The pack boundary is DECLARED at deploy time, not discovered post-factum (field: a new skill
// arrived as "a raw English body with a localized alias line glued on" and read as a defect;
// the packs are owner-doc-only BY DESIGN — the framework is English-first). One honest line
// names exactly what arrives in English and needs manual transfer if the owner wants it local.
function logPackHonesty(files, deploy) {
  if (LANG === 'en') return;
  const prefix = `templates/languages/${LANG}/`.toLowerCase();
  let hasPack = false;
  const packed = new Set();
  for (const f of files) {
    const lower = f.path.toLowerCase();
    if (!lower.startsWith(prefix)) continue;
    hasPack = true;
    if (lower !== prefix + 'skill-triggers.json') packed.add(f.path.slice(prefix.length));
  }
  if (!hasPack) return;   // no pack for this language at all — the task's `language` item owns the honesty
  const enDocs = deploy.filter((f) => f.path.endsWith('.md') && !packed.has(f.path)
    && !/^\.claude\/skills\//.test(f.path) && !f.path.startsWith('.kaif/spheres/')
    && !f.path.startsWith('templates/languages/')).map((f) => f.path).sort();
  const skills = deploy.filter((f) => skillName(f.path)).length;
  log(`⟳ language pack "${LANG}" is INCOMPLETE BY DESIGN (the framework is English-first): it localizes ${packed.size} owner doc(s). Arriving in ENGLISH and needing manual transfer if you want them localized: ${enDocs.join(', ')} + all ${skills} skill bodies (their trigger aliases ARE localized).`);
}

// ---------------------------------------------------------------------------- placeholder autofill
// Detect real project values mechanically. Undetected placeholders stay literal and
// are listed in the adaptation task (they are the agent's cognitive work, not ours).
// The project's CANONICAL name lives in the CANON — the marker's `projectName`, recorded via
// the project-name command — never in a technical identifier (field: package.json/folder names
// are lowercase tech ids and landed in H1 headings: "# acme-tool — Project History" while the
// project's own canon spelled the name differently; identity is the owner's, so it is RECORDED,
// not guessed).
function canonicalName() {
  try { const n = readJson(KAIF_JSON).projectName; if (n && String(n).trim()) return String(n).trim(); }
  catch { /* not deployed yet */ }
  return null;
}

function detectValues() {
  let pkg = null;
  try { pkg = readJson('package.json'); } catch { /* none */ }
  const dir = process.cwd().replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'project';
  const name = canonicalName() || (pkg && pkg.name) || dir;
  const licenseFile = existsSync('LICENSE') ? readFileSync('LICENSE', 'utf8').split(/\r?\n/, 1)[0].trim() : '';
  return {
    '<PROJECT_NAME>': name,
    '<SHORT_NAME>': name,
    '<AUTHOR>': sh('git config user.name') || null,
    '<REPO_URL>': sh('git remote get-url origin') || null,
    '<LOCAL_PATH>': process.cwd(),
    '<LICENSE>': (pkg && pkg.license) || licenseFile || null,
    '<BUILD_COMMAND>': pkg && pkg.scripts && pkg.scripts.build ? 'npm run build' : null,
    '<TEST_HARNESS>': pkg && pkg.scripts && pkg.scripts.test ? 'npm test' : null,
    '<COMMIT_COMMAND>': 'git add -A && git commit -m "<msg>" && git push',
    '<YOUR AGENT/MODEL>': null, // depends on the running agent — always the agent's to fill
    "<YOUR AGENT'S noreply EMAIL>": null, // same — the agent signs its own commits (bug 28)
    '<OWNER_LANGUAGE>': LANG,   // the language-policy note in AGENT_GUIDE (idea 12: two audiences, two languages)
  };
}

// Placeholder values are FROZEN at deploy time (bug 26 / field: <PROJECT_NAME> re-detected on
// every run drifted when package.json appeared later, and the drifted signature made the modular
// merge mangle the canon's H1). The deploy manifest carries the snapshot; every later pass builds
// on it and re-detects only what the deploy left unresolved.
const persistValues = (v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x));
function snapshotValues() {
  try { return okOnDisk(DEPLOY_MANIFEST) ? (readJson(DEPLOY_MANIFEST).values || {}) : {}; }
  catch { return {}; }
}
const stableValues = () => {
  const v = { ...detectValues(), ...snapshotValues() };
  // The canon outranks the frozen snapshot: recording `projectName` HEALS the placeholder map
  // on the next pass instead of freezing the tech id forever (the frozen-values doctrine of
  // bug 26 guards against re-DETECTION drift, not against the owner's explicit word).
  const canon = canonicalName();
  if (canon) {
    if (v['<SHORT_NAME>'] === v['<PROJECT_NAME>']) v['<SHORT_NAME>'] = canon;   // a distinct short form stays the owner's
    v['<PROJECT_NAME>'] = canon;
  }
  return v;
};

function fillPlaceholders(content, values, unresolved) {
  let out = content;
  for (const [ph, v] of Object.entries(values)) {
    if (!out.includes(ph)) continue;
    if (v) out = out.split(ph).join(v);
    else unresolved.add(ph);
  }
  return out;
}

// Anonymous install: strip marked author regions and de-expand the brand acronym —
// mechanically, so no cognitive "scrubbing" pass is needed (anonymity by design).
function anonymize(content) {
  let out = content.replace(/<!-- KAIF:AUTHOR-NOTE:BEGIN[\s\S]*?KAIF:AUTHOR-NOTE:END -->\n?/g, '');
  for (const exp of ACRONYM_EXPANSIONS) out = out.split(exp).join('KAIF');
  return out;
}

// ---------------------------------------------------------------------------- agent systems wiring
// Verified conventions (adapters catalog; Grok Build web-verified 2026-07-16):
//   claude-code: .claude/skills/<n>/SKILL.md (canonical layout) + CLAUDE.md context file
//   codex:       .agents/skills/<n>/SKILL.md (Agent Skills standard, copy as-is) + native AGENTS.md
//   grok-build:  .grok/skills/<n>/SKILL.md (SKILL.md standard; also auto-reads .claude/ + AGENTS.md)
//   cline:       .cline/skills/<n>/SKILL.md (≥3.48; also reads .claude/skills/) + .clinerules/kaif.md
//   zoo-code:    .roo/commands/<n>.md (drop `name:`; filename = command) + .roo/rules/kaif.md
const CONTEXT_POINTER =
  '# Agent rules\n\nThis project is KAIF-wrapped. Before every task read `AGENT_GUIDE.md` (the canon) and ' +
  '`STATUS.md` (current state); think per `PHILOSOPHY.md`; write requirements per `REQUIREMENTS_FRAMEWORK.md`; ' +
  'test per `TESTING_FRAMEWORK.md`; debug per `BUG_FIXING_FRAMEWORK.md`; execute ' +
  'tasks per the fable loop (`/fable-method`, `/fable-judge`).\n';

// Returns true when the template was actually written; false when an existing file was
// ADOPTED (kept as found). Adoption is provenance the deploy manifest must remember:
// for adopted paths the sha snapshot records the OWNER'S content, not a template — so a
// later `update` may never take "sha still matches" as permission to replace them
// (field-caught on project A, 2026-07-17: 18 owner-adapted skills silently templated over).
function writeIfNew(path, content) {
  if (okOnDisk(path) && !FORCE) { log(`= kept existing ${path}`); return false; }
  mkdirSync(dirname(path) || '.', { recursive: true });
  writeFileSync(path, content);
  log(`+ wrote ${path}`);
  return true;
}

function deployAgentSystems(skillFiles, refFiles) {
  const copies = { codex: '.agents/skills', 'grok-build': '.grok/skills', cline: '.cline/skills' };
  for (const [sys, base] of Object.entries(copies)) {
    if (!AGENTS.includes(sys)) continue;
    for (const { path, content } of skillFiles) writeIfNew(`${base}/${skillName(path)}/SKILL.md`, content);
    // skill reference files (e.g. fable-method/references/*) travel with their skill
    for (const { path, content } of refFiles) writeIfNew(path.replace('.claude/skills', base), content);
  }
  if (AGENTS.includes('zoo-code')) {
    for (const { path, content } of skillFiles)
      writeIfNew(`.roo/commands/${skillName(path)}.md`, content.replace(/^name:[^\n]*\n/m, ''));
    writeIfNew('.roo/rules/kaif.md', '# KAIF\n\nRead `AGENT_GUIDE.md` before every task; keep `STATUS.md` current. ' +
      'Skills live in `.roo/commands/` (one `/command` per KAIF skill).\n');
  }
  if (AGENTS.includes('cline')) writeIfNew('.clinerules/kaif.md', CONTEXT_POINTER);
  if (AGENTS.includes('claude-code')) writeIfNew('CLAUDE.md', CONTEXT_POINTER);
  writeIfNew('AGENTS.md', CONTEXT_POINTER); // universal fallback, always
}

// Expected per-system artifact list for validation (mirrors deployAgentSystems).
function expectedAgentArtifacts(skillNames) {
  const want = ['AGENTS.md'];
  const per = { codex: (n) => `.agents/skills/${n}/SKILL.md`, 'grok-build': (n) => `.grok/skills/${n}/SKILL.md`,
                cline: (n) => `.cline/skills/${n}/SKILL.md`, 'zoo-code': (n) => `.roo/commands/${n}.md` };
  for (const sys of AGENTS) if (per[sys]) for (const n of skillNames) want.push(per[sys](n));
  if (AGENTS.includes('zoo-code')) want.push('.roo/rules/kaif.md');
  if (AGENTS.includes('cline')) want.push('.clinerules/kaif.md');
  if (AGENTS.includes('claude-code')) want.push('CLAUDE.md');
  return want;
}

// The task's placeholder item must name REAL addresses — the static text used to send the
// agent to ".claude/skills/" while the live slots sat in a sphere library or nowhere at all
// ("the first step toward ticking boxes without looking", three field reports). The scan lists
// deployed files that LITERALLY carry each slot; foreign sphere libraries are reference
// material and never gate (only the DECLARED sphere is a working surface), so only it may appear.
function unresolvedOnDisk(unresolved, deploy) {
  let declared = null;
  try { const s = readJson(KAIF_JSON).sphere; if (s && s !== 'TODO') declared = `.kaif/spheres/${s}.md`; } catch { /* no marker yet */ }
  return [...unresolved].map((ph) => ({
    ph,
    paths: deploy.filter((f) => f.path.endsWith('.md') && okOnDisk(f.path)
      && (!f.path.startsWith('.kaif/spheres/') || f.path === declared)
      && readFileSync(f.path, 'utf8').includes(ph)).map((f) => f.path),
  })).filter((u) => u.paths.length);
}
// Honest cap per slot: name the first paths outright, count the rest (never a silent cut).
const fmtSlots = (list) => list.map((u) =>
  `${u.ph} → ${u.paths.slice(0, 6).join(', ')}${u.paths.length > 6 ? ` (+${u.paths.length - 6} more — grep it)` : ''}`).join(' · ');

// The non-machine work scopes an update must NAME (field: template-sphere sections never
// reached a locally-authored sphere; a project's own skeleton validator "knew 12 documents
// and 26 skills" two updates in a row) — computed against whatever baseline is in hand,
// silent when the baseline cannot honestly tell.
function updateScopes(old, deploy, deployedPaths, marker) {
  const oldTpl = (old && old.templateShas) || {};
  const SPHERE_TPL = '.kaif/spheres/_template.md';
  let sphereSync = null;
  const sphere = marker && marker.sphere;
  if (sphere && sphere !== 'TODO' && !deploy.some((f) => f.path === `.kaif/spheres/${sphere}.md`)
      && okOnDisk(`.kaif/spheres/${sphere}.md`) && Object.keys(oldTpl).length) {
    const tplNew = deploy.find((f) => f.path === SPHERE_TPL);
    if (tplNew && oldTpl[SPHERE_TPL] !== normSha(tplNew.content)) sphereSync = { sphere };
  }
  let skeletonDelta = null;
  const oldSkills = new Set(((old && old.paths) || []).map(skillName).filter(Boolean));
  if (oldSkills.size) {
    const newSkills = new Set(deployedPaths.map(skillName).filter(Boolean));
    const added = [...newSkills].filter((n) => !oldSkills.has(n)).sort();
    const removed = [...oldSkills].filter((n) => !newSkills.has(n)).sort();
    if (added.length || removed.length) skeletonDelta = { added, removed };
  }
  return { sphereSync, skeletonDelta };
}

// Pre-update backup (field ask): the framework surface as it stood BEFORE this interval's
// writes goes to .kaif/backup-<from>-<to>/ — zero-knowledge rollback material that works
// mid-merge too (git protects only committed states). Git-ignored (ignore-first); only the
// CURRENT interval's backup is kept — the previous one is replaced.
function backupTree(deploy, fromVer, toVer) {
  const dir = `.kaif/backup-${fromVer || 'unknown'}-${toVer}`;
  try {
    if (existsSync('.kaif')) for (const n of readdirSync('.kaif'))
      if (n.startsWith('backup-') && `.kaif/${n}` !== dir) rmSync(`.kaif/${n}`, { recursive: true, force: true });
    let copied = 0;
    for (const f of deploy) {
      if (!okOnDisk(f.path)) continue;
      const to = join(dir, f.path);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(f.path));
      copied++;
    }
    if (copied) log(`+ pre-update backup: ${copied} file(s) → ${dir}/ (rollback material; git-ignored, replaced next interval)`);
  } catch (e) { log(`⚠ pre-update backup skipped: ${e.message}`); }
}

// ---------------------------------------------------------------------------- adaptation task
// The ONE cognitive deliverable left to the AI agent. Every item ends in a forced
// checkpoint line (the fable-method lesson: weak models follow rules at decision
// points, not rules in lists) that verify-final greps for mechanically.
function writeAdaptationTask(unresolvedLive, translated, meta, values = {}) {
  const needTranslate = LANG !== 'en' && translated === 0;
  const items = [];
  items.push(['study', 'Study the project gradually and record findings (what it is, build/test commands, architecture) — this replaces the old KAIF_DEPLOYMENT_PLAN.md.']);
  // Identity before content: the canonical name feeds every later fill, and identity is the
  // OWNER's — a lowercase package/folder name seeded into H1 headings misnames the project.
  if (!canonicalName() && values['<PROJECT_NAME>'])
    items.push(['project-name', `<PROJECT_NAME> was auto-filled with "${values['<PROJECT_NAME>']}" from a technical identifier (package.json/folder name) — a lowercase tech id is NOT the project's canonical name, and identity is the OWNER's, never the machinery's guess. Confirm the canonical name with the owner, record it: \`node .kaif/kaif-core.mjs project-name "<Name>"\` (the marker and future fills heal), then correct any seeded headings carrying the wrong form.`]);
  if (unresolvedLive.length) items.push(['placeholders', `Fill the remaining placeholders at their REAL locations (each verified on disk at generation time; grep to be sure): ${fmtSlots(unresolvedLive)}`]);
  items.push(['maps', 'Fill PROJECT_STRUCTURE_EXTERNAL_MAP.md and PROJECT_ARCHITECTURE_INTERNAL_MAP.md from your inspection. Keep them SHORT; write in 2-3 small edits, not one giant write.']);
  items.push(['goal-plan', 'If GOAL.md is empty, seed it and ask the owner; derive MASTER_PLAN.md from GOAL.md (skill: /revision).']);
  items.push(['sphere', 'Pick the project\'s sphere (libraries ship in .kaif/spheres/; do NOT author a new document unless none fits) and record it by running `node .kaif/kaif-core.mjs sphere <name>` (e.g. `sphere programming`) — never edit .kaif/kaif.json by hand.']);
  if (needTranslate) items.push(['language', `Translate the owner-facing docs (GOAL.md, KAIF_FRAMEWORK.md, the directory READMEs) into "${LANG}" — no bundled template for this language yet. Keep agent-only docs in English.`]);
  items.push(['kaif-framework', 'Write KAIF_FRAMEWORK.md from its template: "KAIF, deployed here" + the deployment record (version, date, language, sphere, agents, mode).']);
  // Epic M (feedback loop): the install report is MANDATORY and written even when everything went
  // smoothly (deviations lead it, smooth is one line). Section SKELETON only — the genre canon
  // lives in reports/README.md; a full template body here would bloat the task (the field rake:
  // a 352-line task with 80 useful). The item deliberately never mentions the origin — report
  // delivery upstream is the skills' business and must not leak into an anonymous deployment.
  items.push(['field-report', `MANDATORY field install report (the framework's feedback loop — written even when the install went smoothly): create \`reports/KAIF_UPDATES/<PROJECT>_KAIF_${meta.version}_INSTALL_REPORT.md\`, strictly in English, terse. Sections (genre canon: reports/README.md): 1. Chronology with numbers · 2. Friction and rakes (verbatim evidence; an explicit framework defect/improvement also gets its own ticket — skill /report-bug, templates A/B) · 3. What confused a cold agent (top 3) · 4. Final state and judge verdict (run a /fable-judge pass over the install; every number is a command's output).`]);
  items.push(['verify', 'Run `node .kaif/kaif-core.mjs verify-final` — it checks these checkpoints and self-cleans the installer. Then commit `chore: deploy KAIF`.']);

  const lines = [
    '# KAIF adaptation task — the final (and only) cognitive step',
    '',
    '> Machinery has deployed everything mechanical. What remains is understanding — yours.',
    `> For each finished item: tick its checkbox AND append its checkpoint line at the bottom, verbatim.`,
    `> Then run \`node .kaif/kaif-core.mjs verify-final\` (it greps the checkpoints; missing = not done).`,
    '>',
    '> Working rules for THIS task (they exist because weak models break here): write files in SMALL',
    '> pieces (a short skeleton first, then extend) — never one giant write; in every file-writing tool',
    '> call, pass the file PATH as its own parameter (never glue "path:" into the content text); edit',
    '> only the files an item names. Do NOT edit THIS file at all — record each finished item by running',
    '> the command shown next to it; the machinery appends the checkpoint for you.',
    '',
    ...items.map(([id, text]) => `- **${id}** — ${text}\n  When done, run: \`node .kaif/kaif-core.mjs checkpoint ${id}\``),
    '',
    `Install parameters: version ${meta.version} · lang ${LANG} · mode ${MODE} · agents ${AGENTS.join(',')}`,
    '',
    '## Checkpoints (append below as you finish items)',
    '',
  ];
  writeFileSync(TASK_FILE, lines.join('\n'));
  log(`+ wrote ${TASK_FILE} (${items.length} items)`);
  return items.map(([id]) => id);
}

// The cognitive task after an UPDATE: only the genuinely diverged places + what's new.
// Same forced-checkpoint discipline as the adaptation task. Since plan 21 the heavy lifting is
// per-module: `opts.divergedModules` renders "your version → new template" diffs right in the
// task, so the agent merges MEANING, never reconstructs deltas by hand (the top field gap, П1).
// Version-interval news (plan 21 §3.4, field gap T2): a 1.2→2.0 jump prints the UNION of every
// release's notes in (from, to], newest last — single-release notes left long jumpers blind.
function newsInterval(meta, fromVersion) {
  const byVer = meta.templateNotesByVersion;
  if (!byVer) return (meta.templateNotes || []).map((n) => `- ${n}`).join('\n') || '- (no template notes shipped with this version)';
  const vnum = (v) => String(v || '0').split('.').map(Number);
  const gt = (a, b) => { const [a1, a2 = 0] = vnum(a), [b1, b2 = 0] = vnum(b); return a1 !== b1 ? a1 > b1 : a2 > b2; };
  const vers = Object.keys(byVer).filter((v) => gt(v, fromVersion || '0') && !gt(v, meta.version)).sort((a, b) => (gt(a, b) ? 1 : -1));
  if (!vers.length) return '- (no template notes recorded for this interval)';
  return vers.map((v) => [`**${v}:**`, ...byVer[v].map((n) => `- ${n}`)].join('\n')).join('\n\n');
}

// The "assertion surface" scan (plan 21 §3.5, field gap П9; re-cut in bugs/35 — the 2.1 field
// precision was ≈19 % and the noise trained operators to ignore the one guard written for the
// public storefront): a stale CLAIM is the FRAMEWORK's version token ADJACENT to a framework
// marker, outside the owner's quotes, dated journals and derivative mirrors.
// DELIBERATE RECALL TRADE (bugs/35 closure, L4 judge): precision is the gate here — a claim
// that is dated, quoted, parenthesized or far from the marker is now SKIPPED by construction
// (a real dated claim, a blockquote tagline, prose staleness far from the marker — the project C
// D11 "(с 1.5)" class — will be missed). The scan is an ADVISOR, not a blocker: the task item
// says "update each or state why", and the judge verdict carries the reasoning (decision #42).
function scanStaleClaims(fromVersion, toVersion, templateShas = null) {
  if (!fromVersion || fromVersion === toVersion) return [];
  // Knowledge directories and EXPERIENCE/HISTORY are JOURNALS OF THE PAST by definition — a line
  // "we updated to <old>" cannot be "updated to <new>" without lying; half the field scan's hits
  // were exactly that (bug 23 / project A K5), and a noisy guard teaches the agent to ignore it.
  // Agent-system mirrors are DERIVATIVE — the machinery itself re-syncs them from the canon,
  // yet they once ate 44 of 46 hits and the whole cap (bugs/35, KCam Г4).
  const SKIP_DIRS = ['.git', 'node_modules', '.kaif', 'researches', 'interviews', 'homeworks', 'bugs', 'ideas',
                     'reports',   // dated field/audit journals — same noise class as the other knowledge dirs (bugs/35)
                     '.agents', '.grok', '.cline', '.roo'];
  // GOAL.md and the declared canon artifacts are the OWNER's documents: the scan once proposed
  // editing GOAL.md — a file the machinery itself declares untouchable (bugs/35, project A гр.3).
  // AUTHOR_STYLOMETRY.md is the same class (bugs/54): the owner's voice portrait is written by the
  // agent but ACCEPTED by the owner, and it LEGALLY carries version tokens — the corpus registry
  // names its sources' versions and the history journal records the versions the portrait changed
  // in. Declaring it in canonArtifacts also works (the line below), but that needs a manual owner
  // action and is unset by default — so the portrait is skipped by construction, not by opt-in.
  const SKIP_FILES = [UPDATE_TASK, TASK_FILE, 'KAIF.md', 'KAIF-LOADER.mjs', 'EXPERIENCE.md', 'PROJECT_HISTORY.md', 'GOAL.md', 'AUTHOR_STYLOMETRY.md'];
  try { for (const c of readJson(KAIF_JSON).canonArtifacts || []) SKIP_FILES.push(String(c).replace(/\\/g, '/')); }
  catch { /* no readable marker — nothing to widen */ }
  // A claim = the version token within a few characters of the framework marker. Mere
  // co-occurrence on one line is NOT a claim: "building Product 2.0 … KAIF leads the process"
  // is the PRODUCT's version — a project whose own version matches a KAIF release number once
  // turned this scanner into a false-positive generator (bugs/35, project A гр.3).
  const escVer = fromVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // the negative guards reject a LONGER version number ("21.6", "1.6.3", "1.60"), never a
  // sentence period right after the token ("… KAIF 1.6." is a claim, sandbox-caught)
  const ADJACENT = new RegExp(`(?:kaif|каиф)[^\\n]{0,16}${escVer}(?!\\d|\\.\\d)|(?<!\\d)(?<!\\d\\.)${escVer}[^\\n]{0,16}(?:kaif|каиф)`, 'i');
  const CAP_FILES = 20;      // cap by FILES, not hits: a hit cap was once exhausted by one
  const byFile = new Map();  // directory before the walk reached the only real public claim (KCam Г4)
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = (dir === '.' ? '' : dir + '/') + n;
      if (SKIP_DIRS.includes(n) || SKIP_FILES.includes(p)) continue;
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.md$/i.test(n)) continue;
      // The chronicle's era volumes (PROJECT_HISTORY_<era>.md, the split its template prescribes)
      // are journals of the past exactly like the main file — judge-caught before the first split.
      if (/^PROJECT_HISTORY/.test(p)) continue;
      // A file byte-identical to the CURRENT template cannot carry a stale PROJECT claim — its
      // text is upstream's own prose (bug 30: ten hits were fable-judge's "added in KAIF 1.6").
      if (templateShas && templateShas[p] && fileShaNorm(p) === templateShas[p]) continue;
      const lines = readFileSync(p, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes(fromVersion) || line.includes(toVersion)) continue;
        if (/^\s*>/.test(line)) continue;          // blockquote = the owner's quoted word (bugs/35, project B Г5)
        if (/\b\d{4}-\d{2}/.test(line)) continue;  // a dated record = journal/chronicle/decision row, not a claim (project B Г5, project A гр.4)
        if (p === 'STATUS.md' && /предыдущ|previous/i.test(line)) continue;   // history, not a claim
        // Attributions — "(KAIF 1.6)" naming the version a rule arrived with — are history, not
        // staleness (KCam Г4: rewriting them would forge it); judge the line with its
        // parenthesized segments removed, so only unparenthesized adjacency counts as a claim.
        if (!ADJACENT.test(line.replace(/\([^)]*\)/g, ''))) continue;
        if (!byFile.has(p)) byFile.set(p, []);
        byFile.get(p).push(`${p}:${i + 1} — ${line.trim().slice(0, 100)}`);
      }
    }
  };
  try { walk('.'); } catch { /* best-effort scan */ }
  const files = [...byFile.keys()];
  const hits = files.slice(0, CAP_FILES).flatMap((p) => byFile.get(p));
  if (files.length > CAP_FILES)   // honest truncation: "shown N of M", never a silent cut (KCam Г4)
    hits.push(`shown ${CAP_FILES} of ${files.length} file(s) with hits — fix these, then re-run the scan (checkpoint stale-claims re-runs it)`);
  return hits;
}

// Deprecations (plan 21 §3.5, field gap T10): a release may RETIRE artifacts that EARLIER
// releases deployed — the mechanism that replaced another mechanism owns the cleanup of its
// predecessor (project C: a 1.2-era validator survived four versions printing false greens).
// Untouched instances are removed mechanically; locally edited ones go to the task.
function handleDeprecations(meta, old) {
  const out = { removed: 0, items: [] };
  for (const d of meta.deprecations || []) {
    if (!d.path || !existsSync(d.path)) continue;
    const tpl = (old.templateShas || {})[d.path];
    if (tpl && fileShaNorm(d.path) === tpl) {
      unlinkSync(d.path);
      out.removed++;
      log(`- retired ${d.path} (${d.reason || 'deprecated upstream'})`);
    } else {
      out.items.push(`${d.path} — ${d.reason || 'deprecated upstream'} (carries local edits: remove it yourself, or keep it consciously)`);
    }
  }
  return out;
}

// Policy changes in the (from, to] interval (Reference §10.6): a rule change is OWNER territory
// and never merges silently as an ordinary diff (field: the 1.6 language-policy change dissolved
// into a diff and the owner learned about it on an audit).
function policyInterval(meta, fromVersion) {
  const byVer = meta.policyChanges;
  if (!byVer) return [];
  const vnum = (v) => String(v || '0').split('.').map(Number);
  const gt = (a, b) => { const [a1, a2 = 0] = vnum(a), [b1, b2 = 0] = vnum(b); return a1 !== b1 ? a1 > b1 : a2 > b2; };
  const out = [];
  for (const v of Object.keys(byVer).filter((v) => gt(v, fromVersion || '0') && !gt(v, meta.version)).sort((a, b) => (gt(a, b) ? 1 : -1)))
    for (const p of byVer[v]) out.push(`[${v}] ${p}`);
  return out;
}

function writeUpdateTask(diverged, meta, contextLine, opts = {}) {
  const { divergedModules = {}, ownerConvention = [], fromVersion = null, deprecations = [], staleClaims = [], translatedWholesale = [], unresolved = [], sphereSync = null, skeletonDelta = null, nameFallback = null } = opts;
  const policy = policyInterval(meta, fromVersion);
  const modFiles = Object.keys(divergedModules);
  // Checklists and decision tables inside framework files often carry the OWNER's recorded
  // state (ticked boxes, decision rows) — a merge that "cleans them up" erases his record.
  const OWNER_LINES = "Careful: checklists/tables in these files may carry the OWNER'S recorded state (ticked boxes, decision rows) — fold the template changes around them, never reset them.";
  const items = [];
  if (policy.length) items.push(['policy-changes', `⚠ This interval CHANGES RULES of your previous version — these are the OWNER'S decisions, never merge them silently; put each in front of the owner and record the choice:\n${policy.map((p) => `    · ${p}`).join('\n')}`]);
  if (modFiles.length) items.push(['merge-modules', `These MODULES need your merge — fold each diff below into your version (for ordinary files the rest was updated mechanically; for i18n-translated files NOTHING was applied — the diffs are the whole delivery): ${modFiles.map((p) => `${p} (${divergedModules[p].length})`).join(' · ')}. ${OWNER_LINES}`]);
  if (diverged.length) items.push(['merge-diverged', `These framework files carry LOCAL edits and were NOT overwritten — merge the new template's changes into each by hand (real template deltas, where available, are in the Module diffs below): ${diverged.map((p) => translatedWholesale.includes(p) ? `${p} (translated wholesale — its headings are in the owner's language, a by-signature merge is impossible; its template delta ships below)` : p).join(' · ')}. ${OWNER_LINES}`]);
  if (ownerConvention.length) items.push(['owner-conventions', `The TEMPLATES of these owner documents changed their conventions in this release — carry the convention over WITHOUT touching the owner's content: ${ownerConvention.join(' · ')}`]);
  if (deprecations.length) items.push(['deprecations', `Upstream RETIRED these artifacts, but your copies carry local edits so nothing was removed mechanically — remove each yourself or keep it consciously: ${deprecations.join(' · ')}`]);
  // New templates may arrive carrying deploy-time slots the machinery cannot fill (bug 28: the
  // update used to learn about them only when the FINAL gate failed, after "I'm done"). The
  // item names each slot's REAL on-disk addresses — the static ".claude/skills/" pointer sent
  // three field agents to files that carried no slot at all.
  if (unresolved.length) items.push(['placeholders', `New templates carry deploy-time slots the machinery could not fill — fill each at its REAL location(s), verified on disk at generation time (canonical copies; mirrors re-sync at update-verify): ${fmtSlots(unresolved)}`]);
  if (sphereSync) items.push(['sphere-sync', `Your declared sphere "${sphereSync.sphere}" is locally authored, and the framework's sphere TEMPLATE changed in this interval — the machinery never edits a local sphere: read the updated .kaif/spheres/_template.md and carry its new/changed sections into .kaif/spheres/${sphereSync.sphere}.md.`]);
  if (skeletonDelta) items.push(['local-inventories', `This release changes the framework skeleton: skills added: ${skeletonDelta.added.join(', ') || 'none'}; removed: ${skeletonDelta.removed.join(', ') || 'none'}. If this project keeps its OWN validators or inventories of the skeleton (doc/skill lists or counts in local tooling), update them — the machinery cannot know your tools; the machine-readable inventory is .kaif/deploy-manifest.json → "paths".`]);
  if (nameFallback) items.push(['project-name', `This deployment's <PROJECT_NAME> ("${nameFallback}") came from a technical identifier (package.json/folder), not from the canon — if the canonical name differs (a lowercase tech id in H1 headings is the symptom), record it: \`node .kaif/kaif-core.mjs project-name "<Name>"\`, then correct mis-seeded headings (git grep the old form).`]);
  items.push(['review-news', 'Read the template news below; apply anything relevant to files this update could not touch mechanically.']);
  // stale-claims comes AFTER review-news: the news carry the history-migration instruction, and
  // the scan once flagged the very STATUS lines that migration moves two items later (bugs/35,
  // project A гр.4); the checkpoint re-runs the scanner, so the post-migration state is what counts.
  if (staleClaims.length) items.push(['stale-claims', `These lines still assert the OLD version (${fromVersion}) — after the history migration from the news above, update each or state why it is correct:\n${staleClaims.map((h) => `    · ${h}`).join('\n')}`]);
  items.push(['recheck', 'Run `node .kaif/kaif-core.mjs check` — the deployed manifest must be 100% green.']);
  items.push(['judge', 'Run a /fable-judge pass over this update (versions in .kaif/kaif.json, nothing owner-authored lost, the merges real) — its verdict is quoted in the field report below and update-verify is not green without it (decision #46).']);
  // Epic M (feedback loop): the update report is MANDATORY, even for a smooth pass (deviations
  // lead it). Skeleton sections only (genre canon: reports/README.md — the 352-line-task rake);
  // sits between the judge pass and update-verify/commit so the report can QUOTE the verdict and
  // the gate greps its checkpoint. Never mentions the origin: delivery upstream is the skills'
  // business and must not leak into an anonymous deployment's task text.
  items.push(['field-report', `MANDATORY field update report (the framework's feedback loop — written even when the update went smoothly): create \`reports/KAIF_UPDATES/<PROJECT>_KAIF_${meta.version}_UPDATE_REPORT.md\`, strictly in English, terse. Sections (genre canon: reports/README.md): 1. Chronology with numbers (machinery counters, gates) · 2. Rakes — each with severity, verbatim evidence, cost, repro (an explicit framework defect/improvement also gets its own ticket — skill /report-bug, templates A/B) · 3. What was exercised vs NOT (honest list) · 4. Wishes for the next version (by cost, descending) · 5. Final state and the judge verdict quoted verbatim (decision #46). Every number is a command's output; every rake carries verbatim evidence. Then run \`node .kaif/kaif-core.mjs update-verify\`.`]);
  const news = newsInterval(meta, fromVersion);
  const diffSections = [];
  for (const p of modFiles) {
    diffSections.push(`### ${p}`, '');
    for (const d of divergedModules[p]) {
      diffSections.push(`**module:** \`${d.signature}\` — ${d.note}`, '', '```diff', d.diff, '```', '');
    }
  }
  writeFileSync(UPDATE_TASK, [
    `# KAIF update task — finish the update to ${meta.version}`,
    '',
    `> ${contextLine}.`,
    '> Do NOT edit this file. When an item is finished, record it by running the command shown next to',
    '> it — the machinery appends the checkpoint for you. Then run `node .kaif/kaif-core.mjs update-verify`.',
    '',
    ...items.map(([id, text]) => `- **${id}** — ${text}\n  When done, run: \`node .kaif/kaif-core.mjs checkpoint ${id}${id === 'judge' ? ' --verdict-file <path-to-verdict.md>` (multiline, any language; or `--verdict "<ascii one-liner>"`)' : '`'}`),
    '',
    "## What's new in the templates",
    '',
    news,
    '',
    ...(diffSections.length ? ['## Module diffs (your version → the new template)', '', ...diffSections] : []),
    '## Checkpoints (append below as you finish items)',
    '',
  ].join('\n'));
  log(`+ wrote ${UPDATE_TASK} (${items.length} items${diverged.length ? `, ${diverged.length} diverged files` : ''}${modFiles.length ? `, ${modFiles.length} files with module diffs` : ''})`);
}

// Fetch one artifact for `update` (URL or local dir), mirroring the loader.
async function fetchArtifact(base, name) {
  if (!/^https?:\/\//.test(base)) {
    const p = join(base, name);
    if (!existsSync(p)) die(`not found in source: ${p}`);
    return readFileSync(p);
  }
  const res = await fetch(`${base}/${name}`, { redirect: 'follow' });
  if (!res.ok) die(`download failed (${res.status}) — ${base}/${name}`);
  return Buffer.from(await res.arrayBuffer());
}

// The soft variant for OPTIONAL artifacts (the synthetic baseline): absence is an answer,
// not a death — the caller falls back to the classic path. A hung network must not hang the
// whole update for an OPTIONAL artifact (judge finding, phase L2) — hence the hard timeout.
const BASELINE_FETCH_TIMEOUT_MS = 30000;
async function fetchMaybe(base, name) {
  try {
    if (!/^https?:\/\//.test(base)) {
      const p = join(base, name);
      return existsSync(p) ? readFileSync(p) : null;
    }
    const res = await fetch(`${base}/${name}`, { redirect: 'follow', signal: AbortSignal.timeout(BASELINE_FETCH_TIMEOUT_MS) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch { return null; }
}

// The synthetic baseline (plan 21 §5.5, field gap П7): a pre-2.0 deployment carries no content
// snapshots, but the OLD version's own release artifact IS one — fetch it, run it through the
// same transform pipeline (language, fill, anonymize), and the blind adopt-everything legacy
// path becomes an ordinary modular update. Field prototype: project C's kaif-baseline-diff.mjs.
// --baseline <dir|url> overrides the source (sandboxes; offline owners with a saved artifact).
async function buildSyntheticBaseline(legacyOld) {
  const ver = legacyOld && legacyOld.version;
  if (!ver) return null;
  const base = val('--baseline') || `${ORIGIN}/releases/download/v${ver}`;
  for (const name of ['KAIF-CORE-BUNDLE.md', 'KAIF-FULL.md', 'KAIF.md']) {
    const buf = await fetchMaybe(base, name);
    if (!buf) continue;
    mkdirSync('.kaif/install', { recursive: true });
    const tmp = '.kaif/install/BASELINE.md';
    writeFileSync(tmp, buf);
    const parsed = parseBundle(tmp, true);
    unlinkSync(tmp);
    if (!parsed || !parsed.files.length) continue;
    // A baseline claiming a DIFFERENT version than the deployment's own is not the previous
    // release — trusting it would silently eat real task items via the zero-delta filter
    // (judge finding, phase L2). Old-era artifacts without a manifest stay accepted as before.
    if (parsed.meta && parsed.meta.version && String(parsed.meta.version) !== String(ver)) {
      log(`⟳ baseline artifact at ${base} declares v${parsed.meta.version}, expected v${ver} — not the previous release, skipped`);
      continue;
    }
    const { deploy } = applyLanguage(parsed.files);
    const values = stableValues();   // frozen deploy values (bug 26) — the baseline must cut like the deploy did
    const un = new Set();
    const templateShas = {};
    const moduleShas = {};
    const templateTexts = {};                          // the OLD template texts — the missing half of every real diff (bug 32)
    for (const f of deploy) {
      if (isSkippedAnon(f.path)) continue;
      let content = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, un);
      if (ANON && !f.path.endsWith('.mjs')) content = anonymize(content);
      templateShas[f.path] = normSha(content);
      templateTexts[f.path] = normEol(content);
      if (f.path.endsWith('.md')) moduleShas[f.path] = moduleEntries(f.path, normEol(content), (parsed.meta || {}).moduleClasses);
    }
    log(`⟳ synthetic baseline: v${ver}'s own ${name} (${Object.keys(templateShas).length} templates) — old template texts in hand for real diffs`);
    return { shas: {}, templateShas, moduleShas, templateTexts, kept: [], synthetic: true };
  }
  log(`⟳ no baseline artifact reachable for v${ver} (${base}) — classic adopt-everything legacy path`);
  return null;
}

// The modular merge (plan 21 §3.3) — the owner's metaphor made mechanical: a module whose disk
// text still equals what THIS deployment's template shipped is swapped for the new template's
// module; a module the owner/agent edited is kept and handed over WITH a diff; modules the owner
// ADDED to a framework file survive in place (reconstruction starts from the DISK order, so
// custom insertions keep their position). Returns null when the disk file cannot be cut cleanly.
// [TESTED: 2026-07-31 · polygon s02 S5-S8 + s07 T1/T2/T6: localized module survives TWO update
// cycles while its file's upstream modules merge mechanically; conflict module → diff in the
// task; upstream-untouched divergence makes no noise; a translated-wholesale file is kept intact
// (no doubling); dryRun analyzes without writes; owner-added sections never trip the net]
function mergeModules(path, newContent, oldMods, dryRun = false, oldTexts = null) {
  const disk = normEol(readFileSync(path, 'utf8'));
  const diskMods = splitModules(disk);
  if (joinModules(diskMods) !== disk) return null;                      // pathological file — file-level fallback
  // Duplicate signatures on DISK (the owner wrote a second identically-titled heading) would
  // silently collapse in the by-signature maps below and misclassify both copies — such a file
  // gets the safe file-level treatment instead (review-caught).
  const dupCheck = (mods) => { const s = mods.map((m) => m.signature); return new Set(s).size !== s.length; };
  const newMods = splitModules(newContent.replace(/\s+$/, '\n'));
  if (dupCheck(diskMods) || dupCheck(newMods)) return null;
  const newBySig = new Map(newMods.map((m) => [m.signature, m]));
  const oldBySig = new Map(oldMods.map((e) => [e.signature, e]));
  // Translated-wholesale net (bug 20 / project A K1): a file whose HEADINGS were translated matches
  // (almost) no baseline signature, so a by-signature merge would read it as "all owner-added"
  // and DOUBLE the document with the English template (field: 25 files, +6534 lines). If the
  // baseline's signatures are (all but one) gone from disk AND the disk body carries the owner's
  // script while the template body does not — this is a translation, not additions: hands off.
  // Bodies exclude <preamble> on purpose: machinery-appended trigger aliases put the owner's
  // script into every skill's frontmatter and would blind the test.
  const nonPre = (list) => list.filter((x) => x.signature !== '<preamble>');
  const bodyOf = (mods) => nonPre(mods).map(modText).join('\n');
  const baseFound = nonPre(oldMods).filter((e) => diskMods.some((d) => d.signature === e.signature)).length;
  // On a TINY base (directory READMEs cut into 1 module) "≤1 matched" degenerates: an intact base
  // heading plus one owner-added section in the owner's script would read as a translation and
  // freeze the file with a lying task note (judge finding F1, s07/T6) — small bases demand that
  // NO base signature survives before the net may fire. On a real-size base the ceiling is a
  // SHARE of the base, not an absolute: real translations leave TERMS untranslated, and the old
  // "≤1" ceiling read project C's 2-survivors-of-21 translation as English and doubled it (bug 31).
  const baseN = nonPre(oldMods).length;
  const wholesaleCeiling = baseN <= 2 ? 0 : Math.max(1, Math.floor(baseN * WHOLESALE_SURVIVOR_SHARE));
  // One predicate for both axes (bugs/66 №3) — the net used to re-implement the script test
  // inline, so widening `localizedAgainst` alone would have left this site Latin-blind.
  if (baseN && baseFound <= wholesaleCeiling && localizedAgainst(bodyOf(diskMods), bodyOf(newMods)))
    return { translatedWholesale: true };
  let replaced = 0;
  const divergedList = [];
  const out = [];
  for (const dm of diskMods) {
    const dSha = normSha(modText(dm));
    const oldE = oldBySig.get(dm.signature);
    const newM = newBySig.get(dm.signature);
    // Frontmatter is a named pseudo-module with one extra right (bug 43): equality with its old
    // template is judged MODULO the machinery-appended alias tail — the old text comes from the
    // baseline artifact and must agree with the deploy's own module snapshot before it is trusted.
    let untouchedMod = oldE && dSha === oldE.sha256;
    if (!untouchedMod && oldE && dm.signature === '<preamble>' && oldTexts && oldTexts.has('<preamble>')) {
      const ot = oldTexts.get('<preamble>');
      if (normSha(ot) === oldE.sha256 && stripAliasTail(modText(dm)) === stripAliasTail(ot)) untouchedMod = true;
    }
    if (untouchedMod) {
      // untouched since deploy — upstream's to move (in dryRun nothing moves: the change ships
      // as a diff instead — bug 20/K2, the "don't replace" and "don't analyze" split)
      if (!newM) {
        if (dryRun) { out.push(dm); divergedList.push({ signature: dm.signature, note: 'upstream REMOVED this module (not applied — i18n: translated)', diff: lineDiff(modText(dm), '') }); }
        else if (/^# /.test(dm.signature)) {
          // A release never removes the document's H1 — its "absence" in the template means the
          // SIGNATURE drifted (placeholder values changed between deploys, bug 26). Keep it.
          out.push(dm);
          divergedList.push({ signature: dm.signature, note: 'the document H1 is absent from the incoming template — treated as placeholder-signature drift, kept (bug 26)', diff: '' });
        }
        else replaced++;
        continue;
      }
      const newText = modText(newM);
      if (dSha === normSha(newText)) { out.push(dm); }                  // unchanged upstream too
      // The safety net never judges the preamble: machinery aliases make it carry the owner's
      // script by construction (bug 43) — the alias tail is preserved by the replacement below.
      else if (dm.signature !== '<preamble>' && localizedAgainst(modText(dm), newText)) {  // safety net (decision #17)
        out.push(dm);
        divergedList.push({ signature: dm.signature, note: 'localized on disk — not replaced', diff: lineDiff(modText(dm), newText) });
      } else if (dryRun) {
        out.push(dm);
        divergedList.push({ signature: dm.signature, note: 'upstream updated this module (not applied — i18n: translated)', diff: lineDiff(modText(dm), newText) });
      } else {
        // Replacing the frontmatter must not WIPE localization: if the disk carried an alias
        // tail and the incoming preamble has none (edge: language pack missing), carry it over.
        let text = newText;
        if (dm.signature === '<preamble>' && / Trigger aliases \(/.test(modText(dm)) && !/ Trigger aliases \(/.test(text))
          text = text.replace(/^(description:[^\n]*?)(\s*)$/m, (_, d) => d.replace(/\s+$/, '') + (modText(dm).match(/ Trigger aliases \([a-zA-Z-]+\): [^\n]*/) || [''])[0]);
        out.push({ signature: dm.signature, lines: text.split('\n') }); replaced++;
      }
    } else {
      // owner/agent-edited, or a module the deploy never shipped (owner-added section) — keep.
      // A diff lands in the task ONLY when upstream ACTUALLY changed this module (KPOT F2:
      // "diverged but upstream untouched" is zero work and must not make noise).
      out.push(dm);
      // A CONFLICT diff stays "your version → the new template" (the 2.0 canon, s02/S6): the
      // owner's edit must be visible as `-` lines right where the merge happens. Template→template
      // diffs are reserved for files whose DISK text shows nothing (translated/wholesale/absent).
      if (oldE && newM && normSha(modText(newM)) !== oldE.sha256)
        divergedList.push({ signature: dm.signature, note: 'carries local edits AND upstream changed it', diff: lineDiff(modText(dm), modText(newM)) });
      else if (oldE && !newM)
        divergedList.push({ signature: dm.signature, note: 'upstream REMOVED this module; your edited version kept', diff: lineDiff(modText(dm), '') });
    }
  }
  // modules NEW in this release (absent on disk): insert by template order — right after the
  // nearest preceding template sibling that exists in the reconstruction, else append.
  // In dryRun they are REPORTED, never inserted (a translated file must not grow English text).
  for (let i = 0; i < newMods.length; i++) {
    const nm = newMods[i];
    if (diskMods.some((d) => d.signature === nm.signature)) continue;
    // A module absent on disk is inserted ONLY when it is genuinely NEW upstream — absent from
    // the previous release's template too. If the old template had it: unchanged upstream means
    // the absence is the OWNER's doing (translation or deletion) — never re-insert (bug 31: the
    // English doubling of translated files; the same gate kills the false "NEW module in this
    // release" items at zero upstream delta — bug 32, project A's 19 phantoms); changed upstream
    // means the owner must reconcile — a diff, never a resurrection.
    const oldEIns = oldBySig.get(nm.signature);
    if (oldEIns && oldEIns.sha256 === normSha(modText(nm))) continue;
    if (oldEIns) {
      const ot = oldTexts && oldTexts.has(nm.signature) && normSha(oldTexts.get(nm.signature)) === oldEIns.sha256
        ? oldTexts.get(nm.signature) : '';
      divergedList.push({ signature: nm.signature, note: dryRun
        ? 'upstream updated this module (not applied — i18n: translated)'
        : 'this module is absent from your copy (translated or removed locally) and upstream CHANGED it — reconcile by hand',
        diff: lineDiff(ot, modText(nm)) });
      continue;
    }
    if (dryRun) { divergedList.push({ signature: nm.signature, note: 'NEW module in this release (not inserted — i18n: translated)', diff: lineDiff('', modText(nm)) }); continue; }
    // An H1 module is never INSERTED into a document that already carries one: a "new" H1 is a
    // drifted placeholder signature, and inserting it appends a duplicate header to the end of
    // the canon (bug 26, field: AGENT_GUIDE grew a second title under another project name).
    if (/^# /.test(nm.signature) && out.some((o) => /^# /.test(o.signature))) {
      divergedList.push({ signature: nm.signature, note: 'an H1 module may not be inserted next to an existing H1 — placeholder-signature drift, reconcile by hand (bug 26)', diff: lineDiff('', modText(nm)) });
      continue;
    }
    let at = out.length;
    for (let k = i - 1; k >= 0; k--) {
      const pos = out.findIndex((o) => o.signature === newMods[k].signature);
      if (pos >= 0) { at = pos + 1; break; }
    }
    out.splice(at, 0, { signature: nm.signature, lines: modText(nm).split('\n') });
    replaced++;
  }
  const merged = joinModules(out);
  return { merged, changed: !dryRun && merged !== disk, replaced, divergedList };
}

// The real delivery for a file the machinery may not touch (translated wholesale): the
// old-template → new-template delta, module by module, judged against the deploy's own module
// snapshot (bug 32; project C D12 — the costliest task section used to arrive EMPTY for exactly these
// files, and project B counted 5 norms it would have silently lost). Old module TEXTS come from
// the baseline artifact; without one the delta is still DETECTED by the snapshot shas and the
// item says the diff is unavailable instead of staying silent — zero upstream delta = zero items.
function templateDelta(oldEntries, newContent, oldTexts) {
  const out = [];
  const newMods = splitModules(normEol(newContent).replace(/\s+$/, '\n'));
  const newBySig = new Map(newMods.map((m) => [m.signature, m]));
  const textOf = (e) => {
    const t = oldTexts && oldTexts.get(e.signature);
    return t != null && normSha(t) === e.sha256 ? t : null;
  };
  for (const e of oldEntries || []) {
    const nm = newBySig.get(e.signature);
    if (!nm) {
      const ot = textOf(e);
      out.push({ signature: e.signature, note: 'upstream REMOVED this module in this interval',
        diff: ot !== null ? lineDiff(ot, '') : '(diff unavailable — pass --baseline <dir|url> with the previous release artifacts)' });
      continue;
    }
    const nt = modText(nm);
    if (normSha(nt) === e.sha256) continue;
    const ot = textOf(e);
    out.push({ signature: e.signature, note: 'upstream updated this module (not applied — the file is translated)',
      diff: ot !== null ? lineDiff(ot, nt) : lineDiff('', nt) });
  }
  for (const nm of newMods) {
    if ((oldEntries || []).some((e) => e.signature === nm.signature)) continue;
    out.push({ signature: nm.signature, note: 'NEW module in this release (not inserted — the file is translated)', diff: lineDiff('', modText(nm)) });
  }
  return out;
}

// ONE classification for every road new templates arrive by — core update AND the legacy/
// anonymous bootstrap (plan 21 §5.5; bugs 13/14: those routes used to keep everything and dump
// the whole delta on the agent as cognitive work). Mutates f.content to the filled/anonymized
// text (derived surfaces inherit it — bug 05) and APPLIES the mechanical moves; returns the
// counters and the cognitive leftovers for the task writer. `base` (optional) is the previous
// release's synthetic baseline: template provenance for v1 manifests and old template TEXTS for
// the real old→new diffs of bug 32.
// [TESTED: 2026-07-28 · extraction verified by re-running suites S5–S12c unchanged-green]
function classifyAndApply(deploy, old, values, unresolved, cur, base = null) {
  const oldShas = old.shas || {};
  const oldTplShas = old.templateShas || (base && base.templateShas) || {};   // v2: what the previous deploy's TEMPLATES were
  const oldModShas = { ...((base && base.moduleShas) || {}), ...(old.moduleShas || {}) };  // v2: their per-module cut (manifest wins per path)
  const oldTplTexts = old.templateTexts || (base && base.templateTexts) || {};
  // What the previous deploy SHIPPED at all — distinguishes "provenance unknown" (v1 manifest)
  // from "genuinely NEW file in this release" (judge finding, phase L2).
  const oldPaths = new Set(
    (old.paths && old.paths.length ? old.paths : null)
    || (old.templateShas ? Object.keys(old.templateShas) : null)
    || (base && base.templateShas ? Object.keys(base.templateShas) : null)
    || []);
  // Provenance gate: paths the previous deploy ADOPTED (kept as found, never written from a
  // template) are not replace-eligible even when the disk sha still matches the snapshot —
  // for them the snapshot IS the owner's content.
  const adoptedBefore = new Set(old.kept || []);
  const diverged = [];
  const divergedModules = {};                        // path → [{signature, note, diff}]
  const ownerConvention = [];                        // owner docs whose TEMPLATE changed shape
  const adopted = [];
  // i18n intent (decision #17, re-cut by bug 20/K2): a project that declared `"i18n": "translated"`
  // translated its wrapper — but the flag protects PER FILE, and only files that actually carry
  // the owner's script where the template does not (machinery-appended skill aliases are not a
  // translation). Protected files are never written; upstream changes ship as per-module diffs
  // (a dry-run merge). Pure-English files keep their mechanical updates — the old all-or-nothing
  // flag silently froze 21 untouched files forever (project A field report).
  const i18nTranslated = String((cur || {}).i18n || '').toLowerCase() === 'translated';
  if (i18nTranslated) log('⟳ marker declares i18n: translated — mechanical replacement disabled for files carrying the owner\'s script; upstream changes ship as per-module diffs');
  const translatedWholesale = [];
  let replaced = 0, added = 0, kept = 0, mergedModules = 0;
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    let content = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, unresolved);
    if (ANON && !f.path.endsWith('.mjs')) content = anonymize(content);
    f.content = content; // derived surfaces (system skill copies) must inherit the filled text (bug 05)
    if (OWNER_SEEDED.includes(f.path)) {
      // A MISSING owner doc is seeded from the template (a 1.2-era tree predates EXPERIENCE.md —
      // the classified legacy path must seed it exactly like a fresh install would; sandbox-caught).
      if (!existsSync(f.path)) { writeIfNew(f.path, content); added++; continue; }
      kept++;                                                            // owner's — never in scope
      // …but the TEMPLATE may have changed a CONVENTION (field: EXPERIENCE gained Repro:/Not for:
      // and no project could learn it) — surface the fact, touch nothing.
      if (oldTplShas[f.path] && oldTplShas[f.path] !== normSha(content)) ownerConvention.push(f.path);
      continue;
    }
    if (!existsSync(f.path)) { writeIfNew(f.path, content); added++; continue; }
    // Authority to replace comes ONLY from matching the previous TEMPLATE (bug 12): the template
    // sha never mutates with the disk, so "restored by hand at update N" can no longer read as
    // "untouched" at update N+1. v1 manifests (no templateShas) keep the old byte-sha + kept-guard.
    const untouched = oldTplShas[f.path]
      ? fileShaNorm(f.path) === oldTplShas[f.path]
      : (!adoptedBefore.has(f.path) && oldShas[f.path] && fileSha(f.path) === oldShas[f.path]);
    if (untouched) {
      // An untouched file IS the old template — replacing it with the new one is right even
      // under the i18n flag (the flag protects the owner's translation, and an untouched file
      // carries none; s07 T2 guards this for pure-EN files on translated deployments).
      if (fileShaNorm(f.path) === normSha(content)) { kept++; continue; } // upstream didn't change it either
      writeFileSync(f.path, content); log(`↻ replaced ${f.path}`); replaced++; continue;
    }
    // bugs/32 (all four 2.1 field reports): a diverged/translated file whose TEMPLATE did not
    // change in this interval has NOTHING to deliver — it stays as-is and never makes a task
    // item ("zero upstream delta = zero items"; project A: 77% of the task was diffs nobody needed,
    // project D: 8 of 23 merge-diverged items were byte-identical between the releases).
    if (oldTplShas[f.path] && oldTplShas[f.path] === normSha(content)) { kept++; adopted.push(f.path); continue; }
    // The flag freezes only files that ARE a translation — judged by the BODY, because
    // machinery-appended aliases put the owner's script into every skill's frontmatter on both
    // sides and blinded the whole-file test for all 34 skills (bug 31; re-cut of bug 20/K2).
    const fileTranslated = i18nTranslated && f.path.endsWith('.md')
      && bodyLocalized(readFileSync(f.path, 'utf8'), content);
    // Diverged file → the MODULAR merge when the previous deploy left a module cut (v2, md only):
    // untouched modules move mechanically, edited ones are kept and handed over with diffs.
    // A translated file goes through the SAME merge in dry-run: analysis without writes (K2).
    if (f.path.endsWith('.md') && oldModShas[f.path]) {
      const oldTexts = oldTplTexts[f.path] != null
        ? new Map(splitModules(normEol(oldTplTexts[f.path])).map((m) => [m.signature, modText(m)])) : null;
      const res = mergeModules(f.path, content, oldModShas[f.path], fileTranslated, oldTexts);
      if (res && res.translatedWholesale) {
        // headings translated — merging would double the document (bug 20/K1); hands off. The
        // task item now carries the REAL old→new template delta instead of "fold the news in
        // by hand" with nothing attached (bug 32 / project C D12).
        diverged.push(f.path); translatedWholesale.push(f.path); kept++; adopted.push(f.path);
        const delta = templateDelta(oldModShas[f.path], content, oldTexts);
        if (delta.length) divergedModules[f.path] = delta;
        log(`⟳ ${f.path} is translated wholesale (its headings are in the owner's script) — kept intact; the template delta ships in the task`);
        continue;
      }
      if (res) {
        if (fileTranslated) {
          if (res.divergedList.length) { divergedModules[f.path] = res.divergedList; }
          kept++; adopted.push(f.path);
          continue;
        }
        if (res.changed) { writeFileSync(f.path, res.merged); mergedModules += res.replaced;
          log(`↻ merged ${res.replaced} module(s) into ${f.path}${res.divergedList.length ? ` (${res.divergedList.length} kept for you)` : ''}`); }
        if (res.divergedList.length) { divergedModules[f.path] = res.divergedList; kept++; adopted.push(f.path); }
        continue;
      }
    }
    diverged.push(f.path); kept++; adopted.push(f.path);
    // No module cut for this file (v1-era manifest or a pathological split) — the template delta
    // is delivered whole-file when the baseline is in hand, and NAMED honestly when it is not:
    // an empty merge-diverged item is indistinguishable from "nothing changed" (bug 32).
    if (f.path.endsWith('.md') && oldTplTexts[f.path] != null && normEol(oldTplTexts[f.path]) !== normEol(content)) {
      divergedModules[f.path] = [{ signature: '(whole file — template delta)',
        note: 'the template changed in this interval; your copy carries local edits — fold the delta into it by hand',
        diff: lineDiff(normEol(oldTplTexts[f.path]).replace(/\n$/, ''), normEol(content).replace(/\n$/, '')) }];
    } else if (f.path.endsWith('.md') && oldTplShas[f.path] && oldTplShas[f.path] !== normSha(content)) {
      divergedModules[f.path] = [{ signature: '(whole file)',
        note: 'the template changed in this interval, but no baseline artifact is reachable to render the diff — pass --baseline <dir|url>, or fold the template news in by hand',
        diff: '(unavailable)' }];
    } else if (f.path.endsWith('.md') && oldPaths.size && !oldPaths.has(f.path)) {
      // A file NEW in this release collided with an existing file of the owner's — there is no
      // old template to diff against, so the incoming template ships whole: an empty item is
      // indistinguishable from "nothing to do" (bug 32, judge finding).
      divergedModules[f.path] = [{ signature: '(new file in this release)',
        note: 'this release ships a NEW file, but a file with this name already exists in your project and was kept — adopt what you need from the incoming template below',
        diff: lineDiff('', normEol(content).replace(/\n$/, '')) }];
    }
    if (f.path.endsWith('.md') && localizedAgainst(readFileSync(f.path, 'utf8'), content))
      log(`⟳ ${f.path} is localized on disk — kept (no silent English takeover)`);
  }
  return { replaced, added, kept, mergedModules, diverged, divergedModules, ownerConvention, adopted, translatedWholesale };
}

// ---------------------------------------------------------------------------- update (idea 14 / plan 15)
// Mechanical respectful update: untouched framework files are replaced with the new
// templates; diverged ones are kept and handed to the agent; owner content is never
// in scope at all. Requires the deploy manifest with `shas` (installs since 1.5).
async function cmdUpdate() {
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const cur = readJson(KAIF_JSON);
  if (cur.tracking === 'anonymous') die('anonymous install tracks no origin — update by dropping a fresh thin KAIF.md and re-running the bootstrap (the surviving deploy manifest makes that pass mechanical since 2.0)');
  if (!val('--lang') && cur.language) LANG = String(cur.language).toLowerCase();
  if (!val('--agents') && Array.isArray(cur.agents) && cur.agents.length) AGENTS = cur.agents;
  // A mistyped channel VALUE must refuse, not silently become "release" (judge finding, L3 —
  // the same bug-33 class one level below the flag whitelist: form was validated, values not).
  const chan = (val('--channel') || 'release').toLowerCase();
  if (!(chan in SOURCES)) die(`unknown channel: ${chan} — known: ${Object.keys(SOURCES).join(' | ')}`);
  const base = val('--source') || SOURCES[chan];
  log(`update: checking ${base}`);
  const man = JSON.parse((await fetchArtifact(base, 'kaif-manifest.json')).toString('utf8'));
  if (man.version === cur.version) { log(`✅ already up to date (KAIF ${cur.version})`); return; }
  // Fail-closed on an unfinished previous update (bug 25, judge two-hop repro: clobbering the
  // task silently discarded un-merged module diffs of a translated file — forever, without a
  // trace). The task is the delivery; it must be consumed or discarded CONSCIOUSLY.
  if (okOnDisk(UPDATE_TASK)) die(`${UPDATE_TASK} exists — the previous update was never verified, and its module diffs may be unmerged. Finish it (work the items, then \`node .kaif/kaif-core.mjs update-verify\`), or delete the file consciously to discard its guidance, then re-run update.`);
  log(`update: ${cur.version} → ${man.version}`);

  // fetch + verify the machinery pair (ignore-first BEFORE anything lands in the tree)
  ensureIgnoreFirst();
  mkdirSync('.kaif/install', { recursive: true });
  const bufs = {};
  for (const name of ['KAIF-CORE.mjs', 'KAIF-CORE-BUNDLE.md']) {
    bufs[name] = await fetchArtifact(base, name);
    const got = sha256(bufs[name]);
    if (got !== man.sha256[name]) die(`sha256 mismatch for ${name}: expected ${man.sha256[name]}, got ${got}`);
  }
  const bundlePath = '.kaif/install/KAIF-CORE-BUNDLE.md';
  writeFileSync(bundlePath, bufs['KAIF-CORE-BUNDLE.md']);

  // classify against the install-time snapshots — ONE shared classification, whatever road the
  // new templates arrived by (plan 21 §5.5)
  const old = okOnDisk(DEPLOY_MANIFEST) ? readJson(DEPLOY_MANIFEST) : { paths: [], agents: [], shas: {} };
  const { files, meta } = parseBundle(bundlePath);
  const { deploy } = applyLanguage(files);           // LANG defaults handled below
  logPackHonesty(files, deploy);                     // the pack boundary is declared, not discovered
  const values = stableValues();                     // frozen deploy values win over re-detection (bug 26)
  const unresolved = new Set();
  // The previous release's own artifact provides the OLD template texts — the missing half of
  // every real "old template → new template" diff in the task (bug 32). Optional by design:
  // absence degrades to sha-detected notes, never to silence, and never blocks the update.
  const oldBase = await buildSyntheticBaseline(cur);
  // Before/after file sizes: the honest way to SEE a K1-class mangling instantly (field ask —
  // "the doubling is visible in a size summary at once, and invisible in 43 merged-lines").
  const sizeBefore = {};
  for (const f of deploy) if (okOnDisk(f.path)) sizeBefore[f.path] = statSync(f.path).size;
  backupTree(deploy, cur.version, man.version);      // rollback material BEFORE anything is written
  const { replaced, added, kept, mergedModules, diverged, divergedModules, ownerConvention, adopted, translatedWholesale } =
    classifyAndApply(deploy, old, values, unresolved, cur, oldBase);
  const sizeJumps = deploy
    .filter((f) => sizeBefore[f.path] && okOnDisk(f.path))
    .map((f) => ({ path: f.path, before: sizeBefore[f.path], after: statSync(f.path).size }))
    .filter((s) => s.after > s.before * 1.5 && s.after - s.before > 400)
    .sort((a, b) => (b.after - b.before) - (a.after - a.before)).slice(0, 5);
  for (const s of sizeJumps) log(`⚠ size jump: ${s.path} ${s.before} → ${s.after} bytes — eyeball it (a mangled merge is visible here first)`);
  // agent-system artifacts: same classification via the copies' snapshots
  const skillFiles = deploy.filter((f) => skillName(f.path) && !isSkippedAnon(f.path));
  const refFiles = deploy.filter((f) => /^\.claude\/skills\/[^/]+\/references\//.test(f.path));
  deployAgentSystems(skillFiles, refFiles); // writeIfNew semantics: new appear; existing kept (their canonical .claude source got classified above)

  // swap the core itself + refresh manifests (same shape and guarantees as install's:
  // sha snapshots + adoption provenance in `kept` + the pristine marker snapshot that
  // backs the final self-heal).
  // An honest log line: "replaced" on byte-identical machinery sent a field agent hunting a
  // phantom swap failure (bug 10 facet, KPOT) — when the shas match, say so instead.
  if (okOnDisk('.kaif/kaif-core.mjs') && fileSha('.kaif/kaif-core.mjs') === sha256(bufs['KAIF-CORE.mjs'])) {
    log('= .kaif/kaif-core.mjs unchanged in this release');
  } else {
    writeFileSync('.kaif/kaif-core.mjs', bufs['KAIF-CORE.mjs']);
    log('↻ replaced .kaif/kaif-core.mjs (the machinery itself)');
  }
  const deployedPaths = deploy.filter((f) => !isSkippedAnon(f.path)).map((f) => f.path);
  const agentPaths = expectedAgentArtifacts(skillFiles.map((f) => skillName(f.path)));
  const shas = {};
  for (const p of [...deployedPaths, ...agentPaths]) if (okOnDisk(p)) shas[p] = fileSha(p);
  const templateShas = {};
  const moduleShas = {};
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    templateShas[f.path] = normSha(f.content);
    if (f.path.endsWith('.md')) moduleShas[f.path] = moduleEntries(f.path, normEol(f.content), meta.moduleClasses);
  }
  const marker = { ...cur, version: man.version, released: man.released };
  // Seed the canonArtifacts key on updates of older deployments too (bug 34 — see cmdInstall).
  if (!('canonArtifacts' in marker)) marker.canonArtifacts = [];
  // project C D2 (bug 31): pre-2.0 translated deployments carry no i18n key, so the per-file freeze
  // is off for them. When the wholesale net just recognized translated files on a non-English
  // deployment, record the fact — every future update protects them by FLAG, not only by net.
  if (LANG !== 'en' && translatedWholesale.length && String(cur.i18n || '').toLowerCase() !== 'translated') {
    marker.i18n = 'translated';
    log(`⟳ marker: "i18n": "translated" recorded (${LANG} deployment; ${translatedWholesale.length} translated-wholesale file(s) recognized)`);
  }
  writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
  writeFileSync(DEPLOY_MANIFEST, JSON.stringify({ manifestVersion: 2, paths: deployedPaths,
    agents: agentPaths, shas, templateShas, moduleShas, kept: adopted,
    values: persistValues(values), marker }, null, 2) + '\n');

  const dep = handleDeprecations(meta, old);
  const staleClaims = scanStaleClaims(cur.version, man.version, templateShas);
  // The task lists only slots that are LITERALLY on disk after the pass (judge finding: the raw
  // `unresolved` set collects every null-valued slot seen in incoming templates — on a fully
  // filled deployment that would put a phantom `placeholders` item into EVERY update task, and
  // a noisy guard teaches the agent to ignore it), each with its real addresses.
  const liveUnresolved = unresolvedOnDisk(unresolved, deploy);
  const scopes = updateScopes(old, deploy, deployedPaths, marker);
  const nameFallback = !canonicalName() && values['<PROJECT_NAME>'] ? values['<PROJECT_NAME>'] : null;
  const nModDiverged = Object.values(divergedModules).reduce((a, l) => a + l.length, 0);
  // The honest size of the work (field ask: the log said "161 modules merged", the task said
  // "2 await you" — the real answer to "how much do I read" is "the framework changed N of M").
  const oldTpl = old.templateShas || {};
  const changedCnt = Object.keys(oldTpl).length
    ? deploy.filter((f) => !isSkippedAnon(f.path) && (!oldTpl[f.path] || oldTpl[f.path] !== normSha(f.content))).length : null;
  writeUpdateTask(diverged, { ...meta, version: man.version },
    `${changedCnt !== null ? `the framework changed ${changedCnt} of ${deploy.length} shipped files in this interval; ` : ''}mechanical pass done: ${replaced} files replaced, ${mergedModules} modules merged in-place, ${added} added, ${kept} kept (owner/diverged${nModDiverged ? `; ${nModDiverged} modules await your merge — diffs below` : ''})${dep.removed ? `; ${dep.removed} deprecated artifact(s) retired` : ''}. Sanity-check with git diff: replaced content must carry NO owner edits`,
    { divergedModules, ownerConvention, fromVersion: cur.version, deprecations: dep.items, staleClaims, translatedWholesale, unresolved: liveUnresolved,
      sphereSync: scopes.sphereSync, skeletonDelta: scopes.skeletonDelta, nameFallback });

  // The permanent receipt (plan 21 §3.4; field: "update-verify passed" was unfalsifiable a day
  // later — project B §4). Survives self-clean; update-verify stamps it when the gates pass.
  writeReceipt({ from: cur.version, to: man.version, route: 'core-update',
    source: base,   // where THIS update came from — the previous delta stays recomputable (field ask №3)
    counters: { replaced, mergedModules, added, kept },
    diverged, divergedModules: Object.fromEntries(Object.entries(divergedModules).map(([p, l]) => [p, l.map((d) => d.signature)])),
    ownerConvention });
  appendHistory(marker, cur.version, man.version, 'core-update');
  writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
  log(`\n✅ KAIF updated mechanically to ${man.version} — finish ${UPDATE_TASK}, then: node .kaif/kaif-core.mjs update-verify`);
}

// A stamp carries the DATE AND THE TIME (AGENT_GUIDE → Document & text hygiene): a bare date
// loses the ordering INSIDE the day, and forensics on a busy day is exactly where these receipts
// are read. Local ISO 8601 with the offset — the owner's own clock, not UTC: a receipt is read by
// the human whose day it belongs to. Node has no local-ISO formatter, so the offset is composed
// from getTimezoneOffset (minutes WEST of UTC — hence the inverted sign).
function localStamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin < 0 ? '-' : '+';
  const abs = Math.abs(offMin);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
         `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

const LAST_UPDATE = '.kaif/last-update.json';
function writeReceipt(r) {
  const receipt = { ...r, date: localStamp() };
  writeFileSync(LAST_UPDATE, JSON.stringify(receipt, null, 2) + '\n');
  log(`+ wrote ${LAST_UPDATE} (the update receipt — proof that outlives the self-clean)`);
}
// The marker keeps a compact update history (field ask T9): where the deployment came from and
// by which route — /kaif-version gets real memory, forensics gets a machine-readable trail.
function appendHistory(marker, from, to, route) {
  marker.history = [...(marker.history || []), { from: from || '?', to, route, date: localStamp() }];
}

// ---------------------------------------------------------------------------- final gates
// The closing guarantees are a property of the DEPLOYED TREE, not of the road taken to it:
// install's verify-final and update's update-verify run the SAME gate sequence (field-caught
// on project A, 2026-07-17 — the update path used to skip these, so owner-side merges made between
// the mechanical pass and the final check never reached the per-system skill copies).

// placeholder scan on the canon + skills across EVERY deployed surface (GOAL/maps may
// legitimately hold template slots for the owner). Scanning only .claude/ let literal
// <BUILD_COMMAND> live in the .agents/.grok/.cline/.roo copies and .kaif/spheres/ for a
// whole release while the gate stayed green (bug 11, three field reports).
function scanPlaceholders() {
  let issues = 0;
  const scan = new Set(['AGENT_GUIDE.md']);
  for (const base of ['.claude/skills', '.agents/skills', '.grok/skills', '.cline/skills'])
    if (existsSync(base)) for (const n of readdirSync(base)) { const p = `${base}/${n}/SKILL.md`; if (existsSync(p)) scan.add(p); }
  if (existsSync('.roo/commands')) for (const n of readdirSync('.roo/commands').filter((f) => f.endsWith('.md'))) scan.add(`.roo/commands/${n}`);
  // Sphere libraries: only the DECLARED sphere is a working surface — the others are reference
  // libraries that carry template slots BY DESIGN (bugs/36, project B Г11: a literal <BUILD_COMMAND>
  // in a FOREIGN sphere's library blocked the whole acceptance).
  try {
    const declared = readJson(KAIF_JSON).sphere;
    if (declared && declared !== 'TODO' && okOnDisk(`.kaif/spheres/${declared}.md`)) scan.add(`.kaif/spheres/${declared}.md`);
  } catch { /* no readable marker — no sphere surface to scan */ }
  for (const p of scan) {
    const t = readFileSync(p, 'utf8');
    for (const ph of PLACEHOLDERS) if (t.includes(ph)) { console.error(`✖ placeholder ${ph} still in ${p}`); issues++; }
  }
  return issues;
}

// The declared sphere must EXIST as a library: fable-method calls the sphere's minimum
// evidence set binding, yet a marker could point into the void with every gate green
// (bug 11, project B: sphere "game-design" with no .kaif/spheres/game-design.md).
// A loud warning, not a failure: legitimate mid-adaptation states pass through here.
// [TESTED: 2026-07-27 · sandbox S2: `sphere game-design` without a library → check exit 0 + the warning]
function warnSphereLibrary() {
  if (!okOnDisk(KAIF_JSON)) return;
  try {
    const s = readJson(KAIF_JSON).sphere;
    if (s && s !== 'TODO' && !okOnDisk(`.kaif/spheres/${s}.md`))
      console.error(`⚠ sphere "${s}" has no library at .kaif/spheres/${s}.md — author it from .kaif/spheres/_template.md (binding for /fable-method and /fable-judge)`);
  } catch { /* marker unreadable — the check gate flags that separately */ }
}

// anonymous deployments: grep for author identity BEFORE cleanup. Two bug-13 lessons baked in:
// (1) scan ONLY the paths the machinery deployed (manifest paths+agents) — a whole-tree walk
//     once flagged the owner's name in his own JIRA dumps 44 times and froze the update;
// (2) exclude token clusters matching the PROJECT OWNER's identity (git user.name — the same
//     value the machinery itself substitutes for <AUTHOR>): the owner's name is not a leak,
//     and the author deploying his own framework is the guaranteed collision case.
function anonLeakScan() {
  const ownerId = sh('git config user.name').toLowerCase();
  const active = [];
  const excluded = [];
  for (const cluster of AUTHOR_TOKEN_CLUSTERS) {
    if (ownerId && cluster.some((t) => ownerId.includes(t.toLowerCase()))) excluded.push(...cluster);
    else active.push(...cluster);
  }
  if (excluded.length) log(`⟳ owner-identity tokens excluded from the anonymity scan: ${excluded.join(', ')} (the owner's own name is not a leak)`);
  const leaks = [];
  const scanFile = (p) => {
    if (!okOnDisk(p) || !/\.(md|json|txt|mjs|js)$/i.test(p)) return;
    const t = readFileSync(p, 'utf8');
    for (const tok of active) if (t.includes(tok)) { leaks.push(`${p} → "${tok}"`); break; }
  };
  let manifestPaths = null;
  if (okOnDisk(DEPLOY_MANIFEST)) {
    try { const m = readJson(DEPLOY_MANIFEST); manifestPaths = [...(m.paths || []), ...(m.agents || [])]; } catch { /* fall back to the walk */ }
  }
  if (manifestPaths) { for (const p of manifestPaths) scanFile(p); }
  else {
    // no manifest to scope the scan — the conservative whole-tree walk, transients excluded
    const TRANSIENT = ['KAIF.md', 'KAIF-LOADER.mjs', TASK_FILE, UPDATE_TASK, '.kaif/install', '.kaif/kaif-core.mjs', DEPLOY_MANIFEST];
    const walk = (dir) => {
      for (const n of readdirSync(dir)) {
        const p = (dir === '.' ? '' : dir + '/') + n;
        if (['.git', 'node_modules'].includes(n) || TRANSIENT.some((t) => p === t || p.startsWith(t + '/'))) continue;
        if (statSync(p).isDirectory()) { walk(p); continue; }
        scanFile(p);
      }
    };
    walk('.');
  }
  for (const l of leaks) console.error(`✖ anonymity leak: ${l}`);
  if (leaks.length) console.error('  (if a flagged name belongs to the PROJECT OWNER, it is not a leak — set `git config user.name` to the owner\'s name so the scan can excuse it, or adjust the text with the owner)');
  return leaks.length;
}

// Self-heal the deploy marker: a weak model may have rewritten .kaif/kaif.json losing
// fields (field-caught, ДЗ-02 run 5). Merge the pristine snapshot with whatever is there
// now — current values win where present, lost fields come back.
function healMarker() {
  if (!okOnDisk(DEPLOY_MANIFEST) || !okOnDisk(KAIF_JSON)) return;
  try {
    const snap = readJson(DEPLOY_MANIFEST).marker;
    if (!snap) return;
    const cur = readJson(KAIF_JSON);
    const healed = { ...snap, ...cur };
    // Content comparison, not string comparison: `{...snap, ...cur}` reorders keys whenever
    // the snapshot lacks a field the live marker gained later (history, projectName), and a
    // plain stringify-compare then logged "restored fields lost" on a perfectly healthy
    // marker — a false alarm on the healthy path is the same lie class this delivery hunts
    // (epic-judge finding). Canonical deep key order per the project rule.
    const canon = (v) => Array.isArray(v) ? v.map(canon)
      : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
    if (JSON.stringify(canon(healed)) !== JSON.stringify(canon(cur))) {
      writeFileSync(KAIF_JSON, JSON.stringify(healed, null, 2) + '\n');
      log('↻ self-healed .kaif/kaif.json (restored fields lost to a rewrite)');
    }
  } catch { /* marker unreadable — leave for the check to flag */ }
}

// One mirror write — the ONLY way this file writes a per-system copy (bugs/58, family 12
// "a refusal that does not name the right move"). Two guarantees, both paid for by a live repro:
//   1. the DIRECTORY is created here, the same way writeIfNew does it (line 407). The canon
//      instructs every project to author its own skills in .claude/skills/ (KAIF_REFERENCE §7.3);
//      for such a skill the mirror directory is created by NOBODY — deployAgentSystems mkdirs
//      only for skills that came from the bundle, while resyncCopies walks .claude/skills/ whole.
//   2. a write that still fails is reported as a NAMED path plus the command that repairs it —
//      never as a raw ENOENT thrown out of a final gate, which left the install with nothing at
//      all to close it (`sync`, both checkpoints and BOTH final gates died on one stacktrace).
// The canonical skills are never at risk here: this function only propagates them outward.
function writeMirror(to, content, failures) {
  try { mkdirSync(dirname(to) || '.', { recursive: true }); writeFileSync(to, content); return true; }
  catch (e) { failures.push(`${to} (${e.code || e.message})`); return false; }
}

// Re-sync the per-system skill copies from the canonical .claude/skills/ — cognitive work
// (adaptation fills, update merges, owner customizations) lands in the canon only; machinery
// propagates it so no copy is ever edited by hand (bug 05 and its empty-project tail).
function resyncCopies() {
  if (!existsSync('.claude/skills')) return;
  const agents = okOnDisk(KAIF_JSON) ? (readJson(KAIF_JSON).agents || []) : [];
  const canon = [];
  for (const n of readdirSync('.claude/skills')) {
    // On an anonymous deployment the origin-tied skills were deliberately skipped — the
    // re-sync must not smuggle them back into the mirrors (bug 13 facet, QA field report).
    if (ANON && ORIGIN_TIED.includes(n)) continue;
    const p = `.claude/skills/${n}/SKILL.md`;
    if (okOnDisk(p)) canon.push({ path: p, content: readFileSync(p, 'utf8') });
    const rd = `.claude/skills/${n}/references`;
    if (existsSync(rd)) for (const r of readdirSync(rd).filter((f) => f.endsWith('.md')))
      canon.push({ path: `${rd}/${r}`, content: readFileSync(`${rd}/${r}`, 'utf8') });
  }
  const copies = { codex: '.agents/skills', 'grok-build': '.grok/skills', cline: '.cline/skills' };
  let synced = 0;
  const failed = [];
  for (const [sys, base] of Object.entries(copies)) {
    if (!agents.includes(sys)) continue;
    for (const f of canon) if (writeMirror(f.path.replace('.claude/skills', base), f.content, failed)) synced++;
  }
  if (agents.includes('zoo-code')) for (const f of canon) {
    const n = skillName(f.path);
    if (n && writeMirror(`.roo/commands/${n}.md`, f.content.replace(/^name:[^\n]*\n/m, ''), failed)) synced++;
  }
  if (synced) log(`↻ re-synced ${synced} system skill copies from the canon`);
  // The refusal names the right move (bugs/58): what failed, and the one command that retries it.
  if (failed.length) log(`⚠ ${failed.length} system skill cop${failed.length === 1 ? 'y' : 'ies'} could not be written — the canonical skills in .claude/skills/ are intact, only these mirrors lag: ${failed.join(' · ')}. Fix the path or permission, then re-run \`node .kaif/kaif-core.mjs sync\`.`);
}

// self-clean: the deployment step is done; the project is driven by the skills from here on.
function selfCleanArtifacts(taskFile, anonDeploy) {
  for (const p of [taskFile, 'KAIF.md', 'KAIF-LOADER.mjs']) if (existsSync(p)) { unlinkSync(p); log(`- removed ${p}`); }
  if (existsSync('.kaif/install')) { rmSync('.kaif/install', { recursive: true, force: true }); log('- removed .kaif/install/'); }
  if (anonDeploy) {
    // Anonymity contradicts two CONSTANTS, not the file (bug 29, third 2.0 field report: deleting
    // the core also deleted check/sync/diff/adopt-current — exactly what 2.0 added — and the field
    // audited 96 mirror copies with a hand-rolled script). Same doctrine as the manifest ("carries
    // no origin at all … SURVIVES", plan 21 §5.5): keep an ANONYMIZED core — the origin URL and
    // the owner's account token are stripped; origin-dependent commands degrade gracefully
    // (`update` already refuses on an anonymous marker before touching the network).
    const CORE = '.kaif/kaif-core.mjs';
    if (existsSync(CORE)) {
      try {
        // Strip longest strings first (expansions contain the bare tokens); placeholders are
        // NON-token literals so the stripped text can never re-trip a leak grep (judge F4).
        // Idempotent by construction: a second pass finds none of the originals.
        const owner = (ORIGIN.match(/github\.com\/([^/]+)/) || [])[1];
        let src = readFileSync(CORE, 'utf8').split(ORIGIN).join('<origin-removed>');
        if (owner) src = src.split(owner).join('<owner-removed>');
        for (const exp of ACRONYM_EXPANSIONS) src = src.split(exp).join('KAIF');
        for (const cluster of AUTHOR_TOKEN_CLUSTERS) for (const t of cluster) src = src.split(t).join('<removed>');
        writeFileSync(CORE, src);
        // process.execPath, not a PATH lookup (judge F5 — same rule the recheck checkpoint follows)
        execFileSync(process.execPath, ['--check', CORE], { stdio: 'ignore' });
        log(`↻ kept an anonymized ${CORE} (origin, account and author tokens stripped) — check/sync/diff/adopt-current/checkpoint stay available`);
      } catch {
        unlinkSync(CORE);
        log(`- removed ${CORE} (anonymization failed the syntax check — fell back to removal)`);
      }
    }
  }
}

/**
 * Objective predicate of the field report: the report FILE exists in reports/KAIF_UPDATES/ under
 * the version THIS pass delivered. Writing it well is the agent's judgement; existing is not.
 * Version pin: a stale report from a PREVIOUS interval must not satisfy this pass.
 * Lives in one place because two callers need it — the checkpoint and the final gates.
 */
function fieldReportOnDisk(tag) {
  const kind = tag === 'KAIF-UPDATE' ? 'UPDATE' : 'INSTALL';
  let ver = null;
  try { ver = tag === 'KAIF-UPDATE' ? readJson(LAST_UPDATE).to : readJson(KAIF_JSON).version; }
  catch { /* no receipt/marker readable — the pin relaxes to the kind suffix below */ }
  const dir = join('reports', 'KAIF_UPDATES');
  const pin = ver
    ? new RegExp(`_KAIF_${String(ver).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_${kind}_REPORT\\.md$`)
    : new RegExp(`_${kind}_REPORT\\.md$`);
  const found = existsSync(dir) ? readdirSync(dir).filter((f) => pin.test(f)) : [];
  return { found, dir, ver, kind };
}

// Shared closing sequence: checkpoint grep on the live task file, then the gates, in order.
function runFinalGates(taskFile, tag, verb) {
  if (!okOnDisk(taskFile)) die(`${taskFile} not found — nothing to verify (or already cleaned)`);
  // EOL-normalized read (bug 24): a CRLF-resaved task (Windows editor) breaks `$`-anchored
  // checkpoint regexes — JS `$` in multiline mode matches before \n but never before \r, so
  // every recorded checkpoint would read as "missing" and the gate would lie red.
  const task = normEol(readFileSync(taskFile, 'utf8'));
  let missing = 0;
  // Anchored to the COMMAND form: a bare /checkpoint (\w+)/ scan once matched the word "for"
  // inside the task's own prose ("appends the checkpoint for you") and demanded a bogus tick
  // (sandbox-caught the day it was written).
  for (const id of [...new Set([...task.matchAll(/kaif-core\.mjs checkpoint ([a-z-]+)/g)].map((m) => m[1]))])
    if (!new RegExp(`^${tag}: ${id} done$`, 'm').test(task)) { console.error(`✖ checkpoint missing: ${tag}: ${id} done  (record it: node .kaif/kaif-core.mjs checkpoint ${id}${id === 'judge' ? ' --verdict-file <path-to-verdict.md>' : ''})`); missing++; }
  // THE FIELD REPORT IS REQUIRED BY THE DELIVERED VERSION, NOT BY THE TASK'S PROSE.
  // The required-checkpoint list above is derived from the task TEXT — and on the normal update
  // route that text is written by the OLD, already-deployed core, which knows nothing about an
  // item introduced later. So a 2.0/2.1 → 2.2 update produced a task WITHOUT `field-report` and
  // verified green without any report: the mandatory feedback loop of 2.2 silently skipped the
  // whole existing fleet — exactly the class where a proxy (what the prose happens to list)
  // replaces the property (what this version demands). The core running this gate IS the
  // delivered one — `update` swaps `.kaif/kaif-core.mjs` before `update-verify` runs — so it can
  // and must state its own requirement. Only when the task never asked for it: otherwise the
  // loop above already covers the tick, and this would double-report the same miss.
  if (!/kaif-core\.mjs checkpoint field-report/.test(task)) {
    const r = fieldReportOnDisk(tag);
    if (!r.found.length) {
      console.error(`✖ field report missing: no *_KAIF_${r.ver || '<version>'}_${r.kind}_REPORT.md in ${r.dir}/`);
      console.error(`  (mandatory since 2.2, decision #46 — this ${verb} was driven by an older core whose task did not list the item; the requirement comes from the version you just installed, not from that task. Genre canon: reports/README.md)`);
      missing++;
    } else {
      log(`✔ field report on disk: ${join(r.dir, r.found[0])} (required by the delivered version, not by the task text)`);
    }
  }
  // The judge tick must carry its verdict (bug 17: four free ticks used to pass the gate).
  if (task.includes('checkpoint judge') && new RegExp(`^${tag}: judge done$`, 'm').test(task) &&
      !new RegExp(`^${tag}: judge verdict: `, 'm').test(task)) {
    console.error(`✖ judge checkpoint has no verdict line — record it: node .kaif/kaif-core.mjs checkpoint judge --verdict-file <path-to-verdict.md> (or --verdict "<ascii one-liner>")`);
    missing++;
  }
  // Substance check (bug 17 / field report 08's 209-line method): every '+' line the update task
  // promised in its module diffs should exist on disk once the agent merged. A WARNING list, not
  // a failure — translated wrappers legitimately merge meanings, not bytes.
  const i18nTranslated = okOnDisk(KAIF_JSON) && (() => { try { return String(readJson(KAIF_JSON).i18n || '').toLowerCase() === 'translated'; } catch { return false; } })();
  if (!i18nTranslated && task.includes('## Module diffs')) {
    let curFile = null, inDiff = false, unmergedLines = 0, skipSection = false;
    const perFile = new Map();
    for (const line of task.split('\n')) {
      const h = line.match(/^### (.+)$/);
      if (h) { curFile = h[1].trim(); continue; }
      // A module the safety net kept localized is EXPECTED to lack the English '+' lines —
      // demanding them would spam warnings at a correctly-behaving localized deployment.
      if (line.startsWith('**module:**')) { skipSection = line.includes('localized on disk'); continue; }
      if (line.startsWith('```')) { inDiff = line === '```diff'; continue; }
      if (skipSection) continue;
      if (inDiff && curFile && line.startsWith('+ ') && line.length > 12 && okOnDisk(curFile)) {
        if (!perFile.has(curFile)) perFile.set(curFile, readFileSync(curFile, 'utf8'));
        if (!perFile.get(curFile).includes(line.slice(2))) {
          console.error(`⚠ promised upstream line not found on disk (unmerged?): ${curFile} :: ${line.slice(2, 80)}`);
          unmergedLines++;
        }
      }
    }
    if (unmergedLines) console.error(`⚠ ${unmergedLines} upstream line(s) from the module diffs are absent on disk — merge them or state why in the judge verdict`);
  }
  // Mirrors are re-synced from the canon BEFORE the placeholder gate (bug 27, field: the agent
  // fixed the canon, the gate went red on four stale MIRRORS, and the shortest visible path was
  // hand-editing copies — exactly what the canon forbids). The step is mechanical and idempotent;
  // whatever still fails after it is a genuine canon-side problem.
  resyncCopies();
  missing += scanPlaceholders();
  const anonDeploy = okOnDisk(KAIF_JSON) && readJson(KAIF_JSON).tracking === 'anonymous';
  if (anonDeploy) missing += anonLeakScan();
  if (missing) die(`${verb} FAILED: ${missing} issues — finish them and re-run`);
  warnSphereLibrary();
  healMarker();
  // Re-snapshot the DISK shas now that every merge landed (plan 21 §3.2; field: KPOT caught the
  // manifest asserting pre-merge shas forever). templateShas stay untouched — they are the
  // release's truth, not the disk's.
  if (okOnDisk(DEPLOY_MANIFEST)) {
    try {
      const m = readJson(DEPLOY_MANIFEST);
      for (const p of [...(m.paths || []), ...(m.agents || [])]) if (okOnDisk(p)) m.shas[p] = fileSha(p);
      writeFileSync(DEPLOY_MANIFEST, JSON.stringify(m, null, 2) + '\n');
      log('↻ refreshed the disk snapshot in the deploy manifest (post-merge)');
    } catch { /* unreadable manifest — check flags it separately */ }
  }
  selfCleanArtifacts(taskFile, anonDeploy);
}

// The module audit (field proposal A, third 2.0 report §5): re-cut the DISK with the same
// splitter and compare per-signature against the manifest — it catches the class the module
// machinery itself can break ("a module lost its identity"), which no line-level check sees.
// Informational: divergence is often legitimate (owner edits); the value is making it VISIBLE.
function moduleAudit() {
 try {   // informational by doctrine — it must never be able to burn the receipt (judge F2)
  if (!okOnDisk(DEPLOY_MANIFEST)) return;
  let m; try { m = readJson(DEPLOY_MANIFEST); } catch { return; }
  if (!m.moduleShas) return;
  // i18n: translated (bugs/36): a wholesale-translated file matches NO template signature BY
  // CONSTRUCTION — 218/290/216 "MODULE ABSENT" lines in three field projects were 100 % false
  // and indistinguishable from a real loss ("teaches the operator to ignore the audit"). A file
  // whose absences coincide with a body in the owner's script is classified `localized`;
  // absence in a file that stayed English remains a REAL loss and stays visible.
  // The audit sees only the disk file — there is no incoming template here, so the prose axis
  // (which needs BOTH sides) cannot run. For a language the table does not know, the computed
  // substitute is the SHAPE of the absence: a wholesale translation loses every template
  // signature by construction, while a damaged English file loses some of them. Demanding
  // totality keeps real losses visible instead of hiding them behind a language flag (bugs/66 №3).
  let script = null, translatedDeploy = false;
  try {
    const j = readJson(KAIF_JSON);
    translatedDeploy = String(j.i18n || '').toLowerCase() === 'translated';
    if (translatedDeploy) script = SCRIPTS[String(j.language || '').toLowerCase()] || null;
  } catch { /* marker unreadable — the audit stays literal */ }
  let identical = 0, differs = 0, absent = 0, ours = 0, localized = 0;
  const lines = [];
  for (const [p, mods] of Object.entries(m.moduleShas)) {
    if (!okOnDisk(p)) continue;
    const raw = readFileSync(p, 'utf8');
    const disk = splitModules(normEol(raw));
    const diskBySig = new Map(disk.map((d) => [d.signature, normSha(modText(d))]));
    let fileClean = true, absentInFile = 0;
    const fileLines = [];
    for (const e of mods) {
      const got = diskBySig.get(e.signature);
      if (got === undefined) { absentInFile++; fileClean = false; fileLines.push(`  MODULE ABSENT: ${p} :: ${e.signature} (${e.class})`); }
      else if (got !== e.sha256) { differs++; fileClean = false; }
    }
    // `<preamble>` is machinery's, not the owner's (bug 43): translations keep it byte for byte,
    // so it never counts toward totality.
    const judged = mods.filter((e) => e.signature !== '<preamble>').length;
    const localizedFile = translatedDeploy && (script ? script.test(raw) : judged > 0 && absentInFile >= judged);
    if (absentInFile && localizedFile) {
      // the owner's script on disk + template signatures gone = a translation, not a loss;
      // its own headings are the translation itself, so they are not counted as "yours" either
      localized++;
      lines.push(`  localized: ${p} — translated wholesale, by-signature comparison not applicable (${absentInFile} template signature(s) absent by construction)`);
    } else {
      absent += absentInFile;
      lines.push(...fileLines);
      for (const d of disk) if (!mods.some((e) => e.signature === d.signature)) { ours++; fileClean = false; }
    }
    if (fileClean) identical++;
  }
  log(`module audit: ${identical} files match their deployed cut; ${differs} modules differ, ${absent} template modules absent, ${ours} modules are yours${localized ? `, ${localized} file(s) localized (translated — not a defect)` : ''}`);
  for (const l of lines.slice(0, 10)) log(l);
  if (absent) log('  (an ABSENT template module usually means its signature drifted — see bug 26; eyeball the file)');
 } catch (e) { log(`⚠ module audit skipped: ${e.message}`); }
}

function cmdUpdateVerify() {
  runFinalGates(UPDATE_TASK, 'KAIF-UPDATE', 'update-verify');
  moduleAudit();
  // Stamp the receipt: the proof of a verified update must outlive the self-clean (bug 17).
  if (okOnDisk(LAST_UPDATE)) {
    try {
      const r = readJson(LAST_UPDATE);
      r.verifiedAt = localStamp();
      writeFileSync(LAST_UPDATE, JSON.stringify(r, null, 2) + '\n');
      log(`↻ stamped ${LAST_UPDATE} (verifiedAt)`);
    } catch { /* unreadable receipt — nothing to stamp */ }
  }
  log('✅ update-verify passed — the update is complete and self-cleaned. Commit: chore: update KAIF');
}

// ---------------------------------------------------------------------------- commands
async function cmdInstall() {
  const { files, meta } = parseBundle(BUNDLE);
  // A legacy bootstrap inherits the OWNER'S LANGUAGE from the marker (like agents below):
  // re-running a ru-deployment's bootstrap without --lang used to silently apply English
  // templates and aliases (the same silent-widening class as bug 14's five systems).
  if (okOnDisk(KAIF_JSON) && !val('--lang')) {
    try { const j = readJson(KAIF_JSON); if (j.language) LANG = String(j.language).toLowerCase(); } catch { /* CLI default stands */ }
  }
  const { deploy, translated } = applyLanguage(files);
  logPackHonesty(files, deploy);   // the pack boundary is declared, not discovered post-factum
  const values = stableValues();   // a re-run/bootstrap over an existing deploy keeps ITS values (bug 26)
  const unresolved = new Set();

  // Legacy/update detection: ANY existing deploy marker means this project already runs
  // KAIF — this bootstrap is an update-by-bootstrap (idea 14), never a fresh install:
  // existing files are kept (below), new entities added, marker fields preserved, and the
  // final task is an update merge, not adaptation. Version EQUALITY does not opt out
  // (field-caught in ДЗ-03: a 1.4 project updating onto a pre-release 1.4 bundle was
  // mis-detected as fresh and had its marker clobbered).
  let legacyOld = null;
  if (okOnDisk(KAIF_JSON)) {
    try { legacyOld = readJson(KAIF_JSON); } catch { /* unreadable marker — treat as fresh */ }
    if (legacyOld) log(`⟳ existing KAIF ${legacyOld.version || '?'} detected — running as an UPDATE to ${meta.version} (existing files are kept, new ones added)`);
  }
  // A legacy bootstrap must not silently WIDEN the deployment: the old default (all five
  // systems) handed a two-system project ~80 unrequested files (bug 14, project C). Inherit the
  // marker's agents — the 1.4-era singular `agent` included — and always say what was chosen.
  if (legacyOld && !val('--agents')) {
    const inherited = Array.isArray(legacyOld.agents) && legacyOld.agents.length ? legacyOld.agents
      : legacyOld.agent ? [legacyOld.agent] : null;
    if (inherited) AGENTS = inherited;
    log(`⟳ target agent systems: ${AGENTS.join(', ')} (${inherited ? 'inherited from the existing marker' : 'default — no agents in the old marker'}; override with --agents)`);
  }
  ensureIgnoreFirst(); // ignore-first before any transient artifact can be staged

  // 1) write every deployable file (placeholder-filling the text ones; anonymizing on --mode anonymous).
  //    The filled/anonymized content is written BACK into the deploy entry so every derived
  //    surface (the .roo/.agents/.grok/.cline skill copies) inherits it — deriving copies from
  //    the raw template shipped placeholders to the other agent systems (bug 05, field-caught).
  //    Since plan 21 §5.5 a bootstrap over an EXISTING deployment is classified exactly like a
  //    core update whenever a baseline exists: the surviving deploy manifest (anonymous installs
  //    keep an origin-free one now) or a SYNTHETIC baseline cut from the old version's own
  //    release artifact. Only with no baseline at all does classic adopt-everything run.
  let adopted = [];
  let cls = null;
  if (legacyOld) {
    if (legacyOld.version !== meta.version) backupTree(deploy, legacyOld.version, meta.version); // rollback material BEFORE any write
    let baseline = null;
    if (okOnDisk(DEPLOY_MANIFEST)) {
      try { const mOld = readJson(DEPLOY_MANIFEST); if (mOld.templateShas) baseline = mOld; } catch { /* unreadable — try synthetic */ }
    }
    if (!baseline) baseline = await buildSyntheticBaseline(legacyOld);
    if (baseline) {
      cls = classifyAndApply(deploy, baseline, values, unresolved, legacyOld);
      cls.baselineOld = baseline; // deprecations later need the OLD template shas (step 5)
      adopted = cls.adopted;
      log(`⟳ bootstrap classified against ${baseline.synthetic ? `a synthetic baseline of v${legacyOld.version}` : 'the surviving deploy manifest'}: ${cls.replaced} replaced, ${cls.mergedModules} modules merged in-place, ${cls.added} added, ${cls.kept} kept`);
    }
  }
  if (!cls) {
    for (const f of deploy) {
      if (isSkippedAnon(f.path)) { log(`⊘ anonymous — skipped ${f.path}`); continue; }
      let content = f.path.endsWith('.mjs') ? f.content : fillPlaceholders(f.content, values, unresolved);
      if (ANON && !f.path.endsWith('.mjs')) content = anonymize(content);
      f.content = content;
      if (!writeIfNew(f.path, content)) adopted.push(f.path);
    }
  }

  // 2) skills for all target agent systems (from the canonical .claude/skills/ set)
  const skillFiles = deploy.filter((f) => skillName(f.path) && !isSkippedAnon(f.path));
  const refFiles = deploy.filter((f) => /^\.claude\/skills\/[^/]+\/references\//.test(f.path));
  deployAgentSystems(skillFiles, refFiles);

  // 3) wiring: deploy marker + npm handles (respectful: existing scripts untouched).
  //    On a legacy update the old marker's owner-level fields (sphere, language, tracking)
  //    survive; only version/released/agents move forward.
  mkdirSync('.kaif', { recursive: true });
  // Update over an existing deployment: start from the OLD marker so every field survives —
  // including custom ones (e.g. `deployed`, ДЗ-03 field lesson) — and move only what this
  // install owns (version/released/agents; language only if explicitly passed).
  const marker = legacyOld
    ? { ...legacyOld, framework: 'KAIF', version: meta.version, released: meta.released,
        agents: AGENTS, language: val('--lang') ? LANG : (legacyOld.language || LANG) }
    : { framework: 'KAIF', version: meta.version, released: meta.released,
        ...(ANON ? { tracking: 'anonymous' } : { origin: ORIGIN, tracking: 'origin' }),
        sphere: 'TODO', agents: AGENTS, language: LANG,
        canonArtifacts: [] };
  // The canonArtifacts key is SEEDED empty (bug 34: /derive-styleguide instructs declaring it,
  // but no deployment ever created the key — "the instruction was dead"; an empty declaration
  // is the conscious "no canon yet" state the provenance gate distinguishes from unconfigured).
  if (!('canonArtifacts' in marker)) marker.canonArtifacts = [];
  // Superseded marker fields: `{...legacyOld}` carries EVERYTHING forward, so renamed fields
  // of past schemas pile up (bug 19.3: agentsSupported from 1.4 living next to agents).
  // `agents` is always written above — the old spellings are safe to drop unconditionally.
  if (legacyOld) for (const stale of ['agent', 'agentsSupported']) delete marker[stale];
  // Same auto-record as cmdUpdate (project C D2, bug 31): a legacy bootstrap that just recognized
  // translated-wholesale files on a non-English deployment writes the i18n fact down.
  if (legacyOld && cls && LANG !== 'en' && cls.translatedWholesale.length && String(legacyOld.i18n || '').toLowerCase() !== 'translated') {
    marker.i18n = 'translated';
    log(`⟳ marker: "i18n": "translated" recorded (${LANG} deployment; ${cls.translatedWholesale.length} translated-wholesale file(s) recognized)`);
  }
  writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
  log(`+ wrote ${KAIF_JSON}`);
  // Respectful wiring: NEVER clobber an existing package.json we cannot parse —
  // an unreadable file means "skip the handles and say so", not "overwrite the user's file".
  // Anonymous installs get no kaif:* handles at all (they point at the origin-carrying core,
  // which verify-final removes) — the version stays readable in .kaif/kaif.json.
  let pkg = null;
  if (ANON) { /* no handles by design */ }
  else if (existsSync('package.json')) {
    try { pkg = readJson('package.json'); }
    catch { console.error('⚠ package.json exists but is not parseable JSON — kaif:* handles NOT wired (add them by hand)'); }
  } else pkg = {};
  if (pkg) {
    // Write ONLY when something was actually added: an unconditional rewrite re-serialized the
    // user's file (CRLF→LF) into a phantom whole-file diff on every install (bug 22 / project A K4).
    let wired = 0;
    if (!pkg.name) { pkg.name = values['<PROJECT_NAME>'].toLowerCase().replace(/[^a-z0-9-]+/g, '-'); wired++; }
    pkg.scripts = pkg.scripts || {};
    const handles = { 'kaif:version': 'node .kaif/kaif-core.mjs version', 'kaif:check': 'node .kaif/kaif-core.mjs check',
                      'kaif:update': 'node .kaif/kaif-core.mjs update' };
    for (const [k, v] of Object.entries(handles)) if (!pkg.scripts[k]) { pkg.scripts[k] = v; wired++; }
    if (wired) {
      writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
      log('+ wired kaif:* handles into package.json');
    } else log('= kaif:* handles already wired — package.json untouched');
  }

  // 4) persist the deploy manifest so `check` outlives the bundle's cleanup.
  //    MANIFEST v2 (plan 21 §3.2): THREE snapshots with distinct provenance —
  //    `shas`         what is ON DISK (byte-exact; refreshed by the final gates post-merge);
  //    `templateShas` what THIS FRAMEWORK VERSION deploys (post-fill, EOL-normalized) — the ONLY
  //                   snapshot that authorizes a mechanical replace: it never mutates with the
  //                   disk, so an adaptation that survived one update can't die in the next (bug 12);
  //    `moduleShas`   the per-module cut of every md template (signature anchors + classes) —
  //                   the base for modular merges on the next update.
  //    `kept` records PROVENANCE: paths adopted as found (not written from a template) —
  //    their snapshot is owner content, so sha-match alone never authorizes replacing them.
  const deployedPaths = deploy.filter((f) => !isSkippedAnon(f.path)).map((f) => f.path);
  const agentPaths = expectedAgentArtifacts(skillFiles.map((f) => skillName(f.path)));
  const shas = {};
  for (const p of [...deployedPaths, ...agentPaths]) if (okOnDisk(p)) shas[p] = fileSha(p);
  const templateShas = {};
  const moduleShas = {};
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    templateShas[f.path] = normSha(f.content);
    if (f.path.endsWith('.md')) moduleShas[f.path] = moduleEntries(f.path, normEol(f.content), meta.moduleClasses);
  }
  // `marker` — a pristine snapshot of .kaif/kaif.json: weak models sometimes REWRITE the
  // marker instead of adding a key (field-caught, ДЗ-02 run 5), losing version/agents/language;
  // the final gates self-heal from this snapshot.
  writeFileSync(DEPLOY_MANIFEST, JSON.stringify({ manifestVersion: 2, paths: deployedPaths,
    agents: agentPaths, shas, templateShas, moduleShas, kept: adopted,
    values: persistValues(values), marker }, null, 2) + '\n');

  // 5) the final cognitive task for the agent: fresh install → adaptation;
  //    install over an OLDER deployed KAIF (legacy 1.4-style project bootstrapped
  //    with the thin KAIF.md) → an UPDATE task instead (existing files were kept).
  if (legacyOld) {
    // Receipt/history are written only for a REAL version move: a same-version re-run must not
    // pad the history with `X → X` noise, and must never clobber a previous update's verified
    // receipt — that receipt is the permanent proof bug 17 exists to provide (review-caught).
    // The route label answers "HOW was this classified", not "how old is the deployment"
    // (field: a 2.0→2.1 pass with a LIVE manifest v2 got labeled legacy-bootstrap, and "the
    // next session reading the receipt draws the wrong conclusion about the route"). A
    // bootstrap that classified with the fresh core against the SURVIVING manifest took the
    // ordinary modular road — 'bootstrap'; 'legacy-bootstrap' stays reserved for the weaker
    // grounds (synthetic baseline / adopt-everything), which the receipt must confess.
    const bootRoute = cls && cls.baselineOld && !cls.baselineOld.synthetic ? 'bootstrap' : 'legacy-bootstrap';
    if (legacyOld.version !== meta.version) {
      writeReceipt({ from: legacyOld.version, to: meta.version, route: bootRoute,
        counters: cls ? { replaced: cls.replaced, mergedModules: cls.mergedModules, added: cls.added, kept: cls.kept, adopted: adopted.length }
                      : { adopted: adopted.length },
        classified: !!cls });
      appendHistory(marker, legacyOld.version, meta.version, bootRoute);
      writeFileSync(KAIF_JSON, JSON.stringify(marker, null, 2) + '\n');
    }
    // A re-run must not clobber recorded progress (bug 14, field: a second bootstrap wiped the
    // checkpoints and wrote a meaningless "legacy update 1.6 → 1.6" context line).
    // The question this branch answers is "is this the SAME interval?", never "are there
    // checkpoints?" (bugs/57): keyed on checkpoints alone it also swallowed a NEW interval —
    // the previous interval's task was kept, the new interval's delivery (policy changes, news,
    // conflicting-module diffs) was written NOWHERE, while marker, receipt and history had
    // already moved, so update-verify then went green against a FOREIGN checklist. A
    // checkpointed task from an OLDER interval takes the superseded road below, like any other.
    if (legacyOld.version === meta.version
        && existsSync(UPDATE_TASK) && /^KAIF-UPDATE: /m.test(readFileSync(UPDATE_TASK, 'utf8'))) {
      log(`= kept existing ${UPDATE_TASK} (it carries recorded checkpoints — not overwritten)`);
    } else if (existsSync(UPDATE_TASK) && legacyOld.version === meta.version) {
      // Bug 33 / project D Г1 — THE field data loss: a same-version re-run used to REGENERATE
      // the task even when it carried NO checkpoints yet, silently dropping its module diffs
      // and release news (the regenerated task is computed against the post-update manifest
      // and carries neither). An unfinished task IS the delivery: it survives byte-exact;
      // delete the file consciously to regenerate.
      log(`= kept existing ${UPDATE_TASK} (unfinished — its module diffs and news are the delivery; work it, or delete the file consciously to regenerate)`);
    } else {
      // The context line derives the REASON from the actual deployment state — "pre-1.5 project"
      // was a false model on anonymous installs, whose snapshots were removed by self-clean.
      const rerun = legacyOld.version === meta.version;
      // bugs/25, bootstrap facet (judge F1): a checkpoint-less unfinished task from a PREVIOUS
      // interval carries undelivered module diffs — for anonymous deployments the bootstrap is
      // the ONLY update road, so clobbering it here would lose them without a trace. Preserve
      // it aside; a same-version re-run regenerates the equivalent task and needs no ceremony.
      if (!rerun && existsSync(UPDATE_TASK)) {
        const aside = 'KAIF_UPDATE_TASK.superseded.md';
        // Since bugs/57 this road also carries tasks that ALREADY have checkpoints, so the line
        // says which kind was set aside: recorded items are work someone did, and a session that
        // reads "unfinished" alone would redo them. A previous aside that was never mined is
        // replaced here — say so out loud rather than let a second interval erase it silently.
        const had = /^KAIF-UPDATE: /m.test(normEol(readFileSync(UPDATE_TASK, 'utf8')));
        const over = existsSync(aside) ? ` (this REPLACES an earlier ${aside} that was never mined — recover it from git if it mattered)` : '';
        writeFileSync(aside, readFileSync(UPDATE_TASK));
        log(`⚠ an unfinished ${UPDATE_TASK}${had ? ' WITH recorded checkpoints' : ''} from a previous interval was preserved as ${aside}${over} — mine it for unmerged diffs${had ? ' and for the items it already records' : ''}, then delete it`);
      }
      const nMod = cls ? Object.values(cls.divergedModules).reduce((a, l) => a + l.length, 0) : 0;
      const why = legacyOld.tracking === 'anonymous'
        ? 'this anonymous deployment kept no content snapshots'
        : 'this deployment has no content snapshots (pre-1.5 deployments never wrote them)';
      const dep = cls ? handleDeprecations(meta, cls.baselineOld || {}) : { removed: 0, items: [] };
      const staleClaims = rerun ? [] : scanStaleClaims(legacyOld.version, meta.version,
        okOnDisk(DEPLOY_MANIFEST) ? (() => { try { return readJson(DEPLOY_MANIFEST).templateShas || null; } catch { return null; } })() : null);
      // Only slots literally on disk make the task item (judge finding — see cmdUpdate),
      // each with its real addresses; scopes/name mirror the core-update road.
      const liveUnresolved = unresolvedOnDisk(unresolved, deploy);
      const scopes = updateScopes(cls ? cls.baselineOld : null, deploy, deployedPaths, marker);
      const nameFallback = !canonicalName() && values['<PROJECT_NAME>'] ? values['<PROJECT_NAME>'] : null;
      // A CLASSIFIED bootstrap (surviving manifest / synthetic baseline) hands over exactly what
      // a core update would: per-module diffs and honest counters — not "merge everything".
      writeUpdateTask(cls ? cls.diverged : [], meta, rerun
        ? `re-run on ${meta.version}: the tree already carries this version — verify the previous merge rather than redoing it`
        : cls
          ? `bootstrap update ${legacyOld.version || '?'} → ${meta.version}, classified mechanically: ${cls.replaced} replaced, ${cls.mergedModules} modules merged in-place, ${cls.added} added, ${cls.kept} kept${dep.removed ? `; ${dep.removed} deprecated artifact(s) retired` : ''}${nMod ? `; ${nMod} module(s) await your merge — diffs below` : ''}`
          : `legacy update ${legacyOld.version || '?'} → ${meta.version}: ${why}, so every kept framework file may carry local edits — merge the template news below into them pointwise`,
        cls ? { divergedModules: cls.divergedModules, ownerConvention: cls.ownerConvention, fromVersion: legacyOld.version, deprecations: dep.items, staleClaims, translatedWholesale: cls.translatedWholesale, unresolved: liveUnresolved,
                sphereSync: scopes.sphereSync, skeletonDelta: scopes.skeletonDelta, nameFallback }
            : { fromVersion: legacyOld.version, staleClaims, unresolved: liveUnresolved, nameFallback });
    }
    if (existsSync(TASK_FILE)) {
      // Judge finding (L3): an adaptation IN PROGRESS (recorded checkpoints/verdict) must not
      // vanish because a bootstrap re-ran mid-flight — the same doctrine that protects
      // UPDATE_TASK above (bugs 14/33). Preserved aside: the update flow owns the task slot.
      if (/^KAIF-ADAPT: /m.test(normEol(readFileSync(TASK_FILE, 'utf8')))) {
        const asideAdapt = 'KAIF_ADAPTATION_TASK.superseded.md';
        writeFileSync(asideAdapt, readFileSync(TASK_FILE));
        unlinkSync(TASK_FILE);
        log(`⚠ ${TASK_FILE} carried recorded checkpoints — preserved as ${asideAdapt} (mine it, then delete); this bootstrap continues as an update`);
      } else { unlinkSync(TASK_FILE); log(`- removed stale ${TASK_FILE} (this is an update, not an adaptation)`); }
    }
  } else {
    writeAdaptationTask(unresolvedOnDisk(unresolved, deploy), translated, meta, values);
    if (existsSync(UPDATE_TASK)) { unlinkSync(UPDATE_TASK); log(`- removed stale ${UPDATE_TASK}`); }
  }

  // 6) validate what we just did (the required task file depends on the mode)
  const bad = validate(deploy, skillFiles, legacyOld ? UPDATE_TASK : TASK_FILE);
  if (bad) die(`install INCOMPLETE: ${bad} artifacts missing — re-run, or fix and \`check\``);
  const aliased = countAliasedOnDisk();   // read back AFTER validate(): every write is done by here
  log(`\n✅ KAIF ${meta.version} deployed mechanically (lang ${LANG}${translated ? ` · ${translated} owner docs templated` : ''}${aliased ? ` · ${aliased} skills trigger-aliased` : ''}, mode ${MODE}, agents ${AGENTS.join(',')}).`);
  // Agent clients read their command list ONCE at startup: skills that appeared on disk after that
  // are absent from it, and the first thing the human sees when trying one is "no such command" —
  // which reads as "the install failed". Saying it HERE costs one line and prevents that diagnosis.
  if (skillFiles && skillFiles.length) log(`➡ Restart your agent client so the ${skillFiles.length} skills appear in its command list (clients read that list at startup — until then a new skill answers "no such command", which is a stale list, not a failed install).`);
  if (legacyOld) log(`➡ ONE cognitive step remains — open ${UPDATE_TASK} and work it, then run: node .kaif/kaif-core.mjs update-verify`);
  else log(`➡ ONE cognitive step remains — open ${TASK_FILE} and work it, then run: node .kaif/kaif-core.mjs verify-final`);
}

function validate(deploy, skillFiles, taskFile = TASK_FILE) {
  let missing = 0;
  for (const f of deploy) {
    if (isSkippedAnon(f.path)) continue;
    if (!okOnDisk(f.path)) { console.error(`✖ MISSING or empty: ${f.path}`); missing++; }
  }
  for (const p of expectedAgentArtifacts(skillFiles.map((f) => skillName(f.path))))
    if (!okOnDisk(p)) { console.error(`✖ MISSING agent artifact: ${p}`); missing++; }
  for (const p of [KAIF_JSON, taskFile]) if (!okOnDisk(p)) { console.error(`✖ MISSING: ${p}`); missing++; }
  return missing;
}

function cmdCheck() {
  // Prefer the live bundle (pre-cleanup); after verify-final fall back to the persisted manifest.
  // Expected agent systems come from the DEPLOYED marker, not the CLI default — a narrowed
  // install (--agents a,b) must not be judged against all five systems.
  if (!val('--agents') && okOnDisk(KAIF_JSON)) {
    try { const j = readJson(KAIF_JSON); if (Array.isArray(j.agents) && j.agents.length) AGENTS = j.agents; } catch { /* marker unreadable — CLI default stands */ }
  }
  let paths, agents;
  if (existsSync(BUNDLE)) {
    const { files } = parseBundle(BUNDLE);
    const { deploy } = applyLanguage(files);
    paths = deploy.filter((f) => !isSkippedAnon(f.path)).map((f) => f.path);
    agents = expectedAgentArtifacts(deploy.filter((f) => skillName(f.path) && !isSkippedAnon(f.path)).map((f) => skillName(f.path)));
  } else if (okOnDisk(DEPLOY_MANIFEST)) {
    ({ paths, agents } = readJson(DEPLOY_MANIFEST));
  } else die(`neither ${BUNDLE} nor ${DEPLOY_MANIFEST} found — is KAIF deployed here?`);
  let missing = 0;
  for (const p of [...paths, ...agents, KAIF_JSON])
    if (!okOnDisk(p)) { console.error(`✖ MISSING or empty: ${p}`); missing++; }
  // Marker SCHEMA (bugs/11 tail; the schema is Reference §12.1): the 1.5 agent→agents rename
  // passed every gate invisibly — "exists and non-empty" is not a schema check.
  try {
    const j = readJson(KAIF_JSON);
    const schemaIssues = [];
    if (j.framework !== 'KAIF') schemaIssues.push(`framework is "${j.framework}", expected "KAIF"`);
    if (typeof j.version !== 'string' || !j.version) schemaIssues.push('version missing or not a string');
    if (!['origin', 'anonymous', 'fork'].includes(j.tracking)) schemaIssues.push(`tracking "${j.tracking}" is not origin|anonymous|fork`);
    if (!Array.isArray(j.agents) || !j.agents.length) schemaIssues.push('agents is not a non-empty array');
    if (typeof j.language !== 'string' || !j.language) schemaIssues.push('language missing');
    for (const k of ['agent', 'agentsSupported']) if (k in j) schemaIssues.push(`superseded field "${k}" present (an older schema — update should have dropped it)`);
    for (const s of schemaIssues) { console.error(`✖ marker schema: ${s} (Reference §12.1)`); missing++; }
  } catch { console.error('✖ marker unreadable as JSON'); missing++; }
  // Two-headed deployed docs (bug 31; field: project D's /pause and /kaif-remove, project C's doubled
  // PHILOSOPHY): a broken merge that ever leaves a SECOND H1 in a framework-owned .md means two
  // documents living in one file — and both `check` and `update-verify` were green on it.
  // Every deployed non-owner .md is in scope (a zero-delta update legally skips a file, so the
  // damage of a PAST broken merge must be visible HERE — judge finding, phase L2); owner-seeded
  // docs are exempt: their content is the owner's business. Fence-aware count via the splitter.
  for (const p of paths.filter((x) => x.endsWith('.md') && !OWNER_SEEDED.includes(x))) {
    if (!okOnDisk(p)) continue;
    const h1 = splitModules(normEol(readFileSync(p, 'utf8'))).filter((m) => /^# /.test(m.signature)).length;
    if (h1 > 1) { console.error(`✖ two-headed document (${h1} H1 headings): ${p} — a broken merge left two documents in one file; reconcile by hand`); missing++; }
  }
  if (missing) die(`INCOMPLETE: ${missing} artifacts missing`);
  // Content gate (warning, not failure): a mirror that EXISTS but drifted from its canon
  // skill passed the old existence-only check for a whole release (bug 11; nine days of five
  // systems on stale skills, project A). Non-fatal by design: between `update` and `update-verify`
  // the mirrors legitimately lag the canon until the re-sync runs.
  let drifted = 0;
  if (existsSync('.claude/skills')) {
    const mirrors = { codex: (n) => [`.agents/skills/${n}/SKILL.md`, (t) => t],
                      'grok-build': (n) => [`.grok/skills/${n}/SKILL.md`, (t) => t],
                      cline: (n) => [`.cline/skills/${n}/SKILL.md`, (t) => t],
                      'zoo-code': (n) => [`.roo/commands/${n}.md`, (t) => t.replace(/^name:[^\n]*\n/m, '')] };
    for (const n of readdirSync('.claude/skills')) {
      const canonPath = `.claude/skills/${n}/SKILL.md`;
      if (!okOnDisk(canonPath)) continue;
      const canonText = readFileSync(canonPath, 'utf8');
      for (const sys of AGENTS) {
        if (!mirrors[sys]) continue;
        const [p, transform] = mirrors[sys](n);
        // One line per drifted mirror flooded the mid-update check with 44 warnings (bug 30.5,
        // field: "normal state until re-sync") — show a sample, summarize the rest.
        if (okOnDisk(p) && readFileSync(p, 'utf8') !== transform(canonText)) { if (drifted < 3) console.error(`⚠ mirror drifted from canon: ${p}`); drifted++; }
      }
    }
    if (drifted) console.error(`⚠ ${drifted} mirror copies lag the canon${drifted > 3 ? ` (${drifted - 3} more not listed)` : ''} — normal until re-sync; run \`node .kaif/kaif-core.mjs sync\` (update-verify re-syncs automatically)`);
  }
  warnSphereLibrary();
  // The STATUS soft-length guard (bugs/37, decision #27): the 2.1 release PROMISED a warning at
  // the ~200-line soft target and shipped prose only — field STATUS files grew to 1647/1928
  // lines because "there was no one to warn". A warning, never a failure.
  if (okOnDisk('STATUS.md')) {
    const n = readFileSync('STATUS.md', 'utf8').replace(/\r?\n$/, '').split(/\r?\n/).length;
    if (n > STATUS_SOFT_LINES)
      console.error(`⚠ STATUS.md: ${n} lines against the soft target of ~${STATUS_SOFT_LINES} — time for a bonsai trim: move closed history verbatim into PROJECT_HISTORY.md (the /end-chat rules)`);
  }
  log(`✅ manifest satisfied: ${paths.length} files + ${agents.length} agent artifacts present${drifted ? ` (⚠ ${drifted} drifted mirrors — see above)` : ''}`);
}

// sync — the standalone handle over resyncCopies(): mirror drift accumulates BETWEEN updates,
// where the re-sync used to be unreachable (bug 11 facet; asked for by the project D report).
function cmdSync() {
  resyncCopies();
  log('✅ sync done — the per-system mirrors now equal the canon .claude/skills/');
}

// sphere <name> — the file-edit-free way to record the project's sphere (field lesson,
// ДЗ-02 run 5: a weak model REPLACED .kaif/kaif.json with {"sphere":…}, losing every other
// field). Merges the key; never lets the model touch the marker by hand.
function cmdSphere() {
  const name = args[1];
  if (!name || name.startsWith('--')) die('usage: kaif-core sphere <name>   (e.g. sphere programming)');
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const j = readJson(KAIF_JSON);
  j.sphere = name;
  writeFileSync(KAIF_JSON, JSON.stringify(j, null, 2) + '\n');
  log(`✔ sphere recorded: ${name}`);
}

// project-name "<Name>" — the file-edit-free way to record the project's CANONICAL name
// (identity belongs to the owner: <PROJECT_NAME> used to be seeded from package.json/folder —
// a lowercase tech id — and landed in H1 headings; "# project C" while the project's canon said
// project C). Heals the deploy manifest's frozen fill map too, or the tech id tiles forever.
// ── ONE door for every piece of HUMAN text on the command line (bugs/75) ─────────────────────
// The canon rule binds the ARGUMENT, not the document: "TEXT TRAVELS THROUGH FILES, NEVER THROUGH
// COMMAND-LINE ARGUMENTS." It had been applied to ONE command (`checkpoint --verdict`) and never
// became a property of the CLASS — so `project-name`, born later, arrived uncovered, and its own
// help text says the value is the OWNER's ("confirm it with the owner, never guess"). A mangled
// name here is not merely lost, it is WRITTEN DOWN: into the deploy marker, into the
// <PROJECT_NAME>/<SHORT_NAME> fill map and into every document seeded from it.
//
// Every human-text input goes through this door, so the NEXT such command is covered on the day
// it is written instead of on the day someone remembers the rule.
//   · file variant wins and is BOM-tolerant, EOL-normalized — it honours the canon;
//   · inline variant WARNS on non-ASCII, never refuses: ASCII one-liners are legitimate, and
//     refusing would break field flows that already work on shells where argv survives;
//   · both at once is an error — two sources of one truth is the drift class itself.
function readOwnerText(inline, filePath, what) {
  if (filePath && inline) die(`pass either --${what}-file or the inline value, not both — two sources of one truth drift apart`);
  if (filePath) {
    if (!existsSync(filePath)) die(`${what} file not found: ${filePath}`);
    const full = normEol(readFileSync(filePath, 'utf8').replace(/^﻿/, '')).trim();
    if (!full) die(`${what} file is empty: ${filePath}`);
    return { full, firstLine: full.split('\n').find((l) => l.trim()).trim(), fromFile: true };
  }
  if (inline && /[^\x20-\x7E]/.test(inline)) {
    log(`⚠ non-ASCII text in the ${what} argument travels through the shell and can be silently mangled on some profiles (PowerShell 5.1, MSYS2 argv conversion) — prefer --${what}-file: text travels through files`);
  }
  return { full: inline || null, firstLine: inline || null, fromFile: false };
}

function cmdProjectName() {
  const { full: name } = readOwnerText(
    args[1] && !args[1].startsWith('--') ? args[1] : null, val('--name-file'), 'name');
  if (!name) die('usage: kaif-core project-name "<Canonical Name>" | --name-file <path>   (the OWNER\'s form, e.g. "project C" — confirm it with the owner, never guess; non-ASCII belongs in a file)');
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const j = readJson(KAIF_JSON);
  j.projectName = name;
  writeFileSync(KAIF_JSON, JSON.stringify(j, null, 2) + '\n');
  if (okOnDisk(DEPLOY_MANIFEST)) {
    try {
      const m = readJson(DEPLOY_MANIFEST);
      m.values = m.values || {};
      if (m.values['<SHORT_NAME>'] === m.values['<PROJECT_NAME>']) m.values['<SHORT_NAME>'] = name;
      m.values['<PROJECT_NAME>'] = name;
      if (m.marker) m.marker.projectName = name;   // the pristine snapshot must not resurrect the tech id (healMarker)
      writeFileSync(DEPLOY_MANIFEST, JSON.stringify(m, null, 2) + '\n');
    } catch { /* unreadable manifest — `check` flags it separately */ }
  }
  log(`✔ canonical project name recorded: ${name} — future fills use it; already-seeded headings need your correction (git grep the old form)`);
}

// checkpoint <id> — the file-edit-free way to record a finished task item (field lesson,
// ДЗ-02 run 4: weak models corrupt files when forced to edit them via diff tools; a shell
// command they run reliably). Appends the forced line to the live task file itself.
function cmdCheckpoint() {
  const id = args[1];
  if (!id || id.startsWith('--')) die('usage: kaif-core checkpoint <item-id> [--verdict-file <path> | --verdict "<ascii one-liner>"]');
  const file = okOnDisk(UPDATE_TASK) ? UPDATE_TASK : okOnDisk(TASK_FILE) ? TASK_FILE : null;
  if (!file) die('no task file found — nothing to checkpoint');
  const tag = file === UPDATE_TASK ? 'KAIF-UPDATE' : 'KAIF-ADAPT';
  const task = normEol(readFileSync(file, 'utf8'));   // bug 24: $-anchors vs a CRLF-resaved task
  if (!task.includes(`kaif-core.mjs checkpoint ${id}`) && !task.includes(`${tag}: ${id} done`))
    die(`unknown item id "${id}" — it is not named in ${file}`);
  // Checkpoints EXECUTE their own gate where one exists (bug 17: recording a tick used to be
  // free — a weak model could stamp all four without doing anything; bug 34 / project C D5: the
  // scanners for placeholders and stale-claims EXISTED and re-running them at tick time costs
  // zero — a tick that skips an existing scanner is self-attestation):
  //   recheck      — re-syncs the mirrors (closes the drift window — KCam Г11), then runs the
  //                  actual `check` and refuses to record on failure;
  //   placeholders — runs the placeholder scanner and refuses while literal slots remain
  //                  (the item's contract is "fill each" — an unfilled slot is objective);
  //   stale-claims — re-runs the scanner for VISIBILITY (its contract allows "state why a
  //                  line is correct", so remaining hits warn, never refuse);
  //   judge        — requires a verdict with evidence (file or one-liner; recorded next to
  //                  the tick, and into the committable receipt — decision #42).
  if (id === 'recheck') {
    // The mirror re-sync used to live only in update-verify, leaving five agent systems on
    // contradicting skills for the whole merge window (bug 34, KCam Г11) — close it here.
    resyncCopies();
    // execFileSync + process.execPath: no shell (paths with $/backticks survive on POSIX),
    // no PATH lookup (the same node binary that runs this process runs the check).
    try {
      const out = execFileSync(process.execPath, [process.argv[1], 'check'], { stdio: 'pipe' });
      if (out && out.length) process.stdout.write(out.toString()); // surface check's warnings too
    } catch (e) {
      console.error((e.stdout || '').toString() + (e.stderr || '').toString());
      die('checkpoint recheck REFUSED: `check` failed — fix the issues above, then re-run');
    }
    log('✔ check ran green (executed by the checkpoint itself)');
  }
  if (id === 'placeholders') {
    // Mirrors legally lag the canon until a re-sync (bug 27: the verify gate re-syncs BEFORE
    // scanning for exactly this reason) — the checkpoint's scan honors the same order, or a
    // correctly-filled canon would be refused over its own stale mirrors.
    resyncCopies();
    const bad = scanPlaceholders();
    if (bad) die(`checkpoint placeholders REFUSED: ${bad} literal placeholder(s) remain on disk (listed above) — fill them in the canonical copies, then re-run`);
    log('✔ placeholder scan ran clean (executed by the checkpoint itself; mirrors re-synced first)');
  }
  if (id === 'project-name') {
    // The item's contract is "record the canonical name" — an unrecorded name is objective,
    // exactly like an unfilled placeholder (identity is the owner's; the tick may not attest it).
    let recorded = null;
    try { recorded = readJson(KAIF_JSON).projectName; } catch { /* refused below */ }
    if (!recorded) die('checkpoint project-name REFUSED: no projectName in .kaif/kaif.json — confirm the canonical name with the owner and record it first: node .kaif/kaif-core.mjs project-name "<Canonical Name>"');
    log(`✔ canonical name on record: ${recorded} (executed by the checkpoint itself)`);
  }
  if (id === 'stale-claims') {
    try {
      const rec = okOnDisk(LAST_UPDATE) ? readJson(LAST_UPDATE) : null;
      const man = okOnDisk(DEPLOY_MANIFEST) ? readJson(DEPLOY_MANIFEST) : null;
      if (rec && rec.from && rec.to) {
        const hits = scanStaleClaims(rec.from, rec.to, man && man.templateShas);
        // the "shown N of M" truncation notice is a service line, not a hit — count real ones
        const real = hits.filter((h) => !h.startsWith('shown ')).length;
        if (real) { log(`⚠ stale-claims scan re-ran: ${real} line(s) still assert the old version — the tick records anyway (stating why a line is correct is a legal completion):`); for (const h of hits) log('    · ' + h); }
        else log('✔ stale-claims scan ran clean (executed by the checkpoint itself)');
      } else log('⚠ stale-claims scan skipped: no update receipt with from/to versions — tick records on your word');
    } catch (e) { log(`⚠ stale-claims scan errored (${e.message}) — tick records on your word`); }
  }
  if (id === 'field-report') {
    // Epic M / decision #46: an update or install is not green without its field report. The
    // item's contract is objective — the report FILE exists in reports/KAIF_UPDATES/ under the
    // version this pass delivered (writing it well is the agent's judgement; existing is not).
    // Version pin: a stale report from a PREVIOUS interval must not satisfy this pass's tick.
    const r = fieldReportOnDisk(tag);
    if (!r.found.length)
      die(`checkpoint field-report REFUSED: no *_KAIF_${r.ver || '<version>'}_${r.kind}_REPORT.md in ${r.dir}/ — write the field report first (its sections are in the task item; genre canon: reports/README.md)`);
    log(`✔ field report on disk: ${join(r.dir, r.found[0])} (executed by the checkpoint itself)`);
  }
  let verdictLine = null;
  if (id === 'judge') {
    // Same door as project-name (bugs/75): the warning and the file variant belong to the CLASS
    // of human text, not to one command that happened to be written first.
    const { full: fullText, firstLine: v } = readOwnerText(val('--verdict'), val('--verdict-file'), 'verdict');
    if (!v) die('checkpoint judge requires --verdict-file <path> (multiline, any language — text travels through files, never through command-line arguments) or --verdict "<ascii one-liner>" — an unevidenced tick is exactly the fraud /fable-judge hunts');
    verdictLine = `${tag}: judge verdict: ${v}`;
    // Decision #42: the verdict rides the COMMITTABLE receipt — the task file is transient.
    if (okOnDisk(LAST_UPDATE)) {
      try { const r = readJson(LAST_UPDATE); r.judgeVerdict = fullText || v; writeFileSync(LAST_UPDATE, JSON.stringify(r, null, 2) + '\n'); log(`+ verdict recorded into the receipt (${LAST_UPDATE})`); }
      catch { /* unreadable receipt — the verdict still lives in the task line */ }
    }
  }
  const line = `${tag}: ${id} done`;
  if (new RegExp(`^${tag}: ${id} done$`, 'm').test(task)) {
    // A judge tick that exists WITHOUT its verdict (e.g. hand-written — the exact bug-17 move)
    // must still be repairable by the very command the failing gate recommends (review-caught
    // deadlock: "already recorded" used to discard the verdict and the gate stayed red forever).
    if (verdictLine && !new RegExp(`^${tag}: judge verdict: `, 'm').test(task)) {
      writeFileSync(file, task.replace(/\s*$/, '\n') + verdictLine + '\n');
      log('✔ verdict recorded for the already-ticked judge checkpoint');
      return;
    }
    log(`= already recorded: ${line}`);
    return;
  }
  writeFileSync(file, task.replace(/\s*$/, '\n') + (verdictLine ? verdictLine + '\n' : '') + line + '\n');
  log(`✔ recorded: ${line}${verdictLine ? ' (+ verdict)' : ''}`);
}

// adopt-current — rebuild the snapshot after a MANUAL migration (field: one hand-made pass left
// 113/160 stale shas and killed the mechanical path forever — project D №10). Every path that
// now diverges from its deployed template is adopted (protected); disk shas and the marker
// snapshot are refreshed. Respectful by definition: it only RECORDS reality, changes no content.
function cmdAdoptCurrent() {
  if (!okOnDisk(DEPLOY_MANIFEST)) die('no deploy manifest — nothing to adopt (deploy KAIF first)');
  const m = readJson(DEPLOY_MANIFEST);
  m.shas = m.shas || {};
  const keptSet = new Set(m.kept || []);
  let adoptedNow = 0;
  for (const p of m.paths || []) {
    if (!okOnDisk(p)) continue;
    // "Manually changed" is judged BEFORE the disk sha is refreshed. On a v2 manifest the
    // authority is the template sha; on a v1 manifest the only baseline is the OLD disk sha —
    // refreshing it first would relabel every manual edit as "untouched" and hand the next
    // update a license to clobber exactly the files this command exists to protect
    // (review-caught blocker before this ever shipped).
    const tpl = (m.templateShas || {})[p];
    const changed = tpl ? fileShaNorm(p) !== tpl : (m.shas[p] && fileSha(p) !== m.shas[p]);
    if (changed && !keptSet.has(p)) { keptSet.add(p); adoptedNow++; log(`⟳ adopted (manual change recorded): ${p}`); }
    m.shas[p] = fileSha(p);
  }
  for (const p of m.agents || []) if (okOnDisk(p)) m.shas[p] = fileSha(p);
  m.kept = [...keptSet];
  if (okOnDisk(KAIF_JSON)) { try { m.marker = readJson(KAIF_JSON); } catch { /* keep old snapshot */ } }
  writeFileSync(DEPLOY_MANIFEST, JSON.stringify(m, null, 2) + '\n');
  log(`✔ adopt-current: snapshot rebuilt — ${adoptedNow} newly adopted path(s), disk shas and marker snapshot refreshed. The mechanical update path is live again.`);
}

// diff — the machine version-delta the field reinvented seven times (П1). Two modes:
//   bare `diff`            — audit: disk vs the DEPLOYED templates (protected / replace-eligible);
//   `diff --source <x>`    — preview: ANOTHER version's bundle vs this deployment, per static module.
async function cmdDiff() {
  if (!okOnDisk(DEPLOY_MANIFEST)) die('no deploy manifest — deploy KAIF first');
  const m = readJson(DEPLOY_MANIFEST);
  const src = val('--source');
  if (!src) {
    if (!m.templateShas)
      die('this deployment carries a v1 manifest (no template provenance) — the audit would report a hollow green. Run the next `update` (it upgrades the manifest to v2), then `diff` works.');
    let match = 0, missing = 0;
    const divFiles = [];
    for (const p of m.paths || []) {
      const tpl = (m.templateShas || {})[p];
      if (!tpl) continue;
      if (!okOnDisk(p)) { missing++; continue; }
      if (fileShaNorm(p) === tpl) match++; else divFiles.push(p);
    }
    log(`diff (audit vs deployed templates): ${divFiles.length} diverged file(s) — protected from replacement; ${match} match — replace-eligible on update${missing ? `; ${missing} missing` : ''}`);
    for (const p of divFiles) log('  ≠ ' + p);
    return;
  }
  // the preview must judge in DEPLOYED space: the other bundle goes through the SAME transforms
  // an actual update would apply (language overrides/aliases + placeholder fill) — comparing raw
  // templates against a deployed manifest reported phantom deltas (a heading containing
  // <PROJECT_NAME> changes its own signature when filled; sandbox-caught).
  if (!val('--lang') && okOnDisk(KAIF_JSON)) {
    try { const j = readJson(KAIF_JSON); if (j.language) LANG = String(j.language).toLowerCase(); } catch { /* default stands */ }
  }
  const man2 = JSON.parse((await fetchArtifact(src, 'kaif-manifest.json')).toString('utf8'));
  mkdirSync('.kaif/install', { recursive: true });
  const tmp = '.kaif/install/DIFF-BUNDLE.md';
  writeFileSync(tmp, await fetchArtifact(src, 'KAIF-CORE-BUNDLE.md'));
  const { files, meta } = parseBundle(tmp);
  unlinkSync(tmp);
  const { deploy: otherDeploy } = applyLanguage(files);
  const values = stableValues();   // preview must fill exactly like the deploy did (bug 26)
  // A v1 manifest has no module provenance, and the loop below would skip every file and print
  // a hollow "0 files / 0 nothing to do" — worse than an honest refusal, and it hit exactly the
  // first-ever update, the moment of highest risk (bug 21 / project A K3). Build the deployed
  // version's SYNTHETIC baseline instead (same code as the legacy bootstrap; --baseline works).
  let mineModShas = m.moduleShas;
  if (!mineModShas || !Object.keys(mineModShas).length) {
    const curVer = okOnDisk(KAIF_JSON) ? (() => { try { return readJson(KAIF_JSON).version; } catch { return null; } })() : null;
    const synth = await buildSyntheticBaseline({ version: curVer });
    if (!synth) die(`this deployment carries a v1 manifest (no template provenance) and no baseline artifact for v${curVer || '?'} is reachable — pass --baseline <dir|url> with that version's release artifacts, or run the next update (it upgrades the manifest to v2)`);
    mineModShas = synth.moduleShas;
  }
  let changedFiles = 0, sameFiles = 0;
  const lines = [];
  for (const f of otherDeploy) {
    if (!f.path.endsWith('.md')) continue;
    const mine = mineModShas[f.path];
    if (!mine) continue; // not deployed here
    const filled = fillPlaceholders(f.content, values, new Set());
    const other = moduleEntries(f.path, normEol(filled).replace(/\s+$/, '\n'), meta.moduleClasses);
    const mineBySig = new Map(mine.map((e) => [e.signature, e]));
    let chg = 0;
    for (const om of other) {
      if (om.class !== 'static') continue;
      const me = mineBySig.get(om.signature);
      if (!me || me.sha256 !== om.sha256) chg++;
    }
    for (const me of mine) if (me.class === 'static' && !other.some((o) => o.signature === me.signature)) chg++;
    if (chg) { changedFiles++; lines.push(`  Δ ${f.path} — ${chg} static module(s) differ`); }
    else sameFiles++;
  }
  log(`diff vs ${man2.version}: ${changedFiles} file(s) carry upstream static-module changes; ${sameFiles} — nothing to do`);
  for (const l of lines) log(l);
}

function cmdVerifyFinal() {
  runFinalGates(TASK_FILE, 'KAIF-ADAPT', 'verify-final');
  log('✅ verify-final passed — KAIF install is complete and self-cleaned. Commit: chore: deploy KAIF');
}

function cmdVersion() {
  if (!okOnDisk(KAIF_JSON)) die('no .kaif/kaif.json — KAIF is not deployed here');
  const j = JSON.parse(readFileSync(KAIF_JSON, 'utf8'));
  log(`KAIF ${j.version} (released ${j.released}) · tracking: ${j.tracking} · lang: ${j.language} · agents: ${(j.agents || []).join(',')}`);
}

// modules — print this core's module cut of a bundle as JSON (audit surface). The origin's
// self-check compares it against dist/kaif-module-map.json: the core's vendored splitter and
// the build's library are thereby pinned to identical behavior (plan 21 — no silent drift).
function cmdModules() {
  const { files, meta } = parseBundle(val('--bundle') || BUNDLE);
  const out = {};
  let count = 0;
  for (const f of files) {
    if (!f.path.endsWith('.md')) continue;
    out[f.path] = moduleEntries(f.path, f.content.replace(/\s+$/, '\n'), meta.moduleClasses);
    count += out[f.path].length;
  }
  console.log(JSON.stringify({ moduleCount: count, files: out }, null, 2));
}

// ---------------------------------------------------------------------------- dispatch (bug 33)
// ONE spec drives the dispatcher, the argv validation and the help text. Flags map to
// "takes a value?"; `pos` is the number of allowed positional arguments after the command.
// MUTATING commands are marked — a bare run and unknown input never reach them.
const COMMANDS = {
  help:            { fn: cmdHelp,         desc: 'this list (also the bare-run and --help default)', flags: {}, pos: 0 },
  version:         { fn: cmdVersion,      desc: 'report the deployed version from .kaif/kaif.json', flags: {}, pos: 0 },
  check:           { fn: cmdCheck,        desc: 'validate the deployed manifest (marker schema, mirrors, two-headed docs)', flags: { '--bundle': true, '--agents': true, '--mode': true, '--lang': true }, pos: 0 },
  diff:            { fn: cmdDiff,         desc: 'audit disk vs deployed templates; --source <x> previews another version', flags: { '--source': true, '--baseline': true, '--lang': true }, pos: 0 },
  modules:         { fn: cmdModules,      desc: 'print the module cut of a bundle as JSON (audit surface)', flags: { '--bundle': true }, pos: 0 },
  install:         { fn: cmdInstall,      mutating: true, desc: 'deploy KAIF from a bundle (the loader calls this explicitly)', flags: { '--bundle': true, '--lang': true, '--mode': true, '--agents': true, '--baseline': true, '--force': false }, pos: 0 },
  update:          { fn: cmdUpdate,       mutating: true, desc: 'respectful mechanical update from the origin/release', flags: { '--source': true, '--channel': true, '--lang': true, '--agents': true, '--baseline': true }, pos: 0 },
  'update-verify': { fn: cmdUpdateVerify, mutating: true, desc: 'final gates of an update; self-cleans on green', flags: {}, pos: 0 },
  'verify-final':  { fn: cmdVerifyFinal,  mutating: true, desc: 'final gates of an install; self-cleans on green', flags: {}, pos: 0 },
  checkpoint:      { fn: cmdCheckpoint,   mutating: true, desc: 'record a finished task item (recheck/placeholders/project-name EXECUTE their gates)', flags: { '--verdict': true, '--verdict-file': true }, pos: 1 },
  sphere:          { fn: cmdSphere,       mutating: true, desc: "record the project's sphere in the deploy marker", flags: {}, pos: 1 },
  'project-name':  { fn: cmdProjectName,  mutating: true, desc: "record the project's CANONICAL name (identity is the owner's; heals the marker and the fill map)", flags: { '--name-file': true }, pos: 1 },
  sync:            { fn: cmdSync,         mutating: true, desc: 're-sync per-system skill mirrors from .claude/skills/', flags: {}, pos: 0 },
  'adopt-current': { fn: cmdAdoptCurrent, mutating: true, desc: 'rebuild the snapshot after a manual migration', flags: {}, pos: 0 },
};

function cmdHelp() {
  log('KAIF-CORE — the deployed KAIF machinery (.kaif/kaif-core.mjs). Commands (⚠ = mutates the tree):\n');
  for (const [name, c] of Object.entries(COMMANDS))
    log(`  ${name.padEnd(15)}${c.mutating ? '⚠ ' : '  '}${c.desc}`);
  log('\nA bare or flags-only run prints this help and touches NOTHING (bug 33: the old default was');
  log('`install`, and a curious bare run once overwrote a live update task in the field). Unknown');
  log('flags and arguments REFUSE instead of being silently ignored — name the command explicitly.');
}

// Unknown argv REFUSES before any command runs (bug 33: `sync --dry-run` once silently ran a
// REAL sync of 145 files, and `diff PHILOSOPHY.md` printed the full audit as if asked).
function validateArgv(spec) {
  const errs = [];
  let positionals = 0;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      if (!(a in spec.flags)) { errs.push(`unknown flag for ${CMD}: ${a}`); continue; }
      if (spec.flags[a]) {
        const v = args[i + 1];
        if (!v || v.startsWith('-')) errs.push(`flag ${a} needs a value`);
        else i++;
      }
    } else {
      positionals++;
      if (positionals > spec.pos)
        errs.push(`unexpected argument for ${CMD}: "${a}"${['diff', 'modules'].includes(CMD) ? ' — a per-file argument is not supported; run the bare command for the full audit' : ''}`);
    }
  }
  if (errs.length) {
    for (const e of errs) console.error('✖ ' + e);
    die(`refusing to run ${CMD} with input it does not understand — a silently ignored flag executes something you did not ask for (bug 33). Known flags: ${Object.keys(spec.flags).join(' ') || '(none)'}${spec.pos ? ` · up to ${spec.pos} positional argument(s)` : ''}. Run \`help\` for the command list.`);
  }
}

const spec = COMMANDS[CMD];
if (!spec) { cmdHelp(); die(`unknown command: ${CMD}`); }
if (CMD === 'help') {
  // Explicit `help` honors the same doctrine it prints: `help install` refuses instead of
  // silently showing the generic list as if it were per-command help (judge finding, L3).
  if (!IMPLICIT_CMD) validateArgv(spec);
  cmdHelp();
  // `--lang ru`-style flags-only runs used to mean `install` — a script relying on that must
  // NOTICE its install did not happen: loud note + exit 1. Bare/--help/-h stay a clean 0.
  if (IMPLICIT_CMD && args.length && !['--help', '-h', 'help'].includes(args[0]))
    die(`no command given — nothing was executed (flags seen: ${args.join(' ')}). The old bare-run default was \`install\`; say the command explicitly.`);
} else {
  validateArgv(spec);
  await spec.fn();
}
