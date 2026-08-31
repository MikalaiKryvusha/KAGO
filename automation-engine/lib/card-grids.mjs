#!/usr/bin/env node
// automation-engine/lib/card-grids.mjs — THE TWO DICTIONARIES THE CARD IS ASKED FOR, as artifacts.
//
// Plan anchor (plans/14 §4.1, executing the owner's `ideas/03` steps 3–4): *«У видеокарты
// спрашивается полная сетка всех напряжений, которые она может обеспечивать, с минимальным шагом.
// Она сохраняется в отдельный JSON-словарь… То же для частот.»*
//
// ─── WHY AN ARTIFACT AND NOT A FUNCTION CALL ────────────────────────────────────────────────────
//
// Both grids are READABLE at any moment — `nvapi --curve` for voltages, `nvidia-smi -q -d
// SUPPORTED_CLOCKS` for frequencies — and until now every consumer re-derived them. That is the drift
// class the truth↔mirror registry exists for: five modules each holding their own copy of one fact,
// none of them wrong on the day it was written. Written down ONCE, stamped with the driver and VBIOS
// they were taken under, and re-derivable by the command printed inside the file itself.
//
// ─── THE ONE THING THAT SURPRISES EVERY READER ──────────────────────────────────────────────────
//
// **The V/F table IS the voltage grid.** There is no finer voltage the card can be asked for: the
// 127 graphics points ARE the rungs, and asking for «5 mV lower» means «the next point down». And the
// grid is NOT uniform — measured on this card 2026-08-15: 5 mV in 94 places and 10 mV in 32. Any code
// that steps by a millivolt count instead of by points will eventually ask for a voltage that does
// not exist. `spacingsMv` is written into the artifact so that fact is impossible to miss.
//
// GPU WRITES: none, ever. Both probes are reads.
//
// Usage (the CLI lives in curve-store.mjs, which owns the user-facing command):
//   import { buildGrids, writeGrids, loadGrid } from './card-grids.mjs';
//
// [NOT-TESTED] — born 2026-08-15 with plan 14; flips on the observation in §7 of that plan.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CLK_VF_POINT_COUNT, CURVE_GRAPHICS_POINT_COUNT } from '../config.mjs';
import { ladderFromSupportedClocks } from './profile-store.mjs';

/** Resolved from THIS file, never from the caller's cwd — a shortcut launched from the owner's
 *  Desktop runs with a cwd nobody chose (the same reason `PROFILES_DIR` does it). */
export const CURVES_DIR = fileURLToPath(new URL('../../curves/', import.meta.url));
const GPU_INFO = fileURLToPath(new URL('../../tools/gpu-info.mjs', import.meta.url));

export const VOLTAGE_GRID_FILE = 'voltage-grid.json';
export const FREQUENCY_GRID_FILE = 'frequency-grid.json';

/** The commands that re-derive each artifact. They are STORED INSIDE the artifact so a future session
 *  can re-derive one value without re-deriving the procedure (the dossier's own rule). */
export const PROBE_COMMANDS = Object.freeze({
  voltage: 'npm run nvapi -- --curve',
  frequency: 'nvidia-smi -q -d SUPPORTED_CLOCKS',
  both: 'npm run curve -- --grids',
});

// =================================================================================================
// 1. The atomic write — shared, because the curve document's whole design rests on it
// =================================================================================================

/**
 * Write JSON so a crash mid-save leaves either the OLD file or the NEW one, never a truncated one.
 *
 * WHY THIS IS NOT PRUDENCE HERE. The owner settled 2026-08-15 that a hang is an ACCEPTED, NORMAL
 * event during the edge search (`GOAL.md` → «⚠️ ЗАВИСАНИЕ — ОСОЗНАННЫЙ РИСК»). So «the machine died
 * while we were writing this file» is a case this code must HANDLE, not a case it may hope to avoid —
 * and the curve document is the sweep's entire memory. Temp-file + rename is atomic on NTFS.
 *
 * The temp file is created in the SAME directory on purpose: a rename across volumes is a copy, and a
 * copy is not atomic.
 */
export function writeJsonAtomic(file, value, { fs = null } = {}) {
  const io = fs ?? { writeFileSync, renameSync, mkdirSync, existsSync, rmSync };
  const dir = path.dirname(file);
  if (!io.existsSync(dir)) io.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    io.writeFileSync(tmp, text, 'utf8');
    io.renameSync(tmp, file);
  } catch (e) {
    // Leave no half-written temp behind for the next run to trip over.
    try { if (io.existsSync(tmp)) io.rmSync(tmp); } catch { /* the original error is the one that matters */ }
    throw e;
  }
  return file;
}

