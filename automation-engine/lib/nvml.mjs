#!/usr/bin/env node
// nvml.mjs — a DIAGNOSTIC INSTRUMENT, not a backend. Its whole job is to answer one question that
// our own NVAPI struct cannot answer about itself: WHICH FIELD of the 72-byte ClkVfPointsSetControl
// record carries the frequency offset.
//
// ─── WHY THIS FILE EXISTS AT ALL, AND WHY IT IS NOT A SECOND WRITER ────────────────────────────────
//
// `researches/05` §5.5 states the constraint this module must not violate: NvAPI's `ClkVfPointsSetControl`
// and NVML's clock-offset calls "operate on the same hardware state and clobber each other. KAGO must
// own ONE path; mixing them would produce a state neither tool reports correctly."
//
// That is exactly WHY this instrument works — and exactly why it is quarantined:
//
//   • The shared state is the LEVER. Applying a known offset through NVIDIA's own DOCUMENTED API and
//     then re-reading OUR undocumented struct turns "which dword is the offset?" from a guess into a
//     subtraction. Two tools looking at one state is a defect for a product and a MEASUREMENT for a
//     probe (EXP-0017: a second, independently-authored reading of the same quantity).
//   • Therefore NVML is NEVER a KAGO backend, never called by `profile-manager.mjs`, and never used to
//     apply a profile. Rule R1 of the internal map is untouched: the shipping write path stays NvAPI
//     behind `profile-manager`. This module is a ruler you pick up, read, and put down.
//
// ─── THE OWNER'S-MACHINE RULE, WALKED IN ORDER (AGENT_GUIDE.md), BEFORE ANY WRITE EXISTS ───────────
//
//  1. LOOKED IT UP FIRST — in the vendor's own header on this machine, not a web page:
//     `C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.3\include\nvml.h`.
//     It says `nvmlDeviceSetGpcClkVfOffset` (the call STATUS.md pointed at) is DEPRECATED(13.0) in
//     favour of `nvmlDeviceSetClockOffsets`, whose struct carries min/max as OUTPUTS. So the modern
//     call is used, and the deprecated one is not called at all.
//  2. THE ROLLBACK, NAMED BEFORE THE WRITE: the same call with `clockOffsetMHz = 0`. The physical
//     backstop underneath it is the same one phases 2–4 rest on — clock offsets live in volatile
//     driver state, so a reboot clears them with no action from the owner.
//  3. SMALLEST REVERSIBLE FORM: the probe applies a NEGATIVE offset. A negative GPC clock offset makes
//     the card run SLOWER at the same voltage, which cannot destabilize anything — it is the safe
//     direction of this axis, and it is chosen deliberately over a "small" positive overclock.
//  4. RE-READ UNTIL STABLE: every offset read is polled until two consecutive samples agree (EXP-0014 —
//     a GPU write settles asynchronously and the first read can return the previous value).
//  5. REPORT THE NUMBERS: the CLI prints before/after/rollback side by side, never a bare "done".
//
// ─── THE STRUCT, QUOTED FROM THE HEADER (nvml.h lines 1176–1189) ───────────────────────────────────
//
//   typedef struct { unsigned int version; nvmlClockType_t type; nvmlPstates_t pstate;
//                    int clockOffsetMHz; int minClockOffsetMHz; int maxClockOffsetMHz; } nvmlClockOffset_v1_t;
//   #define NVML_STRUCT_VERSION(data, ver) (unsigned int)(sizeof(nvml##data##_v##ver##_t) | (ver << 24U))
//
// 6 fields x 4 bytes = 24 bytes; version = 24 | (1 << 24) = 0x01000018. A wrong version answers
// NVML_ERROR_ARGUMENT_VERSION_MISMATCH (25) — a clean refusal that changes nothing, the same probe
// signal NvAPI's -9 gives us.
//
// Usage:
//   node automation-engine/lib/nvml.mjs                READ-ONLY: driver, card, and the offset range
//
// [NOT-TESTED] at birth — the run that follows is what decides which of these lines is true.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

// =================================================================================================
// 1. The vocabulary — every value quoted from nvml.h, none invented
// =================================================================================================

/** nvmlReturn_t, the subset a probe must tell apart rather than swallow (nvml.h lines 1296–1327). */
export const NVML_STATUS = Object.freeze({
  0: 'SUCCESS',
  1: 'ERROR_UNINITIALIZED',
  2: 'ERROR_INVALID_ARGUMENT (device/type/pstate invalid, or the offset is out of the allowed range)',
  3: 'ERROR_NOT_SUPPORTED (this device does not have the feature)',
  4: 'ERROR_NO_PERMISSION (the call needs elevation)',
  6: 'ERROR_NOT_FOUND',
  12: 'ERROR_LIBRARY_NOT_FOUND',
  13: 'ERROR_FUNCTION_NOT_FOUND (this driver does not implement the call)',
  15: 'ERROR_GPU_IS_LOST',
  25: 'ERROR_ARGUMENT_VERSION_MISMATCH (our struct version is wrong — safe, nothing happened)',
  26: 'ERROR_DEPRECATED',
  999: 'ERROR_UNKNOWN',
});

export function nvmlStatusName(code) {
  return NVML_STATUS[String(code)] ?? `неизвестный код ${code}`;
}

/** nvmlClockType_t (nvml.h line 1107). Only the graphics domain matters for the V/F curve. */
export const NVML_CLOCK_GRAPHICS = 0;
export const NVML_CLOCK_SM = 1;
export const NVML_CLOCK_MEM = 2;
export const NVML_CLOCK_VIDEO = 3;

/** nvmlPstates_t (nvml.h line 1153). P0 is maximum performance — where the curve's top lives. */
export const NVML_PSTATE_0 = 0;

