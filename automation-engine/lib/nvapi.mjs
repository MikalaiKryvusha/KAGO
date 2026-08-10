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
 * ─── THE ARRAY STARTS AT 0x44, AND THAT COST TWO SILENT NO-OPS ────────────────────────────────────
 *
 * The first two addressed writes returned OK and changed nothing. The cause was found by asking the
 * driver a READ-ONLY question instead of guessing a third time: request the control structure with a
 * mask carrying a single bit for point 64, and see where the answer lands. It landed one entry LATER
 * than assumed. The array does not begin right after the 0x20 header — the header is 0x44 bytes.
 *
 * Every earlier number re-derives correctly under this base, which is what makes it a measurement and
 * not another guess:
 *   - first changed word 0x58  = 0x44 + 0*0x24 + 0x14  -> point 0
 *   - last changed word  0x1210 = 0x44 + 126*0x24 + 0x14 -> point 126
 *   - the "mystery 1" at 0x1220 = 0x44 + 127*0x24        -> the FIRST dword of point 127's entry,
 *     which is why it was never explained as a curve field
 *
 * And it explains the no-op exactly: the mask bit was right, the value was written 0x24 bytes before
 * the address the driver reads. A malformed selection is not a malformed CALL, so the status stayed 0.
 *
 * WHAT IS NOT KNOWN, said plainly rather than smoothed over: the lever moves points 0..126 and leaves
 * point 127 alone, and point 127 is also the one carrying that non-zero first dword. No code may treat
 * it as an ordinary point until that is understood.
 */
export const CLK_VF_CONTROL_SIZE = 0x2420;
export const CLK_VF_CONTROL_STRIDE = 0x24;
export const CLK_VF_CONTROL_DATA_OFFSET = 0x44;
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
 * Returns the RAW buffer alongside the decoded offsets on purpose: a caller checking a WRITE must be
 * able to compare all 9 248 bytes, not only the 128 numbers we decode out of them — the byte-for-byte
 * return to the pre-write snapshot is what makes a rollback an observation instead of a hope.
 */
