#!/usr/bin/env node
// nvapi.mjs — KAGO's own bridge to NVIDIA's driver API. STEP 1: READ-ONLY RECONNAISSANCE.
//
// Research anchor (researches/05_nvapi_bridge.md §7): "1. load, Initialize, EnumPhysicalGPUs, and a
// QueryInterface resolver that reports for each id whether a pointer came back. Read-only, no struct
// writes. Deliverable: a table of which ids resolve on driver 610.88."
//
// WHY THIS MODULE EXISTS: `nvidia-smi` cannot read voltage, cannot write voltage, and cannot touch the
// fans (verified 2026-08-10 by reading its own help on this machine). So phase 2's numbers are a clock
// clamp on the FACTORY curve, phase 5's Vmin search has no control variable, and the owner's
// experimental protocol — cool the card between runs — is impossible, because this card does not cool
// passively at idle (measured: 47 -> 50 C over 115 s with the fan at 0 %). All three walls are the same
// wall, and this is the door through it.
//
// HOW A JS PROCESS REACHES AN UNDOCUMENTED C API: `nvapi64.dll` exports exactly ONE symbol,
// `nvapi_QueryInterface`. Every function is obtained by calling it with a 32-bit id and receiving a
// function pointer. koffi turns that raw pointer into a callable via `koffi.proto` + `koffi.call`
// (verified against the installed koffi 3.1.4 documentation, not a web page for another version).
//
// THE DISCIPLINE THIS MODULE IS BUILT AROUND, and it is the reason it starts with functions we do not
// need: EVERY LAYER IS PROVEN AGAINST AN INDEPENDENT READING BEFORE THE NEXT ONE IS TRUSTED (EXP-0017).
// The DLL load, the QueryInterface mechanism, the calling convention, the pointer-as-handle passing and
// the out-parameter decoding are all exercised on DOCUMENTED functions whose answers `nvidia-smi`
// already told us — the card's name and the driver version. If NVAPI says "NVIDIA GeForce RTX 5070 Ti"
// and "610.88", the whole chain is proven on known-correct values, and only then does an undocumented
// struct layout become the ONLY suspect when something disagrees. Debugging an unknown struct through
// an unproven calling convention is how sessions burn days.
//
// GPU WRITES: NONE. Not one function in this file changes any state. `NvAPI_Initialize` and
// `NvAPI_Unload` are the API's own lifecycle, not device writes. Fan and curve WRITES come in step 3
// of the research plan, with their rollbacks named first.
//
// Usage:
//   node automation-engine/lib/nvapi.mjs            resolve every id, prove the chain, print the table
//
// [NOT-TESTED] at birth — this file is the probe whose first run decides what is true here.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import config from '../config.mjs';

const require = createRequire(import.meta.url);

// =================================================================================================
// 1. The id table — every entry carries WHERE IT CAME FROM
// =================================================================================================

/**
 * Provenance is more load-bearing than the numbers (researches/05 §3): the fan ids are Windows-native
 * evidence, the curve ids are Linux evidence on a different driver branch, and the lifecycle ids are
 * the documented half. When one of these fails to resolve, the provenance column is what tells us
 * whether to suspect the id, the platform, or the driver version.
 *
 * `need` marks what phase 4 actually requires, so a resolver report reads as a verdict rather than a
 * list. `proves` names what a successful CALL would demonstrate — only filled for the ones we call in
 * this step.
 */