// =================================================================================================
// 2. The probes — reads only
// =================================================================================================

/** The card as `gpu-info --json` reports it. Called through `process.execPath`, never `npm.cmd`:
 *  this Node refuses to execFile a `.cmd` without a shell (the dossier's own entry). */
export function probeGpuInfo() {
  const r = spawnSync(process.execPath, [GPU_INFO, '--json'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw new Error(`карта не прочитана: gpu-info вышел с кодом ${r.status ?? '—'} ${(r.stderr ?? '').trim()}`);
  }
  return JSON.parse(r.stdout);
}

/**
 * The frequency grid, from the driver's own list of applicable graphics clocks.
 *
 * `supported_clocks` is reported per memory rung; every full rung offers the SAME graphics ladder
 * (measured, phase 1), so the distinct union IS the ladder. Sorted DESCENDING because the sweep walks
 * it top-down (`ideas/03` step 6) and a list stored in the order it is consumed is one fewer place to
 * get a direction wrong.
 */
export function frequencyGridFrom(gpuInfo) {
  // THE PARSER IS BORROWED, NOT REWRITTEN — and the first draft of this function paid for learning
  // why. `profile-store` says it in its own comment: «a second copy of it would be a truth↔mirror
  // pair nobody asked for — EXP-0013: a pair you can DELETE beats a pair you must WATCH». The draft
  // guessed the shape (`supported_clocks` as an array of rungs), produced an EMPTY ladder on the live
  // card, and only the validator below stopped it from shipping. `ladderFromSupportedClocks` also
  // refuses on a real condition this guess ignored: rungs whose ladders DIFFER must not be silently
  // unioned.
  const ladder = ladderFromSupportedClocks(gpuInfo.supported_clocks);
  if (!ladder.ok) throw new Error(`лестница частот не прочитана: ${ladder.why}`);
  const values = [...ladder.mhz].sort((a, b) => b - a);

  const steps = new Map();
  for (let i = 1; i < values.length; i++) {
    const d = values[i - 1] - values[i];
    steps.set(d, (steps.get(d) ?? 0) + 1);
  }

  return {
    kind: 'frequency-grid',
    probe: PROBE_COMMANDS.frequency,
    source: 'nvidia-smi → supported_clocks, объединение по всем ступеням памяти (все полные ступени дают одну лестницу)',
    order: 'descending',
    count: values.length,
    rangeMhz: values.length ? [values[values.length - 1], values[0]] : [],
    stepsMhz: [...steps.entries()].sort((a, b) => a[0] - b[0]).map(([mhz, count]) => ({ mhz, count })),
    // R13's ceiling, and it lives HERE because it is a property of this ladder: the highest clock the
    // driver will apply. NOT the top of the V/F table — that reads 3172 on this card while the maximum
    // is 3090, and the 82 MHz between them is the gap `bugs/11` escaped through.
    maxGraphicsMhz: values.length ? values[0] : null,
    minGraphicsMhz: values.length ? values[values.length - 1] : null,
    values,
  };
}

/**
 * The voltage grid, from the live V/F curve.
 *
 * Point 127 is excluded everywhere in this project (measured outlier: 515 mV / 405 MHz against its
 * neighbour's 1240 mV / 3157 MHz), so the grid is the first `CURVE_GRAPHICS_POINT_COUNT` points.
 * Ascending, because voltage is the axis that does not move (`bugs/10`) and the document that keys by
 * point index reads most naturally in index order.
 */
export function voltageGridFrom(curvePoints) {
  const pts = curvePoints.slice(0, CURVE_GRAPHICS_POINT_COUNT);
  const values = pts.map((p) => p.mv);

  const spacings = new Map();
  for (let i = 1; i < values.length; i++) {
    const d = Math.round((values[i] - values[i - 1]) * 1000) / 1000;
    spacings.set(d, (spacings.get(d) ?? 0) + 1);
  }

  return {
    kind: 'voltage-grid',
    probe: PROBE_COMMANDS.voltage,
    source: `NvAPI ClkVfPointsGetStatus — ${CLK_VF_POINT_COUNT} записей, последняя не графическая и исключена`,
    order: 'ascending',
    count: values.length,
    rangeMv: values.length ? [values[0], values[values.length - 1]] : [],
    // THE FACT THAT DECIDES HOW CODE MAY STEP. The grid is not uniform, so «на 25 мВ ниже» is not a
    // subtraction — it is «the deepest point still at or above (current − 25)».
    spacingsMv: [...spacings.entries()].sort((a, b) => a[0] - b[0]).map(([mv, count]) => ({ mv, count })),
    uniform: spacings.size <= 1,
    values,
  };
}

/**
 * THE FACTORY BASE OF A LIVE TABLE — ONE copy of the arithmetic (`bugs/98` fix, `bugs/97` needs it too).
 *
 * `readVfCurve` reports the table ALREADY CARRYING OUR OFFSETS, while offsets are written ABSOLUTELY.
 * So the factory frequency of a point is «live minus that point's own offset», and every reader that
 * needs a base must do that subtraction. It was written out twice by hand (`resolveProfileCurve` and
 * `writeRaiseAndCap`) and the reference taker of `bugs/97` would have made three — so the ARITHMETIC
 * lives here once, and the POLICY (is the channel absent, or present-but-silent?) stays with each
 * caller, where the two legitimately differ: the twin has no bridge at all and works off the live
 * table, whereas a bridge that answered nothing must stop the write (`B98-base`).
 *
 * PURE ON PURPOSE — takes the two readings, touches no card. That is what lets the selftest prove the
 * subtraction with no GPU, and what lets a mutation redden it.
 *
 * `offsetsKhz` is what the card reports: kHz, one element per point. A point whose offset is missing is
 * treated as ZERO rather than refused — a shorter array is the caller's business to check, and the
 * caller does (`length >= points.length`).
 *
 * [NOT-TESTED] at birth — blocks and mutations in `curve --selftest`.
 */
export function factoryBaseFrom(livePoints, offsetsKhz) {
  return livePoints.map((pt, j) => (pt && Number.isFinite(pt.mhz)
    ? { ...pt, mhz: pt.mhz - Math.round((offsetsKhz?.[j] ?? 0) / 1000) }
    : pt));
}

/**
 * Read the live card and build both grids.
 *
 * The NvAPI import is DYNAMIC so that this module stays importable by pure consumers: the validator
 * and the curve document must not drag `koffi` in to learn a number (R3's spirit).
 */
export async function readLiveCurvePoints() {
  const nvapi = await import('./nvapi.mjs');
  const nv = nvapi.openNvapi();
  const { koffi, protos, resolve } = nv;
  koffi.call(resolve(0x0150E828).ptr, protos.Initialize);
  try {
    const handles = Buffer.alloc(64 * 8);
    const count = Buffer.alloc(4);
    koffi.call(resolve(0xE5AC921F).ptr, protos.EnumPhysicalGPUs, handles, count);
    const handle = handles.readBigUInt64LE(0);
    const curve = nvapi.readVfCurve(nv, handle);
    if (!curve.ok) throw new Error(`кривая не прочитана: ${curve.why}`);
    return curve.points;
  } finally {
    const unload = resolve(0xD22BDD7E);
    if (unload.ok) koffi.call(unload.ptr, protos.Unload);
  }
}

export async function buildGrids({ nowIso, gpuInfo = null, curvePoints = null } = {}) {
  const info = gpuInfo ?? probeGpuInfo();
  const points = curvePoints ?? await readLiveCurvePoints();

  const stamp = {
    driver: String(info.driver_version),
    vbios: String(info.vbios_version),
    takenAt: nowIso ?? localIso(),
  };
  const card = { name: String(info.name), maxGraphicsMhz: Number(info['clocks.max.graphics']) };

  return {
    voltage: { ...voltageGridFrom(points), card, stamp },
    frequency: { ...frequencyGridFrom(info), card, stamp },
  };
}

/** Local ISO 8601 WITH the offset. «Z» is refused across this project (EXP-0012): a stamp that hides
 *  which clock it was taken on cannot be compared with the owner's own account of when something ran. */
export function localIso(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

// =================================================================================================
// 3. Persistence and validation
// =================================================================================================

export function gridPath(kind, dir = CURVES_DIR) {
  return path.join(dir, kind === 'voltage' ? VOLTAGE_GRID_FILE : FREQUENCY_GRID_FILE);
}

/**
 * Write both dictionaries — but ONLY after each passes its own validator.
 *
 * The first live run of `--grids` wrote a frequency grid with ZERO values because the parser guessed
 * the input's shape wrong. The validator caught it and printed a refusal — **after** the file was on
 * disk. An artifact that its own validator rejects must never reach the disk in the first place:
 * the next session would load it, and «0 частот» is the kind of number that gets worked around
 * rather than questioned.
 */
export function writeGrids(grids, { dir = CURVES_DIR } = {}) {
  const problems = {
    voltage: validateGrid(grids.voltage, { kind: 'voltage' }),
    frequency: validateGrid(grids.frequency, { kind: 'frequency' }),
  };
  const bad = Object.entries(problems).filter(([, p]) => p.length > 0);
  if (bad.length) {
    const why = bad.map(([k, p]) => `${k}: ${p.map((x) => `${x.field} — ${x.why}`).join('; ')}`).join(' | ');
    throw new Error(`словарь не прошёл собственный валидатор и НЕ ЗАПИСАН (${why})`);
  }
  return {
    voltage: writeJsonAtomic(gridPath('voltage', dir), grids.voltage),
    frequency: writeJsonAtomic(gridPath('frequency', dir), grids.frequency),
  };
}

/** Pure: reads the artifact, no card. Returns `null` when it does not exist — a MISSING grid must be
 *  visible as missing, never papered over with a re-derivation nobody asked for. */
export function loadGrid(kind, { dir = CURVES_DIR } = {}) {
  const file = gridPath(kind, dir);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/u;
const refuse = (field, why) => ({ field, why });

/**
 * Validate a grid artifact. Pure — no card needed, so it is provable on hostile fixtures alone.
 */
export function validateGrid(doc, { kind = null } = {}) {
  const out = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return [refuse('<словарь>', 'ожидался JSON-объект')];
  }
  if (kind !== null && doc.kind !== `${kind}-grid`) {
    out.push(refuse('kind', `ожидался ${kind}-grid, получено ${JSON.stringify(doc.kind)}`));
  }
  if (typeof doc.probe !== 'string' || doc.probe.trim() === '') {
    out.push(refuse('probe', 'словарь обязан нести команду, которой он переснимается — иначе будущая сессия переизобретает процедуру, а не значение'));
  }

  const stamp = doc.stamp;
  if (!stamp || typeof stamp !== 'object') {
    out.push(refuse('stamp', 'штамп драйвера/VBIOS обязателен: сетка карты действительна только для драйвера, на котором снята (R6)'));
  } else {
    for (const k of ['driver', 'vbios']) {
      if (typeof stamp[k] !== 'string' || stamp[k].trim() === '') out.push(refuse(`stamp.${k}`, 'обязательное поле штампа'));
    }
    if (!LOCAL_ISO.test(String(stamp.takenAt))) {
      out.push(refuse('stamp.takenAt', `ожидался локальный ISO 8601 со смещением (2026-08-15T16:20:00+03:00), получено ${JSON.stringify(stamp.takenAt)}; «Z» отвергается намеренно — EXP-0012`));
    }
  }

  if (!Array.isArray(doc.values) || doc.values.length === 0) {
    out.push(refuse('values', 'пустой словарь — это не «нет данных», это ошибка снятия'));
    return out;
  }
  if (doc.count !== doc.values.length) {
    out.push(refuse('count', `count = ${doc.count}, а значений ${doc.values.length} — одно и то же число записано дважды и разошлось`));
  }
  const nonNumeric = doc.values.findIndex((v) => !Number.isFinite(v));
  if (nonNumeric !== -1) {
    out.push(refuse('values', `элемент ${nonNumeric} не число: ${JSON.stringify(doc.values[nonNumeric])}`));
  } else {
    const asc = doc.order === 'ascending';
    for (let i = 1; i < doc.values.length; i++) {
      const wrong = asc ? doc.values[i] <= doc.values[i - 1] : doc.values[i] >= doc.values[i - 1];
      if (wrong) {
        out.push(refuse('values', `порядок объявлен «${doc.order}», но элементы ${i - 1} и ${i} идут как ${doc.values[i - 1]} → ${doc.values[i]}`));
        break;
      }
    }
  }

  if (doc.kind === 'frequency-grid') {
    if (!Number.isFinite(doc.maxGraphicsMhz) || doc.maxGraphicsMhz <= 0) {
      out.push(refuse('maxGraphicsMhz', 'максимум экземпляра обязателен — это потолок R13, и без него запись в кривую запрещена'));
    } else if (Number.isFinite(doc.values?.[0]) && doc.maxGraphicsMhz !== Math.max(...doc.values)) {
      out.push(refuse('maxGraphicsMhz', `${doc.maxGraphicsMhz} МГц не совпадает с верхом самой лестницы ${Math.max(...doc.values)} МГц`));
    }
  }

  return out;
}

export default { CURVES_DIR, buildGrids, writeGrids, loadGrid, validateGrid, writeJsonAtomic, localIso };
