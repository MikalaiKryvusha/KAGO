# Research 05 — the NVAPI bridge: reaching voltage, the V/F curve and the fans from Node.js

> **Created:** 2026-08-10 (agent, on the owner's instruction *«давай займёмся инструментарием NVAPI. Я вижу, что без него мы сильно ограничены»*)
> **Parent:** `MASTER_PLAN.md` phase 4 · `plans/01_EPIC_kago_orchestrator.md`
> **Status:** 🟢 recon VERIFIED on this machine — 17 ids of 17 resolve on driver 610.88 (2026-08-10); the curve reads (128 points, voltage grid 5 mV); **the control record's geometry was MEASURED 2026-08-10 15:2x +03:00 and the published layout in §3.4 is WRONG on this card — see §8, which supersedes it** · **§9 added 2026-08-10 17:1x — the FAN struct layouts, from two independently-authored sources, NOT yet run on this card**
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
| entry array START | implied 0x20 (right after the header) | **0x44** — the header is 0x44 bytes, not 0x20 |
| entry array | implied 0x20 … 0x2420 | **0x44 … 0x1244** (128 × 0x24) |

**The base is 0x44 and getting it wrong cost two silent no-ops** — see §8.7, which is the run that
measured it. Everything else in this table was already right; the base was the last error, and it is
the one that mattered, because a mis-based write is accepted and inert.

**The arithmetic closes on the old mystery.** Under the measured base, `0x44 + 127 × 0x24` = **0x1220**
— the address of that stray `1`. It was never a field past the array and never a curve value: it is
the **first dword of point 127's entry**, and point 127 is an outlier in every other way too (see the
unknown at the end of this section).

**Confirmed at two independent magnitudes**, because one magnitude cannot separate a unit from a
coincidence (EXP-0018): −100 MHz moved every field by exactly **−100000**; −37 MHz, a deliberately
non-round value, by exactly **−37000**. Linear, kHz, same stride, same field both times.

**The domain is bounded, by measurement rather than assumption.** The same experiment driven by the
**memory** clock lever moved the card's memory offset (NVML read it back stable at −100 MHz) and
changed **zero bytes** of this structure. So these entries are the **graphics domain alone**, and a
stride mistake cannot reach memory settings.

**What is NOT known, and no code may assume otherwise:** the lever moves points **0…126** and leaves
**point 127** alone. Point 127 is the odd one throughout: it carries the only non-zero service dword in
the structure, and on the curve it reads **515 mV / 405 MHz** while its neighbour 126 reads
1240 mV / 3157 MHz — so it is out of the monotonic order the other 127 points follow. It is very
probably not a graphics curve point at all. Until that is understood, no code treats it as ordinary.

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

### 8.7 The first ADDRESSED write — and the two silent no-ops that preceded it

**Measured 2026-08-10.** Everything above was driven by NVML, which moves ALL points at once. So the
claim the entire safety story rests on — *the mask carries one bit, therefore a bad write reaches one
point* — was still the source's, not ours. Proving it required KAGO's own write.

**Two writes were accepted and did nothing.** `ClkVfPointsSetControl` returned status 0 and not one
byte of the structure changed. That is the dangerous failure shape, and it is worth naming as a class:
**a malformed SELECTION is not a malformed CALL**, so the API has nothing to complain about. Any code
that trusted the status code here would have reported a profile as applied while the card ran stock.

**The cause was found by asking a read-only question instead of guessing a third time** (the
three-attempts rule, `BUG_FIXING_FRAMEWORK.md`). The lever puts a known value in every entry; then ask
`GetControl` for that state three ways and see what comes back:

| mask sent | entries returned carrying the value | which slots |
|---|---|---|
| all 128 bits | 127 | 1 … 127 *(under the old base)* |
| no bits | 0 | — |
| **one bit, point 64** | **1** | **slot 65 — one LATER than asked** |

The mask works exactly as documented; the ARRAY starts one entry later than assumed. Header = 0x44
bytes. Every earlier number re-derives under the corrected base, which is what makes this a
measurement rather than a fourth guess: first changed word `0x58` = point 0, last `0x1210` = point 126,
and `0x1220` = point 127's entry start.

**With the base corrected, the write works and the mask isolates.** Proved at three points — 20, 64
and 110 — each time: exactly ONE entry changed and it was the one addressed, the value read back equal
to what was written, the curve moved by exactly the offset at that point with **zero** other points
moving, and the rollback returned all 9 248 bytes byte-for-byte.