/** The struct's own geometry. Byte offsets are the API's real surface, so they are named, not derived. */
export const CLOCK_OFFSET_STRUCT_SIZE = 24;
export const CLOCK_OFFSET_VERSION = (CLOCK_OFFSET_STRUCT_SIZE | (1 << 24)) >>> 0; // 0x01000018
const OFF_VERSION = 0x00;
const OFF_TYPE = 0x04;
const OFF_PSTATE = 0x08;
const OFF_CLOCK_OFFSET_MHZ = 0x0C;
const OFF_MIN_OFFSET_MHZ = 0x10;
const OFF_MAX_OFFSET_MHZ = 0x14;

/**
 * Build the 24-byte request. `type` and `pstate` are INPUTS; the three int fields are OUTPUTS for the
 * Get call and only `clockOffsetMHz` is an input for the Set call — which is why one builder serves
 * both and the caller says which fields it means.
 */
export function buildClockOffsetStruct({ type = NVML_CLOCK_GRAPHICS, pstate = NVML_PSTATE_0, offsetMhz = 0 } = {}) {
  const buf = Buffer.alloc(CLOCK_OFFSET_STRUCT_SIZE);
  buf.writeUInt32LE(CLOCK_OFFSET_VERSION, OFF_VERSION);
  buf.writeInt32LE(type, OFF_TYPE);
  buf.writeInt32LE(pstate, OFF_PSTATE);
  buf.writeInt32LE(offsetMhz, OFF_CLOCK_OFFSET_MHZ);
  return buf;
}

/** Decode the same 24 bytes after a call has filled them. */
export function decodeClockOffsetStruct(buf) {
  return {
    type: buf.readInt32LE(OFF_TYPE),
    pstate: buf.readInt32LE(OFF_PSTATE),
    offsetMhz: buf.readInt32LE(OFF_CLOCK_OFFSET_MHZ),
    minOffsetMhz: buf.readInt32LE(OFF_MIN_OFFSET_MHZ),
    maxOffsetMhz: buf.readInt32LE(OFF_MAX_OFFSET_MHZ),
  };
}

// =================================================================================================
// 2. The bridge
// =================================================================================================

/**
 * Open nvml.dll and declare the calls.
 *
 * Unlike `nvapi64.dll` — which exports ONE symbol and hands out function pointers by id — nvml.dll
 * exports its functions by name, so koffi's ordinary `lib.func` is enough and there is no
 * QueryInterface layer to prove. Handles are declared `uint64_t` for the same reason as in nvapi.mjs:
 * on the Windows x64 ABI a pointer and an integer travel in the same register, so this is
 * ABI-identical and keeps the handle a plain BigInt instead of an object to marshal.
 */
export function openNvml({ dll = 'nvml.dll' } = {}) {
  const koffi = require('koffi');
  const lib = koffi.load(dll);
  return {
    koffi,
    lib,
    init: lib.func('int nvmlInit_v2()'),
    shutdown: lib.func('int nvmlShutdown()'),
    getDriverVersion: lib.func('int nvmlSystemGetDriverVersion(_Out_ void *version, uint32_t length)'),
    getHandleByIndex: lib.func('int nvmlDeviceGetHandleByIndex_v2(uint32_t index, _Out_ void *device)'),
    getName: lib.func('int nvmlDeviceGetName(uint64_t device, _Out_ void *name, uint32_t length)'),
    getClockOffsets: lib.func('int nvmlDeviceGetClockOffsets(uint64_t device, void *info)'),
    setClockOffsets: lib.func('int nvmlDeviceSetClockOffsets(uint64_t device, void *info)'),
  };
}

/** A NUL-terminated C string out of a buffer the driver filled. */
function cString(buf) {
  const end = buf.indexOf(0);
  return buf.toString('latin1', 0, end === -1 ? buf.length : end).trim();
}

/**
 * READ the current offset and the allowed range for one clock domain and pstate.
 *
 * This is the call that may retire an open unknown for free: `ClkDomainsGetInfo` (the NvAPI route to
 * the allowed offset range) has refused 30 size/version pairs, so the permitted range stayed UNKNOWN and
 * that was forcing microscopic first writes by POLICY rather than by permission (STATUS.md step 4).
 * NVML publishes min and max as documented outputs — read-only. What lands in config from this call is
 * `CLOCK_OFFSET_MIN_MHZ` / `CLOCK_OFFSET_MAX_MHZ`; the offset GRANULARITY is a different quantity and
 * stays open (`CLOCK_OFFSET_GRANULARITY_IS_MEASURED = false`).
 */
export function readClockOffset(nv, handle, { type = NVML_CLOCK_GRAPHICS, pstate = NVML_PSTATE_0 } = {}) {
  const buf = buildClockOffsetStruct({ type, pstate });
  const status = nv.getClockOffsets(handle, buf);
  if (status !== 0) return { ok: false, status, why: nvmlStatusName(status) };
  return { ok: true, status, ...decodeClockOffsetStruct(buf) };
}

/**
 * Read the offset until TWO CONSECUTIVE SAMPLES AGREE (EXP-0014).
 *
 * A GPU write settles asynchronously; a single read taken straight after one can return the previous
 * value, and that is precisely how a correct write gets reported to the owner as a failure. Synchronous
 * by design — this runs between measurements, never inside one.
 */
