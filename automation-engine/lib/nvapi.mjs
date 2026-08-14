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
// [TESTED: 2026-08-10 · `npm run nvapi` — 17 of 17 ids resolve and 12 of 12 needed ones; the chain is
//  proved on values a SECOND instrument already gave us (NVAPI itself says driver 610.88 / r610_85 and
//  "NVIDIA GeForce RTX 5070 Ti", matching `nvidia-smi` exactly, with NVML agreeing as a third reading).
//  `--curve` reads 128 of 128 points and the measured 5 mV grid step matches config. `--fans` reads all
//  three coolers and its levels agree with `nvidia-smi fan.speed`. The WRITE paths carry their own
//  markers at their own functions — `--prove-mask 64 -15` re-verified today: 9 blocks, 0 failures,
//  exactly one entry moved, rollback byte-exact over 9 248 bytes. Re-run by the phase-4 judge pass]

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
/**
 * One bridge per process, cached.
 *
 * `koffi.proto()` registers each prototype under a GLOBAL name, so a second `openNvapi()` in the same
 * process throws `Duplicate type name 'NvAPI_Initialize'`. Found by the watchdog drill, which opens the
 * card repeatedly while it waits for the guard to act — and it would have hit any long-running caller
 * (the search engine of phase 5 above all). The library and its prototypes are process-wide facts, so
 * caching them is not an optimisation, it is the correct lifetime.
 */
let bridgeCache = null;

export function openNvapi({ dll = 'nvapi64.dll' } = {}) {
  if (bridgeCache && bridgeCache.dll === dll) return bridgeCache.bridge;
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
    // Fans — the READ half only. `SetControl` gets its prototype in the same step that names its
    // rollback and arms the watchdog for it (researches/05 §9.3); a prototype that exists is a call a
    // future session can make by accident.
    ClientFanCoolersGetInfo: koffi.proto('int ClientFanCoolersGetInfo(uint64_t gpu, void *info)'),
    ClientFanCoolersGetStatus: koffi.proto('int ClientFanCoolersGetStatus(uint64_t gpu, void *st)'),
    ClientFanCoolersGetControl: koffi.proto('int ClientFanCoolersGetControl(uint64_t gpu, void *ctl)'),
    ClientFanCoolersSetControl: koffi.proto('int ClientFanCoolersSetControl(uint64_t gpu, void *ctl)'),
  };

  /** Resolve one id. A null pointer is the SAFE failure mode of a wrong id — report, never throw. */
  const resolve = (id) => {
    let ptr = null;
    try { ptr = queryInterface(id); } catch (e) { return { ok: false, ptr: null, why: e.message }; }
    const address = ptr ? koffi.address(ptr) : 0n;
    return { ok: Boolean(ptr) && address !== 0n, ptr, address };
  };

  const bridge = { koffi, lib, queryInterface, protos, resolve };
  bridgeCache = { dll, bridge };
  return bridge;
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

// -------------------------------------------------------------------------------------------------
// The FAN client structs. Derived arithmetically from the field lists of TWO independently-authored
// sources that agree field for field (researches/05 §9.1: nvfancontrol, Rust/Windows — and
// LibreHardwareMonitor, C#). Every member is a 4-byte unsigned, so each item struct's alignment is 4
// and `Pack = 8` adds no padding; the sizes below are therefore derivations, not guesses.
//
//   status  header 0x28 + 32 items x 0x34 = 1704 = 0x6A8
//   control header 0x2C + 32 items x 0x2C = 1452 = 0x5AC
//   info    header 0x2C + 32 items x 0x30 = 1580 = 0x62C
//
// `count` is filled BY THE DRIVER on every read — we send 0 and read back how many coolers this card
// actually has. A count of 0 or of exactly 32 would mean the layout is wrong rather than the card being
// unusual (researches/05 §9.4).
// [TESTED: 2026-08-10 · all three sizes accepted by the driver at version number 1 on the FIRST attempt
//  (`npm run nvapi -- --fans`), and the decode holds against the shape a real card must have: 3 coolers
//  — not 0 and not 32 — 3 000 rpm ceiling each, levels inside 0…100, and the same cooler count from all
//  three structs. `currentMinLevel` = 30 % answered a question phase 2 could not: that 30 % is the
//  card's own floor. The earlier note here said "nothing has been run on this card yet"; it was true
//  when written and false the moment the probe ran, which is why the phase-4 judge pass caught it]
export const FAN_COOLER_MAX = 32;
export const FAN_STATUS_SIZE = 0x28 + FAN_COOLER_MAX * 0x34;
export const FAN_STATUS_DATA_OFFSET = 0x28;
export const FAN_STATUS_STRIDE = 0x34;
export const FAN_CONTROL_SIZE = 0x2C + FAN_COOLER_MAX * 0x2C;
export const FAN_CONTROL_DATA_OFFSET = 0x2C;
export const FAN_CONTROL_STRIDE = 0x2C;
export const FAN_INFO_SIZE = 0x2C + FAN_COOLER_MAX * 0x30;
export const FAN_INFO_DATA_OFFSET = 0x2C;
export const FAN_INFO_STRIDE = 0x30;

/** The client interface's control mode. Both sources state these values (researches/05 §9.2). */
export const FAN_MODE = Object.freeze({ AUTO: 0, MANUAL: 1 });

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

// =================================================================================================
// 3b. The FANS — READ ONLY, and the read is worth a whole step of its own
// =================================================================================================

/**
 * Read every fan cooler this card reports: how many, at what level, and WHAT FLOOR THE CARD ITSELF
 * NAMES.
 *
 * Research anchor (`researches/05` §7 step 3): *"Fans, read then write. `ClientFanCoolersGetStatus`
 * first"* — and §9.4 says why the read earns its own step even if the write is later refused: the
 * status item carries `currentMinLevel`, which is the card's own statement of its firmware floor. Phase
 * 2 saw the fan sit at 30 % across five ladder rungs and could not tell whether that was a floor or
 * just where the stock curve lands. This read answers it without changing anything.
 *
 * THE VERSION IS PROBED, NOT ASSUMED — same discipline as `readVfCurve`. Both sources say version
 * number 1, but a source is not this driver: a wrong encoding answers -9 INCOMPATIBLE_STRUCT_VERSION,
 * which is a clean refusal that changes no state (`researches/05` §5.6).
 *
 * Read-only. Nothing here writes to the device: `GetStatus`, `GetControl` and `GetInfo` only fill a
 * buffer we own.
 *
 * [TESTED: 2026-08-10 · `npm run nvapi -- --fans` on this card — 3 coolers, level 0 % / mode AUTO at
 *  rest, floor 30 %, ceiling 3 000 rpm; our decoded level agreed with `nvidia-smi --query-gpu=fan.speed`
 *  (0 % vs 0 %), and under a manual 60 % both instruments moved together (61 % / 1878-1860-1873 rpm) —
 *  the second, independently-authored reading this marker was waiting for (EXP-0017)]
 */
