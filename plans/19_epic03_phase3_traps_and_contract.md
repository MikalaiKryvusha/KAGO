# Plan 19 — Epic 03 / Phase 3: trap cards, the contract suite, and proofs about the bench itself

> **Created:** 2026-08-15 20:0x +03:00 (agent, written at phase 2's closure as the ladder requires —
> `plans/16` §4: the operational plan of phase N+1 is written when phase N closes)
> **Parent:** `plans/16_EPIC_virtual_gpu_bench.md` — phase 3. Evidence base: `researches/10` §3.1
> (the three seams), §3.2 (the three existing doubles), §4.3 (why the contract suite is the real
> deliverable), §4.6 (the five traps), §4.7 (the bench measures the engine) · `researches/09` §4
> (the 1.7 h / 13 h / 67 h arithmetic this phase turns into a measurement)
> **Status:** 🔲 open · **ZERO GPU WRITES** · no owner needed · entry gate passed 2026-08-15 19:5x
> **Outbound:** the contract suite → the truth↔mirror registry in `AGENT_GUIDE.md` · the provability
> boundary mechanism → `TESTING_FRAMEWORK.md` · the three doubles collapsing into one → the internal
> map · closure → `plans/16` §4 and the entry gate of `plans/15`

---

## 1. Goal vector

**The pain.** The bench is believed on its own authority. Nothing proves it goes RED when the engine
is wrong; nothing watches it against the live card, so a double that drifts more permissive than the
card would make every later green a lie and nothing would say so; and the two claims the owner cares
about most — *«ускорение это аргумент, а не форк кода»* and *«движок не знает, с кем говорит»* — are
asserted in comments rather than measured.

**Where we want to be.** Five trap cards, each of which makes a WRONG engine fail in a NAMED block.
One contract suite over the three seams, run against both the virtual card and the live card, whose
live column is allowed to read `не прогонялась` and is never allowed to read green on a virtual run.
The no-branches and acceleration claims proved by grep and by a diff of two command lines. And the
engine's own cost measured against `researches/09` instead of estimated.

**Goal types.** *Achieve* — traps, contract, the four proofs. *Maintain* — zero GPU writes, zero
`if (virtual)` in the engine, the provability line in every report. *Avoid* — a trap that passes on
a broken engine, and a contract row that claims the live card without a live run.

## 2. Entry gate — passed

| Gate (`plans/16` §4) | Evidence |
|---|---|
| Phase 2 closed | `npm run vgpu -- --selftest` → **63 blocks, 0 failures**, exit 0 (2026-08-15 19:5x) |
| `/fable-judge` over phase 2 | **VERIFIED WITH CAVEATS**, 2026-08-15 19:5x. Behaviour reproduced on an independent mutation sample (4 of 4 caught, 2 with exact addressivity). Two record defects found and fixed in `edbf7fe`: a `[TESTED]` marker certifying a property `59bd8eb` had deleted, and phase-2 mutation addressees living only in `plans/18` |
| `npm run check` | 36 files, 0 failures |

**Three findings the judge handed FORWARD into this phase rather than closing.** They are steps
below, not caveats: §4.1 carries the unreachable-addressee finding, §4.5 carries the fixture
calibration finding, §4.2 carries the short-circuit finding.

## 3. Acceptance criteria

