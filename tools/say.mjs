#!/usr/bin/env node
// tools/say.mjs — голос KAGO = голос машины «мягкий голос с Glass» (D:/work/ai_sandbox/tools/silero_tts/say.py; правила — VOICE_RULES.md там же).
// Владелец 2026-11-09: «финальный голос и звук — Голос владельца — мягкий голос с Glass.md. Вот его бери себе и во все проекты Николая».
// «Сначала файл»: агент пишет фразу командой записи в voice/<YYYY-MM-DD_HH-MM-SS>_<смысл латиницей>.txt, фраза начинается «Николай, это КАГО. …»
// (кириллицей, цифры словами), затем:
//   node tools/say.mjs voice/<…>.txt                    — озвучить файл фразы
//   node tools/say.mjs "<фраза>" --play [--voice x]     — контракт KAIF_VOICE_TOOL (так зовёт контур tools/ask.mjs --call)
// Читать строку «soft voice:» и код выхода (0 — прозвучало). Голосовой вызов запускать фоном (правило 5 VOICE_RULES).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { voiceEnv, VOICE_PY, VOICE_SAY } from './voice-env.mjs';

const args = process.argv.slice(2);
const first = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--voice');
if (!first) { console.error('usage: node tools/say.mjs voice/<stamp>_<meaning>.txt | "<phrase>" --play'); process.exit(1); }
const isFile = /\.txt$/i.test(first) && existsSync(first);
const pyArgs = ['-I', VOICE_SAY, ...(isFile ? ['--file', first] : [first])];
if (args.includes('--no-play')) pyArgs.push('--no-play');
const r = spawnSync(VOICE_PY, pyArgs, { stdio: 'inherit', env: voiceEnv(), timeout: 180000 });
process.exit(r.status ?? 3);
