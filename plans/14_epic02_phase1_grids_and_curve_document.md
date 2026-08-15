# Plan 14 — Epic 02 / Phase 1: the card's two grids, and the tuning curve as a DOCUMENT

> **Created:** 2026-08-15 16:0x +03:00 (agent, rung 3 of `/plan-epic` — written BEFORE the first line
> of this phase's code, EXP-0027)
> **Parent:** `plans/13_EPIC_edge_finder_full_range.md` — phase 1. Evidence base: `researches/09`
> (the measured search space) · `ideas/03` steps 1–5 (the owner's requirement) · `plans/12` (the vector
> entered the profile as a bare array — this phase gives it a home, a status and a date)
> **Status:** 🔲 open · entry gate green (see §2) · **ZERO GPU WRITES for the whole phase**
> **Outbound:** the format → `profiles/README.md` and a new `curves/README.md` · the curve↔card pair →
> `AGENT_GUIDE.md` truth↔mirror registry · closure → `plans/13` §4 and the operational plan for phase 2

---

## 1. Goal vector

**The pain.** The owner's algorithm opens with an artifact this project does not have: *«Есть профили…
есть ссылка на JSON — тюнинг-кривую видеокарты»*, and that curve holds per-point objects with
*«частота, напряжение, статус, дата, когда точка в последний раз редактировалась»*. Today the raise
lives INSIDE the profile as a bare integer array (`deltaByPointMhz`) with no status, no date and no
provenance — so a point cannot say *how* it got its number, *when*, or *by what proof*. A convergent
loop whose state has nowhere to live either does not get written or gets flattened back into a scalar;
that is EXP-0056, and this project has already paid for it once.

The same two sentences also ask for something the project reads but never keeps: the card's **full
voltage grid** and **full frequency grid** as their own JSON dictionaries (steps 3–4). Today both are
re-derived by whoever needs them, which means every consumer carries its own copy of a fact — the
exact drift class the truth↔mirror registry exists to prevent.

**Where we want to be.** One `curves/measured.json` holding 127 point objects — voltage (the card's,
immovable), stock frequency, tuned frequency, offset, **status from a closed vocabulary that is the
owner's own words**, and the ISO stamp of when it last changed; two grid dictionaries probed from the
card and stored beside it; a profile that REFERENCES the curve by name instead of embedding it; and a
validator that refuses every malformed shape naming its own field and its own point index.

**Goal types.** *Achieve* — the three artifacts and their validator. *Maintain* — R1 (one writer), R3
(`config.mjs` owns the safety numbers), R6 (the stamp), R13 (never above the instance maximum), and
the property that `optimised.json`'s scalar path keeps working byte-for-byte (it is the only profile
the owner has run and judged). *Avoid* — a second place where the point count, the voltage grid or the
card's maximum is written down.

---

## 2. Entry gate

| Gate | State | Evidence |
|---|---|---|
| `npm run check` green | ✅ | 33 `.mjs`, 0 failures (re-measured 2026-08-14 22:0x) |
| Driver still 610.88 | ✅ | probed 2026-08-15 15:3x — `nvidia-smi -q` and `nvapi --curve` both agree |
| The curve is readable per-point | ✅ | `readVfCurve` — 128 points, version 1, measured today |
| The profile format already carries a per-point vector | ✅ | `plans/12` closed 2026-08-15 01:3x, 45 validator blocks |
| The clock ladder is readable | ✅ | 389 values, 180…3090 MHz, probed today |
| Owner present | **not required** | this phase never writes to the card |

---

