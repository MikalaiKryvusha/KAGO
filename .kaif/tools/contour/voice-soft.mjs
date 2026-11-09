#!/usr/bin/env node
// voice-soft.mjs — the soft voice of KAIF and the project's log of what the agent said aloud (optional contour module; 2.10, decision №156).
//
// Two jobs, one tool:
//   1. THE SOFT VOICE. A rich engine of the machine renders the phrase into a WAV; ffmpeg then gives it the timbre and pace the KAIF owner
//      tuned by ear on a field deployment: a lead silence (the sound device swallows the first samples), the contour's three beeps in the
//      SAME file, a pause after them, the speech slowed without changing its pitch, more bass, the highs cut. Every number is a named
//      constant in SOFT below. The tool honours the contour's KAIF_VOICE_TOOL contract (`<phrase> --play|--out <wav> --voice <name>`), so
//      a project points the contour at it: KAIF_VOICE_TOOL=<abs path to this file>, KAIF_VOICE_BEEPS=embedded (the beeps live in its file).
//   2. THE VOICE LOG. Every phrase the agent says through it (and every `review.mjs --call`) is kept as a text file in the project —
//      `<project>/voice/<YYYY-MM-DD_HH-MM-SS>_<meaning>.txt` — so the owner reads what was said and the project's history keeps it. The
//      agent WRITES the phrase file first (the owner sees the Write in the harness) and speaks it with `--file`; the moment in the name is
//      the machine's clock at the moment of speaking — the tool renames a file whose stamp is stale, never trusts the agent's sense of time.
//
// Engines (machine resources, reached through the environment, never a path inside the project):
//   KAIF_VOICE_RENDER    — JSON array, a command prefix called with `<text> <out.wav> <voice>` (e.g. a renderer with longer pauses on
//                          punctuation); tried first;
//   KAIF_VOICE_BASE_TOOL — a node script `<text> --voice <name> --out <wav>`; the fallback;
//   neither, or both failing → exit 2: the contour then drops to the system voice (I35).
// Without ffmpeg the raw render is used untuned, and the line says so.
//
// Use:  node .kaif/tools/contour/voice-soft.mjs --file voice/<stamp>_<meaning>.txt --play
//       node .kaif/tools/contour/voice-soft.mjs "<phrase>" --play [--slug <meaning>] [--voice <name>] [--out <wav>] [--no-beeps] [--dry-run]
//       node .kaif/tools/contour/voice-soft.mjs --selftest
// Exit: 0 done · 1 usage · 2 no engine rendered the phrase · 3 ffmpeg or the player failed.
// [TESTED: 2026-11-07 · selftest 13/13; a phrase rendered through the origin's engines is byte-identical to the field deployment's soft voice; --call
//  through the real CLI writes one log file — report testcases/reports/2026-11-07_voice-soft-kumm-settings.md]
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, resolve, dirname, basename, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ── The tuned sound — the numbers of the owner's ear (decision №156: the field deployment's settings, taken as they stand) ──────────────
export const SOFT = Object.freeze({
  DEVICE_WAKE_SEC: 1.0,   // the file opens with silence — the device eats the first samples while it wakes up
  BEEPS: Object.freeze([{ hz: 880, sec: 0.16 }, { hz: 660, sec: 0.16 }, { hz: 990, sec: 0.26 }]), // the contour's own call tones
  BEEP_VOLUME: 2.5,       // ffmpeg's sine is 1/8 of full scale; ×2.5 — the quieter beeps the owner asked for (KAIF_VOICE_BEEP_VOLUME overrides)
  LEAD_SILENCE_MS: 2000,  // after the beeps, before the first word
  TEMPO: Number(process.env.KAIF_VOICE_TEMPO) > 0 ? Number(process.env.KAIF_VOICE_TEMPO) : 0.90, // slower speech; atempo keeps the pitch (KAGO 2026-11-09: KAIF_VOICE_TEMPO overrides — upstream candidate)
  BASS_GAIN_DB: 6,        // more bass …
  BASS_FREQ_HZ: 140,      // … around this frequency
  LOWPASS_HZ: 4200,       // the highs cut — a softer voice
  VOLUME: 0.9,
  RATE: 48000,
});
const RENDER_TIMEOUT_MS = 60000;   // a cold neural engine loads its model first
const DEFAULT_VOICE = 'eugene';    // the timbre the owner chose by ear; `--voice` and KAIF_VOICE override
export const DEFAULT_VOICE_LOG_DIR = 'voice';
const KAIF_JSON = join('.kaif', 'kaif.json');
const SLUG_WORDS = 6;              // the meaning of a phrase — its first words
const SLUG_MAX = 60;               // characters; a file name stays readable in a listing
const FRESH_STAMP_SEC = 120;       // a full stamp this close to the clock is kept as written
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})(?:-(\d{2}))?(?:_|$)/;

