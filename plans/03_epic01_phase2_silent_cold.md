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

- [ ] **Interface first, backend behind it.** `apply(profile)` · `readState()` · `resetToFactory()` ·
      `roundTrip(profile)`. The `nvidia-smi` backend is one object; nothing outside this module ever
      calls a GPU-control tool (R1/R2). Phase 4's NVAPI bridge replaces the backend, not the callers.
- [ ] **`readState()` re-reads, never infers:** power limit, default power limit, `clocks.gr`, and
      the card's identity for the stamp check. It does not consult its own memory of what it wrote.
- [ ] **`readBackStable()` is the primitive every write goes through** — poll `clocks.gr` (and the
      power limit) until **two consecutive samples agree**, with a named timeout that FAILS rather
      than returning the last sample. This is P2-AC2, and it exists because `-rgc` lied for a second
      (§2 row 3).
- [ ] **Apply order is fixed and its reverse is the rollback:** power limit, then the clock lock. Any
      step that fails triggers the reverse of the steps already done, then a `readState()` to prove
      the card is back. The rollback is not a comment — it is the code path taken by the failure test
      in P2-AC4.
- [ ] **Refuse on a stale stamp** (R6): compare the profile's driver/VBIOS against the card right now
      and refuse before any write, naming the field that differs.
- [ ] **A selftest that runs without touching the GPU**, on an injected runner — the shape phase 1
      proved works (`stress-tester --selftest`, 10 blocks). Blocks it must carry: a runner that
      returns the stale value once · a runner whose success text lies while the state did not change ·
      a failure injected between the two writes · a stale stamp · a clock off the ladder.
- **Verify:** the selftest first, then one real round trip on the card, then **mutation-prove the
  selftest red** — a guard that has never failed proves nothing (`BUG_FIXING_FRAMEWORK.md` → Guards,
  EXP-0008).

### 4.3 — A workload that SUSTAINS load, not one that spawns

*Anchor: `plans/02_epic01_phase1` §3.6, the limitation recorded rather than smoothed over: «нагрузки
идут процесс на прогон … Фазе 5 нужна нагрузка, крутящаяся внутри себя N секунд».*

- [ ] The host loops the launch inside ONE process for N seconds instead of one process per burst.
      The kernel and its arguments stay untouched, so the checksum stays the same deterministic
      function it is today and every existing baseline remains valid.
- [ ] Report the utilization actually reached, as a number, next to the ~20–30 % the spawn-per-burst
      shape reached. If the new shape does not saturate either, that is a finding, not a detail.
- **Verify:** run it with `hardware-mon` sampling alongside and read the utilization column — the
  same way phase 1 caught the 30 % ceiling in the first place (EXP-0012: the tests check what you
  thought to assert, the output shows what you built).
- **Why it is in THIS phase and not scope creep:** P2-AC7's meter cannot run without it. A −100 W
  delta cannot be measured under a load that never makes the card draw 100 W.

### 4.4 — The stock baseline under the sustained load

*Anchor: epic §2 AC4 — the meter for Silent Cold's power reduction.*

- [ ] Median power, temperature, fan speed and clock at stock under the sustained transient shape,
      into `runs/`, stamped like every other baseline.
- [ ] **The background is part of the record**, because it is part of the measurement: the GPU client
      list at capture time goes into the file. Stock and profile are compared only across
      **comparable** backgrounds (§2 row 4).
- [ ] **The profile is deliberately NOT part of the golden checksum's stamp.** EXP-0011 makes the
      stamp carry everything the value depends on — and the arithmetic result must NOT depend on the
      clock. If the checksum changes when only the clock changed, that IS silent data corruption, and
      it is the whole point of the oracle. Written down here so a future session does not
      "helpfully" add the profile to the stamp and quietly destroy the detector.
- **Verify:** capture twice at stock and compare the medians — a spread wider than the effect we are
  hunting means the meter is not sharp enough yet and the run length must grow.

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