export const NVAPI_IDS = Object.freeze([
  // --- the documented lifecycle: this is what proves the plumbing
  { id: 0x0150E828, name: 'NvAPI_Initialize', need: true, from: 'documented / nvfancontrol', call: 'lifecycle' },
  { id: 0xD22BDD7E, name: 'NvAPI_Unload', need: true, from: 'documented / nvfancontrol', call: 'lifecycle' },
  { id: 0x6C2D048C, name: 'NvAPI_GetErrorMessage', need: false, from: 'documented', call: 'diagnostic' },
  { id: 0xE5AC921F, name: 'NvAPI_EnumPhysicalGPUs', need: true, from: 'documented', call: 'cross-check' },
  { id: 0xCEEE8E9F, name: 'NvAPI_GPU_GetFullName', need: false, from: 'documented', call: 'cross-check' },
  { id: 0x2926AAAD, name: 'NvAPI_SYS_GetDriverAndBranchVersion', need: false, from: 'documented', call: 'cross-check' },

  // --- fans: the half that restores the experiment protocol (Windows-native evidence)
  { id: 0xDA141340, name: 'NvAPI_GPU_GetCoolerSettings', need: true, from: 'nvfancontrol (Windows)' },
  { id: 0x891FA0AE, name: 'NvAPI_GPU_SetCoolerLevels', need: false, from: 'nvfancontrol (Windows)' },
  { id: 0xFB85B01E, name: 'NvAPI_GPU_ClientFanCoolersGetInfo', need: true, from: 'nvfancontrol (Windows)' },
  { id: 0x35AED5E8, name: 'NvAPI_GPU_ClientFanCoolersGetStatus', need: true, from: 'nvfancontrol (Windows)' },
  { id: 0x814B209F, name: 'NvAPI_GPU_ClientFanCoolersGetControl', need: true, from: 'nvfancontrol (Windows)' },
  { id: 0xA58971A5, name: 'NvAPI_GPU_ClientFanCoolersSetControl', need: true, from: 'nvfancontrol (Windows)' },

  // --- the V/F curve: the half that makes undervolting real (LINUX evidence — the biggest risk)
  { id: 0x21537AD4, name: 'ClkVfPointsGetStatus', need: true, from: 'LACT #936 (Linux, drv 590)' },
  { id: 0x507B4B59, name: 'ClkVfPointsGetInfo', need: false, from: 'LACT #936 (Linux, drv 590)' },
  { id: 0x23F1B133, name: 'ClkVfPointsGetControl', need: true, from: 'LACT #936 (Linux, drv 590)' },
  { id: 0x0733E009, name: 'ClkVfPointsSetControl', need: true, from: 'LACT #936 (Linux, drv 590)' },
  { id: 0x64B43A6A, name: 'ClkDomainsGetInfo', need: true, from: 'LACT #936 (Linux, drv 590)' },
]);

/** NVAPI status codes we must tell apart rather than swallow (researches/05 §5). */
export const NVAPI_STATUS = Object.freeze({
  0: 'OK',
  '-1': 'ERROR (generic — e.g. a mask with more than one bit)',
  '-5': 'LIBRARY_NOT_FOUND',
  '-6': 'NO_IMPLEMENTATION',
  '-7': 'API_NOT_INITIALIZED',
  '-8': 'INVALID_ARGUMENT',
  '-9': 'INCOMPATIBLE_STRUCT_VERSION (our layout is wrong — safe, retry with another version)',
  '-104': 'HANDLE_INVALID',
});

export function statusName(code) {
  return NVAPI_STATUS[String(code)] ?? `unknown status ${code}`;
}

// =================================================================================================
// 2. The bridge
// =================================================================================================

/**
 * Open the library and build the resolver.
 *
 * Opaque handles are declared as `uint64_t` rather than `void *` deliberately: on the Windows x64 ABI
 * an integer and a pointer are passed in the same register, so this is ABI-identical and it keeps the
 * handle a plain BigInt in JS instead of an object we would have to marshal back and forth. Out
 * parameters are raw Buffers for the same reason the struct work will need them — this API's real
 * surface is byte offsets, and pretending otherwise would only add a layer to debug through.
 */
export function openNvapi({ dll = 'nvapi64.dll' } = {}) {
  const koffi = require('koffi');
  const lib = koffi.load(dll);
  const queryInterface = lib.func('void *nvapi_QueryInterface(uint32_t id)');

  const protos = {
    Initialize: koffi.proto('int NvAPI_Initialize()'),
    Unload: koffi.proto('int NvAPI_Unload()'),
    GetErrorMessage: koffi.proto('int NvAPI_GetErrorMessage(int status, _Out_ void *msg)'),
    EnumPhysicalGPUs: koffi.proto('int NvAPI_EnumPhysicalGPUs(_Out_ void *handles, _Out_ void *count)'),
    GetFullName: koffi.proto('int NvAPI_GPU_GetFullName(uint64_t gpu, _Out_ void *name)'),
    GetDriverAndBranch: koffi.proto('int NvAPI_SYS_GetDriverAndBranchVersion(_Out_ void *ver, _Out_ void *branch)'),
    ClkVfPointsGetStatus: koffi.proto('int ClkVfPointsGetStatus(uint64_t gpu, void *pts)'),
    ClkVfPointsGetControl: koffi.proto('int ClkVfPointsGetControl(uint64_t gpu, void *ctl)'),
    ClkDomainsGetInfo: koffi.proto('int ClkDomainsGetInfo(uint64_t gpu, void *info)'),
    ClkVfPointsSetControl: koffi.proto('int ClkVfPointsSetControl(uint64_t gpu, void *ctl)'),
  };

  /** Resolve one id. A null pointer is the SAFE failure mode of a wrong id — report, never throw. */
  const resolve = (id) => {
    let ptr = null;
    try { ptr = queryInterface(id); } catch (e) { return { ok: false, ptr: null, why: e.message }; }
    const address = ptr ? koffi.address(ptr) : 0n;
    return { ok: Boolean(ptr) && address !== 0n, ptr, address };
  };

  return { koffi, lib, queryInterface, protos, resolve };
}

