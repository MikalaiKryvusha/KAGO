# Plan 14 — Epic 02 / Phase 1: the card's two grids, and the tuning curve as a DOCUMENT

> **Created:** 2026-08-15 16:0x +03:00 (agent, rung 3 of `/plan-epic` — written BEFORE the first line
> of this phase's code, EXP-0027)
> **Parent:** `plans/13_EPIC_edge_finder_full_range.md` — phase 1. Evidence base: `researches/09`
> (the measured search space) · `ideas/03` steps 1–5 (the owner's requirement) · `plans/12` (the vector
> entered the profile as a bare array — this phase gives it a home, a status and a date)
> **Status:** ✅ **CLOSED 2026-08-15 21:2x** — built 17:28 (`7a77a7f`), re-framed to frequency keys
> 17:43 (`af9849c`), judged 21:2x: **VERIFIED WITH CAVEATS** (§9). Zero GPU writes for the whole phase,
> re-checked at closing. Entry gate was green (§2)
> **Outbound:** the format → `profiles/README.md` and a new `curves/README.md` · the curve↔card pair →
> `AGENT_GUIDE.md` truth↔mirror registry · closure → `plans/13` §4 and the operational plan for phase 2

---

> 🔤 **ЗАКРЫТО ИНАЧЕ, ЧЕМ ЗАПЛАНИРОВАНО — И ЭТО СЛОВО ВЛАДЕЛЬЦА** (2026-08-15, `GOAL.md` → «🔤 ТОЧЕК
> С НОМЕРАМИ НЕ СУЩЕСТВУЕТ»). Этот план был написан в терминах «точек кривой с индексами», и в тот же
> день владелец эту рамку отменил: *«Нет никаких "точка 120". Есть только частоты по сетке частот»*.
> **Что реально построено:** документ ключуется ЧАСТОТОЙ (389 строк «частота → обслуживающее
> напряжение → статус → дата»), смещения для железа не хранятся, а СЧИТАЮТСЯ при применении от живого
> чтения таблицы. Статусы `clock-floor` и `above-card-max` отменены вместе с нумерацией. Шаги ниже
> читать с этой поправкой; она сделала артефакт устойчивым к температуре, а не просто переименовала.

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

### 4.1 — The two grid dictionaries ✅

*Anchor: `plans/13` §7 — «3, 4 — две сетки как JSON-словари → Фаза 1»; the owner's steps 3–4.*

- [x] `automation-engine/lib/card-grids.mjs` — `readVoltageGrid()` from `readVfCurve` (the V/F table
      IS the voltage grid; there is no finer voltage the card can be asked for) and
      `readFrequencyGrid()` from `nvidia-smi -q -d SUPPORTED_CLOCKS`.
- [x] Each written to `curves/voltage-grid.json` / `curves/frequency-grid.json` carrying: the values,
      the measured spacings **with their counts** (5 mV ×94 · 10 mV ×32; 7 MHz and 8 MHz), the range,
      the stamp (driver + VBIOS + local ISO with offset), and **the probe command that produced it**
      so a future session re-derives a value without re-deriving the procedure.
- [x] **Two derived facts land here and nowhere else**, because every consumer needs them and a second
      copy is a pair to watch: `clocks.max.graphics` (3090 — the R13 ceiling) and the count of points
      that sit above it (9) or on the frequency floor (44).
- [x] `config.mjs` gains nothing but the PATHS (R3: config holds the safety numbers, and these are
      probed facts, not constants). A module that needs a grid reads the artifact.

**Verification:** the two files, each re-derivable by the command printed inside it; the numbers must
reproduce `researches/09` §3.1 exactly — a disagreement means one of the two was written from memory.

### 4.2 — The tuning curve document ✅

*Anchor: the owner's step 5 — «загружаются стоковые точки напряжение-частота в виде объектов. Есть
частота, напряжение, статус, дата, когда точка в последний раз редактировалась».*

- [x] `automation-engine/lib/curve-store.mjs` — the document's only author.
- [x] Shape, one object per graphics point:
      `{ i, voltageMv, stockMhz, mhz, offsetMhz, status, provenBy, editedAt }`.
      `voltageMv` is the card's and never ours; `mhz` is what the point may serve after tuning;
      `offsetMhz = mhz − stockMhz` is DERIVED and re-computed on load, never trusted from the file (one
      truth, no mirror inside one object).
- [x] **The status vocabulary is closed, and every proof status quotes the owner** (F1-AC3):

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

- [x] `initFromCard()` — seeds all 127 points from the live stock curve with `status: 'stock'`, classing
      the floor points and the above-max points automatically. This is the owner's step 5, executed.
- [x] `--show` prints the document as a table; `--verify` is F1-AC4's pair check against the live card.
- [x] **The document is the loop's state, so it must survive a half-written save:** write to a temp file
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

### 4.3 — The profile REFERENCES the curve ✅

*Anchor: the owner's step 1 — «Они ассоциированы с JSON объектом… и есть ссылка на JSON — тюнинг
кривая видеокарты компа».*

- [x] `settings.curveRef: "<name>" | null` beside the existing `curveRaiseAndCapMhz`. **Exactly one of
      the two is non-null.** Both is ambiguous; neither is a profile that tunes nothing — each case its
      own refusal, its own field (the shape `plans/12` already established and proved).
- [x] `curveRef` resolves to `curves/<name>.json`; a missing file, an unparseable file, or a file whose
      stamp does not match the card is a refusal that names WHICH of the three it is.
- [x] `stock-default` carrying a `curveRef` is refused by the existing rule (a reset that configures is
      not a reset) — proved by its own fixture rather than assumed to still hold.
- [x] The applier takes the offsets from the referenced document through the SAME
      `buildRaiseAndCapVector` path the array already uses. **No second arithmetic** (R1).
- [x] `optimised.json` is NOT migrated. It keeps its scalar and its witnessed numbers; F1-AC6 proves
      the kept path did not drift. Migration happens in phase 5, when a measured curve exists to
      migrate TO.

**Verification:** `npm run profiles` loads all profiles against the live card with 0 refusals; the six
hostile fixtures of F1-AC5/AC7 each refuse naming their own field.

### 4.4 — The guards, and each one proved able to fail ✅

*Anchor: `plans/13` §2 E2-AC10; EXP-0008 — a guard is believed only after it has gone red.*

- [x] `curve-store --selftest`: the document's own suite on fixtures — every field missing one at a
      time · a status outside the vocabulary · a non-integer offset · an offset outside ±1000 ·
      wrong point count · a `takenAt` without its offset · **a point offering more than 3090 MHz**
      (F1-AC7) · a non-monotone result (carried forward from `plans/12` P6-AC10) · the atomic-save
      property under an injected mid-write throw.
- [x] `profiles --selftest` gains the `curveRef` fixtures of F1-AC5.
- [x] `nvapi --selftest-shape` gains the F1-AC6 equality block: the offsets produced from a curve
      document and from the equivalent array must be element-wise identical.
- [x] **Mutations, addressees named in each suite's header BEFORE the run** (EXP-0016): break the
      exclusivity check · break the R13 ceiling check · break the vocabulary check · break the derived
      `offsetMhz` recomputation · break the atomic save. Each must redden its own block and no other.
- [x] The suites are sandboxed and a block asserts the production `curves/` directory did not grow
      (EXP-0025 — a fixture among real records fabricates forensics).

**Verification:** every suite's completion line present, ≥1 failed block per mutation, `curves/`
unchanged by the suites.

### 4.5 — The canon records what changed ✅

- [x] `curves/README.md` — what the document is, the status vocabulary with the owner's quotes, why it
      ships in the repository, and the one command that re-derives each artifact.
- [x] `profiles/README.md` — the `curveRef` shape beside the existing two, with the reason it exists.
- [x] `AGENT_GUIDE.md` → truth↔mirror registry: **one new row** — *the live card's V/F voltages ↔ the
      voltages stored in `curves/*.json`*, checked by `npm run curve -- --verify`. The pair is real by
      EXP-0013's test: the two sides have different authors (the driver's table and our stored copy).
