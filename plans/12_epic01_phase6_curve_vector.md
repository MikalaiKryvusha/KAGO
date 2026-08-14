# Plan 12 — Epic 01 / Phase 6, slice 2: the profile's raise becomes a VECTOR

> **Created:** 2026-08-15 01:2x +03:00 (agent, executing item 1 of the direction turn the owner made at
> 2026-08-15 01:0x — *«движок должен ТЮНИТЬ ВСЕ ТОЧКИ КРИВОЙ»*)
> **Parent:** `plans/01_EPIC_kago_orchestrator.md` — phase 6; direct predecessor `plans/11` (the curve
> entered the profile as a SCALAR). Evidence base: `STATUS.md` → «профиль обязан быть ВЕКТОРОМ» and the
> available-undervolt table · `GOAL.md` → the owner's convergence loop · EXP-0056 (the instrument's
> constraint is not the product's shape)
> **Status:** ✅ **closed 2026-08-15 01:3x +03:00 — all five steps, zero GPU writes.** Written BEFORE
> the first line of its code (EXP-0027). Measured: `--selftest-shape` 31 → **42** blocks (6 mutations,
> each reddening its own) · `profiles --selftest` 30 → 45 (7 mutations) · `profile-manager --selftest`
> 36 → 40 (3 mutations) · eight neighbouring suites re-run, 0 failures · all 6 profiles load against
> the live card, 0 refusals, watchdog not armed
> **Outbound:** the format change → `profiles/README.md` · the monotonicity invariant → a new rule in
> `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` · closure → `STATUS.md` item 1 of the direction turn

---

## 0. Why this slice exists

`plans/11` taught the applier to write the curve, and it shipped the shape phase 5 had measured: ONE
number for the whole curve, `{ deltaMhz, capMhz }`. That was the correct thing to ship that night — it
is what had been measured — and it is the wrong shape for the product. Two independent statements in
this project's own canon say so, and both predate the code:

- **`GOAL.md`, the owner's convergence loop:** *«точка ставится на минимальный шаг выше отказа, вся
  кривая тестируется целиком, сбойнувшая точка поднимается храповиком и НИКОГДА не опускается»* — the
  loop's state is one value PER POINT, and a scalar cannot hold it.
- **`STATUS.md`, the available-undervolt table (arithmetic on the live curve, zero writes):** the lever
  yields **45 mV at 1700 MHz** and **245 mV at 2842 MHz**. A single Δ over the whole curve is therefore
  incapable of being the optimum — that is arithmetic, not a hypothesis.

The owner said it out loud after a week of the scalar: *«ты дрочишь целую неделю одну точку, какие-то
потолки частот сделал»*. EXP-0056 records the class. **This slice makes the artifact able to hold what
the loop will produce**, so that the loop (item 3 of the direction turn) has somewhere to write.

**Deliberate boundary: ZERO GPU WRITES.** Everything here is format, arithmetic and injected-backend
selftests. The live whole-curve run and the convergence loop are items 2 and 3 and need the owner
present (`bugs/03` process rule).

## 1. Goal vector

**The pain.** The profile can express «raise everything by N», and nothing else. The measurement the
project is about to start producing is a different shape — a safe voltage per region of the curve — and
there is no field to put it in. Until there is, the loop would have nowhere to land and would either
stay unwritten or be flattened back into one number, which is the defect EXP-0056 names.

**Where we want to be.** `curveRaiseAndCapMhz` carries EITHER a uniform raise (what is proven today and
must keep working) OR a per-point vector; the validator refuses every malformed shape naming its own
field; `buildRaiseAndCapVector` computes the same arithmetic for both; the applier writes and undoes
the vector exactly as it does the scalar.

**Goal types.** *Achieve* — a profile format that can hold a vector. *Maintain* — R1 (one writer), R9a
(the undo covers every kind of state), R11 (a cap has a named holder), and the property that a uniform
vector produces **byte-identical** offsets to today's scalar path. *Avoid* — a curve shape this project
has never written reaching the card unremarked (see §3 P6-AC10).

## 2. Entry gate

| Gate | State | Evidence |
|---|---|---|
| The applier can write and undo a curve | ✅ | `plans/11` §4.2 closed; applied live 2026-08-15 00:5x |
| The curve write takes a per-point array already | ✅ | `nvapi.writeCurve(nv, handle, offsetsMhz[])` — the vector is what the device layer already speaks |
| The stable axis is known and measured | ✅ | STATUS session 18: the curve moves along the FREQUENCY axis with temperature, the VOLTAGE axis does not — so a per-POINT key (points are voltage-keyed) is the stable one (`bugs/10`, EXP-0053) |
| A shipped profile to keep working | ✅ | `profiles/optimised.json`, scalar Δ = 592, witnessed live |

