# Research 05 — the NVAPI bridge: reaching voltage, the V/F curve and the fans from Node.js

> **Created:** 2026-08-10 (agent, on the owner's instruction *«давай займёмся инструментарием NVAPI. Я вижу, что без него мы сильно ограничены»*)
> **Parent:** `MASTER_PLAN.md` phase 4 · `plans/01_EPIC_kago_orchestrator.md`
> **Status:** 🟡 recon complete, NOTHING VERIFIED ON THIS MACHINE YET — every id below is somebody else's observation until our own probe confirms it
> **Outbound:** the operational plan for phase 4 · `config.VOLTAGE_GRID_STEP_IS_MEASURED` (this phase's first duty) · the measurement protocol of phase 2 §4.4–§4.5, which cannot control its initial conditions without fan control

---

## 1. Why the bridge is not optional — three walls hit on the same day

Each of these was hit by RUNNING something, not by reading about it:

1. **No voltage, at all.** `nvidia-smi` has no voltage field to read and no flag to write one
   (`researches/03` §2). Everything phase 2 achieved is a CLOCK CLAMP, which walks the card down its
   own factory V/F curve — the card still takes the stock voltage for whatever clock it lands on. Real
   undervolting is *the same clock at less voltage*, and it is unreachable from this backend by
   construction, not by effort.
2. **No fan control.** Verified 2026-08-10 by reading the vendor's own help text on this machine:
   `nvidia-smi --help` lists exactly these writes — ECC config, ECC error reset, compute mode, driver
   model, GOM, `--gpu-reset`, `--lock-gpu-clocks`, `--reset-gpu-clocks`, `--lock-memory-clocks`. There
   is no fan option; `fan.speed` exists as a READ field only.
3. **And the third wall is what makes the second one urgent.** The owner asked for the experimental
   protocol every physicist would ask for — *spin the fans to 90 % and cool the card between runs, so
   each measurement starts from the same state*. It cannot be done here, and worse: **this card does
   not cool passively at idle.** Measured 2026-08-10 over 115 s of idle immediately after a run: 47 →
   48 → 49 → **50 °C**, fan **0 %** the whole time, 32–43 W. The card sits in its zero-RPM regime while
   the desktop keeps feeding it, so the temperature DRIFTS UP toward the fan-start threshold. There is
   no waiting our way to a cold start. Phase 2's §4.4 finding — power tracks the temperature a run
   reaches, ~4 W per 5 °C — therefore has no clean answer until the fans obey us.

**Consequence, stated once so no future session re-argues it:** phases 4 and 5 are not "the ambitious
part". Phase 4 is what makes phase 5 possible AND what makes phase 2's own numbers reproducible.

## 2. The mechanism — how a JS process reaches an undocumented C API

`nvapi64.dll` exports exactly ONE symbol: `nvapi_QueryInterface`. Every function — documented or not —
is obtained by calling it with a 32-bit id and receiving a function pointer.

**Node can do this without a line of C**, which was the open architectural question and is now closed:
[koffi](https://koffi.dev/) declares a function type with `koffi.proto()` and then calls a raw address
with `koffi.call(ptr, type, ...)`, or turns it into a reusable JS function with
`koffi.decode(ptr, type)`. Pointers are BigInt. So the chain is:

```
koffi.load('nvapi64.dll')  →  nvapi_QueryInterface(id) : void*  →  koffi.decode(ptr, proto)  →  call
```

**What this buys architecturally:** no C shim, no compilation step, no binary to ship, and rule R2 of
the internal map is satisfied exactly as written — a second BACKEND behind `profile-manager.mjs`, not a
second writer. `MASTER_PLAN.md` already foresaw one native dependency for this phase; koffi is it, and
it is a library, not the third-party GUI `GOAL.md` forbids.

## 3. The function inventory — ids, and WHERE each one comes from

Provenance matters more than the number here: two of these sources are Windows-native, one is Linux,
and that difference is the biggest risk in section 6.

### 3.1 Lifecycle and enumeration

| Function | Id | Source |
|---|---|---|
| `NvAPI_Initialize` | `0x0150E828` | nvfancontrol (Windows, Rust) |
| `NvAPI_Unload` | `0xD22BDD7E` | same |
| `NvAPI_EnumPhysicalGPUs` | documented | NVAPI SDK — the documented half |

### 3.2 Fans — the half that fixes the experiment protocol

| Function | Id | Purpose |
|---|---|---|
| `NvAPI_GPU_SetCoolerLevels` | `0x891FA0AE` | set fan level + policy (older interface) |
| `NvAPI_GPU_GetCoolerSettings` | `0xDA141340` | current level, policy, min/max |
| `NvAPI_GPU_ClientFanCoolersGetInfo` | `0xFB85B01E` | newer "client" interface |
| `NvAPI_GPU_ClientFanCoolersGetStatus` | `0x35AED5E8` | |
| `NvAPI_GPU_ClientFanCoolersGetControl` | `0x814B209F` | |
| `NvAPI_GPU_ClientFanCoolersSetControl` | `0xA58971A5` | **the write we need for a cold start** |

Source: [nvfancontrol](https://github.com/foucault/nvfancontrol/blob/master/src/nvctrl/os/windows.rs) —
a Rust project doing exactly this on **Windows**, which is our platform. Newer cards are reported to
need the `ClientFanCoolers*` family rather than `SetCoolerLevels`; both are listed so the probe can try
the modern one first and fall back.

### 3.3 The V/F curve — the half that makes undervolting real

| Function | Id | Struct size | Purpose |
|---|---|---|---|
| `ClkVfPointsGetStatus` | `0x21537AD4` | `0x1C28` (7 208 B) | READ all 128 points |
| `ClkVfPointsGetInfo` | `0x507B4B59` | — | which points are active |
| `ClkVfPointsGetControl` | `0x23F1B133` | — | the offsets currently applied |
| `ClkVfPointsSetControl` | `0x0733E009` | `0x2420` (9 248 B) | **WRITE a per-point offset** |
| `ClkDomainsGetInfo` | `0x64B43A6A` | — | the allowed offset RANGE (e.g. ±1000 MHz core) |

Source: [LACT issue #936](https://github.com/ilya-zlobintsev/LACT/issues/936), a working
implementation on an **RTX 5090 (Blackwell, GB202)** — the same architecture family as this card.

### 3.4 The layouts, byte by byte

**Version field convention (all structs):** `version = (version_number << 16) | struct_size`. A wrong
value returns `-9` = `INCOMPATIBLE_STRUCT_VERSION`, which is a clean, recognizable refusal rather than
undefined behaviour — worth relying on as a probe signal.

**`ClkVfPointsGetStatus`, 0x1C28 bytes:**

```
0x00 .. 0x03   version
0x04 .. 0x13   128-bit point mask   (0xFF bytes = all points)
0x14 .. 0x17   numClocks            (observed value: 15)
0x48 + i*0x1C  entry i, 28 bytes:
                 +0x00  frequency, kHz   (uint32)
                 +0x04  voltage,   µV    (uint32)
```

**`ClkVfPointsSetControl`, 0x2420 bytes:**

```
0x00 .. 0x03   version (version_number = 1)
0x04 .. 0x13   mask — ⚠ EXACTLY ONE BIT SET PER CALL. All 128 bits set returns -1.
0x20 + i*0x48  entry i, 72 bytes; the frequency offset lives at the entry's start,
               signed int32, in kHz  (+50000 = +50 MHz on that point)
```

**Read this the right way round:** the write applies a **frequency offset to a point**, not a voltage.
Undervolting is expressed as *this voltage point shall run at a HIGHER frequency* — the same shape MSI
Afterburner's curve editor has. Which means phase 5's search variable and its guardband are both
expressed in the units this API accepts, and `config.VOLTAGE_GRID_STEP_MV` remains what it says it is:
unmeasured until we read the real point spacing.

## 4. What this changes about phase 5's numbers, before phase 5 assumes anything

- **The voltage grid step becomes MEASURABLE the moment `GetStatus` works** — read the 128 points and
  subtract neighbours. `config.VOLTAGE_GRID_STEP_IS_MEASURED = false` is the flag that flips, and the
  owner's rule ("the fine mode's step IS the hardware's own minimum step") gets its number.
- **Two quantities still wear one name** (`config.mjs` warns about this already): the SPACING between
  curve points, and the GRANULARITY of an applied offset. `GetStatus` answers the first;
  `ClkDomainsGetInfo`'s allowed range and the offset field's own resolution answer the second. Do not
  let one stand in for the other.
- **The example curve in the source shows 20…125 mV between printed points** — so the folklore 6.25 mV
  is not confirmed and must not be adopted.

## 5. Safety — this is the most dangerous code this project will ever contain

The owner's-machine rule applies with full force (`AGENT_GUIDE.md`). Concretely, for this phase:

1. **Read-only first, and for a whole step.** `Initialize` → `EnumPhysicalGPUs` → `GetStatus` →
   print 128 points. **No write of any kind until the read is proven** against something independent —
   the clock ladder we already measured (`gpu:info`) and `clocks.gr` under a known lock give two
   cross-checks a wrong parse would fail (EXP-0017: a second, independently-authored reading).
2. **The rollback is an offset of 0 on the same point** — same call, same struct, offset field zeroed.
   It is named here, before the first write exists, as rule R5 requires.
3. **The physical backstop still holds and is worth stating:** these offsets live in volatile driver
   state, so a reboot returns the card to factory. That is the same property phases 2–3 rest on.
4. **One bit per call is not a style rule, it is the API's own constraint** — and it happens to be the
   safest possible shape: one point moves per call, so a bad write has a blast radius of one point.
5. **A known conflict, documented by the source:** NvAPI `SetControl` and NVML's
   `nvmlDeviceSetGpcClkVfOffset` operate on the same hardware state and clobber each other. KAGO must
   own one path; mixing them would produce a state neither tool reports correctly.
6. **Error codes to recognize rather than swallow:** `-9` incompatible struct version (our layout is
   wrong — harmless, retry), `-1` generic failure (e.g. the multi-bit mask). A probe that cannot tell
   these apart will "discover" nonsense.

## 6. The honest unknowns — what this document does NOT establish

- **The V/F ids are Linux evidence.** LACT reached them through `libnvidia-api.so` on driver
  590.48.01; we are on **Windows, `nvapi64.dll`, driver 610.88**. The id space is believed common to
  the driver core across platforms, and the fan ids in §3.2 ARE Windows-native — but "believed" is not
  "observed", and the first probe's job is to settle it. A wrong id typically returns a null pointer
  from `QueryInterface`, which is a safe failure.
- **Driver 610.88 is newer than every source here.** Struct versions change between driver branches;
  `-9` is exactly how that will announce itself.
- **Whether this card's fans accept `ClientFanCoolersSetControl` at all** — some designs refuse
  manual control below a firmware floor, and this card's zero-RPM behaviour suggests firmware opinions
  about low speeds. The 30 % readings phase 2 saw may be a floor the API cannot go under.
- **Nothing here has been run on this machine.** Every table above is somebody else's observation, and
  this document's whole purpose is to be the thing the first probe CHECKS rather than the thing a
  future session believes.

## 7. The first three steps, in order

1. `automation-engine/lib/nvapi.mjs` — load, `Initialize`, `EnumPhysicalGPUs`, and a `QueryInterface`
   resolver that reports for each id whether a pointer came back. **Read-only, no struct writes.**
   Deliverable: a table of which ids resolve on driver 610.88.
2. **Read the curve.** `GetStatus` → 128 points → print frequency (kHz) and voltage (µV), and
   cross-check the frequency column against the measured ladder. Deliverable: the voltage grid step,
   MEASURED, and `VOLTAGE_GRID_STEP_IS_MEASURED = true`.
3. **Fans, read then write.** `ClientFanCoolersGetStatus` first; only then a single write to 90 %, with
   the read-back-until-stable discipline phase 2 already owns, and the return to automatic policy as
   its named rollback. Deliverable: the cold-start protocol the owner asked for — and with it, phase
   2's §4.4/§4.5 numbers become reproducible.

---

## Sources

- [nvfancontrol — Windows NVAPI fan control (Rust)](https://github.com/foucault/nvfancontrol/blob/master/src/nvctrl/os/windows.rs) — fan ids, init flow
- [LACT issue #936 — per-point V/F curve read/write via undocumented NvAPI, tested on RTX 5090 Blackwell](https://github.com/ilya-zlobintsev/LACT/issues/936) — curve ids, struct layouts, offsets, failure modes
- [Koffi — C FFI for Node.js](https://koffi.dev/) · [function pointers](https://koffi.dev/pointers) — `koffi.proto` / `koffi.call` / `koffi.decode`
- [NVAPI Reference Documentation](https://docs.nvidia.com/gameworks/content/gameworkslibrary/coresdk/nvapi/group__gpuclock.html) — the documented half (Initialize, EnumPhysicalGPUs, status codes)
- Measured on this machine 2026-08-10: `nvidia-smi --help` write options (no fan control) · the idle warm-up 47 → 50 °C at fan 0 %
