#!/usr/bin/env node
// tools/review-gate.mjs — the send-side approval gate, fail-closed.
//
// WHY THIS EXISTS. The rendered page is decoration until a machine refuses to send unapproved
// bytes (`/owner-reviews` → build order, step 3). This module is that refusal. It carries ONE
// verdict function — checkApproval() — called by the gate CLI *and* by the real sender
// (tools/send-upstream.mjs): one function, one truth about "may this leave" (C7). Two copies of
// the verdict would drift, and the copy that drifts is always the one guarding the outbound door.
//
// THE TWO INVARIANTS IT IMPLEMENTS:
//   I3 — approval binds to the sha-256 of the NORMALIZED body, not to the click. The owner
//        approved a TEXT: one character changed inside it after the click voids the approval,
//        and the machine — not anyone's memory — is what notices. NORMALIZED is the load-bearing
//        word: by C3 the same text saved as CRLF, or with a BOM, or with a whitespace tail at the
//        end of the file, is the SAME text and keeps its approval. Drift means changed content,
//        not changed bytes.
//   I4 — the gate stands on the SEND side and is fail-closed. It NEVER throws: every failure,
//        including an unexpected one, comes back as a refusal. Any doubt = refusal, because the
//        alternative is bytes leaving this machine under the owner's account without his word.
//
// WHAT IS *NOT* HERE. Normalization, hashing, decision records and interview parsing all come
// from tools/lib/review-core.mjs. A duplicated parser is a second truth (C1) — in the field a
// guard's private copy diverged from the core on "a comment is not an answer" inside one day.
// What DOES live here is parseMetaBlock(): reading the document's metadata block is a different
// concern from parsing an interview's questions, so it does not belong in the core — but its
// HASHING goes through the core's hashBody(), like every other side of the gate (C3).
//
// Usage:  node tools/review-gate.mjs <document.md> <artifactId>
// Exit:   0 = approved · 1 = refused. The reason prints in Russian: the owner reads this console.
//
// [NOT-TESTED] — no committed verification run covers this module yet. It was exercised by a
// throwaway check in a scratch directory: no decision → refusal · the sender refuses under
// --apply and never reaches gh · a hand-written approved decision → pass · one space inserted
// INSIDE a line → refusal · a trailing space at end of file → still passes (C3, by contract) ·
// a CRLF+BOM body → still passes. That is an observation, not a test: the marker flips when a
// committed verify-* run asserts these cases.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { hashBody, readDecision } from './lib/review-core.mjs';

// The document HEAD is the first 60 lines: enough for a title, a status line, provenance and an
// artifact list. The bound exists so a yaml EXAMPLE further down a document can never be mistaken
// for the sending contract — the block that authorizes a send must sit where the owner sees it.
const HEAD_LINES = 60;

// ---------------------------------------------------------------------------------------------
// 1. The metadata block
// ---------------------------------------------------------------------------------------------

/**
 * Strip one layer of matching quotes. YAML scalars in these blocks are paths and titles; nothing
 * here needs escape processing, and inventing some would be a second truth about the same text.
 */
function stripQuotes(value) {
  const t = String(value).trim();
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return t.slice(1, -1);
  }
  return t;
}

// Keys in the metadata block are ASCII by contract (`title`, `kind`, `artifacts`, `body_file`),
// so `\w` is deliberate HERE. The project rule about `\p{L}` (rake 7) governs regexes that must
// match the owner's LANGUAGE — none of those live in this file.
const RE_KEY_VALUE = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/;

/**
 * A deliberately small YAML subset: top-level `key: value` scalars plus ONE list of mappings
 * (`artifacts:` with `- id: …` items). Anything richer is not supported and yields no artifacts,
 * which the gate turns into a refusal — the fail-closed direction (I4). A general YAML parser
 * would be a dependency, and the contour is zero-dependency by design (C1).
 */
