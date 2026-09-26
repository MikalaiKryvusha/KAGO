#!/usr/bin/env node
// tools/ask.mjs — KAGO's door to the owner-review contour of KAIF 2.8 (plans/104, researches/40).
//
// Why a door and not a contour: KAIF 2.8 SHIPS the contour (`.kaif/tools/contour/review.mjs`) — answers saved one at a time
// with the page alive until its last question, the `--wait` waiter, the 409 on a rewritten document, the page at 1.7×, the
// `--call` outside a page. This file adds exactly one thing the shipped contour takes from the environment only: OUR voice
// (the owner's Silero «eugene» through `voice-say.mjs`), set for the child process alone — a machine-wide variable would change
// the call's voice in the owner's other projects on this machine behind his back.
//
// @fork owner-contour-2-8
// OPTIONS:  port the six 2.8 changes into our own tools/review.mjs · move to the shipped contour · keep both side by side
// COST:     the owner's answers — a save lost or a page closed while he types (bugs/64, origin #66)
// RECON:    researches/40 — KAIF's own /owner-reviews says «shipped generator; do not build a contour»; its self-test is 111 green here
// DECIDED:  the page, the queue and the call go to the shipped contour; the old page retired by the owner's word after he saw the
//           new one (interviews/interview_032, Q2 = A, 2026-09-26 16:2x: «Убрать сразу — новая подошла»)
//
// Usage: node tools/ask.mjs <everything the shipped contour takes>   e.g. `<doc.md>` · `--wait <doc.md>` · `--call "<what>"`
//        node tools/ask.mjs --help
//
// [TESTED: 2026-09-26 16:16–16:2x · plans/104 Ш7 with the owner at the machine: the page called in the voice «eugene», Q1 saved
//  alone («Questions left: 1 — the page STAYS open», the waiter exit 0), Q2 saved later, the page ended itself with exit 0]

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTOUR = resolve(ROOT, '.kaif', 'tools', 'contour', 'review.mjs');
// The same defaults the old contour used (tools/review.mjs:85-86); a machine overrides them by KAGO_VOICE_TOOL / KAGO_VOICE.
const VOICE_TOOL = process.env.KAGO_VOICE_TOOL || 'F:\\KLAS\\tools\\voice-say.mjs';
const VOICE = process.env.KAGO_VOICE || 'eugene';

/** The child's environment: an explicit KAIF_VOICE_TOOL / KAIF_VOICE of the caller wins; otherwise KAGO's voice. */
export function contourEnv(env = process.env) {
  return { ...env, KAIF_VOICE_TOOL: env.KAIF_VOICE_TOOL || VOICE_TOOL, KAIF_VOICE: env.KAIF_VOICE || VOICE };
}

const HELP = [
  'tools/ask.mjs — вход KAGO в контур согласований KAIF 2.8 (plans/104).',
  'Передаёт все аргументы поставляемому контуру .kaif/tools/contour/review.mjs и даёт ему голос KAGO',
  '(KAIF_VOICE_TOOL = ' + VOICE_TOOL + ', KAIF_VOICE = ' + VOICE + ') — только своему дочернему процессу.',
  '',
  '  node tools/ask.mjs <документ.md>              страница вопросов: ответы по одному, окно живёт до последнего',
  '  node tools/ask.mjs --wait <документ.md>       сторож: код 0 на каждую запись ответа, 2 — контур кончился без ответа',
  '  node tools/ask.mjs --call "<что нужно>"      зов владельцу: гудки → баннер → голос (--dry-run — без звука)',
  '  node tools/ask.mjs --search "<вопрос>"       поиск прошлого ответа перед вопросом владельцу',
  '  node tools/ask.mjs --queue                    одна страница «накопилось N» по всем ждущим документам (npm run ask:batch)',
  '  node tools/ask.mjs --selftest                 самопроверка поставляемого контура (без браузера)',
  '',
  'Старая страница проекта (tools/review.mjs) снята словом владельца 2026-09-26 — interviews/interview_032, Q2 = A.',
].join('\n');

function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return Promise.resolve(0); }
  return new Promise((done) => {
    const child = spawn(process.execPath, [CONTOUR, ...argv], { stdio: 'inherit', env: contourEnv() });
    child.on('exit', (code, signal) => done(code ?? (signal ? 130 : 1)));
    child.on('error', (e) => { console.error('✖ ask: ' + e.message); done(1); });
  });
}

// СТОРОЖ ВХОДА — вход исполняется ТОЛЬКО как программа, никогда при импорте (`bugs/95`).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