export function readClockOffsetStable(nv, handle, opts = {}, { maxSamples = 12, gapMs = 250 } = {}) {
  const samples = [];
  let previous = null;
  for (let i = 0; i < maxSamples; i++) {
    const r = readClockOffset(nv, handle, opts);
    if (!r.ok) return { ...r, samples };
    samples.push(r.offsetMhz);
    if (previous !== null && r.offsetMhz === previous) return { ...r, stable: true, samples };
    previous = r.offsetMhz;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, gapMs); // a blocking sleep with no timer
  }
  return { ok: false, why: `сдвиг не устоялся за ${maxSamples} проб`, samples };
}

/**
 * WRITE a clock offset. THE ONLY DEVICE WRITE IN THIS FILE, and it exists to be a measuring lever.
 *
 * Its rollback is this same function with `offsetMhz = 0`; callers are expected to call it in a
 * `finally`, the shape `ladder-descent.mjs` already uses for the clock lock.
 */
export function writeClockOffset(nv, handle, offsetMhz, { type = NVML_CLOCK_GRAPHICS, pstate = NVML_PSTATE_0 } = {}) {
  const buf = buildClockOffsetStruct({ type, pstate, offsetMhz });
  const status = nv.setClockOffsets(handle, buf);
  return { ok: status === 0, status, why: nvmlStatusName(status), offsetMhz };
}

/**
 * The read-only probe: prove the chain on values we already know, then report the offset range.
 *
 * The cross-check is not ceremony (EXP-0017). If NVML independently says "610.88" and "NVIDIA GeForce
 * RTX 5070 Ti" — the two facts `nvidia-smi` and NVAPI have both already told us — then the DLL load,
 * the calling convention, the handle passing and the out-parameter decoding are all proven on
 * known-correct answers, and a later disagreement about a struct has exactly one suspect left.
 */
export function probe() {
  const nv = openNvml();
  const report = { chain: [], offsets: [] };
  const step = (what, ok, detail) => report.chain.push({ what, ok, detail });

  const st = nv.init();
  step('nvmlInit_v2()', st === 0, nvmlStatusName(st));
  if (st !== 0) return report;

  try {
    const verBuf = Buffer.alloc(80);
    const sv = nv.getDriverVersion(verBuf, 80);
    report.driver = sv === 0 ? cString(verBuf) : null;
    step('nvmlSystemGetDriverVersion()', sv === 0, `${nvmlStatusName(sv)} · драйвер ${report.driver ?? '—'}`);

    const handleBuf = Buffer.alloc(8);
    const sh = nv.getHandleByIndex(0, handleBuf);
    step('nvmlDeviceGetHandleByIndex_v2(0)', sh === 0, nvmlStatusName(sh));
    if (sh !== 0) return report;
    const handle = handleBuf.readBigUInt64LE(0);
    report.handle = `0x${handle.toString(16)}`;

    const nameBuf = Buffer.alloc(96);
    const sn = nv.getName(handle, nameBuf, 96);
    report.name = sn === 0 ? cString(nameBuf) : null;
    step('nvmlDeviceGetName()', sn === 0, `${nvmlStatusName(sn)} · ${report.name ?? '—'}`);

    // The payload: the current offset and the ALLOWED RANGE, per domain, at P0.
    for (const [label, type] of [['GRAPHICS', NVML_CLOCK_GRAPHICS], ['SM', NVML_CLOCK_SM], ['MEM', NVML_CLOCK_MEM]]) {
      const r = readClockOffset(nv, handle, { type, pstate: NVML_PSTATE_0 });
      report.offsets.push({ label, type, ...r });
    }
  } finally {
    const ss = nv.shutdown();
    step('nvmlShutdown()', ss === 0, nvmlStatusName(ss));
  }

  return report;
}

// =================================================================================================
// 3. THE EXPERIMENT — locate the offset field by moving it with a documented lever
// =================================================================================================

/**
 * Compare two raw NvAPI control buffers dword by dword.
 *
 * Dwords, not bytes, because the record is a struct of 32-bit fields and a byte diff would report one
 * change as four. Reports the entry index and the offset WITHIN the 72-byte entry, which is the
 * coordinate the answer is actually expressed in.
 */
export function diffControlBuffers(before, after, { dataOffset, stride, count }) {
  const changes = [];
  const words = Math.min(before.length, after.length) >> 2;
  for (let w = 0; w < words; w++) {
    const at = w * 4;
    const a = before.readInt32LE(at);
    const b = after.readInt32LE(at);
    if (a === b) continue;
    const change = { at, hex: `0x${at.toString(16).toUpperCase().padStart(4, '0')}`, before: a, after: b, delta: b - a };
    if (at >= dataOffset && at < dataOffset + stride * count) {
      const rel = at - dataOffset;
      change.entry = Math.floor(rel / stride);
      change.inEntry = rel % stride;
      change.inEntryHex = `+0x${(rel % stride).toString(16).toUpperCase().padStart(2, '0')}`;
    }
    changes.push(change);
  }
  return changes;
}

/**
 * Derive the record geometry FROM the diff, instead of reading it off a screen.
 *
 * This is «code before cognition» (PHILOSOPHY.md) applied to the one place it matters most: the answer
 * to "what is the stride" is an arithmetic property of the changed addresses, and a human eye scanning
 * a column of hex is exactly the instrument that mistakes 0x24 for 0x48 — which is how the published
 * layout came to be wrong in the first place.
 *
 * @param changes the dword diff
 * @param dataStart the first byte of the entry array (the header size)
 * @param appliedKhz what we asked the lever to move, in kHz — so the unit can be CHECKED, not assumed
 */