/** A NvAPI_ShortString is char[64]; read it back as text up to the NUL. */
function shortString(buf) {
  const end = buf.indexOf(0);
  return buf.toString('latin1', 0, end === -1 ? buf.length : end).trim();
}

/**
 * The whole read-only probe.
 *
 * Returns a report rather than printing, so a future step (and a test) can assert on it.
 */
export function probe() {
  const nv = openNvapi();
  const { koffi, protos, resolve } = nv;

  // --- every id, resolved
  const table = NVAPI_IDS.map((entry) => ({ ...entry, ...resolve(entry.id) }));
  const byName = Object.fromEntries(table.map((r) => [r.name, r]));

  const report = { table, chain: [], gpus: [], initialized: false };
  const step = (what, ok, detail) => report.chain.push({ what, ok, detail });

  const initEntry = byName.NvAPI_Initialize;
  if (!initEntry.ok) {
    step('NvAPI_Initialize resolved', false, 'QueryInterface returned null — the id or the DLL is wrong');
    return report;
  }

  // --- the lifecycle
  const st = koffi.call(initEntry.ptr, protos.Initialize);
  step('NvAPI_Initialize()', st === 0, statusName(st));
  if (st !== 0) return report;
  report.initialized = true;

  try {
    // --- CROSS-CHECK 1: the driver version, against what nvidia-smi already told us.
    const verEntry = byName.NvAPI_SYS_GetDriverAndBranchVersion;
    if (verEntry.ok) {
      const ver = Buffer.alloc(4);
      const branch = Buffer.alloc(64);
      const s = koffi.call(verEntry.ptr, protos.GetDriverAndBranch, ver, branch);
      const raw = ver.readUInt32LE(0);
      // NVAPI reports the driver as an integer: 61088 means 610.88.
      report.driver = { raw, formatted: `${Math.floor(raw / 100)}.${String(raw % 100).padStart(2, '0')}`, branch: shortString(branch) };
      step('NvAPI_SYS_GetDriverAndBranchVersion()', s === 0, `${statusName(s)} · driver ${report.driver.formatted} · branch ${report.driver.branch}`);
    }

    // --- CROSS-CHECK 2: enumerate the cards, then ask each its name.
    const enumEntry = byName.NvAPI_EnumPhysicalGPUs;
    if (enumEntry.ok) {
      const NVAPI_MAX_PHYSICAL_GPUS = 64;
      const handles = Buffer.alloc(NVAPI_MAX_PHYSICAL_GPUS * 8);
      const count = Buffer.alloc(4);
      const s = koffi.call(enumEntry.ptr, protos.EnumPhysicalGPUs, handles, count);
      const n = count.readUInt32LE(0);
      step('NvAPI_EnumPhysicalGPUs()', s === 0, `${statusName(s)} · GPUs: ${n}`);

      const nameEntry = byName.NvAPI_GPU_GetFullName;
      for (let i = 0; i < n; i++) {
        const handle = handles.readBigUInt64LE(i * 8);
        const gpu = { index: i, handle: `0x${handle.toString(16)}` };
        if (nameEntry.ok) {
          const nameBuf = Buffer.alloc(64);
          const sn = koffi.call(nameEntry.ptr, protos.GetFullName, handle, nameBuf);
          gpu.name = sn === 0 ? shortString(nameBuf) : null;
          gpu.status = statusName(sn);
        }
        report.gpus.push(gpu);
      }
      if (report.gpus.length) {
        step('NvAPI_GPU_GetFullName()', Boolean(report.gpus[0].name), report.gpus.map((g) => g.name ?? g.status).join(', '));
      }
    }
  } finally {
    const unloadEntry = byName.NvAPI_Unload;
    if (unloadEntry.ok) {
      const s = koffi.call(unloadEntry.ptr, protos.Unload);
      step('NvAPI_Unload()', s === 0, statusName(s));
    }
  }

  return report;
}

