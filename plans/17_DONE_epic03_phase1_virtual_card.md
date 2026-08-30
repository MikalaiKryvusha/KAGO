# Plan 17 — Epic 03 / Phase 1: the virtual card as an object — geometry, state, two backends

> **Created:** 2026-08-15 18:4x +03:00 (agent, rung 3 of `/plan-epic` for `ideas/04`, written after the
> meta-plan and detailing ONLY this phase)
> **Parent:** `plans/16_EPIC_virtual_gpu_bench.md` — phase 1. Evidence base: `researches/10` (the
> seams, the industry practice, the doubles already in the tree) · `profile-manager.mjs` (the two
> interfaces being implemented) · `curves/*.json` (the geometry, already measured)
> **Status:** 🔲 open · **ZERO GPU WRITES for the whole phase** — every line here runs offline
> **Outbound:** the harness row → `AGENT_GUIDE.md` · `benches/` → `PROJECT_STRUCTURE_EXTERNAL_MAP.md` ·
> the virtual card as a BACKEND and not a new writer → `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` (R1/R2) ·
> closure → `plans/16` §4, then the phase-2 operational plan

---

## 1. Goal vector

**The pain.** The bench has three interfaces to satisfy and a geometry to carry, and today neither
exists: the tree holds three hand-rolled stubs (`researches/10` §3.2) that answer what their own
suite asks and agree with nothing. Nothing in the project can currently be handed a *card* that is
not the owner's.

**Where we want to be.** One module and one fixture format: `profile-manager.apply`,
`roundTrip`, `resetToFactory` and the watchdog's total undo run end-to-end against a virtual RTX
5070 Ti built from the geometry epic 02 already measured — and they cannot tell the difference,
because the virtual card enforces the SAME refusals the real one does.

**Goal types.** *Achieve* — `virtual-gpu.mjs` and `benches/cards/rtx5070ti.json`. *Maintain* — R1
(the virtual card is a BACKEND; `profile-manager` stays the only module that decides to write),
R2 (backends are swappable — this is the third one), and zero GPU writes. *Avoid* — a fake that is
MORE PERMISSIVE than the card, which is the one defect that would make every later green a lie.

**No randomness in this phase at all.** The edge and its probabilistic failure are phase 2. A card
that cannot yet fail is exactly what makes phase 1 debuggable.

## 2. Entry gate

| Gate | Required state | Evidence |
|---|---|---|
| `npm run check` green | 35 files, 0 failures | `npm run check` |
| The geometry exists | `curves/voltage-grid.json`, `curves/frequency-grid.json`, `curves/measured.json` on disk with their stamps | `npm run curve -- --grids` · `--show` |
| The ignore line exists BEFORE the tool produces output | `runs/` already ignored; `benches/cards/*.json` are committed fixtures by intent | `git check-ignore -v runs/x` |

## 3. Acceptance criteria

*(prefix `B1` — Bench, phase 1)*

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **B1-AC1** | A card profile is a FILE, and a malformed one is refused rather than half-loaded. | Scale: hostile fixtures accepted · Meter: `vgpu --selftest` over ≥8 fixtures, each carrying exactly one defect and naming the field the validator must point at · **Target: 0 accepted; each refusal names its field** |
| **B1-AC2** | The first virtual card is DERIVED from the measured geometry, never hand-typed. | Scale: values in `benches/cards/rtx5070ti.json` differing from `curves/*.json` · Meter: a derive command + a comparison block · **Target: 0 differences on grids, count, card maximum and stamp** |
| **B1-AC3** | The virtual card refuses EXACTLY what the real curve backend refuses. | Scale: inputs where the two backends' verdicts differ · Meter: a refusal-parity block driving both `nvapiCurveBackend`'s decision path and the virtual one over the same vectors (R11 leak, R12 inversion, R13 above-maximum, absent bound) · **Target: 0 differing verdicts, and the reason strings name the same rule** |
| **B1-AC4** | The virtual card is not EASIER than the real one on the read-back path. | Scale: paid-for card behaviours the fake omits · Meter: named list — a read taken immediately after a write may return the previous value (`-rgc` answered "All done" while `clocks.gr` still read the lock); a fan/clock RAMP means agreement of two samples is not arrival · **Target: each is present and has a block that fails without it** |
| **B1-AC5** | The existing apply paths run on it, unmodified. | Scale: changes to `profile-manager.mjs` needed to make it work · Meter: `apply` · `roundTrip` · `resetToFactory` driven against the virtual card · **Target: 0 changes to the applier's logic; only the backend argument differs** |
| **B1-AC6** | The mechanics are not wired to this card. | Scale: constants in `virtual-gpu.mjs` assuming 127 / 389 / 3090 / 5 mV | Meter: a second fixture with a different geometry runs the same code · **Target: 0** |
| **B1-AC7** | Zero GPU writes. | Scale: device writes · Meter: every command in §7 is offline; `watchdog --status` unarmed before and after · **Target: 0** |
| **B1-AC8** | Every new guard has been proved able to fail. | Scale: mutations reddening their OWN named block · Meter: the suite · **Target: 100 %, addressees named in the header BEFORE the run (EXP-0016)** |