export function readVfOffsets(nv, handle, { version = 1, mask = 'all' } = {}) {
  const { koffi, protos, resolve } = nv;
  const entry = resolve(0x23F1B133);
  if (!entry.ok) return { ok: false, why: 'ClkVfPointsGetControl не разрешился' };
  const buf = Buffer.alloc(CLK_VF_CONTROL_SIZE);
  buf.writeUInt32LE(nvapiVersion(CLK_VF_CONTROL_SIZE, version), 0);
  // The mask is an INPUT in both directions — the dump proved the driver never writes it back. Making
  // it a parameter is what turns "the mask lives at 0x04" from the source's claim into something a
  // read-only call can test: ask with no bits, or with one, and see what comes back.
  if (mask === 'all') buf.fill(0xFF, 0x04, 0x14);
  else if (Number.isInteger(mask)) buf[0x04 + (mask >> 3)] = 1 << (mask & 7);
  // mask === 'none' leaves the region zeroed
  const status = koffi.call(entry.ptr, protos.ClkVfPointsGetControl, handle, buf);
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
export function writeVfOffset(nv, handle, pointIndex, offsetKhz, { version = 1, mode = 'rmw' } = {}) {
  const { koffi, protos, resolve } = nv;
  const entry = resolve(0x0733E009);
  if (!entry.ok) return { ok: false, why: 'ClkVfPointsSetControl не разрешился' };

  let buf;
  if (mode === 'zero-filled') {
    // The shape the source implies, KEPT ONLY AS A NAMED COMPARISON — measured 2026-08-10 to be a
    // SILENT NO-OP on this card: status 0, and not one byte of the structure changes. It is retained
    // so the finding stays reproducible, never as a path anything ships on.
    buf = buildVfControl(pointIndex, offsetKhz, { version });
  } else {
    // READ-MODIFY-WRITE — the API's ordinary shape. Ask the driver for the CURRENT control structure,
    // change exactly one field in it, hand the whole thing back. A zero-filled buffer throws away every
    // service field the driver put there (entry counts, domain ids, whatever sits past the entry array
    // at 0x1220), and a driver handed a structure describing nothing does nothing — while still
    // answering OK, because nothing about the call was malformed.
    const current = readVfOffsets(nv, handle, { version });
    if (!current.ok) return { ok: false, why: `не удалось прочитать текущее состояние: ${current.why}` };
    buf = Buffer.from(current.raw);
    buf.fill(0, 0x04, 0x14);                                   // clear the mask the READ requested
    buf[0x04 + (pointIndex >> 3)] = 1 << (pointIndex & 7);      // exactly one bit — one point per call
    buf.writeInt32LE(offsetKhz, vfControlFieldAt(pointIndex));
  }

  const status = koffi.call(entry.ptr, protos.ClkVfPointsSetControl, handle, buf);
  return { ok: status === 0, status, why: statusName(status), mode };
}

/**
 * Read-only hex dump of the regions that decide whether a WRITE is well-formed.
 *
 * Written after two accepted-but-inert writes. The point is not the bytes themselves but WHOSE bytes
 * they are: NVML can drive this structure into a state the driver considers real, so dumping it clean
 * and again under an NVML offset shows what a POPULATED control structure looks like — the template a
 * correct SetControl has to reproduce. Observation instead of a third guess (`PHILOSOPHY.md`).
 */
export function dumpControlRegions(raw) {
  const hex = (at, len) => raw.subarray(at, at + len).toString('hex').replace(/(.{8})/g, '$1 ').trim();
  const regions = [
    { label: 'заголовок 0x00…0x20 (версия, маска, что-то ещё)', at: 0x00, len: 0x20 },
    { label: 'запись 0   (0x20, 36 байт)', at: 0x20, len: CLK_VF_CONTROL_STRIDE },
    { label: 'запись 1   (0x44, 36 байт)', at: 0x44, len: CLK_VF_CONTROL_STRIDE },
    { label: `запись 64  (0x${(0x20 + 64 * CLK_VF_CONTROL_STRIDE).toString(16)}, 36 байт)`, at: 0x20 + 64 * CLK_VF_CONTROL_STRIDE, len: CLK_VF_CONTROL_STRIDE },
    { label: `запись 127 (0x${(0x20 + 127 * CLK_VF_CONTROL_STRIDE).toString(16)}, 36 байт)`, at: 0x20 + 127 * CLK_VF_CONTROL_STRIDE, len: CLK_VF_CONTROL_STRIDE },
    { label: 'СРАЗУ ЗА массивом 0x1220 (тут жила загадочная единица)', at: 0x1220, len: 0x40 },
  ];
  return regions.map((r) => ({ ...r, hex: hex(r.at, r.len) }));
}

// =================================================================================================
// 3b. THE MASK PROOF — the first ADDRESSED write, and the only claim still resting on the source
// =================================================================================================

/**
 * Read the offsets until TWO CONSECUTIVE SAMPLES AGREE (EXP-0014).
 *
 * A GPU write settles asynchronously and the first read after one can return the previous value —
 * that is how a correct write gets reported to the owner as a failure. Compares the whole raw buffer,
 * not just the decoded numbers, so a change ANYWHERE in the structure also has to settle.
 */
export function readVfOffsetsStable(nv, handle, { maxSamples = 12, gapMs = 250 } = {}) {
  let previous = null;
  for (let i = 0; i < maxSamples; i++) {
    const r = readVfOffsets(nv, handle);
    if (!r.ok) return { ...r, samples: i + 1 };
    if (previous && Buffer.compare(previous, r.raw) === 0) return { ...r, stable: true, samples: i + 1 };
    previous = r.raw;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, gapMs); // blocking sleep, no timer
  }
  return { ok: false, why: `структура не устоялась за ${maxSamples} проб` };
}

/**
 * WRITE ONE POINT AND PROVE THE MASK.
 *
 * ─── WHY THIS RUN EXISTS ──────────────────────────────────────────────────────────────────────────
 * Every measurement behind the layout in researches/05 §8 moved the NVML lever, and that lever shifts
 * ALL points at once. So "the mask carries exactly one bit and therefore one point moves" is still the
 * SOURCE's claim, not our observation — and it is the claim the whole safety story rests on, because
 * "a bad write has a blast radius of one point" is only true if the mask does what §3.4 says.
 *
 * ─── THE OWNER'S-MACHINE RULE, WALKED ─────────────────────────────────────────────────────────────
 *  1. LOOKED UP: researches/05 §3.4 (mask = exactly one bit; all 128 bits returns -1) and §5 (error
 *     codes: -9 wrong layout, -1 generic). The struct version 1 at size 0x2420 is already PROVEN
 *     accepted by the earlier `--write-zero` run.
 *  2. ROLLBACK, NAMED BEFORE THE WRITE: the same call, same point, offset 0 — executed in a `finally`
 *     on every path. It is SYMMETRIC with the write by construction, which matters more than it
 *     sounds: if the mask turns out NOT to isolate one point and the offset lands on all 128, the
 *     undo has exactly the same reach as the do. The physical backstop underneath: these offsets are
 *     volatile driver state, so a reboot clears them with no action from the owner.
 *  3. SMALLEST REVERSIBLE FORM, and the DIRECTION IS THE SAFETY: the offset is NEGATIVE. A negative
 *     frequency offset means "this voltage point now runs SLOWER" — more voltage than the frequency
 *     needs, i.e. the stable direction. The dangerous direction is POSITIVE (that is the undervolt),
 *     and it is not attempted until the mask is proven. Worst case here, if the mask does nothing, is
 *     a -15 MHz downclock across the curve — undone by the same call with 0.
 *  4. RE-READ UNTIL STABLE: `readVfOffsetsStable`, two agreeing full-buffer samples.
 *  5. REPORT NUMBERS: every block prints what it saw, and the rollback is verified byte-for-byte
 *     against the pre-write snapshot.
 *
 * The verdict this run produces is binary and it is the point: EXACTLY ONE entry changed, and it is
 * the one we addressed — or the mask does not isolate, which must be known before any real profile.
 */
