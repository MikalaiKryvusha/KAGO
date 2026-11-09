#!/usr/bin/env node
// tools/say.mjs — голос KAGO: «сначала файл» (правило KUMM / KAIF 2.10, владелец 2026-11-09: «все фразы нужно в TXT класть»).
// Агент СНАЧАЛА пишет фразу командой записи в voice/<YYYY-MM-DD_HH-MM-SS>_<смысл латиницей>.txt (папка коммитится — история
// проекта), фраза начинается обращением «Николай, это КАГО, …»; ЗАТЕМ озвучивает:
//   node tools/say.mjs voice/<…>.txt
// Внутри — voice-soft.mjs --file <txt> --play с голосом KAGO (tools/voice-env.mjs): 1 с тишины, три писка и голос одним файлом.
// Читать его строки «voice log:» / «voice-soft:» и код выхода (0 — прозвучало).
import { spawnSync } from 'node:child_process';
import { voiceEnv, VOICE_SOFT } from './voice-env.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node tools/say.mjs voice/<YYYY-MM-DD_HH-MM-SS>_<meaning>.txt'); process.exit(1); }
const r = spawnSync(process.execPath, [VOICE_SOFT, '--file', file, '--play'], { stdio: 'inherit', env: voiceEnv(), timeout: 180000 });
process.exit(r.status ?? 3);