## 3. Acceptance criteria

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **F1-AC1** | Both grids are ARTIFACTS probed from the card, not numbers a module remembers. | Scale: grid files whose every value came from a live probe · Meter: `npm run curve -- --grids` writes them; each carries the probe command that produced it · **Target: 2 files · 389 frequencies · 127 voltages · both stamped with driver + VBIOS** |
| **F1-AC2** | Every curve point carries all four fields the owner named, and the status vocabulary is CLOSED. | Scale: points with `{voltageMv, stockMhz, mhz, status, editedAt}` complete · Meter: `npm run curve -- --show` + the validator · **Target: 127 of 127; any status outside the vocabulary refused by name** |
| **F1-AC3** | The status vocabulary is the owner's own words, not the agent's invention. | Scale: statuses traceable to a quoted line of `ideas/03` · Meter: code read against the document · **Target: the three proof statuses quote steps 9, 12 and 15 verbatim in the comment above the constant** |
| **F1-AC4** | The curve document is a MIRROR of the live card and the drift is caught by a command. | Scale: points whose stored voltage disagrees with the card's own curve at that index · Meter: `npm run curve -- --verify` · **Target: 0, and the command exits 1 on the first disagreement naming the index, both voltages, and the stamp of each side** |
| **F1-AC5** | A profile references the curve instead of embedding it, and exactly one of the two shapes is present. | Scale: profiles with both keys, or neither · Meter: `npm run profiles -- --selftest` · **Target: 0 of each; each case its own refusal naming its own field** |
| **F1-AC6** | The one live-witnessed profile keeps working, byte-for-byte. | Scale: element-wise diff of the offsets `optimised.json` produces before and after this phase · Meter: `npm run nvapi -- --selftest-shape` · **Target: 0 differing elements** |
| **F1-AC7** | R13 is enforced ON THE DOCUMENT, not only at apply time. | Scale: curve documents offering a clock above `clocks.max.graphics` that load successfully · Meter: a hostile fixture whose point 117 reaches 3097 MHz · **Target: 0 — refused by the validator naming the point, the offered clock and the card's maximum** |
| **F1-AC8** | Every new refusal has been proved able to go RED. | Scale: mutations reddening their OWN named block · Meter: the three selftests · **Target: 100 %, addressees named in the suite header BEFORE the run (EXP-0016)** |
| **F1-AC9** | Zero GPU writes. | Scale: device writes performed by any command in §7 · Meter: every command is a read or an offline run; `npm run watchdog -- --status` unarmed before and after · **Target: 0** |

---

## 4. Steps

Every step names the meta-plan line it executes. Fresh code is born `[NOT-TESTED]` and flips only on
observation (`TESTING_FRAMEWORK.md`).

### 4.1 — The two grid dictionaries 🔲

*Anchor: `plans/13` §7 — «3, 4 — две сетки как JSON-словари → Фаза 1»; the owner's steps 3–4.*

- [ ] `automation-engine/lib/card-grids.mjs` — `readVoltageGrid()` from `readVfCurve` (the V/F table
      IS the voltage grid; there is no finer voltage the card can be asked for) and
      `readFrequencyGrid()` from `nvidia-smi -q -d SUPPORTED_CLOCKS`.
- [ ] Each written to `curves/voltage-grid.json` / `curves/frequency-grid.json` carrying: the values,
      the measured spacings **with their counts** (5 mV ×94 · 10 mV ×32; 7 MHz and 8 MHz), the range,
      the stamp (driver + VBIOS + local ISO with offset), and **the probe command that produced it**
      so a future session re-derives a value without re-deriving the procedure.
- [ ] **Two derived facts land here and nowhere else**, because every consumer needs them and a second
      copy is a pair to watch: `clocks.max.graphics` (3090 — the R13 ceiling) and the count of points
      that sit above it (9) or on the frequency floor (44).
- [ ] `config.mjs` gains nothing but the PATHS (R3: config holds the safety numbers, and these are
      probed facts, not constants). A module that needs a grid reads the artifact.

**Verification:** the two files, each re-derivable by the command printed inside it; the numbers must
reproduce `researches/09` §3.1 exactly — a disagreement means one of the two was written from memory.

### 4.2 — The tuning curve document 🔲

*Anchor: the owner's step 5 — «загружаются стоковые точки напряжение-частота в виде объектов. Есть
частота, напряжение, статус, дата, когда точка в последний раз редактировалась».*

- [ ] `automation-engine/lib/curve-store.mjs` — the document's only author.
- [ ] Shape, one object per graphics point:
      `{ i, voltageMv, stockMhz, mhz, offsetMhz, status, provenBy, editedAt }`.
      `voltageMv` is the card's and never ours; `mhz` is what the point may serve after tuning;
      `offsetMhz = mhz − stockMhz` is DERIVED and re-computed on load, never trusted from the file (one
      truth, no mirror inside one object).
- [ ] **The status vocabulary is closed, and every proof status quotes the owner** (F1-AC3):

      | status | Meaning | The owner's line |
      |---|---|---|
      | `stock` | untouched, factory value | — |
      | `probing` | a rung is in flight; **written BEFORE the card is touched** | step 12 (the crash case) |
      | `short-burn-proved` | held a 10 s burn | step 9 — *«точка проверена, работает, доказано коротким прожигом»* |
      | `edge-found` | failed one rung lower; parked at V_fail + 10 mV | step 12 — *«протестирована, край найден!»* |
      | `long-burn-proved` | held 3 minutes | step 15 — *«доказаны длительным прожигом»* |
      | `lever-limited` | the ±1000 MHz lever ran out before the card did | `researches/09` §3.3 — **not an edge, and it must never be reported as one** |
      | `clock-floor` | sits on the 180 MHz floor; no stock frequency to search | `researches/09` §3.2 |
      | `above-card-max` | above 3090 MHz; never raised | `bugs/11` — the 82 MHz gap |