## 4. Steps

### 4.1 — The card-profile format and its validator 🔲

*Anchor: `plans/16` §8.8 — «механика — `automation-engine/lib/virtual-gpu.mjs`, карты —
`benches/cards/*.json`».*

- [ ] `benches/cards/<name>.json`, shaped after the artifacts phase 1 of epic 02 already writes, so a
      reader who knows `curves/*.json` knows this too:

```
{ kind: 'virtual-card',
  name, derivedFrom,                      ← провенанс: из каких файлов снята геометрия
  card: { name, maxGraphicsMhz },
  voltageGridMv: [...],  frequencyGridMhz: [...],
  stockCurve: [{ mhz, voltageMv }, ...],  ← «частота → обслуживающее напряжение», owner's coordinate
  vfTable:   [{ voltageMv, mhz }, ...],   ← the 127-entry WRITE path, an implementation detail
  powerLimitW: { default, min, max },
  stamp: { driver, vbios, takenAt },
  fiction: { }                            ← ПУСТО в фазе 1; края отказа приходят в фазе 2
}
```

- [ ] `loadCard(path)` validates and REFUSES on: missing `kind` · a grid that is not ascending /
      descending as declared · a `stockCurve` frequency absent from `frequencyGridMhz` · a voltage
      absent from `voltageGridMv` · `maxGraphicsMhz` above the frequency grid's top · an empty grid ·
      a `powerLimitW` range that does not contain its default · a `stamp` without driver or VBIOS.
- [ ] **A card that fails its own validator is NOT loaded** — the same rule the grids already obey
      («негодный словарь НЕ записывается»), and for the same reason: a half-loaded fixture produces
      results nobody can attribute.
- [ ] `fiction` exists as an empty object from the start, so phase 2 adds a value rather than a shape.

**Verification:** ≥8 hostile fixtures in `automation-engine/lib/__fixtures__/`, one defect each,
every refusal naming its field (B1-AC1).

### 4.2 — Derive the first card from the measured geometry 🔲

*Anchor: `plans/16` §0 — «геометрия первой виртуальной карты УЖЕ СНЯТА… придумать надо только края».*

- [ ] `npm run vgpu -- --derive --from curves --out benches/cards/rtx5070ti.json` reads
      `voltage-grid.json`, `frequency-grid.json` and `measured.json` and writes the fixture, carrying
      their stamps and recording `derivedFrom` with each source file and its `takenAt`.
- [ ] The V/F table (`vfTable`) is derived from `curves/measured.json`'s stock voltages the same way
      the write path reads it — 127 entries, the 128th excluded by the SAME constant the writer uses
      (`CLK_VF_POINT_COUNT − 1`), never by a literal 127 (B1-AC6).
- [ ] A block compares the fixture against the sources field by field (B1-AC2). **Derivation is a
      command, not a paste:** a hand-typed geometry is a number with no provenance, which is the class
      `PHILOSOPHY.md` calls the worst kind.