// ── The voice log — pure helpers (the selftest judges them) ────────────────────────────────────────────────────────────────────────────
// The project root: the nearest directory upward holding .kaif/kaif.json; none — the starting directory.
export function projectRoot(start = process.cwd()) {
  let d = resolve(start);
  for (;;) {
    if (existsSync(join(d, KAIF_JSON))) return d;
    const up = dirname(d);
    if (up === d) return resolve(start);
    d = up;
  }
}
const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
// The log directory — `.kaif/kaif.json` → `contour.voiceLog` (relative to the project), default `voice`.
export function voiceLogDir(root) {
  const c = (readJson(join(root, KAIF_JSON)) || {}).contour || {};
  return String(c.voiceLog || DEFAULT_VOICE_LOG_DIR).replace(/\\/g, '/').replace(/\/+$/, '');
}
const pad = (n) => String(n).padStart(2, '0');
// The moment as a file name wants it: local time, `YYYY-MM-DD_HH-MM-SS`.
export function stampOf(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds());
}
// The meaning of a text as a file name: its first words, lower case, letters and digits of any script joined by «-» (letters kept as written).
export function slugOf(text) {
  const words = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  let s = words.slice(0, SLUG_WORDS).join('-');
  if (s.length > SLUG_MAX) s = s.slice(0, SLUG_MAX).replace(/-[^-]*$/, '') || s.slice(0, SLUG_MAX);
  return s || 'phrase';
}
// The meaning the agent put into a file name — the name without its stamp and extension; nothing left → null.
export function meaningOfName(name) {
  const bare = basename(String(name)).replace(/\.txt$/i, '').replace(STAMP_RE, '');
  const s = slugOf(bare);
  return s === 'phrase' && !/[\p{L}\p{N}]/u.test(bare) ? null : s;
}
// The moment a stamped name claims, or null.
export function stampMoment(name) {
  const m = STAMP_RE.exec(basename(String(name)));
  if (!m || m[6] === undefined) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}
const inside = (dir, p) => { const r = relative(dir, resolve(p)); return !!r && !r.startsWith('..') && !r.includes(':') && !r.startsWith(sep); };
// Keep the phrase in the project's voice log. A phrase file the agent wrote INSIDE the log keeps its place (renamed when its stamp is not
// the clock's or misses the seconds); a file elsewhere (a scratchpad) is copied, its original left alone; a bare phrase gets a new file.
// The same moment and meaning with a different text never overwrites — «-2», «-3» is added. Returns the path relative to the root.
export function logPhrase(root, phrase, { file = null, slug = null, now = new Date() } = {}) {
  const dir = resolve(root, voiceLogDir(root));
  mkdirSync(dir, { recursive: true });
  const text = String(phrase).trim() + '\n';
  if (file && inside(dir, file) && dirname(resolve(file)) === dir) {
    const at = stampMoment(file);
    if (at && Math.abs(now - at) <= FRESH_STAMP_SEC * 1000 && meaningOfName(file)) return relative(root, resolve(file)).replace(/\\/g, '/');
  }
  const meaning = slug ? slugOf(slug) : (file && meaningOfName(file)) || slugOf(phrase);
  const base = stampOf(now) + '_' + meaning;
  let target = join(dir, base + '.txt');
  for (let i = 2; existsSync(target) && resolve(target) !== resolve(file || '') && readFileSync(target, 'utf8') !== text; i++) target = join(dir, base + '-' + i + '.txt');
  if (file && resolve(file) === resolve(target)) return relative(root, target).replace(/\\/g, '/');
  if (file && inside(dir, file) && dirname(resolve(file)) === dir) renameSync(resolve(file), target);
  else if (!existsSync(target)) writeFileSync(target, text, 'utf8');
  return relative(root, target).replace(/\\/g, '/');
}