export function inferGeometry(changes, { dataStart = 0x20, appliedKhz } = {}) {
  if (changes.length < 3) return { ok: false, why: `изменившихся слов ${changes.length} — мало для вывода шага` };

  const addrs = changes.map((c) => c.at);
  const gaps = [...new Set(addrs.slice(1).map((a, i) => a - addrs[i]))];
  if (gaps.length !== 1) return { ok: false, why: `шаг между изменившимися словами НЕ постоянен: ${gaps.join(', ')}` };
  const stride = gaps[0];

  const fieldOffset = (addrs[0] - dataStart) % stride;
  const firstEntry = Math.floor((addrs[0] - dataStart) / stride);
  const lastEntry = Math.floor((addrs[addrs.length - 1] - dataStart) / stride);

  const deltas = [...new Set(changes.map((c) => c.delta))];
  const uniform = deltas.length === 1;
  // The unit test that costs nothing: we asked for X kHz; if every field moved by exactly X, the field
  // is in kHz. If it moved by X/1000, it is in MHz. Anything else and we have not found the field.
  let unit = 'НЕ ОПОЗНАНА';
  if (uniform && appliedKhz !== undefined) {
    if (deltas[0] === appliedKhz) unit = 'кГц';
    else if (deltas[0] === appliedKhz / 1000) unit = 'МГц';
  }

  return {
    ok: true,
    stride,
    strideHex: `0x${stride.toString(16).toUpperCase()}`,
    fieldOffset,
    fieldOffsetHex: `+0x${fieldOffset.toString(16).toUpperCase().padStart(2, '0')}`,
    firstEntry,
    lastEntry,
    entriesTouched: changes.length,
    entryArrayBytes: stride * (lastEntry + 1),
    uniformDelta: uniform,
    delta: uniform ? deltas[0] : deltas,
    unit,
  };
}

/**
 * Apply a KNOWN offset through NVML, re-read OUR NvAPI struct, and see which field moved.
 *
 * WHY THIS IS THE METHOD AND NOT A GUESS: the source (LACT #936) says the frequency offset sits at the
 * start of each 72-byte entry; on this card that dword turned out to be a FLAG, and the only non-zero
 * word in the whole 0x2420 structure was 0x1220 (entry 64) = 1, which was there BEFORE we wrote
 * anything. Writing a real offset blind would be exactly the "invent something plausible" door that
 * PHILOSOPHY.md forbids. Moving the state with a documented API and subtracting is the first door:
 * search the existing sources of truth.
 *
 * THE SIGN IS DELIBERATE. A NEGATIVE offset makes the card slower at the same voltage. It cannot
 * destabilize anything, so the safe direction of this axis is also the informative one.
 *
 * FOUR WITNESSES ARE COLLECTED, and they can disagree — which is the point:
 *   1. NVML's own read-back of the offset (did the lever move?)
 *   2. the V/F curve from NvAPI GetStatus (did the CURVE move? frequencies should shift)
 *   3. the control struct from NvAPI GetControl (WHICH FIELD moved? — the question being asked)
 *   4. the rollback snapshot (did everything come back?)
 * A run where 1 succeeds and 3 shows nothing is a real finding too: it would mean the two APIs do NOT
 * share the state researches/05 §5.5 says they share, and the whole NvAPI write path needs rethinking.
 */