### 4.3 — The card's state, and the behaviours it must NOT simplify away 🔲

*Anchor: internal map R1/R2; the owner's-machine rule step 4 («confirm by RE-READING the state — and
POLL UNTIL IT IS STABLE»).*

- [ ] State held: `powerLimitW` · `clockLock: {min,max} | null` · `curveOffsetsMhz[127]` ·
      `clockMhz` (what a query answers) · the driver/VBIOS stamp · a write counter per method.
- [ ] **Three paid-for behaviours are MODELLED, because a fake without them is easier than the card
      and would hide the very defects the guards exist to catch (B1-AC4):**

  | Behaviour | Where it was paid for | How it is modelled |
  |---|---|---|
  | A read immediately after a write may return the PREVIOUS value | `-rgc` answered «All done» with exit 0 while `clocks.gr` still reported the locked 1200 MHz | `settleSamples` (default 1): the first N queries after a write answer the old value |
  | A tool's success text is not evidence | `nvidia-smi` prints the DEFAULT in its «from» field (`researches/01` §5) | every write returns a plausible success string that the state does NOT have to match |
  | A quantity RAMPS, so two agreeing samples are not arrival | fans, EXP-0028 | the clock approaches its target over `rampSamples` rather than jumping |

- [ ] The clock a query answers is COMPUTED from the state — the lock, the curve, the card maximum —
      never stored as an independent field. Two sources for one fact is how a fake drifts from itself.
- [ ] `virtualCard(cardProfile, { settleSamples, rampSamples })` — the knobs are per-instance, so a
      suite that wants an instant card asks for one instead of a global flag.

### 4.4 — The card backend: the four semantic methods 🔲

*Anchor: `profile-manager.mjs:92` — «R2's seam. Four semantic methods».*

- [ ] `query(fields)` answers every field of `STATE_FIELDS` — `driver_version`, `vbios_version`,
      `power.limit`, `power.default_limit`, `power.min_limit`, `power.max_limit`, `clocks.gr`,
      `clocks.max.graphics` — as STRINGS, exactly as `nvidia-smi`'s CSV does. A field the real backend
      would not know must be unknown here too.
- [ ] `setPowerLimitWatts(w)` clamps to the profile's range and REFUSES outside it, the way the card
      does (measured: 250–300 W on this specimen).
- [ ] `lockGraphicsClocksMhz(min,max)` · `resetGraphicsClocks()` — both return the `{ok, status,
      stdout, stderr}` shape the real backend returns, so nothing above the seam changes.
- [ ] **A write counter per method** — this is what lets any later suite assert «zero GPU writes» on a
      path that was supposed to be read-only, and it is the bench's cheapest instrument.

**Verification:** `readState`, `sampleWritable` and `readBack` from `profile-manager` drive it
unchanged; the settle behaviour makes `readBack` actually poll (its `staleReads` fixture already
proves the applier handles it).

### 4.5 — The curve backend, and the refusal parity that makes it trustworthy 🔲