// =================================================================================================
// 3. The V/F curve — READ ONLY
// =================================================================================================

/**
 * MAKE_NVAPI_VERSION: `(version_number << 16) | struct_size` (researches/05 §3.4).
 */
export function nvapiVersion(structSize, versionNumber) {
  return ((versionNumber << 16) | structSize) >>> 0;
}

export const CLK_VF_POINTS_GET_STATUS_SIZE = 0x1C28;
export const CLK_VF_POINT_STRIDE = 0x1C;
export const CLK_VF_POINTS_DATA_OFFSET = 0x48;
export const CLK_VF_POINT_COUNT = 128;

/**
 * Read the 128-point V/F curve.
 *
 * THE VERSION IS PROBED, NOT ASSUMED. The struct's version number is not stated by any source we have
 * (only its SIZE is), and a wrong one returns -9 INCOMPATIBLE_STRUCT_VERSION — a clean, harmless
 * refusal that changes nothing. So the honest move is to walk the small candidate range and report
 * which one the driver accepts, rather than to guess one and call a failure "unsupported".
 *
 * Read-only: this function calls GetStatus and decodes bytes. It writes nothing to the device.
 */
export function readVfCurve(nv, handle, { versions = [1, 2, 3, 4, 5] } = {}) {
  const { koffi, protos, resolve } = nv;
  const entry = resolve(0x21537AD4);
  if (!entry.ok) return { ok: false, why: 'ClkVfPointsGetStatus не разрешился' };

  const attempts = [];
  for (const v of versions) {
    const buf = Buffer.alloc(CLK_VF_POINTS_GET_STATUS_SIZE);
    buf.writeUInt32LE(nvapiVersion(CLK_VF_POINTS_GET_STATUS_SIZE, v), 0);
    // The 128-bit point mask: ask for every point (0xFF across bytes 0x04..0x13).
    buf.fill(0xFF, 0x04, 0x14);
    const status = koffi.call(entry.ptr, protos.ClkVfPointsGetStatus, handle, buf);
    attempts.push({ version: v, status, name: statusName(status) });
    if (status !== 0) continue;

    const points = [];
    for (let i = 0; i < CLK_VF_POINT_COUNT; i++) {
      const at = CLK_VF_POINTS_DATA_OFFSET + i * CLK_VF_POINT_STRIDE;
      const freqKhz = buf.readUInt32LE(at);
      const microVolts = buf.readUInt32LE(at + 4);
      points.push({ i, freqKhz, microVolts, mhz: freqKhz / 1000, mv: microVolts / 1000 });
    }
    return { ok: true, version: v, attempts, points, raw: buf };
  }
  return { ok: false, attempts, why: 'ни одна версия структуры не принята' };
}

/**
 * The number phase 5 has been waiting for: the spacing of the voltage grid, MEASURED.
 *
 * Two quantities wear one name here and config.mjs already warns about it — this function answers the
 * FIRST one only (the spacing between adjacent curve points). The granularity of an APPLIED OFFSET is
 * a different measurement and belongs to ClkDomainsGetInfo.
 */
export function voltageGrid(points) {
  const live = points.filter((p) => p.microVolts > 0 && p.freqKhz > 0);
  if (live.length < 2) return { ok: false, why: `точек с данными: ${live.length}` };
  const sorted = [...live].sort((a, b) => a.microVolts - b.microVolts);
  const deltas = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].microVolts - sorted[i - 1].microVolts;
    if (d > 0) deltas.push(d);
  }
  const uniq = [...new Set(deltas)].sort((a, b) => a - b);
  return {
    ok: true,
    count: live.length,
    minMv: sorted[0].microVolts / 1000,
    maxMv: sorted[sorted.length - 1].microVolts / 1000,
    minMhz: Math.min(...live.map((p) => p.mhz)),
    maxMhz: Math.max(...live.map((p) => p.mhz)),
    stepMinMv: uniq.length ? uniq[0] / 1000 : null,
    stepMaxMv: uniq.length ? uniq[uniq.length - 1] / 1000 : null,
    distinctSteps: uniq.length,
    stepsMv: uniq.slice(0, 12).map((d) => d / 1000),
  };
}

