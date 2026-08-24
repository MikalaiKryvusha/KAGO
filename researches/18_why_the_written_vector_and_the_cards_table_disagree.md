# Research 18 — why the written vector and the card's own table disagree

> **Created:** 2026-08-24 (agent, on the owner's four-point order of the same morning)
> **Parent:** `bugs/50` · `bugs/47` (reopened by this document) · `ideas/11` · `interviews/012` (owner's answer «C, затем A»)
> **Status:** 🟢 recon complete 2026-08-24 10:0x — one leading hypothesis, two rivals, all three offline-testable. No code written yet, by the ladder's own rule.
> **Outbound:** the meta-plan `plans/36_EPIC_*` · a reopen of `bugs/47` · a correction to `bugs/50`'s hypothesis list

---

## 0. The question, in one sentence

A live rung writes a raise-and-cap vector whose arithmetic **cannot** offer above the ceiling, and
the card, read back seconds later, reports a table that **does** — while also reporting that the
tested frequency is served by a nearly-factory voltage. Both numbers come from the card. Which
mechanism produces them?

## 1. The measurement that started this — `seq 699` vs `seq 700`, 2026-08-24 09:36

One frequency, two consecutive rungs, the same ceiling, the same code path. The only differences
are the ordered voltage and which table entry was addressed.

| | `seq 699` — PASS | `seq 700` — void, run halted |
|---|---|---|
| ordered voltage | 850 mV | 845 mV |
| table entry addressed | 64 | 63 |
| offset the engine computed | +173 MHz | +203 MHz |
| **offset that actually reached the card** | **173** | **203** |
| **drift between the engine's read and the atom's** | **0** | **0** |
| **what the curve offered after the write** | **2355 = exactly the cap** | **2370 = cap + 15** |
| voltage serving 2355 MHz after the write | 860 mV | **910 mV** (stock is 895) |

Both of the bold rows are new fields, added to the write-ahead journal earlier the same morning
(`bugs/49`, `bugs/50`). Before them this incident was a bare «карта ушла ВЫШЕ потолка» with nothing
to reason from — the project had lived with this class since 2026-08-23 and could not name it.

**The card's own geometry, so the arithmetic below is checkable:**

| entry | mV | MHz at stock |
|---|---|---|
| 63 | 845 | 2145 |
| 64 | 850 | 2175 |
| 65 | 860 | 2197 |
| 70 | 890 | 2332 |
| ~71 | **895** | **2355** ← the run printed exactly this stock |

At Δ = 203 and cap = 2355 the vector puts entry 63 at `2145 + min(203, 210) = 2348` — **short of the
tested frequency** — and entries 64…71 at exactly 2355 (`min(Δ, cap − F_i)` clamps them). So 2355
**must** be served by entry 64, i.e. **850 mV**. The card said 910.

## 2. What is already RULED OUT, and how

Each of these was a live hypothesis before this session. Each died to a measurement, not to an
argument — which is why they are listed before the surviving ones.

| # | Ruled out | By what |
|---|---|---|
| R1 | **The vector's arithmetic leaks above the cap** | Computed offline over all six historical breaches: `highestOfferedMhz` came back **exactly ≤ cap, leak 0** in every case. `offset_i = min(Δ, cap − F_i)` cannot exceed the cap by construction; the only escape is the ±1000 MHz hardware clamp, and every cap here sits far above the leak floor (`верх − 1000`). |
| R2 | **The table drifted between the engine's read and the atom's** — the whole content of `bugs/47` | `tableDriftMhz = 0` on both rungs. The tables agreed, nothing was recomputed, and the failure happened anyway. **`bugs/47`'s stated cause does not produce this failure**, and its fix is inert against it. |
| R3 | **The card warmed during the burn and slid the table** | The read-back happens **before the burn, not after**: `curveBefore` is `vf-step.mjs:667`, `curveAfter` is `:843`, and `stress.stressTest` is `:1019`. Both table probes are seconds apart on an idle card. The thermal axis is out of the picture for this pair entirely. |
| R4 | **Point 127 — the entry the module refuses to call ordinary — leaks into the ceiling read** | Both the write (`writeCurve`, `count = CLK_VF_POINT_COUNT − 1`) and the verification (`vf-step.mjs:782`, `curvePoints = CLK_VF_POINT_COUNT − 1`) cover entries 0…126. The suspect entry is excluded on both sides. |
| R5 | **The offsets never landed at all** | `vf-step.mjs:786–839` builds the `requested` array and demands `matched === curvePoints` against a re-read of the control struct. If nothing landed, that block is red. ⚠️ **Whether it WAS red on `seq 700` is unknown — see §5, and that ignorance is itself a defect.** |
| R6 | **The overshoot is one document row, i.e. a pure axis shift** | Measured against the real frequency grid: the three breaches overshoot by **2, 2 and 3 grid steps** (+15, +15, +23 MHz), not one. `bugs/50`'s hypothesis 2 as written is refuted. |

## 3. The anatomy of the write, read from the code rather than recalled

- **The API takes one entry per call.** `buildVfControl` sets exactly one mask bit; the vendor
  constraint is recorded in `researches/05` §3.4 — *«setting all 128 bits returns -1»* — and is
  independently confirmed by third parties (§4). So a whole-curve write is a **loop of 127 calls**.
- **Each call is a read-modify-write** (`writeVfOffset`, `mode: 'rmw'`): GetControl the whole
  0x2420 struct, clear the mask region, set one bit, write one field, SetControl. That is **254
  driver round-trips per rung**.
- **`writeCurve` returns success from STATUS ALONE** — `ok: failed === 0`. It never re-reads. The
  same module's header states the opposite rule in so many words: *«status 0 is not verification,
  the read-back is (EXP-0024)»*, and its neighbour `zeroCurve` does re-read (`remainingNonZero`).
  The gap is in the writer that ships.
- **This card has a documented accepted-but-inert write:** *«a SILENT NO-OP on this card: status 0,
  and not one byte of the structure changes»* (`nvapi.mjs`, the `zero-filled` branch). So «127
  statuses of 0» is not evidence that 127 offsets are in force.
- **Two different read-backs exist and they are not the same instrument.** `readVfOffsets` reads the
  **control struct** (our offsets). `readVfCurve` reads the **effective V/F curve** (base + offsets,
  as the driver resolves it). §1's contradiction is between the second one and our arithmetic.

## 4. Industry sweep — what the world does about this, and what it does not

| Source | What it gives us |
|---|---|
| [LACT issue #936](https://github.com/ilya-zlobintsev/LACT/issues/936) | Independent confirmation of the per-entry, one-bit-per-call shape of `ClkVfPointsSetControl`, and that the whole facility is undocumented. |
| [nvcurve](https://github.com/ekojsalim/nvcurve) | A Linux V/F curve editor driving the same undocumented entry points through `libnvidia-api.so` — i.e. the mechanism is not Windows-specific and not our misreading. |
| [green-curve](https://github.com/aufkrawall/green-curve) | The MIT project this repository already names as a fallback backend (`R2`, `researches/01`). |
| [NV-UV-Play](https://github.com/christianp403-spec/NV-UV-Play) | A fire-and-forget consumer undervolter over the same API. |
| [NVIDIA driver-settings programming guide](https://developer.nvidia.com/downloads/nvapi-driver-settings-programming-guide) | Documents the *driver settings* surface; the clock/V-F control entry points are **not** in it. |

**The finding worth having, stated as a negative:** not one source documents a **verification
protocol** for a curve write — no settling time, no read-back contract, no statement of when the
effective curve is guaranteed to reflect a SetControl. The industry writes and hopes. Anti-pattern
adopted from that observation: *do not model our verification on any of these tools* — they are
evidence about the API's shape, not about how to know a write took.

One more confirmation that matters for safety and is already canon here: **NvAPI SetControl and
NVML's offset setter drive the same hardware state and clobber each other**, which is exactly why
`researches/05` §5.5 quarantines NVML to an instrument (R1, R7). Nothing in this epic may reach for
NVML to «check» a curve.

## 5. The leading hypothesis — and it comes from this project's own canon

**`curveAfter` is a SINGLE read taken immediately after 127 writes.** `AGENT_GUIDE.md`, the
owner's-machine rule, step 4, verbatim:

> **A single read taken immediately after a write can return the previous value.** Read until two
> consecutive samples agree, then report.

That line is not theory. It was **measured on this machine on 2026-08-10**: `nvidia-smi -rgc`
answered *«All done»* with exit 0 while `clocks.gr` still reported the locked 1200 MHz, and the
release appeared only on the next sample about a second later.

**A partially-settled table explains BOTH of §1's numbers with one mechanism, and no other candidate
explains both:**

- the top has not finished coming DOWN from the factory 3157 toward the 2355 ceiling → the read
  catches it at **2370**;
- the low entries have not finished coming UP → 2355 is still served by a near-factory entry →
  **910 mV against a stock of 895**.

And it explains the asymmetry between the two rungs without any extra assumption: `seq 699` moved
the curve less (Δ 173 against 203), so it had less settling to do and its single read landed after
the table was stable.

**Two rival hypotheses stay alive**, and both are offline-testable, so none of them gets to be the
answer by default:

- **H2 — a fraction of the 127 writes is silently inert.** The card has that failure mode
  documented. A partial application shifts the effective curve arbitrarily.
- **H3 — the driver enforces its own constraint on the resulting curve** (monotonicity, a
  granularity snap) so that `base + offset` is not what we computed, entry by entry.

**The discriminator between all three is already in the code and merely unread:** the block at
`vf-step.mjs:837` compares every requested offset against the control struct. Green ⇒ the offsets
ARE in force and the divergence is in how the driver resolves them (H1 or H3). Red ⇒ H2.

## 6. 🔴 The structural finding — why the bench was green while the card failed

`virtual-gpu.mjs:1154`:

```js
const vec = buildRaiseAndCapVector(this.points(), deltaMhz, { capMhz });
```

**The virtual card computes its response with the same function that computed the write.** Its
table becomes, by construction, exactly what the vector describes. So:

- every read-back on the bench agrees with the vector **because it is the vector**;
- the bench can never produce §1's contradiction, at any Δ, on any card fixture;
- a green bench means **«the engine computed a vector consistent with itself»** — a tautology — and
  says nothing about whether a card ends up holding it.

This is the same defect class the project has already paid for twice and named: a double that
refuses LESS than the card makes every later green a lie (`AGENT_GUIDE.md` → the pairs registry, the
`vgpu` row), and EXP-0077 — two places naming one quantity, so the mutation reddens nothing. Here it
is worse than a drifted pair: **there is no second opinion at all.**

It is also the exact gap the owner's order of 2026-08-24 point 3 names — *«симулируй ОТКАЗЫ ВСЕХ
ВОЗМОЖНЫХ СЦЕНАРИЕВ»* — and the reason his point 2 (*«отлаживайся на ней, пока не починишь»*) cannot
be executed against today's bench: it has nothing to fail.

## 7. Implications for THIS epic

1. **The bench must hold a table as an INDEPENDENT surface.** A write applies offsets to the card's
   own stored table; the read-back is derived from that table, never from the vector. Until that
   inversion is done, points 2 and 3 of the owner's order are not executable.
2. **A settling contract is required, and it is canon rather than a new idea.** The read after a
   write polls until two consecutive samples agree, bounded, and REFUSES when it never stabilises —
   the owner's-machine rule step 4, applied where it was skipped.
3. **`writeCurve` must verify the effective CURVE, not only the statuses.** Its own module already
   says so; today only `zeroCurve` obeys.
4. **The atom's red blocks must become visible.** The discriminator of §5 exists and was thrown away
   on the very rung that needed it. This is the `bugs/49` class one floor down: a measurement taken
   and dropped.
5. **`bugs/47` is reopened.** Its cause is refuted by `tableDriftMhz = 0` on the same symptom. Its
   fix is not reverted — recomputing the offset against the atom's own table is right on its own
   terms — but it is not the cure for this, and the document must stop claiming it is.
6. **`bugs/50`'s hypothesis list is corrected**: hypothesis 2 (a one-row axis shift) is refuted by
   the grid measurement, and hypothesis 1 (curve leak) by the arithmetic.

## 8. Open forks for the owner

**None.** Every decision this epic needs is already settled by his standing word: debug on the
bench (order of 2026-08-24 point 2), simulate every failure class (point 3), the evening live run is
the acceptance (point 4), and the read-until-stable rule is his own machine rule. Should a fork
appear while building, it goes to `interviews/` and the unblocked phases continue.

## 9. What this document deliberately does NOT claim

- **It does not name a cause.** H1 leads because it explains both numbers and rests on a measured
  precedent on this machine; it is not proven, and §5's discriminator has not been read yet.
- **It does not claim the evening run will pass.** It claims the failure will be *diagnosable* —
  which today it was not.
- No number here is inherited: every figure is from this session's journal lines, the card's stored
  grids, or a quoted line of the repository's own code.