// ── The sound ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// The ffmpeg filter graph: [lead silence][beeps…][the tuned voice], one mono file at SOFT.RATE. Pure — the selftest reads its numbers.
export function softFilter({ beeps = true, beepVolume = SOFT.BEEP_VOLUME } = {}) {
  const S = SOFT;
  const voiceChain = `adelay=${S.LEAD_SILENCE_MS}:all=1,atempo=${S.TEMPO},bass=g=${S.BASS_GAIN_DB}:f=${S.BASS_FREQ_HZ},lowpass=f=${S.LOWPASS_HZ},volume=${S.VOLUME}`;
  const lead = `anullsrc=r=${S.RATE}:cl=mono,atrim=duration=${S.DEVICE_WAKE_SEC}[s0]`;
  const voice = `[0:a]aresample=${S.RATE},aformat=channel_layouts=mono,${voiceChain}[v]`;
  if (!beeps) return `${lead};${voice};[s0][v]concat=n=2:v=0:a=1[out]`;
  const tones = S.BEEPS.map((b, i) => `sine=f=${b.hz}:d=${b.sec}:sample_rate=${S.RATE},volume=${beepVolume},aformat=channel_layouts=mono[b${i}]`).join(';');
  return `${lead};${tones};${voice};[s0]` + S.BEEPS.map((_, i) => `[b${i}]`).join('') + `[v]concat=n=${S.BEEPS.length + 2}:v=0:a=1[out]`;
}
function renderRaw(phrase, raw, voice, log) {
  const tried = [];
  let cmd = null;
  try { cmd = process.env.KAIF_VOICE_RENDER ? JSON.parse(process.env.KAIF_VOICE_RENDER) : null; } catch { tried.push('KAIF_VOICE_RENDER is not a JSON array'); }
  if (Array.isArray(cmd) && cmd.length) {
    const r = spawnSync(cmd[0], [...cmd.slice(1), phrase, raw, voice], { encoding: 'utf8', timeout: RENDER_TIMEOUT_MS, windowsHide: true });
    if (r.status === 0 && existsSync(raw)) return 'KAIF_VOICE_RENDER';
    tried.push('KAIF_VOICE_RENDER exit ' + r.status + ' ' + String(r.stderr || r.error || '').slice(-200));
  }
  if (process.env.KAIF_VOICE_BASE_TOOL) {
    const r = spawnSync(process.execPath, [process.env.KAIF_VOICE_BASE_TOOL, phrase, '--voice', voice, '--out', raw], { encoding: 'utf8', timeout: RENDER_TIMEOUT_MS, windowsHide: true });
    if (r.status === 0 && existsSync(raw)) return 'KAIF_VOICE_BASE_TOOL';
    tried.push('KAIF_VOICE_BASE_TOOL exit ' + r.status + ' ' + String(r.stderr || r.error || '').slice(-200));
  }
  log('voice-soft: no engine rendered the phrase (' + (tried.join(' · ') || 'neither KAIF_VOICE_RENDER nor KAIF_VOICE_BASE_TOOL is set') + ')');
  return null;
}
function playWav(file) {
  const q = String(file).replace(/'/g, "''");
  const r = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${q}').PlaySync()`], { windowsHide: true, timeout: RENDER_TIMEOUT_MS })
    : process.platform === 'darwin' ? spawnSync('afplay', [file], { timeout: RENDER_TIMEOUT_MS })
      : spawnSync('aplay', ['-q', file], { timeout: RENDER_TIMEOUT_MS });
  return r.status === 0;
}

// ── The selftest — the log and the filter, no sound ────────────────────────────────────────────────────────────────────────────────────
export function voiceSoftSelftest(log = console.log) {
  let n = 0, bad = 0;
  const ok = (cond, name) => { n++; if (!cond) { bad++; log('  x ' + name); } else log('  v ' + name); };
  const at = new Date(2026, 10, 7, 11, 32, 5);
  ok(stampOf(at) === '2026-11-07_11-32-05', 'voice log: the stamp is local YYYY-MM-DD_HH-MM-SS');
  // fixtures in Latin and Greek: the EN payload body carries no Cyrillic (invariant §9.11); Greek proves «letters of any script»
  ok(slugOf('Kit, checking the frame in the loot window. The game comes forward') === 'kit-checking-the-frame-in-the' && slugOf('...') === 'phrase'
    && slugOf('Καλημέρα: v2.10 «ok»') === 'καλημέρα-v2-10-ok', 'voice log: the meaning is the first six words of any script, letters as written, nothing → "phrase"');
  ok(meaningOfName('2026-11-07_11-32_checking-the-frame.txt') === 'checking-the-frame' && meaningOfName('2026-11-07_11-32-05.txt') === null
    && meaningOfName('v3.txt') === 'v3', 'voice log: the meaning of a name is the name without its stamp; a bare stamp has none');
  const r = mkdtempSync(join(tmpdir(), 'kaif-voice-log-'));
  try {
    mkdirSync(join(r, '.kaif'), { recursive: true });
    writeFileSync(join(r, KAIF_JSON), '{}');
    mkdirSync(join(r, 'src', 'deep'), { recursive: true });
    ok(projectRoot(join(r, 'src', 'deep')) === resolve(r), 'voice log: the project root is found upward by .kaif/kaif.json');
    const p1 = logPhrase(r, 'Kit, checking the frame.', { now: at });
    ok(p1 === 'voice/2026-11-07_11-32-05_kit-checking-the-frame.txt' && readFileSync(join(r, p1), 'utf8') === 'Kit, checking the frame.\n',
      'voice log: a bare phrase becomes voice/<stamp>_<meaning>.txt with its text');
    ok(logPhrase(r, 'Kit, checking the frame.', { now: at }) === p1 && readdirSync(join(r, 'voice')).length === 1,
      'voice log: the same phrase at the same moment is not written twice');
    const p2 = logPhrase(r, 'Another phrase.', { now: at, slug: 'Kit checking the frame' });
    ok(p2 === 'voice/2026-11-07_11-32-05_kit-checking-the-frame-2.txt', 'voice log: the same name with another text gets «-2», nothing is overwritten');
    const scratch = join(r, 'scratch.txt');
    writeFileSync(scratch, 'The build runs.');
    const p3 = logPhrase(r, 'The build runs.', { file: scratch, now: at });
    ok(p3 === 'voice/2026-11-07_11-32-05_scratch.txt' && existsSync(scratch), 'voice log: a phrase file outside the log is copied in, the original left');
    const stale = join(r, 'voice', '2026-11-07_09-00_πολύγωνο-green.txt');
    writeFileSync(stale, 'The polygon is green.');
    const p4 = logPhrase(r, 'The polygon is green.', { file: stale, now: at });
    ok(p4 === 'voice/2026-11-07_11-32-05_πολύγωνο-green.txt' && !existsSync(stale), 'voice log: a file in the log with a stale or minute-only stamp is renamed to the clock\'s moment, its meaning kept');
    const fresh = join(r, 'voice', '2026-11-07_11-31-30_judge-ready.txt');
    writeFileSync(fresh, 'The judge is ready.');
    ok(logPhrase(r, 'The judge is ready.', { file: fresh, now: at }) === 'voice/2026-11-07_11-31-30_judge-ready.txt' && existsSync(fresh),
      'voice log: a full stamp within two minutes of the clock is kept as the agent wrote it');
    writeFileSync(join(r, KAIF_JSON), JSON.stringify({ contour: { voiceLog: 'docs/said/' } }));
    ok(logPhrase(r, 'Done.', { now: at }) === 'docs/said/2026-11-07_11-32-05_done.txt', 'voice log: contour.voiceLog names another folder');
  } finally { rmSync(r, { recursive: true, force: true }); }
  const f = softFilter();
  ok(f.includes('atempo=0.9,') && f.includes('bass=g=6:f=140') && f.includes('lowpass=f=4200') && f.includes('adelay=2000:all=1')
    && f.includes('atrim=duration=1[s0]') && f.includes('sine=f=880:d=0.16') && f.includes('volume=2.5,') && f.includes('concat=n=5:'),
    'soft voice: the filter carries the tuned numbers — tempo 0.90, bass +6 dB at 140 Hz, lowpass 4200 Hz, 1 s wake, 3 beeps at ×2.5, 2 s before the words');
  ok(softFilter({ beeps: false }).includes('concat=n=2:') && !softFilter({ beeps: false }).includes('sine='), 'soft voice: --no-beeps — silence and the voice only');
  log((bad ? '✖' : '✔') + ' voice-soft selftest: ' + (n - bad) + ' of ' + n);
  return bad;
}

// ── The CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function main(args) {
  if (args.includes('--selftest')) process.exit(voiceSoftSelftest() ? 1 : 0);
  const val = (n) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
  const file = val('--file');
  const valueOf = new Set(['--file', '--out', '--voice', '--slug'].map((n) => args.indexOf(n) + 1).filter((i) => i > 0));
  const positional = args.find((a, i) => !a.startsWith('--') && !valueOf.has(i));
  const phrase = file ? (existsSync(file) ? readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim() : '') : (positional || '').trim();
  if (!phrase) {
    console.error('usage: node voice-soft.mjs --file <phrase.txt> --play | "<phrase>" --play [--slug <meaning>] [--voice <name>] [--out <wav>] [--no-beeps] [--dry-run] | --selftest'
      + (file ? '\n✖ the phrase file is missing or empty: ' + file : ''));
    process.exit(1);
  }
  // the contour logs the phrases it calls with itself (KAIF_VOICE_LOGGED=1 in the child's environment) — never twice
  if (process.env.KAIF_VOICE_LOGGED !== '1') {
    const root = projectRoot();
    console.log('voice log: ' + logPhrase(root, phrase, { file, slug: val('--slug') }));
  }
  const voiceArg = val('--voice');
  const voice = voiceArg && voiceArg !== 'default' ? voiceArg : (process.env.KAIF_VOICE && process.env.KAIF_VOICE !== 'default' ? process.env.KAIF_VOICE : DEFAULT_VOICE);
  const beeps = !args.includes('--no-beeps');
  const beepVolume = Number(process.env.KAIF_VOICE_BEEP_VOLUME) > 0 ? Number(process.env.KAIF_VOICE_BEEP_VOLUME) : SOFT.BEEP_VOLUME;
  const filter = softFilter({ beeps, beepVolume });
  if (args.includes('--dry-run')) { console.log('voice-soft (dry run, no sound): voice ' + voice + ' · filter ' + filter); return; }
  const dir = mkdtempSync(join(tmpdir(), 'kaif-voice-soft-')); // a unique folder per run — two calls never share a file (bugs/59 of the origin)
  const done = (code) => { rmSync(dir, { recursive: true, force: true }); if (code) process.exit(code); };
  const raw = join(dir, 'raw.wav');
  const out = val('--out') ? resolve(val('--out')) : join(dir, 'soft.wav');
  const engine = renderRaw(phrase, raw, voice, console.error);
  if (!engine) done(2);
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-filter_complex', filter, '-map', '[out]', '-c:a', 'pcm_s16le', out], { encoding: 'utf8', timeout: RENDER_TIMEOUT_MS, windowsHide: true });
  if (ff.error && ff.error.code === 'ENOENT') { copyFileSync(raw, out); console.log('voice-soft: no ffmpeg on this machine — the voice is played untuned (' + engine + ')'); }
  else if (ff.status !== 0) { console.error('voice-soft: ffmpeg failed: ' + String(ff.stderr || ff.error || '').slice(-300)); done(3); }
  else console.log('voice-soft: ' + out + ' (' + engine + ', voice ' + voice + ')');
  if (args.includes('--play') && !playWav(out)) { console.error('voice-soft: the sound could not be played'); done(3); }
  done(0);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) main(process.argv.slice(2));
export const VOICE_SOFT_FILE = fileURLToPath(import.meta.url);