/**
 * Probe an undocumented struct whose SIZE we do not know either.
 *
 * Both the size and the version number are unknown for these two entries — our sources name sizes only
 * for GetStatus and SetControl. So walk the candidate pairs and let the driver tell us: -9 means the
 * layout is wrong and NOTHING happened, which makes this the cheapest possible search. A probe that
 * guessed one pair and reported "unsupported" would be inventing a conclusion.
 *
 * Read-only: these are Get* calls.
 */
export function probeStruct(nv, handle, { id, proto, sizes, versions = [1, 2, 3, 4, 5] }) {
  const { koffi, resolve } = nv;
  const entry = resolve(id);
  if (!entry.ok) return { ok: false, why: 'id не разрешился' };
  const tried = [];
  for (const size of sizes) {
    for (const v of versions) {
      const buf = Buffer.alloc(size);
      buf.writeUInt32LE(nvapiVersion(size, v), 0);
      buf.fill(0xFF, 0x04, 0x14);
      const status = koffi.call(entry.ptr, proto, handle, buf);
      tried.push({ size, version: v, status });
      if (status === 0) return { ok: true, size, version: v, buf, tried };
    }
  }
  return { ok: false, tried };
}

/**
 * THE CONTROL RECORD'S GEOMETRY — MEASURED ON THIS CARD, not taken from the source.
 *
 * WHAT THE SOURCE SAID (LACT #936, researches/05 §3.4): entries of 0x48 = 72 bytes, the frequency
 * offset at the entry's START. Both halves are WRONG here, and believing them is what stalled this
 * phase: with a 72-byte stride the writer aimed at a dword that turned out to be a FLAG, and the only
 * non-zero word in the whole structure sat at 0x1220 and had been there before we ever wrote.
 *
 * WHAT THE MEASUREMENT SAID (2026-08-10, `nvml.mjs --find-offset-field`): a known offset was applied
 * through NVIDIA's DOCUMENTED `nvmlDeviceSetClockOffsets` and this structure was re-read before and
 * after. The changed dwords are spaced 0x24 apart — exactly HALF the published stride — and sit at
 * +0x14 inside the entry. Confirmed twice at independent magnitudes: -100 MHz moved every field by
 * exactly -100000, and -37 MHz by exactly -37000. Hence the unit is kHz and the relation is linear.
 *
 * THE ARITHMETIC CLOSES: 128 entries x 0x24 = 0x1200 bytes, which from 0x20 ends at exactly 0x1220 —
 * the address of that mystery word. It was never a curve field at all; it is the first dword of
 * whatever follows the entry array.
 *
 * THE DOMAIN IS BOUNDED, and this was measured rather than assumed: the same experiment run with the
 * MEMORY clock lever (`--find-offset-field -100 --mem`) moved the card's memory offset and changed
 * ZERO bytes of this structure. So these entries are the GRAPHICS domain alone, and a stride mistake
 * cannot reach memory settings.
 *
 * WHAT IS NOT KNOWN, said plainly rather than smoothed over: entry 0's field did NOT move while
 * entries 1..127 all did. Whether point 0 is inactive, or is a point the driver deliberately never
 * shifts, is unmeasured — so no code may assume entry 0 behaves like the rest.
 */
export const CLK_VF_CONTROL_SIZE = 0x2420;
export const CLK_VF_CONTROL_STRIDE = 0x24;
export const CLK_VF_CONTROL_DATA_OFFSET = 0x20;
export const CLK_VF_CONTROL_FREQ_OFFSET_FIELD = 0x14;
/** The entry array's end — 0x20 + 128 * 0x24. Everything at or beyond this is NOT a curve entry. */
export const CLK_VF_CONTROL_DATA_END = CLK_VF_CONTROL_DATA_OFFSET + CLK_VF_CONTROL_STRIDE * CLK_VF_POINT_COUNT;
export const CLK_VF_CONTROL_GEOMETRY_IS_MEASURED = true;

/** The byte address of one entry's frequency-offset field — the one place this arithmetic lives. */
export function vfControlFieldAt(pointIndex) {
  if (!Number.isInteger(pointIndex) || pointIndex < 0 || pointIndex >= CLK_VF_POINT_COUNT) {
    throw new RangeError(`точка вне диапазона 0…${CLK_VF_POINT_COUNT - 1}: ${pointIndex}`);
  }
  return CLK_VF_CONTROL_DATA_OFFSET + pointIndex * CLK_VF_CONTROL_STRIDE + CLK_VF_CONTROL_FREQ_OFFSET_FIELD;
}