By `REQUIREMENTS_FRAMEWORK.md` — **Scale · Meter · Target**, so a future session can RUN them.

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **B3-AC1** | Five trap cards exist as FILES, and each names its addressee and its class BEFORE any run. | Scale: traps whose expected block and judgeability class are written down before execution · Meter: the suite header + this plan · **Target: 5 of 5** |
| **B3-AC2** | Every trap of class A reddens its named block against a deliberately wrong engine and stays green against the right one. | Scale: traps whose named block goes red on the wrong engine AND green on the intact one · Meter: a scripted wrong-engine run per trap · **Target: 100 % of class A; a trap that cannot go red is deleted, not kept** |
| **B3-AC3** | Class B traps ship with their assertion HONESTLY PENDING — never green. | Scale: class-B assertions reported as passed while `plans/15` is unimplemented · Meter: the contract report · **Target: 0. `ждёт движка развёртки (plans/15)` is a legal status; green is not** |
| **B3-AC4** | The contract suite covers all three seams and prints two columns. | Scale: seams with no contract case · Meter: `npm run contract -- --virtual` · **Target: 0 uncovered seams; the live column reads `не прогонялась` until a live run fills it** |
| **B3-AC5** | The live column cannot be filled by a virtual run. | Scale: live-column cells turned green by `--virtual` · Meter: a mutation that tries to · **Target: 0, and the attempt reddens a named block** |
| **B3-AC6** | The engine carries ZERO «we are on a mock» branches (E3-AC1). | Scale: branching lines in `automation-engine/**` outside the bench · Meter: a grep block inside the suite, not a manual grep · **Target: 0, and the two command lines differ ONLY in argument VALUES** |
| **B3-AC7** | Acceleration is an argument, and the bench tells the truth about what it does and does not spend. | Scale: wall clock of a burn, default and with `burnRealSeconds` · Meter: `npm run contract` → the «ЧАСЫ» blocks · **Target: default ≈0 ms (the seconds belonged to the workload process, which the bench REPLACES) · `burnRealSeconds` spends them for real · duration still enters the failure model, so a short burn finds strictly less** ⚠️ **rewritten 2026-08-15 20:4x by measurement — the original target («≥ 6 s actually elapsed») encoded `plans/16` §8.3's claim, which the first run contradicted; §8.3 is corrected there** |
| **B3-AC8** | The engine is MEASURED against `researches/09`, and divergence is NAMED (E3-AC10). | Scale: rungs and wall-clock per band on a known edge, against 1.7 h / 13 h / 67 h · Meter: a bench report · **Target: printed and compared; every divergence attributed to engine or to fixture, out loud** |
| **B3-AC9** | A second geometry walks the same code (E3-AC9). | Scale: hard-coded constants assuming 127 / 389 / 3090 found by the second card · Meter: the existing second-geometry card, extended to the contract suite · **Target: run passes; each constant found is a finding and is fixed** |
| **B3-AC10** | Zero GPU writes across the whole phase. | Scale: writes to the card · Meter: `npm run watchdog -- --status` before and after · **Target: 0** |
| **B3-AC11** | Every new guard proved able to fail, addressees named BEFORE the run. | Scale: mutations reddening their own named block · **Target: 100 %, and an addressee that is UNREACHABLE by its own mutation is said so in the suite header rather than counted as proved** |

## 4. Steps

### 4.1 — Five trap cards, split by what is judgeable TODAY 🔲

`researches/10` §4.6 lists five traps. **Three of them judge behaviour that does not exist yet:** the
sweep engine of `plans/15` (epic 02 phase 2) is written but not implemented, and today's
`engine.mjs` is the phase-5 search — `searchEdge` / `composeAscentLadder` / `pickAscentRungs` /
`bisectPlan` / `ratchetView`, with **no journal, no seeding, no `lever-limited` verdict and no
two-crash stop**. Read from the tree 2026-08-15 20:0x, not recalled.

So each trap ships with a CLASS, and the class is part of the artifact:

| # | Trap card | The engine must | Class | Judged against |
|---|---|---|---|---|
| T1 | edge above the descent's reach | stop and report the edge at the first rung | **A — today** | `engine --search` |
| T2 | hangs at a fixed rung | die for real mid-search; the launcher sees the death | **A — today, in half** | the child-process shape of `plans/18` §4.4 |
| T3 | non-monotone Vmin | reject the seed, restart from stock, PRINT it | **B — pending** | `plans/15` |
| T4 | edge below the lever wall | report `lever-limited`, never `edge-found` | **B — pending** | `plans/15` |
| T5 | hangs twice on the same rung | refuse the third attempt, exit non-zero | **B — pending** | `plans/15` |

- [ ] Five card files under `benches/cards/traps/`, each carrying its own `note` saying what it traps
      and which engine behaviour judges it.
- [ ] T2's second half — *«name that rung after re-launch»* — is class B: it needs the write-ahead
      journal. The half that IS judgeable today (a real death at a chosen rung) is asserted now.
- [ ] **Class B assertions are written now and reported as pending**, so `plans/15` inherits an
      executable checklist instead of a paragraph. This is E3-AC5's rule applied inside the epic: an
      assertion may honestly stand «не прогонялась»; it may not stand green.
- [ ] **The judge's unreachable-addressee finding is honoured here:** for every trap, name the block
      it must redden AND check that the trap is not swallowed earlier by `validateCard`. A trap the
      validator refuses is a trap that proves the validator, not the engine — legal, but it must be
      LABELLED that way (see §4.7).