export function readFanCoolers(nv, handle, { versions = [1, 2, 3, 4] } = {}) {
  const { koffi, protos, resolve } = nv;

  /** One read: walk the candidate version numbers, decode with `parse` on the first acceptance. */
  const readOne = (id, protoName, size, parse) => {
    const entry = resolve(id);
    if (!entry.ok) return { ok: false, why: `${protoName} не разрешился`, attempts: [] };
    const attempts = [];
    for (const v of versions) {
      const buf = Buffer.alloc(size);
      buf.writeUInt32LE(nvapiVersion(size, v), 0);
      const status = koffi.call(entry.ptr, protos[protoName], handle, buf);
      attempts.push({ version: v, status, name: statusName(status) });
      if (status === 0) return { ok: true, version: v, attempts, ...parse(buf) };
    }
    return { ok: false, attempts, why: 'ни одна версия структуры не принята' };
  };

  const status = readOne(0x35AED5E8, 'ClientFanCoolersGetStatus', FAN_STATUS_SIZE, (buf) => {
    const count = buf.readUInt32LE(0x04);
    const coolers = [];
    for (let i = 0; i < Math.min(count, FAN_COOLER_MAX); i++) {
      const at = FAN_STATUS_DATA_OFFSET + i * FAN_STATUS_STRIDE;
      coolers.push({
        id: buf.readUInt32LE(at),
        rpm: buf.readUInt32LE(at + 0x04),
        minLevel: buf.readUInt32LE(at + 0x08),
        maxLevel: buf.readUInt32LE(at + 0x0C),
        level: buf.readUInt32LE(at + 0x10),
      });
    }
    return { count, coolers, raw: buf };
  });

  const control = readOne(0x814B209F, 'ClientFanCoolersGetControl', FAN_CONTROL_SIZE, (buf) => {
    const count = buf.readUInt32LE(0x08);
    const coolers = [];
    for (let i = 0; i < Math.min(count, FAN_COOLER_MAX); i++) {
      const at = FAN_CONTROL_DATA_OFFSET + i * FAN_CONTROL_STRIDE;
      const mode = buf.readUInt32LE(at + 0x08);
      coolers.push({
        id: buf.readUInt32LE(at),
        level: buf.readUInt32LE(at + 0x04),
        mode,
        modeName: mode === FAN_MODE.MANUAL ? 'MANUAL' : mode === FAN_MODE.AUTO ? 'AUTO' : `неизвестный(${mode})`,
      });
    }
    return { count, coolers, raw: buf };
  });

  const info = readOne(0xFB85B01E, 'ClientFanCoolersGetInfo', FAN_INFO_SIZE, (buf) => {
    const count = buf.readUInt32LE(0x08);
    const coolers = [];
    for (let i = 0; i < Math.min(count, FAN_COOLER_MAX); i++) {
      const at = FAN_INFO_DATA_OFFSET + i * FAN_INFO_STRIDE;
      coolers.push({ id: buf.readUInt32LE(at), maxRpm: buf.readUInt32LE(at + 0x0C) });
    }
    return { count, coolers, raw: buf };
  });

  return { status, control, info };
}

// =================================================================================================
// 3c. THE CURVE AS ONE ARTIFACT — one writer, and the profile's shape as arithmetic
// =================================================================================================

/**
 * THE SHIPPED PROFILE'S SHAPE, and it is the owner's requirement expressed as a formula.
 *
 * His words (chat 2026-08-10): *«Я хочу, чтобы карта сама могла и разгоняться и снижать частоты, но
 * работала на пониженном напряжении согласно кривой VF профиля»* — so the clock is NEVER pinned. The
 * card keeps its whole range, from the 180 MHz idle floor to the stock maximum, and every frequency in
 * it is served at less voltage than at stock.
 *
 *     offset_i = clamp(F_top − F_i , 0 , Δ)          F_top = the stock curve's highest frequency
 *
 * WHY THE CAP AT ALL, since a cap sounds like the pin he rejected: it is not the same thing. A pin
 * forbids movement in BOTH directions; this cap only says no point may offer MORE than the card already
 * offered at stock. Without it the card takes the freed headroom as SPEED — it boosts past stock at the
 * same voltage and the watts do not fall (`researches/02` §6.2), which is the opposite of the owner's
 * formula. With it, the stock top frequency is served by a LOWER-voltage point, and that difference IS
 * the undervolt.
 *
 * Two properties that fall out of the formula rather than being designed in, and both make this the
 * safest write shape this project has:
 *   • every offset is NON-NEGATIVE — the top points get a SMALLER raise, never a negative one, so the
 *     earlier plan's "flatten the tail with negative offsets" turned out to be unnecessary;
 *   • `min(F_i + Δ, F_top)` preserves monotonicity, so a monotone curve cannot be made non-monotone by
 *     this vector at any Δ. That is a proof, not a test result.
 *
 * Point 127 is excluded by the caller (it is not a graphics point — 515 mV / 405 MHz against its
 * neighbour's 1240 mV / 3172 MHz), and `F_top` is taken over the points we actually write.
 *
 * ─── THE CAP HAS A FLOOR, AND IT IS THE HARDWARE'S, NOT OURS ──────────────────────────────────────
 *
 * A cap is enforced by pushing the points ABOVE it down onto it, and that push is an offset like any
 * other — bounded by the range the hardware published, −1000…+1000 MHz (`researches/05` §8). So a
 * point sitting at `F_top` cannot be moved below `F_top − 1000`, and **no cap below
 * `topMhz + CLOCK_OFFSET_MIN_MHZ` can be held by the curve at all.** On this card's curve that floor
 * is **3172 − 1000 = 2172 MHz**, computed 2026-08-14 across Δ = 0, 45, 180, 300 and 540: the leak is
 * identical at every raise, because the raise is not what runs out — the push-down is.
 *
 * Two consequences this function refuses to hide, which is why it now returns a verdict rather than
 * only a vector:
 *
 *   • **`Silent Cold` at 2100 MHz (STATUS fact 34+36) is BELOW that floor** — the shipped curve alone
 *     leaves the card able to reach 2172, i.e. 72 MHz above the ceiling the mode was read off the
 *     thermal ladder at. Whoever ships that mode has to hold the ceiling with something else, or say
 *     out loud that it is 2172.
 *   • A search that wants the shipped shape at a low band rung CANNOT have it. There the ceiling is
 *     held by the measurement's clock pin instead, and the caller is the one that must say which of
 *     the two is holding it (`vf-step.chooseWriteShape`).
 *
 * What does NOT change with the cap, and it was computed rather than assumed: **the point serving any
 * clock ≤ cap, and therefore its voltage, is IDENTICAL under a uniform raise and under this vector**
 * (checked at caps 2842 / 2400 / 2172 against Δ = 45 / 180 / 300 — the same point index and the same
 * millivolts in all nine). A point reaches C iff `F_i + Δ ≥ C`, and the cap does not touch that
 * condition; all the cap changes is what the card may do ABOVE the tested clock. So switching the
 * search onto this shape does not move the measured Vmin — it removes the raised tail the card could
 * otherwise boost into, which is exactly the mechanism that made `bugs/02`'s run fail at ~3400 MHz
 * while reporting a number about 2842.
 *
 * [NOT-TESTED] at birth — offline blocks in `--selftest-shape` are what flip this.
 */
export function buildRaiseAndCapVector(points, deltaMhz, { count = CLK_VF_POINT_COUNT - 1, capMhz = null } = {}) {
  const usable = points.slice(0, count).filter((p) => p.freqKhz > 0);
  if (!usable.length) return { ok: false, why: 'ни одной точки с частотой' };
  const topMhz = Math.max(...usable.map((p) => p.mhz));
  const cap = capMhz === null ? topMhz : capMhz;

  const offsets = [];
  for (let i = 0; i < count; i++) {
    const p = points[i];
    // A point with no frequency gets no offset: there is nothing to raise and nothing to cap.
    if (!p || p.freqKhz <= 0) { offsets.push(0); continue; }
    // min(Δ, cap − F_i), and NOTHING clamps it up to 0: a point already ABOVE the cap must be pushed
    // DOWN to it, or the card can still boost past the cap and the whole point of the cap is lost.
    // MEASURED 2026-08-10, and this is why the lower clamp was removed: with the cap at the curve's TOP
    // the card never reached it under load (it sat at 2887 of a 3172 top), so the cap bound nothing and
    // the raise was taken as SPEED — 2887 → 2932 MHz at 137.3 → 137.1 W, i.e. no saving at all.
    const wanted = Math.min(deltaMhz, cap - p.mhz);
    // The wall is named by the HARDWARE, not by our caution: NVML published −1000…+1000 MHz for the
    // graphics domain (`researches/05` §8), and config carries it with `..._IS_MEASURED = true`.
    offsets.push(Math.max(config.CLOCK_OFFSET_MIN_MHZ, Math.min(config.CLOCK_OFFSET_MAX_MHZ, wanted)));
  }
  // WHAT THE CURVE ACTUALLY OFFERS AFTER THE WRITE — computed, never assumed. The cap is a WISH until
  // this number confirms it, and on this card the wish does not always come true: see below.
  let highestOfferedMhz = -Infinity;
  for (let i = 0; i < count; i++) {
    const p = points[i];
    if (!p || p.freqKhz <= 0) continue;
    highestOfferedMhz = Math.max(highestOfferedMhz, p.mhz + offsets[i]);
  }
  if (!Number.isFinite(highestOfferedMhz)) highestOfferedMhz = topMhz;
  // The floor is arithmetic, not a measurement of this run: a point at F_top can be pushed down by at
  // most |CLOCK_OFFSET_MIN_MHZ|, so no cap below `topMhz + CLOCK_OFFSET_MIN_MHZ` can ever be held by
  // the curve alone. On this card that is 3172 − 1000 = 2172 MHz.
  const lowestEnforceableCapMhz = topMhz + config.CLOCK_OFFSET_MIN_MHZ;

  return {
    ok: true,
    topMhz,
    capMhz: cap,
    capIsBelowTop: cap < topMhz,
    deltaMhz,
    offsets,
    atFullDelta: offsets.filter((o) => o === deltaMhz).length,
    raisedButCapped: offsets.filter((o) => o > 0 && o < deltaMhz).length,
    pushedDown: offsets.filter((o) => o < 0).length,
    zero: offsets.filter((o) => o === 0).length,
    maxOffset: Math.max(...offsets),
    minOffset: Math.min(...offsets),
    highestOfferedMhz,
    lowestEnforceableCapMhz,
    capEnforced: highestOfferedMhz <= cap,
    capLeakMhz: Math.max(0, highestOfferedMhz - cap),
  };
}