/**
 * Build the control struct for ONE point — the only shape the API accepts.
 *
 * "The mask must have only ONE bit set per call; setting all 128 bits returns -1" (researches/05 §3.4).
 * That constraint is also the safety property: a write's blast radius is one curve point, by the
 * vendor's own design rather than by our discipline.
 *
 * @param offsetKhz signed frequency offset in kHz. +15000 = +15 MHz AT THAT VOLTAGE POINT, which is
 *   the same statement as "this frequency now needs less voltage" — the undervolt, in the API's units.
 */
export function buildVfControl(pointIndex, offsetKhz, { version = 1 } = {}) {
  const buf = Buffer.alloc(CLK_VF_CONTROL_SIZE);
  buf.writeUInt32LE(nvapiVersion(CLK_VF_CONTROL_SIZE, version), 0);
  buf[0x04 + (pointIndex >> 3)] = 1 << (pointIndex & 7);      // exactly one bit
  buf.writeInt32LE(offsetKhz, vfControlFieldAt(pointIndex));  // MEASURED position, not the source's
  return buf;
}

/**
 * Read every per-point offset currently applied (read-only).
 *
 * Returns the RAW buffer alongside the decoded offsets on purpose. The decode above rests on an
 * assumption we have not yet proven — that the offset lives at the START of each 72-byte entry — and
 * the first dword already turned out to be a FLAG rather than a frequency. So a caller that wants to
 * FIND the real field must be able to diff all 9 248 bytes, not the 128 numbers we guessed out of them
 * (see nvml.mjs → the offset-field experiment).
 */
export function readVfOffsets(nv, handle, { version = 1 } = {}) {
  const { koffi, protos, resolve } = nv;
  const entry = resolve(0x23F1B133);
  const buf = Buffer.alloc(CLK_VF_CONTROL_SIZE);
  buf.writeUInt32LE(nvapiVersion(CLK_VF_CONTROL_SIZE, version), 0);
  buf.fill(0xFF, 0x04, 0x14);
  const status = koffi.call(entry.ptr, protos.ClkVfPointsGetControl, buf === null ? 0 : handle, buf);
  if (status !== 0) return { ok: false, status, why: statusName(status) };
  const offsets = [];
  for (let i = 0; i < CLK_VF_POINT_COUNT; i++) {
    offsets.push(buf.readInt32LE(vfControlFieldAt(i)));
  }
  return { ok: true, offsets, nonZero: offsets.filter((o) => o !== 0).length, raw: buf };
}

/**
 * WRITE one point's frequency offset.
 *
 * ⚠️ THE ONLY DEVICE WRITE IN THIS FILE. Its rollback is this same function with `offsetKhz = 0`, and
 * the physical backstop is that offsets live in volatile driver state — a reboot clears them with no
 * action from the owner (MASTER_PLAN.md → заводское состояние по умолчанию).
 */
export function writeVfOffset(nv, handle, pointIndex, offsetKhz, { version = 1 } = {}) {
  const { koffi, protos, resolve } = nv;
  const entry = resolve(0x0733E009);
  if (!entry.ok) return { ok: false, why: 'ClkVfPointsSetControl не разрешился' };
  const buf = buildVfControl(pointIndex, offsetKhz, { version });
  const status = koffi.call(entry.ptr, protos.ClkVfPointsSetControl, handle, buf);
  return { ok: status === 0, status, why: statusName(status) };
}

// =================================================================================================
// 3. CLI
// =================================================================================================