## 3. Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **P6-AC6** | The format carries a vector, and every malformed shape is refused naming its own field. | Scale: hostile fixtures each pointing at one field · Meter: `npm run profiles -- --selftest` · **Target: ≥ 6 new fixtures — both raise keys set · neither set · wrong length · non-integer element · element outside ±1000 MHz · `stock-default` carrying a vector — each mutation-proved to redden its OWN block** |
| **P6-AC7** | A uniform vector and today's scalar produce the SAME offsets, and the equality is byte-exact rather than eyeballed. | Scale: element-wise diff of the two offset arrays · Meter: `npm run nvapi -- --selftest-shape` · **Target: 0 differing elements at Δ ∈ {0, 45, 180, 592}, cap ∈ {null, 2842, 2400}** |
| **P6-AC8** | The applier writes and undoes the vector, and the undo is asserted BY NAME. | Scale: kinds of state restored after a failed apply · Meter: `node automation-engine/lib/profile-manager.mjs --selftest` on an injected curve backend · **Target: curve zeroed AND power limit restored, each named (R9a: never by a count); the read-back-mismatch path still self-cleans** |
| **P6-AC9** | The vector's own arithmetic is COMPUTED, not assumed — including what a vector can break that a scalar could not. | Scale: properties returned by `buildRaiseAndCapVector` · Meter: the same selftest · **Target: the monotonicity verdict is computed from the resulting curve and is FALSE on a crafted non-monotone vector, TRUE on every uniform one** |
| **P6-AC10** | A non-monotone curve never reaches the card silently. | Scale: paths by which a non-monotone vector can be written · Meter: code read + a fixture · **Target: 0 — refused in the validator AND refused in the last line before the device write, both naming the two offending points** |
| **P6-AC11** | Zero GPU writes in this slice. | Scale: device writes performed · Meter: every command in §7 is read-only or offline · **Target: 0** |

## 4. Steps

### 4.1 — One truth for the point count 🔲

*Anchor: internal map R3 — «`config.mjs` depends on nothing and holds every safety number»; and the
validator must not import the FFI layer to learn a number.*

- [ ] `CLK_VF_POINT_COUNT` moves to `config.mjs`; `nvapi.mjs` re-exports it so its twelve call sites are
      untouched. One truth, no mirror to drift.
- [ ] `profile-store.mjs` imports the graphics-point count from `config.mjs` — the validator stays
      offline and koffi-free.

### 4.2 — The curve arithmetic learns a vector 🔲

*Anchor: `nvapi.buildRaiseAndCapVector` — «the arithmetic has one author» (`profile-manager` header).*

- [ ] `deltaMhz` accepts a **number OR an array** of per-point raises. The formula is unchanged:
      `offset_i = clamp(min(Δ_i, cap − F_i), −1000, +1000)`. A scalar is the special case `Δ_i = Δ`.
- [ ] The stats it returns (`atFullDelta`, `raisedButCapped`, …) are computed against `Δ_i`, not against
      a single Δ that no longer exists.
- [ ] **New, and it is the property a vector can break while a scalar cannot:** the resulting curve's
      **monotonicity** is computed and returned (`monotone`, `firstInversionAt`). The old shape's
      monotonicity was a PROOF (`min(F_i + Δ, F_top)` preserves order); with a vector it becomes a
      measurement, and an unproved property must be measured or refused — never inherited.
- [ ] `--selftest-shape` gains the equality blocks of P6-AC7 and the inversion block of P6-AC9.

### 4.3 — The format learns the vector 🔲

*Anchor: `profiles/README.md` — «настройки черновика не врут»: a key the applier ignores does not ship,
so 4.2/4.3/4.4 land together.*

- [ ] `curveRaiseAndCapMhz` gains `deltaByPointMhz: int[] | null` beside `deltaMhz: int | null`.
      **Exactly one of the two is non-null** — both is ambiguous, neither is a curve setting that sets
      no curve. Each case its own refusal, its own field.
- [ ] Element checks, each naming the INDEX: integer; inside `CLOCK_OFFSET_MIN/MAX_MHZ`.
- [ ] Length check against the graphics-point count from 4.1, the refusal printing both numbers.
- [ ] `stock-default` carrying a vector is refused by the existing rule (a reset that configures is not
      a reset) — proved by its own fixture rather than assumed to still hold.
- [ ] New hostile fixtures per P6-AC6, mutation-proved.

### 4.4 — The applier writes the vector 🔲

*Anchor: internal map R9a and R10a — the undo learns the new state BEFORE the first write of it, and a
rollback is a LIST, not a chain.*

- [ ] `curveBackend.writeRaiseAndCap` takes the raise as number-or-array and passes it through; the
      read-back comparison is unchanged (it already compares the full commanded vector element-wise).
- [ ] **The last line before the device write refuses a non-monotone result** (P6-AC10), naming the two
      points — the same two-checks-of-one-fact shape R11 already uses for the cap floor.
- [ ] The step's `what:` line says which shape it is applying — a uniform raise or a vector of N points
      — because the operator reads that line before a write to the owner's card.
