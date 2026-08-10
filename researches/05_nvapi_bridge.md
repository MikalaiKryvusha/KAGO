# Research 05 — the NVAPI bridge: reaching voltage, the V/F curve and the fans from Node.js

> **Created:** 2026-08-10 (agent, on the owner's instruction *«давай займёмся инструментарием NVAPI. Я вижу, что без него мы сильно ограничены»*)
> **Parent:** `MASTER_PLAN.md` phase 4 · `plans/01_EPIC_kago_orchestrator.md`
> **Status:** 🟢 recon VERIFIED on this machine — 17 ids of 17 resolve on driver 610.88 (2026-08-10); the curve reads (128 points, voltage grid 5 mV); **the control record's geometry was MEASURED 2026-08-10 15:2x +03:00 and the published layout in §3.4 is WRONG on this card — see §8, which supersedes it**
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

**`ClkVfPointsSetControl`, 0x2420 bytes — ⚠️ THE ENTRY LAYOUT BELOW IS SUPERSEDED BY §8.**
It is kept because it is what the source says and what a future session will find if it re-reads
LACT #936; §8 is what this card actually does.

```
0x00 .. 0x03   version (version_number = 1)
0x04 .. 0x13   mask — ⚠ EXACTLY ONE BIT SET PER CALL. All 128 bits set returns -1.
0x20 + i*0x48  entry i, 72 bytes; the frequency offset lives at the entry's start,     ← WRONG HERE
               signed int32, in kHz  (+50000 = +50 MHz on that point)                  ← see §8
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

## 8. THE CONTROL RECORD, MEASURED — and how a documented API was used as a ruler

**Measured 2026-08-10 on this card, driver 610.88.** This section supersedes the entry layout in §3.4.
Nothing here is inferred from a source; every number below moved under a lever we controlled.

### 8.1 The problem this solves

Following §3.4 literally, the first write aimed at the dword at the start of each 72-byte entry. That
dword turned out to be a **flag, not a frequency**: a `--write-zero` was accepted, the curve did not
change (correct — it was a no-op), and the only non-zero word in the entire 0x2420 structure was
`0x1220 = 1`, which had been there **before** we ever wrote. At that point writing a real offset would
have been guessing at the owner's hardware — the door `PHILOSOPHY.md` forbids.

### 8.2 The method — a documented lever, and subtraction

NVIDIA documents a clock-offset API in **NVML**, and `researches/05` §5.5 records that it and NvAPI's
`SetControl` **operate on the same hardware state**. For a product that is a hazard; for a probe it is
the whole instrument. Apply a KNOWN offset through the documented call, re-read the undocumented
structure, subtract.

The vendor's own header on this machine —
`C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.3\include\nvml.h` — settled which call to use:

- `nvmlDeviceSetGpcClkVfOffset` (what an earlier `STATUS.md` step pointed at) is **`DEPRECATED(13.0)`**.
- The current call is **`nvmlDeviceSetClockOffsets(nvmlDevice_t, nvmlClockOffset_t*)`**, with the
  read-only twin `nvmlDeviceGetClockOffsets`. Struct (header lines 1176–1189), 24 bytes:
  `version · nvmlClockType_t type · nvmlPstates_t pstate · int clockOffsetMHz · int minClockOffsetMHz ·
  int maxClockOffsetMHz`; `version = sizeof | (1 << 24) = 0x01000018`.

### 8.3 The measured layout

| Quantity | Published (§3.4) | **MEASURED here** |
|---|---|---|
| entry stride | 0x48 = 72 B | **0x24 = 36 B** — exactly half |
| frequency-offset field | entry's start, +0x00 | **+0x14 within the entry** |
| unit | kHz | **kHz — confirmed** |
| entry array | implied 0x20 … 0x2420 | **0x20 … 0x1220** (128 × 0x24 = 0x1200) |

**The arithmetic closes on the old mystery.** 0x20 + 128 × 0x24 = **0x1220** — the address of that
stray `1`. It was never a curve field: it is the first dword of whatever follows the entry array.

**Confirmed at two independent magnitudes**, because one magnitude cannot separate a unit from a
coincidence (EXP-0018): −100 MHz moved every field by exactly **−100000**; −37 MHz, a deliberately
non-round value, by exactly **−37000**. Linear, kHz, same stride, same field both times.

**The domain is bounded, by measurement rather than assumption.** The same experiment driven by the
**memory** clock lever moved the card's memory offset (NVML read it back stable at −100 MHz) and
changed **zero bytes** of this structure. So these entries are the **graphics domain alone**, and a
stride mistake cannot reach memory settings.

**What is NOT known, and no code may assume otherwise:** entries **1…127** moved; **entry 0 did not**.
Whether point 0 is inactive or is a point the driver deliberately never shifts is unmeasured.

### 8.4 The allowed offset range — the other unknown this retired

`ClkDomainsGetInfo` (id `0x64B43A6A`) has refused all 30 size/version pairs tried, so "the permitted
offset range is UNKNOWN" had been forcing microscopic first writes by POLICY rather than by permission.
`nvmlDeviceGetClockOffsets` publishes it as a **documented, read-only output**, and on this card at P0:

| Domain | Current offset | **Allowed range** |
|---|---|---|
| GRAPHICS | 0 MHz | **−1000 … +1000 MHz** |
| MEM | 0 MHz | −2000 … +6000 MHz |
| SM | — | `ERROR_INVALID_ARGUMENT` — not a valid domain for this call here |

### 8.5 Safety, as actually executed

Every run walked the owner's-machine rule in order: the vendor header read **before** the first call ·
the rollback (**the same call with `clockOffsetMHz = 0`**) named out loud and placed in a `finally` so
it runs on every path · the **negative** direction chosen deliberately, since a negative offset makes
the card slower at the same voltage and cannot destabilize it · every read polled until **two
consecutive samples agree** (EXP-0014) · and after each of the three runs the full 9 248-byte structure
compared **byte for byte** against its pre-write snapshot — identical each time.

A second, independently-authored witness rode along: `ClkVfPointsGetStatus` showed the curve's top move
3172.0 → 3075.0 MHz under the −100 MHz offset (−97, the card snapping to its own 7/8 MHz clock grid) and
return afterwards.

### 8.6 Commands

```
npm run nvml                                    read-only: driver, card, offset + ALLOWED RANGE per domain
npm run nvml -- --find-offset-field -100        the experiment; add --mem for the memory lever
npm run nvml -- --verify-decode                 the guard: one buffer, both layouts, published must go red
```

**`nvml.mjs` is an INSTRUMENT, never a backend.** It is not called by `profile-manager.mjs` and never
applies a profile — rule R1 stands, and the shipping write path remains NvAPI. §5.5's warning about the
two APIs clobbering each other is the reason the quarantine is explicit rather than assumed.

---

## Sources

- [nvfancontrol — Windows NVAPI fan control (Rust)](https://github.com/foucault/nvfancontrol/blob/master/src/nvctrl/os/windows.rs) — fan ids, init flow
- [LACT issue #936 — per-point V/F curve read/write via undocumented NvAPI, tested on RTX 5090 Blackwell](https://github.com/ilya-zlobintsev/LACT/issues/936) — curve ids, struct layouts, offsets, failure modes
- [Koffi — C FFI for Node.js](https://koffi.dev/) · [function pointers](https://koffi.dev/pointers) — `koffi.proto` / `koffi.call` / `koffi.decode`
- [NVAPI Reference Documentation](https://docs.nvidia.com/gameworks/content/gameworkslibrary/coresdk/nvapi/group__gpuclock.html) — the documented half (Initialize, EnumPhysicalGPUs, status codes)
- **`nvml.h` from CUDA Toolkit 13.3, ON THIS MACHINE** (`C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.3\include\nvml.h`) — the authority for §8: `nvmlClockOffset_v1_t` (lines 1176–1189), `NVML_STRUCT_VERSION` (139), `nvmlClockType_t` (1107), `nvmlPstates_t` (1153), `nvmlReturn_t` (1296–1327), `nvmlDeviceGetClockOffsets` / `nvmlDeviceSetClockOffsets` (6306, 6328), the `DEPRECATED(13.0)` marking of `nvmlDeviceSetGpcClkVfOffset` (9280). A local header beats a web page: it is the version this driver ships against
- Measured on this machine 2026-08-10: `nvidia-smi --help` write options (no fan control) · the idle warm-up 47 → 50 °C at fan 0 %