function mainCurve() {
  const nv = openNvapi();
  const { koffi, protos, resolve } = nv;
  const init = resolve(0x0150E828);
  const st = koffi.call(init.ptr, protos.Initialize);
  if (st !== 0) { console.error(`NvAPI_Initialize: ${statusName(st)}`); return 1; }
  try {
    const en = resolve(0xE5AC921F);
    const handles = Buffer.alloc(64 * 8);
    const count = Buffer.alloc(4);
    koffi.call(en.ptr, protos.EnumPhysicalGPUs, handles, count);
    if (count.readUInt32LE(0) < 1) { console.error('карт не найдено'); return 1; }
    const handle = handles.readBigUInt64LE(0);

    const curve = readVfCurve(nv, handle);
    console.log('ПОПЫТКИ ВЕРСИЙ СТРУКТУРЫ (версия не угадывается, а перебирается — неверная даёт -9 и ничего не меняет)');
    for (const a of curve.attempts) console.log(`  версия ${a.version}: ${a.name}`);
    if (!curve.ok) { console.error(`КРИВАЯ НЕ ПРОЧИТАНА: ${curve.why}`); return 1; }

    const live = curve.points.filter((p) => p.microVolts > 0 || p.freqKhz > 0);
    console.log('');
    console.log(`КРИВАЯ ПРОЧИТАНА: версия структуры ${curve.version}, точек с данными ${live.length} из ${curve.points.length}`);
    console.log('');
    console.log('  #    мВ        МГц');
    for (const p of live.slice(0, 8)) console.log(`  ${String(p.i).padStart(3)}  ${p.mv.toFixed(3).padStart(8)}  ${p.mhz.toFixed(1).padStart(8)}`);
    if (live.length > 16) console.log('  ...');
    for (const p of live.slice(-8)) console.log(`  ${String(p.i).padStart(3)}  ${p.mv.toFixed(3).padStart(8)}  ${p.mhz.toFixed(1).padStart(8)}`);

    const g = voltageGrid(curve.points);
    console.log('');
    if (!g.ok) { console.log(`СЕТКА НАПРЯЖЕНИЯ: не выведена — ${g.why}`); return 0; }
    console.log(`СЕТКА НАПРЯЖЕНИЯ (ИЗМЕРЕНА, а не взята на веру)`);
    console.log(`  диапазон:      ${g.minMv.toFixed(3)} … ${g.maxMv.toFixed(3)} мВ`);
    console.log(`  частоты:       ${g.minMhz.toFixed(1)} … ${g.maxMhz.toFixed(1)} МГц`);
    console.log(`  шаг:           ${g.stepMinMv} … ${g.stepMaxMv} мВ, различных значений шага ${g.distinctSteps}`);
    console.log(`  первые шаги:   ${g.stepsMv.join(' · ')} мВ`);
    console.log('');
    // The comparison reads config rather than carrying a copy of its value: a hard-coded "6.25" here
    // became a lie the moment the measurement landed, which is the drift the pairs registry exists for.
    const agrees = Number(config.VOLTAGE_GRID_STEP_MV) === Number(g.stepMinMv);
    console.log(`  СВЕРКА С КОНФИГОМ: VOLTAGE_GRID_STEP_MV = ${config.VOLTAGE_GRID_STEP_MV} мВ `
      + `(измерен: ${config.VOLTAGE_GRID_STEP_IS_MEASURED ? 'да' : 'НЕТ'}) · с живой кривой: ${g.stepMinMv} мВ `
      + `— ${agrees ? 'сходится' : 'РАСХОДИТСЯ, конфиг устарел'}`);
    return 0;
  } finally {
    const un = resolve(0xD22BDD7E);
    koffi.call(un.ptr, protos.Unload);
  }
}

function mainControl() {
  const nv = openNvapi();
  const { koffi, protos, resolve } = nv;
  const st = koffi.call(resolve(0x0150E828).ptr, protos.Initialize);
  if (st !== 0) { console.error(`NvAPI_Initialize: ${statusName(st)}`); return 1; }
  try {
    const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
    koffi.call(resolve(0xE5AC921F).ptr, protos.EnumPhysicalGPUs, handles, count);
    const handle = handles.readBigUInt64LE(0);

    const SIZES = [0x2420, 0x1C28, 0x1B48, 0x0C08, 0x0408, 0x0208];
    for (const [label, id, proto] of [
      ['ClkVfPointsGetControl', 0x23F1B133, protos.ClkVfPointsGetControl],
      ['ClkDomainsGetInfo', 0x64B43A6A, protos.ClkDomainsGetInfo],
    ]) {
      const r = probeStruct(nv, handle, { id, proto, sizes: SIZES });
      console.log('');
      if (!r.ok) {
        const codes = [...new Set(r.tried.map((t) => t.status))];
        console.log(`${label}: НЕ ПРИНЯТА ни одна пара (размер, версия) — попыток ${r.tried.length}, коды ${codes.join(', ')}`);
        console.log('  (это НЕ «не поддерживается» — это «мы ещё не знаем раскладку»)');
        continue;
      }
      console.log(`${label}: ПРИНЯТО — размер 0x${r.size.toString(16).toUpperCase()}, версия ${r.version}`);
      const words = [];
      for (let o = 0; o < Math.min(r.size, 0x60); o += 4) words.push(`+0x${o.toString(16).padStart(2, '0')}=${r.buf.readInt32LE(o)}`);
      console.log('  первые слова: ' + words.slice(0, 16).join(' '));
      const nonZero = [];
      for (let o = 0; o < r.size; o += 4) { const v = r.buf.readInt32LE(o); if (v !== 0) nonZero.push(o); }
      console.log(`  ненулевых 32-битных слов: ${nonZero.length} из ${r.size / 4}`);
    }
    return 0;
  } finally {
    koffi.call(resolve(0xD22BDD7E).ptr, protos.Unload);
  }
}