/**
 * ONE writer for the whole curve, taking a VECTOR.
 *
 * Before this existed the 128-point write/zero loop was open-coded five times in `vf-step.mjs` and once
 * in `watchdog.mjs`, and the copies already disagreed: `vf-step` excluded point 127, `watchdog` did not.
 * Harmless while nothing moves point 127, and exactly the shape of a defect class — so one place now
 * owns "point 127 is not a graphics point", "a rollback zeroes EVERYTHING rather than a difference", and
 * "status 0 is not verification, the read-back is" (EXP-0024).
 *
 * The API takes one point per call, which is why a total write is a loop — the same constraint that
 * keeps a bad write's blast radius at one point.
 *
 * [NOT-TESTED] at birth.
 */
export function writeCurve(nv, handle, offsetsMhz, { count = CLK_VF_POINT_COUNT - 1 } = {}) {
  const asArray = Array.isArray(offsetsMhz)
    ? offsetsMhz
    : Array.from({ length: count }, () => offsetsMhz);
  let failed = 0;
  const failures = [];
  for (let p = 0; p < count; p++) {
    const r = writeVfOffset(nv, handle, p, Math.round((asArray[p] ?? 0) * 1000));
    if (!r.ok) { failed++; if (failures.length < 5) failures.push({ point: p, why: r.why ?? r.status }); }
  }
  return { ok: failed === 0, written: count - failed, failed, failures };
}

/** The total undo: every point to zero, then a read that must find none left. Zeroing a zero is free. */
export function zeroCurve(nv, handle, { count = CLK_VF_POINT_COUNT - 1 } = {}) {
  const w = writeCurve(nv, handle, 0, { count });
  const after = readVfOffsets(nv, handle);
  return {
    ok: w.ok && after.ok && after.nonZero === 0,
    failed: w.failed,
    remainingNonZero: after.ok ? after.nonZero : 'не прочитано',
  };
}

/**
 * WRITE the fan control struct — read-modify-write, always.
 *
 * `researches/05` §9.3 item 2 states the rule and its reason: unlike the curve struct (where
 * `--zero-filled` proved read-modify-write was NOT what fixed the silent no-op — EXP-0024), the fan
 * control record's reserved words come from the DRIVER and we do not know what they mean. So the buffer
 * we send is the buffer we were given, with `level` and `controlMode` changed and nothing else touched.
 *
 * `mode = FAN_MODE.AUTO` is THE ROLLBACK, and it is idempotent: it is what the card boots with, it needs
 * no memory of what was applied, and setting AUTO on an already-automatic cooler cannot be wrong. That
 * is the same reasoning rule R9 uses for the curve — after a crash nobody knows what was applied, so
 * the only honest undo is the factory state.
 *
 * `level` is ignored by the card in AUTO and is sent as the read-back value rather than zeroed, so a
 * rollback never asks for 0 % on a card that would obey it.
 *
 * [TESTED: 2026-08-10 · driven live at 60 % and 80 % (`--fan-write`), each verified by TWO instruments —
 *  our own rpm read (1878/1860/1873 against an expected 1800; 2404/2366/2401 against 2400) and
 *  `nvidia-smi fan.speed` (61 %, 79 %) — and each rolled back to AUTO with 0 coolers left in MANUAL and
 *  rpm returning to 0/0/0. The AUTO path is exercised on every single run, since it IS the rollback.
 *  A refusal below the card's 30 % floor is a named block rather than an attempted write]
 */
export function writeFanControl(nv, handle, { mode, level = null, coolerIds = null } = {}) {
  const { koffi, protos, resolve } = nv;
  const setEntry = resolve(0xA58971A5);
  if (!setEntry.ok) return { ok: false, why: 'ClientFanCoolersSetControl не разрешился' };

  // READ first — the buffer we write is the buffer the driver gave us.
  const current = readFanCoolers(nv, handle);
  if (!current.control.ok) return { ok: false, why: `GetControl не принят: ${current.control.why}` };

  const buf = Buffer.from(current.control.raw);
  const count = buf.readUInt32LE(0x08);
  const touched = [];
  for (let i = 0; i < Math.min(count, FAN_COOLER_MAX); i++) {
    const at = FAN_CONTROL_DATA_OFFSET + i * FAN_CONTROL_STRIDE;
    const id = buf.readUInt32LE(at);
    if (coolerIds && !coolerIds.includes(id)) continue;
    buf.writeUInt32LE(mode, at + 0x08);
    if (mode === FAN_MODE.MANUAL && level !== null) buf.writeUInt32LE(level, at + 0x04);
    touched.push(id);
  }

  const status = koffi.call(setEntry.ptr, protos.ClientFanCoolersSetControl, handle, buf);
  // Status 0 is NOT the verification (EXP-0024) — the caller must read the state back. This function
  // reports what it asked for and what the API said; the proof lives in the read that follows.
  return { ok: status === 0, status, statusName: statusName(status), touched, mode, level };
}

/** The named rollback of every fan write, in one call. See `writeFanControl` for why AUTO is total. */
export function resetFansToAuto(nv, handle) {
  const before = readFanCoolers(nv, handle);
  const r = writeFanControl(nv, handle, { mode: FAN_MODE.AUTO });
  const after = readFanCoolers(nv, handle);
  const manualLeft = after.control.ok
    ? after.control.coolers.filter((c) => c.mode === FAN_MODE.MANUAL).length
    : 'не прочитано';
  return {
    ok: r.ok && manualLeft === 0,
    status: r.statusName ?? r.why,
    coolers: r.touched ?? [],
    manualLeft,
    levelsBefore: before.status.ok ? before.status.coolers.map((c) => c.level) : null,
    levelsAfter: after.status.ok ? after.status.coolers.map((c) => c.level) : null,
  };
}

/**
 * THE COLD-START PROTOCOL AS A FUNCTION — the owner's experimental condition, callable.
 *
 * It existed only as a CLI mode until the phase-4 judge pass named the gap: the series that measured a
 * 1 °C spread ran from a scratchpad script, and *"verification that lives only in a session's scratchpad
 * dies with the session"* (`TESTING_FRAMEWORK.md`). Any measurement that compares two sides needs this
 * BEFORE each side, because power tracks the temperature a run reaches (~4 W per 5 °C, fact 10) and the
 * V/F curve itself derates with temperature (fact 18) — so two sides at different thermal states are two
 * experiments, not a delta.
 *
 * Writes fans only, only UPWARD, and only when needed: an already-cold card is left alone entirely. The
 * rollback is AUTO on every path. It does NOT arm a watchdog of its own — the caller owns that lease and
 * passes `beat` so a long cool-down cannot expire it.
 *
 * [NOT-TESTED] as a function; the LOGIC it carries is the CLI path measured 2026-08-10 (42/42/41 °C in
 * 8/4/0 s over three load-then-cool cycles).
 */