export async function findOffsetField({ offsetMhz = -100, type = NVML_CLOCK_GRAPHICS } = {}) {
  const nvapi = await import('./nvapi.mjs');
  const nv = openNvml();
  const result = { offsetMhz, type, steps: [], changes: [], rolledBack: false };
  const note = (what, ok, detail) => result.steps.push({ what, ok, detail });

  const si = nv.init();
  note('nvmlInit_v2()', si === 0, nvmlStatusName(si));
  if (si !== 0) return result;

  const handleBuf = Buffer.alloc(8);
  const sh = nv.getHandleByIndex(0, handleBuf);
  note('nvmlDeviceGetHandleByIndex_v2(0)', sh === 0, nvmlStatusName(sh));
  if (sh !== 0) { nv.shutdown(); return result; }
  const nvmlHandle = handleBuf.readBigUInt64LE(0);

  // --- the NvAPI side, opened alongside: same card, two independent instruments
  const na = nvapi.openNvapi();
  const initSt = na.koffi.call(na.resolve(0x0150E828).ptr, na.protos.Initialize);
  note('NvAPI_Initialize()', initSt === 0, nvapi.statusName(initSt));
  if (initSt !== 0) { nv.shutdown(); return result; }

  const handles = Buffer.alloc(64 * 8);
  const count = Buffer.alloc(4);
  na.koffi.call(na.resolve(0xE5AC921F).ptr, na.protos.EnumPhysicalGPUs, handles, count);
  const nvapiHandle = handles.readBigUInt64LE(0);

  const snapshot = (label) => {
    const ctl = nvapi.readVfOffsets(na, nvapiHandle);
    const curve = nvapi.readVfCurve(na, nvapiHandle);
    return { label, ctl, curve };
  };

  try {
    // --- BEFORE. The baseline both later snapshots are measured against.
    const before = snapshot('ДО');
    const preOffset = readClockOffset(nv, nvmlHandle, { type });
    note('исходный сдвиг NVML', preOffset.ok, preOffset.ok
      ? `${preOffset.offsetMhz} МГц (разрешено ${preOffset.minOffsetMhz} … ${preOffset.maxOffsetMhz})`
      : preOffset.why);
    note('снимок ДО (NvAPI GetControl)', before.ctl.ok, before.ctl.ok
      ? `${before.ctl.raw.length} байт, ненулевых сдвигов по старой раскладке ${before.ctl.nonZero}` : before.ctl.why);
    note('снимок ДО (NvAPI кривая)', before.curve.ok, before.curve.ok
      ? `точек ${before.curve.points.filter((p) => p.freqKhz > 0).length}, максимум ${Math.max(...before.curve.points.map((p) => p.mhz)).toFixed(1)} МГц`
      : before.curve.why);
    if (!before.ctl.ok) return result;
    result.before = before;

    // --- THE WRITE. Rollback named in the comment above, executed in the finally below.
    const w = writeClockOffset(nv, nvmlHandle, offsetMhz, { type });
    note(`ЗАПИСЬ NVML: сдвиг ${offsetMhz} МГц`, w.ok, w.why);
    if (!w.ok) return result;
    result.written = true;

    const settled = readClockOffsetStable(nv, nvmlHandle, { type });
    note('перечитывание до устойчивости (две совпавшие пробы)', settled.ok,
      settled.ok ? `${settled.offsetMhz} МГц · пробы ${settled.samples.join(', ')}` : settled.why);
    result.settledOffsetMhz = settled.ok ? settled.offsetMhz : null;

    // --- AFTER.
    const after = snapshot('ПОСЛЕ');
    note('снимок ПОСЛЕ (NvAPI GetControl)', after.ctl.ok, after.ctl.ok ? `${after.ctl.raw.length} байт` : after.ctl.why);
    result.after = after;

    if (after.ctl.ok) {
      result.changes = diffControlBuffers(before.ctl.raw, after.ctl.raw, {
        dataOffset: nvapi.CLK_VF_CONTROL_DATA_OFFSET,
        stride: nvapi.CLK_VF_CONTROL_STRIDE,
        count: nvapi.CLK_VF_POINT_COUNT,
      });
    }
    result.geometry = inferGeometry(result.changes, {
      dataStart: nvapi.CLK_VF_CONTROL_DATA_OFFSET,
      appliedKhz: offsetMhz * 1000,
    });
    if (before.curve.ok && after.curve.ok) {
      const maxBefore = Math.max(...before.curve.points.map((p) => p.mhz));
      const maxAfter = Math.max(...after.curve.points.map((p) => p.mhz));
      result.curveShiftMhz = Number((maxAfter - maxBefore).toFixed(3));
      note('кривая сдвинулась (второй, независимый свидетель)', result.curveShiftMhz !== 0,
        `максимум ${maxBefore.toFixed(1)} → ${maxAfter.toFixed(1)} МГц, разница ${result.curveShiftMhz} МГц`);
    }
  } finally {
    // --- THE ROLLBACK. Runs on every path, including a thrown error, exactly as ladder-descent does
    // for the clock lock. The physical backstop underneath it: offsets are volatile, a reboot clears them.
    if (result.written) {
      const r = writeClockOffset(nv, nvmlHandle, 0, { type });
      const back = readClockOffsetStable(nv, nvmlHandle, { type });
      result.rolledBack = r.ok && back.ok && back.offsetMhz === 0;
      note('ОТКАТ: сдвиг 0 МГц', result.rolledBack,
        `${r.why} · перечитано ${back.ok ? `${back.offsetMhz} МГц (пробы ${back.samples.join(', ')})` : back.why}`);

      const restored = snapshot('ОТКАТ');
      result.restored = restored;
      if (result.before?.ctl.ok && restored.ctl.ok) {
        result.identicalAfterRollback = Buffer.compare(result.before.ctl.raw, restored.ctl.raw) === 0;
        note('структура вернулась побайтово к исходной', result.identicalAfterRollback,
          result.identicalAfterRollback ? 'да — 9 248 байт совпали' : 'НЕТ — остались расхождения');
      }
    }
    na.koffi.call(na.resolve(0xD22BDD7E).ptr, na.protos.Unload);
    nv.shutdown();
  }

  return result;
}

/**
 * THE GUARD THE CORRECTED DECODE IS BORN WITH — and it proves itself RED in the same run.
 *
 * `TESTING_FRAMEWORK.md`: new behaviour ships together with the artifact that checks it, and a check
 * that has never failed proves nothing (`BUG_FIXING_FRAMEWORK.md` → Guards). Here the broken version
 * is not hypothetical — it is the PUBLISHED layout this project believed until today, so the check
 * decodes ONE raw buffer through BOTH geometries and demands they disagree in the right direction:
 *
 *   • the MEASURED geometry (stride 0x24, field +0x14) must show the applied offset in 127 entries;
 *   • the PUBLISHED geometry (stride 0x48, field +0x00) must FAIL to show it.
 *
 * Green on both would mean the fixture cannot tell the two apart and the guard is worthless (EXP-0016:
 * a fixture a neighbouring rule also catches does not test your rule). Green on the published one
 * alone would mean the whole finding is wrong.
 */