/**
 * THE FIRST WRITE, and it is deliberately a no-op: offset 0 on one point.
 *
 * It changes nothing by construction, which is exactly why it is the right first write — it proves the
 * struct, the mask, the version and the call path while risking nothing. Read-back before and after.
 */
function mainWriteZero() {
  const nv = openNvapi();
  const { koffi, protos, resolve } = nv;
  const st = koffi.call(resolve(0x0150E828).ptr, protos.Initialize);
  if (st !== 0) { console.error(`NvAPI_Initialize: ${statusName(st)}`); return 1; }
  try {
    const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
    koffi.call(resolve(0xE5AC921F).ptr, protos.EnumPhysicalGPUs, handles, count);
    const handle = handles.readBigUInt64LE(0);
    const POINT = 64;

    const before = readVfOffsets(nv, handle);
    console.log(`ДО ЗАПИСИ:  сдвигов ненулевых ${before.ok ? before.nonZero : '—'} из 128${before.ok ? '' : ` (${before.why})`}`);
    console.log('ОТКАТ:      тот же вызов со сдвигом 0; плюс сдвиги энергозависимы — перезагрузка снимает их сама.');
    console.log(`ЗАПИСЬ:     точка ${POINT}, сдвиг 0 кГц — операция, не меняющая ничего по построению.`);

    const w = writeVfOffset(nv, handle, POINT, 0);
    console.log(`РЕЗУЛЬТАТ:  ${w.ok ? 'ПРИНЯТО' : 'ОТКАЗ'} — ${w.why}`);

    const after = readVfOffsets(nv, handle);
    console.log(`ПОСЛЕ:      сдвигов ненулевых ${after.ok ? after.nonZero : '—'} из 128`);
    if (before.ok && after.ok) {
      const same = JSON.stringify(before.offsets) === JSON.stringify(after.offsets);
      console.log(`СВЕРКА:     кривая ${same ? 'НЕ ИЗМЕНИЛАСЬ — как и обещано' : 'ИЗМЕНИЛАСЬ, чего быть не должно'}`);
      return same && w.ok ? 0 : 1;
    }
    return w.ok ? 0 : 1;
  } finally {
    koffi.call(resolve(0xD22BDD7E).ptr, protos.Unload);
  }
}

function main() {
  if (process.argv.includes('--curve')) return mainCurve();
  if (process.argv.includes('--control')) return mainControl();
  if (process.argv.includes('--write-zero')) return mainWriteZero();
  let report;
  try {
    report = probe();
  } catch (e) {
    console.error(`ОШИБКА: ${e.message}`);
    console.error('Если это «Cannot find module» — библиотека не установлена: npm install koffi');
    return 1;
  }

  console.log('РАЗРЕШЕНИЕ ИМЁН (nvapi_QueryInterface)');
  const width = Math.max(...NVAPI_IDS.map((e) => e.name.length));
  let need = 0;
  let needOk = 0;
  for (const r of report.table) {
    if (r.need) { need++; if (r.ok) needOk++; }
    console.log(`  ${r.ok ? 'ЕСТЬ ' : 'НЕТ  '} 0x${r.id.toString(16).toUpperCase().padStart(8, '0')} ${r.name.padEnd(width)}  ${r.need ? 'нужна' : '     '}  ${r.from}`);
  }
  console.log('');
  console.log(`ИТОГ РАЗРЕШЕНИЯ: отвечает ${report.table.filter((r) => r.ok).length} из ${report.table.length}; из НУЖНЫХ — ${needOk} из ${need}.`);

  console.log('');
  console.log('ЦЕПОЧКА (каждый слой доказан ответом, который мы уже знаем от nvidia-smi)');
  for (const c of report.chain) console.log(`  ${c.ok ? 'OK  ' : 'ПЛОХО'} ${c.what} — ${c.detail}`);

  if (report.gpus.length) {
    console.log('');
    for (const g of report.gpus) console.log(`  КАРТА ${g.index}: ${g.name ?? '—'} · дескриптор ${g.handle}`);
  }
  return 0;
}

// T9 — a module others import must not execute on import.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main());
}
