# Plan 03 — Epic 01 / Phase 2: Silent Cold on `nvidia-smi` alone

> **Created:** 2026-08-10 09:5x +03:00 (agent, at the close of phase 1)
> **Parent:** `plans/01_EPIC_kago_orchestrator.md` — phase 2
> **Status:** 🟡 open · entry gate GREEN (phase-1 exit gates verified this morning by
> `npm run phase1:accept`, and the owner's consent for `-lgc`/`-rgc` is granted)
> **Outbound:** the first real profile → `profiles/` · the −100 W verdict → the owner (epic AC4 may
> turn out unreachable on this backend, exactly as the −50 W power-limit floor did) · new harness
> commands → the `AGENT_GUIDE.md` test-harness table

---

## 1. Goal vector

**The pain.** Phase 1 can watch the card and judge a run, but KAGO still cannot *change* anything.
Everything the owner asked for — a quieter, cooler card he switches with a shortcut — begins with one
module that writes and can take the write back.

**Where we want to be at the close.** A `profile-manager.mjs` that applies a profile, proves it
applied by re-reading the card, and undoes it — with one measured *Silent Cold* profile stored in
`profiles/`, stamped with the driver and VBIOS it was proven on.

**Goal types:** *Achieve* — the first working profile. *Maintain* — factory state as the default and
one writer for the whole tree. *Avoid* — a write with no proven way back.

**Anchor in the epic** (`plans/01_EPIC_kago_orchestrator.md` §3): *«Фаза 2 — Silent Cold на одном
`nvidia-smi`. Первый настоящий профиль, на бэкенде, который уже доказал, что пишет. Фиксация частоты
ядра гонит карту вниз по её же стоковой кривой; это даёт холодно и тихо и принципиально не даёт
быстро и холодно.»*

## 2. What this phase already knows — settled by observation on 2026-08-10, not assumed

These four were open questions when the epic was written. They were closed on the live card this
morning, and every step below rests on them rather than re-deriving them.

| Question | Answer, observed | Consequence for the design |
|---|---|---|
| Does `-lgc` write on this GeForce at all? | **Yes.** `nvidia-smi -i 0 -lgc 1200,1200` → exit 0; the idle clock moved 180 → **exactly 1200 MHz** and stopped varying | The path-A backend is complete, not half-proven — `-pl` was already confirmed 2026-08-09 |
| How is a clock lock READ BACK? `nvidia-smi` has no locked-clocks field: `-q -d CLOCK` answers *"Requested functionality has been deprecated"* for Applications Clocks, and there is no `Locked Clocks` section | **`clocks.gr` itself, at idle.** Under the lock it equals the locked value and holds constant; released, it wanders (observed 810…1065 MHz). **A value that stops VARYING is the proof** | Read-back needs no load and no new instrument. **`clocks_event_reasons.active` stayed `0x0` under the lock — it is NOT the observable, and a future session must not reach for it** |
| Is the tool's success text evidence? | **No, twice over.** `-rgc` printed *"All done"* with exit 0 while the very next read still reported the locked 1200 MHz; the release surfaced ~1 s later. `researches/01` §5 already caught the same tool printing the DEFAULT in its "from" field | **Read-back = poll until two consecutive samples agree.** A single read after a write is not a read-back (EXP-0014) |
| Can the measurement be taken against a silent desktop? | **No.** With the two heaviest consumer apps fully stopped the card still sat at 825–950 MHz / ~28 W against 180 MHz / 21.76 W earlier the same morning — the largest remaining client is `dwm.exe`, the compositor, unstoppable while Windows is displayed on this card | **Stock and profile are measured under the SAME background, under a load heavy enough to dominate it.** Silencing the desktop buys ~6 W and is not a strategy (EXP-0015) |

## 3. Acceptance criteria for this phase

Every row carries Scale · Meter · Target (`REQUIREMENTS_FRAMEWORK.md` → the fit criterion). The
Meter column is a command wherever it can be one — an acceptance criterion only a human can check is
one nobody checks after the day it was written (the lesson P1-AC5 paid for).

| # | Criterion | Scale · Meter · Target |
|---|---|---|
| **P2-AC1** | WHEN a profile is applied, `profile-manager.mjs` shall confirm it by RE-READING the card, never by parsing the tool's output. | Scale: decisions taken from the tool's stdout · Meter: `grep` the module for parsing of `nvidia-smi` success text + the selftest's lying-runner block · **Target: 0** |
| **P2-AC2** | The read-back shall treat a value as read only when two consecutive samples agree. | Scale: verdicts issued from a single sample · Meter: selftest block feeding a runner that returns the OLD value once, then the new one · **Target: 0 — and the module must return the NEW value, not the stale one** |
| **P2-AC3** | Every write shall have a rollback that has been RUN, not merely written. | Scale: round trips whose final state matches the initial one · Meter: `npm run profile -- --roundtrip <name>` — read stock, apply, read back, roll back, read back · **Target: 3 of 3 reads as expected, final == initial on every compared field** |
| **P2-AC4** | IF any step of a multi-step apply fails, THEN the card shall be returned to the state it held before the apply began. | Scale: partial states left on the card · Meter: selftest with an injected failure between the power-limit write and the clock write · **Target: 0** |
| **P2-AC5** | A profile shall carry the driver and VBIOS it was measured on, and applying one whose stamp no longer matches shall be REFUSED. | Scale: applies performed with a stale stamp · Meter: `npm run profile -- --apply <name>` against a profile whose stamp was edited · **Target: 0, and the refusal names the mismatching field** (rule R6) |
| **P2-AC6** | The card under *Silent Cold* shall produce no CRASH and no SDC over the phase's verification run. | Scale: CRASH + SDC verdicts · Meter: `npm run stress -- --workload <each> --transient` under the profile, plus the event log over the same window · **Target: 0** |
| **P2-AC7** | *Silent Cold* shall reduce median power under the sustained transient load, measured against stock under the SAME background — **and the report shall carry the meter's own run-to-run spread beside the delta.** | Scale: watts, median over the run · Meter: `hardware-mon` samples, stock vs profile, background recorded in both, plus two identical stock captures to measure the spread (§4.4) · **Target: report the measured delta and the spread. NOT a threshold.** Owner's word, 2026-08-10: the PDF's −100…−120 W is a reference, not a target — it floats between individual cards, and the design formula is «maximize the power reduction while the price stays ≤ N», with N set by the owner WITH the curve in hand. A delta thinner than the spread is not reported as an effect |
| **P2-AC8** | `npm run check` shall stay green and no third-party GUI shall enter the dependencies. | Scale: exit code · dependencies of that kind · Meter: `npm run check` · read `package.json` · **Target: 0 · 0** (epic AC6) |

## 4. Steps

Each step cites the epic line it executes. Verification is an **observation**, never an inference
from reading the diff (`TESTING_FRAMEWORK.md`). **Every step that writes to the card names its
rollback before the write** (`AGENT_GUIDE.md` → the owner's-machine rule).

### 4.1 — The profile format, and `profiles/`

*Anchor: internal map §4 — «Сброс — это профиль, как два других, а не особый случай в коде».*

**DONE 2026-08-10 09:31 +03:00** — `automation-engine/lib/profile-store.mjs` · `profiles/factory.json` ·
`profiles/README.md` · `npm run profiles`. No GPU write in this step.

- [x] One JSON per profile: name, the settings (`powerLimitWatts`, `graphicsClockLockMhz {min,max}`),
      the stamp (driver, VBIOS, taken-at as local ISO 8601 with offset), and the evidence the profile
      was accepted on (verdicts, median power / temperature / fan, the background it was measured
      against). **`title` added** — the owner-facing label phase 3 puts on the shortcut, taken from his
      own three names. **`evidence` is optional at the FORMAT level and visible at the LIST level**
      (`⚠ БЕЗ ДОКАЗАТЕЛЬСТВ`): making it mandatory would block §4.2's round trip, which by construction
      runs before any profile has been proven.
- [x] **The factory profile is a profile file like the others** — `-rgc` plus the power limit back to
      the card's own `power.default_limit`. Not a special branch: the third shortcut of phase 3 and
      the failure path of every apply are then the same code.
      **How it is achieved:** one convention, `null` = the card's own factory value, for BOTH settings.
      The factory profile is then simply the file with both nulls, and the applier has no branch to take.
      **A consequence worth naming:** the stamp is required *iff* the profile sets something, so the
      factory profile carries none — and MUST carry none, or a reset would start refusing to run after
      a driver update, which is the worst failure available to the one path that must always work.
      The rule is DERIVED from the settings, not held in a `factory: true` flag someone must sync.
- [x] Clock values are taken from the MEASURED ladder (`gpu:info --json`), never from a round number
      a human liked. A value off the ladder is rejected at load time with the nearest two named.
      **The ladder's shape was re-observed rather than assumed:** 4 full memory rungs × 389 identical
      points 180…3090 MHz, and the low 405 MHz rung's 95 points are a strict SUBSET — so the full-rung
      ladder is the complete valid set and no union/intersection choice arises. A card that ever
      disagrees between its full rungs produces NO ladder instead of a silent blend.
- [x] `.gitignore` decision made BEFORE the first file is written. **Already encoded by a previous
      session** — the tree ignores only `profiles/*.local.json`, i.e. profiles ship by default. Kept,
      and the reasons written into `profiles/README.md` as the step demands: a measured profile is
      expensive state rather than regenerable output (unlike `runs/`); a foreign or stale profile
      refuses itself mechanically via the R6 stamp check, so published numbers cannot mislead another
      card; and `factory.json` must exist in a fresh clone or the reset shortcut has nothing to apply.
- **Verified by observation:** `npm run profiles` loads `profiles/factory.json` against the live card
  and prints it (driver 610.88 · VBIOS 98.03.58.40.8b · 250…300 W · ladder 389 points). `npm run
  profiles -- --selftest` — **14 hostile fixtures, 0 failures, no GPU touched**, covering the
  off-ladder clock (names the nearest two), the missing stamp field, the whole-stamp absence, a `Z`
  timestamp, a mistyped setting key, an omitted setting, a name disagreeing with its filename, a power
  limit below the card's floor, a stale driver (R6), `min > max`, a factory profile carrying a stamp,
  and a missing shortcut label. **Mutation-proved:** breaking the ladder check → 1 red; breaking the
  "sets something ⇒ needs a stamp" derivation → 5 red; relaxing the `takenAt` offset rule → 1 red.
  (The first mutation run reported a CRASHED verifier as green; the harness now separates
  «НЕ ПРОГНАЛСЯ» from «ЗЕЛЁНЫЙ» — `BUG_FIXING_FRAMEWORK.md` → a finding is not a finding, point 3.)

### 4.2 — `automation-engine/lib/profile-manager.mjs` — the one writer

*Anchor: internal map R1, R2, R5 — one writer · swappable backends · rollback in the same module.*

**DONE 2026-08-10 10:5x…11:4x +03:00** — `automation-engine/lib/profile-manager.mjs` · `npm run profile`.
**The first module in the project that writes to the GPU**, and its round trip was RUN on the live card,
not merely written: 300 → 290 W, core pinned to 1200 MHz, both writes re-read to stability, rollback
executed and every compared field back to its initial value. `npm run profile -- --selftest` — 13 blocks
on fake backends, no card touched; mutation-proved, and the mutation run is what found the fixture that
did not guard its own rule (EXP-0016).

- [x] **Interface first, backend behind it.** `apply(profile)` · `readState()` · `resetToFactory()` ·
      `roundTrip(profile)`. The `nvidia-smi` backend is one object; nothing outside this module ever
      calls a GPU-control tool (R1/R2). Phase 4's NVAPI bridge replaces the backend, not the callers.
- [x] **`readState()` re-reads, never infers:** power limit, default power limit, `clocks.gr`, and
      the card's identity for the stamp check. It does not consult its own memory of what it wrote.
- [x] **`readBackStable()` is the primitive every write goes through** — poll `clocks.gr` (and the
      power limit) until **two consecutive samples agree**, with a named timeout that FAILS rather
      than returning the last sample. This is P2-AC2, and it exists because `-rgc` lied for a second
      (§2 row 3).
- [x] **Apply order is fixed and its reverse is the rollback:** power limit, then the clock lock. Any
      step that fails triggers the reverse of the steps already done, then a `readState()` to prove
      the card is back. The rollback is not a comment — it is the code path taken by the failure test
      in P2-AC4.
- [x] **Refuse on a stale stamp** (R6): compare the profile's driver/VBIOS against the card right now
      and refuse before any write, naming the field that differs.
- [x] **A selftest that runs without touching the GPU**, on an injected runner — the shape phase 1
      proved works (`stress-tester --selftest`, 10 blocks). Blocks it must carry: a runner that
      returns the stale value once · a runner whose success text lies while the state did not change ·
      a failure injected between the two writes · a stale stamp · a clock off the ladder.
- **Verify:** the selftest first, then one real round trip on the card, then **mutation-prove the
  selftest red** — a guard that has never failed proves nothing (`BUG_FIXING_FRAMEWORK.md` → Guards,
  EXP-0008).

### 4.3 — A workload that SUSTAINS load, not one that spawns

*Anchor: `plans/02_epic01_phase1` §3.6, the limitation recorded rather than smoothed over: «нагрузки
идут процесс на прогон … Фазе 5 нужна нагрузка, крутящаяся внутри себя N секунд».*

**DONE 2026-08-10 12:2x…13:2x +03:00.** Every bullet below is measured and committed, the low-load
dwell and the idle→burst edge included (`npm run stress -- --lowload`).

- [x] The host loops the launch inside ONE process for N seconds instead of one process per burst.
      The kernel and its arguments stay untouched, so the checksum stays the same deterministic
      function it is today and every existing baseline remains valid.
      **Verified, not assumed:** both `run_checksum` values unmoved after the rebuild
      (67e95c85bb6299a2 · e27ec24a82d509d7), and `npm run stress` PASSes against the EXISTING
      baselines — no re-capture was needed or performed. The duration is a FLAG, never a positional,
      which is also what keeps it out of the golden's `args` stamp (the live run reports «аргументы
      [по умолчанию]»), leaving EXP-0011's guard untouched. `npm run workloads:build` re-proves the
      whole exemption every build: sustained checksum == default checksum, `distinct=1`.
- [x] Report the utilization actually reached, as a number, next to the ~20–30 % the spawn-per-burst
      shape reached. If the new shape does not saturate either, that is a finding, not a detail.
      **Measured with a SEPARATE `npm run mon` process** (an in-process sampler records zero samples,
      because `runBurst` uses `spawnSync` and blocks Node's event loop):

      | форма | util | Вт | МГц | вент | запусков/с |
      |---|---|---|---|---|---|
      | процесс на прогон | 8 % (макс 9) | 61,7 | 2670 | 0 | 7,6 |
      | устойчивый `sdc_fma` | 57 % | 137,9 | 2887 | 34 | 1286 |
      | устойчивый `branchy` | **97 % (макс 99)** | **194,8** | 2887 | 31 | 39 |

      The recorded "20–30 %" came from other arguments; at default arguments the old shape reaches 8 %.
      **Cross-check that makes the numbers trustworthy:** the program's self-reported duty factor
      (`gpu_us/wall_us` = 56,3 % · 98,5 %) and the card's independent utilization (57 % · 97 %) agree.
      **A finding for this phase:** saturated, the card draws 194,8 W against a 300 W limit — a 250 W
      power limit cannot bite on this workload, so Silent Cold's reduction must come from the clock
      lock, not from `-pl`.
- [x] **REPORT THROUGHPUT — work per second — and record `clocks.gr` alongside it.** Added
      2026-08-10 from `researches/04`; it is not scope creep but the closing of a blind spot the
      harness has carried since phase 1. **Clock stretching** (the card skips work while still
      reporting the locked clock) and **memory error replay** (GDDR7 carries internal ECC + CRC) both
      yield a CORRECT checksum and NO event — so today's oracle would stamp such a profile PASS. The
      only observable is work-per-second against stock, WITH the clock recorded: a throughput drop at
      an unchanged clock is stretching, a throughput drop with a lower clock is merely a lower clock.
      One instrument, two jobs — it is also the price column P2-AC7 and the owner's N both need.
- [x] **A GRADED oracle, not only a binary one** — added 2026-08-10 on the owner's question *«а как
      мерить точность расчёта GPU по цифрам?»*. The checksum spends one bit of information on "did
      anything change", so one bad element and sixty thousand read the same; a descent toward the edge
      needs a gradient. Four keys: `bad_launches` · `bad_elems_max` · `bit_dist_min` ·
      `first_bad_index`, and `npm run stress` prints the **per-thread fault rate** beside the verdict.
      The COUNT is measured and the MAGNITUDE deliberately is not — both kernels are dependent chains
      built to amplify, so |got − expected| carries no information.
      **Proven by `npm run prove:gradient`:** a copy of `sdc_fma.cu` with one injected bit-flip
      returned the exact tuple `distinct=2 · bad_launches=1 · bad_elems_max=1 · bit_dist_min=1 ·
      first_bad_index=123` over 2519 launches — **while the burst checksum still MATCHED the golden**,
      i.e. the old two-observation oracle would have said PASS. `researches/04` §2's blind spot,
      reproduced on a real run instead of argued.
- [x] Method, from the benchmarking practice surveyed in `researches/04` §5: time with CUDA events
      (GPU-side, host overhead excluded) · warm up before timing · keep each timed unit far above the
      ~10 µs floor where the timer's own overhead dominates · defeat the caches between timed calls ·
      and report the **run-to-run spread**, because a delta thinner than the spread is not an effect.
- [x] **A low-load dwell and an idle→burst edge** join the shapes. `researches/04` §3.1: an undervolt
      can be *conditionally* stable — surviving sustained heavy stress and dying at idle or in a
      browser, because the low end of the V/F curve has its own requirements. A heavy test never
      visits that region, so it cannot qualify a profile.
      **Shipped as `npm run stress -- --lowload`** — the same duty machinery as `--transient` with the
      opposite duty (1 s on / 9 s off, `config.LOWLOAD_*`), so one is not a second copy of the other.
      Asking for both is REFUSED rather than silently resolved: running one shape while logging the
      other's name is a mismatch nobody notices until a verdict is being explained months later.
      **Measured with telemetry alongside, 30 s run:**

      | | частота мед | мин | util мед | Вт мед |
      |---|---|---|---|---|
      | `--lowload` | **1237 МГц** | 967 | **5 %** | **39,4** |
      | устойчивая `branchy` | 2887 МГц | — | 97 % | 194,8 |

      The per-sample series shows the shape working: a spike to 2887–2902, a decay
      1642 → 1395 → 1275 → … → 967, then another spike. **The honest caveat: the card does NOT reach
      its 180 MHz idle floor in the 9 s off window — it settles around 967–1000 MHz.** That is not the
      shape failing; it is EXP-0015's floor, `dwm.exe` holding the card awake while Windows is
      displayed on it. Which means this shape tests **the region the card actually occupies during
      desk work** — precisely the owner's «клик по иконке» case, and not a deep idle the machine never
      visits.
- **Verify:** run it with `hardware-mon` sampling alongside and read the utilization column — the
  same way phase 1 caught the 30 % ceiling in the first place (EXP-0012: the tests check what you
  thought to assert, the output shows what you built).
- **Why it is in THIS phase and not scope creep:** P2-AC7's meter cannot run without it. A −100 W
  delta cannot be measured under a load that never makes the card draw 100 W.

### 4.4 — The stock baseline under the sustained load

*Anchor: epic §2 AC4 — the meter for Silent Cold's power reduction.*

**DONE 2026-08-10 14:1x…15:0x +03:00** — `automation-engine/lib/power-baseline.mjs` · `npm run power`.
**No GPU write in this step:** the module reads the card and runs compute on it; it sets nothing. The
profile a capture was taken under is a LABEL the caller supplies — this module never applies one.

- [x] Median power, temperature, fan speed and clock at stock under the sustained shape, into
      `runs/power/`, stamped like every other baseline (driver · VBIOS · workload · args · shape ·
      seconds · sustain · profile). **The verdict rides along in the same record**, because a power
      number taken during a run that produced SDC is not a baseline — it is a measurement of a broken
      card, and two separate commands would let a future session quote the watts without ever looking
      at the verdict.
- [x] **The background is part of the record.** `nvidia-smi --query-compute-apps` lists the GRAPHICS
      clients too on this Windows machine (probed: 25 clients, `dwm.exe` among them), so the vendor's
      own instrument answers it and no second tool is needed. Names without paths, with counts, sorted.
      A comparison NAMES a background difference rather than refusing on it — the client list drifts by
      one browser tab, and §2 row 4 asks for COMPARABLE backgrounds, not identical ones.
- [x] **The profile is deliberately NOT part of the golden checksum's stamp.** EXP-0011 makes the
      stamp carry everything the value depends on — and the arithmetic result must NOT depend on the
      clock. If the checksum changes when only the clock changed, that IS silent data corruption, and
      it is the whole point of the oracle. Written down here so a future session does not
      "helpfully" add the profile to the stamp and quietly destroy the detector.
- [x] **The sampler runs in its own PROCESS, and the load waits for its header line.** `runBurst` uses
      `spawnSync`, which blocks Node's event loop for the whole burst, so an in-process sampler records
      zero samples over exactly the window that matters (§4.3). A spawned process is a guess; a written
      header is an observation, so the capture polls for it and fails loudly if it never appears.
- [x] **The run is split into its LOADED and IDLE halves** at `config.LOAD_PHASE_UTILIZATION_PCT`
      (50 %). A whole-run median under a duty cycle sits between two lobes and moves with sample
      alignment instead of with the card. Both halves report their SAMPLE COUNTS and their own
      utilization medians, so a split that failed to split is visible in the output (EXP-0012).

**Verified by observation — TEN stock captures in two independent series of five, every one PASS with
the checksum matching the golden:**

| | медиана Вт | разброс | цена, операций/с | разброс цены |
|---|---|---|---|---|
| серия A (5 прогонов) | 197,1 | 0,67 Вт = 0,34 % | 5,1155e10 | 0,18 % |
| серия B (5 прогонов) | 196,2 | 0,49 Вт = 0,25 % | 5,1162e10 | 0,07 % |
| **вместе (10)** | **196,6** | **1,28 Вт = 0,65 %** | **5,1157e10** | **0,18 %** |

**THE NUMBER THIS STEP EXISTS TO PRODUCE, and the form it must be quoted in: the meter's own floor is
1.28 W (0.65 %) on power and 0.18 % on price. A delta thinner than that is NOT an effect.** P2-AC7 is
satisfied by the tool printing exactly that sentence beside every spread it computes.

**Two findings the runs produced, neither of them planned:**

1. **The WITHIN-series spread understates the floor.** Series A scattered 0.67 W and series B 0.49 W,
   yet their MEDIANS sit 0.9 W apart — further than either series' own width. Runs inside one series
   share a thermal and background state, so their agreement is partly an artefact of that sharing. The
   honest floor is the pooled range over independent series, and it is what the tool reports when
   given both (`npm run power -- --spread stock`).
2. **Power tracks the temperature the run REACHES.** Ten runs that settled at 62–63 °C drew
   196.0…197.3 W; the one run that reached 68 °C drew 201.2 W — 5 °C worth ~4 W, three times the
   scatter of the ten. So a stock-vs-profile comparison is only legal between runs at comparable
   temperature, and `startTemperature` / `startFanSpeed` ride in every record so the condition is
   visible. **What this does NOT say** (the first draft of the finding said it and the next series
   refuted it within the hour): the starting FAN speed does not predict the outcome on its own — one
   run started with the fan at 0 and still settled in the 63 °C group.

**Its own means of checking** (`TESTING_FRAMEWORK.md` → the work produces it): `npm run power --
--selftest` — 28 blocks on injected data, no GPU. **Mutation-proved:** seven guarantees broken one at
a time (the loaded/idle split · the empty-set null · the empty-half nulls · the condition-field
comparison · the R6 driver check · the two-measurement minimum · the client counting), each reddening
THE BLOCK THAT BELONGS TO IT, with the suite's completion line demanded present so a crashed verifier
cannot pass as green (EXP-0016).

### 4.5 — Find the Silent Cold point

*Anchor: epic §3 phase 2 — «подбор точки по температуре и шуму».*

- [ ] Descend the measured ladder from stock, not by a search for a failure edge — **that is phase 5's
      job and it needs the NVAPI bridge** (`researches/03` §2: `nvidia-smi` has no voltage field at
      all). Here the card stays inside its own stock V/F curve, so every point is a point the card
      already considers safe.
- [ ] At each candidate: the sustained transient run, the three-way verdict, and the medians. The
      candidate list is short and named up front — this is a descent over a handful of rungs, not a
      sweep.
- [ ] **Fan speed is the countable proxy for "quiet"** (`TESTING_FRAMEWORK.md` → countable quality
      proxies). It never replaces the owner's ear: the phase hands him two or three candidates to
      LISTEN to, and his verdict is what closes the choice (the taste class, `AGENT_GUIDE.md`). The
      agent's own "sounds quiet to me" is not a verification.
- [ ] **Never leave the card locked at the end of a run.** Every candidate run ends in
      `resetToFactory()` plus a stable read-back, including on failure.
- **Verify:** the candidate table with its numbers, and the card read back at stock afterwards.

### 4.6 — Prove the profile, then store it

*Anchor: epic §4, phase-2 exit gate — «профиль применяется, перечитывается и совпадает · его откат
прогнан, а не просто написан · маркеры `[TESTED]` несут наблюдение».*

- [ ] P2-AC6 run: each workload under the profile, transient shape, verdict from checksum AND the
      event log over the same window.
- [ ] The profile file written with its stamp and its evidence.
- [ ] Every new module and non-trivial block carries an honest `[NOT-TESTED]` / `[TESTED: date · how]`
      marker; a marker flips only on an observation.

### 4.7 — Housekeeping the phase owes

- [ ] New harness commands into the `AGENT_GUIDE.md` table, each row saying what it PROVES.
- [ ] The truth↔mirror registry: the profile's stamp ↔ the live card is a genuine pair (two
      independent authors, one of them a moment in the past) — register it with
      `npm run profile -- --verify-stamps`. Do NOT register anything one side can simply import from
      the other (EXP-0013: a pair you can delete beats a pair you must watch).
- [ ] `STATUS.md` and `MASTER_PLAN.md` phase 2 updated at closure; the phase closes with a
      `/fable-judge` pass before phase 3's plan is written (epic §4).

## 5. Risks for this phase

**(a) Highest — defended, not merely listed.**

- *A write that leaves the card in a state nobody intended.* → the fixed apply order with its reverse
  as the rollback (4.2), the failure-injection test (P2-AC4), `resetToFactory()` always available,
  and the physical backstop that profiles live in volatile GPU memory — a reboot returns the card to
  stock with no action from the owner.
- *A read-back that believes a stale value.* → already bit once, within an hour of the first write.
  Defended by `readBackStable()` and by P2-AC2, which tests it with a runner that lies exactly that
  way.
- *The −100 W target may be unreachable on this backend.* Locking the clock walks the card down its
  own stock curve; it cannot raise frequency at a given voltage. → the phase MEASURES and reports
  rather than promising. If the delta falls short, that is a finding for the owner in the same class
  as the 250 W power-limit floor (`researches/01` §2.1), and it is what phases 4–5 exist to buy.

**(b) Likely — with a named plan.**

- *A profile that looks fine at idle and misbehaves under load.* → nothing is accepted on an idle
  read-back alone; every candidate carries a loaded run with the three-way verdict.
- *The sustained workload still fails to saturate.* → report the number and treat the meter as blunt;
  do not report a power delta measured with an instrument known not to reach the range.

**(c) Least likely — written down so they are not forgotten.**

- A driver update mid-phase invalidates every baseline and profile (R6 catches it; `--verify-baseline`
  already announces it).
- The card refuses a clock value that the ladder lists as supported.

## 6. Phase acceptance

*Filled at closure — one row per criterion of §3, each produced by RUNNING its Meter column.*

## 7. Decisions made without the owner

*Filled at closure. Running list:*

- **Read-back is defined as two agreeing consecutive samples**, rather than one read plus a fixed
  sleep. A sleep is a guess about the card; agreement is an observation. *Reversible:* swap in a
  fixed settle delay if the polling ever proves costly.
- **The factory state is modelled as a profile**, not as a special code path.

*From §4.1, 2026-08-10:*

- **The format lives in its own module** (`profile-store.mjs`), not inside the writer. R1's audit is
  only worth what it costs, and it costs least when the writing module stays small and rarely
  imported; the format needs no card, so it is provable on fixtures alone. *Reversible:* fold it into
  the manager, one file move.
- **`null` = the card's own factory value**, for both settings. This is what makes the factory profile
  a file rather than a branch, and it is the single convention the whole format rests on.
- **A missing setting key is a refusal, not a default.** «Leave as is» and «restore factory» are
  different instructions; an omitted key would let the applier pick one.
- **The stamp is required iff the profile sets something** — derived from the settings, not from a
  flag. Its point is the factory profile's exemption, which must hold across driver updates.
- **`title` is part of the format**, carrying the owner's own shortcut names (🚀 / ❄️ / ⏹) so phase 3
  reads them from the profile instead of re-deciding them. Quoting his words, not naming anything.
- **`evidence` is optional in the format and flagged in the listing.** Enforcing it would block
  §4.2's round trip, which necessarily runs before any profile is proven. *Confirmed at §4.6:* the
  shipped Silent Cold profile carries evidence or the phase does not close.
- **`stamp.takenAt` refuses a `Z` timestamp**, accepting only a local ISO 8601 with offset — a guard
  for the defect EXP-0012 already paid for.
- **The valid clock set is the FULL memory rungs' ladder**, and a card whose full rungs disagree gets
  no ladder at all instead of a blended one. On this card the low rung is a strict subset, so the
  choice is observed rather than assumed.
- **`profiles/` ships**, keeping the earlier session's `.gitignore` line untouched; the reasons now
  live in `profiles/README.md` instead of in a session's head.

*From §4.4, 2026-08-10:*

- **The power meter is its OWN module** (`power-baseline.mjs`), not a flag on `stress-tester.mjs`. The
  tester answers *"is the card still computing correctly"*; this one answers *"what did the card cost
  while it did"*. It IMPORTS the tester rather than re-running the load itself, so there is one runner
  and no second copy to drift. *Reversible:* fold it in, one file move.
- **The capture and the spread live in ONE command.** P2-AC7 requires the delta to be reported beside
  the meter's scatter; two commands would let a project ship the delta and forget the scatter.
- **The measurement was NOT taken against a silenced desktop**, although the owner permits stopping
  background apps during runs. §2 row 4 and EXP-0015: quieting apps buys ~6 W, cannot reach the idle
  floor, and the compared numbers must share a background rather than lack one. Recording the client
  list costs nothing and touches nothing of the owner's.
- **A differing background is NAMED, not refused.** The client list drifts by one browser tab; refusing
  on it would make the meter unusable, while refusing on driver / VBIOS / workload / args / shape /
  profile is mandatory (EXP-0011 — a comparison across differing conditions has no verdict).
- **The loaded/idle splitter is an absolute 50 % of utilization.** Measured utilization on this card is
  strongly bimodal (5 % dwell · 57 % `sdc_fma` · 97 % `branchy`), so 50 % sits in the gap for every
  shape measured. The record always prints both halves' sample counts, so a split that stopped working
  announces itself. *Reversible:* one constant in `config.mjs`.
- **The pooled range across INDEPENDENT series is the reported floor**, not the tighter within-series
  spread — measured: two series scattered 0.67 and 0.49 W while their medians sat 0.9 W apart.