**Two things the run corrected about our own reasoning, recorded so neither gets re-invented:**

1. **Read-modify-write was NOT the fix, and must not be credited with it.** Both changes were made at
   once; the run that isolated them (`--prove-mask 20 -8 --zero-filled`) shows a zero-filled buffer
   works identically to a read-modify-write once the base is right. RMW is kept as the default anyway —
   it preserves service fields we do not understand for one extra read — but the cause was the address,
   full stop.
2. **A negative offset on a floor point cannot move the curve, and that is correct behaviour.** Points
   0…~20 of this curve all sit at **180 MHz**, the card's minimum clock, at rising voltages. The
   control struct records the offset; the frequency has nowhere to go. The check names this case
   explicitly rather than relaxing its predicate — a loosened "the delta may be zero" would also pass a
   write that did nothing anywhere (EXP-0020).

### 8.6 Commands

```
npm run nvml                                    read-only: driver, card, offset + ALLOWED RANGE per domain
npm run nvml -- --find-offset-field -100        the experiment; add --mem for the memory lever
npm run nvml -- --verify-decode                 the guard: one buffer, both layouts, published must go red
npm run nvml -- --probe-mask                    READ-ONLY under the lever: what the mask actually selects
npm run nvapi -- --prove-mask <point> <-MHz>    KAGO's OWN addressed write + the mask proof; --zero-filled
                                                repeats it without the read-modify-write
```

**`nvml.mjs` is an INSTRUMENT, never a backend.** It is not called by `profile-manager.mjs` and never
applies a profile — rule R1 stands, and the shipping write path remains NvAPI. §5.5's warning about the
two APIs clobbering each other is the reason the quarantine is explicit rather than assumed.

---

## 9. THE FAN STRUCTS — layouts taken from TWO independently-authored sources

**Collected 2026-08-10 17:1x +03:00, before a single line of fan code**, because §3.2 carried the fan
ids and no layouts, and the owner's-machine rule forbids learning a state-changing call's semantics by
running it. Nothing in this section has been run yet: it is the thing the first probe CHECKS.

### 9.1 Why two sources, and what agreement buys

The layouts below are asserted **identically** by two projects that did not copy each other's code:

| Source | Language / platform | What it is |
|---|---|---|
| [nvfancontrol](https://github.com/foucault/nvfancontrol/blob/master/src/nvctrl/os/windows.rs) | Rust, **Windows** — our platform | dynamic fan control daemon; the origin of §3.2's ids |
| [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LibreHardwareMonitorLib/Interop/NvApi.cs) | C#, Windows | hardware monitor; `NvFanCoolersStatus` / `NvFanCoolerControl` |

Agreement between two authors is evidence of a different KIND from care inside one reading (EXP-0017),
and here it matters more than usual: this is the first struct in the project we will WRITE without a
documented lever to cross-check it against — NVML has no fan-control call, so the ruler trick of §8 is
not available.

**Where they differ, and it is cosmetic:** LHM spells the status header's 32 reserved bytes as four
`ulong`s and nvfancontrol as eight `u32`s — the same 32 bytes. LHM also carries a third constant
(`MAX_COOLERS_PER_GPU = 20`) belonging to the LEGACY interface; the client structs use 32 in both.

### 9.2 The layouts, and the sizes derived from them

All fields are 4-byte unsigned unless said otherwise, so `Pack = 8` adds no padding — the largest
member of every item struct is 4 bytes, which fixes each struct's alignment at 4 (status's `ulong`
reserved block being the one 8-byte-aligned member, at an offset that is already a multiple of 8).

**`ClientFanCoolersGetStatus` (id `0x35AED5E8`) — 1 704 bytes = 0x6A8**

```
0x00  version                 (1 << 16) | 1704  = 0x000106A8
0x04  count                   ← the driver FILLS this; send 0
0x08 .. 0x27  reserved[8]
0x28 + i*0x34   item i, 52 bytes:
        +0x00  coolerId
        +0x04  currentRpm
        +0x08  currentMinLevel      ← the firmware floor, if there is one
        +0x0C  currentMaxLevel
        +0x10  currentLevel         ← percent, the same quantity `nvidia-smi` reads as fan.speed
        +0x14 .. +0x33  reserved[8]
```

**`ClientFanCoolersGetControl` / `SetControl` (ids `0x814B209F` / `0xA58971A5`) — 1 452 bytes = 0x5AC**