function parseYamlSubset(block) {
  const out = {};
  let listKey = null;    // the key whose list we are currently inside
  let item = null;       // the mapping being filled by `- key: value` + indented continuations
  let itemIndent = 0;

  for (const rawLine of String(block).split('\n')) {
    if (!rawLine.trim()) continue;
    if (/^\s*#/.test(rawLine)) continue;              // whole-line comment; trailing `#` is data
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();

    // A list item. It opens a new mapping and may carry its first pair on the same line.
    const dash = line.match(/^-\s*(.*)$/);
    if (dash && listKey) {
      item = {};
      itemIndent = indent;
      out[listKey].push(item);
      const kv = dash[1].match(RE_KEY_VALUE);
      if (kv) item[kv[1]] = stripQuotes(kv[2]);
      continue;
    }

    const kv = line.match(RE_KEY_VALUE);
    if (!kv) continue;                                // not a pair we understand — ignored
    const [, key, value] = kv;

    // Indented deeper than the dash → this pair belongs to the open list item.
    if (item && indent > itemIndent) { item[key] = stripQuotes(value); continue; }

    // A top-level key closes any open item.
    item = null;
    if (value === '') { listKey = key; if (!Array.isArray(out[key])) out[key] = []; continue; }
    listKey = null;
    out[key] = stripQuotes(value);
  }
  return out;
}

/**
 * Shape A — front matter, and ONLY when `---` is the very first line. Interview documents use
 * `---` as a horizontal rule all over their bodies; anchoring to line 1 is what keeps a decorative
 * rule from being read as a sending contract.
 */
function findFrontMatter(lines) {
  if (lines[0] === undefined || lines[0].trim() !== '---') return null;
  for (let i = 1; i < lines.length; i++) {
    if (/^(-{3,}|\.{3})\s*$/.test(lines[i])) return lines.slice(1, i).join('\n');
  }
  return null;                                          // an unclosed opener is not a contract
}

/** Shape B — the contract's own form: the first fenced yaml block STARTING inside the head. */
function findFencedYaml(lines) {
  const limit = Math.min(lines.length, HEAD_LINES);
  for (let i = 0; i < limit; i++) {
    const open = lines[i].match(/^\s*(`{3,}|~{3,})\s*(?:ya?ml)\s*$/i);
    if (!open) continue;
    const marker = open[1][0];
    // The closing fence is the same character, at least as long (CommonMark).
    const close = new RegExp(`^\\s*\\${marker}{${open[1].length},}\\s*$`);
    for (let j = i + 1; j < lines.length; j++) {
      if (close.test(lines[j])) return lines.slice(i + 1, j).join('\n');
    }
    return null;                                        // an unclosed fence is not a contract
  }
  return null;
}

/**
 * Read the document's metadata block.
 *
 * @param {string} text  the document's raw text
 * @returns {{found:boolean, title:string|null, kind:string|null, artifacts:Array, raw:string|null}}
 *
 * Every artifact is `{id, target, format, body_file}` per the name contract. `body_file` is a
 * LINK to a file and never a pasted copy — the page shows exactly the bytes that will leave and
 * the hash is computed over them; a pasted copy is a second truth and breaks I3 outright.
 */
export function parseMetaBlock(text) {
  const empty = { found: false, title: null, kind: null, artifacts: [], raw: null };
  try {
    // Split on the raw text's own line endings: this reader must work on a CRLF file the same as
    // on an LF one, and the core's normalize() is reserved for the bytes that get HASHED (C3).
    // The BOM is written as \uFEFF, never as a literal character — an invisible byte inside a
    // regex is unreviewable, and this file exists to be reviewed.
    const lines = String(text).replace(/^\uFEFF/, '').split(/\r\n?|\n/);

    const hasArtifacts = (p) => p && Array.isArray(p.artifacts) && p.artifacts.length > 0;

    // Front matter is tried first, but a front matter that declares NOTHING must not shadow a real
    // fenced block below it — otherwise a document opening with a decorative `---` could silently
    // hide its own artifact list.
    let raw = findFrontMatter(lines);
    let parsed = raw === null ? null : parseYamlSubset(raw);
    if (!hasArtifacts(parsed)) {
      const fenced = findFencedYaml(lines);
      if (fenced !== null) {
        const fromFence = parseYamlSubset(fenced);
        if (hasArtifacts(fromFence) || parsed === null) { raw = fenced; parsed = fromFence; }
      }
    }
    if (!parsed) return empty;

    const artifacts = (Array.isArray(parsed.artifacts) ? parsed.artifacts : [])
      .filter((a) => a && typeof a === 'object' && a.id)
      .map((a) => ({ ...a, id: String(a.id) }));

    return {
      found: true,
      title: parsed.title ?? null,
      kind: parsed.kind ?? null,
      artifacts,
      raw,
    };
  } catch {
    // I4 in miniature: a reader for the gate answers "nothing declared", never with a stack.
    return empty;
  }
}

// ---------------------------------------------------------------------------------------------
// 2. The verdict (C7, I3, I4)
// ---------------------------------------------------------------------------------------------

const refuse = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/**
 * May artifact `artifactId` of `documentPath` leave this machine?
 *
 * Refuses on every one of: document missing · no metadata block · artifact not declared · no
 * body_file · body file missing · no decision record · no record for this artifact · status not
 * "approved" · no approved hash · hash drift · any unexpected error. It NEVER throws (I4).
 *
 * @returns {{ok:boolean, reason:string, expected?:string, actual?:string, ...}}
 *   On success the object also carries `document`, `bodyPath`, `artifact`, `meta` and `decision`
 *   so the sender needs no second read of the same truth.
 */
export function checkApproval(documentPath, artifactId) {
  try {
    // T10 — resolve(), never join(): the first document outside the repository would otherwise
    // greet the owner with a raw stack instead of a sentence.
    const docPath = resolve(String(documentPath ?? ''));
    const id = String(artifactId ?? '');
    if (!id) return refuse('не указан идентификатор артефакта — отправлять нечего');
    if (!existsSync(docPath)) return refuse(`документа нет на диске: ${docPath}`);

    const meta = parseMetaBlock(readFileSync(docPath, 'utf8'));
    if (!meta.found) {
      return refuse(`в голове документа нет блока метаданных (fenced yaml) — ${docPath}`);
    }

    const artifact = meta.artifacts.find((a) => a.id === id);
    if (!artifact) {
      const declared = meta.artifacts.map((a) => a.id).join(', ') || 'ни одного';
      return refuse(`артефакт «${id}» не объявлен в блоке метаданных; объявлены: ${declared}`);
    }
    if (!artifact.body_file) {
      // The name contract's hard edge: a body is a LINK. Without a file there are no bytes to
      // bind an approval to, and an approval not bound to bytes is not an approval (I3).
      return refuse(`у артефакта «${id}» не указан body_file — тело обязано быть ссылкой на файл`);
    }

    const bodyPath = resolve(dirname(docPath), artifact.body_file);
    if (!existsSync(bodyPath) || !statSync(bodyPath).isFile()) {
      return refuse(`файл тела артефакта не найден: ${bodyPath}`);
    }

    // I2/C6 — the decision lives beside the document under a DERIVED name; the core owns both
    // the name and the read, so a hand-edited record cannot mean one thing here and another there.
    const decision = readDecision(docPath);
    if (!decision) {
      return refuse(`решения по этому документу нет — владелец ещё не выносил вердикт (${docPath})`);
    }
    if (decision.status && String(decision.status) !== 'approved') {
      return refuse(`решение по документу — «${decision.status}», а не «approved»`);
    }

    const entry = decision.artifacts && decision.artifacts[id];
    if (!entry) {
      // THE REFUSAL NAMES THE TRUTH (`bugs/01` → the gate blocker). Nothing in the contour writes
      // `decision.artifacts`: the page records the owner's ANSWERS, and it has no
      // approve-this-send card at all. So this branch is the ONLY verdict reachable for any
      // artifact the owner "approved" through the page, and the old message — a bare "there is no
      // record" — sent him hunting through a file for something that was never going to be there.
      // The approval is hand-authored on purpose: approving a SEND is a different act from
      // answering a question, and inventing it from an answer would be a send nobody authorized.
      const known = Object.keys(decision.artifacts || {}).join(', ') || 'ни одного';
      return refuse(
        `в решении нет записи об артефакте «${id}»; в решении есть: ${known}. `
        + 'Страница контура записывает ОТВЕТЫ владельца и не записывает одобрения отправки — такой '
        + 'карточки на ней нет. Одобрение пишется в решение руками, полем artifacts: '
        + `{"artifacts": {"${id}": {"status": "approved", "sha256": "<sha-256 тела>"}}}. `
        + 'Сумму даёт: node -e "import(\'./tools/lib/review-core.mjs\').then(m=>console.log('
        + 'm.hashBody(require(\'fs\').readFileSync(process.argv[1],\'utf8\'))))" <файл тела>. '
        + 'Ответ владельца это поле больше не затирает — запись решения теперь сливается, а не перезаписывается.',
      );
    }
    const status = String(entry.status ?? '');
    if (status !== 'approved') {
      return refuse(`решение по артефакту «${id}» — «${status || 'без статуса'}», а не «approved»`);
    }

    const expected = String(entry.sha256 ?? '');
    if (!/^[0-9a-f]{64}$/i.test(expected)) {
      return refuse(`в решении нет корректного sha-256 для «${id}» — одобрение не привязано к байтам (I3)`);
    }

    // I3 — the hash goes over the NORMALIZED body through the core's hashBody(). The field's
    // costliest defect was one side hashing raw bytes while the other hashed normalized text:
    // both self-tests green, and the gate would have refused every artifact forever.
    const actual = hashBody(readFileSync(bodyPath, 'utf8'));
    if (actual !== expected.toLowerCase()) {
      return refuse(
        'текст изменился после одобрения — одобрение аннулировано (I3). '
        + `Одобряли ${expected.slice(0, 12)}…, сейчас ${actual.slice(0, 12)}…`,
        { expected: expected.toLowerCase(), actual, document: docPath, bodyPath, artifact, meta, decision },
      );
    }

    const who = decision.by ? `${decision.by}` : 'владелец';
    const when = decision.at ? `${decision.at}` : 'без отметки времени';
    return {
      ok: true,
      reason: `одобрено (${who}, ${when}), sha-256 совпадает`,
      expected: expected.toLowerCase(),
      actual,
      document: docPath,
      bodyPath,
      artifact,
      meta,
      decision,
    };
  } catch (err) {
    // I4, the whole point of the module: ANY doubt is a refusal. An exception is the largest
    // doubt there is, so it can never become a send.
    return refuse(`неожиданная ошибка — отказ по умолчанию (fail-closed): ${err && err.message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 3. CLI
// ---------------------------------------------------------------------------------------------

function main(argv) {
  const args = argv.filter((a) => a !== '--no-serve');   // C9: accepted and ignored — no server here
  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    console.log('Использование: node tools/review-gate.mjs <документ.md> <идентификатор артефакта>');
    console.log('  Выход 0 — отправка разрешена. Выход 1 — отказ, причина печатается ниже.');
    return 1;
  }

  const verdict = checkApproval(args[0], args[1]);
  if (!verdict.ok) {
    console.error(`ОТКАЗ: ${verdict.reason}`);
    return 1;
  }

  console.log(`ОДОБРЕНО: ${verdict.reason}`);
  console.log(`  документ: ${verdict.document}`);
  console.log(`  артефакт: ${verdict.artifact.id}${verdict.artifact.target ? ` -> ${verdict.artifact.target}` : ''}`);
  console.log(`  тело:     ${verdict.bodyPath}`);
  console.log(`  sha-256:  ${verdict.actual}`);
  return 0;
}

// T9 — a module others import must not execute on import: the sender imports checkApproval, and
// a bare CLI body here would exit the sender's process before it ever asked its question.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