export async function verifyDecode({ offsetMhz = -100 } = {}) {
  const nvapi = await import('./nvapi.mjs');
  const expectedKhz = offsetMhz * 1000;
  const nv = openNvml();
  const out = { offsetMhz, blocks: [], rolledBack: false };
  const block = (name, ok, detail) => out.blocks.push({ name, ok, detail });

  if (nv.init() !== 0) { block('nvmlInit_v2()', false, 'не инициализировался'); return out; }
  const hb = Buffer.alloc(8);
  if (nv.getHandleByIndex(0, hb) !== 0) { nv.shutdown(); block('дескриптор NVML', false, 'не получен'); return out; }
  const nvmlHandle = hb.readBigUInt64LE(0);

  const na = nvapi.openNvapi();
  na.koffi.call(na.resolve(0x0150E828).ptr, na.protos.Initialize);
  const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
  na.koffi.call(na.resolve(0xE5AC921F).ptr, na.protos.EnumPhysicalGPUs, handles, count);
  const nvapiHandle = handles.readBigUInt64LE(0);

  let written = false;
  try {
    const before = nvapi.readVfOffsets(na, nvapiHandle);
    block('исходное состояние: все сдвиги нулевые по ИЗМЕРЕННОЙ раскладке',
      before.ok && before.nonZero === 0, before.ok ? `ненулевых ${before.nonZero} из 128` : before.why);

    const w = writeClockOffset(nv, nvmlHandle, offsetMhz);
    if (!w.ok) { block(`рычаг NVML ${offsetMhz} МГц`, false, w.why); return out; }
    written = true;
    const settled = readClockOffsetStable(nv, nvmlHandle);
    block(`рычаг NVML ${offsetMhz} МГц, перечитан до устойчивости`,
      settled.ok && settled.offsetMhz === offsetMhz, settled.ok ? `${settled.offsetMhz} МГц` : settled.why);

    // --- the decode under test
    const measured = nvapi.readVfOffsets(na, nvapiHandle);
    const hits = measured.ok ? measured.offsets.filter((o) => o === expectedKhz).length : 0;
    const entryZero = measured.ok ? measured.offsets[0] : null;
    block(`ИЗМЕРЕННАЯ раскладка видит сдвиг: ${expectedKhz} кГц в 127 записях`,
      hits === 127, `совпало ${hits} из 128, запись 0 = ${entryZero}`);

    // --- the same bytes through the layout we believed yesterday
    const published = [];
    for (let i = 0; i < 128; i++) published.push(measured.raw.readInt32LE(0x20 + i * 0x48));
    const publishedHits = published.filter((o) => o === expectedKhz).length;
    block('ОПУБЛИКОВАННАЯ раскладка (шаг 0x48, поле +0x00) НЕ видит сдвиг — красный, как и должна',
      publishedHits !== 127, `совпало ${publishedHits} из 128 — она читает чужие байты`);
  } finally {
    if (written) {
      writeClockOffset(nv, nvmlHandle, 0);
      const back = readClockOffsetStable(nv, nvmlHandle);
      out.rolledBack = back.ok && back.offsetMhz === 0;
      const after = nvapi.readVfOffsets(na, nvapiHandle);
      block('ОТКАТ: сдвиг 0 и структура снова чистая',
        out.rolledBack && after.ok && after.nonZero === 0,
        `${back.ok ? `${back.offsetMhz} МГц` : back.why} · ненулевых ${after.ok ? after.nonZero : '—'}`);
    }
    na.koffi.call(na.resolve(0xD22BDD7E).ptr, na.protos.Unload);
    nv.shutdown();
  }
  return out;
}

/**
 * WHAT DOES THE MASK ACTUALLY DO? — a read-only discriminating experiment.
 *
 * Two writes were accepted and inert, and the dump then showed the driver never writes the mask region
 * back. So "the mask is a 128-bit point selector at 0x04" is still only the source's claim, and if it
 * is wrong our single bit has been landing in a field that means something else entirely — which would
 * explain an OK that does nothing far better than any theory about the offset field, since the offset
 * field itself is now measured.
 *
 * The lever gives us a state where all 127 entries carry a known value. Then ask GetControl for that
 * state three ways and see which answers differ:
 *
 *   all bits → if the mask matters at all, everything comes back
 *   no bits  → still everything? then the mask is IGNORED on read, and its position is unproven
 *   one bit  → only that entry? then the mask is confirmed, and the no-op lives somewhere else
 *
 * Read-only apart from the lever, which rolls back in the `finally` as always.
 */
export async function probeMaskSemantics({ offsetMhz = -100, point = 64 } = {}) {
  const nvapi = await import('./nvapi.mjs');
  const expectedKhz = offsetMhz * 1000;
  const nv = openNvml();
  const out = { offsetMhz, point, cases: [], rolledBack: false };

  if (nv.init() !== 0) return out;
  const hb = Buffer.alloc(8);
  if (nv.getHandleByIndex(0, hb) !== 0) { nv.shutdown(); return out; }
  const nvmlHandle = hb.readBigUInt64LE(0);

  const na = nvapi.openNvapi();
  na.koffi.call(na.resolve(0x0150E828).ptr, na.protos.Initialize);
  const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
  na.koffi.call(na.resolve(0xE5AC921F).ptr, na.protos.EnumPhysicalGPUs, handles, count);
  const nvapiHandle = handles.readBigUInt64LE(0);

  let written = false;
  try {
    const w = writeClockOffset(nv, nvmlHandle, offsetMhz);
    if (!w.ok) { out.leverFailed = w.why; return out; }
    written = true;
    readClockOffsetStable(nv, nvmlHandle);

    for (const [label, mask] of [['все биты', 'all'], ['НИ ОДНОГО бита', 'none'], [`один бит (точка ${point})`, point]]) {
      const r = nvapi.readVfOffsets(na, nvapiHandle, { mask });
      out.cases.push({
        label,
        ok: r.ok,
        status: r.ok ? 0 : r.status,
        why: r.why,
        carrying: r.ok ? r.offsets.filter((o) => o === expectedKhz).length : null,
        atPoint: r.ok ? r.offsets[point] : null,
        // WHICH slots carry it is the whole question: if asking for point 64 fills slot 0, the driver
        // packs selected points DENSELY from the start, and the write must put its value in the same
        // slot the mask's Nth bit maps to — not in slot N.
        at: r.ok ? r.offsets.map((o, i) => (o === expectedKhz ? i : -1)).filter((i) => i >= 0) : [],
      });
    }
  } finally {
    if (written) {
      writeClockOffset(nv, nvmlHandle, 0);
      const back = readClockOffsetStable(nv, nvmlHandle);
      out.rolledBack = back.ok && back.offsetMhz === 0;
    }
    na.koffi.call(na.resolve(0xD22BDD7E).ptr, na.protos.Unload);
    nv.shutdown();
  }
  return out;
}

// =================================================================================================
// 4. CLI
// =================================================================================================

