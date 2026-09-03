#!/usr/bin/env node
// tools/heartbeat.mjs — ONE LINE INTO THE GUARDED LOOP'S HEARTBEAT, STAMPED BY THE MACHINE'S CLOCK.
//
// WHY THIS EXISTS, AND IT IS A SECOND STRIKE RATHER THAN A CONVENIENCE. `/guarded-loop` asks for a
// heartbeat line at the end of every completed step, and the agent wrote those lines BY HAND —
// timestamp included. On 2026-08-23 that produced two wrong stamps in one session (`18:44` when the
// clock said 18:20, `18:40` when it said 18:32), which is EXP-0019 exactly: a stamp taken from the
// head instead of from a receipt. The canon's rule for a lesson that repeats is not a third
// reminder, it is a mechanism (`EXPERIENCE.md` header: «two strikes → a mechanism»), so the ONE
// field a human cannot verify by looking is now the one field a human never types.
//
// The stamp is local ISO 8601 with the machine's offset — the project's convention for a receipt
// (`AGENT_GUIDE.md` → «A stamp carries the DATE AND THE TIME»), and a UTC stamp already lied once
// (EXP-0012).
//
// Usage — the text travels as ARGV on purpose and is therefore ASCII-safe only when the caller says
// so; Russian text is passed through a FILE (`--file <path>`), because argv is the wrong pipe for
// non-ASCII on this machine (`AGENT_GUIDE.md` → text hygiene, face 1):
//
//   node tools/heartbeat.mjs --file note.txt              # the note's first line becomes the pulse
//   node tools/heartbeat.mjs --item X --status done --next Y   # composed from ASCII-safe parts
//
// The file form is the one to reach for by default here: every real heartbeat line in this project
// is Russian.
//
// THE NAME IS `heartbeat`, NOT `pulse`, AND THAT IS DELIBERATE: `npm run pulse` is already taken by
// a different instrument — the SAMPLER's pulse (`tools/pulse-report.mjs`, R4a-pulse), which measures
// whether the machine still lets a process reach the card. Two unrelated things under one word is
// the drift this project audits for, so the loop's heartbeat keeps the loop's own word.
//
// [TESTED: 2026-08-23 18:3x · run against the real .kaif/heartbeat.log — the appended line's stamp
//  matched `node -e "new Date()"` taken in the same second, and `--dry-run` printed without writing.]

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolve as entryResolve } from 'node:path';
import { fileURLToPath as entryPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const HEARTBEAT = path.join(REPO_ROOT, '.kaif', 'heartbeat.log');

/** Local ISO 8601 with the offset — the same shape `remembered-state.localIso()` writes, kept here
 *  rather than imported so this tool has no dependency on the orchestrator's modules. */
function localIso(d = new Date()) {
  const pad = (n) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + `${off >= 0 ? '+' : '-'}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

function argOf(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function main(argv) {
  const fromFile = argOf(argv, '--file');
  let body;
  if (fromFile) {
    if (!existsSync(fromFile)) { console.error(`нет файла: ${fromFile}`); return 2; }
    // The FIRST non-empty line only: a pulse is one line, and a note that grew into a paragraph is
    // a note, not a pulse.
    body = readFileSync(fromFile, 'utf8').split(/\r?\n/u).map((l) => l.trim()).find(Boolean) ?? '';
  } else {
    const item = argOf(argv, '--item');
    const status = argOf(argv, '--status') ?? 'done';
    const next = argOf(argv, '--next') ?? '';
    if (!item) {
      console.error('Как пользоваться: --file <файл с одной строкой> | --item <что сделано> [--status done|progress|blocked] [--next <следующее>]');
      return 2;
    }
    body = `${item} | ${status}${next ? ` | next: ${next}` : ''}`;
  }
  if (!body) { console.error('пустая строка пульса — писать нечего'); return 2; }

  const line = `${localIso()} | ${body}`;
  if (argv.includes('--dry-run')) { console.log(`(без записи) ${line}`); return 0; }

  mkdirSync(path.dirname(HEARTBEAT), { recursive: true });
  appendFileSync(HEARTBEAT, `${line}\n`, 'utf8');
  console.log(line);
  return 0;
}

// СТОРОЖ ВХОДА — прибор исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && entryResolve(process.argv[1]) === entryResolve(entryPath(import.meta.url))) process.exit(main(process.argv.slice(2)));
