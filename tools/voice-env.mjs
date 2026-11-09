// tools/voice-env.mjs — голос KAGO, одно место (DRY): его читают tools/say.mjs (озвучка фразы из файла) и tools/ask.mjs (зов контура).
// Голос — мягкий голос KAIF 2.10 (voice-soft.mjs, решение №156) с настройками, которые владелец подобрал на слух в KUMM:
// тот же рендерер Silero eugene с удвоенными паузами (D:/work/ai_sandbox/tools/silero_tts), писки 2,5 в том же файле, 1 с тишины
// впереди (защита от обрезания начала устройством). Темп: KUMM 0,90 → KAGO 0,99 — владелец 2026-11-09: «в KUMM голос настроен, вот
// его чуть-чуть бы ускорить» (0,945), затем «чуть-чуть быстрее голос» (0,99). Переменная, заданная снаружи, сильнее дефолта.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TTS = 'D:/work/ai_sandbox/tools/silero_tts';
export const VOICE_SOFT = resolve(ROOT, '.kaif', 'tools', 'contour', 'voice-soft.mjs');
export const VOICE_DEFAULTS = {
  KAIF_VOICE_TOOL: VOICE_SOFT,
  KAIF_VOICE_RENDER: JSON.stringify([TTS + '/venv/Scripts/python.exe', '-I', TTS + '/voice/soft_say.py']),
  KAIF_VOICE_BASE_TOOL: TTS + '/voice-say.mjs',
  KAIF_VOICE: 'eugene',
  KAIF_VOICE_BEEPS: 'embedded',
  KAIF_VOICE_BEEP_VOLUME: '2.5',
  KAIF_VOICE_TEMPO: '0.99',
};
// KAGO_* переменные — переопределение машины; KAIF_VOICE_* из окружения пользователя (там старый сырой Silero) НЕ побеждают.
export function voiceEnv(env = process.env) {
  const out = { ...env };
  for (const [k, v] of Object.entries(VOICE_DEFAULTS)) out[k] = env[k.replace(/^KAIF_/, 'KAGO_')] || v;
  return out;
}