- [ ] `initFromCard()` — seeds all 127 points from the live stock curve with `status: 'stock'`, classing
      the floor points and the above-max points automatically. This is the owner's step 5, executed.
- [ ] `--show` prints the document as a table; `--verify` is F1-AC4's pair check against the live card.
- [ ] **The document is the loop's state, so it must survive a half-written save:** write to a temp file
      in the same directory and rename over the target (rename is atomic on NTFS), so a crash mid-save
      leaves either the old document or the new one, never a truncated one. Phase 2's journal depends on
      this property and it is cheaper to build it here than to retrofit it after the first lost sweep.
      **Promoted from prudence to a requirement by the owner, 2026-08-15:** *«зависание компа и
      перезагрузка — осознанный риск»* (`GOAL.md`). A hang is now a NORMAL path through this code, not
      an exceptional one, so «the machine died while we were saving» is a case this phase must handle
      rather than a case it may hope to avoid.

**Verification:** `--show` on a freshly seeded document — 127 points, 44 `clock-floor`, 9
`above-card-max`, 74 in the working band, matching `researches/09` §3.2; `--verify` green against the
live card and RED against a fixture whose point 40 was moved 5 mV.

### 4.3 — The profile REFERENCES the curve 🔲

*Anchor: the owner's step 1 — «Они ассоциированы с JSON объектом… и есть ссылка на JSON — тюнинг
кривая видеокарты компа».*

- [ ] `settings.curveRef: "<name>" | null` beside the existing `curveRaiseAndCapMhz`. **Exactly one of
      the two is non-null.** Both is ambiguous; neither is a profile that tunes nothing — each case its
      own refusal, its own field (the shape `plans/12` already established and proved).
- [ ] `curveRef` resolves to `curves/<name>.json`; a missing file, an unparseable file, or a file whose
      stamp does not match the card is a refusal that names WHICH of the three it is.
- [ ] `stock-default` carrying a `curveRef` is refused by the existing rule (a reset that configures is
      not a reset) — proved by its own fixture rather than assumed to still hold.
- [ ] The applier takes the offsets from the referenced document through the SAME
      `buildRaiseAndCapVector` path the array already uses. **No second arithmetic** (R1).
- [ ] `optimised.json` is NOT migrated. It keeps its scalar and its witnessed numbers; F1-AC6 proves
      the kept path did not drift. Migration happens in phase 5, when a measured curve exists to
      migrate TO.

**Verification:** `npm run profiles` loads all profiles against the live card with 0 refusals; the six
hostile fixtures of F1-AC5/AC7 each refuse naming their own field.

### 4.4 — The guards, and each one proved able to fail 🔲

*Anchor: `plans/13` §2 E2-AC10; EXP-0008 — a guard is believed only after it has gone red.*

- [ ] `curve-store --selftest`: the document's own suite on fixtures — every field missing one at a
      time · a status outside the vocabulary · a non-integer offset · an offset outside ±1000 ·
      wrong point count · a `takenAt` without its offset · **a point offering more than 3090 MHz**
      (F1-AC7) · a non-monotone result (carried forward from `plans/12` P6-AC10) · the atomic-save
      property under an injected mid-write throw.
- [ ] `profiles --selftest` gains the `curveRef` fixtures of F1-AC5.
- [ ] `nvapi --selftest-shape` gains the F1-AC6 equality block: the offsets produced from a curve
      document and from the equivalent array must be element-wise identical.
- [ ] **Mutations, addressees named in each suite's header BEFORE the run** (EXP-0016): break the
      exclusivity check · break the R13 ceiling check · break the vocabulary check · break the derived
      `offsetMhz` recomputation · break the atomic save. Each must redden its own block and no other.
- [ ] The suites are sandboxed and a block asserts the production `curves/` directory did not grow
      (EXP-0025 — a fixture among real records fabricates forensics).

**Verification:** every suite's completion line present, ≥1 failed block per mutation, `curves/`
unchanged by the suites.

