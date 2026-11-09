// tools/voice-env.mjs — голос KAGO, одно место (DRY): его читают tools/say.mjs и tools/ask.mjs (зов контура).
// С 2026-11-09 — голос машины «мягкий голос с Glass» (QA_Engineer, подобран владельцем на слух): 1 с тишины → Glass → 2 с → Silero eugene,
// темп 1,08, бас +6 дБ, без среза высоких — всё одним файлом в D:/work/ai_sandbox/tools/silero_tts/say.py (правила — VOICE_RULES.md там же).
// Владелец: «финальный голос и звук … Вот его бери себе и во все проекты Николая». Контур не играет своих писков (KAIF_VOICE_BEEPS=embedded).
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TTS = process.env.KAGO_VOICE_DIR || 'D:/work/ai_sandbox/tools/silero_tts';
export const VOICE_PY = TTS + '/venv/Scripts/python.exe';
export const VOICE_SAY = TTS + '/say.py';
export const VOICE_DEFAULTS = {
  KAIF_VOICE_TOOL: resolve(ROOT, 'tools', 'say.mjs'),
  KAIF_VOICE: 'eugene',
  KAIF_VOICE_BEEPS: 'embedded',
};
// KAIF_VOICE_* из окружения пользователя (там старый сырой Silero) НЕ побеждают; KAGO_VOICE_* — переопределение машины.
export function voiceEnv(env = process.env) {
  const out = { ...env };
  for (const [k, v] of Object.entries(VOICE_DEFAULTS)) out[k] = env[k.replace(/^KAIF_/, 'KAGO_')] || v;
  return out;
}

// Запуск напрямую — показать голос KAGO (библиотека; сторож входа, bugs/95).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.slice(2).includes('--help')) { console.log("node tools/voice-env.mjs — print KAGO voice env (library for say.mjs / ask.mjs)"); process.exit(0); }
  console.log(JSON.stringify({ VOICE_PY, VOICE_SAY, ...VOICE_DEFAULTS }, null, 2));
}