export function proveMask(handle, nv, { point = 64, offsetMhz = -15, mode = 'rmw' } = {}) {
  const offsetKhz = offsetMhz * 1000;
  const out = { point, offsetMhz, mode, blocks: [], written: false, rolledBack: false };
  const block = (name, ok, detail) => out.blocks.push({ name, ok, detail });

  const before = readVfOffsets(nv, handle);
  block('снимок ДО: структура прочитана, все сдвиги нулевые',
    before.ok && before.nonZero === 0, before.ok ? `ненулевых ${before.nonZero} из 128` : before.why);
  if (!before.ok) return out;

  const curveBefore = readVfCurve(nv, handle);
  const freqBefore = curveBefore.ok ? curveBefore.points[point].mhz : null;

  try {
    const w = writeVfOffset(nv, handle, point, offsetKhz, { mode });
    block(`ЗАПИСЬ (${mode}): точка ${point}, сдвиг ${offsetMhz} МГц (${offsetKhz} кГц), один бит маски`, w.ok, w.why);
    if (!w.ok) return out;
    out.written = true;

    const after = readVfOffsetsStable(nv, handle);
    block('перечитывание до устойчивости (две совпавшие полные пробы)',
      after.ok, after.ok ? `проб ${after.samples}` : after.why);
    if (!after.ok) return out;

    // --- THE VERDICT. Which entries moved, and is it exactly the one we addressed?
    const moved = [];
    for (let i = 0; i < CLK_VF_POINT_COUNT; i++) {
      if (after.offsets[i] !== before.offsets[i]) moved.push(i);
    }
    out.moved = moved;
    block(`МАСКА ИЗОЛИРУЕТ: сдвинулась РОВНО ОДНА запись, и это ${point}`,
      moved.length === 1 && moved[0] === point,
      moved.length === 0 ? 'не сдвинулась НИ ОДНА — запись принята, но ничего не изменила'
        : `сдвинулись ${moved.length}: ${moved.slice(0, 12).join(', ')}${moved.length > 12 ? ' …' : ''}`);
    block(`значение в точке ${point} равно записанному`,
      after.offsets[point] === offsetKhz, `прочитано ${after.offsets[point]} кГц, писали ${offsetKhz}`);

    // --- the second, independently-authored witness: did the CURVE itself move at that point?
    const curveAfter = readVfCurve(nv, handle);
    if (curveBefore.ok && curveAfter.ok) {
      const freqAfter = curveAfter.points[point].mhz;
      out.curve = { point, freqBefore, freqAfter, deltaMhz: Number((freqAfter - freqBefore).toFixed(3)) };
      const others = [];
      for (let i = 0; i < CLK_VF_POINT_COUNT; i++) {
        if (i !== point && curveAfter.points[i].freqKhz !== curveBefore.points[i].freqKhz) others.push(i);
      }
      out.curveOthersMoved = others;

      // THE FLOOR IS A NAMED CASE, NOT A LOOSENED PREDICATE (EXP-0020's second half). A large part of
      // this curve's low end sits at the card's minimum clock — measured here, points 0..~20 all read
      // 180 MHz at rising voltages — and a NEGATIVE offset there has nowhere to go. The control struct
      // still records the value (the block above proves that); the curve simply clamps. Relaxing the
      // check to "delta may be zero" would also accept a write that did nothing anywhere, so the floor
      // is DETECTED and asserted separately instead.
      const floorMhz = Math.min(...curveBefore.points.filter((p) => p.freqKhz > 0).map((p) => p.mhz));
      out.curveFloorMhz = floorMhz;
      out.atFloor = freqBefore <= floorMhz;

      if (out.atFloor) {
        block(`кривая: точка ${point} НА ПОЛУ (${floorMhz} МГц) — отрицательный сдвиг упирается, и это верно`,
          out.curve.deltaMhz === 0 && others.length === 0,
          `${freqBefore} → ${freqAfter} МГц (Δ ${out.curve.deltaMhz}); значение в структуре записано, `
          + `двигаться некуда; других точек сдвинулось ${others.length}`);
      } else {
        block(`кривая: точка ${point} поехала, соседи стоят (второй свидетель)`,
          out.curve.deltaMhz !== 0 && others.length === 0,
          `${freqBefore} → ${freqAfter} МГц (Δ ${out.curve.deltaMhz}); других точек сдвинулось ${others.length}`);
      }
    }
  } finally {
    if (out.written) {
      const r = writeVfOffset(nv, handle, point, 0, { mode });
      const back = readVfOffsetsStable(nv, handle);
      const identical = back.ok && Buffer.compare(before.raw, back.raw) === 0;
      out.rolledBack = r.ok && identical;
      block('ОТКАТ: тот же вызов со сдвигом 0, структура побайтово равна исходной',
        out.rolledBack, `${r.why} · ${back.ok ? (identical ? '9 248 байт совпали' : 'БАЙТЫ РАСХОДЯТСЯ') : back.why}`);
    }
  }
  return out;
}