### 4.5 — The canon records what changed 🔲

- [ ] `curves/README.md` — what the document is, the status vocabulary with the owner's quotes, why it
      ships in the repository, and the one command that re-derives each artifact.
- [ ] `profiles/README.md` — the `curveRef` shape beside the existing two, with the reason it exists.
- [ ] `AGENT_GUIDE.md` → truth↔mirror registry: **one new row** — *the live card's V/F voltages ↔ the
      voltages stored in `curves/*.json`*, checked by `npm run curve -- --verify`. The pair is real by
      EXP-0013's test: the two sides have different authors (the driver's table and our stored copy).
- [ ] `AGENT_GUIDE.md` → harness table: the new commands.
- [ ] `PROJECT_ARCHITECTURE_INTERNAL_MAP.md`: `curve-store.mjs` as the document's single author, and
      the rule that **`offsetMhz` is derived on load and never read from the file**.
- [ ] `STATUS.md`: phase 1 of epic 02 closed with its numbers.

---

## 5. What phase 1 does NOT do — boundaries, so drift is visible

- **It does not touch the card.** No pin, no curve write, no power-limit change. F1-AC9 is checkable.
- **It does not search anything.** The sweep loop, the pin, the journal and the resume are phase 2.
- **It does not migrate `optimised.json`.** The only live-witnessed profile keeps its shape until a
  measured curve exists to replace it with (phase 5).
- **It does not delete `deltaByPointMhz` or `deltaMhz`.** Both stay, under the exclusivity refusal;
  removing the shape the owner has actually run would destroy this project's only live evidence.
- **It does not decide the sweep's order, step or seeding.** Those are phase 2's, and they are already
  recorded as decisions in `plans/13` §8.

---

## 6. Risks

**(a) Highest.**

| # | Risk | Defence |
|---|---|---|
| R1 | The curve document becomes a SECOND source of truth for the card's voltages and silently drifts from the card | F1-AC4: `--verify` is a pair check with a command, and the registry row makes it somebody's duty |
| R2 | A half-written document is loaded as a whole one after a crash — and phase 2 is built on top of this file | 4.2's atomic save (temp + rename), with its own selftest block under an injected mid-write throw |
| R3 | The generalization silently changes the scalar path and invalidates the one witnessed profile | F1-AC6: element-wise equality as a selftest block |

**(b) Plausible.**

| # | Risk | Contingency |
|---|---|---|
| R4 | 127 point objects make the file unreadable to the owner | He reads the mode files and `--show`'s table, not the JSON; the document is machine-written by the loop and hand-edited never |
| R5 | A driver update changes the curve geometry and a per-index document silently means something else | R6's stamp already refuses; `--verify` names both stamps in its refusal |
| R6 | The status vocabulary grows a case during phase 2 and the fixtures rot | The vocabulary is one exported constant; a new case must add its fixture in the same change — stated here so the next session cannot claim it was unforeseen |

---

## 7. Verification map — every command is offline or read-only (F1-AC9)

| Step | The observation that closes it |
|---|---|
| 4.1 | `npm run curve -- --grids` writes both files; their numbers reproduce `researches/09` §3.1 exactly |
| 4.2 | `npm run curve -- --show` — 127 points, 44 / 9 / 74 split; `--verify` green live, RED on the moved-point fixture |
| 4.3 | `npm run profiles` — 0 refusals against the live card; each hostile fixture refuses naming its own field |
| 4.4 | three suites' completion lines, ≥1 failed block per mutation, `curves/` not grown by the suites |
| 4.5 | the documents read back after editing (the machine-edit rule for non-ASCII text) |
| phase | `npm run watchdog -- --status` unarmed before and after; `npm run check` green |

## 8. Decisions made without the owner

*(filled at closing; the calls already made in writing this plan)*

- **The curve document is a SEPARATE file referenced by name, not an inline object in the profile.**
  The owner asked for a reference (step 1), and the arithmetic agrees: three modes share one curve, so
  embedding it would create three copies of one measurement — the drift class this project keeps
  paying for.
- **`offsetMhz` is stored for human eyes but recomputed on load.** A file with both a frequency and an
  offset carries the same fact twice; the recomputation makes the pair impossible rather than watched.
- **The status vocabulary is closed and quotes the owner.** An open string field would let a future
  session invent a status that no consumer handles, and `lever-limited` in particular exists to be
  impossible to confuse with an edge.
- **The atomic save is built in phase 1, not phase 2.** It costs four lines here and a lost sweep
  there.