```
0x00  version                 (1 << 16) | 1452  = 0x000105AC
0x04  reserved
0x08  count
0x0C .. 0x2B  reserved[8]
0x2C + i*0x2C   item i, 44 bytes:
        +0x00  coolerId
        +0x04  level                percent
        +0x08  controlMode          0 = AUTO, 1 = MANUAL
        +0x0C .. +0x2B  reserved[8]
```

**`ClientFanCoolersGetInfo` (id `0xFB85B01E`) — 1 580 bytes = 0x62C**, same header as Control, item 48
bytes: `coolerId · reserved · reserved · maxRpm · reserved[8]`.

**Version number is 1 in both sources** for all three structs, and the size is part of the encoding, so
a wrong guess answers `-9 = INCOMPATIBLE_STRUCT_VERSION` — a clean refusal, exactly as §5.6 describes.
The probe therefore walks version numbers rather than betting on one, the same shape `readVfCurve`
already uses.

### 9.3 The write, and its rollback — named BEFORE the code exists (rule R5)

1. **Read first, for a whole step.** `GetStatus` and `GetControl` before anything is written: how many
   coolers this card has, what level each sits at, what `currentMinLevel` says, and whether the mode is
   already AUTO.
2. **The write is read-modify-write on the CONTROL struct** — `GetControl`, change `level` and set
   `controlMode = 1`, `SetControl`. Never a zero-filled buffer: unlike the curve struct (§8.7, where
   `--zero-filled` proved RMW was not the fix), here the reserved words come from the driver and we do
   not know what they mean.
3. **THE ROLLBACK IS `controlMode = 0` (AUTO) ON EVERY COOLER**, through the same call. It is
   idempotent, it is what the card boots with, and it needs no memory of what we set.
4. **The direction of the first write is UP, and that is a safety property, not a preference.** A fan
   stuck at a HIGH level costs noise until the next reset; a fan stuck LOW under load costs the card.
   The cold-start protocol only ever needs UP, so the low direction is not exercised at all.
5. **The watchdog must learn fans, or layer 2 has a hole.** `watchdog.mjs`'s total undo currently
   restores clocks, power limit and the 128 curve offsets — **not** the fan policy. A writer that dies
   holding MANUAL leaves the fans pinned, and while pinned-high is the harmless direction, "harmless"
   is not the same as "restored". Returning every cooler to AUTO is one call and belongs in the same
   undo (rule R9).
6. **`nvidia-smi` gives the second reading.** `fan.speed` is a read field on this card, so every fan
   write is verified by an instrument we did not author — and by the poll-until-two-samples-agree
   discipline that already caught `-rgc` answering early (EXP-0014).

### 9.4 MEASURED ON THIS CARD, 2026-08-10 17:3x…17:5x — §9.2 held, and the floor is the card's own word

Everything in §9.2 was accepted by the driver **on the first attempt, at version number 1**, for all
three structs. Nothing needed a second guess.

| Quantity | MEASURED here | What it settles |
|---|---|---|
| coolers reported | **3** | a plausible count for this board, and not 0 or 32 — the layout is right |
| ceiling per cooler | **3 000 rpm** (`GetInfo`) | the rpm cross-check below has a denominator that is not a literal |
| `currentMinLevel` | **30 %** on all three | **the 30 % phase 2 kept seeing on five ladder rungs is the card's own FLOOR, not where the stock curve happened to land** (`plans/03` §4.5 recorded the puzzle; this is the answer) |
| level / mode at rest | 0 % / AUTO | zero-RPM is reachable in AUTO even though the manual field's floor is 30 — the two are different statements |
| manual write | **accepted, and obeyed** | 60 % → `nvidia-smi` 61 %, rpm 1878/1860/1873 against an expected 1800; 80 % → 79 %, rpm 2404/2366/2401 |
| rollback to AUTO | **verified every time** | 0 coolers left in MANUAL, rpm back to 0/0/0, `nvidia-smi` 0 % stable |
| cold-start protocol | **45 → 42 °C**, and repeatably | three cycles of load-then-cool: reached **42 / 42 / 41 °C**, spread **1 °C**, in **8 / 4 / 0 s** |