function mainProveMask(point, offsetMhz, mode) {
  const nv = openNvapi();
  const { koffi, protos, resolve } = nv;
  const st = koffi.call(resolve(0x0150E828).ptr, protos.Initialize);
  if (st !== 0) { console.error(`NvAPI_Initialize: ${statusName(st)}`); return 1; }
  try {
    const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
    koffi.call(resolve(0xE5AC921F).ptr, protos.EnumPhysicalGPUs, handles, count);
    if (count.readUInt32LE(0) < 1) { console.error('карт не найдено'); return 1; }
    const handle = handles.readBigUInt64LE(0);

    console.log('ПЕРВАЯ АДРЕСНАЯ ЗАПИСЬ ЧЕРЕЗ NvAPI — И ПРОВЕРКА МАСКИ');
    console.log('');
    console.log(`  ЧТО ДЕЛАЕМ: сдвиг ${offsetMhz} МГц в ОДНУ точку ${point}, один бит маски.`);
    console.log('  ОТКАТ:      тот же вызов, та же точка, сдвиг 0 — в finally, на любом пути.');
    console.log('              Он СИММЕТРИЧЕН записи: если маска не изолирует, откат достанет ровно');
    console.log('              туда же, куда достала запись. Сдвиги энергозависимы — перезагрузка их снимает.');
    console.log('  НАПРАВЛЕНИЕ: ОТРИЦАТЕЛЬНОЕ. Точка станет работать МЕДЛЕННЕЕ при своём напряжении —');
    console.log('              это устойчивая сторона. Опасная сторона (андервольт) — положительная,');
    console.log('              и до доказанной маски её не трогаем.');
    console.log('');

    const r = proveMask(handle, nv, { point, offsetMhz, mode });
    for (const b of r.blocks) console.log(`  ${b.ok ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}  ${b.name}\n            ${b.detail}`);

    const failed = r.blocks.filter((b) => !b.ok).length;
    console.log('');
    console.log(`ИТОГ: блоков ${r.blocks.length}, провалов ${failed}. ПРОВЕРКА ЗАВЕРШЕНА.`);
    console.log(`ОТКАТ ВЫПОЛНЕН: ${r.rolledBack ? 'да, структура вернулась побайтово' : 'НЕТ — РАЗБИРАТЬСЯ НЕМЕДЛЕННО'}`);
    return failed === 0 ? 0 : 1;
  } finally {
    koffi.call(resolve(0xD22BDD7E).ptr, protos.Unload);
  }
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
  const pm = process.argv.indexOf('--prove-mask');
  if (pm !== -1) {
    // Point and magnitude are arguments, not literals: the mask must be provable at more than one
    // point before "one bit isolates one entry" is a property rather than a single lucky address.
    const point = Number(process.argv[pm + 1] ?? 64);
    const mhz = Number(process.argv[pm + 2] ?? -15);
    if (!Number.isInteger(point) || point < 0 || point >= CLK_VF_POINT_COUNT) {
      console.error(`точка вне диапазона 0…${CLK_VF_POINT_COUNT - 1}: ${process.argv[pm + 1]}`);
      return 1;
    }
    if (!Number.isFinite(mhz) || mhz > 0) {
      console.error(`сдвиг должен быть отрицательным (устойчивая сторона), получено: ${process.argv[pm + 2]}`);
      return 1;
    }
    return mainProveMask(point, mhz, process.argv.includes('--zero-filled') ? 'zero-filled' : 'rmw');
  }
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