- [x] `AGENT_GUIDE.md` → harness table: the new commands.
- [x] `PROJECT_ARCHITECTURE_INTERNAL_MAP.md`: `curve-store.mjs` as the document's single author, and
      the rule that **`offsetMhz` is derived on load and never read from the file**.
- [x] `STATUS.md`: phase 1 of epic 02 closed with its numbers.

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

*(filled at closing 2026-08-15 21:2x — the calls made in writing this plan, plus the four made while
executing it and the two made at closing)*

**Made while EXECUTING, and each one is a deviation from this plan's own letter:**

- **The document is keyed by FREQUENCY, not by table index, and it holds 389 rows rather than 127
  points.** Not the agent's call — the owner's, the same day (`GOAL.md` → «🔤 ТОЧЕК С НОМЕРАМИ НЕ
  СУЩЕСТВУЕТ»), and it lands here because the plan was written before he said it. Recorded rather than
  silently absorbed, because every acceptance criterion below phrased in points (F1-AC2's «127 of 127»,
  F1-AC4's «naming the index», F1-AC7's «point 117») now reads against a shape that no longer exists.
  The criteria were judged by their INTENT, and the substitution is stated so nobody later reads a green
  criterion as proof of the literal count it names.
- **Two statuses were DELETED from the vocabulary this plan specified:** `clock-floor` and
  `above-card-max`. Both were consequences of numbering table entries — the frequency grid IS
  180…3090 MHz, so there is nothing above the card's maximum by construction, and the bottom of the
  grid is merely its bottom. The remaining six are the closed set.