*Anchor: `profile-manager.mjs:161–268`; internal map R11 (a ceiling has a holder), R12 (a vector may
invert), R13 (never above the specimen's maximum).*

- [ ] `virtualCurveBackend(card)` implements `writeRaiseAndCap` · `readCurveOffsets` · `zeroCurve` ·
      `close()` over the card's `vfTable` and `curveOffsetsMhz`.
- [ ] **The arithmetic has ONE author.** It calls the real `nvapi.buildRaiseAndCapVector` — the same
      function the live backend calls — and applies the same four refusals in the same order: the R11
      cap leak, the R13 absent bound, the R13 raised-offer ceiling, the R12 introduced inversion. A
      virtual card that computed its own vector would be a second arithmetic, and `researches/10` §2.6
      lists exactly that as an abandoned anti-pattern.
- [ ] **B1-AC3, the refusal-parity block, and it is the phase's most valuable test:** a table of
      inputs — a cap below the enforceable floor · a raise offering above 3090 · no `cardMaxClockMhz`
      passed · a vector that introduces an inversion · a legal write — driven through BOTH backends'
      decision paths, asserting the same verdict AND the same named rule. This is the contract test of
      `researches/10` §2.2 arriving in phase 1, on the one interface where it is free.
- [ ] `readCurveOffsets` returns MHz truncated to the same count the writer used — the unit is
      converted in ONE place, as it is in the real backend (EXP-0034).
- [ ] `close()` is a no-op that is still CALLED and counted: a caller that forgets it is a caller that
      would leak the NVAPI handle on the real path, and the counter is what makes that visible.

### 4.6 — `npm run vgpu` — show, derive, selftest 🔲

- [ ] `--show <card>` prints the card the way `curve --show` prints the curve: geometry counts, the
      grid spacings, the maximum, the stamp, the power range, and **`fiction: (пусто — фаза 2)`** so
      nobody mistakes phase 1's card for one with an edge.
- [ ] `--derive` per §4.2 · `--selftest` per §4.7.
- [ ] `package.json` gains `"vgpu": "node automation-engine/lib/virtual-gpu.mjs"`.
- [ ] **Every output carries the provability line** (E3-AC8, and it starts here rather than in phase 2
      so it is never retrofitted): *«виртуальная карта — вымысел; её числа не являются утверждением о
      живой карте»*.

### 4.7 — Selftests and mutations 🔲

- [ ] `vgpu --selftest`: the validator's ≥8 hostile fixtures · the derivation comparison · the settle
      and ramp behaviours · the four backend methods against `profile-manager`'s readers · the
      refusal-parity table · `apply` / `roundTrip` / `resetToFactory` end to end on the virtual card ·
      a block asserting the write counters are ZERO on read-only paths · a block asserting the suite
      wrote nothing outside its sandbox (EXP-0025).
- [ ] **Mutations, addressees named in the suite header BEFORE the run:** make the validator accept a
      voltage off the grid · make the derived fixture keep a stale stamp · drop the R13 refusal from
      the virtual curve backend (the parity block must redden, not the R13 block) · make the read-back
      answer instantly (the settle block) · make the clock a stored field instead of a computed one ·
      hard-code 127 as a literal (the second-geometry block) · let `close()` be optional.

### 4.8 — The canon records what changed 🔲

- [ ] `AGENT_GUIDE.md` — the harness table gains `npm run vgpu -- --show` / `--derive` / `--selftest`,
      each marked read-only and offline; the truth↔mirror registry gains the row **the real curve
      backend's refusals ↔ the virtual one's**, checked by the parity block.
- [ ] `PROJECT_STRUCTURE_EXTERNAL_MAP.md` — `benches/cards/` as committed fixtures.
- [ ] `PROJECT_ARCHITECTURE_INTERNAL_MAP.md` — the virtual card is R2's THIRD backend and introduces
      no writer; R1 untouched. One line, in the rules table's spirit rather than a new rule.
- [ ] `STATUS.md` and `plans/16` §4 ticked.

## 5. What phase 1 does NOT do

- **No edge, no failure model, no randomness** — phase 2. The card cannot fail yet, and that is what
  makes it debuggable.
- **No `ЗАВИС`, no process death** — phase 2.
- **No traps, no contract suite over the load path** — phase 3. The one contract that IS here
  (refusal parity, §4.5) is here because it costs nothing and guards the most dangerous divergence.
- **It does not remove the three existing hand-rolled doubles** (`plans/16` §8.7).
- **It does not touch the engine.** Not one line of `engine.mjs` changes in this phase; the bench is
  built to the interfaces that already exist.

## 6. Risks

**(a) Highest.**

| # | Risk | Defence |
|---|---|---|
| R1 | **The fake is more permissive than the card**, so later greens are lies | B1-AC3 refusal parity + one author for the vector arithmetic (§4.5). This is the phase's central defence and its central test |
| R2 | The fake is EASIER than the card on the read-back path, hiding the class the applier's polling exists for | B1-AC4: settle and ramp are modelled and each has a block that fails without it |
| R3 | The geometry is hand-typed and quietly diverges from the measured artifacts | B1-AC2: derivation is a command, and a block compares the result field by field |

**(b) Plausible.**

| # | Risk | Contingency |
|---|---|---|
| R4 | `buildRaiseAndCapVector` turns out to need the live curve's exact float shape, not the fixture's | the fixture carries `vfTable` in the same units the reader produces; if a mismatch appears it is a FINDING about the read path and gets a bug document, not a patched fixture |
| R5 | The second geometry (B1-AC6) uncovers many hard-coded constants | each is a defect by `BUG_FIXING_FRAMEWORK.md` and gets fixed; the count is reported rather than absorbed |
| R6 | `profile-manager` needs a change after all, breaking B1-AC5 | then B1-AC5 is not met and the change is judged on its merits in the open — the criterion exists to make that visible, not to forbid it |

## 7. Verification map — every command offline (B1-AC7)

| Step | The observation that closes it |
|---|---|
| 4.1 | `npm run vgpu -- --selftest` — every hostile fixture refused, each naming its field |
| 4.2 | `npm run vgpu -- --derive …` then the comparison block: 0 differences against `curves/*.json` |
| 4.3 | the settle block polls; the ramp block shows two agreeing samples before arrival; the mutation that stores the clock reddens its own block |
| 4.4 | `readState` / `readBack` from the real applier drive the virtual backend unchanged |
| 4.5 | the refusal-parity table: identical verdicts and identical named rules on every row |
| 4.6 | `npm run vgpu -- --show benches/cards/rtx5070ti.json` prints the card and the provability line |
| 4.7 | every mutation reddens its own named block, addressees named before the run |
| phase | `npm run check` green · `npm run watchdog -- --status` unarmed before and after · `git status` shows nothing written outside the intended paths |

## 8. Decisions made without the owner

- **The card fixture carries BOTH coordinates** — `stockCurve` («frequency → serving voltage», the
  owner's coordinate and the one the search reports in) and `vfTable` (the 127-entry write path). They
  are the same fact in two renderings, and the fixture holds both because the write path genuinely
  needs the second; the derivation computes one from the other so they cannot disagree.
- **`fiction` is present and empty in phase 1.** A shape that exists from the start is a shape phase 2
  fills; a shape invented in phase 2 is a format change.
- **The refusal parity is pulled forward from phase 3.** It belongs to the contract suite, but it
  costs nothing here and guards R1, which is the phase's biggest risk. A test that is cheap today and
  expensive later is taken today.
- **The write counters are part of the card, not of the suite.** Every later phase needs «how many
  writes did this path perform», and a counter living in the double is available to all of them.

---

## ✅ STATUS: DONE (тег поставлен 2026-08-30 18:0x, ревизия беклога сессии 68)

**Что закрыто.** Фаза 1 эпика 03 — виртуальная карта как объект: геометрия, состояние, два бэкенда.
Фаза была исполнена 2026-08-15, но тег `DONE` в имени файла не поставили; файл полтора месяца
числился открытой работой. Это ровно предмет `bugs/25`.

**Чем доказано — цепочкой ворот, а не памятью агента.** `plans/16` §4 задаёт вход фазы 2 как
«фаза 1 закрыта · `/fable-judge` по фазе 1», а вход фазы 3 — как «фаза 2 закрыта». Документ фазы 3
(`plans/19_DONE`) несёт в шапке **«entry gate passed 19:5x»** и «✅ ИСПОЛНЕНА 2026-08-15 21:4x — все
семь шагов и все одиннадцать критериев». Документ с тегом `DONE`, утверждающий, что его ворота
пройдены, — и есть свидетель закрытия обеих предыдущих фаз. Второй, независимый свидетель —
`STATUS.md`: «ЭПИК 03 ✅ ЗАКРЫТ ЦЕЛИКОМ 2026-08-15 20:5x — все три фазы».

**Чего этот тег НЕ утверждает.** Что закрыт сам эпик (`plans/16`): его десять критериев приёмки
E3-AC1…AC10 не несут в файле эпика ни одного записанного вердикта, и эта археология оставлена
открытой намеренно — см. `bugs/25`.