async function mainFindOffsetField(offsetMhz, type = NVML_CLOCK_GRAPHICS) {
  const domain = type === NVML_CLOCK_MEM ? 'ПАМЯТИ' : 'ГРАФИЧЕСКОГО ЯДРА';
  console.log(`ОПЫТ: НАЙТИ ПОЛЕ СДВИГА — рычаг домена ${domain}`);
  console.log('');
  console.log(`  ЧТО ДЕЛАЕМ: прикладываем ИЗВЕСТНЫЙ сдвиг ${offsetMhz} МГц документированным вызовом NVML`);
  console.log('              и перечитываем НАШУ недокументированную структуру NvAPI — до и после.');
  console.log(`  ОТКАТ:      тот же вызов со сдвигом 0 МГц, в finally, на любом пути выполнения.`);
  console.log('              Физическая подстраховка: сдвиги энергозависимы, перезагрузка снимает их сама.');
  console.log(`  ЗНАК:       ОТРИЦАТЕЛЬНЫЙ — карта станет МЕДЛЕННЕЕ при том же напряжении, дестабилизировать это не может.`);
  console.log('');

  const r = await findOffsetField({ offsetMhz, type });

  for (const s of r.steps) console.log(`  ${s.ok ? 'OK  ' : 'ПЛОХО'} ${s.what} — ${s.detail}`);

  console.log('');
  if (!r.written) {
    console.log('ЗАПИСЬ НЕ СОСТОЯЛАСЬ — сравнивать нечего. Карта не тронута.');
    return 1;
  }

  console.log(`ИЗМЕНИВШИЕСЯ 32-БИТНЫЕ СЛОВА В СТРУКТУРЕ ClkVfPointsGetControl: ${r.changes.length}`);
  if (r.changes.length === 0 && type === NVML_CLOCK_MEM) {
    console.log('  НИ ОДНОГО — и это ОЖИДАЕМЫЙ, ХОРОШИЙ ответ для рычага памяти. Рычаг заведомо');
    console.log('  сработал (NVML перечитал сдвиг), а структура его не показала — значит');
    console.log('  ClkVfPointsGetControl относится ТОЛЬКО к графическому домену, и промах по шагу');
    console.log('  не может попасть в чужие настройки памяти.');
  } else if (r.changes.length === 0) {
    console.log('  НИ ОДНОГО. Это находка, а не пустой результат: NVML сдвинул состояние, а наша');
    console.log('  структура этого не показала — значит она НЕ отражает то же состояние, и посылка');
    console.log('  researches/05 §5.5 на этом драйвере неверна.');
  }
  for (const c of r.changes.slice(0, 4)) {
    console.log(`  ${c.hex}  ${String(c.before).padStart(10)} → ${String(c.after).padStart(10)}  (Δ ${String(c.delta).padStart(9)})`);
  }
  if (r.changes.length > 8) console.log(`  … ещё ${r.changes.length - 8} с тем же шагом …`);
  for (const c of r.changes.slice(-4)) {
    console.log(`  ${c.hex}  ${String(c.before).padStart(10)} → ${String(c.after).padStart(10)}  (Δ ${String(c.delta).padStart(9)})`);
  }

  if (process.argv.includes('--dump') && r.before?.ctl.ok && r.after?.ctl.ok) {
    const nvapi = await import('./nvapi.mjs');
    const b = nvapi.dumpControlRegions(r.before.ctl.raw);
    const a = nvapi.dumpControlRegions(r.after.ctl.raw);
    console.log('');
    console.log('ДАМП: как выглядит структура ДО и ПОД приложенным сдвигом (только чтение)');
    for (let i = 0; i < b.length; i++) {
      console.log(`  ${b[i].label}`);
      console.log(`    ДО:    ${b[i].hex}`);
      console.log(`    ПОД:   ${a[i].hex}`);
    }
  }

  console.log('');
  console.log('РАСКЛАДКА, ВЫВЕДЕННАЯ ИЗ ДИФФА (арифметикой по адресам, а не глазами по колонке hex)');
  const g = r.geometry;
  if (!g.ok) {
    console.log(`  НЕ ВЫВЕДЕНА — ${g.why}`);
  } else {
    console.log(`  шаг записи:        ${g.strideHex} (${g.stride} байт)`);
    console.log(`  поле сдвига:       ${g.fieldOffsetHex} внутри записи`);
    console.log(`  записи затронуты:  с ${g.firstEntry} по ${g.lastEntry} — ${g.entriesTouched} штук`);
    console.log(`  массив записей:    ${g.entryArrayBytes} байт от 0x20, то есть до 0x${(0x20 + g.entryArrayBytes).toString(16).toUpperCase()}`);
    console.log(`  дельта одинакова:  ${g.uniformDelta ? `да, ${g.delta} во всех` : `НЕТ — ${g.delta}`}`);
    console.log(`  ЕДИНИЦА ПОЛЯ:      ${g.unit}  (просили ${r.offsetMhz} МГц = ${r.offsetMhz * 1000} кГц)`);
  }

  console.log('');
  console.log(`ОТКАТ ВЫПОЛНЕН: ${r.rolledBack ? 'да' : 'НЕТ — РАЗБИРАТЬСЯ НЕМЕДЛЕННО'}`);
  if (r.identicalAfterRollback !== undefined) {
    console.log(`СТРУКТУРА ПОСЛЕ ОТКАТА: ${r.identicalAfterRollback ? 'побайтово равна исходной' : 'РАСХОДИТСЯ С ИСХОДНОЙ'}`);
  }
  return r.rolledBack ? 0 : 1;
}