- [ ] The undo is untouched: zeroing the whole curve is already total and shape-independent (R9's
      «the undo is TOTAL, not differential»). Proved by the existing by-name blocks, re-run.

### 4.5 — The canon records what changed 🔲

- [ ] `profiles/README.md` — the format section gains the vector, with the reason it exists.
- [ ] `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` — a new rule: **a curve shape whose monotonicity is not a
      proof must be MEASURED before it is written**.
- [ ] `STATUS.md` — item 1 of the direction turn moves from «нет» to done; items 2 and 3 stay open and
      still need the owner.
- [ ] `EXPERIENCE.md` — a lesson if the work produces one that is not already recorded.

## 5. What this slice does NOT do — boundaries, so drift is visible

- **It does not run the whole curve on the card.** No pin, no cap sweep, no live write of any kind.
  That is item 2 and it needs the owner present.
- **It does not build the convergence loop.** This slice builds the container the loop will fill.
- **It does not change `optimised.json`.** The one witnessed profile keeps its scalar and its numbers;
  the vector is an added capability, not a migration.
- **It does not remove the cap.** The cap stays computed at APPLY time against the live curve, because
  the frequency axis moves with temperature and a frozen cap would leak.
- **It does not touch the qualification gate, the shortcuts, the tray or the logon task.**

## 6. Risks

**(a) Highest.**

| # | Risk | Defence |
|---|---|---|
| R1 | A vector produces a curve shape the card has never been given, and nobody notices | P6-AC9/AC10: monotonicity computed and refused in two places, each naming the offending pair |
| R2 | The generalization silently changes the SCALAR path, invalidating the one live-witnessed profile | P6-AC7: byte-exact equality of the two paths over 12 combinations, as a selftest block |
| R3 | A key the applier ignores ships (the defect the format canon exists against) | 4.2/4.3/4.4 land in one change; a settings key with no writer is not merged |

**(b) Plausible.**

| # | Risk | Contingency |
|---|---|---|
| R4 | 127 numbers in a JSON make the artifact unreadable to the owner | The `draft` block carries the prose and the provenance, as it already does; the vector is machine-written by the loop, not hand-edited |
| R5 | A driver update changes the curve's geometry and a per-index vector silently means something else | R6 already refuses a profile whose stamp no longer matches the card |

## 7. Verification map — every command here is offline or read-only (P6-AC11)

| Step | The observation that closes it |
|---|---|
| 4.1 | `npm run check` — every `.mjs` still parses; the constant has one definition (`grep`) |
| 4.2 | `npm run nvapi -- --selftest-shape` — equality blocks green, inversion block red on the crafted vector; mutation-proved |
| 4.3 | `npm run profiles -- --selftest` — new fixtures each naming their own field; mutation-proved |
| 4.4 | `node automation-engine/lib/profile-manager.mjs --selftest` — the injected curve backend receives the vector; the undo asserted by name |
| 4.5 | the documents read back after editing (the machine-edit rule for non-ASCII text) |

## 8. Decisions made without the owner

- **The vector is keyed by POINT INDEX, not by voltage or by frequency anchors.** Three candidates were
  weighed. Frequency anchors were rejected outright — the curve moves along the frequency axis with
  temperature (measured, 12 curve dumps, `bugs/10`), so a frequency-keyed vector means something
  different at 41 °C and 63 °C. Voltage anchors with interpolation are stable and human-readable, but
  they add an interpolator nobody asked for, and a point index IS voltage-keyed (the voltage axis was
  measured immovable), so they buy readability at the cost of a moving part. **Point index won on
  Occam:** it is the stable axis, it is exactly what `writeCurve` already consumes, and it is exactly
  what the owner's convergence loop will hold as its state — one representation for the loop and the
  artifact. Cheap to reverse: six profile files and one validator.
- **The scalar `deltaMhz` was KEPT rather than migrated away.** EXP-0056 names the scalar as the
  mistake, and the temptation was to delete it. But the one profile the owner has actually run and
  judged (`optimised.json`, Δ = 592, witnessed in Palworld 2026-08-15 00:5x) is a scalar, and removing
  the shape would invalidate the project's only live evidence. The two coexist under an exclusivity
  refusal, and P6-AC7 proves byte-exact equality so the kept path cannot drift.
- **The cap stays COMPUTED at apply time, not frozen into the vector.** Freezing it would bake in the
  curve's position at one temperature and let the ceiling leak when the curve moves.
- **The inversion refusal is conservative and says so.** Nothing was measured about what the card does
  with a non-monotone curve; the refusal states that as its reason rather than claiming harm. It can be
  lifted by a measurement, and the wording invites exactly that.
- **`CLK_VF_POINT_COUNT` moved from `nvapi.mjs` to `config.mjs`** so the validator does not import the
  FFI layer to learn a number (R3). `nvapi.mjs` re-exports it — one definition, twelve call sites
  untouched, no new row in the pair registry.