### 4.2 — The contract suite over the three seams 🔲

The epic's real deliverable (`researches/10` §4.3). One suite, run twice.

- [ ] `automation-engine/lib/seam-contract.mjs` — cases stated over the INTERFACE, not over either
      implementation: the card backend (`query` · `setPowerLimitWatts` · `lockGraphicsClocksMhz` ·
      `resetGraphicsClocks`), the curve backend (`writeRaiseAndCap` · `readCurveOffsets` ·
      `zeroCurve` · `close`), and the oracle (`judgeCandidate({runShapeFn})`).
- [ ] `npm run contract -- --virtual` (offline, every commit) · `npm run contract -- --live`
      (read-only assertions plus the writes the project already performs, at phase gates ONLY).
- [ ] **Two columns, and the live one starts empty by construction:** the report is built from
      recorded RUNS, so an unrun case has nothing to render green. A mutation that tries to fill the
      live column from a virtual run must redden a named block (B3-AC5).
- [ ] **The short-circuit finding applies to this suite too:** a fail-fast that aborts the run hides
      every case behind it. The contract suite reports ALL cases, marking aborted ones explicitly,
      because a suite whose failure mode is silence is the instrument that certifies the others.

### 4.3 — E3-AC1: the engine does not know who it is talking to 🔲

- [ ] A block that greps `automation-engine/**` (excluding the bench itself) for branches on the
      bench — the check lives IN the suite, not in a session's memory of having run a grep once.
- [ ] A block that renders the LIVE invocation and the BENCH invocation and asserts they differ only
      in argument VALUES — same executable, same flag names, same order.
- [ ] Baseline taken 2026-08-15 20:0x: the grep is already clean. **A check that has never failed
      proves nothing (EXP-0008)** — so it is proved against a deliberately branched copy first.

### 4.4 — Acceleration is an argument, not a fork 🔲

- [ ] A block that asks the bench for a 6 s burn and measures the wall clock: it must actually take
      ≈6 s. `plans/16` §8.3 decided the bench does NOT shorten anything itself, and «в 10 раз» means
      the owner's numbers, not «instantly» — the proof is that the seconds really pass.
- [ ] The full sweep's wall clock over a narrowed band is printed, so §4.5 has an instrument.

### 4.5 — The bench measures the engine — and names what is fixture, not engine ✅ 2026-08-15 21:0x

> **DONE — `npm run measure`. And the concern this step was built around did NOT reproduce.**
>
> | Что | Оценка `researches/09` | По фикстуре | Итог |
> |---|---|---|---|
> | лестница шагов | 850 ступеней · 6 ч | **600** · 4,2 ч | −29 % |
> | **плюс затравка (отгружаемый план)** | 250 ступеней · 1,7 ч | **278** · 1,9 ч | **+11 %** |
>
> **Оценка выдержала.** 28,5 % отказов затравки стоят одиннадцати процентов, а не кратного роста —
> потому что отвергнутая затравка откатывается НЕ на ползание по 5 мВ, а на лестницу владельца, и она
> дёшева. Затравка остаётся выгодной при доле отказов втрое выше названной им. Опасение записано как
> ОПРОВЕРГНУТОЕ, а не тихо снято.
>
> **Второй результат, которого никто не заказывал: факт 38 воспроизвёлся на стенде сам.** Из шести
> представительных частот **три (2002 · 1702 · 1102 МГц) не искались вовсе** — ниже пола потолка
> кривой (≈2157 МГц) отгружаемой формы записи не существует, и движок отказывает ДО первой ступени.
> Это движок, который прав, и ровно та причина, по которой эпик 02 вводит закрепление частоты —
> теперь она видна замером, а не доводом.
>
> **Что НЕ замерено и помечено в самом выводе:** строка «плюс затравка» стоит на ДОПУЩЕНИИ
> (удержавшаяся затравка — 2 ступени, отвергнутая — полная лестница). Заменить его наблюдением может
> только живой движок развёртки, `plans/15`.

- [ ] Rung counts and wall clock on a known edge, per band, against `researches/09` §4's arithmetic
      (1.7 h seeded · 13 h boundary-search · 67 h naive).