function main() {
  let report;
  try {
    report = probe();
  } catch (e) {
    console.error(`ОШИБКА: ${e.message}`);
    console.error('Если это «Cannot find module» — библиотека не установлена: npm install koffi');
    console.error('Если это отказ загрузки nvml.dll — она лежит в C:\\Windows\\System32\\nvml.dll');
    return 1;
  }

  console.log('ЦЕПОЧКА (каждый слой доказан ответом, который мы уже знаем от nvidia-smi и от NVAPI)');
  for (const c of report.chain) console.log(`  ${c.ok ? 'OK  ' : 'ПЛОХО'} ${c.what} — ${c.detail}`);

  console.log('');
  console.log('СДВИГ ЧАСТОТЫ И РАЗРЕШЁННЫЙ ДИАПАЗОН (P0) — только чтение');
  for (const o of report.offsets) {
    if (!o.ok) {
      console.log(`  ${o.label.padEnd(9)} НЕ ПРОЧИТАН — ${o.why}`);
      continue;
    }
    console.log(`  ${o.label.padEnd(9)} сейчас ${String(o.offsetMhz).padStart(6)} МГц · разрешено `
      + `${String(o.minOffsetMhz).padStart(6)} … ${String(o.maxOffsetMhz).padStart(6)} МГц`);
  }
  console.log('');
  console.log('НИ ОДНОЙ ЗАПИСИ В КАРТУ ЭТОТ ПРОГОН НЕ СДЕЛАЛ.');
  return 0;
}

// A module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.includes('--probe-mask')) {
    const r = await probeMaskSemantics({});
    console.log('ЧТО НА САМОМ ДЕЛЕ ДЕЛАЕТ МАСКА (чтение под приложенным рычагом)');
    console.log('');
    if (r.leverFailed) { console.error(`рычаг не сработал: ${r.leverFailed}`); process.exit(1); }
    for (const c of r.cases) {
      const slots = c.ok ? (c.at.length > 6 ? `${c.at.slice(0, 6).join(',')}…` : (c.at.join(',') || '—')) : '';
      console.log(`  маска: ${c.label.padEnd(24)} ${c.ok ? `записей со сдвигом ${String(c.carrying).padStart(3)} из 128 · в слоте ${r.point}: ${String(c.atPoint).padStart(8)} · заняты слоты: ${slots}` : `ОТКАЗ — ${c.why}`}`);
    }
    const [all, none, one] = r.cases;
    console.log('');
    if (all.ok && none.ok && all.carrying === none.carrying) {
      console.log('ВЫВОД: маска на 0x04 при ЧТЕНИИ ИГНОРИРУЕТСЯ — ответ одинаков и с битами, и без них.');
      console.log('       Значит её положение НЕ доказано, и «один бит» при записи мог уходить в чужое поле.');
    } else if (one.ok && one.carrying === 1 && one.at[0] === 0 && r.point !== 0) {
      console.log(`ВЫВОД: маска РАБОТАЕТ, но результаты УКЛАДЫВАЮТСЯ ПЛОТНО: спросили точку ${r.point} —`);
      console.log('       ответ пришёл в СЛОТ 0. Значит слот массива это не номер точки, а порядковый');
      console.log('       номер среди ВЫБРАННЫХ маской. Отсюда и тихий no-op записи: мы ставили бит');
      console.log(`       точки ${r.point}, а значение клали в слот ${r.point}, откуда драйвер его не читал.`);
    } else if (one.ok && one.carrying === 1 && one.at[0] === r.point) {
      console.log('ВЫВОД: маска РАБОТАЕТ и слот совпадает с номером точки. Тихий no-op записи — не в ней.');
    } else {
      console.log('ВЫВОД: поведение не укладывается ни в одну заготовку — читать числа выше руками.');
    }
    console.log(`ОТКАТ: ${r.rolledBack ? 'выполнен, сдвиг 0' : 'НЕ ВЫПОЛНЕН — РАЗБИРАТЬСЯ'}`);
    process.exit(0);
  }
  if (process.argv.includes('--verify-decode')) {
    const r = await verifyDecode({ offsetMhz: -100 });
    console.log('ПРОВЕРКА ИЗМЕРЕННОЙ РАСКЛАДКИ (одни и те же байты — двумя раскладками)');
    console.log('');
    for (const b of r.blocks) console.log(`  ${b.ok ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}  ${b.name}\n            ${b.detail}`);
    const failed = r.blocks.filter((b) => !b.ok).length;
    console.log('');
    console.log(`ИТОГ: блоков ${r.blocks.length}, провалов ${failed}. ПРОВЕРКА ЗАВЕРШЕНА.`);
    process.exit(failed === 0 ? 0 : 1);
  }
  const i = process.argv.indexOf('--find-offset-field');
  if (i !== -1) {
    // The magnitude is an ARGUMENT rather than a literal, because the first thing this experiment may
    // teach is that the field's unit is kHz and not MHz — and then the same run is repeated at another
    // magnitude to tell a unit apart from a coincidence.
    const raw = process.argv[i + 1];
    const mhz = raw && !raw.startsWith('--') ? Number(raw) : -100;
    if (!Number.isFinite(mhz)) { console.error(`неверный сдвиг: ${raw}`); process.exit(1); }
    // --mem moves the MEMORY lever instead. Its purpose is structural, not tuning: the entry array ends
    // at 0x1220 while the struct runs to 0x2420, so a second region of exactly the same size exists and
    // we must know whose it is BEFORE writing — a mis-strided write must not be able to land in it.
    const type = process.argv.includes('--mem') ? NVML_CLOCK_MEM : NVML_CLOCK_GRAPHICS;
    process.exit(await mainFindOffsetField(mhz, type));
  }
  process.exit(main());
}