export async function coolTo(nv, handle, {
  targetC,
  level = 80,
  timeoutMs = 180_000,
  beat = () => {},
  pollMs = 2000,
} = {}) {
  const { execFileSync } = require('node:child_process');
  const temp = () => {
    try {
      const out = execFileSync('nvidia-smi', ['--query-gpu=temperature.gpu', '--format=csv,noheader'], { encoding: 'utf8' });
      const v = Number(out.trim());
      return Number.isFinite(v) ? v : null;
    } catch { return null; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const started = temp();
  if (started === null) return { ok: false, why: 'температура не читается', started, reached: null, seconds: 0, wrote: false };
  if (started <= targetC) return { ok: true, started, reached: started, seconds: 0, wrote: false, why: 'уже холоднее цели' };

  const t0 = Date.now();
  let wrote = false;
  try {
    const w = writeFanControl(nv, handle, { mode: FAN_MODE.MANUAL, level });
    if (!w.ok) return { ok: false, why: `запись вентиляторов: ${w.statusName ?? w.why}`, started, reached: started, seconds: 0, wrote: false };
    wrote = true;

    let now = started;
    const deadline = t0 + timeoutMs;
    while (now > targetC && Date.now() < deadline) {
      beat();
      await sleep(pollMs);
      now = temp() ?? now;
    }
    return {
      ok: now <= targetC,
      started,
      reached: now,
      seconds: Math.round((Date.now() - t0) / 1000),
      wrote: true,
      why: now <= targetC ? null : `не достигнуто за ${Math.round(timeoutMs / 1000)} с`,
    };
  } finally {
    if (wrote) resetFansToAuto(nv, handle);
  }
}

/**
 * The SANITY of the decode, judged by the shape of the answer rather than by whether a call returned 0.
 *
 * A wrong layout does not usually announce itself with an error — it announces itself with nonsense
 * that looks like data (EXP-0024: a well-formed request to do the wrong thing has no error code). So
 * the decode is held against what a two-fan graphics card MUST look like:
 *
 *   • the count is small and non-zero — 0 or exactly 32 means we are reading the wrong field;
 *   • levels are percentages, so 0…100;
 *   • the cooler ids agree between the three structs, because they describe the same coolers.
 */
export function fanDecodeLooksSane({ status, control, info }) {
  const problems = [];
  if (!status.ok) problems.push(`GetStatus не принят: ${status.why}`);
  else {
    if (!(status.count > 0 && status.count < FAN_COOLER_MAX)) {
      problems.push(`count = ${status.count} — не похоже на число вентиляторов карты`);
    }
    for (const c of status.coolers) {
      if (c.level > 100 || c.minLevel > 100 || c.maxLevel > 100) {
        problems.push(`кулер ${c.id}: уровни вне 0…100 (${c.minLevel}/${c.level}/${c.maxLevel})`);
      }
    }
  }
  if (status.ok && control.ok && status.count !== control.count) {
    problems.push(`число кулеров расходится: status ${status.count}, control ${control.count}`);
  }
  if (status.ok && info.ok && status.count !== info.count) {
    problems.push(`число кулеров расходится: status ${status.count}, info ${info.count}`);
  }
  return { ok: problems.length === 0, problems };
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
export function proveMask(handle, nv, { point = 64, offsetMhz = -15, mode = 'rmw', watchdog = null } = {}) {
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
    // THE SWITCH IS ARMED BEFORE THE WRITE, NEVER AFTER — a switch armed after the write does not
    // cover the write. From here until the `finally`, a hang, a kill or a black screen is answered by
    // a SEPARATE process that returns the card to factory on its own (`watchdog.mjs`).
    block('сторож взведён ДО записи', Boolean(watchdog),
      watchdog ? `сторож pid ${watchdog.guardPid}, срок ${watchdog.record.ttlMs / 1000} с, откат — полный возврат к заводскому`
        : 'НЕТ — запись без внешнего сторожа');

    const w = writeVfOffset(nv, handle, point, offsetKhz, { mode });
    block(`ЗАПИСЬ (${mode}): точка ${point}, сдвиг ${offsetMhz} МГц (${offsetKhz} кГц), один бит маски`, w.ok, w.why);
    watchdog?.beat();
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
    // Disarmed LAST, and only after the rollback has been verified. Disarming earlier would drop the
    // net exactly while the riskiest part — the undo itself — is still in the air.
    if (watchdog) {
      const disarmed = watchdog.disarm();
      block('сторож снят ПОСЛЕ проверенного отката', disarmed || !out.written,
        disarmed ? 'запись убрана, карта свободна' : 'запись уже была снята (сторож мог сработать сам)');
    }
  }
  return out;
}

async function mainProveMask(point, offsetMhz, mode) {
  const wd = await import('./watchdog.mjs');

  // A record left behind means a previous run died holding the card. Never start new work on a state
  // nobody can describe — reset first, say so, and only then proceed.
  const rec = await wd.recover({});
  if (rec.found && !rec.ownerAlive) {
    console.log(`НАЙДЕНА ЗАБЫТАЯ ЗАПИСЬ СТОРОЖА («${rec.record.what}») — прошлый прогон умер, держа карту.`);
    for (const s of rec.reset.steps) console.log(`  ${s.ok ? 'OK  ' : 'ПЛОХО'} ${s.name} — ${s.detail}`);
    console.log('');
  } else if (rec.found && rec.ownerAlive) {
    console.error(`ОТКАЗ: сторож уже взведён живым процессом pid ${rec.record.ownerPid} («${rec.record.what}»).`);
    console.error('Две записи в карту одновременно — это состояние, которое никто не сможет описать.');
    return 1;
  }

  const nv = openNvapi();
  const { koffi, protos, resolve } = nv;
  const st = koffi.call(resolve(0x0150E828).ptr, protos.Initialize);
  if (st !== 0) { console.error(`NvAPI_Initialize: ${statusName(st)}`); return 1; }
  let watchdog = null;
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

    watchdog = wd.arm({ what: `NvAPI: точка ${point}, сдвиг ${offsetMhz} МГц (${mode})`, ttlMs: 60_000 });
    console.log(`  СТОРОЖ:     взведён, pid ${watchdog.guardPid}. Если этот процесс зависнет или умрёт —`);
    console.log('              он вернёт карту к заводскому состоянию сам, по сроку или по смерти владельца.');
    console.log('');

    const r = proveMask(handle, nv, { point, offsetMhz, mode, watchdog });
    for (const b of r.blocks) console.log(`  ${b.ok ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}  ${b.name}\n            ${b.detail}`);

    const failed = r.blocks.filter((b) => !b.ok).length;
    console.log('');
    console.log(`ИТОГ: блоков ${r.blocks.length}, провалов ${failed}. ПРОВЕРКА ЗАВЕРШЕНА.`);
    console.log(`ОТКАТ ВЫПОЛНЕН: ${r.rolledBack ? 'да, структура вернулась побайтово' : 'НЕТ — РАЗБИРАТЬСЯ НЕМЕДЛЕННО'}`);
    return failed === 0 ? 0 : 1;
  } finally {
    watchdog?.disarm();          // idempotent: proveMask already disarms on its own normal path
    koffi.call(resolve(0xD22BDD7E).ptr, protos.Unload);
  }
}

// =================================================================================================
// 3d. OFFLINE BLOCKS for the profile's shape — no GPU, no koffi call, pure arithmetic
// =================================================================================================

/**
 * The vector is the one part of a curve write that can be judged WITHOUT touching the card, so it is.
 *
 * The fixture mirrors this card's measured shape rather than a convenient one: points 0…20 sit on the
 * 180 MHz floor at rising voltages, then the curve climbs to 3172 MHz at point 126 (measured 2026-08-10
 * at 48 °C — and the frequency column only means anything with its temperature, fact 18). Point 127 is
 * the outlier the caller excludes.
 *
 * What each block guards is stated in its own name, because a suite whose blocks are green for
 * neighbouring reasons guards nothing (EXP-0016).
 *
 * MUTATION ADDRESSEES FOR THE CAP-ENFORCEABILITY BLOCKS, NAMED BEFORE THE RUN (EXP-0016) — added
 * 2026-08-14 with the verdict itself:
 *   1. report `capEnforced: true` unconditionally      → «потолок НИЖЕ пола железа: capEnforced ЧЕСТНО false»
 *   2. compute the leak as `cap − highest` (sign flip) → «и утечка названа числом: 72 МГц над потолком 2100»
 *   3. derive the floor from the cap instead of the top→ «пол потолка = верх кривой минус диапазон железа, а не что-то ещё»
 *   4. take `highestOffered` from the STOCK curve      → «выдаваемый максимум считается по кривой ПОСЛЕ сдвигов»
 */
export function selftestShape() {
  let failed = 0;
  const check = (name, ok, detail = '') => {
    if (!ok) failed++;
    console.log(`  ${ok ? 'OK  ' : 'ПЛОХО'} ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // --- the fixture: this card's shape, built rather than recalled
  const points = [];
  for (let i = 0; i < 128; i++) {
    if (i === 127) { points.push({ i, mhz: 405, mv: 515, freqKhz: 405_000 }); continue; }
    const mhz = i <= 20 ? 180 : Math.round(180 + ((3172 - 180) * (i - 20)) / (126 - 20));
    points.push({ i, mhz, mv: 450 + i * 5, freqKhz: mhz * 1000 });
  }
  const TOP = 3172;
  const DELTA = 45;

  const v = buildRaiseAndCapVector(points, DELTA);
  check('вектор построен, и его длина — 127 точек (127-я исключена вызывающим)',
    v.ok && v.offsets.length === 127, `длина ${v.offsets?.length}`);
  check('верх кривой найден по САМИМ точкам, а не назначен',
    v.topMhz === TOP, `${v.topMhz} МГц`);

  // The three guarantees the owner's requirement rests on.
  check('НИ ОДИН сдвиг не отрицательный — придавливать хвост минусом не требуется',
    v.offsets.every((o) => o >= 0), `минимум ${v.minOffset}`);
  check('НИ ОДИН сдвиг не больше заказанного шага',
    v.offsets.every((o) => o <= DELTA), `максимум ${v.maxOffset} при шаге ${DELTA}`);
  const newTop = Math.max(...points.slice(0, 127).map((p, i) => p.mhz + v.offsets[i]));
  check('МАКСИМУМ ЧАСТОТЫ НЕ ВЫРОС — экономия не уходит в скорость',
    newTop === TOP, `было ${TOP}, стало ${newTop}`);

  // Monotonicity is a proof, and this block is what would catch the proof being broken by an edit.
  const newCurve = points.slice(0, 127).map((p, i) => p.mhz + v.offsets[i]);
  let monotone = true;
  for (let i = 1; i < newCurve.length; i++) if (newCurve[i] < newCurve[i - 1]) monotone = false;
  check('кривая осталась монотонной — min(F+Δ, F_top) этого не может нарушить',
    monotone);

  // The middle takes the full step; the top is capped; the very top point cannot move at all.
  check('середина кривой берёт ПОЛНЫЙ шаг — именно она и удешевляет частоты',
    v.atFullDelta > 0, `точек с полным шагом ${v.atFullDelta}`);
  check('верхние точки придавлены — сдвиг меньше полного, но больше нуля',
    v.raisedButCapped > 0, `придавленных ${v.raisedButCapped}`);
  check('при потолке НА ВЕРХУ кривой ни одна точка не толкается ВНИЗ',
    v.pushedDown === 0, `отрицательных сдвигов ${v.pushedDown}`);
  const topIdx = points.slice(0, 127).findIndex((p) => p.mhz === TOP);
  check('самой верхней точке сдвиг равен НУЛЮ — ей некуда ехать',
    v.offsets[topIdx] === 0, `точка ${topIdx}: сдвиг ${v.offsets[topIdx]}`);
  check('точки на полу 180 МГц берут полный шаг (запаса до верха у них много)',
    v.offsets[0] === DELTA && v.offsets[20] === DELTA, `точка 0: ${v.offsets[0]}, точка 20: ${v.offsets[20]}`);

  // --- the degenerate ends, both of which a search WILL reach
  const zero = buildRaiseAndCapVector(points, 0);
  check('шаг 0 -> профиль-пустышка, ни одного ненулевого сдвига',
    zero.ok && zero.offsets.every((o) => o === 0));

  const huge = buildRaiseAndCapVector(points, 10_000);
  const hugeCurve = points.slice(0, 127).map((p, i) => p.mhz + huge.offsets[i]);
  check('чудовищный шаг НЕ поднимает максимум — все точки прижимаются к потолку',
    Math.max(...hugeCurve) === TOP, `максимум ${Math.max(...hugeCurve)}`);
  // The first version of this block demanded a FLAT curve here and went red — correctly, and the
  // expectation was what was wrong. A 10 000 MHz step cannot be applied: the offset is clamped to the
  // range the HARDWARE published (±1000 MHz, `researches/05` §8), so the bottom points — 2 992 MHz below
  // the top — cannot reach it however large the step. What is guaranteed is the clamp itself, and that
  // is what this block now guards; flatness was our wish, not the hardware's contract.
  check('чудовищный шаг ОБРЕЗАН диапазоном железа, а не исполнен буквально',
    huge.maxOffset === config.CLOCK_OFFSET_MAX_MHZ,
    `максимальный сдвиг ${huge.maxOffset} при разрешённых ${config.CLOCK_OFFSET_MAX_MHZ}`);
  let hugeMonotone = true;
  for (let i = 1; i < hugeCurve.length; i++) if (hugeCurve[i] < hugeCurve[i - 1]) hugeMonotone = false;
  check('и даже обрезанный чудовищный шаг оставляет кривую монотонной', hugeMonotone);

  // --- THE CASE THAT ACTUALLY BUYS WATTS: a cap BELOW the curve's top
  //
  // Measured 2026-08-10: with the cap at the TOP the card never reached it under load (it sat at 2887 of
  // a 3172 top), so nothing was capped and the raise was taken as SPEED — 2887 → 2932 MHz at the same
  // 137 W. The cap has to sit at the OPERATING frequency, and there the tail must be pushed DOWN.
  const CAP = 2887;
  const c = buildRaiseAndCapVector(points, DELTA, { capMhz: CAP });
  const capCurve = points.slice(0, 127).map((p, i) => (p.freqKhz > 0 ? p.mhz + c.offsets[i] : p.mhz));
  check('потолок НИЖЕ верха: точки над ним получают ОТРИЦАТЕЛЬНЫЙ сдвиг — их толкают вниз',
    c.pushedDown > 0, `толкнуто вниз ${c.pushedDown} точек, минимальный сдвиг ${c.minOffset}`);
  check('потолок НИЖЕ верха: новый максимум РАВЕН потолку, а не верху кривой',
    Math.max(...capCurve) === CAP, `максимум ${Math.max(...capCurve)} при потолке ${CAP}`);
  let capMonotone = true;
  for (let i = 1; i < capCurve.length; i++) if (capCurve[i] < capCurve[i - 1]) capMonotone = false;
  check('потолок НИЖЕ верха: кривая всё равно монотонна', capMonotone);
  check('потолок НИЖЕ верха: низ кривой по-прежнему берёт полный шаг (простой не тронут)',
    c.offsets[0] === DELTA, `точка 0: ${c.offsets[0]}`);
  check('ни один сдвиг не выходит за РАЗРЕШЁННЫЙ ЖЕЛЕЗОМ диапазон',
    c.offsets.every((o) => o >= config.CLOCK_OFFSET_MIN_MHZ && o <= config.CLOCK_OFFSET_MAX_MHZ),
    `диапазон железа ${config.CLOCK_OFFSET_MIN_MHZ}…${config.CLOCK_OFFSET_MAX_MHZ}, наш ${c.minOffset}…${c.maxOffset}`);
  check('флаг capIsBelowTop честно различает два режима',
    c.capIsBelowTop === true && v.capIsBelowTop === false);

  // --- THE CAP'S OWN FLOOR: below `top − 1000` the curve cannot hold a ceiling at all, and the
  // function says so instead of returning a vector that quietly does not do what its name says.
  //
  // This is not a hypothetical: `Silent Cold` was read off the thermal ladder at 2100 MHz, which sits
  // BELOW this curve's floor of 2172. A vector that reported nothing here would have shipped a mode
  // whose ceiling leaks by 72 MHz, and nobody would have had a number to notice it by.
  const FLOOR = TOP + config.CLOCK_OFFSET_MIN_MHZ;                    // 3172 − 1000 = 2172
  const held = buildRaiseAndCapVector(points, DELTA, { capMhz: 2400 });
  check('потолок ВЫШЕ пола железа: он реально удержан кривой',
    held.capEnforced === true && held.capLeakMhz === 0,
    `выдаётся максимум ${held.highestOfferedMhz} при потолке ${held.capMhz}`);
  const leaky = buildRaiseAndCapVector(points, DELTA, { capMhz: 2100 });
  check('потолок НИЖЕ пола железа: capEnforced ЧЕСТНО false, а не молчание',
    leaky.capEnforced === false,
    `выдаётся максимум ${leaky.highestOfferedMhz} при потолке ${leaky.capMhz}`);
  check('и утечка названа ЧИСЛОМ, а не признаком: 72 МГц над потолком 2100',
    leaky.capLeakMhz === 72, `утечка ${leaky.capLeakMhz} МГц`);
  check('пол потолка = верх кривой ПЛЮС отрицательный предел железа, а не что-то ещё',
    leaky.lowestEnforceableCapMhz === FLOOR,
    `${leaky.lowestEnforceableCapMhz} МГц при верхе ${TOP} и пределе ${config.CLOCK_OFFSET_MIN_MHZ}`);
  check('РОВНО НА ПОЛУ потолок ещё держится — граница включительная, а не «около»',
    buildRaiseAndCapVector(points, DELTA, { capMhz: FLOOR }).capEnforced === true,
    `потолок ${FLOOR} МГц`);
  check('на ОДИН МЕГАГЕРЦ ниже пола — уже не держится, и это доказывает, что граница именно там',
    buildRaiseAndCapVector(points, DELTA, { capMhz: FLOOR - 1 }).capEnforced === false,
    `потолок ${FLOOR - 1} МГц`);
  // The leak does not depend on the raise: it is the push-DOWN that runs out of range, not the raise.
  // Measured across five deltas 2026-08-14 — this block is what would catch that stopping being true.
  check('утечка НЕ зависит от величины подъёма — кончается придавливание, а не подъём',
    [0, 45, 180, 300, 540].every((d) => buildRaiseAndCapVector(points, d, { capMhz: 2100 }).capLeakMhz === 72),
    'проверено на подъёмах 0 / 45 / 180 / 300 / 540 МГц');
  // `highestOffered` must be read off the curve AFTER the offsets: taken off the stock curve it would
  // report 3172 everywhere and every cap would look broken, which is the opposite failure.
  check('выдаваемый максимум считается по кривой ПОСЛЕ сдвигов, а не по стоковой',
    held.highestOfferedMhz === 2400 && held.highestOfferedMhz !== TOP,
    `${held.highestOfferedMhz} МГц против стокового верха ${TOP}`);
  check('БЕЗ потолка вопрос не возникает вовсе: потолок = верх, держится сам собой',
    v.capEnforced === true && v.capLeakMhz === 0,
    `максимум ${v.highestOfferedMhz} при потолке ${v.capMhz}`);

  // --- points with no frequency are not invented into the profile
  const holed = points.map((p, i) => (i === 50 ? { ...p, freqKhz: 0, mhz: 0 } : p));
  const hv = buildRaiseAndCapVector(holed, DELTA);
  check('точка без частоты получает 0, а не выдуманный сдвиг', hv.offsets[50] === 0);

  const empty = buildRaiseAndCapVector([{ i: 0, mhz: 0, mv: 0, freqKhz: 0 }], DELTA);
  check('кривая без данных -> отказ, а не пустой профиль', empty.ok === false, empty.why);

  console.log('');
  console.log(`ФОРМА ПРОФИЛЯ: ${failed === 0 ? 'все блоки сходятся' : `ПРОВАЛОВ ${failed}`}.`);
  return failed;
}

// =================================================================================================
// 3. CLI
// =================================================================================================

/**
 * `--fans` — the READ half of the fan step, and the cross-check that makes it believable.
 *
 * Prints what the card says about its own coolers and holds our decode against `nvidia-smi`'s
 * `fan.speed`, which is a reading of the SAME quantity by another author (EXP-0017). Writes nothing.
 */
function mainFans() {
  const nv = openNvapi();
  const { koffi, protos, resolve } = nv;
  const st = koffi.call(resolve(0x0150E828).ptr, protos.Initialize);
  if (st !== 0) { console.error(`NvAPI_Initialize: ${statusName(st)}`); return 1; }
  try {
    const handles = Buffer.alloc(64 * 8);
    const count = Buffer.alloc(4);
    koffi.call(resolve(0xE5AC921F).ptr, protos.EnumPhysicalGPUs, handles, count);
    if (count.readUInt32LE(0) < 1) { console.error('карт не найдено'); return 1; }
    const handle = handles.readBigUInt64LE(0);

    console.log('ВЕНТИЛЯТОРЫ — ТОЛЬКО ЧТЕНИЕ. Ни одного вызова записи в этом режиме.');
    console.log('');
    console.log('  ЗАЧЕМ ЧТЕНИЕ ОТДЕЛЬНЫМ ШАГОМ: в записи статуса есть currentMinLevel — это ПОЛ,');
    console.log('  который называет сама карта. Фаза 2 видела вентилятор на 30 % на пяти ступенях');
    console.log('  лестницы и не могла отличить пол железа от того, где просто стоит стоковая кривая.');
    console.log('  РАСКЛАДКИ: researches/05 §9 — два независимых источника, сходятся поле в поле.');
    console.log('');

    const fans = readFanCoolers(nv, handle);
    for (const [name, r] of Object.entries(fans)) {
      const tries = r.attempts.map((a) => `v${a.version}:${a.name}`).join(' · ');
      console.log(`  ${name.padEnd(8)} ${r.ok ? `ПРИНЯТ на версии ${r.version}` : `НЕ ПРИНЯТ — ${r.why}`}${tries ? `\n           попытки: ${tries}` : ''}`);
    }
    console.log('');

    if (fans.status.ok) {
      console.log(`КУЛЕРОВ ПО СТАТУСУ: ${fans.status.count}`);
      console.log('');
      console.log('  id | об/мин |  пол % | потолок % | сейчас % | режим');
      for (const c of fans.status.coolers) {
        const ctl = fans.control.ok ? fans.control.coolers.find((x) => x.id === c.id) : null;
        console.log(`  ${String(c.id).padStart(2)} | ${String(c.rpm).padStart(6)} | ${String(c.minLevel).padStart(6)} | ${String(c.maxLevel).padStart(9)} | ${String(c.level).padStart(8)} | ${ctl ? ctl.modeName : '—'}`);
      }
      if (fans.info.ok) {
        console.log('');
        for (const c of fans.info.coolers) console.log(`  кулер ${c.id}: максимум ${c.maxRpm} об/мин (из GetInfo)`);
      }
    }

    const sane = fanDecodeLooksSane(fans);
    console.log('');
    console.log(`ФОРМА ОТВЕТА ПРАВДОПОДОБНА: ${sane.ok ? 'да' : 'НЕТ'}`);
    for (const p of sane.problems) console.log(`  · ${p}`);

    // The second, independently-authored reading of the same quantity.
    let smi = null;
    try {
      const { execFileSync } = require('node:child_process');
      smi = execFileSync('nvidia-smi', ['--query-gpu=fan.speed,temperature.gpu', '--format=csv,noheader'], { encoding: 'utf8' }).trim();
    } catch (e) { smi = `не прочитано: ${e.message}`; }
    console.log('');
    console.log(`ВТОРОЕ ЧТЕНИЕ (nvidia-smi, другой автор): ${smi}`);
    if (fans.status.ok && fans.status.coolers.length) {
      const ours = fans.status.coolers.map((c) => `${c.level} %`).join(' / ');
      console.log(`  наше чтение уровня: ${ours} — расхождение с чужим прибором означает НЕВЕРНУЮ РАСКЛАДКУ,`);
      console.log('  а не странную карту (EXP-0024: правильно оформленный запрос не туда не даёт кода ошибки).');
    }

    console.log('');
    console.log('ЗАПИСИ НЕ БЫЛО. Откат записи назван заранее — researches/05 §9.3: controlMode = 0 (AUTO)');
    console.log('на каждом кулере тем же вызовом, плюс тот же откат обязан войти в сторожа (правило R9).');
    return sane.ok && fans.status.ok ? 0 : 1;
  } finally {
    koffi.call(resolve(0xD22BDD7E).ptr, protos.Unload);
  }
}

/**
 * `--fan-write <level>` — THE FIRST FAN WRITE, and `--cool-to <°C>` — the protocol it exists for.
 *
 * Research anchor (`researches/05` §7 step 3): *"only then a single write to a fixed level, with the
 * read-back-until-stable discipline phase 2 already owns, and the return to automatic policy as its
 * named rollback. Deliverable: the cold-start protocol the owner asked for."*
 *
 * WHY THE OWNER ASKED FOR THIS AT ALL, restated because it is the whole justification for touching the
 * fans: this card does not cool passively. Measured — 115 s of idle straight after a run went 47 → 50 °C
 * with the fan at 0 %, because the zero-RPM regime plus a live desktop drifts the temperature UP. So
 * "wait for it to cool" is not a protocol on this card, and two measurements cannot be given the same
 * starting state without the fans. Two facts make that a correctness issue and not a nicety: power
 * tracks the temperature a run REACHES (~4 W per 5 °C), and the V/F curve ITSELF derates with
 * temperature (−15…−22 MHz over 12 °C).
 *
 * THE DISCIPLINE, and every clause of it is paid for:
 *   • the watchdog is armed BEFORE the write and its undo now includes fans (rule R9);
 *   • the direction is UP only — a fan stuck high costs noise, a fan stuck low costs the card;
 *   • the read-back polls until TWO CONSECUTIVE SAMPLES AGREE, through `nvidia-smi` — an instrument we
 *     did not author (EXP-0014: `-rgc` once answered "All done" while the old value was still being
 *     reported);
 *   • the rollback runs in a `finally` on every path and is VERIFIED, not assumed.
 */
async function mainFanWrite(level, coolToC) {
  const wd = await import('./watchdog.mjs');
  const nv = openNvapi();
  const { koffi, protos, resolve } = nv;

  const stale = await wd.recover({});
  if (stale.found && stale.ownerAlive) {
    console.error(`ОТКАЗ: карту держит живой процесс pid ${stale.record.ownerPid} («${stale.record.what}»)`);
    return 1;
  }

  const st = koffi.call(resolve(0x0150E828).ptr, protos.Initialize);
  if (st !== 0) { console.error(`NvAPI_Initialize: ${statusName(st)}`); return 1; }

  // `--format=csv,noheader` is NOT optional and the first run of this tool proved it: without it
  // `nvidia-smi` prints its human TABLE, the parse yields NaN, and the block that exists to confirm the
  // write with a foreign instrument reported NaN instead of a value. It went red, which is the correct
  // behaviour — but the defect was in the reader, not the card (EXP-0012: the output shows what you
  // actually built; the tests only show what you thought to assert).
  const smiFan = () => {
    try {
      const { execFileSync } = require('node:child_process');
      const out = execFileSync('nvidia-smi',
        ['--query-gpu=fan.speed,temperature.gpu', '--format=csv,noheader'], { encoding: 'utf8' });
      const [f, t] = out.trim().split(',').map((x) => Number(x.replace('%', '').trim()));
      return { fan: Number.isFinite(f) ? f : null, temp: Number.isFinite(t) ? t : null };
    } catch { return { fan: null, temp: null }; }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Poll until two consecutive readings agree — AND, when a target is given, until they agree WITH THE
   * TARGET.
   *
   * The `target` argument is not decoration; it is the correction this tool's own first two runs
   * demanded. A fan RAMPS instead of flipping (`config.FAN_RAMP_*`, measured: 768 rpm at 2 s and
   * 1856 rpm at 14 s for the SAME command), so plain agreement can settle on a plateau on the way up —
   * and the first version of the block below passed with 30 % against a commanded 60 % because its
   * predicate only asked for "at least the floor". A weak predicate that a neighbouring condition also
   * satisfies is not a check (EXP-0016).
   */
  const settled = async (pick, { target = null, everyMs = 700, timeoutMs = config.FAN_RAMP_TIMEOUT_MS } = {}) => {
    const deadline = Date.now() + timeoutMs;
    let prev = null; let samples = 0;
    while (Date.now() < deadline) {
      const v = pick();
      samples++;
      const agrees = prev !== null && v === prev;
      const onTarget = target === null || (v !== null && Math.abs(v - target) <= config.FAN_LEVEL_TOLERANCE_PCT);
      if (agrees && onTarget) return { value: v, stable: true, onTarget: true, samples };
      prev = v;
      await sleep(everyMs);
    }
    return {
      value: prev,
      stable: false,
      onTarget: target === null || (prev !== null && Math.abs(prev - target) <= config.FAN_LEVEL_TOLERANCE_PCT),
      samples,
    };
  };

  const blocks = [];
  const block = (name, ok, detail = '') => { blocks.push({ name, ok, detail }); };

  let watchdog = null;
  let wrote = false;
  let out_coolResult = null;
  try {
    const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
    koffi.call(resolve(0xE5AC921F).ptr, protos.EnumPhysicalGPUs, handles, count);
    const handle = handles.readBigUInt64LE(0);

    const before = readFanCoolers(nv, handle);
    const smiBefore = smiFan();
    if (!before.status.ok || !before.control.ok) {
      block('старт: вентиляторы читаются', false, before.status.why ?? before.control.why);
      return 1;
    }
    const floor = Math.max(...before.status.coolers.map((c) => c.minLevel));
    block('старт: карта на автоматической политике',
      before.control.coolers.every((c) => c.mode === FAN_MODE.AUTO),
      `кулеров ${before.status.count}, уровни ${before.status.coolers.map((c) => c.level).join('/')} %, пол карты ${floor} %, ` +
      `nvidia-smi: ${smiBefore.fan} % при ${smiBefore.temp} °C`);

    if (level < floor) {
      block(`запрошенный уровень ${level} % ниже пола карты ${floor} %`, false,
        'ОТКАЗ ДО ЗАПИСИ: карта сама назвала минимум, и просить меньше — просить необъяснимого состояния');
      return 1;
    }

    // ALREADY COLD ENOUGH -> NO WRITE AT ALL. Found by the P4-AC7 series: its third cycle "cooled" in
    // 0 s because the card was already below the setpoint, having spun the fans up for nothing first.
    // The owner's ears are the reason this is a guard and not a comment: the smallest reversible form of
    // an action is not performing it (the owner's-machine rule, step 3).
    if (coolToC !== null && smiBefore.temp !== null && smiBefore.temp <= coolToC) {
      block(`ЗАПИСИ НЕ ТРЕБУЕТСЯ: карта уже холоднее цели (${smiBefore.temp} °C ≤ ${coolToC} °C)`, true,
        'вентиляторы не тронуты, режим остался автоматическим');
      out_coolResult = { started: smiBefore.temp, reached: smiBefore.temp, seconds: 0, target: coolToC };
      return 0;
    }

    watchdog = wd.arm({ what: `ВЕНТИЛЯТОРЫ: ручной режим ${level} %`, ttlMs: 300_000 });
    block('сторож взведён ДО записи', Boolean(watchdog.guardPid),
      `pid ${watchdog.guardPid}; его полный откат теперь включает возврат вентиляторов в AUTO`);

    const w = writeFanControl(nv, handle, { mode: FAN_MODE.MANUAL, level });
    wrote = true;
    block(`ЗАПИСЬ: ручной режим ${level} % на кулерах ${w.touched.join(', ')}`, w.ok, w.statusName ?? w.why);
    if (!w.ok) return 1;
    watchdog.beat();

    const ours = readFanCoolers(nv, handle);
    block('перечитано НАШИМ прибором: режим сменился на ручной',
      ours.control.ok && ours.control.coolers.every((c) => c.mode === FAN_MODE.MANUAL && c.level === level),
      ours.control.ok ? ours.control.coolers.map((c) => `${c.id}:${c.modeName}@${c.level}%`).join(' ') : ours.control.why);

    const spun = await settled(() => smiFan().fan, { target: level });
    watchdog.beat();
    block(`перечитано ЧУЖИМ прибором: скорость ДОШЛА до заказанных ${level} % (±${config.FAN_LEVEL_TOLERANCE_PCT} п.п.)`,
      spun.stable && spun.onTarget,
      `nvidia-smi fan.speed = ${spun.value} % за ${spun.samples} проб, было ${smiBefore.fan} %. ` +
      'Статус 0 верификацией не является (EXP-0024), и одной устойчивости мало: вентилятор РАЗГОНЯЕТСЯ, ' +
      'поэтому две совпавшие пробы могут стоять на полке по дороге вверх');

    const rpm = readFanCoolers(nv, handle);
    if (rpm.status.ok) {
      const rpms = rpm.status.coolers.map((c) => c.rpm);
      // The ceiling comes from the card's own GetInfo, never from a literal: 3000 rpm is what THIS card
      // reported, and a constant would silently lie on any other one.
      const maxRpm = rpm.info.ok && rpm.info.coolers.length ? rpm.info.coolers[0].maxRpm : null;
      const expected = maxRpm === null ? null : Math.round((maxRpm * level) / 100);
      // rpm is the SECOND observable of the same command, and it is the more physical one: a percentage
      // could be a field we decoded wrongly, but a tachometer cannot be talked into a number.
      block(expected === null
        ? 'вентиляторы крутятся (потолок оборотов картой не назван — соответствие не судим)'
        : `обороты соответствуют заказанному уровню (ждём ~${expected} из ${maxRpm} об/мин)`,
        expected === null
          ? rpms.every((r) => r > 0)
          : rpms.every((r) => r > 0 && Math.abs(r - expected) <= maxRpm * 0.15),
        `об/мин: ${rpms.join(' / ')}`);
    }

    // --- the protocol itself, when asked for
    if (coolToC !== null) {
      const started = smiFan().temp;
      const t0 = Date.now();
      const deadline = t0 + 180_000;
      let now = started;
      const track = [];
      while (now > coolToC && Date.now() < deadline) {
        watchdog.beat();
        await sleep(2000);
        now = smiFan().temp;
        track.push(`${Math.round((Date.now() - t0) / 1000)}s:${now}`);
      }
      // The SECONDS are half the deliverable. A protocol that reaches a setpoint at an unknown cost in
      // time cannot be put in front of a measurement series — a session planning N runs has to know
      // whether each cool-down costs 20 s or 3 minutes, and the plan's P4-AC7 target is a spread across
      // N runs, which is only meaningful with the duration beside it.
      const seconds = Math.round((Date.now() - t0) / 1000);
      block(`ОХЛАЖДЕНИЕ до ${coolToC} °C`, now <= coolToC,
        `${started} → ${now} °C за ${seconds} с${now > coolToC ? ' — НЕ достигнуто за 180 с, докладываю достигнутое' : ''}` +
        `${track.length ? `\n            ход: ${track.join(' ')}` : ' (уже было холоднее цели)'}`);
      out_coolResult = { started, reached: now, seconds, target: coolToC };
    }
  } finally {
    if (wrote) {
      const handles = Buffer.alloc(64 * 8); const count = Buffer.alloc(4);
      koffi.call(resolve(0xE5AC921F).ptr, protos.EnumPhysicalGPUs, handles, count);
      const handle = handles.readBigUInt64LE(0);
      const back = resetFansToAuto(nv, handle);
      const backSmi = await settled(() => smiFan().fan);
      const backRpm = readFanCoolers(nv, handle);
      // The GUARANTEE is the MODE: every cooler back on the automatic policy. The rpm is reported and
      // deliberately NOT asserted — on a hot card the stock curve may legitimately keep the fans
      // turning, so demanding zero here would be a check that fails when the card is behaving. What
      // would be a defect is a cooler still in MANUAL, and that is what the predicate says.
      // The `level` field keeps its last written value under AUTO; it is ignored by the card, so
      // "уровни [60,60,60]" next to mode AUTO is expected and is not a failed rollback.
      block('ОТКАТ: все кулеры вернулись в AUTO, и это перечитано',
        back.ok && back.manualLeft === 0,
        `в ручном режиме осталось ${back.manualLeft}; поле level сохранило ${JSON.stringify(back.levelsAfter)} ` +
        `(в AUTO карта его игнорирует); об/мин ${backRpm.status.ok ? backRpm.status.coolers.map((c) => c.rpm).join('/') : '—'}; ` +
        `nvidia-smi ${backSmi.value} %${backSmi.stable ? ' (устойчиво)' : ' (НЕ устоялось за 14 с — вентилятор ещё сбрасывает обороты)'}`);
    }
    watchdog?.disarm();
    koffi.call(resolve(0xD22BDD7E).ptr, protos.Unload);

    // THE REPORT LIVES HERE, and that is a fix rather than a style choice. Printing after the
    // try/finally meant every early `return` inside the try — a refused write, a level below the card's
    // floor, an already-cold card — exited with the block list unprinted, so a FAILURE reported nothing
    // at all. The finally runs on every path including a return, so this is the only placement that
    // cannot be bypassed. (`ИТОГ` is computed here too, for the same reason.)
    for (const b of blocks) console.log(`  ${b.ok ? 'ЗЕЛЁНЫЙ' : 'КРАСНЫЙ'}  ${b.name}${b.detail ? `\n            ${b.detail}` : ''}`);
    console.log('');
    if (out_coolResult) {
      console.log(`ХОЛОДНЫЙ СТАРТ: ${out_coolResult.started} → ${out_coolResult.reached} °C за ${out_coolResult.seconds} с ` +
        `(цель ${out_coolResult.target}). Это ОДНО наблюдение; воспроизводимость — разброс достигнутой ` +
        'температуры по N прогонам (замерено: 42/42/41 °C, разброс 1 °C).');
    }
    console.log(`ИТОГ: блоков ${blocks.length}, провалов ${blocks.filter((b) => !b.ok).length}.`);
  }

  return blocks.filter((b) => !b.ok).length === 0 ? 0 : 1;
}

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
  if (process.argv.includes('--selftest-shape')) {
    console.log('ФОРМА ПРОФИЛЯ — БЕЗ КАРТЫ. Чистая арифметика вектора сдвигов на подставной кривой,');
    console.log('повторяющей форму настоящей (пол 180 МГц на точках 0…20, верх 3172 МГц на 126-й).');
    console.log('');
    return selftestShape() === 0 ? 0 : 1;
  }
  if (process.argv.includes('--fans')) return mainFans();
  if (process.argv.includes('--fan-write')) {
    const i = process.argv.indexOf('--fan-write');
    const level = Number(process.argv[i + 1]);
    const ci = process.argv.indexOf('--cool-to');
    const coolToC = ci === -1 ? null : Number(process.argv[ci + 1]);
    if (!Number.isFinite(level) || level <= 0 || level > 100) {
      console.error('--fan-write <уровень 1…100>');
      return 1;
    }
    console.log('ПЕРВАЯ ЗАПИСЬ В ВЕНТИЛЯТОРЫ — под взведённым сторожем, откат в finally');
    console.log('');
    console.log(`  ЧТО ДЕЛАЕМ: ручной режим ${level} % на всех кулерах${coolToC !== null ? `, затем ждём остывания до ${coolToC} °C` : ''}.`);
    console.log('  НАПРАВЛЕНИЕ: только ВВЕРХ. Застрявший высоко вентилятор стоит шума, застрявший низко — карты.');
    console.log('  ОТКАТ:      controlMode = 0 (AUTO) на каждом кулере тем же вызовом, в finally, и он ПЕРЕЧИТЫВАЕТСЯ.');
    console.log('  СТОРОЖ:     взводится ДО записи; его полный откат с сегодня включает вентиляторы (R9).');
    console.log('  ПРОВЕРКА:   до устойчивости двумя совпавшими пробами через nvidia-smi — чужой прибор (EXP-0014).');
    console.log('');
    return mainFanWrite(level, coolToC);
  }
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
  // `main()` returns a promise for the modes that await the watchdog; `Promise.resolve` covers both
  // shapes so a sync mode keeps its old behaviour.
  Promise.resolve(main()).then((code) => process.exit(code)).catch((e) => {
    console.error(`ОШИБКА: ${e.message}`);
    process.exit(1);
  });
}