- [ ] **Carry the judge's calibration finding, measured 2026-08-15 19:5x and not to be re-derived:**
      on `benches/cards/rtx5070ti.json` the neighbour seeding would be REJECTED on **111 of 389
      frequencies (28.5 %)** — the rung taken from the higher-frequency neighbour's edge lands below
      the lower frequency's own edge. Mechanical cause: the tremble is ±8 mV while the smallest grid
      rung is 5 mV, so point-to-point noise exceeds a rung by construction. Inversion depths: median
      4.6 mV, 90th percentile 11.1 mV, max 16.8 mV; 83 of 389 exceed one rung.
- [ ] **Why this matters and is not cosmetic:** the 1.7 h figure assumes the seed USUALLY holds. The
      owner's own rule is *«очень редко — выше, почти не бывает такого»*, and 28.5 % is not «почти не
      бывает». So a measured cost above 1.7 h on this fixture is a property of the CARD, not of the
      engine, and E3-AC10 requires it be named rather than absorbed.
- [ ] **Two legal resolutions, and the choice is recorded:** calibrate the tremble down toward the
      owner's stated silicon (the card is a FILE with `noise.amplitudeMv` — `plans/16` R7 says model
      refinement is a new card, never a patch to the bench), or keep the harsher card and print the
      divergence with its cause. **Default taken: keep the harsh card AND print the divergence**,
      because a fixture that exercises the rejection path abundantly is worth more to `plans/15` than
      a fixture that flatters the estimate — and the estimate is protected by naming, not by tuning.
      A second card with owner-calibrated noise is added if `plans/15` wants the optimistic number.

### 4.6 — The three existing doubles migrate onto the contract 🔲

- [ ] `profile-manager.fakeBackend` · `ladder-descent.fakeBackend` · `profile-manager.fakeCurve`
      (`researches/10` §3.2) move to the contract — **AFTER the suite is green, never before**
      (`plans/16` R6: removing the only working check before its replacement is proved is how you
      lose both).
- [ ] They encode paid-for lessons — a read-back that FLASHES the target for one sample is EXP-0014's
      incident. The migration must keep those cases, by name, or it is a regression wearing a
      refactor's clothes.
- [ ] The internal map records the collapse (three doubles → one contract), because that is a
      relation change.

### 4.7 — Selftests and mutations 🔲

Addressees named in the suite header BEFORE the run, per EXP-0016 and the judge's finding that the
naming must live in the FILE and not only in the plan:

| Mutation | Must redden |
|---|---|
| a trap card that traps nothing | «ЛОВУШКА: каждая ловушка ловит НЕПРАВИЛЬНЫЙ движок» |
| the live column filled from a virtual run | «КОНТРАКТ: живая колонка не заполняется виртуальным прогоном» |
| a contract case dropped for one seam | «КОНТРАКТ: все три шва покрыты» |
| an `if (virtual)` branch planted in the engine | «ШОВ: ноль веток „мы на моке“» |
| the bench shortens a 6 s burn by itself | «УСКОРЕНИЕ: это аргумент, а не сокращение» |
| the divergence from `researches/09` swallowed instead of printed | «ИЗМЕРЕНИЕ: расхождение названо» |
| a second-geometry constant hard-coded back | «ОБЩНОСТЬ: другая геометрия» |

**And the honest label the judge pass demands:** any addressee that is UNREACHABLE by its own
mutation because an earlier refusal fires first is written as such in the header, with the guard that
actually catches it named. A short circuit is not addressivity, and counting it as such is how a
suite starts certifying itself.

## 5. What phase 3 does NOT do

Implement `plans/15` (the sweep engine) · touch the real card · change `engine.mjs` behaviour ·
resolve the class-B assertions · plan epic 04 (the visualiser, `ideas/05`) — that is its own ladder.

## 6. Decisions made without the owner

*(method is the agent's work, EXP-0026; each is cheap to reverse and each is named here rather than
in chat)*

- **Traps ship with a CLASS rather than waiting for `plans/15`.** Writing five cards now and asserting
  only what today's engine can be judged against costs one column in a table; waiting would mean
  phase 3 cannot close until epic 02 phase 2 is implemented, which inverts the order the owner set
  (the bench comes FIRST, so the sweep engine has somewhere to be debugged).
- **The harsh fixture is kept and the divergence printed**, rather than tuning the noise down to make
  the 1.7 h estimate look right. Tuning a fixture until it agrees with an estimate is how an estimate
  stops being checkable.
- **The contract suite reports all cases including aborted ones**, instead of failing fast. Fail-fast
  is right for a card that must not be half-loaded; it is wrong for the instrument that certifies the
  other instruments.