- **The row shape lost `i` and `offsetMhz` and gained `stockVoltageMv`.** `i` was the index the owner
  retired. `offsetMhz` is not stored at all — it is computed at APPLY time from a live reading of the
  table, which is the whole point of the re-frame (EXP-0068): the offsets move with temperature, the
  frequency→voltage pair does not. This is stronger than the plan's «stored for human eyes but
  recomputed on load» and supersedes it.
- **`config.mjs` gained nothing, not even the paths.** The plan said «config.mjs gains nothing but the
  PATHS»; in the build, `CURVES_DIR` lives in `card-grids.mjs`, the module that owns the directory. R3
  reserves `config.mjs` for SAFETY numbers, and a directory path is not one.

**Made at CLOSING:**

- **The judge's three findings were fixed rather than filed as bugs.** All three were documentation
  drift with no runtime effect (a wrong block count, a missing map rule, an unticked plan), and
  `BUG_FIXING_FRAMEWORK.md` reserves a bug document for defects — a stale number in a canon file is
  repaired where it stands. Had any of them touched behaviour, this line would say the opposite.
- **The stamps of the whole evening were re-derived from commit receipts** (EXP-0019), because the same
  head-written-stamp class was found in four places at once while checking one. Corrected forward only;
  nothing older than this session was rewritten.

**The calls made in WRITING this plan (unchanged, all four confirmed by the build):**

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

---

## 9. ✅ STATUS: DONE — 2026-08-15 21:2x +03:00 · judge verdict: **VERIFIED WITH CAVEATS**

The phase was BUILT on 2026-08-15 (`7a77a7f` 17:28, re-framed by `af9849c` 17:43) and then left
unclosed: sessions 22 and 23 went on to epic 03 over an open gate. The `/fable-judge` pass this
section records was run at 21:2x, and it is the entry gate `plans/15` §2 and `plans/13` §2 both name.

### 9.1 Every criterion, and what was OBSERVED — re-run, never read