**THE RAMP IS THE FINDING NOBODY PLANNED FOR, and it corrects a rule this project already had.** The
same command (manual 60 %) read back **768 / 824 / 768 rpm** two seconds after the write and
**1856 / 1861 / 1877 rpm** fourteen seconds after it. Nothing differed but the moment of reading. So a
fan does not FLIP to its commanded value, it RAMPS — and EXP-0014's rule *"read until two consecutive
samples agree"* can settle on a plateau on the way up. Agreement proves a settled DIGITAL state; a
mechanical actuator additionally requires the TARGET (`config.FAN_LEVEL_TOLERANCE_PCT` = 8 pp,
`FAN_RAMP_TIMEOUT_MS` = 30 s). The first version of the check passed at 30 % against a commanded 60 %,
because its predicate only asked for "at least the floor" — a weak predicate satisfied by a
neighbouring condition (EXP-0016).

**What this does NOT establish, said plainly:** the cool-down was proved over a NARROW thermal range —
the load used was a 25 s burst, so the card was cooled from 46…51 °C, not from the 65 °C a long burn
reaches. From genuinely hot the protocol will take longer, and the 1 °C spread is a claim about the
setpoint, not about the duration.

**Commands:**

```
npm run nvapi -- --fans                        read-only: coolers, levels, the card's own floor, rpm ceiling
npm run nvapi -- --fan-write 80                the write, under an armed watchdog, rollback to AUTO in finally
npm run nvapi -- --fan-write 80 --cool-to 42   the cold-start protocol; refuses to write at all if already colder
```

### 9.5 The honest unknowns going in

> Written BEFORE the run and kept unedited, because a prediction is only worth reading next to its
> outcome. All three questions below were ANSWERED by §9.4: yes it accepts manual control, yes the 30 %
> is the card's own floor, and it reports three coolers.

- ~~**Whether this card accepts manual control at all.**~~ **ANSWERED: yes** — accepted at version 1,
  obeyed at 60 % and 80 %, verified by rpm and by `nvidia-smi`.
- ~~**Whether the 30 % readings phase 2 saw are that floor**~~ **ANSWERED: they are the floor**, stated
  by `currentMinLevel` on every cooler.
- ~~**How many coolers this card reports.**~~ **ANSWERED: 3**, each with a 3 000 rpm ceiling.
- **Nothing about the LEGACY interface is planned.** `GetCoolerSettings` / `SetCoolerLevels` are kept
  in the id table as a fallback (both resolve), and newer cards are reported to need the client family.
  If the client family refuses, the fallback is tried — not before.

---

## Sources

- [nvfancontrol — Windows NVAPI fan control (Rust)](https://github.com/foucault/nvfancontrol/blob/master/src/nvctrl/os/windows.rs) — fan ids, init flow, **and §9's struct layouts (version number 1 for all three client structs)**
- [LibreHardwareMonitor — `Interop/NvApi.cs`](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/blob/master/LibreHardwareMonitorLib/Interop/NvApi.cs) — the SECOND, independently-authored reading of §9's fan structs; `NvFanControlMode { Auto = 0, Manual = 1 }`
- [LACT issue #936 — per-point V/F curve read/write via undocumented NvAPI, tested on RTX 5090 Blackwell](https://github.com/ilya-zlobintsev/LACT/issues/936) — curve ids, struct layouts, offsets, failure modes
- [Koffi — C FFI for Node.js](https://koffi.dev/) · [function pointers](https://koffi.dev/pointers) — `koffi.proto` / `koffi.call` / `koffi.decode`
- [NVAPI Reference Documentation](https://docs.nvidia.com/gameworks/content/gameworkslibrary/coresdk/nvapi/group__gpuclock.html) — the documented half (Initialize, EnumPhysicalGPUs, status codes)
- **`nvml.h` from CUDA Toolkit 13.3, ON THIS MACHINE** (`C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.3\include\nvml.h`) — the authority for §8: `nvmlClockOffset_v1_t` (lines 1176–1189), `NVML_STRUCT_VERSION` (139), `nvmlClockType_t` (1107), `nvmlPstates_t` (1153), `nvmlReturn_t` (1296–1327), `nvmlDeviceGetClockOffsets` / `nvmlDeviceSetClockOffsets` (6306, 6328), the `DEPRECATED(13.0)` marking of `nvmlDeviceSetGpcClkVfOffset` (9280). A local header beats a web page: it is the version this driver ships against
- Measured on this machine 2026-08-10: `nvidia-smi --help` write options (no fan control) · the idle warm-up 47 → 50 °C at fan 0 %