| # | Verdict | The observation |
|---|---|---|
| F1-AC1 | ✅ | `curves/voltage-grid.json` + `frequency-grid.json`. **389** frequencies 180…3090 MHz, steps **7 ×194 / 8 ×194** · **127** voltages 450…1240 mV, spacing **5 mV ×94 / 10 mV ×32**, `uniform: false`. Reproduces `researches/09` §3.1 EXACTLY — so neither side was written from memory. Each file carries its probe command (`npm run nvapi -- --curve` · `nvidia-smi -q -d SUPPORTED_CLOCKS`) and the stamp 610.88 / 98.03.58.40.8b |
| F1-AC2 | ✅ *(under the re-frame)* | `curves/measured.json` — **389 of 389** rows complete, `ROW_KEYS` is an exact-match list so an unknown field is a refusal. `CURVE_STATUS` is `Object.freeze`d; an unknown status is refused BY NAME. **The criterion's «127 of 127» refers to the retired shape** (§8) |
| F1-AC3 | ✅ | The three proof statuses quote `ideas/03` steps 9, 12 and 15 **verbatim** in the comment above the constant — read at `curve-store.mjs:54-57` |
| F1-AC4 | ✅ | `npm run curve -- --verify` against the LIVE card, read-only: **127 voltage rungs compared, 0 disagreements**. And the instrument states out loud what it deliberately does NOT compare — the stock voltage of a frequency, because a warm card wants more for the same frequency (it printed «карта сейчас 50 °C»). That refusal to over-claim is worth more than the green |
| F1-AC5 | ✅ | `npm run profiles -- --selftest` — **52 blocks, 0 failures**, six `curveRef` refusals: defined twice · malformed name · document missing · document itself invalid (and the refusal quotes ITS field) · wrong driver (R6) · `stock-default` carrying a reference |
| F1-AC6 | ✅ | `npm run nvapi -- --selftest-shape` — «вектор из ОДИНАКОВЫХ Δ даёт ТОТ ЖЕ вектор сдвигов, что и скаляр — **расхождений 0 на 12 сочетаниях**». Element-wise, not by eye. The one live-witnessed profile did not drift |
| F1-AC7 | ✅ | The block exists AND was reddened by an independent judge mutation (M1 below) — not merely present |
| F1-AC8 | ✅ *(and re-proved)* | See §9.2. **The claimed mutation COUNT, however, was unreproducible** — caveat 1 |
| F1-AC9 | ✅ | `watchdog --status` unarmed before and after · every command run in this pass is a read or an offline run · `git status` clean throughout |

### 9.2 The judge's own mutation run — the claim «proved able to go red» was not taken on trust

Four mutations, applied to COPIES of the modules (EXP-0070: the store copy was rewritten to import the
grids copy, so the suite could not silently run against the intact original), addressees named before
the run, cleanup in `finally` (EXP-0069):

| Mutation | Addressee named beforehand | Red blocks | Result |
|---|---|---|---|
| **M0** — intact code through the same copies | none | **0** | the copying itself reddens nothing |
| **M1** — `if (bound !== null && r.mhz > bound)` → dead | R13 ceiling | 1 | «R13: частота выше максимума карты отвергается» — its own block, alone |
| **M2** — `!STATUS_VALUES.includes(r.status)` → dead | closed vocabulary | 1 | «статуса нет в словаре → frequencies[3].status» |
| **M3** — temp+rename → a direct write to the target | atomic save | 2 | «обрыв ДО переименования не трогает целевой файл» + «успешная запись идёт через временный файл и переименование» — both belong to this one property |
| **M4** — `!grid.includes(r.voltageMv)` → dead | voltage off the grid | 1 | «напряжения нет на сетке карты, и отказ печатает саму сетку» |

`curves/` byte-identical before and after; both mutant copies removed.

### 9.3 The caveats — all three are documentation, none is behaviour

1. **A number with no run behind it, in a canon file.** `AGENT_GUIDE.md` claimed this suite was «44
   blocks, mutation-proved with 13 mutations» and described a mutation block that **does not exist in
   it** (the historically wrong R13 ceiling — that one belongs to `nvapi --selftest-shape`). The run
   gives **40**; `STATUS.md` said 15 mutations; the suite header names 12 addressees. One fact, three
   documents, three answers, and a description of a fifth thing. Two suites had been glued into one
   row. **Fixed by running it** — both files now carry the measured number and say where it came from.
2. **Step 4.5 was incomplete.** `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` contained **no mention of
   `curve-store.mjs` at all** — neither as the document's single author nor the rule that `offsetMhz`
   is derived on load. That is the blast-radius document a session reads BEFORE editing code, so the
   omission was the expensive kind. **Fixed:** rule **R14** and a blast-radius row.
3. **This plan was never closed.** 0 of 26 boxes ticked, §8 left on its placeholder, no verdict
   recorded — while `STATUS.md` reported the phase executed. **That gap is what blocked phase 2**, and
   two sessions passed through it without noticing, because STATUS said done and the plan is the file
   nobody re-opens. **Fixed by this section.**

**No first-class fraud found:** no weakened checks, no claimed-but-unrun verification, no scope creep,
no unauthorized action, no GPU write.

### 9.4 What this closes

`plans/13` §2 gate **2** — «Фаза 1 закрыта · `/fable-judge` по фазе 1» — is now satisfied, and with it
the entry gate of `plans/15` §2. Phase 2 of epic 02 (the sweep engine) may begin.
